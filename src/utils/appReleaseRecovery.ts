const RECOVERY_MARKER = 'aura:release-recovery'
const CHUNK_ERROR_PATTERN = /chunkloaderror|loading chunk|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css|failed to load module script/i

function entrySignature() {
  if (typeof document === 'undefined') return 'unknown'
  const entry = Array.from(document.scripts).find((script) => script.type === 'module' && script.src)
  return entry?.src || import.meta.env.VITE_APP_RELEASE || 'unknown'
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    const cause = 'cause' in error ? String(error.cause ?? '') : ''
    return `${error.name} ${error.message} ${cause}`
  }
  return String(error ?? '')
}

export function isStaleReleaseError(error: unknown) {
  return CHUNK_ERROR_PATTERN.test(errorMessage(error))
}

export function clearStaleReleaseRecoveryMarker() {
  try {
    if (window.sessionStorage.getItem(RECOVERY_MARKER) === entrySignature()) {
      window.sessionStorage.removeItem(RECOVERY_MARKER)
    }
  } catch {
    // Storage can be unavailable in private browsing; a successful import is enough.
  }
}

async function refreshAppShell() {
  const tasks: Array<Promise<unknown>> = []
  if ('caches' in window) {
    tasks.push(
      window.caches.keys().then((names) => Promise.all(
        names.filter((name) => name.startsWith('aura-shell-')).map((name) => window.caches.delete(name)),
      )),
    )
  }
  if ('serviceWorker' in navigator) {
    tasks.push(
      navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        await Promise.allSettled(registrations.map((registration) => registration.update()))
        registrations.forEach((registration) => registration.waiting?.postMessage({ type: 'SKIP_WAITING' }))
      }),
    )
  }
  await Promise.allSettled(tasks)
}

/**
 * Replaces a stale Vite/PWA document with the latest no-store app shell.
 * Automatic recovery runs once per entry bundle. A manual retry can force a
 * second refresh without creating an automatic reload loop.
 */
export async function recoverFromStaleRelease(options: { force?: boolean } = {}) {
  if (typeof window === 'undefined') return false
  const signature = entrySignature()
  if (!options.force) {
    try {
      if (window.sessionStorage.getItem(RECOVERY_MARKER) === signature) return false
      window.sessionStorage.setItem(RECOVERY_MARKER, signature)
    } catch {
      // Continue; the cache-busting navigation still gives the app one recovery attempt.
    }
  }

  await refreshAppShell()
  const url = new URL(window.location.href)
  url.searchParams.set('_aura_reload', Date.now().toString())
  window.location.replace(url.toString())
  return true
}
