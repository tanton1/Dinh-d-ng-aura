import {
  listPtScheduleBranches,
  ptScheduleConflictLabel,
  type PtScheduleBranchOption,
  type PtScheduleSlotCandidate,
  type PtScheduleTrainerDailyLoad,
  type PtScheduleUnassignedEntry,
  type PtScheduleWorkspaceV2Result,
} from '../../services/ptSchedulePublishService'

type WorkspaceTab = 'matrix' | 'opportunities' | 'students' | 'warnings' | 'history'
type StudentFilter = 'all' | 'missing' | 'contract' | 'availability' | 'trainer' | 'ready'
type WarningFilter = 'priority' | 'contract' | 'learner' | 'capacity' | 'system' | 'pairing' | 'trainer'
type WarningCause = 'contract' | 'learner' | 'capacity' | 'system'
type WorkspaceSyncState = 'connecting' | 'live' | 'syncing' | 'offline'
const CONFIRMED_AVAILABILITY_STATUSES = new Set(['submitted', 'locked', 'inherited', 'recurring'])
const WORKSPACE_CACHE_TTL_MS = 3 * 60_000
const WORKSPACE_CACHE_REVALIDATE_MS = 60_000
const WORKSPACE_CACHE_LIMIT = 8
const BRANCH_CATALOG_CACHE_TTL_MS = 10 * 60_000
const MIN_WEEK_OFFSET = -12
const APP_UPDATE_READY_KEY = 'aura:update-ready'
const APP_UPDATE_READY_EVENT = 'aura:update-ready'

type WorkspaceCacheEntry = { value: PtScheduleWorkspaceV2Result; storedAt: number }
const workspaceCache = new Map<string, WorkspaceCacheEntry>()

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

function readWorkspaceCache(scope: string) {
  const cached = workspaceCache.get(scope)
  if (!cached) return null
  if (Date.now() - cached.storedAt > WORKSPACE_CACHE_TTL_MS) {
    workspaceCache.delete(scope)
    return null
  }
  workspaceCache.delete(scope)
  workspaceCache.set(scope, cached)
  return cached
}

function writeWorkspaceCache(scope: string, value: PtScheduleWorkspaceV2Result) {
  workspaceCache.delete(scope)
  workspaceCache.set(scope, { value, storedAt: Date.now() })
  while (workspaceCache.size > WORKSPACE_CACHE_LIMIT) {
    const oldestScope = workspaceCache.keys().next().value as string | undefined
    if (!oldestScope) break
    workspaceCache.delete(oldestScope)
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

function formatPublishedAt(value: string | null) {
  if (!value) return 'Chưa có thời gian'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? 'Chưa có thời gian'
    : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
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

function availabilitySlotLabel(slotId: string) {
  const [day, rawHour] = slotId.split('-')
  return `${DAY_LABELS[day] || day} ${String(Number(rawHour)).padStart(2, '0')}:00`
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
  if (blockerCategory === 'trainer_capacity' || blockerCategory === 'branch_capacity') return 'capacity'
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

function candidateCanBeManuallyScheduled(candidate: PtScheduleSlotCandidate) {
  return candidate.manualSelectable
    ?? (candidate.eligible || candidate.reasons.every((reason) => STUDENT_AVAILABILITY_CONFLICTS.has(reason)))
}

function trainerEmploymentLabel(value: 'full_time' | 'part_time' | 'collaborator' | undefined) {
  if (value === 'collaborator') return 'CTV'
  if (value === 'part_time') return 'Part-time'
  return 'PT chính thức'
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

function diagnosticActionLabel(code: string | undefined) {
  switch (code) {
    case 'EDIT_STUDENT_AVAILABILITY': return 'Bổ sung / điều chỉnh lịch rảnh'
    case 'REVIEW_CONTRACT_QUOTA': return 'Kiểm tra quota hoặc nối tiếp hợp đồng'
    case 'REVIEW_CONTRACT_DATES': return 'Kiểm tra ngày hiệu lực hợp đồng'
    case 'ADD_TRAINER_AVAILABILITY': return 'Bổ sung lịch rảnh PT hoặc mở PT hỗ trợ'
    case 'OPEN_OTHER_SLOT': return 'Mở ca khác còn công suất'
    case 'RERUN_OPTIMIZER': return 'Chạy tối ưu lần 2 hoặc xếp tay'
    default: return 'Mở ca đề xuất và xử lý thủ công'
  }
}

function contractStatusLabel(status: string | undefined) {
  switch (status) {
    case 'expired': return 'Đã hết hạn'
    case 'expiring': return 'Sắp hết hạn trong tuần'
    case 'quota_exhausted': return 'Đã hết buổi'
    case 'paused': return 'Đang OFF / bảo lưu'
    case 'missing': return 'Chưa có hợp đồng'
    case 'not_started_or_ended': return 'Chưa có ngày hiệu lực phù hợp'
    default: return 'Còn hiệu lực'
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
    schedule: value.schedule,
    students: value.students.map((student) => [student.id, student.status, student.sessionsPerWeek, student.availabilityRevision, student.availableSlots, student.remainingEntitlementSessions, student.activeScheduledSessions, student.eligibleForWeek, student.contractStatus]),
    trainers: value.trainers.map((trainer) => [trainer.id, trainer.status, trainer.availabilityRevision, trainer.availableSlots, trainer.availabilityMode, trainer.slotCapacity, trainer.dailySessionTarget, trainer.employmentType]),
    contracts: value.contracts.map((contract) => [contract.id, contract.status, contract.startDate, contract.endDate, contract.usedSessions, contract.remainingSchedulableSessions, contract.trainerId, contract.trainerIds]),
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
    const overridden = Object.prototype.hasOwnProperty.call(weeklyTargets, student.id)
    const defaultTarget = Math.max(0, Math.min(Number(student.defaultSessionsPerWeek || 0), Number(student.maxWeeklySessions || 0)))
    const target = overridden
      ? Math.max(0, Math.min(Number(weeklyTargets[student.id] || 0), Number(student.maxWeeklySessions || 0)))
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
  const unassignedEntries: NonNullable<PtScheduleWorkspaceV2Result['unassignedEntries']> = Array.isArray(raw.unassignedEntries)
    ? raw.unassignedEntries as NonNullable<PtScheduleWorkspaceV2Result['unassignedEntries']>
    : []
  const publishedVersion = Math.max(0, Number(raw.publishedVersion ?? current.publishedVersion))
  const publishedRevision = Number(raw.publishedRevision ?? current.publishedRevision)
  const draftStatus: PtScheduleWorkspaceV2Result['draftStatus'] = raw.status === 'published' ? 'published' : 'draft'
  return {
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
    unassignedEntries,
    trainerLoads: undefined,
    studentCoverage: undefined,
    summary: {
      ...current.summary,
      scheduledEntries,
      missingSessions,
      unassignedEntries: unassignedEntries.length,
    },
  }
}

function scheduleSlotIsPast(slotId: string | null, dates: Record<string, { display: string; full: string }>) {
  if (!slotId) return false
  const [day, rawHour] = slotId.split('-')
  const date = dates[day]?.full
  const hour = Number(rawHour)
  if (!date || !Number.isInteger(hour)) return false
  // A same-day slot remains part of the editable draft until the day is over.
  // The publish transaction still protects completed/charged sessions, while
  // treating only prior calendar dates as historical prevents the matrix from
  // flipping every morning as the clock crosses each hour.
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]))
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`
  return date < today
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
  const entries = Object.entries(workspace.schedule)
  const scheduledCounts = new Map<string, number>()
  Object.values(workspace.schedule).flat().forEach((entry) => {
    if (entry.type !== 'off') scheduledCounts.set(entry.studentId, (scheduledCounts.get(entry.studentId) || 0) + 1)
  })
  return workspace.students.map((student): PtScheduleSlotCandidate => {
    const reasons = new Set<string>()
    if (student.status === 'inactive' || student.eligibleForWeek !== true) {
      ;(student.eligibilityReasons?.length ? student.eligibilityReasons : ['STUDENT_NOT_ACTIVE']).forEach((reason) => reasons.add(reason))
    }
    if (student.branchId !== workspace.branch.id) reasons.add('STUDENT_BRANCH_MISMATCH')
    if (date && student.validScheduleDates?.length && !student.validScheduleDates.includes(date)) reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
    if (entries.some(([candidateSlotId, values]) => candidateSlotId.split('-')[0] === day
      && values.some((entry) => entry.type !== 'off' && entry.studentId === student.id))) reasons.add('STUDENT_MULTIPLE_SESSIONS_PER_DAY')

    // Older/migrated workspace payloads may omit the denormalized eligible
    // contract id list while still returning the complete branch contract
    // rows. In that case derive eligibility from the rows instead of disabling
    // every learner in the manual picker; the command callable remains the
    // canonical final check.
    const eligibleContractIds = new Set(student.eligibleContractIds || [])
    const eligibleContracts = workspace.contracts.filter((contract) => contract.studentId === student.id
      && (!eligibleContractIds.size || eligibleContractIds.has(contract.id))
      && (!date || (String(contract.startDate || '').slice(0, 10) <= date && String(contract.endDate || '').slice(0, 10) >= date)))
    if (!eligibleContracts.length && student.eligibleForWeek) reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
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
    const leftStudent = workspace.students.find((student) => student.id === left.studentId)
    const rightStudent = workspace.students.find((student) => student.id === right.studentId)
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
  availabilitySlotLabel,
  candidateCanBeManuallyScheduled,
  candidateMatchesStudentAvailability,
  commandKey,
  compareScheduleSlots,
  contractStatusLabel,
  diagnosticActionLabel,
  diagnosticReasonLabel,
  finiteCount,
  formatDiagnosticDate,
  formatPublishedAt,
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
  workspaceRealtimeFingerprint,
  writeWorkspaceCache,
}
export type { StudentFilter, WarningCause, WarningFilter, WorkspaceSyncState, WorkspaceTab }
