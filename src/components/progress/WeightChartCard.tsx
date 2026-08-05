import React, { useState, useMemo } from 'react'
import { Info, Maximize2 } from 'lucide-react'
import type { WeightRecord } from '../../types/progressTypes'

interface WeightChartCardProps {
  records?: WeightRecord[]
  goalWeightKg?: number
}

const defaultRecords: WeightRecord[] = [
  { id: '1', date: '2026-07-29', label: '29/07', weightKg: 65.1, trendKg: 65.4 },
  { id: '2', date: '2026-07-30', label: '30/07', weightKg: 65.7, trendKg: 65.3 },
  { id: '3', date: '2026-07-31', label: '31/07', weightKg: 65.5, trendKg: 65.2 },
  { id: '4', date: '2026-08-01', label: '01/08', weightKg: 64.5, trendKg: 65.1 },
  { id: '5', date: '2026-08-02', label: '02/08', weightKg: 65.2, trendKg: 65.0 },
  { id: '6', date: '2026-08-03', label: '03/08', weightKg: 64.5, trendKg: 64.9 },
  { id: '7', date: '2026-08-04', label: '04/08', weightKg: 65.0, trendKg: 64.9 },
]

export function WeightChartCard({ records = defaultRecords, goalWeightKg = 61.0 }: WeightChartCardProps) {
  const [range, setRange] = useState<'30d' | '90d' | '6m' | '1y'>('30d')
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null)

  const ranges: Array<{ id: '30d' | '90d' | '6m' | '1y'; label: string }> = [
    { id: '30d', label: '30 ngày' },
    { id: '90d', label: '90 ngày' },
    { id: '6m', label: '6 tháng' },
    { id: '1y', label: '1 năm' },
  ]

  const dataList = records.length > 0 ? records : defaultRecords
  const latestWeight = dataList[dataList.length - 1]?.weightKg ?? 65.0

  // Chart coordinate parameters
  const chartWidth = 320
  const chartHeight = 160
  const padLeft = 32
  const padRight = 16
  const padTop = 16
  const padBottom = 28

  // Dynamically calculate min and max weight for chart scaling
  const weightValues = dataList.map((d) => d.weightKg).concat(dataList.map((d) => d.trendKg || d.weightKg))
  weightValues.push(goalWeightKg)
  const minVal = Math.min(...weightValues)
  const maxVal = Math.max(...weightValues)
  const valRange = maxVal - minVal
  
  const minKg = Number((minVal - Math.max(1.0, valRange * 0.15)).toFixed(1))
  const maxKg = Number((maxVal + Math.max(1.0, valRange * 0.15)).toFixed(1))

  const getX = (index: number) => {
    if (dataList.length <= 1) return padLeft
    return padLeft + (index / (dataList.length - 1)) * (chartWidth - padLeft - padRight)
  }

  const getY = (val: number) => {
    const clamped = Math.max(minKg, Math.min(maxKg, val))
    const ratio = maxKg !== minKg ? (clamped - minKg) / (maxKg - minKg) : 0.5
    return chartHeight - padBottom - ratio * (chartHeight - padTop - padBottom)
  }

  // Weight line path
  const weightPoints = dataList.map((d, i) => `${getX(i)},${getY(d.weightKg)}`).join(' L ')
  const weightPath = `M ${weightPoints}`

  // Trend line path
  const trendPoints = dataList.map((d, i) => `${getX(i)},${getY(d.trendKg || d.weightKg)}`).join(' L ')
  const trendPath = `M ${trendPoints}`

  // Area under weight path
  const areaPath = `M ${getX(0)},${chartHeight - padBottom} L ${weightPoints} L ${getX(dataList.length - 1)},${chartHeight - padBottom} Z`

  const activeRecord = activePointIndex !== null ? dataList[activePointIndex] : null

  // Generate dynamic grid line values
  const yLabels = useMemo(() => {
    const labels: number[] = []
    const step = (maxKg - minKg) / 3
    for (let i = 0; i <= 3; i++) {
      labels.push(Number((minKg + step * i).toFixed(1)))
    }
    return labels
  }, [minKg, maxKg])

  return (
    <div className="pg-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Biểu đồ cân nặng</h2>
          <Info size={15} style={{ color: '#cbd5e1' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              padding: '4px 12px',
              borderRadius: 9999,
              background: '#fff0f5',
              color: '#f72567',
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            {latestWeight.toFixed(1)} kg
          </span>
          <button
            type="button"
            aria-label="Phóng to"
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}
          >
            <Maximize2 size={16} />
          </button>
        </div>
      </div>

      {/* SVG Custom Line Chart */}
      <div style={{ width: '100%', position: 'relative' }}>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
          <defs>
            <linearGradient id="weightAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f72567" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#f72567" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Y-Axis Grid lines & labels */}
          {yLabels.map((val: number) => {
            const y = getY(val)
            return (
              <g key={val}>
                <line x1={padLeft} y1={y} x2={chartWidth - padRight} y2={y} stroke="#f1f5f9" strokeDasharray="3 3" strokeWidth="1" />
                <text x={padLeft - 6} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="10" fontWeight="600">
                  {val}
                </text>
              </g>
            )
          })}

          {/* Goal reference line */}
          <line x1={padLeft} y1={getY(goalWeightKg)} x2={chartWidth - padRight} y2={getY(goalWeightKg)} stroke="#fbcfe8" strokeDasharray="4 4" strokeWidth="1.5" />

          {/* Gradient area */}
          <path d={areaPath} fill="url(#weightAreaGrad)" />

          {/* Dotted Trend Line */}
          <path d={trendPath} fill="none" stroke="#fbcfe8" strokeWidth="2" strokeDasharray="4 4" />

          {/* Main Weight Line */}
          <path d={weightPath} fill="none" stroke="#f72567" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

          {/* Data Points & X-Axis Labels */}
          {dataList.map((d, i) => {
            const x = getX(i)
            const y = getY(d.weightKg)
            const isActive = activePointIndex === i
            return (
              <g key={d.id || i} style={{ cursor: 'pointer' }} onClick={() => setActivePointIndex(isActive ? null : i)}>
                {/* X Axis Label */}
                <text x={x} y={chartHeight - 8} textAnchor="middle" fill={isActive ? '#f72567' : '#94a3b8'} fontSize="10" fontWeight={isActive ? '800' : '600'}>
                  {d.label}
                </text>

                {/* Touch / Click target circle */}
                <circle cx={x} cy={y} r="12" fill="transparent" />

                {/* Visible Data Point */}
                <circle
                  cx={x}
                  cy={y}
                  r={isActive ? 6 : 4}
                  fill={isActive ? '#f72567' : '#ffffff'}
                  stroke="#f72567"
                  strokeWidth={isActive ? 3 : 2}
                />
              </g>
            )
          })}
        </svg>

        {/* Active Tooltip overlay */}
        {activeRecord && activePointIndex !== null && (
          <div
            style={{
              position: 'absolute',
              top: getY(activeRecord.weightKg) - 54,
              left: `calc(${(activePointIndex / (dataList.length - 1)) * 80 + 10}%)`,
              transform: 'translateX(-50%)',
              background: '#0f172a',
              color: '#ffffff',
              padding: '6px 10px',
              borderRadius: 10,
              fontSize: 11,
              fontWeight: 700,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              pointerEvents: 'none',
              zIndex: 10,
              whiteSpace: 'nowrap',
            }}
          >
            <div>{activeRecord.label}: <span style={{ color: '#f472b6' }}>{activeRecord.weightKg} kg</span></div>
            {activeRecord.note && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{activeRecord.note}</div>}
          </div>
        )}
      </div>

      {/* Range filter selector */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 4,
          background: '#f8fafc',
          padding: 4,
          borderRadius: 14,
          marginTop: 12,
        }}
      >
        {ranges.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            style={{
              padding: '6px 0',
              borderRadius: 10,
              border: 'none',
              background: range === r.id ? '#ffffff' : 'transparent',
              color: range === r.id ? '#f72567' : '#64748b',
              fontWeight: range === r.id ? 800 : 600,
              fontSize: 12,
              cursor: 'pointer',
              boxShadow: range === r.id ? '0 2px 6px rgba(0,0,0,0.05)' : 'none',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  )
}

