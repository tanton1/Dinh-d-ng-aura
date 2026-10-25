import type { PtScheduleV2Student, PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'

const days = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

export function scheduleDate(weekId: string, day: string): string {
  const offset = days.indexOf(day)
  if (offset < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(weekId)) return ''
  const date = new Date(`${weekId}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

/** Uses approved contract evidence already present in the weekly document.
 * Empty availability / a pending OFF request is never evidence of leave.
 * Also handles pre-fix projections that incorrectly kept only Sunday valid. */
export function approvedOffForWeek(student: PtScheduleV2Student, workspace: Pick<PtScheduleWorkspaceV2Result, 'weekId' | 'scheduleConfig'>): boolean {
  const paused = new Set(student.pausedScheduleDates || [])
  if (!paused.size) return false
  const holidays = new Set(workspace.scheduleConfig.holidays || [])
  const operatingDates = (workspace.scheduleConfig.workingDays || []).map(day => scheduleDate(workspace.weekId, day))
    .filter(date => date && !holidays.has(date))
  const valid = new Set(student.validScheduleDates || [])
  // Another valid contract can still provide entitlement on a paused day.
  return operatingDates.length > 0 && operatingDates.every(date => paused.has(date) && !valid.has(date))
}

export function approvedOffOnDate(student: PtScheduleV2Student | undefined, date: string): boolean {
  return Boolean(student?.pausedScheduleDates?.includes(date) && !student.validScheduleDates?.includes(date))
}
