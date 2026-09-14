// Frozen pre-refactor selector from main 7ba7998 for output/benchmark parity only.
import type { PtScheduleWorkspaceV2Result } from '../../src/services/ptSchedulePublishService'
import type { OpportunityStudentRow } from '../../src/features/schedule/opportunities'
const CONFIRMED_AVAILABILITY_STATUSES = new Set(['submitted', 'locked', 'inherited', 'recurring'])
export function legacyOpportunities(workspace: PtScheduleWorkspaceV2Result, operationalStudentRows: OpportunityStudentRow[], opportunityStudentId: string,
  weekDates: Record<string, { full: string }>, workingDays: string[], workingHours: number[]) {
  const holidayDates = new Set(workspace.scheduleConfig.holidays || [])
    const selectedStudent = workspace.students.find((student) => student.id === opportunityStudentId) || null
    const trainerAssignmentsByStudent = new Map(workspace.students.map((student) => {
      const eligibleContractIds = new Set(student.eligibleContractIds || [])
      const contracts = workspace.contracts
        .filter((contract) => contract.studentId === student.id)
        .sort((left, right) => String(right.endDate || '').localeCompare(String(left.endDate || '')))
      const contract = contracts.find((item) => eligibleContractIds.has(item.id) && (item.trainerId || item.trainerIds?.length))
        || contracts.find((item) => item.trainerId || item.trainerIds?.length)
      const primaryTrainerId = contract?.trainerId || contract?.trainerIds?.[0] || null
      const assignedTrainerIds = new Set([
        contract?.trainerId,
        ...(contract?.trainerIds || []),
      ].filter((value): value is string => Boolean(value)))
      return [student.id, { primaryTrainerId, assignedTrainerIds }] as const
    }))
    const results: Array<{
      slotId: string
      date: string
      hour: number
      trainerId: string
      trainerName: string
      occupancy: number
      capacity: number
      dailyLoad: number
      dailyTarget: number
      priorityTier: 1 | 2 | 3
      isPrimaryTrainer: boolean
      isAssignedTrainer: boolean
      matchesStudentAvailability: boolean
      primaryMatchCount: number
      secondaryMatchCount: number
      assignedMatchCount: number
    }> = []
    for (const day of workingDays) {
      const date = weekDates[day as keyof typeof weekDates]?.full || ''
      if (!date || holidayDates.has(date)) continue
      for (const hour of workingHours) {
        const slotId = `${day}-${hour}`
        for (const trainer of workspace.trainers) {
          if (trainer.branchId && trainer.branchId !== workspace.branch.id) continue
          const slotEntries = (workspace.schedule[slotId] || []).filter((entry) => entry.trainerId === trainer.id)
          if (slotEntries.some((entry) => entry.type === 'off')) continue
          const trainingEntries = slotEntries.filter((entry) => entry.type !== 'off')
          const capacity = Math.max(1, Number(trainer.slotCapacity || 2))
          const occupancy = new Set(trainingEntries.map((entry) => entry.studentId)).size
          if (occupancy >= capacity) continue
          const available = trainer.availabilityMode === 'unrestricted'
            || (trainer.availabilityMode === 'configured' && (trainer.availableSlots || []).includes(slotId))
          if (!available) continue
          const dailySlots = new Set(Object.entries(workspace.schedule)
            .filter(([candidateSlot]) => candidateSlot.split('-')[0] === day)
            .flatMap(([candidateSlot, entries]) => entries.some((entry) => entry.type !== 'off' && entry.trainerId === trainer.id) ? [candidateSlot] : []))
          const dailyLoad = dailySlots.size
          const dailyTarget = Math.max(1, Number(trainer.dailySessionTarget || 8))
          const matchingRows = selectedStudent
            ? operationalStudentRows.filter((row) => row.student.id === selectedStudent.id && selectedStudent.availableSlots.includes(slotId))
            : operationalStudentRows.filter((row) => row.missing > 0
              && row.student.eligibleForWeek === true
              && CONFIRMED_AVAILABILITY_STATUSES.has(row.student.availabilityStatus)
              && row.student.availableSlots.includes(slotId)
              && (!row.student.validScheduleDates.length || row.student.validScheduleDates.includes(date)))
          const primaryMatchCount = matchingRows.filter((row) => trainerAssignmentsByStudent.get(row.student.id)?.primaryTrainerId === trainer.id).length
          const assignedMatchCount = matchingRows.filter((row) => trainerAssignmentsByStudent.get(row.student.id)?.assignedTrainerIds.has(trainer.id)).length
          const secondaryMatchCount = Math.max(0, assignedMatchCount - primaryMatchCount)
          const isPrimaryTrainer = primaryMatchCount > 0
          const isAssignedTrainer = assignedMatchCount > 0
          const matchesStudentAvailability = matchingRows.length > 0
          if (selectedStudent && !matchesStudentAvailability) continue
          const priorityTier: 1 | 2 | 3 = occupancy === 1 && capacity === 2
            ? 1
            : occupancy === 0 && trainer.employmentType === 'full_time' && dailyLoad < dailyTarget
              ? 2
              : 3
          results.push({ slotId, date, hour, trainerId: trainer.id, trainerName: trainer.name, occupancy, capacity, dailyLoad, dailyTarget, priorityTier, isPrimaryTrainer, isAssignedTrainer, matchesStudentAvailability, primaryMatchCount, secondaryMatchCount, assignedMatchCount })
        }
      }
    }
    return results.sort((left, right) => left.priorityTier - right.priorityTier
      || Number(right.isAssignedTrainer) - Number(left.isAssignedTrainer)
      || right.assignedMatchCount - left.assignedMatchCount
      || right.primaryMatchCount - left.primaryMatchCount
      || Number(right.matchesStudentAvailability) - Number(left.matchesStudentAvailability)
      || Number(left.dailyLoad >= left.dailyTarget) - Number(right.dailyLoad >= right.dailyTarget)
      || left.dailyLoad - right.dailyLoad
      || left.date.localeCompare(right.date)
      || left.hour - right.hour
      || left.trainerName.localeCompare(right.trainerName, 'vi'))
}
