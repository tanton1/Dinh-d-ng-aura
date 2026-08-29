'use strict'

const { createHash } = require('node:crypto')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')

const AGGREGATE_COLLECTION = 'operationsDailyAggregates'
const COVERAGE_COLLECTION = 'operationsAggregateCoverage'
const COVERAGE_DOCUMENT = 'dashboard-v1'
const AGGREGATE_SCHEMA_VERSION = 1
const MAX_REBUILD_DOCUMENTS = 20_000

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
})

function millis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const parsed = new Date(value || 0).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function storedDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const time = millis(value)
  return time ? formatter.format(new Date(time)) : ''
}

function normalizedBranchId(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : '__none__'
}

function aggregateDocumentId(date, branchId) {
  const branchHash = createHash('sha1').update(branchId).digest('hex').slice(0, 14)
  return `${date}_${branchHash}`
}

function finite(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function ledgerReceiptImpact(value) {
  if (!['payment', 'refund', 'reversal', 'adjustment'].includes(value.type)) return 0
  if (value.cashImpact !== undefined && value.cashImpact !== null) return finite(value.cashImpact)
  return finite(value.amount)
}

function ledgerRevenueImpact(value) {
  if (value.revenueImpact !== undefined && value.revenueImpact !== null) return finite(value.revenueImpact)
  return value.type === 'revenue_recognition' ? finite(value.amount) : 0
}

function contractEffectiveDate(value) {
  return value.signedAt || value.createdAt || value.contractDate || value.startDate || null
}

function contribution(source, value) {
  if (!value || typeof value !== 'object') return null
  const branchId = normalizedBranchId(value.branchId)
  if (source === 'ledger') {
    if (!['posted', 'reversed'].includes(value.status)) return null
    const date = storedDate(value.effectiveAt)
    if (!date) return null
    const receipt = ledgerReceiptImpact(value)
    return { date, branchId, metrics: {
      ledgerEntries: 1,
      cashCollected: value.type === 'payment' && receipt > 0 ? receipt : 0,
      refunds: value.type === 'refund' && receipt < 0 ? Math.abs(receipt) : 0,
      reversals: value.type === 'reversal' && receipt < 0 ? Math.abs(receipt) : 0,
      adjustments: value.type === 'adjustment' ? receipt : 0,
      netCash: receipt,
      grossCash: value.type === 'payment' && receipt > 0 ? receipt : 0,
      recognizedRevenue: ledgerRevenueImpact(value),
    } }
  }
  if (source === 'session') {
    const date = storedDate(value.date)
    if (!date) return null
    const status = typeof value.status === 'string' && value.status ? value.status.replace(/[^a-z0-9_]/gi, '_').slice(0, 50) : 'unknown'
    const confirmed = ['completed', 'attended', 'no_show'].includes(value.status)
    return { date, branchId, metrics: {
      sessions: 1,
      confirmedSessions: confirmed ? 1 : 0,
      noShowSessions: value.status === 'no_show' ? 1 : 0,
      [`sessionStatus__${status}`]: 1,
    } }
  }
  if (source === 'attendance') {
    const date = storedDate(value.occurredAt || value.date)
    return date ? { date, branchId, metrics: { attendanceEvents: 1 } } : null
  }
  if (source === 'contract') {
    if (['draft', 'cancelled', 'inactive', 'archived'].includes(value.status)) return null
    const date = storedDate(contractEffectiveDate(value))
    if (!date) return null
    return { date, branchId, metrics: { contractSales: Math.max(0, finite(value.totalPrice) - finite(value.discount)) } }
  }
  if (source === 'student') {
    const date = storedDate(value.joinDate || value.createdAt)
    return date ? { date, branchId, metrics: { newStudents: 1 } } : null
  }
  return null
}

function mergeMetric(target, name, amount) {
  const next = finite(target[name]) + finite(amount)
  target[name] = Math.abs(next) < 0.000001 ? 0 : next
}

function contributionDeltas(before, after) {
  const buckets = new Map()
  const add = (item, sign) => {
    if (!item) return
    const key = `${item.date}|${item.branchId}`
    const current = buckets.get(key) || { date: item.date, branchId: item.branchId, metrics: {} }
    Object.entries(item.metrics).forEach(([name, amount]) => mergeMetric(current.metrics, name, sign * finite(amount)))
    buckets.set(key, current)
  }
  add(before, -1)
  add(after, 1)
  return [...buckets.values()].filter((item) => Object.values(item.metrics).some((amount) => amount !== 0))
}

async function syncDailyAggregateWrite({ db, source, event, logger = console }) {
  const before = event.data?.before?.exists ? contribution(source, event.data.before.data()) : null
  const after = event.data?.after?.exists ? contribution(source, event.data.after.data()) : null
  const deltas = contributionDeltas(before, after)
  if (!deltas.length) return { updated: 0 }
  await db.runTransaction(async (transaction) => {
    // Reading the rebuild marker in the same transaction closes the race where
    // an incremental trigger could otherwise commit while the scheduled job
    // is replacing absolute bucket values. Retried triggers resume after the
    // coverage document returns to ready.
    const coverageReference = db.collection(COVERAGE_COLLECTION).doc(COVERAGE_DOCUMENT)
    const coverage = await transaction.get(coverageReference)
    if (coverage.data()?.status === 'building') throw new Error('OPERATIONS_AGGREGATE_REBUILD_IN_PROGRESS')
    deltas.forEach((item) => {
      const metrics = Object.fromEntries(Object.entries(item.metrics).map(([name, amount]) => [name, FieldValue.increment(amount)]))
      const reference = db.collection(AGGREGATE_COLLECTION).doc(aggregateDocumentId(item.date, item.branchId))
      transaction.set(reference, {
        schemaVersion: AGGREGATE_SCHEMA_VERSION,
        date: item.date,
        branchId: item.branchId,
        metrics,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
  })
  logger.info('operations_daily_aggregate_synced', { source, updated: deltas.length })
  return { updated: deltas.length }
}

function scopeIncludes(branchId, scope) {
  if (scope.unrestricted) return true
  if (scope.branchId === 'none') return branchId === '__none__'
  return scope.branchIds.includes(branchId)
}

async function loadDailyAggregates({ db, startDate, endDate, scope }) {
  const coverageSnapshot = await db.collection(COVERAGE_COLLECTION).doc(COVERAGE_DOCUMENT).get()
  const coverage = coverageSnapshot.data() || {}
  if (!coverageSnapshot.exists || coverage.status !== 'ready' || coverage.complete !== true
    || coverage.startDate > startDate || coverage.endDate < endDate) return null
  const snapshot = await db.collection(AGGREGATE_COLLECTION)
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .limit(20_000)
    .get()
  if (snapshot.size >= 20_000) return null
  const days = new Map()
  const totals = {}
  for (const item of snapshot.docs) {
    const value = item.data() || {}
    if (!scopeIncludes(value.branchId, scope)) continue
    const day = days.get(value.date) || { date: value.date, metrics: {} }
    Object.entries(value.metrics || {}).forEach(([name, amount]) => {
      mergeMetric(day.metrics, name, amount)
      mergeMetric(totals, name, amount)
    })
    days.set(value.date, day)
  }
  const sessionStatus = {}
  Object.entries(totals).forEach(([name, amount]) => {
    if (name.startsWith('sessionStatus__')) sessionStatus[name.slice('sessionStatus__'.length)] = Math.max(0, finite(amount))
  })
  return {
    days: [...days.values()].sort((left, right) => left.date.localeCompare(right.date)),
    totals,
    sessionStatus,
    coverage: {
      startDate: coverage.startDate,
      endDate: coverage.endDate,
      generatedAt: coverage.generatedAt?.toDate?.().toISOString?.() || '',
    },
  }
}

function dateKey(date) {
  return formatter.format(date)
}

async function rebuildOperationsDailyAggregates({ db, logger = console, days = 366 }) {
  const now = new Date()
  const start = new Date(now)
  start.setDate(start.getDate() - Math.max(1, Math.min(366, days)) + 1)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  const startDate = dateKey(start)
  const endDate = dateKey(end)
  const coverageReference = db.collection(COVERAGE_COLLECTION).doc(COVERAGE_DOCUMENT)
  await coverageReference.set({
    schemaVersion: AGGREGATE_SCHEMA_VERSION,
    status: 'building', startDate, endDate, startedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  const limit = MAX_REBUILD_DOCUMENTS + 1
  const [ledger, sessions, attendance, contracts, students] = await Promise.all([
    db.collection('ledgerEntries').where('effectiveAt', '>=', Timestamp.fromDate(start)).where('effectiveAt', '<=', Timestamp.fromDate(end)).limit(limit).get(),
    db.collection('sessions').where('date', '>=', startDate).where('date', '<=', endDate).limit(limit).get(),
    db.collection('attendanceEvents').where('occurredAt', '>=', Timestamp.fromDate(start)).where('occurredAt', '<=', Timestamp.fromDate(end)).limit(limit).get(),
    db.collection('contracts').limit(limit).get(),
    db.collection('students').limit(limit).get(),
  ])
  const snapshots = [
    ['ledger', ledger], ['session', sessions], ['attendance', attendance], ['contract', contracts], ['student', students],
  ]
  const groups = new Map()
  snapshots.forEach(([source, snapshot]) => snapshot.docs.slice(0, MAX_REBUILD_DOCUMENTS).forEach((item) => {
    const next = contribution(source, item.data())
    if (!next || next.date < startDate || next.date > endDate) return
    const key = `${next.date}|${next.branchId}`
    const group = groups.get(key) || { date: next.date, branchId: next.branchId, metrics: {} }
    Object.entries(next.metrics).forEach(([name, amount]) => mergeMetric(group.metrics, name, amount))
    groups.set(key, group)
  }))
  const complete = snapshots.every(([, snapshot]) => snapshot.size <= MAX_REBUILD_DOCUMENTS)
  const previous = await db.collection(AGGREGATE_COLLECTION).where('date', '>=', startDate).where('date', '<=', endDate).limit(20_000).get()
  const writer = db.bulkWriter()
  previous.docs.forEach((item) => writer.delete(item.ref))
  groups.forEach((item) => writer.set(db.collection(AGGREGATE_COLLECTION).doc(aggregateDocumentId(item.date, item.branchId)), {
    schemaVersion: AGGREGATE_SCHEMA_VERSION,
    date: item.date,
    branchId: item.branchId,
    metrics: item.metrics,
    updatedAt: FieldValue.serverTimestamp(),
  }))
  await writer.close()
  const sourceCounts = Object.fromEntries(snapshots.map(([source, snapshot]) => [source, Math.min(snapshot.size, MAX_REBUILD_DOCUMENTS)]))
  await coverageReference.set({
    schemaVersion: AGGREGATE_SCHEMA_VERSION,
    status: 'ready', complete, startDate, endDate, sourceCounts,
    generatedAt: FieldValue.serverTimestamp(),
  })
  logger.info('operations_daily_aggregates_rebuilt', { startDate, endDate, complete, buckets: groups.size, sourceCounts })
  return { startDate, endDate, complete, buckets: groups.size, sourceCounts }
}

module.exports = {
  AGGREGATE_COLLECTION,
  contribution,
  contributionDeltas,
  loadDailyAggregates,
  rebuildOperationsDailyAggregates,
  syncDailyAggregateWrite,
}
