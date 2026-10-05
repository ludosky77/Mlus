# Android execution host

This adapter is source code awaiting validation against a real remote emulator.
Do not run these tools on the user's Termux phone. The previously supplied SSH
endpoint still timed out before its SSH login on 2026-10-05; no execution host
has been deployed. An updated or reachable SSH endpoint is needed to continue
host inspection and provisioning.

## Architecture

1. The native client copies a selected installed app (base APK plus installed
   splits), or a standalone APK file, into its private library and reads
   package ID, version, minimum/target API, native ABIs and signing metadata.
2. Creating a room uploads that APK with the room owner's upload token. The server
   enforces the 512 MiB limit and checks the SHA-256 supplied during room creation.
3. The worker checks the package using `aapt dump badging`, compares API/ABI
   requirements with the explicitly configured emulator, and installs the package.
   Installed app exports are bounded ZIP files containing base.apk and split-N.apk.
   The worker rejects path traversal, symlinks, duplicate entries, oversized
   extraction and splits from different packages/versions, then uses install-multiple.
   Android validates the installation and signing consistency.
4. Android's package manager resolves the launcher activity without a game-specific
   adapter. The worker starts it and the scrcpy 4.0 capture/control server.
5. H.264 frames go to subscribed room members over WebSocket. Each native client
   uses MediaCodec and SurfaceView. Configuration and keyframe handling support
   late joins and bounded queues.
6. Each player sends complete normalized touch snapshots. The host assigns five
   pointer IDs per player. Focus loss, unsubscribe, guest departure and a one-second
   input timeout release touches. The same game screen is shared by both players.
7. Host departure aborts startup or closes execution. The temporary APK is removed,
   ADB forwarding is removed and the used emulator is shut down.

This is a cloud Android session architecture. It does not virtualize arbitrary
APKs inside the importing phone, merge two independently running games, or add
multiplayer logic to applications that do not have it.

## Provisioning requirements

On a separate Linux execution machine, provision a clean disposable Android
emulator with enough GPU/CPU capacity and hardware virtualization support where
required. A build-only VPS or GitHub Actions runner is not automatically a viable
low-latency production execution host. Match its Android API and CPU ABI to the
packages you intend to execute; standard x86 images do not automatically run ARM
native libraries.

Keep the emulator worker isolated from project credentials, host-mounted private
files and private infrastructure. This adapter executes uploaded applications;
its explicit-serial restriction is not an isolation boundary. Production workload
isolation and clean image provisioning must be supplied and tested separately.

Install matching Android platform tools and build tools so `adb` and `aapt` are
available. Obtain the scrcpy **4.0 server** from the official Genymobile release,
verify the downloaded artifact and supply its local path. The JAR is not bundled
or downloaded automatically. The worker relies on that version's wire protocol.

An example configuration for the remote room service is:

```sh
BRIDGE_ANDROID_SERIALS=emulator-5554 \
BRIDGE_SCRCPY_SERVER=/opt/bridge/scrcpy-server-v4.0 \
BRIDGE_ADB=/opt/android/platform-tools/adb \
BRIDGE_AAPT=/opt/android/build-tools/35.0.0/aapt \
HOST=127.0.0.1 PORT=3210 npm start
```

Only explicitly supplied `emulator-<port>` serials are accepted. A slot is reserved
while startup is running. A failure before installation returns it to the pool;
once installation is attempted, shutdown retires that emulator. The current pool
has no automatic refill: provision new clean instances and restart the service
between controlled test sessions. Do not reuse a dirty emulator directory.

Place the service behind an HTTPS reverse proxy with WebSocket upgrade support,
a request-body limit that accommodates a 512 MiB APK, and adequate upload/stream
idle timeouts. Configure the same HTTPS server address in both clients. Keep ADB
private to the execution machine. No production deployment has been performed.

## Validation still required

- Install the compiled debug client on two devices. Remote Kotlin compilation and
  Android lint passed in [Actions](https://github.com/ludosky77/Mlus/actions/runs/37274699247);
  this does not validate emulator execution or native device behavior.
- Import both an APK with native libraries and one without them; check metadata,
  duplicate imports and cancellation without corrupting the local library.
- Confirm actual package installation, launcher resolution and scrcpy 4.0 startup.
- Confirm a local multi-touch multiplayer app accepts concurrent controls from
  both phones; using an existing app's controls does not establish universal support.
- Test video decoder startup, landscape/portrait rotation, late joins, focus loss,
  room teardown, network interruption and sustained latency on two real networks.
- Check emulator teardown and private-data disposal, and measure per-session
  compute/bandwidth costs before assessing whether advertising can fund sessions.

Protocol references: [scrcpy developer documentation](https://github.com/Genymobile/scrcpy/blob/v4.0/doc/develop.md),
[video streamer](https://github.com/Genymobile/scrcpy/blob/v4.0/server/src/main/java/com/genymobile/scrcpy/device/Streamer.java),
[control reader](https://github.com/Genymobile/scrcpy/blob/v4.0/server/src/main/java/com/genymobile/scrcpy/control/ControlMessageReader.java).
