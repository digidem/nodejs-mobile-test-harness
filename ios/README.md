# iOS test harness

A minimal Xcode project that embeds nodejs-mobile, runs `nodejs-project/main.js`
from the app bundle on a background thread, prints a `__NODE_EXIT__:<code>`
sentinel line to stdout, and calls `exit()`.

This is not a user-facing app — it exists so the reusable workflow
`.github/workflows/test-ios.yml` can build `TestHarness.app`, install it on a
simulator, launch it with `xcrun simctl launch --console-pty`, and read back
TAP output + pass/fail from the app's stdout.

## Populated at CI time

- `NodeMobile/NodeMobile.xcframework` — the full xcframework from the
  nodejs-mobile iOS release zip. Xcode's build system picks the matching
  slice (device vs simulator) per `-sdk`.
- `nodejs-project/` — the module-under-test's `node_modules/` tree plus a
  `main.js` that runs the caller's test script

## Build

```
xcodebuild -project TestHarness.xcodeproj \
           -scheme TestHarness \
           -sdk iphonesimulator \
           -configuration Debug \
           -destination 'generic/platform=iOS Simulator' \
           CODE_SIGNING_ALLOWED=NO \
           build
```
