'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { deleteApp, initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

// This tool is deliberately target-only. Do not add a source project flag or
// source credential: student CRM records and Auth users are both read from the
// current production target.
const TARGET_PROJECT = 'gen-lang-client-0815966909'
const TARGET_DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const TARGET_RESOURCE = `projects/${TARGET_PROJECT}/databases/${TARGET_DATABASE}`
const APPLY_CONFIRMATION = `${TARGET_RESOURCE}:link-student-identities`
const PRIVATE_DIRECTORY = path.resolve('.migration-private')
const DEFAULT_REPORTS = {
  'dry-run': path.join(PRIVATE_DIRECTORY, 'student-identity-link-dry-run.json'),
  apply: path.join(PRIVATE_DIRECTORY, 'student-identity-link-apply.json'),
  verify: path.join(PRIVATE_DIRECTORY, 'student-identity-link-verify.json'),
}

const LEARNER_ROLES = new Set(['', 'student', 'user'])
const LEARNER_ACCESS_ROLES = new Set(['', 'student'])
const UID_FIELDS = ['authUid', 'firebaseUid', 'userId', 'uid']
const AUTHORIZATION_CLAIM_KEYS = new Set([
  'role', 'accessRole', 'authzVersion', 'positions', 'branchIds',
  'capabilities', 'permissions', 'scopes', 'admin', 'super_admin',
  'staff', 'coach', 'trainer', 'sales', 'manager', 'editor', 'shipper',
])
const AUTHORIZATION_KEY_PATTERN = /(role|admin|staff|position|capabil|permission|branch|scope|privileg|trainer|coach|sales|shipper|editor)/i

const USAGE = [
  'Usage:',
  '  node scripts/firebase-student-identity-link.cjs dry-run [--report=.migration-private/report.json]',
  `  node scripts/firebase-student-identity-link.cjs apply --dry-run-report=<path> --dry-run-digest=<sha256> --confirm=${APPLY_CONFIRMATION} [--report=.migration-private/report.json]`,
  '  node scripts/firebase-student-identity-link.cjs verify --apply-report=<path> [--report=.migration-private/report.json]',
  '',
  'dry-run and verify are target-only reads. apply is blocked without the exact report digest and confirmation value.',
].join('\n')

class PublicError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
    this.publicMessage = message
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      const item = value[key]
      if (typeof item !== 'undefined') result[key] = canonical(item)
      return result
    }, {})
  }
  return value
}

function stableJson(value) {
  return JSON.stringify(canonical(value))
}

function stateDigest(value) {
  return sha256(stableJson(value))
}

function parseArguments(argv) {
  const command = argv[0]
  const flags = {}
  for (const argument of argv.slice(1)) {
    if (!argument.startsWith('--') || !argument.includes('=')) {
      throw new PublicError('invalid_argument', USAGE)
    }
    const separator = argument.indexOf('=')
    const key = argument.slice(2, separator)
    const value = argument.slice(separator + 1)
    if (!key || !value || Object.prototype.hasOwnProperty.call(flags, key)) {
      throw new PublicError('invalid_argument', USAGE)
    }
    flags[key] = value
  }

  const allowed = {
    'dry-run': new Set(['report']),
    apply: new Set(['dry-run-report', 'dry-run-digest', 'confirm', 'report']),
    verify: new Set(['apply-report', 'report']),
  }[command]
  if (!allowed) throw new PublicError('unknown_command', USAGE)
  for (const key of Object.keys(flags)) {
    if (!allowed.has(key)) throw new PublicError('unsupported_argument', `Unsupported --${key}.\n${USAGE}`)
  }
  return { command, flags }
}

function requiredFlag(flags, name) {
  const value = flags[name]
  if (!value) throw new PublicError('missing_argument', `Missing --${name}.\n${USAGE}`)
  return value
}

function assertPrivateReportPath(filePath) {
  const resolved = path.resolve(filePath)
  const relative = path.relative(PRIVATE_DIRECTORY, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PublicError('unsafe_report_path', 'Reports must remain under .migration-private.')
  }
  return resolved
}

function writeReport(filePath, report) {
  const resolved = assertPrivateReportPath(filePath)
  fs.mkdirSync(PRIVATE_DIRECTORY, { recursive: true })
  const temporary = `${resolved}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, resolved)
  return resolved
}

function readReport(filePath, expectedMode) {
  const resolved = assertPrivateReportPath(filePath)
  let raw
  try {
    raw = fs.readFileSync(resolved, 'utf8')
  } catch {
    throw new PublicError('report_unreadable', `Unable to read the ${expectedMode} report.`)
  }
  let report
  try {
    report = JSON.parse(raw)
  } catch {
    throw new PublicError('report_invalid', `The ${expectedMode} report is not valid JSON.`)
  }
  if (report?.mode !== expectedMode
      || report?.target?.projectId !== TARGET_PROJECT
      || report?.target?.databaseId !== TARGET_DATABASE) {
    throw new PublicError('report_target_mismatch', `The ${expectedMode} report does not belong to this target.`)
  }
  return { resolved, raw, report }
}

function normalizeEmail(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : ''
}

function normalizePhone(value) {
  const compact = typeof value === 'string' ? value.trim().replace(/[\s().-]/g, '') : ''
  if (!compact) return ''
  const digits = compact.replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 12) return ''
  if (compact.startsWith('+')) return `+${digits}`
  if (digits.startsWith('84')) return `+${digits}`
  if (digits.startsWith('0')) return `+84${digits.slice(1)}`
  return `+84${digits}`
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0
}

function nonEmptyClaim(value) {
  if (value === undefined || value === null || value === '' || value === false) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function safeClaims(customClaims) {
  const claims = customClaims && typeof customClaims === 'object' && !Array.isArray(customClaims)
    ? customClaims
    : {}
  const preserved = {}
  for (const [key, value] of Object.entries(claims)) {
    if (AUTHORIZATION_CLAIM_KEYS.has(key) || AUTHORIZATION_KEY_PATTERN.test(key)) continue
    preserved[key] = value
  }
  return preserved
}

function unsafeClaimCodes(customClaims) {
  const claims = customClaims && typeof customClaims === 'object' && !Array.isArray(customClaims)
    ? customClaims
    : {}
  const reasons = []
  const legacyRole = typeof claims.role === 'string' ? claims.role.trim().toLowerCase() : ''
  const accessRole = typeof claims.accessRole === 'string' ? claims.accessRole.trim().toLowerCase() : ''
  if (!LEARNER_ROLES.has(legacyRole)) reasons.push('privileged_auth_role')
  if (!LEARNER_ACCESS_ROLES.has(accessRole)) reasons.push('privileged_auth_access_role')
  if (nonEmptyArray(claims.positions)) reasons.push('auth_staff_positions')
  if (nonEmptyArray(claims.branchIds) || nonEmptyArray(claims.capabilities)) reasons.push('auth_scoped_capabilities')
  for (const [key, value] of Object.entries(claims)) {
    if (['role', 'accessRole', 'authzVersion', 'positions', 'branchIds', 'capabilities'].includes(key)) continue
    if ((AUTHORIZATION_CLAIM_KEYS.has(key) || AUTHORIZATION_KEY_PATTERN.test(key)) && nonEmptyClaim(value)) {
      reasons.push('unknown_authorization_claim')
      break
    }
  }
  return [...new Set(reasons)]
}

function roleCodes(value, prefix) {
  if (!value || typeof value !== 'object') return []
  const reasons = []
  const legacyRole = typeof value.role === 'string' ? value.role.trim().toLowerCase() : ''
  const accessRole = typeof value.accessRole === 'string' ? value.accessRole.trim().toLowerCase() : ''
  if (!LEARNER_ROLES.has(legacyRole)) reasons.push(`${prefix}_privileged_role`)
  if (!LEARNER_ACCESS_ROLES.has(accessRole)) reasons.push(`${prefix}_privileged_access_role`)
  if (nonEmptyArray(value.positions)) reasons.push(`${prefix}_staff_positions`)
  if (nonEmptyArray(value.branchIds) || nonEmptyArray(value.capabilities)) reasons.push(`${prefix}_scoped_capabilities`)
  return reasons
}

function addToIndex(index, key, value) {
  if (!key) return
  const items = index.get(key) || []
  items.push(value)
  index.set(key, items)
}

function authIndexes(authUsers) {
  const uid = new Map()
  const email = new Map()
  const phone = new Map()
  for (const user of authUsers) {
    uid.set(user.uid, user)
    addToIndex(email, normalizeEmail(user.email), user)
    addToIndex(phone, normalizePhone(user.phoneNumber), user)
  }
  return { uid, email, phone }
}

function documentMap(documents) {
  return new Map(documents.map((document) => [document.id, document.data]))
}

function directUidValues(document) {
  const values = new Set()
  for (const field of UID_FIELDS) {
    const value = document.data?.[field]
    if (typeof value === 'string' && value.trim()) values.add(value.trim())
  }
  return [...values]
}

function staffEvidence(records, authUser) {
  const email = normalizeEmail(authUser.email)
  const phone = normalizePhone(authUser.phoneNumber)
  return records.some((record) => {
    if (record.id === authUser.uid) return true
    if (directUidValues(record).includes(authUser.uid)) return true
    const recordEmail = normalizeEmail(record.data?.email || record.data?.emailAddress)
    const recordPhone = normalizePhone(record.data?.phone || record.data?.phoneNumber)
    return Boolean((email && recordEmail === email) || (phone && recordPhone === phone))
  })
}

function claimsFingerprint(authUser) {
  return stateDigest({
    disabled: authUser.disabled === true,
    email: normalizeEmail(authUser.email),
    phone: normalizePhone(authUser.phoneNumber),
    customClaims: authUser.customClaims || {},
  })
}

function firestoreFingerprint(student, assignment, profile) {
  return stateDigest({
    student: {
      id: student.id,
      directUids: directUidValues(student).sort(),
      email: normalizeEmail(student.data?.email || student.data?.emailAddress),
      phone: normalizePhone(student.data?.phone || student.data?.phoneNumber),
    },
    assignment: assignment ? {
      schemaVersion: assignment.schemaVersion,
      uid: assignment.uid,
      role: assignment.role,
      accessRole: assignment.accessRole,
      positions: assignment.positions,
      branchIds: assignment.branchIds,
      capabilities: assignment.capabilities,
      authzVersion: assignment.authzVersion,
      status: assignment.status,
      crmProfileId: assignment.crmProfileId,
    } : null,
    profile: profile ? {
      uid: profile.uid,
      role: profile.role,
      accessRole: profile.accessRole,
      positions: profile.positions,
      branchIds: profile.branchIds,
      capabilities: profile.capabilities,
      authzVersion: profile.authzVersion,
      status: profile.status,
      disabled: profile.disabled,
      crmProfileId: profile.crmProfileId,
    } : null,
  })
}

function desiredAuthzVersion(assignment, authUser, crmProfileId) {
  const assignmentVersion = Number.isInteger(assignment?.authzVersion) && assignment.authzVersion > 0
    ? assignment.authzVersion
    : 0
  const claimVersion = Number.isInteger(authUser.customClaims?.authzVersion) && authUser.customClaims.authzVersion > 0
    ? authUser.customClaims.authzVersion
    : 0
  if (assignment?.accessRole === 'student'
      && assignment?.status === 'active'
      && assignment?.crmProfileId === crmProfileId
      && assignmentVersion > 0) {
    return assignmentVersion
  }
  return Math.max(assignmentVersion, claimVersion, 0) + 1
}

function exactObjectSubset(value, expected) {
  return Object.entries(expected).every(([key, item]) => stableJson(value?.[key]) === stableJson(item))
}

function publicCandidate(candidate) {
  return {
    uidHash: sha256(candidate.uid),
    crmProfileIdHash: sha256(candidate.crmProfileId),
    strategy: candidate.strategy,
    authzVersion: candidate.authzVersion,
    firestoreWriteRequired: candidate.firestoreWriteRequired,
    claimsWriteRequired: candidate.claimsWriteRequired,
    stateDigest: candidate.combinedStateDigest,
    canonical: !candidate.firestoreWriteRequired && !candidate.claimsWriteRequired,
  }
}

function publicQuarantine(item) {
  return {
    crmProfileIdHash: sha256(item.crmProfileId),
    uidHash: item.uid ? sha256(item.uid) : null,
    reasonCodes: [...new Set(item.reasonCodes)].sort(),
  }
}

function buildPlan(state) {
  const indexes = authIndexes(state.authUsers)
  const profiles = documentMap(state.users)
  const assignments = documentMap(state.roleAssignments)
  const staffRecords = [...state.staff, ...state.trainers]
  const preliminary = []
  const quarantined = []
  const unmatched = []

  for (const student of state.students) {
    const email = normalizeEmail(student.data?.email || student.data?.emailAddress)
    const phone = normalizePhone(student.data?.phone || student.data?.phoneNumber)
    const explicitUids = directUidValues(student)
    const explicitExisting = explicitUids.filter((uid) => indexes.uid.has(uid))
    const explicitMissing = explicitUids.filter((uid) => !indexes.uid.has(uid))
    const documentUid = indexes.uid.has(student.id) ? student.id : ''
    const directMatches = [...new Set([...explicitExisting, ...(documentUid ? [documentUid] : [])])]
    const emailMatches = email ? (indexes.email.get(email) || []) : []
    const phoneMatches = phone ? (indexes.phone.get(phone) || []) : []
    const reasons = []

    if (explicitMissing.length > 0) reasons.push('stale_explicit_uid')
    if (directMatches.length > 1) reasons.push('ambiguous_direct_uid')
    if (emailMatches.length > 1) reasons.push('ambiguous_auth_email')
    if (phoneMatches.length > 1) reasons.push('ambiguous_auth_phone')

    let uid = directMatches.length === 1 ? directMatches[0] : ''
    let strategy = uid ? 'direct_uid' : ''
    const contactUids = [...new Set([
      ...(emailMatches.length === 1 ? [emailMatches[0].uid] : []),
      ...(phoneMatches.length === 1 ? [phoneMatches[0].uid] : []),
    ])]

    if (uid && contactUids.some((contactUid) => contactUid !== uid)) reasons.push('direct_contact_conflict')
    if (!uid && contactUids.length > 1) reasons.push('email_phone_conflict')
    if (!uid && contactUids.length === 1) {
      uid = contactUids[0]
      strategy = emailMatches.length === 1 && phoneMatches.length === 1 ? 'email_phone' : emailMatches.length === 1 ? 'email' : 'phone'
    }

    if (reasons.length > 0) {
      quarantined.push({ crmProfileId: student.id, uid, reasonCodes: reasons })
      continue
    }
    if (!uid) {
      unmatched.push({ crmProfileId: student.id })
      continue
    }
    preliminary.push({ student, uid, strategy })
  }

  const byUid = new Map()
  for (const item of preliminary) addToIndex(byUid, item.uid, item)
  const candidates = []
  for (const item of preliminary) {
    if ((byUid.get(item.uid) || []).length > 1) {
      quarantined.push({ crmProfileId: item.student.id, uid: item.uid, reasonCodes: ['auth_matches_multiple_crm_profiles'] })
      continue
    }

    const authUser = indexes.uid.get(item.uid)
    const profile = profiles.get(item.uid) || null
    const assignment = assignments.get(item.uid) || null
    const reasons = []
    if (!authUser || authUser.disabled === true) reasons.push('auth_missing_or_disabled')
    if (authUser) reasons.push(...unsafeClaimCodes(authUser.customClaims))
    reasons.push(...roleCodes(profile, 'profile'))
    reasons.push(...roleCodes(assignment, 'assignment'))
    if (profile?.disabled === true) reasons.push('profile_disabled')
    if (assignment && !['', 'active'].includes(String(assignment.status || ''))) reasons.push('assignment_not_active')
    if (assignment?.crmProfileId && assignment.crmProfileId !== item.student.id) reasons.push('assignment_crm_conflict')
    if (profile?.crmProfileId && profile.crmProfileId !== item.student.id) reasons.push('profile_crm_conflict')
    if (authUser && staffEvidence(staffRecords, authUser)) reasons.push('staff_record_match')

    if (reasons.length > 0) {
      quarantined.push({ crmProfileId: item.student.id, uid: item.uid, reasonCodes: reasons })
      continue
    }

    const authzVersion = desiredAuthzVersion(assignment, authUser, item.student.id)
    const nextClaims = {
      ...safeClaims(authUser.customClaims),
      accessRole: 'student',
      authzVersion,
      role: 'student',
    }
    if (Buffer.byteLength(JSON.stringify(nextClaims), 'utf8') > 900) {
      quarantined.push({ crmProfileId: item.student.id, uid: item.uid, reasonCodes: ['safe_claims_too_large'] })
      continue
    }

    const desiredAssignment = {
      schemaVersion: 1,
      uid: item.uid,
      accessRole: 'student',
      positions: [],
      branchIds: [],
      authzVersion,
      status: 'active',
      crmProfileId: item.student.id,
    }
    const desiredProfile = {
      uid: item.uid,
      displayName: typeof item.student.name === 'string' ? item.student.name.trim() : '',
      name: typeof item.student.name === 'string' ? item.student.name.trim() : '',
      email: typeof item.student.email === 'string' ? item.student.email.trim().toLowerCase() : '',
      phoneNumber: typeof item.student.phone === 'string' ? item.student.phone.trim() : '',
      crmProfileId: item.student.id,
      role: 'student',
      accessRole: 'student',
      authzVersion,
    }
    const firestoreWriteRequired = !exactObjectSubset(assignment, desiredAssignment)
      || !exactObjectSubset(profile, desiredProfile)
    const claimsWriteRequired = stableJson(authUser.customClaims || {}) !== stableJson(nextClaims)
    const authFingerprint = claimsFingerprint(authUser)
    const databaseFingerprint = firestoreFingerprint(item.student, assignment, profile)

    candidates.push({
      uid: item.uid,
      crmProfileId: item.student.id,
      strategy: item.strategy,
      authzVersion,
      nextClaims,
      desiredAssignment,
      desiredProfile,
      firestoreWriteRequired,
      claimsWriteRequired,
      authFingerprint,
      databaseFingerprint,
      combinedStateDigest: stateDigest({ authFingerprint, databaseFingerprint }),
    })
  }

  const publicCandidates = candidates.map(publicCandidate).sort((left, right) => left.uidHash.localeCompare(right.uidHash))
  const publicQuarantines = quarantined.map(publicQuarantine).sort((left, right) => left.crmProfileIdHash.localeCompare(right.crmProfileIdHash))
  const publicUnmatched = unmatched.map((item) => ({ crmProfileIdHash: sha256(item.crmProfileId) })).sort((left, right) => left.crmProfileIdHash.localeCompare(right.crmProfileIdHash))
  const planDigest = stateDigest({
    target: { projectId: TARGET_PROJECT, databaseId: TARGET_DATABASE },
    candidates: publicCandidates,
    quarantined: publicQuarantines,
    unmatched: publicUnmatched,
  })
  return { candidates, quarantined, unmatched, publicCandidates, publicQuarantines, publicUnmatched, planDigest }
}

function cliAuthModule() {
  const candidates = []
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
  try {
    candidates.push(require.resolve('firebase-tools/lib/auth.js'))
  } catch {
    // A global Firebase CLI installation is sufficient.
  }
  const modulePath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!modulePath) throw new PublicError('firebase_cli_missing', 'Firebase CLI is not installed or cannot be resolved.')
  return require(modulePath)
}

async function firebaseCliAccessToken() {
  const auth = cliAuthModule()
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new PublicError('firebase_cli_signed_out', 'Firebase CLI is not signed in.')
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new PublicError('oauth_token_unavailable', 'Unable to obtain a Firebase CLI OAuth token.')
  return result.access_token
}

function cliCredential(accessToken) {
  return {
    getAccessToken: async () => ({
      access_token: accessToken,
      expires_in: 3600,
    }),
  }
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
  if (!response.ok) {
    throw new PublicError(options.errorCode || 'target_request_failed', `Target Firebase request failed with HTTP ${response.status}.`)
  }
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    // Firestore streaming methods can return one JSON object per line.
    try {
      return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    } catch {
      throw new PublicError('target_response_invalid', 'Target Firebase returned an invalid response.')
    }
  }
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null
  if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return value.booleanValue === true
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue)
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue)
  if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return String(value.timestampValue)
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return String(value.stringValue)
  if (Object.prototype.hasOwnProperty.call(value, 'bytesValue')) return String(value.bytesValue)
  if (Object.prototype.hasOwnProperty.call(value, 'referenceValue')) return String(value.referenceValue)
  if (Object.prototype.hasOwnProperty.call(value, 'geoPointValue')) return {
    latitude: Number(value.geoPointValue?.latitude || 0),
    longitude: Number(value.geoPointValue?.longitude || 0),
  }
  if (Object.prototype.hasOwnProperty.call(value, 'arrayValue')) {
    return (value.arrayValue?.values || []).map(decodeFirestoreValue)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'mapValue')) {
    return decodeFirestoreFields(value.mapValue?.fields || {})
  }
  return null
}

function decodeFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]))
}

function encodeFirestoreValue(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new PublicError('invalid_write_value', 'A generated identity value is invalid.')
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } }
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFirestoreFields(value) } }
  throw new PublicError('invalid_write_value', 'A generated identity value is unsupported.')
}

function encodeFirestoreFields(value) {
  return Object.fromEntries(Object.entries(value || {})
    .filter(([, item]) => typeof item !== 'undefined')
    .map(([key, item]) => [key, encodeFirestoreValue(item)]))
}

function documentIdFromName(name) {
  return typeof name === 'string' ? decodeURIComponent(name.slice(name.lastIndexOf('/') + 1)) : ''
}

function documentResource(collectionName, documentId) {
  if (!/^[A-Za-z0-9_-]{1,1500}$/.test(documentId)) {
    throw new PublicError('unsafe_document_id', 'A target document ID is invalid.')
  }
  return `${TARGET_RESOURCE}/documents/${collectionName}/${documentId}`
}

function documentUrl(collectionName, documentId) {
  return `${databaseBase()}/documents/${collectionName}/${encodeURIComponent(documentId)}`
}

async function readCollection(accessToken, collectionName) {
  const documents = []
  let pageToken = ''
  do {
    const query = new URLSearchParams({ pageSize: '1000', showMissing: 'false' })
    if (pageToken) query.set('pageToken', pageToken)
    const body = await requestJson(accessToken, `${databaseBase()}/documents/${collectionName}?${query}`, {
      errorCode: 'target_collection_read_failed',
    })
    for (const document of body?.documents || []) {
      const id = documentIdFromName(document.name)
      if (!id) throw new PublicError('target_document_invalid', 'A target document has no valid ID.')
      documents.push({ id, data: decodeFirestoreFields(document.fields || {}) })
    }
    pageToken = body?.nextPageToken || ''
  } while (pageToken)
  return documents
}

async function readDocument(accessToken, collectionName, documentId) {
  const response = await fetch(documentUrl(collectionName, documentId), {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  })
  const raw = await response.text()
  if (response.status === 404) return null
  if (!response.ok) throw new PublicError('target_document_read_failed', `Target Firebase request failed with HTTP ${response.status}.`)
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    throw new PublicError('target_response_invalid', 'Target Firebase returned an invalid response.')
  }
  return { id: documentId, data: decodeFirestoreFields(body.fields || {}) }
}

async function loadTargetState() {
  const accessToken = await firebaseCliAccessToken()
  const appName = `student-identity-link-${crypto.randomUUID()}`
  const app = initializeApp({ projectId: TARGET_PROJECT, credential: cliCredential(accessToken) }, appName)
  const auth = getAuth(app)
  try {
    // Keep production reads sequential and bounded by the target collections;
    // this also makes it obvious that dry-run never calls a write API.
    const authUsers = await listAuthUsers(auth)
    const students = await readCollection(accessToken, 'students')
    const users = await readCollection(accessToken, 'users')
    const roleAssignments = await readCollection(accessToken, 'roleAssignments')
    const staff = await readCollection(accessToken, 'staff')
    const trainers = await readCollection(accessToken, 'trainers')
    return { app, auth, accessToken, authUsers, students, users, roleAssignments, staff, trainers }
  } catch (error) {
    await deleteApp(app)
    throw error
  }
}

async function closeTargetState(state) {
  if (state?.app) await deleteApp(state.app)
}

function countsFor(state, plan) {
  const strategies = { directUid: 0, email: 0, phone: 0, emailPhone: 0 }
  for (const item of plan.candidates) {
    if (item.strategy === 'direct_uid') strategies.directUid += 1
    if (item.strategy === 'email') strategies.email += 1
    if (item.strategy === 'phone') strategies.phone += 1
    if (item.strategy === 'email_phone') strategies.emailPhone += 1
  }
  return {
    authUsers: state.authUsers.length,
    crmStudentProfiles: state.students.length,
    userProfiles: state.users.length,
    roleAssignments: state.roleAssignments.length,
    staffRecords: state.staff.length,
    trainerRecords: state.trainers.length,
    deterministicMatches: plan.candidates.length,
    readyToApply: plan.candidates.filter((item) => item.firestoreWriteRequired || item.claimsWriteRequired).length,
    alreadyCanonical: plan.candidates.filter((item) => !item.firestoreWriteRequired && !item.claimsWriteRequired).length,
    quarantined: plan.quarantined.length,
    unmatched: plan.unmatched.length,
    matchStrategies: strategies,
  }
}

function dryRunReport(state, plan) {
  return {
    schemaVersion: 1,
    mode: 'dry-run',
    generatedAt: new Date().toISOString(),
    target: { projectId: TARGET_PROJECT, databaseId: TARGET_DATABASE },
    planDigest: plan.planDigest,
    counts: countsFor(state, plan),
    candidates: plan.publicCandidates,
    quarantined: plan.publicQuarantines,
    unmatched: plan.publicUnmatched,
    writesPerformed: false,
    piiPolicy: 'UIDs and CRM IDs are SHA-256 hashed; email, phone, name, and address are omitted.',
  }
}

async function dryRun(flags) {
  const state = await loadTargetState()
  try {
    const plan = buildPlan(state)
    const report = dryRunReport(state, plan)
    const reportPath = writeReport(flags.report || DEFAULT_REPORTS['dry-run'], report)
    const dryRunDigest = sha256(fs.readFileSync(reportPath))
    console.log(JSON.stringify({
      mode: 'dry-run',
      targetProject: TARGET_PROJECT,
      targetDatabase: TARGET_DATABASE,
      ...report.counts,
      planDigest: report.planDigest,
      dryRunDigest,
      reportPath,
      writesPerformed: false,
    }, null, 2))
  } finally {
    await closeTargetState(state)
  }
}

function assertApprovedDryRun(flags, plan) {
  const confirmation = requiredFlag(flags, 'confirm')
  if (confirmation !== APPLY_CONFIRMATION) {
    throw new PublicError('production_confirmation_failed', `--confirm must equal ${APPLY_CONFIRMATION}.`)
  }
  const suppliedDigest = requiredFlag(flags, 'dry-run-digest').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(suppliedDigest)) throw new PublicError('dry_run_digest_invalid', 'The dry-run digest must be SHA-256.')
  const dryRun = readReport(requiredFlag(flags, 'dry-run-report'), 'dry-run')
  const actualDigest = sha256(Buffer.from(dryRun.raw, 'utf8'))
  if (suppliedDigest !== actualDigest) throw new PublicError('dry_run_digest_mismatch', 'The dry-run report digest does not match the approved digest.')
  if (dryRun.report.planDigest !== plan.planDigest) {
    throw new PublicError('stale_dry_run', 'Target identity data changed after dry-run; apply is blocked.')
  }
  const expected = plan.publicCandidates
  if (stableJson(dryRun.report.candidates) !== stableJson(expected)) {
    throw new PublicError('dry_run_plan_mismatch', 'The deterministic match set changed after dry-run; apply is blocked.')
  }
  return dryRun
}

function batchGetEntry(entries, resourceName) {
  const rows = Array.isArray(entries) ? entries.flat() : [entries]
  const row = rows.find((item) => item?.found?.name === resourceName || item?.missing === resourceName)
  if (!row) throw new PublicError('transaction_read_incomplete', 'A target transaction returned incomplete identity data.')
  if (row.missing) return null
  return {
    id: documentIdFromName(row.found.name),
    data: decodeFirestoreFields(row.found.fields || {}),
  }
}

function updateWrite(collectionName, documentId, fields, transformFields = []) {
  const fieldPaths = Object.keys(fields)
  return {
    update: {
      name: documentResource(collectionName, documentId),
      fields: encodeFirestoreFields(fields),
    },
    updateMask: { fieldPaths },
    ...(transformFields.length ? {
      updateTransforms: transformFields.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
    } : {}),
  }
}

async function rollbackTransaction(accessToken, transaction) {
  try {
    await requestJson(accessToken, `${databaseBase()}/documents:rollback`, {
      method: 'POST',
      body: JSON.stringify({ transaction }),
      errorCode: 'transaction_rollback_failed',
    })
  } catch {
    // Best effort only; an uncommitted Firestore transaction expires safely.
  }
}

async function writeIdentityDocuments(state, candidate, planDigest) {
  const begin = await requestJson(state.accessToken, `${databaseBase()}/documents:beginTransaction`, {
    method: 'POST',
    body: JSON.stringify({ options: { readWrite: {} } }),
    errorCode: 'transaction_begin_failed',
  })
  const transaction = begin?.transaction
  if (!transaction) throw new PublicError('transaction_begin_invalid', 'Unable to begin a target transaction.')

  const studentName = documentResource('students', candidate.crmProfileId)
  const assignmentName = documentResource('roleAssignments', candidate.uid)
  const profileName = documentResource('users', candidate.uid)
  try {
    const rows = await requestJson(state.accessToken, `${databaseBase()}/documents:batchGet`, {
      method: 'POST',
      body: JSON.stringify({ documents: [studentName, assignmentName, profileName], transaction }),
      errorCode: 'transaction_read_failed',
    })
    const liveStudent = batchGetEntry(rows, studentName)
    const liveAssignment = batchGetEntry(rows, assignmentName)
    const liveProfile = batchGetEntry(rows, profileName)
    if (!liveStudent) throw new PublicError('student_precondition_changed', 'A CRM student record changed during apply.')
    if (firestoreFingerprint(liveStudent, liveAssignment?.data || null, liveProfile?.data || null) !== candidate.databaseFingerprint) {
      throw new PublicError('firestore_precondition_changed', 'A target identity record changed during apply.')
    }

    const assignmentFields = {
      ...candidate.desiredAssignment,
      identityLinkVersion: 1,
      identityLinkPlanDigest: planDigest,
      updatedBy: 'migration:student-identity-link',
    }
    const profileFields = {
      ...candidate.desiredProfile,
      identityLinkVersion: 1,
    }
    const auditId = `student_identity_link_${sha256(`${candidate.uid}:${candidate.crmProfileId}`).slice(0, 40)}`
    const auditFields = {
      schemaVersion: 1,
      action: 'student_identity.linked',
      actorType: 'migration',
      targetUidHash: sha256(candidate.uid),
      crmProfileIdHash: sha256(candidate.crmProfileId),
      authzVersion: candidate.authzVersion,
      planDigest,
    }
    const writes = [
      updateWrite('roleAssignments', candidate.uid, assignmentFields, [
        'updatedAt',
        ...(!liveAssignment ? ['createdAt'] : []),
      ]),
      updateWrite('users', candidate.uid, profileFields, ['updatedAt']),
      updateWrite('identityAuditLogs', auditId, auditFields, ['createdAt']),
    ]
    await requestJson(state.accessToken, `${databaseBase()}/documents:commit`, {
      method: 'POST',
      body: JSON.stringify({ writes, transaction }),
      errorCode: 'transaction_commit_failed',
    })
  } catch (error) {
    await rollbackTransaction(state.accessToken, transaction)
    throw error
  }
}

async function applyCandidate(state, candidate, planDigest) {
  const currentAuth = await state.auth.getUser(candidate.uid)
  if (claimsFingerprint(currentAuth) !== candidate.authFingerprint) throw new PublicError('auth_precondition_changed', 'An Auth record changed during apply.')

  if (candidate.firestoreWriteRequired) {
    await writeIdentityDocuments(state, candidate, planDigest)
  }

  const beforeClaimsWrite = await state.auth.getUser(candidate.uid)
  if (candidate.claimsWriteRequired && claimsFingerprint(beforeClaimsWrite) !== candidate.authFingerprint) {
    throw new PublicError('auth_precondition_changed', 'An Auth record changed before the claims update.')
  }
  if (candidate.claimsWriteRequired) await state.auth.setCustomUserClaims(candidate.uid, candidate.nextClaims)

  const verifiedAuth = await state.auth.getUser(candidate.uid)
  const [verifiedAssignment, verifiedProfile] = await Promise.all([
    readDocument(state.accessToken, 'roleAssignments', candidate.uid),
    readDocument(state.accessToken, 'users', candidate.uid),
  ])
  const verified = stableJson(verifiedAuth.customClaims || {}) === stableJson(candidate.nextClaims)
    && Boolean(verifiedAssignment)
    && exactObjectSubset(verifiedAssignment?.data, candidate.desiredAssignment)
    && Boolean(verifiedProfile)
    && exactObjectSubset(verifiedProfile?.data, candidate.desiredProfile)
  if (!verified) throw new PublicError('post_write_verification_failed', 'A linked identity did not pass post-write verification.')
  return {
    uidHash: sha256(candidate.uid),
    crmProfileIdHash: sha256(candidate.crmProfileId),
    changed: candidate.firestoreWriteRequired || candidate.claimsWriteRequired,
    verified: true,
  }
}

async function apply(flags) {
  const state = await loadTargetState()
  try {
    const plan = buildPlan(state)
    const dryRun = assertApprovedDryRun(flags, plan)
    const results = []
    const errors = []
    for (const candidate of plan.candidates) {
      try {
        results.push(await applyCandidate(state, candidate, plan.planDigest))
      } catch (error) {
        errors.push({
          uidHash: sha256(candidate.uid),
          crmProfileIdHash: sha256(candidate.crmProfileId),
          code: error instanceof PublicError ? error.code : 'candidate_apply_failed',
          errorDigest: sha256(String(error?.message || error?.code || 'candidate_apply_failed')),
        })
      }
    }

    const report = {
      schemaVersion: 1,
      mode: 'apply',
      generatedAt: new Date().toISOString(),
      target: { projectId: TARGET_PROJECT, databaseId: TARGET_DATABASE },
      approvedDryRunDigest: sha256(Buffer.from(dryRun.raw, 'utf8')),
      planDigest: plan.planDigest,
      counts: {
        deterministicMatches: plan.candidates.length,
        attempted: plan.candidates.length,
        changed: results.filter((item) => item.changed).length,
        alreadyCanonical: results.filter((item) => !item.changed).length,
        verified: results.filter((item) => item.verified).length,
        failed: errors.length,
        quarantined: plan.quarantined.length,
        unmatched: plan.unmatched.length,
      },
      successfulLinks: results,
      errors,
      piiPolicy: 'UIDs and CRM IDs are SHA-256 hashed; email, phone, name, and address are omitted.',
    }
    const reportPath = writeReport(flags.report || DEFAULT_REPORTS.apply, report)
    console.log(JSON.stringify({ mode: 'apply', ...report.counts, planDigest: report.planDigest, reportPath }, null, 2))
    if (errors.length > 0) throw new PublicError('partial_apply', 'Identity linking completed with failures; rerun dry-run before any retry.')
  } finally {
    await closeTargetState(state)
  }
}

async function verify(flags) {
  const applyReport = readReport(requiredFlag(flags, 'apply-report'), 'apply').report
  const state = await loadTargetState()
  try {
    const plan = buildPlan(state)
    const liveByPair = new Map(plan.publicCandidates.map((item) => [`${item.uidHash}:${item.crmProfileIdHash}`, item]))
    const expectedLinks = Array.isArray(applyReport.successfulLinks) ? applyReport.successfulLinks : []
    const missing = []
    const nonCanonical = []
    for (const item of expectedLinks) {
      const key = `${item.uidHash}:${item.crmProfileIdHash}`
      const live = liveByPair.get(key)
      if (!live) missing.push({ uidHash: item.uidHash, crmProfileIdHash: item.crmProfileIdHash })
      else if (!live.canonical) nonCanonical.push({ uidHash: item.uidHash, crmProfileIdHash: item.crmProfileIdHash })
    }
    const report = {
      schemaVersion: 1,
      mode: 'verify',
      generatedAt: new Date().toISOString(),
      target: { projectId: TARGET_PROJECT, databaseId: TARGET_DATABASE },
      sourceApplyPlanDigest: applyReport.planDigest || null,
      counts: {
        expectedLinks: expectedLinks.length,
        verifiedCanonical: expectedLinks.length - missing.length - nonCanonical.length,
        missing: missing.length,
        nonCanonical: nonCanonical.length,
        currentlyQuarantined: plan.quarantined.length,
      },
      missing,
      nonCanonical,
      verified: missing.length === 0 && nonCanonical.length === 0,
      writesPerformed: false,
      piiPolicy: 'UIDs and CRM IDs are SHA-256 hashed; email, phone, name, and address are omitted.',
    }
    const reportPath = writeReport(flags.report || DEFAULT_REPORTS.verify, report)
    console.log(JSON.stringify({ mode: 'verify', ...report.counts, verified: report.verified, reportPath, writesPerformed: false }, null, 2))
    if (!report.verified) throw new PublicError('verification_failed', 'One or more identity links are missing or non-canonical.')
  } finally {
    await closeTargetState(state)
  }
}

async function main() {
  const { command, flags } = parseArguments(process.argv.slice(2))
  if (command === 'dry-run') return dryRun(flags)
  if (command === 'apply') return apply(flags)
  if (command === 'verify') return verify(flags)
  throw new PublicError('unknown_command', USAGE)
}

main().catch((error) => {
  if (error instanceof PublicError) {
    console.error(JSON.stringify({ error: error.code, message: error.publicMessage }, null, 2))
  } else {
    const safeCode = typeof error?.code === 'string' && /^[A-Za-z0-9_./-]{1,120}$/.test(error.code)
      ? error.code
      : 'unexpected_failure'
    console.error(JSON.stringify({
      error: safeCode,
      errorDigest: sha256(String(error?.message || error?.code || 'unexpected_failure')),
    }, null, 2))
  }
  process.exitCode = 1
})
