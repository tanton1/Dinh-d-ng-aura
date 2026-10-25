'use strict'

const { createHash } = require('node:crypto')

function auraPracticeDefinition(module, lesson) {
  const match = /^nutrition-chapter-(\d{2})$/.exec(module?.id ?? '')
  if (!match || lesson?.id !== `chapter-${match[1]}-practice`) return null
  const core = module.lessons?.find((candidate) => candidate.id === `chapter-${match[1]}-core`)
  return { coreLessonId: core?.id, design: core?.learningDesign }
}

function academyWorkbookDocumentId(courseId, lessonId) {
  return [courseId, lessonId].map((part) => encodeURIComponent(part)).join('__')
}

/** Checks completeness and provenance, NOT clinical quality or professional competence. */
function validateAcademyPracticeSubmission({ courseId, definition, workbookDocument, evidence }) {
  const fail = (message) => ({ ok: false, message })
  const practice = definition?.design?.practice
  if (!definition?.coreLessonId || !Number.isInteger(practice?.version) || !Array.isArray(practice.fields) || !practice.fields.length) {
    return fail('Bài thực hành chưa có cấu hình được xuất bản. Vui lòng liên hệ quản trị viên.')
  }
  if (!workbookDocument || workbookDocument.courseId !== courseId || workbookDocument.lessonId !== definition.coreLessonId) {
    return fail('Hãy đồng bộ bài thực hành trước khi nộp.')
  }
  if (evidence?.workbookLessonId !== definition.coreLessonId || !Number.isInteger(evidence?.workbookRevision)
      || evidence.workbookRevision < 1 || evidence.workbookRevision !== workbookDocument.revision) {
    return fail('Bài thực hành đã thay đổi. Tải và kiểm tra bản mới nhất trước khi nộp.')
  }
  let workbook
  try { workbook = JSON.parse(workbookDocument.body) } catch { return fail('Bài thực hành đã lưu không đọc được.') }
  if (workbook?.schemaVersion !== 2 || workbook.definitionVersion !== practice.version) {
    return fail('Cấu trúc bài thực hành đã thay đổi. Hãy mở lại chương và kiểm tra các mục mới.')
  }
  if (practice.reviewRubric && (!/^[a-f0-9]{64}$/.test(practice.identityHash || '') || workbook.definitionHash !== practice.identityHash)) {
    return fail('Yêu cầu hoặc tiêu chí bài thực hành đã đổi. Hãy giữ bản cũ và bắt đầu bài theo yêu cầu mới.')
  }
  if (!workbook.answers || typeof workbook.answers !== 'object' || Array.isArray(workbook.answers)) return fail('Bài thực hành chưa có câu trả lời.')
  const fields = practice.fields
  if (!fields.some((field) => field.required === true)) return fail('Bài thực hành chưa quy định minh chứng bắt buộc.')
  if (new Set(fields.map((field) => field.id)).size !== fields.length) return fail('Cấu hình bài thực hành có mục bị trùng.')
  const submittedAnswers = {}
  for (const field of fields) {
    const answer = field.id === 'reviewAt' ? workbook.reviewAt : workbook.answers[field.id]
    if (field.required !== true && (answer === undefined || answer === '')) continue
    if (typeof answer !== 'string' || !answer.trim() || answer.length > 2000) return fail(`Hãy điền mục “${field.label || field.id}”.`)
    if (field.kind === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(answer) || !Number.isFinite(Date.parse(answer)) || new Date(answer).toISOString().slice(0, 10) !== answer)) {
      return fail(`Ngày ở mục “${field.label || field.id}” không hợp lệ.`)
    }
    submittedAnswers[field.id] = answer.trim()
  }
  if (workbook.safetyAcknowledged !== true) return fail('Hãy xác nhận giới hạn an toàn trước khi nộp bài.')
  const definitionHash = createHash('sha256').update(JSON.stringify(practice)).digest('hex')
  const contentHash = createHash('sha256').update(JSON.stringify({ definitionHash, submittedAnswers, safetyAcknowledged: true })).digest('hex')
  // Keep the exact submitted evidence and prompts. A later draft edit must never
  // silently change what the coach sees for this submission.
  return {
    ok: true, coreLessonId: definition.coreLessonId, definitionVersion: practice.version,
    workbookRevision: workbookDocument.revision, definitionHash, contentHash,
    evidence: { answers: submittedAnswers, safetyAcknowledged: true },
    definitionSnapshot: JSON.parse(JSON.stringify(practice)),
  }
}

module.exports = { auraPracticeDefinition, academyWorkbookDocumentId, validateAcademyPracticeSubmission }
