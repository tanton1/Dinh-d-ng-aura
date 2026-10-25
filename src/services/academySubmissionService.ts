import { httpsCallable } from 'firebase/functions'
import { firebaseAuth } from '../lib/firebase'
import { firebaseAcademySubmissionFunctions } from '../lib/firebaseFunctions'
import type { AcademyCoachReview, AcademyReviewInput, AcademySubmissionHead, AcademySubmissionView } from '../features/academy/submissionTypes'

/** One regional endpoint. No fallback/replay for mutations, and no persistent evidence cache. */
async function action<Output>(input: object): Promise<Output> {
  const owner = firebaseAuth?.currentUser
  if (!owner || !firebaseAcademySubmissionFunctions) throw new Error('Hãy đăng nhập lại để xem hoặc nộp bài.')
  const result = await httpsCallable<object, Output>(firebaseAcademySubmissionFunctions, 'academySubmissionAction', { timeout: 30_000 })(input)
  if (firebaseAuth?.currentUser !== owner) throw new Error('Phiên đăng nhập đã thay đổi. Hãy mở lại bài học.')
  return result.data
}

export const readAcademySubmission = (input: { userId: string; courseId: string; artifactId: string; submissionId?: string }) =>
  action<AcademySubmissionView>({ action: 'read', ...input })
export const listSharedAcademySubmissions = (userId: string, cursor?: string) =>
  action<{ items: AcademySubmissionHead[]; nextCursor: string | null }>({ action: 'list', userId, ...(cursor ? { cursor } : {}) })
export const saveAcademyCoachReview = (input: AcademyReviewInput) =>
  action<{ review: AcademyCoachReview; duplicate: boolean }>({ action: 'review', ...input })
export const submitAcademyPortfolio = (input: { courseId: string; stageId: number; workbookRevision: number }) =>
  action<{ submissionId: string; workbookRevision: number; duplicate: boolean }>({ action: 'submit-portfolio', ...input })
