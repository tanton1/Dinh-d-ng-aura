'use strict'

const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const { createHash } = require('node:crypto')

function academyAuthoringValidation(HttpsError, extra = {}) {
  const source = readFileSync(require.resolve('../index'), 'utf8')
  const normalization = source.slice(source.indexOf('const coursePublicationStatuses ='), source.indexOf('async function requireTrustedAcademyStaffContext('))
  const grading = source.slice(source.indexOf('function stableQuizOrderScore('), source.indexOf('function requireCourseMediaPath('))
  const context = { HttpsError, createHash, requireDocumentId: (value) => value,
    isPlainObject: (value) => value && typeof value === 'object' && !Array.isArray(value), quizAnswerLimit: 100, quizMaxAttemptLimit: 20, ...extra }
  const diff = source.slice(source.indexOf('function academyDiffValue('), source.indexOf('/** Returns immutable revision metadata'))
  runInNewContext([normalization, grading, diff].join('\n'), context)
  return context
}

function normalizedAcademyTemplate(HttpsError) {
  const context = academyAuthoringValidation(HttpsError)
  const normalized = context.normalizeCourseDraftInput(require('../generated/academy-course-template.cjs').auraFoundationCourse)
  const quizKeys = Object.fromEntries([...normalized.quizDefinitions].map(([lessonId, quiz]) => [lessonId, {
    quizId: quiz.id, passPercent: quiz.passPercent, answers: normalized.answerCandidates.get(lessonId), questionCount: quiz.questions.length,
    contentHash: context.buildQuizContentHash(quiz, normalized.answerCandidates.get(lessonId)),
  }]))
  return JSON.parse(JSON.stringify({ identifier: normalized.identifier, course: normalized.course, quizKeys }))
}

module.exports = { normalizedAcademyTemplate, academyAuthoringValidation }
