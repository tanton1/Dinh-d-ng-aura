import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { progressPhotoCacheKeys, readProgressPhotoCache, shouldApplyPhotoSnapshot, writeProgressPhotoCache } from '../src/dataSync/progressPhotoCache'

const photos = [{ id: 'photo-a', imageUrl: 'local-fixture', angle: 'front' }]

test('an empty photo snapshot replaces both legacy caches instead of resurrecting deleted photos', () => {
  const cache = new Map(progressPhotoCacheKeys('alice').map((key) => [key, JSON.stringify(photos)]))
  writeProgressPhotoCache('alice', [], (key, value) => cache.set(key, value))
  assert.deepEqual(readProgressPhotoCache('alice', (key) => cache.get(key) ?? null), [])
  assert.ok([...cache.values()].every((value) => value === '[]'))
})

test('an explicitly empty primary key wins over an older fallback', () => {
  const [primary, fallback] = progressPhotoCacheKeys('alice')
  const cache = new Map([[primary, '[]'], [fallback, JSON.stringify(photos)]])
  assert.deepEqual(readProgressPhotoCache('alice', (key) => cache.get(key) ?? null), [])
})

test('photo caches are owner-scoped and preserve existing local draft entries', () => {
  const cache = new Map<string, string>()
  const pending = [...photos, { id: 'pending-upload', imageUrl: 'data:image/jpeg;base64,draft', angle: 'front' }]
  writeProgressPhotoCache('alice', pending, (key, value) => cache.set(key, value))
  assert.deepEqual(readProgressPhotoCache('bob', (key) => cache.get(key) ?? null), [])
  assert.deepEqual(readProgressPhotoCache('alice', (key) => cache.get(key) ?? null), pending)
})

test('malformed or restricted cache storage cannot crash the photo page', () => {
  const [primary, fallback] = progressPhotoCacheKeys('alice')
  const cache = new Map([[primary, '{bad json'], [fallback, JSON.stringify(photos)]])
  assert.deepEqual(readProgressPhotoCache('alice', (key) => cache.get(key) ?? null), photos)
  assert.deepEqual(readProgressPhotoCache('alice', () => { throw new Error('storage denied') }), [])
  assert.doesNotThrow(() => writeProgressPhotoCache('alice', [], () => { throw new Error('quota') }))
})

test('photo component resets by account and accepts empty snapshots only while mounted', () => {
  const source = readFileSync('src/components/progress/ProgressPhotosCard.tsx', 'utf8')
  assert.match(source, /key=\{props.ownerId\}/)
  assert.match(source, /active && shouldApplyPhotoSnapshot\(data, serverConfirmed\)/)
  assert.match(source, /if \(serverConfirmed\) writeProgressPhotoCache/)
  assert.match(source, /active = false; unsub\(\)/)
  assert.doesNotMatch(source, /Array\.isArray\(data\) && data.length > 0/)
})

test('empty offline, pending-write and error fallbacks cannot erase the confirmed photo cache', () => {
  assert.equal(shouldApplyPhotoSnapshot([], false), false)
  assert.equal(shouldApplyPhotoSnapshot([], true), true)
  assert.equal(shouldApplyPhotoSnapshot(photos, false), true)
  assert.equal(shouldApplyPhotoSnapshot(null, true), false)
  const service = readFileSync('src/services/firebaseProgressService.ts', 'utf8')
  assert.match(service, /serverConfirmed = !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites/)
  assert.match(service, /if \(serverConfirmed\) writeCache/)
  assert.match(service, /onData\(readCache\(`\$\{cacheName\}:\$\{userId\}`, \[\]\), false\)/)
})
