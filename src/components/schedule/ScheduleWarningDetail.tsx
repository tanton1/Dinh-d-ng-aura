import { ChevronRight } from 'lucide-react'
import type {
  PtScheduleV2Student,
  PtScheduleWorkspaceV2Result,
} from '../../services/ptSchedulePublishService'
import {
  DAY_LABELS,
  contractStatusLabel,
  diagnosticReasonLabel,
  scheduleSlotLabel,
} from '../../features/schedule/workspaceModel'

// These labels are used only by expanded warning details. Keep them in this
// lazy panel so the initial schedule matrix does not download/parse them.
function availabilitySlotLabel(slotId: string) {
  const [day, rawHour] = slotId.split('-')
  return `${DAY_LABELS[day] || day} ${String(Number(rawHour)).padStart(2, '0')}:00`
}

function diagnosticActionLabel(code: string | undefined) {
  switch (code) {
    case 'EDIT_STUDENT_AVAILABILITY': return 'Bổ sung / điều chỉnh lịch rảnh'
    case 'REVIEW_CONTRACT_QUOTA': return 'Kiểm tra quota hoặc nối tiếp hợp đồng'
    case 'REVIEW_CONTRACT_DATES': return 'Kiểm tra ngày hiệu lực hợp đồng'
    case 'ADD_TRAINER_AVAILABILITY': return 'Bổ sung lịch rảnh PT hoặc mở PT hỗ trợ'
    case 'OPEN_OTHER_SLOT': return 'Mở ca khác còn công suất'
    case 'RERUN_OPTIMIZER': return 'Chạy tối ưu lần 2 hoặc xếp tay'
    default: return 'Mở ca đề xuất và xử lý thủ công'
  }
}

interface WarningSlot {
  slotId: string
  date: string
  hour: number
  learnerAvailable: boolean
  availableTrainerIds: string[]
  blockedTrainerIds?: string[]
  blockerCodes?: string[]
}

interface Props {
  student: PtScheduleV2Student
  workspace: PtScheduleWorkspaceV2Result
  branchId: string
  weekDates: Record<string, { display: string; full: string }>
  scheduledSessions: number
  crossBranchScheduledSessions: number
  actionCode?: string
  topCandidates: WarningSlot[]
  suggestedSlots: string[]
  primaryContract: PtScheduleWorkspaceV2Result['contracts'][number] | null
  homeBranchName: string
  allScheduledEntries: Array<{
    id: string
    label: string
    branchName: string
    trainerName: string
    crossBranch: boolean
  }>
  openDiagnosticSlot: (slot: WarningSlot) => void
  validationPending?: boolean
}

export default function ScheduleWarningDetail({
  student,
  workspace,
  branchId,
  weekDates,
  scheduledSessions,
  crossBranchScheduledSessions,
  actionCode,
  topCandidates,
  suggestedSlots,
  primaryContract,
  homeBranchName,
  allScheduledEntries,
  openDiagnosticSlot,
  validationPending = false,
}: Props) {
  return <div className="schedule-warning-detail schedule-warning-detail--compact">
    <section className="is-wide schedule-warning-action"><small>{validationPending ? 'Trạng thái đối soát' : 'Hướng xử lý'}</small><strong>{validationPending ? 'Số buổi đã cập nhật theo draft; nguyên nhân và thông tin điều kiện đang chờ đối soát.' : diagnosticActionLabel(actionCode)}</strong></section>
    <section className="is-wide schedule-warning-profile"><small>Thông tin học viên</small><strong>{student.phone || 'Thiếu số điện thoại'} · {student.email || 'Thiếu email'}</strong><span>{student.studentHomeBranchId && student.studentHomeBranchId !== branchId ? `${homeBranchName} → ${workspace.branch.name}` : `Hồ sơ tại ${homeBranchName}`}{student.phone && student.email ? '' : ' · Hồ sơ chưa đủ dữ liệu'}</span></section>
    <section className="is-wide schedule-warning-contract"><small>Hợp đồng / quota{validationPending ? ' · thông tin đã lưu, chờ xác minh' : ''}</small><strong>{primaryContract?.packageName || (student.contractStatus === 'missing' && !validationPending ? 'Chưa có hợp đồng hợp lệ' : 'Chưa có thông tin gói')}</strong><span>{primaryContract ? `${contractStatusLabel(primaryContract.status)} · còn ${primaryContract.remainingSchedulableSessions ?? primaryContract.remainingEntitlementSessions ?? 'chưa xác định'} buổi có thể xếp · hết hạn ${primaryContract.endDate || 'chưa cập nhật'}` : `Trạng thái: ${contractStatusLabel(student.contractStatus)}`}</span></section>
    <section className="is-wide schedule-warning-availability"><small>Lịch rảnh đã đăng ký</small><strong>{student.availableSlots.length ? `${student.availableSlots.length} khung giờ` : 'Chưa có lịch rảnh'}</strong>{student.availableSlots.length ? <div className="schedule-warning-availability__slots">{student.availableSlots.map((slot) => <span key={slot}>{availabilitySlotLabel(slot)}</span>)}</div> : <em>Học viên chưa gửi khung giờ rảnh cho tuần này.</em>}</section>
    <section className="is-wide schedule-warning-schedule"><small>{validationPending ? 'Lịch đã xếp · dữ liệu hai cơ sở đã tải' : 'Lịch đã xếp · đủ cả hai cơ sở'}</small><strong>{scheduledSessions} buổi trong tuần{crossBranchScheduledSessions > 0 ? ` · ${crossBranchScheduledSessions} ở cơ sở khác` : ''}</strong><div>{allScheduledEntries.length ? allScheduledEntries.map((entry) => <span key={entry.id} className={entry.crossBranch ? 'is-cross-branch' : ''}><b>{entry.label}</b><small>{entry.branchName} · {entry.trainerName}</small></span>) : <em>Chưa có buổi nào trong tuần.</em>}</div></section>
    <section className="is-wide is-suggestion"><small>Ca có thể xử lý</small><div>{topCandidates.length ? topCandidates.slice(0, 2).map((slot) => {
      const trainerNamesForSlot = slot.availableTrainerIds?.map((trainerId) => workspace.trainers.find((trainer) => trainer.id === trainerId)?.name).filter(Boolean).join(', ')
      return <button type="button" key={slot.slotId} onClick={() => openDiagnosticSlot(slot)}><span>{scheduleSlotLabel(slot.slotId, weekDates)}</span><b>{trainerNamesForSlot || slot.blockerCodes?.slice(0, 1).map(diagnosticReasonLabel).join('')}</b><ChevronRight size={13} /></button>
    }) : suggestedSlots.length ? suggestedSlots.slice(0, 2).map((slot) => <span key={slot}>{scheduleSlotLabel(slot, weekDates)}</span>) : <em>{validationPending ? 'Đang chờ đối soát ca phù hợp' : 'Chưa có ca phù hợp'}</em>}</div></section>
  </div>
}
