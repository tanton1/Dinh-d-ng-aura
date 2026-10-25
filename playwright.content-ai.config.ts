import { defineConfig, devices } from '@playwright/test'
import academy from './playwright.academy.config'

export default defineConfig({
  ...academy,
  testMatch: ['academy-content-ai.spec.ts'],
  use: { ...academy.use, baseURL: 'http://127.0.0.1:4185' },
  projects: [
    { name: 'content-ai-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'content-ai-mobile-webkit', use: { ...devices['iPhone 14'], launchOptions: {} } },
  ],
  webServer: {
    command: 'npx vite --config tests/e2e/vite.academy.config.ts --mode e2e --host 127.0.0.1 --port 4185',
    url: 'http://127.0.0.1:4185/tests/e2e/fixtures/academy-authoring.html',
    reuseExistingServer: false, timeout: 120_000,
  },
})
