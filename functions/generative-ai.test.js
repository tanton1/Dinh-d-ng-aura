const assert = require('node:assert/strict')
const test = require('node:test')

const { buildTask, getModelCandidates } = require('./generative-ai')

test('content AI model candidates use stable defaults and remove duplicates', () => {
  const keys = [
    'OPENROUTER_MODEL',
    'OPENROUTER_FALLBACK_MODEL',
    'OPENROUTER_TEXT_MODEL',
    'OPENROUTER_TEXT_FALLBACK_MODEL',
  ]
  const originals = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    keys.forEach((key) => delete process.env[key])
    assert.deepEqual(getModelCandidates(), ['google/gemini-3.7-flash', 'google/gemini-3.6-flash'])
    process.env.OPENROUTER_TEXT_MODEL = 'google/gemini-3.7-flash'
    process.env.OPENROUTER_TEXT_FALLBACK_MODEL = 'google/gemini-3.7-flash'
    assert.deepEqual(getModelCandidates(), ['google/gemini-3.7-flash'])
  } finally {
    keys.forEach((key) => {
      if (originals[key] === undefined) delete process.env[key]
      else process.env[key] = originals[key]
    })
  }
})

test('content AI supports only server-defined actions and bounded payloads', () => {
  const task = buildTask('course-quiz', {
    lessonTitle: 'Protein basics',
    lessonSummary: 'A short lesson about protein.',
  })
  assert.equal(task.schema.required.includes('questions'), true)
  assert.match(task.prompt, /Protein basics/)
  assert.throws(() => buildTask('unknown', {}), /not supported/)
  assert.throws(
    () => buildTask('lesson-summary', {
      courseTitle: 'Course',
      lessonTitle: 'Lesson',
      lessonContent: 'x'.repeat(8001),
    }),
    /too long/,
  )
})

test('content AI action schemas require the client response roots', () => {
  const cases = [
    ['course-outline', { topic: 'A', audience: 'B', weeks: 4 }, 'modules'],
    ['course-memory', { lessonTitle: 'A', lessonSummary: 'B' }, 'flashcards'],
    ['lesson-summary', { courseTitle: 'A', lessonTitle: 'B', lessonContent: 'C' }, 'takeaways'],
    ['recipe', { prompt: 'A', goal: 'fat-loss', mealType: 'lunch' }, 'ingredients'],
    ['meal-plan', { goal: 'fat-loss', targetCalories: 1600, targetProtein: 120 }, 'sampleDays'],
  ]
  cases.forEach(([action, payload, root]) => {
    assert.equal(buildTask(action, payload).schema.required.includes(root), true)
  })
})
