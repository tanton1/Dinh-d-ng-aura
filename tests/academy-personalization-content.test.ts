import assert from 'node:assert/strict'
import test from 'node:test'
import { getAcademyLearningDraft } from '../content/academy/learning-drafts'
import { getAcademyLearningCheckpoint } from '../content/academy/learning-checkpoints'
import { academyEvidenceSources } from '../content/academy/references'
import { getAcademyPersonalizationCheckpoint } from '../content/academy/personalization-checkpoints'

for (const chapter of [6, 7, 9, 10]) {
  test(`personalization chapter ${chapter} aligns teaching, sourced examples, practice and private assessment`, () => {
    const { unit, sources, formativeChecks } = getAcademyLearningDraft(chapter)!
    const questions = getAcademyLearningCheckpoint(chapter)!
    const objectives = new Set(unit.objectives.map((item) => item.id))
    const sections = new Set(unit.sections.map((item) => item.id))
    assert.equal(objectives.size, 4)
    assert.equal(sections.size, 4)
    assert.equal(unit.review.status, 'draft-needs-review')
    assert.equal(unit.review.requiresQualifiedReviewer, true)
    assert.ok(unit.scope.length > 70 && unit.safety.length >= 3)
    assert.deepEqual(sources.map((item) => item.id), unit.referenceIds)
    assert.equal(new Set(unit.referenceIds).size, sources.length)
    for (const source of sources) {
      assert.ok(academyEvidenceSources.includes(source))
      assert.equal(new URL(source.url).protocol, 'https:')
      assert.ok(source.supports.length > 30 && source.limitations.length > 30)
      assert.match(source.checkedAt, /^\d{4}-\d{2}-\d{2}$/)
    }
    for (const section of unit.sections) {
      assert.ok(section.paragraphs.length >= 3)
      assert.ok(section.paragraphs.every((paragraph) => paragraph.length >= 100), section.id)
      assert.ok(section.sourceIds.length > 0 && section.takeaways.length >= 2)
      assert.ok(section.sourceIds.every((id) => unit.referenceIds.includes(id)), section.id)
      assert.ok(section.objectiveIds.every((id) => objectives.has(id)), section.id)
    }
    assert.equal(formativeChecks.length, 4)
    assert.equal(new Set(formativeChecks.map((item) => item.id)).size, 4)
    assert.equal(new Set(formativeChecks.map((item) => item.correctIndex)).size, 4)
    assert.equal(questions.length, 8)
    assert.equal(new Set(questions.map((item) => item.question)).size, 8)
    for (const objective of unit.objectives) {
      assert.ok(objective.outcome.length > 30 && objective.evidence.length > 30)
      assert.ok(unit.sections.some((section) => section.objectiveIds.includes(objective.id)))
      assert.equal(formativeChecks.filter((item) => item.objectiveId === objective.id).length, 1)
      assert.equal(questions.filter((item) => item.competencyId === objective.id).length, 2)
    }
    for (const check of formativeChecks) {
      assert.ok(sections.has(check.sectionId) && objectives.has(check.objectiveId))
      assert.equal(new Set(check.options).size, 4)
      assert.ok(check.feedback.length > 35)
    }
    for (const question of questions) {
      assert.equal(question.kind, 'single')
      assert.ok(objectives.has(question.competencyId!))
      assert.equal(new Set(question.options).size, 4)
      assert.ok(question.remediationCardIds!.length > 0)
      assert.ok(question.remediationCardIds!.every((id) => sections.has(id)))
      assert.ok(question.explanation!.length > 35)
      assert.ok(!formativeChecks.some((item) => item.prompt === question.question))
      assert.equal(question.difficulty, question.mustPass ? 3 : 2)
    }
    for (const answerIndex of [0, 1, 2, 3]) assert.equal(questions.filter((item) => item.correctIndex === answerIndex).length, 2)
    assert.ok(questions.some((item) => item.mustPass))
    assert.equal(unit.workedExamples.length, 3)
    assert.equal(unit.cases.length, 3)
    for (const example of unit.workedExamples) {
      assert.ok(example.given.length >= 3 && example.steps.length >= 3)
      assert.ok(example.objectiveIds.every((id) => objectives.has(id)))
      assert.ok(example.answer.length > 30 && example.limitation.length > 30)
    }
    for (const example of unit.cases) {
      assert.ok(example.reasoning.length >= 3)
      assert.ok(example.safeNextStep.length > 30 && example.commonError.length > 30)
    }
    assert.deepEqual(unit.practice.fields.map((item) => item.id), ['context', 'hypothesis', 'action', 'minimum', 'data', 'stop'])
    assert.ok(unit.practice.fields.every((item) => item.required && item.prompt.length > 30))
    assert.deepEqual(unit.practice.rubric.map((item) => item.id), ['data', 'mechanism', 'feasibility', 'safety'])
    assert.ok(unit.practice.rubric.every((item) => item.levels.length === 3 && new Set(item.levels).size === 3))
    assert.ok(unit.practice.modelResponse.length >= 3)
  })
}

function answer(chapter: number, prompt: string) {
  const question = getAcademyLearningCheckpoint(chapter)!.find((item) => item.question.includes(prompt))
  assert.ok(question, `missing checkpoint: ${chapter} ${prompt}`)
  return question.options[question.correctIndex!]
}

test('glucose, relative change and missing-data examples preserve their denominators and limits', () => {
  const glucose = getAcademyLearningDraft(6)!.unit.workedExamples[1]
  assert.equal((90 + 120 + 150) / 3, 120)
  assert.equal((120 + 120 + 120) / 3, 120)
  assert.equal(150 - 90, 60)
  assert.match(glucose.answer, /120 mg\/dL.*60 và 0 mg\/dL/)
  assert.match(glucose.steps.join(' '), /không suy HbA1c từ ba điểm/)
  assert.equal((100 + 120 + 140) / 3, 120)
  assert.match(answer(6, '100, 120, 140'), /cùng 120.*40 và 0 mg\/dL.*chưa phân loại/)

  const differences = getAcademyLearningDraft(7)!.unit.workedExamples
  assert.deepEqual([2200 - 1900, 2500 - 1900], [300, 600])
  assert.match(differences[0].answer, /300 và 600 kcal\/ngày.*không dự đoán/)
  assert.equal(Number(((88 - 90) / 90 * 100).toFixed(2)), -2.22)
  assert.equal(Number(((58 - 60) / 60 * 100).toFixed(2)), -3.33)
  assert.match(differences[1].answer, /2,22% và 3,33%/)
  assert.equal((80 - 78) / 80 * 100, 2.5)
  assert.match(answer(7, '80 xuống 78'), /2,5%.*cân tổng/)
  assert.equal(4 / 5 * 100, 80)
  assert.equal(3 / 4 * 100, 75)
  assert.match(differences[2].answer, /80%.*75%.*chưa rõ/)
})

test('meal planning arithmetic keeps nutrient equivalence, purchase cost and hot-weather safety distinct', () => {
  const examples = getAcademyLearningDraft(9)!.unit.workedExamples
  assert.equal(25 * 120 / 100, 30)
  assert.equal(30 / 10 * 100, 300)
  assert.match(examples[0].answer, /30 g protein.*300 g B.*riêng chỉ số/)
  assert.equal(2 * 3 * 150, 900)
  assert.equal(900 / 1000 * 80_000, 72_000)
  assert.equal(72_000 / 6, 12_000)
  assert.match(examples[1].answer, /900 g X.*72\.000 đồng.*12\.000 đồng\/suất.*riêng X/)
  assert.equal((10 * 60 + 30) - 9 * 60, 90)
  assert.ok(34 > 32 && 90 > 60)
  assert.match(examples[2].steps.join(' '), /trên 32°C.*1 giờ.*90 phút vượt 60 phút/)
  assert.match(examples[2].answer, /không cố cứu bằng hâm lại/)
  assert.equal(20 * 150 / 100 / 10 * 100, 300)
  assert.match(answer(9, 'A giả định'), /300 g.*chưa khớp/)
  assert.equal(3 * 2 * 100 / 1000 * 50_000, 30_000)
  assert.match(answer(9, 'Ba người'), /30\.000 đồng.*600 g X.*chưa gồm cả bữa/)
  assert.match(answer(9, '75 phút'), /vượt một giờ.*trên 32°C.*không dùng/)
})

test('monitoring examples separate coverage from adherence and BIA-derived numbers from measured tissue', () => {
  const unit = getAcademyLearningDraft(10)!.unit
  assert.equal(7 / 8 * 100, 87.5)
  assert.equal(Number((5 / 7 * 100).toFixed(1)), 71.4)
  assert.match(unit.workedExamples[0].answer, /87,5%.*71,4%.*không phải/)
  assert.equal(Number((60 * 0.22).toFixed(1)), 13.2)
  assert.equal(Number((59.5 * 0.20).toFixed(1)), 11.9)
  assert.equal(Number((59.5 * 0.20 - 60 * 0.22).toFixed(1)), -1.3)
  assert.match(unit.workedExamples[1].answer, /13,2 và 11,9 kg.*−1,3 kg.*chưa xác nhận/)
  assert.equal(Number((6 / 7 * 100).toFixed(1)), 85.7)
  assert.equal(Number((5 / 6 * 100).toFixed(1)), 83.3)
  assert.match(answer(10, 'Bảy cơ hội'), /85,7%.*83,3%.*chưa rõ/)
  assert.match(unit.sections[1].paragraphs.join(' '), /2021.*cắt ngang.*không xác nhận.*khả năng theo dõi thay đổi/)
  assert.match(unit.sections[1].paragraphs.join(' '), /không xóa sai số hệ thống/)
})

test('clinical and tracking safety do not wait for data, self-testing or coach approval', () => {
  const hormone = getAcademyLearningDraft(6)!.unit
  assert.match(hormone.scope, /Không chẩn đoán.*chỉnh thuốc.*tự thử nhịn ăn/)
  assert.match(hormone.practice.artifact, /ca giả định.*không là thử nghiệm ăn uống/)
  assert.match(hormone.sections[3].paragraphs.join(' '), /không cố cho ăn uống.*không chờ.*app/)
  assert.match(hormone.safety.join(' '), /Không bỏ qua cảnh báo/)
  assert.equal(getAcademyLearningCheckpoint(6)!.filter((item) => item.mustPass).length, 2)
  assert.match(answer(6, 'bỏ bữa'), /Giữ kế hoạch chăm sóc.*không tự chỉnh thuốc/)
  assert.match(answer(6, 'không thể nuốt'), /Cố cho uống nước đường/) // This question asks what to avoid.

  const differences = getAcademyLearningDraft(7)!.unit
  assert.match(differences.sections[0].paragraphs.join(' '), /khung học tập.*không là thang chẩn đoán/)
  assert.match(differences.sections[1].paragraphs.join(' '), /Nunes.*2022.*13 cách tính.*ước lượng khác nhau/)
  assert.ok(differences.sections[1].sourceIds.includes('nunes-adaptation-methods-2022'))
  assert.match(differences.cases[2].safeNextStep, /nhân viên y tế sớm/)
  assert.match(differences.safety.join(' '), /dừng phần theo dõi đó.*hỗ trợ.*giả định/)
  assert.equal(getAcademyLearningCheckpoint(7)!.filter((item) => item.mustPass).length, 1)

  const meal = getAcademyLearningDraft(9)!.unit
  assert.match(meal.sections[3].paragraphs.join(' '), /4°C.*2 giờ.*1 giờ.*32°C/)
  assert.match(meal.sections[3].paragraphs.join(' '), /thịt\/gia cầm.*3–4 ngày.*không là hạn chung/)
  assert.match(meal.cases[1].reasoning.join(' '), /không thử một ít/)
  assert.equal(getAcademyLearningCheckpoint(9)!.filter((item) => item.mustPass).length, 3)

  const progress = getAcademyLearningDraft(10)!.unit
  assert.match(progress.sections[0].paragraphs.join(' '), /quy tắc.*Aura.*không phải ngưỡng khoa học/)
  assert.match(progress.cases[1].safeNextStep, /Dừng phần theo dõi gây hại.*hỗ trợ/)
  assert.match(progress.safety.join(' '), /Không yêu cầu cân, đo BIA hoặc ảnh cơ thể/)
  assert.equal(getAcademyLearningCheckpoint(10)!.filter((item) => item.mustPass).length, 1)
})

test('chapter 10 portfolio depends on submitted versions without making its own practice circular', () => {
  const unit = getAcademyLearningDraft(10)!.unit
  assert.match(unit.practice.steps.join(' '), /sau khi nộp bài 10 mới tổng hợp đủ năm bản nộp/)
  assert.match(unit.sections[3].paragraphs.join(' '), /Sửa nháp không tự sửa bản đã nộp.*nhận xét.*bản cũ.*không tự/)
  assert.match(unit.workedExamples[2].steps.join(' '), /thiếu minh chứng chương 6 đã nộp/)
  assert.match(unit.cases[2].safeNextStep, /Giữ lịch sử.*phiên bản tổng hợp mới/)
  assert.match(answer(10, 'Một portfolio'), /năm bản nộp đúng phiên bản.*chưa thể kết luận/)
  assert.match(answer(10, 'Bài nguồn'), /Coach đã duyệt.*chưa xem phiên bản mới/)
  for (const chapter of [0, 1, 3, 8, 11, 20, 6.1, NaN, Infinity, '6'] as number[]) {
    assert.equal(getAcademyPersonalizationCheckpoint(chapter), null)
  }
})
