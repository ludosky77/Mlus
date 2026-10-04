# APK bridge build and source status

Date: 2026-10-04. The first native debug APK builds successfully; runtime and device
validation are still outstanding.

Implemented:

- Kotlin/Compose APK library with bounded import, SHA-256 deduplication, package
  requirements and signing metadata; native room UI and text-only chat.
- Authenticated per-room APK upload, size/hash enforcement and temporary-file cleanup.
- Opt-in disposable emulator adapter: SDK/ABI checks, APK installation, automatic
  launcher resolution, scrcpy 4.0 video and control transport, teardown.
- Native H.264 decoding and normalized multi-touch with separate player pointer IDs.
- HTML assets and WebKit dependency removed from the Android app; previous assets
  preserved in experiments/html-runtime/.
- Source and manual GitHub Actions workflow published to
  https://github.com/ludosky77/Mlus. SDK setup explicitly selects platform-tools
  because the setup action’s default legacy tools package is no longer available.
  Execution-host deployment remains outstanding.

Verified locally without Android tools:

- JavaScript syntax checks.
- 14 Node tests: room membership/chat, upload authorization/size/hash, failed startup,
  cancellation, temporary-file deletion, stream restart/subscription, input roles, fragmented
  video parsing, pointer separation, invalid input and stuck-touch expiry.
- Android resource XML and workflow YAML parse; lockfile dependencies match.
- The relocated legacy HTML harness also passes; it is separate from product validation.
- Execution tests use a fake Android worker. Protocol tests use constructed packets.
  They do not execute an APK, ADB, Gradle, an emulator or a native decoder.

Verified on GitHub’s Ubuntu runner:

- [Run 37243718508](https://github.com/ludosky77/Mlus/actions/runs/37243718508) passed
  at source commit `8a09f1407d436e401c22d5d60e8fecacda74f7f9`.
- All 14 Node tests, Kotlin compilation, `:app:lintDebug` and `:app:assembleDebug`.
- Lint reported no errors, 12 warnings and one hint. Warnings cover dependency/API
  updates, style and optional Android configuration; they are not suppressed.
- The debug APK was downloaded to `artifacts/bridge-debug.apk` (18,763,295 bytes).
  The artifact SHA-256 matches GitHub’s digest, and the APK ZIP structure passes
  integrity checks. See `build-result.json` for provenance and the APK checksum.
- No Android build or installation ran on this phone during this work.

Outstanding:

- Actual execution-host deployment and end-to-end testing with real APKs and phones.
- Native layout review and user approval of the design.
- Audio, external asset packs, controller mapping, clean emulator provisioning, production
  isolation, accounts, ads, latency/cost measurement and production distribution.

Compatibility is requirement-based, not tied to named games. Shared execution cannot
create multiplayer game logic that an application does not already contain.

Version 0.2 source changes:

- Play / Library / Settings navigation; visible Host and Join actions; actionable
  offline state; native installed-app picker with real app icons and search.
- Launcher-intent package visibility, with no QUERY_ALL_PACKAGES or storage permission.
- Direct base/split extraction, import progress and cancellation, package details,
  private-copy deletion, package-update detection and atomic library commits.
- Host-side split-set extraction and install-multiple support, validated by 19 Node
  tests. APK signatures are still validated by Android at installation time.
- New Android build and physical-device import review are pending for this revision.
