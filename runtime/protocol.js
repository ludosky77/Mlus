import { EventEmitter } from 'node:events';

// scrcpy 4.0: codec header, session metadata, then framed H.264 access units.
export class VideoParser extends EventEmitter {
  buffer = Buffer.alloc(0);
  codec = false;
  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.codec) {
      if (this.buffer.length < 4) return;
      if (this.buffer.readUInt32BE(0) !== 0x68323634) throw new Error('Android host did not provide H.264 video.');
      this.buffer = this.buffer.subarray(4); this.codec = true;
    }
    while (this.buffer.length >= 12) {
      const flags = this.buffer.readBigUInt64BE(0);
      if (flags & (1n << 63n)) {
        const width = this.buffer.readUInt32BE(4), height = this.buffer.readUInt32BE(8);
        if (!width || !height || width > 8192 || height > 8192) throw new Error('Invalid Android display size.');
        this.emit('format', { codec: 'h264', width, height }); this.buffer = this.buffer.subarray(12); continue;
      }
      const length = this.buffer.readUInt32BE(8);
      if (!length || length > 8 * 1024 * 1024) throw new Error('Invalid Android video packet.');
      if (this.buffer.length < 12 + length) return;
      const config = !!(flags & (1n << 62n)), keyframe = !!(flags & (1n << 61n));
      const packet = Buffer.allocUnsafe(9 + length);
      packet[0] = (config ? 1 : 0) | (keyframe ? 2 : 0);
      packet.writeBigUInt64BE(flags & ((1n << 61n) - 1n), 1);
      this.buffer.copy(packet, 9, 12, 12 + length);
      this.emit('frame', packet);
      this.buffer = this.buffer.subarray(12 + length);
    }
  }
}

export function touchPacket(action, pointer, x, y, width, height) {
  const packet = Buffer.alloc(32);
  packet[0] = 2; packet[1] = action;
  packet.writeBigUInt64BE(BigInt(pointer), 2);
  packet.writeUInt32BE(Math.min(width - 1, Math.floor(x * width)), 10);
  packet.writeUInt32BE(Math.min(height - 1, Math.floor(y * height)), 14);
  packet.writeUInt16BE(width, 18); packet.writeUInt16BE(height, 20);
  packet.writeUInt16BE(action === 1 ? 0 : 0xffff, 22);
  return packet;
}

export class TouchRouter {
  constructor(write, clock = Date.now) { this.write = write; this.clock = clock; this.players = new Map(); this.width = 0; this.height = 0; }
  resize(width, height) { this.releaseAll(); this.width = width; this.height = height; }
  input(slot, contacts) {
    if (![0, 1].includes(slot) || !Array.isArray(contacts) || contacts.length > 5) throw new Error('Invalid touch input.');
    const next = new Map();
    for (const point of contacts) {
      if (!point || !Number.isInteger(point.id) || point.id < 0 || point.id > 4 || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 || next.has(point.id)) throw new Error('Invalid touch input.');
      next.set(point.id, point);
    }
    if (!this.width || !this.height) return;
    const previous = this.players.get(slot)?.contacts ?? new Map();
    for (const [id, point] of previous) if (!next.has(id)) this.write(touchPacket(1, slot * 5 + id, point.x, point.y, this.width, this.height));
    for (const [id, point] of next) this.write(touchPacket(previous.has(id) ? 2 : 0, slot * 5 + id, point.x, point.y, this.width, this.height));
    this.players.set(slot, { contacts: next, at: this.clock() });
  }
  release(slot) { this.input(slot, []); this.players.delete(slot); }
  releaseAll() { for (const slot of [...this.players.keys()]) this.release(slot); }
  expire() { for (const [slot, player] of this.players) if (this.clock() - player.at > 1000) this.release(slot); }
}

export function inspectBadging(text) {
  const packageName = text.match(/^package: name='([^']+)'/m)?.[1];
  if (!packageName || !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(packageName)) throw new Error('Invalid APK package name.');
  const minSdk = Number(text.match(/^sdkVersion:'(\d+)'/m)?.[1] ?? 1);
  const abis = [...(text.match(/^native-code:(.*)$/m)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(match => match[1]);
  if (/^package:.*\bsplit='/m.test(text)) throw new Error('Split APKs require a package set and are not supported by this adapter yet.');
  return { packageName, minSdk, abis };
}
