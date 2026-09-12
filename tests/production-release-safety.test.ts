import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const workflow = readFileSync('.github/workflows/release-production.yml', 'utf8')
const productionSmoke = readFileSync('scripts/production-smoke.mjs', 'utf8')
const healthAudit = readFileSync('scripts/cloud-run-functions-health.cjs', 'utf8')
const rollback = readFileSync('scripts/cloud-run-functions-rollback.cjs', 'utf8')
const require = createRequire(import.meta.url)
const { resolveFunctionTarget } = require('../scripts/firebase-function-region.cjs') as {
  resolveFunctionTarget: (payload: unknown, functionName: string) => { region: string; service: string } | null
}

test('production release never deploys the entire Functions fleet', () => {
  assert.doesNotMatch(workflow, /--only\s+functions(?:\s|$)/)
  assert.match(workflow, /backend_functions/)
  assert.match(workflow, /for FUNCTION_NAME/)
  assert.match(workflow, /cloud-run-functions-health\.cjs/)
  assert.match(workflow, /cloud-run-functions-rollback\.cjs/)
})

test('production release resolves region and Cloud Run service from the Firebase manifest', () => {
  assert.doesNotMatch(workflow, /confirm=gen-lang-client-0815966909\/asia-southeast1/)
  assert.match(workflow, /firebase-function-region\.cjs/)
  assert.match(workflow, /--region="\$FUNCTION_REGION"/)
  assert.match(workflow, /rollback_previous/)
  assert.deepEqual(resolveFunctionTarget({ result: [{
    id: 'getStudent360OverviewRegional',
    state: 'ACTIVE',
    region: 'asia-east1',
    runServiceId: 'getstudent360overviewregional',
  }] }, 'getStudent360OverviewRegional'), {
    region: 'asia-east1',
    service: 'getstudent360overviewregional',
  })
  assert.equal(resolveFunctionTarget({ result: [] }, 'missingFunction'), null)
  assert.throws(() => resolveFunctionTarget({ result: [
    { id: 'duplicateFunction', state: 'ACTIVE', region: 'asia-east1', runServiceId: 'duplicatefunction' },
    { id: 'duplicateFunction', state: 'ACTIVE', region: 'asia-southeast1', runServiceId: 'duplicatefunction' },
  ] }, 'duplicateFunction'), /nhiều region/)
})

test('failed rollout rollback is explicit and pins the last ready revision', () => {
  assert.match(rollback, /--confirm=/)
  assert.match(rollback, /latestReadyRevisionName/)
  assert.match(rollback, /revisionName: readyRevision/)
})

test('production health audit checks the effective traffic revision', () => {
  assert.match(healthAudit, /trafficStatuses/)
  assert.match(healthAudit, /TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST/)
  assert.match(healthAudit, /latestReadyRevision/)
  assert.match(healthAudit, /latestCreatedRevision/)
  assert.match(healthAudit, /latestCreatedIsReady/)
  assert.match(healthAudit, /createdRevision === readyRevision/)
})

test('Student 360 rollout does not require access to unrelated AI secrets', () => {
  const functionsEntry = readFileSync('functions/index.js', 'utf8')

  assert.match(workflow, /AURA_FIREBASE_DISCOVERY_SCOPE/)
  assert.match(workflow, /NODE_ENV:[\s\S]*?aura-student360-discovery/)
  assert.match(workflow, /getStudent360\*\|listStudent360\*/)
  assert.match(workflow, /syncStudent360\*\|reconcileStudent360ProjectionsScheduled\|listInternalNutritionCatalog/)
  assert.match(workflow, /DISCOVERY_SCOPE="student360"/)
  assert.doesNotMatch(workflow, /OPENROUTER_API_KEY:\s*['"]?placeholder/i)
  assert.match(functionsEntry, /isStudent360Discovery/)
  assert.match(functionsEntry, /process\.env\.NODE_ENV === 'aura-student360-discovery'/)
  assert.match(functionsEntry, /if \(!isStudent360Discovery\) \{[\s\S]*?require\('\.\/generative-ai'\)/)
  assert.match(functionsEntry, /if \(!isStudent360Discovery\) \{[\s\S]*?createExerciseCatalogFunctions/)
})

test('production smoke retries a complete cache-busted alias snapshot', () => {
  assert.match(productionSmoke, /readConsistentProductionSnapshot/)
  assert.match(productionSmoke, /url\.searchParams\.set\('aura-smoke'/)
  assert.match(productionSmoke, /cache:\s*'no-store'/)
  assert.match(productionSmoke, /Public alias has not promoted release/)
  assert.match(productionSmoke, /await wait\(snapshotRetryDelayMs\)/)
})
