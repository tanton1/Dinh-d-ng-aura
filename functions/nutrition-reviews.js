const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext } = require('./identity-access')

const ALL_REVIEW_CAPABILITY = 'nutrition.meals.all.review'
const DEFAULT_REVIEW_SLA_MINUTES = 120
const MAX_REVIEW_SLA_MINUTES = 1440
const MAX_SCOPE_REVIEWS = 1000

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
  const image = meal.image || meal.imageUrl || meal.img || meal.fileName || value.image || value.img
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
    time: shortText(meal.mealDate || meal.date || meal.time || '', 80),
    image: safeImage(image),
    note: shortText(meal.description || meal.note || value.note || meal.dishName || meal.title, 1000),
    mealType: shortText(value.mealType || meal.mealType || 'Bữa ăn', 80),
    totalKcal: finite(meal.calories ?? meal.totalKcal ?? totals.calories ?? value.totalKcal),
    totalProtein: finite(meal.protein ?? meal.totalProtein ?? totals.protein ?? value.totalProtein),
    totalCarb: finite(meal.carb ?? meal.totalCarb ?? totals.carb ?? value.totalCarb),
    totalFat: finite(meal.fat ?? meal.totalFat ?? totals.fat ?? value.totalFat),
    fiber: finite(value.fiber ?? meal.fiber),
    targetKcal: finite(value.targetKcal ?? meal.targetKcal),
    targetProtein: finite(value.targetProtein ?? meal.targetProtein),
    status,
    priority: value.priority === 'high' || meal.priority === 'high' ? 'high' : 'normal',
    aiScore: finite(value.aiScore ?? meal.aiScore),
    confidence: ['low', 'medium', 'high'].includes(value.confidence || meal.confidence)
      ? value.confidence || meal.confidence
      : 'medium',
    coachFeedback: shortText(value.coachFeedback, 2000),
    revision: Math.max(0, Math.trunc(finite(value.revision))),
    items: rawItems.slice(0, 30).map((item) => ({
      name: shortText(item?.name, 160),
      weight: finite(item?.weight),
      kcal: finite(item?.kcal),
      protein: finite(item?.protein),
    })),
    suggestions: rawSuggestions.slice(0, 12).map((item) => ({
      type: item?.type === 'pass' ? 'pass' : 'warn',
      text: shortText(item?.text, 400),
    })).filter((item) => item.text),
    analysis: compactAnalysis(analysis),
  }
}

function canReviewAll(context) {
  return context.capabilities.includes(ALL_REVIEW_CAPABILITY)
}

function canReviewAssigned(context) {
  return context.accessRole === 'staff' && context.status === 'active'
}

async function assignedClientIds(db, context) {
  const coachIds = [...new Set([context.uid, context.legacyStaffId].filter(Boolean))]
  const contractSnapshots = await Promise.all(coachIds.map((coachId) => (
      db.collection('contracts').where('nutritionPTIds', 'array-contains', coachId).limit(200).get()
  )))
  const contractClients = contractSnapshots.flatMap((snapshot) => snapshot.docs
    .filter((item) => ['active', 'future', 'frozen'].includes(item.data()?.status || 'active'))
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
  return [...new Set([...crmIds, ...linkedAccounts])].slice(0, 400)
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
  clientIds.forEach((id) => { if (!crmIdByClientId.has(id)) crmIdByClientId.set(id, id) })
  const crmIds = [...new Set(crmIdByClientId.values())]
  const contracts = []
  for (let index = 0; index < crmIds.length; index += 30) {
    const chunk = crmIds.slice(index, index + 30)
    if (!chunk.length) continue
    const snapshot = await db.collection('contracts').where('studentId', 'in', chunk).get()
    snapshot.docs.forEach((item) => {
      const value = item.data() || {}
      if (['active', 'future', 'frozen'].includes(value.status || 'active')) contracts.push({ id: item.id, ...value })
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
  return documents.map((item) => {
    const userId = item.data()?.userId
    const contract = contractByStudentId.get(crmIdByClientId.get(userId)) || {}
    const assignedCoachIds = Array.isArray(contract.nutritionPTIds) ? contract.nutritionPTIds : []
    const assignment = { coachId: assignedCoachIds[0] || '', coachIds: assignedCoachIds }
    const assignedCoachName = assignedCoachIds.map((id) => coachNames.get(id) || (id === context.legacyStaffId || id === context.uid ? 'Bạn' : 'HLV Aura')).join(' · ')
    return reviewRecord(item, profileMap.get(userId), assignment, assignedCoachName, options)
  })
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

function pageOffset(cursor) {
  if (!cursor) return 0
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))
    const offset = Number(parsed.offset)
    if (parsed.version !== 1 || !Number.isInteger(offset) || offset < 0 || offset > MAX_SCOPE_REVIEWS) throw new Error('invalid')
    return offset
  } catch {
    throw new HttpsError('invalid-argument', 'Con trỏ danh sách duyệt món không hợp lệ.')
  }
}

function nextPageCursor(offset) {
  return Buffer.from(JSON.stringify({ version: 1, offset }), 'utf8').toString('base64url')
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

  const listNutritionMealReviews = reviewCall(async (request) => {
    const context = await trustedAccessContext(request, db)
    const allScope = canReviewAll(context)
    if (!allScope && !canReviewAssigned(context)) {
      throw new HttpsError('permission-denied', 'Bạn chưa được phân quyền chăm sóc dinh dưỡng.')
    }
    const requestedLimit = Number(request.data?.limit)
    const limit = Number.isInteger(requestedLimit) ? Math.min(30, Math.max(6, requestedLimit)) : 24
    const offset = pageOffset(request.data?.cursor)
    const requestedStatus = request.data?.status
    const status = ['pending', 'approved', 'rejected'].includes(requestedStatus) ? requestedStatus : 'all'
    const coachId = typeof request.data?.coachId === 'string' && request.data.coachId.trim()
      ? request.data.coachId.trim().slice(0, 200)
      : 'all'
    const query = typeof request.data?.query === 'string' ? request.data.query.trim().toLocaleLowerCase('vi').slice(0, 120) : ''
    let documents = []
    let assignmentCount = 0
    const [settingsSnapshot] = await Promise.all([db.doc('system/nutrition_review_settings').get()])
    const slaMinutes = normalizeReviewSlaMinutes(settingsSnapshot.exists ? settingsSnapshot.data()?.slaMinutes : undefined)
    if (allScope) {
      const snapshot = await db.collection('mealReviews').limit(MAX_SCOPE_REVIEWS + 1).get()
      documents = snapshot.docs
    } else {
      const clientIds = await assignedClientIds(db, context)
      assignmentCount = clientIds.length
      const chunks = []
      for (let index = 0; index < clientIds.length; index += 30) chunks.push(clientIds.slice(index, index + 30))
      const snapshots = await Promise.all(chunks.map((ids) => (
        db.collection('mealReviews').where('userId', 'in', ids).limit(MAX_SCOPE_REVIEWS + 1).get()
      )))
      documents = snapshots.flatMap((snapshot) => snapshot.docs)
    }
    const uniqueDocuments = [...new Map(documents.map((item) => [item.id, item])).values()]
    const summaryTruncated = uniqueDocuments.length > MAX_SCOPE_REVIEWS
    const [hydrated, coaches] = await Promise.all([
      hydrateReviews(db, uniqueDocuments.slice(0, MAX_SCOPE_REVIEWS), context, { now: Date.now(), slaMinutes }),
      allScope ? availableNutritionCoaches(db) : Promise.resolve([]),
    ])
    const summary = publicReviewSummary(reviewSummary(hydrated))
    const filtered = hydrated.filter((item) => {
      if (status !== 'all' && item.status !== status) return false
      if (coachId === 'unassigned' && item.assignedCoachIds.length) return false
      if (coachId !== 'all' && coachId !== 'unassigned' && !item.assignedCoachIds.includes(coachId)) return false
      if (!query) return true
      return [item.studentName, item.note, item.mealType, item.assignedCoachName]
        .some((value) => String(value || '').toLocaleLowerCase('vi').includes(query))
    }).sort(reviewPriority)
    const reviews = filtered.slice(offset, offset + limit)
    const nextOffset = offset + reviews.length
    const hasMore = nextOffset < filtered.length
    return {
      reviews,
      coaches,
      scope: allScope ? 'all' : 'assigned',
      assignmentCount,
      hasMore,
      nextCursor: hasMore ? nextPageCursor(nextOffset) : null,
      filteredCount: filtered.length,
      summary,
      summaryTruncated,
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
    const feedback = boundedString(request.data?.feedback, 2000, action !== 'reject')
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
        const contractSnapshot = await transaction.get(db.collection('contracts').where('studentId', 'in', [...new Set([userId, crmProfileId])]).limit(20))
        const ownsNutritionCare = contractSnapshot.docs.some((item) => {
          const nutritionCoachIds = Array.isArray(item.data()?.nutritionPTIds) ? item.data().nutritionPTIds : []
          return ['active', 'future', 'frozen'].includes(item.data()?.status || 'active')
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
      const nextStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : (review.status || 'pending')
      const nextRevision = currentRevision + 1
      const now = Date.now()
      const reviewPatch = {
        status: nextStatus,
        coachFeedback: feedback,
        reviewedBy: context.uid,
        reviewedScope: allScope ? 'all' : 'assigned',
        revision: nextRevision,
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (action === 'approve') {
        reviewPatch.approvedAtTimestamp = now
        reviewPatch.approvedAt = FieldValue.serverTimestamp()
      }
      transaction.update(reviewRef, reviewPatch)
      const logData = mealLogSnapshot.exists ? mealLogSnapshot.data() || {} : {}
      const logPatch = {
        coachFeedback: feedback,
        reviewStatus: nextStatus,
        reviewedBy: context.uid,
        reviewRevision: nextRevision,
        updatedAt: FieldValue.serverTimestamp(),
      }
      const snapshotAnalysis = review.analysisSnapshot || meal.analysisSnapshot || meal.aiAnalysis || review.aiAnalysis
      if (!logData.aiAnalysis && snapshotAnalysis && typeof snapshotAnalysis === 'object') logPatch.aiAnalysis = snapshotAnalysis
      transaction.set(mealLogRef, logPatch, { merge: true })
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
      result = { reviewId, status: nextStatus, revision: nextRevision, reviewedAt: now }
    })
    return result
  })

  return { listNutritionMealReviews, assignNutritionCoach, reviewNutritionMeal }
}

module.exports = {
  createNutritionReviewFunctions,
  reviewRecord,
  reviewPriority,
  reviewSummary,
  ALL_REVIEW_CAPABILITY,
  DEFAULT_REVIEW_SLA_MINUTES,
}
