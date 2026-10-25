import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createProductionReader, parseRetryAfter } from './production-smoke-reader.mjs'

const release = 'a'.repeat(40)
const home = '<title>Aura Fitness</title><script src="/assets/index-release.js"></script>'
const start = Date.parse('2026-10-25T07:00:00Z')

function fixture(handler, options = {}) {
  let time = start
  const calls = [], waits = [], warnings = []
  const reader = createProductionReader({
    baseUrl: 'https://smoke.invalid', expectedRelease: release,
    maxAttempts: 30, now: () => time,
    wait: async duration => { waits.push(duration); time += duration },
    onRetry: warning => warnings.push(warning),
    fetchImpl: async (url, init) => {
      calls.push({ path: url.pathname, snapshot: url.searchParams.get('aura-smoke'), init })
      return handler(url, calls.length)
    },
    ...options,
  })
  return { ...reader, calls, waits, warnings }
}

function healthyResponse(url) {
  return new Response(url.pathname === '/' ? home : `const release = '${release}'`)
}

async function localServer(t, handler) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => {
    server.closeAllConnections()
    server.close(resolve)
  }))
  return `http://127.0.0.1:${server.address().port}`
}

test('Retry-After accepts seconds and HTTP dates without interpreting arbitrary numbers as dates', () => {
  assert.equal(parseRetryAfter('30', start), 30_000)
  assert.equal(parseRetryAfter('Sun, 25 Oct 2026 07:00:45 GMT', start), 45_000)
  assert.equal(parseRetryAfter('Sun, 25 Oct 2026 06:59:00 GMT', start), 0)
  assert.equal(parseRetryAfter('0', start), 0)
  assert.equal(parseRetryAfter('-5', start), null)
  assert.equal(parseRetryAfter('1.5', start), null)
  assert.equal(parseRetryAfter('tomorrow', start), null)
  assert.equal(parseRetryAfter(null, start), null)
  assert.equal(parseRetryAfter('9'.repeat(400), start), Number.MAX_SAFE_INTEGER)
})

test('access denial never retries or requests assets, even with thirty attempts configured', async t => {
  for (const status of [401, 403, 407]) {
    await t.test(`HTTP ${status}`, async () => {
      const reader = fixture(() => new Response('denied', { status, headers: { 'retry-after': '30' } }))
      await assert.rejects(reader.readConsistentProductionSnapshot(), { code: 'access_denied', status })
      assert.equal(reader.calls.length, 1)
      assert.deepEqual(reader.waits, [])
      assert.deepEqual(reader.warnings, [])
    })
  }
})

test('security checkpoints cannot be mistaken for a successful page or a propagation delay', async t => {
  for (const scenario of [
    { status: 403, headers: { 'x-vercel-mitigated': 'challenge' }, body: 'sensitive challenge payload' },
    { status: 200, headers: { 'x-vercel-mitigated': 'challenge' }, body: home },
    { status: 200, headers: {}, body: '<title>Vercel Security Checkpoint</title>' + home },
  ]) {
    await t.test(JSON.stringify({ status: scenario.status, header: !!scenario.headers['x-vercel-mitigated'] }), async () => {
      const reader = fixture(() => new Response(scenario.body, scenario))
      await assert.rejects(reader.readConsistentProductionSnapshot(), error => {
        assert.equal(error.code, 'security_checkpoint')
        assert.equal(error.message.includes('sensitive challenge payload'), false)
        return true
      })
      assert.equal(reader.calls.length, 1)
      assert.deepEqual(reader.waits, [])
    })
  }
})

test('failure to cancel a denied response does not turn denial into a retry', async () => {
  const reader = fixture(() => ({
    status: 403, headers: new Headers(), body: { cancel: async () => { throw Error('closed stream') } },
  }))
  await assert.rejects(reader.readConsistentProductionSnapshot(), { code: 'access_denied' })
  assert.equal(reader.calls.length, 1)
})

test('rate limits respect both seconds and absolute retry dates', async t => {
  for (const retryAfter of ['30', 'Sun, 25 Oct 2026 07:00:30 GMT']) {
    await t.test(retryAfter, async () => {
      const reader = fixture((url, count) => count === 1
        ? new Response('', { status: 429, headers: { 'retry-after': retryAfter } })
        : healthyResponse(url))
      const snapshot = await reader.readConsistentProductionSnapshot()
      assert.equal(snapshot.attempt, 2)
      assert.deepEqual(reader.waits, [30_000])
      assert.equal(reader.calls.length, 3)
    })
  }
})

test('transient server failures back off and then verify the complete new snapshot', async () => {
  const reader = fixture((url, count) => count <= 3
    ? new Response('', { status: [500, 502, 503][count - 1], headers: { 'retry-after': 'invalid' } })
    : healthyResponse(url))
  const snapshot = await reader.readConsistentProductionSnapshot()
  assert.equal(snapshot.attempt, 4)
  assert.deepEqual(reader.waits, [3_000, 6_000, 12_000])
  assert.equal(reader.calls.at(-1).init.cache, 'no-store')
  assert.ok(reader.calls.at(-1).init.signal instanceof AbortSignal)
})

test('a long server retry delay defers the run instead of retrying early', async () => {
  const reader = fixture(() => new Response('', { status: 503, headers: { 'retry-after': '90' } }))
  await assert.rejects(reader.readConsistentProductionSnapshot(), { code: 'retry_deferred', retryAfterMs: 90_000 })
  assert.equal(reader.calls.length, 1)
  assert.deepEqual(reader.waits, [])
})

test('retry requests that exceed the remaining run budget are deferred', async () => {
  const reader = fixture(() => new Response('', { status: 429, headers: { 'retry-after': '60' } }), { snapshotBudgetMs: 45_000 })
  await assert.rejects(reader.readConsistentProductionSnapshot(), { code: 'retry_deferred', retryAfterMs: 60_000 })
  assert.equal(reader.calls.length, 1)
  assert.deepEqual(reader.waits, [])
})

test('an unavailable immutable asset causes a new cache-busted HTML and asset snapshot', async () => {
  const reader = fixture((url, count) => count === 2 ? new Response('', { status: 404 }) : healthyResponse(url))
  const snapshot = await reader.readConsistentProductionSnapshot()
  assert.equal(snapshot.attempt, 2)
  assert.deepEqual(reader.calls.map(call => call.path), ['/', '/assets/index-release.js', '/', '/assets/index-release.js'])
  assert.equal(reader.calls[0].snapshot, reader.calls[1].snapshot)
  assert.equal(reader.calls[2].snapshot, reader.calls[3].snapshot)
  assert.notEqual(reader.calls[0].snapshot, reader.calls[2].snapshot)
})

test('old release assets remain a bounded propagation retry, never a successful verification', async () => {
  const reader = fixture(url => new Response(url.pathname === '/' ? home : 'old release'), { maxAttempts: 2 })
  await assert.rejects(reader.readConsistentProductionSnapshot(), /Public alias has not promoted release/)
  assert.equal(reader.calls.length, 4)
  assert.deepEqual(reader.waits, [3_000])
})

test('the split Firestore configuration chunk belongs to the same verified snapshot', async () => {
  const reader = fixture(url => new Response(url.pathname === '/' ? home
    : url.pathname.includes('firebaseFirestore-') ? 'project configuration'
      : `const release = '${release}'; import('./firebaseFirestore-config.js')`))
  const snapshot = await reader.readConsistentProductionSnapshot()
  assert.equal(snapshot.firebaseBootstrapBundle, 'project configuration')
  assert.equal(snapshot.firebaseBootstrapPath, '/assets/firebaseFirestore-config.js')
  assert.equal(new Set(reader.calls.map(call => call.snapshot)).size, 1)
})

test('a challenge on an asset stops immediately without starting another snapshot', async () => {
  const reader = fixture((url, count) => count === 1 ? healthyResponse(url)
    : new Response('', { status: 403, headers: { 'x-vercel-mitigated': 'challenge' } }))
  await assert.rejects(reader.readConsistentProductionSnapshot(), { code: 'security_checkpoint' })
  assert.equal(reader.calls.length, 2)
  assert.deepEqual(reader.waits, [])
})

test('foreign assets and invalid retry configuration fail before any network request', async () => {
  const reader = fixture(() => { throw Error('must not fetch') })
  await assert.rejects(reader.fetchText('https://foreign.invalid/asset.js'), { code: 'foreign_asset' })
  assert.equal(reader.calls.length, 0)
  for (const maxAttempts of [NaN, Infinity, 0, 31, 1.5]) assert.throws(() => fixture(healthyResponse, { maxAttempts }), /maxAttempts/)
})

test('a stalled HTTP response body is aborted within the request budget', async t => {
  let calls = 0
  const baseUrl = await localServer(t, (_request, response) => {
    calls += 1
    response.writeHead(200, { 'content-type': 'text/html' })
    response.write('<title>')
  })
  const reader = createProductionReader({ baseUrl, maxAttempts: 1, requestTimeoutMs: 500 })
  await assert.rejects(reader.readConsistentProductionSnapshot(), error => ['AbortError', 'TimeoutError'].includes(error.name))
  assert.equal(calls, 1)
})

test('the executable exits with a structured failure after exactly one checkpoint request', async t => {
  let calls = 0
  const baseUrl = await localServer(t, (_request, response) => {
    calls += 1
    response.writeHead(403, { 'x-vercel-mitigated': 'challenge', 'retry-after': '30' })
    response.end('private challenge body')
  })
  const child = spawn(process.execPath, [fileURLToPath(new URL('./production-smoke.mjs', import.meta.url))], {
    env: { ...process.env, AURA_PROD_URL: baseUrl, AURA_SMOKE_ATTEMPTS: '30' },
    stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(10_000),
  })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const [code] = await once(child, 'close')
  assert.equal(code, 1)
  assert.equal(calls, 1)
  assert.equal(stdout, '')
  const result = JSON.parse(stderr)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'security_checkpoint')
  assert.equal(result.error.retryAfterMs, 30_000)
  assert.equal(stderr.includes('private challenge body'), false)
})
