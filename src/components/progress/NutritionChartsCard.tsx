import React, { useState, useEffect, useMemo } from 'react'
import { Info, BarChart } from 'lucide-react'
import { subscribeToUserMealLogs, subscribeToUserWaterLogs } from '../../services/firebaseService'

type RangeType = '7d' | '30d' | '90d'
type MetricType = 'calories' | 'protein' | 'carbs' | 'fat' | 'water' | 'fiber'

export const NutritionChartsCard = React.memo(function NutritionChartsCard({ ownerId = 'demo' }: { ownerId?: string }) {
  const [range, setRange] = useState<RangeType>('7d')
  const [metric, setMetric] = useState<MetricType>('calories')
  const [mealLogs, setMealLogs] = useState<any[]>([])
  const [waterLogs, setWaterLogs] = useState<any[]>([])

  useEffect(() => {
    const unsubMeals = subscribeToUserMealLogs(ownerId, (meals) => {
      setMealLogs(meals || [])
    })
    const unsubWater = subscribeToUserWaterLogs(ownerId, (water) => {
      setWaterLogs(water || [])
    })
    return () => {
      unsubMeals()
      unsubWater()
    }
  }, [ownerId])

  const ranges: Array<{ id: RangeType; label: string }> = [
    { id: '7d', label: '7 ngày' },
    { id: '30d', label: '30 ngày' },
    { id: '90d', label: '90 ngày' },
  ]

  const metrics: Array<{ id: MetricType; label: string, color: string }> = [
    { id: 'calories', label: 'Calo', color: '#f59e0b' },
    { id: 'protein', label: 'Protein', color: '#ec4899' },
    { id: 'carbs', label: 'Carb', color: '#f97316' },
    { id: 'fat', label: 'Chất béo', color: '#3b82f6' },
    { id: 'water', label: 'Nước', color: '#0ea5e9' },
    { id: 'fiber', label: 'Xơ', color: '#10b981' },
  ]

  const activeColor = metrics.find(m => m.id === metric)?.color || '#ec4899'

  const data = useMemo(() => {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
    const result = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    // Create a map for fast lookup
    const mealsByDate = new Map<string, number>()
    const waterByDate = new Map<string, number>()
    
    mealLogs.forEach(log => {
      if (!log.date) return
      const current = mealsByDate.get(log.date) || 0
      mealsByDate.set(log.date, current + (Number(log[metric === 'calories' ? 'calories' : metric]) || 0))
    })

    waterLogs.forEach(log => {
      if (!log.date) return
      const current = waterByDate.get(log.date) || 0
      waterByDate.set(log.date, current + (Number(log.amountMl) || 0))
    })

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
      
      let val = 0
      if (metric === 'water') {
        val = waterByDate.get(dateStr) || 0
      } else {
        val = mealsByDate.get(dateStr) || 0
      }

      result.push({
        label: `Ngày ${d.getDate()}/${d.getMonth() + 1}`,
        val
      })
    }
    return result
  }, [range, metric, mealLogs, waterLogs])

  const maxVal = Math.max(...data.map(d => d.val), 1)
  
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

      <div style={{ height: 240, width: '100%', marginTop: 8, display: 'flex' }}>
        {/* Y Axis */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingRight: 8, color: '#94a3b8', fontSize: 10, textAlign: 'right', minWidth: 35, paddingBottom: 20 }}>
          <span>{maxVal >= 1000 ? `${(maxVal/1000).toFixed(1)}k` : Math.round(maxVal)}</span>
          <span>{maxVal * 0.75 >= 1000 ? `${(maxVal * 0.75 / 1000).toFixed(1)}k` : Math.round(maxVal * 0.75)}</span>
          <span>{maxVal * 0.5 >= 1000 ? `${(maxVal * 0.5 / 1000).toFixed(1)}k` : Math.round(maxVal * 0.5)}</span>
          <span>{maxVal * 0.25 >= 1000 ? `${(maxVal * 0.25 / 1000).toFixed(1)}k` : Math.round(maxVal * 0.25)}</span>
          <span>0</span>
        </div>
        
        {/* Chart Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Grid and Bars container */}
          <div style={{ flex: 1, position: 'relative', borderLeft: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'flex-end', gap: range === '90d' ? 2 : range === '30d' ? 4 : 12, paddingLeft: 4 }}>
            {/* Grid lines */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, borderTop: '1px dashed #e2e8f0' }} />
            <div style={{ position: 'absolute', top: '25%', left: 0, right: 0, borderTop: '1px dashed #e2e8f0' }} />
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: '1px dashed #e2e8f0' }} />
            <div style={{ position: 'absolute', top: '75%', left: 0, right: 0, borderTop: '1px dashed #e2e8f0' }} />

            {/* Bars */}
            {data.map((d, i) => (
              <div key={i} title={`${d.label}: ${Math.round(d.val)} ${metrics.find(m => m.id === metric)?.label}`} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', position: 'relative', zIndex: 1 }}>
                <div
                  style={{
                    width: '100%',
                    maxWidth: 40,
                    margin: '0 auto',
                    height: `${(d.val / maxVal) * 100}%`,
                    background: activeColor,
                    opacity: 0.85,
                    borderRadius: '4px 4px 0 0',
                    transition: 'height 0.3s ease, opacity 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '0.85'}
                />
              </div>
            ))}
          </div>

          {/* X Axis labels */}
          <div style={{ display: 'flex', gap: range === '90d' ? 2 : range === '30d' ? 4 : 12, paddingLeft: 4, marginTop: 6, height: 14 }}>
             {data.map((d, i) => {
               const showLabel = range === '7d' || (range === '30d' && i % 4 === 0) || (range === '90d' && i % 14 === 0);
               return (
                 <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                   {showLabel ? d.label.replace('Ngày ', '') : ''}
                 </div>
               )
             })}
          </div>
        </div>
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
