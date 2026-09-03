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
const studentAvailabilityPageSource = readFileSync(join(__dirname, '..', 'src', 'pages', 'student', 'StudentAvailabilityPage.tsx'), 'utf8')
const {
  availabilityCutoff,
  availabilityWeekId,
  contractCoversDate,
  isEffectiveStaffContract,
  isContractSchedulableInWeek,
  isContractSchedulableOn,
  mondayDateKey,
  normalizedTrainerOffDates,
  studentContractProjection,
  studentContractAlerts,
  trainerSlotsWithoutOffDates,
} = require('./pt-operations-v2')

test('staff student scope only accepts active contracts in date with remaining sessions', () => {
  const base = { status: 'active', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 36, usedSessions: 12 }
  assert.equal(isEffectiveStaffContract(base, '2026-08-29'), true)
  assert.equal(isEffectiveStaffContract({ ...base, status: 'future' }, '2026-08-29'), false)
  assert.equal(isEffectiveStaffContract({ ...base, status: 'frozen' }, '2026-08-29'), false)
  assert.equal(isEffectiveStaffContract({ ...base, endDate: '2026-08-28' }, '2026-08-29'), false)
  assert.equal(isEffectiveStaffContract({ ...base, startDate: '2026-08-30' }, '2026-08-29'), false)
  assert.equal(isEffectiveStaffContract({ ...base, usedSessions: 36 }, '2026-08-29'), false)
  assert.equal(isEffectiveStaffContract({ ...base, pausePeriods: [{ type: 'preservation', startDate: '2026-08-20', endDate: '2026-09-05' }] }, '2026-08-29'), false)
})

test('session contract linkage uses the session date while new scheduling remains active and quota aware', () => {
  const expiredToday = {
    status: 'expired',
    startDate: '2026-07-01',
    endDate: '2026-08-31',
    totalSessions: 24,
    usedSessions: 24,
  }
  assert.equal(contractCoversDate(expiredToday, '2026-08-25'), true)
  assert.equal(contractCoversDate(expiredToday, '2026-09-03'), false)
  assert.equal(isContractSchedulableOn(expiredToday, '2026-08-25'), false)

  const renewal = {
    status: 'active',
    startDate: '2026-09-07',
    endDate: '2026-12-06',
    totalSessions: 36,
    usedSessions: 0,
  }
  assert.equal(contractCoversDate(renewal, '2026-09-10'), true)
  assert.equal(isContractSchedulableOn(renewal, '2026-09-03'), false)
  assert.equal(isContractSchedulableOn(renewal, '2026-09-10'), true)
  assert.equal(isContractSchedulableInWeek(renewal, '2026-08-31'), false)
  assert.equal(isContractSchedulableInWeek(renewal, '2026-09-07'), true)
})

test('trainer weekly availability uses a Vietnam Monday, Sunday cutoff and exact OFF dates', () => {
  assert.equal(mondayDateKey('2026-09-03'), '2026-08-31')
  assert.equal(availabilityWeekId('2026-08-31'), '2026-08-31')
  assert.throws(() => availabilityWeekId('2026-09-01'), /thứ Hai/)
  assert.equal(availabilityCutoff('2026-08-31').toISOString(), '2026-08-30T03:00:00.000Z')

  const offDates = normalizedTrainerOffDates(['2026-09-01', '2026-09-01', '2026-09-07'], '2026-08-31')
  assert.deepEqual(offDates, ['2026-09-01'])
  assert.deepEqual(
    trainerSlotsWithoutOffDates(['T2-6', 'T3-6', 'T3-18', 'T4-7'], offDates, '2026-08-31'),
    ['T2-6', 'T4-7'],
  )
})

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
  assert.match(studentScheduleBlock, /if \(!slots\.length\)/)
  assert.match(studentScheduleBlock, /issueCode: 'AVAILABILITY_EMPTY'/)
  assert.match(studentScheduleBlock, /action: 'create_pause_request'/)
  assert.match(studentScheduleBlock, /issueCode: 'MINIMUM_AVAILABILITY_REQUIRED'/)
  assert.match(studentScheduleBlock, /request\.data\?\.confirmBelowMinimum === true/)
  assert.match(studentScheduleBlock, /slots\.length < minimumSlots && !confirmBelowMinimum/)
  assert.match(studentScheduleBlock, /belowMinimumConfirmed: slots\.length < minimumSlots/)
  assert.match(studentScheduleBlock, /contractAlerts: serialize\(contractAlerts\)/)
  assert.match(studentScheduleBlock, /const usageEvidenceComplete = rangeSessionsComplete/)
  assert.match(studentScheduleBlock, /studentContractProjection\(\s*item\.id,\s*contract,\s*today,\s*sessionRecords\.filter\([\s\S]*?usageEvidenceComplete/)
  assert.match(studentScheduleBlock, /currentAvailability\.data\(\)\?\.revision/)
  assert.match(studentScheduleBlock, /status: 'submitted'/)
  assert.doesNotMatch(studentScheduleBlock, /request\.data\?\.studentId/)
  assert.match(operationsV2Source, /const getMyTrainerAvailability = staffCall/)
  assert.match(operationsV2Source, /const saveMyTrainerAvailability = staffCall/)
  assert.match(operationsV2Source, /requireCapability\(actor, 'pt\.availability\.self\.manage'\)/)
  assert.match(operationsV2Source, /availabilityRevision: revision \+ 1/)
  assert.match(operationsV2Source, /requestedWeekId\s*\?\s*Number\(weeklyValue\?\.revision \|\| 0\)/)
  assert.match(operationsV2Source, /trainerAvailability\/\$\{profile\.id\}_\$\{requestedWeekId\}/)
  assert.match(operationsV2Source, /trainerSlotsWithoutOffDates/)
  assert.match(functionsSource, /exports\.getMyTrainerAvailability = ptOperationsV2Functions\.getMyTrainerAvailability/)
  assert.match(functionsSource, /exports\.saveMyTrainerAvailability = ptOperationsV2Functions\.saveMyTrainerAvailability/)
})

test('student contract projection exposes only a bounded payment schedule and canonical debt', () => {
  const projection = studentContractProjection('contract-1', {
    packageName: 'PT 3 tháng',
    status: 'active',
    startDate: '2026-08-01',
    endDate: '2026-09-05',
    totalSessions: 36,
    usedSessions: 33,
    totalPrice: 5_000_000,
    discount: 500_000,
    paidAmount: 2_000_000,
    installments: [
      { id: 'second', date: '2026-09-02', amount: 1_500_000, status: 'pending' },
      { id: 'first', date: '2026-08-25', amount: 1_000_000, status: 'pending' },
    ],
  }, '2026-08-28')
  assert.equal(projection.totalAmount, 4_500_000)
  assert.equal(projection.outstandingAmount, 2_500_000)
  assert.equal(projection.remainingSessions, 3)
  assert.equal(projection.nextPaymentDate, '2026-08-25')
  assert.equal(projection.paymentStatus, 'overdue')
  assert.deepEqual(projection.installments.map((item) => item.id), ['first', 'second'])
})

test('student contract projection prefers chargeable session evidence over a stale stored counter', () => {
  const projection = studentContractProjection('contract-1', {
    packageName: 'PT 12 buổi',
    status: 'active',
    startDate: '2026-08-01',
    endDate: '2026-12-31',
    totalSessions: 12,
    usedSessions: 1,
  }, '2026-08-28', [
    { id: 'session-1', contractId: 'contract-1', status: 'completed', billingStatus: 'charged' },
    { id: 'session-2', contractId: 'contract-1', status: 'no_show', billingStatus: 'charged' },
  ])
  assert.equal(projection.usedSessions, 2)
  assert.equal(projection.remainingSessions, 10)
})

test('student contract projection ignores partial calendar evidence outside the contract range', () => {
  const projection = studentContractProjection('contract-long', {
    packageName: 'PT dài hạn',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    totalSessions: 100,
    usedSessions: 48,
  }, '2026-08-28', [
    { id: 'visible-session', contractId: 'contract-long', status: 'completed', billingStatus: 'charged' },
  ], false)
  assert.equal(projection.usedSessions, 48)
  assert.equal(projection.remainingSessions, 52)
})

test('student contract projection marks preservation as not schedulable without hiding history', () => {
  const projection = studentContractProjection('contract-paused', {
    packageName: 'PT 24 buổi',
    status: 'active',
    startDate: '2026-08-01',
    endDate: '2026-12-31',
    totalSessions: 24,
    usedSessions: 4,
    pausePeriods: [{ type: 'preservation', startDate: '2026-08-25', endDate: '2026-09-05' }],
  }, '2026-08-28')

  assert.equal(projection.remainingSessions, 20)
  assert.equal(projection.pausedToday, true)
  assert.equal(projection.schedulableToday, false)
  assert.deepEqual(projection.pausePeriods, [{ type: 'preservation', startDate: '2026-08-25', endDate: '2026-09-05' }])
})

test('student contract alerts prioritize overdue payments and warn before contract/session exhaustion', () => {
  const contract = studentContractProjection('contract-1', {
    packageName: 'PT 3 tháng',
    status: 'active',
    startDate: '2026-08-01',
    endDate: '2026-09-05',
    totalSessions: 36,
    usedSessions: 33,
    totalPrice: 5_000_000,
    paidAmount: 4_000_000,
    installments: [{ id: 'late', date: '2026-08-25', amount: 1_000_000, status: 'pending' }],
  }, '2026-08-28')
  const alerts = studentContractAlerts([contract], '2026-08-28')
  assert.equal(alerts[0].code, 'PAYMENT_OVERDUE')
  assert.ok(alerts.some((item) => item.code === 'CONTRACT_EXPIRING'))
  assert.ok(alerts.some((item) => item.code === 'CONTRACT_SESSIONS_LOW'))
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
  assert.match(operationsV2Source, /students: trainingStudentIds\.size > 0/)
  assert.match(operationsV2Source, /isEffectiveStaffContract\(contract, today\)/)
  assert.match(operationsV2Source, /assignedStudentsForActor\(db, actor, limit\)/)
  assert.match(operationsV2Source, /return \{ schemaVersion: 3, students, branches, hasMore:/)
  assert.match(operationsV2Source, /trainerScheduleForActor\(db, actor, from, to, limit\)/)
  assert.match(operationsV2Source, /section === 'students'[\s\S]*?Promise\.all\(\[[\s\S]*?assignedStudentsForActor\(db, actor, studentLimit\)[\s\S]*?trainerScheduleForActor\(db, actor, from, to, scheduleLimit\)/)
  assert.match(operationsV2Source, /studentPhone: student\?\.phone \|\| ''/)
  assert.match(operationsV2Source, /studentBranchId: student\?\.branchId \|\| session\.branchId \|\| ''/)
  assert.match(operationsV2Source, /contractEffective,/)
  assert.match(operationsV2Source, /const getMyTrainerStudentDetail = staffCall/)
  assert.match(operationsV2Source, /formulaVersion: 'contract-usage-v2'/)
  assert.match(operationsV2Source, /scheduledContractIds/)
  assert.match(operationsV2Source, /actorIds\.has\(session\.trainerId\)/)
  assert.match(operationsV2Source, /studentContracts = \[\.\.\.new Map\(\[\.\.\.studentContracts, \.\.\.scheduledContracts\]/)
  assert.match(operationsV2Source, /contractCoversDate\(studentContracts\.find\(\(contract\) => contract\.id === session\.contractId\), session\.date/)
  assert.match(operationsV2Source, /schedulableOnWeek: isContractSchedulableInWeek\(contract, weekId, projection\.remainingSessions\)/)
  assert.match(operationsV2Source, /db\.collection\('ptWorkoutLogs'\)\.where\('studentId', '==', studentId\)/)
  assert.match(operationsV2Source, /db\.doc\(`ptTrainingPrograms\/\$\{studentId\}`\)\.get\(\)/)
  assert.match(operationsV2Source, /trainingProgram: serialize\(staffStudentTrainingProgramDetail\(trainingProgramSnapshot\)\)/)
  assert.match(operationsV2Source, /workoutLogs: serialize\(workoutLogs\.slice\(0, 100\)\)/)
  assert.match(operationsV2Source, /effectiveAvailability\.sourceWeekId/)
  assert.match(operationsV2Source, /sessionsForContracts\(db, datedContracts\.map/)
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
    'AVAILABILITY_EMPTY',
    'MINIMUM_AVAILABILITY_REQUIRED',
    'SYNC_UNAVAILABLE',
  ]) {
    assert.match(studentScheduleServiceSource, new RegExp(`'${issueCode}'`))
  }
  assert.match(studentScheduleServiceSource, /details\.issueCode/)
  assert.match(studentScheduleServiceSource, /replace\(\/\^functions\\\//)
  assert.match(studentScheduleServiceSource, /normalizeStudentPtScheduleData/)
  assert.match(studentScheduleServiceSource, /installments: Array\.isArray\(contract\.installments\)/)
  assert.match(studentSchedulePageSource, /issue\.issueCode/)
  assert.match(studentSchedulePageSource, /crmProfileIdConfigured/)
  assert.match(studentSchedulePageSource, /selectedContract\.installments \?\? \[\]/)
  assert.match(studentAvailabilityPageSource, /if \(nextIssue\.issueCode === 'REVISION_CONFLICT'\) await load\(\)/)
  assert.match(studentAvailabilityPageSource, /confirmBelowMinimum: belowMinimumAccepted/)
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
