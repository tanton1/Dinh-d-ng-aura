'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const functionsSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
const rulesSource = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8')
const storageRulesSource = readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8')
const cycleMigrationSource = readFileSync(join(__dirname, 'scripts', 'backfill-pt-assignment-cycles.js'), 'utf8')
const operationsV2Source = readFileSync(join(__dirname, 'pt-operations-v2.js'), 'utf8')
const studentScheduleServiceSource = readFileSync(join(__dirname, '..', 'src', 'services', 'studentPtScheduleService.ts'), 'utf8')
const studentSchedulePageSource = readFileSync(join(__dirname, '..', 'src', 'pages', 'student', 'SchedulePage.tsx'), 'utf8')

test('PT lifecycle is exposed only through the expected atomic callables', () => {
  for (const name of [
    'onboardPtClientByEmail',
    'savePtClientCoachingProfile',
    'listPublishedPtPrograms',
    'listManagedPtPrograms',
    'getPtAssignedWorkout',
    'savePtWorkoutLog',
    'listPtScheduleEvents',
    'savePtScheduleEvent',
    'setPtScheduleEventStatus',
  ]) {
    assert.match(functionsSource, new RegExp(`exports\\.${name}\\s*=\\s*onCall`))
  }
  assert.match(functionsSource, /return db\.runTransaction\(async \(transaction\) =>/)
  assert.match(functionsSource, /assertPublishedPtProgram\(programSnapshot\.data\(\), versionSnapshot\.data\(\)/)
})

test('client rules deny partial PT relationship and assignment writes', () => {
  const coachClientBlock = rulesSource.match(/match \/coachClients\/\{clientId\} \{[\s\S]*?\n    \}/)?.[0] ?? ''
  const assignmentBlock = rulesSource.match(/match \/programAssignments\/\{assignmentId\} \{[\s\S]*?\n    \}/)?.[0] ?? ''
  const cycleBlock = rulesSource.match(/match \/programAssignmentCycles\/\{cycleId\} \{[\s\S]*?\n    \}/)?.[0] ?? ''
  assert.match(coachClientBlock, /allow create: if false;/)
  assert.match(assignmentBlock, /allow create, update, delete: if false;/)
  assert.match(cycleBlock, /allow create, update, delete: if false;/)
  const logBlock = rulesSource.match(/match \/coachingWorkoutLogs\/\{logId\} \{[\s\S]*?\n      \}/)?.[0] ?? ''
  assert.match(logBlock, /allow create, update: if false;/)
})

test('Academy full course documents are staff-only and learner content uses a callable', () => {
  const courseBlock = rulesSource.match(/match \/courses\/\{courseId\} \{[\s\S]*?match \/quizKeys/)?.[0] ?? ''
  assert.match(courseBlock, /allow read: if isAcademyStaff\(\);/)
  assert.match(functionsSource, /exports\.listAcademyCourses\s*=\s*onCall/)
  assert.match(functionsSource, /academyModulesForLearner\(course\.modules, contentMode, maxFullModuleIndex\)/)
  assert.match(functionsSource, /const hasFullAccess = isStaff \|\| \(hasEnrollment && hasMembershipAccess\)/)
  assert.match(functionsSource, /mode === 'preview' && lesson\.preview === true/)
  assert.match(functionsSource, /selected\.lesson\.preview === true\s*&& course\.settings\?\.visibility === 'members'/)
  const mediaBlock = storageRulesSource.match(/match \/course-media\/\{courseId\}\/\{lessonId\}\/\{allPaths=\*\*\} \{[\s\S]*?\n    \}/)?.[0] ?? ''
  assert.match(mediaBlock, /allow create: if canManageCourseMedia\(\)/)
  assert.match(mediaBlock, /allow update: if isAdmin\(\)/)
})

test('next PT workout is resolved from completed coaching logs', () => {
  assert.match(functionsSource, /coachingWorkoutLogs/)
  assert.match(functionsSource, /next-incomplete-session/)
  assert.match(functionsSource, /completedSessionIds/)
  assert.match(functionsSource, /program-completed/)
  assert.match(functionsSource, /assignmentCycleId/)
  assert.match(functionsSource, /log\.verificationVersion === 2/)
  assert.match(functionsSource, /loadPtCycleWorkoutLogs/)
  assert.doesNotMatch(functionsSource, /coachingWorkoutLogs`\)\.limit\(1000\)/)
})

test('PT assignment cycles do not overwrite repeated program or version runs', () => {
  assert.match(functionsSource, /db\.collection\('programAssignmentCycles'\)\.doc\(\)/)
  assert.match(functionsSource, /previousProgramId !== currentProgramId \|\| previousVersionId !== currentVersionId/)
  assert.match(functionsSource, /keepsPreviousCycle/)
  assert.match(functionsSource, /status: cycleStatus/)
  assert.match(functionsSource, /activeAssignmentCycleId: currentCycleId/)
  assert.match(functionsSource, /lastAssignmentCycleId/)
  assert.match(functionsSource, /ptLegacyAssignmentCycleId/)
})

test('PT schedule contract is callable-only for writes and supports optimistic concurrency', () => {
  for (const name of ['listPtScheduleEvents', 'savePtScheduleEvent', 'setPtScheduleEventStatus']) {
    assert.match(functionsSource, new RegExp(`exports\\.${name}\\s*=\\s*onCall`))
  }
  assert.match(functionsSource, /expectedUpdatedAt/)
  assert.match(functionsSource, /new HttpsError\('aborted'/)
  assert.match(functionsSource, /Học viên chỉ được chuyển lịch đang lên kế hoạch sang hoàn thành hoặc bỏ qua/)
  assert.match(functionsSource, /Khách hàng tạm dừng hoặc đã hoàn thành chỉ có thể hủy lịch cũ/)
  const scheduleBlock = rulesSource.match(/match \/scheduleEvents\/\{eventId\} \{[\s\S]*?\n      \}/)?.[0] ?? ''
  assert.match(scheduleBlock, /allow read, create, update, delete: if false;/)
  assert.match(functionsSource, /Cần phiên bản updatedAt hiện tại để sửa lịch PT an toàn/)
  assert.match(functionsSource, /Cần phiên bản updatedAt hiện tại để đổi trạng thái lịch PT an toàn/)
  assert.match(functionsSource, /coachId: relationship\.coachId/)
  assert.match(functionsSource, /existing\.status !== 'planned'/)
})

test('learner and staff personal Gym schedule is self-scoped and availability writes are revision guarded', () => {
  const studentScheduleBlock = operationsV2Source.match(/const listMyStudentPtSchedule = staffCall[\s\S]*?const listMyAssignedStudents = staffCall/)?.[0] ?? ''
  assert.match(operationsV2Source, /const listMyStudentPtSchedule = staffCall/)
  assert.match(operationsV2Source, /const saveMyStudentAvailability = staffCall/)
  assert.match(operationsV2Source, /!\['student', 'staff'\]\.includes\(actor\.accessRole\)/)
  assert.match(studentScheduleBlock, /where\('studentId', '==', profile\.id\)/)
  assert.match(studentScheduleBlock, /where\('date', '>=', from\)/)
  assert.match(studentScheduleBlock, /where\('date', '<=', to\)/)
  assert.match(studentScheduleBlock, /orderBy\('date', 'asc'\)/)
  assert.match(studentScheduleBlock, /sessionsSnapshot\.docs\.slice\(0, 1000\)/)
  assert.doesNotMatch(studentScheduleBlock, /where\('studentId', '==', profile\.id\)\.limit\(500\)/)
  assert.match(operationsV2Source, /source: 'crm_profile_id'/)
  assert.match(operationsV2Source, /source: 'auth_uid'/)
  assert.match(studentScheduleBlock, /status: 'profile_not_linked'/)
  assert.match(studentScheduleBlock, /status: 'linked'/)
  assert.match(studentScheduleBlock, /sessionsTruncated:/)
  assert.match(studentScheduleBlock, /currentRevision !== expectedRevision/)
  assert.match(studentScheduleBlock, /issueCode: 'REVISION_CONFLICT'/)
  assert.match(studentScheduleBlock, /ptAvailability\/\$\{profile\.id\}_\$\{weekId\}/)
  assert.match(studentScheduleBlock, /const minimumSlots = Math\.max\(5, requiredSessions\)/)
  assert.match(studentScheduleBlock, /availabilityCutoff\(weekId\)/)
  assert.match(studentScheduleBlock, /issueCode: 'AVAILABILITY_LOCKED'/)
  assert.match(studentScheduleBlock, /currentAvailability\.data\(\)\?\.revision/)
  assert.match(studentScheduleBlock, /status: 'submitted'/)
  assert.doesNotMatch(studentScheduleBlock, /request\.data\?\.studentId/)
  assert.match(operationsV2Source, /const getMyTrainerAvailability = staffCall/)
  assert.match(operationsV2Source, /const saveMyTrainerAvailability = staffCall/)
  assert.match(operationsV2Source, /requireCapability\(actor, 'pt\.availability\.self\.manage'\)/)
  assert.match(operationsV2Source, /availabilityRevision: revision \+ 1/)
  assert.match(functionsSource, /exports\.getMyTrainerAvailability = ptOperationsV2Functions\.getMyTrainerAvailability/)
  assert.match(functionsSource, /exports\.saveMyTrainerAvailability = ptOperationsV2Functions\.saveMyTrainerAvailability/)
})

test('Sales workspace bootstraps quotes and catalog through one actor-scoped callable', () => {
  assert.match(operationsV2Source, /const getMySalesWorkspace = staffCall/)
  assert.match(operationsV2Source, /const actor = await salesActor\(request, db\)/)
  assert.match(operationsV2Source, /requireCapability\(actor, 'sales\.quotes\.self\.manage'\)/)
  assert.match(operationsV2Source, /Promise\.all\(\[\s*salesQuotesForActor\(db, actor, limit\),\s*salesCatalogForActor\(db, actor\)/)
  assert.match(functionsSource, /exports\.getMySalesWorkspace = ptOperationsV2Functions\.getMySalesWorkspace/)
})

test('Trainer pages keep separate sections while sharing one actor-scoped bootstrap callable', () => {
  assert.match(operationsV2Source, /const getMyTrainerWorkspace = staffCall/)
  assert.match(operationsV2Source, /const actor = await trainerActor\(request, db\)/)
  assert.match(operationsV2Source, /coachWorkspaceScopeForActor\(db, actor\)/)
  assert.match(operationsV2Source, /assignedStudentsForActor\(db, actor, limit\)/)
  assert.match(operationsV2Source, /trainerScheduleForActor\(db, actor, from, to, limit\)/)
  assert.match(functionsSource, /exports\.getMyTrainerWorkspace = ptOperationsV2Functions\.getMyTrainerWorkspace/)
})

test('student schedule client maps callable failures to actionable structured states', () => {
  for (const issueCode of [
    'AUTH_REQUIRED',
    'ACCESS_SYNC_REQUIRED',
    'ACCESS_DENIED',
    'STUDENT_ROLE_REQUIRED',
    'PROFILE_NOT_LINKED',
    'REVISION_CONFLICT',
    'AVAILABILITY_LOCKED',
    'SYNC_UNAVAILABLE',
  ]) {
    assert.match(studentScheduleServiceSource, new RegExp(`'${issueCode}'`))
  }
  assert.match(studentScheduleServiceSource, /details\.issueCode/)
  assert.match(studentScheduleServiceSource, /replace\(\/\^functions\\\//)
  assert.match(studentSchedulePageSource, /issue\.issueCode/)
  assert.match(studentSchedulePageSource, /crmProfileIdConfigured/)
  assert.match(studentSchedulePageSource, /if \(issue\.issueCode === 'REVISION_CONFLICT'\) await load\(\)/)
})

test('assignment-cycle backfill is stable, dry-run by default and non-destructive', () => {
  assert.match(cycleMigrationSource, /createHash\('sha256'\)/)
  assert.match(cycleMigrationSource, /const apply = args\.has\('--apply'\)/)
  assert.match(cycleMigrationSource, /legacy-collapsed/)
  assert.match(cycleMigrationSource, /freshRelationship\.currentProgramId !== programId/)
  assert.match(cycleMigrationSource, /freshRelationship\.currentVersionId !== versionId/)
  assert.match(cycleMigrationSource, /freshRelationship\.coachingStatus !== relationship\.coachingStatus/)
  assert.match(cycleMigrationSource, /const freshLegacySnapshot = await transaction\.get\(legacyReference\)/)
  assert.doesNotMatch(cycleMigrationSource, /\.delete\(/)
})
