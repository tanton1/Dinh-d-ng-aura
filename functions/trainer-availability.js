'use strict'

// All scheduling readers resolve the same exact-week override. Recurring
// availability is only the fallback; an explicitly empty week stays empty.
function trainerProfileForWeek(profile = {}, weekly = null, week = '') {
  if (!weekly || weekly.weekId !== week || !['submitted', 'locked'].includes(String(weekly.status || ''))) {
    return profile
  }
  const start = Date.parse(`${week}T00:00:00Z`)
  const offDates = [...new Set(Array.isArray(weekly.offDates) ? weekly.offDates : [])]
    .filter((date) => typeof date === 'string' && date >= week && Date.parse(`${date}T00:00:00Z`) < start + 7 * 86400000)
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
    availabilitySource: 'weekly',
    availabilityWeekId: week,
    offDates,
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

module.exports = { trainerProfileForWeek, trainerWeekIsEditable }
