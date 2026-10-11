import assert from 'node:assert/strict'
import test from 'node:test'
import type { TrainerSessionSummary } from '../src/services/ptOperationsV2Service'
import { buildStaffDaySchedule, matchesStaffScheduleFilter, staffSessionState } from '../src/utils/staffDashboardSchedule'

const now = Date.parse('2026-10-11T12:00:00+07:00')
const baseSession = (overrides: Partial<TrainerSessionSummary>): TrainerSessionSummary => ({
  id: 'session',
  studentId: 'student',
  trainerId: 'trainer',
  date: '2026-10-11',
  hour: 8,
  status: 'scheduled',
  attendanceStatus: 'pending',
  timeZone: 'Asia/Ho_Chi_Minh',
  ...overrides,
})

test('staff day schedule separates overdue attendance from future sessions', () => {
  const sessions = [
    baseSession({ id: 'overdue', hour: 8 }),
    baseSession({ id: 'future', hour: 17 }),
    baseSession({ id: 'recorded', hour: 9, status: 'attended', attendanceStatus: 'present' }),
    baseSession({ id: 'cancelled', hour: 10, scheduleStatus: 'cancelled' }),
  ]
  const schedule = buildStaffDaySchedule(sessions, '2026-10-11', now)

  assert.equal(schedule.sessions.length, 3)
  assert.equal(schedule.pendingAttendance, 1)
  assert.deepEqual(schedule.groups.map((group) => group.state), ['pending', 'present', 'upcoming'])
  assert.equal(staffSessionState(sessions[0], now), 'pending')
  assert.equal(staffSessionState(sessions[1], now), 'upcoming')
  assert.equal(staffSessionState(sessions[2], now), 'present')
})

test('schedule filters are presentation-only and support recorded sessions', () => {
  assert.equal(matchesStaffScheduleFilter(['pending'], 'pending'), true)
  assert.equal(matchesStaffScheduleFilter(['upcoming'], 'pending'), false)
  assert.equal(matchesStaffScheduleFilter(['present', 'late'], 'recorded'), true)
  assert.equal(matchesStaffScheduleFilter(['no_show'], 'recorded'), true)
  assert.equal(matchesStaffScheduleFilter(['upcoming'], 'recorded'), false)
})
