# Bridge

An Android APK-sharing application under development. The client is Kotlin and
Jetpack Compose, with a native video decoder, rooms and text-only chat. `Bridge`
is the current working name.

The native library lists installed launchable apps using Android package visibility.
Selecting an app copies its base APK and all installed split APKs, reads package
requirements and signing metadata, and saves a private library copy. A standalone
APK file can also be imported. Upload happens when the owner creates a room. A
configured disposable Android emulator installs and launches the app. Both room
members view the same Android session and send touch controls to it, with distinct
pointer IDs for each player. There is no game-name allowlist.

This shares the application's existing controls. It does not add a second avatar,
independent game state or multiplayer rules to a single-player application. SDK,
ABI, emulator restrictions, copy protection and missing external game assets can prevent
an APK from running. Reading certificate metadata is not a malware assessment;
Android installation remains the authoritative package/signature check.

## Status

Version 0.2 reorganizes the native interface into Play, Library and Settings, adds
the installed-app picker, import progress/cancellation, app details and library-copy
removal. The local server suite now contains 19 passing tests, including split
archive extraction and package consistency. Device import behavior still needs
validation on a physical phone.

The APK import, room upload, Android worker adapter, binary video protocol and
native viewing/control source are implemented. Node tests exercise real HTTP and
WebSocket connections with an injected fake Android worker. Protocol tests check
scrcpy frame parsing and touch routing. The [GitHub Actions build](https://github.com/ludosky77/Mlus/actions/runs/37243718508)
passed all 14 Node tests, Kotlin compilation, Android lint and debug APK assembly.
[Download the APK and lint reports](https://github.com/ludosky77/Mlus/actions/runs/37243718508/artifacts/11318661450).
The artifact expires seven days after this build; the workflow can produce another.
**Physical-device behavior and real APK execution on the remote host remain unverified.**

The earlier HTML prototype remains in `public/` and `experiments/html-runtime/`
for reference. It is excluded from the Android application's assets and dependencies.
Its browser tests do not validate the native Android application.

## Check the room service locally

```sh
npm ci
npm run check
npm test
npm start
```

Node 22 or later is required. The room server defaults to
`http://127.0.0.1:3210`. Without an Android worker configured, APK room creation
reports that no execution host is available. The native library can still import
packages. The root web page is the legacy experiment, not an Android UI preview.

## Remote execution host

See [Android host setup](docs/android-host.md). This is separate from the machine
that compiles the Android client. The execution adapter requires a provisioned,
isolated disposable Android emulator, ADB, AAPT and the scrcpy **4.0** server JAR.
It does not provision emulators, run a phone automatically or install anything on
the importing user's device.

The APK is uploaded only by the room owner using a per-room bearer token. The
server checks its SHA-256 and size before installation and removes its temporary
copy after startup succeeds or fails. The local library copy remains on the phone.
An emulator that reaches installation is retired on shutdown instead of being
reused with the previous user's application or data.

The first video transport is H.264 over WebSocket, capped at 1280 pixels, 30 fps
and a requested 4 Mbps. Real latency, bandwidth and decoder behavior need device
measurement. The worker supports base-plus-split installation with package/version checks. Device
exports contain the splits installed for that phone; they cannot supply a different
CPU architecture or downloaded asset packs. Audio, controller mapping, automatic
clean emulator provisioning, accounts, ads and production deployment remain unfinished.

## Build the Android client remotely

**Do not run Gradle, Android builds or emulators on the Termux phone.** The user
requested a status report before a remote build starts.

On an approved Linux build host, use JDK 17, Android SDK platform 36 and build tools
35.0.0. From `android/`, the build commands are:

```sh
./gradlew --no-daemon :app:lintDebug :app:assembleDebug
```

The manually triggered GitHub Actions workflow in `.github/workflows/android.yml`
verifies the Node code before building the Android client and uploading the debug
APK and lint reports. Android compilation runs on GitHub’s Linux runner.
The user selected [ludosky77/Mlus](https://github.com/ludosky77/Mlus) for this source
and its GitHub Actions builds. Build results are available in the repository’s
Actions tab; workflow preparation alone does not establish a successful build.

The native UI still needs review on a real device. Its current styling uses a
compact dark layout, rectangular controls and a consistent outlined icon set.
The debug manifest allows local HTTP development; internet deployment requires
HTTPS/WSS and a production network configuration.
