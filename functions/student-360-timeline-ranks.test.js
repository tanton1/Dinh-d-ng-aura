const test = require('node:test')
const assert = require('node:assert/strict')
const { timelineRanks, operationsTimeline } = require('./student-360')

const types = ['contract', 'training', 'workout', 'freeze', 'off', 'schedule_change', 'nutrition', 'checkin', 'finance', 'renewal', 'progress']
const operations = new Set(['training', 'freeze', 'off', 'schedule_change'])
const expected = rows => rows.slice(0, 400).filter(row => operations.has(row.type))

test('compact rankings retain the global cap, stable tie order, and older rows entering after deletion', () => {
  for (const pattern of ['same-time', 'interleaved']) {
    const rows = types.flatMap((type, group) => Array.from({ length: 430 }, (_, index) => ({
      id: type + index, type, sortKey: pattern === 'same-time' ? 1234000 : 1234000 - index * 11 - (group % 3),
    }))).sort((a, b) => b.sortKey - a.sortKey)
    const ranks = timelineRanks(rows)
    assert.ok(ranks.length < 40_000)
    assert.ok(Object.values(JSON.parse(ranks)).every(group => group.length <= 400))
    assert.deepEqual(operationsTimeline(rows, JSON.parse(ranks)), expected(rows), pattern)
    const changed = rows.filter(row => !operations.has(row.type) || Number(row.id.replace(/\D/g, '')) > 100)
    assert.deepEqual(operationsTimeline(changed, JSON.parse(ranks)), expected(changed), pattern + ' after deletion')
  }
  const boundary = [
    ...Array.from({ length: 398 }, (_, index) => ({ id: 'finance' + index, type: 'finance', sortKey: 9000 })),
    ...types.map(type => ({ id: type, type, sortKey: 8000 })),
  ]
  assert.deepEqual(operationsTimeline(boundary, JSON.parse(timelineRanks(boundary))), expected(boundary))
})
