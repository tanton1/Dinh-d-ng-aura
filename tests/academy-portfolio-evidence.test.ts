import assert from 'node:assert/strict'
import test from 'node:test'
import { academyPortfolioSources, academyPortfolioReadPlan, academyPortfolioArtifactStatus } from '../src/features/academy/portfolioEvidence'
import { academyPortfolioStages, isAcademyPortfolioDraftReady } from '../src/features/academy/portfolio'
import { auraFoundationCourse } from '../src/course-template'
import type { AcademyWorkbookState } from '../src/services/academyLearningService'

function workbook(): AcademyWorkbookState {
  return { schemaVersion: 2, definitionVersion: 1, cloudRevision: 0, updatedAt: 0, sharedWithCoach: false, answers: {},
    challengeDone: {}, microCheckAnswers: {}, confidenceBefore: null, confidenceAfter: null,
    rubric: { data: 0, mechanism: 0, feasibility: 0, safety: 0 }, decision: null, reviewAt: '', safetyAcknowledged: false }
}

test('portfolio always represents five expected chapters, never counts quiz or duplicate core as extra artifacts', () => {
  const lessons = auraFoundationCourse.modules.flatMap((module) => module.lessons)
  for (const stage of academyPortfolioStages) {
    const sources = academyPortfolioSources(stage, [...lessons, ...lessons])
    assert.equal(sources.length, 5)
    assert.equal(new Set(sources.map((item) => item.lessonId)).size, 5)
    assert.ok(sources.every((item) => item.lesson?.id.endsWith('-core') && item.practiceLessonId.endsWith('-practice')))
    assert.equal(sources[0].chapter, stage.chapterRange[0])
    assert.equal(sources[4].chapter, stage.chapterRange[1])
  }
  const partial = academyPortfolioSources(academyPortfolioStages[0], [lessons[0]])
  assert.equal(partial.length, 5)
  assert.equal(partial.filter((item) => item.lesson).length, 1)
})

test('collapsed portfolio performs no source reads; open reads four peers once and retry reads failed peers only', () => {
  const ids = [1, 2, 3, 4, 5].map((n) => `chapter-0${n}-core`)
  const loaded = new Set<string>()
  assert.deepEqual(academyPortfolioReadPlan(false, ids[4], ids, loaded), [])
  assert.deepEqual(academyPortfolioReadPlan(true, ids[4], ids, loaded), ids.slice(0, 4))
  loaded.add(ids[0]); loaded.add(ids[2])
  assert.deepEqual(academyPortfolioReadPlan(true, ids[4], ids, loaded), [ids[1], ids[3]])
  ids.slice(0, 4).forEach((id) => loaded.add(id))
  assert.deepEqual(academyPortfolioReadPlan(true, ids[4], ids, loaded), [])
  assert.deepEqual(academyPortfolioReadPlan(false, ids[4], ids, loaded), [])
  assert.deepEqual(academyPortfolioReadPlan(true, ids[4], [...ids, ...ids], loaded), [])
})

test('filling every practice field does not create a submitted or reviewed artifact', () => {
  const state = workbook()
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: false }), 'not-checked')
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true }), 'draft')
  state.answers = Object.fromEntries(['context', 'hypothesis', 'action', 'minimum', 'data', 'stop'].map((key) => [key, 'Nội dung']))
  state.reviewAt = '2026-10-28'; state.safetyAcknowledged = true; state.updatedAt = 10
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true }), 'filled')
  state.rubric = { data: 2, mechanism: 2, feasibility: 2, safety: 2 }
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true }), 'filled')
})

test('server completion evidence survives unloaded or older local drafts and distinguishes new edits', () => {
  assert.equal(academyPortfolioArtifactStatus({ checked: false, completed: true }), 'submitted')
  assert.equal(academyPortfolioArtifactStatus({ checked: false, submittedRevision: 3 }), 'submitted')
  const state = { ...workbook(), cloudRevision: 2 }
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true, submittedRevision: 3 }), 'submitted')
  state.cloudRevision = 4
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true, submittedRevision: 3 }), 'updated-after-submission')
  state.cloudRevision = 3; state.pendingSync = true
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true, submittedRevision: 3 }), 'updated-after-submission')
  for (const revision of [-1, 0, 1.5, NaN]) assert.equal(academyPortfolioArtifactStatus({ checked: false, submittedRevision: revision }), 'not-checked')
})

test('unloaded chapter criteria cannot prove current eligibility, even with historical submission evidence', () => {
  const state = { ...workbook(), answers: { context: 'Draft' } }
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true, definitionLoaded: false }), 'definition-not-loaded')
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true, definitionLoaded: false, submittedRevision: 1 }), 'definition-not-loaded')
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true, definitionLoaded: false, completed: true }), 'definition-not-loaded')
  assert.equal(academyPortfolioArtifactStatus({ checked: false, definitionLoaded: false }), 'definition-not-loaded')
})

test('unsubmitted answers from a previous definition are not filled evidence for a new practice', () => {
  const state = { ...workbook(), updatedAt: 100, definitionVersion: 1, definitionHash: 'old' }
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true, definitionLoaded: true, definitionVersion: 2 }), 'outdated-draft')
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true, definitionLoaded: true, definitionVersion: 1, definitionHash: 'new' }), 'outdated-draft')
})

test('a historical submission never proves that a changed practice definition has been submitted', () => {
  const state = workbook()
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true, completed: true, definitionVersion: 2 }), 'outdated-definition')
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true, submittedRevision: 3, definitionVersion: 2, submittedDefinitionVersion: 1 }), 'outdated-definition')
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true, submittedRevision: 3, definitionVersion: 2, submittedDefinitionVersion: 2 }), 'submitted')
  assert.equal(academyPortfolioArtifactStatus({ workbook: state, checked: true, completed: true, definitionVersion: 2, submittedDefinitionVersion: 2, definitionHash: 'new', submittedDefinitionHash: 'old' }), 'outdated-definition')
})

test('self-assessed total cannot compensate for an unsafe portfolio draft', () => {
  const stage = academyPortfolioStages[0]
  const state = workbook()
  state.answers = Object.fromEntries(stage.fields.map((field) => [field.id, 'Nội dung']))
  state.safetyAcknowledged = true; state.reviewAt = '2026-10-28'
  state.rubric = { data: 2, mechanism: 2, feasibility: 2, safety: 0 }
  assert.equal(isAcademyPortfolioDraftReady(stage, state), false)
  state.rubric.safety = 1
  assert.equal(isAcademyPortfolioDraftReady(stage, state), true)
})
