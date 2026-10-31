import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({ optimizeDeps: { entries: ['tests/finance-reconciliation-ui/index.html'] }, plugins: [{ name: 'finance-fixture', enforce: 'pre', resolveId(source) {
  if (['/contexts/DatabaseContext', '/services/businessReportingService', '/services/financeReconciliationService'].some(suffix => source.endsWith(suffix))) return resolve('tests/finance-reconciliation-ui/fixtures.ts')
} }, react()] })
