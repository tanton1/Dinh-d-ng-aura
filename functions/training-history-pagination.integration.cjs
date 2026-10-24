'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createBusinessReportingFunctions, canonicalHistoryRows } = require('./business-reporting')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, 'training-pages-' + randomUUID())
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })

const row = (id, date, extra = {}) => ({ id, date, hour: 18, studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-a', scheduleEntryId: 'entry-' + date.slice(0, 10), status: 'completed', billingStatus: 'charged', attendanceStatus: 'present', ...extra })
async function fixture(rows) {
  const db = getFirestore(app, 'training-pages-' + randomUUID())
  clients.push(db)
  const seed = [
    ['users/admin', { role: 'admin' }], ['users/manager', { role: 'manager', branchId: 'branch-a' }], ['users/unrelated', { role: 'student' }],
    ['students/student-1', { branchId: 'branch-a', name: 'Learner' }], ['trainers/trainer-1', { branchId: 'branch-a', name: 'Trainer' }],
    ...rows.map(value => ['sessions/' + value.id, value]),
  ]
  for (let start = 0; start < seed.length; start += 400) {
    const batch = db.batch()
    seed.slice(start, start + 400).forEach(([key, value]) => batch.set(db.doc(key), value))
    await batch.commit()
  }
  const reads = []
  function query(target, collection, maximum = null) {
    return {
      where: (...args) => query(target.where(...args), collection, maximum),
      orderBy: (...args) => query(target.orderBy(...args), collection, maximum),
      startAfter: (...args) => query(target.startAfter(...args), collection, maximum),
      limit: value => query(target.limit(value), collection, value),
      get: async () => { const result = await target.get(); reads.push({ collection, maximum, size: result.size }); return result },
    }
  }
  const reader = {
    collection: name => query(db.collection(name), name),
    doc: key => ({ path: key, get: () => db.doc(key).get() }),
    getAll: (...refs) => db.getAll(...refs.map(ref => db.doc(ref.path))),
  }
  const handlers = createBusinessReportingFunctions({ db: reader, onCall: (_options, handler) => handler })
  const read = (data = {}, subject = 'student', actor = 'admin') => handlers[subject === 'student' ? 'listStudentTrainingHistory' : 'listTrainerTeachingHistory']({
    auth: { uid: actor, token: { role: actor === 'unrelated' ? 'student' : actor } },
    data: { studentId: 'student-1', trainerId: 'trainer-1', startDate: '2026-10-01', endDate: '2026-10-31', pageSize: 2, ...data },
  })
  return { db, read, reads }
}

test('real Firestore: complete-day cursor paging matches canonical teaching history with mixed ISO dates and separated mirrors', async () => {
  const rows = Array.from({ length: 17 }, (_, index) => [
    row('source-' + String(index).padStart(2, '0'), '2026-10-24', { studentId: 'learner-' + index }),
    row('z-mirror-' + String(index).padStart(2, '0'), '2026-10-24T18:00:00+07:00', { studentId: 'learner-' + index, status: 'student_cancelled', billingStatus: 'exempt', attendanceStatus: 'pending' }),
  ]).flat()
  rows.push(row('old-iso', '2026-10-23T18:00:00Z'), row('old-date', '2026-10-22'))
  const f = await fixture(rows), seen = [], cursors = new Set()
  await f.db.doc('sessions/source-16').update({ id: 'legacy-alias' })
  let cursor = null
  for (let page = 0; page < 20; page++) {
    const before = f.reads.length
    const result = await f.read({ cursor, includeSummary: !cursor }, 'trainer')
    seen.push(...result.records.map(item => item.id))
    const scans = f.reads.slice(before).filter(item => item.collection === 'sessions')
    assert.ok(scans.length <= 4 && scans.every(item => item.maximum <= 301))
    if (cursor) assert.equal(result.summary, null)
    else assert.equal(result.summary.teaching.learnerBookings, 19)
    if (!result.hasMore) { assert.equal(result.nextCursor, null); break }
    assert.ok(result.nextCursor && !cursors.has(result.nextCursor))
    cursors.add(result.nextCursor); cursor = result.nextCursor
  }
  assert.deepEqual(seen, canonicalHistoryRows(rows).map(item => item.id))
  assert.equal(new Set(seen).size, 19)
})

test('real Firestore: sparse branch pages advance within budget and only hydrate authorized rows', async () => {
  const rows = Array.from({ length: 1300 }, (_, index) => row('outside-' + index, new Date(Date.parse('2020-01-01T00:00:00Z') + index * 86400000).toISOString().slice(0, 10), { branchId: 'branch-b' }))
  rows.push(row('authorized-old', '2019-12-31'))
  const f = await fixture(rows)
  const first = await f.read({ allTime: true }, 'student', 'manager')
  assert.deepEqual(first.records, [])
  assert.equal(first.summary.total, 1)
  assert.ok(first.hasMore && first.nextCursor)
  assert.equal(f.reads.filter(item => item.collection === 'sessions' && item.maximum <= 301).length, 4)
  assert.ok(f.reads.every(item => item.collection === 'sessions'), 'excluded sessions do not fetch attendance or events')
  const before = f.reads.length
  const next = await f.read({ allTime: true, cursor: first.nextCursor, includeSummary: false }, 'student', 'manager')
  assert.deepEqual(next.records.map(item => item.id), ['authorized-old'])
  assert.equal(next.summary, null)
  assert.equal(next.hasMore, false)
  assert.ok(f.reads.slice(before).filter(item => item.collection === 'sessions').every(item => item.maximum <= 301))
})

test('real Firestore: status filtering, current corrections and canonical summary agree', async () => {
  const f = await fixture([row('source', '2026-10-24'), row('z-mirror', '2026-10-24T18:00:00+07:00', { status: 'student_cancelled', billingStatus: 'exempt', attendanceStatus: 'pending' })])
  const cancelled = await f.read({ status: 'student_cancelled' })
  assert.deepEqual(cancelled.records, [])
  assert.equal(cancelled.summary.total, 0)
  assert.equal(cancelled.hasMore, false)
  await f.db.doc('sessions/source').update({ status: 'no_show', attendanceStatus: 'no_show', revision: 2 })
  const changed = await f.read({ status: 'no_show' })
  assert.deepEqual(changed.records.map(item => item.id), ['source'])
  assert.equal(changed.summary.noShow, 1)
  assert.equal(changed.summary.usage.chargedNoShowSessions, 1)
})

test('real Firestore: cursor scope changes and revoked identities fail before session reads', async () => {
  const f = await fixture(Array.from({ length: 20 }, (_, index) => row('day-' + index, '2026-10-' + String(index + 1).padStart(2, '0'))))
  const first = await f.read()
  const before = f.reads.length
  await assert.rejects(f.read({ cursor: first.nextCursor, status: 'no_show' }), error => error.details?.issue === 'HISTORY_SCOPE_CHANGED')
  await assert.rejects(f.read({ cursor: first.nextCursor, studentId: 'student-other' }), error => error.details?.issue === 'HISTORY_SCOPE_CHANGED')
  await assert.rejects(f.read({}, 'student', 'unrelated'), error => error.code === 'permission-denied')
  await f.db.doc('users/admin').update({ disabled: true })
  await assert.rejects(f.read({ cursor: first.nextCursor, includeSummary: false }), error => error.code === 'permission-denied')
  assert.equal(f.reads.length, before)
})

test('real Firestore: an over-budget single day never returns an incomplete canonical result', async () => {
  const f = await fixture(Array.from({ length: 1300 }, (_, index) => row('mirror-' + index, '2026-10-24')))
  await assert.rejects(f.read({ pageSize: 1 }), error => error.code === 'failed-precondition' && error.details?.issue === 'HISTORY_DAY_SCAN_LIMIT')
  assert.deepEqual(f.reads.map(item => item.maximum), [4, 301, 301, 301])
  assert.equal(f.reads.reduce((sum, item) => sum + item.size, 0), 907)
})
