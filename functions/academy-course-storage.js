'use strict'

const { createHash } = require('node:crypto')

const STORAGE = 'chapters-v1'
const COLLECTION = 'academyChapterVersions'
// Leave headroom below Firestore's 1 MiB document and 10 MiB request limits.
// These are conservative application limits, not a Firestore size calculator.
const LIMITS = Object.freeze({ chapterBytes: 750 * 1024, manifestBytes: 192 * 1024, planBytes: 4 * 1024 * 1024, modules: 40, lessons: 200 })
const courseFields = ['schemaVersion', 'title', 'coverUrl', 'slug', 'description', 'category', 'level', 'duration', 'coach', 'outcomes', 'requirements', 'settings', 'lessons', 'accent', 'icon', 'status', 'academyReviewRequiredModuleIds']
const lessonFields = ['id', 'title', 'type', 'duration', 'preview', 'completionPolicy']
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const pick = (value, fields) => Object.fromEntries(fields.filter((key) => own(value, key)).map((key) => [key, value[key]]))
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')
const digest = (value) => createHash('sha256').update(value).digest('hex')

/**
 * Server-only immutable chapter storage. It deliberately has no authorization
 * bypass or global cache. A caller must authorize against the CURRENT course,
 * profile and enrollment before loading any chapter. Pass transaction.get as
 * read when the result participates in a grade, completion or publication.
 */
function createAcademyCourseStorage({ db, HttpsError }) {
  const fail = (message, code = 'failed-precondition') => { throw new HttpsError(code, message) }
  const id = (value) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
      fail('Mã nội dung khóa học không hợp lệ.')
    }
    return value
  }

  function canonical(value, depth = 0, seen = new Set()) {
    // The document adds two enclosing maps. Arrays also count toward depth.
    if (depth > 17) fail('Nội dung chương có cấu trúc lồng quá sâu.')
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
    if (typeof value !== 'object' || value === null || seen.has(value)
        || (!Array.isArray(value) && Object.prototype.toString.call(value) !== '[object Object]')) {
      fail('Nội dung chương phải là dữ liệu JSON hữu hạn, không có trường chưa xác định.')
    }
    seen.add(value)
    const result = Array.isArray(value)
      ? `[${Array.from(value, (item) => canonical(item, depth + 1, seen)).join(',')}]`
      : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1, seen)}`).join(',')}}`
    seen.delete(value)
    return result
  }

  const contentHash = (module, quizKeys) => digest(canonical({ module, quizKeys }))
  const versionFor = (revision, moduleId) => `r${revision}_${digest(moduleId).slice(0, 32)}`
  const versionValid = (version, moduleId) => typeof version === 'string'
    && /^r(?:0|[1-9]\d{0,15})_[a-f0-9]{32}$/.test(version)
    && Number.isSafeInteger(Number(version.split('_')[0].slice(1)))
    && version.endsWith(`_${digest(moduleId).slice(0, 32)}`)

  function moduleMetadata(module, versionId) {
    return {
      ...pick(module, ['id', 'title', 'order', 'description', 'academyAdoption']),
      contentVersion: versionId,
      lessons: module.lessons.map((lesson) => pick(lesson, lessonFields)),
    }
  }

  function validateModules(modules) {
    if (!Array.isArray(modules) || modules.length > LIMITS.modules) fail('Danh mục chương không hợp lệ.')
    const moduleIds = new Set()
    const lessonIds = new Set()
    for (const module of modules) {
      if (!object(module) || moduleIds.has(id(module.id)) || !Array.isArray(module.lessons) || module.lessons.length > 50) {
        fail('Mã chương bị trùng hoặc danh sách bài học không hợp lệ.')
      }
      moduleIds.add(module.id)
      if (module.academyAdoption !== undefined && (!object(module.academyAdoption)
          || Object.keys(module.academyAdoption).length !== 1
          || !/^[a-f0-9]{64}$/.test(module.academyAdoption.candidateId || ''))) fail('Dấu duyệt chương không hợp lệ.')
      for (const lesson of module.lessons) {
        if (!object(lesson) || lessonIds.has(id(lesson.id))) fail('Mã bài học bị trùng hoặc không hợp lệ.')
        lessonIds.add(lesson.id)
      }
    }
    if (lessonIds.size > LIMITS.lessons) fail('Khóa học vượt giới hạn số bài học.')
  }

  function normalizedKeys(module, source) {
    return Object.fromEntries(module.lessons.flatMap((lesson) => {
      if (!own(source, lesson.id)) return []
      const key = source[lesson.id]
      if (lesson.type !== 'Quiz' || !object(lesson.quiz) || !Array.isArray(lesson.quiz.questions) || !object(key) || !object(key.answers)) {
        fail('Đáp án không gắn với một quiz hợp lệ trong chương.')
      }
      const questions = new Map(lesson.quiz.questions.map((question) => [question.id, question]))
      for (const [questionId, answer] of Object.entries(key.answers)) {
        const question = questions.get(questionId)
        if (!question || !Number.isInteger(answer) || answer < 0 || answer >= question.options?.length) {
          fail('Đáp án chứa câu hỏi hoặc lựa chọn không thuộc phiên bản quiz.')
        }
      }
      // Lifecycle timestamps are not part of the immutable answer definition.
      return [[lesson.id, pick(key, ['quizId', 'passPercent', 'answers', 'questionCount', 'contentHash'])]]
    }))
  }

  function validateManifest(course) {
    if (!object(course) || course.contentStorage !== STORAGE || !object(course.chapterRefs)
        || course.schemaVersion !== 2 || !Number.isSafeInteger(course.revision) || course.revision < 0) fail('Danh mục phiên bản chương không hợp lệ.')
    id(course.courseId)
    if (course.academyReviewRequiredModuleIds !== undefined && (!Array.isArray(course.academyReviewRequiredModuleIds)
        || course.academyReviewRequiredModuleIds.length > LIMITS.modules
        || new Set(course.academyReviewRequiredModuleIds.map(id)).size !== course.academyReviewRequiredModuleIds.length)) fail('Chính sách duyệt chương không hợp lệ.')
    validateModules(course.modules)
    if (Object.keys(course.chapterRefs).length !== course.modules.length) fail('Danh mục và tham chiếu chương không khớp.')
    for (const module of course.modules) {
      const ref = course.chapterRefs[module.id]
      if (!object(ref) || !versionValid(ref.versionId, module.id) || module.contentVersion !== ref.versionId
          || Number(ref.versionId.split('_')[0].slice(1)) > course.revision
          || typeof ref.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(ref.contentHash)) {
        fail('Tham chiếu phiên bản chương không hợp lệ.')
      }
      if (canonical(module) !== canonical(moduleMetadata(module, ref.versionId))) fail('Danh mục chương không được chứa nội dung hoặc đáp án.')
    }
    assertManifestBudget(course)
  }

  function assertManifestBudget(course) {
    // The authoring root may also have lifecycle timestamps and a separate
    // live manifest. Bound each manifest, not those two manifests together.
    const manifest = pick(course, [...courseFields, 'courseId', 'revision', 'contentStorage', 'modules', 'chapterRefs'])
    if (bytes(manifest) > LIMITS.manifestBytes) fail('Danh mục khóa học vượt giới hạn an toàn. Hãy rút gọn phần mô tả danh mục.', 'resource-exhausted')
  }

  /** Pure plan: no reads/writes. Use only normalized full authoring input. */
  function pack({ courseId, revision, course, quizKeys = {}, priorCourse = null }) {
    id(courseId)
    if (!Number.isSafeInteger(revision) || revision < 0 || !object(course) || course.schemaVersion !== 2) fail('Phiên bản khóa học không hợp lệ.')
    if (course.contentStorage !== undefined) fail('Cần tải đầy đủ nội dung trước khi lưu; không thể lưu danh mục thay cho chương.')
    validateModules(course.modules)
    if (!object(quizKeys)) fail('Bộ đáp án của khóa học không hợp lệ.')
    if (priorCourse?.contentStorage === STORAGE) {
      validateManifest(priorCourse)
      if (priorCourse.courseId !== courseId) fail('Không thể tái sử dụng tham chiếu của một khóa học khác.')
    }
    const consumedKeyIds = new Set()
    const chapters = []
    const refs = []
    const modules = course.modules.map((module) => {
      // Never accept inline checkpoint answers; the writer must split these.
      if (module.lessons.some((lesson) => lesson.quiz?.questions?.some((question) => own(question, 'correctIndex')))) {
        fail('Đáp án quiz phải được tách riêng trước khi lưu chương.')
      }
      const keys = normalizedKeys(module, quizKeys)
      Object.keys(keys).forEach((key) => consumedKeyIds.add(key))
      const hash = contentHash(module, keys)
      const previous = priorCourse?.contentStorage === STORAGE ? priorCourse.chapterRefs[module.id] : null
      const reuse = previous?.contentHash === hash
      const versionId = reuse ? previous.versionId : versionFor(revision, module.id)
      if (!reuse && previous?.versionId === versionId) fail('Một phiên bản chương bất biến không thể bị ghi đè.')
      const document = { storageVersion: 1, courseId, moduleId: module.id, versionId, contentHash: hash, module, quizKeys: keys }
      if (bytes(document) > LIMITS.chapterBytes) fail(`Chương “${module.title || module.id}” vượt giới hạn an toàn; hãy chia nhỏ học liệu.`, 'resource-exhausted')
      if (!reuse) chapters.push({ path: `courses/${courseId}/${COLLECTION}/${versionId}`, document })
      refs.push([module.id, { versionId, contentHash: hash }])
      return moduleMetadata(module, versionId)
    })
    if (Object.keys(quizKeys).some((lessonId) => !consumedKeyIds.has(lessonId))) fail('Bộ đáp án chứa bài không thuộc khóa học.')
    const manifest = { ...pick(course, courseFields), courseId, revision, contentStorage: STORAGE, modules, chapterRefs: Object.fromEntries(refs) }
    validateManifest(manifest)
    // Account for an authoring root, live snapshot and immutable revision;
    // unused chapter indexes must be exempted in firestore.indexes.json.
    const planBytes = chapters.reduce((sum, item) => sum + bytes(item.document), 0) + 3 * bytes(manifest)
    if (planBytes > LIMITS.planBytes) fail('Đợt lưu vượt giới hạn dữ liệu an toàn. Hãy tách đợt nhập nội dung.', 'resource-exhausted')
    // Detach from mutable editor objects so later mutations cannot alter a plan.
    return JSON.parse(JSON.stringify({ courseId, manifest, chapters, planBytes }))
  }

  /** Validate every selected document before returning any content. */
  async function load({ courseId, course, moduleIds, read = (reference) => reference.get() }) {
    id(courseId)
    if (!object(course)) fail('Dữ liệu khóa học không hợp lệ.')
    if (course.contentStorage === undefined) return { course, quizKeys: {}, chapterReads: 0 }
    if (course.contentStorage !== STORAGE) fail('Định dạng nội dung khóa học chưa được hỗ trợ.')
    validateManifest(course)
    if (course.courseId !== courseId) fail('Danh mục không thuộc khóa học được yêu cầu.')
    const selectedIds = moduleIds === undefined ? course.modules.map((module) => module.id) : moduleIds
    if (!Array.isArray(selectedIds) || new Set(selectedIds).size !== selectedIds.length
        || selectedIds.some((moduleId) => !own(course.chapterRefs, moduleId))) fail('Chương được chọn không thuộc khóa học.')
    const loaded = await Promise.all(selectedIds.map(async (moduleId) => {
      const ref = course.chapterRefs[moduleId]
      const snapshot = await read(db.doc(`courses/${courseId}/${COLLECTION}/${ref.versionId}`))
      if (!snapshot.exists) fail('Nội dung chương chưa đầy đủ. Hãy tải lại hoặc liên hệ quản trị viên.')
      const document = snapshot.data()
      validateModules([document?.module])
      const stub = course.modules.find((module) => module.id === moduleId)
      if (document?.storageVersion !== 1 || document.courseId !== courseId || document.moduleId !== moduleId
          || document.versionId !== ref.versionId || document.module?.id !== moduleId || !object(document.quizKeys)
          || document.contentHash !== ref.contentHash || contentHash(document.module, document.quizKeys) !== ref.contentHash
          || canonical(moduleMetadata(document.module, ref.versionId)) !== canonical(stub)) {
        fail('Nội dung chương không khớp phiên bản đã chọn; chưa thể tiếp tục học hoặc chấm bài.')
      }
      return document
    }))
    const byId = new Map(loaded.map((document) => [document.moduleId, document]))
    return {
      course: { ...course, modules: course.modules.map((stub) => byId.has(stub.id) ? byId.get(stub.id).module : stub) },
      quizKeys: Object.fromEntries(loaded.flatMap((document) => Object.entries(document.quizKeys))),
      chapterReads: loaded.length,
    }
  }

  /** Server-only authoring operation. Must be called after staff authorization. */
  async function loadAuthoring({ courseId, course, read = (reference) => reference.get() }) {
    if (course.contentStorage === STORAGE) return load({ courseId, course, read })
    if (course.contentStorage !== undefined) fail('Định dạng nội dung khóa học chưa được hỗ trợ.')
    id(courseId)
    const keys = await read(db.doc(`courses/${courseId}`).collection('quizKeys'))
    return { course, quizKeys: Object.fromEntries(keys.docs.map((snapshot) => [snapshot.id, snapshot.data()])), chapterReads: 0 }
  }

  function writeChapters(transaction, plan) {
    // create, never set/update: a retried transaction either commits its entire
    // revision or fails; no existing chapter or review is overwritten.
    for (const chapter of plan.chapters) transaction.create(db.doc(chapter.path), chapter.document)
  }

  function publishedCourse(root) {
    if (!root) return null
    if (own(root, 'publishedSnapshot')) {
      if (root.publishedSnapshot?.active !== true) return null
      const published = root.publishedSnapshot.course
      if (published?.status !== 'published' || published?.contentStorage !== STORAGE) fail('Bản khóa học đang xuất bản không hợp lệ.')
      validateManifest(published)
      return published
    }
    return root.status === 'published' ? root : null
  }

  function requireVersion(course, moduleId, expectedVersion) {
    if (course.contentStorage !== STORAGE) return
    validateManifest(course)
    if (typeof expectedVersion !== 'string' || course.chapterRefs[moduleId]?.versionId !== expectedVersion) {
      fail('Chương đã có phiên bản khác. Hãy tải lại chương trước khi tiếp tục.', 'aborted')
    }
  }

  function manifestOf(course) {
    validateManifest(course)
    return JSON.parse(JSON.stringify(pick(course, [...courseFields, 'courseId', 'revision', 'contentStorage', 'modules', 'chapterRefs'])))
  }

  return { pack, load, loadAuthoring, writeChapters, publishedCourse, requireVersion, validateManifest, manifestOf, canonical }
}

module.exports = { createAcademyCourseStorage, STORAGE, COLLECTION, LIMITS }
