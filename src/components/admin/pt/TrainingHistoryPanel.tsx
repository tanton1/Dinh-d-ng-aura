import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CheckCircle2, ChevronDown, CircleAlert, Clock3, PencilLine, RefreshCw, Save, SlidersHorizontal, UserRound, UsersRound, X } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { useDatabase } from '../../../contexts/DatabaseContext'
import { getStudentContractUsage, listStudentTrainingHistory, listTrainerTeachingHistory, type ContractUsageSummary, type TrainingHistoryPage, type TrainingHistoryStatus } from '../../../services/businessReportingService'
import type { TrainerSessionSummary, TrainerStudentContractDetail } from '../../../services/ptOperationsV2Service'
import { correctTeachingShift } from '../../../services/sessionOperationsService'
import '../../../styles-training-history.css'

type Props = {
  subject: 'student' | 'trainer'
  subjectId: string
  subjectName: string
  contractId?: string
  isDemo?: boolean
  initialSessions?: TrainerSessionSummary[]
  initialContracts?: TrainerStudentContractDetail[]
  focusSessionId?: string
}

function vietnamDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function todayKey() {
  return vietnamDateKey()
}

function daysAgoKey(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return vietnamDateKey(date)
}

const statusOptions: Array<{ value: TrainingHistoryStatus; label: string }> = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'scheduled', label: 'Đã lên lịch' },
  { value: 'completed', label: 'Đã hoàn thành' },
  { value: 'student_cancelled', label: 'HV báo nghỉ' },
  { value: 'trainer_cancelled', label: 'PT hủy' },
  { value: 'no_show', label: 'Vắng mặt' },
]

function statusLabel(status: string) {
  const found = statusOptions.find((item) => item.value === status)
  if (found) return found.label
  if (status === 'rescheduled') return 'Đã đổi lịch'
  if (status === 'attended') return 'Đã hoàn thành'
  if (status === 'corrected') return 'Đã điều chỉnh'
  if (status === 'teaching_shift_corrected') return 'Điều chỉnh ca'
  return status || 'Không xác định'
}

function formatDate(value: string) {
  if (!value) return 'Chưa xác định ngày'
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00+07:00`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function attendanceLabel(record: TrainingHistoryPage['records'][number]) {
  const status = record.attendance?.attendanceStatus
  if (status === 'present') return 'Có tập'
  if (status === 'late') return `Đi trễ${record.attendance?.lateMinutes ? ` ${record.attendance.lateMinutes}${record.attendance.lateMinutes === 15 ? '+' : ''} phút` : ''}`
  if (status === 'no_show') return 'Không đến'
  if (record.attendance?.billingStatus === 'charged') return 'Đã tính · chờ PT'
  return 'Chưa tính / xác nhận'
}

type TrainerTeachingShift = {
  key: string
  date: string
  hour: number | null
  branchId: string
  studentCount: number
  records: TrainingHistoryPage['records']
}

type EditableAttendanceStatus = '' | 'present' | 'late' | 'no_show'

type TeachingShiftCorrectionDraft = {
  records: TrainingHistoryPage['records']
  date: string
  hour: string
  trainerId: string
  reason: string
  attendanceStatuses: Record<string, EditableAttendanceStatus>
  attendanceTouched: Record<string, boolean>
  lateMinutes: Record<string, 5 | 10 | 15>
  noShowReasons: Record<string, '' | 'busy' | 'sick' | 'forgot' | 'unreachable' | 'other'>
}

const noShowReasonOptions: Array<{ value: TeachingShiftCorrectionDraft['noShowReasons'][string]; label: string }> = [
  { value: '', label: 'Chưa ghi lý do' },
  { value: 'busy', label: 'Khách bận' },
  { value: 'sick', label: 'Khách ốm' },
  { value: 'forgot', label: 'Khách quên lịch' },
  { value: 'unreachable', label: 'Không liên hệ được' },
  { value: 'other', label: 'Lý do khác' },
]

function editableAttendanceStatus(record: TrainingHistoryPage['records'][number]): EditableAttendanceStatus {
  const value = record.attendance?.attendanceStatus
  return value === 'present' || value === 'late' || value === 'no_show' ? value : ''
}

function normaliseHistoryBranchId(value: string | undefined) {
  const result = (value || '').trim()
  return result.toLowerCase() === 'all' ? '' : result
}

function correctionFailureMessage(cause: unknown) {
  const raw = cause && typeof cause === 'object' ? cause as Record<string, unknown> : {}
  const directDetails = raw.details && typeof raw.details === 'object' ? raw.details as Record<string, unknown> : {}
  const customData = raw.customData && typeof raw.customData === 'object' ? raw.customData as Record<string, unknown> : {}
  const nestedDetails = customData.details && typeof customData.details === 'object' ? customData.details as Record<string, unknown> : {}
  const details = Object.keys(directDetails).length ? directDetails : nestedDetails
  const issueCode = typeof details.issueCode === 'string' ? details.issueCode : ''
  const message = cause instanceof Error ? cause.message : typeof raw.message === 'string' ? raw.message : ''
  if (issueCode === 'TEACHING_SHIFT_REVISION_CONFLICT') return 'Ca đã được người khác cập nhật. Hãy tải lại lịch sử rồi mở lại ca trước khi lưu.'
  if (issueCode === 'TEACHING_SHIFT_SOURCE_BRANCH_MISMATCH') return 'Ca đang gộp dữ liệu từ nhiều chi nhánh. Hãy điều chỉnh từng ca theo đúng chi nhánh.'
  if (issueCode === 'TEACHING_SHIFT_STUDENT_DAY_CONFLICT') return 'Không thể lưu: học viên đã có một buổi khác trong ngày đích. Hãy chọn ngày khác hoặc xử lý buổi trùng trước.'
  if (issueCode === 'TEACHING_SHIFT_ATTENDANCE_MISSING') return 'Buổi này chưa có bản ghi điểm danh hợp lệ. Hãy tải lại lịch sử và đối soát điểm danh trước.'
  if (issueCode === 'PAYROLL_RUN_IMMUTABLE') return 'Kỳ lương đã duyệt/khóa nên không sửa chứng từ ca trực tiếp. Hãy tạo bù trừ ở kỳ lương tiếp theo.'
  if (issueCode === 'FINANCE_PERIOD_LOCKED') return 'Kỳ tài chính đã khóa nên không thể sửa ca trực tiếp. Hãy dùng khoản điều chỉnh có audit.'
  return message.replace(/^Firebase:\s*/i, '').replace(/^FunctionsError:\s*/i, '') || 'Không thể điều chỉnh ca. Hãy tải lại lịch sử và thử lại.'
}

function groupTrainerTeachingShifts(records: TrainingHistoryPage['records']): TrainerTeachingShift[] {
  const groups = new Map<string, TrainerTeachingShift>()
  records.forEach((record) => {
    const branchId = normaliseHistoryBranchId(record.branchId)
    const key = record.date && record.hour !== null
      // A legacy all-branch row and a physical branch row at the same time
      // are separate correction targets. Keeping them in one card made the
      // server reject the whole save as a cross-branch source mismatch.
      ? `${record.date}|${record.hour}|${branchId || 'unknown'}`
      : `unknown|${record.id}`
    const current = groups.get(key)
    if (current) current.records.push(record)
    else groups.set(key, { key, date: record.date, hour: record.hour, branchId, studentCount: 1, records: [record] })
  })
  return [...groups.values()].map((shift) => ({
    ...shift,
    studentCount: new Set(shift.records.map((record) => record.studentId || record.counterpartId || record.id)).size,
    records: [...shift.records].sort((left, right) => left.counterpartName.localeCompare(right.counterpartName, 'vi')),
  }))
}

function RecordAuditDetails({ record }: { record: TrainingHistoryPage['records'][number] }) {
  return <details className="training-history__record-details">
    <summary>Chi tiết buổi <ChevronDown size={13} /></summary>
    <div><span>Mã buổi <b>{record.id.slice(-10)}</b></span><span>Hợp đồng <b>{record.contractId ? record.contractId.slice(-10) : 'chưa liên kết'}</b></span></div>
    {record.events.length ? <ul>{record.events.map((event) => <li key={event.id}><b>{statusLabel(event.type)}</b>{event.reason ? ` · ${event.reason}` : ''}</li>)}</ul> : null}
  </details>
}

function demoPage(subjectId: string, sessions: TrainerSessionSummary[], startDate: string, endDate: string, status: TrainingHistoryStatus): TrainingHistoryPage {
  const visible = sessions.filter((session) => session.date >= startDate && session.date <= endDate && (status === 'all' || session.status === status))
  const charged = visible.filter((session) => session.billingStatus === 'charged' || ['completed', 'attended', 'no_show'].includes(session.status))
  const attended = visible.filter((session) => ['present', 'late'].includes(String(session.attendanceStatus || '')) || ['completed', 'attended'].includes(session.status))
  const noShow = visible.filter((session) => session.attendanceStatus === 'no_show' || session.status === 'no_show')
  return {
    schemaVersion: 3,
    subjectType: 'student',
    subjectId,
    records: visible.map((session) => ({
      id: session.id, date: session.date, hour: session.hour ?? null, status: session.status,
      studentId: session.studentId, trainerId: session.trainerId, branchId: session.studentBranchId || '', contractId: session.contractId || '',
      counterpartId: session.trainerId, counterpartName: 'PT Aura',
      attendance: {
        id: `attendance-${session.id}`, type: 'demo', billingStatus: session.billingStatus || 'pending',
        attendanceStatus: session.attendanceStatus || 'pending', lateMinutes: session.lateMinutes || null,
        noShowReason: session.noShowReason || '', occurredAt: '', createdAt: '',
      },
      events: [], revision: session.revision || 0,
    })),
    summary: {
      total: visible.length,
      completed: attended.length,
      noShow: noShow.length,
      cancelled: visible.filter((session) => session.status.includes('cancelled')).length,
      byStatus: visible.reduce<Record<string, number>>((result, session) => ({ ...result, [session.status]: (result[session.status] || 0) + 1 }), {}),
      usage: {
        historySessions: visible.length, chargedSessions: charged.length, attendedSessions: attended.length,
        presentSessions: attended.filter((session) => session.attendanceStatus !== 'late').length,
        lateSessions: attended.filter((session) => session.attendanceStatus === 'late').length,
        noShowSessions: noShow.length, policyChargedSessions: 0,
        chargedPendingAttendanceSessions: charged.filter((session) => !session.attendanceStatus || session.attendanceStatus === 'pending').length,
        exemptSessions: visible.filter((session) => session.billingStatus === 'exempt').length,
        pendingSessions: visible.length - charged.length, legacyChargedSessions: 0,
      },
      teaching: null,
      truncated: false,
    },
    hasMore: false,
    nextCursor: null,
    filters: { startDate, endDate, status },
  }
}

function stableSessionSignature(sessions: TrainerSessionSummary[]) {
  return sessions.map((session) => `${session.id}:${session.revision || 0}:${session.status}:${session.attendanceStatus || ''}:${session.billingStatus || ''}`).join('|')
}

function stableContractSignature(contracts: TrainerStudentContractDetail[]) {
  return contracts.map((contract) => `${contract.id}:${contract.usedSessions}:${contract.remainingSessions}:${contract.reconciliationStatus}`).join('|')
}

export default function TrainingHistoryPanel({ subject, subjectId, subjectName, contractId, isDemo = false, initialSessions = [], initialContracts = [], focusSessionId = '' }: Props) {
  const { profile } = useAuth()
  const { trainers } = useDatabase()
  const [startDate, setStartDate] = useState(() => daysAgoKey(89))
  const [endDate, setEndDate] = useState(todayKey)
  const [status, setStatus] = useState<TrainingHistoryStatus>('all')
  const [page, setPage] = useState<TrainingHistoryPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [contractUsage, setContractUsage] = useState<ContractUsageSummary[]>([])
  const [usageError, setUsageError] = useState('')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [correction, setCorrection] = useState<TeachingShiftCorrectionDraft | null>(null)
  const [correctionSaving, setCorrectionSaving] = useState(false)
  const [correctionError, setCorrectionError] = useState('')
  const [correctionNotice, setCorrectionNotice] = useState('')
  const consumedFocusSession = useRef('')
  const initialSessionSignature = stableSessionSignature(initialSessions)
  const initialContractSignature = stableContractSignature(initialContracts)
  const trainerShifts = useMemo(() => subject === 'trainer' ? groupTrainerTeachingShifts(page?.records ?? []) : [], [page?.records, subject])
  const selectedUsage = useMemo(() => {
    if (subject !== 'student') return null
    return contractUsage.find((item) => item.contractId === contractId)
      ?? contractUsage.find((item) => item.status === 'active')
      ?? contractUsage[0]
      ?? null
  }, [contractId, contractUsage, subject])
  const periodUsage = page?.summary.usage
  const canCorrectTeachingShift = !isDemo && subject === 'trainer' && (profile?.role === 'admin' || profile?.role === 'super_admin')
  const correctionTrainerOptions = useMemo(() => {
    const branchId = correction?.records.find((record) => record.branchId)?.branchId || ''
    return trainers
      .filter((trainer) => trainer.status !== 'inactive')
      .filter((trainer) => !branchId || trainer.branchId === branchId)
      .sort((left, right) => (left.name || '').localeCompare(right.name || '', 'vi'))
  }, [correction?.records, trainers])

  const load = useCallback(async (append = false) => {
    if (!subjectId) return
    setLoading(true)
    setError('')
    try {
      if (isDemo && subject === 'student') {
        setPage(demoPage(subjectId, initialSessions, startDate, endDate, status))
        return
      }
      const query = { startDate, endDate, status, pageSize: 50, cursor: append ? page?.nextCursor : null }
      const response = subject === 'student'
        ? await listStudentTrainingHistory(subjectId, query)
        : await listTrainerTeachingHistory(subjectId, query)
      setPage((current) => append && current ? { ...response, records: [...current.records, ...response.records] } : response)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử buổi tập.')
      if (!append) setPage(null)
    } finally {
      setLoading(false)
    }
  }, [endDate, initialSessionSignature, isDemo, page?.nextCursor, startDate, status, subject, subjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(false) }, [subjectId, startDate, endDate, status]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadUsage = useCallback(async () => {
    if (subject !== 'student' || !subjectId) return
    setUsageError('')
    try {
      if (isDemo) {
        setContractUsage(initialContracts.map((contract) => ({
          contractId: contract.id,
          packageName: contract.packageName,
          status: contract.status,
          startDate: contract.startDate,
          endDate: contract.endDate,
          totalSessions: contract.totalSessions,
          storedUsedSessions: contract.usedSessions,
          legacyProjectionAdjustment: Math.max(0, contract.usedSessions - Number(contract.chargedSessions || 0)),
          usedSessions: contract.usedSessions,
          remainingSessions: contract.remainingSessions,
          projectionDelta: contract.usedSessions - Number(contract.chargedSessions || contract.usedSessions),
          reconciliationStatus: contract.reconciliationStatus,
          historySessions: Number(contract.historySessions || contract.usedSessions),
          chargedSessions: Number(contract.chargedSessions || contract.usedSessions),
          attendedSessions: Number(contract.chargedSessions || contract.usedSessions),
          presentSessions: Number(contract.chargedSessions || contract.usedSessions),
          lateSessions: 0,
          noShowSessions: 0,
          policyChargedSessions: 0,
          chargedPendingAttendanceSessions: 0,
          exemptSessions: 0,
          pendingSessions: 0,
          legacyChargedSessions: 0,
        })))
        return
      }
      const response = await getStudentContractUsage(subjectId, contractId)
      setContractUsage(response.summaries)
    } catch (cause) {
      setContractUsage([])
      setUsageError(cause instanceof Error ? cause.message : 'Không thể đối chiếu số buổi gói tập.')
    }
  }, [contractId, initialContractSignature, isDemo, subject, subjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadUsage() }, [loadUsage])

  const setPreset = (days: number) => {
    setStartDate(daysAgoKey(days - 1))
    setEndDate(todayKey())
  }

  const openCorrection = (shift: TrainerTeachingShift) => {
    setCorrectionError('')
    setCorrectionNotice('')
    const sourceTrainerId = shift.records[0]?.trainerId || subjectId
    const sourceBranchId = normaliseHistoryBranchId(shift.records.find((record) => record.branchId)?.branchId)
    const sourceTrainerAvailable = trainers.some((trainer) => trainer.id === sourceTrainerId && trainer.status !== 'inactive' && (!sourceBranchId || trainer.branchId === sourceBranchId))
    setCorrection({
      records: shift.records,
      date: shift.date,
      hour: shift.hour === null ? '' : String(shift.hour),
      trainerId: sourceTrainerAvailable ? sourceTrainerId : '',
      reason: '',
      attendanceStatuses: Object.fromEntries(shift.records.map((record) => [record.id, editableAttendanceStatus(record)])),
      attendanceTouched: Object.fromEntries(shift.records.map((record) => [record.id, false])),
      lateMinutes: Object.fromEntries(shift.records.map((record) => [record.id, record.attendance?.lateMinutes === 10 || record.attendance?.lateMinutes === 15 ? record.attendance.lateMinutes : 5])),
      noShowReasons: Object.fromEntries(shift.records.map((record) => {
        const value = record.attendance?.noShowReason
        return [record.id, ['busy', 'sick', 'forgot', 'unreachable', 'other'].includes(value || '') ? value : '']
      })) as TeachingShiftCorrectionDraft['noShowReasons'],
    })
  }

  useEffect(() => {
    if (!focusSessionId || !canCorrectTeachingShift || consumedFocusSession.current === focusSessionId || correction) return
    const targetShift = trainerShifts.find((shift) => shift.records.some((record) => record.id === focusSessionId))
    if (!targetShift) return
    consumedFocusSession.current = focusSessionId
    openCorrection(targetShift)
  }, [canCorrectTeachingShift, correction, focusSessionId, trainerShifts]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!correction) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !correctionSaving) setCorrection(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [correction, correctionSaving])

  const submitCorrection = async () => {
    if (!correction || correctionSaving) return
    const parsedHour = Number(correction.hour)
    if (!correction.date || !Number.isInteger(parsedHour) || parsedHour < 0 || parsedHour > 23 || !correction.trainerId) {
      setCorrectionError('Vui lòng chọn đủ ngày, giờ và PT thực dạy.')
      return
    }
    if (correction.reason.trim().length < 3) {
      setCorrectionError('Lý do điều chỉnh cần ít nhất 3 ký tự.')
      return
    }
    setCorrectionSaving(true)
    setCorrectionError('')
    try {
      const result = await correctTeachingShift({
        items: correction.records.map((record) => {
          const attendanceStatus = correction.attendanceTouched[record.id] ? correction.attendanceStatuses[record.id] : ''
          return {
            sessionId: record.id,
            expectedRevision: record.revision,
            ...(record.attendance?.id ? { attendanceEventId: record.attendance.id } : {}),
            ...(attendanceStatus ? {
              attendanceStatus,
              ...(attendanceStatus === 'late' ? { lateMinutes: correction.lateMinutes[record.id] } : {}),
              ...(attendanceStatus === 'no_show' ? { noShowReason: correction.noShowReasons[record.id] } : {}),
            } : {}),
          }
        }),
        date: correction.date,
        hour: parsedHour,
        trainerId: correction.trainerId,
        reason: correction.reason.trim(),
      })
      setCorrection(null)
      setCorrectionNotice(result.unchanged
        ? 'Ca không có thay đổi mới.'
        : result.invalidatedPayrollPeriods.length
          ? `Đã điều chỉnh ca. Kỳ lương ${result.invalidatedPayrollPeriods.join(', ')} cần xóa nháp và lập lại.`
          : 'Đã điều chỉnh ca và lưu đầy đủ lịch sử đối soát.')
      await load(false)
    } catch (cause) {
      setCorrectionError(correctionFailureMessage(cause))
    } finally {
      setCorrectionSaving(false)
    }
  }

  const counterpartLabel = subject === 'student' ? 'PT phụ trách' : 'Học viên'
  return <section className="training-history" aria-busy={loading}>
    <header className="training-history__header">
      <div><span><CalendarDays size={15} /> {subject === 'student' ? 'NHẬT KÝ TẬP LUYỆN' : 'NHẬT KÝ CA DẠY'}</span><h3>{subject === 'student' ? 'Lịch sử tập' : 'Lịch dạy PT'}<em> · {subjectName || 'Hồ sơ Aura'}</em></h3></div>
      <button type="button" aria-label="Làm mới lịch sử" onClick={() => { void load(false); void loadUsage() }} disabled={loading}><RefreshCw size={16} className={loading ? 'is-spinning' : ''} /><span>Làm mới</span></button>
    </header>
    <div className="training-history__filters">
      <div className="training-history__presets"><button type="button" onClick={() => setPreset(30)}>30 ngày</button><button type="button" onClick={() => setPreset(90)}>90 ngày</button><button type="button" onClick={() => setPreset(180)}>6 tháng</button></div>
      <button type="button" className={`training-history__filter-toggle${showAdvancedFilters ? ' is-active' : ''}`} onClick={() => setShowAdvancedFilters((current) => !current)}><SlidersHorizontal size={15} /> Bộ lọc</button>
      {showAdvancedFilters && <div className="training-history__advanced">
        <label><span>Từ ngày</span><input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label><span>Đến ngày</span><input type="date" value={endDate} min={startDate} max={todayKey()} onChange={(event) => setEndDate(event.target.value)} /></label>
        <label><span>Trạng thái</span><select value={status} onChange={(event) => setStatus(event.target.value as TrainingHistoryStatus)}>{statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>}
    </div>
    {error && <div className="training-history__notice"><CircleAlert size={18} /> {error}</div>}
    {correctionNotice && <div className="training-history__notice is-success"><CheckCircle2 size={18} /> {correctionNotice}</div>}
    {usageError && subject === 'student' ? <div className="training-history__notice"><CircleAlert size={18} /> {usageError}</div> : null}
    {selectedUsage ? <section className="training-history__contract-usage">
      <header><div><small>GÓI ĐANG ĐỐI CHIẾU</small><strong>{selectedUsage.packageName}</strong></div><span><b>{selectedUsage.usedSessions}</b>/{selectedUsage.totalSessions} buổi</span></header>
      <i className="training-history__usage-progress"><em style={{ width: `${Math.min(100, selectedUsage.totalSessions ? selectedUsage.usedSessions / selectedUsage.totalSessions * 100 : 0)}%` }} /></i>
      <div className="training-history__usage-facts">
        <span><b>{selectedUsage.remainingSessions}</b>Còn lại</span>
        <span><b>{periodUsage?.chargedSessions ?? 0}</b>Trong kỳ</span>
        <span><b>{periodUsage?.attendedSessions ?? 0}</b>Có tập</span>
        <span><b>{periodUsage?.noShowSessions ?? 0}</b>Vắng</span>
        {(periodUsage?.chargedPendingAttendanceSessions ?? 0) > 0 ? <span className="is-pending"><b>{periodUsage?.chargedPendingAttendanceSessions}</b>Chờ PT</span> : null}
      </div>
      {selectedUsage.legacyProjectionAdjustment > 0 ? <small className="training-history__legacy-note">{selectedUsage.legacyProjectionAdjustment} buổi dữ liệu cũ đang được giữ riêng để đối soát.</small> : null}
    </section> : null}
    {page && subject === 'trainer' && page.summary.teaching ? <div className="training-history__summary"><div><strong>{page.summary.teaching.totalShifts}</strong><span>Ca dạy</span></div><div><strong>{page.summary.teaching.pairedShifts}</strong><span>Ca đôi</span></div><div><strong>{page.summary.teaching.learnerBookings}</strong><span>Lượt học viên</span></div><div><strong>{page.summary.noShow}</strong><span>Vắng mặt</span></div></div> : null}
    <div className="training-history__records">
      {loading && !page ? <div className="training-history__empty">Đang tải lịch sử an toàn…</div> : null}
      {!loading && !error && page && page.records.length === 0 ? <div className="training-history__empty">Không có buổi tập nào trong bộ lọc này.</div> : null}
      {subject === 'trainer' ? trainerShifts.map((shift) => <article className="training-history__shift" key={shift.key}>
        <header><div className="training-history__date"><strong>{shift.date.slice(8) || '—'}</strong><span>{shift.date.slice(5, 7) || '—'}</span></div><div><small>CA DẠY</small><h4>{formatDate(shift.date)} {shift.hour !== null ? `· ${String(shift.hour).padStart(2, '0')}:00` : ''}</h4><p><UsersRound size={14} /> {shift.studentCount} học viên</p></div><div className="training-history__shift-actions"><em className={shift.studentCount >= 2 ? 'is-paired' : ''}>{shift.studentCount >= 2 ? 'Ca đôi' : 'Ca đơn'}</em>{canCorrectTeachingShift ? <button type="button" onClick={() => openCorrection(shift)}><PencilLine size={14} /> Điều chỉnh</button> : null}</div></header>
        <div className="training-history__shift-students">{shift.records.map((record, index) => <section key={record.id}><span className="training-history__student-order">{index + 1}</span><div className="training-history__shift-student-main"><strong>{record.counterpartName}</strong><RecordAuditDetails record={record} /></div><div className="training-history__shift-state"><span className={`training-history__status training-history__status--${record.status}`}>{statusLabel(record.status)}</span><small>{record.attendance?.attendanceStatus && record.attendance.attendanceStatus !== 'pending' ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}{attendanceLabel(record)}</small></div></section>)}</div>
      </article>) : page?.records.map((record) => <article className="training-history__record" key={record.id}><div className="training-history__date"><strong>{record.date.slice(8) || '—'}</strong><span>{record.date.slice(5, 7) || '—'}</span></div><div className="training-history__record-main"><div className="training-history__record-title"><strong>{formatDate(record.date)} {record.hour !== null ? `· ${String(record.hour).padStart(2, '0')}:00` : ''}</strong>{!['completed', 'attended', 'no_show'].includes(record.status) ? <span className={`training-history__status training-history__status--${record.status}`}>{statusLabel(record.status)}</span> : null}</div><p><UserRound size={14} /> {counterpartLabel}: <b>{record.counterpartName}</b></p><RecordAuditDetails record={record} /></div><div className="training-history__attendance">{record.attendance?.attendanceStatus && record.attendance.attendanceStatus !== 'pending' ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}<span>{attendanceLabel(record)}</span></div></article>)}
    </div>
    {page?.summary.truncated ? <p className="training-history__truncated">Tóm tắt bị giới hạn để bảo vệ hiệu năng. Hãy thu hẹp khoảng thời gian để xem số liệu đầy đủ.</p> : null}
    {page?.hasMore ? <button type="button" className="training-history__more" disabled={loading} onClick={() => void load(true)}>{loading ? 'Đang tải…' : 'Tải thêm lịch sử'}</button> : null}
    {correction ? <div className="training-history__correction-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !correctionSaving) setCorrection(null) }}>
      <section className="training-history__correction" role="dialog" aria-modal="true" aria-labelledby="teaching-shift-correction-title">
        <header><div><small>ĐỐI SOÁT CÓ AUDIT</small><h3 id="teaching-shift-correction-title">Điều chỉnh ca dạy</h3><p>{correction.records.length} học viên · mọi thay đổi được lưu lại</p></div><button type="button" aria-label="Đóng điều chỉnh ca" disabled={correctionSaving} onClick={() => setCorrection(null)}><X size={20} /></button></header>
        <div className="training-history__correction-grid">
          <label><span>Ngày thực dạy</span><input type="date" value={correction.date} onChange={(event) => setCorrection((current) => current ? { ...current, date: event.target.value } : current)} /></label>
          <label><span>Giờ bắt đầu</span><select value={correction.hour} onChange={(event) => setCorrection((current) => current ? { ...current, hour: event.target.value } : current)}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
          <label className="is-wide"><span>PT thực dạy</span><select value={correction.trainerId} onChange={(event) => setCorrection((current) => current ? { ...current, trainerId: event.target.value } : current)}><option value="" disabled>Chọn PT thực dạy</option>{correctionTrainerOptions.map((trainer) => <option key={trainer.id} value={trainer.id}>{trainer.name || `PT ${trainer.id.slice(-6)}`}</option>)}</select></label>
        </div>
        <div className="training-history__correction-attendance">
          <strong>Hiện diện từng học viên</strong>
          {correction.records.map((record) => {
            const attendanceStatus = correction.attendanceStatuses[record.id]
            return <article key={record.id}><div><UserRound size={16} /><span><b>{record.counterpartName}</b><small>{record.attendance ? attendanceLabel(record) : 'Chưa có bản ghi điểm danh'}</small></span></div><div className="training-history__correction-attendance-fields"><select aria-label={`Hiện diện ${record.counterpartName}`} value={attendanceStatus} disabled={!record.attendance} onChange={(event) => setCorrection((current) => current ? { ...current, attendanceStatuses: { ...current.attendanceStatuses, [record.id]: event.target.value as EditableAttendanceStatus }, attendanceTouched: { ...current.attendanceTouched, [record.id]: true } } : current)}><option value="">Giữ nguyên</option><option value="present">Có tập</option><option value="late">Đi trễ</option><option value="no_show">Không đến</option></select>{attendanceStatus === 'late' ? <select aria-label={`Số phút đi trễ ${record.counterpartName}`} value={correction.lateMinutes[record.id]} onChange={(event) => setCorrection((current) => current ? { ...current, lateMinutes: { ...current.lateMinutes, [record.id]: Number(event.target.value) as 5 | 10 | 15 }, attendanceTouched: { ...current.attendanceTouched, [record.id]: true } } : current)}><option value={5}>5 phút</option><option value={10}>10 phút</option><option value={15}>15+ phút</option></select> : null}{attendanceStatus === 'no_show' ? <select aria-label={`Lý do vắng ${record.counterpartName}`} value={correction.noShowReasons[record.id]} onChange={(event) => setCorrection((current) => current ? { ...current, noShowReasons: { ...current.noShowReasons, [record.id]: event.target.value as TeachingShiftCorrectionDraft['noShowReasons'][string] }, attendanceTouched: { ...current.attendanceTouched, [record.id]: true } } : current)}>{noShowReasonOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : null}</div></article>
          })}
        </div>
        <label className="training-history__correction-reason"><span>Lý do bắt buộc</span><textarea maxLength={500} value={correction.reason} onChange={(event) => setCorrection((current) => current ? { ...current, reason: event.target.value } : current)} placeholder="Ví dụ: PT thực dạy khác với lịch ban đầu; đối soát theo camera và xác nhận quản lý." /></label>
        <div className="training-history__correction-policy"><CircleAlert size={18} /><p>Kỳ lương nháp liên quan sẽ được đánh dấu cần lập lại. Kỳ đã duyệt, khóa hoặc chi sẽ không được sửa trực tiếp.</p></div>
        {correctionError ? <div className="training-history__notice"><CircleAlert size={18} /> {correctionError}</div> : null}
        <footer><button type="button" disabled={correctionSaving} onClick={() => setCorrection(null)}>Hủy</button><button type="button" disabled={correctionSaving || correction.reason.trim().length < 3 || !correction.trainerId} onClick={() => void submitCorrection()}><Save size={16} /> {correctionSaving ? 'Đang đối soát…' : 'Xác nhận điều chỉnh'}</button></footer>
      </section>
    </div> : null}
  </section>
}
