import type { PtScheduleUnassignedEntry, PtScheduleV2Student, PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'
import { CONFIRMED_AVAILABILITY_STATUSES, CONTRACT_WARNING_REASONS, LEARNER_WARNING_REASONS, scheduleSlotLabel, warningCauseFor, type WarningCause } from './workspaceModel'
import { approvedOffForWeek, validScheduledCount, validOtherBranchCount } from './weeklyOff'

export interface WarningProfile {
  student: PtScheduleV2Student
  missingSessions: number
  scheduledSessions: number
  scheduledEntries: Array<{ slotId: string; trainerId: string; label: string; studentOffConfirmed?: boolean }>
  crossBranchScheduledSessions: number
  reasonCodes: string[]
  primaryReasonCode?: string
  warningCause: WarningCause
  actionCode?: string
  candidateSlots?: PtScheduleUnassignedEntry['candidateSlots']
  suggestedSlots?: string[]
}

export interface WarningRow extends Omit<WarningProfile, 'student'> {
  id: string
  name: string
  phone: string
  email: string
  targetSessions: number
  student?: PtScheduleV2Student
}

const contractReason: Record<string, string> = {
  missing: 'ACTIVE_CONTRACT_NOT_FOUND', expired: 'CONTRACT_EXPIRED_BEFORE_WEEK',
  expiring: 'CONTRACT_EXPIRES_DURING_WEEK', quota_exhausted: 'CONTRACT_SESSION_QUOTA_EXCEEDED',
  paused: 'CONTRACT_PAUSED', not_started_or_ended: 'CONTRACT_NOT_STARTED_IN_WEEK',
}

/** A live draft delta, not a new claim of full contract/other-branch validation.
 * Reuse the last known weekly targets and profiles; never reuse old missing
 * counts or optimizer capacity diagnoses after the matrix revision changes.
 * This is entirely local and is loaded only with the warning panel. */
export function presentScheduleWarnings(workspace: PtScheduleWorkspaceV2Result, profiles: WarningProfile[], pending: boolean,
  weekDates: Record<string, { display: string; full: string }>): { rows: WarningRow[]; hasTargets: boolean } {
  if (!pending) return { hasTargets: true, rows: profiles.filter(profile => !approvedOffForWeek(profile.student, workspace)).map(profile => {
    let primaryReasonCode = profile.primaryReasonCode
    const diagnostic = workspace.unassignedEntries?.find(row => row.studentId === profile.student.id)
    // Exhausting a search budget cannot prove that all PT capacity is full.
    // Keep genuine current contract/learner blockers ahead of this result,
    // but never promote one failed candidate into a capacity conclusion.
    if (diagnostic?.primaryReasonCode === 'SEARCH_LIMIT_REACHED'
      && !CONTRACT_WARNING_REASONS.has(primaryReasonCode || '') && !LEARNER_WARNING_REASONS.has(primaryReasonCode || '')) {
      primaryReasonCode = diagnostic.primaryReasonCode
    }
    return { ...profile, primaryReasonCode,
      warningCause: primaryReasonCode ? warningCauseFor(undefined, profile.student.contractStatus, [primaryReasonCode]) : profile.warningCause,
      id: profile.student.id, name: profile.student.name, phone: profile.student.phone || '', email: profile.student.email || '',
      targetSessions: profile.student.sessionsPerWeek,
    }
  }) }
  const snapshot = workspace.validationSnapshot
  if (!snapshot || snapshot.branchId !== workspace.branch.id || snapshot.weekId !== workspace.weekId
    || snapshot.draftRevision > workspace.draftRevision) return { rows: [], hasTargets: false }
  const students = new Map(workspace.students.map(student => [student.id, student]))
  const scheduled = new Map<string, WarningProfile['scheduledEntries']>()
  for (const [slotId, entries] of Object.entries(workspace.schedule)) for (const entry of entries) {
    if (entry.type === 'off' || !entry.studentId || entry.studentId === 'OFF') continue
    const rows = scheduled.get(entry.studentId) || []
    rows.push({ slotId, trainerId: entry.trainerId, label: scheduleSlotLabel(slotId, weekDates),
      studentOffConfirmed: Boolean(entry.studentOffConfirmedDate && entry.studentOffConfirmedDate === weekDates[slotId.split('-')[0]]?.full) })
    scheduled.set(entry.studentId, rows)
  }
  const ids = new Set([...Object.keys(snapshot.coverage.byStudent), ...workspace.students
    .filter(student => student.eligibleForWeek || scheduled.has(student.id)).map(student => student.id)])
  const currentDiagnostics = new Map((workspace.unassignedEntries || []).map(row => [row.studentId, row]))
  const priorDiagnostics = new Map(snapshot.unassignedEntries.map(row => [row.studentId, row]))
  const branchCoverage = { ...snapshot.weeklySessionCoverage, ...workspace.weeklySessionCoverage }
  const rows: WarningRow[] = []
  for (const id of ids) {
    const student = students.get(id), prior = snapshot.coverage.byStudent[id]
    if (student && approvedOffForWeek(student, workspace)) continue
    if (student?.isCrossBranchDisplayOnly || ['archived', 'deleted'].includes(String(student?.status || ''))) continue
    if (prior?.targetSessions === 0 && !student?.eligibleForWeek && !scheduled.has(id)) continue
    const targetSessions = Math.max(0, Number(student?.sessionsPerWeek ?? prior?.targetSessions ?? 0))
    const scheduledEntries = scheduled.get(id) || []
    const crossBranchScheduledSessions = validOtherBranchCount(student, branchCoverage, workspace.branch.id, prior?.otherBranchSessions || 0)
    const scheduledSessions = validScheduledCount(student, scheduledEntries, workspace.weekId) + crossBranchScheduledSessions
    const missingSessions = Math.max(0, targetSessions - scheduledSessions)
    if (!missingSessions) continue
    // Slot-level alternative failures are not student-level reasons. In
    // particular, an invalid candidate must not label an active contract expired.
    // Manual commands preserve some optimizer diagnostics inside the new
    // draft. Their presence alone is not evidence that they were recalculated.
    const diagnostic = snapshot.draftRevision === workspace.draftRevision
      ? currentDiagnostics.get(id) || priorDiagnostics.get(id) : undefined
    const warning = snapshot.warnings.find(row => row.studentId === id)
    const status = student?.contractStatus || warning?.contractStatus
    let primaryReasonCode = status ? contractReason[status] : undefined
    if (!primaryReasonCode && student) {
      if (!CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus)) primaryReasonCode = 'AVAILABILITY_NOT_SUBMITTED'
      else {
        const occupied = new Set(scheduledEntries.map(entry => entry.slotId.split('-')[0]))
        const otherDates = (workspace.weeklySessionCoverage?.[id] || snapshot.weeklySessionCoverage?.[id])?.entries || []
        for (const entry of otherDates) if (entry.branchId !== workspace.branch.id) {
          const day = Object.keys(weekDates).find(day => weekDates[day].full === entry.date)
          if (day) occupied.add(day)
        }
        const remainingDays = new Set(student.availableSlots.map(slot => slot.split('-')[0]).filter(day => !occupied.has(day)))
        if (remainingDays.size < missingSessions) primaryReasonCode = 'STUDENT_AVAILABILITY_DAYS_INSUFFICIENT'
      }
    }
    if (!primaryReasonCode && diagnostic?.primaryReasonCode && !CONTRACT_WARNING_REASONS.has(diagnostic.primaryReasonCode)) {
      primaryReasonCode = diagnostic.primaryReasonCode
    }
    primaryReasonCode ||= 'STUDENT_UNSCHEDULED'
    rows.push({ id, student, name: student?.name || warning?.studentName || diagnostic?.studentName || 'Hồ sơ chưa có tên',
      phone: student?.phone || warning?.studentPhone || '', email: student?.email || '', targetSessions,
      missingSessions, scheduledSessions, scheduledEntries, crossBranchScheduledSessions,
      primaryReasonCode, reasonCodes: [primaryReasonCode],
      warningCause: warningCauseFor(undefined, status, [primaryReasonCode]),
      // Old slot suggestions and action codes are unsafe after a draft edit.
      candidateSlots: [], suggestedSlots: [],
    })
  }
  return { hasTargets: true, rows: rows.sort((a, b) => b.missingSessions - a.missingSessions || a.name.localeCompare(b.name, 'vi')) }
}
