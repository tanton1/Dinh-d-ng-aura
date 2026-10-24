'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { Timestamp } = require('firebase-admin/firestore')
const { nextReminderAt, localClock, scheduleFingerprint, syncReminderSchedule, seedReminderSchedules, loadDueReminderUsers, advanceReminderSchedules, loggedSlotsForDate, scheduledNotificationCount, slotsAtReminderTime } = require('./nutrition-reminder-schedule')

const settings = { enabled: true, automationEnabled: true, autoMealReminders: true, timezone: 'Asia/Ho_Chi_Minh', quietHoursStart: '21:30', quietHoursEnd: '07:00', mealReminderTimes: { breakfast: '07:30', lunch: '12:00', dinner: '18:30' } }

test('legacy opt-in, strict next slot and timezone/quiet hours are retained', () => {
  const before = Date.parse('2026-10-24T00:29:00Z')
  assert.equal(new Date(nextReminderAt({}, settings, before)).toISOString(), '2026-10-24T00:30:00.000Z')
  assert.equal(new Date(nextReminderAt({}, settings, before + 60000)).toISOString(), '2026-10-24T05:00:00.000Z')
  assert.equal(nextReminderAt({ notificationSettings: { mealReminders: false } }, settings, before), null)
  assert.equal(nextReminderAt({ disabled: true }, settings, before), null)
  assert.equal(nextReminderAt({}, { ...settings, autoMealReminders: false }, before), null)
  const profile = { notificationSettings: { timezone: 'America/New_York', quietHoursEnabled: false } }
  const next = nextReminderAt(profile, settings, Date.parse('2026-03-08T06:50:00Z'))
  assert.equal(localClock(next, 'America/New_York').minutes, 450)
  assert.equal(new Date(next).toISOString(), '2026-03-08T11:30:00.000Z')
})

function fakeDb(users) {
  const docs = new Map(users.map(id => [`users/${id}`, {}]))
  const requested = []
  const snapshot = path => ({ id: path.split('/').at(-1), exists: docs.has(path), data: () => docs.get(path), updateTime: Timestamp.fromMillis(1) })
  const reference = path => ({ path, get: async () => snapshot(path), set: async (data, options) => docs.set(path, options?.merge ? { ...docs.get(path), ...data } : data) })
  const db = {
    doc: reference,
    getAll: async (...refs) => refs.map(ref => snapshot(ref.path)),
    runTransaction: async fn => fn({ get: ref => ref.get(), set: (ref, value) => docs.set(ref.path, value), delete: ref => docs.delete(ref.path) }),
    collection: name => {
      let cursor = '', maximum = 1000, dueAt = Infinity
      const q = { orderBy: () => q, startAfter: value => { cursor = value; return q }, limit: value => { maximum = value; return q },
        where: (_field, _operator, value) => { dueAt = value.toMillis(); return q }, get: async () => {
          requested.push({ name, cursor, maximum })
          const paths = [...docs.keys()].filter(path => path.startsWith(`${name}/`) && path.split('/').length === 2 && path.split('/')[1] > cursor)
            .filter(path => name !== 'nutritionReminderSchedules' || docs.get(path).nextDueAt.toMillis() <= dueAt).sort().slice(0, maximum)
          return { docs: paths.map(snapshot), size: paths.length }
        } }
      return q
    },
  }
  return { db, docs, requested }
}

test('bootstrap passes 10,000 accounts once, preserves defaults and stops scanning after completion', async () => {
  const f = fakeDb(Array.from({ length: 10003 }, (_, index) => `user${String(index).padStart(5, '0')}`))
  let completed = false, total = 0
  while (!completed) { const r = await seedReminderSchedules({ db: f.db, settings, now: Date.parse('2026-10-24T00:00:00Z') }); completed = r.completed; total += r.scanned }
  assert.equal(total, 10003)
  assert.ok(f.docs.has('nutritionReminderSchedules/user10002'))
  const beforeQueries = f.requested.length
  assert.equal((await seedReminderSchedules({ db: f.db, settings })).scanned, 0)
  assert.equal(f.requested.length, beforeQueries)
})

test('dispatch reads due profiles only and advances their next meal after successful processing', async () => {
  const f = fakeDb(['one', 'two', 'future'])
  const now = Date.parse('2026-10-24T05:00:30Z')
  for (const uid of ['one', 'two', 'future']) f.docs.set(`nutritionReminderSchedules/${uid}`, { nextDueAt: Timestamp.fromMillis(now + (uid === 'future' ? 60000 : -30000)), fingerprint: scheduleFingerprint({}, settings) })
  const due = await loadDueReminderUsers({ db: f.db, settings, now })
  assert.deepEqual(due.users.map(row => row.id), ['one', 'two'])
  assert.equal(f.requested.some(query => query.name === 'users'), false)
  await advanceReminderSchedules({ db: f.db, users: due.users, settings, now })
  assert.equal(f.docs.get('nutritionReminderSchedules/one').nextDueAt.toDate().toISOString(), '2026-10-24T11:30:00.000Z')
  assert.equal((await loadDueReminderUsers({ db: f.db, settings, now })).users.length, 0)
})

test('an older overlapping dispatcher cannot rewind the next reminder', async () => {
  const f = fakeDb(['one'])
  const snapshot = await f.db.doc('users/one').get()
  const lunch = Date.parse('2026-10-24T05:01:00Z')
  await syncReminderSchedule({ db: f.db, snapshot, settings, now: lunch })
  await syncReminderSchedule({ db: f.db, snapshot, settings, now: lunch - 60000 * 20 })
  assert.equal(f.docs.get('nutritionReminderSchedules/one').nextDueAt.toDate().toISOString(), '2026-10-24T11:30:00.000Z')
  // A real preference edit may intentionally move the next meal earlier.
  f.docs.set('users/one', { notificationSettings: { mealReminderTimes: { dinner: '17:00' } } })
  await syncReminderSchedule({ db: f.db, snapshot: await f.db.doc('users/one').get(), settings, now: lunch })
  assert.equal(f.docs.get('nutritionReminderSchedules/one').nextDueAt.toDate().toISOString(), '2026-10-24T10:00:00.000Z')
})

test('a logged meal beyond the first page still suppresses its reminder', async () => {
  const rows = Array.from({ length: 503 }, (_, index) => ({ id: String(index), data: () => ({ mealType: index === 502 ? 'dinner' : 'snack' }) }))
  let reads = 0
  const db = { collection: () => {
    let after = -1, maximum = Infinity
    const query = { where: () => query, orderBy: () => query, limit: n => { maximum = n; return query }, startAfter: doc => { after = Number(doc.id); return query },
      get: async () => { reads++; const docs = rows.slice(after + 1, after + 1 + maximum); return { docs, size: docs.length } } }
    return query
  } }
  const slots = await loggedSlotsForDate(db, 'one', '2026-10-24')
  assert.equal(slots.has('dinner'), true)
  assert.equal(slots.has('breakfast'), false)
  assert.equal(reads, 3)
})

test('daily reminder count uses all deterministic meal IDs, independent of inbox volume', async () => {
  const requested = []
  const db = { doc: path => ({ path }), getAll: async (...refs) => { requested.push(...refs.map(ref => ref.path)); return refs.map(ref => ({ exists: /_(breakfast|dinner)$/.test(ref.path) })) } }
  assert.equal(await scheduledNotificationCount(db, 'one', '2026-10-24'), 2)
  assert.equal(requested.length, 3)
  assert.ok(requested.every(path => path.startsWith('users/one/notifications/meal_2026-10-24_')))
})

test('adjacent meal times survive a slow dispatcher without older slots consuming the daily allowance', async () => {
  const f = fakeDb(['one'])
  const closeSlots = { ...settings, mealReminderTimes: { breakfast: '07:30', lunch: '07:31', dinner: '18:30' } }
  const firstSlot = Date.parse('2026-10-24T00:30:00Z')
  const profile = await f.db.doc('users/one').get()
  await advanceReminderSchedules({ db: f.db, users: [profile], settings: closeSlots, dueTimes: new Map([['one', firstSlot]]), now: firstSlot + 120000 })
  assert.equal(f.docs.get('nutritionReminderSchedules/one').nextDueAt.toMillis(), firstSlot + 60000)
  assert.deepEqual(slotsAtReminderTime(451, closeSlots.mealReminderTimes), ['lunch'])
})

test('malformed legacy clock values cannot poison the resumable account bootstrap', async () => {
  const f = fakeDb(['malformed', 'valid'])
  f.docs.set('users/malformed', { notificationSettings: { mealReminderTimes: { breakfast: ['07:30'], lunch: 1200, dinner: {} } } })
  const result = await seedReminderSchedules({ db: f.db, settings, now: Date.parse('2026-10-24T00:00:00Z') })
  assert.equal(result.scanned, 2)
  assert.equal(result.completed, true)
  assert.equal(f.docs.has('nutritionReminderSchedules/malformed'), false)
  assert.equal(f.docs.has('nutritionReminderSchedules/valid'), true)
})
