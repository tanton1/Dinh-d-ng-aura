import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  optimizeDeps: { entries: ['tests/nutrition-review-ui/index.html'] },
  plugins: [{
    name: 'review-service-fixture',
    enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('/services/nutritionReviewService')) return resolve('tests/nutrition-review-ui/service.ts')
      if (source.endsWith('/contexts/AuthContext')) return resolve('tests/nutrition-review-ui/auth.ts')
    },
  }, react()],
})
