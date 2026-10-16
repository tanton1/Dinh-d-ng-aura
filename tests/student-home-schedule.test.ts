import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStudentHomeSchedule } from '../src/features/home/studentHomeSchedule'
import { canonicalStudentPtSessions } from '../src/services/studentPtScheduleService'
import type { StudentPtSession, StudentPtSessionStatus } from '../src/services/studentPtScheduleService'

function session(id: string, date: string, hour: number, status: StudentPtSessionStatus): StudentPtSession {
  return {
    id,
    date,
    hour,
    status,
    trainerId: 'trainer-1',
    trainerName: 'PT Minh',
    branchId: 'branch-1',
    verifiedByStudent: false,
    scheduleEntryId: `entry-${id}`,
    revision: 1,
    timeZone: 'Asia/Ho_Chi_Minh',
  }
}

test('Home schedule uses canonical PT sessions, counts every session today and sorts upcoming items', () => {
  const summary = buildStudentHomeSchedule([
    session('later', '2026-08-29', 18, 'scheduled'),
    session('today-late', '2026-08-28', 19, 'scheduled'),
    session('today-early', '2026-08-28', 7, 'scheduled'),
    session('cancelled', '2026-08-28', 6, 'cancelled'),
  ], '2026-08-28', '2026-08-24', '2026-08-30', 2)

  assert.equal(summary.todaySessionCount, 2)
  assert.deepEqual(summary.upcomingSessions.map((item) => item.id), ['today-early', 'today-late'])
})

test('completed canonical PT sessions contribute to the current-week activity without canceled sessions', () => {
  const summary = buildStudentHomeSchedule([
    session('done-1', '2026-08-25', 7, 'completed'),
    session('done-2', '2026-08-25', 18, 'completed'),
    session('old', '2026-08-20', 7, 'completed'),
    session('cancelled', '2026-08-26', 7, 'cancelled'),
  ], '2026-08-28', '2026-08-24', '2026-08-30')

  assert.deepEqual(summary.weeklyCompletedMinutesByDate, { '2026-08-25': 120 })
})

test('student schedule drops a canceled mirror when the charged no-show has the same published slot', () => {
  const duplicateSlot = [
    {
      ...session('legacy-no-show', '2026-10-16', 20, 'no_show'),
      scheduleEntryId: 'schedule_2026-10-12-T6-20-student-1',
      revision: 3,
    },
    {
      ...session('branch-cancelled-mirror', '2026-10-16', 20, 'cancelled'),
      scheduleEntryId: 'schedule_2026-10-12-T6-20-student-1',
      revision: 1,
    },
  ]

  const canonical = canonicalStudentPtSessions(duplicateSlot)
  assert.deepEqual(canonical.map((item) => item.id), ['legacy-no-show'])
  assert.equal(canonical[0]?.status, 'no_show')
})
