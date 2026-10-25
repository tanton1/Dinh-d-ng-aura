'use strict'

const { createHash } = require('node:crypto')
const { STORAGE, LIMITS } = require('./academy-course-storage')
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const size = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')
const lessons = (course) => (course?.modules || []).flatMap((module) => module.lessons || [])

/** Server-owned authoring commands; every mutation rechecks staff role in its transaction. */
function createAcademyAuthoringHandlers({ db, HttpsError, FieldValue, storage, authorize, validateId,
  normalize, assertSaveStatus, assertReady, buildQuizContentHash, buildDiff, schedulerAvailable = false, validateScientificReview }) {
  const fail = (code, message) => { throw new HttpsError(code, message) }
  function assertClientProtocol(request) {
    // The backend ships before the new editor. An old tab must not migrate a
    // course to chapter storage while it still assumes inline course content.
    // This is a compatibility fence, never a substitute for staff authorization.
    if (request.data?.academyAuthoringProtocol !== STORAGE) {
      fail('failed-precondition', 'Trình biên tập khóa học đã được nâng cấp. Hãy tải lại trang trước khi lưu, khôi phục hoặc xuất bản; nội dung chưa được thay đổi.')
    }
  }
  const revisionRef = (courseId, revision) => db.doc(`courseRevisions/${courseId}_${String(revision).padStart(6, '0')}`)
  const expected = (value, minimum = 0) => {
    if (!Number.isSafeInteger(value) || value < minimum) fail('invalid-argument', 'Cần revision hiện tại để thao tác khóa học an toàn.')
    return value
  }
  const compareRevision = (root, expectedRevision) => {
    const current = Number(root?.revision) || 0
    if (current !== expectedRevision) fail('aborted', 'Khóa học đã thay đổi ở phiên khác. Hãy tải lại bản mới nhất trước khi tiếp tục.')
    return current
  }
  const adminOnly = (actor) => {
    if (!['admin', 'super_admin'].includes(actor.role)) fail('permission-denied', 'Chỉ Administrator được duyệt, xuất bản hoặc khôi phục khóa học.')
  }
  const stamp = (actor) => ({ updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.actorId,
    revisionUpdatedAt: FieldValue.serverTimestamp(), revisionUpdatedBy: actor.actorId })
  const historyFields = (root, actor) => ({ createdAt: root.createdAt ?? FieldValue.serverTimestamp(), createdBy: root.createdBy ?? actor.actorId,
    ...Object.fromEntries(['firstPublishedAt', 'publishedAt', 'publishedBy', 'archivedAt', 'archivedBy']
      .filter((key) => root[key] !== undefined).map((key) => [key, root[key]])) })

  function retainReviewPolicy(course, ...storedCourses) {
    // Never accept a caller-supplied root policy or let restoring an old
    // revision erase a requirement introduced by a later adopted chapter.
    const ids = new Set()
    for (const source of storedCourses) {
      const existing = source?.academyReviewRequiredModuleIds ?? []
      if (!Array.isArray(existing) || existing.length > LIMITS.modules) fail('failed-precondition', 'Chính sách duyệt chương không hợp lệ.')
      for (const id of existing) ids.add(validateId(id, 'Mã chương cần duyệt'))
      for (const module of source?.modules || []) if (module.academyAdoption) ids.add(module.id)
    }
    for (const module of course.modules) if (module.academyAdoption) ids.add(module.id)
    if (ids.size > LIMITS.modules) fail('failed-precondition', 'Chính sách duyệt chương vượt giới hạn an toàn.')
    if (ids.size) course.academyReviewRequiredModuleIds = [...ids].sort()
    return course
  }

  async function requireReviewed(transaction, courseId, course, quizKeys) {
    if (!course.academyReviewRequiredModuleIds?.length && !course.modules.some((module) => module.academyAdoption)) return
    if (!validateScientificReview) fail('failed-precondition', 'Chưa cấu hình kiểm tra duyệt chuyên môn; chưa thể xuất bản chương mới.')
    // Memoize only within this transaction attempt. Revalidate permissions on
    // retries without rereading the same reviewer for every adopted chapter.
    const cache = new Map()
    await validateScientificReview({ courseId, course, quizKeys: quizKeys instanceof Map ? Object.fromEntries(quizKeys) : quizKeys,
      read: (ref) => {
        if (!cache.has(ref.path)) cache.set(ref.path, transaction.get(ref))
        return cache.get(ref.path)
      } })
  }

  function fullInput(courseId, course, quizKeys) {
    const { chapterRefs: _refs, publishedSnapshot: _live, contentStorage: _storage, ...content } = course
    return { ...content, id: courseId, publicationStatus: course.status,
      quizAnswerKeys: Object.fromEntries(Object.entries(quizKeys).map(([lessonId, key]) => [lessonId,
        Object.fromEntries(Object.entries(key.answers || {}).map(([questionId, answer]) => [questionId, [answer]]))])) }
  }

  function assertFullInput(input) {
    // This guard must run BEFORE normalize drops unknown catalog metadata.
    if (input?.modules?.some((module) => module?.contentVersion !== undefined
        || module?.lessons?.some((lesson) => lesson?.contentVersion !== undefined))) {
      fail('failed-precondition', 'Chưa tải đầy đủ nội dung. Không thể lưu danh mục rút gọn thay cho bài học.')
    }
  }

  function fallbackAllowed(input, lessonId, questionId) {
    if (own(input?.quizAnswerKeys, lessonId)) return false
    const raw = lessons(input).find((lesson) => lesson.id === lessonId)?.quiz?.questions?.find((question) => question.id === questionId)
    return raw && !own(raw, 'correctIndex')
  }

  function mergeKeys(normalized, input, previousCourse, previousKeys = {}) {
    const previousLessons = new Map(lessons(previousCourse).map((lesson) => [lesson.id, lesson]))
    return new Map([...normalized.quizDefinitions].filter(([_id, quiz]) => quiz.questions.length).map(([lessonId, quiz]) => {
      const previousQuiz = previousLessons.get(lessonId)?.quiz
      const candidates = normalized.answerCandidates.get(lessonId) || {}
      const answers = Object.fromEntries(quiz.questions.flatMap((question) => {
        let candidate = candidates[question.id]
        if (!Number.isInteger(candidate) && fallbackAllowed(input, lessonId, question.id)) {
          const priorQuestion = previousQuiz?.questions?.find((item) => item.id === question.id)
          // A stable ID alone is not proof that the old answer is still right.
          if (previousQuiz?.id === quiz.id && priorQuestion?.question === question.question
              && JSON.stringify(priorQuestion.options) === JSON.stringify(question.options)) {
            candidate = previousKeys[lessonId]?.answers?.[question.id] ?? priorQuestion.correctIndex
          }
        }
        return Number.isInteger(candidate) && candidate >= 0 && candidate < question.options.length ? [[question.id, candidate]] : []
      }))
      const gradingDefinition = { ...quiz, questionOrder: quiz.questionOrder === 'shuffle' ? 'shuffle' : 'sequential',
        questionsPerAttempt: quiz.publicSettings?.questionsPerAttempt ?? quiz.questions.length }
      return [lessonId, { quizId: quiz.id, passPercent: quiz.passPercent, answers, questionCount: quiz.questions.length,
        contentHash: buildQuizContentHash(gradingDefinition, answers) }]
    }))
  }

  async function missingAnswerSources(transaction, courseId, root, normalized, input) {
    const missing = [...normalized.quizDefinitions].flatMap(([lessonId, quiz]) => quiz.questions.some((question) =>
      !Number.isInteger(normalized.answerCandidates.get(lessonId)?.[question.id]) && fallbackAllowed(input, lessonId, question.id)) ? [lessonId] : [])
    if (!missing.length || !root.modules) return { course: root, quizKeys: {} }
    if (root.contentStorage === STORAGE) {
      const moduleIds = root.modules.filter((module) => module.lessons.some((lesson) => missing.includes(lesson.id))).map((module) => module.id)
      return storage.load({ courseId, course: root, moduleIds, read: (ref) => transaction.get(ref) })
    }
    if (root.contentStorage !== undefined) fail('failed-precondition', 'Định dạng khóa học chưa được hỗ trợ.')
    const snapshots = await Promise.all(missing.map((lessonId) => transaction.get(db.doc(`courses/${courseId}/quizKeys/${lessonId}`))))
    return { course: root, quizKeys: Object.fromEntries(snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()])) }
  }

  function immutableRevision(courseId, manifest, actor, extra = {}) {
    // No full chapter or quiz key is copied into a revision document.
    return { courseId, revision: manifest.revision, course: manifest,
      contentHash: createHash('sha256').update(storage.canonical(manifest)).digest('hex'),
      createdBy: actor.actorId, createdAt: FieldValue.serverTimestamp(), ...extra }
  }

  function assertWriteBudget(root, revision, plans) {
    if (size(root) > LIMITS.chapterBytes || size(revision) > LIMITS.chapterBytes
        || size(root) + size(revision) + plans.flatMap((plan) => plan.chapters).reduce((sum, chapter) => sum + size(chapter.document), 0) > LIMITS.planBytes) {
      fail('resource-exhausted', 'Đợt lưu khóa học vượt giới hạn an toàn. Hãy chia nhỏ đợt biên tập.')
    }
  }

  function writeRevision(transaction, courseId, root, actor, plan, extra = {}, additionalPlans = []) {
    const revision = immutableRevision(courseId, plan.manifest, actor, extra)
    const plans = [...additionalPlans, plan]
    assertWriteBudget(root, revision, plans)
    for (const item of plans) storage.writeChapters(transaction, item)
    transaction.set(db.doc(`courses/${courseId}`), root)
    transaction.create(revisionRef(courseId, plan.manifest.revision), revision)
  }

  function audit(transaction, actor, courseId, action, fields) {
    transaction.set(db.collection('auditLogs').doc(), { actorUid: actor.actorId, targetId: courseId, action, ...fields, createdAt: FieldValue.serverTimestamp() })
  }

  async function save(request) {
    assertClientProtocol(request)
    const courseId = validateId(request.data?.course?.id, 'Mã khóa học')
    const expectedRevision = expected(request.data?.expectedRevision)
    return db.runTransaction(async (transaction) => {
      const actor = await authorize(request, (ref) => transaction.get(ref))
      assertFullInput(request.data?.course)
      const normalized = normalize(request.data?.course)
      const current = await transaction.get(db.doc(`courses/${courseId}`))
      const root = current.data() || {}
      retainReviewPolicy(normalized.course, root)
      const currentRevision = compareRevision(root, expectedRevision)
      assertSaveStatus(root.status || 'draft', normalized.requestedStatus, actor.role, current.exists)
      const fallback = await missingAnswerSources(transaction, courseId, root, normalized, request.data.course)
      const quizKeys = mergeKeys(normalized, request.data.course, fallback.course, fallback.quizKeys)
      if (normalized.requestedStatus === 'review') {
        assertReady(normalized.course, quizKeys)
        await requireReviewed(transaction, courseId, normalized.course, quizKeys)
      }
      const plan = storage.pack({ courseId, revision: currentRevision + 1, course: normalized.course,
        quizKeys: Object.fromEntries(quizKeys), priorCourse: root })
      const next = { ...plan.manifest, ...historyFields(root, actor),
        ...stamp(actor), ...(root.publishedSnapshot ? { publishedSnapshot: root.publishedSnapshot } : {}) }
      writeRevision(transaction, courseId, next, actor, plan)
      audit(transaction, actor, courseId, !current.exists ? 'course.created' : root.status !== next.status ? 'course.status.changed' : 'course.updated',
        { revision: next.revision, previousStatus: current.exists ? root.status || 'draft' : null, status: next.status })
      const importBatchIds = [...new Set(lessons(normalized.course).map((lesson) => lesson.provenance?.importBatchId).filter(Boolean))]
      for (const importBatchId of importBatchIds) transaction.set(db.collection('courseImportBatches').doc(`${courseId}_${importBatchId}`), {
        courseId, importBatchId, source: 'NotebookLM', latestRevision: next.revision, updatedBy: actor.actorId, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return { courseId, revision: next.revision, status: next.status, contentStorage: STORAGE,
        publishedRevision: next.publishedSnapshot?.active ? next.publishedSnapshot.course.revision : null }
    })
  }

  async function transition(request) {
    assertClientProtocol(request)
    const courseId = validateId(request.data?.courseId, 'Mã khóa học')
    const expectedRevision = expected(request.data?.expectedRevision, 1)
    const nextStatus = request.data?.nextStatus
    const transitions = { review: ['approved'], approved: schedulerAvailable ? ['scheduled', 'published'] : ['published'],
      scheduled: ['published'], published: ['archived'], archived: ['published'] }
    if (!['approved', 'scheduled', 'published', 'archived'].includes(nextStatus)) fail('invalid-argument', 'Trạng thái xuất bản không hợp lệ.')
    if (nextStatus === 'scheduled' && !schedulerAvailable) fail('failed-precondition', 'Lên lịch xuất bản đang khóa vì chưa có scheduler backend.')
    return db.runTransaction(async (transaction) => {
      const actor = await authorize(request, (ref) => transaction.get(ref))
      adminOnly(actor)
      const snapshot = await transaction.get(db.doc(`courses/${courseId}`))
      if (!snapshot.exists) fail('not-found', 'Không tìm thấy khóa học.')
      const current = snapshot.data()
      const revision = compareRevision(current, expectedRevision) + 1
      const live = storage.publishedCourse(current)
      const archiveWhileEditing = nextStatus === 'archived' && live && current.status !== 'published'
      if (!archiveWhileEditing && !transitions[current.status]?.includes(nextStatus)) fail('failed-precondition', `Không thể chuyển khóa học từ ${current.status} sang ${nextStatus}.`)
      const status = archiveWhileEditing ? current.status : nextStatus
      let plan
      if (current.contentStorage === STORAGE) {
        if (nextStatus !== 'archived') {
          const loaded = await storage.loadAuthoring({ courseId, course: current, read: (ref) => transaction.get(ref) })
          assertReady(loaded.course, new Map(Object.entries(loaded.quizKeys)))
          await requireReviewed(transaction, courseId, loaded.course, loaded.quizKeys)
        }
        // A workflow transition is not a chapter edit. In particular, taking
        // live content offline does not require reading all chapter bodies.
        plan = { courseId, manifest: { ...storage.manifestOf(current), status, revision }, chapters: [] }
      } else {
        const loaded = await storage.loadAuthoring({ courseId, course: current, read: (ref) => transaction.get(ref) })
        const input = fullInput(courseId, loaded.course, loaded.quizKeys)
        const normalized = normalize({ ...input, publicationStatus: 'draft' })
        retainReviewPolicy(normalized.course, current)
        const keys = mergeKeys(normalized, input, loaded.course, loaded.quizKeys)
        if (nextStatus !== 'archived') {
          assertReady(normalized.course, keys)
          await requireReviewed(transaction, courseId, normalized.course, keys)
        }
        plan = storage.pack({ courseId, revision, course: { ...normalized.course, status }, quizKeys: Object.fromEntries(keys), priorCourse: current })
      }
      const next = { ...current, ...plan.manifest, ...stamp(actor) }
      if (nextStatus === 'published') {
        next.publishedSnapshot = { active: true, course: plan.manifest }
        next.firstPublishedAt = current.firstPublishedAt ?? current.publishedAt ?? FieldValue.serverTimestamp()
        next.publishedAt = FieldValue.serverTimestamp()
        next.publishedBy = actor.actorId
        delete next.archivedAt
        delete next.archivedBy
      } else if (nextStatus === 'archived') {
        // Retain the draft's state: archiving live content must never turn an
        // unapproved draft into an "archived" revision eligible for republish.
        next.publishedSnapshot = { active: false }
        next.archivedAt = FieldValue.serverTimestamp()
        next.archivedBy = actor.actorId
      } else if (nextStatus === 'approved') {
        next.approvedAt = FieldValue.serverTimestamp()
        next.approvedBy = actor.actorId
      }
      writeRevision(transaction, courseId, next, actor, plan, { transition: { from: current.status, to: status, requested: nextStatus } })
      audit(transaction, actor, courseId, archiveWhileEditing ? 'course.publication.archived' : 'course.status.changed',
        { previousStatus: current.status, status, revision })
      return { courseId, revision, status, publishedRevision: next.publishedSnapshot?.active ? next.publishedSnapshot.course.revision : null }
    })
  }

  async function readRevision(transaction, courseId, revision) {
    const snapshot = await transaction.get(revisionRef(courseId, revision))
    if (!snapshot.exists || snapshot.data().courseId !== courseId || !object(snapshot.data().course)) fail('not-found', 'Không tìm thấy phiên bản của khóa học.')
    const document = snapshot.data()
    const loaded = await storage.load({ courseId, course: document.course, read: (ref) => transaction.get(ref) })
    return { course: loaded.course, quizKeys: document.course.contentStorage === STORAGE ? loaded.quizKeys : document.quizKeys || {}, manifest: document.course }
  }

  async function restore(request) {
    assertClientProtocol(request)
    const courseId = validateId(request.data?.courseId, 'Mã khóa học')
    const sourceRevision = expected(request.data?.revision, 1)
    const expectedRevision = expected(request.data?.expectedRevision)
    return db.runTransaction(async (transaction) => {
      const actor = await authorize(request, (ref) => transaction.get(ref))
      adminOnly(actor)
      const currentSnapshot = await transaction.get(db.doc(`courses/${courseId}`))
      if (!currentSnapshot.exists) fail('not-found', 'Không tìm thấy khóa học.')
      const current = currentSnapshot.data()
      const revision = compareRevision(current, expectedRevision) + 1
      const source = await readRevision(transaction, courseId, sourceRevision)
      const input = { ...fullInput(courseId, source.course, source.quizKeys), publicationStatus: 'draft' }
      const normalized = normalize(input)
      retainReviewPolicy(normalized.course, current, source.course)
      const keys = mergeKeys(normalized, input, source.course, source.quizKeys)
      let publishedSnapshot = current.publishedSnapshot
      const additionalPlans = []
      if (!publishedSnapshot && current.status === 'published' && current.contentStorage === STORAGE) {
        publishedSnapshot = { active: true, course: storage.manifestOf(current) }
      } else if (!publishedSnapshot && current.status === 'published') {
        // Upgrade the live legacy snapshot in the SAME transaction before
        // replacing its authoring root. Never point it at mutable draft keys.
        const loadedLive = await storage.loadAuthoring({ courseId, course: current, read: (ref) => transaction.get(ref) })
        const liveInput = { ...fullInput(courseId, loadedLive.course, loadedLive.quizKeys), publicationStatus: 'draft' }
        const liveNormalized = normalize(liveInput)
        const liveKeys = mergeKeys(liveNormalized, liveInput, loadedLive.course, loadedLive.quizKeys)
        const livePlan = storage.pack({ courseId, revision: Number(current.revision) || 0,
          course: { ...liveNormalized.course, status: 'published' }, quizKeys: Object.fromEntries(liveKeys), priorCourse: current })
        additionalPlans.push(livePlan)
        publishedSnapshot = { active: true, course: livePlan.manifest }
      }
      const plan = storage.pack({ courseId, revision, course: normalized.course, quizKeys: Object.fromEntries(keys),
        priorCourse: source.manifest.contentStorage === STORAGE ? source.manifest : additionalPlans[0]?.manifest || current })
      const next = { ...plan.manifest, ...historyFields(current, actor),
        ...stamp(actor), ...(publishedSnapshot ? { publishedSnapshot } : {}) }
      writeRevision(transaction, courseId, next, actor, plan, { restoredFromRevision: sourceRevision }, additionalPlans)
      audit(transaction, actor, courseId, 'course.revision.restored', { fromRevision: sourceRevision, revision })
      return { courseId, revision, status: 'draft', restoredFromRevision: sourceRevision,
        publishedRevision: publishedSnapshot?.active ? publishedSnapshot.course.revision : null }
    })
  }

  async function readForEditor(request) {
    const courseId = validateId(request.data?.authoringCourseId, 'Mã khóa học')
    const expectedRevision = expected(request.data?.expectedRevision)
    return db.runTransaction(async (transaction) => {
      await authorize(request, (ref) => transaction.get(ref))
      const snapshot = await transaction.get(db.doc(`courses/${courseId}`))
      if (!snapshot.exists) fail('not-found', 'Không tìm thấy khóa học.')
      const root = snapshot.data()
      compareRevision(root, expectedRevision)
      const loaded = await storage.loadAuthoring({ courseId, course: root, read: (ref) => transaction.get(ref) })
      const input = fullInput(courseId, loaded.course, loaded.quizKeys)
      // Whitelist output via normalization, not root lifecycle metadata or refs.
      const normalized = normalize({ ...input, publicationStatus: 'draft' })
      const { status: _status, ...content } = normalized.course
      const keys = mergeKeys(normalized, input, loaded.course, loaded.quizKeys)
      return { course: { ...content, id: courseId, revision: root.revision || 0, publicationStatus: root.status,
        quizAnswerKeys: fullInput(courseId, {}, Object.fromEntries(keys)).quizAnswerKeys,
        ...(root.contentStorage ? { contentStorage: root.contentStorage } : {}),
        publishedRevision: root.publishedSnapshot?.active ? root.publishedSnapshot.course.revision : root.status === 'published' ? root.revision || 0 : null } }
    })
  }

  async function diff(request) {
    const courseId = validateId(request.data?.courseId, 'Mã khóa học')
    const fromRevision = expected(request.data?.fromRevision, 1)
    const toRevision = expected(request.data?.toRevision, 1)
    if (fromRevision === toRevision) fail('invalid-argument', 'Cần chọn hai phiên bản khác nhau để so sánh.')
    return db.runTransaction(async (transaction) => {
      await authorize(request, (ref) => transaction.get(ref))
      const [from, to] = await Promise.all([readRevision(transaction, courseId, fromRevision), readRevision(transaction, courseId, toRevision)])
      // Normalization strips legacy inline answers as well as storage metadata.
      const left = normalize({ ...fullInput(courseId, from.course, from.quizKeys), publicationStatus: 'draft' }).course
      const right = normalize({ ...fullInput(courseId, to.course, to.quizKeys), publicationStatus: 'draft' }).course
      return { courseId, fromRevision, toRevision, ...buildDiff({ ...left, status: from.course.status }, { ...right, status: to.course.status }) }
    })
  }

  return { save, transition, restore, readForEditor, diff, assertClientProtocol }
}

module.exports = { createAcademyAuthoringHandlers }
