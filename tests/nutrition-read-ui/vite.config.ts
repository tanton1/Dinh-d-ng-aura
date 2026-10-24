import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  optimizeDeps: { entries: ['tests/nutrition-read-ui/index.html'] },
  plugins: [{ name: 'nutrition-read-fixture', enforce: 'pre', resolveId(source, importer) {
    if (!importer?.replaceAll('\\', '/').includes('/src/')) return
    if (/\/(firebaseService|firebaseNutritionLogService|nutritionPlanService|nutritionJournalSummaryService|analyticsService|nutritionService)$/.test(source)) return resolve('tests/nutrition-read-ui/services.ts')
    if (/\/(firebase|firebaseFirestore)$/.test(source)) return resolve('tests/nutrition-read-ui/auth.ts')
    if (source.endsWith('/contexts/AuthContext') || source.endsWith('/features/ui-rollout/AuraUiRolloutContext')) return resolve('tests/nutrition-read-ui/auth.ts')
    if (source.endsWith('/hooks/useNutritionWeight') || source === './useNutritionWeight') return resolve('tests/nutrition-read-ui/weight.ts')
    if (source.endsWith('/nutrition/catalog') || source === './catalog') return resolve('tests/nutrition-read-ui/catalog.ts')
  } }, react()],
})
