import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  optimizeDeps: { entries: ['tests/staff-dashboard-ui/index.html'] },
  plugins: [{ name: 'staff-dashboard-read-fixture', enforce: 'pre', resolveId(source, importer) {
    if (!importer?.replaceAll('\\', '/').includes('/src/')) return
    if (['/contexts/AuthContext', '/hooks/useWorkspaceSync', '/features/ui-rollout/AuraUiRolloutContext', '/services/ptOperationsV2Service', '/services/staffPayrollService', '/services/performanceScoreService', '/services/actionCenterService', '/lib/firebaseFunctions'].some((suffix) => source.endsWith(suffix))) return resolve('tests/staff-dashboard-ui/mocks.ts')
  } }, react()],
})
