import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { callReadOnlyFunction } from './readOnlyCallableService'

export type RenewalRiskCategory = 'expired' | 'exhausted' | 'critical' | 'upcoming' | 'early'
export type RenewalStage = 'uncontacted' | 'contacted' | 'interested' | 'quote_sent' | 'follow_up' | 'won' | 'lost'
export type RenewalSlaStatus = 'overdue' | 'due_today' | 'upcoming' | 'done'
export type RenewalSegment = 'expiring_30d' | 'exhausted_active' | 'expired_last_30d' | 'in_care'
export type RenewalScope = 'self' | 'branch' | 'system'
export type RenewalAudience = 'trainer' | 'sales' | 'operations'
export type RenewalActivityType = 'call' | 'zalo' | 'meeting' | 'note' | 'stage_change'
export type RenewalActivityOutcome = 'connected' | 'no_answer' | 'interested' | 'not_interested' | 'quote_requested' | 'other'

export interface RenewalMessageTemplate {
  id: string
  name: string
  channel: 'zalo'
  category: 'first_contact' | 'win_back' | 'follow_up' | 'quote' | 'appointment' | 'success' | 'feedback'
  recommendedSegments: RenewalSegment[]
  recommendedStages: RenewalStage[]
  body: string
}

export interface RenewalPipelineRow {
  id: string
  caseId: string
  schemaVersion: 2
  sourceContractId: string
  student: { id: string; name: string; phone: string; email: string }
  contract: {
    id: string
    packageId: string
    packageName: string
    startDate: string
    endDate: string
    status: 'active' | 'future' | 'frozen' | 'expired'
    totalSessions: number
    usedSessions: number
    totalPrice: number
    paidAmount: number
    discount: number
    branchId: string
    trainerId: string
    trainerIds: string[]
    nutritionPTIds: string[]
    revision: number
  }
  branchId: string
  branchName: string
  assignedSalesId: string
  assignedSalesName: string
  stage: RenewalStage
  probability: number
  risk: { category: RenewalRiskCategory; daysLeft: number; sessionsLeft: number }
  expectedValue: number
  priorityScore: number
  slaDueAt: string | null
  slaStatus: RenewalSlaStatus
  nextActionAt: string | null
  nextFollowUpAt: string | null
  lastContactAt: string | null
  note: string
  quoteId: string | null
  approvalId: string | null
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'consumed' | null
  renewedContractId: string | null
  lostReason: string | null
  revision: number
  caseRevision: number
  active: boolean
}

export interface RenewalPackageOption {
  id: string
  name: string
  price: number
  totalSessions: number
  durationMonths: number
  branchId: string
}

export interface RenewalBranchOption { id: string; name: string }
export interface RenewalCashAccountOption { id: string; name: string; type: string; branchId: string }
export interface RenewalAssigneeOption { id: string; name: string; branchIds: string[] }

export interface RenewalStats {
  total: number
  pipelineValue: number
  weightedPipelineValue: number
  pendingApprovals: number
  stageCounts: Record<RenewalStage, number>
  riskCounts: Record<RenewalRiskCategory, number>
  slaCounts: Record<RenewalSlaStatus, number>
  segmentCounts: Record<RenewalSegment, number>
}

export interface RenewalPipelineResponse {
  schemaVersion: 2
  generatedAt: string
  today: string
  rows: RenewalPipelineRow[]
  hasMore: boolean
  nextCursor: string | null
  stats: RenewalStats
  options: {
    packages: RenewalPackageOption[]
    branches: RenewalBranchOption[]
    cashAccounts: RenewalCashAccountOption[]
    assignees: RenewalAssigneeOption[]
  }
  packages: RenewalPackageOption[]
  scope: RenewalScope
  audience: RenewalAudience
  permissions: {
    canRecordActivity: boolean
    canCreateQuote: boolean
    canRenewContract: boolean
    canViewFinancials: boolean
    canViewAnalytics: boolean
    canAssign: boolean
    canApprove: boolean
  }
  actorUid: string
  truncated: boolean
}

export interface RenewalCaseDetail {
  case: RenewalPipelineRow
  contractHistory: Array<Record<string, unknown> & { id: string }>
  activities: Array<Record<string, unknown> & {
    id: string
    type?: string
    outcome?: string
    note?: string
    afterStage?: RenewalStage
    createdAt?: string | null
    actorUid?: string
  }>
  upcomingSessions: Array<{ id: string; date: string; hour: number; trainerId: string; status: string }>
  quote: (Record<string, unknown> & {
    id: string
    code?: string
    status?: string
    packageId?: string
    originalPrice?: number
    discount?: number
    finalPrice?: number
    carryOverSessions?: number
    requiresApproval?: boolean
  }) | null
  approval: (Record<string, unknown> & {
    id: string
    status?: string
    reason?: string
    submittedBy?: string
    note?: string
  }) | null
}

export interface RenewalAnalytics {
  from: string
  to: string
  conversionRate: number
  wonCases: number
  lostCases: number
  wonValue: number
  collectedValue: number
  weightedPipelineValue: number
  overdueCases: number
  stageCounts: Record<RenewalStage, number>
  lostReasons: Record<string, number>
  assignees: Array<{ id: string; name: string; total: number; won: number; value: number }>
  truncated: boolean
}

export interface RenewalListInput {
  pageSize?: number
  cursor?: string | null
  search?: string
  branchId?: string
  assignedSalesId?: string
  stage?: RenewalStage | 'all'
  risk?: RenewalRiskCategory | 'all'
  sla?: RenewalSlaStatus | 'all'
  approval?: 'all' | 'pending' | 'approved' | 'rejected' | 'consumed' | 'none'
  segment?: RenewalSegment | 'all'
  sort?: 'priority' | 'value' | 'follow_up'
}

function callable<Input, Output>(name: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  const invoke = httpsCallable<Input, Output>(firebaseFunctions, name)
  return async (input: Input) => {
    try {
      return await invoke(input)
    } catch (cause) {
      const error = cause && typeof cause === 'object' ? cause as { code?: unknown; message?: unknown } : {}
      const code = typeof error.code === 'string' ? error.code.replace(/^functions\//, '') : ''
      const message = typeof error.message === 'string' ? error.message.trim() : ''
      if (['internal', 'resource-exhausted', 'unavailable', 'deadline-exceeded'].includes(code)) {
        throw new Error('Dịch vụ tái ký đang bận. Aura chưa thay đổi dữ liệu; vui lòng thử lại sau ít phút.')
      }
      if (code === 'unauthenticated') throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
      throw new Error(message || 'Không thể xử lý nghiệp vụ tái ký.')
    }
  }
}

export async function listContractRenewalCases(input: RenewalListInput = {}) {
  return callReadOnlyFunction<RenewalListInput, RenewalPipelineResponse>('listContractRenewalCases', input)
}

export async function listContractRenewalPipeline() {
  return listContractRenewalCases({ pageSize: 50 })
}

export async function getContractRenewalCaseDetail(caseId: string) {
  return callReadOnlyFunction<{ caseId: string }, RenewalCaseDetail>('getContractRenewalCaseDetail', { caseId })
}

export async function recordContractRenewalActivity(input: {
  caseId: string
  expectedRevision: number
  type: RenewalActivityType
  outcome: RenewalActivityOutcome
  stage?: RenewalStage
  nextActionAt?: string | null
  note?: string
  lostReason?: string
}) {
  return (await callable<typeof input, { caseId: string; activityId: string; revision: number }>('recordContractRenewalActivity')(input)).data
}

export async function updateContractRenewalCase(input: {
  sourceContractId: string
  stage: RenewalStage
  expectedRevision: number
  nextFollowUpAt?: string | null
  note?: string
}) {
  return (await callable<typeof input, { sourceContractId: string; stage: RenewalStage; revision: number }>('updateContractRenewalCase')(input)).data
}

export async function assignContractRenewalCase(input: { caseId: string; assignedSalesId: string; expectedRevision: number }) {
  return (await callable<typeof input, { caseId: string; assignedSalesId: string; revision: number }>('assignContractRenewalCase')(input)).data
}

export async function transferRenewalCases(input: {
  cases: Array<{ caseId: string; expectedRevision: number }>
  assignedSalesId: string
  reason: string
  nextActionAt?: string | null
}) {
  return (await callable<typeof input, { assignedSalesId: string; transferred: number }>('transferRenewalCases')(input)).data
}

export async function listRenewalMessageTemplates() {
  return callReadOnlyFunction<Record<string, never>, { schemaVersion: 1; templates: RenewalMessageTemplate[] }>('listRenewalMessageTemplates', {})
}

export async function createRenewalQuote(input: {
  caseId: string
  packageId: string
  expectedRevision: number
  discount: number
  carryOverSessions: number
}) {
  return (await callable<typeof input, { quoteId: string; revision: number }>('createRenewalQuote')(input)).data
}

export async function submitRenewalApproval(input: { caseId: string; quoteId: string; expectedRevision: number; reason: string }) {
  return (await callable<typeof input, { approvalId: string; status: 'pending'; revision: number }>('submitRenewalApproval')(input)).data
}

export async function decideRenewalApproval(input: { approvalId: string; decision: 'approved' | 'rejected'; note?: string }) {
  return (await callable<typeof input, { approvalId: string; status: 'approved' | 'rejected' }>('decideRenewalApproval')(input)).data
}

export async function renewPtContract(input: {
  caseId: string
  sourceContractId: string
  packageId: string
  quoteId?: string
  approvalId?: string
  startDate: string
  expectedSourceRevision: number
  expectedCaseRevision: number
  idempotencyKey: string
  carryOver: boolean
  discount: number
  initialPayment: number
  paymentMethod?: string
  cashAccountId?: string
  installments: Array<{ id: string; date: string; amount: number }>
  trainerIds: string[]
  nutritionPTIds: string[]
  note?: string
}) {
  return (await callable<typeof input, { contractId: string; paymentEntryId: string | null; unchanged: boolean }>('renewPtContract')(input)).data
}

export async function listRenewalCalendar(input: { from: string; to: string }) {
  return callReadOnlyFunction<typeof input, { from: string; to: string; items: RenewalPipelineRow[]; truncated: boolean }>('listRenewalCalendar', input)
}

export async function getRenewalAnalytics(input: { from: string; to: string }) {
  return callReadOnlyFunction<typeof input, RenewalAnalytics>('getRenewalAnalytics', input)
}

export async function refreshContractRenewalQueue(apply: boolean) {
  return (await callable<{ apply: boolean }, {
    dryRun: boolean
    eligibleCases: number
    plannedWrites: number
    creates: number
    updates: number
    contractsScanned: number
    truncated: boolean
  }>('refreshContractRenewalQueue')({ apply })).data
}
