const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const server = readFileSync(join(root, 'server.ts'), 'utf8')
const functionsIndex = readFileSync(join(__dirname, 'index.js'), 'utf8')
const identity = readFileSync(join(__dirname, 'identity-access.js'), 'utf8')
const pt = readFileSync(join(__dirname, 'pt-operations-v2.js'), 'utf8')
const finance = readFileSync(join(__dirname, 'finance-ledger.js'), 'utf8')
const sessions = readFileSync(join(__dirname, 'session-operations.js'), 'utf8')
const payroll = readFileSync(join(__dirname, 'payroll.js'), 'utf8')
const nutritionPage = readFileSync(join(root, 'src', 'pages', 'student', 'NutritionPage.tsx'), 'utf8')
const nutritionCatalogService = readFileSync(join(root, 'src', 'features', 'nutrition', 'catalog.ts'), 'utf8')
const sharedIdentityContract = JSON.parse(readFileSync(join(root, 'shared', 'identity', 'identity-contract.json'), 'utf8'))
const functionsIdentityContract = JSON.parse(readFileSync(join(__dirname, 'identity-contract.json'), 'utf8'))
const { normalizedTrainerSchedulingPolicy } = require('./identity-access')

test('trainer scheduling policy defaults and validates the daily workload ceiling', () => {
  assert.deepEqual(normalizedTrainerSchedulingPolicy(), {
    schedulingPriority: 100,
    dailySessionTarget: 8,
    dailySessionLimit: 10,
  })
  assert.deepEqual(normalizedTrainerSchedulingPolicy({}, { priority: 7, dailySessionTarget: 6, dailySessionLimit: 9 }), {
    schedulingPriority: 7,
    dailySessionTarget: 6,
    dailySessionLimit: 9,
  })
  assert.throws(
    () => normalizedTrainerSchedulingPolicy({ schedulingPriority: 1, dailySessionTarget: 10, dailySessionLimit: 8 }),
    /không được thấp hơn mục tiêu/,
  )
  assert.match(functionsIndex, /exports\.applyDefaultTrainerSchedulingPolicy = identityAccessFunctions\.applyDefaultTrainerSchedulingPolicy/)
  assert.match(identity, /trainer_scheduling_policy\.bulk_default_applied/)
  assert.match(identity, /batch\.set\(db\.doc\(`staff\/\$\{snapshot\.id\}`\)/)
})

test('Functions package includes the same deployable identity contract as the web app', () => {
  assert.deepEqual(functionsIdentityContract, sharedIdentityContract)
  assert.match(identity, /require\('\.\/identity-contract\.json'\)/)
})

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
  assert.match(functionsIndex, /firebaseOnCall\(\{ enforceAppCheck, invoker: 'public' \}, optionsOrHandler\)/)
  assert.match(identity, /const listInternalNutritionCatalog[\s\S]*?trustedAccessContext\(request, db\)/)
  assert.match(identity, /const getInternalNutritionCatalogItem[\s\S]*?trustedAccessContext\(request, db\)/)
  assert.doesNotMatch(identity, /listInternalNutritionCatalog[\s\S]*?requireCapability\(actor, 'nutrition\.catalog\.internal\.view'\)/)
  assert.match(identity, /collection\('nutritionCatalog'\)/)
  assert.match(identity, /nutritionCatalogTotal\(db\)/)
  assert.match(identity, /nextCursor/)
  assert.match(identity, /Math\.min\(60, Math\.max\(12, requestedLimit\)\)/)
  assert.match(identity, /filterNutritionCatalogEntries\(catalogIndex\.entries/)
  assert.match(identity, /filteredEntries\.slice\(startIndex, startIndex \+ limit\)/)
  assert.match(identity, /catalogTotal: totalCount/)
  assert.match(identity, /filteredCount: filteredEntries\.length/)
  assert.match(identity, /catalogVersion: catalogIndex\.catalogVersion/)
  assert.match(nutritionPage, /new IntersectionObserver/)
  assert.match(nutritionPage, /limit: 36/)
  assert.match(nutritionPage, /catalogRequestGenerationRef/)
  assert.doesNotMatch(nutritionPage, /limit: 60/)
  assert.doesNotMatch(nutritionPage, /limit: 180/)
  assert.match(nutritionCatalogService, /category: input\.category/)
  assert.match(nutritionCatalogService, /catalogVersion: input\.catalogVersion/)
})

test('legacy learner user and student labels normalize without opening staff privileges', () => {
  assert.match(identity, /function comparableLegacyRole\(role\)/)
  assert.match(identity, /role === 'user' \? 'student' : role/)
  assert.match(identity, /comparableLegacyRole\(profileLegacyRole\) !== comparableLegacyRole\(tokenLegacyRole\)/)
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
  // Locking is intentionally a dedicated transaction: it creates the
  // immutable payroll expense ledger entry before the run becomes locked.
  assert.match(payroll, /const lockPayrollRun = payrollCall/)
  assert.match(payroll, /status !== 'reviewed'/)
  assert.match(payroll, /status: 'locked'/)
  assert.match(payroll, /ledgerEntries\/payroll_\$\{runId\}/)
  assert.match(payroll, /const markPayrollRunPaid = payrollCall/)
  assert.match(payroll, /status !== 'locked'/)
  assert.match(payroll, /ledgerEntries\/payroll_payment_\$\{runId\}/)
  assert.match(payroll, /cashTransactions\/payroll_\$\{runId\}/)
})
