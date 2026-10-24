'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { parseArguments, selectIndexes, signature, CONFIRMATION } = require('./firebase-firestore-index-deploy.cjs')
const indexes = require('../firestore.indexes.json').indexes

test('finance scope selects exactly three approved indexes, not unrelated missing indexes', () => {
  const selected = selectIndexes(indexes, 'finance-ledger-reads')
  assert.equal(selected.length, 3)
  assert.deepEqual(selected.map((index) => index.fields[0].fieldPath), ['branchId', 'type', 'status'])
  assert(selected.every((index) => index.collectionGroup === 'ledgerEntries' && index.queryScope === 'COLLECTION'))
  assert.throws(() => selectIndexes(selected.slice(1), 'finance-ledger-reads'), /exactly once/)
  assert.throws(() => selectIndexes([...selected, selected[0]], 'finance-ledger-reads'), /exactly once/)
  assert.equal(selectIndexes(indexes, 'all'), indexes)
})

test('target confirmation and exact scope required before production apply', () => {
  assert.deepEqual(parseArguments(['dry-run', '--scope=finance-ledger-reads']), { mode: 'dry-run', scope: 'finance-ledger-reads' })
  assert.deepEqual(parseArguments(['apply', `--confirm=${CONFIRMATION}`, '--scope=finance-ledger-reads']), { mode: 'apply', scope: 'finance-ledger-reads' })
  assert.throws(() => parseArguments(['apply', '--scope=finance-ledger-reads']), /confirmation/)
  assert.throws(() => parseArguments(['dry-run', '--scope=ledger']), /Unknown/)
  assert.throws(() => parseArguments(['dry-run', '--project=other']), /Usage/)
})

test('explicit cursor direction must match, implicit Firestore default is equivalent', () => {
  const selected = selectIndexes(indexes, 'finance-ledger-reads')[0]
  const implicit = { ...selected, fields: selected.fields.slice(0, -1) }
  assert.equal(signature(implicit), signature(selected))
  const opposite = { ...selected, fields: [...implicit.fields, { fieldPath: '__name__', order: 'ASCENDING' }] }
  assert.notEqual(signature(opposite), signature(selected))
})
