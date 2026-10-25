'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const { createAcademySubmissionHandler, prepareAcademySubmission, writeAcademySubmission, headId } = require('./academy-submissions')
const { validateAcademyPracticeSubmission, academyWorkbookDocumentId } = require('./academy-practice')
const { academyPortfolioStages } = require('./generated/academy-submission-policy.cjs')
const { createAcademyCourseStorage } = require('./academy-course-storage')

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const practice = { version: 1, title: 'Quan sát có bối cảnh', fields: [
  { id: 'context', label: 'Bối cảnh', prompt: 'Nêu rõ bối cảnh', kind: 'long', required: true },
  { id: 'reviewAt', label: 'Ngày rà', prompt: '', kind: 'date', required: true },
] }
const workbookBody = (answers = { context: 'Minh chứng gốc không thay đổi khi sửa nháp.' }) => ({
  schemaVersion: 2, definitionVersion: 1, answers, reviewAt: '2026-10-24', safetyAcknowledged: true,
  rubric: { data: 2, mechanism: 2, feasibility: 2, safety: 2 },
})
const request = (action, data = {}, actor = 'coach', role = actor === 'learner' ? 'student' : 'coach') => ({
  auth: { uid: actor, token: { role } }, data: { action, userId: 'learner', courseId: 'course', artifactId: 'chapter-01-core', ...data },
})

function fixture() {
  const store = new Map([
    ['users/learner', { role: 'student' }], ['users/coach', { role: 'coach' }],
    ['coachClients/learner', { clientId: 'learner', coachId: 'coach', coachingStatus: 'active' }],
    ['enrollments/learner_course', { userId: 'learner', courseId: 'course', status: 'active' }],
    ['courses/course', { schemaVersion: 2, status: 'published', modules: Array.from({ length: 5 }, (_, index) => {
      const chapter = String(index + 1).padStart(2, '0')
      return { id: `nutrition-chapter-${chapter}`, lessons: [{ id: `chapter-${chapter}-core`, learningDesign: { practice } }, { id: `chapter-${chapter}-practice` }] }
    }) }],
  ])
  let reads = 0
  let beforeCommit = null
  const reference = (path) => ({ path, id: path.split('/').at(-1) })
  const snapshot = (path) => ({ id: path.split('/').at(-1), exists: store.has(path), data: () => store.get(path) })
  const FieldValue = { serverTimestamp: () => ({ toMillis: () => 123456 }) }
  const db = {
    doc: reference,
    collection: (path) => {
      const query = { path, query: true, maximum: 0, after: null,
        orderBy(field) { assert.equal(field, '__name__'); return this },
        limit(count) { this.maximum = count; return this },
        startAfter(id) { this.after = id; return this },
      }
      return query
    },
    runTransaction: async (run) => {
      const writes = []
      const result = await run({
        get: async (target) => {
          assert.equal(writes.length, 0, 'all reads precede any writes')
          if (target.query) {
            const paths = [...store.keys()].filter((path) => path.startsWith(target.path + '/') && path.split('/').length === target.path.split('/').length + 1)
              .sort().filter((path) => !target.after || path.split('/').at(-1) > target.after).slice(0, target.maximum)
            reads += Math.max(1, paths.length)
            return { docs: paths.map(snapshot) }
          }
          reads += 1
          return snapshot(target.path)
        },
        create: (ref, data) => { assert.equal(store.has(ref.path), false, 'immutable document cannot be overwritten'); writes.push([ref.path, data]) },
        set: (ref, data) => writes.push([ref.path, data]),
        update: (ref, data) => writes.push([ref.path, { ...store.get(ref.path), ...data }]),
      })
      if (beforeCommit) {
        const callback = beforeCommit; beforeCommit = null; callback(store)
        // Model Firestore retrying when a consent/assignment document read in the transaction changes.
        return db.runTransaction(run)
      }
      writes.forEach(([path, data]) => store.set(path, data))
      return result
    },
  }
  const handler = createAcademySubmissionHandler({ db, HttpsError, FieldValue,
    requireCaller: (req) => { if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in'); return req.auth.uid },
    requireDocumentId: (value) => { if (typeof value !== 'string' || !value || value.includes('/')) throw new HttpsError('invalid-argument', 'Bad ID'); return value },
    hasTrustedRole: (req, profile, roles) => profile.disabled !== true && profile.role === req.auth.token.role && roles.has(profile.role),
    hasCourseEntitlement: (course) => course.denied !== true, hasValidCourseAccessSettings: (course) => course.invalidSettings !== true,
    assertDripAccess: (course) => { if (course.dripLocked) throw new HttpsError('failed-precondition', 'Locked') },
  })
  const setWorkbook = (artifactId, revision = 1, body = workbookBody(), sharedWithCoach = true) => {
    store.set(`users/learner/academyWorkbooks/${academyWorkbookDocumentId('course', artifactId)}`,
      { courseId: 'course', lessonId: artifactId, revision, sharedWithCoach, body: JSON.stringify(body) })
  }
  const submitPractice = async (chapter = 1, revision = 1, body = workbookBody()) => {
    const core = `chapter-${String(chapter).padStart(2, '0')}-core`
    setWorkbook(core, revision, body)
    const validated = validateAcademyPracticeSubmission({ courseId: 'course', definition: { coreLessonId: core, design: { practice } },
      workbookDocument: store.get(`users/learner/academyWorkbooks/${academyWorkbookDocumentId('course', core)}`),
      evidence: { workbookLessonId: core, workbookRevision: revision } })
    return db.runTransaction(async (transaction) => {
      const plan = await prepareAcademySubmission({ db, transaction, HttpsError, userId: 'learner', courseId: 'course',
        artifactId: core, lessonId: core.replace('-core', '-practice'), kind: 'practice', title: practice.title, validated })
      writeAcademySubmission(transaction, plan, FieldValue)
      return plan.submissionId
    })
  }
  const review = (submissionId, overrides = {}) => handler(request('review', { submissionId, expectedReviewRevision: 0,
    scores: { data: 2, mechanism: 2, feasibility: 2, safety: 2 }, verdict: 'accepted', feedback: 'Bối cảnh rõ. Hãy giữ cách ghi nhận và rà lại vào ngày đã chọn.', ...overrides }))
  return { db, FieldValue, store, handler, submitPractice, setWorkbook, review, getReads: () => reads, resetReads: () => { reads = 0 },
    changeBeforeCommit: (callback) => { beforeCommit = callback } }
}

test('submitted answers and prompts stay immutable when a draft changes; duplicate submission preserves review', async () => {
  const f = fixture(); const id = await f.submitPractice()
  await f.review(id)
  assert.equal(await f.submitPractice(), id)
  assert.equal(f.store.get(`users/learner/academySubmissionHeads/${headId('course', 'chapter-01-core')}`).reviewStatus, 'accepted')
  f.setWorkbook('chapter-01-core', 2, workbookBody({ context: 'Nháp mới chưa nộp.' }))
  const view = await f.handler(request('read', {}, 'learner'))
  assert.match(view.submission.evidence.answers.context, /Minh chứng gốc/)
  assert.equal(view.submission.definitionSnapshot.fields[0].label, 'Bối cảnh')
  assert.equal(view.review.verdict, 'accepted')
  assert.equal([...f.store.keys()].filter((path) => path.includes('/academySubmissions/')).length, 1)
})

test('the real completion handler atomically writes immutable evidence, proof and practice progress without resetting reviews on retry', async () => {
  const f = fixture()
  f.setWorkbook('chapter-01-core')
  f.store.get('courses/course').settings = { visibility: 'members', accessTier: 'free', dripSchedule: 'none', completionPercent: 100 }
  const source = readFileSync(require.resolve('./index'), 'utf8')
  const start = source.indexOf('exports.completeCourseLesson =')
  const context = { exports: {}, onCall: (_config, callback) => callback, academyLearnerRuntime: {}, db: f.db, FieldValue: f.FieldValue,
    academyCourseStorage: createAcademyCourseStorage({ db: f.db, HttpsError }),
    HttpsError, requireCaller: (req) => req.auth.uid, requireDocumentId: (value) => value, academyStaffRoles: new Set(),
    hasTrustedRole: () => false, hasCourseEntitlement: () => true, ...require('./academy-practice'),
    prepareAcademySubmission, writeAcademySubmission, courseLessonScopedId: academyWorkbookDocumentId,
    isPlainObject: (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value)),
  }
  runInNewContext(source.slice(start, source.indexOf('\n})', start) + 3), context)
  const req = request('unused', { lessonId: 'chapter-01-practice', practiceEvidence: { workbookLessonId: 'chapter-01-core', workbookRevision: 1 } }, 'learner')
  const result = await context.exports.completeCourseLesson(req)
  assert.equal(result.practiceSubmissionRevisions['chapter-01-practice'], 1)
  assert.equal(result.practiceSubmissionDefinitionVersions['chapter-01-practice'], 1)
  assert.equal(result.practiceSubmissionDefinitionHashes['chapter-01-practice'], '')
  assert.equal(f.store.get('users/learner/progress/course').practiceSubmissionDefinitionVersions['chapter-01-practice'], 1)
  assert.equal(f.store.get(`users/learner/academySubmissions/${result.practiceSubmissionId}`).evidence.answers.context, workbookBody().answers.context)
  assert.equal(f.store.get('users/learner/courseLessonProofs/course__chapter-01-practice').submissionId, result.practiceSubmissionId)
  assert.ok(f.store.get('users/learner/progress/course').completedLessonIds.includes('chapter-01-practice'))
  await f.review(result.practiceSubmissionId)
  const replay = await context.exports.completeCourseLesson(req)
  assert.equal(replay.practiceSubmissionId, result.practiceSubmissionId)
  assert.equal(f.store.get(`users/learner/academySubmissionHeads/${headId('course', 'chapter-01-core')}`).reviewStatus, 'accepted')
})

test('bespoke practice rubric is snapshotted with the submission and the coach review binds that exact version', async () => {
  const f = fixture()
  const rubric = { version: 7, criteria: ['data', 'mechanism', 'feasibility', 'safety'].map((id) => ({
    id, label: `Chapter-specific ${id}`, levels: ['Specific gap', 'Specific partial evidence', 'Specific complete evidence'],
  })) }
  const definition = { ...practice, version: 2, identityHash: 'a'.repeat(64), reviewRubric: rubric }
  const body = { ...workbookBody(), definitionVersion: 2, definitionHash: definition.identityHash }
  f.setWorkbook('chapter-01-core', 5, body)
  const validated = validateAcademyPracticeSubmission({ courseId: 'course', definition: { coreLessonId: 'chapter-01-core', design: { practice: definition } },
    workbookDocument: f.store.get('users/learner/academyWorkbooks/course__chapter-01-core'), evidence: { workbookLessonId: 'chapter-01-core', workbookRevision: 5 } })
  const plan = await f.db.runTransaction(async (transaction) => {
    const result = await prepareAcademySubmission({ db: f.db, transaction, HttpsError, userId: 'learner', courseId: 'course',
      artifactId: 'chapter-01-core', lessonId: 'chapter-01-practice', kind: 'practice', title: practice.title, validated })
    writeAcademySubmission(transaction, result, f.FieldValue)
    return result
  })
  assert.deepEqual(plan.document.rubric, rubric)
  await f.review(plan.submissionId)
  const read = await f.handler(request('read', {}, 'learner'))
  assert.equal(read.review.rubricVersion, 7)
  definition.reviewRubric.criteria[0].levels[2] = 'Later wording'
  assert.equal(read.submission.rubric.criteria[0].levels[2], 'Specific complete evidence')
})

test('new submission retains historical review but starts its own independent review state', async () => {
  const f = fixture(); const first = await f.submitPractice(); await f.review(first)
  const second = await f.submitPractice(1, 2, workbookBody({ context: 'Bản mới có dữ kiện khác.' }))
  assert.notEqual(first, second)
  const latest = await f.handler(request('read', {}, 'learner'))
  assert.equal(latest.review, null)
  assert.equal(latest.submission.workbookRevision, 2)
  const previous = await f.handler(request('read', { submissionId: first }, 'learner'))
  assert.equal(previous.review.verdict, 'accepted')
  assert.equal(previous.latestSubmissionId, second)
  await assert.rejects(f.review(first), { code: 'aborted' })
  await assert.rejects(f.submitPractice(), { code: 'aborted' })
})

test('review retries are idempotent and edits preserve an append-only revision history', async () => {
  const f = fixture(); const id = await f.submitPractice()
  const first = await f.review(id); const replay = await f.review(id)
  assert.equal(first.review.revision, 1); assert.equal(replay.duplicate, true)
  await assert.rejects(f.review(id, { feedback: 'Nhận xét khác nhưng dùng phiên bản cũ.' }), { code: 'aborted' })
  await f.review(id, { expectedReviewRevision: 1, verdict: 'needs-revision', feedback: 'Cần bổ sung thời điểm ghi nhận để giải thích dữ liệu rõ hơn.' })
  assert.equal([...f.store.keys()].filter((path) => path.includes(`/academySubmissionReviews/${id}/academyReviewRevisions/`)).length, 2)
})

test('only a trusted active assigned coach with live sharing consent can read or review', async () => {
  for (const scenario of ['unshared', 'reassigned', 'inactive', 'stale-claim', 'disabled-coach', 'disabled-learner', 'admin', 'student']) {
    const f = fixture(); const id = await f.submitPractice()
    let req = request('read')
    if (scenario === 'unshared') f.setWorkbook('chapter-01-core', 2, workbookBody(), false)
    if (scenario === 'reassigned') f.store.get('coachClients/learner').coachId = 'someone-else'
    if (scenario === 'inactive') f.store.get('coachClients/learner').coachingStatus = 'completed'
    if (scenario === 'stale-claim') req.auth.token.role = 'admin'
    if (scenario === 'disabled-coach') f.store.get('users/coach').disabled = true
    if (scenario === 'disabled-learner') f.store.get('users/learner').disabled = true
    if (scenario === 'admin') { f.store.set('users/coach', { role: 'admin' }); req.auth.token.role = 'admin' }
    if (scenario === 'student') { f.store.set('users/coach', { role: 'student' }); req.auth.token.role = 'student' }
    await assert.rejects(f.handler(req), { code: 'permission-denied' }, scenario)
    await assert.rejects(f.handler({ ...req, data: { ...req.data, action: 'review', submissionId: id } }), { code: 'permission-denied' }, scenario)
  }
  const f = fixture(); const id = await f.submitPractice()
  await assert.rejects(f.handler(request('review', { submissionId: id }, 'learner')), { code: 'permission-denied' })
  await assert.rejects(f.handler({ data: { action: 'read' } }), { code: 'unauthenticated' })
})

test('revoking sharing or reassigning during a review transaction leaves no committed feedback', async () => {
  for (const change of ['consent', 'assignment']) {
    const f = fixture(); const id = await f.submitPractice()
    f.changeBeforeCommit((store) => {
      if (change === 'consent') store.get('users/learner/academyWorkbooks/course__chapter-01-core').sharedWithCoach = false
      else store.get('coachClients/learner').coachId = 'new-coach'
    })
    await assert.rejects(f.review(id), { code: 'permission-denied' })
    assert.equal(f.store.has(`users/learner/academySubmissionReviews/${id}`), false)
  }
})

test('an accepted review cannot compensate for zero safety or skip substantive feedback', async () => {
  const f = fixture(); const id = await f.submitPractice()
  await assert.rejects(f.review(id, { scores: { data: 2, mechanism: 2, feasibility: 2, safety: 0 } }), { code: 'failed-precondition' })
  await assert.rejects(f.review(id, { scores: { data: 1, mechanism: 1, feasibility: 1, safety: 1 } }), { code: 'failed-precondition' })
  await assert.rejects(f.review(id, { feedback: 'Đạt' }), { code: 'invalid-argument' })
  await assert.rejects(f.review(id, { scores: { data: 99, mechanism: 2, feasibility: 2, safety: 2 } }), { code: 'invalid-argument' })
  const result = await f.review(id, { verdict: 'needs-revision', scores: { data: 1, mechanism: 1, feasibility: 1, safety: 0 } })
  assert.equal(result.review.verdict, 'needs-revision')
})

test('bounded per-student list returns only shared metadata, and selected reads have a fixed read budget', async () => {
  const f = fixture()
  for (let chapter = 1; chapter <= 22; chapter++) await f.submitPractice(chapter)
  f.setWorkbook('chapter-01-core', 2, workbookBody(), false)
  f.resetReads()
  const page = await f.handler(request('list'))
  assert.ok(page.items.length <= 20); assert.ok(page.nextCursor)
  assert.ok(f.getReads() <= 44)
  assert.doesNotMatch(JSON.stringify(page), /Minh chứng gốc|evidence|definitionSnapshot/)
  const next = await f.handler(request('list', { cursor: page.nextCursor }))
  assert.equal(next.nextCursor, null)
  assert.equal([...page.items, ...next.items].length, 21)
  f.resetReads(); await f.handler(request('read', { artifactId: 'chapter-02-core' }))
  assert.equal(f.getReads(), 7)
  f.resetReads(); await f.handler(request('read', {}, 'learner'))
  assert.equal(f.getReads(), 4)
})

test('scope mismatch cannot expose another artifact through a guessed submission ID', async () => {
  const f = fixture(); const first = await f.submitPractice(1); await f.submitPractice(2)
  await assert.rejects(f.handler(request('read', { artifactId: 'chapter-02-core', submissionId: first })), { code: 'not-found' })
})

async function portfolioFixture() {
  const f = fixture()
  const ids = []
  for (let chapter = 1; chapter <= 5; chapter++) ids.push(await f.submitPractice(chapter))
  const body = workbookBody(Object.fromEntries(academyPortfolioStages[0].fields.map(({ id }) => [id, `Dữ kiện và phân tích riêng cho ${id}.`])))
  f.setWorkbook('academy-portfolio-stage-1', 3, body)
  return { ...f, body, ids, submit: () => f.handler(request('submit-portfolio', { stageId: 1, workbookRevision: 3 }, 'learner')) }
}

test('portfolio binds exactly five submitted source versions, not mutable drafts or self-assessment', async () => {
  const f = await portfolioFixture()
  f.setWorkbook('chapter-01-core', 10, workbookBody({ context: 'Nháp mới không phải minh chứng đã nộp.' }))
  f.resetReads()
  const result = await f.submit()
  assert.equal(f.getReads(), 16)
  const submission = f.store.get(`users/learner/academySubmissions/${result.submissionId}`)
  assert.deepEqual(submission.sourceEvidence.map((source) => source.submissionId), f.ids)
  assert.equal(submission.sourceEvidence[0].workbookRevision, 1)
  assert.equal(submission.kind, 'portfolio')
  assert.equal(submission.evidence.rubric, undefined)
  assert.equal(submission.contentHash, sha({ definitionHash: submission.definitionHash, submittedAnswers: submission.evidence.answers, safetyAcknowledged: true }))
  assert.equal((await f.submit()).duplicate, true)
  assert.equal(f.store.has('users/learner/progress/course'), false, 'portfolio does not manufacture lesson completion')
})

test('portfolio rejects missing or stale source proof, wrong revision, low safety and lost course access', async () => {
  for (const scenario of ['missing-source', 'old-definition', 'revision', 'safety', 'enrollment', 'entitlement', 'drip', 'settings']) {
    const f = await portfolioFixture()
    if (scenario === 'missing-source') f.store.delete(`users/learner/academySubmissionHeads/${headId('course', 'chapter-01-core')}`)
    if (scenario === 'old-definition') f.store.get(`users/learner/academySubmissions/${f.ids[0]}`).definitionHash = 'old'
    if (scenario === 'revision') f.setWorkbook('academy-portfolio-stage-1', 4, f.body)
    if (scenario === 'safety') f.setWorkbook('academy-portfolio-stage-1', 3, { ...f.body, rubric: { data: 2, mechanism: 2, feasibility: 2, safety: 0 } })
    if (scenario === 'enrollment') f.store.get('enrollments/learner_course').status = 'cancelled'
    if (scenario === 'entitlement') f.store.get('courses/course').denied = true
    if (scenario === 'drip') f.store.get('courses/course').dripLocked = true
    if (scenario === 'settings') f.store.get('courses/course').invalidSettings = true
    await assert.rejects(f.submit(), (error) => ['failed-precondition', 'permission-denied'].includes(error.code), scenario)
  }
})

test('versioned portfolio reads only its five published chapters while authoring is a different draft', async () => {
  const f = await portfolioFixture()
  const storage = createAcademyCourseStorage({ db: f.db, HttpsError })
  const live = f.store.get('courses/course')
  // An unrelated sixth chapter is never loaded for the first portfolio.
  live.modules.push({ id: 'nutrition-chapter-06', lessons: [{ id: 'chapter-06-core' }] })
  const published = storage.pack({ courseId: 'course', revision: 1, course: live })
  for (const item of published.chapters) f.store.set(item.path, item.document)
  const draft = structuredClone(live)
  draft.status = 'draft'
  draft.modules[0].lessons[0].learningDesign.practice.version = 2
  const working = storage.pack({ courseId: 'course', revision: 2, course: draft, priorCourse: published.manifest })
  // Draft chunks are intentionally absent: no learner operation may need them.
  f.store.set('courses/course', { ...working.manifest, publishedSnapshot: { active: true, course: published.manifest } })
  f.store.delete(published.chapters[5].path)
  f.resetReads()
  const result = await f.submit()
  assert.equal(f.getReads(), 21)
  assert.deepEqual(f.store.get(`users/learner/academySubmissions/${result.submissionId}`).sourceEvidence.map((item) => item.submissionId), f.ids)
  f.store.get('courses/course').publishedSnapshot.active = false
  await assert.rejects(f.submit(), { code: 'failed-precondition' })
})

test('portfolio retries against current publication and rejects a newly changed practice definition', async () => {
  const f = await portfolioFixture()
  const storage = createAcademyCourseStorage({ db: f.db, HttpsError })
  const live = f.store.get('courses/course')
  const first = storage.pack({ courseId: 'course', revision: 1, course: live })
  const updated = structuredClone(live)
  updated.modules[0].lessons[0].learningDesign.practice.version = 2
  const next = storage.pack({ courseId: 'course', revision: 2, course: updated, priorCourse: first.manifest })
  for (const item of [...first.chapters, ...next.chapters]) f.store.set(item.path, item.document)
  f.store.set('courses/course', { ...first.manifest, publishedSnapshot: { active: true, course: first.manifest } })
  f.changeBeforeCommit((store) => store.set('courses/course', { ...next.manifest, publishedSnapshot: { active: true, course: next.manifest } }))
  await assert.rejects(f.submit(), { code: 'failed-precondition' })
  assert.equal([...f.store.values()].filter((item) => item.kind === 'portfolio').length, 0)
})

test('submission collections are server-only and the callable adds no warm or primary-region endpoint', () => {
  const rules = readFileSync(require.resolve('../firestore.rules'), 'utf8')
  for (const name of ['academySubmissions', 'academySubmissionHeads', 'academySubmissionReviews']) {
    assert.match(rules, new RegExp(`match /${name}/\\{document=\\*\\*\\} \\{\\s*allow read, write: if false;`))
  }
  const source = readFileSync(require.resolve('./index'), 'utf8')
  assert.match(source, /exports.academySubmissionAction = onCall\(\s*\{ \.\.\.academyLearnerRuntime, region: 'asia-east1'/)
  assert.match(source, /const academyLearnerRuntime = \{ cpu: 'gcf_gen1', memory: '256MiB', concurrency: 1, minInstances: 0, maxInstances: 2/)
  assert.match(source, /practiceSubmissionPlan = await prepareAcademySubmission/)
  const indexes = JSON.parse(readFileSync(require.resolve('../firestore.indexes.json'), 'utf8'))
  for (const collectionGroup of ['academySubmissions', 'academySubmissionReviews', 'academyReviewRevisions']) {
    assert.deepEqual(indexes.fieldOverrides.find((item) => item.collectionGroup === collectionGroup), { collectionGroup, fieldPath: '*', indexes: [] })
  }
})
