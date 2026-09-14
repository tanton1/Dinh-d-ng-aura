import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateScheduleOpportunities } from '../src/features/schedule/opportunities'
import { legacyOpportunities } from './fixtures/legacy-schedule-opportunities'
import { beginScheduleTiming, measureScheduleTask } from '../src/features/schedule/performance'
import { hasActionableSearchLimit } from '../src/features/schedule/searchLimit'

test('search-limit notice only appears when unresolved work was actually capped', () => {
  assert.equal(hasActionableSearchLimit({ rescueSearchLimitReached: true }, [{ primaryReasonCode: 'CONTRACT_SESSION_QUOTA_EXCEEDED' }]), false)
  assert.equal(hasActionableSearchLimit({ rescueSearchLimitReached: true }, [{ blockerType: 'search_limit_reached' }]), true)
  assert.equal(hasActionableSearchLimit({ repairSearchLimitReached: true, optimalityGap: 2 }, []), true)
  assert.equal(hasActionableSearchLimit({ repairSearchLimitReached: true, optimalityGap: 0 }, []), false)
  assert.equal(hasActionableSearchLimit({ rescueSearchLimitReached: false, optimalityGap: 4 }, [{ primaryReasonCode: 'SEARCH_LIMIT_REACHED' }]), false)
})

test('local timing is bounded and preserves task results and failures', async () => {
  for (let i = 0; i < 30; i++) beginScheduleTiming('opportunities')()
  assert.equal(performance.getEntriesByName('aura:schedule:opportunities').length, 1)
  assert.equal(await measureScheduleTask('publish', async () => 'unchanged'), 'unchanged')
  const conflict = new Error('conflict')
  await assert.rejects(measureScheduleTask('publish', async () => { throw conflict }), (cause) => cause === conflict)
  assert.equal(performance.getEntriesByName('aura:schedule:publish').length, 1)
})

function workspace(studentCount = 30) {
  const students = Array.from({ length: studentCount }, (_, index) => ({
    id: `s-${index}`, name: `Học viên ${index}`, phone: '', status: 'active', branchId: 'b',
    sessionsPerWeek: 2, defaultSessionsPerWeek: 2, weeklySessionTargetOverride: null, weeklySessionTargetOverridden: false,
    maxWeeklySessions: 7, schedulableSessionsThisWeek: 7, availableSlots: ['T2-6', 'T3-6', 'T4-6'], availabilityStatus: 'submitted',
    availabilityRevision: 1, eligibleForWeek: true, eligibilityReasons: [], eligibleContractIds: [`c-${index}`], validScheduleDates: [], pausedScheduleDates: [],
  }))
  return {
    branch: { id: 'b', name: 'Aura', status: 'active' }, weekId: '2026-09-07', draftRevision: 2, publishedVersion: 0, publishedRevision: -1,
    draftStatus: 'draft', updatedAt: null, updatedBy: null, schedule: {}, students,
    trainers: Array.from({ length: 10 }, (_, index) => ({ id: `t-${index}`, name: `PT ${index}`, branchId: 'b', status: 'active', slotCapacity: 2, availabilityMode: 'configured', availabilityRevision: 1, availableSlots: ['T2-6', 'T3-6', 'T4-6'], employmentType: index < 6 ? 'full_time' : 'part_time', dailySessionTarget: index < 6 ? undefined : 5 })),
    contracts: students.map((student) => ({ id: `c-${student.id.slice(2)}`, studentId: student.id, branchId: 'b', trainerId: 't-0', trainerIds: ['t-1'], status: 'active', startDate: '2026-01-01', endDate: '2026-12-31', totalSessions: 100, usedSessions: 0 })),
    sessions: [], scheduleConfig: { workingDays: ['T2', 'T3', 'T4'], workingHours: [6], holidays: [], scheduleLoadPolicy: { schemaVersion: 1, defaultDailyTargets: { full_time: 6, part_time: 5, collaborator: 3 } } },
    summary: { eligibleStudents: studentCount, trainers: 10, unconfiguredTrainers: 0, scheduledEntries: 0, missingSessions: studentCount * 2, unassignedEntries: 0 },
  } as any
}

test('opportunity tiers preserve pairing, soft target and primary/secondary ordering', () => {
  const data = workspace()
  data.schedule['T2-6'] = [{ studentId: 's-0', trainerId: 't-0', type: 'training' }]
  const rows = data.students.map((student: any) => ({ student, missing: 2 }))
  const result = calculateScheduleOpportunities({ workspace: data, studentRows: rows, studentId: '', dates: { T2: { full: '2026-09-07' }, T3: { full: '2026-09-08' }, T4: { full: '2026-09-09' } }, days: ['T2', 'T3', 'T4'], hours: [6] })
  assert.equal(result.find((item) => item.trainerId === 't-0' && item.slotId === 'T2-6')?.priorityTier, 1)
  assert.equal(result.find((item) => item.trainerId === 't-2' && item.slotId === 'T2-6')?.priorityTier, 2)
  assert.equal(result.find((item) => item.trainerId === 't-0' && item.slotId === 'T3-6')?.isPrimaryTrainer, true)
  assert.equal(result.find((item) => item.trainerId === 't-1' && item.slotId === 'T3-6')?.secondaryMatchCount, data.students.length)
})

test('stale selected student does not fall back to the whole branch pool', () => {
  const data = workspace(500)
  const rows = data.students.map((student: any) => ({ student, missing: 2 }))
  const result = calculateScheduleOpportunities({ workspace: data, studentRows: rows, studentId: 'deleted-student', dates: { T2: { full: '2026-09-07' } }, days: ['T2'], hours: [6] })
  assert.deepEqual(result, [])
})

test('500 learners / 10 PT: indexed selector matches the original pool and selected-learner results', (t) => {
  const data = workspace(500)
  // Legacy defaults are eight for every type; explicit targets remain unchanged.
  delete data.scheduleConfig.scheduleLoadPolicy
  const days = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
  const hours = Array.from({ length: 16 }, (_, i) => i + 6)
  const dates = Object.fromEntries(days.map((day, i) => [day, { full: `2026-09-${String(7 + i).padStart(2, '0')}` }]))
  const slots = days.flatMap((day) => hours.map((hour) => `${day}-${hour}`))
  data.scheduleConfig.workingDays = days
  data.scheduleConfig.workingHours = hours
  data.scheduleConfig.holidays = ['2026-09-12']
  data.trainers.forEach((trainer: any, i: number) => { trainer.availableSlots = slots.filter((_, index) => index % (i + 2) !== 0) })
  data.students.forEach((student: any, i: number) => {
    student.availableSlots = slots.filter((_, index) => (index + i) % 3 === 0)
    if (i % 7 === 0) student.validScheduleDates = ['2026-09-07', '2026-09-08']
    if (i % 11 === 0) student.availabilityStatus = 'missing'
  })
  slots.forEach((slot, i) => { data.schedule[slot] = Array.from({ length: i % 4 }, (_, j) => ({
    studentId: `s-${(i * 3 + j) % 500}`, trainerId: `t-${i % 10}`, type: i % 19 === 0 ? 'off' : 'training',
  })) })
  const rows = data.students.map((student: any, i: number) => ({ student, missing: i % 4 }))
  let oldMs = 0, newMs = 0
  for (const studentId of ['', 's-0', 's-7', 's-15', 's-499']) {
    const start = performance.now()
    const oldResult = legacyOpportunities(data, rows, studentId, dates, days, hours)
    const middle = performance.now()
    const result = calculateScheduleOpportunities({ workspace: data, studentRows: rows, studentId, dates, days, hours })
    const end = performance.now()
    assert.deepEqual(result, oldResult, `Ordering and counts for ${studentId || 'whole branch'}`)
    oldMs += middle - start; newMs += end - middle
  }
  t.diagnostic(`5 selections, 500 learners/10 PT/96 slots: legacy=${oldMs.toFixed(1)}ms indexed=${newMs.toFixed(1)}ms. Local CPU only; not a production latency claim.`)
})
