import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  workers: 2,
  testMatch: ['academy-modules.spec.ts', 'academy-submissions.spec.ts', 'academy-authoring.spec.ts', 'academy-delivery.spec.ts', 'academy-review.spec.ts', 'academy-media.spec.ts', 'academy-adoption.spec.ts', 'academy-learner-content.spec.ts'],
  use: {
    baseURL: 'http://127.0.0.1:4179',
    launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {},
  },
  projects: [{ name: 'academy-chromium' }],
  webServer: {
    command: 'npx vite --config tests/e2e/vite.academy.config.ts --mode e2e --host 127.0.0.1 --port 4179',
    url: 'http://127.0.0.1:4179/tests/e2e/fixtures/academy-modules.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
