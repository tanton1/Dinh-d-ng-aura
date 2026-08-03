import {
  ArrowRight,
  Award,
  BookOpen,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Dumbbell,
  Flame,
  Play,
  Sparkles,
  Trophy,
} from 'lucide-react'
import { courses as demoCourses, weeklyActivity } from '../../data'
import type { Course, ViewId } from '../../types'
import { ProgressBar, ProgressRing, SectionHeader, StatCard } from '../../components/ui'

interface HomePageProps {
  onNavigate: (view: ViewId) => void
  onOpenCourse: (courseId: string) => void
  courseItems?: Course[]
  displayName?: string
  isDemo?: boolean
}

export default function HomePage({ onNavigate, onOpenCourse, courseItems = demoCourses, displayName = 'Thành viên Aura', isDemo = true }: HomePageProps) {
  const now = new Date()
  const dateLabel = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(now).toUpperCase()
  const greeting = now.getHours() < 11 ? 'Chào buổi sáng' : now.getHours() < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'
  const firstName = displayName.trim().split(/\s+/).slice(-1)[0] || 'bạn'
  const continueCourses = courseItems.filter((course) => course.status !== 'Khám phá').slice(0, 2)
  const learningCourses = courseItems.filter((course) => course.status !== 'Khám phá')
  const overallCourseProgress = learningCourses.length ? Math.round(learningCourses.reduce((total, course) => total + course.progress, 0) / learningCourses.length) : 0
  const completedCourses = learningCourses.filter((course) => course.progress >= 100)
  const completedLessons = learningCourses.reduce((total, course) => total + Math.round((course.progress / 100) * course.lessons), 0)
  const totalLessons = learningCourses.reduce((total, course) => total + course.lessons, 0)
  return (
    <div className="page home-page">
      <section className="welcome-row">
        <div>
          <span className="eyebrow">{dateLabel}</span>
          <h1>{greeting}, {firstName}! <span>👋</span></h1>
          <p>Học kiến thức tại Aura Academy và theo dõi kế hoạch tập luyện PT trong hai không gian độc lập.</p>
        </div>
        {isDemo && <div className="streak-pill"><Flame size={20} fill="currentColor" /><strong>12</strong><span>ngày liên tiếp · mẫu</span></div>}
      </section>

      <section className="hero-grid">
        <article className="today-workout">
          <div className="today-workout__content">
            <span className="hero-label"><span /> AURA ACADEMY · TIẾP TỤC HỌC</span>
            <h2>{continueCourses[0]?.title ?? 'Nền tảng dinh dưỡng ứng dụng'}</h2>
            <div className="workout-meta">
              <span><Clock3 size={17} /> {continueCourses[0]?.duration ?? '6 tuần'}</span>
              <span><BookOpen size={17} /> {continueCourses[0]?.lessons ?? 24} bài học</span>
              <span><BrainCircuit size={17} /> Học · Ôn · Kiểm tra</span>
            </div>
            <button className="primary-button light" onClick={() => continueCourses[0] ? onOpenCourse(String(continueCourses[0].id)) : onNavigate('courses')}><Play size={18} fill="currentColor" /> {continueCourses[0] ? 'Tiếp tục học' : 'Khám phá khóa học'}</button>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <div className="hero-number">A+</div>
            <div className="hero-dumbbell academy-orbit-mark"><BrainCircuit size={62} /></div>
            <small>DINH DƯỠNG CHUYÊN SÂU</small>
          </div>
        </article>

        <article className="weekly-goal card">
          <div className="weekly-goal__top">
            <div><span className="eyebrow">{isDemo ? 'MỤC TIÊU TUẦN · MẪU' : 'TIẾN ĐỘ HỌC TẬP'}</span><h3>{learningCourses.length ? 'Tiếp tục hành trình của bạn' : 'Chọn khóa học đầu tiên'}</h3></div>
            <ProgressRing value={isDemo ? 80 : overallCourseProgress} size={76} stroke={8} />
          </div>
          <div className="goal-row"><span><CheckCircle2 size={18} /> Khóa học</span><strong>{isDemo ? '4/5' : `${completedCourses.length}/${learningCourses.length}`}</strong></div>
          <ProgressBar value={isDemo ? 80 : learningCourses.length ? Math.round((completedCourses.length / learningCourses.length) * 100) : 0} />
          <div className="goal-row"><span><BookOpen size={18} /> Bài học</span><strong>{isDemo ? '3/4' : `${completedLessons}/${totalLessons}`}</strong></div>
          <ProgressBar value={isDemo ? 75 : totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0} tone="green" />
          <div className="goal-tip"><Sparkles size={17} /><span>{isDemo ? 'Số liệu minh họa cho trải nghiệm Aura.' : 'Tiến độ được đồng bộ sau mỗi bài học hoàn thành.'}</span></div>
        </article>
      </section>

      <section>
        <SectionHeader title="Tiếp tục hành trình" action="Xem tất cả" onAction={() => onNavigate('courses')} />
        <div className="continue-grid">
          {continueCourses.map((course, index) => (
            <article className="continue-card" key={course.id} role="link" tabIndex={0} onClick={() => onOpenCourse(String(course.id))} onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpenCourse(String(course.id))
              }
            }}>
              <div className={`course-thumb ${course.accent}`}>
                <span className="course-thumb__mesh" />
                {index === 0 ? <BookOpen size={42} /> : <span className="nutrition-glyph">A+</span>}
                <span className="course-type">AURA ACADEMY</span>
              </div>
              <div className="continue-card__body">
                <div className="course-kicker">{course.category} · {course.level}</div>
                <h3>{course.title}</h3>
                <span className="lesson-position">{course.progress > 0 ? `${course.progress}% lộ trình đã hoàn thành` : `${course.lessons} bài học đang chờ bạn`}</span>
                <div className="course-progress-row"><ProgressBar value={course.progress} tone={course.accent} /><strong>{course.progress}%</strong></div>
              </div>
              <span className="round-arrow" aria-hidden="true"><ArrowRight size={18} /></span>
            </article>
          ))}
          {continueCourses.length === 0 && <div className="empty-state card"><BookOpen size={30} /><h3>Chọn khóa học đầu tiên</h3><p>Khám phá thư viện Aura và bắt đầu một lộ trình phù hợp với bạn.</p><button className="primary-button" onClick={() => onNavigate('courses')}>Khám phá khóa học</button></div>}
        </div>
      </section>

      {isDemo ? <section className="overview-grid">
        <article className="activity-card card">
          <SectionHeader title="Hoạt động tuần này" action="Chi tiết" onAction={() => onNavigate('progress')} />
          <div className="activity-summary"><strong>160</strong><span>phút vận động</span><small>+18% so với tuần trước</small></div>
          <div className="mini-chart">
            {weeklyActivity.map((item) => (
              <div className="mini-chart__column" key={item.day}>
                <div className="bar-track"><span className={item.completed ? 'done' : ''} style={{ height: `${Math.max(item.minutes * 1.35, 8)}px` }} /></div>
                <small>{item.day}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="next-events card">
          <SectionHeader title="Sắp tới" action="Mở lịch" onAction={() => onNavigate('schedule')} />
          <div className="event-row"><div className="event-date"><strong>+1</strong><small>NGÀY</small></div><div><strong>Mobility Flow</strong><span><CalendarDays size={14} /> 07:30 · 25 phút</span></div><ChevronRight size={18} /></div>
          <div className="event-row"><div className="event-date orange"><strong>+2</strong><small>NGÀY</small></div><div><strong>Q&A Dinh dưỡng</strong><span><CalendarDays size={14} /> 20:00 · Trực tuyến</span></div><ChevronRight size={18} /></div>
        </article>
      </section> : <section className="overview-grid"><article className="activity-card card"><SectionHeader title="Hoạt động tập luyện" /><div className="progress-empty compact"><Dumbbell size={27} /><h3>Chưa có báo cáo hoạt động</h3><p>Buổi tập đã lưu sẽ được tổng hợp thành biểu đồ ở bản cập nhật tiếp theo.</p></div></article><article className="next-events card"><SectionHeader title="Lịch sắp tới" action="Mở lịch" onAction={() => onNavigate('schedule')} /><div className="progress-empty compact"><CalendarDays size={27} /><h3>Chưa có lịch được giao</h3><p>Bạn có thể bắt đầu buổi tập tự do hoặc chờ kế hoạch từ HLV.</p></div></article></section>}

      <section>
        <SectionHeader title="Thành tích gần đây" action="Xem bộ sưu tập" onAction={() => onNavigate('progress')} />
        {isDemo ? <div className="achievement-row">
          <StatCard icon={<Flame />} value="12 ngày" label="Chuỗi bền bỉ" detail="Dữ liệu minh họa" tone="orange" />
          <StatCard icon={<Trophy />} value="20 buổi" label="Chiến binh tập luyện" detail="Dữ liệu minh họa" tone="purple" />
          <StatCard icon={<Award />} value="Học giả" label="Hoàn thành khóa học" detail="Dữ liệu minh họa" tone="green" />
        </div> : completedCourses.length ? <div className="achievement-row">{completedCourses.slice(0, 3).map((course) => <StatCard key={course.id} icon={<Award />} value="Hoàn thành" label={course.title} detail="Tiến độ 100%" tone="green" />)}</div> : <div className="progress-empty compact"><Award size={28} /><h3>Chưa có thành tích mới</h3><p>Hoàn thành khóa học đầu tiên để mở huy hiệu thật.</p></div>}
      </section>
    </div>
  )
}
