'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { auraPracticeDefinition, academyWorkbookDocumentId, validateAcademyPracticeSubmission } = require('./academy-practice')

const definition = { coreLessonId: 'chapter-03-core', design: { practice: { version: 2, fields: [
  { id: 'context', label: 'Bối cảnh', kind: 'long', required: true },
  { id: 'reviewAt', label: 'Ngày rà', kind: 'date', required: true },
  { id: 'extra', label: 'Ghi chú', kind: 'long', required: false },
] } } }
const state = { schemaVersion: 2, definitionVersion: 2, answers: { context: 'Ví dụ bữa ăn, không phải thực đơn điều trị' }, reviewAt: '2026-10-24', safetyAcknowledged: true }
const payload = () => ({ courseId: 'nutrition-foundation', definition,
  workbookDocument: { courseId: 'nutrition-foundation', lessonId: 'chapter-03-core', revision: 7, body: JSON.stringify(state) },
  evidence: { workbookLessonId: 'chapter-03-core', workbookRevision: 7 },
})

test('practice submission resolves only the matching Aura core, not arbitrary manual lessons', () => {
  const module = { id: 'nutrition-chapter-03', lessons: [{ id: 'chapter-03-core', learningDesign: definition.design }] }
  assert.deepEqual(auraPracticeDefinition(module, { id: 'chapter-03-practice' }), definition)
  assert.equal(auraPracticeDefinition(module, { id: 'chapter-04-practice' }), null)
  assert.equal(auraPracticeDefinition({ ...module, id: 'custom' }, { id: 'chapter-03-practice' }), null)
  assert.equal(academyWorkbookDocumentId('a b', 'chapter-03-core'), 'a%20b__chapter-03-core')
})

test('complete synchronized evidence produces a version-bound proof, not a coach grade', () => {
  const result = validateAcademyPracticeSubmission(payload())
  assert.equal(result.ok, true)
  assert.equal(result.workbookRevision, 7)
  assert.equal(result.definitionVersion, 2)
  assert.match(result.contentHash, /^[a-f0-9]{64}$/)
  assert.equal(result.grade, undefined)
})

test('missing, blank, wrong-version, malformed and unsafe workbooks cannot complete practice', () => {
  for (const body of ['broken-json', JSON.stringify({ ...state, answers: {} }), JSON.stringify({ ...state, answers: { context: ' ' } }),
    JSON.stringify({ ...state, safetyAcknowledged: false }), JSON.stringify({ ...state, definitionVersion: 1 }),
    JSON.stringify({ ...state, reviewAt: '2026-02-31' }), JSON.stringify({ ...state, reviewAt: 'tomorrow' })]) {
    const input = payload(); input.workbookDocument.body = body
    assert.equal(validateAcademyPracticeSubmission(input).ok, false, body)
  }
})

test('submission must target the same course, core lesson and cloud revision just reviewed', () => {
  for (const [field, value] of [['courseId', 'other-course'], ['lessonId', 'chapter-04-core'], ['revision', 8]]) {
    const input = payload(); input.workbookDocument[field] = value
    assert.equal(validateAcademyPracticeSubmission(input).ok, false)
  }
  assert.equal(validateAcademyPracticeSubmission({ ...payload(), evidence: undefined }).ok, false)
  assert.equal(validateAcademyPracticeSubmission({ ...payload(), workbookDocument: undefined }).ok, false)
})

test('bespoke criteria require the exact public definition identity even when the numeric version is unchanged', () => {
  const changed = payload()
  changed.definition = { ...definition, design: { practice: { ...definition.design.practice,
    reviewRubric: { version: 2, criteria: [] }, identityHash: 'a'.repeat(64) } } }
  assert.equal(validateAcademyPracticeSubmission(changed).ok, false)
  changed.workbookDocument.body = JSON.stringify({ ...state, definitionHash: 'b'.repeat(64) })
  assert.equal(validateAcademyPracticeSubmission(changed).ok, false)
  changed.workbookDocument.body = JSON.stringify({ ...state, definitionHash: 'a'.repeat(64) })
  assert.equal(validateAcademyPracticeSubmission(changed).ok, true)
})

test('changing required evidence or the published definition changes the proof hash', () => {
  const first = validateAcademyPracticeSubmission(payload())
  const changed = payload(); changed.workbookDocument.body = JSON.stringify({ ...state, answers: { context: 'Bài mới' } })
  assert.notEqual(validateAcademyPracticeSubmission(changed).contentHash, first.contentHash)
  const newDefinition = { ...definition, design: { practice: { ...definition.design.practice, title: 'Đầu ra mới' } } }
  assert.notEqual(validateAcademyPracticeSubmission({ ...payload(), definition: newDefinition }).definitionHash, first.definitionHash)
})

test('completion transaction reads evidence before writes and keeps coach review distinct', () => {
  const source = readFileSync(require.resolve('./index'), 'utf8')
  const block = source.slice(source.indexOf('exports.completeCourseLesson ='), source.indexOf('exports.gradeCourseQuiz ='))
  assert.match(block, /transaction.get\(db.doc\(`users\/\$\{userId\}\/academyWorkbooks/)
  assert.match(block, /validateAcademyPracticeSubmission/)
  assert.match(block, /reviewStatus: 'not-reviewed'/)
  assert.match(block, /practiceSubmissionRevisions/)
  assert.ok(block.indexOf('validateAcademyPracticeSubmission') < block.indexOf('transaction.set('))
})
