#!/usr/bin/env node
import fs from 'node:fs'
import { parseArgs } from 'node:util'

import { ABIS } from './android.js'
import {
	DEFAULT_ENTRY,
	DEFAULT_NODEJS_MOBILE_VERSION,
	DEFAULT_TIMEOUT_SECONDS,
	runAndroid,
	runIos,
} from './index.js'
import { log } from './util.js'

const HELP = `Usage: nodejs-mobile-test <ios|android> [dir] [options]

Builds [dir] (default: .) into a test app that embeds nodejs-mobile, runs it
on an iOS simulator or Android device, and exits with node's exit code. App
output goes to stdout; the tool's own messages go to stderr.

Options:
  --entry <file>             file in [dir] to run (default: ${DEFAULT_ENTRY})
  --nodejs-mobile <version>  digidem/nodejs-mobile release to download
                             (default: ${DEFAULT_NODEJS_MOBILE_VERSION})
  --runtime-dir <path>       use an already-unpacked nodejs-mobile release
                             instead of downloading one
  --timeout <seconds>        how long to wait for node to exit after launch
                             (default: ${DEFAULT_TIMEOUT_SECONDS})
  --build-only               build the app, print its path and stop
  --run-only                 run the app from the last build
  -h, --help                 show this help
  -v, --version              show the version

iOS:
  --simulator <name|udid>    simulator to boot; a name picks the newest
                             runtime (default: a booted simulator, else the
                             first iPhone on the newest runtime)

Android:
  --serial <serial>          device to use (default: ANDROID_SERIAL, else the
                             only attached device)
  --avd <name>               AVD to boot headless when nothing is attached;
                             shut down afterwards
  --abi <abi>                ${ABIS.join(', ')}
                             (default: the device's; with --build-only, the
                             host's architecture)

Exit code: node's exit code, or 1 when the build fails, the app crashes, the
timeout passes or node's exit is never reported.
`

/** @param {string[]} argv */
export async function main(argv) {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			entry: { type: 'string' },
			'nodejs-mobile': { type: 'string' },
			'runtime-dir': { type: 'string' },
			timeout: { type: 'string' },
			'build-only': { type: 'boolean' },
			'run-only': { type: 'boolean' },
			simulator: { type: 'string' },
			serial: { type: 'string' },
			avd: { type: 'string' },
			abi: { type: 'string' },
			help: { type: 'boolean', short: 'h' },
			version: { type: 'boolean', short: 'v' },
		},
	})

	if (values.help) {
		process.stdout.write(HELP)
		return 0
	}
	if (values.version) {
		const pkg = JSON.parse(
			fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
		)
		process.stdout.write(pkg.version + '\n')
		return 0
	}

	const [platform, projectDir, ...extra] = positionals
	if ((platform !== 'ios' && platform !== 'android') || extra.length) {
		process.stderr.write(HELP)
		return 1
	}
	if (values['build-only'] && values['run-only']) {
		throw new TypeError('--build-only and --run-only are mutually exclusive')
	}
	const timeout =
		values.timeout === undefined ? undefined : Number(values.timeout)
	if (timeout !== undefined && !(timeout > 0)) {
		throw new TypeError(
			`--timeout must be a positive number of seconds, got ${values.timeout}`,
		)
	}
	const iosOnly = ['simulator'].filter((k) => k in values)
	const androidOnly = ['serial', 'avd', 'abi'].filter((k) => k in values)
	const wrong = platform === 'ios' ? androidOnly : iosOnly
	if (wrong.length) {
		throw new TypeError(`--${wrong[0]} does not apply to ${platform}`)
	}

	const common = {
		projectDir,
		entry: values.entry,
		nodejsMobileVersion: values['nodejs-mobile'],
		runtimeDir: values['runtime-dir'],
		timeout,
		buildOnly: values['build-only'],
		runOnly: values['run-only'],
	}
	const result =
		platform === 'ios'
			? await runIos({ ...common, simulator: values.simulator })
			: await runAndroid({
					...common,
					serial: values.serial,
					avd: values.avd,
					abi: values.abi,
				})
	return result.exitCode ?? 0
}

try {
	process.exitCode = await main(process.argv.slice(2))
} catch (err) {
	log(`error: ${err instanceof Error ? err.message : String(err)}`)
	process.exitCode = 1
}
