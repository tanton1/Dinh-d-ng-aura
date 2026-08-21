/*
 * Target-only contact reconciliation for legacy Aura learners.
 *
 * This tool never overwrites a non-empty contact value. It only fills a
 * missing name/email/phone when every available source agrees. Reports never
 * contain names, emails, phone numbers, raw UIDs, or CRM IDs.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

const PROJECT = 'gen-lang-client-0815966909'
const DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const RESOURCE = `projects/${PROJECT}/databases/${DATABASE}`
const CONFIRM = `${RESOURCE}:reconcile-student-contacts`
const PRIVATE = path.resolve('.migration-private')

function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex') }
function stable(value) { return JSON.stringify(value, Object.keys(value).sort()) }
function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return ''
  return /^\d+@aurafitness\.com$/.test(email) ? '' : email
}
function normalizePhone(value) {
  const input = typeof value === 'string' ? value.trim().replace(/[\s().-]/g, '') : ''
  const digits = input.replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 12) return ''
  if (input.startsWith('+')) return `+${digits}`
  if (digits.startsWith('84')) return `+${digits}`
  return digits.startsWith('0') ? `+84${digits.slice(1)}` : `+84${digits}`
}
function displayPhone(value) {
  const phone = normalizePhone(value)
  return phone.startsWith('+84') ? `0${phone.slice(3)}` : phone
}
function nameValue(value) { return typeof value === 'string' && value.trim().length >= 2 ? value.trim().slice(0, 160) : '' }
function pickName(...values) { return values.map(nameValue).find(Boolean) || '' }
function pickCanonical(values, normalizer) {
  const normalized = values.map(normalizer).filter(Boolean)
  return [...new Set(normalized)]
}
function isStaff(value = {}) {
  const role = String(value.accessRole || value.role || '')
  return ['staff', 'admin', 'super_admin'].includes(role)
}
function cliAuth() {
  const candidates = []
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
  try { candidates.push(require.resolve('firebase-tools/lib/auth.js')) } catch { /* Firebase CLI may be global. */ }
  const modulePath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!modulePath) throw new Error('Firebase CLI không khả dụng để xác thực migration.')
  return require(modulePath)
}
async function token() {
  const auth = cliAuth()
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI chưa đăng nhập.')
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Không lấy được Firebase OAuth token.')
  return result.access_token
}
function credential(accessToken) { return { getAccessToken: async () => ({ access_token: accessToken, expires_in: 3600 }) } }
function baseUrl() { return `https://firestore.googleapis.com/v1/${RESOURCE}` }
function documentName(collection, id) { return `${RESOURCE}/documents/${collection}/${encodeURIComponent(id)}` }
async function request(accessToken, url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Firebase request failed (${response.status}).`)
  return raw ? JSON.parse(raw) : null
}
function decodeValue(value) {
  if (!value || typeof value !== 'object') return null
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return value.booleanValue === true
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return String(value.timestampValue)
  if ('stringValue' in value) return String(value.stringValue)
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
  return null
}
function decodeFields(fields) { return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decodeValue(value)])) }
function encodeValue(value) {
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'number') return { integerValue: String(value) }
  if (typeof value === 'boolean') return { booleanValue: value }
  throw new Error('Invalid generated reconciliation value.')
}
function encodeFields(value) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)])) }
async function listCollection(accessToken, collection) {
  const result = []
  let pageToken = ''
  do {
    const query = new URLSearchParams({ pageSize: '1000', showMissing: 'false' })
    if (pageToken) query.set('pageToken', pageToken)
    const body = await request(accessToken, `${baseUrl()}/documents/${collection}?${query}`)
    for (const document of body.documents || []) {
      result.push({ id: decodeURIComponent(document.name.slice(document.name.lastIndexOf('/') + 1)), data: decodeFields(document.fields), updateTime: document.updateTime || '' })
    }
    pageToken = body.nextPageToken || ''
  } while (pageToken)
  return result
}
async function listAuth(auth) {
  const result = []
  let pageToken
  do {
    const page = await auth.listUsers(1000, pageToken)
    result.push(...page.users)
    pageToken = page.pageToken
  } while (pageToken)
  return result
}
function multiIndex(rows, key) {
  const index = new Map()
  for (const row of rows) {
    const value = key(row)
    if (!value) continue
    index.set(value, [...(index.get(value) || []), row])
  }
  return index
}
function unique(index, value) { const rows = index.get(value) || []; return rows.length === 1 ? rows[0] : null }
function contactValues(authUser, profile, student) {
  const name = pickName(authUser?.displayName, profile?.displayName, profile?.name, student?.name, student?.displayName)
  const emailValues = pickCanonical([authUser?.email, profile?.email, student?.email, student?.emailAddress], normalizeEmail)
  const phoneValues = pickCanonical([authUser?.phoneNumber, profile?.phoneNumber, profile?.phone, student?.phoneNumber, student?.phone], normalizePhone)
  return { name, email: emailValues[0] || '', phone: phoneValues[0] || '', conflict: emailValues.length > 1 || phoneValues.length > 1 }
}
function emptyText(value) { return !nameValue(value) }
function contactPatch(data, contact, kind) {
  const patch = {}
  if (kind === 'user') {
    if (emptyText(data.displayName) && contact.name) { patch.displayName = contact.name; patch.name = contact.name }
    else if (emptyText(data.name) && contact.name) patch.name = contact.name
    if (!normalizeEmail(data.email) && contact.email) patch.email = contact.email
    if (!normalizePhone(data.phoneNumber || data.phone) && contact.phone) { patch.phoneNumber = contact.phone; patch.phone = displayPhone(contact.phone) }
  } else {
    if (emptyText(data.name) && contact.name) { patch.name = contact.name; patch.displayName = contact.name }
    if (!normalizeEmail(data.email || data.emailAddress) && contact.email) patch.email = contact.email
    if (!normalizePhone(data.phone || data.phoneNumber) && contact.phone) { patch.phone = displayPhone(contact.phone); patch.phoneNumber = contact.phone }
  }
  return patch
}
function buildPlan(state) {
  const authByUid = new Map(state.auth.map((item) => [item.uid, item]))
  const profiles = new Map(state.users.map((item) => [item.id, item]))
  const students = new Map(state.students.map((item) => [item.id, item]))
  const assignmentByUid = new Map(state.assignments.map((item) => [item.id, item]))
  const authByEmail = multiIndex(state.auth, (item) => normalizeEmail(item.email))
  const authByPhone = multiIndex(state.auth, (item) => normalizePhone(item.phoneNumber))
  const candidates = []
  const linkedStudentIds = new Set()
  const seenUids = new Set()
  const summary = { userProfiles: state.users.length, crmStudents: state.students.length, authUsers: state.auth.length, writableUsers: 0, writableStudents: 0, nameFilled: 0, emailFilled: 0, phoneFilled: 0, conflicts: 0, noTrustedSource: 0, skippedStaff: 0, unlinkedStudents: 0 }

  function add(uid, studentId, strategy) {
    if (!uid || seenUids.has(uid)) return
    const authUser = authByUid.get(uid)
    const profile = profiles.get(uid)
    const assignment = assignmentByUid.get(uid)
    const student = studentId ? students.get(studentId) : null
    if ((!profile && !student) || isStaff(assignment?.data) || isStaff(profile?.data) || isStaff(authUser?.customClaims || {})) { if (isStaff(assignment?.data) || isStaff(profile?.data) || isStaff(authUser?.customClaims || {})) summary.skippedStaff += 1; return }
    const contact = contactValues(authUser, profile?.data, student?.data)
    if (contact.conflict) { summary.conflicts += 1; return }
    if (!contact.name && !contact.email && !contact.phone) { summary.noTrustedSource += 1; return }
    const userPatch = profile ? contactPatch(profile.data, contact, 'user') : {}
    const studentPatch = student ? contactPatch(student.data, contact, 'student') : {}
    if (!Object.keys(userPatch).length && !Object.keys(studentPatch).length) { seenUids.add(uid); if (studentId) linkedStudentIds.add(studentId); return }
    for (const patch of [userPatch, studentPatch]) { if ('displayName' in patch || 'name' in patch) summary.nameFilled += 1; if ('email' in patch) summary.emailFilled += 1; if ('phone' in patch || 'phoneNumber' in patch) summary.phoneFilled += 1 }
    if (Object.keys(userPatch).length) summary.writableUsers += 1
    if (Object.keys(studentPatch).length) summary.writableStudents += 1
    candidates.push({ uid, studentId: studentId || '', strategy, user: profile ? { id: profile.id, updateTime: profile.updateTime, patch: userPatch } : null, student: student ? { id: student.id, updateTime: student.updateTime, patch: studentPatch } : null })
    seenUids.add(uid); if (studentId) linkedStudentIds.add(studentId)
  }

  for (const profile of state.users) {
    const assignment = assignmentByUid.get(profile.id)
    const linked = typeof assignment?.data.crmProfileId === 'string' ? assignment.data.crmProfileId : typeof profile.data.crmProfileId === 'string' ? profile.data.crmProfileId : students.has(profile.id) ? profile.id : ''
    add(profile.id, students.has(linked) ? linked : '', linked ? 'assignment_or_profile' : 'profile_only')
  }
  for (const student of state.students) {
    if (linkedStudentIds.has(student.id)) continue
    let authUser = authByUid.get(student.id) || null
    const emailMatch = unique(authByEmail, normalizeEmail(student.data.email || student.data.emailAddress))
    const phoneMatch = unique(authByPhone, normalizePhone(student.data.phone || student.data.phoneNumber))
    if (!authUser && emailMatch && phoneMatch && emailMatch.uid !== phoneMatch.uid) { summary.conflicts += 1; continue }
    authUser ||= emailMatch || phoneMatch
    if (authUser) add(authUser.uid, student.id, authUser.uid === student.id ? 'direct_uid' : 'unique_contact')
    else summary.unlinkedStudents += 1
  }
  const fingerprint = hash(stable(candidates.map((item) => ({ uid: hash(item.uid), student: item.studentId ? hash(item.studentId) : '', user: item.user ? hash(stable(item.user.patch)) : '', crm: item.student ? hash(stable(item.student.patch)) : '' }))))
  return { candidates, summary, fingerprint }
}
function reportPath(mode) { return path.join(PRIVATE, `student-contact-reconcile-${mode}.json`) }
function safeReport(mode, plan, writesPerformed = false) {
  return { schemaVersion: 1, mode, target: { projectId: PROJECT, databaseId: DATABASE }, generatedAt: new Date().toISOString(), planDigest: plan.fingerprint, summary: plan.summary, writableCandidates: plan.candidates.length, writesPerformed, candidates: plan.candidates.map((item) => ({ uidHash: hash(item.uid), crmProfileIdHash: item.studentId ? hash(item.studentId) : null, strategy: item.strategy, updatesUser: Boolean(item.user && Object.keys(item.user.patch).length), updatesCrmStudent: Boolean(item.student && Object.keys(item.student.patch).length) })), piiPolicy: 'Reports contain only hashes, counts and field-presence metadata.' }
}
function saveReport(mode, report) { fs.mkdirSync(PRIVATE, { recursive: true }); const file = reportPath(mode); fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); return file }
async function load() {
  const accessToken = await token(); const app = initializeApp({ projectId: PROJECT, credential: credential(accessToken) }, `student-contact-${crypto.randomUUID()}`); const auth = getAuth(app)
  try { const [authUsers, users, students, assignments] = await Promise.all([listAuth(auth), listCollection(accessToken, 'users'), listCollection(accessToken, 'students'), listCollection(accessToken, 'roleAssignments')]); return { app, accessToken, auth: authUsers, users, students, assignments } } catch (error) { await deleteApp(app); throw error }
}
async function commitCandidate(accessToken, candidate) {
  const writes = []
  for (const item of [candidate.user && Object.keys(candidate.user.patch).length ? { ...candidate.user, collection: 'users' } : null, candidate.student && Object.keys(candidate.student.patch).length ? { ...candidate.student, collection: 'students' } : null].filter(Boolean)) {
    const fields = { ...item.patch, contactSyncVersion: 1 }
    writes.push({ update: { name: documentName(item.collection, item.id), fields: encodeFields(fields) }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { updateTime: item.updateTime }, updateTransforms: [{ fieldPath: 'contactSyncedAt', setToServerValue: 'REQUEST_TIME' }] })
  }
  if (!writes.length) return
  await request(accessToken, `${baseUrl()}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) })
}
async function main() {
  const [mode, ...flags] = process.argv.slice(2); const values = Object.fromEntries(flags.filter((item) => item.startsWith('--') && item.includes('=')).map((item) => { const at = item.indexOf('='); return [item.slice(2, at), item.slice(at + 1)] }))
  if (!['dry-run', 'apply', 'verify'].includes(mode)) throw new Error(`Usage: node scripts/firebase-student-contact-reconcile.cjs dry-run | apply --dry-run-digest=<sha256> --confirm=${CONFIRM} | verify`)
  const state = await load()
  try {
    const plan = buildPlan(state)
    if (mode === 'apply') {
      const prior = JSON.parse(fs.readFileSync(reportPath('dry-run'), 'utf8'))
      if (values.confirm !== CONFIRM || values['dry-run-digest'] !== prior.planDigest || prior.planDigest !== plan.fingerprint) throw new Error('Dry-run digest hoặc xác nhận production không khớp.')
      for (const candidate of plan.candidates) await commitCandidate(state.accessToken, candidate)
    }
    const report = safeReport(mode, plan, mode === 'apply')
    const file = saveReport(mode, report)
    console.log(JSON.stringify({ mode, ...report.summary, writableCandidates: report.writableCandidates, planDigest: report.planDigest, writesPerformed: report.writesPerformed, reportPath: file }))
    if (mode === 'verify' && plan.candidates.length) process.exitCode = 2
  } finally { await deleteApp(state.app) }
}
main().catch((error) => { console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'unknown' })); process.exitCode = 1 })
