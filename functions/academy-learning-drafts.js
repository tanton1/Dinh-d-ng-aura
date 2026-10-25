'use strict'
const { academyDraftChapterNumbers } = require('./generated/academy-draft-catalog.cjs')

/** Read-only author preview. No publication, enrollment or progress mutation. */
async function readAcademyLearningDraft({ request, requireStaff, HttpsError, loadDraft }) {
  await requireStaff(request)
  const chapter = request.data?.learningUnitDraft
  if (!Number.isInteger(chapter) || !academyDraftChapterNumbers.includes(chapter)) {
    throw new HttpsError('invalid-argument', 'Chương bản nháp không hợp lệ.')
  }
  const draft = loadDraft(chapter)
  if (!draft || draft.unit?.chapter !== chapter || draft.unit?.review?.status !== 'draft-needs-review') {
    throw new HttpsError('failed-precondition', 'Bản nháp chưa sẵn sàng để rà soát.')
  }
  return { draft }
}

module.exports = { readAcademyLearningDraft }
