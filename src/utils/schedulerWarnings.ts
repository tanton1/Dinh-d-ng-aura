import type {
  Schedule,
  ScheduleConfig,
  Student,
  Trainer,
  Warning,
} from '../types'

function trainerSlotCapacity(trainer: Trainer): number {
  const configured = Number(trainer.slotCapacity)
  return Number.isInteger(configured) && configured >= 1 && configured <= 4 ? configured : 2
}

export function getStudentSessionsPerWeek(
  student: Student,
  _config: ScheduleConfig,
  overriddenSessions?: Record<string, number>,
): number {
  if (overriddenSessions && overriddenSessions[student.id] !== undefined) {
    return overriddenSessions[student.id]
  }
  return Number(student.sessionsPerWeek) || 0
}

function getSuggestions(
  schedule: Schedule,
  trainers: Trainer[],
  scheduledSlots: string[],
  config: ScheduleConfig,
): string[] {
  const scoredSlots: { slot: string; score: number }[] = []

  for (const day of config.workingDays) {
    for (const hour of config.workingHours) {
      const slot = `${day}-${hour}`
      if (scheduledSlots.includes(slot)) continue

      let capacity = 0
      let hasPartiallyFilledTrainer = false
      let currentStudents = 0

      for (const trainer of trainers) {
        const trainerEntries = (schedule[slot] || []).filter((entry) => entry.trainerId === trainer.id)
        const isOff = trainerEntries.some((entry) => entry.type === 'off' || entry.studentId === 'OFF')
        if (isOff) continue

        const slotCapacity = trainerSlotCapacity(trainer)
        capacity += slotCapacity
        currentStudents += trainerEntries.length
        if (trainerEntries.length > 0 && trainerEntries.length < slotCapacity) {
          hasPartiallyFilledTrainer = true
        }
      }

      if (currentStudents < capacity) {
        let score = currentStudents > 0 ? 10 : 1
        if (hasPartiallyFilledTrainer) score += 5
        scoredSlots.push({ slot, score })
      }
    }
  }

  return scoredSlots
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map(({ slot }) => slot)
}

/**
 * Lightweight warning projection used while an administrator edits a draft.
 * Keep it separate from the optimizer so opening the matrix does not download
 * and parse the fallback scheduling engine on the main thread.
 */
export function calculateWarnings(
  students: Student[],
  trainers: Trainer[],
  schedule: Schedule,
  config: ScheduleConfig,
  overriddenSessions?: Record<string, number>,
): Warning[] {
  const warnings: Warning[] = []
  const studentScheduledSlots: Record<string, string[]> = {}

  for (const student of students) studentScheduledSlots[student.id] = []

  for (const day of config.workingDays) {
    for (const hour of config.workingHours) {
      const slotId = `${day}-${hour}`
      for (const entry of schedule[slotId] || []) {
        if (entry.studentId !== 'OFF' && studentScheduledSlots[entry.studentId]) {
          studentScheduledSlots[entry.studentId].push(slotId)
        }
      }
    }
  }

  for (const student of students) {
    const slots = studentScheduledSlots[student.id] || []
    const scheduled = slots.length
    const requested = getStudentSessionsPerWeek(student, config, overriddenSessions)
    const dayCounts: Record<string, number> = {}
    const slotCounts: Record<string, number> = {}

    for (const slot of slots) {
      const day = slot.split('-')[0]
      dayCounts[day] = (dayCounts[day] || 0) + 1
      slotCounts[slot] = (slotCounts[slot] || 0) + 1
    }

    const multipleSessionsDays = Object.keys(dayCounts).filter((day) => dayCounts[day] > 1)
    const overlappingSlots = Object.keys(slotCounts).filter((slot) => slotCounts[slot] > 1)

    if (scheduled < requested) {
      const warning: Warning = {
        studentId: student.id,
        scheduled,
        requested,
        suggestions: getSuggestions(schedule, trainers, slots, config),
      }
      if (multipleSessionsDays.length > 0) warning.multipleSessionsDays = multipleSessionsDays
      if (overlappingSlots.length > 0) warning.overlappingSlots = overlappingSlots
      warnings.push(warning)
      continue
    }

    if (scheduled > requested || multipleSessionsDays.length > 0 || overlappingSlots.length > 0) {
      const warning: Warning = { studentId: student.id, scheduled, requested, suggestions: [] }
      if (multipleSessionsDays.length > 0) warning.multipleSessionsDays = multipleSessionsDays
      if (overlappingSlots.length > 0) warning.overlappingSlots = overlappingSlots
      warnings.push(warning)
    }
  }

  return warnings
}
