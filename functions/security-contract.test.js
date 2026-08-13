const assert = require('node:assert/strict')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')

const repositoryRoot = join(__dirname, '..')
const rules = readFileSync(join(repositoryRoot, 'firestore.rules'), 'utf8')
const functionsSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
const authSource = readFileSync(join(repositoryRoot, 'src', 'contexts', 'AuthContext.tsx'), 'utf8')

test('profile rules prevent client role and membership changes', () => {
  assert.match(rules, /function hasOnlySafeUserChanges\(\)/)
  assert.match(rules, /allow update: if isOwner\(userId\)\s+&& hasOnlySafeUserChanges\(\)/)
  assert.doesNotMatch(rules, /allow update:\s*if isOwner\(userId\);/)
  assert.match(rules, /data\.role == 'student'/)
  assert.match(rules, /data\.membership == 'free'/)
})

test('privileged rules require matching token and stored roles', () => {
  assert.match(rules, /currentUser\(\)\.get\('role', 'student'\) == authRole\(\)/)
  assert.match(rules, /match \/system\/\{document=\*\*\}[\s\S]*?allow read, write: if isAdmin\(\)/)
  assert.doesNotMatch(rules, /match \/system\/\{document=\*\*\}[\s\S]*?allow read, write: if true/)
  assert.match(functionsSource, /function hasTrustedRole\(request, profile, allowedRoles\)/)
  assert.match(functionsSource, /profile\?\.role === tokenRole/)
})

test('meal reviews and notifications are owner scoped', () => {
  assert.match(rules, /match \/mealReviews\/\{reviewId\}[\s\S]*?resource\.data\.userId == request\.auth\.uid/)
  assert.match(rules, /request\.resource\.data\.userId == resource\.data\.userId/)
  assert.match(rules, /match \/notifications\/\{notificationId\}[\s\S]*?allow read: if isOwner\(userId\)/)
})

test('production auth has no email role bootstrap or unconditional demo OTP', () => {
  assert.doesNotMatch(authSource, /nhattank16/i)
  assert.match(authSource, /import\.meta\.env\.DEV && import\.meta\.env\.VITE_ENABLE_DEMO_OTP === 'true'/)
  assert.doesNotMatch(authSource, /cleanCode === '000000'/)
  assert.match(authSource, /import\.meta\.env\.MODE === 'e2e' && import\.meta\.env\.VITE_ENABLE_DEMO_OTP === 'true'/)
  assert.equal(existsSync(join(repositoryRoot, 'deleteRecreate.mjs')), false)
  assert.equal(existsSync(join(repositoryRoot, 'import-client.mjs')), false)
})

test('phone OTP success is not blocked by Firestore profile synchronization', () => {
  const phoneVerificationSource = authSource.match(/verifyPhoneOtpAndSignIn: async[\s\S]*?resetPassword:/)?.[0] ?? ''
  assert.match(phoneVerificationSource, /await window\.confirmationResult\.confirm\(cleanCode\)/)
  assert.match(phoneVerificationSource, /setUser\(\{ \.\.\.toAppUser\(credential\.user\)/)
  assert.match(phoneVerificationSource, /void createOrUpdateUserProfile\(nextProfile\)/)
  assert.doesNotMatch(phoneVerificationSource, /await createOrUpdateUserProfile\(nextProfile\)/)
  assert.ok(
    phoneVerificationSource.indexOf('setUser(') < phoneVerificationSource.indexOf('void createOrUpdateUserProfile'),
    'The signed-in UI must update before Firestore profile synchronization starts',
  )
})

test('client incident reporting is bounded, validated and rate limited', () => {
  const incidentSource = functionsSource.match(/exports\.reportClientIssue = onCall[\s\S]*?return \{ accepted: true \}\s*\}\)/)?.[0] ?? ''
  assert.match(incidentSource, /exports\.reportClientIssue = onCall/)
  assert.match(incidentSource, /allowClientIncident\(request\)/)
  assert.match(incidentSource, /clientIssueAreas\.has\(area\)/)
  assert.match(incidentSource, /boundedIncidentValue\(request\.data\?\.code, 80\)/)
  assert.match(incidentSource, /boundedIncidentValue\(request\.data\?\.host, 120\)/)
  assert.doesNotMatch(incidentSource, /request\.data\?\.message/)
})
