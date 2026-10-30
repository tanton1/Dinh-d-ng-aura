export interface AcademyTerm {
  id: string
  term: string
  definition: string
}

export interface AcademyRecallPrompt {
  id: string
  prompt: string
  answer: string
}

export interface AcademyFlashcard {
  id: string
  front: string
  back: string
  hint?: string
}

export interface AcademyLessonContent {
  minuteSummary: string
  keyTakeaways: string[]
  terms: AcademyTerm[]
  recallPrompts: AcademyRecallPrompt[]
  flashcards: AcademyFlashcard[]
}

export type AcademyWorkbookState = {
  schemaVersion: 2
  definitionVersion: number
  definitionHash?: string
  cloudRevision: number
  sharedWithCoach: boolean
  answers: Record<string, string>
  challengeDone: Record<string, boolean>
  microCheckAnswers: Record<string, number>
  confidenceBefore: 1 | 2 | 3 | 4 | 5 | null
  confidenceAfter: 1 | 2 | 3 | 4 | 5 | null
  rubric: Record<'data' | 'mechanism' | 'feasibility' | 'safety', 0 | 1 | 2>
  decision: 'keep' | 'adjust' | 'stop' | 'refer' | null
  reviewAt: string
  safetyAcknowledged: boolean
  updatedAt: number
  /** Device-only markers: absent on legacy drafts; never trusted as server proof. */
  pendingSync?: boolean
  localEditId?: string
  /** Explicit version changes retain the preceding draft separately. */
  previousArchiveId?: string
}

export type AcademyReviewRating = 'again' | 'hard' | 'good' | 'easy'

export interface AcademyCardProgress {
  lessonId: string
  cardId: string
  rating: AcademyReviewRating
  repetitions: number
  intervalDays: number
  reviewedAt: number
  dueAt: number
}

export interface AcademyReviewState {
  version: 1
  cards: Record<string, AcademyCardProgress>
}
