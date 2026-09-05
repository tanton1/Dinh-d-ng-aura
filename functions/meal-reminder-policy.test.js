const assert = require('node:assert/strict')
const test = require('node:test')
const { loggedMealSlots, normalizedMealReminderSlot } = require('./meal-reminder-policy')

test('meal reminder slots support canonical and legacy Vietnamese labels', () => {
  assert.equal(normalizedMealReminderSlot('breakfast'), 'breakfast')
  assert.equal(normalizedMealReminderSlot('Bữa trưa'), 'lunch')
  assert.equal(normalizedMealReminderSlot('Bữa tối gia đình'), 'dinner')
  assert.equal(normalizedMealReminderSlot('unknown'), null)
})

test('logging breakfast does not suppress lunch or dinner reminders', () => {
  const slots = loggedMealSlots([
    { mealType: 'breakfast' },
    { type: 'snack' },
    { mealType: 'dinner', status: 'deleted' },
  ])
  assert.equal(slots.has('breakfast'), true)
  assert.equal(slots.has('snack'), true)
  assert.equal(slots.has('lunch'), false)
  assert.equal(slots.has('dinner'), false)
})
