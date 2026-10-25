import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CourseDetailPage from '../../../src/pages/student/CourseDetailPage'
import type { Course } from '../../../src/types'
import '../../../src/styles.css'

const base: Course = { id: 'delivery', title: 'Khóa học theo chương', description: 'Kiểm thử đọc có giới hạn', category: 'Dinh dưỡng', level: 'Nền tảng', coach: 'Aura',
  lessons: 3, duration: 'Tự học', progress: 0, accent: 'purple', icon: 'nutrition', schemaVersion: 2, revision: 1,
  publicationStatus: 'published', contentStorage: 'chapters-v1', contentDelivery: 'catalog', contentAccess: 'full',
  settings: { accessTier: 'free', visibility: 'members', completionPercent: 80, certificateEnabled: false, dripSchedule: 'none' },
  modules: [1, 2, 3].map((n) => ({ id: `module-${n}`, title: `Chương ${n}`, order: n, contentVersion: `r1_m${n}`,
    lessons: [{ id: `reading-${n}`, title: `Bài đọc ${n}`, type: 'Bài đọc', duration: '5 phút', preview: n === 1, contentVersion: `r1_m${n}` }] })),
}
function Fixture() {
  const params = new URLSearchParams(window.location.search)
  const [course, setCourse] = useState<Course>(() => params.has('preview-second') ? { ...base,
    settings: { ...base.settings!, visibility: params.has('private') ? 'private' : 'members' },
    modules: base.modules!.map((module, index) => index ? module : { ...module,
      lessons: [{ id: 'hidden', title: 'Bài chưa mở', type: 'Bài đọc', duration: '5 phút', preview: false, contentVersion: module.contentVersion }, ...module.lessons] }),
  } : base)
  const [owner, setOwner] = useState({ uid: 'student-a' })
  const [enrolled, setEnrolled] = useState(!params.has('preview-second'))
  const [lesson, setLesson] = useState('reading-1')
  const [completed, setCompleted] = useState('')
  const [refreshes, setRefreshes] = useState(0)
  ;(window as Window & { __academyOwner?: { uid: string } }).__academyOwner = owner
  const preview = new URLSearchParams(window.location.search).has('staff')
  return <>
    <nav aria-label="Điều khiển kiểm thử">
      {[1, 2, 3].map((n) => <button key={n} onClick={() => setLesson(`reading-${n}`)}>Mở chương {n}</button>)}
      <button onClick={() => setCourse((current) => ({ ...current, revision: current.revision! + 1,
        modules: current.modules!.map((module, index) => index === 0 ? { ...module, contentVersion: 'r2_m1', lessons: module.lessons.map((item) => ({ ...item, contentVersion: 'r2_m1' })) } : module) }))}>Xuất bản chương mới</button>
      <button onClick={() => setEnrolled(false)}>Hủy ghi danh</button>
      <button onClick={() => setOwner({ uid: 'student-b' })}>Đổi tài khoản</button>
    </nav>
    <output aria-label="Bản hoàn thành">{completed}</output><output aria-label="Số lần tải danh mục">{refreshes}</output>
    <CourseDetailPage course={course} enrolled={enrolled} noteOwnerId={owner.uid} activeLessonId={lesson}
      previewMode={preview} accessRevision={`${owner.uid}:${enrolled ? 'active' : 'cancelled'}`}
      onBack={() => undefined} onUpgrade={() => undefined} onEnroll={async () => undefined} onSelectLesson={setLesson}
      onRetry={() => setRefreshes((value) => value + 1)}
      onComplete={async (_course, _lesson, _workout, _practice, version) => setCompleted(version ?? 'missing-version')} />
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
