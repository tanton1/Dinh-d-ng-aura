import { trainerDailyLoadTarget } from '../../config/scheduleLoadPolicy'
import type { PtScheduleV2Student, PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'

export interface OpportunityStudentRow { student: PtScheduleV2Student; missing: number }
export interface ScheduleOpportunity {
  slotId: string; date: string; hour: number
  trainerId: string; trainerName: string
  occupancy: number; capacity: number; dailyLoad: number; dailyTarget: number
  priorityTier: 1 | 2 | 3
  isPrimaryTrainer: boolean; isAssignedTrainer: boolean; matchesStudentAvailability: boolean
  primaryMatchCount: number; secondaryMatchCount: number; assignedMatchCount: number
}
export interface ScheduleOpportunityInput {
  workspace: PtScheduleWorkspaceV2Result
  studentRows: OpportunityStudentRow[]
  studentId: string
  dates: Record<string, { full: string }>
  days: string[]
  hours: number[]
}
const confirmed = new Set(['submitted', 'locked', 'inherited', 'recurring'])

/** Display suggestions only. The existing callable still validates every mutation. */
export function calculateScheduleOpportunities({ workspace, studentRows, studentId, dates, days, hours }: ScheduleOpportunityInput): ScheduleOpportunity[] {
  const selected = studentId ? studentRows.find((row) => row.student.id === studentId) : null
  // A stale selection from a different branch must not open the unfiltered pool.
  if (studentId && !selected) return []
  const rows = selected ? [selected] : studentRows.filter((row) => row.missing > 0
    && row.student.eligibleForWeek === true && confirmed.has(row.student.availabilityStatus))
  const contractsByStudent = new Map<string, typeof workspace.contracts>()
  for (const contract of workspace.contracts) {
    const list = contractsByStudent.get(contract.studentId) || []
    list.push(contract)
    contractsByStudent.set(contract.studentId, list)
  }
  const assignments = new Map<string, { primary: string | null; assigned: Set<string> }>()
  const rowsBySlot = new Map<string, OpportunityStudentRow[]>()
  for (const row of rows) {
    const student = row.student
    const eligible = new Set(student.eligibleContractIds || [])
    const contracts = (contractsByStudent.get(student.id) || []).sort((a, b) => String(b.endDate || '').localeCompare(String(a.endDate || '')))
    const contract = contracts.find((item) => eligible.has(item.id) && (item.trainerId || item.trainerIds?.length))
      || contracts.find((item) => item.trainerId || item.trainerIds?.length)
    assignments.set(student.id, {
      primary: contract?.trainerId || contract?.trainerIds?.[0] || null,
      assigned: new Set([contract?.trainerId, ...(contract?.trainerIds || [])].filter((id): id is string => Boolean(id))),
    })
    for (const slotId of new Set(student.availableSlots)) {
      const list = rowsBySlot.get(slotId) || []
      list.push(row)
      rowsBySlot.set(slotId, list)
    }
  }
  // One pass through the schedule, not one full scan for every PT × hour.
  const occupancy = new Map<string, Set<string>>()
  const off = new Set<string>()
  const dailySlots = new Map<string, Set<string>>()
  for (const [slotId, entries] of Object.entries(workspace.schedule)) {
    for (const entry of entries) {
      const key = `${entry.trainerId}|${slotId}`
      if (entry.type === 'off') { off.add(key); continue }
      const learners = occupancy.get(key) || new Set<string>()
      learners.add(entry.studentId)
      occupancy.set(key, learners)
      const dayKey = `${entry.trainerId}|${slotId.split('-')[0]}`
      const slots = dailySlots.get(dayKey) || new Set<string>()
      slots.add(slotId)
      dailySlots.set(dayKey, slots)
    }
  }
  const trainers = workspace.trainers.filter((trainer) => !trainer.branchId || trainer.branchId === workspace.branch.id)
    .map((trainer) => ({ trainer, available: new Set(trainer.availableSlots || []), dailyTarget: trainerDailyLoadTarget(trainer, workspace.scheduleConfig.scheduleLoadPolicy) }))
  const holidays = new Set((workspace.scheduleConfig.holidays || []).map((value) => String(value).slice(0, 10)))
  const result: ScheduleOpportunity[] = []
  for (const day of days) {
    const date = dates[day]?.full || ''
    if (!date || holidays.has(date)) continue
    for (const hour of hours) {
      const slotId = `${day}-${hour}`
      // Preserve the selected-learner swap view, including fulfilled targets.
      // In the all-learner pool, only count missing sessions on valid dates.
      const matching = (rowsBySlot.get(slotId) || []).filter((row) => selected
        || !row.student.validScheduleDates.length || row.student.validScheduleDates.includes(date))
      if (selected && !matching.length) continue
      const primaryCounts = new Map<string, number>()
      const assignedCounts = new Map<string, number>()
      for (const row of matching) {
        const assignment = assignments.get(row.student.id)!
        if (assignment.primary) primaryCounts.set(assignment.primary, (primaryCounts.get(assignment.primary) || 0) + 1)
        for (const id of assignment.assigned) assignedCounts.set(id, (assignedCounts.get(id) || 0) + 1)
      }
      for (const { trainer, available, dailyTarget } of trainers) {
        const key = `${trainer.id}|${slotId}`
        if (off.has(key)) continue
        const capacity = Math.max(1, Number(trainer.slotCapacity || 2))
        const count = occupancy.get(key)?.size || 0
        if (count >= capacity) continue
        if (!(trainer.availabilityMode === 'unrestricted' || trainer.availabilityMode === 'configured' && available.has(slotId))) continue
        const dailyLoad = dailySlots.get(`${trainer.id}|${day}`)?.size || 0
        const primaryMatchCount = primaryCounts.get(trainer.id) || 0
        const assignedMatchCount = assignedCounts.get(trainer.id) || 0
        const priorityTier = count === 1 && capacity === 2 ? 1
          : count === 0 && trainer.employmentType === 'full_time' && dailyLoad < dailyTarget ? 2 : 3
        result.push({ slotId, date, hour, trainerId: trainer.id, trainerName: trainer.name, occupancy: count, capacity, dailyLoad, dailyTarget, priorityTier,
          primaryMatchCount, assignedMatchCount, secondaryMatchCount: Math.max(0, assignedMatchCount - primaryMatchCount),
          isPrimaryTrainer: primaryMatchCount > 0, isAssignedTrainer: assignedMatchCount > 0, matchesStudentAvailability: matching.length > 0 })
      }
    }
  }
  return result.sort((a, b) => a.priorityTier - b.priorityTier
    || Number(b.isAssignedTrainer) - Number(a.isAssignedTrainer)
    || b.assignedMatchCount - a.assignedMatchCount || b.primaryMatchCount - a.primaryMatchCount
    || Number(b.matchesStudentAvailability) - Number(a.matchesStudentAvailability)
    || Number(a.dailyLoad >= a.dailyTarget) - Number(b.dailyLoad >= b.dailyTarget)
    || a.dailyLoad - b.dailyLoad || a.date.localeCompare(b.date) || a.hour - b.hour || a.trainerName.localeCompare(b.trainerName, 'vi'))
}

export function groupScheduleOpportunities(items: ScheduleOpportunity[]) {
  const bySlot = new Map<string, ScheduleOpportunity[]>()
  for (const item of items) {
    const rows = bySlot.get(item.slotId) || []
    rows.push(item)
    bySlot.set(item.slotId, rows)
  }
  return bySlot
}
