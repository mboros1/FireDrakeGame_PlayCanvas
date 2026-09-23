import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Local runs use the installed Chrome (Metal-backed WebGL); elsewhere, the
// Playwright-managed browser if one is installed.
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: existsSync(CHROME) ? { executablePath: CHROME } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 120_000
    },
    {
      // The room server, for tests/multiplayer.spec.ts. 8787 because 8080
      // is commonly taken on development machines.
      command: 'npm run server:dev',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: true,
      timeout: 120_000
    }
  ]
});
