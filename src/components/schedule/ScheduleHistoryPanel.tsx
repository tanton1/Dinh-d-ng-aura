import type { RefObject } from 'react'
import { ChevronLeft, History, RefreshCw } from 'lucide-react'
import type { PtScheduleVersionListResult, PtScheduleVersionSummary } from '../../services/ptSchedulePublishService'

interface Props {
  history: PtScheduleVersionListResult | null
  busy: boolean
  restoreCandidate: PtScheduleVersionSummary | null
  dialogRef: RefObject<HTMLElement | null>
  onBack: () => void
  onSelect: (version: PtScheduleVersionSummary) => void
  onCancel: () => void
  onRestore: () => void
}

function formatPublishedAt(value: string | null) {
  if (!value) return 'Chưa có thời gian'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Chưa có thời gian'
    : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

export default function ScheduleHistoryPanel({ history, busy, restoreCandidate, dialogRef, onBack, onSelect, onCancel, onRestore }: Props) {
  return <>
    <main className="branch-schedule__history-page">
      <header><p>LỚP AN TOÀN</p><h2>Lịch sử đã publish</h2><span>Chỉ dùng khi cần xem lại hoặc khôi phục một lịch cũ. Hệ thống luôn tạo draft mới và không sửa buổi đã tính.</span><button type="button" onClick={onBack}><ChevronLeft size={16} /> Quay lại lịch PT</button></header>
      {busy && !history ? <div className="branch-schedule__loading"><RefreshCw className="is-spinning" /> Đang tải lịch sử…</div> : null}
      <section className="schedule-version-list">{history?.versions.map((version) => <article key={version.version} className={version.version === history.currentVersion ? 'is-current' : ''}><div><strong>Phiên bản v{version.version}</strong><span>{version.entryCount} buổi · draft r{version.sourceDraftRevision}</span><small>{formatPublishedAt(version.publishedAt)}</small></div><button type="button" onClick={() => onSelect(version)}><History size={15} /> Tạo draft</button></article>)}</section>
      {history && !history.versions.length && <div className="schedule-warning-empty">Chưa có phiên bản đã publish.</div>}
    </main>
    {restoreCandidate && history && <div className="schedule-publish-backdrop"><section ref={dialogRef} className="schedule-publish-dialog" role="alertdialog" aria-modal="true" aria-labelledby="branch-restore-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">KHÔI PHỤC AN TOÀN</p><h2 id="branch-restore-title">Tạo draft từ v{restoreCandidate.version}?</h2><p>Phiên bản đã publish vẫn bất biến. Lịch được sao chép thành draft revision mới để kiểm tra lại.</p><div className="schedule-publish-dialog__actions"><button type="button" onClick={onCancel}>Quay lại</button><button type="button" onClick={onRestore} disabled={busy}>Tạo draft mới</button></div></section></div>}
  </>
}
