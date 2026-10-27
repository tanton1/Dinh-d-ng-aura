import {
  listPtScheduleBranches,
  ptScheduleConflictLabel,
  type PtScheduleBranchOption,
  type PtScheduleSlotCandidate,
  type PtScheduleTrainerDailyLoad,
  type PtScheduleUnassignedEntry,
  type PtScheduleWorkspaceV2Result,
  type PtScheduleWeeklyViewResult,
} from '../../services/ptSchedulePublishService'

import { readWorkspaceCache, writeWorkspaceCache, WORKSPACE_CACHE_REVALIDATE_MS } from './workspaceCache'
import { applyWeeklyValidation } from './weeklyValidation'
import { approvedOffOnDate } from './weeklyOff'

type WorkspaceTab = 'matrix' | 'opportunities' | 'students' | 'warnings' | 'history'
type StudentFilter = 'all' | 'missing' | 'contract' | 'availability' | 'trainer' | 'ready'
type WarningFilter = 'priority' | 'conflict' | 'contract' | 'learner' | 'capacity' | 'system'
type WarningCause = 'contract' | 'learner' | 'capacity' | 'system'
type WorkspaceSyncState = 'connecting' | 'live' | 'syncing' | 'offline'
const CONFIRMED_AVAILABILITY_STATUSES = new Set(['submitted', 'locked', 'inherited', 'recurring'])
const BRANCH_CATALOG_CACHE_TTL_MS = 10 * 60_000
const MIN_WEEK_OFFSET = -12
const APP_UPDATE_READY_KEY = 'aura:update-ready'
const APP_UPDATE_READY_EVENT = 'aura:update-ready'

type BranchCatalogCacheEntry = { branches: PtScheduleBranchOption[]; storedAt: number }
const branchCatalogCache = new Map<string, BranchCatalogCacheEntry>()
const branchCatalogRequests = new Map<string, Promise<{ schemaVersion: number; branches: PtScheduleBranchOption[] }>>()

async function getCachedBranchCatalog(ownerScope: string) {
  const cached = branchCatalogCache.get(ownerScope)
  if (cached && Date.now() - cached.storedAt < BRANCH_CATALOG_CACHE_TTL_MS) return cached.branches
  const inFlight = branchCatalogRequests.get(ownerScope)
  if (inFlight) return (await inFlight).branches
  const request = listPtScheduleBranches()
  branchCatalogRequests.set(ownerScope, request)
  try {
    const result = await request
    branchCatalogCache.set(ownerScope, { branches: result.branches, storedAt: Date.now() })
    return result.branches
  } finally {
    if (branchCatalogRequests.get(ownerScope) === request) branchCatalogRequests.delete(ownerScope)
  }
}

const DAY_LABELS: Record<string, string> = {
  T2: 'Thứ 2',
  T3: 'Thứ 3',
  T4: 'Thứ 4',
  T5: 'Thứ 5',
  T6: 'Thứ 6',
  T7: 'Thứ 7',
  CN: 'Chủ nhật',
}

function availabilityOriginLabel(student: { availabilityStatus: string; availabilitySourceWeekId?: string | null }) {
  if (student.availabilityStatus === 'inherited') return `kế thừa tuần ${student.availabilitySourceWeekId || 'gần nhất'}`
  if (student.availabilityStatus === 'recurring') return 'lịch mặc định cũ'
  if (['submitted', 'locked'].includes(student.availabilityStatus)) return 'đã gửi lịch rảnh'
  return 'thiếu lịch rảnh'
}

function commandKey() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `schedule-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function scheduleSlotLabel(slotId: string, dates: Record<string, { display: string; full: string }>) {
  const [day, rawHour] = slotId.split('-')
  const hour = Number(rawHour)
  return `${DAY_LABELS[day] || day} ${dates[day]?.display || ''} · ${String(hour).padStart(2, '0')}:00`
}

function compareScheduleSlots(left: string, right: string) {
  const [leftDay, leftHour] = left.split('-')
  const [rightDay, rightHour] = right.split('-')
  const days = Object.keys(DAY_LABELS)
  return days.indexOf(leftDay) - days.indexOf(rightDay) || Number(leftHour) - Number(rightHour)
}

function finiteCount(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric >= 0) return numeric
  }
  return 0
}

function trainerLoadStatus(count: number, target: number) {
  if (count > target) return 'over_target' as const
  if (count === target) return 'target' as const
  return 'under_target' as const
}

function normalizedTrainerLoadStatus(value: PtScheduleTrainerDailyLoad['status'], count: number, target: number) {
  if (value === 'under_target' || value === 'target' || value === 'over_target') return value
  return trainerLoadStatus(count, target)
}

const TRAINER_LOAD_LABELS = {
  under_target: 'Dưới mốc cân tải',
  target: 'Đạt mốc cân tải',
  over_target: 'Cao hơn mốc tham chiếu',
} as const

const STUDENT_AVAILABILITY_CONFLICTS = new Set(['AVAILABILITY_NOT_SUBMITTED', 'OUTSIDE_STUDENT_AVAILABILITY'])
const CONTRACT_WARNING_REASONS = new Set([
  'ACTIVE_CONTRACT_NOT_FOUND',
  'AMBIGUOUS_ACTIVE_CONTRACT',
  'CONTRACT_BRANCH_REQUIRED',
  'CONTRACT_EXPIRED_BEFORE_WEEK',
  'CONTRACT_EXPIRES_DURING_WEEK',
  'CONTRACT_NOT_STARTED_IN_WEEK',
  'CONTRACT_PAUSED',
  'CONTRACT_QUOTA_EXHAUSTED',
  'CONTRACT_SESSION_QUOTA_EXCEEDED',
  'NO_LEARNER_SLOT_ON_VALID_CONTRACT_DATE',
])
const LEARNER_WARNING_REASONS = new Set([
  'AVAILABILITY_NOT_SUBMITTED',
  'STUDENT_AVAILABILITY_MISSING',
  'STUDENT_AVAILABILITY_DAYS_INSUFFICIENT',
])
const CAPACITY_WARNING_REASONS = new Set([
  'BRANCH_CAPACITY_REACHED',
  'ALL_MATCHING_TRAINERS_FULL',
  'ALL_TRAINERS_OFF',
  'NO_AVAILABLE_TRAINER_IN_LEARNER_SLOTS',
  'TRAINER_AVAILABILITY_UNCONFIGURED',
  'TRAINER_ON_LEAVE',
  'TRAINER_CAPACITY_EXCEEDED',
  'TRAINER_OFF_CONFLICT',
])

function availabilityDayCount(slots: string[]) {
  return new Set(slots.map((slot) => String(slot).split('-')[0]).filter(Boolean)).size
}

function warningReasonPriority(code: string) {
  if (code === 'CONTRACT_EXPIRES_DURING_WEEK') return 0
  if (code === 'CONTRACT_SESSION_QUOTA_EXCEEDED' || code === 'CONTRACT_QUOTA_EXHAUSTED') return 1
  if (CONTRACT_WARNING_REASONS.has(code)) return 2
  if (code === 'STUDENT_AVAILABILITY_DAYS_INSUFFICIENT') return 3
  if (LEARNER_WARNING_REASONS.has(code)) return 4
  if (['BRANCH_CAPACITY_REACHED', 'ALL_MATCHING_TRAINERS_FULL', 'ALL_TRAINERS_OFF', 'NO_AVAILABLE_TRAINER_IN_LEARNER_SLOTS', 'TRAINER_AVAILABILITY_UNCONFIGURED', 'TRAINER_ON_LEAVE'].includes(code)) return 5
  return 6
}

function warningCauseFor(blockerCategory: PtScheduleUnassignedEntry['blockerCategory'], contractStatus: string | undefined, reasons: string[]): WarningCause {
  if (contractStatus && ['missing', 'expired', 'expiring', 'quota_exhausted', 'paused', 'not_started_or_ended'].includes(contractStatus)) return 'contract'
  const firstReason = [...reasons].sort((left, right) => warningReasonPriority(left) - warningReasonPriority(right))[0]
  if (firstReason && CONTRACT_WARNING_REASONS.has(firstReason)) return 'contract'
  if (blockerCategory === 'learner_availability' || (firstReason && LEARNER_WARNING_REASONS.has(firstReason))) return 'learner'
  if (blockerCategory === 'trainer_capacity'
    || blockerCategory === 'branch_capacity'
    || reasons.some((reason) => CAPACITY_WARNING_REASONS.has(reason))) return 'capacity'
  return 'system'
}

function warningCauseLabel(cause: WarningCause) {
  if (cause === 'contract') return 'Do hợp đồng'
  if (cause === 'learner') return 'Do lịch khách'
  if (cause === 'capacity') return 'Thiếu PT / công suất'
  return 'Cần tối ưu lại'
}

function candidateMatchesStudentAvailability(candidate: PtScheduleSlotCandidate) {
  return candidate.matchesStudentAvailability
    ?? !candidate.reasons.some((reason) => STUDENT_AVAILABILITY_CONFLICTS.has(reason))
}

function candidateCanBeManuallyScheduled(candidate: PtScheduleSlotCandidate, adminOverride = false, allowStudentOff = true) {
  if (candidate.reasons.some(reason => ['ACTIVE_CONTRACT_NOT_FOUND', 'CONTRACT_EXPIRED_BEFORE_WEEK', 'CONTRACT_NOT_STARTED_IN_WEEK'].includes(reason))) return false
  if (candidate.reasons.includes('CONTRACT_PAUSED') && (!adminOverride || !allowStudentOff)) return false
  if (adminOverride) return true
  return candidate.manualSelectable
    ?? (candidate.eligible || candidate.reasons.every((reason) => STUDENT_AVAILABILITY_CONFLICTS.has(reason)))
}

function trainerEmploymentLabel(value: 'full_time' | 'part_time' | 'collaborator' | undefined) {
  if (value === 'collaborator') return 'CTV'
  if (value === 'part_time') return 'Part-time'
  return 'PT chính thức'
}

/** Keep locked identity projections available for resolving old entries, but
 * never expose them as a selectable trainer for new scheduling work. */
export function isTrainerLocked(trainer: {
  status?: unknown
  disabled?: unknown
  accessStatus?: unknown
  operationalStatus?: unknown
  accountStatus?: unknown
} | null | undefined) {
  if (!trainer || trainer.disabled === true) return true
  const lockedStatuses = new Set(['inactive', 'suspended', 'locked', 'disabled', 'archived', 'deleted', 'invited'])
  return [trainer.status, trainer.accessStatus, trainer.operationalStatus, trainer.accountStatus]
    .some((value) => typeof value === 'string' && lockedStatuses.has(value.trim().toLowerCase()))
}

function contractQuota(contract: PtScheduleWorkspaceV2Result['contracts'][number] | null | undefined) {
  if (!contract) return { entitlement: 0, held: 0, schedulable: 0 }
  const entitlement = finiteCount(contract.remainingEntitlementSessions, Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0))
  const held = finiteCount(contract.activeScheduledSessions)
  const schedulable = finiteCount(contract.remainingSchedulableSessions, entitlement - held)
  return { entitlement, held, schedulable }
}

function diagnosticReasonLabel(code: string | undefined) {
  if (!code) return 'Chưa tìm được phương án xếp phù hợp.'
  return ptScheduleConflictLabel(code)
}

function contractStatusLabel(status: string | undefined) {
  switch (status) {
    case 'expired': return 'Đã hết hạn'
    case 'expiring': return 'Sắp hết hạn trong tuần'
    case 'quota_exhausted': return 'Đã hết buổi'
    case 'paused': return 'Đang OFF / bảo lưu'
    case 'frozen': return 'Đang OFF / bảo lưu'
    case 'cancelled':
    case 'canceled': return 'Đã hủy'
    case 'future': return 'Chưa đến ngày hiệu lực'
    case 'completed': return 'Đã hoàn thành'
    case 'missing': return 'Chưa có hợp đồng'
    case 'not_started_or_ended': return 'Chưa có ngày hiệu lực phù hợp'
    case 'active': return 'Còn hiệu lực'
    default: return 'Trạng thái chưa xác định'
  }
}

function formatDiagnosticDate(value: string | null | undefined) {
  if (!value) return ''
  const parsed = new Date(`${value}T00:00:00+07:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(parsed)
}

function workspaceRealtimeFingerprint(value: PtScheduleWorkspaceV2Result | null) {
  if (!value) return ''
  // Revisions cover draft changes; the compact signatures below also catch
  // availability, contract and live-session changes without serializing large
  // diagnostic traces twice on every quiet refresh.
  return JSON.stringify({
    branchId: value.branch.id,
    weekId: value.weekId,
    draftRevision: value.draftRevision,
    publishedVersion: value.publishedVersion,
    weeklyViewRevision: value.weeklyViewRevision,
    weeklyViewSourceRevision: value.weeklyViewSourceRevision,
    weeklyViewFreshness: value.weeklyViewFreshness,
    weeklyViewDirtyGeneration: value.weeklyViewDirtyGeneration,
    validationState: value.validationState,
    validationDirty: value.validationDirty,
    validationSnapshot: value.validationSnapshot ? [value.validationSnapshot.sourceRevision, value.validationSnapshot.draftRevision, value.validationSnapshot.dirtyGeneration, value.validationSnapshot.validatedAt] : null,
    readMode: value.readMode,
    partial: value.partial,
    reconciliationState: value.reconciliationState,
    schedule: value.schedule,
    students: value.students.map((student) => [student.id, student.name, student.phone, student.email, student.status, student.sessionsPerWeek, student.availabilityRevision, student.availableSlots, student.availabilityLocked, student.availabilityReopenedUntil, student.remainingEntitlementSessions, student.activeScheduledSessions, student.eligibleForWeek, student.contractStatus]),
    trainers: value.trainers.map((trainer) => [trainer.id, trainer.name, trainer.status, trainer.availabilityRevision, trainer.availableSlots, trainer.availabilityMode, trainer.slotCapacity, trainer.dailySessionTarget, trainer.employmentType]),
    contracts: value.contracts.map((contract) => [contract.id, contract.status, contract.startDate, contract.endDate, contract.usedSessions, contract.remainingSchedulableSessions, contract.trainerId, contract.trainerIds]),
    weeklySessionCoverage: value.weeklySessionCoverage,
    quickCoverage: value.quickCoverage,
    calendar: value.scheduleConfig,
  })
}

function firestoreValueIso(value: unknown) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
  }
  return null
}

function workspaceFromDraftSnapshot(
  current: PtScheduleWorkspaceV2Result,
  raw: Record<string, unknown>,
): PtScheduleWorkspaceV2Result {
  const revision = Math.max(0, Number(raw.revision || 0))
  if (revision < current.draftRevision) return current
  const weeklyTargets = raw.weeklySessionTargets && typeof raw.weeklySessionTargets === 'object' && !Array.isArray(raw.weeklySessionTargets)
    ? raw.weeklySessionTargets as Record<string, unknown>
    : {}
  const students = current.students.map((student) => {
    // Weekly target quick edits live outside the draft. Preserve an existing
    // override when a later draft snapshot omits the separate target map;
    // otherwise an unrelated matrix edit would make the UI briefly revert to
    // the profile target until the next full workspace read.
    const draftOverridden = Object.prototype.hasOwnProperty.call(weeklyTargets, student.id)
    const overridden = draftOverridden || student.weeklySessionTargetOverridden
    const defaultTarget = Math.max(0, Math.min(Number(student.defaultSessionsPerWeek || 0), Number(student.maxWeeklySessions || 0)))
    const target = draftOverridden
      ? Math.max(0, Math.min(Number(weeklyTargets[student.id] || 0), Number(student.maxWeeklySessions || 0)))
      : overridden
        ? student.sessionsPerWeek
        : defaultTarget
    return student.sessionsPerWeek === target
      && student.weeklySessionTargetOverridden === overridden
      && student.weeklySessionTargetOverride === (overridden ? target : null)
      ? student
      : {
          ...student,
          sessionsPerWeek: target,
          weeklySessionTargetOverridden: overridden,
          weeklySessionTargetOverride: overridden ? target : null,
        }
  })
  const schedule = raw.schedule && typeof raw.schedule === 'object' && !Array.isArray(raw.schedule)
    ? raw.schedule as PtScheduleWorkspaceV2Result['schedule']
    : current.schedule
  const scheduledByStudent = new Map<string, number>()
  let scheduledEntries = 0
  Object.values(schedule).flat().forEach((entry) => {
    if (entry.type === 'off') return
    scheduledEntries += 1
    scheduledByStudent.set(entry.studentId, (scheduledByStudent.get(entry.studentId) || 0) + 1)
  })
  const missingSessions = students
    .filter((student) => student.eligibleForWeek === true)
    .reduce((total, student) => total + Math.max(0, student.sessionsPerWeek - (scheduledByStudent.get(student.id) || 0)), 0)
  const quickCoverage = current.quickCoverage?.draftOnly
    ? (() => {
        const targetStudents = students.filter((student) => {
          const inactive = ['inactive', 'archived', 'deleted'].includes(String(student.status || '').toLowerCase())
          const crossBranch = student.isCrossBranchDisplayOnly === true || (
            student.branchId && current.branch.id && student.branchId !== current.branch.id
          )
          return !inactive && !crossBranch && Number(student.sessionsPerWeek || 0) > 0
        })
        const totalTargetSessions = targetStudents.reduce((total, student) => total + Number(student.sessionsPerWeek || 0), 0)
        const covered = targetStudents.reduce((total, student) => total + Math.min(
          Number(student.sessionsPerWeek || 0),
          scheduledByStudent.get(student.id) || 0,
        ), 0)
        return {
          ...current.quickCoverage,
          targetStudents: targetStudents.length,
          totalTargetSessions,
          scheduledEntries: covered,
          missingSessions: Math.max(0, totalTargetSessions - covered),
          estimatedMissingSessions: Math.max(0, totalTargetSessions - covered),
          rawScheduledEntries: scheduledEntries,
        }
      })()
    : current.quickCoverage
  const unassignedEntries: NonNullable<PtScheduleWorkspaceV2Result['unassignedEntries']> = Array.isArray(raw.unassignedEntries)
    ? raw.unassignedEntries as NonNullable<PtScheduleWorkspaceV2Result['unassignedEntries']>
    : []
  const publishedVersion = Math.max(0, Number(raw.publishedVersion ?? current.publishedVersion))
  const publishedRevision = Number(raw.publishedRevision ?? current.publishedRevision)
  const draftStatus: PtScheduleWorkspaceV2Result['draftStatus'] = raw.status === 'published' ? 'published' : 'draft'
  return applyWeeklyValidation({
    ...current,
    draftRevision: revision,
    draftStatus,
    publishedVersion,
    publishedRevision,
    updatedAt: firestoreValueIso(raw.updatedAt) || current.updatedAt,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : current.updatedBy,
    schedule,
    students,
    warnings: Array.isArray(raw.warnings) ? raw.warnings as PtScheduleWorkspaceV2Result['warnings'] : [],
    optimizationSummary: raw.optimizationSummary && typeof raw.optimizationSummary === 'object'
      ? raw.optimizationSummary as PtScheduleWorkspaceV2Result['optimizationSummary']
      : undefined,
    quickCoverage,
    unassignedEntries,
    trainerLoads: undefined,
    studentCoverage: undefined,
    summary: {
      ...current.summary,
      scheduledEntries,
      missingSessions,
      unassignedEntries: unassignedEntries.length,
    },
  }, { validationDirty: true }, current)
}

/**
 * Apply a denormalized branch/week read-model snapshot to the current
 * workspace. The read model is intentionally tolerant of both rollout
 * shapes: fields may live directly on the callable result or under a
 * `workspace` property. Missing fields retain the last authoritative value so
 * a compact revision-only update never blanks the matrix.
 */
function workspaceFromWeeklyViewSnapshot(
  current: PtScheduleWorkspaceV2Result,
  rawValue: PtScheduleWeeklyViewResult | Record<string, unknown>,
): PtScheduleWorkspaceV2Result {
  const raw = rawValue as Record<string, unknown>
  const nested = raw.workspace && typeof raw.workspace === 'object' && !Array.isArray(raw.workspace)
    ? raw.workspace as Record<string, unknown>
    : {}
  const source = { ...raw, ...nested }
  const sourceBranchId = typeof source.branchId === 'string' ? source.branchId
    : source.branch && typeof source.branch === 'object' ? (source.branch as { id?: string }).id : undefined
  // A late response for a previous week/branch cannot contribute retained
  // evidence to the newly selected workspace.
  if ((sourceBranchId && sourceBranchId !== current.branch.id)
    || (typeof source.weekId === 'string' && source.weekId !== current.weekId)) return current
  const draft = source.draft && typeof source.draft === 'object' && !Array.isArray(source.draft)
    ? source.draft as Record<string, unknown> : {}
  const readObject = <T extends object>(key: string, fallback: T): T => {
    const value = source[key]
    return value && typeof value === 'object' && !Array.isArray(value) ? value as T : fallback
  }
  const readArray = <T>(key: string, fallback: T[]): T[] => Array.isArray(source[key]) ? source[key] as T[] : fallback
  const freshness = typeof raw.freshness === 'string'
    ? raw.freshness
    : typeof source.freshness === 'string' ? source.freshness : undefined
  const pending = raw.rebuilding === true || source.dirty === true || freshness === 'stale'
  const exact = !pending && source.partial !== true && (source.readMode === 'reconciled' || freshness === 'verified')
  const revision = Math.max(0, Number(draft.revision ?? source.draftRevision ?? current.draftRevision))
  if (revision < current.draftRevision) return current
  const viewRevision = Number(raw.viewRevision ?? source.viewRevision ?? current.weeklyViewRevision ?? 0)
  if (revision === current.draftRevision && viewRevision < Number(current.weeklyViewRevision || 0)) return current
  const dirtyGeneration = source.dirtyGeneration
  // A response read before an observed invalidation must not re-promote the
  // previous exact evidence, even when draft/view revisions have not moved.
  if (Number(dirtyGeneration ?? 0) < Number(current.weeklyViewDirtyGeneration ?? -1)) return current
  const sourceRevision = raw.sourceRevision ?? source.sourceRevision
  if (pending && current.weeklyViewFreshness === 'verified'
    && revision === current.draftRevision && viewRevision === current.weeklyViewRevision
    && sourceRevision === current.weeklyViewSourceRevision
    && typeof dirtyGeneration === 'number' && dirtyGeneration <= Number(current.weeklyViewDirtyGeneration ?? -1)) return current
  const publishedVersion = Math.max(0, Number(draft.publishedVersion ?? source.publishedVersion ?? current.publishedVersion))
  const sameEvidence = !pending && current.readMode === 'reconciled' && current.partial !== true
    && sourceRevision !== undefined && sourceRevision === current.weeklyViewSourceRevision
    && revision === current.draftRevision && publishedVersion === current.publishedVersion
    // Only revision-only metadata can safely retain exact evidence. Legacy
    // display snapshots used a narrower source hash than verified snapshots.
    && !Array.isArray(source.students) && !Array.isArray(source.contracts)
  const readMode = exact || sameEvidence ? 'reconciled' : 'display'
  const partial = readMode !== 'reconciled'
  const hadReconciliation = current.readMode === 'reconciled'
    || current.reconciliationState === 'stale' || current.contracts.length > 0
  const nextStatus = draft.status ?? source.draftStatus ?? source.status
  const draftStatus: PtScheduleWorkspaceV2Result['draftStatus'] = nextStatus === 'published' || nextStatus === 'draft'
    ? nextStatus : current.draftStatus
  const mergeById = <T extends { id: string }>(key: string, fallback: T[]) => {
    const prior = new Map(fallback.map((item) => [item.id, item]))
    return readArray<T>(key, fallback).map((item) => ({ ...prior.get(item.id), ...item }))
  }
  const students = mergeById('students', current.students) as PtScheduleWorkspaceV2Result['students']
  if (!exact && hadReconciliation && Array.isArray(source.contracts) && source.contracts.length === 0) {
    const priorStudents = new Map(current.students.map((student) => [student.id, student]))
    const evidenceFields = [
      'eligibleForWeek', 'eligibilityReasons', 'eligibleContractIds', 'validScheduleDates', 'pausedScheduleDates',
      'remainingEntitlementSessions', 'remainingSchedulableSessions', 'activeScheduledSessions', 'activeScheduledThisWeek',
      'maxWeeklySessions', 'schedulableSessionsThisWeek', 'contractStatus', 'contractEndDate',
      'previousWeekScheduledSessions', 'hadSchedulePreviousWeek',
    ] as const
    for (const student of students) {
      const previous = priorStudents.get(student.id)
      if (!previous) continue
      // Retain last-known quota detail, not placeholder zeroes. These values
      // remain informational because the workspace is explicitly stale/display.
      for (const field of evidenceFields) {
        if (Object.prototype.hasOwnProperty.call(previous, field)) Object.assign(student, { [field]: previous[field] })
      }
    }
  }
  // Display projections intentionally omit contract evidence. Keep previously
  // loaded rows for profile detail, but readMode/reconciliationState below make
  // clear they must not be reused as current validation or missing-session totals.
  const contracts = !exact && Array.isArray(source.contracts) && source.contracts.length === 0
    ? current.contracts : mergeById('contracts', current.contracts) as PtScheduleWorkspaceV2Result['contracts']
  const schedule = readObject('schedule', current.schedule)
  return applyWeeklyValidation({
    ...current,
    branch: readObject('branch', current.branch),
    weekId: typeof source.weekId === 'string' ? source.weekId : current.weekId,
    draftRevision: revision,
    publishedVersion,
    publishedRevision: Number(draft.publishedRevision ?? source.publishedRevision ?? current.publishedRevision),
    schedule: Object.fromEntries(Object.entries(schedule).map(([slotId, entries]) => [slotId, entries.map((entry) => {
      const compact = entry as typeof entry & { warningCodes?: string[] }
      return compact.warningCodes ? { ...entry, adminOverrideWarnings: compact.warningCodes } : entry
    })])),
    students,
    trainers: mergeById('trainers', current.trainers) as PtScheduleWorkspaceV2Result['trainers'],
    contracts,
    sessions: readArray('sessions', current.sessions),
    scheduleConfig: readObject('scheduleConfig', current.scheduleConfig),
    sessionRefs: readObject('sessionRefs', current.sessionRefs || {}),
    partial,
    readMode,
    reconciliationState: readMode === 'reconciled' ? 'current' : hadReconciliation ? 'stale' : 'not_loaded',
    draftStatus,
    updatedAt: firestoreValueIso(draft.updatedAt ?? source.updatedAt) || current.updatedAt,
    updatedBy: typeof (draft.updatedBy ?? source.updatedBy) === 'string' ? String(draft.updatedBy ?? source.updatedBy) : current.updatedBy,
    summary: { ...current.summary, ...readObject('summary', current.summary) },
    warnings: readArray('warnings', current.warnings),
    optimizationSummary: source.optimizationSummary && typeof source.optimizationSummary === 'object'
      ? source.optimizationSummary as PtScheduleWorkspaceV2Result['optimizationSummary']
      : current.optimizationSummary,
    unassignedEntries: readArray('unassignedEntries', current.unassignedEntries || []),
    trainerLoads: readArray('trainerLoads', current.trainerLoads || []),
    studentCoverage: source.studentCoverage && typeof source.studentCoverage === 'object'
      ? source.studentCoverage as PtScheduleWorkspaceV2Result['studentCoverage']
      : current.studentCoverage,
    quickCoverage: source.quickCoverage && typeof source.quickCoverage === 'object'
      ? source.quickCoverage as PtScheduleWorkspaceV2Result['quickCoverage']
      : current.quickCoverage,
    weeklySessionCoverage: source.weeklySessionCoverage && typeof source.weeklySessionCoverage === 'object'
      ? source.weeklySessionCoverage as PtScheduleWorkspaceV2Result['weeklySessionCoverage']
      : current.weeklySessionCoverage,
    unassigned: readArray('unassigned', current.unassigned || []),
    weeklyViewRevision: viewRevision,
    weeklyViewDirtyGeneration: typeof dirtyGeneration === 'number' ? dirtyGeneration : current.weeklyViewDirtyGeneration,
    weeklyViewSourceRevision: typeof sourceRevision === 'string'
      ? sourceRevision
      : Number(sourceRevision ?? current.weeklyViewSourceRevision ?? revision),
    weeklyViewFreshness: pending ? 'stale' : freshness || current.weeklyViewFreshness,
    weeklyViewGeneratedAt: typeof raw.generatedAt === 'string'
      ? raw.generatedAt
      : typeof source.generatedAt === 'string' ? source.generatedAt : current.weeklyViewGeneratedAt,
  }, source, current)
}

function scheduleSlotIsPast(
  slotId: string | null,
  dates: Record<string, { display: string; full: string }>,
  today = currentVietnamDateKey(),
) {
  if (!slotId) return false
  const [day, rawHour] = slotId.split('-')
  const date = dates[day]?.full
  const hour = Number(rawHour)
  if (!date || !Number.isInteger(hour)) return false
  // A same-day slot remains part of the editable draft until the day is over.
  // The publish transaction still protects completed/charged sessions, while
  // treating only prior calendar dates as historical prevents the matrix from
  // flipping every morning as the clock crosses each hour.
  return date < today
}

// Keep this formatter and the derived date outside the hot path. The matrix
// asks whether every visible cell is historical on each render; constructing
// an Intl formatter (or formatting the current date) for every cell was
// surprisingly expensive on lower-end tablets.
const VIETNAM_DATE_FORMATTER = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
let vietnamDateCacheKey = ''
let vietnamDateCacheAt = 0

function currentVietnamDateKey(force = false) {
  const now = Date.now()
  // A minute is enough precision here: a slot only becomes historical when
  // its calendar date changes, and this avoids one Intl call per matrix cell.
  if (force || now - vietnamDateCacheAt > 60_000 || !vietnamDateCacheKey) {
    const todayParts = Object.fromEntries(VIETNAM_DATE_FORMATTER.formatToParts(new Date()).map((part) => [part.type, part.value]))
    vietnamDateCacheKey = `${todayParts.year}-${todayParts.month}-${todayParts.day}`
    vietnamDateCacheAt = now
  }
  return vietnamDateCacheKey
}

export function normalizeScheduleSearchText(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi-VN').trim()
}

function localSlotCandidates(
  workspace: PtScheduleWorkspaceV2Result,
  trainerId: string,
  slotId: string,
) {
  const [day] = slotId.split('-')
  const dayIndex = Object.keys(DAY_LABELS).indexOf(day)
  const sessionDate = dayIndex >= 0
    ? new Date(`${workspace.weekId}T00:00:00+07:00`)
    : null
  if (sessionDate) sessionDate.setDate(sessionDate.getDate() + dayIndex)
  const date = sessionDate ? sessionDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) : ''
  // Build the indexes once per picker open instead of scanning every schedule
  // entry and every contract row for each learner. A branch can contain up to
  // 500 learners, so the previous nested scans made typing in the picker
  // noticeably janky even though the resulting ranking was unchanged.
  const entriesByDay = new Map<string, Set<string>>()
  const scheduledCounts = new Map<string, number>()
  Object.entries(workspace.schedule).forEach(([candidateSlotId, values]) => {
    const [candidateDay] = candidateSlotId.split('-')
    const students = entriesByDay.get(candidateDay) || new Set<string>()
    for (const entry of values) {
      if (entry.type === 'off') continue
      students.add(entry.studentId)
      scheduledCounts.set(entry.studentId, (scheduledCounts.get(entry.studentId) || 0) + 1)
    }
    entriesByDay.set(candidateDay, students)
  })
  const studentsScheduledThisDay = entriesByDay.get(day) || new Set<string>()
  const contractsByStudent = new Map<string, typeof workspace.contracts>()
  for (const contract of workspace.contracts) {
    const contracts = contractsByStudent.get(contract.studentId) || []
    contracts.push(contract)
    contractsByStudent.set(contract.studentId, contracts)
  }
  const studentsById = new Map(workspace.students.map((student) => [student.id, student]))
  return workspace.students.filter((student) => {
    if (student.isCrossBranchDisplayOnly) return false
    const contractRows = contractsByStudent.get(student.id) || []
    const latestEnd = (contractRows.length ? contractRows.filter(contract => !['cancelled', 'inactive', 'archived', 'draft'].includes(String(contract.status || '').toLowerCase())).map(contract => String(contract.endDate || '').slice(0, 10)) : [student.contractEndDate || '']).filter(Boolean).sort().at(-1)
    if (!latestEnd) return true
    const end = new Date(`${latestEnd}T00:00:00Z`), day = end.getUTCDate()
    if (!Number.isFinite(end.getTime())) return true
    end.setUTCDate(1)
    end.setUTCMonth(end.getUTCMonth() + 1)
    end.setUTCDate(Math.min(day, new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()))
    return end.toISOString().slice(0, 10) >= currentVietnamDateKey()
  }).map((student): PtScheduleSlotCandidate => {
    const reasons = new Set<string>()
    if (student.status === 'inactive' || student.eligibleForWeek !== true) {
      ;(student.eligibilityReasons?.length ? student.eligibilityReasons : ['STUDENT_NOT_ACTIVE']).forEach((reason) => reasons.add(reason))
    }
    if (student.branchId !== workspace.branch.id) reasons.add('STUDENT_BRANCH_MISMATCH')
    if (approvedOffOnDate(student, date)) reasons.add('CONTRACT_PAUSED')
    else if (date && student.validScheduleDates?.length && !student.validScheduleDates.includes(date)) reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
    if (studentsScheduledThisDay.has(student.id)) reasons.add('STUDENT_MULTIPLE_SESSIONS_PER_DAY')

    // Older/migrated workspace payloads may omit the denormalized eligible
    // contract id list while still returning the complete branch contract
    // rows. In that case derive eligibility from the rows instead of disabling
    // every learner in the manual picker; the command callable remains the
    // canonical final check.
    const eligibleContractIds = new Set(student.eligibleContractIds || [])
    const eligibleContracts = (contractsByStudent.get(student.id) || []).filter((contract) =>
      (!eligibleContractIds.size || eligibleContractIds.has(contract.id))
      && (!date || (String(contract.startDate || '').slice(0, 10) <= date && String(contract.endDate || '').slice(0, 10) >= date)))
    // Compact weekly documents deliberately omit contracts. Missing rows are
    // unknown evidence, not proof of expiry; the write always checks the date.
    if (!eligibleContracts.length && (contractsByStudent.get(student.id)?.length || 0) > 0 && student.eligibleForWeek && !approvedOffOnDate(student, date)) reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
    if (eligibleContracts.length > 1) reasons.add('AMBIGUOUS_ACTIVE_CONTRACT')
    const selectedContract = eligibleContracts.length === 1 ? eligibleContracts[0] : null
    const assignedTrainerIds = selectedContract
      ? [...new Set([selectedContract.trainerId, ...(selectedContract.trainerIds || [])].filter((value): value is string => Boolean(value)))]
      : []
    const trainerAssignmentWarning = assignedTrainerIds.length > 0 && !assignedTrainerIds.includes(trainerId)
    if (!CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus)) reasons.add('AVAILABILITY_NOT_SUBMITTED')
    else if (!student.availableSlots.includes(slotId)) reasons.add('OUTSIDE_STUDENT_AVAILABILITY')

    const reasonList = [...reasons]
    const availabilityReason = reasonList.find((reason) => reason === 'AVAILABILITY_NOT_SUBMITTED' || reason === 'OUTSIDE_STUDENT_AVAILABILITY') as PtScheduleSlotCandidate['availabilityReason'] || null
    const blockingReasons = reasonList.filter((reason) => reason !== 'AVAILABILITY_NOT_SUBMITTED' && reason !== 'OUTSIDE_STUDENT_AVAILABILITY')
    return {
      studentId: student.id,
      name: student.name || 'Chưa cập nhật tên',
      phone: student.phone || '',
      eligible: reasonList.length === 0,
      reasons: reasonList,
      contractId: selectedContract?.id || null,
      date,
      matchesStudentAvailability: !availabilityReason,
      manualSelectable: blockingReasons.length === 0,
      availabilityReason,
      trainerAssignmentWarning,
      assignedTrainerIds,
    }
  }).sort((left, right) => {
    const rank = (candidate: PtScheduleSlotCandidate) => candidate.eligible ? 0 : candidate.manualSelectable ? 1 : 2
    const leftStudent = studentsById.get(left.studentId)
    const rightStudent = studentsById.get(right.studentId)
    const leftMissing = Math.max(0, Number(leftStudent?.sessionsPerWeek || 0) - (scheduledCounts.get(left.studentId) || 0))
    const rightMissing = Math.max(0, Number(rightStudent?.sessionsPerWeek || 0) - (scheduledCounts.get(right.studentId) || 0))
    return rank(left) - rank(right)
      || Number(Boolean(left.trainerAssignmentWarning)) - Number(Boolean(right.trainerAssignmentWarning))
      || rightMissing - leftMissing
      || Number(leftStudent?.availableSlots?.length || 0) - Number(rightStudent?.availableSlots?.length || 0)
      || left.name.localeCompare(right.name, 'vi')
  })
}

export {
  APP_UPDATE_READY_EVENT,
  APP_UPDATE_READY_KEY,
  BRANCH_CATALOG_CACHE_TTL_MS,
  CONFIRMED_AVAILABILITY_STATUSES,
  CONTRACT_WARNING_REASONS,
  DAY_LABELS,
  MIN_WEEK_OFFSET,
  LEARNER_WARNING_REASONS,
  TRAINER_LOAD_LABELS,
  WORKSPACE_CACHE_REVALIDATE_MS,
  availabilityDayCount,
  availabilityOriginLabel,
  candidateCanBeManuallyScheduled,
  candidateMatchesStudentAvailability,
  commandKey,
  compareScheduleSlots,
  contractStatusLabel,
  currentVietnamDateKey,
  diagnosticReasonLabel,
  finiteCount,
  formatDiagnosticDate,
  getCachedBranchCatalog,
  localSlotCandidates,
  normalizedTrainerLoadStatus,
  readWorkspaceCache,
  scheduleSlotIsPast,
  scheduleSlotLabel,
  trainerEmploymentLabel,
  warningCauseFor,
  warningCauseLabel,
  warningReasonPriority,
  workspaceFromDraftSnapshot,
  workspaceFromWeeklyViewSnapshot,
  workspaceRealtimeFingerprint,
  writeWorkspaceCache,
}
export type { StudentFilter, WarningCause, WarningFilter, WorkspaceSyncState, WorkspaceTab }
