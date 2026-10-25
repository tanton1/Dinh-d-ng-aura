import { useSyncExternalStore } from 'react'
const subscribers = new Set<() => void>()
const publish = () => { state.databaseVersion++; subscribers.forEach(callback => callback()) }
export const state = {
  owner: 'admin-a', authzVersion: 1, calls: [] as Array<{ owner: string; query: any }>, refreshes: 0,
  intentCalls: [] as Array<any>, intentFailure: '', intentDefer: false,
  intentPending: [] as Array<{ resolve: () => void }>,
  studentInstallmentStatus: 'pending', workspaceLoads: 0, projectionRefreshes: 0,
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
const contracts = [
  { id: 'contract-a', studentId: 'student-a', branchId: 'a', packageName: 'Test package A', totalPrice: 1_200_000, discount: 0, paidAmount: 200_000, status: 'active', installments: [] },
  { id: 'contract-b', studentId: 'student-b', branchId: 'b', packageName: 'Test package B', totalPrice: 600_000, discount: 0, paidAmount: 100_000, status: 'frozen', installments: [] },
]
const subscribe = (callback: () => void) => { subscribers.add(callback); return () => { subscribers.delete(callback) } }
const database = {
  contracts, students: [{ id: 'student-a', name: 'Test learner A' }, { id: 'student-b', name: 'Test learner B' }],
  branches: [{ id: 'a', name: 'Branch A' }, { id: 'b', name: 'Branch B' }],
  acquireFinanceDirectory: () => () => {},
  refreshData: async () => { state.refreshes++ }, operationsSync: { status: 'ready' },
}
export function useDatabase() {
  useSyncExternalStore(subscribe, () => state.databaseVersion)
  return database
}
export function useAuth() {
  return { user: { uid: state.owner }, profile: { uid: state.owner, role: 'admin', authzVersion: state.authzVersion }, authzReady: true, hasCapability: () => true, backendMode: 'firebase' }
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
