import { ChevronRight } from 'lucide-react'
import type {
  PtScheduleV2Student,
  PtScheduleWorkspaceV2Result,
} from '../../services/ptSchedulePublishService'
import {
  availabilitySlotLabel,
  diagnosticActionLabel,
  diagnosticReasonLabel,
  scheduleSlotLabel,
} from '../../features/schedule/workspaceModel'

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
}: Props) {
  return <div className="schedule-warning-detail schedule-warning-detail--compact">
    <section className="is-wide schedule-warning-action"><small>Hướng xử lý</small><strong>{diagnosticActionLabel(actionCode)}</strong></section>
    <section className="is-wide schedule-warning-profile"><small>Thông tin học viên</small><strong>{student.phone || 'Thiếu số điện thoại'} · {student.email || 'Thiếu email'}</strong><span>{student.studentHomeBranchId && student.studentHomeBranchId !== branchId ? `${homeBranchName} → ${workspace.branch.name}` : `Hồ sơ tại ${homeBranchName}`}{student.phone && student.email ? '' : ' · Hồ sơ chưa đủ dữ liệu'}</span></section>
    <section className="is-wide schedule-warning-contract"><small>Hợp đồng / quota</small><strong>{primaryContract?.packageName || (student.contractStatus === 'missing' ? 'Chưa có hợp đồng hợp lệ' : 'Chưa có thông tin gói')}</strong><span>{primaryContract ? `${primaryContract.status} · còn ${primaryContract.remainingSchedulableSessions ?? primaryContract.remainingEntitlementSessions ?? 0} buổi có thể xếp · hết hạn ${primaryContract.endDate || 'chưa cập nhật'}` : `Trạng thái: ${student.contractStatus || 'chưa xác định'}`}</span></section>
    <section className="is-wide schedule-warning-availability"><small>Lịch rảnh đã đăng ký</small><strong>{student.availableSlots.length ? `${student.availableSlots.length} khung giờ` : 'Chưa có lịch rảnh'}</strong>{student.availableSlots.length ? <div className="schedule-warning-availability__slots">{student.availableSlots.map((slot) => <span key={slot}>{availabilitySlotLabel(slot)}</span>)}</div> : <em>Học viên chưa gửi khung giờ rảnh cho tuần này.</em>}</section>
    <section className="is-wide schedule-warning-schedule"><small>Lịch đã xếp · đủ cả hai cơ sở</small><strong>{scheduledSessions} buổi trong tuần{crossBranchScheduledSessions > 0 ? ` · ${crossBranchScheduledSessions} ở cơ sở khác` : ''}</strong><div>{allScheduledEntries.length ? allScheduledEntries.map((entry) => <span key={entry.id} className={entry.crossBranch ? 'is-cross-branch' : ''}><b>{entry.label}</b><small>{entry.branchName} · {entry.trainerName}</small></span>) : <em>Chưa có buổi nào trong tuần.</em>}</div></section>
    <section className="is-wide is-suggestion"><small>Ca có thể xử lý</small><div>{topCandidates.length ? topCandidates.slice(0, 2).map((slot) => {
      const trainerNamesForSlot = slot.availableTrainerIds?.map((trainerId) => workspace.trainers.find((trainer) => trainer.id === trainerId)?.name).filter(Boolean).join(', ')
      return <button type="button" key={slot.slotId} onClick={() => openDiagnosticSlot(slot)}><span>{scheduleSlotLabel(slot.slotId, weekDates)}</span><b>{trainerNamesForSlot || slot.blockerCodes?.slice(0, 1).map(diagnosticReasonLabel).join('')}</b><ChevronRight size={13} /></button>
    }) : suggestedSlots.length ? suggestedSlots.slice(0, 2).map((slot) => <span key={slot}>{scheduleSlotLabel(slot, weekDates)}</span>) : <em>Chưa có ca phù hợp</em>}</div></section>
  </div>
}
