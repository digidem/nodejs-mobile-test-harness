#!/usr/bin/env bash
# Runs each fixture in test/fixtures/ and checks how it ends: passes exits 0,
# fails exits 1, crashes exits 1 reported as a crash (not a timeout). Each runs
# from its own directory, so each keeps its own build in
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

failed=0
for fixture in passes fails crashes; do
  case "$build_only:$fixture" in
    1:*) want=0; want_msg="" ;;
    :passes) want=0; want_msg="node exited with code 0" ;;
    :fails) want=1; want_msg="node exited with code 1" ;;
    :crashes) want=1; want_msg="App crashed" ;;
  esac
  echo "::group::$fixture ($platform $*)"
  err="$(mktemp)"
  start=$SECONDS
  (cd "$ROOT/test/fixtures/$fixture" && node "$CLI" "$platform" "$@") 2> >(tee "$err" >&2)
  code=$?
  echo "::endgroup::"
  elapsed=$((SECONDS - start))
  if [ "$code" -ne "$want" ]; then
    echo "::error::$fixture: exit $code, expected $want (${elapsed}s)"
    failed=1
  elif [ -n "$want_msg" ] && ! grep -q "$want_msg" "$err"; then
    echo "::error::$fixture: exit $code but stderr lacks '$want_msg' (${elapsed}s)"
    failed=1
  else
    echo "$fixture: exit $code as expected (${elapsed}s)"
  fi
  rm -f "$err"
done
exit "$failed"
