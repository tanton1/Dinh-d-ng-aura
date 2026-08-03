import type { ReactNode } from 'react'
import { ArrowRight, Check, ChevronRight } from 'lucide-react'

export function ProgressRing({ value, size = 56, stroke = 6, label }: { value: number; size?: number; stroke?: number; label?: string }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference

  return (
    <div className="progress-ring" style={{ width: size, height: size }} aria-label={`${value}% hoàn thành`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="progress-ring__track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} />
        <circle
          className="progress-ring__value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span>{label ?? `${value}%`}</span>
    </div>
  )
}

export function StatCard({ icon, value, label, detail, tone = 'purple' }: { icon: ReactNode; value: string; label: string; detail?: string; tone?: string }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        {detail && <small>{detail}</small>}
      </div>
    </article>
  )
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-heading__action">{action}</div>}
    </header>
  )
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action}<ArrowRight size={16} />
        </button>
      )}
    </div>
  )
}

export function ProgressBar({ value, tone = 'purple' }: { value: number; tone?: string }) {
  return (
    <div className="progress-bar" aria-label={`${value}%`}>
      <span className={tone} style={{ width: `${value}%` }} />
    </div>
  )
}

export function Toggle({ checked = false }: { checked?: boolean }) {
  return <span className={`toggle ${checked ? 'checked' : ''}`}><span /></span>
}

export function SettingRow({ icon, title, description, end }: { icon: ReactNode; title: string; description?: string; end?: ReactNode }) {
  return (
    <button className="setting-row">
      <span className="setting-row__icon">{icon}</span>
      <span className="setting-row__copy">
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
      {end ?? <ChevronRight size={18} />}
    </button>
  )
}

export function CheckBadge({ checked = true }: { checked?: boolean }) {
  return <span className={`check-badge ${checked ? 'checked' : ''}`}>{checked && <Check size={13} strokeWidth={3} />}</span>
}
