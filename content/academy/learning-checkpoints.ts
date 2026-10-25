import { getAcademyFoundationCheckpoint } from './foundation-checkpoints'
import { getAcademyPilotCheckpoint } from './pilot-checkpoints'
import { getAcademyPersonalizationCheckpoint } from './personalization-checkpoints'
import { getAcademyPerformanceCheckpoint } from './performance-checkpoints'
import { getAcademyMasteryCheckpoint } from './mastery-checkpoints'

// Draft private bank. Adoption into graded learner delivery requires a reviewed revision.
export function getAcademyLearningCheckpoint(chapter: number) {
  if (!Number.isInteger(chapter)) return null
  return getAcademyFoundationCheckpoint(chapter) ?? getAcademyPilotCheckpoint(chapter) ?? getAcademyPersonalizationCheckpoint(chapter) ?? getAcademyPerformanceCheckpoint(chapter) ?? getAcademyMasteryCheckpoint(chapter)
}
