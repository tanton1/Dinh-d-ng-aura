'use strict'

// Operational observation, deliberately separate from the strict release gate.
// A failed candidate must not turn an older healthy serving revision into an
// outage; an unverified read must not turn into a healthy/zero result either.
const short = value => String(value || '').split('/').at(-1) || ''
function latestReleaseFreshness(service) {
  const createdRevision = short(service?.latestCreatedRevision)
  const readyRevision = short(service?.latestReadyRevision)
  const positive = (service?.trafficStatuses || []).filter(target => Number(target.percent) > 0)
  const receiving100Percent = Boolean(createdRevision && positive.length === 1
    && Number(positive[0].percent) === 100 && short(positive[0].revision) === createdRevision)
  return { status: !createdRevision ? 'unknown' : receiving100Percent && createdRevision === readyRevision ? 'current' : 'backlog', createdRevision, readyRevision, receiving100Percent }
}
function revisionHealth(revision, expectedResource) {
  if (revision?.name !== expectedResource) return { status: 'unknown', reason: 'Revision identity was not verified.' }
  const conditions = revision.conditions || []
  const ready = conditions.find(item => item.type === 'Ready')
  const container = conditions.find(item => item.type === 'ContainerHealthy')
  if (conditions.some(item => item.revisionReason === 'RETIRED')) return { status: 'unhealthy', reason: 'Serving revision is RETIRED.' }
  if ([ready, container].some(item => item?.state === 'CONDITION_FAILED')) return { status: 'unhealthy', reason: [ready, container].filter(item => item?.state === 'CONDITION_FAILED').map(item => item.message || `${item.type} failed`).join('; ') }
  if (ready?.state !== 'CONDITION_SUCCEEDED' || container?.state !== 'CONDITION_SUCCEEDED') return { status: 'unknown', reason: 'Ready and ContainerHealthy have not both been verified.' }
  return { status: 'healthy', reason: '' }
}
async function servingHealth(service, readRevision) {
  const observed = service?.trafficStatuses || []
  const positive = observed.filter(target => Number(target.percent) > 0)
  const total = positive.reduce((sum, target) => sum + Number(target.percent), 0)
  const base = { trafficPercent: total, reconciling: Boolean(service?.reconciling), revisions: [] }
  if (!positive.length) return { ...base, status: 'unknown', ready: null, reason: 'No observed positive traffic; configured intent is not serving evidence.' }
  if (total !== 100 || observed.some(target => target.percent != null && (!Number.isFinite(Number(target.percent)) || Number(target.percent) < 0 || Number(target.percent) > 100))) return { ...base, status: 'unhealthy', ready: false, reason: 'Observed traffic allocation is invalid or does not total 100%.' }
  const grouped = new Map()
  positive.forEach(target => grouped.set(target.revision, (grouped.get(target.revision) || 0) + Number(target.percent)))
  const revisions = await Promise.all([...grouped].map(async ([revisionName, percent]) => {
    const resource = String(revisionName || '').startsWith('projects/') ? revisionName : `${service.name}/revisions/${revisionName || ''}`
    const row = { revision: short(revisionName), percent }
    if (!revisionName || !resource.startsWith(`${service.name}/revisions/`) || resource.slice(`${service.name}/revisions/`.length).includes('/')) return { ...row, status: 'unknown', reason: 'Observed revision is missing or outside this service.' }
    try {
      const revision = await readRevision(resource)
      return { ...row, ...revisionHealth(revision, resource), image: revision.containers?.[0]?.image || null }
    } catch (error) { return { ...row, status: 'unknown', reason: error.message || 'Revision read failed.' } }
  }))
  const status = revisions.some(row => row.status === 'unhealthy') ? 'unhealthy' : revisions.some(row => row.status === 'unknown') ? 'unknown' : 'healthy'
  return { ...base, revisions, status, ready: status === 'unknown' ? null : status === 'healthy', reason: revisions.filter(row => row.status !== 'healthy').map(row => `${row.revision}: ${row.reason}`).join('; ') }
}
function recentWindow(minutesValue, end = new Date()) {
  if (minutesValue == null || minutesValue === '') return null
  const minutes = Number(minutesValue)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('recent-minutes must be an integer from 1 to 1440.')
  return { minutes, startTime: new Date(end.getTime() - minutes * 60_000).toISOString(), endTime: end.toISOString() }
}
function recentMetricUrl(project, window, region) {
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`)
  url.searchParams.set('filter', `metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision"${region ? ` AND resource.labels.location="${region}"` : ''}`)
  url.searchParams.set('interval.startTime', window.startTime)
  url.searchParams.set('interval.endTime', window.endTime)
  url.searchParams.set('aggregation.alignmentPeriod', '60s')
  url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_SUM')
  url.searchParams.set('pageSize', '1000')
  return url
}
function recentRequestErrors(series, region, service, window) {
  const base = { scope: 'all_service_revisions', window, requests: null, http5xx: null, http429: null }
  if (!window) return { ...base, status: 'not_requested' }
  if (!Array.isArray(series)) return { ...base, status: 'unavailable' }
  const rows = series.filter(row => row.resource?.labels?.location === region && row.resource?.labels?.service_name === service)
  const sum = pattern => rows.filter(row => !pattern || pattern.test(String(row.metric?.labels?.response_code))).reduce((total, row) => total + (row.points || []).reduce((count, point) => count + Number(point.value?.int64Value ?? point.value?.doubleValue ?? 0), 0), 0)
  return { ...base, status: 'available', requests: sum(), http5xx: sum(/^5/), http429: sum(/^429$/) }
}
module.exports = { latestReleaseFreshness, servingHealth, revisionHealth, recentWindow, recentMetricUrl, recentRequestErrors }
