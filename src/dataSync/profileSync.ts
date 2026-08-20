import type { UserProfile } from '../types'

export const PROFILE_CACHE_SCHEMA_VERSION = 2 as const
const PROFILE_CACHE_PREFIX = 'aura:profile-cache:v2:'

export type DataSyncStatus =
  | 'synced'
  | 'pending-local-change'
  | 'offline-readonly'
  | 'sync-failed'
  | 'conflict'
  | 'stale-cache'

export interface DataSyncState {
  status: DataSyncStatus
  revision: number
  cachedAt: string | null
  message?: string
}

export interface ProfileCacheEnvelope {
  schemaVersion: typeof PROFILE_CACHE_SCHEMA_VERSION
  ownerId: string
  revision: number
  cachedAt: string
  source: 'firestore-confirmed'
  value: UserProfile
}

export const initialProfileSyncState: DataSyncState = {
  status: 'synced',
  revision: 0,
  cachedAt: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isUserProfile(value: unknown, ownerId: string): value is UserProfile {
  if (!isRecord(value)) return false
  return value.uid === ownerId
    && typeof value.email === 'string'
    && typeof value.displayName === 'string'
    && typeof value.role === 'string'
    && typeof value.membership === 'string'
}

export function profileCacheKey(ownerId: string) {
  return `${PROFILE_CACHE_PREFIX}${ownerId}`
}

export function readProfileCache(ownerId: string): ProfileCacheEnvelope | null {
  if (typeof window === 'undefined' || !ownerId) return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(profileCacheKey(ownerId)) ?? 'null') as unknown
    if (!isRecord(parsed)
      || parsed.schemaVersion !== PROFILE_CACHE_SCHEMA_VERSION
      || parsed.ownerId !== ownerId
      || parsed.source !== 'firestore-confirmed'
      || !Number.isSafeInteger(parsed.revision)
      || Number(parsed.revision) < 0
      || !isIsoDate(parsed.cachedAt)
      || !isUserProfile(parsed.value, ownerId)) return null
    return parsed as unknown as ProfileCacheEnvelope
  } catch {
    return null
  }
}

export function writeProfileCache(ownerId: string, profile: UserProfile, revision: number, cachedAt = new Date().toISOString()) {
  if (typeof window === 'undefined' || !ownerId || profile.uid !== ownerId) return false
  const envelope: ProfileCacheEnvelope = {
    schemaVersion: PROFILE_CACHE_SCHEMA_VERSION,
    ownerId,
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    cachedAt,
    source: 'firestore-confirmed',
    value: profile,
  }
  try {
    window.localStorage.setItem(profileCacheKey(ownerId), JSON.stringify(envelope))
    return true
  } catch {
    return false
  }
}

export function resolveProfileRevision(data: Record<string, unknown>) {
  if (Number.isSafeInteger(data.revision) && Number(data.revision) >= 0) return Number(data.revision)
  const updatedAt = data.updatedAt
  if (isRecord(updatedAt)) {
    if (typeof updatedAt.toMillis === 'function') {
      const millis = (updatedAt.toMillis as () => unknown)()
      if (typeof millis === 'number' && Number.isSafeInteger(millis) && millis >= 0) return millis
    }
    const seconds = typeof updatedAt.seconds === 'number' ? updatedAt.seconds : updatedAt._seconds
    if (typeof seconds === 'number' && Number.isSafeInteger(seconds) && seconds >= 0) return seconds * 1_000
  }
  return 0
}

export function formatSyncTimestamp(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(value))
}
