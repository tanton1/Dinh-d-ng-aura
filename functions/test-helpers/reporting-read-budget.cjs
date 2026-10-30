'use strict'

// Test-only SDK boundary observer. It does not estimate billed reads, index
// entries, transport retries, or Firestore's internal transaction work.
const { AsyncLocalStorage } = require('node:async_hooks')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const BUCKETS = ['source', 'label', 'auth', 'cache']
function newBucket() {
  return { queryAttempts: 0, queryCompletions: 0, queryDocumentSnapshots: 0,
    pointReadCalls: 0, pointReadAttempts: 0, pointReadCompletions: 0,
    pointDocumentSnapshots: 0, missingDocumentSnapshots: 0,
    writeAttempts: 0, committedWrites: 0 }
}
function newMetrics() {
  return { buckets: Object.fromEntries(BUCKETS.map(key => [key, newBucket()])),
    transactions: { readOnlyCalls: 0, readWriteCalls: 0, readOnlyCallbackAttempts: 0,
      readWriteCallbackAttempts: 0, completedCalls: 0, failedCalls: 0 }, errors: 0 }
}

function createReadBudgetObserver(rawDb, { actorId }) {
  const contexts = new AsyncLocalStorage(), native = new WeakMap(), references = new WeakMap()
  const unwrap = value => native.get(value) || value
  function classify(resource) {
    if (resource === `users/${actorId}` || resource === `roleAssignments/${actorId}`) return 'auth'
    if (resource.startsWith('systemOperationsDashboardCache/')) return 'cache'
    if (resource === 'enrollments' || resource === 'contracts' || resource === 'group:progress') return 'source'
    if (/^(users|students)\/[^/]+$/.test(resource)) return 'label'
    throw new Error(`Unclassified test SDK resource: ${resource}`)
  }
  function metrics() {
    const current = contexts.getStore()
    assert.ok(current, 'SDK observer must run inside an explicit measurement phase')
    return current
  }
  async function read(kind, resources, operation) {
    const current = metrics(), categories = resources.map(classify)
    if (kind === 'query') current.buckets[categories[0]].queryAttempts++
    else {
      for (const category of new Set(categories)) current.buckets[category].pointReadCalls++
      categories.forEach(category => current.buckets[category].pointReadAttempts++)
    }
    try {
      const result = await operation()
      if (kind === 'query') {
        assert.ok(Array.isArray(result.docs), 'Expected a native QuerySnapshot')
        current.buckets[categories[0]].queryCompletions++
        current.buckets[categories[0]].queryDocumentSnapshots += result.size
      } else {
        const snapshots = Array.isArray(result) ? result : [result]
        assert.equal(snapshots.length, resources.length)
        // getAll preserves argument order, but use returned ref.path so a future
        // SDK ordering change cannot silently move reads into another bucket.
        for (const snapshot of snapshots) {
          const bucket = current.buckets[classify(snapshot.ref.path)]
          bucket.pointReadCompletions++
          bucket[snapshot.exists ? 'pointDocumentSnapshots' : 'missingDocumentSnapshots']++
        }
      }
      return result
    } catch (error) { current.errors++; throw error }
  }
  function reference(value) {
    if (references.has(value)) return references.get(value)
    const proxy = new Proxy(value, { get(target, key) {
      if (key === 'get') return (...args) => read('point', [target.path], () => target.get(...args))
      if (['set', 'update', 'delete', 'create', 'collection', 'onSnapshot'].includes(key)) {
        throw new Error(`Unobserved reference method in measured reporting call: ${key}`)
      }
      const result = target[key]
      return typeof result === 'function' ? result.bind(target) : result
    } })
    native.set(proxy, value); references.set(value, proxy)
    return proxy
  }
  function query(value, resource) {
    const proxy = new Proxy(value, { get(target, key) {
      if (key === 'get') return (...args) => read('query', [resource], () => target.get(...args))
      if (key === 'doc') return id => reference(target.doc(id))
      if (['where', 'select', 'orderBy', 'limit', 'limitToLast', 'startAfter', 'startAt', 'endAt', 'endBefore'].includes(key)) {
        return (...args) => query(target[key](...args.map(unwrap)), resource)
      }
      if (['stream', 'count', 'aggregate', 'onSnapshot', 'add', 'listDocuments'].includes(key)) {
        throw new Error(`Unobserved query method in measured reporting call: ${key}`)
      }
      const result = target[key]
      return typeof result === 'function' ? result.bind(target) : result
    } })
    native.set(proxy, value)
    return proxy
  }
  // The resource for transaction query inputs is held out-of-band; SDK query
  // internals and snapshot results remain untouched.
  const queryResources = new WeakMap()
  function trackedQuery(value, resource) {
    const wrapped = query(value, resource)
    // Capture chained queries without querying Firestore internals.
    const proxy = new Proxy(wrapped, { get(target, key) {
      if (['where', 'select', 'orderBy', 'limit', 'limitToLast', 'startAfter', 'startAt', 'endAt', 'endBefore'].includes(key)) {
        return (...args) => trackedQuery(unwrap(target)[key](...args.map(unwrap)), resource)
      }
      return target[key]
    } })
    native.set(proxy, value); queryResources.set(proxy, resource)
    return proxy
  }
  async function runTransaction(callback, options) {
    const current = metrics(), readOnly = options?.readOnly === true
    current.transactions[readOnly ? 'readOnlyCalls' : 'readWriteCalls']++
    let lastWrites = []
    try {
      const result = await rawDb.runTransaction(async transaction => {
        current.transactions[readOnly ? 'readOnlyCallbackAttempts' : 'readWriteCallbackAttempts']++
        const writes = []; lastWrites = writes
        const proxy = new Proxy(transaction, { get(target, key) {
          if (key === 'then') return undefined
          if (key === 'get') return (input, ...args) => {
            const resource = queryResources.get(input)
            return read(resource ? 'query' : 'point', [resource || unwrap(input).path], () => target.get(unwrap(input), ...args))
          }
          if (['set', 'create', 'update', 'delete'].includes(key)) return (input, ...args) => {
            const category = classify(unwrap(input).path)
            current.buckets[category].writeAttempts++
            const result = target[key](unwrap(input), ...args)
            writes.push(category)
            return result === target ? proxy : result
          }
          throw new Error(`Unobserved transaction method in measured reporting call: ${String(key)}`)
        } })
        return callback(proxy)
      }, options)
      current.transactions.completedCalls++
      lastWrites.forEach(category => current.buckets[category].committedWrites++)
      return result
    } catch (error) { current.transactions.failedCalls++; throw error }
  }
  const db = new Proxy(rawDb, { get(target, key) {
    if (key === 'collection') return name => trackedQuery(target.collection(name), name)
    if (key === 'collectionGroup') return name => trackedQuery(target.collectionGroup(name), `group:${name}`)
    if (key === 'doc') return name => reference(target.doc(name))
    if (key === 'getAll') return (...args) => {
      const refs = args.filter(value => native.has(value) || (value && typeof value.path === 'string'))
      return read('point', refs.map(value => unwrap(value).path), () => target.getAll(...args.map(unwrap)))
    }
    if (key === 'runTransaction') return runTransaction
    if (['batch', 'bulkWriter', 'getPartitions', 'listCollections', 'recursiveDelete'].includes(key)) {
      throw new Error(`Unobserved database method in measured reporting call: ${String(key)}`)
    }
    const result = target[key]
    return typeof result === 'function' ? result.bind(target) : result
  } })
  async function measure(operation) {
    const counters = newMetrics(), started = performance.now()
    const value = await contexts.run(counters, operation)
    return { value, counters, elapsedMs: Math.round((performance.now() - started) * 100) / 100 }
  }
  return { db, measure }
}

function sourceBinding(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  const paths = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean).sort()
  const files = paths.map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')])
  return { head: git('rev-parse', 'HEAD').trim(), dirty: Boolean(git('status', '--porcelain').trim()),
    fileCount: files.length, sourceFingerprint: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    normalization: 'SHA256 of UTF-8 JSON.stringify of sorted [relative path, SHA256(raw file bytes)] pairs; tracked and unignored untracked files; ignored artifacts excluded' }
}

function installLocalNetworkGuard() {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/,
    'This fixture requires an explicit loopback Firestore emulator')
  const net = require('node:net'), tls = require('node:tls'), http = require('node:http'), https = require('node:https')
  const restores = [], blocked = []
  function check(host) {
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
      blocked.push('non-loopback-destination')
      throw new Error('Read-budget fixture blocked a non-loopback network destination')
    }
  }
  function replace(object, key, make) {
    const original = object[key]; object[key] = make(original)
    restores.push(() => { object[key] = original })
  }
  function socketHost(args) {
    if (Array.isArray(args[0])) return socketHost(args[0])
    if (typeof args[0] === 'object') {
      assert.ok(!args[0].path, 'Network guard does not allow socket paths')
      return args[0].host || args[0].hostname || 'localhost'
    }
    assert.equal(typeof args[0], 'number', 'Expected a TCP port')
    return typeof args[1] === 'string' ? args[1] : 'localhost'
  }
  replace(net.Socket.prototype, 'connect', original => function (...args) { check(socketHost(args)); return original.apply(this, args) })
  replace(tls, 'connect', original => function (...args) { check(socketHost(args)); return original.apply(this, args) })
  for (const module of [http, https]) for (const method of ['request', 'get']) {
    replace(module, method, original => function (...args) {
      const first = args[0], options = typeof first === 'string' || first instanceof URL ? new URL(first) : first || {}
      check(options.hostname || options.host || 'localhost')
      return original.apply(this, args)
    })
  }
  if (global.fetch) replace(global, 'fetch', original => function (input, ...args) {
    check(new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname)
    return original.call(this, input, ...args)
  })
  return { blocked, restore() { restores.reverse().forEach(restore => restore()) } }
}

module.exports = { createReadBudgetObserver, installLocalNetworkGuard, sourceBinding }
