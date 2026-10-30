export interface FinanceIntentScope {
  projectId: string
  ownerUid: string
  contractId: string
}

interface ContractMovement {
  contractId: string
  amount: number
  effectiveAt: string
  paymentMethod: string
  cashAccountId: string
  installmentId?: string
  expectedPaidAmount: number
  expectedSettlementRevision?: number
}

export type FinanceOperationDraft =
  | { type: 'payment'; payload: ContractMovement & { note?: string } }
  | { type: 'refund'; payload: ContractMovement & { reason: string } }
  | { type: 'reversal'; payload: { entryId: string; reason: string } }

export type FinanceIntentOperation = FinanceOperationDraft & { payload: { idempotencyKey: string } }
export interface FinanceIntentReceipt {
  entryId: string
  unchanged: boolean
  referenceCode?: string | null
  receiptVoucherId?: string | null
  receiptVoucherNumber?: string | null
}
export type FinanceIntentOutcome = { protocol: 1; idempotencyKey: string } & (
  | { state: 'committed'; receipt: FinanceIntentReceipt }
  | { state: 'cancelled' }
)
export interface FinanceIntentRecord {
  schemaVersion: 1
  scopeKey: string
  ownerKey: string
  scope: FinanceIntentScope
  revision: number
  createdAt: string
  operation: FinanceIntentOperation
  outcome: FinanceIntentOutcome | null
}

const databaseName = 'aura-finance-intents-v1'
const storeName = 'intents'
const changeEvent = 'aura-finance-intent-change'
const channelName = 'aura-finance-intents-v1'
const keyPattern = /^aura-finance-v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const storageMessage = 'Chưa thể lưu trạng thái yêu cầu trên thiết bị. Hãy giữ nguyên trang và kiểm tra lại trước khi tạo giao dịch mới.'

export class FinanceIntentStorageError extends Error {
  constructor(message = storageMessage) { super(message); this.name = 'FinanceIntentStorageError' }
}
export class FinanceIntentChangedError extends Error {
  constructor() { super('Yêu cầu đã thay đổi ở một tab khác. Hãy kiểm tra kết quả và mở lại biểu mẫu trước khi ghi khoản mới.'); this.name = 'FinanceIntentChangedError' }
}

function validText(value: unknown, maximum: number) {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= maximum
}
function assertScope(scope: FinanceIntentScope) {
  if (!scope || !validText(scope.projectId, 200) || !validText(scope.ownerUid, 200) || !validText(scope.contractId, 200)) throw new FinanceIntentStorageError()
}
export function financeIntentOwnerKey(scope: Pick<FinanceIntentScope, 'projectId' | 'ownerUid'>) {
  if (!validText(scope.projectId, 200) || !validText(scope.ownerUid, 200)) throw new FinanceIntentStorageError()
  return JSON.stringify([scope.projectId, scope.ownerUid])
}
export function financeIntentScopeKey(scope: FinanceIntentScope) {
  assertScope(scope)
  return JSON.stringify([scope.projectId, scope.ownerUid, scope.contractId])
}

export function assertFinanceOperationDraft(operation: FinanceOperationDraft, contractId: string) {
  const invalid = () => new Error('Thông tin giao dịch chưa hợp lệ. Hãy kiểm tra số tiền, ngày và quỹ đã chọn.')
  if (!operation || !['payment', 'refund', 'reversal'].includes(operation.type) || !operation.payload) throw invalid()
  const payload = operation.payload
  if (operation.type === 'reversal') {
    if (!('entryId' in payload) || !validText(payload.entryId, 200) || !('reason' in payload) || !validText(payload.reason, 500)) throw invalid()
    return
  }
  if (!('contractId' in payload) || payload.contractId !== contractId || !Number.isSafeInteger(payload.amount) || payload.amount <= 0 || payload.amount > 1_000_000_000
      || !Number.isSafeInteger(payload.expectedPaidAmount) || payload.expectedPaidAmount < 0 || !validText(payload.effectiveAt, 50) || !Number.isFinite(Date.parse(payload.effectiveAt))
      || !validText(payload.cashAccountId, 200) || !validText(payload.paymentMethod, 50)
      || (payload.installmentId !== undefined && !validText(payload.installmentId, 100))
      || (payload.expectedSettlementRevision !== undefined && (!Number.isSafeInteger(payload.expectedSettlementRevision) || payload.expectedSettlementRevision < 0))) throw invalid()
  if (operation.type === 'refund' && (!('reason' in payload) || !validText(payload.reason, 500))) throw invalid()
  if (operation.type === 'payment' && 'note' in payload && payload.note !== undefined && (typeof payload.note !== 'string' || payload.note.length > 500)) throw invalid()
}

export function assertFinanceIntentOutcome(value: unknown, key: string): asserts value is FinanceIntentOutcome {
  const result = value as FinanceIntentOutcome | null
  if (!result || result.protocol !== 1 || result.idempotencyKey !== key
      || !['committed', 'cancelled'].includes(result.state)
      || (result.state === 'committed' && (!validText(result.receipt?.entryId, 200) || typeof result.receipt.unchanged !== 'boolean'))) {
    throw new Error('Chưa xác định được kết quả giao dịch. Yêu cầu gốc vẫn được giữ để kiểm tra lại.')
  }
}

function recordFrom(value: unknown, scope?: FinanceIntentScope): FinanceIntentRecord | null {
  if (value === undefined) return null
  const record = value as FinanceIntentRecord
  try {
    if (!record || record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision) || record.revision < 1
        || record.scopeKey !== financeIntentScopeKey(record.scope) || record.ownerKey !== financeIntentOwnerKey(record.scope)
        || (scope && record.scopeKey !== financeIntentScopeKey(scope)) || !validText(record.createdAt, 50) || !Number.isFinite(Date.parse(record.createdAt))
        || !keyPattern.test(record.operation?.payload?.idempotencyKey || '') || record.outcome === undefined) throw new Error()
    assertFinanceOperationDraft(record.operation, record.scope.contractId)
    if (record.outcome) assertFinanceIntentOutcome(record.outcome, record.operation.payload.idempotencyKey)
    return record
  } catch { throw new FinanceIntentStorageError('Yêu cầu đã lưu trên thiết bị không đọc được. Chưa gửi giao dịch mới; cần kiểm tra lịch sử trước khi xử lý tiếp.') }
}

let opened: Promise<IDBDatabase> | null = null
function openDatabase() {
  if (opened) return opened
  opened = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false
    const fail = () => { if (!settled) { settled = true; opened = null; reject(new FinanceIntentStorageError()) } }
    try {
      if (typeof indexedDB === 'undefined') { fail(); return }
      const request = indexedDB.open(databaseName, 1)
      request.onerror = fail
      request.onblocked = fail
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(storeName, { keyPath: 'scopeKey' })
        store.createIndex('ownerKey', 'ownerKey', { unique: false })
      }
      request.onsuccess = () => {
        const db = request.result
        if (settled) { db.close(); return }
        settled = true
        db.onversionchange = () => { db.close(); opened = null }
        db.onclose = () => { opened = null }
        resolve(db)
      }
    } catch { fail() }
  })
  // A synchronous open failure must not leave a rejected singleton installed.
  void opened.catch(() => { opened = null })
  return opened
}

async function withStore<Result>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: Result) => void, fail: (cause: unknown) => void) => void): Promise<Result> {
  const db = await openDatabase()
  return new Promise<Result>((resolve, reject) => {
    let transaction: IDBTransaction, value: Result, failure: unknown
    const fail = (cause: unknown) => { failure = cause instanceof FinanceIntentStorageError || cause instanceof FinanceIntentChangedError ? cause : new FinanceIntentStorageError(); try { transaction.abort() } catch { reject(failure) } }
    try {
      transaction = db.transaction(storeName, mode)
      transaction.oncomplete = () => resolve(value)
      transaction.onerror = () => { /* onabort reports the failed transaction once. */ }
      transaction.onabort = () => reject(failure || new FinanceIntentStorageError())
      run(transaction.objectStore(storeName), result => { value = result }, fail)
    } catch (cause) { reject(cause instanceof FinanceIntentStorageError ? cause : new FinanceIntentStorageError()) }
  })
}

function changed(ownerKey: string) {
  // These notifications are hints. IndexedDB transactions are the authority;
  // neither BroadcastChannel availability nor a focused tab is a lock.
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: ownerKey }))
  try { const channel = new BroadcastChannel(channelName); channel.postMessage(ownerKey); channel.close() } catch { /* Visibility and the next transaction still reconcile state. */ }
}

export function subscribeFinanceIntentChanges(ownerKey: string, callback: () => void) {
  const local = (event: Event) => { if ((event as CustomEvent).detail === ownerKey) callback() }
  const visible = () => { if (document.visibilityState === 'visible') callback() }
  let channel: BroadcastChannel | undefined
  try { channel = new BroadcastChannel(channelName); channel.onmessage = event => { if (event.data === ownerKey) callback() } } catch { /* Storage correctness does not rely on notifications. */ }
  window.addEventListener(changeEvent, local)
  document.addEventListener('visibilitychange', visible)
  return () => { window.removeEventListener(changeEvent, local); document.removeEventListener('visibilitychange', visible); channel?.close() }
}

export async function readFinanceIntent(scope: FinanceIntentScope): Promise<FinanceIntentRecord | null> {
  const key = financeIntentScopeKey(scope)
  return withStore('readonly', (store, result, fail) => {
    const request = store.get(key)
    request.onsuccess = () => { try { result(recordFrom(request.result, scope)) } catch (cause) { fail(cause) } }
  })
}

export async function listPendingFinanceIntents(owner: Pick<FinanceIntentScope, 'projectId' | 'ownerUid'>): Promise<FinanceIntentRecord[]> {
  const key = financeIntentOwnerKey(owner)
  return withStore('readonly', (store, result, fail) => {
    const request = store.index('ownerKey').getAll(key)
    request.onsuccess = () => {
      try {
        const records = request.result.map(value => recordFrom(value)!)
        if (records.some(record => record.ownerKey !== key)) throw new FinanceIntentStorageError()
        result(records.filter(record => !record.outcome).sort((left, right) => left.createdAt.localeCompare(right.createdAt)))
      } catch (cause) { fail(cause) }
    }
  })
}

export async function beginFinanceIntent(scope: FinanceIntentScope, draft: FinanceOperationDraft, observedRevision: number): Promise<{ created: boolean; record: FinanceIntentRecord }> {
  const boundScope = { ...scope }
  const key = financeIntentScopeKey(boundScope), ownerKey = financeIntentOwnerKey(boundScope)
  assertFinanceOperationDraft(draft, boundScope.contractId)
  if (!Number.isSafeInteger(observedRevision) || observedRevision < 0) throw new FinanceIntentStorageError()
  // Copy before the asynchronous open; later form edits cannot alter the intent.
  let operation: FinanceIntentOperation
  try { operation = structuredClone({ ...draft, payload: { ...draft.payload, idempotencyKey: `aura-finance-v1:${crypto.randomUUID()}` } }) as FinanceIntentOperation }
  catch { throw new FinanceIntentStorageError() }
  const outcome = await withStore<{ created: boolean; record: FinanceIntentRecord }>('readwrite', (store, result, fail) => {
    const request = store.get(key)
    request.onsuccess = () => {
      try {
        const existing = recordFrom(request.result, boundScope)
        if (existing && !existing.outcome) { result({ created: false, record: existing }); return }
        if ((existing?.revision || 0) !== observedRevision) throw new FinanceIntentChangedError()
        const revision = observedRevision + 1
        if (!Number.isSafeInteger(revision)) throw new FinanceIntentStorageError()
        const record: FinanceIntentRecord = { schemaVersion: 1, scopeKey: key, ownerKey, scope: boundScope, revision, createdAt: new Date().toISOString(), operation, outcome: null }
        store.put(record)
        result({ created: true, record })
      } catch (cause) { fail(cause) }
    }
  })
  if (outcome.created) changed(ownerKey)
  return outcome
}

export async function settleFinanceIntent(scope: FinanceIntentScope, key: string, outcome: FinanceIntentOutcome): Promise<FinanceIntentRecord> {
  const scopeKey = financeIntentScopeKey(scope)
  assertFinanceIntentOutcome(outcome, key)
  const snapshot = structuredClone(outcome)
  const record = await withStore<FinanceIntentRecord>('readwrite', (store, result, fail) => {
    const request = store.get(scopeKey)
    request.onsuccess = () => {
      try {
        const existing = recordFrom(request.result, scope)
        if (!existing || existing.operation.payload.idempotencyKey !== key) throw new FinanceIntentChangedError()
        if (existing.outcome) {
          if (existing.outcome.state !== outcome.state || (existing.outcome.state === 'committed' && outcome.state === 'committed' && existing.outcome.receipt.entryId !== outcome.receipt.entryId)) throw new FinanceIntentChangedError()
          result(existing); return
        }
        const next = { ...existing, revision: existing.revision + 1, outcome: snapshot }
        if (!Number.isSafeInteger(next.revision)) throw new FinanceIntentStorageError()
        store.put(next)
        result(next)
      } catch (cause) { fail(cause) }
    }
  })
  changed(record.ownerKey)
  return record
}
