'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { recordOperationMetrics, withOperationMetrics } = require('./operation-metrics')
const { withFunctionTelemetry, telemetrySampleRate } = require('./observability')

test('request metrics stay isolated across concurrent calls and omit unknown/unsafe fields', async () => {
  const values = await Promise.all([2, 9].map(count => withOperationMetrics(async metrics => {
    recordOperationMetrics({ logicalQueries: 1, documentsReturned: count, cacheHit: false, secret: 'do not record', queueWaitMs: -1 })
    await new Promise(resolve => setTimeout(resolve, count))
    recordOperationMetrics({ logicalQueries: 1, documentsReturned: 1, processingMs: NaN })
    return metrics
  })))
  assert.deepEqual(values, [
    { logicalQueries: 2, documentsReturned: 3, cacheMisses: 1 },
    { logicalQueries: 2, documentsReturned: 10, cacheMisses: 1 },
  ])
  assert.doesNotThrow(() => recordOperationMetrics({ logicalQueries: 1 }))
})

test('sampled success measures response bytes without logging identity or payload', async () => {
  const logs = []
  const wrapped = withFunctionTelemetry('listAcademyCourses', async () => {
    recordOperationMetrics({ cacheHit: true })
    return { privateFood: 'bí mật' }
  }, { successSampleRate: 1, logger: { info: (...args) => logs.push(args), error: assert.fail } })
  assert.deepEqual(await wrapped({ auth: { uid: 'private-owner' }, data: { studentId: 'private-student' } }), { privateFood: 'bí mật' })
  assert.equal(logs.length, 1)
  assert.equal(logs[0][1].metrics.responseBytes, Buffer.byteLength(JSON.stringify({ privateFood: 'bí mật' })))
  assert.equal(logs[0][1].metrics.cacheHits, 1)
  assert.doesNotMatch(JSON.stringify(logs), /private-owner|private-student|privateFood|bí mật/)
})

test('sampling never suppresses failure metrics or changes exception identity', async () => {
  const logs = []
  const error = Object.assign(new Error('private data'), { code: 'unavailable' })
  const wrapped = withFunctionTelemetry('getStudent360Overview', async () => { throw error }, {
    successSampleRate: 0, logger: { info: (...args) => logs.push(args), error: () => {} },
  })
  await assert.rejects(wrapped({}), value => value === error)
  assert.equal(logs[0][1].sampleRate, 1)
  assert.equal(logs[0][1].outcome, 'error')
  assert.doesNotMatch(JSON.stringify(logs), /private data/)
  logs.length = 0
  await withFunctionTelemetry('listTest', async () => ({}), { successSampleRate: 0, logger: { info: (...args) => logs.push(args) } })({})
  assert.equal(logs.length, 0)
})

test('invalid sample configuration falls back safely', () => {
  assert.equal(telemetrySampleRate('bad'), 0.1)
  assert.equal(telemetrySampleRate('0'), 0)
  assert.equal(telemetrySampleRate('1'), 1)
})
