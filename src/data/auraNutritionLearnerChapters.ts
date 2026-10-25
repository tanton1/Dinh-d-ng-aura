import chapters from './generated/auraNutritionLearnerChapters.json'
import type { CurriculumChapter } from './auraNutritionCurriculum'

// The generated projection intentionally has no checkpoint question bank or keys.
export function getAuraNutritionChapter(chapterNumber: number) {
  return (chapters as Array<Omit<CurriculumChapter, 'quiz'>>).find((chapter) => chapter.number === chapterNumber) ?? null
}
