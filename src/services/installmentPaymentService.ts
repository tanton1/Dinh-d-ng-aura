import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { vietQrPayload } from '../domain/payments/vietQr'
import type { StudentPtContractSummary, StudentPtInstallmentSummary } from './studentPtScheduleService'

export type InstallmentPaymentState = 'open' | 'submitted' | 'rejected' | 'paid' | 'unavailable'

export interface InstallmentPaymentClaim {
  status: 'submitted' | 'withdrawn' | 'rejected' | 'confirmed'
  amount: number
  note: string
  submittedAt: string | null
  rejectedReason: string
  reviewedAt: string | null
  confirmedAt: string | null
  receiptVoucherNumber: string | null
  revision: number
}

export interface InstallmentPaymentView {
  schemaVersion: 1
  state: InstallmentPaymentState
  unavailableReason: string | null
  message: string | null
  contract: { id: string; packageName: string; totalAmount: number; paidAmount: number; outstandingAmount: number }
  installment: { id: string | null; amount: number; dueDate: string | null; sequence: number | null; count: number | null; daysUntilDue: number | null } | null
  transfer: { bankName: string; bankBin: string; accountNumber: string; accountName: string; content: string; qrPayload: string } | null
  claim: InstallmentPaymentClaim | null
}

export interface InstallmentClaimRow {
  id: string
  contractId: string
  installmentId: string | null
  studentId: string
  studentName: string
  studentPhone: string
  branchId: string
  packageName: string
  amount: number
  dueDate: string | null
  sequence: number | null
  installmentCount: number | null
  transferCode: string
  cashAccountId: string | null
  note: string
  submittedAt: string | null
  revision: number
  actionable: boolean
  staleReason: string | null
  contract: {
    id: string
    studentId: string | null
    branchId: string | null
    packageName: string | null
    totalPrice: number | null
    discount: number | null
    paidAmount: number | null
    status: string | null
    installments: Array<{ id: string; date: string; amount: number; status: 'pending' | 'paid' | 'cancelled' }> | null
    nextPaymentDate: string | null
  } | null
}

export interface InstallmentClaimPage { schemaVersion: 1; total: number | null; hasMore: boolean; nextCursor: string | null; claims: InstallmentClaimRow[] }

export interface TransferProfileInput { accountId: string; enabled: boolean; bankBin: string; bankName: string; accountNumber: string; accountName: string }

export const OUTSTANDING_TARGET = 'outstanding'

function callable<Input, Output>(name: string) {
  if (!firebaseFunctions) throw new Error('Dịch vụ thanh toán chưa sẵn sàng. Hãy tải lại trang.')
  return httpsCallable<Input, Output>(firebaseFunctions, name, { timeout: 20_000 })
}

export function installmentPaymentErrorMessage(error: unknown) {
  const source = error as { code?: string; message?: string } | null
  const code = String(source?.code || '')
  if (/unauthenticated/.test(code)) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.'
  if (/unavailable|deadline-exceeded|internal/.test(code)) return 'Chưa kết nối được Aura. Hãy kiểm tra mạng và thử lại.'
  const message = String(source?.message || '').replace(/^Firebase:\s*/i, '').replace(/\s*\(functions\/[a-z-]+\)\.?$/i, '')
  return message && /[À-ỹ]/.test(message) ? message : 'Chưa thể xử lý thanh toán lúc này. Hãy thử lại.'
}

export async function getMyInstallmentPayment(contractId: string, installmentId: string | null) {
  const result = await callable<{ contractId: string; installmentId: string }, InstallmentPaymentView>('getMyInstallmentPayment')({ contractId, installmentId: installmentId || OUTSTANDING_TARGET })
  return result.data
}

export async function submitMyInstallmentPaymentClaim(input: { contractId: string; installmentId: string | null; action: 'submit' | 'withdraw'; expectedAmount?: number; note?: string }) {
  const result = await callable<typeof input, { state: InstallmentPaymentState; unchanged: boolean; claim: InstallmentPaymentClaim | null }>('submitMyInstallmentPaymentClaim')({ ...input, installmentId: input.installmentId || OUTSTANDING_TARGET })
  return result.data
}

export async function listInstallmentPaymentClaims(input: { branchId?: string; cursor?: string | null }) {
  const result = await callable<typeof input, InstallmentClaimPage>('listInstallmentPaymentClaims')(input)
  return result.data
}

export async function rejectInstallmentPaymentClaim(input: { claimId: string; reason: string; expectedRevision: number }) {
  const result = await callable<typeof input & { action: 'reject' }, { claimId: string; status: 'rejected' }>('reviewInstallmentPaymentClaim')({ ...input, action: 'reject' })
  return result.data
}

export async function configureCashAccountTransferProfile(input: TransferProfileInput) {
  const result = await callable<TransferProfileInput, { accountId: string; transferProfile: Omit<TransferProfileInput, 'accountId'> }>('configureCashAccountTransferProfile')(input)
  return result.data
}

/** `#/schedule?tab=contract&pay=<contractId>~<installmentId|outstanding>` from reminders. */
export function paymentTargetFromHash(hash: string) {
  const value = new URLSearchParams(hash.split('?')[1] ?? '').get('pay')
  if (!value) return null
  // URLSearchParams has already decoded each encoded part once.
  const [contractId = '', installmentId = ''] = value.split('~')
  if (!contractId || contractId.includes('/')) return null
  return { contractId, installmentId: installmentId && installmentId !== OUTSTANDING_TARGET ? installmentId : null }
}

function dayDistance(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
}

/** Local preview for demo mode. Never used when Firebase is configured. */
export function demoInstallmentPayment(contract: StudentPtContractSummary, installment: StudentPtInstallmentSummary | null, todayKey: string, submitted = false): InstallmentPaymentView {
  const rows = contract.installments ?? []
  const sequence = installment ? rows.findIndex((item) => item.id === installment.id) + 1 : null
  const amount = installment?.amount ?? contract.outstandingAmount
  const dueDate = installment?.date ?? contract.nextPaymentDate
  const content = 'AURA DEMO2026'
  const paid = installment?.status === 'paid'
  return {
    schemaVersion: 1,
    state: paid ? 'paid' : submitted ? 'submitted' : 'open',
    unavailableReason: null,
    message: null,
    contract: { id: contract.id, packageName: contract.packageName, totalAmount: contract.totalAmount, paidAmount: contract.paidAmount, outstandingAmount: contract.outstandingAmount },
    installment: { id: installment?.id ?? null, amount, dueDate, sequence, count: rows.length || null, daysUntilDue: dueDate ? dayDistance(todayKey, dueDate) : null },
    transfer: paid ? null : { bankName: 'Vietcombank', bankBin: '970436', accountNumber: '0123456789', accountName: 'AURA FITNESS DEMO', content, qrPayload: vietQrPayload({ bankBin: '970436', accountNumber: '0123456789', amount, content }) },
    claim: submitted ? { status: 'submitted', amount, note: '', submittedAt: new Date().toISOString(), rejectedReason: '', reviewedAt: null, confirmedAt: null, receiptVoucherNumber: null, revision: 1 } : null,
  }
}
