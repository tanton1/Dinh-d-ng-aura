import assert from 'node:assert/strict'
import test from 'node:test'
import type { TrainingHistoryPage } from '../src/services/businessReportingService'
import { mergeTrainingHistoryPage } from '../src/utils/trainingHistoryPagination'

function page(ids: string[], summary: TrainingHistoryPage['summary'] = null): TrainingHistoryPage {
  return {
    schemaVersion: 3, subjectType: 'student', subjectId: 'student-a',
    records: ids.map(id => ({ id, revision: 1 })) as TrainingHistoryPage['records'],
    summary, hasMore: true, nextCursor: 'cursor',
    filters: { startDate: '2026-10-01', endDate: '2026-10-31', status: 'all' },
  }
}
const summary = { total: 20, completed: 18, noShow: 2, cancelled: 0, byStatus: { completed: 18, no_show: 2 }, teaching: null, truncated: false }

test('appending a cursor-only response retains totals and updates overlapping records exactly once', () => {
  const first = page(['a', 'b'], summary)
  const next = page(['b', 'c'])
  next.records[0].revision = 2
  const merged = mergeTrainingHistoryPage(first, next, true)
  assert.equal(merged.summary, summary)
  assert.deepEqual(merged.records.map(row => [row.id, row.revision]), [['a', 1], ['b', 2], ['c', 1]])
  assert.equal(first.records[1].revision, 1, 'the previously rendered page is not mutated')
})

test('a refresh and a legacy backend response replace totals instead of preserving an old count', () => {
  const first = page(['a'], summary)
  const next = page(['b'], { ...summary, total: 21 })
  assert.equal(mergeTrainingHistoryPage(first, next, false), next)
  assert.equal(mergeTrainingHistoryPage(first, next, true).summary?.total, 21)
})

test('person, subject, period and status changes never inherit another scope totals or records', () => {
  const first = page(['private-a'], summary)
  const changes: Array<Partial<TrainingHistoryPage>> = [
    { subjectId: 'student-b' }, { subjectType: 'trainer' },
    { filters: { ...first.filters, startDate: '2026-10-10' } },
    { filters: { ...first.filters, endDate: '2026-10-20' } },
    { filters: { ...first.filters, status: 'no_show' } },
    { filters: { ...first.filters, allTime: true } },
  ]
  for (const change of changes) {
    const next = { ...page(['b']), ...change }
    assert.equal(mergeTrainingHistoryPage(first, next, true), next)
    assert.equal(next.summary, null)
  }
})
