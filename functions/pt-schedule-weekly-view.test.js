'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildPtScheduleWeeklyView,
  compactCoverage,
  compactSchedule,
  weeklyViewId,
} = require('./pt-schedule-weekly-view')

const WEEK = '2026-10-19'
const BRANCH = 'branch-a'

function workspace(overrides = {}) {
  return {
    weekId: WEEK,
    readMode: 'reconciled',
    partial: false,
    branch: { id: BRANCH, name: 'Aura A' },
    draft: { revision: 4, status: 'draft', publishedVersion: 0, publishedRevision: -1 },
    schedule: {
      'T2-6': [{ studentId: 'student-a', trainerId: 'trainer-a', branchId: BRANCH, type: 'training', contractId: 'contract-a', source: 'manual_v2' }],
    },
    students: [{
      id: 'student-a', name: 'Lan', phone: '0901', email: 'lan@example.com', status: 'active', branchId: BRANCH,
      sessionsPerWeek: 2, activeScheduledThisWeek: 1, remainingSchedulableSessions: 10,
      availabilityStatus: 'submitted', availabilityRevision: 2, contractStatus: 'active', eligibleContractIds: ['contract-a'],
    }],
    crossBranchStudents: [],
    trainers: [{ id: 'trainer-a', name: 'Mai', branchId: BRANCH, availabilityMode: 'configured', slotCapacity: 2 }],
    sessions: [],
    weeklySessionCoverage: {},
    ...overrides,
  }
}

test('weekly view id is deterministic by branch and Monday week', () => {
  assert.equal(weeklyViewId(BRANCH, WEEK), 'branch-a_2026-10-19')
})

test('compact schedule strips raw fields but keeps editable identity', () => {
  const schedule = compactSchedule({
    'T2-6': [{ studentId: 's', trainerId: 't', branchId: BRANCH, contractId: 'c', type: 'training', source: 'manual_v2', secret: 'do-not-copy' }],
  })
  assert.deepEqual(schedule['T2-6'][0], {
    studentId: 's', trainerId: 't', branchId: BRANCH, type: 'training', contractId: 'c', source: 'manual_v2', isLocked: false,
  })
  assert.equal(schedule['T2-6'][0].secret, undefined)
})

test('display coverage is explicitly estimated, never verified', () => {
  const value = compactCoverage({
    students: [{ id: 's', sessionsPerWeek: 2 }],
    schedule: { 'T2-6': [{ studentId: 's', trainerId: 't', type: 'training' }] },
    exact: false,
  })
  assert.equal(value.status, 'estimated')
  assert.equal(value.verification, 'draft_only')
  assert.equal(value.verified, false)
  assert.equal(value.missingSessions, 1)
})

test('weekly view enriches incomplete profiles and missing-session warnings', () => {
  const view = buildPtScheduleWeeklyView({
    branchId: BRANCH,
    weekId: WEEK,
    data: workspace({
      partial: false,
      students: [{
        id: 'student-a', name: '', phone: '', email: '', status: 'active', branchId: BRANCH,
        sessionsPerWeek: 2, availabilityStatus: 'missing', contractStatus: 'missing', eligibleContractIds: [],
      }],
    }),
  })
  assert.equal(view.freshness, 'verified')
  assert.equal(view.verification, 'exact')
  assert.equal(view.coverage.byStudent['student-a'].missingSessions, 1)
  assert.ok(view.warnings.some((warning) => warning.code === 'PROFILE_DATA_INCOMPLETE' && warning.studentId === 'student-a'))
  assert.ok(view.warnings.some((warning) => warning.code === 'STUDENT_MISSING_SESSIONS' && warning.missingSessions === 1))
  assert.equal(view.students[0].profileComplete, false)
  assert.deepEqual(view.students[0].missingFields.sort(), ['availability', 'contract', 'email', 'name', 'phone'])
})

test('display workspace keeps stale semantics and source changes advance revision', () => {
  const first = buildPtScheduleWeeklyView({
    branchId: BRANCH,
    weekId: WEEK,
    data: workspace({ partial: true, readMode: 'display' }),
  })
  assert.equal(first.freshness, 'display')
  assert.equal(first.dirty, false)
  const second = buildPtScheduleWeeklyView({
    branchId: BRANCH,
    weekId: WEEK,
    previousView: first,
    data: workspace({ partial: true, readMode: 'display', draft: { ...workspace().draft, revision: 5 } }),
  })
  assert.equal(second.viewRevision, first.viewRevision + 1)
  assert.notEqual(second.sourceRevision, first.sourceRevision)
})
