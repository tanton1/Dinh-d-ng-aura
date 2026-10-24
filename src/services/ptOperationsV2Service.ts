import { httpsCallable, type Functions } from 'firebase/functions'
import type { WorkspaceSyncState } from '../utils/workspaceSync'
import { firebaseAuth } from '../lib/firebase'
import { firebaseFunctions, firebaseScheduleOptimizerFunctions } from '../lib/firebaseFunctions'
import { reportClientIssue } from './clientTelemetryService'
import { normalizeTrainerStudentDetail } from './ptOperationsV2Normalization'
import { runReadOnlyWithFallback } from './readOnlyCallableService'

function functionsInstance() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return firebaseFunctions
}

function regionalFunctionsInstance() {
  if (!firebaseScheduleOptimizerFunctions) throw new Error('Firebase Functions vùng lịch chưa sẵn sàng.')
  return firebaseScheduleOptimizerFunctions
}

function callableErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return ''
  return typeof error.code === 'string' ? error.code : ''
}

function callableErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object' || !('message' in error)) return ''
  return typeof error.message === 'string' ? error.message.trim() : ''
}

function genericCallableMessage(value: string) {
  return !value || /^(?:firebase:\s*)?(?:functions\/)?(?:internal|unknown|error)(?:\s*\(functions\/(?:internal|unknown)\))?\.?$/i.test(value)
}

function staffCallableMessage(code: string, rawMessage: string) {
  if (!genericCallableMessage(rawMessage)) return rawMessage
  if (code === 'functions/resource-exhausted') return 'Không gian Staff đang có nhiều lượt truy cập. Aura đã thử lại nhưng chưa có phiên xử lý trống.'
  if (code === 'functions/deadline-exceeded') return 'Dữ liệu Staff phản hồi quá thời gian. Hãy thử tải lại trang.'
  if (code === 'functions/unavailable') return 'Kết nối tới dịch vụ Staff tạm gián đoạn. Hãy kiểm tra mạng và thử lại.'
  if (code === 'functions/internal') return 'Dịch vụ Staff gặp lỗi máy chủ. Mã lỗi đã được gửi để Aura đối soát.'
  if (code === 'functions/unauthenticated') return 'Phiên đăng nhập Staff đã hết hạn. Hãy đăng nhập lại.'
  if (code === 'functions/permission-denied') return 'Tài khoản Staff chưa đồng bộ quyền hoặc phạm vi chi nhánh. Hãy liên hệ quản trị viên.'
  if (code === 'functions/not-found') return 'Tài khoản chưa được liên kết với hồ sơ PT đang hoạt động.'
  return rawMessage || 'Không thể kết nối không gian làm việc Staff.'
}

function retryDelay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function call<Input, Output>(
  name: string,
  input: Input,
  options: { readOnly?: boolean; maximumAttempts?: number } = {},
  client: Functions | null = firebaseFunctions,
  phasePrefix = 'staff_callable',
): Promise<Output> {
  const readOnly = options.readOnly === true
  const invoke = httpsCallable<Input, Output>(client || functionsInstance(), name, { timeout: readOnly ? 20_000 : 30_000 })
  const retryableCodes = new Set([
    'functions/internal',
    'functions/unavailable',
    'functions/deadline-exceeded',
  ])
  const maximumAttempts = Math.max(1, Math.min(2, options.maximumAttempts ?? (readOnly ? 2 : 1)))
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      return (await invoke(input)).data
    } catch (error) {
      const code = callableErrorCode(error)
      const rawMessage = callableErrorMessage(error)
      const shouldRetry = retryableCodes.has(code) && attempt < maximumAttempts - 1
      if (!shouldRetry) {
        reportClientIssue('firestore', error, {
          phase: `${phasePrefix}_${name}`,
          route: window.location.hash,
          retryable: retryableCodes.has(code) || code === 'functions/resource-exhausted',
        })
        throw new Error(staffCallableMessage(code, rawMessage), { cause: error })
      }
      await retryDelay(400)
    }
  }
  throw new Error('Không thể kết nối không gian làm việc Staff.')
}

type ReadCacheEntry = { expiresAt: number; value?: unknown; promise?: Promise<unknown> }
const readCache = new Map<string, ReadCacheEntry>()

function readCacheKey(name: string, input: unknown) {
  return `${firebaseAuth?.currentUser?.uid || 'anonymous'}:${name}:${JSON.stringify(input)}`
}

async function cachedCall<Input, Output>(
  name: string,
  input: Input,
  ttlMs: number,
  client: Functions | null = firebaseFunctions,
  phasePrefix = 'staff_callable',
): Promise<Output> {
  const key = readCacheKey(name, input)
  const now = Date.now()
  const cached = readCache.get(key)
  if (cached?.value !== undefined && cached.expiresAt > now) return cached.value as Output
  if (cached?.promise) return cached.promise as Promise<Output>
  const promise = call<Input, Output>(name, input, { readOnly: true }, client, phasePrefix)
    .then((value) => {
      if (readCache.get(key)?.promise === promise) readCache.set(key, { value, expiresAt: Date.now() + ttlMs })
      return value
    })
    .catch((error) => {
      if (readCache.get(key)?.promise === promise) readCache.delete(key)
      throw error
    })
  readCache.set(key, { promise, expiresAt: now + ttlMs })
  return promise
}

async function regionalCall<Input, Output>(name: string, input: Input, options: { readOnly?: boolean } = {}) {
  return call<Input, Output>(name, input, options, regionalFunctionsInstance(), 'staff_regional_callable')
}

async function regionalReadWithFallback<Input, Output>(regionalName: string, legacyName: string, input: Input) {
  if (!firebaseScheduleOptimizerFunctions) {
    return call<Input, Output>(legacyName, input, { readOnly: true, maximumAttempts: 1 }, firebaseFunctions, 'staff_callable')
  }
  return runReadOnlyWithFallback(
    () => call<Input, Output>(regionalName, input, { readOnly: true, maximumAttempts: 1 }, firebaseScheduleOptimizerFunctions, 'staff_regional_callable'),
    () => call<Input, Output>(legacyName, input, { readOnly: true, maximumAttempts: 1 }, firebaseFunctions, 'staff_callable'),
  )
}

async function regionalCachedReadWithFallback<Input, Output>(
  regionalName: string,
  legacyName: string,
  input: Input,
  ttlMs: number,
) {
  const key = readCacheKey(regionalName, input)
  const now = Date.now()
  const cached = readCache.get(key)
  if (ttlMs > 0 && cached?.value !== undefined && cached.expiresAt > now) return cached.value as Output
  if (cached?.promise) return cached.promise as Promise<Output>
  const promise = regionalReadWithFallback<Input, Output>(regionalName, legacyName, input)
    .then((value) => {
      if (readCache.get(key)?.promise === promise) {
        if (ttlMs > 0) readCache.set(key, { value, expiresAt: Date.now() + ttlMs })
        else readCache.delete(key)
      }
      return value
    })
    .catch((error) => {
      if (readCache.get(key)?.promise === promise) readCache.delete(key)
      throw error
    })
  readCache.set(key, { promise, expiresAt: now + ttlMs })
  return promise
}

function invalidateReadCache(...names: string[]) {
  const uidPrefix = `${firebaseAuth?.currentUser?.uid || 'anonymous'}:`
  for (const key of readCache.keys()) {
    if (key.startsWith(uidPrefix) && names.some((name) => key.startsWith(`${uidPrefix}${name}:`))) readCache.delete(key)
  }
}

export interface TrainerStudentSummary {
  id: string
  name: string
  phone: string
  email: string
  branchId: string
  status: string
  sessionsPerWeek: number
  assignmentRole: 'primary' | 'secondary' | 'branch' | 'schedule'
  contract: null | {
    id: string
    status: string
    startDate?: string
    endDate?: string
    totalSessions: number
    usedSessions: number
    remainingSessions?: number
    chargedSessions?: number | null
    historySessions?: number | null
    storedUsedSessions?: number
    formulaVersion?: 'contract-usage-v3-daily' | 'contract-usage-v2'
    sourceVersion?: 'contract-usage-v3-daily' | 'contract-usage-v2' | string
    reconciliationStatus?: 'matched' | 'legacy_projection' | 'projection_behind' | 'over_entitlement'
  }
}

export interface TrainerSessionSummary {
  id: string
  studentId: string
  trainerId: string
  studentName?: string
  studentPhone?: string
  studentEmail?: string
  studentBranchId?: string
  branchId?: string
  date: string
  hour?: number
  status: string
  scheduleStatus?: 'scheduled' | 'rescheduled' | 'cancelled'
  billingStatus?: 'pending' | 'charged' | 'exempt' | 'review_required'
  attendanceStatus?: 'pending' | 'present' | 'late' | 'no_show' | 'policy_charge'
  /** A complimentary make-up session created to compensate a missed source session. */
  sessionKind?: 'regular' | 'makeup'
  makeupSourceSessionId?: string | null
  makeupMode?: 'standalone_shift' | 'paired_existing_shift' | null
  commissionEligible?: boolean
  advanceAbsenceNotice?: {
    status: 'none' | 'reported'
    reason?: string
    note?: string
    reportedAt?: string | null
    reportedBy?: string
    replacementLocked?: boolean
    replacementRequestId?: string | null
    replacementSessionId?: string | null
  } | null
  lateMinutes?: number | null
  noShowReason?: string
  chargedAt?: string
  confirmedAt?: string
  contractId?: string
  contractEffective?: boolean
  /** The linked contract still has quota and is schedulable on this session date. */
  contractSchedulable?: boolean
  contract?: TrainerStudentSummary['contract']
  revision?: number
  timeZone: string
}

export interface CoachWorkspaceScope {
  schemaVersion: number
  source: 'pt_contract_assignments'
  /** Present when only this section's capability and counters were loaded. */
  section?: 'requests'
  staffId: string
  /** Branches the signed-in PT is allowed to work in. */
  branchIds?: string[]
  tabs: {
    students: boolean
    schedule: boolean
    requests: boolean
    nutrition: boolean
  }
  counts: {
    primaryStudents: number
    secondaryStudents: number
    nutritionStudents: number
    teachingSessions: number
    pendingRequests: number
  }
}

export interface TrainerAvailabilityWorkspace {
  schemaVersion: number
  trainerId: string
  trainerName: string
  branchId: string
  availableSlots: string[]
  baseAvailableSlots: string[]
  weekId: string | null
  weeklyOverride: boolean
  offDates: string[]
  locked: boolean
  cutoffAt: string | null
  source: 'recurring' | 'weekly'
  updatedAt: string | null
  availabilityMode: 'configured' | 'unrestricted' | 'unconfigured'
  availabilityRevision: number
  scheduleConfig: { workingDays: string[]; workingHours: number[] }
}

export interface TrainerWorkspaceBootstrap {
  syncState?: WorkspaceSyncState
  schemaVersion: number
  scope: CoachWorkspaceScope
  students: TrainerStudentSummary[]
  branches: Array<{ id: string; name: string }>
  sessions: TrainerSessionSummary[]
  requests: TrainerSessionRequestSummary[]
  hasMore: boolean
}

export interface TrainerStudentContractDetail {
  id: string
  packageName: string
  status: string
  startDate: string
  endDate: string
  totalSessions: number
  usedSessions: number
  remainingSessions: number
  chargedSessions: number | null
  historySessions: number | null
  sourceVersion?: 'contract-usage-v3-daily' | 'contract-usage-v2' | string
  reconciliationStatus: 'matched' | 'legacy_projection' | 'projection_behind' | 'over_entitlement'
  schedulableToday: boolean
  /** Whether at least one day in the selected detail week is schedulable. */
  schedulableOnWeek?: boolean
  pausedToday: boolean
}

export interface TrainerStudentDetail {
  schemaVersion: number
  formulaVersion: 'contract-usage-v3-daily' | 'contract-usage-v2'
  student: Record<string, unknown> & {
    id: string
    name?: string
    phone?: string
    email?: string
    dob?: string
    branchId?: string
    sessionsPerWeek?: number
    status?: string
  }
  contracts: TrainerStudentContractDetail[]
  sessions: TrainerSessionSummary[]
  availability: {
    weekId: string
    slots: string[]
    minimumSlots?: number
    requiredSessions?: number
    revision?: number
    sourceRevision?: number
    status: string
    confirmed: boolean
    locked: boolean
    cutoffAt: string
    submittedAt?: string | null
    updatedAt?: string | null
    source: string
    sourceWeekId: string | null
  }
  trainingProgram: null | {
    id: string
    title: string
    goal: string
    status: 'draft' | 'active'
    revision: number
    trainingDayCount: number
    exerciseCount: number
    trainingDays: Array<{
      id: string
      title: string
      focusMuscles: string[]
      notes: string
      exercises: Array<{
        id: string
        nameVi: string
        targetMuscles: string[]
        secondaryMuscles: string[]
        sets: number
        repMinimum: number
        repMaximum: number
        targetWeightKg: number
        targetRpe: number
        restSeconds: number
        notes: string
      }>
    }>
    updatedAt: string
  }
  workoutLogs: Array<Record<string, unknown> & {
    id: string
    source?: 'pt_tracking' | 'legacy'
    sessionId?: string
    date?: string
    hour?: number | null
    status?: string
    trainingDayTitle?: string
    programName?: string
    note?: string
    painNotes?: string
    completedAt?: string
    updatedAt?: string
    metrics?: {
      completedSets: number
      totalVolumeKg: number
      maximumWeightKg: number
      maximumRpe: number
      painAlert: boolean
    }
  }>
}

export interface TrainerSessionRequestSummary {
  id: string
  sessionId: string | null
  studentId: string
  studentName?: string
  contractId: string
  type: 'cancel' | 'reschedule' | 'additional' | 'makeup'
  status: 'pending' | 'approved' | 'rejected'
  originalDate: string | null
  originalHour?: number
  newDate?: string | null
  newHour?: number | null
  makeupSession?: boolean
  makeupSourceSessionId?: string | null
  makeupMode?: 'standalone_shift' | 'paired_existing_shift' | null
  commissionEligible?: boolean
  preAbsenceSourceSessionId?: string | null
  releasedSourceSessionId?: string | null
  pairsExistingSession?: boolean
  reason: string
  submittedAtIso?: string
  createdAt?: string
}

export interface SalesQuoteSummary {
  id: string
  code: string
  customerName: string
  customerPhone: string
  branchId: string
  packageName: string
  finalPrice: number
  status: string
  memberReferralCode?: string | null
}

export interface SalesCatalog {
  branches: Array<{ id: string; name: string }>
  packages: Array<{ id: string; name: string; price: number; branchId: string }>
}

export async function listMyAssignedStudents(limit = 100) {
  const accountUid = firebaseAuth?.currentUser?.uid
  const result = await regionalCachedReadWithFallback<{ limit: number }, { students: TrainerStudentSummary[]; hasMore: boolean }>(
    'listMyAssignedStudentsRegional',
    'listMyAssignedStudents',
    { limit },
    0,
  )
  if (accountUid !== firebaseAuth?.currentUser?.uid) throw new Error('Phiên đăng nhập đã thay đổi.')
  return result
}

export async function listMyTrainerSchedule(from: string, to: string, limit = 300) {
  return regionalCachedReadWithFallback<{ from: string; to: string; limit: number }, { sessions: TrainerSessionSummary[]; requests: TrainerSessionRequestSummary[] }>(
    'listMyTrainerScheduleRegional',
    'listMyTrainerSchedule',
    { from, to, limit },
    15_000,
  )
}

export interface SalesWorkspace {
  schemaVersion: number
  quotes: SalesQuoteSummary[]
  catalog: SalesCatalog
}

export async function getMyCoachWorkspaceScope() {
  return regionalCachedReadWithFallback<Record<string, never>, CoachWorkspaceScope>(
    'getMyCoachWorkspaceScopeRegional',
    'getMyCoachWorkspaceScope',
    {},
    90_000,
  )
}

export async function getMyTrainerAvailability(weekId?: string) {
  const input = weekId ? { weekId } : {}
  return regionalCachedReadWithFallback<{ weekId?: string }, TrainerAvailabilityWorkspace>(
    'getMyTrainerAvailabilityRegional',
    'getMyTrainerAvailability',
    input,
    30_000,
  )
}

export async function saveMyTrainerAvailability(input: { weekId?: string; availableSlots: string[]; offDates?: string[]; expectedRevision: number }) {
  const result = await regionalCall<typeof input, TrainerAvailabilityWorkspace>('saveMyTrainerAvailabilityRegional', input)
  invalidateReadCache(
    'getMyTrainerAvailabilityRegional',
    'getMyTrainerAvailability',
    'getMyTrainerWorkspaceRegional',
    'getMyTrainerWorkspace',
    'getMyCoachWorkspaceScopeRegional',
    'getMyCoachWorkspaceScope',
  )
  return result
}

export async function getMyTrainerWorkspace(
  section: 'students' | 'schedule' | 'requests',
  from: string,
  to: string,
  limit = section === 'students' ? 100 : 300,
) {
  const accountUid = firebaseAuth?.currentUser?.uid
  const result = await regionalCachedReadWithFallback<
    { section: 'students' | 'schedule' | 'requests'; from: string; to: string; limit: number; independentTabs: true },
    TrainerWorkspaceBootstrap
  >('getMyTrainerWorkspaceRegional', 'getMyTrainerWorkspace', { section, from, to, limit, independentTabs: true }, 0)
  if (accountUid !== firebaseAuth?.currentUser?.uid) throw new Error('Phiên đăng nhập đã thay đổi.')
  return result
}

export async function getMyTrainerStudentDetail(studentId: string, weekId: string) {
  const result = await regionalCachedReadWithFallback<{ studentId: string; weekId: string }, unknown>(
    'getMyTrainerStudentDetailRegional',
    'getMyTrainerStudentDetail',
    { studentId, weekId },
    30_000,
  )
  return normalizeTrainerStudentDetail(result, { studentId, weekId })
}

export async function confirmMySession(sessionId: string, expectedRevision: number) {
  const result = await regionalCall<{ sessionId: string; expectedRevision: number }, { unchanged: boolean; revision: number }>('confirmMySessionRegional', { sessionId, expectedRevision })
  invalidateReadCache(
    'getMyCoachWorkspaceScopeRegional',
    'getMyCoachWorkspaceScope',
    'getMyTrainerWorkspaceRegional',
    'getMyTrainerWorkspace',
    'listMyTrainerScheduleRegional',
    'listMyTrainerSchedule',
  )
  return result
}

export type SessionAttendanceStatus = 'present' | 'late' | 'no_show'

export async function recordMySessionAttendance(input: {
  sessionId: string
  expectedRevision: number
  attendanceStatus: SessionAttendanceStatus
  lateMinutes?: 5 | 10 | 15
  noShowReason?: '' | 'busy' | 'sick' | 'forgot' | 'unreachable' | 'other'
  note?: string
}) {
  const result = await regionalCall<typeof input, {
    unchanged: boolean
    revision: number
    attendanceEventId: string
    attendanceStatus: SessionAttendanceStatus
  }>('recordMySessionAttendanceRegional', input)
  invalidateReadCache(
    'getMyCoachWorkspaceScopeRegional',
    'getMyCoachWorkspaceScope',
    'getMyTrainerWorkspaceRegional',
    'getMyTrainerWorkspace',
    'listMyTrainerScheduleRegional',
    'listMyTrainerSchedule',
  )
  return result
}

export async function bulkConfirmMySessions(items: Array<{ sessionId: string; expectedRevision: number }>) {
  const result = await regionalCall<
    { items: Array<{ sessionId: string; expectedRevision: number }> },
    { total: number; confirmed: number; failed: number; results: Array<{ sessionId: string; ok: boolean; revision?: number; code?: string }> }
  >('bulkConfirmMySessionsRegional', { items })
  invalidateReadCache(
    'getMyCoachWorkspaceScopeRegional',
    'getMyCoachWorkspaceScope',
    'getMyTrainerWorkspaceRegional',
    'getMyTrainerWorkspace',
    'listMyTrainerScheduleRegional',
    'listMyTrainerSchedule',
  )
  return result
}

export async function requestSessionChange(input: {
  sessionId: string
  contractId: string
  type: 'cancel' | 'reschedule' | 'makeup'
  reason: string
  newDate?: string
  newHour?: number
  idempotencyKey: string
}) {
  const result = await regionalCall<typeof input, { requestId: string }>('requestSessionChangeRegional', input)
  invalidateReadCache(
    'getMyCoachWorkspaceScopeRegional',
    'getMyCoachWorkspaceScope',
    'getMyTrainerWorkspaceRegional',
    'getMyTrainerWorkspace',
    'listMyTrainerScheduleRegional',
    'listMyTrainerSchedule',
  )
  return result
}

export async function reportMySessionAdvanceAbsence(input: {
  sessionId: string
  expectedRevision: number
  reason?: string
  note?: string
}) {
  const result = await call<typeof input, { unchanged: boolean; revision: number; sessionId: string; notice: NonNullable<TrainerSessionSummary['advanceAbsenceNotice']> }>('reportMySessionAdvanceAbsence', input)
  invalidateReadCache(
    'getMyCoachWorkspaceScopeRegional',
    'getMyCoachWorkspaceScope',
    'getMyTrainerWorkspaceRegional',
    'getMyTrainerWorkspace',
    'listMyTrainerScheduleRegional',
    'listMyTrainerSchedule',
  )
  return result
}

export async function requestStudentSessionAddition(input: {
  sourceSessionId: string
  studentId: string
  contractId: string
  reason: string
  idempotencyKey: string
}) {
  const result = await call<typeof input, { unchanged: boolean; requestId: string; status: 'pending'; type: 'additional'; sourceSessionId: string; date: string; hour: number }>('requestStudentSessionAddition', input)
  invalidateReadCache(
    'getMyCoachWorkspaceScopeRegional',
    'getMyCoachWorkspaceScope',
    'getMyTrainerWorkspaceRegional',
    'getMyTrainerWorkspace',
    'listMyTrainerScheduleRegional',
    'listMyTrainerSchedule',
  )
  return result
}

export async function listMyQuotes(limit = 100) {
  return regionalReadWithFallback<{ limit: number }, { quotes: SalesQuoteSummary[] }>(
    'listMyQuotesRegional',
    'listMyQuotes',
    { limit },
  )
}

export async function getMySalesCatalog() {
  return regionalReadWithFallback<Record<string, never>, SalesCatalog>(
    'getMySalesCatalogRegional',
    'getMySalesCatalog',
    {},
  )
}

export async function getMySalesWorkspace(limit = 100) {
  return regionalCachedReadWithFallback<{ limit: number }, SalesWorkspace>(
    'getMySalesWorkspaceRegional',
    'getMySalesWorkspace',
    { limit },
    30_000,
  )
}

export async function createQuote(input: {
  customerName: string
  customerPhone: string
  branchId: string
  packageId: string
  discount: number
  memberReferralCode?: string
}) {
  const result = await regionalCall<typeof input, { quoteId: string; code: string; finalPrice: number }>('createQuoteRegional', input)
  invalidateReadCache(
    'getMySalesWorkspaceRegional',
    'getMySalesWorkspace',
    'listMyQuotesRegional',
    'listMyQuotes',
  )
  return result
}

export async function createStudentDraft(input: {
  displayName: string
  phoneNumber: string
  email?: string
  branchId: string
}) {
  return regionalCall<typeof input, { leadId: string }>('createStudentDraftRegional', input)
}
