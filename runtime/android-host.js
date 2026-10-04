import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import { VideoParser, TouchRouter } from './protocol.js';
import { preparePackage, inspectPackageSet } from './packages.js';

const execute = promisify(execFile);
const SCRCPY_VERSION = '4.0';

// Opt-in, disposable emulator adapter. No phone discovery or implicit ADB target.
// A provisioned emulator is retired after installation/session completion. An
// external orchestrator must replenish the pool with clean, isolated instances.
export class AndroidHostPool {
  constructor({ serials = [], serverJar = '', adb = 'adb', aapt = 'aapt' } = {}) {
    if (serials.some(serial => !/^emulator-\d+$/.test(serial))) throw new Error('Only explicitly configured disposable emulator serials are accepted.');
    this.available = new Set(serials); this.serverJar = serverJar; this.adb = adb; this.aapt = aapt;
    this.enabled = serials.length > 0 && !!serverJar;
  }
  capabilities() { return { enabled: this.enabled, available: this.available.size, transport: 'h264-websocket', maxApkBytes: 512 * 1024 * 1024 }; }
  async start(apkPath, emit, signal, { format = 'apk' } = {}) {
    if (!this.enabled || !this.available.size) throw new Error('No Android execution host is available.');
    const serial = this.available.values().next().value;
    this.available.delete(serial);
    let dirty = false, closed = false, port, serverProcess, video, control, timer, closePromise, prepared;
    const invoke = (...args) => execute(this.adb, ['-s', serial, ...args], { timeout: 60_000, maxBuffer: 1024 * 1024, signal });
    const bestEffort = (...args) => execute(this.adb, ['-s', serial, ...args], { timeout: 10_000 }).catch(() => {});
    const touches = new TouchRouter(packet => {
      if (!control || control.destroyed || closed) return;
      if (control.writableLength >= 64 * 1024) { fail('The Android control connection fell behind.'); return; }
      control.write(packet);
    });
    const close = () => {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        clearInterval(timer); touches.releaseAll(); video?.destroy(); control?.destroy(); serverProcess?.kill('SIGTERM');
        if (port) await bestEffort('forward', '--remove', `tcp:${port}`);
        if (dirty) await bestEffort('emu', 'kill'); else this.available.add(serial);
        signal?.removeEventListener('abort', abort);
      })();
      return closePromise;
    };
    const abort = () => { void close(); };
    const fail = message => { if (!closed) { emit({ type: 'error', message }); void close(); } };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      await access(this.serverJar, constants.R_OK);
      emit({ type: 'state', state: 'checking', message: 'Checking the Android host' });
      prepared = await preparePackage(apkPath, format, signal);
      const apk = await inspectPackageSet(prepared.files, async file => (await execute(this.aapt, ['dump', 'badging', file], { timeout: 20_000, maxBuffer: 2 * 1024 * 1024, signal })).stdout);
      const [{ stdout: apiText }, { stdout: abiText }] = await Promise.all([invoke('shell', 'getprop', 'ro.build.version.sdk'), invoke('shell', 'getprop', 'ro.product.cpu.abilist')]);
      const api = Number(apiText.trim()), abis = abiText.trim().split(',');
      if (!Number.isInteger(api) || api < apk.minSdk) throw new Error(`This APK requires Android API ${apk.minSdk}; the available host reports ${api || 'an unknown version'}.`);
      if (apk.abis.length && !apk.abis.some(abi => abis.includes(abi))) throw new Error(`This APK needs ${apk.abis.join(', ')}. The Android host provides ${abis.join(', ')}.`);
      signal?.throwIfAborted();
      if (closed) throw new Error('The Android session was cancelled.');
      emit({ type: 'state', state: 'installing', message: 'Installing the APK in its Android session' });
      dirty = true;
      const install = await invoke(prepared.files.length > 1 ? 'install-multiple' : 'install', '--no-streaming', ...prepared.files);
      if (!/\bSuccess\b/.test(install.stdout)) throw new Error('Android rejected the APK installation. A complete compatible APK is required.');
      const launch = await invoke('shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', apk.packageName);
      const component = launch.stdout.trim().split(/\r?\n/).find(line => /^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+$/.test(line));
      if (!component || !component.startsWith(`${apk.packageName}/`)) throw new Error('This APK has no launchable application activity.');
      // ADB joins shell arguments; quote the validated component so nested-class
      // dollar signs remain literal when Android's shell parses the command.
      const started = await invoke('shell', 'am', 'start', '-W', '-n', `'${component}'`);
      if (/Error:|Exception|Status: timeout/.test(started.stdout)) throw new Error('Android could not start this application.');
      await invoke('push', this.serverJar, '/data/local/tmp/bridge-scrcpy.jar');
      const id = (randomBytes(4).readUInt32BE() & 0x7fffffff).toString(16).padStart(8, '0');
      const forward = await invoke('forward', 'tcp:0', `localabstract:scrcpy_${id}`);
      port = Number(forward.stdout.trim());
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Could not open the Android video transport.');
      serverProcess = spawn(this.adb, ['-s', serial, 'shell', 'CLASSPATH=/data/local/tmp/bridge-scrcpy.jar', 'app_process', '/', 'com.genymobile.scrcpy.Server', SCRCPY_VERSION,
        `scid=${id}`, 'tunnel_forward=true', 'audio=false', 'control=true', 'video_codec=h264', 'max_size=1280', 'max_fps=30', 'video_bit_rate=4000000',
        'video_codec_options=i-frame-interval:int=1', 'send_device_meta=false', 'send_dummy_byte=true', 'send_stream_meta=true', 'send_frame_meta=true', 'clipboard_autosync=false'],
        { stdio: ['ignore', 'ignore', 'pipe'] });
      serverProcess.stderr.resume();
      serverProcess.on('error', () => fail('The Android streaming service could not start.'));
      serverProcess.on('exit', () => fail('The Android streaming service stopped.'));
      video = await connectSocket(port, signal, true);
      video.pause();
      control = await connectSocket(port, signal);
      control.on('data', () => {}); // Never forward the Android clipboard to room members.
      control.on('error', () => fail('The Android control connection failed.'));
      control.on('close', () => fail('The Android control connection closed.'));
      const parser = new VideoParser();
      parser.on('format', format => { touches.resize(format.width, format.height); emit({ type: 'format', ...format }); });
      parser.on('frame', frame => emit({ type: 'frame', frame }));
      video.on('data', chunk => { try { parser.feed(chunk); } catch (error) { fail(error.message); } });
      video.on('error', () => fail('The Android video connection failed.'));
      video.on('close', () => fail('The Android video connection closed.'));
      signal?.throwIfAborted();
      if (closed) throw new Error('The Android session was cancelled.');
      video.resume(); timer = setInterval(() => touches.expire(), 250); timer.unref();
      return { input: (slot, contacts) => touches.input(slot, contacts), release: slot => touches.release(slot), close };
    } catch (error) { await close(); throw error; }
    finally { await prepared?.cleanup(); }
  }
}

async function connectSocket(port, signal, probe = false) {
  for (let attempt = 0; attempt < 40; attempt++) {
    signal?.throwIfAborted();
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.connect({ host: '127.0.0.1', port });
        socket.setTimeout(1000, () => socket.destroy(new Error('Android transport timeout')));
        socket.once('error', reject);
        socket.once('close', () => reject(new Error('Android transport not ready')));
        socket.once('connect', () => {
          if (!probe) { socket.setTimeout(0); resolve(socket); return; }
          socket.once('data', data => {
            if (data[0] !== 0) { socket.destroy(); reject(new Error('Invalid Android handshake')); return; }
            socket.pause(); socket.setTimeout(0);
            if (data.length > 1) socket.unshift(data.subarray(1));
            resolve(socket);
          });
        });
      });
    } catch { await delay(250, undefined, { signal }); }
  }
  throw new Error('The Android streaming service did not accept a connection.');
}
