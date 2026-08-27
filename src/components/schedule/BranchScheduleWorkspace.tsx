import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
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
  Save,
  Sparkles,
  Unlock,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import AvailabilityMatrix from './AvailabilityMatrix'
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
  savePtStudentAvailability,
  validatePtScheduleDraft,
  type PtScheduleBranchOption,
  type PtScheduleDraftCommand,
  type PtScheduleStudentCoverage,
  type PtScheduleTrainerDailyLoad,
  type PtScheduleUnassignedEntry,
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

function finiteCount(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric >= 0) return numeric
  }
  return 0
}

function trainerLoadStatus(count: number, target: number) {
  if (count > target) return 'over_target' as const
  if (count === target) return 'target' as const
  return 'under_target' as const
}

function normalizedTrainerLoadStatus(value: PtScheduleTrainerDailyLoad['status'], count: number, target: number) {
  if (value === 'under_target' || value === 'target' || value === 'over_target') return value
  return trainerLoadStatus(count, target)
}

const TRAINER_LOAD_LABELS = {
  under_target: 'Còn tải',
  target: 'Đạt mục tiêu',
  over_target: 'Vượt mục tiêu',
} as const

function trainerEmploymentLabel(value: 'full_time' | 'part_time' | 'collaborator' | undefined) {
  if (value === 'collaborator') return 'CTV'
  if (value === 'part_time') return 'Part-time'
  return 'PT chính thức'
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
  const [availabilityEditorStudentId, setAvailabilityEditorStudentId] = useState<string | null>(null)
  const [availabilityDraft, setAvailabilityDraft] = useState<Set<string>>(new Set())
  const [availabilityBusy, setAvailabilityBusy] = useState(false)
  const [availabilityError, setAvailabilityError] = useState('')

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
      // The latest entitlement is the clearest summary for a renewal chain;
      // each actual schedule entry is still bound to its date-specific
      // source/new contract by the backend.
      const contract = contracts[contracts.length - 1] || null
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

  const studentCoverage = useMemo(() => {
    const source: PtScheduleStudentCoverage | undefined = workspace?.optimizationSummary?.studentCoverage
      || workspace?.studentCoverage
    const eligible = finiteCount(source?.eligibleStudents, source?.eligible, operationalStudentRows.length)
    const withAtLeastOneFallback = operationalStudentRows.filter((row) => row.scheduled > 0).length
    const fullyScheduledFallback = operationalStudentRows.filter((row) => row.missing === 0).length
    const totalTargetFallback = operationalStudentRows.reduce((total, row) => total + row.student.sessionsPerWeek, 0)
    const scheduledFallback = operationalStudentRows.reduce((total, row) => total + row.scheduled, 0)
    return {
      eligible,
      withAtLeastOne: finiteCount(source?.studentsWithAtLeastOne, source?.receivedAtLeastOne, source?.withAtLeastOne, withAtLeastOneFallback),
      fullyScheduled: finiteCount(source?.fullyScheduledStudents, source?.fullyScheduled, fullyScheduledFallback),
      totalTargetSessions: finiteCount(source?.requestedSessions, source?.totalTargetSessions, workspace?.optimizationSummary?.totalTargetSessions, totalTargetFallback),
      scheduledEntries: finiteCount(source?.scheduledSessions, source?.scheduledEntries, workspace?.optimizationSummary?.scheduledEntries, scheduledFallback),
      missingSessions: finiteCount(source?.missingSessions, workspace?.optimizationSummary?.missingSessions, missingSessions),
    }
  }, [missingSessions, operationalStudentRows, workspace])

  const trainerLoads = useMemo(() => {
    if (!workspace) return []
    const backendLoads: PtScheduleTrainerDailyLoad[] = workspace.optimizationSummary?.trainerLoads
      || workspace.trainerLoads
      || []
    const backendByKey = new Map<string, PtScheduleTrainerDailyLoad>()
    for (const load of backendLoads) {
      if (Array.isArray(load.days)) {
        for (const dayLoad of load.days) backendByKey.set(`${load.trainerId}:${dayLoad.day}`, {
          ...load,
          ...dayLoad,
          trainerName: load.trainerName || load.name,
          sessionCount: dayLoad.teachingSlots,
          dailySessionTarget: dayLoad.target,
        })
        continue
      }
      const loadDay = load.day && workingDays.includes(load.day)
        ? load.day
        : workingDays.find((day) => weekDates[day as keyof typeof weekDates]?.full === load.date)
      if (loadDay) backendByKey.set(`${load.trainerId}:${loadDay}`, load)
    }
    return workspace.trainers.flatMap((trainer) => workingDays.map((day) => {
      const backend = backendByKey.get(`${trainer.id}:${day}`)
      const fallbackCount = workingHours.reduce((total, hour) => {
        const hasTeachingSession = (workspace.schedule[`${day}-${hour}`] || [])
          .some((entry) => entry.trainerId === trainer.id && entry.type !== 'off')
        return total + Number(hasTeachingSession)
      }, 0)
      const count = finiteCount(backend?.sessionCount, backend?.teachingSlots, backend?.sessions, fallbackCount)
      const target = Math.max(1, finiteCount(backend?.dailySessionTarget, backend?.target, trainer.dailySessionTarget, 8))
      return {
        trainerId: trainer.id,
        trainerName: backend?.trainerName || backend?.name || trainer.name,
        employmentType: backend?.employmentType || trainer.employmentType,
        employmentLevel: backend?.employmentLevel || trainer.employmentLevel,
        day,
        date: weekDates[day as keyof typeof weekDates]?.full || '',
        count,
        target,
        status: normalizedTrainerLoadStatus(backend?.status, count, target),
      }
    }))
  }, [weekDates, workingDays, workingHours, workspace])

  const unassignedEntries = useMemo(() => {
    const raw: PtScheduleUnassignedEntry[] = workspace?.unassignedEntries
      || workspace?.unassigned
      || []
    const byStudent = new Map(raw.filter((entry) => Boolean(entry?.studentId)).map((entry) => [entry.studentId, {
      ...entry,
      missingSessions: Math.max(1, finiteCount(entry.missingSessions, 1)),
      reasonCodes: entry.reasonCodes?.length
        ? entry.reasonCodes
        : (entry as PtScheduleUnassignedEntry & { reason?: string }).reason === 'trainer_off'
          ? ['TRAINER_ON_LEAVE']
          : ['STUDENT_UNSCHEDULED'],
    }]))
    for (const row of operationalStudentRows) {
      if (row.missing < 1 || byStudent.has(row.student.id)) continue
      const reasonCodes: string[] = []
      if (!['submitted', 'locked', 'recurring'].includes(row.student.availabilityStatus)) reasonCodes.push('STUDENT_AVAILABILITY_MISSING')
      if (row.student.eligibilityReasons.includes('AMBIGUOUS_ACTIVE_CONTRACT')) reasonCodes.push('AMBIGUOUS_ACTIVE_CONTRACT')
      if (!row.trainerNames) reasonCodes.push('TRAINER_NOT_ASSIGNED')
      if (!reasonCodes.length) reasonCodes.push('STUDENT_UNSCHEDULED')
      byStudent.set(row.student.id, {
        studentId: row.student.id,
        studentName: row.student.name,
        missingSessions: row.missing,
        reasonCodes,
        suggestedSlots: [],
      })
    }
    return [...byStudent.values()].sort((left, right) => right.missingSessions - left.missingSessions
      || String(left.studentName || '').localeCompare(String(right.studentName || ''), 'vi'))
  }, [operationalStudentRows, workspace?.unassigned, workspace?.unassignedEntries])

  const warningProfiles = useMemo(() => {
    if (!workspace) return []
    const operationalByStudent = new Map(operationalStudentRows.map((row) => [row.student.id, row]))
    const unassignedByStudent = new Map(unassignedEntries.map((entry) => [entry.studentId, entry]))
    const affectedIds = new Set([
      ...unassignedEntries.map((entry) => entry.studentId),
      ...studentWarnings.map((row) => row.student.id),
      ...ineligibleDraftRows.map((row) => row.student.id),
    ])
    return [...affectedIds].map((studentId) => {
      const student = workspace.students.find((item) => item.id === studentId)
      if (!student) return null
      const row = operationalByStudent.get(studentId)
      const unassigned = unassignedByStudent.get(studentId)
      const scheduledEntries = row?.scheduledEntries || scheduledEntriesByStudent.get(studentId) || []
      const allContracts = workspace.contracts
        .filter((contract) => contract.studentId === studentId)
        .sort((left, right) => String(left.endDate || '').localeCompare(String(right.endDate || '')))
      const contract = row?.contract || allContracts[allContracts.length - 1] || null
      const trainerIds = [...new Set([
        contract?.trainerId,
        ...(contract?.trainerIds || []),
        ...scheduledEntries.map((entry) => entry.trainerId),
      ].filter((value): value is string => Boolean(value)))]
      const trainerNames = row?.trainerNames || trainerIds
        .map((id) => workspace.trainers.find((trainer) => trainer.id === id)?.name)
        .filter(Boolean)
        .join(', ')
      const reasonCodes = new Set<string>([
        ...(unassigned?.reasonCodes || unassigned?.reasons || []),
        ...(student.eligibleForWeek ? [] : student.eligibilityReasons || []),
      ])
      if (!['submitted', 'locked', 'recurring'].includes(student.availabilityStatus)) reasonCodes.add('AVAILABILITY_NOT_SUBMITTED')
      if ((row?.missing || unassigned?.missingSessions || 0) > 0 && !reasonCodes.size) reasonCodes.add('STUDENT_UNSCHEDULED')
      return {
        student,
        contract,
        trainerNames,
        scheduledEntries,
        missingSessions: Math.max(0, row?.missing || unassigned?.missingSessions || 0),
        reasonCodes: [...reasonCodes],
        suggestedSlots: unassigned?.suggestedSlots || [],
      }
    }).filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
      .sort((left, right) => right.missingSessions - left.missingSessions
        || left.student.name.localeCompare(right.student.name, 'vi'))
  }, [ineligibleDraftRows, operationalStudentRows, scheduledEntriesByStudent, studentWarnings, unassignedEntries, workspace])

  const selectedTrainerLoads = useMemo(() => trainerLoads.filter((load) => load.trainerId === selectedTrainerId), [selectedTrainerId, trainerLoads])
  const warningCount = useMemo(() => {
    return warningProfiles.length + (workspace?.summary.unconfiguredTrainers || 0)
  }, [warningProfiles.length, workspace?.summary.unconfiguredTrainers])

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
          // Command API v2 chưa trả snapshot tối ưu mới. Xóa snapshot cũ để
          // coverage/tải PT được tính trực tiếp từ draft vừa nhận.
          optimizationSummary: undefined,
          trainerLoads: undefined,
          studentCoverage: undefined,
          unassignedEntries: undefined,
          unassigned: undefined,
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

  const openAvailabilityEditor = (student: PtScheduleWorkspaceV2Result['students'][number]) => {
    setAvailabilityEditorStudentId((current) => current === student.id ? null : student.id)
    setAvailabilityDraft(new Set(student.availableSlots || []))
    setAvailabilityError('')
  }

  const saveStudentAvailability = async (student: PtScheduleWorkspaceV2Result['students'][number]) => {
    if (availabilityBusy) return
    setAvailabilityBusy(true); setAvailabilityError('')
    try {
      const result = await savePtStudentAvailability({
        weekId: currentWeekId,
        branchId,
        studentId: student.id,
        availableSlots: [...availabilityDraft],
        expectedRevision: student.availabilityRevision,
      })
      setWorkspace((current) => current ? {
        ...current,
        students: current.students.map((item) => item.id === student.id ? {
          ...item,
          availableSlots: result.availableSlots,
          availabilityRevision: result.availabilityRevision,
          availabilityStatus: result.availabilityStatus,
          availabilitySource: 'weekly',
          isScheduleConfirmed: true,
        } : item),
      } : current)
      setAvailabilityDraft(new Set(result.availableSlots))
      setNotice(`Đã cập nhật lịch rảnh của ${student.name}.`)
    } catch (cause) {
      const normalized = asPtSchedulePublishError(cause)
      setAvailabilityError(normalized.message)
      if (normalized.issueCode === 'REVISION_CONFLICT') await loadWorkspace(true)
    } finally { setAvailabilityBusy(false) }
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
        optimizationSummary: result.optimizationSummary || current.optimizationSummary,
        unassignedEntries: result.unassignedEntries || result.unassigned || current.unassignedEntries,
        trainerLoads: result.trainerLoads || current.trainerLoads,
        studentCoverage: result.studentCoverage || current.studentCoverage,
      } : current)
      const unresolved = result.unassignedEntries?.length || result.unassigned?.length || result.warnings.length
      setNotice(unresolved
        ? `Đã tối ưu draft r${result.draftRevision}; còn ${unresolved} hồ sơ cần xử lý.`
        : `Đã tối ưu draft r${result.draftRevision} bằng ${result.generatorVersion}.`)
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
        <article className="is-coverage"><UsersRound /><div><strong>{studentCoverage.withAtLeastOne}/{studentCoverage.eligible}</strong><span>Đã có ít nhất 1 buổi</span></div></article>
        <article><CheckCircle2 /><div><strong>{studentCoverage.fullyScheduled}/{studentCoverage.eligible}</strong><span>Đã đủ mục tiêu tuần</span></div></article>
        <article><CalendarRange /><div><strong>{studentCoverage.scheduledEntries}/{studentCoverage.totalTargetSessions}</strong><span>Buổi đã xếp / mục tiêu</span></div></article>
        <article className={studentCoverage.missingSessions > 0 ? 'is-warning' : ''}><AlertTriangle /><div><strong>{studentCoverage.missingSessions}</strong><span>Buổi còn thiếu</span></div></article>
        <article className={(workspace?.summary.unconfiguredTrainers || 0) > 0 ? 'is-warning' : ''}><Clock3 /><div><strong>{workspace?.summary.unconfiguredTrainers || 0}</strong><span>PT thiếu lịch rảnh</span></div></article>
      </section>

      <section className="branch-schedule__toolbar">
        <div className="branch-schedule__tabs" role="tablist">
          <button type="button" className={tab === 'matrix' ? 'is-active' : ''} onClick={() => setTab('matrix')}>Ma trận</button>
          <button type="button" className={tab === 'students' ? 'is-active' : ''} onClick={() => setTab('students')}>Học viên <b>{workspace?.summary.eligibleStudents || 0}</b></button>
          <button type="button" className={tab === 'warnings' ? 'is-active' : ''} onClick={() => setTab('warnings')}>Cảnh báo <b>{warningCount}</b></button>
          <button type="button" className={tab === 'history' ? 'is-active' : ''} onClick={() => void openHistory()}>Phiên bản</button>
        </div>
        <div className="branch-schedule__actions">
          <button type="button" onClick={() => void autoArrange()} disabled={!workspace || busy}><Sparkles size={16} /> Xếp lịch tối ưu</button>
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
            <label><span>Huấn luyện viên</span><select value={selectedTrainerId} onChange={(event) => setSelectedTrainerId(event.target.value)}>{workspace.trainers.map((trainer) => <option key={trainer.id} value={trainer.id}>{trainer.name} · {trainer.dailySessionTarget || 8} ca/ngày</option>)}</select></label>
            {selectedTrainer && <div className={`trainer-availability-chip is-${selectedTrainer.availabilityMode}`}><Clock3 size={14} />{selectedTrainer.availabilityMode === 'configured' ? `${selectedTrainer.availableSlots?.length || 0} khung giờ rảnh` : selectedTrainer.availabilityMode === 'unrestricted' ? 'Không giới hạn' : 'Chưa khai lịch rảnh'}</div>}
            <div className="branch-schedule__draft-meta"><span>Draft r{workspace.draftRevision}</span><span>Published v{workspace.publishedVersion}</span></div>
          </section>

          <section className="trainer-workload" aria-label="Tải ca huấn luyện viên theo ngày">
            <header>
              <div><strong>Tải ca PT</strong><span>Ca đôi cùng giờ chỉ tính 1 ca</span></div>
              {selectedTrainer && <b>{selectedTrainerLoads.reduce((total, load) => total + load.count, 0)} ca tuần · mục tiêu {selectedTrainer.dailySessionTarget || 8}/ngày</b>}
            </header>
            <div className="trainer-workload__rail">
              {workspace.trainers.map((trainer) => {
                const loads = trainerLoads.filter((load) => load.trainerId === trainer.id)
                const total = loads.reduce((sum, load) => sum + load.count, 0)
                const priority = finiteCount(trainer.schedulingPriority, trainer.priority)
                const target = loads[0]?.target || trainer.dailySessionTarget || 8
                return <button type="button" key={trainer.id} className={`trainer-workload__card${trainer.id === selectedTrainerId ? ' is-active' : ''}`} onClick={() => setSelectedTrainerId(trainer.id)}>
                  <span className="trainer-workload__identity"><strong>{trainer.name} · {total} ca</strong><small>{trainerEmploymentLabel(trainer.employmentType)} · {priority > 0 ? `hạng #${priority}` : 'tự cân tải'} · mục tiêu {target}</small></span>
                  <span className="trainer-workload__days">{loads.map((load) => <i key={load.day} className={`is-${load.status}`} title={`${DAY_LABELS[load.day] || load.day}: ${load.count}/${load.target} ca · ${TRAINER_LOAD_LABELS[load.status]}`}><small>{load.day}</small><b>{load.count}/{load.target}</b></i>)}</span>
                </button>
              })}
            </div>
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
            {studentRows.map(({ student, scheduled, scheduledEntries, missing, contract, trainerNames }) => <article key={student.id} className={`${missing > 0 ? 'is-missing' : 'is-ready'}${availabilityEditorStudentId === student.id ? ' is-editing-availability' : ''}`}>
              <div className="branch-schedule__student-person"><span><UsersRound size={17} /></span><div><strong>{student.name || 'Chưa cập nhật tên'}</strong><small>{student.phone || `Mã ${student.id.slice(-8)}`}</small></div></div>
              <div className="branch-schedule__student-contract"><small>Gói &amp; PT</small><strong>{contract?.packageName || 'Cần đối soát hợp đồng'}</strong><span>{trainerNames || 'Chưa phân PT'} · {contract ? `còn ${Math.max(0, Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0))} buổi` : 'chưa có gói phù hợp'}</span></div>
              <div className="branch-schedule__weekly-target"><small>Mục tiêu tuần</small><div><button type="button" aria-label={`Giảm mục tiêu tuần của ${student.name}`} disabled={busy || student.sessionsPerWeek <= scheduled} onClick={() => void setWeeklyTarget(student.id, student.sessionsPerWeek - 1)}><Minus /></button><strong>{student.sessionsPerWeek}</strong><button type="button" aria-label={`Tăng mục tiêu tuần của ${student.name}`} disabled={busy || student.sessionsPerWeek >= student.maxWeeklySessions} onClick={() => void setWeeklyTarget(student.id, student.sessionsPerWeek + 1)}><Plus /></button>{student.weeklySessionTargetOverridden && <button type="button" className="is-reset" title={`Về ${student.defaultSessionsPerWeek} buổi`} aria-label={`Khôi phục mục tiêu của ${student.name} về ${student.defaultSessionsPerWeek} buổi`} disabled={busy || Math.min(student.defaultSessionsPerWeek, student.maxWeeklySessions) < scheduled} onClick={() => void setWeeklyTarget(student.id, null)}><RotateCcw /></button>}</div>{student.weeklySessionTargetOverridden && <span>Tạm thời</span>}</div>
              <div className="branch-schedule__student-progress"><strong>{scheduled}/{student.sessionsPerWeek}</strong><span>{missing > 0 ? `Thiếu ${missing}` : 'Đã đủ'}</span><i><b style={{ width: `${Math.min(100, student.sessionsPerWeek ? scheduled / student.sessionsPerWeek * 100 : 100)}%` }} /></i></div>
              <div className="branch-schedule__student-schedule"><small>Lịch được xếp · {['submitted', 'locked'].includes(student.availabilityStatus) ? 'đã gửi lịch rảnh' : student.availabilityStatus === 'recurring' ? 'lịch rảnh cố định' : 'thiếu lịch rảnh'}</small><div>{scheduledEntries.length ? scheduledEntries.map((entry) => <span key={`${entry.slotId}-${entry.trainerId}`}>{entry.label}<b>{workspace.trainers.find((trainer) => trainer.id === entry.trainerId)?.name || 'PT chưa cập nhật'}</b></span>) : <em>Chưa có buổi nào trong tuần</em>}</div></div>
              <div className="branch-schedule__student-availability-action"><button type="button" className={`is-${student.availabilityStatus}`} aria-expanded={availabilityEditorStudentId === student.id} onClick={() => openAvailabilityEditor(student)}><CalendarRange size={16} />{student.availabilityStatus === 'locked' ? 'Lịch rảnh đã khóa' : ['submitted', 'recurring'].includes(student.availabilityStatus) ? 'Xem / sửa lịch rảnh' : 'Thêm lịch rảnh'}</button><span>{student.availableSlots.length} khung · r{student.availabilityRevision}</span></div>
              {availabilityEditorStudentId === student.id && <section className="branch-schedule__availability-editor">
                <header><div><small>LỊCH RẢNH TUẦN {currentWeekId}</small><strong>{student.name}</strong></div><span>{availabilityDraft.size} khung đã chọn</span></header>
                <AvailabilityMatrix days={workingDays} hours={workingHours} selected={availabilityDraft} onChange={setAvailabilityDraft} disabled={availabilityBusy} ariaLabel={`Lịch rảnh của ${student.name}`} />
                {availabilityError && <p role="alert">{availabilityError}</p>}
                <footer><button type="button" onClick={() => setAvailabilityEditorStudentId(null)}>Đóng</button><button type="button" className="is-save" disabled={availabilityBusy} onClick={() => void saveStudentAvailability(student)}><Save size={16} />{availabilityBusy ? 'Đang lưu' : 'Lưu lịch rảnh'}</button></footer>
              </section>}
            </article>)}
            {!studentRows.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có học viên phù hợp bộ lọc.</div>}
          </div>
        </main>
      )}

      {workspace && tab === 'warnings' && (
        <main className="branch-schedule__warning-page">
          <header><p>AURA VALIDATION</p><h2>Cảnh báo xếp lịch</h2><span>Mỗi hồ sơ đã gom đủ nguyên nhân, hợp đồng, PT, lịch rảnh, lịch đã xếp và ca gợi ý ngay tại đây.</span></header>
          <section className="schedule-warning-summary" aria-label="Tóm tắt cảnh báo">
            <article><strong>{warningProfiles.length}</strong><span>Học viên cần xử lý</span></article>
            <article><strong>{warningProfiles.reduce((total, profile) => total + profile.missingSessions, 0)}</strong><span>Buổi còn thiếu</span></article>
            <article><strong>{workspace.trainers.filter((trainer) => trainer.availabilityMode === 'unconfigured').length}</strong><span>PT thiếu lịch rảnh</span></article>
          </section>
          <section className="schedule-warning-grid">
            {workspace.trainers.filter((trainer) => trainer.availabilityMode === 'unconfigured').map((trainer) => <article key={trainer.id} className="schedule-warning-trainer is-blocking"><Clock3 /><div><strong>{trainer.name}</strong><span>{trainerEmploymentLabel(trainer.employmentType)} · chưa đăng ký lịch nhận ca nên không được xếp tự động.</span><small>Hạng #{trainer.schedulingPriority || 100} · mục tiêu {trainer.dailySessionTarget || 8} ca/ngày</small></div></article>)}
            {warningProfiles.map(({ student, missingSessions: missing, trainerNames, contract, scheduledEntries, reasonCodes, suggestedSlots }) => {
              const expanded = expandedWarningStudentId === student.id
              const remainingSessions = contract ? Math.max(0, Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0)) : 0
              return <article key={student.id} className={`schedule-warning-student${student.eligibleForWeek ? '' : ' is-blocking'}${expanded ? ' is-expanded' : ''}`}>
                <button type="button" onClick={() => setExpandedWarningStudentId(expanded ? null : student.id)} aria-expanded={expanded}>
                  <AlertTriangle /><div><span className="schedule-warning-student__title"><strong>{student.name}</strong>{missing > 0 && <b>Thiếu {missing}</b>}</span><span>{student.phone || `Mã ${student.id.slice(-8)}`} · {reasonCodes.slice(0, 2).map(ptScheduleConflictLabel).join(' · ')}</span></div><ChevronRight />
                </button>
                {expanded && <div className="schedule-warning-detail">
                  <section><small>Gói tập</small><strong>{contract?.packageName || 'Chưa có hợp đồng phù hợp'}</strong><em>{contract ? `${remainingSessions} buổi còn lại · ${String(contract.startDate || '').slice(0, 10)} → ${String(contract.endDate || '').slice(0, 10)}` : 'Cần đối soát hợp đồng'}</em></section>
                  <section><small>PT phụ trách</small><strong>{trainerNames || 'Chưa phân PT'}</strong><em>{trainerNames ? 'Theo hợp đồng và lịch hiện tại' : 'Sẽ xếp theo hạng PT'}</em></section>
                  <section className="is-wide"><small>Nguyên nhân cần xử lý</small><div>{reasonCodes.length ? reasonCodes.map((code) => <span key={code}>{ptScheduleConflictLabel(code)}</span>) : <em>Chưa tìm được phương án tối ưu</em>}</div></section>
                  <section className="is-wide"><small>Lịch rảnh · {student.availabilityStatus}</small><div>{student.availableSlots.length ? student.availableSlots.map((slot) => <span key={slot}>{availabilitySlotLabel(slot)}</span>) : <em>Chưa có lịch rảnh</em>}</div></section>
                  <section className="is-wide"><small>Lịch đã xếp</small><div>{scheduledEntries.length ? scheduledEntries.map((entry) => <span key={`${entry.slotId}-${entry.trainerId}`}>{entry.label}<b>{workspace.trainers.find((trainer) => trainer.id === entry.trainerId)?.name || 'PT chưa cập nhật'}</b></span>) : <em>Chưa có buổi nào trong tuần</em>}</div></section>
                  <section className="is-wide is-suggestion"><small>Ca hệ thống còn đề xuất</small><div>{suggestedSlots.length ? suggestedSlots.map((slot) => <span key={slot}>{availabilitySlotLabel(slot)}</span>) : <em>Không còn ca chung hợp lệ; cần bổ sung lịch rảnh hoặc PT.</em>}</div></section>
                </div>}
              </article>
            })}
            {!warningProfiles.length && workspace.summary.unconfiguredTrainers === 0 && <div className="schedule-warning-empty"><CheckCircle2 /> Không còn cảnh báo dữ liệu đầu vào.</div>}
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
