import { useId } from 'react'
import { financeChartGeometry, financeCompactMoney, financeMoney, type FinanceChartPoint, type FinanceChartSeries } from './financeAnalytics'
import './finance-chart-graphic.css'

/** Shared drawing only. Operations never imports Finance's inspection UI. */
export default function FinanceChartGraphic({ points, series, label, selectedKey, onInspect }: {
  points: FinanceChartPoint[]; series: FinanceChartSeries[]; label: string
  selectedKey?: string; onInspect?: (key: string) => void
}) {
  const id = useId()
  const geometry = financeChartGeometry(points, series)
  if (!points.length || !series.length || !geometry) return <p className="finance-chart__empty">Chưa có số liệu trong kỳ đang chọn.</p>
  const { width, height, left, right, top, bottom, minimum, maximum, x, y, zero } = geometry
  const selected = points.find(point => point.key === selectedKey) || points[points.length - 1]
  const selectedIndex = points.indexOf(selected)
  const labelStep = Math.max(1, Math.ceil(points.length / 5))
  const bars = series.filter(item => item.kind === 'bar')
  const lines = series.filter(item => item.kind === 'line')
  const barWidth = Math.max(2, Math.min(15, (width - left - right) / points.length * .58 / Math.max(1, bars.length)))
  const path = (metric: string) => points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.values[metric]).toFixed(1)}`).join(' ')
  return <>
    <div className="finance-chart__legend">{series.map(item => <span key={item.id}><i style={{ backgroundColor: item.color }} />{item.label}</span>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title`} onPointerMove={onInspect ? event => {
      const bounds = event.currentTarget.getBoundingClientRect()
      const relativeX = (event.clientX - bounds.left) / bounds.width * width
      const index = Math.min(points.length - 1, Math.max(0, Math.round((relativeX - left) / (width - left - right) * (points.length - 1))))
      onInspect(points[index].key)
    } : undefined}>
      <title id={`${id}-title`}>{label}. Số âm nằm dưới đường 0.{onInspect ? ' Chọn ngày hoặc mở bảng để đọc số tiền.' : ''}</title>
      {[0, .5, 1].map(ratio => <g key={ratio}><line className="finance-chart__grid" x1={left} x2={width - right} y1={top + ratio * (height - top - bottom)} y2={top + ratio * (height - top - bottom)} /><text x="2" y={top + ratio * (height - top - bottom) + 4}>{financeCompactMoney(maximum - ratio * (maximum - minimum))}</text></g>)}
      <line className="finance-chart__zero" data-testid="chart-zero" x1={left} x2={width - right} y1={zero} y2={zero} />
      {bars.map((item, seriesIndex) => points.map((point, index) => <rect key={`${item.id}-${point.key}`} data-series={item.id} data-value={point.values[item.id]}
        x={x(index) + (seriesIndex - bars.length / 2) * barWidth} y={Math.min(y(point.values[item.id]), zero)} width={barWidth - .5}
        height={Math.abs(y(point.values[item.id]) - zero)} fill={item.color} opacity=".65" rx="2"><title>{`${point.label}, ${item.label}: ${financeMoney(point.values[item.id])}`}</title></rect>))}
      {lines.map(item => <path key={item.id} data-series={item.id} d={path(item.id)} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" />)}
      {onInspect && <line className="finance-chart__cursor" x1={x(selectedIndex)} x2={x(selectedIndex)} y1={top} y2={height - bottom} />}
      {(onInspect ? [selected] : points).map(point => lines.map(item => <circle key={`${point.key}-${item.id}`} cx={x(points.indexOf(point))} cy={y(point.values[item.id])} r={onInspect ? 4 : 3} fill={item.color}><title>{`${point.label}, ${item.label}: ${financeMoney(point.values[item.id])}`}</title></circle>))}
      {points.map((point, index) => (index % labelStep === 0 || index === points.length - 1) && <text key={point.key} x={x(index)} y={height - 10} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{point.label}</text>)}
    </svg>
  </>
}

export const revenueComparisonSeries: FinanceChartSeries[] = [
  { id: 'grossCash', label: 'Thực thu gộp', color: '#91a8ba', kind: 'bar' },
  { id: 'contractSales', label: 'Doanh số hợp đồng', color: '#de2874', kind: 'line' },
  { id: 'recognizedRevenue', label: 'Doanh thu thực hiện', color: '#d76b31', kind: 'line' },
  { id: 'netCash', label: 'Thực thu ròng', color: '#765071', kind: 'line' },
]

export function RevenueComparisonChart({ points }: { points: Array<{ key: string; label: string; contractSales: number; recognizedRevenue: number; grossCash: number; netCash: number }> }) {
  return <div className="finance-chart" data-testid="finance-trend-chart"><FinanceChartGraphic points={points.map(({ key, label, ...values }) => ({ key, label, values }))} series={revenueComparisonSeries} label="Biểu đồ doanh số hợp đồng, doanh thu thực hiện và thực thu ròng" /></div>
}
