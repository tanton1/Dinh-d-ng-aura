'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { TARGETS, AUTHORING_TARGETS, STORAGE_RELEASE, validateScope, verifyStorageRules } = require('./academy-release-gate.cjs')

test('only exact Academy scope is allowed and the three writers follow all readers', () => {
  const input = { enabled: 'true', backendOnly: 'true', targets: TARGETS.join(',') }
  assert.equal(validateScope(input).targets.length, 16)
  assert.deepEqual(TARGETS.slice(-3), AUTHORING_TARGETS)
  for (const change of [
    { enabled: 'false' }, { backendOnly: 'false' }, { enabled: 'yes' },
    { targets: TARGETS.slice(1).join(',') }, { targets: [...TARGETS].reverse().join(',') },
    { targets: [...TARGETS, 'unrelated'].join(',') }, { targets: TARGETS.join(',') + ',saveCourseDraftAtomic' },
  ]) assert.throws(() => validateScope({ ...input, ...change }))
  assert.deepEqual(validateScope({ enabled: 'false', backendOnly: 'true', targets: 'listEatCleanDispatchData' }), { academy: false })
})

test('Storage verification binds exact bucket, source and an unchanged live release', async () => {
  const name = 'projects/gen-lang-client-0815966909/rulesets/test-id'
  const release = { name: STORAGE_RELEASE, rulesetName: name, updateTime: 'now' }
  const source = 'rules_version = "2";\n'
  const ruleset = { name, source: { files: [{ name: 'storage.rules', content: source.replace(/\n/g, '\r\n') }] } }
  let reads = 0
  const getJson = async resource => { reads++; return resource === name ? ruleset : release }
  assert.equal((await verifyStorageRules({ getJson, source })).sourceVerified, true)
  assert.equal(reads, 3)
  await assert.rejects(verifyStorageRules({ getJson, source: 'other' }), /differ/)
  await assert.rejects(verifyStorageRules({ getJson: async () => ({ ...release, name: 'wrong-bucket' }), source }), /Unexpected/)
  let visits = 0
  await assert.rejects(verifyStorageRules({ source, getJson: async resource => resource === name ? ruleset
    : { ...release, updateTime: ++visits === 1 ? 'now' : 'later' } }), /changed/)
})

test('Academy production workflow applies and verifies privacy Rules before functions and never rolls back legacy writers', () => {
  const source = fs.readFileSync('.github/workflows/release-production.yml', 'utf8')
  assert.ok(source.indexOf('name: Academy privacy Rules before Functions') < source.indexOf('name: Deploy backend Functions sequentially'))
  assert.match(source, /ACADEMY_RELEASE: \$\{\{ inputs\.academy_release \}\}/)
  assert.match(source, /name: Academy privacy Rules before Functions[\s\S]*?academy-release-gate\.cjs verify-rules/)
  assert.match(source, /rollback_previous\(\) \{[\s\S]*?"\$ACADEMY_RELEASE" = "true"[\s\S]*?return 0/)
  const directRollbacks = source.match(/node scripts\/cloud-run-functions-rollback\.cjs/g) || []
  assert.equal(directRollbacks.length, 1, 'every rollback must go through the Academy-aware guard')
  assert.match(source, /name: Deploy Firestore and Storage Rules\s+if: \$\{\{ !inputs\.academy_release \}\}/)
})
