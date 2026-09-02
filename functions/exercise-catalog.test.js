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
const exercisedbWomenImporter = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'import-exercisedb-women-catalog.cjs'), 'utf8')
const mediaPlayerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'exercise-catalog', 'ExerciseMediaPlayer.tsx'), 'utf8')
const unifiedMediaSync = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sync-unified-exercise-media.cjs'), 'utf8')
const sourceComparison = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'compare-exercise-sources.cjs'), 'utf8')
const releaseScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-free-exercise-catalog.cjs'), 'utf8')

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
  for (const name of ['listExerciseCatalog', 'getExerciseCatalogItem', 'searchExternalExerciseCatalog', 'getExternalExercisePreview', 'getExerciseCatalogMedia', 'saveExerciseCatalogDraft', 'publishExerciseCatalogItem']) {
    assert.match(indexSource, new RegExp(`exports\\.${name} = exerciseCatalogFunctions\\.${name}`))
  }
})

test('external exercise provider remains server-only and never persists signed media urls', () => {
  assert.match(source, /defineSecret\('YMOVE_API_KEY'/)
  assert.match(source, /AURA_PROVIDER_DISABLED/)
  assert.match(source, /secrets: \[YMOVE_API_KEY\]/)
  assert.match(source, /'X-API-Key': apiKey/)
  assert.match(source, /durableVideoProviders = new Set\(\['aura', 'ymove_free', 'exercisedb', 'programme'\]\)/)
  assert.match(source, /const url = durableVideoProviders\.has\(provider\) \? text\(entry\.url/)
  assert.match(source, /normalizedExternalMedia\(raw\.externalMedia\)/)
  assert.match(source, /transientMedia: true/)
  assert.doesNotMatch(managerSource, /VITE_YMOVE/)
})

test('catalog editor can search, preview and link provider media without replacing Vietnamese instructions', () => {
  assert.match(managerSource, /searchExternalExerciseCatalog/)
  assert.match(managerSource, /getExternalExercisePreview/)
  assert.match(managerSource, /Kho media bài tập/)
  assert.match(managerSource, /PT-reviewed Vietnamese content is never overwritten/)
  assert.match(managerSource, /externalMedia: \{/)
  assert.match(managerSource, /ExerciseDB Free/)
  assert.match(managerSource, /YMove miễn phí/)
})

test('free providers expose ExerciseDB GIFs and the public 25-video YMove library without API keys', () => {
  assert.match(source, /EXERCISEDB_API_BASE_URL = 'https:\/\/oss\.exercisedb\.dev\/api\/v1'/)
  assert.match(source, /YMOVE_FREE_LIBRARY_URL = 'https:\/\/ymove\.app\/free-exercise-videos'/)
  assert.match(source, /async function fetchExerciseDb/)
  assert.match(source, /async function fetchYMoveFreeLibrary/)
  assert.match(source, /payload\?\.props\?\.pageProps\?\.exercises/)
  assert.match(source, /provider === 'exercisedb'/)
  assert.match(source, /provider === 'ymove_free'/)
  assert.match(source, /Free-commercial-embed/)
})

test('curated ExerciseDB women catalog is translated, classified and learner-published', () => {
  assert.match(exercisedbWomenImporter, /const RELEASE = 'exercisedb-women-120-v3'/)
  assert.match(exercisedbWomenImporter, /if \(items\.length !== 120\)/)
  assert.match(exercisedbWomenImporter, /popularForWomen: true/)
  assert.match(exercisedbWomenImporter, /sourceAttribution: SOURCE_ATTRIBUTION/)
  assert.match(exercisedbWomenImporter, /license: 'External-provider'/)
  assert.match(exercisedbWomenImporter, /instructionsVi\.length < 4/)
  assert.match(exercisedbWomenImporter, /allowOwnedUpdates: true/)
  assert.match(exercisedbWomenImporter, /previousRelease: 'exercisedb-women-120-v2'/)
})

test('catalog detail remains readable across staged backend rollouts', () => {
  assert.match(source, /sourceExerciseId: text\(data\.source\?\.sourceExerciseId, 160\) \|\| id/)
  assert.match(source, /editItem: editableItem\(snapshot, actor\)/)
  assert.match(serviceSource, /parseCatalogItem\(payload\?\.editItem\) \|\| item/)
})

test('learner exercise detail keeps every coaching section on mobile', () => {
  assert.match(studentLibrarySource, /item\.instructionsVi\.map/)
  assert.match(studentLibrarySource, /item\.cuesVi\.map/)
  assert.match(studentLibrarySource, /item\.commonMistakesVi\.map/)
  assert.match(studentLibrarySource, /student-library__bullet-list/)
  assert.match(managerStyles, /has-mobile-detail/)
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

test('exercise media keeps the complete gallery and safely unifies stills with ExerciseDB GIFs', () => {
  assert.doesNotMatch(source, /mediaImages[\s\S]*?\.slice\(0, 12\)/)
  assert.doesNotMatch(serviceSource, /function mediaImages[\s\S]*?\.slice\(0, 12\)/)
  assert.doesNotMatch(mediaPlayerSource, /media\.images[^\n]*\.slice\(0, 12\)/)
  assert.doesNotMatch(managerSource, /12 - mediaImages\(draft\.media\)\.length/)
  assert.match(unifiedMediaSync, /extract-exercise-gif-frames\.py/)
  assert.match(unifiedMediaSync, /DEPRECATED_MEDIA_REPLACEMENTS/)
  assert.match(unifiedMediaSync, /nextAvailableRevision/)
  assert.match(unifiedMediaSync, /sourceAttribution/)
  assert.match(source, /validExerciseImageStoragePath/)
  assert.match(source, /parts\.length === 4 && parts\[0\] === 'exercise-catalog' && parts\[1\] === 'exercisedb'/)
  assert.match(source, /parts\.length === 3 && parts\[0\] === 'exercise-catalog' && parts\[1\] === 'ymove-free'/)
  assert.match(source, /const hasAnimatedVideo = videos\.some/)
  assert.match(source, /const stillImages = hasAnimatedVideo \? rawImages\.filter/)
  assert.match(source, /startImageUrl: startImage\?\.url \|\| text\(rawMedia\?\.startImageUrl/)
  assert.match(source, /posterUrl: posterImage\?\.url \|\| text\(rawMedia\?\.posterUrl/)
  assert.match(unifiedMediaSync, /legacyImages\(entry\.target\)\.filter\(\(image\) => !isAnimatedImageUrl/)
})

test('Free Exercise DB is canonical and ExerciseDB V1 is a reviewed GIF fallback', () => {
  assert.match(sourceComparison, /Free Exercise DB là nguồn bài tập chính; ExerciseDB Free V1 chỉ là nguồn GIF\/bổ sung/)
  assert.match(sourceComparison, /freeCanonicalWithExerciseDbGif/)
  assert.match(sourceComparison, /exerciseDbWomenFallbackCandidates/)
  assert.match(unifiedMediaSync, /item\.data\.source\?\.provider !== 'free-exercise-db'/)
  assert.match(unifiedMediaSync, /method: 'exact-normalized-name'/)
  assert.match(unifiedMediaSync, /const targets = catalog\.filter\(\(item\) => item\.data\.status === 'published' && item\.data\.source\?\.provider === 'free-exercise-db'/)
})

test('the learner release is a guarded 120-item Free Exercise DB catalog', () => {
  assert.match(releaseScript, /const TARGET_CANONICAL_COUNT = 120/)
  assert.match(releaseScript, /source: \{ provider: 'free-exercise-db'/)
  assert.match(releaseScript, /archiveExerciseDb/)
  assert.match(releaseScript, /status: 'archived'/)
  assert.match(releaseScript, /media\.images\.length < 2/)
  assert.match(releaseScript, /instructionsVi\.length < 4/)
  assert.match(releaseScript, /ARCHIVE_EDB_AND_PUBLISH_FREE_2026_V1/)
  assert.match(releaseScript, /currentDocument: \{ updateTime: document\.updateTime \}/)
})

test('media reconciliation report exposes normalized name matches', () => {
  assert.match(unifiedMediaSync, /entry\.method === 'exact-normalized-name' \|\| entry\.method === 'name'/)
  assert.match(unifiedMediaSync, /method: entry\.method/)
})

test('exercise media player reliably plays selected videos and falls back from broken sources', () => {
  assert.match(mediaPlayerSource, /function isAnimatedImageVideo/)
  assert.match(mediaPlayerSource, /function mergeRemoteAndLocalVideos/)
  assert.match(mediaPlayerSource, /preload="metadata"/)
  assert.match(mediaPlayerSource, /autoPlay=\{active\.key === autoPlayKey\}/)
  assert.match(mediaPlayerSource, /ref=\{videoRef\}/)
  assert.match(mediaPlayerSource, /onError=\{\(\) => failMedia\(active\.key\)\}/)
  assert.match(mediaPlayerSource, /Phát video/)
  assert.match(mediaPlayerSource, /Phát lại/)
})
