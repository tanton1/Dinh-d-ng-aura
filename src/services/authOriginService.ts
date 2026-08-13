const firebaseProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'gen-lang-client-0815966909'

export const canonicalAuthOrigin = (
  import.meta.env.VITE_AUTH_CANONICAL_ORIGIN || `https://${firebaseProjectId}.web.app`
).replace(/\/$/, '')

function isLocalAuthOrigin(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

/**
 * Firebase Auth validates the page origin before opening Google/reCAPTCHA.
 * Preview hosts and PWAs installed from an old host therefore need to enter
 * the auth flow through the canonical Firebase Hosting origin.
 */
export function getCanonicalAuthRedirectUrl() {
  if (typeof window === 'undefined' || isLocalAuthOrigin(window.location.hostname)) return null
  const canonicalUrl = new URL(canonicalAuthOrigin)
  if (window.location.origin === canonicalUrl.origin) return null

  canonicalUrl.pathname = '/'
  canonicalUrl.hash = window.location.hash || '#/'
  return canonicalUrl.toString()
}
