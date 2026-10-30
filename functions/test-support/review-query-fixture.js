'use strict'

const scalar = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : value)
const fieldValue = (row, field) => String(field) === '__name__' ? row.id : String(field).split('.').reduce((value, key) => value?.[key], row)
const snapshot = (id, data) => ({ id, exists: data !== undefined, data: () => data })

function reviewFixture(collections = {}, profiles = {}) {
  const queries = []
  const reads = []
  const db = {
    doc(path) {
      const [collection, id] = path.split('/')
      return { id, path, async get() {
        reads.push(path)
        if (Object.hasOwn(profiles, path)) return snapshot(id, profiles[path])
        if (path.startsWith('users/audit_')) return snapshot(id, { role: 'admin', displayName: 'Audit fixture' })
        const value = (collections[collection] || []).find(row => row.id === id)
        return snapshot(id, value)
      } }
    },
    async getAll(...references) { return Promise.all(references.map(reference => reference.get())) },
    collection(name) {
      const predicates = [], ordering = []
      let maximum = Infinity, after = null
      const query = {
        where(field, operator, value) { predicates.push({ field, operator, value }); return query },
        orderBy(field, direction = 'asc') { ordering.push({ field: String(field), direction }); return query },
        startAfter(...values) { after = values; return query },
        limit(count) { maximum = count; return query },
        async get() {
          let rows = [...(collections[name] || [])]
          for (const { field, operator, value } of predicates) rows = rows.filter(row => {
            const actual = scalar(fieldValue(row, field)), expected = scalar(value)
            if (actual === undefined) return false
            if (operator === '==') return actual === expected
            if (operator === '>=') return actual >= expected
            if (operator === '>') return actual > expected
            if (operator === '<') return actual < expected
            if (operator === '<=') return actual <= expected
            if (operator === 'in') return value.includes(actual)
            if (operator === 'array-contains') return Array.isArray(actual) && actual.includes(expected)
            if (operator === 'array-contains-any') return Array.isArray(actual) && actual.some(item => value.includes(item))
            throw new Error(`Unhandled fixture predicate ${operator}`)
          })
          const compare = (row, values) => {
            for (let index = 0; index < ordering.length; index += 1) {
              const { field, direction } = ordering[index]
              const a = scalar(fieldValue(row, field)), b = scalar(values[index])
              const difference = (a < b ? -1 : a > b ? 1 : 0) * (direction === 'desc' ? -1 : 1)
              if (difference) return difference
            }
            return 0
          }
          if (ordering.length) {
            rows = rows.filter(row => ordering.every(({ field }) => fieldValue(row, field) !== undefined))
            rows.sort((a, b) => compare(a, ordering.map(({ field }) => fieldValue(b, field))))
          }
          if (after) rows = rows.filter(row => compare(row, after) > 0)
          rows = rows.slice(0, maximum)
          queries.push({ name, predicates, ordering, maximum, after, returned: rows.length })
          return { docs: rows.map(row => snapshot(row.id, row)), size: rows.length, empty: !rows.length }
        },
      }
      return query
    },
  }
  return { db, queries, reads, collections, profiles }
}

const adminRequest = data => ({ auth: { uid: 'audit_admin', token: { role: 'admin' } }, data })

module.exports = { reviewFixture, adminRequest }
