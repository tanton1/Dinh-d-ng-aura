import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearPendingFoodScan, foodScanFingerprint, readPendingFoodScan, rememberPendingFoodScan, waitForFoodScanJob, type ScanJobSnapshot } from '../src/services/nutritionScanQueue'

test('queue status is pushed once per change and completion unsubscribes without polling', async () => {
  let next!: (snapshot: ScanJobSnapshot) => void
  let subscriptions = 0, unsubscribed = 0, ownerUnsubscribed = 0
  const states: string[] = []
  const result = waitForFoodScanJob({ ownerUid: 'one', currentOwnerUid: () => 'one', onStatus: state => states.push(state),
    subscribe: handler => { subscriptions++; next = handler; return () => { unsubscribed++ } },
    subscribeOwner: () => () => { ownerUnsubscribed++ },
  })
  next({ exists: false, fromCache: true })
  next({ exists: true, data: { status: 'queued' } })
  next({ exists: true, data: { status: 'queued' }, fromCache: false })
  next({ exists: true, data: { status: 'processing' } })
  next({ exists: true, data: { status: 'completed', response: { sameResult: true } } })
  assert.deepEqual(await result, { sameResult: true })
  assert.deepEqual(states, ['queued', 'processing'])
  assert.equal(subscriptions, 1)
  assert.equal(unsubscribed, 1)
  assert.equal(ownerUnsubscribed, 1)
})

test('navigation abort, account switch and observer timeout stop listeners, never resubmit a job', async () => {
  for (const mode of ['abort', 'owner', 'timeout']) {
    const abort = new AbortController()
    let current = 'one', ownerChanged = () => {}, stops = 0
    const result = waitForFoodScanJob({ ownerUid: 'one', currentOwnerUid: () => current, signal: abort.signal,
      subscribe: () => () => { stops++ }, subscribeOwner: changed => { ownerChanged = changed; return () => { stops++ } },
      timeoutMs: mode === 'timeout' ? 5 : 60_000,
    })
    if (mode === 'abort') abort.abort()
    if (mode === 'owner') { current = 'two'; ownerChanged() }
    await assert.rejects(result, mode === 'abort' ? { name: 'AbortError' } : mode === 'owner' ? { code: 'permission-denied' } : { code: 'deadline-exceeded' })
    assert.equal(stops, 2)
  }
})

test('synchronous cache completion cleans both listeners; unknown outcome is propagated unchanged', async () => {
  let stops = 0
  const result = await waitForFoodScanJob({ ownerUid: 'one', currentOwnerUid: () => 'one',
    subscribe: next => { next({ exists: true, data: { status: 'completed', response: 'saved' } }); return () => { stops++ } },
  })
  assert.equal(result, 'saved')
  assert.equal(stops, 1)
  await assert.rejects(waitForFoodScanJob({ ownerUid: 'one', currentOwnerUid: () => 'one', subscribe: next => {
    next({ exists: true, data: { status: 'failed', error: { code: 'failed-precondition', message: 'Không tự gửi lại', kind: 'nutrition_ai_outcome_unknown' } } })
    return () => {}
  } }), error => (error as { details: { kind: string } }).details.kind === 'nutrition_ai_outcome_unknown')
})

test('stable image and context reuse the pending request; different owners and changed clarifications do not', async () => {
  const image = new Blob(['private photo'], { type: 'image/jpeg' })
  const fingerprint = await foodScanFingerprint(image, { notes: 'rice', mealType: 'lunch' })
  assert.equal(fingerprint, await foodScanFingerprint(image, { notes: 'rice', mealType: 'lunch' }))
  assert.notEqual(fingerprint, await foodScanFingerprint(image, { notes: 'half rice', mealType: 'lunch' }))
  const pending = { ownerUid: 'one', fingerprint, createdAt: Date.now(), mealType: 'lunch' as const,
    upload: { scanId: 'same_scan_123', storagePath: 'nutrition-scans/one/same_scan_123/original.jpg', contentType: 'image/jpeg' as const, size: 10 } }
  rememberPendingFoodScan(pending)
  assert.deepEqual(readPendingFoodScan('one'), pending)
  assert.equal(readPendingFoodScan('two'), null)
  clearPendingFoodScan('one', 'another_scan')
  assert.deepEqual(readPendingFoodScan('one'), pending)
  clearPendingFoodScan('one', pending.upload.scanId)
  assert.equal(readPendingFoodScan('one'), null)
})
