import type { ReactNode } from 'react'
import {
  ChevronRight,
  Minus,
  Plus,
  ShoppingBag,
  Star,
} from 'lucide-react'
import type { EatCleanMeal, EatCleanOrderStatus } from './types'

export function formatEatCleanMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Math.max(0, value))
}

export function formatEatCleanDate(value?: string) {
  if (!value) return 'Chưa cập nhật'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export const EAT_CLEAN_STATUS_LABELS: Record<EatCleanOrderStatus, string> = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  preparing: 'Đang chuẩn bị',
  ready: 'Sẵn sàng giao',
  delivering: 'Đang giao',
  delivered: 'Đã giao',
  cancelled: 'Đã hủy',
}

export function EatCleanStatusBadge({ status }: { status: EatCleanOrderStatus }) {
  return <span className={`eat-clean-status eat-clean-status--${status}`}>{EAT_CLEAN_STATUS_LABELS[status]}</span>
}

export function EatCleanQuantityControl({
  value,
  onChange,
  compact = false,
}: {
  value: number
  onChange: (value: number) => void
  compact?: boolean
}) {
  return (
    <div className={`eat-clean-quantity ${compact ? 'is-compact' : ''}`} aria-label="Số lượng">
      <button type="button" onClick={() => onChange(value - 1)} aria-label="Giảm số lượng"><Minus size={16} /></button>
      <strong aria-live="polite">{value}</strong>
      <button type="button" onClick={() => onChange(value + 1)} aria-label="Tăng số lượng"><Plus size={16} /></button>
    </div>
  )
}

export function EatCleanMealCard({
  meal,
  onOpen,
  onAdd,
  recommended = false,
}: {
  meal: EatCleanMeal
  onOpen: () => void
  onAdd: () => void
  recommended?: boolean
}) {
  return (
    <article className={`eat-clean-meal-card ${!meal.available ? 'is-unavailable' : ''}`}>
      <button type="button" className="eat-clean-meal-card__visual" onClick={onOpen} aria-label={`Xem ${meal.name}`}>
        {meal.imageUrl ? <img src={meal.imageUrl} alt="" loading="lazy" /> : <span aria-hidden="true"><ShoppingBag size={28} /></span>}
        {meal.badge && <em>{meal.badge}</em>}
        {recommended && <i>Phù hợp với bạn</i>}
      </button>
      <div className="eat-clean-meal-card__body">
        <button type="button" className="eat-clean-meal-card__title" onClick={onOpen}>
          <span>
            <strong>{meal.name}</strong>
            <small>{meal.shortDescription}</small>
          </span>
          <ChevronRight size={18} />
        </button>
        <div className="eat-clean-meal-card__meta">
          <span>{meal.nutrition.calories} kcal</span>
          <span>{meal.nutrition.protein}g đạm</span>
          {meal.rating && <span><Star size={13} fill="currentColor" /> {meal.rating}</span>}
        </div>
        <div className="eat-clean-meal-card__footer">
          <span>
            <strong>{formatEatCleanMoney(meal.price)}</strong>
            {meal.compareAtPrice && <del>{formatEatCleanMoney(meal.compareAtPrice)}</del>}
          </span>
          <button type="button" onClick={onAdd} disabled={!meal.available}>
            <Plus size={17} /> {meal.available ? 'Thêm' : 'Tạm hết'}
          </button>
        </div>
      </div>
    </article>
  )
}

export function EatCleanState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <section className="eat-clean-state">
      <div>{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  )
}

export function EatCleanLoading() {
  return (
    <div className="eat-clean-loading" role="status" aria-label="Đang tải thực đơn">
      <div className="eat-clean-skeleton eat-clean-skeleton--hero" />
      <div className="eat-clean-skeleton-row">
        <div className="eat-clean-skeleton" />
        <div className="eat-clean-skeleton" />
        <div className="eat-clean-skeleton" />
      </div>
    </div>
  )
}
