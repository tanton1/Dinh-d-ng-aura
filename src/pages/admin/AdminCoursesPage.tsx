import { AlertCircle, BookOpen, CheckCircle2, Clock3, Eye, Filter, LoaderCircle, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Star, TrendingUp, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Course, CourseAnalytics, PublicationStatus } from '../../types'
import { ProgressBar } from '../../components/ui'

interface AdminCoursesPageProps {
  courseItems?: Course[]
  analytics?: CourseAnalytics[]
  canCreate: boolean
  canEdit: boolean
  onCreate: () => void
  onEdit: (courseId: string) => void
  onRetry?: () => void
  onView?: (courseId: string) => void
  onOpenActions?: (courseId: string) => void
  loading?: boolean
  error?: string | null
  initialQuery?: string
}

type SortKey = 'title' | 'learners' | 'completion' | 'updated'

type CourseAdminRow = {
  id: string
  title: string
  lessons: number
  duration: string
  learners: number | null
  completion: number | null
  rating: number | null
  status: PublicationStatus
  statusLabel: string
  schemaVersion?: 2
  updatedAt: string
  updatedRaw?: unknown
}

const statusLabels: Record<PublicationStatus, string> = {
  published: 'Đã xuất bản',
  review: 'Chờ duyệt',
  scheduled: 'Đã lên lịch',
  archived: 'Đã lưu trữ',
  draft: 'Bản nháp',
}

const allStatusLabel = 'Tất cả'
const statusTabs = [allStatusLabel, ...Object.values(statusLabels)]

function formatUpdatedAt(value: unknown) {
  if (!value) return 'Chưa có dữ liệu'

  const date = value instanceof Date
    ? value
    : typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function'
      ? value.toDate()
      : new Date(value as string | number)

  return Number.isNaN(date.getTime())
    ? 'Chưa có dữ liệu'
    : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function getStatusTone(status: PublicationStatus) {
  if (status === 'published') return 'published'
  if (status === 'draft') return 'draft'
  return 'attention'
}

function formatRating(value: number | null) {
  if (value === null) return '—'
  if (!Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}

export default function AdminCoursesPage({
  courseItems,
  analytics,
  canCreate,
  canEdit,
  onCreate,
  onEdit,
  loading = false,
  error = null,
  onRetry,
  onView,
  onOpenActions,
  initialQuery = '',
}: AdminCoursesPageProps) {
  const [query, setQuery] = useState('')
  const [selectedTab, setSelectedTab] = useState(allStatusLabel)
  const [sortBy, setSortBy] = useState<SortKey>('updated')

  useEffect(() => setQuery(initialQuery), [initialQuery])

  const analyticsByCourseId = useMemo(() => {
    const map = new Map<string, CourseAnalytics>()
    for (const item of analytics ?? []) {
      map.set(item.courseId, item)
    }
    return map
  }, [analytics])

  const rows: CourseAdminRow[] = useMemo(() => (courseItems ?? []).map((course) => {
    const courseId = String(course.id)
    const report = analyticsByCourseId.get(courseId)
    const publicationStatus: PublicationStatus = course.publicationStatus ?? 'draft'
    return {
      id: courseId,
      title: course.title,
      lessons: course.lessons,
      duration: course.duration,
      learners: report ? report.learners : null,
      completion: report ? report.averageCompletion : null,
      rating: report ? report.rating : null,
      status: publicationStatus,
      statusLabel: statusLabels[publicationStatus],
      schemaVersion: course.schemaVersion,
      updatedAt: formatUpdatedAt(report?.updatedAt ?? course.updatedAt),
      updatedRaw: report?.updatedAt ?? course.updatedAt,
    }
  }), [courseItems, analyticsByCourseId])

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    let list = rows
      .filter((course) => {
        const matchText = `${course.title} ${course.lessons} ${course.duration}`
          .toLowerCase().includes(normalizedQuery)
        const matchStatus = selectedTab === allStatusLabel || course.statusLabel === selectedTab
        return matchText && matchStatus
      })

    list = [...list].sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title, 'vi')
      if (sortBy === 'learners') {
        const aValue = a.learners ?? 0
        const bValue = b.learners ?? 0
        return bValue - aValue
      }
      if (sortBy === 'completion') {
        const aValue = a.completion ?? 0
        const bValue = b.completion ?? 0
        return bValue - aValue
      }
      const toDateMs = (value: unknown) => {
        if (!value) return 0
        if (value instanceof Date) return value.getTime()
        if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
          const next = value.toDate()
          return next.getTime()
        }
        const next = new Date(value as string | number)
        return Number.isNaN(next.getTime()) ? 0 : next.getTime()
      }
      return toDateMs(b.updatedRaw) - toDateMs(a.updatedRaw)
    })

    return list
  }, [query, rows, selectedTab, sortBy])

  const hasActiveFilters = Boolean(query.trim()) || selectedTab !== allStatusLabel

  const totals = useMemo(() => ({
    total: rows.length,
    published: rows.filter((course) => course.status === 'published').length,
    draft: rows.filter((course) => course.status === 'draft').length,
    pending: rows.filter((course) => course.status === 'review').length,
    learners: rows.reduce((sum, course) => sum + (course.learners ?? 0), 0),
    avgCompletion: rows.length
      ? Math.round(rows.reduce((sum, course) => sum + (course.completion ?? 0), 0) / rows.length)
      : 0,
  }), [rows])

  return (
    <div className="page admin-courses-page">
      <div className="admin-hero-header text-white">
        <div className="admin-hero-header-bg">
           <svg width="300" height="300" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="50" fill="white"/></svg>
        </div>
        <div className="admin-hero-header-content text-white">
          <span className="admin-hero-eyebrow text-white">
            Aura Academy · Quản lý nội dung
          </span>
          <h1 className="admin-hero-title text-white">Khóa học & Đào tạo</h1>
          <p className="admin-hero-desc text-white">
            Xây dựng lộ trình chuyên sâu, thiết kế bài giảng, câu hỏi trắc nghiệm và cấp chứng nhận học tập cho hội viên Aura Fitness.
          </p>
        </div>
        {canCreate && (
          <div className="admin-hero-action">
            <button className="admin-hero-btn" onClick={onCreate}>
              <Plus size={18} />
              <span>Tạo khóa học mới</span>
            </button>
          </div>
        )}
      </div>

      <div className="admin-kpi-grid" style={{ marginBottom: 24 }}>
        <article className="admin-kpi">
          <div className="admin-kpi__icon gradient-pink-orange"><BookOpen size={16} /></div>
          <div><span>TỔNG KHÓA HỌC</span><strong>{totals.total}</strong><small><TrendingUp size={10} /> Trong hệ thống</small></div>
        </article>
        
        <article className="admin-kpi">
          <div className="admin-kpi__icon gradient-pink-orange"><Users size={16} /></div>
          <div><span>HỌC VIÊN GHI DANH</span><strong>{totals.learners}</strong><small>Lượt hoạt động</small></div>
        </article>

        <article className="admin-kpi">
          <div className="admin-kpi__icon gradient-pink-orange"><CheckCircle2 size={16} /></div>
          <div><span>HOÀN THÀNH TB</span><strong>{totals.avgCompletion}%</strong><small>Toàn bộ khóa học</small></div>
        </article>

        <article className="admin-kpi">
          <div className="admin-kpi__icon gradient-pink-orange"><Clock3 size={16} /></div>
          <div><span>CHỜ DUYỆT / NHÁP</span><strong>{totals.pending + totals.draft}</strong><small>{totals.pending} chờ duyệt, {totals.draft} nháp</small></div>
        </article>
      </div>

      <div className="admin-list-toolbar">
        <div className="segmented-tabs admin-tabs">{statusTabs.map((item) => (
          <button
            key={item}
            className={selectedTab === item ? 'active' : ''}
            onClick={() => setSelectedTab(item)}
          >
            {item}
            <span>{item === allStatusLabel ? rows.length : rows.filter((course) => course.statusLabel === item).length}</span>
          </button>
        ))}</div>
        <div className="toolbar-spacer" />
        <div className="course-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm khóa học..." /></div>
        <label className="filter-button" style={{ border: 0, background: 'transparent', gap: 6 }}>
          <Filter size={14} />
          <span>Sắp xếp</span>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortKey)}
            style={{ border: 0, outline: 0, background: 'transparent', color: 'var(--ink)', fontWeight: 750 }}
          >
            <option value="updated">Mới nhất</option>
            <option value="title">Tên</option>
            <option value="learners">Học viên</option>
            <option value="completion">Tỷ lệ hoàn thành</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="empty-state card" role="status" aria-live="polite"><LoaderCircle size={30} className="spin" /><h3>Đang tải khóa học</h3><p>Danh sách đang được đồng bộ từ Firebase.</p></div>
      ) : error ? (
        <div className="empty-state card" role="alert"><AlertCircle size={30} /><h3>Không thể tải danh sách</h3><p>{error}</p>{onRetry && <button className="outline-button" onClick={onRetry}><RefreshCw size={16} /> Thử lại</button>}</div>
      ) : rows.length === 0 ? (
        <div className="empty-state card"><BookOpen size={30} /><h3>{courseItems ? 'Chưa có khóa học' : 'Chưa nhận được dữ liệu khóa học'}</h3><p>{courseItems ? 'Tạo khóa học đầu tiên để bắt đầu xây dựng thư viện Aura Fitness.' : 'Firebase chưa trả dữ liệu. Hãy thử tải lại hoặc kiểm tra kết nối.'}</p>{canCreate && <button className="primary-button" onClick={onCreate}><Plus size={17} /> Tạo khóa học</button>}</div>
      ) : (
        <>
          <div className="admin-course-list">
            <div className="admin-course-list__head"><span>KHÓA HỌC</span><span>HỌC VIÊN</span><span>TIẾN ĐỘ TB.</span><span>ĐÁNH GIÁ</span><span>TRẠNG THÁI</span><span>CẬP NHẬT</span><span /></div>
            {filteredRows.map((course, index) => (
              <article className="admin-course-row" key={course.id}>
                <div className="admin-course-title"><span className={`admin-course-thumb ${index % 2 === 0 ? 'green' : 'purple'}`}><BookOpen size={22} /></span><span><strong>{course.title}</strong><small>{course.lessons} bài · {course.duration}{course.schemaVersion !== 2 ? ' · Cần mở và lưu lại để nâng cấp V2' : ' · Dữ liệu V2'}</small></span></div>
                <span className="list-metric"><Users size={15} /> {course.learners ?? '—'}</span>
                <span className="list-progress"><ProgressBar value={course.completion ?? 0} tone={index % 4 === 1 ? 'green' : index % 4 === 2 ? 'orange' : index % 4 === 3 ? 'pink' : 'purple'} /><small>{course.completion === null ? '—' : `${course.completion}%`}</small></span>
                <span className="rating"><Star size={15} fill="currentColor" /> {formatRating(course.rating)}</span>
                <span><i className={`status-badge ${getStatusTone(course.status)}`}>{getStatusTone(course.status) === 'published' ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}{course.statusLabel}</i></span>
                <span className="updated-time">{course.updatedAt}</span>
                <div className="row-actions">{onView && <button title="Xem" onClick={() => onView(course.id)}><Eye size={17} /></button>}<button title={canEdit ? 'Sửa' : 'Bạn chưa có quyền sửa'} disabled={!canEdit} onClick={() => onEdit(course.id)}><Pencil size={17} /></button>{onOpenActions && <button title="Thao tác khác" onClick={() => onOpenActions(course.id)}><MoreHorizontal size={17} /></button>}</div>
              </article>
            ))}
          </div>
          {filteredRows.length === 0 && hasActiveFilters && <div className="empty-state"><Filter size={30} /><h3>Không có khóa học phù hợp</h3><p>Hãy thay đổi từ khóa hoặc bộ lọc.</p></div>}
        </>
      )}
    </div>
  )
}
