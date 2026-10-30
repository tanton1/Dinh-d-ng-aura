import { defineConfig } from '@playwright/test'
import renewalConfig from './playwright.renewal.config'

export default defineConfig({
  ...renewalConfig,
  testMatch: ['contract-renewal-handover.spec.ts', 'nutrition-queue-wait.spec.ts', 'workout-save-recovery.spec.ts'],
})
