'use strict'

const { STORAGE, LIMITS } = require('./academy-course-storage')
const { createAcademyDraftCompiler } = require('./academy-draft-compiler')
const STAFF = new Set(['editor', 'admin', 'super_admin'])
const REVIEW_CHECKS = ['content', 'assessment', 'references', 'safety']
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')

/** Explicit, server-owned review/adoption commands. Never creates reviewer grants. */
function createAcademyDraftAdoption({ db, HttpsError, FieldValue, storage, authorize, validateId,
  normalize, buildQuizContentHash, assertReady, loadDraft, loadCheckpoint, now = Date.now }) {
  const compiler = createAcademyDraftCompiler({ HttpsError, normalize, buildQuizContentHash, canonical: storage.canonical })
  const fail = (code, message) => { throw new HttpsError(code, message) }
  const digest = (value) => {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('invalid-argument', 'Mã đề xuất không hợp lệ.')
    return value
  }
  const revision = (value) => {
    if (!Number.isSafeInteger(value) || value < 0) fail('invalid-argument', 'Cần revision hiện tại để thao tác an toàn.')
    return value
  }
  const ref = (courseId, collection, id) => db.doc(`courses/${courseId}/${collection}/${id}`)
  const readIn = (transaction) => {
    const cache = new Map()
    return (reference) => {
      if (!cache.has(reference.path)) cache.set(reference.path, transaction.get(reference))
      return cache.get(reference.path)
    }
  }
  const timestamp = (value) => typeof value?.toMillis === 'function' ? value.toMillis() : null
  const requiredIds = (course) => {
    const supplied = course.academyReviewRequiredModuleIds ?? []
    if (!Array.isArray(supplied) || supplied.length > 40 || supplied.some((id) => typeof id !== 'string')) fail('failed-precondition', 'Chính sách duyệt chương không hợp lệ.')
    return [...new Set([...supplied, ...(course.modules || []).filter((module) => module.academyAdoption).map((module) => module.id)])]
  }
  const keysFor = (module, keys) => Object.fromEntries(module.lessons.filter((lesson) => keys[lesson.id]).map((lesson) => [lesson.id, keys[lesson.id]]))
  const contentHash = (module, keys) => compiler.hash({ module: compiler.withoutAdoption(module), quizKeys: keysFor(module, keys) })
  const grantAllows = (grant, chapter) => grant?.enabled === true && grant.qualificationVerified === true
    && grant.scope === 'nutrition-education' && Number.isSafeInteger(grant.revision) && grant.revision > 0
    && typeof grant.qualificationReference === 'string' && grant.qualificationReference.trim().length > 0
    && Array.isArray(grant.chapters) && grant.chapters.includes(chapter) && timestamp(grant.validUntil) > now()
  const reviewView = (review) => review ? { revision: review.revision, decision: review.decision, reviewerId: review.reviewerId,
    notes: review.notes, checks: review.checks, reviewedAt: timestamp(review.reviewedAt) } : null
  const audit = (transaction, actor, courseId, action, data) => transaction.set(db.collection('auditLogs').doc(), {
    actorUid: actor.actorId, targetId: courseId, action, ...data, createdAt: FieldValue.serverTimestamp(),
  })

  async function candidate(read, courseId, candidateId) {
    const snapshot = await read(ref(courseId, 'academyAdoptionCandidates', candidateId))
    const value = snapshot.data()
    if (!snapshot.exists || value?.artifact?.courseId !== courseId || value.candidateId !== candidateId
        || compiler.hash(value.artifact) !== candidateId) fail('failed-precondition', 'Đề xuất bị thiếu hoặc không còn khớp nội dung đã lưu.')
    return value
  }

  async function approved(read, courseId, candidateId, artifact) {
    const snapshot = await read(ref(courseId, 'academyAdoptionReviews', candidateId))
    const review = snapshot.data()
    if (!snapshot.exists || review?.candidateId !== candidateId || review.decision !== 'approved'
        || !Number.isSafeInteger(review.revision) || review.revision < 1 || REVIEW_CHECKS.some((key) => review.checks?.[key] !== true)) {
      fail('failed-precondition', 'Đề xuất chưa được duyệt đủ nội dung, câu hỏi, nguồn và an toàn.')
    }
    const reviewerId = validateId(review.reviewerId, 'Mã người duyệt')
    const [profile, permission] = await Promise.all([read(db.doc(`users/${reviewerId}`)), read(db.doc(`academyScientificReviewers/${reviewerId}`))])
    if (!profile.exists || profile.data().disabled === true || !STAFF.has(profile.data().role)
        || !permission.exists || !grantAllows(permission.data(), artifact.chapter)
        || permission.data().revision !== review.reviewerGrantRevision) {
      fail('failed-precondition', 'Quyền duyệt chuyên môn đã đổi hoặc hết hạn; cần duyệt lại đề xuất trước khi tiếp tục.')
    }
    return review
  }

  /** Run inside the same transaction as save/review/publication; no cross-request cache. */
  async function validateCourse({ courseId, course, quizKeys, read }) {
    for (const moduleId of requiredIds(course)) {
      const chapter = /^nutrition-chapter-(\d{2})$/.exec(moduleId)?.[1]
      const protectedLessons = new Set(chapter ? ['core', 'practice', 'checkpoint'].map((part) => `chapter-${chapter}-${part}`) : [])
      if (course.modules.some((item) => item.id !== moduleId && item.lessons.some((lesson) => protectedLessons.has(lesson.id)))) {
        fail('failed-precondition', 'Không thể chuyển bài của chương đã duyệt sang chương khác để bỏ qua kiểm tra nội dung và thực hành.')
      }
      const module = course.modules.find((item) => item.id === moduleId)
      // Removing a chapter publishes no content for it. Its requirement stays
      // in the root so a later re-add cannot bypass review by dropping a stamp.
      if (!module) continue
      const candidateId = module.academyAdoption?.candidateId
      if (typeof candidateId !== 'string' || !/^[a-f0-9]{64}$/.test(candidateId)) fail('failed-precondition', `Chương “${module.title}” cần một đề xuất đã duyệt trước khi gửi duyệt hoặc xuất bản.`)
      const value = await candidate(read, courseId, candidateId)
      if (value.artifact.moduleId !== module.id || contentHash(module, quizKeys) !== contentHash(value.artifact.module, value.artifact.quizKeys)) {
        fail('failed-precondition', `Nội dung hoặc checkpoint của “${module.title}” đã đổi so với bản được duyệt.`)
      }
      await approved(read, courseId, candidateId, value.artifact)
    }
  }

  async function readCandidate(request) {
    const input = request.data?.adoptionCandidate
    const courseId = validateId(input?.courseId, 'Mã khóa học')
    const byChapter = input?.chapter !== undefined
    if (byChapter && (input.candidateId !== undefined || !Number.isInteger(input.chapter) || input.chapter < 1 || input.chapter > 20)) fail('invalid-argument', 'Chọn một chương hợp lệ hoặc một mã đề xuất cụ thể.')
    const requestedId = byChapter ? null : digest(input?.candidateId)
    return db.runTransaction(async (transaction) => {
      const read = readIn(transaction)
      const actor = await authorize(request, read)
      const course = await read(db.doc(`courses/${courseId}`))
      if (!course.exists) fail('not-found', 'Khóa học không còn tồn tại.')
      const head = byChapter ? await read(ref(courseId, 'academyAdoptionHeads', `nutrition-chapter-${String(input.chapter).padStart(2, '0')}`)) : null
      if (byChapter && !head.exists) return { candidateId: null, courseRevision: course.data().revision }
      const candidateId = requestedId || digest(head.data()?.candidateId)
      const [value, review, permission] = await Promise.all([
        candidate(read, courseId, candidateId), read(ref(courseId, 'academyAdoptionReviews', candidateId)),
        read(db.doc(`academyScientificReviewers/${actor.actorId}`)),
      ])
      if (byChapter && value.artifact.chapter !== input.chapter) fail('failed-precondition', 'Đề xuất mới nhất không thuộc chương đã chọn.')
      const expectedModule = { ...value.artifact.module, academyAdoption: { candidateId } }
      const expectedHash = compiler.hash({ module: expectedModule, quizKeys: value.artifact.quizKeys })
      let approvalValid = false
      try { await approved(read, courseId, candidateId, value.artifact); approvalValid = true } catch (error) {
        if (error.code !== 'failed-precondition') throw error
      }
      return { candidateId, artifact: value.artifact, preparedAtRevision: value.preparedAtRevision,
        createdAt: timestamp(value.createdAt), review: reviewView(review.data()), approvalValid,
        canReview: permission.exists && grantAllows(permission.data(), value.artifact.chapter),
        courseRevision: course.data().revision,
        alreadyAdopted: course.data().chapterRefs?.[value.artifact.moduleId]?.contentHash === expectedHash }
    }, { readOnly: true })
  }

  async function mutate(request) {
    const input = request.data?.academyAdoption
    if (!input || !['prepare', 'review', 'adopt'].includes(input.action)) fail('invalid-argument', 'Thao tác đề xuất chương không hợp lệ.')
    const courseId = validateId(input.courseId, 'Mã khóa học')
    return db.runTransaction(async (transaction) => {
      const read = readIn(transaction)
      const actor = await authorize(request, read)
      if (input.expectedActorId !== undefined && input.expectedActorId !== actor.actorId) fail('permission-denied', 'Phiên đăng nhập đã thay đổi; thao tác chưa được thực hiện.')
      if (input.action === 'review') {
        const candidateId = digest(input.candidateId), expected = revision(input.expectedReviewRevision)
        const [value, permission, prior, course] = await Promise.all([candidate(read, courseId, candidateId),
          read(db.doc(`academyScientificReviewers/${actor.actorId}`)), read(ref(courseId, 'academyAdoptionReviews', candidateId)), read(db.doc(`courses/${courseId}`))])
        if (!course.exists) fail('not-found', 'Khóa học không còn tồn tại.')
        if (!permission.exists || !grantAllows(permission.data(), value.artifact.chapter)) fail('permission-denied', 'Tài khoản chưa được phân quyền duyệt chuyên môn còn hiệu lực cho chương này.')
        const notes = typeof input.notes === 'string' ? input.notes.trim() : ''
        if (!['approved', 'changes-requested', 'withdrawn'].includes(input.decision) || notes.length < 40 || notes.length > 6000
            || !input.checks || REVIEW_CHECKS.some((key) => typeof input.checks[key] !== 'boolean')
            || (input.decision === 'approved' && REVIEW_CHECKS.some((key) => input.checks[key] !== true))) {
          fail('invalid-argument', 'Cần ghi nhận phạm vi đã kiểm tra và nhận xét cụ thể trước khi duyệt.')
        }
        const checks = Object.fromEntries(REVIEW_CHECKS.map((key) => [key, input.checks[key]]))
        const requestHash = compiler.hash({ actorId: actor.actorId, candidateId, expected, decision: input.decision, notes, checks, grantRevision: permission.data().revision })
        if (prior.exists && prior.data().requestHash === requestHash) return { candidateId, review: reviewView(prior.data()), duplicate: true }
        if ((prior.data()?.revision || 0) !== expected) fail('aborted', 'Kết quả duyệt đã thay đổi; hãy tải lại trước khi lưu.')
        const review = { candidateId, revision: expected + 1, decision: input.decision, notes, checks,
          reviewerId: actor.actorId, reviewerGrantRevision: permission.data().revision, requestHash, reviewedAt: FieldValue.serverTimestamp() }
        transaction.set(ref(courseId, 'academyAdoptionReviews', candidateId), review)
        transaction.create(ref(courseId, 'academyReviewHistory', `${candidateId}_${String(review.revision).padStart(6, '0')}`), review)
        audit(transaction, actor, courseId, 'academy.chapter.reviewed', { candidateId, reviewRevision: review.revision, decision: review.decision })
        return { candidateId, review: reviewView(review), duplicate: false }
      }

      const expected = revision(input.expectedRevision)
      const snapshot = await read(db.doc(`courses/${courseId}`))
      if (!snapshot.exists) fail('not-found', 'Không tìm thấy khóa học.')
      const root = snapshot.data()
      if (root.contentStorage !== STORAGE) fail('failed-precondition', 'Hãy mở và lưu bản nháp theo từng chương trước khi nhập nội dung mới; không tự di chuyển khóa đang phát hành.')
      storage.validateManifest(root)
      if (input.action === 'prepare') {
        if (root.revision !== expected) fail('aborted', 'Khóa học đã đổi; hãy tải bản mới nhất trước khi tạo đề xuất.')
        const chapter = input.chapter
        if (!Number.isInteger(chapter) || chapter < 1 || chapter > 20) fail('invalid-argument', 'Chương không hợp lệ.')
        const moduleId = `nutrition-chapter-${String(chapter).padStart(2, '0')}`
        const loaded = await storage.load({ courseId, course: root, moduleIds: [moduleId], read })
        const previousModule = loaded.course.modules.find((module) => module.id === moduleId)
        const artifact = compiler.compile({ courseId, course: loaded.course, previousModule, previousQuizKeys: keysFor(previousModule, loaded.quizKeys),
          packet: loadDraft(chapter), checkpointQuestions: loadCheckpoint(chapter) })
        if (bytes(artifact) > LIMITS.chapterBytes) fail('resource-exhausted', 'Đề xuất chương vượt giới hạn an toàn.')
        const candidateId = compiler.hash(artifact)
        const headRef = ref(courseId, 'academyAdoptionHeads', moduleId)
        const [existing, head] = await Promise.all([read(ref(courseId, 'academyAdoptionCandidates', candidateId)), read(headRef)])
        if (!existing.exists) {
          transaction.create(ref(courseId, 'academyAdoptionCandidates', candidateId), { candidateId, artifact,
            preparedAtRevision: root.revision, createdBy: actor.actorId, createdAt: FieldValue.serverTimestamp() })
          audit(transaction, actor, courseId, 'academy.chapter.proposed', { candidateId, chapter, sourceRevision: artifact.sourceRevision })
        } else if (compiler.hash(existing.data().artifact) !== candidateId) fail('failed-precondition', 'Đề xuất đã lưu không còn toàn vẹn.')
        if (!head.exists || head.data().candidateId !== candidateId) {
          transaction.set(headRef, { candidateId, courseId, moduleId, chapter, sourceRevision: artifact.sourceRevision,
            updatedBy: actor.actorId, updatedAt: FieldValue.serverTimestamp() })
          if (existing.exists) audit(transaction, actor, courseId, 'academy.chapter.proposal.selected', { candidateId, chapter })
        }
        return { courseId, candidateId, chapter, sourceRevision: artifact.sourceRevision, preparedAtRevision: root.revision, duplicate: existing.exists }
      }

      const candidateId = digest(input.candidateId)
      const value = await candidate(read, courseId, candidateId)
      const { artifact } = value
      const review = await approved(read, courseId, candidateId, artifact)
      if (review.revision !== revision(input.expectedReviewRevision)) fail('aborted', 'Kết quả duyệt đã đổi; hãy mở lại đề xuất.')
      const loaded = await storage.load({ courseId, course: root, moduleIds: [artifact.moduleId], read })
      const current = loaded.course.modules.find((module) => module.id === artifact.moduleId)
      if (current.academyAdoption?.candidateId === candidateId && contentHash(current, loaded.quizKeys) === contentHash(artifact.module, artifact.quizKeys)) {
        return { courseId, candidateId, revision: root.revision, status: root.status, alreadyAdopted: true }
      }
      if (root.revision !== expected || contentHash(current, loaded.quizKeys) !== artifact.baseContentHash) fail('aborted', 'Chương đã đổi sau khi tạo đề xuất; hãy tạo lại và duyệt đúng bản mới.')
      const nextRevision = root.revision + 1
      const module = { ...artifact.module, academyAdoption: { candidateId } }
      const { contentStorage: _storage, chapterRefs: _refs, publishedSnapshot: _live, ...base } = root
      assertReady({ ...base, modules: [module] }, new Map(Object.entries(artifact.quizKeys)))
      const partial = storage.pack({ courseId, revision: nextRevision, course: { ...base, status: 'draft', modules: [module] }, quizKeys: artifact.quizKeys, priorCourse: root })
      const manifest = { ...storage.manifestOf(root), status: 'draft', revision: nextRevision,
        modules: root.modules.map((item) => item.id === module.id ? partial.manifest.modules[0] : item),
        chapterRefs: { ...root.chapterRefs, [module.id]: partial.manifest.chapterRefs[module.id] },
        academyReviewRequiredModuleIds: [...new Set([...requiredIds(root), module.id])].sort() }
      storage.validateManifest(manifest)
      const publishedSnapshot = root.publishedSnapshot || (root.status === 'published' ? { active: true, course: storage.manifestOf(root) } : undefined)
      const next = { ...root, ...manifest, updatedBy: actor.actorId, updatedAt: FieldValue.serverTimestamp(),
        revisionUpdatedBy: actor.actorId, revisionUpdatedAt: FieldValue.serverTimestamp(), ...(publishedSnapshot ? { publishedSnapshot } : {}) }
      const history = { courseId, revision: nextRevision, course: manifest, contentHash: compiler.hash(manifest),
        adoptedCandidateId: candidateId, reviewRevision: review.revision, createdBy: actor.actorId, createdAt: FieldValue.serverTimestamp() }
      if (bytes(next) > LIMITS.chapterBytes || bytes(history) > LIMITS.chapterBytes) fail('resource-exhausted', 'Danh mục khóa học vượt giới hạn an toàn.')
      storage.writeChapters(transaction, partial)
      transaction.set(db.doc(`courses/${courseId}`), next)
      transaction.create(db.doc(`courseRevisions/${courseId}_${String(nextRevision).padStart(6, '0')}`), history)
      audit(transaction, actor, courseId, 'academy.chapter.adopted', { candidateId, revision: nextRevision, reviewRevision: review.revision })
      return { courseId, candidateId, revision: nextRevision, status: 'draft', alreadyAdopted: false,
        publishedRevision: publishedSnapshot?.active ? publishedSnapshot.course.revision : null }
    })
  }
  return { mutate, readCandidate, validateCourse }
}

module.exports = { createAcademyDraftAdoption }
