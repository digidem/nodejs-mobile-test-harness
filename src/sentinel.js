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
