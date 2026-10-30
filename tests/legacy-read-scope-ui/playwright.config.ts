import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1,
  outputDir: fileURLToPath(new URL('../../test-results/legacy-read-scope', import.meta.url)),
  use: { baseURL: 'http://127.0.0.1:4398', timezoneId: 'Asia/Ho_Chi_Minh', trace: 'retain-on-failure' },
  projects: [
    { name: 'legacy-read-chromium', use: { launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} } },
    { name: 'legacy-read-mobile-webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: { cwd: fileURLToPath(new URL('../..', import.meta.url)), command: 'npx vite --config tests/legacy-read-scope-ui/vite.config.ts --host 127.0.0.1 --port 4398', url: 'http://127.0.0.1:4398/tests/legacy-read-scope-ui/index.html', reuseExistingServer: false, timeout: 60_000 },
})
