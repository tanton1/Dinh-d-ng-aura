'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const {
  accessToken,
  canonicalJson,
  databaseResource,
  encodeFields,
  entityHash,
  readCollection,
  requestJson,
  TARGET,
} = require('./firebase-pt-contract-daily-usage-repair.cjs')
const {
  canonicalUsageSessions,
  sessionCountsTowardContract,
  summarizeContractUsage,
} = require('../functions/contract-usage')
const { effectiveContractStatus } = require('../functions/contract-status')
const { usageViewFingerprint, viewFromSummary, USAGE_VIEW_SCHEMA_VERSION } = require('../functions/contract-usage-view')

const PLAN_VERSION = 'pt-contract-daily-view-rebuild-v1'
const CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}:apply-daily-unique-usage-views`
const PRIVATE_DIR = path.resolve('.migration-private')
const REPORTS = Object.freeze({
  'dry-run': path.join(PRIVATE_DIR, 'firebase-pt-contract-daily-view-rebuild-dry-run.json'),
  apply: path.join(PRIVATE_DIR, 'firebase-pt-contract-daily-view-rebuild-apply.json'),
  verify: path.join(PRIVATE_DIR, 'firebase-pt-contract-daily-view-rebuild-verify.json'),
})
const MAX_COMMIT_WRITES = 490

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex') }
function saigonToday() { return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10) }
function safeCount(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0 }
function contractStudentId(contract = {}) { return String(contract.studentId || contract.crmProfileId || '').trim() }
function writeJson(filePath, value) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

function parseArguments(argv) {
  const result = { mode: 'dry-run', asOf: saigonToday() }
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') result.help = true
    else if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice(10)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice(11)
    else if (argument.startsWith('--as-of=')) result.asOf = argument.slice(8)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirmation = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.asOf)) throw new Error('as-of must be YYYY-MM-DD.')
  return result
}

function usage() {
  return `Dry run: node scripts/firebase-pt-contract-daily-view-rebuild.cjs --as-of=YYYY-MM-DD\nApply: node scripts/firebase-pt-contract-daily-view-rebuild.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --as-of=YYYY-MM-DD --digest=<digest> --confirm=${CONFIRMATION}\nVerify: node scripts/firebase-pt-contract-daily-view-rebuild.cjs --mode=verify --as-of=YYYY-MM-DD`
}

function assertTarget(arguments_) {
  if (arguments_.projectId && arguments_.projectId !== TARGET.projectId) throw new Error('Unexpected target project.')
  if (arguments_.databaseId && arguments_.databaseId !== TARGET.databaseId) throw new Error('Unexpected target database.')
  if (arguments_.mode === 'apply') {
    if (arguments_.projectId !== TARGET.projectId || arguments_.databaseId !== TARGET.databaseId) throw new Error('Apply requires exact target guards.')
    if (!/^[a-f0-9]{64}$/.test(arguments_.digest || '')) throw new Error('Apply requires the latest dry-run digest.')
    if (arguments_.confirmation !== CONFIRMATION) throw new Error('Apply confirmation is missing or incorrect.')
  }
}

function viewForContract(contract, rows) {
  const raw = rows.map((row) => ({ id: row.id, ...row.fields }))
  const canonical = canonicalUsageSessions(raw)
  const summary = summarizeContractUsage(contract.fields, raw)
  const view = {
    ...viewFromSummary(contract.id, contract.fields, summary),
    evidenceSessions: canonical.length,
    rawEvidenceSessions: raw.length,
    evidenceTruncated: false,
  }
  return { view, sourceFingerprint: usageViewFingerprint(view), canonical, raw }
}

function buildPlan(contracts, sessions, views, asOf = saigonToday()) {
  const rowsByContract = new Map()
  const invalidLinks = []
  const contractMap = new Map(contracts.map((item) => [item.id, item]))
  for (const session of sessions) {
    const contractId = String(session.fields.contractId || '').trim()
    if (!contractId || !contractMap.has(contractId)) continue
    const contract = contractMap.get(contractId)
    const expected = contractStudentId(contract.fields)
    const actual = String(session.fields.studentId || '').trim()
    if (effectiveContractStatus(contract.fields, asOf) === 'active'
      && sessionCountsTowardContract(session.fields)
      && (!actual || actual !== expected)) {
      invalidLinks.push({ sessionHash: entityHash('sessions', session.id), reason: actual ? 'STUDENT_MISMATCH' : 'STUDENT_MISSING' })
      continue
    }
    rowsByContract.set(contractId, [...(rowsByContract.get(contractId) || []), session])
  }
  const updates = []
  const activeContractIds = []
  for (const contract of contracts) {
    if (effectiveContractStatus(contract.fields, asOf) !== 'active') continue
    activeContractIds.push(contract.id)
    const result = viewForContract(contract, rowsByContract.get(contract.id) || [])
    const existing = views.get(contract.id)
    const existingFingerprint = String(existing?.fields?.sourceFingerprint || '')
    const needsUpdate = !existing
      || Number(existing.fields.schemaVersion || 0) !== USAGE_VIEW_SCHEMA_VERSION
      || existing.fields.sourceVersion !== 'contract-usage-v3-daily'
      || existingFingerprint !== result.sourceFingerprint
      || Number(existing.fields.usedSessions || 0) !== Number(result.view.usedSessions || 0)
    if (!needsUpdate) continue
    const publicDigest = sha256(canonicalJson({
      contractHash: entityHash('contracts', contract.id),
      contractFingerprint: contract.fingerprint,
      viewFingerprint: result.sourceFingerprint,
      existingViewFingerprint: existingFingerprint,
      rawEvidenceSessions: result.raw.length,
      canonicalEvidenceSessions: result.canonical.length,
    }))
    updates.push({
      contractId: contract.id,
      updateTime: existing?.updateTime || null,
      exists: Boolean(existing),
      fields: result.view,
      sourceFingerprint: result.sourceFingerprint,
      rawEvidenceSessions: result.raw.length,
      canonicalEvidenceSessions: result.canonical.length,
      duplicateHistorySessions: Math.max(0, result.raw.length - result.canonical.length),
      publicDigest,
    })
  }
  activeContractIds.sort()
  updates.sort((left, right) => left.contractId.localeCompare(right.contractId))
  const planDigest = sha256(canonicalJson({
    planVersion: PLAN_VERSION,
    target: TARGET,
    asOf,
    activeContractIds: activeContractIds.map((id) => entityHash('contracts', id)),
    updates: updates.map((item) => item.publicDigest),
    invalidLinks,
  }))
  return { planDigest, asOf, activeContractIds, updates, invalidLinks }
}

function updateWrite(item) {
  const fields = { ...item.fields }
  delete fields.generatedAt
  return {
    update: { name: `${databaseResource()}/documents/contractUsageViews/${item.contractId}`, fields: encodeFields({ ...fields, sourceFingerprint: item.sourceFingerprint }) },
    updateMask: { fieldPaths: Object.keys(fields).filter((field) => field !== 'sourceFingerprint').concat('sourceFingerprint') },
    ...(item.exists ? { currentDocument: { updateTime: item.updateTime } } : { currentDocument: { exists: false } }),
    updateTransforms: [{ fieldPath: 'generatedAt', setToServerValue: 'REQUEST_TIME' }],
  }
}

function auditWrite(plan) {
  const id = `pt_usage_view_daily_${plan.planDigest.slice(0, 36)}`
  return {
    update: {
      name: `${databaseResource()}/documents/contractUsageAuditLogs/${id}`,
      fields: encodeFields({ schemaVersion: 3, action: 'contract_usage.daily_unique_views_rebuilt', actorUid: `system:${PLAN_VERSION}`, planDigest: plan.planDigest, asOf: plan.asOf, updatedViews: plan.updates.length }),
    },
    currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
  }
}

function publicReport(mode, contracts, sessions, views, plan, extra = {}) {
  return {
    generatedAt: new Date().toISOString(), mode, target: TARGET, asOf: plan.asOf, planVersion: PLAN_VERSION, planDigest: plan.planDigest,
    writeScope: mode === 'apply' ? 'active contractUsageViews daily unique rebuild; sessions, attendance and contracts unchanged' : 'none',
    inventory: { contracts: contracts.length, sessions: sessions.length, views: views.length, activeContracts: plan.activeContractIds.length },
    usageViews: {
      updates: plan.updates.length,
      duplicateHistoryRows: plan.updates.reduce((sum, item) => sum + item.duplicateHistorySessions, 0),
      rawEvidenceSessions: plan.updates.reduce((sum, item) => sum + item.rawEvidenceSessions, 0),
      canonicalEvidenceSessions: plan.updates.reduce((sum, item) => sum + item.canonicalEvidenceSessions, 0),
    },
    blockers: { invalidLinks: plan.invalidLinks },
    piiPolicy: 'Reports contain only counts and SHA-256 hashes.',
    ...extra,
  }
}

async function state(token, asOf) {
  const [contracts, sessions, views] = await Promise.all([
    readCollection(token, 'contracts'),
    readCollection(token, 'sessions'),
    readCollection(token, 'contractUsageViews'),
  ])
  return { contracts, sessions, views, plan: buildPlan(contracts, sessions, new Map(views.map((view) => [view.id, view])), asOf) }
}

function loadDryRun(digest, asOf) {
  if (!fs.existsSync(REPORTS['dry-run'])) throw new Error('Dry-run report is missing.')
  const report = JSON.parse(fs.readFileSync(REPORTS['dry-run'], 'utf8'))
  if (report.mode !== 'dry-run' || report.planVersion !== PLAN_VERSION || report.planDigest !== digest || report.asOf !== asOf || canonicalJson(report.target) !== canonicalJson(TARGET)) throw new Error('Dry-run report, digest or as-of is invalid.')
}

async function dryRun(token, arguments_) {
  const current = await state(token, arguments_.asOf)
  const report = publicReport('dry-run', current.contracts, current.sessions, current.views, current.plan, { writesPerformed: false, applyConfirmation: CONFIRMATION })
  writeJson(REPORTS['dry-run'], report)
  console.log(JSON.stringify({ mode: 'dry-run', asOf: arguments_.asOf, planDigest: current.plan.planDigest, activeContracts: current.plan.activeContractIds.length, viewUpdates: current.plan.updates.length, invalidLinks: current.plan.invalidLinks.length, reportPath: REPORTS['dry-run'], writesPerformed: false }, null, 2))
}

async function apply(token, arguments_) {
  loadDryRun(arguments_.digest, arguments_.asOf)
  const before = await state(token, arguments_.asOf)
  if (before.plan.planDigest !== arguments_.digest) throw new Error('Live plan changed after dry-run; apply aborted.')
  if (before.plan.invalidLinks.length) throw new Error('Apply blocked by invalid active-contract session links.')
  const writes = [...before.plan.updates.map(updateWrite), auditWrite(before.plan)]
  if (writes.length > MAX_COMMIT_WRITES) throw new Error(`Apply blocked: ${writes.length} writes exceed the atomic safety limit.`)
  const viewMap = new Map(before.views.map((item) => [item.id, item]))
  const backupPath = path.join(PRIVATE_DIR, `firebase-pt-contract-daily-view-rebuild-backup-${before.plan.planDigest}.json`)
  writeJson(backupPath, { generatedAt: new Date().toISOString(), target: TARGET, asOf: arguments_.asOf, planVersion: PLAN_VERSION, planDigest: before.plan.planDigest, views: before.plan.updates.map((item) => ({ id: item.contractId, updateTime: item.updateTime, before: viewMap.get(item.contractId)?.fields || null })) })
  await requestJson(token, '/documents:commit', { method: 'POST', body: JSON.stringify({ writes }) })
  const after = await state(token, arguments_.asOf)
  const verified = after.plan.updates.length === 0 && after.plan.invalidLinks.length === 0
  writeJson(REPORTS.apply, publicReport('apply', after.contracts, after.sessions, after.views, after.plan, { writesPerformed: true, committedWrites: writes.length, approvedDryRunDigest: arguments_.digest, backupPath, verified }))
  console.log(JSON.stringify({ mode: 'apply', committedWrites: writes.length, verified, remainingViewUpdates: after.plan.updates.length, invalidLinks: after.plan.invalidLinks.length, reportPath: REPORTS.apply, backupPath }, null, 2))
  if (!verified) process.exitCode = 2
}

async function verify(token, arguments_) {
  const current = await state(token, arguments_.asOf)
  const verified = current.plan.updates.length === 0 && current.plan.invalidLinks.length === 0
  writeJson(REPORTS.verify, publicReport('verify', current.contracts, current.sessions, current.views, current.plan, { writesPerformed: false, verified }))
  console.log(JSON.stringify({ mode: 'verify', asOf: arguments_.asOf, verified, viewUpdates: current.plan.updates.length, invalidLinks: current.plan.invalidLinks.length, reportPath: REPORTS.verify }, null, 2))
  if (!verified) process.exitCode = 2
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2))
  if (arguments_.help) return console.log(usage())
  assertTarget(arguments_)
  const token = await accessToken()
  const metadata = await requestJson(token, '')
  if (metadata?.name !== databaseResource()) throw new Error('Live database does not match the approved target.')
  if (arguments_.mode === 'dry-run') await dryRun(token, arguments_)
  else if (arguments_.mode === 'apply') await apply(token, arguments_)
  else await verify(token, arguments_)
}

if (require.main === module) main().catch((error) => { console.error(error instanceof Error ? error.message : 'Daily unique usage view rebuild failed.'); process.exitCode = 1 })

module.exports = { PLAN_VERSION, TARGET, buildPlan, viewForContract }
