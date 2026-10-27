import { AlertTriangle, CheckCircle2, UserPlus } from 'lucide-react'
import { ptScheduleConflictLabel, type PtScheduleSlotCandidate } from '../../services/ptSchedulePublishService'

export function StudentOffNotice({ name, move = false, disabled, onConfirm }: { name?: string; move?: boolean; disabled?: boolean; onConfirm?: () => void }) {
  return <><div className="schedule-manual-override-confirm" role="alert">
    <AlertTriangle /><div><strong>Học viên đang OFF / bảo lưu</strong>
      <p>{name || 'Học viên'} đã được duyệt nghỉ trong ngày {move ? 'đích' : 'này'}. Admin có thể xác nhận {move ? 'chuyển' : 'xếp'} ca ngoại lệ; cảnh báo và người xác nhận sẽ được lưu.</p>
    </div>
  </div>{move && <button type="button" disabled={disabled} onClick={onConfirm}>Xác nhận chuyển vào ngày OFF</button>}</>
}

export function ScheduleCandidateCard({ candidate, historical, selectable, outsideAvailability, selected, isAdmin, immediate, disabled, branchName, onSelect }: {
  candidate: PtScheduleSlotCandidate; historical: boolean; selectable: boolean; outsideAvailability: boolean
  selected: boolean; isAdmin: boolean; immediate: boolean; disabled: boolean; branchName: string; onSelect: () => void
}) {
  const assignmentNote = candidate.trainerAssignmentWarning ? ' · PT hỗ trợ ngoài danh sách chính/phụ' : ''
  const branchNote = candidate.studentBranchWarning ? ` · Khác cơ sở (${branchName})` : ''
  const candidateText = historical
    ? candidate.eligible
      ? `Hợp đồng đúng ngày · còn buổi · khớp lịch rảnh${assignmentNote}${branchNote}`
      : selectable
        ? `${candidate.reasons.map(ptScheduleConflictLabel).join(' · ')} · có thể bổ sung kèm audit${assignmentNote}${branchNote}`
        : `${candidate.reasons.map(ptScheduleConflictLabel).join(' · ')}${branchNote}`
    : candidate.eligible
      ? `Đã đăng ký rảnh đúng ca này${assignmentNote}${branchNote}`
      : candidate.reasons.includes('CONTRACT_PAUSED')
        ? `Học viên OFF / bảo lưu · cần admin xác nhận${branchNote}`
        : selectable && outsideAvailability
          ? `${ptScheduleConflictLabel(candidate.availabilityReason || candidate.reasons[0])} · Có thể xếp tay${assignmentNote}${branchNote}`
          : `${candidate.reasons.map(ptScheduleConflictLabel).join(' · ')}${branchNote}`
  return <article className={`${candidate.eligible ? 'is-eligible' : selectable ? 'is-override' : 'is-disabled'}${candidate.trainerAssignmentWarning ? ' has-assignment-warning' : ''}${candidate.studentBranchWarning ? ' has-branch-warning' : ''}${selected ? ' is-selected' : ''}`}>
    <div><strong>{candidate.name}{(candidate.trainerAssignmentWarning || candidate.studentBranchWarning || (isAdmin && !candidate.eligible)) && <AlertTriangle size={13} aria-label={candidate.studentBranchWarning ? 'Cần xác nhận khác cơ sở' : 'Ca có lưu ý'} />}</strong><span>{candidateText}</span></div>
    <button type="button" aria-label={immediate ? `Xếp ngay ${candidate.name}` : selected ? `Bỏ chọn ${candidate.name}` : `Chọn ${candidate.name}`} aria-pressed={selected} disabled={disabled} onClick={onSelect}>{selected ? <CheckCircle2 /> : <UserPlus />}</button>
  </article>
}

interface Props {
  candidateName?: string
  historical: boolean
  studentOff: boolean
  busy: boolean
  disabled: boolean
  onCancel: () => void
  onConfirm: () => void
}

export default function ScheduleManualConfirmation({ candidateName, historical, studentOff, busy, disabled, onCancel, onConfirm }: Props) {
  return <footer className="schedule-manual-confirm">
    <div>{candidateName
      ? <><span>{historical ? 'Bổ sung lịch sử' : 'Đang chọn'}</span><strong>{candidateName}</strong></>
      : <><span>Chưa chọn học viên</span><strong>Chọn một hồ sơ ở trên</strong></>}</div>
    <button type="button" onClick={onCancel} disabled={!candidateName || busy}>Hủy</button>
    <button type="button" className="is-confirm" disabled={disabled || busy} onClick={onConfirm}>
      {busy ? 'Đang xác nhận…' : historical ? 'Ghi nhận ca bổ sung' : studentOff ? 'Xác nhận xếp vào ngày OFF' : 'Xác nhận xếp ca'}
    </button>
  </footer>
}
