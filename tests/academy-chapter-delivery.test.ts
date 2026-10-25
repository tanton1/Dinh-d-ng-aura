import test from 'node:test'
import assert from 'node:assert/strict'
import { createAcademyChapterClient } from '../src/features/academy/chapterClient'
import { academyChapterRequest, validateAcademyChapter } from '../src/features/academy/chapterDelivery'
import { mergeAcademyReviewStates } from '../src/features/academy/reviewPersistence'
import type { Course } from '../src/types'
import type { AcademyReviewState } from '../src/services/academyLearningService'

const course = { id: 'course', revision: 3, contentStorage: 'chapters-v1', contentDelivery: 'catalog',
  settings: { accessTier: 'free', visibility: 'members', dripSchedule: 'none' }, modules: [{ id: 'module', title: 'Chapter', order: 1, contentVersion: 'r1_fixture',
    lessons: [{ id: 'reading', title: 'Read', type: 'Bài đọc', duration: '5', preview: true, contentVersion: 'r1_fixture' },
      { id: 'quiz', title: 'Quiz', type: 'Quiz', duration: '5', contentVersion: 'r1_fixture' }] }] } as Course
const metadata = course.modules![0]
const response = (access = 'full', revision = 3, version = 'r1_fixture') => ({ courseId: 'course', courseRevision: revision, chapterVersion: version, contentAccess: access,
  module: { ...structuredClone(metadata), contentVersion: version, lessons: metadata.lessons.map((lesson) => ({ ...lesson, contentVersion: version,
    ...(lesson.id === 'reading' ? { summary: 'Authorized body' } : access === 'preview' ? {} : { quiz: { id: 'quiz', passPercent: 80, questions: [{ id: 'q', question: 'Question', options: ['A', 'B'] }] } }) })) } })

test('client reads exactly once per chapter version and reuses unchanged content across publication revisions', async () => {
  const owner = { uid: 'student' }; const calls: Record<string, unknown>[] = []
  const client = createAcademyChapterClient({ session: () => owner, read: async (data) => { calls.push(data); return response('full', Number(data.courseRevision), String(data.chapterVersion)) } })
  await client.load('student', 'active', course, metadata, 'reading', 'full')
  await client.load('student', 'active', course, metadata, 'quiz', 'full')
  await client.load('student', 'active', { ...course, revision: 4 }, metadata, 'reading', 'full')
  assert.equal(calls.length, 1)
  const next = { ...metadata, contentVersion: 'r5_fixture' }
  await client.load('student', 'active', { ...course, revision: 5 }, next, 'reading', 'full')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], { chapter: true, courseId: 'course', lessonId: 'reading', courseRevision: 3, chapterVersion: 'r1_fixture' })
})

test('preview, staff draft, changed access policy and changed session cannot reuse a full learner chapter', async () => {
  let owner = { uid: 'student' }; let mode = 'full'; let calls = 0
  const client = createAcademyChapterClient({ session: () => owner, read: async (data) => { calls += 1; return response(data.authoringChapter ? 'staff-preview' : mode, Number(data.courseRevision)) } })
  await client.load('student', 'active', course, metadata, 'reading', 'full')
  mode = 'preview'
  const preview = await client.load('student', 'cancelled', course, metadata, 'reading', 'preview')
  assert.equal(preview.value.lessons[1].quiz, undefined)
  assert.equal(client.peek('student', 'cancelled', course, metadata, 'full'), undefined)
  await client.load('student', 'cancelled', course, metadata, 'reading', 'staff-preview')
  await client.load('student', 'cancelled', { ...course, revision: 4 }, metadata, 'reading', 'staff-preview')
  const changed = { ...course, settings: { ...course.settings!, visibility: 'private' as const } }
  assert.equal(client.peek('student', 'cancelled', changed, metadata, 'preview'), undefined)
  owner = { uid: 'student' }
  assert.equal(client.peek('student', 'cancelled', course, metadata, 'preview'), undefined)
  assert.equal(calls, 4)
})

test('expired chapter requires a new access check; authorization failure clears all cached content', async () => {
  let now = 1; let reject = false; const owner = { uid: 'student' }; let calls = 0
  const client = createAcademyChapterClient({ session: () => owner, now: () => now, ttlMs: 100, read: async () => {
    calls += 1; if (reject) throw Object.assign(new Error('Revoked'), { code: 'functions/permission-denied' }); return response()
  } })
  await client.load('student', 'active', course, metadata, 'reading', 'full')
  now = 102; reject = true
  await assert.rejects(client.load('student', 'active', course, metadata, 'reading', 'full'), { code: 'functions/permission-denied' })
  assert.equal(calls, 2)
  assert.equal(client.peek('student', 'active', course, metadata, 'full'), undefined)
})

test('selected response validation rejects incomplete, stale, wrong-scope and private quiz fields', () => {
  const input = academyChapterRequest(course, metadata, 'reading', 'full')
  for (const mutation of [
    (data: any) => { data.module.lessons.pop() }, (data: any) => { data.chapterVersion = 'old' },
    (data: any) => { data.contentAccess = 'preview' }, (data: any) => { data.module.lessons[1].quiz.questions[0].correctIndex = 0 },
    (data: any) => { data.module.lessons[1].quiz.questions[0].explanation = 'private' }, (data: any) => { data.chapterRefs = {} },
  ]) { const data = response(); mutation(data); assert.throws(() => validateAcademyChapter(data, input, metadata)) }
  assert.throws(() => validateAcademyChapter(response('preview'), { ...input, access: 'full' }, metadata), { code: 'functions/permission-denied' })
  const leaked = response('preview'); Object.assign(leaked.module.lessons[1], { summary: 'Protected body' })
  assert.throws(() => validateAcademyChapter(leaked, { ...input, access: 'preview' }, metadata))
})

test('a response from the old account never enters the new session cache', async () => {
  let owner = { uid: 'a' }; let resolve: (value: unknown) => void = () => undefined
  const client = createAcademyChapterClient({ session: () => owner, read: () => new Promise((done) => { resolve = done }) })
  const read = client.load('a', 'active', course, metadata, 'reading', 'full')
  await Promise.resolve(); owner = { uid: 'b' }; resolve(response())
  await assert.rejects(read, { code: 'functions/unauthenticated' })
  assert.equal(client.peek('b', 'active', course, metadata, 'full'), undefined)
})

test('review merge preserves a card rated during an in-flight read and merges newer remote items without deleting untouched history', () => {
  const card = { lessonId: 'reading', cardId: 'a', rating: 'good' as const, repetitions: 1, intervalDays: 1, reviewedAt: 10, dueAt: 20 }
  const before: AcademyReviewState = { version: 1, cards: { a: card, retained: { ...card, cardId: 'retained' } } }
  const current: AcademyReviewState = { version: 1, cards: { ...before.cards, a: { ...card, rating: 'again', reviewedAt: 30, dueAt: 40 } } }
  const remote: AcademyReviewState = { version: 1, cards: { a: { ...card, reviewedAt: 100 }, b: { ...card, cardId: 'b', reviewedAt: 50 } } }
  const result = mergeAcademyReviewStates(current, remote, before)
  assert.equal(result.cards.a.rating, 'again', 'a cloud timestamp must not override a local action during the read')
  assert.equal(result.cards.b.reviewedAt, 50)
  assert.equal(result.cards.retained.cardId, 'retained')
  assert.equal(mergeAcademyReviewStates(before, remote, before).cards.a.reviewedAt, 100)
})

test('a failed read from an old session cannot evict the new session chapter cache', async () => {
  let owner = { uid: 'a' }; let calls = 0; let release!: (value: unknown) => void
  const client = createAcademyChapterClient({ session: () => owner, read: async () => {
    calls += 1
    if (calls === 1) return new Promise((resolve) => { release = resolve })
    return response()
  } })
  const old = client.load('a', 'active', course, metadata, metadata.lessons[0].id, 'full')
  await Promise.resolve()
  owner = { uid: 'b' }
  await client.load('b', 'active', course, metadata, metadata.lessons[0].id, 'full')
  release(response())
  await assert.rejects(old, { code: 'functions/unauthenticated' })
  assert.ok(client.peek('b', 'active', course, metadata, 'full'))
  await client.load('b', 'active', course, metadata, metadata.lessons[0].id, 'full')
  assert.equal(calls, 2)
})
