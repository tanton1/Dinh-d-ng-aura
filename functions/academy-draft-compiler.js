'use strict'

const { createHash } = require('node:crypto')
const COMPILER_VERSION = 1
const clone = (value) => JSON.parse(JSON.stringify(value))
const text = (value) => String(value).replace(/[\\`*_{}[\]<>#+!|]/g, '\\$&')
const paragraphs = (items) => items.map(text).join('\n\n')
const bullets = (items) => items.map((item) => `- ${text(item)}`).join('\n')
const numbered = (items) => items.map((item, index) => `${index + 1}. ${text(item)}`).join('\n')
const withoutAdoption = ({ academyAdoption: _adoption, ...module }) => module
const sourceUrl = (url) => new URL(url).href.replace(/\(/g, '%28').replace(/\)/g, '%29')
// Retain uploaded assets, but never inherit obsolete quizzes, PDFs as primary
// content, learning designs, provenance or workout bindings from the old lesson.
const retainedLesson = (lesson) => Object.fromEntries(['id', 'duration', 'preview', 'resources']
  .filter((key) => lesson[key] !== undefined).map((key) => [key, key === 'resources'
    ? lesson.resources.map(({ isPrimary: _primary, ...resource }) => clone(resource)) : clone(lesson[key])]))

/** Pure compilation only. The output is a review candidate, NEVER an approval. */
function createAcademyDraftCompiler({ HttpsError, normalize, buildQuizContentHash, canonical }) {
  const fail = (message) => { throw new HttpsError('failed-precondition', message) }
  const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex')
  const practiceShape = (practice) => {
    if (!practice) return null
    const { version: _version, identityHash: _identity, ...shape } = practice
    if (shape.reviewRubric) {
      const { version: _rubricVersion, ...rubric } = shape.reviewRubric
      return { ...shape, reviewRubric: rubric }
    }
    return shape
  }

  function compile({ courseId, course, previousModule, previousQuizKeys, packet, checkpointQuestions }) {
    const unit = packet?.unit
    if (packet?.schemaVersion !== 1 || unit?.schemaVersion !== 1 || !Number.isInteger(unit.chapter)
        || unit.chapter < 1 || unit.chapter > 20 || unit.review?.status !== 'draft-needs-review'
        || unit.review.requiresQualifiedReviewer !== true || !/^[A-Za-z0-9._-]{1,100}$/.test(unit.revision || '')) {
      fail('Bản thảo chưa đủ thông tin để tạo đề xuất có kiểm soát.')
    }
    const prefix = `chapter-${String(unit.chapter).padStart(2, '0')}`
    const moduleId = `nutrition-${prefix}`
    const expectedLessons = ['core', 'practice', 'checkpoint'].map((suffix) => `${prefix}-${suffix}`)
    if (previousModule?.id !== moduleId || previousModule.lessons?.length !== 3
        || expectedLessons.some((id) => !previousModule.lessons.some((lesson) => lesson.id === id))) {
      fail('Chỉ nhập vào đúng chương Aura có ba bài gốc; không tự thay cấu trúc hoặc bỏ bài bổ sung.')
    }
    const sourceById = new Map((packet.sources || []).map((source) => [source.id, source]))
    if (!unit.referenceIds?.length || sourceById.size !== packet.sources.length
        || unit.referenceIds.some((id) => !sourceById.has(id))) fail('Bản thảo thiếu nguồn tham khảo.')
    for (const source of packet.sources) {
      let url
      try { url = new URL(source.url) } catch { fail('Đường dẫn nguồn tham khảo không hợp lệ.') }
      if (url.protocol !== 'https:' || url.username || url.password) fail('Nguồn tham khảo phải dùng HTTPS và không chứa thông tin đăng nhập.')
    }
    const objectives = new Set(unit.objectives.map((item) => item.id))
    const sectionIds = new Set(unit.sections.map((section) => section.id))
    if (objectives.size !== unit.objectives.length || sectionIds.size !== unit.sections.length
        || !objectives.size || !sectionIds.size) fail('Mục tiêu hoặc mục nội dung bị thiếu/trùng.')
    if (!Array.isArray(checkpointQuestions) || checkpointQuestions.length < objectives.size
        || checkpointQuestions.some((question) => !objectives.has(question.competencyId)
          || !Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex >= question.options.length
          || question.remediationCardIds?.some((id) => !sectionIds.has(id)))) {
      fail('Bộ checkpoint không khớp mục tiêu, đáp án hoặc nội dung ôn lại.')
    }
    if ([...objectives].some((id) => !checkpointQuestions.some((question) => question.competencyId === id))) fail('Checkpoint chưa bao phủ đủ mục tiêu.')
    if (packet.formativeChecks?.some((check) => !objectives.has(check.objectiveId) || !sectionIds.has(check.sectionId))) fail('Câu tự kiểm không khớp mục tiêu.')

    const references = packet.sources.map((source) => `### ${text(source.organization)}: ${text(source.title)}\n\n[Đọc nguồn](${sourceUrl(source.url)})\n\n${text(source.supports)}\n\nGiới hạn: ${text(source.limitations)}\n\nĐối chiếu đường dẫn: ${text(source.checkedAt)}.`).join('\n\n')
    const sourceLinks = (ids) => ids.map((id) => {
      const source = sourceById.get(id)
      if (!source) fail(`Thiếu nguồn của mục nội dung: ${id}`)
      return `[${text(source.organization)} — ${text(source.title)}](${sourceUrl(source.url)})`
    }).join('; ')
    const practiceBody = [
      `# ${text(unit.practice.title)}`, `Đầu ra: ${text(unit.practice.artifact)}`, numbered(unit.practice.steps),
      ...unit.practice.fields.map((field) => `## ${text(field.label)}${field.required ? ' (bắt buộc)' : ''}\n\n${text(field.prompt)}`),
      '## Bài làm minh họa', bullets(unit.practice.modelResponse),
      '## Tiêu chí đánh giá', 'Tự đánh giá không đồng nghĩa coach đã duyệt hoặc đã có năng lực chuyên môn.',
      ...unit.practice.rubric.map((criterion) => `### ${text(criterion.label)}\n\n${criterion.levels.map((level, index) => `${index}. ${text(level)}`).join('\n')}`),
      '## Giới hạn an toàn', bullets(unit.safety),
    ].join('\n\n')
    const body = [
      `# ${text(unit.title)}`, `Dành cho: ${text(unit.audience)}`, `Phạm vi: ${text(unit.scope)}`,
      unit.prerequisites.length ? `Nên học trước: Chương ${unit.prerequisites.join(', ')}.` : 'Không yêu cầu chương trước.',
      '## Mục tiêu và minh chứng', ...unit.objectives.map((item) => `### ${text(item.outcome)}\n\nMinh chứng: ${text(item.evidence)}`),
      '## Nội dung nền tảng', ...unit.sections.map((section) => {
        if (section.objectiveIds.some((id) => !objectives.has(id))) fail('Mục nội dung không khớp mục tiêu.')
        return `### ${text(section.title)}\n\n${paragraphs(section.paragraphs)}\n\n${bullets(section.takeaways)}\n\nNguồn: ${sourceLinks(section.sourceIds)}`
      }),
      '## Ví dụ có lời giải', 'Số liệu giả định phục vụ học tập, không tự chuyển thành chỉ định cá nhân.',
      ...unit.workedExamples.map((example) => `### ${text(example.title)}\n\n${text(example.prompt)}\n\n${bullets(example.given)}\n\n${numbered(example.steps)}\n\nKết luận: ${text(example.answer)}\n\nGiới hạn: ${text(example.limitation)}`),
      '## Tình huống để luyện lập luận', ...unit.cases.map((item) => `### ${text(item.title)}\n\n${text(item.context)}\n\n${text(item.question)}\n\n${numbered(item.reasoning)}\n\nBước tiếp: ${text(item.safeNextStep)}\n\nLỗi dễ gặp: ${text(item.commonError)}`),
      practiceBody.replace(/^# /, '## '), '## Gợi ý cho người hướng dẫn', bullets(unit.coachExtension),
      '## Nguồn và phạm vi sử dụng', references,
    ].join('\n\n')
    const previousLessons = new Map(previousModule.lessons.map((lesson) => [lesson.id, lesson]))
    const priorPractice = previousLessons.get(expectedLessons[0]).learningDesign?.practice
    let version = Number.isSafeInteger(priorPractice?.version) && priorPractice.version > 0 ? priorPractice.version : 1
    const cards = [
      ...unit.sections.map((section) => ({ id: section.id, kind: 'core', title: section.title, body: section.paragraphs.join('\n\n'), detail: section.takeaways.join('\n'), competencyIds: section.objectiveIds })),
      ...unit.workedExamples.map((example) => ({ id: example.id, kind: 'vietnam-example', title: example.title, body: [example.prompt, ...example.given].join('\n'), detail: [...example.steps, example.answer, example.limitation].join('\n'), competencyIds: example.objectiveIds })),
      ...unit.cases.map((item) => ({ id: item.id, kind: 'decision', title: item.title, body: `${item.context}\n${item.question}`, detail: [...item.reasoning, item.safeNextStep, item.commonError].join('\n'), competencyIds: [...objectives] })),
      { id: `${prefix}-safety`, kind: 'safety', title: 'Giới hạn an toàn', body: unit.safety.join('\n'), competencyIds: [...objectives] },
    ]
    const design = { version: 1, chapterId: prefix, competencyIds: [...objectives], cards,
      microChecks: packet.formativeChecks.map((check) => ({ id: check.id, competencyId: check.objectiveId, prompt: check.prompt,
        options: check.options.map((label) => ({ label, feedback: check.feedback })), correctIndex: check.correctIndex, remediationCardIds: [check.sectionId] })),
      practice: { version, title: unit.practice.title, outcome: unit.practice.artifact,
        fields: unit.practice.fields.map((field) => ({ ...field, kind: 'long' })),
        minimumEvidence: unit.practice.fields.filter((field) => field.required).map((field) => field.label),
        safetyPrompt: unit.safety.join('\n'), reviewRubric: { version, criteria: clone(unit.practice.rubric) } },
      safetyGate: { title: 'Tôi hiểu giới hạn của bài học', body: unit.safety.join('\n'), mustAcknowledge: true },
    }
    const core = { ...retainedLesson(previousLessons.get(expectedLessons[0])), type: 'Bài đọc', title: `Nắm lõi: ${unit.title}`, summary: unit.scope,
      learningDesign: design, primaryContent: { kind: 'rich-text', body }, completionPolicy: { mode: 'manual' },
      memory: { recap: unit.scope, takeaways: unit.sections.flatMap((section) => section.takeaways), glossary: [],
        recallPrompts: unit.objectives.map((objective) => ({ id: `${objective.id}-recall`, prompt: objective.outcome, answer: objective.evidence })),
        flashcards: cards.map((card) => ({ id: card.id, front: card.title, back: [card.body, card.detail].filter(Boolean).join('\n') })) },
      coachNotes: unit.coachExtension.join('\n'), tags: [`Chương ${unit.chapter}`, 'Học cùng Aura', `Nội dung ${unit.revision}`] }
    const practice = { ...retainedLesson(previousLessons.get(expectedLessons[1])), type: 'Bài đọc', title: `Thực hành: ${unit.practice.title}`, summary: unit.practice.artifact,
      primaryContent: { kind: 'rich-text', body: practiceBody }, completionPolicy: { mode: 'manual' },
      memory: { recap: unit.practice.artifact, takeaways: unit.practice.steps, glossary: [], recallPrompts: [], flashcards: [] }, coachNotes: 'Nộp bài chỉ ghi nhận minh chứng. Coach đối chiếu đúng tiêu chí đã lưu cùng bản nộp.' }
    const quizId = `${prefix}-checkpoint-quiz`
    const checkpoint = { ...retainedLesson(previousLessons.get(expectedLessons[2])), title: `Checkpoint Chương ${unit.chapter}`, type: 'Quiz',
      summary: `${checkpointQuestions.length} câu kiểm tra các mục tiêu của chương và giới hạn an toàn.`,
      quiz: { id: quizId, passPercent: 80, questionOrder: 'shuffle',
        publicSettings: { maxAttempts: 5, revealMode: 'after-submit', questionsPerAttempt: checkpointQuestions.length }, questions: clone(checkpointQuestions) },
      completionPolicy: { mode: 'quiz-pass', quizId } }
    const proposal = { ...withoutAdoption(previousModule), title: `Chương ${unit.chapter} · ${unit.title}`, lessons: [core, practice, checkpoint] }
    const normalizeProposal = () => normalize({ ...course, id: courseId, publicationStatus: 'draft', modules: [proposal], quizAnswerKeys: {} })
    let normalized = normalizeProposal()
    if (canonical(practiceShape(normalized.course.modules[0].lessons[0].learningDesign.practice)) !== canonical(practiceShape(priorPractice))) {
      if (!Number.isSafeInteger(version + 1)) fail('Phiên bản bài thực hành vượt giới hạn an toàn.')
      version++
      design.practice.version = version; design.practice.reviewRubric.version = version
      normalized = normalizeProposal()
    }
    const quizKeys = Object.fromEntries([...normalized.quizDefinitions].map(([lessonId, quiz]) => {
      const answers = normalized.answerCandidates.get(lessonId)
      const grading = { ...quiz, questionsPerAttempt: quiz.publicSettings?.questionsPerAttempt ?? quiz.questions.length }
      return [lessonId, { quizId: quiz.id, passPercent: quiz.passPercent, answers, questionCount: quiz.questions.length, contentHash: buildQuizContentHash(grading, answers) }]
    }))
    const baseContentHash = hash({ module: withoutAdoption(previousModule), quizKeys: previousQuizKeys })
    return clone({ schemaVersion: 1, compilerVersion: COMPILER_VERSION, courseId, moduleId, chapter: unit.chapter,
      sourceRevision: unit.revision, source: packet, checkpointQuestions, baseContentHash,
      module: normalized.course.modules[0], quizKeys })
  }
  return { compile, hash, withoutAdoption }
}

module.exports = { createAcademyDraftCompiler, COMPILER_VERSION }
