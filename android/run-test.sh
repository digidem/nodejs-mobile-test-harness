#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner's `script:` input.
# That action runs each LINE of its `script:` input as a separate
# `sh -c` invocation, which loses variable state (and `set` flags)
# across lines. Putting the logic in this committed file keeps it a
# single line in the workflow and a single bash process at runtime.

set -euo pipefail

APK="${GITHUB_WORKSPACE}/.nodejs-mobile-bare-prebuilds/test-harness/android/app/build/outputs/apk/debug/app-debug.apk"
APP_ID=com.digidem.nodejstest
TIMEOUT_SECONDS=1200

adb wait-for-device shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done'
adb install -r -g "$APK"
adb logcat -c

# Run logcat as a coprocess so we can kill it explicitly once the sentinel
# is seen. (A plain `adb logcat | awk` pipeline hangs because adb only
# notices the pipe has closed when it next tries to write, and no further
# lines are coming once the app has exited.) Started BEFORE the launch so
# no early NODEJS-MOBILE output is missed.
#
# Tags beyond NODEJS-MOBILE (node's stdout/stderr, pumped by native-lib.cpp)
# carry failures that are otherwise invisible here, which makes a broken run
# look like silence:
#   nodejs        node's own fatal-error reports, logged by nodejs-mobile's
#                 libnode rather than through our stdout/stderr pipe — this is
#                 where an uncaught exception's message actually lands.
#   System.err    Java stack traces. TestActivity's asset copy catches and
#                 prints per-file failures, so a file missing on device (and a
#                 resulting "cannot find addon") is only explained here.
#   AndroidRuntime  uncaught Java exceptions killing the app before node starts.
# `-v raw` is kept so TAP output stays clean and the sentinel parsing below is
# unchanged; extra tags interleave without a prefix.
coproc LOGCAT { adb logcat -v raw -s NODEJS-MOBILE:V nodejs:V System.err:W AndroidRuntime:E; }

# Launch the activity. The app pumps node's stdout/stderr to logcat tag
# NODEJS-MOBILE and emits __NODE_EXIT__:<code> when done. Fire-and-forget,
# `timeout`-bounded: `am start -W` blocks until the launch completes, which
# hangs forever on a wedged emulator (seen on flaky API 24 images) — and
# that hang is BEFORE the watch loop, so neither the loop's per-read
# timeout nor its SECONDS budget can bound it. Drop -W and cap the dispatch
# so a stuck launch falls through to the loop, which fails on the timeout.
timeout 60 adb shell am start -n "$APP_ID/.TestActivity" || true
# Snapshot the coproc's PID and read FD: bash UNSETS LOGCAT_PID and
# LOGCAT[0] as soon as it reaps the terminated coprocess, so reading
# them later can trip `set -u` (observed when the app exits quickly).
logcat_pid="${LOGCAT_PID}"
logcat_fd="${LOGCAT[0]}"

EXIT_CODE=""
APP_DIED=""
SECONDS=0
while (( SECONDS < TIMEOUT_SECONDS )); do
  # Per-read timeout keeps the outer timeout check live even when logcat
  # is silent (app crashed without emitting the sentinel, etc.).
  if IFS= read -r -u "$logcat_fd" -t 10 line; then
    printf '%s\n' "$line"
    case "$line" in
      *__NODE_EXIT__:*)
        EXIT_CODE="${line##*__NODE_EXIT__:}"
        break
        ;;
    esac
  else
    # Logcat went quiet. Distinguish "app crashed" from "emulator wedged".
    # `timeout` bounds the adb call so a hung emulator can't freeze this
    # loop — without it the SECONDS budget (only re-checked at the loop
    # top) never fires and the job stalls to its wall clock.
    # `timeout` exits 124 specifically when it kills a hung adb; any other
    # exit means adb answered (pidof itself exits non-zero when the
    # process is absent, so we key off timeout's code, not adb's). The
    # `|| rc=$?` form keeps `set -e` from exiting on that non-zero.
    pid=$(timeout 15 adb shell pidof -s "$APP_ID" 2>/dev/null) && rc=0 || rc=$?
    pid=${pid//[$' \t\r\n']/}
    if [ "$rc" -ne 124 ] && [ -z "$pid" ]; then
      # App process is gone without emitting the sentinel (e.g. a native
      # SIGSEGV in an addon). Fail now instead of waiting out the timeout.
      APP_DIED=1
      break
    fi
  fi
done

# Kill the adb logcat client itself, not just the coproc subshell — a
# surviving client keeps an adb server connection open, which has hung
# android-emulator-runner's emulator teardown until the job timeout.
kill "$logcat_pid" 2>/dev/null || true
pkill -f 'adb logcat' 2>/dev/null || true
wait "$logcat_pid" 2>/dev/null || true

if [ -n "$APP_DIED" ]; then
  echo "::error::App process died without emitting __NODE_EXIT__ (native crash?). Recent crash log:"
  adb logcat -d -t 100 -b crash 2>/dev/null || true
  exit 1
fi

if [ -z "$EXIT_CODE" ]; then
  echo "::error::Did not observe __NODE_EXIT__ sentinel within ${TIMEOUT_SECONDS}s"
  exit 1
fi

echo "Node process exited with code ${EXIT_CODE}"
exit "${EXIT_CODE}"
