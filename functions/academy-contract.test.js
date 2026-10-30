'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { runInNewContext } = require('node:vm')

const repositoryRoot = join(__dirname, '..')
const functionsSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
const authoringSource = readFileSync(join(__dirname, 'academy-authoring.js'), 'utf8')
const serviceSource = readFileSync(join(repositoryRoot, 'src', 'services', 'firebaseService.ts'), 'utf8')
const editorSource = readFileSync(join(repositoryRoot, 'src', 'pages', 'admin', 'CourseEditorPage.tsx'), 'utf8')
const notebookImporterSource = readFileSync(join(repositoryRoot, 'src', 'services', 'courseNotebookLmImportService.ts'), 'utf8')
const notebookPanelSource = readFileSync(join(repositoryRoot, 'src', 'components', 'academy', 'CourseNotebookLmImportPanel.tsx'), 'utf8')
const typesSource = readFileSync(join(repositoryRoot, 'src', 'types.ts'), 'utf8')
const hookSource = readFileSync(join(repositoryRoot, 'src', 'hooks', 'useCourses.ts'), 'utf8')
const storageRules = readFileSync(join(repositoryRoot, 'storage.rules'), 'utf8')
const firestoreRules = readFileSync(join(repositoryRoot, 'firestore.rules'), 'utf8')
const firebaseConfig = JSON.parse(readFileSync(join(repositoryRoot, 'firebase.json'), 'utf8'))
const appletConfig = JSON.parse(readFileSync(join(repositoryRoot, 'firebase-applet-config.json'), 'utf8'))
const serverSource = readFileSync(join(repositoryRoot, 'server.ts'), 'utf8')

test('learner runtime uses fractional CPU with bounded concurrency and keeps server checks', () => {
  assert.match(functionsSource, /const academyLearnerRuntime = \{ cpu: 'gcf_gen1', memory: '256MiB', concurrency: 1, minInstances: 0, maxInstances: 2/)
  for (const name of ['listAcademyCourses', 'getCourseMediaUrl', 'enrollInCourse', 'completeCourseLesson']) {
    assert.ok(functionsSource.includes('exports.' + name + ' = onCall(academyLearnerRuntime, async (request) => {'))
  }
  assert.match(serviceSource, /callAcademyReadFunction[^\n]*'listAcademyCourses'/)
})

test('Academy regional reads use the exact authorized handlers without duplicating business logic', () => {
  for (const name of ['listAcademyCourses', 'getCourseMediaUrl']) {
    const block = functionsSource.match(new RegExp(`exports\\.${name}Regional = onCall\\([\\s\\S]*?\\n\\)`))?.[0]
    assert.ok(block, `${name}Regional must be deployed independently of the legacy endpoint`)
    const handler = () => ({ name })
    const target = { [name]: { run: handler } }
    let config
    runInNewContext(block, {
      exports: target,
      academyLearnerRuntime: { minInstances: 0, maxInstances: 2, cpu: 'gcf_gen1', memory: '256MiB', concurrency: 1 },
      onCall: (options, callback) => { config = options; return callback },
    })
    assert.equal(target[`${name}Regional`], handler)
    assert.equal(config.region, 'asia-east1')
    assert.equal(config.invoker, 'public')
    assert.equal(config.minInstances, 0)
    assert.equal(config.maxInstances, 2)
    assert.equal(config.cpu, 'gcf_gen1')
  }
})

test('web, Functions and Firestore Rules share the canonical named database', () => {
  const functionDefault = functionsSource.match(/defaultFirestoreDatabaseId = '([^']+)'/)?.[1]
  const rulesDatabase = firebaseConfig.firestore?.[0]?.database
  assert.ok(functionDefault, 'Functions must declare a production database fallback')
  assert.equal(functionDefault, appletConfig.firestoreDatabaseId)
  assert.equal(rulesDatabase, appletConfig.firestoreDatabaseId)
  assert.match(functionsSource, /process\.env\.FIRESTORE_DATABASE_ID \|\| defaultFirestoreDatabaseId/)
  assert.match(serverSource, /process\.env\.FIRESTORE_DATABASE_ID[\s\S]*process\.env\.VITE_FIREBASE_DATABASE_ID/)
  assert.match(serverSource, /getFirestore\(admin\.app\(\), firestoreDatabaseId\)/)
})

test('course covers have a bounded public-read and staff-write Storage contract', () => {
  const block = storageRules.match(/match \/public-assets\/course-covers\/\{courseId\}\/\{fileName\} \{[\s\S]*?\n    \}/)?.[0] ?? ''
  assert.match(block, /allow read: if true;/)
  assert.match(block, /allow create: if isAcademyStaff\(\)/)
  assert.match(block, /allow update: if false;/)
  assert.match(storageRules, /request\.resource\.size <= 5 \* 1024 \* 1024/)
  assert.match(storageRules, /image\/\(jpeg\|png\|webp\)/)
  assert.match(block, /hasValidCourseCoverMetadata\(courseId\)/)
  assert.doesNotMatch(block, /gif/)
})

test('Academy save delegates to the behavior-tested atomic authoring contract with production validators', () => {
  const block = functionsSource.match(/exports\.saveCourseDraftAtomic = onCall[\s\S]*?\n\}\)/)?.[0] ?? ''
  assert.match(block, /return academyAuthoring\.save\(request\)/)
  const wiring = functionsSource.match(/const academyAuthoring = createAcademyAuthoringHandlers\([\s\S]*?\n\}\)/)?.[0] ?? ''
  assert.match(wiring, /storage: academyCourseStorage/)
  assert.match(wiring, /authorize: requireTrustedAcademyStaffContext/)
  assert.match(wiring, /normalize: normalizeCourseDraftInput/)
  assert.match(wiring, /assertSaveStatus: assertCourseContentSaveStatus/)
  assert.match(wiring, /assertReady: assertCourseReadyToPublish/)
  assert.match(wiring, /validateScientificReview: academyDraftAdoption\.validateCourse/)
  assert.match(block, /return academyDraftAdoption\.mutate\(request\)/)
  assert.match(authoringSource, /authorize\(request, \(ref\) => transaction\.get\(ref\)\)/)
  assert.match(authoringSource, /compareRevision\(root, expectedRevision\)/)
  assert.doesNotMatch(authoringSource, /transaction\.(?:set|update|delete)\([^\n]*quizKeys/)
})

test('NotebookLM content enters Academy through a reviewed idempotent draft import', () => {
  assert.match(notebookImporterSource, /parseNotebookLmFiles/)
  assert.match(notebookImporterSource, /artifactHash/)
  assert.match(notebookImporterSource, /front.*back.*hint/s)
  assert.match(notebookImporterSource, /correctIndex/)
  assert.match(notebookPanelSource, /Nhập vào bản nháp/)
  assert.match(editorSource, /currentTarget\?\.provenance\?\.artifactHash === source\.artifactHash/)
  assert.match(editorSource, /uploadCourseMedia/)
  assert.match(functionsSource, /normalizeCourseContentProvenance/)
  assert.match(authoringSource, /transaction\.set\(db\.collection\('courseImportBatches'\)/)
  assert.doesNotMatch(functionsSource.match(/exports\.saveMealPlanRecipe = onCall[\s\S]*?return \{ recipe:/)?.[0] ?? '', /courseImportBatches/)
})

test('Academy callables remain browser-invocable and authorize inside their handlers', () => {
  for (const name of [
    'saveCourseDraftAtomic',
    'transitionCoursePublicationStatus',
    'getCourseRevisionHistory',
    'getCourseRevisionDiff',
    'restoreCourseRevisionToDraft',
    'gradeCourseQuiz',
  ]) {
    assert.match(
      functionsSource,
      new RegExp(`exports\\.${name} = onCall\\(\\{[^}]*invoker: 'public'[^}]*\\}, async \\(request\\) => \\{`),
      `${name} must accept the browser request before validating the signed-in actor`,
    )
  }
})

test('Firestore rules cannot bypass the atomic course save contract', () => {
  const courseBlock = firestoreRules.match(/match \/courses\/\{courseId\} \{[\s\S]*?match \/quizKeys/)?.[0] ?? ''
  assert.match(courseBlock, /allow create, update, delete: if false;/)
  const quizBlock = firestoreRules.match(/match \/quizKeys\/\{lessonId\} \{[\s\S]*?\n      \}/)?.[0] ?? ''
  assert.match(quizBlock, /allow create, update, delete: if false;/)
  const attemptBlock = firestoreRules.match(/match \/quizAttempts\/\{attemptId\} \{[\s\S]*?\n      \}/)?.[0] ?? ''
  assert.match(attemptBlock, /allow read, write: if false;/)
  const runtimeSource = readFileSync(join(repositoryRoot, 'src', 'services', 'courseRuntimeService.ts'), 'utf8')
  assert.doesNotMatch(runtimeSource + serviceSource, /['"]quizAttempts['"]|\/quizAttempts\//)
})

test('server owns Academy validation and publication transitions', () => {
  assert.match(functionsSource, /function normalizeCourseDraftInput\(value\)/)
  assert.match(functionsSource, /function assertCourseContentSaveStatus\(currentStatus, nextStatus, role, exists\)/)
  assert.match(functionsSource, /function assertCourseReadyToPublish\(course, quizDocuments\)/)
  assert.match(functionsSource, /Nội dung chỉ được chỉnh ở bản nháp hoặc bản đang chờ duyệt/)
  assert.match(functionsSource, /requestedStatus === 'scheduled'/)
  assert.match(functionsSource, /Tính năng lên lịch xuất bản chưa được kích hoạt/)
  assert.match(authoringSource, /normalized\.requestedStatus === 'review'/)
  assert.match(functionsSource, /course\.lessons < 6/)
  assert.match(functionsSource, /lesson\.type === 'Video'.*validResources\.some\(\(resource\) => resource\.kind === 'video'\)/s)
  assert.match(functionsSource, /lesson\.type === 'Bài đọc'/)
  assert.match(functionsSource, /hasReadableBody/)
  assert.match(functionsSource, /validResources\.length !== resources\.length/)
  assert.match(authoringSource, /storage\.pack/)
})

test('publication workflow is server-only, revisioned and fail-closed without a scheduler', () => {
  assert.match(typesSource, /'draft' \| 'review' \| 'approved' \| 'scheduled' \| 'published' \| 'archived'/)
  assert.match(functionsSource, /const academyCoursePublishingSchedulerAvailable = false/)
  const block = functionsSource.match(/exports\.transitionCoursePublicationStatus = onCall[\s\S]*?\n\}\)/)?.[0] ?? ''
  assert.match(block, /return academyAuthoring\.transition\(request\)/)
  assert.match(authoringSource, /adminOnly\(actor\)/)
  assert.match(authoringSource, /nextStatus === 'scheduled' && !schedulerAvailable/)
  assert.match(authoringSource, /'course\.status\.changed'/)
  assert.doesNotMatch(serviceSource.match(/export async function saveCourseDraft\([\s\S]*?\n\}/)?.[0] ?? '', /publish\?: boolean/)
})

test('revision diff is answer-key-free and rollback creates a new draft revision', () => {
  const diffBlock = functionsSource.match(/exports\.getCourseRevisionDiff = onCall[\s\S]*?\n\}\)/)?.[0] ?? ''
  assert.match(diffBlock, /return academyAuthoring\.diff\(request\)/)
  assert.doesNotMatch(diffBlock, /quizKeys/)
  const restoreBlock = functionsSource.match(/exports\.restoreCourseRevisionToDraft = onCall[\s\S]*?\n\}\)/)?.[0] ?? ''
  assert.match(restoreBlock, /return academyAuthoring\.restore\(request\)/)
  assert.doesNotMatch(restoreBlock, /transaction\.update\(revisionReference/)
})

test('Academy editor exposes approval, diff and safe rollback without enabling scheduled publish', () => {
  assert.match(editorSource, /changePublicationStatus\('approved'\)/)
  assert.match(editorSource, /changePublicationStatus\('published'\)/)
  assert.match(editorSource, /Xuất bản lại bản mới nhất/)
  assert.match(editorSource, /Học viên sẽ mất quyền truy cập ngay/)
  assert.match(editorSource, /getCourseRevisionDiff/)
  assert.match(editorSource, /restoreCourseRevisionToDraft/)
  assert.match(editorSource, /Lên lịch — chưa khả dụng/)
  assert.match(editorSource, /disabled title="Chưa có scheduler backend"/)
  assert.match(editorSource, /isContentLocked/)
})

test('atomic quiz keys use the same canonical content hash as grading', () => {
  assert.match(authoringSource, /contentHash: buildQuizContentHash\(gradingDefinition, answers\)/)
  assert.doesNotMatch(authoringSource, /JSON\.stringify\(\{ quiz, answers \}\)/)
})

test('learner Academy payload never exposes answer keys or explanations', () => {
  const serializer = functionsSource.match(/function academyModulesForLearner[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(serializer, /correctIndex: _answerKey/)
  assert.match(serializer, /explanation: _answerExplanation/)
  assert.match(serializer, /provenance: _importProvenance/)
  assert.match(serializer, /source: _resourceProvenance/)
  assert.match(serializer, /return safeQuestion/)
})

test('client does not write a course before recording its revision', () => {
  const block = serviceSource.match(/export async function saveCourseDraft\([\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(block, /'saveCourseDraftAtomic'/)
  assert.match(block, /input\.revision/)
  assert.match(block, /return response\.data/)
  assert.match(block, /functions\/aborted/)
  assert.doesNotMatch(block, /batch\.commit\(\)/)
  assert.doesNotMatch(block, /recordCourseRevision/)
})

test('sample courses cannot mask empty or failed Firebase data in production', () => {
  assert.match(serviceSource, /academyDemoFallbackEnabled = import\.meta\.env\.DEV \|\| import\.meta\.env\.MODE === 'e2e'/)
  assert.match(serviceSource, /academyDemoFallbackEnabled \? demoCourses : \[\]/)
  assert.match(hookSource, /const EMPTY_COURSES: Course\[\] = \[\]/)
  assert.match(hookSource, /setItems\(academyDemoFallbackEnabled \? demoCourses : EMPTY_COURSES\)/)
  assert.doesNotMatch(hookSource, /setItems\(demoCourses\)/)
})
