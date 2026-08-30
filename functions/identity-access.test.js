const assert = require('node:assert/strict')
const { test } = require('node:test')

const {
  normalizedPhone,
  initialPasswordFromPhone,
  loginEmailFromPhone,
  resolveStaffContactUpdate,
} = require('./identity-access')

test('normalizes a Vietnamese phone for Firebase Auth', () => {
  assert.equal(normalizedPhone('090 123 4567'), '+84901234567')
  assert.equal(normalizedPhone('+84 901-234-567'), '+84901234567')
})

test('uses the local phone number as the initial password', () => {
  assert.equal(initialPasswordFromPhone('+84901234567'), '0901234567')
})

test('derives an Aura login email when a personal email is missing', () => {
  assert.equal(loginEmailFromPhone('', '+84901234567'), '0901234567@aurafitness.vn')
  assert.equal(loginEmailFromPhone('  Nhan.Vien@Example.COM ', '+84901234567'), 'nhan.vien@example.com')
})

test('rejects an invalid optional email instead of silently replacing it', () => {
  assert.throws(() => loginEmailFromPhone('email-khong-hop-le', '+84901234567'), /Email không hợp lệ/)
})

test('keeps canonical Auth contacts when a legacy staff save submits stale projections', () => {
  const result = resolveStaffContactUpdate(
    { email: 'stale@example.com', phoneNumber: '090 999 9999' },
    { email: 'legacy@example.com', phone: '090 888 8888' },
    { email: 'staff@aura.vn', phoneNumber: '+84901234567' },
  )

  assert.deepEqual(result, {
    email: 'staff@aura.vn',
    phoneNumber: '+84901234567',
    emailChanged: false,
    phoneChanged: false,
  })
})

test('updates staff contacts only when the editor explicitly marks them as changed', () => {
  const result = resolveStaffContactUpdate(
    {
      email: ' NEW.STAFF@Example.com ',
      phoneNumber: '091 234 5678',
      contactChanges: { email: true, phoneNumber: true },
    },
    {},
    { email: 'staff@aura.vn', phoneNumber: '+84901234567' },
  )

  assert.deepEqual(result, {
    email: 'new.staff@example.com',
    phoneNumber: '+84912345678',
    emailChanged: true,
    phoneChanged: true,
  })
})

test('does not update Auth when explicitly submitted contacts only differ by case or formatting', () => {
  const result = resolveStaffContactUpdate(
    {
      email: ' STAFF@AURA.VN ',
      phoneNumber: '090 123-4567',
      contactChanges: { email: true, phoneNumber: true },
    },
    {},
    { email: 'staff@aura.vn', phoneNumber: '+84901234567' },
  )

  assert.equal(result.emailChanged, false)
  assert.equal(result.phoneChanged, false)
  assert.equal(result.email, 'staff@aura.vn')
  assert.equal(result.phoneNumber, '+84901234567')
})

test('an operational-only staff save never changes Auth contacts', () => {
  const result = resolveStaffContactUpdate(
    {
      availabilitySlots: ['T2-6', 'T4-18'],
      slotCapacity: 2,
      contactChanges: { email: false, phoneNumber: false },
    },
    { email: 'projected@example.com', phone: '0999999999' },
    { email: 'canonical@aura.vn', phoneNumber: '+84987654321' },
  )

  assert.equal(result.emailChanged, false)
  assert.equal(result.phoneChanged, false)
  assert.equal(result.email, 'canonical@aura.vn')
  assert.equal(result.phoneNumber, '+84987654321')
})
