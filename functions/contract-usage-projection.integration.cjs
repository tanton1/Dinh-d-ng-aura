'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { syncContractUsageProjection, sessionUsageSourceFingerprint } = require('./contract-usage')
const { syncContractUsageView, contractUsageSourceFingerprint } = require('./contract-usage-view')

// Intentionally outside the ordinary unit-test glob. No credentials or live
// project/database may be used for these destructive, synthetic fixtures.
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const projectId = 'demo-aura-fitness'
assert.match(projectId, /^demo-/)
const app = initializeApp({ projectId }, `contract-usage-projection-${randomUUID()}`)
const clients = []
const quiet = { info() {}, error() {} }
const contractRow = (patch = {}) => ({
  studentId: 'student-one', totalSessions: 12, usedSessions: 0,
  usageReconciliationVersion: 5, usageReconciledFrom: 'pt-contract-daily-usage-v1', ...patch,
})
const sessionRow = (patch = {}) => ({
  studentId: 'student-one', contractId: 'contract-one', trainerId: 'trainer-one',
  branchId: 'branch-one', date: '2026-10-23', hour: 8,
  status: 'completed', attendanceStatus: 'present', billingStatus: 'charged', ...patch,
})

after(async () => {
  await Promise.all(clients.map((db) => db.terminate()))
  await deleteApp(app)
})

function fixture() {
  const db = getFirestore(app, `contract-usage-${randomUUID()}`)
  clients.push(db)
  return db
}

async function sourceWrite(db, path, value) {
  const reference = db.doc(path)
  const before = await reference.get()
  if (value === null) await reference.delete()
  else await reference.set(value)
  const after = await reference.get()
  const [collection, id] = path.split('/')
  return {
    params: collection === 'sessions' ? { sessionId: id } : { contractId: id },
    data: { before, after },
  }
}

// Count real transaction queries, without substituting a memory datastore or
// serializing concurrent calls. The optional fault is injected only after the
// real callback queued writes, so the Admin SDK must discard and retry them.
function observeTransactions(db, { abortFirst = false, beforeRetry = null } = {}) {
  const stats = { attempts: 0, evidenceQueries: 0 }
  let injected = false
  let changedForRetry = false
  const wrapped = {
    doc: (...args) => db.doc(...args),
    collection: (...args) => db.collection(...args),
    runTransaction: (callback, options) => db.runTransaction(async (transaction) => {
      stats.attempts += 1
      if (injected && !changedForRetry && beforeRetry) {
        changedForRetry = true
        await beforeRetry()
      }
      const proxy = new Proxy(transaction, {
        get(target, key) {
          if (key === 'get') return async (...args) => {
            const result = await target.get(...args)
            if (Array.isArray(result.docs)) stats.evidenceQueries += 1
            return result
          }
          const value = target[key]
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      const result = await callback(proxy)
      if (abortFirst && !injected) {
        injected = true
        throw Object.assign(new Error('Intentional integration retry after real reads and buffered writes'), { code: 10 })
      }
      return result
    }, options),
  }
  return { db: wrapped, stats }
}

async function contractAndView(db, id = 'contract-one') {
  const [contract, view] = await db.getAll(db.doc(`contracts/${id}`), db.doc(`contractUsageViews/${id}`))
  assert.equal(contract.exists, true)
  assert.equal(view.exists, true)
  const row = contract.data(), projection = view.data()
  assert.equal(projection.contractSourceFingerprint, contractUsageSourceFingerprint(row))
  assert.equal(projection.storedUsedSessions, row.usedSessions)
  return { contract: row, view: projection }
}

test('real Firestore: simultaneous duplicate trigger deliveries converge with one counter update and audit', { timeout: 60000 }, async () => {
  const db = fixture()
  await db.doc('contracts/contract-one').set(contractRow())
  const event = await sourceWrite(db, 'sessions/session-one', sessionRow())
  const observed = observeTransactions(db)
  const results = await Promise.all([
    syncContractUsageProjection({ db: observed.db, event, logger: quiet }),
    syncContractUsageView({ db: observed.db, event, logger: quiet }),
    syncContractUsageProjection({ db: observed.db, event, logger: quiet }),
    syncContractUsageView({ db: observed.db, event, logger: quiet }),
  ])
  const { contract, view } = await contractAndView(db)
  assert.equal(contract.usedSessions, 1)
  assert.equal(view.usedSessions, 1)
  assert.equal(view.remainingSessions, 11)
  assert.equal(view.lastSessionSourceFingerprint, sessionUsageSourceFingerprint(event))
  assert.equal(results.reduce((sum, result) => sum + result.changes.length, 0), 1)
  assert.equal(results.reduce((sum, result) => sum + result.skippedAlreadyProjected, 0), 3)
  assert.equal((await db.collection('contractUsageAuditLogs').get()).size, 1)
  assert.ok(observed.stats.evidenceQueries >= 1)
  // A simultaneous contender may read before a conflicting commit and retry;
  // do not claim one physical query across all attempts. Settled replays must
  // perform no further history query.
  const beforeReplay = observed.stats.evidenceQueries
  await syncContractUsageView({ db: observed.db, event, logger: quiet })
  assert.equal(observed.stats.evidenceQueries, beforeReplay)
})

test('real Firestore: the surviving retry-enabled view handler alone maintains counter and view across replay and cancellation', { timeout: 60000 }, async () => {
  const db = fixture()
  await db.doc('contracts/contract-one').set(contractRow())
  const created = await sourceWrite(db, 'sessions/session-one', sessionRow())
  await syncContractUsageView({ db, event: created, logger: quiet })
  await syncContractUsageView({ db, event: created, logger: quiet })
  let state = await contractAndView(db)
  assert.equal(state.contract.usedSessions, 1)
  assert.equal(state.view.usedSessions, 1)
  assert.equal(state.view.remainingSessions, 11)
  assert.equal((await db.collection('contractUsageAuditLogs').get()).size, 1)

  const cancelled = await sourceWrite(db, 'sessions/session-one', sessionRow({ status: 'student_cancelled', billingStatus: 'exempt' }))
  await syncContractUsageView({ db, event: cancelled, logger: quiet })
  await syncContractUsageView({ db, event: created, logger: quiet })
  state = await contractAndView(db)
  assert.equal(state.contract.usedSessions, 0)
  assert.equal(state.view.usedSessions, 0)
  assert.equal(state.view.remainingSessions, 12)

  const removed = await sourceWrite(db, 'sessions/session-one', null)
  await syncContractUsageView({ db, event: removed, logger: quiet })
  state = await contractAndView(db)
  assert.equal(state.contract.usedSessions, 0)
  assert.equal(state.view.remainingSessions, 12)
})

test('real Firestore: moving a charged session updates both contract projections atomically', { timeout: 60000 }, async () => {
  const db = fixture()
  await Promise.all([
    db.doc('contracts/contract-one').set(contractRow()),
    db.doc('contracts/contract-two').set(contractRow()),
  ])
  const created = await sourceWrite(db, 'sessions/session-one', sessionRow())
  await syncContractUsageProjection({ db, event: created, logger: quiet })
  const moved = await sourceWrite(db, 'sessions/session-one', sessionRow({ contractId: 'contract-two', branchId: 'branch-two' }))
  await Promise.all([
    syncContractUsageProjection({ db, event: moved, logger: quiet }),
    syncContractUsageView({ db, event: moved, logger: quiet }),
  ])
  const before = await contractAndView(db, 'contract-one')
  const after = await contractAndView(db, 'contract-two')
  assert.equal(before.contract.usedSessions, 0)
  assert.equal(before.view.remainingSessions, 12)
  assert.equal(after.contract.usedSessions, 1)
  assert.equal(after.view.remainingSessions, 11)
  assert.equal((await db.collection('contractUsageAuditLogs').get()).size, 2)
})

test('real Firestore: out-of-order charged creation cannot restore cancelled or deleted evidence', { timeout: 60000 }, async () => {
  for (const replacement of [sessionRow({ status: 'student_cancelled', billingStatus: 'exempt' }), null]) {
    const db = fixture()
    await db.doc('contracts/contract-one').set(contractRow())
    const created = await sourceWrite(db, 'sessions/session-one', sessionRow())
    await syncContractUsageProjection({ db, event: created, logger: quiet })
    const removed = await sourceWrite(db, 'sessions/session-one', replacement)
    await syncContractUsageView({ db, event: removed, logger: quiet })
    await syncContractUsageProjection({ db, event: created, logger: quiet })
    const { contract, view } = await contractAndView(db)
    assert.equal(contract.usedSessions, 0)
    assert.equal(view.usedSessions, 0)
    assert.equal(view.remainingSessions, 12)
    assert.equal((await db.collection('contractUsageAuditLogs').get()).size, 2)
  }
})

test('real Firestore: aborted transaction retries current evidence without committing stale receipt or audit', { timeout: 60000 }, async () => {
  const db = fixture()
  await db.doc('contracts/contract-one').set(contractRow())
  const event = await sourceWrite(db, 'sessions/session-one', sessionRow())
  const observed = observeTransactions(db, {
    abortFirst: true,
    beforeRetry: async () => {
      assert.equal((await db.doc('contractUsageViews/contract-one').get()).exists, false)
      assert.equal((await db.collection('contractUsageAuditLogs').get()).size, 0)
      await db.doc('sessions/session-two').set(sessionRow({ date: '2026-10-24' }))
    },
  })
  await syncContractUsageProjection({ db: observed.db, event, logger: quiet })
  assert.ok(observed.stats.attempts >= 2)
  assert.ok(observed.stats.evidenceQueries >= 2)
  const { contract, view } = await contractAndView(db)
  assert.equal(contract.usedSessions, 2)
  assert.equal(view.usedSessions, 2)
  assert.equal(view.remainingSessions, 10)
  assert.equal(view.lastSessionSourceFingerprint, sessionUsageSourceFingerprint(event))
  assert.equal((await db.collection('contractUsageAuditLogs').get()).size, 1)
})

test('real Firestore: contract cascade skips matching source, changed contract refreshes once', { timeout: 60000 }, async () => {
  const db = fixture()
  await db.doc('contracts/contract-one').set(contractRow())
  const contractBefore = await db.doc('contracts/contract-one').get()
  const event = await sourceWrite(db, 'sessions/session-one', sessionRow())
  await syncContractUsageProjection({ db, event, logger: quiet })
  const contractAfter = await db.doc('contracts/contract-one').get()
  const observed = observeTransactions(db)
  await syncContractUsageView({ db: observed.db, event: { params: { contractId: 'contract-one' }, data: { before: contractBefore, after: contractAfter } }, logger: quiet })
  assert.equal(observed.stats.evidenceQueries, 0)

  const changed = await sourceWrite(db, 'contracts/contract-one', { ...contractAfter.data(), totalSessions: 20, carryOverTransferredSessions: 2 })
  await syncContractUsageView({ db: observed.db, event: changed, logger: quiet })
  assert.equal(observed.stats.evidenceQueries, 1)
  const { view } = await contractAndView(db)
  assert.equal(view.entitlementSessions, 20)
  assert.equal(view.remainingSessions, 17)
  await syncContractUsageView({ db: observed.db, event: changed, logger: quiet })
  assert.equal(observed.stats.evidenceQueries, 1)
})
