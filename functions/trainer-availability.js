'use strict'

const SUBMITTED_STATUSES = new Set(['submitted', 'locked'])

function submittedForWeek(value, week) {
  return value?.weekId === week && SUBMITTED_STATUSES.has(value.status)
}

// Keep the exact document read even when it is missing: transactions must
// retry if a PT registers the target week while a schedule is being changed.
// The indexed fallback reads at most one prior submission, never future weeks
// or drafts. Do not cache this query; earlier weeks remain editable.
async function loadTrainerAvailability(db, trainerId, week, transaction = null, exactSnapshot) {
  const exact = exactSnapshot || await (transaction
    ? transaction.get(db.doc(`trainerAvailability/${trainerId}_${week}`))
    : db.doc(`trainerAvailability/${trainerId}_${week}`).get())
  if (exact.exists && submittedForWeek(exact.data(), week)) return exact
  const query = db.collection('trainerAvailability')
    .where('trainerId', '==', trainerId)
    .where('status', 'in', [...SUBMITTED_STATUSES])
    .where('weekId', '<', week)
    .orderBy('weekId', 'desc')
    .limit(1)
  const previous = await (transaction ? transaction.get(query) : query.get())
  return previous.docs[0] || exact
}

async function loadTrainerAvailabilityWeeks(db, requests, transaction = null) {
  const result = []
  // Bound parallel reads for large rosters; exact weeks need no history query.
  for (let index = 0; index < requests.length; index += 50) {
    const chunk = requests.slice(index, index + 50)
    const refs = chunk.map(({ trainerId, weekId }) => db.doc(`trainerAvailability/${trainerId}_${weekId}`))
    const exact = transaction ? await Promise.all(refs.map((ref) => transaction.get(ref))) : await db.getAll(...refs)
    result.push(...await Promise.all(chunk.map(({ trainerId, weekId }, position) =>
      loadTrainerAvailability(db, trainerId, weekId, transaction, exact[position]))))
  }
  return result
}

// All readers use exact week > nearest submitted prior week > recurring.
// An explicitly empty submission is authoritative, including when inherited.
function trainerProfileForWeek(profile = {}, weekly = null, week = '') {
  if (!weekly || !week || !/^\d{4}-\d{2}-\d{2}$/.test(weekly.weekId || '') || weekly.weekId > week || !SUBMITTED_STATUSES.has(weekly.status)) {
    return profile
  }
  const start = Date.parse(`${weekly.weekId}T00:00:00Z`)
  const offDates = [...new Set(Array.isArray(weekly.offDates) ? weekly.offDates : [])]
    .filter((date) => typeof date === 'string' && date >= weekly.weekId && Date.parse(`${date}T00:00:00Z`) < start + 7 * 86400000)
  const offDays = new Set(offDates.map((date) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay()
    return day === 0 ? 'CN' : `T${day + 1}`
  }))
  const slots = [...new Set(Array.isArray(weekly.slots) ? weekly.slots.slice(0, 100) : [])]
    .filter((slot) => typeof slot === 'string' && !offDays.has(slot.split('-')[0]))
  return {
    ...profile,
    availableSlots: slots,
    availabilityMode: slots.length ? 'configured' : 'unconfigured',
    availabilityRevision: Number(weekly.revision || 0),
    availabilitySource: weekly.weekId === week ? 'weekly' : 'inherited_weekly',
    availabilityWeekId: week,
    availabilitySourceWeekId: weekly.weekId,
    // Inherit the saved hour set, but never carry dated OFF markers forward.
    offDates: weekly.weekId === week ? offDates : [],
  }
}

function trainerWeekIsEditable(weekId, now = new Date()) {
  const local = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  const weekday = local.getUTCDay() || 7
  local.setUTCDate(local.getUTCDate() - weekday + 1)
  const current = local.toISOString().slice(0, 10)
  local.setUTCDate(local.getUTCDate() + 7)
  return weekId === current || weekId === local.toISOString().slice(0, 10)
}

module.exports = { trainerProfileForWeek, trainerWeekIsEditable, loadTrainerAvailability, loadTrainerAvailabilityWeeks }
