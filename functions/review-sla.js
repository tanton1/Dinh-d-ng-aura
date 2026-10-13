const DEFAULT_REVIEW_SLA_MINUTES = 120
const MIN_REVIEW_SLA_MINUTES = 30
const MAX_REVIEW_SLA_MINUTES = 1440

function normalizeReviewSlaMinutes(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_REVIEW_SLA_MINUTES
  return Math.min(MAX_REVIEW_SLA_MINUTES, Math.max(MIN_REVIEW_SLA_MINUTES, Math.trunc(parsed)))
}

module.exports = {
  DEFAULT_REVIEW_SLA_MINUTES,
  MIN_REVIEW_SLA_MINUTES,
  MAX_REVIEW_SLA_MINUTES,
  normalizeReviewSlaMinutes,
}
