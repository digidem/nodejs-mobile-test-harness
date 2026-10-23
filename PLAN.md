# Plan: nodejs-mobile-test-harness

Extract the nodejs-mobile test harness from
[digidem/nodejs-mobile-bare-prebuilds](https://github.com/digidem/nodejs-mobile-bare-prebuilds)
into its own npm package with a CLI, then move its two consumers onto it.
Delete this file once phase 1 is merged.

Local checkouts (siblings of this folder):

- `../nodejs-mobile-bare-prebuilds` — the source, at commit `1d54df7`.
- `../comapeo-resvg` — the first consumer (phase 2).

## Why

The harness (a minimal iOS app and Android app that embed nodejs-mobile, run a
`main.js`, and report node's exit code) is runtime-generic, but it lives in a
repo about building Holepunch `bare-make` prebuilds, and only works in the
directory layout that repo's reusable workflows create. Consumers that build
their own addons copy its run logic into local scripts and fake that layout:
`comapeo-resvg/scripts/run-{ios,android}.sh` and the same pair in
`digidem/better-sqlite3-nodejs-mobile-benchmarks`. The simulator pick, the
`simctl launch | awk` sentinel parse, runtime placement and the
xcodebuild/gradle calls exist in three copies.

## Decisions (settled; don't revisit)

- **Name**: npm `nodejs-mobile-test-harness`, repo
  `digidem/nodejs-mobile-test-harness`, bin `nodejs-mobile-test`.
- **Scope of what moves**: the two apps, the build/install/launch/exit-code
  logic, and `wrapper.js`. Project assembly (`assemble-test-project`: npm
  install by spec, `smoke`/`module`/`custom` runners, upstream test overlay)
  stays in bare-prebuilds.
- **Language**: the runner is Node, not bash. `run-test.sh` is ported, not
  copied, which drops the bash 4 / GNU coreutils requirement.
- **Tooling**: scaffold with the `npm-module` skill's defaults (load it first).
- **History**: fresh copy. The first commit's message names the source repo and
  commit `1d54df7`.
- **Devices**: iOS simulator; any adb-reachable Android device (emulator or
  physical, chosen by `--serial` or `ANDROID_SERIAL`). No physical iOS devices.
- **Runtime**: download a pinned default digidem/nodejs-mobile release
  (`24.19.0-0`) into a per-user cache; `--nodejs-mobile <version>` overrides the
  version, `--runtime-dir <path>` uses an already-unpacked release instead.
- **Project contract**: input is a directory with an entry file (`test.js`,
  `--entry` to change). The tool writes its own `main.js` (the exit-sentinel
  wrapper, requiring the entry) and copies the directory into the app.
- **Gradle**: ship the Gradle wrapper; `gradle` on `PATH` is no longer needed.
- **App identity**: fixed and internal, `com.awana.nodejstest`, not
  configurable.
- **CLI shape**: `nodejs-mobile-test ios [dir]` and
  `nodejs-mobile-test android [dir]`; build and run by default, `--build-only`
  and `--run-only` split them. A small JS API (`runIos`, `runAndroid`) is what
  the CLI wraps.
- **Device lifecycle**: iOS boots a simulator by name or UDID (newest runtime
  for a name) and leaves it booted. Android uses an attached device; with
  `--avd <name>` and nothing attached it boots that AVD headless and shuts it
  down afterwards only if it booted it.
- **Failure detection on both platforms**: an overall timeout (default 20 min,
  `--timeout`) and an immediate failure when the app process dies without the
  sentinel. iOS has neither today.
- **File locations**: runtime downloads in a per-user cache shared across
  projects (`~/Library/Caches/nodejs-mobile-test-harness` on macOS,
  `$XDG_CACHE_HOME/nodejs-mobile-test-harness` or `~/.cache/...` on Linux).
  App copies and build output in the consumer's
  `node_modules/.cache/nodejs-mobile-test-harness/`.
- **Output**: app output (TAP) to stdout unmodified; the tool's own progress
  and errors to stderr prefixed `[nodejs-mobile-test]`.
- **Exit code**: node's exit code when the sentinel is seen. Build failure,
  crash, timeout or missing sentinel exit 1 with a stderr message naming which.
- **Versioning**: first version `1.0.0-pre.0`, published under the `next`
  dist-tag; `latest` stays empty until 1.0.0, after phase 3. The agent prepares
  releases; Gregor publishes.
- **Own CI**: on every PR and push, build both apps and run the fixtures on the
  iOS simulator and Android emulators at API 24 and 30.
- **Fixtures**: three projects — passes (exit 0, some TAP), fails (exit 1),
  crashes natively (`process.abort()`). Testing a real native addon is left to
  consumers.

## Phase 1: the package

One PR in this repo (`git init` here; Gregor creates the GitHub repo).

1. Scaffold with the `npm-module` skill: ESM, MIT licence ("Awana Digital"),
   `bin`, the skill's lint/test/CI/release setup. Done when `npm test` runs an
   empty suite green.
2. Copy the apps from `../nodejs-mobile-bare-prebuilds/test-harness/{ios,android}`
   (skip `build/`, `.cxx/`, `.gradle/`, `.DS_Store`, and anything gitignored
   there). Rename the identity to `com.awana.nodejstest` everywhere it appears:
   `PRODUCT_BUNDLE_IDENTIFIER` (twice in `project.pbxproj`), `namespace` and
   `applicationId` in `app/build.gradle`, the Java package and its directory
   (`java/com/awana/nodejstest/`), and the two JNI symbols in `native-lib.cpp`
   (`Java_com_awana_nodejstest_TestActivity_*`). Add the Gradle wrapper
   (`gradle wrapper --gradle-version 8.9`; that's the version CI uses today).
   Done when `grep -r digidem` over the app trees finds nothing and both apps
   build by hand per their READMEs.
3. Runtime fetch: resolve the release URL as
   `scripts/nodejs-mobile-url.sh` does (`vX.Y.Z-R` tags only; reject the v18
   line), download, unzip into the cache keyed by version, reuse on the next
   run. iOS needs `NodeMobile.xcframework`; Android needs `include/` and
   `bin/<abi>/libnode.so`. Done when a second run makes no network request and
   `--runtime-dir` skips the cache entirely.
4. Build: copy the app template into the consumer's cache dir, populate the
   runtime and `nodejs-project/` (the user's dir plus the generated `main.js`),
   then run xcodebuild (flags as in `test-ios.yml`) or `./gradlew
-PabiFilter=<abi> :app:assembleDebug`. Rebuild only what changed is not
   required; correctness over speed. Done when `--build-only` leaves an `.app` /
   `.apk` and prints its path.
5. Run on iOS: pick and boot the simulator, install, `simctl launch
--console-pty --terminate-running-process`, stream stdout, stop on the
   sentinel. Add the timeout and the dead-app check (poll that the app's
   process still exists, e.g. via `simctl spawn <udid> launchctl list` or
   `simctl listapps`/process check; choose what works and note why). Done when
   all three fixtures give the right exit code and the crash fixture fails
   within seconds, not at the timeout.
6. Run on Android: port `run-test.sh` to Node, keeping every behaviour listed
   under "Android runner behaviours" below. Add `--avd` booting and
   `--serial`. Done when all three fixtures give the right exit code on API 24
   and API 30, including the crash fixture failing fast.
7. CLI and JS API: argument parsing, `--help`, defaults as in Decisions. Done
   when `--help` lists every flag in Decisions and README.
8. CI: the repo's own workflow runs the fixtures on `macos-26` (iOS) and
   `ubuntu-latest` with `reactivecircus/android-emulator-runner` (API 24
   `google_apis`, API 30 `google_atd`; see `../comapeo-resvg/.github/workflows/ci.yml`
   for the KVM step, disk size and the retry-once pattern for flaky API 24
   boots). The emulator runner's `script:` must be one line:
   `npx nodejs-mobile-test android --run-only ...`. Done when CI is green on
   the PR.
9. README: what it is, requirements (Xcode; Android SDK with the NDK version
   the app's `build.gradle` pins and an emulator image; Java 17), CLI usage,
   the project contract, the JS API, the CI recipe. Short.
10. Release prep: version `1.0.0-pre.0`, the release tooling from step 1
    configured for the `next` dist-tag. Stop there; Gregor publishes.

## Phase 2: comapeo-resvg

One PR in `../comapeo-resvg`, against the published `1.0.0-pre.0` (or a
`file:` link while waiting, swapped before merge).

- Add the package as a devDependency.
- Delete `scripts/run-ios.sh` and `scripts/run-android.sh`.
- `scripts/assemble-project.sh`: drop `HARNESS_REPO` and the `wrapper.js`
  copy; drop the `BENCH=1` copy of `bench.js` over `test.js` (callers pass
  `--entry bench.js` instead).
- Runs use `--runtime-dir vendor-runtime/<platform>` so the runtime that the
  addon links against is the one it's tested on.
- `.github/workflows/ci.yml`: remove the harness checkout and `HARNESS_REPO`
  from both test jobs; the Gradle setup step goes too.
- README and AGENTS.md: replace the sibling-checkout instructions and the
  bash 4 / coreutils requirement with the new commands; update the "Bumping
  versions" list (the harness version is now in `package.json`).

Done when the iOS and both Android jobs pass on a manual dispatch.

## Phase 3: nodejs-mobile-bare-prebuilds

One PR in `../nodejs-mobile-bare-prebuilds`. The `@v3` inputs of
`test-ios.yml` and `test-android.yml` stay as they are; the
`*-nodejs-mobile` repos call them.

- `assemble-test-project` writes the project dir and no longer places
  `main.js` (`wrapper.js` is deleted).
- The workflows call `npx nodejs-mobile-test-harness@<exact version>`
  for build and run, with a new optional `harness_version` input that replaces
  `harness_ref`. The runtime download steps and their caches go.
- Delete `test-harness/` and the iOS/Android run logic from the workflows.
- README: point at the new package for the harness.

Done when the repo's own `ci.yml` and a manual `test.yml` dispatch (both
platforms) pass. Then cut 1.0.0 of the harness and move it to `latest`.

Follow-up, out of scope: `digidem/better-sqlite3-nodejs-mobile-benchmarks`
has its own copy of the run scripts and can switch the same way as phase 2.

## Android runner behaviours

`../nodejs-mobile-bare-prebuilds/test-harness/android/run-test.sh` carries
fixes for real CI hangs; its comments explain each. The Node port keeps all of
them:

- Start `adb logcat -c` then `adb logcat -v raw -s NODEJS-MOBILE:V nodejs:V
System.err:W AndroidRuntime:E` **before** launching, so early output isn't
  lost. The extra tags are where uncaught exceptions, missing-asset errors and
  Java crashes show up.
- Launch with `adb shell am start -n <id>/.TestActivity` **without** `-W`,
  bounded to 60 s: `-W` hangs forever on a wedged emulator.
- When logcat is quiet for 10 s, check `adb shell pidof -s <id>` bounded to
  15 s. Gone (and adb answered) means the app died: fail now and print
  `adb logcat -d -t 100 -b crash`. adb itself timing out means the emulator
  is wedged; keep waiting for the overall timeout.
- On exit, kill the logcat client process itself; a surviving one holds an
  adb connection that has hung android-emulator-runner's teardown.
- Install with `adb install -r -g`; wait for `sys.boot_completed` first.

The native side matters too: `native-lib.cpp` drains the stdout/stderr pump
threads before writing the sentinel (commit `0b3d27c`), so the last lines of
output aren't lost. Keep that when renaming the JNI symbols.

## iOS notes

- `wrapper.js` exists because `process.exit()` calls libc `exit()` and kills
  the app before native code after `node_start` runs; `process.on('exit')`
  prints the sentinel first. The generated `main.js` keeps this.
- `--console-pty` blocks until the app terminates; stop reading at the
  sentinel instead of waiting for it.
- Simulator choice by name: newest runtime wins (see `run-ios.sh` in
  comapeo-resvg for a Node implementation).
- The pbxproj expects `NodeMobile/NodeMobile.xcframework` and
  `nodejs-project/` next to it.
