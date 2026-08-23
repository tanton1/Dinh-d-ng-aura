'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

const TARGET_PROJECT = 'gen-lang-client-0815966909'
const TARGET_DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const TARGET_RESOURCE = `projects/${TARGET_PROJECT}/databases/${TARGET_DATABASE}`
const APPLY_CONFIRMATION = `${TARGET_RESOURCE}:link-legacy-trainers`
const PRIVATE_DIRECTORY = path.resolve('.migration-private')
const DEFAULT_REPORTS = {
  'dry-run': path.join(PRIVATE_DIRECTORY, 'staff-access-migration-dry-run.json'),
  apply: path.join(PRIVATE_DIRECTORY, 'staff-access-migration-apply.json'),
  verify: path.join(PRIVATE_DIRECTORY, 'staff-access-migration-verify.json'),
}

const USAGE = [
  'Usage:',
  '  node scripts/firebase-staff-access-migration.cjs dry-run',
  `  node scripts/firebase-staff-access-migration.cjs apply --dry-run-report=<path> --dry-run-digest=<sha256> --confirm=${APPLY_CONFIRMATION}`,
  '  node scripts/firebase-staff-access-migration.cjs verify --apply-report=<path>',
  '',
  'All commands are pinned to the current Aura target. Apply cannot modify the source Firebase project.',
].join('\n')

class PublicError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (typeof value[key] !== 'undefined') result[key] = canonical(value[key])
      return result
    }, {})
  }
  return value
}

function stableJson(value) {
  return JSON.stringify(canonical(value))
}

function digest(value) {
  return sha256(Buffer.from(stableJson(value), 'utf8'))
}

function parseArguments(argv) {
  const command = argv[0]
  const allowed = {
    'dry-run': new Set(['report']),
    apply: new Set(['dry-run-report', 'dry-run-digest', 'confirm', 'report']),
    verify: new Set(['apply-report', 'report']),
  }[command]
  if (!allowed) throw new PublicError('unknown_command', USAGE)
  const flags = {}
  for (const argument of argv.slice(1)) {
    if (!argument.startsWith('--') || !argument.includes('=')) throw new PublicError('invalid_argument', USAGE)
    const separator = argument.indexOf('=')
    const key = argument.slice(2, separator)
    const value = argument.slice(separator + 1)
    if (!allowed.has(key) || !value || Object.hasOwn(flags, key)) throw new PublicError('invalid_argument', USAGE)
    flags[key] = value
  }
  return { command, flags }
}

function requiredFlag(flags, key) {
  if (!flags[key]) throw new PublicError('missing_argument', `Missing --${key}.\n${USAGE}`)
  return flags[key]
}

function assertPrivatePath(filePath) {
  const resolved = path.resolve(filePath)
  const relative = path.relative(PRIVATE_DIRECTORY, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PublicError('unsafe_report_path', 'Migration reports must stay inside .migration-private.')
  }
  return resolved
}

function writeReport(filePath, report) {
  const resolved = assertPrivatePath(filePath)
  fs.mkdirSync(PRIVATE_DIRECTORY, { recursive: true })
  const temporary = `${resolved}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, resolved)
  return resolved
}

function readReport(filePath, expectedMode) {
  const resolved = assertPrivatePath(filePath)
  let raw
  try {
    raw = fs.readFileSync(resolved, 'utf8')
  } catch {
    throw new PublicError('report_unreadable', `Cannot read the ${expectedMode} report.`)
  }
  let report
  try {
    report = JSON.parse(raw)
  } catch {
    throw new PublicError('report_invalid', `The ${expectedMode} report is invalid.`)
  }
  if (report?.mode !== expectedMode
      || report?.target?.projectId !== TARGET_PROJECT
      || report?.target?.databaseId !== TARGET_DATABASE) {
    throw new PublicError('report_target_mismatch', `The ${expectedMode} report belongs to another Firebase target.`)
  }
  return { report, raw, resolved }
}

function cliAuthModule() {
  const candidates = []
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
  try { candidates.push(require.resolve('firebase-tools/lib/auth.js')) } catch { /* Global CLI is enough. */ }
  const modulePath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!modulePath) throw new PublicError('firebase_cli_missing', 'Firebase CLI is unavailable.')
  return require(modulePath)
}

async function firebaseCliAccessToken() {
  const auth = cliAuthModule()
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new PublicError('firebase_cli_signed_out', 'Firebase CLI is not signed in.')
  const token = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!token?.access_token) throw new PublicError('oauth_token_unavailable', 'Cannot obtain Firebase CLI OAuth access.')
  return token.access_token
}

function cliCredential(accessToken) {
  return { getAccessToken: async () => ({ access_token: accessToken, expires_in: 3600 }) }
}

function databaseBase() {
  return `https://firestore.googleapis.com/v1/${TARGET_RESOURCE}`
}

async function requestJson(accessToken, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const raw = await response.text()
  if (!response.ok) throw new PublicError(options.errorCode || 'target_request_failed', `Target Firebase request failed with HTTP ${response.status}.`)
  if (!raw) return null
  try { return JSON.parse(raw) } catch {
    try { return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) } catch {
      throw new PublicError('target_response_invalid', 'Target Firebase returned an invalid response.')
    }
  }
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null
  if (Object.hasOwn(value, 'nullValue')) return null
  if (Object.hasOwn(value, 'booleanValue')) return value.booleanValue === true
  if (Object.hasOwn(value, 'integerValue')) return Number(value.integerValue)
  if (Object.hasOwn(value, 'doubleValue')) return Number(value.doubleValue)
  if (Object.hasOwn(value, 'timestampValue')) return String(value.timestampValue)
  if (Object.hasOwn(value, 'stringValue')) return String(value.stringValue)
  if (Object.hasOwn(value, 'arrayValue')) return (value.arrayValue?.values || []).map(decodeValue)
  if (Object.hasOwn(value, 'mapValue')) return decodeFields(value.mapValue?.fields || {})
  if (Object.hasOwn(value, 'referenceValue')) return String(value.referenceValue)
  return null
}

function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decodeValue(value)]))
}

function encodeValue(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new PublicError('invalid_generated_value', 'Generated migration data is invalid.')
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFields(value) } }
  throw new PublicError('invalid_generated_value', 'Generated migration data is unsupported.')
}

function encodeFields(value) {
  return Object.fromEntries(Object.entries(value || {})
    .filter(([, item]) => typeof item !== 'undefined')
    .map(([key, item]) => [key, encodeValue(item)]))
}

function documentId(name) {
  return typeof name === 'string' ? decodeURIComponent(name.slice(name.lastIndexOf('/') + 1)) : ''
}

function resourceName(collectionName, id) {
  if (!/^[A-Za-z0-9_-]{1,1500}$/.test(id)) throw new PublicError('unsafe_document_id', 'A target document ID is unsafe.')
  return `${TARGET_RESOURCE}/documents/${collectionName}/${id}`
}

async function readCollection(accessToken, collectionName) {
  const documents = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ pageSize: '1000', showMissing: 'false' })
    if (pageToken) params.set('pageToken', pageToken)
    const body = await requestJson(accessToken, `${databaseBase()}/documents/${collectionName}?${params}`, { errorCode: 'collection_read_failed' })
    for (const item of body?.documents || []) documents.push({ id: documentId(item.name), data: decodeFields(item.fields || {}) })
    pageToken = body?.nextPageToken || ''
  } while (pageToken)
  return documents
}

async function readDocument(accessToken, collectionName, id) {
  const response = await fetch(`${databaseBase()}/documents/${collectionName}/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new PublicError('document_read_failed', `Target Firebase request failed with HTTP ${response.status}.`)
  const body = await response.json()
  return { id, data: decodeFields(body.fields || {}) }
}

async function listAuthUsers(auth) {
  const users = []
  let pageToken
  do {
    const page = await auth.listUsers(1000, pageToken)
    users.push(...page.users)
    pageToken = page.pageToken
  } while (pageToken)
  return users
}

async function loadState() {
  const accessToken = await firebaseCliAccessToken()
  const app = initializeApp({ projectId: TARGET_PROJECT, credential: cliCredential(accessToken) }, `staff-access-${crypto.randomUUID()}`)
  const auth = getAuth(app)
  try {
    const authUsers = await listAuthUsers(auth)
    const users = await readCollection(accessToken, 'users')
    const assignments = await readCollection(accessToken, 'roleAssignments')
    const staff = await readCollection(accessToken, 'staff')
    const trainers = await readCollection(accessToken, 'trainers')
    return { accessToken, app, auth, authUsers, users, assignments, staff, trainers }
  } catch (error) {
    await deleteApp(app)
    throw error
  }
}

function mapDocuments(documents) {
  return new Map(documents.map((item) => [item.id, item.data]))
}

function normalizedString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizedRole(value) {
  return normalizedString(value).toLowerCase()
}

function normalizedArray(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].sort() : []
}

function exactSubset(value, expected) {
  return Object.entries(expected).every(([key, item]) => stableJson(value?.[key]) === stableJson(item))
}

function authorizationClaims(authUser) {
  const claims = authUser?.customClaims && typeof authUser.customClaims === 'object' ? authUser.customClaims : {}
  return {
    role: normalizedRole(claims.role),
    accessRole: normalizedRole(claims.accessRole),
    positions: normalizedArray(claims.positions),
    branchIds: normalizedArray(claims.branchIds),
    capabilities: normalizedArray(claims.capabilities),
  }
}

function candidateFingerprint(uid, user, assignment, staff, trainer, authUser) {
  return digest({
    uid,
    user: user ? {
      role: user.role, accessRole: user.accessRole, authzVersion: user.authzVersion,
      disabled: user.disabled, status: user.status, branchId: user.branchId,
    } : null,
    assignment: assignment ? {
      accessRole: assignment.accessRole, positions: assignment.positions, branchIds: assignment.branchIds,
      authzVersion: assignment.authzVersion, status: assignment.status, crmProfileId: assignment.crmProfileId,
    } : null,
    staff: staff ? { role: staff.role, status: staff.status, branchId: staff.branchId } : null,
    trainer: trainer ? { role: trainer.role, status: trainer.status, branchId: trainer.branchId } : null,
    auth: authUser ? { disabled: authUser.disabled, claims: authUser.customClaims || {} } : null,
  })
}

function buildPlan(state) {
  const auth = new Map(state.authUsers.map((item) => [item.uid, item]))
  const users = mapDocuments(state.users)
  const assignments = mapDocuments(state.assignments)
  const staff = mapDocuments(state.staff)
  const trainers = mapDocuments(state.trainers)
  const evidenceUids = [...new Set([...staff.keys(), ...trainers.keys()])].sort()
  const candidates = []
  const quarantined = []

  for (const uid of evidenceUids) {
    const authUser = auth.get(uid) || null
    const profile = users.get(uid) || null
    const assignment = assignments.get(uid) || null
    const staffRecord = staff.get(uid) || null
    const trainerRecord = trainers.get(uid) || null
    const reasons = []
    const profileRole = normalizedRole(profile?.role)
    const profileAccessRole = normalizedRole(profile?.accessRole)
    const authz = authorizationClaims(authUser)
    const staffRole = normalizedRole(staffRecord?.role)
    const trainerRole = normalizedRole(trainerRecord?.role)

    if (!authUser) reasons.push('auth_missing')
    else if (authUser.disabled) reasons.push('auth_disabled')
    if (!profile) reasons.push('user_profile_missing')
    else if (profile.disabled === true || normalizedRole(profile.status) === 'suspended') reasons.push('user_profile_disabled')
    if (profile && profileRole !== 'trainer') reasons.push(profileRole === 'admin' || profileRole === 'super_admin' ? 'privileged_profile_quarantined' : 'profile_not_trainer')
    if (profileAccessRole && profileAccessRole !== 'staff') reasons.push('profile_access_conflict')
    if (staffRecord && staffRole !== 'trainer') reasons.push(staffRole === 'admin' ? 'legacy_admin_quarantined' : 'staff_role_conflict')
    if (trainerRecord && trainerRole && trainerRole !== 'trainer') reasons.push('trainer_role_conflict')
    if (staffRecord && normalizedRole(staffRecord.status) && normalizedRole(staffRecord.status) !== 'active') reasons.push('staff_inactive')
    if (trainerRecord && normalizedRole(trainerRecord.status) && normalizedRole(trainerRecord.status) !== 'active') reasons.push('trainer_inactive')
    if (authz.role && authz.role !== 'trainer') reasons.push(['admin', 'super_admin'].includes(authz.role) ? 'privileged_auth_quarantined' : 'auth_role_conflict')
    if (authz.accessRole && authz.accessRole !== 'staff') reasons.push('auth_access_conflict')
    if (authz.positions.length || authz.branchIds.length || authz.capabilities.length) reasons.push('oversized_legacy_authz_claims')

    const branches = normalizedArray([profile?.branchId, staffRecord?.branchId, trainerRecord?.branchId])
    if (branches.length === 0) reasons.push('branch_missing')
    if (branches.length > 1) reasons.push('branch_conflict')

    if (assignment) {
      const assignmentPositions = normalizedArray(assignment.positions)
      const assignmentBranches = normalizedArray(assignment.branchIds)
      if (normalizedRole(assignment.accessRole) !== 'staff') reasons.push('assignment_access_conflict')
      if (stableJson(assignmentPositions) !== stableJson(['trainer_pt'])) reasons.push('assignment_position_conflict')
      if (normalizedRole(assignment.status) !== 'active') reasons.push('assignment_status_conflict')
      if (assignment.crmProfileId && assignment.crmProfileId !== uid) reasons.push('assignment_profile_conflict')
      if (branches.length === 1 && stableJson(assignmentBranches) !== stableJson(branches)) reasons.push('assignment_branch_conflict')
    }

    if (reasons.length) {
      quarantined.push({ uid, reasons: [...new Set(reasons)].sort() })
      continue
    }

    const assignmentVersion = Number.isInteger(assignment?.authzVersion) && assignment.authzVersion > 0 ? assignment.authzVersion : 0
    const claimVersion = Number.isInteger(authUser.customClaims?.authzVersion) && authUser.customClaims.authzVersion > 0 ? authUser.customClaims.authzVersion : 0
    const profileVersion = Number.isInteger(profile.authzVersion) && profile.authzVersion > 0 ? profile.authzVersion : 0
    const assignmentCanonical = assignment
      && assignment.accessRole === 'staff'
      && stableJson(normalizedArray(assignment.positions)) === stableJson(['trainer_pt'])
      && stableJson(normalizedArray(assignment.branchIds)) === stableJson(branches)
      && assignment.status === 'active'
      && assignmentVersion > 0
    const authzVersion = assignmentCanonical ? assignmentVersion : Math.max(assignmentVersion, claimVersion, profileVersion, 0) + 1
    const desiredAssignment = {
      schemaVersion: 1,
      uid,
      accessRole: 'staff',
      positions: ['trainer_pt'],
      branchIds: branches,
      authzVersion,
      status: 'active',
      crmProfileId: uid,
    }
    const desiredProfile = { role: 'trainer', accessRole: 'staff', authzVersion }
    const nextClaims = { ...(authUser.customClaims || {}) }
    delete nextClaims.positions
    delete nextClaims.branchIds
    delete nextClaims.capabilities
    delete nextClaims.permissions
    nextClaims.accessRole = 'staff'
    nextClaims.authzVersion = authzVersion
    nextClaims.role = 'trainer'
    if (Buffer.byteLength(JSON.stringify(nextClaims), 'utf8') > 900) {
      quarantined.push({ uid, reasons: ['custom_claims_too_large'] })
      continue
    }

    const firestoreWriteRequired = !exactSubset(assignment, desiredAssignment) || !exactSubset(profile, desiredProfile)
    const claimsWriteRequired = stableJson(authUser.customClaims || {}) !== stableJson(nextClaims)
    const stateFingerprint = candidateFingerprint(uid, profile, assignment, staffRecord, trainerRecord, authUser)
    candidates.push({
      uid, authzVersion, branches, desiredAssignment, desiredProfile, nextClaims,
      originalClaims: authUser.customClaims || {},
      firestoreWriteRequired, claimsWriteRequired, stateFingerprint,
    })
  }

  const publicCandidates = candidates.map((item) => ({
    uidHash: sha256(Buffer.from(item.uid)),
    branchHashes: item.branches.map((branch) => sha256(Buffer.from(branch))),
    authzVersion: item.authzVersion,
    firestoreWriteRequired: item.firestoreWriteRequired,
    claimsWriteRequired: item.claimsWriteRequired,
    canonical: !item.firestoreWriteRequired && !item.claimsWriteRequired,
    stateFingerprint: item.stateFingerprint,
  })).sort((left, right) => left.uidHash.localeCompare(right.uidHash))
  const publicQuarantined = quarantined.map((item) => ({
    uidHash: sha256(Buffer.from(item.uid)),
    reasonCodes: item.reasons,
  })).sort((left, right) => left.uidHash.localeCompare(right.uidHash))
  const planDigest = digest({ target: TARGET_RESOURCE, candidates: publicCandidates, quarantined: publicQuarantined })
  return { candidates, quarantined, publicCandidates, publicQuarantined, planDigest }
}

function counts(state, plan) {
  const reasonCounts = {}
  for (const item of plan.quarantined) {
    for (const reason of item.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
  }
  return {
    authUsers: state.authUsers.length,
    userProfiles: state.users.length,
    roleAssignments: state.assignments.length,
    staffRecords: state.staff.length,
    trainerRecords: state.trainers.length,
    deterministicTrainers: plan.candidates.length,
    readyToApply: plan.candidates.filter((item) => item.firestoreWriteRequired || item.claimsWriteRequired).length,
    alreadyCanonical: plan.candidates.filter((item) => !item.firestoreWriteRequired && !item.claimsWriteRequired).length,
    quarantined: plan.quarantined.length,
    quarantineReasons: reasonCounts,
  }
}

function updateWrite(collectionName, id, fields, transformFields = []) {
  return {
    update: { name: resourceName(collectionName, id), fields: encodeFields(fields) },
    updateMask: { fieldPaths: Object.keys(fields) },
    ...(transformFields.length ? {
      updateTransforms: transformFields.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
    } : {}),
  }
}

function batchEntry(rows, name) {
  const flat = Array.isArray(rows) ? rows.flat() : [rows]
  const row = flat.find((item) => item?.found?.name === name || item?.missing === name)
  if (!row) throw new PublicError('transaction_read_incomplete', 'Transaction returned incomplete target data.')
  return row.missing ? null : { id: documentId(row.found.name), data: decodeFields(row.found.fields || {}) }
}

async function writeFirestoreIdentity(state, candidate, planDigest) {
  const begin = await requestJson(state.accessToken, `${databaseBase()}/documents:beginTransaction`, {
    method: 'POST', body: JSON.stringify({ options: { readWrite: {} } }), errorCode: 'transaction_begin_failed',
  })
  const transaction = begin?.transaction
  if (!transaction) throw new PublicError('transaction_begin_invalid', 'Unable to begin identity transaction.')
  const names = {
    user: resourceName('users', candidate.uid),
    assignment: resourceName('roleAssignments', candidate.uid),
    staff: resourceName('staff', candidate.uid),
    trainer: resourceName('trainers', candidate.uid),
  }
  try {
    const rows = await requestJson(state.accessToken, `${databaseBase()}/documents:batchGet`, {
      method: 'POST', body: JSON.stringify({ documents: Object.values(names), transaction }), errorCode: 'transaction_read_failed',
    })
    const user = batchEntry(rows, names.user)?.data || null
    const assignment = batchEntry(rows, names.assignment)?.data || null
    const staff = batchEntry(rows, names.staff)?.data || null
    const trainer = batchEntry(rows, names.trainer)?.data || null
    const authUser = await state.auth.getUser(candidate.uid)
    if (candidateFingerprint(candidate.uid, user, assignment, staff, trainer, authUser) !== candidate.stateFingerprint) {
      throw new PublicError('identity_precondition_changed', 'Target identity changed after approval; migration is blocked.')
    }
    const auditId = `staff_access_link_${sha256(Buffer.from(candidate.uid)).slice(0, 40)}`
    const writes = [
      updateWrite('roleAssignments', candidate.uid, {
        ...candidate.desiredAssignment,
        migrationPlanDigest: planDigest,
        updatedBy: 'migration:legacy-trainer-access',
      }, ['updatedAt', ...(!assignment ? ['createdAt'] : [])]),
      updateWrite('users', candidate.uid, candidate.desiredProfile, ['updatedAt']),
      updateWrite('identityAuditLogs', auditId, {
        schemaVersion: 1,
        action: 'legacy_trainer.access_linked',
        actorType: 'migration',
        targetUidHash: sha256(Buffer.from(candidate.uid)),
        authzVersion: candidate.authzVersion,
        planDigest,
      }, ['createdAt']),
    ]
    await requestJson(state.accessToken, `${databaseBase()}/documents:commit`, {
      method: 'POST', body: JSON.stringify({ writes, transaction }), errorCode: 'transaction_commit_failed',
    })
  } catch (error) {
    try {
      await requestJson(state.accessToken, `${databaseBase()}/documents:rollback`, {
        method: 'POST', body: JSON.stringify({ transaction }), errorCode: 'transaction_rollback_failed',
      })
    } catch { /* An uncommitted transaction expires without writes. */ }
    throw error
  }
}

async function dryRun(flags) {
  const state = await loadState()
  try {
    const plan = buildPlan(state)
    const report = {
      schemaVersion: 1,
      mode: 'dry-run',
      generatedAt: new Date().toISOString(),
      target: { projectId: TARGET_PROJECT, databaseId: TARGET_DATABASE },
      planDigest: plan.planDigest,
      counts: counts(state, plan),
      candidates: plan.publicCandidates,
      quarantined: plan.publicQuarantined,
      writesPerformed: false,
      piiPolicy: 'UID and branch identifiers are SHA-256 hashed; names, email addresses and phone numbers are omitted.',
    }
    const reportPath = writeReport(flags.report || DEFAULT_REPORTS['dry-run'], report)
    const dryRunDigest = sha256(fs.readFileSync(reportPath))
    console.log(JSON.stringify({ mode: 'dry-run', ...report.counts, planDigest: plan.planDigest, dryRunDigest, reportPath, writesPerformed: false }, null, 2))
  } finally {
    await deleteApp(state.app)
  }
}

function approveDryRun(flags, plan) {
  if (requiredFlag(flags, 'confirm') !== APPLY_CONFIRMATION) throw new PublicError('production_confirmation_failed', `--confirm must equal ${APPLY_CONFIRMATION}.`)
  const suppliedDigest = requiredFlag(flags, 'dry-run-digest').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(suppliedDigest)) throw new PublicError('dry_run_digest_invalid', 'Dry-run digest must be SHA-256.')
  const approved = readReport(requiredFlag(flags, 'dry-run-report'), 'dry-run')
  if (sha256(Buffer.from(approved.raw, 'utf8')) !== suppliedDigest) throw new PublicError('dry_run_digest_mismatch', 'Approved dry-run digest does not match the report.')
  if (approved.report.planDigest !== plan.planDigest
      || stableJson(approved.report.candidates) !== stableJson(plan.publicCandidates)) {
    throw new PublicError('stale_dry_run', 'Production identity state changed after dry-run; apply is blocked.')
  }
  return approved
}

async function apply(flags) {
  const state = await loadState()
  try {
    const plan = buildPlan(state)
    const approved = approveDryRun(flags, plan)
    const successful = []
    const errors = []
    for (const candidate of plan.candidates) {
      try {
        const [preflightAuth, preflightUser, preflightAssignment, preflightStaff, preflightTrainer] = await Promise.all([
          state.auth.getUser(candidate.uid),
          readDocument(state.accessToken, 'users', candidate.uid),
          readDocument(state.accessToken, 'roleAssignments', candidate.uid),
          readDocument(state.accessToken, 'staff', candidate.uid),
          readDocument(state.accessToken, 'trainers', candidate.uid),
        ])
        if (candidateFingerprint(
          candidate.uid,
          preflightUser?.data,
          preflightAssignment?.data,
          preflightStaff?.data,
          preflightTrainer?.data,
          preflightAuth,
        ) !== candidate.stateFingerprint) {
          throw new PublicError('identity_precondition_changed', 'Target identity changed after dry-run; apply is blocked.')
        }
        if (candidate.firestoreWriteRequired) await writeFirestoreIdentity(state, candidate, plan.planDigest)
        const liveAuth = await state.auth.getUser(candidate.uid)
        if (candidate.claimsWriteRequired
            && stableJson(liveAuth.customClaims || {}) !== stableJson(candidate.originalClaims)) {
          throw new PublicError('auth_precondition_changed', 'Auth claims changed after dry-run; claims update is blocked.')
        }
        if (candidate.claimsWriteRequired) await state.auth.setCustomUserClaims(candidate.uid, candidate.nextClaims)
        const [verifiedAuth, verifiedAssignment, verifiedProfile] = await Promise.all([
          state.auth.getUser(candidate.uid),
          readDocument(state.accessToken, 'roleAssignments', candidate.uid),
          readDocument(state.accessToken, 'users', candidate.uid),
        ])
        if (stableJson(verifiedAuth.customClaims || {}) !== stableJson(candidate.nextClaims)
            || !exactSubset(verifiedAssignment?.data, candidate.desiredAssignment)
            || !exactSubset(verifiedProfile?.data, candidate.desiredProfile)) {
          throw new PublicError('post_write_verification_failed', 'A staff identity failed post-write verification.')
        }
        successful.push({ uidHash: sha256(Buffer.from(candidate.uid)), verified: true })
      } catch (error) {
        errors.push({ uidHash: sha256(Buffer.from(candidate.uid)), code: error instanceof PublicError ? error.code : 'candidate_apply_failed' })
      }
    }
    const report = {
      schemaVersion: 1,
      mode: 'apply',
      generatedAt: new Date().toISOString(),
      target: { projectId: TARGET_PROJECT, databaseId: TARGET_DATABASE },
      planDigest: plan.planDigest,
      approvedDryRunDigest: sha256(Buffer.from(approved.raw, 'utf8')),
      counts: { attempted: plan.candidates.length, verified: successful.length, failed: errors.length, quarantined: plan.quarantined.length },
      successful,
      errors,
      piiPolicy: 'UID identifiers are SHA-256 hashed; names, email addresses and phone numbers are omitted.',
    }
    const reportPath = writeReport(flags.report || DEFAULT_REPORTS.apply, report)
    console.log(JSON.stringify({ mode: 'apply', ...report.counts, reportPath }, null, 2))
    if (errors.length) throw new PublicError('partial_apply', 'Migration completed with failures. Run a fresh dry-run before retrying.')
  } finally {
    await deleteApp(state.app)
  }
}

async function verify(flags) {
  const applyReport = readReport(requiredFlag(flags, 'apply-report'), 'apply').report
  const expected = new Set((applyReport.successful || []).map((item) => item.uidHash))
  const state = await loadState()
  try {
    const plan = buildPlan(state)
    const live = new Map(plan.publicCandidates.map((item) => [item.uidHash, item]))
    const failures = []
    for (const uidHash of expected) {
      const item = live.get(uidHash)
      if (!item || !item.canonical) failures.push({ uidHash, code: item ? 'not_canonical' : 'candidate_missing' })
    }
    const report = {
      schemaVersion: 1,
      mode: 'verify',
      generatedAt: new Date().toISOString(),
      target: { projectId: TARGET_PROJECT, databaseId: TARGET_DATABASE },
      counts: { expected: expected.size, verifiedCanonical: expected.size - failures.length, failed: failures.length, quarantined: plan.quarantined.length },
      failures,
      quarantined: plan.publicQuarantined,
      writesPerformed: false,
    }
    const reportPath = writeReport(flags.report || DEFAULT_REPORTS.verify, report)
    console.log(JSON.stringify({ mode: 'verify', ...report.counts, reportPath, writesPerformed: false }, null, 2))
    if (failures.length) throw new PublicError('verification_failed', 'Some staff identities are not canonical.')
  } finally {
    await deleteApp(state.app)
  }
}

async function main() {
  const { command, flags } = parseArguments(process.argv.slice(2))
  if (command === 'dry-run') return dryRun(flags)
  if (command === 'apply') return apply(flags)
  return verify(flags)
}

main().catch((error) => {
  const code = error instanceof PublicError ? error.code : 'unexpected_failure'
  console.error(JSON.stringify({ ok: false, code, message: error instanceof PublicError ? error.message : 'Unexpected migration failure.' }, null, 2))
  process.exitCode = 1
})
