'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { deleteApp, initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { computedCapabilities } = require('../functions/identity-access')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const RETIRED_SOURCE_PROJECT = 'gen-lang-client-0246058381'
const TARGET_RESOURCE = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`
const APPLY_CONFIRMATION = `${TARGET_RESOURCE}:repair-super-admin`
const PRIVATE_DIRECTORY = path.resolve('.migration-private')
const AUTHORIZATION_CLAIMS = new Set([
  'role', 'accessRole', 'authzVersion', 'positions', 'branchIds', 'capabilities',
  'permissions', 'scopes', 'admin', 'super_admin', 'staff', 'coach', 'trainer',
  'sales', 'manager', 'editor', 'shipper',
])

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
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

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid --email is required.')
  return email
}

function parseArguments(argv) {
  const result = { mode: 'dry-run' }
  for (const argument of argv) {
    if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--email=')) result.email = normalizeEmail(argument.slice(8))
    else if (argument.startsWith('--project=')) result.projectId = argument.slice(10)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice(11)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirmation = argument.slice(10)
    else if (argument === '--help') result.help = true
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  return result
}

function usage() {
  return [
    'Target-only Identity v2 super-admin repair.',
    'Dry run:',
    '  node scripts/firebase-super-admin-repair.cjs --mode=dry-run --email=<EMAIL>',
    'Apply:',
    `  node scripts/firebase-super-admin-repair.cjs --mode=apply --email=<EMAIL> --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<DIGEST> --confirm=${APPLY_CONFIRMATION}`,
    'Verify:',
    '  node scripts/firebase-super-admin-repair.cjs --mode=verify --email=<EMAIL>',
  ].join('\n')
}

function assertArguments(arguments_) {
  if (TARGET.projectId === RETIRED_SOURCE_PROJECT) throw new Error('Target points to the retired source project.')
  if (!arguments_.email && !arguments_.help) throw new Error('A valid --email is required.')
  if (arguments_.mode !== 'apply') return
  if (arguments_.projectId !== TARGET.projectId || arguments_.databaseId !== TARGET.databaseId) {
    throw new Error('Apply requires the exact production target.')
  }
  if (!/^[a-f0-9]{64}$/.test(arguments_.digest || '')) throw new Error('Apply requires the latest dry-run digest.')
  if (arguments_.confirmation !== APPLY_CONFIRMATION) throw new Error('Apply confirmation is missing or incorrect.')
}

function cliAuth() {
  const modulePath = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js')
  const auth = require(modulePath)
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function accessToken() {
  const { auth, account } = cliAuth()
  const token = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!token?.access_token) throw new Error('Unable to obtain Firebase access.')
  return token.access_token
}

function credential(token) {
  return { getAccessToken: async () => ({ access_token: token, expires_in: 3600 }) }
}

async function requestJson(token, endpoint, options = {}) {
  const response = await fetch(`https://firestore.googleapis.com/v1/${TARGET_RESOURCE}${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  if (response.status === 404 && options.allowMissing) return null
  const raw = await response.text()
  if (!response.ok) throw new Error(`Target Firestore request failed (${response.status}).`)
  return raw ? JSON.parse(raw) : null
}

function decodeValue(value = {}) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeValue)
  if ('mapValue' in value) return decodeFields(value.mapValue?.fields || {})
  return undefined
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]))
}

function encodeValue(value) {
  if (value === null || typeof value === 'undefined') return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFields(value) } }
  throw new Error('Unsupported Firestore value.')
}

function encodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]))
}

async function readDocument(token, collection, id) {
  const document = await requestJson(token, `/documents/${collection}/${encodeURIComponent(id)}`, { allowMissing: true })
  return document ? { fields: decodeFields(document.fields || {}), updateTime: document.updateTime } : null
}

function cleanClaims(claims) {
  const result = {}
  for (const [key, value] of Object.entries(claims || {})) {
    if (!AUTHORIZATION_CLAIMS.has(key)) result[key] = value
  }
  return result
}

function equalArray(left, right) {
  return stableJson([...(left || [])].sort()) === stableJson([...(right || [])].sort())
}

function canonicalAccessState(authUser, profile, assignment) {
  const expectedCapabilities = computedCapabilities('super_admin', [])
  const versions = [authUser.customClaims?.authzVersion, profile?.fields.authzVersion, assignment?.fields.authzVersion]
    .map(Number).filter((value) => Number.isInteger(value) && value > 0)
  const authzVersion = Math.max(1, ...versions)
  const claimsCurrent = authUser.customClaims?.role === 'super_admin'
    && authUser.customClaims?.accessRole === 'super_admin'
    && Number(authUser.customClaims?.authzVersion) === authzVersion
  const profileCurrent = Boolean(profile)
    && profile.fields.uid === authUser.uid
    && profile.fields.role === 'super_admin'
    && profile.fields.accessRole === 'super_admin'
    && Number(profile.fields.authzVersion) === authzVersion
    && profile.fields.disabled !== true
  const assignmentCurrent = Boolean(assignment)
    && assignment.fields.uid === authUser.uid
    && assignment.fields.accessRole === 'super_admin'
    && Number(assignment.fields.authzVersion) === authzVersion
    && assignment.fields.status === 'active'
    && equalArray(assignment.fields.positions, [])
    && equalArray(assignment.fields.branchIds, [])
    && equalArray(assignment.fields.capabilities, expectedCapabilities)
  return { current: claimsCurrent && profileCurrent && assignmentCurrent, authzVersion, expectedCapabilities }
}

function buildPlan(authUser, profile, assignment) {
  const observed = canonicalAccessState(authUser, profile, assignment)
  const authzVersion = observed.current ? observed.authzVersion : observed.authzVersion + 1
  const identityName = String(authUser.displayName || authUser.email?.split('@')[0] || 'Super Administrator').trim()
  const desiredClaims = { ...cleanClaims(authUser.customClaims), role: 'super_admin', accessRole: 'super_admin', authzVersion }
  const profileFields = {
    uid: authUser.uid,
    role: 'super_admin',
    accessRole: 'super_admin',
    authzVersion,
    disabled: false,
    ...(!profile ? {
      email: String(authUser.email || ''),
      displayName: identityName,
      name: identityName,
      ...(authUser.phoneNumber ? { phone: authUser.phoneNumber, phoneNumber: authUser.phoneNumber } : {}),
    } : {}),
  }
  const assignmentFields = {
    schemaVersion: 1,
    uid: authUser.uid,
    accessRole: 'super_admin',
    positions: [],
    branchIds: [],
    capabilities: observed.expectedCapabilities,
    authzVersion,
    status: 'active',
    updatedBy: 'system:super-admin-repair',
  }
  const fingerprint = {
    uidHash: sha256(authUser.uid),
    authClaims: authUser.customClaims || {},
    authDisabled: authUser.disabled,
    profile: profile ? { updateTime: profile.updateTime, fields: profile.fields } : null,
    assignment: assignment ? { updateTime: assignment.updateTime, fields: assignment.fields } : null,
  }
  const planDigest = sha256(stableJson({ target: TARGET, fingerprint, desiredClaims, profileFields, assignmentFields }))
  return { current: observed.current, authzVersion, desiredClaims, profileFields, assignmentFields, planDigest }
}

async function readState(token, auth, email) {
  const authUser = await auth.getUserByEmail(email)
  const [profile, assignment] = await Promise.all([
    readDocument(token, 'users', authUser.uid),
    readDocument(token, 'roleAssignments', authUser.uid),
  ])
  return { authUser, profile, assignment, plan: buildPlan(authUser, profile, assignment) }
}

function reportPath(email, mode) {
  return path.join(PRIVATE_DIRECTORY, `super-admin-repair-${sha256(email).slice(0, 16)}-${mode}.json`)
}

function publicReport(mode, email, state, extra = {}) {
  return {
    mode,
    generatedAt: new Date().toISOString(),
    target: TARGET,
    sourceProjectAccessed: false,
    emailHash: sha256(email),
    uidHash: sha256(state.authUser.uid),
    planDigest: state.plan.planDigest,
    repairRequired: !state.plan.current,
    auth: {
      disabled: state.authUser.disabled,
      role: state.authUser.customClaims?.role || null,
      accessRole: state.authUser.customClaims?.accessRole || null,
      authzVersion: state.authUser.customClaims?.authzVersion || null,
    },
    profileExists: Boolean(state.profile),
    assignmentExists: Boolean(state.assignment),
    desiredAccessRole: 'super_admin',
    desiredAuthzVersion: state.plan.authzVersion,
    writesPerformed: false,
    ...extra,
  }
}

function writeReport(email, mode, report) {
  fs.mkdirSync(PRIVATE_DIRECTORY, { recursive: true })
  const destination = reportPath(email, mode)
  const temporary = `${destination}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, destination)
  return destination
}

function loadDryRun(email, digest) {
  const report = JSON.parse(fs.readFileSync(reportPath(email, 'dry-run'), 'utf8'))
  if (report.mode !== 'dry-run' || stableJson(report.target) !== stableJson(TARGET) || report.emailHash !== sha256(email)) {
    throw new Error('Dry-run report does not match this target or account.')
  }
  if (report.planDigest !== digest) throw new Error('Digest does not match the latest dry-run report.')
}

function documentWrite(collection, id, current, fields) {
  return {
    update: { name: `${TARGET_RESOURCE}/documents/${collection}/${id}`, fields: encodeFields(fields) },
    updateMask: { fieldPaths: Object.keys(fields) },
    currentDocument: current ? { updateTime: current.updateTime } : { exists: false },
    updateTransforms: [
      ...(!current ? [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] : []),
      { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
    ],
  }
}

function auditWrite(uid, plan) {
  return {
    update: {
      name: `${TARGET_RESOURCE}/documents/identityAuditLogs/super_admin_repair_${plan.planDigest.slice(0, 40)}`,
      fields: encodeFields({
        schemaVersion: 1,
        action: 'identity.super_admin_repaired',
        actorUid: 'system:super-admin-repair',
        targetUid: uid,
        accessRole: 'super_admin',
        authzVersion: plan.authzVersion,
        planDigest: plan.planDigest,
      }),
    },
    currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
  }
}

async function applyPlan(token, auth, state) {
  const previousClaims = state.authUser.customClaims || {}
  await auth.setCustomUserClaims(state.authUser.uid, state.plan.desiredClaims)
  try {
    await requestJson(token, '/documents:commit', {
      method: 'POST',
      body: JSON.stringify({ writes: [
        documentWrite('users', state.authUser.uid, state.profile, state.plan.profileFields),
        documentWrite('roleAssignments', state.authUser.uid, state.assignment, state.plan.assignmentFields),
        auditWrite(state.authUser.uid, state.plan),
      ] }),
    })
  } catch (error) {
    await auth.setCustomUserClaims(state.authUser.uid, previousClaims)
    throw error
  }
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2))
  if (arguments_.help) return console.log(usage())
  assertArguments(arguments_)
  const token = await accessToken()
  const app = initializeApp({ projectId: TARGET.projectId, credential: credential(token) }, `super-admin-repair-${Date.now()}`)
  const auth = getAuth(app)
  try {
    const state = await readState(token, auth, arguments_.email)
    if (arguments_.mode === 'dry-run') {
      const report = publicReport('dry-run', arguments_.email, state, { applyConfirmation: APPLY_CONFIRMATION })
      const destination = writeReport(arguments_.email, 'dry-run', report)
      console.log(JSON.stringify({ mode: 'dry-run', repairRequired: report.repairRequired, planDigest: report.planDigest, desiredAuthzVersion: report.desiredAuthzVersion, reportPath: destination }, null, 2))
      return
    }
    if (arguments_.mode === 'apply') {
      loadDryRun(arguments_.email, arguments_.digest)
      if (state.plan.planDigest !== arguments_.digest) throw new Error('Live identity changed after dry-run; apply aborted.')
      if (!state.plan.current) await applyPlan(token, auth, state)
      const verified = await readState(token, auth, arguments_.email)
      const report = publicReport('apply', arguments_.email, verified, { writesPerformed: !state.plan.current, verified: verified.plan.current })
      const destination = writeReport(arguments_.email, 'apply', report)
      console.log(JSON.stringify({ mode: 'apply', repaired: !state.plan.current, verified: verified.plan.current, authzVersion: verified.plan.authzVersion, reportPath: destination }, null, 2))
      if (!verified.plan.current) process.exitCode = 2
      return
    }
    const report = publicReport('verify', arguments_.email, state, { verified: state.plan.current })
    const destination = writeReport(arguments_.email, 'verify', report)
    console.log(JSON.stringify({ mode: 'verify', verified: state.plan.current, authzVersion: state.plan.authzVersion, reportPath: destination }, null, 2))
    if (!state.plan.current) process.exitCode = 2
  } finally {
    await deleteApp(app)
  }
}

if (require.main === module) main().catch((error) => {
  console.error(error?.message || 'Super-admin repair failed.')
  process.exitCode = 1
})

module.exports = { TARGET, APPLY_CONFIRMATION, buildPlan, canonicalAccessState }
