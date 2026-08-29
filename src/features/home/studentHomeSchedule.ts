import type { StudentPtSession } from '../../services/studentPtScheduleService'

export interface StudentHomeScheduleSummary {
  upcomingSessions: StudentPtSession[]
  todaySessionCount: number
  weeklyCompletedMinutesByDate: Record<string, number>
}

const CANONICAL_PT_SESSION_MINUTES = 60

/** Builds the small Home snapshot from the same canonical sessions used by SchedulePage. */
export function buildStudentHomeSchedule(
  sessions: StudentPtSession[],
  today: string,
  weekFrom: string,
  weekTo: string,
  upcomingLimit = 2,
): StudentHomeScheduleSummary {
  const scheduled = sessions
    .filter((session) => session.status === 'scheduled' && session.date >= today)
    .sort((left, right) => `${left.date}-${String(left.hour ?? 99).padStart(2, '0')}-${left.id}`
      .localeCompare(`${right.date}-${String(right.hour ?? 99).padStart(2, '0')}-${right.id}`))

  const weeklyCompletedMinutesByDate = sessions
    .filter((session) => session.status === 'completed' && session.date >= weekFrom && session.date <= weekTo)
    .reduce<Record<string, number>>((result, session) => {
      result[session.date] = (result[session.date] ?? 0) + CANONICAL_PT_SESSION_MINUTES
      return result
    }, {})

  return {
    upcomingSessions: scheduled.slice(0, Math.max(0, upcomingLimit)),
    todaySessionCount: scheduled.filter((session) => session.date === today).length,
    weeklyCompletedMinutesByDate,
  }
}
