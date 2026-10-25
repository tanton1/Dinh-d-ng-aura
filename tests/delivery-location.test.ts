import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocationPublisher, locationSampleIssue, deliveryLocationPolicy as policy, type LocationPublishResult } from '../src/features/delivery/locationPublisher'

const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function harness(publish?: (point: GeolocationPosition) => Promise<LocationPublishResult>) {
  let now = 1_800_000_000_000, next = 0, online = true
  const timers = new Map<number, { at: number; work: () => void }>()
  const calls: Array<{ at: number; point: GeolocationPosition }> = []
  const errors: unknown[] = [], rejected: string[] = []
  const engine = createLocationPublisher({
    now: () => now, online: () => online,
    schedule: (work, delay) => { timers.set(++next, { at: now + delay, work }); return next }, cancel: id => { timers.delete(id as number) },
    publish: async point => { calls.push({ at: now, point }); return publish ? publish(point) : { accepted: true } },
    onError: error => errors.push(error), onRejected: reason => rejected.push(reason),
  })
  const point = (meters = 0, accuracy = 5, timestamp = now) => ({ coords: { latitude: 16 + meters / 111_111, longitude: 108, accuracy, heading: 0, speed: 0, altitude: null, altitudeAccuracy: null }, timestamp } as GeolocationPosition)
  const advance = async (ms: number) => {
    const end = now + ms
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
      if (!entry || entry[1].at > end) break
      now = entry[1].at; timers.delete(entry[0]); entry[1].work(); await drain()
    }
    now = end; await drain()
  }
  return { engine, point, advance, calls, errors, rejected, online: (value: boolean) => { online = value }, now: () => now }
}

test('1Hz moving GPS has a hard 15s request interval and sends the latest fix', async () => {
  const h = harness()
  for (let second = 0; second < 60; second++) { h.engine.offer(h.point(second * 8)); await h.advance(1000) }
  assert.equal(h.calls.length, 5, 'bootstrap plus four 15-second boundaries')
  for (let i = 1; i < h.calls.length; i++) {
    assert.ok(h.calls[i].at - h.calls[i - 1].at >= policy.minimumIntervalMs)
    assert.ok(h.calls[i].at - h.calls[i].point.timestamp <= 1000, 'never drains older queued coordinates')
  }
})

test('stationary jitter refreshes at one minute and never sends a stale retained fix', async () => {
  const h = harness()
  for (let second = 0; second < 120; second++) { h.engine.offer(h.point(second % 2 ? 8 : -8)); await h.advance(1000) }
  assert.equal(h.calls.length, 3)
  assert.deepEqual(h.calls.slice(1).map((call, i) => call.at - h.calls[i].at), [60000, 60000])
  h.engine.offer(h.point())
  await h.advance(180000)
  assert.equal(h.calls.length, 3)
  assert.ok(h.rejected.includes('sample_age'))
})

test('quality checks reject stale, future, imprecise, duplicate and implausible fixes', async () => {
  const h = harness()
  const first = h.point()
  assert.equal(locationSampleIssue(h.point(0, 150), null, h.now()), 'accuracy')
  assert.equal(locationSampleIssue(h.point(0, 5, h.now() - 31000), null, h.now()), 'sample_age')
  assert.equal(locationSampleIssue(h.point(0, 5, h.now() + 6000), null, h.now()), 'sample_age')
  assert.equal(locationSampleIssue(first, first, h.now()), 'older_sample')
  await h.advance(1000)
  assert.equal(locationSampleIssue(h.point(2000), first, h.now()), 'outlier')
  assert.equal(locationSampleIssue(h.point(10), first, h.now()), null)
})

test('slow requests stay single flight; stop drops pending work and late results', async () => {
  let finish!: (result: LocationPublishResult) => void
  const h = harness(() => new Promise(resolve => { finish = resolve }))
  h.engine.offer(h.point()); await drain()
  for (let i = 1; i <= 45; i++) { await h.advance(1000); h.engine.offer(h.point(i * 8)) }
  assert.equal(h.calls.length, 1)
  finish({ accepted: true }); await drain(); await h.advance(0)
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].point.timestamp, h.now())
  h.engine.offer(h.point(370)); h.engine.stop(); finish({ accepted: true })
  await h.advance(120000)
  assert.equal(h.calls.length, 2)
})

test('failed requests respect the hard cap; offline retains only a fresh latest sample', async () => {
  const h = harness(async () => { throw new Error('network unavailable') })
  for (let i = 0; i < 15; i++) { h.engine.offer(h.point(i * 8)); await h.advance(1000) }
  assert.equal(h.calls.length, 2)
  h.online(false)
  for (let i = 0; i < 40; i++) { h.engine.offer(h.point(i * 8)); await h.advance(1000) }
  assert.equal(h.calls.length, 2)
  h.online(true); h.engine.resume(); await drain()
  assert.equal(h.calls.length, 3)
  assert.ok(h.now() - h.calls[2].point.timestamp <= 1000)
  assert.equal(h.errors.length, 3)
})
