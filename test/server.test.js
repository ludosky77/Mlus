import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApplication } from '../server.js';

async function setup(t) {
  const app = createApplication();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  const connect = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/socket`);
    const messages = [], waiters = [];
    socket.on('message', raw => {
      const packet = JSON.parse(raw); const index = waiters.findIndex(w => w.type === packet.type);
      if (index >= 0) { const [waiter] = waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(packet); } else messages.push(packet);
    });
    const next = type => new Promise((resolve, reject) => {
      const index = messages.findIndex(m => m.type === type);
      if (index >= 0) { resolve(messages.splice(index, 1)[0]); return; }
      const waiter = { type, resolve, timer: setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2000) }; waiters.push(waiter);
    });
    const hello = await next('hello');
    return { socket, id: hello.id, next, send: data => socket.send(JSON.stringify(data)), messages };
  };
  t.after(() => app.close());
  return { app, connect, url: `http://127.0.0.1:${port}` };
}

test('a private room routes signaling and text chat only to its two participants', async t => {
  const { connect, app } = await setup(t);
  const host = await connect(), guest = await connect(), stranger = await connect();
  host.send({ type: 'create', name: 'Host', game: { title: 'Offline Game' } });
  const created = await host.next('joined');
  assert.match(created.room.code, /^[A-Z2-9]{6}$/);
  guest.send({ type: 'join', name: 'Friend', code: created.room.code.toLowerCase() });
  assert.equal((await guest.next('joined')).role, 'guest');
  assert.equal((await host.next('room')).room.players.length, 2);
  host.send({ type: 'signal', data: { type: 'offer', sdp: 'test', session: 'one' } });
  assert.equal((await guest.next('signal')).from, host.id);
  guest.send({ type: 'chat', text: '<img src=x onerror=alert(1)>' });
  assert.equal((await host.next('chat')).text, '<img src=x onerror=alert(1)>');
  assert.equal((await guest.next('chat')).sender.name, 'Friend');
  assert.equal(stranger.messages.some(m => ['chat', 'signal'].includes(m.type)), false);
  assert.equal(app.rooms.size, 1);
});

test('capacity, roles, malformed messages, and membership are enforced', async t => {
  const { connect } = await setup(t);
  const host = await connect(), guest = await connect(), other = await connect();
  host.send({ type: 'create', name: 'A', game: { title: 'Game' } });
  const { room } = await host.next('joined');
  host.send({ type: 'status', status: 'playing' });
  assert.match((await host.next('error')).message, /friend/);
  guest.send({ type: 'join', name: 'B', code: room.code }); await guest.next('joined');
  other.send({ type: 'join', name: 'C', code: room.code }); assert.match((await other.next('error')).message, /two players/);
  guest.send({ type: 'status', status: 'playing' }); assert.match((await guest.next('error')).message, /Only the host/);
  guest.send({ type: 'signal', data: { type: 'offer', sdp: 'forged' } }); assert.match((await guest.next('error')).message, /role/);
  other.send({ type: 'chat', text: 'intrusion' }); assert.match((await other.next('error')).message, /Join a room/);
  other.socket.send('not json'); assert.match((await other.next('error')).message, /Invalid message/);
  other.send(null); assert.match((await other.next('error')).message, /Invalid message/);
  other.send({ type: 'create', name: '', game: { title: 'G' } }); assert.match((await other.next('error')).message, /name/);
});

test('a departing guest frees the slot; a departing host closes the room', async t => {
  const { connect, app } = await setup(t);
  const host = await connect(), guest = await connect();
  host.send({ type: 'create', name: 'Host', game: { title: 'G' } }); const { room } = await host.next('joined');
  guest.send({ type: 'join', name: 'Guest', code: room.code }); await guest.next('joined'); await host.next('room');
  host.send({ type: 'status', status: 'playing' }); assert.equal((await host.next('room')).room.status, 'playing');
  guest.send({ type: 'leave' }); await guest.next('left'); await host.next('peer-left');
  assert.equal((await host.next('room')).room.status, 'waiting');
  guest.send({ type: 'join', name: 'Guest', code: room.code }); await guest.next('joined');
  host.send({ type: 'leave' }); await guest.next('closed'); await host.next('left');
  assert.equal(app.rooms.size, 0);
  guest.send({ type: 'chat', text: 'after close' }); assert.match((await guest.next('error')).message, /Join a room/);
});

test('HTTP serves only public assets, disallows cross-origin socket upgrades, and never exposes imported files', async t => {
  const { url } = await setup(t);
  assert.equal((await fetch(`${url}/health`)).status, 200);
  const game = await fetch(`${url}/games/paddle-duel.html`); assert.equal(game.status, 200); assert.match(await game.text(), /canvas/);
  assert.equal((await fetch(`${url}/server.js`)).status, 404);
  assert.equal((await fetch(`${url}/.env`)).status, 404);
  assert.equal((await fetch(`${url}/health`, { method: 'POST' })).status, 405);
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(url.replace('http:', 'ws:') + '/socket', { origin: 'https://example.invalid' });
    ws.on('open', () => { ws.close(); reject(new Error('Cross-origin socket accepted')); });
    ws.on('error', error => { assert.match(error.message, /403/); resolve(); });
  });
});
