import { expect, test } from '@playwright/test'

const url = '/tests/finance-history-ui/index.html?workspace=store'
const scope = { projectId: 'synthetic-project', ownerUid: 'synthetic-owner', contractId: 'synthetic-contract' }
const draft = { type: 'payment', payload: { contractId: scope.contractId, amount: 100_000, effectiveAt: '2026-10-25T12:00:00Z', paymentMethod: 'transfer', cashAccountId: 'synthetic-cash', expectedPaidAmount: 200_000, note: 'Synthetic payment' } }

test.beforeEach(async ({ page }) => {
  await page.goto(url)
  await page.waitForFunction(() => Boolean((window as any).financeIntentStore))
})

test('settlement revision survives durable storage and rejects invalid revision before saving', async ({ page }) => {
  const record = await page.evaluate(async ({ scope, draft }) => {
    const api = (window as any).financeIntentStore
    const invalid = [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]
    for (const revision of invalid) {
      let rejected = false
      try { await api.beginFinanceIntent(scope, { ...draft, payload: { ...draft.payload, expectedSettlementRevision: revision } }, 0) } catch { rejected = true }
      if (!rejected) throw Error('Invalid settlement revision accepted')
    }
    return api.beginFinanceIntent(scope, { ...draft, payload: { ...draft.payload, expectedSettlementRevision: 7 } }, 0)
  }, { scope, draft })
  await page.reload()
  const recovered = await page.evaluate(async scope => (window as any).financeIntentStore.readFinanceIntent(scope), scope)
  expect(recovered.operation).toEqual(record.record.operation)
  expect(recovered.operation.payload.expectedSettlementRevision).toBe(7)
})

test('reload recovers the immutable original request and isolates owners and projects', async ({ page }) => {
  const original = await page.evaluate(async ({ scope, draft }) => {
    const api = (window as any).financeIntentStore
    const pending = api.beginFinanceIntent(scope, draft, 0)
    draft.payload.amount = 900_000
    return pending
  }, { scope, draft })
  expect(original.created).toBe(true)
  expect(original.record.operation.payload.amount).toBe(100_000)
  await page.reload()
  const state = await page.evaluate(async scope => {
    const api = (window as any).financeIntentStore
    return { current: await api.readFinanceIntent(scope), owner: await api.readFinanceIntent({ ...scope, ownerUid: 'different' }), project: await api.readFinanceIntent({ ...scope, projectId: 'different' }), pending: await api.listPendingFinanceIntents(scope) }
  }, scope)
  expect(state.current).toEqual(original.record)
  expect(state.owner).toBeNull()
  expect(state.project).toBeNull()
  expect(state.pending).toEqual([original.record])
})

test('two tabs atomically keep one pending intent even when their forms differ', async ({ page, context }) => {
  const other = await context.newPage()
  await other.goto(url)
  const [first, second] = await Promise.all([page.evaluate(async ({ scope, draft }) => (window as any).financeIntentStore.beginFinanceIntent(scope, draft, 0), { scope, draft }), other.evaluate(async ({ scope, draft }) => (window as any).financeIntentStore.beginFinanceIntent(scope, { ...draft, payload: { ...draft.payload, amount: 200_000 } }, 0), { scope, draft })])
  expect([first, second].filter(result => result.created)).toHaveLength(1)
  expect(first.record).toEqual(second.record)
  const recovered = await other.evaluate(async scope => (window as any).financeIntentStore.readFinanceIntent(scope), scope)
  expect(recovered).toEqual(first.record)
})

test('a stale second tab cannot create a new key after the first result was acknowledged', async ({ page, context }) => {
  const other = await context.newPage()
  await other.goto(url)
  expect(await other.evaluate(async scope => (window as any).financeIntentStore.readFinanceIntent(scope), scope)).toBeNull()
  const settled = await page.evaluate(async ({ scope, draft }) => {
    const api = (window as any).financeIntentStore
    const { record } = await api.beginFinanceIntent(scope, draft, 0)
    return api.settleFinanceIntent(scope, record.operation.payload.idempotencyKey, { protocol: 1, idempotencyKey: record.operation.payload.idempotencyKey, state: 'committed', receipt: { entryId: 'synthetic-entry', unchanged: false } })
  }, { scope, draft })
  const stale = await other.evaluate(async ({ scope, draft }) => {
    try { await (window as any).financeIntentStore.beginFinanceIntent(scope, draft, 0); return 'incorrectly-created' }
    catch (error) { return (error as Error).name }
  }, { scope, draft })
  expect(stale).toBe('FinanceIntentChangedError')
  const next = await other.evaluate(async ({ scope, draft, revision }) => (window as any).financeIntentStore.beginFinanceIntent(scope, draft, revision), { scope, draft, revision: settled.revision })
  expect(next.created).toBe(true)
  expect(next.record.operation.payload.idempotencyKey).not.toBe(settled.operation.payload.idempotencyKey)
  const late = await page.evaluate(async ({ scope, settled }) => {
    try { await (window as any).financeIntentStore.settleFinanceIntent(scope, settled.operation.payload.idempotencyKey, settled.outcome); return 'overwrote' }
    catch (error) { return (error as Error).name }
  }, { scope, settled })
  expect(late).toBe('FinanceIntentChangedError')
})

test('failed acknowledgement keeps the original pending request for recovery', async ({ page }) => {
  const result = await page.evaluate(async ({ scope, draft }) => {
    const api = (window as any).financeIntentStore
    const { record } = await api.beginFinanceIntent(scope, draft, 0)
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () { throw new DOMException('Synthetic storage full', 'QuotaExceededError') }
    let failed = false
    try { await api.settleFinanceIntent(scope, record.operation.payload.idempotencyKey, { protocol: 1, idempotencyKey: record.operation.payload.idempotencyKey, state: 'cancelled' }) }
    catch { failed = true }
    finally { IDBObjectStore.prototype.put = put }
    return { failed, before: record, after: await api.readFinanceIntent(scope) }
  }, { scope, draft })
  expect(result.failed).toBe(true)
  expect(result.after).toEqual(result.before)
  expect(result.after.outcome).toBeNull()
})

test('failed initial storage write never creates an in-memory fallback request', async ({ page }) => {
  const result = await page.evaluate(async ({ scope, draft }) => {
    const api = (window as any).financeIntentStore, put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () { throw new DOMException('Synthetic storage full', 'QuotaExceededError') }
    let failed = false
    try { await api.beginFinanceIntent(scope, draft, 0) } catch { failed = true }
    finally { IDBObjectStore.prototype.put = put }
    return { failed, record: await api.readFinanceIntent(scope) }
  }, { scope, draft })
  expect(result).toEqual({ failed: true, record: null })
})

test('corrupted persisted data fails closed without replacing its identity', async ({ page }) => {
  const result = await page.evaluate(async ({ scope, draft }) => {
    const api = (window as any).financeIntentStore
    const { record } = await api.beginFinanceIntent(scope, draft, 0)
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('aura-finance-intents-v1', 1)
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction('intents', 'readwrite')
        transaction.objectStore('intents').put({ ...record, outcome: { state: 'committed' } })
        transaction.oncomplete = () => { db.close(); resolve() }
        transaction.onabort = () => { db.close(); reject(transaction.error) }
      }
    })
    const failures = []
    for (const action of [() => api.readFinanceIntent(scope), () => api.beginFinanceIntent(scope, draft, 0), () => api.listPendingFinanceIntents(scope)]) {
      try { await action(); failures.push('accepted') } catch (error) { failures.push((error as Error).name) }
    }
    return failures
  }, { scope, draft })
  expect(result).toEqual(['FinanceIntentStorageError', 'FinanceIntentStorageError', 'FinanceIntentStorageError'])
})

test('storage denial remains recoverable when browser storage becomes available', async ({ page }) => {
  const result = await page.evaluate(async ({ scope, draft }) => {
    const api = (window as any).financeIntentStore, original = indexedDB.open.bind(indexedDB)
    indexedDB.open = () => { throw new DOMException('Synthetic denial', 'SecurityError') }
    let failed = false
    try { await api.beginFinanceIntent(scope, draft, 0) } catch { failed = true }
    finally { indexedDB.open = original }
    const record = await api.readFinanceIntent(scope)
    return { failed, record }
  }, { scope, draft })
  expect(result).toEqual({ failed: true, record: null })
})

test('repeated acknowledgements are idempotent and contradictory outcomes are refused', async ({ page }) => {
  const result = await page.evaluate(async ({ scope, draft }) => {
    const api = (window as any).financeIntentStore, { record } = await api.beginFinanceIntent(scope, draft, 0)
    const key = record.operation.payload.idempotencyKey, outcome = { protocol: 1, idempotencyKey: key, state: 'cancelled' }
    const first = await api.settleFinanceIntent(scope, key, outcome), second = await api.settleFinanceIntent(scope, key, outcome)
    let rejected = false
    try { await api.settleFinanceIntent(scope, key, { protocol: 1, idempotencyKey: key, state: 'committed', receipt: { entryId: 'conflicting', unchanged: false } }) } catch { rejected = true }
    return { first, second, rejected, pending: await api.listPendingFinanceIntents(scope) }
  }, { scope, draft })
  expect(result.first).toEqual(result.second)
  expect(result.rejected).toBe(true)
  expect(result.pending).toEqual([])
})

test('missing or mismatched server receipts never clear the pending operation', async ({ page }) => {
  const result = await page.evaluate(async ({ scope, draft }) => {
    const api = (window as any).financeIntentStore, { record } = await api.beginFinanceIntent(scope, draft, 0)
    let failures = 0
    for (const outcome of [{ protocol: 1, idempotencyKey: record.operation.payload.idempotencyKey, state: 'committed' }, { protocol: 1, idempotencyKey: 'different', state: 'cancelled' }, { protocol: 2, idempotencyKey: record.operation.payload.idempotencyKey, state: 'cancelled' }]) {
      try { await api.settleFinanceIntent(scope, record.operation.payload.idempotencyKey, outcome) } catch { failures++ }
    }
    return { failures, pending: (await api.readFinanceIntent(scope)).outcome }
  }, { scope, draft })
  expect(result).toEqual({ failures: 3, pending: null })
})

test('same-owner tabs receive local notifications without publishing the payment payload', async ({ page, context }) => {
  const other = await context.newPage()
  await other.goto(url)
  await other.evaluate(scope => {
    const api = (window as any).financeIntentStore
    Object.assign(window, { intentNotifications: 0, otherOwnerNotifications: 0 })
    api.subscribeFinanceIntentChanges(api.financeIntentOwnerKey(scope), () => { (window as any).intentNotifications++ })
    api.subscribeFinanceIntentChanges(api.financeIntentOwnerKey({ ...scope, ownerUid: 'different' }), () => { (window as any).otherOwnerNotifications++ })
  }, scope)
  await page.evaluate(async ({ scope, draft }) => (window as any).financeIntentStore.beginFinanceIntent(scope, draft, 0), { scope, draft })
  await expect.poll(() => other.evaluate(() => (window as any).intentNotifications)).toBeGreaterThan(0)
  expect(await other.evaluate(() => (window as any).otherOwnerNotifications)).toBe(0)
})
