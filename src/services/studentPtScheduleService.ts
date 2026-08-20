import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

export type StudentPtSessionStatus = 'scheduled' | 'completed' | 'cancelled' | 'canceled_by_student'

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

export interface StudentPtContractSummary {
  id: string
  packageName: string
  status: string
  startDate: string
  endDate: string
  totalSessions: number
  usedSessions: number
}

export interface StudentPtScheduleData {
  schemaVersion: number
  linked: boolean
  student: null | {
    id: string
    name: string
    branchId: string
    sessionsPerWeek: number
    availableSlots: string[]
    isScheduleConfirmed: boolean
    availabilityRevision: number
  }
  scheduleConfig: {
    workingDays: string[]
    workingHours: number[]
  }
  sessions: StudentPtSession[]
  contracts: StudentPtContractSummary[]
}

function functionsInstance() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return firebaseFunctions
}

export async function listMyStudentPtSchedule(from: string, to: string): Promise<StudentPtScheduleData> {
  const callable = httpsCallable<{ from: string; to: string }, StudentPtScheduleData>(functionsInstance(), 'listMyStudentPtSchedule')
  return (await callable({ from, to })).data
}

export async function saveMyStudentAvailability(input: { availableSlots: string[]; expectedRevision: number }) {
  const callable = httpsCallable<typeof input, {
    schemaVersion: number
    availableSlots: string[]
    availabilityRevision: number
    isScheduleConfirmed: boolean
  }>(functionsInstance(), 'saveMyStudentAvailability')
  return (await callable(input)).data
}
