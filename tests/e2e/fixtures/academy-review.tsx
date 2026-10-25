import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import AcademyLessonStudy from '../../../src/components/academy/AcademyLessonStudy'
import { useAcademyChapterDelivery } from '../../../src/features/academy/useAcademyChapterDelivery'
import type { Course } from '../../../src/types'
import '../../../src/styles.css'

const course: Course = { id: 'delivery', title: 'Khóa học theo chương', description: 'Ôn có giới hạn', category: 'Dinh dưỡng', level: 'Nền tảng', coach: 'Aura',
  lessons: 3, duration: 'Tự học', progress: 0, accent: 'purple', icon: 'nutrition', revision: 1, contentDelivery: 'catalog', contentStorage: 'chapters-v1',
  settings: { accessTier: 'free', visibility: 'members', completionPercent: 80, certificateEnabled: false, dripSchedule: 'none' },
  modules: [1, 2, 3].map((n) => ({ id: `module-${n}`, title: `Chương ${n}`, order: n, contentVersion: `r1_m${n}`,
    lessons: [{ id: `reading-${n}`, title: `Bài đọc ${n}`, type: 'Bài đọc', duration: '5 phút', preview: false, contentVersion: `r1_m${n}` }] })),
}
function Fixture() {
  const [owner, setOwner] = useState({ uid: 'student-a' })
  const [lessonId, setLessonId] = useState('reading-1')
  const [enrolled, setEnrolled] = useState(true)
  ;(window as Window & { __academyOwner?: { uid: string } }).__academyOwner = owner
  const delivery = useAcademyChapterDelivery({ course, lessonId, ownerId: owner.uid, accessRevision: `${owner.uid}:${enrolled}`,
    enrolled, accessLocked: false, previewMode: false, demoMode: false, loading: false })
  const lesson = delivery.loadedLessons.find((item) => item.id === lessonId)
  return <main style={{ width: '100%', maxWidth: 800, padding: 16, margin: '0 auto' }}>
    <nav aria-label="Điều khiển kiểm thử">
      {[1, 2, 3].map((n) => <button key={n} onClick={() => setLessonId(`reading-${n}`)}>Mở chương {n}</button>)}
      <button onClick={() => setOwner({ uid: 'student-b' })}>Đổi tài khoản</button>
      <button onClick={() => setEnrolled(false)}>Hủy ghi danh</button>
    </nav>
    {delivery.error ? <div role="alert">Chưa tải được chương.<button onClick={delivery.retry}>Thử lại chương</button></div>
      : delivery.loading ? <p role="status">Đang tải chương…</p>
      : lesson ? <AcademyLessonStudy key={`${owner.uid}:${lesson.id}:${lesson.contentVersion}`} ownerId={owner.uid} courseId="delivery"
        lesson={lesson} reviewLessons={delivery.loadedLessons} canReview={enrolled} reviewScopeKey="r1" loadReviewLessons={delivery.prepareReview} />
      : <p>Chưa có quyền học.</p>}
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
