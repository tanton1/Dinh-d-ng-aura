'use strict'

const { createHash } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { FieldPath, FieldValue } = require('firebase-admin/firestore')
const { projectionSourcePayload } = require('./projection-event-policy')

const STUDENT_LANE = 'studentScheduleVersion'
const TRAINER_LANE = 'trainerWorkspaceVersion'
const POLICY_PATH = 'workspaceChanges/policy'
const RECIPIENT_QUERY_LIMIT = 200
const SOURCE_ALIASES = {
  student: 'students', contract: 'contracts', contractUsage: 'contractUsageViews',
  session: 'sessions', attendance: 'attendanceEvents', availability: 'ptAvailability',
  leave: 'leaveRequests', sessionRequest: 'sessionRequests', user: 'users',
  trainer: 'trainers', scheduleConfig: 'settings', branch: 'branches', assignment: 'roleAssignments',
}
const SOURCES = new Set([
  'students', 'contracts', 'contractUsageViews', 'sessions', 'attendanceEvents',
  'ptAvailability', 'leaveRequests', 'sessionRequests', 'users', 'trainers',
  'settings', 'branches', 'roleAssignments',
])
const USER_IDENTITY_FIELDS = ['disabled', 'authzVersion', 'accessRole', 'role', 'crmProfileId', 'branchId']

function safeId(value) {
  return typeof value === 'string' && value.length <= 200 && value.trim() && !value.includes('/')
    ? value.trim() : ''
}
function ids(values) { return [...new Set(values.flat().map(safeId).filter(Boolean))] }
function snapshotValue(snapshot) { return snapshot?.exists ? snapshot.data() || {} : null }
function meaningfulSource(value, source) {
  if (!value) return value
  if (source === 'users') return Object.fromEntries(USER_IDENTITY_FIELDS.map((field) => [field, value[field]]))
  // Student schedule projects only the trainer's name. Trainer workspace
  // does not read trainer profiles, availability, payroll, or status.
  if (source === 'trainers') return { name: value.name || 'PT Aura' }
  const { updatedAt, generatedAt, generatedAtMillis, ...body } = projectionSourcePayload(value, source)
  return body
}
function workspaceSourceChanged(before, after, source) {
  if (!before || !after) return Boolean(before || after)
  return !isDeepStrictEqual(meaningfulSource(before, source), meaningfulSource(after, source))
}

function timestampVersion(value) {
  if (!value) return ''
  let seconds
  let nanoseconds
  if (typeof value.seconds === 'number' && typeof value.nanoseconds === 'number') {
    seconds = value.seconds
    nanoseconds = value.nanoseconds
  } else {
    const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value))
    if (!Number.isFinite(parsed)) return ''
    seconds = Math.floor(parsed / 1000)
    const fraction = typeof value === 'string' ? /\.(\d{1,9})(?:Z|[+-]\d{2}:?\d{2})$/.exec(value)?.[1] : ''
    nanoseconds = fraction ? Number(fraction.padEnd(9, '0')) : (parsed % 1000) * 1_000_000
  }
  if (!Number.isSafeInteger(seconds) || seconds < 0 || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1_000_000_000) return ''
  return `${String(seconds).padStart(12, '0')}.${String(nanoseconds).padStart(9, '0')}`
}
function sourceVersion(event) {
  // A deletion's before.updateTime predates the deletion; using it could let
  // an older source watermark suppress removal of an already visible row.
  const version = timestampVersion(event.data?.after?.exists ? event.data.after.updateTime : event.time)
    || timestampVersion(event.time)
  if (!version) throw new Error('Workspace change signal requires the source commit/event timestamp.')
  return version
}
function laneVersion(value, lane) {
  return typeof value?.[lane] === 'string' && /^\d{12}\.\d{9}$/.test(value[lane]) ? value[lane] : '0'
}
function newerLanePatch(current, lanes, version) {
  const patch = {}
  for (const lane of lanes) if (laneVersion(current, lane) < version) patch[lane] = version
  return patch
}
function nextVersion(version) {
  const [seconds, nanos] = version.split('.').map(Number)
  return timestampVersion({ seconds: seconds + (nanos === 999_999_999 ? 1 : 0), nanoseconds: nanos === 999_999_999 ? 0 : nanos + 1 })
}

/** For canonical branch/config commands: call after their reads and before
 * their writes. The signal participates in the same transaction as the edit.
 */
async function writeWorkspacePolicyChange({ db, transaction, at = new Date(), student = true, trainer = true }) {
  let version = timestampVersion(at)
  if (!version) throw new Error('Workspace policy change requires a valid timestamp.')
  const reference = db.doc(POLICY_PATH)
  const snapshot = await transaction.get(reference)
  const lanes = [...(student ? [STUDENT_LANE] : []), ...(trainer ? [TRAINER_LANE] : [])]
  const current = snapshotValue(snapshot) || {}
  // Each successful canonical command must publish a distinct revision,
  // including same-millisecond edits or a server clock behind the last event.
  // The command's own transaction receipt handles retries/idempotency.
  for (const lane of lanes) {
    const previous = laneVersion(current, lane)
    if (previous >= version) version = nextVersion(previous)
  }
  const patch = newerLanePatch(current, lanes, version)
  if (!Object.keys(patch).length) return { changed: false, version }
  transaction.set(reference, { ...patch, schemaVersion: 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return { changed: true, version }
}
async function mapBounded(values, callback, concurrency = 8) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(values.length, concurrency) }, async () => {
    while (next < values.length) await callback(values[next++])
  }))
}

/** Read the exact metadata scope before loading any cached business payload.
 * Missing signals have a stable zero revision. This never creates documents.
 */
async function readWorkspaceChangeState({ db, uid, branchIds = [], kind }) {
  const accountUid = safeId(uid)
  if (!accountUid || !['student', 'trainer'].includes(kind)) throw new Error('Invalid workspace change read scope.')
  const branches = kind === 'trainer' ? ids(branchIds).sort() : []
  const paths = [`users/${accountUid}/workspaceChanges/operations`, POLICY_PATH, ...branches.map((branchId) => `workspaceBranchChanges/${branchId}`)]
  const snapshots = []
  for (let offset = 0; offset < paths.length; offset += 200) {
    snapshots.push(...await db.getAll(...paths.slice(offset, offset + 200).map((path) => db.doc(path))))
  }
  const lane = kind === 'student' ? STUDENT_LANE : TRAINER_LANE
  const userVersion = laneVersion(snapshotValue(snapshots[0]), lane)
  const policyVersion = laneVersion(snapshotValue(snapshots[1]), lane)
  const branchVersions = Object.fromEntries(branches.map((branchId, index) => [branchId, laneVersion(snapshotValue(snapshots[index + 2]), TRAINER_LANE)]))
  const version = createHash('sha256').update(JSON.stringify([accountUid, kind, userVersion, branchVersions, policyVersion])).digest('hex')
  return { version, userVersion, branchVersions, policyVersion }
}

/** Publish metadata only, using existing source trigger deliveries. No new
 * trigger, schedule, business payload, or client-authored recipient is needed.
 */
async function syncWorkspaceChangesFromEvent({ db, event, source: suppliedSource }) {
  const inferredSource = event.data?.after?.ref?.parent?.id || event.data?.before?.ref?.parent?.id || ''
  const source = SOURCE_ALIASES[suppliedSource] || suppliedSource || inferredSource
  const before = snapshotValue(event.data?.before)
  const after = snapshotValue(event.data?.after)
  const sourceId = safeId(event.data?.after?.id || event.data?.before?.id || Object.values(event.params || {})[0])
  if (!SOURCES.has(source) || !sourceId) return { source, skipped: 'unsupported_source', userCount: 0, branchCount: 0, changedDocuments: 0 }
  if (source === 'settings' && sourceId !== 'scheduleConfig') return { source, skipped: 'unrelated_settings', userCount: 0, branchCount: 0, changedDocuments: 0 }
  if (!workspaceSourceChanged(before, after, source)) return { source, skipped: 'source_unchanged', userCount: 0, branchCount: 0, changedDocuments: 0 }
  const version = sourceVersion(event)
  const changes = new Map()
  const studentIds = new Set()
  const trainerIds = new Set()
  const branchIds = new Set()
  const userIds = new Set()
  const readCache = new Map()
  const queryCache = new Map()
  const overflows = new Set()
  const values = [before, after].filter(Boolean)

  const add = (path, lane) => {
    const lanes = changes.get(path) || new Set()
    lanes.add(lane)
    changes.set(path, lanes)
  }
  const addUser = (uid, lane) => {
    if (!safeId(uid)) return
    userIds.add(uid)
    add(`users/${uid}/workspaceChanges/operations`, lane)
  }
  const addPolicy = (lane) => add(POLICY_PATH, lane)
  const addBranches = (value = {}) => ids([value.branchId, value.branchIds || []]).forEach((id) => branchIds.add(id))
  const addTrainers = (value = {}) => ids([
    value.trainerId, value.secondaryTrainerId, value.nutritionTrainerId,
    value.trainerIds || [], value.nutritionPTIds || [], value.nutritionTrainerIds || [],
  ]).forEach((id) => trainerIds.add(id))
  const addStudents = (value = {}) => ids([value.studentId, value.crmProfileId]).forEach((id) => studentIds.add(id))
  const read = (path) => {
    if (!readCache.has(path)) readCache.set(path, db.doc(path).get())
    return readCache.get(path)
  }
  const query = async (collection, field, value, overflowLanes = [TRAINER_LANE], select = []) => {
    const key = JSON.stringify([collection, field, value, select])
    if (!queryCache.has(key)) queryCache.set(key, (async () => {
      let reference = db.collection(collection).where(field, '==', value).limit(RECIPIENT_QUERY_LIMIT + 1)
      if (select.length) reference = reference.select(...select)
      const snapshot = await reference.get()
      if (snapshot.docs.length > RECIPIENT_QUERY_LIMIT) {
        // Never silently truncate recipients. Large/ambiguous audiences get a
        // visible policy invalidation instead of an unbounded history scan.
        overflows.add(`${collection}.${field}`)
        overflowLanes.forEach(addPolicy)
      }
      return snapshot.docs
    })())
    return queryCache.get(key)
  }
  const identitiesForCrm = async (crmId) => {
    const key = `identity:${crmId}`
    if (!queryCache.has(key)) queryCache.set(key, (async () => {
      const documents = []
      let last = null
      // Identity links are usually one row, but all actual Auth accounts
      // mapped to a CRM record must be notified. Page rather than widening
      // the student policy audience or silently truncating this rare case.
      while (true) {
        let reference = db.collection('roleAssignments').where('crmProfileId', '==', crmId)
          .orderBy(FieldPath.documentId()).limit(RECIPIENT_QUERY_LIMIT).select('accessRole')
        if (last) reference = reference.startAfter(last)
        const snapshot = await reference.get()
        documents.push(...snapshot.docs)
        if (snapshot.docs.length < RECIPIENT_QUERY_LIMIT) return documents
        last = snapshot.docs.at(-1)
      }
    })())
    return queryCache.get(key)
  }

  if (source === 'trainers') {
    addPolicy(STUDENT_LANE)
  } else if (source === 'settings') {
    addPolicy(STUDENT_LANE)
    addPolicy(TRAINER_LANE)
  } else if (source === 'branches') {
    branchIds.add(sourceId)
    // A branch label can also be displayed outside its roster scope through
    // an assigned cross-branch session. Branch edits are rare policy changes.
    addPolicy(STUDENT_LANE)
    addPolicy(TRAINER_LANE)
  } else if (['users', 'roleAssignments'].includes(source)) {
    addUser(sourceId, STUDENT_LANE)
    addUser(sourceId, TRAINER_LANE)
    values.forEach(addBranches)
  } else {
    values.forEach((value) => { addStudents(value); addTrainers(value); addBranches(value) })
    if (source === 'students') studentIds.add(sourceId)
    if (source === 'ptAvailability' && !studentIds.size) studentIds.add(sourceId.replace(/_\d{4}-\d{2}-\d{2}$/, ''))

    // Immutable attendance rows and legacy requests may carry only sessionId.
    const sessionIds = ids(values.map((value) => value.sessionId))
    const contractIds = new Set(ids(values.map((value) => value.contractId)))
    await mapBounded(sessionIds, async (id) => {
      const snapshot = await read(`sessions/${id}`)
      if (!snapshot.exists) return
      const value = snapshot.data() || {}
      addStudents(value); addTrainers(value); addBranches(value)
      if (safeId(value.contractId)) contractIds.add(safeId(value.contractId))
    })
    if (source === 'contracts' || source === 'contractUsageViews') contractIds.add(sourceId)
    await mapBounded([...contractIds], async (id) => {
      const snapshot = await read(`contracts/${id}`)
      if (!snapshot.exists) return
      const value = snapshot.data() || {}
      addStudents(value); addTrainers(value); addBranches(value)
    })

    const studentOnly = source === 'ptAvailability' || source === 'leaveRequests'
    await mapBounded([...studentIds], async (studentId) => {
      const snapshot = await read(`students/${studentId}`)
      const studentValues = [snapshotValue(snapshot), ...(source === 'students' && studentId === sourceId ? values : [])].filter(Boolean)
      studentValues.forEach((value) => {
        addUser(safeId(value.accountUid), STUDENT_LANE)
        if (!studentOnly) { addBranches(value); addTrainers(value) }
      })
      // Student schedule supports both CRM links and students/{authUid}; do
      // not assume every CRM document id is an Auth uid or discard staff who
      // also have a linked learner profile.
      const [assignments, legacyAccount] = await Promise.all([
        identitiesForCrm(studentId),
        read(`users/${studentId}`),
      ])
      assignments.forEach((item) => addUser(item.id, STUDENT_LANE))
      if (legacyAccount.exists) addUser(studentId, STUDENT_LANE)

      // Profile/contract/usage changes affect PTs teaching this learner even
      // when those PTs are absent from the current contract or branch roster.
      if (!studentOnly && ['students', 'contracts', 'contractUsageViews'].includes(source)) {
        const [canonical, legacy, sessions] = await Promise.all([
          query('contracts', 'studentId', studentId, [TRAINER_LANE], ['trainerId', 'trainerIds', 'nutritionPTIds', 'branchId']),
          query('contracts', 'crmProfileId', studentId, [TRAINER_LANE], ['trainerId', 'trainerIds', 'nutritionPTIds', 'branchId']),
          query('sessions', 'studentId', studentId, [TRAINER_LANE], ['trainerId', 'branchId']),
        ])
        for (const item of [...canonical, ...legacy, ...sessions]) {
          const value = item.data() || {}
          addTrainers(value); addBranches(value)
        }
      }
    })
    if (source === 'ptAvailability') values.forEach((value) => addUser(safeId(value.accountUid), STUDENT_LANE))
    if (studentOnly) { trainerIds.clear(); branchIds.clear() }
  }

  await mapBounded([...trainerIds], async (trainerId) => {
    const [account, assignments] = await Promise.all([
      read(`users/${trainerId}`),
      identitiesForCrm(trainerId),
    ])
    if (account.exists) addUser(trainerId, TRAINER_LANE)
    for (const item of assignments) {
      const role = item.data()?.accessRole
      if (!role || ['staff', 'admin', 'super_admin'].includes(role)) addUser(item.id, TRAINER_LANE)
    }
  })
  for (const branchId of branchIds) add(`workspaceBranchChanges/${branchId}`, TRAINER_LANE)
  const entries = [...changes]
  let changedDocuments = 0
  for (let offset = 0; offset < entries.length; offset += 200) {
    const chunk = entries.slice(offset, offset + 200)
    changedDocuments += await db.runTransaction(async (transaction) => {
      const references = chunk.map(([path]) => db.doc(path))
      const snapshots = await transaction.getAll(...references)
      let changed = 0
      chunk.forEach(([, lanes], index) => {
        const current = snapshotValue(snapshots[index]) || {}
        const patch = newerLanePatch(current, lanes, version)
        if (!Object.keys(patch).length) return
        transaction.set(references[index], { ...patch, schemaVersion: 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
        changed += 1
      })
      return changed
    })
  }
  return { source, version, userCount: userIds.size, branchCount: branchIds.size, changedDocuments, overflowCount: overflows.size, overflowSources: [...overflows].sort() }
}

module.exports = {
  readWorkspaceChangeState, syncWorkspaceChangesFromEvent, writeWorkspacePolicyChange,
  workspaceSourceChanged, timestampVersion, RECIPIENT_QUERY_LIMIT,
}
