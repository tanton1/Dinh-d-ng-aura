import React, { useMemo } from 'react'
import { Activity, BicepsFlexed, ChevronRight, CircleDot, Info, PersonStanding, Ruler } from 'lucide-react'
import type { BodyMeasurements } from '../../types/progressTypes'

interface BodyMetricsCardProps {
  metrics?: BodyMeasurements
  heightCm?: number | null
  isFemale?: boolean
  onOpenDetails: () => void
}

const defaultMetrics: BodyMeasurements = {
  bmi: 0,
  bmiCategory: 'Chưa cập nhật',
  bodyFatPercentage: 0,
  bodyFatStatus: 'Chưa cập nhật',
  muscleMassKg: 0,
  muscleStatus: 'Chưa cập nhật',
  waistCm: 0,
  waistStatus: 'Chưa cập nhật',
  updatedAt: '',
}

function positive(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function formatDate(value: string) {
  if (!value) return ''
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

interface MetricTileProps {
  label: string
  value: string
  status?: string
  tone: 'pink' | 'orange' | 'green' | 'blue' | 'purple'
  icon: React.ReactNode
}

function MetricTile({ label, value, status, tone, icon }: MetricTileProps) {
  return (
    <div className="pg-metric-card">
      <div className={`pg-metric-icon tone-${tone}`} aria-hidden="true">{icon}</div>
      <div className="pg-metric-copy">
        <span className="pg-metric-label">{label}</span>
        <strong className="pg-metric-value">{value}</strong>
        {status && <span className={`pg-metric-status tone-${tone}`}>{status}</span>}
      </div>
    </div>
  )
}

export function BodyMetricsCard({
  metrics = defaultMetrics,
  heightCm,
  isFemale = false,
  onOpenDetails,
}: BodyMetricsCardProps) {
  const derived = useMemo(() => {
    const waist = positive(metrics.waistCm)
    const hips = positive(metrics.hipsCm)
    const height = positive(heightCm)
    return {
      waistToHeight: waist && height ? (waist / height).toFixed(2) : null,
      waistToHip: waist && hips ? (waist / hips).toFixed(2) : null,
    }
  }, [heightCm, metrics.hipsCm, metrics.waistCm])

  const primaryMetrics: MetricTileProps[] = [
    {
      label: 'BMI',
      value: positive(metrics.bmi) ? Number(metrics.bmi).toFixed(1) : '—',
      status: metrics.bmiCategory || 'Chưa cập nhật',
      tone: 'pink',
      icon: <PersonStanding size={20} strokeWidth={2.2} />,
    },
    {
      label: 'Mỡ cơ thể',
      value: positive(metrics.bodyFatPercentage) ? `${Number(metrics.bodyFatPercentage).toFixed(1)}%` : '—',
      status: metrics.bodyFatStatus || 'Chưa cập nhật',
      tone: 'orange',
      icon: <CircleDot size={20} strokeWidth={2.2} />,
    },
    {
      label: 'Khối cơ',
      value: positive(metrics.muscleMassKg) ? `${Number(metrics.muscleMassKg).toFixed(1)} kg` : '—',
      status: metrics.muscleStatus || 'Chưa cập nhật',
      tone: 'green',
      icon: <BicepsFlexed size={20} strokeWidth={2.2} />,
    },
    {
      label: 'Vòng eo',
      value: positive(metrics.waistCm) ? `${Number(metrics.waistCm).toFixed(1)} cm` : '—',
      status: metrics.waistStatus || 'Chưa cập nhật',
      tone: 'purple',
      icon: <Activity size={20} strokeWidth={2.2} />,
    },
  ]

  const shapeMetrics: MetricTileProps[] = [
    ...(positive(metrics.hipsCm) ? [{ label: 'Vòng hông', value: `${Number(metrics.hipsCm).toFixed(1)} cm`, tone: 'pink' as const, icon: <Activity size={19} /> }] : []),
    ...(positive(metrics.thighCm) ? [{ label: 'Vòng đùi', value: `${Number(metrics.thighCm).toFixed(1)} cm`, tone: 'orange' as const, icon: <Ruler size={19} /> }] : []),
    ...(positive(metrics.armCm) ? [{ label: 'Bắp tay', value: `${Number(metrics.armCm).toFixed(1)} cm`, tone: 'blue' as const, icon: <Ruler size={19} /> }] : []),
    ...(positive(metrics.chestCm) ? [{ label: 'Vòng ngực', value: `${Number(metrics.chestCm).toFixed(1)} cm`, tone: 'purple' as const, icon: <Ruler size={19} /> }] : []),
  ]

  const hasPrimaryData = primaryMetrics.some((item) => item.value !== '—')
  const hasDerivedData = Boolean(derived.waistToHeight || derived.waistToHip)
  const updatedText = formatDate(metrics.updatedAt)

  return (
    <section className="pg-card pg-body-metrics-card" aria-labelledby="body-metrics-heading">
      <div className="pg-card-heading">
        <div>
          <span className="pg-section-eyebrow">THEO DÕI CƠ THỂ</span>
          <h2 id="body-metrics-heading">Chỉ số cơ thể</h2>
          <p className="pg-card-description">Theo dõi xu hướng của bạn qua từng lần đo, không phải một con số đơn lẻ.</p>
        </div>
        <button type="button" onClick={onOpenDetails} className="pg-text-action">
          <span>Cập nhật số đo</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="pg-body-metrics-note" role="note">
        <Info size={15} aria-hidden="true" />
        <span>Đo cùng thời điểm và điều kiện để so sánh chính xác hơn. Chỉ số chỉ mang tính tham khảo.</span>
      </div>

      {hasPrimaryData ? (
        <div className="pg-metrics-grid" aria-label="Các chỉ số chính">
          {primaryMetrics.map((metric) => <MetricTile key={metric.label} {...metric} />)}
        </div>
      ) : (
        <div className="pg-metrics-empty">
          <Ruler size={20} aria-hidden="true" />
          <div><strong>Chưa có số đo gần đây</strong><span>Thêm lần đo đầu tiên để Aura theo dõi thay đổi của bạn.</span></div>
        </div>
      )}

      {(isFemale || shapeMetrics.length > 0) && (
        <div className="pg-shape-section">
          <div className="pg-subsection-heading">
            <div><h3>{isFemale ? 'Số đo hình thể' : 'Số đo bổ sung'}</h3><span>{isFemale ? 'Ưu tiên các vùng thường dùng để theo dõi vóc dáng.' : 'Chỉ hiển thị khi bạn đã ghi nhận.'}</span></div>
            {isFemale && <span className="pg-soft-badge">Tùy chọn</span>}
          </div>
          {shapeMetrics.length > 0 ? (
            <div className="pg-shape-grid">{shapeMetrics.map((metric) => <MetricTile key={metric.label} {...metric} />)}</div>
          ) : (
            <div className="pg-inline-empty">Chưa cập nhật hông, đùi hoặc bắp tay. Bạn có thể thêm trong “Cập nhật số đo”.</div>
          )}
        </div>
      )}

      {hasDerivedData && (
        <div className="pg-ratio-grid" aria-label="Tỷ lệ tham khảo">
          {derived.waistToHeight && <div><span>Eo / chiều cao</span><strong>{derived.waistToHeight}</strong><small>theo dõi xu hướng</small></div>}
          {derived.waistToHip && <div><span>Eo / hông</span><strong>{derived.waistToHip}</strong><small>chỉ số tham khảo</small></div>}
        </div>
      )}

      <div className="pg-metrics-footer">
        <span>{updatedText ? `Cập nhật lần cuối ${updatedText}` : 'Chưa có lần đo được lưu'}</span>
        <button type="button" onClick={onOpenDetails} className="pg-inline-button">Mở biểu mẫu đo</button>
      </div>
    </section>
  )
}
