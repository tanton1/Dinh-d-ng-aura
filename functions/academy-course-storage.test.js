'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createAcademyCourseStorage, STORAGE, COLLECTION, LIMITS } = require('./academy-course-storage')
const { normalizedAcademyTemplate } = require('./test-support/academy-template-fixture')

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }
const clone = (value) => JSON.parse(JSON.stringify(value))
const size = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')

function fixture() {
  const data = new Map()
  const reads = []
  const reference = (path) => ({ path, id: path.split('/').at(-1), collection: (name) => reference(`${path}/${name}`), get: async () => read(reference(path)) })
  const read = async (ref) => {
    reads.push(ref.path)
    return { exists: data.has(ref.path), data: () => clone(data.get(ref.path)) }
  }
  const storage = createAcademyCourseStorage({ db: { doc: reference }, HttpsError })
  const persist = (plan) => storage.writeChapters({ create: (ref, document) => {
    assert.equal(data.has(ref.path), false, 'immutable chapter collision')
    data.set(ref.path, clone(document))
  } }, plan)
  const course = { schemaVersion: 2, title: 'Khóa học', description: 'Danh mục', status: 'draft', lessons: 4,
    settings: { accessTier: 'free', visibility: 'members', dripSchedule: 'none', completionPercent: 80, certificateEnabled: false },
    modules: [1, 2].map((n) => ({ id: `module-${n}`, title: `Chương ${n}`, order: n, lessons: [
      { id: `read-${n}`, title: 'Học', type: 'Bài đọc', duration: '10 phút', preview: n === 1, summary: 'Nội dung dài', coachNotes: 'Riêng coach', primaryContent: { kind: 'rich-text', body: '<p>Bài học đầy đủ</p>' } },
      { id: `quiz-${n}`, title: 'Kiểm tra', type: 'Quiz', duration: '5 phút', quiz: { id: `quiz-${n}`, passPercent: 80, questions: [
        { id: `q-${n}`, question: 'Chọn', options: ['A', 'B'], explanation: 'Giải thích riêng', mustPass: true },
      ] } },
    ] })) }
  const quizKeys = Object.fromEntries([1, 2].map((n) => [`quiz-${n}`, { quizId: `quiz-${n}`, answers: { [`q-${n}`]: 1 }, passPercent: 80, questionCount: 1, contentHash: `key-${n}` }]))
  const pack = (revision = 1, priorCourse = null) => storage.pack({ courseId: 'course', revision, course, quizKeys, priorCourse })
  return { data, reads, storage, persist, course, quizKeys, pack, read }
}

test('manifest contains only catalog fields; immutable documents keep complete chapter and private answers', () => {
  const f = fixture()
  const plan = f.pack()
  assert.equal(plan.manifest.contentStorage, STORAGE)
  assert.equal(plan.chapters.length, 2)
  assert.doesNotMatch(JSON.stringify(plan.manifest), /Nội dung dài|Bài học đầy đủ|Riêng coach|Giải thích riêng|"answers"|"quizKeys"/)
  assert.deepEqual(plan.chapters[0].document.module, f.course.modules[0])
  assert.deepEqual(plan.chapters[0].document.quizKeys, { 'quiz-1': f.quizKeys['quiz-1'] })
  assert.notEqual(plan.manifest.modules[0].contentVersion, plan.chapters[0].document.contentHash)
  f.course.modules[0].lessons[0].summary = 'Changed after planning'
  assert.equal(plan.chapters[0].document.module.lessons[0].summary, 'Nội dung dài')
})

test('selected chapter uses exactly one chapter read, no other course, key query or history scan', async () => {
  const f = fixture()
  const plan = f.pack()
  f.persist(plan)
  const loaded = await f.storage.load({ courseId: 'course', course: plan.manifest, moduleIds: ['module-2'], read: f.read })
  assert.equal(loaded.chapterReads, 1)
  assert.deepEqual(f.reads, [plan.chapters[1].path])
  assert.deepEqual(loaded.course.modules[1], f.course.modules[1])
  assert.deepEqual(loaded.course.modules[0], plan.manifest.modules[0])
  assert.deepEqual(Object.keys(loaded.quizKeys), ['quiz-2'])
  await f.storage.load({ courseId: 'course', course: plan.manifest, moduleIds: [], read: f.read })
  assert.equal(f.reads.length, 1, 'metadata-only access adds no chapter reads')
})

test('explicit staff hydration supports legacy keys and versioned chapters without mixing the two stores', async () => {
  const f = fixture()
  const legacyReads = []
  const legacy = await f.storage.loadAuthoring({ courseId: 'course', course: f.course, read: async (ref) => {
    legacyReads.push(ref.path)
    return { docs: Object.entries(f.quizKeys).map(([id, data]) => ({ id, data: () => data })) }
  } })
  assert.deepEqual(legacyReads, ['courses/course/quizKeys'])
  assert.deepEqual(legacy.quizKeys, f.quizKeys)
  const plan = f.pack()
  f.persist(plan)
  const hydrated = await f.storage.loadAuthoring({ courseId: 'course', course: plan.manifest })
  assert.deepEqual(hydrated.course.modules, f.course.modules)
  assert.deepEqual(hydrated.quizKeys, f.quizKeys)
  assert.equal(hydrated.chapterReads, 2)
  assert.equal(f.reads.some((path) => path.endsWith('/quizKeys')), false)
})

test('key timestamps do not duplicate unchanged content and chapter writes always use immutable create', () => {
  const f = fixture()
  const first = f.pack()
  f.quizKeys['quiz-1'].createdAt = { toMillis: () => 1 }
  f.quizKeys['quiz-1'].updatedAt = { toMillis: () => 2 }
  assert.equal(f.pack(2, first.manifest).chapters.length, 0)
  const createdPaths = []
  f.storage.writeChapters({ create: (ref) => createdPaths.push(ref.path),
    set: () => assert.fail('Cannot overwrite a chapter'), update: () => assert.fail('Cannot update a chapter') }, first)
  assert.deepEqual(createdPaths, first.chapters.map((item) => item.path))
})

test('unchanged chapters reuse immutable versions; content, answer or grading policy edits create only affected chapters', () => {
  const f = fixture()
  const first = f.pack()
  const noChanges = f.pack(2, first.manifest)
  assert.equal(noChanges.chapters.length, 0)
  assert.deepEqual(noChanges.manifest.modules, first.manifest.modules)
  f.course.modules[1].lessons[0].summary = 'Bản mới'
  assert.throws(() => f.pack(1, first.manifest), { code: 'failed-precondition' })
  const changed = f.pack(3, noChanges.manifest)
  assert.equal(changed.chapters.length, 1)
  assert.equal(changed.chapters[0].document.moduleId, 'module-2')
  assert.equal(changed.manifest.modules[0].contentVersion, first.manifest.modules[0].contentVersion)
  f.quizKeys['quiz-1'].answers['q-1'] = 0
  const keyChanged = f.pack(4, changed.manifest)
  assert.equal(keyChanged.chapters.length, 1)
  assert.equal(keyChanged.chapters[0].document.moduleId, 'module-1')
  f.course.modules[0].lessons[1].quiz.questions[0].mustPass = false
  assert.equal(f.pack(5, keyChanged.manifest).chapters.length, 1)
  assert.throws(() => f.pack(5, { ...first.manifest, chapterRefs: { ...first.manifest.chapterRefs, 'module-1': keyChanged.manifest.chapterRefs['module-1'] } }), { code: 'failed-precondition' })
})

test('same object fields in another insertion order reuse versions but changed array order does not', () => {
  const f = fixture()
  const first = f.pack()
  f.course.modules[0] = Object.fromEntries(Object.entries(f.course.modules[0]).reverse())
  f.quizKeys['quiz-1'] = Object.fromEntries(Object.entries(f.quizKeys['quiz-1']).reverse())
  assert.equal(f.pack(2, first.manifest).chapters.length, 0)
  f.course.modules[0].lessons.reverse()
  assert.equal(f.pack(3, first.manifest).chapters.length, 1)
})

test('loading fails closed on missing, foreign, tampered or metadata-mismatched chapter versions', async () => {
  for (const mutation of [
    (f, p) => f.data.delete(p.chapters[0].path),
    (f, p) => { f.data.get(p.chapters[0].path).courseId = 'other-course' },
    (f, p) => { f.data.get(p.chapters[0].path).moduleId = 'module-2' },
    (f, p) => { f.data.get(p.chapters[0].path).quizKeys['quiz-1'].answers['q-1'] = 0 },
    (f, p) => { f.data.get(p.chapters[0].path).module.lessons[0].summary = 'Tampered' },
    (_f, p) => { p.manifest.modules[0].lessons[0].preview = false },
  ]) {
    const f = fixture()
    const plan = f.pack()
    f.persist(plan)
    mutation(f, plan)
    await assert.rejects(f.storage.load({ courseId: 'course', course: plan.manifest, moduleIds: ['module-1'] }), { code: 'failed-precondition' })
  }
})

test('unknown or duplicate selection and malformed references fail before reading', async () => {
  const f = fixture()
  const plan = f.pack()
  for (const moduleIds of [['foreign'], ['module-1', 'module-1'], 'module-1']) {
    await assert.rejects(f.storage.load({ courseId: 'course', course: plan.manifest, moduleIds }), { code: 'failed-precondition' })
  }
  plan.manifest.chapterRefs['module-1'].versionId = '../other'
  await assert.rejects(f.storage.load({ courseId: 'course', course: plan.manifest }), { code: 'failed-precondition' })
  assert.equal(f.reads.length, 0)
})

test('cross-course references and unsupported storage formats fail before any database read', async () => {
  const f = fixture()
  const first = f.pack()
  await assert.rejects(f.storage.load({ courseId: 'another-course', course: first.manifest }), { code: 'failed-precondition' })
  assert.throws(() => f.storage.pack({ courseId: 'another-course', revision: 2, course: f.course,
    quizKeys: f.quizKeys, priorCourse: first.manifest }), { code: 'failed-precondition' })
  for (const contentStorage of ['chapters-v2', null, true]) {
    const course = { ...f.course, contentStorage }
    await assert.rejects(f.storage.load({ courseId: 'course', course }), { code: 'failed-precondition' })
    await assert.rejects(f.storage.loadAuthoring({ courseId: 'course', course }), { code: 'failed-precondition' })
  }
  assert.equal(f.reads.length, 0)
})

test('catalog-only input cannot overwrite full authoring content; inline or foreign quiz answers are rejected', () => {
  const f = fixture()
  assert.throws(() => f.storage.pack({ courseId: 'course', revision: 2, course: f.pack().manifest }), { code: 'failed-precondition' })
  f.quizKeys.foreign = f.quizKeys['quiz-1']
  assert.throws(f.pack, { code: 'failed-precondition' })
  delete f.quizKeys.foreign
  f.course.modules[0].lessons[1].quiz.questions[0].correctIndex = 1
  assert.throws(f.pack, { code: 'failed-precondition' })
})

test('one oversized chapter is rejected without truncation or writes; aggregate input is independently bounded', () => {
  const f = fixture()
  f.course.modules[0].lessons[0].summary = 'x'.repeat(LIMITS.chapterBytes)
  assert.throws(f.pack, { code: 'resource-exhausted' })
  assert.equal(f.data.size, 0)
  f.course.modules = Array.from({ length: 8 }, (_, i) => ({ id: `m-${i}`, title: 'Chương', order: i,
    lessons: [{ id: `l-${i}`, title: 'Bài', type: 'Bài đọc', duration: '10 phút', summary: 'x'.repeat(600 * 1024) }] }))
  assert.throws(() => f.storage.pack({ courseId: 'course', revision: 1, course: f.course }), { code: 'resource-exhausted' })
})

test('duplicate IDs, non-finite values, undefined, cyclic and over-deep data are rejected', () => {
  for (const mutate of [
    (c) => { c.modules[1].id = c.modules[0].id },
    (c) => { c.modules[1].lessons[0].id = c.modules[0].lessons[0].id },
    (c) => { c.modules[0].order = Infinity },
    (c) => { c.modules[0].description = undefined },
    (c) => { c.modules[0].cycle = c.modules[0] },
    (c) => { c.modules[0].deep = Array.from({ length: 20 }).reduce((a) => ({ a }), {}) },
  ]) {
    const f = fixture()
    mutate(f.course)
    assert.throws(f.pack, { code: 'failed-precondition' })
  }
})

test('published content is independent of authoring state, and explicit archival does not fall back to a stale published root', () => {
  const f = fixture()
  f.course.status = 'published'
  const live = f.pack().manifest
  f.course.status = 'draft'
  const draft = f.pack(2, live).manifest
  const root = { ...draft, publishedSnapshot: { active: true, course: live } }
  assert.equal(f.storage.publishedCourse(root), live)
  assert.equal(f.storage.publishedCourse({ ...root, status: 'published', publishedSnapshot: { active: false } }), null)
  assert.equal(f.storage.publishedCourse(f.course), null)
  const legacy = { ...f.course, status: 'published' }
  assert.equal(f.storage.publishedCourse(legacy), legacy)
  assert.throws(() => f.storage.publishedCourse({ ...root, publishedSnapshot: { active: true, course: { ...live, status: 'draft' } } }), { code: 'failed-precondition' })
})

test('version check rejects stale or missing client versions; unchanged chapter survives unrelated draft revisions', () => {
  const f = fixture()
  const first = f.pack().manifest
  const expectedVersion = first.modules[0].contentVersion
  f.storage.requireVersion(first, 'module-1', expectedVersion)
  f.storage.requireVersion(f.pack(2, first).manifest, 'module-1', expectedVersion)
  for (const version of [undefined, 'old-version', first.modules[1].contentVersion]) {
    assert.throws(() => f.storage.requireVersion(first, 'module-1', version), { code: 'aborted' })
  }
  f.storage.requireVersion(f.course, 'module-1', undefined)
})

test('twenty-chapter real normalized authoring template round-trips without the legacy single-revision limit', async (t) => {
  const normalized = normalizedAcademyTemplate(HttpsError)
  const { quizKeys } = normalized
  assert.ok(size({ course: normalized.course, quizKeys }) > 750 * 1024)
  const f = fixture()
  const plan = f.storage.pack({ courseId: normalized.identifier, revision: 1, course: normalized.course, quizKeys })
  assert.equal(plan.chapters.length, 20)
  assert.ok(size(plan.manifest) < 50 * 1024)
  assert.ok(plan.chapters.every((chapter) => size(chapter.document) < LIMITS.chapterBytes))
  f.persist(plan)
  const full = await f.storage.load({ courseId: normalized.identifier, course: plan.manifest })
  assert.deepEqual(full.course.modules, clone(normalized.course.modules))
  assert.deepEqual(full.quizKeys, clone(quizKeys))
  assert.equal(full.chapterReads, 20)
  // No private content is truncated to make the document fit.
  assert.equal(size(full.course.modules), size(normalized.course.modules))
  t.diagnostic(JSON.stringify({ normalizedLegacyBytes: size({ course: { ...normalized.course, revision: 1 }, quizKeys }),
    manifestBytes: size(plan.manifest), chapterCount: plan.chapters.length,
    largestChapterBytes: Math.max(...plan.chapters.map((chapter) => size(chapter.document))),
    totalChapterBytes: plan.chapters.reduce((total, chapter) => total + size(chapter.document), 0) }))
})

test('private chapter documents have explicit deny rules and no unused indexes', () => {
  const rules = readFileSync(require.resolve('../firestore.rules'), 'utf8')
  assert.match(rules, new RegExp(`match /${COLLECTION}/\\{versionId\\} \\{\\s*//[^]*?allow read, write: if false;`))
  const indexes = require('../firestore.indexes.json')
  assert.ok(indexes.fieldOverrides.some((item) => item.collectionGroup === COLLECTION && item.fieldPath === '*' && item.indexes.length === 0))
})
