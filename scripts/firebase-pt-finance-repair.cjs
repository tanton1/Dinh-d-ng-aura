'use strict'

// Explicit, bounded repair of the audited October attendance cohort. No price,
// payment, entitlement count or original confirmation evidence is overwritten.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { recordSessionAttendanceTransaction } = require('../functions/session-operations')
const { replacementServiceOrdinal } = require('../functions/service-ordinal-allocation')
const PROJECT = 'gen-lang-client-0815966909'
const DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const RUN = 'pt-finance-20261031-v1'
const ROOT = path.resolve(__dirname, '..')
const DIR = path.join(ROOT, '.migration-private')
const PLAN = path.join(DIR, `${RUN}-plan.json`)
const START = '2026-10-01T17:00:00.000Z', END = '2026-10-31T17:00:00.000Z'
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fields = {
  session: ['contractId','studentId','trainerId','branchId','date','hour','status','billingStatus','attendanceStatus','confirmationSource','confirmedAt','confirmedBy','serviceOrdinal','revenueRecognitionEntryId','revision'],
  attendance: ['sessionId','contractId','studentId','trainerId','type','billingStatus','attendanceStatus','confirmationSource','confirmedAt','confirmedBy','lateMinutes','noShowReason','note','serviceOrdinal','revenueRecognitionEntryId'],
  billing: ['sessionId','contractId','studentId','billingStatus','serviceOrdinal'],
  contract: ['studentId','status','startDate','endDate','totalPrice','discount','paidAmount','totalSessions','sessions','salesCancellationSnapshot','cancellationSettlement','cancelledAt'],
}
const protectedFields={
  session:['studentId','contractId','trainerId','date','hour','status','billingStatus','attendanceStatus','confirmationSource','confirmedAt','confirmedBy','revision'],
  attendance:['studentId','contractId','trainerId','attendanceStatus','confirmationSource','confirmedAt','confirmedBy','lateMinutes','noShowReason','note'],
  contract:['status','studentId','totalPrice','discount','paidAmount','totalSessions','usedSessions','startDate','endDate','cancellationSettlement','salesCancellationSnapshot'],
}
const pickProtected=(kind,value)=>Object.fromEntries(protectedFields[kind].map(key=>[key,value?.[key]??null]))
function evidenceHash(values) {
  return digest(Object.fromEntries(Object.entries(fields).map(([kind, names]) => [kind,
    Object.fromEntries(names.map(key => [key, values[kind]?.[key] ?? null]))])))
}
function runtimeHash() {
  return digest(['functions/session-operations.js','functions/finance-recognition.js','functions/finance-recognition-evidence.js',
    'functions/finance-recognition-balance.js','functions/service-ordinal-allocation.js','functions/contract-usage-core.js',
    'scripts/firebase-pt-finance-repair.cjs'].map(p => [p,digest(fs.readFileSync(path.join(ROOT,p),'utf8'))]))
}
async function connect() {
  const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js'))
  const backendRequire = require('node:module').createRequire(path.join(ROOT,'functions/package.json'))
  const { Firestore } = backendRequire('@google-cloud/firestore')
  const { OAuth2Client } = backendRequire('google-auth-library')
  const account = auth.getProjectDefaultAccount(ROOT) || auth.getGlobalDefaultAccount()
  assert(account?.tokens?.refresh_token, 'Firebase CLI authentication required')
  const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])
  const authClient = new OAuth2Client()
  authClient.setCredentials({access_token:token.access_token,expiry_date:token.expires_at||Date.now()+3_000_000})
  return new Firestore({projectId:PROJECT,databaseId:DATABASE,authClient})
}
async function batches(db, collection, ids) {
  const output = new Map(), unique = [...new Set(ids.filter(Boolean))]
  assert(unique.length <= 10000, 'Document budget exceeded')
  for (let i=0;i<unique.length;i+=100) for (const doc of await db.getAll(...unique.slice(i,i+100).map(id => db.doc(`${collection}/${id}`)))) {
    if (doc.exists) output.set(doc.id, doc.data())
  }
  return output
}
async function period(db, collection, field) {
  const snap = await db.collection(collection).where(field, '>=', new Date(START)).where(field, '<', new Date(END)).limit(10001).get()
  assert(snap.size <= 10000, 'Incomplete period snapshot')
  return snap.docs.map(doc => ({ ...doc.data(), id: doc.id }))
}
async function plan(db) {
  const [attendance, ledger] = await Promise.all([period(db,'attendanceEvents','occurredAt'),period(db,'ledgerEntries','effectiveAt')])
  const sessions = await batches(db,'sessions',attendance.map(row=>row.sessionId))
  const contracts = await batches(db,'contracts',[...sessions.values()].map(row=>row.contractId))
  const matched = new Set(ledger.filter(row=>row.type==='revenue_recognition'&&row.status==='posted'&&row.source==='pt_gym').map(row=>row.sessionId))
  const candidates = attendance.filter(row=>!matched.has(row.sessionId) && ['manual','admin_correction'].includes(row.confirmationSource)
    && ['present','late','no_show'].includes(row.attendanceStatus) && row.billingStatus==='charged')
  assert(candidates.length<=250,'Manual repair cohort exceeds reviewed budget')
  const billings = await batches(db,'sessionBillingEvents',candidates.map(row=>row.sessionId))
  const rows = candidates.map(attendance=>{
    const session=sessions.get(attendance.sessionId), contract=contracts.get(session?.contractId), billing=billings.get(attendance.sessionId)
    return { sessionId: attendance.sessionId, attendanceId: attendance.id, evidenceHash: evidenceHash({session,attendance,billing,contract}),
      contractId: session?.contractId || '', serviceOrdinal: Number(billing?.serviceOrdinal || 0),
      protectedBefore:{session:pickProtected('session',session),attendance:pickProtected('attendance',attendance),contract:pickProtected('contract',contract)},
      request: { attendanceStatus: attendance.attendanceStatus, lateMinutes: attendance.lateMinutes ?? null,
        noShowReason: attendance.noShowReason || '', note: attendance.note || '', confirmationSource: attendance.confirmationSource,
        expectedRevision: Number(session?.revision || 0) } }
  }).sort((a,b)=>a.contractId.localeCompare(b.contractId)||a.serviceOrdinal-b.serviceOrdinal||a.sessionId.localeCompare(b.sessionId))
  const branchRows=attendance.filter(row=>!row.branchId).map(row=>({attendanceId:row.id,sessionId:row.sessionId}))
  const groups = [...Map.groupBy(rows,row=>row.contractId).values()]
  for(let i=0;i<groups.length;i+=5) await Promise.all(groups.slice(i,i+5).map(async group=>{
    const reserved=[]
    for(const row of group) {
      try { const result=await repairOne(db,row,{dryRun:true,reserved});row.preview={outcome:result.recognitionEntryId?'posted':result.recognitionReviewRequired?'review_required':'unchanged',revenue:result.revenue||0,issueCode:result.issueCode||null,
        allocatedOrdinal:result.allocatedOrdinal||null}; if(result.allocatedOrdinal)reserved.push(result.allocatedOrdinal) }
      catch(error){row.preview={outcome:'blocked',reason:String(error.message).slice(0,180)}}
    }
  }))
  const value={schemaVersion:1,runId:RUN,project:PROJECT,database:DATABASE,start:START,endExclusive:END,runtimeHash:runtimeHash(),
    createdAt:new Date().toISOString(),sourceCounts:{attendance:attendance.length,ledger:ledger.length},rows,branchRows}
  value.planDigest=digest(value)
  fs.mkdirSync(DIR,{recursive:true});fs.writeFileSync(PLAN,JSON.stringify(value,null,2))
  return {mode:'plan',planDigest:value.planDigest,manualCandidates:rows.length,branchCandidates:branchRows.length,sourceCounts:value.sourceCounts,
    outcomes:rows.reduce((out,row)=>({...out,[row.preview.outcome]:(out[row.preview.outcome]||0)+1}),{}),revenue:rows.reduce((sum,row)=>sum+(row.preview.revenue||0),0)}
}
async function repairOne(db,row,{dryRun=false,reserved=[]}={}) {
  const receipt=db.doc(`financeReconciliationRepairs/${RUN}_${digest(row.sessionId).slice(0,32)}`)
  const proxy={doc:db.doc.bind(db),collection:db.collection.bind(db),runTransaction:handler=>db.runTransaction(async rawTransaction=>{
    const captured=[]
    const transaction={get:rawTransaction.get.bind(rawTransaction),
      create:(ref,data)=>{captured.push({ref,data});if(!dryRun)rawTransaction.create(ref,data)},
      update:(ref,data)=>{captured.push({ref,data});if(!dryRun)rawTransaction.update(ref,data)}}
    if ((await transaction.get(receipt)).exists) return {unchanged:true,alreadyApplied:true}
    const [ss,as,bs]=await Promise.all(['sessions/'+row.sessionId,'attendanceEvents/'+row.attendanceId,'sessionBillingEvents/'+row.sessionId].map(p=>transaction.get(db.doc(p))))
    assert(ss.exists&&as.exists&&bs.exists,'Required evidence missing')
    const session=ss.data(),attendance=as.data(),billing=bs.data()
    assert(row.attendanceId===row.sessionId,'Noncanonical attendance requires separate review')
    const cs=await transaction.get(db.doc('contracts/'+session.contractId));assert(cs.exists,'Contract missing')
    const contract=cs.data();assert.equal(evidenceHash({session,attendance,billing,contract}),row.evidenceHash,'Evidence changed since plan')
    assert(['manual','admin_correction'].includes(attendance.confirmationSource)&&session.confirmationSource!=='auto_after_48h','Manual evidence required')
    assert(session.studentId===attendance.studentId&&session.studentId===contract.studentId&&session.contractId===billing.contractId,'Evidence identity mismatch')
    assert(Number.isSafeInteger(billing.serviceOrdinal)&&billing.serviceOrdinal>0,'Explicit billing ordinal required')
    const date=String(session.date).slice(0,10), start=String(contract.startDate).slice(0,10),end=String(contract.endDate).slice(0,10)
    assert(/^\d{4}-\d{2}-\d{2}$/.test(start)&&/^\d{4}-\d{2}-\d{2}$/.test(end)&&date>=start&&date<=end,'Contract service window mismatch')
    const [otherBilling,globalLedger,contractLedger]=await Promise.all([
      transaction.get(db.collection('sessionBillingEvents').where('contractId','==',session.contractId).select('sessionId','serviceOrdinal').limit(5001)),
      transaction.get(db.collection('ledgerEntries').where('sessionId','==',row.sessionId).select('status','type','revenueImpact','contractId').limit(101)),
      transaction.get(db.collection('ledgerEntries').where('contractId','==',session.contractId).select('sessionId','serviceOrdinal','status','type','revenueImpact','amount').limit(5001)),
    ])
    assert(otherBilling.size<=5000&&contractLedger.size<=5000&&globalLedger.size<=100,'Evidence budget exceeded')
    const duplicates=otherBilling.docs.filter(doc=>doc.id!==row.sessionId&&doc.data().serviceOrdinal===billing.serviceOrdinal)
    let needsAllocation=contractLedger.docs.some(doc=>{const v=doc.data();return v.sessionId!==row.sessionId&&v.serviceOrdinal===billing.serviceOrdinal
      &&['posted','reversed'].includes(v.status)&&Number(v.revenueImpact??(v.type==='revenue_recognition'?v.amount:0))>0})
    for(const duplicate of duplicates){
      const [otherSession,otherAttendance]=await Promise.all([transaction.get(db.doc('sessions/'+duplicate.id)),transaction.get(db.doc('attendanceEvents/'+duplicate.id))])
      if(!(otherSession.exists&&otherAttendance.exists
        && otherSession.data().billingStatus==='exempt'&&otherAttendance.data().billingStatus==='exempt'
        && otherSession.data().contractId===session.contractId&&otherAttendance.data().contractId===session.contractId))needsAllocation=true
    }
    assert(globalLedger.empty,'Existing ledger outside canonical pointer requires separate review')
    let allocatedOrdinal=null
    if(needsAllocation) {
      const history=await transaction.get(db.collection('sessions').where('contractId','==',session.contractId).limit(5001))
      assert(history.size<=5000,'Session history budget exceeded')
      allocatedOrdinal=replacementServiceOrdinal({sessionId:row.sessionId,contract,reserved,
        sessions:history.docs.map(doc=>({...doc.data(),id:doc.id})),billings:otherBilling.docs.map(doc=>({...doc.data(),id:doc.id})),ledger:contractLedger.docs.map(doc=>doc.data())})
      if(!dryRun&&row.preview)assert.equal(allocatedOrdinal,row.preview.allocatedOrdinal,'Ordinal allocation changed since plan')
      const overrides=new Map([ss,as,bs].map(doc=>[doc.ref.path,doc]))
      transaction.get=async ref=>{
        const original=overrides.get(ref.path)
        if(!original)return rawTransaction.get(ref)
        return {exists:true,id:original.id,ref:original.ref,data:()=>({...original.data(),serviceOrdinal:allocatedOrdinal})}
      }
    }
    const result=await handler(transaction)
    // An ordinal correction is meaningful only when it produces a valid entry.
    // Otherwise preserve the original evidence and its explicit review outcome.
    if(allocatedOrdinal&&result.recognitionEntryId)for(const doc of [ss,as,bs])transaction.update(doc.ref,{serviceOrdinal:allocatedOrdinal,
      previousServiceOrdinal:billing.serviceOrdinal,ordinalReconciliationRun:RUN,ordinalReconciledAt:new Date()})
    else allocatedOrdinal=null
    const revenue=captured.filter(v=>v.ref.path.startsWith('ledgerEntries/')).reduce((sum,v)=>sum+Number(v.data.revenueImpact||0),0)
    if(!dryRun&&row.preview)assert.equal(revenue,row.preview.revenue,'Revenue allocation changed since plan')
    if(dryRun) return {...result,allocatedOrdinal,revenue,
      issueCode:captured.find(v=>v.ref.path.startsWith('revenueRecognitionReviews/'))?.data.issueCode}
    transaction.create(receipt,{schemaVersion:1,runId:RUN,sessionId:row.sessionId,contractId:session.contractId,
      sourceEvidenceHash:row.evidenceHash,runtimeHash:runtimeHash(),createdAt:new Date(),
      outcome:result.recognitionEntryId?'posted':result.recognitionReviewRequired?'review_required':'unchanged',
      recognitionEntryId:result.recognitionEntryId||null,
      revenue,previousServiceOrdinal:billing.serviceOrdinal,allocatedOrdinal,
      termsAtRepair:{totalPrice:contract.totalPrice??null,discount:contract.discount??0,totalSessions:contract.totalSessions??null,paidAmount:contract.paidAmount??null,serviceOrdinal:billing.serviceOrdinal},
      reason:'Repair confirmed historical evidence after mixed runtime recognition policy; preserve original attendance and cash.'})
    return {...result,allocatedOrdinal,revenue}
  },dryRun?{readOnly:true}:{})}
  return recordSessionAttendanceTransaction({db:proxy,sessionId:row.sessionId,actorUid:`system:${RUN}`,...row.request})
}
async function repairBranches(db,rows) {
  let written=0,skipped=0
  for(let i=0;i<rows.length;i+=80) {
    const result=await db.runTransaction(async tx=>{
      const batch=rows.slice(i,i+80),snapshots=await Promise.all(batch.map(async row=>({row,a:await tx.get(db.doc('attendanceEvents/'+row.attendanceId)),s:await tx.get(db.doc('sessions/'+row.sessionId))})))
      const contractIds=[...new Set(snapshots.filter(v=>v.s.exists).map(v=>v.s.data().contractId).filter(Boolean))]
      const contracts=new Map(await Promise.all(contractIds.map(async id=>[id,await tx.get(db.doc('contracts/'+id))])))
      const branchIds=[...new Set(snapshots.filter(v=>v.s.exists).map(v=>v.s.data().branchId).filter(Boolean))]
      const branches=new Map(await Promise.all(branchIds.map(async id=>[id,(await tx.get(db.doc('branches/'+id))).exists])))
      let count=0,skip=0
      for(const {row,a,s} of snapshots){if(!a.exists||!s.exists){skip++;continue}const av=a.data(),sv=s.data(),cv=contracts.get(sv.contractId)?.data();
        if(av.branchId)continue
        if(!branches.get(sv.branchId)||av.sessionId!==row.sessionId||av.studentId!==sv.studentId||av.contractId!==sv.contractId||cv?.studentId!==sv.studentId){skip++;continue}
        tx.update(a.ref,{branchId:sv.branchId,branchReconciliationRun:RUN,branchReconciledAt:new Date()});count++
      }return {count,skip}
    });written+=result.count;skipped+=result.skip
  }return {written,skipped}
}
async function main(argv) {
  const args=Object.fromEntries(argv.map(arg=>arg.replace(/^--/,'').split('=')))
  const mode=args.mode||'plan';assert(['plan','apply','verify'].includes(mode),'Invalid mode')
  const db=await connect()
  try{
    if(mode==='plan')return await plan(db)
    if(mode==='verify'){
      const [attendance,ledger,receipts]=await Promise.all([period(db,'attendanceEvents','occurredAt'),period(db,'ledgerEntries','effectiveAt'),db.collection('financeReconciliationRepairs').where('runId','==',RUN).limit(251).get()])
      assert(receipts.size<=250,'Receipt budget exceeded')
      const saved=JSON.parse(fs.readFileSync(PLAN)),planRows=new Map(saved.rows.map(row=>[row.sessionId,row]))
      const evidence=receipts.docs.map(doc=>doc.data()),posted=evidence.filter(row=>row.outcome==='posted')
      const [sessions,attendances,contracts,entries,journals]=await Promise.all([
        batches(db,'sessions',evidence.map(row=>row.sessionId)),batches(db,'attendanceEvents',evidence.map(row=>row.sessionId)),
        batches(db,'contracts',evidence.map(row=>row.contractId)),batches(db,'ledgerEntries',posted.map(row=>row.recognitionEntryId)),
        batches(db,'journalEntries',posted.map(row=>row.recognitionEntryId)),
      ])
      let revenue=0
      for(const receipt of evidence){
        const row=planRows.get(receipt.sessionId);assert(row?.protectedBefore,'Receipt missing reviewed baseline')
        for(const [kind,value] of [['session',sessions.get(receipt.sessionId)],['attendance',attendances.get(receipt.sessionId)],['contract',contracts.get(receipt.contractId)]]) {
          assert(value,'Protected evidence missing');assert.equal(digest(pickProtected(kind,value)),digest(row.protectedBefore[kind]),`Protected ${kind} changed`)
        }
        if(receipt.outcome!=='posted')continue
        const entry=entries.get(receipt.recognitionEntryId),journal=journals.get(receipt.recognitionEntryId)
        assert(entry&&journal,'Posted repair missing ledger or journal');assert.equal(entry.status,'posted');assert.equal(journal.status,'posted')
        assert.equal(entry.sessionId,receipt.sessionId);assert.equal(entry.contractId,receipt.contractId)
        assert.equal(entry.serviceOrdinal,receipt.allocatedOrdinal||receipt.previousServiceOrdinal)
        assert.equal(entry.revenueImpact,receipt.revenue);assert.equal(entry.cashImpact,0);assert.equal(entry.expenseImpact,0)
        assert.equal(journal.totalDebit,entry.revenueImpact);assert.equal(journal.totalCredit,entry.revenueImpact)
        assert.equal(journal.lines.reduce((sum,line)=>sum+Number(line.debit||0),0),journal.totalDebit)
        assert.equal(journal.lines.reduce((sum,line)=>sum+Number(line.credit||0),0),journal.totalCredit)
        assert.equal(Number(entry.receivableImpact)-Number(entry.deferredRevenueImpact),entry.revenueImpact)
        revenue+=entry.revenueImpact
      }
      const result={mode,at:new Date().toISOString(),reconciliation:require('../functions/attendance-reconciliation').attendanceReconciliation(attendance,ledger),receipts:receipts.size,outcomes:{},
        verifiedRevenue:revenue,balancedJournals:posted.length,protectedEvidenceUnchanged:true,ordinalRepairs:posted.filter(row=>row.allocatedOrdinal).length}
      for(const value of evidence)result.outcomes[value.outcome]=(result.outcomes[value.outcome]||0)+1
      fs.writeFileSync(path.join(DIR,`${RUN}-verify.json`),JSON.stringify(result,null,2));return result
    }
    assert.equal(args.project,PROJECT);assert.equal(args.database,DATABASE);assert.equal(args.confirm,RUN)
    const saved=JSON.parse(fs.readFileSync(PLAN)),{planDigest,...value}=saved
    assert.equal(digest(value),planDigest);assert.equal(args.digest,planDigest);assert.equal(value.runtimeHash,runtimeHash(),'Runtime changed; create a new plan')
    assert.equal(value.project,PROJECT);assert.equal(value.database,DATABASE)
    const results=[]
    for(const row of value.rows){
      if(row.preview.outcome==='blocked'){results.push({sessionHash:digest(row.sessionId),outcome:'blocked',reason:row.preview.reason});continue}
      try {const v=await repairOne(db,row);results.push({sessionHash:digest(row.sessionId),outcome:v.alreadyApplied?'already_applied':v.recognitionEntryId?'posted':v.recognitionReviewRequired?'review_required':'unchanged'})}
      catch(error){results.push({sessionHash:digest(row.sessionId),outcome:'blocked',reason:String(error.message).slice(0,180)})}
    }
    const branches=await repairBranches(db,value.branchRows)
    const result={mode,at:new Date().toISOString(),planDigest,results,branches,outcomes:{}}
    for(const row of results)result.outcomes[row.outcome]=(result.outcomes[row.outcome]||0)+1
    fs.writeFileSync(path.join(DIR,`${RUN}-apply.json`),JSON.stringify(result,null,2))
    return {mode,planDigest,outcomes:result.outcomes,branches}
  }finally{await db.terminate()}
}
module.exports={connect,batches,evidenceHash,repairOne,repairBranches,PROJECT,DATABASE,RUN}
if(require.main===module)main(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(String(error.message).replace(/https?:\/\/\S+/g,'[url]'));process.exitCode=1})
