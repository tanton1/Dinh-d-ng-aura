'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { DEFAULT_POLICY, sourceDocumentId } = require('./loyalty-core')
const { applySourceTarget, reconcileContractSpend, reconcileAttendanceMissions, runLoyaltyBackfillBatch, vestPendingSources } = require('./loyalty')
const { readMemberDashboard, readMemberHistory } = require('./loyalty-member-reads')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `club-launch-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const quiet = { info() {}, warn() {} }
const sourcePath = key => `loyaltySourceBalances/${sourceDocumentId(key)}`
async function fixture(seed = {}, policy = {}) {
  const db = getFirestore(app, `club-${randomUUID()}`)
  clients.push(db)
  const records = Object.entries({
    'students/student-1': { accountUid: 'student-1', branchId: 'a', sessionsPerWeek: 1 },
    'loyaltySettings/current': { activePolicyVersion: 'test-policy', launchDate: '2026-01-01' },
    'loyaltyPolicyVersions/test-policy': { ...DEFAULT_POLICY, earnEnabled: true, ...policy },
    ...seed,
  })
  for (let i = 0; i < records.length; i += 400) {
    const batch = db.batch()
    records.slice(i, i + 400).forEach(([path, value]) => batch.set(db.doc(path), value))
    await batch.commit()
  }
  return db
}
const source = (db, key, points, extra = {}) => applySourceTarget({ db, studentId: 'student-1', accountUid: 'student-1',
  sourceKey: key, sourceType: 'attendance', sourceId: key, description: 'Test', targetPoints: points, ...extra })

test('concurrent PT and Coach rewards share a hard monthly cap, retry safely and release reversed allocations', async () => {
  const db = await fixture()
  const caps = { monthId: '2026-10', total: 250, nutrition: 150 }
  for (let wave = 0; wave < 2; wave++) await Promise.all(Array.from({ length: 3 }, (_, index) =>
    source(db, `reward-${wave * 3 + index}`, 60, { sourceType: wave === 0 ? 'nutrition' : 'attendance', behaviorCaps: caps })))
  let account = (await db.doc('loyaltyAccounts/student-1').get()).data()
  assert.equal(account.availablePoints, 250)
  const balances = (await db.collection('loyaltySourceBalances').get()).docs.map(doc => doc.data())
  assert.equal(balances.filter(value => value.sourceType === 'nutrition').reduce((sum, value) => sum + value.targetPoints, 0), 150)
  const paid = balances.find(value => value.sourceType === 'attendance' && value.targetPoints > 0)
  const result = await source(db, paid.sourceKey, paid.targetPoints, { behaviorCaps: caps })
  assert.equal(result.changed, false)
  await source(db, paid.sourceKey, 0, { behaviorCaps: caps })
  await source(db, 'replacement', 100, { behaviorCaps: caps })
  account = (await db.doc('loyaltyAccounts/student-1').get()).data()
  assert.equal(account.availablePoints, 250)
  await source(db, 'zero-cap', 100, { behaviorCaps: { ...caps, monthId: '2026-11', total: 0 } })
  assert.equal((await db.doc('loyaltyAccounts/student-1').get()).data().availablePoints, 250)
})

test('moving a reward to another month releases its old budget without minting duplicate points', async () => {
  const db = await fixture()
  const options = { sourceType: 'nutrition', behaviorCaps: { monthId: '2026-10', total: 250, nutrition: 150 } }
  await source(db, 'moving', 100, options)
  await source(db, 'moving', 100, { ...options, behaviorCaps: { ...options.behaviorCaps, monthId: '2026-11' } })
  await source(db, 'october-replacement', 100, options)
  const budgets = (await db.collection('loyaltyBehaviorBudgets').get()).docs.map(doc => doc.data())
  assert.deepEqual(budgets.map(value => [value.monthId, value.totalPoints]).sort(), [['2026-10', 100], ['2026-11', 100]])
  assert.equal((await db.doc('loyaltyAccounts/student-1').get()).data().availablePoints, 200)
})

test('real cash upgrades tier during hold, and vesting or refund never double counts it', async () => {
  const db = await fixture()
  const options = { sourceType: 'contract_payment', desiredState: 'pending', targetTierCreditVnd: 12_000_000 }
  await source(db, 'payment', 1200, options)
  let account = (await db.doc('loyaltyAccounts/student-1').get()).data()
  assert.equal(account.pendingPoints, 1200)
  assert.equal(account.tierQualifyingValue, 12_000_000)
  assert.equal(account.tier, 'silver')
  await source(db, 'payment', 1200, { ...options, desiredState: 'available' })
  await source(db, 'payment', 1000, { ...options, desiredState: 'available', targetTierCreditVnd: 10_000_000 })
  account = (await db.doc('loyaltyAccounts/student-1').get()).data()
  assert.equal(account.pendingPoints, 0)
  assert.equal(account.availablePoints, 1000)
  assert.equal(account.tierQualifyingValue, 10_000_000)
})

test('payment pricing and hold are frozen at earning, including later policy pause and refund', async () => {
  const when = Timestamp.fromDate(new Date('2026-10-24T05:00:00Z'))
  const db = await fixture({
    'contracts/old': { studentId: 'student-1', endDate: '2026-10-25' },
    'contracts/contract': { studentId: 'student-1', sourceContractId: 'old', branchId: 'a' },
    'ledgerEntries/payment': { contractId: 'contract', type: 'payment', status: 'posted', cashImpact: 12_000_000, effectiveAt: when },
    'loyaltyAccounts/student-1': { studentId: 'student-1', accountUid: 'student-1', tierQualifyingValue: 25_000_000, tier: 'gold' },
  })
  const reconcile = () => reconcileContractSpend({ db, contractId: 'contract', logger: quiet, now: new Date('2026-10-24T06:00:00Z') })
  await reconcile()
  let balance = (await db.doc(sourcePath('contract_payment:payment')).get()).data()
  assert.equal(balance.targetPoints, 1620)
  assert.equal(balance.state, 'pending')
  const availableAt = balance.availableAt.toMillis()
  await db.doc('loyaltyPolicyVersions/test-policy').update({ vndPerPoint: 20_000, paymentHoldDays: 0, 'tierMultipliers.gold': 2, earnEnabled: false })
  await db.doc('ledgerEntries/refund').set({ contractId: 'contract', type: 'refund', status: 'posted', cashImpact: -2_000_000, effectiveAt: when })
  await reconcile()
  balance = (await db.doc(sourcePath('contract_payment:payment')).get()).data()
  assert.equal(balance.targetPoints, 1350)
  assert.equal(balance.availableAt.toMillis(), availableAt)
  assert.equal((await reconcile()).changed, 0)
})

test('zero hold days makes new payment points available immediately', async () => {
  const db = await fixture({
    'contracts/contract': { studentId: 'student-1' },
    'ledgerEntries/payment': { contractId: 'contract', type: 'payment', status: 'posted', cashImpact: 1_000_000, effectiveAt: Timestamp.fromDate(new Date('2026-10-24T05:00:00Z')) },
  }, { paymentHoldDays: 0 })
  await reconcileContractSpend({ db, contractId: 'contract', logger: quiet, now: new Date('2026-10-24T06:00:00Z') })
  assert.equal((await db.doc('loyaltyAccounts/student-1').get()).data().availablePoints, 100)
})

test('a zero-point staged payment freezes its earning tier only after historical tier backfill finishes', async () => {
  const db = await fixture({
    'contracts/contract': { studentId: 'student-1' },
    'ledgerEntries/payment': { contractId: 'contract', type: 'payment', status: 'posted', cashImpact: 1_000_000, effectiveAt: Timestamp.fromDate(new Date('2026-10-24T05:00:00Z')) },
    'loyaltyAccounts/student-1': { studentId: 'student-1', accountUid: 'student-1', tierQualifyingValue: 26_000_000, tier: 'gold' },
    [sourcePath('contract_payment:payment')]: { studentId: 'student-1', accountUid: 'student-1', sourceKey: 'contract_payment:payment', sourceType: 'contract_payment', sourceId: 'payment', contractId: 'contract', targetPoints: 0, targetTierCreditVnd: 1_000_000, appliedTierCreditVnd: 1_000_000, tierAtSource: 'member', state: 'available' },
  }, { paymentHoldDays: 0 })
  await reconcileContractSpend({ db, contractId: 'contract', logger: quiet, now: new Date('2026-10-24T06:00:00Z') })
  const balance = (await db.doc(sourcePath('contract_payment:payment')).get()).data()
  assert.equal(balance.tierAtSource, 'gold')
  assert.equal(balance.targetPoints, 120)
})

test('voided or removed payments reverse their source balance and tier instead of leaving spendable points', async () => {
  const db = await fixture({
    'contracts/contract': { studentId: 'student-1' },
    'ledgerEntries/payment': { contractId: 'contract', type: 'payment', status: 'posted', cashImpact: 1_000_000, effectiveAt: Timestamp.fromDate(new Date('2026-10-24T05:00:00Z')) },
  }, { paymentHoldDays: 0 })
  const reconcile = () => reconcileContractSpend({ db, contractId: 'contract', logger: quiet, now: new Date('2026-10-24T06:00:00Z') })
  await reconcile()
  await db.doc('ledgerEntries/payment').update({ status: 'voided' })
  await reconcile()
  let account = (await db.doc('loyaltyAccounts/student-1').get()).data()
  assert.equal(account.availablePoints, 0)
  assert.equal(account.tierQualifyingValue, 0)
  await db.doc('ledgerEntries/payment').update({ status: 'posted' })
  await reconcile()
  await db.doc('ledgerEntries/payment').delete()
  await reconcile()
  account = (await db.doc('loyaltyAccounts/student-1').get()).data()
  assert.equal(account.availablePoints, 0)
  assert.equal(account.tierQualifyingValue, 0)
})

test('week 12 earns its milestone once; weeks 13 and 14 do not repeat it', async () => {
  const seed = {}
  const dates = []
  for (let week = 0; week < 14; week++) {
    const date = new Date(Date.parse('2026-06-01T05:00:00Z') + week * 7 * 86400000).toISOString().slice(0, 10)
    dates.push(date)
    const value = { studentId: 'student-1', sessionId: `s-${week}`, scheduledAt: Timestamp.fromDate(new Date(`${date}T05:00:00Z`)), attendanceStatus: 'present', billingStatus: 'charged', confirmationSource: 'manual' }
    seed[`attendanceEvents/a-${week}`] = value
    seed[`sessions/s-${week}`] = { studentId: 'student-1', date }
  }
  const db = await fixture(seed, { recurringBehaviorMonthlyCap: 100000, nutritionEnabled: false })
  for (const week of [11, 12, 13]) {
    await reconcileAttendanceMissions({ db, attendanceId: `a-${week}`, value: seed[`attendanceEvents/a-${week}`], logger: quiet })
    const result = (await db.doc(sourcePath(`attendance_streak:student-1:${dates[week]}`)).get()).data()
    assert.equal(result?.targetPoints || 0, week === 11 ? 200 : 0)
  }
})

test('dashboard reads exactly current mission IDs, latest records and full recognition totals; compact does not query extras', async () => {
  const seed = {}
  for (let i = 0; i < 120; i++) seed[`sessionKudos/k-${i}`] = { studentId: 'student-1', xp: 5, createdAt: Timestamp.fromMillis(1_000_000 + i) }
  for (let i = 0; i < 40; i++) seed[`loyaltyRedemptions/r-${i}`] = { studentId: 'student-1', updatedAt: Timestamp.fromMillis(1_000_000 + i) }
  for (let i = 0; i < 50; i++) seed[`loyaltyMissionProgress/student-1_old_${i}`] = { studentId: 'student-1', monthId: '2025-01' }
  seed['loyaltyMissionProgress/student-1_attendance_week_2026-10-19'] = { studentId: 'student-1', weekId: '2026-10-19' }
  const db = await fixture(seed)
  const input = { db, studentId: 'student-1', weekId: '2026-10-19', monthId: '2026-10' }
  const result = await readMemberDashboard(input)
  assert.equal(result.missionSnapshot.docs.length, 1)
  assert.equal(result.kudosSnapshot.docs.length, 8)
  assert.equal(result.kudosSnapshot.docs[0].id, 'k-119')
  assert.deepEqual(result.kudosTotals, { count: 120, xp: 600 })
  assert.equal(result.redemptionSnapshot.docs.length, 12)
  assert.equal(result.redemptionSnapshot.docs[0].id, 'r-39')
  let hydrated = 0
  const compact = await readMemberDashboard({ ...input, compact: true, db: {
    doc: path => db.doc(path),
    getAll: (...refs) => { hydrated += refs.length; return db.getAll(...refs) },
    collection: name => ({ where() { assert.equal(name, 'sessionKudos'); return {} } }),
  } })
  assert.equal(hydrated, 5)
  assert.equal(compact.redemptionSnapshot.docs.length, 0)
  assert.equal(compact.kudosSnapshot.docs.length, 0)
})

test('cursor history covers more than 300 entries with tied nanosecond timestamps and no repeats after a new insert', async () => {
  const seed = {}
  for (let i = 0; i < 345; i++) seed[`loyaltyLedgerEntries/entry-${String(i).padStart(4, '0')}`] = {
    studentId: 'student-1', createdAt: new Timestamp(1000 + Math.floor(i / 5), i % 2),
  }
  seed['loyaltyLedgerEntries/other'] = { studentId: 'student-2', createdAt: new Timestamp(9999, 0) }
  const db = await fixture(seed)
  const ids = [], reads = [], queries = []
  const wrap = query => ({
    where: (...args) => wrap(query.where(...args)), orderBy: (...args) => wrap(query.orderBy(...args)), startAfter: (...args) => wrap(query.startAfter(...args)),
    limit: cap => { queries.push(cap); return wrap(query.limit(cap)) },
    get: async () => { const snapshot = await query.get(); reads.push(snapshot.size); return snapshot },
  })
  let cursor = ''
  do {
    const page = await readMemberHistory({ db: { collection: name => wrap(db.collection(name)) }, studentId: 'student-1', cursor, pageSize: 30 })
    ids.push(...page.docs.map(doc => doc.id))
    if (!cursor) {
      await assert.rejects(readMemberHistory({ db, studentId: 'student-2', cursor: page.nextCursor }), /Mốc lịch sử/)
      await db.doc('loyaltyLedgerEntries/new-insert').set({ studentId: 'student-1', createdAt: new Timestamp(9999, 0) })
    }
    cursor = page.nextCursor || ''
  } while (cursor)
  assert.equal(ids.length, 345)
  assert.equal(new Set(ids).size, 345)
  assert.equal(ids.includes('other'), false)
  assert.equal(ids.includes('new-insert'), false)
  assert.ok(queries.every(cap => cap === 31))
  assert.ok(reads.every(size => size <= 31))
})

test('launch backfill is rejected before any financial write once earning is enabled', async () => {
  const db = await fixture({ 'contracts/contract': { studentId: 'student-1', startDate: '2026-10-01', endDate: '2026-12-01' } })
  await assert.rejects(runLoyaltyBackfillBatch({ db, actorUid: 'test', mode: 'apply', launchDate: '2026-01-01' }), /Không chạy lại khởi tạo/)
  assert.equal((await db.collection('loyaltySourceBalances').get()).size, 0)
})

test('vesting reads only due enabled sources, so future and disabled rewards cannot starve a due bonus', async () => {
  const db = await fixture()
  for (let i = 0; i < 5; i++) await source(db, `future-${i}`, 100, { sourceType: 'contract_payment', desiredState: 'pending', availableAt: Timestamp.fromDate(new Date('2030-01-01')) })
  await source(db, 'disabled-referral', 100, { sourceType: 'member_referral', desiredState: 'pending', availableAt: Timestamp.fromDate(new Date('2026-01-01')) })
  await source(db, 'welcome', 200, { sourceType: 'launch_bonus', desiredState: 'pending', availableAt: Timestamp.fromDate(new Date('2026-10-24')) })
  const result = await vestPendingSources({ db, logger: quiet, now: new Date('2026-10-25'), limit: 1 })
  assert.equal(result.scanned, 1)
  assert.equal(result.vested, 1)
  assert.equal((await db.doc('loyaltyAccounts/student-1').get()).data().availablePoints, 200)
})
