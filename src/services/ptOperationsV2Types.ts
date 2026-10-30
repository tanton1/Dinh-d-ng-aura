export interface TrainerStudentSummary {
  id: string
  name: string
  phone: string
  email: string
  branchId: string
  status: string
  sessionsPerWeek: number
  assignmentRole: 'primary' | 'secondary' | 'branch' | 'schedule'
  contract: null | {
    id: string
    status: string
    startDate?: string
    endDate?: string
    totalSessions: number
    usedSessions: number
    remainingSessions?: number
    chargedSessions?: number | null
    historySessions?: number | null
    storedUsedSessions?: number
    formulaVersion?: 'contract-usage-v3-daily' | 'contract-usage-v2'
    sourceVersion?: 'contract-usage-v3-daily' | 'contract-usage-v2' | string
    reconciliationStatus?: 'matched' | 'legacy_projection' | 'projection_behind' | 'over_entitlement'
  }
}

export interface TrainerSessionSummary {
  id: string
  studentId: string
  trainerId: string
  studentName?: string
  studentPhone?: string
  studentEmail?: string
  studentBranchId?: string
  branchId?: string
  date: string
  hour?: number
  status: string
  scheduleStatus?: 'scheduled' | 'rescheduled' | 'cancelled'
  billingStatus?: 'pending' | 'charged' | 'exempt' | 'review_required'
  attendanceStatus?: 'pending' | 'present' | 'late' | 'no_show' | 'policy_charge'
  /** A complimentary make-up session created to compensate a missed source session. */
  sessionKind?: 'regular' | 'makeup'
  makeupSourceSessionId?: string | null
  makeupMode?: 'standalone_shift' | 'paired_existing_shift' | null
  commissionEligible?: boolean
  advanceAbsenceNotice?: {
    status: 'none' | 'reported'
    reason?: string
    note?: string
    reportedAt?: string | null
    reportedBy?: string
    replacementLocked?: boolean
    replacementRequestId?: string | null
    replacementSessionId?: string | null
  } | null
  lateMinutes?: number | null
  noShowReason?: string
  chargedAt?: string
  confirmedAt?: string
  contractId?: string
  contractEffective?: boolean
  /** The linked contract still has quota and is schedulable on this session date. */
  contractSchedulable?: boolean
  contract?: TrainerStudentSummary['contract']
  revision?: number
  timeZone: string
}

export interface TrainerStudentContractDetail {
  id: string
  packageName: string
  status: string
  startDate: string
  endDate: string
  totalSessions: number
  usedSessions: number
  remainingSessions: number
  chargedSessions: number | null
  historySessions: number | null
  sourceVersion?: 'contract-usage-v3-daily' | 'contract-usage-v2' | string
  reconciliationStatus: 'matched' | 'legacy_projection' | 'projection_behind' | 'over_entitlement'
  schedulableToday: boolean
  /** Whether at least one day in the selected detail week is schedulable. */
  schedulableOnWeek?: boolean
  pausedToday: boolean
}

export interface TrainerStudentDetail {
  schemaVersion: number
  formulaVersion: 'contract-usage-v3-daily' | 'contract-usage-v2'
  student: Record<string, unknown> & {
    id: string
    name?: string
    phone?: string
    email?: string
    dob?: string
    branchId?: string
    sessionsPerWeek?: number
    status?: string
  }
  contracts: TrainerStudentContractDetail[]
  sessions: TrainerSessionSummary[]
  availability: {
    weekId: string
    slots: string[]
    minimumSlots?: number
    requiredSessions?: number
    revision?: number
    sourceRevision?: number
    status: string
    confirmed: boolean
    locked: boolean
    cutoffAt: string
    submittedAt?: string | null
    updatedAt?: string | null
    source: string
    sourceWeekId: string | null
  }
  trainingProgram: null | {
    id: string
    title: string
    goal: string
    status: 'draft' | 'active'
    revision: number
    trainingDayCount: number
    exerciseCount: number
    trainingDays: Array<{
      id: string
      title: string
      focusMuscles: string[]
      notes: string
      exercises: Array<{
        id: string
        nameVi: string
        targetMuscles: string[]
        secondaryMuscles: string[]
        sets: number
        repMinimum: number
        repMaximum: number
        targetWeightKg: number
        targetRpe: number
        restSeconds: number
        notes: string
      }>
    }>
    updatedAt: string
  }
  workoutLogs: Array<Record<string, unknown> & {
    id: string
    source?: 'pt_tracking' | 'legacy'
    sessionId?: string
    date?: string
    hour?: number | null
    status?: string
    trainingDayTitle?: string
    programName?: string
    note?: string
    painNotes?: string
    completedAt?: string
    updatedAt?: string
    metrics?: {
      completedSets: number
      totalVolumeKg: number
      maximumWeightKg: number
      maximumRpe: number
      painAlert: boolean
    }
  }>
}
