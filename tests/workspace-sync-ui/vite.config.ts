import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  optimizeDeps: { entries: ['tests/workspace-sync-ui/index.html'] },
  plugins: [{ name: 'workspace-sync-fixture', enforce: 'pre', resolveId(source, importer) {
    if (importer?.replaceAll('\\', '/').endsWith('/hooks/useWorkspaceSync.ts') && ['firebase/auth', 'firebase/firestore', '../lib/firebase', '../lib/firebaseFirestore'].includes(source)) return resolve('tests/workspace-sync-ui/signals.ts')
    if (['/services/studentPtScheduleService', '/services/ptOperationsV2Service', '/services/firebaseService', '/services/businessReportingService', '/features/student-360/student360Service', '/hooks/useNutritionWeight', '/features/ui-rollout/AuraUiRolloutContext'].some((suffix) => source.endsWith(suffix))) return resolve('tests/workspace-sync-ui/services.ts')
    if (['/features/loyalty/LoyaltyHomeCard', '/components/student/SessionFeedbackPrompt', '/components/schedule/LeaveRequestModal', '/components/schedule/SessionRequestModal', '/components/schedule/AdditionalSessionModal', '/components/training/StudentTrainingHistory'].some((suffix) => source.endsWith(suffix))) return resolve('tests/workspace-sync-ui/unused.tsx')
  } }, react()],
})
