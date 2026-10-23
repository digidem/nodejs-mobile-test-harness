---
'@digidem/nodejs-mobile-test-harness': patch
---

On Android, lines of output longer than 2 KB, or split by a burst of output, now arrive whole instead of in two pieces; lines past logcat's 4 KB entry limit arrive in 4000-byte pieces rather than truncated.
