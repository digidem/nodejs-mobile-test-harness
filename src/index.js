import path from 'node:path'

import {
	acquireDevice,
	apkPath,
	buildAndroid,
	deviceAbi,
	hostAbi,
	runAndroidApp,
} from './android.js'
import { buildIos, iosAppPath, runIosApp } from './ios.js'
import { assertProject } from './project.js'
import { ensureRuntime } from './runtime.js'
import { log, projectCacheDir } from './util.js'

export { DEFAULT_NODEJS_MOBILE_VERSION } from './runtime.js'
export * from './errors.js'

export const DEFAULT_ENTRY = 'test.js'
export const DEFAULT_TIMEOUT_SECONDS = 20 * 60

/**
 * @typedef {object} CommonOptions
 * @property {string} [projectDir] directory copied into the app as `nodejs-project/` (default `.`)
 * @property {string} [entry] file in `projectDir` that the generated `main.js` loads (default `test.js`)
 * @property {string} [nodejsMobileVersion] digidem/nodejs-mobile release to download (default {@link DEFAULT_NODEJS_MOBILE_VERSION})
 * @property {string} [runtimeDir] an already-unpacked nodejs-mobile release; skips the download
 * @property {number} [timeout] seconds to wait for the exit sentinel after launch (default 1200)
 * @property {boolean} [buildOnly] build the app and stop
 * @property {boolean} [runOnly] run the app from the last build
 * @property {string} [cwd] where `node_modules/.cache/nodejs-mobile-test-harness/` lives (default `process.cwd()`)
 * @property {NodeJS.WritableStream} [stdout] where app output goes (default `process.stdout`)
 */

/**
 * @typedef {object} RunResult
 * @property {string} appPath the built `.app` or `.apk`
 * @property {number} [exitCode] node's exit code; absent with `buildOnly`
 */

/** @param {CommonOptions} options */
function resolveCommon(options) {
	if (options.buildOnly && options.runOnly) {
		throw new TypeError('buildOnly and runOnly are mutually exclusive')
	}
	const cwd = path.resolve(options.cwd ?? process.cwd())
	return {
		projectDir: path.resolve(cwd, options.projectDir ?? '.'),
		entry: options.entry ?? DEFAULT_ENTRY,
		timeoutSeconds: options.timeout ?? DEFAULT_TIMEOUT_SECONDS,
		cacheRoot: projectCacheDir(cwd),
	}
}

/**
 * Build the project into the iOS test app and run it on a simulator.
 *
 * @param {CommonOptions & { simulator?: string }} [options] `simulator` is a
 *   name (newest runtime wins) or UDID; default: a booted simulator, else the
 *   first iPhone on the newest iOS runtime
 * @returns {Promise<RunResult>}
 */
export async function runIos(options = {}) {
	const { projectDir, entry, timeoutSeconds, cacheRoot } =
		resolveCommon(options)
	let appPath = iosAppPath(cacheRoot)
	if (!options.runOnly) {
		assertProject(projectDir, entry)
		const runtimeDir = await ensureRuntime({
			platform: 'ios',
			version: options.nodejsMobileVersion,
			runtimeDir: options.runtimeDir,
		})
		appPath = await buildIos({ projectDir, entry, runtimeDir, cacheRoot })
	}
	if (options.buildOnly) return { appPath }
	const exitCode = await runIosApp({
		appPath,
		simulator: options.simulator,
		timeoutSeconds,
		stdout: options.stdout,
	})
	return { appPath, exitCode }
}

/**
 * Build the project into the Android test app and run it on a device or
 * emulator.
 *
 * @param {CommonOptions & { serial?: string, avd?: string, abi?: string }} [options]
 *   `serial` picks an attached device (default `ANDROID_SERIAL`, else the only
 *   one attached); `avd` is booted headless when nothing is attached and shut
 *   down afterwards; `abi` defaults to the device's, or the host's
 *   architecture with `buildOnly`
 * @returns {Promise<RunResult>}
 */
export async function runAndroid(options = {}) {
	const { projectDir, entry, timeoutSeconds, cacheRoot } =
		resolveCommon(options)
	let appPath = apkPath(cacheRoot)
	if (options.buildOnly) {
		const abi = options.abi ?? hostAbi()
		appPath = await build(abi)
		return { appPath }
	}

	const device = await acquireDevice({
		serial: options.serial,
		avd: options.avd,
		cacheRoot,
	})
	try {
		log(`device: ${device.serial}`)
		if (!options.runOnly)
			appPath = await build(options.abi ?? (await deviceAbi(device.serial)))
		const exitCode = await runAndroidApp({
			apkPath: appPath,
			serial: device.serial,
			timeoutSeconds,
			stdout: options.stdout,
		})
		return { appPath, exitCode }
	} finally {
		await device.release()
	}

	/** @param {string} abi */
	async function build(abi) {
		assertProject(projectDir, entry)
		const runtimeDir = await ensureRuntime({
			platform: 'android',
			version: options.nodejsMobileVersion,
			runtimeDir: options.runtimeDir,
		})
		return buildAndroid({ projectDir, entry, runtimeDir, abi, cacheRoot })
	}
}
