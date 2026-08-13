import '../../styles-admin.css'
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock3,
  Eye,
  Filter,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  TrendingUp,
  Users,
  X,
} from 'lucide-react'
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
type CourseTab = 'all' | 'attention' | PublicationStatus
type AccessFilter = 'all' | 'free' | 'pro' | 'legacy'

type CourseAdminRow = {
  id: string
  title: string
  description: string
  category: string
  level: string
  coach: string
  lessons: number
  duration: string
  learners: number | null
  completion: number | null
  rating: number | null
  status: PublicationStatus
  statusLabel: string
  accessTier: 'free' | 'pro' | null
  schemaVersion?: 2
  updatedAt: string
  updatedRaw?: unknown
  needsAttention: boolean
}

const statusLabels: Record<PublicationStatus, string> = {
  draft: 'Bản nháp',
  review: 'Chờ duyệt',
  scheduled: 'Đã lên lịch',
  published: 'Đã xuất bản',
  archived: 'Lưu trữ',
}

const statusTabs: Array<{ key: CourseTab; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'attention', label: 'Cần xử lý' },
  { key: 'draft', label: statusLabels.draft },
  { key: 'review', label: statusLabels.review },
  { key: 'scheduled', label: statusLabels.scheduled },
  { key: 'published', label: statusLabels.published },
  { key: 'archived', label: statusLabels.archived },
]

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

function toDateMs(value: unknown) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().getTime()
  }
  const next = new Date(value as string | number)
  return Number.isNaN(next.getTime()) ? 0 : next.getTime()
}

function getStatusTone(status: PublicationStatus) {
  if (status === 'published') return 'published'
  if (status === 'draft' || status === 'archived') return 'draft'
  return 'attention'
}

function formatRating(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}

function getAttentionReason(course: CourseAdminRow) {
  if (course.schemaVersion !== 2) return 'Cần mở và lưu lại để nâng cấp dữ liệu V2'
  if (!course.title.trim() || !course.coach.trim()) return 'Thiếu thông tin khóa học hoặc giảng viên'
  if (course.lessons === 0) return 'Chưa có bài học'
  if (course.status === 'review') return 'Đang chờ người có quyền duyệt'
  return null
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
  const [selectedTab, setSelectedTab] = useState<CourseTab>('all')
  const [sortBy, setSortBy] = useState<SortKey>('updated')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [levelFilter, setLevelFilter] = useState('all')
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('all')

  useEffect(() => setQuery(initialQuery), [initialQuery])

  const analyticsByCourseId = useMemo(() => {
    const map = new Map<string, CourseAnalytics>()
    for (const item of analytics ?? []) map.set(item.courseId, item)
    return map
  }, [analytics])

  const rows: CourseAdminRow[] = useMemo(() => (courseItems ?? []).map((course) => {
    const courseId = String(course.id)
    const report = analyticsByCourseId.get(courseId)
    const publicationStatus: PublicationStatus = course.publicationStatus ?? 'draft'
    const needsAttention = course.schemaVersion !== 2
      || !course.title.trim()
      || !course.coach.trim()
      || course.lessons === 0
      || publicationStatus === 'review'

    return {
      id: courseId,
      title: course.title,
      description: course.description,
      category: course.category || 'Chưa phân loại',
      level: course.level || 'Chưa xác định',
      coach: course.coach || 'Chưa phân công',
      lessons: course.lessons,
      duration: course.duration,
      learners: report ? report.learners : null,
      completion: report ? report.averageCompletion : null,
      rating: report ? report.rating : null,
      status: publicationStatus,
      statusLabel: statusLabels[publicationStatus],
      accessTier: course.settings?.accessTier ?? null,
      schemaVersion: course.schemaVersion,
      updatedAt: formatUpdatedAt(report?.updatedAt ?? course.updatedAt),
      updatedRaw: report?.updatedAt ?? course.updatedAt,
      needsAttention,
    }
  }), [courseItems, analyticsByCourseId])

  const categories = useMemo(() => [...new Set(rows.map((course) => course.category))].sort((a, b) => a.localeCompare(b, 'vi')), [rows])
  const levels = useMemo(() => [...new Set(rows.map((course) => course.level))].sort((a, b) => a.localeCompare(b, 'vi')), [rows])

  const tabCount = (tab: CourseTab) => {
    if (tab === 'all') return rows.length
    if (tab === 'attention') return rows.filter((course) => course.needsAttention).length
    return rows.filter((course) => course.status === tab).length
  }

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi')
    const list = rows.filter((course) => {
      const matchText = `${course.title} ${course.description} ${course.category} ${course.level} ${course.coach} ${course.lessons} ${course.duration}`
        .toLocaleLowerCase('vi')
        .includes(normalizedQuery)
      const matchStatus = selectedTab === 'all'
        || selectedTab === 'attention' && course.needsAttention
        || course.status === selectedTab
      const matchCategory = categoryFilter === 'all' || course.category === categoryFilter
      const matchLevel = levelFilter === 'all' || course.level === levelFilter
      const matchAccess = accessFilter === 'all'
        || accessFilter === 'legacy' && course.accessTier === null
        || course.accessTier === accessFilter
      return matchText && matchStatus && matchCategory && matchLevel && matchAccess
    })

    return [...list].sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title, 'vi')
      if (sortBy === 'learners') return (b.learners ?? -1) - (a.learners ?? -1)
      if (sortBy === 'completion') return (b.completion ?? -1) - (a.completion ?? -1)
      return toDateMs(b.updatedRaw) - toDateMs(a.updatedRaw)
    })
  }, [accessFilter, categoryFilter, levelFilter, query, rows, selectedTab, sortBy])

  const hasActiveFilters = Boolean(query.trim())
    || selectedTab !== 'all'
    || categoryFilter !== 'all'
    || levelFilter !== 'all'
    || accessFilter !== 'all'

  const clearFilters = () => {
    setQuery('')
    setSelectedTab('all')
    setCategoryFilter('all')
    setLevelFilter('all')
    setAccessFilter('all')
  }

  const totals = useMemo(() => {
    const coursesWithCompletion = rows.filter((course) => course.completion !== null)
    return {
      total: rows.length,
      published: rows.filter((course) => course.status === 'published').length,
      draft: rows.filter((course) => course.status === 'draft').length,
      pending: rows.filter((course) => course.status === 'review').length,
      learners: rows.reduce((sum, course) => sum + (course.learners ?? 0), 0),
      avgCompletion: coursesWithCompletion.length
        ? Math.round(coursesWithCompletion.reduce((sum, course) => sum + (course.completion ?? 0), 0) / coursesWithCompletion.length)
        : null,
      attention: rows.filter((course) => course.needsAttention).length,
    }
  }, [rows])

  return (
    <div className="page admin-courses-page">
      <div className="admin-hero-header text-white">
        <div className="admin-hero-header-bg" aria-hidden="true">
          <svg width="300" height="300" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="50" fill="white" /></svg>
        </div>
        <div className="admin-hero-header-content text-white">
          <span className="admin-hero-eyebrow text-white">Aura Academy · Course Command Center</span>
          <h1 className="admin-hero-title text-white">Khóa học & Đào tạo</h1>
          <p className="admin-hero-desc text-white">Theo dõi chất lượng nội dung, quy trình duyệt và hiệu quả học tập tại một nơi.</p>
        </div>
        {canCreate && <div className="admin-hero-action"><button className="admin-hero-btn" onClick={onCreate}><Plus size={18} /><span>Tạo khóa học mới</span></button></div>}
      </div>

      <div className="admin-kpi-grid admin-course-kpis">
        <article className="admin-kpi"><div className="admin-kpi__icon gradient-pink-orange"><BookOpen size={16} /></div><div><span>TỔNG KHÓA HỌC</span><strong>{totals.total}</strong><small><TrendingUp size={10} /> {totals.published} đang xuất bản</small></div></article>
        <article className="admin-kpi"><div className="admin-kpi__icon gradient-pink-orange"><Users size={16} /></div><div><span>HỌC VIÊN GHI DANH</span><strong>{totals.learners}</strong><small>Dữ liệu từ Academy</small></div></article>
        <article className="admin-kpi"><div className="admin-kpi__icon gradient-pink-orange"><CheckCircle2 size={16} /></div><div><span>HOÀN THÀNH TRUNG BÌNH</span><strong>{totals.avgCompletion === null ? '—' : `${totals.avgCompletion}%`}</strong><small>{totals.avgCompletion === null ? 'Chưa đủ dữ liệu' : 'Chỉ tính khóa có analytics'}</small></div></article>
        <article className="admin-kpi"><div className="admin-kpi__icon gradient-pink-orange"><AlertCircle size={16} /></div><div><span>CẦN XỬ LÝ</span><strong>{totals.attention}</strong><small>{totals.pending} chờ duyệt · {totals.draft} bản nháp</small></div></article>
      </div>

      <section className="admin-course-controls" aria-label="Bộ lọc khóa học">
        <div className="segmented-tabs admin-tabs admin-course-tabs" role="group" aria-label="Lọc theo trạng thái khóa học">
          {statusTabs.map((item) => <button key={item.key} type="button" aria-pressed={selectedTab === item.key} className={selectedTab === item.key ? 'active' : ''} onClick={() => setSelectedTab(item.key)}>{item.label}<span>{tabCount(item.key)}</span></button>)}
        </div>
        <div className="admin-list-toolbar admin-course-filterbar">
          <label className="course-search"><Search size={18} /><span className="sr-only">Tìm khóa học</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên, giảng viên, danh mục..." /></label>
          <label className="admin-course-select"><Filter size={14} /><span className="sr-only">Danh mục</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Mọi danh mục</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
          <label className="admin-course-select"><span className="sr-only">Cấp độ</span><select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}><option value="all">Mọi cấp độ</option>{levels.map((level) => <option key={level}>{level}</option>)}</select></label>
          <label className="admin-course-select"><span className="sr-only">Gói truy cập</span><select value={accessFilter} onChange={(event) => setAccessFilter(event.target.value as AccessFilter)}><option value="all">Mọi gói</option><option value="free">Miễn phí</option><option value="pro">Aura Pro</option><option value="legacy">Chưa nâng cấp V2</option></select></label>
          <label className="admin-course-select admin-course-sort"><span className="sr-only">Sắp xếp</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}><option value="updated">Mới cập nhật</option><option value="title">Tên A–Z</option><option value="learners">Nhiều học viên</option><option value="completion">Hoàn thành cao</option></select></label>
          {hasActiveFilters && <button type="button" className="admin-clear-filters" onClick={clearFilters}><X size={14} /> Xóa lọc</button>}
        </div>
      </section>

      {loading ? (
        <div className="empty-state card" role="status" aria-live="polite"><LoaderCircle size={30} className="spin" /><h3>Đang tải khóa học</h3><p>Danh sách đang được đồng bộ từ Firebase.</p></div>
      ) : error ? (
        <div className="empty-state card" role="alert"><AlertCircle size={30} /><h3>Không thể tải danh sách</h3><p>{error}</p>{onRetry && <button className="outline-button" onClick={onRetry}><RefreshCw size={16} /> Thử lại</button>}</div>
      ) : rows.length === 0 ? (
        <div className="empty-state card"><BookOpen size={30} /><h3>{courseItems ? 'Chưa có khóa học' : 'Chưa nhận được dữ liệu khóa học'}</h3><p>{courseItems ? 'Tạo khóa học đầu tiên để bắt đầu xây dựng thư viện Aura Fitness.' : 'Firebase chưa trả dữ liệu. Hãy thử tải lại hoặc kiểm tra kết nối.'}</p>{canCreate && <button className="primary-button" onClick={onCreate}><Plus size={17} /> Tạo khóa học</button>}</div>
      ) : filteredRows.length === 0 ? (
        <div className="empty-state card"><Filter size={30} /><h3>Không có khóa học phù hợp</h3><p>Hãy thay đổi từ khóa hoặc bộ lọc.</p><button type="button" className="outline-button" onClick={clearFilters}><X size={15} /> Xóa bộ lọc</button></div>
      ) : (
        <div className="admin-course-list">
          <div className="admin-course-list__head"><span>KHÓA HỌC</span><span>HỌC VIÊN</span><span>TIẾN ĐỘ TB.</span><span>ĐÁNH GIÁ</span><span>TRẠNG THÁI</span><span>CẬP NHẬT</span><span /></div>
          {filteredRows.map((course, index) => {
            const attentionReason = getAttentionReason(course)
            return (
              <article className={`admin-course-row ${course.needsAttention ? 'needs-attention' : ''}`} key={course.id}>
                <div className="admin-course-title"><span className={`admin-course-thumb ${index % 2 === 0 ? 'green' : 'pink'}`}><BookOpen size={22} /></span><span><strong>{course.title || 'Khóa học chưa đặt tên'}</strong><small>{course.category} · {course.level}</small><small>{course.lessons} bài · {course.duration} · {course.coach}</small>{attentionReason && <em className="admin-course-attention"><AlertCircle size={11} /> {attentionReason}</em>}</span></div>
                <span className="list-metric" data-label="Học viên"><Users size={15} /> {course.learners ?? '—'}</span>
                <span className="list-progress" data-label="Tiến độ"><ProgressBar value={course.completion ?? 0} tone={index % 4 === 1 ? 'green' : index % 4 === 2 ? 'orange' : index % 4 === 3 ? 'pink' : 'purple'} /><small>{course.completion === null ? '—' : `${course.completion}%`}</small></span>
                <span className="rating" data-label="Đánh giá"><Star size={15} fill="currentColor" /> {formatRating(course.rating)}</span>
                <span className="course-status-cell"><i className={`status-badge ${getStatusTone(course.status)}`}>{course.status === 'published' ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}{course.statusLabel}</i>{course.accessTier && <small>{course.accessTier === 'pro' ? 'Aura Pro' : 'Miễn phí'}</small>}</span>
                <span className="updated-time" data-label="Cập nhật">{course.updatedAt}</span>
                <div className="row-actions">{onView && <button title="Xem trước" aria-label={`Xem trước ${course.title}`} onClick={() => onView(course.id)}><Eye size={17} /></button>}<button title={canEdit ? 'Sửa khóa học' : 'Bạn chưa có quyền sửa'} aria-label={`Sửa ${course.title}`} disabled={!canEdit} onClick={() => onEdit(course.id)}><Pencil size={17} /></button>{onOpenActions && <button title="Thao tác khác" aria-label={`Mở thao tác cho ${course.title}`} onClick={() => onOpenActions(course.id)}><MoreHorizontal size={17} /></button>}</div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
