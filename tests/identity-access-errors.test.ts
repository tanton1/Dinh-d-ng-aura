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
  assert.match(error.message, /không cần khóa lại/i)
})

test('meaningful callable validation messages are preserved', () => {
  const error = presentIdentityAccessError({ code: 'functions/failed-precondition', message: 'Tài khoản đang bị khóa.' }, 'assign')
  assert.equal(error.message, 'Tài khoản đang bị khóa.')
})
