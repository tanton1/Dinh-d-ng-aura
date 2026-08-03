import { useEffect, useMemo, useState } from 'react'
import { Award, BookOpen, BrainCircuit, CheckCircle2, Clock3, Dumbbell, Filter, Leaf, Play, RotateCcw, Search, SlidersHorizontal, Sparkles, Zap } from 'lucide-react'
import { courses as demoCourses } from '../../data'
import type { Course } from '../../types'
import { PageHeader, ProgressBar } from '../../components/ui'
import '../../styles-academy-catalog.css'

const iconMap = {
  strength: Dumbbell,
  nutrition: Leaf,
  mobility: Sparkles,
  hiit: Zap,
}

function CourseCard({ course, onOpen }: { course: Course; onOpen: () => void }) {
  const Icon = iconMap[course.icon as keyof typeof iconMap] ?? BookOpen
  return (
    <article
      className="course-card"
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
      <div className={`course-card__visual ${course.accent}`}>
        <div className="course-art-circles"><i /><i /><i /></div>
        <Icon size={54} strokeWidth={1.7} />
        {course.status === 'Đã hoàn thành' && <span className="complete-badge"><CheckCircle2 size={15} /> Hoàn thành</span>}
        {course.status === 'Khám phá' && <span className="new-badge">MỚI</span>}
        {course.progress > 0 && course.progress < 100 && <span className="floating-play" aria-hidden="true"><Play size={18} fill="currentColor" /></span>}
      </div>
      <div className="course-card__body">
        <div className="course-tags"><span>{course.category}</span><i>·</i><span>{course.level}</span></div>
        <h3>{course.title}</h3>
        <p>{course.description}</p>
        <div className="course-info"><span><BookOpen size={15} /> {course.lessons} bài</span><span><Clock3 size={15} /> {course.duration}</span></div>
        {course.progress > 0 ? (
          <div className="course-card__progress"><div><span>Tiến độ</span><strong>{course.progress}%</strong></div><ProgressBar value={course.progress} tone={course.accent} /></div>
        ) : (
          <button className="outline-button">Xem khóa học</button>
        )}
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

export default function CoursesPage({ onOpenCourse, courseItems = demoCourses, loading = false, error, warning, initialQuery = '' }: CoursesPageProps) {
  const mineCount = courseItems.filter((course) => course.status !== 'Khám phá').length
  const [tab, setTab] = useState<'mine' | 'explore'>(mineCount > 0 ? 'mine' : 'explore')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('Tất cả')
  const [level, setLevel] = useState('Tất cả')
  const [showFilters, setShowFilters] = useState(false)

  // Auto switch to explore if student has no active courses and opens catalog
  useEffect(() => {
    if (mineCount === 0 && tab === 'mine') {
      setTab('explore')
    }
  }, [mineCount])
  useEffect(() => setQuery(initialQuery), [initialQuery])
  const categories = useMemo(() => ['Tất cả', ...Array.from(new Set(courseItems.map((course) => course.category)))], [courseItems])
  const levels = useMemo(() => ['Tất cả', ...Array.from(new Set(courseItems.map((course) => course.level)))], [courseItems])
  const filtered = useMemo(() => courseItems.filter((course) => {
    const belongsToTab = tab === 'explore' || course.status !== 'Khám phá'
    const matchesQuery = course.title.toLowerCase().includes(query.toLowerCase())
    const matchesCategory = category === 'Tất cả' || course.category === category
    const matchesLevel = level === 'Tất cả' || course.level === level
    return belongsToTab && matchesQuery && matchesCategory && matchesLevel
  }), [tab, query, category, courseItems, level])

  return (
    <div className="page courses-page">
      <PageHeader eyebrow="AURA ACADEMY" title="Khóa học dinh dưỡng chuyên sâu" description="Học theo lộ trình, ghi nhớ chủ động và chứng minh năng lực bằng bài kiểm tra thực hành." />

      <section className="academy-catalog-intro" aria-label="Phương pháp học Aura Academy">
        <article><span><BrainCircuit size={20} /></span><div><strong>Hiểu sâu, không học thuộc</strong><small>Case study, active recall và giải thích đáp án theo từng chủ đề.</small></div></article>
        <article><span><RotateCcw size={20} /></span><div><strong>Ôn đúng thời điểm</strong><small>Flashcard và lịch ôn giúp củng cố những phần kiến thức còn yếu.</small></div></article>
        <article><span><Award size={20} /></span><div><strong>Đánh giá năng lực</strong><small>Quiz bài học, checkpoint chương và bài kiểm tra tổng hợp cuối khóa.</small></div></article>
      </section>

      {warning && <div className="learning-action-error" role="status">Thư viện vẫn khả dụng nhưng tiến độ cá nhân tạm thời chưa đồng bộ: {warning}</div>}

      <div className="course-toolbar">
        <div className="segmented-tabs">
          <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>Khóa của tôi <span>{mineCount}</span></button>
          <button className={tab === 'explore' ? 'active' : ''} onClick={() => setTab('explore')}>Toàn bộ chuyên đề</button>
        </div>
        <div className="course-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm khóa học..." /></div>
        <button className="filter-button" aria-expanded={showFilters} onClick={() => setShowFilters((value) => !value)}><SlidersHorizontal size={18} /> Bộ lọc</button>
      </div>

      {showFilters && (
        <div className="course-filter-panel card">
          <label><span>Trình độ</span><select value={level} onChange={(event) => setLevel(event.target.value)}>{levels.map((item) => <option key={item}>{item}</option>)}</select></label>
          <button className="text-button" onClick={() => { setQuery(''); setCategory('Tất cả'); setLevel('Tất cả') }}>Xóa bộ lọc</button>
        </div>
      )}

      <div className="category-pills">
        {categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}
      </div>

      {loading ? (
        <div className="empty-state"><BookOpen size={32} /><h3>Đang tải khóa học</h3><p>Aura đang đồng bộ thư viện của bạn.</p></div>
      ) : error ? (
        <div className="empty-state"><Filter size={32} /><h3>Chưa thể tải khóa học</h3><p>{error}</p></div>
      ) : filtered.length > 0 ? (
        <div className="courses-grid">{filtered.map((course) => <CourseCard key={course.id} course={course} onOpen={() => onOpenCourse(String(course.id))} />)}</div>
      ) : tab === 'mine' ? (
        <div className="empty-state">
          <BookOpen size={32} />
          <h3>Bạn chưa tham gia khóa học nào</h3>
          <p>Khám phá toàn bộ danh mục khóa học dinh dưỡng để bắt đầu lộ trình học của bạn.</p>
          <button className="primary-button" style={{ marginTop: '12px' }} onClick={() => setTab('explore')}>
            Khám phá chuyên đề ngay
          </button>
        </div>
      ) : (
        <div className="empty-state"><Filter size={32} /><h3>Không tìm thấy khóa học</h3><p>Thử thay đổi từ khóa hoặc bộ lọc của bạn.</p></div>
      )}
    </div>
  )
}
