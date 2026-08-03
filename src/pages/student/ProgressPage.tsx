import { useEffect, useState } from 'react'
import { Award, BookOpen, BrainCircuit, CheckCircle2, ClipboardCheck, Flame, LineChart, RotateCcw, Target, Trophy } from 'lucide-react'
import { PageHeader, ProgressBar, StatCard } from '../../components/ui'
import { academyMaterialForLesson, loadAcademyReviewState, loadAcademyReviewStateFromCloud, type AcademyReviewState } from '../../services/academyLearningService'
import type { Course, CourseProgress } from '../../types'

interface ProgressPageProps {
  courseItems?: Course[]
  progressItems?: CourseProgress[]
  loading?: boolean
  error?: string | null
  onOpenCourse?: (courseId: string) => void
  ownerId?: string
}

export default function ProgressPage({ courseItems = [], progressItems = [], loading = false, error, onOpenCourse, ownerId = 'demo' }: ProgressPageProps) {
  const learningCourses = courseItems.filter((course) => course.status !== 'Khám phá')
  const [cloudReviewStates, setCloudReviewStates] = useState<Record<string, AcademyReviewState>>({})

  useEffect(() => {
    let active = true
    const courseIds = learningCourses.map((course) => String(course.id))
    if (!courseIds.length) {
      setCloudReviewStates({})
      return () => { active = false }
    }
    void Promise.all(courseIds.map(async (courseId) => [courseId, await loadAcademyReviewStateFromCloud(ownerId, courseId)] as const))
      .then((entries) => { if (active) setCloudReviewStates(Object.fromEntries(entries)) })
      .catch(() => undefined)
    return () => { active = false }
  }, [ownerId, courseItems])
  const progressByCourseId = new Map(progressItems.map((item) => [item.courseId, item]))
  const completedLessons = learningCourses.reduce((total, course) => {
    const stored = progressByCourseId.get(String(course.id))
    return total + (stored?.completedLessonIds.length ?? Math.round((course.progress / 100) * course.lessons))
  }, 0)
  const totalLessons = learningCourses.reduce((total, course) => total + course.lessons, 0)
  const overallProgress = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0
  const completedCourses = learningCourses.filter((course) => course.status === 'Đã hoàn thành')
  const reviewSummary = learningCourses.reduce((summary, course) => {
    const courseId = String(course.id)
    const state = cloudReviewStates[courseId] ?? loadAcademyReviewState(ownerId, courseId)
    const lessons = course.modules?.flatMap((module) => module.lessons) ?? []
    const cardCount = lessons.reduce((total, lesson) => total + academyMaterialForLesson(lesson, course.outcomes).flashcards.length, 0)
    const reviews = Object.values(state.cards)
    return {
      cards: summary.cards + cardCount,
      reviewed: summary.reviewed + reviews.length,
      due: summary.due + reviews.filter((review) => review.dueAt <= Date.now()).length,
    }
  }, { cards: 0, reviewed: 0, due: 0 })
  const quizLessons = learningCourses.flatMap((course) => course.modules?.flatMap((module) => module.lessons.map((lesson) => ({ course, lesson }))) ?? [])
    .filter(({ lesson }) => lesson.type === 'Quiz')
  const completedQuizLessons = quizLessons.filter(({ course, lesson }) => progressByCourseId.get(String(course.id))?.completedLessonIds.includes(lesson.id)).length

  if (loading || error) {
    return (
      <div className="page progress-page">
        <PageHeader eyebrow="AURA ACADEMY" title="Tiến độ học tập" description="Theo dõi mức độ hoàn thành, lịch ôn và các bài kiểm tra kiến thức." />
        <div className="empty-state card" role={error ? 'alert' : 'status'}><BookOpen size={30} /><h3>{error ? 'Chưa thể tải tiến độ' : 'Đang tải tiến độ'}</h3><p>{error ?? 'Aura đang đồng bộ enrollment và các bài học đã hoàn thành.'}</p></div>
      </div>
    )
  }

  return (
    <div className="page progress-page">
      <PageHeader eyebrow="AURA ACADEMY" title="Tiến độ học tập" description="Theo dõi mức độ hoàn thành, lịch ôn và các bài kiểm tra kiến thức; dữ liệu tập gym được quản lý riêng trong PT Coaching." />

      <div className="progress-stats">
        <StatCard icon={<BookOpen />} value={String(learningCourses.length)} label="Khóa đã ghi danh" detail="Dữ liệu học tập hiện tại" tone="purple" />
        <StatCard icon={<CheckCircle2 />} value={String(completedLessons)} label="Bài đã hoàn thành" detail={`Trong tổng số ${totalLessons} bài`} tone="green" />
        <StatCard icon={<Target />} value={`${overallProgress}%`} label="Tiến độ tổng" detail="Tính theo số bài hoàn thành" tone="orange" />
        <StatCard icon={<Trophy />} value={String(completedCourses.length)} label="Khóa hoàn tất" detail="Đạt điều kiện hoàn thành của khóa" tone="pink" />
      </div>

      <section className="progress-main-grid">
        <article className="card learning-progress-card">
          <div className="section-heading"><div><h2>Tiến độ khóa học</h2><p>Cùng một nguồn dữ liệu với trang Khóa học</p></div><LineChart size={22} /></div>
          {learningCourses.length ? (
            <div className="learning-progress-list">
              {learningCourses.map((course) => {
                const stored = progressByCourseId.get(String(course.id))
                const completed = stored?.completedLessonIds.length ?? Math.round((course.progress / 100) * course.lessons)
                return (
                  <button key={course.id} onClick={() => onOpenCourse?.(String(course.id))}>
                    <span className={`stat-icon ${course.accent}`}><BookOpen size={19} /></span>
                    <span><strong>{course.title}</strong><small>{completed}/{course.lessons} bài · {course.coach}</small><ProgressBar value={course.progress} tone={course.accent} /></span>
                    <b>{course.progress}%</b>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="progress-empty"><BookOpen size={28} /><h3>Chưa có khóa học đang theo học</h3><p>Ghi danh một khóa học để Aura bắt đầu tổng hợp tiến độ của bạn.</p></div>
          )}
        </article>

        <article className="card body-progress-card">
          <div className="section-heading"><div><h2>Ôn tập ghi nhớ</h2><p>Flashcard được lên lịch theo mức độ bạn nhớ</p></div><RotateCcw size={22} /></div>
          <div className="academy-progress-summary"><span><strong>{reviewSummary.due}</strong><small>Cần ôn hôm nay</small></span><span><strong>{reviewSummary.reviewed}</strong><small>Thẻ đã luyện</small></span><span><strong>{reviewSummary.cards}</strong><small>Thẻ trong khóa học</small></span></div>
          {reviewSummary.cards ? <p className="academy-progress-note"><BrainCircuit size={16} /> Mở khóa học đang học để bắt đầu phiên ôn tập ngắn.</p> : <div className="progress-empty compact"><BrainCircuit size={27} /><h3>Chưa có bộ thẻ ghi nhớ</h3><p>Flashcard sẽ xuất hiện khi giảng viên cấu hình nội dung ôn tập cho bài học.</p></div>}
        </article>
      </section>

      <section className="lower-progress-grid">
        <article className="card personal-bests">
          <div className="section-heading"><div><h2>Bài kiểm tra Academy</h2><p>Quiz bài học, checkpoint chương và đánh giá cuối khóa</p></div><ClipboardCheck size={23} /></div>
          <div className="academy-assessment-progress"><strong>{completedQuizLessons}/{quizLessons.length}</strong><span>Bài kiểm tra đã hoàn thành</span><ProgressBar value={quizLessons.length ? Math.round((completedQuizLessons / quizLessons.length) * 100) : 0} tone="green" /></div>
          {!quizLessons.length && <div className="progress-empty compact"><ClipboardCheck size={27} /><h3>Chưa có bài kiểm tra</h3><p>Bài kiểm tra sẽ xuất hiện khi khóa học đang theo học có quiz được xuất bản.</p></div>}
        </article>
        <article className="card achievements-card">
          <div className="section-heading"><div><h2>Thành tích học tập</h2><p>{completedCourses.length ? `${completedCourses.length} khóa học đã hoàn thành` : 'Hoàn thành khóa đầu tiên để mở huy hiệu'}</p></div><Award size={23} /></div>
          {completedCourses.length ? (
            <div className="badge-showcase">
              {completedCourses.map((course) => <div className="badge-item" key={course.id}><span className="badge-medal green"><Award size={30} /></span><strong>Hoàn thành</strong><small>{course.title}</small></div>)}
            </div>
          ) : (
            <div className="progress-empty compact"><Flame size={27} /><h3>Hành trình đang bắt đầu</h3><p>Huy hiệu sẽ xuất hiện từ dữ liệu hoàn thành thật, không dùng thành tích mẫu.</p></div>
          )}
        </article>
      </section>
    </div>
  )
}
