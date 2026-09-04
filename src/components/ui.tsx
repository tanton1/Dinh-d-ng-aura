import { useEffect, useId, useRef, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, Check, ChevronRight, LoaderCircle, X } from 'lucide-react'

type AuraTone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export function Button({ variant = 'primary', tone = 'brand', className = '', children, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; tone?: AuraTone }) {
  return <button type={type} className={`aura-button aura-button--${variant} aura-tone--${tone} ${className}`.trim()} {...props}>{children}</button>
}

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: AuraTone; children: ReactNode; className?: string }) {
  return <span className={`aura-badge aura-tone--${tone} ${className}`.trim()}>{children}</span>
}

export function Tabs<T extends string>({ label, value, items, onChange, className = '' }: { label: string; value: T; items: Array<{ id: T; label: string; icon?: ReactNode; badge?: ReactNode }>; onChange: (value: T) => void; className?: string }) {
  const moveSelection = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !items.length) return
    event.preventDefault()
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
    onChange(items[nextIndex].id)
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
  }
  return <div className={`aura-tabs ${className}`.trim()} role="tablist" aria-label={label}>{items.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1} className={value === item.id ? 'is-active' : ''} onKeyDown={(event) => moveSelection(event, index)} onClick={() => onChange(item.id)}>{item.icon}<span>{item.label}</span>{item.badge}</button>)}</div>
}

function useModalFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const surface = ref.current
    const focusable = () => [...(surface?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
    focusable()[0]?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.body.classList.add('shell-overlay-open')
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('shell-overlay-open')
      returnFocusRef.current?.focus()
    }
  }, [open])
  return ref
}

function ModalSurface({ open, onClose, title, description, children, footer, variant }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; variant: 'sheet' | 'dialog' }) {
  const titleId = useId()
  const descriptionId = useId()
  const ref = useModalFocus(open, onClose)
  if (!open) return null
  return <div className={`aura-modal-layer aura-modal-layer--${variant}`}>
    <button type="button" className="aura-modal-backdrop" aria-label="Đóng" onClick={onClose} />
    <section ref={ref} className={`aura-${variant}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
      <header><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><button type="button" className="aura-modal-close" aria-label="Đóng" onClick={onClose}><X size={20} /></button></header>
      <div className={`aura-${variant}__body`}>{children}</div>
      {footer && <footer className={`aura-${variant}__footer`}>{footer}</footer>}
    </section>
  </div>
}

export function Sheet(props: Omit<Parameters<typeof ModalSurface>[0], 'variant'>) {
  return <ModalSurface {...props} variant="sheet" />
}

export function Dialog(props: Omit<Parameters<typeof ModalSurface>[0], 'variant'>) {
  return <ModalSurface {...props} variant="dialog" />
}

export function LoadingState({ title = 'Đang tải dữ liệu', description = 'Aura đang đồng bộ nội dung mới nhất.' }: { title?: string; description?: string }) {
  return <div className="aura-state aura-state--loading" role="status" aria-live="polite"><LoaderCircle aria-hidden="true" /><strong>{title}</strong><span>{description}</span></div>
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="aura-state aura-state--empty"><strong>{title}</strong>{description && <span>{description}</span>}{action}</div>
}

export function ErrorState({ title = 'Chưa thể tải dữ liệu', description, action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="aura-state aura-state--error" role="alert"><AlertTriangle aria-hidden="true" /><strong>{title}</strong>{description && <span>{description}</span>}{action}</div>
}

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

export function StatCard({ icon, value, label, detail, tone = 'pink' }: { icon: ReactNode; value: string; label: string; detail?: string; tone?: string }) {
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

export function ProgressBar({ value, tone = 'pink' }: { value: number; tone?: string }) {
  const normalizedValue = Math.max(0, Math.min(100, value))
  return (
    <div
      className="progress-bar"
      role="progressbar"
      aria-label="Tiến độ"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalizedValue}
    >
      <span className={tone} style={{ width: `${normalizedValue}%` }} />
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
