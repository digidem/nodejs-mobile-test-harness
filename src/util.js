import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const LOG_PREFIX = '[nodejs-mobile-test]'

/** @param {string} message */
export function log(message) {
	process.stderr.write(`${LOG_PREFIX} ${message}\n`)
}

/**
 * @typedef {object} ExecResult
 * @property {number | null} exitCode
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} timedOut
 */

/**
 * Run a command to completion, capturing its output. Never rejects for a
 * non-zero exit or a timeout; check the result. Rejects if the command can't
 * be spawned (e.g. not installed).
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs: number, cwd?: string, env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<ExecResult>}
 */
export function exec(command, args, { timeoutMs, cwd, env }) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		let stdout = ''
		let stderr = ''
		let timedOut = false
		child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d))
		child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d))
		const timer = setTimeout(() => {
			timedOut = true
			child.kill('SIGKILL')
		}, timeoutMs)
		child.on('error', (err) => {
			clearTimeout(timer)
			reject(err)
		})
		/** @param {number | null} exitCode */
		const done = (exitCode) => {
			clearTimeout(timer)
			// Our ends of the pipes would otherwise keep the CLI alive for as long
			// as a forked daemon holds theirs.
			child.stdout.destroy()
			child.stderr.destroy()
			resolve({ exitCode, stdout, stderr, timedOut })
		}
		child.on('close', done)
		// A forked daemon (the adb server) can hold the pipes open after the
		// command itself has exited, so `close` never comes.
		child.on('exit', (exitCode) => {
			setTimeout(() => done(exitCode), 1000).unref()
		})
	})
}

/**
 * Run a command with its stdout and stderr sent to our stderr, so build output
 * never mixes with the app output on stdout.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<number | null>} exit code
 */
export function execToStderr(command, args, { cwd, env } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, env, stdio: ['ignore', 2, 2] })
		const unregister = onInterrupt(() => child.kill('SIGTERM'))
		child.on('error', (err) => {
			unregister()
			reject(err)
		})
		child.on('close', (code) => {
			unregister()
			resolve(code)
		})
	})
}

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Per-user cache shared across projects, for runtime downloads.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {NodeJS.Platform} [platform]
 */
export function userCacheDir(env = process.env, platform = process.platform) {
	const base =
		platform === 'darwin'
			? path.join(os.homedir(), 'Library', 'Caches')
			: env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
	return path.join(base, 'nodejs-mobile-test-harness')
}

/**
 * Per-project cache for app copies and build output.
 *
 * @param {string} cwd
 */
export function projectCacheDir(cwd) {
	return path.resolve(
		cwd,
		'node_modules',
		'.cache',
		'nodejs-mobile-test-harness',
	)
}

/** @type {Set<() => unknown>} */
const interruptCleanups = new Set()

/**
 * Register cleanup for when the CLI is interrupted (SIGINT/SIGTERM), where
 * `finally` blocks don't run.
 *
 * @param {() => unknown} cleanup
 * @returns {() => void} unregisters it
 */
export function onInterrupt(cleanup) {
	interruptCleanups.add(cleanup)
	return () => interruptCleanups.delete(cleanup)
}

/** Run every registered cleanup, bounded. */
export async function runInterruptCleanups(timeoutMs = 30_000) {
	const cleanups = [...interruptCleanups]
	interruptCleanups.clear()
	const all = Promise.allSettled(cleanups.map(async (cleanup) => cleanup()))
	await Promise.race([all, sleep(timeoutMs)])
}
