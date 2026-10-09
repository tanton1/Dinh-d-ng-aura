'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  managedClientCountsFromContracts,
  publicStaffManagedCounts,
  staffSummaryIsStale,
  syncStaffManagedClientSummary,
} = require('./staff-managed-summary')

test('staff summary keeps primary, secondary and nutrition counts deterministic', () => {
  assert.deepEqual(managedClientCountsFromContracts('pt-1', [
    { status: 'active', trainerId: 'pt-1' },
    { status: 'future', trainerIds: ['other', 'pt-1'] },
    { status: 'frozen', nutritionTrainerIds: ['pt-1'] },
    { status: 'completed', trainerId: 'pt-1' },
  ]), { main: 1, secondary: 1, nutrition: 1 })
})

test('staff summary projection marks missing and old values stale without throwing', () => {
  assert.equal(staffSummaryIsStale({}, 10_000), true)
  assert.equal(staffSummaryIsStale({ schemaVersion: 2, managedClientCounts: { main: 1 }, generatedAt: { toMillis: () => 9_000 } }, 10_000), false)
  assert.deepEqual(publicStaffManagedCounts({ schemaVersion: 2, managedClientCounts: { main: '3', secondary: -2, nutrition: 'bad' }, generatedAt: { toMillis: () => 9_000 } }, 10_000), {
    main: 3, secondary: 0, nutrition: 0, stale: false, truncated: false,
  })
})

test('contract trigger refreshes every changed assignment, including removals', async () => {
  const refreshed = []
  const result = await syncStaffManagedClientSummary({
    event: {
      data: {
        before: { exists: true, data: () => ({ status: 'active', trainerId: 'pt-old' }) },
        after: { exists: true, data: () => ({ status: 'active', trainerId: 'pt-new' }) },
      },
    },
    staffIds: ['pt-old', 'pt-new'],
    refresh: async (_db, uid) => { refreshed.push(uid) },
  })
  assert.equal(result.refreshed, 2)
  assert.deepEqual(refreshed, ['pt-old', 'pt-new'])
})
