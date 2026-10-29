import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = readFileSync('public/sw.js', 'utf8')
const origin = 'https://aura.test'

function worker(options: { cached?: Response; failWrite?: boolean; failNetwork?: boolean } = {}) {
  const handlers = new Map<string, (event: any) => void>()
  const calls: string[] = []
  const writes: string[] = []
  const cache = {
    match: async () => options.cached,
    put: async (_key: unknown, response: Response) => {
      if (options.failWrite) throw new Error('quota')
      writes.push(await response.text())
    },
  }
  runInNewContext(source, {
    URL, Response,
    self: { location: { origin }, addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler) },
    caches: { open: async () => cache, match: cache.match },
    fetch: async (request: { url: string }) => {
      calls.push(request.url)
      if (options.failNetwork) throw new Error('offline')
      return new Response('network')
    },
  })
  function request(path: string, mode = 'cors') {
    let response: Promise<Response> | undefined
    const pending: Promise<unknown>[] = []
    handlers.get('fetch')!({
      request: { method: 'GET', url: `${origin}${path}`, mode },
      respondWith: (value: Promise<Response>) => { response = value },
      waitUntil: (value: Promise<unknown>) => pending.push(value),
    })
    return { response, pending }
  }
  return { request, calls, writes }
}

test('cached versioned bundles require no network refresh', async () => {
  const { request, calls } = worker({ cached: new Response('cached bundle') })
  const event = request('/assets/index-a1b2c3.js')
  assert.equal(await (await event.response!).text(), 'cached bundle')
  await Promise.all(event.pending)
  assert.equal(calls.length, 0)
})

test('a cache miss keeps its write alive after returning the network response', async () => {
  const { request, calls, writes } = worker()
  const event = request('/assets/index-a1b2c3.js')
  assert.equal(await (await event.response!).text(), 'network')
  assert.ok(event.pending.length > 0, 'cache writes must extend the fetch event lifetime')
  await Promise.all(event.pending)
  assert.equal(calls.length, 1)
  assert.deepEqual(writes, ['network'])
})

test('navigation stays network-first and updates its offline document', async () => {
  const { request, calls, writes } = worker({ cached: new Response('old shell') })
  const event = request('/', 'navigate')
  assert.equal(await (await event.response!).text(), 'network')
  assert.ok(event.pending.length > 0)
  await Promise.all(event.pending)
  assert.equal(calls.length, 1)
  assert.deepEqual(writes, ['network'])
})

test('offline navigation returns the cached document', async () => {
  const { request } = worker({ cached: new Response('offline shell'), failNetwork: true })
  assert.equal(await (await request('/', 'navigate').response!).text(), 'offline shell')
})

test('mutable icons keep refreshing in the background', async () => {
  const { request, calls, writes } = worker({ cached: new Response('old icon') })
  const event = request('/icons/aura-icon-192.png')
  assert.equal(await (await event.response!).text(), 'old icon')
  assert.ok(event.pending.length > 0)
  await Promise.all(event.pending)
  assert.equal(calls.length, 1)
  assert.deepEqual(writes, ['network'])
})

test('API and Firebase auth requests bypass the static cache', () => {
  const { request, calls } = worker()
  assert.equal(request('/api/private').response, undefined)
  assert.equal(request('/__/auth/handler').response, undefined)
  assert.equal(calls.length, 0)
})

test('cache write failures do not discard successful network responses', async () => {
  const { request } = worker({ failWrite: true })
  const event = request('/assets/index-a1b2c3.js')
  assert.equal(await (await event.response!).text(), 'network')
  await Promise.all(event.pending)
})
