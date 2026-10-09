import assert from 'node:assert/strict'
import test from 'node:test'
import { presentIdentityAccessError } from '../src/services/identityAccessErrors'

test('suspend errors never expose raw internal or claim that no change happened', () => {
  const error = presentIdentityAccessError({ code: 'functions/internal', message: 'internal' }, 'suspend')
  assert.doesNotMatch(error.message, /^internal$/i)
  assert.match(error.message, /tải lại danh sách/i)
  assert.doesNotMatch(error.message, /chưa có thay đổi nào được xác nhận/i)
})

test('auth sync pending explains that Aura access may already be locked', () => {
  const error = presentIdentityAccessError({
    code: 'functions/unavailable',
    message: 'internal',
    details: { errorCode: 'ACCESS_AUTH_SYNC_PENDING', retryable: true },
  }, 'suspend')
  assert.match(error.message, /đã được khóa/i)
  assert.match(error.message, /thử khóa lại để hoàn tất/i)
  assert.doesNotMatch(error.message, /không cần khóa lại/i)
})

test('meaningful callable validation messages are preserved', () => {
  const error = presentIdentityAccessError({ code: 'functions/failed-precondition', message: 'Tài khoản đang bị khóa.' }, 'assign')
  assert.equal(error.message, 'Tài khoản đang bị khóa.')
})

test('timeout and missing responses never claim that an account was not created', () => {
  for (const code of ['deadline-exceeded', 'internal', 'unavailable']) {
    const error = presentIdentityAccessError({ code: `functions/${code}`, message: code }, 'invite')
    assert.match(error.message, /có thể đã được tạo/i)
    assert.match(error.message, /kiểm tra/i)
  }
})

test('nested Auth sync details still require completion of the lock', () => {
  const error = presentIdentityAccessError({ code: 'functions/unavailable', customData: { details: { errorCode: 'ACCESS_AUTH_SYNC_PENDING' } } }, 'suspend')
  assert.match(error.message, /thử khóa lại để hoàn tất/i)
})
