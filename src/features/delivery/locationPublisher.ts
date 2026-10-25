import policy from '../../../functions/delivery-location-policy.json'

export { policy as deliveryLocationPolicy }
export type LocationPublishResult = { accepted: boolean; reason?: string }

function distance(left: GeolocationCoordinates, right: GeolocationCoordinates) {
  const radians = (value: number) => value * Math.PI / 180
  const value = Math.sin(radians(right.latitude - left.latitude) / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(radians(right.longitude - left.longitude) / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)))
}

export function locationSampleIssue(point: GeolocationPosition, previous: GeolocationPosition | null, now: number) {
  const { latitude, longitude, accuracy } = point.coords
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return 'coordinates'
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > policy.maximumAccuracyMeters) return 'accuracy'
  if (!Number.isFinite(point.timestamp) || point.timestamp < now - policy.maximumSampleAgeMs || point.timestamp > now + policy.futureToleranceMs) return 'sample_age'
  if (previous) {
    const elapsed = point.timestamp - previous.timestamp
    if (elapsed <= 0) return 'older_sample'
    const uncertainty = accuracy + previous.coords.accuracy
    if (distance(previous.coords, point.coords) > policy.maximumSpeedMetersPerSecond * elapsed / 1000 + uncertainty) return 'outlier'
  }
  return null
}

/** One latest GPS fix, a hard attempt interval, and no queued history. */
export function createLocationPublisher(options: {
  publish: (point: GeolocationPosition) => Promise<LocationPublishResult>
  now: () => number
  online: () => boolean
  schedule: (callback: () => void, delay: number) => unknown
  cancel: (timer: unknown) => void
  onResult?: (point: GeolocationPosition, result: LocationPublishResult) => void
  onError?: (error: unknown) => void
  onRejected?: (reason: string) => void
}) {
  let latest: GeolocationPosition | null = null
  let accepted: GeolocationPosition | null = null
  let lastAttempt = Number.NEGATIVE_INFINITY
  let lastAcceptedAt = Number.NEGATIVE_INFINITY
  let pending = false
  let stopped = false
  let timer: unknown
  const schedule = (delay: number) => {
    options.cancel(timer)
    timer = options.schedule(() => { void flush() }, delay)
  }
  const flush = async () => {
    if (stopped || pending || !latest || !options.online()) return
    const now = options.now()
    const issue = locationSampleIssue(latest, accepted, now)
    if (issue) { latest = null; options.onRejected?.(issue); return }
    const interval = now - lastAttempt
    if (interval < policy.minimumIntervalMs) { schedule(policy.minimumIntervalMs - interval); return }
    if (accepted && distance(accepted.coords, latest.coords) < Math.max(policy.minimumMovementMeters, accepted.coords.accuracy + latest.coords.accuracy)
      && now - lastAcceptedAt < policy.stationaryRefreshMs) {
      schedule(policy.stationaryRefreshMs - (now - lastAcceptedAt)); return
    }
    const point = latest
    latest = null
    pending = true
    lastAttempt = now
    try {
      const result = await options.publish(point)
      if (stopped) return
      if (result.accepted) { accepted = point; lastAcceptedAt = now }
      options.onResult?.(point, result)
    } catch (error) { if (!stopped) options.onError?.(error) }
    finally { pending = false; if (!stopped && latest) schedule(Math.max(0, policy.minimumIntervalMs - (options.now() - lastAttempt))) }
  }
  return {
    offer(point: GeolocationPosition) {
      if (stopped) return
      const issue = locationSampleIssue(point, accepted, options.now())
      if (issue) { options.onRejected?.(issue); return }
      if (!latest || latest.timestamp <= point.timestamp) latest = point
      void flush()
    },
    resume() { void flush() },
    stop() { stopped = true; latest = null; options.cancel(timer) },
  }
}
