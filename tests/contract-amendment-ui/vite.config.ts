import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({ cacheDir: resolve('test-results/contract-amendment-vite'), plugins: [react()], optimizeDeps: { entries: ['tests/contract-amendment-ui/index.html'] } })
