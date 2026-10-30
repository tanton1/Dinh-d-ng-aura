import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1,
  outputDir: fileURLToPath(new URL('../../test-results/student360-overview', import.meta.url)),
  use: { baseURL: 'http://127.0.0.1:4399', timezoneId: 'Asia/Ho_Chi_Minh', trace: 'retain-on-failure' },
  projects: [
    { name: 'student360-overview-chromium', use: { launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} } },
    { name: 'student360-overview-mobile-webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: { cwd: fileURLToPath(new URL('../..', import.meta.url)), command: 'npx vite --config tests/student360-overview-ui/vite.config.ts --host 127.0.0.1 --port 4399', url: 'http://127.0.0.1:4399/tests/student360-overview-ui/index.html', reuseExistingServer: false, timeout: 60_000 },
})
