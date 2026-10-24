import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1,
  outputDir: fileURLToPath(new URL('../../test-results/training-history-workspace', import.meta.url)),
  use: { baseURL: 'http://127.0.0.1:4198', timezoneId: 'Asia/Ho_Chi_Minh' },
  projects: [
    { name: 'history-desktop', use: { launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} } },
    { name: 'history-mobile', use: { ...devices['iPhone 14'] } },
  ],
  webServer: { cwd: fileURLToPath(new URL('../..', import.meta.url)), command: 'npx vite --config tests/training-history-workspace-ui/vite.config.ts --host 127.0.0.1 --port 4198', url: 'http://127.0.0.1:4198/tests/training-history-workspace-ui/index.html', reuseExistingServer: false, timeout: 60_000 },
})
