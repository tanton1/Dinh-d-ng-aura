'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { parseArguments, selectIndexes, signature, CONFIRMATION } = require('./firebase-firestore-index-deploy.cjs')
const indexes = require('../firestore.indexes.json').indexes

test('progress scope selects only the six owner collection date indexes, with exact tie-break direction', () => {
  const selected = selectIndexes(indexes, 'student-progress-reads')
  assert.deepEqual(selected.map(index => index.collectionGroup), ['bodyMetrics', 'bodyMeasurements', 'weightLogs', 'progressCheckIns', 'progress_photos', 'progressPhotos'])
  for (const index of selected) {
    assert.equal(index.queryScope, 'COLLECTION')
    assert.deepEqual(index.fields, [{ fieldPath: 'date', order: 'DESCENDING' }, { fieldPath: '__name__', order: 'DESCENDING' }])
    assert.throws(() => selectIndexes(indexes.filter(value => value !== index), 'student-progress-reads'), /exactly once/)
    assert.throws(() => selectIndexes([...indexes, index], 'student-progress-reads'), /exactly once/)
    for (const invalid of [
      { ...index, queryScope: 'COLLECTION_GROUP' },
      { ...index, fields: [{ fieldPath: 'date', order: 'ASCENDING' }, index.fields[1]] },
      { ...index, fields: [index.fields[0], { fieldPath: '__name__', order: 'ASCENDING' }] },
    ]) assert.throws(() => selectIndexes(indexes.map(value => value === index ? invalid : value), 'student-progress-reads'), /exactly once/)
  }
  assert.deepEqual(parseArguments(['dry-run', '--scope=student-progress-reads']), { mode: 'dry-run', scope: 'student-progress-reads' })
  assert.deepEqual(parseArguments(['apply', '--scope=student-progress-reads', `--confirm=${CONFIRMATION}`]), { mode: 'apply', scope: 'student-progress-reads' })
  assert.throws(() => parseArguments(['apply', '--scope=student-progress-reads']), /confirmation/)
})

test('ledger date scope creates only the ordered range index and requires the exact production target', () => {
  const selected = selectIndexes(indexes, 'ledger-date-range')
  assert.deepEqual(selected, [{ collectionGroup: 'ledgerEntries', queryScope: 'COLLECTION', fields: [
    { fieldPath: 'effectiveAt', order: 'DESCENDING' }, { fieldPath: '__name__', order: 'DESCENDING' },
  ] }])
  assert.throws(() => selectIndexes([], 'ledger-date-range'), /exactly once/)
  assert.throws(() => selectIndexes([...selected, ...selected], 'ledger-date-range'), /exactly once/)
  assert.deepEqual(parseArguments(['apply', `--confirm=${CONFIRMATION}`, '--scope=ledger-date-range']), { mode: 'apply', scope: 'ledger-date-range' })
  assert.throws(() => parseArguments(['apply', '--scope=ledger-date-range']), /confirmation/)
})

test('dashboard scope selects exactly its two approved indexes and rejects absent or duplicated definitions', () => {
  const wanted = [
    { collectionGroup: 'attendanceEvents', queryScope: 'COLLECTION', fields: [
      { fieldPath: 'branchId', order: 'ASCENDING' }, { fieldPath: 'occurredAt', order: 'ASCENDING' },
    ] },
    { collectionGroup: 'sessionRequests', queryScope: 'COLLECTION', fields: [
      { fieldPath: 'trainerId', order: 'ASCENDING' }, { fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'requestedBy', order: 'ASCENDING' },
    ] },
  ]
  const selected = selectIndexes(indexes, 'dashboard-reads')
  assert.deepEqual(selected.map(signature), wanted.map(signature))
  assert.equal(selected.length, 2, 'unrelated indexes cannot enter the create-only dashboard deployment')
  for (let index = 0; index < wanted.length; index += 1) {
    assert.throws(() => selectIndexes(selected.filter((_, position) => position !== index), 'dashboard-reads'), /exactly once/)
    assert.throws(() => selectIndexes([...selected, selected[index]], 'dashboard-reads'), /exactly once/)
    const wrongDirection = wanted.map((candidate, position) => position === index
      ? { ...candidate, fields: candidate.fields.map((field, fieldIndex) => fieldIndex === candidate.fields.length - 1 ? { ...field, order: 'DESCENDING' } : field) }
      : candidate)
    assert.throws(() => selectIndexes(wrongDirection, 'dashboard-reads'), /exactly once/)
  }
  assert.deepEqual(parseArguments(['dry-run', '--scope=dashboard-reads']), { mode: 'dry-run', scope: 'dashboard-reads' })
  assert.deepEqual(parseArguments(['apply', '--scope=dashboard-reads', `--confirm=${CONFIRMATION}`]), { mode: 'apply', scope: 'dashboard-reads' })
  assert.throws(() => parseArguments(['apply', '--scope=dashboard-reads']), /confirmation/)
  assert.throws(() => parseArguments(['help']), /--scope=dashboard-reads/)
})

test('loyalty scope selects exactly the approved branch and document-ID index', () => {
  const selected = selectIndexes(indexes, 'loyalty-account-reads')
  assert.deepEqual(selected, [{ collectionGroup: 'students', queryScope: 'COLLECTION', fields: [
    { fieldPath: 'branchId', order: 'ASCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' },
  ] }])
  assert.throws(() => selectIndexes([], 'loyalty-account-reads'), /exactly once/)
  assert.throws(() => selectIndexes([...selected, ...selected], 'loyalty-account-reads'), /exactly once/)
  assert.deepEqual(parseArguments(['apply', `--confirm=${CONFIRMATION}`, '--scope=loyalty-account-reads']), { mode: 'apply', scope: 'loyalty-account-reads' })
  assert.throws(() => parseArguments(['apply', '--scope=loyalty-account-reads']), /confirmation/)
})

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
