# AGENTS.md

`@digidem/nodejs-mobile-test-harness`: a CLI (`nodejs-mobile-test`) that runs a
Node project inside nodejs-mobile on an iOS simulator or Android device and
exits with node's exit code. While `PLAN.md` exists, it is the brief: work
through it phase by phase, and treat its Decisions section as settled.

## Commands

```sh
npm test            # types, lint, unused (knip), unit tests
npm run coverage    # unit tests with lcov + text coverage
npm run check:pkg   # publint + attw on the packed tarball
npm run format      # prettier
```

## How it works

- `ios/` and `android/` are app templates. The tool copies one into the
  consumer's `node_modules/.cache/nodejs-mobile-test-harness/`, adds the
  nodejs-mobile runtime and the user's project, builds and runs it. The
  templates are never built in place.
- The app runs `nodejs-project/main.js`, which the tool generates: it prints
  `__NODE_EXIT__:<code>` on `process.on('exit')` and requires the entry file.
  The runner reads that sentinel from the simulator's console (iOS) or logcat
  (Android).
- The app identity `com.awana.nodejstest` appears in the pbxproj,
  `app/build.gradle`, the Java package path and the JNI symbol names in
  `native-lib.cpp`; change all of them together or not at all.

## Rules

- App output goes to stdout untouched; the tool's own messages go to stderr
  with the `[nodejs-mobile-test]` prefix. Consumers pipe stdout as TAP.
- Every wait on a device (adb call, app launch, sentinel) has a bound. The
  Android hang fixes are listed in `PLAN.md` under "Android runner
  behaviours"; a change that drops one reintroduces a known CI hang.
- The default nodejs-mobile version is pinned in one place in the source;
  bump it there, in the README, and in CI together.
- Releases: Gregor publishes. Prereleases go to the `next` dist-tag.

## Conventions

JavaScript with JSDoc types, checked by `tsc`; ESM only, no default exports.
The app templates and `test/fixtures/` are excluded from Prettier and ESLint.
Commit titles follow Conventional Commits. Commits are signed with Gregor's
existing git identity; don't add assistant attribution.
