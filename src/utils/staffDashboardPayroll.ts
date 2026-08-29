import type { StaffTeachingSlot, StaffWorkday } from '../services/staffPayrollService'

export interface StaffDashboardPayrollSnapshot {
  periodId: string
  amounts: {
    baseSalaryAmount: number
    teachingPayAmount: number
  }
  workdays: {
    days: StaffWorkday[]
  }
  teachingSlots: StaffTeachingSlot[]
  run: {
    official: boolean
  }
}

export interface StaffDashboardPayrollBucket {
  id: string
  label: string
  baseSalaryAmount: number
  teachingPayAmount: number
  teachingSlotCount: number
}

export interface StaffDashboardPayrollChart {
  periodId: string
  official: boolean
  baseSalaryAmount: number
  teachingPayAmount: number
  maxBucketAmount: number
  buckets: StaffDashboardPayrollBucket[]
}

const excludedSalaryStatuses = new Set<StaffWorkday['status']>([
  'unpaid_leave',
  'unexcused_absence',
  'sick_leave',
  'maternity_leave',
])

function safeMoney(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0
}

function periodSize(periodId: string) {
  const matched = /^(\d{4})-(\d{2})$/.exec(periodId)
  if (!matched) return 0
  const year = Number(matched[1])
  const month = Number(matched[2])
  if (!Number.isInteger(year) || month < 1 || month > 12) return 0
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function bucketIndex(periodId: string, date: string, bucketCount: number) {
  if (!date.startsWith(`${periodId}-`)) return -1
  const day = Number(date.slice(8, 10))
  if (!Number.isInteger(day) || day < 1) return -1
  const index = Math.floor((day - 1) / 7)
  return index >= 0 && index < bucketCount ? index : -1
}

function allocateCanonicalAmount(totalValue: unknown, weights: number[]) {
  const total = safeMoney(totalValue)
  const allocations = weights.map(() => 0)
  const positiveIndexes = weights.flatMap((weight, index) => weight > 0 ? [index] : [])
  const weightTotal = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0)
  if (!total || !allocations.length) return allocations
  if (!weightTotal || !positiveIndexes.length) {
    allocations[allocations.length - 1] = total
    return allocations
  }
  let allocated = 0
  positiveIndexes.forEach((index, order) => {
    const amount = order === positiveIndexes.length - 1
      ? total - allocated
      : Math.round(total * Math.max(0, weights[index]) / weightTotal)
    allocations[index] = Math.max(0, amount)
    allocated += allocations[index]
  })
  return allocations
}

export function buildStaffDashboardPayrollChart(snapshot: StaffDashboardPayrollSnapshot): StaffDashboardPayrollChart {
  const daysInMonth = periodSize(snapshot.periodId)
  const bucketCount = daysInMonth ? Math.ceil(daysInMonth / 7) : 0
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const from = index * 7 + 1
    const to = Math.min(daysInMonth, from + 6)
    return {
      id: `${snapshot.periodId}-${String(from).padStart(2, '0')}`,
      label: `${String(from).padStart(2, '0')}–${String(to).padStart(2, '0')}`,
      baseSalaryAmount: 0,
      teachingPayAmount: 0,
      teachingSlotCount: 0,
    }
  })

  const salaryDayWeights = buckets.map(() => 0)
  snapshot.workdays.days.forEach((day) => {
    const index = bucketIndex(snapshot.periodId, day.date, buckets.length)
    if (index >= 0 && day.eligible && !excludedSalaryStatuses.has(day.status)) salaryDayWeights[index] += 1
  })

  const teachingRateWeights = buckets.map(() => 0)
  const teachingCountWeights = buckets.map(() => 0)
  snapshot.teachingSlots.forEach((slot) => {
    const index = bucketIndex(snapshot.periodId, slot.date, buckets.length)
    if (index < 0) return
    teachingRateWeights[index] += safeMoney(slot.rate)
    teachingCountWeights[index] += 1
  })

  const baseSalaryAmount = safeMoney(snapshot.amounts.baseSalaryAmount)
  const teachingPayAmount = safeMoney(snapshot.amounts.teachingPayAmount)
  const baseAllocations = allocateCanonicalAmount(baseSalaryAmount, salaryDayWeights)
  const teachingAllocations = allocateCanonicalAmount(
    teachingPayAmount,
    teachingRateWeights.some((value) => value > 0) ? teachingRateWeights : teachingCountWeights,
  )
  buckets.forEach((bucket, index) => {
    bucket.baseSalaryAmount = baseAllocations[index] || 0
    bucket.teachingPayAmount = teachingAllocations[index] || 0
    bucket.teachingSlotCount = teachingCountWeights[index] || 0
  })

  return {
    periodId: snapshot.periodId,
    official: snapshot.run.official,
    baseSalaryAmount,
    teachingPayAmount,
    maxBucketAmount: Math.max(1, ...buckets.flatMap((bucket) => [bucket.baseSalaryAmount, bucket.teachingPayAmount])),
    buckets,
  }
}
