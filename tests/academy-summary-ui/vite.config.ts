import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  cacheDir: resolve('test-results/academy-summary-vite-cache'),
  optimizeDeps: { entries: ['tests/academy-summary-ui/index.html'] },
  plugins: [{ name: 'academy-summary-boundaries', enforce: 'pre', resolveId(source, importer) {
    if (importer?.replaceAll('\\', '/').includes('/src/') && (
      source === 'firebase/auth' || /\/(lib\/firebase|services\/(firebaseService|scopedReportingService))$/.test(source)
    )) return resolve('tests/academy-summary-ui/mocks.ts')
  } }, react()],
})
