const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { reviewPriority, reviewRecord, reviewSummary } = require('./nutrition-reviews')

test('identity contracts expose one staff workspace while student relationships scope each HLV tab', () => {
  const deployable = require('./identity-contract.json')
  const shared = require('../shared/identity/identity-contract.json')
  assert.deepEqual(deployable, shared)
  assert.ok(deployable.staffCapabilities.includes('coach.workspace.view'))
  assert.ok(!deployable.positionCapabilities.coach_online.includes('nutrition.meals.assigned.review'))
  assert.ok(!deployable.positionCapabilities.trainer_pt.includes('nutrition.meals.assigned.review'))
  assert.ok(deployable.positionCapabilities.trainer_pt.includes('renewals.workspace.view'))
  assert.ok(deployable.positionCapabilities.trainer_pt.includes('renewals.case.assigned_student.support'))
  assert.ok(deployable.adminCapabilities.includes('nutrition.meals.all.review'))
})

test('public review record keeps explicit nutrition values and coach assignment', () => {
  const snapshot = {
    id: 'review-1',
    data: () => ({
      userId: 'student-1',
      userName: 'Học viên A',
      status: 'pending',
      revision: 2,
      meal: {
        mealType: 'Bữa trưa',
        calories: 430,
        protein: 35,
        carb: 41,
        fat: 12,
        items: [{ name: 'Ức gà', kcal: 210, protein: 31 }],
      },
    }),
  }
  const result = reviewRecord(snapshot, {}, { coachId: 'coach-1', coachIds: ['coach-1'] }, 'HLV Dinh dưỡng')
  assert.equal(result.totalKcal, 430)
  assert.equal(result.totalProtein, 35)
  assert.equal(result.fiber, 0)
  assert.equal(result.assignedCoachId, 'coach-1')
  assert.deepEqual(result.assignedCoachIds, ['coach-1'])
  assert.equal(result.assignedCoachName, 'HLV Dinh dưỡng')
  assert.equal(result.revision, 2)
})

test('pending reviews expose SLA state and prioritise the oldest overdue meal', () => {
  const now = Date.UTC(2026, 7, 24, 12, 0, 0)
  const snapshot = (id, ageMinutes, priority = 'normal') => ({
    id,
    data: () => ({
      userId: `student-${id}`,
      status: 'pending',
      priority,
      createdAt: now - ageMinutes * 60_000,
      meal: {},
    }),
  })
  const recent = reviewRecord(snapshot('recent', 40, 'high'), {}, {}, '', { now, slaMinutes: 120 })
  const overdue = reviewRecord(snapshot('overdue', 180), {}, {}, '', { now, slaMinutes: 120 })
  const oldest = reviewRecord(snapshot('oldest', 260), {}, {}, '', { now, slaMinutes: 120 })
  assert.equal(recent.isOverdue, false)
  assert.equal(overdue.overdueMinutes, 60)
  assert.deepEqual([recent, overdue, oldest].sort(reviewPriority).map((item) => item.id), ['oldest', 'overdue', 'recent'])
  const summary = reviewSummary([recent, overdue, oldest])
  assert.equal(summary.pending, 3)
  assert.equal(summary.overdue, 2)
  assert.equal(summary.highPriority, 1)
  assert.equal(summary.studentIds.size, 3)
})

test('nutrition review callables are actor-scoped and transaction-backed', () => {
  const source = fs.readFileSync(path.join(__dirname, 'nutrition-reviews.js'), 'utf8')
  assert.match(source, /trustedAccessContext\(request, db\)/)
  assert.match(source, /where\('nutritionPTIds', 'array-contains', coachId\)/)
  assert.match(source, /where\('crmProfileId', 'in', chunk\)/)
  assert.match(source, /where\('studentId', 'in'/)
  assert.doesNotMatch(source, /coachClients/)
  assert.match(source, /Học viên PT Gym → Hợp đồng/)
  assert.match(source, /db\.runTransaction/)
  assert.match(source, /users\/\$\{userId\}\/mealLogs/)
  assert.match(source, /nutritionReviewAuditLogs/)
  assert.match(source, /assignedCoachIds\.includes\(coachId\)/)
  assert.match(source, /nutrition_review_settings/)
  assert.match(source, /reviewPriority/)
})

test('coach workspace resolves tabs from primary, secondary and nutrition assignments', () => {
  const source = fs.readFileSync(path.join(__dirname, 'pt-operations-v2.js'), 'utf8')
  assert.match(source, /const getMyCoachWorkspaceScope = onCall/)
  assert.match(source, /assignedContracts\(db, actor, 'training'/)
  assert.match(source, /assignedContracts\(db, actor, 'nutrition'/)
  assert.match(source, /source: 'pt_contract_assignments'/)
  assert.match(source, /primaryStudents/)
  assert.match(source, /secondaryStudents/)
  assert.doesNotMatch(source, /requireCapability\(actor, 'pt\.students\.assigned\.view'\)/)
})
