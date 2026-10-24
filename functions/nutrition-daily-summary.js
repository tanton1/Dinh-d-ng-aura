'use strict'

const { randomUUID } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { withFunctionTelemetry } = require('./observability')

const SCHEMA_VERSION = 2
const PAGE_SIZE = 250
const MAX_DAY_DOCUMENTS = 10_000
const MAX_REQUEST_DOCUMENTS = 20_000
const REQUEST_WORK_MS = 40_000
const LEASE_MS = 90_000
const SOURCE_COLLECTIONS = ['mealLogs', 'waterLogs', 'activityLogs']
const SOURCE_FIELDS = {
  mealLogs: ['date', 'status', 'deleted', 'type', 'time', 'calories', 'protein', 'carbs', 'fat', 'confidence', 'source', 'reviewStatus'],
  waterLogs: ['date', 'deleted', 'status', 'amountMl'],
  activityLogs: ['date', 'deleted', 'status', 'durationMinutes'],
}
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0

function dateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null
}

function rangeDates(from, to) {
  if (!dateKey(from) || !dateKey(to) || from > to) throw new HttpsError('invalid-argument', 'Khoảng ngày nhật ký không hợp lệ.')
  const count = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  if (count > 31) throw new HttpsError('invalid-argument', 'Mỗi lần chỉ đọc tối đa 31 ngày nhật ký.')
  return Array.from({ length: count }, (_, index) => new Date(Date.parse(`${from}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10))
}

function summarizeDay(date, records) {
  const mealOccasions = { breakfast: false, lunch: false, dinner: false, snackCount: 0 }
  const snackTimes = new Set()
  const result = { date, mealCount: 0, calories: 0, protein: 0, carbs: 0, fat: 0, waterMl: 0, activityCount: 0, activityMinutes: 0, reviewCount: 0, mealOccasions }
  for (const meal of records.mealLogs || []) {
    // Progress counts meal occasions, not dishes: three lunch entries do not
    // replace breakfast and dinner. Legacy entries without status still count
    // as occasions, matching progress; diary nutrient semantics stay unchanged.
    if (meal.date === date && (!meal.status || meal.status === 'logged') && meal.deleted !== true) {
      if (['breakfast', 'lunch', 'dinner'].includes(meal.type)) mealOccasions[meal.type] = true
      if (meal.type === 'snack') snackTimes.add(meal.time)
    }
    if (meal.date !== date || meal.status !== 'logged' || meal.deleted === true) continue
    result.mealCount++
    for (const field of ['calories', 'protein', 'carbs', 'fat']) result[field] += numeric(meal[field])
    const confidence = meal.confidence ?? (meal.source === 'ai-scan' ? 'estimated' : 'verified')
    if (['pending', 'rejected'].includes(meal.reviewStatus) || confidence !== 'verified') result.reviewCount++
  }
  mealOccasions.snackCount = snackTimes.size
  for (const entry of records.waterLogs || []) {
    if (entry.date === date && entry.deleted !== true && entry.status !== 'deleted') result.waterMl += numeric(entry.amountMl)
  }
  for (const entry of records.activityLogs || []) {
    if (entry.date !== date || entry.deleted === true || entry.status === 'deleted') continue
    result.activityCount++
    result.activityMinutes += numeric(entry.durationMinutes)
  }
  // Keep the same unrounded totals as the diary. Rounding is a presentation concern.
  return result
}

function atOrBefore(left, right) {
  return left && right && Number.isFinite(left.seconds) && Number.isFinite(right.seconds)
    && (left.seconds < right.seconds || (left.seconds === right.seconds && left.nanoseconds <= right.nanoseconds))
}

function publicSummary(value) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION || value.status !== 'ready') return null
  const fields = ['date', 'mealCount', 'calories', 'protein', 'carbs', 'fat', 'waterMl', 'activityCount', 'activityMinutes', 'reviewCount', 'mealOccasions', 'revision']
  return { ...Object.fromEntries(fields.map(field => [field, value[field]])), updatedAt: value.updatedAt?.toDate?.().toISOString() || null }
}

function pendingBudgetError() {
  return new HttpsError('resource-exhausted', 'Nhật ký đang được tổng hợp theo từng đợt. Hãy chờ thêm một chút.', { kind: 'nutrition_summary_budget', retryAfterMs: 1500 })
}

async function readDaySource(db, uid, date, collection, budget, onRead, requestBudget) {
  let cursor = null
  const values = []
  while (true) {
    if (requestBudget && (requestBudget.remaining <= 0 || requestBudget.now() >= requestBudget.deadlineAt)) throw pendingBudgetError()
    // Reserve before the read. One extra record detects a too-large day; it
    // must never be returned as a complete total after a silent truncation.
    const limit = Math.min(PAGE_SIZE, MAX_DAY_DOCUMENTS + 1 - budget.count, requestBudget?.remaining ?? PAGE_SIZE)
    if (requestBudget) requestBudget.remaining -= limit
    const base = db.collection(`users/${uid}/${collection}`).where('date', '==', date).orderBy(FieldPath.documentId()).select(...SOURCE_FIELDS[collection]).limit(limit)
    const snapshot = await (cursor ? base.startAfter(cursor) : base).get()
    if (requestBudget) requestBudget.remaining += limit - snapshot.size
    budget.count += snapshot.size
    if (onRead) onRead(collection, snapshot.size)
    if (budget.count > MAX_DAY_DOCUMENTS) throw new HttpsError('resource-exhausted', 'Nhật ký ngày này cần được đối soát thêm trước khi tính tổng.', { kind: 'nutrition_summary_partial' })
    values.push(...snapshot.docs.map(document => document.data()))
    if (snapshot.size < limit) return values
    cursor = snapshot.docs.at(-1)
  }
}

/** A rebuild reads only one owner's day. The read-time watermark is captured
 * BEFORE source queries; a commit during rebuilding must receive another
 * retry-enabled event. Deletes always rebuild. A fencing token prevents a
 * worker whose lease expired from overwriting a newer worker's result. */
async function rebuildNutritionDay({ db, uid, date, sourceVersion = null, force = false, now = Date.now, onRead, afterRead, requestBudget }) {
  if (!dateKey(date) || !uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'Nhật ký không hợp lệ.')
  const reference = db.doc(`users/${uid}/nutritionDailySummaries/${date}`)
  const token = randomUUID()
  const claim = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference)
    const state = snapshot.data() || {}
    if (state.leaseUntil?.toMillis?.() > now()) throw new HttpsError('unavailable', 'Tổng hợp nhật ký đang được cập nhật.', { kind: 'nutrition_summary_pending', retryAfterMs: 1500 })
    if (!force && state.schemaVersion === SCHEMA_VERSION && state.status === 'ready'
      && (!sourceVersion || atOrBefore(sourceVersion, state.coveredThrough))) return { existing: state }
    if (!force && state.schemaVersion === SCHEMA_VERSION && state.status === 'partial'
      && (!sourceVersion || atOrBefore(sourceVersion, state.failedThrough))) return { partial: state }
    transaction.set(reference, { schemaVersion: SCHEMA_VERSION, date, status: 'rebuilding', leaseToken: token, leaseUntil: Timestamp.fromMillis(now() + LEASE_MS) }, { merge: true })
    return { coveredThrough: snapshot.readTime || Timestamp.fromMillis(now()), revision: numeric(state.revision) + 1 }
  })
  if (claim.existing) return { rebuilt: false, summary: publicSummary(claim.existing), coveredThrough: claim.existing.coveredThrough }
  if (claim.partial) return { rebuilt: false, partial: true, coveredThrough: claim.partial.failedThrough }
  try {
    const records = {}
    const budget = { count: 0 }
    // A single shared budget applies to all sources, not one limit per query.
    for (const collection of SOURCE_COLLECTIONS) records[collection] = await readDaySource(db, uid, date, collection, budget, onRead, requestBudget)
    if (afterRead) await afterRead()
    const totals = summarizeDay(date, records)
    await db.runTransaction(async transaction => {
      const state = await transaction.get(reference)
      if (state.data()?.leaseToken !== token) throw new HttpsError('unavailable', 'Tổng hợp nhật ký cần được thử lại.')
      transaction.set(reference, { ...totals, schemaVersion: SCHEMA_VERSION, status: 'ready', revision: claim.revision, coveredThrough: claim.coveredThrough,
        updatedAt: FieldValue.serverTimestamp(), leaseToken: null, leaseUntil: null })
    })
    return { rebuilt: true, sourceDocuments: budget.count, coveredThrough: claim.coveredThrough, summary: { ...totals, revision: claim.revision, updatedAt: new Date(now()).toISOString() } }
  } catch (error) {
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference)
      if (snapshot.data()?.leaseToken === token) transaction.set(reference, {
        status: error?.details?.kind === 'nutrition_summary_partial' ? 'partial' : 'pending',
        failedThrough: claim.coveredThrough, leaseToken: null, leaseUntil: null,
      }, { merge: true })
    }).catch(() => {})
    throw error
  }
}

function sourceTotals(value, collection) {
  if (!value) return null
  const fields = SOURCE_FIELDS[collection] || SOURCE_FIELDS.activityLogs
  return Object.fromEntries(fields.map(key => [key, key === 'time' ? [typeof value[key], value[key] ?? null] : value[key] ?? null]))
}

async function syncNutritionDailySummary({ db, event, collection, logger = console }) {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after = event.data?.after?.exists ? event.data.after.data() : null
  if (isDeepStrictEqual(sourceTotals(before, collection), sourceTotals(after, collection))) return { skipped: true }
  const uid = event.params?.accountUid || event.params?.userId
  const dates = [...new Set([before?.date, after?.date].filter(dateKey))]
  const results = []
  for (const date of dates) results.push(await rebuildNutritionDay({ db, uid, date,
    sourceVersion: after ? event.data.after.updateTime : null, force: !after }))
  logger.info('nutrition_daily_summary_sync', { dates: dates.length, rebuilt: results.filter(item => item.rebuilt).length, sourceDocuments: results.reduce((sum, item) => sum + (item.sourceDocuments || 0), 0) })
  return { dates: dates.length, rebuilt: results.filter(item => item.rebuilt).length }
}

function refreshBoundary(value, now) {
  if (value === undefined || value === null) return null
  const parsed = typeof value === 'string' && value.length <= 40 ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(parsed) || parsed > now + 5000 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw new HttpsError('invalid-argument', 'Mốc cập nhật nhật ký không hợp lệ.')
  return Timestamp.fromMillis(parsed)
}

function createNutritionSummaryFunctions({ db, onCall, requireOwner, now = Date.now }) {
  const getMyNutritionJournalSummary = onCall({ cpu: 'gcf_gen1', maxInstances: 6, timeoutSeconds: 60 }, withFunctionTelemetry('getMyNutritionJournalSummary', async request => {
    const uid = await requireOwner(request)
    const dates = rangeDates(request.data?.fromDate, request.data?.toDate)
    const suppliedBoundary = refreshBoundary(request.data?.refreshAfter, now())
    const boundary = request.data?.forceRefresh === true ? Timestamp.fromMillis(now()) : suppliedBoundary
    const requestBudget = { remaining: MAX_REQUEST_DOCUMENTS, deadlineAt: now() + REQUEST_WORK_MS, now }
    const snapshots = await db.getAll(...dates.map(date => db.doc(`users/${uid}/nutritionDailySummaries/${date}`)))
    const items = new Map()
    const missing = []
    let coverage = 'ready'
    snapshots.forEach((snapshot, index) => {
      const value = snapshot.data()
      const ready = publicSummary(value)
      if (ready && (!boundary || atOrBefore(boundary, value.coveredThrough)) && !(value.leaseUntil?.toMillis?.() > now())) items.set(dates[index], ready)
      else if (value?.schemaVersion === SCHEMA_VERSION && value.status === 'partial' && (!boundary || atOrBefore(boundary, value.failedThrough))) coverage = 'partial'
      else missing.push(dates[index])
    })
    // Cold days run sequentially so one large day can finish before the shared
    // budget is exhausted. Completed days persist, allowing polling to resume.
    // Warm calendar reads remain one batch of 7/31 summary documents.
    for (const date of missing) {
      if (requestBudget.remaining <= 0 || now() >= requestBudget.deadlineAt) { if (coverage !== 'partial') coverage = 'pending'; break }
      try {
        const result = await rebuildNutritionDay({ db, uid, date, sourceVersion: boundary, now, requestBudget })
        if (result.partial) coverage = 'partial'
        else if (boundary && !atOrBefore(boundary, result.coveredThrough)) { if (coverage !== 'partial') coverage = 'pending' }
        else items.set(date, result.summary)
      } catch (error) {
        if (error?.details?.kind === 'nutrition_summary_partial') coverage = 'partial'
        else if (['nutrition_summary_pending', 'nutrition_summary_budget'].includes(error?.details?.kind) || error?.code === 'unavailable') { if (coverage !== 'partial') coverage = 'pending' }
        else throw error
      }
    }
    return { fromDate: dates[0], toDate: dates.at(-1), coverage, items: dates.map(date => items.get(date)).filter(Boolean), ...(boundary ? { refreshAfter: boundary.toDate().toISOString() } : {}),
      ...(coverage !== 'ready' ? { retryAfterMs: 1500 } : {}), sourceDocuments: MAX_REQUEST_DOCUMENTS - requestBudget.remaining }
  }))
  return { getMyNutritionJournalSummary }
}

module.exports = { SCHEMA_VERSION, SOURCE_COLLECTIONS, MAX_REQUEST_DOCUMENTS, dateKey, rangeDates, summarizeDay, sourceTotals, publicSummary, refreshBoundary, rebuildNutritionDay, syncNutritionDailySummary, createNutritionSummaryFunctions }
