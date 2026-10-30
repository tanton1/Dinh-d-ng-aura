export interface FinanceChartPoint {
  key: string
  label: string
  values: Record<string, number>
}

export interface FinanceChartSeries {
  id: string
  label: string
  color: string
  kind: 'line' | 'bar'
}

export function financeMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

export function financeCompactMoney(value: number) {
  const absolute = Math.abs(value)
  const divisor = absolute >= 1_000_000_000 ? 1_000_000_000 : absolute >= 1_000_000 ? 1_000_000 : absolute >= 1_000 ? 1_000 : 1
  const unit = divisor === 1_000_000_000 ? ' tỷ' : divisor === 1_000_000 ? ' tr' : divisor === 1_000 ? ' nghìn' : ''
  return `${(value / divisor).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}${unit}`
}

export function financeDateLabel(key: string) {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`
}

/** Do not turn an omitted or incomplete daily series into a zero trend when
 * the authoritative period total says otherwise. Allow arithmetic noise only. */
export function financeTimelineReconciles(points: FinanceChartPoint[], totals: Record<string, number>) {
  return Object.entries(totals).every(([metric, expected]) => {
    if (!Number.isFinite(expected) || points.some(point => !Number.isFinite(point.values[metric]))) return false
    const total = points.reduce((sum, point) => sum + point.values[metric], 0)
    return Math.abs(total - expected) <= Math.max(1e-7, Math.abs(expected) * Number.EPSILON * 16)
  })
}

/** A sparse, complete daily ledger may fill missing days with zero. Partial
 * responses must be rejected by the caller before reaching this function. */
export function buildFinanceTimeline(
  range: { startDate: string; endDate: string },
  daily: Array<{ date: string; values: Record<string, number> }>,
  metrics: string[],
): { granularity: 'day' | 'week'; points: FinanceChartPoint[] } | null {
  const start = Date.parse(`${range.startDate}T00:00:00Z`)
  const end = Date.parse(`${range.endDate}T00:00:00Z`)
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if (!validDate(range.startDate) || !validDate(range.endDate) || start > end || (end - start) / 86400000 >= 366 || !metrics.length) return null
  const valuesByDate = new Map<string, Record<string, number>>()
  for (const row of daily) {
    if (!validDate(row.date) || row.date < range.startDate || row.date > range.endDate || valuesByDate.has(row.date)
      || metrics.some(metric => !Number.isFinite(row.values[metric]))) return null
    valuesByDate.set(row.date, row.values)
  }
  const granularity = (end - start) / 86400000 >= 45 ? 'week' : 'day'
  const buckets = new Map<string, FinanceChartPoint & { first: string; last: string }>()
  for (let instant = start; instant <= end; instant += 86400000) {
    const date = new Date(instant), key = date.toISOString().slice(0, 10)
    const weekStart = new Date(instant - ((date.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10)
    const bucketKey = granularity === 'week' ? weekStart : key
    const bucket = buckets.get(bucketKey) || { key: bucketKey, label: '', first: key, last: key, values: Object.fromEntries(metrics.map(metric => [metric, 0])) }
    bucket.last = key
    for (const metric of metrics) bucket.values[metric] += valuesByDate.get(key)?.[metric] || 0
    bucket.label = bucket.first === bucket.last ? financeDateLabel(bucket.first) : `${financeDateLabel(bucket.first)}–${financeDateLabel(bucket.last)}`
    buckets.set(bucketKey, bucket)
  }
  return { granularity, points: [...buckets.values()].map(({ key, label, values }) => ({ key, label, values })) }
}

export function financeChartGeometry(points: FinanceChartPoint[], series: FinanceChartSeries[]) {
  const width = 720, height = 248, left = 67, right = 16, top = 16, bottom = 36
  const values = points.flatMap(point => series.map(item => point.values[item.id]))
  if (values.some(value => !Number.isFinite(value))) return null
  const minimum = Math.min(0, ...values), maximum = Math.max(1, ...values)
  const span = maximum - minimum
  const x = (index: number) => points.length === 1 ? (left + width - right) / 2 : left + index / Math.max(1, points.length - 1) * (width - left - right)
  const y = (value: number) => top + (maximum - value) / span * (height - top - bottom)
  return { width, height, left, right, top, bottom, minimum, maximum, x, y, zero: y(0) }
}
