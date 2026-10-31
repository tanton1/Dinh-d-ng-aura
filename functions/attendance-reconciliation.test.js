const {test}=require('node:test')
const assert=require('node:assert/strict')
const {attendanceReconciliation:reconcile}=require('./attendance-reconciliation')
const ledger=(patch={})=>({id:'entry',sessionId:'session',attendanceEventId:'session',type:'revenue_recognition',source:'pt_gym',status:'posted',...patch})
test('drill-down index reuses period evidence, preserves grouping, and splits excluded records from approved zero value',()=>{
  const rows=[{id:'a',sessionId:'duplicate',billingStatus:'exempt',duplicateOfSessionId:'original'},
    {id:'b',sessionId:'returned',billingStatus:'exempt',returnedAt:'2026-10-31'},
    {id:'c',sessionId:'free',billingStatus:'exempt',makeupSession:true},
    {id:'d',sessionId:'legacy',billingStatus:'exempt'},
    {id:'e',sessionId:'zero',billingStatus:'charged',revenueRecognitionState:'zero_value_confirmed',zeroValueApproval:{evidenceKey:'proof'}},
    {id:'mirror',sessionId:'zero',billingStatus:'charged',revenueRecognitionState:'zero_value_confirmed',zeroValueApproval:{evidenceKey:'proof'}}]
  const result=reconcile(rows,[],{includeIndex:true})
  assert.equal(result.evidenceCount,5);assert.equal(result.exempt,4);assert.equal(result.zeroValueConfirmed,1)
  assert.deepEqual(result.exemptBreakdown,{duplicate:1,returned:1,complimentary:1,other:1})
  assert.deepEqual(result.caseIndex.exempt,['a','b','c','d']);assert.deepEqual(result.caseIndex.zeroValueConfirmed,['e'])
  assert.equal(reconcile(rows,[]).caseIndex,undefined)
})
test('pending, automatic, exempt and quota evidence are not described as missing revenue',()=>{
  const result=reconcile([
    {id:'pending',sessionId:'pending',attendanceStatus:'pending'},
    {id:'auto',sessionId:'auto',confirmationSource:'auto_after_48h'},
    {id:'exempt',sessionId:'exempt',billingStatus:'exempt'},
    {id:'quota',sessionId:'quota',billingStatus:'review_required'},
    {id:'session',sessionId:'session'},
    {id:'outside',sessionId:'outside',revenueRecognitionEntryId:'outside-period'},
  ],[ledger()])
  assert.equal(result.pendingConfirmation,1);assert.equal(result.automaticReview,1);assert.equal(result.exempt,1)
  assert.equal(result.billingReview,1);assert.equal(result.matchedInPeriod,1);assert.equal(result.unresolved,1)
  assert.equal(result.verifiedMissingPosting,null)
})
test('policy charge matches its own financial evidence without borrowing the original session posting',()=>{
  const events=[{id:'policy_request',sessionId:'session',chargeId:'policy_request'},{id:'session',sessionId:'session'}]
  const result=reconcile(events,[ledger({id:'pt_policy',sessionId:'policy_request',attendanceEventId:'policy_request',sourceSessionId:'session'})])
  assert.equal(result.evidenceCount,2);assert.equal(result.matchedInPeriod,1);assert.equal(result.unresolved,1)
})
test('conflicting duplicate evidence and contract mismatches stay explicit',()=>{
  assert.equal(reconcile([{id:'a',sessionId:'s',billingStatus:'charged'},{id:'b',sessionId:'s',billingStatus:'exempt'}],[]).conflicts,1)
  assert.equal(reconcile([{id:'session',sessionId:'session',contractId:'a'}],[ledger({contractId:'b'})]).conflicts,1)
})
test('charged automatic and pending attendance with a posting are financially reconciled',()=>{
  const result=reconcile([{id:'session',sessionId:'session',confirmationSource:'auto_after_48h'}],[ledger()])
  assert.equal(result.matchedInPeriod,1);assert.equal(result.automaticReview,0);assert.equal(result.posted,1)
  assert.equal(reconcile([{id:'session',sessionId:'session',attendanceStatus:'pending',type:'pending_confirmation'}],[ledger()]).posted,1)
  assert.equal(reconcile([{id:'session',sessionId:'session',contractId:'new'}],[ledger({contractId:'original',entitlementContractId:'new'})]).posted,1)
})
