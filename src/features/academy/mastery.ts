import type { AcademyLearningDesignV1 } from '../../types'
import type { AcademyReviewState, AcademyWorkbookState } from '../../services/academyLearningService'

/** Self-assessment signals, never a substitute for the server-graded checkpoint. */
export function academyMastery(design: AcademyLearningDesignV1, workbook: AcademyWorkbookState, reviews: AcademyReviewState, lessonId: string, now = Date.now()) {
  const correct = design.microChecks.filter((check) => workbook.microCheckAnswers[check.id] === check.correctIndex).length
  const reviewed = design.cards.filter((card) => reviews.cards[`${lessonId}:${card.id}`]?.reviewedAt).length
  const remembered = design.cards.filter((card) => {
    const item = reviews.cards[`${lessonId}:${card.id}`]
    return item?.reviewedAt && (item.rating === 'good' || item.rating === 'easy')
  }).length
  const due = design.cards.filter((card) => {
    const item = reviews.cards[`${lessonId}:${card.id}`]
    return item?.reviewedAt && item.dueAt <= now
  }).length
  const fields = design.practice.fields.filter((field) => field.required)
  const filled = fields.filter((field) => String(field.id === 'reviewAt' ? workbook.reviewAt : workbook.answers[field.id] ?? '').trim()).length
  const practiceTotal = fields.length + 1
  const practiceFilled = filled + Number(workbook.safetyAcknowledged)
  return {
    correct, reviewed, remembered, due,
    understandPercent: design.microChecks.length ? Math.round(correct / design.microChecks.length * 100) : 0,
    memoryPercent: design.cards.length ? Math.round(remembered / design.cards.length * 100) : 0,
    practicePercent: Math.round(practiceFilled / practiceTotal * 100),
    practiceComplete: practiceFilled === practiceTotal,
    practiceFilled, practiceTotal,
  }
}
