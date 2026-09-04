export const AURA_UI_SURFACES = [
  'shell',
  'member-home',
  'member-schedule',
  'member-availability',
  'student-360',
  'admin-dashboard',
  'member-nutrition',
] as const

export type AuraUiSurface = typeof AURA_UI_SURFACES[number]
export type AuraUiAudience = 'off' | 'admin' | 'staff' | 'all'

export interface AuraUiRolloutConfig {
  schemaVersion: 1
  surfaces: Record<AuraUiSurface, AuraUiAudience>
  updatedAt: string
  updatedBy: string
}

export interface AuraUiAssignment {
  surfaces: AuraUiSurface[]
  expiresAt: string | null
  updatedAt: string
  updatedBy: string
}

export interface AuraUiRolloutSnapshot {
  config: AuraUiRolloutConfig
  assignment: AuraUiAssignment | null
  source: 'server' | 'session-cache' | 'fallback'
}

