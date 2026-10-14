const { FieldPath, FieldValue } = require('firebase-admin/firestore')
const { normalizeReviewSlaMinutes } = require('./review-sla')
const { mealReviewActionInput, syncOperationalActionSource } = require('./action-center')

async function refreshMealReviewActions({ db, logger = console, syncSource = syncOperationalActionSource }) {
  const stateRef = db.doc('systemJobs/nutritionReviewSla')
  const [state, settings] = await Promise.all([stateRef.get(), db.doc('system/nutrition_review_settings').get()])
  const slaMinutes = normalizeReviewSlaMinutes(settings.exists ? settings.data()?.slaMinutes : undefined)
  const cursor = typeof state.data()?.cursor === 'string' ? state.data().cursor : ''
  const base = db.collection('mealReviews').where('status', '==', 'pending').orderBy(FieldPath.documentId()).limit(200)
  let page = await (cursor ? base.startAfter(cursor) : base).get()
  if (!page.docs.length && cursor) page = await base.get()
  const actions = page.docs.length
    ? await db.getAll(...page.docs.map((review) => db.doc(`operationalActions/meal_review:${review.id}:review`)))
    : []
  let refreshed = 0
  for (let index = 0; index < page.docs.length; index += 1) {
    const review = page.docs[index]
    const expected = mealReviewActionInput(review.id, review.data(), slaMinutes)
    const action = actions[index]
    const existing = action.exists ? action.data() : null
    if (existing?.severity === expected.severity && existing?.redactedSummary === expected.redactedSummary
      && (existing?.dueAt?.toMillis?.() || 0) === (expected.dueAt?.toMillis?.() || 0)) continue
    await syncSource({ db, logger, reviewSlaMinutes: slaMinutes, event: {
      params: { reviewId: review.id },
      data: { after: review, before: { exists: false } },
    } })
    refreshed += 1
  }
  // Continue across a large backlog instead of rechecking the first 200
  // forever. A sweep also corrects old warnings when the SLA policy changes.
  await stateRef.set({ cursor: page.docs.length === 200 ? page.docs.at(-1).id : '', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return { scanned: page.docs.length, refreshed }
}

module.exports = { refreshMealReviewActions }
