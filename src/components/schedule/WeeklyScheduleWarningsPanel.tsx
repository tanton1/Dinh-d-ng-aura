import { lazy, Suspense } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, RefreshCw } from 'lucide-react'
import type { PtScheduleBranchOption, PtScheduleUnassignedEntry, PtScheduleV2Student, PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'
import { diagnosticReasonLabel, scheduleSlotLabel, warningCauseLabel, type WarningCause, type WarningFilter } from '../../features/schedule/workspaceModel'
const ScheduleWarningDetail = lazy(() => import('./ScheduleWarningDetail'))

interface WarningProfile {
  student: PtScheduleV2Student
  missingSessions: number
  scheduledSessions: number
  scheduledEntries: Array<{ slotId: string; trainerId: string; label: string }>
  crossBranchScheduledSessions: number
  reasonCodes: string[]
  primaryReasonCode?: string
  warningCause: WarningCause
  actionCode?: string
  candidateSlots?: PtScheduleUnassignedEntry['candidateSlots']
  suggestedSlots?: string[]
}
interface Conflict { key: string; slotId: string; studentId: string; trainerId: string; studentName: string; trainerName: string; code: string }
interface Props {
  workspace: PtScheduleWorkspaceV2Result
  branchId: string
  branches: PtScheduleBranchOption[]
  weekDates: Record<string, { display: string; full: string }>
  coveragePending: boolean
  warningCount: number
  warningFilter: WarningFilter
  setWarningFilter: (value: WarningFilter) => void
  warningMissingValue: string
  warningMissingNote: string
  warningProfiles: WarningProfile[]
  visibleWarningProfiles: WarningProfile[]
  contractWarningProfiles: WarningProfile[]
  learnerWarningProfiles: WarningProfile[]
  capacityWarningProfiles: WarningProfile[]
  systemWarningProfiles: WarningProfile[]
  scheduleConflictWarnings: Conflict[]
  expandedWarningStudentId: string | null
  openWarningStudentAvailability: (student: PtScheduleV2Student) => void
  onOpenSlot: (slotId: string, trainerId: string) => void
}

function RetainedValidation({ workspace }: { workspace: PtScheduleWorkspaceV2Result }) {
  const snapshot = workspace.validationSnapshot!
  const students = new Map(workspace.students.map(student => [student.id, student]))
  const ids = [...new Set([...Object.values(snapshot.coverage.byStudent).filter(row => row.missingSessions > 0).map(row => row.studentId), ...snapshot.warnings.map(row => row.studentId).filter((id): id is string => Boolean(id)), ...snapshot.unassignedEntries.map(row => row.studentId)])]
  return <section aria-label="Kết quả đối soát trước" className="schedule-warning-conflicts">
    <header><div><strong>Kết quả đối soát trước · chưa cập nhật</strong><span>Đang chờ đối soát nền; số liệu dưới đây thuộc lần đối soát trước.{snapshot.validatedAt ? ` Lần trước: ${new Date(snapshot.validatedAt).toLocaleString('vi-VN')}.` : ''}</span></div></header>
    <p>{snapshot.coverage.scheduledEntries}/{snapshot.coverage.totalTargetSessions} buổi · còn thiếu {snapshot.coverage.missingSessions} buổi ở lần đối soát trước.</p>
    <div>{ids.map(id => {
      const student = students.get(id)
      const warnings = snapshot.warnings.filter(row => row.studentId === id)
      const unassigned = snapshot.unassignedEntries.find(row => row.studentId === id)
      const coverage = snapshot.coverage.byStudent[id]
      const warning = warnings[0]
      const contracts = (snapshot.contracts || workspace.contracts).filter(row => row.studentId === id)
      const contract = contracts.reduce<typeof contracts[number] | null>((latest, row) => !latest || String(row.endDate || '') > String(latest.endDate || '') ? row : latest, null)
        || (student as (PtScheduleV2Student & { contract?: Partial<PtScheduleWorkspaceV2Result['contracts'][number]> }) | undefined)?.contract
      const packageName = warning?.packageName || contract?.packageName
      const contractStatus = warning?.contractStatus || unassigned?.diagnostics?.contractStatus || contract?.status || student?.contractStatus
      const endDate = warning?.contractEndDate || contract?.endDate || student?.contractEndDate
      const reasons = [...new Set([...warnings.map(row => row.code), ...(unassigned?.reasonCodes || [])])]
      return <article key={id} className="schedule-warning-student">
        <strong>{student?.name || warning?.studentName || unassigned?.studentName || 'Hồ sơ chưa có tên'}</strong>
        <p>{student?.phone || warning?.studentPhone || 'Thiếu số điện thoại'} · {student?.email || 'Thiếu email'}</p>
        <p>{coverage ? `${coverage.scheduledSessions}/${coverage.targetSessions} buổi · thiếu ${coverage.missingSessions}` : 'Chưa có số buổi trong kết quả trước'} · số liệu cũ</p>
        <p>{packageName || 'Gói chưa có thông tin'} · {contractStatus || 'Trạng thái chưa xác định'}{endDate ? ` · hạn ${endDate}` : ''}</p>
        <p>{reasons.map(diagnosticReasonLabel).join(' · ') || 'Cần đối soát lại'}</p>
      </article>
    })}</div>
  </section>
}

export default function WeeklyScheduleWarningsPanel({ workspace, branchId, branches, weekDates, coveragePending, warningCount, warningFilter, setWarningFilter, warningMissingValue, warningMissingNote, warningProfiles, visibleWarningProfiles, contractWarningProfiles, learnerWarningProfiles, capacityWarningProfiles, systemWarningProfiles, scheduleConflictWarnings, expandedWarningStudentId, openWarningStudentAvailability, onOpenSlot }: Props) {
  return <main id="schedule-panel-warnings" role="tabpanel" aria-labelledby="schedule-tab-warnings" className="branch-schedule__warning-page">
          <header><p>RÀ SOÁT TUẦN NÀY</p><h2>Cảnh báo</h2><span>{coveragePending ? `${scheduleConflictWarnings.length} xung đột nhanh · thiếu buổi chưa đối soát` : warningCount ? `${warningCount} mục cần xử lý` : 'Không có cảnh báo'}</span></header>
          <section className="schedule-warning-overview" aria-label="Tổng hợp cảnh báo lịch tập">
            <button type="button" className={`schedule-warning-stat is-missing${coveragePending ? ' is-pending' : ''}`} aria-pressed={warningFilter === 'priority'} onClick={() => setWarningFilter('priority')}><span className="schedule-warning-stat__value">{warningMissingValue}</span><span className="schedule-warning-stat__label">Thiếu buổi</span><small>{warningMissingNote}</small></button>
            <button type="button" className="schedule-warning-stat is-conflict" aria-pressed={warningFilter === 'conflict'} onClick={() => setWarningFilter('conflict')}><span className="schedule-warning-stat__value">{scheduleConflictWarnings.length}</span><span className="schedule-warning-stat__label">Trùng / xung đột</span><small>Chọn dòng để mở ma trận</small></button>
          </section>
          <section className="schedule-warning-summary" aria-label="Lọc theo lý do">
            <button type="button" className="is-contract" aria-pressed={warningFilter === 'contract'} onClick={() => setWarningFilter('contract')} disabled={coveragePending}><strong>{coveragePending ? '—' : contractWarningProfiles.length}</strong><span>Do hợp đồng</span></button>
            <button type="button" className="is-learner" aria-pressed={warningFilter === 'learner'} onClick={() => setWarningFilter('learner')} disabled={coveragePending}><strong>{coveragePending ? '—' : learnerWarningProfiles.length}</strong><span>Do lịch khách</span></button>
            <button type="button" className="is-capacity" aria-pressed={warningFilter === 'capacity'} onClick={() => setWarningFilter('capacity')} disabled={coveragePending}><strong>{coveragePending ? '—' : capacityWarningProfiles.length}</strong><span>Thiếu PT / ca</span></button>
            <button type="button" className="is-system" aria-pressed={warningFilter === 'system'} onClick={() => setWarningFilter('system')} disabled={coveragePending}><strong>{coveragePending ? '—' : systemWarningProfiles.length}</strong><span>Cần tối ưu</span></button>
          </section>
          <nav className="schedule-warning-filters" role="tablist" aria-label="Nhóm cảnh báo">
            <button type="button" role="tab" aria-selected={warningFilter === 'priority'} className={warningFilter === 'priority' ? 'is-active' : ''} onClick={() => setWarningFilter('priority')}>Thiếu buổi <b>{coveragePending ? '—' : warningProfiles.length}</b></button>
            <button type="button" role="tab" aria-selected={warningFilter === 'conflict'} className={warningFilter === 'conflict' ? 'is-active' : ''} onClick={() => setWarningFilter('conflict')}>Trùng / xung đột <b>{scheduleConflictWarnings.length}</b></button>
          </nav>
          {(warningFilter === 'conflict' || (warningFilter === 'priority' && scheduleConflictWarnings.length > 0)) && <section className="schedule-warning-conflicts" aria-label="Danh sách trùng và xung đột lịch">
            <header><div><strong>Lịch cần đối soát</strong><span>Chọn một dòng để mở đúng ô trong ma trận.</span></div><b>{scheduleConflictWarnings.length}</b></header>
            <div>{scheduleConflictWarnings.slice(0, 100).map((row) => <button type="button" key={row.key} onClick={() => { onOpenSlot(row.slotId, row.trainerId) }}><AlertTriangle size={16} /><span><strong>{row.studentName}</strong><small>{scheduleSlotLabel(row.slotId, weekDates)} · {row.trainerName}</small><em>{diagnosticReasonLabel(row.code)}</em></span><ChevronRight size={16} /></button>)}</div>
          </section>}
          {coveragePending && (workspace.validationSnapshot ? <RetainedValidation workspace={workspace} /> : <div className="schedule-warning-empty"><RefreshCw /><span>Thiếu buổi chưa đối soát. Chưa có kết quả đầy đủ; không thể kết luận là 0.{workspace.validationDirty ? ' Đang chờ đối soát nền.' : ''}</span></div>)}
          <section className="schedule-warning-grid">
             {visibleWarningProfiles.map(({ student, missingSessions: missing, scheduledSessions, scheduledEntries, crossBranchScheduledSessions, reasonCodes, primaryReasonCode, warningCause, actionCode, candidateSlots, suggestedSlots }) => {
               const expanded = expandedWarningStudentId === student.id
               const primaryReasons = Array.from(new Set([primaryReasonCode, ...reasonCodes])).filter((code): code is string => Boolean(code)).slice(0, 2)
               const topCandidates = (candidateSlots || []).filter((slot) => slot.availableTrainerIds?.length || slot.blockerCodes?.length).slice(0, 4)
               const weeklyCoverage = workspace.weeklySessionCoverage?.[student.id]
               const otherBranchEntries = (weeklyCoverage?.entries || []).filter((entry) => entry.branchId !== branchId)
               const studentContracts = workspace.contracts.filter((contract) => contract.studentId === student.id)
               const primaryContract = studentContracts.reduce<(typeof studentContracts)[number] | null>((current, contract) => {
                 if (!current) return contract
                 return String(current.endDate || '').localeCompare(String(contract.endDate || '')) < 0 ? contract : current
               }, null)
               const homeBranchName = branches.find((branch) => branch.id === (student.studentHomeBranchId || student.branchId))?.name || student.studentHomeBranchId || student.branchId || 'Chưa xác định'
               const allScheduledEntries = [
                 ...scheduledEntries.map((entry) => ({
                   id: `${entry.slotId}|${entry.trainerId}`,
                   label: entry.label,
                   branchName: workspace.branch.name,
                   trainerName: workspace.trainers.find((trainer) => trainer.id === entry.trainerId)?.name || 'PT chưa cập nhật',
                   crossBranch: false,
                 })),
                 ...otherBranchEntries.map((entry) => ({
                   id: entry.id,
                   label: `${entry.date}${entry.hour === null ? '' : ` · ${String(entry.hour).padStart(2, '0')}:00`}`,
                   branchName: branches.find((branch) => branch.id === entry.branchId)?.name || `Cơ sở ${entry.branchId}`,
                   trainerName: entry.trainerName || (entry.trainerId ? 'PT khác cơ sở' : 'PT chưa cập nhật'),
                   crossBranch: true,
                 })),
               ]
               const openDiagnosticSlot = (slot: NonNullable<typeof candidateSlots>[number]) => {
                const trainerId = slot.availableTrainerIds?.[0] || slot.blockedTrainerIds?.[0]
                if (!trainerId) return
                onOpenSlot(slot.slotId, trainerId)
              }
                return <article key={student.id} className={`schedule-warning-student is-cause-${warningCause}${student.eligibleForWeek ? '' : ' is-blocking'}${expanded ? ' is-expanded' : ''}`}>
                  <button type="button" onClick={() => openWarningStudentAvailability(student)} aria-expanded={expanded} aria-label={`Mở lịch rảnh của ${student.name}`}>
                  <AlertTriangle /><div><span className="schedule-warning-student__title"><strong>{student.name}</strong>{missing > 0 && <b>Thiếu {missing}</b>}</span><span className="schedule-warning-student__meta"><small className={`schedule-warning-cause-label is-${warningCause}`}>{warningCauseLabel(warningCause)}</small><b>{student.eligibleForWeek ? `${scheduledSessions}/${student.sessionsPerWeek} buổi${crossBranchScheduledSessions > 0 ? ` · +${crossBranchScheduledSessions} CS khác` : ''}` : 'Chưa đủ điều kiện'}</b></span><em className="schedule-warning-primary">{primaryReasons.length ? primaryReasons.map(diagnosticReasonLabel).join(' · ') : diagnosticReasonLabel(primaryReasonCode)}</em></div><ChevronRight />
                 </button>
                 {expanded && <Suspense fallback={<div className="schedule-warning-detail schedule-warning-detail--compact"><span>Đang tải chi tiết hồ sơ…</span></div>}><ScheduleWarningDetail student={student} workspace={workspace} branchId={branchId} weekDates={weekDates} scheduledSessions={scheduledSessions} crossBranchScheduledSessions={crossBranchScheduledSessions} actionCode={actionCode} topCandidates={topCandidates} suggestedSlots={suggestedSlots || []} primaryContract={primaryContract} homeBranchName={homeBranchName} allScheduledEntries={allScheduledEntries} openDiagnosticSlot={openDiagnosticSlot} /></Suspense>}
              </article>
            })}
            {warningFilter === 'priority' && !coveragePending && !warningProfiles.length && !scheduleConflictWarnings.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không còn cảnh báo.</div>}
            {warningFilter === 'contract' && !coveragePending && !contractWarningProfiles.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có cảnh báo hợp đồng.</div>}
            {warningFilter === 'learner' && !coveragePending && !learnerWarningProfiles.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có cảnh báo lịch rảnh.</div>}
            {warningFilter === 'capacity' && !coveragePending && !capacityWarningProfiles.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có cảnh báo thiếu PT / ca.</div>}
            {warningFilter === 'system' && !coveragePending && !systemWarningProfiles.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không còn mục cần tối ưu.</div>}
            {warningFilter === 'conflict' && !scheduleConflictWarnings.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có lịch trùng hoặc xung đột.</div>}
          </section>
        </main>
}
