import { defineConfig, devices } from '@playwright/test'

const localChromeExecutable = process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : undefined
// Always create the deterministic E2E bundle before starting the preview.
// Reusing an arbitrary production `dist` locally makes every protected route
// redirect to Auth and produces a large set of false-negative UI failures.
const previewCommand = 'npx vite build --mode e2e && npm run preview -- --host 127.0.0.1 --port 4173'

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
    // The same flags are also committed in .env.e2e, because Vite replaces
    // client-side VITE_* values at build time rather than at preview time.
    env: process.env.CI ? { VITE_FORCE_DEMO: 'true', VITE_ENABLE_DEMO_OTP: 'true' } : undefined,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
