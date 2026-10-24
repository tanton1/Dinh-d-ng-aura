import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1,
  outputDir: fileURLToPath(new URL('../../test-results/staff-dashboard', import.meta.url)),
  use: { baseURL: 'http://127.0.0.1:4205', timezoneId: 'Asia/Ho_Chi_Minh', viewport: { width: 390, height: 844 }, launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} },
  webServer: { cwd: fileURLToPath(new URL('../..', import.meta.url)), command: 'npx vite --config tests/staff-dashboard-ui/vite.config.ts --host 127.0.0.1 --port 4205', url: 'http://127.0.0.1:4205/tests/staff-dashboard-ui/index.html', reuseExistingServer: false, timeout: 60_000 },
})
