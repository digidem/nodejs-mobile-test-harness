---
'@digidem/nodejs-mobile-test-harness': patch
---

Report the exit code a test framework sets in its own exit listener (tape reports failures this way; they were counted as passes), and keep an uncaught exception's stack trace in the output. The CLI no longer stays running after it had to start the adb server, cleans up on Ctrl-C or SIGTERM, fails when it can't clear logcat, skips broken symlinks in the project, prints the app path to stdout with `--build-only`, and allows ten minutes for a simulator to boot.
