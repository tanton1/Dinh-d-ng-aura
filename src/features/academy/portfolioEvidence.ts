import type { CourseLessonDraft } from '../../types'
import type { AcademyWorkbookState } from '../../services/academyLearningService'
import { isAcademyPracticeArtifactComplete, type AcademyPortfolioStage } from './portfolio'

export function academyPortfolioSources(stage: AcademyPortfolioStage, lessons: CourseLessonDraft[]) {
  return Array.from({ length: stage.chapterRange[1] - stage.chapterRange[0] + 1 }, (_, index) => {
    const chapter = stage.chapterRange[0] + index
    const prefix = `chapter-${String(chapter).padStart(2, '0')}`
    const lesson = lessons.find((candidate) => candidate.id === `${prefix}-core`)
    return { chapter, lessonId: `${prefix}-core`, practiceLessonId: `${prefix}-practice`, lesson }
  })
}

export function academyPortfolioReadPlan(activated: boolean, currentLessonId: string, sourceIds: string[], loadedIds: ReadonlySet<string>) {
  return activated ? [...new Set(sourceIds)].filter((id) => id !== currentLessonId && !loadedIds.has(id)) : []
}

export type AcademyArtifactStatus = 'not-checked' | 'definition-not-loaded' | 'draft' | 'filled' | 'submitted' | 'updated-after-submission' | 'outdated-definition' | 'outdated-draft'

export function academyPortfolioArtifactStatus(input: {
  workbook?: AcademyWorkbookState
  requiredFieldIds?: string[]
  completed?: boolean
  submittedRevision?: number
  checked: boolean
  definitionLoaded?: boolean
  definitionVersion?: number
  submittedDefinitionVersion?: number
  definitionHash?: string
  submittedDefinitionHash?: string
}): AcademyArtifactStatus {
  const { workbook, submittedRevision, completed, requiredFieldIds, checked } = input
  const hasRevision = Number.isInteger(submittedRevision) && (submittedRevision ?? 0) > 0
  // Historical completion is not evidence against an unloaded definition.
  if (input.definitionLoaded === false) return 'definition-not-loaded'
  if (completed || hasRevision) {
    if (input.definitionVersion && input.definitionVersion !== (input.submittedDefinitionVersion ?? 1)) return 'outdated-definition'
    if (input.definitionHash && input.definitionHash !== input.submittedDefinitionHash) return 'outdated-definition'
    if (workbook && hasRevision && (workbook.pendingSync || workbook.cloudRevision > submittedRevision!)) return 'updated-after-submission'
    return 'submitted'
  }
  if (workbook && workbook.updatedAt > 0 && ((input.definitionVersion && workbook.definitionVersion !== input.definitionVersion)
      || (input.definitionHash && workbook.definitionHash !== input.definitionHash))) return 'outdated-draft'
  // Local text is only draft evidence. An absent/unloaded document is not proof of zero work.
  if (workbook && isAcademyPracticeArtifactComplete(workbook, requiredFieldIds)) return 'filled'
  if (!checked && (!workbook || workbook.updatedAt === 0)) return 'not-checked'
  return 'draft'
}

export const academyArtifactStatusLabel: Record<AcademyArtifactStatus, string> = {
  'outdated-draft': 'Nháp theo yêu cầu trước',
  'outdated-definition': 'Đã nộp phiên bản trước',
  'definition-not-loaded': 'Chưa tải tiêu chí chương',
  'not-checked': 'Chưa tải bản nháp', draft: 'Đang soạn', filled: 'Đã điền đủ, chưa nộp',
  submitted: 'Đã nộp', 'updated-after-submission': 'Đã nộp; có bản nháp mới',
}
