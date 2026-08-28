import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

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

export interface StudentPtSessionRequestSummary {
  id: string
  type: 'cancel' | 'reschedule'
  status: 'pending' | 'approved' | 'rejected'
  originalDate: string
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
  startDate: string
  endDate: string
  totalSessions: number
  usedSessions: number
  remainingSessions: number
  totalAmount: number
  paidAmount: number
  outstandingAmount: number
  paymentStatus: 'paid' | 'overdue' | 'due_today' | 'due_soon' | 'pending'
  nextPaymentDate: string | null
  daysUntilEnd: number | null
  installments: StudentPtInstallmentSummary[]
}

export interface StudentPtInstallmentSummary {
  id: string
  date: string
  amount: number
  status: 'pending' | 'paid' | 'cancelled'
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
  schemaVersion: number
  linked: boolean
  identityLink?: StudentPtIdentityLink
  student: null | {
    id: string
    name: string
    branchId: string
    sessionsPerWeek: number
    availableSlots: string[]
    isScheduleConfirmed: boolean
    availabilityRevision: number
    availability?: StudentPtAvailability
  }
  scheduleConfig: {
    workingDays: string[]
    workingHours: number[]
    complimentaryChangeCancelPerMonth?: 1 | 2
    sessionChangeDeadlineHours?: number
    offMaxDaysPerRequest?: number
    offRegistrationCutoffHour?: number
    offLimitsByDuration?: { threeMonths: number; sixMonths: number; twelveMonths: number }
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
  revision: number
  status: 'draft' | 'submitted' | 'locked' | 'inherited' | 'legacy_default'
  confirmed?: boolean
  locked: boolean
  cutoffAt: string
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
        source: ['weekly', 'inherited_weekly', 'legacy_default', 'none'].includes(data.student.availability.source)
          ? data.student.availability.source
          : 'none',
      } : undefined,
    } : null,
    sessions: Array.isArray(data?.sessions) ? data.sessions : [],
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

export async function listMyStudentPtSchedule(from: string, to: string, availabilityWeekId: string): Promise<StudentPtScheduleData> {
  try {
    const callable = httpsCallable<{ from: string; to: string; availabilityWeekId: string }, StudentPtScheduleData>(functionsInstance(), 'listMyStudentPtSchedule')
    return normalizeStudentPtScheduleData((await callable({ from, to, availabilityWeekId })).data)
  } catch (error) {
    throw asStudentPtScheduleError(error)
  }
}

export async function saveMyStudentAvailability(input: { weekId: string; availableSlots: string[]; expectedRevision: number; confirmBelowMinimum?: boolean }) {
  try {
    const callable = httpsCallable<typeof input, {
      schemaVersion: number
      availableSlots: string[]
      availabilityRevision: number
      isScheduleConfirmed: boolean
      availability: StudentPtAvailability
    }>(functionsInstance(), 'saveMyStudentAvailability')
    return (await callable(input)).data
  } catch (error) {
    throw asStudentPtScheduleError(error)
  }
}
