import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  optimizeDeps: { entries: ['tests/cooking-ui/index.html'] },
  plugins: [{ name: 'cooking-fixture', enforce: 'pre', resolveId(source) {
    if (source.endsWith('/NotificationCenter') || source.endsWith('/utils/routePreloader') || source.endsWith('/features/ui-rollout/AuraUiRolloutContext')) return resolve('tests/cooking-ui/mocks.tsx')
  } }, react()],
})
