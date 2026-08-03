'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const functionsSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
const rulesSource = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8')
const storageRulesSource = readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8')
const cycleMigrationSource = readFileSync(join(__dirname, 'scripts', 'backfill-pt-assignment-cycles.js'), 'utf8')

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
