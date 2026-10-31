'use strict'

// Query metadata only. Never change prices, payments, dates, status, revision
// or the cancellation baseline while indexing historical contracts.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const backendRequire = require('node:module').createRequire(path.join(__dirname, '../functions/package.json'))
const { FieldValue } = backendRequire('firebase-admin/firestore')
const { contractSalesIndex, hasCurrentContractSalesIndex, readIndexedContractSales,
  SALES_INDEX_GATE } = require('../functions/contract-sales-index')
const { businessContractSales } = require('../functions/business-reporting')
const PROJECT = 'gen-lang-client-0815966909'
const DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const MAXIMUM = 10000
const ROOT = path.resolve(__dirname, '..'), PRIVATE = path.join(ROOT, '.migration-private')
const ROLLOUT_TARGETS = [
  'syncContractUsageView', 'syncStudent360Contract', 'syncContractOperationalActions', 'syncPtScheduleWeeklyViewFromContract',
  'mutateStudent360Contract', 'mutateStudent360ContractRegional', 'renewPtContract', 'renewPtContractRegional',
  'refreshContractRenewalQueueScheduled', 'chargeDuePtSessionsScheduled', 'reconcilePtSessionAutomationScheduled',
  'confirmSessionAttendance', 'recordSessionAttendance', 'bulkRecordSessionAttendance',
  'approveSessionRequest', 'approveSessionRequestRegional', 'approveContractPauseRequest', 'approveContractPauseRequestRegional',
  'confirmMySession', 'confirmMySessionRegional', 'recordMySessionAttendance', 'recordMySessionAttendanceRegional',
  'bulkConfirmMySessions', 'bulkConfirmMySessionsRegional', 'listBusinessPerformance', 'listBusinessPerformanceRegional',
]

function canonical(value) {
  if (value instanceof Date) return value.toISOString()
  if (typeof value?.toMillis === 'function') return { seconds: value.seconds, nanoseconds: value.nanoseconds }
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
function businessHash(value) { const { financeSalesIndex, ...body } = value; return digest(body) }

async function planSalesIndex(db) {
  const snapshot = await db.collection('contracts').limit(MAXIMUM + 1).get()
  assert(snapshot.size <= MAXIMUM, 'Contract audit exceeds its complete-scan budget')
  const rows = snapshot.docs.map(doc => {
    const value = doc.data()
    return { id: doc.id, businessHash: businessHash(value), before: value.financeSalesIndex || null,
      after: contractSalesIndex(value), pending: !hasCurrentContractSalesIndex(value) }
  })
  const plan = { schemaVersion: 1, project: PROJECT, database: DATABASE, createdAt: new Date().toISOString(), rows }
  return { ...plan, planDigest: digest(plan) }
}

async function applySalesIndexPlan(db, plan) {
  const { planDigest, ...body } = plan
  assert.equal(digest(body), planDigest, 'Plan digest mismatch')
  assert.equal(plan.project, PROJECT); assert.equal(plan.database, DATABASE)
  assert.equal(plan.schemaVersion, 1); assert(plan.rows.length <= MAXIMUM)
  assert.equal(new Set(plan.rows.map(row => row.id)).size, plan.rows.length)
  let changed = 0, alreadyCurrent = 0
  for (let offset = 0; offset < plan.rows.length; offset += 100) {
    const rows = plan.rows.slice(offset, offset + 100)
    for (const row of rows) assert(/^[^/]+$/.test(row.id), 'Invalid contract ID')
    const docs = await db.getAll(...rows.map(row => db.doc(`contracts/${row.id}`)))
    const batch = db.batch(); let pending = 0
    docs.forEach((doc, index) => {
      assert(doc.exists, 'Contract removed since plan; make a new plan')
      const value = doc.data(), row = rows[index]
      if (hasCurrentContractSalesIndex(value)) { alreadyCurrent++; return }
      assert.equal(businessHash(value), row.businessHash, 'Business source changed since plan; replan before applying')
      assert.deepEqual(contractSalesIndex(value), row.after)
      batch.update(doc.ref, { financeSalesIndex: row.after }, { lastUpdateTime: doc.updateTime })
      pending++
    })
    if (pending) { await batch.commit(); changed += pending }
  }
  return { changed, alreadyCurrent, total: plan.rows.length }
}

function auditRanges(rows, today) {
  const day = delta => new Date(Date.parse(`${today}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10)
  const ranges = [7, 30, 90].map(days => ({ startDate: day(1 - days), endDate: today }))
  for (const month of new Set(rows.map(row => contractSalesIndex(row).key).filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key)).map(key => key.slice(0, 7)))) {
    const startDate = month + '-01', date = new Date(`${startDate}T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() + 1, 0)
    ranges.push({ startDate, endDate: date.toISOString().slice(0, 10) })
  }
  return [...new Map(ranges.map(range => [JSON.stringify(range), range])).values()]
}

async function auditSalesIndex(db, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())) {
  return db.runTransaction(async transaction => {
    const all = await transaction.get(db.collection('contracts').limit(MAXIMUM + 1))
    assert(all.size <= MAXIMUM, 'Incomplete audit')
    const rows = all.docs.map(doc => doc.data())
    assert(rows.every(hasCurrentContractSalesIndex), 'Canonical index coverage is incomplete or stale')
    const branches = ['all', ...new Set(rows.map(row => row.branchId).filter(Boolean))], ranges = auditRanges(rows, today)
    assert(branches.length * ranges.length <= 600, 'Audit scope exceeds bounded query budget')
    const cases = []
    for (const branchId of branches) for (const range of ranges) {
      const input = { branchId, ...range }, base = db.collection('contracts')
      const result = await readIndexedContractSales(transaction, branchId === 'all' ? base : base.where('branchId', '==', branchId), input, 2000)
      assert.equal(result.mode, 'indexed'); assert.equal(result.truncated, false)
      const summary = { dailySeries: [], contractSalesAdjustment: 0 }
      const legacy = businessContractSales(rows, summary, input)
      const indexed = businessContractSales(result.docs.map(doc => doc.data()), summary, input)
      assert.deepEqual(indexed, legacy, 'Indexed sales differ from full historical scan')
      cases.push({ ...input, legacyDocuments: rows.filter(row => branchId === 'all' || row.branchId === branchId).length,
        indexedDocuments: result.scanned, contractCount: indexed.sales.contractCount,
        missingDates: indexed.contractSalesDatesMissing, unverifiedCancelled: indexed.cancelledSalesBaselineUnverified,
        parity: true })
    }
    return { schemaVersion: 1, auditedAt: new Date().toISOString(), contracts: rows.length, cases,
      sourceDigest: digest(all.docs.map(doc => [doc.id, businessHash(doc.data())])) }
  }, { readOnly: true })
}

function assertDeploymentProof(proof, sha) {
  assert(/^[a-f0-9]{40}$/.test(sha), 'Expected release SHA required')
  assert.equal(proof.project, PROJECT); assert.equal(proof.commit, sha)
  assert(proof.completedAt && !proof.error, 'Rollout has not completed')
  for (const name of ROLLOUT_TARGETS) assert(proof.targets.some(target => target.name === name && target.ready === true
    && target.servingRevision && target.image?.includes('@sha256:')), `Missing verified serving revision: ${name}`)
}

async function enableSalesIndex(db, proof, sha) {
  assertDeploymentProof(proof, sha)
  const audit = await auditSalesIndex(db)
  await db.doc(SALES_INDEX_GATE).set({ schemaVersion: 1, enabled: true, status: 'ready', releaseSha: sha,
    auditedContracts: audit.contracts, auditedCases: audit.cases.length, sourceDigest: audit.sourceDigest,
    verifiedAt: FieldValue.serverTimestamp() })
  return audit
}

function privatePath(file) {
  const full = path.resolve(ROOT, file), relative = path.relative(PRIVATE, full)
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Audit artifacts must stay in .migration-private')
  return full
}
async function main(argv = process.argv.slice(2)) {
  const mode = argv[0] || 'plan', file = argv[1]
  assert(['plan', 'apply', 'verify', 'enable', 'disable'].includes(mode), 'Modes: plan, apply PLAN, verify, enable PROOF SHA, disable')
  const db = await require('./firebase-pt-finance-repair.cjs').connect()
  fs.mkdirSync(PRIVATE, { recursive: true })
  try {
    if (mode === 'plan') {
      const plan = await planSalesIndex(db), target = `.migration-private/contract-sales-plan-${plan.planDigest}.json`
      fs.writeFileSync(privatePath(target), JSON.stringify(plan, null, 2))
      console.log(JSON.stringify({ mode, file: target, contracts: plan.rows.length, pending: plan.rows.filter(row => row.pending).length,
        classifications: plan.rows.reduce((counts, row) => { const key = row.after.key.startsWith('!') ? row.after.key : 'dated'; counts[key] = (counts[key] || 0) + 1; return counts }, {}) }))
    } else if (mode === 'apply') {
      console.log(JSON.stringify({ mode, ...await applySalesIndexPlan(db, JSON.parse(fs.readFileSync(privatePath(file)))) }))
    } else if (mode === 'disable') {
      await db.doc(SALES_INDEX_GATE).set({ enabled: false }, { merge: true })
      console.log(JSON.stringify({ mode, enabled: false }))
    } else {
      const audit = mode === 'enable' ? await enableSalesIndex(db, JSON.parse(fs.readFileSync(privatePath(file))), argv[2]) : await auditSalesIndex(db)
      fs.writeFileSync(path.join(PRIVATE, 'contract-sales-audit.json'), JSON.stringify(audit, null, 2))
      console.log(JSON.stringify({ mode, contracts: audit.contracts, parityCases: audit.cases.length,
        sevenDays: audit.cases.find(row => row.branchId === 'all'), artifact: '.migration-private/contract-sales-audit.json' }))
    }
  } finally { await db.terminate() }
}
module.exports = { planSalesIndex, applySalesIndexPlan, auditSalesIndex, assertDeploymentProof, enableSalesIndex, businessHash, ROLLOUT_TARGETS }
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
