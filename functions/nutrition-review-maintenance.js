const { FieldPath, FieldValue } = require('firebase-admin/firestore')
const { normalizeReviewSlaMinutes, reviewSlaState } = require('./review-sla')
const { mealReviewActionInput, syncOperationalActionSource } = require('./action-center')

// A pending review changes its action exactly once, when it passes its SLA;
// a new or edited review is synchronised by its own trigger. So after a
// complete pass nothing can change before the earliest review still inside
// its SLA comes due, and the 15-minute schedule can skip the scan until then.
// The scan read every pending review and its action on each run, about 2,700
// read units every 15 minutes with nothing to change (Cloud Monitoring,
// 10–11/11/2026), which was over 90% of the read units of an idle hour.
// The cap keeps a full pass at least hourly for records an older tool may have
// written with a submission time in the past.
const MAX_SKIP_MS = 60 * 60_000

function positiveMillis(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

async function refreshMealReviewActions({ db, logger = console, syncSource = syncOperationalActionSource, now = Date.now() }) {
  const stateRef = db.doc('systemJobs/nutritionReviewSla')
  const [state, settings] = await Promise.all([stateRef.get(), db.doc('system/nutrition_review_settings').get()])
  const slaMinutes = normalizeReviewSlaMinutes(settings.exists ? settings.data()?.slaMinutes : undefined)
  const stored = state.data() || {}
  const cursor = typeof stored.cursor === 'string' ? stored.cursor : ''
  const nextSweepAt = positiveMillis(stored.nextSweepAtMillis)
  // Never skip in the middle of a pass or after the SLA policy changed.
  if (!cursor && nextSweepAt && now < nextSweepAt && stored.sweptSlaMinutes === slaMinutes) {
    return { scanned: 0, refreshed: 0, skipped: true, nextSweepAt }
  }

  const base = db.collection('mealReviews').where('status', '==', 'pending').orderBy(FieldPath.documentId()).limit(200)
  let page = await (cursor ? base.startAfter(cursor) : base).get()
  let resumed = Boolean(cursor)
  if (!page.docs.length && cursor) {
    page = await base.get()
    resumed = false
  }
  const passStartedAt = resumed ? positiveMillis(stored.passStartedAtMillis) : now
  const passSlaMinutes = resumed ? stored.passSlaMinutes : slaMinutes
  let earliestDueAt = resumed ? positiveMillis(stored.passEarliestDueAtMillis) : 0

  const actions = page.docs.length
    ? await db.getAll(...page.docs.map((review) => db.doc(`operationalActions/meal_review:${review.id}:review`)))
    : []
  let refreshed = 0
  for (let index = 0; index < page.docs.length; index += 1) {
    const review = page.docs[index]
    const { dueAt } = reviewSlaState(review.data(), slaMinutes, now)
    if (dueAt && dueAt >= now && (!earliestDueAt || dueAt < earliestDueAt)) earliestDueAt = dueAt
    const expected = mealReviewActionInput(review.id, review.data(), slaMinutes, now)
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
  const complete = page.docs.length < 200
  // Only a pass that ran from its first page to its last under one SLA policy
  // says when the next change can happen.
  const trusted = complete && passStartedAt > 0 && passSlaMinutes === slaMinutes
  const nextSweepAtMillis = trusted
    ? Math.min(earliestDueAt || Infinity, passStartedAt + Math.min(slaMinutes * 60_000, MAX_SKIP_MS))
    : 0
  await stateRef.set({
    cursor: complete ? '' : page.docs.at(-1).id,
    passStartedAtMillis: complete ? 0 : passStartedAt,
    passSlaMinutes: complete ? null : passSlaMinutes ?? null,
    passEarliestDueAtMillis: complete ? 0 : earliestDueAt,
    nextSweepAtMillis,
    sweptSlaMinutes: trusted ? slaMinutes : null,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { scanned: page.docs.length, refreshed, skipped: false, nextSweepAt: nextSweepAtMillis || null }
}

module.exports = { MAX_SKIP_MS, refreshMealReviewActions }
