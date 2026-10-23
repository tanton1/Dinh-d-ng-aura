'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createRegionalReadAliases, REGIONAL_READ_OPTIONS } = require('./regional-read-aliases')
const { createLoyaltyFunctions } = require('./loyalty')
const { createPtWorkoutTrackingFunctions } = require('./pt-workout-tracking')

const noDatabase = new Proxy({}, { get() { throw new Error('Unexpected database access') } })
const onCall = (options, handler) => ({ options, handler })

test('only eight reviewed reads are exported, with a bounded Jakarta profile and no warm floor', () => {
  const aliases = createRegionalReadAliases({ db: noDatabase, onCall })
  assert.equal(Object.keys(aliases).length, 8)
  for (const [name, endpoint] of Object.entries(aliases)) {
    assert.match(name, /^(get|list).+Regional$/)
    for (const [option, value] of Object.entries(REGIONAL_READ_OPTIONS)) assert.equal(endpoint.options[option], value, `${name}.${option}`)
  }
  assert.equal(REGIONAL_READ_OPTIONS.cpu * REGIONAL_READ_OPTIONS.maxInstances * 8, 2.6656)
  assert.equal(aliases.redeemMyRewardRegional, undefined)
  assert.equal(aliases.savePtSessionWorkoutLogRegional, undefined)
})

test('aliases reuse original handlers and never weaken auth, capability or branch checks', async () => {
  const aliases = createRegionalReadAliases({ db: noDatabase, onCall })
  const originals = { ...createLoyaltyFunctions({ db: noDatabase, onCall }), ...createPtWorkoutTrackingFunctions({ db: noDatabase, onCall }) }
  for (const [name, endpoint] of Object.entries(aliases)) {
    assert.equal(endpoint.handler.toString(), originals[name.replace(/Regional$/, '')].handler.toString())
    await assert.rejects(() => endpoint.handler({ data: {} }), (error) => error.code === 'unauthenticated', name)
  }
  assert.equal(originals.getMyLoyaltyDashboard.options.region, 'asia-southeast1')
  assert.equal(originals.getMyLoyaltyDashboard.options.maxInstances, 3)
})
