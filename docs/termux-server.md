# Running the room service on this phone

The Node room service runs in the existing Termux/Ubuntu environment. It can
later run unchanged on a VPS. This service handles connections, room membership,
text chat and video/control transport; it does not itself execute Android apps.

On 2026-10-05 the older process was replaced with the current server, listening
on port 3210 on all IPv4 interfaces. Its private process record and log are in
`.local-server/server.pid` and `.local-server/server.log`, excluded from Git.
This is a development process, with no boot startup or automatic restart.

## Connect

On this phone, set the native app's Settings server address to:

```text
http://127.0.0.1:3210
```

For another phone on the same Wi-Fi, substitute the hosting phone's Wi-Fi IP
address for `127.0.0.1`. Reachability from a second device has not been verified.
The loopback address only reaches the device using it. Internet access requires
a reachable HTTPS/WSS endpoint, such as a tunnel or a deployed VPS; none has
been configured for this local server.

`GET /health` checks the room service. `GET /config` also reports Android worker
availability. With no configured execution host, `android.enabled` is false and
`android.available` is zero. APK room creation remains unavailable in the native
app; starting the Node process does not make gameplay or native room chat usable.

## Run again

After stopping the existing process, run from the repository root in the same
environment, with Node 22 or newer and dependencies installed:

```sh
HOST=0.0.0.0 PORT=3210 node server.js
```

Use Ctrl-C to stop a foreground instance. For the detached instance, check the
PID in `.local-server/server.pid` still belongs to this repository's `node
server.js` before sending SIGTERM. Starting another instance on port 3210 while
one is already running fails with an address-in-use error. Closing/killing the
Termux environment or rebooting can stop this development service.

## Gameplay on the phone

The existing worker targets explicitly configured disposable Android emulators.
No emulator, ADB command, Android build or package installation was run on this
phone. A phone-hosted game session is a separate feature that is not implemented.

One possible design runs the installed game normally on the hosting phone and
shares its display using Android's consent-based
[MediaProjection API](https://developer.android.com/media/grow/media-projection).
Remote touch control is a separate problem: the ordinary accessibility
[dispatchGesture API](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#dispatchGesture(android.accessibilityservice.GestureDescription,%20android.accessibilityservice.AccessibilityService.GestureResultCallback,%20android.os.Handler))
cancels gestures already in progress, including the user's touches. Consequently,
screen sharing plus accessibility taps is not a validated solution for two
players using simultaneous controls. A phone-host mode needs an explicit control
design and real-device testing before it can be promised as multiplayer support.

Moving the room service to a VPS only changes its hosting and the client server
address. Running games on that VPS additionally requires a compatible Android
execution environment; see [Android host setup](android-host.md).
