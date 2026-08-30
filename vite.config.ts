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
          if (normalizedId.includes('/@firebase/auth/') || normalizedId.includes('/firebase/auth/')) return 'vendor-firebase-auth'
          if (normalizedId.includes('/@firebase/firestore/') || normalizedId.includes('/firebase/firestore/')) return 'vendor-firebase-firestore'
          if (normalizedId.includes('/@firebase/storage/') || normalizedId.includes('/firebase/storage/')) return 'vendor-firebase-storage'
          if (normalizedId.includes('/@firebase/functions/') || normalizedId.includes('/firebase/functions/')) return 'vendor-firebase-functions'
          if (normalizedId.includes('/@firebase/') || normalizedId.includes('/firebase/')) return 'vendor-firebase-core'
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
