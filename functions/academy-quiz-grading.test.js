'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { academyRuntimeFixture: fixture } = require('./test-support/academy-runtime-fixture')
const request = (id = 'request_1234567890', correct = true) => ({ data: { courseId: 'course', lessonId: 'lesson', requestId: id, answers: [{ questionId: 'q1', optionIndex: correct ? 0 : 1 }, { questionId: 'q2', optionIndex: correct ? 0 : 1 }] } })

test('retrying the same submission returns the same attempt and consumes one slot only', async () => {
  const f = fixture()
  const first = await f.grade(request())
  const second = await f.grade(request())
  assert.equal(first.attemptId, second.attemptId)
  assert.equal(second.attemptsRemaining, 1)
  assert.equal([...f.store.values()].find((item) => item.count)?.count, 1)
  assert.equal([...f.store.keys()].filter((path) => path.includes('/quizAttempts/')).length, 1)
})

test('reusing a request ID with different answers is rejected, not counted', async () => {
  const f = fixture()
  await f.grade(request())
  await assert.rejects(f.grade(request('request_1234567890', false)), { code: 'already-exists' })
  assert.equal([...f.store.values()].find((item) => item.count)?.count, 1)
})

test('never and failed after-pass do not expose feedback in response OR owner-readable documents', async () => {
  for (const mode of ['never', 'after-pass']) {
    const f = fixture(mode)
    const result = await f.grade(request('request_1234567890', false))
    assert.equal(result.review.length, 0)
    const attempt = [...f.store.entries()].find(([path]) => path.includes('/quizAttempts/'))[1]
    assert.equal(attempt.review.length, 0)
    assert.doesNotMatch(JSON.stringify(attempt), /Private feedback|Another explanation/)
  }
})

test('a passing after-pass response provides feedback and a proof; attempts remain bounded', async () => {
  const f = fixture('after-pass')
  const result = await f.grade(request())
  assert.equal(result.review.length, 2)
  assert.ok([...f.store.values()].some((item) => item.kind === 'quiz-pass'))
  await f.grade(request('request_abcdefghij'))
  await assert.rejects(f.grade(request('request_klmnopqrst')), { code: 'resource-exhausted' })
  // Replay is allowed even after the quota is exhausted and must not add a third attempt.
  assert.equal((await f.grade(request())).attemptsRemaining, 1)
  assert.equal([...f.store.keys()].filter((path) => path.includes('/quizAttempts/')).length, 2)
})

test('every grading read occurs inside the transaction and revocation during a retry writes nothing', async () => {
  for (const revoke of [
    (f) => { f.store.get('users/student').disabled = true },
    (f) => { f.store.get('enrollments/student_course').status = 'cancelled' },
    (f) => { f.store.get('courses/course').status = 'archived' },
    (f) => { f.store.get('courses/course').settings.accessTier = 'pro' },
  ]) {
    const f = fixture()
    f.retryOnce(() => revoke(f))
    await assert.rejects(f.grade(request()))
    assert.equal(f.transactionReads.length, 2)
    assert.ok(f.transactionReads.every((reads) => reads.includes('users/student') && reads.includes('courses/course') && reads.includes('enrollments/student_course')))
    assert.equal([...f.store.keys()].some((path) => /quizAttempts|quizAttemptCounters|courseLessonProofs/.test(path)), false)
  }
})

test('retry reads the latest private key instead of granting a stale passing proof', async () => {
  const f = fixture()
  f.retryOnce(() => { f.key.answers.q1 = 1; f.key.answers.q2 = 1 })
  const result = await f.grade(request())
  assert.equal(result.passed, false)
  assert.equal(result.scorePercent, 0)
  assert.ok(f.transactionReads.every((reads) => reads.includes('courses/course/quizKeys/lesson')))
  assert.equal([...f.store.keys()].some((path) => path.includes('/courseLessonProofs/')), false)
  assert.equal([...f.store.values()].find((item) => item.count)?.count, 1)
})

test('versioned grading uses immutable chapter keys, not mutable authoring keys, and binds its proof', async () => {
  const f = fixture()
  const plan = f.versioned()
  // Simulate authoring a different answer while the earlier chapter is live.
  f.key.answers = { q1: 1, q2: 1 }
  const input = request()
  input.data.chapterVersion = plan.manifest.modules[0].contentVersion
  const result = await f.grade(input)
  assert.equal(result.passed, true)
  assert.equal(result.chapterVersion, input.data.chapterVersion)
  assert.equal(f.transactionReads[0].filter((path) => path.includes('/academyChapterVersions/')).length, 1)
  assert.equal(f.transactionReads[0].includes('courses/course/quizKeys/lesson'), false)
  const proof = [...f.store.values()].find((item) => item.kind === 'quiz-pass')
  assert.equal(proof.chapterVersion, input.data.chapterVersion)
  await assert.rejects(f.grade(request('request_stale_1234')), { code: 'aborted' })
})

test('publication changing during grading rejects the old chapter without consuming an attempt', async () => {
  const f = fixture()
  const plan = f.versioned()
  const input = request()
  input.data.chapterVersion = plan.manifest.modules[0].contentVersion
  f.retryOnce(() => {
    f.course.revision = 2
    f.course.modules[0].lessons[0].summary = 'Revised teaching context'
    f.versioned()
  })
  await assert.rejects(f.grade(input), { code: 'aborted' })
  assert.equal([...f.store.keys()].some((path) => /quizAttempts|quizAttemptCounters|courseLessonProofs/.test(path)), false)
})

test('idempotent replay still requires current access and does not disclose old feedback after revocation', async () => {
  const f = fixture()
  await f.grade(request())
  f.store.get('enrollments/student_course').status = 'cancelled'
  await assert.rejects(f.grade(request()), { code: 'failed-precondition' })
  assert.equal([...f.store.keys()].filter((path) => path.includes('/quizAttempts/')).length, 1)
})

test('safe results never expose answer-derived hashes, and replay honors a stricter reveal policy', async () => {
  const f = fixture()
  const result = await f.grade(request())
  assert.doesNotMatch(JSON.stringify(result), /"contentHash"|"requestHash"|"answers"|"correctIndex"/)
  assert.equal(result.review.length, 2)
  f.quiz.publicSettings.revealMode = 'never'
  const replay = await f.grade(request())
  assert.equal(replay.review.length, 0)
  assert.equal(replay.attemptId, result.attemptId)
  assert.equal([...f.store.values()].find((item) => item.count)?.count, 1)
})
