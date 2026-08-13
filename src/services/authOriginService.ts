const productionAppOrigin = 'https://dinh-duong-aura.vercel.app'
const configuredAuthOrigin = import.meta.env.VITE_AUTH_CANONICAL_ORIGIN?.trim()

function isLegacyFirebaseHostingOrigin(value: string) {
  try {
    const hostname = new URL(value).hostname
    return hostname.endsWith('.web.app') || hostname.endsWith('.firebaseapp.com')
  } catch {
    return true
  }
}

// Vercel is the single public application host. Ignore the previous
// Firebase Hosting value if it is still present in an older deployment env.
export const canonicalAuthOrigin = (
  configuredAuthOrigin && !isLegacyFirebaseHostingOrigin(configuredAuthOrigin)
    ? configuredAuthOrigin
    : productionAppOrigin
).replace(/\/$/, '')

function isLocalAuthOrigin(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

/**
 * Firebase Auth validates the page origin before opening Google/reCAPTCHA.
 * The production Vercel domain is authorized in Firebase Auth; preview and
 * legacy hosts enter authentication through that single public origin.
 */
export function getCanonicalAuthRedirectUrl() {
  if (typeof window === 'undefined' || isLocalAuthOrigin(window.location.hostname)) return null
  const canonicalUrl = new URL(canonicalAuthOrigin)
  if (window.location.origin === canonicalUrl.origin) return null

  canonicalUrl.pathname = '/'
  canonicalUrl.hash = window.location.hash || '#/'
  return canonicalUrl.toString()
}
