#!/usr/bin/env node
'use strict'

// Daily cost and capacity guard. It reads Cloud Monitoring metric values (and,
// optionally, the deployed function list) and reports the conditions that have
// already cost money on this project:
//
//   - a service billed for instance time far beyond the time its requests take
//     (seven triggers, 07/11/2026 16:20 → 11/11/2026, cleared by a redeploy);
//   - functions deployed with minimum instances (15–20/10/2026, 4–9 million
//     vCPU-seconds a day against a 30–45 thousand baseline);
//   - a jump in Firestore read or write units (the weekly-view fan-out fixed on
//     11/11/2026);
//   - event triggers rejected for lack of instances, which then retry.
//
// It never writes to the project, reads no business documents and prints no
// identifier other than service names. Estimates use list prices; only the
// Billing report can confirm what was charged.
//
//   node scripts/cloud-cost-guard.cjs --project=<id> [--hours=24]
//     [--inventory=<file from `gcloud functions list --v2 --format=json`>|live]
//     [--json] [--max-read-units-per-day=N] [--max-write-units-per-day=N]
//     [--max-cpu-seconds-per-day=N] [--max-usd-per-day=N]
//     [--max-billable-seconds-per-request=N]
//
// Exit code: 0 no alert, 1 at least one alert, 2 usage error or metrics unavailable.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')

// Cloud Billing Catalog list prices read on 2026-11-11 (USD, request-based billing).
const LIST_PRICES = Object.freeze({
  source: 'Cloud Billing Catalog 2026-11-11',
  run: Object.freeze({
    tier1: Object.freeze({ cpu: 0.000024, memory: 0.0000025, idleCpu: 0.0000025, idleMemory: 0.0000025 }),
    tier2: Object.freeze({ cpu: 0.0000336, memory: 0.0000035, idleCpu: 0.0000035, idleMemory: 0.0000035 }),
    // Only the regions this project deploys to were checked against the
    // catalog: asia-east1 is tier 1, asia-southeast1 and asia-southeast2 are
    // tier 2. Any other region is priced at tier 2 so the estimate errs high.
    tier1Regions: Object.freeze(['asia-east1']),
  }),
  firestore: Object.freeze({
    readUnitsPerMillion: 0.061,
    writeUnitsPerMillion: 0.32,
    freeReadUnitsPerDay: 50_000,
    freeWriteUnitsPerDay: 40_000,
  }),
})

// Baselines measured 27/10–07/11/2026: 30–45 thousand vCPU-seconds a day, and
// before the weekly-view fixes 10–11 million read units and 0.6–0.9 million
// write units a day. Revisit the Firestore limits after a week of data.
const DEFAULT_THRESHOLDS = Object.freeze({
  billableSecondsPerRequest: 30,
  minimumRequests: 20,
  cpuSecondsPerDay: 90_000,
  readUnitsPerDay: 6_000_000,
  writeUnitsPerDay: 600_000,
  rejectedShare: 0.2,
  rejectedMinimumRequests: 50,
  usdPerDay: 4,
})

const SECONDS_PER_MONTH = 30 * 86_400

function runPrice(region) {
  return LIST_PRICES.run.tier1Regions.includes(region) ? LIST_PRICES.run.tier1 : LIST_PRICES.run.tier2
}

function memoryGiB(value) {
  const text = String(value ?? '').trim()
  const amount = Number.parseFloat(text)
  if (!Number.isFinite(amount) || amount <= 0) return null
  if (/Gi$/i.test(text)) return amount
  if (/Mi$/i.test(text)) return amount / 1024
  if (/G$/i.test(text)) return amount * 1e9 / 2 ** 30
  if (/M$/i.test(text)) return amount * 1e6 / 2 ** 30
  return null
}

// `gcloud functions list --v2 --format=json` rows → { 'region/service': config }.
// Cloud Run names a function's service after the function name in lower case.
function inventoryIndex(rows) {
  const index = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const parts = String(row?.name || '').split('/')
    const region = parts[3]
    const name = parts[5]
    if (!region || !name) continue
    const cpu = Number(row.serviceConfig?.availableCpu)
    index.set(`${region}/${name.toLowerCase()}`, {
      name,
      region,
      cpu: Number.isFinite(cpu) && cpu > 0 ? cpu : null,
      memoryGiB: memoryGiB(row.serviceConfig?.availableMemory),
      minInstances: Math.max(0, Number(row.serviceConfig?.minInstanceCount || 0)),
      maxInstances: Number(row.serviceConfig?.maxInstanceCount || 0) || null,
    })
  }
  return index
}

function perDay(value, hours) {
  return value * 24 / hours
}

// Pure evaluation. `usage` is what the collector measured for the window:
//   { hours, services: [{ name, region, requests, billableSeconds, rejected429, failed5xx }],
//     totals: { cpuAllocationSeconds, memoryAllocationGibSeconds, readUnits, writeUnits } }
// A total the collector could not read is null and stays unknown; it is never
// treated as zero.
function evaluateUsage(usage, { inventory = new Map(), thresholds = {} } = {}) {
  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds }
  const hours = Number(usage?.hours)
  if (!Number.isFinite(hours) || hours <= 0) throw new TypeError('usage.hours must be a positive number')
  const findings = []
  const services = Array.isArray(usage.services) ? usage.services : []
  const totals = usage.totals || {}
  let runLowerBound = 0
  let unknownConfiguration = 0

  for (const service of services) {
    const requests = Number(service.requests || 0)
    const billableSeconds = Number(service.billableSeconds || 0)
    const config = inventory.get(`${service.region}/${service.name}`)
    const price = runPrice(service.region)
    let cost = null
    if (config?.cpu && config.memoryGiB) cost = billableSeconds * (config.cpu * price.cpu + config.memoryGiB * price.memory)
    else if (billableSeconds > 0) unknownConfiguration += 1
    if (cost !== null) runLowerBound += cost

    if (requests >= limits.minimumRequests && billableSeconds / requests > limits.billableSecondsPerRequest) {
      findings.push({
        level: 'alert',
        code: 'IDLE_BILLING',
        service: service.name,
        region: service.region,
        message: `${service.name} was billed ${Math.round(billableSeconds)} instance seconds for ${Math.round(requests)} requests (${(billableSeconds / requests).toFixed(1)} s each). A redeploy cleared this pattern on 11/11/2026.`,
        evidence: { requests, billableSeconds, secondsPerRequest: billableSeconds / requests, estimatedUsdPerDay: cost === null ? null : perDay(cost, hours) },
      })
    }
    const rejected = Number(service.rejected429 || 0) + Number(service.failed5xx || 0)
    if (requests >= limits.rejectedMinimumRequests && rejected / requests > limits.rejectedShare) {
      findings.push({
        level: 'warning',
        code: 'REJECTED_EVENTS',
        service: service.name,
        region: service.region,
        message: `${service.name} answered ${Math.round(rejected)} of ${Math.round(requests)} requests with 429 or 5xx (${Math.round(rejected / requests * 100)}%). Retried events delay projections; review its instance limit and concurrency.`,
        evidence: { requests, rejected429: Number(service.rejected429 || 0), failed5xx: Number(service.failed5xx || 0), share: rejected / requests },
      })
    }
  }

  for (const config of inventory.values()) {
    if (config.minInstances > 0) {
      const price = runPrice(config.region)
      const monthly = config.cpu && config.memoryGiB
        ? config.minInstances * SECONDS_PER_MONTH * (config.cpu * price.idleCpu + config.memoryGiB * price.idleMemory)
        : null
      findings.push({
        level: 'alert',
        code: 'MIN_INSTANCES',
        service: config.name,
        region: config.region,
        message: `${config.name} keeps ${config.minInstances} minimum instance(s)${monthly === null ? '' : `, about $${monthly.toFixed(2)} a month while idle`}. Every function ran with zero on 11/11/2026.`,
        evidence: { minInstances: config.minInstances, cpu: config.cpu, memoryGiB: config.memoryGiB, estimatedUsdPerMonth: monthly },
      })
    }
  }

  const totalRule = (value, limit, code, label, unit) => {
    if (value === null || value === undefined) {
      findings.push({ level: 'warning', code: 'METRIC_MISSING', message: `${label} could not be read; treat it as unknown, not zero.`, evidence: { metric: code } })
      return null
    }
    const daily = perDay(Number(value), hours)
    if (daily > limit) {
      findings.push({ level: 'alert', code, message: `${label}: ${Math.round(daily).toLocaleString('en-US')} ${unit} a day, above the limit of ${limit.toLocaleString('en-US')}.`, evidence: { perDay: daily, limit } })
    }
    return daily
  }
  const cpuPerDay = totalRule(totals.cpuAllocationSeconds, limits.cpuSecondsPerDay, 'CPU_ALLOCATION_HIGH', 'Cloud Run CPU allocation', 'vCPU-seconds')
  const readPerDay = totalRule(totals.readUnits, limits.readUnitsPerDay, 'READ_UNITS_HIGH', 'Firestore read units', 'units')
  const writePerDay = totalRule(totals.writeUnits, limits.writeUnitsPerDay, 'WRITE_UNITS_HIGH', 'Firestore write units', 'units')
  const memoryPerDay = totals.memoryAllocationGibSeconds === null || totals.memoryAllocationGibSeconds === undefined
    ? null
    : perDay(Number(totals.memoryAllocationGibSeconds), hours)

  // Two bounds for Cloud Run: billable request time at the configured CPU is
  // what the pricing page describes; the allocation metric also counts the
  // start-up boost and is the most the platform could have charged.
  const tier2 = LIST_PRICES.run.tier2
  const firestoreUsdPerDay = readPerDay === null || writePerDay === null
    ? null
    : Math.max(0, readPerDay - LIST_PRICES.firestore.freeReadUnitsPerDay) * LIST_PRICES.firestore.readUnitsPerMillion / 1e6
      + Math.max(0, writePerDay - LIST_PRICES.firestore.freeWriteUnitsPerDay) * LIST_PRICES.firestore.writeUnitsPerMillion / 1e6
  const estimate = {
    priceSource: LIST_PRICES.source,
    cloudRunUsdPerDayLowerBound: inventory.size && !unknownConfiguration ? perDay(runLowerBound, hours) : null,
    cloudRunUsdPerDayUpperBound: cpuPerDay === null || memoryPerDay === null ? null : cpuPerDay * tier2.cpu + memoryPerDay * tier2.memory,
    firestoreUsdPerDay,
    servicesWithoutConfiguration: unknownConfiguration,
  }
  const knownTotal = estimate.cloudRunUsdPerDayUpperBound === null || firestoreUsdPerDay === null
    ? null
    : estimate.cloudRunUsdPerDayUpperBound + firestoreUsdPerDay
  estimate.usdPerDayUpperBound = knownTotal
  if (knownTotal !== null && knownTotal > limits.usdPerDay) {
    findings.push({ level: 'alert', code: 'ESTIMATE_HIGH', message: `Estimated spend is up to $${knownTotal.toFixed(2)} a day at list price, above the limit of $${limits.usdPerDay}.`, evidence: { usdPerDay: knownTotal, limit: limits.usdPerDay } })
  }

  const order = { alert: 0, warning: 1 }
  findings.sort((left, right) => order[left.level] - order[right.level] || String(left.code).localeCompare(String(right.code)) || String(left.service || '').localeCompare(String(right.service || '')))
  return {
    hours,
    perDay: { cpuAllocationSeconds: cpuPerDay, memoryAllocationGibSeconds: memoryPerDay, readUnits: readPerDay, writeUnits: writePerDay },
    estimate,
    findings,
    alerts: findings.filter((finding) => finding.level === 'alert').length,
    warnings: findings.filter((finding) => finding.level === 'warning').length,
  }
}

function parseArguments(argv) {
  const values = new Map()
  for (const item of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(item)
    if (!match) throw new Error(`Unknown argument: ${item}`)
    values.set(match[1], match[2] ?? 'true')
  }
  const project = values.get('project') || process.env.GCLOUD_PROJECT || ''
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(project)) throw new Error('Provide --project=<project id>.')
  const hours = Number(values.get('hours') || 24)
  if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 30) throw new Error('--hours must be between 1 and 720.')
  const limit = (name, key, thresholds) => {
    if (!values.has(name)) return
    const parsed = Number(values.get(name))
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive number.`)
    thresholds[key] = parsed
  }
  const thresholds = {}
  limit('max-read-units-per-day', 'readUnitsPerDay', thresholds)
  limit('max-write-units-per-day', 'writeUnitsPerDay', thresholds)
  limit('max-cpu-seconds-per-day', 'cpuSecondsPerDay', thresholds)
  limit('max-usd-per-day', 'usdPerDay', thresholds)
  limit('max-billable-seconds-per-request', 'billableSecondsPerRequest', thresholds)
  return { project, hours, thresholds, inventory: values.get('inventory') || '', json: values.get('json') === 'true' }
}

function accessToken() {
  const output = process.platform === 'win32'
    ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token --quiet'], { encoding: 'utf8' })
    : execFileSync('gcloud', ['auth', 'print-access-token', '--quiet'], { encoding: 'utf8' })
  return output.trim()
}

async function timeSeries(token, project, { filter, start, end, groupBy = [] }) {
  const rows = []
  let pageToken = ''
  do {
    const params = new URLSearchParams()
    params.set('filter', filter)
    params.set('interval.startTime', start.toISOString())
    params.set('interval.endTime', end.toISOString())
    params.set('aggregation.alignmentPeriod', `${Math.round((end - start) / 1000)}s`)
    params.set('aggregation.perSeriesAligner', 'ALIGN_SUM')
    params.set('aggregation.crossSeriesReducer', 'REDUCE_SUM')
    for (const field of groupBy) params.append('aggregation.groupByFields', field)
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetch(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${params}`, { headers: { authorization: `Bearer ${token}` } })
    const body = await response.json()
    if (!response.ok) throw new Error(`${filter}: ${response.status} ${JSON.stringify(body).slice(0, 200)}`)
    rows.push(...(body.timeSeries || []))
    pageToken = body.nextPageToken || ''
  } while (pageToken)
  return rows
}

const pointSum = (row) => (row.points || []).reduce((sum, point) => sum + Number(point.value.int64Value ?? point.value.doubleValue ?? 0), 0)

async function collectUsage({ project, hours, token, now = new Date() }) {
  const end = new Date(Math.floor(now.getTime() / 60_000) * 60_000)
  const start = new Date(end.getTime() - hours * 3_600_000)
  const window = { start, end }
  const metric = (type) => `metric.type="${type}"`
  const byService = ['resource.label.service_name', 'resource.label.location']
  const total = async (filter) => {
    const rows = await timeSeries(token, project, { ...window, filter })
    return rows.length ? rows.reduce((sum, row) => sum + pointSum(row), 0) : null
  }
  const [billable, requests, cpuAllocationSeconds, memoryAllocationGibSeconds, readUnits, writeUnits] = await Promise.all([
    timeSeries(token, project, { ...window, filter: metric('run.googleapis.com/container/billable_instance_time'), groupBy: byService }),
    timeSeries(token, project, { ...window, filter: metric('run.googleapis.com/request_count'), groupBy: [...byService, 'metric.label.response_code'] }),
    total(metric('run.googleapis.com/container/cpu/allocation_time')),
    total(metric('run.googleapis.com/container/memory/allocation_time')),
    // RunQuery repeats the Query series; counting both would double the total.
    total(`${metric('firestore.googleapis.com/api/billable_read_units')} AND metric.label.api_method!="RunQuery"`),
    total(metric('firestore.googleapis.com/api/billable_write_units')),
  ])
  const services = new Map()
  const entry = (row) => {
    const key = `${row.resource.labels.location}/${row.resource.labels.service_name}`
    if (!services.has(key)) services.set(key, { name: row.resource.labels.service_name, region: row.resource.labels.location, requests: 0, billableSeconds: 0, rejected429: 0, failed5xx: 0 })
    return services.get(key)
  }
  for (const row of billable) entry(row).billableSeconds += pointSum(row)
  for (const row of requests) {
    const target = entry(row)
    const count = pointSum(row)
    const code = Number(row.metric?.labels?.response_code || 0)
    target.requests += count
    if (code === 429) target.rejected429 += count
    else if (code >= 500) target.failed5xx += count
  }
  return {
    hours,
    window: { start: start.toISOString(), end: end.toISOString() },
    services: [...services.values()],
    totals: { cpuAllocationSeconds, memoryAllocationGibSeconds, readUnits, writeUnits },
  }
}

function readInventory(option, project) {
  if (!option) return new Map()
  if (option === 'live') {
    const args = ['functions', 'list', '--project', project, '--v2', '--format=json']
    const output = process.platform === 'win32'
      ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `gcloud ${args.join(' ')}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      : execFileSync('gcloud', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return inventoryIndex(JSON.parse(output))
  }
  return inventoryIndex(JSON.parse(fs.readFileSync(option, 'utf8')))
}

function formatReport(usage, result) {
  const number = (value, digits = 0) => value === null || value === undefined ? 'unknown' : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits })
  const money = (value) => value === null || value === undefined ? 'unknown' : `$${value.toFixed(2)}`
  const lines = [
    `Window ${usage.window?.start || '?'} → ${usage.window?.end || '?'} (${usage.hours} h), ${usage.services.length} services with traffic`,
    `Per day: Cloud Run CPU ${number(result.perDay.cpuAllocationSeconds)} vCPU-s, memory ${number(result.perDay.memoryAllocationGibSeconds)} GiB-s; Firestore read units ${number(result.perDay.readUnits)}, write units ${number(result.perDay.writeUnits)}`,
    `List-price estimate per day (${result.estimate.priceSource}): Cloud Run ${money(result.estimate.cloudRunUsdPerDayLowerBound)} to ${money(result.estimate.cloudRunUsdPerDayUpperBound)}, Firestore ${money(result.estimate.firestoreUsdPerDay)}. Free tiers and other services are not included.`,
    result.findings.length ? `${result.alerts} alert(s), ${result.warnings} warning(s):` : 'No alert and no warning.',
    ...result.findings.map((finding) => `  [${finding.level.toUpperCase()}] ${finding.code}: ${finding.message}`),
  ]
  return lines.join('\n')
}

async function main() {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    console.error(`${error.message}\nUsage: node scripts/cloud-cost-guard.cjs --project=<id> [--hours=24] [--inventory=<file>|live] [--json]`)
    process.exit(2)
  }
  let usage
  let inventory
  try {
    inventory = readInventory(options.inventory, options.project)
    usage = await collectUsage({ project: options.project, hours: options.hours, token: accessToken() })
  } catch (error) {
    console.error(`Usage could not be read: ${String(error.message || error).slice(0, 300)}`)
    process.exit(2)
  }
  const result = evaluateUsage(usage, { inventory, thresholds: options.thresholds })
  console.log(options.json ? JSON.stringify({ window: usage.window, ...result }, null, 2) : formatReport(usage, result))
  process.exit(result.alerts ? 1 : 0)
}

if (require.main === module) main()

module.exports = { DEFAULT_THRESHOLDS, LIST_PRICES, evaluateUsage, formatReport, inventoryIndex, memoryGiB, parseArguments }
