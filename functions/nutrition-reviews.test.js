const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { reviewRecord } = require('./nutrition-reviews')

test('identity contracts expose one coach workspace and scoped nutrition review capabilities', () => {
  const deployable = require('./identity-contract.json')
  const shared = require('../shared/identity/identity-contract.json')
  assert.deepEqual(deployable, shared)
  for (const position of ['coach_online', 'trainer_pt']) {
    assert.ok(deployable.positionCapabilities[position].includes('coach.workspace.view'))
    assert.ok(deployable.positionCapabilities[position].includes('nutrition.meals.assigned.review'))
  }
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
  const result = reviewRecord(snapshot, {}, { coachId: 'coach-1' }, 'HLV Dinh dưỡng')
  assert.equal(result.totalKcal, 430)
  assert.equal(result.totalProtein, 35)
  assert.equal(result.fiber, 0)
  assert.equal(result.assignedCoachId, 'coach-1')
  assert.equal(result.assignedCoachName, 'HLV Dinh dưỡng')
  assert.equal(result.revision, 2)
})

test('nutrition review callables are actor-scoped and transaction-backed', () => {
  const source = fs.readFileSync(path.join(__dirname, 'nutrition-reviews.js'), 'utf8')
  assert.match(source, /trustedAccessContext\(request, db\)/)
  assert.match(source, /collection\('coachClients'\)\.where\('coachId', '==', coachId\)/)
  assert.match(source, /doc\(`coachClients\/\$\{userId\}`\)/)
  assert.match(source, /where\('nutritionPTIds', 'array-contains', coachId\)/)
  assert.match(source, /db\.runTransaction/)
  assert.match(source, /users\/\$\{userId\}\/mealLogs/)
  assert.match(source, /nutritionReviewAuditLogs/)
  assert.doesNotMatch(source, /request\.data\?\.coachId/)
})
