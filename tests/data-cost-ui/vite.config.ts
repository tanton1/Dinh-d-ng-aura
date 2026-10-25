import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  optimizeDeps: { entries: ['tests/data-cost-ui/index.html'] },
  plugins: [{ name: 'data-cost-fixture', enforce: 'pre', resolveId(source, importer) {
    if (!importer?.replaceAll('\\', '/').includes('/src/')) return
    if (/(deliveryService|deliveryWorkspaceService|useDriverLocationPublisher|eatCleanService|googleMapsLoader|firebaseService|loyaltyService|nutritionService|nutritionJournalSummaryService|AiCoachBottomSheet)$/.test(source) || source.endsWith('/lib/firebase')) return resolve('tests/data-cost-ui/mocks.ts')
  } }, react()],
})
