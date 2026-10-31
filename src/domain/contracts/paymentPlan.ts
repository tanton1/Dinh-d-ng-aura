export interface PaymentPlanInstallment {
  id: string
  date: string
  amount: number
  status: 'pending' | 'paid' | 'cancelled'
}

export function paymentDueDate(startDate: string, months: number, endDate?: string) {
  const [year, month, day] = startDate.split('-').map(Number)
  if (!year || !month || !day) return startDate
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate()
  const value = new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))).toISOString().slice(0, 10)
  return endDate && value > endDate ? endDate : value
}

export function dividePaymentPlan(amount: number, count: number, startDate: string, endDate?: string, previous: PaymentPlanInstallment[] = []): PaymentPlanInstallment[] {
  const locked = previous.filter(item => item.status !== 'pending')
  if (!Number.isSafeInteger(amount) || amount <= 0 || locked.length >= 24) return locked
  const size = Math.max(1, Math.min(24 - locked.length, amount, Math.floor(count) || 1))
  const pending = previous.filter(item => item.status === 'pending')
  const base = Math.floor(amount / size)
  return [...locked, ...Array.from({ length: size }, (_, index) => ({
    id: pending[index]?.id || `installment-${crypto.randomUUID()}`,
    date: pending[index]?.date || paymentDueDate(startDate, index + 1, endDate),
    amount: base + (index === 0 ? amount % size : 0),
    status: 'pending' as const,
  }))]
}

export function paymentPlanError(rows: PaymentPlanInstallment[], remaining: number, options: { minDate?: string; maxDate?: string; maxInstallments?: number } = {}) {
  if (!Number.isSafeInteger(remaining) || remaining < 0) return 'Số tiền trả trước vượt giá trị hợp đồng hoặc số tiền không hợp lệ.'
  if (rows.length > (options.maxInstallments || 24)) return `Tối đa ${options.maxInstallments || 24} kỳ thanh toán.`
  if (new Set(rows.map(item => item.id)).size !== rows.length) return 'Mã kỳ thanh toán bị trùng.'
  const pending = rows.filter(item => item.status === 'pending')
  if (pending.some(item => !Number.isSafeInteger(item.amount) || item.amount <= 0)) return 'Số tiền mỗi kỳ chưa thu phải là số nguyên lớn hơn 0.'
  if (pending.some(item => !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || Number.isNaN(Date.parse(`${item.date}T00:00:00Z`)))) return 'Vui lòng nhập ngày đến hạn cho từng kỳ.'
  if (pending.some(item => options.minDate && item.date < options.minDate || options.maxDate && item.date > options.maxDate)) return 'Ngày thanh toán phải nằm trong thời hạn hợp đồng.'
  const total = pending.reduce((sum, item) => sum + item.amount, 0)
  if (total !== remaining) return 'Tổng các kỳ chưa thu phải bằng số tiền còn phải thu.'
  return ''
}
