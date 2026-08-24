const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { reviewRecord } = require('./nutrition-reviews')

test('identity contracts expose one staff workspace while student relationships scope each HLV tab', () => {
  const deployable = require('./identity-contract.json')
  const shared = require('../shared/identity/identity-contract.json')
  assert.deepEqual(deployable, shared)
  assert.ok(deployable.staffCapabilities.includes('coach.workspace.view'))
  assert.ok(!deployable.positionCapabilities.coach_online.includes('nutrition.meals.assigned.review'))
  assert.ok(!deployable.positionCapabilities.trainer_pt.includes('nutrition.meals.assigned.review'))
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
  assert.doesNotMatch(source, /request\.data\?\.coachId/)
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
