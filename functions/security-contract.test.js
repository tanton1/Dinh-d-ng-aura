const assert = require('node:assert/strict')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')

const repositoryRoot = join(__dirname, '..')
const rules = readFileSync(join(repositoryRoot, 'firestore.rules'), 'utf8')
const databaseRules = readFileSync(join(repositoryRoot, 'database.rules.json'), 'utf8')
const functionsSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
const authSource = readFileSync(join(repositoryRoot, 'src', 'contexts', 'AuthContext.tsx'), 'utf8')
const authOriginSource = readFileSync(join(repositoryRoot, 'src', 'services', 'authOriginService.ts'), 'utf8')
const mealDetailSource = readFileSync(join(repositoryRoot, 'src', 'pages', 'student', 'CapturedMealDetail.tsx'), 'utf8')
const firebaseServiceSource = readFileSync(join(repositoryRoot, 'src', 'services', 'firebaseService.ts'), 'utf8')
const notificationServiceSource = readFileSync(join(repositoryRoot, 'src', 'services', 'notificationService.ts'), 'utf8')
const typesSource = readFileSync(join(repositoryRoot, 'src', 'types.ts'), 'utf8')

test('profile rules prevent client role and membership changes', () => {
  assert.match(rules, /function hasOnlySafeUserChanges\(\)/)
  assert.match(rules, /allow update: if isOwner\(userId\)\s+&& hasOnlySafeUserChanges\(\)/)
  assert.doesNotMatch(rules, /allow update:\s*if isOwner\(userId\);/)
  assert.match(rules, /data\.role == 'student'/)
  assert.match(rules, /data\.membership == 'free'/)
})

test('privileged rules require matching token and stored roles', () => {
  assert.match(rules, /currentUser\(\)\.get\('role', 'student'\) == authRole\(\)/)
  assert.match(rules, /match \/system\/\{document\}[\s\S]*?allow read: if isAdmin\(\)/)
  assert.match(rules, /match \/system\/\{document\}\/\{nested=\*\*\}[\s\S]*?allow read, write: if isAdmin\(\)/)
  assert.doesNotMatch(rules, /match \/system\/\{document=\*\*\}[\s\S]*?allow read, write: if true/)
  assert.match(functionsSource, /function hasTrustedRole\(request, profile, allowedRoles\)/)
  assert.match(functionsSource, /profile\?\.role === tokenRole/)
})

test('shipper is assignable without receiving admin privileges', () => {
  assert.match(functionsSource, /assignableRoles = new Set\(\[[^\]]*'shipper'/)
  assert.doesNotMatch(functionsSource, /privilegedAdminRoles = new Set\(\[[^\]]*'shipper'/)
  assert.doesNotMatch(functionsSource, /academyStaffRoles = new Set\(\[[^\]]*'shipper'/)
  assert.match(rules, /match \/eatCleanDeliveries\/\{orderId\}[\s\S]*?allow read, create, update, delete: if false/)
  assert.match(databaseRules, /"\.read": false/)
  assert.doesNotMatch(databaseRules, /auth\.token\.role/)
})

test('Eat Clean config writes cannot bypass callable readiness and revision guards', () => {
  assert.match(rules, /match \/system\/eat_clean_config[\s\S]*?allow write: if false/)
  assert.match(rules, /match \/system\/\{document\}[\s\S]*?allow write: if isAdmin\(\) && document != 'eat_clean_config'/)
  assert.match(rules, /match \/eatCleanQuoteRateLimits\/\{userIdHash\}[\s\S]*?allow read, write: if false/)
})

test('meal reviews and notifications are owner scoped', () => {
  assert.match(rules, /match \/mealReviews\/\{reviewId\}[\s\S]*?resource\.data\.userId == request\.auth\.uid/)
  assert.match(rules, /request\.resource\.data\.userId == resource\.data\.userId/)
  assert.match(rules, /match \/notifications\/\{notificationId\}[\s\S]*?allow read: if isOwner\(userId\)/)
})

test('meal approval preserves the immutable structured AI analysis snapshot', () => {
  assert.match(firebaseServiceSource, /resolveMealAnalysisSnapshot/)
  assert.match(firebaseServiceSource, /data\.meal\?\.aiAnalysis/)
  assert.match(firebaseServiceSource, /if \(!existingAnalysis && reviewAnalysis\)/)
  assert.doesNotMatch(firebaseServiceSource, /aiAnalysis:\s*data\.aiAnalysis\s*\|\|\s*sanitizedUpdates\.aiAnalysis\s*\|\|\s*null/)
  assert.doesNotMatch(mealDetailSource, /generateMealReview/)
  assert.match(mealDetailSource, /submitMealReview\([^\n]+, meal\)/)

  const reviewUpdateRule = rules.match(/match \/mealReviews\/\{reviewId\}[\s\S]*?allow delete: if isAdmin\(\);/)?.[0] ?? ''
  assert.doesNotMatch(reviewUpdateRule, /'aiAnalysis'/)
  assert.doesNotMatch(reviewUpdateRule, /'analysisSnapshot'/)
})

test('production auth has no email role bootstrap or unconditional demo OTP', () => {
  assert.doesNotMatch(authSource, /nhattank16/i)
  assert.match(authSource, /import\.meta\.env\.DEV && import\.meta\.env\.VITE_ENABLE_DEMO_OTP === 'true'/)
  assert.doesNotMatch(authSource, /cleanCode === '000000'/)
  assert.match(authSource, /import\.meta\.env\.MODE === 'e2e' && import\.meta\.env\.VITE_ENABLE_DEMO_OTP === 'true'/)
  assert.equal(existsSync(join(repositoryRoot, 'deleteRecreate.mjs')), false)
  assert.equal(existsSync(join(repositoryRoot, 'import-client.mjs')), false)
})

test('production authentication stays on the authorized Vercel application origin', () => {
  assert.match(authOriginSource, /https:\/\/dinh-duong-aura\.vercel\.app/)
  assert.match(authOriginSource, /isLegacyFirebaseHostingOrigin/)
  assert.doesNotMatch(authOriginSource, /`https:\/\/\$\{firebaseProjectId\}\.web\.app`/)
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

test('push admin overview is privileged, aggregate-only and serializes timestamps', () => {
  const overviewSource = functionsSource.match(/exports\.getPushAdminOverview = onCall[\s\S]*?\r?\n\}\)\r?\n\r?\nexports\.dispatchPushBroadcast/)?.[0] ?? ''
  assert.match(overviewSource, /hasTrustedRole\(request, actorSnapshot\.data\(\), privilegedAdminRoles\)/)
  assert.match(overviewSource, /activeUsers: activeProfiles\.size/)
  assert.match(overviewSource, /webPushAccepted24h/)
  assert.match(overviewSource, /webPushFailures24h/)
  assert.match(overviewSource, /pushTimestampToIso/)
  assert.match(overviewSource, /return overview/)
  assert.doesNotMatch(overviewSource, /return\s+\{[^}]*token/s)
  assert.match(notificationServiceSource, /'getPushAdminOverview'/)
  assert.match(typesSource, /export interface PushAdminOverview/)
})

test('all-member push broadcasts exclude staff while explicit targets stay supported', () => {
  const dispatchSource = functionsSource.match(/exports\.dispatchPushBroadcast = onCall[\s\S]*?\r?\n\}\)\r?\n\r?\nfunction requireDocumentId/)?.[0] ?? ''
  assert.match(dispatchSource, /invoker:\s*'public'/)
  assert.match(dispatchSource, /const actorId = requireCaller\(request\)/)
  assert.match(dispatchSource, /hasTrustedRole\(request, actor, privilegedAdminRoles\)/)
  assert.match(dispatchSource, /const audienceProfiles = targetType === 'all'/)
  assert.match(dispatchSource, /role === undefined \|\| role === null \|\| role === '' \|\| role === 'student'/)
  assert.match(dispatchSource, /: existingProfiles/)
  assert.match(dispatchSource, /webPushFailureCount/)
  assert.match(dispatchSource, /filteredOutCount/)
})

test('push preference bypass is restricted to an admin testing their own device', () => {
  const dispatchSource = functionsSource.match(/exports\.dispatchPushBroadcast = onCall[\s\S]*?\r?\n\}\)\r?\n\r?\nfunction requireDocumentId/)?.[0] ?? ''
  assert.match(dispatchSource, /const isSelfDeviceTest = request\.data\?\.respectCategoryPreferences === false/)
  assert.match(dispatchSource, /requestedIds\.length === 1/)
  assert.match(dispatchSource, /requestedIds\[0\] === actorId/)
  assert.match(dispatchSource, /isSelfDeviceTest \|\| acceptsPushCategory/)
})

test('admin user subscription keeps notification preferences and targeting goals', () => {
  const subscriptionSource = firebaseServiceSource.match(/export function subscribeToAdminUsers[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(subscriptionSource, /notificationSettings: data\.notificationSettings/)
  assert.match(subscriptionSource, /goals: Array\.isArray\(data\.goals\)/)
  assert.match(subscriptionSource, /nutritionProfile: data\.nutritionProfile\?\.goal/)
})
