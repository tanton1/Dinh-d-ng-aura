import {
  BookOpen,
  CheckCircle2,
  Clock3,
  FileText,
  GraduationCap,
  Image,
  Layers,
  Settings2,
  ShieldCheck,
} from 'lucide-react'
import type { CourseDraftInput } from '../../types'

interface CourseEditorSidebarProps {
  course: CourseDraftInput
  activeStep: number
  lessonTotal: number
  completeness: number
  basicsReady: boolean
  curriculumReady: boolean
  contentReady: boolean
  settingsReady: boolean
  isReady: boolean
  onStepChange: (step: number) => void
  onChooseCover: () => void
}

const publicationLabels = {
  draft: 'Bản nháp',
  review: 'Đang chờ duyệt',
  scheduled: 'Đã lên lịch',
  published: 'Đã xuất bản',
  archived: 'Đã lưu trữ',
} as const

export default function CourseEditorSidebar({
  course,
  activeStep,
  lessonTotal,
  completeness,
  basicsReady,
  curriculumReady,
  contentReady,
  settingsReady,
  isReady,
  onStepChange,
  onChooseCover,
}: CourseEditorSidebarProps) {
  const sections = [
    {
      step: 1,
      title: '1. Thông tin cơ bản',
      subtitle: 'Tên, mô tả, danh mục & kết quả',
      icon: FileText,
      done: basicsReady,
    },
    {
      step: 2,
      title: '2. Chương & Bài học',
      subtitle: `${course.modules.length} chương · ${lessonTotal} bài`,
      icon: Layers,
      done: curriculumReady && lessonTotal >= 6 && contentReady,
    },
    {
      step: 3,
      title: '3. Thiết lập & Quyền',
      subtitle: `${course.settings.accessTier === 'pro' ? 'Aura Pro' : 'Miễn phí'} · ${course.settings.visibility === 'private' ? 'Riêng tư' : 'Thành viên'}`,
      icon: Settings2,
      done: settingsReady,
    },
    {
      step: 4,
      title: '4. Kiểm tra & Xuất bản',
      subtitle: isReady ? 'Đã sẵn sàng ra mắt' : 'Cần hoàn thiện checklist',
      icon: ShieldCheck,
      done: isReady,
    },
  ]

  return (
    <aside className="builder-summary unified-editor-sidebar">
      <div className="sidebar-course-header">
        <div className={`course-cover-editor ${course.coverUrl ? 'has-image' : ''}`}>
          {course.coverUrl && <img src={course.coverUrl} alt={`Ảnh bìa ${course.title || 'khóa học'}`} />}
          <div className="cover-pattern" aria-hidden="true"><i /><i /></div>
          {!course.coverUrl && <BookOpen size={38} />}
          <button type="button" onClick={onChooseCover}><Image size={15} /> {course.coverUrl ? 'Đổi ảnh bìa' : 'Thêm ảnh bìa'}</button>
        </div>
        <div className="sidebar-course-copy">
          <span className={`status-pill-mini ${course.publicationStatus}`}>{publicationLabels[course.publicationStatus]}</span>
          <h2>{course.title || 'Khóa học chưa đặt tên'}</h2>
          <p>{course.description || 'Chưa có mô tả ngắn cho khóa học này.'}</p>
        </div>
      </div>

      <div className="builder-completeness">
        <div><span>Mức độ hoàn thiện</span><strong>{completeness}%</strong></div>
        <i role="progressbar" aria-label="Mức độ hoàn thiện khóa học" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completeness}><span style={{ width: `${completeness}%` }} /></i>
        <small>{isReady ? 'Khóa học đã đủ điều kiện gửi duyệt / xuất bản.' : 'Hoàn thiện các trường bắt buộc trước khi xuất bản.'}</small>
      </div>

      <div className="editor-nav-group">
        <span className="nav-group-label">NỘI DUNG BIÊN TẬP</span>
        <nav className="editor-sections-menu" aria-label="Danh mục các phần biên tập khóa học">
          {sections.map((item) => {
            const ItemIcon = item.icon
            return (
              <button key={item.step} type="button" className={`section-menu-item ${activeStep === item.step ? 'active' : ''} ${item.done ? 'is-done' : ''}`} onClick={() => onStepChange(item.step)}>
                <span className="menu-item-icon"><ItemIcon size={18} /></span>
                <span className="menu-item-content"><strong className="menu-item-title">{item.title}</strong><small className="menu-item-sub">{item.subtitle}</small></span>
                {item.done ? <span className="menu-item-check" title="Đã hoàn thành mục này"><CheckCircle2 size={16} /></span> : <span className="menu-item-badge">B{item.step}</span>}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="sidebar-meta-footer">
        <div className="meta-footer-item"><Clock3 size={15} /><span>{course.duration || 'Chưa đặt thời lượng'}</span></div>
        <div className="meta-footer-item"><GraduationCap size={15} /><span>{course.coach || 'Chưa phân công giảng viên'}</span></div>
      </div>
    </aside>
  )
}
