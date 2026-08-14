import type {
  EatCleanInventoryItem,
  EatCleanInventoryStatus,
  EatCleanMealCategory,
  EatCleanOrderStatus,
  EatCleanPaymentStatus,
} from './types'

export const ORDER_STATUS_LABELS: Record<EatCleanOrderStatus, string> = {
  pending_confirmation: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  preparing: 'Đang chuẩn bị',
  ready: 'Sẵn sàng giao',
  out_for_delivery: 'Đang giao',
  delivered: 'Đã giao',
  cancelled: 'Đã hủy',
}

export const PAYMENT_STATUS_LABELS: Record<EatCleanPaymentStatus, string> = {
  unpaid: 'Chưa thanh toán',
  paid: 'Đã thanh toán',
  refunded: 'Đã hoàn tiền',
}

export const MEAL_CATEGORY_LABELS: Record<EatCleanMealCategory, string> = {
  breakfast: 'Bữa sáng',
  lunch: 'Bữa trưa',
  dinner: 'Bữa tối',
  snack: 'Bữa phụ',
}

export const INVENTORY_STATUS_LABELS: Record<EatCleanInventoryStatus, string> = {
  in_stock: 'Đủ hàng',
  low_stock: 'Sắp hết',
  out_of_stock: 'Hết hàng',
}

export function formatCurrency(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(safeValue)
}

export function formatDateTime(value: unknown) {
  let candidate: unknown = value
  if (value && typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof timestamp.toDate === 'function') candidate = timestamp.toDate()
    else if (typeof timestamp.seconds === 'number') candidate = timestamp.seconds * 1000
    else if (typeof timestamp._seconds === 'number') candidate = timestamp._seconds * 1000
  }
  const date = candidate instanceof Date ? candidate : new Date(String(candidate ?? ''))
  return Number.isNaN(date.getTime()) ? 'Chưa cập nhật' : date.toLocaleString('vi-VN')
}

export function inventoryStatusFor(item: EatCleanInventoryItem): EatCleanInventoryStatus {
  if (!item.active || item.available <= 0) return 'out_of_stock'
  if (item.available <= Math.max(5, Math.ceil(item.capacity * 0.2))) return 'low_stock'
  return 'in_stock'
}

export function readableError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
