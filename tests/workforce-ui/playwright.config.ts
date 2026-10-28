import {defineConfig,devices} from '@playwright/test'
import {fileURLToPath} from 'node:url'
export default defineConfig({
 testDir:'.',testMatch:'*.spec.ts',workers:1,
 outputDir:fileURLToPath(new URL('../../test-results/workforce',import.meta.url)),
 use:{baseURL:'http://127.0.0.1:4212'},
 projects:[{name:'workforce-chromium',use:{launchOptions:process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{}}},{name:'workforce-webkit',use:{...devices['iPhone 14']}}],
 webServer:{cwd:fileURLToPath(new URL('../..',import.meta.url)),command:'npx vite --mode e2e --host 127.0.0.1 --port 4212',url:'http://127.0.0.1:4212/tests/workforce-ui/index.html',reuseExistingServer:!process.env.CI,timeout:60000},
})
