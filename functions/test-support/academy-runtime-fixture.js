'use strict'

const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const { createHash } = require('node:crypto')
const { createAcademyCourseStorage } = require('../academy-course-storage')
const source = readFileSync(require.resolve('../index'), 'utf8')
const handler = (name) => {
  const start = source.indexOf(`exports.${name} =`)
  return source.slice(start, source.indexOf('\n})', start) + 3)
}
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }

function academyRuntimeHandlers({ db, FieldValue, Filter, storage, HttpsError: ErrorType = HttpsError, requireCaller = (request) => request.auth.uid }) {
  const context = { exports: {}, onCall: (_config, callback) => callback, academyLearnerRuntime: {}, requireCaller,
    requireDocumentId: (value) => { if (typeof value !== 'string' || !value.length || value.includes('/')) throw new ErrorType('invalid-argument', 'Invalid ID'); return value },
    HttpsError: ErrorType, createHash, quizAnswerLimit: 100, quizMaxAttemptLimit: 20,
    academyCourseStorage: createAcademyCourseStorage({ db, HttpsError: ErrorType }),
    academyStaffRoles: new Set(['editor', 'admin', 'super_admin']), callerTokenRole: (request) => request.auth?.token?.role,
    db, Filter, FieldValue, storage, mediaUrlTtlMs: 300000, isPlainObject: (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value)),
    ...require('../academy-practice'), ...require('../academy-submissions'),
  }
  const trusted = source.slice(source.indexOf('function hasTrustedRole('), source.indexOf('function boundedPushString('))
  const helpers = source.slice(source.indexOf('function hasCourseEntitlement('), source.indexOf('function requireCourseMediaPath('))
  const projection = source.slice(source.indexOf('function academyModulesForLearner('), source.indexOf('/** Returns catalog metadata'))
  const staffAccess = source.slice(source.indexOf('async function requireTrustedAcademyStaffContext('), source.indexOf('const academyDraftAdoption ='))
  const mediaHelpers = source.slice(source.indexOf('function requireCourseMediaPath('), source.indexOf('function academyModulesForLearner('))
  const workoutHelpers = source.slice(source.indexOf('function findProgramSession('), source.indexOf('function normalizePtWorkoutLog('))
  runInNewContext([trusted, staffAccess, helpers, mediaHelpers, workoutHelpers, projection,
    ...['gradeCourseQuiz', 'listAcademyCourses', 'enrollInCourse', 'completeCourseLesson', 'getCourseMediaUrl', 'getCourseWorkoutSession', 'saveCourseWorkoutLog'].map(handler)].join('\n'), context)
  return context
}

/** Executes production access, quiz and projection code, not a permissive access stub. */
function academyRuntimeFixture(revealMode = 'after-submit', options = {}) {
  const store = new Map()
  const transactionReads = []
  let ids = 0
  let retryMutation = null
  const field = (value, path) => path.split('.').reduce((item, key) => item?.[key], value)
  const Filter = { where: (path, op, value) => { if (op !== '==') throw new Error('Unsupported query'); return (data) => field(data, path) === value },
    or: (...filters) => (data) => filters.some((filter) => filter(data)) }
  const reference = (path) => ({ path, id: path.split('/').at(-1),
    collection: (name) => reference(`${path}/${name}`), doc: (id = `auto-${++ids}`) => reference(`${path}/${id}`),
    get: () => { throw new Error(`Unexpected non-transactional read: ${path}`) },
    where: (...args) => ({ path, query: true, matches: args.length === 1 ? args[0] : Filter.where(...args) }),
  })
  const quiz = { id: 'quiz', passPercent: 80, questionOrder: 'sequential', publicSettings: { questionsPerAttempt: 2, maxAttempts: 2, revealMode },
    questions: [{ id: 'q1', question: 'Safety', options: ['Right', 'Wrong'], mustPass: true, explanation: 'Private feedback', remediationCardIds: ['card1'] },
      { id: 'q2', question: 'Core', options: ['Right', 'Wrong'], explanation: 'Another explanation' }] }
  const key = { answers: { q1: 0, q2: 0 } }
  const course = { schemaVersion: 2, revision: 1, status: 'published', title: 'Course',
    settings: { accessTier: 'free', visibility: 'members', dripSchedule: 'none', completionPercent: 80 },
    modules: [{ id: 'module', title: 'Module', order: 1, lessons: [
      { id: 'reading', title: 'Reading', type: 'Bài đọc', duration: '5 phút', preview: true, summary: 'Public chapter', coachNotes: 'Private notes' },
      { id: 'lesson', title: 'Quiz', type: 'Quiz', duration: '5 phút', quiz, provenance: { source: 'Private provenance' } },
    ] }] }
  store.set('courses/course', course)
  store.set('courses/course/quizKeys/lesson', key)
  store.set('users/student', { role: 'student', membership: 'free', disabled: false })
  store.set('enrollments/student_course', { courseId: 'course', userId: 'student', status: 'active' })
  const db = { doc: reference, collection: reference,
    runTransaction: async (run) => {
      const attempt = async () => {
        const reads = []
        transactionReads.push(reads)
        const writes = []
        const result = await run({ get: async (ref) => {
          if (writes.length) throw new Error('Transaction read after write')
          reads.push(ref.path)
          if (ref.query) return { docs: [...store.entries()].filter(([path, value]) => path.startsWith(`${ref.path}/`)
            && path.split('/').length === ref.path.split('/').length + 1 && ref.matches(value))
            .map(([path, value]) => ({ id: path.split('/').at(-1), exists: true, data: () => value })) }
          const exists = store.has(ref.path)
          const value = store.get(ref.path)
          return { exists, data: () => value }
        }, set: (ref, data, options) => writes.push([ref.path, options?.merge ? { ...store.get(ref.path), ...data } : data]),
        create: (ref, data) => { if (store.has(ref.path)) throw new Error('Immutable create collision'); writes.push([ref.path, data]) },
        update: (ref, data) => writes.push([ref.path, { ...store.get(ref.path), ...data }]) })
        return { result, writes }
      }
      let completed = await attempt()
      if (retryMutation) {
        const mutate = retryMutation
        retryMutation = null
        mutate()
        completed = await attempt()
      }
      completed.writes.forEach(([path, data]) => store.set(path, data))
      return completed.result
    },
  }
  const context = academyRuntimeHandlers({ db, Filter, storage: options.storage, FieldValue: { serverTimestamp: () => 'server-time' }, requireCaller: () => 'student' })
  const storage = context.academyCourseStorage
  const versioned = () => {
    const plan = storage.pack({ courseId: 'course', revision: course.revision, course, quizKeys: { lesson: key } })
    for (const chapter of plan.chapters) store.set(chapter.path, chapter.document)
    store.set('courses/course', { ...plan.manifest, publishedSnapshot: { active: true, course: plan.manifest } })
    return plan
  }
  return { grade: context.exports.gradeCourseQuiz, list: context.exports.listAcademyCourses,
    enroll: context.exports.enrollInCourse, complete: context.exports.completeCourseLesson, store, quiz, key, course, storage, versioned,
    transactionReads, retryOnce: (mutate) => { retryMutation = mutate }, context }
}

module.exports = { academyRuntimeFixture, academyRuntimeHandlers }
