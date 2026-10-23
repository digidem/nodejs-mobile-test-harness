# iOS test harness

A minimal Xcode project that embeds nodejs-mobile, runs `nodejs-project/main.js`
from the app bundle on a background thread, prints a `__NODE_EXIT__:<code>`
sentinel line to stdout, and calls `exit()`.

This is not a user-facing app. `nodejs-mobile-test ios` copies this template
into the consumer's `node_modules/.cache/nodejs-mobile-test-harness/`, populates
it, builds `TestHarness.app`, installs it on a simulator, launches it with
`xcrun simctl launch --console-pty`, and reads back TAP output and pass/fail
from the app's stdout. The template is never built in place.

## Populated by the tool

- `NodeMobile/NodeMobile.xcframework` — the full xcframework from the
  nodejs-mobile iOS release zip. Xcode's build system picks the matching
  slice (device vs simulator) per `-sdk`.
- `nodejs-project/` — the user's project directory plus the generated
  `main.js` that prints the exit sentinel and loads the entry file

## Build

```
xcodebuild -project TestHarness.xcodeproj \
           -scheme TestHarness \
           -sdk iphonesimulator \
           -configuration Debug \
           -destination 'generic/platform=iOS Simulator' \
           -derivedDataPath build \
           CODE_SIGNING_ALLOWED=NO \
           ARCHS=arm64 \
           ONLY_ACTIVE_ARCH=NO \
           build
```
