'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { studentVisibleSessionRows } = require('./session-schedule-normalization')

const base = (overrides = {}) => ({
  id: 'session-1',
  studentId: 'student-1',
  trainerId: 'trainer-1',
  contractId: 'contract-1',
  scheduleEntryId: 'schedule_week-T2-18-student-1',
  date: '2090-01-02',
  hour: 18,
  status: 'scheduled',
  scheduleStatus: 'scheduled',
  revision: 1,
  ...overrides,
})

test('student projection removes cancelled rows and keeps the active replacement', () => {
  const rows = studentVisibleSessionRows([
    base({ id: 'cancelled-old', status: 'cancelled', scheduleStatus: 'cancelled' }),
    base({
      id: 'replacement-new',
      date: '2090-01-03',
      scheduleEntryId: 'schedule_week-T3-18-student-1',
      reintroducedFromSessionId: 'cancelled-old',
      scheduleStatus: 'scheduled',
    }),
  ])

  assert.deepEqual(rows.map((row) => row.id), ['replacement-new'])
})

test('student projection preserves the latest rescheduled canonical session', () => {
  const rows = studentVisibleSessionRows([
    base({ id: 'moved', date: '2090-01-04', hour: 19, scheduleStatus: 'rescheduled', revision: 3 }),
  ])

  assert.equal(rows.length, 1)
  assert.equal(rows[0].scheduleStatus, 'rescheduled')
  assert.equal(rows[0].date, '2090-01-04')
})
