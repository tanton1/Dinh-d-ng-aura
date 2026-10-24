'use strict'
const policy = require('./delivery-location-policy.json')

function sampleIssue(value, now) {
  if (!Number.isFinite(value.accuracyMeters) || value.accuracyMeters < 0 || value.accuracyMeters > policy.maximumAccuracyMeters) return 'accuracy'
  if (!Number.isFinite(value.capturedAt) || value.capturedAt < now - policy.maximumSampleAgeMs || value.capturedAt > now + policy.futureToleranceMs) return 'sample_age'
  return null
}

function locationUpdateIssue(current, value, acceptedAt, now, distance) {
  const issue = sampleIssue(value, now)
  if (issue) return issue
  if (!current) return null
  if (current.shipperId && current.shipperId !== value.shipperId) return 'assignment_changed'
  // An inactive assignment predating acceptance may be repaired if its
  // best-effort accept mirror failed. A later close/cancel must stay closed.
  if (current.active === false && (!(acceptedAt > 0) || Number(current.updatedAt || 0) >= acceptedAt)) return 'inactive'
  if (!Number.isFinite(current.latitude) || !Number.isFinite(current.longitude)) return null
  const elapsed = now - Number(current.updatedAt || 0)
  if (elapsed < policy.minimumIntervalMs) return 'interval'
  const captureElapsed = value.capturedAt - Number(current.capturedAt || current.updatedAt || 0)
  if (captureElapsed <= 0) return 'older_sample'
  const uncertainty = value.accuracyMeters + Math.max(0, Number(current.accuracyMeters || 0))
  const moved = distance(current, value)
  if (moved > policy.maximumSpeedMetersPerSecond * captureElapsed / 1000 + uncertainty) return 'outlier'
  if (moved < Math.max(policy.minimumMovementMeters, uncertainty) && elapsed < policy.stationaryRefreshMs) return 'stationary'
  return null
}

async function writeLiveLocation({ reference, payload, acceptedAt, distance, now = Date.now }) {
  let reason = null
  const result = await reference.transaction(current => {
    const currentTime = now()
    reason = locationUpdateIssue(current, payload, acceptedAt, currentTime, distance)
    if (reason) return undefined
    // Retry callbacks use current server time; a long wait cannot make an old
    // captured point look fresh simply by retrying the RTDB transaction.
    return { ...payload, updatedAt: currentTime }
  }, undefined, false)
  return { location: result.snapshot.val(), throttled: !result.committed, ...(reason ? { reason } : {}) }
}

module.exports = { policy, sampleIssue, locationUpdateIssue, writeLiveLocation }
