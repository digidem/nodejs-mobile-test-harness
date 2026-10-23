#!/usr/bin/env bash
# Runs each fixture in test/fixtures/ and checks how it ends: its exit code, the
# runner's verdict on stderr and, where it matters, a line of app output on
# stdout. Each runs from its own directory, so each keeps its own build in
# <fixture>/node_modules/.cache/, which lets CI build before the emulator boots
# and run with --run-only inside android-emulator-runner.
#
# Usage: scripts/run-fixtures.sh <ios|android> [nodejs-mobile-test options...]
#   With --build-only, every fixture is expected to build (exit 0).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/src/cli.js"
platform="${1:?usage: $0 <ios|android> [options...]}"
shift

build_only=""
for arg in "$@"; do [ "$arg" = "--build-only" ] && build_only=1; done

# fixture|exit code|stderr must contain|stdout must contain
FIXTURES=(
  "passes|0|node exited with code 0|1..2"
  "fails|1|node exited with code 1|not ok 2"
  "crashes|1|App crashed|ok 1 - before the crash"
  "exit-listener|1|node exited with code 1|1..1"
  "throws|1|node exited with code 1|uncaught on purpose"
)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failed=0
for spec in "${FIXTURES[@]}"; do
  IFS='|' read -r fixture want want_err want_out <<<"$spec"
  [ -n "$build_only" ] && { want=0; want_err=""; want_out=""; }
  echo "::group::$fixture ($platform $*)"
  start=$SECONDS
  (cd "$ROOT/test/fixtures/$fixture" && node "$CLI" "$platform" "$@") >"$tmp/out" 2>"$tmp/err"
  code=$?
  elapsed=$((SECONDS - start))
  cat "$tmp/out"
  cat "$tmp/err" >&2
  echo "::endgroup::"
  if [ "$code" -ne "$want" ]; then
    echo "::error::$fixture: exit $code, expected $want (${elapsed}s)"
    failed=1
  elif [ -n "$want_err" ] && ! grep -qF "$want_err" "$tmp/err"; then
    echo "::error::$fixture: exit $code but stderr lacks '$want_err' (${elapsed}s)"
    failed=1
  elif [ -n "$want_out" ] && ! grep -qF "$want_out" "$tmp/out" "$tmp/err"; then
    echo "::error::$fixture: exit $code but the output lacks '$want_out' (${elapsed}s)"
    failed=1
  else
    echo "$fixture: exit $code as expected (${elapsed}s)"
  fi
done
exit "$failed"
