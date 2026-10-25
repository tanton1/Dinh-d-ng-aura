import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CoursePrimaryContent, CourseResourceItem } from '../../../src/components/CourseLessonRuntime'
import type { CourseLessonDraft, LessonResourceDraft } from '../../../src/types'
import '../../../src/styles.css'

function Fixture() {
  const [owner, setOwner] = useState({ uid: 'media-a' })
  const [revision, setRevision] = useState(1)
  const [canAccess, setCanAccess] = useState(true)
  const [shown, setShown] = useState(true)
  const [refreshes, setRefreshes] = useState(0)
  const params = new URLSearchParams(location.search)
  ;(window as Window & { __mediaOwner?: { uid: string } }).__mediaOwner = owner
  const resource: LessonResourceDraft = { id: 'guide', title: 'Tài liệu kiểm thử', kind: params.has('video') ? 'video' : 'document', url: '',
    assetRef: { assetId: 'guide', status: 'ready', storagePath: 'course-media/course/lesson/guide.pdf', contentType: params.has('video') ? 'video/mp4' : 'application/pdf' } }
  const mediaAccess = { ownerId: owner.uid, courseRevision: revision, chapterVersion: `r${revision}_c1`, accessRevision: `${owner.uid}:${canAccess}`, authoringPreview: params.has('staff') }
  const lesson: CourseLessonDraft = { id: 'lesson', title: 'Bài học media', type: params.has('video') ? 'Video' : 'Bài đọc', duration: '5 phút',
    contentVersion: mediaAccess.chapterVersion, resources: [resource], primaryContent: { kind: 'resource', resourceId: resource.id } }
  return <main style={{ padding: 16, maxWidth: 900, margin: 'auto' }}>
    <nav aria-label="Điều khiển kiểm thử">
      <button onClick={() => setRevision((value) => value + 1)}>Đổi phiên bản</button>
      <button onClick={() => setOwner({ uid: 'media-b' })}>Đổi tài khoản</button>
      <button onClick={() => setCanAccess(false)}>Thu hồi quyền</button>
      <button onClick={() => setShown((value) => !value)}>Ẩn hiện tài liệu</button>
    </nav>
    <output aria-label="Số lần làm mới danh mục">{refreshes}</output>
    {shown && (params.has('pdf') || params.has('video')
      ? <CoursePrimaryContent courseId="course" lesson={lesson} canView={canAccess} lockedMessage="Nội dung đã khóa."
        mediaAccess={mediaAccess} onRefreshCourse={() => setRefreshes((value) => value + 1)} />
      : <>{Array.from({ length: params.has('twice') ? 2 : 1 }, (_, index) => <CourseResourceItem key={index}
        courseId="course" lessonId="lesson" resource={resource} canAccess={canAccess} mediaAccess={mediaAccess}
        onRefreshCourse={() => setRefreshes((value) => value + 1)} />)}</>)}
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
