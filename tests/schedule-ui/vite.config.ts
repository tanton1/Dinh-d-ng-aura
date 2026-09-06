import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({ optimizeDeps: { entries: ['tests/schedule-ui/index.html'] }, plugins: [{ name: 'schedule-test-adapters', enforce: 'pre', resolveId(id) {
  if (id.endsWith('/services/ptSchedulePublishService')) return resolve('tests/schedule-ui/service.ts')
  if (id.endsWith('/lib/firebaseFirestore')) return resolve('tests/schedule-ui/firestore.ts')
} }, react()] })
