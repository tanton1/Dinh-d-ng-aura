import { useEffect, type RefObject } from 'react'

interface Props {
  summary: { resettableEntries: number; affectedStudents: number; protectedEntries: number }
  busy: boolean
  dialogRef: RefObject<HTMLElement | null>
  onClose: () => void
  onReset: () => void
}

// Reset is an explicit, destructive draft action. Its confirmation is not
// needed for viewing a week, and remains mandatory after this lazy load.
export default function ScheduleResetDialog({ summary, busy, dialogRef, onClose, onReset }: Props) {
  useEffect(() => { dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }) }, [dialogRef])
  return <div className="schedule-publish-backdrop"><section ref={dialogRef} className="schedule-publish-dialog" role="alertdialog" aria-modal="true" aria-labelledby="branch-reset-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">AURA PT · ĐẶT LẠI DRAFT</p><h2 id="branch-reset-title">Xếp lại từ đầu tuần này?</h2><p>Xóa {summary.resettableEntries} buổi nháp của {summary.affectedStudents} học viên, bao gồm buổi xếp tay, tự động và buổi nháp đã khóa. {summary.protectedEntries} ca OFF hoặc buổi đã publish vẫn được giữ nguyên.</p><div className="schedule-publish-dialog__actions"><button type="button" onClick={onClose}>Quay lại</button><button type="button" onClick={onReset} disabled={busy}>{busy ? 'Đang đặt lại…' : 'Đặt lại draft'}</button></div></section></div>
}
