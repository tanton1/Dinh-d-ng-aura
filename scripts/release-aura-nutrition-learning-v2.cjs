'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
  courseId: 'course-c6c22b80-5b94-4628-935f-05fee4e22eaa',
})
const ACTOR = 'migration:aura-nutrition-learning-v2'
const CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/courses/${TARGET.courseId}:release-learning-v2`
const REPORT_PATH = path.resolve('.migration-private', 'academy-learning-v2-release.json')
const EXPECTED_QUESTIONS_PER_CHECKPOINT = 16
const EXPECTED_TOTAL_QUESTIONS = 320

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = canonical(value[key])
    return result
  }, {})
  return value
}
function parseArguments(argv) {
  const result = { mode: 'dry-run', digest: '', confirmation: '' }
  for (const argument of argv) {
    if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirmation = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  return result
}
async function accessToken() {
  if (!process.env.APPDATA) throw new Error('APPDATA is unavailable.')
  const auth = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain a Firebase access token.')
  return result.access_token
}
function resourceBase() { return `projects/${TARGET.projectId}/databases/${TARGET.databaseId}` }
function firestoreBase() { return `https://firestore.googleapis.com/v1/${resourceBase()}` }
function documentName(collection, id) { return `${resourceBase()}/documents/${collection}/${id}` }
async function requestJson(token, url, options = {}, allowedStatuses = []) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const raw = await response.text()
  if (!response.ok && !allowedStatuses.includes(response.status)) {
    throw new Error(`Request failed (${response.status}) at ${url.split('?')[0]}: ${raw.slice(0, 500)}`)
  }
  return { status: response.status, data: raw ? JSON.parse(raw) : null }
}
async function readDocument(token, collection, id) {
  return (await requestJson(token, `${firestoreBase()}/documents/${collection}/${encodeURIComponent(id)}`)).data
}
async function readQuizKeyDocuments(token) {
  return (await requestJson(
    token,
    `${firestoreBase()}/documents/courses/${TARGET.courseId}/quizKeys?pageSize=100`,
  )).data?.documents || []
}
function decodeValue(value = {}) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeValue)
  if ('mapValue' in value) return decodeFields(value.mapValue?.fields || {})
  return undefined
}
function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]))
}
function encodeValue(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  if (value && typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value)
          .filter(([, child]) => child !== undefined)
          .map(([key, child]) => [key, encodeValue(child)])),
      },
    }
  }
  throw new Error(`Unsupported Firestore value: ${typeof value}`)
}
function encodeFields(value) {
  return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .map(([key, child]) => [key, encodeValue(child)]))
}
function loadLocalCourse() {
  const built = esbuild.buildSync({
    entryPoints: [path.resolve('src', 'course-template.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    write: false,
  })
  const fileName = path.resolve('.migration-private', 'compiled-aura-learning-v2.cjs')
  const compiled = new Module(fileName, module)
  compiled.filename = fileName
  compiled.paths = Module._nodeModulePaths(process.cwd())
  compiled._compile(built.outputFiles[0].text, fileName)
  return compiled.exports.auraFoundationCourse
}
function buildQuizContentHash(quiz, answers) {
  return sha256(JSON.stringify({
    quizId: quiz.id,
    passPercent: quiz.passPercent,
    questions: quiz.questions.map((question) => ({
      id: question.id,
      question: question.question,
      options: question.options,
      correctIndex: answers[question.id],
    })),
  }))
}
function publicQuestion(question) {
  const { correctIndex: _correctIndex, ...safe } = question
  return safe
}
function mergeLearningV2(currentModules, localModules) {
  const localLessons = new Map(localModules.flatMap((module) => module.lessons).map((lesson) => [lesson.id, lesson]))
  const quizKeys = {}
  const modules = currentModules.map((module) => ({
    ...module,
    lessons: module.lessons.map((lesson) => {
      const local = localLessons.get(lesson.id)
      if (!local?.quiz) return lesson
      const questions = local.quiz.questions.map(publicQuestion)
      const answers = Object.fromEntries(local.quiz.questions.map((question) => [question.id, question.correctIndex]))
      const quiz = { ...local.quiz, questions }
      quizKeys[lesson.id] = {
        quizId: quiz.id,
        passPercent: quiz.passPercent,
        answers,
        questionCount: questions.length,
        contentHash: buildQuizContentHash(quiz, answers),
      }
      return {
        ...lesson,
        title: local.title,
        duration: local.duration,
        summary: local.summary,
        tags: local.tags,
        quiz,
        completionPolicy: local.completionPolicy,
      }
    }),
  }))
  return { modules, quizKeys }
}
function validateLearningV2(modules, quizKeys) {
  const lessons = modules.flatMap((module) => module.lessons || [])
  const checkpoints = lessons.filter((lesson) => lesson.type === 'Quiz')
  if (modules.length !== 20 || lessons.length !== 60 || checkpoints.length !== 20) {
    throw new Error('Safety stop: production must remain 20 chapters, 60 lessons and 20 checkpoints.')
  }
  for (const lesson of checkpoints) {
    const questions = lesson.quiz?.questions || []
    const key = quizKeys[lesson.id]
    if (questions.length !== EXPECTED_QUESTIONS_PER_CHECKPOINT || lesson.quiz.passPercent !== 80
        || lesson.quiz.publicSettings?.questionsPerAttempt !== 8
        || lesson.quiz.publicSettings?.revealMode !== 'after-submit'
        || questions.filter((question) => question.mustPass === true).length !== 1
        || questions.some((question) => Number.isInteger(question.correctIndex))) {
      throw new Error(`Safety stop: ${lesson.id} does not match the V2 public quiz contract.`)
    }
    if (!key || key.questionCount !== EXPECTED_QUESTIONS_PER_CHECKPOINT || Object.keys(key.answers).length !== EXPECTED_QUESTIONS_PER_CHECKPOINT
        || Object.values(key.answers).some((answer) => !Number.isInteger(answer))) {
      throw new Error(`Safety stop: ${lesson.id} does not have ${EXPECTED_QUESTIONS_PER_CHECKPOINT} private answer keys.`)
    }
    if (buildQuizContentHash(lesson.quiz, key.answers) !== key.contentHash) {
      throw new Error(`Safety stop: ${lesson.id} content hash does not match its private key.`)
    }
  }
  return checkpoints
}
async function ensureMissing(token, collection, id) {
  const result = await requestJson(
    token,
    `${firestoreBase()}/documents/${collection}/${encodeURIComponent(id)}`,
    {},
    [404],
  )
  if (result.status !== 404) throw new Error(`Safety stop: ${collection}/${id} already exists.`)
}
async function buildPlan(token) {
  const [courseDocument, currentQuizDocuments] = await Promise.all([
    readDocument(token, 'courses', TARGET.courseId),
    readQuizKeyDocuments(token),
  ])
  const course = decodeFields(courseDocument.fields || {})
  if (course.title !== 'Làm chủ dinh dưỡng cùng AURA' || course.status !== 'published') {
    throw new Error('Safety stop: target course is not the expected published Aura nutrition course.')
  }
  if (!Array.isArray(course.modules) || course.modules.length !== 20 || Number(course.lessons) !== 60) {
    throw new Error('Safety stop: production curriculum is not the expected 20 chapters / 60 lessons.')
  }
  const currentRevision = Number(course.revision)
  if (!Number.isInteger(currentRevision) || currentRevision < 1) throw new Error('Safety stop: production revision is invalid.')

  const localCourse = loadLocalCourse()
  const { modules, quizKeys } = mergeLearningV2(course.modules, localCourse.modules)
  const checkpoints = validateLearningV2(modules, quizKeys)
  const nextRevision = currentRevision + 1
  const nextCourse = {
    ...course,
    modules,
    revision: nextRevision,
    status: 'published',
  }
  const revisionPayloadBytes = Buffer.byteLength(JSON.stringify({ course: nextCourse, quizKeys }), 'utf8')
  if (revisionPayloadBytes > 750 * 1024) {
    const coursePayloadBytes = Buffer.byteLength(JSON.stringify(nextCourse), 'utf8')
    const quizKeyPayloadBytes = Buffer.byteLength(JSON.stringify(quizKeys), 'utf8')
    throw new Error(`Safety stop: immutable revision payload is ${revisionPayloadBytes} bytes (course ${coursePayloadBytes}, quiz keys ${quizKeyPayloadBytes}).`)
  }
  const revisionId = `${TARGET.courseId}_${String(nextRevision).padStart(6, '0')}`
  const auditId = `academy-learning-v2_${revisionId}`
  const core = {
    projectId: TARGET.projectId,
    databaseId: TARGET.databaseId,
    courseId: TARGET.courseId,
    title: course.title,
    currentRevision,
    nextRevision,
    courseUpdateTime: courseDocument.updateTime,
    revisionId,
    auditId,
    moduleCount: modules.length,
    lessonCount: modules.flatMap((module) => module.lessons).length,
    checkpointCount: checkpoints.length,
    questionCount: checkpoints.reduce((sum, lesson) => sum + lesson.quiz.questions.length, 0),
    questionsPerAttempt: 8,
    mustPassCount: checkpoints.reduce((sum, lesson) => sum + lesson.quiz.questions.filter((question) => question.mustPass).length, 0),
    currentQuizKeyCount: currentQuizDocuments.length,
    revisionPayloadBytes,
    contentHash: sha256(JSON.stringify(canonical({ course: nextCourse, quizKeys }))),
  }
  return {
    ...core,
    planDigest: sha256(JSON.stringify(canonical(core))),
    courseDocument,
    nextCourse,
    modules,
    quizKeys,
  }
}
function publicPlan(plan, mode, writesPerformed) {
  const { courseDocument: _courseDocument, nextCourse: _nextCourse, modules: _modules, quizKeys: _quizKeys, ...safe } = plan
  return { generatedAt: new Date().toISOString(), mode, target: TARGET, ...safe, writesPerformed }
}
async function applyPlan(token, plan) {
  await ensureMissing(token, 'courseRevisions', plan.revisionId)
  await ensureMissing(token, 'auditLogs', plan.auditId)
  const now = new Date().toISOString()
  const actorFields = {
    revision: plan.nextRevision,
    updatedAt: now,
    updatedBy: ACTOR,
    revisionUpdatedAt: now,
    revisionUpdatedBy: ACTOR,
    publishedAt: now,
    publishedBy: ACTOR,
  }
  const nextCourse = { ...plan.nextCourse, ...actorFields }
  const writes = [{
    update: {
      name: documentName('courses', TARGET.courseId),
      fields: encodeFields({ modules: plan.modules, ...actorFields }),
    },
    updateMask: { fieldPaths: ['modules', ...Object.keys(actorFields)] },
    currentDocument: { updateTime: plan.courseUpdateTime },
  }]
  for (const [lessonId, key] of Object.entries(plan.quizKeys)) {
    writes.push({
      update: {
        name: `${documentName('courses', TARGET.courseId)}/quizKeys/${lessonId}`,
        fields: encodeFields({ ...key, updatedAt: now, updatedBy: ACTOR }),
      },
      updateMask: { fieldPaths: [...Object.keys(key), 'updatedAt', 'updatedBy'] },
      currentDocument: { exists: true },
    })
  }
  writes.push({
    update: {
      name: documentName('courseRevisions', plan.revisionId),
      fields: encodeFields({
        courseId: TARGET.courseId,
        revision: plan.nextRevision,
        transition: { from: 'published', to: 'published' },
        contentHash: plan.contentHash,
        course: nextCourse,
        quizKeys: plan.quizKeys,
        createdBy: ACTOR,
        createdAt: now,
      }),
    },
    currentDocument: { exists: false },
  })
  writes.push({
    update: {
      name: documentName('auditLogs', plan.auditId),
      fields: encodeFields({
        action: 'course.learning-design-v2.released',
        actorUid: ACTOR,
        targetId: TARGET.courseId,
        status: 'published',
        revision: plan.nextRevision,
        checkpointCount: plan.checkpointCount,
        questionCount: plan.questionCount,
        questionsPerAttempt: plan.questionsPerAttempt,
        mustPassCount: plan.mustPassCount,
        source: 'production-learning-v2-release',
        createdAt: now,
      }),
    },
    currentDocument: { exists: false },
  })
  await requestJson(token, `${firestoreBase()}/documents:commit`, {
    method: 'POST',
    body: JSON.stringify({ writes }),
  })
}
async function verifyRelease(token) {
  const [courseDocument, quizDocuments] = await Promise.all([
    readDocument(token, 'courses', TARGET.courseId),
    readQuizKeyDocuments(token),
  ])
  const course = decodeFields(courseDocument.fields || {})
  const quizKeys = Object.fromEntries(quizDocuments.map((document) => [
    document.name.split('/').pop(),
    decodeFields(document.fields || {}),
  ]))
  const checkpoints = validateLearningV2(course.modules || [], quizKeys)
  const revisionId = `${TARGET.courseId}_${String(Number(course.revision)).padStart(6, '0')}`
  const auditId = `academy-learning-v2_${revisionId}`
  const [revision, audit] = await Promise.all([
    readDocument(token, 'courseRevisions', revisionId),
    readDocument(token, 'auditLogs', auditId),
  ])
  const pdfResources = (course.modules || []).flatMap((module) => module.lessons || [])
    .flatMap((lesson) => lesson.resources || [])
    .filter((resource) => resource.kind === 'document' && resource.assetRef?.contentType === 'application/pdf')
  const result = {
    status: course.status,
    revision: course.revision,
    modules: course.modules?.length || 0,
    lessons: (course.modules || []).flatMap((module) => module.lessons || []).length,
    checkpoints: checkpoints.length,
    questions: checkpoints.reduce((sum, lesson) => sum + lesson.quiz.questions.length, 0),
    questionsPerAttempt: [...new Set(checkpoints.map((lesson) => lesson.quiz.publicSettings?.questionsPerAttempt))],
    mustPassQuestions: checkpoints.reduce((sum, lesson) => sum + lesson.quiz.questions.filter((question) => question.mustPass).length, 0),
    privateQuizKeys: Object.keys(quizKeys).length,
    pdfResources: pdfResources.length,
    revisionExists: Boolean(revision?.name),
    auditExists: Boolean(audit?.name),
  }
  if (result.status !== 'published' || result.modules !== 20 || result.lessons !== 60
      || result.checkpoints !== 20 || result.questions !== EXPECTED_TOTAL_QUESTIONS
      || result.questionsPerAttempt.length !== 1 || result.questionsPerAttempt[0] !== 8
      || result.mustPassQuestions !== 20 || result.privateQuizKeys !== 20
      || result.pdfResources !== 20 || !result.revisionExists || !result.auditExists) {
    throw new Error(`Verification failed: ${JSON.stringify(result)}`)
  }
  return result
}
async function main() {
  const args = parseArguments(process.argv.slice(2))
  const token = await accessToken()
  if (args.mode === 'verify') {
    const result = await verifyRelease(token)
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), mode: 'verify', target: TARGET, ...result }, null, 2)}\n`)
    console.log(JSON.stringify(result))
    return
  }
  const plan = await buildPlan(token)
  if (args.mode === 'apply') {
    if (args.confirmation !== CONFIRMATION) throw new Error('Production confirmation is missing or incorrect.')
    if (args.digest !== plan.planDigest) throw new Error('Dry-run digest is stale or incorrect.')
    await applyPlan(token, plan)
  }
  const report = publicPlan(plan, args.mode, args.mode === 'apply')
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report))
  if (args.mode === 'dry-run') console.log(`Apply confirmation: ${CONFIRMATION}`)
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error)
  process.exitCode = 1
})
