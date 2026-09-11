export type ProgressPeriod = '7-days' | '30-days' | '90-days' | 'all'
export type ProgressCategory = 'overview' | 'body' | 'history'

export interface WeightRecord {
  id: string
  date: string // YYYY-MM-DD
  label: string // e.g., '04/08'
  weightKg: number
  trendKg: number
  note?: string
}

export interface BodyMeasurements {
  bmi: number
  bmiCategory: string
  bodyFatPercentage: number
  bodyFatStatus: string
  muscleMassKg: number
  muscleStatus: string
  waistCm: number
  waistStatus: string
  chestCm?: number
  hipsCm?: number
  thighCm?: number
  armCm?: number
  /** Optional context recorded with the measurement, never used as a diagnosis. */
  measurementNote?: string
  updatedAt: string
}

export interface ProgressCheckInPhoto {
  id: string
  angle: 'front' | 'back' | 'left' | 'right'
  imageUrl: string
  storagePath?: string
}

export interface ProgressCheckInRecord {
  id: string
  checkInId: string
  date: string
  weightKg?: number
  bodyFatPercentage?: number
  muscleMassKg?: number
  waistCm?: number
  hipsCm?: number
  thighCm?: number
  armCm?: number
  chestCm?: number
  measurementNote?: string
  photos: ProgressCheckInPhoto[]
  source?: 'student' | 'trainer' | 'admin' | 'legacy'
  verificationStatus?: 'self_reported' | 'verified'
  createdAt?: unknown
  updatedAt?: unknown
}

export interface DailyTask {
  id: string
  title: string
  subtitle: string
  type: 'weight' | 'meal' | 'water' | 'workout' | 'measurement'
  completed: boolean
  progress?: number
  targetText?: string
}

export interface BadgeItem {
  id: string
  title: string
  category: 'starter' | 'streak' | 'nutrition' | 'workout' | 'body'
  icon: string
  description: string
  unlockedAt?: string
  unlocked: boolean
}

export interface AiCoachQuestion {
  id: string
  prompt: string
  answer: string
}
