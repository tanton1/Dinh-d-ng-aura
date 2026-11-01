'use strict'

const { createHash } = require('node:crypto')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trainerProfileForWeek, loadTrainerAvailabilityWeeks } = require('./trainer-availability')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const {
  effectiveStudentAvailability,
  loadLatestSubmittedFallbacks,
  normalizeRequestedSessions,
} = require('./student-availability')
const {
  contractSchedulingEntitlement,
  resolveSchedulingContract,
} = require('./contract-scheduling')
const { contractSchedulableOn, contractPausedOn } = require('./contract-status')
const { findScheduleContract, confirmedStudentOff } = require('./schedule-entitlement-policy')

// Keep enough headroom for schedule/version/audit writes in the same atomic
// publish transaction. A paired session still occupies one trainer time slot,
// but each learner session is a separate Firestore write.
const MAX_SCHEDULE_ENTRIES = 440
// OFF markers are operational availability metadata and never create a
// learner session write. Bound them separately so a legitimate week with many
// PT leave markers does not consume the atomic publish budget.
const MAX_DRAFT_DOCUMENT_ENTRIES = 700
const MAX_ENTRIES_PER_SLOT = 100
const MAX_TRANSACTION_WRITES = 450
const ACTIVE_SESSION_STATUSES = new Set(['scheduled', 'rescheduled'])
const DAY_OFFSETS = new Map([['T2', 0], ['T3', 1], ['T4', 2], ['T5', 3], ['T6', 4], ['T7', 5], ['CN', 6]])
const DEFAULT_WORKING_DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const DEFAULT_WORKING_HOURS = [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20]

function scheduleDraftExpiresAt(week) {
  const nextWeekStart = Date.parse(`${nextWeek(week)}T00:00:00+07:00`)
  return Number.isFinite(nextWeekStart)
    ? Timestamp.fromMillis(nextWeekStart + 48 * 60 * 60 * 1000)
    : null
}
const STUDENT_AVAILABILITY_REASON_CODES = new Set(['AVAILABILITY_NOT_SUBMITTED', 'OUTSIDE_STUDENT_AVAILABILITY'])
const MAX_ADMIN_OVERRIDE_WARNINGS = 32

function documentId(value, label) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || !/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function weekId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new HttpsError('invalid-argument', 'Tuần lịch không hợp lệ.')
  const parsed = new Date(`${result}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result || parsed.getUTCDay() !== 1) {
    throw new HttpsError('invalid-argument', 'Tuần lịch phải bắt đầu vào thứ Hai.')
  }
  return result
}

function nextWeek(value) {
  const next = new Date(`${value}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 7)
  return next.toISOString().slice(0, 10)
}

function dateForSlot(week, dayCode) {
  const offset = DAY_OFFSETS.get(dayCode)
  if (typeof offset !== 'number') throw new HttpsError('invalid-argument', 'Ngày trong ô lịch không hợp lệ.')
  const value = new Date(`${week}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}

function slotIdForDateHour(week, date, hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  for (const [day] of DAY_OFFSETS) {
    if (dateForSlot(week, day) === date) return `${day}-${hour}`
  }
  return null
}

function storedDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
}

// Keep publish validation aligned with the scheduling workspace. Legacy
// trainer rows may only have `status`, while Identity v2 can also expose an
// account/operational status or a disabled flag.
function trainerIsLocked(trainer = {}) {
  if (!trainer || trainer.disabled === true) return true
  const lockedStatuses = new Set(['inactive', 'suspended', 'locked', 'disabled', 'archived', 'deleted', 'invited'])
  return [trainer.status, trainer.accessStatus, trainer.operationalStatus, trainer.accountStatus]
    .some((value) => typeof value === 'string' && lockedStatuses.has(value.trim().toLowerCase()))
}

function storedHour(value, sessionId) {
  if (Number.isInteger(value) && value >= 0 && value <= 23) return value
  const parsed = Number(String(sessionId || '').split('-')[1])
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null
}

function isImmutableSession(value = {}) {
  return value.billingStatus === 'charged'
    || ['completed', 'attended', 'no_show'].includes(value.status)
}

function deterministicSessionId(scheduleId, branchId, slotId, studentId) {
  const digest = createHash('sha256').update(`${scheduleId}|${branchId}|${slotId}|${studentId}`).digest('hex').slice(0, 40)
  return `pt_${digest}`
}

// A cancelled session is historical evidence and must never be resurrected in
// place. When an Admin intentionally puts the same learner back into the same
// cell, give the new live session a deterministic id while retaining the old
// document for audit and billing history.
function reintroducedSessionId(baseSessionId, version, ordinal = 0) {
  const digest = createHash('sha256')
    .update(`${baseSessionId}|schedule-reintroduction|${version}|${ordinal}`)
    .digest('hex')
    .slice(0, 40)
  return `pt_${digest}`
}

function entryKey(scheduleId, slotId, studentId) {
  return `${scheduleId}-${slotId}-${studentId}`
}

function normalizedCapacity(value) {
  const result = Number(value)
  return Number.isInteger(result) && result >= 1 && result <= 4 ? result : 2
}

function normalizedScheduleConfig(value = {}) {
  const workingDays = Array.isArray(value.workingDays)
    ? [...new Set(value.workingDays.filter((day) => DAY_OFFSETS.has(day)))]
    : []
  const workingHours = Array.isArray(value.workingHours)
    ? [...new Set(value.workingHours.map(Number).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23))].sort((left, right) => left - right)
    : []
  return {
    ...value,
    workingDays: workingDays.length ? workingDays : DEFAULT_WORKING_DAYS,
    workingHours: workingHours.length ? workingHours : DEFAULT_WORKING_HOURS,
    holidays: Array.isArray(value.holidays)
      ? [...new Set(value.holidays.map(storedDate).filter(Boolean))].sort()
      : [],
    branchCapacityBySlot: value.branchCapacityBySlot && typeof value.branchCapacityBySlot === 'object' && !Array.isArray(value.branchCapacityBySlot)
      ? value.branchCapacityBySlot
      : {},
  }
}

function positiveCapacity(value) {
  const capacity = Number(value)
  return Number.isInteger(capacity) && capacity > 0 && capacity <= 10000 ? capacity : null
}

/**
 * Capacity accepts the current nested shape (`branchId.default`,
 * `branchId.T2-6`) and legacy flat keys (`branchId|T2-6`, `T2-6`). A missing
 * value is intentionally unlimited so enabling this guard cannot close an
 * existing branch before an administrator configures it.
 */
function branchSlotCapacity(config, branchId, slotId) {
  const source = config?.branchCapacityBySlot
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  const branch = source[branchId]
  const candidates = [
    branch && typeof branch === 'object' && !Array.isArray(branch) ? branch[slotId] : null,
    branch && typeof branch === 'object' && !Array.isArray(branch) ? branch.default : null,
    source[`${branchId}|${slotId}`],
    source[slotId],
    source.default,
  ]
  for (const candidate of candidates) {
    const capacity = positiveCapacity(candidate)
    if (capacity !== null) return capacity
  }
  return null
}

function exactAvailabilityReferences(db, studentIds, week) {
  return [...studentIds].map((studentId) => db.doc(`ptAvailability/${studentId}_${week}`))
}

function exactDocumentReferences(db, collectionName, documentIds) {
  return [...documentIds].map((documentId) => db.doc(`${collectionName}/${documentId}`))
}

async function exactDocumentSnapshots(db, collectionName, documentIds) {
  const references = exactDocumentReferences(db, collectionName, documentIds)
  if (!references.length) return []
  const batches = []
  for (let index = 0; index < references.length; index += 100) batches.push(db.getAll(...references.slice(index, index + 100)))
  return (await Promise.all(batches)).flat()
}

async function exactAvailabilitySnapshots(db, studentIds, week) {
  const references = exactAvailabilityReferences(db, studentIds, week)
  if (!references.length) return []
  const batches = []
  for (let index = 0; index < references.length; index += 100) {
    batches.push(db.getAll(...references.slice(index, index + 100)))
  }
  return (await Promise.all(batches)).flat()
}

async function effectiveTrainerAvailabilitySnapshots(db, trainerIds, week) {
  return loadTrainerAvailabilityWeeks(db, [...trainerIds].map((trainerId) => ({ trainerId, weekId: week })))
}

function trainerAvailabilityMode(value = {}) {
  if (value?.availabilityMode === 'unrestricted') return 'unrestricted'
  if (value?.availabilityMode === 'configured') return 'configured'
  if (Array.isArray(value?.availableSlots) && value.availableSlots.length > 0) return 'configured'
  return 'unconfigured'
}

function trainerIsAvailable(value, slotId) {
  const mode = trainerAvailabilityMode(value)
  if (mode === 'unrestricted') return true
  if (mode !== 'configured') return false
  return Array.isArray(value?.availableSlots) && value.availableSlots.includes(slotId)
}

function trainerIsOnLeave(trainerId, date, trainerLeaves = []) {
  return trainerLeaves.some((leave) => {
    if (leave?.trainerId !== trainerId || leave?.status !== 'approved') return false
    const start = storedDate(leave.startDate)
    const end = storedDate(leave.endDate || leave.startDate)
    return Boolean(start && end && date >= start && date <= end)
  })
}

function scheduleError(code, message, details = {}) {
  return new HttpsError('failed-precondition', message, { issueCode: code, ...details })
}

function sameSession(left, right) {
  // A legacy publisher stored the global UI filter value `all` as the
  // physical branch. That row can be the immutable source of truth for a
  // later branch-scoped publish; changing only this marker must not make an
  // already charged session look like an unsafe schedule edit.
  const sameBranch = left.branchId === right.branchId
    || (left.branchId === 'all'
      && isImmutableSession(left)
      && typeof right.branchId === 'string'
      && right.branchId.length > 0)
  return left.studentId === right.studentId
    && left.trainerId === right.trainerId
    && left.contractId === right.contractId
    && sameBranch
    && storedDate(left.date) === right.date
    && storedHour(left.hour, left.id) === right.hour
    && Boolean(left.availabilityOverride) === Boolean(right.availabilityOverride)
    && String(left.availabilityOverrideReason || '') === String(right.availabilityOverrideReason || '')
    && Boolean(left.studentBranchWarning) === Boolean(right.studentBranchWarning)
    && String(left.studentHomeBranchId || '') === String(right.studentHomeBranchId || '')
    && Boolean(left.adminOverride) === Boolean(right.adminOverride)
    && String(left.adminOverrideBy || '') === String(right.adminOverrideBy || '')
    && String(left.studentOffConfirmedDate || '') === String(right.studentOffConfirmedDate || '')
    && JSON.stringify(left.adminOverrideWarnings || []) === JSON.stringify(right.adminOverrideWarnings || [])
}

// Older session writers did not always persist scheduleEntryId/scheduleWeekId.
// The learner/date/hour tuple is still a stable identity for one weekly cell,
// so use it as a migration-safe fallback when reconciling a publish. This is
// deliberately scoped to the selected week before it reaches this helper.
function naturalSessionKey(value = {}) {
  const studentId = typeof value.studentId === 'string' ? value.studentId : ''
  const date = storedDate(value.date)
  const hour = storedHour(value.hour, value.id)
  if (!studentId || !date || !Number.isInteger(hour)) return ''
  return `${studentId}|${date}|${hour}`
}

function manualAvailabilityOverride(entry) {
  const reason = STUDENT_AVAILABILITY_REASON_CODES.has(entry?.availabilityOverrideReason)
    ? entry.availabilityOverrideReason
    : ''
  if (entry?.type === 'off' || entry?.source !== 'manual_v2' || entry?.availabilityOverride !== true || !reason) return null
  return {
    source: 'manual_v2',
    availabilityOverride: true,
    availabilityOverrideReason: reason,
    availabilityOverrideBy: typeof entry?.availabilityOverrideBy === 'string' ? entry.availabilityOverrideBy.slice(0, 200) : '',
    availabilityOverrideAt: typeof entry?.availabilityOverrideAt === 'string' ? entry.availabilityOverrideAt.slice(0, 40) : '',
  }
}

function rawEntryBranch(entry, students, trainers) {
  if (!entry || typeof entry !== 'object') return ''
  // `all` was a UI filter value in the legacy schedule editor, not a real
  // operational branch. Treat it as absent so the canonical PT branch (or
  // the learner's home branch when no PT is available) can be resolved.
  const explicitBranchId = entry.branchId && entry.branchId !== 'all' ? entry.branchId : ''
  return explicitBranchId
    || trainers.get(entry.trainerId)?.branchId
    || students.get(entry.studentId)?.branchId
    || ''
}

function indexExistingPublishSessions(existingScoped = [], preferredBranchId = '') {
  const existingByEntry = new Map()
  const existingByNatural = new Map()
  const cancelledByEntry = new Map()
  const duplicates = []
  const duplicateIds = new Set()

  const createdMillis = (item) => {
    const value = item?.data?.() || {}
    const timestamp = value.createdAt?.toMillis?.() || (typeof value.createdAt === 'string' ? Date.parse(value.createdAt) : NaN)
    if (Number.isFinite(timestamp)) return timestamp
    const documentTime = item?.createTime?.toMillis?.() || (typeof item?.createTime === 'string' ? Date.parse(item.createTime) : NaN)
    return Number.isFinite(documentTime) ? documentTime : Number.MAX_SAFE_INTEGER
  }
  const priority = (item) => {
    const value = item?.data?.() || {}
    // A legacy `all` row is the source record that the new branch-scoped
    // writer must reconcile in place. Prefer it over the duplicate branch row
    // so the original session id and history remain intact.
    const legacyBranch = value.branchId === 'all' ? 0 : value.branchId === preferredBranchId ? 1 : 2
    const immutable = isImmutableSession(value) ? 0 : 1
    return [legacyBranch, createdMillis(item), immutable, String(item?.id || '')]
  }
  const before = (left, right) => {
    const a = priority(left)
    const b = priority(right)
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] < b[index]) return left
      if (a[index] > b[index]) return right
    }
    return left
  }
  const recordDuplicate = (item) => {
    if (!item || duplicateIds.has(item.id)) return
    duplicateIds.add(item.id)
    duplicates.push(item)
  }
  const addCandidate = (map, key, item) => {
    if (!key) return
    const current = map.get(key)
    if (!current) {
      map.set(key, item)
      return
    }
    if (current.id === item.id) return
    const canonical = before(current, item)
    const duplicate = canonical.id === current.id ? item : current
    map.set(key, canonical)
    recordDuplicate(duplicate)
  }

  for (const item of existingScoped) {
    const value = item.data() || {}
    const key = value.scheduleEntryId
    // Multiple cancelled rows for one schedule cell are valid history after an
    // Admin removes and later re-adds a learner. Only one active/immutable row
    // may own the key at a time.
    if (!ACTIVE_SESSION_STATUSES.has(String(value.status || '').toLowerCase()) && !isImmutableSession(value)) {
      if (!key) continue
      const history = cancelledByEntry.get(key) || []
      history.push(item)
      cancelledByEntry.set(key, history)
      continue
    }
    addCandidate(existingByEntry, key, item)
    addCandidate(existingByNatural, naturalSessionKey({ id: item.id, ...value }), item)
  }
  return { existingByEntry, existingByNatural, cancelledByEntry, duplicates }
}

function planPublishedSessions({ desired, existingByEntry, existingByNatural, cancelledByEntry, adminPublishWarningMode, nextVersion }) {
  const creates = []
  const updates = []
  const unchanged = []
  const publishedEntries = []
  const reintroducedSessions = []
  const claimedExistingIds = new Set()
  for (const [key, original] of desired) {
    const natural = naturalSessionKey(original)
    const existing = existingByEntry.get(key)
      || (existingByNatural?.get(natural) && !claimedExistingIds.has(existingByNatural.get(natural).id) ? existingByNatural.get(natural) : null)
    if (!existing) {
      const cancelledHistory = cancelledByEntry.get(key) || []
      if (cancelledHistory.length) {
        if (!adminPublishWarningMode) throw scheduleError('CANCELLED_SESSION_REINTRODUCED', 'Một ô lịch đã hủy đang được thêm lại. Hãy tạo yêu cầu điều chỉnh riêng.')
        const previous = cancelledHistory[cancelledHistory.length - 1]
        const effective = {
          ...original,
          id: reintroducedSessionId(original.id, nextVersion, cancelledHistory.length),
          reintroducedFromSessionId: previous.id,
          reintroducedAtVersion: nextVersion,
        }
        creates.push(effective)
        publishedEntries.push(effective)
        reintroducedSessions.push({ key, previous, next: effective })
        continue
      }
      creates.push(original)
      publishedEntries.push(original)
      continue
    }
    claimedExistingIds.add(existing.id)
    const effective = { ...original, id: existing.id }
    if (isImmutableSession(existing.data())) {
      if (!sameSession({ id: existing.id, ...existing.data() }, original)) throw scheduleError('CHARGED_SESSION_IMMUTABLE', 'Lịch nháp đang thay đổi một buổi đã được tính hoặc xác nhận.')
      unchanged.push(existing)
    } else if (sameSession({ id: existing.id, ...existing.data() }, original)) unchanged.push(existing)
    else updates.push({ existing, desired: effective })
    publishedEntries.push(effective)
  }
  return { creates, updates, unchanged, publishedEntries, reintroducedSessions }
}

function branchScheduleSnapshot(schedule, branchId, students, trainers) {
  const result = {}
  for (const [slotId, entries] of Object.entries(schedule || {})) {
    if (!Array.isArray(entries)) continue
    const scoped = entries
      .filter((entry) => rawEntryBranch(entry, students, trainers) === branchId)
      .map((entry) => ({
        studentId: entry.studentId,
        trainerId: entry.trainerId,
        branchId,
        type: entry.type === 'off' ? 'off' : 'training',
        ...(entry.contractId ? { contractId: entry.contractId } : {}),
        ...(entry.isLocked === true ? { isLocked: true } : {}),
        ...(entry.trainerAssignmentWarning === true ? { trainerAssignmentWarning: true } : {}),
        ...(entry.studentBranchWarning === true ? {
          studentBranchWarning: true,
          studentHomeBranchId: typeof entry.studentHomeBranchId === 'string' ? entry.studentHomeBranchId.slice(0, 200) : '',
        } : {}),
        ...(entry.adminOverride === true ? {
          adminOverride: true,
          adminOverrideBy: typeof entry.adminOverrideBy === 'string' ? entry.adminOverrideBy.slice(0, 200) : '',
          adminOverrideAt: typeof entry.adminOverrideAt === 'string' ? entry.adminOverrideAt.slice(0, 40) : '',
          ...(confirmedStudentOff(entry) ? { studentOffConfirmedDate: entry.studentOffConfirmedDate } : {}),
          ...(Array.isArray(entry.adminOverrideWarnings) ? { adminOverrideWarnings: [...new Set(entry.adminOverrideWarnings.filter((value) => typeof value === 'string').slice(0, MAX_ADMIN_OVERRIDE_WARNINGS))] } : {}),
        } : {}),
        ...(typeof entry.source === 'string' && entry.source ? { source: entry.source.slice(0, 40) } : {}),
        ...(manualAvailabilityOverride(entry) || {}),
      }))
    if (scoped.length) result[slotId] = scoped
  }
  return result
}

function legacyBranchScheduleFromSessions(entries, branchId) {
  const result = {}
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.branchId !== branchId || typeof entry.slotId !== 'string') continue
    if (!Array.isArray(result[entry.slotId])) result[entry.slotId] = []
    result[entry.slotId].push({
      studentId: entry.studentId,
      trainerId: entry.trainerId,
      branchId,
      type: 'training',
      isLocked: true,
    })
  }
  return result
}

function mergeRestoredBranchSchedule(currentSchedule, restoredBranchSchedule, branchId, students, trainers) {
  const result = {}
  const slotIds = new Set([
    ...Object.keys(currentSchedule || {}),
    ...Object.keys(restoredBranchSchedule || {}),
  ])
  for (const slotId of slotIds) {
    const retained = Array.isArray(currentSchedule?.[slotId])
      ? currentSchedule[slotId].filter((entry) => rawEntryBranch(entry, students, trainers) !== branchId)
      : []
    const restored = Array.isArray(restoredBranchSchedule?.[slotId])
      ? restoredBranchSchedule[slotId]
      : []
    if (retained.length || restored.length) result[slotId] = [...retained, ...restored]
  }
  return result
}

function isoTimestamp(value) {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : null
}

function normalizedDraftSchedule(value, branchId, allowManualAvailabilityOverrides = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'Nội dung lịch nháp không hợp lệ.')
  }
  const result = {}
  let documentEntryCount = 0
  let trainingEntryCount = 0
  for (const [slotId, rawEntries] of Object.entries(value)) {
    if (!/^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/.test(slotId) || !Array.isArray(rawEntries)) {
      throw new HttpsError('invalid-argument', 'Lịch có khung giờ không hợp lệ.')
    }
    if (rawEntries.length > MAX_ENTRIES_PER_SLOT) throw new HttpsError('invalid-argument', 'Một khung giờ có quá nhiều dữ liệu.')
    const entries = rawEntries.map((entry) => {
      const trainerId = documentId(entry?.trainerId, 'Mã PT')
      const type = entry?.type === 'off' ? 'off' : 'training'
      const studentId = type === 'off' ? 'OFF' : documentId(entry?.studentId, 'Mã học viên')
      const normalized = {
        studentId,
        trainerId,
        branchId,
        type,
        ...(entry?.contractId ? { contractId: documentId(entry.contractId, 'Mã hợp đồng') } : {}),
        ...(entry?.isLocked === true ? { isLocked: true } : {}),
        ...(entry?.trainerAssignmentWarning === true ? { trainerAssignmentWarning: true } : {}),
        ...(allowManualAvailabilityOverrides && entry?.studentBranchWarning === true ? {
          studentBranchWarning: true,
          studentHomeBranchId: typeof entry.studentHomeBranchId === 'string' ? entry.studentHomeBranchId.slice(0, 200) : '',
        } : {}),
        ...(allowManualAvailabilityOverrides && entry?.adminOverride === true ? {
          adminOverride: true,
          adminOverrideBy: typeof entry.adminOverrideBy === 'string' ? entry.adminOverrideBy.slice(0, 200) : '',
          adminOverrideAt: typeof entry.adminOverrideAt === 'string' ? entry.adminOverrideAt.slice(0, 40) : '',
          ...(confirmedStudentOff(entry) ? { studentOffConfirmedDate: entry.studentOffConfirmedDate } : {}),
          ...(Array.isArray(entry.adminOverrideWarnings) ? {
            adminOverrideWarnings: [...new Set(entry.adminOverrideWarnings.filter((value) => typeof value === 'string').slice(0, MAX_ADMIN_OVERRIDE_WARNINGS))],
          } : {}),
        } : {}),
        ...(typeof entry?.source === 'string' && entry.source ? { source: entry.source.slice(0, 40) } : {}),
      }
      return allowManualAvailabilityOverrides
        ? { ...normalized, ...(manualAvailabilityOverride(entry) || {}) }
        : normalized
    })
    documentEntryCount += entries.length
    trainingEntryCount += entries.filter((entry) => entry.type !== 'off').length
    if (entries.length) result[slotId] = entries
  }
  if (documentEntryCount > MAX_DRAFT_DOCUMENT_ENTRIES || trainingEntryCount > MAX_SCHEDULE_ENTRIES) {
    throw new HttpsError('invalid-argument', 'Lịch nháp vượt giới hạn an toàn.')
  }
  return result
}

async function publisherActor(request, db, branchId) {
  const actor = await trustedAccessContext(request, db)
  if (['admin', 'super_admin'].includes(actor.accessRole)) {
    requireCapability(actor, 'pt.operations.manage')
    return actor
  }
  requireCapability(actor, 'pt.schedule.branch.publish')
  if (!actor.branchIds.includes(branchId)) throw new HttpsError('permission-denied', 'Bạn không được publish lịch của chi nhánh này.')
  return actor
}

function desiredEntries({ scheduleId, week, branchId, schedule, trainers, students, contracts, availability, inheritedAvailability = new Map(), config, trainerLeaves = [], activeSessions = [], allowAdminOverrides = false, allowPublishWarnings = false }) {
  const calendar = normalizedScheduleConfig(config)
  const desired = new Map()
  const errors = []
  const errorDetails = []
  let context = {}
  const addError = (code) => { errors.push(code); if (errorDetails.length < 100) errorDetails.push({ code, ...context }) }
  const warnings = []
  const warningDetails = []
  const addWarning = (code, detail = {}) => {
    warnings.push(code)
    if (warningDetails.length < 100) warningDetails.push({ code, ...context, ...detail })
  }
  // A confirmed Admin publish is allowed to carry operational exceptions
  // forward.  Keep malformed rows and immutable session checks outside this
  // mode, but turn scheduling-policy conflicts into auditable warnings.
  const adminPublishWarningMode = allowPublishWarnings === true
  const operationalIssue = (code, detail = {}) => {
    if (adminPublishWarningMode) addWarning(code, detail)
    else addError(code)
  }
  const studentDays = new Set()
  const studentSessions = new Map()
  const trainerSlots = new Map()
  const branchSlots = new Map()
  const offSlots = new Set()
  const workingDays = new Set(calendar.workingDays)
  const workingHours = new Set(calendar.workingHours)
  const holidays = new Set(calendar.holidays)
  const reservationsByContract = new Map()
  const adminOverrideTrainerSlots = new Set()
  const adminOverrideBranchSlots = new Set()
  const adminOverrideStudents = new Set()
  for (const session of activeSessions) {
    if (!session?.contractId || !ACTIVE_SESSION_STATUSES.has(String(session.status || '').toLowerCase()) || session.billingStatus === 'charged') continue
    // Sessions published from this branch/week are represented by the draft
    // being validated, so counting them here would reserve the same right
    // twice. Other weeks/branches remain real external reservations.
    const sessionDate = storedDate(session.date)
    const belongsToCurrentDraft = (session.branchId === branchId || session.branchId === 'all')
      && (session.scheduleWeekId === week
        || String(session.scheduleEntryId || '').startsWith(`${scheduleId}-`)
        || (session.branchId === 'all' && sessionDate >= week && sessionDate < nextWeek(week)))
    if (!belongsToCurrentDraft) reservationsByContract.set(session.contractId, (reservationsByContract.get(session.contractId) || 0) + 1)
  }

  const orderedSchedule = Object.entries(schedule || {}).sort(([left], [right]) => {
    const [leftDay, leftHour] = left.split('-')
    const [rightDay, rightHour] = right.split('-')
    return (DAY_OFFSETS.get(leftDay) ?? 99) - (DAY_OFFSETS.get(rightDay) ?? 99)
      || Number(leftHour) - Number(rightHour)
  })
  for (const [slotId, rawEntries] of orderedSchedule) {
    context = { slotId }
    if (!Array.isArray(rawEntries)) continue
    const match = /^(T[2-7]|CN)-(\d{1,2})$/.exec(slotId)
    if (!match) {
      addError('INVALID_SLOT')
      continue
    }
    const day = match[1]
    const hour = Number(match[2])
    const date = dateForSlot(week, day)
    const outsideWorkingCalendar = !workingDays.has(day) || (workingHours.size && !workingHours.has(hour)) || holidays.has(date)
    if (outsideWorkingCalendar && rawEntries.some((entry) => entry?.branchId === branchId)) {
      if (adminPublishWarningMode || rawEntries.some((entry) => allowAdminOverrides && entry?.source === 'manual_v2' && entry?.adminOverride === true)) addWarning('OUTSIDE_WORKING_CALENDAR')
      else addError('OUTSIDE_WORKING_CALENDAR')
    }
    for (const raw of rawEntries) {
      if (!raw) continue
      context = { slotId, date, hour, studentId: raw.studentId || null, studentName: students.get(raw.studentId)?.name || null, trainerId: raw.trainerId || null, trainerName: trainers.get(raw.trainerId)?.name || null }
      let trainerId
      try {
        trainerId = documentId(raw.trainerId, 'Mã PT')
      } catch {
        addError('TRAINER_REQUIRED')
        continue
      }
      const trainerSlot = `${date}|${hour}|${trainerId}`
      const trainer = trainers.get(trainerId)
      if (raw.type === 'off') {
        const offBranchId = raw.branchId && raw.branchId !== 'all' ? raw.branchId : trainer?.branchId
        if (offBranchId !== branchId) continue
        if (!trainer || trainerIsLocked(trainer)) addError('TRAINER_NOT_ACTIVE')
        offSlots.add(trainerSlot)
        continue
      }
      let studentId
      try {
        studentId = documentId(raw.studentId, 'Mã học viên')
      } catch {
        addError('STUDENT_REQUIRED')
        continue
      }
      const student = students.get(studentId)
      const manualAdminOverride = allowAdminOverrides && raw.adminOverride === true
        && (raw.source === 'manual_v2' || raw.source === 'published_existing' && confirmedStudentOff(raw))
      // Keep the entry-level marker for an explicitly audited manual row.
      // Admin publish mode is a publish-level acknowledgement and must not
      // mark every otherwise valid session as “Admin xếp tay”.
      const adminOverride = manualAdminOverride
      const policyOverride = adminPublishWarningMode || adminOverride
      const adminOverrideWarnings = Array.isArray(raw.adminOverrideWarnings)
        ? [...new Set(raw.adminOverrideWarnings.filter((value) => typeof value === 'string').slice(0, MAX_ADMIN_OVERRIDE_WARNINGS))]
        : []
      if (adminOverride) {
        adminOverrideTrainerSlots.add(trainerSlot)
        adminOverrideBranchSlots.add(slotId)
        adminOverrideStudents.add(studentId)
        addWarning('ADMIN_MANUAL_OVERRIDE', { overrideWarnings: adminOverrideWarnings })
        adminOverrideWarnings.forEach((code) => addWarning(code))
      }
      // Old generated entries did not persist branchId. Resolve that legacy
      // omission only from canonical member/PT data; never treat the UI filter
      // value "all" as a writable branch identifier.
      const resolvedEntryBranchId = (raw.branchId && raw.branchId !== 'all' ? raw.branchId : '')
        || branchId || student?.branchId || trainer?.branchId
      // An explicit branch on the schedule is the physical training site and
      // scopes the publish. A learner's profile branch may differ; that is a
      // visible warning, not a publish blocker.
      if (raw.branchId && raw.branchId !== 'all' && raw.branchId !== branchId) {
        if (policyOverride) addWarning('TRAINER_BRANCH_MISMATCH')
        else continue
      }
      // Keep PT scope strict: a branch manager must not publish a PT from a
      // different operational branch through this branch's schedule.
      if (trainer?.branchId && trainer.branchId !== branchId) {
        if (policyOverride) addWarning('TRAINER_BRANCH_MISMATCH')
        else continue
      }
      if (!resolvedEntryBranchId) {
        addError('ENTRY_BRANCH_REQUIRED')
        continue
      }
      if (!trainer || trainerIsLocked(trainer)) {
        if (policyOverride) addWarning('TRAINER_NOT_ACTIVE')
        else addError('TRAINER_NOT_ACTIVE')
      }
      if (!student || student.status === 'inactive') {
        if (policyOverride) addWarning('STUDENT_NOT_ACTIVE')
        else addError('STUDENT_NOT_ACTIVE')
      }
      if (student?.branchId && student.branchId !== branchId) addWarning('STUDENT_BRANCH_MISMATCH', {
        studentHomeBranchId: student.branchId,
        targetBranchId: branchId,
      })
      const availabilityMode = trainerAvailabilityMode(trainer)
      if (trainer?.employmentType === 'collaborator') {
        if (!Array.isArray(trainer.availableSlots) || !trainer.availableSlots.length) policyOverride ? addWarning('TRAINER_AVAILABILITY_UNCONFIGURED') : operationalIssue('TRAINER_AVAILABILITY_UNCONFIGURED')
        else if (!trainer.availableSlots.includes(slotId)) policyOverride ? addWarning('OUTSIDE_TRAINER_AVAILABILITY') : operationalIssue('OUTSIDE_TRAINER_AVAILABILITY')
      } else if (availabilityMode === 'unconfigured') policyOverride ? addWarning('TRAINER_AVAILABILITY_UNCONFIGURED') : operationalIssue('TRAINER_AVAILABILITY_UNCONFIGURED')
      else if (!trainerIsAvailable(trainer, slotId)) policyOverride ? addWarning('OUTSIDE_TRAINER_AVAILABILITY') : operationalIssue('OUTSIDE_TRAINER_AVAILABILITY')
      if (trainerIsOnLeave(trainerId, date, trainerLeaves)) policyOverride ? addWarning('TRAINER_ON_LEAVE') : operationalIssue('TRAINER_ON_LEAVE')

      const studentDay = `${studentId}|${date}`
      if (studentDays.has(studentDay)) policyOverride ? addWarning('STUDENT_MULTIPLE_SESSIONS_PER_DAY') : operationalIssue('STUDENT_MULTIPLE_SESSIONS_PER_DAY')
      studentDays.add(studentDay)
      studentSessions.set(studentId, (studentSessions.get(studentId) || 0) + 1)
      trainerSlots.set(trainerSlot, (trainerSlots.get(trainerSlot) || 0) + 1)
      branchSlots.set(slotId, (branchSlots.get(slotId) || 0) + 1)

      const effectiveAvailability = effectiveStudentAvailability({
        targetWeek: week,
        exact: availability.get(studentId),
        inherited: inheritedAvailability.get(studentId),
        profile: student,
      })
      const slots = new Set(effectiveAvailability.slots)
      const override = manualAvailabilityOverride(raw)
      let availabilityIssue = null
      if (!effectiveAvailability.confirmed) availabilityIssue = 'AVAILABILITY_NOT_SUBMITTED'
      else if (!slots.has(slotId)) availabilityIssue = 'OUTSIDE_STUDENT_AVAILABILITY'
      if (availabilityIssue && (override || policyOverride)) addWarning(policyOverride ? availabilityIssue : 'MANUAL_STUDENT_AVAILABILITY_OVERRIDE')
      else if (availabilityIssue) operationalIssue(availabilityIssue)
      if (effectiveAvailability.source === 'inherited_weekly') addWarning('INHERITED_AVAILABILITY_FALLBACK')
      if (effectiveAvailability.source === 'legacy_default') addWarning('LEGACY_AVAILABILITY_FALLBACK')

      const confirmedCrossBranch = (adminPublishWarningMode || raw.source === 'manual_v2')
        && (adminPublishWarningMode || raw.studentBranchWarning === true)
        && Boolean(raw.contractId || adminPublishWarningMode)
        && Boolean(student?.branchId)
        && student.branchId !== branchId
        && (adminPublishWarningMode || raw.studentHomeBranchId === student.branchId)
      const contractResolution = resolveSchedulingContract({
        contracts,
        studentId,
        branchId: confirmedCrossBranch ? student.branchId : branchId,
        date,
        reservationsByContract,
      })
      const confirmedOffContract = manualAdminOverride && confirmedStudentOff(raw, date)
        ? findScheduleContract(contracts, studentId, date, raw.contractId, true) : null
      if (!contractResolution.contract) {
        const dateEntitled = contracts.some(item => item.studentId === studentId && contractSchedulableOn(item, date))
        if (!dateEntitled && !confirmedOffContract) {
          contractResolution.reasons.forEach(addError)
          continue
        }
        if (!policyOverride) {
          contractResolution.reasons.forEach(operationalIssue)
          continue
        }
        contractResolution.reasons.forEach(addWarning)
      }
      // Approved OFF is permitted only on the individually confirmed Admin
      // row. A blanket publish acknowledgement cannot override entitlement.
      const fallbackContract = contracts
        .filter((item) => item.studentId === studentId && contractSchedulableOn(item, date))
        .sort((left, right) => String(right.startDate || '').localeCompare(String(left.startDate || ''))
          || String(right.endDate || '').localeCompare(String(left.endDate || ''))
          || String(left.id || '').localeCompare(String(right.id || '')))[0]
      const contract = contractResolution.contract
        || confirmedOffContract
        || fallbackContract
        || { id: '', trainerId: '', trainerIds: [], pausePeriods: [] }
      const assignedTrainerIds = [...new Set([
        contract?.trainerId,
        ...(Array.isArray(contract?.trainerIds) ? contract.trainerIds : []),
      ].filter(Boolean))]
      const trainerAssignmentWarning = assignedTrainerIds.length > 0 && !assignedTrainerIds.includes(trainerId)
      if (trainerAssignmentWarning) addWarning('TRAINER_ASSIGNMENT_MISMATCH')
      if (contractPausedOn(contract, date)) {
        if (confirmedOffContract) addWarning('CONTRACT_PAUSED')
        else {
          operationalIssue('CONTRACT_PAUSED')
          continue
        }
      }
      const key = entryKey(scheduleId, slotId, studentId)
      if (desired.has(key)) {
        if (policyOverride) addWarning('DUPLICATE_SCHEDULE_ENTRY')
        else operationalIssue('DUPLICATE_SCHEDULE_ENTRY')
        continue
      }
      desired.set(key, {
        id: deterministicSessionId(scheduleId, branchId, slotId, studentId),
        scheduleEntryId: key,
        scheduleWeekId: week,
        slotId,
        studentId,
        trainerId,
        contractId: contract.id,
        branchId,
        date,
        hour,
        status: 'scheduled',
        scheduleStatus: 'scheduled',
        billingStatus: 'pending',
        attendanceStatus: 'pending',
        ...(adminOverride ? {
          adminOverride: true,
          adminOverrideBy: typeof raw.adminOverrideBy === 'string' ? raw.adminOverrideBy.slice(0, 200) : '',
          adminOverrideAt: typeof raw.adminOverrideAt === 'string' ? raw.adminOverrideAt.slice(0, 40) : '',
          ...(confirmedStudentOff(raw, date) ? { studentOffConfirmedDate: date } : {}),
          ...(adminOverrideWarnings.length ? { adminOverrideWarnings } : {}),
        } : {}),
        ...(contractResolution.earlyHandover ? {
          renewalHandoverPending: true,
          sourceContractId: contractResolution.sourceContractId,
        } : {}),
        ...(trainerAssignmentWarning ? { trainerAssignmentWarning: true } : {}),
        ...(confirmedCrossBranch ? { studentBranchWarning: true, studentHomeBranchId: student.branchId } : {}),
        ...(override || {}),
      })
      reservationsByContract.set(contract.id, (reservationsByContract.get(contract.id) || 0) + 1)
    }
  }

  for (const [key, count] of trainerSlots) {
    const trainerId = key.split('|').at(-1)
    const [date, hour] = key.split('|')
    context = { date, hour: Number(hour), slotId: slotIdForDateHour(week, date, Number(hour)), trainerId, trainerName: trainers.get(trainerId)?.name || null }
    if (offSlots.has(key)) adminOverrideTrainerSlots.has(key) ? addWarning('TRAINER_OFF_CONFLICT') : operationalIssue('TRAINER_OFF_CONFLICT')
    if (count > normalizedCapacity(trainers.get(trainerId)?.slotCapacity)) adminOverrideTrainerSlots.has(key) ? addWarning('TRAINER_CAPACITY_EXCEEDED') : operationalIssue('TRAINER_CAPACITY_EXCEEDED')
  }
  for (const [slotId, count] of branchSlots) {
    context = { slotId }
    const capacity = branchSlotCapacity(calendar, branchId, slotId)
    if (capacity !== null && count > capacity) adminOverrideBranchSlots.has(slotId) ? addWarning('BRANCH_CAPACITY_REACHED') : operationalIssue('BRANCH_CAPACITY_REACHED')
  }
  for (const [studentId, count] of studentSessions) {
    context = { studentId, studentName: students.get(studentId)?.name || null }
    const target = Number(students.get(studentId)?.sessionsPerWeek)
    if (Number.isInteger(target) && target >= 0 && count > target) adminOverrideStudents.has(studentId) ? addWarning('STUDENT_WEEKLY_TARGET_REACHED') : operationalIssue('STUDENT_WEEKLY_TARGET_REACHED')
  }
  if (desired.size > MAX_SCHEDULE_ENTRIES) addError('SCHEDULE_TOO_LARGE')
  return { desired, errorDetails, errors: [...new Set(errors)], warnings: [...new Set(warnings)], warningDetails }
}

function createPtSchedulePublishFunctions({ db, onCall, onScheduleMutation = () => {} }) {
  async function execute(request, validateOnly) {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const expectedDraftRevision = Number(request.data?.expectedDraftRevision)
    if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản lịch nháp không hợp lệ.')
    const actor = await publisherActor(request, db, branchId)
    // Admins may explicitly publish a draft that contains operational policy
    // conflicts. The validator still rejects malformed rows and immutable
    // session changes; eligible conflicts are returned as auditable warnings.
    const adminPublishWarningMode = ['admin', 'super_admin'].includes(actor.accessRole)
    const scheduleId = `schedule_${week}`
    const scheduleReference = db.doc(`schedules/${scheduleId}`)
    const v2DraftReference = db.doc(`ptScheduleDrafts/${branchId}_${week}`)
    const weeklyTargetOverrideReference = db.doc(`ptScheduleTargetOverrides/${branchId}_${week}`)
    const branchReference = db.doc(`branches/${branchId}`)
    const [preliminarySchedule, preliminaryDraft, preliminaryTargetOverrides] = await Promise.all([
      scheduleReference.get(),
      v2DraftReference.get(),
      weeklyTargetOverrideReference.get(),
    ])
    const hasPreliminaryTargetOverrides = preliminaryTargetOverrides.exists
      && preliminaryTargetOverrides.data()?.targets
      && typeof preliminaryTargetOverrides.data().targets === 'object'
      && !Array.isArray(preliminaryTargetOverrides.data().targets)
      && Object.keys(preliminaryTargetOverrides.data().targets).length > 0
    const preliminaryData = preliminaryDraft.exists ? preliminaryDraft.data() : preliminarySchedule.data() || {}
    const preliminaryTrainingEntries = Object.values(preliminaryData.schedule || {}).flat()
      .filter((entry) => entry?.type !== 'off' && entry?.studentId)
    if (preliminaryTrainingEntries.length > MAX_SCHEDULE_ENTRIES) {
      throw new HttpsError('resource-exhausted', 'Dữ liệu lịch vượt giới hạn kiểm tra an toàn.')
    }
    const scheduledStudentIds = new Set(preliminaryTrainingEntries
      .map((entry) => entry.studentId))
    const scheduledContractIds = new Set(preliminaryTrainingEntries
      .map((entry) => entry.contractId)
      .filter((contractId) => typeof contractId === 'string' && contractId))
    const preliminaryStudents = await exactDocumentSnapshots(db, 'students', scheduledStudentIds)
    const preliminaryProfiles = new Map(preliminaryStudents
      .filter((item) => item.exists)
      .map((item) => [item.id, item.data()]))
    const crossBranchStudentIds = new Set([...scheduledStudentIds]
      .filter((studentId) => preliminaryProfiles.get(studentId)?.branchId
        && preliminaryProfiles.get(studentId).branchId !== branchId))
    const preliminaryAvailability = await exactAvailabilitySnapshots(db, scheduledStudentIds, week)
    const preliminaryWeekly = new Map(preliminaryAvailability
      .filter((item) => item.exists)
      .map((item) => item.data())
      .filter((item) => scheduledStudentIds.has(item.studentId))
      .map((item) => [item.studentId, item]))
    const inheritedAvailability = await loadLatestSubmittedFallbacks(db, preliminaryProfiles, preliminaryWeekly, week)
    const availabilityReferences = exactAvailabilityReferences(db, scheduledStudentIds, week)
    const scheduledStudentReferences = exactDocumentReferences(db, 'students', scheduledStudentIds)
    const scheduledContractReferences = exactDocumentReferences(db, 'contracts', scheduledContractIds)
    const crossBranchSessionQueries = [...crossBranchStudentIds].map((studentId) => db.collection('sessions')
      .where('studentId', '==', studentId)
      .limit(1001))

    const result = await db.runTransaction(async (transaction) => {
      const [scheduleSnapshot, v2DraftSnapshot, targetOverrideSnapshot, branchSnapshot, contractsSnapshot, studentsSnapshot, trainersSnapshot, weekSessionsSnapshot, legacyWeekSessionsSnapshot, activeSessionsSnapshot, legacyActiveSessionsSnapshot, configSnapshot, trainerLeavesSnapshot, availabilitySnapshots, exactStudentSnapshots, exactContractSnapshots, crossBranchSessionSnapshots] = await Promise.all([
        transaction.get(scheduleReference),
        transaction.get(v2DraftReference),
        transaction.get(weeklyTargetOverrideReference),
        transaction.get(branchReference),
        transaction.get(db.collection('contracts').where('branchId', '==', branchId).limit(1001)),
        transaction.get(db.collection('students').where('branchId', '==', branchId).limit(501)),
        transaction.get(db.collection('trainers').where('branchId', '==', branchId).limit(101)),
        transaction.get(db.collection('sessions').where('branchId', '==', branchId).where('date', '>=', week).where('date', '<', nextWeek(week)).limit(1001)),
        // Legacy publishers used the UI filter value "all" as the stored
        // branch. Include those rows so a publish reconciles the original
        // session in place instead of creating a second branch-scoped row.
        transaction.get(db.collection('sessions').where('branchId', '==', 'all').where('date', '>=', week).where('date', '<', nextWeek(week)).limit(1001)),
        transaction.get(db.collection('sessions').where('branchId', '==', branchId).where('status', 'in', ['scheduled', 'rescheduled']).limit(3001)),
        transaction.get(db.collection('sessions').where('branchId', '==', 'all').where('status', 'in', ['scheduled', 'rescheduled']).limit(3001)),
        transaction.get(db.doc('settings/scheduleConfig')),
        transaction.get(db.collection('leaveRequests').where('status', '==', 'approved').limit(1001)),
        Promise.all(availabilityReferences.map((reference) => transaction.get(reference))),
        Promise.all(scheduledStudentReferences.map((reference) => transaction.get(reference))),
        Promise.all(scheduledContractReferences.map((reference) => transaction.get(reference))),
        Promise.all(crossBranchSessionQueries.map((query) => transaction.get(query))),
      ])
      if (!scheduleSnapshot.exists && !v2DraftSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy lịch nháp của tuần.')
      if (!branchSnapshot.exists || branchSnapshot.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
      if (contractsSnapshot.size > 1000 || studentsSnapshot.size > 500 || trainersSnapshot.size > 100 || weekSessionsSnapshot.size > 1000 || legacyWeekSessionsSnapshot.size > 1000 || activeSessionsSnapshot.size > 3000 || legacyActiveSessionsSnapshot.size > 3000 || trainerLeavesSnapshot.size > 1000 || crossBranchSessionSnapshots.some((snapshot) => snapshot.size > 1000)) throw new HttpsError('resource-exhausted', 'Dữ liệu lịch vượt giới hạn kiểm tra an toàn.')
      const scheduleData = scheduleSnapshot.exists ? scheduleSnapshot.data() : {}
      const activeDraftData = v2DraftSnapshot.exists ? v2DraftSnapshot.data() : scheduleData
      const draftRevision = Number(v2DraftSnapshot.exists ? activeDraftData.revision : scheduleData.draftRevision || 0)
      if (draftRevision !== expectedDraftRevision) throw new HttpsError('aborted', 'Lịch nháp đã thay đổi. Hãy tải lại trước khi publish.')
      const publishedRevision = v2DraftSnapshot.exists
        ? Number(activeDraftData.publishedRevision ?? -1)
        : Number(scheduleData.publishedRevisions?.[branchId] ?? -1)
      const currentPublishedVersion = v2DraftSnapshot.exists
        ? Number(activeDraftData.publishedVersion || scheduleData.publishedVersions?.[branchId] || 0)
        : Number(scheduleData.publishedVersions?.[branchId] || 0)
      // Keep the cheap idempotent path for a healthy published draft. Only
      // continue into full validation when the raw weekly matrix points at a
      // session that may need legacy/duplicate reconciliation. This avoids
      // making an unchanged publish fail because a profile or contract became
      // stale after the original publish.
      const hasReconciliationCandidate = (() => {
        if (validateOnly || publishedRevision !== draftRevision) return true
        const sessionDocuments = new Map([
          ...weekSessionsSnapshot.docs,
          ...legacyWeekSessionsSnapshot.docs,
        ].map((item) => [item.id, item]))
        const rows = [...sessionDocuments.values()]
        for (const [slotId, entries] of Object.entries(activeDraftData.schedule || {})) {
          const slot = /^(T[2-7]|CN)-(\d{1,2})$/.exec(slotId)
          if (!slot || !Array.isArray(entries)) continue
          const date = dateForSlot(week, slot[1])
          const hour = Number(slot[2])
          for (const entry of entries) {
            if (!entry || entry.type === 'off' || !entry.studentId) continue
            const matches = rows.filter((item) => {
              const value = item.data() || {}
              return value.studentId === entry.studentId
                && storedDate(value.date) === date
                && storedHour(value.hour, item.id) === hour
            })
            const occupying = matches.filter((item) => {
              const value = item.data() || {}
              return ACTIVE_SESSION_STATUSES.has(String(value.status || '').toLowerCase()) || isImmutableSession(value)
            })
            if (occupying.length > 1 || matches.some((item) => item.data()?.branchId === 'all' && !isImmutableSession(item.data()))) return true
          }
        }
        return false
      })()
      if (!validateOnly && publishedRevision === draftRevision && !hasReconciliationCandidate && !hasPreliminaryTargetOverrides) {
        return { unchanged: true, draftRevision, version: currentPublishedVersion, diff: { create: 0, update: 0, cancel: 0, unchanged: 0 }, warnings: [] }
      }
      const trainerAvailabilitySnapshots = await loadTrainerAvailabilityWeeks(db, trainersSnapshot.docs.map((item) => ({ trainerId: item.id, weekId: week })), transaction)
      const weeklyTrainerAvailability = new Map(trainerAvailabilitySnapshots.filter((item) => item.exists).map((item) => [item.data().trainerId, item.data()]))

      const contractDocuments = new Map([...contractsSnapshot.docs, ...exactContractSnapshots.filter((item) => item.exists)].map((item) => [item.id, item]))
      const contracts = [...contractDocuments.values()].map((item) => ({ id: item.id, ...item.data() }))
      const draftWeeklySessionTargets = activeDraftData.weeklySessionTargets && typeof activeDraftData.weeklySessionTargets === 'object' && !Array.isArray(activeDraftData.weeklySessionTargets)
        ? activeDraftData.weeklySessionTargets
        : {}
      const quickWeeklySessionTargets = targetOverrideSnapshot.exists
        && targetOverrideSnapshot.data()?.targets
        && typeof targetOverrideSnapshot.data().targets === 'object'
        && !Array.isArray(targetOverrideSnapshot.data().targets)
        ? targetOverrideSnapshot.data().targets
        : {}
      const weeklySessionTargets = { ...draftWeeklySessionTargets, ...quickWeeklySessionTargets }
      const studentDocuments = new Map([...studentsSnapshot.docs, ...exactStudentSnapshots.filter((item) => item.exists)].map((item) => [item.id, item]))
      const students = new Map([...studentDocuments.values()].map((item) => {
        const data = item.data()
        const override = weeklySessionTargets[item.id]
        const sessionsPerWeek = Number.isInteger(Number(override)) && Number(override) >= 0 && Number(override) <= 7
          ? Number(override)
          : data.sessionsPerWeek
        return [item.id, { ...data, sessionsPerWeek }]
      }))
      const trainers = new Map(trainersSnapshot.docs.map((item) => [item.id, trainerProfileForWeek(item.data(), weeklyTrainerAvailability.get(item.id), week)]))
      const availability = new Map(availabilitySnapshots.filter((item) => item.exists).map((item) => [item.data().studentId, item.data()]))
      // A learner's weekly request is the default publish target when Staff
      // has not entered a draft-specific target. An explicit Staff target
      // remains the higher-priority operational override.
      for (const [studentId, student] of students) {
        if (Object.prototype.hasOwnProperty.call(weeklySessionTargets, studentId)) continue
        const effective = effectiveStudentAvailability({
          targetWeek: week,
          exact: availability.get(studentId),
          inherited: inheritedAvailability.get(studentId),
          profile: student,
        })
        const requestedSessions = normalizeRequestedSessions(effective.requestedSessions)
        if (requestedSessions === null) continue
        students.set(studentId, {
          ...student,
          sessionsPerWeek: requestedSessions,
          availabilityRequestedSessions: requestedSessions,
        })
      }
      // Legacy rows with branchId="all" are only owned by this branch when
      // their PT or learner belongs to the selected branch. Without this
      // scope, publishing one branch could cancel an unrelated legacy row
      // from another branch simply because both use the old global marker.
      const legacySessionBelongsToBranch = (item) => {
        const value = item.data()
        return value.branchId !== 'all'
          || trainers.has(value.trainerId)
          || students.has(value.studentId)
      }
      const activeSessionDocuments = new Map([
        ...activeSessionsSnapshot.docs,
        ...legacyActiveSessionsSnapshot.docs.filter(legacySessionBelongsToBranch),
        ...crossBranchSessionSnapshots.flatMap((snapshot) => snapshot.docs)
          .filter((item) => ACTIVE_SESSION_STATUSES.has(item.data().status) && legacySessionBelongsToBranch(item)),
      ].map((item) => [item.id, item]))
      const activeSessionDocs = [...activeSessionDocuments.values()]
      const prepared = desiredEntries({
        scheduleId,
        week,
        branchId,
        schedule: activeDraftData.schedule,
        trainers,
        students,
        contracts,
        availability,
        inheritedAvailability,
        config: configSnapshot.data() || {},
        trainerLeaves: trainerLeavesSnapshot.docs.map((item) => item.data()),
        activeSessions: activeSessionDocs.map((item) => ({ id: item.id, ...item.data() })),
        allowAdminOverrides: adminPublishWarningMode,
        allowPublishWarnings: adminPublishWarningMode,
      })
      if (prepared.errors.length) throw scheduleError('SCHEDULE_VALIDATION_FAILED', 'Lịch nháp còn xung đột và chưa thể publish.', { errors: prepared.errors, errorDetails: prepared.errorDetails })
      const acknowledgedWarnings = new Set(Array.isArray(request.data?.acknowledgedWarnings)
        ? request.data.acknowledgedWarnings.filter((value) => typeof value === 'string').slice(0, 20)
        : [])
      const confirmationWarnings = prepared.warnings.filter((code) => code === 'STUDENT_BRANCH_MISMATCH')
      if (!validateOnly && confirmationWarnings.some((code) => !acknowledgedWarnings.has(code))) {
        throw new HttpsError('failed-precondition', 'Lịch có học viên tập khác cơ sở hồ sơ. Hãy xác nhận cảnh báo trước khi publish.', {
          issueCode: 'PUBLISH_WARNING_CONFIRMATION_REQUIRED',
          errors: confirmationWarnings,
          warningDetails: prepared.warningDetails,
        })
      }

      const scopedWeekDocuments = new Map([
        ...weekSessionsSnapshot.docs,
        ...legacyWeekSessionsSnapshot.docs,
      ].map((item) => [item.id, item]))
      const existingScoped = [...scopedWeekDocuments.values()].filter((item) => {
        const session = item.data()
        return (session.branchId === branchId
          || (session.branchId === 'all' && (legacySessionBelongsToBranch(item) || prepared.desired.has(session.scheduleEntryId))))
          && (session.scheduleWeekId === week
            || String(session.scheduleEntryId || '').startsWith(`${scheduleId}-`)
            || (session.branchId === 'all' && !session.scheduleWeekId && !session.scheduleEntryId))
      })
      const { existingByEntry, existingByNatural, cancelledByEntry, duplicates } = indexExistingPublishSessions(existingScoped, branchId)

      const desiredValues = [...prepared.desired.values()]
      const desiredStudentIds = new Set(desiredValues.map((item) => item.studentId))
      const scopedExistingIds = new Set(existingScoped.map((item) => item.id))
      const totalBranchLoadBySlot = new Map()
      for (const desired of desiredValues) {
        totalBranchLoadBySlot.set(desired.slotId, (totalBranchLoadBySlot.get(desired.slotId) || 0) + 1)
      }
      for (const item of activeSessionDocs) {
        if (scopedExistingIds.has(item.id)) continue
        const value = item.data()
        if (value.branchId && value.branchId !== branchId) continue
        const slotId = slotIdForDateHour(week, storedDate(value.date), storedHour(value.hour, item.id))
        if (slotId) totalBranchLoadBySlot.set(slotId, (totalBranchLoadBySlot.get(slotId) || 0) + 1)
      }
      for (const [slotId, count] of totalBranchLoadBySlot) {
        const capacity = branchSlotCapacity(configSnapshot.data(), branchId, slotId)
        if (capacity !== null && count > capacity) {
          const hasAdminOverride = adminPublishWarningMode || desiredValues.some((desired) => desired.slotId === slotId && desired.adminOverride === true)
          if (hasAdminOverride) prepared.warnings.push('BRANCH_CAPACITY_REACHED')
          else throw scheduleError('BRANCH_CAPACITY_REACHED', 'Khung giờ đã vượt công suất tổng của chi nhánh.')
        }
      }
      for (const item of activeSessionDocs) {
        const session = item.data()
        if (!desiredStudentIds.has(session.studentId) || scopedExistingIds.has(item.id)) continue
        const date = storedDate(session.date)
        const hour = storedHour(session.hour, item.id)
        if (desiredValues.some((desired) => desired.studentId === session.studentId && desired.date === date)) {
          const hasAdminOverride = adminPublishWarningMode || desiredValues.some((desired) => desired.studentId === session.studentId && desired.date === date && desired.adminOverride === true)
          if (hasAdminOverride) prepared.warnings.push('STUDENT_MULTIPLE_SESSIONS_PER_DAY')
          else throw scheduleError('STUDENT_MULTIPLE_SESSIONS_PER_DAY', 'Học viên đã có một buổi khác trong ngày được chọn.')
        }
        if (desiredValues.some((desired) => desired.trainerId === session.trainerId && desired.date === date && desired.hour === hour)) {
          const externalCount = activeSessionDocs.filter((candidate) => {
            const value = candidate.data()
            return !scopedExistingIds.has(candidate.id) && value.trainerId === session.trainerId && storedDate(value.date) === date && storedHour(value.hour, candidate.id) === hour
          }).length
          const desiredCount = desiredValues.filter((desired) => desired.trainerId === session.trainerId && desired.date === date && desired.hour === hour).length
          if (externalCount + desiredCount > normalizedCapacity(trainers.get(session.trainerId)?.slotCapacity)) {
            const hasAdminOverride = adminPublishWarningMode || desiredValues.some((desired) => desired.trainerId === session.trainerId && desired.date === date && desired.hour === hour && desired.adminOverride === true)
            if (hasAdminOverride) prepared.warnings.push('TRAINER_CAPACITY_EXCEEDED')
            else throw scheduleError('TRAINER_CAPACITY_EXCEEDED', 'Khung giờ PT đã vượt sức chứa.')
          }
        }
      }

      const plannedByContract = new Map()
      for (const desired of desiredValues) {
        const existing = existingByEntry.get(desired.scheduleEntryId) || existingByNatural.get(naturalSessionKey(desired))
        if (existing && isImmutableSession(existing.data())) continue
        plannedByContract.set(desired.contractId, (plannedByContract.get(desired.contractId) || 0) + 1)
      }
      for (const [contractId, count] of plannedByContract) {
        const contract = contracts.find((item) => item.id === contractId)
        const otherPlanned = activeSessionDocs.filter((item) => {
          const value = item.data()
          return !scopedExistingIds.has(item.id)
            && value.contractId === contractId
            && ACTIVE_SESSION_STATUSES.has(value.status)
            && value.billingStatus !== 'charged'
        }).length
        if (Number(contract?.usedSessions || 0) + otherPlanned + count > contractSchedulingEntitlement(contract)) {
          const hasAdminOverride = adminPublishWarningMode || desiredValues.some((desired) => desired.contractId === contractId && desired.adminOverride === true)
          if (hasAdminOverride) prepared.warnings.push('CONTRACT_SESSION_QUOTA_EXCEEDED')
          else throw scheduleError('CONTRACT_SESSION_QUOTA_EXCEEDED', 'Số buổi đã học và đang xếp vượt quá gói tập.')
        }
      }

      const currentVersion = currentPublishedVersion
      const nextVersion = currentVersion + 1
      const publishPlan = planPublishedSessions({
        desired: prepared.desired,
        existingByEntry,
        existingByNatural,
        cancelledByEntry,
        adminPublishWarningMode,
        nextVersion,
      })
      const { creates, updates, unchanged, publishedEntries, reintroducedSessions } = publishPlan
      if (reintroducedSessions.length) {
        const warningCode = 'CANCELLED_SESSION_REINTRODUCED'
        prepared.warnings.push(warningCode)
        for (const item of reintroducedSessions) {
          if (prepared.warningDetails.length >= 100) break
          prepared.warningDetails.push({
            code: warningCode,
            scheduleEntryId: item.key,
            previousSessionId: item.previous.id,
            newSessionId: item.next.id,
          })
        }
      }
      if (duplicates.length) {
        prepared.warnings.push('DUPLICATE_DEPLOYED_SESSION')
        for (const duplicate of duplicates.slice(0, 100)) {
          if (prepared.warningDetails.length >= 100) break
          prepared.warningDetails.push({
            code: 'DUPLICATE_DEPLOYED_SESSION',
            duplicateSessionId: duplicate.id,
            canonicalSessionId: existingByEntry.get(duplicate.data()?.scheduleEntryId)?.id
              || existingByNatural.get(naturalSessionKey({ id: duplicate.id, ...duplicate.data() }))?.id
              || null,
            immutable: isImmutableSession(duplicate.data()),
          })
        }
      }
      const matchedExistingIds = new Set([
        ...unchanged.map((item) => item.id),
        ...updates.map((item) => item.existing.id),
      ])
      const duplicateSessionIds = new Set(duplicates.map((item) => item.id))
      const cancellations = [...new Map([
        ...existingScoped.filter((item) => ACTIVE_SESSION_STATUSES.has(item.data().status) && !isImmutableSession(item.data()) && !matchedExistingIds.has(item.id) && !prepared.desired.has(item.data().scheduleEntryId)),
        ...duplicates.filter((item) => ACTIVE_SESSION_STATUSES.has(item.data().status)),
      ].map((item) => [item.id, item])).values()]
      const immutableRemoved = existingScoped.filter((item) => isImmutableSession(item.data()) && !duplicateSessionIds.has(item.id) && !matchedExistingIds.has(item.id) && !prepared.desired.has(item.data().scheduleEntryId))
      if (immutableRemoved.length) throw scheduleError('CHARGED_SESSION_IMMUTABLE', 'Không thể loại buổi đã được tính hoặc xác nhận khỏi lịch publish.')
      // A previous publish may have completed successfully while leaving the
      // draft revision unchanged. Do not short-circuit that idempotent call
      // until duplicate reconciliation has had a chance to produce work.
      // This is the path that repairs legacy `branchId=all` rows created by
      // the old publisher without asking an operator to make a dummy edit.
      const duplicateAttendanceReferences = duplicates
        .filter((item) => ACTIVE_SESSION_STATUSES.has(String(item.data()?.status || '').toLowerCase()))
        .map((item) => {
          const attendanceId = typeof item.data()?.attendanceEventId === 'string' && item.data().attendanceEventId.trim()
            ? item.data().attendanceEventId.trim()
            : item.id
          return /^[A-Za-z0-9_-]+$/.test(attendanceId)
            ? { sessionId: item.id, reference: db.doc(`attendanceEvents/${attendanceId}`) }
            : null
        })
        .filter(Boolean)
      const duplicateAttendanceSnapshots = duplicateAttendanceReferences.length
        ? await Promise.all(duplicateAttendanceReferences.map((item) => transaction.get(item.reference)))
        : []
      const duplicateAttendanceBySession = new Map()
      duplicateAttendanceReferences.forEach((item, index) => {
        const snapshot = duplicateAttendanceSnapshots[index]
        // Never rewrite an attendance record that points at another session;
        // a malformed legacy link must remain quarantined for manual review.
        if (snapshot.exists && snapshot.data()?.sessionId === item.sessionId) {
          duplicateAttendanceBySession.set(item.sessionId, snapshot)
        }
      })
      const attendanceCancellationCount = [...duplicateAttendanceBySession.values()].filter((snapshot) => snapshot.exists).length
      const hasPublishWork = creates.length > 0 || updates.length > 0 || cancellations.length > 0
      if (!validateOnly && publishedRevision === draftRevision && !hasPublishWork) {
        return {
          unchanged: true,
          draftRevision,
          version: currentPublishedVersion,
          diff: { create: 0, update: 0, cancel: 0, unchanged: 0 },
          warnings: [...new Set(prepared.warnings)],
          warningDetails: prepared.warningDetails,
        }
      }
      const diff = { create: creates.length, update: updates.length, cancel: cancellations.length, unchanged: unchanged.length }
      if (validateOnly) return { unchanged: false, validateOnly: true, draftRevision, version: nextVersion, diff, warnings: [...new Set(prepared.warnings)], warningDetails: prepared.warningDetails }

      const writeCount = creates.length + updates.length + cancellations.length + attendanceCancellationCount + (v2DraftSnapshot.exists ? 4 : 3)
      if (writeCount > MAX_TRANSACTION_WRITES) throw new HttpsError('resource-exhausted', 'Lịch có quá nhiều thay đổi để publish trong một giao dịch.')
      for (const desired of creates) {
        transaction.create(db.doc(`sessions/${desired.id}`), {
          ...desired,
          schemaVersion: 2,
          scheduleVersion: nextVersion,
          revision: 0,
          verifiedByStudent: false,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
      }
      for (const { existing, desired } of updates) {
        const previous = existing.data()
        transaction.update(existing.ref, {
          ...desired,
          trainerAssignmentWarning: desired.trainerAssignmentWarning === true ? true : FieldValue.delete(),
          studentBranchWarning: desired.studentBranchWarning === true ? true : FieldValue.delete(),
          studentHomeBranchId: desired.studentBranchWarning === true ? desired.studentHomeBranchId : FieldValue.delete(),
          adminOverride: desired.adminOverride === true ? true : FieldValue.delete(),
          adminOverrideBy: desired.adminOverride === true ? desired.adminOverrideBy || '' : FieldValue.delete(),
          adminOverrideAt: desired.adminOverride === true ? desired.adminOverrideAt || '' : FieldValue.delete(),
          adminOverrideWarnings: desired.adminOverride === true ? desired.adminOverrideWarnings || [] : FieldValue.delete(),
          studentOffConfirmedDate: desired.studentOffConfirmedDate || FieldValue.delete(),
          scheduleVersion: nextVersion,
          status: 'scheduled',
          scheduleStatus: 'rescheduled',
          billingStatus: 'pending',
          attendanceStatus: 'pending',
          previousSchedule: FieldValue.arrayUnion({ date: previous.date, hour: previous.hour ?? null, trainerId: previous.trainerId, changedAt: new Date().toISOString(), reason: 'schedule_publish' }),
          revision: Number(previous.revision || 0) + 1,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
      }
      for (const existing of cancellations) {
        const duplicateAttendance = duplicateAttendanceBySession.get(existing.id)
        transaction.update(existing.ref, {
          status: 'cancelled',
          scheduleStatus: 'cancelled',
          billingStatus: 'exempt',
          attendanceStatus: null,
          cancellationReason: duplicateSessionIds.has(existing.id)
            ? 'Duplicate legacy session reconciled by schedule publish'
            : 'Removed by schedule publish',
          correctionReason: duplicateSessionIds.has(existing.id)
            ? 'Duplicate legacy session reconciled by schedule publish'
            : 'Removed by schedule publish',
          scheduleVersion: nextVersion,
          revision: Number(existing.data().revision || 0) + 1,
          cancelledAt: FieldValue.serverTimestamp(),
          correctedAt: FieldValue.serverTimestamp(),
          correctedBy: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
        if (duplicateAttendance?.exists) {
          transaction.update(duplicateAttendance.ref, {
            type: 'cancelled',
            scheduleStatus: 'cancelled',
            billingStatus: 'exempt',
            attendanceStatus: 'cancelled',
            countsTowardContract: false,
            correctionReason: duplicateSessionIds.has(existing.id)
              ? 'Duplicate legacy session reconciled by schedule publish'
              : 'Removed by schedule publish',
            correctedBy: actor.uid,
            correctedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actor.uid,
          })
        }
      }
      const versionReference = db.doc(`ptScheduleVersions/${scheduleId}_${branchId}_v${nextVersion}`)
      transaction.create(versionReference, {
        schemaVersion: 1,
        scheduleId,
        weekId: week,
        branchId,
        version: nextVersion,
        sourceDraftRevision: draftRevision,
        entries: publishedEntries,
        branchSchedule: branchScheduleSnapshot(activeDraftData.schedule, branchId, students, trainers),
        diff,
        warnings: prepared.warnings,
        publishedAt: FieldValue.serverTimestamp(),
        publishedBy: actor.uid,
      })
      transaction.set(scheduleReference, {
        [`publishedVersions.${branchId}`]: nextVersion,
        [`publishedRevisions.${branchId}`]: draftRevision,
        [`publishStatusByBranch.${branchId}`]: 'published',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      if (v2DraftSnapshot.exists) {
        transaction.update(v2DraftReference, {
          status: 'published',
          publishedVersion: nextVersion,
          publishedRevision: draftRevision,
          publishedAt: FieldValue.serverTimestamp(),
          publishedBy: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        schemaVersion: 1,
        action: 'pt_schedule.published',
        actorUid: actor.uid,
        branchId,
        weekId: week,
        version: nextVersion,
        draftRevision,
        diff,
        reintroducedSessions: reintroducedSessions.slice(0, 100).map((item) => ({
          scheduleEntryId: item.key,
          previousSessionId: item.previous.id,
          newSessionId: item.next.id,
        })),
        createdAt: FieldValue.serverTimestamp(),
      })
      return { unchanged: false, draftRevision, version: nextVersion, diff, warnings: [...new Set(prepared.warnings)] }
    })
    if (!validateOnly) onScheduleMutation(branchId, week)
    return result
  }

  const listPtScheduleVersions = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    await publisherActor(request, db, branchId)
    const scheduleId = `schedule_${week}`
    const [scheduleSnapshot, v2DraftSnapshot] = await Promise.all([
      db.doc(`schedules/${scheduleId}`).get(),
      db.doc(`ptScheduleDrafts/${branchId}_${week}`).get(),
    ])
    if (!scheduleSnapshot.exists && !v2DraftSnapshot.exists) return { currentDraftRevision: 0, currentVersion: 0, versions: [] }
    const scheduleData = scheduleSnapshot.exists ? scheduleSnapshot.data() : {}
    const v2DraftData = v2DraftSnapshot.exists ? v2DraftSnapshot.data() : null
    const currentVersion = Number(v2DraftData?.publishedVersion || scheduleData.publishedVersions?.[branchId] || 0)
    const minimumVersion = Math.max(1, currentVersion - 19)
    const references = []
    for (let version = currentVersion; version >= minimumVersion; version -= 1) {
      references.push(db.doc(`ptScheduleVersions/${scheduleId}_${branchId}_v${version}`))
    }
    const snapshots = references.length ? await db.getAll(...references) : []
    return {
      currentDraftRevision: Number(v2DraftData?.revision ?? scheduleData.draftRevision ?? 0),
      currentVersion,
      versions: snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => {
        const data = snapshot.data()
        return {
          version: Number(data.version || 0),
          sourceDraftRevision: Number(data.sourceDraftRevision || 0),
          entryCount: Array.isArray(data.entries) ? data.entries.length : 0,
          diff: data.diff || { create: 0, update: 0, cancel: 0, unchanged: 0 },
          warnings: Array.isArray(data.warnings) ? data.warnings.slice(0, 20) : [],
          publishedAt: isoTimestamp(data.publishedAt),
          publishedBy: typeof data.publishedBy === 'string' ? data.publishedBy : null,
        }
      }),
    }
  })

  const restorePtScheduleVersionToDraft = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const version = Number(request.data?.version)
    const expectedDraftRevision = Number(request.data?.expectedDraftRevision)
    if (!Number.isInteger(version) || version < 1) throw new HttpsError('invalid-argument', 'Phiên bản lịch không hợp lệ.')
    if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản draft không hợp lệ.')
    const actor = await publisherActor(request, db, branchId)
    const scheduleId = `schedule_${week}`
    const scheduleReference = db.doc(`schedules/${scheduleId}`)
    const v2DraftReference = db.doc(`ptScheduleDrafts/${branchId}_${week}`)
    const versionReference = db.doc(`ptScheduleVersions/${scheduleId}_${branchId}_v${version}`)

    const result = await db.runTransaction(async (transaction) => {
      const [scheduleSnapshot, v2DraftSnapshot, versionSnapshot, studentsSnapshot, trainersSnapshot] = await Promise.all([
        transaction.get(scheduleReference),
        transaction.get(v2DraftReference),
        transaction.get(versionReference),
        transaction.get(db.collection('students').where('branchId', '==', branchId).limit(501)),
        transaction.get(db.collection('trainers').where('branchId', '==', branchId).limit(101)),
      ])
      if (!scheduleSnapshot.exists && !v2DraftSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy lịch nháp của tuần.')
      if (!versionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy phiên bản lịch đã chọn.')
      const scheduleData = scheduleSnapshot.exists ? scheduleSnapshot.data() : {}
      const v2DraftData = v2DraftSnapshot.exists ? v2DraftSnapshot.data() : null
      const versionData = versionSnapshot.data()
      if (versionData.weekId !== week || versionData.branchId !== branchId || Number(versionData.version) !== version) {
        throw new HttpsError('failed-precondition', 'Phiên bản lịch không thuộc tuần hoặc chi nhánh này.')
      }
      const draftRevision = Number(v2DraftData?.revision ?? scheduleData.draftRevision ?? 0)
      if (draftRevision !== expectedDraftRevision) throw new HttpsError('aborted', 'Lịch nháp đã thay đổi. Hãy tải lại lịch sử trước khi khôi phục.')
      const students = new Map(studentsSnapshot.docs.map((item) => [item.id, item.data()]))
      const trainers = new Map(trainersSnapshot.docs.map((item) => [item.id, item.data()]))
      const restoredBranchSchedule = versionData.branchSchedule && typeof versionData.branchSchedule === 'object'
        ? versionData.branchSchedule
        : legacyBranchScheduleFromSessions(versionData.entries, branchId)
      const nextDraftRevision = draftRevision + 1
      if (v2DraftSnapshot.exists) {
        transaction.update(v2DraftReference, {
          schedule: normalizedDraftSchedule(restoredBranchSchedule, branchId, true),
          revision: nextDraftRevision,
          status: 'draft',
          restoredFromVersion: version,
          expiresAt: scheduleDraftExpiresAt(week),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
      } else {
        const restoredSchedule = mergeRestoredBranchSchedule(scheduleData.schedule || {}, restoredBranchSchedule, branchId, students, trainers)
        transaction.update(scheduleReference, {
          schedule: restoredSchedule,
          draftRevision: nextDraftRevision,
          [`publishStatusByBranch.${branchId}`]: 'draft',
          [`restoredFromVersionByBranch.${branchId}`]: version,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
      }
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        schemaVersion: 1,
        action: 'pt_schedule.version_restored_to_draft',
        actorUid: actor.uid,
        branchId,
        weekId: week,
        version,
        previousDraftRevision: draftRevision,
        nextDraftRevision,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { version, draftRevision: nextDraftRevision }
    })
    onScheduleMutation(branchId, week)
    return result
  })

  const getMyBranchScheduleWorkspace = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    await publisherActor(request, db, branchId)
    const scheduleId = `schedule_${week}`
    const [branchSnapshot, scheduleSnapshot, studentsSnapshot, trainersSnapshot, contractsSnapshot, sessionsSnapshot, configSnapshot] = await Promise.all([
      db.doc(`branches/${branchId}`).get(),
      db.doc(`schedules/${scheduleId}`).get(),
      db.collection('students').where('branchId', '==', branchId).limit(501).get(),
      db.collection('trainers').where('branchId', '==', branchId).limit(101).get(),
      db.collection('contracts').where('branchId', '==', branchId).limit(1001).get(),
      db.collection('sessions').where('branchId', '==', branchId).where('date', '>=', week).where('date', '<', nextWeek(week)).limit(1001).get(),
      db.doc('settings/scheduleConfig').get(),
    ])
    if (!branchSnapshot.exists || branchSnapshot.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
    if (studentsSnapshot.size > 500 || trainersSnapshot.size > 100 || contractsSnapshot.size > 1000 || sessionsSnapshot.size > 1000) {
      throw new HttpsError('resource-exhausted', 'Dữ liệu chi nhánh vượt giới hạn tải an toàn.')
    }
    const studentIds = new Set(studentsSnapshot.docs.map((item) => item.id))
    const trainerIds = new Set(trainersSnapshot.docs.map((item) => item.id))
    const [availabilitySnapshots, trainerAvailabilitySnapshots] = await Promise.all([
      exactAvailabilitySnapshots(db, studentIds, week),
      effectiveTrainerAvailabilitySnapshots(db, trainerIds, week),
    ])
    const weeklyAvailability = new Map(availabilitySnapshots
      .filter((item) => item.exists)
      .map((item) => item.data())
      .filter((item) => studentIds.has(item.studentId))
      .map((item) => [item.studentId, item]))
    const students = new Map(studentsSnapshot.docs.map((item) => [item.id, item.data()]))
    const weeklyTrainerAvailability = new Map(trainerAvailabilitySnapshots.filter((item) => item.exists).map((item) => [item.data().trainerId, item.data()]))
    const trainers = new Map(trainersSnapshot.docs.map((item) => [item.id, trainerProfileForWeek(item.data(), weeklyTrainerAvailability.get(item.id), week)]))
    const inheritedAvailability = await loadLatestSubmittedFallbacks(db, students, weeklyAvailability, week)
    const scheduleData = scheduleSnapshot.exists ? scheduleSnapshot.data() : {}
    const contracts = contractsSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => studentIds.has(item.studentId))
      .map((item) => ({
        id: item.id,
        studentId: item.studentId,
        trainerId: item.trainerId || '',
        trainerIds: Array.isArray(item.trainerIds) ? item.trainerIds.filter((id) => trainerIds.has(id)).slice(0, 10) : [],
        branchId: item.branchId || branchId,
        packageId: '',
        packageName: '',
        status: item.status,
        startDate: item.startDate,
        endDate: item.endDate,
        totalSessions: Number(item.totalSessions || 0),
        usedSessions: Number(item.usedSessions || 0),
        totalPrice: 0,
        paidAmount: 0,
      }))
    return {
      schemaVersion: 1,
      branch: { id: branchId, name: branchSnapshot.data().name || branchId, status: branchSnapshot.data().status || 'active' },
      weekId: week,
      draftRevision: Number(scheduleData.draftRevision || 0),
      publishedVersion: Number(scheduleData.publishedVersions?.[branchId] || 0),
      publishedRevision: Number(scheduleData.publishedRevisions?.[branchId] ?? -1),
      schedule: branchScheduleSnapshot(scheduleData.schedule || {}, branchId, students, trainers),
      students: studentsSnapshot.docs.map((item) => {
        const data = item.data()
        const availability = effectiveStudentAvailability({
          targetWeek: week,
          exact: weeklyAvailability.get(item.id),
          inherited: inheritedAvailability.get(item.id),
          profile: data,
        })
        return {
          id: item.id,
          name: data.name || 'Chưa cập nhật tên',
          phone: data.phone || '',
          email: data.email || '',
          status: data.status || 'active',
          branchId,
          sessionsPerWeek: Number(data.sessionsPerWeek || 0),
          availableSlots: availability.slots,
          isScheduleConfirmed: availability.confirmed,
        }
      }),
      trainers: trainersSnapshot.docs.map((item) => {
        const data = item.data()
        return {
          id: item.id,
          name: data.name || 'PT chưa cập nhật tên',
          phone: data.phone || '',
          email: data.email || '',
          status: data.status || 'active',
          branchId,
          availableSlots: Array.isArray(trainers.get(item.id)?.availableSlots) ? trainers.get(item.id).availableSlots.slice(0, 100) : [],
          slotCapacity: normalizedCapacity(data.slotCapacity),
        }
      }),
      contracts,
      sessions: sessionsSnapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => item.branchId === branchId && studentIds.has(item.studentId))
        .map((item) => ({
          id: item.id,
          studentId: item.studentId,
          trainerId: item.trainerId,
          contractId: item.contractId || '',
          branchId,
          date: storedDate(item.date),
          hour: storedHour(item.hour, item.id),
          status: item.status,
          scheduleWeekId: item.scheduleWeekId || '',
          scheduleVersion: Number(item.scheduleVersion || 0),
          revision: Number(item.revision || 0),
        })),
      scheduleConfig: normalizedScheduleConfig(configSnapshot.data()),
    }
  })

  const saveMyBranchScheduleDraft = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const expectedDraftRevision = Number(request.data?.expectedDraftRevision)
    if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản draft không hợp lệ.')
    const scopedSchedule = normalizedDraftSchedule(request.data?.schedule, branchId)
    const actor = await publisherActor(request, db, branchId)
    const scheduleId = `schedule_${week}`
    const scheduleReference = db.doc(`schedules/${scheduleId}`)
    const result = await db.runTransaction(async (transaction) => {
      const [scheduleSnapshot, branchSnapshot, studentsSnapshot, trainersSnapshot] = await Promise.all([
        transaction.get(scheduleReference),
        transaction.get(db.doc(`branches/${branchId}`)),
        transaction.get(db.collection('students').where('branchId', '==', branchId).limit(501)),
        transaction.get(db.collection('trainers').where('branchId', '==', branchId).limit(101)),
      ])
      if (!branchSnapshot.exists || branchSnapshot.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
      if (studentsSnapshot.size > 1000 || trainersSnapshot.size > 500) throw new HttpsError('resource-exhausted', 'Dữ liệu vận hành vượt giới hạn lưu an toàn.')
      const currentData = scheduleSnapshot.exists ? scheduleSnapshot.data() : {}
      const draftRevision = Number(currentData.draftRevision || 0)
      if (draftRevision !== expectedDraftRevision) throw new HttpsError('aborted', 'Lịch nháp đã thay đổi. Hãy tải lại trước khi lưu.')
      const students = new Map(studentsSnapshot.docs.map((item) => [item.id, item.data()]))
      const trainers = new Map(trainersSnapshot.docs.map((item) => [item.id, item.data()]))
      for (const entries of Object.values(scopedSchedule)) {
        for (const entry of entries) {
          const trainer = trainers.get(entry.trainerId)
          if (!trainer || trainerIsLocked(trainer) || trainer.branchId !== branchId) throw new HttpsError('failed-precondition', 'Lịch chứa PT không thuộc chi nhánh.')
          if (entry.type !== 'off') {
            const student = students.get(entry.studentId)
            if (!student || student.status === 'inactive' || student.branchId !== branchId) throw new HttpsError('failed-precondition', 'Lịch chứa học viên không thuộc chi nhánh.')
          }
        }
      }
      const mergedSchedule = mergeRestoredBranchSchedule(currentData.schedule || {}, scopedSchedule, branchId, students, trainers)
      const nextDraftRevision = draftRevision + 1
      transaction.set(scheduleReference, {
        schedule: mergedSchedule,
        draftRevision: nextDraftRevision,
        publishStatusByBranch: { ...(currentData.publishStatusByBranch || {}), [branchId]: 'draft' },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      }, { merge: true })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        schemaVersion: 1,
        action: 'pt_schedule.branch_draft_saved',
        actorUid: actor.uid,
        branchId,
        weekId: week,
        previousDraftRevision: draftRevision,
        nextDraftRevision,
        entryCount: Object.values(scopedSchedule).reduce((total, entries) => total + entries.length, 0),
        createdAt: FieldValue.serverTimestamp(),
      })
      return { draftRevision: nextDraftRevision }
    })
    onScheduleMutation(branchId, week)
    return result
  })

  const validatePtScheduleDraft = onCall((request) => execute(request, true))
  const publishPtSchedule = onCall((request) => execute(request, false))
  return {
    validatePtScheduleDraft,
    publishPtSchedule,
    listPtScheduleVersions,
    restorePtScheduleVersionToDraft,
    getMyBranchScheduleWorkspace,
    saveMyBranchScheduleDraft,
  }
}

module.exports = {
  createPtSchedulePublishFunctions,
  desiredEntries,
  indexExistingPublishSessions,
  planPublishedSessions,
  naturalSessionKey,
  reintroducedSessionId,
  branchScheduleSnapshot,
  mergeRestoredBranchSchedule,
  normalizedDraftSchedule,
  documentId,
  weekId,
  nextWeek,
  dateForSlot,
  storedDate,
  normalizedCapacity,
  normalizedScheduleConfig,
  branchSlotCapacity,
  trainerAvailabilityMode,
  trainerProfileForWeek,
  trainerIsLocked,
  trainerIsAvailable,
}
