import assert from 'node:assert/strict'
import test from 'node:test'
import type { UserProfile } from '../src/types'
import {
  PROFILE_CACHE_SCHEMA_VERSION,
  profileCacheKey,
  readProfileCache,
  resolveProfileRevision,
  writeProfileCache,
} from '../src/dataSync/profileSync'
import { readVersionedCache, writeVersionedCache } from '../src/dataSync/versionedCache'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  get length() { return this.values.size }
}

const profile: UserProfile = {
  uid: 'student-1',
  email: 'student@example.test',
  displayName: 'Thành viên',
  role: 'student',
  membership: 'free',
  onboardingCompleted: true,
}

function installWindow() {
  const localStorage = new MemoryStorage()
  Object.defineProperty(globalThis, 'window', { value: { localStorage }, configurable: true })
  return localStorage
}

test('only reads a versioned server-confirmed cache for the same owner', () => {
  const storage = installWindow()
  storage.setItem(profileCacheKey(profile.uid), JSON.stringify(profile))
  assert.equal(readProfileCache(profile.uid), null)

  storage.setItem(profileCacheKey(profile.uid), JSON.stringify({
    schemaVersion: PROFILE_CACHE_SCHEMA_VERSION,
    ownerId: 'another-user',
    revision: 4,
    cachedAt: '2026-08-21T10:00:00.000Z',
    source: 'firestore-confirmed',
    value: profile,
  }))
  assert.equal(readProfileCache(profile.uid), null)
})

test('writes and reads a canonical envelope without changing its revision', () => {
  installWindow()
  assert.equal(writeProfileCache(profile.uid, profile, 42, '2026-08-21T10:00:00.000Z'), true)
  const cached = readProfileCache(profile.uid)
  assert.equal(cached?.schemaVersion, 2)
  assert.equal(cached?.revision, 42)
  assert.equal(cached?.value.onboardingCompleted, true)
})

test('rejects cross-account writes and derives a stable revision from Firestore updatedAt', () => {
  installWindow()
  assert.equal(writeProfileCache('another-user', profile, 1), false)
  assert.equal(resolveProfileRevision({ updatedAt: { seconds: 1_723_000_000 } }), 1_723_000_000_000)
  assert.equal(resolveProfileRevision({ revision: 17, updatedAt: { seconds: 1 } }), 17)
})

test('nutrition cache accepts only the matching owner and scope', () => {
  installWindow()
  const validateItems = (value: unknown): value is Array<{ id: string }> => Array.isArray(value)
    && value.every((item) => Boolean(item) && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
  const key = 'aura:nutrition-cache:v2:user_meal_logs:student-1'
  const written = writeVersionedCache(key, 'student-1', 'user_meal_logs', [{ id: 'meal-1' }], 9)
  assert.equal(written?.source, 'firestore-confirmed')
  assert.equal(readVersionedCache(key, 'student-1', 'user_meal_logs', validateItems)?.value[0]?.id, 'meal-1')
  assert.equal(readVersionedCache(key, 'student-2', 'user_meal_logs', validateItems), null)
  assert.equal(readVersionedCache(key, 'student-1', 'user_water_logs', validateItems), null)
})
