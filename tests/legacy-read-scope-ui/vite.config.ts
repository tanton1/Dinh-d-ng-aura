import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  cacheDir: resolve('test-results/legacy-read-scope-vite-cache'),
  optimizeDeps: { entries: ['tests/legacy-read-scope-ui/index.html'] },
  plugins: [{ name: 'legacy-read-boundaries', enforce: 'pre', resolveId(source, importer) {
    if (!importer?.replaceAll('\\', '/').includes('/src/')) return
    if (['firebase/firestore', 'firebase/auth', './AuthContext'].includes(source)
      || ['/lib/firebase', '/lib/firebaseFirestore', '/features/student-360/student360Service', '/features/ui-rollout/AuraUiRolloutContext', '/services/scheduleConfigManagementService', '/services/studentManagementService', '/services/branchManagementService'].some(suffix => source.endsWith(suffix))) return resolve('tests/legacy-read-scope-ui/mocks.ts')
  } }, react()],
})
