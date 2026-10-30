'use strict'

const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { createReadBudgetObserver, installLocalNetworkGuard, sourceBinding } = require('./test-helpers/reporting-read-budget.cjs')
const network = installLocalNetworkGuard()
process.env.METADATA_SERVER_DETECTION = 'none'
// Install the guard before loading any Google SDK. No provider or production
// credentials are needed; every socket opened by this process is loopback only.
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { trustedAccessContext } = require('./identity-access')
const { createScopedReportingReadFunctions, summarizeAcademy, summarizeReceivables } = require('./scoped-reporting-reads')

const ROOT = path.resolve(__dirname, '..'), N = 5501, PAGE_SIZE = 20, TODAY = '2026-10-30'
const ACTOR_ID = 'fixture-admin'
const auth = { uid: ACTOR_ID, token: { role: 'admin', accessRole: 'admin', authzVersion: 1 } }
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `read-budget-${randomUUID()}`)
const rawDb = getFirestore(app, `read-budget-${randomUUID()}`)
after(async () => { await rawDb.terminate(); await deleteApp(app); network.restore() })
const { db, measure } = createReadBudgetObserver(rawDb, { actorId: ACTOR_ID })
const api = createScopedReportingReadFunctions({ db, onCall: handler => handler, logger: { warn() {}, info() {}, error() {} } })

const enrollmentFields = ['userId', 'courseId', 'status', 'enrolledAt', 'updatedAt']
const userFields = ['displayName', 'email', 'role', 'membership', 'disabled']
const studentFields = ['name', 'phone', 'email']
const contractFields = ['studentId', 'branchId', 'packageName', 'totalPrice', 'discount', 'paidAmount', 'status', 'installments', 'nextPaymentDate', 'pausePeriods', 'frozenAt']
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8')
const records = snapshot => snapshot.docs.map(document => ({ id: document.id, ...document.data() }))

async function seed() {
  await rawDb.doc(`users/${ACTOR_ID}`).set({ role: 'admin', displayName: 'Fixture admin', disabled: false })
  await rawDb.doc(`roleAssignments/${ACTOR_ID}`).set({ accessRole: 'admin', authzVersion: 1, status: 'active', branchIds: [], positions: [] })
  for (let offset = 0; offset < N; offset += 90) {
    const batch = rawDb.batch()
    for (let i = offset; i < Math.min(N, offset + 90); i++) {
      const id = `fixture-${String(i).padStart(5, '0')}`
      batch.set(rawDb.doc(`enrollments/${id}_course`), { userId: id, courseId: 'course', status: 'active', enrolledAt: '2026-10-01T00:00:00.000Z' })
      batch.set(rawDb.doc(`users/${id}/progress/course`), { courseId: 'course', percent: 50 })
      batch.set(rawDb.doc(`users/${id}`), { displayName: `Learner ${i}`, email: `${id}@example.test`, role: 'student', membership: 'free', disabled: false })
      batch.set(rawDb.doc(`contracts/${id}`), { studentId: id, branchId: 'a', packageName: 'Fixture package', status: 'active', totalPrice: 1000000, paidAmount: 200000, discount: 0, nextPaymentDate: '2026-10-20' })
      batch.set(rawDb.doc(`students/${id}`), { name: `Student ${i}`, phone: '0000000000', email: `${id}@example.test` })
    }
    await batch.commit()
  }
  await rawDb.doc('contracts/other-branch').set({ studentId: 'other-branch', branchId: 'b', status: 'active', totalPrice: 999999999, paidAmount: 0 })
  await rawDb.doc('students/other-branch').set({ name: 'Other branch fixture' })
}

async function allLabels(collection, ids, fields) {
  const unique = [...new Set(ids)], result = []
  // An uncapped complete reference, chunked only for transport size. No input
  // slicing or 5k cap; every ID from the full source query is included.
  for (let i = 0; i < unique.length; i += 200) {
    const snapshots = await db.getAll(...unique.slice(i, i + 200).map(id => db.doc(`${collection}/${id}`)), { fieldMask: fields })
    result.push(...snapshots.filter(item => item.exists).map(item => ({ id: item.id, ...item.data() })))
  }
  return result
}

async function fullAcademyReference() {
  await trustedAccessContext({ auth }, db)
  const enrollment = await db.collection('enrollments').select(...enrollmentFields).get()
  const progress = await db.collectionGroup('progress').select('courseId', 'percent').get()
  const labels = await allLabels('users', enrollment.docs.map(row => row.data().userId), userFields)
  return { fullClientPayload: { enrollments: records(enrollment), progress: records(progress), users: labels },
    canonical: summarizeAcademy(enrollment.docs, progress.docs) }
}
async function fullFinanceReference() {
  await trustedAccessContext({ auth }, db)
  const contracts = await db.collection('contracts').where('branchId', '==', 'a').select(...contractFields).get()
  const labels = await allLabels('students', contracts.docs.map(row => row.data().studentId), studentFields)
  return { fullClientPayload: { contracts: records(contracts), students: labels },
    canonical: summarizeReceivables(contracts.docs, TODAY, 'a') }
}
function describePhase(measured, client, summary) {
  return { counters: measured.counters, elapsedMs: measured.elapsedMs, client,
    summary: { complete: summary.complete, cacheHit: summary.cache?.hit === true,
      sourceDocumentsAtBuild: summary.sourceDocuments, asOf: summary.asOf } }
}
function describeAcademy(value) {
  return { sourceRows: value.page.enrollments.length, labelRows: value.page.users.length,
    aggregateRows: value.summary.courses.length, jsonBytes: bytes(value) }
}
function describeFinance(value) {
  return { sourceRows: value.contracts.length, labelRows: value.students.length,
    aggregateRows: value.summary ? 1 : 0, jsonBytes: bytes(value) }
}
function referenceDescription(result, kind) {
  const full = result.value.fullClientPayload
  return { counters: result.counters, elapsedMs: result.elapsedMs,
    client: { sourceRows: kind === 'academy' ? full.enrollments.length + full.progress.length : full.contracts.length,
      labelRows: kind === 'academy' ? full.users.length : full.students.length,
      aggregateRows: 0, jsonBytes: bytes(full) }, complete: result.value.canonical.complete }
}
function comparison(reference, cold, warm) {
  const reduction = (before, after) => (before - after) / before
  return { returnedSourceRowsReduction: reduction(reference.client.sourceRows, cold.client.sourceRows),
    returnedSourceAndLabelRowsReduction: reduction(reference.client.sourceRows + reference.client.labelRows, cold.client.sourceRows + cold.client.labelRows),
    jsonBytesReduction: reduction(reference.client.jsonBytes, cold.client.jsonBytes),
    warmSourceDocumentSnapshotReduction: reduction(cold.counters.buckets.source.queryDocumentSnapshots, warm.counters.buckets.source.queryDocumentSnapshots),
    clientDocumentReductionTarget: 0.8 }
}

test('paired Academy and Finance SDK read budgets with production authorization and fixture claims', { timeout: 240000 }, async () => {
  const binding = sourceBinding(ROOT), startedAt = new Date().toISOString()
  await seed()
  const financeInput = { branchId: 'a', category: 'all', filter: 'all', today: TODAY, pageSize: PAGE_SIZE }
  const openAcademy = async () => ({
    summary: await api.getAcademyAnalyticsSummary({ auth, data: {} }),
    page: await api.listAcademyEnrollmentsPage({ auth, data: { pageSize: PAGE_SIZE } }),
  })
  const openFinance = () => api.listFinanceReceivables({ auth, data: financeInput })
  // Measure before asserting counts: the cold/warm numbers are observations,
  // not pre-filled budgets. Checks below enforce semantic and boundedness gates.
  const academyCold = await measure(openAcademy)
  const academyWarm = await measure(openAcademy)
  const financeCold = await measure(openFinance)
  const financeWarm = await measure(openFinance)
  const academyReference = await measure(fullAcademyReference)
  const financeReference = await measure(fullFinanceReference)

  assert.equal(academyReference.value.fullClientPayload.enrollments.length, N)
  assert.equal(academyReference.value.fullClientPayload.progress.length, N)
  assert.equal(financeReference.value.fullClientPayload.contracts.length, N)
  assert.equal(academyReference.value.fullClientPayload.users.length, N)
  assert.equal(financeReference.value.fullClientPayload.students.length, N)
  assert.equal(academyCold.value.summary.complete, true)
  assert.equal(financeCold.value.summary.complete, true)
  assert.equal(academyCold.value.summary.courses[0].learners, N)
  assert.equal(academyCold.value.summary.courses[0].averageCompletion, 50)
  assert.equal(financeCold.value.summary.totals.debt, N * 800000)
  assert.deepEqual(academyCold.value.summary.courses, academyReference.value.canonical.courses)
  assert.deepEqual(financeCold.value.summary.totals, financeReference.value.canonical.totals)
  assert.deepEqual(financeCold.value.summary.counts, financeReference.value.canonical.counts)
  for (const [cold, warm, coldSummary, warmSummary] of [
    [academyCold, academyWarm, academyCold.value.summary, academyWarm.value.summary],
    [financeCold, financeWarm, financeCold.value.summary, financeWarm.value.summary],
  ]) {
    assert.equal(warmSummary.cache.hit, true)
    assert.equal(warmSummary.asOf, coldSummary.asOf)
    assert.equal(warmSummary.sourceDocuments, coldSummary.sourceDocuments)
    assert.ok(warm.counters.buckets.source.queryDocumentSnapshots < cold.counters.buckets.source.queryDocumentSnapshots)
    assert.equal(warm.counters.transactions.readOnlyCalls, 0, 'Warm open must not build another summary snapshot')
    assert.equal(warm.counters.buckets.cache.committedWrites, 0)
    assert.ok(cold.counters.buckets.auth.pointReadAttempts > 0)
    assert.ok(warm.counters.buckets.auth.pointReadAttempts > 0, 'A cache hit still performs current authorization')
  }
  assert.deepEqual(academyWarm.value.summary.courses, academyCold.value.summary.courses)
  assert.deepEqual(financeWarm.value.summary.totals, financeCold.value.summary.totals)
  assert.equal(academyCold.value.page.enrollments.length, PAGE_SIZE)
  assert.equal(financeCold.value.contracts.length, PAGE_SIZE)
  assert.ok(financeCold.value.contracts.every(row => row.branchId === 'a'))
  assert.ok(financeWarm.value.contracts.every(row => row.branchId === 'a'))
  assert.ok(academyCold.value.page.hasMore && financeCold.value.hasMore)

  const academy = { reference: referenceDescription(academyReference, 'academy'),
    cold: describePhase(academyCold, describeAcademy(academyCold.value), academyCold.value.summary),
    warm: describePhase(academyWarm, describeAcademy(academyWarm.value), academyWarm.value.summary) }
  const finance = { reference: referenceDescription(financeReference, 'finance'),
    cold: describePhase(financeCold, describeFinance(financeCold.value), financeCold.value.summary),
    warm: describePhase(financeWarm, describeFinance(financeWarm.value), financeWarm.value.summary) }
  academy.comparison = comparison(academy.reference, academy.cold, academy.warm)
  finance.comparison = comparison(finance.reference, finance.cold, finance.warm)
  assert.ok(academy.comparison.returnedSourceAndLabelRowsReduction >= 0.8)
  assert.ok(finance.comparison.returnedSourceAndLabelRowsReduction >= 0.8)

  // Fail-closed probes use the same production authorization path. Mutation is a
  // synthetic admin fixture update, outside both budget windows.
  const unauthenticated = await measure(async () => {
    await assert.rejects(api.getAcademyAnalyticsSummary({ data: {} }), { code: 'unauthenticated' })
    await assert.rejects(api.listFinanceReceivables({ data: financeInput }), { code: 'unauthenticated' })
  })
  await rawDb.doc(`users/${ACTOR_ID}`).update({ disabled: true })
  const revoked = await measure(async () => {
    await assert.rejects(openAcademy(), { code: 'permission-denied' })
    await assert.rejects(openFinance(), { code: 'permission-denied' })
  })
  for (const result of [unauthenticated, revoked]) {
    assert.equal(result.counters.buckets.source.queryAttempts, 0)
    assert.equal(result.counters.buckets.label.pointReadAttempts, 0)
    assert.equal(result.counters.buckets.cache.pointReadAttempts, 0)
  }
  assert.equal(network.blocked.length, 0)
  assert.deepEqual(sourceBinding(ROOT), binding, 'Source must remain unchanged throughout the measurement')
  const artifact = { schemaVersion: 1, kind: 'emulator-sdk-read-budget', startedAt, completedAt: new Date().toISOString(), source: binding,
    fixture: { version: 1, project: 'demo-aura-fitness', learners: N, progress: N, branchAContracts: N, branchBSentinelContracts: 1,
      distinctLabelsPerDomain: N, pageSize: PAGE_SIZE, today: TODAY, financeBranch: 'a', financeCategory: 'all', financeFilter: 'all',
      auth: 'production trustedAccessContext with fixture admin profile, assignment and request.auth claims; live profile; normal 5s assignment cache; onCall transport/token verification not exercised',
      order: ['academy-cold', 'academy-warm', 'finance-cold', 'finance-warm', 'complete-academy-reference', 'complete-finance-reference'],
      sharedSummaryCacheTtlSeconds: 180, mutationBetweenColdAndWarm: false, reference: 'complete full-list fixture reference, no source limit, canonical current formulas; not historical production measurement' },
    academy, finance, authorizationProbes: { unauthenticated: unauthenticated.counters, disabledAfterWarmCache: revoked.counters },
    limitations: [
      'Counts observe public Firestore SDK calls/results, not billed reads, index entries, wire RPC retries, rule reads, or provider invoices.',
      'Point read attempts include missing documents; existing and missing snapshots are reported separately. Query documents include page sentinels.',
      'Transaction callback attempts include retries; committedWrites counts only the final successful callback after runTransaction resolves.',
      'sourceDocumentsAtBuild is retained summary metadata and is never substituted for measured reads on warm calls.',
      'Seed, complete-reference reads and authorization probes are outside each cold/warm measurement window.',
      'Cold/warm means summary cache state, not process startup or browser lifecycle; page and label reads still execute on both calls.',
      'The production profile/roleAssignment authorization path is exercised with fixture request.auth claims; Firebase token verification, callable transport and App Check are not exercised.',
      'JSON byte counts serialize handler response objects and the reference payload; callable envelopes, compression and network traffic are excluded.',
      'The 80% target concerns returned document rows versus this complete fixture reference; it is not a server cold-read or billing reduction claim.',
      'Emulator timings and this dense unsearched first-page scope are not production latency or sparse/search/category cost measurements.',
    ] }
  const output = process.env.REPORTING_READ_BUDGET_OUTPUT || path.join(ROOT, '.migration-private', `reporting-read-budget-${Date.now()}.json`)
  assert.equal(path.dirname(path.resolve(output)), path.join(ROOT, '.migration-private'), 'Evidence must remain in this worktree private directory')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ readBudgetArtifact: path.basename(output), academy: academy.comparison, finance: finance.comparison }))
})
