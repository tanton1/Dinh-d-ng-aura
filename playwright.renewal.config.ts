import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'contract-renewal-handover.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:4181',
    launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {},
  },
  projects: [{ name: 'renewal-chromium' }],
  webServer: {
    command: 'npx vite --mode e2e --host 127.0.0.1 --port 4181',
    url: 'http://127.0.0.1:4181/tests/e2e/fixtures/contract-renewal.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
