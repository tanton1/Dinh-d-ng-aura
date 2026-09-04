export type Student360Tab = 'overview' | 'activity' | 'coaching' | 'contract' | 'more'
export type Student360HealthStatus = 'stable' | 'attention' | 'action_required'
export type Student360Severity = 'red' | 'amber' | 'green'

export interface Student360PermissionSet {
  scope: 'system' | 'branch' | 'assigned' | 'sales'
  canViewOperations: boolean
  canViewTraining: boolean
  canViewNutrition: boolean
  canViewProgress: boolean
  canViewProgressPhotos: boolean
  canViewFinancialStatus: boolean
  canViewFinancialAmounts: boolean
  canViewRenewal: boolean
  canManageCare: boolean
  canManageContract: boolean
  canRefreshProjection: boolean
}

export interface Student360HealthComponent {
  id: 'attendance' | 'training' | 'nutrition' | 'progress' | 'engagement' | 'payment' | 'renewal'
  label: string
  weight: number
  score: number | null
  reason: string
  available: boolean
}

export interface Student360Alert {
  id: string
  severity: Student360Severity
  title: string
  message: string
  action: 'schedule' | 'finance' | 'contact' | 'contract' | 'training' | 'progress' | 'nutrition' | 'renewal'
  audience: 'operations' | 'coaching' | 'sales' | 'finance' | 'admin'
}

export interface Student360Action extends Student360Alert {
  priority: number
  description: string
}

export interface Student360Overview {
  schemaVersion: 1
  formulaVersion: 'student-health-v1'
  studentId: string
  accountUid: string | null
  generatedAt: string
  generatedAtMillis: number
  permissions: Student360PermissionSet
  identity: {
    id: string
    accountUid: string | null
    name: string
    phone: string
    email: string
    dob: string | null
    avatarUrl: string | null
    status: 'active' | 'frozen' | 'expired' | 'inactive'
    joinDate: string | null
    goals: string[]
    sessionsPerWeek: number
  }
  assignments: {
    branchId: string
    branchName: string
    trainerIds: string[]
    trainerNames: string[]
    nutritionCoachIds: string[]
    nutritionCoachNames: string[]
    salesIds: string[]
    salesNames: string[]
  }
  contract: null | {
    id: string
    packageName: string
    status: string
    startDate: string | null
    endDate: string | null
    daysRemaining: number | null
    totalSessions: number
    storedUsedSessions: number
    chargedSessions: number
    exemptSessions: number
    pendingReconciliationSessions: number
    usedSessions: number
    remainingSessions: number
    legacyProjectionAdjustment: number
    projectionDelta: number
    reconciliationStatus: 'matched' | 'legacy_projection' | 'projection_behind' | 'over_entitlement'
    payment: null | {
      status: 'paid' | 'due' | 'overdue'
      nextPaymentDate: string | null
      total?: number
      paid?: number
      outstanding?: number
    }
    pausePeriods: Array<{ requestId?: string; type: string; startDate: string; endDate: string; durationDays?: number }>
    extensions: Array<{ id?: string; oldEndDate?: string; newEndDate?: string; reason?: string }>
  }
  schedule: {
    weekId: string
    weekEnd: string
    requiredSessions: number
    bookedSessions: number
    nextSession: null | { id: string; date: string; hour: number | null; trainerId: string; status: string }
    sessions: Array<{ id: string; date: string; hour: number | null; status: string; attendanceStatus: string }>
    availability: { slots: string[]; confirmed: boolean; source: string; sourceWeekId: string | null; minimumSlots: number }
  }
  attendance: {
    rate28Days: number | null
    attended: number
    late: number
    noShow: number
    total: number
    weeklyTrend: Array<{ weekStart: string; rate: number | null; total: number }>
    lastAttendanceAt: string | null
  }
  training: {
    restricted?: boolean
    adherence28Days?: number | null
    completed28Days?: number
    target28Days?: number
    workoutLogCount?: number
    latestWorkoutAt?: string | null
    program?: null | {
      id: string
      title: string
      goal: string
      status: string
      revision: number
      trainingDays: Array<Record<string, unknown>>
    }
    recentLogs?: Array<{
      id: string
      date: string
      title: string
      painNotes: string | null
      completedSets: number
      totalVolumeKg: number
      maximumWeightKg: number
    }>
  }
  nutrition: null | {
    loggedMeals: number
    loggedDays: number
    averageCalories: number
    averageProtein: number
    targetCalories: number | null
    targetProtein: number | null
    lastMealAt: string | null
  }
  progress: null | {
    latestDate: string
    latestWeightKg: number | null
    latestWaistCm: number | null
    latestBodyFatPercent: number | null
    weightChangeKg: number | null
    waistChangeCm: number | null
    bodyFatChangePercent: number | null
    measurementCount: number
  }
  renewal: null | {
    caseId: string
    stage: string
    probability: number
    riskCategory: string | null
    lastContactAt: string | null
    nextActionAt: string | null
    assignedSalesId: string
  }
  health: {
    score: number
    status: Student360HealthStatus
    confidence: 'high' | 'medium' | 'low'
    observedWeight: number
    components: Student360HealthComponent[]
  }
  alerts: Student360Alert[]
  nextActions: Student360Action[]
  dataQuality: Array<{ code: string; severity: 'warning' | 'error'; message: string }>
  cache: { hit: boolean; stale: boolean; maxAgeSeconds: number }
}

export interface Student360TimelineEvent {
  id: string
  type: 'training' | 'workout' | 'off' | 'freeze' | 'schedule_change' | 'nutrition' | 'finance' | 'renewal' | 'progress' | 'care' | 'checkin' | 'contract'
  occurredAt: string
  sortKey: number
  title: string
  description: string
  audience: string
  metadata: Record<string, unknown>
}

export interface Student360ContractInstallment {
  id: string
  date: string
  status: 'pending' | 'paid' | 'cancelled'
  amount?: number
}

export interface Student360ContractRecord {
  id: string
  studentId: string
  branchId: string | null
  packageId: string
  packageName: string
  trainerId: string | null
  trainerIds: string[]
  nutritionPTIds: string[]
  startDate: string
  endDate: string
  frozenAt: string | null
  totalSessions: number
  usedSessions: number
  status: 'active' | 'future' | 'expired' | 'cancelled' | 'frozen'
  nextPaymentDate: string | null
  installments: Student360ContractInstallment[]
  extensions: Array<{ id: string; oldEndDate: string; newEndDate: string; reason: string; createdAt: string | null }>
  pausePeriods: Array<{ requestId: string; type: string; startDate: string; endDate: string; durationDays: number }>
  note: string
  revision: number
  updatedAt: string | null
  updatedByName: string
  totalPrice?: number
  paidAmount?: number
  discount?: number
}

export interface Student360ContractWorkspace {
  schemaVersion: 1
  student: { id: string; name: string; phone: string; email: string }
  activeContractId: string | null
  permissions: {
    canManageContract: boolean
    canCreateContract: boolean
    canEditFinancialTerms: boolean
    canCollectPayments: boolean
    canViewFinancialAmounts: boolean
  }
  contracts: Student360ContractRecord[]
  packages: Array<{ id: string; name: string; totalSessions: number; price: number; durationMonths: number; branchId: string | null }>
  trainers: Array<{ id: string; name: string; branchId: string | null }>
  branches: Array<{ id: string; name: string }>
}

export type Student360ContractMutation =
  | { studentId: string; action: 'create'; contract: Record<string, unknown> }
  | { studentId: string; contractId: string; expectedRevision: number; action: 'edit'; contract: Record<string, unknown> }
  | { studentId: string; contractId: string; expectedRevision: number; action: 'extend'; newEndDate: string; reason: string }
  | { studentId: string; contractId: string; expectedRevision: number; action: 'freeze' | 'reopen'; reason?: string }
  | { studentId: string; contractId: string; expectedRevision: number; action: 'cancel'; reason: string; cancelDebt: boolean }

export interface Student360Photo {
  id: string
  date: string
  images: Array<{ url: string; storagePath: string | null; legacy: boolean }>
}

export interface Student360DirectoryItem {
  studentId: string
  name: string
  phone: string
  branchId: string
  branchName: string
  status: Student360Overview['identity']['status']
  health: Student360Overview['health']
  remainingSessions: number | null
  daysRemaining: number | null
  nextSession: Student360Overview['schedule']['nextSession']
  alertCount: number
}
