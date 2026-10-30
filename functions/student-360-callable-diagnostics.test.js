'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { HttpsError } = require('firebase-functions/v2/https')
const { withStudent360CallableDiagnostics } = require('./student-360-callable-diagnostics')
const { student360RetryError } = require('./student-360-projection-writes')
const { createStudent360Functions } = require('./student-360')

const operations = ['getStudent360Overview', 'refreshStudent360Projection']
const request = () => ({ auth: { uid: 'PRIVATE_ACTOR', token: { role: 'admin' } }, app: { appId: 'PRIVATE_APP' }, data: { studentId: 'PRIVATE_STUDENT', token: 'PRIVATE_TOKEN', correlationId: 'PRIVATE_CORRELATION' } })
const recorder = logs => Object.fromEntries(['warn', 'error', 'info'].map(level => [level, (message, value) => logs.push({ level, message, value })]))

test('known lease/authority failures retain their exact error envelopes and emit only bounded diagnostics', async () => {
  for (const operation of operations) for (const reason of ['lease_busy', 'lease_replaced_during_write', 'lease_expired_during_write', 'lease_replaced_before_completion', 'progress_authority_changed', 'operations_authority_changed', 'operations_day_changed']) {
    const logs = [], original = student360RetryError(reason), envelope = original.toJSON()
    original.details = { name: 'PRIVATE_NAME', phone: 'PRIVATE_PHONE' }
    const handler = withStudent360CallableDiagnostics(operation, async () => { throw original }, { logger: recorder(logs) })
    await assert.rejects(handler(request()), error => error === original)
    assert.deepEqual(original.toJSON(), { ...envelope, details: original.details })
    const diagnostic = logs.find(entry => entry.level === 'warn')
    assert.deepEqual(Object.keys(diagnostic.value).sort(), ['failurePhase', 'failureReason', 'operation'])
    assert.equal(diagnostic.value.failureReason, reason)
    assert.equal(diagnostic.value.operation, operation)
    assert.equal(logs.find(entry => entry.level === 'error').value.failureCode, 'unavailable')
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_|studentId|actorUid|correlationId|details/)
  }
})

test('unclassified dependencies cannot inject a fake phase, reason or private payload into logs', async () => {
  const logs = [], original = Object.assign(new HttpsError('unavailable', 'PRIVATE_MESSAGE'), { failureReason: 'lease_busy', failurePhase: 'PRIVATE_PHASE' })
  const handler = withStudent360CallableDiagnostics('getStudent360Overview', async () => { throw original }, { logger: recorder(logs) })
  await assert.rejects(handler(request()), error => error === original)
  assert.deepEqual(logs.find(entry => entry.level === 'warn').value, { operation: 'getStudent360Overview', failureReason: 'unclassified', failurePhase: 'unknown' })
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_/)
})

test('logging failures preserve success/error identity and execute the original handler once', async () => {
  for (const fail of [() => { throw Error('sink down') }, () => Promise.reject(Error('sink down'))]) {
    const logger = { info: fail, error: fail, warn: fail }, response = {}, original = student360RetryError('lease_busy')
    let successes = 0, failures = 0
    assert.equal(await withStudent360CallableDiagnostics('refreshStudent360Projection', async () => { successes++; return response }, { logger, successSampleRate: 1 })(request()), response)
    await assert.rejects(withStudent360CallableDiagnostics('refreshStudent360Projection', async () => { failures++; throw original }, { logger })(request()), error => error === original)
    assert.equal(successes, 1); assert.equal(failures, 1)
    await new Promise(resolve => setImmediate(resolve))
  }
})

test('actual overview and refresh handlers preserve a failed rebuild and emit private diagnostics', async () => {
  for (const operation of operations) {
    const logs = [], original = student360RetryError('lease_busy')
    let transactions = 0
    const db = {
      doc: path => ({ path, get: async () => ({ exists: path === 'users/PRIVATE_ACTOR', data: () => path === 'users/PRIVATE_ACTOR' ? { role: 'admin' } : undefined }) }),
      runTransaction: async () => { transactions++; throw original },
    }
    const handler = createStudent360Functions({ db, onCall: (_options, callback) => callback, logger: recorder(logs) })[operation]
    await assert.rejects(handler(request()), error => error === original)
    assert.equal(transactions, 1)
    assert.deepEqual(logs.find(entry => entry.level === 'warn').value, { operation, failureReason: 'lease_busy', failurePhase: 'lease_acquire' })
    assert.equal(logs.find(entry => entry.level === 'error').value.authenticated, true)
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_|studentId|actorUid|correlationId/)
  }
})
