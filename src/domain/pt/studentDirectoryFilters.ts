import type { Student, StudentContract } from '../../types'
import type { StudentWeekEligibility } from './studentEligibility'

export type StudentContractFilter = 'active' | 'expiring_week' | 'expiring_month' | 'expired' | 'paused' | 'inactive' | 'cancelled' | 'all'

export interface StudentDirectoryFilters {
  search: string
  branchId: string
  trainerId: string
  nutritionPTId: string
  contractStatus: StudentContractFilter
  dateRange: { start: Date; end: Date } | null
}

interface DirectorySources {
  students: Student[]
  contractsByStudent: ReadonlyMap<string, StudentContract[]>
  eligibilityByStudent: ReadonlyMap<string, StudentWeekEligibility>
}

const DAY_MS = 86_400_000
const usedSessions = (contract: StudentContract) => Math.max(0, Math.floor(Number(contract.usedSessions || 0)))
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function joinDateKey(value?: string) {
  if (!value) return ''
  // A stored calendar date must not shift to the previous day in browsers
  // west of UTC. Timestamp values still follow the date picker's local zone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T12:00:00`)
    return Number.isFinite(date.getTime()) && dateKey(date) === value ? value : ''
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : dateKey(date)
}

/** Filter the complete authorized roster before the UI applies pagination. */
export function filterStudentDirectory(sources: DirectorySources, filters: StudentDirectoryFilters, now = new Date()) {
  const search = filters.search.trim().toLowerCase()
  const hasDateFilter = Boolean(filters.dateRange && filters.dateRange.start.getTime() !== 0)
  const fromDate = hasDateFilter ? dateKey(filters.dateRange!.start) : ''
  const toDate = hasDateFilter ? dateKey(filters.dateRange!.end) : ''

  return sources.students.filter((student) => {
    const contracts = sources.contractsByStudent.get(student.id) || []
    const latestContract = contracts[0]
    const eligibility = sources.eligibilityByStudent.get(student.id)

    if (search && !student.name?.toLowerCase().includes(search) && !student.phone?.includes(search)) return false
    if (filters.branchId !== 'all' && (filters.branchId === 'none' ? Boolean(student.branchId) : student.branchId !== filters.branchId)) return false
    if (hasDateFilter) {
      const joined = joinDateKey(student.joinDate)
      if (!joined || joined < fromDate || joined > toDate) return false
    }

    const eligibleContracts = eligibility?.eligibleContracts || []
    if (filters.trainerId !== 'all') {
      const matches = filters.trainerId === 'none'
        ? eligibleContracts.every((contract) => !contract.trainerId && !contract.trainerIds?.length)
        : eligibleContracts.some((contract) => contract.trainerId === filters.trainerId || contract.trainerIds?.includes(filters.trainerId))
      if (!matches) return false
    }
    if (filters.nutritionPTId !== 'all') {
      const matches = filters.nutritionPTId === 'none'
        ? eligibleContracts.every((contract) => !contract.nutritionPTIds?.length)
        : eligibleContracts.some((contract) => contract.nutritionPTIds?.includes(filters.nutritionPTId))
      if (!matches) return false
    }

    if (filters.contractStatus === 'all') return true
    if (filters.contractStatus === 'inactive') return student.status === 'inactive'
    if (filters.contractStatus === 'active') return eligibility?.eligible === true
    if (filters.contractStatus === 'paused') return latestContract?.status === 'frozen' || Boolean(!eligibility?.eligible && eligibility?.pausedDates.length)
    if (filters.contractStatus === 'cancelled') return latestContract?.status === 'cancelled'
    if (filters.contractStatus === 'expiring_week' || filters.contractStatus === 'expiring_month') {
      const effectiveContract = eligibleContracts[0]
      if (!effectiveContract) return false
      const daysLeft = Math.ceil((new Date(`${effectiveContract.endDate}T23:59:59`).getTime() - now.getTime()) / DAY_MS)
      const sessionsLeft = effectiveContract.totalSessions - usedSessions(effectiveContract)
      return filters.contractStatus === 'expiring_week' ? daysLeft <= 7 || sessionsLeft <= 2 : daysLeft <= 31 || sessionsLeft <= 5
    }
    if (student.status === 'inactive' || !latestContract) return false
    if (latestContract.status === 'expired') return true
    if (latestContract.status !== 'active') return false
    const daysLeft = Math.ceil((new Date(latestContract.endDate).getTime() - now.getTime()) / DAY_MS)
    return daysLeft < 0 || latestContract.totalSessions - usedSessions(latestContract) <= 0
  })
}
