import { readFile } from 'node:fs/promises'
import { after, before, describe, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { getBytes, ref, uploadBytes } from 'firebase/storage'

const projectId = 'demo-aura-fitness-storage'
const rulesPath = new URL('../storage.rules', import.meta.url)
const validImage = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

let testEnvironment

function storageFor(uid, role) {
  return testEnvironment.authenticatedContext(uid, { role }).storage()
}

function uploadCover(storage, courseId, name, bytes = validImage, options = {}) {
  return uploadBytes(ref(storage, `public-assets/course-covers/${courseId}/${name}`), bytes, {
    contentType: options.contentType ?? 'image/jpeg',
    customMetadata: {
      courseId: options.metadataCourseId ?? courseId,
      uploadedBy: options.uploadedBy ?? 'editor-1',
    },
  })
}

function uploadExerciseImage(storage, exerciseId, mediaId, options = {}) {
  return uploadBytes(ref(storage, `exercise-catalog/${exerciseId}/${mediaId}.webp`), validImage, {
    contentType: options.contentType ?? 'image/webp',
    customMetadata: {
      resourceKind: options.resourceKind ?? 'exercise-image',
      exerciseId: options.metadataExerciseId ?? exerciseId,
      mediaId: options.metadataMediaId ?? mediaId,
      uploadedBy: options.uploadedBy ?? 'editor-1',
    },
  })
}

function uploadPrivateCoachImage(storage, userId, scanId, purpose) {
  return uploadBytes(ref(storage, `nutrition-scans/${userId}/${scanId}/original.jpg`), validImage, {
    contentType: 'image/jpeg',
    customMetadata: {
      ownerUid: userId,
      scanId,
      purpose,
    },
  })
}

function uploadProgressPhoto(storage, userId, fileName = 'photo-123.jpg', metadataOwner = userId) {
  return uploadBytes(ref(storage, `users/${userId}/progress-photos/${fileName}`), validImage, {
    contentType: 'image/jpeg',
    customMetadata: { ownerUid: metadataOwner, resourceKind: 'progress-photo' },
  })
}

function uploadMealPhoto(storage, userId, mealId = 'meal-123', metadataOwner = userId) {
  return uploadBytes(ref(storage, `users/${userId}/meal-photos/${mealId}/original.jpg`), validImage, {
    contentType: 'image/jpeg',
    customMetadata: { ownerUid: metadataOwner, mealId, resourceKind: 'nutrition-meal-photo' },
  })
}

function uploadPerformanceEvidence(storage, userId, periodId = '2026-09', evidenceId = 'evidence_12345678', metadataOwner = userId) {
  return uploadBytes(ref(storage, `performance-evidence/${userId}/${periodId}/${evidenceId}/proof.jpg`), validImage, {
    contentType: 'image/jpeg',
    customMetadata: { ownerUid: metadataOwner, periodId, evidenceId, resourceKind: 'performance-evidence' },
  })
}

describe('Aura Academy Storage rules', () => {
  before(async () => {
    testEnvironment = await initializeTestEnvironment({
      projectId,
      storage: { rules: await readFile(rulesPath, 'utf8') },
    })
  })

  after(async () => {
    await testEnvironment.cleanup()
  })

  test('Academy staff can upload a valid cover and the catalog can read it', async () => {
    const staffStorage = storageFor('editor-1', 'editor')
    const path = `course-${Date.now()}`
    const uploaded = await assertSucceeds(uploadCover(staffStorage, path, 'cover.jpg'))
    const publicStorage = testEnvironment.unauthenticatedContext().storage()
    await assertSucceeds(getBytes(ref(publicStorage, uploaded.ref.fullPath)))
  })

  test('students, unsupported images and forged metadata are denied', async () => {
    const studentStorage = storageFor('student-1', 'student')
    const editorStorage = storageFor('editor-1', 'editor')
    await assertFails(uploadCover(studentStorage, 'course-student', 'cover.jpg', validImage, { uploadedBy: 'student-1' }))
    await assertFails(uploadCover(editorStorage, 'course-gif', 'cover.gif', validImage, { contentType: 'image/gif' }))
    await assertFails(uploadCover(editorStorage, 'course-meta', 'cover.jpg', validImage, { metadataCourseId: 'another-course' }))
    await assertFails(uploadCover(editorStorage, 'course-owner', 'cover.jpg', validImage, { uploadedBy: 'someone-else' }))
  })

  test('cover uploads larger than five MiB are denied', async () => {
    const editorStorage = storageFor('editor-1', 'editor')
    await assertFails(uploadCover(editorStorage, 'course-large', 'cover.jpg', new Uint8Array(5 * 1024 * 1024 + 1)))
  })

  test('catalog staff can upload immutable WebP exercise images', async () => {
    const editorStorage = storageFor('editor-1', 'editor')
    const uploaded = await assertSucceeds(uploadExerciseImage(editorStorage, 'aura_hip_thrust', 'media-12345678'))
    await assertSucceeds(getBytes(ref(storageFor('student-1', 'student'), uploaded.ref.fullPath)))
  })

  test('exercise image uploads reject students, forged metadata and unsupported formats', async () => {
    await assertFails(uploadExerciseImage(storageFor('student-1', 'student'), 'aura_squat', 'media-student', { uploadedBy: 'student-1' }))
    await assertFails(uploadExerciseImage(storageFor('editor-1', 'editor'), 'aura_squat', 'media-forged', { metadataExerciseId: 'another-exercise' }))
    await assertFails(uploadExerciseImage(storageFor('editor-1', 'editor'), 'aura_squat', 'media-jpeg', { contentType: 'image/jpeg' }))
  })

  test('learners can upload only actor-owned temporary food and AI Coach images', async () => {
    const studentStorage = storageFor('student-1', 'student')
    await assertSucceeds(uploadPrivateCoachImage(studentStorage, 'student-1', 'scan_food_123', 'food-analysis'))
    await assertSucceeds(uploadPrivateCoachImage(studentStorage, 'student-1', 'scan_body_123', 'ai-coach-body'))
    await assertSucceeds(uploadPrivateCoachImage(studentStorage, 'student-1', 'scan_meal_123', 'ai-coach-meal'))
    await assertFails(uploadPrivateCoachImage(studentStorage, 'student-2', 'scan_cross_123', 'ai-coach-body'))
    await assertFails(uploadPrivateCoachImage(studentStorage, 'student-1', 'scan_bad_1234', 'profile-photo'))
  })

  test('progress photos are owner-written and Staff must use the scoped Student 360 API', async () => {
    const uploaded = await assertSucceeds(uploadProgressPhoto(storageFor('student-1', 'student'), 'student-1'))
    await assertFails(uploadProgressPhoto(storageFor('student-1', 'student'), 'student-2'))
    await assertFails(uploadProgressPhoto(storageFor('student-1', 'student'), 'student-1', 'forged.jpg', 'student-2'))
    await assertFails(getBytes(ref(storageFor('trainer-1', 'trainer'), uploaded.ref.fullPath)))
    await assertSucceeds(getBytes(ref(storageFor('admin-1', 'admin'), uploaded.ref.fullPath)))
  })

  test('meal photos are private, immutable and owner-uploaded with canonical metadata', async () => {
    const studentStorage = storageFor('student-1', 'student')
    const mealId = `meal-${Date.now()}`
    const uploaded = await assertSucceeds(uploadMealPhoto(studentStorage, 'student-1', mealId))
    await assertSucceeds(getBytes(ref(studentStorage, uploaded.ref.fullPath)))
    await assertFails(getBytes(ref(storageFor('trainer-1', 'trainer'), uploaded.ref.fullPath)))
    await assertFails(getBytes(ref(storageFor('admin-1', 'admin'), uploaded.ref.fullPath)))
    await assertFails(uploadMealPhoto(studentStorage, 'student-2', `${mealId}-cross`))
    await assertFails(uploadMealPhoto(studentStorage, 'student-1', `${mealId}-forged`, 'student-2'))
    await assertFails(uploadMealPhoto(studentStorage, 'student-1', mealId))
  })

  test('Brand evidence is immutable, owner-uploaded and manager reads use signed URLs', async () => {
    const trainerStorage = storageFor('trainer-1', 'trainer')
    const uploaded = await assertSucceeds(uploadPerformanceEvidence(trainerStorage, 'trainer-1'))
    await assertFails(uploadPerformanceEvidence(trainerStorage, 'trainer-2', '2026-09', 'evidence_cross_123'))
    await assertFails(uploadPerformanceEvidence(trainerStorage, 'trainer-1', '2026-09', 'evidence_forged_123', 'trainer-2'))
    await assertSucceeds(getBytes(ref(trainerStorage, uploaded.ref.fullPath)))
    await assertFails(getBytes(ref(storageFor('manager-1', 'manager'), uploaded.ref.fullPath)))
    await assertSucceeds(getBytes(ref(storageFor('admin-1', 'admin'), uploaded.ref.fullPath)))
  })
})
