import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/schedule-ui', testMatch: '*.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4187', launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} },
  webServer: { command: 'npx vite --config tests/schedule-ui/vite.config.ts --host 127.0.0.1 --port 4187', url: 'http://127.0.0.1:4187/tests/schedule-ui/index.html', reuseExistingServer: false, timeout: 120_000 },
})
