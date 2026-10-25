import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import CourseDetailPage from '../../../src/pages/student/CourseDetailPage'
import type { Course, CourseProgress } from '../../../src/types'
import '../../../src/styles.css'

function Fixture() {
  const [course, setCourse] = useState<Course>()
  const [owner, setOwner] = useState({ uid: 'student' })
  const [enrolled, setEnrolled] = useState(true)
  const [open, setOpen] = useState(true)
  const [lesson, setLesson] = useState('chapter-05-core')
  const [refreshes, setRefreshes] = useState(0)
  const [progress, setProgress] = useState<CourseProgress>({ courseId: 'course', percent: 0,
    completedLessonIds: [...Array.from({ length: 5 }, (_, i) => `chapter-0${i + 1}-practice`), 'chapter-05-checkpoint'],
    lastLessonId: 'chapter-05-core' })
  ;(window as Window & { __academyOwner?: { uid: string } }).__academyOwner = owner
  const refresh = () => { setRefreshes((value) => value + 1); void fetch('/__learner_catalog').then((response) => response.json()).then(setCourse) }
  useEffect(() => { refresh() }, [])
  return <><nav aria-label="Điều khiển kiểm thử" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    {Array.from({ length: 20 }, (_, i) => <button key={i} onClick={() => setLesson(`chapter-${String(i + 1).padStart(2, '0')}-core`)}>Mở chương {i + 1}</button>)}
    <button onClick={() => setOwner({ uid: 'student-b' })}>Đổi tài khoản</button>
    <button onClick={() => setEnrolled(false)}>Hủy ghi danh</button>
    <button onClick={refresh}>Tải danh mục mới</button>
    <button onClick={() => setOpen(false)}>Rời khóa học</button>
  </nav><output aria-label="Lượt tải danh mục">{refreshes}</output>
    {open ? <CourseDetailPage course={course} loading={!course} enrolled={enrolled} noteOwnerId={owner.uid}
      accessRevision={`${owner.uid}:${enrolled}`} activeLessonId={lesson} progress={progress}
      onRetry={refresh} onBack={() => undefined} onUpgrade={() => undefined} onEnroll={async () => undefined} onSelectLesson={setLesson}
      onComplete={async (_course, id, _workout, _practice, version) => setProgress((current) => ({ ...current,
        completedLessonIds: [...new Set([...current.completedLessonIds, id])],
        quizCompletionChapterVersions: { ...current.quizCompletionChapterVersions, [id]: version ?? '' } }))} /> : <p>Đã rời khóa học</p>}
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
