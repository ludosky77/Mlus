import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', timeout: 60_000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3211', headless: true, viewport: { width: 1440, height: 1000 }, launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } },
  webServer: { command: 'node server.js', env: { PORT: '3211', ICE_SERVERS_JSON: '[]' }, url: 'http://127.0.0.1:3211/health', reuseExistingServer: false },
});
