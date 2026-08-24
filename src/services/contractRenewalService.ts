import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

export type RenewalRiskCategory = 'expired' | 'exhausted' | 'critical' | 'upcoming' | 'early'
export type RenewalStage = 'uncontacted' | 'contacted' | 'interested' | 'quote_sent' | 'follow_up' | 'won' | 'lost'

export interface RenewalPipelineRow {
  caseId: string
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
  branchName: string
  risk: { category: RenewalRiskCategory; daysLeft: number; sessionsLeft: number }
  expectedValue: number
  stage: RenewalStage
  caseRevision: number
  nextFollowUpAt: string | null
  lastContactAt: string | null
  note: string
  renewedContractId: string | null
}

export interface RenewalPackageOption {
  id: string
  name: string
  price: number
  totalSessions: number
  durationMonths: number
  branchId: string
}

export interface RenewalPipelineResponse {
  schemaVersion: 1
  generatedAt: string
  today: string
  rows: RenewalPipelineRow[]
  packages: RenewalPackageOption[]
  stats: {
    total: number
    pipelineValue: number
    stageCounts: Record<RenewalStage, number>
    riskCounts: Record<RenewalRiskCategory, number>
  }
  truncated: boolean
}

function callable<Input, Output>(name: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return httpsCallable<Input, Output>(firebaseFunctions, name)
}

export async function listContractRenewalPipeline() {
  return (await callable<Record<string, never>, RenewalPipelineResponse>('listContractRenewalPipeline')({})).data
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

export async function renewPtContract(input: {
  sourceContractId: string
  packageId: string
  startDate: string
  expectedSourceRevision: number
  idempotencyKey: string
  carryOver: boolean
  discount: number
  initialPayment: number
  paymentMethod?: string
  installments: Array<{ id: string; date: string; amount: number }>
  trainerIds: string[]
  nutritionPTIds: string[]
  note?: string
}) {
  return (await callable<typeof input, { contractId: string; paymentEntryId: string | null; unchanged: boolean }>('renewPtContract')(input)).data
}
