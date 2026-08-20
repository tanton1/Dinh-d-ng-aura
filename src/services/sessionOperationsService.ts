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

export function approveSessionRequest(input: { requestId: string; expectedSessionRevision: number; extensionDays?: number }) {
  return call<typeof input, { unchanged: boolean; status: 'approved'; type: 'cancel' | 'reschedule'; revision: number }>('approveSessionRequest', input)
}

export function rejectSessionRequest(input: { requestId: string; reason: string }) {
  return call<typeof input, { unchanged: boolean; status: 'rejected' }>('rejectSessionRequest', input)
}
