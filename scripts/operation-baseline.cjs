'use strict'
// Read-only Cloud Logging collection. Raw entries stay in memory; only numeric
// aggregates and endpoint/release names are written. This never queries user data.
const fs = require('node:fs')
const path = require('node:path')
const METRICS = ['logicalQueries', 'documentsReturned', 'cacheHits', 'cacheMisses', 'responseBytes', 'projectionAgeMs', 'queueWaitMs', 'processingMs']
const EXPECTED = ['getOperationsDashboard', 'getStudent360Overview', 'getMyNutritionJournalSummary', 'renewPtContract', 'getAcademyAnalyticsSummary', 'listFinanceReceivables', 'enqueueNutritionScan', 'nutritionScanCompletion']
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
function quantile(rows, key, fraction) {
  const values = rows.filter(row => finite(row[key])).sort((a, b) => a[key] - b[key])
  if (!values.length) return null
  const target = values.reduce((sum, row) => sum + row.weight, 0) * fraction
  let sum = 0
  for (const row of values) { sum += row.weight; if (sum >= target) return row[key] }
  return values.at(-1)[key]
}
function summarize(entries, { complete = true, project = 'unknown', start, end, expected = EXPECTED } = {}) {
  const groups = new Map(expected.map(name => [name, []]))
  const seen = new Set()
  for (const entry of entries) {
    const value = entry.jsonPayload || entry
    if (value.message !== 'Aura function metric' || !/^[A-Za-z][A-Za-z0-9_]{0,100}$/.test(value.operation || '') || !['success', 'error'].includes(value.outcome) || !finite(value.durationMs)) continue
    const id = entry.insertId ? `${entry.logName}:${entry.insertId}` : null
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    const rate = value.sampleRate === undefined ? 1 : value.sampleRate
    if (!finite(rate) || rate <= 0 || rate > 1) continue
    const row = { weight: 1 / rate, outcome: value.outcome, durationMs: value.durationMs, release: /^[A-Za-z0-9_.-]{1,150}$/.test(value.release || '') ? value.release : null }
    for (const key of METRICS) if (finite(value.metrics?.[key])) row[key] = value.metrics[key]
    if (!groups.has(value.operation)) groups.set(value.operation, [])
    groups.get(value.operation).push(row)
  }
  return {
    schemaVersion: 1, project, observedAt: new Date().toISOString(), range: { start: start || null, end: end || null },
    complete, warning: complete ? null : 'Page limit reached. This is a partial log window; do not compare request totals or infer zero traffic.',
    billing: 'Application observations only; document counts are not Firestore billed reads. No currency estimate is inferred.',
    operations: [...groups].map(([operation, rows]) => {
      const requests = rows.reduce((sum, row) => sum + row.weight, 0)
      const failures = rows.filter(row => row.outcome === 'error').reduce((sum, row) => sum + row.weight, 0)
      const measured = Object.fromEntries(METRICS.map(key => {
        const observed = rows.filter(row => finite(row[key]))
        const count = observed.reduce((sum, row) => sum + row.weight, 0)
        return [key, { sampleCount: observed.length, measuredRequestShare: requests ? count / requests : null, meanWhenMeasured: count ? observed.reduce((sum, row) => sum + row[key] * row.weight, 0) / count : null }]
      }))
      return { operation, status: !rows.length ? 'unknown' : complete ? 'observed' : 'partial', sampleCount: rows.length,
        estimatedRequests: rows.length && complete ? requests : null, estimatedFailuresPer1000: requests ? failures / requests * 1000 : null,
        latencyMs: { p50: quantile(rows, 'durationMs', .5), p95: quantile(rows, 'durationMs', .95) }, measured,
        releases: [...new Set(rows.map(row => row.release).filter(Boolean))] }
    }),
  }
}
async function collect({ project, hours = 24, maxPages = 20, token, fetcher = fetch, now = Date.now() }) {
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project || '')) throw new Error('Invalid project.')
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('Use hours 1–168 and max-pages 1–100.')
  const start = new Date(now - hours * 3600000).toISOString()
  const end = new Date(now).toISOString()
  const entries = []
  let pageToken
  let pages = 0
  do {
    const response = await fetcher('https://logging.googleapis.com/v2/entries:list', {
      method: 'POST', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceNames: [`projects/${project}`], filter: `jsonPayload.message="Aura function metric" AND timestamp>="${start}" AND timestamp<"${end}"`, orderBy: 'timestamp desc', pageSize: 1000, ...(pageToken ? { pageToken } : {}) }),
    })
    if (!response.ok) throw new Error(`Cloud Logging read failed: HTTP ${response.status}.`)
    const body = await response.json()
    entries.push(...(body.entries || []))
    pageToken = body.nextPageToken
    pages += 1
  } while (pageToken && pages < maxPages)
  return summarize(entries, { complete: !pageToken, project, start, end })
}
async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => { const index = arg.indexOf('='); return [arg.slice(2, index), arg.slice(index + 1)] }))
  if (!args.out || (!args.input && !args.project)) throw new Error('Usage: node scripts/operation-baseline.cjs --project=PROJECT --hours=24 --out=REPORT.json OR --input=LOCAL_LOG_EXPORT.json --out=REPORT.json')
  let report
  if (args.input) {
    const input = JSON.parse(fs.readFileSync(args.input, 'utf8'))
    report = summarize(Array.isArray(input) ? input : input.entries || [], { complete: !input.nextPageToken, project: args.project || 'local-export' })
  } else {
    const cliLib = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib')
    const auth = require(path.join(cliLib, 'auth.js'))
    const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
    if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
    const token = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token
    if (!token) throw new Error('Unable to obtain a Firebase access token.')
    report = await collect({ project: args.project, hours: Number(args.hours || 24), maxPages: Number(args['max-pages'] || 20), token })
  }
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
  fs.writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ report: args.out, complete: report.complete, observed: report.operations.filter(row => row.status !== 'unknown').length, unknown: report.operations.filter(row => row.status === 'unknown').length }))
}
if (require.main === module) main().catch(error => { console.error(error.message?.startsWith('Cloud Logging read failed') || error.message?.startsWith('Usage:') ? error.message : 'Baseline collection failed. Check CLI credentials and arguments; no production data was changed.'); process.exitCode = 1 })
module.exports = { summarize, collect }
