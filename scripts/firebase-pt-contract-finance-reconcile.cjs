'use strict'

// Contract-scoped financial repair. A dry run is mandatory; apply binds every
// source document version and this implementation to the reviewed digest.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const backendRequire = require('node:module').createRequire(path.join(__dirname, '../functions/package.json'))
const { FieldValue, Timestamp } = backendRequire('firebase-admin/firestore')
const { connect, PROJECT, DATABASE } = require('./firebase-pt-finance-repair.cjs')
const { contractFinanceEvidence } = require('./pt-contract-finance-evidence.cjs')
const { chargedRevenuePlan } = require('../functions/pt-charged-revenue')
const { readContractRecognitionState } = require('../functions/finance-recognition-balance')
const { amendmentProjection } = require('../functions/contract-amendments')
const RUN = 'pt-contract-finance-reconcile-v1', ACTOR = `system:${RUN}`
const COLLECTIONS = ['sessions', 'sessionBillingEvents', 'attendanceEvents', 'ledgerEntries', 'revenueRecognitionReviews', 'sessionBillingIssues', 'sessionReturns']
const stable = value => value?.toDate ? value.toDate().toISOString() : Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value
const digest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const runtimeHash = () => digest([__filename, path.join(__dirname, 'pt-contract-finance-evidence.cjs'),
  ...['pt-charged-revenue.js', 'finance-recognition.js', 'finance-recognition-evidence.js', 'finance-recognition-balance.js',
    'pt-revenue-allocation.js', 'contract-usage-core.js', 'contract-amendments.js', 'accounting-core.js']
    .map(f => path.join(__dirname, '../functions', f))].map(f => fs.readFileSync(f, 'utf8')))

async function reconcileContract(db, contractId, { apply = false, expectedDigest = '', expectedRuntime = '', capture = () => {} } = {}) {
  assert(/^[A-Za-z0-9_-]{1,200}$/.test(contractId), 'Invalid contract ID')
  const runtime = runtimeHash()
  if (apply) { assert.match(expectedDigest, /^[a-f0-9]{64}$/); assert.equal(expectedRuntime, runtime, 'Repair source changed since dry run') }
  return db.runTransaction(async tx => {
    const receiptRef = apply ? db.doc(`financeReconciliationRepairs/${RUN}_${contractId}_${expectedDigest.slice(0, 20)}`) : null
    if (receiptRef) { const receipt = await tx.get(receiptRef); if (receipt.exists) return { ...receipt.data().result, alreadyApplied: true } }
    const versions = new Map()
    const get = async ref => {
      const snapshot = await tx.get(ref)
      for (const doc of snapshot.docs || [snapshot]) versions.set(doc.ref.path, doc.exists ? [doc.updateTime.seconds, doc.updateTime.nanoseconds] : null)
      return snapshot
    }
    const contractSnapshot = await get(db.doc(`contracts/${contractId}`))
    assert(contractSnapshot.exists, 'Contract missing'); const contract = contractSnapshot.data()
    const snapshots = await Promise.all(COLLECTIONS.map(c => get(db.collection(c).where('contractId', '==', contractId).limit(501))))
    assert(snapshots.every(s => s.size <= 500), 'Source evidence bound exceeded')
    const rows = Object.fromEntries(COLLECTIONS.map((c, i) => [c, snapshots[i].docs.map(d => ({ ...d.data(), id: d.id }))]))
    const evidence = contractFinanceEvidence({ contractId, contract, sessions: rows.sessions, billings: rows.sessionBillingEvents,
      attendance: rows.attendanceEvents, ledger: rows.ledgerEntries, reviews: [...rows.revenueRecognitionReviews, ...rows.sessionBillingIssues], returns: rows.sessionReturns })
    const months = [...new Set(evidence.charges.map(c => rows.sessions.find(s => s.id === c.sessionId).date.slice(0, 7)))]
    for (const month of months) assert.notEqual((await get(db.doc(`financePeriods/${month}`))).data()?.status, 'locked', 'Finance period is locked')
    // An entry with the same session in another contract must never be missed
    // merely because the contract-scoped query above did not return it.
    const sessionIds = rows.sessions.map(s => s.id)
    for (let i = 0; i < sessionIds.length; i += 30) {
      const external = await get(db.collection('ledgerEntries').where('sessionId', 'in', sessionIds.slice(i, i + 30)).limit(501))
      assert(external.size <= 500 && external.docs.every(d => rows.ledgerEntries.some(l => l.id === d.id)), 'Cross-contract financial evidence requires review')
    }
    const knownState = await readContractRecognitionState({ get }, db, contractId)
    const pendingByContract = new Map(), writes = new Map()
    const write = (type, reference, data) => {
      const previous = writes.get(reference.path)
      assert(!previous || previous.type === type, 'Conflicting write operation')
      writes.set(reference.path, { type, reference, data: { ...previous?.data, ...data } })
    }
    const marker = { financeReconciliationRun: RUN, financeReconciledBy: ACTOR, financeReconciledAt: FieldValue.serverTimestamp() }
    for (const charge of evidence.charges) {
      const session = rows.sessions.find(s => s.id === charge.sessionId)
      const existingBilling = rows.sessionBillingEvents.find(b => (b.sessionId || b.id) === session.id)
      const existingAttendance = rows.attendanceEvents.find(a => a.id === charge.attendanceId)
      const occurredAt = Timestamp.fromDate(new Date(`${session.date}T${String(session.hour).padStart(2, '0')}:00:00+07:00`))
      const billing = existingBilling || { schemaVersion: 2, type: 'session_charge', sessionId: session.id, contractId,
        studentId: session.studentId, trainerId: session.trainerId, billingStatus: 'charged', serviceOrdinal: charge.ordinal,
        source: 'legacy_completed_session', historicalBackfill: true, createdAt: FieldValue.serverTimestamp(), createdBy: ACTOR }
      // Missing historical attendance is not fabricated as a PT confirmation.
      // This is charge evidence only; payroll ignores the legacy_charge type.
      const attendance = existingAttendance || { schemaVersion: 2, type: 'legacy_charge', sessionId: session.id, contractId,
        studentId: session.studentId, trainerId: session.trainerId, billingStatus: 'charged', serviceOrdinal: charge.ordinal,
        attendanceStatus: 'pending', confirmationSource: 'legacy_usage_reconciliation', evidenceSource: 'completed_session_and_contract_usage',
        sourceSessionStatus: session.status, countsTowardContract: true, occurredAt, createdAt: FieldValue.serverTimestamp(), createdBy: ACTOR }
      const plan = await chargedRevenuePlan({ transaction: { get }, db, sessionId: session.id,
        session: { ...session, billingStatus: 'charged', serviceOrdinal: charge.ordinal },
        billing: { ...billing, serviceOrdinal: charge.ordinal }, attendance: { ...attendance, id: charge.attendanceId, serviceOrdinal: charge.ordinal },
        contractId, contract, serviceOrdinal: charge.ordinal, actorUid: ACTOR, strict: true, knownState, pendingByContract })
      assert.equal(plan.createdRevenue, charge.missingRevenue ? charge.amount : 0, 'Unexpected revenue change')
      for (const item of plan.writes) {
        if (item.reference.parent.id === 'ledgerEntries') {
          assert.equal(item.type, 'create'); assert(!rows.ledgerEntries.some(l => l.id === item.reference.id), 'Existing ledger entry must remain immutable')
          assert.equal(item.data.cashImpact, 0)
        }
        write(item.type, item.reference, item.data)
      }
      const { branchId, ...recognitionPatch } = plan.patch
      write('update', db.doc(`sessions/${session.id}`), { ...recognitionPatch, ...marker, billingStatus: 'charged',
        serviceOrdinal: charge.ordinal, revision: Number(session.revision || 0) + 1 })
      write(existingBilling ? 'update' : 'create', db.doc(`sessionBillingEvents/${existingBilling?.id || session.id}`), {
        ...(!existingBilling ? billing : {}), ...plan.patch, ...marker, billingStatus: 'charged', serviceOrdinal: charge.ordinal })
      write(existingAttendance ? 'update' : 'create', db.doc(`attendanceEvents/${charge.attendanceId}`), {
        ...(!existingAttendance ? attendance : {}), ...plan.patch, ...marker, billingStatus: 'charged', serviceOrdinal: charge.ordinal })
      if (plan.recognition) {
        const pending = pendingByContract.get(contractId) || { recognizedRevenue: 0, revenueBySession: new Map(), revenueByOrdinal: new Map() }
        pending.recognizedRevenue += plan.createdRevenue
        pending.revenueBySession.set(session.id, plan.createdRevenue)
        pending.revenueByOrdinal.set(charge.ordinal, new Map([[session.id, plan.createdRevenue]]))
        pendingByContract.set(contractId, pending)
      }
    }
    for (const duplicate of evidence.duplicates) {
      const patch = { ...marker, duplicateOfSessionId: duplicate.canonicalSessionId, countsTowardContract: false,
        recognitionReviewRequired: false, recognitionReviewIssueCode: null, revenueRecognitionState: 'not_applicable' }
      write('update', db.doc(`sessionBillingEvents/${duplicate.billingId}`), { ...patch, billingStatus: 'void_duplicate', voidedBy: ACTOR, voidedAt: FieldValue.serverTimestamp() })
      write('update', db.doc(`sessions/${duplicate.sessionId}`), patch)
      if (duplicate.attendanceId) write('update', db.doc(`attendanceEvents/${duplicate.attendanceId}`), patch)
    }
    assert(writes.size < 450, 'Atomic repair write bound exceeded')
    const projected = Object.fromEntries(COLLECTIONS.map(c => [c, new Map(rows[c].map(row => [row.id, row]))]))
    for (const item of writes.values()) {
      const collection = item.reference.parent.id, id = item.reference.id
      if (projected[collection]) projected[collection].set(id, { ...projected[collection].get(id), ...item.data, id })
    }
    const checks = amendmentProjection({ contractId, contract, target: { packageId: contract.packageId, packageName: contract.packageName,
      totalSessions: contract.totalSessions, totalPrice: contract.totalPrice, discount: contract.discount || 0, endDate: contract.endDate },
      sessions: [...projected.sessions.values()], billings: [...projected.sessionBillingEvents.values()], ledger: [...projected.ledgerEntries.values()],
      reviews: [...projected.revenueRecognitionReviews.values(), ...projected.sessionBillingIssues.values()] })
    assert.deepEqual(checks.blockers, [], 'Repair must resolve the complete contract before committing')
    assert.equal(checks.used, contract.usedSessions); assert.equal(checks.cash, contract.paidAmount)
    assert.equal(checks.recognized, evidence.expectedRevenue)
    const sourceDigest = digest({ contractId, runtime, versions: [...versions].sort(([a], [b]) => a.localeCompare(b)), evidence })
    const result = { runId: RUN, contractId, sourceDigest, runtimeHash: runtime, usedSessions: evidence.used,
      missingRevenueCount: evidence.missingRevenueCount, additionalRevenue: evidence.additionalRevenue, recognizedRevenue: checks.recognized,
      cashUnchanged: checks.cash, duplicatesVoided: evidence.duplicates.length, billingReceiptsCreated: evidence.newBillingCount,
      historicalChargeEvidenceCreated: evidence.newEvidenceCount, writes: writes.size, blockers: checks.blockers }
    capture({ result, contract, rows, evidence, versions: [...versions] })
    if (apply) {
      assert.equal(sourceDigest, expectedDigest, 'Source data changed since dry run; re-plan before applying')
      for (const item of writes.values()) tx[item.type](item.reference, item.data)
      tx.create(receiptRef, { schemaVersion: 1, runId: RUN, contractId, studentId: contract.studentId, branchId: contract.branchId,
        sourceDigest, runtimeHash: runtime, reason: 'Reconcile proven historical debits and void a previously cancelled duplicate; preserve cash, contract terms and attendance confirmations.',
        result, sourceSessionIds: evidence.charges.map(c => c.sessionId), duplicates: evidence.duplicates, createdAt: FieldValue.serverTimestamp(), createdBy: ACTOR })
    }
    return { ...result, applied: apply }
  })
}

async function main() {
  const [mode = 'plan', contractId, approvedDigest] = process.argv.slice(2)
  assert(['plan', 'apply'].includes(mode), 'Use plan or apply'); assert(/^[A-Za-z0-9_-]{1,200}$/.test(contractId || ''), 'Provide exact contract ID')
  const dir = path.resolve(__dirname, '../.migration-private'); fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${RUN}_${contractId}-plan.json`)
  let approved
  if (mode === 'apply') {
    approved = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(approved.project, PROJECT); assert.equal(approved.database, DATABASE); assert.equal(approved.result.contractId, contractId)
    assert.equal(approved.result.sourceDigest, approvedDigest, 'Provide the reviewed dry-run digest')
  }
  const db = await connect()
  try {
    let captured
    const result = await reconcileContract(db, contractId, { apply: mode === 'apply', expectedDigest: approvedDigest,
      expectedRuntime: approved?.result.runtimeHash, capture: value => { captured = value } })
    if (mode === 'plan') fs.writeFileSync(file, JSON.stringify({ project: PROJECT, database: DATABASE, plannedAt: new Date().toISOString(), ...captured }, null, 2))
    else fs.writeFileSync(path.join(dir, `${RUN}_${contractId}-applied.json`), JSON.stringify({ checkedAt: new Date().toISOString(), result }, null, 2))
    console.log(JSON.stringify(result, null, 2))
  } finally { await db.terminate() }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { reconcileContract, runtimeHash }
