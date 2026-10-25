import type { AcademyReviewState } from '../../services/academyLearningService'

/** A cloud read must not undo a card reviewed while that read was in flight. */
export function mergeAcademyReviewStates(current: AcademyReviewState, cloud: AcademyReviewState, beforeRead: AcademyReviewState): AcademyReviewState {
  const cards = { ...cloud.cards }
  for (const [key, local] of Object.entries(current.cards)) {
    const changedDuringRead = JSON.stringify(local) !== JSON.stringify(beforeRead.cards[key])
    if (changedDuringRead || !cards[key] || local.reviewedAt >= cards[key].reviewedAt) cards[key] = local
  }
  return { version: 1, cards }
}
