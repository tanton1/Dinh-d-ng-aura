const assert = require('node:assert/strict')
const { test } = require('node:test')

const {
  normalizedPhone,
  initialPasswordFromPhone,
  loginEmailFromPhone,
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
