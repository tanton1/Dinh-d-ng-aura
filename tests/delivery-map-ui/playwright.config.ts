import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1,
  outputDir: fileURLToPath(new URL('../../test-results/delivery-map', import.meta.url)),
  use: { baseURL: 'http://127.0.0.1:4213' },
  projects: [
    { name: 'map-chromium', use: { launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} } },
    { name: 'map-mobile-webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: { cwd: fileURLToPath(new URL('../..', import.meta.url)), command: 'npx vite --config tests/delivery-map-ui/vite.config.ts --host 127.0.0.1 --port 4213', url: 'http://127.0.0.1:4213/tests/delivery-map-ui/index.html', reuseExistingServer: false, timeout: 60_000 },
})
