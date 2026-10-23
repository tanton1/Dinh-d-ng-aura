'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  sessionCountsTowardContract,
  summarizeSessionUsage,
  summarizeContractUsage,
  sessionUsageTransition,
  canonicalUsageSessions,
  sessionUsageSourceFingerprint,
  syncContractUsageProjection,
} = require('./contract-usage')
const { buildContractUsageView, syncContractUsageView, contractUsageSourceFingerprint, usageViewFingerprint } = require('./contract-usage-view')

test('canonical usage counts explicit charges and compatible legacy history exactly once', () => {
  const sessions = [
    { id: 'present', billingStatus: 'charged', attendanceStatus: 'present', status: 'scheduled' },
    { id: 'late', billingStatus: 'charged', attendanceStatus: 'late', status: 'scheduled' },
    { id: 'no-show', billingStatus: 'charged', attendanceStatus: 'no_show', status: 'no_show' },
    { id: 'legacy', status: 'completed' },
    { id: 'policy', billingStatus: 'charged', attendanceStatus: 'policy_charge', status: 'student_cancelled' },
    { id: 'exempt', billingStatus: 'exempt', status: 'completed' },
    { id: 'pending', billingStatus: 'pending', status: 'scheduled' },
    { id: 'review', billingStatus: 'review_required', attendanceStatus: 'present', status: 'completed' },
  ]
  const summary = summarizeSessionUsage(sessions)
  assert.equal(summary.chargedSessions, 5)
  assert.equal(summary.attendedSessions, 5)
  assert.equal(summary.presentSessions, 4)
  assert.equal(summary.lateSessions, 1)
  assert.equal(summary.noShowSessions, 1)
  assert.equal(summary.chargedNoShowSessions, 1)
  assert.equal(summary.policyChargedSessions, 1)
  assert.equal(summary.exemptSessions, 1)
  assert.equal(summary.pendingSessions, 2)
  assert.equal(summary.legacyChargedSessions, 1)
  assert.equal(sessionCountsTowardContract({ billingStatus: 'exempt', status: 'completed' }), false)
  assert.equal(sessionCountsTowardContract({ billingStatus: 'review_required', attendanceStatus: 'present', status: 'completed' }), false)
})

test('charged no-show count excludes exempt no-shows', () => {
  const summary = summarizeSessionUsage([
    { status: 'no_show', attendanceStatus: 'no_show', billingStatus: 'charged' },
    { status: 'no_show', attendanceStatus: 'no_show', billingStatus: 'exempt' },
  ])
  assert.equal(summary.noShowSessions, 2)
  assert.equal(summary.chargedNoShowSessions, 1)
})

test('contract summary exposes legacy projection delta without inventing attendance', () => {
  const summary = summarizeContractUsage({ totalSessions: 36, usedSessions: 20 }, [
    ...Array.from({ length: 17 }, (_, index) => ({ id: `charged-${index}`, billingStatus: 'charged', attendanceStatus: 'present' })),
    { id: 'exempt', billingStatus: 'exempt', status: 'student_cancelled' },
  ])
  assert.equal(summary.chargedSessions, 17)
  assert.equal(summary.legacyProjectionAdjustment, 3)
  assert.equal(summary.usedSessions, 20)
  assert.equal(summary.remainingSessions, 16)
  assert.equal(summary.reconciliationStatus, 'legacy_projection')
})

test('charged session waiting for trainer confirmation stays visible in its own bucket', () => {
  const summary = summarizeSessionUsage([
    { billingStatus: 'charged', attendanceStatus: 'pending', status: 'scheduled' },
    { billingStatus: 'charged', attendanceStatus: 'present', status: 'scheduled' },
  ])
  assert.equal(summary.chargedSessions, 2)
  assert.equal(summary.attendedSessions, 1)
  assert.equal(summary.chargedPendingAttendanceSessions, 1)
  assert.equal(
    summary.attendedSessions
      + summary.noShowSessions
      + summary.policyChargedSessions
      + summary.chargedPendingAttendanceSessions,
    summary.chargedSessions,
  )
})

test('linked session evidence immediately repairs a projection that is behind', () => {
  const summary = summarizeContractUsage({ totalSessions: 12, usedSessions: 1 }, [
    { billingStatus: 'charged', attendanceStatus: 'present' },
    { billingStatus: 'charged', attendanceStatus: 'no_show' },
  ])
  assert.equal(summary.usedSessions, 2)
  assert.equal(summary.remainingSessions, 10)
  assert.equal(summary.reconciliationStatus, 'projection_behind')
})

test('contract usage counts at most one chargeable session per student per calendar day', () => {
  const rows = [
    { id: 'morning', studentId: 'student-1', contractId: 'contract-1', date: '2026-10-14', hour: 8, billingStatus: 'charged', attendanceStatus: 'present', status: 'completed' },
    { id: 'evening', studentId: 'student-1', contractId: 'contract-1', date: '2026-10-14', hour: 18, billingStatus: 'charged', attendanceStatus: 'pending', status: 'scheduled' },
    { id: 'next-day', studentId: 'student-1', contractId: 'contract-1', date: '2026-10-15', hour: 8, billingStatus: 'charged', attendanceStatus: 'present', status: 'completed' },
    { id: 'other-student', studentId: 'student-2', contractId: 'contract-1', date: '2026-10-14', hour: 8, billingStatus: 'charged', attendanceStatus: 'present', status: 'completed' },
  ]
  const summary = summarizeContractUsage({ totalSessions: 20, usedSessions: 0 }, rows)
  assert.equal(summary.rawHistorySessions, 4)
  assert.equal(summary.historySessions, 3)
  assert.equal(summary.chargedSessions, 3)
  assert.equal(summary.duplicateHistorySessions, 1)
  assert.deepEqual(summary.canonicalChargedSessionIds.sort(), ['morning', 'next-day', 'other-student'])
})

test('daily dedupe keeps malformed date rows separate and collapses schedule mirrors first', () => {
  const rows = [
    { id: 'legacy-mirror', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-10-14', hour: 8, scheduleEntryId: 'entry-1', billingStatus: 'charged', status: 'scheduled' },
    { id: 'branch-mirror', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-10-14', hour: 8, scheduleEntryId: 'entry-1', billingStatus: 'charged', attendanceStatus: 'present', status: 'completed' },
    { id: 'bad-date-a', studentId: 'student-1', contractId: 'contract-1', date: 'unknown', billingStatus: 'charged' },
    { id: 'bad-date-b', studentId: 'student-1', contractId: 'contract-1', date: 'unknown', billingStatus: 'charged' },
  ]
  const canonical = canonicalUsageSessions(rows)
  assert.deepEqual(canonical.map((row) => row.id).sort(), ['bad-date-a', 'bad-date-b', 'branch-mirror'])
})

test('session usage transition only changes projection when charge membership changes', () => {
  assert.deepEqual(sessionUsageTransition(
    { contractId: 'contract-a', billingStatus: 'pending', status: 'scheduled' },
    { contractId: 'contract-a', billingStatus: 'charged', status: 'scheduled' },
  ), { removeContractIds: [], addContractIds: ['contract-a'] })
  assert.deepEqual(sessionUsageTransition(
    { contractId: 'contract-a', billingStatus: 'charged' },
    { contractId: 'contract-b', billingStatus: 'charged' },
  ), { removeContractIds: ['contract-a'], addContractIds: ['contract-b'] })
  assert.deepEqual(sessionUsageTransition(
    { contractId: 'contract-a', billingStatus: 'charged', attendanceStatus: 'pending' },
    { contractId: 'contract-a', billingStatus: 'charged', attendanceStatus: 'present' },
  ), { removeContractIds: [], addContractIds: [] })
  assert.deepEqual(sessionUsageTransition(
    { contractId: 'contract-a', billingStatus: 'charged' },
    { contractId: 'contract-a', billingStatus: 'exempt' },
  ), { removeContractIds: ['contract-a'], addContractIds: [] })
})

test('exact history projection contract remains the terminal projection source', () => {
  const source = require('node:fs').readFileSync(require.resolve('./contract-usage'), 'utf8')
  assert.match(source, /usageReconciliationVersion \|\| 0\) >= 4/)
  assert.match(source, /usageReconciledFrom === 'pt-contract-history-exact-v1'/)
  assert.match(source, /historyEvidenceSessions: afterUsed/)
  assert.match(source, /afterUsed > safeCount\(contract\.totalSessions\) \? 'over_entitlement' : 'matched'/)
})

test('Student 360 exposes callable history and explains pending contract reconciliation', () => {
  const source = readFileSync(path.join(__dirname, '..', 'src', 'features', 'student-360', 'Student360ContractWorkspace.tsx'), 'utf8')
  const history = readFileSync(path.join(__dirname, '..', 'src', 'components', 'admin', 'pt', 'TrainingHistoryPanel.tsx'), 'utf8')
  assert.match(source, /getStudent360ContractWorkspace/)
  assert.match(source, /pendingReconciliationSessions/)
  assert.match(source, /chờ đối soát/)
  assert.match(history, /listStudentTrainingHistory/)
})

// Serial transactional fixture with buffered writes and an optional retry.
// A retry discards all pending writes, just as Firestore does when evidence
// changes while a transaction is running.
function usageDb(seed = {}) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, structuredClone(value)]))
  const queries = []
  const writes = []
  let tail = Promise.resolve()
  let auditId = 0
  const snapshot = (path) => ({
    id: path.split('/').pop(), ref: { path }, exists: values.has(path),
    data: () => structuredClone(values.get(path)),
  })
  const apply = (path, patch, options) => {
    const next = options?.merge ? { ...(values.get(path) || {}) } : {}
    for (const [key, value] of Object.entries(patch)) {
      next[key] = value?.constructor?.name === 'ServerTimestampTransform'
        ? '2026-10-23T15:00:00.000Z' : structuredClone(value)
    }
    values.set(path, next)
    writes.push(path)
  }
  const query = (collection, filters = [], maximum = Infinity) => ({
    isQuery: true,
    where: (...filter) => query(collection, [...filters, filter], maximum),
    limit: (limit) => query(collection, filters, limit),
    doc: () => ({ path: `${collection}/audit-${++auditId}` }),
    get: async () => {
      queries.push({ collection, filters, maximum })
      const docs = [...values.keys()].filter((key) => key.startsWith(`${collection}/`) && key.split('/').length === 2)
        .filter((key) => filters.every(([field, op, expected]) => op === '==' && values.get(key)[field] === expected))
        .sort().slice(0, maximum).map(snapshot)
      return { docs, size: docs.length, empty: !docs.length }
    },
  })
  const db = {
    values, queries, writes, retryOnce: null,
    doc: (path) => ({ path, get: async () => snapshot(path) }),
    collection: (collection) => query(collection),
    runTransaction(callback) {
      const result = tail.then(async () => {
        for (;;) {
          const pending = []
          const returned = await callback({
            get: async (reference) => {
              assert.equal(pending.length, 0, 'all transaction reads must precede writes')
              return reference.isQuery ? reference.get() : snapshot(reference.path)
            },
            update: (reference, patch) => pending.push(() => apply(reference.path, patch, { merge: true })),
            set: (reference, patch, options) => pending.push(() => apply(reference.path, patch, options)),
            create: (reference, patch) => pending.push(() => apply(reference.path, patch)),
            delete: (reference) => pending.push(() => { values.delete(reference.path); writes.push(reference.path) }),
          })
          if (db.retryOnce) {
            const conflict = db.retryOnce
            db.retryOnce = null
            conflict(values)
            continue
          }
          pending.forEach((write) => write())
          return returned
        }
      })
      tail = result.catch(() => {})
      return result
    },
  }
  return db
}

const quiet = { info() {}, error() {} }
const contractRow = (overrides = {}) => ({ studentId: 's1', totalSessions: 12, usedSessions: 0, ...overrides })
const chargedRow = (overrides = {}) => ({ contractId: 'c1', studentId: 's1', date: '2026-10-23', hour: 8, billingStatus: 'charged', attendanceStatus: 'present', status: 'completed', ...overrides })
function usageEvent(before, after, version = 2, params = { sessionId: 's1' }) {
  const snap = (value, seconds) => ({ exists: Boolean(value), data: () => value, updateTime: { seconds, nanoseconds: 123 } })
  return { params, data: { before: snap(before, version - 1), after: snap(after, version) } }
}

test('atomic session counter and view reuse one history query across both existing triggers and contract cascade', async () => {
  const beforeContract = contractRow()
  const row = chargedRow()
  const db = usageDb({ 'contracts/c1': beforeContract, 'sessions/s1': row })
  const event = usageEvent(null, row)
  const results = await Promise.all([
    syncContractUsageProjection({ db, event, logger: quiet }),
    syncContractUsageView({ db, event, logger: quiet }),
  ])
  assert.equal(db.queries.length, 1)
  assert.equal(results.reduce((sum, result) => sum + result.skippedAlreadyProjected, 0), 1)
  assert.equal(db.values.get('contracts/c1').usedSessions, 1)
  const view = db.values.get('contractUsageViews/c1')
  assert.equal(view.usedSessions, 1)
  assert.equal(view.storedUsedSessions, 1)
  assert.equal(view.contractSourceFingerprint, contractUsageSourceFingerprint(db.values.get('contracts/c1')))
  await syncContractUsageView({ db, event: usageEvent(beforeContract, db.values.get('contracts/c1'), 3, { contractId: 'c1' }), logger: quiet })
  assert.equal(db.queries.length, 1, 'own counter update must not scan history again')
  assert.equal([...db.values.keys()].filter((key) => key.startsWith('contractUsageAuditLogs/')).length, 1)
})

test('attendance-only changes update view while duplicate delivery does not reread evidence', async () => {
  const pending = chargedRow({ attendanceStatus: 'pending', status: 'scheduled' })
  const db = usageDb({ 'contracts/c1': contractRow(), 'sessions/s1': pending })
  await syncContractUsageProjection({ db, event: usageEvent(null, pending), logger: quiet })
  const attended = chargedRow()
  db.values.set('sessions/s1', attended)
  const event = usageEvent(pending, attended, 3)
  const result = await syncContractUsageProjection({ db, event, logger: quiet })
  assert.equal(result.changes.length, 0, 'charge counter remains unchanged')
  assert.equal(db.values.get('contractUsageViews/c1').attendedSessions, 1)
  await syncContractUsageView({ db, event, logger: quiet })
  assert.equal(db.queries.length, 2)
})

test('reassignment reconciles both contracts once and removes old entitlement usage', async () => {
  const before = chargedRow()
  const db = usageDb({ 'contracts/c1': contractRow(), 'contracts/c2': contractRow(), 'sessions/s1': before })
  await syncContractUsageProjection({ db, event: usageEvent(null, before), logger: quiet })
  const after = chargedRow({ contractId: 'c2' })
  db.values.set('sessions/s1', after)
  const event = usageEvent(before, after, 3)
  await syncContractUsageProjection({ db, event, logger: quiet })
  await syncContractUsageView({ db, event, logger: quiet })
  assert.equal(db.queries.length, 3)
  assert.equal(db.values.get('contracts/c1').usedSessions, 0)
  assert.equal(db.values.get('contracts/c2').usedSessions, 1)
  assert.equal(db.values.get('contractUsageViews/c1').remainingSessions, 12)
  assert.equal(db.values.get('contractUsageViews/c2').remainingSessions, 11)
})

test('late event reads current evidence and cannot restore a cancelled or deleted session', async () => {
  for (const after of [chargedRow({ billingStatus: 'exempt', status: 'student_cancelled' }), null]) {
    const charged = chargedRow()
    const db = usageDb({ 'contracts/c1': contractRow(), 'sessions/s1': charged })
    const oldEvent = usageEvent(null, charged)
    await syncContractUsageProjection({ db, event: oldEvent, logger: quiet })
    if (after) db.values.set('sessions/s1', after)
    else db.values.delete('sessions/s1')
    await syncContractUsageProjection({ db, event: usageEvent(charged, after, 3), logger: quiet })
    await syncContractUsageProjection({ db, event: oldEvent, logger: quiet })
    assert.equal(db.values.get('contracts/c1').usedSessions, 0)
    assert.equal(db.values.get('contractUsageViews/c1').usedSessions, 0)
  }
})

test('atomic writer preserves daily dedupe and legacy exact-history adjustment semantics', async () => {
  const row = chargedRow()
  const db = usageDb({
    'contracts/c1': contractRow({ usedSessions: 4, usageReconciliationVersion: 4, usageReconciledFrom: 'pt-contract-history-exact-v1' }),
    'sessions/s1': row,
    'sessions/mirror': chargedRow({ hour: 18, attendanceStatus: 'pending' }),
  })
  await syncContractUsageProjection({ db, event: usageEvent(null, row), logger: quiet })
  const view = db.values.get('contractUsageViews/c1')
  assert.equal(db.values.get('contracts/c1').usedSessions, 4)
  assert.equal(view.chargedSessions, 1)
  assert.equal(view.duplicateHistorySessions, 1)
  assert.equal(view.legacyProjectionAdjustment, 3)
  assert.equal(view.remainingSessions, 8)
})

test('manual contract adjustment invalidates duplicate receipt and contract view reads current data', async () => {
  const row = chargedRow()
  const db = usageDb({ 'contracts/c1': contractRow(), 'sessions/s1': row })
  await syncContractUsageProjection({ db, event: usageEvent(null, row), logger: quiet })
  const old = db.values.get('contracts/c1')
  const adjusted = { ...old, usedSessions: 5, totalSessions: 15, carryOverTransferredSessions: 2 }
  db.values.set('contracts/c1', adjusted)
  await syncContractUsageView({ db, event: usageEvent(old, adjusted, 3, { contractId: 'c1' }), logger: quiet })
  const view = db.values.get('contractUsageViews/c1')
  assert.equal(view.usedSessions, 5)
  assert.equal(view.legacyProjectionAdjustment, 4)
  assert.equal(view.remainingSessions, 8)
  assert.equal(db.queries.length, 2)
  await syncContractUsageProjection({ db, event: usageEvent(null, row), logger: quiet })
  assert.equal(db.queries.length, 2, 'old event receipt preserves newer manual adjustment')
  assert.equal(db.values.get('contracts/c1').usedSessions, 5)
})

test('transaction retry uses new evidence and does not commit stale receipt or audit', async () => {
  const row = chargedRow()
  const db = usageDb({ 'contracts/c1': contractRow(), 'sessions/s1': row })
  db.retryOnce = (values) => values.set('sessions/s2', chargedRow({ date: '2026-10-24' }))
  await syncContractUsageProjection({ db, event: usageEvent(null, row), logger: quiet })
  assert.equal(db.queries.length, 2)
  assert.equal(db.values.get('contracts/c1').usedSessions, 2)
  assert.equal(db.values.get('contractUsageViews/c1').usedSessions, 2)
  assert.equal([...db.values.keys()].filter((key) => key.startsWith('contractUsageAuditLogs/')).length, 1)
})

test('full rebuild uses transactional current contract and refreshes reconciliation time without business timestamp churn', async () => {
  const db = usageDb({ 'contracts/c1': contractRow(), 'sessions/s1': chargedRow() })
  await buildContractUsageView({ db, contractId: 'c1', logger: quiet })
  const old = db.values.get('contractUsageViews/c1')
  db.values.set('contractUsageViews/c1', { ...old, generatedAt: '2026-10-01T00:00:00.000Z', reconciledAt: '2026-10-01T00:00:00.000Z' })
  const second = await buildContractUsageView({ db, contractId: 'c1', contract: { ...contractRow(), usedSessions: 99 }, logger: quiet })
  assert.equal(second.projectionChanged, false)
  assert.equal(db.values.get('contractUsageViews/c1').storedUsedSessions, 0)
  assert.equal(db.values.get('contractUsageViews/c1').generatedAt, '2026-10-01T00:00:00.000Z')
  assert.equal(db.values.get('contractUsageViews/c1').reconciledAt, '2026-10-23T15:00:00.000Z')
})

test('late contract deletion event does not delete recreated contract view', async () => {
  const recreated = contractRow({ totalSessions: 20 })
  const db = usageDb({ 'contracts/c1': recreated, 'sessions/s1': chargedRow() })
  await syncContractUsageView({ db, event: usageEvent(contractRow(), null, 3, { contractId: 'c1' }), logger: quiet })
  assert.equal(db.values.get('contractUsageViews/c1').entitlementSessions, 20)
  db.values.delete('contracts/c1')
  await syncContractUsageView({ db, event: usageEvent(recreated, null, 4, { contractId: 'c1' }), logger: quiet })
  assert.equal(db.values.has('contractUsageViews/c1'), false)
})

test('source receipts require source versions and preserve nanosecond precision', () => {
  const event = usageEvent(null, chargedRow())
  const first = sessionUsageSourceFingerprint(event)
  event.data.after.updateTime.nanoseconds += 1
  assert.notEqual(sessionUsageSourceFingerprint(event), first)
  delete event.data.after.updateTime
  assert.equal(sessionUsageSourceFingerprint(event), null)
  assert.equal(sessionCountsTowardContract(null), false)
})

test('truncated history does not mutate counters or acknowledge an incomplete session projection', async () => {
  const row = chargedRow()
  const seed = { 'contracts/c1': contractRow({ usedSessions: 3 }) }
  for (let index = 0; index < 5001; index += 1) seed[`sessions/s-${index}`] = { ...row }
  const db = usageDb(seed)
  const result = await syncContractUsageProjection({ db, event: usageEvent(null, row), logger: quiet })
  assert.equal(result.evidenceQueries, 1)
  assert.equal(db.queries[0].maximum, 5001)
  assert.equal(db.values.get('contracts/c1').usedSessions, 3)
  assert.equal(db.values.has('contractUsageViews/c1'), false)
  assert.equal(db.writes.length, 0)
})

test('missing snapshot versions safely disables duplicate suppression', async () => {
  const row = chargedRow()
  const db = usageDb({ 'contracts/c1': contractRow(), 'sessions/s1': row })
  const event = usageEvent(null, row)
  delete event.data.after.updateTime
  await syncContractUsageProjection({ db, event, logger: quiet })
  await syncContractUsageView({ db, event, logger: quiet })
  assert.equal(db.queries.length, 2)
  assert.equal(db.values.get('contractUsageViews/c1').lastSessionSourceFingerprint, undefined)
  assert.equal(db.values.get('contracts/c1').usedSessions, 1)
})

test('legacy writer cannot leave a valid receipt over an overwritten business view', async () => {
  for (const receiptConsumer of ['session', 'contract']) {
    const row = chargedRow()
    const db = usageDb({ 'contracts/c1': contractRow(), 'sessions/s1': row })
    const event = usageEvent(null, row)
    await syncContractUsageProjection({ db, event, logger: quiet })
    const current = db.values.get('contractUsageViews/c1')
    const stale = { ...current, usedSessions: 0, remainingSessions: 12, chargedSessions: 0 }
    // Old buildContractUsageView sets its own fingerprint but leaves new
    // receipt fields behind because it writes with merge:true.
    stale.sourceFingerprint = usageViewFingerprint(stale)
    db.values.set('contractUsageViews/c1', stale)
    if (receiptConsumer === 'session') await syncContractUsageProjection({ db, event, logger: quiet })
    else await syncContractUsageView({ db, event: usageEvent(contractRow(), db.values.get('contracts/c1'), 3, { contractId: 'c1' }), logger: quiet })
    assert.equal(db.queries.length, 2, `${receiptConsumer} receipt rejects old writer's output`)
    assert.equal(db.values.get('contractUsageViews/c1').usedSessions, 1)
  }
})
