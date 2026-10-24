import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1,
  outputDir: fileURLToPath(new URL('../../test-results/admin-dashboard', import.meta.url)),
  use: { baseURL: 'http://127.0.0.1:4207', timezoneId: 'Asia/Ho_Chi_Minh' },
  projects: [
    { name: 'dashboard-desktop', use: { launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} } },
    { name: 'dashboard-mobile', use: { ...devices['iPhone 14'] } },
  ],
  webServer: { cwd: fileURLToPath(new URL('../..', import.meta.url)), command: 'npx vite --config tests/admin-dashboard-ui/vite.config.ts --host 127.0.0.1 --port 4207', url: 'http://127.0.0.1:4207/tests/admin-dashboard-ui/index.html', reuseExistingServer: false, timeout: 60_000 },
})
