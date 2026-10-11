import type { NutritionFoodDetailRecord } from '../../pages/student/NutritionFoodDetail'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isNutritionDetailRecord(value: unknown): value is NutritionFoodDetailRecord {
  const record = asRecord(value)
  return Boolean(record && typeof record.id === 'string' && typeof record.nameVi === 'string' && (record.kind === 'dish' || record.kind === 'food'))
}

/**
 * Accept all catalog detail envelopes used by deployed and legacy callers.
 * The current callable is unwrapped to a flat `{ id, kind, nameVi, ... }`
 * object, while older fixtures may use `records` or an id-keyed object.
 */
export function findNutritionDetailRecord(payload: unknown, id: string): NutritionFoodDetailRecord | null {
  if (Array.isArray(payload)) return payload.find((record) => isNutritionDetailRecord(record) && record.id === id) ?? null
  const root = asRecord(payload)
  if (!root) return null
  if (Array.isArray(root.records)) return root.records.find((record) => isNutritionDetailRecord(record) && record.id === id) ?? null
  if (isNutritionDetailRecord(root) && root.id === id) return root
  return isNutritionDetailRecord(root[id]) ? root[id] : null
}
