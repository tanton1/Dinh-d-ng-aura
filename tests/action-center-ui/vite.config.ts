import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  optimizeDeps: { entries: ['tests/action-center-ui/index.html'] },
  plugins: [{ name: 'action-center-read-fixture', enforce: 'pre', resolveId(source, importer) {
    if (!importer?.replaceAll('\\', '/').includes('/src/')) return
    if (['/services/actionCenterService', '/lib/firebaseFunctions', '/hooks/useWorkspaceSync'].some((suffix) => source.endsWith(suffix))) return resolve('tests/action-center-ui/mocks.ts')
  } }, react()],
})
