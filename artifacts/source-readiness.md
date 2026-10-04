# APK bridge source status

Date: 2026-10-04. This is a source progress report, not an app completion report.

Implemented:

- Kotlin/Compose APK library with bounded import, SHA-256 deduplication, package
  requirements and signing metadata; native room UI and text-only chat.
- Authenticated per-room APK upload, size/hash enforcement and temporary-file cleanup.
- Opt-in disposable emulator adapter: SDK/ABI checks, APK installation, automatic
  launcher resolution, scrcpy 4.0 video and control transport, teardown.
- Native H.264 decoding and normalized multi-touch with separate player pointer IDs.
- HTML assets and WebKit dependency removed from the Android app; previous assets
  preserved in experiments/html-runtime/.
- Manual GitHub Actions build workflow prepared; the user selected
  https://github.com/ludosky77/Mlus.git for publication and the first remote build.
  App source publication is authorized. GitHub rejected workflow publication
  because the supplied PAT lacks the required `workflow` scope. The workflow
  remains local until that permission is available. Execution-host deployment
  remains outstanding.

Verified locally without Android tools:

- JavaScript syntax checks.
- 14 Node tests: room membership/chat, upload authorization/size/hash, failed startup,
  cancellation, temporary-file deletion, stream restart/subscription, input roles, fragmented
  video parsing, pointer separation, invalid input and stuck-touch expiry.
- Android resource XML and workflow YAML parse; lockfile dependencies match.
- The relocated legacy HTML harness also passes; it is separate from product validation.
- Execution tests use a fake Android worker. Protocol tests use constructed packets.
  They do not execute an APK, ADB, Gradle, an emulator or a native decoder.

Outstanding:

- Remote Gradle build and lint; no APK has been produced. No Android build is running
  on this phone. The previously attempted local build failed before this implementation.
- Actual execution-host deployment and end-to-end testing with real APKs and phones.
- Native layout review and user approval of the design.
- Audio, split packages, controller mapping, clean emulator provisioning, production
  isolation, accounts, ads, latency/cost measurement and production distribution.

Compatibility is requirement-based, not tied to named games. Shared execution cannot
create multiplayer game logic that an application does not already contain.
