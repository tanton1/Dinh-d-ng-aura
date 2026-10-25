'use strict'

const { createAcademyCourseStorage } = require('../academy-course-storage')
const { createAcademyAuthoringHandlers } = require('../academy-authoring')
const { academyAuthoringValidation } = require('./academy-template-fixture')
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }
const copy = (value) => {
  if (value == null || typeof value !== 'object' || typeof value.toMillis === 'function') return value
  return Array.isArray(value) ? value.map(copy) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))
}

function academyAuthoringFixture(options = {}) {
  const store = new Map([['users/admin', { role: 'admin' }], ['users/editor', { role: 'editor' }]])
  const reads = []
  let sequence = 0
  let retryMutation = null
  const ref = (path, collection = false) => ({ path, id: path.split('/').at(-1), isCollection: collection,
    collection: (name) => ref(`${path}/${name}`, true), doc: (id = `auto-${++sequence}`) => ref(`${path}/${id}`),
    get: () => { throw new Error('Authoring must use transaction reads') },
  })
  const snapshot = (reference) => {
    if (reference.isCollection) return { docs: [...store.keys()].filter((path) => path.startsWith(`${reference.path}/`)
      && path.split('/').length === reference.path.split('/').length + 1).map((path) => ({ ...snapshot(ref(path)), ref: ref(path) })) }
    const data = copy(store.get(reference.path))
    return { id: reference.id, exists: data !== undefined, data: () => copy(data) }
  }
  const db = { doc: ref, collection: (path) => ref(path, true), runTransaction: async (run) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const writes = []
      const readSnapshots = []
      const trace = []
      reads.push(trace)
      const result = await run({ get: async (reference) => {
        if (writes.length) throw new Error('Read after transaction write')
        trace.push(reference.path)
        const snap = snapshot(reference)
        readSnapshots.push([reference, JSON.stringify(reference.isCollection ? snap.docs.map((item) => item.data()) : snap.data())])
        return snap
      }, create: (reference, data) => writes.push({ reference, data: copy(data), create: true }),
      set: (reference, data, options) => writes.push({ reference, data: copy(data), merge: options?.merge }) })
      if (retryMutation) { const mutate = retryMutation; retryMutation = null; mutate() }
      if (readSnapshots.some(([reference, original]) => {
        const snap = snapshot(reference)
        return JSON.stringify(reference.isCollection ? snap.docs.map((item) => item.data()) : snap.data()) !== original
      })) continue
      const created = new Set()
      for (const write of writes) if (write.create) {
        if (store.has(write.reference.path) || created.has(write.reference.path)) throw new HttpsError('already-exists', 'Immutable collision')
        created.add(write.reference.path)
      }
      for (const write of writes) store.set(write.reference.path, write.merge ? { ...store.get(write.reference.path), ...write.data } : write.data)
      return result
    }
    throw new HttpsError('aborted', 'Retries exhausted')
  } }
  const validation = academyAuthoringValidation(HttpsError)
  const storage = createAcademyCourseStorage({ db, HttpsError })
  const authorize = async (request, read) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in')
    const snap = await read(db.doc(`users/${request.auth.uid}`))
    if (!snap.exists || snap.data().disabled || !['admin', 'super_admin', 'editor'].includes(snap.data().role)
        || snap.data().role !== request.auth.token.role) throw new HttpsError('permission-denied', 'No staff access')
    return { actorId: request.auth.uid, role: snap.data().role }
  }
  const handlers = createAcademyAuthoringHandlers({ db, HttpsError, FieldValue: { serverTimestamp: () => 'server-time' }, storage, authorize,
    validateId: validation.courseId, normalize: validation.normalizeCourseDraftInput, assertSaveStatus: validation.assertCourseContentSaveStatus,
    assertReady: validation.assertCourseReadyToPublish, buildQuizContentHash: validation.buildQuizContentHash, buildDiff: validation.buildCourseRevisionDiff,
    validateScientificReview: options.validateScientificReview })
  const input = { id: 'course', title: 'Khóa học kiểm thử', slug: 'khoa-hoc-kiem-thu', category: 'Dinh dưỡng', level: 'Nền tảng', coach: 'Aura',
    duration: 'Tự học', description: 'Mô tả đầy đủ', outcomes: ['Hiểu'], requirements: ['Đọc'], publicationStatus: 'draft',
    settings: { accessTier: 'free', visibility: 'members', completionPercent: 80, certificateEnabled: false, dripSchedule: 'none' },
    modules: [1, 2].map((n) => ({ id: `module-${n}`, title: `Chương ${n}`, order: n, lessons: [
      { id: `reading-${n}`, title: 'Học', type: 'Bài đọc', duration: '5 phút', summary: `Nội dung ${n}` },
      { id: `practice-${n}`, title: 'Thực hành', type: 'Bài đọc', duration: '5 phút', summary: 'Tình huống thực hành' },
      { id: `quiz-${n}`, title: 'Kiểm tra', type: 'Quiz', duration: '5 phút', completionPolicy: { mode: 'quiz-pass' },
        quiz: { id: `quiz-${n}`, passPercent: 80, questionOrder: 'sequential', questions: [
          { id: `q-${n}`, question: 'Lựa chọn nào?', options: ['Đúng', 'Sai'], correctIndex: 0, mustPass: true },
        ] } },
    ] })) }
  const request = (data, role = 'admin') => ({ auth: { uid: role, token: { role } }, data })
  const readEditor = async (revision) => (await handlers.readForEditor(request({ authoringCourseId: 'course', expectedRevision: revision }))).course
  const chapterCount = () => [...store.keys()].filter((path) => path.includes('/academyChapterVersions/')).length
  return { store, reads, db, storage, handlers, input, request, readEditor, chapterCount, validation, HttpsError, authorize,
    retryOnce: (mutate) => { retryMutation = mutate } }
}

module.exports = { academyAuthoringFixture }
