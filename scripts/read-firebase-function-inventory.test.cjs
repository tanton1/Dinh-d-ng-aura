'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { readInventory, collectInventory } = require('./read-firebase-function-inventory.cjs')
const valid = { status: 0, stdout: JSON.stringify({ status: 'success', result: [{ id: 'syncStudent360Session', region: 'asia-southeast1', runServiceId: 'syncstudent360session' }] }) }

test('a valid first inventory performs one read and no delay', async () => {
  let calls = 0
  const result = await readInventory({ invoke: () => { calls++; return valid }, pause: () => assert.fail('unexpected delay') })
  assert.equal(calls, 1)
  assert.equal(result.attempts, 1)
  assert.equal(result.payload.result[0].id, 'syncStudent360Session')
})

test('a failed post-deploy metadata read recovers without repeating a deployment', async () => {
  let reads = 0
  const delays = [], diagnostics = []
  const result = await readInventory({ invoke: () => ++reads === 1 ? { status: 1, stdout: JSON.stringify({ status: 'error', error: 'sensitive-provider-detail' }) } : valid,
    pause: ms => delays.push(ms), report: row => diagnostics.push(row) })
  assert.equal(reads, 2)
  assert.equal(result.attempts, 2)
  assert.deepEqual(delays, [1_000])
  assert.equal(JSON.stringify(diagnostics).includes('sensitive-provider-detail'), false)
  assert.equal(diagnostics[0].reason, 'cli_failure')
})

test('timeouts and invocation failures stop after three reads with safe diagnostics', async () => {
  let calls = 0
  const diagnostics = [], delays = []
  await assert.rejects(readInventory({ invoke: () => { calls++; if (calls === 1) throw Error('private-auth-detail'); return { status: null, error: { code: 'ETIMEDOUT', message: 'private-auth-detail' } } },
    pause: ms => delays.push(ms), report: row => diagnostics.push(row) }), /after 3 read attempts/)
  assert.equal(calls, 3)
  assert.deepEqual(delays, [1_000, 2_000])
  assert.equal(diagnostics.length, 3)
  assert.equal(JSON.stringify(diagnostics).includes('private-auth-detail'), false)
})

test('zero exit code does not accept malformed or unsuccessful manifests', async () => {
  for (const stdout of ['<html>not-json</html>', '{"status":"error","result":[]}', '{"status":"success"}', '{"status":"success","result":[null]}', '{"status":"success","result":[{"id":"target"}]}']) {
    let calls = 0
    await assert.rejects(readInventory({ invoke: () => { calls++; return { status: 0, stdout } }, pause: () => {} }), /after 3 read attempts/)
    assert.equal(calls, 3)
  }
})

test('an explicitly successful empty inventory stays valid for allow-missing resolution', async () => {
  const result = await readInventory({ invoke: () => ({ status: 0, stdout: '{"status":"success","result":[]}' }) })
  assert.deepEqual(result.payload.result, [])
})

test('failed reads preserve the previous file; successful reads replace it with valid JSON', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-inventory-reader-'))
  const file = path.join(directory, 'inventory.json')
  try {
    await fs.writeFile(file, 'previous-snapshot')
    await assert.rejects(collectInventory(file, { invoke: () => ({ status: 1, stdout: '{"status":"error"}' }), pause: () => {} }))
    assert.equal(await fs.readFile(file, 'utf8'), 'previous-snapshot')
    assert.deepEqual(await collectInventory(file, { invoke: () => valid }), { attempts: 1, functions: 1 })
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), JSON.parse(valid.stdout))
    assert.deepEqual(await fs.readdir(directory), ['inventory.json'])
  } finally {
    await fs.unlink(file)
    await fs.rmdir(directory)
  }
})
