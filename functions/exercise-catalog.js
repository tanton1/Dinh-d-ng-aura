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

function mediaImages(value, exerciseId) {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const id = text(entry.id, 160)
    const url = text(entry.url, 2_000)
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || !url) return []
    const storagePath = text(entry.storagePath, 500)
    if (storagePath && !storagePath.startsWith(`exercise-catalog/${exerciseId}/`)) return []
    return [{
      id,
      url,
      ...(storagePath ? { storagePath } : {}),
      role: ['start', 'end', 'detail'].includes(entry.role) ? entry.role : 'detail',
      order: Number.isFinite(entry.order) ? Math.max(0, Math.round(entry.order)) : index,
      alt: text(entry.alt, 240),
      mimeType: text(entry.mimeType, 100),
    }]
  }).slice(0, 12).sort((left, right) => left.order - right.order).map((entry, order) => ({ ...entry, order }))
}

function normalizedMedia(rawMedia, exerciseId) {
  const images = mediaImages(rawMedia?.images, exerciseId)
  const startImage = images.find((image) => image.role === 'start') || images[0]
  const endImage = images.find((image) => image.role === 'end')
  const posterImageId = text(rawMedia?.posterImageId, 160)
  const posterImage = images.find((image) => image.id === posterImageId) || startImage
  return {
    startImageUrl: text(rawMedia?.startImageUrl, 2_000) || startImage?.url || '',
    endImageUrl: text(rawMedia?.endImageUrl, 2_000) || endImage?.url || '',
    posterUrl: text(rawMedia?.posterUrl, 2_000) || posterImage?.url || '',
    posterImageId: posterImage?.id || '',
    images,
    animationUrl: text(rawMedia?.animationUrl, 2_000),
    mimeType: text(rawMedia?.mimeType, 100) || startImage?.mimeType || '',
    checksum: text(rawMedia?.checksum, 128),
  }
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

function publicItemFromData(id, data) {
  return {
    id,
    schemaVersion: 1,
    revision: Number.isInteger(data.revision) ? data.revision : 1,
    status: ['draft', 'review', 'published', 'archived'].includes(data.status) ? data.status : 'draft',
    nameVi: text(data.nameVi || data.nameEn, 200), nameEn: text(data.nameEn, 200), aliasesVi: stringList(data.aliasesVi, 12, 100),
    bodyParts: stringList(data.bodyParts, 12, 80), targetMuscles: stringList(data.targetMuscles, 12, 80), secondaryMuscles: stringList(data.secondaryMuscles, 12, 80),
    equipment: stringList(data.equipment, 12, 80), environment: stringList(data.environment, 2, 20),
    difficulty: ['beginner', 'intermediate', 'advanced'].includes(data.difficulty) ? data.difficulty : 'beginner', goals: stringList(data.goals, 12, 80),
    instructionsVi: stringList(data.instructionsVi, 20, 600), cuesVi: stringList(data.cuesVi, 12, 300), commonMistakesVi: stringList(data.commonMistakesVi, 12, 300), breathingVi: text(data.breathingVi, 500),
    media: normalizedMedia(data.media, id),
    defaultPrescription: {
      sets: Number.isInteger(data.defaultPrescription?.sets) ? data.defaultPrescription.sets : 3,
      reps: text(data.defaultPrescription?.reps, 40) || '10–12',
      restSeconds: Number.isInteger(data.defaultPrescription?.restSeconds) ? data.defaultPrescription.restSeconds : 60,
      rpe: Number.isInteger(data.defaultPrescription?.rpe) ? data.defaultPrescription.rpe : 7,
    },
    source: {
      provider: data.source?.provider === 'aura' ? 'aura' : 'free-exercise-db', sourceExerciseId: text(data.source?.sourceExerciseId, 160) || id,
      sourceVersion: text(data.source?.sourceVersion, 100) || 'unknown', license: data.source?.license === 'Aura-owned' ? 'Aura-owned' : 'Unlicense',
    },
    sourceAttribution: text(data.sourceAttribution, 300) || 'Free Exercise DB · Unlicense',
    hasWorkingDraft: Boolean(data.workingDraft && typeof data.workingDraft === 'object'),
    ...(Number.isInteger(data.workingDraftRevision) ? { editRevision: data.workingDraftRevision } : {}),
    ...(['draft', 'review'].includes(data.workingDraftStatus) ? { editStatus: data.workingDraftStatus } : {}),
  }
}

function publicItem(snapshot) {
  return publicItemFromData(snapshot.id, snapshot.data())
}

function editableItem(snapshot, actor) {
  const data = snapshot.data()
  if (!actor.isStaff || !data.workingDraft || typeof data.workingDraft !== 'object') return publicItem(snapshot)
  return publicItemFromData(snapshot.id, {
    ...data.workingDraft,
    revision: Number.isInteger(data.workingDraftRevision) ? data.workingDraftRevision : Number(data.revision || 1),
    status: ['draft', 'review'].includes(data.workingDraftStatus) ? data.workingDraftStatus : 'draft',
  })
}

function normalizeDraft(raw, current = {}, exerciseId = '') {
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
    breathingVi: text(raw.breathingVi, 500), media: normalizedMedia(raw.media, exerciseId),
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
    return { schemaVersion: 1, item, editItem: editableItem(snapshot, actor) }
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
      if (current.status === 'archived') throw new HttpsError('failed-precondition', 'Bài đã lưu trữ không thể chỉnh sửa.')
      if (current.status === 'published') {
        const draftRevision = Number.isInteger(current.workingDraftRevision) ? current.workingDraftRevision : revision
        if (!Number.isInteger(expectedRevision) || expectedRevision !== draftRevision) throw new HttpsError('aborted', 'Bản chỉnh sửa đã được người khác cập nhật. Hãy tải lại.')
        const nextRevision = draftRevision + 1
        const normalized = normalizeDraft(request.data?.draft || {}, current.workingDraft || current, exerciseId)
        transaction.update(reference, {
          workingDraft: normalized,
          workingDraftRevision: nextRevision,
          workingDraftStatus: normalized.status,
          workingDraftUpdatedAt: FieldValue.serverTimestamp(),
          workingDraftUpdatedBy: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
        transaction.create(reference.collection('revisions').doc(`draft-${nextRevision}`), {
          ...normalized, exerciseId, revision: nextRevision, publishedRevision: revision,
          revisionType: 'working_draft', createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid,
        })
        return { exerciseId, revision: nextRevision, status: normalized.status, publishedStatus: 'published', hasWorkingDraft: true }
      }
      if (!Number.isInteger(expectedRevision) || expectedRevision !== revision) throw new HttpsError('aborted', 'Bài tập đã được người khác cập nhật. Hãy tải lại.')
      const nextRevision = revision + 1
      const normalized = normalizeDraft(request.data?.draft || {}, current, exerciseId)
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
      const hasWorkingDraft = data.status === 'published' && data.workingDraft && typeof data.workingDraft === 'object'
      const candidate = hasWorkingDraft ? data.workingDraft : data
      const currentRevision = hasWorkingDraft ? Number(data.workingDraftRevision) : Number(data.revision)
      if (currentRevision !== expectedRevision) throw new HttpsError('aborted', 'Bài tập đã thay đổi. Hãy tải lại.')
      if (!text(candidate.nameVi) || !stringList(candidate.instructionsVi).length || !text(candidate.media?.startImageUrl)) throw new HttpsError('failed-precondition', 'Bài tập cần tên tiếng Việt, hướng dẫn và hình minh họa trước khi xuất bản.')
      const revision = expectedRevision + 1
      const published = { ...candidate, status: 'published', revision }
      transaction.set(reference, {
        ...published,
        workingDraft: FieldValue.delete(), workingDraftRevision: FieldValue.delete(), workingDraftStatus: FieldValue.delete(),
        workingDraftUpdatedAt: FieldValue.delete(), workingDraftUpdatedBy: FieldValue.delete(),
        reviewedBy: actor.uid, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid,
      }, { merge: true })
      transaction.create(reference.collection('revisions').doc(String(revision)), { ...published, exerciseId, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      return { exerciseId, revision, status: 'published' }
    })
  })

  return { listExerciseCatalog, getExerciseCatalogItem, saveExerciseCatalogDraft, publishExerciseCatalogItem }
}

module.exports = { createExerciseCatalogFunctions }
