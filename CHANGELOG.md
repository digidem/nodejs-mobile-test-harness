# nodejs-mobile-test-harness

## 1.0.0

### Patch Changes

- [#13](https://github.com/digidem/nodejs-mobile-test-harness/pull/13) [`a3f4a89`](https://github.com/digidem/nodejs-mobile-test-harness/commit/a3f4a8962af4efe9b0eb015639d79e142cf963b0) - First stable release, published to the `latest` dist-tag. No changes from 1.0.0-pre.2.

## 1.0.0-pre.2

### Patch Changes

- [#11](https://github.com/digidem/nodejs-mobile-test-harness/pull/11) [`ebca0c7`](https://github.com/digidem/nodejs-mobile-test-harness/commit/ebca0c7aeab64dfb6894d923d4b0f99a85db722e) - Publish prereleases to the `pre` dist-tag instead of `next`.

## 1.0.0-pre.1

### Patch Changes

- [#7](https://github.com/digidem/nodejs-mobile-test-harness/pull/7) [`32cf83c`](https://github.com/digidem/nodejs-mobile-test-harness/commit/32cf83c8bfb1a91778d63f750cdefd6d0129edd0) - On Android, lines of output longer than 2 KB, or split by a burst of output, now arrive whole instead of in two pieces; lines past logcat's 4 KB entry limit arrive in 4000-byte pieces rather than truncated.

- [#10](https://github.com/digidem/nodejs-mobile-test-harness/pull/10) [`b0b7ea4`](https://github.com/digidem/nodejs-mobile-test-harness/commit/b0b7ea491dd1fbbb2048ec412f1908edcd4e9425) - rename package to nodejs-mobile-test-harness

- [#6](https://github.com/digidem/nodejs-mobile-test-harness/pull/6) [`13e88e8`](https://github.com/digidem/nodejs-mobile-test-harness/commit/13e88e869306f45aef40470e8d720ef7fe6b38af) - Report the exit code a test framework sets in its own exit listener (tape reports failures this way; they were counted as passes), and keep an uncaught exception's stack trace in the output. The CLI no longer stays running after it had to start the adb server, cleans up on Ctrl-C or SIGTERM, fails when it can't clear logcat, skips broken symlinks in the project, prints the app path to stdout with `--build-only`, and allows ten minutes for a simulator to boot.

## 1.0.0-pre.0

First prerelease. The test apps and run logic come from
[digidem/nodejs-mobile-bare-prebuilds](https://github.com/digidem/nodejs-mobile-bare-prebuilds)
at `1d54df7`, behind a `nodejs-mobile-test` CLI and a `runIos` / `runAndroid`
API.
