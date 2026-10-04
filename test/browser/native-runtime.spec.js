import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const nativeAssets = path.resolve('experiments/html-runtime/assets');
const assetPaths = new Map([
  ['/assets/game.html', path.join(nativeAssets, 'game.html')],
  ['/assets/game.js', path.join(nativeAssets, 'game.js')],
  ['/assets/runtime.js', path.resolve('public/runtime.js')],
]);

test('legacy HTML experiment bridges one offline game through its former messaging contract', async ({ browser }) => {
  const hostContext = await browser.newContext(), guestContext = await browser.newContext();
  const host = await hostContext.newPage(), guest = await guestContext.newPage();
  const errors = [], hostEvents = [], guestEvents = [];
  const setup = async (page, target, events) => {
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://appassets.androidplatform.net/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const file = assetPaths.get(pathname);
      if (!file) { await route.abort(); return; }
      await route.fulfill({ body: await readFile(file), contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html' });
    });
    await page.exposeBinding('__nativeEvent', async ({ frame }, packet) => {
      if (frame !== page.mainFrame()) return;
      events.push(packet);
      if (packet.type === 'signal') await target.evaluate(data => window.NativeGame.receive({ type: 'signal', data }), packet.data);
    });
    await page.addInitScript(() => {
      // Mirror the former HTML bridge origin/main-frame restriction.
      if (window.parent === window) window.nativeGame = { postMessage: text => window.__nativeEvent(JSON.parse(text)) };
    });
    await page.goto('https://appassets.androidplatform.net/assets/game.html');
  };
  await setup(host, guest, hostEvents);
  await setup(guest, host, guestEvents);
  const html = await readFile(path.resolve('public/games/paddle-duel.html'), 'utf8');
  await guest.evaluate(() => window.NativeGame.init({ role: 'guest', html: '', iceServers: [] }));
  await host.evaluate(html => window.NativeGame.init({ role: 'host', html, iceServers: [] }), html);
  await expect.poll(() => hostEvents.some(event => event.type === 'runtime-ready')).toBe(true);
  await host.evaluate(() => window.NativeGame.receive({ type: 'connect', iceServers: [], session: 'native-harness' }));
  await expect.poll(() => hostEvents.some(event => event.type === 'controls-ready'), { timeout: 25000 }).toBe(true);
  await expect.poll(() => guestEvents.some(event => event.type === 'controls-ready'), { timeout: 25000 }).toBe(true);
  await expect.poll(() => guest.locator('#screen').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
  const canvas = host.frameLocator('#game').locator('canvas');
  await expect(canvas).toHaveAttribute('data-player2', '250');
  await guest.evaluate(() => window.NativeGame.receive({ type: 'input', keys: ['down'] }));
  await expect.poll(() => canvas.getAttribute('data-player2')).not.toBe('250');
  await expect(canvas).toHaveAttribute('data-player1', '250');
  await guest.evaluate(() => window.NativeGame.receive({ type: 'release' }));
  await expect.poll(() => hostEvents.some(event => event.type === 'runtime-error')).toBe(false);
  await host.evaluate(() => window.NativeGame.receive({ type: 'toggle-play' }));
  await expect(canvas).toHaveAttribute('data-paused', 'false');
  const frame = host.frames().find(frame => frame !== host.mainFrame());
  expect(await frame.evaluate(() => typeof window.nativeGame)).toBe('undefined');
  await host.evaluate(() => window.NativeGame.receive({ type: 'disconnect' }));
  await expect(canvas).toHaveAttribute('data-paused', 'true');
  expect(errors).toEqual([]);
  await hostContext.close(); await guestContext.close();
});
