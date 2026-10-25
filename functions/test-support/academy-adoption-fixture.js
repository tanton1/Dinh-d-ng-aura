'use strict'

const { Timestamp } = require('firebase-admin/firestore')
const { academyAuthoringFixture } = require('./academy-authoring-fixture')
const { createAcademyDraftAdoption } = require('../academy-draft-adoption')
const { getAcademyLearningDraft } = require('../generated/academy-learning-drafts.cjs')
const { getAcademyLearningCheckpoint } = require('../generated/academy-learning-checkpoints.cjs')
const clone = (value) => JSON.parse(JSON.stringify(value))

async function academyAdoptionFixture({ allChapters = false, publish = true } = {}) {
  let adoption
  const f = academyAuthoringFixture({ validateScientificReview: (...args) => adoption.validateCourse(...args) })
  const { validation: v } = f, loads = []
  adoption = createAcademyDraftAdoption({ db: f.db, HttpsError: f.HttpsError, FieldValue: { serverTimestamp: () => 'server-time' },
    storage: f.storage, authorize: f.authorize, validateId: v.courseId, normalize: v.normalizeCourseDraftInput,
    buildQuizContentHash: v.buildQuizContentHash, assertReady: v.assertCourseReadyToPublish,
    loadDraft: (chapter) => { loads.push(chapter); return getAcademyLearningDraft(chapter) }, loadCheckpoint: getAcademyLearningCheckpoint, now: () => 1000 })
  const input = clone(require('../generated/academy-course-template.cjs').auraFoundationCourse)
  input.id = 'course'; input.publicationStatus = publish ? 'review' : 'draft'
  if (!allChapters) input.modules = input.modules.filter((module) => [3, 4].includes(module.order))
  await f.handlers.save(f.request({ course: input, expectedRevision: 0 }))
  if (publish) {
    await f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 1, nextStatus: 'approved' }))
    await f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 2, nextStatus: 'published' }))
  }
  const root = () => f.store.get('courses/course')
  // Test-only attestation. No production grant or real scientific review occurs.
  const grant = () => f.store.set('academyScientificReviewers/editor', { enabled: true, qualificationVerified: true,
    scope: 'nutrition-education', revision: 1, qualificationReference: 'TEST FIXTURE — not real approval',
    chapters: Array.from({ length: 20 }, (_, i) => i + 1), validUntil: Timestamp.fromMillis(2000) })
  const command = (data, role = 'admin') => f.request({ academyAdoption: { courseId: 'course', ...data } }, role)
  const prepare = (chapter = 3) => adoption.mutate(command({ action: 'prepare', chapter, expectedRevision: root().revision }))
  const reviewInput = (candidateId, extra = {}) => ({ action: 'review', candidateId, expectedReviewRevision: 0, decision: 'approved',
    notes: 'Đã kiểm tra nội dung, câu hỏi, phạm vi nguồn và giới hạn an toàn trong dữ liệu kiểm thử.',
    checks: { content: true, assessment: true, references: true, safety: true }, ...extra })
  const review = (candidateId, extra = {}) => adoption.mutate(command(reviewInput(candidateId, extra), 'editor'))
  const adopt = (candidateId, extra = {}) => adoption.mutate(command({ action: 'adopt', candidateId,
    expectedRevision: root().revision, expectedReviewRevision: 1, ...extra }))
  const reviewed = async () => { const proposed = await prepare(); grant(); await review(proposed.candidateId); return proposed }
  return { ...f, adoption, loads, root, grant, command, prepare, reviewInput, review, adopt, reviewed,
    candidate: (id) => f.store.get(`courses/course/academyAdoptionCandidates/${id}`),
    reviewHead: (id) => f.store.get(`courses/course/academyAdoptionReviews/${id}`) }
}

module.exports = { academyAdoptionFixture }
