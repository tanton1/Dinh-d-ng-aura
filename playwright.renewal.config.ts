import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'contract-renewal-handover.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:4181',
  },
  projects: [
    { name: 'renewal-chromium', use: { launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} } },
    { name: 'renewal-mobile-webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: 'npx vite --mode e2e --host 127.0.0.1 --port 4181',
    url: 'http://127.0.0.1:4181/tests/e2e/fixtures/contract-renewal.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
