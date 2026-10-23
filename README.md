# nodejs-mobile-test-harness

[![npm version](https://img.shields.io/npm/v/nodejs-mobile-test-harness.svg)](https://www.npmjs.com/package/nodejs-mobile-test-harness)
[![Devices](https://github.com/digidem/nodejs-mobile-test-harness/actions/workflows/devices.yml/badge.svg)](https://github.com/digidem/nodejs-mobile-test-harness/actions/workflows/devices.yml)

Runs a Node project inside [nodejs-mobile](https://github.com/digidem/nodejs-mobile)
on an iOS simulator or an Android device or emulator, and exits with node's exit
code. Use it to test native addons and other code on the runtime it will ship
on.

It builds a minimal iOS or Android app that embeds nodejs-mobile and your
project, installs and launches it, streams the app's output to stdout (so TAP
output can be piped to a reporter), and exits when node does. A crash, a hang
past the timeout, or a failed build exits 1, with the reason on stderr.

## Requirements

- Node 22 or later, and `unzip`.
- iOS: macOS with Xcode and an iOS simulator runtime.
- Android: the Android SDK (`ANDROID_HOME`, or the default install location)
  with platform 34, NDK `26.3.11579264` (the version `android/app/build.gradle`
  pins), and an emulator image or a device reachable over adb; Java 17. Gradle
  comes with the package.

## Usage

```sh
npm install --save-dev nodejs-mobile-test-harness

npx nodejs-mobile-test ios path/to/project
npx nodejs-mobile-test android path/to/project
```

| Option                      | Applies to | Default                                                     |
| --------------------------- | ---------- | ----------------------------------------------------------- |
| `--entry <file>`            | both       | `test.js`                                                   |
| `--nodejs-mobile <version>` | both       | `24.19.0-0`                                                 |
| `--runtime-dir <path>`      | both       | download the release into a per-user cache                  |
| `--timeout <seconds>`       | both       | `1200`, counted from launch                                 |
| `--build-only`              | both       | build, print the app's path to stdout, stop                 |
| `--run-only`                | both       | run the app from the last build                             |
| `--simulator <name\|udid>`  | iOS        | a booted simulator, else the first iPhone on the newest iOS |
| `--serial <serial>`         | Android    | `ANDROID_SERIAL`, else the only attached device             |
| `--avd <name>`              | Android    | boot this AVD headless if nothing is attached               |
| `--abi <abi>`               | Android    | the device's ABI; with `--build-only`, the host's           |

The simulator is booted if needed and left running. An
AVD booted because of `--avd` is shut down when the run ends.

The nodejs-mobile release is downloaded once per version into
`~/Library/Caches/nodejs-mobile-test-harness` (macOS) or
`$XDG_CACHE_HOME/nodejs-mobile-test-harness` (Linux, default `~/.cache`). Use
`--runtime-dir` to point at an unpacked release instead, for example the one
your addon was built against. App copies and build output go in
`node_modules/.cache/nodejs-mobile-test-harness/` under the current directory.

## The project

The project is a directory with an entry file, `test.js` unless you pass
`--entry`. The whole directory, including its `node_modules/`, is copied into
the app as `nodejs-project/`, next to a generated `main.js` that loads the entry
file. Don't name your entry `main.js`. The entry may be CommonJS or ESM.

Native addons must be built for the target (`ios-arm64` for the simulator,
`android-arm64` or `android-x64` for Android) and placed where their loader
looks, usually `node_modules/<addon>/prebuilds/<platform>-<arch>/`.

The process exits with whatever exit code node reports. `process.exitCode` and
`process.exit()` both work; a native crash without an exit code exits 1.

## JavaScript API

```js
import { runAndroid, runIos } from 'nodejs-mobile-test-harness'

const { exitCode, appPath } = await runIos({ projectDir: 'nodejs-project' })
```

`runIos(options)` and `runAndroid(options)` take the CLI options in camelCase
(`projectDir`, `entry`, `nodejsMobileVersion`, `runtimeDir`, `timeout`,
`buildOnly`, `runOnly`, plus `simulator`, or `serial`, `avd` and `abi`), along
with `cwd` for the cache location and `stdout`, a writable stream for the app's
output. They resolve to `{ appPath, exitCode }`; `exitCode` is absent with
`buildOnly`. Failures reject with one of the exported error classes, such as
`AppCrashed`, `Timeout` or `BuildFailed`, each with a stable `code`.

## In GitHub Actions

iOS needs a macOS runner:

```yaml
- run: npx nodejs-mobile-test ios nodejs-project
```

On Android, build before the emulator boots, then run inside
[android-emulator-runner](https://github.com/ReactiveCircus/android-emulator-runner).
Its `script:` runs each line as a separate shell, so keep it to one line:

```yaml
- uses: actions/setup-java@v6
  with:
    distribution: temurin
    java-version: 17
- name: Enable KVM
  run: |
    echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
    sudo udevadm control --reload-rules
    sudo udevadm trigger --name-match=kvm
- run: npx nodejs-mobile-test android nodejs-project --build-only --abi x86_64
- uses: reactivecircus/android-emulator-runner@v2
  with:
    api-level: 30
    target: google_atd
    arch: x86_64
    disk-size: 4096M
    emulator-options: -no-snapshot -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim
    script: npx nodejs-mobile-test android --run-only
```

Older images (API 24 `google_apis`) sometimes hang on boot; this repo's
[`devices.yml`](.github/workflows/devices.yml) shows a retry-once pattern.

## License

MIT
