'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, FieldValue, Filter, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { createAcademyCourseStorage, COLLECTION } = require('./academy-course-storage')
const { normalizedAcademyTemplate, academyAuthoringValidation } = require('./test-support/academy-template-fixture')
const { academyAuthoringFixture } = require('./test-support/academy-authoring-fixture')
const { academyRuntimeHandlers } = require('./test-support/academy-runtime-fixture')
const { createAcademyAuthoringHandlers } = require('./academy-authoring')
const { createAcademyDraftAdoption } = require('./academy-draft-adoption')

// Never allow a missing emulator variable to fall back to a production host.
if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
    || process.env.GCLOUD_PROJECT !== 'demo-aura-fitness') {
  throw new Error('This integration test requires the local demo-aura-fitness Firestore Emulator.')
}

test('reviewed chapter adoption uses real transactions without publishing drafts or losing learner proofs', async (t) => {
  const app = initializeApp({ projectId: 'demo-aura-fitness' }, `academy-adoption-${randomUUID()}`)
  t.after(() => deleteApp(app))
  const db = getFirestore(app, 'academy-storage-tests')
  const storage = createAcademyCourseStorage({ db, HttpsError }), validation = academyAuthoringValidation(HttpsError)
  const adminId = `reviewer-${randomUUID()}`, learnerId = `learner-${randomUUID()}`, courseId = `adoption-${randomUUID()}`
  await db.doc(`users/${adminId}`).set({ role: 'admin', disabled: false })
  await db.doc(`users/${learnerId}`).set({ role: 'student', disabled: false, membership: 'free' })
  const runtimeDb = { doc: (path) => db.doc(path), collection: (path) => db.collection(path),
    runTransaction: (callback) => db.runTransaction(async (transaction) => await callback(transaction)) }
  const context = academyRuntimeHandlers({ db: runtimeDb, HttpsError, FieldValue, Filter })
  const runtime = context.exports
  const authorize = context.requireTrustedAcademyStaffContext
  const adoption = createAcademyDraftAdoption({ db, HttpsError, FieldValue, storage, authorize,
    validateId: validation.courseId, normalize: validation.normalizeCourseDraftInput, assertReady: validation.assertCourseReadyToPublish,
    buildQuizContentHash: validation.buildQuizContentHash,
    loadDraft: require('./generated/academy-learning-drafts.cjs').getAcademyLearningDraft,
    loadCheckpoint: require('./generated/academy-learning-checkpoints.cjs').getAcademyLearningCheckpoint })
  const authoring = createAcademyAuthoringHandlers({ db, HttpsError, FieldValue, storage, authorize,
    validateId: validation.courseId, normalize: validation.normalizeCourseDraftInput, assertSaveStatus: validation.assertCourseContentSaveStatus,
    assertReady: validation.assertCourseReadyToPublish, buildQuizContentHash: validation.buildQuizContentHash,
    buildDiff: validation.buildCourseRevisionDiff, validateScientificReview: adoption.validateCourse })
  const staff = (data) => ({ auth: { uid: adminId, token: { role: 'admin' } }, data: { courseId, academyAuthoringProtocol: 'chapters-v1', ...data } })
  const learner = (data) => ({ auth: { uid: learnerId, token: { role: 'student' } }, data: { courseId, ...data } })
  const command = (data) => staff({ academyAdoption: { courseId, ...data } })
  const input = JSON.parse(JSON.stringify(require('./generated/academy-course-template.cjs').auraFoundationCourse))
  input.id = courseId; input.publicationStatus = 'review'
  const rootRef = db.doc(`courses/${courseId}`), progressRef = db.doc(`users/${learnerId}/progress/${courseId}`)
  await authoring.save(staff({ course: input, expectedRevision: 0 }))
  await authoring.transition(staff({ expectedRevision: 1, nextStatus: 'approved' }))
  await authoring.transition(staff({ expectedRevision: 2, nextStatus: 'published' }))
  const before = (await rootRef.get()).data(), oldVersion = before.modules[2].contentVersion
  await runtime.enrollInCourse(learner({}))
  const historical = { completedLessonIds: ['chapter-03-core', 'chapter-03-practice'], practiceSubmissionDefinitionVersions: { 'chapter-03-practice': 1 } }
  await progressRef.set(historical)
  const workbookRef = db.doc(`users/${learnerId}/academyWorkbooks/${courseId}__chapter-03-core`)
  await workbookRef.set({ courseId, lessonId: 'chapter-03-core', revision: 1, sharedWithCoach: false,
    body: JSON.stringify({ schemaVersion: 2, definitionVersion: 1, answers: {}, safetyAcknowledged: true }) })

  const emptyProposal = await adoption.readCandidate(staff({ adoptionCandidate: { courseId, chapter: 3 } }))
  assert.equal(emptyProposal.candidateId, null)
  await assert.rejects(adoption.mutate(command({ action: 'prepare', chapter: 3, expectedRevision: 3, expectedActorId: learnerId })), { code: 'permission-denied' })
  const concurrentProposals = await Promise.all([1, 2].map(() => adoption.mutate(command({ action: 'prepare', chapter: 3, expectedRevision: 3, expectedActorId: adminId }))))
  const prepared = concurrentProposals[0]
  assert.equal(concurrentProposals[0].candidateId, concurrentProposals[1].candidateId)
  assert.equal(concurrentProposals.filter((value) => value.duplicate).length, 1)
  assert.equal((await adoption.readCandidate(staff({ adoptionCandidate: { courseId, chapter: 3 } }))).candidateId, prepared.candidateId)
  const candidateId = prepared.candidateId
  const reviewCommand = (expectedReviewRevision) => command({ action: 'review', candidateId, expectedReviewRevision, decision: 'approved',
    checks: { content: true, assessment: true, references: true, safety: true },
    notes: 'EMULATOR TEST ONLY: checks an immutable source, private assessment, scoped references and safety limits; not a real scientific approval.' })
  await assert.rejects(adoption.mutate(reviewCommand(0)), { code: 'permission-denied' })
  // Emulator-only external attestation; this test never creates a production grant.
  const grantRef = db.doc(`academyScientificReviewers/${adminId}`)
  await grantRef.set({ enabled: true, qualificationVerified: true, scope: 'nutrition-education', revision: 1,
    qualificationReference: 'EMULATOR ONLY', chapters: [3], validUntil: Timestamp.fromMillis(Date.now() + 3600000) })
  await adoption.mutate(reviewCommand(0))
  const approvedCandidate = await adoption.readCandidate(staff({ adoptionCandidate: { courseId, candidateId } }))
  assert.equal(approvedCandidate.approvalValid, true)
  assert.equal(approvedCandidate.alreadyAdopted, false)
  const adopted = await Promise.all([1, 2].map(() => adoption.mutate(command({ action: 'adopt', candidateId, expectedRevision: 3, expectedReviewRevision: 1 }))))
  assert.equal(adopted.filter((result) => result.alreadyAdopted).length, 1)
  assert.equal((await rootRef.collection(COLLECTION).get()).size, 21)
  const working = (await rootRef.get()).data()
  assert.equal(working.status, 'draft')
  assert.deepEqual(working.publishedSnapshot, before.publishedSnapshot)
  assert.deepEqual(working.modules.filter((module) => module.order !== 3), before.modules.filter((module) => module.order !== 3))
  assert.deepEqual((await progressRef.get()).data(), historical)
  assert.equal((await adoption.readCandidate(staff({ adoptionCandidate: { courseId, candidateId } }))).alreadyAdopted, true)
  const stillLive = await runtime.listAcademyCourses(learner({ chapter: true, lessonId: 'chapter-03-core', chapterVersion: oldVersion }))
  assert.equal(stillLive.module.lessons[0].learningDesign.practice.version, 1)
  const editor = (await authoring.readForEditor(staff({ authoringCourseId: courseId, expectedRevision: 4 }))).course
  editor.publicationStatus = 'review'
  await authoring.save(staff({ course: editor, expectedRevision: 4 }))
  await authoring.transition(staff({ expectedRevision: 5, nextStatus: 'approved' }))
  await grantRef.update({ enabled: false })
  await assert.rejects(authoring.transition(staff({ expectedRevision: 6, nextStatus: 'published' })), { code: 'failed-precondition' })
  await grantRef.update({ enabled: true, revision: 2 })
  await assert.rejects(authoring.transition(staff({ expectedRevision: 6, nextStatus: 'published' })), { code: 'failed-precondition' })
  await adoption.mutate(reviewCommand(1))
  await authoring.transition(staff({ expectedRevision: 6, nextStatus: 'published' }))
  const root = (await rootRef.get()).data(), chapterVersion = root.modules[2].contentVersion
  assert.equal(root.publishedSnapshot.course.revision, 7)
  assert.equal((await rootRef.collection(COLLECTION).get()).size, 21)
  await assert.rejects(runtime.listAcademyCourses(learner({ chapter: true, lessonId: 'chapter-03-core', chapterVersion: oldVersion })), { code: 'aborted' })
  const selected = await runtime.listAcademyCourses(learner({ chapter: true, lessonId: 'chapter-03-core', chapterVersion }))
  assert.equal(selected.module.academyAdoption, undefined)
  assert.equal(selected.module.lessons[2].quiz.questions[0].correctIndex, undefined)
  assert.equal(selected.module.lessons[2].quiz.questions[0].explanation, undefined)
  assert.equal(JSON.stringify(selected).includes(candidateId), false)
  const catalog = (await runtime.listAcademyCourses(learner({ catalogOnly: true }))).courses.find((course) => course.id === courseId)
  assert.equal(catalog.academyReviewRequiredModuleIds, undefined)
  assert.equal(JSON.stringify(catalog).includes(candidateId), false)
  const answers = Object.entries(approvedCandidate.artifact.quizKeys['chapter-03-checkpoint'].answers).map(([questionId, optionIndex]) => ({ questionId, optionIndex }))
  const graded = await runtime.gradeCourseQuiz(learner({ lessonId: 'chapter-03-checkpoint', chapterVersion, requestId: randomUUID(), answers }))
  assert.equal(graded.passed, true)
  const checkpointComplete = await runtime.completeCourseLesson(learner({ lessonId: 'chapter-03-checkpoint', chapterVersion }))
  assert.equal(checkpointComplete.quizCompletionChapterVersions['chapter-03-checkpoint'], chapterVersion)
  assert.equal((await db.doc(`users/${learnerId}/progress/${courseId}`).get()).data().quizCompletionChapterVersions['chapter-03-checkpoint'], chapterVersion)
  const practiceRequest = (revision) => learner({ lessonId: 'chapter-03-practice', chapterVersion,
    practiceEvidence: { workbookLessonId: 'chapter-03-core', workbookRevision: revision } })
  await assert.rejects(runtime.completeCourseLesson(practiceRequest(1)), { code: 'failed-precondition' })
  const practice = selected.module.lessons[0].learningDesign.practice
  await workbookRef.update({ revision: 2, body: JSON.stringify({ schemaVersion: 2, definitionVersion: practice.version,
    definitionHash: practice.identityHash, answers: Object.fromEntries(practice.fields.map((field) => [field.id, `Test evidence for ${field.label}`])), safetyAcknowledged: true }) })
  const completed = await runtime.completeCourseLesson(practiceRequest(2))
  assert.equal(completed.practiceSubmissionDefinitionVersions['chapter-03-practice'], practice.version)
  assert.equal(completed.practiceSubmissionDefinitionHashes['chapter-03-practice'], practice.identityHash)
  assert.equal(completed.quizCompletionChapterVersions['chapter-03-checkpoint'], chapterVersion)
  assert.ok(completed.completedLessonIds.includes('chapter-03-core'))
  const submissions = await db.collection(`users/${learnerId}/academySubmissions`).get()
  assert.equal(submissions.size, 1)
  const submission = submissions.docs[0].data()
  assert.deepEqual(submission.rubric.criteria, practice.reviewRubric.criteria)
  assert.equal((await rootRef.collection('academyReviewHistory').get()).size, 2)
})

test('real media authorization and version-bound workout transactions preserve proofs and reject archived access', async (t) => {
  const app = initializeApp({ projectId: 'demo-aura-fitness' }, `academy-media-${randomUUID()}`)
  t.after(() => deleteApp(app))
  const db = getFirestore(app, 'academy-storage-tests')
  const storage = createAcademyCourseStorage({ db, HttpsError })
  const userId = `student-${randomUUID()}`, courseId = `media-${randomUUID()}`, programId = `program-${randomUUID()}`
  const path = `course-media/${courseId}/reading/file.pdf`
  const workoutRef = { programId, sessionId: 'session', versionId: 'v1' }
  const course = { schemaVersion: 2, revision: 1, status: 'published', title: 'Media integration',
    settings: { accessTier: 'free', visibility: 'members', dripSchedule: 'none', completionPercent: 80 },
    modules: [{ id: 'module', title: 'Chapter', order: 1, lessons: [
      { id: 'reading', title: 'Reading', type: 'Bài đọc', duration: '5 phút', resources: [{ id: 'file', title: 'PDF', kind: 'document', url: '',
        assetRef: { assetId: 'file', storagePath: path, status: 'ready' } }] },
      { id: 'workout', title: 'Legacy workout', type: 'Buổi tập', duration: '10 phút', workoutRef, completionPolicy: { mode: 'workout-complete' } },
    ] }] }
  const plan = storage.pack({ courseId, revision: 1, course, quizKeys: {} })
  const root = db.doc(`courses/${courseId}`)
  const batch = db.batch()
  storage.writeChapters(batch, plan)
  batch.set(root, { ...plan.manifest, publishedSnapshot: { active: true, course: plan.manifest } })
  batch.set(db.doc(`users/${userId}`), { role: 'student', membership: 'free', disabled: false })
  batch.set(db.doc(`enrollments/${userId}_${courseId}`), { userId, courseId, status: 'active' })
  batch.set(db.doc(`programs/${programId}`), { status: 'published' })
  batch.set(db.doc(`programs/${programId}/versions/v1`), { ...workoutRef, schemaVersion: 2,
    sessionsByDay: { 1: { id: 'session', dayLabel: 'Session', exercises: [{ id: 'exercise', name: 'Exercise', sets: 1 }] } } })
  await batch.commit()
  let signCount = 0
  // Only Storage signing is stubbed; all course, entitlement, chapter, program
  // and completion reads/writes use the actual Firestore transaction SDK.
  const fakeStorage = { bucket: () => ({ file: () => ({
    getMetadata: async () => [{ contentType: 'application/pdf', size: '12', metadata: { courseId, lessonId: 'reading', assetId: 'file', resourceKind: 'document' } }],
    getSignedUrl: async () => { signCount += 1; return ['https://storage.example.test/lease'] },
  }) }) }
  const runtimeDb = { doc: (value) => db.doc(value), collection: (value) => db.collection(value),
    runTransaction: (callback, options) => db.runTransaction(async (transaction) => await callback(transaction), options) }
  const runtime = academyRuntimeHandlers({ db: runtimeDb, HttpsError, FieldValue, Filter, storage: fakeStorage }).exports
  let chapterVersion = plan.manifest.modules[0].contentVersion
  const request = (data) => ({ auth: { uid: userId, token: { role: 'student' } }, data: { courseId, chapterVersion, ...data } })
  const media = await runtime.getCourseMediaUrl(request({ lessonId: 'reading', path }))
  assert.equal(media.chapterVersion, chapterVersion); assert.equal(signCount, 2)
  assert.equal((await runtime.getCourseWorkoutSession(request({ lessonId: 'workout', ...workoutRef }))).session.id, 'session')
  const log = { clientLogId: 'workout-log', ...workoutRef, durationSeconds: 300, perceivedExertion: 2,
    sets: [{ exerciseId: 'exercise', setNumber: 1, weightKg: 20, reps: 10 }] }
  const saved = await Promise.all([1, 2].map(() => runtime.saveCourseWorkoutLog(request({ lessonId: 'workout', log }))))
  assert.equal(saved[0].logId, saved[1].logId)
  const logDoc = await db.doc(`users/${userId}/workoutLogs/workout-log`).get()
  assert.equal(logDoc.data().chapterVersion, chapterVersion); assert.equal(logDoc.data().totalLoadKg, 200)
  const completed = await runtime.completeCourseLesson(request({ lessonId: 'workout', workoutLogId: 'workout-log' }))
  assert.ok(completed.completedLessonIds.includes('workout'))
  // A new reading revision changes the chapter hash, not the immutable workout.
  // Replaying verified evidence must preserve the original record verbatim.
  course.revision = 2
  course.modules[0].lessons[0].summary = 'Updated reading; the workout is unchanged.'
  const next = storage.pack({ courseId, revision: 2, course, quizKeys: {}, priorCourse: plan.manifest })
  const nextBatch = db.batch()
  storage.writeChapters(nextBatch, next)
  nextBatch.set(root, { ...next.manifest, publishedSnapshot: { active: true, course: next.manifest } })
  await nextBatch.commit()
  chapterVersion = next.manifest.modules[0].contentVersion
  assert.notEqual(chapterVersion, logDoc.data().chapterVersion)
  assert.equal((await runtime.saveCourseWorkoutLog(request({ lessonId: 'workout', log }))).chapterVersion, chapterVersion)
  assert.deepEqual((await logDoc.ref.get()).data(), logDoc.data())
  assert.ok((await runtime.completeCourseLesson(request({ lessonId: 'workout', workoutLogId: 'workout-log' }))).completedLessonIds.includes('workout'))
  await db.doc(`enrollments/${userId}_${courseId}`).update({ status: 'cancelled' })
  await assert.rejects(runtime.saveCourseWorkoutLog(request({ lessonId: 'workout', log: { ...log, clientLogId: 'denied-log' } })), { code: 'failed-precondition' })
  await assert.rejects(runtime.getCourseMediaUrl(request({ lessonId: 'reading', path })), { code: 'failed-precondition' })
  assert.equal((await db.doc(`users/${userId}/workoutLogs/denied-log`).get()).exists, false)
  assert.equal(signCount, 2)
})

test('real Firestore transactions preserve all twenty chapters and reject immutable collisions atomically', async (t) => {
  const app = initializeApp({ projectId: 'demo-aura-fitness' }, `academy-storage-${randomUUID()}`)
  t.after(() => deleteApp(app))
  // Rules tests clear the default database; isolate these transaction fixtures.
  const db = getFirestore(app, 'academy-storage-tests')
  const storage = createAcademyCourseStorage({ db, HttpsError })
  const { course, quizKeys } = normalizedAcademyTemplate(HttpsError)
  const courseId = `academy-storage-${randomUUID()}`
  const courseReference = db.doc(`courses/${courseId}`)
  course.status = 'published'
  const first = storage.pack({ courseId, revision: 1, course, quizKeys })
  await db.runTransaction(async (transaction) => {
    storage.writeChapters(transaction, first)
    transaction.create(courseReference, { ...first.manifest, publishedSnapshot: { active: true, course: first.manifest } })
    transaction.create(db.doc(`courseRevisions/${courseId}_000001`), { courseId, revision: 1, course: first.manifest })
  })
  assert.equal((await courseReference.collection(COLLECTION).get()).size, 20)
  const full = await storage.load({ courseId, course: first.manifest })
  assert.deepEqual(full.course.modules, course.modules)
  assert.deepEqual(full.quizKeys, quizKeys)
  let selectedReads = 0
  await storage.load({ courseId, course: first.manifest, moduleIds: [course.modules[8].id],
    read: (reference) => { selectedReads += 1; return reference.get() } })
  assert.equal(selectedReads, 1)

  course.status = 'draft'
  const oldSummary = course.modules[0].lessons[0].summary
  course.modules[0].lessons[0].summary = `${oldSummary}\nBản biên tập chưa xuất bản.`
  const second = storage.pack({ courseId, revision: 2, course, quizKeys, priorCourse: first.manifest })
  assert.equal(second.chapters.length, 1)
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(courseReference)
    assert.equal(current.data().revision, 1)
    storage.writeChapters(transaction, second)
    transaction.set(courseReference, { ...second.manifest, publishedSnapshot: current.data().publishedSnapshot })
    transaction.create(db.doc(`courseRevisions/${courseId}_000002`), { courseId, revision: 2, course: second.manifest })
  })
  const root = (await courseReference.get()).data()
  const live = await storage.load({ courseId, course: storage.publishedCourse(root), moduleIds: [course.modules[0].id] })
  assert.equal(live.course.modules[0].lessons[0].summary, oldSummary)
  assert.equal((await courseReference.collection(COLLECTION).get()).size, 21)
  const firstRevision = (await db.doc(`courseRevisions/${courseId}_000001`).get()).data()
  assert.deepEqual(firstRevision.course, first.manifest)

  course.modules[1].lessons[0].summary += '\nThay đổi kiểm thử sẽ bị hủy.'
  const third = storage.pack({ courseId, revision: 3, course, quizKeys, priorCourse: second.manifest })
  await assert.rejects(db.runTransaction(async (transaction) => {
    storage.writeChapters(transaction, third)
    transaction.set(courseReference, third.manifest)
    // An accidental overwrite must abort the NEW chapter and root together.
    transaction.create(db.doc(first.chapters[0].path), first.chapters[0].document)
  }), (error) => error.code === 6 || error.code === 'already-exists')
  assert.equal((await courseReference.get()).data().revision, 2)
  assert.equal((await db.doc(third.chapters[0].path).get()).exists, false)
  assert.equal((await courseReference.collection(COLLECTION).get()).size, 21)
})

test('real authoring, publication, catalog, grade and completion remain consistent across restore and concurrent saves', async (t) => {
  const app = initializeApp({ projectId: 'demo-aura-fitness' }, `academy-authoring-${randomUUID()}`)
  t.after(() => deleteApp(app))
  const db = getFirestore(app, 'academy-storage-tests')
  const storage = createAcademyCourseStorage({ db, HttpsError })
  const validation = academyAuthoringValidation(HttpsError)
  const adminId = `author-${randomUUID()}`
  const learnerId = `learner-${randomUUID()}`
  await db.doc(`users/${adminId}`).set({ role: 'admin', disabled: false })
  await db.doc(`users/${learnerId}`).set({ role: 'student', disabled: false, membership: 'free' })
  const authorize = async (request, read) => {
    const profile = (await read(db.doc(`users/${request.auth.uid}`))).data()
    if (!profile || profile.disabled || profile.role !== request.auth.token.role || !['admin', 'editor'].includes(profile.role)) {
      throw new HttpsError('permission-denied', 'No staff permission')
    }
    return { actorId: request.auth.uid, role: profile.role }
  }
  const authoring = createAcademyAuthoringHandlers({ db, HttpsError, FieldValue, storage, authorize,
    validateId: validation.courseId, normalize: validation.normalizeCourseDraftInput, assertSaveStatus: validation.assertCourseContentSaveStatus,
    assertReady: validation.assertCourseReadyToPublish, buildQuizContentHash: validation.buildQuizContentHash, buildDiff: validation.buildCourseRevisionDiff })
  // VM-extracted production callbacks return a Promise from their own realm.
  // The SDK checks native instanceof Promise, so bridge the test-only boundary.
  const runtimeDb = { doc: (path) => db.doc(path), collection: (path) => db.collection(path),
    runTransaction: (callback) => db.runTransaction(async (transaction) => await callback(transaction)) }
  const runtime = academyRuntimeHandlers({ db: runtimeDb, HttpsError, FieldValue, Filter }).exports
  const courseId = `academy-authoring-${randomUUID()}`
  const rootRef = db.doc(`courses/${courseId}`)
  const input = { ...academyAuthoringFixture().input, id: courseId, publicationStatus: 'review' }
  const staff = (data) => ({ auth: { uid: adminId, token: { role: 'admin' } }, data: { courseId, academyAuthoringProtocol: 'chapters-v1', ...data } })
  const learner = (data = {}) => ({ auth: { uid: learnerId, token: { role: 'student' } }, data: { courseId, ...data } })
  await authoring.save(staff({ course: input, expectedRevision: 0 }))
  await authoring.transition(staff({ expectedRevision: 1, nextStatus: 'approved' }))
  await authoring.transition(staff({ expectedRevision: 2, nextStatus: 'published' }))
  const catalog = (await runtime.listAcademyCourses(learner({ catalogOnly: true }))).courses.find((course) => course.id === courseId)
  assert.equal(catalog.modules[0].lessons[0].summary, undefined)
  const chapterVersion = catalog.modules[0].contentVersion
  await runtime.enrollInCourse(learner())
  const selected = await runtime.listAcademyCourses(learner({ chapter: true, lessonId: 'quiz-1', chapterVersion }))
  assert.equal(selected.module.lessons[0].summary, 'Nội dung 1')
  assert.equal(selected.contentAccess, 'full')
  assert.equal(selected.module.lessons[2].quiz.questions[0].correctIndex, undefined)
  const quizRequest = learner({ lessonId: 'quiz-1', chapterVersion, requestId: randomUUID(), answers: [{ questionId: 'q-1', optionIndex: 0 }] })
  assert.equal((await runtime.gradeCourseQuiz(quizRequest)).passed, true)
  assert.ok((await runtime.completeCourseLesson(learner({ lessonId: 'quiz-1', chapterVersion }))).completedLessonIds.includes('quiz-1'))
  const firstPublishedAt = (await rootRef.get()).data().firstPublishedAt.toMillis()
  await authoring.restore(staff({ revision: 1, expectedRevision: 3 }))
  const editor = (await authoring.readForEditor(staff({ authoringCourseId: courseId, expectedRevision: 4 }))).course
  assert.equal(editor.publishedRevision, 3)
  editor.modules[0].lessons[0].summary = 'Edited, not live yet'
  editor.publicationStatus = 'review'
  const saves = await Promise.allSettled([1, 2].map(() => authoring.save(staff({ course: editor, expectedRevision: 4 }))))
  assert.equal(saves.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(saves.find((result) => result.status === 'rejected').reason.code, 'aborted')
  assert.equal((await rootRef.collection(COLLECTION).get()).size, 3, 'one changed chapter, not another whole course')
  const workingRoot = (await rootRef.get()).data()
  const staffChapterRequest = { authoringChapter: true, courseRevision: 5, lessonId: 'quiz-1', chapterVersion: workingRoot.modules[0].contentVersion }
  const staffChapter = await runtime.listAcademyCourses(staff(staffChapterRequest))
  assert.equal(staffChapter.contentAccess, 'staff-preview')
  assert.equal(staffChapter.module.lessons[0].summary, 'Edited, not live yet')
  assert.equal(staffChapter.module.lessons[2].quiz.questions[0].correctIndex, undefined)
  await assert.rejects(runtime.listAcademyCourses(staff({ ...staffChapterRequest, courseRevision: 4 })), { code: 'aborted' })
  await assert.rejects(runtime.listAcademyCourses(learner(staffChapterRequest)), { code: 'permission-denied' })
  assert.equal((await runtime.listAcademyCourses(learner({ chapter: true, lessonId: 'quiz-1', chapterVersion }))).module.lessons[0].summary, 'Nội dung 1')
  assert.equal((await runtime.listAcademyCourses(learner({ catalogOnly: true }))).courses.find((course) => course.id === courseId).revision, 3)
  await authoring.transition(staff({ expectedRevision: 5, nextStatus: 'approved' }))
  await authoring.transition(staff({ expectedRevision: 6, nextStatus: 'published' }))
  await assert.rejects(runtime.gradeCourseQuiz(quizRequest), { code: 'aborted' })
  const newRoot = (await rootRef.get()).data()
  assert.equal(newRoot.firstPublishedAt.toMillis(), firstPublishedAt)
  assert.equal(newRoot.publishedSnapshot.course.revision, 7)
  assert.equal(newRoot.modules[1].contentVersion.startsWith('r1_'), true)
  assert.ok((await db.doc(`users/${learnerId}/progress/${courseId}`).get()).data().completedLessonIds.includes('quiz-1'))
  assert.equal((await db.doc(`courseRevisions/${courseId}_000001`).get()).data().course.revision, 1)
})
