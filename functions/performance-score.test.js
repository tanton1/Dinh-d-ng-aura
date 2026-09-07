const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  PERFORMANCE_CATEGORIES,
  PROFILE_CHECKLIST_KEYS,
  calculateBrandPerformance,
  normalizeUrl,
  proofKey,
  assertBranchScope,
} = require('./performance-score')

function evidence(type, id, extra = {}) {
  return { id, type, status: 'approved', duplicateKey: id, ...extra }
}

test('Aura Performance Score keeps the approved 100-point weight model', () => {
  assert.deepEqual(PERFORMANCE_CATEGORIES.map(({ id, weight }) => ({ id, weight })), [
    { id: 'reliability', weight: 22 },
    { id: 'coaching_quality', weight: 23 },
    { id: 'student_experience', weight: 17 },
    { id: 'student_progress', weight: 13 },
    { id: 'operations', weight: 10 },
    { id: 'renewal', weight: 5 },
    { id: 'brand', weight: 10 },
  ])
  assert.equal(PERFORMANCE_CATEGORIES.reduce((sum, item) => sum + item.weight, 0), 100)
})

test('Personal Brand follows the 0, 1, 2.5, 4 and 5 point table', () => {
  const scores = [0, 1, 2, 3, 4, 6].map((count) => calculateBrandPerformance(
    Array.from({ length: count }, (_, index) => evidence('personal_content', `personal-${index}`)),
  ).personal.score)
  assert.deepEqual(scores, [0, 1, 2.5, 4, 5, 5])
})

test('Aura Brand caps at three and Profile Quality awards 0.2 per checklist item', () => {
  const checklist = Object.fromEntries(PROFILE_CHECKLIST_KEYS.map((key, index) => [key, index < 7]))
  const result = calculateBrandPerformance([
    ...Array.from({ length: 5 }, (_, index) => evidence('aura_assignment', `aura-${index}`, { briefId: `brief-${index}` })),
    evidence('profile_checklist', 'profile', { checklist, reviewedAt: new Date('2026-09-07T00:00:00Z') }),
  ])
  assert.equal(result.aura.approvedCount, 3)
  assert.equal(result.aura.score, 3)
  assert.equal(result.profile.completedCount, 7)
  assert.equal(result.profile.score, 1.4)
})

test('pending or repeated evidence never inflates the brand score', () => {
  const result = calculateBrandPerformance([
    evidence('personal_content', 'one', { duplicateKey: 'same' }),
    evidence('personal_content', 'two', { duplicateKey: 'same' }),
    evidence('personal_content', 'pending', { status: 'submitted', duplicateKey: 'new' }),
  ])
  assert.equal(result.personal.approvedCount, 1)
  assert.equal(result.personal.score, 1)
})

test('evidence URLs drop tracking and fragments before deduplication', () => {
  assert.equal(
    normalizeUrl('https://Facebook.com/groups/aura/posts/123/?utm_source=x&fbclid=y#comment'),
    'https://facebook.com/groups/aura/posts/123',
  )
})

test('the same screenshot cannot be counted twice through different social links', () => {
  const contentHash = 'a'.repeat(64)
  const left = proofKey({ type: 'personal_content', url: 'https://facebook.com/post/1', contentHash, briefId: '', screenshotPath: 'first.jpg' })
  const right = proofKey({ type: 'personal_content', url: 'https://group.example/post/2', contentHash, briefId: '', screenshotPath: 'second.jpg' })
  assert.equal(left, right)
})

test('distinct Aura Brand tasks under one campaign remain separately countable', () => {
  const first = proofKey({ type: 'aura_assignment', url: 'https://facebook.com/post/1', contentHash: '', briefId: 'campaign-september', screenshotPath: '' })
  const second = proofKey({ type: 'aura_assignment', url: 'https://facebook.com/post/2', contentHash: '', briefId: 'campaign-september', screenshotPath: '' })
  assert.notEqual(first, second)
})

test('manager reviews are branch scoped while Admin can review the whole system', () => {
  const manager = { accessRole: 'staff', positions: ['branch_manager'], capabilities: ['performance.evidence.review'], branchIds: ['branch-a'] }
  assert.doesNotThrow(() => assertBranchScope(manager, ['branch-a']))
  assert.throws(() => assertBranchScope(manager, ['branch-b']), /cùng chi nhánh/)
  assert.doesNotThrow(() => assertBranchScope({ ...manager, accessRole: 'admin', branchIds: [] }, ['branch-b']))
})

test('Firestore and Storage deny direct evidence writes while callable exports remain explicit', () => {
  const root = path.join(__dirname, '..')
  const firestoreRules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
  const storageRules = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8')
  const indexSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  assert.match(firestoreRules, /match \/performanceEvidence\/\{evidenceId\}[\s\S]*?allow read, write: if false/)
  assert.match(storageRules, /match \/performance-evidence\/\{userId\}\/\{periodId\}\/\{evidenceId\}\/\{fileName\}[\s\S]*?request\.resource\.metadata\.ownerUid == userId/)
  assert.match(indexSource, /exports\.submitPerformanceBrandEvidenceV2/)
  assert.match(indexSource, /exports\.reviewPerformanceBrandEvidenceV2/)
  const performanceSource = fs.readFileSync(path.join(__dirname, 'performance-score.js'), 'utf8')
  const submitBlock = performanceSource.match(/const submitPerformanceBrandEvidence[\s\S]*?const withdrawPerformanceBrandEvidence/)?.[0] || ''
  assert.match(submitBlock, /actor\.legacyStaffId \|\| actor\.uid/)
  assert.doesNotMatch(submitBlock, /request\.data\?\.staffId/)
  assert.match(performanceSource, /performanceSnapshots\/\$\{period\}_\$\{staffId\}[\s\S]*?locked === true/)
  assert.match(performanceSource, /amountImpact: 'none'/)
})
