'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { callableAppCheckPolicy } = require('./callable-app-check-policy')

test('the actual default and regional wrappers preserve the strongest App Check requirement', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  const begin = source.indexOf('function onCall(optionsOrHandler, maybeHandler)')
  const end = source.indexOf('function boundedIncidentValue', begin)
  assert.ok(begin > 0 && end > begin)
  for (const broad of [false, true]) {
    const context = { enforceAppCheck: broad, callableAppCheckPolicy, firebaseOnCall: (options, handler) => ({ options, handler }) }
    vm.createContext(context)
    vm.runInContext(`${source.slice(begin, end)}\nthis.wrappers = [onCall, asiaEastOnCall, nutritionRegionalOnCall]`, context)
    for (const wrapper of context.wrappers) {
      for (const explicit of [undefined, false, true]) {
        const handler = () => {}
        const result = wrapper({ ...(explicit === undefined ? {} : { enforceAppCheck: explicit }), maxInstances: 3 }, handler)
        assert.equal(result.options.enforceAppCheck, broad || explicit === true)
        assert.equal(result.options.maxInstances, 3)
        assert.equal(result.handler, handler)
      }
      assert.equal(wrapper(() => {}).options.enforceAppCheck, broad)
    }
  }
})
