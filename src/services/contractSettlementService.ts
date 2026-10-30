import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'

export type ContractSettlementStatus = 'review_required' | 'pending_approval' | 'approved' | 'settled'

export interface ContractSettlementProposal {
  cutoffDate: string
  reason: string
  waivedFutureAmount: number
  feeAmount: number
  feeReason: string
  serviceReductionAmount: number
  serviceReductionReason: string
  writeOffAmount: number
  writeOffReason: string
  effectiveAt: string
}

export interface ContractSettlementSummary {
  status: ContractSettlementStatus
  revision: number
  settlementAmount?: number
  cutoffDate?: string
  cutoffVerificationReason?: string
  recognizedRevenueAfterAdjustments?: number
}

export interface ContractSettlementResponse {
  contractId: string
  revision: number
  status: ContractSettlementStatus
  settlement: (ContractSettlementSummary & { proposal?: ContractSettlementProposal | null }) | null
  preview: {
    originalNetValue: number
    canonicalCash: number
    paidProjection: number
    recognizedRevenue: number
    serviceRecognizedRevenue?: number
    unservedValue: number
    cutoffDate?: string
    confirmedCutoffDate?: string | null
    blockers: Array<{ code: string; message: string }>
    warnings?: Array<{ code: string; message: string }>
    snapshotHash: string
    serviceEvidenceHash?: string
    dueAmount?: number
    refundAmount?: number
  }
  permissions: { canSubmit: boolean; canApprove: boolean; canClose: boolean }
}

export interface ContractSettlementCommand {
  contractId: string
  action: 'submit' | 'approve' | 'close' | 'withdraw' | 'verify_cutoff'
  operationId: string
  expectedRevision: number
  expectedSnapshotHash: string
  proposal?: ContractSettlementProposal
  cutoffDate?: string
  reason?: string
}

export async function getContractSettlement(input: { contractId: string; cutoffDate?: string }): Promise<ContractSettlementResponse> {
  if (!firebaseFunctions) throw new Error('Dịch vụ quyết toán chưa sẵn sàng.')
  return (await httpsCallable<typeof input, ContractSettlementResponse>(firebaseFunctions, 'getContractSettlement')(input)).data
}

export async function manageContractSettlement(input: ContractSettlementCommand): Promise<ContractSettlementResponse> {
  if (!firebaseFunctions) throw new Error('Dịch vụ quyết toán chưa sẵn sàng.')
  return (await httpsCallable<typeof input, ContractSettlementResponse>(firebaseFunctions, 'manageContractSettlement')(input)).data
}

export function contractSettlementLabel(status?: ContractSettlementStatus) {
  return status === 'settled' ? 'Đã quyết toán' : status === 'approved' ? 'Đã duyệt quyết toán' : status === 'pending_approval' ? 'Chờ duyệt quyết toán' : 'Cần rà soát quyết toán'
}
