import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, MapPin, Sparkles } from 'lucide-react'
import type { Branch, Student, Warning } from '../../types'

interface Props {
  warnings: Warning[]
  students: Student[]
  branches: Branch[]
  onReviewStudent?: (student: Student) => void
}

function formatSlot(slotId: string) {
  const [day, hour] = slotId.split('-')
  return `${day} · ${hour}:00`
}

export default function ScheduleWarningsPanel({ warnings, students, branches, onReviewStudent }: Props) {
  const [branchFilter, setBranchFilter] = useState('all')
  const studentsById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students])
  const branchCounts = useMemo(() => {
    const counts = new Map<string, number>()
    warnings.forEach((warning) => {
      const branchId = studentsById.get(warning.studentId)?.branchId || 'none'
      counts.set(branchId, (counts.get(branchId) || 0) + 1)
    })
    return counts
  }, [studentsById, warnings])
  const visibleWarnings = useMemo(() => warnings.filter((warning) => {
    if (branchFilter === 'all') return true
    return (studentsById.get(warning.studentId)?.branchId || 'none') === branchFilter
  }), [branchFilter, studentsById, warnings])
  const collisionCount = warnings.filter((warning) =>
    Boolean(warning.overlappingSlots?.length || warning.multipleSessionsDays?.length),
  ).length
  const missingSessions = warnings.reduce(
    (total, warning) => total + Math.max(0, warning.requested - warning.scheduled),
    0,
  )
  const warningStudentCount = new Set(warnings.map((warning) => warning.studentId)).size
  const branchName = (branchId: string) => branchId === 'none'
    ? 'Chưa xác định'
    : branches.find((branch) => branch.id === branchId)?.name || 'Chi nhánh đã xóa'

  return (
    <section className="schedule-alerts" aria-labelledby="schedule-alerts-title">
      <header className="schedule-alerts__hero">
        <div>
          <span><Sparkles size={15} /> AURA SCHEDULE CHECK</span>
          <h2 id="schedule-alerts-title">Cảnh báo cần xử lý</h2>
          <p>Tách riêng lỗi xếp lịch để danh sách học viên ngắn hơn và đội vận hành tập trung đúng việc.</p>
        </div>
        <div className="schedule-alerts__score" aria-label={`${warnings.length} cảnh báo`}>
          <strong>{warnings.length}</strong>
          <span>Cần kiểm tra</span>
        </div>
      </header>

      <div className="schedule-alerts__summary">
        <article><CalendarClock size={18} /><div><strong>{missingSessions}</strong><span>Buổi còn thiếu</span></div></article>
        <article><AlertTriangle size={18} /><div><strong>{collisionCount}</strong><span>Trùng lịch/ngày</span></div></article>
        <article><CheckCircle2 size={18} /><div><strong>{Math.max(0, students.length - warningStudentCount)}</strong><span>Học viên ổn định</span></div></article>
      </div>

      <div className="schedule-alerts__filters" aria-label="Lọc cảnh báo theo chi nhánh">
        <button type="button" className={branchFilter === 'all' ? 'is-active' : ''} onClick={() => setBranchFilter('all')}>
          Tất cả <span>{warnings.length}</span>
        </button>
        {[...branchCounts.entries()].map(([branchId, count]) => (
          <button key={branchId} type="button" className={branchFilter === branchId ? 'is-active' : ''} onClick={() => setBranchFilter(branchId)}>
            {branchName(branchId)} <span>{count}</span>
          </button>
        ))}
      </div>

      {visibleWarnings.length === 0 ? (
        <div className="schedule-alerts__empty">
          <CheckCircle2 size={30} />
          <strong>Không còn cảnh báo trong phạm vi này</strong>
          <span>Lịch đã đủ điều kiện để chuyển sang bước kiểm tra publish.</span>
        </div>
      ) : (
        <div className="schedule-alerts__list">
          {visibleWarnings.map((warning, index) => {
            const student = studentsById.get(warning.studentId)
            const missing = Math.max(0, warning.requested - warning.scheduled)
            return (
              <article key={`${warning.studentId}-${index}`} className="schedule-alert-card">
                <div className="schedule-alert-card__identity">
                  <span className="schedule-alert-card__avatar">{student?.name?.trim().charAt(0).toUpperCase() || '?'}</span>
                  <div>
                    <strong>{student?.name || 'Học viên đã xóa'}</strong>
                    <small><MapPin size={12} /> {branchName(student?.branchId || 'none')}</small>
                  </div>
                  <span className={missing > 0 ? 'is-critical' : 'is-review'}>{warning.scheduled}/{warning.requested} buổi</span>
                </div>
                <div className="schedule-alert-card__issues">
                  {missing > 0 && <p>Thiếu {missing} buổi so với nhu cầu tuần.</p>}
                  {warning.multipleSessionsDays?.length ? <p>Trùng ngày: {warning.multipleSessionsDays.join(', ')}.</p> : null}
                  {warning.overlappingSlots?.length ? <p>Trùng ca: {warning.overlappingSlots.join(', ')}.</p> : null}
                </div>
                {warning.suggestions.length > 0 && (
                  <div className="schedule-alert-card__suggestions">
                    <span>Slot đề xuất</span>
                    <div>{warning.suggestions.slice(0, 4).map((slot) => <small key={slot}>{formatSlot(slot)}</small>)}</div>
                  </div>
                )}
                {student && onReviewStudent && (
                  <button type="button" onClick={() => onReviewStudent(student)}>
                    Kiểm tra lịch rảnh <ArrowRight size={15} />
                  </button>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
