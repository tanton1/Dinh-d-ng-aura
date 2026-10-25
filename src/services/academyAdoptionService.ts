import { httpsCallable } from 'firebase/functions'
import { firebaseAuth } from '../lib/firebase'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { callAcademyReadFunction } from './academyReadService'
import { parseAcademyAdoptionRead, type AcademyAdoptionRead, type AcademyAdoptionResult, type AcademyAdoptionReviewInput, type AcademyScientificReview } from '../features/academy/adoption'

/** Mutations have no regional fallback or automatic replay. Server binds the initiating account too. */
async function action<Output>(input: object): Promise<Output> {
  const owner = firebaseAuth?.currentUser
  if (!owner || !firebaseFunctions) throw new Error('Hãy đăng nhập bằng tài khoản biên tập trước khi thao tác.')
  const result = await httpsCallable<object, Output>(firebaseFunctions, 'saveCourseDraftAtomic', { timeout: 60_000 })({
    academyAdoption: { ...input, expectedActorId: owner.uid },
  })
  if (firebaseAuth?.currentUser !== owner) throw new Error('Phiên đăng nhập đã đổi. Hãy mở lại khóa học để kiểm tra kết quả trên server.')
  return result.data
}

export async function readAcademyAdoption(courseId: string, chapter: number, candidateId?: string): Promise<AcademyAdoptionRead> {
  const response = await callAcademyReadFunction<object, unknown>('listAcademyCourses', {
    adoptionCandidate: { courseId, ...(candidateId ? { candidateId } : { chapter }) },
  })
  return parseAcademyAdoptionRead(response, courseId, chapter, candidateId)
}
export async function prepareAcademyAdoption(courseId: string, chapter: number, expectedRevision: number) {
  const result = await action<{ courseId: string; chapter: number; candidateId: string; preparedAtRevision: number }>({ action: 'prepare', courseId, chapter, expectedRevision })
  if (result.courseId !== courseId || result.chapter !== chapter || result.preparedAtRevision !== expectedRevision || !/^[a-f0-9]{64}$/.test(result.candidateId)) {
    throw new Error('Chưa xác nhận được đề xuất đã tạo. Hãy mở đề xuất mới nhất; không cần tạo lại ngay.')
  }
  return result
}
export const reviewAcademyAdoption = (input: AcademyAdoptionReviewInput) => action<{ review: AcademyScientificReview; duplicate: boolean }>({ action: 'review', ...input })
export const adoptAcademyChapter = (input: { courseId: string; candidateId: string; expectedRevision: number; expectedReviewRevision: number }) =>
  action<AcademyAdoptionResult>({ action: 'adopt', ...input })
