'use strict'

// Metadata-only repair for already-existing, manually scheduled cross-branch
// sessions. Never creates/deletes sessions or changes attendance/billing/quota.
const fs = require('node:fs')
const path = require('node:path')
const { TARGET, accessToken, requestJson } = require('./firebase-pt-schedule-audit.cjs')
const { buildAudit, loadState, digest } = require('./firebase-pt-schedule-week-audit.cjs')
const VERSION = 'cross-branch-week-v1'
function encode(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return { integerValue: String(value) }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
  if (value && typeof value === 'object') return { mapValue: { fields: fields(value) } }
  throw Error('Unsupported value in patch')
}
const fields = (value) => Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]))
const documentPrefix = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents`

function prepareWrites(state, audit) {
  const documents = new Map([...state.sessions, ...state.schedules, ...state.drafts].map((d) => [d.name, d]))
  const changes = new Map(), dependencies = new Map()
  const actor = `maintenance:${VERSION}`
  const auditId = `${VERSION}_${state.week}_${audit.digest.slice(0, 20)}`
  const addDependency = (doc) => {
    if (!doc?.name || !doc?.updateTime) throw Error('Missing dependency or precondition')
    dependencies.set(doc.name, doc)
  }
  for (const repair of audit.repairs) {
    const session = documents.get(repair.sessionName), source = documents.get(repair.sourceName)
    addDependency(session); addDependency(source)
    addDependency(state.students.find((d) => d.id === repair.studentId))
    addDependency(state.trainers.find((d) => d.id === repair.trainerId))
    addDependency(state.contracts.find((d) => d.id === repair.contractId))
    addDependency(state.branches.find((d) => d.id === (repair.entryPatch?.branchId || repair.sessionPatch.branchId || session.data.branchId)))
    const permitted = ['branchId', 'studentBranchWarning', 'studentHomeBranchId']
    if (Object.keys(repair.sessionPatch).some((k) => !permitted.includes(k))) throw Error('Non-metadata session patch rejected')
    if (Object.keys(repair.sessionPatch).length) changes.set(session.name, {
      doc: session, patch: { ...repair.sessionPatch, revision: Number(session.data.revision || 0) + 1, updatedBy: actor, crossBranchSyncAuditId: auditId },
    })
    if (repair.entryPatch) {
      if (!changes.has(source.name)) changes.set(source.name, { doc: source, patch: { schedule: structuredClone(source.data.schedule), crossBranchSyncAuditId: auditId } })
      Object.assign(changes.get(source.name).patch.schedule[repair.slot][repair.index], repair.entryPatch)
    }
  }
  const writes = [...changes.values()].map(({ doc, patch }) => ({
    update: { name: doc.name, fields: fields(patch) }, updateMask: { fieldPaths: Object.keys(patch) },
    updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }], currentDocument: { updateTime: doc.updateTime },
  }))
  if (writes.length) writes.push({
    update: { name: `${documentPrefix}/ptOperationsAuditLogs/${auditId}`, fields: fields({
      schemaVersion: 2, action: 'pt_schedule.cross_branch_metadata_synced', actorUid: actor, weekId: state.week,
      reason: 'User approved syncing already-manually-assigned cross-branch sessions for the current week.',
      planDigest: audit.digest, metadataOnly: true, sessionCount: audit.publicPlan.repairSessions,
      repairs: audit.repairs.map((r) => ({ sessionId: r.sessionId, sourceId: r.sourceId, slotId: r.slot, studentId: r.studentId,
        trainerId: r.trainerId, contractId: r.contractId, previousBranchId: documents.get(r.sessionName).data.branchId || null,
        sessionPatch: r.sessionPatch, entryPatch: r.entryPatch })),
    }) }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
  })
  if (writes.length > 450) throw Error('Atomic metadata repair limit exceeded')
  return { auditId, dependencies: [...dependencies.values()], writes, changes: [...changes.values()] }
}
async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const i = arg.indexOf('='); return [arg.slice(2, i), arg.slice(i + 1)] }))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.week || '')) throw Error('Week required')
  if (!['apply', 'dry-run'].includes(args.mode || 'dry-run')) throw Error('Invalid mode')
  if (args.mode === 'apply' && (args.project !== TARGET.projectId || args.database !== TARGET.databaseId || args.confirm !== 'SYNC_EXISTING_CROSS_BRANCH_METADATA' || !/^[a-f0-9]{64}$/.test(args.digest || ''))) throw Error('Exact target, digest and confirmation required')
  const state = await loadState(args.week)
  const audit = buildAudit(state)
  const prepared = prepareWrites(state, audit)
  const result = { target: TARGET, week: args.week, digest: audit.digest, sessions: audit.publicPlan.repairSessions, entries: audit.publicPlan.repairEntries, writes: prepared.writes.length, auditId: prepared.auditId }
  if (args.mode !== 'apply') { console.log(JSON.stringify({ ...result, writesPerformed: false }, null, 2)); return }
  if (!prepared.writes.length) { console.log(JSON.stringify({ ...result, unchanged: true, writesPerformed: false }, null, 2)); return }
  if (audit.digest !== args.digest) throw Error('Live plan changed; review a fresh dry run')
  const privateDir = path.resolve('.migration-private')
  fs.mkdirSync(privateDir, { recursive: true })
  const backup = path.join(privateDir, `${prepared.auditId}-${Date.now()}-backup.json`)
  fs.writeFileSync(backup, JSON.stringify({ target: TARGET, digest: audit.digest, documents: prepared.dependencies }), { flag: 'wx', mode: 0o600 })
  const token = await accessToken()
  const begun = await requestJson(token, '/documents:beginTransaction', { method: 'POST', body: JSON.stringify({ options: { readWrite: {} } }) })
  const transaction = begun.transaction
  try {
    // Read all source/profile/contract dependencies within the same transaction;
    // profile transfers or schedule edits cannot race this metadata-only repair.
    const rows = await requestJson(token, '/documents:batchGet', { method: 'POST', body: JSON.stringify({ transaction, documents: prepared.dependencies.map((d) => d.name) }) })
    const current = new Map(rows.filter((r) => r.found).map((r) => [r.found.name, r.found]))
    for (const doc of prepared.dependencies) if (current.get(doc.name)?.updateTime !== doc.updateTime) throw Error('Dependency changed; no writes performed')
    await requestJson(token, '/documents:commit', { method: 'POST', body: JSON.stringify({ transaction, writes: prepared.writes }) })
  } catch (error) {
    await requestJson(token, '/documents:rollback', { method: 'POST', body: JSON.stringify({ transaction }) }).catch(() => {})
    throw error
  }
  const afterState = await loadState(args.week)
  const after = buildAudit(afterState)
  // Assert every original business field remains byte-equivalent after sync.
  const afterSessions = new Map(afterState.sessions.map((d) => [d.id, d]))
  const allowed = new Set(['branchId', 'studentBranchWarning', 'studentHomeBranchId', 'revision', 'updatedAt', 'updatedBy', 'crossBranchSyncAuditId'])
  for (const original of state.sessions) {
    const changed = afterSessions.get(original.id)
    if (!changed) throw Error('Verification failed: existing session missing')
    const business = (d) => Object.fromEntries(Object.entries(d.fields).filter(([key]) => !allowed.has(key)).sort(([a], [b]) => a.localeCompare(b)))
    if (digest(business(original)) !== digest(business(changed))) throw Error('Business fields changed concurrently; manual review required')
  }
  const verified = after.repairs.length === 0 && afterState.sessions.length === state.sessions.length
  const report = { ...result, writesPerformed: true, verified, remainingRepairs: after.repairs.length, sessionCountBefore: state.sessions.length, sessionCountAfter: afterState.sessions.length, businessFieldsPreserved: true, backup }
  fs.writeFileSync(path.join(privateDir, `${prepared.auditId}-result.json`), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify(report, null, 2))
  if (!verified) process.exitCode = 2
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1 })
module.exports = { prepareWrites }
