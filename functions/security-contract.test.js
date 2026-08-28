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
const contractRenewalSource = readFileSync(join(__dirname, 'contract-renewals.js'), 'utf8')
const adminRolesSource = readFileSync(join(repositoryRoot, 'src', 'pages', 'admin', 'AdminRolesPage.tsx'), 'utf8')
const accessRouteSource = readFileSync(join(repositoryRoot, 'src', 'identity', 'access.ts'), 'utf8')
const studentIdentityLinkSource = readFileSync(join(repositoryRoot, 'scripts', 'firebase-student-identity-link.cjs'), 'utf8')
const sessionContractLinkSource = readFileSync(join(repositoryRoot, 'scripts', 'firebase-session-contract-link.cjs'), 'utf8')
const ptContractUsageReconcileSource = readFileSync(join(repositoryRoot, 'scripts', 'firebase-pt-contract-usage-reconcile.cjs'), 'utf8')
const contractUsageSource = readFileSync(join(__dirname, 'contract-usage.js'), 'utf8')
const ptScheduleMigrationSource = readFileSync(join(repositoryRoot, 'scripts', 'firebase-pt-schedule-v2-migration.cjs'), 'utf8')
const renewalContinuitySource = readFileSync(join(repositoryRoot, 'scripts', 'firebase-renewal-continuity-reconcile.cjs'), 'utf8')
const firestoreDeltaSyncSource = readFileSync(join(repositoryRoot, 'scripts', 'firebase-firestore-delta-sync.cjs'), 'utf8')
const financeLedgerMigrationSource = readFileSync(join(repositoryRoot, 'scripts', 'firebase-finance-ledger-migration.cjs'), 'utf8')
const revenueRecognitionMigrationSource = readFileSync(join(repositoryRoot, 'scripts', 'firebase-pt-revenue-recognition-migration.cjs'), 'utf8')
const identityAccessSource = readFileSync(join(__dirname, 'identity-access.js'), 'utf8')
const ptSchedulePublishSource = readFileSync(join(__dirname, 'pt-schedule-publish.js'), 'utf8')
const ptScheduleV2Source = readFileSync(join(__dirname, 'pt-schedule-v2.js'), 'utf8')
const studentAvailabilitySource = readFileSync(join(__dirname, 'student-availability.js'), 'utf8')
const appSource = readFileSync(join(repositoryRoot, 'src', 'App.tsx'), 'utf8')
const appShellSource = readFileSync(join(repositoryRoot, 'src', 'components', 'AppShell.tsx'), 'utf8')
const ptOperationsClientSource = readFileSync(join(repositoryRoot, 'src', 'services', 'ptOperationsV2Service.ts'), 'utf8')
const branchScheduleWorkspaceSource = readFileSync(join(repositoryRoot, 'src', 'components', 'schedule', 'BranchScheduleWorkspace.tsx'), 'utf8')
const firebaseClientSource = readFileSync(join(repositoryRoot, 'src', 'lib', 'firebase.ts'), 'utf8')
const indexHtmlSource = readFileSync(join(repositoryRoot, 'index.html'), 'utf8')
const vercelConfig = JSON.parse(readFileSync(join(repositoryRoot, 'vercel.json'), 'utf8'))

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

test('legacy finance deletes and every direct session write entry point fail closed', () => {
  const deleteContractSource = databaseContextSource.match(/const deleteContract[\s\S]*?\n  const addPayment/)?.[0] ?? ''
  const addPaymentSource = databaseContextSource.match(/const addPayment[\s\S]*?\n  const deletePayment/)?.[0] ?? ''
  const deletePaymentSource = databaseContextSource.match(/const deletePayment[\s\S]*?\n  const addSession/)?.[0] ?? ''
  const addSessionSource = databaseContextSource.match(/const addSession[\s\S]*?\n  const updateSession/)?.[0] ?? ''
  const updateSessionSource = databaseContextSource.match(/const updateSession[\s\S]*?\n  const deleteSession/)?.[0] ?? ''
  const deleteSessionSource = databaseContextSource.match(/const deleteSession[\s\S]*?\n  const addTrainer/)?.[0] ?? ''
  const leaveRequestSource = databaseContextSource.match(/const addLeaveRequest[\s\S]*?\n  const addSessionRequest/)?.[0] ?? ''
  const sessionRequestSource = databaseContextSource.match(/const addSessionRequest[\s\S]*?\n  const updateScheduleData/)?.[0] ?? ''

  assert.match(deleteContractSource, /throw new Error/)
  assert.match(addPaymentSource, /throw new Error/)
  assert.match(deletePaymentSource, /throw new Error/)
  assert.match(addSessionSource, /throw new Error/)
  assert.match(updateSessionSource, /throw new Error/)
  assert.match(deleteSessionSource, /throw new Error/)
  assert.match(leaveRequestSource, /throw new Error/)
  assert.match(sessionRequestSource, /throw new Error/)
  assert.doesNotMatch(deleteContractSource, /deleteDoc|transaction\.delete|batch\.delete/)
  assert.doesNotMatch(addPaymentSource, /setDoc|addDoc|transaction\.set|batch\.set/)
  assert.doesNotMatch(deletePaymentSource, /deleteDoc|transaction\.delete|batch\.delete/)
  assert.doesNotMatch(addSessionSource, /setDoc|addDoc|transaction\.set|batch\.set/)
  assert.doesNotMatch(updateSessionSource, /setDoc|updateDoc|transaction\.update|batch\.update/)
  assert.doesNotMatch(deleteSessionSource, /deleteDoc|transaction\.delete|batch\.delete/)
  assert.doesNotMatch(leaveRequestSource, /setDoc|updateDoc|deleteDoc|transaction\.(?:set|update|delete)/)
  assert.doesNotMatch(sessionRequestSource, /setDoc|updateDoc|deleteDoc|transaction\.(?:set|update|delete)/)
})

test('Firestore rules deny hard-delete of legacy finance and all browser session writes', () => {
  for (const collectionName of ['contracts', 'payments']) {
    const block = rules.match(new RegExp(`match \/${collectionName}\\/\\{documentId\\} \\{[\\s\\S]*?\\n    \\}`))?.[0] ?? ''
    assert.match(block, /allow read, create, update: if isAdmin\(\)/, `${collectionName} must remain admin-readable during migration`)
    assert.match(block, /allow delete: if false/, `${collectionName} hard-delete must be denied to every browser client`)
    assert.doesNotMatch(block, /allow[^;]*delete[^;]*if isAdmin\(\)/)
  }
  const sessionsBlock = rules.match(/match \/sessions\/\{documentId\} \{[\s\S]*?\n    \}/)?.[0] ?? ''
  assert.match(sessionsBlock, /allow read: if isAdmin\(\)/)
  assert.match(sessionsBlock, /allow create, update, delete: if false/)
  assert.doesNotMatch(sessionsBlock, /allow[^;]*(?:create|update|delete)[^;]*if isAdmin\(\)/)
})

test('unsafe purchase stays locked while contract renewal uses one server transaction', () => {
  const purchaseSubmit = addSessionsModalSource.match(/const handleSubmit[\s\S]*?\n  \};/)?.[0] ?? ''

  assert.doesNotMatch(purchaseSubmit, /onSave|addPayment|addContract|updateContract|setDoc|updateDoc/)
  assert.match(addSessionsModalSource, /Tạm khóa để bảo vệ sổ tài chính/)
  assert.match(addSessionsModalSource, /type="submit"[\s\S]*?disabled[\s\S]*?Đang nâng cấp an toàn/)
  assert.match(renewContractModalSource, /await renewPtContract\(/)
  assert.doesNotMatch(renewContractModalSource, /addPayment|addContract|updateContract|setDoc|updateDoc/)
  const renewalCallable = contractRenewalSource.match(/const renewPtContract = renewalCall[\s\S]*?\n  \}\)/)?.[0] ?? ''
  assert.match(renewalCallable, /db\.runTransaction/)
  assert.match(renewalCallable, /transaction\.create\(newContractReference/)
  assert.match(renewalCallable, /transaction\.update\(sourceReference/)
  assert.match(renewalCallable, /renewalIdempotencyKey/)
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
  assert.match(adminRolesSource, /Chức danh & phạm vi/)
})

test('scoped staff assignment is deployable and synchronizes its operational projections', () => {
  const assignmentHandler = identityAccessSource.match(/const assignStaffPositions = onCall[\s\S]*?\n  const suspendAccountAccess/)?.[0] ?? ''

  assert.match(functionsSource, /exports\.assignStaffPositions = identityAccessFunctions\.assignStaffPositions/)
  assert.match(assignmentHandler, /capabilities = computedCapabilities\(accessRole, positions\)/)
  assert.match(assignmentHandler, /staffReference = db\.doc\(`staff\/\$\{targetUid\}`\)/)
  assert.match(assignmentHandler, /trainerReference = db\.doc\(`trainers\/\$\{targetUid\}`\)/)
  assert.match(assignmentHandler, /positions\.includes\('trainer_pt'\)/)
  assert.match(assignmentHandler, /status: 'inactive'/)
  assert.match(assignmentHandler, /createdBy: actor\.uid/)
})

test('member account deletion removes identity only and preserves operational history', () => {
  const deleteHandler = identityAccessSource.match(/const deleteMemberAccount = onCall[\s\S]*?\n  const saveStaffOperationsProfile/)?.[0] ?? ''

  assert.match(functionsSource, /exports\.deleteMemberAccount = identityAccessFunctions\.deleteMemberAccount/)
  assert.match(deleteHandler, /requireCapability\(actor, 'identity\.invite\.manage'\)/)
  assert.match(deleteHandler, /confirmUid !== targetUid/)
  assert.match(deleteHandler, /Không thể tự xóa tài khoản/)
  assert.match(deleteHandler, /Không thể xóa tài khoản quản trị/)
  assert.match(deleteHandler, /Đây là tài khoản nhân viên/)
  assert.match(deleteHandler, /accountUid: FieldValue\.delete\(\)/)
  assert.match(deleteHandler, /transaction\.delete\(userReference\)/)
  assert.match(deleteHandler, /transaction\.delete\(assignmentReference\)/)
  assert.match(deleteHandler, /action: 'member_account\.deleted'/)
  assert.match(deleteHandler, /await auth\.deleteUser\(targetUid\)/)
  assert.doesNotMatch(deleteHandler, /transaction\.delete\(db\.doc\(`(?:contracts|sessions|payments|ledgerEntries)\//)
  assert.match(adminRolesSource, /Nhập <strong>XÓA<\/strong> để xác nhận/)
  assert.match(adminRolesSource, /deleteMemberAccount/)
})

test('sensitive operations routes require Identity v2 capabilities in addition to legacy UI roles', () => {
  const expectedRoutes = {
    'admin-dashboard': 'pt.operations.manage',
    'admin-pt-students': 'pt.operations.manage',
    'admin-pt-schedule': 'pt.schedule.branch.publish',
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
  const productionScheduleRoute = appSource.match(/case 'admin-pt-schedule':[\s\S]*?<\/AuraOperationsFrame>/)?.[0] ?? ''
  assert.match(productionScheduleRoute, /backendMode === 'firebase'/)
  assert.match(productionScheduleRoute, /!authzReady/)
  assert.match(productionScheduleRoute, /accessContext\?\.capabilities\.includes\('pt\.schedule\.branch\.publish'\)[\s\S]*?BranchScheduleWorkspace/)
  assert.match(productionScheduleRoute, /: <SchedulerWrapper/)
  assert.equal((productionScheduleRoute.match(/<SchedulerWrapper/g) || []).length, 1)
  assert.match(branchScheduleWorkspaceSource, /getPtScheduleWorkspace/)
  assert.match(branchScheduleWorkspaceSource, /applyPtScheduleDraftCommand/)
  assert.match(branchScheduleWorkspaceSource, /generatePtScheduleDraft/)
  assert.match(branchScheduleWorkspaceSource, /const validatePublish = async \(\) =>[\s\S]*?validatePtScheduleDraft\(\{[\s\S]*?expectedDraftRevision: workspace\.draftRevision/)
  assert.match(branchScheduleWorkspaceSource, /const confirmPublish = async \(\) =>[\s\S]*?publishPtSchedule\(\{[\s\S]*?expectedDraftRevision: publishPreview\.draftRevision/)
  assert.match(branchScheduleWorkspaceSource, /onClick=\{\(\) => void validatePublish\(\)\}[\s\S]*?Kiểm tra & Publish/)
  assert.match(branchScheduleWorkspaceSource, /onClick=\{\(\) => void confirmPublish\(\)\}/)
})

test('staff keeps learner navigation while every work capability has a separate page', () => {
  for (const [view, section] of Object.entries({
    'staff-students': 'students',
    'staff-schedule': 'schedule',
    'staff-requests': 'requests',
  })) {
    assert.match(appSource, new RegExp(`case '${view}'[\\s\\S]*?<TrainerPortalV2 section="${section}"`))
  }
  assert.match(appSource, /case 'staff-nutrition-reviews':[\s\S]*?<StaffNutritionReviewsPage/)
  assert.match(appSource, /case 'staff-quotes':[\s\S]*?<SalesPortalV2/)
  assert.match(appSource, /case 'staff-renewals':[\s\S]*?<ContractRenewals/)
  assert.match(appSource, /case 'staff-payroll':[\s\S]*?<StaffPayrollPage/)
  assert.doesNotMatch(appSource, /view === 'home'[\s\S]{0,200}trainer-portal/)
  assert.match(appShellSource, /const staffNavSections[\s\S]*?label: 'CÔNG VIỆC'[\s\S]*?'staff-students'[\s\S]*?'staff-schedule'[\s\S]*?'staff-requests'[\s\S]*?'staff-nutrition-reviews'[\s\S]*?'staff-quotes'[\s\S]*?'staff-renewals'[\s\S]*?'staff-payroll'/)
  assert.match(appShellSource, /const staffMobileNav[\s\S]*?'home'[\s\S]*?'nutrition'[\s\S]*?'schedule'[\s\S]*?'progress'[\s\S]*?'courses'[\s\S]*?'profile'/)
  assert.match(accessRouteSource, /'staff-students': 'coach\.workspace\.view'/)
  assert.match(accessRouteSource, /'staff-nutrition-reviews': 'coach\.workspace\.view'/)
  assert.match(accessRouteSource, /'staff-quotes': 'sales\.quotes\.self\.manage'/)
  assert.match(accessRouteSource, /'staff-renewals': 'renewals\.workspace\.view'/)
  assert.match(appShellSource, /role === 'admin' \|\| role === 'super_admin'/)
  assert.doesNotMatch(appShellSource, /Trung tâm trợ giúp đang được hoàn thiện/)
  assert.doesNotMatch(appShellSource, /<HelpCircle|<Settings/)
  assert.match(ptOperationsClientSource, /attempt < 3/)
  assert.match(ptOperationsClientSource, /functions\/deadline-exceeded/)
  assert.match(ptOperationsClientSource, /reportClientIssue\('firestore'/)
  assert.match(ptOperationsClientSource, /Không gian Staff đang có nhiều lượt truy cập/)
  assert.match(ptOperationsClientSource, /Kết nối tới dịch vụ Staff tạm gián đoạn/)
})

test('access context retries transient infrastructure failures without retrying authorization failures', () => {
  const identityClient = readFileSync(join(repositoryRoot, 'src', 'services', 'identityAccessService.ts'), 'utf8')
  const accessMethod = identityClient.match(/export async function getMyAccessContext[\s\S]*?\n}/)?.[0] || ''
  assert.match(accessMethod, /timeout: 10_000/)
  assert.match(accessMethod, /attempt < 2/)
  assert.match(accessMethod, /resource-exhausted/)
  assert.match(accessMethod, /deadline-exceeded/)
  assert.match(accessMethod, /if \(!transientCodes\.has\(code\)/)
  assert.doesNotMatch(accessMethod, /permission-denied/)
})

test('legacy operations listeners are route scoped and never load the admin dashboard', () => {
  const viewScope = databaseContextSource.match(/const LEGACY_OPERATIONS_VIEW_SOURCES = \{[\s\S]*?\n\} as const satisfies/)?.[0] ?? ''

  assert.doesNotMatch(viewScope, /['"]admin-dashboard['"]/, 'the dashboard must use aggregate APIs, not legacy listeners')
  assert.doesNotMatch(viewScope, /['"]admin-report['"]/, 'the report must use aggregate APIs, not legacy listeners')
  assert.match(viewScope, /'admin-finance': \['branches', 'contracts', 'students'\]/)
  assert.match(viewScope, /'admin-payroll': \['trainers', 'branches'\]/)
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
    'ptAvailability',
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

test('startup defers non-critical providers and ships immutable hashed assets', () => {
  assert.match(firebaseClientSource, /import\('firebase\/app-check'\)/)
  assert.match(firebaseClientSource, /requestIdleCallback/)
  assert.match(indexHtmlSource, /href="\/icons\/aura-icon-192\.png"/)
  assert.doesNotMatch(indexHtmlSource, /LogoAura_Update_final2|preconnect" href="https:\/\/www\.(?:google|gstatic)\.com/)

  const assetPolicy = vercelConfig.headers.find((entry) => entry.source === '/assets/(.*)')
  const rootPolicy = vercelConfig.headers.find((entry) => entry.source === '/')
  assert.equal(assetPolicy?.headers?.find((header) => header.key === 'Cache-Control')?.value, 'public, max-age=31536000, immutable')
  assert.equal(rootPolicy?.headers?.find((header) => header.key === 'Cache-Control')?.value, 'no-store, max-age=0')
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
  assert.match(studentIdentityLinkSource, /const studentData = item\.student\.data \|\| \{\}/)
  assert.match(studentIdentityLinkSource, /displayName: typeof studentData\.name/)
  assert.match(studentIdentityLinkSource, /email: typeof studentData\.email/)
  assert.doesNotMatch(studentIdentityLinkSource, /typeof item\.student\.(?:name|email|phone) === 'string'/)
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

test('session contract linking is target-only, date-exact, digest-gated, and PII-safe', () => {
  assert.match(sessionContractLinkSource, /projectId: 'gen-lang-client-0815966909'/)
  assert.match(sessionContractLinkSource, /databaseId: 'ai-studio-aurafitnesselear-/)
  assert.match(sessionContractLinkSource, /mode: 'dry-run'/)
  assert.match(sessionContractLinkSource, /APPLY_SESSION_CONTRACT_LINK_V1/)
  assert.match(sessionContractLinkSource, /currentDocument: \{ updateTime: item\.updateTime \}/)
  assert.match(sessionContractLinkSource, /candidates\.length > 1/)
  assert.match(sessionContractLinkSource, /contract\.startDate <= sessionDate && contract\.endDate >= sessionDate/)
  assert.doesNotMatch(sessionContractLinkSource, /86400000\s*\*\s*60|60\s*\*\s*86400000/)
  assert.doesNotMatch(sessionContractLinkSource, /console\.(?:log|error)\([^)]*(?:studentId|sessionId|contractId|email|phone|name)/)
})

test('PT contract usage reconciliation is target-only, monotonic, evidence-based and digest-gated', () => {
  assert.match(ptContractUsageReconcileSource, /projectId: 'gen-lang-client-0815966909'/)
  assert.match(ptContractUsageReconcileSource, /databaseId: 'ai-studio-aurafitnesselear-/)
  assert.match(ptContractUsageReconcileSource, /APPLY_PT_CONTRACT_USAGE_RECONCILIATION_V1/)
  assert.match(ptContractUsageReconcileSource, /EVIDENCE_STATUSES\.has\(status\) \|\| session\.fields\.billingStatus === 'charged'/)
  assert.match(ptContractUsageReconcileSource, /if \(evidence\.length > current\)/)
  assert.match(ptContractUsageReconcileSource, /currentDocument: \{ updateTime: item\.updateTime \}/)
  assert.match(ptContractUsageReconcileSource, /decreasesPlanned: 0/)
  assert.doesNotMatch(ptContractUsageReconcileSource, /usedSessions:\s*(?:item\.before|current\s*-)/)
  assert.doesNotMatch(ptContractUsageReconcileSource, /console\.(?:log|error)\([^)]*(?:studentId|contractId|phone|email|name)/)
})

test('contract usage projection and history share one auditable charge formula', () => {
  assert.match(contractUsageSource, /billingStatus === 'exempt'/)
  assert.match(contractUsageSource, /billingStatus === 'charged'/)
  assert.match(contractUsageSource, /LEGACY_CHARGED_STATUSES\.has/)
  assert.match(contractUsageSource, /legacyProjectionAdjustment/)
  assert.match(contractUsageSource, /chargedSessionIds/)
  assert.match(functionsSource, /exports\.syncPtContractUsageProjection = onDocumentWritten/)
  assert.match(functionsSource, /exports\.getStudentContractUsage = businessReportingFunctions\.getStudentContractUsage/)
})

test('PT schedule publish is actor-scoped, revisioned, transactional, and immutable', () => {
  assert.match(functionsSource, /exports\.validatePtScheduleDraft = ptSchedulePublishFunctions\.validatePtScheduleDraft/)
  assert.match(functionsSource, /exports\.publishPtSchedule = ptSchedulePublishFunctions\.publishPtSchedule/)
  assert.match(functionsSource, /exports\.listPtScheduleVersions = ptSchedulePublishFunctions\.listPtScheduleVersions/)
  assert.match(functionsSource, /exports\.restorePtScheduleVersionToDraft = ptSchedulePublishFunctions\.restorePtScheduleVersionToDraft/)
  assert.match(functionsSource, /exports\.getMyBranchScheduleWorkspace = ptSchedulePublishFunctions\.getMyBranchScheduleWorkspace/)
  assert.match(functionsSource, /exports\.saveMyBranchScheduleDraft = ptSchedulePublishFunctions\.saveMyBranchScheduleDraft/)
  assert.match(ptSchedulePublishSource, /requireCapability\(actor, 'pt\.schedule\.branch\.publish'\)/)
  assert.match(ptSchedulePublishSource, /actor\.branchIds\.includes\(branchId\)/)
  assert.match(ptSchedulePublishSource, /draftRevision !== expectedDraftRevision/)
  assert.match(ptSchedulePublishSource, /transaction\.create\(versionReference/)
  assert.match(ptSchedulePublishSource, /pt_schedule\.version_restored_to_draft/)
  assert.match(ptSchedulePublishSource, /nextDraftRevision = draftRevision \+ 1/)
  assert.match(ptSchedulePublishSource, /saveMyBranchScheduleDraft/)
  assert.match(ptSchedulePublishSource, /mergeRestoredBranchSchedule\(currentData\.schedule \|\| \{\}, scopedSchedule, branchId/)
  assert.match(ptSchedulePublishSource, /CHARGED_SESSION_IMMUTABLE/)
  assert.match(ptSchedulePublishSource, /value\.billingStatus === 'charged'/)
  assert.match(ptSchedulePublishSource, /contractId: contract\.id/)
  assert.match(rules, /match \/ptScheduleVersions\/\{versionId\}[\s\S]*?allow write: if false/)
})

test('PT schedule V2 is actor-scoped, date-exact, branch-owned and command revisioned', () => {
  for (const endpoint of [
    'listPtScheduleBranches',
    'getPtScheduleWorkspace',
    'generatePtScheduleDraft',
    'getPtScheduleSlotCandidates',
    'applyPtScheduleDraftCommand',
  ]) assert.match(functionsSource, new RegExp(`exports\\.${endpoint} = ptScheduleV2Functions\\.${endpoint}`))

  assert.match(ptScheduleV2Source, /requireCapability\(actor, 'pt\.schedule\.branch\.publish'\)/)
  assert.match(ptScheduleV2Source, /actor\.branchIds\.includes\(branchId\)/)
  assert.match(ptScheduleV2Source, /storedDate\(contract\.startDate\) <= date/)
  assert.match(ptScheduleV2Source, /storedDate\(contract\.endDate\) >= date/)
  assert.match(ptScheduleV2Source, /AMBIGUOUS_ACTIVE_CONTRACT/)
  assert.match(ptScheduleV2Source, /TRAINER_AVAILABILITY_UNCONFIGURED/)
  assert.match(ptScheduleV2Source, /loadLatestSubmittedFallbacks\(db, studentMap, weeklyAvailability, week\)/)
  assert.match(studentAvailabilitySource, /const weekly = normalizedSubmittedAvailability[\s\S]*?if \(weekly\)[\s\S]*?const inheritedCandidates[\s\S]*?const legacy = legacyDefaultAvailability/)
  assert.match(studentAvailabilitySource, /source: 'inherited_weekly'/)
  assert.match(studentAvailabilitySource, /source: 'legacy_default'/)
  assert.match(ptScheduleV2Source, /MAX_DRAFT_ENTRIES = 440/)
  assert.doesNotMatch(ptScheduleV2Source, /entries\.slice\(0, 5\)/)
  assert.match(ptScheduleV2Source, /revision !== expectedRevision/)
  assert.match(ptScheduleV2Source, /transaction\.create\(receipt/)
  assert.match(ptScheduleV2Source, /unassignedEntries/)
  assert.match(rules, /match \/ptScheduleDrafts\/\{draftId\}[\s\S]*?allow write: if false/)
  assert.match(rules, /match \/ptScheduleCommandReceipts\/\{receiptId\}[\s\S]*?allow read, write: if false/)
})

test('PT schedule migration is target-only, digest-gated, create-only for drafts and preserves sessions', () => {
  assert.match(ptScheduleMigrationSource, /projectId: 'gen-lang-client-0815966909'/)
  assert.match(ptScheduleMigrationSource, /databaseId: 'ai-studio-aurafitnesselear-/)
  assert.match(ptScheduleMigrationSource, /APPLY_PT_SCHEDULE_V2/)
  assert.match(ptScheduleMigrationSource, /before\.plan\.digest !== args\.digest/)
  assert.match(ptScheduleMigrationSource, /currentDocument: \{ exists: false \}/)
  assert.match(ptScheduleMigrationSource, /currentDocument: \{ updateTime: item\.updateTime \}/)
  assert.match(ptScheduleMigrationSource, /preservedCollections: \['sessions', 'contracts', 'payments', 'ledgerEntries'\]/)
  assert.doesNotMatch(ptScheduleMigrationSource, /documents\/sessions\//)
})

test('renewal continuity reconciliation is target-only, digest-gated and refuses ambiguous entitlement', () => {
  assert.match(renewalContinuitySource, /projectId: 'gen-lang-client-0815966909'/)
  assert.match(renewalContinuitySource, /databaseId: 'ai-studio-aurafitnesselear-/)
  assert.match(renewalContinuitySource, /reconcile-renewal-continuity/)
  assert.match(renewalContinuitySource, /args\.digest !== plan\.planDigest/)
  assert.match(renewalContinuitySource, /currentDocument: \{ updateTime \}/)
  assert.match(renewalContinuitySource, /ENTITLEMENT_NOT_EXACTLY_PROVABLE/)
  assert.doesNotMatch(renewalContinuitySource, /gen-lang-client-0246058381/)
})

test('Firestore delta sync keeps the retired project read-only and applies only digest-approved target writes', () => {
  assert.match(firestoreDeltaSyncSource, /projectId: 'gen-lang-client-0246058381', databaseId: 'aura-fitness-db'/)
  assert.match(firestoreDeltaSyncSource, /projectId: 'gen-lang-client-0815966909'/)
  assert.match(firestoreDeltaSyncSource, /apply-source-delta/)
  assert.match(firestoreDeltaSyncSource, /sourceReadOnly: true/)
  assert.match(firestoreDeltaSyncSource, /deletePropagation: false/)
  assert.match(firestoreDeltaSyncSource, /source_delete_not_propagated/)
  assert.match(firestoreDeltaSyncSource, /currentDocument: \{ exists: false \}/)
  assert.match(firestoreDeltaSyncSource, /currentDocument: \{ updateTime: item\.targetUpdateTime \}/)
  assert.match(firestoreDeltaSyncSource, /plan\.planDigest !== approved\.planDigest/)
  assert.match(firestoreDeltaSyncSource, /PROJECTION_FIELDS/)
  assert.doesNotMatch(firestoreDeltaSyncSource, /databaseBase\(SOURCE\).*documents:commit/s)
})

test('finance ledger migration preserves immutable branch collisions and keeps the override exact', () => {
  assert.match(financeLedgerMigrationSource, /currentDocument: \{ exists: false \}/)
  assert.match(financeLedgerMigrationSource, /--allow-existing-branch-collisions=/)
  assert.match(financeLedgerMigrationSource, /arguments_\.allowedBranchCollisions !== collisionCount/)
  assert.match(financeLedgerMigrationSource, /collisionFields\[0\] === 'branchId'/)
  assert.match(financeLedgerMigrationSource, /preservedCanonicalCollisions/)
  assert.doesNotMatch(financeLedgerMigrationSource, /documents\/ledgerEntries\/\$\{entry\.id\}[\s\S]*currentDocument: \{ updateTime:/)
})

test('revenue recognition migration creates only missing entries and preserves reviewed collisions', () => {
  assert.match(revenueRecognitionMigrationSource, /currentDocument: \{ exists: false \}/)
  assert.match(revenueRecognitionMigrationSource, /--allow-existing-collisions=/)
  assert.match(revenueRecognitionMigrationSource, /args\.allowedCollisions !== plan\.collisions\.length/)
  assert.match(revenueRecognitionMigrationSource, /item\.reason === 'deterministic_id_mismatch'/)
  assert.match(revenueRecognitionMigrationSource, /collisions: plan\.collisions\.map/)
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
