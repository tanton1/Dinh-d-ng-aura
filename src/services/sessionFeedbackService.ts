import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'

export type SessionFeedbackTag =
  | 'trainer_on_time'
  | 'clear_guidance'
  | 'good_technique_correction'
  | 'motivating'
  | 'appropriate_intensity'
  | 'caring'
  | 'workout_not_suitable'
  | 'trainer_late'
  | 'limited_guidance'
  | 'poor_attitude'

export type SessionFeedbackIssueCategory = 'none' | 'service' | 'lateness' | 'training_quality' | 'safety' | 'conduct'
export type SessionFeedbackStatus = 'submitted' | 'needs_review' | 'reviewing' | 'resolved'

export interface PendingSessionFeedback {
  sessionId: string
  date: string
  hour: number
  trainerId: string
  trainerName: string
  branchId: string
  attendanceStatus: 'present' | 'late'
  endsAt: string
  expiresAt: string
}

export interface PendingSessionFeedbackResponse {
  schemaVersion: number
  windowHours: number
  sessions: PendingSessionFeedback[]
}

export interface SessionFeedbackAdminRow {
  id: string
  sessionId: string
  studentId: string
  studentName: string
  trainerId: string
  trainerName: string
  branchId: string
  branchName: string
  sessionDate: string
  sessionHour: number | null
  overallScore: number
  tags: SessionFeedbackTag[]
  comment: string
  anonymousToTrainer: boolean
  issueCategory: SessionFeedbackIssueCategory
  status: SessionFeedbackStatus
  submittedAt: string | null
  reviewedAt: string | null
  reviewedBy: string
  resolutionNote: string
}

export interface TrainerFeedbackSummaryRow {
  trainerId: string
  trainerName: string
  total: number
  scoreTotal: number
  averageScore: number
  lowCount: number
  needsReview: number
}

export interface TrainerFeedbackAdminResponse {
  schemaVersion: number
  truncated: boolean
  attendanceTruncated: boolean
  summary: {
    total: number
    averageScore: number
    lowCount: number
    needsReview: number
    responseRate: number
    eligibleAttendanceCount: number
    byTrainer: TrainerFeedbackSummaryRow[]
  }
  trainers: Array<{ id: string; name: string }>
  branches: Array<{ id: string; name: string }>
  rows: SessionFeedbackAdminRow[]
}

function functionsInstance() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return firebaseFunctions
}

export async function getMyPendingSessionFeedback(): Promise<PendingSessionFeedbackResponse> {
  const callable = httpsCallable<Record<string, never>, PendingSessionFeedbackResponse>(functionsInstance(), 'getMyPendingSessionFeedback')
  const response = await callable({})
  return {
    schemaVersion: Number(response.data?.schemaVersion || 1),
    windowHours: Number(response.data?.windowHours || 72),
    sessions: Array.isArray(response.data?.sessions) ? response.data.sessions : [],
  }
}

export async function submitSessionFeedback(input: {
  sessionId: string
  overallScore: number
  tags: SessionFeedbackTag[]
  comment: string
  anonymousToTrainer: boolean
  issueCategory: SessionFeedbackIssueCategory
}) {
  const callable = httpsCallable<typeof input, { schemaVersion: number; feedbackId: string; status: SessionFeedbackStatus; overallScore: number }>(functionsInstance(), 'submitSessionFeedback')
  return (await callable(input)).data
}

export async function listTrainerFeedbackAdmin(input: {
  from: string
  to: string
  trainerId?: string
  branchId?: string
  status?: SessionFeedbackStatus | ''
  score?: number
}): Promise<TrainerFeedbackAdminResponse> {
  const callable = httpsCallable<typeof input, TrainerFeedbackAdminResponse>(functionsInstance(), 'listTrainerFeedbackAdmin')
  const response = (await callable(input)).data
  return {
    ...response,
    trainers: Array.isArray(response.trainers) ? response.trainers : [],
    branches: Array.isArray(response.branches) ? response.branches : [],
    rows: Array.isArray(response.rows) ? response.rows : [],
    summary: {
      total: Number(response.summary?.total || 0),
      averageScore: Number(response.summary?.averageScore || 0),
      lowCount: Number(response.summary?.lowCount || 0),
      needsReview: Number(response.summary?.needsReview || 0),
      responseRate: Number(response.summary?.responseRate || 0),
      eligibleAttendanceCount: Number(response.summary?.eligibleAttendanceCount || 0),
      byTrainer: Array.isArray(response.summary?.byTrainer) ? response.summary.byTrainer : [],
    },
  }
}

export async function reviewTrainerFeedback(input: {
  feedbackId: string
  action: 'mark_reviewing' | 'resolve' | 'reopen'
  note?: string
}) {
  const callable = httpsCallable<typeof input, { schemaVersion: number; feedbackId: string; status: SessionFeedbackStatus }>(functionsInstance(), 'reviewTrainerFeedback')
  return (await callable(input)).data
}
