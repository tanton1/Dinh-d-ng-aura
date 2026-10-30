'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { MAX_CONTRACT_LEDGER_ENTRIES, readContractRecognizedRevenue, readContractRecognitionState } = require('./finance-recognition-balance')

function fixture(values, state = false) {
  const query = {
    where(field, operator, value) { assert.deepEqual([field, operator, value], ['contractId', '==', 'contract-a']); return this },
    select(...fields) { assert.deepEqual(fields, ['type', 'status', 'revenueImpact', 'amount', ...(state ? ['sessionId', 'serviceOrdinal', 'reversedEntryId'] : [])]); return this },
    limit(value) { assert.equal(value, MAX_CONTRACT_LEDGER_ENTRIES + 1); return this },
  }
  const db = { collection(name) { assert.equal(name, 'ledgerEntries'); return query } }
  const transaction = { async get(value) { assert.equal(value, query); return { size: values.length, docs: values.map((row, index) => ({ id: row.id || String(index), data: () => row })) } } }
  return () => (state ? readContractRecognitionState : readContractRecognizedRevenue)(transaction, db, 'contract-a')
}

test('canonical recognized balance keeps signed corrections and excludes pending and non-revenue cash', async () => {
  const read = fixture([
    { type: 'payment', status: 'posted', amount: 900000 },
    { type: 'revenue_recognition', status: 'reversed', amount: 300000, revenueImpact: 300000 },
    { type: 'reversal', status: 'posted', amount: -300000, revenueImpact: -300000 },
    { type: 'revenue_recognition', status: 'posted', amount: 200000 },
    { type: 'adjustment', status: 'posted', amount: -50000, revenueImpact: -50000 },
    { type: 'revenue_recognition', status: 'pending', amount: 999999 },
    { type: 'revenue_recognition', status: 'void', amount: 999999 },
    { type: 'expense', status: 'posted', amount: -500000, revenueImpact: 0 },
  ])
  assert.equal(await read(), 150000)
  assert.equal(await fixture([])(), 0)
})

test('canonical recognized balance refuses truncated or malformed totals', async () => {
  await assert.rejects(fixture(Array.from({ length: MAX_CONTRACT_LEDGER_ENTRIES + 1 }, () => ({}))), error => error.code === 'resource-exhausted')
  for (const revenueImpact of ['invalid', 1.5, Infinity]) {
    await assert.rejects(fixture([{ type: 'revenue_recognition', status: 'posted', revenueImpact }]), error => error.code === 'failed-precondition')
  }
})

test('canonical identity balances net signed reversals and replacements without occupying the old session', async () => {
  const state = await fixture([
    { id: 'original', type: 'revenue_recognition', status: 'reversed', sessionId: 'old-session', serviceOrdinal: 2, amount: 100000 },
    { id: 'undo', type: 'adjustment', status: 'posted', reversedEntryId: 'original', revenueImpact: -100000 },
    { id: 'replacement', type: 'revenue_recognition', status: 'posted', sessionId: 'new-session', serviceOrdinal: 2, amount: 100000 },
    { type: 'revenue_recognition', status: 'pending', sessionId: 'pending-session', serviceOrdinal: 2, amount: 900000 },
  ], true)()
  assert.equal(state.recognizedRevenue, 100000)
  assert.equal(state.revenueBySession.get('old-session'), 0)
  assert.equal(state.revenueBySession.get('new-session'), 100000)
  assert.deepEqual([...state.revenueByOrdinal.get(2)], [['old-session', 0], ['new-session', 100000]])
  assert.equal(state.revenueBySession.has('pending-session'), false)
})

test('identity scan stays bounded and never assigns an unlinked negative adjustment to a session', async () => {
  await assert.rejects(fixture(Array.from({ length: MAX_CONTRACT_LEDGER_ENTRIES + 1 }, () => ({})), true), error => error.code === 'resource-exhausted')
  const state = await fixture([
    { type: 'revenue_recognition', status: 'posted', sessionId: 'session-a', serviceOrdinal: 1, amount: 100000 },
    { type: 'adjustment', status: 'posted', revenueImpact: -100000 },
  ], true)()
  assert.equal(state.recognizedRevenue, 0)
  assert.equal(state.revenueBySession.get('session-a'), 100000)
})
