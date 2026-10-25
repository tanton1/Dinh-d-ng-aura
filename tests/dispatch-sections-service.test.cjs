const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

function fixture(response, error) {
  const calls = []
  function compile(file, dependencies) {
    const source = ts.transpileModule(readFileSync(join(__dirname, '../src/features/delivery', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const exports = {}
    runInNewContext(source, { exports, require: name => { if (!(name in dependencies)) throw Error('Unexpected dependency: ' + name); return dependencies[name] } })
    return exports
  }
  const types = compile('types.ts', {})
  const service = compile('deliveryService.ts', {
    './types': types,
    '../../lib/firebaseFunctions': { firebaseFunctions: {} },
    'firebase/functions': { httpsCallable: (_client, name) => async input => { calls.push({ name, input }); if (error) throw error; return { data: response } } },
  })
  return { calls, read: sections => service.listEatCleanDispatchSnapshot(sections) }
}
const result = sections => ({ sections, workspaceSync: { schemaVersion: 1, accountId: 'admin', versions: Object.fromEntries(sections.filter(key => key !== 'signals').map(key => [key, '0'])) } })
const jobs = () => ({ ...result(['jobs']), deliveries: [{ id: 'a', status: 'accepted', locationStream: { enabled: true, binding: 'a'.repeat(64) }, otpLockedUntil: '2026-10-25T03:00:00.000Z' }], page: { limit: 100, hasMore: true }, summary: { totalActive: 150 } })

test('partial service makes exactly one callable and preserves assignment binding, deadline and whole-scope totals', async () => {
  const f = fixture(jobs()), value = await f.read(['jobs'])
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, 'listEatCleanDispatchData')
  assert.equal(JSON.stringify(f.calls[0].input), '{"sections":["jobs"]}')
  assert.equal(value.jobs[0].locationStream.binding, 'a'.repeat(64))
  assert.equal(value.jobs[0].otpLockedUntil, '2026-10-25T03:00:00.000Z')
  assert.equal(value.totalActive, 150); assert.equal(value.page.hasMore, true)
  for (const key of ['config', 'readiness', 'drivers', 'signals']) assert.equal(Object.hasOwn(value, key), false)
})

test('an omitted config is intentional; a missing requested config or capability fails without heavy fallback', async () => {
  for (const response of [{}, result(['config']), { ...jobs(), workspaceSync: undefined }, { ...jobs(), sections: ['jobs', 'roster'] }, { ...jobs(), workspaceSync: { schemaVersion: 1, accountId: 'admin', versions: { jobs: '0', roster: '0' } } }, { ...jobs(), deliveries: [{ id: 'a' }] }]) {
    const f = fixture(response)
    await assert.rejects(f.read(response.sections?.[0] === 'config' ? ['config'] : ['jobs']))
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, 'listEatCleanDispatchData')
  }
})

test('not-found/unimplemented and authorization failures never retry the old driver/admin endpoints', async () => {
  for (const code of ['functions/not-found', 'functions/unimplemented', 'functions/permission-denied', 'functions/unavailable']) {
    const f = fixture(null, Object.assign(Error(code), { code }))
    await assert.rejects(f.read(['jobs']), error => error.code === code)
    assert.equal(f.calls.length, 1)
  }
})

test('invalid sections do no network work; daily signals preserve their own date and omit unrelated counters', async () => {
  const f = fixture({ ...result(['signals']), signals: { mapsErrorsToday: 7, day: '2026-10-25', otpRejected: 99 } })
  for (const sections of [[], ['jobs', 'jobs'], ['unknown']]) await assert.rejects(f.read(sections))
  assert.equal(f.calls.length, 0)
  const value = await f.read(['signals'])
  assert.equal(value.signalsDay, '2026-10-25')
  assert.equal(JSON.stringify(value.signals), '{"mapsErrorsToday":7}')
  assert.equal(JSON.stringify(value.workspaceSync.versions), '{}')
})
