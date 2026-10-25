import type { AcademyDraftReviewPacket } from '../../content/academy/learning-unit'
import { callAcademyReadFunction } from './academyReadService'

/** No localStorage or cross-session cache for unpublished authoring material. */
export async function loadAcademyLearningDraft(chapter: number): Promise<AcademyDraftReviewPacket> {
  const { draft } = await callAcademyReadFunction<{ learningUnitDraft: number }, { draft: AcademyDraftReviewPacket }>(
    'listAcademyCourses', { learningUnitDraft: chapter },
  )
  if (draft?.schemaVersion !== 1 || draft.unit?.chapter !== chapter
    || draft.unit.review?.status !== 'draft-needs-review'
    || !Array.isArray(draft.sources) || !Array.isArray(draft.formativeChecks)) {
    throw new Error('Bản nháp không đúng phiên bản. Hãy tải lại để kiểm tra.')
  }
  return draft
}
