import { httpsCallable } from 'firebase/functions'
import { firebaseAuth, firebaseFunctions } from '../lib/firebase'
import { reportClientIssue } from './clientTelemetryService'

function functionsInstance() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return firebaseFunctions
}

function callableErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return ''
  return typeof error.code === 'string' ? error.code : ''
}

function retryDelay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function call<Input, Output>(name: string, input: Input): Promise<Output> {
  const invoke = httpsCallable<Input, Output>(functionsInstance(), name)
  const retryableCodes = new Set([
    'functions/internal',
    'functions/resource-exhausted',
    'functions/unavailable',
    'functions/deadline-exceeded',
  ])
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return (await invoke(input)).data
    } catch (error) {
      const code = callableErrorCode(error)
      reportClientIssue('firestore', error, {
        phase: `staff_callable_${name}`,
        route: window.location.hash,
        retryable: retryableCodes.has(code),
      })
      if (!retryableCodes.has(code) || attempt === 2) {
        if (retryableCodes.has(code)) {
          if (code === 'functions/resource-exhausted') {
            throw new Error('Không gian Staff đang có nhiều lượt truy cập. Aura đã thử lại nhưng chưa có phiên xử lý trống.')
          }
          if (code === 'functions/deadline-exceeded') {
            throw new Error('Dữ liệu Staff phản hồi quá thời gian. Hãy thử tải lại trang.')
          }
          if (code === 'functions/unavailable') {
            throw new Error('Kết nối tới dịch vụ Staff tạm gián đoạn. Hãy kiểm tra mạng và thử lại.')
          }
          throw new Error('Dịch vụ Staff gặp lỗi máy chủ. Mã lỗi đã được gửi để Aura đối soát.')
        }
        throw error
      }
      await retryDelay(350 * (2 ** attempt))
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
  const promise = call<Input, Output>(name, input)
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
  assignmentRole: 'primary' | 'secondary'
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
  date: string
  hour?: number
  status: string
  contractId?: string
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

export interface TrainerWorkspaceBootstrap {
  schemaVersion: number
  scope: CoachWorkspaceScope
  students: TrainerStudentSummary[]
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
  return call<{ limit: number }, { quotes: SalesQuoteSummary[] }>('listMyQuotes', { limit })
}

export async function getMySalesCatalog() {
  return call<Record<string, never>, SalesCatalog>('getMySalesCatalog', {})
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
