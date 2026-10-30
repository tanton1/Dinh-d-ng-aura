import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFinanceTimeline, financeChartGeometry, financeTimelineReconciles, type FinanceChartSeries } from '../src/components/admin/pt/finance-analytics/financeAnalytics'

test('full selected period preserves negative and zero days without truncating to the final 14', () => {
  const report = buildFinanceTimeline({ startDate: '2026-10-01', endDate: '2026-10-30' }, [
    { date: '2026-10-01', values: { netCash: 20, revenue: 4 } },
    { date: '2026-10-29', values: { netCash: -12, revenue: -2 } },
  ], ['netCash', 'revenue'])!
  assert.equal(report.points.length, 30)
  assert.equal(report.points[0].values.netCash, 20)
  assert.equal(report.points[28].values.netCash, -12)
  assert.deepEqual(report.points[29].values, { netCash: 0, revenue: 0 })
  assert.equal(report.points.reduce((sum, point) => sum + point.values.netCash, 0), 8)
})
test('weekly view only sums the selected calendar range, retaining partial first/last weeks', () => {
  const report = buildFinanceTimeline({ startDate: '2026-09-03', endDate: '2026-10-21' }, [
    { date: '2026-09-03', values: { revenue: 5 } }, { date: '2026-09-06', values: { revenue: 7 } },
    { date: '2026-10-21', values: { revenue: -3 } },
  ], ['revenue'])!
  assert.equal(report.granularity, 'week')
  assert.equal(report.points[0].label, '03/09–06/09')
  assert.equal(report.points.at(-1)?.label, '19/10–21/10')
  assert.equal(report.points[0].values.revenue, 12)
  assert.equal(report.points.reduce((sum, point) => sum + point.values.revenue, 0), 9)
})
test('invalid, duplicated and out of scope data do not become fabricated zeros', () => {
  const range = { startDate: '2026-10-01', endDate: '2026-10-07' }
  for (const rows of [
    [{ date: '2026-09-30', values: { netCash: 5 } }],
    [{ date: '2026-10-01', values: { netCash: Number.NaN } }],
    [{ date: '2026-10-01', values: {} }],
    [{ date: '2026-10-01', values: { netCash: 5 } }, { date: '2026-10-01', values: { netCash: 5 } }],
  ]) assert.equal(buildFinanceTimeline(range, rows, ['netCash']), null)
  assert.equal(buildFinanceTimeline({ startDate: '2026-02-30', endDate: '2026-03-05' }, [], ['netCash']), null)
})
test('signed chart geometry locates negative values below zero and zero has zero height', () => {
  const series: FinanceChartSeries[] = [{ id: 'value', label: 'Cash', color: '#555', kind: 'bar' }]
  const geometry = financeChartGeometry([
    { key: 'one', label: 'one', values: { value: 100 } },
    { key: 'two', label: 'two', values: { value: -50 } },
    { key: 'zero', label: 'zero', values: { value: 0 } },
  ], series)!
  assert.ok(geometry.y(-50) > geometry.zero)
  assert.ok(geometry.y(100) < geometry.zero)
  assert.equal(Math.abs(geometry.y(0) - geometry.zero), 0)
  assert.equal(financeChartGeometry([{ key: 'bad', label: 'bad', values: {} }], series), null)
})

test('daily rows must reconcile with authoritative period totals before a trend is shown', () => {
  const points = [{ key: 'one', label: 'one', values: { revenue: 100, cash: -30 } }, { key: 'two', label: 'two', values: { revenue: -20, cash: 40 } }]
  assert.equal(financeTimelineReconciles(points, { revenue: 80, cash: 10 }), true)
  assert.equal(financeTimelineReconciles(points, { revenue: 100, cash: 10 }), false)
  assert.equal(financeTimelineReconciles([], { revenue: 80 }), false)
  assert.equal(financeTimelineReconciles([], { revenue: 0 }), true)
  assert.equal(financeTimelineReconciles(points, { missing: 0 }), false)
})
