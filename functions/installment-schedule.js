'use strict'

// Re-plans a contract's installment schedule when finance records an amount
// that differs from the installment. The paid installment keeps the amount
// actually received; a shortfall moves to the next pending installment (or a
// new one when none follows) and an excess settles later installments first.
// The pending total therefore drops by exactly the amount received, which
// keeps the schedule equal to the contract's outstanding balance.
// Mirrored in src/domain/payments/installmentSchedule.ts for previews.
const MAX_INSTALLMENTS = 24
const CARRY_OVER_DAYS = 30

function money(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function dayKey(value) {
  const text = typeof value === 'string' ? value.slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function addDays(key, days) {
  return new Date(Date.parse(`${key}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

function byDue(left, right) {
  return dayKey(left.date).localeCompare(dayKey(right.date)) || String(left.id).localeCompare(String(right.id))
}

function nextPaymentDate(installments) {
  return installments.filter((item) => item && item.status === 'pending' && dayKey(item.date)).sort(byDue)[0]?.date || null
}

function carryOverId(installments, baseId) {
  const taken = new Set(installments.map((item) => item.id))
  const base = `${String(baseId).slice(0, 80)}-rest`
  let candidate = base
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}-${suffix}`
  return candidate
}

function planInstallmentPayment(installments, installmentId, amount, { paidOn = '' } = {}) {
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
  // Later installments nearest first, then earlier ones nearest first.
  const later = others.filter(({ item }) => byDue(item, target) > 0).sort((left, right) => byDue(left.item, right.item))
  const earlier = others.filter(({ item }) => byDue(item, target) < 0).sort((left, right) => byDue(right.item, left.item))
  const changes = []
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
      const row = { id: carryOverId(rows, installmentId), date: addDays(base, CARRY_OVER_DAYS), amount: shortfall, status: 'pending' }
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

function scheduleSnapshot(installments) {
  return (Array.isArray(installments) ? installments : []).filter(Boolean).map((item) => ({
    id: String(item.id || ''),
    date: String(item.date || ''),
    amount: Number(item.amount) || 0,
    status: String(item.status || 'pending'),
  }))
}

function sameSchedule(left, right) {
  const a = scheduleSnapshot(left)
  const b = scheduleSnapshot(right)
  return a.length === b.length && a.every((item, index) => ['id', 'date', 'amount', 'status'].every((field) => item[field] === b[index][field]))
}

// Reversing a payment that re-planned the schedule restores the schedule it
// replaced, but only while nothing else has changed the schedule since.
function restoredInstallments(current, snapshot) {
  if (!snapshot || !Array.isArray(snapshot.before) || !sameSchedule(current, snapshot.after)) return null
  const installments = scheduleSnapshot(snapshot.before)
  return { installments, nextPaymentDate: nextPaymentDate(installments) }
}

module.exports = { CARRY_OVER_DAYS, MAX_INSTALLMENTS, nextPaymentDate, planInstallmentPayment, restoredInstallments, sameSchedule, scheduleSnapshot }
