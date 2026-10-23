import { useEffect, type RefObject } from 'react'
import { AlertTriangle } from 'lucide-react'
import { ptScheduleConflictLabel, type PtScheduleBranchOption, type PtSchedulePublishResult } from '../../services/ptSchedulePublishService'

interface Props {
  preview: PtSchedulePublishResult
  branches: PtScheduleBranchOption[]
  branchName: string
  busy: boolean
  confirmed: boolean
  dialogRef: RefObject<HTMLElement | null>
  onConfirmBranch: (value: boolean) => void
  onClose: () => void
  onPublish: () => void
}

export default function SchedulePublishDialog({ preview, branches, branchName, busy, confirmed, dialogRef, onConfirmBranch, onClose, onPublish }: Props) {
  useEffect(() => { dialogRef.current?.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true }) }, [dialogRef])
  const crossBranch = preview.warnings.includes('STUDENT_BRANCH_MISMATCH')
  return <div className="schedule-publish-backdrop"><section ref={dialogRef} className="schedule-publish-dialog" role="dialog" aria-modal="true" aria-labelledby="branch-publish-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">AURA PT · XÁC NHẬN</p><h2 id="branch-publish-title">Publish v{preview.version}?</h2><p>Session đã tính buổi hoặc xác nhận được khóa bất biến. Toàn bộ diff còn lại chạy trong một transaction.</p><div className="schedule-publish-diff"><div><strong>{preview.diff.create}</strong><span>Tạo mới</span></div><div><strong>{preview.diff.update}</strong><span>Điều chỉnh</span></div><div><strong>{preview.diff.cancel}</strong><span>Hủy</span></div><div><strong>{preview.diff.unchanged}</strong><span>Giữ nguyên</span></div></div>{preview.warnings.length > 0 && <div className="schedule-publish-warnings"><AlertTriangle size={17} /><div><strong>{preview.warnings.length} lưu ý không chặn publish</strong><span>{preview.warnings.map(ptScheduleConflictLabel).join(' · ')}</span></div></div>}{crossBranch && <label className="schedule-publish-branch-ack"><input type="checkbox" checked={confirmed} onChange={(event) => onConfirmBranch(event.target.checked)} /><span><strong>Xác nhận lịch khác cơ sở</strong><small>{preview.warningDetails?.filter((item) => item.code === 'STUDENT_BRANCH_MISMATCH').map((item) => `${item.studentName || 'Học viên'}: ${branches.find((branch) => branch.id === item.studentHomeBranchId)?.name || 'cơ sở hồ sơ'} → ${branches.find((branch) => branch.id === item.targetBranchId)?.name || branchName || 'cơ sở tập'}`).join(' · ') || 'Các học viên được đánh dấu sẽ tập tại cơ sở đang publish.'}</small></span></label>}<div className="schedule-publish-dialog__actions"><button type="button" onClick={onClose}>Quay lại</button><button type="button" onClick={onPublish} disabled={busy || (crossBranch && !confirmed)}>{busy ? 'Đang publish…' : `Publish v${preview.version}`}</button></div></section></div>
}
