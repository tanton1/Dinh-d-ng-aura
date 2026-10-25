import { defineConfig } from '@playwright/test'
const port = Number(process.env.AURA_SCHEDULE_TEST_PORT || 4187)
export default defineConfig({
  testDir: './tests/schedule-ui', testMatch: '*.spec.ts', workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: 'Asia/Ho_Chi_Minh',
    launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {},
  },
  webServer: { command: `npx vite --config tests/schedule-ui/vite.config.ts --host 127.0.0.1 --port ${port}`, url: `http://127.0.0.1:${port}/tests/schedule-ui/index.html`, reuseExistingServer: false, timeout: 120_000 },
})
