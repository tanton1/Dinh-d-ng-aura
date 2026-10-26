import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const baseURL = 'http://127.0.0.1:4197'
export default defineConfig({
  testDir: '../e2e', testMatch: ['cooking.spec.ts', 'food-library.spec.ts'], workers: 1,
  outputDir: fileURLToPath(new URL('../../test-results/cooking-app', import.meta.url)),
  use: { baseURL, launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    // Keep the production dist intact and use the existing isolated demo mode.
    command: 'npx vite build --mode e2e --outDir .tools/cooking-app-e2e && npx vite preview --outDir .tools/cooking-app-e2e --host 127.0.0.1 --port 4197',
    env: { VITE_FORCE_DEMO: 'true', VITE_ENABLE_DEMO_OTP: 'true' },
    url: baseURL, reuseExistingServer: false, timeout: 120_000,
  },
})
