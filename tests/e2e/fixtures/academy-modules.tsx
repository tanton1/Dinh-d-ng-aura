import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CourseDetailPage from '../../../src/pages/student/CourseDetailPage'
import CoursesPage from '../../../src/pages/student/CoursesPage'
import { auraFoundationCourse } from '../../../src/course-template'
import type { Course } from '../../../src/types'
import '../../../src/styles.css'
import AcademyLearningUnitReader from '../../../src/components/academy/AcademyLearningUnitReader'
import AcademyDraftReviewPanel from '../../../src/components/academy/AcademyDraftReviewPanel'
import { getAcademyLearningDraft } from '../../../content/academy/learning-drafts'
import AcademySubmissionPanel from '../../../src/components/academy/AcademySubmissionPanel'
import AcademyCoachReviewPanel from '../../../src/components/academy/AcademyCoachReviewPanel'
import AcademyPortfolioStudio from '../../../src/components/academy/AcademyPortfolioStudio'
import { loadAcademyWorkbook } from '../../../src/services/academyLearningService'

const course = { ...auraFoundationCourse, id: 'academy-fixture', lessons: 60, progress: 0, modules: auraFoundationCourse.modules.map((module) => ({ ...module, lessons: module.lessons.map((lesson) => ({ ...lesson, ...(lesson.id.endsWith('-core') ? { resources: [{ id: 'pdf-fixture', title: 'Giáo trình kiểm thử', kind: 'document', url: 'https://aura-pdf-fixture.test/chapter.pdf' }] } : {}) })) })) } as unknown as Course
if (new URLSearchParams(window.location.search).get('scenario') === 'practice-version') {
  const draft = getAcademyLearningDraft(1)!
  const design = course.modules![0].lessons[0].learningDesign!
  design.practice = { ...design.practice, version: 2, identityHash: 'a'.repeat(64),
    title: draft.unit.practice.title, outcome: draft.unit.practice.artifact,
    fields: draft.unit.practice.fields.map((field) => ({ ...field, kind: 'long' })),
    reviewRubric: { version: 2, criteria: draft.unit.practice.rubric },
  }
}
function Fixture() {
  const scenario = new URLSearchParams(window.location.search).get('scenario')
  const [loadError, setLoadError] = useState(scenario?.startsWith('error') ? 'internal' : null)
  const initialChapter = Math.max(1, Math.min(20, Number(new URLSearchParams(window.location.search).get('chapter')) || 1))
  const [lessonId, setLessonId] = useState(`chapter-${String(initialChapter).padStart(2, '0')}-core`)
  const [completed, setCompleted] = useState<string[]>(() => ['portfolio-evidence', 'practice-version'].includes(scenario ?? '') ? ['chapter-01-practice'] : [])
  if (scenario === 'submission-review') return <main style={{ padding: 16, background: '#fff' }}><AcademySubmissionPanel userId="academy-fixture-owner" courseId="academy-fixture" artifactId="chapter-01-core" currentWorkbookRevision={9} pendingDraft /></main>
  if (scenario === 'coach-review') return <main style={{ background: '#fff' }}><AcademyCoachReviewPanel clientId="academy-fixture-owner" clientName="Học viên kiểm thử" /></main>
  if (scenario === 'portfolio-submit') return <main style={{ padding: 16, background: '#fff' }}><AcademyPortfolioStudio chapter={5} ownerId="academy-fixture-owner" courseId="academy-fixture"
    lessons={course.modules!.flatMap((module) => module.lessons)} currentLessonId="chapter-05-core"
    currentWorkbook={loadAcademyWorkbook('academy-fixture-owner', 'academy-fixture', 'chapter-05-core')} canStudy
    completedLessonIds={Array.from({ length: 5 }, (_, index) => `chapter-0${index + 1}-practice`)}
    practiceSubmissionRevisions={Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`chapter-0${index + 1}-practice`, 1]))} /></main>
  if (scenario === 'pilot-review') return <main style={{ padding: '16px', background: '#fff' }}><AcademyLearningUnitReader key={initialChapter} packet={getAcademyLearningDraft(initialChapter)!} /></main>
  if (scenario === 'draft-selector') return <main style={{ padding: '16px', background: '#fff' }}><AcademyDraftReviewPanel /></main>
  if (scenario === 'error-catalog') return <CoursesPage courseItems={loadError ? [] : [course]} error={loadError} onRetry={() => setLoadError(null)} onOpenCourse={() => undefined} />
  return <CourseDetailPage course={loadError ? undefined : course} loadError={loadError} onRetry={() => setLoadError(null)} activeLessonId={lessonId} noteOwnerId="academy-fixture-owner" enrolled allowDemoContent onBack={() => undefined} onUpgrade={() => undefined} onEnroll={async () => undefined} onSelectLesson={setLessonId} progress={{ completedLessonIds: completed, percent: 0, lastLessonId: lessonId } as never} onComplete={async (_, id) => setCompleted((values) => [...values, id])} />
}
createRoot(document.getElementById('root')!).render(<Fixture />)
