import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityOriginLabel, hasUnconfirmedLegacyAvailability } from '../src/features/schedule/availabilityPresentation'
import { availabilityReasonOverride, unconfirmedAvailabilityNote } from '../src/features/schedule/availabilityDetail'

// Mirrors a learner migrated from the old app whose slots were never
// confirmed: the optimizer reports AVAILABILITY_NOT_SUBMITTED while the
// workspace still lists twelve slots for the week.
const legacyUnconfirmed = {
  availabilityStatus: 'missing',
  availabilitySource: 'legacy_default',
  availabilitySourceWeekId: null,
  availableSlots: ['T2-8', 'T3-8', 'T4-8', 'T5-8', 'T6-8', 'T7-8', 'T2-15', 'T3-15', 'T4-15', 'T5-15', 'T6-15', 'T7-15'],
}

test('an unconfirmed legacy default is named instead of a generic missing availability', () => {
  assert.equal(hasUnconfirmedLegacyAvailability(legacyUnconfirmed), true)
  assert.equal(availabilityOriginLabel(legacyUnconfirmed), 'lịch mặc định cũ chưa xác nhận')
  assert.equal(availabilityReasonOverride('AVAILABILITY_NOT_SUBMITTED', legacyUnconfirmed), 'Lịch mặc định cũ chưa được học viên xác nhận.')
  const note = unconfirmedAvailabilityNote(legacyUnconfirmed) || ''
  assert.match(note, /12 khung/)
  assert.match(note, /không dùng để xếp tự động/)
  assert.match(note, /Admin lưu lịch rảnh/)
})

test('confirmed statuses keep their labels and need no note', () => {
  const recurring = { ...legacyUnconfirmed, availabilityStatus: 'recurring' }
  assert.equal(hasUnconfirmedLegacyAvailability(recurring), false)
  assert.equal(availabilityOriginLabel(recurring), 'lịch mặc định cũ')
  assert.equal(unconfirmedAvailabilityNote(recurring), null)
  assert.equal(availabilityReasonOverride('AVAILABILITY_NOT_SUBMITTED', recurring), null)
  assert.equal(availabilityOriginLabel({ availabilityStatus: 'inherited', availabilitySourceWeekId: '2026-11-02' }), 'kế thừa tuần 2026-11-02')
  assert.equal(availabilityOriginLabel({ availabilityStatus: 'submitted' }), 'đã gửi lịch rảnh')
  assert.equal(unconfirmedAvailabilityNote({ availabilityStatus: 'locked', availableSlots: ['T2-8'] }), null)
})

test('a learner with no slots at all is still reported as missing availability', () => {
  const missing = { availabilityStatus: 'missing', availabilitySource: 'none', availableSlots: [] }
  assert.equal(hasUnconfirmedLegacyAvailability(missing), false)
  assert.equal(availabilityOriginLabel(missing), 'thiếu lịch rảnh')
  assert.equal(unconfirmedAvailabilityNote(missing), 'Học viên chưa gửi lịch rảnh tuần này.')
  assert.equal(availabilityReasonOverride('AVAILABILITY_NOT_SUBMITTED', missing), null)
  assert.equal(availabilityReasonOverride('OUTSIDE_STUDENT_AVAILABILITY', legacyUnconfirmed), null)
  assert.equal(unconfirmedAvailabilityNote(null), null)
  assert.equal(availabilityReasonOverride('AVAILABILITY_NOT_SUBMITTED', undefined), null)
})
