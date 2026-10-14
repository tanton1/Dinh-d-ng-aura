// A captured assignment owns one unfinished review, not the learner's history.
// Only the server writes these fields; client meal payloads never supply them.
const { effectiveContractStatus } = require('./contract-status')

const ASSIGNMENT_SNAPSHOT_VERSION = 1
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
const uniqueIds = (values) => [...new Set(values.filter(validId))]

function reviewActorIds(context) {
  return uniqueIds([context.uid, context.legacyStaffId])
}

function capturedCoachIds(review = {}) {
  return review.assignmentSnapshotVersion === ASSIGNMENT_SNAPSHOT_VERSION && Array.isArray(review.assignedCoachIds)
    ? uniqueIds(review.assignedCoachIds).slice(0, 10) : []
}

function ownsCapturedPendingReview(review, context) {
  return review.status === 'pending'
    && reviewActorIds(context).some((id) => capturedCoachIds(review).includes(id))
}

async function resolveNutritionAssignment(db, read, userId, today) {
  const [linkedStudents, identityAssignment] = await Promise.all([
    read(db.collection('students').where('accountUid', '==', userId).limit(2)),
    read(db.doc(`roleAssignments/${userId}`)),
  ])
  // Canonical identity wins over a legacy CRM link. An ambiguous/quarantined
  // identity must stay in the admin queue instead of granting a staff scope.
  if (linkedStudents.docs.length > 1 || linkedStudents.docs.some((item) => item.data()?.identityLinkStatus === 'quarantined')) {
    return { studentId: null, coachIds: [], contractIds: [], branchIds: [] }
  }
  const legacyId = identityAssignment.exists ? identityAssignment.data()?.crmProfileId : ''
  const studentId = linkedStudents.docs[0]?.id || (validId(legacyId) ? legacyId : userId)
  const studentIds = uniqueIds([studentId, userId])
  const contracts = await read(db.collection('contracts').where('studentId', 'in', studentIds).limit(50))
  const active = contracts.docs.filter((item) => effectiveContractStatus(item.data(), today) === 'active')
  return {
    studentId,
    coachIds: uniqueIds(active.flatMap((item) => Array.isArray(item.data()?.nutritionPTIds) ? item.data().nutritionPTIds : [])).slice(0, 10),
    contractIds: active.map((item) => item.id),
    branchIds: uniqueIds(active.map((item) => item.data()?.branchId)),
  }
}

function capturedPendingQuery(db, actorIds) {
  return db.collection('mealReviews')
    .where('assignmentSnapshotVersion', '==', ASSIGNMENT_SNAPSHOT_VERSION)
    .where('status', '==', 'pending')
    .where('assignedCoachIds', 'array-contains-any', actorIds)
}

module.exports = {
  ASSIGNMENT_SNAPSHOT_VERSION,
  reviewActorIds,
  capturedCoachIds,
  ownsCapturedPendingReview,
  resolveNutritionAssignment,
  capturedPendingQuery,
}
