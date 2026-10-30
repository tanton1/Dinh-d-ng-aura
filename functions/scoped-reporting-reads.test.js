'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createScopedReportingReadFunctions, summarizeAcademy, summarizeReceivables, debtState, cursorAfter, nextCursor, scanSummarySource, SUMMARY_LIMIT } = require('./scoped-reporting-reads')

const admin = { uid: 'admin', accessRole: 'admin', authzVersion: 2, capabilities: ['finance.operations.manage'] }
const row = (id, value, path = `contracts/${id}`) => ({ id, ref: { path }, exists: true, data: () => value })
const contract = (patch = {}) => ({ studentId: 's', totalPrice: 100, paidAmount: 20, nextPaymentDate: '2026-10-20', ...patch })

function queryFor(documents, reads = []) {
  function query(offset = 0, maximum = Infinity, fields = null) {
    return {
      orderBy: () => query(offset, maximum, fields),
      select: (...selected) => query(offset, maximum, selected),
      where: (_field, _operator, value) => queryFor(documents.filter(d => d.data().branchId === value), reads),
      startAfter: after => query(documents.findIndex(d => d.id === (typeof after === 'string' ? after : after.id)) + 1, maximum, fields),
      limit: size => query(offset, size, fields),
      async get() {
        const docs = documents.slice(offset, offset + maximum)
        reads.push({ offset, maximum, count: docs.length })
        return { docs: fields ? docs.map(d => row(d.id, Object.fromEntries(fields.filter(f => f in d.data()).map(f => [f, d.data()[f]])), d.ref.path)) : docs, size: docs.length, empty: !docs.length }
      },
    }
  }
  return query()
}

function endpoints({ documents = [], actor = admin, labels = [], reads = [], cacheKeys = [] } = {}) {
  const db = {
    collection: () => queryFor(documents, reads),
    doc: path => ({ path, id: path.split('/').at(-1) }),
    async getAll(...refs) {
      const mask = refs.pop().fieldMask
      return refs.map(ref => {
        const value = labels.find(label => label.id === ref.id)
        return value ? row(ref.id, Object.fromEntries(mask.filter(f => f in value).map(f => [f, value[f]])), ref.path) : { exists: false }
      })
    },
    runTransaction: callback => callback({ get: async query => ({ ...await query.get(), readTime: { toDate: () => new Date('2026-10-30T05:00:00Z') } }) }),
  }
  return createScopedReportingReadFunctions({ db, onCall: handler => handler, authorize: async () => actor, sharedCache: {
    acquire: async key => { cacheKeys.push(key); return { lease: {} } }, publish: async () => true, release: async () => {},
  } })
}

test('summary scans paginate beyond the previous 5,000 row cutoff without skipping rows', async () => {
  const documents = Array.from({ length: 5501 }, (_, i) => row(String(i), contract())), reads = []
  const result = await scanSummarySource(queryFor(documents, reads))
  assert.equal(result.length, 5501)
  assert.equal(new Set(result.map(d => d.id)).size, 5501)
  assert.equal(reads.length, 12)
  assert.ok(reads.every(read => read.maximum <= 500))
  assert.deepEqual(summarizeReceivables(result, '2026-10-30', 'all').totals, { debt: 5501 * 80, overdue: 5501 * 80, thisMonth: 5501 * 80 })
})

test('summary hard limit returns explicit unknown totals rather than a truncated total', async () => {
  const documents = Array.from({ length: SUMMARY_LIMIT + 20 }, (_, i) => row(String(i), contract())), reads = []
  const result = await scanSummarySource(queryFor(documents, reads))
  assert.equal(result.length, SUMMARY_LIMIT + 1)
  assert.deepEqual(summarizeReceivables(result, '2026-10-30', 'all'), { complete: false, reason: 'limit', totals: null, counts: null })
})

test('Academy summary joins only eligible enrolled learners and canonical progress paths', () => {
  const enrollments = [row('e1', { courseId: 'c', userId: 'one', status: 'active' }), row('e2', { courseId: 'c', userId: 'two', status: 'completed' })]
  const progress = [row('c', { percent: 40 }, 'users/one/progress/c'), row('c', { percent: 100 }, 'users/two/progress/c'), row('c', { percent: 99 }, 'users/other/progress/c'), row('c', { percent: 99 }, 'imports/one/progress/c')]
  assert.deepEqual(summarizeAcademy(enrollments, progress).courses, [{ courseId: 'c', learners: 2, activeLearners: 1, completedLearners: 1, averageCompletion: 70, rating: null }])
})

test('malformed amounts and dates remain unknown; frozen debt is retained but not due', () => {
  for (const patch of [{ totalPrice: null }, { totalPrice: '' }, { paidAmount: undefined }, { paidAmount: NaN }, { paidAmount: -1 }, { totalPrice: true }, { paidAmount: [] }, { installments: {} }, { installments: [{ status: 'pending', date: '2026-02-30', amount: 10 }] }, { installments: [{ status: 'pending', date: '2026-10-20', amount: null }] }, { installments: [{ status: 'pending', date: '2026-10-20', amount: [] }] }, { pausePeriods: {} }, { pausePeriods: [{ type: 'preservation', startDate: '2026-02-30', endDate: '2026-10-30' }] }, { pausePeriods: [{ type: 'preservation', startDate: '2026-10-31', endDate: '2026-10-30' }] }]) {
    assert.equal(debtState(contract(patch), '2026-10-30'), null)
    assert.equal(summarizeReceivables([row('c', contract(patch))], '2026-10-30', 'all').totals, null)
  }
  const frozen = debtState(contract({ status: 'frozen' }), '2026-10-30')
  assert.equal(frozen.debt, 80); assert.equal(frozen.overdue, 0)
  assert.equal(debtState(contract({ paidAmount: 110 }), '2026-10-30').groups.overpaid, true)
})

function managementContracts() {
  const pending = [{ id: 'first', date: '2026-10-20', amount: 100_000, status: 'pending' }, { id: 'second', date: '2026-10-30', amount: 300_000, status: 'pending' }]
  const base = { branchId: 'a', totalPrice: 1_000_000, paidAmount: 200_000, discount: 0, status: 'active', installments: [] }
  return [
    ['installments', { installments: pending }],
    ['frozen', { installments: pending, status: 'frozen', frozenAt: '2026-10-15' }],
    ['frozen-paid', { status: 'frozen', paidAmount: 1_000_000 }],
    ['preservation', { branchId: 'b', installments: pending, pausePeriods: [{ type: 'preservation', startDate: '2026-10-30', endDate: '2026-10-31' }] }],
    ['ordinary-off', { installments: pending, pausePeriods: [{ type: 'off', startDate: '2026-10-30', endDate: '2026-10-31' }] }],
    ['debt', { branchId: 'b', nextPaymentDate: '2026-10-30' }],
    ['cancelled', { status: 'cancelled' }], ['expired', { status: 'expired' }],
    ['historical-plan', { installments: [{ ...pending[0], status: 'paid' }] }],
    ['overpaid', { paidAmount: 1_200_000, installments: pending }],
  ].map(([id, patch]) => row(id, { ...base, studentId: id, packageName: id, ...patch })).sort((a, b) => a.id.localeCompare(b.id))
}

test('management categories retain cash debt and include only outstanding preservation balances', async () => {
  const api = endpoints({ documents: managementContracts() }), input = { today: '2026-10-30', pageSize: 20 }
  const pages = {}
  for (const category of ['all', 'installments', 'frozen', 'debt']) {
    pages[category] = await api.listFinanceReceivables({ data: { ...input, category } })
  }
  const ids = page => page.contracts.map(value => value.id).sort()
  assert.equal(pages.all.summary.totals.debt, 5_600_000)
  assert.equal(pages.all.summary.counts.all, 7)
  assert.deepEqual(ids(pages.installments), ['installments', 'ordinary-off'])
  assert.deepEqual(pages.installments.summary.totals, { debt: 1_600_000, overdue: 200_000, thisMonth: 800_000 })
  assert.equal(pages.installments.summary.counts['this-week'], 2)
  assert.deepEqual(ids(pages.frozen), ['frozen', 'preservation'])
  assert.deepEqual(pages.frozen.summary.totals, { debt: 1_600_000, overdue: 0, thisMonth: 0 })
  assert.equal(pages.frozen.summary.counts.all, 2)
  assert.equal(pages.frozen.summary.counts.owing, 2)
  assert.equal(pages.frozen.summary.counts.settled, 0)
  assert.equal(pages.frozen.summary.counts.overpaid, 0)
  assert.equal(pages.frozen.contracts.find(value => value.id === 'frozen').frozenAt, '2026-10-15')
  assert.equal(pages.frozen.contracts.find(value => value.id === 'preservation').pausePeriods[0].type, 'preservation')
  assert.deepEqual(ids(pages.debt), ['debt', 'expired', 'historical-plan'])
  assert.equal(pages.debt.summary.totals.debt, 2_400_000)
  assert.equal(pages.debt.summary.counts.overpaid, 1)
  assert.equal(['installments', 'frozen', 'debt'].reduce((sum, key) => sum + pages[key].summary.totals.debt, 0), pages.all.summary.totals.debt)
  assert.deepEqual(ids(await api.listFinanceReceivables({ data: { ...input, category: 'frozen', filter: 'settled' } })), [])
  assert.deepEqual(ids(await api.listFinanceReceivables({ data: { ...input, category: 'all', filter: 'settled' } })), ['frozen-paid'])
  assert.deepEqual(ids(await api.listFinanceReceivables({ data: { ...input, category: 'debt', filter: 'overpaid' } })), ['overpaid'])
  assert.deepEqual(ids(await api.listFinanceReceivables({ data: input })), ids(pages.all), 'omitted category remains compatible')
})

test('category summaries respect branch but not search/filter, and category changes fence cache/cursors', async () => {
  const cacheKeys = [], api = endpoints({ documents: managementContracts(), cacheKeys })
  const input = { today: '2026-10-30', category: 'frozen', branchId: 'b' }
  const searched = await api.listFinanceReceivables({ data: { ...input, search: 'not found', filter: 'settled' } })
  assert.equal(searched.contracts.length, 0)
  assert.equal(searched.summary.totals.debt, 800_000)
  assert.equal(searched.summary.counts.all, 1)
  await api.listFinanceReceivables({ data: input })
  assert.equal(cacheKeys[0], cacheKeys[1])
  assert.match(cacheKeys[0], /^receivables-v4-/)
  await api.listFinanceReceivables({ data: { ...input, category: 'debt' } })
  assert.notEqual(cacheKeys[1], cacheKeys[2])
  const first = await api.listFinanceReceivables({ data: { ...input, branchId: 'all', pageSize: 1, includeSummary: false } })
  await assert.rejects(api.listFinanceReceivables({ data: { ...input, branchId: 'all', category: 'debt', cursor: first.nextCursor } }), { code: 'invalid-argument' })
  await assert.rejects(api.listFinanceReceivables({ data: { ...input, category: 'unknown' } }), { code: 'invalid-argument' })
  for (const version of ['v2', 'v3']) {
    const oldCursor = nextCursor('frozen', [`finance-receivables-${version}`, admin.uid, admin.authzVersion, 'all', input.today, 'frozen', 'all', ''])
    await assert.rejects(api.listFinanceReceivables({ data: { ...input, branchId: 'all', cursor: oldCursor } }), { code: 'invalid-argument' })
  }
})

test('cancelled plans and settlement balances never enter workspace rows, labels or totals, including malformed history', async () => {
  const pending = [{ status: 'pending', date: '2026-10-20', amount: 80 }]
  const documents = ['review_required', 'pending_approval', 'approved', 'settled'].map(status => row(status,
    contract({ status: 'cancelled', studentId: 'cancelled-student', installments: pending,
      cancellationSettlement: { schemaVersion: 1, status, settlementAmount: 60, canonicalCash: 20 } })))
  documents.push(row('paid', contract({ status: 'cancelled', paidAmount: 100 })),
    row('overpaid', contract({ status: 'cancelled', paidAmount: 120 })),
    row('invalid', { status: 'cancelled', totalPrice: null, paidAmount: null, installments: {}, pausePeriods: {} }))
  const api = endpoints({ documents, labels: [{ id: 'cancelled-student', name: 'History learner' }] })
  for (const category of ['all', 'installments', 'frozen', 'debt']) for (const filter of ['all', 'owing', 'settled', 'overpaid', 'overdue', 'this-week', 'this-month']) {
    const page = await api.listFinanceReceivables({ data: { today: '2026-10-30', category, filter } })
    assert.deepEqual(page.contracts, [])
    assert.deepEqual(page.students, [])
    assert.equal(page.summary.complete, true, 'excluded malformed history cannot invalidate collectible totals')
    assert.deepEqual(page.summary.totals, { debt: 0, overdue: 0, thisMonth: 0 })
    assert.ok(Object.values(page.summary.counts).every(count => count === 0))
  }
  assert.deepEqual((await api.listFinanceStudentLabels({ data: { studentIds: ['cancelled-student'] } })).students,
    [{ id: 'cancelled-student', name: 'History learner' }], 'cash history can still resolve cancelled-contract student labels')
})

test('paid preserved contracts and cancelled preservation never enter the active preserved debt category', async () => {
  const pausePeriods = [{ type: 'preservation', startDate: '2026-10-01', endDate: '2026-10-31' }]
  const installments = [{ status: 'pending', date: '2026-10-20', amount: 80 }]
  const input = { today: '2026-10-30', category: 'frozen' }
  for (const paidAmount of [20, 100, 110, 50]) {
    const api = endpoints({ documents: [row('c', contract({ paidAmount, pausePeriods, installments }))] })
    const page = await api.listFinanceReceivables({ data: input }), expected = Math.max(0, 100 - paidAmount)
    assert.equal(page.contracts.length, expected > 0 ? 1 : 0)
    assert.equal(page.summary.counts.all, expected > 0 ? 1 : 0)
    assert.equal(page.summary.counts.settled, 0)
    assert.equal(page.summary.counts.overpaid, 0)
    assert.deepEqual(page.summary.totals, { debt: expected, overdue: 0, thisMonth: 0 })
  }
  for (const status of ['cancelled', 'inactive', 'archived', 'draft']) {
    const value = contract({ status, pausePeriods, installments }), state = debtState(value, input.today)
    assert.equal(state.preserved, false)
    assert.equal(state.category, 'installments', 'main retains outstanding installment scope when preservation ends')
    assert.equal(state.overdue, 80)
    const page = await endpoints({ documents: [row('c', value)] }).listFinanceReceivables({ data: input })
    assert.equal(page.contracts.length, 0)
    assert.equal(page.summary.counts.all, 0)
    assert.equal(page.summary.totals.debt, 0)
  }
})

test('preservation dates are inclusive, ordinary OFF stays collectible and weeks run Monday to Sunday', () => {
  const preserve = managementContracts().find(value => value.id === 'preservation').data()
  assert.equal(debtState(preserve, '2026-10-29').category, 'installments')
  for (const day of ['2026-10-30', '2026-10-31']) assert.equal(debtState(preserve, day).category, 'frozen')
  assert.equal(debtState(preserve, '2026-11-01').category, 'installments')
  const off = managementContracts().find(value => value.id === 'ordinary-off').data()
  assert.equal(debtState(off, '2026-10-30').overdue, 100_000)
  assert.equal(debtState(off, '2026-10-30').groups['this-week'], true, 'later pending installment still belongs to current week')
  assert.equal(debtState(contract({ nextPaymentDate: '2026-11-01' }), '2026-10-30').groups['this-week'], true)
  assert.equal(debtState(contract({ nextPaymentDate: '2026-10-25' }), '2026-10-30').groups['this-week'], false)
  const invalid = [row('bad', contract({ paidAmount: null }))]
  for (const category of ['all', 'installments', 'frozen', 'debt']) assert.equal(summarizeReceivables(invalid, '2026-10-30', 'all', SUMMARY_LIMIT, category).complete, false)
})

test('cursors reject changed permission revisions, invalid clocks and expired timestamps', () => {
  const scope = ['finance', 'admin', 2], cursor = nextCursor('c', scope)
  assert.equal(cursorAfter(cursor, scope), 'c')
  assert.throws(() => cursorAfter(cursor, ['finance', 'admin', 3]), /hết hạn/)
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  for (const at of [undefined, 'today', Date.now() - 31 * 60_000, Date.now() + 10_000]) {
    assert.throws(() => cursorAfter(Buffer.from(JSON.stringify({ ...parsed, at })).toString('base64url'), scope), /hết hạn/)
  }
})

test('staff capability alone cannot read Academy analytics, finance or arbitrary student labels', async () => {
  const api = endpoints({ actor: { ...admin, accessRole: 'staff', branchIds: ['a'] } })
  for (const call of [api.getAcademyAnalyticsSummary, api.listAcademyEnrollmentsPage, api.listFinanceReceivables, api.listFinanceStudentLabels]) {
    await assert.rejects(call({ data: { branchId: 'a', studentIds: ['s'] } }), { code: 'permission-denied' })
  }
})

test('labels are bounded, deduplicated and omit private student fields', async () => {
  const api = endpoints({ labels: [{ id: 's', name: 'Learner', phone: '123', email: 'student@example.test', healthConditions: ['private'] }] })
  assert.deepEqual(await api.listFinanceStudentLabels({ data: { studentIds: ['s', 's'] } }), { students: [{ id: 's', name: 'Learner', phone: '123', email: 'student@example.test' }] })
  await assert.rejects(api.listFinanceStudentLabels({ data: { studentIds: Array(51).fill('s') } }), { code: 'invalid-argument' })
  await assert.rejects(api.listFinanceStudentLabels({ data: { studentIds: ['s/private'] } }), { code: 'invalid-argument' })
})

test('sparse pages stop after 200 examined contracts and resume without losing matches', async () => {
  const documents = Array.from({ length: 230 }, (_, i) => row(String(i).padStart(4, '0'), contract({ packageName: i >= 200 ? 'Match' : 'Other' })))
  const reads = [], api = endpoints({ documents, reads })
  const input = { search: 'match', pageSize: 20, includeSummary: false, today: '2026-10-30' }
  const first = await api.listFinanceReceivables({ data: input })
  assert.equal(first.contracts.length, 0); assert.equal(first.scanned, 200); assert.equal(first.hasMore, true)
  const second = await api.listFinanceReceivables({ data: { ...input, cursor: first.nextCursor } })
  assert.equal(second.contracts.length, 20); assert.equal(second.contracts[0].id, '0200')
  const third = await api.listFinanceReceivables({ data: { ...input, cursor: second.nextCursor } })
  assert.equal(third.contracts.length, 10); assert.equal(third.hasMore, false)
  assert.equal(new Set([...second.contracts, ...third.contracts].map(c => c.id)).size, 30)
  assert.ok(reads.every(read => read.maximum <= 50))
})
