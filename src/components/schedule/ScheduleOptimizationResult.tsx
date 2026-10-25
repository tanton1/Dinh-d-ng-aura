import { AlertTriangle, Sparkles } from 'lucide-react'
import type { PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'
import { scheduleSlotLabel } from '../../features/schedule/workspaceModel'

interface Props {
  workspace: PtScheduleWorkspaceV2Result
  weekDates: Record<string, { display: string; full: string }>
  searchLimitWarning: boolean
}

// Secondary optimizer diagnostics should not increase the initial matrix bundle.
export default function ScheduleOptimizationResult({ workspace, weekDates, searchLimitWarning }: Props) {
  const comparison = workspace.optimizationSummary?.comparison
  const trace = workspace.optimizationSummary?.swapTrace || []
  return <>
    {comparison && <p className="branch-schedule__notice" role="status">
      Trước → sau: {comparison.before.sessions} → {comparison.after.sessions} buổi · {comparison.before.complete} → {comparison.after.complete} học viên đủ lịch · {comparison.before.paired} → {comparison.after.paired} ca đôi.
    </p>}
    {trace.length > 0 && <details className="branch-schedule__optimization-trace">
      <summary><span><Sparkles size={16} /><strong>{trace.length} bước xếp/đổi chỗ gần nhất</strong></span><small>Mở chi tiết</small></summary>
      <ol>{trace.map((move, index) => {
        const fromTrainer = workspace.trainers.find(trainer => trainer.id === move.fromTrainerId)?.name || 'PT cũ'
        const toTrainer = workspace.trainers.find(trainer => trainer.id === move.toTrainerId)?.name || 'PT mới'
        const studentName = workspace.students.find(student => student.id === move.studentId)?.name || 'Đang cập nhật hồ sơ'
        return <li key={`${move.studentId}-${move.fromSlotId || 'new'}-${move.toSlotId}-${index}`}><b>{index + 1}</b><div><strong>{move.studentName || studentName}</strong><span>{move.fromSlotId ? `${scheduleSlotLabel(move.fromSlotId, weekDates)} · ${fromTrainer} → ` : 'Bổ sung vào '}{scheduleSlotLabel(move.toSlotId, weekDates)} · {toTrainer}</span></div></li>
      })}</ol>
    </details>}
    {searchLimitWarning && <div className="branch-schedule__search-limit" role="status"><AlertTriangle size={16} /> Tối ưu đã dừng ở ngân sách tìm kiếm an toàn cho một số hồ sơ còn thiếu. Ca thủ công, ca khóa và ca đã publish vẫn được giữ nguyên; bấm “Tối ưu tiếp” hoặc xử lý hồ sơ trong Cảnh báo.</div>}
  </>
}
