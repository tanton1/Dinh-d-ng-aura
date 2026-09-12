import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isRecoverableAuthTransitionError,
  shouldRecoverAuthenticatedSession,
} from '../src/auth/authSessionRecovery'

test('recognizes the embedded-browser IndexedDB closing failure', () => {
  assert.equal(isRecoverableAuthTransitionError(new Error('Database is closing/hidden')), true)
  assert.equal(isRecoverableAuthTransitionError({ code: 'auth/network-request-failed' }), true)
})

test('only recovers a generic Firebase network error when a valid current user exists', () => {
  assert.equal(shouldRecoverAuthenticatedSession({ code: 'auth/network-request-failed' }, 'user-123'), true)
  assert.equal(shouldRecoverAuthenticatedSession({ code: 'auth/network-request-failed' }, null), false)
})

test('never hides invalid credentials or unrelated failures', () => {
  assert.equal(shouldRecoverAuthenticatedSession({ code: 'auth/invalid-credential' }, 'stale-user'), false)
  assert.equal(shouldRecoverAuthenticatedSession(new Error('Permission denied'), 'user-123'), false)
})
