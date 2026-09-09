// Retain both existing keys while the photo studio still writes the legacy key.
// Empty arrays are authoritative snapshots, not a reason to resurrect fallback data.
export const progressPhotoCacheKeys = (ownerId: string) => [
  `aura:progress-photos:${ownerId}`,
  `aura:cache:user_progress_photos:${ownerId}`,
]

export function shouldApplyPhotoSnapshot(photos: unknown, serverConfirmed: boolean): boolean {
  return Array.isArray(photos) && (photos.length > 0 || serverConfirmed)
}

export function readProgressPhotoCache<T extends { id: string }>(
  ownerId: string,
  read: (key: string) => string | null,
): T[] {
  for (const key of progressPhotoCacheKeys(ownerId)) {
    try {
      const raw = read(key)
      if (raw === null) continue
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((item) => item && typeof item.id === 'string')) return parsed as T[]
    } catch {
      // Restricted storage or one malformed key must not break the photo route.
    }
  }
  return []
}

export function writeProgressPhotoCache<T extends { id: string }>(
  ownerId: string,
  photos: T[],
  write: (key: string, value: string) => unknown,
) {
  const value = JSON.stringify(photos)
  for (const key of progressPhotoCacheKeys(ownerId)) {
    try { write(key, value) } catch { /* Cache persistence is best effort. */ }
  }
}
