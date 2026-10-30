import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1,
  outputDir: fileURLToPath(new URL('../../test-results/academy-summary', import.meta.url)),
  use: { baseURL: 'http://127.0.0.1:4397', timezoneId: 'Asia/Ho_Chi_Minh', trace: 'retain-on-failure' },
  projects: [
    { name: 'academy-summary-chromium', use: { launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} } },
    { name: 'academy-summary-mobile-webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    command: 'npx vite --config tests/academy-summary-ui/vite.config.ts --host 127.0.0.1 --port 4397',
    url: 'http://127.0.0.1:4397/tests/academy-summary-ui/index.html',
    reuseExistingServer: false, timeout: 60_000,
  },
})
