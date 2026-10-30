import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeScanQuality } from '../src/features/nutrition/scanQuality'
import type { AiFoodItem } from '../src/features/nutrition/types'

test('scan quality captures numeric correction evidence without copying names, notes, photo or profile', () => {
  const summary = summarizeScanQuality({
    items: [{ id: 'private-id', name: 'private dish', calculationSource: 'manual', assumptions: ['private health note'], image: 'private-photo' } as unknown as AiFoodItem,
      { id: 'other', name: 'other private dish', calculationSource: 'database' } as AiFoodItem],
    baselineCalories: 500, finalCalories: 450, unresolvedItemCount: 1, unresolvedQuestionCount: 2, answeredQuestionCount: 3,
  })
  assert.deepEqual(summary, { schemaVersion: 1, itemCount: 2, manuallyAdjustedItemCount: 1, unresolvedItemCount: 1,
    unresolvedQuestionCount: 2, answeredQuestionCount: 3, baselineCalories: 500, finalCalories: 450, calorieAdjustment: -50 })
  assert.ok(Object.values(summary).every(value => typeof value === 'number' && Number.isFinite(value)))
  assert.doesNotMatch(JSON.stringify(summary), /private|photo|health|dish/)
})
