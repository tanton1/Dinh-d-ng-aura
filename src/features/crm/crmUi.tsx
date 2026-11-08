import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { PLATFORM_LABELS, STAGE_LABELS, STAGE_TONES, initials } from './crmFormat'
import type { CrmPlatform, CrmStage } from './crmTypes'

export function StageChip({ stage }: { stage: CrmStage }) {
  return <span className={`crm-chip crm-chip--${STAGE_TONES[stage]}`}>{STAGE_LABELS[stage]}</span>
}

export function PlatformBadge({ platform }: { platform: CrmPlatform | '' }) {
  if (!platform) return null
  return <span className={`crm-platform crm-platform--${platform}`}>{PLATFORM_LABELS[platform]}</span>
}

export function Avatar({ name, tone = 'pink' }: { name: string; tone?: 'pink' | 'neutral' }) {
  return <span className={`crm-avatar crm-avatar--${tone}`} aria-hidden="true">{initials(name)}</span>
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null
  return <div className="crm-banner crm-banner--error" role="alert">
    <AlertTriangle size={16} aria-hidden="true" />
    <span>{message}</span>
    {onRetry && <button type="button" onClick={onRetry}>Thử lại</button>}
  </div>
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'success' }) {
  return <div className={`crm-banner crm-banner--${tone}`} role="status">{children}</div>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="crm-empty"><strong>{title}</strong>{children && <p>{children}</p>}</div>
}

export function Loading({ label = 'Đang tải…' }: { label?: string }) {
  return <div className="crm-loading" role="status"><LoaderCircle className="crm-spin" size={18} aria-hidden="true" /> {label}</div>
}

export function Spinner() {
  return <LoaderCircle className="crm-spin" size={15} aria-hidden="true" />
}
