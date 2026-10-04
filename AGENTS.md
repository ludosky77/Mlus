# Project instructions

- Build the Android product in Kotlin and Jetpack Compose. Game video uses the
  native MediaCodec/SurfaceView path; do not substitute a browser app or HTML game.
- The user rejected the earlier browser UI. Keep the native design compact and
  rectangular, with consistent icons and clear typography. Design approval and
  native device review remain outstanding.
- The target is a general Android APK bridge. Inspect package requirements and
  launch activities automatically. Do not require a named game or maintain a
  hard-coded game catalog as the product's compatibility strategy.
- Do not promise universal compatibility or invent player-two logic. The current
  adapter shares one Android execution session and its existing touch controls.
- Do not execute Android builds, emulators, ADB commands or installations on this
  Termux phone. Report source status before starting a remote Android build.
- Node syntax/protocol/server tests are allowed locally. Passing them does not
  establish Kotlin compilation, emulator execution or Android device correctness.
- The user selected https://github.com/ludosky77/Mlus.git and authorized publishing
  this source and running the prepared GitHub Actions Android build. Never commit
  credentials, toolchains or the storage-audit records outside this project.
- Execution-host deployment remains separate from the Android build workflow.
- Preserve the storage audit and cleanup records outside this project.
- Preserve earlier HTML experiments in public/ and experiments/html-runtime/;
  they are excluded from the native Android application and are not its UI.
- The Android worker is disabled unless explicitly configured. It accepts only
  named disposable emulator instances, never an automatically discovered phone.
