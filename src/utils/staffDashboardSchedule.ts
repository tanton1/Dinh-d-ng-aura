import type { TrainerSessionSummary } from '../services/ptOperationsV2Service'

export type StaffScheduleFilter = 'all' | 'pending' | 'upcoming' | 'recorded'
export type StaffSessionState = 'pending' | 'upcoming' | 'present' | 'late' | 'no_show' | 'unspecified'

export const staffSessionLabels: Record<StaffSessionState, string> = {
  pending: 'Chờ xác nhận',
  upcoming: 'Sắp tới',
  present: 'Có tập',
  late: 'Đi trễ',
  no_show: 'Không đến',
  unspecified: 'Chưa rõ giờ',
}

// Presentation only: retain the existing attendance fallback and +07:00 cutoff.
// No attendance, billing, or payroll records are modified here.
export function staffSessionState(session: TrainerSessionSummary, now: number): StaffSessionState {
  const attendance = session.attendanceStatus && session.attendanceStatus !== 'policy_charge'
    ? session.attendanceStatus
    : ['completed', 'attended'].includes(session.status) ? 'present'
      : session.status === 'no_show' ? 'no_show' : 'pending'
  if (attendance !== 'pending') return attendance
  if (session.hour == null || !Number.isInteger(session.hour) || session.hour < 0 || session.hour > 23) return 'unspecified'
  const startsAt = Date.parse(`${session.date}T${String(session.hour).padStart(2, '0')}:00:00+07:00`)
  if (!Number.isFinite(startsAt)) return 'unspecified'
  return startsAt > now ? 'upcoming' : 'pending'
}

export function buildStaffDaySchedule(sessions: TrainerSessionSummary[], today: string, now: number) {
  const active = sessions.filter((session) => session.date === today
    && !['cancelled', 'student_cancelled', 'trainer_cancelled'].includes(session.status)
    && session.scheduleStatus !== 'cancelled')
    .sort((a, b) => (a.hour ?? 99) - (b.hour ?? 99))
  const groups = new Map<string, TrainerSessionSummary[]>()
  for (const session of active) {
    const key = `${session.date}:${session.hour}`
    groups.set(key, [...(groups.get(key) || []), session])
  }
  const priorities: StaffSessionState[] = ['pending', 'unspecified', 'no_show', 'late', 'upcoming', 'present']
  return {
    sessions: active,
    pendingAttendance: active.filter((session) => staffSessionState(session, now) === 'pending').length,
    groups: [...groups.entries()].map(([key, items]) => {
      const states = items.map((item) => staffSessionState(item, now))
      return { key, hour: items[0].hour, items, states, state: priorities.find((state) => states.includes(state))! }
    }),
  }
}

export function matchesStaffScheduleFilter(states: StaffSessionState[], filter: StaffScheduleFilter) {
  if (filter === 'all') return true
  if (filter === 'recorded') return states.some((state) => ['present', 'late', 'no_show'].includes(state))
  return states.includes(filter)
}
