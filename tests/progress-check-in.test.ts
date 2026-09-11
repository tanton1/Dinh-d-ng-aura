import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const service = readFileSync(new URL('../src/services/firebaseProgressService.ts', import.meta.url), 'utf8')
const studio = readFileSync(new URL('../src/pages/student/ProgressPhotoStudio.tsx', import.meta.url), 'utf8')
const progressPage = readFileSync(new URL('../src/pages/student/ProgressPage.tsx', import.meta.url), 'utf8')

test('one progress check-in atomically projects measurements, weight and grouped photos', () => {
  const operation = service.slice(
    service.indexOf('export async function saveUserProgressCheckIn'),
    service.indexOf('export async function saveUserGamification'),
  )
  assert.match(operation, /const batch = writeBatch\(database\)/)
  assert.match(operation, /'progressCheckIns', input\.id/)
  assert.match(operation, /'bodyMeasurements', 'current'/)
  assert.match(operation, /'bodyMeasurements', input\.id/)
  assert.match(operation, /'weightLogs', input\.id/)
  assert.match(operation, /'progressPhotos', photo\.id/)
  assert.match(operation, /schemaVersion: 1/)
  assert.match(operation, /checkInId: input\.id/)
  assert.match(operation, /await batch\.commit\(\)/)
})

test('progress entry form supports four photo angles and all requested body measurements', () => {
  for (const angle of ['front', 'back', 'left', 'right']) assert.match(studio, new RegExp(`id: '${angle}'`))
  for (const field of ['weightKg', 'waistCm', 'hipsCm', 'thighCm', 'armCm', 'chestCm']) assert.match(studio, new RegExp(field))
  assert.match(studio, /Mỗi lần ghi nhận hỗ trợ tối đa 4 góc ảnh|4 ảnh/)
})

test('progress body surface uses the combined card instead of separate photo and measurement cards', () => {
  assert.match(progressPage, /\['overview', 'Tổng quan'\]/)
  assert.match(progressPage, /\['body', 'Cơ thể'\]/)
  assert.match(progressPage, /\['history', 'Nhật ký'\]/)
  assert.match(progressPage, /<JourneyHero/)
  assert.match(progressPage, /<CheckInHistory/)
  assert.match(progressPage, /getMyLoyaltyDashboard/)
  assert.match(progressPage, /Aura Club/)
  assert.doesNotMatch(progressPage, /<ProgressPhotosCard/)
  assert.doesNotMatch(progressPage, /<BodyMeasurementsModal/)
  assert.doesNotMatch(progressPage, /<StreaksAndBadgesCard/)
  assert.doesNotMatch(progressPage, /<DailyActionsCard/)
  assert.doesNotMatch(progressPage, /<NutritionChartsCard/)
})

test('progress check-in normalizes camera images before parallel upload and keeps retry state', () => {
  const studioSource = readFileSync(new URL('../src/pages/student/ProgressPhotoStudio.tsx', import.meta.url), 'utf8')
  assert.match(studioSource, /export async function prepareProgressPhoto/)
  assert.match(studioSource, /canvas\.toBlob\(resolve, 'image\/jpeg'/)
  assert.match(studioSource, /Promise\.allSettled\(preparedEntries\.map/)
  assert.match(studioSource, /Ảnh và số đo vẫn được giữ/)
})

test('Admin and Staff save a scoped learner check-in through Student 360', () => {
  const application = readFileSync(new URL('../src/AuraApplication.tsx', import.meta.url), 'utf8')
  const student360 = readFileSync(new URL('../src/features/student-360/Student360Page.tsx', import.meta.url), 'utf8')
  const service = readFileSync(new URL('../src/features/student-360/student360Service.ts', import.meta.url), 'utf8')
  assert.match(application, /targetStudentId=\{staffEditor \? route\.studentId : null\}/)
  assert.match(student360, /permissions\.canManageProgress/)
  assert.match(student360, /onNavigate\('progress-photo-studio', studentId, identity\.name\)/)
  assert.match(service, /saveStudent360ProgressCheckInRegional/)
  assert.match(studio, /isStaffEditor && targetStudentId/)
})
