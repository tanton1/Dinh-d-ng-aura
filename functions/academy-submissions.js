'use strict'

const { createHash } = require('node:crypto')
const { createAcademyCourseStorage } = require('./academy-course-storage')
const { academyWorkbookDocumentId, auraPracticeDefinition, validateAcademyPracticeSubmission } = require('./academy-practice')
const { academyPortfolioStages, academyReviewRubric } = require('./generated/academy-submission-policy.cjs')

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const headId = (courseId, artifactId) => hash([courseId, artifactId])
const coachRoles = new Set(['coach'])
const staffRoles = new Set(['editor', 'admin', 'super_admin'])
const PAGE_SIZE = 20

/** Reads only. The caller must finish all its transaction reads before applying this write plan. */
async function prepareAcademySubmission({ db, transaction, HttpsError, userId, courseId, artifactId, lessonId, kind, title, validated, sourceEvidence = [] }) {
  const submissionId = hash([courseId, artifactId, validated.workbookRevision, validated.contentHash, sourceEvidence])
  const submissionRef = db.doc(`users/${userId}/academySubmissions/${submissionId}`)
  const headRef = db.doc(`users/${userId}/academySubmissionHeads/${headId(courseId, artifactId)}`)
  const [existing, head] = await Promise.all([transaction.get(submissionRef), transaction.get(headRef)])
  if (head.exists && (head.data().workbookRevision > validated.workbookRevision
      || (existing.exists && head.data().submissionId !== submissionId))) {
    throw new HttpsError('aborted', 'Đã có bản nộp mới hơn. Hãy tải lại trước khi nộp.')
  }
  const document = {
    schemaVersion: 1, userId, courseId, artifactId, lessonId, kind, title,
    submissionId, workbookRevision: validated.workbookRevision,
    definitionVersion: validated.definitionVersion, definitionHash: validated.definitionHash,
    contentHash: validated.contentHash, evidence: validated.evidence,
    definitionSnapshot: validated.definitionSnapshot,
    rubric: validated.definitionSnapshot.reviewRubric || academyReviewRubric, sourceEvidence,
  }
  if (Buffer.byteLength(JSON.stringify(document), 'utf8') > 100 * 1024) {
    throw new HttpsError('failed-precondition', 'Bài nộp quá lớn. Hãy rút gọn nội dung trước khi nộp.')
  }
  return { submissionId, submissionRef, headRef, document, duplicate: existing.exists }
}

function writeAcademySubmission(transaction, plan, FieldValue) {
  // Retries neither create another snapshot nor reset an existing coach review.
  if (plan.duplicate) return
  transaction.create(plan.submissionRef, { ...plan.document, submittedAt: FieldValue.serverTimestamp() })
  const { userId, courseId, artifactId, lessonId, kind, title, workbookRevision, definitionVersion } = plan.document
  transaction.set(plan.headRef, {
    schemaVersion: 1, userId, courseId, artifactId, lessonId, kind, title, workbookRevision, definitionVersion,
    submissionId: plan.submissionId, reviewStatus: 'not-reviewed', submittedAt: FieldValue.serverTimestamp(),
  })
}

function createAcademySubmissionHandler({ db, HttpsError, FieldValue, requireCaller, requireDocumentId, hasTrustedRole, hasCourseEntitlement, hasValidCourseAccessSettings, assertDripAccess, courseStorage = createAcademyCourseStorage({ db, HttpsError }) }) {
  const fail = (code, message) => { throw new HttpsError(code, message) }
  const safeId = (value, label) => requireDocumentId(value, label)
  const safeHash = (value) => {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('invalid-argument', 'Mã phiên bản không hợp lệ.')
    return value
  }
  const ref = (userId, collection, id) => db.doc(`users/${userId}/${collection}/${id}`)
  const time = (value) => typeof value?.toMillis === 'function' ? value.toMillis() : null
  const publicReview = (review) => review ? {
    submissionId: review.submissionId, revision: review.revision, reviewerId: review.reviewerId, reviewerName: review.reviewerName || 'Coach phụ trách',
    rubricVersion: review.rubricVersion, scores: review.scores, verdict: review.verdict,
    feedback: review.feedback, reviewedAt: time(review.reviewedAt),
  } : null
  const publicHead = (head) => ({
    courseId: head.courseId, artifactId: head.artifactId, kind: head.kind, title: head.title,
    submissionId: head.submissionId, workbookRevision: head.workbookRevision,
    reviewStatus: head.reviewStatus, submittedAt: time(head.submittedAt),
  })

  async function authorize(transaction, request, actorId, userId, requireCoach = false) {
    const actor = await transaction.get(db.doc(`users/${actorId}`))
    if (!actor.exists || actor.data().disabled === true) fail('permission-denied', 'Tài khoản chưa sẵn sàng hoặc đang bị khóa.')
    if (actorId === userId && !requireCoach) return { owner: true, profile: actor.data() }
    if (actorId === userId || !hasTrustedRole(request, actor.data(), coachRoles)) {
      fail('permission-denied', 'Chỉ học viên hoặc coach đang phụ trách được xem bài đã chia sẻ.')
    }
    const [relationship, learner] = await Promise.all([
      transaction.get(db.doc(`coachClients/${userId}`)), transaction.get(db.doc(`users/${userId}`)),
    ])
    const assigned = relationship.data()
    if (!learner.exists || learner.data().disabled === true || assigned?.clientId !== userId
        || assigned?.coachId !== actorId || assigned?.coachingStatus !== 'active') {
      fail('permission-denied', 'Cần phân công coaching đang hoạt động để xem hoặc nhận xét bài.')
    }
    return { owner: false, profile: actor.data() }
  }

  async function consent(transaction, userId, courseId, artifactId) {
    const workbook = await transaction.get(ref(userId, 'academyWorkbooks', academyWorkbookDocumentId(courseId, artifactId)))
    return workbook.exists && workbook.data().courseId === courseId && workbook.data().lessonId === artifactId
      && workbook.data().sharedWithCoach === true
  }

  async function submitPortfolio(transaction, request, userId, profile) {
    const courseId = safeId(request.data?.courseId, 'Mã khóa học')
    const stage = academyPortfolioStages.find((candidate) => candidate.id === request.data?.stageId)
    if (!stage) fail('invalid-argument', 'Chặng portfolio không hợp lệ.')
    const artifactId = `academy-portfolio-stage-${stage.id}`
    const [courseSnap, enrollmentSnap, workbookSnap] = await Promise.all([
      transaction.get(db.doc(`courses/${courseId}`)), transaction.get(db.doc(`enrollments/${userId}_${courseId}`)),
      transaction.get(ref(userId, 'academyWorkbooks', academyWorkbookDocumentId(courseId, artifactId))),
    ])
    let course = courseSnap.exists ? courseStorage.publishedCourse(courseSnap.data()) : null
    const enrollment = enrollmentSnap.data()
    const staff = hasTrustedRole(request, profile, staffRoles)
    if (!course || course.schemaVersion !== 2 || !hasValidCourseAccessSettings(course)) {
      fail('failed-precondition', 'Khóa học chưa sẵn sàng để nộp portfolio.')
    }
    if (!enrollmentSnap.exists || enrollment.userId !== userId || enrollment.courseId !== courseId
        || !['active', 'completed'].includes(enrollment.status) || !hasCourseEntitlement(course, profile, staff)) {
      fail('permission-denied', 'Bạn cần quyền học hợp lệ để nộp portfolio.')
    }
    const moduleIndex = course.modules?.findIndex((module) => module.id === `nutrition-chapter-${String(stage.milestoneChapter).padStart(2, '0')}`) ?? -1
    if (moduleIndex < 0) fail('failed-precondition', 'Khóa học không có chặng portfolio này.')
    assertDripAccess(course, enrollment, moduleIndex, staff)
    const definition = { coreLessonId: artifactId, design: { practice: {
      version: 1, title: stage.title, outcome: stage.outcome,
      fields: [...stage.fields.map(({ id, label, prompt, kind }) => ({ id, label, prompt, kind, required: true })),
        { id: 'reviewAt', label: 'Ngày rà lại portfolio', prompt: 'Ngày rà lại bản tổng hợp.', kind: 'date', required: true }],
      safetyPrompt: 'Bản tổng hợp là minh chứng học tập, không phải hướng dẫn chẩn đoán hoặc điều trị.',
    } } }
    const validated = validateAcademyPracticeSubmission({ courseId, definition, workbookDocument: workbookSnap.data(),
      evidence: { workbookLessonId: artifactId, workbookRevision: request.data?.workbookRevision } })
    if (!validated.ok) fail('failed-precondition', validated.message)
    const selfScores = JSON.parse(workbookSnap.data().body).rubric
    if (!selfScores || academyReviewRubric.criteria.some(({ id }) => ![0, 1, 2].includes(selfScores[id]))
        || selfScores.safety < 1 || academyReviewRubric.criteria.reduce((sum, { id }) => sum + selfScores[id], 0) < 6) {
      fail('failed-precondition', 'Hãy tự rà ít nhất 6/8 và không để mục an toàn bằng 0 trước khi nộp. Đây không phải điểm của coach.')
    }
    // Bind five actual submissions, never a mutable draft or client completion flag.
    const sourceIds = Array.from({ length: 5 }, (_, index) => `chapter-${String(stage.chapterRange[0] + index).padStart(2, '0')}-core`)
    const sourceModules = sourceIds.map((id) => course.modules.find((module) => module.lessons?.some((lesson) => lesson.id === id)))
    if (sourceModules.some((module) => !module) || new Set(sourceModules.map((module) => module.id)).size !== 5) {
      fail('failed-precondition', 'Danh mục năm chương trong chặng không đầy đủ. Hãy tải lại khóa học.')
    }
    // The five published definitions, not an editor's working copy, determine
    // whether the immutable source evidence is still compatible.
    course = (await courseStorage.load({ courseId, course, moduleIds: sourceModules.map((module) => module.id),
      read: (reference) => transaction.get(reference) })).course
    const heads = await Promise.all(sourceIds.map((id) => transaction.get(ref(userId, 'academySubmissionHeads', headId(courseId, id)))))
    if (heads.some((head) => !head.exists)) fail('failed-precondition', 'Cần nộp đủ năm bài thực hành trong chặng. Bài đã hoàn thành từ phiên bản cũ cần được mở và nộp lại để lưu minh chứng.')
    const sources = await Promise.all(heads.map((head) => transaction.get(ref(userId, 'academySubmissions', safeHash(head.data().submissionId)))))
    const sourceEvidence = sources.map((source, index) => {
      const evidence = source.data()
      const coreId = sourceIds[index]
      const practiceId = coreId.replace('-core', '-practice')
      const module = course.modules.find((item) => item.lessons?.some((lesson) => lesson.id === coreId))
      const currentDefinition = auraPracticeDefinition(module, module?.lessons?.find((lesson) => lesson.id === practiceId))
      if (!source.exists || evidence.userId !== userId || evidence.courseId !== courseId || evidence.artifactId !== coreId
          || evidence.kind !== 'practice' || !currentDefinition?.design?.practice
          || evidence.definitionHash !== hash(currentDefinition.design.practice)) {
        fail('failed-precondition', 'Bài thực hành nguồn đã đổi cấu trúc. Hãy kiểm tra và nộp lại bài trước khi tổng hợp.')
      }
      return { artifactId: coreId, submissionId: evidence.submissionId, workbookRevision: evidence.workbookRevision, contentHash: evidence.contentHash }
    })
    const plan = await prepareAcademySubmission({ db, transaction, HttpsError, userId, courseId, artifactId,
      lessonId: artifactId, kind: 'portfolio', title: stage.title, validated, sourceEvidence })
    writeAcademySubmission(transaction, plan, FieldValue)
    return { submissionId: plan.submissionId, workbookRevision: validated.workbookRevision, duplicate: plan.duplicate }
  }

  return async (request) => {
    const actorId = requireCaller(request)
    const action = request.data?.action
    if (!['read', 'list', 'review', 'submit-portfolio'].includes(action)) fail('invalid-argument', 'Thao tác bài nộp không được hỗ trợ.')
    const userId = request.data?.userId === undefined ? actorId : safeId(request.data.userId, 'Mã học viên')
    if (action === 'submit-portfolio' && userId !== actorId) fail('permission-denied', 'Chỉ học viên có thể nộp bài của mình.')
    return db.runTransaction(async (transaction) => {
      const access = await authorize(transaction, request, actorId, userId, action === 'review')
      if (action === 'submit-portfolio') return submitPortfolio(transaction, request, userId, access.profile)
      if (action === 'list') {
        let query = db.collection(`users/${userId}/academySubmissionHeads`).orderBy('__name__').limit(PAGE_SIZE + 1)
        if (request.data?.cursor) query = query.startAfter(safeHash(request.data.cursor))
        const page = await transaction.get(query)
        const docs = page.docs.slice(0, PAGE_SIZE)
        const allowed = access.owner ? docs.map(() => true) : await Promise.all(docs.map((doc) => consent(transaction, userId, doc.data().courseId, doc.data().artifactId)))
        return { items: docs.filter((_doc, index) => allowed[index]).map((doc) => publicHead(doc.data())),
          nextCursor: page.docs.length > PAGE_SIZE ? docs.at(-1).id : null }
      }
      const courseId = safeId(request.data?.courseId, 'Mã khóa học')
      const artifactId = safeId(request.data?.artifactId, 'Mã bài thực hành')
      if (!access.owner && !await consent(transaction, userId, courseId, artifactId)) {
        fail('permission-denied', 'Học viên chưa chia sẻ hoặc đã dừng chia sẻ bài này.')
      }
      const headSnap = await transaction.get(ref(userId, 'academySubmissionHeads', headId(courseId, artifactId)))
      if (!headSnap.exists) {
        if (action === 'review') fail('not-found', 'Chưa có bản nộp để nhận xét.')
        return { submission: null, review: null, latestSubmissionId: null }
      }
      const head = headSnap.data()
      const submissionId = safeHash(request.data?.submissionId ?? head.submissionId)
      const reviewRef = ref(userId, 'academySubmissionReviews', submissionId)
      const [submissionSnap, reviewSnap] = await Promise.all([
        transaction.get(ref(userId, 'academySubmissions', submissionId)), transaction.get(reviewRef),
      ])
      const submission = submissionSnap.data()
      if (!submissionSnap.exists || submission.userId !== userId || submission.courseId !== courseId || submission.artifactId !== artifactId) {
        fail('not-found', 'Bản nộp không thuộc bài học đã chọn.')
      }
      const existingReview = reviewSnap.data()
      if (action === 'read') return {
        submission: { ...submission, submittedAt: time(submission.submittedAt) },
        review: publicReview(existingReview), latestSubmissionId: head.submissionId,
      }
      if (submissionId !== head.submissionId) fail('aborted', 'Học viên đã nộp phiên bản mới. Hãy mở bản mới nhất trước khi phản hồi.')
      const expectedRevision = request.data?.expectedReviewRevision
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) fail('invalid-argument', 'Phiên bản phản hồi không hợp lệ.')
      const scores = {}
      for (const { id } of submission.rubric.criteria) {
        const score = request.data?.scores?.[id]
        if (![0, 1, 2].includes(score)) fail('invalid-argument', 'Mỗi tiêu chí cần có điểm 0, 1 hoặc 2.')
        scores[id] = score
      }
      const verdict = request.data?.verdict
      const feedback = typeof request.data?.feedback === 'string' ? request.data.feedback.trim() : ''
      if (!['accepted', 'needs-revision'].includes(verdict) || feedback.length < 20 || feedback.length > 4000) {
        fail('invalid-argument', 'Chọn kết quả và viết nhận xét từ 20 đến 4.000 ký tự, nêu điểm tốt và việc cần làm tiếp.')
      }
      if (verdict === 'accepted' && (scores.safety < 1 || Object.values(scores).reduce((a, b) => a + b, 0) < 6)) {
        fail('failed-precondition', 'Chỉ xác nhận đạt bài khi ít nhất 6/8 và an toàn không bằng 0.')
      }
      const payloadHash = hash([submissionId, actorId, expectedRevision, scores, verdict, feedback])
      if (existingReview?.payloadHash === payloadHash && existingReview.revision === expectedRevision + 1) {
        return { review: publicReview(existingReview), duplicate: true }
      }
      if ((existingReview?.revision ?? 0) !== expectedRevision) fail('aborted', 'Phản hồi đã có bản mới. Hãy tải lại trước khi lưu.')
      const reviewerName = typeof access.profile.displayName === 'string' ? access.profile.displayName.trim().slice(0, 100) : ''
      const review = { submissionId, reviewerId: actorId, reviewerName: reviewerName || 'Coach phụ trách', revision: expectedRevision + 1, rubricVersion: submission.rubric.version,
        scores, verdict, feedback, payloadHash, reviewedAt: FieldValue.serverTimestamp() }
      transaction.create(db.doc(`${reviewRef.path}/academyReviewRevisions/${review.revision}`), review)
      transaction.set(reviewRef, review)
      transaction.update(ref(userId, 'academySubmissionHeads', headId(courseId, artifactId)), { reviewStatus: verdict })
      return { review: publicReview(review), duplicate: false }
    })
  }
}

module.exports = { createAcademySubmissionHandler, prepareAcademySubmission, writeAcademySubmission, headId }
