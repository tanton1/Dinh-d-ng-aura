import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          const normalizedId = id.replaceAll('\\', '/')
          if (normalizedId.includes('/@firebase/messaging/') || normalizedId.includes('/firebase/messaging/')) return 'vendor-firebase-messaging'
          if (normalizedId.includes('/@firebase/app-check/') || normalizedId.includes('/firebase/app-check/')) return 'vendor-firebase-app-check'
          if (id.includes('/firebase/') || id.includes('/@firebase/') || id.includes('node_modules\\firebase') || id.includes('node_modules\\@firebase')) return 'vendor-firebase'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/') || id.includes('node_modules\\react') || id.includes('node_modules\\scheduler')) return 'vendor-react'
          if (id.includes('lucide-react')) return 'vendor-icons'
          if (id.includes('/motion/') || id.includes('/motion-') || id.includes('node_modules\\motion')) return 'vendor-motion'
          if (id.includes('@google/genai')) return 'vendor-ai'
          if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('/zod/')) return 'vendor-forms'
          return undefined
        },
      },
    },
  },
  server: {
    host: true,
    port: 3000,
  },
})
