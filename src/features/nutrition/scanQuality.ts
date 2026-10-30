import type { AiFoodItem, ScanQualitySummary } from './types'

/** Captured with the existing meal save, never on reads or as telemetry.
 * No photos, names, free-text answers, health profile or account identifiers. */
export function summarizeScanQuality(input: {
  items: AiFoodItem[]
  baselineCalories: number
  finalCalories: number
  unresolvedItemCount: number
  unresolvedQuestionCount: number
  answeredQuestionCount: number
}): ScanQualitySummary {
  const nonNegative = (value: number) => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  return {
    schemaVersion: 1,
    itemCount: input.items.length,
    manuallyAdjustedItemCount: input.items.filter(item => item.calculationSource === 'manual').length,
    unresolvedItemCount: nonNegative(input.unresolvedItemCount),
    unresolvedQuestionCount: nonNegative(input.unresolvedQuestionCount),
    answeredQuestionCount: nonNegative(input.answeredQuestionCount),
    baselineCalories: nonNegative(input.baselineCalories),
    finalCalories: nonNegative(input.finalCalories),
    calorieAdjustment: nonNegative(input.finalCalories) - nonNegative(input.baselineCalories),
  }
}
