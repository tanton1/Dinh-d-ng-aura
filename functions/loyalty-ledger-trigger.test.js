'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Timestamp } = require('firebase-admin/firestore')
const { reconcileLoyaltyLedgerWrite, affectedLoyaltyContractIds } = require('./loyalty-ledger-trigger')

const payment = Object.freeze({
  id: 'payment-one', type: 'payment', status: 'posted', contractId: 'contract-one',
  studentId: 'student-one', branchId: 'branch-one', amount: 100000, cashImpact: 100000,
  effectiveAt: new Timestamp(1790000000, 123456789), createdAt: new Timestamp(1789999999, 1),
  reversedEntryId: '', paymentMethod: 'cash', note: 'original',
})
const snapshot = value => ({ exists: value !== null, data: () => value === null ? undefined : value })
const event = (before, after) => ({ params: { entryId: 'entry-one' }, data: { before: snapshot(before), after: snapshot(after) } })
const quiet = { info() {} }

function noDatabaseWork() {
  let accesses = 0
  return {
    db: new Proxy({}, { get(_target, key) { accesses += 1; throw new Error(`Unexpected Firestore access: ${String(key)}`) } }),
    count: () => accesses,
  }
}

function recordingReconcilers() {
  const calls = []
  const db = Object.freeze({ marker: 'same-live-db' })
  const reconcileSpend = async input => {
    assert.equal(input.db, db)
    assert.equal(input.logger, quiet)
    assert.deepEqual(Object.keys(input).sort(), ['contractId', 'db', 'logger'])
    calls.push(`spend:${input.contractId}`)
    await Promise.resolve()
    return { lane: 'spend', contractId: input.contractId }
  }
  const reconcileReferral = async input => {
    assert.equal(input.db, db)
    assert.equal(input.logger, quiet)
    assert.deepEqual(Object.keys(input).sort(), ['contractId', 'db', 'logger'])
    calls.push(`referral:${input.contractId}`)
    return { lane: 'referral', contractId: input.contractId }
  }
  return { db, logger: quiet, reconcileSpend, reconcileReferral, calls }
}

test('real default reconcilers perform zero Firestore reads/writes for audit-only changes', async () => {
  const trap = noDatabaseWork()
  for (const type of ['payment', 'refund', 'reversal']) {
    const before = { ...payment, type, updatedAt: new Timestamp(10, 1), updatedBy: 'old' }
    const after = { ...before, updatedAt: new Timestamp(20, 2), updatedBy: 'new' }
    assert.equal(await reconcileLoyaltyLedgerWrite({ db: trap.db, event: event(before, after) }), null)
    assert.equal(await reconcileLoyaltyLedgerWrite({ db: trap.db, event: event(after, { ...payment, type }) }), null)
  }
  assert.equal(trap.count(), 0)
})

test('deeply equal reordered data and equal timestamp instances are a zero-read no-op', async () => {
  const trap = noDatabaseWork()
  const before = { ...payment, evidence: { currency: 'VND', details: ['one', 'two'] } }
  const after = { evidence: { details: ['one', 'two'], currency: 'VND' }, ...payment, effectiveAt: new Timestamp(1790000000, 123456789) }
  assert.equal(await reconcileLoyaltyLedgerWrite({ db: trap.db, event: event(before, after) }), null)
  assert.equal(trap.count(), 0)
})

test('irrelevant types, missing contract links and confirmed absent documents do no Firestore work', async () => {
  const trap = noDatabaseWork()
  for (const [before, after] of [
    [null, null], [null, { type: 'expense', contractId: 'contract-one' }],
    [{ type: 'revenue', contractId: 'contract-one', amount: 1 }, { type: 'revenue', contractId: 'contract-two', amount: 2 }],
    [null, { ...payment, contractId: null }], [{ ...payment, contractId: '' }, null],
  ]) assert.equal(await reconcileLoyaltyLedgerWrite({ db: trap.db, event: event(before, after) }), null)
  assert.equal(trap.count(), 0)
})

for (const [field, changed] of Object.entries({
  id: 'changed-stored-id', amount: 200000, cashImpact: 0, status: 'reversed', studentId: 'student-two',
  branchId: 'branch-two', reversedEntryId: 'another-payment', paymentMethod: 'bank_transfer',
  effectiveAt: new Timestamp(1790000000, 123456790), createdAt: new Timestamp(1789999999, 2),
  note: 'changed business annotation', description: 'new annotation', refundAllocation: { paymentId: 'payment-two', amount: 500 },
  unknownFutureFinanceField: { value: 7 }, metadata: { updatedAt: new Timestamp(1, 1) },
})) {
  test(`${field} change is never mistaken for audit-only metadata`, async () => {
    const deps = recordingReconcilers()
    const result = await reconcileLoyaltyLedgerWrite({ ...deps, event: event(payment, { ...payment, [field]: changed, updatedAt: new Timestamp(100, 1) }) })
    assert.deepEqual(deps.calls, ['spend:contract-one', 'referral:contract-one'])
    assert.deepEqual(result, { spend: { lane: 'spend', contractId: 'contract-one' }, referral: { lane: 'referral', contractId: 'contract-one' } })
  })
}

for (const type of ['payment', 'refund', 'reversal']) {
  test(`${type} creation and deletion dispatch the exact affected contract`, async () => {
    const row = { ...payment, type }
    for (const change of [event(null, row), event(row, null)]) {
      const deps = recordingReconcilers()
      await reconcileLoyaltyLedgerWrite({ ...deps, event: change })
      assert.deepEqual(deps.calls, ['spend:contract-one', 'referral:contract-one'])
    }
  })
}

test('contract reassignment reconciles old then new without parallelizing financial writers', async () => {
  const deps = recordingReconcilers()
  const result = await reconcileLoyaltyLedgerWrite({ ...deps, event: event(payment, { ...payment, contractId: 'contract-two', studentId: 'student-two' }) })
  assert.deepEqual(deps.calls, ['spend:contract-one', 'referral:contract-one', 'spend:contract-two', 'referral:contract-two'])
  assert.deepEqual(result.contracts.map(item => item.contractId), ['contract-one', 'contract-two'])
  assert.equal(result.contracts[0].spend.contractId, 'contract-one')
  assert.equal(result.contracts[1].referral.contractId, 'contract-two')
})

test('removing a contract link still dispatches the previous contract', async () => {
  const deps = recordingReconcilers()
  const after = { ...payment }
  delete after.contractId
  await reconcileLoyaltyLedgerWrite({ ...deps, event: event(payment, after) })
  assert.deepEqual(deps.calls, ['spend:contract-one', 'referral:contract-one'])
})

test('financial type transitions consider both snapshots rather than after.type || before.type', async () => {
  for (const [before, after, expected] of [
    [payment, { ...payment, type: 'expense', contractId: 'contract-two' }, ['contract-one']],
    [{ ...payment, type: 'expense' }, { ...payment, type: 'refund', contractId: 'contract-two' }, ['contract-two']],
    [payment, { ...payment, type: 'reversal' }, ['contract-one']],
  ]) {
    const deps = recordingReconcilers()
    await reconcileLoyaltyLedgerWrite({ ...deps, event: event(before, after) })
    assert.deepEqual(deps.calls, expected.flatMap(id => [`spend:${id}`, `referral:${id}`]))
  }
})

test('unknown event evidence fails explicitly rather than claiming a safe no-op or deletion', async () => {
  const trap = noDatabaseWork()
  const deps = recordingReconcilers()
  for (const incomplete of [
    undefined, {}, { data: {} }, { data: { before: snapshot(payment) } }, { data: { after: snapshot(payment) } },
    { data: { before: { data: () => payment }, after: snapshot(payment) } },
    { data: { before: snapshot(payment), after: { exists: true } } },
    { data: { before: snapshot(payment), after: { exists: true, data: () => undefined } } },
  ]) await assert.rejects(() => reconcileLoyaltyLedgerWrite({ ...deps, db: trap.db, event: incomplete }), /snapshot|evidence/)
  assert.equal(trap.count(), 0)
  assert.deepEqual(deps.calls, [])
})

test('unreadable snapshot exceptions and financial reconciler failures are not swallowed', async () => {
  const readFailure = new Error('snapshot decoder failed')
  await assert.rejects(() => reconcileLoyaltyLedgerWrite({ event: { data: { before: { exists: true, data() { throw readFailure } }, after: snapshot(payment) } } }), error => error === readFailure)
  const deps = recordingReconcilers()
  const spendFailure = new Error('financial transaction failed')
  await assert.rejects(() => reconcileLoyaltyLedgerWrite({ ...deps, event: event(null, payment), reconcileSpend: async () => { throw spendFailure } }), error => error === spendFailure)
  assert.deepEqual(deps.calls, [])
})

test('duplicate deliveries are not cached across invocations and do not claim cross-region safety', async () => {
  const deps = recordingReconcilers()
  const change = event(payment, { ...payment, amount: 200000 })
  await reconcileLoyaltyLedgerWrite({ ...deps, event: change })
  await reconcileLoyaltyLedgerWrite({ ...deps, event: change })
  assert.deepEqual(deps.calls, ['spend:contract-one', 'referral:contract-one', 'spend:contract-one', 'referral:contract-one'])
})

test('default production reconcilers retain live reads and old return shape for a relevant event', async () => {
  const reads = []
  const db = {
    doc(path) { return { async get() { reads.push(`doc:${path}`); return { exists: false } } } },
    collection(path) { return { where(field, op, value) {
      assert.deepEqual([path, field, op, value], ['ledgerEntries', 'contractId', '==', 'contract-one'])
      return { limit(count) { assert.equal(count, 500); return { async get() { reads.push(`query:${path}`); return { docs: [] } } } } }
    } } },
  }
  const result = await reconcileLoyaltyLedgerWrite({ db, logger: quiet, event: event(payment, { ...payment, amount: 200000 }) })
  assert.deepEqual(result, { spend: { changed: 0, skipped: 'missing_contract' }, referral: { changed: false, skipped: 'missing_contract' } })
  assert.deepEqual(reads, ['doc:contracts/contract-one', 'query:ledgerEntries', 'doc:contracts/contract-one'])
})

test('contract IDs are deduplicated without rewriting valid legacy string IDs', () => {
  assert.deepEqual(affectedLoyaltyContractIds(payment, { ...payment, type: 'refund' }), ['contract-one'])
  assert.deepEqual(affectedLoyaltyContractIds({ ...payment, contractId: ' contract-one ' }, null), [' contract-one '])
  assert.throws(() => affectedLoyaltyContractIds({ ...payment, contractId: { id: 'contract-one' } }, null), /must be a string/)
})
