import type {
  TrainerSessionSummary,
  TrainerStudentContractDetail,
  TrainerStudentDetail,
} from './ptOperationsV2Service'

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
}

function asText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asNonNegativeNumber(value: unknown, fallback = 0) {
  return Math.max(0, asNumber(value, fallback))
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function asDateKey(value: unknown, fallback = '') {
  const text = asText(value)
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : fallback
}

function asOptionalHour(value: unknown) {
  const parsed = asNumber(value, Number.NaN)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : undefined
}

const reconciliationStatuses = new Set<TrainerStudentContractDetail['reconciliationStatus']>([
  'matched',
  'legacy_projection',
  'projection_behind',
  'over_entitlement',
])

function normalizeContract(value: unknown, index: number): TrainerStudentContractDetail {
  const contract = asRecord(value)
  const totalSessions = asNonNegativeNumber(contract.totalSessions)
  const usedSessions = asNonNegativeNumber(contract.usedSessions)
  const rawReconciliation = asText(contract.reconciliationStatus) as TrainerStudentContractDetail['reconciliationStatus']
  const reconciliationStatus = reconciliationStatuses.has(rawReconciliation) ? rawReconciliation : 'legacy_projection'
  return {
    id: asText(contract.id, `contract-${index + 1}`),
    packageName: asText(contract.packageName, 'Gói tập Aura'),
    status: asText(contract.status, 'active'),
    startDate: asDateKey(contract.startDate),
    endDate: asDateKey(contract.endDate),
    totalSessions,
    usedSessions,
    remainingSessions: asNonNegativeNumber(contract.remainingSessions, Math.max(0, totalSessions - usedSessions)),
    chargedSessions: contract.chargedSessions === null || contract.chargedSessions === undefined
      ? null
      : asNonNegativeNumber(contract.chargedSessions),
    historySessions: contract.historySessions === null || contract.historySessions === undefined
      ? null
      : asNonNegativeNumber(contract.historySessions),
    reconciliationStatus,
    schedulableToday: asBoolean(contract.schedulableToday),
    pausedToday: asBoolean(contract.pausedToday),
  }
}

function normalizeSession(value: unknown, index: number, studentId: string): TrainerSessionSummary {
  const session = asRecord(value)
  const date = asDateKey(session.date)
  const hour = asOptionalHour(session.hour)
  return {
    id: asText(session.id, `${studentId || 'student'}-${date || 'session'}-${hour ?? index}`),
    studentId: asText(session.studentId, studentId),
    trainerId: asText(session.trainerId),
    studentName: asText(session.studentName) || undefined,
    studentPhone: asText(session.studentPhone) || undefined,
    studentEmail: asText(session.studentEmail) || undefined,
    studentBranchId: asText(session.studentBranchId) || undefined,
    date,
    hour,
    status: asText(session.status, 'scheduled'),
    scheduleStatus: ['scheduled', 'rescheduled', 'cancelled'].includes(asText(session.scheduleStatus))
      ? asText(session.scheduleStatus) as TrainerSessionSummary['scheduleStatus']
      : undefined,
    billingStatus: ['pending', 'charged', 'exempt', 'review_required'].includes(asText(session.billingStatus))
      ? asText(session.billingStatus) as TrainerSessionSummary['billingStatus']
      : undefined,
    attendanceStatus: ['pending', 'present', 'late', 'no_show', 'policy_charge'].includes(asText(session.attendanceStatus))
      ? asText(session.attendanceStatus) as TrainerSessionSummary['attendanceStatus']
      : undefined,
    lateMinutes: session.lateMinutes === null || session.lateMinutes === undefined ? null : asNonNegativeNumber(session.lateMinutes),
    noShowReason: asText(session.noShowReason) || undefined,
    chargedAt: asText(session.chargedAt) || undefined,
    confirmedAt: asText(session.confirmedAt) || undefined,
    contractId: asText(session.contractId) || undefined,
    contractEffective: typeof session.contractEffective === 'boolean' ? session.contractEffective : undefined,
    revision: Number.isInteger(asNumber(session.revision, Number.NaN)) ? asNumber(session.revision) : undefined,
    timeZone: asText(session.timeZone, 'Asia/Ho_Chi_Minh'),
  }
}

function normalizeAvailabilitySlot(value: unknown) {
  if (typeof value === 'string') {
    const slot = value.trim()
    return /^[^-]+-\d{1,2}$/.test(slot) ? slot : ''
  }
  const slot = asRecord(value)
  const day = asText(slot.day || slot.weekday)
  const hour = asOptionalHour(slot.hour)
  return day && hour !== undefined ? `${day}-${hour}` : ''
}

function normalizeTrainingProgram(value: unknown): TrainerStudentDetail['trainingProgram'] {
  const program = asRecord(value)
  const id = asText(program.id)
  if (!id) return null
  return {
    id,
    title: asText(program.title, 'Giáo án Aura'),
    goal: asText(program.goal),
    status: program.status === 'draft' ? 'draft' : 'active',
    revision: asNonNegativeNumber(program.revision),
    trainingDayCount: asNonNegativeNumber(program.trainingDayCount),
    exerciseCount: asNonNegativeNumber(program.exerciseCount),
    updatedAt: asText(program.updatedAt),
  }
}

/**
 * Callable data may contain legacy documents with missing fields. Normalize at
 * the network boundary so one malformed row cannot crash the entire Staff UI.
 */
export function normalizeTrainerStudentDetail(
  value: unknown,
  fallback: { studentId: string; weekId: string },
): TrainerStudentDetail {
  const detail = asRecord(value)
  const student = asRecord(detail.student)
  const studentId = asText(student.id, fallback.studentId)
  const availability = asRecord(detail.availability)
  const rawWorkoutLogs = Array.isArray(detail.workoutLogs) ? detail.workoutLogs : []
  const workoutLogs = rawWorkoutLogs.map((item, index) => {
    const log = asRecord(item)
    const metrics = asRecord(log.metrics)
    return {
      ...log,
      id: asText(log.id, `workout-${index + 1}`),
      source: log.source === 'legacy' ? 'legacy' as const : 'pt_tracking' as const,
      sessionId: asText(log.sessionId),
      date: asDateKey(log.date) || asText(log.date),
      hour: log.hour === null || log.hour === undefined ? null : asOptionalHour(log.hour) ?? null,
      completedAt: asText(log.completedAt),
      updatedAt: asText(log.updatedAt),
      trainingDayTitle: asText(log.trainingDayTitle),
      programName: asText(log.programName),
      workoutName: asText(log.workoutName),
      title: asText(log.title),
      note: asText(log.note),
      painNotes: asText(log.painNotes),
      status: asText(log.status),
      metrics: {
        completedSets: asNonNegativeNumber(metrics.completedSets),
        totalVolumeKg: asNonNegativeNumber(metrics.totalVolumeKg),
        maximumWeightKg: asNonNegativeNumber(metrics.maximumWeightKg),
        maximumRpe: asNonNegativeNumber(metrics.maximumRpe),
        painAlert: asBoolean(metrics.painAlert),
      },
    }
  })
  return {
    schemaVersion: asNonNegativeNumber(detail.schemaVersion, 2),
    formulaVersion: 'contract-usage-v2',
    student: {
      ...student,
      id: studentId,
      name: asText(student.name) || undefined,
      phone: asText(student.phone) || undefined,
      email: asText(student.email) || undefined,
      dob: asDateKey(student.dob) || undefined,
      branchId: asText(student.branchId) || undefined,
      sessionsPerWeek: asNonNegativeNumber(student.sessionsPerWeek),
      status: asText(student.status, 'active'),
    },
    contracts: (Array.isArray(detail.contracts) ? detail.contracts : []).map(normalizeContract),
    sessions: (Array.isArray(detail.sessions) ? detail.sessions : []).map((session, index) => normalizeSession(session, index, studentId)),
    availability: {
      weekId: asDateKey(availability.weekId, fallback.weekId),
      slots: [...new Set((Array.isArray(availability.slots) ? availability.slots : []).map(normalizeAvailabilitySlot).filter(Boolean))],
      status: asText(availability.status, 'not_submitted'),
      confirmed: asBoolean(availability.confirmed),
      locked: asBoolean(availability.locked),
      cutoffAt: asText(availability.cutoffAt),
      source: asText(availability.source, 'profile'),
      sourceWeekId: asDateKey(availability.sourceWeekId) || null,
    },
    trainingProgram: normalizeTrainingProgram(detail.trainingProgram),
    workoutLogs,
  }
}
