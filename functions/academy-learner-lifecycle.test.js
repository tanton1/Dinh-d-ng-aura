'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { academyRuntimeFixture } = require('./test-support/academy-runtime-fixture')
const request = (data = {}) => ({ auth: { uid: 'student', token: { role: 'student' } }, data: { courseId: 'course', ...data } })
const chunkReads = (fixture) => fixture.transactionReads.flat().filter((path) => path.includes('/academyChapterVersions/'))
const grade = (f, version) => f.grade(request({ lessonId: 'lesson', chapterVersion: version, requestId: 'request-000000000000001',
  answers: [{ questionId: 'q1', optionIndex: 0 }, { questionId: 'q2', optionIndex: 0 }] }))

test('enrollment follows the active live manifest, not an editor draft; no chapter reads', async () => {
  const f = academyRuntimeFixture()
  f.versioned()
  const root = f.store.get('courses/course')
  root.status = 'draft'
  root.settings = { ...root.settings, accessTier: 'pro' }
  f.store.delete('enrollments/student_course')
  const enrolled = await f.enroll(request())
  assert.equal(enrolled.status, 'active')
  assert.equal(chunkReads(f).length, 0)
  root.publishedSnapshot.active = false
  await assert.rejects(f.enroll(request()), { code: 'not-found' })
})

test('completion requires the displayed version, reads exactly one chapter and preserves previous progress', async () => {
  const f = academyRuntimeFixture()
  const plan = f.versioned()
  const version = plan.manifest.chapterRefs.module.versionId
  f.store.set('users/student/progress/course', { courseId: 'course', completedLessonIds: ['lesson'] })
  await assert.rejects(f.complete(request({ lessonId: 'reading' })), { code: 'aborted' })
  assert.equal(chunkReads(f).length, 0)
  const result = await f.complete(request({ lessonId: 'reading', chapterVersion: version }))
  assert.ok(result.completedLessonIds.includes('reading'))
  assert.ok(result.completedLessonIds.includes('lesson'))
  assert.equal(result.quizCompletionChapterVersions.lesson, undefined, 'manual reading does not fabricate a quiz proof')
  assert.equal(chunkReads(f).length, 1)
  assert.equal(f.transactionReads.at(-1).length, 5)
})

test('graded proof and completion bind the same immutable chapter; migrated old counters cannot strand learners', async () => {
  const f = academyRuntimeFixture()
  const old = await grade(f)
  assert.equal(old.passed, true)
  const plan = f.versioned()
  const version = plan.manifest.chapterRefs.module.versionId
  await assert.rejects(f.complete(request({ lessonId: 'lesson', chapterVersion: version })), { code: 'failed-precondition' })
  const fresh = await f.grade(request({ lessonId: 'lesson', chapterVersion: version, requestId: 'request-000000000000002',
    answers: [{ questionId: 'q1', optionIndex: 0 }, { questionId: 'q2', optionIndex: 0 }] }))
  assert.equal(fresh.passed, true)
  assert.equal(fresh.attemptsRemaining, 1)
  const result = await f.complete(request({ lessonId: 'lesson', chapterVersion: version }))
  assert.ok(result.completedLessonIds.includes('lesson'))
  assert.equal(result.quizCompletionChapterVersions.lesson, version)
  assert.equal(f.store.get('users/student/progress/course').quizCompletionChapterVersions.lesson, version)
  assert.equal(f.transactionReads.at(-1).length, 6, 'profile, manifest, enrollment, progress, one chapter and proof; no mutable key')
  assert.equal(f.transactionReads.at(-1).some((path) => path.includes('/quizKeys/')), false)
})

test('new chapter completion cannot reuse the old checkpoint version and preserves the historical record on failure', async () => {
  const f = academyRuntimeFixture(), first = f.versioned(), version = first.manifest.chapterRefs.module.versionId
  await grade(f, version)
  await f.complete(request({ lessonId: 'lesson', chapterVersion: version }))
  const updated = structuredClone(f.course)
  updated.modules[0].lessons.find((item) => item.id === 'lesson').quiz.questions[0].question = 'Updated safety wording'
  const next = f.storage.pack({ courseId: 'course', revision: 2, course: updated, quizKeys: { lesson: f.key }, priorCourse: first.manifest })
  next.chapters.forEach((item) => f.store.set(item.path, item.document))
  f.store.set('courses/course', { ...next.manifest, publishedSnapshot: { active: true, course: next.manifest } })
  await assert.rejects(f.complete(request({ lessonId: 'lesson', chapterVersion: next.manifest.chapterRefs.module.versionId })), { code: 'failed-precondition' })
  const record = f.store.get('users/student/progress/course')
  assert.equal(record.quizCompletionChapterVersions.lesson, version)
  assert.ok(record.completedLessonIds.includes('lesson'))
})

test('completion and enrollment recheck current access on retry without partial writes', async () => {
  for (const operation of ['complete', 'enroll']) {
    const f = academyRuntimeFixture()
    const plan = f.versioned()
    const version = plan.manifest.chapterRefs.module.versionId
    f.retryOnce(() => { f.store.get('users/student').disabled = true })
    await assert.rejects(f[operation](request({ lessonId: 'reading', chapterVersion: version })), { code: 'permission-denied' })
    assert.equal(f.store.has('users/student/progress/course'), false)
    assert.equal(f.store.get('enrollments/student_course').updatedAt, undefined)
  }
})

test('legacy completion stays compatible, and a new publication on transaction retry rejects stale displayed content', async () => {
  const legacy = academyRuntimeFixture()
  assert.ok((await legacy.complete(request({ lessonId: 'reading' }))).completedLessonIds.includes('reading'))
  const f = academyRuntimeFixture()
  const first = f.versioned()
  const updated = structuredClone(f.course)
  updated.modules[0].lessons[0].summary = 'New content'
  const next = f.storage.pack({ courseId: 'course', revision: 2, course: updated, quizKeys: { lesson: f.key }, priorCourse: first.manifest })
  next.chapters.forEach((item) => f.store.set(item.path, item.document))
  f.retryOnce(() => f.store.set('courses/course', { ...next.manifest, publishedSnapshot: { active: true, course: next.manifest } }))
  await assert.rejects(f.complete(request({ lessonId: 'reading', chapterVersion: first.manifest.chapterRefs.module.versionId })), { code: 'aborted' })
  assert.equal(f.store.has('users/student/progress/course'), false)
})
