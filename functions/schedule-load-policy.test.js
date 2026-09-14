'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeScheduleLoadPolicy, trainerDailyLoadTarget } = require('./schedule-load-policy')

test('normalizes configurable load targets with safe defaults', () => {
  assert.deepEqual(normalizeScheduleLoadPolicy({ defaultDailyTargets: { full_time: 6, part_time: 5 } }), {
    schemaVersion: 1,
    defaultDailyTargets: { full_time: 6, part_time: 5, collaborator: 8 },
  })
})

test('explicit trainer target wins over policy reference and stays bounded', () => {
  const policy = { defaultDailyTargets: { full_time: 6, part_time: 5, collaborator: 2 } }
  assert.equal(trainerDailyLoadTarget({ employmentType: 'full_time' }, policy), 6)
  assert.equal(trainerDailyLoadTarget({ employmentType: 'part_time', dailySessionTarget: 9 }, policy), 9)
  assert.equal(trainerDailyLoadTarget({ employmentType: 'collaborator', dailySessionTarget: 99 }, policy), 12)
})
