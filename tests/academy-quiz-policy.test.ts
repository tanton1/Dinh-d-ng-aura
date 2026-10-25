import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'
import { academyQuizCanReveal, academyQuizOptionOrder, selectAcademyQuizQuestions, academyQuizCompletionCurrent } from '../src/features/academy/quizPolicy'

test('historical completion does not confer a current versioned checkpoint pass', () => {
  const lesson = { id: 'quiz', contentVersion: 'r2_current' }
  assert.equal(academyQuizCompletionCurrent(lesson, ['quiz']), false)
  assert.equal(academyQuizCompletionCurrent(lesson, ['quiz'], { quiz: 'r1_old' }), false)
  assert.equal(academyQuizCompletionCurrent(lesson, [], { quiz: 'r2_current' }), false)
  assert.equal(academyQuizCompletionCurrent(lesson, ['quiz'], { quiz: 'r2_current' }), true)
  assert.equal(academyQuizCompletionCurrent({ id: 'legacy' }, ['legacy']), true)
})

const source = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('function stableQuizOrderScore('), source.indexOf('function courseLessonScopedId('))
const server = runInNewContext(`${helpers}\n({ quizQuestionsForAttempt, buildQuizContentHash })`, { createHash })
const questions = Array.from({ length: 16 }, (_, i) => ({ id: `q-${i + 1}`, question: `Câu ${i + 1}`, options: ['A', 'B', 'C'], mustPass: i === 11 }))

test('client and server select the same questions for subset/full and sequential/shuffle policies', () => {
  for (const order of ['sequential', 'shuffle']) for (const count of [1, 8, 16]) for (const uid of ['student-a', 'student-b']) {
    const frontend = selectAcademyQuizQuestions(questions, uid, 'chapter-03-checkpoint', count, order)
    const backend = server.quizQuestionsForAttempt({ questions, questionsPerAttempt: count, questionOrder: order }, uid, 'chapter-03-checkpoint')
    assert.deepEqual(frontend.map((q) => q.id), Array.from(backend, (q: { id: string }) => q.id))
    assert.ok(frontend.some((q) => q.mustPass))
  }
})

test('mandatory questions are never dropped even if authored count is lower than mandatory count', () => {
  const required = questions.map((q) => ({ ...q, mustPass: true }))
  assert.equal(selectAcademyQuizQuestions(required, 'a', 'l', 8).length, required.length)
})

test('option permutations are stable per attempt and retain original indexes for server grading', () => {
  const positions = new Set<number>()
  for (let chapter = 1; chapter <= 20; chapter++) {
    const seed = `student:chapter-${chapter}:q1:options:0`
    const ordered = academyQuizOptionOrder(['Đúng', 'Sai 1', 'Sai 2'], seed)
    assert.deepEqual(ordered, academyQuizOptionOrder(['Đúng', 'Sai 1', 'Sai 2'], seed))
    assert.deepEqual(ordered.map((entry) => entry.optionIndex).sort(), [0, 1, 2])
    assert.equal(ordered.find((entry) => entry.option === 'Đúng')?.optionIndex, 0)
    positions.add(ordered.findIndex((entry) => entry.optionIndex === 0))
  }
  assert.equal(positions.size, 3)
})

test('changing safety requirements or subset policy invalidates the old quiz proof hash', () => {
  const quiz = { id: 'quiz', passPercent: 80, questionsPerAttempt: 8, questionOrder: 'shuffle', questions }
  const key = Object.fromEntries(questions.map((q) => [q.id, 0]))
  const original = server.buildQuizContentHash(quiz, key)
  assert.notEqual(original, server.buildQuizContentHash({ ...quiz, questionsPerAttempt: 16 }, key))
  assert.notEqual(original, server.buildQuizContentHash({ ...quiz, questions: questions.map((q) => ({ ...q, mustPass: false })) }, key))
  assert.equal(original, server.buildQuizContentHash({ ...quiz, revealMode: 'never' }, key))
})

test('feedback policy hides review until the configured condition is satisfied', () => {
  assert.equal(academyQuizCanReveal('never', true), false)
  assert.equal(academyQuizCanReveal('never', false), false)
  assert.equal(academyQuizCanReveal('after-pass', false), false)
  assert.equal(academyQuizCanReveal('after-pass', true), true)
  assert.equal(academyQuizCanReveal('after-submit', false), true)
})
