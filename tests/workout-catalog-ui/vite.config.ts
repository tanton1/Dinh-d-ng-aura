import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  optimizeDeps: { entries: ['tests/workout-catalog-ui/index.html'] },
  plugins: [{
    name: 'workout-catalog-fixture', enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('/services/exerciseCatalogService') || source.endsWith('/services/ptWorkoutTrackingService') || source.endsWith('/services/exerciseCatalogMediaService')) return resolve('tests/workout-catalog-ui/service.ts')
    },
  }, react()],
})
