import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { parseAdbDevices } from '../src/android.js'
import { DeviceNotFound } from '../src/errors.js'
import { pickSimulator } from '../src/ios.js'
import { mainJs, writeNodejsProject } from '../src/project.js'
import { lineSplitter, parseSentinel } from '../src/sentinel.js'
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

test('generated main.js prints the sentinel under CJS and ESM', (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmth-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	for (const type of ['commonjs', 'module']) {
		fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type }))
		fs.mkdirSync(path.join(dir, 'sub'), { recursive: true })
		fs.writeFileSync(
			path.join(dir, 'sub', 'entry.js'),
			"console.log('hi'); process.exitCode = 3",
		)
		fs.writeFileSync(
			path.join(dir, 'main.js'),
			mainJs(path.join('sub', 'entry.js')),
		)
		let out = ''
		try {
			execFileSync(process.execPath, [path.join(dir, 'main.js')], {
				encoding: 'utf8',
			})
		} catch (err) {
			out = /** @type {{ stdout: string, status: number }} */ (err).stdout
			assert.equal(/** @type {{ status: number }} */ (err).status, 3)
		}
		assert.equal(out, 'hi\n__NODE_EXIT__:3\n', type)
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
