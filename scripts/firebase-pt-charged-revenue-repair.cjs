'use strict'

// Explicit migration for the approved deduction-based policy. It never edits
// cash, contract usage, original attendance confirmations or existing amounts.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { connect, batches, PROJECT, DATABASE } = require('./firebase-pt-finance-repair.cjs')
const { chargedRevenuePlan, applyRevenuePlan } = require('../functions/pt-charged-revenue')
const { summarizeContractUsage } = require('../functions/contract-usage')
const { replacementServiceOrdinal } = require('../functions/service-ordinal-allocation')
const { renewalRevenueAllocation } = require('../functions/pt-revenue-allocation')
const { assertCancellationEvidenceChange } = require('../functions/session-operations')
const { attendanceReconciliation } = require('../functions/attendance-reconciliation')
const { ptRevenueJournalWrite } = require('../functions/pt-charged-revenue')
const { recognitionForServiceOrdinal } = require('../functions/finance-recognition')
const { reversedJournalLines } = require('../functions/accounting-core')
const { vietnamMonthKey } = require('../functions/pt-policy')
const RUN = 'pt-charged-revenue-20261031-v1', ACTOR = `system:${RUN}`
const DIR = path.resolve(__dirname, '../.migration-private'), PLAN = path.join(DIR, `${RUN}-plan.json`)
const START = '2026-10-01T17:00:00.000Z', END = '2026-10-31T17:00:00.000Z'
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key] ?? null]))
function evidenceHash({ session, attendance, billing, contract }) {
  return digest({
    session: pick(session, ['contractId','studentId','trainerId','date','hour','status','billingStatus','attendanceStatus','confirmationSource','confirmedAt','confirmedBy','serviceOrdinal','revision']),
    attendance: pick(attendance, ['sessionId','contractId','studentId','billingStatus','attendanceStatus','confirmationSource','confirmedAt','confirmedBy','note','lateMinutes','noShowReason','serviceOrdinal']),
    billing: pick(billing, ['sessionId','contractId','studentId','billingStatus','serviceOrdinal']),
    contract: pick(contract, ['studentId','totalPrice','discount','paidAmount','totalSessions','packageSessions','carriedOverSessions','sourceContractId','cancellationSettlement','cancelledAt']),
  })
}
function runtimeHash() {
  return digest(['pt-charged-revenue.js','pt-revenue-allocation.js','finance-recognition.js','finance-recognition-evidence.js',
    'finance-recognition-balance.js','service-ordinal-allocation.js','contract-usage-core.js','session-schedule-normalization.js','accounting-core.js','session-operations.js','pt-finance-branch.js']
    .map(file => fs.readFileSync(path.join(__dirname, '../functions', file), 'utf8')).concat(fs.readFileSync(__filename, 'utf8')))
}
async function period(db, collection, field) {
  const snap = await db.collection(collection).where(field, '>=', new Date(START)).where(field, '<', new Date(END)).limit(10001).get()
  assert(snap.size <= 10000, 'Period exceeds migration read budget')
  return snap.docs.map(doc => ({ ...doc.data(), id: doc.id }))
}
async function repairOne(db, row, { dryRun = false, reserved = [], pendingByContract = new Map() } = {}) {
  return db.runTransaction(async tx => {
    const receiptRef = db.doc(`financeReconciliationRepairs/${RUN}_${digest(row.sessionId).slice(0, 32)}`)
    const receipt = await tx.get(receiptRef)
    if (receipt.exists) return { alreadyApplied: true, ...receipt.data() }
    const [ss, as, bs] = await Promise.all(['sessions','attendanceEvents','sessionBillingEvents'].map(col => tx.get(db.doc(`${col}/${row.sessionId}`))))
    assert(ss.exists && as.exists && bs.exists, 'Canonical charge evidence missing')
    const session = ss.data(), attendance = as.data(), billing = bs.data()
    const contractRef = db.doc(`contracts/${session.contractId}`), cs = await tx.get(contractRef)
    assert(cs.exists, 'Contract missing'); let contract = cs.data()
    assert.equal(evidenceHash({ session, attendance, billing, contract }), row.evidenceHash, 'Evidence changed since plan')
    assert.equal(session.billingStatus, 'charged'); assert.equal(attendance.billingStatus, 'charged'); assert.equal(billing.billingStatus, 'charged')
    assert.equal(attendance.sessionId, row.sessionId); assert.equal(billing.sessionId, row.sessionId)
    assert.equal(attendance.contractId, session.contractId); assert.equal(billing.contractId, session.contractId)
    assert.equal(contract.studentId, session.studentId)
    assertCancellationEvidenceChange({ contract, sourceDate: session.date, changed: true })
    const [history, allBilling, ledger, globalLedger, periodSnap, review] = await Promise.all([
      tx.get(db.collection('sessions').where('contractId', '==', session.contractId).limit(5001)),
      tx.get(db.collection('sessionBillingEvents').where('contractId', '==', session.contractId).limit(5001)),
      tx.get(db.collection('ledgerEntries').where('contractId', '==', session.contractId).limit(5001)),
      tx.get(db.collection('ledgerEntries').where('sessionId', '==', row.sessionId).limit(3)),
      tx.get(db.doc(`financePeriods/${String(session.date).slice(0, 7)}`)), tx.get(db.doc(`revenueRecognitionReviews/${row.sessionId}`)),
    ])
    assert([history, allBilling, ledger].every(s => s.size <= 5000), 'Contract exceeds migration budget')
    assert(globalLedger.empty, 'Session already has financial evidence; refresh plan')
    assert(!(periodSnap.exists && periodSnap.data().status === 'locked'), 'Finance period locked')
    const sessions = history.docs.map(d => ({ ...d.data(), id: d.id })), billings = allBilling.docs.map(d => ({ ...d.data(), id: d.id }))
    const entries = ledger.docs.map(d => ({ ...d.data(), id: d.id })), usage = summarizeContractUsage(contract, sessions)
    const canonicalIds = new Set(usage.canonicalChargedSessionIds)
    const writes = [], write = (type, reference, data) => writes.push({ type, reference, data })
    let outcome, revenue = 0, issueCode = null, allocatedOrdinal = null, entryId = null, financialContractId = null, financialOrdinal = null, duplicateOf = null
    const previousOrdinal = Number(billing.serviceOrdinal || session.serviceOrdinal || attendance.serviceOrdinal || 0)
    let plan = null
    if (!canonicalIds.has(row.sessionId)) {
      assert.equal(usage.chargedSessions, Number(contract.usedSessions), 'Duplicate is not proven excluded from usage')
      const winner = sessions.find(s => canonicalIds.has(s.id) && s.studentId === session.studentId && s.date === session.date)
      assert(winner && winner.billingStatus === 'charged', 'Canonical duplicate winner missing')
      duplicateOf = winner.id; outcome = 'duplicate_exempt'
      const patch = { billingStatus: 'exempt', countsTowardContract: false, duplicateOfSessionId: duplicateOf,
        revenueRecognitionState: 'not_applicable', recognitionReviewRequired: false, recognitionReviewIssueCode: null,
        financeReconciliationRun: RUN, financeReconciledAt: new Date(), financeReconciledBy: ACTOR }
      write('update', ss.ref, patch); write('update', as.ref, patch)
      write('update', bs.ref, { billingStatus: 'void_duplicate', duplicateOfSessionId: duplicateOf, voidedAt: new Date(), voidedBy: ACTOR, reconciliationRun: RUN })
      if (review.exists) write('update', review.ref, { status: 'resolved', resolution: 'duplicate_not_deducted', resolvedAt: new Date(), resolvedBy: ACTOR })
    } else {
      if (Number(contract.carriedOverSessions || 0) > 0 && !contract.revenueAllocation) {
        const sourceSnap = await tx.get(db.doc(`contracts/${contract.sourceContractId}`))
        assert(sourceSnap.exists, 'Carry source missing')
        const source = sourceSnap.data()
        assert.equal(source.renewalSupersededBy, session.contractId)
        assert.equal(Number(source.carryOverTransferredSessions), Number(contract.carriedOverSessions))
        assert.equal(Number(source.usedSessions) + Number(source.carryOverTransferredSessions), Number(source.totalSessions), 'Ambiguous legacy carry shares')
        assert(entries.every(e => !Number(e.revenueImpact)), 'Legacy carry already recognized; repricing requires separate adjustment')
        contract = { ...contract, revenueAllocation: renewalRevenueAllocation({ sourceId: contract.sourceContractId,
          source: { ...source, carryOverTransferredSessions: 0 }, nextId: session.contractId, next: contract, carriedOverSessions: contract.carriedOverSessions }) }
        write('update', contractRef, { revenueAllocation: contract.revenueAllocation, revenueAllocationReconciledBy: ACTOR, revenueAllocationReconciledAt: new Date() })
      }
      const collision = reserved.includes(previousOrdinal)
        || billings.some(b => (b.sessionId || b.id) !== row.sessionId && canonicalIds.has(b.sessionId || b.id) && Number(b.serviceOrdinal) === previousOrdinal)
        || entries.some(e => ['posted','reversed'].includes(e.status) && Number(e.revenueImpact) > 0 && e.sessionId !== row.sessionId && Number(e.serviceOrdinal) === previousOrdinal)
      if ((!dryRun && row.preview?.allocatedOrdinal) || !Number.isSafeInteger(previousOrdinal) || previousOrdinal < 1 || previousOrdinal > Number(contract.totalSessions) || collision) {
        assert(!Number(contract.carriedOverSessions || 0), 'Carry ordinal requires explicit allocation review')
        const requested = !dryRun ? row.preview?.allocatedOrdinal : null
        allocatedOrdinal = replacementServiceOrdinal({ sessionId: row.sessionId, contract, sessions, billings, ledger: entries,
          reserved: requested ? Array.from({ length: requested - 1 }, (_, i) => i + 1) : reserved })
        if (requested) assert.equal(allocatedOrdinal, requested, 'Reviewed share is no longer available')
      }
      const ordinal = allocatedOrdinal || previousOrdinal
      const override = value => ({ ...value, serviceOrdinal: ordinal })
      plan = await chargedRevenuePlan({ transaction: tx, db, sessionId: row.sessionId, session: override(session), attendance: override(attendance),
        billing: override(billing), contractId: session.contractId, contract, serviceOrdinal: ordinal, actorUid: ACTOR,
        pendingByContract: dryRun ? pendingByContract : null })
      outcome = plan.recognition ? 'posted' : 'review_required'; revenue = plan.createdRevenue
      entryId = plan.entryId; issueCode = plan.issue || null
      financialContractId = plan.revenueContractId; financialOrdinal = plan.createdServiceOrdinal || null
      for (const doc of [ss, as, bs]) write('update', doc.ref, { ...plan.patch,
        ...(allocatedOrdinal && plan.recognition ? { serviceOrdinal: allocatedOrdinal, previousServiceOrdinal: previousOrdinal, ordinalReconciliationRun: RUN, ordinalReconciledAt: new Date() } : {}),
        financeReconciliationRun: RUN, financeReconciledAt: new Date(), financeReconciledBy: ACTOR })
      if (!plan.recognition) allocatedOrdinal = null
    }
    const result = { outcome, revenue, issueCode, allocatedOrdinal, entryId, financialContractId, financialOrdinal, duplicateOf }
    if (!dryRun && row.preview) {
      for (const key of ['outcome','revenue','allocatedOrdinal','issueCode','financialContractId','financialOrdinal','duplicateOf']) assert.equal(result[key], row.preview[key], `Reviewed ${key} changed`)
    }
    if (dryRun) return result
    if (plan) applyRevenuePlan(tx, plan)
    for (const item of writes) tx[item.type](item.reference, item.data)
    tx.create(receiptRef, { schemaVersion: 1, runId: RUN, sessionId: row.sessionId, contractId: session.contractId,
      sourceEvidenceHash: row.evidenceHash, runtimeHash: runtimeHash(), ...result, previousOrdinal,
      protectedAtRepair: { usedSessions: contract.usedSessions, paidAmount: contract.paidAmount ?? 0,
        totalPrice: contract.totalPrice ?? null, discount: contract.discount ?? 0,
        attendance: pick(attendance, ['attendanceStatus','confirmationSource','confirmedBy','confirmedAt','note','lateMinutes','noShowReason']), sessionRevision: Number(session.revision || 0) },
      createdAt: new Date(), createdBy: ACTOR })
    return result
  }, dryRun ? { readOnly: true } : {})
}

async function makePlan(db) {
  const initialRuntimeHash = runtimeHash()
  const [attendance, ledger] = await Promise.all([period(db, 'attendanceEvents', 'occurredAt'), period(db, 'ledgerEntries', 'effectiveAt')])
  const matched = new Set(ledger.filter(e => e.type === 'revenue_recognition' && e.status === 'posted').map(e => e.attendanceEventId || e.sessionId))
  const candidates = attendance.filter(a => a.billingStatus === 'charged' && !matched.has(a.id) && !a.chargeId)
  assert(candidates.length <= 1500, 'Cohort exceeds migration budget')
  const [sessions, billings] = await Promise.all(['sessions','sessionBillingEvents'].map(col => batches(db, col, candidates.map(a => a.sessionId))))
  const contracts = await batches(db, 'contracts', [...sessions.values()].map(s => s.contractId))
  const rows = candidates.map(attendance => {
    const session = sessions.get(attendance.sessionId), billing = billings.get(attendance.sessionId), contract = contracts.get(session?.contractId)
    return { sessionId: attendance.sessionId, contractId: session?.contractId || '',
      evidenceHash: evidenceHash({ session, attendance, billing, contract }), ordinal: Number(billing?.serviceOrdinal || 0) }
  }).sort((a, b) => a.contractId.localeCompare(b.contractId) || a.ordinal - b.ordinal || a.sessionId.localeCompare(b.sessionId))
  const reservedByContract = new Map(), pendingByContract = new Map()
  const root = id => { const seen = new Set(); while (contracts.get(id)?.sourceContractId) {
    assert(!seen.has(id), 'Cyclic renewal chain'); seen.add(id); id = contracts.get(id).sourceContractId
  } return id }
  const groups = [...Map.groupBy(rows, row => root(row.contractId)).values()]
  let completed = 0
  for (let i = 0; i < groups.length; i += 4) await Promise.all(groups.slice(i, i + 4).map(async group => { for (const row of group) {
    const reserved = reservedByContract.get(row.contractId) || []
    try {
      row.preview = await repairOne(db, row, { dryRun: true, reserved, pendingByContract })
      if (row.preview.allocatedOrdinal) { reserved.push(row.preview.allocatedOrdinal); reservedByContract.set(row.contractId, reserved) }
      if (row.preview.outcome === 'posted') {
        const { financialContractId: id, financialOrdinal: ordinal, revenue } = row.preview
        const p = pendingByContract.get(id) || { recognizedRevenue: 0, revenueBySession: new Map(), revenueByOrdinal: new Map() }
        p.recognizedRevenue += revenue; p.revenueBySession.set(row.sessionId, revenue)
        p.revenueByOrdinal.set(ordinal, new Map([[row.sessionId, revenue]])); pendingByContract.set(id, p)
      }
    } catch (error) { row.preview = { outcome: 'blocked', reason: String(error.message).slice(0, 180) } }
    completed++; if (completed % 100 === 0) process.stderr.write(`Previewed ${completed}/${rows.length}\n`)
  } }))
  const value = { schemaVersion: 1, runId: RUN, project: PROJECT, database: DATABASE, start: START, endExclusive: END,
    runtimeHash: initialRuntimeHash, createdAt: new Date().toISOString(), sourceCounts: { attendance: attendance.length, ledger: ledger.length }, rows }
  assert.equal(runtimeHash(), initialRuntimeHash, 'Runtime changed while previewing; rerun the plan')
  value.planDigest = digest(value)
  if (fs.existsSync(PLAN)) {
    const previous = JSON.parse(fs.readFileSync(PLAN)); fs.copyFileSync(PLAN, path.join(DIR, `${RUN}-plan-${previous.planDigest}.json`))
  }
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(PLAN, JSON.stringify(value, null, 2))
  return { mode: 'plan', planDigest: value.planDigest, candidates: rows.length,
    revenue: rows.reduce((sum, row) => sum + Number(row.preview.revenue || 0), 0),
    outcomes: rows.reduce((counts, row) => { const key = row.preview.outcome; counts[key] = (counts[key] || 0) + 1; return counts }, {}) }
}

// Repair a proven historical mismatch without changing recognized revenue.
// Posted documents remain auditable through an explicit reversal/replacement;
// confirmation, usage, pricing and cash are never rewritten.
async function repairPostedOrdinal(db, input, { dryRun = false } = {}) {
  return db.runTransaction(async tx => {
    const receiptRef = db.doc(`financeReconciliationRepairs/${RUN}_ordinal_${digest(input.sessionId).slice(0, 24)}`)
    const receipt = await tx.get(receiptRef)
    if (receipt.exists) return { alreadyApplied: true, ...receipt.data() }
    const [ss, as, bs] = await Promise.all(['sessions','attendanceEvents','sessionBillingEvents'].map(col => tx.get(db.doc(`${col}/${input.sessionId}`))))
    assert(ss.exists && as.exists && bs.exists, 'Missing posted charge evidence')
    const session = ss.data(), attendance = as.data(), billing = bs.data()
    const cs = await tx.get(db.doc(`contracts/${session.contractId}`)); assert(cs.exists)
    const contract = cs.data(), entryId = session.revenueRecognitionEntryId || attendance.revenueRecognitionEntryId || `pt_session_${input.sessionId}`
    const ref = db.doc(`ledgerEntries/${entryId}`), jr = db.doc(`journalEntries/${entryId}`)
    const [es, js, allLedger, allBilling] = await Promise.all([tx.get(ref), tx.get(jr),
      tx.get(db.collection('ledgerEntries').where('contractId', '==', session.contractId).limit(5001)),
      tx.get(db.collection('sessionBillingEvents').where('contractId', '==', session.contractId).limit(5001))])
    assert(es.exists && allLedger.size <= 5000 && allBilling.size <= 5000)
    const entry = es.data(), target = Number(input.targetOrdinal)
    const sourceHash = digest({ evidence: evidenceHash({ session, attendance, billing, contract }), entry: pick(entry,
      ['type','status','contractId','sessionId','serviceOrdinal','serviceTotal','amount','revenueImpact','receivableImpact','deferredRevenueImpact','effectiveAt']) })
    if (input.sourceHash) assert.equal(sourceHash, input.sourceHash, 'Posted evidence changed')
    assert.equal(entry.type, 'revenue_recognition'); assert.equal(entry.status, 'posted'); assert.equal(entry.sessionId, input.sessionId)
    assert.equal(entry.contractId, session.contractId); assert.equal(session.billingStatus, 'charged')
    assert.equal(billing.contractId, session.contractId); assert.equal(attendance.contractId, session.contractId)
    assert.equal(contract.studentId, session.studentId); assert(!contract.carriedOverSessions, 'Carry pricing requires separate evidence')
    assert.equal(recognitionForServiceOrdinal(contract, target), Number(entry.revenueImpact), 'New share would change posted revenue')
    assertCancellationEvidenceChange({ contract, sourceDate: session.date, changed: true })
    const effective = entry.effectiveAt?.toDate?.() || new Date(entry.effectiveAt)
    assert(!Number.isNaN(effective.getTime()), 'Posted effective date missing')
    const periods = [...new Set([String(session.date).slice(0, 7), vietnamMonthKey(effective)])]
    const periodSnapshots = await Promise.all(periods.map(month => tx.get(db.doc(`financePeriods/${month}`))))
    assert(!periodSnapshots.some(period => period.exists && period.data().status === 'locked'), 'Finance period locked')
    assert(!allLedger.docs.some(d => d.id !== es.id && d.data().status === 'posted' && Number(d.data().revenueImpact) > 0 && Number(d.data().serviceOrdinal) === target), 'Target share already has revenue')
    assert(!allBilling.docs.some(d => d.id !== bs.id && d.data().billingStatus === 'charged' && Number(d.data().serviceOrdinal) === target), 'Target share already billed')
    const relocate = Number(entry.serviceOrdinal) !== target
    const replacementId = `${entryId}_ordinal_${target}`, reversalId = `${replacementId}_reversal`
    const refs = [db.doc(`ledgerEntries/${replacementId}`), db.doc(`journalEntries/${replacementId}`), db.doc(`ledgerEntries/${reversalId}`), db.doc(`journalEntries/${reversalId}`)]
    if (relocate) assert((await Promise.all(refs.map(ref => tx.get(ref)))).every(s => !s.exists), 'Ordinal correction collision')
    const originalJournal = js.exists ? js.data() : ptRevenueJournalWrite({ recognition: entry, contract, sessionId: input.sessionId, actorUid: ACTOR })
    assert.equal(originalJournal.totalDebit, Number(entry.revenueImpact)); assert.equal(originalJournal.totalCredit, Number(entry.revenueImpact))
    const result = { sourceHash, outcome: relocate ? 'posted_ordinal_reallocated' : 'billing_ordinal_aligned', sessionId: input.sessionId,
      previousBillingOrdinal: billing.serviceOrdinal, previousRevenueOrdinal: entry.serviceOrdinal, targetOrdinal: target, revenueChange: 0,
      entryId: relocate ? replacementId : entryId, revenue: Number(entry.revenueImpact) }
    if (dryRun) return result
    const audit = { createdAt: new Date(), createdBy: ACTOR, reconciliationRun: RUN, reason: 'Align original selling share without changing posted revenue.' }
    if (!js.exists) tx.create(jr, originalJournal)
    if (relocate) {
      tx.create(refs[0], { ...entry, ...audit, serviceOrdinal: target, entitlementContractId: session.contractId, entitlementOrdinal: target,
        journalEntryId: replacementId, correctedEntryId: entryId, idempotencyKey: `${RUN}:${input.sessionId}:replacement` })
      tx.create(refs[1], { ...originalJournal, ...audit, documentId: replacementId })
      tx.create(refs[2], { ...entry, ...audit, type: 'adjustment', eventClass: 'revenue_recognition_reversal',
        amount: -Number(entry.amount), revenueImpact: -Number(entry.revenueImpact), cashImpact: 0, expenseImpact: 0,
        receivableImpact: -Number(entry.receivableImpact || 0), deferredRevenueImpact: -Number(entry.deferredRevenueImpact || 0),
        reversedEntryId: entryId, journalEntryId: reversalId, idempotencyKey: `${RUN}:${input.sessionId}:reversal` })
      tx.create(refs[3], { ...originalJournal, ...audit, documentType: 'pt_revenue_recognition_reversal', documentId: reversalId,
        reversedJournalEntryId: entryId, lines: reversedJournalLines(originalJournal.lines) })
      tx.update(ref, { status: 'reversed', reversalEntryId: reversalId, replacementEntryId: replacementId, reversedAt: new Date(), reversedBy: ACTOR })
    }
    for (const doc of [ss, as, bs]) tx.update(doc.ref, { serviceOrdinal: target, previousServiceOrdinal: doc.data().serviceOrdinal ?? null,
      revenueRecognitionEntryId: result.entryId, revenueRecognitionJournalId: result.entryId, revenueRecognitionState: 'posted',
      recognitionReviewRequired: false, recognitionReviewIssueCode: null, ordinalReconciliationRun: RUN, ordinalReconciledAt: new Date() })
    tx.create(receiptRef, { ...result, runId: `${RUN}-ordinal`, contractId: session.contractId, createdAt: new Date(), createdBy: ACTOR })
    return result
  }, dryRun ? { readOnly: true } : {})
}
async function main(argv) {
  const args = Object.fromEntries(argv.map(arg => { const n = arg.indexOf('='); return [arg.slice(2, n), arg.slice(n + 1)] }))
  const db = await connect()
  try {
    if (!args.mode || args.mode === 'plan') return await makePlan(db)
    if (args.mode === 'verify') {
      const [attendance, ledger, receipts] = await Promise.all([period(db, 'attendanceEvents', 'occurredAt'), period(db, 'ledgerEntries', 'effectiveAt'),
        db.collection('financeReconciliationRepairs').where('runId', '==', RUN).limit(1501).get()])
      assert(receipts.size <= 1500)
      let revenue = 0, journals = 0, attendanceUpdatedAfterRepair = 0
      for (const doc of receipts.docs) {
        const r = doc.data(), [session, attendance] = await Promise.all([read(db, `sessions/${r.sessionId}`), read(db, `attendanceEvents/${r.sessionId}`)])
        const confirmationChanged = digest(pick(attendance, Object.keys(r.protectedAtRepair.attendance))) !== digest(r.protectedAtRepair.attendance)
        if (confirmationChanged || Number(session.revision || 0) !== r.protectedAtRepair.sessionRevision) {
          assert(Number(session.revision || 0) > r.protectedAtRepair.sessionRevision, 'Original evidence changed without a new revision')
          const audit = await db.collection('attendanceAuditLogs').where('sessionId', '==', r.sessionId).limit(101).get()
          assert(audit.size <= 100 && audit.docs.some(doc => doc.data().changedAt?.toMillis?.() >= r.createdAt.toMillis()), 'Changed attendance has no subsequent audit')
          attendanceUpdatedAfterRepair++
        }
        if (r.outcome !== 'posted') continue
        const [entry, journal] = await Promise.all([read(db, `ledgerEntries/${r.entryId}`), read(db, `journalEntries/${r.entryId}`)])
        assert(entry && journal); assert.equal(entry.status, 'posted'); assert.equal(entry.cashImpact, 0)
        assert.equal(entry.revenueImpact, r.revenue); assert.equal(entry.contractId, r.financialContractId)
        assert.equal(entry.entitlementContractId || entry.contractId, r.contractId)
        assert.equal(journal.totalDebit, r.revenue); assert.equal(journal.totalCredit, r.revenue)
        assert.equal(journal.lines.reduce((s, line) => s + Number(line.debit || 0), 0), r.revenue)
        assert.equal(journal.lines.reduce((s, line) => s + Number(line.credit || 0), 0), r.revenue)
        revenue += r.revenue; journals++
      }
      const result = { mode: 'verify', at: new Date().toISOString(), receipts: receipts.size, revenue, balancedJournals: journals, attendanceUpdatedAfterRepair,
        reconciliation: attendanceReconciliation(attendance, ledger), outcomes: {} }
      for (const doc of receipts.docs) { const k = doc.data().outcome; result.outcomes[k] = (result.outcomes[k] || 0) + 1 }
      fs.writeFileSync(path.join(DIR, `${RUN}-verify.json`), JSON.stringify(result, null, 2)); return result
    }
    assert.equal(args.mode, 'apply'); assert.equal(args.project, PROJECT); assert.equal(args.database, DATABASE); assert.equal(args.confirm, RUN)
    const saved = JSON.parse(fs.readFileSync(PLAN)), { planDigest, ...value } = saved
    assert.equal(digest(value), planDigest); assert.equal(args.digest, planDigest); assert.equal(value.runtimeHash, runtimeHash())
    const results = []
    for (const row of value.rows) {
      if (row.preview.outcome === 'blocked') { results.push({ sessionHash: digest(row.sessionId), ...row.preview }); continue }
      try { results.push({ sessionHash: digest(row.sessionId), ...await repairOne(db, row) }) }
      catch (error) { results.push({ sessionHash: digest(row.sessionId), outcome: 'blocked', reason: String(error.message).slice(0, 180) }) }
    }
    fs.writeFileSync(path.join(DIR, `${RUN}-apply.json`), JSON.stringify({ at: new Date().toISOString(), planDigest, results }, null, 2))
    return { mode: 'apply', planDigest, outcomes: results.reduce((counts, r) => { const k = r.alreadyApplied ? 'already_applied' : r.outcome; counts[k] = (counts[k] || 0) + 1; return counts }, {}) }
  } finally { await db.terminate() }
}
async function read(db, path) { const snap = await db.doc(path).get(); return snap.data() }
module.exports = { repairOne, repairPostedOrdinal, evidenceHash, makePlan, RUN }
if (require.main === module) main(process.argv.slice(2)).then(r => console.log(JSON.stringify(r))).catch(e => { console.error(String(e.message).replace(/https?:\/\/\S+/g, '[url]')); process.exitCode = 1 })
