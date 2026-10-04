import test from 'node:test';
import assert from 'node:assert/strict';
import { VideoParser, TouchRouter, inspectBadging } from '../runtime/protocol.js';
import { AndroidHostPool } from '../runtime/android-host.js';

function session(width, height) {
  const bytes = Buffer.alloc(12); bytes.writeUInt32BE(0x80000000); bytes.writeUInt32BE(width, 4); bytes.writeUInt32BE(height, 8); return bytes;
}
function accessUnit(flags, timestamp, payload) {
  const header = Buffer.alloc(12); header.writeBigUInt64BE(flags | BigInt(timestamp)); header.writeUInt32BE(payload.length, 8); return Buffer.concat([header, payload]);
}

test('fragmented scrcpy 4.0 video retains format, configuration, frame flags and timestamp', () => {
  const parser = new VideoParser(), formats = [], frames = [];
  parser.on('format', value => formats.push(value)); parser.on('frame', value => frames.push(value));
  const config = Buffer.from([0, 0, 0, 1, 0x67]), key = Buffer.from([0, 0, 0, 1, 0x65]);
  const stream = Buffer.concat([Buffer.from('h264'), session(720, 1280), accessUnit(1n << 62n, 0, config), accessUnit(1n << 61n, 987654, key), session(1280, 720), accessUnit(0n, 999999, Buffer.from([1]))]);
  for (let offset = 0; offset < stream.length; offset += 3) parser.feed(stream.subarray(offset, offset + 3));
  assert.deepEqual(formats, [{ codec: 'h264', width: 720, height: 1280 }, { codec: 'h264', width: 1280, height: 720 }]);
  assert.equal(frames[0][0], 1); assert.deepEqual(frames[0].subarray(9), config);
  assert.equal(frames[1][0], 2); assert.equal(frames[1].readBigUInt64BE(1), 987654n); assert.deepEqual(frames[1].subarray(9), key);
  assert.equal(frames[2][0], 0); assert.equal(parser.buffer.length, 0);
});

test('video parser rejects an unexpected codec, impossible dimensions and oversized frames', () => {
  assert.throws(() => new VideoParser().feed(Buffer.from('av01')), /H.264/);
  for (const size of [0, 9000]) assert.throws(() => new VideoParser().feed(Buffer.concat([Buffer.from('h264'), session(size, 720)])), /display size/);
  const invalid = Buffer.alloc(12); invalid.writeUInt32BE(9 * 1024 * 1024, 8);
  assert.throws(() => new VideoParser().feed(Buffer.concat([Buffer.from('h264'), invalid])), /video packet/);
});

test('both players receive separate pointer IDs; releasing one never releases the other', () => {
  const packets = []; const router = new TouchRouter(packet => packets.push(packet)); router.resize(1280, 720);
  router.input(0, [{ id: 0, x: 0.25, y: 0.5 }]); router.input(1, [{ id: 0, x: 1, y: 1 }]);
  assert.equal(packets[0][0], 2); assert.equal(packets[0][1], 0);
  assert.equal(packets[0].readBigUInt64BE(2), 0n); assert.equal(packets[1].readBigUInt64BE(2), 5n);
  assert.equal(packets[0].readUInt32BE(10), 320); assert.equal(packets[1].readUInt32BE(10), 1279);
  assert.equal(packets[1].readUInt32BE(14), 719); assert.equal(packets[0].readUInt16BE(18), 1280);
  assert.equal(packets[0].readUInt16BE(22), 65535);
  router.input(1, [{ id: 0, x: 0.8, y: 0.7 }, { id: 1, x: 0.2, y: 0.3 }]);
  assert.equal(packets[2][1], 2); assert.equal(packets[3][1], 0); assert.equal(packets[3].readBigUInt64BE(2), 6n);
  router.release(0); assert.equal(packets[4][1], 1); assert.equal(packets[4].readBigUInt64BE(2), 0n); assert.equal(packets[4].readUInt16BE(22), 0);
  assert.equal(router.players.get(1).contacts.size, 2);
});

test('lost touch snapshots expire; malformed snapshots cannot change held controls', () => {
  let now = 0; const packets = []; const router = new TouchRouter(p => packets.push(p), () => now); router.resize(600, 900);
  router.input(0, [{ id: 3, x: 0.5, y: 0.5 }]);
  for (const contacts of [[{ id: 5, x: 0, y: 0 }], [{ id: 0, x: NaN, y: 0 }], [{ id: 0, x: -1, y: 0 }], [{ id: 0, x: 0, y: 0 }, { id: 0, x: 0, y: 0 }], null]) assert.throws(() => router.input(0, contacts), /Invalid touch/);
  assert.equal(packets.length, 1); now = 1001; router.expire(); assert.equal(packets.length, 2); assert.equal(packets[1][1], 1); assert.equal(router.players.size, 0);
  router.input(1, [{ id: 4, x: 0.2, y: 0.3 }]); router.resize(900, 600);
  assert.equal(packets.at(-1)[1], 1); assert.equal(packets.at(-1).readUInt16BE(18), 600);
  assert.equal(router.players.size, 0);
});

test('package checks use requirements, reject split-only packages and never discover a phone', async () => {
  assert.deepEqual(inspectBadging("package: name='org.example.anyapp' versionCode='1'\nsdkVersion:'29'\nnative-code: 'arm64-v8a' 'x86_64'\n"), { packageName: 'org.example.anyapp', minSdk: 29, abis: ['arm64-v8a', 'x86_64'] });
  assert.deepEqual(inspectBadging("package: name='org.other.app'\n"), { packageName: 'org.other.app', minSdk: 1, abis: [] });
  assert.throws(() => inspectBadging("package: name='org.example.app' split='config.arm64_v8a'"), /Split APKs/);
  assert.throws(() => inspectBadging("package: name='org.example;command'"), /package name/);
  assert.throws(() => new AndroidHostPool({ serials: ['a-physical-phone'] }), /disposable emulator/);
  const pool = new AndroidHostPool(); assert.equal(pool.capabilities().enabled, false);
  await assert.rejects(pool.start('/nonexistent.apk', () => {}, new AbortController().signal), /No Android/);
});
