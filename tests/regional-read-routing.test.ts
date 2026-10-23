import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { regionalReadAliases, isRegionalReadName } from '../src/services/regionalReadPolicy'
import { runKeyedSingleFlight } from '../src/utils/singleFlight'

const require = createRequire(import.meta.url)
const { createRegionalReadAliases } = require('../functions/regional-read-aliases')

test('client allowlist exactly matches server aliases and statically exported names', () => {
  const server = createRegionalReadAliases({ db: {}, onCall: (options: unknown, handler: unknown) => ({ options, handler }) })
  assert.deepEqual(Object.values(regionalReadAliases).sort(), Object.keys(server).sort())
  const entry = readFileSync('functions/index.js', 'utf8')
  for (const alias of Object.values(regionalReadAliases)) assert.ok(entry.includes(`exports.${alias} = regionalReadAliases.${alias}`))
  for (const command of ['redeemMyReward', 'giveSessionKudos', 'savePtSessionWorkoutLog', 'savePtStudentTrainingPlan', 'toString', '__proto__']) {
    assert.equal(isRegionalReadName(command), false)
  }
})

test('simultaneous reads are deduplicated but accounts and later updates are not cached together', async () => {
  const pending = new Map<string, Promise<number>>()
  let requests = 0
  const run = (uid: string) => runKeyedSingleFlight(pending, JSON.stringify([uid, 'getMyLoyaltyDashboard', {}]), async () => ++requests)
  const first = run('a')
  assert.equal(run('a'), first)
  assert.notEqual(run('b'), first)
  await first
  assert.equal(requests, 2)
  await run('a')
  assert.equal(requests, 3)
  assert.equal(pending.size, 0)
})

test('routing shares one correlation, bounds retries, scopes deduplication and leaves writes on legacy transport', () => {
  const service = readFileSync('src/services/regionalReadService.ts', 'utf8')
  assert.match(service, /maximumAttempts: 1/)
  assert.match(service, /runReadOnlyWithFallback/)
  assert.match(service, /JSON\.stringify\(\[uid, name, input\]\)/)
  assert.match(service, /if \(!uid\) return execute\(\)/)
  assert.equal((service.match(/createClientCorrelationId\(\)/g) || []).length, 1)
  const clients = readFileSync('src/lib/firebaseFunctions.ts', 'utf8')
  assert.match(clients, /firebaseNutritionFunctions = getFunctions\(firebaseApp, 'asia-southeast2'\)/)
  assert.match(clients, /firebaseRegionalReadFunctions = firebaseNutritionFunctions/)
  const loyalty = readFileSync('src/features/loyalty/loyaltyService.ts', 'utf8')
  assert.match(loyalty, /if \(isRegionalReadName\(name\)\) return callRegionalRead/)
  assert.match(loyalty, /function call[\s\S]*?httpsCallable[\s\S]*?functionsInstance\(\), name/)
  const workouts = readFileSync('src/services/ptWorkoutTrackingService.ts', 'utf8')
  assert.match(workouts, /httpsCallable<Input, Output>\(firebaseFunctions, name\)/)
  assert.doesNotMatch(workouts, /callReadOnlyFunction/)
})
