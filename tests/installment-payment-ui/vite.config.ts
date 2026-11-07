import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Mounts the real payment components and service against in-memory callables.
export default defineConfig({
  cacheDir: resolve('test-results/installment-payment-ui-vite-cache'),
  optimizeDeps: { entries: ['tests/installment-payment-ui/index.html'] },
  plugins: [{
    name: 'installment-payment-test-adapters',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'firebase/functions') return resolve('tests/installment-payment-ui/functionsStub.ts')
      if (id.endsWith('/lib/firebaseFunctions')) return resolve('tests/installment-payment-ui/firebaseFunctionsStub.ts')
    },
  }, react()],
})
