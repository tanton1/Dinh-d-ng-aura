import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['operations-request-center.spec.ts', 'student-off.spec.ts'],
  outputDir: 'test-results/operations-requests',
  use: {
    baseURL: 'http://127.0.0.1:4195',
    timezoneId: 'Asia/Ho_Chi_Minh',
  },
  projects: [
    { name: 'operations-requests-chromium', use: { launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} } },
    { name: 'operations-requests-mobile-webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: 'npx vite --mode e2e --host 127.0.0.1 --port 4195 --strictPort',
    url: 'http://127.0.0.1:4195/tests/e2e/fixtures/operations-request-center.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
