import http from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { AndroidHostPool } from './runtime/android-host.js';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const cleanText = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';

export function createApplication({ idleMs = 30 * 60_000, maxRooms = 500, iceServers = [], androidHost = new AndroidHostPool(), maxApkBytes = 512 * 1024 * 1024 } = {}) {
  const rooms = new Map();
  const connections = new Map();
  const ipConnections = new Map();
  const pendingJobs = new Set();
  const send = (socket, packet) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(packet)); };
  const error = (socket, message) => send(socket, { type: 'error', message });
  const describe = (room) => ({ code: room.code, game: room.game, status: room.status, runtime: room.runtime ?? null, players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, role: p.role })) });
  const broadcast = (room, packet) => { for (const player of room.players.values()) send(player.socket, packet); };
  const publish = (room) => broadcast(room, { type: 'room', room: describe(room) });
  const dispose = (room) => { room.abort?.abort(); room.worker?.close().catch(() => {}); };
  function runtimeEvent(room, event) {
    if (!rooms.has(room.code) || room.abort?.signal.aborted) return;
    if (event.type === 'frame') {
      if (event.frame[0] & 1) room.videoConfig = event.frame;
      for (const member of room.players.values()) {
        if (!member.videoReady || member.socket.readyState !== WebSocket.OPEN) continue;
        if (member.socket.bufferedAmount > 2 * 1024 * 1024) { member.needsKey = true; continue; }
        if (event.frame[0] & 1) { member.socket.send(event.frame); continue; }
        if (member.needsKey && !(event.frame[0] & 2)) continue;
        member.needsKey = false; member.socket.send(event.frame);
      }
    } else {
      if (event.type === 'format') {
        room.videoConfig = null;
        room.runtime = { state: 'streaming', message: 'Android session connected', streamId: randomUUID(), codec: event.codec, width: event.width, height: event.height };
        for (const member of room.players.values()) { member.videoReady = false; member.needsKey = true; }
        room.status = 'playing';
      } else room.runtime = { state: event.type === 'error' ? 'failed' : event.state, message: String(event.message).slice(0, 240) };
      publish(room);
    }
  }
  const leave = (player) => {
    const room = rooms.get(player.room);
    player.room = null;
    if (!room) return;
    if (player.role === 'host') {
      dispose(room);
      broadcast(room, { type: 'closed', message: 'The host left the room.' });
      for (const member of room.players.values()) member.room = null;
      rooms.delete(room.code);
    } else {
      room.worker?.release(1);
      room.players.delete(player.id);
      if (room.game.kind !== 'apk') room.status = 'waiting';
      room.updatedAt = Date.now();
      broadcast(room, { type: 'peer-left', id: player.id });
      publish(room);
    }
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // srcdoc inherits this policy. Imported inline scripts run only in an opaque-origin sandbox;
    // its stricter policy disables fetches, external scripts, forms, and navigation capabilities.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'POST' && /^\/api\/rooms\/[A-Z2-9]{6}\/apk$/.test(pathname)) {
      const room = rooms.get(pathname.split('/')[3]);
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const expected = room?.uploadToken ?? '';
      const authorized = expected && /^[a-f0-9]{64}$/.test(token) && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
      if (!authorized || room.game.kind !== 'apk') { res.writeHead(403); res.end('Only the room host can upload its APK.'); return; }
      if (room.uploading || room.worker || room.runtime?.state === 'failed') { res.writeHead(409); res.end('This room already has an APK session. Create a new room to retry.'); return; }
      if (Number(req.headers['content-length'] ?? 0) > maxApkBytes) { res.writeHead(413); res.end('APK exceeds the upload limit.'); return; }
      room.uploading = true; room.abort = new AbortController();
      let directory;
      try {
        directory = await mkdtemp(path.join(tmpdir(), 'bridge-apk-'));
        const file = path.join(directory, 'application.apk'), hash = createHash('sha256');
        let size = 0;
        const meter = new Transform({ transform(chunk, _, callback) { size += chunk.length; if (size > maxApkBytes) { callback(new Error('APK exceeds the upload limit.')); return; } hash.update(chunk); callback(null, chunk); } });
        await pipeline(req, meter, createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal: room.abort.signal });
        if (hash.digest('hex') !== room.game.sha256) throw new Error('APK checksum does not match the imported package.');
        room.abort.signal.throwIfAborted();
        res.writeHead(202, { 'Content-Type': 'application/json' }); res.end('{"accepted":true}');
        const job = androidHost.start(file, event => runtimeEvent(room, event), room.abort.signal)
          .then(async worker => { if (room.abort.signal.aborted) await worker.close(); else room.worker = worker; })
          .catch(error => runtimeEvent(room, { type: 'error', message: error.message }))
          .finally(async () => { room.uploading = false; await rm(directory, { recursive: true, force: true }); pendingJobs.delete(job); });
        pendingJobs.add(job);
      } catch (error) {
        room.uploading = false;
        if (directory) await rm(directory, { recursive: true, force: true });
        if (!res.destroyed && !res.headersSent) { res.writeHead(400); res.end(error.message); }
        runtimeEvent(room, { type: 'error', message: error.message });
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size })); return; }
    if (pathname === '/config') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ iceServers, android: androidHost.capabilities() })); return; }
    const routes = new Set(['/', '/index.html', '/app.js', '/runtime.js', '/styles.css', '/icon.svg', '/manifest.webmanifest', '/games/paddle-duel.html']);
    if (!routes.has(pathname)) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const body = await readFile(path.join(publicDir, pathname === '/' ? 'index.html' : pathname));
      res.writeHead(200, { 'Content-Type': mime[path.extname(pathname === '/' ? 'index.html' : pathname)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    let validOrigin = !req.headers.origin;
    try { validOrigin ||= new URL(req.headers.origin).host === req.headers.host; } catch {}
    const ip = req.socket.remoteAddress;
    if (req.url !== '/socket' || !validOrigin || (ipConnections.get(ip) ?? 0) >= 20) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', (socket, req) => {
    const ip = req.socket.remoteAddress;
    ipConnections.set(ip, (ipConnections.get(ip) ?? 0) + 1);
    const player = { id: randomUUID(), socket, room: null, role: null, name: '', alive: true, windowAt: Date.now(), count: 0, chatAt: 0 };
    connections.set(player.id, player);
    send(socket, { type: 'hello', id: player.id });
    socket.on('pong', () => { player.alive = true; });
    socket.on('message', raw => {
      if (Date.now() - player.windowAt > 10_000) { player.windowAt = Date.now(); player.count = 0; }
      if (++player.count > 1600) { error(socket, 'Too many requests. Please slow down.'); return; }
      let message;
      try { message = JSON.parse(raw.toString()); } catch { error(socket, 'Invalid message.'); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { error(socket, 'Invalid message.'); return; }
      if (message.type === 'create') {
        if (player.room) { error(socket, 'Leave your current room first.'); return; }
        if (rooms.size >= maxRooms) { error(socket, 'All rooms are busy. Try again shortly.'); return; }
        const name = cleanText(message.name, 24);
        const title = cleanText(message.game?.title, 60);
        if (!name || !title) { error(socket, 'Enter your name and select a game.'); return; }
        if (message.game.kind === 'apk') {
          if (!androidHost.capabilities().enabled || !androidHost.capabilities().available) { error(socket, 'The room server has no available Android execution host.'); return; }
          const waiting = [...rooms.values()].filter(room => room.game.kind === 'apk' && !room.worker && room.runtime?.state !== 'failed').length;
          if (waiting >= androidHost.capabilities().available) { error(socket, 'The Android hosts are reserved by other rooms. Try again shortly.'); return; }
          if (!/^[a-f0-9]{64}$/.test(message.game.sha256 ?? '')) { error(socket, 'An imported APK checksum is required.'); return; }
        }
        let code;
        do { code = [...randomBytes(6)].map(n => alphabet[n % alphabet.length]).join(''); } while (rooms.has(code));
        player.name = name; player.role = 'host'; player.room = code;
        const kind = ['apk', 'import'].includes(message.game.kind) ? message.game.kind : 'demo';
        const room = { code, game: { title, kind, ...(kind === 'apk' ? { sha256: message.game.sha256 } : {}) }, status: 'waiting', players: new Map([[player.id, player]]), updatedAt: Date.now(), uploadToken: randomBytes(32).toString('hex'), runtime: kind === 'apk' ? { state: 'uploading', message: 'Uploading the APK to its Android host' } : null };
        rooms.set(code, room);
        send(socket, { type: 'joined', role: 'host', room: describe(room), uploadToken: room.uploadToken });
      } else if (message.type === 'join') {
        if (player.room) { error(socket, 'Leave your current room first.'); return; }
        const code = cleanText(message.code, 6).toUpperCase();
        const room = rooms.get(code);
        const name = cleanText(message.name, 24);
        if (!name) { error(socket, 'Enter your name.'); return; }
        if (!room) { error(socket, 'Room not found. Check the code with your friend.'); return; }
        if (room.players.size >= 2) { error(socket, 'This room already has two players.'); return; }
        player.name = name; player.role = 'guest'; player.room = code;
        room.players.set(player.id, player); room.updatedAt = Date.now();
        send(socket, { type: 'joined', role: 'guest', room: describe(room) });
        publish(room);
      } else if (message.type === 'leave') {
        leave(player);
        send(socket, { type: 'left' });
      } else if (message.type === 'ping') {
        const room = rooms.get(player.room);
        if (room) room.updatedAt = Date.now();
        send(socket, { type: 'pong', sentAt: message.sentAt });
      } else {
        const room = rooms.get(player.room);
        if (!room) { error(socket, 'Join a room first.'); return; }
        room.updatedAt = Date.now();
        if (message.type === 'video-subscribe' && room.game.kind === 'apk') {
          player.videoReady = true; player.needsKey = true;
          if (room.videoConfig) player.socket.send(room.videoConfig);
        } else if (message.type === 'video-unsubscribe' && room.game.kind === 'apk') {
          player.videoReady = false; room.worker?.release(player.role === 'host' ? 0 : 1);
        } else if (message.type === 'input' && room.game.kind === 'apk') {
          try { room.worker?.input(player.role === 'host' ? 0 : 1, message.contacts); }
          catch { error(socket, 'Invalid touch input.'); }
        } else if (message.type === 'input-release' && room.game.kind === 'apk') {
          room.worker?.release(player.role === 'host' ? 0 : 1);
        } else if (message.type === 'chat') {
          const body = cleanText(message.text, 600);
          if (!body) return;
          if (Date.now() - player.chatAt < 350) { error(socket, 'Give your last message a moment to send.'); return; }
          player.chatAt = Date.now();
          broadcast(room, { type: 'chat', id: randomUUID(), sender: { id: player.id, name: player.name }, text: body, at: Date.now() });
        } else if (message.type === 'signal') {
          const data = message.data;
          if (!data || typeof data !== 'object' || !['offer', 'answer', 'candidate'].includes(data.type)) { error(socket, 'Invalid connection signal.'); return; }
          if (data.type === 'offer' && player.role !== 'host' || data.type === 'answer' && player.role !== 'guest') { error(socket, 'Invalid connection role.'); return; }
          for (const peer of room.players.values()) if (peer.id !== player.id) send(peer.socket, { type: 'signal', from: player.id, data });
        } else if (message.type === 'status') {
          if (room.game.kind === 'apk') { error(socket, 'Use the Android application controls to start or pause its game.'); return; }
          if (player.role !== 'host') { error(socket, 'Only the host can start or pause the game.'); return; }
          if (room.players.size !== 2) { error(socket, 'Wait for your friend to join.'); return; }
          if (!['playing', 'paused', 'ready'].includes(message.status)) return;
          room.status = message.status;
          publish(room);
        } else error(socket, 'Unknown message.');
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => { leave(player); connections.delete(player.id); const count = (ipConnections.get(ip) ?? 1) - 1; if (count) ipConnections.set(ip, count); else ipConnections.delete(ip); });
  });
  const heartbeat = setInterval(() => {
    for (const player of connections.values()) {
      if (!player.alive) { player.socket.terminate(); continue; }
      player.alive = false; player.socket.ping();
    }
    for (const room of rooms.values()) if (Date.now() - room.updatedAt > idleMs) {
      dispose(room);
      broadcast(room, { type: 'closed', message: 'The room expired after being inactive.' });
      for (const member of room.players.values()) member.room = null;
      rooms.delete(room.code);
    }
  }, 30_000);
  heartbeat.unref();
  return {
    server, rooms,
    async close() { clearInterval(heartbeat); const closing = [...rooms.values()].map(room => { room.abort?.abort(); return room.worker?.close(); }); for (const client of wss.clients) client.terminate(); await Promise.allSettled([...closing, ...pendingJobs]); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let iceServers;
  try { iceServers = JSON.parse(process.env.ICE_SERVERS_JSON ?? '[{"urls":"stun:stun.l.google.com:19302"}]'); } catch { throw new Error('ICE_SERVERS_JSON must be valid JSON.'); }
  const androidHost = new AndroidHostPool({ serials: (process.env.BRIDGE_ANDROID_SERIALS ?? '').split(',').map(s => s.trim()).filter(Boolean), serverJar: process.env.BRIDGE_SCRCPY_SERVER ?? '', adb: process.env.BRIDGE_ADB ?? 'adb', aapt: process.env.BRIDGE_AAPT ?? 'aapt' });
  const app = createApplication({ iceServers, androidHost });
  const port = Number(process.env.PORT ?? 3210);
  const host = process.env.HOST ?? '127.0.0.1';
  app.server.listen(port, host, () => console.log(`Bridge is ready at http://${host}:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
