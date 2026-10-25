import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { academyLearningDraftUnits, getAcademyLearningDraft } from '../content/academy/learning-drafts'
import { getAcademyLearningCheckpoint } from '../content/academy/learning-checkpoints'
import { academyEvidenceSources } from '../content/academy/references'
import { academyDraftChapterNumbers, academyDraftCurriculumSize } from '../src/features/academy/draftCatalog'

const foundationChapters = [1, 2, 4, 5]

test('draft registry matches the metadata-only catalog, rejects unsupported inputs and keeps private banks separate', () => {
  assert.deepEqual(academyLearningDraftUnits.map((unit) => unit.chapter), [...academyDraftChapterNumbers])
  assert.deepEqual([...academyDraftChapterNumbers], Array.from({ length: 20 }, (_, index) => index + 1))
  assert.equal(academyDraftCurriculumSize, 20)
  for (const chapter of [0, -1, 21, 1.1, NaN, Infinity, '1'] as number[]) {
    assert.equal(getAcademyLearningDraft(chapter), null)
    assert.equal(getAcademyLearningCheckpoint(chapter), null)
  }
  const ids = new Set<string>()
  for (const unit of academyLearningDraftUnits) {
    const packet = getAcademyLearningDraft(unit.chapter)!
    assert.equal(unit.review.status, 'draft-needs-review')
    assert.equal(unit.review.requiresQualifiedReviewer, true)
    assert.match(unit.revision, /^\d{4}-\d{2}-\d{2}\.\d+$/)
    assert.deepEqual(Object.keys(packet).sort(), ['formativeChecks', 'schemaVersion', 'sources', 'unit'])
    assert.ok(Buffer.byteLength(JSON.stringify(packet)) < 100_000)
    assert.doesNotMatch(JSON.stringify(packet), /checkpoint-v1|mustPass|quizAnswerKeys|competencyId/)
    for (const prerequisite of unit.prerequisites) assert.ok(prerequisite > 0 && prerequisite < unit.chapter)
    for (const question of getAcademyLearningCheckpoint(unit.chapter)!) {
      assert.ok(!ids.has(question.id), question.id)
      ids.add(question.id)
    }
  }
  assert.equal(ids.size, academyDraftChapterNumbers.length * 8)
  assert.deepEqual(getAcademyLearningDraft(1)!.unit.prerequisites, [])
})

for (const chapter of [...foundationChapters, 11, 12, 13, 14, 15, 16, 19, 20]) {
  test(`authored chapter ${chapter} teaches and assesses each objective with bespoke practice and sourced reasoning`, () => {
    const { unit, sources, formativeChecks } = getAcademyLearningDraft(chapter)!
    const questions = getAcademyLearningCheckpoint(chapter)!
    const objectiveIds = new Set(unit.objectives.map((item) => item.id))
    const sectionIds = new Set(unit.sections.map((item) => item.id))
    assert.equal(objectiveIds.size, 4)
    assert.equal(sectionIds.size, unit.sections.length)
    assert.ok(unit.sections.length >= 4)
    assert.ok(unit.scope.length > 70)
    assert.ok(unit.safety.length >= 3)
    assert.equal(new Set(unit.referenceIds).size, unit.referenceIds.length)
    assert.deepEqual(sources.map((source) => source.id), unit.referenceIds)
    for (const source of sources) {
      assert.ok(academyEvidenceSources.includes(source))
      assert.equal(new URL(source.url).protocol, 'https:')
      assert.ok(source.supports.length > 30 && source.limitations.length > 30)
      assert.match(source.checkedAt, /^\d{4}-\d{2}-\d{2}$/)
    }
    for (const section of unit.sections) {
      assert.ok(section.paragraphs.length >= 2)
      assert.ok(section.paragraphs.every((paragraph) => paragraph.length >= 100), section.id)
      assert.ok(section.sourceIds.length && section.objectiveIds.length)
      for (const id of section.sourceIds) assert.ok(unit.referenceIds.includes(id), id)
      for (const id of section.objectiveIds) assert.ok(objectiveIds.has(id), id)
    }
    assert.equal(formativeChecks.length, 4)
    assert.equal(new Set(formativeChecks.map((item) => item.correctIndex)).size, 4)
    assert.equal(questions.length, 8)
    assert.equal(new Set(questions.map((item) => item.question)).size, 8)
    assert.ok(questions.some((item) => item.mustPass))
    for (const objective of unit.objectives) {
      assert.ok(unit.sections.some((item) => item.objectiveIds.includes(objective.id)))
      assert.equal(formativeChecks.filter((item) => item.objectiveId === objective.id).length, 1)
      assert.equal(questions.filter((item) => item.competencyId === objective.id).length, 2)
      assert.ok(objective.outcome.length > 30 && objective.evidence.length > 30)
    }
    for (const check of formativeChecks) {
      assert.ok(sectionIds.has(check.sectionId))
      assert.equal(new Set(check.options).size, 4)
      assert.ok(check.feedback.length > 35)
    }
    for (const question of questions) {
      assert.ok(objectiveIds.has(question.competencyId!))
      assert.equal(question.kind, 'single')
      assert.equal(new Set(question.options).size, 4)
      assert.ok(question.explanation!.length > 35)
      assert.ok(question.remediationCardIds!.every((id) => sectionIds.has(id)))
      assert.ok(!formativeChecks.some((check) => check.prompt === question.question))
    }
    for (const answerIndex of [0, 1, 2, 3]) assert.equal(questions.filter((item) => item.correctIndex === answerIndex).length, 2)
    assert.equal(unit.workedExamples.length, 3)
    assert.equal(unit.cases.length, 3)
    for (const item of unit.workedExamples) {
      assert.ok(item.steps.length >= 3 && item.given.length)
      assert.ok(item.answer.length > 30 && item.limitation.length > 30)
      for (const id of item.objectiveIds) assert.ok(objectiveIds.has(id))
    }
    for (const item of unit.cases) {
      assert.ok(item.reasoning.length >= 3)
      assert.ok(item.safeNextStep.length > 30 && item.commonError.length > 30)
    }
    assert.deepEqual(unit.practice.fields.map((field) => field.id), ['context', 'hypothesis', 'action', 'minimum', 'data', 'stop'])
    assert.ok(unit.practice.fields.every((field) => field.required && field.prompt.length > 30))
    assert.deepEqual(unit.practice.rubric.map((row) => row.id), ['data', 'mechanism', 'feasibility', 'safety'])
    assert.ok(unit.practice.rubric.every((row) => new Set(row.levels).size === 3))
    assert.ok(unit.practice.modelResponse.length >= 3)
  })
}

test('foundation numerical examples and checkpoint answers are independently checked', () => {
  const energy = getAcademyLearningDraft(2)!.unit
  assert.equal(500 * 4.184, 2092)
  assert.match(energy.workedExamples[0].answer, /500 kcal = 2\.092 kJ/)
  assert.equal(1400 + 180 + 320 + 250, 2150)
  assert.match(energy.workedExamples[1].answer, /2\.150 kcal, không phải 2\.400/)
  assert.equal((2100 + 2250 + 2400) / 3, 2250)
  assert.match(energy.workedExamples[2].answer, /2\.250 kcal\/ngày/)
  const micro = getAcademyLearningDraft(4)!.unit
  assert.equal(0.4 * 1000 + 250, 650)
  assert.match(micro.workedExamples[0].answer, /650 µg = 0,65 mg/)
  assert.equal(2 * 30, 60)
  assert.match(micro.workedExamples[1].answer, /60% DV.*không phải/)
  assert.equal(800 + 250 + 200, 1250)
  assert.match(micro.workedExamples[2].answer, /1\.250 ml = 1,25 lít/)
  const questions = getAcademyLearningCheckpoint(4)!
  const numeric = questions.find((item) => item.question.includes('0,2 mg'))!
  assert.equal(0.2 * 1000 + 150, 350)
  assert.match(numeric.options[numeric.correctIndex!], /350 µg = 0,35 mg/)
  const kcal = getAcademyLearningCheckpoint(2)!.find((item) => item.question.includes('100 kcal'))!
  assert.equal(Number((100 * 4.184).toFixed(1)), 418.4)
  assert.match(kcal.options[kcal.correctIndex!], /418,4 kJ/)
})

test('foundation content preserves uncertainty, treatment boundaries and urgent escalation', () => {
  const start = getAcademyLearningDraft(1)!.unit
  assert.match(start.workedExamples[1].answer, /2\/3 ngày.*không đủ/)
  assert.match(start.workedExamples[2].answer, /Nhận xét cũ.*bản 1/)
  const energy = getAcademyLearningDraft(2)!.unit
  assert.match(energy.sections[2].paragraphs.join(' '), /2017.*không.*mọi đồng hồ/)
  assert.match(energy.workedExamples[2].limitation, /Không suy tốc độ giảm cân/)
  const micro = getAcademyLearningDraft(4)!.unit
  assert.match(micro.sections[1].paragraphs.join(' '), /UL.*không phải mục tiêu/)
  assert.match(micro.cases[2].safeNextStep, /Giữ giới hạn/)
  const digestion = getAcademyLearningDraft(5)!.unit
  assert.match(digestion.sections[2].paragraphs.join(' '), /lactose.*protein sữa/)
  assert.match(digestion.sections[3].paragraphs.join(' '), /không tự ăn lại gluten/)
  assert.match(digestion.cases[2].safeNextStep, /trợ giúp khẩn cấp.*không chờ coach/)
  assert.match(digestion.practice.artifact, /giả định.*không phải nhật ký tự thử/)
  const gates = getAcademyLearningCheckpoint(5)!.filter((item) => item.mustPass)
  assert.equal(gates.length, 2)
  assert.ok(gates.some((item) => /khẩn cấp/.test(item.options[item.correctIndex!])))
  assert.ok(gates.some((item) => /bác sĩ/.test(item.options[item.correctIndex!])))
})

test('generated draft and private banks match authoring and the real callable routes new chapters after authorization', async () => {
  const require = createRequire(import.meta.url)
  const generated = require('../functions/generated/academy-learning-drafts.cjs')
  const bank = require('../functions/generated/academy-learning-checkpoints.cjs')
  assert.deepEqual(require('../functions/generated/academy-draft-catalog.cjs').academyDraftChapterNumbers, [...academyDraftChapterNumbers])
  for (const unit of academyLearningDraftUnits) {
    assert.deepEqual(generated.getAcademyLearningDraft(unit.chapter), getAcademyLearningDraft(unit.chapter))
    assert.deepEqual(bank.getAcademyLearningCheckpoint(unit.chapter), getAcademyLearningCheckpoint(unit.chapter))
  }
  const source = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8')
  const start = source.indexOf('exports.listAcademyCourses =')
  const block = source.slice(start, source.indexOf('\n})', start) + 3)
  const target: Record<string, (request: unknown) => Promise<{ draft: { unit: { chapter: number } } }>> = {}
  let allow = false
  const reads: string[] = []
  runInNewContext(block, {
    exports: target, onCall: (_options: unknown, handler: unknown) => handler, academyLearnerRuntime: {},
    requireCaller: () => 'editor', HttpsError: Error,
    requireTrustedAcademyStaffContext: async () => { if (!allow) throw new Error('permission-denied') },
    require: (path: string) => { reads.push(path); return require(`../functions/${path.replace(/^\.\//, '')}`) },
  })
  await assert.rejects(target.listAcademyCourses({ data: { learningUnitDraft: 1 } }), /permission-denied/)
  assert.deepEqual(reads, ['./academy-learning-drafts'])
  allow = true
  for (const chapter of academyDraftChapterNumbers) {
    const result = await target.listAcademyCourses({ data: { learningUnitDraft: chapter } })
    assert.equal(result.draft.unit.chapter, chapter)
  }
  assert.ok(!reads.some((path) => path.includes('checkpoints')))
})
