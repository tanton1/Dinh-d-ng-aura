'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { academyAuthoringFixture } = require('./test-support/academy-authoring-fixture')
const clone = (value) => JSON.parse(JSON.stringify(value))

test('old or unknown editor protocols cannot save, restore or publish before any document reads or writes', async () => {
  for (const protocol of [undefined, null, 'legacy', 'chapters-v2']) {
    const f = academyAuthoringFixture()
    const before = JSON.stringify([...f.store])
    for (const [action, data] of [
      ['save', { course: f.input, expectedRevision: 0 }],
      ['transition', { courseId: 'course', expectedRevision: 1, nextStatus: 'published' }],
      ['restore', { courseId: 'course', expectedRevision: 1, revision: 1 }],
    ]) {
      await assert.rejects(f.handlers[action](f.request({ ...data, academyAuthoringProtocol: protocol })),
        (error) => error.code === 'failed-precondition' && /tải lại trang/.test(error.message))
    }
    assert.equal(JSON.stringify([...f.store]), before)
    assert.equal(f.reads.length, 0)
  }
})

test('the real authoring normalizer preserves bespoke practice rubrics and rejects incomplete or duplicated criteria', () => {
  const { academyAuthoringValidation } = require('./test-support/academy-template-fixture')
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }
  const normalize = academyAuthoringValidation(HttpsError).normalizeCourseDraftInput
  const input = clone(require('./generated/academy-course-template.cjs').auraFoundationCourse)
  input.modules = [input.modules[0]]
  const practice = input.modules[0].lessons[0].learningDesign.practice
  const rubric = { version: 2, criteria: ['data', 'mechanism', 'feasibility', 'safety'].map((id) => ({ id, label: `Tiêu chí ${id}`, levels: ['Cần sửa', 'Một phần', 'Đủ yêu cầu riêng'] })) }
  practice.reviewRubric = rubric
  assert.deepEqual(clone(normalize(input).course.modules[0].lessons[0].learningDesign.practice.reviewRubric), rubric)
  const originalIdentity = normalize(input).course.modules[0].lessons[0].learningDesign.practice.identityHash
  assert.match(originalIdentity, /^[a-f0-9]{64}$/)
  practice.identityHash = 'forged'
  assert.equal(normalize(input).course.modules[0].lessons[0].learningDesign.practice.identityHash, originalIdentity)
  practice.fields[0].prompt += ' Updated criteria.'
  assert.notEqual(normalize(input).course.modules[0].lessons[0].learningDesign.practice.identityHash, originalIdentity)
  for (const invalid of [
    { ...rubric, version: 0 }, { ...rubric, criteria: rubric.criteria.slice(1) },
    { ...rubric, criteria: [rubric.criteria[0], rubric.criteria[0], ...rubric.criteria.slice(2)] },
    { ...rubric, criteria: rubric.criteria.map((row) => ({ ...row, levels: [] })) },
  ]) {
    practice.reviewRubric = invalid
    assert.throws(() => normalize(input), { code: 'invalid-argument' })
  }
})

async function publishedFixture() {
  const f = academyAuthoringFixture()
  f.input.publicationStatus = 'review'
  await f.handlers.save(f.request({ course: f.input, expectedRevision: 0 }))
  await f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 1, nextStatus: 'approved' }))
  await f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 2, nextStatus: 'published' }))
  return f
}

test('atomic save writes lightweight manifest/revision plus private immutable chapters and audit, never mutable answer keys', async () => {
  const f = academyAuthoringFixture()
  const result = await f.handlers.save(f.request({ course: f.input, expectedRevision: 0 }))
  assert.equal(result.revision, 1)
  assert.equal(f.chapterCount(), 2)
  const root = f.store.get('courses/course')
  assert.equal(root.contentStorage, 'chapters-v1')
  const revision = f.store.get('courseRevisions/course_000001')
  assert.deepEqual(revision.course, f.storage.manifestOf(root))
  assert.equal(revision.quizKeys, undefined)
  assert.doesNotMatch(JSON.stringify(root), /Nội dung 1|"correctIndex"|"answers"/)
  assert.equal([...f.store.keys()].some((path) => path.includes('/quizKeys/')), false)
  assert.ok([...f.store.values()].some((data) => data.action === 'course.created'))
  assert.deepEqual(f.reads[0], ['users/admin', 'courses/course'])
  const full = await f.readEditor(1)
  assert.equal(full.modules[0].lessons[0].summary, 'Nội dung 1')
  assert.deepEqual(full.quizAnswerKeys['quiz-1'], { 'q-1': [0] })
  assert.equal(full.modules[0].contentVersion, undefined)
})

test('complete-key saves reuse unchanged chapters with only actor/root reads; a changed chapter adds one version', async () => {
  const f = academyAuthoringFixture()
  await f.handlers.save(f.request({ course: f.input, expectedRevision: 0 }))
  await f.handlers.save(f.request({ course: f.input, expectedRevision: 1 }))
  assert.equal(f.chapterCount(), 2)
  assert.deepEqual(f.reads.at(-1), ['users/admin', 'courses/course'])
  f.input.modules[0].lessons[0].summary = 'Sửa nội dung chương 1'
  await f.handlers.save(f.request({ course: f.input, expectedRevision: 2 }))
  assert.equal(f.chapterCount(), 3)
  assert.equal(f.store.get('courseRevisions/course_000001').course.modules[0].contentVersion.startsWith('r1_'), true)
  assert.equal(f.store.get('courses/course').modules[1].contentVersion.startsWith('r1_'), true)
})

test('catalog stubs fail before normalization, and stale expected revisions leave all documents intact', async () => {
  const f = academyAuthoringFixture()
  await f.handlers.save(f.request({ course: f.input, expectedRevision: 0 }))
  const before = JSON.stringify([...f.store])
  const stub = { ...f.input, modules: f.store.get('courses/course').modules }
  await assert.rejects(f.handlers.save(f.request({ course: stub, expectedRevision: 1 })), { code: 'failed-precondition' })
  await assert.rejects(f.handlers.save(f.request({ course: f.input, expectedRevision: 0 })), { code: 'aborted' })
  assert.equal(JSON.stringify([...f.store]), before)
})

test('publication transitions require the full workflow and reuse chapter versions', async () => {
  const f = await publishedFixture()
  assert.equal(f.chapterCount(), 2)
  assert.equal(f.store.get('courses/course').publishedSnapshot.course.revision, 3)
  await assert.rejects(f.handlers.save(f.request({ course: f.input, expectedRevision: 3 })), { code: 'failed-precondition' })
  await assert.rejects(f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 3, nextStatus: 'scheduled' })), { code: 'failed-precondition' })
  await assert.rejects(f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 3, nextStatus: 'archived' }, 'editor')), { code: 'permission-denied' })
})

test('restore and draft edits keep the exact live snapshot until a newly reviewed revision is published', async () => {
  const f = await publishedFixture()
  const live = clone(f.store.get('courses/course').publishedSnapshot)
  const firstRevision = clone(f.store.get('courseRevisions/course_000001'))
  f.store.set('users/student/progress/course', { completedLessonIds: ['reading-1'], percent: 17 })
  await f.handlers.restore(f.request({ courseId: 'course', revision: 1, expectedRevision: 3 }))
  assert.deepEqual(f.store.get('courses/course').publishedSnapshot, live)
  assert.equal(f.chapterCount(), 2)
  const draft = await f.readEditor(4)
  draft.modules[0].lessons[0].summary = 'Bản mới chờ duyệt'
  await f.handlers.save(f.request({ course: draft, expectedRevision: 4 }))
  assert.deepEqual(f.store.get('courses/course').publishedSnapshot, live)
  draft.publicationStatus = 'review'
  await f.handlers.save(f.request({ course: draft, expectedRevision: 5 }))
  await f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 6, nextStatus: 'approved' }))
  assert.deepEqual(f.store.get('courses/course').publishedSnapshot, live)
  await f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 7, nextStatus: 'published' }))
  assert.equal(f.store.get('courses/course').publishedSnapshot.course.revision, 8)
  assert.equal(f.chapterCount(), 3)
  assert.deepEqual(f.store.get('courseRevisions/course_000001'), firstRevision)
  assert.deepEqual(f.store.get('users/student/progress/course'), { completedLessonIds: ['reading-1'], percent: 17 })
})

test('taking the live course offline while editing preserves draft state and cannot bypass approval', async () => {
  const f = await publishedFixture()
  await f.handlers.restore(f.request({ courseId: 'course', revision: 1, expectedRevision: 3 }))
  const result = await f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 4, nextStatus: 'archived' }))
  assert.equal(result.status, 'draft')
  assert.equal(result.publishedRevision, null)
  assert.equal(f.storage.publishedCourse(f.store.get('courses/course')), null)
  assert.deepEqual(f.reads.at(-1), ['users/admin', 'courses/course'])
  await assert.rejects(f.handlers.transition(f.request({ courseId: 'course', expectedRevision: 5, nextStatus: 'published' })), { code: 'failed-precondition' })
  await f.handlers.restore(f.request({ courseId: 'course', revision: 3, expectedRevision: 5 }))
  assert.equal(f.storage.publishedCourse(f.store.get('courses/course')), null, 'restoring published history must not reactivate an archived live course')
})

test('legacy restore snapshots live keys before replacing authoring, and does not mutate legacy key documents', async () => {
  const f = academyAuthoringFixture()
  const normalized = f.validation.normalizeCourseDraftInput(f.input)
  const source = { ...clone(normalized.course), status: 'published', revision: 5, createdAt: 'created', createdBy: 'admin', firstPublishedAt: 'original-publication' }
  const quizKeys = Object.fromEntries([...normalized.quizDefinitions].map(([id, quiz]) => [id, {
    quizId: quiz.id, answers: normalized.answerCandidates.get(id), questionCount: quiz.questions.length, passPercent: quiz.passPercent,
  }]))
  f.store.set('courses/course', source)
  f.store.set('courseRevisions/course_000002', { courseId: 'course', revision: 2, course: { ...clone(source), status: 'draft' }, quizKeys })
  for (const [id, key] of Object.entries(quizKeys)) f.store.set(`courses/course/quizKeys/${id}`, clone(key))
  await f.handlers.restore(f.request({ courseId: 'course', revision: 2, expectedRevision: 5 }))
  const root = f.store.get('courses/course')
  assert.equal(root.revision, 6)
  assert.equal(root.firstPublishedAt, 'original-publication')
  assert.equal(root.publishedSnapshot.course.revision, 5)
  assert.equal(root.publishedSnapshot.course.status, 'published')
  assert.equal(f.chapterCount(), 2)
  assert.deepEqual(f.store.get('courses/course/quizKeys/quiz-1'), clone(quizKeys['quiz-1']))
})

test('missing answers are inherited only for unchanged questions; explicit clearing and changed options stay incomplete', async () => {
  const f = academyAuthoringFixture()
  await f.handlers.save(f.request({ course: f.input, expectedRevision: 0 }))
  const draft = await f.readEditor(1)
  delete draft.quizAnswerKeys
  await f.handlers.save(f.request({ course: draft, expectedRevision: 1 }))
  assert.deepEqual((await f.readEditor(2)).quizAnswerKeys['quiz-1'], { 'q-1': [0] })
  draft.modules[0].lessons[2].quiz.questions[0].options.reverse()
  await f.handlers.save(f.request({ course: draft, expectedRevision: 2 }))
  const changed = await f.readEditor(3)
  assert.deepEqual(changed.quizAnswerKeys['quiz-1'], {})
  draft.publicationStatus = 'review'
  await assert.rejects(f.handlers.save(f.request({ course: draft, expectedRevision: 3 })), { code: 'failed-precondition' })
  const cleared = await f.readEditor(3)
  cleared.quizAnswerKeys['quiz-2'] = {}
  await f.handlers.save(f.request({ course: cleared, expectedRevision: 3 }))
  assert.deepEqual((await f.readEditor(4)).quizAnswerKeys['quiz-2'], {})
})

test('staff role revocation on transaction retry cannot commit a draft or publication change', async () => {
  const f = academyAuthoringFixture()
  f.retryOnce(() => { f.store.get('users/admin').disabled = true })
  await assert.rejects(f.handlers.save(f.request({ course: f.input, expectedRevision: 0 })), { code: 'permission-denied' })
  assert.equal(f.store.has('courses/course'), false)
  assert.equal(f.chapterCount(), 0)
  const p = await publishedFixture()
  p.retryOnce(() => { p.store.get('users/admin').role = 'student' })
  await assert.rejects(p.handlers.transition(p.request({ courseId: 'course', expectedRevision: 3, nextStatus: 'archived' })), { code: 'permission-denied' })
  assert.equal(p.store.get('courses/course').publishedSnapshot.active, true)
})

test('real full twenty-chapter authoring input saves above the old single-document cap and hydrates for editing', async () => {
  const f = academyAuthoringFixture()
  const input = clone(require('./generated/academy-course-template.cjs').auraFoundationCourse)
  await f.handlers.save(f.request({ course: input, expectedRevision: 0 }))
  assert.equal(f.chapterCount(), 20)
  const result = await f.handlers.readForEditor(f.request({ authoringCourseId: input.id, expectedRevision: 1 }))
  assert.equal(result.course.modules.length, 20)
  assert.ok(Buffer.byteLength(JSON.stringify(result.course)) > 1_000_000)
  assert.ok(Buffer.byteLength(JSON.stringify(f.store.get(`courses/${input.id}`))) < 30_000)
})

test('revision diff hydrates immutable chapters and omits private key changes', async () => {
  const f = academyAuthoringFixture()
  await f.handlers.save(f.request({ course: f.input, expectedRevision: 0 }))
  f.input.modules[0].lessons[0].summary = 'Nội dung đã đổi'
  f.input.modules[0].lessons[2].quiz.questions[0].correctIndex = 1
  await f.handlers.save(f.request({ course: f.input, expectedRevision: 1 }))
  const diff = await f.handlers.diff(f.request({ courseId: 'course', fromRevision: 1, toRevision: 2 }))
  assert.ok(diff.changes.some((item) => item.path.endsWith('.summary')))
  assert.doesNotMatch(JSON.stringify(diff), /"correctIndex"|"answers"|quizKeys|chapterRefs/)
  await assert.rejects(f.handlers.readForEditor(f.request({ authoringCourseId: 'course', expectedRevision: 1 })), { code: 'aborted' })
})

test('saved private key hashes exactly match production grading normalization, including default and sampled quizzes', async () => {
  const runtime = require('./test-support/academy-runtime-fixture').academyRuntimeFixture().context
  for (const sampled of [false, true]) {
    const f = academyAuthoringFixture()
    const quiz = f.input.modules[0].lessons[2].quiz
    quiz.questions.push({ id: 'q-extra', question: 'Một câu nữa?', options: ['Không', 'Có'], correctIndex: 1 })
    if (sampled) { quiz.questionOrder = 'shuffle'; quiz.publicSettings = { questionsPerAttempt: 1, maxAttempts: 3, revealMode: 'after-pass' } }
    await f.handlers.save(f.request({ course: f.input, expectedRevision: 0 }))
    const root = f.store.get('courses/course')
    const chapter = f.store.get(`courses/course/academyChapterVersions/${root.chapterRefs['module-1'].versionId}`)
    const definition = runtime.normalizeQuizQuestions(chapter.module.lessons[2])
    const answers = runtime.normalizeQuizAnswerKey(chapter.quizKeys['quiz-1'], definition)
    assert.equal(chapter.quizKeys['quiz-1'].contentHash, runtime.buildQuizContentHash(definition, answers))
  }
})

test('changed question wording cannot inherit the old answer just because its ID and options match', async () => {
  const f = academyAuthoringFixture()
  await f.handlers.save(f.request({ course: f.input, expectedRevision: 0 }))
  const editor = await f.readEditor(1)
  delete editor.quizAnswerKeys
  editor.modules[0].lessons[2].quiz.questions[0].question = 'Lựa chọn nào KHÔNG đúng?'
  await f.handlers.save(f.request({ course: editor, expectedRevision: 1 }))
  assert.deepEqual((await f.readEditor(2)).quizAnswerKeys['quiz-1'], {})
})

test('revision comparisons include changes to the real structured practice definition', async () => {
  const f = academyAuthoringFixture()
  f.input.modules[0].lessons[0].learningDesign = clone(require('./generated/academy-course-template.cjs').auraFoundationCourse.modules[0].lessons[0].learningDesign)
  await f.handlers.save(f.request({ course: f.input, expectedRevision: 0 }))
  f.input.modules[0].lessons[0].learningDesign.practice.outcome = 'Mục tiêu thực hành được cập nhật rõ ràng.'
  await f.handlers.save(f.request({ course: f.input, expectedRevision: 1 }))
  const result = await f.handlers.diff(f.request({ courseId: 'course', fromRevision: 1, toRevision: 2 }))
  assert.ok(result.changes.some((change) => change.path.endsWith('.learningDesign')))
})
