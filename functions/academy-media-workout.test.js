'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { academyRuntimeFixture } = require('./test-support/academy-runtime-fixture')
const request = (data, role = 'student') => ({ auth: { uid: 'student', token: { role } }, data: { courseId: 'course', ...data } })
const path = 'course-media/course/reading/handout.pdf'
function mediaFixture() {
  const events = []
  let metadata = { contentType: 'application/pdf', size: '1234', metadata: { courseId: 'course', lessonId: 'reading', assetId: 'handout', resourceKind: 'document' } }
  const f = academyRuntimeFixture('after-submit', { storage: { bucket: () => ({ file: (value) => ({
    getMetadata: async () => { events.push(['metadata', value]); if (metadata instanceof Error) throw metadata; return [metadata] },
    getSignedUrl: async (options) => { events.push(['sign', value, options]); return [`https://media.example.test/handout?disposition=${options.promptSaveAs ? 'download' : 'inline'}`] },
  }) }) } })
  f.course.modules[0].lessons[0].resources = [{ id: 'handout', title: 'Tài liệu', kind: 'document', url: '', assetRef: { assetId: 'handout', storagePath: path, status: 'ready' } }]
  return { ...f, events, setMetadata: (value) => { metadata = value }, media: f.context.exports.getCourseMediaUrl }
}
const mediaInput = (version, extra = {}) => request({ lessonId: 'reading', path, ...(version ? { chapterVersion: version } : {}), ...extra })

test('media leases authorize legacy and versioned content transactionally and bind the selected version', async () => {
  const f = mediaFixture()
  const old = await f.media(mediaInput())
  assert.equal(old.chapterVersion, null)
  assert.equal(f.transactionReads[0].length, 3)
  assert.equal(f.events.filter(([kind]) => kind === 'sign').length, 2)
  const plan = f.versioned(), version = plan.manifest.modules[0].contentVersion
  const before = Date.now()
  const result = await f.media(mediaInput(version, { courseRevision: 1 }))
  assert.equal(result.chapterVersion, version)
  assert.equal(result.courseId, 'course'); assert.equal(result.lessonId, 'reading'); assert.equal(result.contentAccess, 'full')
  assert.equal(f.transactionReads[1].length, 4)
  assert.equal(f.transactionReads[1].filter((item) => item.includes('/academyChapterVersions/')).length, 1)
  assert.ok(Date.parse(result.expiresAt) >= before + 300000 && Date.parse(result.expiresAt) <= Date.now() + 300000)
})

test('media rejects missing/stale versions, mismatched paths and missing immutable content before touching Storage', async () => {
  const f = mediaFixture(), plan = f.versioned(), version = plan.manifest.modules[0].contentVersion
  await assert.rejects(f.media(mediaInput()), { code: 'aborted' })
  await assert.rejects(f.media(mediaInput('old')), { code: 'aborted' })
  await assert.rejects(f.media(mediaInput(version, { path: 'course-media/other/reading/handout.pdf' })), { code: 'invalid-argument' })
  await assert.rejects(f.media(mediaInput(version, { path: `${path}/../other.pdf` })), { code: 'invalid-argument' })
  f.store.delete(plan.chapters[0].path)
  await assert.rejects(f.media(mediaInput(version)), { code: 'failed-precondition' })
  assert.equal(f.events.length, 0)
})

test('media preview is limited by visibility; revocation during a transaction retry signs nothing', async () => {
  const f = mediaFixture()
  f.store.delete('enrollments/student_course')
  assert.equal((await f.media(mediaInput())).contentAccess, 'preview')
  f.course.settings.visibility = 'private'
  const before = f.events.length
  await assert.rejects(f.media(mediaInput()), { code: 'failed-precondition' })
  f.course.settings.visibility = 'members'
  f.retryOnce(() => { f.store.get('users/student').disabled = true })
  await assert.rejects(f.media(mediaInput()), { code: 'permission-denied' })
  assert.equal(f.events.length, before)
})

test('staff media preview uses the exact authoring revision and never falls back to arbitrary unattached files', async () => {
  const f = mediaFixture(), live = f.versioned(), liveVersion = live.manifest.modules[0].contentVersion
  f.course.revision = 2; f.course.status = 'draft'; f.course.modules[0].lessons[0].summary = 'Working draft'
  const draft = f.storage.pack({ courseId: 'course', revision: 2, course: f.course, quizKeys: { lesson: f.key } })
  draft.chapters.forEach((item) => f.store.set(item.path, item.document))
  f.store.set('courses/course', { ...draft.manifest, publishedSnapshot: { active: true, course: live.manifest } })
  const chapterVersion = draft.manifest.modules[0].contentVersion
  const payload = { lessonId: 'reading', path, chapterVersion, courseRevision: 2, authoringPreview: true }
  await assert.rejects(f.media(request(payload)), { code: 'permission-denied' })
  f.store.get('users/student').role = 'admin'
  const result = await f.media(request(payload, 'admin'))
  assert.equal(result.contentAccess, 'staff-preview'); assert.equal(result.chapterVersion, chapterVersion)
  assert.equal(f.transactionReads.at(-1).length, 3)
  await assert.rejects(f.media(request({ ...payload, courseRevision: 1 }, 'admin')), { code: 'aborted' })
  await assert.rejects(f.media(request({ ...payload, path: 'course-media/course/reading/unattached.pdf' }, 'admin')), { code: 'permission-denied' })
  assert.equal((await f.media(request({ lessonId: 'reading', path, chapterVersion: liveVersion }, 'admin'))).chapterVersion, liveVersion)
})

test('Storage metadata must match the exact lesson reference, kind, bounded size and supported MIME', async () => {
  const f = mediaFixture()
  for (const metadata of [
    { contentType: 'application/pdf', size: '12', metadata: { courseId: 'course', lessonId: 'reading', assetId: 'other', resourceKind: 'document' } },
    { contentType: 'text/html', size: '12', metadata: { courseId: 'course', lessonId: 'reading', assetId: 'handout', resourceKind: 'document' } },
    { contentType: 'application/pdf', size: '999999999999', metadata: { courseId: 'course', lessonId: 'reading', assetId: 'handout', resourceKind: 'document' } },
  ]) {
    f.setMetadata(metadata)
    await assert.rejects(f.media(mediaInput()), { code: 'failed-precondition' })
  }
  f.setMetadata(Object.assign(new Error('Missing'), { code: 404 }))
  await assert.rejects(f.media(mediaInput()), { code: 'not-found' })
  assert.equal(f.events.filter(([kind]) => kind === 'sign').length, 0)
})

function workoutFixture(versioned = true) {
  const f = academyRuntimeFixture()
  const ref = { programId: 'program', versionId: 'v1', sessionId: 'session' }
  f.course.modules[0].lessons.push({ id: 'workout', title: 'Workout', type: 'Buổi tập', duration: '10 phút', workoutRef: ref, completionPolicy: { mode: 'workout-complete' } })
  const session = { id: 'session', dayLabel: 'Buổi A', exercises: [{ id: 'exercise', name: 'Bài tập A', sets: 1 }],
    quiz: { questions: [{ id: 'q', question: 'Question', options: ['one', 'two'], correctIndex: 0, explanation: 'Private answer explanation' }] } }
  f.store.set('programs/program', { status: 'published' })
  f.store.set('programs/program/versions/v1', { programId: 'program', versionId: 'v1', schemaVersion: 2, title: 'Program v1', weeksByWeek: { 1: { sessionsByDay: { 1: session } } } })
  const plan = versioned ? f.versioned() : null
  const input = { lessonId: 'workout', ...ref, ...(plan ? { chapterVersion: plan.manifest.modules[0].contentVersion } : {}) }
  const log = { clientLogId: 'log', ...ref, durationSeconds: 600, perceivedExertion: 2, sets: [{ exerciseId: 'exercise', setNumber: 1, weightKg: 10, reps: 5 }] }
  return { ...f, session, plan, input, log, get: f.context.exports.getCourseWorkoutSession, save: f.context.exports.saveCourseWorkoutLog }
}

test('workout read uses one live chapter and the exact immutable program version, never leaking quiz keys', async () => {
  const f = workoutFixture()
  f.store.get('programs/program').currentVersionId = 'v2'
  const result = await f.get(request(f.input))
  assert.equal(result.chapterVersion, f.input.chapterVersion)
  assert.equal(result.versionId, 'v1'); assert.equal(result.programTitle, 'Program v1')
  assert.equal(f.transactionReads[0].length, 6)
  assert.doesNotMatch(JSON.stringify(result), /correctIndex|Private answer explanation/)
  const legacy = workoutFixture(false)
  assert.equal((await legacy.get(request(legacy.input))).chapterVersion, null)
  assert.equal(legacy.transactionReads[0].length, 5)
})

test('workout refuses stale/missing chapter, foreign program reference and archived or corrupt program snapshots', async () => {
  const f = workoutFixture()
  await assert.rejects(f.get(request({ ...f.input, chapterVersion: undefined })), { code: 'aborted' })
  await assert.rejects(f.get(request({ ...f.input, versionId: 'v2' })), { code: 'permission-denied' })
  assert.ok(f.transactionReads.flat().every((item) => !item.startsWith('programs/')))
  f.store.get('programs/program').status = 'draft'
  await assert.rejects(f.get(request(f.input)), { code: 'failed-precondition' })
  f.store.get('programs/program').status = 'published'
  f.store.get('programs/program/versions/v1').programId = 'other'
  await assert.rejects(f.get(request(f.input)), { code: 'failed-precondition' })
})

test('workout log is version-bound, idempotent only for the same normalized payload, and usable as completion proof', async () => {
  const f = workoutFixture()
  const payload = request({ ...f.input, log: f.log })
  const saved = await f.save(payload)
  assert.equal(saved.chapterVersion, f.input.chapterVersion)
  assert.equal(f.transactionReads[0].length, 7)
  const stored = f.store.get('users/student/workoutLogs/log')
  assert.equal(stored.totalLoadKg, 50); assert.equal(stored.sets[0].exerciseName, 'Bài tập A')
  assert.deepEqual(await f.save(payload), saved)
  assert.equal(f.store.get('users/student/workoutLogs/log'), stored)
  await assert.rejects(f.save(request({ ...f.input, log: { ...f.log, durationSeconds: 900 } })), { code: 'already-exists' })
  const result = await f.complete(request({ ...f.input, workoutLogId: 'log' }))
  assert.ok(result.completedLessonIds.includes('workout'))
  f.course.revision = 2; f.course.modules[0].lessons[0].summary = 'New revision'
  const next = f.versioned()
  assert.ok((await f.complete(request({ ...f.input, chapterVersion: next.manifest.modules[0].contentVersion, workoutLogId: 'log' }))).completedLessonIds.includes('workout'))
  f.course.revision = 3; f.course.modules[0].lessons[2].workoutRef.versionId = 'v2'
  const changedWorkout = f.versioned()
  await assert.rejects(f.complete(request({ ...f.input, chapterVersion: changedWorkout.manifest.modules[0].contentVersion, workoutLogId: 'log' })), { code: 'failed-precondition' })
  assert.ok(f.store.get('users/student/progress/course').completedLessonIds.includes('workout'), 'historical completion is not deleted')
})

test('workout save retries all authorization and reference reads; revocation or changed publication commits no log', async () => {
  for (const mutation of [
    (f) => { f.store.get('users/student').disabled = true },
    (f) => { f.store.get('enrollments/student_course').status = 'cancelled' },
    (f) => { f.store.get('programs/program').status = 'archived' },
    (f) => { f.course.revision = 2; f.course.modules[0].lessons[0].summary = 'Updated'; f.versioned() },
  ]) {
    const f = workoutFixture()
    f.retryOnce(() => mutation(f))
    await assert.rejects(f.save(request({ ...f.input, log: f.log })))
    assert.equal(f.transactionReads.length, 2)
    assert.equal(f.store.has('users/student/workoutLogs/log'), false)
  }
})

test('storage-only migration preserves exact-payload legacy workout evidence without rewriting it, and draft logs remain forbidden', async () => {
  const f = workoutFixture(false)
  await f.save(request({ ...f.input, log: f.log }))
  delete f.store.get('users/student/workoutLogs/log').requestHash
  assert.equal((await f.save(request({ ...f.input, log: f.log }))).logId, 'log')
  await assert.rejects(f.save(request({ ...f.input, log: { ...f.log, perceivedExertion: 3 } })), { code: 'already-exists' })
  const version = f.versioned().manifest.modules[0].contentVersion
  assert.equal((await f.save(request({ ...f.input, chapterVersion: version, log: f.log }))).chapterVersion, version)
  assert.equal(f.store.get('users/student/workoutLogs/log').chapterVersion, null, 'original evidence is not rewritten')
  assert.ok((await f.complete(request({ ...f.input, chapterVersion: version, workoutLogId: 'log' }))).completedLessonIds.includes('workout'))
  f.store.get('users/student').role = 'admin'
  await assert.rejects(f.save(request({ ...f.input, chapterVersion: version, authoringPreview: true, log: { ...f.log, clientLogId: 'other' } }, 'admin')), { code: 'permission-denied' })
  assert.equal(f.store.has('users/student/workoutLogs/other'), false)
})
