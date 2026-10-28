const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  createNutritionReviewFunctions,
  fetchReviewDocuments,
  scopedReviewSummary,
  signReviewImages,
  reviewDocumentKey,
  nextPageCursor,
  normalizeReviewDateRange,
  nutritionMealWriteReceiptId,
  pageCursor,
  reviewPriority,
  reviewRecord,
  reviewSummary,
  sanitizeMealInput,
  snapshotHash,
} = require('./nutrition-reviews')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { resolveNutritionAssignment } = require('./nutrition-review-assignment')
const { normalizeReviewSlaMinutes, reviewTimestampMillis, reviewSlaState } = require('./review-sla')
const { mealReviewActionInput } = require('./action-center')
const { refreshMealReviewActions } = require('./nutrition-review-maintenance')

test('review SLA normalization uses one bounded policy across dashboards and automation', () => {
  assert.equal(normalizeReviewSlaMinutes(undefined), 120)
  assert.equal(normalizeReviewSlaMinutes(Number.NaN), 120)
  assert.equal(normalizeReviewSlaMinutes(12), 30)
  assert.equal(normalizeReviewSlaMinutes(30.9), 30)
  assert.equal(normalizeReviewSlaMinutes(240.9), 240)
  assert.equal(normalizeReviewSlaMinutes(9_999), 1440)
  assert.equal(normalizeReviewSlaMinutes(null), 120)
  assert.equal(normalizeReviewSlaMinutes(''), 120)
})

// Query-level fixture: missing orderBy fields are excluded, document-id ties
// follow byte order, and cursors use Firestore's seconds/nanoseconds precision.
function reviewDb(rows, extras = {}) {
  const records = new Map(rows.map(({ id, ...value }) => [`mealReviews/${id}`, value]))
  Object.entries(extras).forEach(([path, value]) => records.set(path, value))
  const reads = []
  const documentReads = []
  const aggregationReads = []
  let autoId = 0
  const compare = (a, b) => {
    if (a instanceof Timestamp && b instanceof Timestamp) return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds
    return a < b ? -1 : a > b ? 1 : 0
  }
  const doc = (path) => ({ path, id: path.split('/').at(-1), get: async () => { documentReads.push(path); return snapshot(path) }, set: async (value) => records.set(path, value) })
  const snapshot = (path) => ({ id: path.split('/').at(-1), exists: records.has(path), ref: doc(path), data: () => records.get(path) })
  function query(collection, filters = [], order = [], cursor = null, maximum = Infinity, fields = []) {
    const getRows = () => {
      let found = [...records].filter(([path]) => path.startsWith(`${collection}/`) && path.split('/').length === 2)
        .map(([path]) => snapshot(path))
      const val = (item, field) => typeof field === 'string' ? item.data()?.[field] : item.id
      for (const [field, op, expected] of filters) found = found.filter((item) => {
        const value = val(item, field)
        if (op === '==') return value === expected
        if (op === 'in') return expected.includes(value)
        if (op === 'array-contains') return Array.isArray(value) && value.includes(expected)
        if (op === 'array-contains-any') return Array.isArray(value) && expected.some((id) => value.includes(id))
        if (value === undefined) return false
        return op === '<' ? compare(value, expected) < 0 : op === '>=' ? compare(value, expected) >= 0 : false
      })
      const effectiveOrder = order.length ? order : [[{}, 'asc']]
      found = found.filter((item) => effectiveOrder.every(([field]) => val(item, field) !== undefined))
      const compareOrder = (item, values) => {
        for (let i = 0; i < effectiveOrder.length; i += 1) {
          const [field, direction] = effectiveOrder[i]
          const delta = compare(val(item, field), values[i]) * (direction === 'desc' ? -1 : 1)
          if (delta) return delta
        }
        return 0
      }
      found.sort((a, b) => compareOrder(a, effectiveOrder.map(([field]) => val(b, field))))
      if (cursor) found = found.filter((item) => compareOrder(item, cursor) > 0)
      return found.slice(0, maximum)
    }
    return {
      doc: (id = `audit-${++autoId}`) => doc(`${collection}/${id}`),
      where: (...filter) => query(collection, [...filters, filter], order, cursor, maximum, fields),
      orderBy: (field, direction = 'asc') => query(collection, filters, [...order, [field, direction]], cursor, maximum, fields),
      startAfter: (...values) => query(collection, filters, order, values, maximum, fields),
      limit: (value) => query(collection, filters, order, cursor, value, fields),
      select: (...value) => query(collection, filters, order, cursor, maximum, value),
      count: () => ({ get: async () => {
        aggregationReads.push({ collection, filters })
        const disjunctions = filters.reduce((size, [, operator, value]) => size * (['in', 'array-contains-any'].includes(operator) ? value.length : 1), 1)
        assert.ok(disjunctions <= 30, `Firestore disjunction limit: ${disjunctions}`)
        return { data: () => ({ count: getRows().length }) }
      } }),
      get: async () => {
        const docs = getRows()
        reads.push({ collection, maximum, fields, filters, count: docs.length })
        return { docs, size: docs.length, empty: !docs.length }
      },
    }
  }
  const db = { records, reads, documentReads, aggregationReads, doc, collection: query, getAll: async (...refs) => refs.map((ref) => { documentReads.push(ref.path); return snapshot(ref.path) }) }
  db.runTransaction = async (handler) => {
    const writes = []
    const valueWithTransforms = (data, base = {}) => {
      const result = { ...base }
      for (const [key, value] of Object.entries(data)) {
        if (value?.isEqual?.(FieldValue.delete())) delete result[key]
        else result[key] = value?.isEqual?.(FieldValue.serverTimestamp()) ? Timestamp.now() : value
      }
      return result
    }
    const result = await handler({
      get: async (ref) => { assert.equal(writes.length, 0, 'transaction reads must precede writes'); return ref.get() },
      set: (ref, value, options) => writes.push(() => records.set(ref.path, valueWithTransforms(value, options?.merge ? records.get(ref.path) : {}))),
      update: (ref, value) => writes.push(() => { assert.ok(records.has(ref.path)); records.set(ref.path, valueWithTransforms(value, records.get(ref.path))) }),
      create: (ref, value) => writes.push(() => { assert.ok(!records.has(ref.path)); records.set(ref.path, valueWithTransforms(value)) }),
      delete: (ref) => writes.push(() => records.delete(ref.path)),
    })
    writes.forEach((write) => write())
    return result
  }
  return db
}

const queueRow = (id, millis, legacy = false, extra = {}) => ({ id, userId: 'learner', status: 'pending', [legacy ? 'submittedAt' : 'createdAt']: Timestamp.fromMillis(millis), ...extra })

test('date windows use Vietnam midnight, reject invalid ranges and bind pagination to the window', () => {
  const range = normalizeReviewDateRange({ startDate: '2026-10-28', endDate: '2026-10-28' })
  assert.equal(range.start.toDate().toISOString(), '2026-10-27T17:00:00.000Z')
  assert.equal(range.end.toDate().toISOString(), '2026-10-28T17:00:00.000Z')
  const cursor = nextPageCursor('pending', { id: 'meal', createdAt: range.start.toMillis() }, range)
  assert.equal(pageCursor(cursor, 'pending', range).id, 'meal')
  assert.throws(() => pageCursor(cursor, 'pending', normalizeReviewDateRange({ startDate: '2026-10-27', endDate: '2026-10-27' })), /Con trỏ/)
  assert.throws(() => pageCursor(cursor, 'pending'), /Con trỏ/)
  for (const input of [{ startDate: '2026-02-30', endDate: '2026-03-01' }, { startDate: '2026-10-28' }, { startDate: '2026-10-28', endDate: '2026-10-27' }, { startDate: '2026-01-01', endDate: '2026-10-28' }]) assert.throws(() => normalizeReviewDateRange(input))
})

test('page and summary queries read only the selected dates, including legacy and captured pending tasks', async () => {
  const dateRange = normalizeReviewDateRange({ startDate: '2026-10-28', endDate: '2026-10-28' })
  const start = dateRange.start.toMillis(), end = dateRange.end.toMillis()
  const captured = { userId: 'former-learner', assignmentSnapshotVersion: 1, assignedCoachIds: ['coach'] }
  const db = reviewDb([
    queueRow('before', start - 1), queueRow('start', start), queueRow('legacy', start + 60_000, true),
    queueRow('modern-with-legacy-clock', start + 120_000, false, { submittedAt: Timestamp.fromMillis(start + 90_000), status: 'approved' }),
    queueRow('end', end), queueRow('other-learner', start + 60_000, false, { userId: 'private' }),
    queueRow('captured', start + 180_000, false, captured), queueRow('captured-before', start - 1, true, captured),
  ])
  const page = await fetchReviewDocuments(db, ['learner'], 'all', null, { dateRange, actorIds: ['coach'] })
  assert.deepEqual(page.documents.map((row) => row.id).sort(), ['captured', 'legacy', 'modern-with-legacy-clock', 'start'])
  const result = await scopedReviewSummary(db, ['learner'], 120, 1, end, ['coach'], dateRange)
  assert.deepEqual(result.summary, { total: 4, pending: 3, approved: 1, rejected: 0, overdue: 3, highPriority: 0, students: 2 })
  assert.equal(result.truncated, false)
  for (const read of db.reads.filter((read) => read.collection === 'mealReviews')) {
    assert.ok(read.filters.some(([, operator, value]) => operator === '>=' && value.isEqual(dateRange.start)))
    assert.ok(read.filters.some(([, operator, value]) => operator === '<' && value.isEqual(dateRange.end)))
  }
})

test('summary cache isolates date windows and bounded summaries mark every count as partial', async () => {
  const first = { startDate: '2026-10-28', endDate: '2026-10-28' }
  const previous = { startDate: '2026-10-27', endDate: '2026-10-27' }
  const start = normalizeReviewDateRange(first).start.toMillis()
  const db = reviewDb([queueRow('today', start), queueRow('yesterday', start - 60_000, false, { status: 'approved' })], { 'users/admin': { role: 'admin' } })
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  const summary = (range) => api.listNutritionMealReviews({ auth: { uid: 'admin', token: { role: 'admin' } }, data: { section: 'summary', ...range } })
  assert.equal((await summary(first)).summary.pending, 1)
  assert.equal((await summary(previous)).summary.pending, 0)
  assert.equal((await summary(previous)).summary.approved, 1)
  const many = reviewDb(Array.from({ length: 510 }, (_, index) => queueRow(`meal-${index}`, start + index, false, { status: 'approved' })))
  const result = await scopedReviewSummary(many, null, 120, 0, start + 5_000, [], normalizeReviewDateRange(first))
  assert.equal(result.summary.approved, 500)
  assert.equal(result.countsTruncated, true)
  assert.equal(result.truncated, true)
})

test('review clock, action severity and due date share the configured SLA for legacy dates', () => {
  const now = Date.UTC(2026, 9, 14, 12)
  const value = { submittedAt: Timestamp.fromMillis(now - 180 * 60_000), status: 'pending' }
  assert.equal(reviewTimestampMillis(value), now - 180 * 60_000)
  assert.equal(reviewTimestampMillis({ createdAt: 'bad', submittedAt: new Date(now).toISOString() }), now)
  assert.equal(reviewTimestampMillis({}), 0)
  assert.equal(reviewSlaState(value, 120, now).isOverdue, true)
  assert.equal(reviewSlaState(value, 240, now).isOverdue, false)
  assert.equal(reviewSlaState(value, 180, now).isOverdue, false)
  const output = reviewRecord({ id: 'legacy', data: () => value }, {}, {}, '', { now, slaMinutes: 120 })
  const action = mealReviewActionInput('legacy', value, 120, now)
  assert.equal(output.slaDueAt, action.dueAt.toMillis())
  assert.equal(action.severity, 'warning')
  assert.match(action.redactedSummary, /2 giờ/)
  assert.equal(mealReviewActionInput('legacy', value, 240, now).severity, 'info')
})

test('dual-read pages never duplicate or skip legacy rows behind a full modern stream', async () => {
  const base = Date.UTC(2026, 9, 1)
  const rows = Array.from({ length: 15 }, (_, i) => queueRow(`modern-${String(i).padStart(2, '0')}`, base + 1_000 + i * 100,
    false, { submittedAt: Timestamp.fromMillis(base + 10 + i) }))
  rows.push(queueRow('legacy-a', base + 100, true), queueRow('legacy-b', base + 1_650, true))
  rows.push(queueRow('not-assigned', base + 200, true, { userId: 'private' }))
  for (const status of ['pending', 'all']) {
    const db = reviewDb(rows)
    let cursor = null
    const seen = []
    let complete = false
    for (let i = 0; i < 20; i += 1) {
      const page = await fetchReviewDocuments(db, ['learner'], status, cursor, { scanLimit: 3 })
      seen.push(...page.documents.map((item) => item.id))
      if (!page.hasMore) { complete = true; break }
      assert.ok(page.resumeKey)
      const next = pageCursor(nextPageCursor(status, page.resumeKey), status)
      assert.notDeepEqual(next, cursor)
      cursor = next
    }
    assert.equal(complete, true)
    const expected = rows.filter((row) => row.userId === 'learner').sort((a, b) => (reviewTimestampMillis(a) - reviewTimestampMillis(b)) * (status === 'pending' ? 1 : -1)).map((row) => row.id)
    assert.deepEqual(seen, expected)
    assert.equal(new Set(seen).size, seen.length)
    assert.ok(db.reads.every((read) => read.maximum <= 4))
  }
})

test('cursor preserves microsecond precision and Firestore document-id ordering', async () => {
  const timestamp = new Timestamp(1_790_000_000, 123_456_000)
  const db = reviewDb(['A', 'Z', 'a', 'b'].map((id, index) => ({ id, userId: 'learner', status: 'pending', createdAt: index < 3 ? timestamp : new Timestamp(timestamp.seconds, 123_457_000) })))
  let cursor = null
  const seen = []
  for (let i = 0; i < 5; i += 1) {
    const page = await fetchReviewDocuments(db, null, 'pending', cursor, { scanLimit: 1 })
    seen.push(...page.documents.map((item) => item.id))
    if (!page.hasMore) break
    cursor = pageCursor(nextPageCursor('pending', page.resumeKey), 'pending')
  }
  assert.deepEqual(seen, ['A', 'Z', 'a', 'b'])
  assert.deepEqual(reviewDocumentKey({ id: 'legacy', data: () => ({ submittedAt: timestamp }) }).timestamp, { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds })
})

test('overdue filter is server-side for both timestamp streams and does not change scope', async () => {
  const now = Date.UTC(2026, 9, 14)
  const db = reviewDb([
    queueRow('old', now - 180 * 60_000), queueRow('legacy', now - 160 * 60_000, true),
    queueRow('recent', now - 10 * 60_000), queueRow('boundary', now - 120 * 60_000, true),
    queueRow('other', now - 200 * 60_000, true, { userId: 'other' }),
  ])
  const page = await fetchReviewDocuments(db, ['learner'], 'pending', null, { scanLimit: 30, overdueCutoff: Timestamp.fromMillis(now - 120 * 60_000) })
  assert.deepEqual(page.documents.map((item) => item.id), ['old', 'legacy'])
  const empty = await fetchReviewDocuments(db, [], 'pending', null)
  assert.deepEqual(empty.documents, [])
})

test('summary includes submittedAt-only meals, excludes reviewed meals and marks bounded counts', async () => {
  const now = Date.UTC(2026, 9, 14)
  const db = reviewDb([
    queueRow('legacy', now - 180 * 60_000, true), queueRow('recent', now - 10 * 60_000),
    queueRow('approved', now - 200 * 60_000, false, { status: 'approved' }),
  ])
  const { summary, truncated } = await scopedReviewSummary(db, null, 120, 0, now)
  assert.equal(summary.overdue, 1)
  assert.equal(summary.pending, 2)
  assert.equal(summary.approved, 1)
  assert.equal(truncated, false)
  assert.ok(db.reads.every((read) => read.fields.length > 0 && !read.fields.includes('meal')))
  const backlog = reviewDb(Array.from({ length: 1005 }, (_, i) => queueRow(`m-${i}`, now - 180 * 60_000, true)))
  const bounded = await scopedReviewSummary(backlog, null, 120, 0, now)
  assert.equal(bounded.summary.pending, 1005)
  assert.equal(bounded.summary.overdue, 1000)
  assert.equal(bounded.truncated, true)
  assert.ok(backlog.reads.every((read) => read.maximum <= 1001))
})

test('image signing touches only the returned page and isolates a failed image', async () => {
  const signed = []
  const records = Array.from({ length: 300 }, (_, i) => ({ imageStoragePath: `photos/${i}`, image: '' }))
  const storage = { bucket: () => ({ file: (path) => ({ getSignedUrl: async () => {
    signed.push(path)
    if (path === 'photos/1') throw new Error('sign failure')
    return [`https://signed.example/${path}`]
  } }) }) }
  await signReviewImages(records.slice(0, 30), storage)
  assert.equal(signed.length, 30)
  assert.equal(records[0].image, 'https://signed.example/photos/0')
  assert.equal(records[1].image, '')
  assert.equal(records[30].image, '')
  await signReviewImages([])
})

test('list callable hydrates one page, accepts overdue focus and keeps old response keys', async () => {
  const now = Date.now()
  const db = reviewDb(Array.from({ length: 80 }, (_, i) => queueRow(`review-${String(i).padStart(3, '0')}`, now - (180 + i) * 60_000, i % 2 === 0)), {
    'users/admin': { role: 'admin' }, 'system/nutrition_review_settings': { slaMinutes: 120 },
  })
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  const result = await api.listNutritionMealReviews({ auth: { uid: 'admin', token: { role: 'admin' } }, data: { status: 'approved', focus: 'overdue', limit: 30 } })
  assert.equal(result.reviews.length, 30)
  assert.equal(result.hasMore, true)
  assert.equal(result.summary.overdue, 80)
  assert.equal(result.filteredCountExact, true)
  assert.ok(result.reviews.every((item) => item.isOverdue && item.status === 'pending'))
  assert.ok(db.reads.filter((read) => read.collection === 'mealReviews' && !read.fields.length).every((read) => read.maximum <= 31))
  for (const key of ['coaches', 'scope', 'assignmentCount', 'nextCursor', 'filteredCount', 'summaryTruncated', 'slaMinutes']) assert.ok(key in result)
})

test('an expired captured assignment does not grant access to other meal history', async () => {
  const db = reviewDb([queueRow('legacy', Date.now() - 180 * 60_000, true, { assignedCoachIds: ['coach'] })], {
    'users/coach': { role: 'staff' },
    'roleAssignments/coach': { accessRole: 'staff', status: 'active', authzVersion: 1, positions: [], crmProfileId: 'coach' },
  })
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  const result = await api.listNutritionMealReviews({ auth: { uid: 'coach', token: { accessRole: 'staff', authzVersion: 1 } }, data: { status: 'pending' } })
  assert.equal(result.scope, 'assigned')
  assert.equal(result.reviews.length, 0)
  assert.equal(result.summary.total, 0)
})

test('page-only review reads skip counts, directory and modern assignment enrichment', async () => {
  const db = reviewDb(Array.from({ length: 80 }, (_, index) => queueRow(`r-${index}`, Date.now() + index, false,
    { assignmentSnapshotVersion: 1, assignedCoachIds: ['coach'] })), { 'users/admin': { role: 'admin' } })
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  const result = await api.listNutritionMealReviews({ auth: { uid: 'admin', token: { role: 'admin' } }, data: { section: 'page', status: 'pending', limit: 30 } })
  assert.equal(result.reviews.length, 30)
  assert.equal(result.summaryIncluded, false)
  assert.equal(result.directoryIncluded, false)
  assert.equal(result.filteredCountExact, false)
  assert.equal(db.aggregationReads.length, 0)
  assert.ok(db.reads.every((read) => read.collection === 'mealReviews' && read.maximum === 31 && !read.fields.length))
  assert.ok(!db.documentReads.includes('roleAssignments/learner'))
})

test('summary-only reads transfer metadata without hydrating meal pages or coach directory', async () => {
  const db = reviewDb([queueRow('meal', Date.now() - 180 * 60_000)], { 'users/admin': { role: 'admin' } })
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  const result = await api.listNutritionMealReviews({ auth: { uid: 'admin', token: { role: 'admin' } }, data: { section: 'summary' } })
  assert.equal(result.summary.pending, 1)
  assert.equal(result.summary.overdue, 1)
  assert.equal(result.reviews.length, 0)
  assert.equal(db.aggregationReads.length, 5)
  assert.ok(db.reads.every((read) => read.collection === 'mealReviews' && read.fields.length > 0))
  assert.ok(!db.documentReads.includes('users/learner'))
})

test('bounded filtered pages expose a continuation and eventually find later matches without skipping', async () => {
  const db = reviewDb(Array.from({ length: 135 }, (_, index) => queueRow(`r-${String(index).padStart(3, '0')}`, Date.now() + index, false,
    { assignmentSnapshotVersion: 1, assignedCoachIds: [], meal: { title: index >= 125 ? 'needle' : 'ordinary' } })), { 'users/admin': { role: 'admin' } })
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  const auth = { uid: 'admin', token: { role: 'admin' } }
  const ids = []
  let cursor = null
  for (let page = 0; page < 5; page++) {
    const result = await api.listNutritionMealReviews({ auth, data: { section: 'page', status: 'pending', limit: 30, query: 'needle', cursor } })
    if (page === 0) { assert.equal(result.reviews.length, 0); assert.ok(result.hasMore && result.nextCursor) }
    ids.push(...result.reviews.map((row) => row.id))
    if (!result.hasMore) break
    cursor = result.nextCursor
  }
  assert.equal(ids.length, 10)
  assert.equal(new Set(ids).size, 10)
  assert.ok(db.reads.every((read) => read.maximum <= 61))
  assert.equal(db.aggregationReads.length, 0)
})

test('coach directory pages disclose continuation and never read meal reviews', async () => {
  const trainers = Object.fromEntries(Array.from({ length: 105 }, (_, index) => [`trainers/t-${String(index).padStart(3, '0')}`, { name: `Coach ${index}`, status: 'active' }]))
  const db = reviewDb([], { 'users/admin': { role: 'admin' }, ...trainers })
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  const auth = { uid: 'admin', token: { role: 'admin' } }
  const first = await api.listNutritionMealReviews({ auth, data: { section: 'directory' } })
  const second = await api.listNutritionMealReviews({ auth, data: { section: 'directory', directoryCursor: first.coachesNextCursor } })
  assert.equal(first.coaches.length, 100)
  assert.equal(first.coachesHasMore, true)
  assert.equal(second.coaches.length, 5)
  assert.equal(second.coachesHasMore, false)
  assert.equal(new Set([...first.coaches, ...second.coaches].map((row) => row.id)).size, 105)
  assert.ok(db.reads.every((read) => read.collection === 'trainers' && read.maximum === 101))
})

const staffRequest = (uid, data = {}) => ({ auth: { uid, token: { accessRole: 'staff', authzVersion: 1 } }, data })
const staffRecords = (uid, legacyId = uid) => ({
  [`users/${uid}`]: { role: 'staff' },
  [`roleAssignments/${uid}`]: { accessRole: 'staff', status: 'active', authzVersion: 1, positions: [], crmProfileId: legacyId },
})
const loggedMeal = (id) => ({ id, status: 'logged', mealRevision: 1, date: '2026-10-01', type: 'lunch', calories: 400 })

test('submission captures trusted assignment atomically, retries keep it, and resubmission replaces it', async () => {
  const db = reviewDb([], {
    'users/learner': { displayName: 'Học viên' },
    'users/learner/mealLogs/meal': loggedMeal('meal'),
    'students/canonical': { accountUid: 'learner', identityLinkStatus: 'linked' },
    'roleAssignments/learner': { crmProfileId: 'old-link' },
    'contracts/current': { studentId: 'canonical', status: 'active', startDate: '2020-01-01', endDate: '2099-01-01', nutritionPTIds: ['coach'], branchId: 'branch' },
    'contracts/stale': { studentId: 'old-link', status: 'active', startDate: '2020-01-01', endDate: '2099-01-01', nutritionPTIds: ['wrong-coach'] },
  })
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  const request = { auth: { uid: 'learner' }, data: { mealId: 'meal', assignedCoachIds: ['forged-coach'] } }
  const first = await api.submitNutritionMealReview(request)
  const capture = db.records.get('mealReviews/meal')
  assert.equal(capture.assignmentSnapshotVersion, 1)
  assert.equal(capture.studentId, 'canonical')
  assert.equal(capture.branchId, 'branch')
  assert.deepEqual(capture.assignedCoachIds, ['coach'])
  assert.deepEqual(capture.assignmentContractIds, ['current'])
  assert.ok(capture.assignmentCapturedAt instanceof Timestamp)
  assert.deepEqual(db.records.get('nutritionReviewAuditLogs/audit-1').assignedCoachIds, ['coach'])
  db.records.set('contracts/current', { ...db.records.get('contracts/current'), nutritionPTIds: ['new-coach'] })
  const retry = await api.submitNutritionMealReview(request)
  assert.equal(retry.alreadyPending, true)
  assert.equal(first.revision, retry.revision)
  assert.deepEqual(db.records.get('mealReviews/meal').assignedCoachIds, ['coach'])
  await api.saveNutritionMealLog({ auth: request.auth, data: { meal: { ...loggedMeal('meal'), title: 'Updated meal' }, expectedMealRevision: 1 } })
  await api.submitNutritionMealReview(request)
  assert.deepEqual(db.records.get('mealReviews/meal').assignedCoachIds, ['new-coach'])
  assert.equal(db.records.get('mealReviews/meal').mealRevision, 2)
})

test('ambiguous and quarantined identities never capture nutrition assignment', async () => {
  const extras = {
    'students/a': { accountUid: 'learner' }, 'students/b': { accountUid: 'learner' },
    'contracts/current': { studentId: 'a', startDate: '2020-01-01', endDate: '2099-01-01', nutritionPTIds: ['coach'] },
  }
  const db = reviewDb([], extras)
  assert.deepEqual((await resolveNutritionAssignment(db, (ref) => ref.get(), 'learner', '2026-10-14')).coachIds, [])
  db.records.delete('students/b')
  db.records.set('students/a', { accountUid: 'learner', identityLinkStatus: 'quarantined' })
  assert.deepEqual((await resolveNutritionAssignment(db, (ref) => ref.get(), 'learner', '2026-10-14')).coachIds, [])
})

test('expired-care staff see only their captured pending task, not other history or other staff tasks', async () => {
  const now = Date.now() - 180 * 60_000
  const capture = { assignmentSnapshotVersion: 1, assignedCoachIds: ['legacy-coach'], meal: loggedMeal('assigned') }
  const db = reviewDb([
    queueRow('assigned', now, false, capture),
    queueRow('unassigned', now),
    queueRow('reviewed', now, false, { ...capture, status: 'approved' }),
    queueRow('someone-else', now, false, { ...capture, assignedCoachIds: ['another-coach'] }),
  ], { ...staffRecords('coach', 'legacy-coach'), ...staffRecords('other'),
    'users/learner/mealLogs/assigned': loggedMeal('assigned'),
  })
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  for (const status of ['pending', 'all']) {
    const result = await api.listNutritionMealReviews(staffRequest('coach', { status }))
    assert.deepEqual(result.reviews.map((item) => item.id), ['assigned'])
    assert.deepEqual(result.reviews[0].assignedCoachIds, ['legacy-coach'])
    assert.equal(result.summary.total, 1)
    assert.equal(result.summary.approved, 0)
    assert.equal(result.summary.overdue, 1)
    assert.equal(result.filteredCountExact, true)
  }
  const other = await api.listNutritionMealReviews(staffRequest('other', { status: 'all' }))
  assert.equal(other.summary.total, 0, 'summary cache must be actor-scoped even with identical empty client scope')
  assert.equal(other.reviews.length, 0)
  const approved = await api.listNutritionMealReviews(staffRequest('coach', { status: 'approved' }))
  assert.equal(approved.reviews.length, 0)
  await assert.rejects(api.reviewNutritionMeal(staffRequest('other', { reviewId: 'assigned', action: 'approve', feedback: 'Kiểm tra', expectedRevision: 0 })), { code: 'permission-denied' })
  await assert.rejects(api.reviewNutritionMeal(staffRequest('coach', { reviewId: 'unassigned', action: 'approve', feedback: 'Kiểm tra', expectedRevision: 0 })), { code: 'permission-denied' })
  await api.reviewNutritionMeal(staffRequest('coach', { reviewId: 'assigned', action: 'approve', feedback: 'Kiểm tra khẩu phần', expectedRevision: 0 }))
  assert.equal(db.records.get('users/learner/mealLogs/assigned').reviewStatus, 'approved')
  assert.equal(db.records.get('nutritionReviewAuditLogs/audit-1').assignmentBasis, 'submission_snapshot')
  await assert.rejects(api.reviewNutritionMeal(staffRequest('coach', { reviewId: 'assigned', action: 'reject', feedback: 'Kiểm tra lại', expectedRevision: 1 })), { code: 'permission-denied' })
  const after = await api.listNutritionMealReviews(staffRequest('coach', { status: 'all' }))
  assert.equal(after.summary.total, 0)
  assert.equal(after.reviews.length, 0)
})

test('active-care plus captured queue pagination and counts deduplicate account aliases', async () => {
  const now = Date.now() - 180 * 60_000
  const clientIds = Array.from({ length: 35 }, (_, i) => `client-${i}`)
  const capture = { assignmentSnapshotVersion: 1, assignedCoachIds: ['coach', 'legacy-coach'], priority: 'high' }
  const rows = clientIds.map((userId, i) => queueRow(`r-${String(i).padStart(2, '0')}`, now + i, i % 2 === 0, { userId, ...capture }))
  rows.push(queueRow('expired', now - 1, true, capture))
  const db = reviewDb(rows)
  const actorIds = ['coach', 'legacy-coach']
  const summary = await scopedReviewSummary(db, clientIds, 120, clientIds.length, Date.now(), actorIds)
  assert.equal(summary.summary.total, 36)
  assert.equal(summary.summary.pending, 36)
  assert.equal(summary.summary.highPriority, 36)
  assert.equal(summary.summary.overdue, 36)
  for (const status of ['pending', 'all']) {
    const ids = []
    let cursor = null
    for (let i = 0; i < 30; i += 1) {
      const page = await fetchReviewDocuments(db, clientIds, status, cursor, { scanLimit: 3, actorIds })
      ids.push(...page.documents.map((item) => item.id))
      if (!page.hasMore) break
      cursor = pageCursor(nextPageCursor(status, page.resumeKey), status)
    }
    assert.equal(ids.length, 36)
    assert.equal(new Set(ids).size, 36)
    assert.equal(status === 'pending' ? ids[0] : ids.at(-1), 'expired')
  }
})

test('captured pending assignment cannot bypass disabled actor or stale meal revision', async () => {
  const capture = { assignmentSnapshotVersion: 1, assignedCoachIds: ['coach'], meal: loggedMeal('stale'), mealRevision: 1 }
  const db = reviewDb([queueRow('stale', Date.now(), false, capture)], {
    ...staffRecords('coach'), 'users/learner/mealLogs/stale': { ...loggedMeal('stale'), mealRevision: 2 },
  })
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  const request = staffRequest('coach', { reviewId: 'stale', action: 'approve', feedback: 'Kiểm tra', expectedRevision: 0 })
  await assert.rejects(api.reviewNutritionMeal(request), { code: 'aborted' })
  db.records.set('users/coach', { role: 'staff', disabled: true })
  await assert.rejects(api.reviewNutritionMeal(request), { code: 'permission-denied' })
  await assert.rejects(api.listNutritionMealReviews(staffRequest('coach')), { code: 'permission-denied' })
})

test('large captured queues stay bounded and mark overdue counts as a lower bound', async () => {
  const now = Date.now()
  const db = reviewDb(Array.from({ length: 1005 }, (_, i) => queueRow(`captured-${i}`, now - 180 * 60_000, false, {
    assignmentSnapshotVersion: 1, assignedCoachIds: ['coach', 'legacy-coach'], priority: 'high',
  })))
  const result = await scopedReviewSummary(db, [], 120, 0, now, ['coach', 'legacy-coach'])
  assert.equal(result.summary.total, 400)
  assert.equal(result.summary.pending, 400)
  assert.equal(result.summary.highPriority, 400)
  assert.equal(result.summary.overdue, 400)
  assert.equal(result.truncated, true)
  assert.equal(result.countsTruncated, true)
  assert.ok(db.reads.every((read) => read.maximum <= 1001 && read.fields.length > 0))
})

test('colliding meal IDs cannot overwrite, invalidate or delete another learner review', async () => {
  const db = reviewDb([queueRow('collision', Date.now(), false, { userId: 'victim' })], {
    'users/attacker/mealLogs/collision': loggedMeal('collision'),
  })
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  const auth = { uid: 'attacker' }
  await assert.rejects(api.saveNutritionMealLog({ auth, data: { meal: loggedMeal('collision') } }), { code: 'permission-denied' })
  await assert.rejects(api.submitNutritionMealReview({ auth, data: { mealId: 'collision' } }), { code: 'permission-denied' })
  await assert.rejects(api.deleteNutritionMealLog({ auth, data: { mealId: 'collision' } }), { code: 'permission-denied' })
  assert.equal(db.records.get('mealReviews/collision').userId, 'victim')
  assert.equal(db.records.get('mealReviews/collision').status, 'pending')
})

test('SLA maintenance advances past 200 rows, is idempotent and applies a policy increase', async () => {
  const db = reviewDb(Array.from({ length: 205 }, (_, i) => queueRow(`r-${String(i).padStart(3, '0')}`, Date.now() - 180 * 60_000, true)), {
    'system/nutrition_review_settings': { slaMinutes: 120 },
  })
  const visited = []
  const syncSource = async ({ event, reviewSlaMinutes }) => {
    const review = event.data.after
    visited.push(review.id)
    db.records.set(`operationalActions/meal_review:${review.id}:review`, { ...mealReviewActionInput(review.id, review.data(), reviewSlaMinutes), status: 'resolved' })
  }
  assert.equal((await refreshMealReviewActions({ db, syncSource })).refreshed, 200)
  assert.equal((await refreshMealReviewActions({ db, syncSource })).refreshed, 5)
  assert.equal(new Set(visited).size, 205)
  assert.equal((await refreshMealReviewActions({ db, syncSource })).refreshed, 0)
  assert.equal(db.records.get('operationalActions/meal_review:r-000:review').status, 'resolved')
  db.records.set('system/nutrition_review_settings', { slaMinutes: 240 })
  assert.equal((await refreshMealReviewActions({ db, syncSource })).refreshed, 5)
  assert.equal(db.records.get('operationalActions/meal_review:r-204:review').severity, 'info')
})

test('identity contracts expose one staff workspace while student relationships scope each HLV tab', () => {
  const deployable = require('./identity-contract.json')
  const shared = require('../shared/identity/identity-contract.json')
  assert.deepEqual(deployable, shared)
  assert.ok(deployable.staffCapabilities.includes('coach.workspace.view'))
  assert.ok(!deployable.positionCapabilities.coach_online.includes('nutrition.meals.assigned.review'))
  assert.ok(!deployable.positionCapabilities.trainer_pt.includes('nutrition.meals.assigned.review'))
  assert.ok(deployable.positionCapabilities.trainer_pt.includes('renewals.workspace.view'))
  assert.ok(deployable.positionCapabilities.trainer_pt.includes('renewals.case.assigned_student.support'))
  assert.ok(deployable.adminCapabilities.includes('nutrition.meals.all.review'))
})

test('public review record keeps explicit nutrition values and coach assignment', () => {
  const snapshot = {
    id: 'review-1',
    data: () => ({
      userId: 'student-1',
      userName: 'Học viên A',
      status: 'pending',
      revision: 2,
      meal: {
        type: 'lunch',
        calories: 430,
        protein: 35,
        carbs: 41,
        fat: 12,
        targetSnapshot: { calories: 1_800, protein: 110 },
        items: [{ name: 'Ức gà', grams: 150, calories: 210, protein: 31 }],
      },
    }),
  }
  const result = reviewRecord(snapshot, {}, { coachId: 'coach-1', coachIds: ['coach-1'] }, 'HLV Dinh dưỡng')
  assert.equal(result.totalKcal, 430)
  assert.equal(result.totalProtein, 35)
  assert.equal(result.totalCarb, 41)
  assert.equal(result.mealType, 'Bữa trưa')
  assert.equal(result.items[0].weight, 150)
  assert.equal(result.items[0].kcal, 210)
  assert.equal(result.targetKcal, 1_800)
  assert.equal(result.targetProtein, 110)
  assert.equal(result.fiber, 0)
  assert.equal(result.assignedCoachId, 'coach-1')
  assert.deepEqual(result.assignedCoachIds, ['coach-1'])
  assert.equal(result.assignedCoachName, 'HLV Dinh dưỡng')
  assert.equal(result.revision, 2)
})

test('meal input strips review fields and accepts only canonical owner photo paths', () => {
  const meal = sanitizeMealInput({
    id: 'meal-1', date: '2026-09-08', type: 'lunch', status: 'logged', title: 'Cơm gà',
    calories: 450, imageStoragePath: 'users/student-1/meal-photos/meal-1/original.jpg',
    reviewStatus: 'approved', reviewedBy: 'forged-coach',
  }, 'student-1')
  assert.equal(meal.reviewStatus, undefined)
  assert.equal(meal.reviewedBy, undefined)
  assert.equal(meal.imageStoragePath, 'users/student-1/meal-photos/meal-1/original.jpg')
  assert.throws(() => sanitizeMealInput({
    id: 'meal-1', date: '2026-09-08', type: 'lunch', status: 'logged',
    imageStoragePath: 'users/other/meal-photos/meal-1/original.jpg',
  }, 'student-1'))
})

test('meal input rejects future logged dates and inconsistent macro calories', () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const today = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const base = `${today.year}-${today.month}-${today.day}`
  const future = new Date(`${base}T12:00:00+07:00`)
  future.setUTCDate(future.getUTCDate() + 1)
  const futureParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(future)
  const futureDate = Object.fromEntries(futureParts.map((part) => [part.type, part.value]))
  assert.throws(() => sanitizeMealInput({ id: 'future-meal', date: `${futureDate.year}-${futureDate.month}-${futureDate.day}`, type: 'lunch', status: 'logged', title: 'Bữa sau' }, 'student-1'), /ngày trong tương lai/i)
  assert.throws(() => sanitizeMealInput({ id: 'bad-macro', date: base, type: 'lunch', status: 'logged', title: 'Lệch macro', calories: 100, protein: 40, carbs: 40, fat: 40 }, 'student-1'), /lệch quá 20%/i)
})

test('review cursor v2 is stable by timestamp and document id', () => {
  const snapshot = { id: 'review-1', data: () => ({ createdAt: new Date('2026-09-08T03:00:00Z') }) }
  const encoded = nextPageCursor('pending', snapshot)
  assert.deepEqual(pageCursor(encoded, 'pending'), { createdAt: Date.parse('2026-09-08T03:00:00Z'), id: 'review-1' })
  assert.throws(() => pageCursor(encoded, 'approved'))
  assert.equal(snapshotHash({ a: 1 }), snapshotHash({ a: 1 }))
})

test('meal save retries use one receipt and do not increment the meal revision twice', async () => {
  const records = new Map()
  const reference = (documentPath) => ({ path: documentPath, id: documentPath.split('/').at(-1) })
  const snapshot = (ref) => ({ exists: records.has(ref.path), data: () => records.get(ref.path) })
  const db = {
    doc: reference,
    collection: (collectionPath) => ({ doc: (id = 'auto-' + (records.size + 1)) => reference(collectionPath + '/' + id) }),
    async runTransaction(handler) {
      return handler({
        get: async (ref) => snapshot(ref),
        set: (ref, value, options) => records.set(
          ref.path,
          options?.merge ? { ...(records.get(ref.path) || {}), ...value } : value,
        ),
        create: (ref, value) => {
          if (records.has(ref.path)) throw new Error('already-exists')
          records.set(ref.path, value)
        },
        update: (ref, value) => records.set(ref.path, { ...(records.get(ref.path) || {}), ...value }),
      })
    },
  }
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  const meal = {
    id: 'ai-attempt-1',
    date: '2026-09-08',
    type: 'lunch',
    status: 'logged',
    title: 'Cơm gà',
    calories: 450,
  }
  const request = {
    auth: { uid: 'student-1' },
    data: { meal, idempotencyKey: 'scan-attempt-123' },
  }

  const created = await api.saveNutritionMealLog(request)
  const retried = await api.saveNutritionMealLog(request)
  const receiptPath = 'nutritionMealWriteReceipts/' + nutritionMealWriteReceiptId('student-1', 'scan-attempt-123')

  assert.equal(created.unchanged, false)
  assert.equal(retried.unchanged, true)
  assert.equal(created.mealId, retried.mealId)
  assert.equal(created.mealRevision, 1)
  assert.equal(retried.mealRevision, 1)
  assert.equal(records.get('users/student-1/mealLogs/ai-attempt-1').mealRevision, 1)
  assert.equal(records.get(receiptPath).mealId, 'ai-attempt-1')
})

test('meal receipt id is scoped by both user and save attempt', () => {
  const id = nutritionMealWriteReceiptId('student-1', 'scan-attempt-123')
  assert.equal(id, nutritionMealWriteReceiptId('student-1', 'scan-attempt-123'))
  assert.notEqual(id, nutritionMealWriteReceiptId('student-2', 'scan-attempt-123'))
  assert.notEqual(id, nutritionMealWriteReceiptId('student-1', 'scan-attempt-456'))
})

test('review images reject file names and preserve safe persistent sources', () => {
  const snapshot = (image) => ({
    id: 'review-image',
    data: () => ({ userId: 'student-1', meal: { image } }),
  })
  assert.equal(reviewRecord(snapshot('IMG_5579.jpeg')).image, '')
  assert.equal(reviewRecord(snapshot('javascript:alert(1)')).image, '')
  assert.equal(reviewRecord(snapshot('https://cdn.example.com/meal.jpg')).image, 'https://cdn.example.com/meal.jpg')
  assert.equal(reviewRecord(snapshot('/images/meals/example.jpg')).image, '/images/meals/example.jpg')
})

test('pending reviews expose SLA state and prioritise the oldest overdue meal', () => {
  const now = Date.UTC(2026, 7, 24, 12, 0, 0)
  const snapshot = (id, ageMinutes, priority = 'normal') => ({
    id,
    data: () => ({
      userId: `student-${id}`,
      status: 'pending',
      priority,
      createdAt: now - ageMinutes * 60_000,
      meal: {},
    }),
  })
  const recent = reviewRecord(snapshot('recent', 40, 'high'), {}, {}, '', { now, slaMinutes: 120 })
  const overdue = reviewRecord(snapshot('overdue', 180), {}, {}, '', { now, slaMinutes: 120 })
  const oldest = reviewRecord(snapshot('oldest', 260), {}, {}, '', { now, slaMinutes: 120 })
  assert.equal(recent.isOverdue, false)
  assert.equal(overdue.overdueMinutes, 60)
  assert.deepEqual([recent, overdue, oldest].sort(reviewPriority).map((item) => item.id), ['oldest', 'overdue', 'recent'])
  const summary = reviewSummary([recent, overdue, oldest])
  assert.equal(summary.pending, 3)
  assert.equal(summary.overdue, 2)
  assert.equal(summary.highPriority, 1)
  assert.equal(summary.studentIds.size, 3)
})

test('nutrition review callables are actor-scoped and transaction-backed', () => {
  const source = fs.readFileSync(path.join(__dirname, 'nutrition-reviews.js'), 'utf8')
  assert.match(source, /const reviewCall = \(handler\) => onCall\(\{[\s\S]*?cpu: 'gcf_gen1',[\s\S]*?maxInstances: 6,[\s\S]*?\.\.\.reviewCallOptions,[\s\S]*?\}, handler\)/)
  assert.match(source, /const listNutritionMealReviews = reviewCall/)
  assert.match(source, /trustedAccessContext\(request, db\)/)
  assert.match(source, /where\('nutritionPTIds', 'array-contains', coachId\)/)
  assert.match(source, /where\('crmProfileId', 'in', chunk\)/)
  assert.match(source, /where\('studentId', 'in'/)
  assert.doesNotMatch(source, /coachClients/)
  assert.match(source, /Học viên PT Gym → Hợp đồng/)
  assert.match(source, /db\.runTransaction/)
  assert.match(source, /users\/\$\{userId\}\/mealLogs/)
  assert.match(source, /nutritionReviewAuditLogs/)
  assert.match(source, /assignedCoachIds\.includes\(coachId\)/)
  assert.match(source, /nutrition_review_settings/)
  assert.match(source, /reviewPriority/)
})

test('meal edits and deletes reject stale or missing revisions and delete/undo never reuses a revision', async () => {
  const db = reviewDb([], { 'users/learner/mealLogs/meal': loggedMeal('meal') })
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  const auth = { uid: 'learner' }
  const meal = { ...loggedMeal('meal'), title: 'Updated' }
  await assert.rejects(api.saveNutritionMealLog({ auth, data: { meal } }), { code: 'failed-precondition' })
  await assert.rejects(api.saveNutritionMealLog({ auth, data: { meal, expectedMealRevision: 0 } }), { code: 'failed-precondition' })
  const saved = await api.saveNutritionMealLog({ auth, data: { meal, expectedMealRevision: 1, idempotencyKey: 'edit-attempt-1' } })
  assert.equal(saved.mealRevision, 2)
  await assert.rejects(api.saveNutritionMealLog({ auth, data: { meal: { ...meal, title: 'Stale' }, expectedMealRevision: 1 } }), { code: 'aborted' })
  await assert.rejects(api.deleteNutritionMealLog({ auth, data: { mealId: 'meal' } }), { code: 'failed-precondition' })
  await assert.rejects(api.deleteNutritionMealLog({ auth, data: { mealId: 'meal', expectedMealRevision: 1 } }), { code: 'aborted' })
  const retry = await api.saveNutritionMealLog({ auth, data: { meal, expectedMealRevision: 1, idempotencyKey: 'edit-attempt-1' } })
  assert.equal(retry.unchanged, true)
  assert.equal(retry.mealRevision, 2)
  await api.deleteNutritionMealLog({ auth, data: { mealId: 'meal', expectedMealRevision: 2 } })
  const restored = await api.saveNutritionMealLog({ auth, data: { meal, expectedMealRevision: 0 } })
  assert.equal(restored.mealRevision, 3)
  await assert.rejects(api.saveNutritionMealLog({ auth, data: { meal, expectedMealRevision: 2 } }), { code: 'aborted' })
  assert.equal(db.records.get('users/learner/mealLogRevisions/meal').mealRevision, 2)
})

test('legacy meals start at revision one and owner mismatch is rejected before any write', async () => {
  const legacy = { ...loggedMeal('legacy') }; delete legacy.mealRevision
  const db = reviewDb([], { 'users/learner/mealLogs/legacy': legacy })
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  const auth = { uid: 'learner' }
  const saved = await api.saveNutritionMealLog({ auth, data: { meal: legacy, expectedMealRevision: 1 } })
  assert.equal(saved.mealRevision, 2)
  await assert.rejects(api.saveNutritionMealLog({ auth, data: { meal: loggedMeal('new'), expectedMealRevision: 0, expectedOwnerUid: 'previous-account' } }), { code: 'failed-precondition' })
  assert.ok(!db.records.has('users/learner/mealLogs/new'))
})

test('review reads recheck same-user authority after a warm request', async () => {
  const db = reviewDb([], staffRecords('coach'))
  const api = createNutritionReviewFunctions({ db, onCall: (...args) => args.at(-1) })
  await api.listNutritionMealReviews(staffRequest('coach', { section: 'page' }))
  db.records.set('roleAssignments/coach', { ...db.records.get('roleAssignments/coach'), status: 'suspended', authzVersion: 2 })
  await assert.rejects(api.listNutritionMealReviews(staffRequest('coach', { section: 'page' })), { code: 'permission-denied' })
})

test('nutrition review and session feedback overflow aliases use bounded regional profiles', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  assert.match(indexSource, /reviewCallOptions: \{ cpu: 'gcf_gen1', maxInstances: 2, concurrency: 1, timeoutSeconds: 60 \}/)
  assert.match(indexSource, /callOptions: \{ cpu: 'gcf_gen1', maxInstances: 2, concurrency: 1, timeoutSeconds: 60 \}/)
  for (const name of [
    'listNutritionMealReviews',
    'getMyPendingSessionFeedback',
    'listTrainerFeedbackAdmin',
  ]) {
    assert.match(indexSource, new RegExp(`exports\\.${name}Regional = `))
  }
})

test('coach workspace resolves tabs from primary, secondary and nutrition assignments', () => {
  const source = fs.readFileSync(path.join(__dirname, 'pt-operations-v2.js'), 'utf8')
  assert.match(source, /const staffCall = \(handler\) => onCall\(\{[\s\S]*?cpu: 1,[\s\S]*?concurrency: 24,[\s\S]*?maxInstances: 6,[\s\S]*?\.\.\.staffCallOptions,[\s\S]*?\}, handler\)/)
  assert.match(source, /const getMyCoachWorkspaceScope = staffCall/)
  assert.equal((source.match(/= staffCall\(/g) ?? []).length, 22)
  assert.match(source, /const getMyTrainerAvailability = staffCall/)
  assert.match(source, /const saveMyTrainerAvailability = staffCall/)
  assert.match(source, /const getPtTrainerAvailability = staffCall/)
  assert.match(source, /const savePtTrainerAvailability = staffCall/)
  assert.match(source, /const recordMySessionAttendance = staffCall/)
  assert.match(source, /const bulkConfirmMySessions = staffCall/)
  assert.match(source, /assignedContracts\(db, actor, 'training'/)
  assert.match(source, /assignedContracts\(db, actor, 'nutrition'/)
  assert.match(source, /source: 'pt_contract_assignments'/)
  assert.match(source, /primaryStudents/)
  assert.match(source, /secondaryStudents/)
  assert.doesNotMatch(source, /requireCapability\(actor, 'pt\.students\.assigned\.view'\)/)
})
