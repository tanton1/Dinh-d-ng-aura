import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  cacheDir: resolve('test-results/student360-overview-vite-cache'),
  optimizeDeps: { entries: ['tests/student360-overview-ui/index.html'] },
  plugins: [{ name: 'student360-overview-boundaries', enforce: 'pre', resolveId(source, importer) {
    if (!importer?.replaceAll('\\', '/').includes('/src/')) return
    if (source === './Student360ContractWorkspace') return resolve('tests/student360-overview-ui/ContractWorkspace.tsx')
    if (source.endsWith('/StudentTrainingHistory')) return resolve('tests/student360-overview-ui/TrainingHistory.tsx')
    if (source === 'firebase/auth' || /\/(firebase|AuthContext|student360Service|businessReportingService|AuraUiRolloutContext|loyaltyService|analyticsService)$/.test(source)) return resolve('tests/student360-overview-ui/mocks.ts')
  } }, react()],
})
