import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  optimizeDeps: { entries: ['tests/training-history-panel-ui/index.html'] },
  plugins: [{ name: 'history-panel-fixture', enforce: 'pre', resolveId(source) {
    if (['/contexts/AuthContext', '/contexts/DatabaseContext', '/services/businessReportingService', '/services/sessionOperationsService'].some((suffix) => source.endsWith(suffix))) return resolve('tests/training-history-panel-ui/fixtures.ts')
  } }, react()],
})
