import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  optimizeDeps: { entries: ['tests/training-history-workspace-ui/index.html'] },
  plugins: [{ name: 'history-workspace-fixture', enforce: 'pre', resolveId(source, importer) {
    const file = importer?.replaceAll('\\', '/') || ''
    if (file.endsWith('/TrainingHistoryWorkspace.tsx') && source === './OperationsRequestCenter') return resolve('tests/training-history-workspace-ui/requests.tsx')
    if (file.endsWith('/TrainingHistoryDirectory.tsx')) {
      if (source === './TrainingHistoryPanel') return resolve('tests/training-history-workspace-ui/panel.tsx')
      if (source.endsWith('/contexts/DatabaseContext') || source.endsWith('/features/student-360/student360Service')) return resolve('tests/training-history-workspace-ui/data.ts')
    }
  } }, react()],
})
