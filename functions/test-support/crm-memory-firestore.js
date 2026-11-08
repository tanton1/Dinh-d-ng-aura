'use strict'

// In-memory Firestore subset for CRM tests: documents, queries with
// where/orderBy/startAfter/limit/count, batches and transactions. Like the
// real SDK, a transaction must finish its reads before its first write.

const { randomBytes } = require('node:crypto')

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function deepMerge(current, next) {
  const result = plainObject(current) ? { ...current } : {}
  for (const [key, value] of Object.entries(next)) {
    result[key] = plainObject(value) && plainObject(result[key]) ? deepMerge(result[key], value) : clone(value)
  }
  return result
}

function fieldValue(data, field, id) {
  const name = String(field)
  if (name === '__name__') return id
  return name.split('.').reduce((value, part) => (value && typeof value === 'object' ? value[part] : undefined), data)
}

function compare(left, right) {
  if (left === right) return 0
  if (left === null || left === undefined) return -1
  if (right === null || right === undefined) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left) < String(right) ? -1 : 1
}

function firestoreError(code, message) {
  return Object.assign(new Error(message), { code })
}

function createMemoryFirestore(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]))
  const stats = { reads: 0, writes: 0, queries: [] }

  function snapshot(reference) {
    stats.reads += 1
    const exists = documents.has(reference.path)
    const data = documents.get(reference.path)
    return { id: reference.id, ref: reference, exists, data: () => clone(data), get: (field) => clone(fieldValue(data, field, reference.id)) }
  }

  function applyWrite(write) {
    stats.writes += 1
    const { type, reference, value, options } = write
    if (type === 'create') {
      if (documents.has(reference.path)) throw firestoreError(6, `already exists: ${reference.path}`)
      documents.set(reference.path, clone(value))
    } else if (type === 'set') {
      documents.set(reference.path, options?.merge ? deepMerge(documents.get(reference.path), value) : clone(value))
    } else if (type === 'update') {
      if (!documents.has(reference.path)) throw firestoreError(5, `not found: ${reference.path}`)
      documents.set(reference.path, { ...documents.get(reference.path), ...clone(value) })
    } else if (type === 'delete') {
      documents.delete(reference.path)
    }
  }

  function doc(path) {
    const parts = String(path).split('/')
    if (parts.length % 2 !== 0) throw new Error(`invalid document path ${path}`)
    const reference = {
      path,
      id: parts.at(-1),
      get: async () => snapshot(reference),
      create: async (value) => applyWrite({ type: 'create', reference, value }),
      set: async (value, options) => applyWrite({ type: 'set', reference, value, options }),
      update: async (value) => applyWrite({ type: 'update', reference, value }),
      delete: async () => applyWrite({ type: 'delete', reference }),
    }
    return reference
  }

  function query(collectionPath, state = { filters: [], orders: [], limit: Infinity, after: null }) {
    const extend = (patch) => query(collectionPath, { ...state, ...patch })
    const run = () => {
      stats.queries.push({ collection: collectionPath, filters: state.filters.map(([field, op]) => `${field}${op}`), orders: state.orders.map(([field]) => String(field)) })
      const prefix = `${collectionPath}/`
      let rows = [...documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]) => ({ id: path.slice(prefix.length), path, data }))
      for (const [field, op, expected] of state.filters) {
        rows = rows.filter((row) => {
          const actual = fieldValue(row.data, field, row.id)
          if (op === '==') return compare(actual, expected) === 0 && actual !== undefined
          if (op === '!=') return actual !== undefined && compare(actual, expected) !== 0
          if (op === '<') return actual !== undefined && actual !== null && compare(actual, expected) < 0
          if (op === '<=') return actual !== undefined && actual !== null && compare(actual, expected) <= 0
          if (op === '>') return actual !== undefined && actual !== null && compare(actual, expected) > 0
          if (op === '>=') return actual !== undefined && actual !== null && compare(actual, expected) >= 0
          if (op === 'in') return expected.some((item) => compare(actual, item) === 0)
          if (op === 'array-contains') return Array.isArray(actual) && actual.some((item) => compare(item, expected) === 0)
          if (op === 'array-contains-any') return Array.isArray(actual) && actual.some((item) => expected.some((value) => compare(item, value) === 0))
          throw new Error(`unsupported operator ${op}`)
        })
      }
      const orders = state.orders.length ? state.orders : [['__name__', 'asc']]
      rows = rows.filter((row) => orders.every(([field]) => fieldValue(row.data, field, row.id) !== undefined))
      const tuple = (row) => orders.map(([field]) => fieldValue(row.data, field, row.id))
      const ordered = (left, right) => {
        for (let index = 0; index < orders.length; index += 1) {
          const result = compare(left[index], right[index])
          if (result) return orders[index][1] === 'desc' ? -result : result
        }
        return 0
      }
      rows.sort((left, right) => ordered(tuple(left), tuple(right)) || compare(left.id, right.id))
      if (state.after) rows = rows.filter((row) => ordered(tuple(row).slice(0, state.after.length), state.after) > 0)
      return rows.slice(0, state.limit)
    }
    const api = {
      where: (field, op, value) => extend({ filters: [...state.filters, [String(field), op, value]] }),
      orderBy: (field, direction = 'asc') => extend({ orders: [...state.orders, [String(field), direction]] }),
      limit: (count) => extend({ limit: count }),
      startAfter: (...values) => extend({ after: values }),
      select: () => api,
      get: async () => {
        const docs = run().map((row) => snapshot(doc(row.path)))
        return { docs, size: docs.length, empty: !docs.length, forEach: (callback) => docs.forEach(callback) }
      },
      count: () => ({ get: async () => ({ data: () => ({ count: run().length }) }) }),
    }
    return api
  }

  function collection(path) {
    return {
      ...query(path),
      doc: (id) => doc(`${path}/${id || randomBytes(10).toString('hex')}`),
    }
  }

  function batch() {
    const writes = []
    return {
      create: (reference, value) => writes.push({ type: 'create', reference, value }),
      set: (reference, value, options) => writes.push({ type: 'set', reference, value, options }),
      update: (reference, value) => writes.push({ type: 'update', reference, value }),
      delete: (reference) => writes.push({ type: 'delete', reference }),
      commit: async () => { writes.forEach(applyWrite) },
    }
  }

  async function runTransaction(handler) {
    const writes = []
    const read = async (target) => {
      if (writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.')
      return typeof target.get === 'function' && target.path ? snapshot(target) : target.get()
    }
    const transaction = {
      get: read,
      getAll: async (...references) => Promise.all(references.map(read)),
      create: (reference, value) => { writes.push({ type: 'create', reference, value }); return transaction },
      set: (reference, value, options) => { writes.push({ type: 'set', reference, value, options }); return transaction },
      update: (reference, value) => { writes.push({ type: 'update', reference, value }); return transaction },
      delete: (reference) => { writes.push({ type: 'delete', reference }); return transaction },
    }
    const result = await handler(transaction)
    writes.forEach(applyWrite)
    return result
  }

  return {
    documents,
    stats,
    doc,
    collection,
    batch,
    runTransaction,
    getAll: async (...references) => references.filter((reference) => reference && reference.path).map(snapshot),
    data: (path) => clone(documents.get(path)),
    paths: (prefix) => [...documents.keys()].filter((path) => path.startsWith(prefix)).sort(),
  }
}

module.exports = { createMemoryFirestore }
