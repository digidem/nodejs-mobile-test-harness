import { SENTINEL } from './project.js'

/**
 * Split a stream of chunks into lines, without the trailing `\r` a pty or old
 * adb adds.
 *
 * @param {(line: string) => void} onLine
 */
export function lineSplitter(onLine) {
	let buffered = ''
	return {
		/** @param {string} chunk */
		push(chunk) {
			buffered += chunk
			const lines = buffered.split('\n')
			buffered = lines.pop() ?? ''
			for (const line of lines) onLine(line.replace(/\r$/, ''))
		},
		flush() {
			if (buffered) onLine(buffered.replace(/\r$/, ''))
			buffered = ''
		},
	}
}

/**
 * The exit code from a sentinel line, and any app output that shared the line
 * (output written without a trailing newline before exit).
 *
 * @param {string} line
 * @returns {{ before: string, exitCode: number } | undefined}
 */
export function parseSentinel(line) {
	const i = line.indexOf(SENTINEL)
	if (i === -1) return
	const match = /^-?\d+/.exec(line.slice(i + SENTINEL.length))
	if (!match) return
	return { before: line.slice(0, i), exitCode: Number(match[0]) }
}

/**
 * Forward app output to `stdout` and watch for the exit sentinel. Node
 * reports its exit code before writing an uncaught exception's stack trace,
 * so after the sentinel output keeps flowing until it's quiet for `quietMs`,
 * the stream ends (`end()`), or `maxMs` passes; then `onExit` gets the code.
 *
 * @param {object} options
 * @param {NodeJS.WritableStream} options.stdout
 * @param {(exitCode: number) => void} options.onExit
 * @param {number} [options.quietMs]
 * @param {number} [options.maxMs]
 */
export function sentinelWatcher({
	stdout,
	onExit,
	quietMs = 1000,
	maxMs = 5000,
}) {
	/** @type {number | undefined} */
	let exitCode
	let finished = false
	/** @type {NodeJS.Timeout | undefined} */
	let quietTimer
	/** @type {NodeJS.Timeout | undefined} */
	let maxTimer

	const stop = () => {
		clearTimeout(quietTimer)
		clearTimeout(maxTimer)
	}
	const finish = () => {
		if (finished || exitCode === undefined) return
		finished = true
		stop()
		onExit(exitCode)
	}
	const armQuiet = () => {
		clearTimeout(quietTimer)
		quietTimer = setTimeout(finish, quietMs)
	}

	return {
		/** @param {string} line */
		line(line) {
			if (finished) return
			const sentinel = parseSentinel(line)
			if (sentinel) {
				if (sentinel.before) stdout.write(sentinel.before + '\n')
				if (exitCode === undefined) {
					exitCode = sentinel.exitCode
					maxTimer = setTimeout(finish, maxMs)
					armQuiet()
				}
				return
			}
			stdout.write(line + '\n')
			if (exitCode !== undefined) armQuiet()
		},
		/** The app's output ended. */
		end: finish,
		/** Clear the timers without reporting. */
		stop,
		get exitCode() {
			return exitCode
		},
	}
}
