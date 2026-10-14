import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1,
  outputDir: fileURLToPath(new URL('./test-results', import.meta.url)),
  use: {
    baseURL: 'http://127.0.0.1:4191', timezoneId: 'Asia/Ho_Chi_Minh',
    launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {},
  },
  webServer: {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    command: 'npx vite --config tests/nutrition-review-ui/vite.config.ts --host 127.0.0.1 --port 4191',
    url: 'http://127.0.0.1:4191/tests/nutrition-review-ui/index.html', reuseExistingServer: false, timeout: 60_000,
  },
})
