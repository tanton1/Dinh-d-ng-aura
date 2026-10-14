const DEFAULT_REVIEW_SLA_MINUTES = 120
const MIN_REVIEW_SLA_MINUTES = 30
const MAX_REVIEW_SLA_MINUTES = 1440

function normalizeReviewSlaMinutes(value) {
  if (value === null || value === '') return DEFAULT_REVIEW_SLA_MINUTES
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_REVIEW_SLA_MINUTES
  return Math.min(MAX_REVIEW_SLA_MINUTES, Math.max(MIN_REVIEW_SLA_MINUTES, Math.trunc(parsed)))
}

function reviewTimeMillis(value) {
  let parsed = 0
  if (typeof value?.toMillis === 'function') parsed = value.toMillis()
  else if (typeof value?.toDate === 'function') parsed = value.toDate().getTime()
  else if (value instanceof Date) parsed = value.getTime()
  else if (typeof value === 'number') parsed = value
  else if (typeof value === 'string' && value.trim()) parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function reviewTimestampMillis(value = {}) {
  // createdAt is the current submission clock, not the original meal date.
  // Older imports only have submittedAt. Do not manufacture a date if absent.
  return reviewTimeMillis(value.createdAt)
    || reviewTimeMillis(value.submittedAt)
    || reviewTimeMillis(value.firstSubmittedAt)
    || reviewTimeMillis(value.meal?.createdAt)
    || reviewTimeMillis(value.meal?.submittedAt)
}

function reviewSlaState(value, slaMinutes, now = Date.now()) {
  const createdAt = reviewTimestampMillis(value)
  const dueAt = createdAt ? createdAt + normalizeReviewSlaMinutes(slaMinutes) * 60_000 : 0
  return { createdAt, dueAt, isOverdue: Boolean(dueAt && dueAt < now) }
}

module.exports = {
  DEFAULT_REVIEW_SLA_MINUTES,
  MIN_REVIEW_SLA_MINUTES,
  MAX_REVIEW_SLA_MINUTES,
  normalizeReviewSlaMinutes,
  reviewTimeMillis,
  reviewTimestampMillis,
  reviewSlaState,
}
