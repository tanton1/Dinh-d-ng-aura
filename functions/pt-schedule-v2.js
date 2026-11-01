'use strict'

const { createHash } = require('node:crypto')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trainerProfileForWeek, loadTrainerAvailability, loadTrainerAvailabilityWeeks } = require('./trainer-availability')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const {
  branchScheduleSnapshot,
  branchSlotCapacity,
  dateForSlot,
  documentId,
  nextWeek,
  normalizedCapacity,
  normalizedScheduleConfig,
  storedDate,
  trainerAvailabilityMode,
  trainerIsAvailable,
  weekId,
} = require('./pt-schedule-publish')
const {
  availabilityReopenForWeek,
  effectiveStudentAvailability,
  loadLatestSubmittedFallbacks,
  normalizeRequestedSessions,
  studentAvailabilityProfilePatch,
} = require('./student-availability')
const { summarizeContractUsage } = require('./contract-usage')
const { canonicalUsageSummary, loadContractUsageViews } = require('./contract-usage-view')
const { contractEffectiveOnDate, contractSchedulableOn, contractPausedOn, normalizedContractStatus, TERMINAL_CONTRACT_STATUSES } = require('./contract-status')
const {
  contractCanParticipateInWeek,
  contractSchedulingEntitlement,
  resolveSchedulingContract,
} = require('./contract-scheduling')
const { ptOperationsPolicySnapshot } = require('./pt-policy')
const { hiddenExpiredStudent, approvedContractOff, findScheduleContract, requireScheduleContract, confirmedStudentOff, entryOnApprovedOff, requireCrossBranchConfirmation } = require('./schedule-entitlement-policy')

const MAX_STUDENTS = 500
const MAX_TRAINERS = 100
// Keep the whole publish diff below Firestore's 500-write transaction limit.
// Real Aura branches currently contain more than 180 entries per week, so the
// previous guard rejected valid migrated drafts before the workspace loaded.
const MAX_DRAFT_ENTRIES = 440
// OFF markers do not create learner sessions during publish. Keep a separate
// document guard so PT leave markers never consume the atomic session budget,
// while a malformed draft still cannot grow without bounds.
const MAX_DRAFT_DOCUMENT_ENTRIES = 700
const MAX_ENTRIES_PER_SLOT = 100
const MAX_ACTIVE_RESERVATION_SESSIONS = 3000
const MAX_WEEKLY_COVERAGE_SESSIONS = 5000
const DEFAULT_DAILY_SESSION_TARGET = 8
const { trainerDailyLoadTarget } = require('./schedule-load-policy')
// Bump the generator version when the lexicographic quality objective changes.
// Existing drafts remain valid, but the version lets audit logs and the UI
// distinguish schedules generated with the coverage-first/full-target policy.
const OPTIMIZER_VERSION = 'optimizer-v16'
const MAX_DEEP_OPTIMIZATION_PASSES = 3
// A bounded repair search can relocate auto-generated sessions from earlier
// rounds. This closes the remaining gap between fair one-seat rounds and the
// maximum weekly coverage without making the callable response unpredictable.
const MAX_REPAIR_CHAIN_DEPTH = 4
const MAX_REPAIR_SEARCH_NODES = 12000
const MAX_CONTINUATION_SEARCH_NODES = 36000
const MAX_REPAIR_DIRECT_CANDIDATES = 80
const MAX_REPAIR_DISPLACEMENT_CANDIDATES = 120
const MAX_RESCUE_PLAN_CANDIDATES = 8
const MAX_RESCUE_LOOKAHEAD_STUDENTS = 120
// The 3-day audit is explanatory telemetry, not another solver pass. Keep it
// bounded so a large branch cannot turn the final summary into an N×M×K scan.
const MAX_THREE_DAY_AUDIT_STUDENTS = 120
const MAX_THREE_DAY_AUDIT_MOVES = 2000
const MAX_THREE_DAY_AUDIT_SLOTS_PER_STUDENT = 30
const MAX_THREE_DAY_AUDIT_TRAINERS = 40
// Capacity-aware cohort selection is intentionally bounded. The repair pass
// only runs when the selected learners' optimistic slot-seat upper bound is
// already below their reserved target demand, which keeps broad branches out
// of the extra matching simulations.
const MAX_COHORT_REPAIR_ATTEMPTS = 24
const MAX_COHORT_REPAIR_CANDIDATES = 32
const DAY_ORDER = new Map([['T2', 0], ['T3', 1], ['T4', 2], ['T5', 3], ['T6', 4], ['T7', 5], ['CN', 6]])
const STUDENT_AVAILABILITY_REASON_CODES = new Set(['AVAILABILITY_NOT_SUBMITTED', 'OUTSIDE_STUDENT_AVAILABILITY'])

function availabilityCutoff(weekId, policyValue = {}) {
  const policy = ptOperationsPolicySnapshot(policyValue)
  const monday = Date.parse(`${weekId}T00:00:00+07:00`)
  const daysBefore = (1 - policy.availabilityRegistrationCutoffDayOfWeek + 7) % 7 || 7
  return new Date(monday - daysBefore * 24 * 60 * 60 * 1000 + policy.availabilityRegistrationCutoffHour * 60 * 60 * 1000)
}

function availabilityWindowForWeek(weekId, policyValue = {}, availability = {}, now = new Date()) {
  const cutoffAt = availabilityCutoff(weekId, policyValue)
  const reopenedUntil = availabilityReopenForWeek({ ...availability, weekId }, weekId, now)
  return {
    cutoffAt,
    reopenedUntil,
    locked: now.getTime() >= cutoffAt.getTime() && !reopenedUntil,
  }
}

// A weekly availability document may have been written before the active
// policy changed. Do not let its persisted `locked` label permanently keep a
// week closed; derive the current status from the same cutoff used by the
// write guard and the student/PT self-service callables.
function availabilityStatusForWeek(availability, weekId, policyValue = {}, now = new Date()) {
  const status = availability?.status
  if (availability?.source !== 'weekly' || !['submitted', 'locked'].includes(status)) return status
  return availabilityWindowForWeek(weekId, policyValue, availability, now).locked ? 'locked' : 'submitted'
}
// The optimizer evaluates the same roster repeatedly (one matching round per
// weekly session). Keep immutable, derived roster indexes out of that hot
// loop. A WeakMap avoids retaining a loaded branch after the callable ends and
// the reference/length guards keep direct test/manual callers safe when they
// replace a roster array.
const scheduleIndexCache = new WeakMap()

// A branch/week workspace is assembled from a bounded but relatively wide
// Firestore fan-out (contracts, availability, sessions and leaves). Keep a
// short process-local read-through cache so an Admin switching A → B → A, or
// opening the picker immediately after the workspace, does not repeat that
// fan-out. Draft mutations call invalidateBranchDataCache below; the TTL is a
// final freshness bound for changes made by other operational tools. A minute
// and a half keeps repeated branch reads cached while still bounding changes
// that did not pass through a schedule mutation. This is process-local cache,
// not a reserved Cloud Run instance, so the service can still scale to zero.
const BRANCH_DATA_CACHE_TTL_MS = 90_000
const BRANCH_DATA_CACHE_LIMIT = 8
const branchDataCaches = new WeakMap()

function branchDataCacheFor(db) {
  let cache = branchDataCaches.get(db)
  if (!cache) {
    cache = { entries: new Map(), pending: new Map(), generations: new Map() }
    branchDataCaches.set(db, cache)
  }
  return cache
}

// Cross-branch Admin search used to scan the student collection and then run
// the full manual-validation fan-out for every match on every debounced
// keystroke. Keep only a small, projection-only index cached per process. The
// final command still performs canonical validation; this cache is only for
// finding a likely profile quickly and does not reserve a warm instance.
const CROSS_BRANCH_STUDENT_SEARCH_TTL_MS = 60_000
const CROSS_BRANCH_STUDENT_SEARCH_LIMIT = (MAX_STUDENTS * 3) + 1
const CROSS_BRANCH_STUDENT_INDEX_LIMIT = 50
// These fields are deliberately additive. Newer student writers can keep a
// normalized, lower-case projection here while older documents continue to
// work through the bounded compatibility fallback below. Querying the
// projection first avoids charging a 1,501-document collection scan for the
// common case (the Admin has already typed a useful search term).
const CROSS_BRANCH_STUDENT_INDEX_FIELDS = Object.freeze({
  name: ['scheduleSearchName'],
  phone: ['scheduleSearchPhone'],
  email: ['scheduleSearchEmail'],
})
const crossBranchStudentSearchCaches = new WeakMap()

function crossBranchStudentSearchCacheFor(db) {
  let cache = crossBranchStudentSearchCaches.get(db)
  if (!cache) {
    cache = { value: null, storedAt: 0, pending: null }
    crossBranchStudentSearchCaches.set(db, cache)
  }
  return cache
}

async function crossBranchStudentProfiles(db) {
  const cache = crossBranchStudentSearchCacheFor(db)
  const now = Date.now()
  if (cache.value && now - cache.storedAt < CROSS_BRANCH_STUDENT_SEARCH_TTL_MS) return cache.value
  if (cache.pending) return cache.pending
  cache.pending = db.collection('students').limit(CROSS_BRANCH_STUDENT_SEARCH_LIMIT).get()
    .then((snapshot) => snapshot.docs.map((item) => {
      const profile = item.data() || {}
      return {
        id: item.id,
        name: profile.name || '',
        phone: profile.phone || '',
        email: profile.email || '',
        branchId: profile.branchId || '',
      }
    }))
    .then((value) => {
      cache.value = value
      cache.storedAt = Date.now()
      return value
    })
    .finally(() => {
      cache.pending = null
    })
  return cache.pending
}

function studentSearchProjection(snapshot) {
  const profile = snapshot.data() || {}
  return {
    id: snapshot.id,
    name: profile.name || '',
    phone: profile.phone || '',
    email: profile.email || '',
    branchId: profile.branchId || '',
  }
}

function searchPrefixEnd(value) {
  return `${value}\uf8ff`
}

/**
 * Resolve cross-branch candidates from denormalized search fields first.
 *
 * Firestore cannot efficiently answer a case/diacritic-insensitive contains
 * query on the canonical student fields. The schedule search projection is
 * therefore queried as a prefix range. The legacy bounded scan is retained
 * only as a compatibility path for documents written before the projection
 * existed; it is also cached for the process TTL and keeps the old result
 * semantics for existing data/tests during migration.
 */
async function indexedCrossBranchStudentProfiles(db, search, rawSearch = search) {
  if (!search || search.length < 2) return []
  const rawPrefix = String(rawSearch || '').trim()
  const fieldGroup = rawPrefix.includes('@')
    ? 'email'
    : /^\d/.test(rawPrefix)
      ? 'phone'
      : 'name'
  const queries = CROSS_BRANCH_STUDENT_INDEX_FIELDS[fieldGroup]
    .map((field) => ({ field, prefix: search }))
    .filter(({ prefix }) => prefix.length >= 2)
    .map(({ field, prefix }) => (
    db.collection('students')
      .where(field, '>=', prefix)
      .where(field, '<', searchPrefixEnd(prefix))
      .limit(CROSS_BRANCH_STUDENT_INDEX_LIMIT)
      .get()
  ))
  const snapshots = await Promise.allSettled(queries)
  const profiles = new Map()
  snapshots.forEach((result) => {
    if (result.status !== 'fulfilled') return
    result.value.docs.forEach((snapshot) => profiles.set(snapshot.id, studentSearchProjection(snapshot)))
  })
  return [...profiles.values()]
}

async function crossBranchStudentProfilesForSearch(db, search, rawSearch = search, branchId = '') {
  const cache = crossBranchStudentSearchCacheFor(db)
  const now = Date.now()
  const cacheKey = `${String(branchId || '')}|${String(search || '')}|${String(rawSearch || '')}`
  if (!cache.searches) cache.searches = new Map()
  const cached = cache.searches.get(cacheKey)
  if (cached && now - cached.storedAt < CROSS_BRANCH_STUDENT_SEARCH_TTL_MS) return cached.value
  if (!cache.searchPending) cache.searchPending = new Map()
  if (cache.searchPending.has(cacheKey)) return cache.searchPending.get(cacheKey)

  const pending = indexedCrossBranchStudentProfiles(db, search, rawSearch)
    .then(async (indexed) => {
      // A local indexed hit must not hide an older external-branch document
      // that has not received the additive projection yet. Merge the bounded
      // compatibility scan only when the prefix result has no external
      // branch; the scan itself remains process-cached for the search TTL.
      const hasExternalIndexedMatch = indexed.some((profile) => profile.branchId && profile.branchId !== branchId)
      const legacy = !indexed.length || (branchId && !hasExternalIndexedMatch)
        ? await crossBranchStudentProfiles(db)
        : []
      const legacyMatches = legacy.filter((profile) => (
        normalizedSearchText(profile.name).includes(search)
          || normalizedSearchText(profile.phone).includes(search)
          || normalizedSearchText(profile.email).includes(search)
      ))
      const value = [...new Map([...indexed, ...legacyMatches].map((profile) => [profile.id, profile])).values()]
      cache.searches.set(cacheKey, { value, storedAt: Date.now() })
      return value
    })
    .finally(() => cache.searchPending.delete(cacheKey))
  cache.searchPending.set(cacheKey, pending)
  return pending
}

function invalidateBranchDataCache(db, branchId = '', week = '') {
  const cache = branchDataCaches.get(db)
  if (!cache) return
  const prefix = branchId && week ? `${branchId}|${week}` : branchId ? `${branchId}|` : ''
  if (!prefix) {
    cache.entries.clear()
    for (const key of new Set([...cache.generations.keys(), ...cache.pending.keys()])) cache.generations.set(key, (cache.generations.get(key) || 0) + 1)
    return
  }
  for (const key of new Set([...cache.entries.keys(), ...cache.pending.keys()])) {
    if (key === prefix || key.startsWith(prefix)) {
      cache.entries.delete(key)
      cache.generations.set(key, (cache.generations.get(key) || 0) + 1)
    }
  }
}

function normalizedSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLocaleLowerCase('vi')
    .trim()
}

function draftId(branchId, week) {
  return `${branchId}_${week}`
}

function draftReference(db, branchId, week) {
  return db.doc(`ptScheduleDrafts/${draftId(branchId, week)}`)
}

// Quick weekly target changes are operational inputs, not draft revisions.
// Keep them in their own deterministic document so a PT can adjust a learner
// before the schedule draft exists (or without creating a new draft revision).
function weeklyTargetOverrideReference(db, branchId, week) {
  return db.doc(`ptScheduleTargetOverrides/${draftId(branchId, week)}`)
}

function weeklySessionTargetsForWeek(draftData, overrideData, allowedStudentIds = null) {
  return {
    ...safeWeeklySessionTargets(draftData?.weeklySessionTargets, allowedStudentIds),
    ...safeWeeklySessionTargets(overrideData?.targets, allowedStudentIds),
  }
}

// Drafts are an operational workspace, not a second history store. Keep a
// short expiry marker on every new revision so Firestore TTL/maintenance can
// remove weeks that are no longer being worked on. Published sessions,
// versions and audit events remain the durable history.
function draftExpiresAt(week) {
  const nextWeekStart = Date.parse(`${nextWeek(week)}T00:00:00+07:00`)
  return Number.isFinite(nextWeekStart)
    ? Timestamp.fromMillis(nextWeekStart + 48 * 60 * 60 * 1000)
    : null
}

function scopedDraftData(snapshot, branchId, week) {
  if (!snapshot?.exists) return null
  const value = snapshot.data() || {}
  if (value.branchId && value.branchId !== branchId) return null
  if (value.weekId && value.weekId !== week) return null
  const expiresAt = value.expiresAt?.toMillis?.()
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return null
  return value
}

function previousWeek(week) {
  const date = new Date(`${week}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() - 7)
  return date.toISOString().slice(0, 10)
}

function safeWeeklySessionTargets(value, allowedStudentIds = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const allowed = allowedStudentIds instanceof Set ? allowedStudentIds : null
  return Object.fromEntries(Object.entries(value)
    .filter(([studentId, target]) => (!allowed || allowed.has(studentId))
      && typeof studentId === 'string'
      && studentId.length > 0
      && studentId.length <= 200
      && Number.isInteger(Number(target))
      && Number(target) >= 0
      && Number(target) <= 7)
    .map(([studentId, target]) => [studentId, Number(target)]))
}

function weeklyTargetForStudent(defaultValue, overrideValue, eligibility) {
  const defaultSessionsPerWeek = Math.max(0, Math.min(7, Number(defaultValue || 0)))
  const weeklySessionTargetOverride = overrideValue === null || overrideValue === undefined
    ? null
    : Math.max(0, Math.min(7, Number(overrideValue || 0)))
  const maxWeeklySessions = Math.max(0, Math.min(7, Number(eligibility?.remainingSessions || 0)))
  const requestedSessions = weeklySessionTargetOverride ?? defaultSessionsPerWeek
  return {
    defaultSessionsPerWeek,
    weeklySessionTargetOverride,
    weeklySessionTargetOverridden: weeklySessionTargetOverride !== null,
    maxWeeklySessions,
    schedulableSessionsThisWeek: Math.max(0, Math.min(maxWeeklySessions, Array.isArray(eligibility?.validDates) ? eligibility.validDates.length : 0)),
    sessionsPerWeek: Math.min(requestedSessions, maxWeeklySessions),
  }
}

function normalizedScheduleAvailabilitySlots(value, config) {
  if (!Array.isArray(value) || value.length > 100) throw new HttpsError('invalid-argument', 'Ma trận thời gian rảnh không hợp lệ.')
  const allowed = new Set(config.workingDays.flatMap((day) => config.workingHours.map((hour) => `${day}-${hour}`)))
  const slots = [...new Set(value.map((slot) => typeof slot === 'string' ? slot.trim() : ''))]
  if (slots.some((slot) => !allowed.has(slot))) throw new HttpsError('invalid-argument', 'Có khung giờ nằm ngoài lịch hoạt động.')
  return slots.sort((left, right) => {
    const [leftDay, leftHour] = left.split('-')
    const [rightDay, rightHour] = right.split('-')
    return (DAY_ORDER.get(leftDay) ?? 99) - (DAY_ORDER.get(rightDay) ?? 99) || Number(leftHour) - Number(rightHour)
  })
}

function activeAdministrator(actor) {
  return actor.accessRole === 'admin' || actor.accessRole === 'super_admin'
}

const MAX_ADMIN_OVERRIDE_WARNINGS = 32

function adminOverrideMetadata(entry) {
  if (entry?.type === 'off' || entry?.adminOverride !== true
    || (entry.source !== 'manual_v2' && !(entry.source === 'published_existing' && confirmedStudentOff(entry)))) return null
  const warnings = Array.isArray(entry.adminOverrideWarnings)
    ? [...new Set(entry.adminOverrideWarnings.filter((value) => typeof value === 'string').slice(0, MAX_ADMIN_OVERRIDE_WARNINGS))]
    : []
  return {
    adminOverride: true,
    adminOverrideBy: typeof entry.adminOverrideBy === 'string' ? entry.adminOverrideBy.slice(0, 200) : '',
    adminOverrideAt: typeof entry.adminOverrideAt === 'string' ? entry.adminOverrideAt.slice(0, 40) : '',
    ...(confirmedStudentOff(entry) ? { studentOffConfirmedDate: entry.studentOffConfirmedDate } : {}),
    ...(warnings.length ? { adminOverrideWarnings: warnings } : {}),
  }
}

async function scheduleActor(request, db, branchId) {
  const actor = await trustedAccessContext(request, db)
  if (activeAdministrator(actor)) {
    requireCapability(actor, 'pt.operations.manage')
    return actor
  }
  requireCapability(actor, 'pt.schedule.branch.publish')
  if (!actor.branchIds.includes(branchId)) throw new HttpsError('permission-denied', 'Chi nhánh nằm ngoài phạm vi được cấp.')
  return actor
}

function safeSchedule(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  let documentEntryCount = 0
  let trainingEntryCount = 0
  for (const [slotId, entries] of Object.entries(value)) {
    if (!/^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/.test(slotId) || !Array.isArray(entries)) continue
    if (entries.length > MAX_ENTRIES_PER_SLOT) throw new HttpsError('resource-exhausted', 'Một khung giờ có quá nhiều dữ liệu.')
    const normalized = entries.map((entry) => {
      const type = entry?.type === 'off' ? 'off' : 'training'
      const source = typeof entry?.source === 'string' ? entry.source.slice(0, 40) : ''
      const availabilityOverrideReason = STUDENT_AVAILABILITY_REASON_CODES.has(entry?.availabilityOverrideReason)
        ? entry.availabilityOverrideReason
        : ''
      const availabilityOverride = type === 'training'
        && source === 'manual_v2'
        && entry?.availabilityOverride === true
        && Boolean(availabilityOverrideReason)
      return {
        studentId: type === 'off' ? 'OFF' : String(entry?.studentId || ''),
        trainerId: String(entry?.trainerId || ''),
        branchId: String(entry?.branchId || ''),
        type,
        ...(entry?.contractId ? { contractId: String(entry.contractId) } : {}),
        ...(entry?.renewalHandoverPending === true && entry?.sourceContractId ? {
          renewalHandoverPending: true,
          sourceContractId: String(entry.sourceContractId),
        } : {}),
        ...(entry?.isLocked === true ? { isLocked: true } : {}),
        ...(entry?.trainerAssignmentWarning === true ? { trainerAssignmentWarning: true } : {}),
        ...(entry?.studentBranchWarning === true ? {
          studentBranchWarning: true,
          studentHomeBranchId: typeof entry?.studentHomeBranchId === 'string' ? entry.studentHomeBranchId.slice(0, 200) : '',
        } : {}),
        ...(adminOverrideMetadata({ ...entry, type, source }) || {}),
        ...(source ? { source } : {}),
        ...(availabilityOverride ? {
          availabilityOverride: true,
          availabilityOverrideReason,
          availabilityOverrideBy: typeof entry?.availabilityOverrideBy === 'string' ? entry.availabilityOverrideBy.slice(0, 200) : '',
          availabilityOverrideAt: typeof entry?.availabilityOverrideAt === 'string' ? entry.availabilityOverrideAt.slice(0, 40) : '',
        } : {}),
      }
    }).filter((entry) => entry.trainerId && (entry.type === 'off' || entry.studentId))
    documentEntryCount += normalized.length
    trainingEntryCount += normalized.filter((entry) => entry.type !== 'off').length
    if (normalized.length) result[slotId] = normalized
  }
  if (documentEntryCount > MAX_DRAFT_DOCUMENT_ENTRIES || trainingEntryCount > MAX_DRAFT_ENTRIES) {
    throw new HttpsError('resource-exhausted', 'Draft vượt giới hạn an toàn.')
  }
  return result
}

function splitChunks(values, size = 30) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

// Trainer projections may come from legacy `trainers` documents or the newer
// Identity v2 staff projection. Treat every non-operational state as locked
// for scheduling while retaining the row for historical name resolution.
function trainerIsLocked(trainer = {}) {
  if (!trainer || trainer.disabled === true) return true
  const lockedStatuses = new Set(['inactive', 'suspended', 'locked', 'disabled', 'archived', 'deleted', 'invited'])
  return [trainer.status, trainer.accessStatus, trainer.operationalStatus, trainer.accountStatus]
    .some((value) => typeof value === 'string' && lockedStatuses.has(value.trim().toLowerCase()))
}

// Resolve a bounded set of profile documents without widening a branch
// workspace into a full CRM read. Cross-branch learners only enter this path
// when they are already referenced by the selected week's draft/session data.
async function documentsByIds(db, collection, ids) {
  const uniqueIds = [...new Set(ids.filter((value) => typeof value === 'string' && value.length > 0))]
  if (!uniqueIds.length) return []
  const snapshots = await Promise.all(splitChunks(uniqueIds, 100).map(async (chunk) => {
    const references = chunk.map((id) => db.doc(`${collection}/${id}`))
    if (typeof db.getAll === 'function') return db.getAll(...references)
    return Promise.all(references.map((reference) => reference.get()))
  }))
  return snapshots.flat().filter((snapshot) => snapshot?.exists)
}

function indexContractsByStudent(contracts = []) {
  const index = new Map()
  for (const contract of contracts) {
    const studentId = contract?.studentId
    if (!studentId) continue
    const list = index.get(studentId) || []
    list.push(contract)
    index.set(studentId, list)
  }
  return index
}

function scheduleIndexes(data) {
  if (!data || typeof data !== 'object') return {
    contractsByStudent: new Map(),
    contractsById: new Map(),
    sortedTrainers: [],
    trainersById: new Map(),
    trainersBySlot: new Map(),
    candidateTrainersBySlot: new Map(),
    weightedDemandBySlot: new Map(),
    trainerAvailabilityById: new Map(),
    leavesByTrainer: new Map(),
    studentSlotsById: new Map(),
    studentSlotSetsById: new Map(),
    workingDays: [],
    workingHours: [],
    holidays: new Set(),
  }
  const contracts = Array.isArray(data.contracts) ? data.contracts : []
  const trainers = Array.isArray(data.trainers) ? data.trainers : []
  const students = Array.isArray(data.students) ? data.students : []
  const leaves = Array.isArray(data.leaves) ? data.leaves : []
  const previous = scheduleIndexCache.get(data)
  if (previous
    && previous.contractsRef === contracts
    && previous.contractCount === contracts.length
    && previous.trainersRef === trainers
    && previous.trainerCount === trainers.length
    && previous.studentsRef === students
    && previous.studentCount === students.length
    && previous.leavesRef === leaves
    && previous.leaveCount === leaves.length) return previous

  const contractsByStudent = data.contractsByStudent instanceof Map
    ? data.contractsByStudent
    : indexContractsByStudent(contracts)
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]))
  const sortedTrainers = [...trainers].sort((left, right) => left.id.localeCompare(right.id))
  const trainersById = new Map(sortedTrainers.map((trainer) => [trainer.id, trainer]))
  const trainerAvailabilityById = new Map()
  for (const trainer of sortedTrainers) {
    const mode = trainerAvailabilityMode(trainer)
    trainerAvailabilityById.set(trainer.id, {
      mode,
      slots: Array.isArray(trainer.availableSlots) ? new Set(trainer.availableSlots) : new Set(),
    })
  }
  const studentSlotsById = new Map()
  const studentSlotSetsById = new Map()
  const allStudentSlots = new Set()
  for (const student of students) {
    const slots = [...new Set(Array.isArray(student.availableSlots) ? student.availableSlots : [])].sort(compareSlots)
    studentSlotsById.set(student.id, slots)
    studentSlotSetsById.set(student.id, new Set(slots))
    slots.forEach((slotId) => allStudentSlots.add(slotId))
  }
  const trainersBySlot = new Map()
  for (const slotId of allStudentSlots) {
    const available = sortedTrainers.filter((trainer) => {
      if (!trainer || trainerIsLocked(trainer) || trainer.branchId !== data.branch?.id) return false
      const profile = trainerAvailabilityById.get(trainer.id)
      if (!profile || profile.mode === 'unconfigured') return false
      if (trainer.employmentType === 'collaborator') return profile.slots.has(slotId)
      return profile.mode === 'unrestricted' || profile.slots.has(slotId)
    })
    if (available.length) trainersBySlot.set(slotId, available)
  }
  // Most branches have many PTs but only a handful of learner-seats needed in
  // any one hour. Keep every trainer for a genuinely concentrated slot, while
  // limiting broad availability to the number of seats the weekly demand can
  // actually consume. Preferred/occupied PTs are added back per learner in
  // feasibleCandidatesForStudent, so this is a safe Cartesian-product bound,
  // not a hard scheduling capacity.
  const weightedDemandBySlot = new Map()
  for (const student of students) {
    if (student.status === 'inactive' || student.eligibleForWeek === false) continue
    const slots = studentSlotsById.get(student.id) || []
    if (!slots.length) continue
    const demand = Math.max(0, Number(student.sessionsPerWeek || 0)) / slots.length
    for (const slotId of slots) weightedDemandBySlot.set(slotId, (weightedDemandBySlot.get(slotId) || 0) + demand)
  }
  const candidateTrainersBySlot = new Map()
  for (const [slotId, available] of trainersBySlot) {
    const configuredCapacity = branchSlotCapacity(data.config, data.branch?.id, slotId)
    const requiredSeats = Math.max(1, Math.ceil(Math.min(
      Number(weightedDemandBySlot.get(slotId) || 1),
      configuredCapacity === null ? Number.POSITIVE_INFINITY : configuredCapacity,
    )))
    const orderedAvailable = [...available].sort((left, right) => {
      const leftPolicy = trainerSchedulingPolicy(left, data.config)
      const rightPolicy = trainerSchedulingPolicy(right, data.config)
      const leftTier = schedulingTier({ ...leftPolicy, employmentType: leftPolicy.employmentType, currentDailyLoad: 0 })
      const rightTier = schedulingTier({ ...rightPolicy, employmentType: rightPolicy.employmentType, currentDailyLoad: 0 })
      return leftTier - rightTier
        || leftPolicy.schedulingPriority - rightPolicy.schedulingPriority
        || left.id.localeCompare(right.id)
    })
    const selected = []
    let seats = 0
    for (const trainer of orderedAvailable) {
      selected.push(trainer)
      seats += Math.max(1, Number(trainer.slotCapacity || 1))
      // Retain at least two generic PT choices when possible. This keeps the
      // soft load-balancer effective for equal-demand learners while still
      // shrinking a 100-PT Cartesian product to the seats the slot needs.
      if (seats >= requiredSeats && selected.length >= Math.min(2, orderedAvailable.length)) break
    }
    candidateTrainersBySlot.set(slotId, selected.length ? selected : orderedAvailable)
  }
  const leavesByTrainer = new Map()
  for (const leave of leaves) {
    if (!leave?.trainerId) continue
    const rows = leavesByTrainer.get(leave.trainerId) || []
    rows.push(leave)
    leavesByTrainer.set(leave.trainerId, rows)
  }
  const config = data.config || {}
  const workingDays = Array.isArray(config.workingDays) ? config.workingDays : []
  const workingHours = Array.isArray(config.workingHours) ? config.workingHours.map(Number) : []
  const result = {
    contractsRef: contracts,
    contractCount: contracts.length,
    trainersRef: trainers,
    trainerCount: trainers.length,
    studentsRef: students,
    studentCount: students.length,
    leavesRef: leaves,
    leaveCount: leaves.length,
    contractsByStudent,
    contractsById,
    sortedTrainers,
    trainersById,
    trainersBySlot,
    candidateTrainersBySlot,
    weightedDemandBySlot,
    trainerAvailabilityById,
    leavesByTrainer,
    studentSlotsById,
    studentSlotSetsById,
    workingDays,
    workingHours,
    holidays: new Set(Array.isArray(config.holidays) ? config.holidays : []),
  }
  scheduleIndexCache.set(data, result)
  return result
}

async function contractsForStudents(db, studentIds) {
  if (!studentIds.length) return []
  // Load the complete bounded contract chain for each learner. A renewal that
  // starts later in the selected week is normally stored as `future`; hiding
  // it here creates an artificial gap between the source and next contract.
  // Order by the existing equality field so Enterprise can use its learner
  // index for multi-learner batches instead of scanning all contract payloads.
  const snapshots = await Promise.all(splitChunks(studentIds).map((ids) => db.collection('contracts')
    .where('studentId', 'in', ids)
    .orderBy('studentId')
    .get()))
  const unique = new Map()
  snapshots.flatMap((snapshot) => snapshot.docs).forEach((item) => unique.set(item.id, { id: item.id, ...item.data() }))
  return [...unique.values()]
}

async function exactAvailabilityForStudents(db, studentIds, week) {
  if (!studentIds.length) return []
  const snapshots = await Promise.all(splitChunks(studentIds, 100).map((ids) => db.getAll(
    ...ids.map((studentId) => db.doc(`ptAvailability/${studentId}_${week}`)),
  )))
  return snapshots.flat().filter((item) => item.exists)
}

async function effectiveAvailabilityForTrainers(db, trainerIds, week) {
  return (await loadTrainerAvailabilityWeeks(db, [...trainerIds].map((trainerId) => ({ trainerId, weekId: week })))).filter((item) => item.exists)
}

async function activeSessionsForStudents(db, studentIds, week) {
  if (!studentIds.length) return []
  // Do not scan every scheduled session in the project. Quota reservations
  // are learner-scoped, so query only the students that can affect this
  // branch/week and only from the selected week forward. Firestore permits
  // one `in` filter per query, so issue the two small status queries in
  // parallel rather than reading completed or cancelled history and filtering
  // it after the fact.
  const snapshots = await Promise.all(['scheduled', 'rescheduled'].flatMap((status) => splitChunks(studentIds, 30).map((ids) => db.collection('sessions')
    .where('studentId', 'in', ids)
    .where('status', '==', status)
    .where('date', '>=', week)
    .limit(1001)
    .get())))
  const documents = snapshots.flatMap((snapshot) => snapshot.docs)
  if (snapshots.some((snapshot) => snapshot.size > 1000) || documents.length > MAX_ACTIVE_RESERVATION_SESSIONS) {
    throw new HttpsError('resource-exhausted', 'Số buổi đang giữ chỗ vượt giới hạn workspace an toàn.')
  }
  return documents
}

// The optimizer needs future reservations from the selected week onward, but
// the warning center needs a different, exact view: how many sessions the
// learner already has in the selected calendar week at every branch. Keep
// this read bounded to the selected branch roster and week so it does not turn
// the workspace into a project-wide sessions scan.
async function weeklySessionsForStudents(db, studentIds, week) {
  if (!studentIds.length) return []
  // Align with the learner/date index. Both fields already occur in filters,
  // so ordering adds no field-existence restriction or new coverage limit.
  const snapshots = await Promise.all(splitChunks(studentIds, 30).map((ids) => db.collection('sessions')
    .where('studentId', 'in', ids)
    .where('date', '>=', week)
    .where('date', '<', nextWeek(week))
    .orderBy('studentId')
    .orderBy('date')
    .limit(1001)
    .get()))
  const documents = snapshots.flatMap((snapshot) => snapshot.docs)
  if (snapshots.some((snapshot) => snapshot.size > 1000) || documents.length > MAX_WEEKLY_COVERAGE_SESSIONS) {
    throw new HttpsError('resource-exhausted', 'Số buổi trong tuần vượt giới hạn đối soát an toàn.')
  }
  return documents
}

// A learner can be placed in another branch while both branch workspaces are
// still drafts. Those placements are not sessions yet, so a session-only
// coverage read incorrectly reports the learner as missing. Keep the draft
// projection small: only the learner, branch, date, hour and PT are needed by
// the warning center. Publish/session reads remain the source of attendance
// and billing truth.
async function weeklyDraftScheduleEntriesForStudents(db, studentIds, week) {
  if (!studentIds.length) return []
  const snapshot = await db.collection('ptScheduleDrafts')
    .where('weekId', '==', week)
    .limit(1001)
    .get()
  if (snapshot.size > 1000) throw new HttpsError('resource-exhausted', 'Số draft lịch trong tuần vượt giới hạn đối soát an toàn.')
  const allowed = new Set(studentIds)
  const entries = []
  for (const document of snapshot.docs) {
    const data = document.data() || {}
    const branchId = typeof data.branchId === 'string' && data.branchId
      ? data.branchId
      : String(document.id || '').split('_')[0]
    const schedule = safeSchedule(data.schedule)
    for (const [slotId, slotEntries] of Object.entries(schedule)) {
      const [day, rawHour] = slotId.split('-')
      const hour = Number(rawHour)
      if (!DAY_ORDER.has(day) || !Number.isInteger(hour)) continue
      for (const entry of slotEntries) {
        if (entry.type === 'off' || !allowed.has(entry.studentId)) continue
        entries.push({
          id: `draft:${document.id}:${slotId}:${entry.studentId}:${entry.trainerId}`,
          studentId: entry.studentId,
          branchId,
          date: dateForSlot(week, day),
          hour,
          trainerId: entry.trainerId || '',
          status: 'scheduled',
          ...(adminOverrideMetadata(entry) || {}),
        })
      }
    }
  }
  return entries
}

function weeklySessionCoverageForStudents({ weekId, branchId, sessions = [], scheduleEntries = [], contracts = [] } = {}) {
  const coverage = {}
  const seenSessionIds = new Set()
  const seenSessionKeys = new Set()
  const weekEnd = nextWeek(weekId)
  // Draft rows come first so a just-saved move wins over the older session
  // row until Publish reconciles the two sources.
  for (const session of [...scheduleEntries, ...sessions]) {
    const studentId = typeof session?.studentId === 'string' ? session.studentId : ''
    const date = storedDate(session?.date)
    if (!studentId || !date || date < weekId || date >= weekEnd || !historicalSessionOccupies(session)) continue
    if (approvedContractOff(contracts, studentId, date) && !confirmedStudentOff(session)) continue
    const sessionBranchId = typeof session?.branchId === 'string' && session.branchId ? session.branchId : 'unknown'
    const hour = Number.isInteger(Number(session?.hour)) ? Number(session.hour) : -1
    // One learner cannot consume two weekly sessions at the same physical
    // slot. Omitting trainerId also lets a draft move from one PT to another
    // replace the old session without double-counting the learner.
    const sessionKey = `${studentId}|${date}|${hour}|${sessionBranchId}`
    // Firestore document ids are canonical. The fallback key protects the
    // projection from duplicated legacy rows that were imported without ids.
    if ((session?.id && seenSessionIds.has(session.id)) || seenSessionKeys.has(sessionKey)) continue
    if (session?.id) seenSessionIds.add(session.id)
    seenSessionKeys.add(sessionKey)
    const row = coverage[studentId] || {
      total: 0,
      currentBranch: 0,
      otherBranches: 0,
      byBranch: {},
      dates: [],
      entries: [],
    }
    row.total += 1
    if (sessionBranchId !== 'unknown' && sessionBranchId === branchId) row.currentBranch += 1
    else row.otherBranches += 1
    row.byBranch[sessionBranchId] = (row.byBranch[sessionBranchId] || 0) + 1
    if (!row.dates.includes(date)) row.dates.push(date)
    row.entries.push({
      id: String(session?.id || sessionKey),
      branchId: sessionBranchId,
      date,
      hour: hour >= 0 ? hour : null,
      trainerId: typeof session?.trainerId === 'string' ? session.trainerId : '',
      ...(confirmedStudentOff(session) ? { studentOffConfirmed: true } : {}),
    })
    coverage[studentId] = row
  }
  return Object.fromEntries(Object.entries(coverage).map(([studentId, row]) => [studentId, {
    ...row,
    dates: row.dates.sort(),
    entries: row.entries.sort((left, right) => String(left.date).localeCompare(String(right.date))
      || Number(left.hour ?? 99) - Number(right.hour ?? 99)
      || String(left.branchId).localeCompare(String(right.branchId))),
  }]))
}

// Keep raw deployed-session conflicts available to the workspace warning
// center. The compact weekly coverage projection deliberately collapses a
// duplicate document at the same learner/date/hour/branch so it cannot inflate
// entitlement counts; that projection therefore cannot be the source for a
// duplicate-data warning. Inspect the raw session rows before that collapse.
function scheduleConflictWarningsForWorkspace({ weekId, sessions = [] } = {}) {
  const active = sessions.filter((session) => {
    const date = storedDate(session?.date)
    return Boolean(session?.studentId)
      && Boolean(date)
      && date >= weekId
      && date < nextWeek(weekId)
      && historicalSessionOccupies(session)
      && String(session?.scheduleStatus || '').toLowerCase() !== 'cancelled'
      && publishedSessionSlotId(weekId, session)
  }).map((session) => ({
    session,
    date: storedDate(session.date),
    slotId: publishedSessionSlotId(weekId, session),
    branchId: typeof session.branchId === 'string' && session.branchId ? session.branchId : 'unknown',
  })).filter((row) => row.slotId)
  const warnings = []
  const byCell = new Map()
  const byStudentDate = new Map()
  for (const row of active) {
    const cellKey = `${row.session.studentId}|${row.slotId}|${row.branchId}`
    const cellRows = byCell.get(cellKey) || []
    cellRows.push(row)
    byCell.set(cellKey, cellRows)
    const dayKey = `${row.session.studentId}|${row.date}`
    const dayRows = byStudentDate.get(dayKey) || []
    dayRows.push(row)
    byStudentDate.set(dayKey, dayRows)
  }
  for (const rows of byCell.values()) {
    if (rows.length < 2) continue
    const canonical = rows[0]
    for (const duplicate of rows.slice(1)) {
      warnings.push({
        code: 'DUPLICATE_DEPLOYED_SESSION',
        studentId: duplicate.session.studentId,
        trainerId: duplicate.session.trainerId || '',
        slotId: duplicate.slotId,
        branchId: duplicate.branchId,
        duplicateSessionId: duplicate.session.id || null,
        canonicalSessionId: canonical.session.id || null,
      })
    }
  }
  for (const rows of byStudentDate.values()) {
    if (rows.length < 2) continue
    const distinctSlots = new Set(rows.map((row) => `${row.slotId}|${row.branchId}`))
    if (distinctSlots.size < 2) continue
    for (const row of rows) {
      warnings.push({
        code: 'STUDENT_MULTIPLE_SESSIONS_PER_DAY',
        studentId: row.session.studentId,
        trainerId: row.session.trainerId || '',
        slotId: row.slotId,
        branchId: row.branchId,
        date: row.date,
      })
    }
  }
  return warnings
}

async function approvedLeavesForTrainers(db, trainerIds) {
  const ids = [...trainerIds]
  if (!ids.length) return []
  // Leave requests are consumed only for PT availability. The previous
  // status-only query read up to 1,001 approved requests from every branch on
  // every workspace load. Chunking by the already-loaded trainer ids keeps
  // the read set local to the selected branch.
  const snapshots = await Promise.all(splitChunks(ids, 30).map((chunk) => db.collection('leaveRequests')
    .where('trainerId', 'in', chunk)
    .limit(1001)
    .get()))
  return snapshots.flatMap((snapshot) => snapshot.docs).filter((item) => item.data()?.status === 'approved')
}

function leaveCovers(leave, trainerId, date) {
  if (leave?.status !== 'approved' || leave?.trainerId !== trainerId) return false
  const start = storedDate(leave.startDate)
  const end = storedDate(leave.endDate || leave.startDate)
  return Boolean(start && end && date >= start && date <= end)
}

function initialStudentProjection(item, branchId, displayOnly = false, week = '', policyValue = {}, weeklyTargets = {}) {
  const data = item.data() || {}
  const inactive = ['inactive', 'archived', 'deleted'].includes(String(data.status || '').toLowerCase())
  const defaultSessionsPerWeek = Math.max(0, Math.min(7, Number(data.sessionsPerWeek || 0)))
  const hasWeeklyTarget = Object.prototype.hasOwnProperty.call(weeklyTargets || {}, item.id)
  const weeklyTarget = hasWeeklyTarget
    ? Math.max(0, Math.min(7, Number(weeklyTargets[item.id] || 0)))
    : defaultSessionsPerWeek
  const availableSlots = Array.isArray(data.availableSlots) ? data.availableSlots.slice(0, 100) : []
  const storedWeekId = data.latestSubmittedAvailability?.weekId || data.availabilityWeekId || ''
  const storedAvailability = {
    source: data.availabilitySource === 'weekly' || storedWeekId === week ? 'weekly' : data.availabilitySource,
    status: data.availabilityStatus,
    reopenedUntil: availabilityReopenForWeek(data, week)?.toISOString() || null,
  }
  const availabilityWindow = week ? availabilityWindowForWeek(week, policyValue, storedAvailability) : null
  const availabilityStatus = week
    ? availabilityStatusForWeek(storedAvailability, week, policyValue)
    : data.availabilityStatus
  return {
    id: item.id,
    name: data.name || 'Chưa cập nhật tên',
    phone: data.phone || '',
    email: data.email || '',
    status: data.status || 'active',
    branchId: data.branchId || branchId,
    ...(displayOnly ? { isCrossBranchDisplayOnly: true, studentBranchWarning: true, studentHomeBranchId: data.branchId } : {}),
    sessionsPerWeek: weeklyTarget,
    defaultSessionsPerWeek,
    weeklySessionTargetOverride: hasWeeklyTarget ? weeklyTarget : null,
    weeklySessionTargetOverridden: hasWeeklyTarget,
    availabilityRequestedSessions: null,
    availabilityTargetOverridden: false,
    maxWeeklySessions: defaultSessionsPerWeek,
    schedulableSessionsThisWeek: defaultSessionsPerWeek,
    availableSlots,
    availabilityStatus: availabilityStatus || (availableSlots.length ? 'recurring' : 'missing'),
    availabilityLocked: availabilityWindow?.locked === true,
    availabilityCutoffAt: availabilityWindow?.cutoffAt.toISOString() || null,
    availabilityReopenedUntil: availabilityWindow?.reopenedUntil?.toISOString() || null,
    availabilityRevision: Number(data.availabilityRevision || 0),
    availabilitySourceRevision: Number(data.availabilitySourceRevision || 0),
    availabilitySourceWeekId: data.availabilitySourceWeekId || null,
    availabilitySource: data.availabilitySource || (availableSlots.length ? 'legacy_default' : 'none'),
    isScheduleConfirmed: data.isScheduleConfirmed === true,
    eligibleForWeek: false,
    eligibilityReasons: ['WORKSPACE_HYDRATING'],
    eligibleContractIds: [],
    validScheduleDates: [],
    pausedScheduleDates: [],
    remainingEntitlementSessions: Number(data.remainingEntitlementSessions || 0),
    activeScheduledSessions: 0,
    activeScheduledThisWeek: 0,
    remainingSchedulableSessions: Number(data.remainingSchedulableSessions || 0),
    previousWeekScheduledSessions: 0,
    hadSchedulePreviousWeek: false,
    contractStatus: inactive || displayOnly ? 'missing' : 'hydrating',
  }
}

function initialTrainerProjection(item, branchId, scheduleLoadPolicy, weekly = null, week = '') {
  const data = trainerProfileForWeek(item.data() || {}, weekly, week)
  const availableSlots = Array.isArray(data.availableSlots) ? data.availableSlots.slice(0, 100) : []
  const schedulingPriority = Math.max(1, Math.min(999, Math.trunc(Number(data.schedulingPriority ?? data.priority ?? 100) || 100)))
  return {
    id: item.id,
    name: data.name || 'PT chưa cập nhật tên',
    phone: data.phone || '',
    email: data.email || '',
    status: data.status || 'active',
    branchId,
    employmentType: ['full_time', 'part_time', 'collaborator'].includes(data.employmentType) ? data.employmentType : 'full_time',
    employmentLevel: ['probation', 'official', 'senior'].includes(data.employmentLevel) ? data.employmentLevel : 'official',
    availableSlots,
    availabilityMode: trainerAvailabilityMode(data),
    availabilityRevision: Number(data.availabilityRevision || 0),
    availabilitySource: data.availabilitySource || 'recurring',
    availabilitySourceWeekId: data.availabilitySourceWeekId || null,
    availabilityWeekId: week,
    offDates: data.offDates || [],
    slotCapacity: normalizedCapacity(data.slotCapacity),
    schedulingPriority,
    dailySessionTarget: trainerDailyLoadTarget(data, scheduleLoadPolicy),
  }
}

async function loadBranchDataInitial(db, branchId, week, options = {}) {
  // The first paint only needs the branch shell, the canonical draft, the
  // bounded rosters and the current-week rows. Published drafts already
  // contain the complete matrix, so reading legacy schedule/weekly targets
  // here only adds latency and quota pressure. Keep those two reads for the
  // legacy/no-draft path, where they are still needed to reconstruct a
  // schedule that has not migrated to ptScheduleDrafts yet.
  const [branch, draft, config] = await Promise.all([
    db.doc(`branches/${branchId}`).get(),
    draftReference(db, branchId, week).get(),
    db.doc('settings/scheduleConfig').get(),
  ])
  if (!branch.exists || branch.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')

  const draftData = scopedDraftData(draft, branchId, week)
  const publishedDraft = Boolean(draftData)
    && (draftData.status === 'published' || Number(draftData.publishedVersion || 0) > 0)
  const [legacySchedule, targetOverrides, students, trainers, weekSessions] = await Promise.all([
    publishedDraft ? Promise.resolve({ exists: false, data: () => ({}) }) : db.doc(`schedules/schedule_${week}`).get(),
    publishedDraft ? Promise.resolve({ exists: false, data: () => ({}) }) : weeklyTargetOverrideReference(db, branchId, week).get(),
    db.collection('students').where('branchId', '==', branchId).limit(MAX_STUDENTS + 1).get(),
    db.collection('trainers').where('branchId', '==', branchId).limit(MAX_TRAINERS + 1).get(),
    // The initial paint is a display-only matrix. Raw session rows are only
    // needed for the editable/reconciled path to build optimistic session
    // references and historical conflict evidence. Defer that bounded query
    // until an explicit reconcile or mutation so the common page load does
    // not pay up to 1,001 reads before painting.
    options.initialPaint
      ? Promise.resolve({ docs: [], size: 0 })
      : db.collection('sessions').where('branchId', '==', branchId).where('date', '>=', week).where('date', '<', nextWeek(week)).limit(1001).get(),
  ])
  if (students.size > MAX_STUDENTS || trainers.size > MAX_TRAINERS || weekSessions.size > 1000) {
    throw new HttpsError('resource-exhausted', 'Dữ liệu chi nhánh vượt giới hạn workspace an toàn.')
  }

  const legacy = legacySchedule.exists ? legacySchedule.data() : {}
  const targetOverrideData = targetOverrides.exists ? targetOverrides.data() : null
  const weeklySessionTargets = weeklySessionTargetsForWeek(draftData, targetOverrideData)
  const studentMap = new Map(students.docs.map((item) => [item.id, item.data()]))
  const trainerMap = new Map(trainers.docs.map((item) => [item.id, item.data()]))
  if (!draftData) {
    const legacyTrainerIds = [...new Set(Object.values(legacy.schedule || {}).flat()
      .map((entry) => entry?.trainerId).filter((id) => typeof id === 'string' && id && !trainerMap.has(id)))]
    if (legacyTrainerIds.length > MAX_TRAINERS) throw new HttpsError('resource-exhausted', 'Lịch cũ có quá nhiều PT ngoài chi nhánh.')
    const legacyTrainers = await documentsByIds(db, 'trainers', legacyTrainerIds)
    legacyTrainers.forEach((item) => trainerMap.set(item.id, item.data()))
  }
  const schedule = draftData
    ? safeSchedule(draftData.schedule)
    : branchScheduleSnapshot(legacy.schedule || {}, branchId, studentMap, trainerMap)
  const referencedStudentIds = new Set([
    ...Object.values(schedule).flat().filter((entry) => entry.type !== 'off').map((entry) => entry.studentId),
    ...weekSessions.docs.filter((item) => historicalSessionOccupies(item.data())).map((item) => item.data()?.studentId),
  ].filter(Boolean))
  const missingReferencedStudents = [...referencedStudentIds].filter((studentId) => !studentMap.has(studentId))
  if (missingReferencedStudents.length > MAX_STUDENTS) throw new HttpsError('resource-exhausted', 'Số hồ sơ bổ sung vượt giới hạn workspace an toàn.')
  const [referencedStudentSnapshots, trainerAvailability] = await Promise.all([
    documentsByIds(db, 'students', missingReferencedStudents),
    effectiveAvailabilityForTrainers(db, trainers.docs.map((item) => item.id), week),
  ])
  const weeklyTrainerAvailability = new Map(trainerAvailability.map((item) => [item.data().trainerId, item.data()]))
  referencedStudentSnapshots.forEach((item) => studentMap.set(item.id, item.data()))
  const crossBranchStudentIds = new Set([...referencedStudentIds].filter((studentId) => {
    const profile = studentMap.get(studentId)
    return profile?.branchId && profile.branchId !== branchId
  }))
  const scheduleConfig = normalizedScheduleConfig(config.data())
  const projectedStudents = students.docs.map((item) => initialStudentProjection(item, branchId, false, week, config.data(), weeklySessionTargets))
  const projectedCrossBranchStudents = referencedStudentSnapshots
    .filter((item) => crossBranchStudentIds.has(item.id))
    .map((item) => initialStudentProjection(item, branchId, true, week, config.data(), weeklySessionTargets))
  return {
    partial: true,
    readMode: 'display',
    branch: { id: branchId, name: branch.data().name || branchId, status: branch.data().status || 'active' },
    draft: {
      exists: Boolean(draftData),
      revision: Number(draftData?.revision ?? legacy.draftRevision ?? 0),
      status: draftData?.status || legacy.publishStatusByBranch?.[branchId] || 'draft',
      publishedVersion: Number(draftData?.publishedVersion || legacy.publishedVersions?.[branchId] || 0),
      publishedRevision: Number(draftData?.publishedRevision ?? legacy.publishedRevisions?.[branchId] ?? -1),
      updatedAt: draftData?.updatedAt?.toDate?.().toISOString?.() || null,
      updatedBy: draftData?.updatedBy || null,
      warnings: Array.isArray(draftData?.warnings) ? draftData.warnings.slice(0, 100) : [],
      optimizationSummary: {},
      unassignedEntries: [],
    },
    schedule,
    students: projectedStudents,
    crossBranchStudents: projectedCrossBranchStudents,
    trainers: trainers.docs.map((item) => initialTrainerProjection(item, branchId, scheduleConfig.scheduleLoadPolicy, weeklyTrainerAvailability.get(item.id), week)),
    contracts: [],
    contractsByStudent: new Map(),
    sessions: weekSessions.docs.map((item) => ({ id: item.id, ...item.data() })),
    leaves: [],
    availability: new Map(),
    weeklySessionCoverage: {},
    quickCoverage: quickCoverageForDisplay({
      weekId: week,
      branchId,
      schedule,
      students: projectedStudents,
      crossBranchStudents: projectedCrossBranchStudents,
    }),
    config: scheduleConfig,
  }
}

async function loadBranchDataFresh(db, branchId, week, options = {}) {
  const priorWeek = previousWeek(week)
  // The matrix projection is allowed to paint from the bounded roster and
  // denormalized profile data. Previous-week diagnostics and live reservation
  // reads are still rechecked by generation/publish/write callables, so do not
  // make an Admin wait for them before the draft matrix becomes interactive.
  const skipWorkspaceEvidence = options.workspaceMatrixFast === true || options.publishedMatrixFast === true
  const [branch, legacySchedule, draft, targetOverrides, students, trainers, weekSessions, previousWeekSessions, config] = await Promise.all([
    db.doc(`branches/${branchId}`).get(),
    db.doc(`schedules/schedule_${week}`).get(),
    draftReference(db, branchId, week).get(),
    weeklyTargetOverrideReference(db, branchId, week).get(),
    db.collection('students').where('branchId', '==', branchId).limit(MAX_STUDENTS + 1).get(),
    db.collection('trainers').where('branchId', '==', branchId).limit(MAX_TRAINERS + 1).get(),
    db.collection('sessions').where('branchId', '==', branchId).where('date', '>=', week).where('date', '<', nextWeek(week)).limit(1001).get(),
    skipWorkspaceEvidence
      ? Promise.resolve({ docs: [], size: 0 })
      : db.collection('sessions').where('branchId', '==', branchId).where('date', '>=', priorWeek).where('date', '<', week).limit(1001).get(),
    db.doc('settings/scheduleConfig').get(),
  ])
  if (!branch.exists || branch.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
  if (students.size > MAX_STUDENTS || trainers.size > MAX_TRAINERS || weekSessions.size > 1000 || previousWeekSessions.size > 1000) {
    throw new HttpsError('resource-exhausted', 'Dữ liệu chi nhánh vượt giới hạn workspace an toàn.')
  }
  const studentIds = students.docs.map((item) => item.id)
  const trainerIds = new Set(trainers.docs.map((item) => item.id))
  const studentSet = new Set(studentIds)
  const legacy = legacySchedule.exists ? legacySchedule.data() : {}
  const draftData = scopedDraftData(draft, branchId, week)
  const targetOverrideData = targetOverrides.exists ? targetOverrides.data() : null
  // A published Admin workspace is a live matrix, not an optimizer
  // preflight. Keep the roster/contracts needed by the picker, but avoid
  // fanning out into every learner's weekly evidence just to paint rows. The
  // write callables still load exact evidence before changing a real session.
  const publishedWorkspace = draftData?.status === 'published'
    || Number(draftData?.publishedVersion || 0) > 0
    || legacy.publishStatusByBranch?.[branchId] === 'published'
    || Number(legacy.publishedVersions?.[branchId] || 0) > 0
  const fastPublishedWorkspace = options.publishedMatrixFast === true && publishedWorkspace
  const matrixFastWorkspace = options.workspaceMatrixFast === true
  const fastWorkspace = matrixFastWorkspace || fastPublishedWorkspace
  // These reads are independent once the bounded branch roster is known.
  // Keep them in one fan-out so a slow leave/availability query cannot hold
  // the contract path hostage on every workspace load.
  //
  // Fetch exact weekly availability by deterministic document id. The old
  // week-wide query scanned every branch and could truncate before reaching
  // the selected branch when migrated data was large.
  const [leaves, contracts, trainerAvailability] = await Promise.all([
    approvedLeavesForTrainers(db, trainers.docs.map((item) => item.id)),
    contractsForStudents(db, studentIds),
    effectiveAvailabilityForTrainers(db, trainerIds, week),
  ])
  if (leaves.length > 1000) {
    throw new HttpsError('resource-exhausted', 'Dữ liệu chi nhánh vượt giới hạn workspace an toàn.')
  }
  const studentMap = new Map(students.docs.map((item) => [item.id, item.data()]))
  const trainerMap = new Map(trainers.docs.map((item) => [item.id, item.data()]))
  // Scope branch-less legacy rows by their PT, not by the learner's home
  // branch. Resolve external PTs too so a local learner with an external PT
  // cannot leak into both branches when the maps above are branch-filtered.
  if (!draftData) {
    const legacyTrainerIds = [...new Set(Object.values(legacy.schedule || {}).flat()
      .map((entry) => entry?.trainerId).filter((id) => typeof id === 'string' && id && !trainerMap.has(id)))]
    if (legacyTrainerIds.length > MAX_TRAINERS) throw new HttpsError('resource-exhausted', 'Lịch cũ có quá nhiều PT ngoài chi nhánh.')
    const legacyTrainers = await documentsByIds(db, 'trainers', legacyTrainerIds)
    legacyTrainers.forEach((item) => trainerMap.set(item.id, item.data()))
  }
  const weeklySessionTargets = weeklySessionTargetsForWeek(draftData, targetOverrideData, studentSet)
  const schedule = draftData
    ? safeSchedule(draftData.schedule)
    : branchScheduleSnapshot(legacy.schedule || {}, branchId, studentMap, trainerMap)
  // A branch draft is scoped by the physical training site, not by the
  // learner's home branch. Resolve only the learner ids that are already
  // present in this week's draft/session rows so an explicitly assigned
  // cross-branch learner can be rendered without adding them to the
  // optimizer's branch roster.
  const referencedStudentIds = new Set([
    ...Object.values(schedule).flat().filter((entry) => entry.type !== 'off').map((entry) => entry.studentId),
    ...weekSessions.docs.filter((item) => historicalSessionOccupies(item.data())).map((item) => item.data()?.studentId),
  ].filter(Boolean))
  const missingReferencedStudents = [...referencedStudentIds].filter((studentId) => !studentMap.has(studentId))
  if (missingReferencedStudents.length > MAX_STUDENTS) throw new HttpsError('resource-exhausted', 'Số hồ sơ bổ sung vượt giới hạn workspace an toàn.')
  const referencedStudentSnapshots = await documentsByIds(db, 'students', missingReferencedStudents)
  referencedStudentSnapshots.forEach((item) => studentMap.set(item.id, item.data()))
  const crossBranchStudentIds = new Set([...referencedStudentIds].filter((studentId) => {
    const profile = studentMap.get(studentId)
    return profile?.branchId && profile.branchId !== branchId
  }))
  if (crossBranchStudentIds.size > MAX_STUDENTS) throw new HttpsError('resource-exhausted', 'Số học viên khác cơ sở trong lịch vượt giới hạn workspace an toàn.')
  const crossBranchContracts = await contractsForStudents(db, [...crossBranchStudentIds])
  const allContracts = [...new Map([...contracts, ...crossBranchContracts].map((contract) => [contract.id, contract])).values()]
  const usageViews = await loadContractUsageViews(db, allContracts.map((contract) => contract.id))
  const previousWeekSessionCounts = new Map()
  previousWeekSessions.docs.forEach((item) => {
    const session = item.data()
    const status = String(session.status || '').toLowerCase()
    if (!studentSet.has(session.studentId) || ['cancelled', 'canceled', 'deleted', 'void'].includes(status)) return
    previousWeekSessionCounts.set(session.studentId, (previousWeekSessionCounts.get(session.studentId) || 0) + 1)
  })
  const activeContractStudentIds = new Set(contracts
    .filter((contract) => ['active', 'future'].includes(String(contract.status || 'active').toLowerCase()))
    .map((contract) => contract.studentId)
    .filter((studentId) => studentSet.has(studentId)))
  const reservationStudentIds = fastPublishedWorkspace
    ? new Set(referencedStudentIds)
    : new Set([...activeContractStudentIds, ...referencedStudentIds, ...previousWeekSessionCounts.keys()])
  const coverageStudentIds = fastPublishedWorkspace
    ? new Set(referencedStudentIds)
    : new Set([...studentSet, ...reservationStudentIds])
  const [activeSessions, weeklyCoverageSessions, weeklyDraftScheduleEntries] = await Promise.all([
    fastWorkspace ? Promise.resolve([]) : activeSessionsForStudents(db, [...reservationStudentIds], week),
    // Coverage is a reporting concern rather than a quota reservation. The
    // published Admin matrix only needs live rows for learners already in the
    // matrix; the full roster remains available to the draft/optimizer path.
    weeklySessionsForStudents(db, [...coverageStudentIds], week),
    // A draft can already contain a cross-branch manual placement before
    // Publish creates its session. Include those rows in the compact coverage
    // projection so both branch matrices report the same weekly total.
    weeklyDraftScheduleEntriesForStudents(db, [...coverageStudentIds], week),
  ])
  const sessionRowsById = new Map([...weekSessions.docs, ...activeSessions, ...weeklyCoverageSessions]
    .map((item) => ({ id: item.id, ...item.data() }))
    .map((item) => [item.id, item]))
  const sessionRows = [...sessionRowsById.values()]
  const weeklySessionCoverage = weeklySessionCoverageForStudents({
    contracts: allContracts,
    weekId: week,
    branchId,
    sessions: sessionRows,
    scheduleEntries: weeklyDraftScheduleEntries,
  })
  const sessionsByContract = new Map()
  for (const session of sessionRows) {
    if (!session.contractId) continue
    if (!sessionsByContract.has(session.contractId)) sessionsByContract.set(session.contractId, [])
    sessionsByContract.get(session.contractId).push(session)
  }
  const weeklyTrainerAvailability = new Map(trainerAvailability.map((item) => item.data()).filter((item) => trainerIds.has(item.trainerId)).map((item) => [item.trainerId, item]))
  const mappedContracts = allContracts.map((contract) => {
    const contractSessions = sessionsByContract.get(contract.id) || []
    const usage = canonicalUsageSummary(usageViews.get(contract.id), contract)
      || summarizeContractUsage(contract, contractSessions)
    const activeContractSessions = contractSessions.filter((session) => ['scheduled', 'rescheduled'].includes(String(session.status || '').toLowerCase())
      && session.billingStatus !== 'charged')
    const activeScheduledThisWeek = activeContractSessions.filter((session) => {
      const date = storedDate(session.date)
      return date >= week && date < nextWeek(week)
    }).length
    const remainingEntitlementSessions = usage.remainingSessions
    return {
    id: contract.id,
    studentId: contract.studentId,
    trainerId: contract.trainerId || '',
    trainerIds: Array.isArray(contract.trainerIds) ? contract.trainerIds.filter((id) => trainerIds.has(id)).slice(0, 10) : [],
    branchId: contract.branchId || '',
    packageId: contract.packageId || '',
    packageName: contract.packageName || contract.packageId || 'Gói tập chưa cập nhật',
    status: contract.status,
    startDate: contract.startDate,
    endDate: contract.endDate,
    pausePeriods: Array.isArray(contract.pausePeriods) ? contract.pausePeriods.slice(0, 20) : [],
    totalSessions: Number(contract.totalSessions || 0),
    usedSessions: usage.usedSessions,
    sourceVersion: usage.sourceVersion || 'contract-usage-v3-daily',
    remainingEntitlementSessions,
    activeScheduledSessions: activeContractSessions.length,
    activeScheduledThisWeek,
    remainingSchedulableSessions: Math.max(0, remainingEntitlementSessions - activeContractSessions.length),
    packageSessions: Number(contract.packageSessions || 0),
    plannedCarryOverSessions: Number(contract.plannedCarryOverSessions || 0),
    carriedOverSessions: Number(contract.carriedOverSessions || 0),
    carryOverRequested: contract.carryOverRequested === true,
    carryOverPending: contract.carryOverPending === true,
    earlyHandoverRequested: contract.earlyHandoverRequested !== false,
    activationMode: contract.activationMode || '',
    handoverStatus: contract.handoverStatus || '',
    signedDate: contract.signedDate || '',
    plannedActivationDate: contract.plannedActivationDate || '',
    renewalSupersededBy: contract.renewalSupersededBy || '',
    carryOverTransferredSessions: Number(contract.carryOverTransferredSessions || 0),
    renewalType: contract.renewalType || '',
    sourceContractId: contract.sourceContractId || '',
    renewedByContractId: contract.renewedByContractId || '',
    }
  })
  const mappedContractsByStudent = new Map()
  for (const contract of mappedContracts) {
    if (!mappedContractsByStudent.has(contract.studentId)) mappedContractsByStudent.set(contract.studentId, [])
    mappedContractsByStudent.get(contract.studentId).push(contract)
  }
  const fallbackStudentMap = new Map([...studentMap.entries()].filter(([studentId, profile]) => {
    const inactive = ['inactive', 'archived', 'deleted'].includes(String(profile.status || '').toLowerCase())
    if (inactive) return false
    if (referencedStudentIds.has(studentId) || previousWeekSessionCounts.has(studentId)) return true
    return studentWeekEligibility(mappedContractsByStudent.get(studentId) || [], studentId, branchId, week, undefined, false, config.data() || {}).eligible
  }))
  // Read exact weekly availability only for learners who can affect this
  // workspace. The old implementation issued one document read for every
  // historical profile in the branch, including contracts expired years ago.
  // The fast projection path still checks the small exceptional set whose
  // profile projection points to a future week: a learner can submit next
  // week's matrix before the current week's exact document is displayed.
  const futureProjectedStudentIds = fastWorkspace
    ? [...fallbackStudentMap.entries()]
      .filter(([, profile]) => {
        const projectedWeek = typeof profile.latestSubmittedAvailability?.weekId === 'string'
          ? profile.latestSubmittedAvailability.weekId
          : ''
        return /^\d{4}-\d{2}-\d{2}$/.test(projectedWeek) && projectedWeek > week
      })
      .map(([studentId]) => studentId)
    : []
  const availability = fastWorkspace
    ? await exactAvailabilityForStudents(db, futureProjectedStudentIds, week)
    : await exactAvailabilityForStudents(db, [...fallbackStudentMap.keys()], week)
  const weeklyAvailability = new Map(availability.map((item) => item.data()).filter((item) => studentMap.has(item.studentId)).map((item) => [item.studentId, item]))
  // Migrated profiles without the denormalized latest submission need a
  // bounded historical lookup. Only learners who can affect this workspace
  // are resolved, so old expired profiles no longer add hundreds of reads to
  // every initial load or branch/week switch.
  // Once a schedule is published, Admins are viewing live sessions and the
  // workspace does not need to reconstruct every learner's pre-week history
  // just to render the matrix. The denormalized profile/default availability
  // remains available; the exact fallback validation stays in the write
  // callables. This avoids hundreds of legacy point queries on every branch
  // switch while keeping staff/draft/optimizer reads fully reconciled.
  // Keep fallback evidence for learners already present in the published
  // matrix or in this week's live/previous-week sessions. Unassigned legacy
  // profiles do not affect the live matrix and can be resolved on demand by
  // the manual write path.
  const fallbackProfiles = options.skipLegacyAvailabilityFallback && publishedWorkspace
    ? new Map([...fallbackStudentMap].filter(([studentId]) => referencedStudentIds.has(studentId) || previousWeekSessionCounts.has(studentId)))
    : fallbackStudentMap
  const inheritedAvailability = fastWorkspace
    ? new Map()
    : options.skipLegacyAvailabilityFallback && publishedWorkspace
      ? await loadLatestSubmittedFallbacks(db, fallbackProfiles, weeklyAvailability, week)
      : await loadLatestSubmittedFallbacks(db, fallbackStudentMap, weeklyAvailability, week)
  const mappedStudents = [...students.docs, ...referencedStudentSnapshots].map((item) => {
    const data = item.data()
    const displayOnly = crossBranchStudentIds.has(item.id)
    const weekly = weeklyAvailability.get(item.id)
    const effectiveAvailability = effectiveStudentAvailability({
      targetWeek: week,
      exact: weekly,
      inherited: inheritedAvailability.get(item.id),
      profile: data,
    })
    const availabilityStatus = effectiveAvailability.source === 'weekly'
      ? availabilityStatusForWeek(effectiveAvailability, week, config.data())
      : effectiveAvailability.source === 'inherited_weekly'
        ? 'inherited'
        : effectiveAvailability.source === 'legacy_default' && effectiveAvailability.confirmed
          ? 'recurring'
          : 'missing'
    const availabilityWindow = availabilityWindowForWeek(week, config.data(), effectiveAvailability)
    const studentContracts = mappedContractsByStudent.get(item.id) || []
    const eligibility = studentWeekEligibility(studentContracts, item.id, displayOnly ? data.branchId : branchId, week, undefined, false, config.data() || {})
    const studentInactive = ['inactive', 'archived', 'deleted'].includes(String(data.status || '').toLowerCase())
    const weeklySessionTargetOverride = Object.prototype.hasOwnProperty.call(weeklySessionTargets, item.id)
      ? weeklySessionTargets[item.id]
      : null
    const availabilityRequestedSessions = normalizeRequestedSessions(effectiveAvailability.requestedSessions)
    const resolvedSessionTarget = weeklySessionTargetOverride ?? availabilityRequestedSessions
    // Weekly demand is a learner/profile setting. Do not silently shrink it
    // just because the current week has fewer future calendar days left.
    // Scheduling capacity is exposed separately so the UI can explain why a
    // target cannot yet be fulfilled.
    const target = weeklyTargetForStudent(data.sessionsPerWeek, resolvedSessionTarget, eligibility)
    const contractEndDates = studentContracts.filter(contract => !TERMINAL_CONTRACT_STATUSES.has(normalizedContractStatus(contract.status))).map((contract) => storedDate(contract.endDate)).filter(Boolean).sort()
    const latestContractEndDate = contractEndDates[contractEndDates.length - 1] || null
    const contractStatus = eligibility.reasonCodes.includes('CONTRACT_PAUSED')
      ? 'paused'
      : eligibility.reasonCodes.includes('CONTRACT_SESSION_QUOTA_EXCEEDED') || eligibility.reasonCodes.includes('CONTRACT_QUOTA_EXHAUSTED')
        ? 'quota_exhausted'
        : eligibility.reasonCodes.includes('CONTRACT_EXPIRED_BEFORE_WEEK')
          ? 'expired'
          : eligibility.reasonCodes.includes('CONTRACT_EXPIRES_DURING_WEEK')
            ? 'expiring'
            : eligibility.reasonCodes.includes('CONTRACT_NOT_STARTED_IN_WEEK')
              ? 'not_started_or_ended'
              : !studentContracts.length || !eligibility.validDates.length
                ? 'missing'
                : latestContractEndDate && latestContractEndDate <= datesForWeek(week)[datesForWeek(week).length - 1]
                  ? 'expiring'
                  : 'valid'
    return {
      id: item.id,
      name: data.name || 'Chưa cập nhật tên',
      phone: data.phone || '',
      email: data.email || '',
      status: data.status || 'active',
      branchId: data.branchId || branchId,
      ...(displayOnly ? { isCrossBranchDisplayOnly: true, studentBranchWarning: true, studentHomeBranchId: data.branchId } : {}),
      sessionsPerWeek: target.sessionsPerWeek,
      defaultSessionsPerWeek: target.defaultSessionsPerWeek,
      weeklySessionTargetOverride,
      weeklySessionTargetOverridden: weeklySessionTargetOverride !== null,
      availabilityRequestedSessions,
      availabilityTargetOverridden: availabilityRequestedSessions !== null,
      maxWeeklySessions: target.maxWeeklySessions,
      schedulableSessionsThisWeek: target.schedulableSessionsThisWeek,
      availableSlots: effectiveAvailability.slots.slice(0, 100),
      availabilityStatus,
      availabilityLocked: availabilityWindow.locked,
      availabilityCutoffAt: availabilityWindow.cutoffAt.toISOString(),
      availabilityReopenedUntil: availabilityWindow.reopenedUntil?.toISOString() || null,
      availabilityRevision: Number(effectiveAvailability.targetRevision || 0),
      availabilitySourceRevision: Number(effectiveAvailability.sourceRevision || 0),
      availabilitySourceWeekId: effectiveAvailability.sourceWeekId,
      availabilitySource: effectiveAvailability.source,
      isScheduleConfirmed: effectiveAvailability.confirmed === true,
      eligibleForWeek: !displayOnly && !studentInactive && eligibility.eligible,
      eligibilityReasons: studentInactive
        ? ['STUDENT_NOT_ACTIVE', ...eligibility.reasonCodes]
        : eligibility.reasonCodes,
      eligibleContractIds: eligibility.eligibleContractIds,
      validScheduleDates: eligibility.validDates,
      pausedScheduleDates: eligibility.pausedDates,
      approvedOffScheduleDates: eligibility.approvedOffDates,
      remainingEntitlementSessions: eligibility.remainingEntitlementSessions,
      activeScheduledSessions: eligibility.activeScheduledSessions,
      activeScheduledThisWeek: eligibility.activeScheduledThisWeek,
      remainingSchedulableSessions: eligibility.remainingSchedulableSessions,
      previousWeekScheduledSessions: previousWeekSessionCounts.get(item.id) || 0,
      hadSchedulePreviousWeek: (previousWeekSessionCounts.get(item.id) || 0) > 0,
      contractStatus,
      contractEndDate: latestContractEndDate,
    }
  })
  const mappedTrainers = trainers.docs.map((item) => {
    const data = trainerProfileForWeek(item.data(), weeklyTrainerAvailability.get(item.id), week)
    const schedulingPriority = Math.max(1, Math.min(999, Math.trunc(Number(data.schedulingPriority ?? data.priority ?? 100) || 100)))
    const dailySessionTarget = trainerDailyLoadTarget(data, config.data()?.scheduleLoadPolicy)
    return {
      id: item.id,
      name: data.name || 'PT chưa cập nhật tên',
      phone: data.phone || '',
      email: data.email || '',
      status: data.status || 'active',
      branchId,
      employmentType: ['full_time', 'part_time', 'collaborator'].includes(data.employmentType) ? data.employmentType : 'full_time',
      employmentLevel: ['probation', 'official', 'senior'].includes(data.employmentLevel) ? data.employmentLevel : 'official',
      availableSlots: Array.isArray(data.availableSlots) ? data.availableSlots.slice(0, 100) : [],
      availabilityMode: trainerAvailabilityMode(data),
      availabilityRevision: Number(data.availabilityRevision || 0),
      availabilitySource: data.availabilitySource || 'recurring',
      availabilitySourceWeekId: data.availabilitySourceWeekId || null,
      availabilityWeekId: week,
      offDates: data.offDates || [],
      slotCapacity: normalizedCapacity(data.slotCapacity),
      schedulingPriority,
      dailySessionTarget,
    }
  })
  return {
    readMode: 'reconciled',
    branch: { id: branchId, name: branch.data().name || branchId, status: branch.data().status || 'active' },
    draft: {
      exists: Boolean(draftData),
      revision: Number(draftData?.revision ?? legacy.draftRevision ?? 0),
      status: draftData?.status || legacy.publishStatusByBranch?.[branchId] || 'draft',
      publishedVersion: Number(draftData?.publishedVersion || legacy.publishedVersions?.[branchId] || 0),
      publishedRevision: Number(draftData?.publishedRevision ?? legacy.publishedRevisions?.[branchId] ?? -1),
      updatedAt: draftData?.updatedAt?.toDate?.().toISOString?.() || null,
      updatedBy: draftData?.updatedBy || null,
      warnings: Array.isArray(draftData?.warnings) ? draftData.warnings.slice(0, 100) : [],
      optimizationSummary: draftData?.optimizationSummary && typeof draftData.optimizationSummary === 'object'
        ? draftData.optimizationSummary
        : {},
      unassignedEntries: Array.isArray(draftData?.unassignedEntries) ? draftData.unassignedEntries.slice(0, MAX_STUDENTS) : [],
    },
    schedule,
    students: mappedStudents.filter((student) => !student.isCrossBranchDisplayOnly),
    crossBranchStudents: mappedStudents.filter((student) => student.isCrossBranchDisplayOnly),
    trainers: mappedTrainers,
    contracts: mappedContracts,
    contractsByStudent: indexContractsByStudent(mappedContracts),
    availability: weeklyAvailability,
    weeklySessionCoverage,
    sessions: sessionRows,
    leaves: leaves.map((item) => ({ id: item.id, ...item.data() })).filter((item) => trainerIds.has(item.trainerId)),
    config: normalizedScheduleConfig(config.data()),
  }
}

async function loadBranchData(db, branchId, week, options = {}) {
  const cache = branchDataCacheFor(db)
  const initialPaint = options.initialPaint === true
  const fastPublished = options.skipLegacyAvailabilityFallback === true
  const matrixFast = options.workspaceMatrixFast === true
  const forceRefresh = options.forceRefresh === true
  const key = `${branchId}|${week}|${initialPaint ? 'paint' : matrixFast ? 'matrix' : fastPublished ? 'workspace' : 'full'}`
  if (forceRefresh) {
    // A learner availability save runs in a different callable service, so
    // its Firestore write cannot clear this process-local cache directly.
    // The Admin UI uses this flag after the tiny sync document changes.
    invalidateBranchDataCache(db, branchId, week)
  }
  const now = Date.now()
  const cached = cache.entries.get(key)
  if (!forceRefresh && cached && now - cached.storedAt < BRANCH_DATA_CACHE_TTL_MS) {
    // Refresh LRU order without extending the freshness window.
    cache.entries.delete(key)
    cache.entries.set(key, cached)
    return cached.value
  }
  if (cached) cache.entries.delete(key)
  const pending = cache.pending.get(key)
  if (!forceRefresh && pending) return pending
  const generation = cache.generations.get(key) || 0
  const request = (initialPaint
    ? loadBranchDataInitial(db, branchId, week, options)
    : loadBranchDataFresh(db, branchId, week, options)).then((value) => {
    if ((cache.generations.get(key) || 0) === generation) {
      cache.entries.delete(key)
      cache.entries.set(key, { value, storedAt: Date.now() })
      while (cache.entries.size > BRANCH_DATA_CACHE_LIMIT) cache.entries.delete(cache.entries.keys().next().value)
    }
    return value
  }).finally(() => {
    if (cache.pending.get(key) === request) cache.pending.delete(key)
  })
  cache.pending.set(key, request)
  return request
}

async function loadManualMutationData(db, branchId, week, trainerId, studentId, allowCrossBranchStudent = false, loadedBranchData = null) {
  const [branch, legacySchedule, draft, targetOverrides, studentSnapshot, trainerSnapshot, exactAvailability, exactTrainerAvailability, config, leaves, contractSnapshot, sessionSnapshot, branchSessionSnapshot] = await Promise.all([
    db.doc(`branches/${branchId}`).get(),
    db.doc(`schedules/schedule_${week}`).get(),
    draftReference(db, branchId, week).get(),
    weeklyTargetOverrideReference(db, branchId, week).get(),
    db.doc(`students/${studentId}`).get(),
    db.doc(`trainers/${trainerId}`).get(),
    db.doc(`ptAvailability/${studentId}_${week}`).get(),
    loadTrainerAvailability(db, trainerId, week),
    db.doc('settings/scheduleConfig').get(),
    db.collection('leaveRequests').where('trainerId', '==', trainerId).limit(1001).get(),
    db.collection('contracts').where('studentId', '==', studentId).get(),
    db.collection('sessions').where('studentId', '==', studentId).limit(1001).get(),
    // A v2 draft normally already contains the sessions that were published,
    // but older/partially migrated weeks can have a draft that predates those
    // rows. Read the selected branch's week as well so a manual add cannot
    // miss a real seat, duplicate a learner's day, or reserve quota twice.
    db.collection('sessions').where('branchId', '==', branchId).where('date', '>=', week).where('date', '<', nextWeek(week)).limit(1001).get(),
  ])
  if (!branch.exists || branch.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
  if (!studentSnapshot.exists || (!allowCrossBranchStudent && studentSnapshot.data().branchId !== branchId)) throw new HttpsError('not-found', 'Không tìm thấy học viên trong phạm vi được phép.')
  if (!trainerSnapshot.exists || trainerSnapshot.data().branchId !== branchId) throw new HttpsError('not-found', 'Không tìm thấy PT trong chi nhánh.')
  if (leaves.size > 1000 || sessionSnapshot.size > 1000 || branchSessionSnapshot.size > 1000) throw new HttpsError('resource-exhausted', 'Dữ liệu hồ sơ vượt giới hạn chỉnh ca an toàn.')
  const draftData = scopedDraftData(draft, branchId, week)
  const targetOverrideData = targetOverrides.exists ? targetOverrides.data() : null
  // A legacy-only week still needs the complete branch schedule so no other
  // learner is dropped while the first v2 draft document is created. Keep
  // that schedule, then use the exact learner/PT payload below for validation.
  const baseData = loadedBranchData || (!draftData ? await loadBranchData(db, branchId, week) : null)

  const rawStudent = studentSnapshot.data()
  const rawTrainer = trainerProfileForWeek(trainerSnapshot.data(), exactTrainerAvailability.exists ? exactTrainerAvailability.data() : null, week)
  const exactSessions = [...branchSessionSnapshot.docs, ...sessionSnapshot.docs]
    .map((item) => ({ id: item.id, ...item.data() }))
  const sessions = [...new Map([
    ...(baseData?.sessions || []),
    ...exactSessions,
  ].map((session) => [session.id, session])).values()]
  const usageViews = await loadContractUsageViews(db, contractSnapshot.docs.map((item) => item.id))
  const contracts = contractSnapshot.docs.map((item) => {
    const contract = item.data()
    const usage = canonicalUsageSummary(usageViews.get(item.id), contract)
      || summarizeContractUsage(contract, sessions.filter((session) => session.contractId === item.id))
    const activeContractSessions = sessions.filter((session) => session.contractId === item.id
      && ['scheduled', 'rescheduled'].includes(String(session.status || '').toLowerCase())
      && session.billingStatus !== 'charged')
    const activeScheduledThisWeek = activeContractSessions.filter((session) => {
      const date = storedDate(session.date)
      return date >= week && date < nextWeek(week)
    }).length
    const remainingEntitlementSessions = usage.remainingSessions
    return {
      id: item.id,
      studentId: contract.studentId,
      trainerId: contract.trainerId || '',
      trainerIds: Array.isArray(contract.trainerIds) ? contract.trainerIds.slice(0, 10) : [],
      branchId: contract.branchId || '',
      packageId: contract.packageId || '',
      packageName: contract.packageName || contract.packageId || 'Gói tập chưa cập nhật',
      status: contract.status,
      startDate: contract.startDate,
      endDate: contract.endDate,
      pausePeriods: Array.isArray(contract.pausePeriods) ? contract.pausePeriods.slice(0, 20) : [],
      totalSessions: Number(contract.totalSessions || 0),
      usedSessions: usage.usedSessions,
      sourceVersion: usage.sourceVersion || 'contract-usage-v3-daily',
      remainingEntitlementSessions,
      activeScheduledSessions: activeContractSessions.length,
      activeScheduledThisWeek,
      remainingSchedulableSessions: Math.max(0, remainingEntitlementSessions - activeContractSessions.length),
      packageSessions: Number(contract.packageSessions || 0),
      plannedCarryOverSessions: Number(contract.plannedCarryOverSessions || 0),
      carriedOverSessions: Number(contract.carriedOverSessions || 0),
      carryOverRequested: contract.carryOverRequested === true,
      carryOverPending: contract.carryOverPending === true,
      earlyHandoverRequested: contract.earlyHandoverRequested !== false,
      activationMode: contract.activationMode || '',
    handoverStatus: contract.handoverStatus || '',
    signedDate: contract.signedDate || '',
    plannedActivationDate: contract.plannedActivationDate || '',
    renewalSupersededBy: contract.renewalSupersededBy || '',
    carryOverTransferredSessions: Number(contract.carryOverTransferredSessions || 0),
    renewalType: contract.renewalType || '',
      sourceContractId: contract.sourceContractId || '',
    }
  })
  const exactMap = new Map(exactAvailability.exists ? [[studentId, exactAvailability.data()]] : [])
  const profileMap = new Map([[studentId, rawStudent]])
  const inherited = await loadLatestSubmittedFallbacks(db, profileMap, exactMap, week)
  const effectiveAvailability = effectiveStudentAvailability({
    targetWeek: week,
    exact: exactAvailability.exists ? exactAvailability.data() : null,
    inherited: inherited.get(studentId),
    profile: rawStudent,
  })
  const availabilityStatus = effectiveAvailability.source === 'weekly'
    ? availabilityStatusForWeek(effectiveAvailability, week, config.data())
    : effectiveAvailability.source === 'inherited_weekly'
      ? 'inherited'
      : effectiveAvailability.source === 'legacy_default' && effectiveAvailability.confirmed
        ? 'recurring'
        : 'missing'
  const availabilityWindow = availabilityWindowForWeek(week, config.data(), effectiveAvailability)
  const eligibility = studentWeekEligibility(contracts, studentId, branchId, week, todayInHoChiMinh(), allowCrossBranchStudent, config.data() || {})
  const studentInactive = ['inactive', 'archived', 'deleted'].includes(String(rawStudent.status || '').toLowerCase())
  const weeklySessionTargets = weeklySessionTargetsForWeek(draftData, targetOverrideData)
  const adminSessionTarget = Object.prototype.hasOwnProperty.call(weeklySessionTargets, studentId)
    ? weeklySessionTargets[studentId]
    : null
  const availabilityRequestedSessions = normalizeRequestedSessions(effectiveAvailability.requestedSessions)
  const target = weeklyTargetForStudent(rawStudent.sessionsPerWeek, adminSessionTarget ?? availabilityRequestedSessions, eligibility)
  const student = {
    id: studentId,
    name: rawStudent.name || 'Chưa cập nhật tên',
    phone: rawStudent.phone || '',
    status: rawStudent.status || 'active',
    branchId: rawStudent.branchId || '',
    ...target,
    weeklySessionTargetOverride: adminSessionTarget,
    weeklySessionTargetOverridden: adminSessionTarget !== null,
    availabilityRequestedSessions,
    availabilityTargetOverridden: availabilityRequestedSessions !== null,
    availableSlots: effectiveAvailability.slots.slice(0, 100),
    availabilityStatus,
    availabilityLocked: availabilityWindow.locked,
    availabilityCutoffAt: availabilityWindow.cutoffAt.toISOString(),
    availabilityReopenedUntil: availabilityWindow.reopenedUntil?.toISOString() || null,
    eligibleForWeek: !studentInactive && eligibility.eligible,
    eligibilityReasons: studentInactive ? ['STUDENT_NOT_ACTIVE', ...eligibility.reasonCodes] : eligibility.reasonCodes,
    eligibleContractIds: eligibility.eligibleContractIds,
    validScheduleDates: eligibility.validDates,
    pausedScheduleDates: eligibility.pausedDates,
    approvedOffScheduleDates: eligibility.approvedOffDates,
  }
  const schedulingPriority = Math.max(1, Math.min(999, Math.trunc(Number(rawTrainer.schedulingPriority ?? rawTrainer.priority ?? 100) || 100)))
  const dailySessionTarget = trainerDailyLoadTarget(rawTrainer, config.data()?.scheduleLoadPolicy)
  const trainer = {
    id: trainerId,
    name: rawTrainer.name || 'PT chưa cập nhật tên',
    status: rawTrainer.status || 'active',
    branchId,
    employmentType: ['full_time', 'part_time', 'collaborator'].includes(rawTrainer.employmentType) ? rawTrainer.employmentType : 'full_time',
    employmentLevel: ['probation', 'official', 'senior'].includes(rawTrainer.employmentLevel) ? rawTrainer.employmentLevel : 'official',
    availableSlots: Array.isArray(rawTrainer.availableSlots) ? rawTrainer.availableSlots.slice(0, 100) : [],
    availabilityMode: trainerAvailabilityMode(rawTrainer),
    slotCapacity: normalizedCapacity(rawTrainer.slotCapacity),
    schedulingPriority,
    dailySessionTarget,
  }
  const schedule = safeSchedule(baseData?.schedule || draftData?.schedule)
  // Keep the manual validator aligned with the workspace projection. A
  // published session is real occupancy even when an old v2 draft does not
  // yet contain its `published_existing` row. Without this merge, xếp tay
  // could incorrectly report an empty seat or allow a second session on the
  // same learner/day, then fail later at Publish.
  mergePublishedSessions({
    weekId: week,
    branch: { id: branchId },
    students: [student],
    crossBranchStudents: [],
    contracts,
    sessions,
  }, schedule, [])
  return {
    branch: baseData?.branch || { id: branchId, name: branch.data().name || branchId, status: branch.data().status || 'active' },
    draft: baseData?.draft || {
      exists: Boolean(draftData),
      revision: Number(draftData?.revision ?? legacySchedule.data()?.draftRevision ?? 0),
    },
    schedule,
    students: [student],
    trainers: [trainer],
    contracts,
    contractsByStudent: indexContractsByStudent(contracts),
    sessions,
    leaves: leaves.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.status === 'approved'),
    config: normalizedScheduleConfig(config.data()),
    allowCrossBranchStudentIds: allowCrossBranchStudent ? new Set([studentId]) : new Set(),
  }
}

function contractPaused(contract, date) {
  return Array.isArray(contract.pausePeriods) && contract.pausePeriods.some((period) => {
    const start = storedDate(period?.startDate)
    const end = storedDate(period?.endDate)
    return start && end && date >= start && date <= end
  })
}

function datesForWeek(week) {
  return [...DAY_ORDER.keys()].map((day) => dateForSlot(week, day))
}

function todayInHoChiMinh() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function contractCanServeScheduledDate(contract, date) {
  return contractEffectiveOnDate(contract, date)
}

function studentWeekEligibility(contracts, studentId, branchId, week, referenceDate = todayInHoChiMinh(), allowCrossBranch = false, scheduleConfig = null) {
  const reasons = new Set()
  const weekDates = datesForWeek(week)
  const weekStart = weekDates[0]
  const weekEnd = weekDates[weekDates.length - 1]
  const allStudentContracts = contracts.filter((contract) => contract.studentId === studentId)
  const emptyReservations = new Map()
  const operationalContracts = contracts.filter((contract) => contract.studentId === studentId
    && contractCanParticipateInWeek(contract, allStudentContracts, weekDates, emptyReservations))
  if (!operationalContracts.length) {
    const datedContracts = allStudentContracts.map((contract) => ({
      status: String(contract.status || '').toLowerCase(),
      start: storedDate(contract.startDate),
      end: storedDate(contract.endDate),
    })).filter((contract) => contract.start && contract.end)
    if (datedContracts.length && datedContracts.every((contract) => contract.end < weekStart || contract.status === 'expired')) {
      reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
      reasons.add(datedContracts.some((contract) => contract.end >= weekStart && contract.end <= weekEnd)
        ? 'CONTRACT_EXPIRES_DURING_WEEK'
        : 'CONTRACT_EXPIRED_BEFORE_WEEK')
    } else if (datedContracts.length && datedContracts.every((contract) => contract.start > weekEnd)) {
      reasons.add('CONTRACT_NOT_STARTED_IN_WEEK')
    } else reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
  }

  const branchContracts = operationalContracts.filter((contract) => {
    if (!contract.branchId) {
      reasons.add('CONTRACT_BRANCH_REQUIRED')
      return false
    }
    if (contract.branchId !== branchId && !allowCrossBranch) {
      reasons.add('STUDENT_BRANCH_MISMATCH')
      return false
    }
    return true
  })
  // Use the operating calendar only to recognize approved full-week OFF.
  // Globally filtering entitlement dates by workingDays erases ordinary
  // learners' coverage on a closed Sunday, despite their existing bookings.
  // Keep the existing date/expiry policy for everyone else.
  const calendar = scheduleConfig ? normalizedScheduleConfig(scheduleConfig) : null
  const operatingDates = calendar
    ? new Set(calendar.workingDays.map((day) => dateForSlot(week, day)).filter((date) => !calendar.holidays.includes(date)))
    : new Set(weekDates)
  const dates = weekDates.filter((date) => date >= referenceDate)
  const validDates = []
  const pausedDates = []
  const approvedOffDates = new Set()
  const eligibleContractIds = new Set()
  let overlapsWeek = false
  let hasRemainingSessions = false
  let remainingSessionQuota = 0
  let remainingEntitlementSessions = 0
  let activeScheduledSessions = 0
  let activeScheduledThisWeek = 0
  let remainingSchedulableSessions = 0

  for (const contract of branchContracts) {
    const startDate = storedDate(contract.startDate)
    const endDate = storedDate(contract.endDate)
    if (!startDate || !endDate) continue
    // Display every approved OFF day in the selected week, even after it has
    // elapsed. Keep this separate from future entitlement and target logic.
    if (contract.pausePeriods?.length) for (const date of weekDates) {
      if (date >= startDate && date <= endDate && contractEffectiveOnDate(contract, date) && contractPaused(contract, date)) {
        approvedOffDates.add(date)
      }
    }
    const schedulingEntitlement = contractSchedulingEntitlement(contract)
    const contractEntitlement = Math.max(0, Math.min(
      schedulingEntitlement,
      Number(contract.remainingEntitlementSessions
        ?? (schedulingEntitlement - Number(contract.usedSessions || 0))),
    ))
    const contractActiveScheduled = Math.max(0, Number(contract.activeScheduledSessions || 0))
    const contractActiveThisWeek = Math.max(0, Number(contract.activeScheduledThisWeek || 0))
    const contractSchedulable = Math.max(0, Number(contract.remainingSchedulableSessions
      ?? (contractEntitlement - contractActiveScheduled)))
    const contractWeeklyCapacity = Math.min(contractEntitlement, contractSchedulable + contractActiveThisWeek)
    remainingEntitlementSessions += contractEntitlement
    activeScheduledSessions += contractActiveScheduled
    activeScheduledThisWeek += contractActiveThisWeek
    remainingSchedulableSessions += contractSchedulable
    if (contractWeeklyCapacity > 0) hasRemainingSessions = true
    const operatingContractDates = calendar && contract.pausePeriods?.length
      ? [...operatingDates].filter((date) => (date >= startDate && date <= endDate && contractEffectiveOnDate(contract, date))
        || contractCanParticipateInWeek(contract, branchContracts, [date], emptyReservations))
      : []
    const approvedFullWeekOff = operatingContractDates.length > 0
      && operatingContractDates.every((date) => contractPaused(contract, date))
    if (approvedFullWeekOff && contractWeeklyCapacity > 0) pausedDates.push(...operatingContractDates)
    let contractUsableInWeek = false
    for (const date of dates) {
      const directDate = date >= startDate && date <= endDate && contractEffectiveOnDate(contract, date)
      const chainDate = contractCanParticipateInWeek(contract, branchContracts, [date], emptyReservations)
      if (!directDate && !chainDate) continue
      overlapsWeek = true
      if (contractPaused(contract, date)) {
        pausedDates.push(date)
        continue
      }
      if (contractWeeklyCapacity < 1) continue
      // A closed calendar day cannot revive entitlement for a contract whose
      // every usable operating day is covered by an approved pause.
      if (approvedFullWeekOff && !operatingDates.has(date)) continue
      validDates.push(date)
      eligibleContractIds.add(contract.id)
      contractUsableInWeek = true
    }
    if (contractUsableInWeek) remainingSessionQuota += contractWeeklyCapacity
  }

  if (branchContracts.length && !overlapsWeek) {
    const latestEnd = branchContracts.map((contract) => storedDate(contract.endDate)).filter(Boolean).sort().pop()
    if (latestEnd && latestEnd < weekStart) {
      reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
      reasons.add('CONTRACT_EXPIRED_BEFORE_WEEK')
    }
    else if (branchContracts.every((contract) => storedDate(contract.startDate) > weekEnd)) reasons.add('CONTRACT_NOT_STARTED_IN_WEEK')
    else reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
  }
  if (branchContracts.length && !hasRemainingSessions) {
    reasons.add('CONTRACT_SESSION_QUOTA_EXCEEDED')
    reasons.add('CONTRACT_QUOTA_EXHAUSTED')
  }
  if (overlapsWeek && hasRemainingSessions && !validDates.length && pausedDates.length) reasons.add('CONTRACT_PAUSED')

  for (const date of [...new Set(validDates)]) {
    const resolution = resolveSchedulingContract({
      contracts: branchContracts,
      studentId,
      branchId,
      date,
      reservationsByContract: emptyReservations,
      allowCrossBranch,
    })
    if (resolution.reasons.includes('AMBIGUOUS_ACTIVE_CONTRACT')) reasons.add('AMBIGUOUS_ACTIVE_CONTRACT')
  }

  return {
    eligible: validDates.length > 0,
    reasonCodes: [...reasons],
    eligibleContractIds: [...eligibleContractIds],
    validDates: [...new Set(validDates)].sort(),
    pausedDates: [...new Set(pausedDates)].sort(),
    approvedOffDates: [...approvedOffDates].sort(),
    remainingSessions: remainingSessionQuota,
    remainingEntitlementSessions,
    activeScheduledSessions,
    activeScheduledThisWeek,
    remainingSchedulableSessions,
  }
}

function resolveContract(data, studentId, trainerId, date, schedule = null, schedulingState = null) {
  const allowCrossBranch = data.allowCrossBranchStudentIds instanceof Set && data.allowCrossBranchStudentIds.has(studentId)
  const resolution = resolveSchedulingContractForStudent(data, studentId, date, schedule, schedulingState, allowCrossBranch)
  if (!resolution.contract) return resolution
  const contract = resolution.contract
  const assigned = assignedTrainerIds(contract)
  // PT chính/phụ là thứ tự ưu tiên vận hành, không phải khóa cứng. Khi cả hai
  // đều không thể nhận ca, mọi PT đang hoạt động trong cùng chi nhánh vẫn có
  // thể dạy để không bỏ sót quyền lợi của học viên. Entry sẽ mang cờ cảnh báo
  // để UI, publish và audit cùng nhận diện đây là ca PT hỗ trợ.
  const trainerAssignmentWarning = assigned.length > 0 && !assigned.includes(trainerId)
  return {
    ...resolution,
    trainerAssignmentWarning,
    assignedTrainerIds: assigned,
  }
}

function resolveSchedulingContractForStudent(data, studentId, date, schedule = null, schedulingState = null, allowCrossBranch = false) {
  const indexes = scheduleIndexes(data)
  const learnerContracts = indexes.contractsByStudent.get(studentId) || []
  const counts = contractReservationCounts(data, schedule, schedulingState)
  // Reservation counts are shared by every learner/slot edge in a matching
  // round. Passing the already materialized map avoids rebuilding a map of all
  // branch contracts for every PT candidate.
  const resolution = resolveSchedulingContract({
    contracts: learnerContracts,
    studentId,
    branchId: data.branch.id,
    date,
    reservationsByContract: counts.byContract,
    allowCrossBranch,
  })
  return resolution.contract
    ? { ...resolution, assignedTrainerIds: assignedTrainerIds(resolution.contract) }
    : resolution
}

function contractReservationCounts(data, schedule, state) {
  if (state?.reservationCounts) return state.reservationCounts
  const active = new Map(), draft = new Map(), identities = new Set()
  for (const session of data.sessions || []) {
    if (['scheduled', 'rescheduled'].includes(session.status) && session.billingStatus !== 'charged') active.set(session.contractId, (active.get(session.contractId) || 0) + 1)
    if (session.branchId === data.branch.id && (['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'].includes(session.status) || session.billingStatus === 'charged')) {
      identities.add(`${session.contractId}|${session.studentId}|${publishedSessionSlotId(data.weekId, session)}`)
    }
  }
  for (const [slotId, entries] of Object.entries(schedule || {})) for (const entry of entries) {
    if (entry.type === 'off' || !entry.contractId || entryOnApprovedOff(data, slotId, entry) || identities.has(`${entry.contractId}|${entry.studentId}|${slotId}`)) continue
    draft.set(entry.contractId, (draft.get(entry.contractId) || 0) + 1)
  }
  const byContract = new Map()
  for (const [contractId, count] of active) byContract.set(contractId, count + (draft.get(contractId) || 0))
  for (const [contractId, count] of draft) if (!byContract.has(contractId)) byContract.set(contractId, count)
  const counts = { active, draft, byContract }
  if (state) state.reservationCounts = counts
  return counts
}

function assignedTrainerIds(contract) {
  return [...new Set([
    contract?.trainerId,
    ...(Array.isArray(contract?.trainerIds) ? contract.trainerIds : []),
  ].filter(Boolean))]
}

function entryTrainerAssignmentOrder(data, entry) {
  const assigned = assignedTrainerIds(scheduleIndexes(data).contractsById.get(entry.contractId))
  if (!assigned.length) return null
  const index = assigned.indexOf(entry.trainerId)
  return index >= 0 ? index : 1000
}

function trainerAssignmentScore(data, schedule) {
  let primary = 0, assigned = 0, secondaryOrder = 0
  for (const entries of Object.values(schedule)) for (const entry of entries) {
    if (entry.type === 'off') continue
    const order = entryTrainerAssignmentOrder(data, entry)
    if (order === null || order === 1000) continue
    assigned += 1
    if (order === 0) primary += 1
    else secondaryOrder += order
  }
  // Learners without assigned PTs contribute no preference, retaining the
  // existing pairing/load objectives. Resolve each entry's own contract.
  return [primary, assigned, -secondaryOrder]
}

function trainerSchedulingPolicy(trainer, config) {
  const schedulingPriority = Math.max(1, Math.min(999, Math.trunc(Number(trainer?.schedulingPriority ?? trainer?.priority ?? 100) || 100)))
  const dailySessionTarget = trainerDailyLoadTarget(trainer, config?.scheduleLoadPolicy)
  const employmentType = ['full_time', 'part_time', 'collaborator'].includes(trainer?.employmentType)
    ? trainer.employmentType
    : 'full_time'
  const employmentLevel = ['probation', 'official', 'senior'].includes(trainer?.employmentLevel)
    ? trainer.employmentLevel
    : 'official'
  return { schedulingPriority, dailySessionTarget, employmentType, employmentLevel }
}

function schedulingTier(candidate) {
  // Full-time staff are filled to their daily target first. Part-time and CTV
  // are then used from their explicitly submitted availability. Once the
  // target is reached, extra sessions remain possible because it is a target,
  // never a business hard cap.
  if (candidate.employmentType === 'full_time' && candidate.currentDailyLoad < candidate.dailySessionTarget) return 0
  if (candidate.employmentType === 'part_time' && candidate.currentDailyLoad < candidate.dailySessionTarget) return 1
  if (candidate.employmentType === 'collaborator') return 2
  if (candidate.employmentType === 'part_time') return 3
  return 4
}

function createsThreeConsecutiveTrainingDays(existingDays, candidateDay) {
  const indexes = new Set([...(existingDays || []), candidateDay]
    .map((day) => DAY_ORDER.get(day))
    .filter((value) => Number.isInteger(value)))
  return [...indexes].some((index) => indexes.has(index + 1) && indexes.has(index + 2))
}

function buildSchedulingState(schedule, data) {
  const state = {
    studentDays: new Map(),
    studentSessionCounts: new Map(),
    branchSlotCounts: new Map(),
    trainerSlotsByDay: new Map(),
    trainerSlotCounts: new Map(),
    trainerStudentSessions: new Map(),
    trainerStudentSessionsByDay: new Map(),
    offTrainerSlots: new Set(),
  }
  for (const [slotId, entries] of Object.entries(schedule || {})) {
    const [day] = slotId.split('-')
    for (const entry of Array.isArray(entries) ? entries : []) {
      const trainerSlotKey = `${entry.trainerId}|${slotId}`
      if (entry.type === 'off') {
        state.offTrainerSlots.add(trainerSlotKey)
        continue
      }
      if (!state.studentDays.has(entry.studentId)) state.studentDays.set(entry.studentId, new Set())
      state.studentDays.get(entry.studentId).add(day)
      if (!entryOnApprovedOff(data, slotId, entry)) state.studentSessionCounts.set(entry.studentId, (state.studentSessionCounts.get(entry.studentId) || 0) + 1)
      state.branchSlotCounts.set(slotId, (state.branchSlotCounts.get(slotId) || 0) + 1)
      const trainerDayKey = `${entry.trainerId}|${day}`
      if (!state.trainerSlotsByDay.has(trainerDayKey)) state.trainerSlotsByDay.set(trainerDayKey, new Set())
      state.trainerSlotsByDay.get(trainerDayKey).add(slotId)
      state.trainerSlotCounts.set(trainerSlotKey, (state.trainerSlotCounts.get(trainerSlotKey) || 0) + 1)
      state.trainerStudentSessions.set(entry.trainerId, (state.trainerStudentSessions.get(entry.trainerId) || 0) + 1)
      state.trainerStudentSessionsByDay.set(trainerDayKey, (state.trainerStudentSessionsByDay.get(trainerDayKey) || 0) + 1)
    }
  }
  return state
}

function addEntryToSchedulingState(state, slotId, entry) {
  delete state.reservationCounts
  delete state.reservationsByContract
  delete state.blockAffinityCache
  delete state.trainerSlotContextCache
  delete state.branchCapacityCache
  const [day] = slotId.split('-')
  if (!state.studentDays.has(entry.studentId)) state.studentDays.set(entry.studentId, new Set())
  state.studentDays.get(entry.studentId).add(day)
  state.studentSessionCounts.set(entry.studentId, (state.studentSessionCounts.get(entry.studentId) || 0) + 1)
  state.branchSlotCounts.set(slotId, (state.branchSlotCounts.get(slotId) || 0) + 1)
  const trainerDayKey = `${entry.trainerId}|${day}`
  if (!state.trainerSlotsByDay.has(trainerDayKey)) state.trainerSlotsByDay.set(trainerDayKey, new Set())
  state.trainerSlotsByDay.get(trainerDayKey).add(slotId)
  const trainerSlotKey = `${entry.trainerId}|${slotId}`
  state.trainerSlotCounts.set(trainerSlotKey, (state.trainerSlotCounts.get(trainerSlotKey) || 0) + 1)
  state.trainerStudentSessions.set(entry.trainerId, (state.trainerStudentSessions.get(entry.trainerId) || 0) + 1)
  state.trainerStudentSessionsByDay.set(trainerDayKey, (state.trainerStudentSessionsByDay.get(trainerDayKey) || 0) + 1)
}

function trainerBlockAffinity(state, trainerId, slotId) {
  const cache = state.blockAffinityCache || (state.blockAffinityCache = new Map())
  const cacheKey = `${trainerId}|${slotId}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)
  const [day, rawHour] = slotId.split('-')
  const hour = Number(rawHour)
  const currentSlots = state.trainerSlotsByDay.get(`${trainerId}|${day}`) || new Set()
  const occupiedHours = new Set([...currentSlots]
    .map((value) => Number(String(value).split('-')[1]))
    .filter(Number.isFinite))
  occupiedHours.add(hour)

  let blockStart = hour
  let blockEnd = hour
  while (occupiedHours.has(blockStart - 1)) blockStart -= 1
  while (occupiedHours.has(blockEnd + 1)) blockEnd += 1
  const resultingBlockLength = blockEnd - blockStart + 1
  const adjacentTeachingSlots = Number(occupiedHours.has(hour - 1)) + Number(occupiedHours.has(hour + 1))
  const result = {
    adjacentTeachingSlots,
    // Aura wants compact blocks of two or three classes. Longer runs remain
    // useful, but they must not outrank the first 2/3-slot block or learner
    // coverage/pairing decisions made before this soft preference.
    preferredBlockLength: Math.min(3, resultingBlockLength),
    resultingBlockLength,
    isolatedTeachingSlot: currentSlots.size > 0 && adjacentTeachingSlots === 0,
  }
  cache.set(cacheKey, result)
  return result
}

function trainerSlotContext(data, state, trainer, slotId, indexes = scheduleIndexes(data)) {
  const cache = state.trainerSlotContextCache || (state.trainerSlotContextCache = new Map())
  const cacheKey = `${trainer.id}|${slotId}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)
  const [day] = slotId.split('-')
  const policy = trainerSchedulingPolicy(trainer, data.config)
  const trainerSlotKey = `${trainer.id}|${slotId}`
  const trainerCount = state.trainerSlotCounts.get(trainerSlotKey) || 0
  const currentDailyLoad = state.trainerSlotsByDay.get(`${trainer.id}|${day}`)?.size || 0
  const context = {
    policy,
    trainerSlotKey,
    trainerCount,
    currentDailyLoad,
    opensTeachingSlot: trainerCount === 0,
    projectedDailyLoad: currentDailyLoad + (trainerCount === 0 ? 1 : 0),
    branchCapacity: (() => {
      if (!state.branchCapacityCache) state.branchCapacityCache = new Map()
      if (!state.branchCapacityCache.has(slotId)) state.branchCapacityCache.set(slotId, branchSlotCapacity(data.config, data.branch.id, slotId))
      return state.branchCapacityCache.get(slotId)
    })(),
    blockAffinity: trainerBlockAffinity(state, trainer.id, slotId),
    availability: indexes.trainerAvailabilityById.get(trainer.id),
  }
  cache.set(cacheKey, context)
  return context
}

function cachedContractResolution(data, studentId, date, schedule, state, contractCache) {
  if (!contractCache) return resolveSchedulingContractForStudent(data, studentId, date, schedule, state,
    data.allowCrossBranchStudentIds instanceof Set && data.allowCrossBranchStudentIds.has(studentId))
  if (contractCache.scheduleIdentity !== schedule || contractCache.schedulingState !== state) {
    contractCache.clear()
    contractCache.scheduleIdentity = schedule
    contractCache.schedulingState = state
    // The count is only a cache discriminator for callers that mutate the
    // schedule identity; do it once per round instead of once per edge.
    contractCache.scheduleEntryCount = scheduleEntryCount(schedule)
  }
  const key = `${studentId}|${date}`
  if (contractCache.has(key)) return contractCache.get(key)
  const resolution = resolveSchedulingContractForStudent(data, studentId, date, schedule, state,
    data.allowCrossBranchStudentIds instanceof Set && data.allowCrossBranchStudentIds.has(studentId))
  contractCache.set(key, resolution)
  return resolution
}

function candidateForSlot(data, { student, trainer, slotId, schedule, schedulingState = null, contractCache = null }) {
  const [day, rawHour] = slotId.split('-')
  const hour = Number(rawHour)
  const date = dateForSlot(data.weekId, day)
  const reasons = []
  const state = schedulingState || buildSchedulingState(schedule, data)
  const indexes = scheduleIndexes(data)
  const context = trainerSlotContext(data, state, trainer, slotId, indexes)
  const policy = context.policy
  const workingDays = indexes.workingDays
  const workingHours = indexes.workingHours
  const holidays = indexes.holidays
  if ((workingDays.length && !workingDays.includes(day))
    || (workingHours.length && !workingHours.includes(hour))
    || holidays.has(date)) reasons.push('OUTSIDE_WORKING_CALENDAR')
  if (data.referenceNow && slotIsPast(data.weekId, slotId, data.referenceNow)) reasons.push('OUTSIDE_WORKING_CALENDAR')
  if (student.eligibleForWeek === false) {
    reasons.push(...(Array.isArray(student.eligibilityReasons) && student.eligibilityReasons.length
      ? student.eligibilityReasons
      : ['ACTIVE_CONTRACT_NOT_FOUND']))
  }
  if (Array.isArray(student.validScheduleDates) && !student.validScheduleDates.includes(date)) reasons.push('ACTIVE_CONTRACT_NOT_FOUND')
  if (student.status === 'inactive') reasons.push('STUDENT_NOT_ACTIVE')
  const studentBranchWarning = student.branchId !== data.branch.id
  if (studentBranchWarning && !(data.allowCrossBranchStudentIds instanceof Set && data.allowCrossBranchStudentIds.has(student.id))) reasons.push('STUDENT_BRANCH_MISMATCH')
  if (trainerIsLocked(trainer)) reasons.push('TRAINER_NOT_ACTIVE')
  if (trainer.branchId !== data.branch.id) reasons.push('TRAINER_BRANCH_MISMATCH')
  const trainerAvailability = context.availability
  if (policy.employmentType === 'collaborator') {
    if (!trainerAvailability || !trainerAvailability.slots.size) reasons.push('TRAINER_AVAILABILITY_UNCONFIGURED')
    else if (!trainerAvailability.slots.has(slotId)) reasons.push('OUTSIDE_TRAINER_AVAILABILITY')
  } else if (!trainerAvailability || trainerAvailability.mode === 'unconfigured') reasons.push('TRAINER_AVAILABILITY_UNCONFIGURED')
  else if (trainerAvailability.mode === 'configured' && !trainerAvailability.slots.has(slotId)) reasons.push('OUTSIDE_TRAINER_AVAILABILITY')
  const trainerLeaves = indexes.leavesByTrainer.get(trainer.id) || []
  if (trainerLeaves.some((leave) => leaveCovers(leave, trainer.id, date))) reasons.push('TRAINER_ON_LEAVE')
  if (!['submitted', 'locked', 'inherited', 'recurring'].includes(student.availabilityStatus)) reasons.push('AVAILABILITY_NOT_SUBMITTED')
  else if (!(indexes.studentSlotSetsById.get(student.id) || new Set(student.availableSlots || [])).has(slotId)) reasons.push('OUTSIDE_STUDENT_AVAILABILITY')
  const cachedResolution = cachedContractResolution(data, student.id, date, schedule, state, contractCache)
  const assigned = cachedResolution.assignedTrainerIds || assignedTrainerIds(cachedResolution.contract)
  const contractResult = cachedResolution.contract
    ? {
        ...cachedResolution,
        trainerAssignmentWarning: assigned.length > 0 && !assigned.includes(trainer.id),
        assignedTrainerIds: assigned,
      }
    : cachedResolution
  reasons.push(...contractResult.reasons)
  if (state.studentDays.get(student.id)?.has(day)) reasons.push('STUDENT_MULTIPLE_SESSIONS_PER_DAY')
  const scheduledForStudent = state.studentSessionCounts.get(student.id) || 0
  if (Number(student.sessionsPerWeek || 0) >= 0 && scheduledForStudent >= Number(student.sessionsPerWeek || 0)) reasons.push('STUDENT_WEEKLY_TARGET_REACHED')
  const trainerSlotKey = context.trainerSlotKey
  if (state.offTrainerSlots.has(trainerSlotKey)) reasons.push('TRAINER_OFF_CONFLICT')
  const trainerCount = context.trainerCount
  if (trainerCount >= trainer.slotCapacity) reasons.push('TRAINER_CAPACITY_EXCEEDED')
  const configuredBranchCapacity = context.branchCapacity
  if (configuredBranchCapacity !== null && (state.branchSlotCounts.get(slotId) || 0) >= configuredBranchCapacity) reasons.push('BRANCH_CAPACITY_REACHED')
  const currentDailyLoad = context.currentDailyLoad
  const opensTeachingSlot = context.opensTeachingSlot
  const projectedDailyLoad = context.projectedDailyLoad
  const consecutiveDayPenalty = createsThreeConsecutiveTrainingDays(state.studentDays.get(student.id), day) ? 1 : 0
  const blockAffinity = context.blockAffinity
  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    contractId: contractResult.contract?.id || null,
    earlyHandover: contractResult.earlyHandover === true,
    sourceContractId: contractResult.sourceContractId || '',
    trainerAssignmentWarning: contractResult.trainerAssignmentWarning === true,
    studentBranchWarning,
    assignedTrainerIds: contractResult.assignedTrainerIds || [],
    date,
    currentDailyLoad,
    projectedDailyLoad,
    opensTeachingSlot,
    consecutiveDayPenalty,
    ...blockAffinity,
    ...policy,
  }
}

function manualSlotCandidate(result) {
  const availabilityReasons = result.reasons.filter((reason) => STUDENT_AVAILABILITY_REASON_CODES.has(reason))
  const blockingReasons = result.reasons.filter((reason) => !STUDENT_AVAILABILITY_REASON_CODES.has(reason))
  return {
    ...result,
    matchesStudentAvailability: availabilityReasons.length === 0,
    manualSelectable: blockingReasons.length === 0,
    availabilityReason: availabilityReasons[0] || null,
  }
}

function scheduleEntryCount(schedule) {
  return Object.values(schedule || {}).reduce((total, entries) => total + (Array.isArray(entries)
    ? entries.filter((entry) => entry?.type !== 'off' && entry?.studentId !== 'OFF').length
    : 0), 0)
}

function scheduleDocumentEntryCount(schedule) {
  return Object.values(schedule || {}).reduce((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0)
}

function generationScore({ student, contract, targetDate }) {
  const end = Date.parse(`${storedDate(contract?.endDate)}T00:00:00Z`)
  const reference = Date.parse(`${targetDate}T00:00:00Z`)
  const urgency = Number.isFinite(end) && Number.isFinite(reference)
    ? Math.max(0, 365 - Math.floor((end - reference) / 86400000))
    : 0
  const scarcity = Math.max(0, 100 - student.availableSlots.length * 8)
  return urgency + scarcity
}

function compareSlots(left, right) {
  const [leftDay, leftHour] = left.split('-')
  const [rightDay, rightHour] = right.split('-')
  return (DAY_ORDER.get(leftDay) ?? 99) - (DAY_ORDER.get(rightDay) ?? 99)
    || Number(leftHour) - Number(rightHour)
    || left.localeCompare(right)
}

function compareCandidatePriorities(left, right, leftOpensTeachingSlot, rightOpensTeachingSlot) {
  // Keep primary, then secondary PT ahead of pairing. Unassigned learners
  // have the same assignmentOrder on every edge, so their flow is unchanged.
  if (left.assignmentOrder !== right.assignmentOrder) return left.assignmentOrder - right.assignmentOrder
  if (leftOpensTeachingSlot !== rightOpensTeachingSlot) return Number(leftOpensTeachingSlot) - Number(rightOpensTeachingSlot)
  const tierComparison = schedulingTier(left) - schedulingTier(right)
  if (tierComparison !== 0) return tierComparison
  // Compact a PT's day before balancing equally valid work across PTs. This
  // is deliberately a comparator only: an isolated slot is never rejected
  // when it is the remaining way to fulfil a learner's weekly target.
  if (leftOpensTeachingSlot && rightOpensTeachingSlot) {
    if (left.preferredBlockLength !== right.preferredBlockLength) return right.preferredBlockLength - left.preferredBlockLength
    if (left.adjacentTeachingSlots !== right.adjacentTeachingSlots) return right.adjacentTeachingSlots - left.adjacentTeachingSlots
    if (left.isolatedTeachingSlot !== right.isolatedTeachingSlot) return Number(left.isolatedTeachingSlot) - Number(right.isolatedTeachingSlot)
    if (left.resultingBlockLength !== right.resultingBlockLength) return right.resultingBlockLength - left.resultingBlockLength
  }
  const ratioComparison = left.projectedDailyLoad * right.dailySessionTarget - right.projectedDailyLoad * left.dailySessionTarget
  if (ratioComparison !== 0) return ratioComparison
  if (left.schedulingPriority !== right.schedulingPriority) {
    return left.schedulingPriority - right.schedulingPriority
  }
  if (left.consecutiveDayPenalty !== right.consecutiveDayPenalty) return left.consecutiveDayPenalty - right.consecutiveDayPenalty
  if (left.score !== right.score) return right.score - left.score
  return compareSlots(left.slotId, right.slotId) || left.trainer.id.localeCompare(right.trainer.id)
}

function compareCandidates(left, right) {
  return compareCandidatePriorities(left, right, left.opensTeachingSlot, right.opensTeachingSlot)
}

function scheduleStudentCounts(schedule, data) {
  const counts = new Map()
  for (const [slotId, entries] of Object.entries(schedule || {})) for (const entry of entries) {
    if (entry.type === 'off' || entryOnApprovedOff(data, slotId, entry)) continue
    counts.set(entry.studentId, (counts.get(entry.studentId) || 0) + 1)
  }
  return counts
}

// The initial workspace paint deliberately skips contracts, availability and
// cross-branch session fan-out. Still expose a small, honest coverage
// projection so the UI can show what is already present in this branch draft
// without presenting it as a reconciled "missing sessions" result.
//
// This helper only inspects the bounded roster and the already-loaded draft
// matrix. `knownCrossBranchScheduledEntries` covers explicit cross-branch
// rows in the selected draft; sessions or drafts from other branches are
// intentionally left unknown until the reconciled path runs.
function quickCoverageForDisplay({
  weekId = '',
  branchId = '',
  schedule = {},
  students = [],
  crossBranchStudents = [],
} = {}) {
  const profiles = new Map()
  for (const student of [...(Array.isArray(students) ? students : []), ...(Array.isArray(crossBranchStudents) ? crossBranchStudents : [])]) {
    if (!student || typeof student.id !== 'string' || !student.id || profiles.has(student.id)) continue
    profiles.set(student.id, student)
  }
  const counts = scheduleStudentCounts(schedule)
  const scheduledStudentIds = new Set(counts.keys())
  const localTargetStudents = [...profiles.values()].filter((student) => {
    const inactive = ['inactive', 'archived', 'deleted'].includes(String(student.status || '').toLowerCase())
    const crossBranch = student.isCrossBranchDisplayOnly === true
      || (typeof student.branchId === 'string' && student.branchId && branchId && student.branchId !== branchId)
    return !inactive && !crossBranch && Math.max(0, Math.min(7, Number(student.sessionsPerWeek || 0))) > 0
  })
  const crossBranchTargetStudents = [...profiles.values()].filter((student) => {
    const inactive = ['inactive', 'archived', 'deleted'].includes(String(student.status || '').toLowerCase())
    const crossBranch = student.isCrossBranchDisplayOnly === true
      || (typeof student.branchId === 'string' && student.branchId && branchId && student.branchId !== branchId)
    return !inactive && crossBranch && Math.max(0, Math.min(7, Number(student.sessionsPerWeek || 0))) > 0
  })
  const targetFor = (student) => Math.max(0, Math.min(7, Number(student.sessionsPerWeek || 0)))
  const localScheduledEntries = localTargetStudents.reduce((total, student) => total + (counts.get(student.id) || 0), 0)
  const scheduledEntries = localTargetStudents.reduce((total, student) => total + Math.min(targetFor(student), counts.get(student.id) || 0), 0)
  const totalTargetSessions = localTargetStudents.reduce((total, student) => total + targetFor(student), 0)
  const crossBranchScheduledEntries = crossBranchTargetStudents.reduce((total, student) => total + (counts.get(student.id) || 0), 0)
  const crossBranchTargetSessions = crossBranchTargetStudents.reduce((total, student) => total + targetFor(student), 0)
  const knownStudentIds = new Set(profiles.keys())
  const unresolvedScheduledEntries = [...scheduledStudentIds]
    .filter((studentId) => !knownStudentIds.has(studentId))
    .reduce((total, studentId) => total + (counts.get(studentId) || 0), 0)
  const studentsWithAtLeastOne = localTargetStudents.filter((student) => (counts.get(student.id) || 0) > 0).length
  const fullyScheduledStudents = localTargetStudents.filter((student) => (counts.get(student.id) || 0) >= targetFor(student)).length
  return {
    // `ready` means the bounded projection is available. `verified:false`
    // keeps the distinction from the reconciled `status:'verified'` payload.
    status: 'ready',
    verification: 'unverified',
    verified: false,
    source: 'draft_roster',
    scope: 'selected_branch_draft',
    branchId,
    weekId,
    rosterStudents: profiles.size,
    targetStudents: localTargetStudents.length,
    // Eligibility and quota are intentionally unknown in this projection.
    eligibleStudents: null,
    studentsWithAtLeastOne,
    fullyScheduledStudents,
    totalTargetSessions,
    scheduledEntries,
    missingSessions: Math.max(0, totalTargetSessions - scheduledEntries),
    estimatedMissingSessions: Math.max(0, totalTargetSessions - scheduledEntries),
    localScheduledEntries,
    rawScheduledEntries: [...counts.values()].reduce((total, count) => total + count, 0),
    knownCrossBranchScheduledEntries: crossBranchScheduledEntries,
    crossBranchTargetStudents: crossBranchTargetStudents.length,
    crossBranchTargetSessions,
    crossBranchMissingSessions: null,
    otherBranchScheduledEntries: null,
    crossBranchCoverageVerified: false,
    unresolvedScheduledEntries,
    draftOnly: true,
  }
}

// A manual placement changes the schedule, but it does not rerun the
// optimizer. Keep the last per-student blocker diagnostics so the workspace
// can still distinguish "thiếu PT/ca" from a learner who simply needs the
// optimizer to try again. The UI derives the current missing count from the
// schedule, so a now-complete learner naturally drops out on the next read.
function preserveManualUnassignedEntries(currentEntries, schedule, options = {}) {
  const entries = Array.isArray(currentEntries) ? currentEntries : []
  const counts = scheduleStudentCounts(schedule)
  const selectedStudentId = typeof options.studentId === 'string' ? options.studentId : ''
  const command = typeof options.command === 'string' ? options.command : ''
  const targetSessions = Number.isInteger(options.targetSessions) ? options.targetSessions : null
  const next = []
  const seen = new Set()

  for (const entry of entries) {
    if (!entry || typeof entry.studentId !== 'string' || seen.has(entry.studentId)) continue
    seen.add(entry.studentId)
    let missingSessions = Math.max(0, Number(entry.missingSessions || 0))
    if (entry.studentId === selectedStudentId) {
      if (targetSessions !== null) {
        missingSessions = Math.max(0, targetSessions - (counts.get(entry.studentId) || 0))
      } else if (command === 'add_student') {
        missingSessions = Math.max(0, missingSessions - 1)
      } else if (command === 'remove_student') {
        missingSessions += 1
      }
    }
    if (missingSessions < 1) continue
    next.push({
      ...entry,
      missingSessions,
      diagnostics: entry.diagnostics
        ? { ...entry.diagnostics, scheduledSessions: counts.get(entry.studentId) || entry.diagnostics.scheduledSessions, missingSessions }
        : entry.diagnostics,
    })
  }

  for (const entry of Array.isArray(options.extraEntries) ? options.extraEntries : []) {
    if (!entry || typeof entry.studentId !== 'string' || seen.has(entry.studentId)) continue
    seen.add(entry.studentId)
    next.push(entry)
  }
  return next.slice(0, MAX_STUDENTS)
}

function trainerLoadsForSchedule(data, schedule, schedulingState = null) {
  const state = schedulingState || buildSchedulingState(schedule, data)
  const workingDays = Array.isArray(data.config?.workingDays) && data.config.workingDays.length
    ? [...new Set(data.config.workingDays)].filter((day) => DAY_ORDER.has(day)).sort((left, right) => (DAY_ORDER.get(left) ?? 99) - (DAY_ORDER.get(right) ?? 99))
    : [...DAY_ORDER.keys()]
  return [...data.trainers]
    .sort((left, right) => trainerSchedulingPolicy(left, data.config).schedulingPriority - trainerSchedulingPolicy(right, data.config).schedulingPriority || left.id.localeCompare(right.id))
    .flatMap((trainer) => {
      const policy = trainerSchedulingPolicy(trainer, data.config)
      return workingDays.map((day) => {
        const teachingSlots = state.trainerSlotsByDay.get(`${trainer.id}|${day}`)?.size || 0
        return {
          trainerId: trainer.id,
          trainerName: trainer.name,
          schedulingPriority: policy.schedulingPriority,
          employmentType: policy.employmentType,
          employmentLevel: policy.employmentLevel,
          day,
          date: dateForSlot(data.weekId, day),
          teachingSlots,
          sessionCount: teachingSlots,
          studentSessions: state.trainerStudentSessionsByDay.get(`${trainer.id}|${day}`) || 0,
          target: policy.dailySessionTarget,
          dailySessionTarget: policy.dailySessionTarget,
          remainingToTarget: Math.max(0, policy.dailySessionTarget - teachingSlots),
          status: teachingSlots > policy.dailySessionTarget
              ? 'over_target'
              : teachingSlots === policy.dailySessionTarget
                ? 'target'
                : 'under_target',
        }
      })
    })
}

function studentCoverageForSchedule(data, schedule) {
  const counts = scheduleStudentCounts(schedule, data)
  const targetStudents = data.students.filter((student) => student.status !== 'inactive' && student.eligibleForWeek !== false && student.sessionsPerWeek > 0)
  const eligibleStudents = targetStudents.length
  const studentsWithAtLeastOne = targetStudents.filter((student) => (counts.get(student.id) || 0) > 0).length
  const fullyScheduledStudents = targetStudents.filter((student) => (counts.get(student.id) || 0) >= student.sessionsPerWeek).length
  const totalTargetSessions = targetStudents.reduce((total, student) => total + student.sessionsPerWeek, 0)
  const scheduledEntries = targetStudents.reduce((total, student) => total + Math.min(student.sessionsPerWeek, counts.get(student.id) || 0), 0)
  return {
    eligibleStudents,
    studentsWithAtLeastOne,
    fullyScheduledStudents,
    totalTargetSessions,
    scheduledEntries,
    missingSessions: Math.max(0, totalTargetSessions - scheduledEntries),
  }
}

function teachingSlotGroups(data, schedule) {
  const trainerMap = new Map(data.trainers.map((trainer) => [trainer.id, trainer]))
  const groups = []
  for (const [slotId, entries] of Object.entries(schedule || {}).sort(([left], [right]) => compareSlots(left, right))) {
    const byTrainer = new Map()
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry.type === 'off') continue
      if (!byTrainer.has(entry.trainerId)) byTrainer.set(entry.trainerId, [])
      byTrainer.get(entry.trainerId).push(entry)
    }
    for (const [trainerId, trainingEntries] of [...byTrainer.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const trainer = trainerMap.get(trainerId)
      if (!trainer || !trainingEntries.length) continue
      groups.push({
        slotId,
        trainerId,
        trainer,
        entries: trainingEntries,
        capacity: Math.max(1, Number(trainer.slotCapacity || 1)),
      })
    }
  }
  return groups
}

function slotUtilizationForSchedule(data, schedule) {
  const groups = teachingSlotGroups(data, schedule)
  const desiredSeats = groups.reduce((total, group) => total + Math.min(2, group.capacity), 0)
  const occupiedDesiredSeats = groups.reduce((total, group) => total + Math.min(group.entries.length, Math.min(2, group.capacity)), 0)
  const pairedSlots = groups.filter((group) => group.entries.length >= 2).length
  const singleSlots = groups.filter((group) => group.entries.length === 1).length
  const fullSlots = groups.filter((group) => group.entries.length >= Math.min(2, group.capacity)).length
  return {
    teachingSlots: groups.length,
    studentSessions: groups.reduce((total, group) => total + group.entries.length, 0),
    pairedSlots,
    singleSlots,
    fullSlots,
    pairRatePercent: groups.length ? Math.round((pairedSlots / groups.length) * 1000) / 10 : 0,
    seatUtilizationPercent: desiredSeats ? Math.round((occupiedDesiredSeats / desiredSeats) * 1000) / 10 : 0,
  }
}

function candidateRecord(data, schedule, schedulingState, contractCache, student, trainer, slotId) {
  const result = candidateForSlot(data, { student, trainer, slotId, schedule, schedulingState, contractCache })
  if (!result.eligible) return null
  const contract = scheduleIndexes(data).contractsById.get(result.contractId)
  const assigned = assignedTrainerIds(contract)
  const assignmentIndex = assigned.indexOf(trainer.id)
  return {
    slotId,
    trainer,
    contractId: result.contractId,
    earlyHandover: result.earlyHandover === true,
    sourceContractId: result.sourceContractId || '',
    assignmentOrder: assignmentIndex >= 0 ? assignmentIndex : 1000,
    trainerAssignmentWarning: result.trainerAssignmentWarning === true,
    score: generationScore({ student, contract, targetDate: result.date }),
    currentDailyLoad: result.currentDailyLoad,
    projectedDailyLoad: result.projectedDailyLoad,
    dailySessionTarget: result.dailySessionTarget,
    schedulingPriority: result.schedulingPriority,
    employmentType: result.employmentType,
    employmentLevel: result.employmentLevel,
    opensTeachingSlot: result.opensTeachingSlot,
    consecutiveDayPenalty: result.consecutiveDayPenalty,
    adjacentTeachingSlots: result.adjacentTeachingSlots,
    preferredBlockLength: result.preferredBlockLength,
    resultingBlockLength: result.resultingBlockLength,
    isolatedTeachingSlot: result.isolatedTeachingSlot,
  }
}

function feasibleCandidatesForStudent(data, schedule, schedulingState, contractCache, student) {
  const candidates = []
  const indexes = scheduleIndexes(data)
  const slots = indexes.studentSlotsById.get(student.id)
    || [...new Set(student.availableSlots || [])].sort(compareSlots)
  const scheduledForStudent = schedulingState.studentSessionCounts.get(student.id) || 0
  const studentDays = schedulingState.studentDays.get(student.id) || new Set()
  const branchOverride = data.allowCrossBranchStudentIds instanceof Set && data.allowCrossBranchStudentIds.has(student.id)
  if (student.status === 'inactive' || student.eligibleForWeek === false
    || (student.branchId !== data.branch.id && !branchOverride)
    || scheduledForStudent >= Number(student.sessionsPerWeek || 0)) return candidates
  for (const slotId of slots) {
    const [day] = slotId.split('-')
    const date = dateForSlot(data.weekId, day)
    if (studentDays.has(day)
      || (Array.isArray(student.validScheduleDates) && !student.validScheduleDates.includes(date))) continue
    const configuredBranchCapacity = branchSlotCapacity(data.config, data.branch.id, slotId)
    if (configuredBranchCapacity !== null && (schedulingState.branchSlotCounts.get(slotId) || 0) >= configuredBranchCapacity) continue
    // Resolve the learner's renewal chain once for this date, before walking
    // the PT list. A learner with no usable contract should not pay the
    // trainer-edge cost at all.
    const contractResolution = cachedContractResolution(data, student.id, date, schedule, schedulingState, contractCache)
    if (!contractResolution.contract) continue
    // Invalid/inactive/unavailable PTs cannot produce a feasible edge. Keeping
    // them out of the Cartesian product is the largest win on large branches;
    // candidateForSlot remains exhaustive for the manual inspector path.
    const allAvailableTrainers = indexes.trainersBySlot.has(slotId)
      ? indexes.trainersBySlot.get(slotId)
      : (indexes.studentSlotsById.has(student.id) ? [] : indexes.sortedTrainers)
    const preferredIds = new Set((indexes.contractsByStudent.get(student.id) || []).flatMap(assignedTrainerIds))
    const occupied = allAvailableTrainers.filter((trainer) => schedulingState.trainerSlotCounts.has(`${trainer.id}|${slotId}`))
    const preferred = allAvailableTrainers.filter((trainer) => preferredIds.has(trainer.id))
    const generic = indexes.candidateTrainersBySlot.get(slotId) || allAvailableTrainers
    const trainers = [...new Map([...occupied, ...preferred, ...generic].map((trainer) => [trainer.id, trainer])).values()]
    for (const trainer of trainers) {
      const context = trainerSlotContext(data, schedulingState, trainer, slotId, indexes)
      const unavailable = !context.availability
        || context.availability.mode === 'unconfigured'
        || (trainer.employmentType === 'collaborator' && !context.availability.slots.has(slotId))
        || (trainer.employmentType !== 'collaborator' && context.availability.mode === 'configured' && !context.availability.slots.has(slotId))
      if (schedulingState.offTrainerSlots.has(context.trainerSlotKey)
        || context.trainerCount >= trainer.slotCapacity
        || unavailable) continue
      if ((indexes.leavesByTrainer.get(trainer.id) || []).some((leave) => leaveCovers(leave, trainer.id, date))) continue
      const candidate = candidateRecord(data, schedule, schedulingState, contractCache, student, trainer, slotId)
      if (candidate) candidates.push(candidate)
    }
  }
  return candidates.sort(compareCandidates)
}

/**
 * Estimate the maximum number of sessions a learner can receive in this week
 * from the current protected workload. This is intentionally a fast,
 * optimistic preflight rather than a second global solver: it uses the
 * learner's registered slots, concrete contract dates, PT availability,
 * leave/OFF markers and live slot capacity, then enforces one session/day.
 *
 * The value is used for diagnostics only. It never reduces the requested
 * weekly target and never blocks generation, so a soft scheduling preference
 * cannot turn into a hard operational failure.
 */
function feasibilitySlotIndex(data, schedule, state = buildSchedulingState(schedule, data)) {
  const indexes = scheduleIndexes(data)
  const workingDays = indexes.workingDays
  const workingHours = indexes.workingHours
  const holidays = indexes.holidays
  const slots = new Set(data.students.flatMap((student) => Array.isArray(student.availableSlots) ? student.availableSlots : []))
  const feasible = new Set()
  for (const slotId of slots) {
    const [day, rawHour] = String(slotId).split('-')
    const hour = Number(rawHour)
    const date = dateForSlot(data.weekId, day)
    if ((workingDays.length && !workingDays.includes(day))
      || (workingHours.length && !workingHours.includes(hour))
      || holidays.has(date)) continue
    const configuredBranchCapacity = branchSlotCapacity(data.config, data.branch.id, slotId)
    if (configuredBranchCapacity !== null && (state.branchSlotCounts.get(slotId) || 0) >= configuredBranchCapacity) continue
    const trainers = indexes.trainersBySlot.has(slotId)
      ? indexes.trainersBySlot.get(slotId)
      : (indexes.studentSlotsById.size ? [] : indexes.sortedTrainers)
    if (trainers.some((trainer) => {
      if (!trainer || trainerIsLocked(trainer) || trainer.branchId !== data.branch.id) return false
      const availability = indexes.trainerAvailabilityById.get(trainer.id)
      if (!availability || availability.mode === 'unconfigured') return false
      if (trainer.employmentType === 'collaborator' && !availability.slots.has(slotId)) return false
      if (trainer.employmentType !== 'collaborator' && availability.mode === 'configured' && !availability.slots.has(slotId)) return false
      if ((indexes.leavesByTrainer.get(trainer.id) || []).some((leave) => leaveCovers(leave, trainer.id, date))) return false
      const trainerSlotKey = `${trainer.id}|${slotId}`
      if (state.offTrainerSlots.has(trainerSlotKey)) return false
      return (state.trainerSlotCounts.get(trainerSlotKey) || 0) < Math.max(1, Number(trainer.slotCapacity || 1))
    })) feasible.add(slotId)
  }
  return feasible
}

function maximumFeasibleSessionsForStudent(data, student, schedule, prebuiltState = null, feasibleSlotIds = null) {
  if (!student || student.status === 'inactive' || student.eligibleForWeek === false) return 0
  const state = prebuiltState || buildSchedulingState(schedule, data)
  const existingEntries = Object.values(schedule || {}).flat().filter((entry) => entry.type !== 'off' && entry.studentId === student.id)
  const existingCount = existingEntries.length
  const existingDays = state.studentDays.get(student.id) || new Set()
  const configuredDates = Array.isArray(student.validScheduleDates) && student.validScheduleDates.length
    ? new Set(student.validScheduleDates)
    : new Set(datesForWeek(data.weekId).filter((date) => data.contracts.some((contract) => contract.studentId === student.id
      && contractCanServeScheduledDate(contract, date)
      && contract.branchId === data.branch.id
      && !contractPaused(contract, date))))
  const availableDates = new Map()
  for (const slotId of [...new Set(student.availableSlots || [])].sort(compareSlots)) {
    const [day] = slotId.split('-')
    const date = dateForSlot(data.weekId, day)
    if (!configuredDates.has(date) || existingDays.has(day)) continue
    if (feasibleSlotIds ? !feasibleSlotIds.has(slotId) : !feasibilitySlotIndex(data, schedule, state).has(slotId)) continue
    availableDates.set(date, (availableDates.get(date) || 0) + 1)
  }
  // Every date has at most one session for a learner. Sorting by the number
  // of options gives a small maximum-cardinality matching for date choices.
  const additional = [...availableDates.entries()]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .length
  const quota = Math.max(existingCount, Number(student.maxWeeklySessions || student.sessionsPerWeek || 7))
  return Math.min(7, quota, existingCount + additional)
}

/**
 * Return an optimistic upper bound for the number of learner sessions that
 * can still fit in the current draft. This is deliberately a seat-counting
 * pass (rather than another learner↔trainer matching pass): it is used only
 * to decide whether the generator should reserve seats for complete weekly
 * targets. Candidate validation still enforces every hard rule when entries
 * are committed.
 */
function availableTrainingSeatCapacity(data, schedule, prebuiltState = null) {
  const indexes = scheduleIndexes(data)
  const state = prebuiltState || buildSchedulingState(schedule, data)
  let total = 0
  // `studentSlotsById` is keyed by learner id; iterate actual slot ids from
  // learner availability (and trainer availability for protected/empty seats).
  const slotIds = new Set([
    ...indexes.trainersBySlot.keys(),
    ...[...indexes.studentSlotsById.values()].flat(),
  ])
  for (const slotId of slotIds) {
    const configuredBranchCapacity = branchSlotCapacity(data.config, data.branch.id, slotId)
    const branchRemaining = configuredBranchCapacity === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, configuredBranchCapacity - (state.branchSlotCounts.get(slotId) || 0))
    if (branchRemaining < 1) continue
    const [day] = String(slotId).split('-')
    const date = dateForSlot(data.weekId, day)
    let trainerSeats = 0
    for (const trainer of indexes.trainersBySlot.get(slotId) || []) {
      const trainerSlotKey = `${trainer.id}|${slotId}`
      if (state.offTrainerSlots.has(trainerSlotKey)
        || (indexes.leavesByTrainer.get(trainer.id) || []).some((leave) => leaveCovers(leave, trainer.id, date))) continue
      trainerSeats += Math.max(0, Math.max(1, Number(trainer.slotCapacity || 1))
        - (state.trainerSlotCounts.get(trainerSlotKey) || 0))
    }
    total += Math.min(branchRemaining, trainerSeats)
  }
  return Number.isFinite(total) ? Math.max(0, total) : Number.MAX_SAFE_INTEGER
}

// An optimistic seat upper bound for just one learner cohort. It deliberately
// ignores learner↔slot Hall conflicts, but catches concentrated cohorts whose
// targets cannot fit in the slots they collectively use. This is the cheap
// guard that decides whether the bounded cohort matching repair below is worth
// running.
function cohortSeatUpperBound(data, schedule, students, prebuiltState = null) {
  const indexes = scheduleIndexes(data)
  const state = prebuiltState || buildSchedulingState(schedule, data)
  const slotIds = new Set(students.flatMap((student) => Array.isArray(student.availableSlots) ? student.availableSlots : []))
  let total = 0
  for (const slotId of slotIds) {
    const configuredBranchCapacity = branchSlotCapacity(data.config, data.branch.id, slotId)
    const branchRemaining = configuredBranchCapacity === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, configuredBranchCapacity - (state.branchSlotCounts.get(slotId) || 0))
    if (branchRemaining < 1) continue
    const [day] = String(slotId).split('-')
    const date = dateForSlot(data.weekId, day)
    let trainerSeats = 0
    for (const trainer of indexes.trainersBySlot.get(slotId) || []) {
      const trainerSlotKey = `${trainer.id}|${slotId}`
      if (state.offTrainerSlots.has(trainerSlotKey)
        || (indexes.leavesByTrainer.get(trainer.id) || []).some((leave) => leaveCovers(leave, trainer.id, date))) continue
      trainerSeats += Math.max(0, Math.max(1, Number(trainer.slotCapacity || 1))
        - (state.trainerSlotCounts.get(trainerSlotKey) || 0))
    }
    total += Math.min(branchRemaining, trainerSeats)
  }
  return Number.isFinite(total) ? Math.max(0, total) : Number.MAX_SAFE_INTEGER
}

function compareCohortSimulationScores(left, right) {
  return left.fullCount - right.fullCount || left.assignedCount - right.assignedCount
}

/**
 * Run the normal round matcher against a temporary schedule for one proposed
 * cohort. This is only used by the bounded conflict repair, never by the
 * broad-branch fast path. It gives the repair an exact hard-rule check without
 * moving any protected or incumbent entries in the real draft.
 */
function simulateCohortCompletion(data, schedule, cohort, remainingByStudent) {
  const temporary = Object.fromEntries(Object.entries(schedule).map(([slotId, entries]) => [slotId, [...entries]]))
  const localRemaining = new Map(cohort.map((student) => [student.id, Math.max(0, Number(remainingByStudent.get(student.id) || 0))]))
  let assignedCount = 0
  let progress = true
  while (progress) {
    const roundStudents = cohort.filter((student) => (localRemaining.get(student.id) || 0) > 0)
    if (!roundStudents.length) break
    const assignments = matchSchedulingRound(data, temporary, roundStudents)
    if (!assignments.length) break
    progress = false
    for (const { student, candidate } of assignments) {
      temporary[candidate.slotId] = [...(temporary[candidate.slotId] || []), autoEntryForCandidate(data, student, candidate)]
      localRemaining.set(student.id, Math.max(0, (localRemaining.get(student.id) || 0) - 1))
      assignedCount += 1
      progress = true
    }
  }
  const counts = scheduleStudentCounts(temporary, data)
  const fullCount = cohort.filter((student) => (counts.get(student.id) || 0) >= Number(student.sessionsPerWeek || 0)).length
  return { schedule: temporary, fullCount, assignedCount }
}

/**
 * Pick a bounded cohort whose remaining weekly targets fit inside the current
 * seat budget. When the branch cannot even give every incomplete learner one
 * session, completing a smaller cohort is more useful than spreading one
 * session across everybody. The cohort is intentionally selected only from
 * learners with an optimistic path to their target; otherwise the normal
 * coverage-first rounds remain the least surprising result.
 */
function completionFirstCohort(data, schedule, students, remainingByStudent, sessionBudget) {
  const budget = Math.max(0, Number(sessionBudget || 0))
  if (!budget) return { students: [], reservedSessions: 0, profiles: [] }
  const state = buildSchedulingState(schedule, data)
  const feasibleSlotIds = feasibilitySlotIndex(data, schedule, state)
  const profiles = students
    .map((student) => {
      const scheduled = state.studentSessionCounts.get(student.id) || 0
      const remaining = Math.max(0, Number(remainingByStudent.get(student.id) || 0))
      const maximum = maximumFeasibleSessionsForStudent(data, student, schedule, state, feasibleSlotIds)
      return {
        student,
        scheduled,
        remaining,
        maximum,
        feasibleAdditional: Math.max(0, maximum - scheduled),
      }
    })
    .filter((profile) => profile.remaining > 0)
    .sort((left, right) => left.remaining - right.remaining
      || left.feasibleAdditional - right.feasibleAdditional
      || (left.student.availableSlots?.length || 0) - (right.student.availableSlots?.length || 0)
      || left.student.name.localeCompare(right.student.name, 'vi')
      || left.student.id.localeCompare(right.student.id))
  const completable = profiles.filter((profile) => profile.feasibleAdditional >= profile.remaining)
  const selectedProfiles = []
  let reservedSessions = 0
  for (const profile of completable) {
    if (reservedSessions + profile.remaining > budget) continue
    selectedProfiles.push(profile)
    reservedSessions += profile.remaining
  }
  if (!selectedProfiles.length) return { students: [], reservedSessions: 0, profiles }

  // The seat budget is optimistic: two learners may each have enough slots in
  // isolation but compete for the same narrow trainer/slot edges. Only enter
  // the exact (and bounded) repair when the selected cohort's aggregate slot
  // seats are already insufficient; broad branches skip this extra matching
  // work entirely.
  const selectedStudents = selectedProfiles.map((profile) => profile.student)
  const cohortUpperBound = cohortSeatUpperBound(data, schedule, selectedStudents, state)
  if (cohortUpperBound >= reservedSessions || selectedProfiles.length < 2) {
    return { students: selectedStudents, reservedSessions, profiles }
  }

  let currentProfiles = [...selectedProfiles]
  let currentResult = simulateCohortCompletion(data, schedule, currentProfiles.map((profile) => profile.student), remainingByStudent)
  const unselectedProfiles = completable.filter((profile) => !currentProfiles.some((selected) => selected.student.id === profile.student.id))
  let attempts = 0
  let candidateOffset = 0
  while (attempts < MAX_COHORT_REPAIR_ATTEMPTS && candidateOffset < unselectedProfiles.length) {
    const incomplete = currentProfiles
      .filter((profile) => !currentResult.schedule || (scheduleStudentCounts(currentResult.schedule, data).get(profile.student.id) || 0) < profile.student.sessionsPerWeek)
      .sort((left, right) => right.remaining - left.remaining || left.student.id.localeCompare(right.student.id))
    if (!incomplete.length) break
    let improved = null
    for (const removed of incomplete) {
      for (let index = candidateOffset; index < Math.min(unselectedProfiles.length, candidateOffset + MAX_COHORT_REPAIR_CANDIDATES); index += 1) {
        const added = unselectedProfiles[index]
        if (currentProfiles.some((profile) => profile.student.id === added.student.id)) continue
        const nextReserved = reservedSessions - removed.remaining + added.remaining
        if (nextReserved > budget) continue
        const trialProfiles = currentProfiles
          .filter((profile) => profile.student.id !== removed.student.id)
          .concat(added)
        const trialResult = simulateCohortCompletion(data, schedule, trialProfiles.map((profile) => profile.student), remainingByStudent)
        attempts += 1
        if (compareCohortSimulationScores(trialResult, currentResult) > 0) {
          improved = { trialProfiles, trialResult, nextReserved }
          candidateOffset = index + 1
          break
        }
        if (attempts >= MAX_COHORT_REPAIR_ATTEMPTS) break
      }
      if (improved || attempts >= MAX_COHORT_REPAIR_ATTEMPTS) break
    }
    if (!improved) break
    currentProfiles = improved.trialProfiles
    currentResult = improved.trialResult
    reservedSessions = improved.nextReserved
  }
  return {
    students: currentProfiles.map((profile) => profile.student),
    reservedSessions,
    profiles,
  }
}

function studentFeasibilityForSchedule(data, schedule, baseSchedule = schedule) {
  const counts = scheduleStudentCounts(schedule, data)
  const state = buildSchedulingState(baseSchedule, data)
  const feasibleSlotIds = feasibilitySlotIndex(data, baseSchedule, state)
  return data.students
    .filter((student) => student.status !== 'inactive' && student.eligibleForWeek !== false && Number(student.sessionsPerWeek || 0) > 0)
    .map((student) => {
      const scheduledSessions = counts.get(student.id) || 0
      const maximumFeasibleSessions = maximumFeasibleSessionsForStudent(data, student, baseSchedule, state, feasibleSlotIds)
      return {
        studentId: student.id,
        studentName: student.name,
        requestedSessions: Number(student.sessionsPerWeek || 0),
        maximumFeasibleSessions,
        scheduledSessions,
        missingSessions: Math.max(0, Number(student.sessionsPerWeek || 0) - scheduledSessions),
        impossibleSessions: Math.max(0, Number(student.sessionsPerWeek || 0) - maximumFeasibleSessions),
      }
    })
}

function matchSchedulingRound(data, schedule, students) {
  const state = buildSchedulingState(schedule, data)
  const contractCache = new Map()
  const candidatesByStudent = new Map(students.map((student) => [
    student.id,
    feasibleCandidatesForStudent(data, schedule, state, contractCache, student),
  ]))
  // Real feasible edges, not the raw number of submitted availability cells,
  // define scarcity. Contract end urgency breaks ties globally.
  const orderedStudents = [...students].sort((left, right) => {
    const leftCandidates = candidatesByStudent.get(left.id) || []
    const rightCandidates = candidatesByStudent.get(right.id) || []
    const leftUrgency = leftCandidates.reduce((score, candidate) => Math.max(score, candidate.score), 0)
    const rightUrgency = rightCandidates.reduce((score, candidate) => Math.max(score, candidate.score), 0)
    const leftScheduled = state.studentSessionCounts.get(left.id) || 0
    const rightScheduled = state.studentSessionCounts.get(right.id) || 0
    const leftRemainingTarget = Math.max(0, Number(left.sessionsPerWeek || 0) - leftScheduled)
    const rightRemainingTarget = Math.max(0, Number(right.sessionsPerWeek || 0) - rightScheduled)
    return leftCandidates.length - rightCandidates.length
      || rightUrgency - leftUrgency
      // When scarcity is equal, close the learner with fewer remaining
      // sessions first. This is the local ordering that makes the global
      // lexicographic objective (more fully scheduled learners) visible to
      // the augmenting-path matcher instead of splitting two targets evenly.
      || leftRemainingTarget - rightRemainingTarget
      || left.name.localeCompare(right.name, 'vi')
      || left.id.localeCompare(right.id)
  })
  const priorityIndex = new Map(orderedStudents.map((student, index) => [student.id, index]))
  const assignments = new Map()
  const occupantsByTarget = new Map()
  const assignedStudentsByBranchSlot = new Map()
  const targetCapacity = new Map()

  for (const candidates of candidatesByStudent.values()) {
    for (const candidate of candidates) {
      const targetKey = `${candidate.trainer.id}|${candidate.slotId}`
      if (!targetCapacity.has(targetKey)) {
        const occupied = state.trainerSlotCounts.get(targetKey) || 0
        targetCapacity.set(targetKey, Math.max(0, Number(candidate.trainer.slotCapacity || 1) - occupied))
      }
    }
  }

  const setAssignment = (studentId, candidate) => {
    const previous = assignments.get(studentId)
    if (previous) {
      const previousKey = `${previous.trainer.id}|${previous.slotId}`
      occupantsByTarget.set(previousKey, (occupantsByTarget.get(previousKey) || []).filter((id) => id !== studentId))
      assignedStudentsByBranchSlot.set(previous.slotId, (assignedStudentsByBranchSlot.get(previous.slotId) || []).filter((id) => id !== studentId))
    }
    const targetKey = `${candidate.trainer.id}|${candidate.slotId}`
    assignments.set(studentId, candidate)
    occupantsByTarget.set(targetKey, [...(occupantsByTarget.get(targetKey) || []), studentId])
    assignedStudentsByBranchSlot.set(candidate.slotId, [...(assignedStudentsByBranchSlot.get(candidate.slotId) || []), studentId])
  }

  const tryAssign = (studentId, visitedStudents = new Set(), visitedTargets = new Set()) => {
    if (visitedStudents.has(studentId)) return false
    visitedStudents.add(studentId)
    // Re-rank with assignments already made in this round. Without this live
    // occupancy check, two learners evaluated from the same empty snapshot can
    // unnecessarily open two 1/2 classes instead of sharing one class.
    const rankedCandidates = [...(candidatesByStudent.get(studentId) || [])].sort((left, right) => {
      const liveTargetRank = (candidate) => {
        const targetKey = `${candidate.trainer.id}|${candidate.slotId}`
        const occupants = occupantsByTarget.get(targetKey) || []
        const capacity = targetCapacity.get(targetKey) || 0
        // Pair a live class first, then use an empty seat, and only inspect a
        // full target when an augmenting path is genuinely necessary. The old
        // binary "opens slot" rank explored every full target before the first
        // free one on large branches (quadratic matching time).
        if (occupants.length > 0 && occupants.length < capacity) return 0
        if (occupants.length === 0 && capacity > 0) return 1
        return 2
      }
      const leftRank = liveTargetRank(left), rightRank = liveTargetRank(right)
      const rankDifference = leftRank - rightRank
      // An occupied primary is not a free seat. Only displace a matched
      // learner when no direct seat works, avoiding needless support moves.
      if ((leftRank === 2) !== (rightRank === 2)) return rankDifference
      if (left.assignmentOrder !== right.assignmentOrder) return left.assignmentOrder - right.assignmentOrder
      if (rankDifference !== 0) return rankDifference
      const liveOpensSlot = (candidate) => {
        const targetKey = `${candidate.trainer.id}|${candidate.slotId}`
        return (state.trainerSlotCounts.get(targetKey) || 0) + (occupantsByTarget.get(targetKey) || []).length === 0
      }
      return compareCandidatePriorities(left, right, liveOpensSlot(left), liveOpensSlot(right))
    })
    for (const candidate of rankedCandidates) {
      const targetKey = `${candidate.trainer.id}|${candidate.slotId}`
      if (visitedTargets.has(targetKey) || (targetCapacity.get(targetKey) || 0) < 1) continue
      const configuredBranchCapacity = branchSlotCapacity(data.config, data.branch.id, candidate.slotId)
      const previous = assignments.get(studentId)
      const alreadyUsesBranchSlot = previous?.slotId === candidate.slotId
      const projectedBranchLoad = (state.branchSlotCounts.get(candidate.slotId) || 0)
        + (assignedStudentsByBranchSlot.get(candidate.slotId) || []).length
        + (alreadyUsesBranchSlot ? 0 : 1)
      if (configuredBranchCapacity !== null && projectedBranchLoad > configuredBranchCapacity) continue
      const occupants = occupantsByTarget.get(targetKey) || []
      if (occupants.length < targetCapacity.get(targetKey)) {
        setAssignment(studentId, candidate)
        return true
      }
      const movable = [...occupants].sort((left, right) => {
        const flexibility = (candidatesByStudent.get(right)?.length || 0) - (candidatesByStudent.get(left)?.length || 0)
        return flexibility || (priorityIndex.get(right) || 0) - (priorityIndex.get(left) || 0) || right.localeCompare(left)
      })
      for (const occupantId of movable) {
        if (visitedStudents.has(occupantId)) continue
        const nextVisitedTargets = new Set(visitedTargets)
        nextVisitedTargets.add(targetKey)
        if (!tryAssign(occupantId, visitedStudents, nextVisitedTargets)) continue
        setAssignment(studentId, candidate)
        return true
      }
    }
    return false
  }

  for (const student of orderedStudents) tryAssign(student.id, new Set(), new Set())
  return orderedStudents
    .filter((student) => assignments.has(student.id))
    .map((student) => ({ student, candidate: assignments.get(student.id) }))
}

function autoEntryForCandidate(data, student, candidate, template = null) {
  return {
    studentId: student.id,
    trainerId: candidate.trainer.id,
    contractId: candidate.contractId,
    branchId: data.branch.id,
    type: 'training',
    source: template?.source || 'auto_v4',
    ...(candidate.earlyHandover && candidate.sourceContractId ? {
      renewalHandoverPending: true,
      sourceContractId: candidate.sourceContractId,
    } : {}),
    ...(candidate.trainerAssignmentWarning ? { trainerAssignmentWarning: true } : {}),
  }
}

function scheduleWithEntry(schedule, slotId, entry) {
  return { ...schedule, [slotId]: [...(schedule[slotId] || []), entry] }
}

function scheduleWithoutEntry(schedule, slotId, entry) {
  const values = schedule[slotId] || []
  const index = values.indexOf(entry)
  if (index < 0) return schedule
  const remaining = [...values.slice(0, index), ...values.slice(index + 1)]
  if (remaining.length) return { ...schedule, [slotId]: remaining }
  const next = { ...schedule }
  delete next[slotId]
  return next
}

function repairTargetKey(candidate) {
  return `${candidate.trainer.id}|${candidate.slotId}`
}

function boundedRepairCandidates(data, student, schedule, forbiddenTargets, budget) {
  const candidates = []
  const state = buildSchedulingState(schedule, data)
  const contractCache = new Map()
  const trainers = [...data.trainers].sort((left, right) => trainerSchedulingPolicy(left, data.config).schedulingPriority - trainerSchedulingPolicy(right, data.config).schedulingPriority || left.id.localeCompare(right.id))
  const slots = [...new Set(student.availableSlots || [])].sort(compareSlots)
  const offset = Number(budget.offset || 0) % Math.max(1, slots.length)
  search: for (const slotId of [...slots.slice(offset), ...slots.slice(0, offset)]) {
    for (const trainer of trainers) {
      if (budget.nodes >= budget.limit) break search
      budget.nodes += 1
      const candidate = candidateRecord(data, schedule, state, contractCache, student, trainer, slotId)
      if (!candidate || forbiddenTargets.has(repairTargetKey(candidate))) continue
      candidates.push(candidate)
      // Direct seats are only an escape route for a displaced entry. A bounded
      // best-candidate set keeps repair latency stable on large branches.
      // Keep the best candidates across the whole bounded scan, not just the
      // first 80 chronological cells (which starved late-week opportunities).
      if (candidates.length > MAX_REPAIR_DIRECT_CANDIDATES * 2) {
        candidates.sort(compareCandidates)
        candidates.length = MAX_REPAIR_DIRECT_CANDIDATES
      }
    }
  }
  return candidates.sort(compareCandidates).slice(0, MAX_REPAIR_DIRECT_CANDIDATES)
}

/**
 * Place one more learner session by relocating only mutable auto-generated
 * entries. Every recursive step removes an existing entry before validating
 * its replacement, so quota, one-session-per-day, PT availability, leave/OFF,
 * exact contract dates and branch rules continue to be enforced by the same
 * candidateForSlot path used by normal generation.
 */
function repairMove(student, origin, candidate) {
  return {
    studentId: student.id,
    studentName: student.name || '',
    fromSlotId: origin?.slotId || null,
    fromTrainerId: origin?.entry?.trainerId || null,
    toSlotId: candidate.slotId,
    toTrainerId: candidate.trainer.id,
  }
}

function studentHistoricalDeficit(student) {
  return Math.max(0, Number(
    student?.consecutiveMissingWeeks
      ?? student?.missingWeeks
      ?? student?.priorWeekMissingSessions
      ?? 0,
  ) || 0)
}

function studentContractUrgency(data, student) {
  const reference = Date.parse(`${data.weekId}T00:00:00.000Z`)
  const endDates = data.contracts
    .filter((contract) => contract.studentId === student.id
      && contract.branchId === data.branch.id
      && ['active', 'future'].includes(String(contract.status || 'active').toLowerCase()))
    .map((contract) => Date.parse(`${storedDate(contract.endDate)}T00:00:00.000Z`))
    .filter(Number.isFinite)
  if (!endDates.length || !Number.isFinite(reference)) return Number.MAX_SAFE_INTEGER
  return Math.max(0, Math.floor((Math.min(...endDates) - reference) / 86400000))
}

function orderedRescueStudents(data, schedule, students, localRemaining) {
  const counts = scheduleStudentCounts(schedule, data)
  const state = buildSchedulingState(schedule, data)
  const feasibleSlotIds = feasibilitySlotIndex(data, schedule, state)
  return students
    .filter((student) => (localRemaining.get(student.id) || 0) > 0)
    .map((student) => {
      const scheduled = counts.get(student.id) || 0
      const maximumFeasible = maximumFeasibleSessionsForStudent(data, student, schedule, state, feasibleSlotIds)
      return {
        student,
        scheduled,
        missing: localRemaining.get(student.id) || 0,
        feasibleAdditional: Math.max(0, maximumFeasible - scheduled),
        historicalDeficit: studentHistoricalDeficit(student),
        contractUrgency: studentContractUrgency(data, student),
      }
    })
    .sort((left, right) => Number(left.scheduled > 0) - Number(right.scheduled > 0)
      || right.missing - left.missing
      || left.feasibleAdditional - right.feasibleAdditional
      || right.historicalDeficit - left.historicalDeficit
      || left.contractUrgency - right.contractUrgency
      || (left.student.availableSlots?.length || 0) - (right.student.availableSlots?.length || 0)
      || left.student.name.localeCompare(right.student.name, 'vi')
      || left.student.id.localeCompare(right.student.id))
    .map((profile) => profile.student)
}

function rescueOutcomeScore(data, schedule, students, remainingByStudent, relocations) {
  const state = buildSchedulingState(schedule, data)
  const counts = scheduleStudentCounts(schedule, data)
  const feasibleSlotIds = feasibilitySlotIndex(data, schedule, state)
  const lookahead = orderedRescueStudents(data, schedule, students, remainingByStudent)
    .slice(0, MAX_RESCUE_LOOKAHEAD_STUDENTS)
  let futureRescuableSessions = 0
  let futureCompletableStudents = 0
  let uncoveredStudentsWithAPath = 0
  for (const student of lookahead) {
    const remaining = Math.max(0, Number(remainingByStudent.get(student.id) || 0))
    if (!remaining) continue
    const scheduled = counts.get(student.id) || 0
    const maximumFeasible = maximumFeasibleSessionsForStudent(data, student, schedule, state, feasibleSlotIds)
    const feasibleAdditional = Math.max(0, maximumFeasible - scheduled)
    futureRescuableSessions += Math.min(remaining, feasibleAdditional)
    if (feasibleAdditional >= remaining) futureCompletableStudents += 1
    if (scheduled === 0 && feasibleAdditional > 0) uncoveredStudentsWithAPath += 1
  }
  const utilization = slotUtilizationForSchedule(data, schedule)
  const supportAssignments = Object.values(schedule).flat().filter((entry) => entry.type !== 'off' && entry.trainerAssignmentWarning === true).length
  const threeConsecutiveDayRuns = [...state.studentDays.values()]
    .reduce((total, days) => total + consecutiveTrainingDayRunCount(days), 0)
  return [
    uncoveredStudentsWithAPath,
    // Once every learner with a feasible path has at least one class, prefer
    // plans that complete more weekly targets. A plan that adds many partial
    // sessions must not outrank one that closes a learner's target entirely.
    futureCompletableStudents,
    futureRescuableSessions,
    ...trainerAssignmentScore(data, schedule),
    utilization.pairedSlots,
    -utilization.singleSlots,
    -supportAssignments,
    -relocations,
    // Spacing is a final rescue tie-break only. It can never displace a plan
    // that covers more learners, closes more targets, or rescues more seats.
    -threeConsecutiveDayRuns,
  ]
}

function compareScoreVectors(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = Number(right[index] || 0) - Number(left[index] || 0)
    if (difference) return difference
  }
  return 0
}

function repairAlternativesForStudent(data, studentMap, student, schedule, budget) {
  const alternatives = []
  const forbiddenRootTargets = new Set()
  while (alternatives.length < MAX_RESCUE_PLAN_CANDIDATES && budget.nodes < budget.limit) {
    const repaired = tryRepairPlacement(
      data,
      studentMap,
      student,
      schedule,
      null,
      MAX_REPAIR_CHAIN_DEPTH,
      new Set(),
      forbiddenRootTargets,
      budget,
    )
    if (!repaired) break
    alternatives.push(repaired)
    const rootMove = [...repaired.moves].reverse().find((move) => move.studentId === student.id)
    if (!rootMove?.toSlotId || !rootMove?.toTrainerId) break
    const targetKey = `${rootMove.toTrainerId}|${rootMove.toSlotId}`
    if (forbiddenRootTargets.has(targetKey)) break
    forbiddenRootTargets.add(targetKey)
  }
  return alternatives
}

function tryRepairPlacement(data, studentMap, student, schedule, origin, depth, visitedStudents, forbiddenTargets, budget) {
  if (!student || visitedStudents.has(student.id) || budget.nodes >= budget.limit) return null
  const nextVisitedStudents = new Set(visitedStudents)
  nextVisitedStudents.add(student.id)

  const directCandidates = boundedRepairCandidates(data, student, schedule, forbiddenTargets, budget)
  for (const candidate of directCandidates) {
    return {
      schedule: scheduleWithEntry(schedule, candidate.slotId, autoEntryForCandidate(data, student, candidate, origin?.entry || null)),
      relocations: 0,
      moves: [repairMove(student, origin, candidate)],
    }
  }
  if (depth < 1) return null

  const displacementAttempts = []
  const displacementContractCache = new Map()
  displacementSearch: for (const slotId of [...new Set(student.availableSlots || [])].sort(compareSlots)) {
    for (const trainer of [...data.trainers].sort((left, right) => left.id.localeCompare(right.id))) {
      if (budget.nodes >= budget.limit) break displacementSearch
      const targetKey = `${trainer.id}|${slotId}`
      if (forbiddenTargets.has(targetKey)) continue
      const branchEntries = (schedule[slotId] || []).filter((entry) => entry.type !== 'off')
      const trainerEntries = branchEntries.filter((entry) => entry.trainerId === trainer.id)
      const branchCapacity = branchSlotCapacity(data.config, data.branch.id, slotId)
      const branchFull = branchCapacity !== null && branchEntries.length >= branchCapacity
      if (!branchFull && trainerEntries.length < Math.max(1, Number(trainer.slotCapacity || 1))) continue
      const movableEntries = (branchFull ? branchEntries : trainerEntries).filter((entry) => entry.source === 'auto_v4'
        && entry.isLocked !== true
        && studentMap.has(entry.studentId)
        && !nextVisitedStudents.has(entry.studentId))
      for (const occupantEntry of movableEntries) {
        if (budget.nodes >= budget.limit) break displacementSearch
        const withoutOccupant = scheduleWithoutEntry(schedule, slotId, occupantEntry)
        budget.nodes += 1
        const candidate = candidateRecord(data, withoutOccupant, buildSchedulingState(withoutOccupant, data), displacementContractCache, student, trainer, slotId)
        if (!candidate) continue
        displacementAttempts.push({
          candidate,
          occupantEntry,
          occupantStudent: studentMap.get(occupantEntry.studentId),
          schedule: withoutOccupant,
        })
      }
    }
  }

  displacementAttempts.sort((left, right) => compareCandidates(left.candidate, right.candidate)
    || (right.occupantStudent.availableSlots?.length || 0) - (left.occupantStudent.availableSlots?.length || 0)
    || left.occupantStudent.id.localeCompare(right.occupantStudent.id))

  for (const attempt of displacementAttempts.slice(0, MAX_REPAIR_DISPLACEMENT_CANDIDATES)) {
    if (budget.nodes >= budget.limit) break
    const targetKey = repairTargetKey(attempt.candidate)
    const nextForbiddenTargets = new Set(forbiddenTargets)
    nextForbiddenTargets.add(targetKey)
    const relocated = tryRepairPlacement(
      data,
      studentMap,
      attempt.occupantStudent,
      // Reserve the newly freed seat BEFORE moving its occupant. Otherwise
      // the relocation can consume the same branch capacity via another PT.
      scheduleWithEntry(attempt.schedule, attempt.candidate.slotId, autoEntryForCandidate(data, student, attempt.candidate, origin?.entry || null)),
      { entry: attempt.occupantEntry, slotId: attempt.candidate.slotId },
      depth - 1,
      nextVisitedStudents,
      nextForbiddenTargets,
      budget,
    )
    if (!relocated) continue
    return {
      schedule: relocated.schedule,
      relocations: relocated.relocations + 1,
      moves: [...relocated.moves, repairMove(student, origin, attempt.candidate)],
    }
  }
  return null
}

function repairCoverageWithRelocations(data, inputSchedule, students, remainingByStudent, options = {}) {
  let schedule = Object.fromEntries(Object.entries(inputSchedule).map(([slotId, entries]) => [slotId, [...entries]]))
  const studentMap = new Map(students.map((student) => [student.id, student]))
  const localRemaining = new Map(students.map((student) => [student.id, Math.max(0, Number(remainingByStudent.get(student.id) || 0))]))
  const maxAssignments = Math.max(0, Number(options.maxAssignments ?? MAX_DRAFT_ENTRIES))
  const budget = { nodes: 0, limit: Math.max(1, Number(options.maxSearchNodes || MAX_REPAIR_SEARCH_NODES)), offset: Number(options.searchOffset || 0) }
  const assignedStudentIds = []
  const swapTrace = []
  let relocations = 0
  let evaluatedPlans = 0
  let progress = true

  while (progress && assignedStudentIds.length < maxAssignments && budget.nodes < budget.limit) {
    progress = false
    const missingStudents = orderedRescueStudents(data, schedule, students, localRemaining)
    const offset = budget.offset % Math.max(1, missingStudents.length)
    const fairStudents = [...missingStudents.slice(offset), ...missingStudents.slice(0, offset)]
      .sort((a, b) => Number((scheduleStudentCounts(schedule, data).get(a.id) || 0) > 0) - Number((scheduleStudentCounts(schedule, data).get(b.id) || 0) > 0))
    for (const student of fairStudents) {
      if (assignedStudentIds.length >= maxAssignments || budget.nodes >= budget.limit) break
      // Allocate a per-learner slice, leaving search for other missing people.
      const localBudget = { nodes: 0, limit: Math.min(budget.limit - budget.nodes, Math.max(600, Math.floor(budget.limit / Math.max(1, fairStudents.length)))), offset: budget.offset }
      const alternatives = repairAlternativesForStudent(data, studentMap, student, schedule, localBudget)
      budget.nodes += localBudget.nodes
      evaluatedPlans += alternatives.length
      const nextRemaining = new Map(localRemaining)
      nextRemaining.set(student.id, Math.max(0, (nextRemaining.get(student.id) || 0) - 1))
      const repaired = alternatives
        .map((alternative) => ({
          ...alternative,
          rescueScore: rescueOutcomeScore(data, alternative.schedule, students, nextRemaining, alternative.relocations),
        }))
        .sort((left, right) => compareScoreVectors(left.rescueScore, right.rescueScore)
          || JSON.stringify(left.moves).localeCompare(JSON.stringify(right.moves)))[0]
      if (!repaired) continue
      schedule = repaired.schedule
      localRemaining.set(student.id, Math.max(0, (localRemaining.get(student.id) || 0) - 1))
      assignedStudentIds.push(student.id)
      relocations += repaired.relocations
      swapTrace.push(...repaired.moves)
      progress = true
    }
  }

  return {
    schedule,
    assignedStudentIds,
    assignments: assignedStudentIds.length,
    relocations,
    searchNodes: budget.nodes,
    // A per-learner slice is an intentional fairness partition. It is not a
    // global safety exhaustion and should not surface as a warning unless the
    // shared search budget is actually consumed.
    searchLimitReached: budget.nodes >= budget.limit,
    evaluatedPlans,
    swapTrace,
  }
}

function hasThreeConsecutiveTrainingDays(days) {
  const indexes = new Set([...(days || [])].map((day) => DAY_ORDER.get(day)).filter(Number.isInteger))
  return [...indexes].some((index) => indexes.has(index + 1) && indexes.has(index + 2))
}

function consecutiveTrainingDayRunCount(days) {
  const indexes = [...new Set([...(days || [])]
    .map((day) => DAY_ORDER.get(day))
    .filter(Number.isInteger))].sort((left, right) => left - right)
  return indexes.reduce((count, index, position) => count
    + (indexes[position + 1] === index + 1 && indexes[position + 2] === index + 2 ? 1 : 0), 0)
}

/**
 * Explain 3-day learner runs without turning the spacing preference into a
 * hard scheduling rule. `avoidable` is deliberately local: it means there
 * is at least one valid move of an auto-generated entry for the learner that
 * removes the run while preserving the learner's session count. A run that
 * has no such move is reported as unavoidable under the current inputs.
 */
function threeConsecutiveDayAudit(data, schedule, students = data.students || []) {
  const state = buildSchedulingState(schedule, data)
  const rows = []
  let candidateChecks = 0
  let truncated = false
  const inspectedStudents = students.slice(0, MAX_THREE_DAY_AUDIT_STUDENTS)
  if (students.length > inspectedStudents.length) truncated = true
  auditStudents: for (const student of inspectedStudents) {
    const days = state.studentDays.get(student.id) || new Set()
    const runCount = consecutiveTrainingDayRunCount(days)
    if (!runCount) continue
    let avoidable = false
    const entries = Object.entries(schedule || {}).flatMap(([slotId, values]) => (Array.isArray(values) ? values
      .filter((entry) => entry.type !== 'off' && entry.studentId === student.id && entry.source === 'auto_v4' && entry.isLocked !== true)
      .map((entry) => ({ slotId, entry })) : []))
    const candidateSlotList = [...new Set(Array.isArray(student.availableSlots) ? student.availableSlots : [])].sort(compareSlots)
    if (candidateSlotList.length > MAX_THREE_DAY_AUDIT_SLOTS_PER_STUDENT
      || (data.trainers || []).length > MAX_THREE_DAY_AUDIT_TRAINERS) truncated = true
    for (const { slotId, entry } of entries) {
      const temporary = scheduleWithoutEntry(schedule, slotId, entry)
      const temporaryState = buildSchedulingState(temporary, data)
      const temporaryDays = temporaryState.studentDays.get(student.id) || new Set()
      for (const candidateSlotId of candidateSlotList.slice(0, MAX_THREE_DAY_AUDIT_SLOTS_PER_STUDENT)) {
        const candidateDay = String(candidateSlotId).split('-')[0]
        if (temporaryDays.has(candidateDay)) continue
        if (hasThreeConsecutiveTrainingDays(new Set([...temporaryDays, candidateDay]))) continue
        for (const trainer of (data.trainers || []).slice(0, MAX_THREE_DAY_AUDIT_TRAINERS)) {
          if (candidateChecks >= MAX_THREE_DAY_AUDIT_MOVES) {
            truncated = true
            break auditStudents
          }
          candidateChecks += 1
          const candidate = candidateForSlot(data, {
            student,
            trainer,
            slotId: candidateSlotId,
            schedule: temporary,
            schedulingState: temporaryState,
            contractCache: new Map(),
          })
          if (candidate.eligible) {
            avoidable = true
            break
          }
        }
        if (avoidable) break
      }
      if (avoidable) break
    }
    rows.push({ studentId: student.id, runCount, avoidable })
  }
  return {
    studentsWithThreeConsecutiveDays: rows.length,
    threeConsecutiveDayRuns: rows.reduce((total, row) => total + row.runCount, 0),
    avoidableThreeConsecutiveDays: rows.filter((row) => row.avoidable).length,
    unavoidableThreeConsecutiveDays: rows.filter((row) => !row.avoidable).length,
    details: rows,
    inspectedStudents: inspectedStudents.length,
    candidateChecks,
    truncated,
  }
}

function compactPairedSlots(data, inputSchedule) {
  const schedule = Object.fromEntries(Object.entries(inputSchedule).map(([slotId, entries]) => [slotId, [...entries]]))
  const studentsById = new Map(data.students.map((student) => [student.id, student]))
  let changed = true
  let moves = 0
  let commonSearchNodes = 0
  while (changed && moves < MAX_DRAFT_ENTRIES) {
    changed = false
    const groups = teachingSlotGroups(data, schedule)
    const sources = groups.filter((group) => group.entries.length === 1
      && group.entries[0].source === 'auto_v4'
      && group.entries[0].isLocked !== true)
    const targets = groups.filter((group) => group.entries.length === 1 && group.capacity >= 2)
    for (const source of sources) {
      const sourceEntry = source.entries[0]
      const sourceAssignmentOrder = entryTrainerAssignmentOrder(data, sourceEntry)
      const student = studentsById.get(sourceEntry.studentId)
      if (!student) continue
      const beforeDays = buildSchedulingState(schedule, data).studentDays.get(student.id) || new Set()
      const beforeConsecutive = hasThreeConsecutiveTrainingDays(beforeDays)
      const temporary = Object.fromEntries(Object.entries(schedule).map(([slotId, entries]) => [
        slotId,
        entries.filter((entry) => !(slotId === source.slotId
          && entry.studentId === sourceEntry.studentId
          && entry.trainerId === sourceEntry.trainerId
          && entry.source === 'auto_v4')),
      ]).filter(([, entries]) => entries.length))
      const temporaryState = buildSchedulingState(temporary, data)
      const candidates = targets
        .filter((target) => target.slotId !== source.slotId || target.trainerId !== source.trainerId)
        .map((target) => candidateRecord(data, temporary, temporaryState, new Map(), student, target.trainer, target.slotId))
        .filter(Boolean)
        .filter((candidate) => sourceAssignmentOrder === null || candidate.assignmentOrder <= sourceAssignmentOrder)
        .filter((candidate) => {
          const nextDays = new Set(temporaryState.studentDays.get(student.id) || [])
          nextDays.add(candidate.slotId.split('-')[0])
          // Pairing is a strong preference, but compaction never creates an
          // avoidable third consecutive training day. The regular assignment
          // pass can still use one when it is the only way to fulfil demand.
          return beforeConsecutive || !hasThreeConsecutiveTrainingDays(nextDays)
        })
        .sort(compareCandidates)
      const selected = candidates[0]
      if (!selected) continue
      schedule[source.slotId] = temporary[source.slotId] || []
      if (!schedule[source.slotId].length) delete schedule[source.slotId]
      schedule[selected.slotId] = [...(temporary[selected.slotId] || []), autoEntryForCandidate(data, student, selected, sourceEntry)]
      moves += 1
      changed = true
      break
    }
    // Two singles may share a third, currently empty, slot even when neither
    // learner can attend the other's original slot. Explore that intersection.
    if (!changed) {
      commonSearch: for (let i = 0; i < sources.length; i += 1) for (let j = i + 1; j < sources.length; j += 1) {
        if (commonSearchNodes >= 3000) break commonSearch
        const left = sources[i], right = sources[j]
        const a = studentsById.get(left.entries[0].studentId), b = studentsById.get(right.entries[0].studentId)
        if (!a || !b || a.id === b.id) continue
        const temp = scheduleWithoutEntry(scheduleWithoutEntry(schedule, left.slotId, left.entries[0]), right.slotId, right.entries[0])
        const commonSlots = (a.availableSlots || []).filter((slot) => (b.availableSlots || []).includes(slot)).sort(compareSlots)
        for (const slotId of commonSlots) for (const trainer of data.trainers) {
          commonSearchNodes += 1
          if (commonSearchNodes > 3000) break commonSearch
          if (trainer.slotCapacity < 2 || (temp[slotId] || []).some((entry) => entry.trainerId === trainer.id)) continue
          const state = buildSchedulingState(temp, data)
          const ca = candidateRecord(data, temp, state, new Map(), a, trainer, slotId)
          if (!ca) continue
          const leftAssignmentOrder = entryTrainerAssignmentOrder(data, left.entries[0])
          if (leftAssignmentOrder !== null && ca.assignmentOrder > leftAssignmentOrder) continue
          const withA = scheduleWithEntry(temp, slotId, autoEntryForCandidate(data, a, ca))
          const cb = candidateRecord(data, withA, buildSchedulingState(withA, data), new Map(), b, trainer, slotId)
          if (!cb) continue
          const rightAssignmentOrder = entryTrainerAssignmentOrder(data, right.entries[0])
          if (rightAssignmentOrder !== null && cb.assignmentOrder > rightAssignmentOrder) continue
          const oldState = buildSchedulingState(schedule, data)
          if ([a, b].some((student) => !hasThreeConsecutiveTrainingDays(oldState.studentDays.get(student.id))
            && hasThreeConsecutiveTrainingDays(new Set([...(state.studentDays.get(student.id) || []), slotId.split('-')[0]])))) continue
          const merged = scheduleWithEntry(withA, slotId, autoEntryForCandidate(data, b, cb))
          Object.keys(schedule).forEach((key) => delete schedule[key])
          Object.assign(schedule, merged)
          moves += 2
          changed = true
          break commonSearch
        }
      }
    }
  }
  return { schedule, moves }
}

function improveAssignedTrainerPlacements(data, schedule) {
  const students = new Map(data.students.map((student) => [student.id, student]))
  let moves = 0
  // A single bounded pass also upgrades mutable rows retained by "continue".
  // No learner loses a session, and manual/locked/published rows stay intact.
  const entries = Object.entries(schedule).flatMap(([slotId, values]) => values.map((entry) => ({ slotId, entry })))
  for (const { slotId, entry } of entries) {
    if (protectedFromOptimizer(entry)) continue
    const order = entryTrainerAssignmentOrder(data, entry)
    if (order === null || order === 0) continue
    const student = students.get(entry.studentId)
    if (!student) continue
    const temporary = scheduleWithoutEntry(schedule, slotId, entry)
    const state = buildSchedulingState(temporary, data)
    const beforeDays = buildSchedulingState(schedule, data).studentDays.get(student.id)
    const candidate = feasibleCandidatesForStudent(data, temporary, state, new Map(), student)
      .find((candidate) => candidate.assignmentOrder < order
        && (hasThreeConsecutiveTrainingDays(beforeDays)
          || !hasThreeConsecutiveTrainingDays(new Set([...(state.studentDays.get(student.id) || []), candidate.slotId.split('-')[0]]))))
    if (!candidate) continue
    schedule[slotId] = temporary[slotId] || []
    if (!schedule[slotId].length) delete schedule[slotId]
    schedule[candidate.slotId] = [...(temporary[candidate.slotId] || []), autoEntryForCandidate(data, student, candidate, entry)]
    moves += 1
  }
  return moves
}

function blockersForStudent(data, student, schedule, schedulingState, contractCache, capacityReached, capacityReason = 'DRAFT_CAPACITY_REACHED') {
  const reasons = new Set()
  const suggestedSlots = new Set()
  const compatibleSlotIds = new Set()
  const pairedOpportunitySlotIds = new Set()
  const validLearnerAvailabilityDates = new Set()
  const indexes = scheduleIndexes(data)
  // Once the draft write guard is full, every unresolved learner has the same
  // actionable blocker. Do not re-run the complete learner×slot×PT validator
  // merely to rediscover that no new entry can be persisted.
  const trainers = capacityReached ? [] : indexes.sortedTrainers
  const rawSlots = Array.isArray(student.availableSlots) ? [...new Set(student.availableSlots)].sort(compareSlots) : []
  const scheduledDayCodes = new Set(schedulingState.studentDays.get(student.id) || [])
  const scheduledSessions = Number(schedulingState.studentSessionCounts.get(student.id) || 0)
  const requiredSessions = Math.max(0, Number(student.sessionsPerWeek || 0))
  const missingSessions = Math.max(0, requiredSessions - scheduledSessions)
  const diagnostics = {
    candidateSlotCount: rawSlots.length,
    learnerAvailabilityCount: 0,
    learnerAvailabilityDayCount: 0,
    validLearnerAvailabilityDayCount: 0,
    contractRemainingDayCount: 0,
    requiredSessions,
    scheduledSessions,
    missingSessions,
    availabilityDayShortfall: 0,
    contractValidDateCount: 0,
    trainerCompatibleSlotCount: 0,
    pairedSeatOpportunityCount: 0,
    blockedByTrainerOffCount: 0,
    blockedByTrainerAvailabilityCount: 0,
    blockedByTrainerLeaveCount: 0,
    blockedByTrainerCapacityCount: 0,
    blockedByBranchCapacityCount: 0,
    blockedByLearnerDayCount: 0,
  }
  const candidateSlots = []
  const weekDates = datesForWeek(data.weekId)
  const weekStart = weekDates[0]
  const weekEnd = weekDates[weekDates.length - 1]
  const contracts = indexes.contractsByStudent.get(student.id) || []
  const branchContracts = contracts.filter((contract) => !contract.branchId || contract.branchId === data.branch.id)
  const operationalContracts = branchContracts.filter((contract) => weekDates.some((date) => contractEffectiveOnDate(contract, date)))
  const validDates = new Set(Array.isArray(student.validScheduleDates) && student.validScheduleDates.length
    ? student.validScheduleDates
    : weekDates.filter((date) => operationalContracts.some((contract) => contractCanServeScheduledDate(contract, date) && !contractPaused(contract, date))))
  const dayCodeByDate = new Map([...DAY_ORDER.keys()].map((day) => [dateForSlot(data.weekId, day), day]))
  diagnostics.contractRemainingDayCount = [...validDates]
    .filter((date) => !scheduledDayCodes.has(dayCodeByDate.get(date))).length
  const nearestEndDate = branchContracts
    .map((contract) => storedDate(contract.endDate))
    .filter(Boolean)
    .sort()[0] || null
  const latestEndDate = branchContracts
    .map((contract) => storedDate(contract.endDate))
    .filter(Boolean)
    .sort()
    .pop() || null
  const contractQuotaRemaining = branchContracts.reduce((total, contract) => total + Math.max(0, Number(contract.remainingEntitlementSessions
    ?? (Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0)))), 0)
  const contractStatus = !branchContracts.length
    ? 'missing'
    : branchContracts.every((contract) => {
      const status = String(contract.status || '').toLowerCase()
      const end = storedDate(contract.endDate)
      return status === 'expired' || (end && end < weekStart)
    })
      ? 'expired'
      : !contractQuotaRemaining
        ? 'quota_exhausted'
        : !validDates.size
          ? (branchContracts.some((contract) => contractPaused(contract, weekStart)) ? 'paused' : 'not_started_or_ended')
          : latestEndDate && latestEndDate <= weekEnd ? 'expiring' : 'valid'

  if (student.availabilityStatus && ['submitted', 'locked', 'inherited', 'recurring'].includes(student.availabilityStatus)) {
    diagnostics.learnerAvailabilityCount = rawSlots.length
    diagnostics.learnerAvailabilityDayCount = new Set(rawSlots.map((slotId) => String(slotId).split('-')[0])).size
  } else if (!rawSlots.length) {
    reasons.add('AVAILABILITY_NOT_SUBMITTED')
  } else {
    reasons.add('AVAILABILITY_NOT_SUBMITTED')
  }

  for (const slotId of rawSlots) {
    const [day, rawHour] = String(slotId).split('-')
    const date = dateForSlot(data.weekId, day)
    if (validDates.has(date)) {
      diagnostics.contractValidDateCount += 1
      if (!scheduledDayCodes.has(day)) validLearnerAvailabilityDates.add(date)
    }
    if (capacityReached) continue
    const slotResult = {
      slotId,
      date,
      hour: Number(rawHour),
      learnerAvailable: true,
      availableTrainerIds: [],
      blockedTrainerIds: [],
      blockerCodes: [],
    }
    for (const trainer of trainers) {
      const result = candidateForSlot(data, { student, trainer, slotId, schedule, schedulingState, contractCache })
      if (result.eligible) {
        slotResult.availableTrainerIds.push(trainer.id)
        suggestedSlots.add(slotId)
        compatibleSlotIds.add(slotId)
        const currentCount = schedulingState.trainerSlotCounts.get(`${trainer.id}|${slotId}`) || 0
        if (currentCount === 1 && Number(trainer.slotCapacity || 1) >= 2) pairedOpportunitySlotIds.add(slotId)
      } else {
        slotResult.blockedTrainerIds.push(trainer.id)
        result.reasons.forEach((reason) => {
          reasons.add(reason)
          slotResult.blockerCodes.push(reason)
          if (reason === 'TRAINER_OFF_CONFLICT') diagnostics.blockedByTrainerOffCount += 1
          if (reason === 'TRAINER_AVAILABILITY_UNCONFIGURED' || reason === 'OUTSIDE_TRAINER_AVAILABILITY') diagnostics.blockedByTrainerAvailabilityCount += 1
          if (reason === 'TRAINER_ON_LEAVE') diagnostics.blockedByTrainerLeaveCount += 1
          if (reason === 'TRAINER_CAPACITY_EXCEEDED') diagnostics.blockedByTrainerCapacityCount += 1
          if (reason === 'BRANCH_CAPACITY_REACHED') diagnostics.blockedByBranchCapacityCount += 1
          if (reason === 'STUDENT_MULTIPLE_SESSIONS_PER_DAY') diagnostics.blockedByLearnerDayCount += 1
        })
      }
    }
    slotResult.availableTrainerIds = [...new Set(slotResult.availableTrainerIds)].slice(0, 5)
    slotResult.blockedTrainerIds = [...new Set(slotResult.blockedTrainerIds)].slice(0, 5)
    slotResult.blockerCodes = [...new Set(slotResult.blockerCodes)].sort()
    candidateSlots.push(slotResult)
  }
  diagnostics.trainerCompatibleSlotCount = compatibleSlotIds.size
  diagnostics.pairedSeatOpportunityCount = pairedOpportunitySlotIds.size
  diagnostics.validLearnerAvailabilityDayCount = validLearnerAvailabilityDates.size
  diagnostics.availabilityDayShortfall = Math.max(0, missingSessions - diagnostics.validLearnerAvailabilityDayCount)

  if (contractStatus === 'expiring') reasons.add('CONTRACT_EXPIRES_DURING_WEEK')
  if (diagnostics.learnerAvailabilityCount > 0 && diagnostics.availabilityDayShortfall > 0) {
    reasons.add('STUDENT_AVAILABILITY_DAYS_INSUFFICIENT')
  }

  if (rawSlots.length && !diagnostics.contractValidDateCount) {
    reasons.add('NO_LEARNER_SLOT_ON_VALID_CONTRACT_DATE')
    if (contractStatus === 'expired') reasons.add(latestEndDate && latestEndDate >= weekStart ? 'CONTRACT_EXPIRES_DURING_WEEK' : 'CONTRACT_EXPIRED_BEFORE_WEEK')
    if (contractStatus === 'quota_exhausted') reasons.add('CONTRACT_SESSION_QUOTA_EXCEEDED')
  }
  if (diagnostics.learnerAvailabilityCount > 0 && diagnostics.trainerCompatibleSlotCount === 0 && diagnostics.contractValidDateCount > 0) {
    if (diagnostics.blockedByBranchCapacityCount > 0 && diagnostics.blockedByBranchCapacityCount >= diagnostics.blockedByTrainerCapacityCount) reasons.add('BRANCH_CAPACITY_REACHED')
    else if (diagnostics.blockedByTrainerOffCount > 0 && diagnostics.blockedByTrainerOffCount >= diagnostics.blockedByTrainerCapacityCount) reasons.add('ALL_TRAINERS_OFF')
    else if (diagnostics.blockedByTrainerCapacityCount > 0) reasons.add('ALL_MATCHING_TRAINERS_FULL')
    else if (diagnostics.blockedByTrainerLeaveCount > 0 && diagnostics.blockedByTrainerLeaveCount >= diagnostics.blockedByTrainerAvailabilityCount) reasons.add('TRAINER_ON_LEAVE')
    else if (diagnostics.blockedByTrainerAvailabilityCount > 0) reasons.add('NO_AVAILABLE_TRAINER_IN_LEARNER_SLOTS')
  }
  if (capacityReached) reasons.add(capacityReason)

  let primaryReasonCode = 'STUDENT_UNSCHEDULED'
  let blockerCategory = 'optimizer'
  let actionCode = 'RERUN_OPTIMIZER'
  const contractDaysInsufficient = contractStatus === 'expiring'
    && diagnostics.contractRemainingDayCount < missingSessions
  if (capacityReached) {
    primaryReasonCode = capacityReason
    blockerCategory = 'capacity'
    actionCode = 'RERUN_OPTIMIZER'
  } else if (!diagnostics.learnerAvailabilityCount) {
    primaryReasonCode = 'AVAILABILITY_NOT_SUBMITTED'
    blockerCategory = 'learner_availability'
    actionCode = 'EDIT_STUDENT_AVAILABILITY'
  } else if (contractStatus === 'quota_exhausted' || !diagnostics.contractValidDateCount || contractDaysInsufficient) {
    primaryReasonCode = reasons.has('CONTRACT_SESSION_QUOTA_EXCEEDED') ? 'CONTRACT_SESSION_QUOTA_EXCEEDED'
      : reasons.has('CONTRACT_EXPIRES_DURING_WEEK') ? 'CONTRACT_EXPIRES_DURING_WEEK'
        : reasons.has('CONTRACT_EXPIRED_BEFORE_WEEK') ? 'CONTRACT_EXPIRED_BEFORE_WEEK'
          : reasons.has('CONTRACT_PAUSED') ? 'CONTRACT_PAUSED' : 'ACTIVE_CONTRACT_NOT_FOUND'
    blockerCategory = 'contract'
    actionCode = primaryReasonCode === 'CONTRACT_SESSION_QUOTA_EXCEEDED' ? 'REVIEW_CONTRACT_QUOTA' : 'REVIEW_CONTRACT_DATES'
  } else if (diagnostics.availabilityDayShortfall > 0) {
    primaryReasonCode = 'STUDENT_AVAILABILITY_DAYS_INSUFFICIENT'
    blockerCategory = 'learner_availability'
    actionCode = 'EDIT_STUDENT_AVAILABILITY'
  } else if (diagnostics.trainerCompatibleSlotCount === 0) {
    primaryReasonCode = reasons.has('BRANCH_CAPACITY_REACHED') ? 'BRANCH_CAPACITY_REACHED'
      : reasons.has('ALL_TRAINERS_OFF') ? 'ALL_TRAINERS_OFF'
        : reasons.has('ALL_MATCHING_TRAINERS_FULL') ? 'ALL_MATCHING_TRAINERS_FULL'
          : reasons.has('TRAINER_ON_LEAVE') ? 'TRAINER_ON_LEAVE'
            : reasons.has('TRAINER_AVAILABILITY_UNCONFIGURED') ? 'TRAINER_AVAILABILITY_UNCONFIGURED'
              : 'NO_AVAILABLE_TRAINER_IN_LEARNER_SLOTS'
    blockerCategory = primaryReasonCode === 'BRANCH_CAPACITY_REACHED' ? 'branch_capacity' : 'trainer_capacity'
    actionCode = primaryReasonCode === 'BRANCH_CAPACITY_REACHED' ? 'OPEN_OTHER_SLOT' : 'ADD_TRAINER_AVAILABILITY'
  } else if (suggestedSlots.size > 0) {
    primaryReasonCode = 'OPTIMIZER_GAP'
    blockerCategory = 'optimizer'
    actionCode = 'RERUN_OPTIMIZER'
  }

  const candidateRank = (slot) => (slot.availableTrainerIds.length ? 0 : slot.blockerCodes.length ? 1 : 2)
  candidateSlots.sort((left, right) => candidateRank(left) - candidateRank(right) || compareSlots(left.slotId, right.slotId))
  return {
    reasonCodes: [...reasons].sort(),
    suggestedSlots: [...suggestedSlots].sort(compareSlots).slice(0, 5),
    primaryReasonCode,
    blockerCategory,
    actionCode,
    diagnostics: {
      ...diagnostics,
      contractStatus,
      nearestContractEndDate: nearestEndDate,
      latestContractEndDate: latestEndDate,
      contractQuotaRemaining,
      validDates: [...validDates].sort(),
      weekStart,
      weekEnd,
    },
    candidateSlots: candidateSlots.slice(0, 8),
  }
}

function publishedSessionSlotId(week, session) {
  const date = storedDate(session?.date)
  const storedSessionHour = Number(session?.hour)
  const legacyIdHour = Number(String(session?.id || '').split('-')[1])
  const hour = Number.isInteger(storedSessionHour) && storedSessionHour >= 0 && storedSessionHour <= 23
    ? storedSessionHour
    : legacyIdHour
  if (!date || !Number.isInteger(hour) || hour < 0 || hour > 23) return null
  const start = Date.parse(`${week}T00:00:00.000Z`)
  const target = Date.parse(`${date}T00:00:00.000Z`)
  const dayIndex = Math.floor((target - start) / 86400000)
  const day = [...DAY_ORDER.keys()][dayIndex]
  return day && dateForSlot(week, day) === date ? `${day}-${hour}` : null
}

function slotIsPast(week, slotId, now = Date.now()) {
  const [day, hour] = String(slotId).split('-')
  return Date.parse(`${dateForSlot(week, day)}T${String(hour).padStart(2, '0')}:00:00+07:00`) < now
}

// The matrix intentionally keeps the current calendar day editable until the
// day closes. Use this boundary for draft mutations so a 08:00 cell opened at
// 10:00 does not look editable in the UI and then fail with the historical
// guard. The historical-session callable still uses the exact elapsed-time
// check above when a caller explicitly records a past session with audit.
function slotCalendarDateIsPast(week, slotId, today = todayInHoChiMinh()) {
  const [day] = String(slotId).split('-')
  return dateForSlot(week, day) < today
}

const HISTORICAL_OCCUPANCY_STATUSES = new Set(['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'])
const HISTORICAL_INVALID_CONTRACT_STATUSES = new Set(['cancelled', 'canceled', 'void', 'refunded', 'deleted'])

function historicalSessionOccupies(session) {
  return HISTORICAL_OCCUPANCY_STATUSES.has(String(session?.status || '').toLowerCase())
    || session?.billingStatus === 'charged'
}

function historicalContractCandidates(data, studentId, date) {
  const allowCrossBranch = data.allowCrossBranchStudentIds instanceof Set
    && data.allowCrossBranchStudentIds.has(studentId)
  const contractBranchId = allowCrossBranch ? data.students.find((student) => student.id === studentId)?.branchId : data.branch.id
  return data.contracts.filter((contract) => contract.studentId === studentId
    && Boolean(contractBranchId) && contract.branchId === contractBranchId
    && !HISTORICAL_INVALID_CONTRACT_STATUSES.has(String(contract.status || '').toLowerCase())
    && storedDate(contract.startDate) <= date
    && storedDate(contract.endDate) >= date
    && !contractPaused(contract, date))
    .sort((left, right) => storedDate(left.endDate).localeCompare(storedDate(right.endDate))
      || storedDate(left.startDate).localeCompare(storedDate(right.startDate))
      || left.id.localeCompare(right.id))
}

// A session that already happened is accounting evidence, not a mutable draft
// entry. Keep contract/date/capacity conflicts hard, while old availability,
// leave and assignment mismatches become explicit audited warnings: the actual
// class may legitimately have happened outside the plan registered beforehand.
function historicalSlotCandidate(data, { student, trainer, slotId }) {
  const [day, rawHour] = String(slotId).split('-')
  const hour = Number(rawHour)
  const date = dateForSlot(data.weekId, day)
  const hardReasons = []
  const warningReasons = []
  const sessions = (data.sessions || []).filter(historicalSessionOccupies)
  const calendar = data.config || {}
  const workingDays = Array.isArray(calendar.workingDays) ? calendar.workingDays : []
  const workingHours = Array.isArray(calendar.workingHours) ? calendar.workingHours.map(Number) : []
  const holidays = Array.isArray(calendar.holidays) ? calendar.holidays : []

  if ((workingDays.length && !workingDays.includes(day))
    || (workingHours.length && !workingHours.includes(hour))
    || holidays.includes(date)) warningReasons.push('OUTSIDE_WORKING_CALENDAR')
  if (['archived', 'deleted'].includes(String(student?.status || '').toLowerCase())) hardReasons.push('STUDENT_NOT_ACTIVE')
  else if (String(student?.status || '').toLowerCase() === 'inactive') warningReasons.push('STUDENT_NOT_ACTIVE')
  const studentBranchWarning = student?.branchId !== data.branch.id
  if (studentBranchWarning) {
    const allowCrossBranch = data.allowCrossBranchStudentIds instanceof Set
      && data.allowCrossBranchStudentIds.has(student.id)
    if (allowCrossBranch) warningReasons.push('STUDENT_BRANCH_MISMATCH')
    else hardReasons.push('STUDENT_BRANCH_MISMATCH')
  }
  if (!trainer || trainerIsLocked(trainer)) hardReasons.push('TRAINER_NOT_ACTIVE')
  else if (trainer.branchId !== data.branch.id) hardReasons.push('TRAINER_BRANCH_MISMATCH')

  const dateContracts = historicalContractCandidates(data, student.id, date)
  const quotaContracts = dateContracts.filter((contract) => Number(contract.remainingSchedulableSessions
    ?? contract.remainingEntitlementSessions
    ?? (Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0))) > 0)
  const contract = quotaContracts[0] || null
  if (!dateContracts.length) {
    const allowCrossBranch = data.allowCrossBranchStudentIds instanceof Set
      && data.allowCrossBranchStudentIds.has(student.id)
    const paused = data.contracts.some((candidate) => candidate.studentId === student.id
      && candidate.branchId === (allowCrossBranch ? student.branchId : data.branch.id)
      && storedDate(candidate.startDate) <= date
      && storedDate(candidate.endDate) >= date
      && contractPaused(candidate, date))
    hardReasons.push(paused ? 'CONTRACT_PAUSED' : 'ACTIVE_CONTRACT_NOT_FOUND')
  } else if (!contract) hardReasons.push('CONTRACT_SESSION_QUOTA_EXCEEDED')

  const sameStudentDate = sessions.some((session) => session.studentId === student.id && storedDate(session.date) === date)
  if (sameStudentDate) hardReasons.push('STUDENT_MULTIPLE_SESSIONS_PER_DAY')
  const trainerSlotSessions = sessions.filter((session) => session.trainerId === trainer.id
    && storedDate(session.date) === date
    && Number(session.hour) === hour)
  if (new Set(trainerSlotSessions.map((session) => session.studentId)).size >= normalizedCapacity(trainer.slotCapacity)) {
    hardReasons.push('TRAINER_CAPACITY_EXCEEDED')
  }

  const configuredBranchCapacity = branchSlotCapacity(calendar, data.branch.id, slotId)
  const branchSlotCount = sessions.filter((session) => session.branchId === data.branch.id
    && storedDate(session.date) === date
    && Number(session.hour) === hour).length
  if (configuredBranchCapacity !== null && branchSlotCount >= configuredBranchCapacity) hardReasons.push('BRANCH_CAPACITY_REACHED')

  const matchesStudentAvailability = ['submitted', 'locked', 'inherited', 'recurring'].includes(student.availabilityStatus)
    && Array.isArray(student.availableSlots)
    && student.availableSlots.includes(slotId)
  if (!['submitted', 'locked', 'inherited', 'recurring'].includes(student.availabilityStatus)) warningReasons.push('AVAILABILITY_NOT_SUBMITTED')
  else if (!matchesStudentAvailability) warningReasons.push('OUTSIDE_STUDENT_AVAILABILITY')
  if (trainer?.availabilityMode === 'unconfigured') warningReasons.push('TRAINER_AVAILABILITY_UNCONFIGURED')
  else if (trainer && !trainerIsAvailable(trainer, slotId)) warningReasons.push('OUTSIDE_TRAINER_AVAILABILITY')
  if (trainer && data.leaves.some((leave) => leaveCovers(leave, trainer.id, date))) warningReasons.push('TRAINER_ON_LEAVE')

  const assigned = assignedTrainerIds(contract)
  const trainerAssignmentWarning = assigned.length > 0 && !assigned.includes(trainer.id)
  const reasons = [...new Set([...hardReasons, ...warningReasons])]
  const availabilityReason = reasons.find((reason) => STUDENT_AVAILABILITY_REASON_CODES.has(reason)) || null
  return {
    eligible: reasons.length === 0,
    reasons,
    hardReasons: [...new Set(hardReasons)],
    warningReasons: [...new Set(warningReasons)],
    contractId: contract?.id || null,
    date,
    matchesStudentAvailability,
    manualSelectable: hardReasons.length === 0,
    availabilityReason,
    trainerAssignmentWarning,
    studentBranchWarning,
    assignedTrainerIds: assigned,
    historical: true,
  }
}

function protectedFromOptimizer(entry) {
  return entry.type === 'off' || entry.isLocked === true || entry.source === 'manual_v2'
    || entry.source === 'published_existing' || entry.availabilityOverride === true
}

function mergePublishedSessions(data, schedule, warnings) {
  const retainedStatuses = new Set(['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'])
  const studentsById = new Map([...data.students, ...(data.crossBranchStudents || [])].map((student) => [student.id, student]))
  const trainersById = new Map((data.trainers || []).map((trainer) => [trainer.id, trainer]))
  const sessionPriority = (session) => {
    const createdAt = session.createdAt?.toMillis?.() || (typeof session.createdAt === 'string' ? Date.parse(session.createdAt) : NaN)
    return [session.branchId === 'all' ? 0 : 1, Number.isFinite(createdAt) ? createdAt : Number.MAX_SAFE_INTEGER, String(session.id || '')]
  }
  const precedes = (left, right) => {
    const a = sessionPriority(left)
    const b = sessionPriority(right)
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] < b[index]) return true
      if (a[index] > b[index]) return false
    }
    return false
  }
  const canonicalByCell = new Map()
  for (const session of data.sessions || []) {
    // Other-branch sessions are loaded for entitlement/double-booking checks,
    // never as teaching workload for this branch.
    const belongsToBranch = session.branchId === data.branch.id
      || (session.branchId === 'all' && (trainersById.has(session.trainerId) || studentsById.has(session.studentId)))
    if (!belongsToBranch) continue
    if (!retainedStatuses.has(String(session.status || '').toLowerCase()) && session.billingStatus !== 'charged') continue
    const slotId = publishedSessionSlotId(data.weekId, session)
    if (!slotId || !session.studentId || !session.trainerId) continue
    const cellKey = `${session.studentId}|${slotId}`
    const current = canonicalByCell.get(cellKey)
    if (!current) canonicalByCell.set(cellKey, session)
    else if (precedes(session, current)) canonicalByCell.set(cellKey, session)
  }
  for (const session of [...canonicalByCell.values()].sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')))) {
    const slotId = publishedSessionSlotId(data.weekId, session)
    const values = schedule[slotId] || []
    if (values.some((entry) => entry.type !== 'off' && entry.studentId === session.studentId)) continue
    let contractId = session.contractId || ''
    if (!contractId) {
      const date = storedDate(session.date)
      const matches = data.contracts.filter((contract) => contract.studentId === session.studentId
        && contract.branchId === (studentsById.get(session.studentId)?.branchId || data.branch.id)
        && contractCanServeScheduledDate(contract, date)
        && !contractPaused(contract, date))
      if (matches.length === 1) contractId = matches[0].id
    }
    if (!contractId) {
      warnings.push({ code: 'PUBLISHED_SESSION_CONTRACT_REQUIRED', sessionId: session.id, studentId: session.studentId })
      continue
    }
    if (scheduleEntryCount(schedule) >= MAX_DRAFT_ENTRIES || scheduleDocumentEntryCount(schedule) >= MAX_DRAFT_DOCUMENT_ENTRIES) {
      warnings.push({ code: 'DRAFT_CAPACITY_REACHED', entryCount: scheduleEntryCount(schedule), maxEntries: MAX_DRAFT_ENTRIES })
      break
    }
    const resolvedContract = data.contracts.find((contract) => contract.id === contractId)
    const assigned = assignedTrainerIds(resolvedContract)
    const trainerAssignmentWarning = session.trainerAssignmentWarning === true
      || (assigned.length > 0 && !assigned.includes(session.trainerId))
    schedule[slotId] = [...values, {
      studentId: session.studentId,
      trainerId: session.trainerId,
      contractId,
      branchId: data.branch.id,
      type: 'training',
      source: 'published_existing',
      ...(adminOverrideMetadata({ ...session, source: 'published_existing' }) || {}),
      ...(session.sessionKind === 'makeup' || session.makeupSession === true ? {
        sessionKind: 'makeup',
        makeupSourceSessionId: typeof session.makeupSourceSessionId === 'string' ? session.makeupSourceSessionId : '',
        ...(session.makeupMode === 'paired_existing_shift' || session.makeupMode === 'standalone_shift' ? { makeupMode: session.makeupMode } : {}),
        commissionEligible: session.commissionEligible === false ? false : true,
      } : {}),
      ...(trainerAssignmentWarning ? { trainerAssignmentWarning: true } : {}),
      ...(session.studentBranchWarning === true ? {
        studentBranchWarning: true,
        studentHomeBranchId: typeof session.studentHomeBranchId === 'string' ? session.studentHomeBranchId : '',
      } : {}),
      ...((session.billingStatus === 'charged' || ['completed', 'attended', 'no_show'].includes(session.status)) ? { isLocked: true } : {}),
    }]
  }
}

function generateScheduleAttempt(data) {
  const mode = data.generationMode || 'optimize'
  const schedule = {}
  const crossBranchStudentIds = new Set((data.crossBranchStudents || []).map((student) => student.id))
  for (const [slotId, entries] of Object.entries(data.schedule || {})) {
    const retained = mode === 'supplement' || mode === 'continue' ? entries : entries.filter((entry) => protectedFromOptimizer(entry) || crossBranchStudentIds.has(entry.studentId))
    if (retained.length) schedule[slotId] = retained
  }
  const warnings = data.trainers
    .filter((trainer) => trainer.availabilityMode === 'unconfigured')
    .map((trainer) => ({ code: 'TRAINER_AVAILABILITY_UNCONFIGURED', trainerId: trainer.id }))
  // A previously published learner session is real workload. Keep it in the
  // next draft so it contributes once to coverage and to the PT's unique
  // trainer/date/hour load instead of being silently replaced or double-counted.
  mergePublishedSessions(data, schedule, warnings)
  // This protected snapshot is used only for diagnostics. It lets the UI
  // explain whether a missing session is caused by input capacity or by the
  // optimizer, without counting newly generated entries as "available" slots.
  const feasibilityBaseSchedule = Object.fromEntries(Object.entries(schedule).map(([slotId, entries]) => [slotId, [...entries]]))
  let entryCount = scheduleEntryCount(schedule)
  let capacityReached = entryCount >= MAX_DRAFT_ENTRIES || scheduleDocumentEntryCount(schedule) >= MAX_DRAFT_DOCUMENT_ENTRIES
  let capacityExhausted = false
  const scheduledCounts = scheduleStudentCounts(schedule, data)
  const students = [...data.students]
    .filter((student) => student.status !== 'inactive' && student.eligibleForWeek !== false && student.sessionsPerWeek > 0)
    .sort((left, right) => left.name.localeCompare(right.name, 'vi') || left.id.localeCompare(right.id))
  const remainingByStudent = new Map(students.map((student) => [student.id, Math.max(0, student.sessionsPerWeek - (scheduledCounts.get(student.id) || 0))]))

  const refreshCapacityState = () => {
    if (capacityReached) return
    capacityExhausted = availableTrainingSeatCapacity(data, schedule) < 1
  }

  const commitRound = (roundStudents, precomputedAssignments = null) => {
    const assignments = precomputedAssignments || matchSchedulingRound(data, schedule, roundStudents)
    let committed = 0
    for (const { student, candidate } of assignments) {
      if (entryCount >= MAX_DRAFT_ENTRIES || scheduleDocumentEntryCount(schedule) >= MAX_DRAFT_DOCUMENT_ENTRIES) {
        capacityReached = true
        break
      }
      schedule[candidate.slotId] = [...(schedule[candidate.slotId] || []), autoEntryForCandidate(data, student, candidate)]
      scheduledCounts.set(student.id, (scheduledCounts.get(student.id) || 0) + 1)
      remainingByStudent.set(student.id, Math.max(0, (remainingByStudent.get(student.id) || 0) - 1))
      entryCount += 1
      committed += 1
    }
    refreshCapacityState()
    return committed
  }

  const fillRemainingSessions = (roundPool = students, precomputedFirstRound = null) => {
    let committedTotal = 0
    // Maximum-cardinality first-session round. Augmenting paths can move a
    // flexible learner away from the only slot of a constrained learner.
    const firstRoundStudents = roundPool.filter((student) => (scheduledCounts.get(student.id) || 0) === 0
      && (remainingByStudent.get(student.id) || 0) > 0)
    committedTotal += commitRound(firstRoundStudents, precomputedFirstRound)

    // Later rounds remain fair (one seat per learner per round) while maximizing
    // the number of fulfilled weekly targets in each round.
    let progress = true
    while (!capacityReached && !capacityExhausted && progress) {
      const roundStudents = roundPool.filter((student) => (remainingByStudent.get(student.id) || 0) > 0)
      if (!roundStudents.length) break
      const committed = commitRound(roundStudents)
      committedTotal += committed
      progress = committed > 0
    }
    return committedTotal
  }

  // When one-session matching or the atomic draft budget cannot cover every
  // incomplete learner, reserve seats for a cohort that can actually reach
  // its weekly target. On healthy branches we keep the established
  // coverage-first rounds unchanged.
  const incompleteStudents = students.filter((student) => (remainingByStudent.get(student.id) || 0) > 0)
  const draftSessionBudget = Math.max(0, Math.min(
    MAX_DRAFT_ENTRIES - entryCount,
    MAX_DRAFT_DOCUMENT_ENTRIES - scheduleDocumentEntryCount(schedule),
  ))
  const availableSeatBudget = Math.max(0, Math.min(draftSessionBudget, availableTrainingSeatCapacity(data, schedule)))
  const totalRemainingTargetSessions = incompleteStudents.reduce((total, student) => total
    + Math.max(0, Number(remainingByStudent.get(student.id) || 0)), 0)
  let firstRoundAssignments = null
  let firstRoundCapacity = incompleteStudents.length
  if (incompleteStudents.length && draftSessionBudget >= incompleteStudents.length && !capacityReached) {
    firstRoundAssignments = matchSchedulingRound(data, schedule, incompleteStudents)
    firstRoundCapacity = firstRoundAssignments.length
  }
  const capacityPressure = incompleteStudents.length > 0
    && (draftSessionBudget < incompleteStudents.length
      || firstRoundCapacity < incompleteStudents.length
      // A branch may have enough seats to give everybody one class while
      // still lacking enough seats to fulfil every weekly target. In that
      // case reserve seats for a completable cohort before spreading demand.
      || availableSeatBudget < totalRemainingTargetSessions)
  let completionFirst = false
  let completionFirstCohortSize = 0
  let completionFirstReservedSessions = 0
  let completionFirstSeatBudget = availableSeatBudget
  if (capacityPressure && mode !== 'supplement') {
    const cohort = completionFirstCohort(data, schedule, incompleteStudents, remainingByStudent, completionFirstSeatBudget)
    if (cohort.students.length) {
      completionFirst = true
      completionFirstCohortSize = cohort.students.length
      completionFirstReservedSessions = cohort.reservedSessions
      fillRemainingSessions(cohort.students)
      // If a hard edge conflict prevented the reserved cohort from consuming
      // all seats, recover the leftover capacity for ordinary coverage.
      if (!capacityReached && !capacityExhausted) fillRemainingSessions(students)
    } else {
      // No learner has an optimistic path to a complete target. Keep the
      // existing coverage-first behavior instead of manufacturing a cohort
      // that cannot finish.
      fillRemainingSessions(incompleteStudents, firstRoundAssignments)
    }
  } else {
    fillRemainingSessions(incompleteStudents, firstRoundAssignments)
  }
  refreshCapacityState()

  // Deep improvement runs compaction, regular coverage and bounded relocation.
  // Compaction can move a
  // flexible learner from a capacity-1 class into an existing 1/2 class. That
  // newly empty class is then retried for learners still missing a weekly
  // session. Relocation then opens a seat held by a flexible learner from an
  // earlier round, which closes global coverage gaps without moving protected
  // workload. Repeating the cycle catches pairing opportunities created by the
  // repair itself.
  let pairingMoves = 0
  let refillAssignments = 0
  let rescueAssignments = 0
  let rescueRelocations = 0
  let rescueSearchNodes = 0
  let rescueEvaluatedPlans = 0
  let rescueSearchLimitReached = false
  const swapTrace = []
  let optimizationPasses = 1
  // Once the atomic draft guard is full there is no room for another learner
  // session. Pair compaction/relocation would only reshuffle the same entries
  // while scanning a potentially very large branch, so stop the deep pass and
  // return the already maximum-cardinality draft immediately.
  for (let pass = 0; mode !== 'supplement' && !capacityReached && !capacityExhausted && pass < MAX_DEEP_OPTIMIZATION_PASSES; pass += 1) {
    const compacted = compactPairedSlots(data, schedule)
    if (compacted.moves > 0) {
      Object.keys(schedule).forEach((slotId) => delete schedule[slotId])
      Object.assign(schedule, compacted.schedule)
      pairingMoves += compacted.moves
    }
    // Reaching the draft-entry guard only disables adding more sessions. A
    // compaction pass still has value because it can turn two 1/2 classes into
    // one 2/2 class without increasing the number of entries.
    const refilled = capacityReached || capacityExhausted ? 0 : fillRemainingSessions()
    refillAssignments += refilled
    const repairCapacity = Math.max(0, Math.min(
      MAX_DRAFT_ENTRIES - entryCount,
      MAX_DRAFT_DOCUMENT_ENTRIES - scheduleDocumentEntryCount(schedule),
    ))
    const repaired = capacityReached || capacityExhausted || repairCapacity < 1
      ? { assignments: 0, relocations: 0, searchNodes: 0, evaluatedPlans: 0, searchLimitReached: false, assignedStudentIds: [], swapTrace: [], schedule }
      : repairCoverageWithRelocations(data, schedule, students, remainingByStudent, {
        maxAssignments: repairCapacity,
        maxSearchNodes: mode === 'continue' ? MAX_CONTINUATION_SEARCH_NODES : MAX_REPAIR_SEARCH_NODES,
        searchOffset: Number(data.searchOffset || 0) + pass,
      })
    if (repaired.assignments > 0) {
      Object.keys(schedule).forEach((slotId) => delete schedule[slotId])
      Object.assign(schedule, repaired.schedule)
      for (const studentId of repaired.assignedStudentIds) {
        scheduledCounts.set(studentId, (scheduledCounts.get(studentId) || 0) + 1)
        remainingByStudent.set(studentId, Math.max(0, (remainingByStudent.get(studentId) || 0) - 1))
      }
      entryCount += repaired.assignments
      rescueAssignments += repaired.assignments
      rescueRelocations += repaired.relocations
      swapTrace.push(...repaired.swapTrace)
      capacityReached = entryCount >= MAX_DRAFT_ENTRIES || scheduleDocumentEntryCount(schedule) >= MAX_DRAFT_DOCUMENT_ENTRIES
    }
    refreshCapacityState()
    rescueSearchNodes += repaired.searchNodes
    rescueEvaluatedPlans += repaired.evaluatedPlans
    rescueSearchLimitReached ||= repaired.searchLimitReached
    optimizationPasses += 1
    if (compacted.moves === 0 && refilled === 0 && repaired.assignments === 0) break
  }
  const trainerAssignmentMoves = mode === 'supplement' ? 0 : improveAssignedTrainerPlacements(data, schedule)
  const schedulingState = buildSchedulingState(schedule, data)
  const contractCache = new Map()

  // Assignment warnings are derived from the final schedule. Earlier rounds
  // may have moved an entry back to an assigned PT (or to a support PT), so
  // retaining incremental warnings would leave stale audit information.
  for (const [slotId, entries] of Object.entries(schedule)) {
    for (const entry of entries) {
      if (entryOnApprovedOff(data, slotId, entry)) warnings.push({ code: 'CONTRACT_PAUSED', studentId: entry.studentId, trainerId: entry.trainerId, slotId })
      if (entry.type === 'off' || entry.trainerAssignmentWarning !== true) continue
      warnings.push({
        code: 'TRAINER_ASSIGNMENT_MISMATCH',
        studentId: entry.studentId,
        trainerId: entry.trainerId,
        slotId,
      })
    }
  }

  const finalFeasibility = studentFeasibilityForSchedule(data, schedule, feasibilityBaseSchedule)
  const feasibilityByStudent = new Map(finalFeasibility.map((item) => [item.studentId, item]))
  const unassignedEntries = []
  for (const student of students) {
    const missingSessions = remainingByStudent.get(student.id) || 0
    if (missingSessions < 1) continue
    // A globally exhausted live seat pool is not the same as the draft write
    // guard: keep the detailed trainer/leave/availability diagnostics alive
    // so an unconfigured or full matching PT is reported accurately. The hard
    // draft cap is the only case where scanning every learner×PT edge is both
    // unnecessary and guaranteed to produce the same blocker.
    const capacityBlocked = capacityReached
    const blockers = blockersForStudent(
      data,
      student,
      schedule,
      schedulingState,
      contractCache,
      capacityBlocked,
      capacityReached ? 'DRAFT_CAPACITY_REACHED' : 'SCHEDULE_CAPACITY_EXHAUSTED',
    )
    const feasibility = feasibilityByStudent.get(student.id)
    const optimizerCouldStillImprove = !(capacityReached || capacityExhausted) && (blockers.suggestedSlots.length > 0
      || Number(feasibility?.maximumFeasibleSessions || 0) > Number(feasibility?.scheduledSessions || 0))
    const blockerType = rescueSearchLimitReached && optimizerCouldStillImprove
      ? 'search_limit_reached'
      : optimizerCouldStillImprove
        ? 'optimizer_gap'
        : 'input_or_capacity'
    const reasonCodes = blockerType === 'search_limit_reached'
      ? [...new Set(['SEARCH_LIMIT_REACHED', ...blockers.reasonCodes])]
      : blockers.reasonCodes
    const unassigned = {
      studentId: student.id,
      studentName: student.name,
      missingSessions,
      blockerType,
      ...blockers,
      primaryReasonCode: blockerType === 'search_limit_reached' ? 'SEARCH_LIMIT_REACHED' : blockers.primaryReasonCode,
      actionCode: blockerType === 'search_limit_reached' ? 'RERUN_OPTIMIZER' : blockers.actionCode,
      reasonCodes,
    }
    unassignedEntries.push(unassigned)
    warnings.push({ code: 'STUDENT_UNSCHEDULED', ...unassigned })
  }
  if (capacityReached) warnings.unshift({ code: 'DRAFT_CAPACITY_REACHED', entryCount, maxEntries: MAX_DRAFT_ENTRIES })
  else if (capacityExhausted && unassignedEntries.length) warnings.unshift({ code: 'SCHEDULE_CAPACITY_EXHAUSTED', entryCount })
  const unassignedReasonCounts = unassignedEntries.reduce((counts, item) => {
    const key = item.primaryReasonCode || item.blockerType || 'STUDENT_UNSCHEDULED'
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
  const feasibilityGapSessions = finalFeasibility.reduce((total, item) => total + Math.max(
    0,
    Number(item.maximumFeasibleSessions || 0) - Number(item.scheduledSessions || 0),
  ), 0)
  const consecutiveDayAudit = threeConsecutiveDayAudit(data, schedule, students)
  const objectiveOrder = completionFirst
    ? ['fully_scheduled_learners', 'weekly_target_fulfilment', 'learner_coverage', 'trainer_assignment', 'pairing', 'trainer_consecutive_blocks', 'soft_load_balance', 'learner_spacing']
    : ['learner_coverage', 'fully_scheduled_learners', 'weekly_target_fulfilment', 'trainer_assignment', 'pairing', 'trainer_consecutive_blocks', 'soft_load_balance', 'learner_spacing']
  const optimizationSummary = {
    objectiveOrder,
    loadPolicyVersion: 'soft-consecutive-blocks-v2',
    studentCoverage: studentCoverageForSchedule(data, schedule),
    studentFeasibility: finalFeasibility,
    consecutiveDayAudit,
    trainerLoads: trainerLoadsForSchedule(data, schedule, schedulingState),
    slotUtilization: slotUtilizationForSchedule(data, schedule),
    pairingMoves,
    trainerAssignmentMoves,
    refillAssignments,
    rescueAssignments,
    rescueRelocations,
    rescueSearchNodes,
    searchBudgetUsed: rescueSearchNodes,
    rescueEvaluatedPlans,
    rescueSearchLimitReached,
    capacityReached,
    capacityExhausted,
    completionFirst,
    completionFirstCohortSize,
    completionFirstReservedSessions,
    completionFirstSeatBudget,
    optimalityGap: rescueSearchLimitReached ? feasibilityGapSessions : 0,
    unassignedReasonCounts,
    qualityVersion: 'schedule-quality-v2',
    // Backward-compatible aliases for clients deployed before optimizer v10.
    repairAssignments: rescueAssignments,
    repairRelocations: rescueRelocations,
    repairSearchNodes: rescueSearchNodes,
    repairSearchLimitReached: rescueSearchLimitReached,
    swapTrace: swapTrace.slice(0, 500),
    optimizationPasses,
    generatorVersion: OPTIMIZER_VERSION,
    generationMode: mode,
  }
  return { schedule, warnings, optimizationSummary, unassignedEntries }
}

function scheduleOutcome(data, schedule, prioritizeCompletion = false) {
  const counts = scheduleStudentCounts(schedule, data)
  const students = data.students.filter((student) => student.eligibleForWeek !== false && student.sessionsPerWeek > 0)
  const utilization = slotUtilizationForSchedule(data, schedule)
  const covered = students.filter((s) => (counts.get(s.id) || 0) > 0).length
  const complete = students.filter((s) => (counts.get(s.id) || 0) >= s.sessionsPerWeek).length
  const sessions = students.reduce((sum, s) => sum + Math.min(s.sessionsPerWeek, counts.get(s.id) || 0), 0)
  const assignment = trainerAssignmentScore(data, schedule)
  return prioritizeCompletion
    ? [complete, covered, sessions, ...assignment, utilization.pairedSlots, -utilization.singleSlots]
    : [covered, complete, sessions, ...assignment, utilization.pairedSlots, -utilization.singleSlots]
}

function scheduleDataWithIndexes(data) {
  if (data.contractsByStudent instanceof Map) return data
  return { ...data, contractsByStudent: indexContractsByStudent(data.contracts) }
}

function generateSchedule(data) {
  // Keep direct/unit-test callers compatible while ensuring production
  // optimizer attempts reuse one learner→contract index across every round.
  const indexedData = scheduleDataWithIndexes(data)
  let result = generateScheduleAttempt(indexedData)
  const baseline = safeSchedule(indexedData.schedule)
  const prioritizeCompletion = result.optimizationSummary?.completionFirst === true
  if ((indexedData.generationMode || 'optimize') === 'optimize'
    && compareScoreVectors(
      scheduleOutcome(indexedData, baseline, prioritizeCompletion),
      scheduleOutcome(indexedData, result.schedule, prioritizeCompletion),
    ) < 0) {
    // Retain the incumbent only when its mutable entries remain valid under
    // today's input. Invalid old auto entries must not bypass revalidation.
    const valid = Object.entries(baseline).every(([slotId, entries]) => entries.every((entry) => {
      if (protectedFromOptimizer(entry)) return true
      const student = indexedData.students.find((s) => s.id === entry.studentId), trainer = indexedData.trainers.find((t) => t.id === entry.trainerId)
      return student && trainer && candidateForSlot(indexedData, { student, trainer, slotId, schedule: scheduleWithoutEntry(baseline, slotId, entry) }).eligible
    }))
    if (valid) result = generateScheduleAttempt({ ...indexedData, generationMode: 'continue' })
  }
  const before = scheduleOutcome(indexedData, baseline), after = scheduleOutcome(indexedData, result.schedule)
  const oldLocations = new Map(Object.entries(baseline).flatMap(([slotId, entries]) => entries.filter((e) => e.type !== 'off').map((e) => [`${e.studentId}|${slotId}|${e.trainerId}`, e])))
  const changedEntries = Object.entries(result.schedule).reduce((sum, [slotId, entries]) => sum + entries.filter((e) => e.type !== 'off' && !oldLocations.has(`${e.studentId}|${slotId}|${e.trainerId}`)).length, 0)
  result.optimizationSummary.comparison = {
    before: { covered: before[0], sessions: before[2], complete: before[1], paired: before.at(-2), singles: -before.at(-1) },
    after: { covered: after[0], sessions: after[2], complete: after[1], paired: after.at(-2), singles: -after.at(-1) },
    addedSessions: after[2] - before[2],
    changedEntries,
  }
  return result
}

function commandReceiptId(actorUid, branchId, week, idempotencyKey) {
  return createHash('sha256').update(`${actorUid}|${branchId}|${week}|${idempotencyKey}`).digest('hex')
}

function commandInput(value) {
  const supported = new Set(['add_student', 'remove_student', 'move_student', 'set_trainer_off', 'clear_trainer_off', 'lock_entry', 'unlock_entry', 'set_student_weekly_target', 'reset_draft'])
  const command = typeof value === 'string' ? value : ''
  if (!supported.has(command)) throw new HttpsError('invalid-argument', 'Lệnh chỉnh lịch không hợp lệ.')
  return command
}

function adminDraftContract(contracts, studentId, preferredId = '', targetDate = '') {
  const rows = contracts.filter((contract) => contract?.studentId === studentId)
  const schedulableRows = rows.filter((contract) => !targetDate || contractSchedulableOn(contract, targetDate))
  const preferred = schedulableRows.find((contract) => contract.id === preferredId)
  if (preferred) return preferred
  return [...schedulableRows].sort((left, right) => String(right.startDate || '').localeCompare(String(left.startDate || ''))
    || String(right.endDate || '').localeCompare(String(left.endDate || ''))
    || String(left.id || '').localeCompare(String(right.id || '')))[0] || null
}

function adminDraftAvailabilityWarnings({ student, trainer, exactStudent, exactTrainer, slotId, week, leaves = [], contract = null }) {
  const warnings = new Set()
  const effective = effectiveStudentAvailability({
    targetWeek: week,
    exact: exactStudent,
    inherited: null,
    profile: student,
  })
  if (!['submitted', 'locked', 'inherited', 'recurring'].includes(effective.status)) warnings.add('AVAILABILITY_NOT_SUBMITTED')
  else if (!effective.slots.includes(slotId)) warnings.add('OUTSIDE_STUDENT_AVAILABILITY')

  const weeklyTrainer = trainerProfileForWeek(trainer, exactTrainer, week)
  const trainerMode = trainerAvailabilityMode(weeklyTrainer)
  if (trainerMode === 'unconfigured') warnings.add('TRAINER_AVAILABILITY_UNCONFIGURED')
  else if (!trainerIsAvailable(weeklyTrainer, slotId)) warnings.add('OUTSIDE_TRAINER_AVAILABILITY')
  const date = dateForSlot(week, slotId.split('-')[0])
  if (leaves.some((leave) => leaveCovers(leave, trainer.id, date))) warnings.add('TRAINER_ON_LEAVE')

  const assigned = assignedTrainerIds(contract)
  if (assigned.length > 0 && !assigned.includes(trainer.id)) warnings.add('TRAINER_ASSIGNMENT_MISMATCH')
  if (student?.branchId && student.branchId !== trainer.branchId) warnings.add('STUDENT_BRANCH_MISMATCH')
  return [...warnings].slice(0, MAX_ADMIN_OVERRIDE_WARNINGS)
}

// Before Publish an Admin is editing a draft map, not a live session. The
// normal draft command still performs the full optimizer validation fan-out;
// that is useful for staff and for a final publish, but it makes a one-cell
// Admin correction wait on every contract/session/availability query. This
// bounded path keeps the write atomic and rechecks the invariants that can
// corrupt a draft (branch, revision, source row, duplicate cell and locks),
// while leaving policy conflicts as the same visible Admin warnings.
async function applyFastAdminDraftCommand({ db, actor, branchId, week, command, payload, reason, expectedRevision, receipt }) {
  if (!activeAdministrator(actor) || payload?.adminOverride !== true
    || !['add_student', 'remove_student', 'move_student'].includes(command)) return null

  const draftRef = draftReference(db, branchId, week)
  const legacyRef = db.doc(`schedules/schedule_${week}`)
  const branchRef = db.doc(`branches/${branchId}`)
  const studentId = typeof payload.studentId === 'string' ? payload.studentId : ''
  const trainerId = typeof payload.trainerId === 'string' ? payload.trainerId : ''
  const fromTrainerId = command === 'move_student' ? String(payload.fromTrainerId || trainerId) : trainerId
  const slotId = typeof payload.slotId === 'string' ? payload.slotId : ''
  const fromSlotId = command === 'move_student' ? String(payload.fromSlotId || '') : slotId
  const instant = new Date()

  const priorReceipt = await receipt.get()
  if (priorReceipt.exists) return priorReceipt.data().result

  return db.runTransaction(async (transaction) => {
    const readRefs = [
      ['receipt', receipt],
      ['draft', draftRef],
      ['legacy', legacyRef],
      ['branch', branchRef],
    ]
    if (command !== 'remove_student') {
      readRefs.push(
        ['student', db.doc(`students/${studentId}`)],
        ['trainer', db.doc(`trainers/${trainerId}`)],
        ['studentAvailability', db.doc(`ptAvailability/${studentId}_${week}`)],
        ['trainerAvailability', db.doc(`trainerAvailability/${trainerId}_${week}`)],
        ['contracts', db.collection('contracts').where('studentId', '==', studentId).limit(101)],
        ['leaves', db.collection('leaveRequests').where('trainerId', '==', trainerId).limit(1001)],
      )
    }
    const values = await Promise.all(readRefs.map(([name, reference]) => name === 'trainerAvailability'
      ? loadTrainerAvailability(db, trainerId, week, transaction)
      : transaction.get(reference)))
    const snapshots = Object.fromEntries(values.map((snapshot, index) => [readRefs[index][0], snapshot]))
    if (snapshots.receipt.exists) return snapshots.receipt.data().result

    const branch = snapshots.branch
    if (!branch.exists || branch.data()?.status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
    const legacy = snapshots.legacy.exists ? snapshots.legacy.data() || {} : {}
    const draft = scopedDraftData(snapshots.draft, branchId, week)
    // A published draft must go through the live-session reconciliation
    // callable. Returning null lets the existing canonical path handle it.
    const published = draft?.status === 'published'
      || Number(draft?.publishedVersion || 0) > 0
      || legacy.publishStatusByBranch?.[branchId] === 'published'
      || Number(legacy.publishedVersions?.[branchId] || 0) > 0
    if (!draft || published) return null

    const revision = Number(draft.revision || 0)
    if (revision !== expectedRevision) throw new HttpsError('aborted', 'Draft đã thay đổi. Hãy tải lại trước khi chỉnh.', { issueCode: 'REVISION_CONFLICT' })
    let schedule = safeSchedule(draft.schedule)
    const valuesAtTarget = Array.isArray(schedule[slotId]) ? [...schedule[slotId]] : []
    const sourceValues = command === 'move_student'
      ? (Array.isArray(schedule[fromSlotId]) ? [...schedule[fromSlotId]] : [])
      : valuesAtTarget
    const affected = sourceValues.filter((entry) => entry.type !== 'off'
      && entry.studentId === studentId
      && entry.trainerId === (command === 'move_student' ? fromTrainerId : trainerId))
    const protectedEntry = affected.find((entry) => entry.source === 'published_existing' || entry.isLocked === true)
    if (protectedEntry || (['remove_student', 'move_student'].includes(command) && slotCalendarDateIsPast(week, command === 'move_student' ? fromSlotId : slotId))) {
      throw new HttpsError('failed-precondition', 'Ca đã khóa, đã publish hoặc đã qua ngày. Hãy dùng luồng điều chỉnh lịch sử cho ca đã ghi nhận.', { issueCode: 'PROTECTED_SESSION' })
    }
    if (command === 'remove_student' && !affected.length) throw new HttpsError('failed-precondition', 'Không tìm thấy ca cần gỡ. Hãy tải lại ma trận.')
    if (command === 'move_student') {
      if (fromSlotId === slotId && fromTrainerId === trainerId) throw new HttpsError('invalid-argument', 'Ca đích trùng ca nguồn.')
      if (affected.length !== 1) throw new HttpsError('failed-precondition', 'Không tìm thấy duy nhất một ca nguồn để chuyển.')
    }
    if (['add_student', 'move_student'].includes(command)) {
      if (valuesAtTarget.some((entry) => entry.type === 'off')) throw new HttpsError('failed-precondition', 'Ca đang được đánh dấu PT nghỉ.')
      if (valuesAtTarget.some((entry) => entry.type !== 'off' && entry.studentId === studentId && entry.trainerId === trainerId)) {
        throw new HttpsError('already-exists', 'Học viên đã có trong ca này.', { issueCode: 'DUPLICATE_SCHEDULE_ENTRY' })
      }
    }

    let entryMetadata = {}
    let selectedContractId = ''
    if (command !== 'remove_student') {
      const studentSnapshot = snapshots.student
      const trainerSnapshot = snapshots.trainer
      if (!studentSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy học viên.')
      if (!trainerSnapshot.exists || trainerSnapshot.data()?.branchId !== branchId) throw new HttpsError('not-found', 'Không tìm thấy PT trong chi nhánh.')
      const student = studentSnapshot.data() || {}
      const trainer = { id: trainerId, ...trainerSnapshot.data() }
      const contracts = snapshots.contracts.docs.map((item) => ({ id: item.id, ...item.data() }))
      const targetDate = dateForSlot(week, slotId.split('-')[0])
      requireCrossBranchConfirmation(student, branchId, payload)
      const contract = requireScheduleContract(contracts, studentId, targetDate, typeof payload.contractId === 'string' ? payload.contractId : '', payload.confirmStudentOff === true)
      selectedContractId = contract?.id || ''
      const warnings = adminDraftAvailabilityWarnings({
        student,
        trainer,
        exactStudent: snapshots.studentAvailability.exists ? snapshots.studentAvailability.data() : null,
        exactTrainer: snapshots.trainerAvailability.exists ? snapshots.trainerAvailability.data() : null,
        slotId,
        week,
        leaves: snapshots.leaves.docs.map((item) => item.data()),
        contract,
      })
      if (contractPausedOn(contract, targetDate)) warnings.push('CONTRACT_PAUSED')
      entryMetadata = {
        ...(contractPausedOn(contract, targetDate) ? { studentOffConfirmedDate: targetDate } : {}),
        ...(warnings.includes('TRAINER_ASSIGNMENT_MISMATCH') ? { trainerAssignmentWarning: true } : {}),
        ...(warnings.includes('STUDENT_BRANCH_MISMATCH') ? { studentBranchWarning: true, studentHomeBranchId: student.branchId || '' } : {}),
        adminOverride: true,
        adminOverrideBy: actor.uid,
        adminOverrideAt: instant.toISOString(),
        ...(warnings.length ? { adminOverrideWarnings: warnings } : {}),
      }
    }

    const nextSchedule = Object.fromEntries(Object.entries(schedule).map(([key, entries]) => [key, [...entries]]))
    if (command === 'remove_student') {
      nextSchedule[slotId] = valuesAtTarget.filter((entry) => !(entry.type !== 'off' && entry.studentId === studentId && entry.trainerId === trainerId))
    } else {
      if (command === 'move_student') nextSchedule[fromSlotId] = sourceValues.filter((entry) => !(entry.studentId === studentId && entry.trainerId === fromTrainerId))
      const nextEntry = {
        studentId,
        trainerId,
        branchId,
        type: 'training',
        ...(selectedContractId ? { contractId: selectedContractId } : {}),
        source: 'manual_v2',
        ...entryMetadata,
      }
      nextSchedule[slotId] = [...valuesAtTarget, nextEntry]
    }
    for (const [key, entries] of Object.entries(nextSchedule)) if (!entries.length) delete nextSchedule[key]
    if (scheduleEntryCount(nextSchedule) > MAX_DRAFT_ENTRIES || scheduleDocumentEntryCount(nextSchedule) > MAX_DRAFT_DOCUMENT_ENTRIES) throw new HttpsError('resource-exhausted', 'Draft vượt giới hạn an toàn.')

    const nextRevision = revision + 1
    const weeklySessionTargets = safeWeeklySessionTargets(draft.weeklySessionTargets)
    const warnings = entryMetadata.adminOverrideWarnings || []
    const unassignedEntries = preserveManualUnassignedEntries(
      draft.unassignedEntries,
      nextSchedule,
      { studentId, command },
    )
    const result = { draftRevision: nextRevision, schedule: nextSchedule, weeklySessionTargets, warnings }
    const draftWrite = {
      schemaVersion: 2,
      branchId,
      weekId: week,
      schedule: nextSchedule,
      revision: nextRevision,
      status: 'draft',
      unassignedEntries,
      weeklySessionTargets,
      optimizationSummary: FieldValue.delete(),
      expiresAt: draftExpiresAt(week),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
      createdAt: draft.createdAt || FieldValue.serverTimestamp(),
    }
    transaction.update(draftRef, draftWrite)
    transaction.create(receipt, { actorUid: actor.uid, branchId, weekId: week, command, idempotencyKey: receipt.id, result, createdAt: FieldValue.serverTimestamp() })
    transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
      schemaVersion: 2,
      action: `pt_schedule.${command}`,
      actorUid: actor.uid,
      branchId,
      weekId: week,
      previousDraftRevision: revision,
      nextDraftRevision: nextRevision,
      affectedStudentCount: 1,
      studentId: studentId || null,
      adminOverride: true,
      adminOverrideWarnings: warnings,
      reason: typeof reason === 'string' ? reason.trim().slice(0, 300) : '',
      createdAt: FieldValue.serverTimestamp(),
    })
    return result
  })
}

function resetDraftSchedule(data, currentSchedule) {
  const schedule = {}
  for (const [slotId, entries] of Object.entries(safeSchedule(currentSchedule))) {
    // Explicit reset clears every unpublished booking, including manual,
    // locked and cross-branch drafts. Locks still protect optimizer runs.
    const retained = entries.filter((entry) => entry.type === 'off' || entry.source === 'published_existing')
    if (retained.length) schedule[slotId] = retained
  }
  // Rehydrate every real published session even when the draft predates V2.
  mergePublishedSessions(data, schedule, [])
  return schedule
}

function createPtScheduleV2Functions({
  db,
  onCall,
  branchCatalogOnCall = onCall,
  workspaceOnCall = onCall,
  slotCandidatesOnCall = onCall,
  actorForBranch = scheduleActor,
  branchData = loadBranchData,
  manualData = loadManualMutationData,
}) {
  const listPtScheduleBranches = branchCatalogOnCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'pt.schedule.branch.publish')
    const snapshot = await db.collection('branches').limit(100).get()
    return {
      schemaVersion: 2,
      branches: snapshot.docs.map((item) => ({ id: item.id, name: item.data().name || item.id, status: item.data().status || 'active' }))
        .filter((branch) => branch.status !== 'archived' && (activeAdministrator(actor) || actor.branchIds.includes(branch.id)))
        .sort((left, right) => left.name.localeCompare(right.name, 'vi')),
    }
  })

  const getPtScheduleWorkspace = workspaceOnCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const actor = await actorForBranch(request, db, branchId)
    const initialPaint = request.data?.initialPaint === true
    const forceAvailabilityRefresh = request.data?.forceAvailabilityRefresh === true
    const data = await branchData(db, branchId, week, {
      initialPaint,
      // A published Admin workspace is read-only from the optimizer's point
      // of view: direct matrix edits use the dedicated reconciliation
      // callable. Do not make the initial paint wait for legacy availability
      // history that is only needed when generating or validating a draft.
      skipLegacyAvailabilityFallback: activeAdministrator(actor),
      // A published Admin matrix only needs rows already in the matrix and
      // the compact roster used by the picker. Defer full session/availability
      // reconciliation to the write callable so branch switching stays fast.
      publishedMatrixFast: activeAdministrator(actor),
      // The same projection keeps an unpublished draft interactive. No real
      // session is created until Publish, so write/publish paths remain the
      // canonical place for quota and history evidence.
      workspaceMatrixFast: activeAdministrator(actor),
      forceRefresh: forceAvailabilityRefresh,
    })
    const eligibleStudents = data.students.filter((student) => student.eligibleForWeek === true)
    const workloadSchedule = safeSchedule(data.schedule)
    mergePublishedSessions({ ...data, weekId: week }, workloadSchedule, [])
    const publishedWorkspace = data.draft.status === 'published' || Number(data.draft.publishedVersion || 0) > 0
    const calculatedOptimizationSummary = {
      studentCoverage: data.partial
        ? { eligibleStudents: 0, studentsWithAtLeastOne: 0, fullyScheduledStudents: 0, totalTargetSessions: 0, scheduledEntries: 0, missingSessions: 0 }
        : studentCoverageForSchedule({ ...data, weekId: week }, workloadSchedule),
      // Feasibility is an optimizer preflight. Re-running it for every
      // published matrix read adds CPU without changing the live schedule;
      // generation/validation still compute it on the full data path.
      studentFeasibility: data.partial
        ? []
        : publishedWorkspace
        ? (data.draft.optimizationSummary?.studentFeasibility || [])
        : studentFeasibilityForSchedule({ ...data, weekId: week }, workloadSchedule),
      trainerLoads: data.partial ? [] : trainerLoadsForSchedule({ ...data, weekId: week }, workloadSchedule),
      slotUtilization: slotUtilizationForSchedule({ ...data, weekId: week }, workloadSchedule),
    }
    const reconciledQuickCoverage = data.partial
      ? data.quickCoverage || null
      : {
          status: 'verified',
          verification: 'exact',
          verified: true,
          source: 'reconciled',
          scope: 'selected_branch_and_sessions',
          branchId,
          weekId: week,
          ...calculatedOptimizationSummary.studentCoverage,
          estimatedMissingSessions: calculatedOptimizationSummary.studentCoverage.missingSessions,
          draftOnly: false,
          crossBranchCoverageVerified: true,
          otherBranchScheduledEntries: Object.values(data.weeklySessionCoverage || {})
            .reduce((total, coverage) => total + Number(coverage?.otherBranches || 0), 0),
        }
    const responseContractIds = new Set(Object.values(workloadSchedule).flat()
      .map((entry) => entry.contractId)
      .filter(Boolean))
    const latestContractByStudent = new Map()
    for (const contract of data.contracts) {
      const current = latestContractByStudent.get(contract.studentId)
      if (!current || String(current.endDate || '').localeCompare(String(contract.endDate || '')) < 0) {
        latestContractByStudent.set(contract.studentId, contract)
      }
    }
    for (const student of data.students) {
      ;(student.eligibleContractIds || []).forEach((contractId) => responseContractIds.add(contractId))
      const latestContract = latestContractByStudent.get(student.id)
      if (latestContract) responseContractIds.add(latestContract.id)
    }
    // Legacy sessions use branchId="all". They still belong to this
    // workspace when their learner or PT is present in the selected branch;
    // expose those references so Admin removal can cancel the real session in
    // the short, idempotent path instead of scanning every session again.
    const branchStudentIds = new Set([...data.students, ...(data.crossBranchStudents || [])].map((student) => student.id))
    const branchTrainerIds = new Set((data.trainers || []).map((trainer) => trainer.id))
    const sessionRefs = {}
    const referenceSessions = (data.sessions || [])
      .filter((session) => (session.branchId === branchId
        || (session.branchId === 'all' && (branchStudentIds.has(session.studentId) || branchTrainerIds.has(session.trainerId))))
        && historicalSessionOccupies(session)
        && publishedSessionSlotId(week, session))
      .sort((left, right) => Number(left.branchId !== 'all') - Number(right.branchId !== 'all'))
    for (const session of referenceSessions) {
      const slotId = publishedSessionSlotId(week, session)
      const key = `${session.studentId}|${session.trainerId}|${slotId}`
      if (!sessionRefs[key]) sessionRefs[key] = { sessionId: session.id, revision: Number(session.revision || 0) }
    }
    const liveConflictWarnings = scheduleConflictWarningsForWorkspace({
      weekId: week,
      sessions: data.sessions,
    })
    return {
      schemaVersion: 2,
      readMode: data.readMode || (data.partial === true ? 'display' : 'reconciled'),
      partial: data.partial === true,
      branch: data.branch,
      weekId: week,
      draftRevision: data.draft.revision,
      draftStatus: data.draft.status,
      publishedVersion: data.draft.publishedVersion,
      publishedRevision: data.draft.publishedRevision,
      updatedAt: data.draft.updatedAt,
      updatedBy: data.draft.updatedBy,
      schedule: workloadSchedule,
      // Cross-branch profiles are display-only rows resolved from the current
      // schedule/session references. They are deliberately excluded from the
      // internal `data.students` roster used by the optimizer and coverage
      // calculations above.
      students: [...data.students, ...(data.crossBranchStudents || [])],
      trainers: data.trainers,
      // The UI needs date-valid contracts, contracts bound to draft entries,
      // and one latest contract for compact diagnostics. Older renewal-chain
      // rows stay server-side and no longer inflate every workspace response.
      contracts: data.contracts.filter((contract) => responseContractIds.has(contract.id)),
      // Session rows have already been folded into contract quota and the
      // protected schedule above. The workspace UI never reads the raw rows;
      // omitting them removes the largest repeated network payload.
      sessions: [],
      // Keep only the compact cross-branch coverage projection needed by the
      // warning UI. Raw session/attendance rows stay server-side.
      weeklySessionCoverage: data.weeklySessionCoverage || {},
      // Initial paint exposes a bounded draft-only estimate. Reconciled
      // workspaces expose the exact summary above with an explicit status so
      // the UI never mistakes a fast placeholder for zero missing sessions.
      quickCoverage: reconciledQuickCoverage,
      // Small optimistic-concurrency references for privileged edits; never
      // send raw attendance/billing documents to the scheduling workspace.
      sessionRefs,
      scheduleConfig: data.config,
      // Put live duplicate/conflict diagnostics first so a large historical
      // optimizer warning list cannot hide the operational issue the Admin
      // needs to review in the current matrix.
      warnings: [...liveConflictWarnings, ...(Array.isArray(data.draft.warnings) ? data.draft.warnings : [])].slice(0, 100),
      // Always derive live workload from the current draft and current trainer
      // policy. Keep generator diagnostics (including the relocation trace)
      // from the audit snapshot, but never reuse its stale live metrics.
      optimizationSummary: {
        ...data.draft.optimizationSummary,
        ...calculatedOptimizationSummary,
      },
      unassignedEntries: data.draft.unassignedEntries,
      summary: {
        eligibleStudents: eligibleStudents.length,
        trainers: data.trainers.length,
        unconfiguredTrainers: data.trainers.filter((trainer) => trainer.availabilityMode === 'unconfigured').length,
        scheduledEntries: calculatedOptimizationSummary.studentCoverage.scheduledEntries,
        missingSessions: calculatedOptimizationSummary.studentCoverage.missingSessions,
        unassignedEntries: data.draft.unassignedEntries.length,
      },
    }
  })

  const generatePtScheduleDraft = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const expectedRevision = Number(request.data?.expectedDraftRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản draft không hợp lệ.')
    const actor = await actorForBranch(request, db, branchId)
    const data = await branchData(db, branchId, week)
    if (data.draft.revision !== expectedRevision) throw new HttpsError('aborted', 'Draft đã thay đổi. Hãy tải lại trước khi tối ưu.')
    const mode = request.data?.mode || 'optimize'
    if (!['optimize', 'supplement', 'continue'].includes(mode)) throw new HttpsError('invalid-argument', 'Chế độ xếp lịch không hợp lệ.')
    const generated = generateSchedule({ ...data, weekId: week, generationMode: mode, searchOffset: expectedRevision, referenceNow: Date.now() })
    const reference = draftReference(db, branchId, week)
    const result = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(reference)
      const revision = Number(current.exists ? current.data()?.revision || 0 : data.draft.revision)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Draft đã thay đổi. Hãy tải lại trước khi xếp tự động.')
      const nextRevision = revision + 1
      const draftWrite = {
        schemaVersion: 2,
        branchId,
        weekId: week,
        schedule: generated.schedule,
        revision: nextRevision,
        status: 'draft',
        generatorVersion: OPTIMIZER_VERSION,
        warnings: generated.warnings,
        optimizationSummary: generated.optimizationSummary,
        unassignedEntries: generated.unassignedEntries,
        expiresAt: draftExpiresAt(week),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        createdAt: current.exists ? current.data().createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      }
      // Replacing the top-level schedule field is deliberate. A Firestore
      // merge would preserve removed nested slot keys and make deleted cells
      // reappear on the next workspace read.
      if (current.exists) transaction.update(reference, draftWrite)
      else transaction.set(reference, draftWrite)
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), { schemaVersion: 2, action: 'pt_schedule.generated', actorUid: actor.uid, branchId, weekId: week, previousDraftRevision: revision, nextDraftRevision: nextRevision, entryCount: scheduleEntryCount(generated.schedule), studentCoverage: generated.optimizationSummary.studentCoverage, slotUtilization: generated.optimizationSummary.slotUtilization, unassignedCount: generated.unassignedEntries.length, warnings: generated.warnings.slice(0, 100), createdAt: FieldValue.serverTimestamp() })
      return { draftRevision: nextRevision, schedule: generated.schedule, warnings: generated.warnings, optimizationSummary: generated.optimizationSummary, unassignedEntries: generated.unassignedEntries, generatorVersion: OPTIMIZER_VERSION }
    })
    invalidateBranchDataCache(db, branchId, week)
    return result
  })

  const getPtScheduleSlotCandidates = slotCandidatesOnCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const actor = await actorForBranch(request, db, branchId)
    const directoryOnly = request.data?.directoryOnly === true && activeAdministrator(actor)
    const trainerId = directoryOnly ? '' : documentId(request.data?.trainerId, 'Mã PT')
    const slotId = directoryOnly ? 'T2-0' : typeof request.data?.slotId === 'string' ? request.data.slotId : ''
    if (!/^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/.test(slotId)) throw new HttpsError('invalid-argument', 'Ô lịch không hợp lệ.')
    const rawSearch = typeof request.data?.search === 'string' ? request.data.search.trim().slice(0, 100) : ''
    const search = normalizedSearchText(rawSearch)
    if (directoryOnly && search.length < 2) return { schemaVersion: 2, candidates: [] }
    const historical = request.data?.historical === true && slotIsPast(week, slotId)
    // Admin search is intentionally narrow: the workspace already has every
    // same-branch learner and can rank those candidates locally. Avoid a full
    // branchData fan-out on every debounced keystroke when the only missing
    // information is a learner whose home branch differs from the selected
    // training branch. Historical lookups still need the complete branch
    // snapshot because they validate real sessions and quota.
    const adminCrossBranchSearch = activeAdministrator(actor)
      && (request.data?.crossBranchOnly === true || directoryOnly)
      && search.length >= 2
      && !historical
    const data = adminCrossBranchSearch ? null : await branchData(db, branchId, week)
    if (data) data.weekId = week
    const trainer = data?.trainers.find((item) => item.id === trainerId)
    if (!adminCrossBranchSearch && !trainer) throw new HttpsError('not-found', 'Không tìm thấy PT trong chi nhánh.')
    const scheduledCounts = data ? scheduleStudentCounts(data.schedule, data) : new Map()
    const studentsById = new Map((data?.students || []).map((student) => [student.id, student]))
    const branchCandidates = data
      ? data.students.filter(student => historical || !hiddenExpiredStudent(data.contracts, student.id, todayInHoChiMinh())).filter((student) => !search
        || normalizedSearchText(student.name).includes(search)
        || normalizedSearchText(student.phone).includes(search)).map((student) => ({
          studentId: student.id,
          name: student.name,
          phone: student.phone,
          ...(historical
            ? historicalSlotCandidate(data, { student, trainer, slotId })
            : manualSlotCandidate(candidateForSlot(data, { student, trainer, slotId, schedule: data.schedule }))),
        }))
      : []

    // Tìm học viên khác cơ sở chỉ khi admin chủ động nhập từ khóa. Search
    // thường trả về projection nhẹ để không chặn thao tác gõ; historical
    // lookup vẫn dùng cùng exact contract/session validation như write path.
    // Quyền admin và xác nhận ngoại lệ chỉ có hiệu lực ở bước commit.
    let crossBranchCandidates = []
    if (activeAdministrator(actor) && search.length >= 2) {
      const globalStudents = await crossBranchStudentProfilesForSearch(db, search, rawSearch, branchId)
      let externalMatches = globalStudents
        .filter((profile) => profile.branchId !== branchId)
        .filter((profile) => normalizedSearchText(profile.name).includes(search)
          || normalizedSearchText(profile.phone).includes(search)
          || normalizedSearchText(profile.email).includes(search))
        .slice(0, 12)
      // Read entitlement only for bounded name matches, never a full branch.
      const matchContracts = !historical && !directoryOnly && externalMatches.length
        ? await db.collection('contracts').where('studentId', 'in', externalMatches.map(profile => profile.id)).limit(401).get() : null
      if (matchContracts?.size > 400) throw new HttpsError('resource-exhausted', 'Quá nhiều hợp đồng phù hợp; hãy tìm bằng số điện thoại.')
      const contractRows = (matchContracts?.docs || []).map(doc => ({ id: doc.id, ...doc.data() }))
      if (!historical && !directoryOnly) externalMatches = externalMatches.filter(profile => !hiddenExpiredStudent(contractRows, profile.id, todayInHoChiMinh()))
      const enriched = adminCrossBranchSearch
        ? externalMatches.map((profile) => {
          const date = dateForSlot(week, slotId.split('-')[0])
          const ownContracts = contractRows.filter(contract => contract.studentId === profile.id)
          const contract = findScheduleContract(ownContracts, profile.id, date, '', true)
          const failure = contract ? (contractPausedOn(contract, date) ? ['CONTRACT_PAUSED'] : []) : ['ACTIVE_CONTRACT_NOT_FOUND']
          return ({
          // Search results are intentionally a projection. Selecting the row
          // and confirming the Admin edit runs the canonical contract,
          // availability, session and quota checks on the write path.
          studentId: profile.id,
          name: profile.name || 'Chưa cập nhật tên',
          phone: profile.phone || '',
          eligible: false,
          manualSelectable: failure.length === 0,
          adminManualSelectable: Boolean(contract),
          reasons: [...failure, 'STUDENT_BRANCH_MISMATCH'],
          warningReasons: ['STUDENT_BRANCH_MISMATCH'],
          hardReasons: failure,
          contractId: contract?.id || null,
          contractEndDate: ownContracts.map(contract => storedDate(contract.endDate)).sort().at(-1) || '',
          date: dateForSlot(week, slotId.split('-')[0]),
          matchesStudentAvailability: true,
          availabilityReason: null,
          studentBranchWarning: true,
          studentHomeBranchId: profile.branchId || '',
        }) })
        : await Promise.all(externalMatches.map(async (profile) => {
        try {
          const exactData = await manualData(db, branchId, week, trainerId, profile.id, true, data || undefined)
          exactData.weekId = week
          const student = exactData.students[0]
          const exactTrainer = exactData.trainers[0] || trainer
          if (!student || !exactTrainer) return null
          const result = historical
            ? historicalSlotCandidate(exactData, { student, trainer: exactTrainer, slotId })
            : manualSlotCandidate(candidateForSlot(exactData, { student, trainer: exactTrainer, slotId, schedule: exactData.schedule }))
          return {
            studentId: student.id,
            name: student.name,
            phone: student.phone,
            studentBranchWarning: true,
            studentHomeBranchId: student.branchId || '',
            ...result,
          }
        } catch {
          return null
        }
      }))
      crossBranchCandidates = enriched.filter(Boolean)
    }
    const allCandidates = [...branchCandidates, ...crossBranchCandidates]
    return {
      schemaVersion: 2,
      candidates: allCandidates.sort((left, right) => {
        const rank = (candidate) => candidate.eligible ? 0 : candidate.manualSelectable ? 1 : 2
        const leftStudent = studentsById.get(left.studentId)
        const rightStudent = studentsById.get(right.studentId)
        const leftMissing = Math.max(0, Number(leftStudent?.sessionsPerWeek || 0) - (scheduledCounts.get(left.studentId) || 0))
        const rightMissing = Math.max(0, Number(rightStudent?.sessionsPerWeek || 0) - (scheduledCounts.get(right.studentId) || 0))
        return rank(left) - rank(right)
          || Number(Boolean(left.trainerAssignmentWarning)) - Number(Boolean(right.trainerAssignmentWarning))
          || rightMissing - leftMissing
          || Number(leftStudent?.availableSlots?.length || 0) - Number(rightStudent?.availableSlots?.length || 0)
          || left.name.localeCompare(right.name, 'vi')
      }).slice(0, 100),
    }
  })

  const createHistoricalPtSession = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const trainerId = documentId(request.data?.trainerId, 'Mã PT')
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const contractId = documentId(request.data?.contractId, 'Mã hợp đồng')
    const slotId = typeof request.data?.slotId === 'string' ? request.data.slotId : ''
    if (!/^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/.test(slotId)) throw new HttpsError('invalid-argument', 'Ô lịch không hợp lệ.')
    if (!slotIsPast(week, slotId)) throw new HttpsError('failed-precondition', 'Ca chưa qua giờ; hãy lưu vào draft và publish theo luồng xếp lịch.')
    const reason = typeof request.data?.reason === 'string' ? request.data.reason.trim().slice(0, 300) : ''
    if (reason.length < 8) throw new HttpsError('invalid-argument', 'Hãy nhập lý do bổ sung tối thiểu 8 ký tự để lưu audit.')
    const idempotencyKey = typeof request.data?.idempotencyKey === 'string' ? request.data.idempotencyKey.trim() : ''
    if (!/^[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey)) throw new HttpsError('invalid-argument', 'Khóa chống lặp không hợp lệ.')
    const actor = await actorForBranch(request, db, branchId)
    const receipt = db.doc(`ptScheduleCommandReceipts/${commandReceiptId(actor.uid, branchId, week, idempotencyKey)}`)
    const priorReceipt = await receipt.get()
    if (priorReceipt.exists) return priorReceipt.data().result
    const branchWorkspace = await branchData(db, branchId, week)
    const crossBranchConfirmed = activeAdministrator(actor) && request.data?.confirmCrossBranchStudent === true
    const data = crossBranchConfirmed
      ? await manualData(db, branchId, week, trainerId, studentId, true, branchWorkspace)
      : branchWorkspace
    data.weekId = week
    const student = data.students.find((item) => item.id === studentId)
    const trainer = data.trainers.find((item) => item.id === trainerId)
    if (!student || !trainer) throw new HttpsError('not-found', 'Không tìm thấy PT hoặc học viên trong chi nhánh.')
    const candidate = historicalSlotCandidate(data, { student, trainer, slotId })
    if (candidate.studentBranchWarning && !crossBranchConfirmed) {
      throw new HttpsError('failed-precondition', 'Học viên thuộc cơ sở khác. Admin cần xác nhận ngoại lệ trước khi bổ sung lịch sử.', {
        issueCode: 'STUDENT_BRANCH_CONFIRMATION_REQUIRED',
        errors: ['STUDENT_BRANCH_MISMATCH'],
      })
    }
    if (!candidate.manualSelectable || candidate.contractId !== contractId) {
      throw new HttpsError('failed-precondition', 'Ca bổ sung chưa đủ điều kiện ghi vào lịch sử.', {
        issueCode: 'HISTORICAL_SESSION_REJECTED',
        errors: candidate.hardReasons?.length ? candidate.hardReasons : candidate.reasons,
      })
    }
    const acknowledgedWarnings = new Set(Array.isArray(request.data?.acknowledgedWarnings)
      ? request.data.acknowledgedWarnings.filter((value) => typeof value === 'string').slice(0, 20)
      : [])
    if (candidate.warningReasons.some((warning) => !acknowledgedWarnings.has(warning))) {
      throw new HttpsError('failed-precondition', 'Hãy xác nhận các lưu ý của ca đã qua trước khi ghi lịch sử.', {
        issueCode: 'HISTORICAL_WARNING_CONFIRMATION_REQUIRED',
        errors: candidate.warningReasons,
      })
    }

    const [day, rawHour] = slotId.split('-')
    const targetDate = dateForSlot(week, day)
    const targetHour = Number(rawHour)
    const scheduleId = `schedule_${week}`
    const scheduleEntryId = `${scheduleId}-${slotId}-${studentId}`
    const sessionDigest = createHash('sha256').update(`${scheduleId}|${branchId}|${slotId}|${studentId}`).digest('hex').slice(0, 40)
    const sessionReference = db.doc(`sessions/pt_${sessionDigest}`)
    const studentReference = db.doc(`students/${studentId}`)
    const trainerReference = db.doc(`trainers/${trainerId}`)
    const contractReference = db.doc(`contracts/${contractId}`)
    const branchReference = db.doc(`branches/${branchId}`)
    const payrollReference = db.doc(`payrollRuns/${targetDate.slice(0, 7)}`)
    const nextDate = new Date(`${targetDate}T00:00:00.000Z`)
    nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    const targetDateEnd = nextDate.toISOString().slice(0, 10)
    const trainerDayQuery = db.collection('sessions').where('trainerId', '==', trainerId).where('date', '>=', targetDate).where('date', '<', targetDateEnd).limit(201)
    const studentDayQuery = db.collection('sessions').where('studentId', '==', studentId).where('date', '>=', targetDate).where('date', '<', targetDateEnd).limit(201)
    const branchDayQuery = db.collection('sessions').where('branchId', '==', branchId).where('date', '>=', targetDate).where('date', '<', targetDateEnd).limit(1001)
    const contractSessionsQuery = db.collection('sessions').where('contractId', '==', contractId).limit(1001)

    const result = await db.runTransaction(async (transaction) => {
      const [existingReceipt, existingSession, currentStudent, currentTrainer, currentContract, currentBranch, payroll, trainerDay, studentDay, contractSessions, branchDay, currentConfig] = await Promise.all([
        transaction.get(receipt),
        transaction.get(sessionReference),
        transaction.get(studentReference),
        transaction.get(trainerReference),
        transaction.get(contractReference),
        transaction.get(branchReference),
        transaction.get(payrollReference),
        transaction.get(trainerDayQuery),
        transaction.get(studentDayQuery),
        transaction.get(contractSessionsQuery),
        transaction.get(branchDayQuery),
        transaction.get(db.doc('settings/scheduleConfig')),
      ])
      if (existingReceipt.exists) return existingReceipt.data().result
      if (existingSession.exists) {
        const existing = existingSession.data()
        if (existing.studentId === studentId && existing.trainerId === trainerId && storedDate(existing.date) === targetDate && Number(existing.hour) === targetHour) {
          return { unchanged: true, sessionId: sessionReference.id, contractId: existing.contractId || contractId, status: existing.status || 'scheduled', warnings: candidate.warningReasons, payrollAdjustmentRequired: existing.payrollAdjustmentRequired === true }
        }
        throw new HttpsError('already-exists', 'Mã buổi lịch sử đã được dùng cho dữ liệu khác.')
      }
      if (!currentBranch.exists || currentBranch.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
      const currentStudentBranchId = currentStudent.data()?.branchId || ''
      const currentStudentIsCrossBranch = Boolean(currentStudentBranchId) && currentStudentBranchId !== branchId
      if (!currentStudent.exists || !currentStudentBranchId || ['archived', 'deleted'].includes(String(currentStudent.data()?.status || '').toLowerCase())) throw new HttpsError('failed-precondition', 'Hồ sơ học viên không còn hợp lệ.')
      if (currentStudentBranchId !== student.branchId) throw new HttpsError('aborted', 'Học viên đã chuyển cơ sở; hãy tải lại và xác nhận trên hồ sơ mới.')
      if (currentStudentIsCrossBranch && !crossBranchConfirmed) throw new HttpsError('failed-precondition', 'Học viên đã chuyển cơ sở; cần xác nhận lại ngoại lệ khác cơ sở.')
      if (!currentTrainer.exists || currentTrainer.data().branchId !== branchId || trainerIsLocked(currentTrainer.data())) throw new HttpsError('failed-precondition', 'PT không còn hoạt động tại chi nhánh này.')
      const expectedContractBranchId = currentStudentIsCrossBranch ? currentStudentBranchId : branchId
      if (!currentContract.exists || currentContract.data().studentId !== studentId || currentContract.data().branchId !== expectedContractBranchId) throw new HttpsError('failed-precondition', 'Hợp đồng không khớp học viên hoặc chi nhánh hồ sơ.')
      const contract = currentContract.data()
      if (HISTORICAL_INVALID_CONTRACT_STATUSES.has(String(contract.status || '').toLowerCase())
        || storedDate(contract.startDate) > targetDate
        || storedDate(contract.endDate) < targetDate
        || contractPaused(contract, targetDate)) throw new HttpsError('failed-precondition', 'Hợp đồng không có hiệu lực tại ngày bổ sung.')
      if (trainerDay.size > 200 || studentDay.size > 200 || contractSessions.size > 1000 || branchDay.size > 1000) throw new HttpsError('resource-exhausted', 'Dữ liệu lịch sử vượt giới hạn đối chiếu an toàn.')
      const contractSessionRows = contractSessions.docs.map((item) => ({ id: item.id, ...item.data() }))
      const usage = summarizeContractUsage(contract, contractSessionRows)
      const heldSessions = contractSessionRows.filter((session) => ['scheduled', 'rescheduled'].includes(String(session.status || '').toLowerCase()) && session.billingStatus !== 'charged').length
      if (usage.remainingSessions - heldSessions < 1) throw new HttpsError('failed-precondition', 'Hợp đồng không còn buổi để ghi nhận ca bổ sung.', { issueCode: 'CONTRACT_SESSION_QUOTA_EXCEEDED' })
      const studentConflict = studentDay.docs.some((item) => historicalSessionOccupies(item.data()))
      if (studentConflict) throw new HttpsError('already-exists', 'Học viên đã có một buổi khác trong ngày này.', { issueCode: 'STUDENT_MULTIPLE_SESSIONS_PER_DAY' })
      const trainerSlotStudents = new Set(trainerDay.docs.filter((item) => historicalSessionOccupies(item.data()) && Number(item.data().hour) === targetHour).map((item) => item.data().studentId))
      if (trainerSlotStudents.size >= normalizedCapacity(currentTrainer.data().slotCapacity)) throw new HttpsError('resource-exhausted', 'Ca của PT đã đủ học viên.', { issueCode: 'TRAINER_CAPACITY_EXCEEDED' })
      const capacity = branchSlotCapacity(normalizedScheduleConfig(currentConfig.data()), branchId, slotId)
      const occupied = branchDay.docs.filter((item) => historicalSessionOccupies(item.data()) && Number(item.data().hour) === targetHour).length
      if (capacity !== null && occupied >= capacity) throw new HttpsError('resource-exhausted', 'Ca tại cơ sở đã đủ học viên.', { issueCode: 'BRANCH_CAPACITY_REACHED' })

      const payrollAdjustmentRequired = payroll.exists && payroll.data().status !== 'draft'
      const result = {
        unchanged: false,
        sessionId: sessionReference.id,
        contractId,
        status: 'scheduled',
        warnings: candidate.warningReasons,
        payrollAdjustmentRequired,
      }
      transaction.create(sessionReference, {
        schemaVersion: 2,
        scheduleEntryId,
        scheduleWeekId: week,
        slotId,
        studentId,
        accountUid: currentStudent.data().accountUid || currentStudent.data().uid || null,
        trainerId,
        contractId,
        branchId,
        date: targetDate,
        hour: targetHour,
        status: 'scheduled',
        scheduleStatus: 'scheduled',
        billingStatus: 'pending',
        attendanceStatus: 'pending',
        source: 'admin_historical_supplement',
        historicalCorrection: true,
        historicalCorrectionReason: reason,
        requiresPtConfirmation: true,
        ...(candidate.studentBranchWarning ? { studentBranchWarning: true, studentHomeBranchId: currentStudentBranchId } : {}),
        ...(candidate.trainerAssignmentWarning ? { trainerAssignmentWarning: true } : {}),
        ...(candidate.warningReasons.length ? { historicalWarnings: candidate.warningReasons } : {}),
        ...(payrollAdjustmentRequired ? { payrollAdjustmentRequired: true, payrollPeriodId: payroll.id } : {}),
        revision: 0,
        verifiedByStudent: false,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      })
      transaction.create(db.collection('sessionEvents').doc(), {
        schemaVersion: 2,
        type: 'historical_session_supplemented',
        sessionId: sessionReference.id,
        studentId,
        trainerId,
        contractId,
        branchId,
        to: { date: targetDate, hour: targetHour, trainerId },
        reason,
        warnings: candidate.warningReasons,
        ...(candidate.studentBranchWarning ? { studentBranchWarning: true, studentHomeBranchId: currentStudentBranchId } : {}),
        payrollAdjustmentRequired,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        schemaVersion: 2,
        action: 'pt_schedule.historical_session_supplemented',
        actorUid: actor.uid,
        branchId,
        weekId: week,
        slotId,
        sessionId: sessionReference.id,
        studentId,
        trainerId,
        contractId,
        reason,
        warnings: candidate.warningReasons,
        studentBranchWarning: candidate.studentBranchWarning === true,
        studentHomeBranchId: candidate.studentBranchWarning ? currentStudentBranchId : null,
        payrollAdjustmentRequired,
        createdAt: FieldValue.serverTimestamp(),
      })
      if (payroll.exists && payroll.data().status === 'draft') transaction.update(payrollReference, {
        requiresRebuild: true,
        sourceDataStale: true,
        sourceDataChangedAt: FieldValue.serverTimestamp(),
        sourceDataChangedBy: actor.uid,
        sourceDataChangeReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(receipt, { actorUid: actor.uid, branchId, weekId: week, command: 'create_historical_session', idempotencyKey, result, createdAt: FieldValue.serverTimestamp() })
      return result
    })
    invalidateBranchDataCache(db, branchId, week)
    return result
  })

  const savePtStudentAvailability = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const expectedRevision = Number(request.data?.expectedRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản lịch rảnh không hợp lệ.')
    const actor = await actorForBranch(request, db, branchId)
    const [studentSnapshot, configSnapshot] = await Promise.all([
      db.doc(`students/${studentId}`).get(),
      db.doc('settings/scheduleConfig').get(),
    ])
    if (!studentSnapshot.exists || studentSnapshot.data().branchId !== branchId) {
      throw new HttpsError('not-found', 'Không tìm thấy học viên trong chi nhánh đang xếp lịch.')
    }
    const config = normalizedScheduleConfig(configSnapshot.data())
    const slots = normalizedScheduleAvailabilitySlots(request.data?.availableSlots, config)
    const requiredSessions = Math.max(1, Math.min(7, Number(studentSnapshot.data().sessionsPerWeek || 1)))
    const minimumSlots = Math.max(5, requiredSessions)
    const belowMinimumConfirmed = request.data?.confirmBelowMinimum === true && activeAdministrator(actor)
    if (!slots.length) throw new HttpsError('failed-precondition', 'Hãy chọn ít nhất một khung giờ rảnh.')
    if (slots.length < minimumSlots && !belowMinimumConfirmed) {
      throw new HttpsError('failed-precondition', `Hãy chọn ít nhất ${minimumSlots} khung giờ rảnh hoặc xác nhận lưu lịch thiếu khung với quyền Admin.`, {
        issueCode: 'MINIMUM_AVAILABILITY_REQUIRED',
        minimumSlots,
        selectedSlots: slots.length,
        missingSlots: minimumSlots - slots.length,
        action: 'confirm_below_minimum',
      })
    }
    const reference = db.doc(`ptAvailability/${studentId}_${week}`)
    const studentReference = db.doc(`students/${studentId}`)
    const cutoff = availabilityCutoff(week, configSnapshot.exists ? configSnapshot.data() : {})
    const submittedAtIso = new Date().toISOString()
    const nextRevision = await db.runTransaction(async (transaction) => {
      const [current, currentProfile] = await Promise.all([
        transaction.get(reference),
        transaction.get(studentReference),
      ])
      if (!currentProfile.exists || currentProfile.data().branchId !== branchId) throw new HttpsError('not-found', 'Không tìm thấy học viên trong chi nhánh đang xếp lịch.')
      const reopenedUntil = availabilityReopenForWeek(currentProfile.data(), week)
      const availabilityStatus = Date.now() >= cutoff.getTime() && !reopenedUntil ? 'locked' : 'submitted'
      const revision = Number(current.data()?.revision || 0)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Lịch rảnh đã thay đổi. Hãy tải lại trước khi lưu.', { issueCode: 'REVISION_CONFLICT', currentRevision: revision })
      const next = {
        schemaVersion: 1,
        studentId,
        accountUid: current.data()?.accountUid || null,
        weekId: week,
        slots,
        requiredSessions,
        minimumSlots,
        belowMinimumConfirmed,
        status: availabilityStatus,
        revision: revision + 1,
        submittedAt: current.data()?.submittedAt || FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (current.exists) transaction.update(reference, next)
      else transaction.create(reference, { ...next, createdAt: FieldValue.serverTimestamp() })
      const profilePatch = studentAvailabilityProfilePatch(currentProfile.data(), {
        weekId: week,
        slots,
        requiredSessions,
        minimumSlots,
        status: availabilityStatus,
        revision: revision + 1,
        submittedAt: submittedAtIso,
      })
      // Always advance the profile's sync marker, even when an older-week
      // edit is intentionally kept out of latestSubmittedAvailability. The
      // learner portal uses this marker to invalidate its process-local read
      // cache without rolling the profile projection backwards.
      transaction.update(studentReference, {
        ...profilePatch,
        latestAvailabilityUpdatedBy: actor.uid,
        latestAvailabilityUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.set(db.doc(`ptAvailabilitySync/${branchId}_${week}`), {
        schemaVersion: 1,
        branchId,
        weekId: week,
        studentAccountUid: currentProfile.data().accountUid || current.data()?.accountUid || '',
        revision: FieldValue.increment(1),
        updatedStudentId: studentId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        schemaVersion: 2,
        action: 'student_availability.admin_updated',
        actorUid: actor.uid,
        studentId,
        branchId,
        weekId: week,
        beforeSlotCount: Array.isArray(current.data()?.slots) ? current.data().slots.length : 0,
        afterSlotCount: slots.length,
        belowMinimumConfirmed,
        previousRevision: revision,
        nextRevision: revision + 1,
        latestFallbackAdvanced: Boolean(profilePatch.latestSubmittedAvailability),
        createdAt: FieldValue.serverTimestamp(),
      })
      return { revision: revision + 1, availabilityStatus }
    })
    invalidateBranchDataCache(db, branchId, week)
    return { schemaVersion: 1, availableSlots: slots, availabilityRevision: nextRevision.revision, availabilityStatus: nextRevision.availabilityStatus, belowMinimumConfirmed }
  })

  const reopenPtStudentAvailability = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const expectedRevision = Number(request.data?.expectedRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản lịch rảnh không hợp lệ.')
    const actor = await actorForBranch(request, db, branchId)
    if (!activeAdministrator(actor)) throw new HttpsError('permission-denied', 'Chỉ Admin mới được mở lại lịch rảnh cho học viên.')
    const studentReference = db.doc(`students/${studentId}`)
    const availabilityReference = db.doc(`ptAvailability/${studentId}_${week}`)
    const reopenUntilMillis = Date.parse(`${nextWeek(week)}T00:00:00+07:00`)
    if (!Number.isFinite(reopenUntilMillis) || reopenUntilMillis <= Date.now()) {
      throw new HttpsError('failed-precondition', 'Tuần đã kết thúc, không thể mở lại lịch rảnh.')
    }
    const reopenedUntil = Timestamp.fromMillis(reopenUntilMillis)
    const result = await db.runTransaction(async (transaction) => {
      const [studentSnapshot, availabilitySnapshot] = await Promise.all([
        transaction.get(studentReference),
        transaction.get(availabilityReference),
      ])
      if (!studentSnapshot.exists || studentSnapshot.data().branchId !== branchId) {
        throw new HttpsError('not-found', 'Không tìm thấy học viên trong chi nhánh đang xếp lịch.')
      }
      const current = availabilitySnapshot.data() || {}
      const currentRevision = Number(current.revision || 0)
      if (currentRevision !== expectedRevision) {
        throw new HttpsError('aborted', 'Lịch rảnh đã thay đổi. Hãy tải lại trước khi mở lại.', {
          issueCode: 'REVISION_CONFLICT',
          currentRevision,
        })
      }
      const existing = availabilityReopenForWeek(studentSnapshot.data(), week)
      if (existing) {
        return {
          changed: false,
          availabilityRevision: currentRevision,
          reopenedUntil: existing.toISOString(),
          availabilityStatus: Array.isArray(current.slots) && current.slots.length ? 'submitted' : 'missing',
        }
      }
      transaction.update(studentReference, {
        availabilityReopen: {
          weekId: week,
          reopenedUntil,
          reopenedBy: actor.uid,
          reopenedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.set(db.doc(`ptAvailabilitySync/${branchId}_${week}`), {
        schemaVersion: 1,
        branchId,
        weekId: week,
        studentAccountUid: studentSnapshot.data().accountUid || current.accountUid || '',
        revision: FieldValue.increment(1),
        updatedStudentId: studentId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        schemaVersion: 2,
        action: 'student_availability.reopened',
        actorUid: actor.uid,
        branchId,
        studentId,
        weekId: week,
        expectedRevision,
        reopenedUntil,
        reason: 'admin_open_until_week_end',
        createdAt: FieldValue.serverTimestamp(),
      })
      return {
        changed: true,
        availabilityRevision: currentRevision,
        reopenedUntil: new Date(reopenUntilMillis).toISOString(),
        availabilityStatus: Array.isArray(current.slots) && current.slots.length ? 'submitted' : 'missing',
      }
    })
    invalidateBranchDataCache(db, branchId, week)
    return { schemaVersion: 1, ...result, availabilityLocked: false }
  })

  // A target edit is a weekly operational override. It must not create a
  // schedule draft revision: the draft is reserved for matrix changes that
  // add, move or remove a learner. The optimizer and publish path read this
  // document together with the draft target map.
  const setPtStudentWeeklyTarget = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const resetToDefault = request.data?.resetToDefault === true
    const targetSessions = resetToDefault ? null : Number(request.data?.targetSessions)
    if (!resetToDefault && (!Number.isInteger(targetSessions) || targetSessions < 0 || targetSessions > 7)) {
      throw new HttpsError('invalid-argument', 'Mục tiêu tuần phải từ 0 đến 7 buổi.')
    }
    const idempotencyKey = typeof request.data?.idempotencyKey === 'string' ? request.data.idempotencyKey.trim() : ''
    if (!/^[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey)) throw new HttpsError('invalid-argument', 'Khóa chống lặp không hợp lệ.')
    const actor = await actorForBranch(request, db, branchId)
    const data = await branchData(db, branchId, week)
    const targetStudent = data.students.find((item) => item.id === studentId)
    if (!targetStudent || targetStudent.isCrossBranchDisplayOnly) throw new HttpsError('not-found', 'Không tìm thấy học viên trong chi nhánh đang xếp lịch.')
    const draftScheduledCount = Object.values(safeSchedule(data.schedule)).flat()
      .filter((entry) => entry.type !== 'off' && entry.studentId === studentId).length
    const coveredSessions = Number(data.weeklySessionCoverage?.[studentId]?.total || 0)
    const scheduledCount = Math.max(draftScheduledCount, Number.isFinite(coveredSessions) ? coveredSessions : 0)
    const nextTarget = resetToDefault
      ? Math.min(Number(targetStudent.defaultSessionsPerWeek || 0), Number(targetStudent.maxWeeklySessions || 0))
      : targetSessions
    if (nextTarget < scheduledCount) {
      throw new HttpsError('failed-precondition', `Học viên đã có ${scheduledCount} buổi trong tuần. Hãy gỡ bớt lịch trước khi đặt mục tiêu ${nextTarget} buổi.`, { issueCode: 'WEEKLY_TARGET_BELOW_SCHEDULED' })
    }
    if (!resetToDefault && targetSessions > Number(targetStudent.maxWeeklySessions || 0)) {
      throw new HttpsError('failed-precondition', `Mục tiêu tuần không thể vượt ${targetStudent.maxWeeklySessions} buổi còn lại theo quota hợp đồng.`, { issueCode: 'WEEKLY_TARGET_EXCEEDS_QUOTA' })
    }
    const reference = weeklyTargetOverrideReference(db, branchId, week)
    const receipt = db.doc(`ptScheduleTargetOverrideReceipts/${commandReceiptId(actor.uid, branchId, week, idempotencyKey)}`)
    const priorReceipt = await receipt.get()
    if (priorReceipt.exists) return priorReceipt.data().result
    const result = await db.runTransaction(async (transaction) => {
      const [current, existingReceipt] = await Promise.all([transaction.get(reference), transaction.get(receipt)])
      if (existingReceipt.exists) return existingReceipt.data().result
      const currentTargets = safeWeeklySessionTargets(current.exists ? current.data()?.targets : {})
      const previousTarget = Object.prototype.hasOwnProperty.call(currentTargets, studentId) ? currentTargets[studentId] : null
      if (resetToDefault) delete currentTargets[studentId]
      else currentTargets[studentId] = targetSessions
      const changed = previousTarget !== (resetToDefault ? null : targetSessions)
      const nextRevision = Number(current.data()?.revision || 0) + (changed ? 1 : 0)
      const result = {
        schemaVersion: 1,
        changed,
        revision: nextRevision,
        targetSessions: nextTarget,
        weeklySessionTargetOverride: resetToDefault ? null : targetSessions,
        weeklySessionTargetOverridden: !resetToDefault,
        draftRevision: Number(data.draft?.revision || 0),
      }
      if (changed) {
        const write = {
          schemaVersion: 1,
          branchId,
          weekId: week,
          targets: currentTargets,
          revision: nextRevision,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        }
        if (current.exists) transaction.update(reference, write)
        else transaction.create(reference, { ...write, createdAt: FieldValue.serverTimestamp() })
        transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
          schemaVersion: 2,
          action: 'pt_schedule.weekly_target_quick_edit',
          actorUid: actor.uid,
          branchId,
          weekId: week,
          studentId,
          previousTarget,
          nextTarget: resetToDefault ? null : targetSessions,
          draftRevision: Number(data.draft?.revision || 0),
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.create(receipt, { actorUid: actor.uid, branchId, weekId: week, studentId, idempotencyKey, result, createdAt: FieldValue.serverTimestamp() })
      return result
    })
    invalidateBranchDataCache(db, branchId, week)
    return result
  })

  const applyPtScheduleDraftCommand = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const expectedRevision = Number(request.data?.expectedDraftRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản draft không hợp lệ.')
    const command = commandInput(request.data?.command)
    const idempotencyKey = typeof request.data?.idempotencyKey === 'string' ? request.data.idempotencyKey.trim() : ''
    if (!/^[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey)) throw new HttpsError('invalid-argument', 'Khóa chống lặp không hợp lệ.')
    const actor = await actorForBranch(request, db, branchId)
    const payload = request.data?.payload && typeof request.data.payload === 'object' ? request.data.payload : {}
    const reference = draftReference(db, branchId, week)
    const receipt = db.doc(`ptScheduleCommandReceipts/${commandReceiptId(actor.uid, branchId, week, idempotencyKey)}`)
    const priorReceipt = await receipt.get()
    if (priorReceipt.exists) return priorReceipt.data().result
    const slotId = typeof payload.slotId === 'string' ? payload.slotId : ''
    const fromSlotId = typeof payload.fromSlotId === 'string' ? payload.fromSlotId : ''
    const slotPattern = /^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/
    const commandWithoutSlot = command === 'set_student_weekly_target' || command === 'reset_draft'
    if (!commandWithoutSlot && !slotPattern.test(slotId)) throw new HttpsError('invalid-argument', 'Ô lịch không hợp lệ.')
    if (command === 'move_student' && !slotPattern.test(fromSlotId)) throw new HttpsError('invalid-argument', 'Ô lịch nguồn không hợp lệ.')
    const trainerId = commandWithoutSlot ? '' : documentId(payload.trainerId, 'Mã PT')
    const fromTrainerId = command === 'move_student' ? documentId(payload.fromTrainerId || trainerId, 'Mã PT nguồn') : trainerId
    const studentId = command.includes('student') || command.includes('entry') ? documentId(payload.studentId, 'Mã học viên') : ''
    // Adding/moving one learner previously scanned the complete branch and all
    // active sessions. Scope the hot path to the selected learner/PT while
    // preserving the same canonical contract, availability and audit checks.
    // Admin manual placement intentionally records conflicts as warnings
    // instead of rejecting the matrix command. Staff keep the guarded path.
    const adminManualOverride = activeAdministrator(actor) && payload.adminOverride === true
    const crossBranchConfirmed = activeAdministrator(actor) && payload.confirmCrossBranchStudent === true
    const fastAdminDraftResult = await applyFastAdminDraftCommand({
      db,
      actor,
      branchId,
      week,
      command,
      payload,
      reason: request.data?.reason,
      expectedRevision,
      receipt,
    })
    if (fastAdminDraftResult) {
      invalidateBranchDataCache(db, branchId, week)
      return fastAdminDraftResult
    }
    const data = command === 'add_student' || command === 'move_student'
      ? await manualData(db, branchId, week, trainerId, studentId, crossBranchConfirmed)
      : await branchData(db, branchId, week)
    data.weekId = week
    if (Number(data.draft.revision) !== expectedRevision) throw new HttpsError('aborted', 'Draft đã thay đổi. Hãy tải lại trước khi chỉnh.')
    if (['add_student', 'move_student', 'set_trainer_off'].includes(command) && slotCalendarDateIsPast(week, slotId) && !adminManualOverride) throw new HttpsError('failed-precondition', 'Ca đã qua ngày. Hãy dùng chức năng điều chỉnh lịch sử có audit.')
    if (command === 'move_student') {
      const source = (data.schedule[fromSlotId] || []).filter((entry) => entry.studentId === studentId && entry.trainerId === fromTrainerId && entry.type !== 'off')
      if (source.length !== 1) throw new HttpsError('failed-precondition', 'Không tìm thấy duy nhất một ca nguồn để chuyển.')
      if (fromSlotId === slotId && fromTrainerId === trainerId) throw new HttpsError('invalid-argument', 'Ca đích trùng ca nguồn.')
    }
    const targetStudent = command === 'set_student_weekly_target'
      ? data.students.find((item) => item.id === studentId)
      : null
    if (command === 'set_student_weekly_target' && !targetStudent) throw new HttpsError('not-found', 'Không tìm thấy học viên trong chi nhánh.')
    const resetWeeklyTarget = command === 'set_student_weekly_target' && payload.resetToDefault === true
    const weeklyTarget = resetWeeklyTarget ? null : Number(payload.targetSessions)
    if (command === 'set_student_weekly_target' && (!resetWeeklyTarget && (!Number.isInteger(weeklyTarget) || weeklyTarget < 0 || weeklyTarget > 7))) {
      throw new HttpsError('invalid-argument', 'Mục tiêu tuần phải từ 0 đến 7 buổi.')
    }
    if (command === 'set_student_weekly_target' && !resetWeeklyTarget && weeklyTarget > targetStudent.maxWeeklySessions) {
      throw new HttpsError('failed-precondition', `Mục tiêu tuần không thể vượt ${targetStudent.maxWeeklySessions} buổi còn lại theo quota hợp đồng.`, { issueCode: 'WEEKLY_TARGET_EXCEEDS_QUOTA' })
    }
    let schedule = safeSchedule(data.schedule)
    let availabilityOverrideMetadata = null
    let selectedManualContractId = ''
    let trainerAssignmentWarningMetadata = null
    let studentBranchWarningMetadata = null
    let adminOverrideMetadataValue = null
    if (command === 'add_student' || command === 'move_student') {
      const trainer = data.trainers.find((item) => item.id === trainerId)
      const student = data.students.find((item) => item.id === studentId)
      if (!trainer || !student) throw new HttpsError('not-found', 'Không tìm thấy PT hoặc học viên trong phạm vi.')
      const candidateSchedule = command === 'move_student'
        ? Object.fromEntries(Object.entries(schedule).map(([key, entries]) => [
          key,
          key === fromSlotId ? entries.filter((entry) => !(entry.studentId === studentId && entry.trainerId === fromTrainerId)) : entries,
        ]))
        : schedule
      const result = manualSlotCandidate(candidateForSlot(data, { student, trainer, slotId, schedule: candidateSchedule }))
      const targetDate = dateForSlot(week, slotId.split('-')[0])
      const entitledContract = requireScheduleContract(data.contracts, studentId, targetDate, result.contractId, adminManualOverride && payload.confirmStudentOff === true)
      const allowAvailabilityOverride = payload.allowOutsideStudentAvailability === true
      if (!adminManualOverride && !result.eligible && !(result.manualSelectable && allowAvailabilityOverride)) {
        throw new HttpsError('failed-precondition', 'Học viên chưa đủ điều kiện vào ô lịch.', { issueCode: 'SLOT_CANDIDATE_REJECTED', errors: result.reasons })
      }
      if (!result.eligible && !adminManualOverride) {
        availabilityOverrideMetadata = {
          availabilityOverride: true,
          availabilityOverrideReason: result.availabilityReason,
          availabilityOverrideBy: actor.uid,
          availabilityOverrideAt: new Date().toISOString(),
        }
      }
      selectedManualContractId = entitledContract.id
      if (result.trainerAssignmentWarning) trainerAssignmentWarningMetadata = { trainerAssignmentWarning: true }
      if (result.studentBranchWarning) {
        if (!crossBranchConfirmed) throw new HttpsError('failed-precondition', 'Học viên thuộc cơ sở khác. Admin cần xác nhận ngoại lệ trước khi xếp tay.', { issueCode: 'STUDENT_BRANCH_CONFIRMATION_REQUIRED' })
        studentBranchWarningMetadata = { studentBranchWarning: true, studentHomeBranchId: student.branchId || '' }
      }
      if (adminManualOverride) {
        const warnings = [...new Set([
          ...(Array.isArray(result.reasons) ? result.reasons : []),
          ...(contractPausedOn(entitledContract, targetDate) ? ['CONTRACT_PAUSED'] : []),
          ...(result.trainerAssignmentWarning ? ['TRAINER_ASSIGNMENT_MISMATCH'] : []),
          ...(result.studentBranchWarning ? ['STUDENT_BRANCH_MISMATCH'] : []),
        ])]
        adminOverrideMetadataValue = {
          ...(contractPausedOn(entitledContract, targetDate) ? { studentOffConfirmedDate: targetDate } : {}),
          adminOverride: true,
          adminOverrideBy: actor.uid,
          adminOverrideAt: new Date().toISOString(),
          ...(warnings.length ? { adminOverrideWarnings: warnings.slice(0, MAX_ADMIN_OVERRIDE_WARNINGS) } : {}),
        }
      }
    }
    const result = await db.runTransaction(async (transaction) => {
      const [current, existingReceipt] = await Promise.all([transaction.get(reference), transaction.get(receipt)])
      if (existingReceipt.exists) return existingReceipt.data().result
      const revision = Number(current.exists ? current.data()?.revision || 0 : data.draft.revision)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Draft đã thay đổi. Hãy tải lại trước khi chỉnh.')
      if (command === 'add_student' || command === 'move_student') {
        const [currentContracts, currentStudent] = await Promise.all([
          transaction.get(db.collection('contracts').where('studentId', '==', studentId).limit(101)),
          transaction.get(db.doc(`students/${studentId}`)),
        ])
        if (currentContracts.size > 100) throw new HttpsError('resource-exhausted', 'Quá nhiều hợp đồng để kiểm tra an toàn.')
        requireCrossBranchConfirmation(currentStudent.data() || {}, branchId, payload)
        const targetDate = dateForSlot(week, slotId.split('-')[0])
        const currentContract = requireScheduleContract(currentContracts.docs.map(item => ({ id: item.id, ...item.data() })), studentId, targetDate, selectedManualContractId, adminManualOverride && payload.confirmStudentOff === true)
        if (currentContract.id !== selectedManualContractId) throw new HttpsError('aborted', 'Hợp đồng vừa thay đổi. Hãy tải lại ô lịch trước khi xếp.')
        if (contractPausedOn(currentContract, targetDate)) {
          adminOverrideMetadataValue.studentOffConfirmedDate = targetDate
          adminOverrideMetadataValue.adminOverrideWarnings = [...new Set([...(adminOverrideMetadataValue.adminOverrideWarnings || []), 'CONTRACT_PAUSED'])]
        }
      }
      schedule = safeSchedule(current.exists ? current.data().schedule : data.schedule)
      // Rehydrate published occupancy after the transaction re-read as well;
      // the draft may have been created before the first merge above.
      mergePublishedSessions({ ...data, weekId: week }, schedule, [])
      let resetRemovedEntries = []
      if (command === 'reset_draft') {
        const previousSchedule = schedule
        schedule = resetDraftSchedule({ ...data, weekId: week }, schedule)
        // Published sessions can still carry a manual source in old drafts.
        // Requeue only bookings actually removed after published rehydration.
        resetRemovedEntries = Object.entries(previousSchedule).flatMap(([key, entries]) => entries.filter((entry) =>
          entry.type !== 'off' && !(schedule[key] || []).some((retained) => retained.type !== 'off'
            && retained.studentId === entry.studentId && retained.trainerId === entry.trainerId)))
      }
      const destructiveSlot = command === 'move_student' ? fromSlotId : slotId
      const destructiveTrainer = command === 'move_student' ? fromTrainerId : trainerId
      if (['move_student', 'remove_student', 'set_trainer_off', 'unlock_entry'].includes(command)) {
        const affected = (schedule[destructiveSlot] || []).filter((entry) => entry.type !== 'off' && entry.trainerId === destructiveTrainer
          && (command === 'set_trainer_off' || entry.studentId === studentId))
        const protectedEntry = affected.find((entry) => entry.source === 'published_existing'
          || entry.isLocked === true && command !== 'unlock_entry'
          || data.sessions.some((session) => session.studentId === entry.studentId && session.trainerId === entry.trainerId
            && publishedSessionSlotId(week, session) === destructiveSlot
            && (session.billingStatus === 'charged' || ['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'].includes(session.status)))
          || slotCalendarDateIsPast(week, destructiveSlot))
        if (protectedEntry) throw new HttpsError('failed-precondition', 'Ca đã khóa, đã publish hoặc đã qua ngày. Hãy mở khóa ca nháp, hoặc dùng luồng điều chỉnh lịch sử cho ca đã publish.', { issueCode: 'PROTECTED_SESSION', studentId: protectedEntry.studentId, trainerId: destructiveTrainer, slotId: destructiveSlot })
      }
      if (command === 'move_student') schedule[fromSlotId] = (schedule[fromSlotId] || []).filter((entry) => !(entry.studentId === studentId && entry.trainerId === fromTrainerId))
      const values = Array.isArray(schedule[slotId]) ? [...schedule[slotId]] : []
      // A scoped add/move only loads one learner. Never filter other learners'
      // weekly overrides using that partial data set.
      const currentWeeklyTargets = safeWeeklySessionTargets(current.exists ? current.data()?.weeklySessionTargets : {})
      if (command === 'set_student_weekly_target') {
        const scheduledCount = Object.values(schedule).flat().filter((entry) => entry.type !== 'off' && entry.studentId === studentId).length
        const nextTarget = resetWeeklyTarget
          ? Math.min(targetStudent.defaultSessionsPerWeek, targetStudent.maxWeeklySessions)
          : weeklyTarget
        if (nextTarget < scheduledCount) {
          throw new HttpsError('failed-precondition', `Học viên đã có ${scheduledCount} buổi trong draft. Hãy gỡ bớt lịch trước khi hạ mục tiêu tuần.`, { issueCode: 'WEEKLY_TARGET_BELOW_SCHEDULED' })
        }
        if (resetWeeklyTarget) delete currentWeeklyTargets[studentId]
        else currentWeeklyTargets[studentId] = weeklyTarget
      }
      if (command === 'add_student') values.push({ studentId, trainerId, branchId, type: 'training', contractId: selectedManualContractId, source: 'manual_v2', ...(trainerAssignmentWarningMetadata || {}), ...(studentBranchWarningMetadata || {}), ...(availabilityOverrideMetadata || {}), ...(adminOverrideMetadataValue || {}) })
      if (command === 'remove_student') schedule[slotId] = values.filter((entry) => !(entry.studentId === studentId && entry.trainerId === trainerId))
      if (command === 'move_student') {
        values.push({ studentId, trainerId, branchId, type: 'training', contractId: selectedManualContractId, source: 'manual_v2', ...(trainerAssignmentWarningMetadata || {}), ...(studentBranchWarningMetadata || {}), ...(availabilityOverrideMetadata || {}), ...(adminOverrideMetadataValue || {}) })
        schedule[slotId] = values
      }
      let requeuedEntries = []
      if (command === 'set_trainer_off') {
        const affected = values.filter((entry) => entry.trainerId === trainerId && entry.type !== 'off')
        if (affected.length && payload.disposition !== 'requeue') throw new HttpsError('failed-precondition', 'Ca đang có học viên. Hãy chọn cách xử lý trước khi cho PT nghỉ.', { issueCode: 'TRAINER_OFF_REQUIRES_DISPOSITION', affectedStudentIds: affected.map((entry) => entry.studentId) })
        requeuedEntries = affected.map((entry) => ({
          ...entry,
          originalSlotId: slotId,
          reason: 'trainer_off',
          queuedAt: new Date().toISOString(),
        }))
        schedule[slotId] = [...values.filter((entry) => entry.trainerId !== trainerId), { studentId: 'OFF', trainerId, branchId, type: 'off', isLocked: true, source: 'manual_v2' }]
      }
      if (command === 'clear_trainer_off') schedule[slotId] = values.filter((entry) => !(entry.trainerId === trainerId && entry.type === 'off'))
      if (command === 'lock_entry' || command === 'unlock_entry') schedule[slotId] = values.map((entry) => entry.studentId === studentId && entry.trainerId === trainerId ? { ...entry, isLocked: command === 'lock_entry' } : entry)
      if (command === 'add_student') schedule[slotId] = values
      for (const [key, entries] of Object.entries(schedule)) if (!entries.length) delete schedule[key]
      if (scheduleEntryCount(schedule) > MAX_DRAFT_ENTRIES || scheduleDocumentEntryCount(schedule) > MAX_DRAFT_DOCUMENT_ENTRIES) {
        throw new HttpsError('resource-exhausted', 'Draft vượt giới hạn an toàn.')
      }
      const nextRevision = revision + 1
      const result = { draftRevision: nextRevision, schedule, weeklySessionTargets: currentWeeklyTargets, warnings: adminOverrideMetadataValue?.adminOverrideWarnings || [] }
      // Generated missing-session diagnostics become stale after any manual
      // mutation. Retain the last blocker diagnostics for unaffected learners;
      // the workspace recomputes each learner's current missing count from the
      // updated schedule, so a learner that is now complete drops out.
      const resetStudentIds = [...new Set(resetRemovedEntries.map((entry) => entry.studentId).filter(Boolean))]
      const resetEntries = command === 'reset_draft'
        ? resetStudentIds.slice(0, MAX_STUDENTS).map((removedStudentId) => ({ studentId: removedStudentId, missingSessions: 1, reasonCodes: ['DRAFT_RESET'], suggestedSlots: [] }))
        : requeuedEntries.slice(-200)
      const selectedTargetSessions = data.students.find((student) => student.id === studentId)?.sessionsPerWeek
      const unassignedEntries = command === 'reset_draft'
        ? resetEntries
        : preserveManualUnassignedEntries(current.data()?.unassignedEntries, schedule, {
          studentId,
          command,
          targetSessions: Number.isInteger(selectedTargetSessions) ? selectedTargetSessions : null,
          extraEntries: requeuedEntries,
        })
      const draftWrite = {
        schemaVersion: 2,
        branchId,
        weekId: week,
        schedule,
        revision: nextRevision,
        status: 'draft',
        unassignedEntries,
        weeklySessionTargets: currentWeeklyTargets,
        expiresAt: draftExpiresAt(week),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        createdAt: current.exists ? current.data().createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      }
      // A nested schedule map must be replaced as one field. `merge:true`
      // keeps removed slot keys in Firestore and can resurrect a deleted row.
      if (current.exists) {
        // Clear optimizer diagnostics only when updating an existing draft.
        // FieldValue.delete() is an update sentinel and Firestore rejects it
        // inside a brand-new document created with transaction.set().
        transaction.update(reference, { ...draftWrite, optimizationSummary: FieldValue.delete() })
      } else {
        transaction.set(reference, draftWrite)
      }
      transaction.create(receipt, { actorUid: actor.uid, branchId, weekId: week, command, idempotencyKey, result, createdAt: FieldValue.serverTimestamp() })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), { schemaVersion: 2, action: `pt_schedule.${command}`, actorUid: actor.uid, branchId, weekId: week, previousDraftRevision: revision, nextDraftRevision: nextRevision, affectedStudentCount: command === 'set_student_weekly_target' ? 1 : command === 'reset_draft' ? resetStudentIds.length : (command === 'add_student' || command === 'move_student') ? 1 : requeuedEntries.length, studentId: command.includes('student') ? studentId : null, weeklyTarget: command === 'set_student_weekly_target' ? (resetWeeklyTarget ? null : weeklyTarget) : null, availabilityOverride: Boolean(availabilityOverrideMetadata), availabilityOverrideReason: availabilityOverrideMetadata?.availabilityOverrideReason || null, adminOverride: Boolean(adminOverrideMetadataValue), adminOverrideWarnings: adminOverrideMetadataValue?.adminOverrideWarnings || [], trainerAssignmentWarning: Boolean(trainerAssignmentWarningMetadata), studentBranchWarning: Boolean(studentBranchWarningMetadata), studentHomeBranchId: studentBranchWarningMetadata?.studentHomeBranchId || null, reason: typeof request.data?.reason === 'string' ? request.data.reason.trim().slice(0, 300) : '', createdAt: FieldValue.serverTimestamp() })
      return result
    })
    invalidateBranchDataCache(db, branchId, week)
    return result
  })

  return { listPtScheduleBranches, getPtScheduleWorkspace, generatePtScheduleDraft, getPtScheduleSlotCandidates, createHistoricalPtSession, savePtStudentAvailability, reopenPtStudentAvailability, setPtStudentWeeklyTarget, applyPtScheduleDraftCommand }
}

module.exports = {
  DEFAULT_DAILY_SESSION_TARGET,
  OPTIMIZER_VERSION,
  MAX_DRAFT_ENTRIES,
  MAX_DRAFT_DOCUMENT_ENTRIES,
  MAX_WEEKLY_COVERAGE_SESSIONS,
  createPtScheduleV2Functions,
  // Reused by the weekly read-model builder. The projection consumes the
  // canonical workspace loader so its freshness/coverage semantics remain
  // identical to the scheduling callables.
  loadBranchData,
  scheduleActor,
  loadManualMutationData,
  candidateForSlot,
  compactPairedSlots,
  createsThreeConsecutiveTrainingDays,
  consecutiveTrainingDayRunCount,
  threeConsecutiveDayAudit,
  generateSchedule,
  historicalSlotCandidate,
  slotCalendarDateIsPast,
  manualSlotCandidate,
  maximumFeasibleSessionsForStudent,
  repairCoverageWithRelocations,
  studentFeasibilityForSchedule,
  resetDraftSchedule,
  previousWeek,
  // Shared by the privileged Admin correction callable. Keeping these
  // helpers here ensures Admin edits use the exact same draft scoping,
  // expiry and input normalization as the regular schedule workspace.
  draftExpiresAt,
  invalidateBranchDataCache,
  scopedDraftData,
  resolveContract,
  safeSchedule,
  safeWeeklySessionTargets,
  slotUtilizationForSchedule,
  studentWeekEligibility,
  trainerProfileForWeek,
  trainerIsLocked,
  trainerLoadsForSchedule,
  trainerSchedulingPolicy,
  scheduleConflictWarningsForWorkspace,
  quickCoverageForDisplay,
  weeklySessionCoverageForStudents,
  weeklyTargetForStudent,
  availabilityCutoff,
  availabilityWindowForWeek,
  availabilityStatusForWeek,
}
