import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
	AppCrashed,
	AppNotBuilt,
	BuildFailed,
	CommandFailed,
	DeviceNotFound,
	DeviceTimeout,
	InvalidProject,
	MissingSentinel,
	Timeout,
} from './errors.js'
import { APP_ID, copyTemplate, writeNodejsProject } from './project.js'
import { assertRuntimeDir } from './runtime.js'
import { lineSplitter, sentinelWatcher } from './sentinel.js'
import { exec, execToStderr, log, onInterrupt, sleep } from './util.js'

export const ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86']

const ADB_TIMEOUT_S = 15
const BOOT_TIMEOUT_S = 300
const INSTALL_TIMEOUT_S = 300
const LAUNCH_TIMEOUT_S = 60
const QUIET_S = 10

/** @param {NodeJS.ProcessEnv} [env] */
function androidSdkRoot(env = process.env) {
	const fromEnv = env.ANDROID_HOME || env.ANDROID_SDK_ROOT
	if (fromEnv) return fromEnv
	const guess =
		process.platform === 'darwin'
			? path.join(os.homedir(), 'Library', 'Android', 'sdk')
			: path.join(os.homedir(), 'Android', 'Sdk')
	return fs.existsSync(guess) ? guess : undefined
}

/** @param {'platform-tools' | 'emulator'} dir @param {string} name */
function sdkTool(dir, name) {
	const sdk = androidSdkRoot()
	const p = sdk && path.join(sdk, dir, name)
	return p && fs.existsSync(p) ? p : name
}

/** Emulators match the host's architecture. */
export function hostAbi() {
	return process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'
}

/** @param {string} cacheRoot */
function androidAppDir(cacheRoot) {
	return path.join(cacheRoot, 'android')
}

/** @param {string} cacheRoot */
export function apkPath(cacheRoot) {
	return path.join(
		androidAppDir(cacheRoot),
		'app',
		'build',
		'outputs',
		'apk',
		'debug',
		'app-debug.apk',
	)
}

/**
 * @param {object} options
 * @param {string} options.projectDir
 * @param {string} options.entry
 * @param {string} options.runtimeDir unpacked nodejs-mobile Android release
 * @param {string} options.abi
 * @param {string} options.cacheRoot
 * @returns {Promise<string>} path to the built `.apk`
 */
export async function buildAndroid({
	projectDir,
	entry,
	runtimeDir,
	abi,
	cacheRoot,
}) {
	if (!ABIS.includes(abi)) {
		throw new InvalidProject({
			reason: `unknown ABI ${abi} (expected one of ${ABIS.join(', ')})`,
		})
	}
	assertRuntimeDir(runtimeDir, 'android', abi)
	const appDir = androidAppDir(cacheRoot)
	log(`preparing ${appDir}`)
	copyTemplate('android', appDir)
	// npm doesn't keep the executable bit on every platform.
	fs.chmodSync(path.join(appDir, 'gradlew'), 0o755)
	const libnode = path.join(appDir, 'app', 'libnode')
	fs.cpSync(path.join(runtimeDir, 'include'), path.join(libnode, 'include'), {
		recursive: true,
	})
	fs.mkdirSync(path.join(libnode, 'bin', abi), { recursive: true })
	fs.copyFileSync(
		path.join(runtimeDir, 'bin', abi, 'libnode.so'),
		path.join(libnode, 'bin', abi, 'libnode.so'),
	)
	writeNodejsProject({
		projectDir,
		entry,
		dest: path.join(appDir, 'app', 'src', 'main', 'assets', 'nodejs-project'),
		cacheRoot,
	})

	log(`building app-debug.apk for ${abi} (gradle)`)
	const env = { ...process.env }
	const sdk = androidSdkRoot()
	if (sdk && !env.ANDROID_HOME) env.ANDROID_HOME = sdk
	const exitCode = await execToStderr(
		'./gradlew',
		['--no-daemon', '-q', `-PabiFilter=${abi}`, ':app:assembleDebug'],
		{ cwd: appDir, env },
	)
	if (exitCode !== 0)
		throw new BuildFailed({ command: 'gradlew', exitCode: String(exitCode) })
	const apk = apkPath(cacheRoot)
	if (!fs.existsSync(apk)) throw new AppNotBuilt({ path: apk })
	log(`built ${apk}`)
	return apk
}

/**
 * @param {string | undefined} serial
 * @param {string[]} args
 * @param {number} [timeoutS]
 */
function adb(serial, args, timeoutS = ADB_TIMEOUT_S) {
	const fullArgs = serial ? ['-s', serial, ...args] : args
	return exec(sdkTool('platform-tools', 'adb'), fullArgs, {
		timeoutMs: timeoutS * 1000,
	})
}

/**
 * `adb devices` output → serial and state of each device.
 *
 * @param {string} output
 */
export function parseAdbDevices(output) {
	return output
		.split('\n')
		.slice(1)
		.map((line) => line.trim().split(/\s+/))
		.filter((parts) => parts.length >= 2 && parts[0])
		.map(([serial, state]) => ({ serial, state }))
}

async function listDevices() {
	const res = await adb(undefined, ['devices'], 30)
	if (res.timedOut)
		throw new DeviceTimeout({ step: 'adb devices', seconds: '30' })
	if (res.exitCode !== 0)
		throw new CommandFailed({ command: 'adb devices', output: res.stderr })
	return parseAdbDevices(res.stdout)
}

/**
 * @typedef {object} AndroidDevice
 * @property {string} serial
 * @property {() => Promise<void>} release shuts the emulator down if this run booted it
 */

/**
 * Pick the device to run on: `serial` (or `ANDROID_SERIAL`), else the one
 * attached device, else boot `avd` headless.
 *
 * @param {object} options
 * @param {string} [options.serial]
 * @param {string} [options.avd]
 * @param {string} options.cacheRoot for the emulator log
 * @returns {Promise<AndroidDevice>}
 */
export async function acquireDevice({
	serial = process.env.ANDROID_SERIAL,
	avd,
	cacheRoot,
}) {
	const devices = await listDevices()
	const release = async () => {}
	if (serial) {
		const found = devices.find((d) => d.serial === serial)
		if (found?.state === 'device') return { serial, release }
		if (!found && avd) {
			if (!/^emulator-\d+$/.test(serial)) {
				throw new DeviceNotFound({
					reason: `${serial} is not attached, and --avd can only boot on an emulator-<port> serial`,
				})
			}
			return bootAvd(avd, devices, cacheRoot, serial)
		}
		throw new DeviceNotFound({
			reason: found
				? `${serial} is ${found.state}`
				: `${serial} is not attached`,
		})
	}
	const ready = devices.filter((d) => d.state === 'device')
	if (ready.length === 1) return { serial: ready[0].serial, release }
	if (ready.length > 1) {
		throw new DeviceNotFound({
			reason: `several devices attached (${ready.map((d) => d.serial).join(', ')}); choose one with --serial`,
		})
	}
	if (avd) return bootAvd(avd, devices, cacheRoot)
	throw new DeviceNotFound({
		reason:
			'nothing attached; start an emulator, connect a device or pass --avd',
	})
}

/**
 * @param {string} avd
 * @param {{ serial: string }[]} devices
 * @param {string} cacheRoot
 * @param {string} [wantSerial] boot on this serial's port when it's `emulator-<port>`
 * @returns {Promise<AndroidDevice>}
 */
async function bootAvd(avd, devices, cacheRoot, wantSerial) {
	// A fixed console port makes the serial known up front.
	const wanted = /^emulator-(\d+)$/.exec(wantSerial ?? '')
	let port = wanted ? Number(wanted[1]) : 5554
	while (!wanted && devices.some((d) => d.serial === `emulator-${port}`))
		port += 2
	const serial = `emulator-${port}`
	fs.mkdirSync(cacheRoot, { recursive: true })
	const logFile = path.join(cacheRoot, 'emulator.log')
	const logFd = fs.openSync(logFile, 'w')
	log(`booting AVD ${avd} headless as ${serial} (log: ${logFile})`)
	// prettier-ignore
	const emulator = spawn(sdkTool('emulator', 'emulator'), [
		'-avd', avd, '-port', String(port),
		'-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot-save',
	], { stdio: ['ignore', logFd, logFd] })
	fs.closeSync(logFd)
	let exited = false
	emulator.on('exit', () => (exited = true))
	emulator.on('error', () => (exited = true))

	const release = async () => {
		unregister()
		if (exited) return
		log(`shutting down ${serial}`)
		await adb(serial, ['emu', 'kill'])
		for (let i = 0; i < 60 && !exited; i++) await sleep(500)
		if (!exited) emulator.kill('SIGKILL')
	}

	const unregister = onInterrupt(() => release())

	const deadline = Date.now() + BOOT_TIMEOUT_S * 1000
	while (Date.now() < deadline) {
		if (exited) {
			throw new CommandFailed({
				command: `emulator -avd ${avd}`,
				output: `exited early; see ${logFile}`,
			})
		}
		const res = await adb(serial, ['shell', 'getprop', 'sys.boot_completed'])
		if (res.stdout.trim() === '1') return { serial, release }
		await sleep(2000)
	}
	await release()
	throw new DeviceTimeout({
		step: `booting ${avd}`,
		seconds: String(BOOT_TIMEOUT_S),
	})
}

/** @param {string} serial */
async function waitForBoot(serial) {
	const deadline = Date.now() + BOOT_TIMEOUT_S * 1000
	while (Date.now() < deadline) {
		const res = await adb(serial, ['shell', 'getprop', 'sys.boot_completed'])
		if (res.stdout.trim() === '1') return
		await sleep(1000)
	}
	throw new DeviceTimeout({
		step: 'waiting for sys.boot_completed',
		seconds: String(BOOT_TIMEOUT_S),
	})
}

/** @param {string} serial */
export async function deviceAbi(serial) {
	const res = await adb(serial, ['shell', 'getprop', 'ro.product.cpu.abi'])
	const abi = res.stdout.trim()
	if (res.timedOut || !abi) {
		throw new CommandFailed({
			command: 'getprop ro.product.cpu.abi',
			output: res.stderr.trim(),
		})
	}
	return abi
}

/**
 * Install and launch the app, stream logcat until the exit sentinel. Keeps
 * every hang fix from nodejs-mobile-bare-prebuilds' run-test.sh; see AGENTS.md
 * "Android runner behaviours".
 *
 * @param {object} options
 * @param {string} options.apkPath
 * @param {string} options.serial
 * @param {number} options.timeoutSeconds
 * @param {NodeJS.WritableStream} [options.stdout]
 * @returns {Promise<number>} node's exit code
 */
export async function runAndroidApp({
	apkPath,
	serial,
	timeoutSeconds,
	stdout = process.stdout,
}) {
	if (!fs.existsSync(apkPath)) throw new AppNotBuilt({ path: apkPath })
	await waitForBoot(serial)

	log(`installing app on ${serial}`)
	const install = await adb(
		serial,
		['install', '-r', '-g', apkPath],
		INSTALL_TIMEOUT_S,
	)
	if (install.timedOut)
		throw new DeviceTimeout({
			step: 'adb install',
			seconds: String(INSTALL_TIMEOUT_S),
		})
	if (install.exitCode !== 0) {
		throw new CommandFailed({
			command: 'adb install',
			output: (install.stdout + install.stderr).trim(),
		})
	}

	// Fail rather than continue: a stale buffer can hold an earlier run's
	// sentinel, which the new logcat client would replay.
	const clear = await adb(serial, ['logcat', '-c'])
	if (clear.timedOut || clear.exitCode !== 0) {
		throw new CommandFailed({
			command: 'adb logcat -c',
			output: clear.timedOut
				? `no answer within ${ADB_TIMEOUT_S}s`
				: (clear.stdout + clear.stderr).trim(),
		})
	}
	// Started before the launch so early output isn't lost. Beyond node's
	// stdout/stderr (NODEJS-MOBILE): `nodejs` carries libnode's fatal-error
	// reports (uncaught exceptions), System.err the asset-copy failures, and
	// AndroidRuntime Java crashes before node starts.
	// prettier-ignore
	const logcat = spawn(sdkTool('platform-tools', 'adb'), [
		'-s', serial, 'logcat', '-v', 'raw',
		'-s', 'NODEJS-MOBILE:V', 'nodejs:V', 'System.err:W', 'AndroidRuntime:E',
	], { stdio: ['ignore', 'pipe', 'ignore'] })
	const logcatClosed = new Promise((resolve) => logcat.on('close', resolve))
	const unregister = onInterrupt(() => logcat.kill('SIGKILL'))

	try {
		log('launching app')
		// No -W: it waits for the launch to complete, which hangs forever on a
		// wedged emulator. Bounded, and a stuck launch falls through to the
		// timeout below.
		const launch = await adb(
			serial,
			['shell', 'am', 'start', '-n', `${APP_ID}/.TestActivity`],
			LAUNCH_TIMEOUT_S,
		)
		if (launch.timedOut)
			log(`am start did not return within ${LAUNCH_TIMEOUT_S}s; still waiting`)

		const outcome = await watchLogcat({
			logcat,
			serial,
			timeoutSeconds,
			stdout,
		})
		if (outcome.kind === 'exit') {
			log(`node exited with code ${outcome.exitCode}`)
			return outcome.exitCode
		}
		if (outcome.kind === 'died') {
			log('recent crash log:')
			const crash = await adb(serial, [
				'logcat',
				'-d',
				'-t',
				'100',
				'-b',
				'crash',
			])
			process.stderr.write(crash.stdout)
			throw new AppCrashed()
		}
		if (outcome.kind === 'logcat-closed') {
			throw new MissingSentinel({
				reason: 'adb logcat stopped before the exit sentinel',
			})
		}
		await adb(serial, ['shell', 'am', 'force-stop', APP_ID])
		throw new Timeout({ seconds: String(timeoutSeconds) })
	} finally {
		unregister()
		// A surviving logcat client holds an adb connection open, which has
		// hung android-emulator-runner's teardown.
		logcat.kill('SIGTERM')
		const killed = await Promise.race([
			logcatClosed.then(() => true),
			sleep(2000).then(() => false),
		])
		if (!killed) logcat.kill('SIGKILL')
	}
}

/**
 * @typedef {{ kind: 'exit', exitCode: number } | { kind: 'died' } | { kind: 'timeout' } | { kind: 'logcat-closed' }} Outcome
 */

/**
 * @param {object} options
 * @param {import('node:child_process').ChildProcessByStdio<null, import('node:stream').Readable, null>} options.logcat
 * @param {string} options.serial
 * @param {number} options.timeoutSeconds
 * @param {NodeJS.WritableStream} options.stdout
 * @returns {Promise<Outcome>}
 */
function watchLogcat({ logcat, serial, timeoutSeconds, stdout }) {
	return new Promise((resolve) => {
		let done = false
		/** @type {NodeJS.Timeout | undefined} */
		let quietTimer
		/** @param {Outcome} outcome */
		const finish = (outcome) => {
			if (done) return
			done = true
			clearTimeout(quietTimer)
			clearTimeout(overall)
			watcher.stop()
			resolve(outcome)
		}

		const watcher = sentinelWatcher({
			stdout,
			onExit: (exitCode) => finish({ kind: 'exit', exitCode }),
		})
		const sentinelSeen = () => watcher.exitCode !== undefined

		// Logcat went quiet: tell "app died" from "emulator wedged". pidof answers
		// empty when the process is gone; adb itself timing out means the
		// emulator is wedged, so keep waiting for the overall timeout. Not after
		// the sentinel, when the app is meant to exit.
		const checkAlive = async () => {
			const res = await adb(serial, ['shell', 'pidof', '-s', APP_ID])
			if (done || sentinelSeen()) return
			if (!res.timedOut && !res.stdout.trim()) finish({ kind: 'died' })
			else armQuiet()
		}
		const armQuiet = () => {
			clearTimeout(quietTimer)
			if (!sentinelSeen()) quietTimer = setTimeout(checkAlive, QUIET_S * 1000)
		}

		const lines = lineSplitter((line) => {
			if (done || line.startsWith('--------- beginning of ')) return
			watcher.line(line)
		})
		logcat.stdout.setEncoding('utf8').on('data', (chunk) => {
			lines.push(chunk)
			if (!done) armQuiet()
		})
		logcat.on('close', () => {
			lines.flush()
			if (sentinelSeen()) watcher.end()
			else finish({ kind: 'logcat-closed' })
		})
		const overall = setTimeout(() => {
			if (sentinelSeen()) watcher.end()
			else finish({ kind: 'timeout' })
		}, timeoutSeconds * 1000)
		armQuiet()
	})
}
