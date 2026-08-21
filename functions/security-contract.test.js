const assert = require('node:assert/strict')
const { existsSync, readFileSync, readdirSync } = require('node:fs')
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
const serverSource = readFileSync(join(repositoryRoot, 'server.ts'), 'utf8')
const packageManifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
const databaseContextSource = readFileSync(join(repositoryRoot, 'src', 'contexts', 'DatabaseContext.tsx'), 'utf8')
const addSessionsModalSource = readFileSync(join(repositoryRoot, 'src', 'components', 'admin', 'pt', 'AddSessionsModal.tsx'), 'utf8')
const renewContractModalSource = readFileSync(join(repositoryRoot, 'src', 'components', 'admin', 'pt', 'RenewContractModal.tsx'), 'utf8')
const adminRolesSource = readFileSync(join(repositoryRoot, 'src', 'pages', 'admin', 'AdminRolesPage.tsx'), 'utf8')
const accessRouteSource = readFileSync(join(repositoryRoot, 'src', 'identity', 'access.ts'), 'utf8')
const studentIdentityLinkSource = readFileSync(join(repositoryRoot, 'scripts', 'firebase-student-identity-link.cjs'), 'utf8')
const identityAccessSource = readFileSync(join(__dirname, 'identity-access.js'), 'utf8')

function readRuntimeSources(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) return readRuntimeSources(absolutePath)
      if (!/\.(?:ts|tsx)$/.test(entry.name)) return []
      return [`\n/* ${absolutePath} */\n${readFileSync(absolutePath, 'utf8')}`]
    })
    .join('\n')
}

const runtimeSource = readRuntimeSources(join(repositoryRoot, 'src'))
const adminRuntimeSource = readRuntimeSources(join(repositoryRoot, 'src', 'components', 'admin'))

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

test('legacy Express authentication never accepts an unsigned JWT payload', () => {
  const requireAuthSource = serverSource.match(/async function requireAuth[\s\S]*?\n  const aiRateLimiter/)?.[0] ?? ''

  assert.match(requireAuthSource, /verifyIdToken\(token, true\)/)
  assert.match(requireAuthSource, /return res\.status\(401\)\.json\(\{[\s\S]*?UNAUTHENTICATED/)
  assert.doesNotMatch(requireAuthSource, /token\.split\(['"]\.['"]\)/)
  assert.doesNotMatch(requireAuthSource, /Buffer\.from/)
  assert.doesNotMatch(requireAuthSource, /atob\(/)
  assert.doesNotMatch(requireAuthSource, /JSON\.parse\([^)]*(?:payload|token)/i)
})

test('production scripts serve only the Vite static frontend', () => {
  const scripts = packageManifest.scripts ?? {}
  assert.match(String(scripts.start ?? ''), /^vite preview\b/)
  assert.match(String(scripts.dev ?? ''), /^vite\b/)

  for (const [name, command] of Object.entries(scripts)) {
    assert.doesNotMatch(String(command), /(?:tsx|node|nodemon|ts-node)\s+(?:\.\/)?server\.ts\b/, `${name} must not start legacy server.ts`)
  }
})

test('browser runtime has no dependency on retired same-origin /api routes', () => {
  assert.doesNotMatch(runtimeSource, /fetch\s*\(\s*['"`]\/api(?:\/|['"`])/)
  assert.doesNotMatch(runtimeSource, /(?:axios|ky)(?:\.[a-z]+)?\s*\(\s*['"`]\/api(?:\/|['"`])/)
  assert.doesNotMatch(runtimeSource, /httpsCallable[^\n]+['"`]\/api\//)
})

test('admin browser code cannot provision Firebase Auth users or use phone numbers as passwords', () => {
  assert.doesNotMatch(adminRuntimeSource, /createUserWithEmailAndPassword/)
  assert.doesNotMatch(adminRuntimeSource, /\bgetAuth\s*\(/)
  assert.doesNotMatch(adminRuntimeSource, /\binitializeApp\s*\(/)
  assert.doesNotMatch(adminRuntimeSource, /password\s*[:=][^\n]*(?:phone|phoneNumber|student\.phone)/i)
  assert.match(adminRuntimeSource, /createAccountInvite/)
})

test('account invitation duplicate checks do not depend on an undeployed compound index', () => {
  const inviteHandler = identityAccessSource.match(/const createAccountInvite = onCall\([\s\S]*?\n  \}\)/)?.[0] ?? ''

  assert.match(inviteHandler, /where\('phoneNumber', '==', phoneNumber\)\.limit\(25\)/)
  assert.match(inviteHandler, /where\('email', '==', email\)\.limit\(25\)/)
  assert.doesNotMatch(inviteHandler, /where\('(?:phoneNumber|email)', '==',[\s\S]{0,120}where\('status'/)
  assert.match(inviteHandler, /item\.data\(\)\.status === 'pending'/)
})

test('legacy finance and session delete entry points fail closed', () => {
  const deleteContractSource = databaseContextSource.match(/const deleteContract[\s\S]*?\n  const addPayment/)?.[0] ?? ''
  const addPaymentSource = databaseContextSource.match(/const addPayment[\s\S]*?\n  const deletePayment/)?.[0] ?? ''
  const deletePaymentSource = databaseContextSource.match(/const deletePayment[\s\S]*?\n  const addSession/)?.[0] ?? ''
  const deleteSessionSource = databaseContextSource.match(/const deleteSession[\s\S]*?\n  const addTrainer/)?.[0] ?? ''

  assert.match(deleteContractSource, /throw new Error/)
  assert.match(addPaymentSource, /throw new Error/)
  assert.match(deletePaymentSource, /throw new Error/)
  assert.match(deleteSessionSource, /throw new Error/)
  assert.doesNotMatch(deleteContractSource, /deleteDoc|transaction\.delete|batch\.delete/)
  assert.doesNotMatch(addPaymentSource, /setDoc|addDoc|transaction\.set|batch\.set/)
  assert.doesNotMatch(deletePaymentSource, /deleteDoc|transaction\.delete|batch\.delete/)
  assert.doesNotMatch(deleteSessionSource, /deleteDoc|transaction\.delete|batch\.delete/)
})

test('Firestore rules deny hard-delete of legacy contracts, payments, and sessions', () => {
  for (const collectionName of ['contracts', 'payments', 'sessions']) {
    const block = rules.match(new RegExp(`match \/${collectionName}\\/\\{documentId\\} \\{[\\s\\S]*?\\n    \\}`))?.[0] ?? ''
    assert.match(block, /allow read, create, update: if isAdmin\(\)/, `${collectionName} must remain admin-readable during migration`)
    assert.match(block, /allow delete: if false/, `${collectionName} hard-delete must be denied to every browser client`)
    assert.doesNotMatch(block, /allow[^;]*delete[^;]*if isAdmin\(\)/)
  }
})

test('unsafe purchase and renewal forms cannot partially mutate contracts or payments', () => {
  const purchaseSubmit = addSessionsModalSource.match(/const handleSubmit[\s\S]*?\n  \};/)?.[0] ?? ''
  const renewalSubmit = renewContractModalSource.match(/const handleSubmit[\s\S]*?\n  \};/)?.[0] ?? ''

  assert.doesNotMatch(purchaseSubmit, /onSave|addPayment|addContract|updateContract|setDoc|updateDoc/)
  assert.doesNotMatch(renewalSubmit, /addPayment|addContract|updateContract|setDoc|updateDoc/)
  assert.match(addSessionsModalSource, /Tạm khóa để bảo vệ sổ tài chính/)
  assert.match(renewContractModalSource, /Gia hạn đang được khóa an toàn/)
  assert.match(addSessionsModalSource, /type="submit"[\s\S]*?disabled[\s\S]*?Đang nâng cấp an toàn/)
  assert.match(renewContractModalSource, /type="submit"[\s\S]*?disabled[\s\S]*?Đang nâng cấp an toàn/)
})

test('legacy role editor does not assign scoped staff positions or let normal admin manage admin roles', () => {
  const roleChoices = adminRolesSource.match(/const roles: UserRole\[\] = \[[\s\S]*?\n\]/)?.[0] ?? ''
  const roleChange = adminRolesSource.match(/const changeRole[\s\S]*?\n  \}/)?.[0] ?? ''
  const legacyRoleCallable = functionsSource.match(/exports\.updateUserRole = onCall[\s\S]*?function requireCaller/)?.[0] ?? ''

  assert.doesNotMatch(roleChoices, /'trainer'|'sales'|'manager'/)
  assert.match(adminRolesSource, /staffPositionRoles\.has\(user\.role\)/)
  assert.match(roleChange, /nextRole === 'admin'/)
  assert.match(roleChange, /nextRole === 'super_admin'/)
  assert.match(adminRolesSource, /Tạo tài khoản/)
  assert.match(adminRolesSource, /Tạo chi nhánh/)
  assert.match(adminRolesSource, /Chức danh & phạm vi/)
  assert.match(legacyRoleCallable, /protectedAdminRoles = new Set\(\['admin', 'super_admin'\]\)/)
  assert.match(legacyRoleCallable, /actorRole !== 'super_admin'/)
  assert.match(legacyRoleCallable, /protectedAdminRoles\.has\(nextRole\)/)
})

test('scoped staff assignment cannot silently alter an elevated account for a normal admin', () => {
  assert.match(identityAccessSource, /const assignStaffPositions = onCall/)
  assert.match(identityAccessSource, /targetIsElevated/)
  assert.match(identityAccessSource, /actor\.accessRole !== 'super_admin'/)
  assert.match(identityAccessSource, /Chỉ Super Admin được thay đổi quyền/)
  assert.match(adminRolesSource, /assignStaffPositions/)
  assert.match(adminRolesSource, /Chức danh & phạm vi vận hành/)
})

test('sensitive operations routes require Identity v2 capabilities in addition to legacy UI roles', () => {
  const expectedRoutes = {
    'admin-dashboard': 'pt.operations.manage',
    'admin-pt-students': 'pt.operations.manage',
    'admin-pt-schedule': 'pt.operations.manage',
    'admin-report': 'pt.operations.manage',
    'admin-finance': 'finance.operations.manage',
    'admin-hr': 'identity.staff_position.manage',
    'admin-payroll': 'payroll.operations.manage',
    'admin-roles': 'identity.staff_position.manage',
  }
  for (const [route, capability] of Object.entries(expectedRoutes)) {
    assert.ok(
      accessRouteSource.includes(`'${route}': '${capability}'`),
      `${route} must require ${capability}`,
    )
  }
})

test('legacy operations listeners are route scoped and never load the admin dashboard', () => {
  const viewScope = databaseContextSource.match(/const LEGACY_OPERATIONS_VIEW_SOURCES = \{[\s\S]*?\n\} as const satisfies/)?.[0] ?? ''

  assert.doesNotMatch(viewScope, /['"]admin-dashboard['"]/, 'the dashboard must use aggregate APIs, not legacy listeners')
  assert.match(viewScope, /'admin-finance': \['branches', 'contracts', 'students', 'payments'\]/)
  assert.match(viewScope, /'admin-schedule-settings': \['scheduleConfig'\]/)
  assert.match(databaseContextSource, /const activeSources = new Set<LegacyOperationSource>\(LEGACY_OPERATIONS_VIEW_SOURCES\[operationsView\]\)/)
  assert.match(databaseContextSource, /const expectedInitialSnapshots = new Set<LegacyOperationSource>\(activeSources\)/)

  const scopedListenerCalls = databaseContextSource.match(/if \(activeSources\.has\('[^']+'\)\) unsubs\.push\(onSnapshot/g) ?? []
  const allListenerCalls = databaseContextSource.match(/unsubs\.push\(onSnapshot/g) ?? []
  assert.equal(
    scopedListenerCalls.length,
    allListenerCalls.length,
    'every legacy realtime listener must be guarded by its active route source',
  )

  for (const source of [
    'students', 'contracts', 'sessions', 'payments', 'leaveRequests',
    'workoutLogs', 'sessionRequests', 'scheduleConfig', 'trainers',
    'branches', 'packages', 'staff', 'dailyCheckins', 'schedules',
  ]) {
    assert.match(
      databaseContextSource,
      new RegExp(`activeSources\\.has\\('${source}'\\)`),
      `${source} listener must be guarded by the active route scope`,
    )
  }

  assert.doesNotMatch(databaseContextSource, /markReady\(['"]globalSchedule['"]\)/)
  assert.doesNotMatch(databaseContextSource, /onSnapshot\(doc\(db, ['"]schedules['"], ['"]global_schedule['"]\)/)
})

test('student identity linking is target-only, digest-gated, scoped to learners, and PII-safe', () => {
  assert.match(studentIdentityLinkSource, /const TARGET_PROJECT = 'gen-lang-client-0815966909'/)
  assert.match(studentIdentityLinkSource, /const TARGET_DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'/)
  assert.doesNotMatch(studentIdentityLinkSource, /gen-lang-client-0246058381|aura-fitness-db/)
  assert.match(studentIdentityLinkSource, /suppliedDigest !== actualDigest/)
  assert.match(studentIdentityLinkSource, /dryRun\.report\.planDigest !== plan\.planDigest/)
  assert.match(studentIdentityLinkSource, /confirmation !== APPLY_CONFIRMATION/)
  assert.match(studentIdentityLinkSource, /accessRole: 'student'/)
  assert.match(studentIdentityLinkSource, /crmProfileId: item\.student\.id/)
  assert.match(studentIdentityLinkSource, /staff_record_match/)
  assert.match(studentIdentityLinkSource, /auth_matches_multiple_crm_profiles/)
  assert.match(studentIdentityLinkSource, /UIDs and CRM IDs are SHA-256 hashed/)
  assert.doesNotMatch(studentIdentityLinkSource, /console\.(?:log|error)\([^)]*(?:email|phone|displayName)/)

  const applyCandidateSource = studentIdentityLinkSource.match(/async function applyCandidate[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(
    applyCandidateSource.indexOf('writeIdentityDocuments') < applyCandidateSource.indexOf('setCustomUserClaims'),
    'the assignment must become fail-closed before Auth claims are coordinated',
  )
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
