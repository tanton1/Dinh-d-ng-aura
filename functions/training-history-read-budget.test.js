const assert = require('node:assert/strict')
const test = require('node:test')
const { createBusinessReportingFunctions } = require('./business-reporting')

function fixture(rows, user = { role: 'admin' }, contracts = {}) {
  const reads = []
  const snapshot = (id, value) => ({ id, exists: value !== undefined, data: () => value })
  const query = (collection, filters = [], orders = [], maximum = Infinity, cursor = null) => ({
    where: (...filter) => query(collection, [...filters, filter], orders, maximum, cursor),
    orderBy: (field, direction) => query(collection, filters, [...orders, [typeof field === 'string' ? field : 'id', direction]], maximum, cursor),
    limit: (limit) => query(collection, filters, orders, limit, cursor),
    startAfter: (...values) => query(collection, filters, orders, maximum, values),
    get: async () => {
      reads.push({ collection, filters, maximum, cursor })
      let found = collection === 'sessions' ? rows.filter((row) => filters.every(([field, op, value]) => {
        if (op === '==') return row[field] === value
        if (op === '>=') return row[field] >= value
        if (op === '<') return row[field] < value
        if (op === 'in') return value.includes(row[field])
        throw new Error(`Unexpected operator ${op}`)
      })) : []
      found = [...found].sort((a, b) => {
        for (const [field, direction] of orders) {
          const compared = String(a[field]).localeCompare(String(b[field]))
          if (compared) return direction === 'desc' ? -compared : compared
        }
        return 0
      })
      if (cursor) found = found.filter((row) => row.date < cursor[0] || row.date === cursor[0] && row.id < cursor[1])
      const docs = found.slice(0, maximum).map((row) => snapshot(row.id, row))
      return { docs, size: docs.length, empty: !docs.length }
    },
  })
  const db = {
    collection: (name) => query(name),
    doc: (path) => ({
      path,
      get: async () => snapshot(path.split('/').pop(), path === 'users/admin' ? user : ['students/student-1', 'trainers/trainer-1'].includes(path) ? { branchId: 'branch-1' } : undefined),
    }),
    getAll: async (...references) => {
      const contractIds = references.filter((ref) => ref.path.startsWith('contracts/')).map((ref) => ref.path.split('/').pop())
      if (contractIds.length) reads.push({ collection: 'contracts', ids: contractIds })
      return references.map((ref) => {
        const id = ref.path.split('/').pop()
        return snapshot(id, ref.path.startsWith('contracts/') ? contracts[id] : { name: ref.path })
      })
    },
  }
  const handlers = createBusinessReportingFunctions({ db, onCall: (_options, handler) => handler })
  const read = (data = {}, subject = 'student') => handlers[subject === 'student' ? 'listStudentTrainingHistory' : 'listTrainerTeachingHistory']({
    auth: { uid: 'admin', token: { role: user.role } },
    data: { studentId: 'student-1', trainerId: 'trainer-1', startDate: '2026-10-01', endDate: '2026-10-31', ...data },
  })
  return { reads, read }
}

const row = (id, date, status = 'completed', extra = {}) => ({ id, studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', scheduleEntryId: `entry-${date}`, date, hour: 18, status, billingStatus: 'charged', attendanceStatus: 'present', ...extra })

test('complete unfiltered range reuses its page read without changing canonical student totals', async () => {
  const { read, reads } = fixture([
    row('present', '2026-10-23'),
    row('cancelled-mirror', '2026-10-23', 'cancelled', { billingStatus: 'exempt', attendanceStatus: 'pending' }),
    row('no-show', '2026-10-22', 'no_show', { attendanceStatus: 'no_show' }),
  ])
  const result = await read()
  assert.equal(reads.filter((item) => item.collection === 'sessions').length, 1)
  assert.equal(result.summary.total, 2)
  assert.equal(result.summary.usage.chargedSessions, 2)
  assert.equal(result.summary.usage.chargedNoShowSessions, 1)
  assert.equal(result.summary.truncated, false)
})

test('complete trainer range preserves paired-shift totals while avoiding the second read', async () => {
  const { read, reads } = fixture([row('a', '2026-10-23'), row('b', '2026-10-23', 'completed', { studentId: 'student-2' }), row('c', '2026-10-22')])
  const result = await read({}, 'trainer')
  assert.equal(reads.filter((item) => item.collection === 'sessions').length, 1)
  assert.equal(result.summary.teaching.totalShifts, 2)
  assert.equal(result.summary.teaching.pairedShifts, 1)
  assert.equal(result.summary.teaching.learnerBookings, 3)
})

test('an exhausted status-filtered page reuses all source rows for exact canonical totals', async () => {
  const { read, reads } = fixture([row('a', '2026-10-23'), row('b', '2026-10-22', 'no_show')])
  const result = await read({ status: 'completed' })
  const sessionReads = reads.filter((item) => item.collection === 'sessions')
  assert.equal(sessionReads.length, 1)
  assert.ok(sessionReads[0].filters.every(([field]) => field !== 'status'))
  assert.equal(result.summary.total, 1)
})

async function allPages(read, data = {}, subject = 'student') {
  const records = [], cursors = new Set()
  let cursor = null
  for (let page = 0; page < 100; page++) {
    const result = await read({ pageSize: 2, ...data, cursor, includeSummary: !cursor }, subject)
    records.push(...result.records)
    if (!result.hasMore) { assert.equal(result.nextCursor, null); return records }
    assert.ok(result.nextCursor, 'potentially incomplete pages always have a continuation')
    assert.ok(!cursors.has(result.nextCursor), 'every continuation advances')
    cursors.add(result.nextCursor)
    cursor = result.nextCursor
  }
  assert.fail('history did not terminate')
}

test('a mirror outside the first raw window cannot become a second learner visit on the next page', async () => {
  const rows = [
    ...Array.from({ length: 35 }, (_, i) => row(`mirror-${String(i).padStart(3, '0')}`, '2026-10-24', 'student_cancelled', { billingStatus: 'exempt', attendanceStatus: 'pending' })),
    row('a-evidence', '2026-10-24'), row('older', '2026-10-23'), row('oldest', '2026-10-22'),
  ]
  const { read } = fixture(rows)
  const result = await allPages(read, { pageSize: 1 })
  assert.deepEqual(result.map(item => item.id), ['a-evidence', 'older', 'oldest'])
})

test('trainer pages split within a complete day retain every learner exactly once and collapse each mirror', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => [
    row(`source-${String(index).padStart(2, '0')}`, '2026-10-24', 'completed', { studentId: `student-${index}` }),
    row(`z-mirror-${String(index).padStart(2, '0')}`, '2026-10-24T18:00:00+07:00', 'student_cancelled', { studentId: `student-${index}`, scheduleEntryId: 'entry-2026-10-24', billingStatus: 'exempt', attendanceStatus: 'pending' }),
  ]).flat()
  const { read } = fixture(rows)
  const result = await allPages(read, {}, 'trainer')
  assert.equal(result.length, 12)
  assert.equal(new Set(result.map(item => item.studentId)).size, 12)
  assert.ok(result.every(item => item.id.startsWith('source-')))
  assert.deepEqual(result.map(item => item.id), rows.filter(item => item.id.startsWith('source-')).map(item => item.id).sort().reverse())
})

test('mixed full ISO dates and date keys never lose later same-day rows or repeat earlier days', async () => {
  const rows = [row('a', '2026-10-24T09:00:00+07:00'), row('z', '2026-10-24', 'completed', { revision: 2 }), row('b', '2026-10-23T08:00:00Z'), row('c', '2026-10-22')]
  const result = await allPages(fixture(rows).read, { pageSize: 1 })
  assert.deepEqual(result.map(item => item.id), ['z', 'b', 'c'])
})

test('status selection matches canonical totals instead of resurrecting a cancelled mirror', async () => {
  const { read } = fixture([row('attended', '2026-10-24'), row('mirror', '2026-10-24', 'student_cancelled', { billingStatus: 'exempt', attendanceStatus: 'pending' })])
  const result = await read({ status: 'student_cancelled', pageSize: 1 })
  assert.equal(result.records.length, 0)
  assert.equal(result.summary.total, 0)
  assert.equal(result.hasMore, false)
})

test('sparse filters advance through an empty bounded window without a second summary scan on append', async () => {
  const rows = Array.from({ length: 1300 }, (_, index) => row(`row-${index}`, new Date(Date.parse('2020-01-01T00:00:00Z') + index * 86400000).toISOString().slice(0, 10), index === 0 ? 'no_show' : 'completed'))
  const { read, reads } = fixture(rows)
  const first = await read({ allTime: true, pageSize: 2, status: 'no_show' })
  assert.deepEqual(first.records, [])
  assert.equal(first.hasMore, true)
  assert.ok(first.nextCursor)
  assert.equal(first.summary.total, 1)
  assert.equal(reads.filter(item => item.collection === 'sessions' && item.maximum <= 301).length, 4)
  const before = reads.length
  const second = await read({ allTime: true, pageSize: 2, status: 'no_show', cursor: first.nextCursor, includeSummary: false })
  assert.deepEqual(second.records.map(item => item.id), ['row-0'])
  assert.equal(second.hasMore, false)
  assert.equal(second.summary, null)
  assert.ok(reads.slice(before).filter(item => item.collection === 'sessions').every(item => item.maximum <= 301))
})

test('branch visibility and future scheduled rows cannot leave a stuck history cursor', async t => {
  for (const kind of ['branch', 'future']) await t.test(kind, async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => row(`excluded-${index}`, new Date(Date.parse('2090-01-01T00:00:00Z') + index * 86400000).toISOString().slice(0, 10), kind === 'future' ? 'scheduled' : 'completed', { branchId: kind === 'branch' ? 'branch-2' : 'branch-1', billingStatus: '', attendanceStatus: 'pending' }))
    rows.push(row('visible', '2020-01-01'))
    const { read } = fixture(rows, kind === 'branch' ? { role: 'manager', branchId: 'branch-1' } : { role: 'admin' })
    const result = await allPages(read, { allTime: true, pageSize: 1 })
    assert.deepEqual(result.map(item => item.id), ['visible'])
  })
})

test('a single over-budget day fails explicitly instead of emitting a partial canonical visit', async () => {
  const { read, reads } = fixture(Array.from({ length: 1300 }, (_, index) => row(`mirror-${index}`, '2026-10-24')))
  await assert.rejects(read({ pageSize: 1 }), error => error.code === 'failed-precondition' && error.details?.issue === 'HISTORY_DAY_SCAN_LIMIT')
  const scans = reads.filter(item => item.collection === 'sessions')
  assert.equal(scans.length, 4)
  assert.deepEqual(scans.map(item => item.maximum), [4, 301, 301, 301])
  assert.ok(reads.every(item => item.collection === 'sessions'), 'no events or names are hydrated from an incomplete day')
})

test('new cursors bind subject, date range, status and current access scope before business reads', async () => {
  const user = { role: 'admin' }
  const { read, reads } = fixture(Array.from({ length: 20 }, (_, index) => row(`day-${index}`, `2026-10-${String(index + 1).padStart(2, '0')}`)), user)
  const first = await read({ pageSize: 1 })
  for (const change of [{ studentId: 'student-other' }, { status: 'no_show' }, { startDate: '2026-10-05' }, { allTime: true }]) {
    const before = reads.length
    await assert.rejects(read({ pageSize: 1, cursor: first.nextCursor, ...change }), error => error.details?.issue === 'HISTORY_SCOPE_CHANGED')
    assert.equal(reads.length, before)
  }
  user.role = 'manager'; user.branchId = 'branch-1'
  await assert.rejects(read({ pageSize: 1, cursor: first.nextCursor }), error => error.details?.issue === 'HISTORY_SCOPE_CHANGED')
})

test('legacy date/id cursors remain accepted and malformed cursors never query history', async () => {
  const { read, reads } = fixture([row('new', '2026-10-24'), row('old', '2026-10-23')])
  const cursor = Buffer.from(JSON.stringify({ date: '2026-10-24', id: 'new' })).toString('base64url')
  const result = await read({ cursor, includeSummary: false })
  assert.deepEqual(result.records.map(item => item.id), ['old'])
  assert.equal(result.summary, null)
  const before = reads.length
  for (const invalid of ['bad', 'a'.repeat(1601), Buffer.from(JSON.stringify({ v: 3, date: '2026-10-24', id: 'new' })).toString('base64url')]) await assert.rejects(read({ cursor: invalid }), error => error.code === 'invalid-argument')
  assert.equal(reads.length, before)
})

test('all-time history retains its independent scan for legacy rows outside the ordered page', async () => {
  const { read, reads } = fixture([row('a', '2026-10-23')])
  const result = await read({ allTime: true })
  assert.equal(reads.filter((item) => item.collection === 'sessions').length, 2)
  assert.equal(result.summary.total, 1)
})

test('a full read window and subsequent page keep independent totals for the whole range', async () => {
  const { read, reads } = fixture(Array.from({ length: 7 }, (_, i) => row(`session-${i}`, `2026-10-${String(20 + i).padStart(2, '0')}`)))
  const first = await read({ pageSize: 2 })
  assert.equal(first.summary.total, 7)
  assert.equal(first.records.length, 2)
  assert.equal(reads.filter((item) => item.collection === 'sessions').length, 2)
  const second = await read({ pageSize: 2, cursor: first.nextCursor })
  assert.equal(second.summary.total, 7)
  assert.equal(reads.filter((item) => item.collection === 'sessions').length, 4)
})

test('cursor-only reads omit the range scan for both students and trainers; refreshing recalculates totals', async () => {
  for (const subject of ['student', 'trainer']) {
    const rows = Array.from({ length: 20 }, (_, i) => row(`session-${i}`, `2026-10-${String(1 + i).padStart(2, '0')}`))
    const { read, reads } = fixture(rows)
    const first = await read({ allTime: true, pageSize: 2 }, subject)
    assert.equal(first.summary.total, 20)
    const before = reads.length
    const next = await read({ allTime: true, pageSize: 2, cursor: first.nextCursor, includeSummary: false }, subject)
    assert.equal(next.summary, null, 'skipped totals must never look like zero totals')
    assert.equal(next.records.length, 2)
    assert.equal(new Set([...first.records, ...next.records].map(item => item.id)).size, 4)
    const sessionReads = reads.slice(before).filter(item => item.collection === 'sessions')
    assert.equal(sessionReads.length, 1)
    assert.equal(sessionReads[0].maximum, 7, 'only the bounded cursor window is read')
    rows.push(row('new-session', '2026-10-21'))
    const refreshed = await read({ allTime: true, pageSize: 2, includeSummary: false }, subject)
    assert.equal(refreshed.summary.total, 21, 'a fresh first page cannot reuse stale totals')
  }
})

test('status-filtered cursor pages omit only the summary while retaining access, filtering and event enrichment', async () => {
  const { read, reads } = fixture(Array.from({ length: 20 }, (_, i) => row(`session-${i}`, `2026-10-${String(1 + i).padStart(2, '0')}`, i % 2 ? 'no_show' : 'completed')))
  const first = await read({ status: 'no_show', pageSize: 2 })
  const before = reads.length
  const next = await read({ status: 'no_show', pageSize: 2, cursor: first.nextCursor, includeSummary: false })
  assert.equal(first.summary.total, 10)
  assert.equal(next.summary, null)
  assert.ok(next.records.every(item => item.status === 'no_show' && item.counterpartName === 'trainers/trainer-1'))
  assert.equal(reads.slice(before).filter(item => item.collection === 'sessions').length, 1)
  assert.ok(reads.slice(before).some(item => item.collection === 'attendanceEvents'))
})

test('contract details are bounded to the page and expose only the learner package metadata', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-31T12:00:00+07:00') })
  const { read, reads } = fixture([
    row('newer', '2026-10-25', 'completed', { contractId: 'new' }),
    row('new', '2026-10-24', 'completed', { contractId: 'new' }),
    row('old', '2026-10-23', 'completed', { contractId: 'old' }),
    row('older-page', '2026-10-22', 'completed', { contractId: 'older' }),
  ], { role: 'admin' }, {
    new: { studentId: 'student-1', packageName: 'PT 24 buổi', status: 'active', startDate: '2026-10-01', endDate: '2027-03-01', totalAmount: 12000000, internalNote: 'private' },
    old: { studentId: 'student-1', packageName: 'PT 12 buổi', status: 'expired', startDate: '2026-06-01', endDate: '2026-12-01', renewalSupersededBy: 'new' },
  })
  const result = await read({ includeContracts: true, pageSize: 3 })
  assert.deepEqual(reads.filter((item) => item.collection === 'contracts'), [{ collection: 'contracts', ids: ['new', 'old'] }])
  assert.deepEqual(result.records[0].contract, { id: 'new', packageName: 'PT 24 buổi', status: 'active', startDate: '2026-10-01', endDate: '2027-03-01' })
  assert.equal(result.records[2].contract.status, 'expired')
  assert.equal(result.hasMore, true)
})

test('a pending renewal keeps the current contract active until handover', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-31T12:00:00+07:00') })
  const { read } = fixture([
    row('source-session', '2026-10-25', 'completed', { contractId: 'source' }),
    row('next-session', '2026-10-24', 'completed', { contractId: 'next' }),
  ], { role: 'admin' }, {
    source: { studentId: 'student-1', status: 'active', startDate: '2026-06-01', endDate: '2026-12-01', renewedByContractId: 'next' },
    next: { studentId: 'student-1', status: 'future', startDate: '2026-10-01', endDate: '2027-03-01', sourceContractId: 'source', handoverStatus: 'pending' },
  })
  const result = await read({ includeContracts: true })
  assert.equal(result.records[0].contract.status, 'active')
  assert.equal(result.records[1].contract.status, 'future')
})

test('missing or incorrect contract links cannot expose another learner contract or infer one by date', async () => {
  const { read, reads } = fixture([
    row('foreign', '2026-10-25', 'completed', { contractId: 'foreign' }),
    row('missing', '2026-10-24', 'completed', { contractId: 'missing' }),
    row('unlinked', '2026-10-23', 'completed', { contractId: '' }),
    row('invalid', '2026-10-22', 'completed', { contractId: 'invalid/path' }),
  ], { role: 'admin' }, { foreign: { studentId: 'student-2', packageName: 'Private package' } })
  const result = await read({ includeContracts: true })
  assert.ok(result.records.every((record) => record.contract === null))
  assert.deepEqual(reads.filter((item) => item.collection === 'contracts'), [{ collection: 'contracts', ids: ['foreign', 'missing'] }])
})

test('contract metadata adds no reads to existing history consumers or trainer history', async () => {
  const { read, reads } = fixture([row('a', '2026-10-23')])
  const student = await read()
  const trainer = await read({ includeContracts: true }, 'trainer')
  assert.equal(reads.filter((item) => item.collection === 'contracts').length, 0)
  assert.equal(Object.hasOwn(student.records[0], 'contract'), false)
  assert.equal(Object.hasOwn(trainer.records[0], 'contract'), false)
})
