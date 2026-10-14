'use strict'

// Read-only, bounded weekly reconciliation. Public output contains hashes;
// optional snapshots stay in the gitignored migration directory.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { TARGET, accessToken, decodeFields, requestJson } = require('./firebase-pt-schedule-audit.cjs')

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const hash = (value) => digest(value).slice(0, 16)
const dateKey = (value) => /^\d{4}-\d{2}-\d{2}/.exec(String(value || ''))?.[0] || ''
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const identity = (student, date, hour) => `${student}|${date}|${hour}`
function sessionHour(session, id) {
  if (Number.isInteger(session.hour) && session.hour >= 0 && session.hour <= 23) return session.hour
  const match = /^(?:T[2-7]|CN)-(\d{1,2})-/.exec(id || '')
  return match ? Number(match[1]) : null
}
function slotParts(week, slot) {
  const match = /^(T[2-7]|CN)-(\d{1,2})$/.exec(slot)
  if (!match || Number(match[2]) > 23) return null
  return { date: addDays(week, match[1] === 'CN' ? 6 : Number(match[1].slice(1)) - 2), hour: Number(match[2]) }
}
function validContract(contract, studentId, homeBranch, date) {
  if (!contract || contract.studentId !== studentId || contract.branchId !== homeBranch) return false
  const start = dateKey(contract.startDate), end = dateKey(contract.endDate)
  return Boolean(start && end && start <= date && date <= end)
    && !['cancelled', 'canceled', 'void', 'deleted', 'archived'].includes(String(contract.status || '').toLowerCase())
    && !(contract.pausePeriods || []).some((p) => dateKey(p.startDate) <= date && date <= dateKey(p.endDate))
}

async function readCollection(token, collectionId, week) {
  const dateFilter = week ? { compositeFilter: { op: 'AND', filters: [
    { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: week } } },
    { fieldFilter: { field: { fieldPath: 'date' }, op: 'LESS_THAN', value: { stringValue: addDays(week, 7) } } },
  ] } } : undefined
  const rows = await requestJson(token, '/documents:runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: {
    from: [{ collectionId }], ...(dateFilter ? { where: dateFilter } : {}),
    orderBy: [{ field: { fieldPath: week ? 'date' : '__name__' }, direction: 'ASCENDING' }], limit: 2001,
  } }) })
  const docs = rows.filter((row) => row.document).map((row) => row.document)
  if (docs.length > 2000) throw Error(`Audit limit exceeded: ${collectionId}`)
  return docs.map((doc) => ({ id: doc.name.split('/').pop(), name: doc.name, updateTime: doc.updateTime, fields: doc.fields, data: decodeFields(doc.fields) }))
}
async function loadState(week) {
  const token = await accessToken()
  const metadata = await requestJson(token, '')
  if (metadata.name !== `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`) throw Error('Unexpected database')
  const [branches, students, trainers, contracts, sessions, schedules, drafts] = await Promise.all([
    readCollection(token, 'branches'), readCollection(token, 'students'), readCollection(token, 'trainers'),
    readCollection(token, 'contracts'), readCollection(token, 'sessions', week), readCollection(token, 'schedules'), readCollection(token, 'ptScheduleDrafts'),
  ])
  return { target: TARGET, week, readAt: new Date().toISOString(), branches, students, trainers, contracts, sessions,
    schedules: schedules.filter((s) => s.id === `schedule_${week}`),
    drafts: drafts.filter((s) => s.data.weekId === week || s.id.endsWith(`_${week}`)) }
}

function buildAudit(state) {
  const { week, branches, students, trainers, contracts, sessions, schedules, drafts } = state
  const branchIds = new Set(branches.filter((b) => b.data.status !== 'archived').map((b) => b.id))
  const studentMap = new Map(students.map((s) => [s.id, s.data]))
  const trainerMap = new Map(trainers.map((s) => [s.id, s.data]))
  const contractMap = new Map(contracts.map((s) => [s.id, s.data]))
  const sessionIndex = new Map()
  for (const session of sessions) {
    const key = identity(session.data.studentId, dateKey(session.data.date), sessionHour(session.data, session.id))
    sessionIndex.set(key, [...(sessionIndex.get(key) || []), session])
  }
  const entries = [], crossBranch = [], missing = [], conflicts = [], repairs = []
  const matchedSessionIds = new Set()
  for (const source of [...schedules, ...drafts]) {
    for (const [slot, values] of Object.entries(source.data.schedule || {})) {
      if (!Array.isArray(values)) continue
      for (let index = 0; index < values.length; index++) {
        const entry = values[index]
        if (!entry?.studentId || entry.type === 'off' || entry.studentId === 'OFF') continue
        const parts = slotParts(week, slot)
        if (!parts) { conflicts.push({ source: source.id, slot, issue: 'INVALID_SLOT' }); continue }
        const student = studentMap.get(entry.studentId), trainer = trainerMap.get(entry.trainerId)
        const branch = branchIds.has(entry.branchId) ? entry.branchId : branchIds.has(source.data.branchId) ? source.data.branchId : trainer?.branchId
        const matches = sessionIndex.get(identity(entry.studentId, parts.date, parts.hour)) || []
        const cross = Boolean(student?.branchId && branchIds.has(branch) && student.branchId !== branch)
        const row = { source: source.id, slot, index, ...parts, studentHash: hash(entry.studentId), trainerHash: hash(entry.trainerId),
          branchId: branch, homeBranchId: student?.branchId, crossBranch: cross, sessions: matches.length }
        entries.push(row)
        if (cross) crossBranch.push(row)
        if (!matches.length) { missing.push(row); continue }
        if (matches.length !== 1) { conflicts.push({ ...row, issue: 'DUPLICATE_SESSION' }); continue }
        const session = matches[0], s = session.data
        matchedSessionIds.add(session.id)
        if (s.trainerId !== entry.trainerId) { conflicts.push({ ...row, issue: 'TRAINER_MISMATCH' }); continue }
        if (!cross) continue
        if (!student || !trainer || !branchIds.has(branch) || trainer.branchId !== branch) { conflicts.push({ ...row, issue: 'PROFILE_BRANCH_MISMATCH' }); continue }
        if (['cancelled', 'canceled', 'canceled_by_student', 'cancelled_by_student', 'deleted', 'void'].includes(s.status)) { conflicts.push({ ...row, issue: 'CANCELLED_SESSION' }); continue }
        const contractId = s.contractId || entry.contractId
        if (!validContract(contractMap.get(contractId), entry.studentId, student.branchId, parts.date)) { conflicts.push({ ...row, issue: 'CONTRACT_INVALID' }); continue }
        const patch = {}
        if (s.branchId !== branch) patch.branchId = branch
        if (s.studentBranchWarning !== true) patch.studentBranchWarning = true
        if (s.studentHomeBranchId !== student.branchId) patch.studentHomeBranchId = student.branchId
        const entryPatch = { branchId: branch, contractId, studentBranchWarning: true, studentHomeBranchId: student.branchId }
        const needsEntryPatch = Object.entries(entryPatch).some(([k, v]) => entry[k] !== v)
        if (Object.keys(patch).length || needsEntryPatch) repairs.push({ sourceId: source.id, sourceName: source.name, sourceUpdateTime: source.updateTime, slot, index,
          sessionId: session.id, sessionName: session.name, sessionUpdateTime: session.updateTime, sessionPatch: patch,
          entryPatch: needsEntryPatch ? entryPatch : null, studentId: entry.studentId, trainerId: entry.trainerId, contractId, date: parts.date, hour: parts.hour })
      }
    }
  }
  const publicPlan = { week, entries: entries.length, sessions: sessions.length, matchedSessions: matchedSessionIds.size,
    crossBranch: crossBranch.length, crossBranchStudents: new Set(crossBranch.map((s) => s.studentHash)).size,
    missing: missing.length, missingCrossBranch: missing.filter((s) => s.crossBranch).length,
    conflicts: conflicts.length, repairSessions: new Set(repairs.filter((r) => Object.keys(r.sessionPatch).length).map((r) => r.sessionId)).size,
    repairEntries: repairs.filter((r) => r.entryPatch).length, crossBranchRecords: crossBranch, missingRecords: missing, conflictRecords: conflicts,
    orphanSessions: sessions.filter((s) => !matchedSessionIds.has(s.id)).map((s) => ({ idHash: hash(s.id), date: dateKey(s.data.date), status: s.data.status })) }
  return { publicPlan, repairs, digest: digest({ week, target: TARGET, repairs }) }
}

async function main() {
  const args = process.argv.slice(2)
  const week = args.find((a) => a.startsWith('--week='))?.slice(7)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week || '') || new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) throw Error('Provide a Monday --week=YYYY-MM-DD')
  const snapshot = path.resolve('.migration-private', `cross-branch-week-${week}.json`)
  const state = args.includes('--from-snapshot') ? JSON.parse(fs.readFileSync(snapshot, 'utf8')) : await loadState(week)
  if (args.includes('--save-snapshot')) { fs.mkdirSync(path.dirname(snapshot), { recursive: true }); fs.writeFileSync(snapshot, JSON.stringify(state), { flag: 'wx', mode: 0o600 }) }
  const audit = buildAudit(state)
  console.log(JSON.stringify({ readsOnly: true, target: TARGET, digest: audit.digest, ...audit.publicPlan }, null, 2))
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1 })
module.exports = { buildAudit, loadState, digest, sessionHour, validContract }
