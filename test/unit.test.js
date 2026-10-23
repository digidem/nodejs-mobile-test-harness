import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { parseAdbDevices } from '../src/android.js'
import { DeviceNotFound } from '../src/errors.js'
import { pickSimulator } from '../src/ios.js'
import { mainJs, writeNodejsProject } from '../src/project.js'
import {
	lineSplitter,
	parseSentinel,
	sentinelWatcher,
} from '../src/sentinel.js'
import { projectCacheDir } from '../src/util.js'

test('parseSentinel', () => {
	assert.deepEqual(parseSentinel('__NODE_EXIT__:0'), {
		before: '',
		exitCode: 0,
	})
	assert.deepEqual(parseSentinel('ok 1__NODE_EXIT__:3'), {
		before: 'ok 1',
		exitCode: 3,
	})
	assert.deepEqual(parseSentinel('__NODE_EXIT__:-1'), {
		before: '',
		exitCode: -1,
	})
	assert.equal(parseSentinel('ok 1 - fine'), undefined)
	assert.equal(parseSentinel('__NODE_EXIT__:'), undefined)
})

test('lineSplitter joins chunks and strips \\r', () => {
	/** @type {string[]} */
	const lines = []
	const s = lineSplitter((l) => lines.push(l))
	s.push('TAP version 13\r\nok ')
	s.push('1\r\n')
	s.push('tail')
	s.flush()
	assert.deepEqual(lines, ['TAP version 13', 'ok 1', 'tail'])
})

test('parseAdbDevices', () => {
	const out =
		'List of devices attached\nemulator-5554\tdevice\nR58M\tunauthorized\n\n'
	assert.deepEqual(parseAdbDevices(out), [
		{ serial: 'emulator-5554', state: 'device' },
		{ serial: 'R58M', state: 'unauthorized' },
	])
	assert.deepEqual(parseAdbDevices('List of devices attached\n\n'), [])
})

test('pickSimulator', () => {
	/** @param {string} udid @param {string} name @param {string} [state] */
	const dev = (udid, name, state = 'Shutdown') => ({
		udid,
		name,
		state,
		isAvailable: true,
	})
	const devices = {
		'com.apple.CoreSimulator.SimRuntime.iOS-18-6': [
			dev('A', 'iPhone 16'),
			dev('B', 'iPhone 17 Pro'),
		],
		'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
			dev('C', 'iPhone 17 Pro'),
			dev('D', 'iPhone 17'),
		],
		'com.apple.CoreSimulator.SimRuntime.watchOS-26-0': [
			dev('W', 'Apple Watch', 'Booted'),
		],
	}
	assert.equal(
		pickSimulator(devices, 'iPhone 17 Pro').udid,
		'C',
		'newest runtime wins',
	)
	assert.equal(pickSimulator(devices, 'B').udid, 'B', 'UDID')
	assert.equal(pickSimulator(devices).udid, 'C', 'first iPhone, newest runtime')
	devices['com.apple.CoreSimulator.SimRuntime.iOS-18-6'][0].state = 'Booted'
	assert.equal(pickSimulator(devices).udid, 'A', 'a booted iOS simulator wins')
	assert.throws(() => pickSimulator(devices, 'iPhone 3G'), DeviceNotFound)
})

test('generated main.js reports the final exit code', (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmth-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	/** @type {[string, string, number, string][]} */
	const cases = [
		// tape prints its summary and exits from its own exit listener
		[
			'exit listener',
			"process.on('exit', () => { console.log('1..1'); process.exit(1) })",
			1,
			'1..1\n__NODE_EXIT__:1\n',
		],
		[
			'process.exit()',
			"console.log('hi'); process.exit(4)",
			4,
			'hi\n__NODE_EXIT__:4\n',
		],
		[
			'natural exit',
			"console.log('hi'); process.exitCode = 3",
			3,
			'hi\n__NODE_EXIT__:3\n',
		],
		['uncaught exception', "throw new Error('boom')", 1, '__NODE_EXIT__:1\n'],
		[
			'code set in a listener',
			"process.on('exit', () => { process.exitCode = 5 })",
			5,
			'__NODE_EXIT__:5\n',
		],
	]
	for (const type of ['commonjs', 'module']) {
		fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type }))
		fs.mkdirSync(path.join(dir, 'sub'), { recursive: true })
		fs.writeFileSync(
			path.join(dir, 'main.js'),
			mainJs(path.join('sub', 'entry.js')),
		)
		for (const [name, source, exitCode, stdout] of cases) {
			fs.writeFileSync(path.join(dir, 'sub', 'entry.js'), source)
			const res = spawnSync(process.execPath, [path.join(dir, 'main.js')], {
				encoding: 'utf8',
			})
			assert.equal(res.status, exitCode, `${type}, ${name}`)
			assert.equal(res.stdout, stdout, `${type}, ${name}`)
		}
	}
})

test('the project can contain the cache directory', (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmth-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	const cacheRoot = projectCacheDir(dir)
	const dest = path.join(cacheRoot, 'ios', 'nodejs-project')
	fs.writeFileSync(path.join(dir, 'test.js'), '')
	fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true })
	fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), '')
	fs.mkdirSync(path.join(cacheRoot, 'ios'), { recursive: true })
	for (let i = 0; i < 2; i++) {
		writeNodejsProject({ projectDir: dir, entry: 'test.js', dest, cacheRoot })
	}
	assert.deepEqual(fs.readdirSync(dest).sort(), [
		'main.js',
		'node_modules',
		'test.js',
	])
	assert.deepEqual(fs.readdirSync(path.join(dest, 'node_modules')), ['dep'])
})

test('the project copy follows symlinks but skips dangling ones and loops', (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmth-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	const project = path.join(dir, 'project')
	const linked = path.join(dir, 'linked-dep')
	fs.mkdirSync(path.join(project, 'node_modules'), { recursive: true })
	fs.mkdirSync(linked)
	fs.writeFileSync(path.join(project, 'test.js'), '')
	fs.writeFileSync(path.join(linked, 'index.js'), 'dep')
	fs.symlinkSync(linked, path.join(project, 'node_modules', 'dep'))
	fs.symlinkSync(
		path.join(dir, 'gone'),
		path.join(project, 'node_modules', 'dangling'),
	)
	fs.symlinkSync(project, path.join(project, 'node_modules', 'loop'))
	const dest = path.join(dir, 'out')
	writeNodejsProject({
		projectDir: project,
		entry: 'test.js',
		dest,
		cacheRoot: projectCacheDir(project),
	})
	assert.deepEqual(fs.readdirSync(path.join(dest, 'node_modules')), ['dep'])
	const copied = path.join(dest, 'node_modules', 'dep', 'index.js')
	assert.equal(fs.lstatSync(copied).isSymbolicLink(), false)
	assert.equal(fs.readFileSync(copied, 'utf8'), 'dep')
})

test('sentinelWatcher keeps output that follows the sentinel', async () => {
	/** @type {string[]} */
	const written = []
	const stdout = /** @type {NodeJS.WritableStream} */ (
		/** @type {unknown} */ ({
			write: (/** @type {string} */ s) => written.push(s),
		})
	)
	const exited = new Promise((onExit) => {
		const watcher = sentinelWatcher({
			stdout,
			onExit,
			quietMs: 50,
			maxMs: 1000,
		})
		watcher.line('ok 1')
		watcher.line('__NODE_EXIT__:1')
		watcher.line('Error: boom')
		watcher.line('__NODE_EXIT__:0')
	})
	assert.equal(await exited, 1)
	assert.deepEqual(written, ['ok 1\n', 'Error: boom\n'])
})

test('sentinelWatcher stops draining at maxMs', async () => {
	const stdout = /** @type {NodeJS.WritableStream} */ (
		/** @type {unknown} */ ({ write() {} })
	)
	const start = Date.now()
	await new Promise((onExit) => {
		const watcher = sentinelWatcher({
			stdout,
			onExit,
			quietMs: 100,
			maxMs: 300,
		})
		watcher.line('__NODE_EXIT__:0')
		const noisy = setInterval(() => watcher.line('noise'), 20)
		setTimeout(() => clearInterval(noisy), 600)
	})
	const elapsed = Date.now() - start
	assert.ok(elapsed >= 250 && elapsed < 550, `${elapsed}ms`)
})

test('exec returns, and lets the process exit, while a daemon holds its pipes', () => {
	const util = new URL('../src/util.js', import.meta.url).href
	const script = `import { exec } from ${JSON.stringify(util)}
const res = await exec('sh', ['-c', 'sleep 10 & echo hi'], { timeoutMs: 5000 })
console.log(res.stdout.trim())`
	const start = Date.now()
	const res = spawnSync(
		process.execPath,
		['--input-type=module', '-e', script],
		{
			encoding: 'utf8',
			timeout: 8000,
		},
	)
	assert.equal(res.stdout.trim(), 'hi')
	assert.ok(Date.now() - start < 4000, `took ${Date.now() - start}ms`)
})
