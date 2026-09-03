'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const repositoryRoot = join(__dirname, '..')
const functionsSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
const serviceSource = readFileSync(join(repositoryRoot, 'src', 'services', 'firebaseService.ts'), 'utf8')
const editorSource = readFileSync(join(repositoryRoot, 'src', 'pages', 'admin', 'CourseEditorPage.tsx'), 'utf8')
const typesSource = readFileSync(join(repositoryRoot, 'src', 'types.ts'), 'utf8')
const hookSource = readFileSync(join(repositoryRoot, 'src', 'hooks', 'useCourses.ts'), 'utf8')
const storageRules = readFileSync(join(repositoryRoot, 'storage.rules'), 'utf8')
const firestoreRules = readFileSync(join(repositoryRoot, 'firestore.rules'), 'utf8')
const firebaseConfig = JSON.parse(readFileSync(join(repositoryRoot, 'firebase.json'), 'utf8'))
const appletConfig = JSON.parse(readFileSync(join(repositoryRoot, 'firebase-applet-config.json'), 'utf8'))
const serverSource = readFileSync(join(repositoryRoot, 'server.ts'), 'utf8')

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

test('Academy save is one server transaction with optimistic concurrency', () => {
  const block = functionsSource.match(/exports\.saveCourseDraftAtomic = onCall[\s\S]*?return \{ courseId: normalized\.identifier, revision: savedRevision, status: normalized\.requestedStatus \}\s*\}\)/)?.[0] ?? ''
  assert.match(block, /requireTrustedAcademyStaffContext\(request\)/)
  assert.match(block, /normalizeCourseDraftInput\(request\.data\?\.course\)/)
  assert.match(block, /Number\.isInteger\(expectedRevision\)/)
  assert.match(block, /currentRevision !== expectedRevision/)
  assert.match(block, /new HttpsError\(\s*'aborted'/)
  assert.match(block, /db\.runTransaction\(async \(transaction\) =>/)
  assert.match(block, /transaction\.set\(courseReference, nextCourse\)/)
  assert.match(block, /transaction\.set\(courseReference\.collection\('quizKeys'\)/)
  assert.match(block, /transaction\.create\(db\.doc\(`courseRevisions\/\$\{revisionId\}`\)/)
  assert.match(block, /transaction\.set\(db\.collection\('auditLogs'\)\.doc\(\)/)
  assert.match(block, /Buffer\.byteLength\(revisionPayload, 'utf8'\) > 750 \* 1024/)
})

test('Firestore rules cannot bypass the atomic course save contract', () => {
  const courseBlock = firestoreRules.match(/match \/courses\/\{courseId\} \{[\s\S]*?match \/quizKeys/)?.[0] ?? ''
  assert.match(courseBlock, /allow create, update, delete: if false;/)
  const quizBlock = firestoreRules.match(/match \/quizKeys\/\{lessonId\} \{[\s\S]*?\n      \}/)?.[0] ?? ''
  assert.match(quizBlock, /allow create, update, delete: if false;/)
})

test('server owns Academy validation and publication transitions', () => {
  assert.match(functionsSource, /function normalizeCourseDraftInput\(value\)/)
  assert.match(functionsSource, /function assertCourseContentSaveStatus\(currentStatus, nextStatus, role, exists\)/)
  assert.match(functionsSource, /function assertCourseReadyToPublish\(course, quizDocuments\)/)
  assert.match(functionsSource, /Nội dung chỉ được chỉnh ở bản nháp hoặc bản đang chờ duyệt/)
  assert.match(functionsSource, /requestedStatus === 'scheduled'/)
  assert.match(functionsSource, /Tính năng lên lịch xuất bản chưa được kích hoạt/)
  assert.match(functionsSource, /normalized\.requestedStatus === 'review'/)
  assert.match(functionsSource, /course\.lessons < 6/)
  assert.match(functionsSource, /lesson\.type === 'Video'.*validResources\.some\(\(resource\) => resource\.kind === 'video'\)/s)
  assert.match(functionsSource, /lesson\.type === 'Bài đọc'/)
  assert.match(functionsSource, /hasReadableBody/)
  assert.match(functionsSource, /validResources\.length !== resources\.length/)
  assert.match(functionsSource, /quizKeys: revisionQuizKeys/)
})

test('publication workflow is server-only, revisioned and fail-closed without a scheduler', () => {
  assert.match(typesSource, /'draft' \| 'review' \| 'approved' \| 'scheduled' \| 'published' \| 'archived'/)
  assert.match(functionsSource, /const academyCoursePublishingSchedulerAvailable = false/)
  const block = functionsSource.match(/exports\.transitionCoursePublicationStatus = onCall[\s\S]*?return \{ courseId: targetCourseId, revision: nextRevision, status: nextStatus \}\s*\}\)/)?.[0] ?? ''
  assert.match(block, /privilegedAdminRoles\.has\(actor\.role\)/)
  assert.match(block, /review: new Set\(\['approved'\]\)/)
  assert.match(block, /approved: new Set\(academyCoursePublishingSchedulerAvailable \? \['scheduled', 'published'\] : \['published'\]\)/)
  assert.match(block, /published: new Set\(\['archived'\]\)/)
  assert.match(block, /archived: new Set\(\['published'\]\)/)
  assert.match(block, /archivedAt: FieldValue\.delete\(\)/)
  assert.match(block, /currentRevision !== expectedRevision/)
  assert.match(block, /new HttpsError\(\s*'aborted'/)
  assert.match(block, /transaction\.update\(courseReference/)
  assert.match(block, /transaction\.create\(db\.doc\(`courseRevisions/)
  assert.match(block, /action: 'course\.status\.changed'/)
  assert.doesNotMatch(serviceSource.match(/export async function saveCourseDraft\([\s\S]*?\n\}/)?.[0] ?? '', /publish\?: boolean/)
})

test('revision diff is answer-key-free and rollback creates a new draft revision', () => {
  const diffBlock = functionsSource.match(/exports\.getCourseRevisionDiff = onCall[\s\S]*?\n\}\)/)?.[0] ?? ''
  assert.match(diffBlock, /buildCourseRevisionDiff\(fromCourse, toCourse\)/)
  assert.doesNotMatch(diffBlock, /quizKeys/)
  const restoreBlock = functionsSource.match(/exports\.restoreCourseRevisionToDraft = onCall[\s\S]*?return \{ courseId: targetCourseId, revision: nextRevision, status: 'draft', restoredFromRevision: sourceRevision \}\s*\}\)/)?.[0] ?? ''
  assert.match(restoreBlock, /currentRevision !== expectedRevision/)
  assert.match(restoreBlock, /new HttpsError\('aborted'/)
  assert.match(restoreBlock, /nextRevision = currentRevision \+ 1/)
  assert.match(restoreBlock, /status: 'draft'/)
  assert.match(restoreBlock, /restoredFromRevision: sourceRevision/)
  assert.match(restoreBlock, /transaction\.create\(db\.doc\(`courseRevisions/)
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
  const saveBlock = functionsSource.match(/exports\.saveCourseDraftAtomic = onCall[\s\S]*?return \{ courseId: normalized\.identifier, revision: savedRevision, status: normalized\.requestedStatus \}\s*\}\)/)?.[0] ?? ''
  assert.match(saveBlock, /const contentHash = buildQuizContentHash\(quiz, answers\)/)
  assert.doesNotMatch(saveBlock, /JSON\.stringify\(\{ quiz, answers \}\)/)
})

test('learner Academy payload never exposes answer keys or explanations', () => {
  const serializer = functionsSource.match(/function academyModulesForLearner[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(serializer, /correctIndex: _answerKey/)
  assert.match(serializer, /explanation: _answerExplanation/)
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
  assert.match(hookSource, /academyDemoFallbackEnabled \? demoCourses : \[\]/)
  assert.doesNotMatch(hookSource, /setItems\(demoCourses\)/)
})
