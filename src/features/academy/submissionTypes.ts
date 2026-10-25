import type { AcademyPracticeDefinition } from '../../types'

export type AcademyReviewScores = Record<'data' | 'mechanism' | 'feasibility' | 'safety', 0 | 1 | 2>
export type AcademyReviewVerdict = 'accepted' | 'needs-revision'
export type AcademySubmissionHead = {
  courseId: string
  artifactId: string
  kind: 'practice' | 'portfolio'
  title: string
  submissionId: string
  workbookRevision: number
  reviewStatus: 'not-reviewed' | AcademyReviewVerdict
  submittedAt: number | null
}
export type AcademySubmissionRecord = Omit<AcademySubmissionHead, 'reviewStatus'> & {
  schemaVersion: 1
  userId: string
  definitionVersion: number
  definitionSnapshot: AcademyPracticeDefinition
  evidence: { answers: Record<string, string>; safetyAcknowledged: boolean }
  rubric: { version: number; criteria: Array<{ id: keyof AcademyReviewScores; label: string; levels: string[] }> }
  sourceEvidence: Array<{ artifactId: string; submissionId: string; workbookRevision: number; contentHash: string }>
}
export type AcademyCoachReview = {
  submissionId: string
  reviewerId: string
  reviewerName: string
  revision: number
  rubricVersion: number
  scores: AcademyReviewScores
  verdict: AcademyReviewVerdict
  feedback: string
  reviewedAt: number | null
}
export type AcademySubmissionView = {
  submission: AcademySubmissionRecord | null
  review: AcademyCoachReview | null
  latestSubmissionId: string | null
}
export type AcademyReviewInput = {
  userId: string
  courseId: string
  artifactId: string
  submissionId: string
  expectedReviewRevision: number
  scores: AcademyReviewScores
  verdict: AcademyReviewVerdict
  feedback: string
}
export const academyReviewStatusLabels = {
  'not-reviewed': 'Chưa có nhận xét',
  accepted: 'Đạt yêu cầu bài học',
  'needs-revision': 'Cần bổ sung bài',
} as const
