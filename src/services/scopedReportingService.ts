import type { AdminUserRecord, CourseAnalytics, Enrollment, Student, StudentContract } from '../types'
import { callReadOnlyFunction } from './readOnlyCallableService'
import { firebaseBusinessReportingFunctions } from '../lib/firebaseFunctions'

const reportingReadOptions = { functionsClient: firebaseBusinessReportingFunctions, maximumAttempts: 2, timeoutMs: 180_000 }

export interface AcademyAnalyticsSummary {
  complete: boolean
  reason?: string
  courses: CourseAnalytics[]
  asOf: string
  sourceDocuments: number
}
export interface AcademyEnrollmentsPage {
  enrollments: Enrollment[]
  users: AdminUserRecord[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
}
export type ReceivableCategory = 'all' | 'installments' | 'frozen' | 'debt'
export type ReceivableFilter = 'all' | 'owing' | 'settled' | 'overdue' | 'this-week' | 'this-month' | 'overpaid'
export interface ReceivablesSummary {
  complete: boolean
  reason?: string
  totals: { debt: number; overdue: number; thisMonth: number } | null
  counts: Record<ReceivableFilter, number> | null
  asOf: string
  sourceDocuments: number
}
export interface ReceivablesPage {
  contracts: Array<StudentContract & { dataIssue?: string | null }>
  students: Array<Pick<Student, 'id' | 'name' | 'phone' | 'email'>>
  summary: ReceivablesSummary | null
  nextCursor: string | null
  hasMore: boolean
  asOf: string
  scanned: number
}
export function getAcademyAnalyticsSummary(refresh = false) {
  return callReadOnlyFunction<{ refresh: boolean }, AcademyAnalyticsSummary>('getAcademyAnalyticsSummary', { refresh }, reportingReadOptions)
}
export function listAcademyEnrollmentsPage(cursor: string | null = null) {
  return callReadOnlyFunction<{ cursor: string | null; pageSize: number }, AcademyEnrollmentsPage>('listAcademyEnrollmentsPage', { cursor, pageSize: 50 }, reportingReadOptions)
}
export interface ReceivablesQuery { branchId: string; today: string; category?: ReceivableCategory; filter: ReceivableFilter; search: string; cursor?: string | null; includeSummary?: boolean; refresh?: boolean; pageSize?: number }
export function listFinanceReceivables(input: ReceivablesQuery) {
  return callReadOnlyFunction<ReceivablesQuery, ReceivablesPage>('listFinanceReceivables', { ...input, pageSize: input.pageSize ?? 20 }, reportingReadOptions)
}
export async function listFinanceStudentLabels(studentIds: string[]): Promise<ReceivablesPage['students']> {
  const response = await callReadOnlyFunction<{ studentIds: string[] }, { students: ReceivablesPage['students'] }>('listFinanceStudentLabels', { studentIds }, reportingReadOptions)
  return response.students
}
