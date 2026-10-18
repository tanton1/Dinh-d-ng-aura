import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import OperationsRequestCenter from '../admin/pt/OperationsRequestCenter'
import type { AccessContext } from '../../identity/access'
import { firestoreDb } from '../../lib/firebaseFirestore'
import { trackProductEvent } from '../../services/analyticsService'
import { getDatesForWeek } from '../../utils/dateUtils'
import {
  applyPtScheduleDraftCommand,
  applyAdminPtScheduleEdit,
  asPtSchedulePublishError,
  createHistoricalPtSession,
  generatePtScheduleDraft,
  getPtScheduleSlotCandidates,
  getPtScheduleWorkspace,
  listPtScheduleVersions,
  ptScheduleConflictLabel,
  publishPtSchedule,
  reopenPtStudentAvailability,
  restorePtScheduleVersionToDraft,
  savePtStudentAvailability,
  setPtStudentWeeklyTarget,
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
import { trainerDailyLoadTarget } from '../../config/scheduleLoadPolicy'
import { useScheduleOpportunities } from '../../features/schedule/useScheduleOpportunities'
import { measureScheduleTask } from '../../features/schedule/performance'
import { hasActionableSearchLimit } from '../../features/schedule/searchLimit'
import { loadWorkspaceRequest } from '../../features/schedule/workspaceCache'

interface Props {
  accessContext: AccessContext
  onNavigate?: (view: 'admin-pt-students' | 'admin-training-history') => void
  initialTab?: WorkspaceTab
}

import {
  APP_UPDATE_READY_EVENT,
  APP_UPDATE_READY_KEY,
  CONFIRMED_AVAILABILITY_STATUSES,
  CONTRACT_WARNING_REASONS,
  DAY_LABELS,
  LEARNER_WARNING_REASONS,
  MIN_WEEK_OFFSET,
  TRAINER_LOAD_LABELS,
  WORKSPACE_CACHE_REVALIDATE_MS,
  availabilityDayCount,
  availabilitySlotLabel,
  candidateCanBeManuallyScheduled,
  candidateMatchesStudentAvailability,
  commandKey,
  compareScheduleSlots,
  currentVietnamDateKey,
  diagnosticActionLabel,
  diagnosticReasonLabel,
  finiteCount,
  formatPublishedAt,
  getCachedBranchCatalog,
  localSlotCandidates,
  normalizedTrainerLoadStatus,
  readWorkspaceCache,
  scheduleSlotIsPast,
  scheduleSlotLabel,
  trainerEmploymentLabel,
  warningCauseFor,
  warningCauseLabel,
  warningReasonPriority,
  workspaceFromDraftSnapshot,
  workspaceRealtimeFingerprint,
  writeWorkspaceCache,
  isTrainerLocked,
  type StudentFilter,
  type WarningCause,
  type WarningFilter,
  type WorkspaceSyncState,
  type WorkspaceTab,
} from '../../features/schedule/workspaceModel'

function normalizeScheduleSearchText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi-VN')
    .trim()
}

// Keep only conflicts that change the operational meaning of a matrix cell.
// PT assignment exceptions and Admin overrides remain available in the slot
// inspector/audit, but should not compete with cross-branch or schedule-risk
// signals in the weekly grid.
const MATRIX_IMPORTANT_WARNING_CODES = new Set([
  'STUDENT_BRANCH_MISMATCH',
  'TRAINER_BRANCH_MISMATCH',
  'DUPLICATE_SCHEDULE_ENTRY',
  'DUPLICATE_DEPLOYED_SESSION',
  'STUDENT_MULTIPLE_SESSIONS_PER_DAY',
  'TRAINER_OFF_CONFLICT',
  'TRAINER_CAPACITY_EXCEEDED',
  'CONTRACT_SESSION_QUOTA_EXCEEDED',
])

export default function BranchScheduleWorkspace({ accessContext, onNavigate, initialTab }: Props) {
  const [branches, setBranches] = useState<PtScheduleBranchOption[]>([])
  const [branchId, setBranchId] = useState(accessContext.branchIds[0] || '')
  const [branchCatalogState, setBranchCatalogState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [branchCatalogError, setBranchCatalogError] = useState<string | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [workspace, setWorkspace] = useState<PtScheduleWorkspaceV2Result | null>(null)
  const [selectedTrainerId, setSelectedTrainerId] = useState('')
  const [tab, setTab] = useState<WorkspaceTab>(initialTab || 'matrix')
  const [opportunityStudentId, setOpportunityStudentId] = useState('')
  const [mobilePage, setMobilePage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publishIssues, setPublishIssues] = useState<Array<{ code: string; slotId?: string; studentId?: string; studentName?: string; trainerId?: string; trainerName?: string }>>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [publishPreview, setPublishPreview] = useState<PtSchedulePublishResult | null>(null)
  const [publishCrossBranchConfirmed, setPublishCrossBranchConfirmed] = useState(false)
  const [noticeAction, setNoticeAction] = useState<'publish' | null>(null)
  const [history, setHistory] = useState<PtScheduleVersionListResult | null>(null)
  const [restoreCandidate, setRestoreCandidate] = useState<PtScheduleVersionSummary | null>(null)
  const [inspectorSlotId, setInspectorSlotId] = useState<string | null>(null)
  const [candidateSearch, setCandidateSearch] = useState('')
  const [candidates, setCandidates] = useState<PtScheduleSlotCandidate[]>([])
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [pendingManualCandidate, setPendingManualCandidate] = useState<PtScheduleSlotCandidate | null>(null)
  const [historicalReason, setHistoricalReason] = useState('')
  const [pendingMove, setPendingMove] = useState<{ studentId: string; fromSlotId: string; fromTrainerId: string; slotId: string; trainerId: string } | null>(null)
  const [pendingAdminRemoval, setPendingAdminRemoval] = useState<{ studentId: string; slotId: string; trainerId: string } | null>(null)
  const [adminEditReason, setAdminEditReason] = useState('')
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
  const [warningFilter, setWarningFilter] = useState<WarningFilter>('priority')
  const [availabilityEditorStudentId, setAvailabilityEditorStudentId] = useState<string | null>(null)
  const [availabilityDraft, setAvailabilityDraft] = useState<Set<string>>(new Set())
  const [availabilityBusy, setAvailabilityBusy] = useState(false)
  const [availabilityError, setAvailabilityError] = useState('')
  const [resetDraftOpen, setResetDraftOpen] = useState(false)
  const [optimizationStatus, setOptimizationStatus] = useState<string | null>(null)
  const candidateCache = useRef(new Map<string, PtScheduleSlotCandidate[]>())
  const workspaceRef = useRef<PtScheduleWorkspaceV2Result | null>(null)
  const availabilitySyncRevisionRef = useRef('')
  const busyRef = useRef(false)
  const hoverClearTimer = useRef<number | null>(null)
  const workspaceRequestRef = useRef<{ scope: string; forceAvailabilityRefresh: boolean; promise: Promise<void> } | null>(null)
  const activeWorkspaceScopeRef = useRef('')
  const moreMenuRef = useRef<HTMLDetailsElement | null>(null)
  const activeDialogRef = useRef<HTMLElement | null>(null)
  const workspaceReadyTimingRef = useRef({
    scope: '',
    startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    reported: false,
    source: 'network' as 'cache' | 'network',
  })
  const [vietnamDateKey, setVietnamDateKey] = useState(() => currentVietnamDateKey(true))

  const weekDates = useMemo(() => getDatesForWeek(weekOffset), [weekOffset])
  const currentWeekId = weekDates.T2.full
  const accessBranchIdsKey = accessContext.branchIds.join(',')
  const scopedBranchIds = useMemo(() => accessBranchIdsKey.split(',').filter(Boolean), [accessBranchIdsKey])
  const canListenToDraft = ['admin', 'super_admin'].includes(accessContext.accessRole)
    || (accessContext.accessRole === 'staff' && accessContext.positions.includes('branch_manager'))
  const isAdmin = accessContext.accessRole === 'admin' || accessContext.accessRole === 'super_admin'
  const canManageOperations = accessContext.capabilities.includes('pt.operations.manage')
  const ownerScope = `${accessContext.uid}|${accessContext.authzVersion}|${accessContext.accessRole}|${accessBranchIdsKey}`
  const workspaceScope = `${ownerScope}|${branchId}|${currentWeekId}`
  if (workspaceReadyTimingRef.current.scope !== workspaceScope) {
    workspaceReadyTimingRef.current = {
      scope: workspaceScope,
      startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      reported: false,
      source: 'network',
    }
  }
  activeWorkspaceScopeRef.current = workspaceScope
  const workingDays = workspace?.scheduleConfig.workingDays?.length
    ? workspace.scheduleConfig.workingDays
    : ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
  const workingHours = workspace?.scheduleConfig.workingHours?.length
    ? workspace.scheduleConfig.workingHours
    : Array.from({ length: 16 }, (_, index) => index + 6)
  // Keep locked/inactive PT projections in the workspace so old schedule
  // entries can still resolve their names, but never offer them for new work.
  const visibleTrainers = useMemo(
    () => workspace?.trainers.filter((trainer) => !isTrainerLocked(trainer)) || [],
    [workspace?.trainers],
  )
  const workspaceHydrating = workspace?.partial === true
  const holidayDates = useMemo(
    () => new Set((workspace?.scheduleConfig.holidays || []).map((value) => String(value).slice(0, 10))),
    [workspace?.scheduleConfig.holidays],
  )
  const mobileGroups = useMemo(() => {
    const result: string[][] = []
    for (let index = 0; index < workingDays.length; index += 2) result.push(workingDays.slice(index, index + 2))
    return result
  }, [workingDays])
  const pastScheduleSlots = useMemo(() => {
    const result = new Set<string>()
    for (const day of workingDays) {
      for (const hour of workingHours) {
        const slotId = `${day}-${hour}`
        if (scheduleSlotIsPast(slotId, weekDates, vietnamDateKey)) result.add(slotId)
      }
    }
    return result
  }, [vietnamDateKey, weekDates, workingDays, workingHours])

  // The historical-slot boundary is a calendar date, not a Firestore change.
  // Refresh it while the page is open and immediately when a background tab
  // becomes visible, so the matrix/inspector switches to the audit flow after
  // midnight without requiring navigation or a full workspace reload.
  useEffect(() => {
    const refreshVietnamDate = () => {
      const next = currentVietnamDateKey(true)
      setVietnamDateKey((current) => current === next ? current : next)
    }
    const interval = window.setInterval(refreshVietnamDate, 30_000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshVietnamDate()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!initialTab) return
    if (initialTab === 'requests' && !canManageOperations) {
      setTab('matrix')
      return
    }
    setTab(initialTab)
  }, [canManageOperations, initialTab])

  useEffect(() => {
    workspaceRef.current = workspace
    if (workspace && !workspace.partial && workspace.branch.id === branchId && workspace.weekId === currentWeekId) {
      writeWorkspaceCache(workspaceScope, workspace)
    }
  }, [branchId, currentWeekId, workspace, workspaceScope])
  useEffect(() => {
    const timing = workspaceReadyTimingRef.current
    if (!workspace || workspace.partial || loading || timing.reported || timing.scope !== workspaceScope) return
    if (workspace.branch.id !== branchId || workspace.weekId !== currentWeekId) return
    timing.reported = true
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    void trackProductEvent('data_ready', {
      surface: 'schedule_workspace',
      durationMs: Math.max(0, Math.round(now - timing.startedAt)),
      cacheHit: timing.source === 'cache',
      trainerCount: visibleTrainers.length,
      studentCount: workspace.students.length,
      uiVersion: 4,
    })
  }, [branchId, currentWeekId, loading, visibleTrainers.length, workspace, workspaceScope])
  useEffect(() => { busyRef.current = busy }, [busy])
  useEffect(() => { activeWorkspaceScopeRef.current = workspaceScope }, [workspaceScope])
  useEffect(() => () => {
    if (hoverClearTimer.current !== null) window.clearTimeout(hoverClearTimer.current)
  }, [])

  useEffect(() => {
    const hasDialog = Boolean(inspectorSlotId || publishPreview || resetDraftOpen || restoreCandidate)
    if (!hasDialog) return undefined
    const focusTimer = window.setTimeout(() => activeDialogRef.current
      ?.querySelector<HTMLElement>('button, input, select, [tabindex="0"]')
      ?.focus({ preventScroll: true }), 0)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busyRef.current) return
      if (inspectorSlotId) {
        setInspectorSlotId(null)
        setPendingManualCandidate(null)
        setPendingMove(null)
        setPendingAdminRemoval(null)
        setAdminEditReason('')
        setHistoricalReason('')
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

  const loadWorkspace = useCallback(async (quiet = false, forceAvailabilityRefresh = false) => {
    if (!branchId) return
    const requestScope = `${ownerScope}|${branchId}|${currentWeekId}`
    const inFlight = workspaceRequestRef.current
    if (inFlight?.scope === requestScope) {
      await inFlight.promise
      // Do not lose a forced availability refresh that arrived while the
      // ordinary workspace request was still in flight.
      if (forceAvailabilityRefresh && !inFlight.forceAvailabilityRefresh) {
        await loadWorkspace(true, true)
      }
      return
    }
    const request = (async () => {
      if (!quiet) workspaceReadyTimingRef.current.source = 'network'
      if (!quiet) setLoading(true)
      if (!quiet || !workspaceRef.current) setSyncState('connecting')
      if (!quiet) setError(null)
      try {
        const loadFullWorkspace = () => loadWorkspaceRequest(requestScope, () => measureScheduleTask('workspace', () => getPtScheduleWorkspace({
          weekId: currentWeekId,
          branchId,
          forceAvailabilityRefresh,
        })))
        const visibleWorkspace = workspaceRef.current?.branch.id === branchId && workspaceRef.current?.weekId === currentWeekId
        let result: PtScheduleWorkspaceV2Result
        if (!quiet && !visibleWorkspace) {
          // The first response only contains the branch roster, PT roster and
          // draft/current-week rows needed to paint the matrix. Contract,
          // availability and warning evidence follows through the normal
          // cached read below.
          const initial = await measureScheduleTask('workspace', () => getPtScheduleWorkspace({ weekId: currentWeekId, branchId, initialPaint: true }))
          if (activeWorkspaceScopeRef.current !== requestScope) return
          workspaceRef.current = initial
          setWorkspace(initial)
          setLoading(false)
          setLastSyncedAt(new Date())
          setSyncState('syncing')
          setSelectedTrainerId((current) => initial.trainers.some((trainer) => trainer.id === current && !isTrainerLocked(trainer))
            ? current
            : initial.trainers.find((trainer) => !isTrainerLocked(trainer))?.id || '')
          result = await loadFullWorkspace()
        } else {
          result = await loadFullWorkspace()
        }
        if (activeWorkspaceScopeRef.current !== requestScope) return
        const current = workspaceRef.current
        if (current?.branch.id === branchId && current.weekId === currentWeekId && result.draftRevision < current.draftRevision) return
        const changed = workspaceRealtimeFingerprint(workspaceRef.current) !== workspaceRealtimeFingerprint(result)
        if (!quiet) setWorkspace(result)
        else if (changed) startTransition(() => setWorkspace(result))
        setLastSyncedAt(new Date())
        setSyncState('live')
        const keepValidTrainer = (current: string) => result.trainers.some((trainer) => trainer.id === current && !isTrainerLocked(trainer))
          ? current
          : result.trainers.find((trainer) => !isTrainerLocked(trainer))?.id || ''
        if (quiet) startTransition(() => setSelectedTrainerId(keepValidTrainer))
        else setSelectedTrainerId(keepValidTrainer)
      } catch (loadError) {
        if (activeWorkspaceScopeRef.current !== requestScope) return
        if (!quiet || !workspaceRef.current) {
          // A failed refresh must not erase the currently displayed schedule.
          // On a scope change the layout effect has already cleared old data.
          setError(asPtSchedulePublishError(loadError).message)
        }
        setSyncState('offline')
      } finally {
        if (!quiet && activeWorkspaceScopeRef.current === requestScope) setLoading(false)
      }
    })()
    workspaceRequestRef.current = { scope: requestScope, forceAvailabilityRefresh, promise: request }
    try {
      await request
    } finally {
      if (workspaceRequestRef.current?.promise === request) workspaceRequestRef.current = null
    }
  }, [branchId, currentWeekId, ownerScope])

  const loadBranches = useCallback(async () => {
    setBranchCatalogState('loading')
    setBranchCatalogError(null)
    try {
      const nextBranches = await getCachedBranchCatalog(ownerScope)
      setBranches(nextBranches)
      setBranchId((current) => nextBranches.some((branch) => branch.id === current)
        ? current
        : nextBranches[0]?.id || '')
      setBranchCatalogState('ready')
    } catch (branchError) {
      const normalized = asPtSchedulePublishError(branchError)
      const fallbackBranches = ['admin', 'super_admin'].includes(accessContext.accessRole)
        ? []
        : scopedBranchIds.map((id) => ({ id, name: id, status: 'active' }))
      setBranches(fallbackBranches)
      setBranchId((current) => fallbackBranches.some((branch) => branch.id === current)
        ? current
        : fallbackBranches[0]?.id || '')
      setBranchCatalogError(normalized.message)
      setBranchCatalogState('error')
    }
  }, [accessContext.accessRole, ownerScope, scopedBranchIds])

  useEffect(() => {
    void loadBranches()
  }, [loadBranches])

  useLayoutEffect(() => {
    const cached = readWorkspaceCache(workspaceScope)
    setError(null)
    if (cached) {
      workspaceReadyTimingRef.current.source = 'cache'
      workspaceRef.current = cached.value
      setWorkspace(cached.value)
      setSelectedTrainerId((current) => cached.value.trainers.some((trainer) => trainer.id === current && !isTrainerLocked(trainer))
        ? current
        : cached.value.trainers.find((trainer) => !isTrainerLocked(trainer))?.id || '')
      setLoading(false)
      setLastSyncedAt(new Date(cached.storedAt))
      // A prior browser session may contain the old zero-slot projection from
      // before weekly availability was synchronized. Recheck such a cached
      // roster in the background without delaying the first paint.
      const hasPotentiallyStaleAvailability = cached.value.students.some((student) => student.availabilityStatus === 'missing')
      if (hasPotentiallyStaleAvailability) {
        setSyncState('syncing')
        void loadWorkspace(true, true)
      } else if (Date.now() - cached.storedAt > WORKSPACE_CACHE_REVALIDATE_MS) {
        setSyncState('syncing')
        void loadWorkspace(true)
      } else {
        setSyncState('live')
      }
    } else {
      workspaceRef.current = null
      setWorkspace(null)
      void loadWorkspace()
    }
    setNotice(null)
    setNoticeAction(null)
    availabilitySyncRevisionRef.current = ''
    setPublishPreview(null)
    setPublishIssues([])
    setHistory(null)
    setInspectorSlotId(null)
    setPendingManualCandidate(null)
    setPendingAdminRemoval(null)
    setAdminEditReason('')
    setHistoricalReason('')
    setPendingMove(null)
    setHoveredStudentId(null)
    setHighlightedStudentId(null)
    candidateCache.current.clear()
    setMobilePage(0)
  }, [branchId, currentWeekId, loadWorkspace, workspaceScope])

  useEffect(() => {
    if (!firestoreDb || !branchId || !currentWeekId || !canListenToDraft) return undefined
    // Student availability is written through a callable, so the Admin
    // workspace cannot rely on its draft listener to notice the change. This
    // one branch/week document is a cheap realtime invalidation signal; the
    // actual availability payload still comes from the capability-checked
    // workspace callable.
    const syncReference = doc(firestoreDb, 'ptAvailabilitySync', `${branchId}_${currentWeekId}`)
    const stop = onSnapshot(syncReference, (snapshot) => {
      const value = snapshot.data()
      if (!snapshot.exists() || !value) return
      const revision = String(Number(value.revision || 0))
      if (revision === '0' || revision === availabilitySyncRevisionRef.current) return
      const hadPreviousRevision = Boolean(availabilitySyncRevisionRef.current)
      availabilitySyncRevisionRef.current = revision
      // The first snapshot also refreshes a workspace restored from the
      // browser cache; later snapshots update an already-open page.
      if (!hadPreviousRevision || document.visibilityState === 'visible') void loadWorkspace(true, true)
    }, () => {
      // Managers without direct Firestore access continue to receive the
      // normal callable refresh path; a denied marker listener is harmless.
    })
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible' && availabilitySyncRevisionRef.current) void loadWorkspace(true, true)
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [branchId, canListenToDraft, currentWeekId, loadWorkspace])

  useEffect(() => {
    if (!notice) return undefined
    const timeout = window.setTimeout(() => { setNotice(null); setNoticeAction(null) }, 3_600)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    const onUpdateReady = () => setReleaseUpdateReady(true)
    window.addEventListener(APP_UPDATE_READY_EVENT, onUpdateReady)
    return () => window.removeEventListener(APP_UPDATE_READY_EVENT, onUpdateReady)
  }, [])

  useEffect(() => {
    if (!branchId || !currentWeekId) return undefined
    // The draft stream contains branch-owned scheduling data only. Firestore
    // Rules limit it to Admin or the branch manager assigned to this branch.
    // Apply that one document directly instead of using it as a signal for a
    // second full branch scan. This keeps the matrix mounted and makes one
    // remote draft edit cost one document read, not another workspace load.
    let stopDraftListener: (() => void) | undefined
    if (firestoreDb && canListenToDraft) {
      stopDraftListener = onSnapshot(
        doc(firestoreDb, 'ptScheduleDrafts', `${branchId}_${currentWeekId}`),
        (snapshot) => {
          const raw = snapshot.data()
          const current = workspaceRef.current
          if (!snapshot.exists() || !raw || !current || current.branch.id !== branchId || current.weekId !== currentWeekId) return
          if (raw.branchId && raw.branchId !== branchId) return
          if (raw.weekId && raw.weekId !== currentWeekId) return
          const revision = Number(raw.revision ?? 0)
          const publishedVersion = Number(raw.publishedVersion ?? current.publishedVersion)
          const nextStatus = raw.status === 'published' ? 'published' : 'draft'
          if (revision < current.draftRevision) return
          if (revision === current.draftRevision
            && publishedVersion === current.publishedVersion
            && nextStatus === current.draftStatus) {
            setSyncState('live')
            return
          }
          startTransition(() => setWorkspace((value) => {
            if (!value || value.branch.id !== branchId || value.weekId !== currentWeekId) return value
            const next = workspaceFromDraftSnapshot(value, raw)
            workspaceRef.current = next
            return next
          }))
          candidateCache.current.clear()
          setLastSyncedAt(new Date())
          setSyncState('live')
        },
        () => setSyncState((current) => current === 'connecting' ? 'offline' : current),
      )
    }
    return () => {
      stopDraftListener?.()
    }
  }, [branchId, canListenToDraft, currentWeekId])

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (moreMenuRef.current?.open && !moreMenuRef.current.contains(event.target as Node)) moreMenuRef.current.open = false
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [])

  const selectedTrainer = visibleTrainers.find((trainer) => trainer.id === selectedTrainerId) || null
  useEffect(() => {
    setSelectedTrainerId((current) => visibleTrainers.some((trainer) => trainer.id === current)
      ? current
      : visibleTrainers[0]?.id || '')
  }, [visibleTrainers])
  const inspectorEntries = useMemo(() => {
    if (!workspace || !inspectorSlotId || !selectedTrainerId) return []
    return (workspace.schedule[inspectorSlotId] || []).filter((entry) => entry.trainerId === selectedTrainerId)
  }, [inspectorSlotId, selectedTrainerId, workspace])
  const inspectorSlotIsPast = inspectorSlotId ? pastScheduleSlots.has(inspectorSlotId) : false
  const pendingMoveSourceEntry = pendingMove
    ? inspectorEntries.find((entry) => entry.studentId === pendingMove.studentId && entry.trainerId === pendingMove.fromTrainerId)
    : null
  const pendingMoveSourceSessionRef = pendingMove
    ? workspace?.sessionRefs?.[`${pendingMove.studentId}|${pendingMove.fromTrainerId}|${pendingMove.fromSlotId}`]
    : null
  const hasPublishedSchedule = workspace?.draftStatus === 'published' || Number(workspace?.publishedVersion || 0) > 0
  const pendingMoveRequiresAdminEdit = Boolean(isAdmin && pendingMove && (
    hasPublishedSchedule || inspectorSlotIsPast || pendingMoveSourceEntry?.isLocked === true || pendingMoveSourceEntry?.source === 'published_existing' || pendingMoveSourceSessionRef
  ))
  useEffect(() => {
    setHistoricalReason('')
    setPendingAdminRemoval(null)
    setAdminEditReason('')
  }, [inspectorSlotId, selectedTrainerId])

  const candidateGroups = useMemo(() => {
    const needle = normalizeScheduleSearchText(candidateSearch)
    const assignedStudentIds = new Set(inspectorEntries.map((entry) => entry.studentId))
    const visible = candidates.filter((candidate) => !assignedStudentIds.has(candidate.studentId)
      && (!needle || normalizeScheduleSearchText(candidate.name).includes(needle) || candidate.phone.includes(candidateSearch.trim())))
    const available: PtScheduleSlotCandidate[] = []
    const override: PtScheduleSlotCandidate[] = []
    const blocked: PtScheduleSlotCandidate[] = []
    for (const candidate of visible) {
      if (candidate.eligible && candidateMatchesStudentAvailability(candidate)) available.push(candidate)
      else if (!candidate.eligible && candidateCanBeManuallyScheduled(candidate, isAdmin)) override.push(candidate)
      else if (!candidateCanBeManuallyScheduled(candidate, isAdmin)) blocked.push(candidate)
    }
    return [
      {
        key: 'available',
        label: inspectorSlotIsPast ? 'Khớp dữ liệu đã đăng ký' : 'Rảnh đúng khung giờ',
        hint: inspectorSlotIsPast ? 'Có thể bổ sung lịch sử' : 'Ưu tiên xếp trước',
        items: available,
      },
      {
        key: 'override',
        label: inspectorSlotIsPast ? 'Có lưu ý cần xác nhận' : 'Ngoài lịch rảnh',
        hint: inspectorSlotIsPast ? 'Lưu cùng lý do audit' : 'Vẫn có thể xếp tay',
        items: override,
      },
      {
        key: 'blocked',
        label: 'Chưa đủ điều kiện',
        hint: 'Cần xử lý dữ liệu trước',
        items: blocked,
      },
    ]
  }, [candidateSearch, candidates, inspectorEntries, inspectorSlotIsPast, isAdmin])

  // A normal, current-week candidate has already passed the visible matrix
  // checks. Place that row immediately; keep a deliberate confirmation for
  // outside availability, cross-branch/assignment warnings, historical slots,
  // and Admin overrides so the exceptional action remains explicit.
  const canPlaceManualCandidateImmediately = (candidate: PtScheduleSlotCandidate) => Boolean(
    !inspectorSlotIsPast
      && candidate.eligible
      && candidateMatchesStudentAvailability(candidate)
      && !candidate.trainerAssignmentWarning
      && !candidate.studentBranchWarning
      && candidateCanBeManuallyScheduled(candidate, isAdmin)
      && (isAdmin || !selectedTrainer || inspectorEntries.filter((entry) => entry.type !== 'off').length < selectedTrainer.slotCapacity),
  )

  const trainerAssignmentWarnings = useMemo(() => {
    if (!workspace) return []
    const contractsById = new Map(workspace.contracts.map((contract) => [contract.id, contract]))
    const studentsById = new Map(workspace.students.map((student) => [student.id, student]))
    const trainersById = new Map(workspace.trainers.map((trainer) => [trainer.id, trainer]))
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
          studentName: studentsById.get(entry.studentId)?.name || 'Học viên chưa cập nhật',
          trainerName: trainersById.get(entry.trainerId)?.name || 'PT chưa cập nhật',
        })
      }
    }
    return rows.sort((left, right) => compareScheduleSlots(left.slotId, right.slotId) || left.studentName.localeCompare(right.studentName, 'vi'))
  }, [workspace])

  const scheduleConflictWarnings = useMemo(() => {
    if (!workspace) return []
    const studentsById = new Map(workspace.students.map((student) => [student.id, student]))
    const trainersById = new Map(workspace.trainers.map((trainer) => [trainer.id, trainer]))
    const rows: Array<{
      key: string
      slotId: string
      studentId: string
      trainerId: string
      studentName: string
      trainerName: string
      code: string
    }> = []
    const seen = new Set<string>()
    const add = (slotId: string, entry: PtScheduleWorkspaceV2Result['schedule'][string][number], code: string) => {
      if (!code || code === 'ADMIN_MANUAL_OVERRIDE') return
      const key = `${slotId}|${entry.studentId}|${entry.trainerId}|${code}`
      if (seen.has(key)) return
      seen.add(key)
      rows.push({
        key,
        slotId,
        studentId: entry.studentId,
        trainerId: entry.trainerId,
        studentName: studentsById.get(entry.studentId)?.name || 'Học viên chưa cập nhật',
        trainerName: trainersById.get(entry.trainerId)?.name || 'PT chưa cập nhật',
        code,
      })
    }
    for (const [slotId, entries] of Object.entries(workspace.schedule)) {
      const occupied = entries.filter((entry) => entry.type !== 'off')
      const byStudent = new Map<string, typeof occupied>()
      for (const entry of occupied) {
        const current = byStudent.get(entry.studentId) || []
        current.push(entry)
        byStudent.set(entry.studentId, current)
        for (const code of entry.adminOverrideWarnings || []) {
          if (MATRIX_IMPORTANT_WARNING_CODES.has(code)) add(slotId, entry, code)
        }
      }
      for (const studentEntries of byStudent.values()) {
        if (studentEntries.length < 2) continue
        for (const entry of studentEntries) add(slotId, entry, 'DUPLICATE_SCHEDULE_ENTRY')
      }
    }
    return rows.sort((left, right) => compareScheduleSlots(left.slotId, right.slotId)
      || left.studentName.localeCompare(right.studentName, 'vi')
      || left.code.localeCompare(right.code))
  }, [workspace])

  const matrixConflictWarningKeys = useMemo(
    () => new Set(scheduleConflictWarnings
      .filter((row) => MATRIX_IMPORTANT_WARNING_CODES.has(row.code))
      .map((row) => `${row.slotId}|${row.studentId}|${row.trainerId}`)),
    [scheduleConflictWarnings],
  )

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
    // The weekly workspace should stay operational, not become a second CRM
    // list. Keep currently eligible learners plus anyone who has a current
    // draft or was scheduled last week and has just lost eligibility.
    const contractsByStudent = new Map<string, typeof workspace.contracts>()
    for (const contract of workspace.contracts) {
      const rows = contractsByStudent.get(contract.studentId) || []
      rows.push(contract)
      contractsByStudent.set(contract.studentId, rows)
    }
    const latestContractByStudent = new Map<string, (typeof workspace.contracts)[number]>()
    for (const [studentId, contracts] of contractsByStudent) {
      const latest = contracts.reduce<(typeof workspace.contracts)[number] | undefined>((current, contract) => {
        if (!current || String(current.endDate || '').localeCompare(String(contract.endDate || '')) < 0) return contract
        return current
      }, undefined)
      if (latest) latestContractByStudent.set(studentId, latest)
    }
    const trainersById = new Map(workspace.trainers.map((trainer) => [trainer.id, trainer]))
    return workspace.students
      .filter((student) => !student.isCrossBranchDisplayOnly
        && !['archived', 'deleted'].includes(String(student.status || '').toLowerCase())
        && (student.eligibleForWeek === true
          || (scheduledEntriesByStudent.get(student.id)?.length || 0) > 0
          || student.hadSchedulePreviousWeek === true))
      .map((student) => {
      const scheduledEntries = scheduledEntriesByStudent.get(student.id) || []
      // The matrix is scoped to the selected training branch, but a learner's
      // weekly target is global. Add sessions already recorded at other
      // branches to the local draft count so a learner is not incorrectly
      // flagged as missing when they split the week across locations.
      const crossBranchScheduledSessions = Math.max(0, finiteCount(
        workspace.weeklySessionCoverage?.[student.id]?.otherBranches,
      ))
      const scheduled = scheduledEntries.length + crossBranchScheduledSessions
      const missing = Math.max(0, Number(student.sessionsPerWeek || 0) - scheduled)
      const eligibleContractIds = new Set(student.eligibleContractIds || [])
      const contracts = (contractsByStudent.get(student.id) || [])
        .filter((contract) => eligibleContractIds.has(contract.id))
        .sort((left, right) => String(left.endDate || '').localeCompare(String(right.endDate || '')))
      // The latest entitlement is the clearest summary for a renewal chain;
      // each actual schedule entry is still bound to its date-specific
      // source/new contract by the backend.
      const contract = contracts[contracts.length - 1]
        || latestContractByStudent.get(student.id)
        || null
      const trainerIds = [...new Set([
        contract?.trainerId,
        ...(contract?.trainerIds || []),
        ...scheduledEntries.map((entry) => entry.trainerId),
      ].filter((value): value is string => Boolean(value)))]
      const trainerNames = trainerIds.map((id) => trainersById.get(id)?.name).filter(Boolean).join(', ')
      const inputWarning = missing > 0
        || student.eligibleForWeek !== true
        || student.contractStatus === 'expiring'
        || !CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus)
        || student.eligibilityReasons.includes('AMBIGUOUS_ACTIVE_CONTRACT')
      return {
        student,
        scheduled,
        scheduledEntries,
        crossBranchScheduledSessions,
        missing,
        contract,
        trainerNames,
        inputWarning,
        feasibility: feasibilityByStudent.get(student.id),
      }
    })
  }, [scheduledEntriesByStudent, workspace])

  const studentWarnings = useMemo(() => operationalStudentRows.filter((row) => row.inputWarning), [operationalStudentRows])
  const ineligibleDraftRows = useMemo(() => (workspace?.students || [])
    .filter((student) => !student.isCrossBranchDisplayOnly
      && student.eligibleForWeek !== true && (scheduledEntriesByStudent.get(student.id)?.length || 0) > 0)
    .map((student) => ({ student, scheduledEntries: scheduledEntriesByStudent.get(student.id) || [] })), [scheduledEntriesByStudent, workspace])
  const missingSessions = studentWarnings.reduce((total, item) => total + item.missing, 0)
  const studentRows = useMemo(() => {
    const needle = studentSearch.trim().toLocaleLowerCase('vi-VN')
    const diagnosticsByStudent = new Map((workspace?.unassignedEntries || workspace?.unassigned || []).map((entry) => [entry.studentId, entry]))
    return operationalStudentRows.filter((row) => {
      if (studentFilter === 'missing' && row.missing < 1) return false
      if (studentFilter === 'contract' && row.student.contractStatus !== 'expiring' && row.student.eligibleForWeek === true && !row.student.eligibilityReasons.some((reason) => reason.includes('CONTRACT') || reason === 'ACTIVE_CONTRACT_NOT_FOUND')) return false
      if (studentFilter === 'availability' && CONFIRMED_AVAILABILITY_STATUSES.has(row.student.availabilityStatus)) return false
      if (studentFilter === 'trainer') {
        const diagnostic = diagnosticsByStudent.get(row.student.id)
        const diagnosticReasons = diagnostic?.reasonCodes || diagnostic?.reasons || []
        if (warningCauseFor(diagnostic?.blockerCategory, row.student.contractStatus, diagnosticReasons) !== 'capacity') return false
      }
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
    const scheduledFallback = eligibleRows.reduce((total, row) => total + Math.min(row.student.sessionsPerWeek, row.scheduled), 0)
    return {
      eligible,
      // These counts are deliberately derived from the rows above instead of
      // trusting the optimizer snapshot, which is branch-scoped by design.
      // The rows include the compact cross-branch coverage projection.
      withAtLeastOne: withAtLeastOneFallback,
      fullyScheduled: fullyScheduledFallback,
      totalTargetSessions: totalTargetFallback,
      scheduledEntries: scheduledFallback,
      missingSessions,
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

  const { items: scheduleOpportunities, bySlot: scheduleOpportunitiesBySlot } = useScheduleOpportunities(
    workspace, tab === 'opportunities', operationalStudentRows, opportunityStudentId, weekDates, workingDays, workingHours,
  )

  const openScheduleOpportunity = (opportunity: (typeof scheduleOpportunities)[number]) => {
    if (!workspace || workspaceHydrating) return
    setSelectedTrainerId(opportunity.trainerId)
    setInspectorSlotId(opportunity.slotId)
    setCandidateSearch(opportunityStudentId
      ? (workspace.students.find((student) => student.id === opportunityStudentId)?.name || '')
      : '')
    setPendingManualCandidate(null)
    setTab('matrix')
  }

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
    return visibleTrainers.flatMap((trainer) => workingDays.map((day) => {
      const backend = backendByKey.get(`${trainer.id}:${day}`)
      const fallbackCount = workingHours.reduce((total, hour) => {
        const hasTeachingSession = (workspace.schedule[`${day}-${hour}`] || [])
          .some((entry) => entry.trainerId === trainer.id && entry.type !== 'off')
        return total + Number(hasTeachingSession)
      }, 0)
      const count = finiteCount(backend?.sessionCount, backend?.teachingSlots, backend?.sessions, fallbackCount)
      const target = Math.max(1, finiteCount(backend?.dailySessionTarget, backend?.target, trainerDailyLoadTarget(trainer, workspace.scheduleConfig.scheduleLoadPolicy)))
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
  }, [visibleTrainers, weekDates, workingDays, workingHours, workspace])

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
      // No primary PT is not a blocker: any compatible same-branch PT can teach.
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

  const searchLimitWarning = useMemo(
    () => hasActionableSearchLimit(workspace?.optimizationSummary, unassignedEntries),
    [unassignedEntries, workspace?.optimizationSummary],
  )

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
      const crossBranchScheduledSessions = row?.crossBranchScheduledSessions
        ?? Math.max(0, finiteCount(workspace.weeklySessionCoverage?.[studentId]?.otherBranches))
      const scheduledSessions = row?.scheduled ?? scheduledEntries.length + crossBranchScheduledSessions
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
      const hasConfirmedAvailability = CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus)
        && student.availableSlots.length > 0
      const missingSessions = Math.max(0, row ? row.missing : (unassigned?.missingSessions || 0))
      const scheduledDayCodes = new Set(scheduledEntries.map((entry) => entry.slotId.split('-')[0]))
      const weeklyCoverageDates = workspace.weeklySessionCoverage?.[studentId]?.dates || []
      for (const date of weeklyCoverageDates) {
        const day = (Object.entries(weekDates).find(([, value]) => value.full === date) || [])[0]
        if (day) scheduledDayCodes.add(day)
      }
      const validDates = new Set(student.validScheduleDates || [])
      const remainingAvailabilityDays = new Set(student.availableSlots
        .map((slotId) => slotId.split('-')[0])
        .filter((day) => !scheduledDayCodes.has(day)
          && (!validDates.size || validDates.has(weekDates[day as keyof typeof weekDates]?.full))))
      const availabilityDayShortfall = Math.max(0, missingSessions - remainingAvailabilityDays.size)
      const reasonCodes = new Set<string>([
        // Contract diagnostics in a stored draft may belong to an older
        // entitlement. Always rebuild contract reasons from the latest live
        // student projection so an expired renewal chain cannot reappear.
        ...(unassigned?.reasonCodes || unassigned?.reasons || []).filter((code) => !CONTRACT_WARNING_REASONS.has(code)),
        ...(student.eligibilityReasons || []),
      ])
      if (student.contractStatus === 'expiring') reasonCodes.add('CONTRACT_EXPIRES_DURING_WEEK')
      else if (student.contractStatus === 'quota_exhausted') reasonCodes.add('CONTRACT_SESSION_QUOTA_EXCEEDED')
      else if (student.contractStatus === 'expired') reasonCodes.add('CONTRACT_EXPIRED_BEFORE_WEEK')
      else if (student.contractStatus === 'paused') reasonCodes.add('CONTRACT_PAUSED')
      else if (student.contractStatus === 'missing') reasonCodes.add('ACTIVE_CONTRACT_NOT_FOUND')
      else if (student.contractStatus === 'not_started_or_ended') reasonCodes.add('CONTRACT_NOT_STARTED_IN_WEEK')
      if (!CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus)) reasonCodes.add('AVAILABILITY_NOT_SUBMITTED')
      if (hasConfirmedAvailability && availabilityDayShortfall > 0) reasonCodes.add('STUDENT_AVAILABILITY_DAYS_INSUFFICIENT')
      if (missingSessions > 0 && !reasonCodes.size) reasonCodes.add('STUDENT_UNSCHEDULED')
      const orderedReasonCodes = [...reasonCodes]
        .sort((left, right) => warningReasonPriority(left) - warningReasonPriority(right) || left.localeCompare(right))
      const primaryReasonCode = orderedReasonCodes[0]
        || unassigned?.primaryReasonCode
        || (missingSessions > 0 ? 'STUDENT_UNSCHEDULED' : undefined)
      const actionCode = unassigned?.actionCode
        || (primaryReasonCode === 'CONTRACT_SESSION_QUOTA_EXCEEDED' || primaryReasonCode === 'CONTRACT_QUOTA_EXHAUSTED' ? 'REVIEW_CONTRACT_QUOTA' : undefined)
        || (primaryReasonCode && CONTRACT_WARNING_REASONS.has(primaryReasonCode) ? 'REVIEW_CONTRACT_DATES' : undefined)
        || (primaryReasonCode && LEARNER_WARNING_REASONS.has(primaryReasonCode) ? 'EDIT_STUDENT_AVAILABILITY' : undefined)
      const warningCause = warningCauseFor(unassigned?.blockerCategory, student.contractStatus, orderedReasonCodes)
      return {
        student,
        contract,
        trainerNames,
        scheduledEntries,
        scheduledSessions,
        crossBranchScheduledSessions,
        missingSessions,
        reasonCodes: orderedReasonCodes,
        primaryReasonCode,
        blockerCategory: unassigned?.blockerCategory,
        warningCause,
        actionCode,
        diagnostics: {
          ...(unassigned?.diagnostics || {}),
          contractStatus: student.contractStatus,
          latestContractEndDate: student.contractEndDate,
          contractQuotaRemaining: student.remainingEntitlementSessions,
          contractValidDateCount: student.validScheduleDates.length,
          candidateSlotCount: student.availableSlots.length,
          learnerAvailabilityCount: hasConfirmedAvailability ? student.availableSlots.length : 0,
          learnerAvailabilityDayCount: availabilityDayCount(student.availableSlots),
          validLearnerAvailabilityDayCount: remainingAvailabilityDays.size,
          requiredSessions: student.sessionsPerWeek,
          scheduledSessions,
          crossBranchScheduledSessions,
          missingSessions,
          availabilityDayShortfall,
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
      // Chỉ giữ hồ sơ đang xếp tuần này hoặc vừa có lịch ở tuần liền trước.
      // Hợp đồng/quota cũ và chẩn đoán còn sót trong draft không được kéo học
      // viên lịch sử trở lại trung tâm cảnh báo.
      .filter((profile) => profile.missingSessions > 0
        && (profile.student.eligibleForWeek === true
        || Number(profile.student.previousWeekScheduledSessions || 0) > 0
        || profile.scheduledEntries.length > 0))
      .sort((left, right) => {
        const priority = (profile: typeof left) => warningReasonPriority(profile.primaryReasonCode || 'STUDENT_UNSCHEDULED')
        return priority(left) - priority(right)
          || right.missingSessions - left.missingSessions
          || left.student.name.localeCompare(right.student.name, 'vi')
      })
  }, [ineligibleDraftRows, operationalStudentRows, scheduledEntriesByStudent, studentWarnings, unassignedEntries, weekDates, workspace])

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
    return warningProfiles.length + scheduleConflictWarnings.length
  }, [scheduleConflictWarnings.length, warningProfiles.length])
  const contractWarningProfiles = useMemo(() => warningProfiles.filter((profile) => profile.warningCause === 'contract'), [warningProfiles])
  const learnerWarningProfiles = useMemo(() => warningProfiles.filter((profile) => profile.warningCause === 'learner'), [warningProfiles])
  const capacityWarningProfiles = useMemo(() => warningProfiles.filter((profile) => profile.warningCause === 'capacity'), [warningProfiles])
  const systemWarningProfiles = useMemo(() => warningProfiles.filter((profile) => profile.warningCause === 'system'), [warningProfiles])
  const warningMissingSessions = useMemo(
    () => warningProfiles.reduce((total, profile) => total + profile.missingSessions, 0),
    [warningProfiles],
  )
  const visibleWarningProfiles = warningFilter === 'priority'
    ? warningProfiles
    : warningFilter === 'conflict'
      ? []
    : warningFilter === 'contract'
      ? contractWarningProfiles
      : warningFilter === 'learner'
        ? learnerWarningProfiles
        : warningFilter === 'capacity'
          ? capacityWarningProfiles
          : warningFilter === 'system'
            ? systemWarningProfiles
            : []

  // Candidate ranking only depends on the workspace/slot, not on the search
  // text. Keeping it memoized prevents a full branch scan on every keystroke
  // in the inspector search box (up to 500 learners and 100 PTs).
  const localInspectorCandidates = useMemo(
    () => workspace && inspectorSlotId && selectedTrainerId
      ? localSlotCandidates(workspace, selectedTrainerId, inspectorSlotId)
      : [],
    [inspectorSlotId, selectedTrainerId, workspace],
  )

  useEffect(() => {
    if (!workspace || !inspectorSlotId || !selectedTrainerId) {
      setCandidates([])
      return undefined
    }
    const normalizedCandidateSearch = normalizeScheduleSearchText(candidateSearch)
    const adminCrossBranchSearch = isAdmin && normalizedCandidateSearch.length >= 2 && !inspectorSlotIsPast
    const shouldAskServer = inspectorSlotIsPast
      || adminCrossBranchSearch
    const cacheKey = `${branchId}|${currentWeekId}|${workspace.draftRevision}|${selectedTrainerId}|${inspectorSlotId}|${inspectorSlotIsPast ? 'history' : 'draft'}|${normalizedCandidateSearch}`
    const cached = candidateCache.current.get(cacheKey)
    if (cached) {
      setCandidates(cached)
      setCandidateLoading(false)
      return undefined
    }
    // The workspace already contains every same-branch student, contract and
    // weekly availability needed to rank a normal draft slot. Confirmation is
    // still validated canonically by the command callable, so re-scanning the
    // full branch merely to render this list wasted reads and made the drawer
    // flash. Ask the server only for historical validation or an Admin search
    // that may intentionally include another branch.
    setCandidates(inspectorSlotIsPast ? [] : localInspectorCandidates)
    if (!shouldAskServer) {
      candidateCache.current.set(cacheKey, localInspectorCandidates)
      setCandidateLoading(false)
      return undefined
    }
    let active = true
    setCandidateLoading(true)
    const debounce = window.setTimeout(() => {
      getPtScheduleSlotCandidates({
        weekId: currentWeekId,
        branchId,
        trainerId: selectedTrainerId,
        slotId: inspectorSlotId,
        ...(inspectorSlotIsPast ? { historical: true } : {}),
        ...(adminCrossBranchSearch ? { crossBranchOnly: true } : {}),
        ...(normalizedCandidateSearch ? { search: normalizedCandidateSearch } : {}),
      }).then((result) => {
        if (!active) return
        // Same-branch candidates are already ranked from the workspace. The
        // optimized Admin endpoint returns only cross-branch matches so a
        // search does not rescan the entire branch; merge and de-duplicate by
        // learner id before applying the existing UI grouping/filtering.
        const nextCandidates = adminCrossBranchSearch
          ? [...new Map([...localInspectorCandidates, ...result.candidates].map((candidate) => [candidate.studentId, candidate])).values()]
          : result.candidates
        candidateCache.current.set(cacheKey, nextCandidates)
        setCandidates(nextCandidates)
      }).catch((candidateError) => {
        if (active) {
          const normalized = asPtSchedulePublishError(candidateError)
          setError([normalized.message, ...normalized.conflicts.map(ptScheduleConflictLabel)].join(' · '))
        }
      }).finally(() => {
        if (active) setCandidateLoading(false)
      })
    }, normalizedCandidateSearch ? 280 : 0)
    return () => {
      active = false
      window.clearTimeout(debounce)
    }
  }, [accessContext.accessRole, branchId, candidateSearch, currentWeekId, inspectorSlotId, inspectorSlotIsPast, isAdmin, localInspectorCandidates, selectedTrainerId, workspace, workspace?.draftRevision])

  const runCommand = async (command: PtScheduleDraftCommand, payload: Record<string, unknown>, reason?: string) => {
    if (!workspace || busyRef.current) return false
    const commandScope = workspaceScope
    busyRef.current = true
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
      if (activeWorkspaceScopeRef.current !== commandScope) return false
      setWorkspace((current) => {
        if (!current) return current
        const next = workspaceFromDraftSnapshot(current, {
          revision: result.draftRevision,
          schedule: result.schedule,
          status: 'draft',
          weeklySessionTargets: result.weeklySessionTargets || {},
          warnings: [],
          // A manual edit does not rerun the optimizer. Preserve the last
          // blocker diagnostics so unaffected learners stay in "Thiếu PT / ca"
          // (or their original group) until a fresh optimization pass replaces
          // them.
          unassignedEntries: current.unassignedEntries || current.unassigned || [],
        })
        workspaceRef.current = next
        return next
      })
      setNotice(`Đã lưu draft r${result.draftRevision}. Bấm Publish để đồng bộ lên lịch PT.`)
      setNoticeAction(['add_student', 'remove_student', 'move_student'].includes(command) ? 'publish' : null)
      setOffConfirmation(false)
      if (command === 'add_student' || command === 'move_student') setPendingManualCandidate(null)
      return true
    } catch (commandError) {
      if (activeWorkspaceScopeRef.current !== commandScope) return false
      const normalized = asPtSchedulePublishError(commandError)
      setError([normalized.message, ...normalized.conflicts.map(ptScheduleConflictLabel)].join(' · '))
      if (normalized.issueCode === 'REVISION_CONFLICT') await loadWorkspace(true)
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const runAdminEdit = async (command: 'add_student' | 'move_student' | 'remove_student', payload: Record<string, unknown>, reason: string) => {
    if (!workspace || busyRef.current) return false
    const normalizedReason = reason.trim()
    const auditReason = normalizedReason || (command === 'remove_student' ? 'Admin gỡ buổi trực tiếp trên ma trận' : 'Admin điều chỉnh buổi trực tiếp trên ma trận')
    const commandScope = workspaceScope
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const sourceRef = workspace.sessionRefs?.[`${payload.studentId}|${payload.fromTrainerId || payload.trainerId}|${payload.fromSlotId || payload.slotId}`]
      const result = await applyAdminPtScheduleEdit({
        weekId: currentWeekId,
        branchId,
        expectedDraftRevision: workspace.draftRevision,
        command,
        payload: { ...payload, ...(sourceRef ? { sessionId: sourceRef.sessionId, expectedSessionRevision: sourceRef.revision } : {}) },
        reason: auditReason,
        idempotencyKey: commandKey(),
      })
      if (activeWorkspaceScopeRef.current !== commandScope) return false
      setWorkspace((current) => {
        if (!current) return current
        const next = workspaceFromDraftSnapshot(current, {
          revision: result.draftRevision,
          schedule: result.schedule,
          // A direct Admin correction has already reconciled the real session.
          // Keep the workspace published so the next edit does not force a
          // second Publish step.
          status: result.sessionChanged ? 'published' : 'draft',
          ...(result.sessionChanged ? { publishedRevision: result.draftRevision } : {}),
          weeklySessionTargets: result.weeklySessionTargets || {},
          warnings: [],
          unassignedEntries: current.unassignedEntries || current.unassigned || [],
        })
        if (result.sessionChanged) {
          const refs = { ...(current.sessionRefs || {}) }
          const sourceKey = `${payload.studentId}|${payload.fromTrainerId || payload.trainerId}|${payload.fromSlotId || payload.slotId}`
          const targetKey = `${payload.studentId}|${payload.trainerId}|${payload.slotId}`
          if (command === 'remove_student') delete refs[sourceKey]
          else {
            const source = refs[sourceKey]
            if (command === 'move_student' && sourceKey !== targetKey) delete refs[sourceKey]
            refs[targetKey] = {
              sessionId: result.sessionId || source?.sessionId || '',
              revision: Number(result.sessionRevision ?? (source?.revision || 0) + 1),
            }
          }
          next.sessionRefs = Object.fromEntries(Object.entries(refs).filter(([, value]) => value.sessionId))
        }
        workspaceRef.current = next
        return next
      })
      candidateCache.current.clear()
      setNotice(result.sessionChanged
        ? (command === 'remove_student' ? 'Đã gỡ buổi tập và đồng bộ lịch PT; đã lưu lịch sử điều chỉnh.' : command === 'add_student' ? 'Đã thêm buổi tập và đồng bộ ngay lịch PT, học viên.' : 'Đã chuyển buổi tập và đồng bộ lịch PT; đã lưu lịch sử điều chỉnh.')
        : 'Đã lưu điều chỉnh lịch nháp; cần Publish để áp dụng lên lịch PT.')
      setNoticeAction(result.sessionChanged ? null : 'publish')
      setPendingMove(null)
      setPendingAdminRemoval(null)
      setAdminEditReason('')
      setOffConfirmation(false)
      return true
    } catch (editError) {
      if (activeWorkspaceScopeRef.current !== commandScope) return false
      const normalized = asPtSchedulePublishError(editError)
      setError([normalized.message, ...normalized.conflicts.map(ptScheduleConflictLabel)].join(' · '))
      if (normalized.issueCode === 'REVISION_CONFLICT') await loadWorkspace(true)
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const confirmManualCandidate = async (candidateOverride?: PtScheduleSlotCandidate) => {
    const candidate = candidateOverride || pendingManualCandidate
    if (!candidate || !inspectorSlotId || !selectedTrainerId || busyRef.current) return
    const outsideAvailability = !candidateMatchesStudentAvailability(candidate)
    const reason = [
      outsideAvailability ? 'Quản lý xác nhận xếp tay ngoài lịch rảnh học viên' : 'Quản lý xác nhận xếp tay',
      candidate.trainerAssignmentWarning ? 'PT hỗ trợ ngoài danh sách PT chính/phụ' : '',
      candidate.studentBranchWarning ? 'Xác nhận học viên tập khác cơ sở hồ sơ' : '',
    ].filter(Boolean).join(' · ')
    const payload = {
      slotId: inspectorSlotId,
      trainerId: selectedTrainerId,
      studentId: candidate.studentId,
      ...(candidate.contractId ? { contractId: candidate.contractId } : {}),
      ...(isAdmin ? { adminOverride: true } : {}),
      ...(outsideAvailability ? { allowOutsideStudentAvailability: true } : {}),
      ...(candidate.studentBranchWarning ? { confirmCrossBranchStudent: true } : {}),
    }
    if (isAdmin && hasPublishedSchedule && !inspectorSlotIsPast) {
      await runAdminEdit('add_student', payload, reason)
      return
    }
    await runCommand('add_student', payload, reason)
  }

  const confirmHistoricalCandidate = async () => {
    if (!pendingManualCandidate || !inspectorSlotId || !selectedTrainerId || !pendingManualCandidate.contractId || historicalReason.trim().length < 8 || busyRef.current) return
    const commandScope = workspaceScope
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await createHistoricalPtSession({
        weekId: currentWeekId,
        branchId,
        trainerId: selectedTrainerId,
        studentId: pendingManualCandidate.studentId,
        contractId: pendingManualCandidate.contractId,
        slotId: inspectorSlotId,
        reason: historicalReason.trim(),
        acknowledgedWarnings: pendingManualCandidate.warningReasons || pendingManualCandidate.reasons,
        ...(pendingManualCandidate.studentBranchWarning ? { confirmCrossBranchStudent: true } : {}),
        idempotencyKey: commandKey(),
      })
      if (activeWorkspaceScopeRef.current !== commandScope) return
      candidateCache.current.clear()
      setPendingManualCandidate(null)
      setHistoricalReason('')
      await loadWorkspace(true)
      setNoticeAction(null)
      setNotice(result.payrollAdjustmentRequired
        ? 'Đã bổ sung ca vào lịch sử. Kỳ lương đã chốt cần xử lý bằng khoản điều chỉnh.'
        : 'Đã bổ sung ca vào lịch sử và chuyển sang chờ PT xác nhận.')
    } catch (cause) {
      if (activeWorkspaceScopeRef.current === commandScope) {
        const normalized = asPtSchedulePublishError(cause)
        setError([normalized.message, ...normalized.conflicts.map(ptScheduleConflictLabel)].join(' · '))
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const confirmMove = async () => {
    if (!pendingMove) return
    const student = workspace?.students.find((item) => item.id === pendingMove.studentId)
    const outside = !student?.availableSlots.includes(pendingMove.slotId)
    const payload = {
      ...pendingMove,
      ...(isAdmin ? { adminOverride: true } : {}),
      ...(outside ? { allowOutsideStudentAvailability: true } : {}),
      ...(student && student.branchId !== branchId ? { confirmCrossBranchStudent: true } : {}),
    }
    const success = pendingMoveRequiresAdminEdit
      ? await runAdminEdit('move_student', payload, adminEditReason)
      : await runCommand('move_student', payload, 'Quản lý xác nhận chuyển ca nháp; giữ ca cũ nếu chuyển không thành công')
    if (success) setPendingMove(null)
  }

  const confirmRemove = async () => {
    if (!pendingAdminRemoval || !workspace) return
    const student = workspace.students.find((item) => item.id === pendingAdminRemoval.studentId)
    const payload = {
      ...pendingAdminRemoval,
      ...(student && student.branchId !== branchId ? { confirmCrossBranchStudent: true } : {}),
    }
    const success = isAdmin
      ? await runAdminEdit('remove_student', payload, adminEditReason)
      : await runCommand('remove_student', payload, 'Gỡ học viên khỏi ca nháp')
    if (success) setPendingAdminRemoval(null)
  }

  const removeStudentFromSlot = async (studentId: string, slotId: string, trainerId: string) => {
    if (!isAdmin) {
      setPendingMove(null)
      setAdminEditReason('')
      setPendingAdminRemoval({ studentId, slotId, trainerId })
      return
    }
    const student = workspace?.students.find((item) => item.id === studentId)
    const entry = workspace?.schedule[slotId]?.find((item) => item.type !== 'off' && item.studentId === studentId && item.trainerId === trainerId)
    // A pre-publish row is only a draft map entry. Keep it on the lightweight
    // draft command so removing it does not invoke the live-session
    // reconciliation fan-out used after Publish.
    if (!hasPublishedSchedule && entry?.source !== 'published_existing') {
      await runCommand('remove_student', {
        studentId,
        slotId,
        trainerId,
        adminOverride: true,
        ...(student && student.branchId !== branchId ? { confirmCrossBranchStudent: true } : {}),
      }, 'Admin gỡ học viên khỏi lịch nháp')
      return
    }
    await runAdminEdit('remove_student', {
      studentId,
      slotId,
      trainerId,
      ...(student && student.branchId !== branchId ? { confirmCrossBranchStudent: true } : {}),
    }, '')
  }

  const setWeeklyTarget = async (studentId: string, targetSessions: number | null) => {
    if (!workspace || busyRef.current) return
    const student = workspace.students.find((item) => item.id === studentId)
    if (!student) return
    const commandScope = workspaceScope
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await setPtStudentWeeklyTarget({
        weekId: currentWeekId,
        branchId,
        studentId,
        ...(targetSessions === null ? { resetToDefault: true } : { targetSessions }),
        idempotencyKey: commandKey(),
      })
      if (activeWorkspaceScopeRef.current !== commandScope) return
      setWorkspace((current) => {
        if (!current) return current
        const scheduledByStudent = new Map<string, number>()
        Object.values(current.schedule).flat().forEach((entry) => {
          if (entry.type !== 'off') scheduledByStudent.set(entry.studentId, (scheduledByStudent.get(entry.studentId) || 0) + 1)
        })
        const nextStudents = current.students.map((item) => item.id === studentId ? {
          ...item,
          sessionsPerWeek: result.targetSessions,
          weeklySessionTargetOverride: result.weeklySessionTargetOverride,
          weeklySessionTargetOverridden: result.weeklySessionTargetOverridden,
        } : item)
        const missingSessions = nextStudents
          .filter((item) => item.eligibleForWeek === true)
          .reduce((total, item) => total + Math.max(0, item.sessionsPerWeek - (scheduledByStudent.get(item.id) || 0)), 0)
        const next = { ...current, students: nextStudents, summary: { ...current.summary, missingSessions } }
        workspaceRef.current = next
        return next
      })
      candidateCache.current.clear()
      setNotice(targetSessions === null
        ? `Đã đưa mục tiêu ${student.name} về định mức hồ sơ, không tạo draft.`
        : `Đã lưu mục tiêu ${result.targetSessions} buổi cho ${student.name}, không tạo draft.`)
      setNoticeAction(null)
    } catch (targetError) {
      if (activeWorkspaceScopeRef.current !== commandScope) return
      const normalized = asPtSchedulePublishError(targetError)
      setError([normalized.message, ...normalized.conflicts.map(ptScheduleConflictLabel)].join(' · '))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const resetDraft = async () => {
    if (!workspace || draftResetSummary.resettableEntries < 1) return
    if (!await runCommand('reset_draft', {}, 'Đặt lại lịch nháp chưa publish')) return
    setResetDraftOpen(false)
    setTab('warnings')
  }

  const openAvailabilityEditor = (student: PtScheduleWorkspaceV2Result['students'][number]) => {
    setAvailabilityEditorStudentId((current) => current === student.id ? null : student.id)
    setAvailabilityDraft(new Set(student.availableSlots || []))
    setAvailabilityError('')
  }

  const openWarningStudentAvailability = (student: PtScheduleWorkspaceV2Result['students'][number]) => {
    // A warning is actionable: take the manager straight to the learner's
    // weekly availability editor instead of leaving them on an expanded
    // diagnostic card and requiring a second search in the Students tab.
    setExpandedWarningStudentId(null)
    setStudentFilter('all')
    // Keep the full roster visible after navigation. Filling the search box
    // with the warning learner made every dropdown filter appear ineffective;
    // the availability editor and anchor below already provide the focus.
    setStudentSearch('')
    setTab('students')
    setAvailabilityEditorStudentId(student.id)
    setAvailabilityDraft(new Set(student.availableSlots || []))
    setAvailabilityError('')
    setNotice(`Đã mở lịch rảnh của ${student.name}.`)
  }

  const openFirstWarningStudentAvailability = () => {
    const profile = visibleWarningProfiles[0] || warningProfiles[0]
    if (profile) {
      openWarningStudentAvailability(profile.student)
      return
    }
    const conflict = scheduleConflictWarnings[0]
    const student = conflict && workspace?.students.find((item) => item.id === conflict.studentId)
    if (student) {
      openWarningStudentAvailability(student)
      return
    }
    setTab('warnings')
  }

  useEffect(() => {
    if (tab !== 'students' || !availabilityEditorStudentId) return undefined
    const timer = window.setTimeout(() => {
      document.getElementById(`schedule-student-${availabilityEditorStudentId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [availabilityEditorStudentId, studentRows.length, tab])

  const saveStudentAvailability = async (student: PtScheduleWorkspaceV2Result['students'][number]) => {
    if (availabilityBusy) return
    const commandScope = workspaceScope
    setAvailabilityBusy(true); setAvailabilityError('')
    try {
      const result = await savePtStudentAvailability({
        weekId: currentWeekId,
        branchId,
        studentId: student.id,
        availableSlots: [...availabilityDraft],
        expectedRevision: student.availabilityRevision,
        confirmBelowMinimum: isAdmin && availabilityDraft.size < Math.max(5, Number(student.sessionsPerWeek || 1)),
      })
      if (activeWorkspaceScopeRef.current !== commandScope) return
      candidateCache.current.clear()
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
      setNoticeAction(null)
      setNotice(result.belowMinimumConfirmed
        ? `Đã cập nhật lịch rảnh của ${student.name} với ${result.availableSlots.length} khung; hồ sơ đang thiếu khung để xếp đủ buổi.`
        : `Đã cập nhật lịch rảnh của ${student.name}.`)
    } catch (cause) {
      const normalized = asPtSchedulePublishError(cause)
      setAvailabilityError(normalized.message)
      if (normalized.issueCode === 'REVISION_CONFLICT') await loadWorkspace(true)
    } finally { setAvailabilityBusy(false) }
  }

  const reopenStudentAvailability = async (student: PtScheduleWorkspaceV2Result['students'][number]) => {
    if (availabilityBusy) return
    const commandScope = workspaceScope
    setAvailabilityBusy(true); setAvailabilityError('')
    try {
      const result = await reopenPtStudentAvailability({
        weekId: currentWeekId,
        branchId,
        studentId: student.id,
        expectedRevision: student.availabilityRevision,
      })
      if (activeWorkspaceScopeRef.current !== commandScope) return
      setWorkspace((current) => current ? {
        ...current,
        students: current.students.map((item) => item.id === student.id ? {
          ...item,
          availabilityStatus: result.availabilityStatus,
          availabilityLocked: result.availabilityLocked,
          availabilityReopenedUntil: result.reopenedUntil,
        } : item),
      } : current)
      setNoticeAction(null)
      setNotice(`Đã mở lịch rảnh cho ${student.name} đến hết tuần.`)
    } catch (cause) {
      const normalized = asPtSchedulePublishError(cause)
      setAvailabilityError(normalized.message)
      if (normalized.issueCode === 'REVISION_CONFLICT') await loadWorkspace(true)
    } finally { setAvailabilityBusy(false) }
  }

  const autoArrange = async (mode: 'optimize' | 'supplement' | 'continue' = 'optimize') => {
    if (!workspace || busyRef.current) return
    const commandScope = workspaceScope
    busyRef.current = true
    setBusy(true)
    setError(null)
    setOptimizationStatus('Đang đối chiếu lịch rảnh, hợp đồng và công suất từng khung…')
    const deepSearchTimer = window.setTimeout(() => {
      setOptimizationStatus('Đang chờ kết quả từ máy chủ. Ca chỉnh tay, ca khóa và lịch đã publish được giữ nguyên…')
    }, 1_200)
    try {
      const result = await measureScheduleTask('optimizer', () => generatePtScheduleDraft({
        weekId: currentWeekId,
        branchId,
        expectedDraftRevision: workspace.draftRevision,
        mode,
      }))
      if (activeWorkspaceScopeRef.current !== commandScope) return
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
      const searchNote = searchLimitReached && hasActionableSearchLimit(result.optimizationSummary, result.unassignedEntries || result.unassigned)
        ? ' Bộ tìm kiếm đã chạm giới hạn an toàn cho các hồ sơ còn thiếu; hãy bấm Tối ưu tiếp hoặc xử lý ở tab Cảnh báo.' : ''
      setNoticeAction(null)
      setNotice(unresolved
        ? `Đã tối ưu draft r${result.draftRevision}; còn ${unresolved} hồ sơ cần xử lý.${deepRun}${searchNote}`
        : `Đã tối ưu draft r${result.draftRevision}; đã ưu tiên đủ học viên, ca đôi và PT chính/phụ.${deepRun}${searchNote}`)
      if (unresolved) setTab('warnings')
    } catch (arrangeError) {
      if (activeWorkspaceScopeRef.current !== commandScope) return
      const normalized = asPtSchedulePublishError(arrangeError)
      setError(normalized.message)
      if (normalized.issueCode === 'REVISION_CONFLICT') await loadWorkspace(true)
    } finally {
      window.clearTimeout(deepSearchTimer)
      setOptimizationStatus(null)
      busyRef.current = false
      setBusy(false)
    }
  }

  const validatePublish = async () => {
    if (!workspace || busyRef.current) return
    const commandScope = workspaceScope
    busyRef.current = true
    setBusy(true)
    setError(null)
    setPublishIssues([])
    try {
      const preview = await validatePtScheduleDraft({
        weekId: currentWeekId,
        branchId,
        expectedDraftRevision: workspace.draftRevision,
      })
      if (activeWorkspaceScopeRef.current === commandScope) {
        setPublishCrossBranchConfirmed(false)
        setPublishPreview(preview)
      }
    } catch (validateError) {
      if (activeWorkspaceScopeRef.current !== commandScope) return
      const normalized = asPtSchedulePublishError(validateError)
      setPublishIssues(normalized.errorDetails || [])
      setError([normalized.message, ...normalized.conflicts.map(ptScheduleConflictLabel)].join(' · '))
      setTab('warnings')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const confirmPublish = async () => {
    if (!publishPreview || busyRef.current) return
    if (publishPreview.warnings.includes('STUDENT_BRANCH_MISMATCH') && !publishCrossBranchConfirmed) return
    const commandScope = workspaceScope
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await measureScheduleTask('publish', () => publishPtSchedule({
        weekId: currentWeekId,
        branchId,
        expectedDraftRevision: publishPreview.draftRevision,
        acknowledgedWarnings: publishCrossBranchConfirmed ? ['STUDENT_BRANCH_MISMATCH'] : [],
      }))
      if (activeWorkspaceScopeRef.current !== commandScope) return
      setPublishPreview(null)
      setNoticeAction(null)
      setNotice(result.unchanged ? `Lịch đã ở phiên bản v${result.version}.` : `Đã publish an toàn phiên bản v${result.version}.`)
      await loadWorkspace(true)
    } catch (publishError) {
      if (activeWorkspaceScopeRef.current !== commandScope) return
      const normalized = asPtSchedulePublishError(publishError)
      setError(normalized.message)
      setPublishIssues(normalized.errorDetails || [])
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const openHistory = async () => {
    if (busyRef.current) return
    const commandScope = workspaceScope
    busyRef.current = true
    setTab('history')
    setBusy(true)
    setError(null)
    try {
      const history = await listPtScheduleVersions({ weekId: currentWeekId, branchId })
      if (activeWorkspaceScopeRef.current === commandScope) setHistory(history)
    } catch (historyError) {
      if (activeWorkspaceScopeRef.current !== commandScope) return
      setError(asPtSchedulePublishError(historyError).message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const restoreVersion = async () => {
    if (!history || !restoreCandidate || busyRef.current) return
    const commandScope = workspaceScope
    busyRef.current = true
    setBusy(true)
    try {
      const result = await restorePtScheduleVersionToDraft({
        weekId: currentWeekId,
        branchId,
        version: restoreCandidate.version,
        expectedDraftRevision: history.currentDraftRevision,
      })
      if (activeWorkspaceScopeRef.current !== commandScope) return
      setRestoreCandidate(null)
      setHistory(null)
      setTab('matrix')
      setNoticeAction(null)
      setNotice(`Đã tạo draft r${result.draftRevision} từ phiên bản v${result.version}.`)
      await loadWorkspace(true)
    } catch (restoreError) {
      if (activeWorkspaceScopeRef.current !== commandScope) return
      setError(asPtSchedulePublishError(restoreError).message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const studentNames = useMemo(
    () => new Map((workspace?.students || []).map((student) => [student.id, student.name || 'Học viên chưa cập nhật'])),
    [workspace?.students],
  )
  const studentName = (studentId: string) => studentNames.get(studentId) || 'Học viên đã xóa'
  const highlightedStudent = workspace?.students.find((student) => student.id === highlightedStudentId) || null
  const hoveredStudent = workspace?.students.find((student) => student.id === hoveredStudentId) || null
  const hoveredAvailabilitySlots = useMemo(
    () => new Set(hoveredStudent?.availableSlots || []),
    [hoveredStudent?.availableSlots],
  )
  const trainerAvailabilitySlots = useMemo(
    () => new Set(selectedTrainer?.availableSlots || []),
    [selectedTrainer?.availableSlots],
  )
  const trainerAvailabilityIsUnrestricted = selectedTrainer?.availabilityMode === 'unrestricted'
  const highlightedScheduleSlots = useMemo(
    () => new Set((highlightedStudentId ? scheduledEntriesByStudent.get(highlightedStudentId) : [])?.map((entry) => entry.slotId) || []),
    [highlightedStudentId, scheduledEntriesByStudent],
  )
  const selectedDays = mobileGroups[mobilePage] || mobileGroups[0] || []

  const toggleStudentSchedule = (studentId: string) => {
    setHighlightedStudentId((current) => current === studentId ? null : studentId)
  }

  const showStudentAvailability = (studentId: string) => {
    if (hoverClearTimer.current !== null) window.clearTimeout(hoverClearTimer.current)
    hoverClearTimer.current = null
    setHoveredStudentId((current) => current === studentId ? current : studentId)
  }

  const hideStudentAvailability = (studentId: string) => {
    if (hoverClearTimer.current !== null) window.clearTimeout(hoverClearTimer.current)
    hoverClearTimer.current = window.setTimeout(() => {
      setHoveredStudentId((current) => current === studentId ? null : current)
      hoverClearTimer.current = null
    }, 70)
  }

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
          <label><span>Chi nhánh</span><select aria-label="Chọn chi nhánh" disabled={busy || availabilityBusy || workspaceHydrating} value={branchId} onChange={(event) => setBranchId(event.target.value)}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <div className="branch-schedule__week">
            <button type="button" aria-label="Tuần trước" disabled={busy || availabilityBusy || weekOffset <= MIN_WEEK_OFFSET} onClick={() => setWeekOffset((value) => Math.max(MIN_WEEK_OFFSET, value - 1))}><ChevronLeft /></button>
            <div><span>Tuần</span><strong>{weekDates.T2.display} – {weekDates.CN.display}</strong></div>
            <button type="button" aria-label="Tuần sau" disabled={busy || availabilityBusy} onClick={() => setWeekOffset((value) => value + 1)}><ChevronRight /></button>
          </div>
          <span className={`branch-schedule__sync is-${syncState}`} title={lastSyncedAt ? `Cập nhật lúc ${lastSyncedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Đang kết nối dữ liệu'}><Activity size={14} />{syncState === 'live' ? 'Trực tiếp' : syncState === 'offline' ? 'Mất kết nối' : 'Đang đồng bộ'}</span>
        </div>
      </header>

      <section className="branch-schedule__summary-strip" aria-label="Tóm tắt lịch tuần">
        <button type="button" onClick={() => setTab('students')}><UsersRound /><strong>{studentCoverage.fullyScheduled}/{studentCoverage.eligible}</strong><span>học viên đủ lịch</span></button>
        <button type="button" onClick={() => setTab('students')}><CalendarRange /><strong>{studentCoverage.scheduledEntries}/{studentCoverage.totalTargetSessions}</strong><span>buổi đã xếp</span></button>
        <button type="button" onClick={() => setTab('warnings')} className={slotUtilization.singleSlots > 0 ? 'is-attention' : ''}><UsersRound /><strong>{slotUtilization.pairedSlots} đôi</strong><span>{slotUtilization.singleSlots} ca còn lẻ</span></button>
        <button type="button" onClick={openFirstWarningStudentAvailability} className={warningCount > 0 ? 'is-attention' : ''}><AlertTriangle /><strong>{warningCount}</strong><span>cảnh báo cần xem</span></button>
      </section>

      <section className="branch-schedule__toolbar">
        <div className="branch-schedule__tabs" role="tablist" aria-label="Nội dung xếp lịch">
          <button id="schedule-tab-matrix" type="button" role="tab" aria-selected={tab === 'matrix'} aria-controls="schedule-panel-matrix" tabIndex={tab === 'matrix' ? 0 : -1} className={tab === 'matrix' ? 'is-active' : ''} onClick={() => setTab('matrix')}>Lịch PT</button>
          <button id="schedule-tab-opportunities" type="button" role="tab" aria-selected={tab === 'opportunities'} aria-controls="schedule-panel-opportunities" tabIndex={tab === 'opportunities' ? 0 : -1} className={tab === 'opportunities' ? 'is-active' : ''} onClick={() => setTab('opportunities')}>Kho ca {tab === 'opportunities' && <b>{scheduleOpportunities.length}</b>}</button>
          <button id="schedule-tab-warnings" type="button" role="tab" aria-selected={tab === 'warnings'} aria-controls="schedule-panel-warnings" tabIndex={tab === 'warnings' ? 0 : -1} className={tab === 'warnings' ? 'is-active' : ''} onClick={openFirstWarningStudentAvailability}>Cảnh báo <b>{warningCount}</b></button>
          <button id="schedule-tab-students" type="button" role="tab" aria-selected={tab === 'students'} aria-controls="schedule-panel-students" tabIndex={tab === 'students' ? 0 : -1} className={tab === 'students' ? 'is-active' : ''} onClick={() => setTab('students')}>Học viên</button>
          {canManageOperations && <button id="schedule-tab-requests" type="button" role="tab" aria-selected={tab === 'requests'} aria-controls="schedule-panel-requests" tabIndex={tab === 'requests' ? 0 : -1} className={tab === 'requests' ? 'is-active' : ''} onClick={() => setTab('requests')}>Yêu cầu</button>}
        </div>
        <div className="branch-schedule__actions">
          <button type="button" aria-label="Xếp tối ưu" onClick={() => void autoArrange()} disabled={!workspace || workspaceHydrating || busy}><Sparkles size={16} /><span>Xếp tối ưu</span></button>
          <button type="button" aria-label="Tối ưu tiếp" onClick={() => void autoArrange('continue')} disabled={!workspace || workspaceHydrating || busy}><RefreshCw size={16} /><span>Tối ưu tiếp</span></button>
          <button type="button" className="is-publish" onClick={() => void validatePublish()} title="Kiểm tra & Publish" disabled={!workspace || workspaceHydrating || busy}><CheckCircle2 size={16} /><span>Publish</span></button>
          <details className="branch-schedule__more" ref={moreMenuRef}>
            <summary aria-label="Mở thêm công cụ" title="Thêm công cụ"><MoreHorizontal size={18} /></summary>
            <div>
              <button type="button" onClick={() => { moreMenuRef.current?.removeAttribute('open'); void autoArrange('supplement') }} disabled={!workspace || workspaceHydrating || busy}><Plus size={16} /><span><strong>Bổ sung lịch thiếu</strong><small>Giữ nguyên mọi ca hiện có, chỉ thêm buổi</small></span></button>
              <header><strong>Công cụ khác</strong><span>Draft r{workspace?.draftRevision || 0} · lịch v{workspace?.publishedVersion || 0}</span></header>
              <button type="button" onClick={() => { moreMenuRef.current?.removeAttribute('open'); void openHistory() }}><History size={16} /><span><strong>Lịch sử & khôi phục</strong><small>Dùng khi cần quay lại lịch đã publish</small></span></button>
              <button type="button" onClick={() => { moreMenuRef.current?.removeAttribute('open'); setResetDraftOpen(true) }} disabled={!workspace || workspaceHydrating || busy || draftResetSummary.resettableEntries < 1}><RotateCcw size={16} /><span><strong>Đặt lại draft</strong><small>Giữ nguyên ca khóa, OFF và đã publish</small></span></button>
              <button type="button" onClick={() => { moreMenuRef.current?.removeAttribute('open'); void loadWorkspace() }} disabled={loading || workspaceHydrating || busy}><RefreshCw size={16} className={loading ? 'is-spinning' : ''} /><span><strong>Tải lại dữ liệu</strong><small>Đồng bộ lại ngay bây giờ</small></span></button>
            </div>
          </details>
        </div>
      </section>

      {notice && <div className="branch-schedule__notice" role="status"><span>{notice}</span>{noticeAction === 'publish' && <button type="button" onClick={() => void validatePublish()} disabled={busy}>Kiểm tra & Publish ngay</button>}</div>}
      {releaseUpdateReady && <div className="branch-schedule__update-ready" role="status"><span>Aura có bản cập nhật mới. Lịch đang mở được giữ nguyên để không mất thao tác.</span><button type="button" onClick={() => window.location.reload()}><RefreshCw size={14} /> Cập nhật khi sẵn sàng</button></div>}
      {branchCatalogError && <div className="branch-schedule__error branch-schedule__branch-warning" role="alert"><span>{branchCatalogError}</span><button type="button" onClick={() => void loadBranches()}><RefreshCw size={15} /> Tải lại chi nhánh</button></div>}
      {error && <div className="branch-schedule__error" role="alert">{error}</div>}
      {publishIssues.length > 0 && <section className="branch-schedule__publish-issues" aria-label="Chi tiết lỗi công bố">{publishIssues.map((issue, i) => <button type="button" key={i} disabled={!issue.slotId || busy} onClick={() => {
        if (!issue.slotId) return
        const trainer = issue.trainerId || workspace?.schedule[issue.slotId]?.find((entry) => !issue.studentId || entry.studentId === issue.studentId)?.trainerId
        if (!trainer) return
        setSelectedTrainerId(trainer); setInspectorSlotId(issue.slotId); setPendingMove(null); setPendingManualCandidate(null)
      }}>{[issue.studentName, issue.trainerName, issue.slotId ? scheduleSlotLabel(issue.slotId, weekDates) : '', ptScheduleConflictLabel(issue.code)].filter(Boolean).join(' · ')}</button>)}</section>}
      {optimizationStatus && <div className="branch-schedule__optimization-progress" role="status" aria-live="polite"><RefreshCw className="is-spinning" /><div><strong>Bộ tối ưu lịch đang chạy</strong><span>{optimizationStatus}</span></div></div>}
      {!optimizationStatus && workspace?.optimizationSummary?.comparison && <p className="branch-schedule__notice" role="status">
        Trước → sau: {workspace.optimizationSummary.comparison.before.sessions} → {workspace.optimizationSummary.comparison.after.sessions} buổi · {workspace.optimizationSummary.comparison.before.complete} → {workspace.optimizationSummary.comparison.after.complete} học viên đủ lịch · {workspace.optimizationSummary.comparison.before.paired} → {workspace.optimizationSummary.comparison.after.paired} ca đôi.
      </p>}
      {!optimizationStatus && optimizationTrace.length > 0 && <details className="branch-schedule__optimization-trace">
        <summary><span><Sparkles size={16} /><strong>{optimizationTrace.length} bước xếp/đổi chỗ gần nhất</strong></span><small>Mở chi tiết</small></summary>
        <ol>{optimizationTrace.map((move, index) => {
          const fromTrainer = workspace?.trainers.find((trainer) => trainer.id === move.fromTrainerId)?.name || 'PT cũ'
          const toTrainer = workspace?.trainers.find((trainer) => trainer.id === move.toTrainerId)?.name || 'PT mới'
          return <li key={`${move.studentId}-${move.fromSlotId || 'new'}-${move.toSlotId}-${index}`}><b>{index + 1}</b><div><strong>{move.studentName || studentName(move.studentId)}</strong><span>{move.fromSlotId ? `${scheduleSlotLabel(move.fromSlotId, weekDates)} · ${fromTrainer} → ` : 'Bổ sung vào '}{scheduleSlotLabel(move.toSlotId, weekDates)} · {toTrainer}</span></div></li>
        })}</ol>
      </details>}
      {!optimizationStatus && searchLimitWarning && <div className="branch-schedule__search-limit" role="status"><AlertTriangle size={16} /> Tối ưu đã dừng ở ngân sách tìm kiếm an toàn cho một số hồ sơ còn thiếu. Ca thủ công, ca khóa và ca đã publish vẫn được giữ nguyên; bấm “Tối ưu tiếp” hoặc xử lý hồ sơ trong Cảnh báo.</div>}
      {loading && !workspace && <div className="branch-schedule__loading"><RefreshCw className="is-spinning" /> Đang tải workspace theo phạm vi…</div>}
      {workspaceHydrating && <div className="branch-schedule__loading"><RefreshCw className="is-spinning" /> Lịch đã hiện; đang đối soát hợp đồng và cảnh báo…</div>}

      {tab === 'requests' && canManageOperations && (
        <main id="schedule-panel-requests" role="tabpanel" aria-labelledby="schedule-tab-requests" className="branch-schedule__workspace">
          <OperationsRequestCenter kind="session" />
        </main>
      )}

      {workspace && tab === 'matrix' && (
        <main id="schedule-panel-matrix" role="tabpanel" aria-labelledby="schedule-tab-matrix" className="branch-schedule__workspace">
          <section className="branch-schedule__matrix-toolbar">
            <label><span>Huấn luyện viên</span><select value={selectedTrainerId} disabled={workspaceHydrating} onChange={(event) => setSelectedTrainerId(event.target.value)}>{visibleTrainers.map((trainer) => <option key={trainer.id} value={trainer.id}>{trainer.name}</option>)}</select></label>
            {selectedTrainer && <div className={`trainer-availability-chip is-${selectedTrainer.availabilityMode}`}><Clock3 size={14} />{selectedTrainer.availabilityMode === 'configured' ? `${selectedTrainer.availableSlots?.length || 0} khung giờ rảnh` : selectedTrainer.availabilityMode === 'unrestricted' ? 'Không giới hạn' : 'Chưa khai lịch rảnh'}</div>}
            <div className="schedule-opportunity-inline-legend" aria-label="Chú giải ma trận"><span className="is-trainer-availability"><i aria-hidden="true" />PT đăng ký rảnh</span><span>Thứ tự: ghép 1/2 → PT chính thức dưới mốc → PT còn slot</span></div>
          </section>

          <details className="branch-schedule__trainer-details">
            <summary><span><strong>Phân bổ ca PT</strong><small>Mốc tải chỉ dùng để cân bằng; Aura vẫn ưu tiên xếp đủ buổi học viên</small></span>{selectedTrainer && <b>{selectedTrainerLoads.reduce((total, load) => total + load.count, 0)} ca tuần <ChevronRight size={15} /></b>}</summary>
            <section className="trainer-workload" aria-label="Tải ca huấn luyện viên theo ngày">
              <div className="trainer-workload__rail">
                {visibleTrainers.map((trainer) => {
                  const loads = trainerLoads.filter((load) => load.trainerId === trainer.id)
                  const total = loads.reduce((sum, load) => sum + load.count, 0)
                  const priority = finiteCount(trainer.schedulingPriority, trainer.priority)
                  const target = loads[0]?.target || trainerDailyLoadTarget(trainer, workspace.scheduleConfig.scheduleLoadPolicy)
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

          <div className={`schedule-student-focus${highlightedStudent ? ' is-pinned' : ''}`} role="status">
            <span>{highlightedStudent ? <><strong>{highlightedStudent.name}</strong> · ô đỏ là lịch đã xếp trong tuần</> : hoveredStudent ? <><strong>{hoveredStudent.name}</strong> · ô xanh là lịch rảnh đã đăng ký</> : 'Chọn tên học viên để xem lịch đã xếp; rê chuột để xem lịch rảnh.'}</span>
            <button type="button" style={{ visibility: highlightedStudent ? 'visible' : 'hidden' }} aria-hidden={!highlightedStudent} tabIndex={highlightedStudent ? 0 : -1} onClick={() => setHighlightedStudentId(null)}>Tắt hiển thị</button>
          </div>

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
                const isOff = entries.some((entry) => entry.type === 'off')
                const holiday = holidayDates.has(weekDates[day as keyof typeof weekDates]?.full || '')
                const past = pastScheduleSlots.has(slotId)
                const isTrainerAvailable = Boolean(!holiday && !isOff && (trainerAvailabilityIsUnrestricted || trainerAvailabilitySlots.has(slotId)))
                const showsAvailability = hoveredAvailabilitySlots.has(slotId)
                const showsStudentSchedule = highlightedScheduleSlots.has(slotId)
                const openInspector = () => {
                  if (!selectedTrainerId || holiday || workspaceHydrating) return
                  if (hoverClearTimer.current !== null) window.clearTimeout(hoverClearTimer.current)
                  hoverClearTimer.current = null
                  setHoveredStudentId(null)
                  setInspectorSlotId(slotId)
                  setCandidateSearch('')
                  setHistoricalReason('')
                  setOffConfirmation(false)
                  setPendingManualCandidate(null)
                }
                const trainingEntries = entries.filter((entry) => entry.type !== 'off')
                const hasImportantWarning = trainingEntries.some((entry) => entry.studentBranchWarning === true
                  || matrixConflictWarningKeys.has(`${slotId}|${entry.studentId}|${entry.trainerId}`))
                const availabilityDescription = isTrainerAvailable ? ' · PT đăng ký rảnh' : ''
                const cellDescription = holiday
                  ? `${scheduleSlotLabel(slotId, weekDates)} · Ngày nghỉ`
                  : isOff
                    ? `${scheduleSlotLabel(slotId, weekDates)} · ${selectedTrainer?.name || 'PT'} nghỉ`
                    : `${scheduleSlotLabel(slotId, weekDates)} · ${selectedTrainer?.name || 'PT'} · ${trainingEntries.length} học viên${availabilityDescription}`
                return <td key={slotId} className={`${selectedDays.includes(day) ? 'is-mobile-visible' : ''}${holiday ? ' is-holiday' : ''}`}><div role={trainingEntries.length ? undefined : 'button'} tabIndex={!selectedTrainerId || holiday || trainingEntries.length ? -1 : 0} aria-label={cellDescription} aria-disabled={!selectedTrainerId || holiday} className={`schedule-cell${holiday ? ' is-holiday' : ''}${past ? ' is-past' : ''}${isOff ? ' is-off' : ''}${entries.length ? ' has-entry' : ''}${hasImportantWarning ? ' has-important-warning' : ''}${isTrainerAvailable ? ' is-trainer-available' : ''}${showsAvailability ? ' is-availability-hover' : ''}${showsStudentSchedule ? ' is-student-highlight' : ''}`} onClick={openInspector} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openInspector() } }}><span className="schedule-cell__count">{holiday ? 'NGHỈ' : isOff ? 'OFF' : `${trainingEntries.length}/${selectedTrainer?.slotCapacity || 2}`}</span>{holiday ? <><CalendarOff /><small>Không xếp lịch</small></> : isOff ? <CalendarOff /> : trainingEntries.length ? trainingEntries.map((entry) => {
                  const branchWarning = entry.studentBranchWarning === true
                  const conflictWarning = matrixConflictWarningKeys.has(`${slotId}|${entry.studentId}|${entry.trainerId}`)
                  const warningLabel = [
                    branchWarning ? 'Học viên khác chi nhánh' : '',
                    conflictWarning ? 'Lịch trùng hoặc xung đột' : '',
                  ].filter(Boolean).join(' · ')
                  const baseTitle = entry.sessionKind === 'makeup'
                    ? `Buổi bù · ${entry.makeupMode === 'paired_existing_shift' ? 'ghép vào ca có sẵn' : 'ca bù riêng'} · không trừ thêm buổi · không tính hoa hồng ca bù`
                    : 'Rê chuột: xem lịch rảnh · Chọn: xem lịch đã xếp'
                  return <button type="button" className={`schedule-cell__student${highlightedStudentId === entry.studentId ? ' is-selected' : ''}${branchWarning ? ' has-branch-warning' : ''}${conflictWarning ? ' has-conflict-warning' : ''}${entry.sessionKind === 'makeup' ? ' is-makeup' : ''}`} key={`${entry.studentId}-${entry.trainerId}`} onPointerEnter={(event) => { if (event.pointerType === 'mouse') showStudentAvailability(entry.studentId) }} onPointerLeave={(event) => { if (event.pointerType === 'mouse') hideStudentAvailability(entry.studentId) }} onFocus={(event) => { if (event.currentTarget.matches(':focus-visible') && window.matchMedia('(hover: hover) and (pointer: fine)').matches) showStudentAvailability(entry.studentId) }} onBlur={() => hideStudentAvailability(entry.studentId)} onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (hoverClearTimer.current !== null) window.clearTimeout(hoverClearTimer.current); hoverClearTimer.current = null; setHoveredStudentId(null); toggleStudentSchedule(entry.studentId) }} aria-pressed={highlightedStudentId === entry.studentId} title={`${baseTitle}${warningLabel ? ` · ${warningLabel}` : ''}`}><span>{studentName(entry.studentId)}</span>{entry.sessionKind === 'makeup' && <small aria-label="Buổi bù">BÙ</small>}{(branchWarning || conflictWarning) && <AlertTriangle size={11} aria-label={`Cảnh báo: ${warningLabel}`} />}{entry.isLocked && <Lock size={11} aria-label="Ca đã khóa" />}</button>
                }) : past ? <small>Bổ sung lịch sử</small> : <Plus size={15} aria-hidden="true" />}</div></td>
              })}</tr>)}</tbody>
            </table>
          </div>
        </main>
      )}

      {workspace && tab === 'students' && (
        <main id="schedule-panel-students" role="tabpanel" aria-labelledby="schedule-tab-students" className="branch-schedule__students-page">
          <header><div><p>LỊCH TẬP TUẦN NÀY · <span className="sr-only">Tiến độ xếp lịch</span></p><h2>Học viên</h2><span>{studentRows.length} học viên · chỉ hiển thị các buổi trong tuần</span></div>{onNavigate && <button type="button" onClick={() => onNavigate('admin-pt-students')}><UserPlus size={16} /> Hồ sơ</button>}</header>
          <div className="branch-schedule__student-tools">
            <label><Search size={17} /><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Tìm tên học viên" /></label>
            <select aria-label="Lọc học viên" value={studentFilter} onChange={(event) => setStudentFilter(event.target.value as StudentFilter)}><option value="all">Tất cả</option><option value="missing">Còn thiếu buổi</option><option value="contract">Hợp đồng / quota</option><option value="availability">Thiếu lịch rảnh</option><option value="trainer">Thiếu PT / ca</option><option value="ready">Đã đủ lịch</option></select>
          </div>
          <div className="branch-schedule__student-list">
            {studentRows.map(({ student, scheduled, scheduledEntries, crossBranchScheduledSessions, missing }) => {
              const diagnosis = unassignedByStudent.get(student.id)
              const contractIssue = student.eligibilityReasons.find((reason) => reason.includes('CONTRACT') || reason === 'ACTIVE_CONTRACT_NOT_FOUND')
              const primaryReason = diagnosis?.primaryReasonCode || contractIssue || (missing > 0 ? 'STUDENT_UNSCHEDULED' : undefined)
              const statusText = student.eligibleForWeek !== true
                ? diagnosticReasonLabel(primaryReason)
                : missing > 0
                  ? `Thiếu ${missing} buổi`
                  : 'Đủ lịch tuần'
              return <article id={`schedule-student-${student.id}`} key={student.id} className={`${missing > 0 ? 'is-missing' : 'is-ready'}${student.eligibleForWeek !== true ? ' is-ineligible' : ''}${availabilityEditorStudentId === student.id ? ' is-editing-availability' : ''}`}>
              <div className="branch-schedule__student-person"><span><UsersRound size={17} /></span><div><strong>{student.name || 'Chưa cập nhật tên'}</strong><small>{statusText}</small></div></div>
              <div className="branch-schedule__student-progress"><strong>{scheduled}/{student.sessionsPerWeek}</strong><span>{student.eligibleForWeek !== true ? 'Cần rà lại' : statusText}</span><i><b style={{ width: `${Math.min(100, student.sessionsPerWeek ? scheduled / student.sessionsPerWeek * 100 : 100)}%` }} /></i></div>
              <div className="branch-schedule__weekly-target"><small>Mục tiêu</small><div><button type="button" aria-label={`Giảm mục tiêu tuần của ${student.name}`} disabled={busy || student.sessionsPerWeek <= scheduled} onClick={() => void setWeeklyTarget(student.id, student.sessionsPerWeek - 1)}><Minus /></button><strong>{student.sessionsPerWeek}</strong><button type="button" aria-label={`Tăng mục tiêu tuần của ${student.name}`} disabled={busy || student.sessionsPerWeek >= student.maxWeeklySessions} onClick={() => void setWeeklyTarget(student.id, student.sessionsPerWeek + 1)}><Plus /></button>{student.sessionsPerWeek > 0 && <button type="button" className="is-zero" title={scheduled > 0 ? 'Gỡ lịch trong tuần trước khi đặt 0 buổi' : 'Đặt nhanh mục tiêu về 0 buổi'} aria-label={`Đặt nhanh mục tiêu của ${student.name} về 0 buổi`} disabled={busy || scheduled > 0} onClick={() => void setWeeklyTarget(student.id, 0)}>0</button>}{student.weeklySessionTargetOverridden && <button type="button" className="is-reset" title={`Về ${student.defaultSessionsPerWeek} buổi`} aria-label={`Khôi phục mục tiêu của ${student.name} về ${student.defaultSessionsPerWeek} buổi`} disabled={busy || Math.min(student.defaultSessionsPerWeek, student.maxWeeklySessions) < scheduled} onClick={() => void setWeeklyTarget(student.id, null)}><RotateCcw /></button>}</div></div>
              <div className="branch-schedule__student-schedule"><small>Buổi trong tuần{crossBranchScheduledSessions > 0 ? ` · +${crossBranchScheduledSessions} ở cơ sở khác` : ''}</small><div>{scheduledEntries.length ? scheduledEntries.map((entry) => <span key={`${entry.slotId}-${entry.trainerId}`} className={entry.trainerAssignmentWarning ? 'has-assignment-warning' : ''}>{entry.label}<b>{workspace.trainers.find((trainer) => trainer.id === entry.trainerId)?.name || 'PT chưa cập nhật'}{entry.trainerAssignmentWarning && <AlertTriangle size={12} aria-label="PT hỗ trợ" />}</b></span>) : crossBranchScheduledSessions > 0 ? <em>Đã có lịch ở cơ sở khác</em> : <em>Chưa có buổi trong tuần</em>}</div></div>
              <div className="branch-schedule__student-availability-action"><button type="button" className={`is-${student.availabilityStatus}`} aria-expanded={availabilityEditorStudentId === student.id} onClick={() => openAvailabilityEditor(student)}><CalendarRange size={16} />{student.availabilityStatus === 'locked' ? 'Lịch rảnh đã khóa' : CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus) ? 'Lịch rảnh' : 'Thêm lịch rảnh'}</button>{!CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus) && <span className="is-warning">Cần lịch rảnh</span>}</div>
              {availabilityEditorStudentId === student.id && <section className="branch-schedule__availability-editor">
                <header><div><small>LỊCH RẢNH TUẦN {currentWeekId}</small><strong>{student.name}</strong></div><span>{availabilityDraft.size} khung đã chọn</span></header>
                <AvailabilityMatrix days={workingDays} hours={workingHours} selected={availabilityDraft} onChange={setAvailabilityDraft} disabled={availabilityBusy} ariaLabel={`Lịch rảnh của ${student.name}`} />
                {availabilityError && <p role="alert">{availabilityError}</p>}
                <footer><button type="button" onClick={() => setAvailabilityEditorStudentId(null)}>Đóng</button>{isAdmin && (student.availabilityLocked || student.availabilityStatus === 'locked') && <button type="button" className="is-reopen" disabled={availabilityBusy} onClick={() => void reopenStudentAvailability(student)}><Unlock size={16} />{availabilityBusy ? 'Đang mở' : 'Mở cho học viên đến hết tuần'}</button>}<button type="button" className="is-save" disabled={availabilityBusy} onClick={() => void saveStudentAvailability(student)}><Save size={16} />{availabilityBusy ? 'Đang lưu' : 'Lưu lịch rảnh'}</button></footer>
              </section>}
              </article>
            })}
            {!studentRows.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có học viên phù hợp bộ lọc.</div>}
          </div>
        </main>
      )}

      {workspace && tab === 'opportunities' && (
        <main id="schedule-panel-opportunities" role="tabpanel" aria-labelledby="schedule-tab-opportunities" className="branch-schedule__opportunities-page">
          <header><div><p>KHO CA KHẢ DỤNG</p><h2>Điều phối ca trống</h2><span>Chọn học viên để lọc đúng lịch rảnh; ưu tiên ghép ca 1/2, ca trống của PT chính thức cùng chi nhánh đang dưới mốc cân tải riêng, rồi các PT cùng chi nhánh còn lại. Mốc tải là tham chiếu, không phải trần.</span></div><div className="schedule-opportunities__stats"><strong>{scheduleOpportunities.filter((item) => item.priorityTier === 1).length}</strong><span>ghế ghép</span><strong>{scheduleOpportunities.filter((item) => item.priorityTier === 2).length}</strong><span>PT dưới mốc</span><strong>{scheduleOpportunities.filter((item) => item.priorityTier === 3).length}</strong><span>PT còn lại</span></div></header>
          <div className="schedule-opportunities__toolbar">
            <label><span>Học viên cần xếp / đổi</span><select value={opportunityStudentId} onChange={(event) => setOpportunityStudentId(event.target.value)}><option value="">Tất cả học viên · xem toàn chi nhánh</option>{workspace.students.filter((student) => student.eligibleForWeek !== false).sort((left, right) => left.name.localeCompare(right.name, 'vi')).map((student) => <option key={student.id} value={student.id}>{student.name} · {student.availableSlots.length} slot rảnh</option>)}</select></label>
            <div className="schedule-opportunities__legend"><span>1 · Ghép ca 1/2</span><span>2 · PT chính thức dưới mốc</span><span>3 · PT cùng CN còn lại</span><span>PT chính/phụ được xếp đầu</span></div>
          </div>
          <section className="schedule-opportunity-matrix" aria-label="Ma trận tải ca còn trống">
            <header><div><strong>Ma trận tải ca còn trống</strong><small>Mỗi ô hiển thị tổng chỗ còn nhận và số PT. Màu ưu tiên chỉ dùng trong kho ca; lịch cá nhân của PT giữ nguyên kiểu hiển thị riêng.</small></div><div className="schedule-opportunity-matrix__legend"><span data-priority="1">1 · Ghép</span><span data-priority="2">2 · Dưới mốc</span><span data-priority="3">3 · Còn slot</span><span data-priority="0">0 · Hết ca</span></div></header>
            <div className="schedule-opportunity-matrix__mobile-days">
              <button type="button" aria-label="Xem nhóm ngày trước" disabled={mobilePage === 0} onClick={() => setMobilePage((value) => Math.max(0, value - 1))}><ChevronLeft /></button>
              <strong>{selectedDays.map((day) => DAY_LABELS[day] || day).join(' · ')}</strong>
              <button type="button" aria-label="Xem nhóm ngày sau" disabled={mobilePage >= mobileGroups.length - 1} onClick={() => setMobilePage((value) => Math.min(mobileGroups.length - 1, value + 1))}><ChevronRight /></button>
            </div>
            <div className="schedule-opportunity-matrix__shell"><table><thead><tr><th>Giờ</th>{workingDays.map((day) => <th key={day} className={selectedDays.includes(day) ? 'is-mobile-visible' : ''}><span>{DAY_LABELS[day] || day}</span><small>{weekDates[day as keyof typeof weekDates]?.display}</small></th>)}</tr></thead><tbody>{workingHours.map((hour) => <tr key={hour}><th>{String(hour).padStart(2, '0')}:00</th>{workingDays.map((day) => {
              const slotId = `${day}-${hour}`
              const opportunities = scheduleOpportunitiesBySlot.get(slotId) || []
              const priority = opportunities.length ? Math.min(...opportunities.map((item) => item.priorityTier)) as 1 | 2 | 3 : null
              const availableSeats = opportunities.reduce((sum, item) => sum + Math.max(0, item.capacity - item.occupancy), 0)
              const trainerCount = new Set(opportunities.map((item) => item.trainerId)).size
              const tierCounts = ([1, 2, 3] as const).map((tier) => ({ tier, count: opportunities.filter((item) => item.priorityTier === tier).length }))
              const bestOpportunity = opportunities[0]
              const label = `${scheduleSlotLabel(slotId, weekDates)} · ${availableSeats} chỗ trống · ${trainerCount} PT khả dụng${priority ? ` · ưu tiên ${priority}` : ''}`
              return <td key={slotId} className={selectedDays.includes(day) ? 'is-mobile-visible' : ''}><button type="button" className={bestOpportunity ? 'is-available' : 'is-empty'} data-priority={priority || undefined} disabled={!bestOpportunity} aria-label={label} onClick={() => bestOpportunity && openScheduleOpportunity(bestOpportunity)}><strong>{availableSeats}</strong><small>{availableSeats ? `${trainerCount} PT` : 'Hết ca'}</small><span>{tierCounts.filter((item) => item.count > 0).map((item) => <i key={item.tier}>{item.tier}:{item.count}</i>)}</span></button></td>
            })}</tr>)}</tbody></table></div>
          </section>
          <div className="schedule-opportunities__groups">
            {([1, 2, 3] as const).map((tier) => {
              const items = scheduleOpportunities.filter((item) => item.priorityTier === tier).slice(0, 120)
              const label = tier === 1 ? 'Ưu tiên 1 · Ghép vào ca 1/2' : tier === 2 ? 'Ưu tiên 2 · PT chính thức cùng chi nhánh dưới mốc cân tải' : 'Ưu tiên 3 · Các PT cùng chi nhánh còn lại'
              return <section key={tier} className="schedule-opportunities__group" data-priority={tier}><header><strong>{label}</strong><span>{items.length} cơ hội{items.length === 120 ? ' · đang hiển thị 120 đầu tiên' : ''}</span></header><div>{items.length ? items.map((item) => {
                const assignedLabel = opportunityStudentId
                  ? item.isPrimaryTrainer ? 'Khớp PT chính' : item.secondaryMatchCount > 0 ? 'Khớp PT phụ' : ''
                  : item.assignedMatchCount > 0 ? `Khớp PT chính/phụ của ${item.assignedMatchCount} học viên` : ''
                return <button type="button" key={`${item.trainerId}|${item.slotId}`} onClick={() => openScheduleOpportunity(item)}><span><strong>{scheduleSlotLabel(item.slotId, weekDates)}</strong><small>{item.trainerName}{item.priorityTier === 2 ? ` · PT chính thức · dưới mốc ${item.dailyTarget}` : ' · cùng chi nhánh'}</small>{assignedLabel && <small className="schedule-opportunity-assignment">{assignedLabel} · xếp trước</small>}</span><em>{item.occupancy}/{item.capacity} · {item.occupancy === 1 ? 'còn 1 ghế' : `${item.dailyLoad}/${item.dailyTarget} mốc tải`}</em><ChevronRight size={16} /></button>
              }) : <p className="schedule-opportunities__empty">Chưa có cơ hội ở tầng này cho bộ lọc hiện tại.</p>}</div></section>
            })}
          </div>
        </main>
      )}

      {workspace && tab === 'warnings' && (
        <main id="schedule-panel-warnings" role="tabpanel" aria-labelledby="schedule-tab-warnings" className="branch-schedule__warning-page">
          <header><p>RÀ SOÁT TUẦN NÀY</p><h2>Cảnh báo</h2><span>{warningCount ? `${warningCount} mục cần xử lý` : 'Không có cảnh báo'}</span></header>
          <section className="schedule-warning-overview" aria-label="Tổng hợp cảnh báo lịch tập">
            <button type="button" className="schedule-warning-stat is-missing" aria-pressed={warningFilter === 'priority'} onClick={() => setWarningFilter('priority')}><span className="schedule-warning-stat__value">{warningProfiles.length}</span><span className="schedule-warning-stat__label">Thiếu buổi</span><small>{warningMissingSessions} buổi trong tuần</small></button>
            <button type="button" className="schedule-warning-stat is-conflict" aria-pressed={warningFilter === 'conflict'} onClick={() => setWarningFilter('conflict')}><span className="schedule-warning-stat__value">{scheduleConflictWarnings.length}</span><span className="schedule-warning-stat__label">Trùng / xung đột</span><small>Chọn dòng để mở ma trận</small></button>
          </section>
          <section className="schedule-warning-summary" aria-label="Lọc theo lý do">
            <button type="button" className="is-contract" aria-pressed={warningFilter === 'contract'} onClick={() => setWarningFilter('contract')}><strong>{contractWarningProfiles.length}</strong><span>Do hợp đồng</span></button>
            <button type="button" className="is-learner" aria-pressed={warningFilter === 'learner'} onClick={() => setWarningFilter('learner')}><strong>{learnerWarningProfiles.length}</strong><span>Do lịch khách</span></button>
            <button type="button" className="is-capacity" aria-pressed={warningFilter === 'capacity'} onClick={() => setWarningFilter('capacity')}><strong>{capacityWarningProfiles.length}</strong><span>Thiếu PT / ca</span></button>
            <button type="button" className="is-system" aria-pressed={warningFilter === 'system'} onClick={() => setWarningFilter('system')}><strong>{systemWarningProfiles.length}</strong><span>Cần tối ưu</span></button>
          </section>
          <nav className="schedule-warning-filters" role="tablist" aria-label="Nhóm cảnh báo">
            <button type="button" role="tab" aria-selected={warningFilter === 'priority'} className={warningFilter === 'priority' ? 'is-active' : ''} onClick={() => setWarningFilter('priority')}>Thiếu buổi <b>{warningProfiles.length}</b></button>
            <button type="button" role="tab" aria-selected={warningFilter === 'conflict'} className={warningFilter === 'conflict' ? 'is-active' : ''} onClick={() => setWarningFilter('conflict')}>Trùng / xung đột <b>{scheduleConflictWarnings.length}</b></button>
          </nav>
          {warningFilter === 'conflict' && <section className="schedule-warning-conflicts" aria-label="Danh sách trùng và xung đột lịch">
            <header><div><strong>Lịch cần đối soát</strong><span>Chọn một dòng để mở đúng ô trong ma trận.</span></div><b>{scheduleConflictWarnings.length}</b></header>
            <div>{scheduleConflictWarnings.slice(0, 100).map((row) => <button type="button" key={row.key} onClick={() => { setSelectedTrainerId(row.trainerId); setInspectorSlotId(row.slotId); setCandidateSearch(''); setTab('matrix') }}><AlertTriangle size={16} /><span><strong>{row.studentName}</strong><small>{scheduleSlotLabel(row.slotId, weekDates)} · {row.trainerName}</small><em>{diagnosticReasonLabel(row.code)}</em></span><ChevronRight size={16} /></button>)}</div>
          </section>}
          <section className="schedule-warning-grid">
            {visibleWarningProfiles.map(({ student, missingSessions: missing, scheduledSessions, crossBranchScheduledSessions, reasonCodes, primaryReasonCode, warningCause, actionCode, candidateSlots, suggestedSlots }) => {
              const expanded = expandedWarningStudentId === student.id
              const primaryReasons = Array.from(new Set([primaryReasonCode, ...reasonCodes])).filter((code): code is string => Boolean(code)).slice(0, 2)
              const topCandidates = (candidateSlots || []).filter((slot) => slot.availableTrainerIds?.length || slot.blockerCodes?.length).slice(0, 4)
              const openDiagnosticSlot = (slot: NonNullable<typeof candidateSlots>[number]) => {
                const trainerId = slot.availableTrainerIds?.[0] || slot.blockedTrainerIds?.[0]
                if (!trainerId) return
                setSelectedTrainerId(trainerId)
                setInspectorSlotId(slot.slotId)
                setCandidateSearch('')
                setPendingManualCandidate(null)
                setTab('matrix')
              }
                return <article key={student.id} className={`schedule-warning-student is-cause-${warningCause}${student.eligibleForWeek ? '' : ' is-blocking'}${expanded ? ' is-expanded' : ''}`}>
                  <button type="button" onClick={() => openWarningStudentAvailability(student)} aria-expanded={expanded} aria-label={`Mở lịch rảnh của ${student.name}`}>
                  <AlertTriangle /><div><span className="schedule-warning-student__title"><strong>{student.name}</strong>{missing > 0 && <b>Thiếu {missing}</b>}</span><span className="schedule-warning-student__meta"><small className={`schedule-warning-cause-label is-${warningCause}`}>{warningCauseLabel(warningCause)}</small><b>{student.eligibleForWeek ? `${scheduledSessions}/${student.sessionsPerWeek} buổi${crossBranchScheduledSessions > 0 ? ` · +${crossBranchScheduledSessions} CS khác` : ''}` : 'Chưa đủ điều kiện'}</b></span><em className="schedule-warning-primary">{primaryReasons.length ? primaryReasons.map(diagnosticReasonLabel).join(' · ') : diagnosticReasonLabel(primaryReasonCode)}</em></div><ChevronRight />
                </button>
                {expanded && <div className="schedule-warning-detail schedule-warning-detail--compact">
                  <section className="is-wide schedule-warning-action"><small>Hướng xử lý</small><strong>{diagnosticActionLabel(actionCode)}</strong></section>
                  <section className="is-wide is-suggestion"><small>Ca có thể xử lý</small><div>{topCandidates.length ? topCandidates.slice(0, 2).map((slot) => {
                    const trainerNamesForSlot = slot.availableTrainerIds?.map((trainerId) => workspace.trainers.find((trainer) => trainer.id === trainerId)?.name).filter(Boolean).join(', ')
                    return <button type="button" key={slot.slotId} onClick={() => openDiagnosticSlot(slot)}><span>{scheduleSlotLabel(slot.slotId, weekDates)}</span><b>{trainerNamesForSlot || slot.blockerCodes?.slice(0, 1).map(diagnosticReasonLabel).join('')}</b><ChevronRight size={13} /></button>
                  }) : suggestedSlots.length ? suggestedSlots.slice(0, 2).map((slot) => <span key={slot}>{scheduleSlotLabel(slot, weekDates)}</span>) : <em>Chưa có ca phù hợp</em>}</div></section>
                </div>}
              </article>
            })}
            {warningFilter === 'priority' && !warningProfiles.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không còn cảnh báo.</div>}
            {warningFilter === 'contract' && !contractWarningProfiles.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có cảnh báo hợp đồng.</div>}
            {warningFilter === 'learner' && !learnerWarningProfiles.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có cảnh báo lịch rảnh.</div>}
            {warningFilter === 'capacity' && !capacityWarningProfiles.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có cảnh báo thiếu PT / ca.</div>}
            {warningFilter === 'system' && !systemWarningProfiles.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không còn mục cần tối ưu.</div>}
            {warningFilter === 'conflict' && !scheduleConflictWarnings.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có lịch trùng hoặc xung đột.</div>}
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
        <div className="schedule-inspector-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setInspectorSlotId(null); setPendingManualCandidate(null); setPendingMove(null); setPendingAdminRemoval(null); setAdminEditReason(''); setHistoricalReason('') } }}>
          <aside ref={activeDialogRef} className="schedule-inspector" role="dialog" aria-modal="true" aria-label="Chỉnh ô lịch">
            <header><div><p>{DAY_LABELS[inspectorSlotId.split('-')[0]]} · {String(inspectorSlotId.split('-')[1]).padStart(2, '0')}:00</p><h2>{selectedTrainer.name}</h2><span>{inspectorSlotIsPast ? 'Ca đã qua giờ · điều chỉnh có audit' : `Sức chứa ${inspectorEntries.filter((entry) => entry.type !== 'off').length}/${selectedTrainer.slotCapacity}`}</span></div><button type="button" aria-label="Đóng" onClick={() => { setInspectorSlotId(null); setPendingManualCandidate(null); setPendingMove(null); setPendingAdminRemoval(null); setAdminEditReason(''); setHistoricalReason('') }}><X /></button></header>
            <div className="schedule-inspector__body">
              {inspectorSlotIsPast && <div className="schedule-inspector__past-note"><History size={18} /><div><strong>Điều chỉnh ca đã qua</strong><p>Admin có thể bổ sung, đổi hoặc gỡ ca nhanh trên ma trận. Buổi mới ghi vào lịch sử; thay đổi buổi đã có được đồng bộ với session thật và lưu audit.</p></div></div>}
              <section><div className="schedule-inspector__section-title"><strong>Trong ca</strong><span>{inspectorEntries.some((entry) => entry.type === 'off') ? 'PT nghỉ' : `${inspectorEntries.filter((entry) => entry.type !== 'off').length} học viên`}</span></div>
                {inspectorEntries.filter((entry) => entry.type !== 'off').map((entry) => {
                  const assignmentWarning = trainerAssignmentWarningKeys.has(`${inspectorSlotId}|${entry.studentId}|${entry.trainerId}`)
                  const adminWarning = entry.adminOverride === true
                  return <article className={`schedule-assigned-row${assignmentWarning ? ' has-assignment-warning' : ''}${adminWarning ? ' has-admin-warning' : ''}`} key={entry.studentId}>
                    <div><strong>{studentName(entry.studentId)}{entry.sessionKind === 'makeup' && <small> · BÙ</small>}{(assignmentWarning || adminWarning) && <AlertTriangle size={14} aria-label="Có cảnh báo" />}</strong><span>{entry.sessionKind === 'makeup' ? `Buổi bù · ${entry.makeupMode === 'paired_existing_shift' ? 'ghép vào ca có sẵn' : 'ca bù riêng'} · không trừ thêm buổi · không tính hoa hồng` : adminWarning ? `Admin xếp tay · ${(entry.adminOverrideWarnings || []).map(ptScheduleConflictLabel).join(' · ') || 'có cảnh báo'}` : assignmentWarning ? 'PT hỗ trợ ngoài danh sách PT chính/phụ' : entry.source === 'published_existing' ? 'Đã ghi nhận · điều chỉnh qua lịch sử' : entry.isLocked ? 'Đã khóa khỏi auto-arrange' : entry.source === 'manual_v2' ? 'Xếp tay · được giữ khi tối ưu' : 'Có thể xếp lại'}</span></div>
                    <div>
                      <button type="button" title={entry.isLocked ? 'Mở khóa' : 'Khóa'} disabled={busy || inspectorSlotIsPast} onClick={() => void runCommand(entry.isLocked ? 'unlock_entry' : 'lock_entry', { slotId: inspectorSlotId, trainerId: selectedTrainerId, studentId: entry.studentId })}>{entry.isLocked ? <Unlock /> : <Lock />}</button>
                      <button type="button" title="Chuyển ca" aria-label={`Chuyển ca của ${studentName(entry.studentId)}`} disabled={busy || (!isAdmin && (inspectorSlotIsPast || entry.isLocked || entry.source === 'published_existing'))} onClick={() => { setPendingAdminRemoval(null); setAdminEditReason(''); setPendingMove({ studentId: entry.studentId, fromSlotId: inspectorSlotId!, fromTrainerId: selectedTrainerId, slotId: inspectorSlotId!, trainerId: selectedTrainerId }) }}><CalendarRange /></button>
                      <button type="button" className="is-remove" title={isAdmin ? 'Gỡ buổi và cập nhật session' : 'Gỡ khỏi draft'} disabled={busy || (!isAdmin && (inspectorSlotIsPast || entry.isLocked || entry.source === 'published_existing'))} onClick={() => void removeStudentFromSlot(entry.studentId, inspectorSlotId!, selectedTrainerId)}><X /></button>
                    </div>
                  </article>
                })}
                {!inspectorEntries.filter((entry) => entry.type !== 'off').length && !inspectorEntries.some((entry) => entry.type === 'off') && <div className="schedule-inspector__empty">Ca đang trống.</div>}
                {!inspectorSlotIsPast && (inspectorEntries.some((entry) => entry.type === 'off') ? <button className="schedule-off-action" type="button" disabled={busy} onClick={() => void runCommand('clear_trainer_off', { slotId: inspectorSlotId, trainerId: selectedTrainerId }, 'Mở lại ca PT')}>Mở lại ca</button> : !offConfirmation ? <button className="schedule-off-action" type="button" onClick={() => setOffConfirmation(true)}><CalendarOff /> Đánh dấu PT nghỉ</button> : <div className="schedule-off-confirm"><strong>Đưa {inspectorEntries.filter((entry) => entry.type !== 'off').length} học viên về danh sách chưa xếp?</strong><p>Lịch sử thay đổi và lý do sẽ được lưu audit.</p><div><button type="button" onClick={() => setOffConfirmation(false)}>Quay lại</button><button type="button" disabled={busy} onClick={() => void runCommand('set_trainer_off', { slotId: inspectorSlotId, trainerId: selectedTrainerId, disposition: 'requeue' }, 'PT nghỉ, đưa học viên về hàng chờ')}>Xác nhận PT nghỉ</button></div></div>)}
              </section>

              {(isAdmin || !inspectorSlotIsPast) && pendingMove && <section className="schedule-move-form" aria-label="Chuyển ca nháp">
                <strong>{pendingMoveRequiresAdminEdit ? 'Admin điều chỉnh ca' : 'Chuyển ca'} · {studentName(pendingMove.studentId)}</strong>
                <label>Ca đích<select aria-label="Ca đích" value={pendingMove.slotId} onChange={(e) => setPendingMove({ ...pendingMove, slotId: e.target.value })} disabled={busy}>{workingDays.flatMap((day) => workingHours.map((hour) => <option key={`${day}-${hour}`} value={`${day}-${hour}`}>{scheduleSlotLabel(`${day}-${hour}`, weekDates)}</option>))}</select></label>
                <label>PT đích<select aria-label="PT đích" value={pendingMove.trainerId} onChange={(e) => setPendingMove({ ...pendingMove, trainerId: e.target.value })} disabled={busy}>{visibleTrainers.map((trainer) => <option key={trainer.id} value={trainer.id}>{trainer.name}</option>)}</select></label>
                {!workspace.students.find((item) => item.id === pendingMove.studentId)?.availableSlots.includes(pendingMove.slotId) && <p role="status">Ngoài lịch rảnh đã đăng ký. Xác nhận chuyển ca sẽ ghi nhận ngoại lệ này.</p>}
                <p>{pendingMoveRequiresAdminEdit ? 'Admin có thể điều chỉnh nhanh; các xung đột lịch sẽ được ghi thành cảnh báo. Chỉ dữ liệu điểm danh, billing và quyền truy cập vẫn được bảo toàn.' : 'Máy chủ kiểm tra PT, hợp đồng và sức chứa. Ca cũ chỉ được chuyển khi ca mới hợp lệ.'}</p>
                {pendingMoveRequiresAdminEdit && <p className="schedule-admin-fast-note">Lịch đã publish tự cập nhật, không cần Publish lại. Ô chưa có session sẽ tạo session mới.</p>}
                <button type="button" onClick={() => setPendingMove(null)} disabled={busy}>Hủy chuyển</button>
                <button type="button" onClick={() => void confirmMove()} disabled={busy || pendingMove.fromSlotId === pendingMove.slotId && pendingMove.fromTrainerId === pendingMove.trainerId}>Xác nhận chuyển ca</button>
              </section>}
              {pendingAdminRemoval && <section className="schedule-move-form is-admin-edit" aria-label="Xác nhận gỡ buổi">
                <strong>Gỡ buổi · {studentName(pendingAdminRemoval.studentId)}</strong>
                <p>{isAdmin ? 'Lịch đã publish tự cập nhật, không cần Publish lại. Session thật sẽ được hủy; ô chỉ có trong draft được gỡ ngay. Buổi đã điểm danh hoặc tính buổi vẫn được bảo vệ.' : 'Học viên sẽ được đưa khỏi lịch nháp hiện tại.'}</p>
                {isAdmin && <p className="schedule-admin-fast-note">Gỡ buổi không cần nhập lý do; hệ thống vẫn lưu người thao tác và thời điểm.</p>}
                <div className="schedule-move-actions"><button type="button" onClick={() => setPendingAdminRemoval(null)} disabled={busy}>Hủy</button><button type="button" onClick={() => void confirmRemove()} disabled={busy}>Xác nhận gỡ buổi</button></div>
              </section>}
              {!inspectorEntries.some((entry) => entry.type === 'off') && <section>
                <div className="schedule-inspector__section-title"><strong>{inspectorSlotIsPast ? 'Bổ sung học viên đã tập' : 'Thêm học viên'}</strong><span>{inspectorSlotIsPast ? 'Đối chiếu theo ngày thực tế' : 'Rảnh đúng ca được ưu tiên'}</span></div>
                <label className="schedule-candidate-search"><Search /><input value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder={isAdmin ? 'Tên hoặc SĐT · tìm cả cơ sở khác' : 'Tên hoặc số điện thoại'} /></label>
                {candidateLoading && <div className="schedule-candidate-sync"><RefreshCw className="is-spinning" /> Aura đang đối chiếu điều kiện trên máy chủ…</div>}
                {inspectorSlotIsPast && <label className="schedule-history-reason"><span>Lý do bổ sung <b>*</b></span><textarea value={historicalReason} maxLength={300} onChange={(event) => setHistoricalReason(event.target.value)} placeholder="Ví dụ: PT xác nhận đã dạy nhưng ca chưa được ghi nhận trên hệ thống" /><small>{historicalReason.trim().length}/8 ký tự tối thiểu · lưu cùng nhật ký audit</small></label>}
                {inspectorSlotIsPast && pendingManualCandidate && pendingManualCandidate.reasons.length > 0 && <div className="schedule-manual-override-confirm"><AlertTriangle /><div><strong>Ca có lưu ý cần xác nhận</strong><p>{pendingManualCandidate.reasons.map(ptScheduleConflictLabel).join(' · ')} Lý do phía trên sẽ được lưu cùng các ngoại lệ này.</p></div></div>}
                {pendingManualCandidate && !candidateMatchesStudentAvailability(pendingManualCandidate) && <div className="schedule-manual-override-confirm"><AlertTriangle /><div><strong>{pendingManualCandidate.name} nằm ngoài lịch rảnh</strong><p>{ptScheduleConflictLabel(pendingManualCandidate.availabilityReason || pendingManualCandidate.reasons[0])} Chỉ ghi lịch sau khi bạn bấm xác nhận; thao tác ngoại lệ được lưu audit.</p></div></div>}
                {pendingManualCandidate?.trainerAssignmentWarning && <div className="schedule-assignment-confirm"><AlertTriangle /><div><strong>{selectedTrainer.name} là PT hỗ trợ</strong><p>Học viên có PT chính/phụ khác. Ca vẫn được phép xếp vì cùng chi nhánh và sẽ hiển thị cảnh báo trên lịch.</p></div></div>}
                {pendingManualCandidate?.studentBranchWarning && <div className="schedule-branch-confirm"><AlertTriangle /><div><strong>Xác nhận tập khác cơ sở</strong><p>{pendingManualCandidate.name} thuộc {branches.find((item) => item.id === pendingManualCandidate.studentHomeBranchId)?.name || 'cơ sở khác'} và sẽ tập tại {branches.find((item) => item.id === branchId)?.name || 'cơ sở đang xếp'}. Ca được chấp nhận sau nút xác nhận và được lưu audit.</p></div></div>}
                <div className="schedule-candidate-list">{candidateGroups.map((group) => group.items.length > 0 && <section className={`schedule-candidate-group is-${group.key}`} key={group.key}>
                  <header><strong>{group.label}</strong><span>{group.items.length} · {group.hint}</span></header>
                  {group.items.map((candidate) => {
                    const manualSelectable = candidateCanBeManuallyScheduled(candidate, isAdmin)
                    const outsideAvailability = !candidateMatchesStudentAvailability(candidate)
                    const selected = pendingManualCandidate?.studentId === candidate.studentId
                    const assignmentNote = candidate.trainerAssignmentWarning ? ' · PT hỗ trợ ngoài danh sách chính/phụ' : ''
                    const branchNote = candidate.studentBranchWarning
                      ? ` · Khác cơ sở (${branches.find((item) => item.id === candidate.studentHomeBranchId)?.name || 'hồ sơ khác'})`
                      : ''
                    const candidateText = inspectorSlotIsPast
                      ? candidate.eligible
                        ? `Hợp đồng đúng ngày · còn buổi · khớp lịch rảnh${assignmentNote}${branchNote}`
                        : manualSelectable
                          ? `${candidate.reasons.map(ptScheduleConflictLabel).join(' · ')} · có thể bổ sung kèm audit${assignmentNote}${branchNote}`
                          : `${candidate.reasons.map(ptScheduleConflictLabel).join(' · ')}${branchNote}`
                      : candidate.eligible
                        ? `Đã đăng ký rảnh đúng ca này${assignmentNote}${branchNote}`
                        : manualSelectable && outsideAvailability
                          ? `${ptScheduleConflictLabel(candidate.availabilityReason || candidate.reasons[0])} · Có thể xếp tay${assignmentNote}${branchNote}`
                          : `${candidate.reasons.map(ptScheduleConflictLabel).join(' · ')}${branchNote}`
                    const adminConflictNote = isAdmin && !candidate.eligible
                      ? ` · Admin có thể xếp, sẽ ghi cảnh báo${candidate.reasons.length ? `: ${candidate.reasons.map(ptScheduleConflictLabel).join(' · ')}` : ''}`
                      : ''
                    const immediate = canPlaceManualCandidateImmediately(candidate)
                    return <article key={candidate.studentId} className={`${candidate.eligible ? 'is-eligible' : manualSelectable ? 'is-override' : 'is-disabled'}${candidate.trainerAssignmentWarning ? ' has-assignment-warning' : ''}${candidate.studentBranchWarning ? ' has-branch-warning' : ''}${selected ? ' is-selected' : ''}`}><div><strong>{candidate.name}{(candidate.trainerAssignmentWarning || candidate.studentBranchWarning || (isAdmin && !candidate.eligible)) && <AlertTriangle size={13} aria-label="Ca cần xác nhận" />}</strong><span>{candidateText}{adminConflictNote}</span></div><button type="button" aria-label={immediate ? `Xếp ngay ${candidate.name}` : selected ? `Bỏ chọn ${candidate.name}` : `Chọn ${candidate.name}`} aria-pressed={selected} disabled={!manualSelectable || busy || !isAdmin && inspectorEntries.filter((entry) => entry.type !== 'off').length >= selectedTrainer.slotCapacity} onClick={() => { if (immediate) { setPendingManualCandidate(null); void confirmManualCandidate(candidate) } else setPendingManualCandidate((current) => current?.studentId === candidate.studentId ? null : candidate) }}>{selected ? <CheckCircle2 /> : <UserPlus />}</button></article>
                  })}
                </section>)}</div>
              </section>}
            </div>
            {!inspectorEntries.some((entry) => entry.type === 'off') && <footer className="schedule-manual-confirm"><div>{pendingManualCandidate ? <><span>{inspectorSlotIsPast ? 'Bổ sung lịch sử' : 'Đang chọn'}</span><strong>{pendingManualCandidate.name}</strong></> : <><span>Chưa chọn học viên</span><strong>Chọn một hồ sơ ở trên</strong></>}</div><button type="button" onClick={() => setPendingManualCandidate(null)} disabled={!pendingManualCandidate || busy}>Hủy</button><button type="button" className="is-confirm" disabled={!pendingManualCandidate || busy || (inspectorSlotIsPast && historicalReason.trim().length < 8)} onClick={() => void (inspectorSlotIsPast ? confirmHistoricalCandidate() : confirmManualCandidate())}>{busy ? 'Đang xác nhận…' : inspectorSlotIsPast ? 'Ghi nhận ca bổ sung' : pendingManualCandidate && !candidateMatchesStudentAvailability(pendingManualCandidate) ? 'Xác nhận ngoại lệ & xếp ca' : 'Xác nhận xếp ca'}</button></footer>}
          </aside>
        </div>
      )}

      {publishPreview && <div className="schedule-publish-backdrop"><section ref={activeDialogRef} className="schedule-publish-dialog" role="dialog" aria-modal="true" aria-labelledby="branch-publish-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">AURA PT · XÁC NHẬN</p><h2 id="branch-publish-title">Publish v{publishPreview.version}?</h2><p>Session đã tính buổi hoặc xác nhận được khóa bất biến. Toàn bộ diff còn lại chạy trong một transaction.</p><div className="schedule-publish-diff"><div><strong>{publishPreview.diff.create}</strong><span>Tạo mới</span></div><div><strong>{publishPreview.diff.update}</strong><span>Điều chỉnh</span></div><div><strong>{publishPreview.diff.cancel}</strong><span>Hủy</span></div><div><strong>{publishPreview.diff.unchanged}</strong><span>Giữ nguyên</span></div></div>{publishPreview.warnings.length > 0 && <div className="schedule-publish-warnings"><AlertTriangle size={17} /><div><strong>{publishPreview.warnings.length} lưu ý không chặn publish</strong><span>{publishPreview.warnings.map(ptScheduleConflictLabel).join(' · ')}</span></div></div>}{publishPreview.warnings.includes('STUDENT_BRANCH_MISMATCH') && <label className="schedule-publish-branch-ack"><input type="checkbox" checked={publishCrossBranchConfirmed} onChange={(event) => setPublishCrossBranchConfirmed(event.target.checked)} /><span><strong>Xác nhận lịch khác cơ sở</strong><small>{publishPreview.warningDetails?.filter((item) => item.code === 'STUDENT_BRANCH_MISMATCH').map((item) => `${item.studentName || 'Học viên'}: ${branches.find((branch) => branch.id === item.studentHomeBranchId)?.name || 'cơ sở hồ sơ'} → ${branches.find((branch) => branch.id === item.targetBranchId)?.name || workspace?.branch.name || 'cơ sở tập'}`).join(' · ') || 'Các học viên được đánh dấu sẽ tập tại cơ sở đang publish.'}</small></span></label>}<div className="schedule-publish-dialog__actions"><button type="button" onClick={() => { setPublishPreview(null); setPublishCrossBranchConfirmed(false) }}>Quay lại</button><button type="button" onClick={() => void confirmPublish()} disabled={busy || (publishPreview.warnings.includes('STUDENT_BRANCH_MISMATCH') && !publishCrossBranchConfirmed)}>{busy ? 'Đang publish…' : `Publish v${publishPreview.version}`}</button></div></section></div>}

      {resetDraftOpen && <div className="schedule-publish-backdrop"><section ref={activeDialogRef} className="schedule-publish-dialog" role="alertdialog" aria-modal="true" aria-labelledby="branch-reset-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">AURA PT · ĐẶT LẠI DRAFT</p><h2 id="branch-reset-title">Xếp lại từ đầu tuần này?</h2><p>Gỡ {draftResetSummary.resettableEntries} buổi nháp của {draftResetSummary.affectedStudents} học viên. {draftResetSummary.protectedEntries} ca OFF, ca khóa hoặc session đã publish vẫn được giữ nguyên.</p><div className="schedule-publish-dialog__actions"><button type="button" onClick={() => setResetDraftOpen(false)}>Quay lại</button><button type="button" onClick={() => void resetDraft()} disabled={busy}>{busy ? 'Đang đặt lại…' : 'Đặt lại draft'}</button></div></section></div>}

      {restoreCandidate && history && <div className="schedule-publish-backdrop"><section ref={activeDialogRef} className="schedule-publish-dialog" role="alertdialog" aria-modal="true" aria-labelledby="branch-restore-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">KHÔI PHỤC AN TOÀN</p><h2 id="branch-restore-title">Tạo draft từ v{restoreCandidate.version}?</h2><p>Phiên bản đã publish vẫn bất biến. Lịch được sao chép thành draft revision mới để kiểm tra lại.</p><div className="schedule-publish-dialog__actions"><button type="button" onClick={() => setRestoreCandidate(null)}>Quay lại</button><button type="button" onClick={() => void restoreVersion()} disabled={busy}>Tạo draft mới</button></div></section></div>}
    </div>
  )
}
