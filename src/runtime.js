import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { DownloadFailed, InvalidRuntimeDir, InvalidVersion } from './errors.js'
import { exec, log, userCacheDir } from './util.js'

/** Bump together with the README and CI. */
export const DEFAULT_NODEJS_MOBILE_VERSION = '24.19.0-0'

/** @typedef {'ios' | 'android'} Platform */

/**
 * Release-zip URL for a digidem/nodejs-mobile version. Only `X.Y.Z-R` tags are
 * digidem releases; the `-R` suffix is what rules out the v18 line.
 *
 * @param {string} version e.g. `24.19.0-0` or `v24.19.0-0`
 * @param {Platform} platform
 */
export function runtimeUrl(version, platform) {
	const v = normalizeVersion(version)
	return `https://github.com/digidem/nodejs-mobile/releases/download/v${v}/nodejs-mobile-${platform}-${v}.zip`
}

/** @param {string} version */
export function normalizeVersion(version) {
	const v = version.replace(/^v/, '')
	if (!/^\d+\.\d+\.\d+-\d+$/.test(v)) throw new InvalidVersion({ version })
	return v
}

/**
 * The file each platform's build needs from an unpacked release, relative to
 * its root.
 *
 * @param {Platform} platform
 * @param {string} [abi]
 */
function requiredPaths(platform, abi) {
	if (platform === 'ios') return ['NodeMobile.xcframework/Info.plist']
	return ['include/node/node.h', abi ? `bin/${abi}/libnode.so` : 'bin']
}

/**
 * @param {string} dir
 * @param {Platform} platform
 * @param {string} [abi]
 */
export function assertRuntimeDir(dir, platform, abi) {
	for (const p of requiredPaths(platform, abi)) {
		if (!fs.existsSync(path.join(dir, p))) {
			throw new InvalidRuntimeDir({ dir, platform, missing: p })
		}
	}
}

/**
 * Directory holding an unpacked nodejs-mobile release for `platform`:
 * `runtimeDir` as given, or the version's entry in the per-user cache,
 * downloading it on first use.
 *
 * @param {object} options
 * @param {Platform} options.platform
 * @param {string} [options.version]
 * @param {string} [options.runtimeDir] an already-unpacked release; skips the cache
 * @param {string} [options.cacheDir]
 * @param {typeof fetch} [options.fetch]
 * @returns {Promise<string>}
 */
export async function ensureRuntime({
	platform,
	version = DEFAULT_NODEJS_MOBILE_VERSION,
	runtimeDir,
	cacheDir = userCacheDir(),
	fetch = globalThis.fetch,
}) {
	if (runtimeDir) {
		const dir = path.resolve(runtimeDir)
		assertRuntimeDir(dir, platform)
		log(`using runtime from ${dir}`)
		return dir
	}

	const v = normalizeVersion(version)
	const dest = path.join(cacheDir, v, platform)
	if (fs.existsSync(dest)) {
		assertRuntimeDir(dest, platform)
		log(`using cached nodejs-mobile ${v} (${dest})`)
		return dest
	}

	const url = runtimeUrl(v, platform)
	fs.mkdirSync(cacheDir, { recursive: true })
	// Unpack beside the destination and rename on success, so an interrupted
	// run never leaves a partial release that a later run would trust.
	const tmp = fs.mkdtempSync(path.join(cacheDir, '.tmp-'))
	try {
		const zip = path.join(tmp, 'release.zip')
		log(`downloading ${url}`)
		await download(fetch, url, zip)
		const out = path.join(tmp, 'out')
		const res = await exec('unzip', ['-q', zip, '-d', out], {
			timeoutMs: 10 * 60_000,
		})
		if (res.exitCode !== 0) {
			throw new DownloadFailed({
				url,
				reason: `unzip failed: ${res.stderr.trim()}`,
			})
		}
		assertRuntimeDir(out, platform)
		fs.mkdirSync(path.dirname(dest), { recursive: true })
		try {
			fs.renameSync(out, dest)
		} catch (err) {
			// Another run unpacked the same version first; use theirs.
			if (!fs.existsSync(dest)) throw err
		}
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
	log(`cached nodejs-mobile ${v} in ${dest}`)
	return dest
}

/**
 * @param {typeof fetch} fetch
 * @param {string} url
 * @param {string} file
 */
async function download(fetch, url, file) {
	let res
	try {
		res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) })
	} catch (err) {
		throw new DownloadFailed({ url, reason: String(err) }, { cause: err })
	}
	if (!res.ok || !res.body) {
		throw new DownloadFailed({ url, reason: `HTTP ${res.status}` })
	}
	await pipeline(
		Readable.fromWeb(
			/** @type {import('node:stream/web').ReadableStream} */ (res.body),
		),
		fs.createWriteStream(file),
	)
}
