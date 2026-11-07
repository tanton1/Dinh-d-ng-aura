import { vietQrPayload } from '../../src/domain/payments/vietQr'

type Scenario = 'due_today' | 'overdue' | 'upcoming' | 'no_account' | 'paid' | 'rejected'
type Handler = (input: Record<string, unknown>) => unknown

const state = {
  scenario: 'due_today' as Scenario,
  claimStatus: null as null | 'submitted' | 'withdrawn' | 'rejected',
  note: '',
  submittedAt: null as string | null,
  claims: [
    {
      id: 'ipc_' + 'a'.repeat(40), contractId: 'contract-1', installmentId: 'installment-2', studentId: 'student-1', studentName: 'Nguyễn Minh Anh', studentPhone: '0901 234 567',
      branchId: 'branch-a', packageName: 'PT 1:1 · 6 tháng', amount: 4_000_000, dueDate: '2026-11-07', sequence: 2, installmentCount: 3, transferCode: 'AURA 7K3QX9M2', cashAccountId: 'bank-a',
      note: 'Chuyển từ tài khoản của mẹ, Trần Thị Hoa', submittedAt: '2026-11-07T02:14:00.000Z', revision: 1, actionable: true, staleReason: null,
      contract: { id: 'contract-1', studentId: 'student-1', branchId: 'branch-a', packageName: 'PT 1:1 · 6 tháng', totalPrice: 16_000_000, discount: 0, paidAmount: 8_000_000, status: 'active', nextPaymentDate: '2026-11-07',
        installments: [{ id: 'installment-1', date: '2026-10-07', amount: 8_000_000, status: 'paid' }, { id: 'installment-2', date: '2026-11-07', amount: 4_000_000, status: 'pending' }, { id: 'installment-3', date: '2026-12-07', amount: 4_000_000, status: 'pending' }] },
    },
    {
      id: 'ipc_' + 'b'.repeat(40), contractId: 'contract-2', installmentId: 'installment-9', studentId: 'student-2', studentName: 'Lê Hoàng Phúc', studentPhone: '',
      branchId: 'branch-a', packageName: 'PT nhóm · 3 tháng', amount: 2_500_000, dueDate: '2026-11-01', sequence: 2, installmentCount: 2, transferCode: 'AURA 3MW8TQ0R', cashAccountId: null,
      note: '', submittedAt: '2026-11-06T13:40:00.000Z', revision: 2, actionable: false, staleReason: 'Kỳ này đã được hủy khỏi lịch thanh toán.', contract: null,
    },
  ],
  calls: [] as Array<{ name: string; input: unknown }>,
}

const due: Record<Scenario, number> = { due_today: 0, overdue: -4, upcoming: 3, no_account: 1, paid: 0, rejected: -1 }

function addDays(days: number) {
  return new Date(Date.UTC(2026, 10, 7 + days, 12)).toISOString().slice(0, 10)
}

function view() {
  const amount = 4_000_000
  const content = 'AURA 7K3QX9M2'
  const paid = state.scenario === 'paid'
  const claimStatus = state.scenario === 'rejected' && !state.claimStatus ? 'rejected' : state.claimStatus
  return {
    schemaVersion: 1,
    state: paid ? 'paid' : claimStatus === 'submitted' ? 'submitted' : claimStatus === 'rejected' ? 'rejected' : 'open',
    unavailableReason: null,
    message: null,
    contract: { id: 'contract-1', packageName: 'PT 1:1 · 6 tháng', totalAmount: 16_000_000, paidAmount: paid ? 12_000_000 : 8_000_000, outstandingAmount: paid ? 4_000_000 : 8_000_000 },
    installment: { id: 'installment-2', amount, dueDate: addDays(due[state.scenario]), sequence: 2, count: 3, daysUntilDue: due[state.scenario] },
    transfer: paid || state.scenario === 'no_account' ? null : { bankName: 'Vietcombank', bankBin: '970436', accountNumber: '1023456789', accountName: 'CONG TY TNHH AURA FITNESS', content, qrPayload: vietQrPayload({ bankBin: '970436', accountNumber: '1023456789', amount, content }) },
    claim: paid ? { status: 'confirmed', amount, note: '', submittedAt: null, rejectedReason: '', reviewedAt: null, confirmedAt: new Date().toISOString(), receiptVoucherNumber: 'PT-BRANCHA-20261107-4F2A9C', revision: 1 }
      : claimStatus ? { status: claimStatus, amount, note: state.note, submittedAt: state.submittedAt, rejectedReason: claimStatus === 'rejected' ? 'Chưa thấy giao dịch trong sao kê ngày 06/11. Bạn gửi giúp ảnh biên lai qua Zalo Aura.' : '', reviewedAt: null, confirmedAt: null, receiptVoucherNumber: null, revision: 1 }
        : null,
  }
}

const handlers: Record<string, Handler> = {
  getMyInstallmentPayment: () => view(),
  submitMyInstallmentPaymentClaim: (input) => {
    if (input.action === 'withdraw') { state.claimStatus = 'withdrawn'; return { state: 'open', unchanged: false, claim: { ...view().claim, status: 'withdrawn' } } }
    state.claimStatus = 'submitted'
    state.note = String(input.note || '')
    state.submittedAt = new Date().toISOString()
    return { state: 'submitted', unchanged: false, claim: view().claim }
  },
  listInstallmentPaymentClaims: () => ({ schemaVersion: 1, total: state.claims.length, hasMore: false, nextCursor: null, claims: state.claims }),
  reviewInstallmentPaymentClaim: (input) => {
    state.claims = state.claims.filter((claim) => claim.id !== input.claimId)
    return { claimId: input.claimId, status: 'rejected' }
  },
  configureCashAccountTransferProfile: (input) => {
    if (!/^\d{6}$/.test(String(input.bankBin))) throw Object.assign(new Error('Mã ngân hàng (BIN) phải gồm đúng 6 chữ số.'), { code: 'functions/invalid-argument' })
    return { accountId: input.accountId, transferProfile: input }
  },
}

Object.assign(window, { __payment: state })

export function httpsCallable(_functions: unknown, name: string) {
  return async (input: Record<string, unknown>) => {
    state.calls.push({ name, input })
    await new Promise((resolve) => setTimeout(resolve, 250))
    const handler = handlers[name]
    if (!handler) throw Object.assign(new Error(`Unexpected callable ${name}`), { code: 'functions/not-found' })
    return { data: handler(input) }
  }
}

export function setScenario(value: Scenario) {
  state.scenario = value
  state.claimStatus = null
}
