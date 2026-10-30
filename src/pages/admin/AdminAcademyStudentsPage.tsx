import '../../styles-admin.css'
import { AlertCircle, BookOpen, CheckCircle2, GraduationCap, LoaderCircle, Mail, Search, UserPlus, Users, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../../components/ui'
import type { AdminUserRecord, Course, Enrollment } from '../../types'
import { useAuth } from '../../contexts/AuthContext'
import { listAcademyEnrollmentsPage } from '../../services/scopedReportingService'
import '../../styles-academy.css'

interface Props {
  users: AdminUserRecord[]
  courses: Course[]
  enrollments?: Enrollment[]
  loading?: boolean
  onManage: (input: { email: string; courseId: string; action: 'assign' | 'cancel' }) => Promise<void>
}

export default function AdminAcademyStudentsPage(props: Props) {
  const { user, profile, backendMode } = useAuth()
  return <AcademyEnrollmentWorkspace key={JSON.stringify([user?.uid, profile?.authzVersion, profile?.role, profile?.disabled])} {...props} remote={backendMode === 'firebase'} />
}

function AcademyEnrollmentWorkspace({ users: initialUsers, courses, enrollments: initialEnrollments = [], loading: parentLoading = false, onManage, remote }: Props & { remote: boolean }) {
  const [users, setUsers] = useState(initialUsers)
  const [enrollments, setEnrollments] = useState(initialEnrollments)
  const [pageLoading, setPageLoading] = useState(remote)
  const [pageError, setPageError] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const sequence = useRef(0)
  const busy = useRef(false)
  const alive = useRef(true)
  const mutationRunning = useRef(false)
  const loading = parentLoading || pageLoading
  const load = async (append = false) => {
    if (!remote || busy.current || !alive.current) return
    busy.current = true
    const request = ++sequence.current
    setPageLoading(true); setPageError('')
    if (!append) { setEnrollments([]); setUsers([]); setCursor(null); setHasMore(false) }
    try {
      const page = await listAcademyEnrollmentsPage(append ? cursor : null)
      if (sequence.current !== request) return
      setEnrollments(current => [...new Map([...(append ? current : []), ...page.enrollments].map(item => [item.id, item])).values()])
      setUsers(current => [...new Map([...(append ? current : []), ...page.users].map(item => [item.uid, item])).values()])
      setCursor(page.nextCursor); setHasMore(page.hasMore)
    } catch (error) {
      if (sequence.current === request) setPageError(error instanceof Error ? error.message : 'Chưa tải được ghi danh. Hãy thử lại.')
    } finally { if (sequence.current === request) { setPageLoading(false); busy.current = false } }
  }
  useEffect(() => {
    alive.current = true
    busy.current = false
    void load()
    return () => { alive.current = false; sequence.current++; busy.current = false }
    // The parent keys this workspace by identity/authority; never reuse a page across accounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote])
  const publishedCourses = courses.filter((course) => course.publicationStatus === 'published')
  const [email, setEmail] = useState('')
  const [courseId, setCourseId] = useState('')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const usersById = useMemo(() => new Map(users.map((user) => [user.uid, user])), [users])
  const coursesById = useMemo(() => new Map(courses.map((course) => [String(course.id), course])), [courses])
  const visibleEnrollments = useMemo(() => enrollments
    .filter((enrollment) => enrollment.status === 'active' || enrollment.status === 'completed')
    .filter((enrollment) => {
      const user = usersById.get(enrollment.userId)
      const course = coursesById.get(enrollment.courseId)
      const normalized = query.trim().toLocaleLowerCase('vi')
      return !normalized || `${user?.displayName ?? ''} ${user?.email ?? ''} ${course?.title ?? ''}`.toLocaleLowerCase('vi').includes(normalized)
    }), [coursesById, enrollments, query, usersById])

  const manage = async (targetEmail: string, targetCourseId: string, action: 'assign' | 'cancel') => {
    if (!alive.current || busy.current || mutationRunning.current) return
    mutationRunning.current = true
    const operationId = `${targetEmail}:${targetCourseId}:${action}`
    setSaving(operationId)
    setMessage(null)
    try {
      await onManage({ email: targetEmail, courseId: targetCourseId, action })
      if (!alive.current) return
      await load()
      if (!alive.current) return
      setMessage({ tone: 'success', text: action === 'assign' ? 'Đã gán khóa học cho học viên.' : 'Đã hủy quyền truy cập khóa học.' })
      if (action === 'assign') setEmail('')
    } catch (caught) {
      if (alive.current) setMessage({ tone: 'error', text: caught instanceof Error ? caught.message : 'Không thể cập nhật ghi danh.' })
    } finally {
      mutationRunning.current = false
      if (alive.current) setSaving(null)
    }
  }

  return (
    <div className="page academy-enrollment-page">
      <PageHeader eyebrow="AURA ACADEMY · HỌC VIÊN" title="Ghi danh khóa học" description="Gán khóa học riêng tư, kiểm soát quyền truy cập và theo dõi danh sách học viên độc lập với khách hàng PT Coaching." />

      <section className="card academy-enrollment-create">
        <div><span className="stat-icon purple"><UserPlus size={20} /></span><span><strong>Gán khóa học cho tài khoản Aura</strong><small>Học viên phải có đúng gói thành viên nếu khóa học yêu cầu Aura Pro.</small></span></div>
        <label><span>Email học viên</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="hocvien@example.com" /></label>
        <label><span>Khóa học đã xuất bản</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">Chọn khóa học</option>{publishedCourses.map((course) => <option key={course.id} value={String(course.id)}>{course.title}{course.settings?.visibility === 'private' ? ' · Riêng tư' : ''}</option>)}</select></label>
        <button className="primary-button" disabled={!email.trim() || !courseId || Boolean(saving) || pageLoading} onClick={() => void manage(email, courseId, 'assign')}>{saving?.endsWith(':assign') ? <LoaderCircle className="spin" size={17} /> : <GraduationCap size={17} />} Gán khóa học</button>
      </section>

      {message && <div className={message.tone === 'success' ? 'academy-enrollment-message success' : 'academy-enrollment-message error'} role={message.tone === 'error' ? 'alert' : 'status'}>{message.tone === 'success' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}{message.text}</div>}

      {pageError && <div className="academy-enrollment-message error" role="alert">{pageError}<button className="outline-button" disabled={pageLoading || Boolean(saving)} onClick={() => void load()}>Thử lại</button></div>}
      <div className="admin-list-toolbar"><div className="course-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm trong ghi danh đã tải..." /></div><span className="status-badge published"><Users size={14} /> {visibleEnrollments.length} ghi danh hoạt động đã tải</span><button className="outline-button" disabled={pageLoading || Boolean(saving)} onClick={() => void load()}>Làm mới</button></div>
      {hasMore && <p role="status">Danh sách còn trang tiếp theo. Tìm kiếm áp dụng cho các ghi danh đã tải.</p>}

      <section className="card academy-enrollment-list" aria-busy={loading}>
        <div className="academy-enrollment-row head"><span>HỌC VIÊN</span><span>KHÓA HỌC</span><span>TRẠNG THÁI</span><span /></div>
        {loading && !enrollments.length ? <div className="empty-state"><LoaderCircle className="spin" size={28} /><h3>Đang tải ghi danh</h3></div>
          : visibleEnrollments.length ? visibleEnrollments.map((enrollment) => {
            const user = usersById.get(enrollment.userId)
            const course = coursesById.get(enrollment.courseId)
            const targetEmail = user?.email ?? ''
            const operationId = `${targetEmail}:${enrollment.courseId}:cancel`
            return <article className="academy-enrollment-row" key={enrollment.id}><span><i><Mail size={16} /></i><span><strong>{user?.displayName || targetEmail || enrollment.userId}</strong><small>{targetEmail || enrollment.userId}</small></span></span><span><i><BookOpen size={16} /></i><span><strong>{course?.title || enrollment.courseId}</strong><small>{course?.settings?.visibility === 'private' ? 'Khóa học riêng tư' : 'Thành viên Academy'}</small></span></span><span><b className={`status-badge ${enrollment.status === 'completed' ? 'published' : 'review'}`}>{enrollment.status === 'completed' ? 'Đã hoàn thành' : 'Đang học'}</b></span><span><button className="outline-button danger" disabled={!targetEmail || Boolean(saving) || pageLoading} onClick={() => void manage(targetEmail, enrollment.courseId, 'cancel')}>{saving === operationId ? <LoaderCircle className="spin" size={15} /> : <XCircle size={15} />} Hủy ghi danh</button></span></article>
          }) : !pageError && <div className="empty-state"><GraduationCap size={29} /><h3>Chưa có ghi danh phù hợp trong dữ liệu đã tải</h3><p>{hasMore ? 'Tải trang tiếp theo để xem các ghi danh khác.' : 'Gán khóa học bằng email để bắt đầu quản lý học viên Academy.'}</p></div>}
      </section>
      {hasMore && <button className="outline-button" disabled={pageLoading || Boolean(saving)} onClick={() => void load(true)}>{pageLoading ? 'Đang tải…' : 'Tải thêm ghi danh'}</button>}
    </div>
  )
}
