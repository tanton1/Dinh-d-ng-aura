'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readAcademyLearningDraft } = require('./academy-learning-drafts')
const { getAcademyLearningDraft, academyLearningDraftUnits } = require('./generated/academy-learning-drafts.cjs')
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }

test('draft source is never loaded for unauthorized or disabled staff', async () => {
  let loaded = false
  for (const reason of ['student', 'coach', 'disabled', 'stale-claim']) {
    await assert.rejects(readAcademyLearningDraft({
      request: { data: { learningUnitDraft: 17 } }, HttpsError,
      requireStaff: async () => { throw new HttpsError('permission-denied', reason) },
      loadDraft: () => { loaded = true },
    }), { code: 'permission-denied' })
  }
  assert.equal(loaded, false)
})

test('draft endpoint rejects unsupported or coerced chapter inputs before loading content', async () => {
  for (const chapter of [undefined, '3', 0, -1, 3.5, 21, null, {}, NaN]) {
    await assert.rejects(readAcademyLearningDraft({
      request: { data: { learningUnitDraft: chapter } }, HttpsError,
      requireStaff: async () => undefined,
      loadDraft: () => { throw new Error('must not load') },
    }), { code: 'invalid-argument' })
  }
})

test('authorized preview returns only the selected draft without a publication mutation', async () => {
  for (const { chapter } of academyLearningDraftUnits) {
    const order = []
    const result = await readAcademyLearningDraft({
      request: { data: { learningUnitDraft: chapter } }, HttpsError,
      requireStaff: async () => { order.push('auth') },
      loadDraft: (number) => { order.push('load'); return getAcademyLearningDraft(number) },
    })
    assert.deepEqual(order, ['auth', 'load'])
    assert.equal(result.draft.unit.chapter, chapter)
    assert.equal(result.draft.unit.review.status, 'draft-needs-review')
    assert.equal(result.draft.formativeChecks.length, 4)
    assert.deepEqual(Object.keys(result), ['draft'])
  }
})

test('mismatched or published artifacts fail closed', async () => {
  for (const draft of [null, { unit: { chapter: 8, review: { status: 'draft-needs-review' } } }, { unit: { chapter: 17, review: { status: 'published' } } }]) {
    await assert.rejects(readAcademyLearningDraft({
      request: { data: { learningUnitDraft: 17 } }, HttpsError,
      requireStaff: async () => undefined, loadDraft: () => draft,
    }), { code: 'failed-precondition' })
  }
})
