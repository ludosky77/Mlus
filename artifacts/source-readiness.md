# APK bridge build and source status

Date: 2026-10-05. Version 0.2.1 builds successfully. No execution host is deployed;
online gameplay and physical-device validation remain outstanding.

Implemented:

- Native Kotlin/Compose Library / Rooms / Settings navigation. Flat library rows,
  actual app icons, fewer secondary details, clear Host and Join actions, and
  connection explanations in the relevant room/settings flow.
- Installed-app picker with search and All apps / Games filters. Copies the base
  APK and installed splits directly; no external extractor is needed. Android
  launcher-intent visibility is used without QUERY_ALL_PACKAGES or storage access.
- Import progress/cancellation, bounded copying, SHA-256 deduplication, package
  metadata, package-update detection, atomic library commits and private-copy removal.
- Authenticated room upload, size/hash enforcement and temporary-file cleanup.
- Opt-in disposable emulator adapter with SDK/ABI checks, base/split installation,
  automatic launcher resolution, scrcpy 4.0 video/control transport and teardown.
- Native H.264 decoding, separate player pointer IDs and text-only room chat.
- Legacy HTML experiments remain outside the Android app.

Verified:

- Local JavaScript checks and 19 Node tests. Coverage includes room/chat/upload
  behavior, cancellation/cleanup, video parsing, pointer routing and validated
  split archives with package/version consistency checks.
- [GitHub Actions run 37274699247](https://github.com/ludosky77/Mlus/actions/runs/37274699247)
  passed at source commit `5720e9ec81b0b06fc059207b13fa57275ef53e45`: all 19 Node
  tests, Kotlin compilation, `:app:lintDebug` and `:app:assembleDebug`.
- Lint: zero errors and 16 warnings. These are not suppressed.
- Downloaded artifact SHA-256 matches GitHub’s digest. Archive and APK ZIP
  integrity checks pass. APK: `artifacts/bridge-debug-0.2.1.apk`, 18,828,883 bytes;
  `artifacts/bridge-debug.apk` is the same build. Provenance and checksums are in
  `build-result.json`.
- The workflow explicitly creates and caches its debug signing key. The run log
  confirms the cache was saved. Earlier builds have different signing certificates;
  installing this build requires removing the old Bridge installation first,
  clearing its private copies/settings but not the original installed games.
- No Android build, emulator, ADB command or installation ran on this phone.

Limits and outstanding work:

- Tests use a fake Android worker and synthetic protocol/package fixtures. They
  do not validate real APK execution, native decoding or device import behavior.
- The supplied VPS still timed out before SSH login on 2026-10-05. No Android
  execution host is deployed. A reachable endpoint is needed to inspect its
  suitability and provision a host before two-device gameplay can be tested.
- Layout, import and cancellation need physical-device review; the revised design
  has not been approved by the user.
- Installed splits match the source phone. Copying does not include saved data,
  accounts, external asset packs or alternative CPU architectures.
- Audio, controller mapping, clean emulator provisioning, production isolation,
  accounts, ads, latency/cost measurements and release distribution remain unfinished.

Compatibility depends on package requirements. Shared execution uses existing
controls and cannot create multiplayer logic missing from an application.
