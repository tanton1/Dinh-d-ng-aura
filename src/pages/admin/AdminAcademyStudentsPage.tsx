import { AlertCircle, BookOpen, CheckCircle2, GraduationCap, LoaderCircle, Mail, Search, UserPlus, Users, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../../components/ui'
import type { AdminUserRecord, Course, Enrollment } from '../../types'
import '../../styles-academy.css'

interface Props {
  users: AdminUserRecord[]
  courses: Course[]
  enrollments: Enrollment[]
  loading?: boolean
  onManage: (input: { email: string; courseId: string; action: 'assign' | 'cancel' }) => Promise<void>
}

export default function AdminAcademyStudentsPage({ users, courses, enrollments, loading = false, onManage }: Props) {
  const publishedCourses = courses.filter((course) => course.publicationStatus === 'published')
  const [email, setEmail] = useState('')
  const [courseId, setCourseId] = useState('')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const usersById = useMemo(() => new Map(users.map((user) => [user.uid, user])), [users])
  const coursesById = useMemo(() => new Map(courses.map((course) => [String(course.id), course])), [courses])
  const visibleEnrollments = useMemo(() => enrollments
    .filter((enrollment) => enrollment.status !== 'cancelled')
    .filter((enrollment) => {
      const user = usersById.get(enrollment.userId)
      const course = coursesById.get(enrollment.courseId)
      const normalized = query.trim().toLocaleLowerCase('vi')
      return !normalized || `${user?.displayName ?? ''} ${user?.email ?? ''} ${course?.title ?? ''}`.toLocaleLowerCase('vi').includes(normalized)
    }), [coursesById, enrollments, query, usersById])

  const manage = async (targetEmail: string, targetCourseId: string, action: 'assign' | 'cancel') => {
    const operationId = `${targetEmail}:${targetCourseId}:${action}`
    setSaving(operationId)
    setMessage(null)
    try {
      await onManage({ email: targetEmail, courseId: targetCourseId, action })
      setMessage({ tone: 'success', text: action === 'assign' ? 'Đã gán khóa học cho học viên.' : 'Đã hủy quyền truy cập khóa học.' })
      if (action === 'assign') setEmail('')
    } catch (caught) {
      setMessage({ tone: 'error', text: caught instanceof Error ? caught.message : 'Không thể cập nhật ghi danh.' })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="page academy-enrollment-page">
      <PageHeader eyebrow="AURA ACADEMY · HỌC VIÊN" title="Ghi danh khóa học" description="Gán khóa học riêng tư, kiểm soát quyền truy cập và theo dõi danh sách học viên độc lập với khách hàng PT Coaching." />

      <section className="card academy-enrollment-create">
        <div><span className="stat-icon purple"><UserPlus size={20} /></span><span><strong>Gán khóa học cho tài khoản Aura</strong><small>Học viên phải có đúng gói thành viên nếu khóa học yêu cầu Aura Pro.</small></span></div>
        <label><span>Email học viên</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="hocvien@example.com" /></label>
        <label><span>Khóa học đã xuất bản</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">Chọn khóa học</option>{publishedCourses.map((course) => <option key={course.id} value={String(course.id)}>{course.title}{course.settings?.visibility === 'private' ? ' · Riêng tư' : ''}</option>)}</select></label>
        <button className="primary-button" disabled={!email.trim() || !courseId || Boolean(saving)} onClick={() => void manage(email, courseId, 'assign')}>{saving?.endsWith(':assign') ? <LoaderCircle className="spin" size={17} /> : <GraduationCap size={17} />} Gán khóa học</button>
      </section>

      {message && <div className={message.tone === 'success' ? 'academy-enrollment-message success' : 'academy-enrollment-message error'} role={message.tone === 'error' ? 'alert' : 'status'}>{message.tone === 'success' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}{message.text}</div>}

      <div className="admin-list-toolbar"><div className="course-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm học viên hoặc khóa học..." /></div><span className="status-badge published"><Users size={14} /> {visibleEnrollments.length} ghi danh hoạt động</span></div>

      <section className="card academy-enrollment-list" aria-busy={loading}>
        <div className="academy-enrollment-row head"><span>HỌC VIÊN</span><span>KHÓA HỌC</span><span>TRẠNG THÁI</span><span /></div>
        {loading ? <div className="empty-state"><LoaderCircle className="spin" size={28} /><h3>Đang tải ghi danh</h3></div>
          : visibleEnrollments.length ? visibleEnrollments.map((enrollment) => {
            const user = usersById.get(enrollment.userId)
            const course = coursesById.get(enrollment.courseId)
            const targetEmail = user?.email ?? ''
            const operationId = `${targetEmail}:${enrollment.courseId}:cancel`
            return <article className="academy-enrollment-row" key={enrollment.id}><span><i><Mail size={16} /></i><span><strong>{user?.displayName || targetEmail || enrollment.userId}</strong><small>{targetEmail || enrollment.userId}</small></span></span><span><i><BookOpen size={16} /></i><span><strong>{course?.title || enrollment.courseId}</strong><small>{course?.settings?.visibility === 'private' ? 'Khóa học riêng tư' : 'Thành viên Academy'}</small></span></span><span><b className={`status-badge ${enrollment.status === 'completed' ? 'published' : 'review'}`}>{enrollment.status === 'completed' ? 'Đã hoàn thành' : 'Đang học'}</b></span><span><button className="outline-button danger" disabled={!targetEmail || Boolean(saving)} onClick={() => void manage(targetEmail, enrollment.courseId, 'cancel')}>{saving === operationId ? <LoaderCircle className="spin" size={15} /> : <XCircle size={15} />} Hủy ghi danh</button></span></article>
          }) : <div className="empty-state"><GraduationCap size={29} /><h3>Chưa có ghi danh phù hợp</h3><p>Gán khóa học bằng email để bắt đầu quản lý học viên Academy.</p></div>}
      </section>
    </div>
  )
}
