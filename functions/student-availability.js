'use strict'

const { FieldPath } = require('firebase-admin/firestore')

const SUBMITTED_STATUSES = new Set(['submitted', 'locked'])
const WEEK_PATTERN = /^\d{4}-\d{2}-\d{2}$/
// Legacy profiles may not yet have the denormalized latest submission on the
// student document. Looking up that history is the slowest part of a large
// schedule workspace because it can fan out to one bounded query per learner.
// Keep the fallback result process-local for a short period. A new admin
// submission advances the profile projection and therefore bypasses a stale
// fallback; the TTL is only a guard for records changed by older tools.
const FALLBACK_CACHE_TTL_MS = 5 * 60 * 1000
const FALLBACK_CACHE_LIMIT = 2000
const fallbackCaches = new WeakMap()

function fallbackCacheFor(db) {
  let cache = fallbackCaches.get(db)
  if (!cache) {
    cache = { entries: new Map(), pending: new Map() }
    fallbackCaches.set(db, cache)
  }
  return cache
}

function normalizedSlots(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((slot) => typeof slot === 'string' && slot.length <= 20))].slice(0, 100)
    : []
}

function normalizedSubmittedAvailability(value, fallbackWeekId = '') {
  if (!value || typeof value !== 'object') return null
  const weekId = WEEK_PATTERN.test(String(value.weekId || ''))
    ? String(value.weekId)
    : WEEK_PATTERN.test(fallbackWeekId) ? fallbackWeekId : ''
  const slots = normalizedSlots(value.slots)
  if (!weekId || !SUBMITTED_STATUSES.has(value.status) || !slots.length) return null
  return {
    weekId,
    slots,
    status: value.status,
    revision: Math.max(0, Number(value.revision || 0)),
    minimumSlots: Math.max(5, Number(value.minimumSlots || 5)),
    requiredSessions: Math.max(1, Number(value.requiredSessions || 1)),
    submittedAt: value.submittedAt || null,
    // Keep the last server update separately from the submission timestamp so
    // Staff can explain which snapshot is being inherited without guessing.
    updatedAt: value.updatedAt || value.submittedAt || null,
  }
}

function latestProfileAvailability(profile, targetWeek) {
  const latest = normalizedSubmittedAvailability(profile?.latestSubmittedAvailability)
  return latest && latest.weekId <= targetWeek ? latest : null
}

function legacyDefaultAvailability(profile) {
  const explicitLegacy = profile?.legacyDefaultAvailability
  const hasLatestProjection = Boolean(normalizedSubmittedAvailability(profile?.latestSubmittedAvailability))
  const slots = normalizedSlots(explicitLegacy?.slots || (!hasLatestProjection ? profile?.availableSlots : []))
  if (!slots.length) return null
  return {
    slots,
    confirmed: explicitLegacy
      ? explicitLegacy.confirmed === true
      : profile?.isScheduleConfirmed === true,
    minimumSlots: Math.max(5, Number(explicitLegacy?.minimumSlots || 5)),
    requiredSessions: Math.max(1, Number(explicitLegacy?.requiredSessions || profile?.sessionsPerWeek || 1)),
  }
}

function effectiveStudentAvailability({ targetWeek, exact, inherited, profile }) {
  const weekly = normalizedSubmittedAvailability(exact, targetWeek)
  if (weekly) {
    return {
      ...weekly,
      confirmed: true,
      source: 'weekly',
      sourceWeekId: targetWeek,
      sourceRevision: weekly.revision,
      targetRevision: weekly.revision,
    }
  }

  const inheritedCandidates = [
    latestProfileAvailability(profile, targetWeek),
    normalizedSubmittedAvailability(inherited),
  ].filter((value) => value && value.weekId < targetWeek)
    .sort((left, right) => right.weekId.localeCompare(left.weekId))
  const latest = inheritedCandidates[0]
  if (latest) {
    return {
      ...latest,
      status: 'inherited',
      confirmed: true,
      source: 'inherited_weekly',
      sourceWeekId: latest.weekId,
      sourceRevision: latest.revision,
      targetRevision: 0,
    }
  }

  const legacy = legacyDefaultAvailability(profile)
  if (legacy) {
    return {
      weekId: targetWeek,
      slots: legacy.slots,
      status: legacy.confirmed ? 'recurring' : 'draft',
      confirmed: legacy.confirmed,
      source: 'legacy_default',
      sourceWeekId: null,
      sourceRevision: 0,
      targetRevision: 0,
      minimumSlots: legacy.minimumSlots,
      requiredSessions: legacy.requiredSessions,
      submittedAt: null,
      updatedAt: null,
    }
  }

  return {
    weekId: targetWeek,
    slots: [],
    status: 'missing',
    confirmed: false,
    source: 'none',
    sourceWeekId: null,
    sourceRevision: 0,
    targetRevision: 0,
    minimumSlots: 5,
    requiredSessions: Math.max(1, Number(profile?.sessionsPerWeek || 1)),
    submittedAt: null,
    updatedAt: null,
  }
}

function studentAvailabilityProfilePatch(profile, submission) {
  const normalized = normalizedSubmittedAvailability(submission)
  if (!normalized) throw new TypeError('Lịch rảnh đã gửi không hợp lệ.')
  const currentLatest = normalizedSubmittedAvailability(profile?.latestSubmittedAvailability)
  const patch = {}

  if (!profile?.legacyDefaultAvailability && !currentLatest) {
    const legacySlots = normalizedSlots(profile?.availableSlots)
    if (legacySlots.length) {
      patch.legacyDefaultAvailability = {
        slots: legacySlots,
        confirmed: profile?.isScheduleConfirmed === true,
        minimumSlots: Math.max(5, Number(profile?.minimumAvailabilitySlots || 5)),
        requiredSessions: Math.max(1, Number(profile?.sessionsPerWeek || 1)),
        source: 'pre_weekly_profile',
      }
    }
  }

  if (!currentLatest || normalized.weekId >= currentLatest.weekId) {
    patch.latestSubmittedAvailability = normalized
    // Compatibility projection for older screens. The original value is
    // retained above before this projection is advanced.
    patch.availableSlots = normalized.slots
    patch.isScheduleConfirmed = true
    patch.availabilityRevision = normalized.revision
  }
  return patch
}

async function latestSubmittedBeforeWeek(db, studentId, targetWeek) {
  const lowerBound = `${studentId}_0000-00-00`
  const upperBound = `${studentId}_${targetWeek}`
  const snapshot = await db.collection('ptAvailability')
    .where(FieldPath.documentId(), '>=', lowerBound)
    .where(FieldPath.documentId(), '<', upperBound)
    .orderBy(FieldPath.documentId(), 'desc')
    .limit(52)
    .get()
  for (const item of snapshot.docs) {
    const value = item.data()
    if (value.studentId !== studentId) continue
    const normalized = normalizedSubmittedAvailability(value)
    if (normalized) return normalized
  }
  return null
}

async function cachedLatestSubmittedBeforeWeek(db, studentId, targetWeek) {
  const cache = fallbackCacheFor(db)
  const key = `${studentId}|${targetWeek}`
  const now = Date.now()
  const cached = cache.entries.get(key)
  if (cached && now - cached.storedAt < FALLBACK_CACHE_TTL_MS) return cached.value
  if (cached) cache.entries.delete(key)
  const pending = cache.pending.get(key)
  if (pending) return pending
  const request = latestSubmittedBeforeWeek(db, studentId, targetWeek).then((value) => {
    cache.entries.delete(key)
    cache.entries.set(key, { value, storedAt: Date.now() })
    while (cache.entries.size > FALLBACK_CACHE_LIMIT) cache.entries.delete(cache.entries.keys().next().value)
    return value
  }).finally(() => {
    if (cache.pending.get(key) === request) cache.pending.delete(key)
  })
  cache.pending.set(key, request)
  return request
}

async function loadLatestSubmittedFallbacks(db, profiles, exactAvailability, targetWeek) {
  const result = new Map()
  const unresolved = []
  for (const [studentId, profile] of profiles) {
    if (normalizedSubmittedAvailability(exactAvailability.get(studentId), targetWeek)) continue
    const projected = latestProfileAvailability(profile, targetWeek)
    if (projected && projected.weekId < targetWeek) result.set(studentId, projected)
    else unresolved.push(studentId)
  }
  // Legacy profiles without the denormalized latest submission still need a
  // bounded lookup. Fifty concurrent point queries keeps migration fallback
  // from turning a 500-student branch into 25 sequential network rounds.
  for (let index = 0; index < unresolved.length; index += 50) {
    const chunk = unresolved.slice(index, index + 50)
    const values = await Promise.all(chunk.map((studentId) => cachedLatestSubmittedBeforeWeek(db, studentId, targetWeek)))
    values.forEach((value, valueIndex) => {
      if (value) result.set(chunk[valueIndex], value)
    })
  }
  return result
}

module.exports = {
  effectiveStudentAvailability,
  latestProfileAvailability,
  latestSubmittedBeforeWeek,
  legacyDefaultAvailability,
  loadLatestSubmittedFallbacks,
  normalizedSubmittedAvailability,
  studentAvailabilityProfilePatch,
}
