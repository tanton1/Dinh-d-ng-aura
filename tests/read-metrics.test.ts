import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReadMetricBuffer } from '../src/services/readMetrics'

test('read metrics batch actual attempts without payloads or per-read writes', () => {
  const buffer = createReadMetricBuffer(4, 2)
  assert.equal(buffer.record({ operation: 'listStudents', durationMs: 50, attempts: 1, failed: false }), null)
  assert.deepEqual(buffer.record({ operation: 'listStudents', durationMs: 150, attempts: 3, failed: true }), {
    operation: 'listStudents', count: 2, failed: 1, attempts: 4, totalDurationMs: 200, maxDurationMs: 150,
  })
  assert.deepEqual(buffer.snapshot(), [])
})

test('diagnostic memory is bounded and separate buffers cannot share account data', () => {
  const first = createReadMetricBuffer(2)
  const second = createReadMetricBuffer(2)
  for (const operation of ['getA', 'getB', 'getC']) first.record({ operation, durationMs: 1, attempts: 1, failed: false })
  assert.deepEqual(first.snapshot().map(row => row.operation), ['getB', 'getC'])
  assert.deepEqual(second.snapshot(), [])
  assert.equal(first.record({ operation: 'users/private-id', durationMs: 1, attempts: 1, failed: false }), null)
  assert.equal(first.record({ operation: 'getA', durationMs: NaN, attempts: 1, failed: false }), null)
  assert.equal(first.snapshot().length, 2)
})
