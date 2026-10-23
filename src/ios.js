import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
	AppCrashed,
	AppNotBuilt,
	BuildFailed,
	CommandFailed,
	DeviceNotFound,
	DeviceTimeout,
	LaunchFailed,
	Timeout,
} from './errors.js'
import { APP_ID, copyTemplate, writeNodejsProject } from './project.js'
import { lineSplitter, parseSentinel } from './sentinel.js'
import { exec, execToStderr, log } from './util.js'

const BOOT_TIMEOUT_S = 300
const INSTALL_TIMEOUT_S = 120
const SIMCTL_TIMEOUT_S = 60

/** @param {string} cacheRoot */
function iosAppDir(cacheRoot) {
	return path.join(cacheRoot, 'ios')
}

/** @param {string} cacheRoot */
export function iosAppPath(cacheRoot) {
	return path.join(
		iosAppDir(cacheRoot),
		'build',
		'Build',
		'Products',
		'Debug-iphonesimulator',
		'TestHarness.app',
	)
}

/**
 * @param {object} options
 * @param {string} options.projectDir
 * @param {string} options.entry
 * @param {string} options.runtimeDir unpacked nodejs-mobile iOS release
 * @param {string} options.cacheRoot
 * @returns {Promise<string>} path to the built `.app`
 */
export async function buildIos({ projectDir, entry, runtimeDir, cacheRoot }) {
	const appDir = iosAppDir(cacheRoot)
	log(`preparing ${appDir}`)
	copyTemplate('ios', appDir)
	fs.mkdirSync(path.join(appDir, 'NodeMobile'))
	fs.cpSync(
		path.join(runtimeDir, 'NodeMobile.xcframework'),
		path.join(appDir, 'NodeMobile', 'NodeMobile.xcframework'),
		{ recursive: true, verbatimSymlinks: true },
	)
	writeNodejsProject({
		projectDir,
		entry,
		dest: path.join(appDir, 'nodejs-project'),
		cacheRoot,
	})

	log('building TestHarness.app (xcodebuild)')
	// prettier-ignore
	const args = [
		'-project', 'TestHarness.xcodeproj',
		'-scheme', 'TestHarness',
		'-configuration', 'Debug',
		'-sdk', 'iphonesimulator',
		'-destination', 'generic/platform=iOS Simulator',
		'-derivedDataPath', 'build',
		'-quiet',
		'CODE_SIGNING_ALLOWED=NO',
		'ARCHS=arm64',
		'ONLY_ACTIVE_ARCH=NO',
		'build',
	]
	const exitCode = await execToStderr('xcodebuild', args, { cwd: appDir })
	if (exitCode !== 0)
		throw new BuildFailed({ command: 'xcodebuild', exitCode: String(exitCode) })
	const appPath = iosAppPath(cacheRoot)
	if (!fs.existsSync(appPath)) throw new AppNotBuilt({ path: appPath })
	log(`built ${appPath}`)
	return appPath
}

/**
 * @typedef {object} SimDevice
 * @property {string} udid
 * @property {string} name
 * @property {string} state
 * @property {boolean} isAvailable
 */

/**
 * `com.apple.CoreSimulator.SimRuntime.iOS-26-5` → [26, 5, 0]; undefined for
 * non-iOS runtimes.
 *
 * @param {string} runtime
 */
function iosRuntimeVersion(runtime) {
	const m = /\.iOS-(\d+)-(\d+)(?:-(\d+))?$/.exec(runtime)
	return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : undefined
}

/**
 * Pick a simulator from `simctl list devices available -j` output.
 *
 * - A UDID is used as is.
 * - A name picks that device on the newest iOS runtime.
 * - No choice picks a booted iOS simulator, else the first iPhone on the
 *   newest iOS runtime.
 *
 * @param {Record<string, SimDevice[]>} devicesByRuntime
 * @param {string} [choice] name or UDID
 * @returns {SimDevice}
 */
export function pickSimulator(devicesByRuntime, choice) {
	const candidates = Object.entries(devicesByRuntime)
		.flatMap(([runtime, devices]) => {
			const version = iosRuntimeVersion(runtime)
			if (!version) return []
			return devices
				.filter((d) => d.isAvailable)
				.map((device) => ({ version, device }))
		})
		// Stable sort, newest runtime first; simctl's order is kept within one.
		.sort((a, b) => {
			for (let i = 0; i < 3; i++) {
				if (a.version[i] !== b.version[i]) return b.version[i] - a.version[i]
			}
			return 0
		})
		.map((c) => c.device)

	if (choice) {
		const found =
			candidates.find((d) => d.udid.toLowerCase() === choice.toLowerCase()) ??
			candidates.find((d) => d.name === choice)
		if (!found)
			throw new DeviceNotFound({
				reason: `no available iOS simulator named ${choice}`,
			})
		return found
	}
	const found =
		candidates.find((d) => d.state === 'Booted') ??
		candidates.find((d) => d.name.startsWith('iPhone'))
	if (!found) throw new DeviceNotFound({ reason: 'no available iOS simulator' })
	return found
}

/**
 * @param {string[]} args
 * @param {number} timeoutS
 * @param {string} step
 */
async function simctl(args, timeoutS, step) {
	const res = await exec('xcrun', ['simctl', ...args], {
		timeoutMs: timeoutS * 1000,
	})
	if (res.timedOut) throw new DeviceTimeout({ step, seconds: String(timeoutS) })
	return res
}

/**
 * Boot the simulator if needed and wait until it's ready. Leaves it booted.
 *
 * @param {string} [choice] name or UDID
 * @returns {Promise<SimDevice>}
 */
async function bootSimulator(choice) {
	const list = await simctl(
		['list', 'devices', 'available', '-j'],
		SIMCTL_TIMEOUT_S,
		'simctl list',
	)
	if (list.exitCode !== 0) {
		throw new CommandFailed({
			command: 'simctl list',
			output: list.stderr.trim(),
		})
	}
	const device = pickSimulator(JSON.parse(list.stdout).devices, choice)
	log(`simulator: ${device.name} (${device.udid})`)
	if (device.state !== 'Booted') {
		log('booting simulator')
		await simctl(['boot', device.udid], BOOT_TIMEOUT_S, 'simctl boot')
	}
	const status = await simctl(
		['bootstatus', device.udid, '-b'],
		BOOT_TIMEOUT_S,
		'simctl bootstatus',
	)
	if (status.exitCode !== 0) {
		throw new CommandFailed({
			command: 'simctl bootstatus',
			output: status.stderr.trim(),
		})
	}
	return device
}

/**
 * Install and launch the app, stream its stdout until the exit sentinel.
 *
 * @param {object} options
 * @param {string} options.appPath
 * @param {string} [options.simulator] name or UDID
 * @param {number} options.timeoutSeconds
 * @param {NodeJS.WritableStream} [options.stdout]
 * @returns {Promise<number>} node's exit code
 */
export async function runIosApp({
	appPath,
	simulator,
	timeoutSeconds,
	stdout = process.stdout,
}) {
	if (!fs.existsSync(appPath)) throw new AppNotBuilt({ path: appPath })
	const device = await bootSimulator(simulator)

	log('installing app')
	const install = await simctl(
		['install', device.udid, appPath],
		INSTALL_TIMEOUT_S,
		'simctl install',
	)
	if (install.exitCode !== 0) {
		throw new CommandFailed({
			command: 'simctl install',
			output: install.stderr.trim(),
		})
	}

	log('launching app')
	// --console-pty attaches a pty to the app's stdout/stderr and exits when the
	// app terminates, so the launch process exiting before the sentinel is the
	// dead-app signal: no process polling needed.
	const child = spawn(
		'xcrun',
		[
			'simctl',
			'launch',
			'--console-pty',
			'--terminate-running-process',
			device.udid,
			APP_ID,
		],
		{ stdio: ['ignore', 'pipe', 'pipe'] },
	)
	const launchLine = new RegExp(`^${APP_ID.replaceAll('.', '\\.')}: \\d+$`)
	let launched = false
	let launchStderr = ''

	return new Promise((resolve, reject) => {
		let done = false
		/** @param {() => void} settle */
		const finish = (settle) => {
			if (done) return
			done = true
			clearTimeout(timer)
			child.kill('SIGKILL')
			settle()
		}

		const lines = lineSplitter((line) => {
			if (done) return
			launched = true
			// simctl's own "<bundle id>: <pid>" line, which can follow app output.
			if (launchLine.test(line)) return
			const sentinel = parseSentinel(line)
			if (sentinel) {
				if (sentinel.before) stdout.write(sentinel.before + '\n')
				log(`node exited with code ${sentinel.exitCode}`)
				finish(() => resolve(sentinel.exitCode))
				return
			}
			stdout.write(line + '\n')
		})
		child.stdout.setEncoding('utf8').on('data', lines.push)
		child.stderr.setEncoding('utf8').on('data', (d) => (launchStderr += d))

		const timer = setTimeout(() => {
			finish(() => {
				exec('xcrun', ['simctl', 'terminate', device.udid, APP_ID], {
					timeoutMs: 15_000,
				}).catch(() => {})
				reject(new Timeout({ seconds: String(timeoutSeconds) }))
			})
		}, timeoutSeconds * 1000)

		child.on('error', (err) => finish(() => reject(err)))
		child.on('close', (code) => {
			lines.flush()
			if (done) return
			if (launchStderr.trim()) process.stderr.write(launchStderr)
			finish(() =>
				reject(
					launched
						? new AppCrashed()
						: new LaunchFailed({ reason: `simctl launch exited with ${code}` }),
				),
			)
		})
	})
}
