import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { preparePackage, inspectPackageSet } from '../runtime/packages.js';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/package-sets.json', import.meta.url), 'utf8'));
async function fixture(t, name) {
  const directory = await mkdtemp(path.join(tmpdir(), 'bridge-package-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'app.apks'); await writeFile(file, Buffer.from(fixtures[name], 'base64')); return file;
}

test('installed APK sets extract exact bytes with the base first and clean up afterwards', async t => {
  const file = await fixture(t, 'valid'); const prepared = await preparePackage(file, 'apk-set');
  t.after(prepared.cleanup);
  assert.deepEqual(prepared.files.map(file => path.basename(file)), ['base.apk', 'split-1.apk']);
  assert.equal(await readFile(prepared.files[0], 'utf8'), 'base package fixture');
  assert.equal(await readFile(prepared.files[1], 'utf8'), 'native split fixture');
  await prepared.cleanup(); await assert.rejects(access(prepared.files[0]), { code: 'ENOENT' });
});

test('package-set extraction rejects traversal, duplicates, missing bases and links', async t => {
  for (const name of ['traversal', 'duplicate', 'no_base', 'unexpected', 'symlink', 'single']) {
    await assert.rejects(preparePackage(await fixture(t, name), 'apk-set'), undefined, name);
  }
});

test('package-set extraction enforces size and count limits and respects cancellation', async t => {
  const file = await fixture(t, 'valid');
  await assert.rejects(preparePackage(file, 'apk-set', undefined, { maxBytes: 8 }), /limit/);
  await assert.rejects(preparePackage(file, 'apk-set', undefined, { maxFiles: 1 }), /count/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(preparePackage(file, 'apk-set', abort.signal), { name: 'AbortError' });
  await assert.rejects(preparePackage(file, 'unknown'), /Unsupported/);
});

const badging = (name, version = '7', split = '') => `package: name='${name}' versionCode='${version}'${split ? ` split='${split}'` : ''}\nsdkVersion:'26'\n${split ? "native-code: 'arm64-v8a'" : ''}`;
test('a package set checks every split identity/version and includes native requirements', async () => {
  const map = { base: badging('dev.sample.game'), split: badging('dev.sample.game', '7', 'config.arm64') };
  const info = await inspectPackageSet(['base', 'split'], async name => map[name]);
  assert.equal(info.packageName, 'dev.sample.game'); assert.deepEqual(info.abis, ['arm64-v8a']);
  for (const invalid of [badging('dev.other.app', '7', 'config.arm64'), badging('dev.sample.game', '8', 'config.arm64'), badging('dev.sample.game')]) {
    await assert.rejects(inspectPackageSet(['base', 'split'], async name => name === 'base' ? map.base : invalid), /split|same app/);
  }
  await assert.rejects(inspectPackageSet(['split'], async () => map.split), /base APK/);
  await assert.rejects(inspectPackageSet(['base', 'split', 'split'], async name => map[name]), /Duplicate/);
});
