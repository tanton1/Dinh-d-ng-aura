'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { Timestamp } = require('firebase-admin/firestore')
const { createContractSettlementFunctions, MAX_EVIDENCE } = require('./contract-settlement')
const { assertCancellationEvidenceChange } = require('./session-operations')

const actor = { uid: 'finance-user', accessRole: 'admin', capabilities: ['finance.operations.manage'], branchIds: [] }
const instant = '2026-01-31T05:00:00.000Z'
const contract = { studentId: 'student', branchId: 'branch', status: 'cancelled', totalPrice: 12000000, discount: 0, paidAmount: 8000000, totalSessions: 12, usedSessions: 1, startDate: '2026-01-01', endDate: '2026-12-31', revision: 3, accountingAdvanceAccountCode: '3387', cancellationSettlement: { schemaVersion: 1, status: 'review_required', revision: 0, cutoffDate: '2026-01-31' } }
const recognition = { contractId: 'c', type: 'revenue_recognition', source: 'pt_gym', status: 'posted', amount: 5000000, revenueImpact: 5000000, cashImpact: 0, sessionId: 's', serviceOrdinal: 1, serviceTotal: 12, effectiveAt: instant }
const receipt = { contractId: 'c', type: 'payment', source: 'pt_gym', status: 'posted', amount: 8000000, cashImpact: 8000000, revenueImpact: 0, effectiveAt: instant }
const proposal = { cutoffDate: '2026-01-31', reason: 'Khách kết thúc dịch vụ', waivedFutureAmount: 7000000, feeAmount: 0, serviceReductionAmount: 0, writeOffAmount: 0, effectiveAt: instant }
function clone(value) {
  if (!value || typeof value !== 'object') return value
  if (value.constructor !== Object && !Array.isArray(value)) return value
  return Array.isArray(value) ? value.map(clone) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
}
function fixture(extra = {}, user = actor) {
  const documents = new Map(Object.entries({ 'contracts/c': contract, 'sessions/s': { contractId: 'c', studentId: 'student', date: '2026-01-15', hour: 8, status: 'completed', billingStatus: 'charged', attendanceStatus: 'present' }, 'ledgerEntries/r': recognition, 'ledgerEntries/p': receipt, ...extra }).map(([path, data]) => [path, clone(data)]).filter(([, value]) => value !== null))
  const ref = path => ({ path, id: path.split('/').at(-1) })
  const query = (path, filters = [], max = Infinity, selected = null) => ({ path, filters, max, selected, where(field, op, value) { assert.equal(op, '=='); return query(path, [...filters, [field, value]], max, selected) }, limit(n) { return query(path, filters, n, selected) }, select(...fields) { return query(path, filters, max, fields) } })
  const snapshot = target => {
    if (!target.filters) return { exists: documents.has(target.path), id: target.id, data: () => clone(documents.get(target.path)) }
    const rows = [...documents].filter(([path, value]) => path.startsWith(`${target.path}/`) && !path.slice(target.path.length + 1).includes('/') && target.filters.every(([field, expected]) => value[field] === expected)).slice(0, target.max)
    return { size: rows.length, docs: rows.map(([path, data]) => ({ id: path.split('/').at(-1), data: () => clone(target.selected ? Object.fromEntries(target.selected.filter(key => data[key] !== undefined).map(key => [key, data[key]])) : data) })) }
  }
  let committedWrites = 0
  const db = { doc: ref, collection: query, async runTransaction(fn) {
    const writes = []
    const result = await fn({ async get(target) { assert.equal(writes.length, 0, 'all reads before writes'); return snapshot(target) }, create(reference, value) { writes.push(['create', reference.path, value]) }, update(reference, value) { writes.push(['update', reference.path, value]) }, set(reference, value) { writes.push(['set', reference.path, value]) } })
    for (const [type, path] of writes) { if (type === 'create') assert.equal(documents.has(path), false); if (type === 'update') assert.equal(documents.has(path), true) }
    for (const [type, path, value] of writes) documents.set(path, clone(type === 'update' ? { ...documents.get(path), ...value } : value))
    committedWrites += writes.length
    return result
  } }
  const api = createContractSettlementFunctions({ db, onCall: handler => handler, authorize: async () => user, logger: { info() {} } })
  let operation = 0
  const read = cutoffDate => api.getContractSettlement({ data: { contractId: 'c', ...(cutoffDate ? { cutoffDate } : {}) } })
  const mutate = async (action, changes = {}, view) => {
    view ||= await read(changes.cutoffDate || changes.proposal?.cutoffDate)
    const data = { contractId: 'c', action, operationId: `op_${++operation}`, expectedRevision: view.revision, expectedSnapshotHash: view.preview.snapshotHash, ...changes }
    return { result: await api.manageContractSettlement({ data }), data }
  }
  return { db, api, documents, read, mutate, writes: () => committedWrites, get: path => documents.get(path), set(path, value) { documents.set(path, clone(value)) } }
}

test('legacy preview is read only and missing cutoff is an explicit blocker', async () => {
  const f = fixture({ 'contracts/c': { ...contract, cancellationSettlement: undefined } })
  const view = await f.read()
  assert.equal(view.status, 'review_required'); assert.equal(view.settlement, null); assert.equal(f.writes(), 0)
  assert(view.preview.blockers.some(row => row.code === 'SETTLEMENT_CUTOFF_REQUIRED'))
  const candidate = await f.read('2026-01-31')
  assert.equal(candidate.preview.blockers.length, 0)
  assert.equal(candidate.preview.confirmedCutoffDate, null, 'preview alone never confirms a date')
})

test('legacy cancellation cutoff uses Vietnam day for UTC strings, Date and Firestore Timestamp', async () => {
  for (const cancelledAt of ['2026-01-30T18:00:00Z', new Date('2026-01-30T18:00:00Z'), Timestamp.fromDate(new Date('2026-01-30T18:00:00Z')), '2026-01-31']) {
    const f = fixture({ 'contracts/c': { ...contract, cancellationSettlement: undefined, cancelledAt } })
    const view = await f.read()
    assert.equal(view.preview.cutoffDate, '2026-01-31')
    assert.equal(view.preview.confirmedCutoffDate, '2026-01-31')
    assert.equal(view.preview.blockers.length, 0)
    const candidate = await f.read('2026-01-29')
    assert.equal(candidate.preview.cutoffDate, '2026-01-29', 'explicit preview cutoff retains precedence')
    assert.equal(candidate.preview.confirmedCutoffDate, '2026-01-31', 'candidate does not replace persisted cancellation evidence')
  }
})

test('submit then approve creates memorandum only and never rewrites original price or cash', async () => {
  const f = fixture()
  assert.equal((await f.read()).preview.unservedValue, 7000000)
  const { result: submitted } = await f.mutate('submit', { proposal })
  assert.equal(submitted.status, 'pending_approval')
  const { result, data } = await f.mutate('approve')
  assert.equal(result.status, 'approved'); assert.equal(result.settlement.settlementAmount, 5000000)
  assert.equal(result.preview.refundAmount, 3000000); assert.equal(result.preview.blockers.length, 0)
  assert.equal(f.get('contracts/c').totalPrice, 12000000); assert.equal(f.get('contracts/c').paidAmount, 8000000)
  const ledger = [...f.documents].filter(([path]) => path.includes('_commercial_cancellation'))
  assert.equal(ledger.length, 1); assert.equal(ledger[0][1].cashImpact, 0); assert.equal(ledger[0][1].revenueImpact, 0)
  assert.equal(ledger[0][1].commercialAdjustmentAmount, -7000000); assert.equal(ledger[0][1].contractSalesImpact, 0)
  assert.equal([...f.documents.keys()].filter(path => path.startsWith('journalEntries/')).length, 0)
  const before = f.writes()
  await f.api.manageContractSettlement({ data }); assert.equal(f.writes(), before, 'same operation cannot duplicate approval')
  await assert.rejects(f.api.manageContractSettlement({ data: { ...data, expectedRevision: 99 } }), error => error.code === 'already-exists')
  await assert.rejects(f.mutate('close'), error => error.details.issueCode === 'SETTLEMENT_BALANCE_NOT_ZERO')
})

test('cash-only movement preserves approved evidence and explicit close verifies zero balance', async () => {
  const f = fixture(); await f.mutate('submit', { proposal }); const { result: approved } = await f.mutate('approve')
  f.set('ledgerEntries/refund', { ...receipt, type: 'refund', amount: -3000000, cashImpact: -3000000 })
  f.set('contracts/c', { ...f.get('contracts/c'), paidAmount: 5000000 })
  const afterCash = await f.read()
  assert.equal(afterCash.preview.serviceEvidenceHash, approved.preview.serviceEvidenceHash)
  assert.notEqual(afterCash.preview.snapshotHash, approved.preview.snapshotHash)
  const { result } = await f.mutate('close')
  assert.equal(result.status, 'settled'); assert.equal(result.preview.dueAmount, 0); assert.equal(result.preview.refundAmount, 0)
  assert.equal(f.get('contracts/c').cancellationSettlement.status, 'settled')
})

test('service reduction, earned write-off and fee keep separate balanced noncash journals', async () => {
  const f = fixture({ 'contracts/c': { ...contract, paidAmount: 3000000, salesCancellationSnapshot: { schemaVersion: 1, netAmount: 12000000, effectiveAt: instant } }, 'ledgerEntries/p': { ...receipt, amount: 3000000, cashImpact: 3000000 } })
  await f.mutate('submit', { proposal: { ...proposal, feeAmount: 2000000, feeReason: 'Phí đã thỏa thuận', serviceReductionAmount: 1000000, serviceReductionReason: 'Giảm giá đã duyệt', writeOffAmount: 1000000, writeOffReason: 'Xóa nợ được duyệt' } })
  const { result } = await f.mutate('approve')
  assert.equal(result.settlement.settlementAmount, 5000000); assert.equal(result.preview.dueAmount, 2000000)
  assert.equal(result.preview.recognizedRevenue, 6000000); assert.equal(result.preview.serviceRecognizedRevenue, 5000000)
  assert.equal(result.preview.blockers.length, 0)
  const adjustments = [...f.documents].filter(([path]) => path.startsWith('ledgerEntries/contract_settlement')).map(([, value]) => value)
  assert.equal(adjustments.reduce((sum, row) => sum + row.cashImpact, 0), 0)
  assert.equal(adjustments.reduce((sum, row) => sum + row.revenueImpact, 0), 1000000)
  assert.equal(adjustments.reduce((sum, row) => sum + row.expenseImpact, 0), 1000000)
  assert.equal(adjustments.reduce((sum, row) => sum + row.contractSalesImpact, 0), -6000000, 'commercial waiver does not include writeoff')
  const journals = [...f.documents].filter(([path]) => path.startsWith('journalEntries/')).map(([, value]) => value)
  assert.equal(journals.length, 3)
  for (const entry of journals) assert.equal(entry.lines.reduce((sum, row) => sum + row.debit, 0), entry.lines.reduce((sum, row) => sum + row.credit, 0))
  assert(journals.some(entry => entry.lines.some(line => line.accountCode === '711')))
  assert(journals.some(entry => entry.lines.some(line => line.accountCode === '6428')))
})

for (const [name, overrides, code] of [
  ['cash mismatch', { 'ledgerEntries/p': { ...receipt, amount: 7000000, cashImpact: 7000000 } }, 'SETTLEMENT_CASH_PROJECTION_MISMATCH'],
  ['missing recognition', { 'ledgerEntries/r': null }, 'SETTLEMENT_MISSING_RECOGNITION'],
  ['missing positive service source', { 'sessions/s': null }, 'SETTLEMENT_RECOGNITION_SOURCE_MISSING'],
  ['exempt positive service source', { 'sessions/s': { contractId: 'c', studentId: 'student', date: '2026-01-15', status: 'completed', billingStatus: 'exempt' } }, 'SETTLEMENT_RECOGNITION_SOURCE_INVALID'],
  ['cancelled source without charge evidence', { 'sessions/s': { contractId: 'c', studentId: 'student', date: '2026-01-15', status: 'student_cancelled', billingStatus: 'charged', attendanceStatus: 'pending' } }, 'SETTLEMENT_RECOGNITION_SOURCE_INVALID'],
  ['same session duplicate', { 'ledgerEntries/duplicate': { ...recognition, amount: 1, revenueImpact: 1 } }, 'SETTLEMENT_DUPLICATE_RECOGNITION'],
  ['same ordinal different session', { 'ledgerEntries/duplicate': { ...recognition, sessionId: 'other', amount: 1, revenueImpact: 1 } }, 'SETTLEMENT_DUPLICATE_RECOGNITION'],
  ['overcap recognition', { 'ledgerEntries/r': { ...recognition, amount: 13000000, revenueImpact: 13000000 } }, 'SETTLEMENT_REVENUE_OUT_OF_BOUNDS'],
  ['open recognition review', { 'revenueRecognitionReviews/review': { contractId: 'c', status: 'open', sessionId: 's' } }, 'SETTLEMENT_FINANCE_REVIEW_OPEN'],
  ['open billing review', { 'sessionBillingIssues/issue': { contractId: 'c', status: 'open', sessionId: 's' } }, 'SETTLEMENT_FINANCE_REVIEW_OPEN'],
  ['post-cutoff booking', { 'sessions/future': { contractId: 'c', studentId: 'student', date: '2026-02-01', status: 'scheduled' } }, 'SETTLEMENT_SERVICE_AFTER_CUTOFF'],
  ['renewal transfer', { 'contracts/c': { ...contract, sourceContractId: 'source' } }, 'SETTLEMENT_RENEWAL_REQUIRES_REVIEW'],
]) test(`approval blockers remain visible and prevent submission: ${name}`, async () => {
  const f = fixture(overrides), view = await f.read()
  assert(view.preview.blockers.some(item => item.code === code))
  await assert.rejects(f.mutate('submit', { proposal }, view), error => error.code === 'failed-precondition')
  assert.equal(f.writes(), 0)
})

test('signed reversal releases old identity and replacement is not falsely duplicated', async () => {
  const f = fixture({ 'ledgerEntries/r': { ...recognition, status: 'reversed' }, 'ledgerEntries/undo': { ...recognition, type: 'adjustment', amount: -5000000, revenueImpact: -5000000, reversedEntryId: 'r' }, 'ledgerEntries/replacement': recognition })
  assert.equal((await f.read()).preview.blockers.length, 0)
  await f.mutate('submit', { proposal }); await f.mutate('approve')
})

test('fully reversed orphan source does not block the valid replacement or charged no-show evidence', async () => {
  for (const status of ['no_show', 'student_cancelled']) {
    const original = { ...recognition, status: 'reversed', sessionId: 'removed-session' }
    const f = fixture({ 'sessions/s': { contractId: 'c', studentId: 'student', date: '2026-01-15', status, billingStatus: 'charged', attendanceStatus: 'no_show' },
      'ledgerEntries/r': original, 'ledgerEntries/undo': { ...original, status: 'posted', type: 'adjustment', amount: -5000000, revenueImpact: -5000000, reversedEntryId: 'r' }, 'ledgerEntries/replacement': recognition })
    assert.equal((await f.read()).preview.blockers.length, 0)
    await f.mutate('submit', { proposal }); await f.mutate('approve')
  }
})

test('synthetic policy charges require matching canonical attendance and use the original charged date', async () => {
  const ledger = { ...recognition, sessionId: 'policy_request', sourceSessionId: 's', attendanceEventId: 'policy_request', sessionRequestId: 'request',
    recognitionPolicy: 'approved_policy_charge_v2', evidenceStatus: 'policy_charge', confirmationSource: 'approved_policy' }
  const proof = { contractId: 'c', studentId: 'student', type: 'charged_cancellation', attendanceStatus: 'policy_charge', sessionId: 's',
    sessionRequestId: 'request', chargeId: 'policy_request', scheduledFor: '2026-01-15' }
  const source = { contractId: 'c', studentId: 'student', date: '2026-01-15', status: 'student_cancelled', billingStatus: 'charged', attendanceStatus: 'policy_charge' }
  for (const session of [source, { ...source, date: '2026-02-02', billingStatus: 'exempt', attendanceStatus: null }]) {
    const f = fixture({ 'ledgerEntries/r': ledger, 'sessions/s': session, 'attendanceEvents/policy_request': { ...proof, type: session === source ? 'charged_cancellation' : 'charged_reschedule' } })
    const first = await f.read(); assert.equal(first.preview.blockers.length, 0)
    f.set('attendanceEvents/policy_request', { ...f.get('attendanceEvents/policy_request'), updatedAt: 'unrelated-audit-change' })
    assert.equal((await f.read()).preview.serviceEvidenceHash, first.preview.serviceEvidenceHash)
    await f.mutate('submit', { proposal }); await f.mutate('approve')
    f.set('attendanceEvents/policy_request', { ...f.get('attendanceEvents/policy_request'), scheduledFor: '2026-02-01' })
    const changed = await f.read()
    assert.notEqual(changed.preview.serviceEvidenceHash, first.preview.serviceEvidenceHash)
    assert(changed.preview.blockers.some(item => item.code === 'SETTLEMENT_SERVICE_AFTER_CUTOFF'))
  }
  for (const badProof of [null, { ...proof, studentId: 'other' }, { ...proof, sessionRequestId: 'other' }, { ...proof, type: 'pending_confirmation' }]) {
    const f = fixture({ 'ledgerEntries/r': ledger, 'sessions/s': source, 'attendanceEvents/policy_request': badProof })
    assert((await f.read()).preview.blockers.some(item => item.code === 'SETTLEMENT_RECOGNITION_SOURCE_INVALID'))
    await assert.rejects(f.mutate('submit', { proposal }), error => error.code === 'failed-precondition')
    assert.equal(f.writes(), 0)
  }
})

test('stale proposal, stale revision and stale service after approval fail before writes', async () => {
  const f = fixture(); await f.mutate('submit', { proposal }); const submitted = await f.read()
  f.set('sessions/s', { ...f.get('sessions/s'), hour: 9 })
  await assert.rejects(f.mutate('approve', {}, submitted), error => error.code === 'aborted')
  await assert.rejects(f.mutate('approve'), error => error.details.issueCode === 'SETTLEMENT_PROPOSAL_STALE')
  await f.mutate('submit', { proposal }); await f.mutate('approve')
  f.set('sessions/s', { ...f.get('sessions/s'), hour: 10 })
  const view = await f.read(); assert(view.preview.blockers.some(row => row.code === 'SETTLEMENT_APPROVAL_STALE'))
  await assert.rejects(f.mutate('close'), error => error.details.issueCode === 'SETTLEMENT_APPROVAL_STALE')
})

test('locked adjustment period blocks approval atomically', async () => {
  const f = fixture({ 'financePeriods/2026-01': { status: 'locked' } })
  await f.mutate('submit', { proposal }); const before = f.writes()
  await assert.rejects(f.mutate('approve'), error => error.details.issueCode === 'FINANCE_PERIOD_LOCKED')
  assert.equal(f.writes(), before); assert.equal(f.get('contractSettlements/c').status, 'pending_approval')
})

test('withdraw only affects unapproved proposal and original signed financial facts remain', async () => {
  const f = fixture(); await f.mutate('submit', { proposal }); await f.mutate('withdraw')
  assert.equal((await f.read()).status, 'review_required')
  assert.equal(f.get('contracts/c').totalPrice, contract.totalPrice)
  await f.mutate('submit', { proposal }); await f.mutate('approve')
  await assert.rejects(f.mutate('withdraw'), error => error.code === 'failed-precondition')
})

test('future contract may be cancelled before its start, with zero-service settlement', async () => {
  const f = fixture({ 'contracts/c': { ...contract, startDate: '2026-12-01', usedSessions: 0 }, 'ledgerEntries/r': null, 'sessions/s': null })
  assert.equal((await f.read()).preview.blockers.length, 0)
  await f.mutate('submit', { proposal: { ...proposal, waivedFutureAmount: 12000000 } })
  assert.equal((await f.mutate('approve')).result.preview.refundAmount, 8000000)
})

test('waiver, reduction, writeoff and individual reasons are validated', async () => {
  for (const change of [{ waivedFutureAmount: 0 }, { serviceReductionAmount: 6000000, serviceReductionReason: 'test' }, { feeAmount: 1 }, { writeOffAmount: 1, writeOffReason: 'test' }, { effectiveAt: null }]) {
    const f = fixture()
    await assert.rejects(f.mutate('submit', { proposal: { ...proposal, ...change } }))
    assert.equal(f.writes(), 0)
  }
})

test('authorization scopes both reads and writes, and finance view alone cannot submit', async () => {
  const restricted = { ...actor, accessRole: 'staff', branchIds: ['other'] }
  await assert.rejects(fixture({}, restricted).read(), error => error.code === 'permission-denied')
  const viewer = fixture({}, { ...restricted, branchIds: ['branch'], capabilities: ['branch.finance.view'] })
  assert.equal((await viewer.read()).permissions.canSubmit, false)
  await assert.rejects(viewer.mutate('submit', { proposal }), error => error.code === 'permission-denied')
})

test('bounded evidence and malformed financial facts fail closed', async () => {
  const extra = Object.fromEntries(Array.from({ length: MAX_EVIDENCE }, (_, index) => [`sessions/overflow_${index}`, { contractId: 'c' }]))
  await assert.rejects(fixture(extra).read(), error => error.code === 'resource-exhausted')
  await assert.rejects(fixture({ 'ledgerEntries/p': { ...receipt, cashImpact: 'invalid' } }).read(), error => error.details.issueCode === 'SETTLEMENT_MALFORMED_LEDGER')
})

test('date-only verification breaks the missing-date evidence deadlock without settling financial blockers', async () => {
  const legacy = { ...contract, cancellationSettlement: undefined }
  const f = fixture({ 'contracts/c': legacy, 'ledgerEntries/r': null,
    'ledgerEntries/p': { ...receipt, amount: 7000000, cashImpact: 7000000 },
    'revenueRecognitionReviews/open': { contractId: 'c', sessionId: 's', status: 'open' },
    'sessionBillingIssues/open': { contractId: 'c', sessionId: 's', status: 'open' } })
  const evidenceChange = () => assertCancellationEvidenceChange({ contract: f.get('contracts/c'), sourceDate: '2026-01-15', changed: true })
  assert.throws(evidenceChange, error => error.details.issueCode === 'CONTRACT_CANCELLATION_CUTOFF_REQUIRED')
  await assert.rejects(f.mutate('submit', { proposal: { ...proposal, waivedFutureAmount: 12000000 } }), error => error.code === 'failed-precondition')
  const protectedPaths = [...f.documents.keys()].filter(path => !path.startsWith('contracts/'))
  const before = protectedPaths.map(path => clone(f.get(path)))
  const { result } = await f.mutate('verify_cutoff', { cutoffDate: '2026-01-31', reason: 'Ngày nghỉ được xác minh theo biên bản.' })
  assert.equal(result.status, 'review_required'); assert.equal(result.revision, 1)
  assert.equal(result.preview.confirmedCutoffDate, '2026-01-31')
  assert.equal(result.settlement.proposal, undefined); assert.equal(result.settlement.snapshot, undefined)
  for (const code of ['SETTLEMENT_MISSING_RECOGNITION', 'SETTLEMENT_CASH_PROJECTION_MISMATCH', 'SETTLEMENT_FINANCE_REVIEW_OPEN']) {
    assert(result.preview.blockers.some(item => item.code === code), code)
  }
  assert.doesNotThrow(evidenceChange, 'the actual session correction guard now permits historical evidence reconciliation')
  assert.deepEqual(protectedPaths.map(path => f.get(path)), before)
  const stored = f.get('contracts/c')
  assert.equal(stored.status, 'cancelled'); assert.equal(stored.paidAmount, legacy.paidAmount)
  assert.equal(stored.totalPrice, legacy.totalPrice); assert.equal(stored.cancelledAt, undefined)
  assert.equal(stored.cancellationSettlement.cutoffVerifiedBy, actor.uid)
  assert.equal(stored.cancellationSettlement.cutoffVerificationReason, 'Ngày nghỉ được xác minh theo biên bản.')
  assert.ok(stored.cancellationSettlement.cutoffVerifiedAt)
  const operation = [...f.documents].find(([path]) => path.startsWith('contractSettlementOperations/'))[1]
  assert.equal(operation.action, 'verify_cutoff'); assert.equal(operation.previousCutoffDate, null)
  assert.equal(operation.cutoffDate, '2026-01-31'); assert.equal(operation.reason, stored.cancellationSettlement.cutoffVerificationReason)
  const writes = f.writes()
  await assert.rejects(f.mutate('submit', { proposal: { ...proposal, waivedFutureAmount: 12000000 } }), error => error.code === 'failed-precondition')
  await assert.rejects(f.mutate('approve'), error => error.code === 'failed-precondition')
  await assert.rejects(f.mutate('close'), error => error.code === 'failed-precondition')
  assert.equal(f.writes(), writes)
})

test('malformed persisted cutoff never claims a fallback date confirmed before the real evidence guard accepts it', async () => {
  for (const cutoffDate of ['2026-02-30', '2026-01-31T00:00:00Z', ' 2026-01-31', '2026-01-31 ', ' ']) {
    const f = fixture({ 'contracts/c': { ...contract, cancelledAt: '2026-01-31T05:00:00Z',
      cancellationSettlement: { ...contract.cancellationSettlement, cutoffDate } } })
    const preview = await f.read('2026-01-31')
    assert.equal(preview.preview.cutoffDate, '2026-01-31')
    assert.equal(preview.preview.confirmedCutoffDate, null, cutoffDate)
    const guard = () => assertCancellationEvidenceChange({ contract: f.get('contracts/c'), sourceDate: '2026-01-15', changed: true })
    assert.throws(guard, error => error.details.issueCode === 'CONTRACT_CANCELLATION_CUTOFF_REQUIRED')
    const { result } = await f.mutate('verify_cutoff', { cutoffDate: '2026-01-31', reason: 'Xác minh lại ngày nghỉ.' }, preview)
    assert.equal(result.preview.confirmedCutoffDate, '2026-01-31')
    assert.doesNotThrow(guard)
    assert.equal(f.get('contracts/c').cancelledAt, '2026-01-31T05:00:00Z')
    const operation = [...f.documents].find(([path]) => path.startsWith('contractSettlementOperations/'))[1]
    assert.equal(operation.previousCutoffDate, null)
  }
  for (const cutoffDate of ['', null, undefined]) {
    const f = fixture({ 'contracts/c': { ...contract, cancelledAt: '2026-01-31T05:00:00Z',
      cancellationSettlement: { ...contract.cancellationSettlement, cutoffDate } } })
    assert.equal((await f.read('2026-02-01')).preview.confirmedCutoffDate, '2026-01-31')
  }
})

test('date verification is actor-bound, idempotent and binds both date and reason without changing old command receipts', async () => {
  const user = { ...actor }
  const f = fixture({}, user)
  const { data } = await f.mutate('verify_cutoff', { cutoffDate: '2026-01-31', reason: 'Theo biên bản.' })
  const writes = f.writes()
  const stored = clone(f.get('contractSettlements/c'))
  await f.api.manageContractSettlement({ data })
  assert.equal(f.writes(), writes); assert.deepEqual(f.get('contractSettlements/c'), stored)
  for (const change of [{ cutoffDate: '2026-02-01' }, { reason: 'Lý do khác.' }]) {
    await assert.rejects(f.api.manageContractSettlement({ data: { ...data, ...change } }), error => error.code === 'already-exists')
  }
  user.uid = 'other-finance-user'
  await assert.rejects(f.api.manageContractSettlement({ data }), error => error.code === 'already-exists')
  assert.equal(f.writes(), writes)
})

test('date verification clears a withdrawn monetary proposal and later submission is fresh', async () => {
  const f = fixture()
  await f.mutate('submit', { proposal }); await f.mutate('withdraw')
  assert.ok(f.get('contractSettlements/c').proposal)
  const { result } = await f.mutate('verify_cutoff', { cutoffDate: '2026-02-01', reason: 'Xác minh lại ngày nghỉ.' })
  assert.equal(result.settlement.proposal, undefined); assert.equal(result.settlement.snapshot, undefined)
  assert.equal(result.preview.cutoffDate, '2026-02-01'); assert.equal(result.preview.confirmedCutoffDate, '2026-02-01')
  assert.equal((await f.read('2026-02-02')).preview.confirmedCutoffDate, '2026-02-01')
  await f.mutate('submit', { proposal: { ...proposal, cutoffDate: '2026-02-01', effectiveAt: '2026-02-01T05:00:00Z' } })
  assert.equal(f.get('contractSettlements/c').status, 'pending_approval')
  assert.equal(f.get('contracts/c').cancellationSettlement.cutoffVerifiedDate, '2026-02-01')
})

test('date verification fails on stale revision or changed evidence before any writes', async () => {
  const f = fixture(), view = await f.read('2026-01-31')
  await assert.rejects(f.mutate('verify_cutoff', { cutoffDate: '2026-01-31', reason: 'Xác minh.', expectedRevision: 99 }, view), error => error.code === 'aborted')
  f.set('sessions/s', { ...f.get('sessions/s'), hour: 9 })
  await assert.rejects(f.mutate('verify_cutoff', { cutoffDate: '2026-01-31', reason: 'Xác minh.' }, view), error => error.details.issueCode === 'SETTLEMENT_SNAPSHOT_CHANGED')
  assert.equal(f.writes(), 0)
})

test('date verification rejects pending, approved, settled and active contracts', async () => {
  for (const status of ['pending_approval', 'approved', 'settled']) {
    const f = fixture({ 'contracts/c': { ...contract, cancellationSettlement: { ...contract.cancellationSettlement, status } },
      'contractSettlements/c': { schemaVersion: 1, status, revision: 0, proposal } })
    await assert.rejects(f.mutate('verify_cutoff', { cutoffDate: '2026-01-31', reason: 'Xác minh.' }), error => error.details.issueCode === 'SETTLEMENT_CUTOFF_STATE_LOCKED')
    assert.equal(f.writes(), 0)
  }
  const active = fixture({ 'contracts/c': { ...contract, status: 'active' } })
  await assert.rejects(active.mutate('verify_cutoff', { cutoffDate: '2026-01-31', reason: 'Xác minh.' }), error => error.code === 'failed-precondition')
  assert.equal(active.writes(), 0)
})

test('date verification validates dates, service cutoff, reason and malformed evidence', async () => {
  for (const cutoffDate of ['', '2026-02-30', '2026-01-31T05:00:00Z', '2999-01-01', 'not-a-date']) {
    const f = fixture()
    await assert.rejects(f.mutate('verify_cutoff', { cutoffDate, reason: 'Xác minh.' }), error => error.code === 'invalid-argument')
    assert.equal(f.writes(), 0)
  }
  const tooEarly = fixture()
  await assert.rejects(tooEarly.mutate('verify_cutoff', { cutoffDate: '2026-01-14', reason: 'Xác minh.' }), error => error.details.issueCode === 'SETTLEMENT_SERVICE_AFTER_CUTOFF')
  assert.equal(tooEarly.writes(), 0)
  const missingReason = fixture()
  await assert.rejects(missingReason.mutate('verify_cutoff', { cutoffDate: '2026-01-31', reason: ' ' }), error => error.code === 'invalid-argument')
  for (const rows of [{ 'contracts/c': { ...contract, paidAmount: 'invalid' } }, { 'ledgerEntries/p': { ...receipt, cashImpact: 'invalid' } }, { 'sessions/s': { contractId: 'c', studentId: 'student', status: 'completed', billingStatus: 'charged', date: 'invalid' } }]) {
    const f = fixture(rows)
    await assert.rejects(f.mutate('verify_cutoff', { cutoffDate: '2026-01-31', reason: 'Xác minh.' }))
    assert.equal(f.writes(), 0)
  }
})

test('date verification requires finance capability and branch scope', async () => {
  for (const user of [{ ...actor, accessRole: 'staff', branchIds: ['other'] },
    { ...actor, accessRole: 'staff', branchIds: ['branch'], capabilities: ['branch.finance.view'] }]) {
    const f = fixture({}, user)
    const view = await fixture().read('2026-01-31')
    await assert.rejects(f.mutate('verify_cutoff', { cutoffDate: '2026-01-31', reason: 'Xác minh.' }, view), error => error.code === 'permission-denied')
    assert.equal(f.writes(), 0)
  }
  const scoped = fixture({}, { ...actor, accessRole: 'staff', branchIds: ['branch'] })
  assert.equal((await scoped.mutate('verify_cutoff', { cutoffDate: '2026-01-31', reason: 'Xác minh.' })).result.status, 'review_required')
})
