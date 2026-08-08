/**
 * Utility for safe window.localStorage operations to prevent QuotaExceededError from crashing the app.
 */

export function safeLocalStorageSet(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch (e: any) {
    if (
      e?.name === 'QuotaExceededError' ||
      e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e?.code === 22 ||
      e?.code === 1014
    ) {
      console.warn(`[safeLocalStorageSet] QuotaExceededError for key "${key}". Attempting cache cleanup...`)
      try {
        // Clear non-critical large cache items (e.g. aura:cache:*, aura:progress-photos:*, push_logs)
        const keysToRemove: string[] = []
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i)
          if (
            k &&
            (k.startsWith('aura:cache:') ||
              k.includes('progress-photos') ||
              k.includes('push_logs') ||
              k.includes('before') ||
              k.includes('after')) &&
            k !== key
          ) {
            keysToRemove.push(k)
          }
        }
        keysToRemove.forEach((k) => {
          try {
            window.localStorage.removeItem(k)
          } catch {
            /* ignore */
          }
        })

        // Try setting again after cleanup
        window.localStorage.setItem(key, value)
        return true
      } catch (retryErr) {
        console.warn(`[safeLocalStorageSet] Could not save item "${key}" even after cache cleanup:`, retryErr)
        return false
      }
    }
    console.warn(`[safeLocalStorageSet] Error setting key "${key}":`, e)
    return false
  }
}

export function safeLocalStorageGet(key: string, fallback: string | null = null): string | null {
  if (typeof window === 'undefined') return fallback
  try {
    return window.localStorage.getItem(key) ?? fallback
  } catch (e) {
    return fallback
  }
}

export function safeLocalStorageRemove(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch (e) {
    // ignore
  }
}
