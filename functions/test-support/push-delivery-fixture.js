'use strict'
const assert = require('node:assert/strict')

function pushDeliveryFixture() {
  const documents = new Map(), effects = []
  let tail = Promise.resolve(), clock = Date.now(), transactions = 0
  const hooks = { beforeCommit: null, afterCommit: null, send: null }
  const doc = path => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path) })
  const snapshot = path => ({ exists: documents.has(path), data: () => documents.get(path), ref: doc(path), id: path.split('/').at(-1) })
  const db = { doc, runTransaction(operation) {
    const run = tail.then(async () => {
      const writes = []
      const value = await operation({
        get: async ref => { assert.equal(writes.length, 0, 'transaction reads precede writes'); return ref.get() },
        create: (ref, values) => writes.push({ ref, values, kind: 'create' }),
        update: (ref, values) => writes.push({ ref, values, kind: 'update' }),
        delete: ref => writes.push({ ref, values: {}, kind: 'delete' }),
        set: (ref, values, options) => writes.push({ ref, values, kind: options?.merge ? 'merge' : 'set' }),
      })
      transactions++
      await hooks.beforeCommit?.({ writes, transaction: transactions })
      for (const { ref, kind } of writes) {
        if (kind === 'create') assert.equal(documents.has(ref.path), false, `create exists: ${ref.path}`)
        if (kind === 'update') assert.equal(documents.has(ref.path), true, `update missing: ${ref.path}`)
      }
      for (const { ref, values, kind } of writes) {
        if (kind === 'delete') { documents.delete(ref.path); effects.push({ kind: 'cleanup', path: ref.path }); continue }
        const next = { ...(['update', 'merge'].includes(kind) ? documents.get(ref.path) : {}), ...values }
        if (next.createdAt?.constructor?.name === 'ServerTimestampTransform') next.createdAt = { seconds: Math.floor(clock / 1000), nanoseconds: 0 }
        documents.set(ref.path, next)
        if (ref.path.includes('/notifications/')) effects.push({ kind: 'inbox', path: ref.path, value: next })
        else if (ref.path.startsWith('system/push_broadcast_logs/')) effects.push({ kind: 'log', path: ref.path, value: next })
      }
      await hooks.afterCommit?.({ writes, transaction: transactions })
      return value
    })
    tail = run.catch(() => undefined)
    return run
  } }
  const messaging = { sendEachForMulticast: async payload => {
    effects.push({ kind: 'fcm', payload })
    if (hooks.send) return hooks.send(payload)
    return { responses: payload.tokens.map(() => ({ success: true })) }
  } }
  return { db, documents, effects, hooks, messaging, now: () => clock, advance: ms => { clock += ms } }
}

module.exports = { pushDeliveryFixture }
