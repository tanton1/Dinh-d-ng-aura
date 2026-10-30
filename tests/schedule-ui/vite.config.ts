import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({ cacheDir: resolve('test-results/schedule-ui-vite-cache'), optimizeDeps: { entries: ['tests/schedule-ui/index.html'] }, plugins: [{ name: 'schedule-test-adapters', enforce: 'pre', resolveId(id) {
  if (id === 'firebase/firestore') return resolve('tests/schedule-ui/firestoreSdk.ts')
  if (id.endsWith('/services/ptSchedulePublishService')) return resolve('tests/schedule-ui/service.ts')
  if (id.endsWith('/lib/firebaseFirestore')) return resolve('tests/schedule-ui/firestore.ts')
  if (['/services/ptOperationsV2Service', '/services/identityAccessService', '/services/payrollService', '/contexts/DatabaseContext'].some((suffix) => id.endsWith(suffix))) return resolve('tests/schedule-ui/trainer-service.ts')
} }, react()] })
