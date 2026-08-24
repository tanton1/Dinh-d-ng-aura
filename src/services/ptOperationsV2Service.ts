import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

function functionsInstance() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return firebaseFunctions
}

async function call<Input, Output>(name: string, input: Input): Promise<Output> {
  return (await httpsCallable<Input, Output>(functionsInstance(), name)(input)).data
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
  return call<{ limit: number }, { students: TrainerStudentSummary[]; hasMore: boolean }>('listMyAssignedStudents', { limit })
}

export async function listMyTrainerSchedule(from: string, to: string, limit = 300) {
  return call<{ from: string; to: string; limit: number }, { sessions: TrainerSessionSummary[]; requests: TrainerSessionRequestSummary[] }>('listMyTrainerSchedule', { from, to, limit })
}

export async function getMyCoachWorkspaceScope() {
  return call<Record<string, never>, CoachWorkspaceScope>('getMyCoachWorkspaceScope', {})
}

export async function confirmMySession(sessionId: string, expectedRevision: number) {
  return call<{ sessionId: string; expectedRevision: number }, { unchanged: boolean; revision: number }>('confirmMySession', { sessionId, expectedRevision })
}

export async function requestSessionChange(input: {
  sessionId: string
  contractId: string
  type: 'cancel' | 'reschedule'
  reason: string
  newDate?: string
  newHour?: number
}) {
  return call<typeof input, { requestId: string }>('requestSessionChange', input)
}

export async function listMyQuotes(limit = 100) {
  return call<{ limit: number }, { quotes: SalesQuoteSummary[] }>('listMyQuotes', { limit })
}

export async function getMySalesCatalog() {
  return call<Record<string, never>, SalesCatalog>('getMySalesCatalog', {})
}

export async function createQuote(input: {
  customerName: string
  customerPhone: string
  branchId: string
  packageId: string
  discount: number
}) {
  return call<typeof input, { quoteId: string; code: string; finalPrice: number }>('createQuote', input)
}

export async function createStudentDraft(input: {
  displayName: string
  phoneNumber: string
  email?: string
  branchId: string
}) {
  return call<typeof input, { leadId: string }>('createStudentDraft', input)
}
