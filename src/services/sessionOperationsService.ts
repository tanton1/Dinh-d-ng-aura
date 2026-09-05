import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'

function call<Input, Output>(name: string, input: Input) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return httpsCallable<Input, Output>(firebaseFunctions, name)(input).then((result) => result.data)
}

export function confirmSessionAttendance(sessionId: string, expectedRevision: number) {
  return call<{ sessionId: string; expectedRevision: number }, { unchanged: boolean; revision: number }>('confirmSessionAttendance', { sessionId, expectedRevision })
}

export function cancelSession(input: { sessionId: string; expectedRevision: number; type: 'student_cancelled' | 'trainer_cancelled'; reason: string }) {
  return call<typeof input, { revision: number }>('cancelSession', input)
}

export function rescheduleSession(input: { sessionId: string; expectedRevision: number; newDate: string; newHour: number; trainerId: string }) {
  return call<typeof input, { revision: number }>('rescheduleSession', input)
}

export function swapSessions(input: { firstSessionId: string; secondSessionId: string; firstExpectedRevision: number; secondExpectedRevision: number }) {
  return call<typeof input, { firstRevision: number; secondRevision: number }>('swapSessions', input)
}

export type PtOperationsRequestStatus = 'pending' | 'approved' | 'rejected'

interface PtOperationsRequestBase {
  id: string
  kind: 'session' | 'pause'
  status: PtOperationsRequestStatus
  studentId: string
  studentName: string
  studentPhone: string
  contractId: string
  packageName: string
  reason: string
  adminNote: string
  createdAt: string | null
  processedAt: string | null
}

export interface PtSessionOperationsRequest extends PtOperationsRequestBase {
  kind: 'session'
  type: 'cancel' | 'reschedule'
  sessionId: string
  sessionRevision: number
  trainerId: string
  trainerName: string
  requestedBy: 'student' | 'trainer'
  originalDate: string
  originalHour: number | null
  newDate: string | null
  newHour: number | null
  newTrainerId: string | null
  newTrainerName: string | null
  suggestionRank: number | null
  pairsExistingSession: boolean
  policyMonth: string | null
  policySequence: number | null
  complimentaryLimit: number
  countsTowardContract: boolean
}

export interface PtPauseOperationsRequest extends PtOperationsRequestBase {
  kind: 'pause'
  type: 'off' | 'preservation'
  startDate: string
  endDate: string
  durationDays: number
  offSequence: number | null
  offLimit: number | null
  newContractEndDate: string | null
  cancelledSessionCount: number
}

export type PtOperationsRequest = PtSessionOperationsRequest | PtPauseOperationsRequest

export interface PtOperationsRequestPage {
  schemaVersion: number
  kind: 'session' | 'pause'
  summary: { total: number; pending: number; approved: number; rejected: number }
  records: PtOperationsRequest[]
  truncated: boolean
}

export function listPtOperationsRequests(kind: 'session' | 'pause') {
  return call<{ kind: 'session' | 'pause' }, PtOperationsRequestPage>('listPtOperationsRequests', { kind })
}

export function recordSessionAttendance(input: {
  sessionId: string
  expectedRevision: number
  attendanceStatus: 'present' | 'late' | 'no_show'
  lateMinutes?: 5 | 10 | 15
  noShowReason?: '' | 'busy' | 'sick' | 'forgot' | 'unreachable' | 'other'
  note?: string
}) {
  return call<typeof input, { unchanged: boolean; revision: number; attendanceEventId: string; attendanceStatus: string }>('recordSessionAttendance', input)
}

export interface TeachingShiftCorrectionItem {
  sessionId: string
  expectedRevision: number
  attendanceEventId?: string
  attendanceStatus?: 'present' | 'late' | 'no_show'
  lateMinutes?: 5 | 10 | 15
  noShowReason?: '' | 'busy' | 'sick' | 'forgot' | 'unreachable' | 'other'
}

export interface TeachingShiftCorrectionInput {
  items: TeachingShiftCorrectionItem[]
  date: string
  hour: number
  trainerId: string
  reason: string
}

export function correctTeachingShift(input: TeachingShiftCorrectionInput) {
  return call<TeachingShiftCorrectionInput, { unchanged: boolean; revisions: Record<string, number>; invalidatedPayrollPeriods: string[] }>('correctTeachingShift', input)
}

export function bulkRecordSessionAttendance(items: Array<{ sessionId: string; expectedRevision: number }>) {
  return call<
    { items: Array<{ sessionId: string; expectedRevision: number }> },
    { total: number; confirmed: number; failed: number; results: Array<{ sessionId: string; ok: boolean; revision?: number; code?: string }> }
  >('bulkRecordSessionAttendance', { items })
}

export interface CreateMySessionRequestInput {
  sessionId: string
  expectedRevision: number
  type: 'cancel' | 'reschedule'
  newDate?: string
  newHour?: number
  newTrainerId?: string
  candidateId?: string
  reason: string
  idempotencyKey: string
}

export interface SessionRequestPolicyResult {
  unchanged: boolean
  requestId: string
  status: 'pending'
  policyMonth: string
  expectedSequence: number
  expectedCountsTowardContract: boolean
  complimentaryLimit: number
  deadlineAt?: string
}

export interface SessionChangeSuggestion {
  candidateId: string
  date: string
  hour: number
  trainerId: string
  trainerName: string
  occupancy: number
  capacity: number
  pairsExistingSession: boolean
  isAssignedTrainer: boolean
  isCurrentTrainer: boolean
  employmentType: 'full_time' | 'part_time' | 'collaborator'
  dailyLoad: number
  dailyTarget: number
  createsThreeConsecutiveDays: boolean
  rank: number
}

export interface SessionChangeSuggestionPage {
  schemaVersion: number
  sessionId: string
  revision: number
  policyMonth: string
  policy: {
    complimentaryChangeCancelPerMonth: number
    sessionChangeDeadlineHours: number
    offMaxDaysPerRequest: number
    offRegistrationCutoffHour: number
    approvedChangeCancelCount: number
    complimentaryRemaining: number
  }
  suggestions: SessionChangeSuggestion[]
  issueCodes: string[]
}

export function getMySessionChangeSuggestions(sessionId: string, expectedRevision: number) {
  return call<{ sessionId: string; expectedRevision: number }, SessionChangeSuggestionPage>('getMySessionChangeSuggestions', { sessionId, expectedRevision })
}

export function createMySessionRequest(input: CreateMySessionRequestInput) {
  return call<typeof input, SessionRequestPolicyResult>('createMySessionRequest', input)
}

export function approveSessionRequest(input: { requestId: string; expectedSessionRevision: number }) {
  return call<typeof input, { unchanged: boolean; status: 'approved'; type: 'cancel' | 'reschedule'; revision: number; policyMonth: string | null; policySequence: number | null; complimentary: boolean; complimentaryLimit: number; countsTowardContract: boolean }>('approveSessionRequest', input)
}

export function rejectSessionRequest(input: { requestId: string; reason: string }) {
  return call<typeof input, { unchanged: boolean; status: 'rejected' }>('rejectSessionRequest', input)
}

export interface ContractPauseRequestInput {
  contractId: string
  type: 'off' | 'preservation'
  startDate: string
  endDate: string
  reason: string
  idempotencyKey: string
}

export interface ContractPauseRequestResult {
  unchanged: boolean
  requestId: string
  status: 'pending'
  type: 'off' | 'preservation'
  durationDays: number
  offLimit: number
  offUsedOrPending: number
  cutoffAt: string | null
}

export function createMyContractPauseRequest(input: ContractPauseRequestInput) {
  return call<typeof input, ContractPauseRequestResult>('createMyContractPauseRequest', input)
}

export function approveContractPauseRequest(requestId: string) {
  return call<{ requestId: string }, { unchanged: boolean; status: 'approved'; type: 'off' | 'preservation'; durationDays: number; newEndDate: string; cancelledSessionCount: number; offSequence?: number | null; offLimit?: number }>('approveContractPauseRequest', { requestId })
}

export function rejectContractPauseRequest(requestId: string, reason: string) {
  return call<{ requestId: string; reason: string }, { unchanged: boolean; status: 'rejected' }>('rejectContractPauseRequest', { requestId, reason })
}
