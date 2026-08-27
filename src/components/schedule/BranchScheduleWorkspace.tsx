import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CalendarOff,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Unlock,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import type { AccessContext } from '../../identity/access'
import { getDatesForWeek } from '../../utils/dateUtils'
import {
  applyPtScheduleDraftCommand,
  asPtSchedulePublishError,
  generatePtScheduleDraft,
  getPtScheduleSlotCandidates,
  getPtScheduleWorkspace,
  listPtScheduleBranches,
  listPtScheduleVersions,
  ptScheduleConflictLabel,
  publishPtSchedule,
  restorePtScheduleVersionToDraft,
  validatePtScheduleDraft,
  type PtScheduleBranchOption,
  type PtScheduleDraftCommand,
  type PtSchedulePublishResult,
  type PtScheduleSlotCandidate,
  type PtScheduleVersionListResult,
  type PtScheduleVersionSummary,
  type PtScheduleWorkspaceV2Result,
} from '../../services/ptSchedulePublishService'
import '../../styles-branch-schedule.css'

interface Props {
  accessContext: AccessContext
  onNavigate?: (view: 'admin-pt-students' | 'admin-training-history') => void
}

type WorkspaceTab = 'matrix' | 'students' | 'warnings' | 'history'
type StudentFilter = 'all' | 'missing' | 'availability' | 'ready'

const DAY_LABELS: Record<string, string> = {
  T2: 'Thứ 2',
  T3: 'Thứ 3',
  T4: 'Thứ 4',
  T5: 'Thứ 5',
  T6: 'Thứ 6',
  T7: 'Thứ 7',
  CN: 'Chủ nhật',
}

function formatPublishedAt(value: string | null) {
  if (!value) return 'Chưa có thời gian'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? 'Chưa có thời gian'
    : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

function commandKey() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `schedule-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function scheduleSlotLabel(slotId: string, dates: Record<string, { display: string; full: string }>) {
  const [day, rawHour] = slotId.split('-')
  const hour = Number(rawHour)
  return `${DAY_LABELS[day] || day} ${dates[day]?.display || ''} · ${String(hour).padStart(2, '0')}:00`
}

function availabilitySlotLabel(slotId: string) {
  const [day, rawHour] = slotId.split('-')
  return `${DAY_LABELS[day] || day} ${String(Number(rawHour)).padStart(2, '0')}:00`
}

function compareScheduleSlots(left: string, right: string) {
  const [leftDay, leftHour] = left.split('-')
  const [rightDay, rightHour] = right.split('-')
  const days = Object.keys(DAY_LABELS)
  return days.indexOf(leftDay) - days.indexOf(rightDay) || Number(leftHour) - Number(rightHour)
}

export default function BranchScheduleWorkspace({ accessContext, onNavigate }: Props) {
  const [branches, setBranches] = useState<PtScheduleBranchOption[]>([])
  const [branchId, setBranchId] = useState(accessContext.branchIds[0] || '')
  const [weekOffset, setWeekOffset] = useState(0)
  const [workspace, setWorkspace] = useState<PtScheduleWorkspaceV2Result | null>(null)
  const [selectedTrainerId, setSelectedTrainerId] = useState('')
  const [tab, setTab] = useState<WorkspaceTab>('matrix')
  const [mobilePage, setMobilePage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [publishPreview, setPublishPreview] = useState<PtSchedulePublishResult | null>(null)
  const [history, setHistory] = useState<PtScheduleVersionListResult | null>(null)
  const [restoreCandidate, setRestoreCandidate] = useState<PtScheduleVersionSummary | null>(null)
  const [inspectorSlotId, setInspectorSlotId] = useState<string | null>(null)
  const [candidateSearch, setCandidateSearch] = useState('')
  const [candidates, setCandidates] = useState<PtScheduleSlotCandidate[]>([])
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [offConfirmation, setOffConfirmation] = useState(false)
  const [studentSearch, setStudentSearch] = useState('')
  const [studentFilter, setStudentFilter] = useState<StudentFilter>('all')
  const [expandedWarningStudentId, setExpandedWarningStudentId] = useState<string | null>(null)

  const weekDates = useMemo(() => getDatesForWeek(weekOffset), [weekOffset])
  const currentWeekId = weekDates.T2.full
  const workingDays = workspace?.scheduleConfig.workingDays?.length
    ? workspace.scheduleConfig.workingDays
    : ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
  const workingHours = workspace?.scheduleConfig.workingHours?.length
    ? workspace.scheduleConfig.workingHours
    : Array.from({ length: 16 }, (_, index) => index + 6)
  const mobileGroups = useMemo(() => {
    const result: string[][] = []
    for (let index = 0; index < workingDays.length; index += 2) result.push(workingDays.slice(index, index + 2))
    return result
  }, [workingDays])

  const loadWorkspace = useCallback(async (quiet = false) => {
    if (!branchId) return
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const result = await getPtScheduleWorkspace({ weekId: currentWeekId, branchId })
      setWorkspace(result)
      setSelectedTrainerId((current) => result.trainers.some((trainer) => trainer.id === current)
        ? current
        : result.trainers[0]?.id || '')
    } catch (loadError) {
      setWorkspace(null)
      setError(asPtSchedulePublishError(loadError).message)
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [branchId, currentWeekId])

  useEffect(() => {
    let active = true
    listPtScheduleBranches()
      .then((result) => {
        if (!active) return
        setBranches(result.branches)
        setBranchId((current) => result.branches.some((branch) => branch.id === current)
          ? current
          : result.branches[0]?.id || '')
      })
      .catch((branchError) => {
        if (!active) return
        setBranches(accessContext.branchIds.map((id) => ({ id, name: id, status: 'active' })))
        setError(asPtSchedulePublishError(branchError).message)
      })
    return () => { active = false }
  }, [accessContext.branchIds])

  useEffect(() => {
    void loadWorkspace()
    setNotice(null)
    setPublishPreview(null)
    setHistory(null)
    setInspectorSlotId(null)
    setMobilePage(0)
  }, [loadWorkspace])

  const selectedTrainer = workspace?.trainers.find((trainer) => trainer.id === selectedTrainerId) || null
  const inspectorEntries = useMemo(() => {
    if (!workspace || !inspectorSlotId || !selectedTrainerId) return []
    return (workspace.schedule[inspectorSlotId] || []).filter((entry) => entry.trainerId === selectedTrainerId)
  }, [inspectorSlotId, selectedTrainerId, workspace])

  const scheduledEntriesByStudent = useMemo(() => {
    const result = new Map<string, Array<{ slotId: string; trainerId: string; contractId: string; label: string }>>()
    if (!workspace) return result
    for (const [slotId, entries] of Object.entries(workspace.schedule)) {
      for (const entry of entries) {
        if (entry.type === 'off') continue
        const values = result.get(entry.studentId) || []
        values.push({
          slotId,
          trainerId: entry.trainerId,
          contractId: entry.contractId || '',
          label: scheduleSlotLabel(slotId, weekDates),
        })
        result.set(entry.studentId, values)
      }
    }
    for (const values of result.values()) values.sort((left, right) => compareScheduleSlots(left.slotId, right.slotId))
    return result
  }, [weekDates, workspace])

  const operationalStudentRows = useMemo(() => {
    if (!workspace) return []
    return workspace.students.filter((student) => student.eligibleForWeek === true).map((student) => {
      const scheduledEntries = scheduledEntriesByStudent.get(student.id) || []
      const scheduled = scheduledEntries.length
      const missing = Math.max(0, Number(student.sessionsPerWeek || 0) - scheduled)
      const eligibleContractIds = new Set(student.eligibleContractIds || [])
      const contracts = workspace.contracts
        .filter((contract) => contract.studentId === student.id && eligibleContractIds.has(contract.id))
        .sort((left, right) => String(left.endDate || '').localeCompare(String(right.endDate || '')))
      const contract = contracts[0] || null
      const trainerIds = [...new Set([
        contract?.trainerId,
        ...(contract?.trainerIds || []),
        ...scheduledEntries.map((entry) => entry.trainerId),
      ].filter((value): value is string => Boolean(value)))]
      const trainerNames = trainerIds.map((id) => workspace.trainers.find((trainer) => trainer.id === id)?.name).filter(Boolean).join(', ')
      const inputWarning = missing > 0
        || !['submitted', 'locked', 'recurring'].includes(student.availabilityStatus)
        || student.eligibilityReasons.includes('AMBIGUOUS_ACTIVE_CONTRACT')
      return { student, scheduled, scheduledEntries, missing, contract, trainerNames, inputWarning }
    })
  }, [scheduledEntriesByStudent, workspace])

  const studentWarnings = useMemo(() => operationalStudentRows.filter((row) => row.inputWarning), [operationalStudentRows])
  const ineligibleDraftRows = useMemo(() => (workspace?.students || [])
    .filter((student) => student.eligibleForWeek !== true && (scheduledEntriesByStudent.get(student.id)?.length || 0) > 0)
    .map((student) => ({ student, scheduledEntries: scheduledEntriesByStudent.get(student.id) || [] })), [scheduledEntriesByStudent, workspace])
  const missingSessions = studentWarnings.reduce((total, item) => total + item.missing, 0)
  const studentRows = useMemo(() => {
    const needle = studentSearch.trim().toLocaleLowerCase('vi-VN')
    return operationalStudentRows.filter((row) => {
      if (studentFilter === 'missing' && row.missing < 1) return false
      if (studentFilter === 'availability' && ['submitted', 'locked', 'recurring'].includes(row.student.availabilityStatus)) return false
      if (studentFilter === 'ready' && row.inputWarning) return false
      if (!needle) return true
      return [row.student.name, row.student.phone, row.contract?.packageName, row.trainerNames]
        .some((value) => String(value || '').toLocaleLowerCase('vi-VN').includes(needle))
    }).sort((left, right) => right.missing - left.missing || (left.student.name || '').localeCompare(right.student.name || '', 'vi'))
  }, [operationalStudentRows, studentFilter, studentSearch])

  useEffect(() => {
    if (!workspace || !inspectorSlotId || !selectedTrainerId) {
      setCandidates([])
      return undefined
    }
    let active = true
    const timer = window.setTimeout(() => {
      setCandidateLoading(true)
      getPtScheduleSlotCandidates({
        weekId: currentWeekId,
        branchId,
        trainerId: selectedTrainerId,
        slotId: inspectorSlotId,
        search: candidateSearch,
      }).then((result) => {
        if (active) setCandidates(result.candidates)
      }).catch((candidateError) => {
        if (active) setError(asPtSchedulePublishError(candidateError).message)
      }).finally(() => {
        if (active) setCandidateLoading(false)
      })
    }, 220)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [branchId, candidateSearch, currentWeekId, inspectorSlotId, selectedTrainerId, workspace?.draftRevision])

  const runCommand = async (command: PtScheduleDraftCommand, payload: Record<string, unknown>, reason?: string) => {
    if (!workspace) return
    setBusy(true)
    setError(null)
    try {
      const result = await applyPtScheduleDraftCommand({
        weekId: currentWeekId,
        branchId,
        expectedDraftRevision: workspace.draftRevision,
        command,
        payload,
        reason,
        idempotencyKey: commandKey(),
      })
      if (command === 'set_student_weekly_target') {
        await loadWorkspace(true)
      } else {
        setWorkspace((current) => current ? {
          ...current,
          schedule: result.schedule,
          draftRevision: result.draftRevision,
          draftStatus: 'draft',
        } : current)
      }
      setNotice(`Đã lưu draft r${result.draftRevision}.`)
      setOffConfirmation(false)
    } catch (commandError) {
      const normalized = asPtSchedulePublishError(commandError)
      setError(normalized.message)
      if (normalized.issueCode === 'REVISION_CONFLICT') await loadWorkspace(true)
    } finally {
      setBusy(false)
    }
  }

  const setWeeklyTarget = async (studentId: string, targetSessions: number | null) => {
    await runCommand('set_student_weekly_target', targetSessions === null
      ? { studentId, resetToDefault: true }
      : { studentId, targetSessions }, targetSessions === null ? 'Khôi phục định mức hồ sơ' : 'Điều chỉnh mục tiêu riêng cho tuần')
  }

  const autoArrange = async () => {
    if (!workspace) return
    setBusy(true)
    setError(null)
    try {
      const result = await generatePtScheduleDraft({
        weekId: currentWeekId,
        branchId,
        expectedDraftRevision: workspace.draftRevision,
      })
      setWorkspace((current) => current ? {
        ...current,
        schedule: result.schedule,
        draftRevision: result.draftRevision,
        draftStatus: 'draft',
        warnings: result.warnings,
      } : current)
      setNotice(result.warnings.length
        ? `Đã tạo draft r${result.draftRevision}; còn ${result.warnings.length} hồ sơ cần xử lý.`
        : `Đã tạo draft r${result.draftRevision} bằng bộ xếp lịch ${result.generatorVersion}.`)
    } catch (arrangeError) {
      const normalized = asPtSchedulePublishError(arrangeError)
      setError(normalized.message)
      if (normalized.issueCode === 'REVISION_CONFLICT') await loadWorkspace(true)
    } finally {
      setBusy(false)
    }
  }

  const validatePublish = async () => {
    if (!workspace) return
    setBusy(true)
    setError(null)
    try {
      setPublishPreview(await validatePtScheduleDraft({
        weekId: currentWeekId,
        branchId,
        expectedDraftRevision: workspace.draftRevision,
      }))
    } catch (validateError) {
      const normalized = asPtSchedulePublishError(validateError)
      setError([normalized.message, ...normalized.conflicts.map(ptScheduleConflictLabel)].join(' · '))
      setTab('warnings')
    } finally {
      setBusy(false)
    }
  }

  const confirmPublish = async () => {
    if (!publishPreview) return
    setBusy(true)
    setError(null)
    try {
      const result = await publishPtSchedule({
        weekId: currentWeekId,
        branchId,
        expectedDraftRevision: publishPreview.draftRevision,
      })
      setPublishPreview(null)
      setNotice(result.unchanged ? `Lịch đã ở phiên bản v${result.version}.` : `Đã publish an toàn phiên bản v${result.version}.`)
      await loadWorkspace(true)
    } catch (publishError) {
      setError(asPtSchedulePublishError(publishError).message)
    } finally {
      setBusy(false)
    }
  }

  const openHistory = async () => {
    setTab('history')
    setBusy(true)
    setError(null)
    try {
      setHistory(await listPtScheduleVersions({ weekId: currentWeekId, branchId }))
    } catch (historyError) {
      setError(asPtSchedulePublishError(historyError).message)
    } finally {
      setBusy(false)
    }
  }

  const restoreVersion = async () => {
    if (!history || !restoreCandidate) return
    setBusy(true)
    try {
      const result = await restorePtScheduleVersionToDraft({
        weekId: currentWeekId,
        branchId,
        version: restoreCandidate.version,
        expectedDraftRevision: history.currentDraftRevision,
      })
      setRestoreCandidate(null)
      setHistory(null)
      setTab('matrix')
      setNotice(`Đã tạo draft r${result.draftRevision} từ phiên bản v${result.version}.`)
      await loadWorkspace(true)
    } catch (restoreError) {
      setError(asPtSchedulePublishError(restoreError).message)
    } finally {
      setBusy(false)
    }
  }

  const studentName = (studentId: string) => workspace?.students.find((student) => student.id === studentId)?.name || 'Học viên đã xóa'
  const selectedDays = mobileGroups[mobilePage] || mobileGroups[0] || []

  if (!branchId && !loading && branches.length === 0) {
    return <section className="branch-schedule branch-schedule__blocked"><CalendarDays size={30} /><h1>Chưa có chi nhánh hoạt động</h1><p>Hãy tạo chi nhánh hoặc cấp phạm vi trước khi xếp lịch.</p></section>
  }

  return (
    <div className="branch-schedule">
      <header className="branch-schedule__hero">
        <div>
          <span><CalendarDays size={16} /> AURA PT · LỊCH VẬN HÀNH</span>
          <h1>Xếp lịch & ca tập</h1>
          <p>Mỗi chỉnh sửa được kiểm tra theo ngày hợp đồng, chi nhánh, PT, lịch rảnh và revision hiện tại.</p>
        </div>
        <div className="branch-schedule__hero-controls">
          <label><span>Chi nhánh</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <div className="branch-schedule__week">
            <button type="button" aria-label="Tuần trước" onClick={() => setWeekOffset((value) => Math.max(0, value - 1))}><ChevronLeft /></button>
            <div><span>Tuần làm việc</span><strong>{weekDates.T2.display} – {weekDates.CN.display}</strong></div>
            <button type="button" aria-label="Tuần sau" onClick={() => setWeekOffset((value) => value + 1)}><ChevronRight /></button>
          </div>
        </div>
      </header>

      <section className="branch-schedule__metrics" aria-label="Tổng quan lịch">
        <article><UsersRound /><div><strong>{workspace?.summary.eligibleStudents || 0}</strong><span>Học viên đủ điều kiện</span></div></article>
        <article><CheckCircle2 /><div><strong>{workspace ? Object.values(workspace.schedule).flat().filter((entry) => entry.type !== 'off').length : 0}</strong><span>Buổi trong draft</span></div></article>
        <article className={missingSessions > 0 ? 'is-warning' : ''}><AlertTriangle /><div><strong>{missingSessions}</strong><span>Buổi còn thiếu</span></div></article>
        <article className={(workspace?.summary.unconfiguredTrainers || 0) > 0 ? 'is-warning' : ''}><Clock3 /><div><strong>{workspace?.summary.unconfiguredTrainers || 0}</strong><span>PT thiếu lịch rảnh</span></div></article>
      </section>

      <section className="branch-schedule__toolbar">
        <div className="branch-schedule__tabs" role="tablist">
          <button type="button" className={tab === 'matrix' ? 'is-active' : ''} onClick={() => setTab('matrix')}>Ma trận</button>
          <button type="button" className={tab === 'students' ? 'is-active' : ''} onClick={() => setTab('students')}>Học viên <b>{workspace?.summary.eligibleStudents || 0}</b></button>
          <button type="button" className={tab === 'warnings' ? 'is-active' : ''} onClick={() => setTab('warnings')}>Cảnh báo <b>{studentWarnings.length + ineligibleDraftRows.length + (workspace?.summary.unconfiguredTrainers || 0)}</b></button>
          <button type="button" className={tab === 'history' ? 'is-active' : ''} onClick={() => void openHistory()}>Phiên bản</button>
        </div>
        <div className="branch-schedule__actions">
          <button type="button" onClick={() => void autoArrange()} disabled={!workspace || busy}><Sparkles size={16} /> Xếp tự động</button>
          <button type="button" className="is-publish" onClick={() => void validatePublish()} disabled={!workspace || busy}><CheckCircle2 size={16} /> Kiểm tra & Publish</button>
          <button type="button" aria-label="Tải lại" onClick={() => void loadWorkspace()} disabled={loading || busy}><RefreshCw size={16} className={loading ? 'is-spinning' : ''} /></button>
        </div>
      </section>

      {notice && <div className="branch-schedule__notice" role="status">{notice}</div>}
      {error && <div className="branch-schedule__error" role="alert">{error}</div>}
      {loading && !workspace && <div className="branch-schedule__loading"><RefreshCw className="is-spinning" /> Đang tải workspace theo phạm vi…</div>}

      {workspace && tab === 'matrix' && (
        <main className="branch-schedule__workspace">
          <section className="branch-schedule__matrix-toolbar">
            <label><span>Huấn luyện viên</span><select value={selectedTrainerId} onChange={(event) => setSelectedTrainerId(event.target.value)}>{workspace.trainers.map((trainer) => <option key={trainer.id} value={trainer.id}>{trainer.name}</option>)}</select></label>
            {selectedTrainer && <div className={`trainer-availability-chip is-${selectedTrainer.availabilityMode}`}><Clock3 size={14} />{selectedTrainer.availabilityMode === 'configured' ? `${selectedTrainer.availableSlots?.length || 0} khung giờ rảnh` : selectedTrainer.availabilityMode === 'unrestricted' ? 'Không giới hạn' : 'Chưa khai lịch rảnh'}</div>}
            <div className="branch-schedule__draft-meta"><span>Draft r{workspace.draftRevision}</span><span>Published v{workspace.publishedVersion}</span></div>
          </section>

          <div className="branch-schedule__mobile-days">
            <button type="button" disabled={mobilePage === 0} onClick={() => setMobilePage((value) => Math.max(0, value - 1))}><ChevronLeft /></button>
            <strong>{selectedDays.map((day) => DAY_LABELS[day] || day).join(' · ')}</strong>
            <button type="button" disabled={mobilePage >= mobileGroups.length - 1} onClick={() => setMobilePage((value) => Math.min(mobileGroups.length - 1, value + 1))}><ChevronRight /></button>
          </div>

          <div className="branch-schedule__matrix-shell">
            <table className="branch-schedule__grid">
              <thead><tr><th>Giờ</th>{workingDays.map((day) => <th key={day} className={selectedDays.includes(day) ? 'is-mobile-visible' : ''}><span>{DAY_LABELS[day] || day}</span><small>{weekDates[day as keyof typeof weekDates]?.display}</small></th>)}</tr></thead>
              <tbody>{workingHours.map((hour) => <tr key={hour}><th>{String(hour).padStart(2, '0')}:00</th>{workingDays.map((day) => {
                const slotId = `${day}-${hour}`
                const entries = (workspace.schedule[slotId] || []).filter((entry) => entry.trainerId === selectedTrainerId)
                const isOff = entries.some((entry) => entry.type === 'off')
                return <td key={slotId} className={selectedDays.includes(day) ? 'is-mobile-visible' : ''}><button type="button" className={`schedule-cell${isOff ? ' is-off' : ''}${entries.length ? ' has-entry' : ''}`} onClick={() => { setInspectorSlotId(slotId); setCandidateSearch(''); setOffConfirmation(false) }} disabled={!selectedTrainerId}><span className="schedule-cell__count">{isOff ? 'OFF' : `${entries.length}/${selectedTrainer?.slotCapacity || 2}`}</span>{isOff ? <CalendarOff /> : entries.length ? entries.filter((entry) => entry.type !== 'off').map((entry) => <em key={`${entry.studentId}-${entry.trainerId}`}>{studentName(entry.studentId)}{entry.isLocked && <Lock size={11} />}</em>) : <small>Chạm để xếp</small>}</button></td>
              })}</tr>)}</tbody>
            </table>
          </div>
        </main>
      )}

      {workspace && tab === 'students' && (
        <main className="branch-schedule__students-page">
          <header><div><p>AURA PT · HỌC VIÊN TRONG TUẦN</p><h2>Hồ sơ cần xếp lịch</h2><span>Đối chiếu gói tập, PT phụ trách, lịch rảnh và số buổi còn thiếu ngay trong phạm vi chi nhánh.</span></div>{onNavigate && <button type="button" onClick={() => onNavigate('admin-pt-students')}><UserPlus size={16} /> Mở hồ sơ học viên</button>}</header>
          <div className="branch-schedule__student-tools">
            <label><Search size={17} /><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Tên, SĐT, gói tập hoặc PT" /></label>
            <div role="group" aria-label="Lọc học viên theo trạng thái">
              {([
                ['all', 'Tất cả'],
                ['missing', 'Còn thiếu'],
                ['availability', 'Thiếu lịch rảnh'],
                ['ready', 'Đã đủ'],
              ] as Array<[StudentFilter, string]>).map(([value, label]) => <button type="button" key={value} className={studentFilter === value ? 'is-active' : ''} onClick={() => setStudentFilter(value)}>{label}</button>)}
            </div>
          </div>
          <div className="branch-schedule__student-list">
            {studentRows.map(({ student, scheduled, scheduledEntries, missing, contract, trainerNames }) => <article key={student.id} className={missing > 0 ? 'is-missing' : 'is-ready'}>
              <div className="branch-schedule__student-person"><span><UsersRound size={17} /></span><div><strong>{student.name || 'Chưa cập nhật tên'}</strong><small>{student.phone || `Mã ${student.id.slice(-8)}`}</small></div></div>
              <div className="branch-schedule__student-contract"><small>Gói &amp; PT</small><strong>{contract?.packageName || 'Cần đối soát hợp đồng'}</strong><span>{trainerNames || 'Chưa phân PT'} · {contract ? `còn ${Math.max(0, Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0))} buổi` : 'chưa có gói phù hợp'}</span></div>
              <div className="branch-schedule__weekly-target"><small>Mục tiêu tuần</small><div><button type="button" aria-label={`Giảm mục tiêu tuần của ${student.name}`} disabled={busy || student.sessionsPerWeek <= scheduled} onClick={() => void setWeeklyTarget(student.id, student.sessionsPerWeek - 1)}><Minus /></button><strong>{student.sessionsPerWeek}</strong><button type="button" aria-label={`Tăng mục tiêu tuần của ${student.name}`} disabled={busy || student.sessionsPerWeek >= student.maxWeeklySessions} onClick={() => void setWeeklyTarget(student.id, student.sessionsPerWeek + 1)}><Plus /></button>{student.weeklySessionTargetOverridden && <button type="button" className="is-reset" title={`Về mặc định ${student.defaultSessionsPerWeek} buổi`} aria-label={`Khôi phục mục tiêu mặc định của ${student.name}`} disabled={busy || Math.min(student.defaultSessionsPerWeek, student.maxWeeklySessions) < scheduled} onClick={() => void setWeeklyTarget(student.id, null)}><RotateCcw /></button>}</div><span>{student.weeklySessionTargetOverridden ? `Tạm thời · mặc định ${student.defaultSessionsPerWeek}` : `Mặc định hồ sơ · tối đa ${student.maxWeeklySessions}`}</span></div>
              <div className="branch-schedule__student-progress"><strong>{scheduled}/{student.sessionsPerWeek}</strong><span>{missing > 0 ? `Thiếu ${missing}` : 'Đã đủ'}</span><i><b style={{ width: `${Math.min(100, student.sessionsPerWeek ? scheduled / student.sessionsPerWeek * 100 : 100)}%` }} /></i></div>
              <div className="branch-schedule__student-schedule"><small>Lịch được xếp · {['submitted', 'locked'].includes(student.availabilityStatus) ? 'đã gửi lịch rảnh' : student.availabilityStatus === 'recurring' ? 'lịch rảnh cố định' : 'thiếu lịch rảnh'}</small><div>{scheduledEntries.length ? scheduledEntries.map((entry) => <span key={`${entry.slotId}-${entry.trainerId}`}>{entry.label}<b>{workspace.trainers.find((trainer) => trainer.id === entry.trainerId)?.name || 'PT chưa cập nhật'}</b></span>) : <em>Chưa có buổi nào trong tuần</em>}</div></div>
            </article>)}
            {!studentRows.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có học viên phù hợp bộ lọc.</div>}
          </div>
        </main>
      )}

      {workspace && tab === 'warnings' && (
        <main className="branch-schedule__warning-page">
          <header><p>AURA VALIDATION</p><h2>Hồ sơ cần xử lý trước publish</h2><span>Chạm vào từng học viên để xem PT phụ trách, lịch rảnh và lịch đã xếp.</span></header>
          <section className="schedule-warning-grid">
            {workspace.trainers.filter((trainer) => trainer.availabilityMode === 'unconfigured').map((trainer) => <article key={trainer.id} className="is-blocking"><Clock3 /><div><strong>{trainer.name}</strong><span>PT chưa cấu hình lịch rảnh nên được loại khỏi xếp tự động; các PT đã cấu hình vẫn hoạt động.</span></div></article>)}
            {studentWarnings.map((row) => {
              const { student, missing, trainerNames, contract, scheduledEntries } = row
              const expanded = expandedWarningStudentId === student.id
              return <article key={student.id} className={`schedule-warning-student${expanded ? ' is-expanded' : ''}`}>
                <button type="button" onClick={() => setExpandedWarningStudentId(expanded ? null : student.id)} aria-expanded={expanded}>
                  <AlertTriangle /><div><strong>{student.name}</strong><span>{missing > 0 ? `Thiếu ${missing} buổi.` : ''} {!['submitted', 'locked', 'recurring'].includes(student.availabilityStatus) ? 'Chưa gửi lịch rảnh.' : student.availabilityStatus === 'recurring' ? 'Đang dùng lịch rảnh cố định.' : ''} {student.eligibilityReasons.includes('AMBIGUOUS_ACTIVE_CONTRACT') ? 'Hợp đồng đang chồng thời hạn.' : ''}</span></div><ChevronRight />
                </button>
                {expanded && <div className="schedule-warning-detail">
                  <section><small>PT phụ trách</small><strong>{trainerNames || 'Chưa phân PT'}</strong></section>
                  <section><small>Gói trong tuần</small><strong>{contract?.packageName || 'Cần đối soát hợp đồng'}</strong></section>
                  <section className="is-wide"><small>Lịch rảnh</small><div>{student.availableSlots.length ? student.availableSlots.map((slot) => <span key={slot}>{availabilitySlotLabel(slot)}</span>) : <em>Chưa có lịch rảnh</em>}</div></section>
                  <section className="is-wide"><small>Lịch được xếp</small><div>{scheduledEntries.length ? scheduledEntries.map((entry) => <span key={`${entry.slotId}-${entry.trainerId}`}>{entry.label}</span>) : <em>Chưa được xếp buổi</em>}</div></section>
                </div>}
              </article>
            })}
            {ineligibleDraftRows.map(({ student, scheduledEntries }) => {
              const expanded = expandedWarningStudentId === student.id
              const trainerNames = [...new Set(scheduledEntries.map((entry) => workspace.trainers.find((trainer) => trainer.id === entry.trainerId)?.name).filter(Boolean))].join(', ')
              return <article key={`invalid-${student.id}`} className={`schedule-warning-student is-blocking${expanded ? ' is-expanded' : ''}`}>
                <button type="button" onClick={() => setExpandedWarningStudentId(expanded ? null : student.id)} aria-expanded={expanded}>
                  <AlertTriangle /><div><strong>{student.name}</strong><span>Draft còn {scheduledEntries.length} buổi nhưng học viên không còn hợp đồng hiệu lực/còn buổi trong tuần.</span></div><ChevronRight />
                </button>
                {expanded && <div className="schedule-warning-detail">
                  <section><small>PT trên lịch</small><strong>{trainerNames || 'Chưa xác định'}</strong></section>
                  <section><small>Lý do loại</small><strong>{student.eligibilityReasons.map(ptScheduleConflictLabel).join(' · ')}</strong></section>
                  <section className="is-wide"><small>Lịch cần xử lý</small><div>{scheduledEntries.map((entry) => <span key={`${entry.slotId}-${entry.trainerId}`}>{entry.label}</span>)}</div></section>
                </div>}
              </article>
            })}
            {!studentWarnings.length && !ineligibleDraftRows.length && workspace.summary.unconfiguredTrainers === 0 && <div className="schedule-warning-empty"><CheckCircle2 /> Không còn cảnh báo dữ liệu đầu vào.</div>}
          </section>
        </main>
      )}

      {workspace && tab === 'history' && (
        <main className="branch-schedule__history-page">
          <header><p>PHIÊN BẢN BẤT BIẾN</p><h2>Lịch sử publish</h2><span>Khôi phục luôn tạo draft mới; không sửa session đã tính buổi.</span></header>
          {busy && !history ? <div className="branch-schedule__loading"><RefreshCw className="is-spinning" /> Đang tải lịch sử…</div> : null}
          <section className="schedule-version-list">{history?.versions.map((version) => <article key={version.version} className={version.version === history.currentVersion ? 'is-current' : ''}><div><strong>Phiên bản v{version.version}</strong><span>{version.entryCount} buổi · draft r{version.sourceDraftRevision}</span><small>{formatPublishedAt(version.publishedAt)}</small></div><button type="button" onClick={() => setRestoreCandidate(version)}><History size={15} /> Tạo draft</button></article>)}</section>
          {history && !history.versions.length && <div className="schedule-warning-empty">Chưa có phiên bản đã publish.</div>}
        </main>
      )}

      {workspace && inspectorSlotId && selectedTrainer && (
        <div className="schedule-inspector-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setInspectorSlotId(null) }}>
          <aside className="schedule-inspector" role="dialog" aria-modal="true" aria-label="Chỉnh ô lịch">
            <header><div><p>{DAY_LABELS[inspectorSlotId.split('-')[0]]} · {String(inspectorSlotId.split('-')[1]).padStart(2, '0')}:00</p><h2>{selectedTrainer.name}</h2><span>Sức chứa {inspectorEntries.filter((entry) => entry.type !== 'off').length}/{selectedTrainer.slotCapacity}</span></div><button type="button" aria-label="Đóng" onClick={() => setInspectorSlotId(null)}><X /></button></header>
            <div className="schedule-inspector__body">
              <section><div className="schedule-inspector__section-title"><strong>Trong ca</strong><span>{inspectorEntries.some((entry) => entry.type === 'off') ? 'PT nghỉ' : `${inspectorEntries.filter((entry) => entry.type !== 'off').length} học viên`}</span></div>
                {inspectorEntries.filter((entry) => entry.type !== 'off').map((entry) => <article className="schedule-assigned-row" key={entry.studentId}><div><strong>{studentName(entry.studentId)}</strong><span>{entry.isLocked ? 'Đã khóa khỏi auto-arrange' : 'Có thể xếp lại'}</span></div><div><button type="button" title={entry.isLocked ? 'Mở khóa' : 'Khóa'} disabled={busy} onClick={() => void runCommand(entry.isLocked ? 'unlock_entry' : 'lock_entry', { slotId: inspectorSlotId, trainerId: selectedTrainerId, studentId: entry.studentId })}>{entry.isLocked ? <Unlock /> : <Lock />}</button><button type="button" className="is-remove" disabled={busy} onClick={() => void runCommand('remove_student', { slotId: inspectorSlotId, trainerId: selectedTrainerId, studentId: entry.studentId })}><X /></button></div></article>)}
                {!inspectorEntries.filter((entry) => entry.type !== 'off').length && !inspectorEntries.some((entry) => entry.type === 'off') && <div className="schedule-inspector__empty">Ca đang trống.</div>}
                {inspectorEntries.some((entry) => entry.type === 'off') ? <button className="schedule-off-action" type="button" disabled={busy} onClick={() => void runCommand('clear_trainer_off', { slotId: inspectorSlotId, trainerId: selectedTrainerId }, 'Mở lại ca PT')}>Mở lại ca</button> : !offConfirmation ? <button className="schedule-off-action" type="button" onClick={() => setOffConfirmation(true)}><CalendarOff /> Đánh dấu PT nghỉ</button> : <div className="schedule-off-confirm"><strong>Đưa {inspectorEntries.filter((entry) => entry.type !== 'off').length} học viên về danh sách chưa xếp?</strong><p>Lịch sử thay đổi và lý do sẽ được lưu audit.</p><div><button type="button" onClick={() => setOffConfirmation(false)}>Quay lại</button><button type="button" disabled={busy} onClick={() => void runCommand('set_trainer_off', { slotId: inspectorSlotId, trainerId: selectedTrainerId, disposition: 'requeue' }, 'PT nghỉ, đưa học viên về hàng chờ')}>Xác nhận PT nghỉ</button></div></div>}
              </section>

              {!inspectorEntries.some((entry) => entry.type === 'off') && <section><div className="schedule-inspector__section-title"><strong>Thêm học viên</strong><span>Kiểm tra phía server</span></div><label className="schedule-candidate-search"><Search /><input value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Tên hoặc số điện thoại" /></label>{candidateLoading && <div className="schedule-inspector__empty">Đang kiểm tra điều kiện…</div>}<div className="schedule-candidate-list">{candidates.filter((candidate) => !inspectorEntries.some((entry) => entry.studentId === candidate.studentId)).map((candidate) => <article key={candidate.studentId} className={candidate.eligible ? 'is-eligible' : 'is-disabled'}><div><strong>{candidate.name}</strong><span>{candidate.eligible ? 'Đủ điều kiện trong ngày tập' : candidate.reasons.map(ptScheduleConflictLabel).join(' · ')}</span></div><button type="button" disabled={!candidate.eligible || busy || inspectorEntries.filter((entry) => entry.type !== 'off').length >= selectedTrainer.slotCapacity} onClick={() => void runCommand('add_student', { slotId: inspectorSlotId, trainerId: selectedTrainerId, studentId: candidate.studentId })}><UserPlus /></button></article>)}</div></section>}
            </div>
          </aside>
        </div>
      )}

      {publishPreview && <div className="schedule-publish-backdrop"><section className="schedule-publish-dialog" role="dialog" aria-modal="true" aria-labelledby="branch-publish-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">AURA PT · XÁC NHẬN</p><h2 id="branch-publish-title">Publish v{publishPreview.version}?</h2><p>Session đã tính buổi hoặc xác nhận được khóa bất biến. Toàn bộ diff còn lại chạy trong một transaction.</p><div className="schedule-publish-diff"><div><strong>{publishPreview.diff.create}</strong><span>Tạo mới</span></div><div><strong>{publishPreview.diff.update}</strong><span>Điều chỉnh</span></div><div><strong>{publishPreview.diff.cancel}</strong><span>Hủy</span></div><div><strong>{publishPreview.diff.unchanged}</strong><span>Giữ nguyên</span></div></div><div className="schedule-publish-dialog__actions"><button type="button" onClick={() => setPublishPreview(null)}>Quay lại</button><button type="button" onClick={() => void confirmPublish()} disabled={busy}>{busy ? 'Đang publish…' : `Publish v${publishPreview.version}`}</button></div></section></div>}

      {restoreCandidate && history && <div className="schedule-publish-backdrop"><section className="schedule-publish-dialog" role="alertdialog" aria-modal="true" aria-labelledby="branch-restore-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">KHÔI PHỤC AN TOÀN</p><h2 id="branch-restore-title">Tạo draft từ v{restoreCandidate.version}?</h2><p>Phiên bản đã publish vẫn bất biến. Lịch được sao chép thành draft revision mới để kiểm tra lại.</p><div className="schedule-publish-dialog__actions"><button type="button" onClick={() => setRestoreCandidate(null)}>Quay lại</button><button type="button" onClick={() => void restoreVersion()} disabled={busy}>Tạo draft mới</button></div></section></div>}
    </div>
  )
}
