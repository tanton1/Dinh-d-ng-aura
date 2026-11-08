import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Mounts the real CRM workspace with its demo transport; no Firebase calls.
export default defineConfig({
  cacheDir: resolve('test-results/crm-ui-vite-cache'),
  optimizeDeps: { entries: ['tests/crm-ui/index.html'] },
  plugins: [react()],
})
