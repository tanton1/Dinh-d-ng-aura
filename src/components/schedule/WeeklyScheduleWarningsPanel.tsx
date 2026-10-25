import { Fragment, lazy, Suspense, useLayoutEffect, useMemo } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, RefreshCw } from 'lucide-react'
import type { PtScheduleBranchOption, PtScheduleV2Student, PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'
import { contractStatusLabel, diagnosticReasonLabel, scheduleSlotLabel, warningCauseLabel, type WarningFilter } from '../../features/schedule/workspaceModel'
import { presentScheduleWarnings, type WarningProfile } from '../../features/schedule/warningPresentation'
const ScheduleWarningDetail = lazy(() => import('./ScheduleWarningDetail'))

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
  warningProfiles: WarningProfile[]
  scheduleConflictWarnings: Conflict[]
  expandedWarningStudentId: string | null
  openWarningStudentAvailability: (student: Pick<PtScheduleV2Student, 'id' | 'name'>) => void
  onOpenSlot: (slotId: string, trainerId: string) => void
}

export default function WeeklyScheduleWarningsPanel({ workspace, branchId, branches, weekDates, coveragePending, warningCount, warningFilter, setWarningFilter, warningProfiles, scheduleConflictWarnings, expandedWarningStudentId, openWarningStudentAvailability, onOpenSlot }: Props) {
  const { rows, hasTargets } = useMemo(() => presentScheduleWarnings(workspace, warningProfiles, coveragePending, weekDates), [workspace, warningProfiles, coveragePending, weekDates])
  const groups = useMemo(() => ({
    contract: rows.filter(profile => profile.warningCause === 'contract'),
    learner: rows.filter(profile => profile.warningCause === 'learner'),
    capacity: rows.filter(profile => profile.warningCause === 'capacity'),
    system: rows.filter(profile => profile.warningCause === 'system'),
  }), [rows])
  const { contract: contractWarningProfiles, learner: learnerWarningProfiles, capacity: capacityWarningProfiles, system: systemWarningProfiles } = groups
  const visibleWarningProfiles = warningFilter === 'priority' ? Object.values(groups).flat() : warningFilter === 'conflict' ? [] : groups[warningFilter]
  const warningMissingValue = hasTargets ? String(rows.length) : '—'
  const warningMissingNote = hasTargets
    ? `${rows.reduce((total, profile) => total + profile.missingSessions, 0)} buổi${coveragePending ? ' tạm tính' : ''} · draft r${workspace.draftRevision}`
    : 'Chưa có mục tiêu tuần đã đối soát'
  useLayoutEffect(() => {
    const panel = document.getElementById('schedule-panel-warnings')
    const toolbar = panel?.parentElement?.querySelector('.branch-schedule__toolbar')
    if (panel && toolbar && panel.getBoundingClientRect().top < toolbar.getBoundingClientRect().bottom) panel.scrollIntoView({ block: 'start' })
  }, [])
  return <main id="schedule-panel-warnings" role="tabpanel" aria-labelledby="schedule-tab-warnings" className="branch-schedule__warning-page">
          <header><h2>Cảnh báo</h2><span>{coveragePending ? 'Số buổi theo lịch đã lưu; điều kiện xếp lịch đang được đối soát' : warningCount ? `${warningCount} mục cần xử lý` : 'Không có cảnh báo'}</span></header>
          <section className={`schedule-warning-state${coveragePending ? ' is-pending' : ''}`} aria-label="Phiên bản cảnh báo" data-draft-revision={workspace.draftRevision}>
            <strong>Draft r{workspace.draftRevision}</strong><span>{coveragePending ? 'Tạm tính theo mục tiêu tuần đã lưu · chưa phải kết luận đối soát' : 'Đã đối soát với lịch hiện tại'}</span>
            {coveragePending && workspace.validationSnapshot && <details><summary>Lần đối soát gần nhất: draft r{workspace.validationSnapshot.draftRevision}</summary><p>{workspace.validationSnapshot.coverage.scheduledEntries}/{workspace.validationSnapshot.coverage.totalTargetSessions} buổi; còn thiếu {workspace.validationSnapshot.coverage.missingSessions} buổi ở lần đối soát trước. Số liệu này chỉ để tham khảo, không dùng làm số thiếu buổi hiện tại.{workspace.validationSnapshot.validatedAt ? ` Cập nhật: ${new Date(workspace.validationSnapshot.validatedAt).toLocaleString('vi-VN')}.` : ''}</p></details>}
          </section>
          <section className="schedule-warning-overview" aria-label="Tổng hợp cảnh báo lịch tập">
            <button type="button" className={`schedule-warning-stat is-missing${coveragePending ? ' is-pending' : ''}`} aria-pressed={warningFilter === 'priority'} onClick={() => setWarningFilter('priority')}><span className="schedule-warning-stat__value">{warningMissingValue}</span><span className="schedule-warning-stat__label">Thiếu buổi</span><small>{warningMissingNote}</small></button>
            <button type="button" className="schedule-warning-stat is-conflict" aria-pressed={warningFilter === 'conflict'} onClick={() => setWarningFilter('conflict')}><span className="schedule-warning-stat__value">{scheduleConflictWarnings.length}</span><span className="schedule-warning-stat__label">Trùng / xung đột</span><small>{coveragePending ? 'Phát hiện nhanh · chưa đối soát đầy đủ' : 'Chọn dòng để mở ma trận'}</small></button>
          </section>
          <section className="schedule-warning-summary" aria-label="Lọc theo lý do">
            <button type="button" className="is-contract" aria-pressed={warningFilter === 'contract'} onClick={() => setWarningFilter('contract')} disabled={!hasTargets}><strong>{hasTargets ? contractWarningProfiles.length : '—'}</strong><span>Do hợp đồng</span></button>
            <button type="button" className="is-learner" aria-pressed={warningFilter === 'learner'} onClick={() => setWarningFilter('learner')} disabled={!hasTargets}><strong>{hasTargets ? learnerWarningProfiles.length : '—'}</strong><span>Do lịch khách</span></button>
            <button type="button" className="is-capacity" aria-pressed={warningFilter === 'capacity'} onClick={() => setWarningFilter('capacity')} disabled={!hasTargets}><strong>{hasTargets ? capacityWarningProfiles.length : '—'}</strong><span>Thiếu PT / ca</span></button>
            <button type="button" className="is-system" aria-pressed={warningFilter === 'system'} onClick={() => setWarningFilter('system')} disabled={!hasTargets}><strong>{hasTargets ? systemWarningProfiles.length : '—'}</strong><span>Cần tối ưu</span></button>
          </section>
          <nav className="schedule-warning-filters" role="tablist" aria-label="Nhóm cảnh báo">
            <button type="button" role="tab" aria-selected={warningFilter === 'priority'} className={warningFilter === 'priority' ? 'is-active' : ''} onClick={() => setWarningFilter('priority')}>Thiếu buổi <b>{warningMissingValue}</b>{coveragePending && hasTargets && <span> tạm tính</span>}</button>
            <button type="button" role="tab" aria-selected={warningFilter === 'conflict'} className={warningFilter === 'conflict' ? 'is-active' : ''} onClick={() => setWarningFilter('conflict')}>Trùng / xung đột <b>{scheduleConflictWarnings.length}</b></button>
          </nav>
          {scheduleConflictWarnings.length > 0 && warningFilter === 'conflict' && <section className="schedule-warning-conflicts" aria-label="Danh sách trùng và xung đột lịch">
            <header><div><strong>Lịch cần đối soát</strong><span>Chọn một dòng để mở đúng ô trong ma trận.</span></div><b>{scheduleConflictWarnings.length}</b></header>
            <div>{scheduleConflictWarnings.slice(0, 100).map((row) => <button type="button" key={row.key} onClick={() => { onOpenSlot(row.slotId, row.trainerId) }}><AlertTriangle size={16} /><span><strong>{row.studentName}</strong><small>{scheduleSlotLabel(row.slotId, weekDates)} · {row.trainerName}</small><em>{diagnosticReasonLabel(row.code)}</em></span><ChevronRight size={16} /></button>)}</div>
          </section>}
          {!hasTargets && warningFilter !== 'conflict' && <div className="schedule-warning-empty"><RefreshCw /><span>Thiếu buổi chưa đối soát. Chưa có kết quả đầy đủ; không thể kết luận là 0.{workspace.validationDirty ? ' Đang chờ đối soát nền.' : ''}</span></div>}
          <section className="schedule-warning-grid">
             {visibleWarningProfiles.map(({ id, name, phone, email, targetSessions, student, missingSessions: missing, scheduledSessions, scheduledEntries, crossBranchScheduledSessions, reasonCodes, primaryReasonCode, warningCause, actionCode, candidateSlots, suggestedSlots }, index) => {
               const expanded = expandedWarningStudentId === id
               const primaryReasons = Array.from(new Set([primaryReasonCode, ...reasonCodes])).filter((code): code is string => Boolean(code)).slice(0, 1)
               const topCandidates = (candidateSlots || []).filter((slot) => slot.availableTrainerIds?.length || slot.blockerCodes?.length).slice(0, 4)
               const weeklyCoverage = workspace.weeklySessionCoverage?.[id] || (coveragePending ? workspace.validationSnapshot?.weeklySessionCoverage?.[id] : undefined)
               const otherBranchEntries = (weeklyCoverage?.entries || []).filter((entry) => entry.branchId !== branchId)
               const liveContracts = workspace.contracts.filter((contract) => contract.studentId === id)
               const studentContracts = liveContracts.length ? liveContracts : (workspace.validationSnapshot?.contracts || []).filter(contract => contract.studentId === id)
               const primaryContract = studentContracts.reduce<(typeof studentContracts)[number] | null>((current, contract) => {
                 if (!current) return contract
                 return String(current.endDate || '').localeCompare(String(contract.endDate || '')) < 0 ? contract : current
               }, null)
               const homeBranchName = branches.find((branch) => branch.id === (student?.studentHomeBranchId || student?.branchId))?.name || student?.studentHomeBranchId || student?.branchId || 'Chưa xác định'
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
                return <Fragment key={id}>
                  {(index === 0 || visibleWarningProfiles[index - 1].warningCause !== warningCause) && <h3 className={`schedule-warning-group is-${warningCause}`}>{warningCauseLabel(warningCause)} <span>{groups[warningCause].length}</span></h3>}
                  <article className={`schedule-warning-student is-cause-${warningCause}${student?.eligibleForWeek === false && !coveragePending ? ' is-blocking' : ''}${expanded ? ' is-expanded' : ''}`}>
                  <button type="button" onClick={() => openWarningStudentAvailability({ id, name })} aria-expanded={expanded} aria-label={`Mở lịch rảnh của ${name}`}>
                  <AlertTriangle /><div><span className="schedule-warning-student__title"><strong>{name}</strong>{missing > 0 && <b>Thiếu {missing}</b>}</span><span className="schedule-warning-student__meta"><small className={`schedule-warning-cause-label is-${warningCause}`}>{warningCauseLabel(warningCause)}</small><b>{`${scheduledSessions}/${targetSessions} buổi${crossBranchScheduledSessions > 0 ? ` · ${crossBranchScheduledSessions} CS khác` : ''}`}</b></span><em className="schedule-warning-primary">{primaryReasons.map(diagnosticReasonLabel).join(' · ') || diagnosticReasonLabel(primaryReasonCode)}</em></div><ChevronRight />
                 </button>
                 {expanded && (student ? <Suspense fallback={<div className="schedule-warning-detail schedule-warning-detail--compact"><span>Đang tải chi tiết hồ sơ…</span></div>}><ScheduleWarningDetail student={{ ...student, phone, email }} workspace={workspace} branchId={branchId} weekDates={weekDates} scheduledSessions={scheduledSessions} crossBranchScheduledSessions={crossBranchScheduledSessions} actionCode={actionCode} topCandidates={topCandidates} suggestedSlots={suggestedSlots || []} primaryContract={primaryContract} homeBranchName={homeBranchName} allScheduledEntries={allScheduledEntries} openDiagnosticSlot={openDiagnosticSlot} validationPending={coveragePending} /></Suspense>
                   : <div className="schedule-warning-detail schedule-warning-detail--compact"><section><small>Thông tin học viên đang cập nhật</small><strong>{phone || 'Thiếu số điện thoại'} · {email || 'Thiếu email'}</strong><span>{primaryContract?.packageName || 'Gói chưa có thông tin'} · {contractStatusLabel(primaryContract?.status)}{primaryContract?.endDate ? ` · hạn ${primaryContract.endDate}` : ''}</span><span>Chưa đủ hồ sơ để kết luận điều kiện xếp lịch.</span></section></div>)}
              </article></Fragment>
            })}
            {warningFilter === 'priority' && !coveragePending && !rows.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không còn học viên thiếu buổi.</div>}
            {coveragePending && hasTargets && warningFilter !== 'conflict' && !visibleWarningProfiles.length && <div className="schedule-warning-empty"><RefreshCw /> Chưa có học viên thiếu buổi trong nhóm này theo draft r{workspace.draftRevision}. Đang chờ đối soát đầy đủ.</div>}
            {warningFilter === 'contract' && !coveragePending && !contractWarningProfiles.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có cảnh báo hợp đồng.</div>}
            {warningFilter === 'learner' && !coveragePending && !learnerWarningProfiles.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có cảnh báo lịch rảnh.</div>}
            {warningFilter === 'capacity' && !coveragePending && !capacityWarningProfiles.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có cảnh báo thiếu PT / ca.</div>}
            {warningFilter === 'system' && !coveragePending && !systemWarningProfiles.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không còn mục cần tối ưu.</div>}
            {warningFilter === 'conflict' && !scheduleConflictWarnings.length && <div className="schedule-warning-empty">{coveragePending ? <><RefreshCw /> Chưa phát hiện xung đột trong dữ liệu đã tải. Chưa có kết quả đối soát đầy đủ.</> : <><CheckCircle2 /> Không có lịch trùng hoặc xung đột.</>}</div>}
          </section>
        </main>
}
