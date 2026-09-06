import { ArrowRight, BookOpen, CheckCircle2, Clock3 } from 'lucide-react'
import type { Course } from '../../types'
import '../../styles-academy-catalog.css'
import AcademyLoadError from '../../components/academy/AcademyLoadError'

interface CoursesPageProps {
  courseItems?: Course[]
  onOpenCourse: (courseId: string) => void
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  warning?: string | null
  initialQuery?: string
}

function currentAuraCourse(courseItems: Course[]) {
  return courseItems.find((course) => (
    course.category.toLocaleLowerCase('vi').includes('giáo trình dinh dưỡng aura')
  )) ?? courseItems[0] ?? null
}

export default function CoursesPage({
  onOpenCourse,
  courseItems = [],
  loading = false,
  error,
  onRetry,
  warning,
}: CoursesPageProps) {
  const course = currentAuraCourse(courseItems)
  const progress = Math.max(0, Math.min(100, Number(course?.progress) || 0))

  return (
    <div className="page courses-page courses-page--single">
      {course ? (
        <section className="academy-single-course" aria-labelledby="academy-current-course-title">
          <img
            className="academy-single-course__background"
            src="/images/aura-nutrition-academy-hero-v1.jpg"
            alt=""
            loading="eager"
            fetchPriority="high"
          />
          <div className="academy-single-course__overlay" aria-hidden="true" />

          <div className="academy-single-course__content">
            <span className="academy-single-course__eyebrow">AURA NUTRITION ACADEMY</span>
            <h1 id="academy-current-course-title">{course.title}</h1>
            <p>{course.description}</p>

            <div className="academy-single-course__meta" aria-label="Thông tin khóa học">
              <span><BookOpen size={16} /> {course.lessons} bài học</span>
              <span><Clock3 size={16} /> {course.duration}</span>
              {course.settings?.accessTier === 'free' && course.settings.visibility === 'members' ? (
                <span><CheckCircle2 size={16} /> Mở cho mọi thành viên Aura</span>
              ) : null}
            </div>

            {progress > 0 ? (
              <div className="academy-single-course__progress" aria-label={`Đã hoàn thành ${progress}% khóa học`}>
                <div>
                  <span>Tiến độ của bạn</span>
                  <strong>{progress}%</strong>
                </div>
                <div className="academy-single-course__progress-track" aria-hidden="true">
                  <span style={{ width: `${progress}%` }} />
                </div>
              </div>
            ) : null}

            <button type="button" onClick={() => onOpenCourse(String(course.id))}>
              {progress > 0 ? 'Tiếp tục học' : 'Bắt đầu khóa học'}
              <ArrowRight size={18} />
            </button>

            {warning ? <small role="status">Tiến độ cá nhân đang đồng bộ lại. Nội dung khóa học vẫn xem được.</small> : null}
          </div>
        </section>
      ) : loading ? (
        <div className="academy-single-state" role="status">
          <BookOpen size={32} />
          <h1>Đang tải khóa học</h1>
          <p>Aura đang chuẩn bị giáo trình của bạn.</p>
        </div>
      ) : error ? <AcademyLoadError error={error} onRetry={onRetry} /> : (
        <div className="academy-single-state" role="alert">
          <BookOpen size={32} />
          <h1>Chưa thể mở khóa học</h1>
          <p>{error || 'Giáo trình chưa được xuất bản cho tài khoản này.'}</p>
        </div>
      )}
    </div>
  )
}
