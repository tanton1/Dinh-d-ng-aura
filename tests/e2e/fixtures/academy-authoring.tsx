import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CourseEditorPage from '../../../src/pages/admin/CourseEditorPage'
import { CourseQuizRunner } from '../../../src/components/CourseLessonRuntime'
import type { CourseDraftInput } from '../../../src/types'
import '../../../src/styles.css'

const metadata: CourseDraftInput = {
  id: 'course-a', revision: 4, contentStorage: 'chapters-v1', publishedRevision: 3,
  title: 'Danh mục A', slug: 'course-a', description: 'Mô tả', category: 'Dinh dưỡng', level: 'Nền tảng', coach: 'Aura', duration: 'Tự học',
  outcomes: ['Hiểu'], requirements: ['Đọc'], publicationStatus: 'draft',
  settings: { accessTier: 'free', visibility: 'members', dripSchedule: 'none', completionPercent: 80, certificateEnabled: false },
  modules: [{ id: 'module', contentVersion: 'r1_fixture', title: 'Chương 1', order: 1,
    lessons: [{ id: 'reading', type: 'Bài đọc', title: 'Bài học', duration: '5 phút' }] }],
}

function AuthoringFixture() {
  const [catalog, setCatalog] = useState(new URLSearchParams(window.location.search).has('adoption')
    ? { ...metadata, id: 'course', revision: 1, publishedRevision: null } : metadata)
  return <>
    <button onClick={() => setCatalog((value) => ({ ...value, revision: (value.revision ?? 0) + 1, title: 'Danh mục cập nhật' }))}>Cập nhật danh mục</button>
    <button onClick={() => setCatalog({ ...metadata, id: 'course-b', title: 'Danh mục B' })}>Chuyển khóa B</button>
    <CourseEditorPage initialCourse={catalog} canPublish saveTarget="firebase" onNavigate={() => undefined}
      onSave={async (course) => {
        const response = await fetch('/__academy_authoring_write', { method: 'POST', body: JSON.stringify(course) })
        if (!response.ok) throw new Error('Lỗi lưu kiểm thử')
        return response.json()
      }} />
  </>
}

function QuizFixture() {
  const [version, setVersion] = useState('r1_fixture')
  const [completed, setCompleted] = useState<string[]>([])
  return <>
    <button onClick={() => setVersion('r2_fixture')}>Mở phiên bản mới</button>
    <output aria-label="Bản đã hoàn thành">{completed.join(',')}</output>
    <CourseQuizRunner courseId="course-a" lesson={{ id: 'quiz', contentVersion: version, title: 'Kiểm tra', type: 'Quiz', duration: '5 phút',
      quiz: { id: 'quiz', passPercent: 80, questions: [{ id: 'q1', question: 'Câu hỏi kiểm thử', options: ['Có bối cảnh', 'Bỏ qua bối cảnh'] }] } }}
      canSubmit demoMode={false} completed={false} onPassed={async () => setCompleted((values) => [...values, version])} />
  </>
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(window.location.search).has('quiz') ? <QuizFixture /> : <AuthoringFixture />)
