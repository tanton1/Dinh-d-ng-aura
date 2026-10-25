import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  workers: 2,
  testMatch: ['academy-*.spec.ts'],
  use: {
    baseURL: 'http://127.0.0.1:4179',
    trace: 'retain-on-failure',
    launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {},
  },
  projects: [{ name: 'academy-chromium' }],
  webServer: {
    command: 'npx vite --config tests/e2e/vite.academy.config.ts --mode e2e --host 127.0.0.1 --port 4179',
    url: 'http://127.0.0.1:4179/tests/e2e/fixtures/academy-modules.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
