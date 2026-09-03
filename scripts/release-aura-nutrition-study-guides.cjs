'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
  bucket: 'gen-lang-client-0815966909.firebasestorage.app',
  courseId: 'course-c6c22b80-5b94-4628-935f-05fee4e22eaa',
})
const ACTOR = 'migration:aura-nutrition-study-guides-v1'
const CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/courses/${TARGET.courseId}:release-study-guides`
const REPORT_PATH = path.resolve('.migration-private', 'academy-study-guides-release.json')
const pageCounts = [52, 48, 56, 63, 74, 82, 90, 96, 97, 90, 106, 100, 121, 126, 100, 116, 105, 105, 98, 98]

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function md5(value) { return crypto.createHash('md5').update(value).digest('base64') }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = canonical(value[key])
    return result
  }, {})
  return value
}
function parseArguments(argv) {
  const result = { mode: 'dry-run', digest: '', confirmation: '', pdfDir: '' }
  for (const argument of argv) {
    if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirmation = argument.slice(10)
    else if (argument.startsWith('--pdf-dir=')) result.pdfDir = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  if (!result.pdfDir) throw new Error('Pass the folder containing the 20 source PDFs with --pdf-dir=...')
  return result
}
function firebaseCliAuth() {
  if (!process.env.APPDATA) throw new Error('APPDATA is unavailable.')
  const auth = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}
async function accessToken() {
  const { auth, account } = firebaseCliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain a Firebase access token.')
  return result.access_token
}
function resourceBase() { return `projects/${TARGET.projectId}/databases/${TARGET.databaseId}` }
function firestoreBase() { return `https://firestore.googleapis.com/v1/${resourceBase()}` }
function documentPath(collection, id) { return `${resourceBase()}/documents/${collection}/${id}` }
async function requestJson(token, url, options = {}, allowedStatuses = []) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  })
  const raw = await response.text()
  if (!response.ok && !allowedStatuses.includes(response.status)) {
    throw new Error(`Request failed (${response.status}) at ${url.split('?')[0]}: ${raw.slice(0, 500)}`)
  }
  return { status: response.status, headers: response.headers, data: raw ? JSON.parse(raw) : null }
}
async function readDocument(token, collection, id) {
  return (await requestJson(token, `${firestoreBase()}/documents/${collection}/${encodeURIComponent(id)}`)).data
}
async function readQuizKeys(token) {
  return (await requestJson(token, `${firestoreBase()}/documents/courses/${TARGET.courseId}/quizKeys?pageSize=100`)).data?.documents || []
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
function decodeFields(fields = {}) { return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)])) }
function encodeValue(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  if (value && typeof value === 'object') {
    const fields = Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, encodeValue(child)]),
    )
    return { mapValue: { fields } }
  }
  throw new Error(`Unsupported Firestore value: ${typeof value}`)
}
function textValue(value) { return { stringValue: String(value) } }
function intValue(value) { return { integerValue: String(value) } }
function timestampValue(value) { return { timestampValue: value } }
function mapValue(fields) { return { mapValue: { fields } } }

function loadLocalModules() {
  const built = esbuild.buildSync({
    entryPoints: [path.resolve('src', 'course-template.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    write: false,
  })
  const fileName = path.resolve('.migration-private', 'compiled-aura-course.cjs')
  const compiled = new Module(fileName, module)
  compiled.filename = fileName
  compiled.paths = Module._nodeModulePaths(process.cwd())
  compiled._compile(built.outputFiles[0].text, fileName)
  return compiled.exports.auraFoundationCourse.modules
}
function pdfManifest(pdfDir) {
  const root = path.resolve(pdfDir)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`PDF folder does not exist: ${root}`)
  const names = fs.readdirSync(root).filter((name) => name.toLowerCase().endsWith('.pdf'))
  return Array.from({ length: 20 }, (_, offset) => {
    const chapter = offset + 1
    const pattern = new RegExp(`Chuong_${chapter}(?:_|$)`, 'i')
    const matches = names.filter((name) => pattern.test(name))
    if (matches.length !== 1) throw new Error(`Expected exactly one PDF for chapter ${chapter}; found ${matches.length}.`)
    const filePath = path.join(root, matches[0])
    const buffer = fs.readFileSync(filePath)
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error(`Chapter ${chapter} is not a valid PDF.`)
    const lessonId = `chapter-${String(chapter).padStart(2, '0')}-core`
    const assetId = `aura-nutrition-chapter-${String(chapter).padStart(2, '0')}-handbook-v1`
    const storagePath = `course-media/${TARGET.courseId}/${lessonId}/${assetId}.pdf`
    return {
      chapter,
      lessonId,
      assetId,
      filePath,
      fileName: matches[0],
      sizeBytes: buffer.length,
      md5Hash: md5(buffer),
      sha256: sha256(buffer),
      pageCount: pageCounts[offset],
      storagePath,
      buffer,
    }
  })
}
function immutableQuizFields(document) {
  const fields = document.fields || {}
  const quizId = decodeValue(fields.quizId) || document.name.split('/').pop()
  return {
    quizId: textValue(quizId),
    passPercent: intValue(Number.isInteger(decodeValue(fields.passPercent)) ? decodeValue(fields.passPercent) : 0),
    answers: fields.answers?.mapValue ? fields.answers : mapValue({}),
    questionCount: intValue(Number.isInteger(decodeValue(fields.questionCount)) ? decodeValue(fields.questionCount) : 0),
    contentHash: textValue(typeof decodeValue(fields.contentHash) === 'string' ? decodeValue(fields.contentHash) : ''),
  }
}
function enrichModules(currentModules, localModules, manifest) {
  const localLessons = new Map(localModules.flatMap((module) => module.lessons).map((lesson) => [lesson.id, lesson]))
  const sourceByLesson = new Map(manifest.map((item) => [item.lessonId, item]))
  const enriched = currentModules.map((module) => ({
    ...module,
    lessons: module.lessons.map((lesson) => {
      const local = localLessons.get(lesson.id)
      if (!local) throw new Error(`Local curriculum is missing ${lesson.id}.`)
      if (!lesson.id.endsWith('-core') && !lesson.id.endsWith('-practice')) return lesson
      const updated = {
        ...lesson,
        duration: local.duration,
        summary: local.summary,
        tags: local.tags,
        coachNotes: local.coachNotes,
        memory: local.memory,
        primaryContent: local.primaryContent,
      }
      const source = sourceByLesson.get(lesson.id)
      if (!source) return updated
      const resource = {
        id: `${lesson.id}-handbook-pdf`,
        kind: 'document',
        title: `Giáo trình đầy đủ · Chương ${source.chapter}`,
        url: '',
        note: `PDF ${source.pageCount} trang · infographic, case study, workbook, checklist và tài liệu tham khảo`,
        assetRef: {
          assetId: source.assetId,
          storagePath: source.storagePath,
          fileName: source.fileName,
          contentType: 'application/pdf',
          sizeBytes: source.sizeBytes,
          status: 'ready',
        },
      }
      return { ...updated, resources: [...(updated.resources || []).filter((item) => item.id !== resource.id), resource] }
    }),
  }))
  const lessons = enriched.flatMap((module) => module.lessons)
  if (enriched.length !== 20 || lessons.length !== 60) throw new Error('Safety stop: enriched curriculum must remain 20 chapters and 60 lessons.')
  const coreLessons = lessons.filter((lesson) => lesson.id.endsWith('-core'))
  const practiceLessons = lessons.filter((lesson) => lesson.id.endsWith('-practice'))
  if (coreLessons.length !== 20 || coreLessons.some((lesson) => (lesson.primaryContent?.body || '').length < 3000)) throw new Error('Safety stop: every core lesson must contain a detailed article.')
  if (practiceLessons.length !== 20 || practiceLessons.some((lesson) => (lesson.primaryContent?.body || '').length < 1300)) throw new Error('Safety stop: every practice lesson must contain a detailed workbook.')
  if (coreLessons.some((lesson) => lesson.resources?.some((resource) => resource.kind === 'video'))) throw new Error('Safety stop: no unverified video may be introduced.')
  return enriched
}
async function objectMetadata(token, storagePath) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(TARGET.bucket)}/o/${encodeURIComponent(storagePath)}`
  const result = await requestJson(token, url, {}, [404])
  return result.status === 404 ? null : result.data
}
async function uploadPdf(token, source) {
  const existing = await objectMetadata(token, source.storagePath)
  if (existing) {
    if (existing.md5Hash !== source.md5Hash || Number(existing.size) !== source.sizeBytes) {
      throw new Error(`Safety stop: existing object differs for chapter ${source.chapter}.`)
    }
    return 'reused'
  }
  const startUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(TARGET.bucket)}/o?uploadType=resumable&ifGenerationMatch=0&name=${encodeURIComponent(source.storagePath)}`
  const startResponse = await fetch(startUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/pdf',
      'X-Upload-Content-Length': String(source.sizeBytes),
    },
    body: JSON.stringify({
      name: source.storagePath,
      contentType: 'application/pdf',
      metadata: {
        courseId: TARGET.courseId,
        lessonId: source.lessonId,
        mediaId: source.assetId,
        assetId: source.assetId,
        uploadedBy: ACTOR,
        resourceKind: 'document',
        sourceSha256: source.sha256,
      },
    }),
  })
  if (!startResponse.ok) throw new Error(`Unable to begin chapter ${source.chapter} upload (${startResponse.status}): ${(await startResponse.text()).slice(0, 500)}`)
  const uploadUrl = startResponse.headers.get('location')
  if (!uploadUrl) throw new Error(`Upload URL missing for chapter ${source.chapter}.`)
  const uploadResponse = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(source.sizeBytes) }, body: source.buffer })
  const raw = await uploadResponse.text()
  if (!uploadResponse.ok) throw new Error(`Chapter ${source.chapter} upload failed (${uploadResponse.status}): ${raw.slice(0, 500)}`)
  const uploaded = JSON.parse(raw)
  if (uploaded.md5Hash !== source.md5Hash || Number(uploaded.size) !== source.sizeBytes) throw new Error(`Uploaded checksum mismatch for chapter ${source.chapter}.`)
  return 'uploaded'
}
async function buildPlan(token, pdfDir) {
  const [courseDocument, quizDocuments] = await Promise.all([readDocument(token, 'courses', TARGET.courseId), readQuizKeys(token)])
  const course = decodeFields(courseDocument.fields || {})
  if (course.title !== 'Làm chủ dinh dưỡng cùng AURA') throw new Error('Safety stop: unexpected course title.')
  if (course.status !== 'published') throw new Error(`Safety stop: expected a published course, found ${course.status}.`)
  if (!Array.isArray(course.modules) || course.modules.length !== 20 || Number(course.lessons) !== 60) throw new Error('Safety stop: production curriculum is not the expected 20 chapters / 60 lessons.')
  const currentRevision = Number(course.revision)
  if (!Number.isInteger(currentRevision) || currentRevision < 1) throw new Error('Safety stop: production revision is invalid.')
  const manifest = pdfManifest(pdfDir)
  const localModules = loadLocalModules()
  const modules = enrichModules(course.modules, localModules, manifest)
  const objectStates = []
  for (const item of manifest) {
    const metadata = await objectMetadata(token, item.storagePath)
    if (metadata && (metadata.md5Hash !== item.md5Hash || Number(metadata.size) !== item.sizeBytes)) throw new Error(`Safety stop: mismatched existing PDF for chapter ${item.chapter}.`)
    objectStates.push(metadata ? 'ready' : 'missing')
  }
  const nextRevision = currentRevision + 1
  const revisionId = `${TARGET.courseId}_${String(nextRevision).padStart(6, '0')}`
  const auditId = `academy-content-enrichment_${revisionId}`
  const core = {
    projectId: TARGET.projectId,
    databaseId: TARGET.databaseId,
    bucket: TARGET.bucket,
    courseId: TARGET.courseId,
    title: course.title,
    currentRevision,
    nextRevision,
    courseUpdateTime: courseDocument.updateTime,
    revisionId,
    auditId,
    moduleCount: modules.length,
    lessonCount: modules.flatMap((module) => module.lessons).length,
    detailedArticleCount: modules.flatMap((module) => module.lessons).filter((lesson) => lesson.id.endsWith('-core') && (lesson.primaryContent?.body || '').length >= 3000).length,
    workbookCount: modules.flatMap((module) => module.lessons).filter((lesson) => lesson.id.endsWith('-practice') && (lesson.primaryContent?.body || '').length >= 1300).length,
    pdfCount: manifest.length,
    pdfBytes: manifest.reduce((sum, item) => sum + item.sizeBytes, 0),
    existingPdfCount: objectStates.filter((state) => state === 'ready').length,
    coursePayloadBytes: Buffer.byteLength(JSON.stringify({ ...course, modules }), 'utf8'),
    sourceDigest: sha256(Buffer.from(manifest.map((item) => item.sha256).join(':'))),
    contentHash: sha256(Buffer.from(JSON.stringify(canonical({ modules, quizKeys: quizDocuments.map((doc) => decodeFields(doc.fields || {})) })))),
  }
  return { ...core, planDigest: sha256(Buffer.from(JSON.stringify(canonical(core)))), courseDocument, quizDocuments, modules, manifest }
}
function publicPlan(plan, mode, writesPerformed, uploadResults = []) {
  const { courseDocument: _courseDocument, quizDocuments: _quizDocuments, modules: _modules, manifest: _manifest, ...safe } = plan
  return { generatedAt: new Date().toISOString(), mode, target: TARGET, ...safe, writesPerformed, uploadResults }
}
async function ensureMissing(token, collection, id) {
  const url = `${firestoreBase()}/documents/${collection}/${encodeURIComponent(id)}`
  const result = await requestJson(token, url, {}, [404])
  if (result.status !== 404) throw new Error(`Safety stop: ${collection}/${id} already exists.`)
}
async function applyPlan(token, plan) {
  await ensureMissing(token, 'courseRevisions', plan.revisionId)
  await ensureMissing(token, 'auditLogs', plan.auditId)
  const uploadResults = []
  for (const item of plan.manifest) uploadResults.push({ chapter: item.chapter, result: await uploadPdf(token, item) })
  const now = new Date().toISOString()
  const quizKeyFields = Object.fromEntries(plan.quizDocuments.map((document) => [document.name.split('/').pop(), mapValue(immutableQuizFields(document))]))
  const revisionCourseFields = {
    ...plan.courseDocument.fields,
    modules: encodeValue(plan.modules),
    revision: intValue(plan.nextRevision),
    status: textValue('published'),
    updatedAt: timestampValue(now),
    updatedBy: textValue(ACTOR),
    revisionUpdatedAt: timestampValue(now),
    revisionUpdatedBy: textValue(ACTOR),
    publishedAt: timestampValue(now),
    publishedBy: textValue(ACTOR),
  }
  const updateFields = {
    modules: encodeValue(plan.modules), revision: intValue(plan.nextRevision),
    updatedAt: timestampValue(now), updatedBy: textValue(ACTOR),
    revisionUpdatedAt: timestampValue(now), revisionUpdatedBy: textValue(ACTOR),
    publishedAt: timestampValue(now), publishedBy: textValue(ACTOR),
  }
  const revisionFields = {
    courseId: textValue(TARGET.courseId), revision: intValue(plan.nextRevision),
    transition: mapValue({ from: textValue('published'), to: textValue('published') }),
    contentHash: textValue(plan.contentHash), course: mapValue(revisionCourseFields),
    quizKeys: mapValue(quizKeyFields), createdBy: textValue(ACTOR), createdAt: timestampValue(now),
  }
  const auditFields = {
    action: textValue('course.content.enriched'), actorUid: textValue(ACTOR), targetId: textValue(TARGET.courseId),
    status: textValue('published'), revision: intValue(plan.nextRevision), pdfCount: intValue(20),
    detailedArticleCount: intValue(20), workbookCount: intValue(20), source: textValue('production-study-guide-release'), createdAt: timestampValue(now),
  }
  await requestJson(token, `${firestoreBase()}/documents:commit`, {
    method: 'POST',
    body: JSON.stringify({ writes: [
      { update: { name: documentPath('courses', TARGET.courseId), fields: updateFields }, updateMask: { fieldPaths: Object.keys(updateFields) }, currentDocument: { updateTime: plan.courseUpdateTime } },
      { update: { name: documentPath('courseRevisions', plan.revisionId), fields: revisionFields }, currentDocument: { exists: false } },
      { update: { name: documentPath('auditLogs', plan.auditId), fields: auditFields }, currentDocument: { exists: false } },
    ] }),
  })
  return uploadResults
}
async function verifyRelease(token) {
  const courseDocument = await readDocument(token, 'courses', TARGET.courseId)
  const course = decodeFields(courseDocument.fields || {})
  const lessons = (course.modules || []).flatMap((module) => module.lessons || [])
  const coreLessons = lessons.filter((lesson) => lesson.id.endsWith('-core'))
  const practiceLessons = lessons.filter((lesson) => lesson.id.endsWith('-practice'))
  const resources = coreLessons.flatMap((lesson) => lesson.resources || []).filter((resource) => resource.kind === 'document' && resource.assetRef?.contentType === 'application/pdf')
  const states = []
  for (const resource of resources) {
    const metadata = await objectMetadata(token, resource.assetRef.storagePath)
    states.push(Boolean(metadata && metadata.metadata?.courseId === TARGET.courseId && metadata.metadata?.lessonId && metadata.metadata?.resourceKind === 'document'))
  }
  const revisionId = `${TARGET.courseId}_${String(Number(course.revision)).padStart(6, '0')}`
  const auditId = `academy-content-enrichment_${revisionId}`
  const [revision, audit] = await Promise.all([readDocument(token, 'courseRevisions', revisionId), readDocument(token, 'auditLogs', auditId)])
  const result = {
    status: course.status,
    revision: course.revision,
    modules: course.modules?.length || 0,
    lessons: lessons.length,
    detailedArticles: coreLessons.filter((lesson) => (lesson.primaryContent?.body || '').length >= 3000).length,
    workbooks: practiceLessons.filter((lesson) => (lesson.primaryContent?.body || '').length >= 1300).length,
    pdfResources: resources.length,
    validPdfObjects: states.filter(Boolean).length,
    revisionExists: Boolean(revision?.name),
    auditExists: Boolean(audit?.name),
  }
  if (result.status !== 'published' || result.modules !== 20 || result.lessons !== 60 || result.detailedArticles !== 20 || result.workbooks !== 20 || result.pdfResources !== 20 || result.validPdfObjects !== 20 || !result.revisionExists || !result.auditExists) {
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
  const plan = await buildPlan(token, args.pdfDir)
  let uploadResults = []
  if (args.mode === 'apply') {
    if (args.confirmation !== CONFIRMATION) throw new Error('Production confirmation is missing or incorrect.')
    if (args.digest !== plan.planDigest) throw new Error('Dry-run digest is stale or incorrect.')
    uploadResults = await applyPlan(token, plan)
  }
  const report = publicPlan(plan, args.mode, args.mode === 'apply', uploadResults)
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report))
  if (args.mode === 'dry-run') console.log(`Apply confirmation: ${CONFIRMATION}`)
}

main().catch((error) => { console.error(error?.stack || error?.message || error); process.exitCode = 1 })
