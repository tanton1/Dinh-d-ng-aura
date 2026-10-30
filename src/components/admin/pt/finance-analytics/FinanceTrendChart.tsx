import { useId, useState } from 'react'
import { financeChartGeometry, financeMoney, type FinanceChartPoint, type FinanceChartSeries } from './financeAnalytics'
import FinanceChartGraphic from './FinanceChartGraphic'
export { revenueComparisonSeries } from './FinanceChartGraphic'
import './finance-analytics.css'

interface Props {
  points: FinanceChartPoint[]
  series: FinanceChartSeries[]
  label: string
  emptyMessage?: string
  inspectable?: boolean
}

/** Shared signed comparison chart for Operations and Finance. Data ownership,
 * time scope and completeness are intentionally left with each report. */
export default function FinanceTrendChart({ points, series, label, emptyMessage = 'Chưa có số liệu trong kỳ đang chọn.', inspectable = true }: Props) {
  const id = useId()
  const [selectedKey, setSelectedKey] = useState('')
  const geometry = financeChartGeometry(points, series)
  if (!points.length || !series.length || !geometry) return <p className="finance-chart__empty">{emptyMessage}</p>
  const selected = points.find(point => point.key === selectedKey) || points[points.length - 1]
  return <div className="finance-chart" data-testid="finance-trend-chart">
    <FinanceChartGraphic points={points} series={series} label={label} selectedKey={selected.key} onInspect={inspectable ? setSelectedKey : undefined} />
    {inspectable && <><div className="finance-chart__inspection">
      <label htmlFor={`${id}-point`}>Xem số liệu<select id={`${id}-point`} value={selected.key} onChange={event => setSelectedKey(event.target.value)}>{points.map(point => <option value={point.key} key={point.key}>{point.label}</option>)}</select></label>
      <dl>{series.map(item => <div key={item.id}><dt>{item.label}</dt><dd style={{ color: item.color }}>{financeMoney(selected.values[item.id])}</dd></div>)}</dl>
    </div>
    <details className="finance-chart__table"><summary>Xem bảng số liệu</summary><div><table><caption>{label}</caption><thead><tr><th scope="col">Ngày</th>{series.map(item => <th key={item.id} scope="col">{item.label}</th>)}</tr></thead><tbody>{points.map(point => <tr key={point.key}><th scope="row">{point.label}</th>{series.map(item => <td key={item.id}>{financeMoney(point.values[item.id])}</td>)}</tr>)}</tbody></table></div></details></>}
  </div>
}
