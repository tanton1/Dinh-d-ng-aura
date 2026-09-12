const test = require('node:test')
const assert = require('node:assert/strict')
const { Timestamp } = require('firebase-admin/firestore')
const { atOrBefore, sourceChanged, coalesceProjectionRebuild, upsertChangedTimeline } = require('./student-360-projection-writes')

function memoryDb() {
  const data = new Map()
  const writes = []
  const db = {
    time: 1000, data, writes,
    doc: (path) => ({ path }),
    async runTransaction(work) {
      const pending = []
      const read = async (ref) => ({ exists: data.has(ref.path), data: () => data.get(ref.path), readTime: Timestamp.fromMillis(db.time) })
      const result = await work({
        get: read, getAll: (...refs) => Promise.all(refs.map(read)),
        set: (ref, value, options) => pending.push([ref.path, options?.merge ? { ...data.get(ref.path), ...value } : value]),
      })
      for (const [path, value] of pending) { data.set(path, value); writes.push(path) }
      return result
    },
  }
  return db
}
const eventAt = (ms) => ({ data: { after: { exists: true, updateTime: Timestamp.fromMillis(ms) } } })

test('timeline rebuild only writes missing or materially changed events', async () => {
  const db = memoryDb()
  const events = Array.from({ length: 205 }, (_, id) => ({ id: String(id), metadata: { amount: id }, title: 'Buổi tập' }))
  assert.equal((await upsertChangedTimeline(db, events)).changed, 205)
  db.writes.length = 0
  assert.equal((await upsertChangedTimeline(db, structuredClone(events))).changed, 0)
  assert.equal(db.writes.length, 0)
  events[70] = { ...events[70], metadata: { amount: 25 } }
  assert.equal((await upsertChangedTimeline(db, events)).changed, 1)
  assert.equal(db.data.size, 205)
})

test('same commit mirrors/retries coalesce but a later commit rebuilds', async () => {
  const db = memoryDb()
  let builds = 0
  const run = (event) => coalesceProjectionRebuild({ db, studentId: 'a', event, rebuild: async () => { builds++ } })
  await run(eventAt(999))
  assert.equal((await run(eventAt(999))).rebuilt, false)
  db.time = 1002
  await run(eventAt(1001))
  assert.equal(builds, 2)
  await coalesceProjectionRebuild({ db, studentId: 'b', event: eventAt(999), rebuild: async () => { builds++ } })
  assert.equal(builds, 3, 'never coalesce another learner')
})

test('busy work retries, failures do not advance coverage, and expired leases recover', async () => {
  const db = memoryDb()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const first = coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(999), rebuild: () => gate, now: () => 1000 })
  await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(999), rebuild: async () => {}, now: () => 1001 }), { code: 'unavailable' })
  release()
  await first
  db.time = 2000
  await assert.rejects(coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(1999), rebuild: async () => { throw new Error('dependency') }, now: () => 2000 }), /dependency/)
  assert.equal(db.data.get('systemJobs/student360Rebuild/subjects/a').coveredThrough.toMillis(), 1000)
  db.data.set('systemJobs/student360Rebuild/subjects/a', { leaseUntil: Timestamp.fromMillis(1) })
  assert.equal((await coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(1999), rebuild: async () => {}, now: () => 2000 })).rebuilt, true)
})

test('a write during source loading is not accidentally covered by completion time', async () => {
  const db = memoryDb()
  await coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(999), rebuild: async () => { db.time = 3000 } })
  assert.equal((await coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(2000), rebuild: async () => {} })).rebuilt, true)
  assert.equal((await coalesceProjectionRebuild({ db, studentId: 'a', event: { data: { after: { exists: false } } }, rebuild: async () => {} })).rebuilt, true, 'delete never skipped without commit version')
})

test('watermarks retain nanoseconds and no-op source snapshots are ignored', () => {
  assert.equal(atOrBefore(new Timestamp(2, 3), new Timestamp(2, 2)), false)
  assert.equal(atOrBefore(null, Timestamp.now()), false)
  const snap = { exists: true, data: () => ({ revision: 4 }) }
  assert.equal(sourceChanged({ data: { before: snap, after: snap } }), false)
  assert.equal(sourceChanged({ data: { before: snap, after: { exists: false } } }), true)
})

test('500 check-ins with eight same-commit mirrors require 500 rather than 4000 rebuilds', async () => {
  const db = memoryDb()
  let builds = 0
  for (let student = 0; student < 500; student++) {
    for (let mirror = 0; mirror < 8; mirror++) {
      await coalesceProjectionRebuild({ db, studentId: `student-${student}`, event: eventAt(999), rebuild: async () => { builds++ } })
    }
  }
  assert.equal(builds, 500)
  assert.equal(db.data.size, 500, 'bounded one watermark document per learner')
})
