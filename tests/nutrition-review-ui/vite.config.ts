import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [{
    name: 'review-service-fixture',
    enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('/services/nutritionReviewService')) return resolve('tests/nutrition-review-ui/service.ts')
    },
  }, react()],
})
