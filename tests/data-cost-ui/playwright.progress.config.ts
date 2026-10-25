import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import base from './playwright.config'
export default defineConfig({
  ...base, testMatch: 'progress-summary.spec.ts', testIgnore: [],
  outputDir: fileURLToPath(new URL('../../test-results/progress-summary', import.meta.url)),
  use: { baseURL: 'http://127.0.0.1:4207', timezoneId: 'Asia/Ho_Chi_Minh' },
  projects: [
    { name: 'progress-chromium', use: { launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {} } },
    { name: 'progress-mobile-webkit', use: { ...devices['iPhone 14'] } },
  ],
})
