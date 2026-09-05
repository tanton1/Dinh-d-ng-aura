import type { AcademyFlashcard, AcademyReviewState } from '../../services/academyLearningService'

export interface AcademyReviewQueueSource {
  lessonId: string
  lessonTitle: string
  chapterLabel: string
  cards: AcademyFlashcard[]
}

export interface AcademyReviewQueueItem extends AcademyFlashcard {
  lessonId: string
  lessonTitle: string
  chapterLabel: string
  progress: AcademyReviewState['cards'][string]
}

/**
 * Builds a course-wide queue only from cards the learner has already reviewed.
 * Untouched chapters never become overdue merely because they are published.
 */
export function getDueAcademyReviewCards(
  sources: AcademyReviewQueueSource[],
  reviewState: AcademyReviewState,
  now = Date.now(),
): AcademyReviewQueueItem[] {
  const seen = new Set<string>()
  return sources.flatMap((source) => source.cards.flatMap((card) => {
    const key = `${source.lessonId}:${card.id}`
    const progress = reviewState.cards[key]
    if (seen.has(key) || !progress?.reviewedAt || progress.dueAt > now || !card.front || !card.back) return []
    seen.add(key)
    return [{
      ...card,
      lessonId: source.lessonId,
      lessonTitle: source.lessonTitle,
      chapterLabel: source.chapterLabel,
      progress,
    }]
  })).sort((left, right) => (
    left.progress.dueAt - right.progress.dueAt
      || left.progress.reviewedAt - right.progress.reviewedAt
      || left.lessonId.localeCompare(right.lessonId)
      || left.id.localeCompare(right.id)
  ))
}
