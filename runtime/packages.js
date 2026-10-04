import yauzl from 'yauzl';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { inspectBadging } from './protocol.js';

// Bridge exports a plain ZIP containing base.apk and the installed split APKs.
// Extract into owned temporary storage with strict names, counts and byte limits.
export async function preparePackage(file, format = 'apk', signal, { maxBytes = 512 * 1024 * 1024, maxFiles = 128 } = {}) {
  signal?.throwIfAborted();
  if (format === 'apk') return { files: [file], cleanup: async () => {} };
  if (format !== 'apk-set') throw new Error('Unsupported package format.');
  const directory = await mkdtemp(path.join(tmpdir(), 'bridge-splits-'));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  let zip;
  try {
    zip = await yauzl.openPromise(file, { autoClose: false, strictFileNames: true, validateEntrySizes: true });
    if (zip.entryCount < 2 || zip.entryCount > maxFiles) throw new Error('Invalid split package count.');
    const names = new Set(), files = [];
    let declared = 0, actual = 0;
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      const name = entry.fileName;
      if (!/^(base|split-[0-9]+)\.apk$/.test(name) || names.has(name)) throw new Error('Invalid or duplicate APK entry.');
      // Only regular files; never honor links, permissions or paths from the archive.
      const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (unixType && unixType !== 0o100000) throw new Error('APK entries must be regular files.');
      if (entry.isEncrypted() || !entry.uncompressedSize) throw new Error('Unreadable APK entry.');
      names.add(name); declared += entry.uncompressedSize;
      if (names.size > maxFiles || declared > maxBytes) throw new Error('Split package exceeds the extraction limit.');
      const target = path.join(directory, name);
      const meter = new Transform({ transform(chunk, _, done) { actual += chunk.length; done(actual > maxBytes ? new Error('Split package exceeds the extraction limit.') : null, chunk); } });
      await pipeline(await zip.openReadStreamPromise(entry), meter, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
      files.push(target);
    }
    if (!names.has('base.apk')) throw new Error('The split package has no base APK.');
    files.sort((a, b) => (path.basename(a) === 'base.apk' ? -1 : path.basename(b) === 'base.apk' ? 1 : a.localeCompare(b)));
    return { files, cleanup };
  } catch (error) { await cleanup(); throw error; }
  finally { zip?.close(); }
}

export async function inspectPackageSet(files, readBadging) {
  const parts = [];
  for (const file of files) parts.push(inspectBadging(await readBadging(file), { allowSplit: true }));
  const base = parts[0];
  if (!base || base.split) throw new Error('A base APK is required before its splits.');
  const seen = new Set();
  for (const split of parts.slice(1)) {
    if (!split.split || seen.has(split.split)) throw new Error('Duplicate or invalid APK split.');
    if (split.packageName !== base.packageName || split.versionCode !== base.versionCode) throw new Error('The split APKs must belong to the same app and version.');
    seen.add(split.split);
  }
  return { ...base, minSdk: Math.max(...parts.map(p => p.minSdk)), abis: [...new Set(parts.flatMap(p => p.abis))] };
}
