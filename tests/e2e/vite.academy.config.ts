import { defineConfig, mergeConfig } from 'vite'
import appConfig from '../../vite.config'

// Test artifacts and parallel verification builds are not application sources.
// Watching their replaced files can terminate Vite with EBUSY on Windows.
export default defineConfig(mergeConfig(appConfig, {
  server: { watch: { ignored: ['**/.tools/**', '**/test-results/**', '**/playwright-report/**', '**/*-debug.log'] } },
}))
