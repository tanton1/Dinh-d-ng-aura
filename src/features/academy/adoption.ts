import type { AcademyDraftReviewPacket } from '../../../content/academy/learning-unit'
import type { CourseDraftInput, CourseModuleDraft, LessonQuizQuestionDraft } from '../../types'

export const academyReviewAreas = ['content', 'assessment', 'references', 'safety'] as const
export type AcademyScientificChecks = Record<typeof academyReviewAreas[number], boolean>
export type AcademyScientificDecision = 'approved' | 'changes-requested' | 'withdrawn'
export interface AcademyScientificReview {
  revision: number; decision: AcademyScientificDecision; reviewerId: string; notes: string
  checks: AcademyScientificChecks; reviewedAt: number | null
}
export interface AcademyAdoptionArtifact {
  schemaVersion: 1; compilerVersion: number; courseId: string; moduleId: string; chapter: number; sourceRevision: string
  source: AcademyDraftReviewPacket
  checkpointQuestions: (LessonQuizQuestionDraft & { correctIndex: number })[]
  baseContentHash: string; module: CourseModuleDraft
  quizKeys: Record<string, { answers: Record<string, number>; quizId: string; contentHash: string; passPercent: number; questionCount: number }>
}
export interface AcademyAdoptionCandidate {
  candidateId: string; artifact: AcademyAdoptionArtifact; preparedAtRevision: number; createdAt: number | null
  review: AcademyScientificReview | null; approvalValid: boolean; canReview: boolean; courseRevision: number; alreadyAdopted: boolean
}
export type AcademyAdoptionRead = AcademyAdoptionCandidate | { candidateId: null; courseRevision: number }
export interface AcademyAdoptionResult {
  courseId: string; candidateId: string; revision: number; status: CourseDraftInput['publicationStatus']
  alreadyAdopted: boolean; publishedRevision?: number | null
}
export interface AcademyAdoptionReviewInput {
  courseId: string; candidateId: string; expectedReviewRevision: number; decision: AcademyScientificDecision
  checks: AcademyScientificChecks; notes: string
}
const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

/** Fail closed on mixed course/chapter responses before rendering private assessments. */
export function parseAcademyAdoptionRead(value: unknown, courseId: string, chapter: number, candidateId?: string): AcademyAdoptionRead {
  const fail = (): never => { throw new Error('Đề xuất không đúng khóa học hoặc phiên bản. Hãy mở lại đề xuất mới nhất.') }
  if (!object(value) || !revision(value.courseRevision)) return fail()
  if (value.candidateId === null && !candidateId) return { candidateId: null, courseRevision: value.courseRevision }
  const artifact = value.artifact, expectedModule = `nutrition-chapter-${String(chapter).padStart(2, '0')}`
  if (!digest(value.candidateId) || (candidateId && value.candidateId !== candidateId) || !object(artifact)
      || artifact.schemaVersion !== 1 || artifact.compilerVersion !== 1 || artifact.courseId !== courseId || artifact.chapter !== chapter
      || artifact.moduleId !== expectedModule || artifact.source?.schemaVersion !== 1 || artifact.source.unit?.chapter !== chapter
      || !Array.isArray(artifact.source.sources) || !Array.isArray(artifact.source.formativeChecks)
      || !object(artifact.module) || artifact.module.id !== expectedModule || !Array.isArray(artifact.module.lessons)
      || artifact.module.lessons.length !== 3 || !Array.isArray(artifact.checkpointQuestions) || artifact.checkpointQuestions.length !== 8
      || artifact.checkpointQuestions.some((q: unknown) => !object(q) || typeof q.question !== 'string' || !Array.isArray(q.options)
        || !q.options.every((option: unknown) => typeof option === 'string') || !Number.isInteger(q.correctIndex)
        || q.correctIndex < 0 || q.correctIndex >= q.options.length)
      || !object(artifact.quizKeys) || !digest(artifact.baseContentHash) || !revision(value.preparedAtRevision)
      || ['approvalValid', 'canReview', 'alreadyAdopted'].some((key) => typeof value[key] !== 'boolean')) return fail()
  const prefix = `chapter-${String(chapter).padStart(2, '0')}`
  for (const suffix of ['core', 'practice', 'checkpoint']) {
    const lesson = artifact.module.lessons.find((item: any) => item.id === `${prefix}-${suffix}`)
    if (!object(lesson) || typeof lesson.title !== 'string' || (lesson.resources !== undefined && !Array.isArray(lesson.resources))) return fail()
    if (suffix !== 'checkpoint' && (lesson.primaryContent?.kind !== 'rich-text' || typeof lesson.primaryContent.body !== 'string')) return fail()
  }
  const checkpoint = artifact.module.lessons.find((item: any) => item.id === `${prefix}-checkpoint`)
  const key = artifact.quizKeys[checkpoint.id]
  if (!object(key) || !object(key.answers) || !digest(key.contentHash) || checkpoint.quiz?.questions?.length !== 8
      || artifact.checkpointQuestions.some((q: any) => key.answers[q.id] !== q.correctIndex)) return fail()
  if (value.review !== null && (!object(value.review) || !revision(value.review.revision) || value.review.revision < 1
      || !['approved', 'changes-requested', 'withdrawn'].includes(value.review.decision) || typeof value.review.notes !== 'string'
      || !object(value.review.checks) || academyReviewAreas.some((area) => typeof value.review.checks[area] !== 'boolean'))) return fail()
  if (value.approvalValid && (value.review?.decision !== 'approved' || academyReviewAreas.some((area) => value.review.checks[area] !== true))) return fail()
  return value as unknown as AcademyAdoptionCandidate
}

/** Apply only a fresh successful CAS to a clean editor; never merge an uncertain replay over newer work. */
export function applyAcademyAdoption(course: CourseDraftInput, candidate: AcademyAdoptionCandidate, result: AcademyAdoptionResult): CourseDraftInput {
  if (result.alreadyAdopted || result.courseId !== course.id || candidate.artifact.courseId !== course.id
      || result.candidateId !== candidate.candidateId || result.revision !== (course.revision ?? 0) + 1 || result.status !== 'draft'
      || candidate.courseRevision !== course.revision || !course.modules.some((module) => module.id === candidate.artifact.moduleId)) {
    throw new Error('Server có thể đã nhập chương. Hãy mở lại đề xuất và tải bản biên tập mới nhất trước khi sửa tiếp.')
  }
  const module = structuredClone(candidate.artifact.module)
  module.academyAdoption = { candidateId: candidate.candidateId }
  const quizAnswerKeys = { ...course.quizAnswerKeys }
  for (const lesson of module.lessons) {
    delete quizAnswerKeys[lesson.id]
    const answers = candidate.artifact.quizKeys[lesson.id]?.answers
    if (answers) {
      quizAnswerKeys[lesson.id] = Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, [answer]]))
      if (lesson.quiz) lesson.quiz.questions = lesson.quiz.questions.map((question) => ({ ...question, correctIndex: answers[question.id] }))
    }
  }
  return { ...course, revision: result.revision, publicationStatus: result.status, publishedRevision: result.publishedRevision !== undefined ? result.publishedRevision : course.publishedRevision,
    modules: course.modules.map((item) => item.id === module.id ? module : item), quizAnswerKeys }
}
