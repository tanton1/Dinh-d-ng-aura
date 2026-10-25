import { useSyncExternalStore } from 'react'
const subscribers = new Set<() => void>()
const publish = () => { state.databaseVersion++; subscribers.forEach(callback => callback()) }
export const state = {
  owner: 'admin-a', calls: [] as Array<{ owner: string; query: any }>, refreshes: 0,
  databaseVersion: 0, defer: false, settled: 0, failure: '', payments: 0, reversals: 0,
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
export async function listFinanceLedger(query: any) {
  const owner = state.owner, number = state.calls.push({ owner, query: { ...query } })
  const row = (suffix: string) => ({ id: owner + '-' + suffix, studentId: 'student-a', referenceCode: `${owner}-${suffix}-${query.branchId}-${number}`,
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
export const recordRefund = async () => ({ entryId: 'refund-test', unchanged: false })
export async function reverseContractPayment() { state.reversals++; return { entryId: 'reversal-test', unchanged: false } }
