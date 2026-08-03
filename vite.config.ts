import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'

const envConfig: Record<string, string> = {};
try {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values.length > 0) {
      envConfig[`import.meta.env.${key.trim()}`] = JSON.stringify(values.join('=').trim());
    }
  });
} catch (e) {}

export default defineConfig({
  plugins: [react()],
  define: envConfig,
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'firebase-core': ['firebase/app'],
          'firebase-app-check': ['firebase/app-check'],
          'firebase-auth': ['firebase/auth'],
          'firebase-firestore': ['firebase/firestore'],
          'firebase-functions': ['firebase/functions'],
          'firebase-storage': ['firebase/storage'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 3000,
  },
})
