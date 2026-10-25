import test from 'node:test'
import assert from 'node:assert/strict'
import { createAcademySessionCache } from '../src/features/academy/sessionCache'

const cache = (now = () => 1) => createAcademySessionCache<{ text: string }>({ ttlMs: 100, maxEntries: 2, maxBytes: 100, now })
test('one read per exact version and access scope; pending reads join but callers cannot mutate shared content', async () => {
  const f = cache(); f.setScope({}, 'active-free'); let reads = 0
  const loader = async () => { reads += 1; return { text: 'v1' } }
  const [a, b] = await Promise.all([f.read('course/chapter/v1', loader), f.read('course/chapter/v1', loader)])
  a.value.text = 'mutated'
  assert.equal(b.value.text, 'v1')
  assert.equal((await f.read('course/chapter/v1', loader)).value.text, 'v1')
  assert.equal(reads, 1)
  await f.read('course/chapter/v2', loader)
  assert.equal(reads, 2)
})
test('account or access changes invalidate both memory and pending results, even for the same UID', async () => {
  const f = cache(); const session = {}; f.setScope(session, 'active')
  let resolve: (value: { text: string }) => void = () => undefined
  const read = f.read('chapter', () => new Promise((done) => { resolve = done }))
  await Promise.resolve()
  f.setScope(session, 'cancelled'); resolve({ text: 'old-authorized-content' })
  await assert.rejects(read, { code: 'academy/cache-scope-changed' })
  assert.equal(f.size(), 0)
  await f.read('chapter', async () => ({ text: 'preview' }))
  f.setScope({}, 'cancelled')
  assert.equal(f.peek('chapter'), undefined)
})
test('fixed TTL is not prolonged by reading and LRU/memory limits are enforced', async () => {
  let now = 10; const f = cache(() => now); f.setScope({}, 'active')
  const load = async () => ({ text: 'content' })
  await f.read('a', load); now = 80; f.peek('a'); now = 111
  assert.equal(f.peek('a'), undefined)
  await f.read('a', load); await f.read('b', load); f.peek('a'); await f.read('c', load)
  assert.equal(f.peek('b'), undefined)
  assert.equal(f.size(), 2)
  assert.ok(f.bytes() <= 100)
  await f.read('oversized', async () => ({ text: 'x'.repeat(101) }))
  assert.equal(f.peek('oversized'), undefined)
})
test('failures are not cached, and a cleared old operation cannot delete a new pending request', async () => {
  const f = cache(); f.setScope({}, 'active')
  await assert.rejects(f.read('a', async () => { throw new Error('unavailable') }), /unavailable/)
  let resolve: (value: { text: string }) => void = () => undefined
  const old = f.read('a', () => new Promise((done) => { resolve = done }))
  await Promise.resolve(); f.clear()
  const fresh = f.read('a', async () => ({ text: 'new' }))
  resolve({ text: 'old' })
  await assert.rejects(old, { code: 'academy/cache-scope-changed' })
  assert.equal((await fresh).value.text, 'new')
  assert.equal(f.peek('a')?.value.text, 'new')
})
