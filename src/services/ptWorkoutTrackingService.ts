import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { callReadOnlyFunction } from './readOnlyCallableService'

export type PtExerciseTrackingMode = 'weight_reps' | 'bodyweight_reps' | 'time' | 'distance' | 'assisted_weight'

export interface PtTrainingExercise {
  id: string
  catalogExerciseId: string
  catalogRevision?: number
  nameVi: string
  targetMuscles: string[]
  secondaryMuscles: string[]
  equipment: string[]
  instructionsVi: string[]
  cuesVi: string[]
  media: { posterUrl?: string; animationUrl?: string }
  trackingMode: PtExerciseTrackingMode
  sets: number
  repMinimum: number
  repMaximum: number
  durationSeconds: number
  distanceMeters: number
  targetWeightKg: number
  targetRpe: number
  targetRir: number
  tempo: string
  restSeconds: number
  unilateral: boolean
  notes: string
}

export interface PtTrainingDay {
  id: string
  title: string
  focusMuscles: string[]
  notes: string
  order: number
  exercises: PtTrainingExercise[]
}

export interface PtTrainingProgram {
  id?: string
  studentId?: string
  title: string
  goal: string
  coachNotes: string
  status: 'draft' | 'active'
  revision: number
  trainingDays: PtTrainingDay[]
  updatedAt?: string
}

export interface PtWorkoutSession {
  id: string
  studentId: string
  trainerId: string
  branchId?: string
  contractId?: string
  date: string
  hour: number
  status: string
  trainerName?: string
  branchName?: string
}

export interface PtWorkoutStudent {
  id: string
  name: string
  phone: string
  branchId: string
  contractId?: string
  contractStatus?: 'active' | 'future' | 'frozen' | string
  assignmentSource?: 'contract' | 'teaching_session'
  eligibleForNewProgram?: boolean
}

export interface PtWorkoutSet {
  exerciseId: string
  catalogExerciseId?: string
  exerciseName?: string
  setNumber: number
  setType: 'warmup' | 'working' | 'drop' | 'failure'
  weightKg: number
  reps: number
  durationSeconds: number
  distanceMeters: number
  rpe: number
  rir: number
  painLevel: number
  completed: boolean
  notes: string
}

export interface PtWorkoutLog {
  id: string
  sessionId: string
  studentId: string
  date: string
  hour: number
  trainingDayId: string
  trainingDayTitle: string
  status: 'draft' | 'completed'
  revision: number
  sets: PtWorkoutSet[]
  coachNotes?: string
  painNotes?: string
  metrics: {
    completedSets: number
    totalVolumeKg: number
    maximumWeightKg: number
    maximumRpe: number
    painAlert: boolean
  }
}

export interface PtWorkoutWorkspace {
  sessions: PtWorkoutSession[]
  students: PtWorkoutStudent[]
  programs: PtTrainingProgram[]
  logs: PtWorkoutLog[]
}

export interface PtWorkoutHistory {
  studentId: string
  logs: PtWorkoutLog[]
  analytics: {
    completedWorkouts: number
    totalVolumeKg: number
    painAlerts: number
    personalRecords: Array<{ catalogExerciseId: string; exerciseName: string; maximumWeightKg: number; maximumSetVolumeKg: number }>
  }
}

function callable<Input, Output>(name: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  return httpsCallable<Input, Output>(firebaseFunctions, name)
}

export async function getPtWorkoutWorkspace(from: string, to = from): Promise<PtWorkoutWorkspace> {
  return callReadOnlyFunction<{ from: string; to: string }, PtWorkoutWorkspace>('getPtWorkoutWorkspace', { from, to })
}

export async function getPtStudentTrainingPlan(studentId?: string): Promise<PtTrainingProgram | null> {
  const response = await callReadOnlyFunction<{ studentId?: string }, { program: PtTrainingProgram | null }>('getPtStudentTrainingPlan', { studentId })
  return response.program
}

export async function savePtStudentTrainingPlan(input: {
  studentId: string
  expectedRevision: number
  program: Omit<PtTrainingProgram, 'revision' | 'id' | 'studentId'>
}) {
  const response = await callable<typeof input, { studentId: string; revision: number }>('savePtStudentTrainingPlan')(input)
  return response.data
}

export async function savePtSessionWorkoutLog(input: {
  sessionId: string
  studentId: string
  expectedRevision: number
  trainingDayId: string
  status: 'draft' | 'completed'
  sets: PtWorkoutSet[]
  sessionReadiness?: number
  painNotes?: string
  coachNotes?: string
}) {
  const response = await callable<typeof input, {
    logId: string
    revision: number
    status: 'draft' | 'completed'
    metrics: PtWorkoutLog['metrics']
  }>('savePtSessionWorkoutLog')(input)
  return response.data
}

export async function listPtWorkoutHistory(studentId?: string, limit = 60): Promise<PtWorkoutHistory> {
  return callReadOnlyFunction<{ studentId?: string; limit: number }, PtWorkoutHistory>('listPtWorkoutHistory', { studentId, limit })
}
