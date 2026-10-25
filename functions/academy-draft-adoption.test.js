'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const { Timestamp } = require('firebase-admin/firestore')
const { academyAdoptionFixture } = require('./test-support/academy-adoption-fixture')
const clone = (value) => JSON.parse(JSON.stringify(value))
const unchanged = async (f, operation, code) => {
  const before = JSON.stringify([...f.store])
  await assert.rejects(operation(), { code })
  assert.equal(JSON.stringify([...f.store]), before, 'failed command must commit no partial data')
}

test('prepare reads only one chapter, stores an exact immutable proposal, replays without writes and leaves live content alone', async () => {
  const f = await academyAdoptionFixture({ allChapters: true }), root = clone(f.root())
  const proposed = await f.prepare(), reads = f.reads.at(-1)
  assert.equal(reads.filter((path) => path.includes('/academyChapterVersions/')).length, 1)
  assert.equal(reads.length, 5, 'actor, root, selected chapter, candidate and current proposal pointer')
  assert.deepEqual(f.root(), root)
  assert.equal(f.chapterCount(), 20)
  assert.equal(f.candidate(proposed.candidateId).artifact.source.unit.chapter, 3)
  const before = JSON.stringify([...f.store])
  assert.equal((await f.prepare()).duplicate, true)
  assert.equal(JSON.stringify([...f.store]), before)
  assert.equal(f.reviewHead(proposed.candidateId), undefined, 'compiler never self-approves')
})

test('authorization precedes private source loads and admins cannot self-grant scientific review', async () => {
  const f = await academyAdoptionFixture(), originalLoads = f.loads.length
  f.store.set('users/student', { role: 'student' })
  await unchanged(f, () => f.adoption.mutate(f.command({ action: 'prepare', chapter: 3, expectedRevision: 3 }, 'student')), 'permission-denied')
  assert.equal(f.loads.length, originalLoads)
  const { candidateId } = await f.prepare()
  await unchanged(f, () => f.adoption.mutate(f.command(f.reviewInput(candidateId))), 'permission-denied')
  await unchanged(f, () => f.adoption.readCandidate(f.request({ adoptionCandidate: { courseId: 'course', candidateId } }, 'student')), 'permission-denied')
  await unchanged(f, () => f.adopt(candidateId), 'failed-precondition')
  assert.equal(f.store.has('academyScientificReviewers/admin'), false)
  await unchanged(f, () => f.adoption.mutate(f.command({ action: 'prepare', chapter: 3, expectedRevision: 3, expectedActorId: 'different-session' })), 'permission-denied')
})

test('explicit latest-proposal reads are scoped to one chapter and do not list private content', async () => {
  const f = await academyAdoptionFixture()
  const request = (chapter) => f.request({ adoptionCandidate: { courseId: 'course', chapter } })
  const empty = await f.adoption.readCandidate(request(3))
  assert.equal(empty.candidateId, null)
  assert.equal(empty.courseRevision, 3)
  assert.equal(f.reads.at(-1).length, 3, 'actor, root and one known pointer; no chapter or bank reads')
  const { candidateId } = await f.prepare()
  const latest = await f.adoption.readCandidate(request(3))
  assert.equal(latest.candidateId, candidateId)
  assert.equal(latest.artifact.chapter, 3)
  assert.equal(f.reads.at(-1).some((path) => path.includes('/academyChapterVersions/')), false)
  assert.equal((await f.adoption.readCandidate(request(4))).candidateId, null)
})

test('review requires scoped active qualification, explicit four-part checks, useful notes and the current review revision', async () => {
  const f = await academyAdoptionFixture(), { candidateId } = await f.prepare()
  for (const patch of [{ enabled: false }, { qualificationVerified: false }, { chapters: [4] }, { scope: 'unrelated' },
    { qualificationReference: '' }, { validUntil: Timestamp.fromMillis(1000) }]) {
    f.grant(); Object.assign(f.store.get('academyScientificReviewers/editor'), patch)
    await unchanged(f, () => f.review(candidateId), 'permission-denied')
  }
  f.grant()
  for (const patch of [{ notes: 'OK' }, { checks: { content: true, assessment: true, references: true, safety: false } }]) {
    await unchanged(f, () => f.review(candidateId, patch), 'invalid-argument')
  }
  const result = await f.review(candidateId)
  assert.equal(result.review.revision, 1)
  const before = JSON.stringify([...f.store])
  assert.equal((await f.review(candidateId)).duplicate, true)
  assert.equal(JSON.stringify([...f.store]), before)
  await unchanged(f, () => f.review(candidateId, { notes: 'Một kết quả duyệt khác cần dựa trên revision đã tải mới nhất.' }), 'aborted')
  await f.review(candidateId, { expectedReviewRevision: 1, decision: 'withdrawn' })
  assert.equal(f.reviewHead(candidateId).revision, 2)
  assert.ok(f.store.has(`courses/course/academyReviewHistory/${candidateId}_000001`))
  await unchanged(f, () => f.adopt(candidateId, { expectedReviewRevision: 2 }), 'failed-precondition')
})

test('adoption writes exactly one new draft chapter, retaining the other nineteen, immutable history, live snapshot and learner progress', async () => {
  const f = await academyAdoptionFixture({ allChapters: true }), { candidateId } = await f.reviewed()
  const root = clone(f.root()), proposed = clone(f.candidate(candidateId))
  f.store.set('users/student/progress/course', { completedLessonIds: ['chapter-03-core'], practiceSubmissionVersions: { 'chapter-03-core': 1 } })
  const beforeProgress = clone(f.store.get('users/student/progress/course'))
  const result = await f.adopt(candidateId)
  assert.equal(result.revision, 4); assert.equal(result.status, 'draft'); assert.equal(result.publishedRevision, 3)
  assert.equal(f.chapterCount(), 21)
  assert.deepEqual(f.root().publishedSnapshot, root.publishedSnapshot)
  assert.deepEqual(f.root().modules.filter((module) => module.order !== 3), root.modules.filter((module) => module.order !== 3))
  assert.deepEqual(f.store.get('users/student/progress/course'), beforeProgress)
  assert.deepEqual(f.candidate(candidateId), proposed)
  assert.deepEqual(f.root().academyReviewRequiredModuleIds, ['nutrition-chapter-03'])
  assert.equal(f.root().modules[2].academyAdoption.candidateId, candidateId)
  const before = JSON.stringify([...f.store])
  assert.equal((await f.adopt(candidateId, { expectedRevision: 3 })).alreadyAdopted, true)
  assert.equal(JSON.stringify([...f.store]), before, 'network retry does not create another revision')
  const editor = await f.readEditor(4)
  assert.equal(editor.modules[2].academyAdoption.candidateId, candidateId)
  editor.publicationStatus = 'review'
  await f.handlers.save(f.request({ course: editor, expectedRevision: 4 }))
  await f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 5, nextStatus: 'approved' }))
  await f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 6, nextStatus: 'published' }))
  assert.equal(f.root().publishedSnapshot.course.revision, 7)
  assert.equal(f.chapterCount(), 21, 'workflow transitions and exact saves reuse reviewed chapter bytes')
})

test('stale course, changed chapter, changed private keys, damaged candidates or stale approval cannot be adopted', async () => {
  for (const kind of ['revision', 'text', 'answer', 'candidate', 'approval']) {
    const f = await academyAdoptionFixture({ publish: false }), { candidateId } = await f.reviewed()
    let expectedRevision = f.root().revision
    if (['revision', 'text', 'answer'].includes(kind)) {
      const editor = await f.readEditor(expectedRevision); editor.publicationStatus = 'draft'
      if (kind === 'text') editor.modules[0].lessons[0].summary += ' Đã biên tập.'
      if (kind === 'answer') {
        const answers = editor.quizAnswerKeys['chapter-03-checkpoint'], id = Object.keys(answers)[0]
        answers[id] = [(answers[id][0] + 1) % 4]
      }
      await f.handlers.save(f.request({ course: editor, expectedRevision }))
      if (kind !== 'revision') expectedRevision = f.root().revision
    } else if (kind === 'candidate') f.candidate(candidateId).artifact.module.title += ' Modified'
    else await f.review(candidateId, { expectedReviewRevision: 1, notes: 'Đã rà soát lại nguồn và giữ kết luận trong lần kiểm thử thứ hai.' })
    await unchanged(f, () => f.adopt(candidateId, { expectedRevision }), kind === 'candidate' ? 'failed-precondition' : 'aborted')
  }
})

test('revoked or expired reviewer rights are rechecked during adoption and before publication, including transaction retries', async () => {
  for (const stage of ['review', 'adopt', 'publish']) {
    const f = await academyAdoptionFixture(), { candidateId } = await f.prepare(); f.grant()
    if (stage !== 'review') await f.review(candidateId)
    if (stage === 'publish') {
      await f.adopt(candidateId)
      const editor = await f.readEditor(4); editor.publicationStatus = 'review'
      await f.handlers.save(f.request({ course: editor, expectedRevision: 4 }))
      await f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 5, nextStatus: 'approved' }))
    }
    const originalRoot = clone(f.root())
    f.retryOnce(() => { f.store.get('academyScientificReviewers/editor').enabled = false })
    const operation = stage === 'review' ? () => f.review(candidateId) : stage === 'adopt' ? () => f.adopt(candidateId)
      : () => f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 6, nextStatus: 'published' }))
    await assert.rejects(operation(), { code: stage === 'review' ? 'permission-denied' : 'failed-precondition' })
    assert.deepEqual(f.root(), originalRoot)
    assert.equal([...f.store.keys()].some((path) => path.startsWith('courseRevisions/course_000007')), false)
  }
  const f = await academyAdoptionFixture(), { candidateId } = await f.reviewed()
  for (const mutate of [
    () => { f.store.get('academyScientificReviewers/editor').validUntil = Timestamp.fromMillis(1000) },
    () => { f.store.get('academyScientificReviewers/editor').revision = 2 },
    () => { f.store.get('users/editor').disabled = true },
  ]) {
    f.grant(); f.store.get('users/editor').disabled = false; mutate()
    await unchanged(f, () => f.adopt(candidateId), 'failed-precondition')
  }
})

test('editing reviewed content or keys, dropping approval stamps or forging an empty policy cannot bypass publication checks', async () => {
  for (const kind of ['text', 'answer', 'stamp', 'moved-lessons']) {
    const f = await academyAdoptionFixture(), { candidateId } = await f.reviewed(); await f.adopt(candidateId)
    const editor = await f.readEditor(4); editor.publicationStatus = 'draft'; editor.academyReviewRequiredModuleIds = []
    if (kind === 'text') editor.modules[0].lessons[0].primaryContent.body += '\n\nChanged after scientific review.'
    if (kind === 'answer') {
      const answers = editor.quizAnswerKeys['chapter-03-checkpoint'], id = Object.keys(answers)[0]
      answers[id] = [(answers[id][0] + 1) % 4]
    }
    if (kind === 'stamp') delete editor.modules[0].academyAdoption
    if (kind === 'moved-lessons') {
      delete editor.modules[0].academyAdoption
      editor.modules[0].id = 'renamed-to-avoid-review'
    }
    await f.handlers.save(f.request({ course: editor, expectedRevision: 4 }))
    assert.deepEqual(f.root().academyReviewRequiredModuleIds, ['nutrition-chapter-03'])
    editor.publicationStatus = 'review'
    await unchanged(f, () => f.handlers.save(f.request({ course: editor, expectedRevision: 5 })), 'failed-precondition')
    assert.equal(f.root().publishedSnapshot.course.revision, 3)
  }
})

test('restoring a pre-adoption revision retains review requirements; removing a chapter is allowed without erasing its requirement', async () => {
  const f = await academyAdoptionFixture({ allChapters: true }), { candidateId } = await f.reviewed(); await f.adopt(candidateId)
  await f.handlers.restore(f.request({ courseId: 'course', revision: 1, expectedRevision: 4 }))
  assert.deepEqual(f.root().academyReviewRequiredModuleIds, ['nutrition-chapter-03'])
  const editor = await f.readEditor(5); editor.publicationStatus = 'review'
  await unchanged(f, () => f.handlers.save(f.request({ course: editor, expectedRevision: 5 })), 'failed-precondition')
  editor.modules = editor.modules.filter((module) => module.id !== 'nutrition-chapter-03')
  await f.handlers.save(f.request({ course: editor, expectedRevision: 5 }))
  await f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 6, nextStatus: 'approved' }))
  assert.deepEqual(f.root().academyReviewRequiredModuleIds, ['nutrition-chapter-03'])
  f.store.get('academyScientificReviewers/editor').enabled = false
  await f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 7, nextStatus: 'archived' }))
  assert.equal(f.root().publishedSnapshot.active, false, 'taking unsafe content offline never requires a valid approval')
})

test('staff candidate reads expose exact source and assessment with current approval status, not reviewer grant credentials', async () => {
  const f = await academyAdoptionFixture(), { candidateId } = await f.reviewed()
  const request = f.request({ adoptionCandidate: { courseId: 'course', candidateId } }, 'editor')
  const result = await f.adoption.readCandidate(request)
  assert.equal(result.canReview, true); assert.equal(result.approvalValid, true)
  assert.equal(result.artifact.checkpointQuestions.length, 8)
  assert.equal(result.artifact.source.unit.chapter, 3)
  assert.equal(result.review.requestHash, undefined)
  assert.equal(JSON.stringify(result).includes('TEST FIXTURE'), false)
  await f.adopt(candidateId)
  assert.equal((await f.adoption.readCandidate(request)).alreadyAdopted, true)
  const editor = await f.readEditor(4); editor.publicationStatus = 'draft'
  editor.modules[0].lessons[0].summary += ' Changed after adoption.'
  await f.handlers.save(f.request({ course: editor, expectedRevision: 4 }))
  assert.equal((await f.adoption.readCandidate(request)).alreadyAdopted, false, 'a retained stamp alone does not mean exact adopted content')
  f.store.get('academyScientificReviewers/editor').enabled = false
  const revoked = await f.adoption.readCandidate(request)
  assert.equal(revoked.canReview, false); assert.equal(revoked.approvalValid, false)
})

test('adoption captures a versioned live root without an existing snapshot, but never automatically migrates legacy content', async () => {
  const f = await academyAdoptionFixture(), { candidateId } = await f.reviewed()
  delete f.root().publishedSnapshot
  const live = f.storage.manifestOf(f.root())
  await f.adopt(candidateId)
  assert.deepEqual(f.root().publishedSnapshot, { active: true, course: live })
  const g = await academyAdoptionFixture()
  delete g.root().contentStorage
  await unchanged(g, () => g.prepare(), 'failed-precondition')
  assert.equal(g.loads.length, 0)
})

test('existing production callables route explicit adoption commands without adding functions or changing learner catalog requests', async () => {
  const f = await academyAdoptionFixture()
  const source = readFileSync(require.resolve('./index'), 'utf8')
  const callback = (name) => { const start = source.indexOf(`exports.${name} =`); return source.slice(start, source.indexOf('\n})', start) + 3) }
  const context = { exports: {}, onCall: (_config, handler) => handler, academyLearnerRuntime: {}, HttpsError: f.HttpsError,
    requireCaller: (request) => request.auth.uid, academyDraftAdoption: f.adoption, academyAuthoring: f.handlers }
  runInNewContext([callback('saveCourseDraftAtomic'), callback('listAcademyCourses')].join('\n'), context)
  const prepared = await context.exports.saveCourseDraftAtomic(f.command({ action: 'prepare', chapter: 3, expectedRevision: 3 }))
  const read = await context.exports.listAcademyCourses(f.request({ adoptionCandidate: { courseId: 'course', candidateId: prepared.candidateId } }))
  assert.equal(read.artifact.chapter, 3)
  const ambiguous = f.command({ action: 'prepare', chapter: 3, expectedRevision: 3 }); ambiguous.data.course = f.input
  await assert.rejects(context.exports.saveCourseDraftAtomic(ambiguous), { code: 'invalid-argument' })
})
