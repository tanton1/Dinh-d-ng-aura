// Client mirror of functions/installment-schedule.js#planInstallmentPayment.
// The server re-plans the real schedule when finance records a payment; this
// copy previews that outcome for the student and for finance, and the parity
// test keeps both implementations identical.

export interface ScheduleRow { id: string; date: string; amount: number; status: 'pending' | 'paid' | 'cancelled' | string; sequence?: number }
export interface ScheduleChange { id: string; date: string; from: number; to: number; created: boolean }
export interface InstallmentPaymentPlan {
  installments: ScheduleRow[]
  nextPaymentDate: string | null
  scheduledAmount: number
  receivedAmount: number
  shortfall: number
  excess: number
  unallocated: number
  changes: ScheduleChange[]
}

export const MAX_INSTALLMENTS = 24
export const CARRY_OVER_DAYS = 30

function money(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function dayKey(value: unknown) {
  const text = typeof value === 'string' ? value.slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function addDays(key: string, days: number) {
  return new Date(Date.parse(`${key}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

function byDue(left: ScheduleRow, right: ScheduleRow) {
  return dayKey(left.date).localeCompare(dayKey(right.date)) || String(left.id).localeCompare(String(right.id))
}

export function nextPaymentDate(installments: ScheduleRow[]) {
  return installments.filter((item) => item && item.status === 'pending' && dayKey(item.date)).sort(byDue)[0]?.date || null
}

function carryOverId(installments: ScheduleRow[], baseId: string) {
  const taken = new Set(installments.map((item) => item.id))
  const base = `${String(baseId).slice(0, 80)}-rest`
  let candidate = base
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}-${suffix}`
  return candidate
}

export function planInstallmentPayment(installments: ScheduleRow[], installmentId: string, amount: number, { paidOn = '' }: { paidOn?: string } = {}): InstallmentPaymentPlan | { error: string } {
  const rows = Array.isArray(installments) ? installments.filter(Boolean) : []
  const index = rows.findIndex((item) => item.id === installmentId)
  if (index < 0) return { error: 'not_found' }
  const target = rows[index]
  if (target.status !== 'pending') return { error: 'not_pending' }
  const received = money(amount)
  if (!received) return { error: 'invalid_amount' }
  const scheduled = money(target.amount)
  const next = rows.map((item) => ({ ...item }))
  next[index] = { ...target, amount: received, status: 'paid' }
  const others = rows
    .map((item, position) => ({ item, position }))
    .filter(({ item, position }) => position !== index && item.status === 'pending' && money(item.amount) > 0)
  const later = others.filter(({ item }) => byDue(item, target) > 0).sort((left, right) => byDue(left.item, right.item))
  const earlier = others.filter(({ item }) => byDue(item, target) < 0).sort((left, right) => byDue(right.item, left.item))
  const changes: ScheduleChange[] = []
  const shortfall = Math.max(0, scheduled - received)
  const excess = Math.max(0, received - scheduled)
  if (shortfall) {
    const carrier = later[0]
    if (carrier) {
      const from = money(carrier.item.amount)
      next[carrier.position] = { ...next[carrier.position], amount: from + shortfall }
      changes.push({ id: carrier.item.id, date: dayKey(carrier.item.date), from, to: from + shortfall, created: false })
    } else {
      if (rows.length >= MAX_INSTALLMENTS) return { error: 'schedule_full' }
      const base = [dayKey(target.date), dayKey(paidOn)].filter(Boolean).sort().at(-1)
      if (!base) return { error: 'invalid_date' }
      const row: ScheduleRow = { id: carryOverId(rows, installmentId), date: addDays(base, CARRY_OVER_DAYS), amount: shortfall, status: 'pending' }
      next.push(row)
      changes.push({ id: row.id, date: row.date, from: 0, to: shortfall, created: true })
    }
  }
  let unallocated = excess
  for (const { item, position } of [...later, ...earlier]) {
    if (!unallocated) break
    const from = money(item.amount)
    const reduce = Math.min(from, unallocated)
    next[position] = { ...next[position], amount: from - reduce }
    changes.push({ id: item.id, date: dayKey(item.date), from, to: from - reduce, created: false })
    unallocated -= reduce
  }
  const settled = new Set(changes.filter((change) => change.to === 0).map((change) => change.id))
  const result = next.filter((item) => !settled.has(item.id))
  return { installments: result, nextPaymentDate: nextPaymentDate(result), scheduledAmount: scheduled, receivedAmount: received, shortfall, excess, unallocated, changes }
}

function formatVnd(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function formatDay(key: string) {
  const [year, month, day] = key.split('-')
  return `${day}/${month}/${year}`
}

function label(rows: ScheduleRow[], change: ScheduleChange) {
  const sequence = rows.find((item) => item.id === change.id)?.sequence
  return `${sequence ? `kỳ ${sequence}` : 'kỳ'} (${formatDay(change.date)})`
}

/**
 * One or two sentences on where a shortfall or an excess goes, for the
 * student sheet and the finance form. Empty when the amount matches.
 */
export function describeInstallmentPlan(rows: ScheduleRow[], installmentId: string, amount: number, paidOn: string) {
  const plan = planInstallmentPayment(rows, installmentId, amount, { paidOn })
  if ('error' in plan) return ''
  const lines: string[] = []
  if (plan.shortfall) {
    const change = plan.changes[0]
    lines.push(change.created
      ? `Phần còn thiếu ${formatVnd(plan.shortfall)} sẽ thành kỳ mới, hạn ${formatDay(change.date)}.`
      : `Phần còn thiếu ${formatVnd(plan.shortfall)} sẽ cộng vào ${label(rows, change)}.`)
  }
  if (plan.excess) {
    const touched = plan.changes.map((change) => `${label(rows, change)}${change.to === 0 ? ', đủ kỳ này' : ''}`)
    if (touched.length) lines.push(`Phần trả thêm ${formatVnd(plan.excess - plan.unallocated)} sẽ trừ vào ${touched.join(' và ')}.`)
    if (plan.unallocated) lines.push(`Còn ${formatVnd(plan.unallocated)} chưa gắn kỳ nào; Aura sẽ cập nhật lịch sau khi ghi nhận.`)
  }
  return lines.join(' ')
}
