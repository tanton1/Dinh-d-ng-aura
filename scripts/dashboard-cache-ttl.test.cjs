'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseArgs, validateSample, verifyEvidence, FIELD, BASE, COLLECTION, CONFIRM } = require('./dashboard-cache-ttl.cjs')

test('TTL mutation is restricted to the exact approved cache target and explicit journal', () => {
  assert.equal(parseArgs([]).mode, 'status')
  assert.throws(() => parseArgs(['enable', '--journal=x']), /confirmation/)
  assert.throws(() => parseArgs(['enable', `--confirm=${CONFIRM}`]), /journal/)
  assert.throws(() => parseArgs(['enable', '--project=another', '--journal=x']), /Unknown/)
  assert.equal(parseArgs(['enable', `--confirm=${CONFIRM}`, '--journal=x']).mode, 'enable')
})
test('verification never reads a journal sample outside the approved cache collection', () => {
  const sample = { name: `${BASE}/documents/${COLLECTION}/${'a'.repeat(64)}`, expiresAt: '2026-10-01T00:00:00Z' }
  assert.equal(validateSample(sample), sample)
  for (const name of [`${BASE}/documents/students/student`, `${sample.name}/nested/child`, `${BASE}/documents/${COLLECTION}Fake/key`]) assert.throws(() => validateSample({ ...sample, name }))
})

test('sample IDs preserve the expiry-only REST mask and reject URL/path injection', () => {
  const prefix = `${BASE}/documents/${COLLECTION}/`
  const cacheKey = '0123456789abcdef'.repeat(4)
  const expiresAt = '2026-10-01T00:00:00.123456789Z'
  const sample = validateSample({ name: prefix + cacheKey, expiresAt })
  const url = new URL(`https://firestore.googleapis.com/v1/${sample.name}?mask.fieldPaths=expiresAt`)
  assert.equal(url.pathname, `/v1/${prefix}${cacheKey}`)
  assert.equal(url.hash, '')
  assert.deepEqual([...url.searchParams], [['mask.fieldPaths', 'expiresAt']])
  for (const id of ['', '.', '..', 'cache-key', cacheKey.slice(1), cacheKey + 'a', cacheKey.toUpperCase(),
    `${cacheKey}#fragment`, `${cacheKey}?mask.fieldPaths=value`, `${cacheKey}%23fragment`, '%2e%2e',
    `${cacheKey}%2Fnested`, `${cacheKey}/nested`, `${cacheKey}\n`]) {
    assert.throws(() => validateSample({ name: prefix + id, expiresAt }), /outside the cache collection/, id)
  }
  for (const value of [null, {}, { name: 123, expiresAt }, { name: prefix + cacheKey, expiresAt: 123 }]) {
    assert.throws(() => validateSample(value), /outside the cache collection/)
  }
})
test('retirement requires active TTL and an expired sample actually disappearing', () => {
  const field = { name: FIELD, ttlConfig: { state: 'ACTIVE' } }
  const journal = { field: FIELD }
  assert.equal(verifyEvidence(field, journal, []).retirementReady, false)
  assert.equal(verifyEvidence(field, journal, [{ missing: false, expiredAtObservation: true }]).retirementReady, false)
  assert.equal(verifyEvidence(field, journal, [{ missing: true, expiredAtObservation: false }]).retirementReady, false)
  assert.equal(verifyEvidence({ ...field, ttlConfig: { state: 'CREATING' } }, journal, [{ missing: true, expiredAtObservation: true }]).retirementReady, false)
  assert.equal(verifyEvidence(field, journal, [{ missing: true, expiredAtObservation: true }]).retirementReady, true)
  assert.throws(() => verifyEvidence(field, { field: 'other' }, []), /mismatch/)
})
