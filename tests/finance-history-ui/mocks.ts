import { useSyncExternalStore } from 'react'
const subscribers = new Set<() => void>()
const publish = () => { state.databaseVersion++; subscribers.forEach(callback => callback()) }
export const state = {
  owner: 'admin-a', authzVersion: 1, calls: [] as Array<{ owner: string; query: any }>, refreshes: 0,
  reportCalls: [] as Array<{ owner: string; query: any }>, labelCalls: [] as Array<{ owner: string; studentIds: string[] }>,
  intentCalls: [] as Array<any>, intentFailure: '', intentDefer: false,
  intentPending: [] as Array<{ resolve: () => void }>,
  studentInstallmentStatus: 'pending', workspaceLoads: 0, projectionRefreshes: 0,
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
const contracts: Array<Record<string, any>> = [
  { id: 'contract-a', studentId: 'student-a', branchId: 'a', packageName: 'Test package A', totalPrice: 1_200_000, discount: 0, paidAmount: 200_000, status: 'active', installments: [] },
  { id: 'contract-b', studentId: 'student-b', branchId: 'b', packageName: 'Test package B', totalPrice: 600_000, discount: 0, paidAmount: 100_000, status: 'frozen', installments: [] },
]
const subscribe = (callback: () => void) => { subscribers.add(callback); return () => { subscribers.delete(callback) } }
const database = {
  contracts, students: [{ id: 'student-a', name: 'Test learner A' }, { id: 'student-b', name: 'Test learner B' }],
  branches: [{ id: 'a', name: 'Branch A' }, { id: 'b', name: 'Branch B' }],
  refreshData: async () => { state.refreshes++ }, operationsSync: { status: 'ready' },
}
export function useDatabase() {
  useSyncExternalStore(subscribe, () => state.databaseVersion)
  return database
}
export function useAuth() {
  return { user: { uid: state.owner }, profile: { uid: state.owner, role: 'admin', authzVersion: state.authzVersion }, authzReady: true, hasCapability: () => true, backendMode: 'firebase' }
}
// Model a bounded report response, not a live directory: later fixture writes
// become visible only through a subsequent explicit or date-scoped report read.
export async function listFinanceReceivables(query: any) {
  state.reportCalls.push({ owner: state.owner, query: structuredClone(query) })
  const scoped = contracts.filter(contract => query.branchId === 'all' || contract.branchId === query.branchId)
  const weekStart = new Date(`${query.today}T12:00:00Z`)
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay())
  const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
  const start = weekStart.toISOString().slice(0, 10), end = weekEnd.toISOString().slice(0, 10)
  const entries = scoped.map(contract => {
    const balance = contract.totalPrice - contract.discount - contract.paidAmount, debt = Math.max(0, balance)
    const pending = contract.installments.filter((item: any) => item.status === 'pending').sort((a: any, b: any) => a.date.localeCompare(b.date))
    const due = pending[0]?.date || contract.nextPaymentDate || ''
    const amountIn = (matches: (date: string) => boolean) => {
      if (contract.status === 'frozen') return 0
      return pending.length ? Math.min(debt, pending.filter((item: any) => matches(item.date)).reduce((sum: number, item: any) => sum + item.amount, 0))
        : due && matches(due) ? debt : 0
    }
    const overdue = amountIn(date => date < query.today), thisMonth = amountIn(date => date.slice(0, 7) === query.today.slice(0, 7))
    return { contract, debt, overdue, thisMonth, groups: { all: debt > 0, overdue: overdue > 0,
      'this-week': debt > 0 && contract.status !== 'frozen' && due >= start && due <= end,
      'this-month': thisMonth > 0, overpaid: balance < 0 } as Record<string, boolean> }
  })
  const totals = { debt: 0, overdue: 0, thisMonth: 0 }, counts: Record<string, number> = { all: 0, overdue: 0, 'this-week': 0, 'this-month': 0, overpaid: 0 }
  for (const entry of entries) {
    totals.debt += entry.debt; totals.overdue += entry.overdue; totals.thisMonth += entry.thisMonth
    for (const key of Object.keys(counts)) if (entry.groups[key]) counts[key]++
  }
  const searchKey = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const matching = entries.filter(entry => entry.groups[query.filter] && searchKey([
    entry.contract.id, entry.contract.packageName, database.students.find(student => student.id === entry.contract.studentId)?.name || '',
  ].join(' ')).includes(searchKey(query.search || ''))).map(entry => entry.contract)
  const offset = Number(query.cursor || 0), rows = matching.slice(offset, offset + 20), hasMore = offset + 20 < matching.length
  const asOf = new Date().toISOString()
  return structuredClone({ contracts: rows, students: database.students.filter(student => rows.some(contract => contract.studentId === student.id)),
    summary: query.includeSummary === false ? null : { complete: true, totals, counts, asOf, sourceDocuments: scoped.length },
    nextCursor: hasMore ? String(offset + 20) : null, hasMore, asOf, scanned: scoped.length })
}
export async function listFinanceStudentLabels(studentIds: string[]) {
  state.labelCalls.push({ owner: state.owner, studentIds: [...studentIds] })
  return structuredClone(database.students.filter(student => studentIds.includes(student.id)))
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
  database.contracts = [...contracts]
  publish()
  return { entryId: 'payment-test', unchanged: false }
}
export async function recordRefund(input?: { contractId: string; amount: number }) {
  state.refunds++
  if (input) { contracts.find(item => item.id === input.contractId)!.paidAmount -= input.amount; database.contracts = [...contracts]; publish() }
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
    permissions: { canManageContract: false, canCreateContract: false, canEditFinancialTerms: false, canCollectPayments: true, canViewFinancialAmounts: true },
    contracts: [{ ...contracts[0], trainerIds: [], nutritionPTIds: [], startDate: '2026-10-01', endDate: '2026-12-31', totalSessions: 12, usedSessions: 0, revision: 1, extensions: [], pausePeriods: [], installments: [{ id: 'installment-a', date: '2026-10-25', amount: 100_000, status: state.studentInstallmentStatus }] }],
    trainers: [], packages: [], branches: database.branches,
  }
}
export async function mutateStudent360Contract() { throw Error('Unexpected contract mutation in finance fixture') }
export async function refreshStudent360Projection() { state.projectionRefreshes++; return {} }

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
