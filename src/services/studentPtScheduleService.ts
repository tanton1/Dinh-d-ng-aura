import { httpsCallable } from 'firebase/functions'
import type { WorkspaceSyncState } from '../utils/workspaceSync'
import { firebaseAuth } from '../lib/firebase'
import { firebaseFunctions, firebaseScheduleOptimizerFunctions } from '../lib/firebaseFunctions'
import { runReadOnlyWithFallback } from './readOnlyCallableService'

export type StudentPtSessionStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'canceled_by_student'
  | 'student_cancelled'
  | 'trainer_cancelled'
  | 'no_show'
  | 'rescheduled'

export type StudentPtIdentityLinkStatus = 'linked' | 'profile_not_linked'
export type StudentPtIdentityLinkSource = 'crm_profile_id' | 'auth_uid'

export interface StudentPtIdentityLink {
  status: StudentPtIdentityLinkStatus
  source: StudentPtIdentityLinkSource | null
  studentId: string | null
  crmProfileIdConfigured: boolean
}

export type StudentPtScheduleIssueCode =
  | 'AUTH_REQUIRED'
  | 'ACCESS_SYNC_REQUIRED'
  | 'ACCESS_DENIED'
  | 'STUDENT_ROLE_REQUIRED'
  | 'PROFILE_NOT_LINKED'
  | 'REVISION_CONFLICT'
  | 'AVAILABILITY_LOCKED'
  | 'AVAILABILITY_EMPTY'
  | 'MINIMUM_AVAILABILITY_REQUIRED'
  | 'SYNC_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'UNKNOWN'

export class StudentPtScheduleServiceError extends Error {
  readonly issueCode: StudentPtScheduleIssueCode
  readonly retryable: boolean
  readonly details: Record<string, unknown>

  constructor(message: string, issueCode: StudentPtScheduleIssueCode, retryable: boolean, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'StudentPtScheduleServiceError'
    this.issueCode = issueCode
    this.retryable = retryable
    this.details = details
  }
}

export interface StudentPtSession {
  id: string
  date: string
  hour: number | null
  status: StudentPtSessionStatus
  trainerId: string
  trainerName: string
  branchId: string
  verifiedByStudent: boolean
  scheduleEntryId: string
  revision: number
  timeZone: string
}

const STUDENT_PT_CANCELLED_STATUSES = new Set<StudentPtSessionStatus>([
  'cancelled',
  'canceled_by_student',
  'student_cancelled',
  'trainer_cancelled',
])

const STUDENT_PT_EVIDENCE_STATUSES = new Set<StudentPtSessionStatus>([
  'completed',
  'no_show',
])

function studentPtSessionIdentity(session: StudentPtSession) {
  const scheduleEntryId = String(session.scheduleEntryId || '').trim()
  const date = normalizedScheduleDate(session.date)
  const hour = session.hour
  if (!scheduleEntryId || !date || typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) return ''
  return `${scheduleEntryId}|${date}|${hour}`
}

function studentPtSessionPriority(session: StudentPtSession) {
  if (STUDENT_PT_EVIDENCE_STATUSES.has(session.status)) return 3
  if (STUDENT_PT_CANCELLED_STATUSES.has(session.status)) return 0
  if (session.status === 'scheduled' || session.status === 'rescheduled') return 2
  return 1
}

function preferredStudentPtSession(left: StudentPtSession, right: StudentPtSession) {
  const leftPriority = studentPtSessionPriority(left)
  const rightPriority = studentPtSessionPriority(right)
  if (leftPriority !== rightPriority) return leftPriority > rightPriority ? left : right
  const leftRevision = Number(left.revision || 0)
  const rightRevision = Number(right.revision || 0)
  if (leftRevision !== rightRevision) return leftRevision > rightRevision ? left : right
  return String(left.id || '').localeCompare(String(right.id || '')) <= 0 ? left : right
}

/**
 * A published PT slot can be returned twice while a legacy row and its
 * branch-scoped mirror are both present in Firestore. The backend normally
 * reconciles these rows, but this final client guard prevents a stale callable
 * response from rendering the cancelled mirror beside the charged no-show.
 */
export function canonicalStudentPtSessions(sessions: StudentPtSession[]) {
  const grouped = new Map<string, StudentPtSession>()
  const ungrouped: StudentPtSession[] = []
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const key = studentPtSessionIdentity(session)
    if (!key) {
      ungrouped.push(session)
      continue
    }
    const current = grouped.get(key)
    grouped.set(key, current ? preferredStudentPtSession(current, session) : session)
  }
  return [...ungrouped, ...grouped.values()]
}

export interface StudentPtSessionRequestSummary {
  id: string
  type: 'cancel' | 'reschedule' | 'additional'
  status: 'pending' | 'approved' | 'rejected'
  originalDate: string | null
  originalHour?: number
  newDate?: string | null
  newHour?: number | null
  reason: string
  requestedBy?: 'student' | 'trainer'
  policySequence?: number
  expectedPolicySequence?: number
  countsTowardContract?: boolean
  expectedCountsTowardContract?: boolean
  submittedAtIso?: string
  createdAt?: string
}

export interface StudentPtPauseRequestSummary {
  id: string
  type?: 'off' | 'preservation'
  status: 'pending' | 'approved' | 'rejected'
  startDate: string
  endDate: string
  durationDays?: number
  reason: string
  newContractEndDate?: string
  submittedAtIso?: string
  createdAt?: string
}

export interface StudentPtContractSummary {
  id: string
  packageName: string
  status: string
  storedStatus?: string
  startDate: string
  endDate: string
  totalSessions: number
  usedSessions: number
  remainingSessions: number
  sourceVersion?: 'contract-usage-v3-daily' | 'contract-usage-v2' | string
  totalAmount: number
  paidAmount: number
  outstandingAmount: number
  paymentStatus: 'paid' | 'overdue' | 'due_today' | 'due_soon' | 'pending'
  nextPaymentDate: string | null
  daysUntilEnd: number | null
  /** True only when the contract is active, in-date, has quota and is not in preservation today. */
  schedulableToday?: boolean
  pausedToday?: boolean
  pausePeriods?: Array<{ type?: string; startDate: string; endDate: string }>
  installments: StudentPtInstallmentSummary[]
}

export interface StudentPtInstallmentSummary {
  id: string
  date: string
  amount: number
  status: 'pending' | 'paid' | 'cancelled'
}

function normalizedScheduleDate(value: unknown) {
  if (typeof value !== 'string') return ''
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

export function isStudentPtContractSchedulableOn(
  contract: StudentPtContractSummary,
  date: string,
  allowedStatuses: string[] = ['active'],
) {
  const dateKey = normalizedScheduleDate(date)
  const startDate = normalizedScheduleDate(contract.startDate)
  const endDate = normalizedScheduleDate(contract.endDate)
  const storedStatus = String(contract.status || '').toLowerCase()
  const terminalStatus = ['cancelled', 'inactive', 'archived', 'draft'].includes(storedStatus)
  if (!dateKey || !startDate || !endDate || terminalStatus || (storedStatus === 'frozen' && !allowedStatuses.includes('frozen'))) return false
  if (dateKey < startDate || dateKey > endDate || Number(contract.remainingSessions || 0) <= 0) return false
  return !(contract.pausePeriods || []).some((period) => {
    const pauseStart = normalizedScheduleDate(period.startDate)
    const pauseEnd = normalizedScheduleDate(period.endDate)
    return Boolean(pauseStart && pauseEnd && pauseStart <= dateKey && pauseEnd >= dateKey)
  })
}

export function studentPtContractHasSchedulableDate(
  contract: StudentPtContractSummary,
  from: string,
  to: string,
  allowedStatuses: string[] = ['active'],
) {
  const fromKey = normalizedScheduleDate(from)
  const toKey = normalizedScheduleDate(to)
  if (!fromKey || !toKey || fromKey > toKey) return false
  const cursor = new Date(`${fromKey}T12:00:00`)
  const end = new Date(`${toKey}T12:00:00`)
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return false
  for (let checked = 0; cursor <= end && checked < 367; checked += 1) {
    const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    if (isStudentPtContractSchedulableOn(contract, date, allowedStatuses)) return true
    cursor.setDate(cursor.getDate() + 1)
  }
  return false
}

export interface StudentPtContractAlert {
  code: 'PAYMENT_OVERDUE' | 'PAYMENT_DUE_TODAY' | 'PAYMENT_DUE_SOON' | 'CONTRACT_EXPIRING' | 'CONTRACT_SESSIONS_LOW' | 'RENEWAL_READY'
  severity: 'critical' | 'warning' | 'info'
  contractId: string
  title: string
  message: string
  dueDate: string | null
  amount: number | null
}

export interface StudentPtScheduleData {
  syncState?: WorkspaceSyncState
  schemaVersion: number
  linked: boolean
  identityLink?: StudentPtIdentityLink
  student: null | {
    id: string
    name: string
    branchId: string
    sessionsPerWeek: number
    /** Contract default before a learner chooses a weekly target. */
    defaultSessionsPerWeek?: number
    availableSlots: string[]
    isScheduleConfirmed: boolean
    availabilityRevision: number
    availability?: StudentPtAvailability
  }
  scheduleConfig: {
    workingDays: string[]
    workingHours: number[]
    complimentaryChangeCancelPerMonth?: number
    sessionChangeDeadlineHours?: number
    offMaxDaysPerRequest?: number
    offRegistrationCutoffHour?: number
    availabilityRegistrationCutoffDayOfWeek?: number
    availabilityRegistrationCutoffHour?: number
    offLimitsByDuration?: { threeMonths: number; sixMonths: number; twelveMonths: number }
    policyVersion?: string
    policyEffectiveFrom?: string
    policyHash?: string
  }
  sessions: StudentPtSession[]
  sessionsTruncated?: boolean
  contracts: StudentPtContractSummary[]
  contractAlerts: StudentPtContractAlert[]
  sessionRequests: StudentPtSessionRequestSummary[]
  pauseRequests: StudentPtPauseRequestSummary[]
}

export interface StudentPtAvailability {
  weekId: string
  slots: string[]
  minimumSlots: number
  requiredSessions: number
  /** null means the learner follows the contract default. */
  requestedSessions?: number | null
  revision: number
  status: 'draft' | 'submitted' | 'locked' | 'inherited' | 'legacy_default'
  confirmed?: boolean
  locked: boolean
  cutoffAt: string
  reopenedUntil?: string | null
  submittedAt: string | null
  source: 'weekly' | 'inherited_weekly' | 'legacy_default' | 'none'
  sourceWeekId?: string | null
  sourceRevision?: number
}

export function normalizeStudentPtScheduleData(data: StudentPtScheduleData): StudentPtScheduleData {
  const scheduleConfig = data?.scheduleConfig ?? { workingDays: [], workingHours: [] }
  return {
    ...data,
    scheduleConfig: {
      ...scheduleConfig,
      workingDays: Array.isArray(scheduleConfig.workingDays) ? scheduleConfig.workingDays : [],
      workingHours: Array.isArray(scheduleConfig.workingHours) ? scheduleConfig.workingHours : [],
    },
    student: data?.student ? {
      ...data.student,
      availableSlots: Array.isArray(data.student.availableSlots) ? data.student.availableSlots : [],
      availability: data.student.availability ? {
        ...data.student.availability,
        slots: Array.isArray(data.student.availability.slots) ? data.student.availability.slots : [],
        requestedSessions: Number.isInteger(data.student.availability.requestedSessions)
          && Number(data.student.availability.requestedSessions) >= 1
          && Number(data.student.availability.requestedSessions) <= 7
          ? Number(data.student.availability.requestedSessions)
          : null,
        source: ['weekly', 'inherited_weekly', 'legacy_default', 'none'].includes(data.student.availability.source)
          ? data.student.availability.source
          : 'none',
      } : undefined,
    } : null,
    // The callable already excludes cancelled rows. Keep the client guard so
    // an older function instance or a stale cached response cannot render an
    // appointment that has just been cancelled or replaced.
    sessions: canonicalStudentPtSessions(Array.isArray(data?.sessions) ? data.sessions : [])
      .filter((session) => !STUDENT_PT_CANCELLED_STATUSES.has(session.status)),
    contracts: Array.isArray(data?.contracts)
      ? data.contracts.filter(Boolean).map((contract) => ({
          ...contract,
          installments: Array.isArray(contract.installments) ? contract.installments.filter(Boolean) : [],
        }))
      : [],
    contractAlerts: Array.isArray(data?.contractAlerts) ? data.contractAlerts : [],
    sessionRequests: Array.isArray(data?.sessionRequests) ? data.sessionRequests : [],
    pauseRequests: Array.isArray(data?.pauseRequests) ? data.pauseRequests : [],
  }
}

function functionsInstance() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return firebaseFunctions
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function normalizedFunctionsCode(value: unknown) {
  return typeof value === 'string' ? value.replace(/^functions\//, '') : ''
}

function knownIssueCode(value: unknown): StudentPtScheduleIssueCode | null {
  const issueCode = typeof value === 'string' ? value : ''
  return [
    'AUTH_REQUIRED',
    'ACCESS_SYNC_REQUIRED',
    'ACCESS_DENIED',
    'STUDENT_ROLE_REQUIRED',
    'PROFILE_NOT_LINKED',
    'REVISION_CONFLICT',
    'AVAILABILITY_LOCKED',
    'AVAILABILITY_EMPTY',
    'MINIMUM_AVAILABILITY_REQUIRED',
    'SYNC_UNAVAILABLE',
    'INVALID_REQUEST',
    'UNKNOWN',
  ].includes(issueCode) ? issueCode as StudentPtScheduleIssueCode : null
}

export function asStudentPtScheduleError(error: unknown): StudentPtScheduleServiceError {
  if (error instanceof StudentPtScheduleServiceError) return error
  const source = recordValue(error)
  const details = recordValue(source.details)
  const code = normalizedFunctionsCode(source.code)
  const message = typeof source.message === 'string' && source.message.trim()
    ? source.message.trim()
    : 'Chưa thể đồng bộ lịch học viên.'
  const detailIssue = knownIssueCode(details.issueCode)
  if (detailIssue) {
    return new StudentPtScheduleServiceError(message, detailIssue, ['REVISION_CONFLICT', 'SYNC_UNAVAILABLE'].includes(detailIssue), details)
  }
  if (code === 'unauthenticated') return new StudentPtScheduleServiceError(message, 'AUTH_REQUIRED', false, details)
  if (code === 'not-found') return new StudentPtScheduleServiceError(message, 'PROFILE_NOT_LINKED', false, details)
  if (code === 'aborted') return new StudentPtScheduleServiceError(message, 'REVISION_CONFLICT', true, details)
  if (code === 'permission-denied') {
    const syncRequired = message.toLocaleLowerCase('vi').includes('chưa đồng bộ')
    return new StudentPtScheduleServiceError(message, syncRequired ? 'ACCESS_SYNC_REQUIRED' : 'ACCESS_DENIED', false, details)
  }
  if (['unavailable', 'deadline-exceeded', 'internal', 'resource-exhausted'].includes(code)) {
    return new StudentPtScheduleServiceError(message, 'SYNC_UNAVAILABLE', true, details)
  }
  if (code === 'invalid-argument' || code === 'failed-precondition') {
    return new StudentPtScheduleServiceError(message, 'INVALID_REQUEST', false, details)
  }
  return new StudentPtScheduleServiceError(message, 'UNKNOWN', true, details)
}

export async function listMyStudentPtSchedule(from: string, to: string, availabilityWeekId: string, options: { surface?: 'availability' } = {}): Promise<StudentPtScheduleData> {
  const accountUid = firebaseAuth?.currentUser?.uid
  try {
    const input = { from, to, availabilityWeekId, ...options }
    const invoke = (client: typeof firebaseFunctions, name: string) => {
      const callable = httpsCallable<typeof input, StudentPtScheduleData>(client || functionsInstance(), name, { timeout: 18_000 })
      return callable(input).then((result) => result.data)
    }
    const result = firebaseScheduleOptimizerFunctions
      ? await runReadOnlyWithFallback(
        () => invoke(firebaseScheduleOptimizerFunctions, 'listMyStudentPtScheduleRegional'),
        () => invoke(firebaseFunctions, 'listMyStudentPtSchedule'),
      )
      : await invoke(firebaseFunctions, 'listMyStudentPtSchedule')
    if (accountUid !== firebaseAuth?.currentUser?.uid) throw Object.assign(new Error('Phiên đăng nhập đã thay đổi.'), { code: 'functions/unauthenticated' })
    return normalizeStudentPtScheduleData(result)
  } catch (error) {
    throw asStudentPtScheduleError(error)
  }
}

export async function saveMyStudentAvailability(input: { weekId: string; availableSlots: string[]; expectedRevision: number; confirmBelowMinimum?: boolean; requestedSessions?: number | null }) {
  try {
    const regionalFunctions = firebaseScheduleOptimizerFunctions
    const callable = httpsCallable<typeof input, {
      schemaVersion: number
      availableSlots: string[]
      defaultSessionsPerWeek?: number
      availabilityRevision: number
      isScheduleConfirmed: boolean
      availability: StudentPtAvailability
    }>(regionalFunctions || functionsInstance(), regionalFunctions ? 'saveMyStudentAvailabilityRegional' : 'saveMyStudentAvailability', { timeout: 30_000 })
    return (await callable(input)).data
  } catch (error) {
    throw asStudentPtScheduleError(error)
  }
}
