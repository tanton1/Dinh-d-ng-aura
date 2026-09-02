import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Award,
  BarChart3,
  BookOpen,
  Brain,
  CheckCircle2,
  Clock3,
  Dumbbell,
  Filter,
  Flame,
  GraduationCap,
  Leaf,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from 'lucide-react'
import type { Course } from '../../types'
import '../../styles-academy-catalog.css'

const iconMap = {
  strength: Dumbbell,
  nutrition: Leaf,
  mobility: Sparkles,
  hiit: Zap,
}

const bannerGradients = [
  'gradient-pink',
  'gradient-orange',
  'gradient-purple',
  'gradient-emerald',
]

function CourseCardV2({
  course,
  index,
  onOpen,
}: {
  course: Course
  index: number
  onOpen: () => void
}) {
  const Icon = iconMap[course.icon as keyof typeof iconMap] ?? Leaf
  const gradientClass = bannerGradients[index % bannerGradients.length]

  return (
    <article
      className="course-card-v2"
      role="link"
      tabIndex={0}
      aria-label={`Mở khóa học ${course.title}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className={`course-card-v2__banner ${gradientClass}`}>
        <div className="course-card-v2__icon">
          <Icon size={38} strokeWidth={2} />
        </div>
        {course.status === 'Đã hoàn thành' ? (
          <span className="course-badge-tag complete">
            <CheckCircle2 size={12} style={{ display: 'inline', marginRight: 4 }} />
            HOÀN THÀNH
          </span>
        ) : course.status === 'Khám phá' ? (
          <span className="course-badge-tag">MỚI</span>
        ) : course.progress > 0 ? (
          <span className="course-badge-tag">{course.progress}% TIẾN ĐỘ</span>
        ) : (
          <span className="course-badge-tag">SẮP RA MẮT</span>
        )}
      </div>

      <div className="course-card-v2__body">
        <div className="course-card-v2__header">
          <span className="course-category-tag">
            {course.category} · {course.level.toUpperCase()}
          </span>
          <h3 className="course-card-v2__title">{course.title}</h3>
          <p className="course-card-v2__desc">{course.description}</p>
        </div>

        <div className="course-card-v2__footer">
          <div className="course-meta-pills">
            <span>
              <BookOpen size={15} /> {course.lessons} bài
            </span>
            <span>
              <Clock3 size={15} /> {course.duration}
            </span>
            <span>
              <BarChart3 size={15} /> Cấp độ: {course.level}
            </span>
          </div>

          <button
            type="button"
            className="course-cta-btn"
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
          >
            {course.progress > 0 ? 'Học tiếp' : 'Xem khóa học'}
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </article>
  )
}

interface CoursesPageProps {
  courseItems?: Course[]
  onOpenCourse: (courseId: string) => void
  loading?: boolean
  error?: string | null
  warning?: string | null
  initialQuery?: string
}

import { useDebounce } from '../../hooks/useDebounce'

export default function CoursesPage({
  onOpenCourse,
  // The parent decides whether demo mode is enabled. A learner page must not
  // silently replace an empty/failed Firebase response with sample courses.
  courseItems = [],
  loading = false,
  error,
  warning,
  initialQuery = '',
}: CoursesPageProps) {
  const mineCount = courseItems.filter((course) => course.status !== 'Khám phá').length
  const [tab, setTab] = useState<'mine' | 'explore'>(mineCount > 0 ? 'mine' : 'explore')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 300)
  const [category, setCategory] = useState('Tất cả')
  const [level, setLevel] = useState('Tất cả')
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    if (mineCount === 0 && tab === 'mine') {
      setTab('explore')
    }
  }, [mineCount, tab])

  useEffect(() => setQuery(initialQuery), [initialQuery])

  const categories = useMemo(
    () => ['Tất cả', ...Array.from(new Set(courseItems.map((course) => course.category)))],
    [courseItems],
  )
  const levels = useMemo(
    () => ['Tất cả', ...Array.from(new Set(courseItems.map((course) => course.level)))],
    [courseItems],
  )

  const filtered = useMemo(
    () =>
      courseItems.filter((course) => {
        const belongsToTab = tab === 'explore' || course.status !== 'Khám phá'
        const matchesQuery = course.title.toLowerCase().includes(debouncedQuery.toLowerCase())
        const matchesCategory = category === 'Tất cả' || course.category === category
        const matchesLevel = level === 'Tất cả' || course.level === level
        return belongsToTab && matchesQuery && matchesCategory && matchesLevel
      }),
    [tab, debouncedQuery, category, courseItems, level],
  )

  return (
    <div className="page courses-page">
      {/* Modern Hero Header */}
      <header className="academy-hero-header">
        <div className="academy-hero-header__eyebrow">
          <Sparkles size={14} /> AURA ACADEMY
        </div>
        <h1>
          Khóa học <span>dinh dưỡng chuyên sâu</span>
        </h1>
        <p>
          Học theo lộ trình, ghi nhớ chủ động và chứng minh năng lực bằng bài kiểm tra thực hành.
        </p>

        <div className="academy-hero-decoration">
          <GraduationCap size={110} color="#ff2d91" strokeWidth={1} opacity={0.2} />
        </div>
      </header>

      {/* 3 Method Cards */}
      <section className="academy-catalog-intro" aria-label="Phương pháp học Aura Academy">
        <article tabIndex={0}>
          <span>
            <Brain size={22} />
          </span>
          <div>
            <strong>Hiểu sâu, không học thuộc</strong>
            <small>Case study, active recall và giải thích đáp án theo từng chủ đề.</small>
          </div>
          <div className="arrow-icon">
            <ArrowRight size={14} />
          </div>
        </article>

        <article tabIndex={0}>
          <span>
            <RotateCcw size={22} />
          </span>
          <div>
            <strong>Ôn đúng thời điểm</strong>
            <small>Flashcard và lịch ôn giúp củng cố những phần kiến thức còn yếu.</small>
          </div>
          <div className="arrow-icon">
            <ArrowRight size={14} />
          </div>
        </article>

        <article tabIndex={0}>
          <span>
            <Award size={22} />
          </span>
          <div>
            <strong>Đánh giá năng lực</strong>
            <small>Quiz bài học, checkpoint chương và bài kiểm tra tổng hợp cuối khóa.</small>
          </div>
          <div className="arrow-icon">
            <ArrowRight size={14} />
          </div>
        </article>
      </section>

      {warning && (
        <div className="learning-action-error" role="status" style={{ marginBottom: 18 }}>
          Thư viện vẫn khả dụng nhưng tiến độ cá nhân tạm thời chưa đồng bộ: {warning}
        </div>
      )}

      {/* Category Pills & Search Bar Toolbar */}
      <div className="catalog-filter-bar">
        <div className="category-pills-row">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={`category-pill-btn ${category === item ? 'active' : ''}`}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            className={`category-pill-btn ${showFilters ? 'active' : ''}`}
            onClick={() => setShowFilters((v) => !v)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <SlidersHorizontal size={14} /> Bộ lọc
          </button>
        </div>

        <div className="catalog-search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm khóa học..."
          />
        </div>
      </div>

      {showFilters && (
        <div className="course-filter-panel card" style={{ padding: 16, marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Trình độ:</span>
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
            >
              {levels.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="text-button"
            style={{ marginLeft: 16, color: '#ff2d91', cursor: 'pointer', fontWeight: 700 }}
            onClick={() => {
              setQuery('')
              setCategory('Tất cả')
              setLevel('Tất cả')
            }}
          >
            Xóa bộ lọc
          </button>
        </div>
      )}

      {/* Course Cards Grid */}
      {loading ? (
        <div className="empty-state">
          <BookOpen size={32} />
          <h3>Đang tải khóa học</h3>
          <p>Aura đang đồng bộ thư viện của bạn.</p>
        </div>
      ) : error ? (
        <div className="empty-state">
          <Filter size={32} />
          <h3>Chưa thể tải khóa học</h3>
          <p>{error}</p>
        </div>
      ) : filtered.length > 0 ? (
        <div className="courses-grid-v2">
          {filtered.map((course, idx) => (
            <CourseCardV2
              key={course.id}
              course={course}
              index={idx}
              onOpen={() => onOpenCourse(String(course.id))}
            />
          ))}
        </div>
      ) : tab === 'mine' ? (
        <div className="empty-state">
          <BookOpen size={32} />
          <h3>Bạn chưa tham gia khóa học nào</h3>
          <p>Khám phá toàn bộ danh mục khóa học dinh dưỡng để bắt đầu lộ trình học của bạn.</p>
          <button
            type="button"
            className="primary-button"
            style={{ marginTop: '12px' }}
            onClick={() => setTab('explore')}
          >
            Khám phá chuyên đề ngay
          </button>
        </div>
      ) : (
        <div className="empty-state">
          <Filter size={32} />
          <h3>Không tìm thấy khóa học</h3>
          <p>Thử thay đổi từ khóa hoặc bộ lọc của bạn.</p>
        </div>
      )}
    </div>
  )
}
