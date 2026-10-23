import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

export const LOG_PREFIX = '[nodejs-mobile-test]'

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
		child.on('close', (exitCode) => {
			clearTimeout(timer)
			resolve({ exitCode, stdout, stderr, timedOut })
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
		child.on('error', reject)
		child.on('close', resolve)
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
