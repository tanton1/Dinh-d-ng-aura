'use strict'
const { createHash } = require('node:crypto')
const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { loggedMealSlots } = require('./meal-reminder-policy')

const clocks = new Map()
function localClock(time, timezone) {
  let formatter = clocks.get(timezone)
  if (!formatter) {
    try { formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) }
    catch { timezone = 'Asia/Ho_Chi_Minh'; formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) }
    if (clocks.size >= 100) clocks.delete(clocks.keys().next().value)
    clocks.set(timezone, formatter)
  }
  const p = Object.fromEntries(formatter.formatToParts(new Date(time)).map(item => [item.type, item.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), localMillis: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) }
}
const clockMinutes = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null
function isQuiet(minutes, start, end) {
  const a = clockMinutes(start), b = clockMinutes(end)
  if (a === null || b === null || a === b) return false
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b
}
function wallTime(date, minutes, timezone) {
  const target = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000
  let guess = target
  for (let i = 0; i < 4; i++) { const delta = target - localClock(guess, timezone).localMillis; if (!delta) return guess; guess += delta }
  const actual = localClock(guess, timezone)
  return actual.date === date && actual.minutes === minutes ? guess : null
}
function reminderPreferences(profile, settings) {
  const p = profile.notificationSettings || {}
  return { disabled: profile.disabled === true || p.enabled === false || p.mealReminders === false,
    timezone: p.timezone || settings.timezone || 'Asia/Ho_Chi_Minh',
    quiet: p.quietHoursEnabled !== false,
    quietStart: p.quietHoursStart || settings.quietHoursStart || '21:30', quietEnd: p.quietHoursEnd || settings.quietHoursEnd || '07:00',
    times: { ...settings.mealReminderTimes, ...(p.mealReminderTimes || {}), ...(profile.mealReminderTime ? { dinner: profile.mealReminderTime } : {}) } }
}
function scheduleFingerprint(profile, settings) {
  return createHash('sha256').update(JSON.stringify({ preferences: reminderPreferences(profile, settings), enabled: settings.enabled, automationEnabled: settings.automationEnabled, autoMealReminders: settings.autoMealReminders })).digest('hex')
}
function settingsFingerprint(settings) {
  return scheduleFingerprint({}, settings)
}
function nextReminderAt(profile, settings, after = Date.now()) {
  const p = reminderPreferences(profile, settings)
  if (p.disabled || settings.enabled === false || settings.automationEnabled === false || settings.autoMealReminders === false) return null
  const today = localClock(after, p.timezone).date
  let earliest = Infinity
  for (let day = 0; day < 3; day++) {
    const date = new Date(Date.parse(`${today}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10)
    for (const slot of ['breakfast', 'lunch', 'dinner']) {
      const minutes = clockMinutes(p.times[slot])
      if (minutes === null || (p.quiet && isQuiet(minutes, p.quietStart, p.quietEnd))) continue
      const candidate = wallTime(date, minutes, p.timezone)
      if (candidate !== null && candidate > after) earliest = Math.min(earliest, candidate)
    }
  }
  return Number.isFinite(earliest) ? earliest : null
}
function older(left, right) {
  return left && right && (left.seconds < right.seconds || (left.seconds === right.seconds && left.nanoseconds < right.nanoseconds))
}

async function syncReminderSchedule({ db, snapshot, settings, settingsVersion = null, now = Date.now() }) {
  const uid = snapshot.id
  const profile = snapshot.exists ? snapshot.data() : null
  const reference = db.doc(`nutritionReminderSchedules/${uid}`)
  const next = profile ? nextReminderAt(profile, settings, now) : null
  await db.runTransaction(async transaction => {
    const current = await transaction.get(reference)
    const old = current.data() || {}
    if (older(snapshot.updateTime, old.sourceVersion) || older(settingsVersion, old.settingsVersion)) return
    if (!profile || next === null) { if (current.exists) transaction.delete(reference); return }
    // A slow bootstrap/overlapping dispatcher must not rewind the schedule
    // already advanced by a newer worker for the same source preferences.
    if (old.fingerprint === scheduleFingerprint(profile, settings) && old.nextDueAt?.toMillis?.() > next) return
    transaction.set(reference, { uid, nextDueAt: Timestamp.fromMillis(next), sourceVersion: snapshot.updateTime || null,
      settingsVersion, fingerprint: scheduleFingerprint(profile, settings), updatedAt: FieldValue.serverTimestamp() })
  })
}

/** One resumable sweep on first rollout or a global schedule change. New and
 * changed profiles are maintained by a source trigger; steady-state dispatch
 * no longer scans every registered account. There is no 10,000-user cutoff. */
async function seedReminderSchedules({ db, settings, settingsVersion = null, now = Date.now(), pageSize = 500 }) {
  const reference = db.doc('systemJobs/nutritionReminderScheduleSeed')
  const state = await reference.get()
  const fingerprint = settingsFingerprint(settings)
  const sameGeneration = state.data()?.fingerprint === fingerprint
  if (sameGeneration && state.data()?.completed === true) return { scanned: 0, completed: true }
  const cursor = sameGeneration ? state.data()?.cursor || '' : ''
  const base = db.collection('users').orderBy(FieldPath.documentId()).limit(pageSize)
  const page = await (cursor ? base.startAfter(cursor) : base).get()
  for (let offset = 0; offset < page.docs.length; offset += 20) {
    await Promise.all(page.docs.slice(offset, offset + 20).map(snapshot => syncReminderSchedule({ db, snapshot, settings, settingsVersion, now })))
  }
  const completed = page.size < pageSize
  await reference.set({ fingerprint, cursor: page.docs.at(-1)?.id || cursor, completed, updatedAt: FieldValue.serverTimestamp() })
  return { scanned: page.size, completed }
}

async function loadDueReminderUsers({ db, settings, settingsVersion = null, now = Date.now(), limit = 1000 }) {
  const due = await db.collection('nutritionReminderSchedules').where('nextDueAt', '<=', Timestamp.fromMillis(now)).orderBy('nextDueAt').limit(limit).get()
  if (!due.size) return { users: [], dueTimes: new Map(), schedules: [] }
  const users = await db.getAll(...due.docs.map(row => db.doc(`users/${row.id}`)))
  const eligible = [], dueTimes = new Map()
  for (let index = 0; index < users.length; index++) {
    const snapshot = users[index], row = due.docs[index].data(), dueAt = row.nextDueAt?.toMillis?.()
    if (!snapshot.exists || row.fingerprint !== scheduleFingerprint(snapshot.data(), settings)
      || !Number.isFinite(dueAt) || dueAt < now - 60 * 60_000) {
      await syncReminderSchedule({ db, snapshot, settings, settingsVersion, now })
      continue
    }
    eligible.push(snapshot)
    dueTimes.set(snapshot.id, dueAt)
  }
  return { users: eligible, dueTimes, schedules: due.docs }
}

async function advanceReminderSchedules({ db, users, settings, settingsVersion, dueTimes, now = Date.now() }) {
  for (let offset = 0; offset < users.length; offset += 20) {
    await Promise.all(users.slice(offset, offset + 20).map(snapshot => {
      const processedSlot = dueTimes?.get(snapshot.id)
      // Advance from the processed slot, not completion time. Two user slots
      // may be one minute apart and the first batch may finish after both.
      return syncReminderSchedule({ db, snapshot, settings, settingsVersion, now: Number.isFinite(processedSlot) ? processedSlot + 1 : now })
    }))
  }
}

function slotsAtReminderTime(minutes, times) {
  return ['breakfast', 'lunch', 'dinner'].filter(slot => clockMinutes(times?.[slot]) === minutes)
}

async function loggedSlotsForDate(db, uid, date) {
  const slots = new Set()
  let cursor = null
  while (true) {
    const base = db.collection(`users/${uid}/mealLogs`).where('date', '==', date).orderBy(FieldPath.documentId()).limit(250)
    const page = await (cursor ? base.startAfter(cursor) : base).get()
    for (const slot of loggedMealSlots(page.docs)) slots.add(slot)
    if (page.size < 250 || ['breakfast', 'lunch', 'dinner'].every(slot => slots.has(slot))) return slots
    cursor = page.docs.at(-1)
  }
}

async function scheduledNotificationCount(db, uid, date) {
  // Only these three deterministic IDs are created by the meal scheduler.
  // Other inbox items cannot push an existing reminder outside a query limit.
  const rows = await db.getAll(...['breakfast', 'lunch', 'dinner'].map(slot => db.doc(`users/${uid}/notifications/meal_${date}_${slot}`)))
  return rows.filter(row => row.exists).length
}

module.exports = { localClock, wallTime, nextReminderAt, scheduleFingerprint, settingsFingerprint, syncReminderSchedule, seedReminderSchedules, loadDueReminderUsers, advanceReminderSchedules, loggedSlotsForDate, scheduledNotificationCount, slotsAtReminderTime }
