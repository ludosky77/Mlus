import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createApplication } from '../server.js';

const apk = Buffer.from('Test package bytes; the fake host does not execute an APK.');
const sha256 = createHash('sha256').update(apk).digest('hex');
function fakeHost() {
  const state = { inputs: [], released: [], closed: 0, started: 0 };
  state.capabilities = () => ({ enabled: true, available: 1 });
  state.start = async (file, emit, signal) => {
    state.started++; state.file = file; state.bytes = await readFile(file); state.emit = emit; state.signal = signal;
    emit({ type: 'format', codec: 'h264', width: 1280, height: 720 });
    return { input: (slot, contacts) => state.inputs.push({ slot, contacts }), release: slot => state.released.push(slot), close: async () => { state.closed++ } };
  };
  return state;
}
async function setup(t, options = {}) {
  const app = createApplication(options); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());
  const connect = async () => {
    const socket = new WebSocket(url.replace('http:', 'ws:') + '/socket'), messages = [], waiters = [];
    socket.on('message', (raw, binary) => {
      const packet = binary ? { type: 'video', bytes: raw } : JSON.parse(raw);
      const index = waiters.findIndex(w => w.match(packet));
      if (index < 0) messages.push(packet);
      else { const [waiter] = waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(packet); }
    });
    const next = (type, predicate = () => true) => new Promise((resolve, reject) => {
      const match = packet => packet.type === type && predicate(packet), index = messages.findIndex(match);
      if (index >= 0) { resolve(messages.splice(index, 1)[0]); return; }
      const waiter = { match, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error(`Timed out: ${type}`)); }, 2000) }; waiters.push(waiter);
    });
    await next('hello');
    const send = message => socket.send(JSON.stringify(message));
    const sync = async () => { send({ type: 'ping', sentAt: 1 }); await next('pong'); };
    return { socket, send, next, sync, messages };
  };
  const upload = (code, token, body = apk) => fetch(`${url}/api/rooms/${code}/apk`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/vnd.android.package-archive' }, body });
  return { app, url, connect, upload };
}
async function create(host) { host.send({ type: 'create', name: 'Host', game: { kind: 'apk', title: 'Any Android package', sha256 } }); return host.next('joined'); }
const video = (flags, byte) => { const frame = Buffer.alloc(10); frame[0] = flags; frame[9] = byte; return frame; };
async function eventually(check) { for (let i = 0; i < 100; i++) { if (await check()) return; await delay(5); } assert.fail('Condition did not become true'); }

test('APK room authenticates upload, streams to members and assigns controls by role', async t => {
  const runtime = fakeHost(); const { app, connect, upload, url } = await setup(t, { androidHost: runtime });
  const host = await connect(), guest = await connect(), outsider = await connect();
  const created = await create(host), code = created.room.code;
  assert.match(created.uploadToken, /^[a-f0-9]{64}$/); assert.equal(created.room.uploadToken, undefined);
  guest.send({ type: 'join', name: 'Guest', code }); const joined = await guest.next('joined');
  assert.equal(joined.uploadToken, undefined); assert.equal(joined.room.uploadToken, undefined);
  assert.equal((await upload(code, '0'.repeat(64))).status, 403); assert.equal(runtime.started, 0);
  assert.equal((await upload(code, created.uploadToken)).status, 202);
  await host.next('room', p => p.room.runtime?.state === 'streaming');
  await eventually(() => !!app.rooms.get(code).worker);
  assert.deepEqual(runtime.bytes, apk);
  await eventually(async () => { try { await access(runtime.file); return false; } catch { return true; } });
  assert.equal((await fetch(`${url}/api/rooms/${code}/apk`)).status, 404);
  assert.equal((await upload(code, created.uploadToken)).status, 409);
  const config = video(1, 0x67), delta = video(0, 0x41), key = video(2, 0x65);
  runtime.emit({ type: 'frame', frame: config });
  guest.send({ type: 'video-subscribe' }); assert.deepEqual((await guest.next('video')).bytes, config);
  runtime.emit({ type: 'frame', frame: delta });
  runtime.emit({ type: 'frame', frame: key }); assert.deepEqual((await guest.next('video')).bytes, key);
  await guest.sync(); assert.equal(guest.messages.some(p => p.type === 'video'), false);
  assert.equal(host.messages.some(p => p.type === 'video'), false); assert.equal(outsider.messages.some(p => p.type === 'video'), false);
  const contacts = [{ id: 0, x: 0.4, y: 0.7 }];
  host.send({ type: 'input', contacts, slot: 1 }); guest.send({ type: 'input', contacts, slot: 0 });
  await host.sync(); await guest.sync();
  assert.deepEqual(runtime.inputs.map(p => p.slot).sort(), [0, 1]);
  outsider.send({ type: 'input', contacts }); assert.match((await outsider.next('error')).message, /Join a room/); assert.equal(runtime.inputs.length, 2);
  guest.send({ type: 'video-unsubscribe' }); await guest.sync(); assert.ok(runtime.released.includes(1));
  guest.send({ type: 'chat', text: 'Ready to play' }); assert.equal((await host.next('chat')).text, 'Ready to play');
  guest.send({ type: 'leave' }); await guest.next('left'); assert.ok(runtime.released.filter(slot => slot === 1).length >= 2);
  host.send({ type: 'leave' }); await host.next('left'); assert.equal(runtime.signal.aborted, true); assert.ok(runtime.closed > 0); assert.equal(app.rooms.size, 0);
});

test('disabled hosts, oversize uploads and mismatched checksums never execute a package', async t => {
  const disabled = await setup(t); const client = await disabled.connect();
  client.send({ type: 'create', name: 'A', game: { kind: 'apk', title: 'Package', sha256 } });
  assert.match((await client.next('error')).message, /no available Android/);
  const runtime = fakeHost(), enabled = await setup(t, { androidHost: runtime, maxApkBytes: apk.length });
  const host = await enabled.connect(), { room, uploadToken } = await create(host);
  assert.equal((await enabled.upload(room.code, uploadToken, Buffer.alloc(apk.length + 1))).status, 413);
  assert.equal((await enabled.upload(room.code, uploadToken, Buffer.from('wrong file'))).status, 400);
  const failed = await host.next('room', p => p.room.runtime?.state === 'failed'); assert.match(failed.room.runtime.message, /checksum/);
  assert.equal(runtime.started, 0);
  assert.equal((await enabled.upload(room.code, uploadToken)).status, 409);
});

test('host departure cancels pending execution and closes a worker returned after cancellation', async t => {
  const runtime = fakeHost(); let finish;
  runtime.start = async (file, emit, signal) => {
    runtime.signal = signal; runtime.file = file;
    return new Promise(resolve => { finish = () => resolve({ close: async () => { runtime.closed++ } }); });
  };
  const { connect, upload, app } = await setup(t, { androidHost: runtime });
  const host = await connect(), { room, uploadToken } = await create(host);
  assert.equal((await upload(room.code, uploadToken)).status, 202); await eventually(() => !!finish);
  host.send({ type: 'leave' }); await host.next('left'); assert.equal(runtime.signal.aborted, true);
  finish(); await eventually(() => runtime.closed === 1); assert.equal(app.rooms.size, 0);
  await eventually(async () => { try { await access(runtime.file); return false; } catch { return true; } });
});

test('installation failure becomes a visible failed room and deletes the temporary APK', async t => {
  const runtime = fakeHost(); runtime.start = async file => { runtime.file = file; throw new Error('This package requires a different Android ABI.'); };
  const { connect, upload } = await setup(t, { androidHost: runtime }); const host = await connect(); const { room, uploadToken } = await create(host);
  assert.equal((await upload(room.code, uploadToken)).status, 202);
  assert.match((await host.next('room', p => p.room.runtime?.state === 'failed')).room.runtime.message, /ABI/);
  await eventually(async () => { try { await access(runtime.file); return false; } catch { return true; } });
});

test('a restarted video stream gets a new identity and requires a fresh subscription', async t => {
  const runtime = fakeHost(); const { app, connect, upload } = await setup(t, { androidHost: runtime });
  const host = await connect(), { room, uploadToken } = await create(host);
  await upload(room.code, uploadToken);
  const initial = (await host.next('room', p => p.room.runtime?.state === 'streaming')).room.runtime;
  host.send({ type: 'video-subscribe' }); await host.sync();
  assert.equal([...app.rooms.get(room.code).players.values()][0].videoReady, true);
  runtime.emit({ type: 'format', codec: 'h264', width: 1280, height: 720 });
  const restarted = (await host.next('room', p => p.room.runtime?.state === 'streaming')).room.runtime;
  assert.notEqual(restarted.streamId, initial.streamId);
  assert.equal(restarted.width, initial.width);
  assert.equal([...app.rooms.get(room.code).players.values()][0].videoReady, false);
  runtime.emit({ type: 'frame', frame: video(2, 0x65) }); await host.sync();
  assert.equal(host.messages.some(p => p.type === 'video'), false);
  host.send({ type: 'video-subscribe' }); await host.sync();
  runtime.emit({ type: 'frame', frame: video(2, 0x65) }); assert.equal((await host.next('video')).bytes[9], 0x65);
});
