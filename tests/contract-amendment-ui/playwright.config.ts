import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({ testDir: '.', testMatch: '*.spec.ts', workers: 1, outputDir: '../../test-results/contract-amendment-ui',
  use: { baseURL: 'http://127.0.0.1:4417', trace: 'retain-on-failure' },
  projects: [
    { name: 'amendment-chromium', use: { launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} } },
    { name: 'amendment-mobile-webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: { cwd: fileURLToPath(new URL('../..', import.meta.url)), command: 'npx vite --config tests/contract-amendment-ui/vite.config.ts --host 127.0.0.1 --port 4417',
    url: 'http://127.0.0.1:4417/tests/contract-amendment-ui/index.html', timeout: 60000, reuseExistingServer: false },
})
