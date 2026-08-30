const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(path.join(__dirname, 'exercise-catalog.js'), 'utf8')
const indexSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
const importer = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'import-free-exercise-catalog.cjs'), 'utf8')
const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'exerciseCatalogService.ts'), 'utf8')
const managerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'exercise-catalog', 'ExerciseCatalogManager.tsx'), 'utf8')
const managerStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'exercise-catalog', 'ExerciseCatalogManager.css'), 'utf8')
const studentLibrarySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'student', 'StudentPtWorkoutPage.tsx'), 'utf8')
const trainerWorkspaceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'operations', 'PtWorkoutWorkspacePage.tsx'), 'utf8')

test('exercise catalog is authenticated, review-gated and revisioned', () => {
  assert.match(source, /if \(!uid\) throw new HttpsError\('unauthenticated'/)
  assert.match(source, /includeReview === true && actor\.isStaff/)
  assert.match(source, /item\.status !== 'published'/)
  assert.match(source, /expectedRevision/)
  assert.match(source, /collection\('revisions'\)/)
  assert.match(source, /current\.status === 'published'/)
  assert.match(source, /workingDraftRevision/)
  assert.match(source, /revisionType: 'working_draft'/)
  assert.match(source, /workingDraft: FieldValue\.delete\(\)/)
})

test('catalog import is public-domain, target-only and dry-run by default', () => {
  assert.match(importer, /yuhonas\/free-exercise-db/)
  assert.match(importer, /license: 'Unlicense'/)
  assert.match(importer, /const result = \{ mode: 'dry-run' \}/)
  assert.match(importer, /status: 'review'/)
  assert.match(importer, /selected\.length !== 120/)
  assert.match(importer, /IMPORT_FREE_EXERCISE_CATALOG_V1/)
  assert.doesNotMatch(importer, /gen-lang-client-0246058381/)
})

test('catalog callables are statically deployable', () => {
  for (const name of ['listExerciseCatalog', 'getExerciseCatalogItem', 'saveExerciseCatalogDraft', 'publishExerciseCatalogItem']) {
    assert.match(indexSource, new RegExp(`exports\\.${name} = exerciseCatalogFunctions\\.${name}`))
  }
})

test('catalog detail remains readable across staged backend rollouts', () => {
  assert.match(source, /sourceExerciseId: text\(data\.source\?\.sourceExerciseId, 160\) \|\| id/)
  assert.match(source, /editItem: editableItem\(snapshot, actor\)/)
  assert.match(serviceSource, /parseCatalogItem\(payload\?\.editItem\) \|\| item/)
})

test('catalog highlights women recommendations and provides mobile master-detail navigation', () => {
  assert.match(managerSource, /popularForWomenIds/)
  assert.match(managerSource, /Nữ hay chọn/)
  assert.match(managerSource, /Danh sách bài tập/)
  assert.match(managerSource, /has-mobile-detail/)
  assert.match(managerStyles, /@media\(max-width:760px\).*has-mobile-detail/s)
})

test('admin, trainer and learner catalogs share canonical muscle group filters', () => {
  assert.match(managerSource, /exerciseMuscleGroupOptions/)
  assert.match(managerSource, /Lọc thư viện theo nhóm cơ/)
  assert.match(studentLibrarySource, /exerciseMatchesMuscleGroup/)
  assert.match(studentLibrarySource, /Lọc theo nhóm cơ/)
  assert.match(trainerWorkspaceSource, /exerciseMuscleGroupOptions/)
  assert.match(trainerWorkspaceSource, /Lọc bài tập theo nhóm cơ/)
})

test('catalog editor uses a five-step wizard and local image uploads', () => {
  assert.match(managerSource, /const wizardSteps = \[/)
  for (const label of ['Thông tin', 'Kỹ thuật', 'Giáo án', 'Hình ảnh', 'Xem lại']) assert.match(managerSource, new RegExp(label))
  assert.match(managerSource, /uploadExerciseCatalogImage/)
  assert.match(managerSource, /MediaCarousel/)
  assert.match(managerSource, /onPointerDown/)
  assert.match(managerSource, /tự động lưu/)
  assert.match(managerStyles, /transition:transform \.24s/)
  assert.match(source, /function normalizedMedia/)
  assert.match(source, /posterImageId/)
  assert.match(serviceSource, /images: mediaImages\(media\?\.images\)/)
})
