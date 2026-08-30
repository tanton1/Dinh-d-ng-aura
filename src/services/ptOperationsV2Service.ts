import { httpsCallable } from 'firebase/functions'
import { firebaseAuth } from '../lib/firebase'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { reportClientIssue } from './clientTelemetryService'

function functionsInstance() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return firebaseFunctions
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

async function call<Input, Output>(name: string, input: Input, options: { readOnly?: boolean } = {}): Promise<Output> {
  const readOnly = options.readOnly === true
  const invoke = httpsCallable<Input, Output>(functionsInstance(), name, { timeout: readOnly ? 20_000 : 30_000 })
  const retryableCodes = new Set([
    'functions/internal',
    'functions/unavailable',
    'functions/deadline-exceeded',
  ])
  const maximumAttempts = readOnly ? 2 : 1
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      return (await invoke(input)).data
    } catch (error) {
      const code = callableErrorCode(error)
      const rawMessage = callableErrorMessage(error)
      const shouldRetry = retryableCodes.has(code) && attempt < maximumAttempts - 1
      if (!shouldRetry) {
        reportClientIssue('firestore', error, {
          phase: `staff_callable_${name}`,
          route: window.location.hash,
          retryable: retryableCodes.has(code) || code === 'functions/resource-exhausted',
        })
        throw new Error(staffCallableMessage(code, rawMessage))
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

async function cachedCall<Input, Output>(name: string, input: Input, ttlMs: number): Promise<Output> {
  const key = readCacheKey(name, input)
  const now = Date.now()
  const cached = readCache.get(key)
  if (cached?.value !== undefined && cached.expiresAt > now) return cached.value as Output
  if (cached?.promise) return cached.promise as Promise<Output>
  const promise = call<Input, Output>(name, input, { readOnly: true })
    .then((value) => {
      readCache.set(key, { value, expiresAt: Date.now() + ttlMs })
      return value
    })
    .catch((error) => {
      readCache.delete(key)
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
  assignmentRole: 'primary' | 'secondary' | 'schedule'
  contract: null | {
    id: string
    status: string
    startDate?: string
    endDate?: string
    totalSessions: number
    usedSessions: number
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
  date: string
  hour?: number
  status: string
  scheduleStatus?: 'scheduled' | 'rescheduled' | 'cancelled'
  billingStatus?: 'pending' | 'charged' | 'exempt' | 'review_required'
  attendanceStatus?: 'pending' | 'present' | 'late' | 'no_show' | 'policy_charge'
  lateMinutes?: number | null
  noShowReason?: string
  chargedAt?: string
  confirmedAt?: string
  contractId?: string
  contractEffective?: boolean
  contract?: TrainerStudentSummary['contract']
  revision?: number
  timeZone: string
}

export interface CoachWorkspaceScope {
  schemaVersion: number
  source: 'pt_contract_assignments'
  staffId: string
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
  availabilityMode: 'configured' | 'unrestricted' | 'unconfigured'
  availabilityRevision: number
  scheduleConfig: { workingDays: string[]; workingHours: number[] }
}

export interface TrainerWorkspaceBootstrap {
  schemaVersion: number
  scope: CoachWorkspaceScope
  students: TrainerStudentSummary[]
  branches: Array<{ id: string; name: string }>
  sessions: TrainerSessionSummary[]
  requests: TrainerSessionRequestSummary[]
  hasMore: boolean
}

export interface TrainerSessionRequestSummary {
  id: string
  sessionId: string
  studentId: string
  contractId: string
  type: 'cancel' | 'reschedule'
  status: 'pending' | 'approved' | 'rejected'
  originalDate: string
  originalHour?: number
  newDate?: string | null
  newHour?: number | null
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
}

export interface SalesCatalog {
  branches: Array<{ id: string; name: string }>
  packages: Array<{ id: string; name: string; price: number; branchId: string }>
}

export async function listMyAssignedStudents(limit = 100) {
  return cachedCall<{ limit: number }, { students: TrainerStudentSummary[]; hasMore: boolean }>('listMyAssignedStudents', { limit }, 30_000)
}

export async function listMyTrainerSchedule(from: string, to: string, limit = 300) {
  return cachedCall<{ from: string; to: string; limit: number }, { sessions: TrainerSessionSummary[]; requests: TrainerSessionRequestSummary[] }>('listMyTrainerSchedule', { from, to, limit }, 15_000)
}

export interface SalesWorkspace {
  schemaVersion: number
  quotes: SalesQuoteSummary[]
  catalog: SalesCatalog
}

export async function getMyCoachWorkspaceScope() {
  return cachedCall<Record<string, never>, CoachWorkspaceScope>('getMyCoachWorkspaceScope', {}, 90_000)
}

export async function getMyTrainerAvailability() {
  return cachedCall<Record<string, never>, TrainerAvailabilityWorkspace>('getMyTrainerAvailability', {}, 30_000)
}

export async function saveMyTrainerAvailability(input: { availableSlots: string[]; expectedRevision: number }) {
  const result = await call<typeof input, { schemaVersion: number; availableSlots: string[]; availabilityMode: 'configured'; availabilityRevision: number }>('saveMyTrainerAvailability', input)
  invalidateReadCache('getMyTrainerAvailability', 'getMyTrainerWorkspace', 'getMyCoachWorkspaceScope')
  return result
}

export async function getMyTrainerWorkspace(
  section: 'students' | 'schedule' | 'requests',
  from: string,
  to: string,
  limit = section === 'students' ? 100 : 300,
) {
  return cachedCall<
    { section: 'students' | 'schedule' | 'requests'; from: string; to: string; limit: number },
    TrainerWorkspaceBootstrap
  >('getMyTrainerWorkspace', { section, from, to, limit }, 30_000)
}

export async function confirmMySession(sessionId: string, expectedRevision: number) {
  const result = await call<{ sessionId: string; expectedRevision: number }, { unchanged: boolean; revision: number }>('confirmMySession', { sessionId, expectedRevision })
  invalidateReadCache('getMyCoachWorkspaceScope', 'getMyTrainerWorkspace', 'listMyTrainerSchedule')
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
  const result = await call<typeof input, {
    unchanged: boolean
    revision: number
    attendanceEventId: string
    attendanceStatus: SessionAttendanceStatus
  }>('recordMySessionAttendance', input)
  invalidateReadCache('getMyCoachWorkspaceScope', 'getMyTrainerWorkspace', 'listMyTrainerSchedule')
  return result
}

export async function bulkConfirmMySessions(items: Array<{ sessionId: string; expectedRevision: number }>) {
  const result = await call<
    { items: Array<{ sessionId: string; expectedRevision: number }> },
    { total: number; confirmed: number; failed: number; results: Array<{ sessionId: string; ok: boolean; revision?: number; code?: string }> }
  >('bulkConfirmMySessions', { items })
  invalidateReadCache('getMyCoachWorkspaceScope', 'getMyTrainerWorkspace', 'listMyTrainerSchedule')
  return result
}

export async function requestSessionChange(input: {
  sessionId: string
  contractId: string
  type: 'cancel' | 'reschedule'
  reason: string
  newDate?: string
  newHour?: number
}) {
  const result = await call<typeof input, { requestId: string }>('requestSessionChange', input)
  invalidateReadCache('getMyCoachWorkspaceScope', 'getMyTrainerWorkspace', 'listMyTrainerSchedule')
  return result
}

export async function listMyQuotes(limit = 100) {
  return call<{ limit: number }, { quotes: SalesQuoteSummary[] }>('listMyQuotes', { limit }, { readOnly: true })
}

export async function getMySalesCatalog() {
  return call<Record<string, never>, SalesCatalog>('getMySalesCatalog', {}, { readOnly: true })
}

export async function getMySalesWorkspace(limit = 100) {
  return cachedCall<{ limit: number }, SalesWorkspace>('getMySalesWorkspace', { limit }, 30_000)
}

export async function createQuote(input: {
  customerName: string
  customerPhone: string
  branchId: string
  packageId: string
  discount: number
}) {
  const result = await call<typeof input, { quoteId: string; code: string; finalPrice: number }>('createQuote', input)
  invalidateReadCache('getMySalesWorkspace', 'listMyQuotes')
  return result
}

export async function createStudentDraft(input: {
  displayName: string
  phoneNumber: string
  email?: string
  branchId: string
}) {
  return call<typeof input, { leadId: string }>('createStudentDraft', input)
}
