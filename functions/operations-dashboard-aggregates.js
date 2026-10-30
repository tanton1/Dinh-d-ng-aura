'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { readDashboardQuery } = require('./operations-dashboard-read-policy')
const { visitAggregateSourcePages } = require('./operations-aggregate-source-pages')
const { ledgerReceiptImpact } = require('./finance-receipt-impact')
const { contractSalesContribution } = require('./contract-financial-status')

// Isolate v2 from old in-flight trigger/scheduler revisions. A rolling deploy
// (or rollback) must never let a v1 delta writer corrupt the v2 baseline.
const AGGREGATE_COLLECTION = 'operationsDailyAggregatesV2'
const COVERAGE_COLLECTION = 'operationsAggregateCoverage'
const COVERAGE_DOCUMENT = 'dashboard-v2'
const CONTRIBUTION_COLLECTION = 'operationsAggregateContributions'
const AGGREGATE_SCHEMA_VERSION = 2
const MAX_REBUILD_BUCKETS = 20_000
const REBUILD_LOCK_MILLIS = 20 * 60 * 1000
const REBUILD_BATCH_SIZE = 300
// Leave room for an in-flight request and failure publication before the
// scheduler's 540-second hard timeout. Failed scans never publish coverage.
const REBUILD_BUDGET_MILLIS = 7 * 60 * 1000
const SOURCE_COLLECTIONS = {
  ledger: 'ledgerEntries', session: 'sessions', attendance: 'attendanceEvents', contract: 'contracts', student: 'students',
}
// Keep the repair scan limited to fields used by contribution(). Business
// payloads (notes, lesson content, attachments, etc.) are not reporting inputs.
const REBUILD_SOURCE_FIELDS = {
  ledger: ['branchId', 'status', 'type', 'source', 'eventClass', 'effectiveAt', 'cashImpact', 'amount', 'revenueImpact', 'expenseImpact', 'contractSalesImpact'],
  session: ['branchId', 'date', 'status'],
  attendance: ['branchId', 'occurredAt', 'date'],
  contract: ['branchId', 'status', 'signedAt', 'createdAt', 'contractDate', 'startDate', 'totalPrice', 'discount', 'salesCancellationSnapshot'],
  student: ['branchId', 'joinDate', 'createdAt'],
}

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
    const salesAdjustment = Number.isSafeInteger(value.contractSalesImpact) ? value.contractSalesImpact : 0
    return { date, branchId, metrics: {
      ledgerEntries: 1,
      cashCollected: value.type === 'payment' && receipt > 0 ? receipt : 0,
      refunds: value.type === 'refund' && receipt < 0 ? Math.abs(receipt) : 0,
      reversals: value.type === 'reversal' && receipt < 0 ? Math.abs(receipt) : 0,
      adjustments: value.type === 'adjustment' ? receipt : 0,
      netCash: receipt,
      grossCash: value.type === 'payment' && receipt > 0 ? receipt : 0,
      recognizedRevenue: ledgerRevenueImpact(value),
      ...(salesAdjustment ? { contractSales: salesAdjustment, salesAdjustment } : {}),
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
    const sale = contractSalesContribution(value)
    if (!sale) return null
    const date = storedDate(sale.effectiveAt)
    if (!date) return null
    return { date, branchId, metrics: { contractSales: sale.amount } }
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
  // A metadata-only write cannot affect any bucket. Keep this zero-read path.
  if (!contributionDeltas(before, after).length) return { updated: 0 }
  const sourcePath = event.data?.after?.ref?.path || event.data?.before?.ref?.path || ''
  const [collection, id, extra] = sourcePath.split('/')
  if (!SOURCE_COLLECTIONS[source] || collection !== SOURCE_COLLECTIONS[source] || !id || extra) {
    throw new Error('OPERATIONS_AGGREGATE_INVALID_SOURCE_REFERENCE')
  }
  const result = await db.runTransaction(async (transaction) => {
    const coverageReference = db.collection(COVERAGE_COLLECTION).doc(COVERAGE_DOCUMENT)
    const coverage = await transaction.get(coverageReference)
    const version = coverage.data() || {}
    if (version.status === 'building') throw new Error('OPERATIONS_AGGREGATE_REBUILD_IN_PROGRESS')
    // Existing v1 totals have no per-document baseline. Never mix them with v2
    // updates or initialize from a single event. The reader uses source queries
    // until the scheduled/explicit rebuild establishes complete coverage.
    if (!usableCoverage(version)) return { updated: 0, reason: 'awaiting_rebuild' }
    const reference = db.collection(CONTRIBUTION_COLLECTION).doc(contributionDocumentId(sourcePath))
    const [stored, current] = await Promise.all([
      transaction.get(reference), transaction.get(db.collection(collection).doc(id)),
    ])
    const prior = stored.data()?.generation === version.generation ? stored.data().contribution : null
    const next = current.exists ? rangedContribution(source, current.data(), version) : null
    // Reconcile the live document, NOT event.before/event.after. Duplicate and
    // out-of-order delivery therefore converge to the same state, including
    // deletions and delete/recreate. The generation baseline also absorbs
    // delayed events whose changes were already included in a full rebuild.
    const deltas = contributionDeltas(prior, next)
    if (!deltas.length) return { updated: 0 }
    deltas.forEach((item) => {
      const metrics = Object.fromEntries(Object.entries(item.metrics).map(([name, amount]) => [name, FieldValue.increment(amount)]))
      const reference = db.collection(AGGREGATE_COLLECTION).doc(aggregateDocumentId(item.date, item.branchId))
      transaction.set(reference, {
        schemaVersion: AGGREGATE_SCHEMA_VERSION,
        generation: version.generation,
        date: item.date,
        branchId: item.branchId,
        metrics,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
    transaction.set(reference, {
      schemaVersion: AGGREGATE_SCHEMA_VERSION, generation: version.generation,
      sourcePath, contribution: next, updatedAt: FieldValue.serverTimestamp(),
    })
    return { updated: deltas.length }
  })
  logger.info('operations_daily_aggregate_synced', { source, ...result })
  return result
}

function usableCoverage(value) {
  return value.schemaVersion === AGGREGATE_SCHEMA_VERSION && value.status === 'ready'
    && value.complete === true && typeof value.generation === 'string' && value.generation.length > 0
    && typeof value.startDate === 'string' && typeof value.endDate === 'string'
}

function contributionDocumentId(sourcePath) {
  return createHash('sha256').update(sourcePath).digest('hex')
}

function rangedContribution(source, value, range) {
  const next = contribution(source, value)
  return next && next.date >= range.startDate && next.date <= range.endDate ? next : null
}

function scopeIncludes(branchId, scope) {
  if (scope.unrestricted) return true
  if (scope.branchId === 'none') return branchId === '__none__'
  return scope.branchIds.includes(branchId)
}

async function loadDailyAggregates({ db, startDate, endDate, scope }) {
  const coverageSnapshot = await db.collection(COVERAGE_COLLECTION).doc(COVERAGE_DOCUMENT).get()
  const coverage = coverageSnapshot.data() || {}
  if (!coverageSnapshot.exists || !usableCoverage(coverage)
    || coverage.startDate > startDate || coverage.endDate < endDate) return null
  // Every v2 bucket has a normalized scalar branchId, including __none__.
  // Apply scope before the global completeness limit so unrelated branches
  // neither consume the read budget nor force an unnecessary raw fallback.
  const aggregateScope = scope.unrestricted ? null : {
    field: 'branchId', ids: scope.branchId === 'none' ? ['__none__'] : (scope.branchIds || []),
  }
  const snapshot = await readDashboardQuery(db.collection(AGGREGATE_COLLECTION)
    .where('date', '>=', startDate)
    .where('date', '<=', endDate), aggregateScope, 20_000)
  if (snapshot.size >= 20_000) return null
  // A rebuild may have replaced buckets after our first coverage read. Do not
  // expose a partial/mixed generation, even if it finished during the query.
  const confirmedCoverage = (await db.collection(COVERAGE_COLLECTION).doc(COVERAGE_DOCUMENT).get()).data() || {}
  if (!usableCoverage(confirmedCoverage) || confirmedCoverage.generation !== coverage.generation) return null
  const days = new Map()
  const totals = {}
  for (const item of snapshot.docs) {
    const value = item.data() || {}
    if (value.schemaVersion !== AGGREGATE_SCHEMA_VERSION || value.generation !== coverage.generation) return null
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

async function rebuildOperationsDailyAggregates({ db, logger = console, days = 366, now = new Date() }) {
  const deadline = Date.now() + REBUILD_BUDGET_MILLIS
  const assertBudget = () => {
    if (Date.now() >= deadline) throw new Error('OPERATIONS_AGGREGATE_REBUILD_DEADLINE')
  }
  const endDate = dateKey(now)
  // Runtime timezone is normally UTC, whereas contribution dates use Vietnam.
  // Make the source-query boundaries match the bucket dates exactly.
  const endExclusive = new Date(`${endDate}T00:00:00+07:00`)
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
  const start = new Date(`${endDate}T00:00:00+07:00`)
  start.setUTCDate(start.getUTCDate() - Math.max(1, Math.min(366, days)) + 1)
  const startDate = dateKey(start)
  const coverageReference = db.collection(COVERAGE_COLLECTION).doc(COVERAGE_DOCUMENT)
  const generation = randomUUID()
  await db.runTransaction(async (transaction) => {
    const existing = (await transaction.get(coverageReference)).data() || {}
    if (existing.status === 'building' && millis(existing.lockExpiresAt) > Date.now()) {
      throw new Error('OPERATIONS_AGGREGATE_REBUILD_IN_PROGRESS')
    }
    transaction.set(coverageReference, {
      schemaVersion: AGGREGATE_SCHEMA_VERSION, generation,
      status: 'building', complete: false, startDate, endDate,
      startedAt: FieldValue.serverTimestamp(), lockExpiresAt: Timestamp.fromMillis(Date.now() + REBUILD_LOCK_MILLIS),
    })
  })
  const assertOwner = async (transaction) => {
    const value = (await transaction.get(coverageReference)).data() || {}
    if (value.status !== 'building' || value.generation !== generation) {
      throw new Error('OPERATIONS_AGGREGATE_REBUILD_OWNERSHIP_LOST')
    }
  }
  // Fence every batch, not only the final publish. An expired builder can
  // never overwrite the replacement builder's contribution baseline/buckets.
  const writeChunks = async (operations) => {
    for (let index = 0; index < operations.length; index += REBUILD_BATCH_SIZE) {
      assertBudget()
      const chunk = operations.slice(index, index + REBUILD_BATCH_SIZE)
      await db.runTransaction(async (transaction) => {
        await assertOwner(transaction)
        chunk.forEach((item) => item.remove
          ? transaction.delete(item.reference)
          : transaction.set(item.reference, item.value))
      })
    }
  }
  try {
    const groups = new Map()
    const key = FieldPath.documentId()
    const { sourceCounts, sourcePages, readTime } = await visitAggregateSourcePages({
      db, pageSize: REBUILD_BATCH_SIZE, assertBudget,
      sources: {
        ledger: db.collection('ledgerEntries').where('effectiveAt', '>=', Timestamp.fromDate(start)).where('effectiveAt', '<', Timestamp.fromDate(endExclusive))
          .orderBy('effectiveAt').orderBy(key).select(...REBUILD_SOURCE_FIELDS.ledger),
        session: db.collection('sessions').where('date', '>=', startDate).where('date', '<=', endDate)
          .orderBy('date').orderBy(key).select(...REBUILD_SOURCE_FIELDS.session),
        attendance: db.collection('attendanceEvents').where('occurredAt', '>=', Timestamp.fromDate(start)).where('occurredAt', '<', Timestamp.fromDate(endExclusive))
          .orderBy('occurredAt').orderBy(key).select(...REBUILD_SOURCE_FIELDS.attendance),
        contract: db.collection('contracts').orderBy(key).select(...REBUILD_SOURCE_FIELDS.contract),
        student: db.collection('students').orderBy(key).select(...REBUILD_SOURCE_FIELDS.student),
      },
      visit: async (source, docs) => {
        const states = []
        docs.forEach(item => {
          const next = rangedContribution(source, item.data(), { startDate, endDate })
          if (!next) return
          const key = `${next.date}|${next.branchId}`
          const group = groups.get(key) || { date: next.date, branchId: next.branchId, metrics: {} }
          Object.entries(next.metrics).forEach(([name, amount]) => mergeMetric(group.metrics, name, amount))
          groups.set(key, group)
          if (groups.size > MAX_REBUILD_BUCKETS) throw new Error('OPERATIONS_AGGREGATE_REBUILD_BUCKET_LIMIT')
          const sourcePath = item.ref.path
          states.push({ reference: db.collection(CONTRIBUTION_COLLECTION).doc(contributionDocumentId(sourcePath)), value: {
            schemaVersion: AGGREGATE_SCHEMA_VERSION, generation, sourcePath, contribution: next,
            updatedAt: FieldValue.serverTimestamp(),
          } })
        })
        // At most one page of source baselines is buffered. The ownership
        // check still fences every write before any coverage can be published.
        await writeChunks(states)
      },
    })
    assertBudget()
    const previous = await db.runTransaction(transaction => transaction.get(db.collection(AGGREGATE_COLLECTION)
      .where('date', '>=', startDate).where('date', '<=', endDate).select().limit(MAX_REBUILD_BUCKETS + 1)), { readOnly: true, readTime })
    if (previous.size > MAX_REBUILD_BUCKETS) throw new Error('OPERATIONS_AGGREGATE_REBUILD_BUCKET_LIMIT')
    const buckets = [...groups.values()].map((item) => ({
      reference: db.collection(AGGREGATE_COLLECTION).doc(aggregateDocumentId(item.date, item.branchId)),
      value: {
        schemaVersion: AGGREGATE_SCHEMA_VERSION, generation, date: item.date, branchId: item.branchId,
        metrics: item.metrics, updatedAt: FieldValue.serverTimestamp(),
      },
    }))
    const nextBucketIds = new Set(buckets.map(item => item.reference.id))
    const obsoleteBuckets = previous.docs.filter(item => !nextBucketIds.has(item.id))
    // set() replaces the entire reused bucket, including obsolete metric keys.
    // Coverage stays building and every batch retains its ownership fence;
    // deleting a reused key first would add a write without improving safety.
    await writeChunks(obsoleteBuckets.map(item => ({ reference: item.ref, remove: true })))
    await writeChunks(buckets)
    assertBudget()
    await db.runTransaction(async (transaction) => {
      await assertOwner(transaction)
      transaction.set(coverageReference, {
        schemaVersion: AGGREGATE_SCHEMA_VERSION, generation,
        status: 'ready', complete: true, startDate, endDate, sourceCounts, sourcePages, sourceReadTime: readTime,
        generatedAt: FieldValue.serverTimestamp(),
      })
    })
    const result = {
      startDate, endDate, complete: true, buckets: groups.size, sourceCounts, sourcePages,
      deletedBuckets: obsoleteBuckets.length, reusedBuckets: previous.size - obsoleteBuckets.length,
    }
    logger.info('operations_daily_aggregates_rebuilt', result)
    return result
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const value = (await transaction.get(coverageReference)).data() || {}
      if (value.generation !== generation || value.status !== 'building') return
      transaction.set(coverageReference, { status: 'failed', complete: false, failedAt: FieldValue.serverTimestamp() }, { merge: true })
    })
    throw error
  }
}

module.exports = {
  AGGREGATE_COLLECTION,
  contribution,
  contributionDeltas,
  loadDailyAggregates,
  rebuildOperationsDailyAggregates,
  syncDailyAggregateWrite,
}
