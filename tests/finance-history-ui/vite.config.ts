import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  optimizeDeps: { entries: ['tests/finance-history-ui/index.html'] },
  plugins: [{ name: 'finance-history-fixture', enforce: 'pre', resolveId(source, importer) {
    if (importer?.replaceAll('\\', '/').includes('/src/') && /\/(DatabaseContext|AuthContext|financeLedgerService|cashbookService|financeOperationService|student360Service)$/.test(source)) return resolve('tests/finance-history-ui/mocks.ts')
  } }, react()],
})
