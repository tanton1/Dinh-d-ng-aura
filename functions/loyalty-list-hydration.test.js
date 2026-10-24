'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { Timestamp } = require('firebase-admin/firestore')
const { createLoyaltyFunctions } = require('./loyalty')

const endpoints = {
  listLoyaltyRedemptions: { collection: 'loyaltyRedemptions', result: 'redemptions', maximum: 40 },
  listLoyaltyReconciliationIssues: { collection: 'loyaltyReconciliationIssues', result: 'issues', maximum: 30 },
  listLoyaltyAdjustments: { collection: 'loyaltyAdjustments', result: 'adjustments', maximum: 40 },
}
const compareId = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))

function fixture({ name = 'listLoyaltyRedemptions', rows = {}, students = {}, role = 'staff', branches = ['a'], positions = ['branch_manager'] } = {}) {
  const records = new Map([
    ['users/actor', { role: role === 'staff' ? 'manager' : role }],
    ...Object.entries(students).map(([id, value]) => [`students/${id}`, value]),
  ])
  if (role === 'staff') records.set('roleAssignments/actor', {
    accessRole: 'staff', positions, branchIds: branches, authzVersion: 1, status: 'active',
  })
  const reads = { documents: [], profiles: [], queries: [] }
  const snapshot = (path) => ({ id: path.split('/').at(-1), exists: records.has(path), data: () => records.get(path) })
  const db = {
    doc(path) { return { path, get: async () => { reads.documents.push(path); return snapshot(path) } } },
    collection(collection) {
      assert.equal(collection, endpoints[name].collection)
      return { limit(limit) {
        assert.equal(limit, 300, 'keep the original global cap; no filter pushdown or replacement rows')
        return { get: async () => {
          const docs = Object.keys(rows).sort(compareId).slice(0, limit).map(id => ({ id, data: () => rows[id] }))
          reads.queries.push({ collection, limit, size: docs.length })
          return { docs, size: docs.length, empty: !docs.length }
        } }
      } }
    },
    getAll: async (...references) => references.map(({ path }) => {
      assert.ok(path.startsWith('students/'), 'lists hydrate profiles only; never read or initialize a wallet')
      reads.profiles.push(path)
      return snapshot(path)
    }),
  }
  // Deliberately no mutation API: merely opening any list cannot award points,
  // settle a redemption, initialize a wallet, or write an audit document.
  const handler = createLoyaltyFunctions({ db, onCall: (_options, callback) => callback })[name]
  const auth = { uid: 'actor', token: role === 'staff' ? { accessRole: 'staff', authzVersion: 1 } : { role } }
  return { records, reads, run: (data = {}, requestAuth = auth) => handler({ data, auth: requestAuth }) }
}

function iso(value) {
  const millis = typeof value?.toMillis === 'function' ? value.toMillis()
    : typeof value?.toDate === 'function' ? value.toDate().getTime()
      : value instanceof Date ? value.getTime() : new Date(value || '').getTime()
  return Number.isFinite(millis) && millis ? new Date(millis).toISOString() : ''
}

// Reference the original hydrate-all pipeline, including its raw-ID lookup,
// truthy branch precedence, per-endpoint normalization, truncation and sorting.
// This intentionally does not call the production prefilter.
function legacyResult({ name, rows, students, role, branches }, data = {}) {
  const canAccess = branch => ['admin', 'super_admin'].includes(role) || (branch && branches.includes(branch))
  const status = (typeof data.status === 'string' ? data.status.trim() : '') || (name === 'listLoyaltyAdjustments' ? 'pending_approval' : '')
  const profiles = new Map(Object.entries(students))
  const values = Object.keys(rows).sort(compareId).slice(0, 300)
    .map(id => ({ id, ...rows[id] })).filter(item => !status || item.status === status)
  const entries = values.flatMap(item => {
    const student = profiles.get(item.studentId) || {}
    const branchId = name === 'listLoyaltyReconciliationIssues'
      ? String(item.branchId || student.branchId || '')
      : item.branchId || student.branchId || ''
    if (!canAccess(branchId)) return []
    if (name === 'listLoyaltyReconciliationIssues') return [{
      id: item.id, type: String(item.type || 'unknown').slice(0, 120), status: String(item.status || 'open').slice(0, 30),
      studentId: String(item.studentId || ''), studentName: student.name || student.displayName || '',
      contractId: String(item.contractId || ''), branchId, errorCode: String(item.errorCode || '').slice(0, 120),
      updatedAt: iso(item.updatedAt || item.createdAt),
    }]
    if (name === 'listLoyaltyAdjustments') return [{
      id: item.id, studentId: item.studentId || '', studentName: student.name || student.displayName || 'Học viên Aura', branchId,
      points: Number(item.points || 0), reason: String(item.reason || '').slice(0, 500), status: item.status || 'pending_approval',
      requestedBy: item.requestedBy || '', createdAt: iso(item.createdAt), reviewedAt: iso(item.reviewedAt),
    }]
    return [{ ...item, branchId, studentName: student.name || student.displayName || 'Học viên Aura', createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt) }]
  })
  const sortKey = name === 'listLoyaltyAdjustments' ? 'createdAt' : 'updatedAt'
  entries.sort((left, right) => right[sortKey].localeCompare(left[sortKey]))
  return { [endpoints[name].result]: entries }
}

test('branch staff avoids all 300 denied profile reads while preserving the global query and result', async () => {
  const rows = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`row-${String(index).padStart(3, '0')}`, {
    studentId: `student-${index}`, branchId: 'outside', status: 'pending',
  }]))
  const students = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`student-${index}`, { branchId: 'a', name: `Student ${index}` }]))
  for (const name of ['listLoyaltyRedemptions', 'listLoyaltyReconciliationIssues']) {
    const config = { name, rows, students, role: 'staff', branches: ['a'] }
    const f = fixture(config)
    assert.deepEqual(await f.run(), legacyResult(config))
    assert.deepEqual(f.reads.profiles, [])
    assert.deepEqual(f.reads.queries, [{ collection: endpoints[name].collection, limit: 300, size: 300 }])
    // Before: 300 list docs + 300 profiles. After: 300 list docs + 0 profiles.
    // This is a synthetic worst-case fixture, not measured production savings.
  }
})

test('two-branch fixture halves hydration for scoped staff; admin still receives and hydrates all rows', async () => {
  const rows = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`row-${String(index).padStart(3, '0')}`, {
    studentId: `student-${index}`, branchId: index % 2 ? 'b' : 'a', status: 'pending_approval', points: index * 10,
  }]))
  const students = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`student-${index}`, { branchId: index % 2 ? 'b' : 'a', name: `Student ${index}` }]))
  for (const name of Object.keys(endpoints)) {
    for (const role of ['admin', 'super_admin', ...(name === 'listLoyaltyAdjustments' ? [] : ['staff'])]) {
      const config = { name, rows, students, role, branches: ['a'] }
      const f = fixture(config)
      assert.deepEqual(await f.run(), legacyResult(config))
      assert.equal(f.reads.profiles.length, role === 'staff' ? 150 : 300)
      assert.equal(new Set(f.reads.profiles).size, f.reads.profiles.length)
      // Scoped staff: 600 -> 450 returned document reads, excluding auth (25%).
      // Admin/super-admin: unchanged 600; do not claim savings for these roles.
    }
  }
})

test('explicit branch wins over moved profile; missing branch still hydrates for fallback authorization', async () => {
  const students = { movedOut: { branchId: 'b', name: 'Moved out' }, movedIn: { branchId: 'a', name: 'Moved in' }, shared: { branchId: 'a', displayName: 'Shared' } }
  const rows = {
    a: { studentId: 'movedOut', branchId: 'a' },
    b: { studentId: 'movedIn', branchId: 'b' },
    c: { studentId: 'movedOut' },
    d: { studentId: 'movedIn', branchId: '' },
    e: { studentId: 'shared', branchId: 'b' },
    f: { studentId: 'shared', branchId: 'a' },
    g: { studentId: 'missing', branchId: 'a' },
    h: { studentId: 'another-missing', branchId: null },
    i: { branchId: 'a' },
    j: { studentId: 'denied-only', branchId: 'b' },
  }
  for (const name of ['listLoyaltyRedemptions', 'listLoyaltyReconciliationIssues']) {
    const config = { name, rows, students, role: 'staff', branches: ['a'] }
    const f = fixture(config)
    assert.deepEqual(await f.run(), legacyResult(config))
    assert.deepEqual(f.reads.profiles, ['students/movedOut', 'students/movedIn', 'students/shared', 'students/missing', 'students/another-missing'])
  }
})

test('legacy truthiness and reconciliation-only String normalization preserve adversarial branch values', async () => {
  const branchValues = [undefined, null, '', false, 0, 1, true, '1', ' a ', ['a'], [], { id: 'a' }, 'a', 'outside']
  const rows = Object.fromEntries(branchValues.map((branchId, index) => [`row-${String(index).padStart(2, '0')}`, { studentId: `student-${index}`, branchId, status: 'pending_approval' }]))
  const students = Object.fromEntries(branchValues.map((_branch, index) => [`student-${index}`, { branchId: 'a', name: `Student ${index}` }]))
  for (const name of Object.keys(endpoints)) {
    for (const role of ['admin', ...(name === 'listLoyaltyAdjustments' ? [] : ['staff'])]) {
      const config = { name, rows, students, role, branches: ['a', '1'] }
      const f = fixture(config)
      assert.deepEqual(await f.run(), legacyResult(config))
      if (role === 'staff') {
        const expected = name === 'listLoyaltyReconciliationIssues' ? [0, 1, 2, 3, 4, 5, 7, 9, 12] : [0, 1, 2, 3, 4, 7, 12]
        assert.deepEqual(f.reads.profiles, expected.map(index => `students/student-${index}`))
      }
    }
  }
})

test('capped input, every status, timestamps, monetary fields and tie ordering remain identical', async () => {
  const branchValues = [undefined, null, '', false, 0, 'a', 'b', 'outside', ['a'], 1]
  const statuses = ['pending_approval', 'pending', 'fulfilled', 'approved', 'cancelled', 'rejected', 'open', 'repaired', undefined]
  const times = [undefined, '', 'invalid', '2026-10-24T01:02:03Z', Timestamp.fromMillis(1000), new Date(2000)]
  const students = Object.fromEntries(Array.from({ length: 117 }, (_, index) => [`student-${index}`, { branchId: ['a', 'b', undefined][index % 3], ...(index % 2 ? { name: `Name ${index}` } : { displayName: `Display ${index}` }) }]))
  const rows = Object.fromEntries(Array.from({ length: 420 }, (_, index) => [`row-${String(index).padStart(3, '0')}`, {
    studentId: index % 19 === 0 ? undefined : `student-${index % 151}`, branchId: branchValues[index % branchValues.length],
    status: statuses[index % statuses.length], createdAt: times[index % times.length], updatedAt: times[(index * 3) % times.length], reviewedAt: times[(index + 2) % times.length],
    points: (index % 2 ? -1 : 1) * index * 137, pointsCost: index * 999, rewardId: `reward-${index}`, reason: 'reason'.repeat(120),
    type: 'type'.repeat(40), errorCode: 'error'.repeat(40), contractId: `contract-${index}`, requestedBy: `actor-${index}`, opaqueField: { retained: true },
  }]))
  for (const name of Object.keys(endpoints)) {
    for (const role of ['admin', 'super_admin', ...(name === 'listLoyaltyAdjustments' ? [] : ['staff'])]) {
      for (const status of [undefined, '', ' pending ', 'pending_approval', 'fulfilled', 'open', 'no_match']) {
        // The new open-queue mode intentionally pushes pending/approved into
        // Firestore; its beyond-300 behavior is covered by emulator tests.
        if (name === 'listLoyaltyRedemptions' && status === 'open') continue
        const config = { name, rows, students, role, branches: ['a'] }
        const f = fixture(config)
        assert.deepEqual(await f.run({ status }), legacyResult(config, { status }), `${name}/${role}/${status}`)
        assert.equal(f.reads.queries[0].size, 300)
        assert.ok(f.reads.profiles.length <= 151)
      }
    }
  }
})

test('denied rows do not get replaced by matching records after the original cap', async () => {
  const rows = Object.fromEntries(Array.from({ length: 301 }, (_, index) => [`row-${String(index).padStart(3, '0')}`, { studentId: `student-${index}`, branchId: index === 300 ? 'a' : 'b' }]))
  for (const name of ['listLoyaltyRedemptions', 'listLoyaltyReconciliationIssues']) {
    const f = fixture({ name, rows })
    assert.deepEqual(await f.run(), { [endpoints[name].result]: [] })
    assert.deepEqual(f.reads.profiles, [])
    assert.equal(f.reads.queries[0].size, 300)
  }
})

test('fresh invocations still observe profile moves, names, status and row financial changes without caching', async () => {
  for (const name of Object.keys(endpoints)) {
    const rows = { row: { studentId: 'student', status: 'pending_approval', points: 50, pointsCost: 123, updatedAt: Timestamp.fromMillis(1000) } }
    const config = { name, rows, students: { student: { branchId: 'a', name: 'Before' } }, role: 'admin', branches: ['a'] }
    const f = fixture(config)
    assert.deepEqual(await f.run(), legacyResult(config))
    config.students.student = { branchId: 'b', name: 'After' }
    f.records.set('students/student', config.students.student)
    rows.row.points = -150
    rows.row.pointsCost = 789
    rows.row.updatedAt = Timestamp.fromMillis(5000)
    assert.deepEqual(await f.run(), legacyResult(config))
    assert.deepEqual(f.reads.profiles, ['students/student', 'students/student'])
  }
})

test('all lists deny unauthenticated, student, unauthorized-position and disabled callers before business reads', async () => {
  for (const name of Object.keys(endpoints)) {
    const unauthenticated = fixture({ name })
    await assert.rejects(unauthenticated.run({}, null), { code: 'unauthenticated' })
    for (const f of [fixture({ name, role: 'student' }), fixture({ name, positions: ['trainer_pt'] }), fixture({ name, role: 'admin' })]) {
      if (f.records.get('users/actor').role === 'admin') f.records.set('users/actor', { role: 'admin', disabled: true })
      await assert.rejects(f.run(), { code: 'permission-denied' })
      assert.deepEqual(f.reads.queries, [])
      assert.deepEqual(f.reads.profiles, [])
      assert.ok(f.reads.documents.every(path => path.startsWith('users/') || path.startsWith('roleAssignments/')))
    }
  }
})

test('adjustments remain admin-only; token claims cannot grant branch staff approval capability', async () => {
  const f = fixture({ name: 'listLoyaltyAdjustments' })
  await assert.rejects(f.run({}, { uid: 'actor', token: { accessRole: 'staff', authzVersion: 1, capabilities: ['loyalty.adjust.approve'] } }), { code: 'permission-denied' })
  assert.deepEqual(f.reads.queries, [])
  assert.deepEqual(f.reads.profiles, [])
})

test('invalid status retains existing validation and never causes profile reads', async () => {
  for (const name of Object.keys(endpoints)) {
    const f = fixture({ name, role: 'admin', rows: { row: { studentId: 'student', branchId: 'a' } } })
    await assert.rejects(f.run({ status: 'x'.repeat(endpoints[name].maximum + 1) }), { code: 'invalid-argument' })
    assert.deepEqual(f.reads.profiles, [])
    // Redemptions originally validates after its capped query; do not silently
    // change that sequencing while optimizing only profile hydration.
    assert.equal(f.reads.queries.length, name === 'listLoyaltyRedemptions' ? 1 : 0)
  }
})
