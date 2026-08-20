import { AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react'

export interface CourseEditorValidationIssue {
  id: string
  step: 1 | 2 | 3
  label: string
  detail: string
  targetId?: string
}

interface CourseEditorValidationPanelProps {
  issues: CourseEditorValidationIssue[]
  onSelect: (issue: CourseEditorValidationIssue) => void
}

export default function CourseEditorValidationPanel({ issues, onSelect }: CourseEditorValidationPanelProps) {
  if (issues.length === 0) {
    return <section className="course-validation-panel is-ready" role="status"><CheckCircle2 size={20} /><div><strong>Khóa học đã sẵn sàng</strong><p>Checklist bắt buộc đã hoàn tất. Hãy gửi duyệt để Administrator phê duyệt trước khi xuất bản.</p></div></section>
  }

  return (
    <section className="course-validation-panel" role="status" aria-live="polite">
      <div className="course-validation-heading"><AlertCircle size={20} /><div><strong>Còn {issues.length} mục cần hoàn thiện</strong><p>Chọn từng mục để Aura đưa bạn đến đúng bước cần sửa.</p></div></div>
      <div className="course-validation-list">
        {issues.map((issue) => (
          <button type="button" key={issue.id} onClick={() => onSelect(issue)}>
            <span>Bước {issue.step}</span>
            <span><strong>{issue.label}</strong><small>{issue.detail}</small></span>
            <ArrowRight size={16} />
          </button>
        ))}
      </div>
    </section>
  )
}
