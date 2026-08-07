import React, { useState } from 'react'
import { Info, BarChart } from 'lucide-react'

type RangeType = '7d' | '30d' | '90d'
type MetricType = 'calories' | 'protein' | 'water' | 'fiber' | 'sodium'

export const NutritionChartsCard = React.memo(function NutritionChartsCard() {
  const [range, setRange] = useState<RangeType>('7d')
  const [metric, setMetric] = useState<MetricType>('calories')

  const ranges: Array<{ id: RangeType; label: string }> = [
    { id: '7d', label: '7 ngày' },
    { id: '30d', label: '30 ngày' },
    { id: '90d', label: '90 ngày' },
  ]

  const metrics: Array<{ id: MetricType; label: string, color: string }> = [
    { id: 'calories', label: 'Calo', color: '#f59e0b' },
    { id: 'protein', label: 'Protein', color: '#ec4899' },
    { id: 'water', label: 'Nước', color: '#0ea5e9' },
    { id: 'fiber', label: 'Xơ', color: '#10b981' },
    { id: 'sodium', label: 'Natri', color: '#6366f1' },
  ]

  const activeColor = metrics.find(m => m.id === metric)?.color || '#ec4899'

  // Dummy data generation
  const data = Array.from({ length: range === '7d' ? 7 : range === '30d' ? 30 : 90 }).map((_, i) => {
    return {
      label: `Ngày ${i + 1}`,
      val: metric === 'calories' ? 1800 + Math.random() * 600 :
           metric === 'protein' ? 80 + Math.random() * 50 :
           metric === 'water' ? 1500 + Math.random() * 1000 :
           metric === 'fiber' ? 15 + Math.random() * 15 :
           1500 + Math.random() * 1000
    }
  })

  const maxVal = Math.max(...data.map(d => d.val))
  
  return (
    <div className="pg-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <BarChart size={18} style={{ color: activeColor }} />
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Xu hướng dinh dưỡng</h2>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {metrics.map(m => (
          <button
            key={m.id}
            onClick={() => setMetric(m.id)}
            style={{
              padding: '6px 12px',
              borderRadius: 20,
              background: metric === m.id ? m.color : '#f1f5f9',
              color: metric === m.id ? '#fff' : '#64748b',
              border: 'none',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ height: 160, display: 'flex', alignItems: 'flex-end', gap: range === '90d' ? 2 : range === '30d' ? 4 : 12, marginTop: 8 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', position: 'relative' }}>
            <div
              style={{
                width: '100%',
                height: `${(d.val / maxVal) * 100}%`,
                background: activeColor,
                opacity: 0.8,
                borderRadius: '4px 4px 0 0',
                transition: 'height 0.3s ease'
              }}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', background: '#f8fafc', padding: '4px', borderRadius: 999, width: 'fit-content', margin: '0 auto' }}>
        {ranges.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            style={{
              background: range === r.id ? '#ffffff' : 'transparent',
              color: range === r.id ? '#0f172a' : '#64748b',
              border: 'none',
              borderRadius: 999,
              padding: '6px 16px',
              fontSize: 12,
              fontWeight: range === r.id ? 800 : 600,
              boxShadow: range === r.id ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
              cursor: 'pointer',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  )
})
