import type { Student, StudentContract } from '../../types'

const DAY_MS = 86_400_000

function dateId(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function normalizedDateId(value: unknown) {
  if (typeof value !== 'string') return ''
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

export function currentPtWeekId(reference = new Date()) {
  const monday = new Date(`${todayInHoChiMinh(reference)}T12:00:00`)
  const weekday = monday.getDay()
  monday.setDate(monday.getDate() - (weekday === 0 ? 6 : weekday - 1))
  monday.setHours(12, 0, 0, 0)
  return dateId(monday)
}

function todayInHoChiMinh(reference = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(reference)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function weekDates(weekId: string) {
  const start = new Date(`${weekId}T12:00:00`)
  if (Number.isNaN(start.getTime())) return []
  return Array.from({ length: 7 }, (_, index) => dateId(new Date(start.getTime() + index * DAY_MS)))
}

function pausedOn(contract: StudentContract, date: string) {
  if (contract.status === 'frozen') return true
  return (contract.pausePeriods || []).some((period) => {
    const start = normalizedDateId(period.startDate)
    const end = normalizedDateId(period.endDate)
    return Boolean(start && end && date >= start && date <= end)
  })
}

export interface StudentWeekEligibility {
  eligible: boolean
  eligibleContracts: StudentContract[]
  validDates: string[]
  pausedDates: string[]
  remainingSessions: number
}

/**
 * Mirrors the branch scheduling workspace rules for the selected week.
 * A profile status alone never makes a learner operationally active.
 */
export function studentEligibilityForWeek(
  student: Pick<Student, 'id' | 'status' | 'branchId'>,
  contracts: StudentContract[],
  weekId = currentPtWeekId(),
  referenceDate = todayInHoChiMinh(),
): StudentWeekEligibility {
  if (['inactive', 'archived', 'deleted'].includes(String(student.status || '').toLowerCase()) || !student.branchId) {
    return { eligible: false, eligibleContracts: [], validDates: [], pausedDates: [], remainingSessions: 0 }
  }

  const dates = weekDates(weekId).filter((date) => date >= referenceDate)
  const eligibleContracts: StudentContract[] = []
  const validDates = new Set<string>()
  const pausedDates = new Set<string>()
  let remainingSessions = 0

  for (const contract of contracts) {
    if (contract.studentId !== student.id || !['active', 'future'].includes(contract.status) || contract.branchId !== student.branchId) continue
    const start = normalizedDateId(contract.startDate)
    const end = normalizedDateId(contract.endDate)
    const remaining = Math.max(0, Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0))
    if (!start || !end || remaining < 1) continue
    let usable = false
    for (const date of dates) {
      if (date < start || date > end) continue
      if (pausedOn(contract, date)) {
        pausedDates.add(date)
        continue
      }
      validDates.add(date)
      usable = true
    }
    if (usable) {
      eligibleContracts.push(contract)
      remainingSessions += remaining
    }
  }

  return {
    eligible: validDates.size > 0,
    eligibleContracts: eligibleContracts.sort((left, right) => left.endDate.localeCompare(right.endDate)),
    validDates: [...validDates].sort(),
    pausedDates: [...pausedDates].sort(),
    remainingSessions,
  }
}
