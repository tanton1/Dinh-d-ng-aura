import { AlertTriangle, Sparkles } from 'lucide-react'
import type { PtScheduleWorkspaceV2Result, generatePtScheduleDraft } from '../../services/ptSchedulePublishService'
import { scheduleSlotLabel } from '../../features/schedule/workspaceModel'
import { hasActionableSearchLimit } from '../../features/schedule/searchLimit'

export function optimizationNotice(result: Awaited<ReturnType<typeof generatePtScheduleDraft>>) {
  const unresolved = result.unassignedEntries?.length || result.unassigned?.length || 0
  const passes = Math.max(1, Number(result.optimizationSummary?.optimizationPasses || 1))
  const refilled = Math.max(0, Number(result.optimizationSummary?.refillAssignments || 0))
  const repaired = Math.max(0, Number(result.optimizationSummary?.rescueAssignments ?? result.optimizationSummary?.repairAssignments ?? 0))
  const relocated = Math.max(0, Number(result.optimizationSummary?.rescueRelocations ?? result.optimizationSummary?.repairRelocations ?? 0))
  const searchLimitReached = result.optimizationSummary?.rescueSearchLimitReached === true || result.optimizationSummary?.repairSearchLimitReached === true
  const improvements = [refilled ? `lấp thêm ${refilled} buổi` : '', repaired ? `cứu thêm ${repaired} buổi bằng ${relocated} lần đổi chỗ` : ''].filter(Boolean).join(', ')
  const deepRun = passes > 1 ? ` Đã chạy ${passes} lượt tối ưu${improvements ? `, ${improvements}` : ''}.` : ''
  const searchNote = searchLimitReached && hasActionableSearchLimit(result.optimizationSummary, result.unassignedEntries || result.unassigned)
    ? ' Bộ tìm kiếm đã chạm giới hạn an toàn cho các hồ sơ còn thiếu; hãy bấm Tối ưu tiếp hoặc xử lý ở tab Cảnh báo.' : ''
  return unresolved
    ? `Đã tối ưu draft r${result.draftRevision}; còn ${unresolved} hồ sơ cần xử lý.${deepRun}${searchNote}`
    : `Đã tối ưu draft r${result.draftRevision}; đã ưu tiên đủ học viên, ca đôi và PT chính/phụ.${deepRun}${searchNote}`
}

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
