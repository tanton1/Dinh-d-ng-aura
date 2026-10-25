import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  optimizeDeps: { entries: ['tests/delivery-map-ui/index.html'] },
  plugins: [{ name: 'delivery-map-fixture', enforce: 'pre', resolveId(source, importer) {
    if (importer?.replaceAll('\\', '/').includes('/src/') && source.endsWith('/googleMapsLoader')) return resolve('tests/delivery-map-ui/mocks.ts')
  } }, react()],
})
