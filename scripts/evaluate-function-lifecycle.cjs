'use strict'

// Local evidence evaluation only. Never imports business handlers, calls an
// endpoint, changes IAM, deletes deployments or records business payloads.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const DAY = 86_400_000
const SCOPES = ['frontend', 'fallback', 'scripts', 'external', 'internalRpc', 'triggerSchedulerBindings']
const RETRY_FLAGS = ['sharedIdempotencyKey', 'payloadConflictRejected', 'resultLookupAfterTimeout', 'noBlindCrossRegionRetry', 'sameAtomicCore']
const parseTime = (value) => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0
const evidence = (value) => Array.isArray(value) && value.length > 0 && value.every(nonempty)
const identity = (row) => `${row.region}/${row.name}`
const sameSource = (a, b) => Boolean(a?.commit && a?.digest && a.commit === b?.commit && a.digest === b?.digest)

function validateRegistry(registry) {
  const errors = []
  if (registry?.schemaVersion !== 1 || !nonempty(registry.project) || !Array.isArray(registry.entries)) return ['Invalid registry schema/project/entries']
  const policy = registry.policy || {}
  if (policy.deletionAllowed !== false) errors.push('Global deletionAllowed must remain false')
  if (!(policy.evidenceMaxAgeHours > 0 && policy.evidenceMaxAgeHours <= 24)) errors.push('Evidence freshness must be between 0 and 24 hours')
  if (!(policy.clockSkewMinutes >= 0 && policy.clockSkewMinutes <= 5)) errors.push('Clock skew must be between 0 and 5 minutes')
  if (!(policy.minimumNormalObservationDays >= 14)) errors.push('Normal observation must be at least 14 days')
  if (!(policy.minimumRareOrFinancialObservationDays >= 30)) errors.push('Rare/financial observation must be at least 30 days')
  const seen = new Set()
  for (const entry of registry.entries) {
    const key = identity(entry)
    if (seen.has(key)) errors.push(`Duplicate endpoint ${key}`)
    seen.add(key)
    if (!nonempty(entry.name) || !nonempty(entry.canonical) || !/^\w+-\w+\d$/.test(entry.region || '') || !nonempty(entry.reason)) errors.push(`Invalid endpoint identity/reason: ${key}`)
    if (!['deprecated-observing', 'retained-maintenance'].includes(entry.status)) errors.push(`Invalid status: ${key}`)
    if (!['normal', 'rare', 'financial'].includes(entry.risk) || !['read', 'write', 'disabled-write'].includes(entry.operation)) errors.push(`Invalid risk/operation: ${key}`)
    if (entry.deletionAllowed !== false) errors.push(`deletionAllowed must remain false: ${key}`)
    const minimum = entry.risk === 'normal' ? policy.minimumNormalObservationDays : policy.minimumRareOrFinancialObservationDays
    if (!Number.isInteger(entry.minimumObservationDays) || entry.minimumObservationDays < minimum) errors.push(`Observation window too short: ${key}`)
    if (entry.risk !== 'normal' && !(entry.minimumBusinessCycleDays >= 30)) errors.push(`A full business cycle of at least 30 days is required: ${key}`)
    const start = parseTime(entry.observationStart)
    const end = parseTime(entry.notBefore)
    if (!Number.isFinite(start)) errors.push(`Invalid observation start: ${key}`)
    if (entry.status === 'deprecated-observing' && !(end >= start + entry.minimumObservationDays * DAY)) errors.push(`notBefore does not cover observation: ${key}`)
    if (!Array.isArray(entry.coreToRetain) || entry.coreToRetain.some((core) => !/^functions\/[\w./-]+\.[cm]?js$/.test(core.file || '') || core.file.includes('..') || !/^[\w$]+$/.test(core.symbol || ''))) errors.push(`Invalid retained core specification: ${key}`)
    if (entry.replacement !== null && (!nonempty(entry.replacement?.name) || !nonempty(entry.replacement?.region) || identity(entry.replacement) === key)) errors.push(`Invalid replacement: ${key}`)
  }
  return errors
}

function sourceSnapshot(root) {
  const files = []
  function visit(directory) {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'coverage'].includes(entry.name)) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (/\.(?:[cm]?[jt]sx?|json|rules)$/.test(entry.name)) files.push(file)
    }
  }
  for (const directory of ['src', 'functions', 'scripts', 'tests', 'ops']) visit(path.join(root, directory))
  for (const name of ['package.json', 'package-lock.json', 'firebase.json', 'firestore.rules']) if (fs.existsSync(path.join(root, name))) files.push(path.join(root, name))
  const hash = crypto.createHash('sha256')
  for (const file of [...new Set(files)].sort()) hash.update(path.relative(root, file).replaceAll('\\', '/')).update('\0').update(fs.readFileSync(file)).update('\0')
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  return { commit, digest: hash.digest('hex'), fileCount: new Set(files).size }
}

function coreSymbolsInSource(root, registry) {
  const ts = require('typescript')
  const result = {}
  for (const core of registry.entries.flatMap((entry) => entry.coreToRetain)) {
    const key = `${core.file}#${core.symbol}`
    if (key in result) continue
    const file = path.join(root, core.file)
    result[key] = false
    if (!fs.existsSync(file)) continue
    const source = ts.createSourceFile(core.file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node) {
      if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && ts.isIdentifier(node.name) && node.name.text === core.symbol) result[key] = true
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return result
}

function dependencyTemplate(registry, source, now = new Date().toISOString()) {
  return {
    schemaVersion: 1, project: registry.project, observedAt: now, source, reviewer: null,
    notes: ['Pending evidence, not an approval. Complete a fresh review against this exact source digest. Do not paste business payloads or secrets.'],
    entries: registry.entries.map((entry) => ({
      name: entry.name, region: entry.region, reviewed: false, owner: null,
      reviewedScopes: Object.fromEntries(SCOPES.map((scope) => [scope, false])),
      callers: Object.fromEntries(SCOPES.filter((scope) => scope !== 'triggerSchedulerBindings').map((scope) => [scope, []])),
      triggerBindings: [], schedulerBindings: [], logicalReferenceOverrides: [],
      replacementVerified: false, retirementWithoutReplacementReviewed: false,
      preserveCore: { verified: false, testEvidence: [] },
      financialRetry: { ...Object.fromEntries(RETRY_FLAGS.map((flag) => [flag, false])), testEvidence: [] },
      businessCycle: { start: null, end: null, evidence: [] },
      rollbackReady: false, evidence: [],
    })),
  }
}

function evaluateLifecycle({ registry, staticAudit, metrics = null, dependencies = null, inventory = null, source, coreSymbols = {}, now = new Date().toISOString() }) {
  const errors = validateRegistry(registry)
  if (errors.length) throw new Error(errors.join('\n'))
  const time = parseTime(now)
  if (!Number.isFinite(time)) throw new Error('Invalid evaluation time')
  const maximumAge = registry.policy.evidenceMaxAgeHours * 3_600_000
  const skew = registry.policy.clockSkewMinutes * 60_000
  const common = []
  const addCommon = (code, detail) => common.push({ code, detail })
  function fresh(value) { const date = parseTime(value); return Number.isFinite(date) && date <= time + skew && date >= time - maximumAge }
  if (!source?.commit || !source?.digest) addCommon('SOURCE_UNKNOWN', 'Current commit and content digest are required.')
  if (!sameSource(staticAudit?.source, source) || staticAudit?.snapshotStable !== true || !fresh(staticAudit?.generatedAt)) addCommon('STATIC_SOURCE_STALE', 'Static analysis must be fresh and bound to the unchanged current source.')
  if (!Array.isArray(staticAudit?.frontendCallables) || !Array.isArray(staticAudit?.backendExports)) addCommon('STATIC_UNKNOWN', 'Static frontend/backend coverage is unavailable.')
  if (staticAudit?.coverage?.unresolvedExportSpreads !== 0 || staticAudit?.coverage?.unresolvedComputedExports !== 0 || staticAudit?.coverage?.unresolvedDynamicImports !== 0) addCommon('STATIC_UNRESOLVED', 'Unresolved or unreported import/export coverage needs review.')
  if (dependencies?.schemaVersion !== 1 || dependencies?.project !== registry.project || !Array.isArray(dependencies?.entries)) addCommon('DEPENDENCIES_UNKNOWN', 'A reviewed dependency artifact for this project is required.')
  if (!sameSource(dependencies?.source, source) || !fresh(dependencies?.observedAt)) addCommon('DEPENDENCY_SOURCE_STALE', 'Dependency evidence must match the current commit and source digest.')
  if (!nonempty(dependencies?.reviewer)) addCommon('DEPENDENCY_REVIEW_PENDING', 'The dependency review is not attributed.')
  if (metrics?.project !== registry.project || !fresh(metrics?.observedAt) || !Array.isArray(metrics?.warnings) || metrics.warnings.length || !metrics?.windows || typeof metrics.windows !== 'object') addCommon('METRICS_UNKNOWN_OR_STALE', 'A fresh successful project request-metric query is required; missing data is not zero.')
  if (inventory?.project !== registry.project || !fresh(inventory?.observedAt) || !Array.isArray(inventory?.warnings) || inventory.warnings.length || !Array.isArray(inventory?.functions)) addCommon('INVENTORY_UNKNOWN_OR_STALE', 'A fresh successful deployment inventory is required.')
  const rows = registry.entries.map((entry) => {
    const issues = [...common]
    const issue = (code, detail, retain = false) => issues.push({ code, detail, retain })
    const key = identity(entry)
    const start = parseTime(entry.observationStart)
    const notBefore = parseTime(entry.notBefore)
    const matches = (list) => (Array.isArray(list) ? list : []).filter((row) => identity(row) === key)
    const dependencyMatches = matches(dependencies?.entries)
    const review = dependencyMatches.length === 1 ? dependencyMatches[0] : null
    const liveMatches = matches(inventory?.functions)
    const live = liveMatches.length === 1 ? liveMatches[0] : null
    const backend = staticAudit?.backendExports?.find((row) => row.name === entry.name)
    if (entry.status === 'retained-maintenance') issue('MAINTENANCE_RETAINED', 'Public wrapper/core retirement requires a separate maintenance decision.', true)
    if (!(time >= notBefore) && entry.status !== 'retained-maintenance') issue('OBSERVATION_INCOMPLETE', `Observe until at least ${entry.notBefore}.`)
    if (!live || live.kind !== 'callable') issue('DEPLOYED_CALLABLE_UNVERIFIED', 'The exact endpoint/region is absent, ambiguous, or not callable.', Boolean(live && live.kind !== 'callable'))
    if (!backend || !Array.isArray(backend.kinds) || backend.kinds.length !== 1 || backend.kinds[0] !== 'callable') issue('SOURCE_CALLABLE_UNVERIFIED', 'The export must still be a callable; triggers/schedulers cannot be retired by this tool.', Boolean(backend?.kinds?.some((kind) => ['scheduled', 'event-trigger'].includes(kind))))
    if (!review || review.reviewed !== true || !nonempty(review.owner) || !evidence(review.evidence)) issue('ENDPOINT_REVIEW_PENDING', 'An owner and concrete per-endpoint dependency evidence are required.')
    for (const scope of SCOPES) if (review?.reviewedScopes?.[scope] !== true) issue('DEPENDENCY_SCOPE_UNREVIEWED', scope)
    for (const scope of SCOPES.filter((value) => value !== 'triggerSchedulerBindings')) {
      const callers = review?.callers?.[scope]
      if (!Array.isArray(callers)) issue('CALLERS_UNKNOWN', scope)
      else if (callers.length) issue('DEPENDENCY_CALLER_ACTIVE', `${scope}: ${callers.length} caller(s) recorded.`, true)
    }
    for (const field of ['triggerBindings', 'schedulerBindings']) {
      if (!Array.isArray(review?.[field])) issue('BACKGROUND_BINDINGS_UNKNOWN', field)
      else if (review[field].length) issue('BACKGROUND_BINDING_ACTIVE', field, true)
    }
    const rawReferences = staticAudit?.frontendCallables?.find((row) => row.name === entry.name)?.references || []
    const excludedLogicalReferences = []
    const activeReferences = rawReferences.filter((reference) => {
      // Only reviewed non-transport logical-name translations can be excluded.
      // A direct httpsCallable/fallback request cannot be hidden by an override.
      const override = review?.logicalReferenceOverrides?.find((item) => item.file === reference.file && item.line === reference.line && item.transport === reference.transport)
      const excluded = sameSource(dependencies?.source, source) && review?.reviewed === true && entry.replacement && reference.directTransport === false && !/httpsCallable/.test(reference.transport || '') && override?.kind === 'logical-name-only' && override.noWireCall === true && override.replacement === entry.replacement.name && evidence(override.evidence)
      if (excluded) excludedLogicalReferences.push(reference)
      return !excluded
    })
    if (activeReferences.length) issue('STATIC_CALLER_ACTIVE', `${activeReferences.length} current or fallback static reference(s).`, true)
    const metricKey = `${entry.region}/${live?.service || entry.name.toLowerCase()}`.toLowerCase()
    const windowEvidence = []
    let recordedRequests = 0
    for (const [name, window] of Object.entries(metrics?.windows || {})) {
      const from = parseTime(window?.start), to = parseTime(window?.end)
      if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from) || to > time + skew) continue
      if (to < start) continue
      const groups = Array.isArray(window.groups) ? window.groups.filter((group) => String(group.key).toLowerCase() === metricKey) : null
      const known = groups !== null && groups.every((group) => Number.isFinite(group.requests) && group.requests >= 0)
      const requests = known ? groups.reduce((sum, group) => sum + group.requests, 0) : null
      if (requests > 0) recordedRequests += requests
      const complete = window.status === 'complete' && known
      const coversObservation = complete && from <= start && to >= notBefore && to >= time - maximumAge && to - start >= entry.minimumObservationDays * DAY
      windowEvidence.push({ name, start: window.start, end: window.end, complete, coversObservation, requests, matchingSeries: groups?.length ?? null })
    }
    if (recordedRequests > 0) issue('RECORDED_TRAFFIC', 'Requests were recorded in a window overlapping observation (including preflights/errors).', true)
    const covering = windowEvidence.filter((window) => window.coversObservation && window.requests === 0)
    if (!covering.length) issue('METRICS_WINDOW_INCOMPLETE', 'Require a successful zero-request window covering the full observation through a fresh end time.')
    for (const core of entry.coreToRetain) if (coreSymbols[`${core.file}#${core.symbol}`] !== true) issue('RETAINED_CORE_MISSING', `${core.file}#${core.symbol}`, true)
    if (entry.coreToRetain.length && (review?.preserveCore?.verified !== true || !evidence(review?.preserveCore?.testEvidence))) issue('CORE_PRESERVATION_UNVERIFIED', 'Keep core and verify internal callers/retry paths with test evidence.')
    if (entry.replacement) {
      const replacement = inventory?.functions?.find((row) => identity(row) === identity(entry.replacement))
      const replacementSource = staticAudit?.backendExports?.find((row) => row.name === entry.replacement.name)
      const serving = replacement?.kind === 'callable' && replacement?.state === 'ACTIVE' && replacement?.servingRevisions?.length > 0 && replacement?.traffic?.some((target) => target.percent > 0)
      if (!replacementSource?.kinds?.includes('callable') || !serving || review?.replacementVerified !== true) issue('REPLACEMENT_UNVERIFIED', 'The exact replacement export and a serving deployment must be verified; latest-created mismatch alone is not failure.')
    } else if (review?.retirementWithoutReplacementReviewed !== true) issue('NO_REPLACEMENT_REVIEW_PENDING', 'Confirm whether this flow can retire without a replacement.')
    if (entry.risk !== 'normal') {
      const cycle = review?.businessCycle
      const from = parseTime(cycle?.start), to = parseTime(cycle?.end)
      if (!(from >= start && to <= time && to - from >= entry.minimumBusinessCycleDays * DAY && evidence(cycle?.evidence) && covering.some((window) => parseTime(window.end) >= to))) issue('BUSINESS_CYCLE_INCOMPLETE', 'Evidence of a full observed business cycle is required for financial or infrequent operations.')
    }
    if (entry.risk === 'financial' && entry.operation !== 'read' && (!RETRY_FLAGS.every((flag) => review?.financialRetry?.[flag] === true) || !evidence(review?.financialRetry?.testEvidence))) issue('FINANCIAL_RETRY_UNVERIFIED', 'Verify stable idempotency, payload conflicts, result lookup after timeout, atomic core and no blind cross-region retry.')
    if (review?.rollbackReady !== true) issue('ROLLBACK_UNVERIFIED', 'Record a tested recovery path before retirement review.')
    const decision = issues.some((item) => item.retain) ? 'retain' : issues.length ? 'review' : 'eligible'
    return { name: entry.name, region: entry.region, canonical: entry.canonical, status: entry.status, decision, gatePassed: decision === 'eligible', deletionAllowed: false, issues, activeReferences, excludedLogicalReferences, windowEvidence, coreToRetain: entry.coreToRetain }
  })
  return {
    schemaVersion: 1, project: registry.project, generatedAt: now, source,
    deletionAllowed: false,
    meaning: 'eligible means evidence is ready for an explicit retirement change review; this report never authorizes or executes deletion.',
    summary: { total: rows.length, eligible: rows.filter((row) => row.decision === 'eligible').length, review: rows.filter((row) => row.decision === 'review').length, retain: rows.filter((row) => row.decision === 'retain').length },
    entries: rows,
    limitations: ['No-series in a complete metric query means no recorded container requests, not proof of no external/older client.', 'Static routing overapproximates parameter guards; exact logical-name exceptions need source-bound review.', 'Dependency artifacts are attributed review evidence, not cryptographic proof. Changed source requires another review.', 'Latest-created revision not serving does not mean the endpoint is down. Never remove shared core or Firebase discovery exports from these counts.'],
  }
}

function renderReport(report) {
  return ['AURA FUNCTION LIFECYCLE — EVIDENCE ONLY', `Source: ${report.source?.commit} / ${report.source?.digest}`, JSON.stringify(report.summary), report.meaning, 'deletionAllowed: false', '', ...report.entries.map((row) => `${row.decision.toUpperCase()} ${row.region}/${row.name}\n  ${row.issues.map((item) => `${item.code}: ${item.detail}`).join('\n  ') || 'All evidence gates passed; deletion is still not authorized.'}`), '', ...report.limitations].join('\n') + '\n'
}

function runCli(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write('node scripts/evaluate-function-lifecycle.cjs [--root=.] [--registry=ops/function-lifecycle.json] [--metrics=activity.json] [--inventory=live.json] [--dependencies=review.json] [--output=report.json] [--dependency-template=pending-review.json]\nRuns a fresh static audit; missing evidence blocks eligibility. No deletion or network calls.\n')
    return
  }
  const allowed = new Set(['root', 'registry', 'metrics', 'inventory', 'dependencies', 'output', 'dependency-template'])
  for (const argument of argv) if (!/^--[^=]+=.+$/.test(argument) || !allowed.has(argument.slice(2).split('=')[0])) throw new Error(`Unknown or invalid argument: ${argument}`)
  const argument = (name) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
  const root = path.resolve(argument('root') || process.cwd())
  const read = (file) => file ? JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8').replace(/^\uFEFF/, '')) : null
  const registryPath = argument('registry') || 'ops/function-lifecycle.json'
  const registry = read(registryPath)
  const errors = validateRegistry(registry)
  if (errors.length) throw new Error(errors.join('\n'))
  const protectedPaths = [registryPath, argument('metrics'), argument('inventory'), argument('dependencies')].filter(Boolean).map((file) => path.resolve(root, file).toLowerCase())
  const artifactPaths = [argument('output'), argument('dependency-template')].filter(Boolean).map((file) => path.resolve(root, file))
  if (argument('output')) artifactPaths.push(path.resolve(root, argument('output')).replace(/\.json$/i, '') + '.txt')
  if (new Set(artifactPaths.map((file) => file.toLowerCase())).size !== artifactPaths.length) throw new Error('Report/template artifact paths must be distinct.')
  for (const file of artifactPaths) {
    const relative = path.relative(root, file).replaceAll('\\', '/')
    if (protectedPaths.includes(file.toLowerCase()) || !/^tmp\//i.test(relative) || !/\.(?:json|txt)$/i.test(file)) throw new Error('Artifact output must stay under tmp/ and must not overwrite source, configuration or input evidence.')
  }
  for (const option of ['output', 'dependency-template']) if (argument(option) && !/\.json$/i.test(argument(option))) throw new Error(`${option} must be a .json artifact path.`)
  if (argument('dependency-template') && fs.existsSync(path.resolve(root, argument('dependency-template')))) throw new Error('Refusing to overwrite existing dependency review evidence.')
  const source = sourceSnapshot(root)
  const inventory = read(argument('inventory'))
  const { auditProject } = require('./audit-callable-usage.cjs')
  const staticAudit = auditProject(root, { liveInventory: inventory })
  staticAudit.source = source
  const coreSymbols = coreSymbolsInSource(root, registry)
  staticAudit.snapshotStable = sameSource(source, sourceSnapshot(root))
  const report = evaluateLifecycle({ registry, staticAudit, inventory, metrics: read(argument('metrics')), dependencies: read(argument('dependencies')), source, coreSymbols })
  function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data) }
  if (argument('dependency-template')) {
    const target = path.resolve(root, argument('dependency-template'))
    write(target, JSON.stringify(dependencyTemplate(registry, source), null, 2) + '\n')
  }
  if (argument('output')) {
    const output = path.resolve(root, argument('output'))
    write(output, JSON.stringify(report, null, 2) + '\n')
    write(output.replace(/\.json$/i, '') + '.txt', renderReport(report))
  }
  process.stdout.write(JSON.stringify({ summary: report.summary, source, deletionAllowed: false, output: argument('output') || null }, null, 2) + '\n')
}

if (require.main === module) {
  try { runCli() } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
module.exports = { validateRegistry, sourceSnapshot, coreSymbolsInSource, dependencyTemplate, evaluateLifecycle, renderReport, runCli }
