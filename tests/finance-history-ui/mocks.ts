import { useSyncExternalStore } from 'react'
const subscribers = new Set<() => void>()
const publish = () => { state.databaseVersion++; subscribers.forEach(callback => callback()) }
export const state = {
  owner: 'admin-a', authzVersion: 1, calls: [] as Array<{ owner: string; query: any }>, refreshes: 0,
  reportCalls: [] as Array<{ owner: string; query: any }>, labelCalls: [] as Array<{ owner: string; studentIds: string[] }>,
  receivablesPages: [] as any[], receivablesDefer: false,
  receivablesPending: [] as Array<{ resolve: () => void; reject: () => void }>,
  ledgerCanReverse: true as boolean | null,
  settlementStatus: 'review_required', settlementRevision: 0, settlement: null as any,
  settlementCutoffDate: new URLSearchParams(window.location.search).get('settlementCutoffDate') || '',
  settlementConfirmedCutoffDate: (new URLSearchParams(window.location.search).get('settlementCutoffDate') || null) as string | null,
  settlementSupportsCutoffVerification: true,
  settlementRecognizedRevenue: 400_000, settlementUnservedValue: 800_000,
  settlementCalls: [] as any[], settlementCommands: [] as any[], settlementFailure: '',
  settlementDefer: false, settlementPending: [] as Array<{ resolve: () => void }>,
  settlementBlockers: [] as Array<{ code: string; message: string }>,
  settlementPermissions: { canSubmit: true, canApprove: true, canClose: true },
  settlementSyncFailure: '', settlementSyncDefer: false,
  settlementSyncPending: [] as Array<{ resolve: () => void }>,
  overviewLoads: 0, overviewDefer: false, overviewFailure: '', projectionFailure: '',
  overviewPending: [] as Array<{ resolve: () => void; reject: (cause: Error) => void }>,
  workspaceDefer: false, workspaceFailure: '', workspacePending: [] as Array<{ resolve: () => void }>,
  directoryAcquisitions: 0,
  performanceCalls: [] as Array<any>, performanceDefer: false, performanceSettled: 0,
  performancePending: [] as Array<{ resolve: (report: any) => void; reject: (cause: Error) => void }>,
  intentCalls: [] as Array<any>, intentFailure: '', intentDefer: false,
  intentPending: [] as Array<{ resolve: () => void }>,
  studentInstallmentStatus: 'pending', workspaceLoads: 0, projectionRefreshes: 0,
  contractCreateFailure: '', contractCreateCalls: [] as any[], createdContracts: JSON.parse(sessionStorage.getItem('synthetic-created-contracts') || '[]') as any[], contractPlanEdits: [] as any[],
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
const contracts: Array<Record<string, any>> = [
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
// The real Student360Page checks the live Firebase owner independently of context.
// Keep the snapshot stable during profile rerenders, including StrictMode checks.
let firebaseOwner = { uid: state.owner }
export const firebaseAuth = { get currentUser() {
  if (firebaseOwner.uid !== state.owner) firebaseOwner = { uid: state.owner }
  return firebaseOwner
} }
export function onAuthStateChanged(_auth: unknown, callback: () => void) { callback(); return () => {} }
// Model a bounded report response, not a live directory: later fixture writes
// become visible only through a subsequent explicit or date-scoped report read.
async function receivablesResponse(value: any) {
  const result = structuredClone(value)
  if (state.receivablesDefer) await new Promise<void>((resolve, reject) => state.receivablesPending.push({ resolve, reject: () => reject(new Error('Chưa tải được hồ sơ.')) }))
  return result
}
export async function listFinanceReceivables(query: any) {
  state.reportCalls.push({ owner: state.owner, query: structuredClone(query) })
  if (state.receivablesPages.length) return receivablesResponse(state.receivablesPages.shift())
  const scoped = contracts.filter(contract => contract.status !== 'cancelled' && (query.branchId === 'all' || contract.branchId === query.branchId))
  const category = query.category || 'all'
  const weekStart = new Date(`${query.today}T12:00:00Z`)
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7))
  const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
  const start = weekStart.toISOString().slice(0, 10), end = weekEnd.toISOString().slice(0, 10)
  const entries = scoped.map(contract => {
    const balance = contract.totalPrice - contract.discount - contract.paidAmount, debt = Math.max(0, balance)
    const pending = contract.installments.filter((item: any) => item.status === 'pending').sort((a: any, b: any) => a.date.localeCompare(b.date))
    const due = pending[0]?.date || contract.nextPaymentDate || ''
    const preserved = !['cancelled', 'inactive', 'archived', 'draft'].includes(contract.status) &&
      (contract.status === 'frozen' || (contract.pausePeriods || []).some((period: any) =>
        period.type === 'preservation' && period.startDate <= query.today && period.endDate >= query.today))
    const included = category === 'all' || (category === 'frozen' ? preserved && debt > 0 : !preserved &&
      (category === 'installments' ? pending.length > 0 && balance > 0 : balance < 0 || pending.length === 0))
    const amountIn = (matches: (date: string) => boolean) => {
      if (preserved) return 0
      return pending.length ? Math.min(debt, pending.filter((item: any) => matches(item.date)).reduce((sum: number, item: any) => sum + item.amount, 0))
        : due && matches(due) ? debt : 0
    }
    const overdue = amountIn(date => date < query.today), thisMonth = amountIn(date => date.slice(0, 7) === query.today.slice(0, 7))
    return { contract, included, debt, overdue, thisMonth, groups: { all: debt > 0,
      owing: debt > 0, settled: balance === 0, overdue: overdue > 0,
      'this-week': amountIn(date => date >= start && date <= end) > 0,
      'this-month': thisMonth > 0, overpaid: balance < 0 } as Record<string, boolean> }
  }).filter(entry => entry.included)
  const totals = { debt: 0, overdue: 0, thisMonth: 0 }, counts: Record<string, number> = { all: 0, owing: 0, settled: 0, overdue: 0, 'this-week': 0, 'this-month': 0, overpaid: 0 }
  for (const entry of entries) {
    totals.debt += entry.debt; totals.overdue += entry.overdue; totals.thisMonth += entry.thisMonth
    for (const key of Object.keys(counts)) if (entry.groups[key]) counts[key]++
  }
  const searchKey = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const matching = entries.filter(entry => entry.groups[query.filter] && searchKey([
    entry.contract.id, entry.contract.packageName, database.students.find(student => student.id === entry.contract.studentId)?.name || '',
  ].join(' ')).includes(searchKey(query.search || ''))).map(entry => entry.contract)
  const size = query.pageSize ?? 20
  const offset = Number(query.cursor || 0), rows = matching.slice(offset, offset + size), hasMore = offset + size < matching.length
  const asOf = new Date().toISOString()
  return receivablesResponse({ contracts: rows, students: database.students.filter(student => rows.some(contract => contract.studentId === student.id)),
    summary: query.includeSummary === false ? null : { complete: true, totals, counts, asOf, sourceDocuments: scoped.length },
    nextCursor: hasMore ? String(offset + size) : null, hasMore, asOf, scanned: scoped.length })
}
export async function listFinanceStudentLabels(studentIds: string[]) {
  state.labelCalls.push({ owner: state.owner, studentIds: [...studentIds] })
  return structuredClone(database.students.filter(student => studentIds.includes(student.id)))
}
export async function listBusinessPerformance(input: any) {
  state.performanceCalls.push(structuredClone(input))
  if (!state.performanceDefer) return { schemaVersion: 3, range: { startDate: input.startDate, endDate: input.endDate, timeZone: 'Asia/Ho_Chi_Minh' }, branchId: input.branchId || 'all', source: input.source || 'all', dailySeries: [], sourceRows: [], receipts: { gross: 0, refunds: 0, reversals: 0, adjustments: 0, net: 0 }, sales: ['all', 'pt_gym'].includes(input.source) ? { grossContractSales: 0, contractSalesAdjustment: 0, netContractSales: 0, contractCount: 0, complete: true } : null, cashFlow: { cashIn: 0, cashOut: 0, cashNet: 0 }, managementPnl: { recognisedRevenue: 0, operatingExpense: 0, operatingResult: 0 }, balanceMovement: { receivableMovement: 0, deferredRevenueMovement: 0 }, dataQuality: { missingSourceIntegrations: [], ledgerTruncated: false } }
  try { return await new Promise((resolve, reject) => state.performancePending.push({ resolve, reject })) }
  finally { state.performanceSettled++ }
}
export async function listFinanceLedger(query: any) {
  const owner = state.owner, number = state.calls.push({ owner, query: { ...query } })
  const row = (suffix: string) => ({ id: owner + '-' + suffix, contractId: 'contract-a', studentId: 'student-a', referenceCode: `${owner}-${suffix}-${query.branchId}-${number}`,
    type: 'payment', status: 'posted', cashImpact: 5_000_000, amount: 5_000_000, effectiveAt: '2026-10-25T00:00:00Z',
    ...(typeof state.ledgerCanReverse === 'boolean' ? { canReverse: state.ledgerCanReverse } : {}) })
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
  if (state.workspaceDefer) await new Promise<void>(resolve => state.workspacePending.push({ resolve }))
  if (state.workspaceFailure) throw Object.assign(new Error('Không tải được hồ sơ hợp đồng thử nghiệm.'), { code: 'functions/' + state.workspaceFailure })
  const receipts = JSON.parse(localStorage.getItem('synthetic-finance-receipts') || '{}')
  for (const receipt of Object.values(receipts) as any[]) {
    const { operation } = JSON.parse(receipt.fingerprint)
    if (receipt.result.state === 'committed' && operation.payload.installmentId === 'installment-a') state.studentInstallmentStatus = operation.type === 'payment' ? 'paid' : 'pending'
  }
  return {
    schemaVersion: 1, activeContractId: new URLSearchParams(window.location.search).has('multipleContracts') ? 'contract-b' : 'contract-a', student: { id: 'student-a', name: 'Test learner A', phone: '', email: '' },
    permissions: { canManageContract: new URLSearchParams(window.location.search).has('editPlan'), canCreateContract: new URLSearchParams(window.location.search).has('create'), canEditFinancialTerms: new URLSearchParams(window.location.search).has('create') || new URLSearchParams(window.location.search).has('editPlan'), canCollectPayments: true, canViewFinancialAmounts: true },
    contracts: (new URLSearchParams(window.location.search).has('multipleContracts') ? contracts : [contracts[0]]).map(contract => ({ ...contract, ...(new URLSearchParams(window.location.search).has('editPlan') ? { totalPrice: 1200000, paidAmount: 300000, discount: 0 } : {}), studentId: 'student-a', trainerIds: [], nutritionPTIds: [], startDate: '2026-10-01', endDate: '2026-12-31', totalSessions: 12, usedSessions: 0, revision: 1, extensions: [], pausePeriods: [], installments: new URLSearchParams(window.location.search).has('editPlan') ? (state.contractPlanEdits.at(-1)?.installments || [{ id: 'paid-history', date: '2026-10-01', amount: 300000, status: 'paid' }, { id: 'installment-a', date: '2026-12-01', amount: 900000, status: 'pending' }]) : [{ id: 'installment-a', date: '2026-10-25', amount: 100_000, status: state.studentInstallmentStatus }] })),
    trainers: [], packages: [{ id: 'package-a', name: 'New synthetic package', totalSessions: 12, price: 1200000, durationMonths: 3 }], branches: database.branches,
  }
}
export async function mutateStudent360Contract(input: any) {
  if (input.action === 'edit_payment_plan') { state.contractPlanEdits.push(structuredClone(input)); return { contractId: input.contractId, action: input.action, revision: 2 } }
  if (input.action !== 'create') throw Error('Unexpected contract mutation in finance fixture')
  state.contractCreateCalls.push(structuredClone(input))
  if (!input.contractId) throw Error('Missing stable create ID')
  const existing = state.createdContracts.find(item => item.contractId === input.contractId)
  if (existing && JSON.stringify(existing) !== JSON.stringify(input)) throw Object.assign(Error('Mismatched create replay'), { code: 'functions/already-exists' })
  if (!existing) state.createdContracts.push(structuredClone(input))
  sessionStorage.setItem('synthetic-created-contracts', JSON.stringify(state.createdContracts))
  if (state.contractCreateFailure === 'commit-lost') { state.contractCreateFailure = ''; throw Object.assign(Error('Mất phản hồi tạo hợp đồng thử nghiệm'), { code: 'functions/unavailable' }) }
  return { contractId: input.contractId, revision: 1, action: 'create', ...(input.initialPayment ? { receiptVoucherId: 'receipt-' + input.contractId, receiptVoucherNumber: 'PT-TEST-001' } : {}) }
}

export async function previewContractAmendment() {
  throw new Error('Contract amendment has a dedicated interaction fixture.')
}
export async function refreshStudent360Projection() {
  state.projectionRefreshes++
  if (state.projectionFailure) throw Object.assign(new Error('Không cập nhật được tổng hợp thử nghiệm.'), { code: 'functions/' + state.projectionFailure })
  return {}
}

export async function settlementChanged() {
  state.refreshes++
  if (state.settlementSyncDefer) await new Promise<void>(resolve => state.settlementSyncPending.push({ resolve }))
  if (state.settlementSyncFailure) throw Object.assign(new Error('Không tải được tổng quan sau khi lưu.'), { code: state.settlementSyncFailure })
}

// Exercise the real Student360Page refresh lifecycle without reaching Firebase.
export async function getStudent360Overview(studentId: string) {
  state.overviewLoads++
  if (state.overviewDefer) await new Promise<void>((resolve, reject) => state.overviewPending.push({ resolve, reject }))
  if (state.overviewFailure) throw Object.assign(new Error('Không tải được tổng quan thử nghiệm.'), { code: 'functions/' + state.overviewFailure })
  return {
    studentId, generatedAt: new Date().toISOString(),
    permissions: { scope: 'system', canManageContract: true, canViewFinancialAmounts: true, canRefreshProjection: true },
    identity: { id: studentId, name: 'Test learner A', status: 'active', goals: [] },
    assignments: { branchId: 'a', branchName: 'Branch A', trainerIds: [], trainerNames: [], nutritionCoachIds: [], nutritionCoachNames: [], salesIds: [], salesNames: [] },
    contract: null,
    schedule: { requiredSessions: 0, bookedSessions: 0, sessions: [], availability: { slots: [] } },
    attendance: { rate28Days: null }, training: { program: null }, nutrition: {}, progress: null, renewal: null,
    health: { score: 0, status: 'stable', confidence: 'low', components: [] },
    nextActions: [], alerts: [], dataQuality: [], cache: { hit: true, stale: false },
  }
}
export async function createStudentCareActivity() { throw Error('Unexpected care mutation in finance fixture') }
export async function getStudent360NutritionActivityDetail() { throw Error('Unexpected nutrition read in finance fixture') }
export async function getStudent360ProgressPhotos() { return { photos: [], hasMore: false, nextCursor: null } }
export async function listStudent360Timeline() { return { events: [], hasMore: false, nextCursor: null } }
export async function listStudentTrainingHistory() { return { rows: [], hasMore: false, nextCursor: null } }
export async function getStudentLoyaltySummary() { return { account: null } }
export async function trackProductEvent() {}

export function contractSettlementLabel(status: string) {
  return status === 'settled' ? 'Đã quyết toán' : status === 'approved' ? 'Đã duyệt quyết toán' : status === 'pending_approval' ? 'Chờ duyệt quyết toán' : 'Cần rà soát quyết toán'
}
function settlementResponse(input: any = {}) {
  const paid = contracts[0].paidAmount
  const target = state.settlement?.settlementAmount
  const cutoffDate = input.cutoffDate || state.settlement?.proposal?.cutoffDate || state.settlementCutoffDate
  return structuredClone({
    contractId: input.contractId || 'contract-a', revision: state.settlementRevision, status: state.settlementStatus,
    settlement: state.settlement ? { ...state.settlement, revision: state.settlementRevision, status: state.settlementStatus } : null,
    preview: { originalNetValue: 1_200_000, canonicalCash: paid, paidProjection: paid, recognizedRevenue: state.settlementRecognizedRevenue, unservedValue: state.settlementUnservedValue, cutoffDate,
      ...(state.settlementSupportsCutoffVerification ? { confirmedCutoffDate: state.settlementConfirmedCutoffDate } : {}),
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
  if (input.action === 'verify_cutoff') {
    state.settlementCutoffDate = input.cutoffDate
    state.settlementConfirmedCutoffDate = input.cutoffDate
    state.settlement = { cutoffDate: input.cutoffDate, cutoffVerifiedDate: input.cutoffDate, cutoffVerificationReason: input.reason }
    state.settlementStatus = 'review_required'
  } else if (input.action === 'submit') {
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

export async function listFinanceReconciliationCases() { throw new Error("Unexpected reconciliation page read") }
export async function getFinanceReconciliationCase() { throw new Error("Unexpected reconciliation detail read") }
export async function resolveFinanceReconciliationCase() { throw new Error("Unexpected reconciliation write") }
