import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
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
  MoreHorizontal,
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
import { doc, onSnapshot } from 'firebase/firestore'
import AvailabilityMatrix from './AvailabilityMatrix'
import type { AccessContext } from '../../identity/access'
import { firestoreDb } from '../../lib/firebaseFirestore'
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
  type PtScheduleStudentFeasibility,
  type PtScheduleSwapMove,
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
type StudentFilter = 'all' | 'missing' | 'contract' | 'availability' | 'trainer' | 'ready'
type WorkspaceSyncState = 'connecting' | 'live' | 'syncing' | 'offline'
const CONFIRMED_AVAILABILITY_STATUSES = new Set(['submitted', 'locked', 'inherited', 'recurring'])
const QUIET_REFRESH_COOLDOWN_MS = 5_000
const BACKGROUND_REFRESH_INTERVAL_MS = 60_000
const APP_UPDATE_READY_KEY = 'aura:update-ready'
const APP_UPDATE_READY_EVENT = 'aura:update-ready'

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

function availabilityOriginLabel(student: { availabilityStatus: string; availabilitySourceWeekId?: string | null }) {
  if (student.availabilityStatus === 'inherited') return `kế thừa tuần ${student.availabilitySourceWeekId || 'gần nhất'}`
  if (student.availabilityStatus === 'recurring') return 'lịch mặc định cũ'
  if (['submitted', 'locked'].includes(student.availabilityStatus)) return 'đã gửi lịch rảnh'
  return 'thiếu lịch rảnh'
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
  under_target: 'Dưới mốc cân tải',
  target: 'Đạt mốc cân tải',
  over_target: 'Cao hơn mốc tham chiếu',
} as const

const STUDENT_AVAILABILITY_CONFLICTS = new Set(['AVAILABILITY_NOT_SUBMITTED', 'OUTSIDE_STUDENT_AVAILABILITY'])

function candidateMatchesStudentAvailability(candidate: PtScheduleSlotCandidate) {
  return candidate.matchesStudentAvailability
    ?? !candidate.reasons.some((reason) => STUDENT_AVAILABILITY_CONFLICTS.has(reason))
}

function candidateCanBeManuallyScheduled(candidate: PtScheduleSlotCandidate) {
  return candidate.manualSelectable
    ?? (candidate.eligible || candidate.reasons.every((reason) => STUDENT_AVAILABILITY_CONFLICTS.has(reason)))
}

function trainerEmploymentLabel(value: 'full_time' | 'part_time' | 'collaborator' | undefined) {
  if (value === 'collaborator') return 'CTV'
  if (value === 'part_time') return 'Part-time'
  return 'PT chính thức'
}

function contractQuota(contract: PtScheduleWorkspaceV2Result['contracts'][number] | null | undefined) {
  if (!contract) return { entitlement: 0, held: 0, schedulable: 0 }
  const entitlement = finiteCount(contract.remainingEntitlementSessions, Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0))
  const held = finiteCount(contract.activeScheduledSessions)
  const schedulable = finiteCount(contract.remainingSchedulableSessions, entitlement - held)
  return { entitlement, held, schedulable }
}

function diagnosticReasonLabel(code: string | undefined) {
  if (!code) return 'Chưa tìm được phương án xếp phù hợp.'
  return ptScheduleConflictLabel(code)
}

function diagnosticActionLabel(code: string | undefined) {
  switch (code) {
    case 'EDIT_STUDENT_AVAILABILITY': return 'Bổ sung / điều chỉnh lịch rảnh'
    case 'REVIEW_CONTRACT_QUOTA': return 'Kiểm tra quota hoặc nối tiếp hợp đồng'
    case 'REVIEW_CONTRACT_DATES': return 'Kiểm tra ngày hiệu lực hợp đồng'
    case 'ADD_TRAINER_AVAILABILITY': return 'Bổ sung lịch rảnh PT hoặc mở PT hỗ trợ'
    case 'OPEN_OTHER_SLOT': return 'Mở ca khác còn công suất'
    case 'RERUN_OPTIMIZER': return 'Chạy tối ưu lần 2 hoặc xếp tay'
    default: return 'Mở ca đề xuất và xử lý thủ công'
  }
}

function contractStatusLabel(status: string | undefined) {
  switch (status) {
    case 'expired': return 'Đã hết hạn'
    case 'expiring': return 'Sắp hết hạn trong tuần'
    case 'quota_exhausted': return 'Đã hết buổi'
    case 'paused': return 'Đang OFF / bảo lưu'
    case 'missing': return 'Chưa có hợp đồng'
    case 'not_started_or_ended': return 'Chưa có ngày hiệu lực phù hợp'
    default: return 'Còn hiệu lực'
  }
}

function formatDiagnosticDate(value: string | null | undefined) {
  if (!value) return ''
  const parsed = new Date(`${value}T00:00:00+07:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(parsed)
}

function workspaceRealtimeFingerprint(value: PtScheduleWorkspaceV2Result | null) {
  if (!value) return ''
  return JSON.stringify({
    branchId: value.branch.id,
    weekId: value.weekId,
    draftRevision: value.draftRevision,
    publishedVersion: value.publishedVersion,
    summary: value.summary,
    students: value.students.map((student) => [
      student.id, student.status, student.sessionsPerWeek, student.availabilityRevision,
      student.availabilityStatus, student.eligibleForWeek, student.remainingSchedulableSessions,
    ]),
    trainers: value.trainers.map((trainer) => [
      trainer.id, trainer.status, trainer.availabilityRevision, trainer.availabilityMode,
      trainer.slotCapacity, trainer.dailySessionTarget, trainer.schedulingPriority,
    ]),
    contracts: value.contracts.map((contract) => [
      contract.id, contract.status, contract.usedSessions, contract.activeScheduledSessions,
      contract.startDate, contract.endDate,
    ]),
    unassignedEntries: (value.unassignedEntries || value.unassigned || []).map((entry) => [
      entry.studentId, entry.missingSessions, entry.primaryReasonCode,
      entry.diagnostics?.contractStatus, entry.diagnostics?.trainerCompatibleSlotCount,
    ]),
  })
}

function localSlotCandidates(
  workspace: PtScheduleWorkspaceV2Result,
  trainerId: string,
  slotId: string,
) {
  const [day] = slotId.split('-')
  const dayIndex = Object.keys(DAY_LABELS).indexOf(day)
  const sessionDate = dayIndex >= 0
    ? new Date(`${workspace.weekId}T00:00:00+07:00`)
    : null
  if (sessionDate) sessionDate.setDate(sessionDate.getDate() + dayIndex)
  const date = sessionDate ? sessionDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) : ''
  const entries = Object.entries(workspace.schedule)
  const scheduledCounts = new Map<string, number>()
  Object.values(workspace.schedule).flat().forEach((entry) => {
    if (entry.type !== 'off') scheduledCounts.set(entry.studentId, (scheduledCounts.get(entry.studentId) || 0) + 1)
  })
  return workspace.students.map((student): PtScheduleSlotCandidate => {
    const reasons = new Set<string>()
    if (student.status === 'inactive' || student.eligibleForWeek !== true) {
      ;(student.eligibilityReasons?.length ? student.eligibilityReasons : ['STUDENT_NOT_ACTIVE']).forEach((reason) => reasons.add(reason))
    }
    if (student.branchId !== workspace.branch.id) reasons.add('STUDENT_BRANCH_MISMATCH')
    if (date && student.validScheduleDates?.length && !student.validScheduleDates.includes(date)) reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
    if (entries.some(([candidateSlotId, values]) => candidateSlotId.split('-')[0] === day
      && values.some((entry) => entry.type !== 'off' && entry.studentId === student.id))) reasons.add('STUDENT_MULTIPLE_SESSIONS_PER_DAY')

    const eligibleContracts = workspace.contracts.filter((contract) => contract.studentId === student.id
      && student.eligibleContractIds.includes(contract.id)
      && (!date || (String(contract.startDate || '').slice(0, 10) <= date && String(contract.endDate || '').slice(0, 10) >= date)))
    if (!eligibleContracts.length && student.eligibleForWeek) reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
    if (eligibleContracts.length > 1) reasons.add('AMBIGUOUS_ACTIVE_CONTRACT')
    const selectedContract = eligibleContracts.length === 1 ? eligibleContracts[0] : null
    const assignedTrainerIds = selectedContract
      ? [...new Set([selectedContract.trainerId, ...(selectedContract.trainerIds || [])].filter((value): value is string => Boolean(value)))]
      : []
    const trainerAssignmentWarning = assignedTrainerIds.length > 0 && !assignedTrainerIds.includes(trainerId)
    if (!CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus)) reasons.add('AVAILABILITY_NOT_SUBMITTED')
    else if (!student.availableSlots.includes(slotId)) reasons.add('OUTSIDE_STUDENT_AVAILABILITY')

    const reasonList = [...reasons]
    const availabilityReason = reasonList.find((reason) => reason === 'AVAILABILITY_NOT_SUBMITTED' || reason === 'OUTSIDE_STUDENT_AVAILABILITY') as PtScheduleSlotCandidate['availabilityReason'] || null
    const blockingReasons = reasonList.filter((reason) => reason !== 'AVAILABILITY_NOT_SUBMITTED' && reason !== 'OUTSIDE_STUDENT_AVAILABILITY')
    return {
      studentId: student.id,
      name: student.name || 'Chưa cập nhật tên',
      phone: student.phone || '',
      eligible: reasonList.length === 0,
      reasons: reasonList,
      contractId: selectedContract?.id || null,
      date,
      matchesStudentAvailability: !availabilityReason,
      manualSelectable: blockingReasons.length === 0,
      availabilityReason,
      trainerAssignmentWarning,
      assignedTrainerIds,
    }
  }).sort((left, right) => {
    const rank = (candidate: PtScheduleSlotCandidate) => candidate.eligible ? 0 : candidate.manualSelectable ? 1 : 2
    const leftStudent = workspace.students.find((student) => student.id === left.studentId)
    const rightStudent = workspace.students.find((student) => student.id === right.studentId)
    const leftMissing = Math.max(0, Number(leftStudent?.sessionsPerWeek || 0) - (scheduledCounts.get(left.studentId) || 0))
    const rightMissing = Math.max(0, Number(rightStudent?.sessionsPerWeek || 0) - (scheduledCounts.get(right.studentId) || 0))
    return rank(left) - rank(right)
      || Number(Boolean(left.trainerAssignmentWarning)) - Number(Boolean(right.trainerAssignmentWarning))
      || rightMissing - leftMissing
      || Number(leftStudent?.availableSlots?.length || 0) - Number(rightStudent?.availableSlots?.length || 0)
      || left.name.localeCompare(right.name, 'vi')
  })
}

export default function BranchScheduleWorkspace({ accessContext, onNavigate }: Props) {
  const [branches, setBranches] = useState<PtScheduleBranchOption[]>([])
  const [branchId, setBranchId] = useState(accessContext.branchIds[0] || '')
  const [branchCatalogState, setBranchCatalogState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [branchCatalogError, setBranchCatalogError] = useState<string | null>(null)
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
  const [pendingManualCandidate, setPendingManualCandidate] = useState<PtScheduleSlotCandidate | null>(null)
  const [hoveredStudentId, setHoveredStudentId] = useState<string | null>(null)
  const [highlightedStudentId, setHighlightedStudentId] = useState<string | null>(null)
  const [offConfirmation, setOffConfirmation] = useState(false)
  const [studentSearch, setStudentSearch] = useState('')
  const [studentFilter, setStudentFilter] = useState<StudentFilter>('all')
  const [syncState, setSyncState] = useState<WorkspaceSyncState>('connecting')
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [releaseUpdateReady, setReleaseUpdateReady] = useState(() => {
    try {
      return window.sessionStorage.getItem(APP_UPDATE_READY_KEY) === '1'
    } catch {
      return false
    }
  })
  const [expandedWarningStudentId, setExpandedWarningStudentId] = useState<string | null>(null)
  const [availabilityEditorStudentId, setAvailabilityEditorStudentId] = useState<string | null>(null)
  const [availabilityDraft, setAvailabilityDraft] = useState<Set<string>>(new Set())
  const [availabilityBusy, setAvailabilityBusy] = useState(false)
  const [availabilityError, setAvailabilityError] = useState('')
  const [resetDraftOpen, setResetDraftOpen] = useState(false)
  const [optimizationStatus, setOptimizationStatus] = useState<string | null>(null)
  const candidateCache = useRef(new Map<string, PtScheduleSlotCandidate[]>())
  const workspaceRef = useRef<PtScheduleWorkspaceV2Result | null>(null)
  const busyRef = useRef(false)
  const realtimeRefreshTimer = useRef<number | null>(null)
  const workspaceRequestRef = useRef<{ scope: string; promise: Promise<void> } | null>(null)
  const activeWorkspaceScopeRef = useRef('')
  const lastWorkspaceRequestAtRef = useRef(0)
  const moreMenuRef = useRef<HTMLDetailsElement | null>(null)
  const activeDialogRef = useRef<HTMLElement | null>(null)

  const weekDates = useMemo(() => getDatesForWeek(weekOffset), [weekOffset])
  const currentWeekId = weekDates.T2.full
  const workspaceScope = `${branchId}|${currentWeekId}`
  const workingDays = workspace?.scheduleConfig.workingDays?.length
    ? workspace.scheduleConfig.workingDays
    : ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
  const workingHours = workspace?.scheduleConfig.workingHours?.length
    ? workspace.scheduleConfig.workingHours
    : Array.from({ length: 16 }, (_, index) => index + 6)
  const holidayDates = useMemo(
    () => new Set((workspace?.scheduleConfig.holidays || []).map((value) => String(value).slice(0, 10))),
    [workspace?.scheduleConfig.holidays],
  )
  const mobileGroups = useMemo(() => {
    const result: string[][] = []
    for (let index = 0; index < workingDays.length; index += 2) result.push(workingDays.slice(index, index + 2))
    return result
  }, [workingDays])

  useEffect(() => { workspaceRef.current = workspace }, [workspace])
  useEffect(() => { busyRef.current = busy }, [busy])
  useEffect(() => { activeWorkspaceScopeRef.current = workspaceScope }, [workspaceScope])

  useEffect(() => {
    const hasDialog = Boolean(inspectorSlotId || publishPreview || resetDraftOpen || restoreCandidate)
    if (!hasDialog) return undefined
    const focusTimer = window.setTimeout(() => activeDialogRef.current?.querySelector<HTMLElement>('button, input, select, [tabindex="0"]')?.focus(), 0)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busyRef.current) return
      if (inspectorSlotId) {
        setInspectorSlotId(null)
        setPendingManualCandidate(null)
      } else if (publishPreview) setPublishPreview(null)
      else if (resetDraftOpen) setResetDraftOpen(false)
      else if (restoreCandidate) setRestoreCandidate(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [inspectorSlotId, publishPreview, resetDraftOpen, restoreCandidate])

  const loadWorkspace = useCallback(async (quiet = false) => {
    if (!branchId) return
    const requestScope = `${branchId}|${currentWeekId}`
    const inFlight = workspaceRequestRef.current
    if (inFlight?.scope === requestScope) {
      await inFlight.promise
      return
    }
    lastWorkspaceRequestAtRef.current = Date.now()
    const request = (async () => {
      if (!quiet) setLoading(true)
      if (!quiet || !workspaceRef.current) setSyncState('connecting')
      if (!quiet) setError(null)
      try {
        const result = await getPtScheduleWorkspace({ weekId: currentWeekId, branchId })
        if (activeWorkspaceScopeRef.current !== requestScope) return
        const changed = workspaceRealtimeFingerprint(workspaceRef.current) !== workspaceRealtimeFingerprint(result)
        if (!quiet) setWorkspace(result)
        else if (changed) startTransition(() => setWorkspace(result))
        setLastSyncedAt(new Date())
        setSyncState('live')
        const keepValidTrainer = (current: string) => result.trainers.some((trainer) => trainer.id === current)
          ? current
          : result.trainers[0]?.id || ''
        if (quiet) startTransition(() => setSelectedTrainerId(keepValidTrainer))
        else setSelectedTrainerId(keepValidTrainer)
      } catch (loadError) {
        if (activeWorkspaceScopeRef.current !== requestScope) return
        if (!quiet || !workspaceRef.current) {
          setWorkspace(null)
          setError(asPtSchedulePublishError(loadError).message)
        }
        setSyncState('offline')
      } finally {
        if (!quiet && activeWorkspaceScopeRef.current === requestScope) setLoading(false)
      }
    })()
    workspaceRequestRef.current = { scope: requestScope, promise: request }
    try {
      await request
    } finally {
      if (workspaceRequestRef.current?.promise === request) workspaceRequestRef.current = null
    }
  }, [branchId, currentWeekId])

  const loadBranches = useCallback(async () => {
    setBranchCatalogState('loading')
    setBranchCatalogError(null)
    try {
      const result = await listPtScheduleBranches()
      setBranches(result.branches)
      setBranchId((current) => result.branches.some((branch) => branch.id === current)
        ? current
        : result.branches[0]?.id || '')
      setBranchCatalogState('ready')
    } catch (branchError) {
      const normalized = asPtSchedulePublishError(branchError)
      const fallbackBranches = ['admin', 'super_admin'].includes(accessContext.accessRole)
        ? []
        : accessContext.branchIds.map((id) => ({ id, name: id, status: 'active' }))
      setBranches(fallbackBranches)
      setBranchId((current) => fallbackBranches.some((branch) => branch.id === current)
        ? current
        : fallbackBranches[0]?.id || '')
      setBranchCatalogError(normalized.message)
      setBranchCatalogState('error')
    }
  }, [accessContext.accessRole, accessContext.branchIds])

  useEffect(() => {
    void loadBranches()
  }, [loadBranches])

  useEffect(() => {
    setWorkspace((current) => current?.branch.id === branchId && current.weekId === currentWeekId ? current : null)
    void loadWorkspace()
    setNotice(null)
    setPublishPreview(null)
    setHistory(null)
    setInspectorSlotId(null)
    setPendingManualCandidate(null)
    setHoveredStudentId(null)
    setHighlightedStudentId(null)
    candidateCache.current.clear()
    setMobilePage(0)
  }, [branchId, currentWeekId, loadWorkspace])

  useEffect(() => {
    if (!notice) return undefined
    const timeout = window.setTimeout(() => setNotice(null), 3_600)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    const onUpdateReady = () => setReleaseUpdateReady(true)
    window.addEventListener(APP_UPDATE_READY_EVENT, onUpdateReady)
    return () => window.removeEventListener(APP_UPDATE_READY_EVENT, onUpdateReady)
  }, [])

  useEffect(() => {
    if (!branchId || !currentWeekId) return undefined
    const scheduleQuietRefresh = (delay = 180) => {
      if (document.visibilityState === 'hidden' || busyRef.current) return
      if (realtimeRefreshTimer.current !== null) window.clearTimeout(realtimeRefreshTimer.current)
      const cooldownRemaining = Math.max(0, QUIET_REFRESH_COOLDOWN_MS - (Date.now() - lastWorkspaceRequestAtRef.current))
      realtimeRefreshTimer.current = window.setTimeout(() => {
        realtimeRefreshTimer.current = null
        void loadWorkspace(true)
      }, Math.max(delay, cooldownRemaining))
    }
    const onFocus = () => scheduleQuietRefresh(80)
    const onVisibility = () => { if (document.visibilityState === 'visible') scheduleQuietRefresh(80) }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    // The draft stream contains branch-owned scheduling data only. Firestore
    // Rules limit it to Admin or the branch manager assigned to this branch.
    let stopDraftListener: (() => void) | undefined
    const canListenToDraft = ['admin', 'super_admin'].includes(accessContext.accessRole)
      || (accessContext.accessRole === 'staff' && accessContext.positions.includes('branch_manager'))
    if (firestoreDb && canListenToDraft) {
      stopDraftListener = onSnapshot(
        doc(firestoreDb, 'ptScheduleDrafts', `${branchId}_${currentWeekId}`),
        (snapshot) => {
          const revision = Number(snapshot.data()?.revision ?? 0)
          if (revision > Number(workspaceRef.current?.draftRevision || 0)) scheduleQuietRefresh()
        },
        () => setSyncState((current) => current === 'connecting' ? 'offline' : current),
      )
    }
    const refreshInterval = window.setInterval(
      () => scheduleQuietRefresh(0),
      BACKGROUND_REFRESH_INTERVAL_MS,
    )
    return () => {
      stopDraftListener?.()
      window.clearInterval(refreshInterval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      if (realtimeRefreshTimer.current !== null) window.clearTimeout(realtimeRefreshTimer.current)
    }
  }, [accessContext.accessRole, accessContext.positions, branchId, currentWeekId, loadWorkspace])

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (moreMenuRef.current?.open && !moreMenuRef.current.contains(event.target as Node)) moreMenuRef.current.open = false
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [])

  const selectedTrainer = workspace?.trainers.find((trainer) => trainer.id === selectedTrainerId) || null
  const inspectorEntries = useMemo(() => {
    if (!workspace || !inspectorSlotId || !selectedTrainerId) return []
    return (workspace.schedule[inspectorSlotId] || []).filter((entry) => entry.trainerId === selectedTrainerId)
  }, [inspectorSlotId, selectedTrainerId, workspace])

  const candidateGroups = useMemo(() => {
    const needle = candidateSearch.trim().toLocaleLowerCase('vi-VN')
    const visible = candidates.filter((candidate) => !inspectorEntries.some((entry) => entry.studentId === candidate.studentId)
      && (!needle || candidate.name.toLocaleLowerCase('vi-VN').includes(needle) || candidate.phone.includes(needle)))
    return [
      {
        key: 'available',
        label: 'Rảnh đúng khung giờ',
        hint: 'Ưu tiên xếp trước',
        items: visible.filter((candidate) => candidate.eligible && candidateMatchesStudentAvailability(candidate)),
      },
      {
        key: 'override',
        label: 'Ngoài lịch rảnh',
        hint: 'Vẫn có thể xếp tay',
        items: visible.filter((candidate) => !candidate.eligible && candidateCanBeManuallyScheduled(candidate)),
      },
      {
        key: 'blocked',
        label: 'Chưa đủ điều kiện',
        hint: 'Cần xử lý dữ liệu trước',
        items: visible.filter((candidate) => !candidateCanBeManuallyScheduled(candidate)),
      },
    ]
  }, [candidateSearch, candidates, inspectorEntries])

  const trainerAssignmentWarnings = useMemo(() => {
    if (!workspace) return []
    const contractsById = new Map(workspace.contracts.map((contract) => [contract.id, contract]))
    const rows: Array<{ key: string; slotId: string; studentId: string; trainerId: string; studentName: string; trainerName: string }> = []
    for (const [slotId, entries] of Object.entries(workspace.schedule)) {
      for (const entry of entries) {
        if (entry.type === 'off') continue
        const contract = entry.contractId ? contractsById.get(entry.contractId) : null
        const assigned = contract
          ? [...new Set([contract.trainerId, ...(contract.trainerIds || [])].filter((value): value is string => Boolean(value)))]
          : []
        const warning = entry.trainerAssignmentWarning === true || (assigned.length > 0 && !assigned.includes(entry.trainerId))
        if (!warning) continue
        rows.push({
          key: `${slotId}|${entry.studentId}|${entry.trainerId}`,
          slotId,
          studentId: entry.studentId,
          trainerId: entry.trainerId,
          studentName: workspace.students.find((student) => student.id === entry.studentId)?.name || 'Học viên chưa cập nhật',
          trainerName: workspace.trainers.find((trainer) => trainer.id === entry.trainerId)?.name || 'PT chưa cập nhật',
        })
      }
    }
    return rows.sort((left, right) => compareScheduleSlots(left.slotId, right.slotId) || left.studentName.localeCompare(right.studentName, 'vi'))
  }, [workspace])

  const trainerAssignmentWarningKeys = useMemo(
    () => new Set(trainerAssignmentWarnings.map((row) => row.key)),
    [trainerAssignmentWarnings],
  )

  const scheduledEntriesByStudent = useMemo(() => {
    const result = new Map<string, Array<{ slotId: string; trainerId: string; contractId: string; label: string; trainerAssignmentWarning: boolean }>>()
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
          trainerAssignmentWarning: trainerAssignmentWarningKeys.has(`${slotId}|${entry.studentId}|${entry.trainerId}`),
        })
        result.set(entry.studentId, values)
      }
    }
    for (const values of result.values()) values.sort((left, right) => compareScheduleSlots(left.slotId, right.slotId))
    return result
  }, [trainerAssignmentWarningKeys, weekDates, workspace])

  const operationalStudentRows = useMemo(() => {
    if (!workspace) return []
    const feasibilityByStudent = new Map<string, PtScheduleStudentFeasibility>(
      (workspace.optimizationSummary?.studentFeasibility || []).map((item) => [item.studentId, item]),
    )
    // Keep learners with an expired/exhausted/paused contract visible. They
    // are not auto-schedulable, but hiding them makes the operator miss the
    // actual reason why the weekly target is still empty.
    return workspace.students
      .filter((student) => !['archived', 'deleted'].includes(String(student.status || '').toLowerCase()))
      .map((student) => {
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
      const contract = contracts[contracts.length - 1]
        || workspace.contracts.filter((item) => item.studentId === student.id)
          .sort((left, right) => String(left.endDate || '').localeCompare(String(right.endDate || '')))
          .pop()
        || null
      const trainerIds = [...new Set([
        contract?.trainerId,
        ...(contract?.trainerIds || []),
        ...scheduledEntries.map((entry) => entry.trainerId),
      ].filter((value): value is string => Boolean(value)))]
      const trainerNames = trainerIds.map((id) => workspace.trainers.find((trainer) => trainer.id === id)?.name).filter(Boolean).join(', ')
      const inputWarning = missing > 0
        || student.eligibleForWeek !== true
        || student.contractStatus === 'expiring'
        || !CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus)
        || student.eligibilityReasons.includes('AMBIGUOUS_ACTIVE_CONTRACT')
      return { student, scheduled, scheduledEntries, missing, contract, trainerNames, inputWarning, feasibility: feasibilityByStudent.get(student.id) }
    })
  }, [scheduledEntriesByStudent, workspace])

  const studentWarnings = useMemo(() => operationalStudentRows.filter((row) => row.inputWarning), [operationalStudentRows])
  const ineligibleDraftRows = useMemo(() => (workspace?.students || [])
    .filter((student) => student.eligibleForWeek !== true && (scheduledEntriesByStudent.get(student.id)?.length || 0) > 0)
    .map((student) => ({ student, scheduledEntries: scheduledEntriesByStudent.get(student.id) || [] })), [scheduledEntriesByStudent, workspace])
  const missingSessions = studentWarnings.reduce((total, item) => total + item.missing, 0)
  const studentRows = useMemo(() => {
    const needle = studentSearch.trim().toLocaleLowerCase('vi-VN')
    const diagnosticsByStudent = new Map((workspace?.unassignedEntries || workspace?.unassigned || []).map((entry) => [entry.studentId, entry]))
    return operationalStudentRows.filter((row) => {
      if (studentFilter === 'missing' && row.missing < 1) return false
      if (studentFilter === 'contract' && row.student.contractStatus !== 'expiring' && row.student.eligibleForWeek === true && !row.student.eligibilityReasons.some((reason) => reason.includes('CONTRACT') || reason === 'ACTIVE_CONTRACT_NOT_FOUND')) return false
      if (studentFilter === 'availability' && CONFIRMED_AVAILABILITY_STATUSES.has(row.student.availabilityStatus)) return false
      if (studentFilter === 'trainer' && !['trainer_capacity', 'branch_capacity'].includes(diagnosticsByStudent.get(row.student.id)?.blockerCategory || '')) return false
      if (studentFilter === 'ready' && row.inputWarning) return false
      if (!needle) return true
      return [row.student.name, row.student.phone, row.contract?.packageName, row.trainerNames]
        .some((value) => String(value || '').toLocaleLowerCase('vi-VN').includes(needle))
    }).sort((left, right) => right.missing - left.missing || (left.student.name || '').localeCompare(right.student.name || '', 'vi'))
  }, [operationalStudentRows, studentFilter, studentSearch, workspace?.unassigned, workspace?.unassignedEntries])

  const studentCoverage = useMemo(() => {
    const source: PtScheduleStudentCoverage | undefined = workspace?.optimizationSummary?.studentCoverage
      || workspace?.studentCoverage
    const eligibleRows = operationalStudentRows.filter((row) => row.student.eligibleForWeek === true)
    const eligible = finiteCount(source?.eligibleStudents, source?.eligible, eligibleRows.length)
    const withAtLeastOneFallback = eligibleRows.filter((row) => row.scheduled > 0).length
    const fullyScheduledFallback = eligibleRows.filter((row) => row.missing === 0).length
    const totalTargetFallback = eligibleRows.reduce((total, row) => total + row.student.sessionsPerWeek, 0)
    const scheduledFallback = eligibleRows.reduce((total, row) => total + row.scheduled, 0)
    return {
      eligible,
      withAtLeastOne: finiteCount(source?.studentsWithAtLeastOne, source?.receivedAtLeastOne, source?.withAtLeastOne, withAtLeastOneFallback),
      fullyScheduled: finiteCount(source?.fullyScheduledStudents, source?.fullyScheduled, fullyScheduledFallback),
      totalTargetSessions: finiteCount(source?.requestedSessions, source?.totalTargetSessions, workspace?.optimizationSummary?.totalTargetSessions, totalTargetFallback),
      scheduledEntries: finiteCount(source?.scheduledSessions, source?.scheduledEntries, workspace?.optimizationSummary?.scheduledEntries, scheduledFallback),
      missingSessions: finiteCount(source?.missingSessions, workspace?.optimizationSummary?.missingSessions, missingSessions),
    }
  }, [missingSessions, operationalStudentRows, workspace])

  const slotUtilization = useMemo(() => {
    const source = workspace?.optimizationSummary?.slotUtilization
    if (source) return source
    const groups = new Map<string, number>()
    for (const [slotId, entries] of Object.entries(workspace?.schedule || {})) {
      for (const entry of entries) {
        if (entry.type === 'off') continue
        const key = `${entry.trainerId}|${slotId}`
        groups.set(key, (groups.get(key) || 0) + 1)
      }
    }
    let desiredSeats = 0
    let occupiedDesiredSeats = 0
    let pairedSlots = 0
    let singleSlots = 0
    let fullSlots = 0
    for (const [key, count] of groups) {
      const trainerId = key.split('|')[0]
      const capacity = Math.max(1, workspace?.trainers.find((trainer) => trainer.id === trainerId)?.slotCapacity || 1)
      const desiredCapacity = Math.min(2, capacity)
      desiredSeats += desiredCapacity
      occupiedDesiredSeats += Math.min(count, desiredCapacity)
      if (count >= 2) pairedSlots += 1
      if (count === 1) singleSlots += 1
      if (count >= desiredCapacity) fullSlots += 1
    }
    return {
      teachingSlots: groups.size,
      studentSessions: [...groups.values()].reduce((total, count) => total + count, 0),
      pairedSlots,
      singleSlots,
      fullSlots,
      pairRatePercent: groups.size ? Math.round(pairedSlots / groups.size * 1000) / 10 : 0,
      seatUtilizationPercent: desiredSeats ? Math.round(occupiedDesiredSeats / desiredSeats * 1000) / 10 : 0,
    }
  }, [workspace])

  const singleSlotWarnings = useMemo(() => {
    if (!workspace) return []
    const rows: Array<{ slotId: string; trainerId: string; trainerName: string; studentName: string }> = []
    for (const [slotId, entries] of Object.entries(workspace.schedule)) {
      const trainers = new Set(entries.filter((entry) => entry.type !== 'off').map((entry) => entry.trainerId))
      for (const trainerId of trainers) {
        const trainer = workspace.trainers.find((item) => item.id === trainerId)
        const trainingEntries = entries.filter((entry) => entry.type !== 'off' && entry.trainerId === trainerId)
        if (!trainer || trainer.slotCapacity < 2 || trainingEntries.length !== 1) continue
        rows.push({
          slotId,
          trainerId,
          trainerName: trainer.name,
          studentName: workspace.students.find((student) => student.id === trainingEntries[0].studentId)?.name || 'Học viên chưa cập nhật',
        })
      }
    }
    return rows.sort((left, right) => {
      const [leftDay, leftHour] = left.slotId.split('-')
      const [rightDay, rightHour] = right.slotId.split('-')
      return workingDays.indexOf(leftDay) - workingDays.indexOf(rightDay)
        || Number(leftHour) - Number(rightHour)
        || left.trainerName.localeCompare(right.trainerName, 'vi')
    })
  }, [workingDays, workspace])

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
      missingSessions: Math.max(0, finiteCount(entry.missingSessions, 0)),
      reasonCodes: entry.reasonCodes?.length
        ? entry.reasonCodes
        : (entry as PtScheduleUnassignedEntry & { reason?: string }).reason === 'trainer_off'
          ? ['TRAINER_ON_LEAVE']
          : ['STUDENT_UNSCHEDULED'],
    }]))
    for (const row of operationalStudentRows) {
      if ((row.missing < 1 && row.student.eligibleForWeek === true) || byStudent.has(row.student.id)) continue
      const reasonCodes: string[] = []
      if (!CONFIRMED_AVAILABILITY_STATUSES.has(row.student.availabilityStatus)) reasonCodes.push('STUDENT_AVAILABILITY_MISSING')
      reasonCodes.push(...row.student.eligibilityReasons)
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

  const unassignedByStudent = useMemo(
    () => new Map(unassignedEntries.map((entry) => [entry.studentId, entry])),
    [unassignedEntries],
  )

  const warningProfiles = useMemo(() => {
    if (!workspace) return []
    const operationalByStudent = new Map(operationalStudentRows.map((row) => [row.student.id, row]))
    const unassignedByStudent = new Map(unassignedEntries.map((entry) => [entry.studentId, entry]))
    const affectedIds = new Set([
      ...unassignedEntries.map((entry) => entry.studentId),
      ...studentWarnings.map((row) => row.student.id),
      ...ineligibleDraftRows.map((row) => row.student.id),
      // Contract/date/quota issues must be visible even when the learner has
      // no draft entry yet; previously only paused contracts reached this list.
      ...workspace.students.filter((student) => student.eligibleForWeek !== true || student.eligibilityReasons.length > 0).map((student) => student.id),
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
      if (!CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus)) reasonCodes.add('AVAILABILITY_NOT_SUBMITTED')
      if (student.contractStatus === 'expiring') reasonCodes.add('CONTRACT_EXPIRES_DURING_WEEK')
      if ((row?.missing || unassigned?.missingSessions || 0) > 0 && !reasonCodes.size) reasonCodes.add('STUDENT_UNSCHEDULED')
      const hasConfirmedAvailability = CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus)
        && student.availableSlots.length > 0
      const missingSessions = Math.max(0, row?.missing || unassigned?.missingSessions || 0)
      const primaryReasonCode = unassigned?.primaryReasonCode
        || (student.contractStatus === 'expiring' ? 'CONTRACT_EXPIRES_DURING_WEEK' : [...reasonCodes][0])
        || (missingSessions > 0 ? 'STUDENT_UNSCHEDULED' : undefined)
      const actionCode = unassigned?.actionCode
        || (student.contractStatus === 'expiring' ? 'REVIEW_CONTRACT_DATES' : undefined)
      return {
        student,
        contract,
        trainerNames,
        scheduledEntries,
        missingSessions,
        reasonCodes: [...reasonCodes],
        primaryReasonCode,
        blockerCategory: unassigned?.blockerCategory,
        actionCode,
        diagnostics: unassigned?.diagnostics || {
          contractStatus: student.contractStatus,
          latestContractEndDate: student.contractEndDate,
          contractQuotaRemaining: student.remainingEntitlementSessions,
          contractValidDateCount: student.validScheduleDates.length,
          candidateSlotCount: student.availableSlots.length,
          learnerAvailabilityCount: hasConfirmedAvailability ? student.availableSlots.length : 0,
        },
        candidateSlots: unassigned?.candidateSlots || [],
        suggestedSlots: unassigned?.suggestedSlots || [],
        hasConfirmedAvailability,
        offState: reasonCodes.has('CONTRACT_PAUSED')
          ? 'student'
          : reasonCodes.has('TRAINER_ON_LEAVE')
            ? 'trainer'
            : null,
      }
    }).filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
      .sort((left, right) => {
        const priority = (profile: typeof left) => profile.hasConfirmedAvailability && profile.scheduledEntries.length === 0 && profile.missingSessions > 0
          ? 0
          : profile.hasConfirmedAvailability && profile.missingSessions > 0
            ? 1
            : profile.offState
              ? 2
              : profile.hasConfirmedAvailability
                ? 3
                : 4
        return priority(left) - priority(right)
          || right.missingSessions - left.missingSessions
          || left.student.name.localeCompare(right.student.name, 'vi')
      })
  }, [ineligibleDraftRows, operationalStudentRows, scheduledEntriesByStudent, studentWarnings, unassignedEntries, workspace])

  const draftResetSummary = useMemo(() => {
    const entries = Object.values(workspace?.schedule || {}).flat()
    const resettable = entries.filter((entry) => entry.type !== 'off' && entry.isLocked !== true && entry.source !== 'published_existing')
    return {
      resettableEntries: resettable.length,
      affectedStudents: new Set(resettable.map((entry) => entry.studentId)).size,
      protectedEntries: entries.length - resettable.length,
    }
  }, [workspace?.schedule])

  const selectedTrainerLoads = useMemo(() => trainerLoads.filter((load) => load.trainerId === selectedTrainerId), [selectedTrainerId, trainerLoads])
  const optimizationTrace = useMemo<PtScheduleSwapMove[]>(
    () => workspace?.optimizationSummary?.swapTrace || [],
    [workspace?.optimizationSummary?.swapTrace],
  )
  const warningCount = useMemo(() => {
    return warningProfiles.length + singleSlotWarnings.length + trainerAssignmentWarnings.length + (workspace?.summary.unconfiguredTrainers || 0)
  }, [singleSlotWarnings.length, trainerAssignmentWarnings.length, warningProfiles.length, workspace?.summary.unconfiguredTrainers])
  const warningCategoryCounts = useMemo(() => ({
    contract: warningProfiles.filter((profile) => profile.blockerCategory === 'contract'
      || (Boolean(profile.student.contractStatus) && profile.student.contractStatus !== 'valid')
      || profile.reasonCodes.some((reason) => reason.includes('CONTRACT') || reason === 'ACTIVE_CONTRACT_NOT_FOUND')).length,
    availability: warningProfiles.filter((profile) => !profile.hasConfirmedAvailability
      || profile.blockerCategory === 'learner_availability').length,
    trainer: warningProfiles.filter((profile) => ['trainer_capacity', 'branch_capacity'].includes(profile.blockerCategory || '')).length,
  }), [warningProfiles])

  useEffect(() => {
    if (!workspace || !inspectorSlotId || !selectedTrainerId) {
      setCandidates([])
      return undefined
    }
    const normalizedCandidateSearch = candidateSearch.trim().toLocaleLowerCase('vi-VN')
    const cacheKey = `${branchId}|${currentWeekId}|${workspace.draftRevision}|${selectedTrainerId}|${inspectorSlotId}|${normalizedCandidateSearch}`
    const cached = candidateCache.current.get(cacheKey)
    if (cached) {
      setCandidates(cached)
      setCandidateLoading(false)
      return undefined
    }
    // Render a safe local preview immediately. The server response remains the
    // source of truth and replaces this preview before a command is confirmed.
    if (!normalizedCandidateSearch) setCandidates(localSlotCandidates(workspace, selectedTrainerId, inspectorSlotId))
    let active = true
    setCandidateLoading(true)
    const debounce = window.setTimeout(() => {
      getPtScheduleSlotCandidates({
        weekId: currentWeekId,
        branchId,
        trainerId: selectedTrainerId,
        slotId: inspectorSlotId,
        ...(normalizedCandidateSearch ? { search: normalizedCandidateSearch } : {}),
      }).then((result) => {
        if (!active) return
        candidateCache.current.set(cacheKey, result.candidates)
        setCandidates(result.candidates)
      }).catch((candidateError) => {
        if (active) setError(asPtSchedulePublishError(candidateError).message)
      }).finally(() => {
        if (active) setCandidateLoading(false)
      })
    }, normalizedCandidateSearch ? 280 : 0)
    return () => {
      active = false
      window.clearTimeout(debounce)
    }
  }, [branchId, candidateSearch, currentWeekId, inspectorSlotId, selectedTrainerId, workspace, workspace?.draftRevision])

  const runCommand = async (command: PtScheduleDraftCommand, payload: Record<string, unknown>, reason?: string) => {
    if (!workspace) return false
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
      if (command === 'add_student' || command === 'move_student') setPendingManualCandidate(null)
      return true
    } catch (commandError) {
      const normalized = asPtSchedulePublishError(commandError)
      setError(normalized.message)
      if (normalized.issueCode === 'REVISION_CONFLICT') await loadWorkspace(true)
      return false
    } finally {
      setBusy(false)
    }
  }

  const confirmManualCandidate = async () => {
    if (!pendingManualCandidate || !inspectorSlotId || !selectedTrainerId) return
    const outsideAvailability = !candidateMatchesStudentAvailability(pendingManualCandidate)
    const reason = [
      outsideAvailability ? 'Quản lý xác nhận xếp tay ngoài lịch rảnh học viên' : 'Quản lý xác nhận xếp tay',
      pendingManualCandidate.trainerAssignmentWarning ? 'PT hỗ trợ ngoài danh sách PT chính/phụ' : '',
      pendingManualCandidate.studentBranchWarning ? 'Xác nhận học viên tập khác cơ sở hồ sơ' : '',
    ].filter(Boolean).join(' · ')
    await runCommand('add_student', {
      slotId: inspectorSlotId,
      trainerId: selectedTrainerId,
      studentId: pendingManualCandidate.studentId,
      ...(outsideAvailability ? { allowOutsideStudentAvailability: true } : {}),
      ...(pendingManualCandidate.studentBranchWarning ? { confirmCrossBranchStudent: true } : {}),
    }, reason)
  }

  const setWeeklyTarget = async (studentId: string, targetSessions: number | null) => {
    await runCommand('set_student_weekly_target', targetSessions === null
      ? { studentId, resetToDefault: true }
      : { studentId, targetSessions }, targetSessions === null ? 'Khôi phục định mức hồ sơ' : 'Điều chỉnh mục tiêu riêng cho tuần')
  }

  const resetDraft = async () => {
    if (!workspace || draftResetSummary.resettableEntries < 1) return
    await runCommand('reset_draft', {}, 'Đặt lại lịch nháp chưa publish')
    setResetDraftOpen(false)
    setTab('warnings')
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
    setOptimizationStatus('Đang đối chiếu lịch rảnh, hợp đồng và công suất từng khung…')
    const deepSearchTimer = window.setTimeout(() => {
      setOptimizationStatus('Đang thử các chuỗi đổi chỗ an toàn để lấp những buổi còn thiếu…')
    }, 1_200)
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
      const unresolved = result.unassignedEntries?.length || result.unassigned?.length || 0
      const passes = Math.max(1, Number(result.optimizationSummary?.optimizationPasses || 1))
      const refilled = Math.max(0, Number(result.optimizationSummary?.refillAssignments || 0))
      const repaired = Math.max(0, Number(result.optimizationSummary?.rescueAssignments ?? result.optimizationSummary?.repairAssignments ?? 0))
      const relocated = Math.max(0, Number(result.optimizationSummary?.rescueRelocations ?? result.optimizationSummary?.repairRelocations ?? 0))
      const searchLimitReached = result.optimizationSummary?.rescueSearchLimitReached === true || result.optimizationSummary?.repairSearchLimitReached === true
      const improvements = [
        refilled ? `lấp thêm ${refilled} buổi` : '',
        repaired ? `cứu thêm ${repaired} buổi bằng ${relocated} lần đổi chỗ` : '',
      ].filter(Boolean).join(', ')
      const deepRun = passes > 1 ? ` Đã chạy ${passes} lượt tối ưu${improvements ? `, ${improvements}` : ''}.` : ''
      const searchNote = searchLimitReached ? ' Bộ tìm kiếm đã chạm giới hạn an toàn; các hồ sơ còn lại cần xem ở tab Cảnh báo.' : ''
      setNotice(unresolved
        ? `Đã tối ưu draft r${result.draftRevision}; còn ${unresolved} hồ sơ cần xử lý.${deepRun}${searchNote}`
        : `Đã tối ưu draft r${result.draftRevision}; đã ưu tiên đủ học viên, ca đôi và PT chính/phụ.${deepRun}${searchNote}`)
      if (unresolved) setTab('warnings')
    } catch (arrangeError) {
      const normalized = asPtSchedulePublishError(arrangeError)
      setError(normalized.message)
      if (normalized.issueCode === 'REVISION_CONFLICT') await loadWorkspace(true)
    } finally {
      window.clearTimeout(deepSearchTimer)
      setOptimizationStatus(null)
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
  const highlightedStudent = workspace?.students.find((student) => student.id === highlightedStudentId) || null
  const hoveredStudent = workspace?.students.find((student) => student.id === hoveredStudentId) || null
  const selectedDays = mobileGroups[mobilePage] || mobileGroups[0] || []

  if (!branchId && branchCatalogState === 'loading') {
    return <section className="branch-schedule branch-schedule__blocked" role="status"><RefreshCw className="is-spinning" size={30} /><h1>Đang tải phạm vi chi nhánh</h1><p>Aura đang đối chiếu quyền Admin và danh sách chi nhánh hoạt động.</p></section>
  }

  if (!branchId && branchCatalogState === 'error') {
    return <section className="branch-schedule branch-schedule__blocked is-error" role="alert"><AlertTriangle size={30} /><h1>Không thể tải phạm vi chi nhánh</h1><p>{branchCatalogError || 'Dịch vụ lịch chưa phản hồi. Đây không phải trạng thái chi nhánh trống.'}</p><button type="button" onClick={() => void loadBranches()}><RefreshCw size={17} /> Kết nối lại</button></section>
  }

  if (!branchId && branchCatalogState === 'ready' && branches.length === 0) {
    return <section className="branch-schedule branch-schedule__blocked"><CalendarDays size={30} /><h1>Chưa có chi nhánh hoạt động</h1><p>Hãy tạo chi nhánh hoặc cấp phạm vi trước khi xếp lịch.</p></section>
  }

  return (
    <div className="branch-schedule">
      <header className="branch-schedule__hero">
        <div>
          <span><CalendarDays size={16} /> AURA PT</span>
          <h1>Xếp lịch PT</h1>
        </div>
        <div className="branch-schedule__hero-controls">
          <label><span>Chi nhánh</span><select aria-label="Chọn chi nhánh" value={branchId} onChange={(event) => setBranchId(event.target.value)}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <div className="branch-schedule__week">
            <button type="button" aria-label="Tuần trước" onClick={() => setWeekOffset((value) => Math.max(0, value - 1))}><ChevronLeft /></button>
            <div><span>Tuần</span><strong>{weekDates.T2.display} – {weekDates.CN.display}</strong></div>
            <button type="button" aria-label="Tuần sau" onClick={() => setWeekOffset((value) => value + 1)}><ChevronRight /></button>
          </div>
          <span className={`branch-schedule__sync is-${syncState}`} title={lastSyncedAt ? `Cập nhật lúc ${lastSyncedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Đang kết nối dữ liệu'}><Activity size={14} />{syncState === 'live' ? 'Trực tiếp' : syncState === 'offline' ? 'Mất kết nối' : 'Đang đồng bộ'}</span>
        </div>
      </header>

      <section className="branch-schedule__summary-strip" aria-label="Tóm tắt lịch tuần">
        <button type="button" onClick={() => setTab('students')}><UsersRound /><strong>{studentCoverage.fullyScheduled}/{studentCoverage.eligible}</strong><span>học viên đủ lịch</span></button>
        <button type="button" onClick={() => setTab('students')}><CalendarRange /><strong>{studentCoverage.scheduledEntries}/{studentCoverage.totalTargetSessions}</strong><span>buổi đã xếp</span></button>
        <button type="button" onClick={() => setTab('warnings')} className={slotUtilization.singleSlots > 0 ? 'is-attention' : ''}><UsersRound /><strong>{slotUtilization.pairedSlots} đôi</strong><span>{slotUtilization.singleSlots} ca còn lẻ</span></button>
        <button type="button" onClick={() => setTab('warnings')} className={warningCount > 0 ? 'is-attention' : ''}><AlertTriangle /><strong>{warningCount}</strong><span>cảnh báo cần xem</span></button>
      </section>

      <section className="branch-schedule__toolbar">
        <div className="branch-schedule__tabs" role="tablist" aria-label="Nội dung xếp lịch">
          <button id="schedule-tab-matrix" type="button" role="tab" aria-selected={tab === 'matrix'} aria-controls="schedule-panel-matrix" tabIndex={tab === 'matrix' ? 0 : -1} className={tab === 'matrix' ? 'is-active' : ''} onClick={() => setTab('matrix')}>Lịch PT</button>
          <button id="schedule-tab-warnings" type="button" role="tab" aria-selected={tab === 'warnings'} aria-controls="schedule-panel-warnings" tabIndex={tab === 'warnings' ? 0 : -1} className={tab === 'warnings' ? 'is-active' : ''} onClick={() => setTab('warnings')}>Cảnh báo <b>{warningCount}</b></button>
          <button id="schedule-tab-students" type="button" role="tab" aria-selected={tab === 'students'} aria-controls="schedule-panel-students" tabIndex={tab === 'students' ? 0 : -1} className={tab === 'students' ? 'is-active' : ''} onClick={() => setTab('students')}>Học viên</button>
        </div>
        <div className="branch-schedule__actions">
          <button type="button" onClick={() => void autoArrange()} disabled={!workspace || busy}><Sparkles size={16} /><span>Xếp tối ưu</span></button>
          <button type="button" className="is-publish" onClick={() => void validatePublish()} title="Kiểm tra & Publish" disabled={!workspace || busy}><CheckCircle2 size={16} /><span>Publish</span></button>
          <details className="branch-schedule__more" ref={moreMenuRef}>
            <summary aria-label="Mở thêm công cụ" title="Thêm công cụ"><MoreHorizontal size={18} /></summary>
            <div>
              <header><strong>Công cụ khác</strong><span>Draft r{workspace?.draftRevision || 0} · lịch v{workspace?.publishedVersion || 0}</span></header>
              <button type="button" onClick={() => { moreMenuRef.current?.removeAttribute('open'); void openHistory() }}><History size={16} /><span><strong>Lịch sử & khôi phục</strong><small>Dùng khi cần quay lại lịch đã publish</small></span></button>
              <button type="button" onClick={() => { moreMenuRef.current?.removeAttribute('open'); setResetDraftOpen(true) }} disabled={!workspace || busy || draftResetSummary.resettableEntries < 1}><RotateCcw size={16} /><span><strong>Đặt lại draft</strong><small>Giữ nguyên ca khóa, OFF và đã publish</small></span></button>
              <button type="button" onClick={() => { moreMenuRef.current?.removeAttribute('open'); void loadWorkspace() }} disabled={loading || busy}><RefreshCw size={16} className={loading ? 'is-spinning' : ''} /><span><strong>Tải lại dữ liệu</strong><small>Đồng bộ lại ngay bây giờ</small></span></button>
            </div>
          </details>
        </div>
      </section>

      {notice && <div className="branch-schedule__notice" role="status">{notice}</div>}
      {releaseUpdateReady && <div className="branch-schedule__update-ready" role="status"><span>Aura có bản cập nhật mới. Lịch đang mở được giữ nguyên để không mất thao tác.</span><button type="button" onClick={() => window.location.reload()}><RefreshCw size={14} /> Cập nhật khi sẵn sàng</button></div>}
      {branchCatalogError && <div className="branch-schedule__error branch-schedule__branch-warning" role="alert"><span>{branchCatalogError}</span><button type="button" onClick={() => void loadBranches()}><RefreshCw size={15} /> Tải lại chi nhánh</button></div>}
      {error && <div className="branch-schedule__error" role="alert">{error}</div>}
      {optimizationStatus && <div className="branch-schedule__optimization-progress" role="status" aria-live="polite"><RefreshCw className="is-spinning" /><div><strong>Bộ tối ưu lịch đang chạy</strong><span>{optimizationStatus}</span></div></div>}
      {!optimizationStatus && optimizationTrace.length > 0 && <details className="branch-schedule__optimization-trace">
        <summary><span><Sparkles size={16} /><strong>{optimizationTrace.length} bước xếp/đổi chỗ gần nhất</strong></span><small>Chạm để xem chuỗi tối ưu</small></summary>
        <ol>{optimizationTrace.map((move, index) => {
          const fromTrainer = workspace?.trainers.find((trainer) => trainer.id === move.fromTrainerId)?.name || 'PT cũ'
          const toTrainer = workspace?.trainers.find((trainer) => trainer.id === move.toTrainerId)?.name || 'PT mới'
          return <li key={`${move.studentId}-${move.fromSlotId || 'new'}-${move.toSlotId}-${index}`}><b>{index + 1}</b><div><strong>{move.studentName || studentName(move.studentId)}</strong><span>{move.fromSlotId ? `${scheduleSlotLabel(move.fromSlotId, weekDates)} · ${fromTrainer} → ` : 'Bổ sung vào '}{scheduleSlotLabel(move.toSlotId, weekDates)} · {toTrainer}</span></div></li>
        })}</ol>
      </details>}
      {!optimizationStatus && (workspace?.optimizationSummary?.rescueSearchLimitReached || workspace?.optimizationSummary?.repairSearchLimitReached) && <div className="branch-schedule__search-limit" role="status"><AlertTriangle size={16} /> Đã chạm giới hạn tìm kiếm an toàn. Các ca thủ công, ca khóa và ca đã publish vẫn được giữ nguyên; hãy xem hồ sơ còn thiếu trong Cảnh báo.</div>}
      {loading && !workspace && <div className="branch-schedule__loading"><RefreshCw className="is-spinning" /> Đang tải workspace theo phạm vi…</div>}

      {workspace && tab === 'matrix' && (
        <main id="schedule-panel-matrix" role="tabpanel" aria-labelledby="schedule-tab-matrix" className="branch-schedule__workspace">
          <section className="branch-schedule__matrix-toolbar">
            <label><span>Huấn luyện viên</span><select value={selectedTrainerId} onChange={(event) => setSelectedTrainerId(event.target.value)}>{workspace.trainers.map((trainer) => <option key={trainer.id} value={trainer.id}>{trainer.name}</option>)}</select></label>
            {selectedTrainer && <div className={`trainer-availability-chip is-${selectedTrainer.availabilityMode}`}><Clock3 size={14} />{selectedTrainer.availabilityMode === 'configured' ? `${selectedTrainer.availableSlots?.length || 0} khung giờ rảnh` : selectedTrainer.availabilityMode === 'unrestricted' ? 'Không giới hạn' : 'Chưa khai lịch rảnh'}</div>}
          </section>

          <details className="branch-schedule__trainer-details">
            <summary><span><strong>Phân bổ ca PT</strong><small>Mốc tải chỉ dùng để cân bằng; Aura vẫn ưu tiên xếp đủ buổi học viên</small></span>{selectedTrainer && <b>{selectedTrainerLoads.reduce((total, load) => total + load.count, 0)} ca tuần <ChevronRight size={15} /></b>}</summary>
            <section className="trainer-workload" aria-label="Tải ca huấn luyện viên theo ngày">
              <div className="trainer-workload__rail">
                {workspace.trainers.map((trainer) => {
                  const loads = trainerLoads.filter((load) => load.trainerId === trainer.id)
                  const total = loads.reduce((sum, load) => sum + load.count, 0)
                  const priority = finiteCount(trainer.schedulingPriority, trainer.priority)
                  const target = loads[0]?.target || trainer.dailySessionTarget || 8
                  return <button type="button" key={trainer.id} className={`trainer-workload__card${trainer.id === selectedTrainerId ? ' is-active' : ''}`} onClick={() => setSelectedTrainerId(trainer.id)}>
                    <span className="trainer-workload__identity"><strong>{trainer.name} · {total} ca</strong><small>{trainerEmploymentLabel(trainer.employmentType)} · {priority > 0 ? `hạng #${priority}` : 'tự cân tải'} · mốc cân tải {target}</small></span>
                    <span className="trainer-workload__days">{loads.map((load) => <i key={load.day} className={`is-${load.status}`} title={`${DAY_LABELS[load.day] || load.day}: ${load.count} ca · mốc ${load.target} · ${TRAINER_LOAD_LABELS[load.status]}`}><small>{load.day}</small><b>{load.count}{load.status === 'over_target' ? ` · mốc ${load.target}` : `/${load.target}`}</b></i>)}</span>
                  </button>
                })}
              </div>
            </section>
          </details>

          <div className="branch-schedule__mobile-days">
            <button type="button" disabled={mobilePage === 0} onClick={() => setMobilePage((value) => Math.max(0, value - 1))}><ChevronLeft /></button>
            <strong>{selectedDays.map((day) => DAY_LABELS[day] || day).join(' · ')}</strong>
            <button type="button" disabled={mobilePage >= mobileGroups.length - 1} onClick={() => setMobilePage((value) => Math.min(mobileGroups.length - 1, value + 1))}><ChevronRight /></button>
          </div>

          {(highlightedStudent || hoveredStudent) && <div className={`schedule-student-focus${highlightedStudent ? ' is-pinned' : ''}`} role="status">
            <span>{highlightedStudent ? <><strong>{highlightedStudent.name}</strong> · ô đỏ là lịch đã xếp trong tuần</> : <><strong>{hoveredStudent?.name}</strong> · ô xanh là lịch rảnh đã đăng ký</>}</span>
            {highlightedStudent && <button type="button" onClick={() => setHighlightedStudentId(null)}>Bỏ đánh dấu</button>}
          </div>}

          <div className="branch-schedule__matrix-shell">
            <table className="branch-schedule__grid">
              <thead><tr><th>Giờ</th>{workingDays.map((day) => {
                const date = weekDates[day as keyof typeof weekDates]?.full || ''
                const holiday = holidayDates.has(date)
                return <th key={day} className={`${selectedDays.includes(day) ? 'is-mobile-visible' : ''}${holiday ? ' is-holiday' : ''}`}><span>{DAY_LABELS[day] || day}</span><small>{holiday ? 'Ngày nghỉ' : weekDates[day as keyof typeof weekDates]?.display}</small></th>
              })}</tr></thead>
              <tbody>{workingHours.map((hour) => <tr key={hour}><th>{String(hour).padStart(2, '0')}:00</th>{workingDays.map((day) => {
                const slotId = `${day}-${hour}`
                const entries = (workspace.schedule[slotId] || []).filter((entry) => entry.trainerId === selectedTrainerId)
                const allSlotEntries = workspace.schedule[slotId] || []
                const isOff = entries.some((entry) => entry.type === 'off')
                const holiday = holidayDates.has(weekDates[day as keyof typeof weekDates]?.full || '')
                const showsAvailability = Boolean(hoveredStudent?.availableSlots.includes(slotId))
                const showsStudentSchedule = Boolean(highlightedStudentId && allSlotEntries.some((entry) => entry.type !== 'off' && entry.studentId === highlightedStudentId))
                const openInspector = () => {
                  if (!selectedTrainerId || holiday) return
                  setInspectorSlotId(slotId)
                  setCandidateSearch('')
                  setOffConfirmation(false)
                  setPendingManualCandidate(null)
                }
                return <td key={slotId} className={`${selectedDays.includes(day) ? 'is-mobile-visible' : ''}${holiday ? ' is-holiday' : ''}`}><div role="button" tabIndex={!selectedTrainerId || holiday ? -1 : 0} aria-disabled={!selectedTrainerId || holiday} className={`schedule-cell${holiday ? ' is-holiday' : ''}${isOff ? ' is-off' : ''}${entries.length ? ' has-entry' : ''}${showsAvailability ? ' is-availability-hover' : ''}${showsStudentSchedule ? ' is-student-highlight' : ''}`} onClick={openInspector} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openInspector() } }}><span className="schedule-cell__count">{holiday ? 'NGHỈ' : isOff ? 'OFF' : `${entries.filter((entry) => entry.type !== 'off').length}/${selectedTrainer?.slotCapacity || 2}`}</span>{holiday ? <><CalendarOff /><small>Không xếp lịch</small></> : isOff ? <CalendarOff /> : entries.length ? entries.filter((entry) => entry.type !== 'off').map((entry) => {
                  const assignmentWarning = trainerAssignmentWarningKeys.has(`${slotId}|${entry.studentId}|${entry.trainerId}`)
                  return <button type="button" className={`schedule-cell__student${highlightedStudentId === entry.studentId ? ' is-selected' : ''}${assignmentWarning ? ' has-assignment-warning' : ''}`} key={`${entry.studentId}-${entry.trainerId}`} onMouseEnter={() => setHoveredStudentId(entry.studentId)} onMouseLeave={() => setHoveredStudentId((current) => current === entry.studentId ? null : current)} onFocus={() => setHoveredStudentId(entry.studentId)} onBlur={() => setHoveredStudentId((current) => current === entry.studentId ? null : current)} onClick={(event) => { event.stopPropagation(); setHighlightedStudentId((current) => current === entry.studentId ? null : entry.studentId) }} aria-pressed={highlightedStudentId === entry.studentId} title={assignmentWarning ? 'PT hỗ trợ ngoài danh sách PT chính/phụ · Rê chuột xem lịch rảnh · Bấm đánh dấu lịch tuần' : 'Rê chuột: xem lịch rảnh · Bấm: đánh dấu lịch tuần'}><span>{studentName(entry.studentId)}</span>{assignmentWarning && <AlertTriangle size={11} aria-label="PT hỗ trợ" />}{entry.isLocked && <Lock size={11} />}</button>
                }) : <small>Chạm để xếp</small>}</div></td>
              })}</tr>)}</tbody>
            </table>
          </div>
        </main>
      )}

      {workspace && tab === 'students' && (
        <main id="schedule-panel-students" role="tabpanel" aria-labelledby="schedule-tab-students" className="branch-schedule__students-page">
          <header><div><p>HỌC VIÊN TRONG TUẦN</p><h2>Tiến độ xếp lịch</h2><span>Chạm vào từng hồ sơ để xem hoặc điều chỉnh lịch rảnh.</span></div>{onNavigate && <button type="button" onClick={() => onNavigate('admin-pt-students')}><UserPlus size={16} /> Hồ sơ học viên</button>}</header>
          <div className="branch-schedule__student-tools">
            <label><Search size={17} /><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Tên, SĐT, gói tập hoặc PT" /></label>
            <select aria-label="Lọc trạng thái học viên" value={studentFilter} onChange={(event) => setStudentFilter(event.target.value as StudentFilter)}><option value="all">Tất cả học viên</option><option value="missing">Còn thiếu buổi</option><option value="contract">Lỗi hợp đồng / quota</option><option value="availability">Thiếu lịch rảnh</option><option value="trainer">Thiếu PT / công suất</option><option value="ready">Đã đủ lịch</option></select>
          </div>
          <div className="branch-schedule__student-list">
            {studentRows.map(({ student, scheduled, scheduledEntries, missing, contract, trainerNames, feasibility }) => {
              const diagnosis = unassignedByStudent.get(student.id)
              const contractIssue = student.eligibilityReasons.find((reason) => reason.includes('CONTRACT') || reason === 'ACTIVE_CONTRACT_NOT_FOUND')
              const primaryReason = diagnosis?.primaryReasonCode || contractIssue || (missing > 0 ? 'STUDENT_UNSCHEDULED' : undefined)
              const statusText = student.eligibleForWeek !== true
                ? diagnosticReasonLabel(primaryReason)
                : missing > 0
                  ? diagnosticReasonLabel(primaryReason)
                  : 'Đã đủ lịch tuần'
              return <article key={student.id} className={`${missing > 0 ? 'is-missing' : 'is-ready'}${student.eligibleForWeek !== true ? ' is-ineligible' : ''}${availabilityEditorStudentId === student.id ? ' is-editing-availability' : ''}`}>
              <div className="branch-schedule__student-person"><span><UsersRound size={17} /></span><div><strong>{student.name || 'Chưa cập nhật tên'}</strong><small>{student.phone || 'Chưa cập nhật SĐT'}</small><em className={student.eligibleForWeek !== true || missing > 0 ? 'is-warning' : 'is-ok'}>{statusText}</em></div></div>
              <div className="branch-schedule__student-contract"><small>Gói &amp; PT</small><strong>{contract?.packageName || 'Cần đối soát hợp đồng'}</strong><span>{trainerNames || 'Chưa phân PT · sẽ xếp theo hạng PT'} · {contract ? `${contractQuota(contract).schedulable} xếp thêm · ${contractQuota(contract).held} đã giữ chỗ` : 'chưa có gói phù hợp'}</span>{(diagnosis?.diagnostics?.contractStatus || student.contractStatus) && <em className={`schedule-contract-status is-${diagnosis?.diagnostics?.contractStatus || student.contractStatus}`}>{contractStatusLabel(diagnosis?.diagnostics?.contractStatus || student.contractStatus)}{(diagnosis?.diagnostics?.latestContractEndDate || student.contractEndDate) ? ` · đến ${formatDiagnosticDate(diagnosis?.diagnostics?.latestContractEndDate || student.contractEndDate)}` : ''}</em>}</div>
              <div className="branch-schedule__weekly-target"><small>Mục tiêu tuần</small><div><button type="button" aria-label={`Giảm mục tiêu tuần của ${student.name}`} disabled={busy || student.sessionsPerWeek <= scheduled} onClick={() => void setWeeklyTarget(student.id, student.sessionsPerWeek - 1)}><Minus /></button><strong>{student.sessionsPerWeek}</strong><button type="button" aria-label={`Tăng mục tiêu tuần của ${student.name}`} disabled={busy || student.sessionsPerWeek >= student.maxWeeklySessions} onClick={() => void setWeeklyTarget(student.id, student.sessionsPerWeek + 1)}><Plus /></button>{student.weeklySessionTargetOverridden && <button type="button" className="is-reset" title={`Về ${student.defaultSessionsPerWeek} buổi`} aria-label={`Khôi phục mục tiêu của ${student.name} về ${student.defaultSessionsPerWeek} buổi`} disabled={busy || Math.min(student.defaultSessionsPerWeek, student.maxWeeklySessions) < scheduled} onClick={() => void setWeeklyTarget(student.id, null)}><RotateCcw /></button>}</div>{student.weeklySessionTargetOverridden && <span>Tạm thời</span>}</div>
              <div className="branch-schedule__student-progress"><strong>{scheduled}/{student.sessionsPerWeek}</strong><span>{missing > 0 ? `Thiếu ${missing}` : 'Đã đủ'}{feasibility && feasibility.maximumFeasibleSessions < student.sessionsPerWeek ? ` · Tối đa có thể xếp ${feasibility.maximumFeasibleSessions}` : ''}</span><i><b style={{ width: `${Math.min(100, student.sessionsPerWeek ? scheduled / student.sessionsPerWeek * 100 : 100)}%` }} /></i></div>
              <div className="branch-schedule__student-schedule"><small>Lịch được xếp · {availabilityOriginLabel(student)}</small><div>{scheduledEntries.length ? scheduledEntries.map((entry) => <span key={`${entry.slotId}-${entry.trainerId}`} className={entry.trainerAssignmentWarning ? 'has-assignment-warning' : ''}>{entry.label}<b>{workspace.trainers.find((trainer) => trainer.id === entry.trainerId)?.name || 'PT chưa cập nhật'}{entry.trainerAssignmentWarning && <AlertTriangle size={12} aria-label="PT hỗ trợ" />}</b></span>) : <em>Chưa có buổi nào trong tuần</em>}</div></div>
              <div className="branch-schedule__student-availability-action"><button type="button" className={`is-${student.availabilityStatus}`} aria-expanded={availabilityEditorStudentId === student.id} onClick={() => openAvailabilityEditor(student)}><CalendarRange size={16} />{student.availabilityStatus === 'locked' ? 'Lịch rảnh đã khóa' : CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus) ? 'Xem / điều chỉnh lịch rảnh' : 'Thêm lịch rảnh'}</button><span>{student.availableSlots.length} khung · {student.availabilityStatus === 'inherited' ? `nguồn ${student.availabilitySourceWeekId || 'gần nhất'}` : `r${student.availabilityRevision}`}</span></div>
              {availabilityEditorStudentId === student.id && <section className="branch-schedule__availability-editor">
                <header><div><small>LỊCH RẢNH TUẦN {currentWeekId}</small><strong>{student.name}</strong></div><span>{availabilityDraft.size} khung đã chọn</span></header>
                <AvailabilityMatrix days={workingDays} hours={workingHours} selected={availabilityDraft} onChange={setAvailabilityDraft} disabled={availabilityBusy} ariaLabel={`Lịch rảnh của ${student.name}`} />
                {availabilityError && <p role="alert">{availabilityError}</p>}
                <footer><button type="button" onClick={() => setAvailabilityEditorStudentId(null)}>Đóng</button><button type="button" className="is-save" disabled={availabilityBusy} onClick={() => void saveStudentAvailability(student)}><Save size={16} />{availabilityBusy ? 'Đang lưu' : 'Lưu lịch rảnh'}</button></footer>
              </section>}
              </article>
            })}
            {!studentRows.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có học viên phù hợp bộ lọc.</div>}
          </div>
        </main>
      )}

      {workspace && tab === 'warnings' && (
        <main id="schedule-panel-warnings" role="tabpanel" aria-labelledby="schedule-tab-warnings" className="branch-schedule__warning-page">
          <header><p>CẦN XỬ LÝ</p><h2>Cảnh báo xếp lịch</h2><span>Chạm vào từng mục để xem đủ nguyên nhân và phương án xử lý.</span></header>
          <section className="schedule-warning-summary" aria-label="Tóm tắt cảnh báo">
            <article><strong>{warningProfiles.length}</strong><span>Học viên cần xử lý</span></article>
            <article><strong>{warningProfiles.reduce((total, profile) => total + profile.missingSessions, 0)}</strong><span>Buổi còn thiếu</span></article>
            <article><strong>{warningCategoryCounts.contract}</strong><span>Hợp đồng / quota</span></article>
            <article><strong>{warningCategoryCounts.availability}</strong><span>Thiếu lịch rảnh</span></article>
            <article><strong>{warningCategoryCounts.trainer}</strong><span>Thiếu PT / công suất</span></article>
            <article><strong>{singleSlotWarnings.length}</strong><span>Ca 1/2 có thể ghép</span></article>
          </section>
          {singleSlotWarnings.length > 0 && <section className="schedule-pairing-opportunities" aria-label="Ca một học viên còn có thể ghép">
            <header><div><strong>Ca 1/2 cần ưu tiên ghép</strong><span>Chạm vào ca để mở đúng ô lịch và bổ sung học viên phù hợp.</span></div><b>{slotUtilization.seatUtilizationPercent}% sử dụng ghế</b></header>
            <div>{singleSlotWarnings.map((row) => {
              const [day, hour] = row.slotId.split('-')
              return <button type="button" key={`${row.trainerId}-${row.slotId}`} onClick={() => { setSelectedTrainerId(row.trainerId); setInspectorSlotId(row.slotId); setCandidateSearch(''); setTab('matrix') }}>
                <span><strong>{DAY_LABELS[day] || day} · {String(hour).padStart(2, '0')}:00</strong><small>{row.trainerName}</small></span><em>{row.studentName}</em><ChevronRight size={16} />
              </button>
            })}</div>
          </section>}
          {trainerAssignmentWarnings.length > 0 && <section className="schedule-assignment-warnings" aria-label="Ca dùng PT hỗ trợ ngoài danh sách chính phụ">
            <header><div><strong>PT hỗ trợ ngoài danh sách chính/phụ</strong><span>Ca vẫn hợp lệ trong cùng chi nhánh; cảnh báo giúp quản lý và học viên nhận biết người dạy thay.</span></div><b>{trainerAssignmentWarnings.length} ca</b></header>
            <div>{trainerAssignmentWarnings.map((row) => <button type="button" key={row.key} onClick={() => { setSelectedTrainerId(row.trainerId); setInspectorSlotId(row.slotId); setCandidateSearch(''); setTab('matrix') }}><AlertTriangle size={16} /><span><strong>{row.studentName}</strong><small>{scheduleSlotLabel(row.slotId, weekDates)} · {row.trainerName}</small></span><ChevronRight size={16} /></button>)}</div>
          </section>}
          <section className="schedule-warning-grid">
            {workspace.trainers.filter((trainer) => trainer.availabilityMode === 'unconfigured').map((trainer) => <article key={trainer.id} className="schedule-warning-trainer is-blocking"><Clock3 /><div><strong>{trainer.name}</strong><span>{trainerEmploymentLabel(trainer.employmentType)} · chưa đăng ký lịch nhận ca nên không được xếp tự động.</span><small>Hạng #{trainer.schedulingPriority || 100} · mốc cân tải {trainer.dailySessionTarget || 8} ca/ngày</small></div></article>)}
            {warningProfiles.map(({ student, missingSessions: missing, trainerNames, contract, scheduledEntries, reasonCodes, primaryReasonCode, actionCode, diagnostics, candidateSlots, suggestedSlots, hasConfirmedAvailability, offState }) => {
              const expanded = expandedWarningStudentId === student.id
              const quota = contractQuota(contract)
              const topCandidates = (candidateSlots || []).filter((slot) => slot.availableTrainerIds?.length || slot.blockerCodes?.length).slice(0, 6)
              const openDiagnosticSlot = (slot: NonNullable<typeof candidateSlots>[number]) => {
                const trainerId = slot.availableTrainerIds?.[0] || slot.blockedTrainerIds?.[0]
                if (!trainerId) return
                setSelectedTrainerId(trainerId)
                setInspectorSlotId(slot.slotId)
                setCandidateSearch('')
                setPendingManualCandidate(null)
                setTab('matrix')
              }
              return <article key={student.id} className={`schedule-warning-student${student.eligibleForWeek ? '' : ' is-blocking'}${expanded ? ' is-expanded' : ''}`}>
                <button type="button" onClick={() => setExpandedWarningStudentId(expanded ? null : student.id)} aria-expanded={expanded}>
                  <AlertTriangle /><div><span className="schedule-warning-student__title"><strong>{student.name}</strong>{missing > 0 && <b>Thiếu {missing} buổi</b>}</span><span>{student.phone || 'Chưa cập nhật SĐT'} · <i className={hasConfirmedAvailability ? 'has-availability' : 'no-availability'}>{hasConfirmedAvailability ? `${student.availableSlots.length} khung lịch rảnh` : 'Chưa có lịch rảnh'}</i>{offState === 'trainer' ? ' · PT xin OFF, đang chờ xếp lại' : offState === 'student' ? ' · Học viên đang OFF/bảo lưu' : ''}</span><em className="schedule-warning-primary">{diagnosticReasonLabel(primaryReasonCode)}</em></div><ChevronRight />
                </button>
                {expanded && <div className="schedule-warning-detail">
                  <section><small>Gói tập · {contractStatusLabel(diagnostics?.contractStatus || student.contractStatus)}</small><strong>{contract?.packageName || 'Chưa có hợp đồng phù hợp'}</strong><em>{contract ? `${quota.entitlement} quyền lợi · ${quota.held} đã giữ chỗ · ${quota.schedulable} xếp thêm · ${String(contract.startDate || '').slice(0, 10)} → ${String(contract.endDate || '').slice(0, 10)}` : 'Cần đối soát hợp đồng'}{(diagnostics?.latestContractEndDate || student.contractEndDate) ? ` · hết hạn ${formatDiagnosticDate(diagnostics?.latestContractEndDate || student.contractEndDate)}` : ''}</em></section>
                  <section><small>PT phụ trách</small><strong>{trainerNames || 'Chưa phân PT'}</strong><em>{trainerNames ? 'Theo hợp đồng và lịch hiện tại' : 'Sẽ xếp theo hạng PT'}</em></section>
                  <section className="is-wide schedule-warning-cause"><small>Nguyên nhân chính · {diagnosticActionLabel(actionCode)}</small><strong>{diagnosticReasonLabel(primaryReasonCode)}</strong><div>{reasonCodes.length ? reasonCodes.map((code) => <span key={code}>{ptScheduleConflictLabel(code)}</span>) : <em>Chưa tìm được phương án tối ưu</em>}</div></section>
                  {diagnostics && <section className="is-wide schedule-warning-diagnostics"><small>Đối soát khả năng xếp trong tuần</small><div className="schedule-diagnostic-grid"><span><b>{diagnostics.candidateSlotCount || 0}</b><small>ca đã đăng ký</small></span><span><b>{diagnostics.contractValidDateCount || 0}</b><small>ca đúng ngày HĐ</small></span><span><b>{diagnostics.trainerCompatibleSlotCount || 0}</b><small>ca có PT phù hợp</small></span><span><b>{diagnostics.pairedSeatOpportunityCount || 0}</b><small>ghế đôi còn trống</small></span></div><p>{diagnostics.blockedByTrainerOffCount ? `OFF/nghỉ: ${diagnostics.blockedByTrainerOffCount} PT · ` : ''}{diagnostics.blockedByTrainerCapacityCount ? `PT đầy: ${diagnostics.blockedByTrainerCapacityCount} · ` : ''}{diagnostics.blockedByBranchCapacityCount ? `chi nhánh đầy: ${diagnostics.blockedByBranchCapacityCount}` : 'Không có thêm rào cản công suất đã ghi nhận.'}</p></section>}
                  <section className={`is-wide${hasConfirmedAvailability ? '' : ' is-missing-availability'}`}><small>{hasConfirmedAvailability ? `${availabilityOriginLabel(student)} · ${student.availableSlots.length} khung` : 'Chưa có lịch rảnh'}</small><div>{hasConfirmedAvailability ? student.availableSlots.map((slot) => <span key={slot}>{availabilitySlotLabel(slot)}</span>) : <em>Không có lịch đúng tuần, lịch đã gửi trước đó hoặc lịch mặc định cũ đã xác nhận.</em>}</div></section>
                  <section className="is-wide"><small>Lịch đã xếp</small><div>{scheduledEntries.length ? scheduledEntries.map((entry) => <span key={`${entry.slotId}-${entry.trainerId}`} className={entry.trainerAssignmentWarning ? 'has-assignment-warning' : ''}>{entry.label}<b>{workspace.trainers.find((trainer) => trainer.id === entry.trainerId)?.name || 'PT chưa cập nhật'}{entry.trainerAssignmentWarning && <AlertTriangle size={12} aria-label="PT hỗ trợ" />}</b></span>) : <em>Chưa có buổi nào trong tuần</em>}</div></section>
                  <section className="is-wide is-suggestion"><small>Ca hệ thống còn đề xuất / cần mở</small><div>{topCandidates.length ? topCandidates.map((slot) => {
                    const trainerNamesForSlot = slot.availableTrainerIds?.map((trainerId) => workspace.trainers.find((trainer) => trainer.id === trainerId)?.name).filter(Boolean).join(', ')
                    return <button type="button" key={slot.slotId} onClick={() => openDiagnosticSlot(slot)}><span>{scheduleSlotLabel(slot.slotId, weekDates)}</span><b>{trainerNamesForSlot || slot.blockerCodes?.slice(0, 1).map(diagnosticReasonLabel).join('')}</b><ChevronRight size={13} /></button>
                  }) : suggestedSlots.length ? suggestedSlots.map((slot) => <span key={slot}>{scheduleSlotLabel(slot, weekDates)}</span>) : <em>Không còn ca chung hợp lệ; cần bổ sung lịch rảnh hoặc PT.</em>}</div></section>
                </div>}
              </article>
            })}
            {!warningProfiles.length && workspace.summary.unconfiguredTrainers === 0 && <div className="schedule-warning-empty"><CheckCircle2 /> Không còn cảnh báo dữ liệu đầu vào.</div>}
          </section>
        </main>
      )}

      {workspace && tab === 'history' && (
        <main className="branch-schedule__history-page">
          <header><p>LỚP AN TOÀN</p><h2>Lịch sử đã publish</h2><span>Chỉ dùng khi cần xem lại hoặc khôi phục một lịch cũ. Hệ thống luôn tạo draft mới và không sửa buổi đã tính.</span><button type="button" onClick={() => setTab('matrix')}><ChevronLeft size={16} /> Quay lại lịch PT</button></header>
          {busy && !history ? <div className="branch-schedule__loading"><RefreshCw className="is-spinning" /> Đang tải lịch sử…</div> : null}
          <section className="schedule-version-list">{history?.versions.map((version) => <article key={version.version} className={version.version === history.currentVersion ? 'is-current' : ''}><div><strong>Phiên bản v{version.version}</strong><span>{version.entryCount} buổi · draft r{version.sourceDraftRevision}</span><small>{formatPublishedAt(version.publishedAt)}</small></div><button type="button" onClick={() => setRestoreCandidate(version)}><History size={15} /> Tạo draft</button></article>)}</section>
          {history && !history.versions.length && <div className="schedule-warning-empty">Chưa có phiên bản đã publish.</div>}
        </main>
      )}

      {workspace && inspectorSlotId && selectedTrainer && (
        <div className="schedule-inspector-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setInspectorSlotId(null); setPendingManualCandidate(null) } }}>
          <aside ref={activeDialogRef} className="schedule-inspector" role="dialog" aria-modal="true" aria-label="Chỉnh ô lịch">
            <header><div><p>{DAY_LABELS[inspectorSlotId.split('-')[0]]} · {String(inspectorSlotId.split('-')[1]).padStart(2, '0')}:00</p><h2>{selectedTrainer.name}</h2><span>Sức chứa {inspectorEntries.filter((entry) => entry.type !== 'off').length}/{selectedTrainer.slotCapacity}</span></div><button type="button" aria-label="Đóng" onClick={() => { setInspectorSlotId(null); setPendingManualCandidate(null) }}><X /></button></header>
            <div className="schedule-inspector__body">
              <section><div className="schedule-inspector__section-title"><strong>Trong ca</strong><span>{inspectorEntries.some((entry) => entry.type === 'off') ? 'PT nghỉ' : `${inspectorEntries.filter((entry) => entry.type !== 'off').length} học viên`}</span></div>
                {inspectorEntries.filter((entry) => entry.type !== 'off').map((entry) => {
                  const assignmentWarning = trainerAssignmentWarningKeys.has(`${inspectorSlotId}|${entry.studentId}|${entry.trainerId}`)
                  return <article className={`schedule-assigned-row${assignmentWarning ? ' has-assignment-warning' : ''}`} key={entry.studentId}><div><strong>{studentName(entry.studentId)}{assignmentWarning && <AlertTriangle size={14} aria-label="PT hỗ trợ" />}</strong><span>{assignmentWarning ? 'PT hỗ trợ ngoài danh sách PT chính/phụ' : entry.isLocked ? 'Đã khóa khỏi auto-arrange' : 'Có thể xếp lại'}</span></div><div><button type="button" title={entry.isLocked ? 'Mở khóa' : 'Khóa'} disabled={busy} onClick={() => void runCommand(entry.isLocked ? 'unlock_entry' : 'lock_entry', { slotId: inspectorSlotId, trainerId: selectedTrainerId, studentId: entry.studentId })}>{entry.isLocked ? <Unlock /> : <Lock />}</button><button type="button" className="is-remove" disabled={busy} onClick={() => void runCommand('remove_student', { slotId: inspectorSlotId, trainerId: selectedTrainerId, studentId: entry.studentId })}><X /></button></div></article>
                })}
                {!inspectorEntries.filter((entry) => entry.type !== 'off').length && !inspectorEntries.some((entry) => entry.type === 'off') && <div className="schedule-inspector__empty">Ca đang trống.</div>}
                {inspectorEntries.some((entry) => entry.type === 'off') ? <button className="schedule-off-action" type="button" disabled={busy} onClick={() => void runCommand('clear_trainer_off', { slotId: inspectorSlotId, trainerId: selectedTrainerId }, 'Mở lại ca PT')}>Mở lại ca</button> : !offConfirmation ? <button className="schedule-off-action" type="button" onClick={() => setOffConfirmation(true)}><CalendarOff /> Đánh dấu PT nghỉ</button> : <div className="schedule-off-confirm"><strong>Đưa {inspectorEntries.filter((entry) => entry.type !== 'off').length} học viên về danh sách chưa xếp?</strong><p>Lịch sử thay đổi và lý do sẽ được lưu audit.</p><div><button type="button" onClick={() => setOffConfirmation(false)}>Quay lại</button><button type="button" disabled={busy} onClick={() => void runCommand('set_trainer_off', { slotId: inspectorSlotId, trainerId: selectedTrainerId, disposition: 'requeue' }, 'PT nghỉ, đưa học viên về hàng chờ')}>Xác nhận PT nghỉ</button></div></div>}
              </section>

              {!inspectorEntries.some((entry) => entry.type === 'off') && <section>
                <div className="schedule-inspector__section-title"><strong>Thêm học viên</strong><span>Rảnh đúng ca được ưu tiên</span></div>
                <label className="schedule-candidate-search"><Search /><input value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Tên hoặc số điện thoại" /></label>
                {candidateLoading && <div className="schedule-candidate-sync"><RefreshCw className="is-spinning" /> Aura đang đối chiếu điều kiện trên máy chủ…</div>}
                {pendingManualCandidate && !candidateMatchesStudentAvailability(pendingManualCandidate) && <div className="schedule-manual-override-confirm"><AlertTriangle /><div><strong>{pendingManualCandidate.name} nằm ngoài lịch rảnh</strong><p>{ptScheduleConflictLabel(pendingManualCandidate.availabilityReason || pendingManualCandidate.reasons[0])} Chỉ ghi lịch sau khi bạn bấm xác nhận; thao tác ngoại lệ được lưu audit.</p></div></div>}
                {pendingManualCandidate?.trainerAssignmentWarning && <div className="schedule-assignment-confirm"><AlertTriangle /><div><strong>{selectedTrainer.name} là PT hỗ trợ</strong><p>Học viên có PT chính/phụ khác. Ca vẫn được phép xếp vì cùng chi nhánh và sẽ hiển thị cảnh báo trên lịch.</p></div></div>}
                {pendingManualCandidate?.studentBranchWarning && <div className="schedule-branch-confirm"><AlertTriangle /><div><strong>Xác nhận tập khác cơ sở</strong><p>{pendingManualCandidate.name} thuộc {branches.find((item) => item.id === pendingManualCandidate.studentHomeBranchId)?.name || 'cơ sở khác'} và sẽ tập tại {branches.find((item) => item.id === branchId)?.name || 'cơ sở đang xếp'}. Ca được chấp nhận sau nút xác nhận và được lưu audit.</p></div></div>}
                <div className="schedule-candidate-list">{candidateGroups.map((group) => group.items.length > 0 && <section className={`schedule-candidate-group is-${group.key}`} key={group.key}>
                  <header><strong>{group.label}</strong><span>{group.items.length} · {group.hint}</span></header>
                  {group.items.map((candidate) => {
                    const manualSelectable = candidateCanBeManuallyScheduled(candidate)
                    const outsideAvailability = !candidateMatchesStudentAvailability(candidate)
                    const selected = pendingManualCandidate?.studentId === candidate.studentId
                    const assignmentNote = candidate.trainerAssignmentWarning ? ' · PT hỗ trợ ngoài danh sách chính/phụ' : ''
                    const branchNote = candidate.studentBranchWarning
                      ? ` · Khác cơ sở (${branches.find((item) => item.id === candidate.studentHomeBranchId)?.name || 'hồ sơ khác'})`
                      : ''
                    return <article key={candidate.studentId} className={`${candidate.eligible ? 'is-eligible' : manualSelectable ? 'is-override' : 'is-disabled'}${candidate.trainerAssignmentWarning ? ' has-assignment-warning' : ''}${candidate.studentBranchWarning ? ' has-branch-warning' : ''}${selected ? ' is-selected' : ''}`}><div><strong>{candidate.name}{(candidate.trainerAssignmentWarning || candidate.studentBranchWarning) && <AlertTriangle size={13} aria-label="Ca cần xác nhận" />}</strong><span>{candidate.eligible ? `Đã đăng ký rảnh đúng ca này${assignmentNote}${branchNote}` : manualSelectable && outsideAvailability ? `${ptScheduleConflictLabel(candidate.availabilityReason || candidate.reasons[0])} · Có thể xếp tay${assignmentNote}${branchNote}` : `${candidate.reasons.map(ptScheduleConflictLabel).join(' · ')}${branchNote}`}</span></div><button type="button" aria-label={selected ? `Bỏ chọn ${candidate.name}` : `Chọn ${candidate.name}`} aria-pressed={selected} disabled={!manualSelectable || busy || inspectorEntries.filter((entry) => entry.type !== 'off').length >= selectedTrainer.slotCapacity} onClick={() => setPendingManualCandidate((current) => current?.studentId === candidate.studentId ? null : candidate)}>{selected ? <CheckCircle2 /> : <UserPlus />}</button></article>
                  })}
                </section>)}</div>
                <footer className="schedule-manual-confirm"><div>{pendingManualCandidate ? <><span>Đang chọn</span><strong>{pendingManualCandidate.name}</strong></> : <><span>Chưa chọn học viên</span><strong>Chọn một hồ sơ ở trên</strong></>}</div><button type="button" onClick={() => setPendingManualCandidate(null)} disabled={!pendingManualCandidate || busy}>Hủy</button><button type="button" className="is-confirm" disabled={!pendingManualCandidate || busy} onClick={() => void confirmManualCandidate()}>{busy ? 'Đang xác nhận…' : 'Xác nhận xếp ca'}</button></footer>
              </section>}
            </div>
          </aside>
        </div>
      )}

      {publishPreview && <div className="schedule-publish-backdrop"><section ref={activeDialogRef} className="schedule-publish-dialog" role="dialog" aria-modal="true" aria-labelledby="branch-publish-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">AURA PT · XÁC NHẬN</p><h2 id="branch-publish-title">Publish v{publishPreview.version}?</h2><p>Session đã tính buổi hoặc xác nhận được khóa bất biến. Toàn bộ diff còn lại chạy trong một transaction.</p><div className="schedule-publish-diff"><div><strong>{publishPreview.diff.create}</strong><span>Tạo mới</span></div><div><strong>{publishPreview.diff.update}</strong><span>Điều chỉnh</span></div><div><strong>{publishPreview.diff.cancel}</strong><span>Hủy</span></div><div><strong>{publishPreview.diff.unchanged}</strong><span>Giữ nguyên</span></div></div>{publishPreview.warnings.length > 0 && <div className="schedule-publish-warnings"><AlertTriangle size={17} /><div><strong>{publishPreview.warnings.length} lưu ý không chặn publish</strong><span>{publishPreview.warnings.map(ptScheduleConflictLabel).join(' · ')}</span></div></div>}<div className="schedule-publish-dialog__actions"><button type="button" onClick={() => setPublishPreview(null)}>Quay lại</button><button type="button" onClick={() => void confirmPublish()} disabled={busy}>{busy ? 'Đang publish…' : `Publish v${publishPreview.version}`}</button></div></section></div>}

      {resetDraftOpen && <div className="schedule-publish-backdrop"><section ref={activeDialogRef} className="schedule-publish-dialog" role="alertdialog" aria-modal="true" aria-labelledby="branch-reset-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">AURA PT · ĐẶT LẠI DRAFT</p><h2 id="branch-reset-title">Xếp lại từ đầu tuần này?</h2><p>Gỡ {draftResetSummary.resettableEntries} buổi nháp của {draftResetSummary.affectedStudents} học viên. {draftResetSummary.protectedEntries} ca OFF, ca khóa hoặc session đã publish vẫn được giữ nguyên.</p><div className="schedule-publish-dialog__actions"><button type="button" onClick={() => setResetDraftOpen(false)}>Quay lại</button><button type="button" onClick={() => void resetDraft()} disabled={busy}>{busy ? 'Đang đặt lại…' : 'Đặt lại draft'}</button></div></section></div>}

      {restoreCandidate && history && <div className="schedule-publish-backdrop"><section ref={activeDialogRef} className="schedule-publish-dialog" role="alertdialog" aria-modal="true" aria-labelledby="branch-restore-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">KHÔI PHỤC AN TOÀN</p><h2 id="branch-restore-title">Tạo draft từ v{restoreCandidate.version}?</h2><p>Phiên bản đã publish vẫn bất biến. Lịch được sao chép thành draft revision mới để kiểm tra lại.</p><div className="schedule-publish-dialog__actions"><button type="button" onClick={() => setRestoreCandidate(null)}>Quay lại</button><button type="button" onClick={() => void restoreVersion()} disabled={busy}>Tạo draft mới</button></div></section></div>}
    </div>
  )
}
