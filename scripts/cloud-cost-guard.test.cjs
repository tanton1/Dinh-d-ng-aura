'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { DEFAULT_THRESHOLDS, LIST_PRICES, evaluateUsage, formatReport, inventoryIndex, memoryGiB, parseArguments } = require('./cloud-cost-guard.cjs')

const fn = (name, region, cpu, memory, minInstances = 0) => ({
  name: `projects/demo-aura/locations/${region}/functions/${name}`,
  serviceConfig: { availableCpu: String(cpu), availableMemory: memory, minInstanceCount: minInstances, maxInstanceCount: 2 },
})

// A quiet day shaped like 28/10–04/11/2026: triggers answer in about a second,
// reads and writes sit at the level measured after the weekly-view fixes.
function healthyDay() {
  return {
    hours: 24,
    window: { start: '2026-11-03T00:00:00.000Z', end: '2026-11-04T00:00:00.000Z' },
    services: [
      { name: 'syncstudent360session', region: 'asia-southeast1', requests: 380, billableSeconds: 380, rejected429: 4, failed5xx: 1 },
      { name: 'getmytrainerworkspaceregional', region: 'asia-east1', requests: 230, billableSeconds: 800, rejected429: 0, failed5xx: 0 },
      { name: 'dispatchscheduledreminders', region: 'asia-southeast1', requests: 1440, billableSeconds: 270, rejected429: 0, failed5xx: 0 },
    ],
    totals: { cpuAllocationSeconds: 34_000, memoryAllocationGibSeconds: 4_000, readUnits: 1_800_000, writeUnits: 150_000 },
  }
}

const inventory = inventoryIndex([
  fn('syncStudent360Session', 'asia-southeast1', 0.1666, '256Mi'),
  fn('getMyTrainerWorkspaceRegional', 'asia-east1', 0.1666, '256Mi'),
  fn('dispatchScheduledReminders', 'asia-southeast1', 1, '256Mi'),
  fn('syncStudent360ContractUsage', 'asia-southeast1', 0.1666, '256Mi'),
])

test('a healthy day raises nothing and prices both regions from the catalog', () => {
  const result = evaluateUsage(healthyDay(), { inventory })
  assert.deepEqual(result.findings, [])
  assert.equal(result.alerts, 0)
  const tier2 = LIST_PRICES.run.tier2
  const tier1 = LIST_PRICES.run.tier1
  const expected = 380 * (0.1666 * tier2.cpu + 0.25 * tier2.memory)
    + 800 * (0.1666 * tier1.cpu + 0.25 * tier1.memory)
    + 270 * (1 * tier2.cpu + 0.25 * tier2.memory)
  assert.ok(Math.abs(result.estimate.cloudRunUsdPerDayLowerBound - expected) < 1e-9)
  assert.ok(result.estimate.cloudRunUsdPerDayUpperBound > result.estimate.cloudRunUsdPerDayLowerBound)
  const firestore = (1_800_000 - 50_000) * 0.061 / 1e6 + (150_000 - 40_000) * 0.32 / 1e6
  assert.ok(Math.abs(result.estimate.firestoreUsdPerDay - firestore) < 1e-9)
})

test('a trigger billed for idle minutes after each run is an alert (07–11/11/2026)', () => {
  const usage = healthyDay()
  usage.services.push({ name: 'syncstudent360contractusage', region: 'asia-southeast1', requests: 195, billableSeconds: 48_500, rejected429: 0, failed5xx: 0 })
  const result = evaluateUsage(usage, { inventory })
  const finding = result.findings.find((item) => item.code === 'IDLE_BILLING')
  assert.equal(finding.level, 'alert')
  assert.equal(finding.service, 'syncstudent360contractusage')
  assert.ok(finding.evidence.secondsPerRequest > 240)
  assert.ok(finding.evidence.estimatedUsdPerDay > 0.3)
  assert.equal(result.alerts, 1)
})

test('a slow but rarely called endpoint is not mistaken for idle billing', () => {
  const usage = healthyDay()
  usage.services.push({ name: 'rebuildoperationsdashboardaggregatesscheduled', region: 'asia-southeast1', requests: 1, billableSeconds: 48, rejected429: 0, failed5xx: 0 })
  usage.services.push({ name: 'getmysessionchangesuggestions', region: 'asia-southeast1', requests: 2, billableSeconds: 604, rejected429: 0, failed5xx: 0 })
  assert.equal(evaluateUsage(usage, { inventory }).findings.filter((item) => item.code === 'IDLE_BILLING').length, 0)
})

test('minimum instances and the allocation they cause are alerts (15–20/10/2026)', () => {
  const usage = healthyDay()
  usage.totals.cpuAllocationSeconds = 8_000_000
  usage.totals.memoryAllocationGibSeconds = 5_000_000
  const drifted = inventoryIndex([
    fn('getMyAccessContext', 'asia-southeast1', 0.1666, '256Mi', 1),
    fn('listMyStudentPtSchedule', 'asia-southeast1', 1, '512Mi', 2),
    fn('trackProductEvent', 'asia-southeast1', 0.1666, '256Mi', 0),
  ])
  const result = evaluateUsage(usage, { inventory: drifted })
  const minimum = result.findings.filter((item) => item.code === 'MIN_INSTANCES')
  assert.deepEqual(minimum.map((item) => item.service), ['getMyAccessContext', 'listMyStudentPtSchedule'])
  const price = LIST_PRICES.run.tier2
  assert.ok(Math.abs(minimum[1].evidence.estimatedUsdPerMonth - 2 * 30 * 86_400 * (1 * price.idleCpu + 0.5 * price.idleMemory)) < 1e-6)
  assert.ok(result.findings.some((item) => item.code === 'CPU_ALLOCATION_HIGH' && item.level === 'alert'))
  assert.ok(result.findings.some((item) => item.code === 'ESTIMATE_HIGH'))
})

test('read and write units are compared per day whatever the window length', () => {
  const usage = healthyDay()
  usage.hours = 6
  usage.totals.readUnits = 2_700_000
  usage.totals.writeUnits = 100_000
  const result = evaluateUsage(usage, { inventory })
  assert.equal(result.perDay.readUnits, 10_800_000)
  assert.ok(result.findings.some((item) => item.code === 'READ_UNITS_HIGH'))
  assert.ok(!result.findings.some((item) => item.code === 'WRITE_UNITS_HIGH'))
  const relaxed = evaluateUsage(usage, { inventory, thresholds: { readUnitsPerDay: 12_000_000 } })
  assert.ok(!relaxed.findings.some((item) => item.code === 'READ_UNITS_HIGH'))
})

test('a trigger that rejects a fifth of its events is a warning, not an alert', () => {
  const usage = healthyDay()
  usage.services.push({ name: 'processstudent360sourcequeue', region: 'asia-southeast1', requests: 2000, billableSeconds: 1000, rejected429: 360, failed5xx: 97 })
  const result = evaluateUsage(usage, { inventory })
  const finding = result.findings.find((item) => item.code === 'REJECTED_EVENTS')
  assert.equal(finding.level, 'warning')
  assert.equal(Math.round(finding.evidence.share * 100), 23)
  assert.equal(result.alerts, 0)
  assert.equal(result.warnings, 1)
})

test('a metric that could not be read stays unknown instead of becoming zero', () => {
  const usage = healthyDay()
  usage.totals.readUnits = null
  const result = evaluateUsage(usage, { inventory })
  assert.equal(result.perDay.readUnits, null)
  assert.equal(result.estimate.firestoreUsdPerDay, null)
  assert.equal(result.estimate.usdPerDayUpperBound, null)
  assert.ok(result.findings.some((item) => item.code === 'METRIC_MISSING' && item.level === 'warning'))
  assert.match(formatReport(usage, result), /read units unknown/)
})

test('without an inventory the lower bound is unknown but usage rules still apply', () => {
  const usage = healthyDay()
  usage.services.push({ name: 'syncstudent360contractusage', region: 'asia-southeast1', requests: 195, billableSeconds: 48_500 })
  const result = evaluateUsage(usage)
  assert.equal(result.estimate.cloudRunUsdPerDayLowerBound, null)
  assert.equal(result.findings.filter((item) => item.code === 'IDLE_BILLING').length, 1)
  assert.equal(result.findings[0].evidence.estimatedUsdPerDay, null)
})

test('memory sizes, arguments and report text', () => {
  assert.equal(memoryGiB('256Mi'), 0.25)
  assert.equal(memoryGiB('1Gi'), 1)
  assert.ok(Math.abs(memoryGiB('512M') - 512e6 / 2 ** 30) < 1e-12)
  assert.equal(memoryGiB(''), null)
  assert.equal(memoryGiB('lots'), null)
  const options = parseArguments(['--project=demo-aura', '--hours=48', '--max-usd-per-day=2.5', '--json'])
  assert.deepEqual(options, { project: 'demo-aura', hours: 48, thresholds: { usdPerDay: 2.5 }, inventory: '', json: true })
  assert.throws(() => parseArguments(['--hours=24']), /--project/)
  assert.throws(() => parseArguments(['--project=demo-aura', '--hours=0']), /--hours/)
  assert.throws(() => parseArguments(['--project=demo-aura', '--max-usd-per-day=free']), /positive number/)
  assert.throws(() => parseArguments(['--project=demo-aura', 'now']), /Unknown argument/)
  assert.throws(() => evaluateUsage({ hours: 0, services: [], totals: {} }), /hours/)
  const report = formatReport(healthyDay(), evaluateUsage(healthyDay(), { inventory }))
  assert.match(report, /No alert and no warning\./)
  assert.match(report, /Cloud Billing Catalog 2026-11-11/)
  assert.equal(DEFAULT_THRESHOLDS.billableSecondsPerRequest, 30)
})
