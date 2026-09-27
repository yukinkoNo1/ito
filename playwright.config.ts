import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;

/**
 * E2E モード（SPEC §21）: 本番ビルドを Hono が配信する。開発サーバー（5173・8787）とは別のポート。
 * ブラウザは chromium に iPhone 15 のビューポート（WebKit はオフライン時の SW 配信に既知の不具合がある）。
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },
  projects: [
    {
      name: 'iphone15-chromium',
      use: { ...devices['iPhone 15'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: String(PORT), ANTHROPIC_API_KEY: '' },
  },
});
