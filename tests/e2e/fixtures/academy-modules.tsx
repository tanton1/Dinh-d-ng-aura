import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CourseDetailPage from '../../../src/pages/student/CourseDetailPage'
import CoursesPage from '../../../src/pages/student/CoursesPage'
import { auraFoundationCourse } from '../../../src/course-template'
import type { Course } from '../../../src/types'
import '../../../src/styles.css'

const course = { ...auraFoundationCourse, id: 'academy-fixture', lessons: 60, progress: 0, modules: auraFoundationCourse.modules.map((module) => ({ ...module, lessons: module.lessons.map((lesson) => ({ ...lesson, ...(lesson.id.endsWith('-core') ? { resources: [{ id: 'pdf-fixture', title: 'Giáo trình kiểm thử', kind: 'document', url: 'https://aura-pdf-fixture.test/chapter.pdf' }] } : {}) })) })) } as unknown as Course
function Fixture() {
  const scenario = new URLSearchParams(window.location.search).get('scenario')
  const [loadError, setLoadError] = useState(scenario?.startsWith('error') ? 'internal' : null)
  const [lessonId, setLessonId] = useState('chapter-01-core')
  const [completed, setCompleted] = useState<string[]>([])
  if (scenario === 'error-catalog') return <CoursesPage courseItems={loadError ? [] : [course]} error={loadError} onRetry={() => setLoadError(null)} onOpenCourse={() => undefined} />
  return <CourseDetailPage course={loadError ? undefined : course} loadError={loadError} onRetry={() => setLoadError(null)} activeLessonId={lessonId} noteOwnerId="academy-fixture-owner" enrolled allowDemoContent onBack={() => undefined} onUpgrade={() => undefined} onEnroll={async () => undefined} onSelectLesson={setLessonId} progress={{ completedLessonIds: completed, percent: 0, lastLessonId: lessonId } as never} onComplete={async (_, id) => setCompleted((values) => [...values, id])} />
}
createRoot(document.getElementById('root')!).render(<Fixture />)
