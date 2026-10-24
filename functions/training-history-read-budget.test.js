const assert = require('node:assert/strict')
const test = require('node:test')
const { createBusinessReportingFunctions } = require('./business-reporting')

function fixture(rows) {
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
      get: async () => snapshot(path.split('/').pop(), path === 'users/admin' ? { role: 'admin' } : undefined),
    }),
    getAll: async (...references) => references.map((ref) => snapshot(ref.path.split('/').pop(), { name: ref.path })),
  }
  const handlers = createBusinessReportingFunctions({ db, onCall: (_options, handler) => handler })
  const read = (data = {}, subject = 'student') => handlers[subject === 'student' ? 'listStudentTrainingHistory' : 'listTrainerTeachingHistory']({
    auth: { uid: 'admin', token: { role: 'admin' } },
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

test('a status filter retains its complete range scan and filtered totals', async () => {
  const { read, reads } = fixture([row('a', '2026-10-23'), row('b', '2026-10-22', 'no_show')])
  const result = await read({ status: 'completed' })
  const sessionReads = reads.filter((item) => item.collection === 'sessions')
  assert.equal(sessionReads.length, 2)
  assert.equal(sessionReads[1].maximum, 5001)
  assert.equal(result.summary.total, 1)
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
