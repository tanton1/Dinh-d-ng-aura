import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

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
  deadlineAt?: string
}

export function createMySessionRequest(input: CreateMySessionRequestInput) {
  return call<typeof input, SessionRequestPolicyResult>('createMySessionRequest', input)
}

export function approveSessionRequest(input: { requestId: string; expectedSessionRevision: number }) {
  return call<typeof input, { unchanged: boolean; status: 'approved'; type: 'cancel' | 'reschedule'; revision: number; policyMonth: string | null; policySequence: number | null; complimentary: boolean; countsTowardContract: boolean }>('approveSessionRequest', input)
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
