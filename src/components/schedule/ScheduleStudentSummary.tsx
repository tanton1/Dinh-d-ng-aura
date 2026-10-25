import { Minus, Plus, RotateCcw, UsersRound } from 'lucide-react'
import type { PtScheduleV2Student } from '../../services/ptSchedulePublishService'
import { diagnosticReasonLabel } from '../../features/schedule/workspaceModel'

interface Props {
  student: PtScheduleV2Student
  approvedOffWeek: boolean
  coveragePending: boolean
  scheduled: number
  missing: number
  primaryReasonCode?: string
  busy: boolean
  onSetWeeklyTarget: (studentId: string, target: number | null) => Promise<void>
}

// These controls are only used on the students tab; keep them off the matrix's
// initial load path while retaining the same status and target behavior.
export default function ScheduleStudentSummary({ student, approvedOffWeek, coveragePending, scheduled, missing, primaryReasonCode, busy, onSetWeeklyTarget }: Props) {
  const contractIssue = student.eligibilityReasons.find(reason => reason.includes('CONTRACT') || reason === 'ACTIVE_CONTRACT_NOT_FOUND')
  const primaryReason = primaryReasonCode || contractIssue || (missing > 0 ? 'STUDENT_UNSCHEDULED' : undefined)
  const statusText = approvedOffWeek ? 'OFF / bảo lưu đã duyệt · không tính thiếu buổi' : coveragePending
    ? 'Chưa đối soát'
    : student.eligibleForWeek !== true ? diagnosticReasonLabel(primaryReason)
    : missing > 0 ? `Thiếu ${missing} buổi` : 'Đủ lịch tuần'
  return <>
    <div className="branch-schedule__student-person">
      <span><UsersRound size={17} /></span>
      <div><strong>{student.name || 'Chưa cập nhật tên'}</strong><small>{statusText}</small></div>
    </div>
    <div className="branch-schedule__student-progress">
      <strong>{approvedOffWeek ? 'OFF' : coveragePending ? '—' : `${scheduled}/${student.sessionsPerWeek}`}</strong>
      <span>{approvedOffWeek ? statusText : coveragePending ? 'Chạy Xếp tối ưu để tính' : student.eligibleForWeek !== true ? 'Cần rà lại' : statusText}</span>
      {!approvedOffWeek && <i><b style={{ width: coveragePending ? '0%' : `${Math.min(100, student.sessionsPerWeek ? scheduled / student.sessionsPerWeek * 100 : 100)}%` }} /></i>}
    </div>
    <div className="branch-schedule__weekly-target">
      <small>{approvedOffWeek ? 'Mục tiêu mặc định' : 'Mục tiêu'}</small>
      {approvedOffWeek ? <span>{student.defaultSessionsPerWeek} buổi/tuần · giữ nguyên</span> : <div>
        <button type="button" aria-label={`Giảm mục tiêu tuần của ${student.name}`} disabled={busy || student.sessionsPerWeek <= scheduled} onClick={() => void onSetWeeklyTarget(student.id, student.sessionsPerWeek - 1)}><Minus /></button>
        <strong>{student.sessionsPerWeek}</strong>
        <button type="button" aria-label={`Tăng mục tiêu tuần của ${student.name}`} disabled={busy || student.sessionsPerWeek >= student.maxWeeklySessions} onClick={() => void onSetWeeklyTarget(student.id, student.sessionsPerWeek + 1)}><Plus /></button>
        {student.sessionsPerWeek > 0 && <button type="button" className="is-zero" title={scheduled > 0 ? 'Gỡ lịch trong tuần trước khi đặt 0 buổi' : 'Đặt nhanh mục tiêu về 0 buổi'} aria-label={`Đặt nhanh mục tiêu của ${student.name} về 0 buổi`} disabled={busy || scheduled > 0} onClick={() => void onSetWeeklyTarget(student.id, 0)}>0</button>}
        {student.weeklySessionTargetOverridden && <button type="button" className="is-reset" title={`Về ${student.defaultSessionsPerWeek} buổi`} aria-label={`Khôi phục mục tiêu của ${student.name} về ${student.defaultSessionsPerWeek} buổi`} disabled={busy || Math.min(student.defaultSessionsPerWeek, student.maxWeeklySessions) < scheduled} onClick={() => void onSetWeeklyTarget(student.id, null)}><RotateCcw /></button>}
      </div>}
    </div>
  </>
}
