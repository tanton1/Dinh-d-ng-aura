import type { Course, CourseModuleDraft } from '../../types'

export type AcademyChapterAccess = 'full' | 'preview' | 'staff-preview'
export type AcademyChapterRequest = {
  courseId: string; moduleId: string; lessonId: string; courseRevision: number; chapterVersion?: string; access: AcademyChapterAccess
}
export function academyChapterRequest(course: Course, module: CourseModuleDraft, lessonId: string, access: AcademyChapterAccess): AcademyChapterRequest {
  return { courseId: String(course.id), moduleId: module.id, lessonId, courseRevision: course.revision ?? 0,
    ...(module.contentVersion ? { chapterVersion: module.contentVersion } : {}), access }
}
export function academyChapterCacheKey(course: Course, module: CourseModuleDraft, access: AcademyChapterAccess) {
  // Unchanged immutable chapters survive a publication transition. Legacy
  // bodies and staff drafts also bind the root revision because they can change.
  return JSON.stringify([String(course.id), module.id, module.contentVersion ?? `legacy-${course.revision ?? 0}`,
    access, access === 'staff-preview' ? course.revision ?? 0 : null, course.settings?.accessTier,
    course.settings?.visibility, course.settings?.dripSchedule])
}
const fail = (message: string, code = 'functions/failed-precondition'): never => { throw Object.assign(new Error(message), { code }) }
export function validateAcademyChapter(payload: unknown, input: AcademyChapterRequest, metadata: CourseModuleDraft): CourseModuleDraft {
  if (!payload || typeof payload !== 'object') return fail('Phản hồi chương chưa đầy đủ.')
  const data = payload as Record<string, unknown>
  const module = data.module as CourseModuleDraft | undefined
  if (data.contentAccess !== input.access) return fail('Quyền học đã thay đổi. Hãy tải lại danh mục.', 'functions/permission-denied')
  if (data.courseId !== input.courseId || !Number.isSafeInteger(data.courseRevision)
      || Number(data.courseRevision) < input.courseRevision || (!input.chapterVersion && data.courseRevision !== input.courseRevision)
      || (data.chapterVersion ?? null) !== (input.chapterVersion ?? null)
      || !module || module.id !== input.moduleId || module.contentVersion !== input.chapterVersion
      || !Array.isArray(module.lessons) || module.lessons.length !== metadata.lessons.length
      || module.lessons.some((lesson, index) => lesson.id !== metadata.lessons[index].id || lesson.contentVersion !== input.chapterVersion)) {
    return fail('Chương đã đổi phiên bản hoặc chưa tải đầy đủ. Hãy mở lại danh mục.', 'functions/aborted')
  }
  if ('quizKeys' in data || 'chapterRefs' in data || 'contentHash' in data || module.lessons.some((lesson) =>
    lesson.coachNotes !== undefined || lesson.workoutRef !== undefined || lesson.provenance !== undefined
    || lesson.quiz?.questions.some((question) => question.correctIndex !== undefined || question.explanation !== undefined)
    || lesson.resources?.some((resource) => resource.source !== undefined))) {
    return fail('Phản hồi chương chứa trường riêng tư không được phép hiển thị.')
  }
  if (input.access === 'preview' && module.lessons.some((lesson) => !lesson.preview
      && (lesson.summary !== undefined || lesson.memory !== undefined || lesson.learningDesign !== undefined
        || lesson.resources !== undefined || lesson.primaryContent !== undefined || lesson.quiz !== undefined))) {
    return fail('Phản hồi xem thử chưa được giới hạn đúng quyền.')
  }
  return structuredClone(module)
}
