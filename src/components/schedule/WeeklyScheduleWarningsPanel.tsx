import { Fragment, lazy, Suspense, useLayoutEffect, useMemo } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, RefreshCw } from 'lucide-react'
import type { PtScheduleBranchOption, PtScheduleV2Student, PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'
import { diagnosticReasonLabel, scheduleSlotLabel, warningCauseLabel, type WarningFilter } from '../../features/schedule/workspaceModel'
import { presentScheduleWarnings, type WarningProfile } from '../../features/schedule/warningPresentation'
import { approvedOffForWeek } from '../../features/schedule/weeklyOff'
import { approvedOffDatesInWeek } from '../../features/schedule/offWarningPresentation'
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

export default function WeeklyScheduleWarningsPanel({ workspace, branchId, branches, weekDates, coveragePending, warningFilter, setWarningFilter, warningProfiles, scheduleConflictWarnings, expandedWarningStudentId, openWarningStudentAvailability, onOpenSlot }: Props) {
  const { rows, hasTargets } = useMemo(() => presentScheduleWarnings(workspace, warningProfiles, coveragePending, weekDates), [workspace, warningProfiles, coveragePending, weekDates])
  const approvedOffStudents = useMemo(() => workspace.students
    .filter(student => !student.isCrossBranchDisplayOnly && !['archived', 'deleted'].includes((student.status || '').toLowerCase()))
    .map(student => ({ student, dates: approvedOffDatesInWeek(student, workspace), fullWeek: approvedOffForWeek(student, workspace) }))
    .filter(row => row.dates.length > 0)
    .sort((left, right) => left.student.name.localeCompare(right.student.name, 'vi')), [workspace])
  const groups = useMemo(() => ({
    contract: rows.filter(profile => profile.warningCause === 'contract'),
    learner: rows.filter(profile => profile.warningCause === 'learner'),
    capacity: rows.filter(profile => profile.warningCause === 'capacity'),
    system: rows.filter(profile => profile.warningCause === 'system'),
  }), [rows])
  const visibleRows = warningFilter === 'priority' ? Object.values(groups).flat() : warningFilter === 'conflict' ? [] : groups[warningFilter]
  const missingCount = hasTargets ? String(rows.length) : '—'
  useLayoutEffect(() => {
    const panel = document.getElementById('schedule-panel-warnings')
    const toolbar = panel?.parentElement?.querySelector('.branch-schedule__toolbar')
    if (panel && toolbar && panel.getBoundingClientRect().top < toolbar.getBoundingClientRect().bottom) panel.scrollIntoView({ block: 'start' })
  }, [])
  return <main id="schedule-panel-warnings" role="tabpanel" aria-labelledby="schedule-tab-warnings" className="branch-schedule__warning-page branch-schedule__warning-page--simple">
    <header><h2>Cảnh báo</h2></header>
    <section className={`schedule-warning-state${coveragePending ? ' is-pending' : ''}`} aria-label="Phiên bản cảnh báo"
      data-draft-revision={workspace.draftRevision} data-validation-draft-revision={workspace.validationSnapshot?.draftRevision}
      data-missing-sessions={hasTargets ? rows.reduce((total, row) => total + row.missingSessions, 0) : undefined}>
      <strong>Draft r{workspace.draftRevision}</strong><span>{coveragePending ? 'Đang đối soát' : 'Đã đối soát'}</span>
    </section>
    {approvedOffStudents.length > 0 && <details className="schedule-approved-off" aria-label="Học viên OFF đã duyệt">
      <summary>OFF / bảo lưu đã duyệt <strong>{approvedOffStudents.length}</strong><span>Có ngày OFF trong tuần{coveragePending ? ' · Chờ đối soát' : ''}</span></summary>
      <ul>{approvedOffStudents.map(({ student, dates, fullWeek }) => <li key={student.id}><strong>{student.name}</strong>
        <span>{dates.map(date => date.slice(5).split('-').reverse().join('/')).join(', ')}</span>
        <span>{fullWeek ? 'OFF cả tuần hoạt động · Không tính thiếu buổi' : 'OFF một phần tuần · Vẫn kiểm tra buổi còn thiếu'}</span>
      </li>)}</ul>
    </details>}
    <nav className="schedule-warning-filters" role="tablist" aria-label="Nhóm cảnh báo">
      <button type="button" role="tab" aria-selected={warningFilter !== 'conflict'} className={`schedule-warning-stat is-missing${warningFilter !== 'conflict' ? ' is-active' : ''}`} onClick={() => setWarningFilter('priority')}>Thiếu buổi <b className="schedule-warning-stat__value">{missingCount}</b>{coveragePending && hasTargets && <span> tạm tính</span>}</button>
      <button type="button" role="tab" aria-selected={warningFilter === 'conflict'} className={warningFilter === 'conflict' ? 'is-active' : ''} onClick={() => setWarningFilter('conflict')}>Trùng / xung đột <b>{scheduleConflictWarnings.length}</b></button>
    </nav>
    <section className="schedule-warning-summary" aria-label="Lọc theo lý do">
      {(['contract', 'learner', 'capacity', 'system'] as const).map(cause => <button type="button" key={cause} className={`is-${cause}`} aria-pressed={warningFilter === cause} onClick={() => setWarningFilter(cause)} disabled={!hasTargets}><strong>{hasTargets ? groups[cause].length : '—'}</strong><span>{warningCauseLabel(cause)}</span></button>)}
    </section>
    {scheduleConflictWarnings.length > 0 && warningFilter === 'conflict' && <section className="schedule-warning-conflicts" aria-label="Danh sách trùng và xung đột lịch">
      <div>{scheduleConflictWarnings.slice(0, 100).map(row => <button type="button" key={row.key} onClick={() => onOpenSlot(row.slotId, row.trainerId)}><AlertTriangle size={16} /><span><strong>{row.studentName}</strong><small>{scheduleSlotLabel(row.slotId, weekDates)} · {row.trainerName}</small><em>{diagnosticReasonLabel(row.code)}</em></span><ChevronRight size={16} /></button>)}</div>
    </section>}
    {!hasTargets && warningFilter !== 'conflict' && <div className="schedule-warning-empty"><RefreshCw /> Đang cập nhật mục tiêu tuần.</div>}
    <section className="schedule-warning-grid">
      {visibleRows.map((row, index) => {
        const { id, name, targetSessions, scheduledSessions, warningCause } = row
        const expanded = expandedWarningStudentId === id
        return <Fragment key={id}>
          {(index === 0 || visibleRows[index - 1].warningCause !== warningCause) && <h3 className={`schedule-warning-group is-${warningCause}`}>{warningCauseLabel(warningCause)} <span>{groups[warningCause].length}</span></h3>}
          <article className={`schedule-warning-student is-cause-${warningCause}${expanded ? ' is-expanded' : ''}`}>
            <button type="button" onClick={() => openWarningStudentAvailability({ id, name })} aria-expanded={expanded} aria-controls={expanded ? `warning-detail-${id}` : undefined} aria-label={`Mở lịch rảnh của ${name}`}>
              <strong>{name}</strong><span className="schedule-warning-ratio">{scheduledSessions}/{targetSessions} buổi</span><ChevronRight />
            </button>
            {expanded && <Suspense fallback={<div role="status">Đang mở lịch…</div>}><ScheduleWarningDetail row={row} workspace={workspace} branchId={branchId} branches={branches} weekDates={weekDates} coveragePending={coveragePending} /></Suspense>}
          </article>
        </Fragment>
      })}
      {hasTargets && warningFilter !== 'conflict' && !visibleRows.length && <div className="schedule-warning-empty">{coveragePending ? <><RefreshCw /> Chưa có học viên thiếu buổi · đang đối soát.</> : <><CheckCircle2 /> Không có học viên thiếu buổi trong nhóm này.</>}</div>}
      {warningFilter === 'conflict' && !scheduleConflictWarnings.length && <div className="schedule-warning-empty">{coveragePending ? <><RefreshCw /> Chưa phát hiện xung đột trong dữ liệu đã tải. Chưa có kết quả đối soát đầy đủ.</> : <><CheckCircle2 /> Không có lịch trùng hoặc xung đột.</>}</div>}
    </section>
  </main>
}
