import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  optimizeDeps: { entries: ['tests/admin-dashboard-ui/index.html'] },
  plugins: [{ name: 'admin-dashboard-fixture', enforce: 'pre', resolveId(source, importer) {
    const file = importer?.replaceAll('\\', '/') || ''
    if (!file.endsWith('/AdminDashboard.tsx')) return
    if (source.endsWith('/services/operationsDashboardService') || source.endsWith('/services/staffPayrollService') || source.endsWith('/services/analyticsService')) return resolve('tests/admin-dashboard-ui/services.ts')
    if (source.endsWith('/contexts/AuthContext') || source.endsWith('/features/ui-rollout/AuraUiRolloutContext')) return resolve('tests/admin-dashboard-ui/auth.ts')
    if (source.endsWith('/components/operations/OperationalActionCenter')) return resolve('tests/admin-dashboard-ui/action-center.tsx')
  } }, react()],
})
