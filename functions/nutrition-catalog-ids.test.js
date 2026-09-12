const test = require('node:test')
const assert = require('node:assert/strict')
const { createIdentityAccessFunctions } = require('./identity-access')

test('known catalog IDs are read directly, remain authenticated and never build a full index', async () => {
  const reads = []
  const values = {
    'users/member': { role: 'student' },
    'nutritionCatalog/a': { kind: 'food', nameVi: 'Cơm', nameAscii: 'com' },
    'nutritionCatalog/b': { kind: 'dish', nameVi: 'Bún', nameAscii: 'bun' },
  }
  const doc = (path) => ({ path, id: path.split('/').at(-1), async get() { reads.push(path); return { id: this.id, exists: path in values, data: () => values[path] } } })
  const db = {
    doc,
    getAll: (...refs) => Promise.all(refs.map((ref) => ref.get())),
    collection(name) {
      assert.equal(name, 'nutritionCatalog')
      return { count: () => ({ get: async () => ({ data: () => ({ count: 2103 }) }) }) }
    },
  }
  const api = createIdentityAccessFunctions({ db, onCall: (options, handler) => handler || options, auth: {}, logger: console })
  await assert.rejects(api.listInternalNutritionCatalog({ data: { ids: ['a'] } }), { code: 'unauthenticated' })
  const result = await api.listInternalNutritionCatalog({ auth: { uid: 'member', token: {} }, data: { ids: ['a', 'b', 'a', 'missing'], kind: 'food' } })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].nameVi, 'Cơm')
  assert.equal(result.hasMore, false)
  assert.equal(result.restricted, true)
  assert.deepEqual(reads.filter((path) => path.startsWith('nutritionCatalog/')), ['nutritionCatalog/a', 'nutritionCatalog/b', 'nutritionCatalog/missing'])
})
