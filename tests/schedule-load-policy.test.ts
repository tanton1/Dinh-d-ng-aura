import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeScheduleLoadPolicy, trainerDailyLoadTarget } from '../src/config/scheduleLoadPolicy'
import { createRequire } from 'node:module'
const backend = createRequire(import.meta.url)('../functions/schedule-load-policy.js')

test('schedule load policy defaults safely and keeps PT-specific target authoritative', () => {
  const policy = normalizeScheduleLoadPolicy({ defaultDailyTargets: { full_time: 6, part_time: 5 } })
  assert.deepEqual(policy.defaultDailyTargets, { full_time: 6, part_time: 5, collaborator: 8 })
  assert.equal(trainerDailyLoadTarget({ employmentType: 'full_time' }, policy), 6)
  assert.equal(trainerDailyLoadTarget({ employmentType: 'part_time', dailySessionTarget: 9 }, policy), 9)
  assert.equal(trainerDailyLoadTarget({ employmentType: 'collaborator', dailySessionTarget: 99 }, policy), 12)
})

test('schedule load target is a soft balancing reference', () => {
  assert.equal(trainerDailyLoadTarget({ employmentType: 'full_time', dailySessionTarget: 0 }, null), 8)
  assert.equal(trainerDailyLoadTarget({ employmentType: 'unknown' }, null), 8)
})

test('client and server policy normalization stay identical for legacy and invalid values', () => {
  for (const policy of [null, {}, { defaultDailyTargets: { full_time: 3, part_time: 6, collaborator: 2 } }]) {
    assert.deepEqual(normalizeScheduleLoadPolicy(policy), backend.normalizeScheduleLoadPolicy(policy))
    for (const employmentType of ['full_time', 'part_time', 'collaborator', 'unknown']) {
      for (const dailySessionTarget of [undefined, 0, 1, 9, 12, 99, -1, NaN, Infinity]) {
        const trainer = { employmentType, dailySessionTarget }
        assert.equal(trainerDailyLoadTarget(trainer, policy), backend.trainerDailyLoadTarget(trainer, policy))
      }
    }
  }
})
