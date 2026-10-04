# Bridge

An Android APK-sharing application under development. The client is Kotlin and
Jetpack Compose, with a native video decoder, rooms and text-only chat. `Bridge`
is the current working name.

The current implementation imports an APK, reads its package requirements and
signing certificate metadata, and uploads it when its owner creates a room. A
configured disposable Android emulator installs and launches the app. Both room
members view the same Android session and send touch controls to it, with distinct
pointer IDs for each player. There is no game-name allowlist.

This shares the application's existing controls. It does not add a second avatar,
independent game state or multiplayer rules to a single-player application. SDK,
ABI, emulator restrictions, copy protection and missing split packages can prevent
an APK from running. Reading certificate metadata is not a malware assessment;
Android installation remains the authoritative package/signature check.

## Status

The APK import, room upload, Android worker adapter, binary video protocol and
native viewing/control source are implemented. Node tests exercise real HTTP and
WebSocket connections with an injected fake Android worker. Protocol tests check
scrcpy frame parsing and touch routing. **No real APK execution or native Android
build has been validated for this implementation. No installable APK is available.**

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
measurement. Audio, controller mapping, split APK installation, automatic clean
emulator provisioning, accounts, ads and production deployment remain unfinished.

## Build the Android client remotely

**Do not run Gradle, Android builds or emulators on the Termux phone.** The user
requested a status report before a remote build starts.

On an approved Linux build host, use JDK 17, Android SDK platform 36 and build tools
35.0.0. From `android/`, the build commands are:

```sh
./gradlew --no-daemon :app:lintDebug :app:assembleDebug
```

A manually triggered GitHub Actions workflow is prepared locally at
`.github/workflows/android.yml`. Publication is pending because the supplied PAT
lacks GitHub’s required `workflow` scope. Once published, it verifies the Node
code before building and uploads the debug APK and lint reports.
The user selected [ludosky77/Mlus](https://github.com/ludosky77/Mlus) for this source
and its GitHub Actions builds. Build results are available in the repository’s
Actions tab; workflow preparation alone does not establish a successful build.

The native UI still needs review on a real device. Its current styling uses a
compact dark layout, rectangular controls and a consistent outlined icon set.
The debug manifest allows local HTTP development; internet deployment requires
HTTPS/WSS and a production network configuration.
