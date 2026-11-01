import type { PtScheduleV2Student, PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'
import { scheduleDate } from './weeklyOff'

/** Informational leave in the selected calendar week, including elapsed days.
 * This must not be used to waive the weekly target: partial OFF still leaves
 * training days. Older projections fall back to their approved pause dates.
 * Loaded with the warning panel, keeping this out of the initial matrix. */
export function approvedOffDatesInWeek(student: PtScheduleV2Student, workspace: Pick<PtScheduleWorkspaceV2Result, 'weekId'>): string[] {
  const weekDates = new Set(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(day => scheduleDate(workspace.weekId, day)).filter(Boolean))
  const dates = student.approvedOffScheduleDates ?? student.pausedScheduleDates
  return [...new Set(Array.isArray(dates) ? dates : [])]
    .filter(date => weekDates.has(date)).sort()
}
