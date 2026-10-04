import { test, expect } from '@playwright/test';
import path from 'node:path';

async function roomPair(browser, options = {}) {
  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const host = await hostContext.newPage(), guest = await guestContext.newPage();
  await host.goto('/'); await expect(host.locator('#server-status')).toHaveText('Room server online');
  if (options.import) await host.locator('#game-file').setInputFiles(path.resolve('public/games/paddle-duel.html'));
  await host.locator('#player-name').fill('Alex'); await host.locator('#create-room').click();
  await expect(host.locator('#room-view')).toBeVisible();
  const code = await host.locator('#invite-code').textContent();
  await guest.goto(`/?room=${code}`); await expect(guest.locator('#server-status')).toHaveText('Room server online');
  await guest.locator('#player-name').fill('Sam'); await guest.locator('#join-room').click();
  await expect(host.locator('#peer-status')).toHaveText('Direct game connection', { timeout: 25000 });
  await expect(guest.locator('#peer-status')).toHaveText('Direct game connection', { timeout: 25000 });
  await expect(guest.locator('#game-video')).toBeVisible();
  return { host, guest, hostContext, guestContext, code };
}

test('one offline game runs on the host; remote video, player-two input, chat, pause, and rejoining work', async ({ browser }) => {
  const { host, guest, hostContext, guestContext, code } = await roomPair(browser);
  const hostFrame = host.frameLocator('#game-frame');
  await expect(hostFrame.locator('canvas')).toHaveAttribute('data-player2', '250');
  expect(await guest.locator('#game-frame').getAttribute('srcdoc')).toBeNull();
  await expect.poll(() => guest.locator('#game-video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
  await guest.keyboard.down('ArrowUp');
  await expect.poll(() => hostFrame.locator('canvas').getAttribute('data-player2')).not.toBe('250');
  await guest.keyboard.up('ArrowUp');
  await expect(hostFrame.locator('canvas')).toHaveAttribute('data-player1', '250');
  const afterRelease = await hostFrame.locator('canvas').getAttribute('data-player2');
  await guest.locator('#chat-input').fill('<img src=x onerror=alert(1)> hello Alex'); await guest.locator('#chat-form button').click();
  await expect(host.locator('.chat-message p')).toHaveText('<img src=x onerror=alert(1)> hello Alex');
  expect(await host.locator('.chat-message img').count()).toBe(0);
  await expect(hostFrame.locator('canvas')).toHaveAttribute('data-player2', afterRelease);
  await host.locator('#start-game').click(); await expect(hostFrame.locator('canvas')).toHaveAttribute('data-paused', 'false');
  await expect(guest.locator('#room-description')).toContainText('You’re connected');
  await host.locator('#start-game').click(); await expect(hostFrame.locator('canvas')).toHaveAttribute('data-paused', 'true');
  await guest.locator('#leave-room').click(); await expect(host.locator('#player-count')).toHaveText('1 / 2');
  await expect(host.locator('#peer-status')).toHaveText('Waiting for player 2');
  await guest.locator('#room-code').fill(code); await guest.locator('#join-room').click();
  await expect(host.locator('#peer-status')).toHaveText('Direct game connection', { timeout: 25000 });
  await host.locator('#leave-room').click(); await expect(guest.locator('#library-view')).toBeVisible();
  await hostContext.close(); await guestContext.close();
});

test('imported game stays on the host, persists on device, and uses the same remote control bridge', async ({ browser }) => {
  const { host, guest, hostContext, guestContext } = await roomPair(browser, { import: true });
  await guest.locator('#move-down').dispatchEvent('pointerdown', { pointerId: 1 });
  await expect.poll(() => host.frameLocator('#game-frame').locator('canvas').getAttribute('data-player2')).not.toBe('250');
  await guest.locator('#move-down').dispatchEvent('pointerup', { pointerId: 1 });
  await host.locator('#leave-room').click();
  await host.reload(); await expect(host.locator('.game-card')).toHaveCount(2);
  await hostContext.close(); await guestContext.close();
});

test('library is responsive, room errors are visible, and unsupported APK imports are rejected', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.locator('#server-status')).toHaveText('Room server online');
  await page.screenshot({ path: 'artifacts/library-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/library-mobile.png', fullPage: true });
  await page.locator('#player-name').fill('Sam'); await page.locator('#room-code').fill('ABC234'); await page.locator('#join-room').click();
  await expect(page.locator('#toast')).toContainText('Room not found');
  await page.locator('#game-file').setInputFiles({ name: 'game.apk', mimeType: 'application/octet-stream', buffer: Buffer.from('test') });
  await expect(page.locator('#toast')).toContainText('APK and ROM'); expect(errors).toEqual([]);
});
