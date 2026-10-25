import assert from 'node:assert/strict'
import test from 'node:test'
import { createAcademyMediaClient, type AcademyMediaInput } from '../src/features/academy/mediaClient'

const input: AcademyMediaInput = { ownerId: 'a', courseId: 'course', lessonId: 'lesson', chapterVersion: 'r1_c1', courseRevision: 1,
  storagePath: 'course-media/course/lesson/file.pdf', accessRevision: 'active' }
function fixture() {
  let owner = { uid: 'a' }, now = 100000, reads = 0
  const payloads: Record<string, unknown>[] = []
  const valid = (payload: Record<string, unknown>) => ({ ...payload, contentAccess: payload.authoringPreview ? 'staff-preview' : 'full',
    courseRevision: payload.courseRevision ?? 1, chapterVersion: payload.chapterVersion ?? null,
    url: 'https://storage.example.test/file?signature=opaque', downloadUrl: 'https://storage.example.test/file?signature=download', expiresAt: new Date(now + 300000).toISOString() })
  let respond = async (payload: Record<string, unknown>): Promise<unknown> => valid(payload)
  const client = createAcademyMediaClient({ session: () => owner, now: () => now,
    safeUrl: (value) => typeof value === 'string' && value.startsWith('https://') ? value : null,
    read: (payload) => { reads += 1; payloads.push(payload); return respond(payload) } })
  return { client, valid, payloads, reads: () => reads, advance: (ms: number) => { now += ms },
    owner: (uid: string) => { owner = { uid } }, respond: (callback: typeof respond) => { respond = callback } }
}
test('media lease deduplicates concurrent readers, reuses valid links and never extends the fixed cache window', async () => {
  const f = fixture()
  const [a, b] = await Promise.all([f.client.load(input), f.client.load(input)])
  assert.equal(f.reads(), 1); assert.deepEqual(a, b)
  a.url = 'tampered'
  f.advance(269999)
  assert.notEqual((await f.client.load(input)).url, 'tampered'); assert.equal(f.reads(), 1)
  f.advance(1)
  await f.client.load(input); assert.equal(f.reads(), 2)
  assert.equal(f.payloads[0].chapterVersion, input.chapterVersion)
})
test('media cache separates course revision, exact chapter, staff preview, observed access and authenticated session', async () => {
  const f = fixture()
  await f.client.load(input)
  await f.client.load({ ...input, chapterVersion: 'r2_c1', courseRevision: 2 })
  await f.client.load({ ...input, authoringPreview: true })
  await f.client.load({ ...input, accessRevision: 'membership-changed' })
  f.owner('a')
  await f.client.load(input)
  assert.equal(f.reads(), 5)
  await assert.rejects(f.client.load({ ...input, ownerId: 'b' }), { code: 'functions/unauthenticated' })
  assert.equal(f.reads(), 5)
})
test('media rejects wrong scope, versions, path, expired URLs and unsafe links instead of caching an invalid lease', async () => {
  for (const patch of [{ chapterVersion: 'old' }, { courseId: 'other' }, { lessonId: 'other' }, { courseRevision: 0 },
    { contentAccess: 'staff-preview' }, { path: 'other' }, { expiresAt: 100000 }, { expiresAt: undefined }, { url: 'javascript:alert(1)' }]) {
    const f = fixture()
    f.respond(async (payload) => ({ ...f.valid(payload), ...patch }))
    await assert.rejects(f.client.load(input))
    f.respond(async (payload) => f.valid(payload))
    await f.client.load(input)
    assert.equal(f.reads(), 2)
  }
})
test('unobserved server denial at lease refresh clears links; explicit retry can recover without a poisoned cache', async () => {
  const f = fixture()
  await f.client.load(input); f.advance(270000)
  f.respond(async () => { throw Object.assign(new Error('Revoked'), { code: 'functions/permission-denied' }) })
  await assert.rejects(f.client.load(input), { code: 'functions/permission-denied' })
  f.respond(async (payload) => f.valid(payload))
  await f.client.load(input); assert.equal(f.reads(), 3)
})
test('late media from an old account cannot be returned or evict the new account cache', async () => {
  const f = fixture(); let release!: (value: unknown) => void
  f.respond(() => new Promise((resolve) => { release = resolve }))
  const old = f.client.load(input); await Promise.resolve()
  f.owner('b'); f.respond(async (payload) => f.valid(payload))
  await f.client.load({ ...input, ownerId: 'b' })
  release(f.valid(f.payloads[0]))
  await assert.rejects(old, { code: 'functions/unauthenticated' })
  await f.client.load({ ...input, ownerId: 'b' }); assert.equal(f.reads(), 2)
})
test('legacy requests remain compatible, while explicitly bound legacy revisions and staff drafts cannot accept a different root', async () => {
  const f = fixture()
  await f.client.load({ ...input, chapterVersion: undefined, courseRevision: undefined })
  f.respond(async (payload) => ({ ...f.valid(payload), courseRevision: 2 }))
  await assert.rejects(f.client.load({ ...input, chapterVersion: undefined }), { code: 'functions/aborted' })
  await assert.rejects(f.client.load({ ...input, authoringPreview: true }), { code: 'functions/aborted' })
})
