import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync('.github/workflows/release-production.yml', 'utf8')
const healthAudit = readFileSync('scripts/cloud-run-functions-health.cjs', 'utf8')
const rollback = readFileSync('scripts/cloud-run-functions-rollback.cjs', 'utf8')

test('production release never deploys the entire Functions fleet', () => {
  assert.doesNotMatch(workflow, /--only\s+functions(?:\s|$)/)
  assert.match(workflow, /backend_functions/)
  assert.match(workflow, /for FUNCTION_NAME/)
  assert.match(workflow, /cloud-run-functions-health\.cjs/)
  assert.match(workflow, /cloud-run-functions-rollback\.cjs/)
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
})
