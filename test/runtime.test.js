import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { InvalidRuntimeDir, InvalidVersion } from '../src/errors.js'
import { ensureRuntime, normalizeVersion, runtimeUrl } from '../src/runtime.js'

/** @param {import('node:test').TestContext} t */
function tmpDir(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmth-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	return dir
}

/**
 * A zip laid out like the android release, and a fetch that serves it and
 * records every URL requested.
 *
 * @param {string} dir
 */
function fakeRelease(dir) {
	const root = path.join(dir, 'release')
	fs.mkdirSync(path.join(root, 'include', 'node'), { recursive: true })
	fs.mkdirSync(path.join(root, 'bin', 'x86_64'), { recursive: true })
	fs.writeFileSync(path.join(root, 'include', 'node', 'node.h'), '')
	fs.writeFileSync(path.join(root, 'bin', 'x86_64', 'libnode.so'), '')
	const zip = path.join(dir, 'release.zip')
	execFileSync('zip', ['-qr', zip, '.'], { cwd: root })
	/** @type {string[]} */
	const requests = []
	/** @type {typeof globalThis.fetch} */
	const fakeFetch = async (url) => {
		requests.push(String(url))
		return new Response(fs.readFileSync(zip))
	}
	return { fetch: fakeFetch, requests, root }
}

test('runtimeUrl builds the release URL with or without a v prefix', () => {
	const want =
		'https://github.com/digidem/nodejs-mobile/releases/download/v24.19.0-0/nodejs-mobile-ios-24.19.0-0.zip'
	assert.equal(runtimeUrl('24.19.0-0', 'ios'), want)
	assert.equal(runtimeUrl('v24.19.0-0', 'ios'), want)
})

test('versions without the -R revision suffix are rejected', () => {
	for (const v of ['18.20.4', 'v18.20.4', '24.19.0', 'latest']) {
		assert.throws(() => normalizeVersion(v), InvalidVersion, v)
	}
})

test('the second run reuses the cache without a request', async (t) => {
	const dir = tmpDir(t)
	const { fetch, requests } = fakeRelease(dir)
	const cacheDir = path.join(dir, 'cache')
	const opts = {
		platform: /** @type {const} */ ('android'),
		version: '24.19.0-0',
		cacheDir,
		fetch,
	}

	const first = await ensureRuntime(opts)
	assert.equal(first, path.join(cacheDir, '24.19.0-0', 'android'))
	assert.ok(fs.existsSync(path.join(first, 'bin', 'x86_64', 'libnode.so')))
	assert.deepEqual(requests, [runtimeUrl('24.19.0-0', 'android')])

	const second = await ensureRuntime(opts)
	assert.equal(second, first)
	assert.equal(requests.length, 1)
	assert.deepEqual(
		fs.readdirSync(cacheDir).filter((f) => f.startsWith('.tmp-')),
		[],
		'no temp dirs left behind',
	)
})

test('runtimeDir skips the cache entirely', async (t) => {
	const dir = tmpDir(t)
	const { fetch, requests, root } = fakeRelease(dir)
	const cacheDir = path.join(dir, 'cache')

	const got = await ensureRuntime({
		platform: 'android',
		runtimeDir: root,
		cacheDir,
		fetch,
	})
	assert.equal(got, root)
	assert.equal(requests.length, 0)
	assert.equal(fs.existsSync(cacheDir), false)
})

test('a runtimeDir for the wrong platform is rejected', async (t) => {
	const { root, fetch } = fakeRelease(tmpDir(t))
	await assert.rejects(
		ensureRuntime({ platform: 'ios', runtimeDir: root, fetch }),
		InvalidRuntimeDir,
	)
})

test('a failed download leaves nothing in the cache', async (t) => {
	const dir = tmpDir(t)
	const cacheDir = path.join(dir, 'cache')
	/** @type {typeof globalThis.fetch} */
	const fakeFetch = async () => new Response('nope', { status: 404 })
	await assert.rejects(
		ensureRuntime({ platform: 'ios', cacheDir, fetch: fakeFetch }),
		/HTTP 404/,
	)
	assert.deepEqual(fs.readdirSync(cacheDir), [])
})
