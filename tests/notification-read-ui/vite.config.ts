import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  cacheDir: resolve('test-results/notification-read-vite-cache'),
  optimizeDeps: { entries: ['tests/notification-read-ui/index.html'] },
  plugins: [{ name: 'notification-read-fixture', enforce: 'pre', resolveId(source, importer) {
    if (importer?.replaceAll('\\', '/').includes('/src/')
      && /\/(notificationService|fcmService|firebaseService|AuraUiRolloutContext|uiRolloutService)$/.test(source)) {
      return resolve('tests/notification-read-ui/mocks.ts')
    }
  } }, react()],
})
