'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { repairOne, repairBranches, repairLedgerBranches, repairCancelledAttendance, evidenceHash } = require('../scripts/firebase-pt-finance-repair.cjs')
const { chargeSessionTransaction } = require('./session-operations')
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(localhost|127\.0\.0\.1):\d+$/)
const app=initializeApp({projectId:'demo-aura-fitness'},'pt-repair-'+randomUUID()), clients=[]
after(async()=>{await Promise.all(clients.map(db=>db.terminate()));await deleteApp(app)})
const read=async(db,path)=>(await db.doc(path).get()).data()
async function fixture(extra={}) {
  const db=getFirestore(app,'pt-repair-'+randomUUID());clients.push(db)
  const e={sessionId:'historic',studentId:'student',trainerId:'trainer',contractId:'contract',billingStatus:'charged',
    attendanceStatus:'present',confirmationSource:'manual',confirmedBy:'original-pt',confirmedAt:'2026-10-14T04:00:00Z',serviceOrdinal:1}
  const seed={
    'branches/branch':{name:'Synthetic branch'},
    'contracts/contract':{studentId:'student',status:'active',totalPrice:1000001,discount:0,paidAmount:500000,totalSessions:10,usedSessions:1,startDate:'2026-10-01',endDate:'2027-01-01'},
    'sessions/historic':{...e,date:'2026-10-14',hour:8,status:'completed',branchId:'branch',revision:3},
    'attendanceEvents/historic':{...e,type:'attended',note:'',lateMinutes:null,noShowReason:'',occurredAt:new Date('2026-10-14T01:00:00Z')},
    'sessionBillingEvents/historic':{...e,schemaVersion:2},...extra}
  const batch=db.batch();for(const [path,value] of Object.entries(seed))batch.set(db.doc(path),value);await batch.commit()
  return db
}
async function row(db) {
  const [session,attendance,billing,contract]=await Promise.all(['sessions/historic','attendanceEvents/historic','sessionBillingEvents/historic','contracts/contract'].map(p=>read(db,p)))
  return {sessionId:'historic',attendanceId:'historic',evidenceHash:evidenceHash({session,attendance,billing,contract}),request:{attendanceStatus:'present',confirmationSource:'manual',expectedRevision:3}}
}
test('dry-run does not mutate; concurrent apply and replay post one balanced journal, preserving cash and confirmation',async()=>{
  const db=await fixture(),r=await row(db),beforeContract=await read(db,'contracts/contract'),beforeAttendance=await read(db,'attendanceEvents/historic')
  const preview=await repairOne(db,r,{dryRun:true});assert.equal(preview.revenue,100001)
  assert.equal((await db.collection('ledgerEntries').get()).size,0)
  r.preview={revenue:preview.revenue,allocatedOrdinal:null}
  const result=await Promise.all([repairOne(db,r),repairOne(db,r)])
  assert.equal(result.filter(v=>v.alreadyApplied).length,1)
  const ledger=await read(db,'ledgerEntries/pt_session_historic'),journal=await read(db,'journalEntries/pt_session_historic')
  assert.equal(ledger.cashImpact,0);assert.equal(ledger.revenueImpact,100001)
  assert.equal(journal.totalDebit,journal.totalCredit);assert.equal(journal.totalDebit,ledger.revenueImpact)
  assert.equal(journal.lines.reduce((s,l)=>s+Number(l.debit||0),0),journal.totalDebit)
  assert.deepEqual(await read(db,'contracts/contract'),beforeContract)
  assert.equal((await read(db,'attendanceEvents/historic')).confirmedAt,beforeAttendance.confirmedAt)
  assert.equal((await read(db,'attendanceEvents/historic')).confirmedBy,'original-pt')
  assert.equal((await read(db,'sessions/historic')).revision,3)
  assert.equal((await db.collection('financeReconciliationRepairs').get()).size,1)
  assert.equal((await repairOne(db,r)).alreadyApplied,true)
})
test('changed financial terms abort before every write',async()=>{
  const db=await fixture(),r=await row(db)
  await db.doc('contracts/contract').update({totalPrice:2000000})
  await assert.rejects(repairOne(db,r),/Evidence changed/)
  assert.equal((await db.collection('ledgerEntries').get()).size,0)
  assert.equal((await db.collection('financeReconciliationRepairs').get()).size,0)
})
test('a reused unposted ordinal is reassigned atomically without changing existing revenue or usage',async()=>{
  const db=await fixture()
  await db.doc('contracts/contract').update({usedSessions:2})
  await db.doc('sessions/other').set({studentId:'student',contractId:'contract',date:'2026-10-15',status:'completed',billingStatus:'charged',serviceOrdinal:1})
  await db.doc('sessionBillingEvents/other').set({sessionId:'other',contractId:'contract',serviceOrdinal:1})
  await db.doc('attendanceEvents/other').set({sessionId:'other',contractId:'contract',billingStatus:'charged'})
  const old={contractId:'contract',sessionId:'other',type:'revenue_recognition',source:'pt_gym',status:'posted',serviceOrdinal:1,revenueImpact:100001}
  await db.doc('ledgerEntries/old').set(old)
  const r=await row(db),preview=await repairOne(db,r,{dryRun:true})
  assert.equal(preview.allocatedOrdinal,2);assert.equal(preview.revenue,100000)
  r.preview={revenue:preview.revenue,allocatedOrdinal:2};await repairOne(db,r)
  for(const collection of ['sessions','attendanceEvents','sessionBillingEvents'])assert.equal((await read(db,collection+'/historic')).serviceOrdinal,2)
  assert.deepEqual(await read(db,'ledgerEntries/old'),old)
  assert.equal((await read(db,'contracts/contract')).usedSessions,2)
})
test('branch repair fills verified missing identity only',async()=>{
  const db=await fixture()
  assert.deepEqual(await repairBranches(db,[{attendanceId:'historic',sessionId:'historic'}]),{written:1,skipped:0})
  assert.deepEqual(await repairBranches(db,[{attendanceId:'historic',sessionId:'historic'}]),{written:0,skipped:0})
  await db.doc('attendanceEvents/historic').update({branchId:'',studentId:'wrong'})
  assert.deepEqual(await repairBranches(db,[{attendanceId:'historic',sessionId:'historic'}]),{written:0,skipped:1})
})
test('legacy all scope is replaced by the verified contract branch with financial amounts unchanged',async()=>{
  const db=await fixture()
  await db.doc('sessions/historic').update({branchId:'all'})
  await db.doc('contracts/contract').update({branchId:'branch'})
  await repairOne(db,await row(db))
  const entry=await read(db,'ledgerEntries/pt_session_historic')
  assert.equal(entry.branchId,'branch')
  await db.doc('ledgerEntries/pt_session_historic').update({branchId:'all'})
  await db.doc('journalEntries/pt_session_historic').update({branchId:'all'})
  await db.doc('attendanceEvents/historic').update({branchId:'all'})
  assert.deepEqual(await repairBranches(db,[{attendanceId:'historic',sessionId:'historic'}]),{written:1,skipped:0})
  assert.deepEqual(await repairLedgerBranches(db),{written:1,skipped:0})
  const fixed=await read(db,'ledgerEntries/pt_session_historic')
  for(const key of ['branchId','revenueImpact','amount','cashImpact','receivableImpact','deferredRevenueImpact','effectiveAt'])assert.deepEqual(fixed[key],entry[key])
  assert.deepEqual(await repairLedgerBranches(db),{written:0,skipped:0})
})
test('new charging skips historical ordinals while incrementing actual usage by only one',async()=>{
  const db=await fixture()
  await db.doc('sessionBillingEvents/old').set({contractId:'contract',serviceOrdinal:2})
  await db.doc('sessions/new').set({studentId:'student',trainerId:'trainer',contractId:'contract',branchId:'branch',date:'2026-10-15',hour:8,status:'scheduled',revision:0})
  const result=await chargeSessionTransaction({db,sessionId:'new',actorUid:'system:test',now:new Date('2026-10-16T00:00:00Z')})
  assert.equal(result.serviceOrdinal,3);assert.equal((await read(db,'contracts/contract')).usedSessions,2)
  assert.equal((await read(db,'attendanceEvents/new')).branchId,'branch')
})
test('orphan pending attendance follows explicit cancellation without changing a quota or creating revenue',async()=>{
  const db=await fixture()
  await db.doc('sessions/historic').update({status:'cancelled',billingStatus:'exempt'})
  await db.doc('attendanceEvents/historic').update({type:'pending_confirmation',attendanceStatus:'pending',confirmedAt:null})
  const before=await read(db,'contracts/contract')
  assert.deepEqual(await repairCancelledAttendance(db),{written:1})
  assert.deepEqual(await repairCancelledAttendance(db),{written:0})
  assert.equal((await read(db,'attendanceEvents/historic')).billingStatus,'exempt')
  assert.equal((await db.collection('ledgerEntries').get()).size,0)
  assert.deepEqual(await read(db,'contracts/contract'),before)
})
