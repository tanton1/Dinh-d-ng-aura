'use strict'

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'collaborator']
function normalizeScheduleLoadPolicy(value) {
  const target = (type) => {
    const number = Number(value?.defaultDailyTargets?.[type])
    return Number.isInteger(number) && number >= 1 && number <= 12 ? number : 8
  }
  return { schemaVersion: 1, defaultDailyTargets: {
    full_time: target('full_time'), part_time: target('part_time'), collaborator: target('collaborator'),
  } }
}

// Keep explicit PT targets authoritative; missing legacy fields inherit policy.
// This is a balancing reference, not a hard limit on student coverage.
function trainerDailyLoadTarget(trainer, policy) {
  const type = EMPLOYMENT_TYPES.includes(trainer?.employmentType) ? trainer.employmentType : 'full_time'
  const fallback = normalizeScheduleLoadPolicy(policy).defaultDailyTargets[type]
  return Math.max(1, Math.min(12, Math.trunc(Number(trainer?.dailySessionTarget ?? fallback) || fallback)))
}

module.exports = { EMPLOYMENT_TYPES, normalizeScheduleLoadPolicy, trainerDailyLoadTarget }
