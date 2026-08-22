const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')

const staffRoles = new Set(['coach', 'trainer', 'editor', 'admin', 'super_admin'])
const publishRoles = new Set(['admin', 'super_admin'])

function text(value, maximum = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function stringList(value, maximum = 30, itemMaximum = 300) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim().slice(0, itemMaximum)))].slice(0, maximum)
    : []
}

function safeId(value) {
  const id = text(value, 160)
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new HttpsError('invalid-argument', 'Mã bài tập không hợp lệ.')
  return id
}

async function actorContext(request, db) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập để xem kho bài tập.')
  const token = request.auth.token || {}
  const [profileSnapshot, assignmentSnapshot] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`roleAssignments/${uid}`).get(),
  ])
  if (!profileSnapshot.exists || profileSnapshot.data()?.disabled === true) throw new HttpsError('permission-denied', 'Tài khoản không còn hoạt động.')
  if (assignmentSnapshot.exists) {
    const assignment = assignmentSnapshot.data()
    if (assignment.status !== 'active' || token.accessRole !== assignment.accessRole || Number(token.authzVersion) !== Number(assignment.authzVersion)) {
      throw new HttpsError('permission-denied', 'Quyền tài khoản chưa đồng bộ.')
    }
    return { uid, isStaff: ['staff', 'admin', 'super_admin'].includes(assignment.accessRole), canPublish: publishRoles.has(assignment.accessRole) }
  }
  const role = typeof token.role === 'string' ? token.role : 'student'
  const profileRole = profileSnapshot.data().role === 'user' ? 'student' : profileSnapshot.data().role
  if ((role === 'user' ? 'student' : role) !== profileRole) throw new HttpsError('permission-denied', 'Quyền tài khoản chưa đồng bộ.')
  return { uid, isStaff: staffRoles.has(role), canPublish: publishRoles.has(role) }
}

function publicItem(snapshot) {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    schemaVersion: 1,
    revision: Number.isInteger(data.revision) ? data.revision : 1,
    status: ['draft', 'review', 'published', 'archived'].includes(data.status) ? data.status : 'draft',
    nameVi: text(data.nameVi || data.nameEn, 200), nameEn: text(data.nameEn, 200), aliasesVi: stringList(data.aliasesVi, 12, 100),
    bodyParts: stringList(data.bodyParts, 12, 80), targetMuscles: stringList(data.targetMuscles, 12, 80), secondaryMuscles: stringList(data.secondaryMuscles, 12, 80),
    equipment: stringList(data.equipment, 12, 80), environment: stringList(data.environment, 2, 20),
    difficulty: ['beginner', 'intermediate', 'advanced'].includes(data.difficulty) ? data.difficulty : 'beginner', goals: stringList(data.goals, 12, 80),
    instructionsVi: stringList(data.instructionsVi, 20, 600), cuesVi: stringList(data.cuesVi, 12, 300), commonMistakesVi: stringList(data.commonMistakesVi, 12, 300), breathingVi: text(data.breathingVi, 500),
    media: {
      startImageUrl: text(data.media?.startImageUrl, 2_000), endImageUrl: text(data.media?.endImageUrl, 2_000), posterUrl: text(data.media?.posterUrl, 2_000),
      animationUrl: text(data.media?.animationUrl, 2_000), mimeType: text(data.media?.mimeType, 100), checksum: text(data.media?.checksum, 128),
    },
    defaultPrescription: {
      sets: Number.isInteger(data.defaultPrescription?.sets) ? data.defaultPrescription.sets : 3,
      reps: text(data.defaultPrescription?.reps, 40) || '10–12',
      restSeconds: Number.isInteger(data.defaultPrescription?.restSeconds) ? data.defaultPrescription.restSeconds : 60,
      rpe: Number.isInteger(data.defaultPrescription?.rpe) ? data.defaultPrescription.rpe : 7,
    },
    source: {
      provider: data.source?.provider === 'aura' ? 'aura' : 'free-exercise-db', sourceExerciseId: text(data.source?.sourceExerciseId, 160) || snapshot.id,
      sourceVersion: text(data.source?.sourceVersion, 100) || 'unknown', license: data.source?.license === 'Aura-owned' ? 'Aura-owned' : 'Unlicense',
    },
    sourceAttribution: text(data.sourceAttribution, 300) || 'Free Exercise DB · Unlicense',
  }
}

function normalizeDraft(raw, current = {}) {
  const nameVi = text(raw.nameVi, 200)
  const nameEn = text(raw.nameEn, 200)
  if (!nameVi || !nameEn) throw new HttpsError('invalid-argument', 'Tên tiếng Việt và tiếng Anh là bắt buộc.')
  return {
    ...current, schemaVersion: 1, status: ['draft', 'review'].includes(raw.status) ? raw.status : 'draft', nameVi, nameEn,
    aliasesVi: stringList(raw.aliasesVi, 12, 100), bodyParts: stringList(raw.bodyParts, 12, 80), targetMuscles: stringList(raw.targetMuscles, 12, 80),
    secondaryMuscles: stringList(raw.secondaryMuscles, 12, 80), equipment: stringList(raw.equipment, 12, 80),
    environment: stringList(raw.environment, 2, 20).filter((item) => item === 'gym' || item === 'home'),
    difficulty: ['beginner', 'intermediate', 'advanced'].includes(raw.difficulty) ? raw.difficulty : 'beginner', goals: stringList(raw.goals, 12, 80),
    instructionsVi: stringList(raw.instructionsVi, 20, 600), cuesVi: stringList(raw.cuesVi, 12, 300), commonMistakesVi: stringList(raw.commonMistakesVi, 12, 300),
    breathingVi: text(raw.breathingVi, 500), media: {
      startImageUrl: text(raw.media?.startImageUrl, 2_000), endImageUrl: text(raw.media?.endImageUrl, 2_000), posterUrl: text(raw.media?.posterUrl, 2_000),
      animationUrl: text(raw.media?.animationUrl, 2_000), mimeType: text(raw.media?.mimeType, 100), checksum: text(raw.media?.checksum, 128),
    },
    defaultPrescription: {
      sets: Math.min(10, Math.max(1, Number(raw.defaultPrescription?.sets) || 3)), reps: text(raw.defaultPrescription?.reps, 40) || '10–12',
      restSeconds: Math.min(600, Math.max(0, Number(raw.defaultPrescription?.restSeconds) || 60)), rpe: Math.min(10, Math.max(1, Number(raw.defaultPrescription?.rpe) || 7)),
    },
    source: current.source || raw.source, sourceAttribution: text(raw.sourceAttribution, 300) || 'Free Exercise DB · Unlicense',
  }
}

function createExerciseCatalogFunctions({ db, onCall }) {
  const listExerciseCatalog = onCall(async (request) => {
    const actor = await actorContext(request, db)
    const includeReview = request.data?.includeReview === true && actor.isStaff
    const query = text(request.data?.query, 120).toLocaleLowerCase('vi')
    const bodyPart = text(request.data?.bodyPart, 80).toLocaleLowerCase('vi')
    const equipment = text(request.data?.equipment, 80).toLocaleLowerCase('vi')
    const difficulty = text(request.data?.difficulty, 20)
    const snapshots = await db.collection('exercises').limit(250).get()
    const items = snapshots.docs.map(publicItem).filter((item) => {
      if (includeReview ? item.status === 'archived' : item.status !== 'published') return false
      const searchable = [item.nameVi, item.nameEn, ...item.aliasesVi, ...item.targetMuscles, ...item.bodyParts].join(' ').toLocaleLowerCase('vi')
      return (!query || searchable.includes(query)) && (!bodyPart || item.bodyParts.some((value) => value.toLocaleLowerCase('vi') === bodyPart))
        && (!equipment || item.equipment.some((value) => value.toLocaleLowerCase('vi') === equipment)) && (!difficulty || item.difficulty === difficulty)
    }).sort((a, b) => a.nameVi.localeCompare(b.nameVi, 'vi')).slice(0, 150)
    return { schemaVersion: 1, items, total: items.length }
  })

  const getExerciseCatalogItem = onCall(async (request) => {
    const actor = await actorContext(request, db)
    const exerciseId = safeId(request.data?.exerciseId)
    const snapshot = await db.doc(`exercises/${exerciseId}`).get()
    if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy bài tập.')
    const item = publicItem(snapshot)
    if (item.status !== 'published' && !actor.isStaff) throw new HttpsError('permission-denied', 'Bài tập chưa được xuất bản.')
    return { schemaVersion: 1, item }
  })

  const saveExerciseCatalogDraft = onCall(async (request) => {
    const actor = await actorContext(request, db)
    if (!actor.isStaff) throw new HttpsError('permission-denied', 'Bạn không có quyền biên tập bài tập.')
    const exerciseId = safeId(request.data?.exerciseId)
    const expectedRevision = Number(request.data?.expectedRevision)
    return db.runTransaction(async (transaction) => {
      const reference = db.doc(`exercises/${exerciseId}`)
      const snapshot = await transaction.get(reference)
      const current = snapshot.exists ? snapshot.data() : {}
      const revision = snapshot.exists ? Number(current.revision || 1) : 0
      if (!Number.isInteger(expectedRevision) || expectedRevision !== revision) throw new HttpsError('aborted', 'Bài tập đã được người khác cập nhật. Hãy tải lại.')
      if (current.status === 'published' || current.status === 'archived') throw new HttpsError('failed-precondition', 'Bài đã xuất bản hoặc lưu trữ không thể sửa trực tiếp.')
      const nextRevision = revision + 1
      const normalized = normalizeDraft(request.data?.draft || {}, current)
      transaction.set(reference, { ...normalized, revision: nextRevision, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
      transaction.create(reference.collection('revisions').doc(String(nextRevision)), { ...normalized, exerciseId, revision: nextRevision, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      return { exerciseId, revision: nextRevision, status: normalized.status }
    })
  })

  const publishExerciseCatalogItem = onCall(async (request) => {
    const actor = await actorContext(request, db)
    if (!actor.canPublish) throw new HttpsError('permission-denied', 'Chỉ quản trị viên được xuất bản bài tập.')
    const exerciseId = safeId(request.data?.exerciseId)
    const expectedRevision = Number(request.data?.expectedRevision)
    return db.runTransaction(async (transaction) => {
      const reference = db.doc(`exercises/${exerciseId}`)
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy bài tập.')
      const data = snapshot.data()
      if (Number(data.revision) !== expectedRevision) throw new HttpsError('aborted', 'Bài tập đã thay đổi. Hãy tải lại.')
      if (!text(data.nameVi) || !stringList(data.instructionsVi).length || !text(data.media?.startImageUrl)) throw new HttpsError('failed-precondition', 'Bài tập cần tên tiếng Việt, hướng dẫn và hình minh họa trước khi xuất bản.')
      const revision = expectedRevision + 1
      transaction.update(reference, { status: 'published', revision, reviewedBy: actor.uid, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.create(reference.collection('revisions').doc(String(revision)), { ...data, exerciseId, status: 'published', revision, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      return { exerciseId, revision, status: 'published' }
    })
  })

  return { listExerciseCatalog, getExerciseCatalogItem, saveExerciseCatalogDraft, publishExerciseCatalogItem }
}

module.exports = { createExerciseCatalogFunctions }
