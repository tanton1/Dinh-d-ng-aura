export type Day = 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7'

export const DAYS: Day[] = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
export const HOURS = [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20]

export interface Macros {
  kcal: number
  protein: number
  carb: number
  fat: number
}

export interface MealTemplate {
  id: string
  name: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  items: FoodItem[]
  base_macros: Macros
  context: string[]
  swap_keys: string[]
  fallback_level: number
  taste_profile: string[]
}

export interface FoodItem {
  id?: string
  foodId?: string
  name?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  unit?: string
  amount?: number
  category?: string
  multiplier?: number
  portion_common?: string
  macros?: Macros
  trigger_food?: boolean
}

export interface ProgressRecord {
  id: string
  date: string
  weight: number
  photos: string[]
  body_fat: number
  arm: number
  hip: number
  waist: number
  butt: number
  thigh: number
}

export interface SwapRule {
  id: string
  swap_key: string
  category?: string
  options: FoodItem[]
}

export interface StaffMember {
  id: string
  name: string
  email: string
  phone?: string
  role: 'admin' | 'trainer' | 'sales' | 'manager'
  branchId?: string
  status: 'active' | 'inactive'
  employmentType?: 'full_time' | 'part_time' | 'collaborator'
}

export interface Trainer {
  id: string
  employeeCode?: string
  name: string
  phone?: string
  email?: string
  branchId?: string
  commissionRate: number
  commissionPerSession?: number
  baseSalary?: number
  status: 'active' | 'inactive'
  employmentType?: 'full_time' | 'part_time' | 'collaborator'
  priority?: number
  availableSlots?: string[]
  /** Number of learners this trainer can safely serve in one time slot. */
  slotCapacity?: number
}

export interface Branch {
  id: string
  name: string
  address: string
  status?: 'active' | 'archived'
  archivedAt?: string
}

export interface Student {
  id: string
  name: string
  phone?: string
  email?: string
  dob?: string
  sessionsPerWeek: number
  availableSlots: string[]
  status?: 'active' | 'inactive'
  joinDate?: string
  branchId?: string
  isScheduleConfirmed?: boolean
  nutritionNote?: string
}

export interface TrainingPackage {
  id: string
  name: string
  totalSessions: number
  price: number
  durationMonths: number
  branchId?: string
}

export interface Installment {
  id: string
  amount: number
  date: string
  status: 'pending' | 'paid' | 'cancelled'
}

export interface SessionRequest {
  id: string
  studentId: string
  contractId: string
  sessionId?: string
  trainerId?: string
  requestedBy?: 'student' | 'trainer'
  originalSessionRevision?: number
  originalDate: string
  originalHour?: number 
  type: 'cancel' | 'reschedule'
  newDate?: string 
  newHour?: number
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  adminNote?: string
  createdAt: string
  submittedAtIso?: string
  deadlineAt?: string
  policyMonth?: string
  policySequence?: number
  complimentary?: boolean
  countsTowardContract?: boolean
  expectedPolicySequence?: number
  expectedCountsTowardContract?: boolean
}

export interface ContractExtension {
  id: string
  oldEndDate: string
  newEndDate: string
  reason: string
  createdAt: string
  createdBy?: string
}

export interface LeaveRequest {
  id: string
  studentId: string
  contractId: string
  startDate: string
  endDate: string
  reason: string
  type?: 'off' | 'preservation'
  durationDays?: number
  contractDurationMonths?: number
  offLimit?: number
  offUsedOrPending?: number
  offSequence?: number
  cutoffAt?: string | null
  status: 'pending' | 'approved' | 'rejected'
  adminNote?: string
  createdAt: string
  approvedAt?: string
  newContractEndDate?: string
  cancelledSessionCount?: number
}

export interface StudentContract {
  id: string
  studentId: string
  trainerId?: string | null
  trainerIds?: string[]
  nutritionPTIds?: string[]
  branchId?: string | null
  packageId: string
  packageName: string
  startDate: string
  endDate: string
  frozenAt?: string
  totalSessions: number
  usedSessions: number
  totalPrice: number
  paidAmount: number
  discount?: number
  status: 'active' | 'expired' | 'cancelled' | 'frozen'
  nextPaymentDate?: string | null
  installments?: Installment[]
  attendedClasses?: string[]
  referralCode?: string | null
  referralStaffId?: string | null
  referralCommissionRate?: number | null
  /** @deprecated Legacy cached amount; payroll now derives commission from canonical cash ledger entries. */
  referralCommission?: number | null
  extensions?: ContractExtension[]
  pausePeriods?: Array<{
    requestId: string
    type: 'off' | 'preservation'
    startDate: string
    endDate: string
    durationDays: number
  }>
  revision?: number
  note?: string
}

export interface PaymentRecord {
  id: string
  contractId: string
  studentId: string
  amount: number
  date: string
  method: 'cash' | 'transfer'
  note: string
  previousInstallments?: Installment[]
  installmentId?: string
}

export interface Quote {
  id: string
  code: string
  customerName: string
  customerPhone: string
  branchId: string
  packageId: string
  packageName: string
  originalPrice: number
  discount: number
  finalPrice: number
  date: string
  validUntil: string
  status?: 'pending' | 'accepted' | 'rejected'
  referralCode?: string
}

export interface ScheduleEntry {
  studentId: string
  trainerId: string
  isLocked?: boolean
  branchId?: string
  type?: 'training' | 'off'
}

export interface Schedule {
  [slotId: string]: ScheduleEntry[]
}

export interface Warning {
  studentId: string
  scheduled: number
  requested: number
  suggestions: string[]
  overlappingSlots?: string[]
  multipleSessionsDays?: string[]
}

export interface SchedulerResult {
  schedule: Schedule
  warnings: Warning[]
  debugSteps?: string[]
}

export interface ScheduleConfig {
  workingDays: Day[]
  workingHours: number[]
  isAutoLockEnabled?: boolean
  lockDayOfWeek?: number
  lockHour?: number
  holidays?: string[]
}

export interface Session {
  id: string
  trainerId: string
  studentId: string
  contractId: string
  date: string
  hour?: number
  status: 'scheduled' | 'rescheduled' | 'completed' | 'cancelled' | 'canceled_by_student' | 'student_cancelled' | 'trainer_cancelled'
  branchId?: string
  verifiedByStudent?: boolean
  scheduleEntryId?: string
  revision?: number
}

export interface Payroll {
  id: string
  trainerId: string
  month: string
  totalSessions: number
  totalCommission: number
  status: 'pending' | 'paid'
}

export interface WorkoutSetLog {
  reps: number
  weight: number
}

export interface WorkoutLog {
  id: string
  studentId: string
  sessionId?: string
  date: string
  exerciseName: string
  sets: WorkoutSetLog[]
  feeling?: string
  note?: string
  createdAt: string
}

export interface DailyCheckin {
  id: string
  studentId: string
  date: string
  hunger: number
  energy: number
  compliance: number
  note: string
  waterIntake?: number
  sleepQuality?: number
  createdAt: any
}

export interface WorkoutExercise {
  id?: string
  name: string
  sets: number
  reps: string
  rest: string
  note?: string
  videoUrl?: string
}

export interface WorkoutDay {
  dayName: string
  description?: string
  exercises: WorkoutExercise[]
}

export interface WorkoutWeek {
  name: string
  days: WorkoutDay[]
}

export interface WorkoutPlan {
  id: string
  name: string
  target: 'fat_loss' | 'muscle_gain' | 'strength' | 'general'
  gender: 'female' | 'male' | 'both'
  description: string
  durationWeeks: number
  level: 'beginner' | 'intermediate' | 'advanced'
  weeks: WorkoutWeek[]
}

export interface HealthyDish {
  id: string
  name: string
  image: string
  calories: number
  protein: number
  carbs: number
  fat: number
  category: string
  ingredients: string[]
  portion?: string
  instructions?: string[]
}
