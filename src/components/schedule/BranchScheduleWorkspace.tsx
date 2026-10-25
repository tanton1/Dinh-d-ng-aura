import { lazy, startTransition, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  MoreHorizontal,
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
import { doc, onSnapshot, type DocumentData, type DocumentSnapshot } from 'firebase/firestore'
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
  getPtScheduleWeeklyView,
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
  type PtScheduleQuickCoverage,
  type PtScheduleStudentCoverage,
  type PtScheduleStudentFeasibility,
  type PtScheduleTrainerDailyLoad,
  type PtScheduleUnassignedEntry,
  type PtSchedulePublishResult,
  type PtScheduleSlotCandidate,
  type PtScheduleVersionListResult,
  type PtScheduleVersionSummary,
  type PtScheduleWorkspaceV2Result,
  type PtScheduleWeeklyViewResult,
} from '../../services/ptSchedulePublishService'
import '../../styles-branch-schedule.css'
import { trainerDailyLoadTarget } from '../../config/scheduleLoadPolicy'
import { useScheduleOpportunities } from '../../features/schedule/useScheduleOpportunities'
import { measureScheduleTask } from '../../features/schedule/performance'
import { hasActionableSearchLimit } from '../../features/schedule/searchLimit'
import { loadWorkspaceRequest } from '../../features/schedule/workspaceCache'
import { applyWeeklyValidation, mergeWeeklyControl } from '../../features/schedule/weeklyValidation'
import { approvedOffForWeek, approvedOffOnDate, validScheduledCount, validOtherBranchCount } from '../../features/schedule/weeklyOff'

interface Props {
  accessContext: AccessContext
  onNavigate?: (view: 'admin-pt-students' | 'admin-training-history') => void
}

// Warning profiles are collapsed on the initial paint. Keep their verbose
// contact/quota/availability panel out of the workspace chunk until an admin
// actually expands a warning.
const ScheduleWarningsPanel = lazy(() => import('./WeeklyScheduleWarningsPanel'))
// History/restore is an explicit secondary tool, not needed to paint or edit
// the current week. Load its list/dialog only when that tool is opened.
const ScheduleHistoryPanel = lazy(() => import('./ScheduleHistoryPanel'))
const ScheduleResetDialog = lazy(() => import('./ScheduleResetDialog'))
const SchedulePublishDialog = lazy(() => import('./SchedulePublishDialog'))
const ScheduleAvailabilityEditor = lazy(() => import('./ScheduleAvailabilityEditor'))
const ScheduleOptimizationResult = lazy(() => import('./ScheduleOptimizationResult'))
const ScheduleStudentSummary = lazy(() => import('./ScheduleStudentSummary'))
const ScheduleStudentSearchResults = lazy(() => import('./ScheduleStudentSearchResults'))

import {
  APP_UPDATE_READY_EVENT,
  APP_UPDATE_READY_KEY,
  CONFIRMED_AVAILABILITY_STATUSES,
  CONTRACT_WARNING_REASONS,
  DAY_LABELS,
  LEARNER_WARNING_REASONS,
  MIN_WEEK_OFFSET,
  TRAINER_LOAD_LABELS,
  availabilityDayCount,
  candidateCanBeManuallyScheduled,
  candidateMatchesStudentAvailability,
  commandKey,
  compareScheduleSlots,
  currentVietnamDateKey,
  diagnosticReasonLabel,
  finiteCount,
  getCachedBranchCatalog,
  localSlotCandidates,
  normalizedTrainerLoadStatus,
  readWorkspaceCache,
  scheduleSlotIsPast,
  scheduleSlotLabel,
  trainerEmploymentLabel,
  warningCauseFor,
  warningReasonPriority,
  workspaceFromDraftSnapshot,
  workspaceFromWeeklyViewSnapshot,
  workspaceRealtimeFingerprint,
  writeWorkspaceCache,
  isTrainerLocked,
  type StudentFilter,
  type WarningCause,
  type WarningFilter,
  type WorkspaceSyncState,
  type WorkspaceTab,
  normalizeScheduleSearchText,
} from '../../features/schedule/workspaceModel'

const stringList = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string')
  : []
const monotonicNow = () => typeof performance !== 'undefined' ? performance.now() : Date.now()
const availableTrainerId = (trainers: PtScheduleWorkspaceV2Result['trainers'], current: string) => trainers.some((trainer) => trainer.id === current && !isTrainerLocked(trainer))
  ? current
  : trainers.find((trainer) => !isTrainerLocked(trainer))?.id || ''

function normalizeWeeklyViewResult(
  result: PtScheduleWeeklyViewResult,
  fallback: PtScheduleWorkspaceV2Result | null,
): PtScheduleWorkspaceV2Result {
  if (fallback) return workspaceFromWeeklyViewSnapshot(fallback, result)
  const raw = result as Record<string, unknown>
  const source = raw.workspace && typeof raw.workspace === 'object' && !Array.isArray(raw.workspace)
    ? raw.workspace as Record<string, unknown>
    : raw
  const sourceBranch = source.branch && typeof source.branch === 'object' ? source.branch as Record<string, unknown> : null
  const branchId = typeof source.branchId === 'string' ? source.branchId : typeof sourceBranch?.id === 'string' ? sourceBranch.id : ''
  if (!branchId || typeof source.weekId !== 'string' || !source.schedule || !Array.isArray(source.students) || !Array.isArray(source.trainers)) {
    throw new Error('Weekly schedule view chưa có snapshot đầy đủ để hiển thị.')
  }
  const freshness = typeof raw.freshness === 'string'
    ? raw.freshness
    : typeof source.freshness === 'string' ? source.freshness : undefined
  const pending = raw.rebuilding === true || source.dirty === true || freshness === 'stale'
  const readMode = !pending && source.partial !== true && (source.readMode === 'reconciled' || freshness === 'verified') ? 'reconciled' : 'display'
  const draft = source.draft && typeof source.draft === 'object' ? source.draft as Record<string, unknown> : {}
  const branchName = typeof source.branchName === 'string' ? source.branchName : typeof sourceBranch?.name === 'string' ? sourceBranch.name : branchId
  const students = (source.students as Array<Record<string, unknown>>).map((student) => {
    const status = typeof student.status === 'string' ? student.status : 'active'
    const sessionsPerWeek = Number(student.sessionsPerWeek || 0)
    const availableSlots = stringList(student.availableSlots)
    const crossBranch = student.crossBranch === true || (student.branchId && student.branchId !== branchId)
    return {
      ...student,
      id: String(student.id || ''),
      name: typeof student.name === 'string' && student.name ? student.name : 'Chưa cập nhật tên',
      phone: typeof student.phone === 'string' ? student.phone : '',
      email: typeof student.email === 'string' ? student.email : '',
      status,
      branchId: typeof student.branchId === 'string' ? student.branchId : branchId,
      availableSlots,
      sessionsPerWeek,
      defaultSessionsPerWeek: Number(student.defaultSessionsPerWeek ?? sessionsPerWeek),
      availabilityStatus: typeof student.availabilityStatus === 'string' ? student.availabilityStatus : 'missing',
      availabilityRevision: Number(student.availabilityRevision || 0),
      eligibleForWeek: typeof student.eligibleForWeek === 'boolean' ? student.eligibleForWeek : status === 'active' && !crossBranch,
      eligibilityReasons: stringList(student.eligibilityReasons),
      eligibleContractIds: stringList(student.eligibleContractIds),
      validScheduleDates: stringList(student.validScheduleDates),
      pausedScheduleDates: stringList(student.pausedScheduleDates),
      contractEndDate: typeof student.contractEndDate === 'string' ? student.contractEndDate : (student.contract as { endDate?: string } | undefined)?.endDate || null,
      remainingSchedulableSessions: Number(student.remainingSchedulableSessions ?? student.remainingSessions ?? 0),
      activeScheduledSessions: Number(student.activeScheduledSessions ?? student.scheduledSessions ?? 0),
      activeScheduledThisWeek: Number(student.activeScheduledThisWeek ?? student.scheduledSessions ?? 0),
      maxWeeklySessions: Number(student.maxWeeklySessions ?? Math.max(0, sessionsPerWeek)),
      schedulableSessionsThisWeek: Number(student.schedulableSessionsThisWeek ?? Math.max(0, sessionsPerWeek)),
      weeklySessionTargetOverride: typeof student.weeklySessionTargetOverride === 'number' ? student.weeklySessionTargetOverride : null,
      weeklySessionTargetOverridden: student.weeklySessionTargetOverridden === true,
      isCrossBranchDisplayOnly: Boolean(crossBranch),
      studentHomeBranchId: typeof student.homeBranchId === 'string' ? student.homeBranchId : (typeof student.branchId === 'string' ? student.branchId : branchId),
    }
  }) as PtScheduleWorkspaceV2Result['students']
  const trainers = (source.trainers as Array<Record<string, unknown>>).map((trainer) => ({
    ...trainer,
    id: String(trainer.id || ''),
    name: typeof trainer.name === 'string' && trainer.name ? trainer.name : 'PT chưa cập nhật tên',
    branchId: typeof trainer.branchId === 'string' ? trainer.branchId : branchId,
    status: typeof trainer.status === 'string' ? trainer.status : 'active',
    availableSlots: stringList(trainer.availableSlots),
    availabilityMode: trainer.availabilityMode === 'configured' || trainer.availabilityMode === 'unrestricted' ? trainer.availabilityMode : 'unconfigured',
    availabilityRevision: Number(trainer.availabilityRevision || 0),
    slotCapacity: Number(trainer.slotCapacity || 2),
    commissionRate: Number(trainer.commissionRate || 0),
  })) as PtScheduleWorkspaceV2Result['trainers']
  const compactSummary = source.summary && typeof source.summary === 'object' ? source.summary as Record<string, unknown> : {}
  const draftRevision = Number(draft.revision ?? source.draftRevision ?? 0)
  const publishedVersion = Number(draft.publishedVersion ?? source.publishedVersion ?? 0)
  const normalizedWorkspace: PtScheduleWorkspaceV2Result = {
    ...(source as unknown as PtScheduleWorkspaceV2Result),
    branch: { id: branchId, name: branchName, status: sourceBranch?.status === 'archived' ? 'archived' : 'active' },
    weekId: source.weekId,
    draftRevision,
    publishedVersion,
    publishedRevision: Number(draft.publishedRevision ?? source.publishedRevision ?? -1),
    draftStatus: draft.status === 'published' || source.draftStatus === 'published' ? 'published' : 'draft',
    schedule: Object.fromEntries(Object.entries(source.schedule as Record<string, unknown>).map(([slotId, entries]) => [slotId, Array.isArray(entries)
      ? entries.map((entry) => ({
          ...(entry as Record<string, unknown>),
          studentId: String((entry as Record<string, unknown>).studentId || ''),
          trainerId: String((entry as Record<string, unknown>).trainerId || ''),
          type: (entry as Record<string, unknown>).type === 'off' ? 'off' : 'training',
          adminOverrideWarnings: Array.isArray((entry as Record<string, unknown>).warningCodes)
            ? stringList((entry as Record<string, unknown>).warningCodes)
            : undefined,
        }))
      : []])),
    students,
    trainers,
    contracts: Array.isArray(source.contracts) ? source.contracts as PtScheduleWorkspaceV2Result['contracts'] : [],
    sessions: [],
    scheduleConfig: source.scheduleConfig && typeof source.scheduleConfig === 'object'
      ? source.scheduleConfig as PtScheduleWorkspaceV2Result['scheduleConfig']
      : {
          workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
          workingHours: Array.from({ length: 16 }, (_, index) => index + 6),
        },
    summary: {
      eligibleStudents: Number(compactSummary.eligibleStudents ?? students.filter((student) => student.eligibleForWeek).length),
      trainers: Number(compactSummary.trainers ?? trainers.length),
      unconfiguredTrainers: trainers.filter((trainer) => trainer.availabilityMode === 'unconfigured').length,
      scheduledEntries: Number(compactSummary.scheduledEntries ?? 0),
      missingSessions: Number(compactSummary.missingSessions ?? 0),
      unassignedEntries: Number(compactSummary.unassignedEntries ?? compactSummary.warningCount ?? 0),
    },
    warnings: Array.isArray(source.warnings) ? source.warnings as PtScheduleWorkspaceV2Result['warnings'] : [],
    unassignedEntries: Array.isArray(source.unassignedEntries) ? source.unassignedEntries as PtScheduleWorkspaceV2Result['unassignedEntries'] : [],
    optimizationSummary: source.optimizationSummary && typeof source.optimizationSummary === 'object'
      ? source.optimizationSummary as PtScheduleWorkspaceV2Result['optimizationSummary']
      : undefined,
    weeklySessionCoverage: source.weeklySessionCoverage && typeof source.weeklySessionCoverage === 'object'
      ? source.weeklySessionCoverage as PtScheduleWorkspaceV2Result['weeklySessionCoverage']
      : {},
    partial: readMode !== 'reconciled',
    readMode,
    reconciliationState: readMode === 'reconciled' ? 'current' : 'not_loaded',
    weeklyViewRevision: Number(raw.viewRevision ?? source.viewRevision ?? 0),
    weeklyViewDirtyGeneration: typeof source.dirtyGeneration === 'number' ? source.dirtyGeneration : undefined,
    weeklyViewSourceRevision: typeof (raw.sourceRevision ?? source.sourceRevision) === 'string'
      ? String(raw.sourceRevision ?? source.sourceRevision)
      : Number(raw.sourceRevision ?? source.sourceRevision ?? draftRevision),
    weeklyViewFreshness: pending ? 'stale' : freshness,
    weeklyViewGeneratedAt: typeof raw.generatedAt === 'string'
      ? raw.generatedAt
      : typeof source.generatedAt === 'string' ? source.generatedAt : null,
  }
  return applyWeeklyValidation(normalizedWorkspace, source)
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

export default function BranchScheduleWorkspace({ accessContext, onNavigate }: Props) {
  const [branches, setBranches] = useState<PtScheduleBranchOption[]>([])
  const [branchId, setBranchId] = useState(accessContext.branchIds[0] || '')
  const [branchCatalogState, setBranchCatalogState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [branchCatalogError, setBranchCatalogError] = useState<string | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [workspace, setWorkspaceState] = useState<PtScheduleWorkspaceV2Result | null>(null)
  const [selectedTrainerId, setSelectedTrainerId] = useState('')
  const [tab, setTab] = useState<WorkspaceTab>('matrix')
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
  const [syncState, setRawSyncState] = useState<WorkspaceSyncState>('connecting')
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
  const busyRef = useRef(false)
  const hoverClearTimer = useRef<number | null>(null)
  const workspaceRequestRef = useRef<{ scope: string; forceAvailabilityRefresh: boolean; reconcile: boolean; promise: Promise<void> } | null>(null)
  const workspaceRequestVersionRef = useRef(0)
  const weeklyRefreshPendingRef = useRef<{ scope: string; pending: boolean }>({ scope: '', pending: false })
  const weeklyControlStatusRef = useRef<{ scope: string; status: 'disabled' | 'pending' | 'ready' | 'error' }>({ scope: '', status: 'disabled' })
  const activeWorkspaceScopeRef = useRef('')
  const latestDraftRef = useRef<{ scope: string; value: Record<string, unknown> } | null>(null)
  const draftSubscriptionFailedRef = useRef('')
  const setSyncState = useCallback((next: WorkspaceSyncState | ((current: WorkspaceSyncState) => WorkspaceSyncState)) => {
    setRawSyncState((current) => {
      const control = weeklyControlStatusRef.current
      // A successful point read, draft fallback or late payload callback does
      // not repair a terminal control subscription error. Only a new scope or
      // a server-confirmed control callback can lift this transport state.
      if (control.scope === activeWorkspaceScopeRef.current && control.status === 'error') return 'offline'
      if (draftSubscriptionFailedRef.current === activeWorkspaceScopeRef.current) return 'offline'
      return typeof next === 'function' ? next(current) : next
    })
  }, [])
  const moreMenuRef = useRef<HTMLDetailsElement | null>(null)
  const activeDialogRef = useRef<HTMLElement | null>(null)
  const workspaceReadyTimingRef = useRef({
    scope: '',
    startedAt: monotonicNow(),
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
  const ownerScope = `${accessContext.uid}|${accessContext.authzVersion}|${accessContext.accessRole}|${accessBranchIdsKey}`
  const workspaceScope = `${ownerScope}|${branchId}|${currentWeekId}`
  // Commit a saved matrix to React, async readers and the scoped cache together.
  // A display-only payload is cacheable; it is not current validation evidence.
  const setWorkspace = useCallback((update: PtScheduleWorkspaceV2Result | null | ((current: PtScheduleWorkspaceV2Result | null) => PtScheduleWorkspaceV2Result | null)) => {
    if (activeWorkspaceScopeRef.current !== workspaceScope) return
    const current = workspaceRef.current
    let next = typeof update === 'function' ? update(current) : update
    if (next && (next.branch.id !== branchId || next.weekId !== currentWeekId)) return
    if (next && current?.branch.id === branchId && current.weekId === currentWeekId
      && (next.draftRevision < current.draftRevision || next.draftRevision === current.draftRevision
        && (next.publishedVersion < current.publishedVersion || current.draftStatus === 'published' && next.draftStatus !== 'published'))) next = current
    const draft = latestDraftRef.current
    if (next && draft?.scope === workspaceScope && (Number(draft.value.revision) > next.draftRevision
      || Number(draft.value.revision) === next.draftRevision
        && (Number(draft.value.publishedVersion || 0) > next.publishedVersion || draft.value.status === 'published' && next.draftStatus !== 'published'))) {
      next = workspaceFromDraftSnapshot(next, draft.value)
    }
    workspaceRef.current = next
    if (next) writeWorkspaceCache(workspaceScope, next)
    setWorkspaceState(next)
  }, [branchId, currentWeekId, workspaceScope])
  if (workspaceReadyTimingRef.current.scope !== workspaceScope) {
    workspaceReadyTimingRef.current = {
      scope: workspaceScope,
      startedAt: monotonicNow(),
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
  // The first paint is intentionally a display projection. It is safe for
  // matrix browsing because writes/candidate lookups recheck the exact
  // contract and availability evidence server-side. Keep the old hydration
  // lock only for callers that explicitly requested a reconciled payload.
  const workspaceHydrating = workspace?.partial === true && workspace?.readMode !== 'display'
  const workspaceDisplayMode = workspace?.readMode === 'display'
  // A display workspace intentionally skips contract/session reconciliation.
  // Only a future bounded quickCoverage projection may make these numbers
  // trustworthy before the full reconcile; otherwise render an explicit
  // pending state instead of exposing the server's placeholder zeroes.
  const quickCoverage = workspace?.quickCoverage as PtScheduleQuickCoverage | undefined
  // A partial workspace is never authoritative, even when it includes a
  // bounded estimate. Only the reconciled payload is authoritative for
  // learner coverage and warning counts.
  const coveragePending = !workspace || workspaceDisplayMode || workspace.partial === true
  const quickCoverageEstimate = coveragePending && Boolean(quickCoverage)
  const quickCoverageSessionsLabel = quickCoverageEstimate
    && quickCoverage
    && typeof quickCoverage.scheduledEntries === 'number'
    && typeof quickCoverage.totalTargetSessions === 'number'
    ? `~${quickCoverage.scheduledEntries}/${quickCoverage.totalTargetSessions}`
    : '—'
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
    const timing = workspaceReadyTimingRef.current
    if (!workspace || workspace.partial || loading || timing.reported || timing.scope !== workspaceScope) return
    if (workspace.branch.id !== branchId || workspace.weekId !== currentWeekId) return
    timing.reported = true
    void trackProductEvent('data_ready', {
      surface: 'schedule_workspace',
      durationMs: Math.max(0, Math.round(monotonicNow() - timing.startedAt)),
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

  const loadWorkspace = useCallback(async (quiet = false, forceAvailabilityRefresh = false, reconcile = false) => {
    if (!branchId) return
    const requestScope = `${ownerScope}|${branchId}|${currentWeekId}`
    const inFlightScope = reconcile ? `${requestScope}|reconciled` : requestScope
    const inFlight = workspaceRequestRef.current
    // A viewer refresh must not invalidate the request version of an explicit
    // reconciliation started by Run/Publish. Let its richer result finish;
    // the weekly listener will subsequently apply any genuinely newer view.
    if (!reconcile && inFlight?.scope === `${requestScope}|reconciled`) {
      await inFlight.promise
      return
    }
    if (inFlight?.scope === inFlightScope) {
      await inFlight.promise
      // Do not lose a forced availability refresh that arrived while the
      // ordinary workspace request was still in flight.
      if (forceAvailabilityRefresh && !inFlight.forceAvailabilityRefresh) {
        await loadWorkspace(true, true, reconcile)
      } else if (reconcile && !inFlight.reconcile) {
        await loadWorkspace(true, forceAvailabilityRefresh, true)
      }
      return
    }
    const requestVersion = workspaceRequestVersionRef.current + 1
    workspaceRequestVersionRef.current = requestVersion
    // Mutations invalidate the server-side branch cache. Use a unique client
    // cache key for forced reads so a prior display projection cannot be
    // returned after a draft/session revision has changed.
    const requestKey = forceAvailabilityRefresh
      ? `${inFlightScope}|refresh-${requestVersion}`
      : inFlightScope
    const request = (async () => {
      if (!quiet) {
        workspaceReadyTimingRef.current.source = 'network'
        setLoading(true)
        setError(null)
      }
      if (!quiet || !workspaceRef.current) setSyncState('connecting')
      try {
        const loadFullWorkspace = () => loadWorkspaceRequest(requestKey, () => measureScheduleTask('workspace', () => getPtScheduleWorkspace({
          weekId: currentWeekId,
          branchId,
          forceAvailabilityRefresh,
        })))
        const loadDisplayWorkspace = () => loadWorkspaceRequest(requestKey, () => measureScheduleTask('workspace', async () => {
          const loadLegacyDisplay = () => getPtScheduleWorkspace({
            weekId: currentWeekId,
            branchId,
            initialPaint: true,
            forceAvailabilityRefresh,
          })
          try {
            // Keep older regional adapters and test fixtures compatible while
            // the weekly-view callable rolls out alongside the client.
            if (typeof getPtScheduleWeeklyView !== 'function') return loadLegacyDisplay()
            const weeklyView = await getPtScheduleWeeklyView({
              weekId: currentWeekId,
              branchId,
              initialPaint: true,
              forceRefresh: forceAvailabilityRefresh,
            })
            const current = workspaceRef.current
            const normalized = normalizeWeeklyViewResult(weeklyView,
              current?.branch.id === branchId && current.weekId === currentWeekId ? current : null)
            if (activeWorkspaceScopeRef.current === requestScope) weeklyRefreshPendingRef.current = {
              scope: requestScope,
              pending: normalized.weeklyViewFreshness === 'stale',
            }
            return normalized
          } catch (weeklyError) {
            // Keep the rollout safe for regions where the read-model callable
            // is not deployed yet. Only capability/endpoint errors fall back;
            // transient failures still use the existing retryable workspace
            // path instead of silently issuing two broad reads.
            const normalized = asPtSchedulePublishError(weeklyError)
            const fallbackCodes = new Set([
              'CALLABLE_NOT_FOUND',
              'CALLABLE_UNIMPLEMENTED',
              'CALLABLE_FAILED_PRECONDITION',
              'CALLABLE_INVALID_ARGUMENT',
            ])
            if (!fallbackCodes.has(normalized.issueCode)) throw weeklyError
            return loadLegacyDisplay()
          }
        }))
        let result: PtScheduleWorkspaceV2Result
        if (!reconcile) {
          // Never follow the bounded matrix projection with an implicit full
          // reconciliation. Contract, quota, availability and cross-branch
          // evidence are loaded only by an explicit run/validate action.
          const initial = await loadDisplayWorkspace()
          if (activeWorkspaceScopeRef.current !== requestScope || workspaceRequestVersionRef.current !== requestVersion) return
          result = initial
        } else {
          result = await loadFullWorkspace()
          if (activeWorkspaceScopeRef.current === requestScope) weeklyRefreshPendingRef.current = { scope: requestScope, pending: false }
        }
        if (activeWorkspaceScopeRef.current !== requestScope || workspaceRequestVersionRef.current !== requestVersion) return
        const controlStatus = weeklyControlStatusRef.current.scope === requestScope ? weeklyControlStatusRef.current.status : 'disabled'
        if (!reconcile && (controlStatus === 'pending' || controlStatus === 'error')) {
          // A successful point read cannot assert that an unacknowledged or
          // failed change stream will keep this snapshot current thereafter.
          result = applyWeeklyValidation(result, { rebuilding: true, freshness: 'stale' }, result)
          result.weeklyViewFreshness = 'stale'
        }
        const current = workspaceRef.current
        if (current?.branch.id === branchId && current.weekId === currentWeekId && result.draftRevision < current.draftRevision) return
        const changed = workspaceRealtimeFingerprint(workspaceRef.current) !== workspaceRealtimeFingerprint(result)
        if (!quiet) setWorkspace(result)
        else if (changed) startTransition(() => setWorkspace(result))
        setLastSyncedAt(new Date())
        setSyncState(result.weeklyViewFreshness === 'stale' ? 'syncing' : 'live')
        const keepValidTrainer = (current: string) => availableTrainerId(result.trainers, current)
        if (quiet) startTransition(() => setSelectedTrainerId(keepValidTrainer))
        else setSelectedTrainerId(keepValidTrainer)
      } catch (loadError) {
        if (activeWorkspaceScopeRef.current !== requestScope || workspaceRequestVersionRef.current !== requestVersion) return
        if (!reconcile) weeklyRefreshPendingRef.current = {
          scope: requestScope,
          pending: asPtSchedulePublishError(loadError).issueCode === 'CALLABLE_UNAVAILABLE',
        }
        if (!quiet || !workspaceRef.current) {
          // A failed refresh must not erase the currently displayed schedule.
          // On a scope change the layout effect has already cleared old data.
          setError(asPtSchedulePublishError(loadError).message)
        }
        setSyncState('offline')
      } finally {
        if (!quiet && activeWorkspaceScopeRef.current === requestScope && workspaceRequestVersionRef.current === requestVersion) setLoading(false)
      }
    })()
    workspaceRequestRef.current = { scope: inFlightScope, forceAvailabilityRefresh, reconcile, promise: request }
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
      // A browser cache is first-paint evidence, never proof that the server
      // has not invalidated this week since we last visited it.
      const provisional = applyWeeklyValidation(cached.value, { rebuilding: true, freshness: 'stale' }, cached.value)
      provisional.weeklyViewFreshness = 'stale'
      setWorkspace(provisional)
      setSelectedTrainerId((current) => availableTrainerId(cached.value.trainers, current))
      setLoading(false)
      setLastSyncedAt(new Date(cached.storedAt))
      setSyncState('syncing')
    } else {
      setWorkspace(null)
      setLoading(Boolean(branchId))
      setSyncState('connecting')
    }
    setNotice(null)
    setNoticeAction(null)
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
    // The large read model changes only on publication. Source invalidations
    // arrive on a small control document, avoiding large payload rewrites and
    // delivery for dirty flags. Join both streams by revision/generation.
    let stopWeeklyListener: (() => void) | undefined
    let stopControlListener: (() => void) | undefined
    let stopDraftListener: (() => void) | undefined
    let latestWeeklySnapshot: DocumentSnapshot<DocumentData> | undefined
    let controlValue: Record<string, unknown> | null = null
    let controlReady = false
    let controlFailed = false
    let controlJoinTimer: number | undefined
    let fallbackStarted = false
    let dirtyRefreshQueued = false
    let latestDirtyGeneration = ''
    let requestedDirtyGeneration = ''
    let dirtyRetryCount = 0
    let dirtyRetryTimer: number | undefined
    let bootstrapTimer: number | undefined
    let bootstrapRequested = false
    let disposed = false
    const listenerScope = activeWorkspaceScopeRef.current
    const listenerInactive = () => disposed || activeWorkspaceScopeRef.current !== listenerScope
    weeklyControlStatusRef.current = { scope: listenerScope, status: firestoreDb && canListenToDraft ? 'pending' : 'disabled' }
    const cancelBootstrap = () => {
      window.clearTimeout(bootstrapTimer)
      bootstrapTimer = undefined
    }
    const requestBootstrap = () => {
      cancelBootstrap()
      if (listenerInactive() || bootstrapRequested) return
      bootstrapRequested = true
      void loadWorkspace(Boolean(workspaceRef.current))
    }
    const clearDirtyRetry = () => {
      window.clearTimeout(dirtyRetryTimer)
      dirtyRetryTimer = undefined
    }
    const refreshDirtyView = (retry = false) => {
      if (listenerInactive() || controlFailed || dirtyRefreshQueued || !latestDirtyGeneration || (!retry && latestDirtyGeneration === requestedDirtyGeneration)) return
      cancelBootstrap()
      bootstrapRequested = true
      if (latestDirtyGeneration !== requestedDirtyGeneration) dirtyRetryCount = 0
      clearDirtyRetry()
      requestedDirtyGeneration = latestDirtyGeneration
      dirtyRefreshQueued = true
      // The backend lease owns rebuild work. Do not force a second rebuild if
      // another viewer has already refreshed this generation before our read.
      void loadWorkspace(Boolean(workspaceRef.current)).finally(() => {
        dirtyRefreshQueued = false
        // An invalidation received during the request must not disappear, but
        // lease/status metadata writes for the same generation need no request.
        // The central sync setter retains terminal errors; do not retry them.
        if (listenerInactive() || controlFailed || !latestDirtyGeneration) return
        if (latestDirtyGeneration !== requestedDirtyGeneration) {
          refreshDirtyView()
          return
        }
        const pending = weeklyRefreshPendingRef.current
        if (pending.scope === activeWorkspaceScopeRef.current && pending.pending && dirtyRetryCount < 2) {
          // A superseded builder may release its lease without another source
          // event. Retry twice with backoff, then leave recovery to the worker
          // or an explicit user refresh; never poll forever per viewer.
          const delay = [2_000, 5_000][dirtyRetryCount++]
          dirtyRetryTimer = window.setTimeout(() => { dirtyRetryTimer = undefined; refreshDirtyView(true) }, delay)
        }
      })
    }
    const startDraftListener = () => {
      if (fallbackStarted || !firestoreDb || !canListenToDraft) return
      fallbackStarted = true
      stopDraftListener = onSnapshot(
        doc(firestoreDb, 'ptScheduleDrafts', `${branchId}_${currentWeekId}`),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (listenerInactive()) return
          const serverDraft = snapshot.metadata?.fromCache === false
          if (serverDraft) draftSubscriptionFailedRef.current = ''
          const raw = snapshot.data()
          const current = workspaceRef.current
          if (!snapshot.exists() || !raw || !raw.schedule || typeof raw.schedule !== 'object' || Array.isArray(raw.schedule)) return
          if (raw.branchId && raw.branchId !== branchId) return
          if (raw.weekId && raw.weekId !== currentWeekId) return
          const revision = Number(raw.revision ?? 0)
          if (!Number.isSafeInteger(revision) || revision < 0) return
          const previousDraft = latestDraftRef.current
          if (previousDraft?.scope === listenerScope && revision < Number(previousDraft.value.revision)) return
          latestDraftRef.current = { scope: listenerScope, value: raw }
          if (!current || current.branch.id !== branchId || current.weekId !== currentWeekId) return
          const publishedVersion = Number(raw.publishedVersion ?? current.publishedVersion)
          const nextStatus = raw.status === 'published' ? 'published' : 'draft'
          if (revision < current.draftRevision) return
          if (revision === current.draftRevision
            && publishedVersion === current.publishedVersion
            && nextStatus === current.draftStatus) {
            if (serverDraft && controlReady) setSyncState('live')
            return
          }
          setWorkspace((value) => {
            if (!value || value.branch.id !== branchId || value.weekId !== currentWeekId) return value
            return workspaceFromDraftSnapshot(value, raw)
          })
          candidateCache.current.clear()
          setLastSyncedAt(new Date())
          if (serverDraft && controlReady) setSyncState('live')
        },
        () => {
          if (!listenerInactive()) {
            draftSubscriptionFailedRef.current = listenerScope
            setSyncState('offline')
          }
        },
      )
    }
    const startDraftFallback = () => {
      requestBootstrap()
      startDraftListener()
    }
    if (firestoreDb && canListenToDraft) {
      // One bounded draft document, not a roster/session scan. Catch other
      // admins' saved edits before the background weekly projection rebuilds.
      startDraftListener()
      // Give the authenticated server stream one short opportunity to supply
      // the complete week. A miss, denial or invalidation bypasses this wait;
      // a slow/offline stream cannot leave bootstrap hanging indefinitely.
      bootstrapTimer = window.setTimeout(requestBootstrap, 500)
      const receiveWeekly = (snapshot: DocumentSnapshot<DocumentData>) => {
          if (listenerInactive()) return
          const payload = snapshot.data()
          const serverSnapshot = snapshot.metadata?.fromCache === false
          const raw = payload ? mergeWeeklyControl(payload, controlValue, controlReady) as DocumentData : undefined
          const current = workspaceRef.current
          if (!snapshot.exists() || !raw) {
            if (serverSnapshot) startDraftFallback()
            return
          }
          if ((raw.branchId && raw.branchId !== branchId) || (raw.weekId && raw.weekId !== currentWeekId)) return
          window.clearTimeout(controlJoinTimer)
          controlJoinTimer = undefined
          if (raw.controlPending === true && !controlFailed) {
            // Independent listener callbacks can arrive in either order. Wait
            // briefly for the partner before one bounded lightweight repair.
            controlJoinTimer = window.setTimeout(() => {
              controlJoinTimer = undefined
              latestDirtyGeneration = `control:${String(raw.sourceRevision || '')}:${String(controlValue?.sourceRevision || '')}:${String(controlValue?.dirtyGeneration || 0)}`
              refreshDirtyView()
            }, 500)
          }
          // A cached duplicate arriving after a server response cannot turn a
          // synchronized display-only matrix back into a perpetual spinner.
          if (!serverSnapshot && current && current.weeklyViewFreshness !== 'stale'
            && raw.sourceRevision === current.weeklyViewSourceRevision
            && Number(raw.viewRevision || 0) <= Number(current.weeklyViewRevision || 0)
            && Number(raw.dirtyGeneration || 0) <= Number(current.weeklyViewDirtyGeneration || 0)) return
          const serverCurrent = controlReady && serverSnapshot && raw.schemaVersion >= 3 && raw.dirty === false && raw.freshness !== 'stale' && raw.rebuilding !== true
            && Array.isArray(raw.contracts) && Array.isArray(raw.warnings) && Array.isArray(raw.unassignedEntries) && Boolean(raw.scheduleConfig && raw.weeklySessionCoverage)
          let accepted = false
          const evidence = serverCurrent ? raw : { ...raw, rebuilding: true, freshness: 'stale' }
          try {
            // Validate a complete payload even when a cached workspace exists:
            // metadata-only markers must never suppress the bootstrap API.
            const initial = normalizeWeeklyViewResult(evidence, null)
            if (initial.branch.id !== branchId || initial.weekId !== currentWeekId) return
            // Normalization already validates the artifact with no retained
            // fallback here; reuse that proof instead of validating it twice.
            accepted = serverCurrent && (typeof raw.validationDirty === 'boolean'
              && (raw.validationState === 'unknown' || ['current', 'stale'].includes(raw.validationState) && Boolean(initial.validationSnapshot))
              || raw.verification === 'exact' && raw.partial !== true && initial.validationState === 'current')
            const freshEnough = !current || (initial.draftRevision >= current.draftRevision
              && Number(initial.weeklyViewRevision || 0) >= Number(current.weeklyViewRevision || 0)
              && Number(initial.weeklyViewDirtyGeneration ?? 0) >= Number(current.weeklyViewDirtyGeneration ?? 0))
            if (accepted && !freshEnough) {
              requestBootstrap()
              return
            }
            if (accepted && freshEnough) {
              cancelBootstrap()
              weeklyRefreshPendingRef.current = { scope: listenerScope, pending: false }
            }
            if (!current) {
              setWorkspace(initial)
              setSelectedTrainerId(initial.trainers.find((trainer) => !isTrainerLocked(trainer))?.id || '')
              setLoading(false)
              setLastSyncedAt(new Date())
              setSyncState(serverCurrent ? 'live' : 'syncing')
              if (raw.dirty !== true) {
                if (!accepted && raw.controlPending !== true && serverSnapshot) requestBootstrap()
                return
              }
            }
          } catch {
            if (raw.dirty !== true) {
              if (raw.controlPending !== true && serverSnapshot) startDraftFallback()
              return
            }
          }
          // Dirty markers intentionally contain only revision metadata while
          // the debounced rebuild is in flight. Keep the single listener and
          // request one bounded weekly rebuild instead of opening a second
          // broad draft stream. The server-side worker remains a fallback for
          // edits made while no schedule page is open.
          if (raw.dirty === true) {
            setSyncState('syncing')
            const pendingCurrent = workspaceRef.current
            if (pendingCurrent) {
              const stale = applyWeeklyValidation(pendingCurrent, { dirty: true, validationDirty: true }, pendingCurrent)
              stale.weeklyViewFreshness = 'stale'
              stale.weeklyViewDirtyGeneration = Math.max(Number(pendingCurrent.weeklyViewDirtyGeneration || 0), Number(raw.dirtyGeneration || 0))
              setWorkspace(stale)
            }
            latestDirtyGeneration = typeof raw.dirtyGeneration === 'number'
              ? `generation:${raw.dirtyGeneration}`
              : `legacy:${String(raw.sourceRevision || '')}:${String(raw.dirtyAt?.seconds ?? raw.dirtyAt ?? '')}:${String(raw.dirtyAt?.nanoseconds ?? '')}`
            refreshDirtyView()
            return
          }
          if (accepted) {
            latestDirtyGeneration = ''
            clearDirtyRetry()
          } else if (raw.controlPending !== true && serverSnapshot) requestBootstrap()
          if (!current || current.branch.id !== branchId || current.weekId !== currentWeekId) return
          const revisionValue = Number(raw.draft?.revision ?? raw.draftRevision ?? current.draftRevision)
          if (Number.isFinite(revisionValue) && revisionValue < current.draftRevision) return
          try {
            const next = raw.branchId && !raw.branch
              ? normalizeWeeklyViewResult(evidence, current)
              : workspaceFromWeeklyViewSnapshot(current, evidence)
            setSyncState(next.weeklyViewFreshness === 'stale' ? 'syncing' : 'live')
            if (workspaceRealtimeFingerprint(next) === workspaceRealtimeFingerprint(current)) return
            setWorkspace(next)
            candidateCache.current.clear()
            setLastSyncedAt(new Date())
          } catch {
            startDraftFallback()
          }
        }
      stopWeeklyListener = onSnapshot(
        doc(firestoreDb, 'ptScheduleWeeklyViews', `${branchId}_${currentWeekId}`),
        { includeMetadataChanges: true },
        (snapshot) => { latestWeeklySnapshot = snapshot; receiveWeekly(snapshot) },
        () => {
          if (listenerInactive()) return
          startDraftFallback()
        },
      )
      stopControlListener = onSnapshot(
        doc(firestoreDb, 'ptScheduleWeeklyViewStates', `${branchId}_${currentWeekId}`),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (listenerInactive()) return
          const value = snapshot.data()
          if (value && (value.branchId !== branchId || value.weekId !== currentWeekId)) return
          // Cache alone cannot acknowledge a newer dirty event on the server.
          if (snapshot.metadata.fromCache && (controlReady || controlFailed)) return
          if (controlFailed && snapshot.metadata.fromCache === false) requestedDirtyGeneration = ''
          controlValue = value || null
          controlReady = snapshot.metadata.fromCache === false
          controlFailed = false
          weeklyControlStatusRef.current = { scope: listenerScope, status: controlReady ? 'ready' : 'pending' }
          if (latestWeeklySnapshot) receiveWeekly(latestWeeklySnapshot)
        },
        () => {
          if (listenerInactive()) return
          controlReady = false
          controlFailed = true
          weeklyControlStatusRef.current = { scope: listenerScope, status: 'error' }
          if (latestWeeklySnapshot) receiveWeekly(latestWeeklySnapshot)
          requestBootstrap()
          setSyncState('offline')
        },
      )
    } else requestBootstrap()
    return () => {
      disposed = true
      cancelBootstrap()
      clearDirtyRetry()
      window.clearTimeout(controlJoinTimer)
      stopWeeklyListener?.()
      stopControlListener?.()
      stopDraftListener?.()
    }
  }, [branchId, canListenToDraft, currentWeekId, loadWorkspace])

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
        label: inspectorSlotIsPast ? 'Có lưu ý cần xác nhận' : 'Có lưu ý',
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

  // Same-branch manual placement is one click. Cross-branch changes retain
  // explicit consent; historical corrections retain their reason/audit form.
  const canPlaceManualCandidateImmediately = (candidate: PtScheduleSlotCandidate) => Boolean(
    !inspectorSlotIsPast
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
    const entriesByStudentDay = new Map<string, Array<{
      slotId: string
      entry: PtScheduleWorkspaceV2Result['schedule'][string][number]
    }>>()
    const add = (slotId: string, entry: PtScheduleWorkspaceV2Result['schedule'][string][number], code: string) => {
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
        const day = String(slotId).split('-')[0]
        const date = weekDates[day as keyof typeof weekDates]?.full || day
        if (approvedOffOnDate(studentsById.get(entry.studentId), date)) add(slotId, entry, 'CONTRACT_PAUSED')
        const studentDayKey = `${entry.studentId}|${date}`
        const studentDayEntries = entriesByStudentDay.get(studentDayKey) || []
        studentDayEntries.push({ slotId, entry })
        entriesByStudentDay.set(studentDayKey, studentDayEntries)
        for (const code of entry.adminOverrideWarnings || []) {
          if (MATRIX_IMPORTANT_WARNING_CODES.has(code)) add(slotId, entry, code)
        }
      }
      for (const studentEntries of byStudent.values()) {
        if (studentEntries.length < 2) continue
        for (const entry of studentEntries) add(slotId, entry, 'DUPLICATE_SCHEDULE_ENTRY')
      }
    }
    // A learner may be duplicated in two different hours on the same day.
    // The publish validator already blocks this case, but an old/manual draft
    // can still contain it. Surface every affected local row so the warning
    // center and the matrix point to the exact cells that need review.
    for (const studentDayEntries of entriesByStudentDay.values()) {
      if (new Set(studentDayEntries.map(({ slotId }) => slotId)).size < 2) continue
      for (const { slotId, entry } of studentDayEntries) add(slotId, entry, 'STUDENT_MULTIPLE_SESSIONS_PER_DAY')
    }

    // Published-session diagnostics are generated from raw server rows because
    // the normal workspace projection intentionally collapses duplicate rows
    // for coverage/entitlement counting. Re-anchor each diagnostic to the
    // visible local matrix cell when it exists.
    for (const warning of workspace.warnings || []) {
      if (!MATRIX_IMPORTANT_WARNING_CODES.has(warning.code) || !warning.slotId || !warning.studentId) continue
      const slotEntries = (workspace.schedule[warning.slotId] || []).filter((entry) => entry.type !== 'off' && entry.studentId === warning.studentId)
      const entry = slotEntries.find((candidate) => !warning.trainerId || candidate.trainerId === warning.trainerId) || slotEntries[0]
      if (entry) add(warning.slotId, entry, warning.code)
    }

    // The selected branch owns only its local matrix. Reconcile it with the
    // compact all-branch coverage projection so a learner scheduled locally
    // and at another branch on the same day is still visible as a conflict.
    // Anchor the row to the local cell so clicking the warning opens the right
    // trainer/slot in this matrix.
    for (const [studentId, coverage] of Object.entries(workspace.weeklySessionCoverage || {})) {
      const localEntriesByDay = new Map<string, Array<{
        slotId: string
        entry: PtScheduleWorkspaceV2Result['schedule'][string][number]
      }>>()
      for (const [studentDayKey, entries] of entriesByStudentDay) {
        if (!studentDayKey.startsWith(`${studentId}|`)) continue
        const date = studentDayKey.slice(studentId.length + 1)
        localEntriesByDay.set(date, entries)
      }
      const coverageByDate = new Map<string, typeof coverage.entries>()
      for (const entry of coverage.entries || []) {
        const current = coverageByDate.get(entry.date) || []
        current.push(entry)
        coverageByDate.set(entry.date, current)
      }
      for (const [date, coverageEntries] of coverageByDate) {
        if (!coverageEntries.some((entry) => entry.branchId !== workspace.branch.id)) continue
        for (const { slotId, entry } of localEntriesByDay.get(date) || []) {
          add(slotId, entry, 'STUDENT_MULTIPLE_SESSIONS_PER_DAY')
        }
      }
    }
    return rows.sort((left, right) => compareScheduleSlots(left.slotId, right.slotId)
      || left.studentName.localeCompare(right.studentName, 'vi')
      || left.code.localeCompare(right.code))
  }, [weekDates, workspace])

  const matrixConflictWarningKeys = useMemo(
    () => new Set(scheduleConflictWarnings
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
    const latestContractByStudent = new Map<string, (typeof workspace.contracts)[number]>()
    for (const contract of workspace.contracts) {
      const rows = contractsByStudent.get(contract.studentId) || []
      rows.push(contract)
      contractsByStudent.set(contract.studentId, rows)
      const latest = latestContractByStudent.get(contract.studentId)
      if (!latest || String(latest.endDate || '').localeCompare(String(contract.endDate || '')) < 0) {
        latestContractByStudent.set(contract.studentId, contract)
      }
    }
    const trainersById = new Map(workspace.trainers.map((trainer) => [trainer.id, trainer]))
    return workspace.students
      .filter((student) => !student.isCrossBranchDisplayOnly
        && !['archived', 'deleted'].includes(String(student.status || '').toLowerCase())
        && (student.eligibleForWeek === true
          || approvedOffForWeek(student, workspace)
          || (scheduledEntriesByStudent.get(student.id)?.length || 0) > 0
          || student.hadSchedulePreviousWeek === true))
      .map((student) => {
      const scheduledEntries = scheduledEntriesByStudent.get(student.id) || []
      // The matrix is scoped to the selected training branch, but a learner's
      // weekly target is global. Add sessions already recorded at other
      // branches to the local draft count so a learner is not incorrectly
      // flagged as missing when they split the week across locations.
      const crossBranchScheduledSessions = validOtherBranchCount(student, workspace.weeklySessionCoverage, workspace.branch.id)
      const scheduled = validScheduledCount(student, scheduledEntries, workspace.weekId) + crossBranchScheduledSessions
      const approvedOffWeek = approvedOffForWeek(student, workspace)
      const missing = approvedOffWeek ? 0 : Math.max(0, Number(student.sessionsPerWeek || 0) - scheduled)
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
      const inputWarning = !approvedOffWeek && (missing > 0
        || student.eligibleForWeek !== true
        || student.contractStatus === 'expiring'
        || !CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus)
        || student.eligibilityReasons.includes('AMBIGUOUS_ACTIVE_CONTRACT'))
      return {
        student,
        scheduled,
        scheduledEntries,
        crossBranchScheduledSessions,
        missing,
        contract,
        trainerNames,
        inputWarning,
        approvedOffWeek,
        feasibility: feasibilityByStudent.get(student.id),
      }
    })
  }, [scheduledEntriesByStudent, workspace])

  const studentWarnings = useMemo(
    () => workspaceDisplayMode ? [] : operationalStudentRows.filter((row) => row.inputWarning),
    [operationalStudentRows, workspaceDisplayMode],
  )
  const ineligibleDraftRows = useMemo(() => (workspace?.students || [])
    .filter((student) => !student.isCrossBranchDisplayOnly
      && student.eligibleForWeek !== true && (scheduledEntriesByStudent.get(student.id)?.length || 0) > 0)
    .map((student) => ({ student, scheduledEntries: scheduledEntriesByStudent.get(student.id) || [] })), [scheduledEntriesByStudent, workspace])
  const missingSessions = studentWarnings.reduce((total, item) => total + item.missing, 0)
  const studentRows = useMemo(() => {
    const needle = normalizeScheduleSearchText(studentSearch)
    const diagnosticsByStudent = new Map((workspace?.unassignedEntries || workspace?.unassigned || []).map((entry) => [entry.studentId, entry]))
    return operationalStudentRows.filter((row) => {
      if (row.approvedOffWeek && studentFilter !== 'all') return false
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
        .some((value) => normalizeScheduleSearchText(String(value || '')).includes(needle))
    }).sort((left, right) => right.missing - left.missing || (left.student.name || '').localeCompare(right.student.name || '', 'vi'))
  }, [operationalStudentRows, studentFilter, studentSearch, workspace?.unassigned, workspace?.unassignedEntries])

  const studentCoverage = useMemo(() => {
    const source: PtScheduleStudentCoverage | undefined = workspace?.optimizationSummary?.studentCoverage
      || workspace?.studentCoverage
    let eligible = 0, withAtLeastOne = 0, fullyScheduled = 0, totalTargetSessions = 0, scheduledEntries = 0
    for (const row of operationalStudentRows) {
      if (row.student.eligibleForWeek !== true || row.approvedOffWeek) continue
      eligible += 1
      if (row.scheduled > 0) withAtLeastOne += 1
      if (row.missing === 0) fullyScheduled += 1
      totalTargetSessions += row.student.sessionsPerWeek
      scheduledEntries += Math.min(row.student.sessionsPerWeek, row.scheduled)
    }
    return {
      eligible: operationalStudentRows.some(row => row.approvedOffWeek) ? eligible : finiteCount(source?.eligibleStudents, source?.eligible, eligible),
      // These counts are deliberately derived from the rows above instead of
      // trusting the optimizer snapshot, which is branch-scoped by design.
      // The rows include the compact cross-branch coverage projection.
      withAtLeastOne,
      fullyScheduled,
      totalTargetSessions,
      scheduledEntries,
      missingSessions,
    }
  }, [missingSessions, operationalStudentRows, workspace])

  const slotUtilization = useMemo(() => {
    // Pair/single counts are exact properties of the visible matrix, even
    // when contracts are deferred. Compact views use {} for absent optimizer
    // metrics, and saved optimizer counts can be stale after manual edits.
    const groups = new Map<string, number>()
    for (const [slotId, entries] of Object.entries(workspace?.schedule || {})) {
      for (const entry of entries) {
        if (entry.type === 'off') continue
        const key = `${entry.trainerId}|${slotId}`
        groups.set(key, (groups.get(key) || 0) + 1)
      }
    }
    let pairedSlots = 0
    let singleSlots = 0
    for (const count of groups.values()) {
      if (count >= 2) pairedSlots += 1
      if (count === 1) singleSlots += 1
    }
    return { pairedSlots, singleSlots }
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
    () => !workspaceDisplayMode && hasActionableSearchLimit(workspace?.optimizationSummary, unassignedEntries),
    [unassignedEntries, workspace?.optimizationSummary, workspaceDisplayMode],
  )

  const warningProfiles = useMemo(() => {
    if (!workspace || workspaceDisplayMode) return []
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
      .filter((profile) => !approvedOffForWeek(profile.student, workspace) && profile.missingSessions > 0
        && (profile.student.eligibleForWeek === true
        || Number(profile.student.previousWeekScheduledSessions || 0) > 0
        || profile.scheduledEntries.length > 0))
      .sort((left, right) => {
        const priority = (profile: typeof left) => warningReasonPriority(profile.primaryReasonCode || 'STUDENT_UNSCHEDULED')
        return priority(left) - priority(right)
          || right.missingSessions - left.missingSessions
          || left.student.name.localeCompare(right.student.name, 'vi')
      })
  }, [ineligibleDraftRows, operationalStudentRows, scheduledEntriesByStudent, studentWarnings, unassignedEntries, weekDates, workspace, workspaceDisplayMode])

  const draftResetSummary = useMemo(() => {
    const entries = Object.values(workspace?.schedule || {}).flat()
    const resettable = entries.filter((entry) => entry.type !== 'off' && entry.source !== 'published_existing')
    return {
      resettableEntries: resettable.length,
      affectedStudents: new Set(resettable.map((entry) => entry.studentId)).size,
      protectedEntries: entries.length - resettable.length,
    }
  }, [workspace?.schedule])

  const selectedTrainerLoads = useMemo(() => trainerLoads.filter((load) => load.trainerId === selectedTrainerId), [selectedTrainerId, trainerLoads])
  const warningCount = useMemo(() => {
    return warningProfiles.length + scheduleConflictWarnings.length
  }, [scheduleConflictWarnings.length, warningProfiles.length])

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
        if (!current || result.draftRevision < current.draftRevision) return current
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
      await loadWorkspace(true, true)
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

  const openWarningStudentAvailability = (student: Pick<PtScheduleWorkspaceV2Result['students'][number], 'id' | 'name'>) => {
    // Keep the operator on the warning center. The warning row itself is the
    // entry point for the learner's availability and cross-branch schedule;
    // navigating to the Students tab made the warning context disappear.
    setExpandedWarningStudentId((current) => current === student.id ? null : student.id)
    setAvailabilityEditorStudentId(null)
    setAvailabilityError('')
    setNotice('')
  }

  const openFirstWarningStudentAvailability = () => {
    // Summary and toolbar actions only select the warning tab. A specific
    // learner is expanded when the operator clicks that warning row.
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
      setWorkspace((current) => current ? workspaceFromDraftSnapshot(current, {
        revision: result.draftRevision,
        schedule: result.schedule,
        status: 'draft',
        warnings: result.warnings,
        optimizationSummary: result.optimizationSummary || {},
        unassignedEntries: result.unassignedEntries || result.unassigned || [],
      }) : current)
      setTab('matrix')
      // The optimizer is the explicit reconciliation boundary. Once it has
      // run, hydrate the richer workspace projection so warning/coverage tabs
      // reflect the same evidence used by the server-side optimizer.
      await loadWorkspace(true, true, true)
      if (activeWorkspaceScopeRef.current !== commandScope) return
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
      await loadWorkspace(true, true)
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
      await loadWorkspace(true, true)
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
  const studentName = (studentId: string) => studentNames.get(studentId) || 'Đang cập nhật hồ sơ'
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
        <button type="button" onClick={() => setTab('students')}><UsersRound /><strong>{coveragePending ? '—' : `${studentCoverage.fullyScheduled}/${studentCoverage.eligible}`}</strong><span>{!workspace ? 'Đang tải học viên' : coveragePending ? 'Chưa đối soát' : 'học viên đủ lịch'}</span></button>
        <button type="button" onClick={() => setTab('students')}><CalendarRange /><strong>{coveragePending ? quickCoverageSessionsLabel : `${studentCoverage.scheduledEntries}/${studentCoverage.totalTargetSessions}`}</strong><span>{!workspace ? 'Đang tải buổi tập' : coveragePending ? (quickCoverageEstimate ? 'Ước tính · chưa đối soát' : 'Buổi đã xếp · mục tiêu chưa đối soát') : 'buổi đã xếp'}</span></button>
        <button type="button" onClick={() => setTab('warnings')} className={slotUtilization.singleSlots > 0 ? 'is-attention' : ''}><UsersRound /><strong>{workspace ? `${slotUtilization.pairedSlots} đôi` : '—'}</strong><span>{workspace ? `${slotUtilization.singleSlots} ca còn lẻ` : 'Đang tải ghép ca'}</span></button>
        <button type="button" onClick={openFirstWarningStudentAvailability} className={warningCount > 0 ? 'is-attention' : ''}><AlertTriangle /><strong>{workspace ? warningCount : '—'}</strong><span>{!workspace ? 'Đang tải cảnh báo' : coveragePending ? 'Xung đột nhanh · thiếu buổi —' : 'cảnh báo cần xem'}</span></button>
      </section>

      <section className="branch-schedule__toolbar">
        <div className="branch-schedule__tabs" role="tablist" aria-label="Nội dung xếp lịch">
          <button id="schedule-tab-matrix" type="button" role="tab" aria-selected={tab === 'matrix'} aria-controls="schedule-panel-matrix" tabIndex={tab === 'matrix' ? 0 : -1} className={tab === 'matrix' ? 'is-active' : ''} onClick={() => setTab('matrix')}>Lịch PT</button>
          <button id="schedule-tab-opportunities" type="button" role="tab" aria-selected={tab === 'opportunities'} aria-controls="schedule-panel-opportunities" tabIndex={tab === 'opportunities' ? 0 : -1} className={tab === 'opportunities' ? 'is-active' : ''} onClick={() => setTab('opportunities')}>Kho ca {tab === 'opportunities' && <b>{scheduleOpportunities.length}</b>}</button>
          <button id="schedule-tab-warnings" type="button" role="tab" aria-selected={tab === 'warnings'} aria-controls="schedule-panel-warnings" tabIndex={tab === 'warnings' ? 0 : -1} className={tab === 'warnings' ? 'is-active' : ''} onClick={openFirstWarningStudentAvailability}>Cảnh báo <b title={coveragePending ? 'Đang cập nhật cảnh báo theo draft hiện tại' : undefined}>{coveragePending ? '—' : warningCount}</b></button>
          <button id="schedule-tab-students" type="button" role="tab" aria-selected={tab === 'students'} aria-controls="schedule-panel-students" tabIndex={tab === 'students' ? 0 : -1} className={tab === 'students' ? 'is-active' : ''} onClick={() => setTab('students')}>Học viên</button>
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
              <button type="button" onClick={() => { moreMenuRef.current?.removeAttribute('open'); setResetDraftOpen(true) }} disabled={!workspace || workspaceHydrating || busy || draftResetSummary.resettableEntries < 1}><RotateCcw size={16} /><span><strong>Đặt lại draft</strong><small>Xóa toàn bộ buổi nháp, kể cả xếp tay</small></span></button>
              <button type="button" onClick={() => { moreMenuRef.current?.removeAttribute('open'); void loadWorkspace(false, true) }} disabled={loading || workspaceHydrating || busy}><RefreshCw size={16} className={loading ? 'is-spinning' : ''} /><span><strong>Tải lại dữ liệu</strong><small>Đồng bộ lại ngay bây giờ</small></span></button>
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
      {!optimizationStatus && workspace && Boolean(workspace.optimizationSummary?.comparison || workspace.optimizationSummary?.swapTrace?.length || searchLimitWarning) && <Suspense fallback={null}><ScheduleOptimizationResult workspace={workspace} weekDates={weekDates} searchLimitWarning={searchLimitWarning} /></Suspense>}
      {loading && !workspace && <div className="branch-schedule__loading"><RefreshCw className="is-spinning" /> Đang tải workspace theo phạm vi…</div>}
      {workspaceHydrating && <div className="branch-schedule__loading"><RefreshCw className="is-spinning" /> Đang đối soát hợp đồng và cảnh báo…</div>}

      {workspace && tab === 'matrix' && (
        <main id="schedule-panel-matrix" role="tabpanel" aria-labelledby="schedule-tab-matrix" className="branch-schedule__workspace">
          <p className="branch-schedule__draft-state" aria-label="Phiên bản lịch đang hiển thị"><strong>{workspace.draftStatus === 'published' ? 'Lịch đã publish' : 'Draft'} r{workspace.draftRevision}</strong><span>{workspace.draftStatus === 'published' ? `Bản công bố v${workspace.publishedVersion}` : 'Đã lưu · chưa Publish'}</span></p>
          <section className="branch-schedule__matrix-toolbar">
            <label><span>Huấn luyện viên</span><select value={selectedTrainerId} disabled={workspaceHydrating} onChange={(event) => setSelectedTrainerId(event.target.value)}>{visibleTrainers.map((trainer) => <option key={trainer.id} value={trainer.id}>{trainer.name}</option>)}</select></label>
            {selectedTrainer && <div className={`trainer-availability-chip is-${selectedTrainer.availabilityMode}`}><Clock3 size={14} />{selectedTrainer.availabilityMode === 'configured' ? `${selectedTrainer.availableSlots?.length || 0} khung giờ rảnh · ${selectedTrainer.availabilitySource === 'weekly' ? 'Lịch tuần' : 'Lịch lặp lại'}` : selectedTrainer.availabilityMode === 'unrestricted' ? 'Không giới hạn' : 'Chưa khai lịch rảnh'}</div>}
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
                const isAvailabilityOff = Boolean(selectedTrainer?.offDates?.includes(weekDates[day as keyof typeof weekDates]?.full || ''))
                const isOff = entries.some((entry) => entry.type === 'off') || (isAvailabilityOff && entries.length === 0)
                const holiday = holidayDates.has(weekDates[day as keyof typeof weekDates]?.full || '')
                const past = pastScheduleSlots.has(slotId)
                const isTrainerAvailable = Boolean(!holiday && !isOff && !isAvailabilityOff && (trainerAvailabilityIsUnrestricted || trainerAvailabilitySlots.has(slotId)))
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
          <header><div><p>LỊCH TẬP TUẦN NÀY · <span className="sr-only">Tiến độ xếp lịch</span></p><h2>Học viên</h2><span>{studentRows.length} học viên · {coveragePending ? 'chưa đối soát mục tiêu tuần' : 'chỉ hiển thị các buổi trong tuần'}</span></div>{onNavigate && <button type="button" onClick={() => onNavigate('admin-pt-students')}><UserPlus size={16} /> Hồ sơ</button>}</header>
          <div className="branch-schedule__student-tools">
            <label><Search size={17} /><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Tìm tên học viên" aria-label={isAdmin ? "Tìm học viên hai chi nhánh, có hoặc không dấu" : "Tìm tên học viên"} /></label>
            <select aria-label="Lọc học viên" disabled={coveragePending} value={studentFilter} onChange={(event) => setStudentFilter(event.target.value as StudentFilter)}><option value="all">Tất cả</option><option value="missing">Còn thiếu buổi</option><option value="contract">Hợp đồng / quota</option><option value="availability">Thiếu lịch rảnh</option><option value="trainer">Thiếu PT / ca</option><option value="ready">Đã đủ lịch</option></select>
          </div>
          <div className="branch-schedule__student-list">
            {isAdmin && normalizeScheduleSearchText(studentSearch).length >= 2 && <Suspense fallback={<p role="status">Đang tìm ở cơ sở khác…</p>}>
              <ScheduleStudentSearchResults query={studentSearch} branchId={branchId} weekId={currentWeekId} branches={branches} onSelectBranch={id => { setStudentFilter('all'); setBranchId(id) }} />
            </Suspense>}
            {studentRows.map(({ student, scheduled, scheduledEntries, crossBranchScheduledSessions, missing, approvedOffWeek }) => {
              return <article id={`schedule-student-${student.id}`} key={student.id} className={`${missing > 0 ? 'is-missing' : 'is-ready'}${student.eligibleForWeek !== true ? ' is-ineligible' : ''}${availabilityEditorStudentId === student.id ? ' is-editing-availability' : ''}`}>
              <Suspense fallback={<div className="branch-schedule__student-person">{student.name}</div>}>
                <ScheduleStudentSummary student={student} approvedOffWeek={approvedOffWeek} coveragePending={coveragePending} scheduled={scheduled} missing={missing} primaryReasonCode={unassignedByStudent.get(student.id)?.primaryReasonCode} busy={busy} onSetWeeklyTarget={setWeeklyTarget} />
              </Suspense>
              <div className="branch-schedule__student-schedule"><small>Buổi trong tuần{crossBranchScheduledSessions > 0 ? ` · +${crossBranchScheduledSessions} ở cơ sở khác` : ''}</small><div>{scheduledEntries.length ? scheduledEntries.map((entry) => <span key={`${entry.slotId}-${entry.trainerId}`} className={entry.trainerAssignmentWarning ? 'has-assignment-warning' : ''}>{entry.label}{approvedOffOnDate(student, weekDates[entry.slotId.split('-')[0]]?.full || '') && <em>Trùng OFF · không tính buổi</em>}<b>{workspace.trainers.find((trainer) => trainer.id === entry.trainerId)?.name || 'PT chưa cập nhật'}{entry.trainerAssignmentWarning && <AlertTriangle size={12} aria-label="PT hỗ trợ" />}</b></span>) : crossBranchScheduledSessions > 0 ? <em>Đã có lịch ở cơ sở khác</em> : <em>Chưa có buổi trong tuần</em>}</div></div>
              {!approvedOffWeek && <div className="branch-schedule__student-availability-action"><button type="button" className={`is-${student.availabilityStatus}`} aria-expanded={availabilityEditorStudentId === student.id} onClick={() => openAvailabilityEditor(student)}><CalendarRange size={16} />{student.availabilityStatus === 'locked' ? 'Lịch rảnh đã khóa' : CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus) ? 'Lịch rảnh' : 'Thêm lịch rảnh'}</button>{!CONFIRMED_AVAILABILITY_STATUSES.has(student.availabilityStatus) && <span className="is-warning">Cần lịch rảnh</span>}</div>}
              {availabilityEditorStudentId === student.id && <Suspense fallback={<section className="branch-schedule__availability-editor" role="status">Đang tải lịch rảnh…</section>}>
                <ScheduleAvailabilityEditor student={student} weekId={currentWeekId} days={workingDays} hours={workingHours} selected={availabilityDraft} onChange={setAvailabilityDraft} busy={availabilityBusy} error={availabilityError} isAdmin={isAdmin} onClose={() => setAvailabilityEditorStudentId(null)} onReopen={() => void reopenStudentAvailability(student)} onSave={() => void saveStudentAvailability(student)} />
              </Suspense>}
              </article>
            })}
            {!studentRows.length && <div className="schedule-warning-empty"><CheckCircle2 /> Không có học viên phù hợp ở cơ sở đang xem.</div>}
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
        <Suspense fallback={<div role="status">Đang tải cảnh báo…</div>}><ScheduleWarningsPanel workspace={workspace} branchId={branchId} branches={branches} weekDates={weekDates} coveragePending={coveragePending} warningCount={warningCount} warningFilter={warningFilter} setWarningFilter={setWarningFilter} warningProfiles={warningProfiles} scheduleConflictWarnings={scheduleConflictWarnings} expandedWarningStudentId={expandedWarningStudentId} openWarningStudentAvailability={openWarningStudentAvailability} onOpenSlot={(slotId, trainerId) => { setSelectedTrainerId(trainerId); setInspectorSlotId(slotId); setCandidateSearch(''); setPendingManualCandidate(null); setTab('matrix') }} /></Suspense>
      )}

      {workspace && tab === 'history' && (
        <Suspense fallback={<div className="branch-schedule__loading" role="status">Đang tải lịch sử…</div>}>
          <ScheduleHistoryPanel history={history} busy={busy} restoreCandidate={restoreCandidate} dialogRef={activeDialogRef}
            onBack={() => setTab('matrix')} onSelect={setRestoreCandidate} onCancel={() => setRestoreCandidate(null)} onRestore={() => void restoreVersion()} />
        </Suspense>
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
                {candidateLoading && <div className="schedule-candidate-sync"><RefreshCw className="is-spinning" /> Đang tìm hồ sơ…</div>}
                {inspectorSlotIsPast && <label className="schedule-history-reason"><span>Lý do bổ sung <b>*</b></span><textarea value={historicalReason} maxLength={300} onChange={(event) => setHistoricalReason(event.target.value)} placeholder="Ví dụ: PT xác nhận đã dạy nhưng ca chưa được ghi nhận trên hệ thống" /><small>{historicalReason.trim().length}/8 ký tự tối thiểu · lưu cùng nhật ký audit</small></label>}
                {inspectorSlotIsPast && pendingManualCandidate && pendingManualCandidate.reasons.length > 0 && <div className="schedule-manual-override-confirm"><AlertTriangle /><div><strong>Ca có lưu ý cần xác nhận</strong><p>{pendingManualCandidate.reasons.map(ptScheduleConflictLabel).join(' · ')} Lý do phía trên sẽ được lưu cùng các ngoại lệ này.</p></div></div>}
                {pendingManualCandidate?.studentBranchWarning && <div className="schedule-branch-confirm"><AlertTriangle /><div><strong>Xác nhận tập khác cơ sở</strong><p>{pendingManualCandidate.name} thuộc {branches.find((item) => item.id === pendingManualCandidate.studentHomeBranchId)?.name || 'cơ sở khác'} và sẽ tập tại {branches.find((item) => item.id === branchId)?.name || 'cơ sở đang xếp'}.</p></div></div>}
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
                    const immediate = canPlaceManualCandidateImmediately(candidate)
                    return <article key={candidate.studentId} className={`${candidate.eligible ? 'is-eligible' : manualSelectable ? 'is-override' : 'is-disabled'}${candidate.trainerAssignmentWarning ? ' has-assignment-warning' : ''}${candidate.studentBranchWarning ? ' has-branch-warning' : ''}${selected ? ' is-selected' : ''}`}><div><strong>{candidate.name}{(candidate.trainerAssignmentWarning || candidate.studentBranchWarning || (isAdmin && !candidate.eligible)) && <AlertTriangle size={13} aria-label={candidate.studentBranchWarning ? "Cần xác nhận khác cơ sở" : "Ca có lưu ý"} />}</strong><span>{candidateText}</span></div><button type="button" aria-label={immediate ? `Xếp ngay ${candidate.name}` : selected ? `Bỏ chọn ${candidate.name}` : `Chọn ${candidate.name}`} aria-pressed={selected} disabled={!manualSelectable || busy || !isAdmin && inspectorEntries.filter((entry) => entry.type !== 'off').length >= selectedTrainer.slotCapacity} onClick={() => { if (immediate) { setPendingManualCandidate(null); void confirmManualCandidate(candidate) } else setPendingManualCandidate((current) => current?.studentId === candidate.studentId ? null : candidate) }}>{selected ? <CheckCircle2 /> : <UserPlus />}</button></article>
                  })}
                </section>)}</div>
              </section>}
            </div>
            {!inspectorEntries.some((entry) => entry.type === 'off') && (inspectorSlotIsPast || pendingManualCandidate?.studentBranchWarning) && <footer className="schedule-manual-confirm"><div>{pendingManualCandidate ? <><span>{inspectorSlotIsPast ? 'Bổ sung lịch sử' : 'Đang chọn'}</span><strong>{pendingManualCandidate.name}</strong></> : <><span>Chưa chọn học viên</span><strong>Chọn một hồ sơ ở trên</strong></>}</div><button type="button" onClick={() => setPendingManualCandidate(null)} disabled={!pendingManualCandidate || busy}>Hủy</button><button type="button" className="is-confirm" disabled={!pendingManualCandidate || busy || (inspectorSlotIsPast && historicalReason.trim().length < 8)} onClick={() => void (inspectorSlotIsPast ? confirmHistoricalCandidate() : confirmManualCandidate())}>{busy ? 'Đang xác nhận…' : inspectorSlotIsPast ? 'Ghi nhận ca bổ sung' : 'Xác nhận xếp ca'}</button></footer>}
          </aside>
        </div>
      )}

      {publishPreview && <Suspense fallback={<div role="status">Đang tải xác nhận…</div>}><SchedulePublishDialog preview={publishPreview} branches={branches} branchName={workspace?.branch.name || ''} busy={busy} confirmed={publishCrossBranchConfirmed} dialogRef={activeDialogRef} onConfirmBranch={setPublishCrossBranchConfirmed} onClose={() => { setPublishPreview(null); setPublishCrossBranchConfirmed(false) }} onPublish={() => void confirmPublish()} /></Suspense>}

      {resetDraftOpen && <Suspense fallback={<div role="status">Đang tải xác nhận…</div>}><ScheduleResetDialog summary={draftResetSummary} busy={busy} dialogRef={activeDialogRef} onClose={() => setResetDraftOpen(false)} onReset={() => void resetDraft()} /></Suspense>}

    </div>
  )
}
