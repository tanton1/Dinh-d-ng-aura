const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')
function fixture(response, error) {
  const calls = []
  function compile(file, dependencies) {
    const source = ts.transpileModule(readFileSync(join(__dirname, '../src/features/eat-clean/admin', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const exports = {}
    runInNewContext(source, { exports, require: name => { if (!(name in dependencies)) throw Error('Unexpected import: ' + name); return dependencies[name] } })
    return exports
  }
  const service = compile('eatCleanAdminService.ts', {
    './types': compile('types.ts', {}), '../../../lib/firebaseFunctions': { firebaseFunctions: {} },
    'firebase/functions': { httpsCallable: (_client, name) => async input => { calls.push({ name, input }); if (error) throw error; return { data: response } } },
  })
  return { calls, read: service.listEatCleanAdminSections }
}
test('scoped admin reads call once and do not manufacture omitted sections', async () => {
  const f = fixture({ sections: ['meals'], seeded: true, coverage: { meals: { limitReached: true } }, meals: [] })
  const response = await f.read(['meals'])
  assert.equal(JSON.stringify(f.calls), '[{"name":"listEatCleanAdminData","input":{"sections":["meals"]}}]')
  assert.equal(response.coverage.meals.limitReached, true)
  for (const key of ['orders', 'inventory', 'config', 'summary']) assert.equal(Object.hasOwn(response, key), false)
})
test('missing capability or requested data fails without a legacy full read', async () => {
  for (const response of [{}, { sections: ['meals'], seeded: true, meals: [] }, { sections: ['meals'], seeded: true, coverage: { meals: { limitReached: false } } }, { sections: ['meals', 'meals'], seeded: true, meals: [] }, { sections: ['inventory'], seeded: true, inventory: [] }]) {
    const f = fixture(response); await assert.rejects(f.read(['meals'])); assert.equal(f.calls.length, 1)
  }
  const f = fixture({ sections: ['orders'], seeded: true, orders: [], coverage: { orders: { limitReached: false } } })
  await assert.rejects(f.read(['orders'])); assert.equal(f.calls.length, 1)
})
test('invalid requests stop before network and callable failures never trigger a heavy fallback', async () => {
  const f = fixture({})
  for (const sections of [[], ['orders', 'orders'], ['unknown']]) await assert.rejects(f.read(sections))
  assert.equal(f.calls.length, 0)
  for (const code of ['functions/permission-denied', 'functions/unavailable', 'functions/not-found']) {
    const failed = fixture(null, Object.assign(Error(code), { code }))
    await assert.rejects(failed.read(['orders']), error => error.code === code); assert.equal(failed.calls.length, 1)
  }
})
