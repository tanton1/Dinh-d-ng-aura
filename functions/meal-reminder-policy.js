function normalizedMealReminderSlot(value) {
  const normalized = typeof value === 'string'
    ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : ''
  if (normalized === 'breakfast' || normalized === 'bua sang' || normalized.startsWith('bua sang ')) return 'breakfast'
  if (normalized === 'lunch' || normalized === 'bua trua' || normalized.startsWith('bua trua ')) return 'lunch'
  if (normalized === 'dinner' || normalized === 'bua toi' || normalized.startsWith('bua toi ')) return 'dinner'
  if (normalized === 'snack' || normalized === 'bua phu' || normalized.startsWith('bua phu ')) return 'snack'
  return null
}

function loggedMealSlots(documents) {
  const slots = new Set()
  for (const document of documents || []) {
    const value = typeof document?.data === 'function' ? document.data() : document
    if (!value || value.deleted === true || value.status === 'deleted') continue
    const slot = normalizedMealReminderSlot(
      value.mealType || value.type || value.meal?.mealType || value.meal?.type || value.label,
    )
    if (slot) slots.add(slot)
  }
  return slots
}

module.exports = { loggedMealSlots, normalizedMealReminderSlot }
