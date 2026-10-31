'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { parseArguments, selectIndexes, signature, indexMatches, CONFIRMATION } = require('./firebase-firestore-index-deploy.cjs')
const indexes = require('../firestore.indexes.json').indexes

test('Graphify fixes deploy only the reviewed manifest, rejecting absent and duplicate entries', () => {
  const approved = require('../ops/graphify-fixes-indexes-20261030.json').indexes
  const selected = selectIndexes(indexes, 'graphify-fixes')
  assert.deepEqual(selected.map(signature), approved.map(signature))
  assert.equal(selected.filter(index => index.collectionGroup === 'loyaltyMemberDirectory').length, 8)
  assert.throws(() => selectIndexes([...indexes, selected[0]], 'graphify-fixes'), /exactly once/)
  assert.throws(() => selectIndexes(indexes.filter(index => signature(index) !== signature(selected[0])), 'graphify-fixes'), /exactly once/)
  assert.throws(() => parseArguments(['apply', '--scope=graphify-fixes']), /confirmation/)
})

test('CPU background scope selects only the two due queues with explicit Enterprise cursor ordering', () => {
  const expected = [
    { collectionGroup: 'subjects', queryScope: 'COLLECTION', fields: [
      { fieldPath: 'dueAt', order: 'ASCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' },
    ] },
    { collectionGroup: 'staffOperationalSummaries', queryScope: 'COLLECTION', fields: [
      { fieldPath: 'nextReconcileAt', order: 'ASCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' },
    ] },
  ]
  const selected = selectIndexes(indexes, 'cpu-background')
  assert.deepEqual(selected, expected, 'unrelated missing indexes cannot enter this deployment')
  for (const index of selected) {
    const replace = (invalid) => indexes.map(value => value === index ? invalid : value)
    assert.throws(() => selectIndexes(indexes.filter(value => value !== index), 'cpu-background'), /exactly once/)
    assert.throws(() => selectIndexes([...indexes, index], 'cpu-background'), /exactly once/)
    for (const invalid of [
      { ...index, queryScope: 'COLLECTION_GROUP' },
      { ...index, fields: [index.fields[0]] },
      { ...index, fields: [{ ...index.fields[0], order: 'DESCENDING' }, index.fields[1]] },
      { ...index, fields: [index.fields[0], { fieldPath: '__name__', order: 'DESCENDING' }] },
      { ...index, fields: [...index.fields].reverse() },
    ]) assert.throws(() => selectIndexes(replace(invalid), 'cpu-background'), /exactly once/)
    assert.equal(indexMatches(index, { ...index, fields: [index.fields[0]] }), false)
  }
})

test('CPU background dry-run remains read-only and apply keeps the exact target confirmation', () => {
  assert.deepEqual(parseArguments(['dry-run', '--scope=cpu-background']), { mode: 'dry-run', scope: 'cpu-background' })
  assert.deepEqual(parseArguments(['apply', '--scope=cpu-background', `--confirm=${CONFIRMATION}`]), { mode: 'apply', scope: 'cpu-background' })
  assert.throws(() => parseArguments(['apply', '--scope=cpu-background']), /confirmation/)
  assert.throws(() => parseArguments(['apply', '--scope=cpu-background', '--confirm=other-project']), /confirmation/)
  assert.throws(() => parseArguments(['dry-run', '--scope=cpu-background', '--project=other-project']), /Usage/)
  assert.throws(() => parseArguments(['help']), /--scope=cpu-background/)
})

test('contract sales scope selects only global/branch date and coverage indexes', () => {
  const selected = selectIndexes(indexes, 'contract-sales-range')
  assert.equal(selected.length, 4)
  assert(selected.every(index => index.collectionGroup === 'contracts' && index.queryScope === 'COLLECTION'))
  assert.deepEqual(parseArguments(['dry-run', '--scope=contract-sales-range']), { mode: 'dry-run', scope: 'contract-sales-range' })
  assert.throws(() => parseArguments(['apply', '--scope=contract-sales-range']), /confirmation/)
  for (const index of selected) {
    assert.throws(() => selectIndexes(indexes.filter(value => value !== index), 'contract-sales-range'), /exactly once/)
    assert.throws(() => selectIndexes([...indexes, index], 'contract-sales-range'), /exactly once/)
  }
})

test('business report scope reuses ledger/attendance indexes and creates only branch cash range', () => {
  const selected = selectIndexes(indexes, 'business-report-branch-reads')
  assert.deepEqual(selected.map(index => index.collectionGroup), ['ledgerEntries', 'cashTransactions', 'attendanceEvents'])
  assert.deepEqual(selected.map(index => index.fields[1].order), ['DESCENDING', 'DESCENDING', 'ASCENDING'])
  for (const index of selected) {
    assert.equal(index.fields[0].fieldPath, 'branchId')
    assert.equal(index.queryScope, 'COLLECTION')
    assert.throws(() => selectIndexes(indexes.filter(value => value !== index), 'business-report-branch-reads'), /exactly once/)
    assert.throws(() => selectIndexes([...indexes, index], 'business-report-branch-reads'), /exactly once/)
    assert.throws(() => selectIndexes(indexes.map(value => value === index ? { ...value, queryScope: 'COLLECTION_GROUP' } : value), 'business-report-branch-reads'), /exactly once/)
  }
  assert.deepEqual(parseArguments(['dry-run', '--scope=business-report-branch-reads']), { mode: 'dry-run', scope: 'business-report-branch-reads' })
  assert.throws(() => parseArguments(['apply', '--scope=business-report-branch-reads']), /confirmation/)
})

test('users role scope selects the ordered collection index and requires exact production confirmation', () => {
  const [index] = selectIndexes(indexes, 'users-role-reads')
  assert.deepEqual(index, { collectionGroup: 'users', queryScope: 'COLLECTION', fields: [
    { fieldPath: 'role', order: 'ASCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' },
  ] })
  assert.equal(selectIndexes(indexes, 'users-role-reads').length, 1)
  assert.throws(() => selectIndexes([], 'users-role-reads'), /exactly once/)
  assert.throws(() => selectIndexes([index, index], 'users-role-reads'), /exactly once/)
  for (const invalid of [
    { ...index, collectionGroup: 'students' },
    { ...index, queryScope: 'COLLECTION_GROUP' },
    { ...index, fields: [{ fieldPath: 'role', order: 'DESCENDING' }, index.fields[1]] },
    { ...index, fields: [index.fields[0], { fieldPath: '__name__', order: 'DESCENDING' }] },
  ]) assert.throws(() => selectIndexes([invalid], 'users-role-reads'), /exactly once/)
  assert.deepEqual(parseArguments(['dry-run', '--scope=users-role-reads']), { mode: 'dry-run', scope: 'users-role-reads' })
  assert.deepEqual(parseArguments(['apply', '--scope=users-role-reads', `--confirm=${CONFIRMATION}`]), { mode: 'apply', scope: 'users-role-reads' })
  assert.throws(() => parseArguments(['apply', '--scope=users-role-reads']), /confirmation/)
  assert.throws(() => parseArguments(['apply', '--scope=users-role-reads', '--confirm=other-project']), /confirmation/)
})

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

test('desired signatures retain shorthand compatibility while live explicit cursor matching is strict', () => {
  const selected = selectIndexes(indexes, 'finance-ledger-reads')[0]
  const implicit = { ...selected, fields: selected.fields.slice(0, -1) }
  assert.equal(signature(implicit), signature(selected))
  assert.equal(indexMatches(selected, implicit), false, 'implicit Enterprise index must not prevent creation of an explicit cursor index')
  assert.equal(indexMatches(implicit, selected), true, 'an existing explicit index can satisfy an unspecified desired key')
  assert.equal(indexMatches(selected, selected), true)
  assert.equal(indexMatches(implicit, implicit), true)
  const opposite = { ...selected, fields: [...implicit.fields, { fieldPath: '__name__', order: 'ASCENDING' }] }
  assert.notEqual(signature(opposite), signature(selected))
  assert.equal(indexMatches(selected, opposite), false)
})

test('cashbook ordered and reverse-link queries each have a distinct explicit index', () => {
  const fields = (collectionGroup, names) => indexes.filter(index => index.collectionGroup === collectionGroup && index.fields.map(field => field.fieldPath).join(',') === names.join(','))
  const [account] = fields('cashTransactions', ['accountId', 'effectiveAt', '__name__'])
  assert.ok(account)
  assert.equal(account.fields.at(-1).order, 'DESCENDING')
  const implicitAccount = { ...account, fields: account.fields.slice(0, -1) }
  assert.equal(indexMatches(account, implicitAccount), false)
  assert.equal(fields('cashTransactions', ['effectiveAt', '__name__']).length, 1)
  assert.equal(fields('accountingDocuments', ['ledgerEntryId', '__name__']).length, 1)
  assert.equal(fields('accountingDocuments', ['documentType', 'createdAt', '__name__']).length, 1)
  const expenseAccount = fields('accountingDocuments', ['documentType', 'accountId', 'createdAt', '__name__'])
  assert.equal(expenseAccount.length, 1)
  assert.deepEqual(expenseAccount[0].fields.map(field => field.order), ['ASCENDING', 'ASCENDING', 'DESCENDING', 'DESCENDING'])
  assert.equal(fields('accountingDocuments', ['documentType', 'effectiveAt', '__name__']).length, 1)
  assert.equal(fields('accountingDocuments', ['documentType', 'accountId', 'effectiveAt', '__name__']).length, 1)
  assert.equal(fields('ledgerEntries', ['type', 'cashAccountId', 'effectiveAt', '__name__']).length, 1)
})

test('finance workspace scope selects only the explicit expense account cursor index', () => {
  const selected = selectIndexes(indexes, 'finance-workspace-expense-account')
  const wanted = { collectionGroup: 'accountingDocuments', queryScope: 'COLLECTION', fields: [
    { fieldPath: 'documentType', order: 'ASCENDING' },
    { fieldPath: 'accountId', order: 'ASCENDING' },
    { fieldPath: 'createdAt', order: 'DESCENDING' },
    { fieldPath: '__name__', order: 'DESCENDING' },
  ] }
  assert.deepEqual(selected, [wanted])
  assert.throws(() => selectIndexes([], 'finance-workspace-expense-account'), /exactly once/)
  assert.throws(() => selectIndexes([...indexes, wanted], 'finance-workspace-expense-account'), /exactly once/)
  for (const invalid of [
    { ...wanted, collectionGroup: 'cashTransactions' },
    { ...wanted, queryScope: 'COLLECTION_GROUP' },
    { ...wanted, fields: wanted.fields.slice(0, -1) },
    ...wanted.fields.map((field, position) => ({ ...wanted, fields: wanted.fields.map((value, index) => index === position ? { ...field, order: field.order === 'ASCENDING' ? 'DESCENDING' : 'ASCENDING' } : value) })),
  ]) assert.throws(() => selectIndexes([invalid], 'finance-workspace-expense-account'), /exactly once/)
  assert.deepEqual(parseArguments(['dry-run', '--scope=finance-workspace-expense-account']), { mode: 'dry-run', scope: 'finance-workspace-expense-account' })
  assert.deepEqual(parseArguments(['apply', '--scope=finance-workspace-expense-account', `--confirm=${CONFIRMATION}`]), { mode: 'apply', scope: 'finance-workspace-expense-account' })
  assert.throws(() => parseArguments(['apply', '--scope=finance-workspace-expense-account']), /confirmation/)
  assert.throws(() => parseArguments(['apply', '--scope=finance-workspace-expense-account', '--confirm=other-project']), /confirmation/)
  assert.throws(() => parseArguments(['dry-run', '--scope=finance-workspace-expense-account', '--project=other']), /Usage/)
})
