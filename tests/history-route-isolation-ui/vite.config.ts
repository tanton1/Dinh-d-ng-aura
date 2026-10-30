import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  optimizeDeps: { entries: ['tests/history-route-isolation-ui/index.html'] },
  plugins: [{ name: 'history-route-isolation', enforce: 'pre', resolveId(source, importer) {
    if (!importer?.replaceAll('\\', '/').includes('/src/')) return
    if (['/services/financeLedgerService', '/services/cashbookService'].some(suffix => source.endsWith(suffix)) || source === './FinanceIntentBoundary'
      || (importer.replaceAll('\\', '/').endsWith('/scopedReportingService.ts') && ['/readOnlyCallableService', '/lib/firebaseFunctions'].some(suffix => source.endsWith(suffix)))) return resolve('tests/history-route-isolation-ui/finance-mocks.tsx')
    if (source === 'firebase/firestore' || ['/lib/firebaseFirestore', '/contexts/AuthContext', '/features/ui-rollout/AuraUiRolloutContext', '/services/scheduleConfigManagementService', '/services/studentManagementService', '/services/branchManagementService', '/services/ptOperationsV2Service', '/features/student-360/student360Service', '/hooks/useWorkspaceSync'].some((suffix) => source.endsWith(suffix)) || source === './AuthContext') return resolve('tests/history-route-isolation-ui/mocks.ts')
  } }, react()],
})
