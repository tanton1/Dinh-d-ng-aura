const { createHash } = require('node:crypto')
const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext } = require('./identity-access')
const { effectiveContractStatus } = require('./contract-status')

const ALL_REVIEW_CAPABILITY = 'nutrition.meals.all.review'
const DEFAULT_REVIEW_SLA_MINUTES = 120
const MAX_REVIEW_SLA_MINUTES = 1440
const MAX_ASSIGNED_CLIENTS = 400
const REVIEW_PAGE_SCAN_LIMIT = 300
const REVIEW_IMAGE_URL_TTL_MS = 15 * 60 * 1000
const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected'])

function currentContractDateKey(reference = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(reference)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
const USER_MEAL_FIELDS = new Set([
  'id', 'catalogId', 'plannedMealId', 'servingMultiplier', 'targetSnapshot',
  'date', 'type', 'label', 'time', 'title', 'dishName', 'description',
  'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium',
  'nutrientSources', 'unresolvedQuestions', 'status', 'tone', 'image', 'imageStoragePath',
  'source', 'confidence', 'calorieRange', 'items', 'aiAnalysis', 'cookingNote',
  'portionNote', 'studentGoal', 'studentCondition',
])

function boundedString(value, maximum = 500, required = false) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if ((required && !normalized) || normalized.length > maximum) {
    throw new HttpsError('invalid-argument', 'Dữ liệu duyệt món ăn không hợp lệ.')
  }
  return normalized
}

function documentId(value) {
  const normalized = boundedString(value, 200, true)
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new HttpsError('invalid-argument', 'Mã bản duyệt không hợp lệ.')
  }
  return normalized
}

function finite(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function timestampMillis(value) {
  if (value instanceof Timestamp) return value.toMillis()
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return 0
}

function shortText(value, maximum = 1600) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function requireOwner(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập để cập nhật nhật ký dinh dưỡng.')
  return uid
}

function plainJson(value, maximumBytes = 700_000) {
  let serialized = ''
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new HttpsError('invalid-argument', 'Dữ liệu bữa ăn không hợp lệ.')
  }
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > maximumBytes) {
    throw new HttpsError('invalid-argument', 'Dữ liệu bữa ăn vượt quá giới hạn cho phép.')
  }
  return JSON.parse(serialized)
}

function mealPhotoPath(value, uid, mealId) {
  const path = shortText(value, 500)
  if (!path) return ''
  const escapedUid = uid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedMealId = mealId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^users/${escapedUid}/meal-photos/${escapedMealId}/original\\.(?:jpe?g|png|webp)$`)
  if (!pattern.test(path)) throw new HttpsError('invalid-argument', 'Đường dẫn ảnh bữa ăn không hợp lệ.')
  return path
}

function safeMealPhotoPath(value, uid, mealId) {
  try {
    return uid && mealId ? mealPhotoPath(value, uid, mealId) : ''
  } catch {
    return ''
  }
}

function sanitizeMealInput(value, uid) {
  const input = plainJson(value)
  const mealId = documentId(input.id)
  const meal = Object.fromEntries(Object.entries(input).filter(([key]) => USER_MEAL_FIELDS.has(key)))
  meal.id = mealId
  meal.imageStoragePath = mealPhotoPath(meal.imageStoragePath, uid, mealId) || undefined
  meal.image = typeof meal.image === 'string' && !meal.image.startsWith('data:')
    ? safeImage(meal.image) || undefined
    : undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(meal.date || ''))) {
    throw new HttpsError('invalid-argument', 'Ngày ghi bữa ăn không hợp lệ.')
  }
  if (!['breakfast', 'lunch', 'dinner', 'snack'].includes(meal.type)) {
    throw new HttpsError('invalid-argument', 'Loại bữa ăn không hợp lệ.')
  }
  if (!['logged', 'planned'].includes(meal.status)) meal.status = 'logged'
  for (const key of ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium']) {
    if (meal[key] === undefined) continue
    const number = Number(meal[key])
    if (!Number.isFinite(number) || number < 0 || number > (key === 'sodium' ? 100_000 : 10_000)) {
      throw new HttpsError('invalid-argument', 'Chỉ số dinh dưỡng không hợp lệ.')
    }
    meal[key] = number
  }
  meal.title = shortText(meal.title || meal.dishName || 'Bữa ăn dinh dưỡng', 200)
  meal.dishName = shortText(meal.dishName || meal.title, 200)
  meal.label = shortText(meal.label, 80)
  meal.time = shortText(meal.time, 20)
  meal.description = shortText(meal.description, 1000)
  meal.cookingNote = shortText(meal.cookingNote, 500) || undefined
  meal.portionNote = shortText(meal.portionNote, 500) || undefined
  meal.studentGoal = shortText(meal.studentGoal, 300) || undefined
  meal.studentCondition = shortText(meal.studentCondition, 500) || undefined
  if (Array.isArray(meal.items)) meal.items = meal.items.slice(0, 30)
  return meal
}

function mealSnapshot(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => (
    USER_MEAL_FIELDS.has(key) && key !== 'image'
  )))
}

function snapshotHash(value) {
  const canonical = (item) => {
    if (Array.isArray(item)) return item.map(canonical)
    if (!item || typeof item !== 'object') return item
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])]))
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function nutritionMealWriteReceiptId(uid, idempotencyKey) {
  return createHash('sha256').update(`${uid}:${idempotencyKey}`).digest('hex')
}

function nutritionMealWriteIdempotencyKey(value) {
  const key = boundedString(value, 200)
  if (!key) return ''
  if (!/^[A-Za-z0-9:_-]{8,200}$/.test(key)) {
    throw new HttpsError('invalid-argument', 'Khóa chống gửi trùng không hợp lệ.')
  }
  return key
}

function mealNotification(transaction, db, uid, reviewId, action, feedback) {
  const labels = {
    approve: { title: 'Coach đã duyệt bữa ăn', message: feedback || 'Bữa ăn đã được Coach xác nhận.' },
    reject: { title: 'Bữa ăn cần điều chỉnh', message: feedback || 'Coach đề nghị bạn kiểm tra lại khẩu phần.' },
    feedback: { title: 'Coach vừa gửi nhận xét', message: feedback },
  }
  const copy = labels[action]
  if (!copy) return
  const notificationId = `nutrition-review-${reviewId}-${action}`
  transaction.set(db.doc(`users/${uid}/notifications/${notificationId}`), {
    schemaVersion: 1,
    userId: uid,
    type: action === 'reject' ? 'WARNING' : 'INFO',
    category: 'nutrition',
    title: copy.title,
    message: copy.message,
    actionUrl: '#/nutrition?section=diary',
    dedupeKey: notificationId,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

function safeImage(value) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  if (!normalized) return ''
  if (normalized.startsWith('data:image/')) {
    return normalized.length <= 450_000 ? normalized : ''
  }
  if (/^https:\/\//i.test(normalized) || normalized.startsWith('/')) {
    return normalized.slice(0, 2_000)
  }
  return ''
}

function compactAnalysis(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    quantityAndCookingAnalysis: shortText(source.quantityAndCookingAnalysis),
    portionAndCalorieRationale: shortText(source.portionAndCalorieRationale),
    goalAlignmentAssessment: shortText(source.goalAlignmentAssessment),
    calorieOptimizationTip: shortText(source.calorieOptimizationTip),
    macroBalanceAssessment: shortText(source.macroBalanceAssessment),
    aiSuggestion: shortText(source.aiSuggestion),
    aiFeedback: shortText(source.aiFeedback),
    coachFeedbackSuggestion: shortText(source.coachFeedbackSuggestion),
  }
}

function reviewRecord(snapshot, profile = {}, assignment = {}, coachName = '', options = {}) {
  const value = snapshot.data() || {}
  const meal = value.meal && typeof value.meal === 'object' ? value.meal : {}
  const totals = meal.totals && typeof meal.totals === 'object' ? meal.totals : {}
  const analysis = value.analysisSnapshot || meal.analysisSnapshot || meal.aiAnalysis || value.aiAnalysis || {}
  const createdAt = timestampMillis(value.createdAt) || timestampMillis(meal.createdAt)
  const status = ['pending', 'approved', 'rejected'].includes(value.status) ? value.status : 'pending'
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const slaMinutes = Number.isFinite(options.slaMinutes) ? options.slaMinutes : DEFAULT_REVIEW_SLA_MINUTES
  const slaDueAt = createdAt ? createdAt + slaMinutes * 60_000 : 0
  const waitMinutes = createdAt ? Math.max(0, Math.floor((now - createdAt) / 60_000)) : 0
  const overdueMinutes = status === 'pending' && slaDueAt && now > slaDueAt
    ? Math.max(1, Math.floor((now - slaDueAt) / 60_000))
    : 0
  const rawItems = Array.isArray(meal.items) ? meal.items : Array.isArray(analysis.items) ? analysis.items : []
  const rawSuggestions = Array.isArray(meal.aiSuggestions) ? meal.aiSuggestions : []
  const image = options.imageUrl || meal.image || meal.imageUrl || meal.img || meal.fileName || value.image || value.img
  const targetSnapshot = meal.targetSnapshot && typeof meal.targetSnapshot === 'object' ? meal.targetSnapshot : {}
  const normalizedConfidence = value.confidence || meal.confidence
  const mealDate = shortText(meal.mealDate || meal.date, 20)
  const mealTime = shortText(meal.mealTime || meal.time, 20)
  const mealTypeLabels = { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ' }
  return {
    id: snapshot.id,
    userId: typeof value.userId === 'string' ? value.userId : '',
    studentName: shortText(value.userName || meal.userName || profile.displayName || profile.name || 'Học viên Aura', 160),
    studentGoal: shortText(value.studentGoal || meal.studentGoal || meal.userGoal, 300),
    studentCondition: shortText(value.studentCondition || meal.studentCondition || meal.userCondition, 500),
    assignedCoachId: typeof assignment.coachId === 'string' ? assignment.coachId : '',
    assignedCoachIds: Array.isArray(assignment.coachIds) ? assignment.coachIds.slice(0, 10) : [],
    assignedCoachName: shortText(coachName, 160),
    createdAt,
    slaDueAt,
    waitMinutes,
    overdueMinutes,
    isOverdue: overdueMinutes > 0,
    time: [mealDate, mealTime].filter(Boolean).join(' '),
    image: safeImage(image),
    imageStoragePath: safeMealPhotoPath(meal.imageStoragePath, typeof value.userId === 'string' ? value.userId : '', meal.id || snapshot.id),
    note: shortText(meal.dishName || meal.title || meal.description || meal.note || value.note, 1000),
    mealType: shortText(value.mealType || meal.mealType || mealTypeLabels[meal.type] || meal.label || 'Bữa ăn', 80),
    totalKcal: finite(meal.calories ?? meal.totalKcal ?? totals.calories ?? value.totalKcal),
    totalProtein: finite(meal.protein ?? meal.totalProtein ?? totals.protein ?? value.totalProtein),
    totalCarb: finite(meal.carbs ?? meal.carb ?? meal.totalCarb ?? totals.carbs ?? totals.carb ?? value.totalCarb),
    totalFat: finite(meal.fat ?? meal.totalFat ?? totals.fat ?? value.totalFat),
    fiber: finite(value.fiber ?? meal.fiber),
    targetKcal: finite(value.targetKcal ?? meal.targetKcal ?? targetSnapshot.calories),
    targetProtein: finite(value.targetProtein ?? meal.targetProtein ?? targetSnapshot.protein),
    status,
    priority: value.priority === 'high' || meal.priority === 'high' ? 'high' : 'normal',
    aiScore: finite(value.aiScore ?? meal.aiScore),
    confidence: ['low', 'medium', 'high'].includes(normalizedConfidence)
      ? normalizedConfidence
      : normalizedConfidence === 'verified' ? 'high' : normalizedConfidence === 'needs-review' ? 'low' : 'medium',
    coachFeedback: shortText(value.coachFeedback, 2000),
    revision: Math.max(0, Math.trunc(finite(value.revision))),
    items: rawItems.slice(0, 30).map((item) => ({
      name: shortText(item?.name || item?.nameVi, 160),
      weight: finite(item?.grams ?? item?.estimatedGrams ?? item?.weight),
      kcal: finite(item?.calories ?? item?.nutrition?.calories ?? item?.kcal),
      protein: finite(item?.protein ?? item?.nutrition?.proteinG),
    })),
    suggestions: rawSuggestions.slice(0, 12).map((item) => ({
      type: item?.type === 'pass' ? 'pass' : 'warn',
      text: shortText(item?.text, 400),
    })).filter((item) => item.text),
    analysis: compactAnalysis(analysis),
    calorieRange: meal.calorieRange && typeof meal.calorieRange === 'object' ? {
      low: finite(meal.calorieRange.low),
      high: finite(meal.calorieRange.high),
    } : null,
    unresolvedQuestions: Array.isArray(meal.unresolvedQuestions)
      ? meal.unresolvedQuestions.slice(0, 10).map((item) => shortText(item, 220)).filter(Boolean)
      : Array.isArray(analysis.finalNutrition?.unresolvedQuestions)
        ? analysis.finalNutrition.unresolvedQuestions.slice(0, 10).map((item) => shortText(item, 220)).filter(Boolean)
        : [],
    nutrientSources: meal.nutrientSources && typeof meal.nutrientSources === 'object' ? meal.nutrientSources : {},
    mealRevision: Math.max(1, Math.trunc(finite(value.mealRevision || meal.mealRevision, 1))),
    snapshotHash: shortText(value.snapshotHash, 100),
  }
}

function canReviewAll(context) {
  return context.capabilities.includes(ALL_REVIEW_CAPABILITY)
}

function canReviewAssigned(context) {
  return context.accessRole === 'staff' && context.status === 'active'
}

async function assignedClientIds(db, context) {
  const today = currentContractDateKey()
  const coachIds = [...new Set([context.uid, context.legacyStaffId].filter(Boolean))]
  const contractSnapshots = await Promise.all(coachIds.map((coachId) => (
      db.collection('contracts').where('nutritionPTIds', 'array-contains', coachId).limit(200).get()
  )))
  const contractClients = contractSnapshots.flatMap((snapshot) => snapshot.docs
    .filter((item) => effectiveContractStatus(item.data(), today) === 'active')
    .map((item) => item.data()?.studentId)
    .filter((value) => typeof value === 'string'))
  const crmIds = [...new Set(contractClients)].slice(0, 200)
  const linkedAccounts = []
  for (let index = 0; index < crmIds.length; index += 30) {
    const chunk = crmIds.slice(index, index + 30)
    if (!chunk.length) continue
    const snapshot = await db.collection('roleAssignments').where('crmProfileId', 'in', chunk).get()
    snapshot.docs.forEach((item) => linkedAccounts.push(item.id))
  }
  for (let index = 0; index < crmIds.length; index += 100) {
    const snapshots = await db.getAll(...crmIds.slice(index, index + 100).map((id) => db.doc(`students/${id}`)))
    snapshots.forEach((item) => {
      const accountUid = item.exists ? item.data()?.accountUid : ''
      if (typeof accountUid === 'string' && accountUid) linkedAccounts.push(accountUid)
    })
  }
  return [...new Set([...crmIds, ...linkedAccounts])].slice(0, MAX_ASSIGNED_CLIENTS)
}

async function hydrateReviews(db, documents, context, options = {}) {
  const clientIds = [...new Set(documents.map((item) => item.data()?.userId).filter((value) => typeof value === 'string'))]
  const [profiles, identityAssignments] = await Promise.all([
    clientIds.length ? db.getAll(...clientIds.map((id) => db.doc(`users/${id}`))) : [],
    clientIds.length ? db.getAll(...clientIds.map((id) => db.doc(`roleAssignments/${id}`))) : [],
  ])
  const profileMap = new Map(profiles.map((item) => [item.id, item.exists ? item.data() || {} : {}]))
  const crmIdByClientId = new Map(identityAssignments.map((item) => {
    const value = item.exists ? item.data() || {} : {}
    return [item.id, typeof value.crmProfileId === 'string' && value.crmProfileId ? value.crmProfileId : item.id]
  }))
  for (let index = 0; index < clientIds.length; index += 30) {
    const chunk = clientIds.slice(index, index + 30)
    if (!chunk.length) continue
    const snapshot = await db.collection('students').where('accountUid', 'in', chunk).get()
    snapshot.docs.forEach((item) => {
      const accountUid = item.data()?.accountUid
      if (typeof accountUid === 'string' && accountUid) crmIdByClientId.set(accountUid, item.id)
    })
  }
  clientIds.forEach((id) => { if (!crmIdByClientId.has(id)) crmIdByClientId.set(id, id) })
  const crmIds = [...new Set(crmIdByClientId.values())]
  const contracts = []
  const today = currentContractDateKey()
  for (let index = 0; index < crmIds.length; index += 30) {
    const chunk = crmIds.slice(index, index + 30)
    if (!chunk.length) continue
    const snapshot = await db.collection('contracts').where('studentId', 'in', chunk).get()
    snapshot.docs.forEach((item) => {
      const value = item.data() || {}
      if (effectiveContractStatus(value, today) === 'active') contracts.push({ id: item.id, ...value })
    })
  }
  const contractByStudentId = new Map()
  contracts.forEach((contract) => {
    const current = contractByStudentId.get(contract.studentId)
    if (!current || String(contract.endDate || '') > String(current.endDate || '')) contractByStudentId.set(contract.studentId, contract)
  })
  const coachIds = [...new Set(contracts.flatMap((contract) => Array.isArray(contract.nutritionPTIds) ? contract.nutritionPTIds : []))]
  const [coachProfiles, trainerProfiles] = await Promise.all([
    coachIds.length ? db.getAll(...coachIds.map((id) => db.doc(`users/${id}`))) : [],
    coachIds.length ? db.getAll(...coachIds.map((id) => db.doc(`trainers/${id}`))) : [],
  ])
  const coachNames = new Map()
  trainerProfiles.forEach((item) => {
    const value = item.exists ? item.data() || {} : {}
    if (item.exists) coachNames.set(item.id, value.name || value.displayName || 'HLV Aura')
  })
  coachProfiles.forEach((item) => {
    const value = item.exists ? item.data() || {} : {}
    if (item.exists) coachNames.set(item.id, value.displayName || value.name || coachNames.get(item.id) || 'HLV Aura')
  })
  const records = documents.map((item) => {
    const userId = item.data()?.userId
    const contract = contractByStudentId.get(crmIdByClientId.get(userId)) || {}
    const assignedCoachIds = Array.isArray(contract.nutritionPTIds) ? contract.nutritionPTIds : []
    const assignment = { coachId: assignedCoachIds[0] || '', coachIds: assignedCoachIds }
    const assignedCoachName = assignedCoachIds.map((id) => coachNames.get(id) || (id === context.legacyStaffId || id === context.uid ? 'Bạn' : 'HLV Aura')).join(' · ')
    return reviewRecord(item, profileMap.get(userId), assignment, assignedCoachName, options)
  })
  const storage = options.storage || getStorage()
  await Promise.all(records.map(async (record) => {
    if (!record.imageStoragePath) return
    try {
      const [url] = await storage.bucket().file(record.imageStoragePath).getSignedUrl({
        action: 'read',
        expires: Date.now() + REVIEW_IMAGE_URL_TTL_MS,
      })
      record.image = url
    } catch {
      record.image = ''
    }
  }))
  return records
}

function normalizeReviewSlaMinutes(value) {
  const minutes = Math.trunc(finite(value, DEFAULT_REVIEW_SLA_MINUTES))
  return Math.min(MAX_REVIEW_SLA_MINUTES, Math.max(30, minutes))
}

function reviewSummary(reviews) {
  return reviews.reduce((summary, item) => {
    summary.total += 1
    summary[item.status] += 1
    if (item.isOverdue) summary.overdue += 1
    if (item.priority === 'high') summary.highPriority += 1
    if (item.userId) summary.studentIds.add(item.userId)
    return summary
  }, {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    overdue: 0,
    highPriority: 0,
    studentIds: new Set(),
  })
}

function publicReviewSummary(summary) {
  return {
    total: summary.total,
    pending: summary.pending,
    approved: summary.approved,
    rejected: summary.rejected,
    overdue: summary.overdue,
    highPriority: summary.highPriority,
    students: summary.studentIds.size,
  }
}

function reviewPriority(left, right) {
  const bucket = (item) => {
    if (item.status === 'pending' && item.isOverdue) return 0
    if (item.status === 'pending' && item.priority === 'high') return 1
    if (item.status === 'pending') return 2
    return 3
  }
  const bucketDifference = bucket(left) - bucket(right)
  if (bucketDifference) return bucketDifference
  if (left.status === 'pending' && right.status === 'pending') {
    return left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  }
  return right.createdAt - left.createdAt || left.id.localeCompare(right.id)
}

function pageCursor(cursor, status) {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))
    const createdAt = Number(parsed.createdAt)
    if (parsed.version !== 2 || parsed.status !== status || !Number.isFinite(createdAt) || !/^[A-Za-z0-9_-]+$/.test(parsed.id || '')) throw new Error('invalid')
    return { createdAt, id: parsed.id }
  } catch {
    throw new HttpsError('invalid-argument', 'Con trỏ danh sách duyệt món không hợp lệ.')
  }
}

function nextPageCursor(status, snapshot) {
  return Buffer.from(JSON.stringify({
    version: 2,
    status,
    createdAt: timestampMillis(snapshot.data()?.createdAt),
    id: snapshot.id,
  }), 'utf8').toString('base64url')
}

function clientChunks(clientIds) {
  if (clientIds === null) return [null]
  const values = []
  for (let index = 0; index < clientIds.length; index += 30) values.push(clientIds.slice(index, index + 30))
  return values
}

function scopedReviewQuery(db, clientIds, status, direction, cursor = null) {
  return clientChunks(clientIds).map((ids) => {
    let source = db.collection('mealReviews')
    if (ids) source = source.where('userId', 'in', ids)
    if (status !== 'all') source = source.where('status', '==', status)
    source = source.orderBy('createdAt', direction).orderBy(FieldPath.documentId(), direction)
    if (cursor) source = source.startAfter(Timestamp.fromMillis(cursor.createdAt), cursor.id)
    return source
  })
}

async function fetchReviewDocuments(db, clientIds, status, cursor) {
  if (Array.isArray(clientIds) && !clientIds.length) return { documents: [], hasMore: false }
  const direction = status === 'pending' ? 'asc' : 'desc'
  const sources = scopedReviewQuery(db, clientIds, status, direction, cursor)
  const snapshots = await Promise.all(sources.map((source) => source.limit(REVIEW_PAGE_SCAN_LIMIT + 1).get()))
  const documents = [...new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((item) => [item.id, item])).values()]
    .sort((left, right) => {
      const delta = timestampMillis(left.data()?.createdAt) - timestampMillis(right.data()?.createdAt)
      return direction === 'asc'
        ? delta || left.id.localeCompare(right.id)
        : -delta || right.id.localeCompare(left.id)
    })
  return {
    documents: documents.slice(0, REVIEW_PAGE_SCAN_LIMIT),
    hasMore: documents.length > REVIEW_PAGE_SCAN_LIMIT,
  }
}

async function countScopedReviews(db, clientIds, constraints = []) {
  if (Array.isArray(clientIds) && !clientIds.length) return 0
  const queries = clientChunks(clientIds).map((ids) => {
    let source = db.collection('mealReviews')
    if (ids) source = source.where('userId', 'in', ids)
    constraints.forEach(([field, operator, value]) => { source = source.where(field, operator, value) })
    return source.count().get()
  })
  const snapshots = await Promise.all(queries)
  return snapshots.reduce((sum, snapshot) => sum + finite(snapshot.data()?.count), 0)
}

async function scopedReviewSummary(db, clientIds, slaMinutes, assignmentCount) {
  const overdueCutoff = Timestamp.fromMillis(Date.now() - slaMinutes * 60_000)
  const [total, pending, approved, rejected, overdue, highPriority] = await Promise.all([
    countScopedReviews(db, clientIds),
    countScopedReviews(db, clientIds, [['status', '==', 'pending']]),
    countScopedReviews(db, clientIds, [['status', '==', 'approved']]),
    countScopedReviews(db, clientIds, [['status', '==', 'rejected']]),
    countScopedReviews(db, clientIds, [['status', '==', 'pending'], ['createdAt', '<', overdueCutoff]]),
    countScopedReviews(db, clientIds, [['status', '==', 'pending'], ['priority', '==', 'high']]),
  ])
  return { total, pending, approved, rejected, overdue, highPriority, students: assignmentCount }
}

async function availableNutritionCoaches(db) {
  const trainerSnapshot = await db.collection('trainers').limit(100).get()
  const candidates = trainerSnapshot.docs.filter((item) => item.data()?.status !== 'inactive')
  return candidates.map((item) => {
    const profile = item.data() || {}
    return {
      id: item.id,
      name: shortText(profile.name || profile.displayName || 'HLV Aura', 160),
      positions: [],
      branchIds: profile.branchId ? [profile.branchId] : [],
    }
  }).sort((left, right) => left.name.localeCompare(right.name, 'vi'))
}

function createNutritionReviewFunctions({ db, onCall }) {
  // These callables are Firestore-bound. The Gen 1 CPU profile prevents the
  // separate Cloud Run services from exhausting regional CPU allocation.
  const reviewCall = (handler) => onCall({ cpu: 'gcf_gen1', maxInstances: 6, invoker: 'public' }, handler)

  const saveNutritionMealLog = reviewCall(async (request) => {
    const uid = requireOwner(request)
    const meal = sanitizeMealInput(request.data?.meal, uid)
    const idempotencyKey = nutritionMealWriteIdempotencyKey(request.data?.idempotencyKey)
    const mealRef = db.doc(`users/${uid}/mealLogs/${meal.id}`)
    const reviewRef = db.doc(`mealReviews/${meal.id}`)
    const receiptRef = idempotencyKey
      ? db.doc(`nutritionMealWriteReceipts/${nutritionMealWriteReceiptId(uid, idempotencyKey)}`)
      : null
    const payloadHash = idempotencyKey ? snapshotHash(mealSnapshot(meal)) : ''
    let result
    await db.runTransaction(async (transaction) => {
      const [mealLogSnapshot, reviewSnapshot, receiptSnapshot] = await Promise.all([
        transaction.get(mealRef),
        transaction.get(reviewRef),
        receiptRef ? transaction.get(receiptRef) : Promise.resolve(null),
      ])
      if (receiptSnapshot?.exists) {
        const receipt = receiptSnapshot.data() || {}
        if (receipt.actorUid !== uid || receipt.mealId !== meal.id || receipt.payloadHash !== payloadHash) {
          throw new HttpsError('failed-precondition', 'Thao tác lưu này đã được dùng cho dữ liệu khác. Hãy tải lại nhật ký.')
        }
        result = {
          mealId: receipt.mealId,
          mealRevision: Math.max(1, Math.trunc(finite(receipt.mealRevision, 1))),
          reviewInvalidated: Boolean(receipt.reviewInvalidated),
          unchanged: true,
        }
        return
      }
      const previous = mealLogSnapshot.exists ? mealLogSnapshot.data() || {} : {}
      const mealRevision = Math.max(0, Math.trunc(finite(previous.mealRevision))) + 1
      const storedMeal = {
        ...meal,
        image: meal.image || (meal.imageStoragePath ? undefined : previous.image) || undefined,
        imageStoragePath: meal.imageStoragePath || previous.imageStoragePath || undefined,
        mealRevision,
        createdAt: previous.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }
      Object.keys(storedMeal).forEach((key) => storedMeal[key] === undefined && delete storedMeal[key])
      transaction.set(mealRef, storedMeal)

      let reviewInvalidated = false
      if (reviewSnapshot.exists) {
        const review = reviewSnapshot.data() || {}
        const reviewRevision = Math.max(0, Math.trunc(finite(review.revision))) + 1
        const invalidationMessage = 'Bữa ăn đã được học viên chỉnh sửa. Vui lòng gửi lại để Coach kiểm tra phiên bản mới.'
        transaction.update(reviewRef, {
          status: 'rejected',
          coachFeedback: invalidationMessage,
          invalidatedReason: 'meal_updated_after_submission',
          invalidatedAt: FieldValue.serverTimestamp(),
          reviewedBy: FieldValue.delete(),
          reviewedAt: FieldValue.delete(),
          reviewedScope: FieldValue.delete(),
          approvedAt: FieldValue.delete(),
          approvedAtTimestamp: FieldValue.delete(),
          revision: reviewRevision,
          updatedAt: FieldValue.serverTimestamp(),
        })
        transaction.set(mealRef, {
          reviewStatus: 'rejected',
          reviewId: meal.id,
          reviewRevision,
          coachFeedback: invalidationMessage,
          reviewedBy: FieldValue.delete(),
          reviewedAt: FieldValue.delete(),
          feedbackBy: FieldValue.delete(),
          feedbackAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
        transaction.create(db.collection('nutritionReviewAuditLogs').doc(), {
          action: 'meal_review.invalidated_by_meal_update',
          actorUid: uid,
          targetReviewId: meal.id,
          targetUserId: uid,
          beforeStatus: review.status || 'pending',
          afterStatus: 'rejected',
          revision: reviewRevision,
          mealRevision,
          createdAt: FieldValue.serverTimestamp(),
        })
        reviewInvalidated = true
      }
      result = { mealId: meal.id, mealRevision, reviewInvalidated, unchanged: false }
      if (receiptRef) {
        transaction.create(receiptRef, {
          schemaVersion: 1,
          actorUid: uid,
          mealId: meal.id,
          payloadHash,
          mealRevision,
          reviewInvalidated,
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
        })
      }
    })
    return result
  })

  const deleteNutritionMealLog = reviewCall(async (request) => {
    const uid = requireOwner(request)
    const mealId = documentId(request.data?.mealId)
    const mealRef = db.doc(`users/${uid}/mealLogs/${mealId}`)
    const reviewRef = db.doc(`mealReviews/${mealId}`)
    let imageStoragePath = ''
    await db.runTransaction(async (transaction) => {
      const [mealLogSnapshot, reviewSnapshot] = await Promise.all([
        transaction.get(mealRef),
        transaction.get(reviewRef),
      ])
      if (!mealLogSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy bữa ăn cần xóa.')
      const meal = mealLogSnapshot.data() || {}
      imageStoragePath = safeMealPhotoPath(meal.imageStoragePath, uid, mealId)
      transaction.delete(mealRef)
      if (reviewSnapshot.exists) transaction.delete(reviewRef)
      transaction.create(db.collection('nutritionReviewAuditLogs').doc(), {
        action: 'meal_log.deleted_by_owner',
        actorUid: uid,
        targetReviewId: mealId,
        targetUserId: uid,
        beforeStatus: reviewSnapshot.exists ? reviewSnapshot.data()?.status || 'pending' : 'not_submitted',
        afterStatus: 'deleted',
        revision: reviewSnapshot.exists ? Math.max(0, Math.trunc(finite(reviewSnapshot.data()?.revision))) + 1 : 0,
        createdAt: FieldValue.serverTimestamp(),
      })
    })
    if (imageStoragePath) {
      await getStorage().bucket().file(imageStoragePath).delete({ ignoreNotFound: true }).catch(() => undefined)
    }
    return { mealId, deleted: true }
  })

  const submitNutritionMealReview = reviewCall(async (request) => {
    const uid = requireOwner(request)
    const mealId = documentId(request.data?.mealId)
    const mealRef = db.doc(`users/${uid}/mealLogs/${mealId}`)
    const reviewRef = db.doc(`mealReviews/${mealId}`)
    let result
    await db.runTransaction(async (transaction) => {
      const [mealLogSnapshot, reviewSnapshot, profileSnapshot] = await Promise.all([
        transaction.get(mealRef),
        transaction.get(reviewRef),
        transaction.get(db.doc(`users/${uid}`)),
      ])
      if (!mealLogSnapshot.exists) throw new HttpsError('not-found', 'Hãy lưu bữa ăn trước khi gửi Coach duyệt.')
      const log = mealLogSnapshot.data() || {}
      if (log.status !== 'logged') throw new HttpsError('failed-precondition', 'Chỉ bữa ăn đã ghi nhận mới có thể gửi Coach duyệt.')
      const mealRevision = Math.max(1, Math.trunc(finite(log.mealRevision, 1)))
      const current = reviewSnapshot.exists ? reviewSnapshot.data() || {} : {}
      if (reviewSnapshot.exists && current.status === 'pending' && finite(current.mealRevision) === mealRevision) {
        result = { reviewId: mealId, status: 'pending', revision: Math.max(0, Math.trunc(finite(current.revision))), mealRevision, alreadyPending: true }
        return
      }
      const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : {}
      const snapshot = mealSnapshot(log)
      const revision = Math.max(0, Math.trunc(finite(current.revision))) + 1
      const nutritionProfile = profile.nutritionProfile && typeof profile.nutritionProfile === 'object' ? profile.nutritionProfile : {}
      const goal = log.studentGoal || (nutritionProfile.goal === 'lose-fat' ? 'Giảm mỡ thâm hụt calo' : nutritionProfile.goal === 'gain-muscle' ? 'Tăng cơ nạc' : 'Duy trì vóc dáng')
      const condition = log.studentCondition || [
        nutritionProfile.biologicalSex === 'female' ? 'Nữ' : nutritionProfile.biologicalSex === 'male' ? 'Nam' : '',
        nutritionProfile.age ? `${nutritionProfile.age} tuổi` : '',
        nutritionProfile.heightCm ? `Cao ${nutritionProfile.heightCm}cm` : '',
        nutritionProfile.weightKg ? `Nặng ${nutritionProfile.weightKg}kg` : '',
      ].filter(Boolean).join(', ')
      transaction.set(reviewRef, {
        id: mealId,
        userId: uid,
        userName: shortText(profile.displayName || profile.name || 'Học viên Aura', 160),
        studentGoal: shortText(goal, 300),
        studentCondition: shortText(condition, 500),
        meal: snapshot,
        analysisSnapshot: snapshot.aiAnalysis || null,
        snapshotHash: snapshotHash(snapshot),
        mealRevision,
        status: 'pending',
        priority: 'normal',
        revision,
        firstSubmittedAt: current.firstSubmittedAt || FieldValue.serverTimestamp(),
        submittedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        coachFeedback: FieldValue.delete(),
        invalidatedReason: FieldValue.delete(),
        invalidatedAt: FieldValue.delete(),
        reviewedBy: FieldValue.delete(),
        reviewedAt: FieldValue.delete(),
        reviewedScope: FieldValue.delete(),
        approvedAt: FieldValue.delete(),
        approvedAtTimestamp: FieldValue.delete(),
      }, { merge: true })
      transaction.set(mealRef, {
        reviewStatus: 'pending',
        reviewId: mealId,
        reviewRevision: revision,
        reviewSubmittedAt: FieldValue.serverTimestamp(),
        coachFeedback: FieldValue.delete(),
        reviewedBy: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.create(db.collection('nutritionReviewAuditLogs').doc(), {
        action: 'meal_review.submitted',
        actorUid: uid,
        targetReviewId: mealId,
        targetUserId: uid,
        beforeStatus: current.status || 'not_submitted',
        afterStatus: 'pending',
        revision,
        mealRevision,
        createdAt: FieldValue.serverTimestamp(),
      })
      result = { reviewId: mealId, status: 'pending', revision, mealRevision, alreadyPending: false }
    })
    return result
  })

  const listNutritionMealReviews = reviewCall(async (request) => {
    const context = await trustedAccessContext(request, db)
    const allScope = canReviewAll(context)
    if (!allScope && !canReviewAssigned(context)) {
      throw new HttpsError('permission-denied', 'Bạn chưa được phân quyền chăm sóc dinh dưỡng.')
    }
    const requestedLimit = Number(request.data?.limit)
    const limit = Number.isInteger(requestedLimit) ? Math.min(30, Math.max(6, requestedLimit)) : 24
    const requestedStatus = request.data?.status
    const status = ['pending', 'approved', 'rejected'].includes(requestedStatus) ? requestedStatus : 'all'
    const cursor = pageCursor(request.data?.cursor, status)
    const coachId = typeof request.data?.coachId === 'string' && request.data.coachId.trim()
      ? request.data.coachId.trim().slice(0, 200)
      : 'all'
    const query = typeof request.data?.query === 'string' ? request.data.query.trim().toLocaleLowerCase('vi').slice(0, 120) : ''
    let assignmentCount = 0
    const [settingsSnapshot] = await Promise.all([db.doc('system/nutrition_review_settings').get()])
    const slaMinutes = normalizeReviewSlaMinutes(settingsSnapshot.exists ? settingsSnapshot.data()?.slaMinutes : undefined)
    const clientIds = allScope ? null : await assignedClientIds(db, context)
    assignmentCount = Array.isArray(clientIds) ? clientIds.length : 0
    const page = await fetchReviewDocuments(db, clientIds, status, cursor)
    const [hydrated, coaches] = await Promise.all([
      hydrateReviews(db, page.documents, context, { now: Date.now(), slaMinutes }),
      allScope ? availableNutritionCoaches(db) : Promise.resolve([]),
    ])
    const summary = await scopedReviewSummary(db, clientIds, slaMinutes, assignmentCount)
    const filtered = hydrated.filter((item) => {
      if (coachId === 'unassigned' && item.assignedCoachIds.length) return false
      if (coachId !== 'all' && coachId !== 'unassigned' && !item.assignedCoachIds.includes(coachId)) return false
      if (!query) return true
      return [item.studentName, item.note, item.mealType, item.assignedCoachName]
        .some((value) => String(value || '').toLocaleLowerCase('vi').includes(query))
    })
    const reviews = filtered.slice(0, limit)
    const lastReturnedId = reviews.at(-1)?.id
    const lastReturnedIndex = lastReturnedId ? page.documents.findIndex((item) => item.id === lastReturnedId) : -1
    const consumedIndex = reviews.length >= limit && lastReturnedIndex >= 0 ? lastReturnedIndex : page.documents.length - 1
    const hasMore = consumedIndex >= 0 && (consumedIndex < page.documents.length - 1 || page.hasMore)
    return {
      reviews,
      coaches,
      scope: allScope ? 'all' : 'assigned',
      assignmentCount,
      hasMore,
      nextCursor: hasMore ? nextPageCursor(status, page.documents[consumedIndex]) : null,
      filteredCount: status === 'all' ? summary.total : summary[status],
      summary,
      summaryTruncated: false,
      slaMinutes,
    }
  })

  const assignNutritionCoach = reviewCall(async (request) => {
    const context = await trustedAccessContext(request, db)
    if (!canReviewAll(context)) throw new HttpsError('permission-denied', 'Bạn không có quyền phân HLV dinh dưỡng.')
    throw new HttpsError('failed-precondition', 'HLV dinh dưỡng được phân trong Học viên PT Gym → Hợp đồng. Trang duyệt món chỉ đọc phân công canonical này.')
  })

  const reviewNutritionMeal = reviewCall(async (request) => {
    const context = await trustedAccessContext(request, db)
    const allScope = canReviewAll(context)
    if (!allScope && !canReviewAssigned(context)) {
      throw new HttpsError('permission-denied', 'Bạn chưa được phân quyền chăm sóc dinh dưỡng.')
    }
    const reviewId = documentId(request.data?.reviewId)
    const action = ['approve', 'reject', 'feedback'].includes(request.data?.action) ? request.data.action : ''
    if (!action) throw new HttpsError('invalid-argument', 'Thao tác duyệt không hợp lệ.')
    const feedback = boundedString(request.data?.feedback, 2000, true)
    const expectedRevision = Math.max(0, Math.trunc(finite(request.data?.expectedRevision)))
    const reviewRef = db.doc(`mealReviews/${reviewId}`)
    let result
    await db.runTransaction(async (transaction) => {
      const reviewSnapshot = await transaction.get(reviewRef)
      if (!reviewSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy bữa ăn cần duyệt.')
      const review = reviewSnapshot.data() || {}
      const userId = documentId(review.userId)
      const currentRevision = Math.max(0, Math.trunc(finite(review.revision)))
      if (currentRevision !== expectedRevision) {
        throw new HttpsError('aborted', 'Bản duyệt đã được cập nhật. Hãy tải lại trước khi thao tác.')
      }
      if (!allScope) {
        const identityAssignment = await transaction.get(db.doc(`roleAssignments/${userId}`))
        const crmProfileId = identityAssignment.exists && typeof identityAssignment.data()?.crmProfileId === 'string'
          ? identityAssignment.data().crmProfileId
          : userId
        const linkedStudents = await transaction.get(db.collection('students').where('accountUid', '==', userId).limit(5))
        const studentIds = [...new Set([
          userId,
          crmProfileId,
          ...linkedStudents.docs.map((item) => item.id),
        ])]
        const contractSnapshot = await transaction.get(db.collection('contracts').where('studentId', 'in', studentIds).limit(20))
        const today = currentContractDateKey()
        const ownsNutritionCare = contractSnapshot.docs.some((item) => {
          const nutritionCoachIds = Array.isArray(item.data()?.nutritionPTIds) ? item.data().nutritionPTIds : []
          return effectiveContractStatus(item.data(), today) === 'active'
            && [context.uid, context.legacyStaffId].some((actorId) => nutritionCoachIds.includes(actorId))
        })
        if (!ownsNutritionCare) {
          throw new HttpsError('permission-denied', 'Học viên này không thuộc phạm vi chăm sóc dinh dưỡng của bạn.')
        }
      }
      const meal = review.meal && typeof review.meal === 'object' ? review.meal : {}
      const mealId = typeof meal.id === 'string' && /^[A-Za-z0-9_-]+$/.test(meal.id) ? meal.id : reviewId
      const mealLogRef = db.doc(`users/${userId}/mealLogs/${mealId}`)
      const mealLogSnapshot = await transaction.get(mealLogRef)
      if (!mealLogSnapshot.exists) {
        throw new HttpsError('failed-precondition', 'Bữa ăn gốc đã bị xóa. Aura không thể duyệt một bản chụp cũ.')
      }
      const logData = mealLogSnapshot.data() || {}
      const reviewMealRevision = Math.max(1, Math.trunc(finite(review.mealRevision, 1)))
      const currentMealRevision = Math.max(1, Math.trunc(finite(logData.mealRevision, 1)))
      const currentSnapshotHash = snapshotHash(mealSnapshot(logData))
      if (reviewMealRevision !== currentMealRevision || (review.snapshotHash && review.snapshotHash !== currentSnapshotHash)) {
        throw new HttpsError('aborted', 'Học viên đã chỉnh sửa bữa ăn. Hãy tải lại và chờ học viên gửi phiên bản mới.')
      }
      const nextStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : (review.status || 'pending')
      const nextRevision = currentRevision + 1
      const now = Date.now()
      const reviewPatch = {
        status: nextStatus,
        coachFeedback: feedback,
        revision: nextRevision,
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (action === 'feedback') {
        reviewPatch.feedbackBy = context.uid
        reviewPatch.feedbackAt = FieldValue.serverTimestamp()
      } else {
        reviewPatch.reviewedBy = context.uid
        reviewPatch.reviewedAt = FieldValue.serverTimestamp()
        reviewPatch.reviewedScope = allScope ? 'all' : 'assigned'
        reviewPatch.feedbackBy = FieldValue.delete()
        reviewPatch.feedbackAt = FieldValue.delete()
        if (action === 'approve') {
          reviewPatch.approvedAtTimestamp = now
          reviewPatch.approvedAt = FieldValue.serverTimestamp()
        } else {
          reviewPatch.approvedAtTimestamp = FieldValue.delete()
          reviewPatch.approvedAt = FieldValue.delete()
        }
      }
      transaction.update(reviewRef, reviewPatch)
      const logPatch = {
        coachFeedback: feedback,
        reviewStatus: nextStatus,
        reviewRevision: nextRevision,
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (action === 'feedback') {
        logPatch.feedbackBy = context.uid
        logPatch.feedbackAt = FieldValue.serverTimestamp()
      } else {
        logPatch.reviewedBy = context.uid
        logPatch.reviewedAt = FieldValue.serverTimestamp()
        logPatch.feedbackBy = FieldValue.delete()
        logPatch.feedbackAt = FieldValue.delete()
      }
      const snapshotAnalysis = review.analysisSnapshot || meal.analysisSnapshot || meal.aiAnalysis || review.aiAnalysis
      if (!logData.aiAnalysis && snapshotAnalysis && typeof snapshotAnalysis === 'object') logPatch.aiAnalysis = snapshotAnalysis
      transaction.update(mealLogRef, logPatch)
      mealNotification(transaction, db, userId, reviewId, action, feedback)
      transaction.create(db.collection('nutritionReviewAuditLogs').doc(), {
        action: `meal_review.${action}`,
        actorUid: context.uid,
        targetReviewId: reviewId,
        targetUserId: userId,
        beforeStatus: review.status || 'pending',
        afterStatus: nextStatus,
        revision: nextRevision,
        scope: allScope ? 'all' : 'assigned',
        createdAt: FieldValue.serverTimestamp(),
      })
      result = { reviewId, status: nextStatus, revision: nextRevision, reviewedAt: action === 'feedback' ? null : now }
    })
    return result
  })

  return {
    saveNutritionMealLog,
    deleteNutritionMealLog,
    submitNutritionMealReview,
    listNutritionMealReviews,
    assignNutritionCoach,
    reviewNutritionMeal,
  }
}

module.exports = {
  createNutritionReviewFunctions,
  reviewRecord,
  reviewPriority,
  reviewSummary,
  pageCursor,
  nextPageCursor,
  sanitizeMealInput,
  snapshotHash,
  nutritionMealWriteReceiptId,
  ALL_REVIEW_CAPABILITY,
  DEFAULT_REVIEW_SLA_MINUTES,
}
