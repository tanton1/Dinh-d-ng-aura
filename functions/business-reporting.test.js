'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const {
  createBusinessReportingFunctions,
  normaliseBusinessRange,
  normaliseHistoryInput,
  canonicalHistoryRows,
  canonicalStudentHistoryRows,
  summaryFromLedger,
  teachingShiftSummary,
} = require('./business-reporting')
const { Timestamp } = require('firebase-admin/firestore')

const reportStart = Timestamp.fromDate(new Date('2026-10-01T00:00:00+07:00'))
const reportEnd = Timestamp.fromDate(new Date('2026-11-01T00:00:00+07:00'))
const reportRow = (id, branchId = 'a', patch = {}) => ({ id, branchId, status: 'posted', type: 'payment', source: 'pt_gym',
  effectiveAt: reportStart, occurredAt: reportStart, paidAt: reportStart, amount: 100, ...patch })
function reportFixture(values = {}, user = { role: 'admin' }) {
  const reads = [], authReads = []
  const snapshot = value => ({ exists: Boolean(value), data: () => value, id: value?.id })
  const query = (collection, filters = [], orders = [], maximum = Infinity) => ({
    where: (...filter) => query(collection, [...filters, filter], orders, maximum),
    orderBy: (...order) => query(collection, filters, [...orders, order], maximum),
    limit: limit => query(collection, filters, orders, limit),
    get: async () => {
      const compare = value => value?.toMillis?.() ?? value
      const selected = (values[collection] || []).filter(row => filters.every(([field, op, value]) => {
        if (op === '==') return row[field] === value
        if (op === '>=') return compare(row[field]) >= compare(value)
        if (op === '<') return compare(row[field]) < compare(value)
        throw Error('Unexpected report operator')
      })).sort((a, b) => {
        for (const [field, direction] of orders) {
          const left = compare(a[field]), right = compare(b[field])
          if (left !== right) return (left < right ? -1 : 1) * (direction === 'desc' ? -1 : 1)
        }
        return 0
      }).slice(0, maximum)
      reads.push({ collection, filters, orders, maximum, returned: selected.length })
      return { docs: selected.map(snapshot), size: selected.length, empty: selected.length === 0 }
    },
  })
  const db = {
    collection: name => { assert(['ledgerEntries', 'cashTransactions', 'payrollRuns', 'attendanceEvents', 'cashAccounts'].includes(name)); return query(name) },
    doc: path => ({ get: async () => { authReads.push(path); return snapshot(path === 'users/actor' ? user : undefined) } }),
  }
  const api = createBusinessReportingFunctions({ db, onCall: (_options, handler) => handler })
  const run = (input = {}, auth = { uid: 'actor', token: { role: user.role } }) => api.listBusinessPerformance({ auth, data: {
    startDate: '2026-10-01', endDate: '2026-10-31', branchId: 'a', ...input,
  } })
  return { run, reads, authReads }
}

test('branch report applies three database predicates before caps and reuses ordered indexes', async () => {
  const f = reportFixture({ ledgerEntries: [reportRow('a'), reportRow('b', 'b')], cashTransactions: [reportRow('a'), reportRow('b', 'b')] })
  const result = await f.run()
  assert.equal(result.cashFlow.cashIn, 100)
  assert.equal(result.dataQuality.unlinkedCashTransactions, 100)
  assert.equal(result.dataQuality.reconciliationBranchId, 'a')
  assert.deepEqual(f.reads.map(read => [read.collection, read.returned]), [['ledgerEntries', 1], ['cashTransactions', 1], ['payrollRuns', 0], ['attendanceEvents', 0], ['cashAccounts', 0]])
  for (const [collection, field, direction] of [['ledgerEntries', 'effectiveAt', 'desc'], ['cashTransactions', 'effectiveAt', 'desc'], ['attendanceEvents', 'occurredAt', 'asc']]) {
    const read = f.reads.find(row => row.collection === collection)
    assert.deepEqual(read.filters, [[field, '>=', reportStart], [field, '<', reportEnd], ['branchId', '==', 'a']])
    assert.deepEqual(read.orders, [[field, direction]])
    assert.equal(read.maximum, 10001)
  }
})

test('branch reconciliation does not expose unrelated or branchless attendance counts', async () => {
  const f = reportFixture({
    ledgerEntries: [reportRow('recognised', 'a', { type: 'revenue_recognition', sessionId: 'a', revenueImpact: 30, cashImpact: 0 })],
    attendanceEvents: [reportRow('a', 'a', { sessionId: 'a' }), reportRow('missing', 'a', { sessionId: 'missing' }), reportRow('b', 'b', { sessionId: 'b' }), reportRow('unknown', null, { sessionId: 'unknown' })],
  })
  const branch = await f.run(), system = await f.run({ branchId: 'all' })
  assert.equal(branch.dataQuality.attendanceEvents, 2)
  assert.equal(branch.dataQuality.recognisedAttendanceEvents, 1)
  assert.equal(branch.dataQuality.unrecognisedAttendanceEvents, 1)
  assert.equal(system.dataQuality.attendanceEvents, 4)
  assert.equal(system.dataQuality.unrecognisedAttendanceEvents, 3)
  assert.equal(branch.managementPnl.recognisedRevenue, system.managementPnl.recognisedRevenue)
})

test('source/date filters retain inferred legacy sources, reversals and unallocated system rows', async () => {
  const values = [reportRow('current'), reportRow('reversal', 'a', { type: 'reversal', status: 'reversed', amount: -25 }),
    reportRow('contract-source', 'a', { source: '', contractId: 'legacy', amount: 60 }),
    reportRow('unclassified', 'a', { source: '', amount: 12 }), reportRow('pending', 'a', { status: 'pending' }),
    reportRow('next-month', 'a', { effectiveAt: reportEnd }), reportRow('before', 'a', { effectiveAt: Timestamp.fromMillis(reportStart.toMillis() - 1) }),
    ...[undefined, null, '', false, 0].map((branch, index) => reportRow(`unallocated-${index}`, branch, { branchId: branch, amount: 7 })), reportRow('other', 'b')]
  const inRange = values.filter(row => row.effectiveAt.toMillis() >= reportStart.toMillis() && row.effectiveAt.toMillis() < reportEnd.toMillis())
  for (const branchId of ['a', 'b', 'all']) for (const source of ['all', 'pt_gym', 'legacy_unclassified', 'academy']) {
    const f = reportFixture({ ledgerEntries: values })
    const result = await f.run({ branchId, source })
    const expected = summaryFromLedger(inRange, normaliseBusinessRange({ startDate: '2026-10-01', endDate: '2026-10-31', branchId, source }))
    assert.deepEqual(result.cashFlow, { cashIn: expected.cashIn, cashOut: expected.cashOut, cashNet: expected.cashNet })
    assert.deepEqual(result.sourceRows, expected.sourceRows)
    assert.deepEqual(result.dailySeries, expected.dailySeries)
    if (branchId === 'all') assert(f.reads.every(read => read.orders.length === 0 && !read.filters.some(([field]) => field === 'branchId')), 'system query ordering and caps remain compatible')
  }
})

test('legacy unallocated payroll and global cash account readiness retain existing policy', async () => {
  const f = reportFixture({ payrollRuns: [reportRow('a', 'a', { finalAmount: 100 }), reportRow('b', 'b', { finalAmount: 200 }),
    reportRow('unallocated', null, { finalAmount: 50 }), reportRow('linked', 'a', { finalAmount: 400, ledgerEntryId: 'linked' })], cashAccounts: [{ id: 'account', branchId: 'b' }] })
  const result = await f.run()
  assert.equal(result.dataQuality.payrollPaidOutsideLedger, 150)
  assert.equal(result.dataQuality.cashAccountsReady, true)
  assert(!f.reads.find(read => read.collection === 'payrollRuns').filters.some(([field]) => field === 'branchId'))
})

test('large unrelated branch inventory cannot truncate a selected branch report', async () => {
  const other = Array.from({ length: 10002 }, (_, index) => reportRow(`other-${index}`, 'b', { sessionId: `b-${index}` }))
  const f = reportFixture({ ledgerEntries: [...other, reportRow('selected')], cashTransactions: [...other, reportRow('selected')], attendanceEvents: [...other, reportRow('selected', 'a', { sessionId: 'selected' })] })
  const result = await f.run()
  assert.equal(result.cashFlow.cashIn, 100)
  assert.equal(result.dataQuality.unlinkedCashTransactions, 100)
  assert.equal(result.dataQuality.attendanceEvents, 1)
  assert.equal(result.dataQuality.ledgerTruncated, false)
  assert.equal(result.dataQuality.cashTransactionsTruncated, false)
  assert.equal(result.dataQuality.attendanceTruncated, false)
  assert.equal(f.reads.reduce((count, read) => count + read.returned, 0), 3)
})

test('selected-scope caps remain bounded and never claim a complete reconciliation', async () => {
  const rows = Array.from({ length: 10002 }, (_, index) => reportRow(`row-${index}`, 'a', { ledgerEntryId: 'linked', sessionId: '', finalAmount: 0, amount: 0 }))
  const f = reportFixture({ ledgerEntries: rows, cashTransactions: rows, attendanceEvents: rows, payrollRuns: rows, cashAccounts: [{ id: 'ready' }] })
  const result = await f.run()
  assert.equal(result.dataQuality.ledgerTruncated, true)
  assert.equal(result.dataQuality.cashTransactionsTruncated, true)
  assert.equal(result.dataQuality.attendanceTruncated, true)
  assert.equal(result.dataQuality.payrollLimitReached, true)
  assert.match(result.dataQuality.message, /giới hạn tải/)
  assert.doesNotMatch(result.dataQuality.message, /Dữ liệu trong phạm vi đã đối chiếu/)
  assert(f.reads.every(read => read.returned <= read.maximum))
})

test('live authority denies outsiders before report queries and limits branch managers', async () => {
  const f = reportFixture({}, { role: 'manager', branchId: 'a' })
  await f.run()
  assert.equal(f.reads.length, 5)
  for (const branchId of ['all', 'b']) await assert.rejects(f.run({ branchId }), error => error.code === 'permission-denied')
  assert.equal(f.reads.length, 5)
  for (const user of [{ role: 'student' }, { role: 'admin', disabled: true }]) {
    const denied = reportFixture({}, user)
    await assert.rejects(denied.run(), error => error.code === 'permission-denied')
    assert.equal(denied.reads.length, 0)
  }
  const unauthenticated = reportFixture()
  await assert.rejects(unauthenticated.run({}, null), error => error.code === 'unauthenticated')
  assert.equal(unauthenticated.authReads.length, 0)
  await assert.rejects(unauthenticated.run({ source: 'unknown' }), error => error.code === 'invalid-argument')
  assert.equal(unauthenticated.reads.length, 0)
})

const source = readFileSync(join(__dirname, 'business-reporting.js'), 'utf8')
const indexSource = readFileSync(join(__dirname, 'index.js'), 'utf8')

test('business reporting keeps legacy handlers and exposes bounded asia-east1 overflow aliases', () => {
  const endpointNames = [
    'listBusinessPerformance',
    'listStudentTrainingHistory',
    'listTrainerTeachingHistory',
    'getStudentContractUsage',
  ]
  for (const name of endpointNames) {
    assert.match(indexSource, new RegExp(`exports\\.${name} = businessReportingFunctions\\.${name}`))
    assert.match(indexSource, new RegExp(`exports\\.${name}Regional = businessReportingOverflowFunctions\\.${name}`))
  }
  const overflowBlock = indexSource.match(
    /const businessReportingOverflowOnCall =[\s\S]*?const businessReportingOverflowFunctions =/,
  )?.[0] || ''
  assert.match(overflowBlock, /region: 'asia-east1'/)
  assert.match(overflowBlock, /cpu: 'gcf_gen1'/)
  assert.match(overflowBlock, /concurrency: 1/)
  assert.match(overflowBlock, /maxInstances: 2/)
  assert.match(overflowBlock, /timeoutSeconds: 120/)
})

test('business P&L separates cash collection from recognised revenue', () => {
  const input = normaliseBusinessRange({ startDate: '2026-08-01', endDate: '2026-08-31' })
  const summary = summaryFromLedger([
    { type: 'payment', source: 'pt_gym', status: 'posted', amount: 1_000_000, cashImpact: 1_000_000, revenueImpact: 0, effectiveAt: new Date('2026-08-10T05:00:00Z') },
    { type: 'revenue_recognition', source: 'pt_gym', status: 'posted', amount: 200_000, cashImpact: 0, revenueImpact: 200_000, expenseImpact: 0, effectiveAt: new Date('2026-08-10T05:00:00Z') },
    { type: 'expense', source: 'other', status: 'posted', amount: -50_000, cashImpact: -50_000, expenseImpact: 50_000, effectiveAt: new Date('2026-08-11T05:00:00Z') },
  ], input)
  assert.equal(summary.cashIn, 1_000_000)
  assert.equal(summary.cashOut, 50_000)
  assert.equal(summary.cashNet, 950_000)
  assert.equal(summary.recognisedRevenue, 200_000)
  assert.equal(summary.operatingExpense, 50_000)
  assert.equal(summary.operatingResult, 150_000)
})

test('business report and training history retain bounded filters and actor-scoped access', () => {
  assert.throws(() => normaliseBusinessRange({ startDate: '2026-01-01', endDate: '2027-01-10' }), /tối đa/)
  assert.throws(() => normaliseHistoryInput({ startDate: '2025-01-01', endDate: '2026-08-20' }), /tối đa/)
  const allTime = normaliseHistoryInput({ allTime: true, startDate: '1900-01-01', endDate: '2026-08-20', pageSize: 100 })
  assert.equal(allTime.allTime, true)
  assert.equal(allTime.pageSize, 100)
  assert.match(source, /trustedAccessContext/)
  assert.match(source, /assertHistoryAccess/)
  assert.match(source, /pt\.operations\.manage/)
  assert.match(source, /pt\.students\.assigned\.view/)
  assert.match(source, /trainer_scheduled_student/)
  assert.match(source, /where\('trainerId', '==', actorId\)/)
  assert.match(source, /where\(ownerField, '==', subjectId\)/)
  assert.match(source, /canonicalize: subjectType === 'student' \? canonicalStudentHistoryRows : canonicalHistoryRows/)
  assert.match(source, /canonicalHistoryRows\(summaryRows\)/)
  assert.match(source, /orderBy\('date', 'desc'\).*orderBy\(FieldPath\.documentId\(\), 'desc'\)/s)
  assert.match(source, /MAX_HISTORY_PAGE = 100/)
  assert.match(source, /MAX_ATTENDANCE_DOCUMENTS = 10000/)
  assert.match(source, /getStudentContractUsage/)
  assert.match(source, /summarizeSessionUsage\(summaryRecords\)/)
  assert.match(source, /billingStatus: typeof item\.billingStatus/)
  assert.match(source, /filters: \{ startDate: input\.allTime \? ''/)
  assert.match(source, /formulaVersion: 'contract-usage-v2'/)
  assert.match(source, /unrecognisedAttendanceEvents/)
  assert.match(source, /Aura không tự suy diễn số còn thiếu/)
})

test('student history collapses an exempt cancellation mirror into its charged no-show', () => {
  const rows = canonicalHistoryRows([
    {
      id: 'cancelled-mirror',
      studentId: 'student-1',
      trainerId: 'trainer-1',
      contractId: 'contract-1',
      scheduleEntryId: 'schedule-week-T6-20-student-1',
      date: '2026-10-16',
      hour: 20,
      status: 'cancelled',
      billingStatus: 'exempt',
    },
    {
      id: 'attendance-no-show',
      studentId: 'student-1',
      trainerId: 'trainer-1',
      contractId: 'contract-1',
      scheduleEntryId: 'schedule-week-T6-20-student-1',
      date: '2026-10-16',
      hour: 20,
      status: 'no_show',
      billingStatus: 'charged',
      attendanceStatus: 'no_show',
    },
  ])
  assert.deepEqual(rows.map((item) => item.id), ['attendance-no-show'])
})

test('student history uses the same one-session-per-day canonical usage rule as contract quota', () => {
  const rows = [
    { id: 'morning-mirror', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', scheduleEntryId: 'entry-1', date: '2026-10-16', hour: 17, status: 'completed', billingStatus: 'charged', attendanceStatus: 'present' },
    { id: 'evening', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', scheduleEntryId: 'entry-2', date: '2026-10-16', hour: 18, status: 'completed', billingStatus: 'charged', attendanceStatus: 'present' },
    { id: 'next-day', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', scheduleEntryId: 'entry-3', date: '2026-10-17', hour: 17, status: 'completed', billingStatus: 'charged', attendanceStatus: 'present' },
  ]
  const canonical = canonicalStudentHistoryRows(rows)
  assert.equal(canonical.length, 2)
  assert.deepEqual(canonical.map((item) => item.date).sort(), ['2026-10-16', '2026-10-17'])
})

test('trainer teaching history counts a paired class as one teaching shift', () => {
  const summary = teachingShiftSummary([
    { id: 'session-a', trainerId: 'trainer-1', studentId: 'student-a', branchId: 'branch-1', date: '2026-08-28', hour: 18 },
    { id: 'session-b', trainerId: 'trainer-1', studentId: 'student-b', branchId: 'branch-1', date: '2026-08-28', hour: 18 },
    { id: 'session-c', trainerId: 'trainer-1', studentId: 'student-c', branchId: 'branch-1', date: '2026-08-28', hour: 19 },
    { id: 'session-d', trainerId: 'trainer-1', studentId: 'student-d', branchId: 'branch-2', date: '2026-08-28', hour: 18 },
  ])
  assert.deepEqual(summary, {
    totalShifts: 2,
    pairedShifts: 1,
    learnerBookings: 4,
    maxLearnersPerShift: 3,
  })
})
