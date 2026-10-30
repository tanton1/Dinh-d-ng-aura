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

function endpoints({ documents = [], actor = admin, labels = [], reads = [] } = {}) {
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
  }
  return createScopedReportingReadFunctions({ db, onCall: handler => handler, authorize: async () => actor, sharedCache: {
    acquire: async () => ({ lease: {} }), publish: async () => true, release: async () => {},
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
  for (const patch of [{ totalPrice: null }, { totalPrice: '' }, { paidAmount: undefined }, { paidAmount: NaN }, { paidAmount: -1 }, { totalPrice: true }, { paidAmount: [] }, { installments: {} }, { installments: [{ status: 'pending', date: '2026-02-30', amount: 10 }] }, { installments: [{ status: 'pending', date: '2026-10-20', amount: null }] }, { installments: [{ status: 'pending', date: '2026-10-20', amount: [] }] }]) {
    assert.equal(debtState(contract(patch), '2026-10-30'), null)
    assert.equal(summarizeReceivables([row('c', contract(patch))], '2026-10-30', 'all').totals, null)
  }
  const frozen = debtState(contract({ status: 'frozen' }), '2026-10-30')
  assert.equal(frozen.debt, 80); assert.equal(frozen.overdue, 0)
  assert.equal(debtState(contract({ paidAmount: 110 }), '2026-10-30').groups.overpaid, true)
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
