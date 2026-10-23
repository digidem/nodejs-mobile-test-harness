import fs from 'node:fs'
import path from 'node:path'

import { InvalidProject } from './errors.js'

export const APP_ID = 'com.awana.nodejstest'
export const SENTINEL = '__NODE_EXIT__:'

// Xcode's build service can still be writing to a previous build's output.
const RM_OPTIONS = {
	recursive: true,
	force: true,
	maxRetries: 10,
	retryDelay: 200,
}

const PACKAGE_ROOT = path.join(import.meta.dirname, '..')

// Build output and runtime slots that must never be copied out of a template.
const TEMPLATE_SKIP = new Set([
	'build',
	'.gradle',
	'.cxx',
	'.DS_Store',
	'DerivedData',
	'xcuserdata',
	'local.properties',
	'NodeMobile',
	'nodejs-project',
	'libnode',
	'assets',
])

/**
 * The generated entry. `process.exit()` calls libc `exit()` and kills the app
 * before the native code after `node_start` runs, so the sentinel is printed
 * from `process.on('exit')`. `import()` parses as both CJS and ESM, so the
 * project's `package.json` `type` doesn't matter.
 *
 * @param {string} entry
 */
export function mainJs(entry) {
	const specifier = './' + entry.split(path.sep).join('/')
	return `process.on('exit', (code) => {
	process.stdout.write('${SENTINEL}' + code + '\\n')
})

import(${JSON.stringify(specifier)})
`
}

/**
 * @param {string} projectDir
 * @param {string} entry
 */
export function assertProject(projectDir, entry) {
	if (!fs.statSync(projectDir, { throwIfNoEntry: false })?.isDirectory()) {
		throw new InvalidProject({ reason: `${projectDir} is not a directory` })
	}
	const normalized = path.normalize(entry)
	if (path.isAbsolute(normalized) || normalized.startsWith('..')) {
		throw new InvalidProject({
			reason: `entry ${entry} must be inside the project directory`,
		})
	}
	if (normalized === 'main.js') {
		throw new InvalidProject({
			reason: 'the entry cannot be main.js; the tool writes its own main.js',
		})
	}
	if (!fs.existsSync(path.join(projectDir, normalized))) {
		throw new InvalidProject({
			reason: `entry ${entry} not found in ${projectDir}`,
		})
	}
}

/**
 * Replace `dest` with a fresh copy of the platform's app template.
 *
 * @param {'ios' | 'android'} platform
 * @param {string} dest
 */
export function copyTemplate(platform, dest) {
	fs.rmSync(dest, RM_OPTIONS)
	fs.cpSync(path.join(PACKAGE_ROOT, platform), dest, {
		recursive: true,
		filter: (src) => !TEMPLATE_SKIP.has(path.basename(src)),
	})
}

/**
 * Copy the user's project into the app and write the generated `main.js`.
 *
 * @param {object} options
 * @param {string} options.projectDir
 * @param {string} options.entry
 * @param {string} options.dest the app's `nodejs-project/` directory
 * @param {string} options.cacheRoot excluded, in case it lives inside the project
 */
export function writeNodejsProject({ projectDir, entry, dest, cacheRoot }) {
	fs.rmSync(dest, RM_OPTIONS)
	copyProjectTree(path.resolve(projectDir), dest, cacheRoot)
	fs.writeFileSync(path.join(dest, 'main.js'), mainJs(path.normalize(entry)))
}

/**
 * `fs.cpSync` refuses to copy a directory into its own subtree even when a
 * filter would skip it, which is the usual layout (`dir` is `.` and the app
 * copy lives in its `node_modules/.cache/`). Symlinks are followed: the app
 * bundle can't hold links that point outside it.
 *
 * @param {string} src
 * @param {string} dest
 * @param {string} skip
 */
function copyProjectTree(src, dest, skip) {
	fs.mkdirSync(dest, { recursive: true })
	for (const name of fs.readdirSync(src)) {
		const from = path.join(src, name)
		if (from === skip || name === '.git') continue
		// Tool caches, ours included; never needed in the app.
		if (name === '.cache' && path.basename(src) === 'node_modules') continue
		const to = path.join(dest, name)
		if (fs.statSync(from).isDirectory()) copyProjectTree(from, to, skip)
		else fs.copyFileSync(from, to)
	}
}
