import { useSyncExternalStore } from 'react'
const subscribers = new Set<() => void>()
const publish = () => { state.databaseVersion++; subscribers.forEach(callback => callback()) }
export const state = {
  owner: 'admin-a', authzVersion: 1, calls: [] as Array<{ owner: string; query: any }>, refreshes: 0,
  settlementStatus: 'review_required', settlementRevision: 0, settlement: null as any,
  settlementCutoffDate: new URLSearchParams(window.location.search).get('settlementCutoffDate') || '',
  settlementRecognizedRevenue: 400_000, settlementUnservedValue: 800_000,
  settlementCalls: [] as any[], settlementCommands: [] as any[], settlementFailure: '',
  settlementDefer: false, settlementPending: [] as Array<{ resolve: () => void }>,
  settlementBlockers: [] as Array<{ code: string; message: string }>,
  settlementPermissions: { canSubmit: true, canApprove: true, canClose: true },
  directoryAcquisitions: 0,
  performanceCalls: [] as Array<any>, performanceDefer: false, performanceSettled: 0,
  performancePending: [] as Array<{ resolve: (report: any) => void; reject: (cause: Error) => void }>,
  intentCalls: [] as Array<any>, intentFailure: '', intentDefer: false,
  intentPending: [] as Array<{ resolve: () => void }>,
  studentInstallmentStatus: 'pending', workspaceLoads: 0, projectionRefreshes: 0,
  contractCreateFailure: '', contractCreateCalls: [] as any[], createdContracts: [] as any[],
  bookCalls: [] as Array<{ name: string; owner: string; input: any }>, bookDefer: [] as string[], bookFailures: {} as Record<string, string>,
  bookPages: {} as Record<string, any[]>,
  bookPending: [] as Array<{ name: string; resolve: () => void; reject: (code: string, reason?: string) => void }>, bookMutations: [] as Array<{ name: string; input: any }>,
  databaseVersion: 0, defer: false, settled: 0, failure: '', payments: 0, refunds: 0, reversals: 0,
  cashCalls: [] as Array<{ owner: string }>, cashDefer: false, cashSettled: 0, cashFailure: '',
  cashAccounts: [{ id: 'cash-a', branchId: 'a', status: 'active', name: 'Test cash', balance: 100_000 }],
  cashPending: [] as Array<{ resolve: (result: any) => void; reject: (error: Error) => void; result: any }>,
  updateContract(id: string, patch: Record<string, unknown>) {
    Object.assign(contracts.find(contract => contract.id === id)!, patch)
    database.contracts = [...contracts]
    publish()
  },
  replaceContracts(rows: any[], people: any[]) {
    contracts.splice(0, contracts.length, ...rows)
    database.contracts = [...contracts]
    database.students = people
    publish()
  },
  resolveCash(index: number, failure = '') {
    const pending = this.cashPending[index]
    if (!pending) throw Error('Missing pending cash request')
    if (failure) pending.reject(Object.assign(new Error('Cash read failed'), { code: 'functions/' + failure }))
    else pending.resolve(pending.result)
  },
  pending: [] as Array<{ resolve: (result: any) => void; reject: (error: Error) => void; page: any }>,
  resolve(index: number, failure = '') {
    const pending = this.pending[index]
    if (!pending) throw Error('Missing pending request')
    if (failure) pending.reject(Object.assign(new Error(failure === 'legacy' ? 'ledger type invalid' : 'unavailable'), { code: failure === 'legacy' ? 'functions/invalid-argument' : 'functions/unavailable' }))
    else pending.resolve(pending.page)
  },
}
Object.assign(window, { financeState: state })
const contracts = [
  { id: 'contract-a', studentId: 'student-a', branchId: 'a', packageName: 'Test package A', totalPrice: 1_200_000, discount: 0, paidAmount: 200_000, status: 'active', installments: [] },
  { id: 'contract-b', studentId: 'student-b', branchId: 'b', packageName: 'Test package B', totalPrice: 600_000, discount: 0, paidAmount: 100_000, status: 'frozen', installments: [] },
]
if (new URLSearchParams(window.location.search).get('cancelled') === 'true') contracts[0].status = 'cancelled'
const subscribe = (callback: () => void) => { subscribers.add(callback); return () => { subscribers.delete(callback) } }
const database = {
  contracts, students: [{ id: 'student-a', name: 'Test learner A' }, { id: 'student-b', name: 'Test learner B' }],
  branches: [{ id: 'a', name: 'Branch A' }, { id: 'b', name: 'Branch B' }],
  acquireFinanceDirectory: () => { state.directoryAcquisitions++; return () => {} },
  refreshData: async () => { state.refreshes++ }, operationsSync: { status: 'ready' },
}
export function useDatabase() {
  useSyncExternalStore(subscribe, () => state.databaseVersion)
  return database
}
export function useAuth() {
  return { user: { uid: state.owner }, profile: { uid: state.owner, role: 'admin', authzVersion: state.authzVersion }, authzReady: true, hasCapability: () => true, backendMode: 'firebase' }
}
export async function listBusinessPerformance(input: any) {
  state.performanceCalls.push(structuredClone(input))
  if (!state.performanceDefer) return { dailySeries: [], sourceRows: [], cashFlow: { cashIn: 0, cashOut: 0, cashNet: 0 }, managementPnl: { recognisedRevenue: 0, operatingExpense: 0, operatingResult: 0 }, balanceMovement: { receivableMovement: 0, deferredRevenueMovement: 0 }, dataQuality: { missingSourceIntegrations: [] } }
  try { return await new Promise((resolve, reject) => state.performancePending.push({ resolve, reject })) }
  finally { state.performanceSettled++ }
}
export async function listFinanceLedger(query: any) {
  const owner = state.owner, number = state.calls.push({ owner, query: { ...query } })
  const row = (suffix: string) => ({ id: owner + '-' + suffix, contractId: 'contract-a', studentId: 'student-a', referenceCode: `${owner}-${suffix}-${query.branchId}-${number}`,
    type: 'payment', status: 'posted', cashImpact: 5_000_000, amount: 5_000_000, effectiveAt: '2026-10-25T00:00:00Z' })
  const page = { entries: query.cursor ? [row('first'), row('second')] : [row('first')], summary: null, hasMore: !query.cursor, nextCursor: query.cursor ? null : 'next-' + number }
  if (state.failure) { const failure = state.failure; state.failure = ''; throw Object.assign(new Error(failure === 'legacy' ? 'ledger type invalid' : 'unavailable'), { code: failure === 'legacy' ? 'functions/invalid-argument' : 'functions/unavailable' }) }
  if (!state.defer) return page
  try { return await new Promise((resolve, reject) => { state.pending.push({ resolve, reject, page }) }) }
  finally { state.settled++ }
}
export async function listCashAccounts() {
  state.cashCalls.push({ owner: state.owner })
  const result = { accounts: state.cashAccounts.map(account => ({ ...account })) }
  try {
    if (state.cashFailure) {
      const code = state.cashFailure
      state.cashFailure = ''
      throw Object.assign(new Error('Cash read failed'), { code: 'functions/' + code })
    }
    if (!state.cashDefer) return result
    return await new Promise((resolve, reject) => { state.cashPending.push({ resolve, reject, result }) })
  } finally { state.cashSettled++ }
}
export async function recordContractPayment(input: { contractId: string; amount: number }) {
  state.payments++
  const contract = contracts.find(item => item.id === input.contractId)!
  contract.paidAmount += input.amount
  if (state.settlementStatus === 'approved') state.settlementRevision++
  database.contracts = [...contracts]
  publish()
  return { entryId: 'payment-test', unchanged: false }
}
export async function recordRefund(input?: { contractId: string; amount: number }) {
  state.refunds++
  if (input) { contracts.find(item => item.id === input.contractId)!.paidAmount -= input.amount; if (state.settlementStatus === 'approved') state.settlementRevision++; database.contracts = [...contracts]; publish() }
  return { entryId: 'refund-test', unchanged: false }
}
export async function reverseContractPayment() { state.reversals++; return { entryId: 'reversal-test', unchanged: false } }

export const financeIntentProjectId = 'synthetic-ui-project'
export async function manageFinanceOperation(ownerUid: string, action: string, operation: any) {
  if (ownerUid !== state.owner) throw Error('Tài khoản đã thay đổi.')
  state.intentCalls.push(structuredClone({ ownerUid, action, operation }))
  if (state.intentDefer) await new Promise<void>(resolve => { state.intentPending.push({ resolve }) })
  const failure = state.intentFailure
  state.intentFailure = ''
  if (failure === 'unavailable') throw Error('Mất kết nối thử nghiệm. Yêu cầu gốc vẫn được giữ.')
  const receipts = JSON.parse(localStorage.getItem('synthetic-finance-receipts') || '{}')
  const key = operation.payload.idempotencyKey, fingerprint = JSON.stringify({ ownerUid, operation })
  let result
  if (receipts[key]) {
    if (receipts[key].fingerprint !== fingerprint) throw Error('Yêu cầu đã ghi nhận với nội dung khác.')
    result = receipts[key].result
  } else {
    if (action === 'cancel') result = { protocol: 1, idempotencyKey: key, state: 'cancelled' }
    else {
      const receipt = operation.type === 'payment' ? await recordContractPayment(operation.payload) : operation.type === 'refund' ? await recordRefund(operation.payload) : await reverseContractPayment()
      if (operation.payload.installmentId === 'installment-a') state.studentInstallmentStatus = operation.type === 'payment' ? 'paid' : 'pending'
      result = { protocol: 1, idempotencyKey: key, state: 'committed', receipt }
    }
    receipts[key] = { fingerprint, result }
    localStorage.setItem('synthetic-finance-receipts', JSON.stringify(receipts))
  }
  if (failure === 'commit-lost') throw Error('Đã mất phản hồi thử nghiệm. Hãy kiểm tra lại yêu cầu.')
  return result
}

export async function getStudent360ContractWorkspace() {
  state.workspaceLoads++
  const receipts = JSON.parse(localStorage.getItem('synthetic-finance-receipts') || '{}')
  for (const receipt of Object.values(receipts) as any[]) {
    const { operation } = JSON.parse(receipt.fingerprint)
    if (receipt.result.state === 'committed' && operation.payload.installmentId === 'installment-a') state.studentInstallmentStatus = operation.type === 'payment' ? 'paid' : 'pending'
  }
  return {
    schemaVersion: 1, activeContractId: 'contract-a', student: { id: 'student-a', name: 'Test learner A', phone: '', email: '' },
    permissions: { canManageContract: false, canCreateContract: new URLSearchParams(window.location.search).has('create'), canEditFinancialTerms: new URLSearchParams(window.location.search).has('create'), canCollectPayments: true, canViewFinancialAmounts: true },
    contracts: [{ ...contracts[0], trainerIds: [], nutritionPTIds: [], startDate: '2026-10-01', endDate: '2026-12-31', totalSessions: 12, usedSessions: 0, revision: 1, extensions: [], pausePeriods: [], installments: [{ id: 'installment-a', date: '2026-10-25', amount: 100_000, status: state.studentInstallmentStatus }] }],
    trainers: [], packages: [{ id: 'package-a', name: 'New synthetic package', totalSessions: 12, price: 1200000, durationMonths: 3 }], branches: database.branches,
  }
}
export async function mutateStudent360Contract(input: any) {
  if (input.action !== 'create') throw Error('Unexpected contract mutation in finance fixture')
  state.contractCreateCalls.push(structuredClone(input))
  if (!input.contractId) throw Error('Missing stable create ID')
  const existing = state.createdContracts.find(item => item.contractId === input.contractId)
  if (existing && JSON.stringify(existing) !== JSON.stringify(input)) throw Object.assign(Error('Mismatched create replay'), { code: 'functions/already-exists' })
  if (!existing) state.createdContracts.push(structuredClone(input))
  if (state.contractCreateFailure === 'commit-lost') { state.contractCreateFailure = ''; throw Object.assign(Error('Mất phản hồi tạo hợp đồng thử nghiệm'), { code: 'functions/unavailable' }) }
  return { contractId: input.contractId, revision: 1, action: 'create' }
}
export async function refreshStudent360Projection() { state.projectionRefreshes++; return {} }

export function contractSettlementLabel(status: string) {
  return status === 'settled' ? 'Đã quyết toán' : status === 'approved' ? 'Đã duyệt quyết toán' : status === 'pending_approval' ? 'Chờ duyệt quyết toán' : 'Cần rà soát quyết toán'
}
function settlementResponse(input: any = {}) {
  const paid = contracts[0].paidAmount
  const target = state.settlement?.settlementAmount
  const cutoffDate = input.cutoffDate || state.settlement?.proposal.cutoffDate || state.settlementCutoffDate
  return structuredClone({
    contractId: input.contractId || 'contract-a', revision: state.settlementRevision, status: state.settlementStatus,
    settlement: state.settlement ? { ...state.settlement, revision: state.settlementRevision, status: state.settlementStatus } : null,
    preview: { originalNetValue: 1_200_000, canonicalCash: paid, paidProjection: paid, recognizedRevenue: state.settlementRecognizedRevenue, unservedValue: state.settlementUnservedValue, cutoffDate,
      blockers: state.settlementBlockers, snapshotHash: `${state.owner}:${state.settlementRevision}:${paid}:${cutoffDate}:${state.settlementRecognizedRevenue}:${state.settlementUnservedValue}`,
      ...(['approved', 'settled'].includes(state.settlementStatus) ? { dueAmount: Math.max(0, target - paid), refundAmount: Math.max(0, paid - target) } : {}) },
    permissions: state.settlementPermissions,
  })
}
export async function getContractSettlement(input: any) {
  state.settlementCalls.push({ owner: state.owner, input: structuredClone(input) })
  const response = settlementResponse(input)
  if (state.settlementDefer) await new Promise<void>(resolve => state.settlementPending.push({ resolve }))
  return response
}
const settlementReceipts = new Map<string, any>()
export async function manageContractSettlement(input: any) {
  state.settlementCommands.push(structuredClone(input))
  if (state.settlementFailure === 'aborted') {
    state.settlementFailure = ''
    state.settlementRevision++
    throw Object.assign(Error('Số liệu đã thay đổi. Đối soát lại.'), { code: 'functions/aborted' })
  }
  const stored = settlementReceipts.get(input.operationId)
  if (stored) return stored
  if (input.expectedRevision !== state.settlementRevision) throw Error('Hồ sơ đã thay đổi. Đối soát lại trước khi duyệt.')
  if (input.action === 'submit') {
    if (state.settlementBlockers.length) throw Object.assign(Error('Chưa đủ đối soát'), { code: 'functions/failed-precondition' })
    const p = input.proposal
    state.settlement = { proposal: p, settlementAmount: 1_200_000 - p.waivedFutureAmount + p.feeAmount - p.serviceReductionAmount - p.writeOffAmount }
    state.settlementStatus = 'pending_approval'
  } else if (input.action === 'approve') {
    if (state.settlementBlockers.length) throw Error('Chưa đủ đối soát')
    state.settlementStatus = 'approved'
  } else if (input.action === 'withdraw') state.settlementStatus = 'review_required'
  else if (input.action === 'close') {
    if (contracts[0].paidAmount !== state.settlement.settlementAmount) throw Error('Chưa cân đối tiền')
    state.settlementStatus = 'settled'
  }
  state.settlementRevision++
  const response = settlementResponse(input)
  settlementReceipts.set(input.operationId, response)
  if (state.settlementFailure === 'commit-lost') { state.settlementFailure = ''; throw Error('Mất phản hồi quyết toán thử nghiệm') }
  return response
}

async function bookRead(name: string, input: any, result: any) {
  state.bookCalls.push({ name, owner: state.owner, input: structuredClone(input) })
  if (state.bookFailures[name]) {
    const code = state.bookFailures[name]; delete state.bookFailures[name]
    throw Object.assign(new Error('Synthetic ' + name + ' failure'), { code: 'functions/' + code })
  }
  if (state.bookDefer.includes(name)) return new Promise((resolve, reject) => state.bookPending.push({ name, resolve: () => resolve(result), reject: (code, reason) => reject(Object.assign(new Error('Synthetic read failure'), { code: 'functions/' + code, details: { reason } })) }))
  return result
}
function bookPage(name: string, input: any, key: string, rows: any[]) {
  const result = state.bookPages[name]?.shift() || { [key]: rows, paginationVersion: 1, hasMore: false, nextCursor: null, scanLimited: false, asOf: '2026-10-26T00:00:00.000Z' }
  return bookRead(name, input, result)
}
const bookSettings = () => ({ businessName: state.owner, address: 'Synthetic address', taxCode: 'TEST-ONLY', representativeName: '', unit: 'VND' })
export async function getS2eCashDetailBook(input: any) {
  return bookRead('s2e', input, { formCode: 'S2e-HKD', settings: { ...bookSettings(), businessName: `${state.owner}:${input.accountId || 'all'}:${input.periodStart}` }, sections: [], ...input })
}
export async function listCashTransactions(input: any) {
  return bookPage('cash', input, 'transactions', [{ id: 'transaction-a', referenceCode: `${state.owner}:${input.accountId || 'all'}:movement`, amount: 100_000, category: 'Synthetic movement', effectiveAt: '2026-10-26T00:00:00Z' }])
}
export async function listExpenseVouchers(input: any) {
  return bookPage('vouchers', input, 'vouchers', [{ id: 'expense-a', voucherNumber: `${state.owner}:expense`, status: 'pending_approval', documentType: 'expense_voucher', totalAmount: 100_000, revision: 1, purposeLabel: 'Synthetic expense', payeeName: 'Test payee', effectiveAt: '2026-10-26T00:00:00Z' }])
}
export async function listReceiptVouchers(input: any) {
  return bookPage('receipts', input, 'vouchers', [{ id: 'receipt-a', voucherNumber: `${state.owner}:${input.accountId || 'all'}:receipt`, status: 'posted', documentType: 'receipt_voucher', totalAmount: 100_000, payerName: 'Test payer', accountId: 'cash-a', effectiveAt: '2026-10-26T00:00:00Z', journalLines: [] }])
}
export async function listAccountingCatalog() {
  return bookRead('catalog', {}, { accounts: [{ code: '1111', name: 'Synthetic cash', group: 'asset' }],
    expensePurposes: [{ code: 'expense', label: 'Synthetic expense purpose', debitAccountCode: '642', expenseImpact: true, vatAllowed: false }],
    receiptPurposes: [{ code: 'other', label: 'Synthetic receipt purpose', creditAccountCode: '711', revenueImpact: true }], approvalSeparationThreshold: 10_000_000 })
}
async function bookMutation(name: string, input: any) { state.bookMutations.push({ name, input }); return { voucherNumber: 'SYNTHETIC-RECEIPT', voucherId: 'synthetic-voucher' } }
export const approveAndPostExpenseVoucher = (input: any) => bookMutation('approve', input)
export const createManualReceiptVoucher = (input: any) => bookMutation('receipt', input)
export const initializeCashAccount = (input: any) => bookMutation('initialize', input)
export const reverseExpenseVoucher = (input: any) => bookMutation('reverse-expense', input)
export const reverseManualReceiptVoucher = (input: any) => bookMutation('reverse-receipt', input)
export const saveS2eCashDetailSettings = (input: any) => bookMutation('settings', input)
export const saveExpenseVoucherDraft = (input: any) => bookMutation('expense', input)
export const transferCash = (input: any) => bookMutation('transfer', input)
