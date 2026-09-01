const { FieldValue } = require('firebase-admin/firestore')
const { defineSecret } = require('firebase-functions/params')
const { HttpsError } = require('firebase-functions/v2/https')

const YMOVE_API_KEY = defineSecret('YMOVE_API_KEY', {
  description: 'Server-side API key for the YMove exercise media provider.',
})
const YMOVE_API_BASE_URL = 'https://exercise-api.ymove.app/api/v2'
const YMOVE_FREE_LIBRARY_URL = 'https://ymove.app/free-exercise-videos'
const EXERCISEDB_API_BASE_URL = 'https://oss.exercisedb.dev/api/v1'
const externalProviders = new Set(['exercisedb', 'ymove_free', 'ymove'])
const durableVideoProviders = new Set(['aura', 'ymove_free', 'exercisedb', 'programme'])

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

function mediaVideos(value) {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const provider = ['ymove', 'ymove_free', 'exercisedb', 'programme'].includes(entry.provider) ? entry.provider : 'aura'
    const id = text(entry.id, 160) || `video-${index + 1}`
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return []
    // Paid YMove URLs expire. Public/free providers use durable URLs.
    const url = durableVideoProviders.has(provider) ? text(entry.url, 2_000) : ''
    const hlsUrl = durableVideoProviders.has(provider) ? text(entry.hlsUrl, 2_000) : ''
    const posterUrl = durableVideoProviders.has(provider) ? text(entry.posterUrl, 2_000) : ''
    return [{
      id,
      provider,
      ...(text(entry.externalId, 160) ? { externalId: text(entry.externalId, 160) } : {}),
      ...(url ? { url } : {}),
      ...(hlsUrl ? { hlsUrl } : {}),
      ...(posterUrl ? { posterUrl } : {}),
      ...(['white-background', 'gym-shot', 'aura', 'animation', 'licensed-embed'].includes(entry.tag) ? { tag: entry.tag } : provider === 'aura' ? { tag: 'aura' } : {}),
      ...(['front', 'side', 'other'].includes(entry.angle) ? { angle: entry.angle } : {}),
      ...(['female', 'male', 'neutral'].includes(entry.presenter) ? { presenter: entry.presenter } : {}),
      ...(['portrait', 'landscape'].includes(entry.orientation) ? { orientation: entry.orientation } : {}),
      ...(['hls', 'mp4', 'webp', 'gif'].includes(entry.format) ? { format: entry.format } : {}),
      ...(Number.isFinite(entry.durationSeconds) ? { durationSeconds: Math.max(0, Math.round(entry.durationSeconds)) } : {}),
      isPrimary: entry.isPrimary === true,
    }]
  }).slice(0, 12)
}

function normalizedExternalMedia(value) {
  if (!value || typeof value !== 'object' || !externalProviders.has(value.provider)) return undefined
  const exerciseId = text(value.exerciseId, 160)
  if (!exerciseId || !/^[A-Za-z0-9_-]+$/.test(exerciseId)) return undefined
  return {
    provider: value.provider,
    exerciseId,
    ...(text(value.slug, 200) ? { slug: text(value.slug, 200) } : {}),
    ...(['white-background', 'gym-shot'].includes(value.preferredVideoTag) ? { preferredVideoTag: value.preferredVideoTag } : {}),
    ...(['portrait', 'landscape'].includes(value.preferredOrientation) ? { preferredOrientation: value.preferredOrientation } : {}),
    ...(text(value.syncedAt, 80) ? { syncedAt: text(value.syncedAt, 80) } : {}),
  }
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
    videos: mediaVideos(rawMedia?.videos),
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
    ...(normalizedExternalMedia(data.externalMedia) ? { externalMedia: normalizedExternalMedia(data.externalMedia) } : {}),
    defaultPrescription: {
      sets: Number.isInteger(data.defaultPrescription?.sets) ? data.defaultPrescription.sets : 3,
      reps: text(data.defaultPrescription?.reps, 40) || '10–12',
      restSeconds: Number.isInteger(data.defaultPrescription?.restSeconds) ? data.defaultPrescription.restSeconds : 60,
      rpe: Number.isInteger(data.defaultPrescription?.rpe) ? data.defaultPrescription.rpe : 7,
    },
    source: {
      provider: ['aura', 'ymove', 'ymove_free', 'exercisedb', 'programme'].includes(data.source?.provider) ? data.source.provider : 'free-exercise-db', sourceExerciseId: text(data.source?.sourceExerciseId, 160) || id,
      sourceVersion: text(data.source?.sourceVersion, 100) || 'unknown', license: ['Aura-owned', 'External-provider', 'CC-BY-SA-3.0', 'Free-commercial-embed'].includes(data.source?.license) ? data.source.license : 'Unlicense',
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
    externalMedia: normalizedExternalMedia(raw.externalMedia) || null,
    defaultPrescription: {
      sets: Math.min(10, Math.max(1, Number(raw.defaultPrescription?.sets) || 3)), reps: text(raw.defaultPrescription?.reps, 40) || '10–12',
      restSeconds: Math.min(600, Math.max(0, Number(raw.defaultPrescription?.restSeconds) || 60)), rpe: Math.min(10, Math.max(1, Number(raw.defaultPrescription?.rpe) || 7)),
    },
    source: current.source || raw.source, sourceAttribution: text(raw.sourceAttribution, 300) || 'Free Exercise DB · Unlicense',
  }
}

function providerApiKey() {
  let value = ''
  try { value = text(YMOVE_API_KEY.value(), 500) || text(process.env.YMOVE_API_KEY, 500) } catch { value = text(process.env.YMOVE_API_KEY, 500) }
  return value === 'AURA_PROVIDER_DISABLED' ? '' : value
}

async function fetchYMove(pathname, searchParams = {}) {
  const apiKey = providerApiKey()
  if (!apiKey) return { configured: false, payload: null }
  const url = new URL(`${YMOVE_API_BASE_URL}${pathname}`)
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) url.searchParams.set(key, String(value))
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'X-API-Key': apiKey }, signal: controller.signal })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new HttpsError('failed-precondition', 'Khóa đồng bộ thư viện bài tập chưa hợp lệ.')
      if (response.status === 429) throw new HttpsError('resource-exhausted', 'Nguồn video đang giới hạn lượt truy cập. Hãy thử lại sau.')
      throw new HttpsError('unavailable', 'Nguồn bài tập tạm thời chưa phản hồi.')
    }
    return { configured: true, payload: await response.json() }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('unavailable', error?.name === 'AbortError' ? 'Nguồn bài tập phản hồi quá chậm.' : 'Không thể kết nối nguồn bài tập.')
  } finally { clearTimeout(timer) }
}

async function fetchPublicJson(baseUrl, pathname, searchParams = {}) {
  const url = new URL(`${baseUrl}${pathname}`)
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) url.searchParams.set(key, String(value))
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AuraFitnessExerciseCatalog/1.0' }, signal: controller.signal })
    if (!response.ok) {
      if (response.status === 429) throw new HttpsError('resource-exhausted', 'Nguồn bài tập miễn phí đang giới hạn lượt truy cập. Hãy thử lại sau.')
      throw new HttpsError('unavailable', 'Nguồn bài tập miễn phí tạm thời chưa phản hồi.')
    }
    return await response.json()
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('unavailable', error?.name === 'AbortError' ? 'Nguồn bài tập miễn phí phản hồi quá chậm.' : 'Không thể kết nối nguồn bài tập miễn phí.')
  } finally { clearTimeout(timer) }
}

async function fetchExerciseDb(pathname = '/exercises', searchParams = {}) {
  return fetchPublicJson(EXERCISEDB_API_BASE_URL, pathname, searchParams)
}

async function fetchYMoveFreeLibrary() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(YMOVE_FREE_LIBRARY_URL, { headers: { Accept: 'text/html', 'User-Agent': 'AuraFitnessExerciseCatalog/1.0' }, signal: controller.signal })
    if (!response.ok) throw new HttpsError('unavailable', 'Thư viện 25 video miễn phí tạm thời chưa phản hồi.')
    const html = await response.text()
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
    if (!match) throw new HttpsError('data-loss', 'YMove đã thay đổi định dạng thư viện miễn phí.')
    const payload = JSON.parse(match[1])
    const exercises = payload?.props?.pageProps?.exercises
    if (!Array.isArray(exercises)) throw new HttpsError('data-loss', 'Không đọc được danh sách video miễn phí.')
    return exercises.slice(0, 25)
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('unavailable', error?.name === 'AbortError' ? 'Thư viện video miễn phí phản hồi quá chậm.' : 'Không thể tải thư viện video miễn phí.')
  } finally { clearTimeout(timer) }
}

function externalExerciseRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.data?.exercises)) return payload.data.exercises
  if (Array.isArray(payload?.exercises)) return payload.exercises
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

function externalExerciseData(payload) {
  return payload?.data && !Array.isArray(payload.data) ? payload.data : payload
}

function normalizedExternalVideo(entry, index, provider = 'ymove') {
  if (!entry || typeof entry !== 'object') return null
  const url = text(entry.videoUrl || entry.url || entry.mp4Url, 2_000)
  const hlsUrl = text(entry.videoHlsUrl || entry.hlsUrl, 2_000)
  if (!url && !hlsUrl) return null
  const presenter = entry.presenter || entry.gender
  return {
    id: text(entry.id, 160) || `${provider}-${index + 1}`,
    provider,
    externalId: text(entry.id, 160),
    url,
    hlsUrl,
    posterUrl: text(entry.thumbnailUrl || entry.posterUrl, 2_000),
    tag: ['white-background', 'gym-shot'].includes(entry.tag) ? entry.tag : undefined,
    presenter: ['female', 'male', 'neutral'].includes(presenter) ? presenter : undefined,
    orientation: ['portrait', 'landscape'].includes(entry.orientation) ? entry.orientation : undefined,
    format: url ? 'mp4' : 'hls',
    durationSeconds: Number.isFinite(entry.videoDurationSecs || entry.durationSeconds) ? Math.max(0, Math.round(entry.videoDurationSecs || entry.durationSeconds)) : undefined,
    isPrimary: entry.isPrimary === true || index === 0,
  }
}

function normalizedExternalExercise(entry, includeMedia = false, provider = 'ymove') {
  const id = text(entry?.id, 160)
  if (!id) return null
  const sourceVideos = Array.isArray(entry.videos) && entry.videos.length ? entry.videos : [entry]
  const videos = includeMedia ? sourceVideos.map((video, index) => normalizedExternalVideo(video, index, provider)).filter(Boolean).slice(0, 12) : []
  const thumbnailUrl = text(entry.thumbnailUrl, 2_000) || videos.find((video) => video.posterUrl)?.posterUrl || ''
  return {
    id,
    provider,
    title: text(entry.title || entry.name, 200),
    slug: text(entry.slug, 200),
    description: text(entry.description, 2_000),
    instructions: stringList(entry.instructions, 20, 600),
    importantPoints: stringList(entry.importantPoints, 20, 400),
    muscleGroup: text(entry.muscleGroup, 120),
    secondaryMuscles: stringList(entry.secondaryMuscles, 12, 120),
    equipment: Array.isArray(entry.equipment) ? stringList(entry.equipment, 12, 120) : stringList([entry.equipment], 12, 120),
    category: text(entry.category || entry.exerciseType, 120),
    difficulty: text(entry.difficulty, 40),
    thumbnailUrl,
    videoCount: Number.isFinite(entry.videoCount) ? Math.max(0, Math.round(entry.videoCount)) : videos.length || (entry.videoUrl || entry.videoHlsUrl ? 1 : 0),
    videos,
  }
}

function normalizedExerciseDbExercise(entry) {
  const id = text(entry?.exerciseId, 160)
  const gifUrl = text(entry?.gifUrl, 2_000)
  if (!id || !gifUrl) return null
  const title = text(entry.name, 200)
  const targetMuscles = stringList(entry.targetMuscles, 12, 120)
  const bodyParts = stringList(entry.bodyParts, 12, 120)
  const equipment = stringList(entry.equipments, 12, 120)
  const presenter = /\(female\)/i.test(title) ? 'female' : /\(male\)/i.test(title) ? 'male' : 'neutral'
  return {
    id,
    provider: 'exercisedb',
    title,
    description: '',
    instructions: stringList(entry.instructions, 20, 600).map((instruction) => instruction.replace(/^Step\s*:?\s*\d+\s*/i, '').trim()).filter(Boolean),
    importantPoints: [],
    muscleGroup: targetMuscles[0] || bodyParts[0] || '',
    secondaryMuscles: stringList(entry.secondaryMuscles, 12, 120),
    equipment,
    category: bodyParts[0] || '',
    difficulty: '',
    thumbnailUrl: gifUrl,
    videoCount: 1,
    mediaLabel: 'GIF miễn phí',
    licenseNotice: 'ExerciseDB Free · cần giữ ghi nguồn theo chính sách nhà cung cấp',
    videos: [{
      id: `exercisedb-${id}`,
      provider: 'exercisedb',
      externalId: id,
      url: gifUrl,
      posterUrl: gifUrl,
      tag: 'animation',
      presenter,
      format: 'gif',
      isPrimary: true,
    }],
  }
}

function normalizedYMoveFreeExercise(entry) {
  const id = text(entry?.id, 160)
  const videoUrl = text(entry?.videoUrl, 2_000)
  if (!id || !videoUrl) return null
  return {
    id,
    provider: 'ymove_free',
    title: text(entry.title, 200),
    slug: text(entry.slug, 200),
    description: 'Video HD miễn phí từ bộ sưu tập Your Move.',
    instructions: [],
    importantPoints: [],
    muscleGroup: text(entry.muscleGroup, 120),
    secondaryMuscles: [],
    equipment: stringList([entry.equipment], 12, 120),
    category: 'strength',
    difficulty: '',
    thumbnailUrl: text(entry.thumbnailUrl, 2_000),
    videoCount: 1,
    mediaLabel: 'Video HD miễn phí',
    licenseNotice: 'YMove Free · miễn phí sử dụng thương mại, không được bán lại như một thư viện',
    videos: [{
      id: `ymove-free-${id}`,
      provider: 'ymove_free',
      externalId: id,
      url: videoUrl,
      posterUrl: text(entry.thumbnailUrl, 2_000),
      tag: 'white-background',
      presenter: 'neutral',
      orientation: 'portrait',
      format: 'mp4',
      isPrimary: true,
    }],
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

  const searchExternalExerciseCatalog = onCall({ secrets: [YMOVE_API_KEY], timeoutSeconds: 20 }, async (request) => {
    const actor = await actorContext(request, db)
    if (!actor.isStaff) throw new HttpsError('permission-denied', 'Chỉ nhân sự Aura được đồng bộ thư viện ngoài.')
    const provider = externalProviders.has(request.data?.provider) ? request.data.provider : 'exercisedb'
    const page = Math.min(50, Math.max(1, Math.round(Number(request.data?.page) || 1)))
    const pageSize = Math.min(20, Math.max(1, Math.round(Number(request.data?.pageSize) || 12)))
    if (provider === 'exercisedb') {
      const payload = await fetchExerciseDb('/exercises', {
        name: text(request.data?.search, 120),
        bodyPart: text(request.data?.muscleGroup, 80),
        equipment: text(request.data?.equipment, 80),
        limit: pageSize,
      })
      const items = (Array.isArray(payload?.data) ? payload.data : []).map(normalizedExerciseDbExercise).filter(Boolean).slice(0, pageSize)
      const total = Number(payload?.meta?.total || items.length)
      return { provider, providerConfigured: true, items, total: Number.isFinite(total) ? total : items.length, page: 1, pageSize }
    }
    if (provider === 'ymove_free') {
      const search = text(request.data?.search, 120).toLocaleLowerCase('en')
      const muscleGroup = text(request.data?.muscleGroup, 80).toLocaleLowerCase('en')
      const equipment = text(request.data?.equipment, 80).toLocaleLowerCase('en')
      const rows = await fetchYMoveFreeLibrary()
      const allItems = rows.map(normalizedYMoveFreeExercise).filter(Boolean).filter((item) => {
        const searchable = [item.title, item.muscleGroup, ...item.equipment].join(' ').toLocaleLowerCase('en')
        return (!search || searchable.includes(search)) && (!muscleGroup || item.muscleGroup.toLocaleLowerCase('en').includes(muscleGroup))
          && (!equipment || item.equipment.some((value) => value.toLocaleLowerCase('en').includes(equipment)))
      })
      return { provider, providerConfigured: true, items: allItems.slice(0, pageSize), total: allItems.length, page: 1, pageSize }
    }
    const result = await fetchYMove('/exercises', {
      search: text(request.data?.search, 120),
      muscleGroup: text(request.data?.muscleGroup, 80),
      equipment: text(request.data?.equipment, 80),
      difficulty: text(request.data?.difficulty, 40),
      videoTag: text(request.data?.videoTag, 40),
      hasVideo: 'true',
      includeVideos: 'true',
      page,
      pageSize,
    })
    if (!result.configured) return { provider, providerConfigured: false, items: [], total: 0, page, pageSize }
    const items = externalExerciseRows(result.payload).map((entry) => normalizedExternalExercise(entry, true, 'ymove')).filter(Boolean).slice(0, pageSize)
    const total = Number(result.payload?.meta?.total || result.payload?.pagination?.total || result.payload?.total || items.length)
    return { provider, providerConfigured: true, items, total: Number.isFinite(total) ? total : items.length, page, pageSize }
  })

  const getExternalExercisePreview = onCall({ secrets: [YMOVE_API_KEY], timeoutSeconds: 20 }, async (request) => {
    const actor = await actorContext(request, db)
    if (!actor.isStaff) throw new HttpsError('permission-denied', 'Chỉ nhân sự Aura được xem trước thư viện ngoài.')
    const provider = externalProviders.has(request.data?.provider) ? request.data.provider : 'exercisedb'
    const externalExerciseId = safeId(request.data?.externalExerciseId)
    if (provider === 'exercisedb') {
      const payload = await fetchExerciseDb(`/exercises/${encodeURIComponent(externalExerciseId)}`)
      const item = normalizedExerciseDbExercise(payload?.data)
      if (!item) throw new HttpsError('not-found', 'Không tìm thấy bài tập ở ExerciseDB.')
      return { provider, providerConfigured: true, item, transientMedia: false }
    }
    if (provider === 'ymove_free') {
      const rows = await fetchYMoveFreeLibrary()
      const item = normalizedYMoveFreeExercise(rows.find((entry) => entry.id === externalExerciseId))
      if (!item) throw new HttpsError('not-found', 'Không tìm thấy video trong bộ 25 bài miễn phí.')
      return { provider, providerConfigured: true, item, transientMedia: false }
    }
    const result = await fetchYMove(`/exercises/${encodeURIComponent(externalExerciseId)}`)
    if (!result.configured) return { provider, providerConfigured: false, item: null }
    const item = normalizedExternalExercise(externalExerciseData(result.payload), true, 'ymove')
    if (!item) throw new HttpsError('not-found', 'Không tìm thấy bài tập ở nguồn đồng bộ.')
    return { provider, providerConfigured: true, item, transientMedia: true }
  })

  const getExerciseCatalogMedia = onCall({ secrets: [YMOVE_API_KEY], timeoutSeconds: 20 }, async (request) => {
    const actor = await actorContext(request, db)
    const exerciseId = safeId(request.data?.exerciseId)
    const snapshot = await db.doc(`exercises/${exerciseId}`).get()
    if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy bài tập.')
    const data = snapshot.data()
    if (data.status !== 'published' && !actor.isStaff) throw new HttpsError('permission-denied', 'Bài tập chưa được xuất bản.')
    const candidate = actor.isStaff && data.workingDraft && typeof data.workingDraft === 'object' ? data.workingDraft : data
    const media = normalizedMedia(candidate.media, exerciseId)
    const externalMedia = normalizedExternalMedia(candidate.externalMedia)
    if (!externalMedia) {
      return { providerConfigured: Boolean(providerApiKey()), externalLinked: false, images: media.images, videos: media.videos, animationUrl: media.animationUrl }
    }
    let externalExercise = null
    let providerConfigured = true
    let transientMedia = false
    let expiresAt
    if (externalMedia.provider === 'exercisedb') {
      const payload = await fetchExerciseDb(`/exercises/${encodeURIComponent(externalMedia.exerciseId)}`)
      externalExercise = normalizedExerciseDbExercise(payload?.data)
    } else if (externalMedia.provider === 'ymove_free') {
      const rows = await fetchYMoveFreeLibrary()
      externalExercise = normalizedYMoveFreeExercise(rows.find((entry) => entry.id === externalMedia.exerciseId))
    } else {
      const result = await fetchYMove(`/exercises/${encodeURIComponent(externalMedia.exerciseId)}`)
      providerConfigured = result.configured
      if (result.configured) externalExercise = normalizedExternalExercise(externalExerciseData(result.payload), true, 'ymove')
      transientMedia = result.configured
      expiresAt = result.configured ? new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString() : undefined
    }
    if (!providerConfigured) return { provider: externalMedia.provider, providerConfigured: false, externalLinked: true, images: media.images, videos: media.videos, animationUrl: media.animationUrl }
    if (!externalExercise) throw new HttpsError('not-found', 'Nguồn media liên kết không còn bài tập này.')
    const preferred = (externalExercise?.videos || []).slice().sort((left, right) => {
      const leftScore = Number(left.tag === externalMedia.preferredVideoTag) * 2 + Number(left.orientation === externalMedia.preferredOrientation)
      const rightScore = Number(right.tag === externalMedia.preferredVideoTag) * 2 + Number(right.orientation === externalMedia.preferredOrientation)
      return rightScore - leftScore
    }).map((video, index) => ({ ...video, isPrimary: index === 0 }))
    return {
      provider: externalMedia.provider,
      providerConfigured,
      externalLinked: true,
      transientMedia,
      ...(expiresAt ? { expiresAt } : {}),
      images: media.images,
      videos: [...preferred, ...media.videos].slice(0, 12),
      animationUrl: media.animationUrl,
    }
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

  return {
    listExerciseCatalog,
    getExerciseCatalogItem,
    searchExternalExerciseCatalog,
    getExternalExercisePreview,
    getExerciseCatalogMedia,
    saveExerciseCatalogDraft,
    publishExerciseCatalogItem,
  }
}

module.exports = { createExerciseCatalogFunctions }
