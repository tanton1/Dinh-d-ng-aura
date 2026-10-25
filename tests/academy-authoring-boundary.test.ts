import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { buildSync } from 'esbuild'
import { auraFoundationCourse } from '../src/course-template'
import { getAuraNutritionChapter } from '../src/data/auraNutritionLearnerChapters'
import { auraNutritionStudyGuides } from '../src/data/auraNutritionStudyGuides'

test('learner and admin browser dependency graphs exclude authoring sources and checkpoint keys', () => {
  const result = buildSync({
    entryPoints: ['src/components/academy/AcademyChapterLearningStudio.tsx', 'src/pages/admin/CourseEditorPage.tsx', 'src/services/firebaseService.ts'],
    outdir: 'unused-academy-test-output', bundle: true, write: false, metafile: true,
    platform: 'browser', packages: 'external', loader: { '.css': 'empty', '.svg': 'text', '.png': 'dataurl' }, external: ['*?url', '*?raw'],
    logLevel: 'silent', format: 'esm',
  })
  const inputs = Object.keys(result.metafile!.inputs).join('\n')
  assert.doesNotMatch(inputs, /course-template\.ts|auraNutritionCurriculum\.ts|auraNutritionAssessmentAuthoring\.ts|generated\/academy-(?:course-template|learning-|pilot-)|content\/academy\/(?:chapter-|pilot-|foundation-|personalization-|performance-|mastery-|learning-drafts|learning-checkpoints|references)/)
  for (let chapter = 1; chapter <= 20; chapter++) {
    const source = getAuraNutritionChapter(chapter)
    assert.ok(source)
    assert.equal('quiz' in source, false)
    assert.equal('correctIndex' in source, false)
  }
})

test('server authoring artifact matches the source but can only be read after trusted staff authorization', async () => {
  const require = createRequire(import.meta.url)
  const generated = require('../functions/generated/academy-course-template.cjs').auraFoundationCourse
  assert.deepEqual(generated, auraFoundationCourse)
  const source = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8')
  const start = source.indexOf('exports.listAcademyCourses =')
  const block = source.slice(start, source.indexOf('\n})', start) + 3)
  let authoringRead = false
  const target: Record<string, (request: unknown) => Promise<unknown>> = {}
  const context = { exports: target, onCall: (_options: unknown, handler: unknown) => handler, academyLearnerRuntime: {},
    requireCaller: () => 'student', requireTrustedAcademyStaffContext: async () => { throw new Error('permission-denied') },
    require: () => { authoringRead = true; return { auraFoundationCourse } },
  }
  runInNewContext(block, context)
  await assert.rejects(target.listAcademyCourses({ data: { template: 'nutrition-foundation' } }), /permission-denied/)
  assert.equal(authoringRead, false)
})

test('clinical chapters use coordination artifacts, not generic dietary self-experiments', () => {
  for (const chapter of [16, 17]) {
    const guide = auraNutritionStudyGuides[chapter]
    const [core, practice, checkpoint] = auraFoundationCourse.modules[chapter - 1].lessons
    assert.equal(guide.deepDive?.challenge.days.length, 3)
    assert.match(guide.deepDive?.challenge.title ?? '', /Hồ sơ phối hợp/)
    assert.doesNotMatch(JSON.stringify(guide.deepDive), /Đổi một biến chính|Thử nghiệm 7 ngày|thay đổi một chi tiết có thể đo/)
    assert.match(core.learningDesign?.practice.fields.find((field) => field.id === 'action')?.label ?? '', /phối hợp/)
    assert.doesNotMatch(practice.primaryContent?.body ?? '', /### Thử một thay đổi|Một thay đổi nhỏ tôi sẽ thử/)
    for (const suffix of ['-10', '-16']) {
      const question = checkpoint.quiz!.questions.find((candidate) => candidate.id.endsWith(suffix))!
      assert.match(question.options[question.correctIndex!], /chuyên môn|phụ trách/)
      assert.doesNotMatch(question.options[question.correctIndex!], /đổi một biến|Chọn một thay đổi/)
    }
  }
})
