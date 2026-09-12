type AuthTransitionError = {
  code?: unknown
  message?: unknown
}

const PERSISTENCE_ERROR_PATTERNS = [
  'database is closing/hidden',
  'indexeddb',
  'the database connection is closing',
  'a mutation operation was attempted on a database that did not allow mutations',
]

export function isRecoverableAuthTransitionError(error: unknown) {
  const candidate = error as AuthTransitionError | null
  const code = typeof candidate?.code === 'string' ? candidate.code.toLowerCase() : ''
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : ''

  if (PERSISTENCE_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) return true

  // Some embedded/mobile browsers wrap an IndexedDB persistence failure in
  // Firebase's generic network error. Recovery remains gated by currentUser in
  // AuthContext, so a real network or invalid-credential failure is not hidden.
  return code === 'auth/network-request-failed'
}

export function shouldRecoverAuthenticatedSession(error: unknown, currentUserUid?: string | null) {
  return Boolean(currentUserUid) && isRecoverableAuthTransitionError(error)
}
