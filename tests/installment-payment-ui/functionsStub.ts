import { vietQrPayload } from '../../src/domain/payments/vietQr'

type Scenario = 'due_today' | 'overdue' | 'upcoming' | 'no_account' | 'paid' | 'rejected'
type Handler = (input: Record<string, unknown>) => unknown

const state = {
  scenario: 'due_today' as Scenario,
  claimStatus: null as null | 'submitted' | 'withdrawn' | 'rejected',
  claimAmount: 4_000_000,
  proof: null as null | { uploadedAt: string; url: string | null },
  uploads: {} as Record<string, string>,
  note: '',
  submittedAt: null as string | null,
  claims: [
    {
      id: 'ipc_' + 'a'.repeat(40), contractId: 'contract-1', installmentId: 'installment-2', studentId: 'student-1', studentName: 'Nguyễn Minh Anh', studentPhone: '0901 234 567',
      branchId: 'branch-a', packageName: 'PT 1:1 · 6 tháng', amount: 2_500_000, installmentAmount: 4_000_000, dueDate: '2026-11-07', sequence: 2, installmentCount: 3, transferCode: '7K3QX9M2', transferContent: 'NGUYEN MINH ANH 7K3QX9M2', cashAccountId: 'bank-a',
      note: 'Chuyển từ tài khoản của mẹ, Trần Thị Hoa', submittedAt: '2026-11-07T02:14:00.000Z', revision: 1, actionable: true, staleReason: null,
      proofUrl: `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#f4f6f8"/><rect x="20" y="30" width="260" height="60" rx="8" fill="#18a058"/><text x="150" y="68" font-size="22" text-anchor="middle" fill="#fff" font-family="sans-serif">Chuyển tiền thành công</text><text x="150" y="150" font-size="30" text-anchor="middle" font-family="sans-serif">2.500.000 VND</text><text x="150" y="200" font-size="15" text-anchor="middle" font-family="sans-serif">NGUYEN MINH ANH 7K3QX9M2</text></svg>')}`,
      proofUploadedAt: '2026-11-07T02:15:00.000Z',
      contract: { id: 'contract-1', studentId: 'student-1', branchId: 'branch-a', packageName: 'PT 1:1 · 6 tháng', totalPrice: 16_000_000, discount: 0, paidAmount: 8_000_000, status: 'active', nextPaymentDate: '2026-11-07',
        installments: [{ id: 'installment-1', date: '2026-10-07', amount: 8_000_000, status: 'paid' }, { id: 'installment-2', date: '2026-11-07', amount: 4_000_000, status: 'pending' }, { id: 'installment-3', date: '2026-12-07', amount: 4_000_000, status: 'pending' }] },
    },
    {
      id: 'ipc_' + 'b'.repeat(40), contractId: 'contract-2', installmentId: 'installment-9', studentId: 'student-2', studentName: 'Lê Hoàng Phúc', studentPhone: '',
      branchId: 'branch-a', packageName: 'PT nhóm · 3 tháng', amount: 2_500_000, installmentAmount: 2_500_000, dueDate: '2026-11-01', sequence: 2, installmentCount: 2, transferCode: '3MW8TQ0R', transferContent: 'LE HOANG PHUC 3MW8TQ0R', cashAccountId: null,
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
  const content = 'NGUYEN MINH ANH 7K3QX9M2'
  const paid = state.scenario === 'paid'
  const claimStatus = state.scenario === 'rejected' && !state.claimStatus ? 'rejected' : state.claimStatus
  const claimAmount = claimStatus ? state.claimAmount : amount
  return {
    schemaVersion: 1,
    claimId: 'ipc_' + 'c'.repeat(40),
    state: paid ? 'paid' : claimStatus === 'submitted' ? 'submitted' : claimStatus === 'rejected' ? 'rejected' : 'open',
    unavailableReason: null,
    message: null,
    contract: { id: 'contract-1', packageName: 'PT 1:1 · 6 tháng', totalAmount: 16_000_000, paidAmount: paid ? 12_000_000 : 8_000_000, outstandingAmount: paid ? 4_000_000 : 8_000_000 },
    installment: { id: 'installment-2', amount, dueDate: addDays(due[state.scenario]), sequence: 2, count: 3, daysUntilDue: due[state.scenario], minAmount: 100_000, maxAmount: paid ? 4_000_000 : 8_000_000 },
    laterInstallments: [{ id: 'installment-3', date: addDays(due[state.scenario] + 30), amount: 4_000_000, sequence: 3 }],
    transfer: paid || state.scenario === 'no_account' ? null : { bankName: 'Vietcombank', bankBin: '970436', accountNumber: '1023456789', accountName: 'CONG TY TNHH AURA FITNESS', content, qrPayload: vietQrPayload({ bankBin: '970436', accountNumber: '1023456789', amount, content }) },
    claim: paid ? { status: 'confirmed', amount, note: '', submittedAt: null, rejectedReason: '', reviewedAt: null, confirmedAt: new Date().toISOString(), receiptVoucherNumber: 'PT-BRANCHA-20261107-4F2A9C', revision: 1 }
      : claimStatus ? { status: claimStatus, amount: claimAmount, note: state.note, submittedAt: state.submittedAt, rejectedReason: claimStatus === 'rejected' ? 'Chưa thấy giao dịch trong sao kê ngày 06/11. Bạn gửi giúp ảnh biên lai qua Zalo Aura.' : '', reviewedAt: null, confirmedAt: null, receiptVoucherNumber: null, revision: 1, proof: claimStatus === 'submitted' ? state.proof : null }
        : null,
  }
}

const handlers: Record<string, Handler> = {
  getMyInstallmentPayment: () => view(),
  submitMyInstallmentPaymentClaim: (input) => {
    if (input.action === 'withdraw') { state.claimStatus = 'withdrawn'; state.proof = null; return { state: 'open', unchanged: false, claim: { ...view().claim, status: 'withdrawn' } } }
    const proofPath = typeof input.proofPath === 'string' ? input.proofPath : ''
    if (proofPath && !state.uploads[proofPath]) throw Object.assign(new Error('Ảnh biên lai chưa tải lên xong. Hãy thử lại.'), { code: 'functions/failed-precondition', details: { reason: 'proof-missing' } })
    if (input.action === 'attach_proof') {
      if (state.claimStatus !== 'submitted') throw Object.assign(new Error('Chỉ gửi được ảnh khi báo chuyển khoản đang chờ Aura xác nhận.'), { code: 'functions/failed-precondition', details: { reason: 'claim-not-submitted' } })
      state.proof = { uploadedAt: new Date().toISOString(), url: state.uploads[proofPath] }
      return { state: 'submitted', unchanged: false, claim: view().claim }
    }
    if (proofPath) state.proof = { uploadedAt: new Date().toISOString(), url: state.uploads[proofPath] }
    else if (state.claimStatus !== 'submitted') state.proof = null
    const amount = Number(input.amount)
    if (!Number.isSafeInteger(amount) || amount < 100_000 || amount > 8_000_000) throw Object.assign(new Error('Số tiền vượt công nợ còn lại 8.000.000đ.'), { code: 'functions/failed-precondition', details: { reason: 'amount-out-of-range' } })
    state.claimStatus = 'submitted'
    state.claimAmount = amount
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
  state.proof = null
}
