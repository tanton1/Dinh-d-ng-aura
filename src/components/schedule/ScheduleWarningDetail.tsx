import type { PtScheduleBranchOption, PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'
import type { WarningRow } from '../../features/schedule/warningPresentation'
import { DAY_LABELS, scheduleSlotLabel } from '../../features/schedule/workspaceModel'
import { approvedOffOnDate, scheduleDate } from '../../features/schedule/weeklyOff'

interface Props {
  row: WarningRow
  workspace: PtScheduleWorkspaceV2Result
  branchId: string
  branches: PtScheduleBranchOption[]
  weekDates: Record<string, { display: string; full: string }>
  coveragePending: boolean
}

// Opening a learner reuses the weekly snapshot, with no profile/contract reads.
export default function ScheduleWarningDetail({ row, workspace, branchId, branches, weekDates, coveragePending }: Props) {
  const { student } = row
  const coverage = workspace.weeklySessionCoverage?.[row.id]
    || (coveragePending ? workspace.validationSnapshot?.weeklySessionCoverage?.[row.id] : undefined)
  const schedule = [
    ...row.scheduledEntries.map(entry => ({ id: `${entry.slotId}|${entry.trainerId}`, label: entry.label,
      branch: branches.find(branch => branch.id === branchId)?.name || 'Cơ sở hiện tại', trainer: workspace.trainers.find(t => t.id === entry.trainerId)?.name || 'PT chưa cập nhật', crossBranch: false })),
    ...(coverage?.entries || []).filter(entry => entry.branchId !== branchId).map(entry => {
      const day = Object.keys(weekDates).find(day => weekDates[day].full === entry.date)
      return { id: entry.id, label: day && entry.hour !== null ? scheduleSlotLabel(`${day}-${entry.hour}`, weekDates) : entry.date,
        branch: branches.find(branch => branch.id === entry.branchId)?.name || 'Cơ sở khác',
        trainer: entry.trainerName || workspace.trainers.find(t => t.id === entry.trainerId)?.name || 'PT chưa cập nhật', crossBranch: true }
    }),
  ]
  const dates = Object.values(weekDates).map(day => day.full).sort()
  const liveContracts = workspace.contracts.filter(contract => contract.studentId === row.id)
  const knownContracts = liveContracts.length ? liveContracts : workspace.validationSnapshot?.contracts || []
  const assignedIds = new Set(knownContracts.filter(contract => contract.studentId === row.id
    && (student?.eligibleContractIds.length ? student.eligibleContractIds.includes(contract.id)
      : !['cancelled', 'expired', 'completed'].includes(contract.status)
        && contract.startDate <= (dates.at(-1) || workspace.weekId) && contract.endDate >= workspace.weekId))
    .flatMap(contract => [contract.trainerId, ...(contract.trainerIds || [])]).filter(Boolean))
  const managers = workspace.trainers.filter(trainer => assignedIds.has(trainer.id)).map(trainer => trainer.name).filter(Boolean)
  const availability = (workspace.scheduleConfig.workingDays || []).map(day => ({ day,
    hours: [...new Set((student?.availableSlots || []).filter(slot => slot.split('-')[0] === day)
      .map(slot => Number(slot.split('-')[1])).filter(Number.isFinite))].sort((a, b) => a - b),
  })).filter(({ day, hours }) => hours.length && !(workspace.scheduleConfig.holidays || []).includes(scheduleDate(workspace.weekId, day))
    && !approvedOffOnDate(student, scheduleDate(workspace.weekId, day)))

  return <div className="schedule-warning-detail schedule-warning-detail--simple" id={`warning-detail-${row.id}`}>
    {managers.length > 0 && <section className="schedule-warning-managers"><h4>PT quản lý</h4><p>{managers.join(', ')}</p></section>}
    <section className="schedule-warning-availability"><h4>Lịch rảnh</h4>
      {availability.length ? <dl>{availability.map(({ day, hours }) => <div key={day}><dt>{DAY_LABELS[day] || day}</dt><dd>{hours.map(hour => `${String(hour).padStart(2, '0')}:00`).join(', ')}</dd></div>)}</dl>
        : <p>{student ? 'Chưa có lịch rảnh' : 'Chưa có dữ liệu lịch rảnh'}</p>}
    </section>
    <section className="schedule-warning-schedule"><h4>Đã xếp</h4>
      {schedule.length ? <ul>{schedule.map(entry => <li key={entry.id} className={entry.crossBranch ? 'is-cross-branch' : ''}><strong>{entry.label}</strong><span>{entry.trainer} · {entry.branch}</span></li>)}</ul>
        : <p>Chưa có buổi đã xếp</p>}
    </section>
  </div>
}
