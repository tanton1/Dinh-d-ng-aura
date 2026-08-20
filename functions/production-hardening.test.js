const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const server = readFileSync(join(root, 'server.ts'), 'utf8')
const identity = readFileSync(join(__dirname, 'identity-access.js'), 'utf8')
const pt = readFileSync(join(__dirname, 'pt-operations-v2.js'), 'utf8')
const finance = readFileSync(join(__dirname, 'finance-ledger.js'), 'utf8')
const sessions = readFileSync(join(__dirname, 'session-operations.js'), 'utf8')
const payroll = readFileSync(join(__dirname, 'payroll.js'), 'utf8')

test('Express rejects unverifiable Firebase tokens without unsigned decode fallback', () => {
  assert.match(server, /verifyIdToken\(token, true\)/)
  assert.doesNotMatch(server, /payload\.(uid|user_id|sub)/)
})

test('invitation acceptance requires a verified contact match and rolls claims back', () => {
  assert.match(identity, /if \(!phoneMatches && !emailMatches\)/)
  assert.match(identity, /setCustomUserClaims\(uid, authUser\.customClaims \|\| \{\}\)/)
  assert.match(identity, /identityAuditLogs/)
})

test('nutrition catalog is served only after authenticated account verification', () => {
  assert.match(identity, /const listInternalNutritionCatalog[\s\S]*?trustedAccessContext\(request, db\)/)
  assert.match(identity, /const getInternalNutritionCatalogItem[\s\S]*?trustedAccessContext\(request, db\)/)
  assert.doesNotMatch(identity, /listInternalNutritionCatalog[\s\S]*?requireCapability\(actor, 'nutrition\.catalog\.internal\.view'\)/)
  assert.match(identity, /collection\('nutritionCatalog'\)/)
})

test('trainer and sales APIs derive actor scope on the server', () => {
  assert.match(pt, /trustedAccessContext\(request, db\)/)
  assert.doesNotMatch(pt, /request\.data\?\.trainerId/)
  assert.match(pt, /actor\.branchIds\.includes\(branchId\)/)
  assert.match(pt, /system\/feature_flags/)
})

test('finance uses immutable ledger and session lifecycle uses transactions', () => {
  assert.match(finance, /collection\('ledgerEntries'\)/)
  assert.match(finance, /type: 'reversal'/)
  assert.match(finance, /runTransaction/)
  assert.match(sessions, /confirmSessionAttendance/)
  assert.match(sessions, /rescheduleSession/)
  assert.match(sessions, /swapSessions/)
  assert.doesNotMatch(sessions, /\.delete\(/)
})

test('payroll lifecycle is draft, reviewed, locked, paid', () => {
  assert.match(payroll, /status: 'draft'/)
  assert.match(payroll, /transition\(request, 'draft', 'reviewed'\)/)
  assert.match(payroll, /transition\(request, 'reviewed', 'locked'\)/)
  assert.match(payroll, /transition\(request, 'locked', 'paid'/)
})
