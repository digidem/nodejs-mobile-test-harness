# Android test harness

A minimal Android app that embeds nodejs-mobile, runs a `main.js` from its
assets, pumps Node's stdout/stderr to logcat (tag `NODEJS-MOBILE`), emits an
`__NODE_EXIT__:<code>` sentinel line, and terminates the process.

This is not a user-facing app — it exists so the reusable workflow
`.github/workflows/test-android.yml` can build an APK, install it on an
emulator, and read back TAP output + pass/fail from logcat.

## Populated at CI time

- `app/libnode/include/node/` — nodejs-mobile header files
- `app/libnode/bin/<abi>/libnode.so` — prebuilt libnode
- `app/src/main/assets/nodejs-project/` — the module-under-test's
  `node_modules/` tree plus a `main.js` that runs the caller's test script

## Build

```
ANDROID_SDK_ROOT=$ANDROID_HOME gradle -PabiFilter=x86_64 :app:assembleDebug
```
