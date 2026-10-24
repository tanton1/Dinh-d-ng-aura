import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'operations-request-center.spec.ts',
  outputDir: 'test-results/operations-requests',
  use: {
    baseURL: 'http://127.0.0.1:4195',
    launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {},
  },
  projects: [{ name: 'operations-requests-chromium' }],
  webServer: {
    command: 'npx vite --mode e2e --host 127.0.0.1 --port 4195 --strictPort',
    url: 'http://127.0.0.1:4195/tests/e2e/fixtures/operations-request-center.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
