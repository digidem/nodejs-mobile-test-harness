# Android test harness

A minimal Android app that embeds nodejs-mobile, runs a `main.js` from its
assets, pumps Node's stdout/stderr to logcat (tag `NODEJS-MOBILE`), emits an
`__NODE_EXIT__:<code>` sentinel line, and terminates the process.

This is not a user-facing app. `nodejs-mobile-test android` copies this
template into the consumer's `node_modules/.cache/nodejs-mobile-test-harness/`,
populates it, builds an APK, installs it on a device or emulator, and reads back
TAP output and pass/fail from logcat. The template is never built in place.

## Populated by the tool

- `app/libnode/include/node/` — nodejs-mobile header files
- `app/libnode/bin/<abi>/libnode.so` — prebuilt libnode
- `app/src/main/assets/nodejs-project/` — the user's project
  directory plus the generated `main.js` that prints the exit sentinel and loads
  the entry file

## Build

```
./gradlew -PabiFilter=x86_64 :app:assembleDebug
```
