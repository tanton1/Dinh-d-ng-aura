'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
  bucket: 'gen-lang-client-0815966909.firebasestorage.app',
  courseId: 'course-c6c22b80-5b94-4628-935f-05fee4e22eaa',
})
const ACTOR = 'migration:aura-course-slide-decks-v1'
const CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/courses/${TARGET.courseId}:sync-slide-decks`
const REPORT_PATH = path.resolve('.migration-private', 'academy-slide-decks-sync.json')
const CHAPTER_COUNT = 20

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
  const result = { mode: 'dry-run', slideDir: '', pdfDir: '', digest: '', confirmation: '' }
  for (const argument of argv) {
    if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--slide-dir=')) result.slideDir = argument.slice(12)
    else if (argument.startsWith('--pdf-dir=')) result.pdfDir = argument.slice(10)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirmation = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  if (result.mode !== 'verify' && (!result.slideDir || !result.pdfDir)) throw new Error('Pass --slide-dir and --pdf-dir.')
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
  if (!response.ok && !allowedStatuses.includes(response.status)) throw new Error(`Request failed (${response.status}) at ${url.split('?')[0]}: ${raw.slice(0, 500)}`)
  return { status: response.status, headers: response.headers, data: raw ? JSON.parse(raw) : null }
}
async function readDocument(token, collection, id) {
  return (await requestJson(token, `${firestoreBase()}/documents/${collection}/${encodeURIComponent(id)}`)).data
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
  if (value && typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, encodeValue(child)])) } }
  throw new Error(`Unsupported Firestore value: ${typeof value}`)
}
function textValue(value) { return { stringValue: String(value) } }
function intValue(value) { return { integerValue: String(value) } }
function timestampValue(value) { return { timestampValue: value } }
function mapValue(fields) { return { mapValue: { fields } } }
function normalizeFileName(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
}
function chapterFromName(name) {
  const match = normalizeFileName(name).match(/chuong\s*([0-9]{1,2})/)
  return match ? Number(match[1]) : null
}
function pdfPageCount(filePath) {
  const output = execFileSync('pdfinfo', [filePath], { encoding: 'utf8', windowsHide: true })
  const match = output.match(/^Pages:\s+(\d+)$/m)
  if (!match) throw new Error(`Unable to read page count from ${filePath}.`)
  return Number(match[1])
}
function manifestForDirectory(slideDir, pdfDir) {
  const slideRoot = path.resolve(slideDir)
  const pdfRoot = path.resolve(pdfDir)
  if (!fs.existsSync(slideRoot) || !fs.statSync(slideRoot).isDirectory()) throw new Error(`Slide folder does not exist: ${slideRoot}`)
  if (!fs.existsSync(pdfRoot) || !fs.statSync(pdfRoot).isDirectory()) throw new Error(`PDF folder does not exist: ${pdfRoot}`)
  const slides = fs.readdirSync(slideRoot).filter((name) => name.toLowerCase().endsWith('.pptx'))
  if (slides.length !== CHAPTER_COUNT) throw new Error(`Expected ${CHAPTER_COUNT} PPTX files, found ${slides.length}.`)
  const byChapter = new Map()
  for (const fileName of slides) {
    const chapter = chapterFromName(fileName)
    if (!chapter || chapter < 1 || chapter > CHAPTER_COUNT || byChapter.has(chapter)) throw new Error(`Cannot uniquely map slide file ${fileName} to a chapter.`)
    const filePath = path.join(slideRoot, fileName)
    const buffer = fs.readFileSync(filePath)
    if (!buffer.subarray(0, 2).equals(Buffer.from('PK'))) throw new Error(`${fileName} is not a valid PPTX archive.`)
    const pdfFileName = `chapter-${String(chapter).padStart(2, '0')}-slides-v1.pdf`
    const pdfPath = path.join(pdfRoot, pdfFileName)
    if (!fs.existsSync(pdfPath)) throw new Error(`Converted PDF is missing for chapter ${chapter}: ${pdfPath}`)
    const pdfBuffer = fs.readFileSync(pdfPath)
    if (!pdfBuffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error(`Converted PDF is invalid for chapter ${chapter}.`)
    const prefix = `course-media/${TARGET.courseId}/chapter-${String(chapter).padStart(2, '0')}-core/`
    byChapter.set(chapter, {
      chapter,
      slideFileName: fileName,
      slidePath: filePath,
      slideBuffer: buffer,
      slideSizeBytes: buffer.length,
      slideMd5Hash: md5(buffer),
      slideSha256: sha256(buffer),
      slideStoragePath: `${prefix}aura-nutrition-chapter-${String(chapter).padStart(2, '0')}-slides-v1.pptx`,
      slideAssetId: `aura-nutrition-chapter-${String(chapter).padStart(2, '0')}-slides-v1`,
      pdfFileName,
      pdfPath,
      pdfBuffer,
      pdfSizeBytes: pdfBuffer.length,
      pdfMd5Hash: md5(pdfBuffer),
      pdfSha256: sha256(pdfBuffer),
      slideCount: pdfPageCount(pdfPath),
      pdfStoragePath: `${prefix}aura-nutrition-chapter-${String(chapter).padStart(2, '0')}-slides-v1.pdf`,
      pdfAssetId: `aura-nutrition-chapter-${String(chapter).padStart(2, '0')}-slides-v1-pdf`,
    })
  }
  return Array.from({ length: CHAPTER_COUNT }, (_, index) => byChapter.get(index + 1))
}
function buildResource(item, format) {
  const pdf = format === 'pdf'
  return {
    id: pdf ? `chapter-${String(item.chapter).padStart(2, '0')}-core-slide-pdf-v1` : `chapter-${String(item.chapter).padStart(2, '0')}-core-slide-pptx-v1`,
    kind: 'slide',
    title: pdf ? `Slide khóa học · Chương ${item.chapter}` : `Tệp PowerPoint gốc · Chương ${item.chapter}`,
    url: '',
    isPrimary: pdf,
    note: pdf
      ? `${item.slideFileName} · ${item.slideCount} trang · bản đọc trực tiếp trong Aura`
      : `${item.slideFileName} · tệp gốc để tải xuống khi cần`,
    assetRef: pdf
      ? { assetId: item.pdfAssetId, storagePath: item.pdfStoragePath, fileName: item.pdfFileName, contentType: 'application/pdf', sizeBytes: item.pdfSizeBytes, status: 'ready' }
      : { assetId: item.slideAssetId, storagePath: item.slideStoragePath, fileName: item.slideFileName, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sizeBytes: item.slideSizeBytes, status: 'ready' },
  }
}
function validateCourse(course) {
  if (course.title !== 'Làm chủ dinh dưỡng cùng AURA' || course.status !== 'published') throw new Error('Safety stop: unexpected production course.')
  if (!Array.isArray(course.modules) || course.modules.length !== CHAPTER_COUNT || Number(course.lessons) !== 60) throw new Error('Safety stop: expected 20 chapters / 60 lessons.')
  if (!Number.isInteger(Number(course.revision)) || Number(course.revision) < 1) throw new Error('Safety stop: invalid course revision.')
  for (let chapter = 1; chapter <= CHAPTER_COUNT; chapter += 1) {
    const lessonId = `chapter-${String(chapter).padStart(2, '0')}-core`
    const matches = course.modules.flatMap((module) => module.lessons || []).filter((lesson) => lesson.id === lessonId)
    if (matches.length !== 1) throw new Error(`Safety stop: ${lessonId} is missing or duplicated.`)
  }
}
function mergeResources(course, manifest) {
  return course.modules.map((module) => ({
    ...module,
    lessons: module.lessons.map((lesson) => {
      const match = /^chapter-(\d{2})-core$/.exec(String(lesson.id))
      if (!match) return lesson
      const item = manifest[Number(match[1]) - 1]
      const resources = (lesson.resources || []).filter((resource) => !String(resource.id || '').includes('-core-slide-'))
      return { ...lesson, resources: [buildResource(item, 'pdf'), buildResource(item, 'pptx'), ...resources] }
    }),
  }))
}
async function objectMetadata(token, storagePath) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(TARGET.bucket)}/o/${encodeURIComponent(storagePath)}`
  const result = await requestJson(token, url, {}, [404])
  return result.status === 404 ? null : result.data
}
async function uploadObject(token, item, format) {
  const pdf = format === 'pdf'
  const storagePath = pdf ? item.pdfStoragePath : item.slideStoragePath
  const buffer = pdf ? item.pdfBuffer : item.slideBuffer
  const md5Hash = pdf ? item.pdfMd5Hash : item.slideMd5Hash
  const sizeBytes = pdf ? item.pdfSizeBytes : item.slideSizeBytes
  const assetId = pdf ? item.pdfAssetId : item.slideAssetId
  const contentType = pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  const existing = await objectMetadata(token, storagePath)
  if (existing) {
    if (existing.md5Hash !== md5Hash || Number(existing.size) !== sizeBytes) throw new Error(`Safety stop: existing slide object differs for chapter ${item.chapter} (${format}).`)
    return 'reused'
  }
  const startUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(TARGET.bucket)}/o?uploadType=resumable&ifGenerationMatch=0&name=${encodeURIComponent(storagePath)}`
  const startResponse = await fetch(startUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': contentType, 'X-Upload-Content-Length': String(sizeBytes) },
    body: JSON.stringify({ name: storagePath, contentType, metadata: { courseId: TARGET.courseId, lessonId: `chapter-${String(item.chapter).padStart(2, '0')}-core`, mediaId: assetId, assetId, uploadedBy: ACTOR, resourceKind: 'slide', sourceFile: item.slideFileName, sourceSha256: pdf ? item.pdfSha256 : item.slideSha256 } }),
  })
  if (!startResponse.ok) throw new Error(`Unable to begin chapter ${item.chapter} ${format} upload (${startResponse.status}): ${(await startResponse.text()).slice(0, 500)}`)
  const uploadUrl = startResponse.headers.get('location')
  if (!uploadUrl) throw new Error(`Upload URL missing for chapter ${item.chapter} ${format}.`)
  const uploadResponse = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType, 'Content-Length': String(sizeBytes) }, body: buffer })
  const raw = await uploadResponse.text()
  if (!uploadResponse.ok) throw new Error(`Chapter ${item.chapter} ${format} upload failed (${uploadResponse.status}): ${raw.slice(0, 500)}`)
  const uploaded = JSON.parse(raw)
  if (uploaded.md5Hash !== md5Hash || Number(uploaded.size) !== sizeBytes) throw new Error(`Upload checksum mismatch for chapter ${item.chapter} ${format}.`)
  return 'uploaded'
}
async function ensureMissing(token, collection, id) {
  const result = await requestJson(token, `${firestoreBase()}/documents/${collection}/${encodeURIComponent(id)}`, {}, [404])
  if (result.status !== 404) throw new Error(`Safety stop: ${collection}/${id} already exists.`)
}
async function buildPlan(token, slideDir, pdfDir) {
  const courseDocument = await readDocument(token, 'courses', TARGET.courseId)
  const course = decodeFields(courseDocument.fields || {})
  validateCourse(course)
  const manifest = manifestForDirectory(slideDir, pdfDir)
  const modules = mergeResources(course, manifest)
  const nextRevision = Number(course.revision) + 1
  const revisionId = `${TARGET.courseId}_${String(nextRevision).padStart(6, '0')}`
  const importBatchId = `aura-course-slide-decks-${sha256(Buffer.from(manifest.map((item) => `${item.slideSha256}:${item.pdfSha256}`).join('|'))).slice(0, 16)}`
  const auditId = `academy-slide-decks-sync_${revisionId}`
  const core = {
    projectId: TARGET.projectId,
    databaseId: TARGET.databaseId,
    bucket: TARGET.bucket,
    courseId: TARGET.courseId,
    title: course.title,
    currentRevision: Number(course.revision),
    nextRevision,
    courseUpdateTime: courseDocument.updateTime,
    revisionId,
    auditId,
    importBatchId,
    chapterCount: CHAPTER_COUNT,
    slideCount: manifest.length,
    pptxBytes: manifest.reduce((sum, item) => sum + item.slideSizeBytes, 0),
    pdfBytes: manifest.reduce((sum, item) => sum + item.pdfSizeBytes, 0),
    sourceDigest: sha256(Buffer.from(manifest.map((item) => item.slideSha256).join(':'))),
    contentHash: sha256(Buffer.from(JSON.stringify(canonical(modules)))),
    mapping: manifest.map((item) => ({ chapter: item.chapter, lessonId: `chapter-${String(item.chapter).padStart(2, '0')}-core`, sourceFile: item.slideFileName, pdfFile: item.pdfFileName, slideAssetId: item.slideAssetId, pdfAssetId: item.pdfAssetId })),
  }
  return { ...core, planDigest: sha256(Buffer.from(JSON.stringify(canonical(core)))), courseDocument, course, modules, manifest }
}
function publicPlan(plan, mode, writesPerformed, uploadResults = []) {
  const { courseDocument: _document, course: _course, modules: _modules, manifest: _manifest, ...safe } = plan
  return { generatedAt: new Date().toISOString(), mode, target: TARGET, ...safe, writesPerformed, uploadResults }
}
async function applyPlan(token, plan) {
  await ensureMissing(token, 'courseRevisions', plan.revisionId)
  await ensureMissing(token, 'auditLogs', plan.auditId)
  await ensureMissing(token, 'courseImportBatches', plan.importBatchId)
  const uploadResults = []
  for (const item of plan.manifest) {
    uploadResults.push({ chapter: item.chapter, pptx: await uploadObject(token, item, 'pptx'), pdf: await uploadObject(token, item, 'pdf') })
  }
  const now = new Date().toISOString()
  const revisionCourseFields = { ...plan.courseDocument.fields, modules: encodeValue(plan.modules), revision: intValue(plan.nextRevision), status: textValue('published'), updatedAt: timestampValue(now), updatedBy: textValue(ACTOR), revisionUpdatedAt: timestampValue(now), revisionUpdatedBy: textValue(ACTOR), publishedAt: timestampValue(now), publishedBy: textValue(ACTOR) }
  const updateFields = { modules: encodeValue(plan.modules), revision: intValue(plan.nextRevision), updatedAt: timestampValue(now), updatedBy: textValue(ACTOR), revisionUpdatedAt: timestampValue(now), revisionUpdatedBy: textValue(ACTOR), publishedAt: timestampValue(now), publishedBy: textValue(ACTOR) }
  const revisionFields = { courseId: textValue(TARGET.courseId), revision: intValue(plan.nextRevision), transition: mapValue({ from: textValue('published'), to: textValue('published') }), contentHash: textValue(plan.contentHash), course: mapValue(revisionCourseFields), createdBy: textValue(ACTOR), createdAt: timestampValue(now) }
  const auditFields = { action: textValue('course.slide_decks.synced'), actorUid: textValue(ACTOR), targetId: textValue(TARGET.courseId), status: textValue('published'), revision: intValue(plan.nextRevision), chapterCount: intValue(CHAPTER_COUNT), pptxCount: intValue(CHAPTER_COUNT), pdfCount: intValue(CHAPTER_COUNT), importBatchId: textValue(plan.importBatchId), source: textValue('downloads/slide khóa học'), createdAt: timestampValue(now) }
  const importFields = { importBatchId: textValue(plan.importBatchId), courseId: textValue(TARGET.courseId), status: textValue('applied'), source: textValue('C:\\Users\\TAN TON\\Downloads\\slide khóa học'), chapterCount: intValue(CHAPTER_COUNT), files: encodeValue(plan.mapping), actorUid: textValue(ACTOR), createdAt: timestampValue(now), contentHash: textValue(plan.contentHash) }
  await requestJson(token, `${firestoreBase()}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes: [
    { update: { name: documentPath('courses', TARGET.courseId), fields: updateFields }, updateMask: { fieldPaths: Object.keys(updateFields) }, currentDocument: { updateTime: plan.courseUpdateTime } },
    { update: { name: documentPath('courseRevisions', plan.revisionId), fields: revisionFields }, currentDocument: { exists: false } },
    { update: { name: documentPath('auditLogs', plan.auditId), fields: auditFields }, currentDocument: { exists: false } },
    { update: { name: documentPath('courseImportBatches', plan.importBatchId), fields: importFields }, currentDocument: { exists: false } },
  ] }) })
  return uploadResults
}
async function verify(token) {
  const courseDocument = await readDocument(token, 'courses', TARGET.courseId)
  const course = decodeFields(courseDocument.fields || {})
  validateCourse(course)
  const chapters = []
  for (let chapter = 1; chapter <= CHAPTER_COUNT; chapter += 1) {
    const lesson = course.modules.flatMap((module) => module.lessons || []).find((item) => item.id === `chapter-${String(chapter).padStart(2, '0')}-core`)
    const resources = lesson.resources || []
    const pdf = resources.find((resource) => resource.id === `chapter-${String(chapter).padStart(2, '0')}-core-slide-pdf-v1`)
    const pptx = resources.find((resource) => resource.id === `chapter-${String(chapter).padStart(2, '0')}-core-slide-pptx-v1`)
    if (!pdf || !pptx) throw new Error(`Verification failed: missing slide resources for chapter ${chapter}.`)
    const [pdfObject, pptxObject] = await Promise.all([objectMetadata(token, pdf.assetRef.storagePath), objectMetadata(token, pptx.assetRef.storagePath)])
    if (!pdfObject || !pptxObject || pdfObject.metadata?.courseId !== TARGET.courseId || pptxObject.metadata?.courseId !== TARGET.courseId) throw new Error(`Verification failed: invalid Storage metadata for chapter ${chapter}.`)
    chapters.push({ chapter, lessonId: lesson.id, pdf: pdf.assetRef.fileName, pptx: pptx.assetRef.fileName })
  }
  return { status: course.status, revision: course.revision, chapters: chapters.length, chaptersWithPptx: chapters.length, chaptersWithReaderPdf: chapters.length }
}
async function main() {
  const args = parseArguments(process.argv.slice(2))
  const token = await accessToken()
  if (args.mode === 'verify') {
    const result = await verify(token)
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), mode: 'verify', target: TARGET, ...result }, null, 2)}\n`)
    console.log(JSON.stringify(result))
    return
  }
  const plan = await buildPlan(token, args.slideDir, args.pdfDir)
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
