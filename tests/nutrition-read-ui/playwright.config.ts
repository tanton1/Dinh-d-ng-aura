import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1,
  outputDir: fileURLToPath(new URL('../../test-results/nutrition-reads', import.meta.url)),
  use: { baseURL: 'http://127.0.0.1:4227', timezoneId: 'Asia/Ho_Chi_Minh' },
  projects: [
    { name: 'nutrition-desktop', use: { launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} } },
    { name: 'nutrition-mobile', use: { ...devices['iPhone 14'] } },
  ],
  webServer: { cwd: fileURLToPath(new URL('../..', import.meta.url)), command: 'npx vite --config tests/nutrition-read-ui/vite.config.ts --host 127.0.0.1 --port 4227', url: 'http://127.0.0.1:4227/tests/nutrition-read-ui/index.html', reuseExistingServer: false, timeout: 60_000 },
})
