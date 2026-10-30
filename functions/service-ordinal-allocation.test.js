'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { replacementServiceOrdinal, nextServiceOrdinal } = require('./service-ordinal-allocation')

const service = (id, date, serviceOrdinal) => ({ id, date, serviceOrdinal, contractId:'contract', studentId:'student', billingStatus:'charged', status:'completed' })
const fixture = () => ({ sessionId:'a', contract:{totalSessions:4,usedSessions:2},
  sessions:[service('a','2026-10-14',2),service('b','2026-10-15',2)],
  billings:[{sessionId:'a',serviceOrdinal:2},{sessionId:'b',serviceOrdinal:2}],ledger:[] })

test('mutable usage never reuses a share already billed or recognized', () => {
  assert.equal(nextServiceOrdinal({usedSessions:2,totalSessions:5,billings:[{serviceOrdinal:3}],revenueOrdinals:[4]}),5)
  assert.equal(nextServiceOrdinal({usedSessions:2,totalSessions:4,billings:[{serviceOrdinal:3}],revenueOrdinals:[4]}),null)
})
test('historical unposted service uses an unoccupied share and preserves reserved allocations', () => {
  const value=fixture()
  assert.equal(replacementServiceOrdinal(value),1)
  assert.equal(replacementServiceOrdinal({...value,reserved:[1]}),3)
  assert.deepEqual(value,fixture())
})
test('incomplete history and a duplicate appointment cannot become extra revenue', () => {
  assert.throws(()=>replacementServiceOrdinal({...fixture(),contract:{totalSessions:4,usedSessions:3}}),/Incomplete/)
  assert.throws(()=>replacementServiceOrdinal({...fixture(),sessionId:'b',sessions:[service('a','2026-10-14',2),service('b','2026-10-14',2)]}),/Noncanonical/)
})
test('posted and reversed financial evidence stays immutable and reserves its share', () => {
  const value=fixture(),entry={sessionId:'older',serviceOrdinal:1,type:'revenue_recognition',status:'posted',revenueImpact:100}
  for(const status of ['posted','reversed'])assert.equal(replacementServiceOrdinal({...value,ledger:[{...entry,status}]}),3)
  assert.throws(()=>replacementServiceOrdinal({...value,ledger:[{...entry,sessionId:'a'}]}),/already has financial/)
  assert.throws(()=>replacementServiceOrdinal({...value,ledger:[{...entry,serviceOrdinal:undefined}]}),/Unallocated/)
})
