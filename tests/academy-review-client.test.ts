import assert from 'node:assert/strict'
import test from 'node:test'
import { createAcademyReviewClient } from '../src/features/academy/reviewClient'
import type { AcademyReviewState } from '../src/services/academyLearningService'

const empty = (): AcademyReviewState => ({ version: 1, cards: {} })
function card(reviewedAt: number, dueAt = reviewedAt + 1): AcademyReviewState['cards'][string] {
  return { lessonId: 'chapter-01-core', cardId: 'one', rating: 'good', repetitions: 1, intervalDays: 1, reviewedAt, dueAt }
}
const key = 'chapter-01-core:one'
function fixture() {
  let session: { uid: string } | null = { uid: 'learner-a' }
  let now = 1000
  let reads = 0
  let writes = 0
  const local = new Map<string, AcademyReviewState>()
  let remote: () => Promise<AcademyReviewState> = async () => ({ version: 1, cards: { [key]: card(10) } })
  const client = createAcademyReviewClient({ session: () => session, now: () => now, ttlMs: 100,
    readLocal: (owner, course) => structuredClone(local.get(`${owner}/${course}`) ?? empty()),
    writeLocal: (owner, course, state) => { writes += 1; local.set(`${owner}/${course}`, structuredClone(state)) },
    readRemote: async () => { reads += 1; return remote() },
  })
  return { client, local, reads: () => reads, writes: () => writes,
    advance: (ms: number) => { now += ms }, changeOwner: (uid: string | null) => { session = uid ? { uid } : null },
    remote: (value: () => Promise<AcademyReviewState>) => { remote = value },
  }
}

test('review history reads deduplicate within a course and expire without extending TTL on reuse', async () => {
  const f = fixture()
  await Promise.all([f.client.load('learner-a', 'course'), f.client.load('learner-a', 'course')])
  assert.equal(f.reads(), 1)
  f.advance(99)
  await f.client.load('learner-a', 'course')
  assert.equal(f.reads(), 1)
  f.advance(1)
  await f.client.load('learner-a', 'course')
  assert.equal(f.reads(), 2)
  await f.client.load('learner-a', 'another-course')
  assert.equal(f.reads(), 3)
})

test('cached remote history merges the latest device ratings every time, including edits during a slow query', async () => {
  const f = fixture()
  let release!: (state: AcademyReviewState) => void
  f.remote(() => new Promise((resolve) => { release = resolve }))
  const loading = f.client.load('learner-a', 'course')
  await Promise.resolve()
  f.local.set('learner-a/course', { version: 1, cards: { [key]: card(20, 5000) } })
  release({ version: 1, cards: { [key]: card(30, 40) } })
  assert.equal((await loading).cards[key].dueAt, 5000)
  assert.equal((await f.client.load('learner-a', 'course')).cards[key].dueAt, 5000)
  // A later local rating still wins over the remote snapshot already in cache.
  f.local.set('learner-a/course', { version: 1, cards: { [key]: card(50, 9000) } })
  assert.equal((await f.client.load('learner-a', 'course')).cards[key].dueAt, 9000)
  assert.equal(f.reads(), 1)
})

test('late history from another session cannot write local state or invalidate the new session cache', async () => {
  const f = fixture()
  let release!: (state: AcademyReviewState) => void
  f.remote(() => new Promise((resolve) => { release = resolve }))
  const old = f.client.load('learner-a', 'course')
  await Promise.resolve()
  f.changeOwner('learner-b')
  f.remote(async () => empty())
  await f.client.load('learner-b', 'course')
  release({ version: 1, cards: { [key]: card(10) } })
  await assert.rejects(old, /Phiên|scope|session/i)
  assert.equal(f.local.has('learner-a/course'), false)
  assert.equal(f.writes(), 1)
  await f.client.load('learner-b', 'course')
  assert.equal(f.reads(), 2)
  await assert.rejects(f.client.load('learner-a', 'course'), /Phiên/)
  f.changeOwner(null)
  await assert.rejects(f.client.load('learner-b', 'course'), /Phiên/)
})

test('a failed history query does not report empty history or poison retry, and reset forces a fresh read', async () => {
  const f = fixture()
  f.remote(async () => { throw new Error('permission-denied') })
  await assert.rejects(f.client.load('learner-a', 'course'), /permission-denied/)
  assert.equal(f.writes(), 0)
  f.remote(async () => empty())
  await f.client.load('learner-a', 'course')
  assert.equal(f.reads(), 2)
  f.client.clear()
  await f.client.load('learner-a', 'course')
  assert.equal(f.reads(), 3)
})
