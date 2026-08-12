import { defineConfig, devices } from '@playwright/test'

const localChromeExecutable = process.platform === 'win32' && !process.env.CI
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : undefined
const previewCommand = process.env.CI
  ? 'npx vite build --mode e2e && npm run preview -- --host 127.0.0.1 --port 4173'
  : 'npm run preview -- --host 127.0.0.1 --port 4173'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    launchOptions: localChromeExecutable ? { executablePath: localChromeExecutable } : undefined,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: previewCommand,
    env: process.env.CI ? { VITE_FORCE_DEMO: 'true' } : undefined,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
