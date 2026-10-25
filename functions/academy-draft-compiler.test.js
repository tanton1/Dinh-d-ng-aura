'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createAcademyDraftCompiler } = require('./academy-draft-compiler')
const { createAcademyCourseStorage, LIMITS } = require('./academy-course-storage')
const { normalizedAcademyTemplate, academyAuthoringValidation } = require('./test-support/academy-template-fixture')
const { getAcademyLearningDraft } = require('./generated/academy-learning-drafts.cjs')
const { getAcademyLearningCheckpoint } = require('./generated/academy-learning-checkpoints.cjs')
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }
const clone = (value) => JSON.parse(JSON.stringify(value))
const validation = academyAuthoringValidation(HttpsError)
const template = normalizedAcademyTemplate(HttpsError)
const storage = createAcademyCourseStorage({ db: {}, HttpsError })
const compiler = createAcademyDraftCompiler({ HttpsError, normalize: validation.normalizeCourseDraftInput,
  buildQuizContentHash: validation.buildQuizContentHash, canonical: storage.canonical })
const inputFor = (chapter) => {
  const previousModule = clone(template.course.modules[chapter - 1])
  return { courseId: template.identifier, course: template.course, previousModule,
    previousQuizKeys: Object.fromEntries(previousModule.lessons.filter((lesson) => template.quizKeys[lesson.id]).map((lesson) => [lesson.id, template.quizKeys[lesson.id]])),
    packet: clone(getAcademyLearningDraft(chapter)), checkpointQuestions: clone(getAcademyLearningCheckpoint(chapter)) }
}
const unescape = (value) => value.replace(/\\([\\`*_{}[\]<>#+!|])/g, '$1')

test('all twenty candidates preserve full authored paragraphs, examples, cases, rubrics and scoped sources within storage limits', () => {
  for (let chapter = 1; chapter <= 20; chapter++) {
    const input = inputFor(chapter), before = clone(input)
    const artifact = compiler.compile(input), { unit } = input.packet
    assert.deepEqual(input, before, 'pure compilation cannot edit the source or current course')
    assert.deepEqual(artifact.source, input.packet)
    assert.deepEqual(artifact.checkpointQuestions, input.checkpointQuestions)
    assert.deepEqual(artifact, compiler.compile(input), 'same input gives an exact deterministic review candidate')
    assert.ok(Buffer.byteLength(JSON.stringify(artifact)) < LIMITS.chapterBytes)
    const core = artifact.module.lessons[0], body = unescape(core.primaryContent.body)
    const expected = [unit.audience, unit.scope, ...unit.coachExtension, ...unit.safety,
      ...unit.objectives.flatMap((item) => [item.outcome, item.evidence]),
      ...unit.sections.flatMap((item) => [item.title, ...item.paragraphs, ...item.takeaways]),
      ...unit.workedExamples.flatMap((item) => [item.title, item.prompt, ...item.given, ...item.steps, item.answer, item.limitation]),
      ...unit.cases.flatMap((item) => [item.title, item.context, item.question, ...item.reasoning, item.safeNextStep, item.commonError]),
      ...unit.practice.steps, ...unit.practice.modelResponse,
      ...unit.practice.fields.flatMap((field) => [field.label, field.prompt]),
      ...unit.practice.rubric.flatMap((item) => [item.label, ...item.levels]),
      ...input.packet.sources.flatMap((source) => [source.title, source.organization, source.supports, source.limitations, source.checkedAt])]
    for (const text of expected) assert.ok(body.includes(text), `chapter ${chapter} lost: ${text.slice(0, 90)}`)
    assert.deepEqual(core.learningDesign.practice.reviewRubric.criteria, unit.practice.rubric)
    assert.equal(core.learningDesign.practice.version, 2)
    assert.match(core.learningDesign.practice.identityHash, /^[a-f0-9]{64}$/)
    assert.deepEqual(core.learningDesign.microChecks.map((item) => item.correctIndex), input.packet.formativeChecks.map((item) => item.correctIndex))
    const quiz = artifact.module.lessons[2].quiz
    assert.equal(quiz.questions.length, 8)
    assert.equal(quiz.publicSettings.questionsPerAttempt, 8)
    assert.ok(quiz.questions.every((question) => question.correctIndex === undefined))
    const answers = artifact.quizKeys[artifact.module.lessons[2].id].answers
    assert.deepEqual(answers, Object.fromEntries(input.checkpointQuestions.map((question) => [question.id, question.correctIndex])))
    validation.assertCourseReadyToPublish({ ...template.course, modules: [artifact.module] }, new Map(Object.entries(artifact.quizKeys)))
    const plan = storage.pack({ courseId: template.identifier, revision: 2, course: { ...template.course, modules: [artifact.module] }, quizKeys: artifact.quizKeys })
    assert.equal(plan.chapters.length, 1)
    assert.ok(Buffer.byteLength(JSON.stringify(plan.chapters[0].document)) < LIMITS.chapterBytes)
    assert.equal(plan.manifest.modules[0].lessons[2].quiz, undefined)
  }
})

test('recompiling identical practice keeps its version; changed criteria increment version and server identity', () => {
  const input = inputFor(3), first = compiler.compile(input)
  const nextInput = { ...input, previousModule: first.module, previousQuizKeys: first.quizKeys }
  const next = compiler.compile(nextInput)
  assert.deepEqual(next.module, first.module)
  assert.equal(next.module.lessons[0].learningDesign.practice.version, 2)
  nextInput.packet = clone(input.packet)
  nextInput.packet.unit.practice.fields[0].prompt += ' Nêu rõ dữ liệu còn thiếu.'
  const changed = compiler.compile(nextInput)
  assert.equal(changed.module.lessons[0].learningDesign.practice.version, 3)
  assert.notEqual(changed.module.lessons[0].learningDesign.practice.identityHash, first.module.lessons[0].learningDesign.practice.identityHash)
})

test('adoption keeps resource links and duration but replaces obsolete primary content, quiz, bindings and provenance', () => {
  const input = inputFor(1), lesson = input.previousModule.lessons[0]
  lesson.resources = [{ id: 'original-pdf', title: 'Tài liệu gốc', kind: 'document', isPrimary: true, url: 'https://example.org/original.pdf' }]
  lesson.primaryContent = { kind: 'resource', resourceId: 'original-pdf' }
  lesson.provenance = { source: 'NotebookLM', importBatchId: 'obsolete' }
  lesson.quiz = { id: 'obsolete' }; lesson.workoutRef = { programId: 'obsolete' }
  const result = compiler.compile(input).module.lessons[0]
  assert.equal(result.duration, lesson.duration)
  assert.equal(result.resources[0].url, lesson.resources[0].url)
  assert.equal(result.primaryContent.kind, 'rich-text')
  assert.equal(result.resources[0].isPrimary, undefined)
  for (const key of ['quiz', 'provenance', 'workoutRef']) assert.equal(result[key], undefined)
})

test('wrong chapter structure, source scheme, objective coverage or private answers fail closed', () => {
  for (const mutate of [
    (input) => { input.previousModule.lessons.push(clone(input.previousModule.lessons[0])) },
    (input) => { input.previousModule.id = 'foreign' },
    (input) => { input.packet.sources[0].url = 'http://example.org' },
    (input) => { input.checkpointQuestions[0].correctIndex = 99 },
    (input) => { input.checkpointQuestions = input.checkpointQuestions.filter((question) => question.competencyId !== input.packet.unit.objectives[0].id) },
    (input) => { input.checkpointQuestions[0].remediationCardIds = ['foreign'] },
  ]) {
    const input = inputFor(3); mutate(input)
    assert.throws(() => compiler.compile(input), { code: 'failed-precondition' })
  }
  const input = inputFor(3)
  input.packet.sources[0].url = 'https://example.org/study_(version_2)'
  assert.ok(compiler.compile(input).module.lessons[0].primaryContent.body.includes('https://example.org/study_%28version_2%29'))
})
