import type { UserRole } from '../../types'
import {
  AURA_UI_SURFACES,
  type AuraUiAssignment,
  type AuraUiAudience,
  type AuraUiRolloutConfig,
  type AuraUiSurface,
} from './types'

const audienceValues = new Set<AuraUiAudience>(['off', 'admin', 'staff', 'all'])
const surfaceValues = new Set<AuraUiSurface>(AURA_UI_SURFACES)

export const DEFAULT_AURA_UI_ROLLOUT: AuraUiRolloutConfig = {
  schemaVersion: 1,
  surfaces: Object.fromEntries(AURA_UI_SURFACES.map((surface) => [surface, 'off'])) as Record<AuraUiSurface, AuraUiAudience>,
  updatedAt: '',
  updatedBy: '',
}

export function normalizeAuraUiRolloutConfig(value: unknown): AuraUiRolloutConfig {
  if (!value || typeof value !== 'object') return DEFAULT_AURA_UI_ROLLOUT
  const source = value as Partial<AuraUiRolloutConfig>
  if (source.schemaVersion !== 1 || !source.surfaces || typeof source.surfaces !== 'object') return DEFAULT_AURA_UI_ROLLOUT
  const inputSurfaces = source.surfaces as Partial<Record<AuraUiSurface, unknown>>
  if (AURA_UI_SURFACES.some((surface) => !audienceValues.has(inputSurfaces[surface] as AuraUiAudience))) {
    return DEFAULT_AURA_UI_ROLLOUT
  }
  const surfaces = Object.fromEntries(AURA_UI_SURFACES.map((surface) => [surface, inputSurfaces[surface]])) as Record<AuraUiSurface, AuraUiAudience>
  return {
    schemaVersion: 1,
    surfaces,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
    updatedBy: typeof source.updatedBy === 'string' ? source.updatedBy : '',
  }
}

export function normalizeAuraUiAssignment(value: unknown): AuraUiAssignment | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<AuraUiAssignment>
  if (!Array.isArray(source.surfaces) || source.surfaces.some((surface) => !surfaceValues.has(surface as AuraUiSurface))) return null
  const surfaces = [...new Set(source.surfaces as AuraUiSurface[])]
  const expiresAt = typeof source.expiresAt === 'string' && source.expiresAt ? source.expiresAt : null
  if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) return null
  return {
    surfaces,
    expiresAt,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
    updatedBy: typeof source.updatedBy === 'string' ? source.updatedBy : '',
  }
}

export function isAuraUiAssignmentActive(assignment: AuraUiAssignment | null, now = Date.now()) {
  return Boolean(assignment && (!assignment.expiresAt || Date.parse(assignment.expiresAt) > now))
}

export function isAuraUiSurfaceEnabled(
  surface: AuraUiSurface,
  role: UserRole,
  config: AuraUiRolloutConfig,
  assignment: AuraUiAssignment | null,
  now = Date.now(),
) {
  // An active personal assignment is authoritative for the whole surface set:
  // included surfaces opt in, omitted surfaces stay on the legacy UI even when
  // the global audience is enabled. This makes per-user rollback deterministic.
  if (isAuraUiAssignmentActive(assignment, now)) return assignment!.surfaces.includes(surface)
  const audience = config.surfaces[surface]
  if (audience === 'all') return true
  if (audience === 'admin') return role === 'admin' || role === 'super_admin'
  if (audience === 'staff') return ['coach', 'trainer', 'sales', 'manager', 'editor'].includes(role)
  return false
}
