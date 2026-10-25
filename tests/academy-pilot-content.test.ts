import assert from 'node:assert/strict'
import test from 'node:test'
import { academyPilotUnits, getAcademyPilotDraft } from '../content/academy/pilot-drafts'
import { academyEvidenceSources } from '../content/academy/references'
import { getAcademyPilotCheckpoint } from '../content/academy/pilot-checkpoints'

test('four pilot drafts are versioned, review-required and delivered one chapter at a time', () => {
  assert.deepEqual(academyPilotUnits.map((unit) => unit.chapter), [3, 8, 17, 18])
  for (const unit of academyPilotUnits) {
    const packet = getAcademyPilotDraft(unit.chapter)!
    assert.equal(unit.review.status, 'draft-needs-review')
    assert.equal(unit.review.requiresQualifiedReviewer, true)
    assert.match(unit.revision, /^\d{4}-\d{2}-\d{2}\.\d+$/)
    assert.ok(Buffer.byteLength(JSON.stringify(packet)) < 100_000)
    assert.equal(Object.hasOwn(packet, 'modules'), false)
    assert.equal(Object.hasOwn(packet, 'quizAnswerKeys'), false)
    assert.equal(Object.hasOwn(packet, 'checkpoint'), false)
    assert.ok(unit.scope.length > 70)
    assert.ok(unit.safety.length >= 3)
  }
  assert.equal(getAcademyPilotDraft(1), null)
})

test('every objective is taught, assessed and linked to valid remediation', () => {
  for (const unit of academyPilotUnits) {
    const packet = getAcademyPilotDraft(unit.chapter)!
    const objectives = new Set(unit.objectives.map((item) => item.id))
    const sections = new Set(unit.sections.map((item) => item.id))
    assert.equal(objectives.size, unit.objectives.length)
    assert.equal(sections.size, unit.sections.length)
    assert.ok(unit.sections.length >= 4)
    for (const section of unit.sections) {
      assert.ok(section.paragraphs.length >= 2)
      assert.ok(section.paragraphs.every((paragraph) => paragraph.length >= 100))
      assert.ok(section.objectiveIds.length)
      for (const id of section.objectiveIds) assert.ok(objectives.has(id), id)
    }
    for (const objective of unit.objectives) {
      assert.ok(unit.sections.some((section) => section.objectiveIds.includes(objective.id)), objective.id)
      assert.ok(packet.formativeChecks.some((check) => check.objectiveId === objective.id), objective.id)
    }
    for (const check of packet.formativeChecks) {
      assert.ok(objectives.has(check.objectiveId))
      assert.ok(sections.has(check.sectionId))
      assert.equal(new Set(check.options).size, 4)
      assert.ok(check.correctIndex >= 0 && check.correctIndex < check.options.length)
      assert.ok(check.feedback.length > 30, check.id)
    }
    assert.equal(new Set(packet.formativeChecks.map((item) => item.correctIndex)).size, 4)
  }
})

test('sources have exact scoped links and all cited source ids resolve', () => {
  const registry = new Map(academyEvidenceSources.map((source) => [source.id, source]))
  assert.equal(registry.size, academyEvidenceSources.length)
  for (const unit of academyPilotUnits) {
    const packet = getAcademyPilotDraft(unit.chapter)!
    assert.deepEqual(packet.sources.map((source) => source.id), unit.referenceIds)
    for (const source of packet.sources) {
      assert.equal(new URL(source.url).protocol, 'https:')
      assert.ok(source.supports.length > 30)
      assert.ok(source.limitations.length > 30)
      assert.match(source.checkedAt, /^\d{4}-\d{2}-\d{2}$/)
    }
    for (const section of unit.sections) {
      assert.ok(section.sourceIds.length)
      for (const id of section.sourceIds) assert.ok(unit.referenceIds.includes(id) && registry.has(id), id)
    }
  }
})

test('examples and cases retain reasoning and limitations, not only answers', () => {
  for (const unit of academyPilotUnits) {
    assert.ok(unit.workedExamples.length >= 3)
    assert.ok(unit.cases.length >= 3)
    for (const example of unit.workedExamples) {
      assert.ok(example.given.length)
      assert.ok(example.steps.length >= 3)
      assert.ok(example.answer.length > 30)
      assert.ok(example.limitation.length > 30)
      for (const id of example.objectiveIds) assert.ok(unit.objectives.some((item) => item.id === id))
    }
    for (const item of unit.cases) {
      assert.ok(item.reasoning.length >= 3)
      assert.ok(item.safeNextStep.length > 25)
      assert.ok(item.commonError.length > 25)
    }
  }
})

test('practice uses compatible field ids with chapter-specific 0–2 rubrics', () => {
  const titles = new Set<string>()
  for (const unit of academyPilotUnits) {
    assert.deepEqual(unit.practice.fields.map((field) => field.id), ['context', 'hypothesis', 'action', 'minimum', 'data', 'stop'])
    assert.ok(unit.practice.fields.every((field) => field.required && field.prompt.length > 30))
    assert.deepEqual(unit.practice.rubric.map((row) => row.id), ['data', 'mechanism', 'feasibility', 'safety'])
    for (const row of unit.practice.rubric) assert.equal(new Set(row.levels).size, 3)
    assert.ok(unit.practice.modelResponse.length >= 3)
    titles.add(unit.practice.title)
  }
  assert.equal(titles.size, 4)
})

test('worked numerical values are checked independently and assumptions are explicit', () => {
  const macro = getAcademyPilotDraft(3)!.unit
  assert.equal(8 * 125 / 100, 10)
  assert.equal(30 * 4 + 50 * 4 + 20 * 9, 500)
  assert.match(macro.workedExamples.find((item) => item.id === 'ch03-energy-example')!.answer, /500 kcal/)
  assert.match(macro.workedExamples.find((item) => item.id === 'ch03-cooked-example')!.answer, /26,7 g/)
  const ree = 10 * 60 + 6.25 * 160 - 5 * 30 - 161
  assert.equal(ree, 1289)
  const energy = getAcademyPilotDraft(8)!.unit
  assert.match(energy.workedExamples[0].answer, /1\.289/)
  assert.equal(Number((ree * 1.4).toFixed(1)), 1804.6)
  assert.equal(Number((ree * 1.6).toFixed(1)), 2062.4)
  assert.match(energy.workedExamples[1].steps.join(' '), /1\.804,6.*2\.062,4.*257,8/)
  assert.match(energy.workedExamples[1].limitation, /không phải khuyến nghị/)
  assert.match(energy.sections[2].paragraphs.join(' '), /không phải khoảng tin cậy/)
  const evidence = getAcademyPilotDraft(18)!.unit
  assert.equal(Math.round((40 - 30) / 40 * 100), 25)
  assert.equal((40 - 30) / 1000 * 100, 1)
  assert.match(evidence.workedExamples[0].answer, /25%.*1 điểm phần trăm/)
  assert.match(evidence.workedExamples[1].limitation, /không phải khoảng dự đoán/)
})

test('clinical draft is coordination, with urgent and privacy boundaries', () => {
  const unit = getAcademyPilotDraft(17)!.unit
  assert.match(unit.scope, /Không chẩn đoán/)
  assert.match(unit.practice.artifact, /giả định/)
  assert.match(unit.practice.fields.find((field) => field.id === 'action')!.label, /phối hợp/)
  assert.doesNotMatch(unit.practice.steps.join(' '), /thử thay đổi|thử nghiệm 7 ngày/)
  assert.match(unit.sections.find((section) => section.id === 'ch17-diabetes')!.paragraphs.join(' '), /không cố cho người bất tỉnh ăn uống/)
  assert.ok(unit.referenceIds.includes('nhs-hypoglycemia'))
})

test('private checkpoints cover each pilot objective with two distinct questions and safety gates', () => {
  for (const unit of academyPilotUnits) {
    const questions = getAcademyPilotCheckpoint(unit.chapter)!
    const formative = getAcademyPilotDraft(unit.chapter)!.formativeChecks
    assert.equal(questions.length, 8)
    assert.equal(new Set(questions.map((item) => item.id)).size, 8)
    assert.equal(new Set(questions.map((item) => item.question)).size, 8)
    assert.ok(questions.some((item) => item.mustPass))
    for (const objective of unit.objectives) assert.equal(questions.filter((item) => item.competencyId === objective.id).length, 2)
    for (const question of questions) {
      assert.ok(Number.isInteger(question.correctIndex))
      assert.equal(question.options.length, 4)
      assert.equal(new Set(question.options).size, 4)
      assert.ok(question.explanation!.length > 35)
      assert.ok(question.remediationCardIds!.every((id) => unit.sections.some((section) => section.id === id)))
      assert.ok(!formative.some((check) => check.prompt === question.question))
    }
    for (const index of [0, 1, 2, 3]) assert.equal(questions.filter((item) => item.correctIndex === index).length, 2)
  }
  assert.equal(getAcademyPilotCheckpoint(1), null)
})
