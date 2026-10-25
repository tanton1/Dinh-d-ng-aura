'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { academyRuntimeFixture } = require('./test-support/academy-runtime-fixture')
const chapterRequest = (plan, lessonId = 'lesson') => ({ auth: { token: { role: 'student' } },
  data: { chapter: true, courseId: 'course', lessonId, ...(plan ? { chapterVersion: plan.manifest.modules[0].contentVersion } : {}) } })

test('light catalog returns the active published manifest without reading any chapter or private key', async () => {
  const f = academyRuntimeFixture()
  const plan = f.versioned()
  f.store.get('courses/course').status = 'draft'
  f.store.get('courses/course').title = 'Unpublished edit'
  const result = await f.list({ auth: { token: { role: 'student' } }, data: { catalogOnly: true } })
  assert.equal(result.courses.length, 1)
  assert.equal(result.courses[0].title, 'Course')
  assert.equal(result.courses[0].contentDelivery, 'catalog')
  assert.equal(result.courses[0].modules[0].contentVersion, plan.manifest.modules[0].contentVersion)
  assert.equal(result.courses[0].modules[0].lessons[1].contentVersion, plan.manifest.modules[0].contentVersion)
  assert.equal(f.transactionReads[0].some((path) => path.includes('/academyChapterVersions/') || path.includes('/quizKeys/')), false)
  assert.doesNotMatch(JSON.stringify(result), /Unpublished edit|Public chapter|Private feedback|"quiz"|"answers"|"chapterRefs"|"contentHash"/)
})

test('rolling-client full catalog hydrates authorized published chapters and still strips private material', async () => {
  const f = academyRuntimeFixture()
  const plan = f.versioned()
  const request = { auth: { token: { role: 'student' } }, data: {} }
  const result = await f.list(request)
  assert.equal(result.courses[0].contentDelivery, 'full')
  assert.equal(result.courses[0].modules[0].lessons[0].summary, 'Public chapter')
  assert.equal(result.courses[0].modules[0].lessons[1].contentVersion, plan.manifest.modules[0].contentVersion)
  assert.equal(f.transactionReads[0].filter((path) => path.includes('/academyChapterVersions/')).length, 1)
  assert.doesNotMatch(JSON.stringify(result), /"quizKeys"|"answers"|"correctIndex"|Private feedback|Private notes|"chapterRefs"|"contentHash"/)
  f.store.delete('enrollments/student_course')
  const preview = await f.list(request)
  assert.equal(preview.courses[0].modules[0].lessons[1].quiz, undefined)
  assert.equal(preview.courses[0].modules[0].lessons[0].summary, 'Public chapter')
  f.store.get('courses/course').publishedSnapshot.active = false
  assert.equal((await f.list(request)).courses.length, 0)
})

test('catalog authorization is rechecked on a transaction retry before returning any content', async () => {
  const f = academyRuntimeFixture()
  f.versioned()
  f.retryOnce(() => f.store.get('users/student').disabled = true)
  await assert.rejects(f.list({ auth: { token: { role: 'student' } }, data: {} }), { code: 'permission-denied' })
  f.store.delete('users/student')
  await assert.rejects(f.list({ auth: { token: { role: 'student' } }, data: { catalogOnly: true } }), { code: 'permission-denied' })
})

test('staff draft preview reads only its selected authoring chapter without exposing quiz keys', async () => {
  const f = academyRuntimeFixture(); const plan = f.versioned()
  const root = f.store.get('courses/course'); root.status = 'draft'; delete root.publishedSnapshot
  f.store.get('users/student').role = 'editor'
  const request = { auth: { token: { role: 'editor' } }, data: { authoringChapter: true, courseId: 'course', lessonId: 'lesson',
    courseRevision: 1, chapterVersion: plan.manifest.modules[0].contentVersion } }
  const result = await f.list(request)
  assert.equal(result.contentAccess, 'staff-preview')
  assert.equal(result.module.lessons[0].summary, 'Public chapter')
  assert.equal(f.transactionReads[0].length, 3)
  assert.doesNotMatch(JSON.stringify(result), /Private feedback|"correctIndex"|"quizKeys"|"contentHash"/)
  await assert.rejects(f.list({ ...request, data: { ...request.data, courseRevision: 0 } }), { code: 'aborted' })
  f.store.get('users/student').role = 'student'
  await assert.rejects(f.list(request), { code: 'permission-denied' })
})

test('legacy selected delivery also rejects an explicitly stale catalog revision', async () => {
  const f = academyRuntimeFixture()
  await assert.rejects(f.list({ ...chapterRequest(), data: { ...chapterRequest().data, courseRevision: 0 } }), { code: 'aborted' })
  const result = await f.list({ ...chapterRequest(), data: { ...chapterRequest().data, courseRevision: 1 } })
  assert.equal(result.contentAccess, 'full')
})

test('one selected chapter is authorized with three current-state reads plus one chapter read', async () => {
  const f = academyRuntimeFixture()
  const plan = f.versioned()
  const result = await f.list(chapterRequest(plan))
  assert.equal(result.chapterVersion, plan.manifest.modules[0].contentVersion)
  assert.equal(result.module.id, 'module')
  assert.equal(result.module.lessons[1].quiz.questions.length, 2)
  assert.equal(result.module.lessons[0].summary, 'Public chapter')
  assert.equal(f.transactionReads[0].length, 4)
  assert.equal(f.transactionReads[0].filter((path) => path.includes('/academyChapterVersions/')).length, 1)
  assert.doesNotMatch(JSON.stringify(result), /"quizKeys"|"answers"|"correctIndex"|Private feedback|Another explanation|Private notes|Private provenance|"chapterRefs"|"contentHash"/)
})

test('legacy published courses use the same safe projection without chapter or answer-key reads', async () => {
  const f = academyRuntimeFixture()
  const result = await f.list(chapterRequest())
  assert.equal(result.chapterVersion, null)
  assert.equal(result.module.lessons[1].quiz.questions.length, 2)
  assert.equal(f.transactionReads[0].length, 3)
  assert.doesNotMatch(JSON.stringify(result), /Private feedback|Another explanation|Private notes|Private provenance/)
})

test('non-enrolled preview returns preview content only; an enrolled preview reader still sees its authorized chapter', async () => {
  const f = academyRuntimeFixture()
  const plan = f.versioned()
  const full = await f.list(chapterRequest(plan, 'reading'))
  assert.ok(full.module.lessons[1].quiz)
  f.store.delete('enrollments/student_course')
  const preview = await f.list(chapterRequest(plan, 'reading'))
  assert.equal(preview.module.lessons[0].summary, 'Public chapter')
  assert.equal(preview.module.lessons[1].quiz, undefined)
  assert.equal(preview.module.lessons[1].title, 'Quiz')
  await assert.rejects(f.list(chapterRequest(plan)), { code: 'failed-precondition' })
  assert.equal(f.transactionReads.at(-1).length, 3, 'no chapter read after access denial')
})

test('cancelled, inconsistent, disabled and insufficient membership states fail before reading protected content', async () => {
  for (const revoke of [
    (f) => { f.store.get('users/student').disabled = true },
    (f) => { f.store.get('enrollments/student_course').status = 'cancelled' },
    (f) => { f.store.get('enrollments/student_course').userId = 'another-student' },
    (f) => { f.store.get('enrollments/student_course').courseId = 'another-course' },
    (f) => { f.store.get('courses/course').publishedSnapshot.course.settings.accessTier = 'pro' },
  ]) {
    const f = academyRuntimeFixture()
    const plan = f.versioned()
    revoke(f)
    await assert.rejects(f.list(chapterRequest(plan)))
    assert.equal(f.transactionReads[0].length, 3)
  }
})

test('private previews and forged staff roles cannot bypass enrollment', async () => {
  const f = academyRuntimeFixture()
  f.course.settings.visibility = 'private'
  const plan = f.versioned()
  f.store.delete('enrollments/student_course')
  f.store.get('users/student').role = 'admin'
  await assert.rejects(f.list(chapterRequest(plan, 'reading')), { code: 'failed-precondition' })
  const trusted = chapterRequest(plan, 'reading')
  trusted.auth.token.role = 'admin'
  const allowed = await f.list(trusted)
  assert.ok(allowed.module.lessons[1].quiz)
  assert.doesNotMatch(JSON.stringify(allowed), /"answers"|Private feedback/)
})

test('weekly drip stays enforced for later chapters, while public previews remain filtered', async () => {
  const f = academyRuntimeFixture()
  f.course.settings.dripSchedule = 'weekly'
  f.course.modules.unshift({ id: 'intro', title: 'Intro', order: 0, lessons: [{ id: 'intro-reading', title: 'Intro', type: 'Bài đọc', duration: '5 phút' }] })
  f.store.get('enrollments/student_course').enrolledAt = { toMillis: () => Date.now() }
  const plan = f.versioned()
  const input = chapterRequest(plan)
  input.data.chapterVersion = plan.manifest.modules[1].contentVersion
  await assert.rejects(f.list(input), { code: 'failed-precondition' })
  assert.equal(f.transactionReads[0].length, 3)
  input.data.lessonId = 'reading'
  const preview = await f.list(input)
  assert.equal(preview.module.lessons[1].quiz, undefined)
})

test('editing a separate draft cannot replace live content; explicit archive immediately prevents reads', async () => {
  const f = academyRuntimeFixture()
  const live = f.versioned()
  f.course.modules[0].lessons[0].summary = 'Unpublished replacement'
  f.course.status = 'draft'
  f.course.revision = 2
  const draft = f.versioned()
  f.store.get('courses/course').publishedSnapshot = { active: true, course: live.manifest }
  const published = await f.list(chapterRequest(live))
  assert.equal(published.courseRevision, 1)
  assert.equal(published.module.lessons[0].summary, 'Public chapter')
  await assert.rejects(f.list(chapterRequest(draft)), { code: 'aborted' })
  f.store.get('courses/course').publishedSnapshot.active = false
  await assert.rejects(f.list(chapterRequest(live)), { code: 'not-found' })
})

test('missing, mismatched or stale chapter never returns an empty successful lesson', async () => {
  const f = academyRuntimeFixture()
  const plan = f.versioned()
  await assert.rejects(f.list(chapterRequest()), { code: 'aborted' })
  assert.equal(f.transactionReads.at(-1).length, 3)
  f.store.delete(plan.chapters[0].path)
  await assert.rejects(f.list(chapterRequest(plan)), { code: 'failed-precondition' })
  assert.equal(f.transactionReads.at(-1).length, 4)
})

test('read retries recheck revocation instead of returning the first authorized result', async () => {
  const f = academyRuntimeFixture()
  const plan = f.versioned()
  f.retryOnce(() => { f.store.get('enrollments/student_course').status = 'cancelled' })
  await assert.rejects(f.list(chapterRequest(plan)), { code: 'failed-precondition' })
  assert.equal(f.transactionReads.length, 2)
  assert.equal(f.transactionReads[1].length, 3)
})
