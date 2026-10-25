import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

const workflow = readFileSync('.github/workflows/release-production.yml', 'utf8')
const productionSmoke = readFileSync('scripts/production-smoke.mjs', 'utf8')
const productionSmokeReader = readFileSync('scripts/production-smoke-reader.mjs', 'utf8')
const healthAudit = readFileSync('scripts/cloud-run-functions-health.cjs', 'utf8')
const rollback = readFileSync('scripts/cloud-run-functions-rollback.cjs', 'utf8')
const require = createRequire(import.meta.url)
const { resolveFunctionTarget } = require('../scripts/firebase-function-region.cjs') as {
  resolveFunctionTarget: (payload: unknown, functionName: string) => { region: string; service: string } | null
}
const { DATABASE, RELEASE, expectedSource, sourceHash, verifyRulesRelease } = require('../scripts/firebase-firestore-rules-verify.cjs')

test('production release never deploys the entire Functions fleet', () => {
  assert.doesNotMatch(workflow, /--only\s+functions(?:\s|$)/)
  assert.match(workflow, /backend_functions/)
  assert.match(workflow, /for FUNCTION_NAME/)
  assert.match(workflow, /cloud-run-functions-health\.cjs/)
  assert.match(workflow, /cloud-run-functions-rollback\.cjs/)
  assert.match(workflow, /cloud-run-functions-promote-latest\.cjs[^\n]*--traffic-api=v1/)
})

test('backend preparation keeps verification and serving gates while deferring only the frontend smoke', () => {
  assert.match(workflow, /backend_only:\s*description:[^\n]+\s*required: false\s*default: false\s*type: boolean/)
  assert.match(workflow, /if \[ "\$BACKEND_ONLY" = "true" \] && \[ -z "\$TARGETS" \]; then[\s\S]*?exit 1/)
  const steps = workflow.split(/\n      - /)
  for (const name of ['Build and promote production on Vercel', 'Post-deploy smoke']) {
    const step = steps.find((value) => value.startsWith(`name: ${name}\n`) || value.startsWith(`name: ${name}\r\n`))
    assert.ok(step, name)
    assert.match(step, /if: \$\{\{ !inputs\.backend_only \}\}/)
  }
  const backend = steps.find((value) => value.startsWith('name: Deploy backend Functions sequentially'))!
  assert.doesNotMatch(backend, /backend_only/)
  assert.match(backend, /--fail-on-unhealthy/)
  assert.match(workflow, /needs: verify/)
  assert.match(workflow, /ref: \$\{\{ needs\.verify\.outputs\.sha \}\}/)
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

test('failed rollout preserves the verified serving revision rather than guessing latest ready', () => {
  assert.match(rollback, /--confirm=/)
  assert.match(rollback, /service.status\?\.traffic/)
  assert.match(rollback, /ContainerHealthy/)
  assert.match(rollback, /revisionName: readyRevision/)
})

test('release explicitly stages retired images and still requires the strict health gate', () => {
  assert.match(workflow, /cloud-run-functions-promote-latest\.cjs[^\n]*--stage-retired/)
  assert.match(workflow, /cloud-run-functions-health\.cjs[^\n]*--fail-on-unhealthy/)
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.match(pkg.scripts['test:regional-reads'], /cloud-run-retired-stage\.test\.cjs/)
})

test('production health audit checks the effective traffic revision', () => {
  const policy = readFileSync('scripts/cloud-run-revision-policy.cjs', 'utf8')
  assert.match(policy, /trafficStatuses/)
  assert.match(policy, /assertReadyForPromotion/)
  assert.match(healthAudit, /await readRevision\(revisionResource\(service\)\)/)
  assert.match(healthAudit, /requireServing: true/)
  assert.match(healthAudit, /latestReadyRevision/)
  assert.match(healthAudit, /latestCreatedRevision/)
})

test('Student 360 rollout does not require access to unrelated AI secrets', () => {
  const functionsEntry = readFileSync('functions/index.js', 'utf8')

  assert.match(workflow, /AURA_FIREBASE_DISCOVERY_SCOPE/)
  assert.match(workflow, /discovery_node_env=aura-student360-discovery/)
  assert.match(workflow, /NODE_ENV:\s*\$\{\{ steps\.backend\.outputs\.discovery_node_env \}\}/)
  assert.match(workflow, /getStudent360\*\|listStudent360\*/)
  assert.match(workflow, /syncStudent360\*\|reconcileStudent360ProjectionsScheduled\|listInternalNutritionCatalog/)
  assert.match(workflow, /DISCOVERY_SCOPE="student360"/)
  assert.doesNotMatch(workflow, /OPENROUTER_API_KEY:\s*['"]?placeholder/i)
  assert.match(functionsEntry, /isStudent360Discovery/)
  assert.match(functionsEntry, /process\.env\.NODE_ENV === 'aura-student360-discovery'/)
  assert.match(functionsEntry, /if \(!isStudent360Discovery && !isExerciseCatalogDiscovery\) \{[\s\S]*?require\('\.\/generative-ai'\)/)
  assert.match(functionsEntry, /if \(!isStudent360Discovery\) \{[\s\S]*?createExerciseCatalogFunctions/)
})

test('Exercise Catalog rollout does not inspect unrelated OpenRouter secrets', () => {
  const functionsEntry = readFileSync('functions/index.js', 'utf8')

  assert.match(workflow, /EXERCISE_CATALOG_ONLY="true"/)
  assert.match(workflow, /listExerciseCatalog\|getExerciseCatalogItem\|searchExternalExerciseCatalog/)
  assert.match(workflow, /DISCOVERY_SCOPE="exerciseCatalog"/)
  assert.match(workflow, /aura-exercise-catalog-discovery/)
  assert.match(functionsEntry, /isExerciseCatalogDiscovery/)
  assert.match(functionsEntry, /process\.env\.NODE_ENV === 'aura-exercise-catalog-discovery'/)
  assert.match(functionsEntry, /if \(!isStudent360Discovery && !isExerciseCatalogDiscovery\) \{[\s\S]*?require\('\.\/generative-ai'\)/)
  assert.match(functionsEntry, /if \(!isStudent360Discovery\) \{[\s\S]*?require\('\.\/exercise-catalog'\)/)
})

test('production smoke retries a complete cache-busted alias snapshot', () => {
  assert.match(productionSmoke, /readConsistentProductionSnapshot/)
  assert.match(productionSmokeReader, /url\.searchParams\.set\('aura-smoke'/)
  assert.match(productionSmokeReader, /cache:\s*'no-store'/)
  assert.match(productionSmokeReader, /Public alias has not promoted release/)
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.match(pkg.scripts.ci, /test:production-smoke/)
  assert.match(pkg.scripts['test:production-smoke'], /production-smoke-reader\.test\.mjs/)
})

test('rules deployment selects the named database, excludes index deployment and verifies the live source', () => {
  const step = workflow.split(/\n      - /).find(value => value.startsWith('name: Deploy Firestore and Storage Rules'))!
  const selector = step.match(/--only ([^\s]+)/)?.[1].split(',')
  assert.deepEqual(selector, ['firestore:rules', `firestore:${DATABASE}`, 'storage'])
  assert.doesNotMatch(step, /continue-on-error|\|\|\s*true/)
  assert.match(step, /node scripts\/firebase-firestore-rules-verify\.cjs/)
  assert.equal(expectedSource(), readFileSync('firestore.rules', 'utf8'))
})

function rulesFixture() {
  const source = "rules_version = '2';\nservice cloud.firestore {}\n"
  const release = { name: RELEASE, rulesetName: 'projects/gen-lang-client-0815966909/rulesets/rules-123', updateTime: '2026-10-25T00:30:52Z' }
  const ruleset = { name: release.rulesetName, source: { files: [{ name: 'firestore.rules', content: source }] } }
  const requested: string[] = []
  const getJson = async (resource: string) => {
    requested.push(resource)
    if (resource === RELEASE) return release
    assert.equal(resource, release.rulesetName)
    return ruleset
  }
  return { source, release, ruleset, requested, getJson }
}

test('deployed rules proof checks the named release, exact content and a stable final release', async () => {
  const fixture = rulesFixture()
  const proof = await verifyRulesRelease(fixture)
  assert.equal(proof.sourceVerified, true)
  assert.equal(proof.database, DATABASE)
  assert.equal(proof.deployedHash, sourceHash(fixture.source))
  assert.deepEqual(fixture.requested, [RELEASE, fixture.release.rulesetName, RELEASE])
  assert.equal(JSON.stringify(proof).includes(fixture.source), false)
})

test('rules proof accepts CRLF/LF transport differences but rejects changed authorization source', async () => {
  const fixture = rulesFixture()
  fixture.ruleset.source.files[0].content = fixture.source.replace(/\n/g, '\r\n')
  assert.equal((await verifyRulesRelease(fixture)).sourceVerified, true)
  fixture.ruleset.source.files[0].content += '// different release\n'
  await assert.rejects(verifyRulesRelease(fixture), /do not match/)
})

test('default-database or foreign-project releases cannot satisfy the named-database gate', async () => {
  const fixture = rulesFixture()
  fixture.release.name = RELEASE.replace('/' + DATABASE, '')
  await assert.rejects(verifyRulesRelease(fixture), /Unexpected named-database/)
  fixture.release.name = RELEASE
  fixture.release.rulesetName = 'projects/another-project/rulesets/rules-123'
  await assert.rejects(verifyRulesRelease(fixture), /Unexpected named-database/)
})

test('rules proof rejects unexpected, extra or incorrectly named source files', async () => {
  const fixture = rulesFixture()
  fixture.ruleset.name += '-different'
  await assert.rejects(verifyRulesRelease(fixture), /Unexpected deployed/)
  fixture.ruleset.name = fixture.release.rulesetName
  fixture.ruleset.source.files.push({ name: 'extra.rules', content: fixture.source })
  await assert.rejects(verifyRulesRelease(fixture), /Unexpected deployed/)
  fixture.ruleset.source.files.pop()
  fixture.ruleset.source.files[0].name = 'another.rules'
  await assert.rejects(verifyRulesRelease(fixture), /Unexpected deployed/)
})

test('a concurrent rules release invalidates an otherwise matching source proof', async () => {
  const fixture = rulesFixture()
  let calls = 0
  const getJson = async (resource: string) => {
    const result = await fixture.getJson(resource)
    calls++
    return calls === 3 ? { ...result, updateTime: '2026-10-25T00:31:00Z' } : result
  }
  await assert.rejects(verifyRulesRelease({ ...fixture, getJson }), /changed during verification/)
})

test('metadata failures propagate instead of reporting rules deployment success', async () => {
  await assert.rejects(verifyRulesRelease({ source: '', getJson: async () => { throw Error('Rules metadata HTTP 403') } }), /HTTP 403/)
})

test('rules source configuration rejects implicit defaults and ambiguous named targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'aura-rules-verification-'))
  try {
    writeFileSync(join(root, 'firestore.rules'), 'expected')
    for (const firestore of [
      { rules: 'firestore.rules' },
      [{ database: DATABASE, rules: 'other.rules' }],
      [{ database: DATABASE, rules: 'firestore.rules', target: 'alias' }],
      [{ database: DATABASE, rules: 'firestore.rules' }, { database: DATABASE, rules: 'firestore.rules' }],
    ]) {
      writeFileSync(join(root, 'firebase.json'), JSON.stringify({ firestore }))
      assert.throws(() => expectedSource(root), /one explicit firestore.rules source/)
    }
  } finally {
    const cleanupRoot = resolve(root)
    assert.equal(dirname(cleanupRoot), resolve(tmpdir()))
    assert.match(basename(cleanupRoot), /^aura-rules-verification-/)
    rmSync(cleanupRoot, { recursive: true, force: true })
  }
})
