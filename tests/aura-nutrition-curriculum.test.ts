import assert from 'node:assert/strict'
import test from 'node:test'
import { auraFoundationCourse } from '../src/course-template'
import { auraNutritionCurriculumStats, auraNutritionPhases } from '../src/data/auraNutritionCurriculum'

test('AURA nutrition curriculum contains four phases, 20 chapters and 60 lessons', () => {
  assert.equal(auraNutritionPhases.length, 4)
  assert.equal(auraNutritionCurriculumStats.chapters, 20)
  assert.equal(auraNutritionCurriculumStats.lessons, 60)
  assert.equal(auraFoundationCourse.modules.length, 20)
  assert.ok(auraFoundationCourse.modules.every((module) => module.lessons.length === 3))
})

test('curriculum lesson identifiers are unique and every chapter is publication-ready', () => {
  const lessons = auraFoundationCourse.modules.flatMap((module) => module.lessons)
  const ids = lessons.map((lesson) => lesson.id)
  assert.equal(new Set(ids).size, ids.length)

  for (const module of auraFoundationCourse.modules) {
    const [core, practice, checkpoint] = module.lessons
    assert.equal(core.type, 'Bài đọc')
    assert.equal(core.primaryContent?.kind, 'rich-text')
    assert.ok(core.primaryContent?.body?.includes('Lưu ý an toàn'))
    assert.ok(core.memory?.takeaways.length)
    assert.equal(practice.type, 'Bài đọc')
    assert.equal(practice.primaryContent?.kind, 'rich-text')
    assert.equal(checkpoint.type, 'Quiz')
    assert.equal(checkpoint.completionPolicy?.mode, 'quiz-pass')
    assert.equal(checkpoint.quiz?.questions.length, 3)
    checkpoint.quiz?.questions.forEach((question) => {
      assert.equal(question.options.length, 3)
      assert.ok(Number.isInteger(question.correctIndex))
      assert.ok((question.correctIndex ?? -1) >= 0 && (question.correctIndex ?? 3) < question.options.length)
    })
  }
})

test('medical chapter keeps the education and referral boundary explicit', () => {
  const medicalModule = auraFoundationCourse.modules[16]
  const medicalCore = medicalModule.lessons[0]
  assert.match(medicalModule.title, /bệnh lý/i)
  assert.match(medicalCore.primaryContent?.body ?? '', /chỉ phục vụ giáo dục/i)
  assert.match(medicalCore.primaryContent?.body ?? '', /điều trị/i)
})

