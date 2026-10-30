'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { HttpsError } = require('firebase-functions/v2/https')
const admission = require('./push-broadcast-admission')
const { pushDeliveryFixture } = require('./test-support/push-delivery-fixture')
const source = fs.readFileSync(require.resolve('./index.js'), 'utf8')
const helpers = source.slice(source.indexOf('function requireCaller(request)'), source.indexOf('const scheduledReminderDefaults'))
const dispatch = source.slice(source.indexOf('exports.dispatchPushBroadcast = onCall('), source.indexOf('\nfunction requireDocumentId('))
const roles = source.match(/const assignableRoles = new Set\([^\n]+/)[0] + '\n' + source.match(/const privilegedAdminRoles = new Set\([^\n]+/)[0]
const admin = { role: 'admin' }
const population = count => [['admin', admin], ...Array.from({ length: count - 1 }, (_, i) => [`student-${String(i).padStart(4, '0')}`, { role: 'student' }])]

function harness(entries = population(2)) {
  const durable = pushDeliveryFixture()
  const state = { profiles: new Map(entries), devices: [], reads: [], effects: durable.effects, batches: 0, clock: 0, advance: 0, deviceFailureAt: 0, deviceQueries: 0 }
  const doc = path => /^users\/[^/]+$/.test(path)
    ? { path, id: path.split('/').at(-1), get: async () => snapshot(path.split('/').at(-1)) }
    : durable.db.doc(path)
  const snapshot = id => ({ id, exists: state.profiles.has(id), data: () => state.profiles.get(id), ref: doc('users/' + id) })
  let nextId = 0
  function collection(name, group = false) {
    const options = { name, group, limit: null, ids: null, fields: null }
    const query = {
      doc: id => doc(name + '/' + (id || `generated-${++nextId}`)),
      where: (field, op, ids) => { assert.equal(field, 'userId'); assert.equal(op, 'in'); assert(ids.length <= 30); options.ids = ids; return query },
      select: (...fields) => { options.fields = fields; return query },
      limit: n => { options.limit = n; return query },
      get: async () => {
        assert(Number.isInteger(options.limit) && options.limit > 0, 'every admission population/device query is bounded')
        state.reads.push({ ...options }); state.clock += state.advance
        if (group) {
          state.deviceQueries++
          if (state.deviceQueries === state.deviceFailureAt) throw Error('Private database error must not escape')
          const rows = state.devices.filter(d => options.ids.includes(d.userId)).slice(0, options.limit)
          return { docs: rows.map((row, i) => ({ id: String(i), data: () => row, ref: doc(`users/${row.userId}/devices/${row.id || i}`) })) }
        }
        assert.equal(name, 'users')
        return { docs: [...state.profiles.keys()].sort().slice(0, options.limit).map(snapshot) }
      },
    }
    return query
  }
  const db = { doc, collection, collectionGroup: name => collection(name, true), runTransaction: durable.db.runTransaction,
    getAll: async (...refs) => { state.reads.push({ name: 'getAll', ids: refs.map(r => r.id) }); state.clock += state.advance; return refs.map(r => snapshot(r.id)) },
    batch: () => { state.batches++; const writes = []; return { set: (ref, value) => writes.push({ kind: 'inbox', path: ref.path, value }), delete: ref => writes.push({ kind: 'cleanup', path: ref.path }), commit: async () => state.effects.push(...writes) } },
  }
  const context = { exports: {}, require, ...admission, createPushAdmissionBudget: () => admission.createPushAdmissionBudget(() => state.clock), db, HttpsError, FieldValue: { serverTimestamp: () => 1 }, URL,
    publicAppUrl: 'https://fixture.invalid', console: { error: () => {} },
    onCall: (options, handler) => { assert.equal(options.cpu, 'gcf_gen1'); assert.equal(options.maxInstances, 1); assert.equal(options.invoker, 'public'); return handler },
    messaging: { sendEachForMulticast: async payload => { state.effects.push({ kind: 'fcm', payload }); return { successCount: payload.tokens.length, failureCount: 0, responses: payload.tokens.map(() => ({ success: true })) } } },
  }
  vm.runInNewContext(roles + '\n' + helpers + '\n' + dispatch, context)
  const send = (data = {}, auth = { uid: 'admin', token: { role: 'admin' } }) => context.exports.dispatchPushBroadcast({ auth, data: { title: 'Title', message: 'Message', targetType: 'selected', targetUserIds: ['student-0000'], ...data } })
  return { state, send }
}
async function rejectedBeforeDelivery(h, data, reason, auth) {
  await assert.rejects(h.send(data, auth), error => reason ? error.details?.reason === reason : true)
  assert.equal(h.state.effects.length, 0)
  assert.equal(h.state.batches, 0)
}

test('1001 unique selected IDs reject instead of slicing; normalized duplicate IDs do not consume recipient slots', async () => {
  const h = harness(population(1002))
  await rejectedBeforeDelivery(h, { targetUserIds: Array.from({ length: 1001 }, (_, i) => `student-${String(i).padStart(4, '0')}`) }, 'SELECTED_AUDIENCE_LIMIT')
  assert.equal(h.state.reads.length, 0)
  const exact = harness(population(1001))
  const ids = Array.from({ length: 1000 }, (_, i) => `student-${String(i).padStart(4, '0')}`)
  const result = await exact.send({ targetUserIds: [...ids, ' student-0000 ', 'student-0000'] })
  assert.equal(result.sentCount, 1000)
  assert.equal(exact.state.effects.filter(e => e.kind === 'inbox').length, 1000)
  assert.equal(exact.state.reads.find(r => r.name === 'getAll').ids.length, 1000)
})

test('all users at 2000 are complete; 2001 and 2501 reject before filtering or any delivery', async () => {
  const exact = harness(population(2000)); assert.equal((await exact.send({ targetType: 'all' })).sentCount, 1999)
  assert.equal(exact.state.reads[0].limit, 2001)
  for (const count of [2001, 2501]) {
    const h = harness(population(count)); await rejectedBeforeDelivery(h, { targetType: 'all' }, 'POPULATION_LIMIT')
    assert.equal(h.state.reads.length, 1); assert.equal(h.state.reads[0].limit, 2001)
  }
  const staffFirst = harness([...Array.from({ length: 2000 }, (_, i) => [`a-staff-${i}`, { role: 'coach' }]), ['z-member', { role: 'student' }], ['admin', admin]])
  await rejectedBeforeDelivery(staffFirst, { targetType: 'all' }, 'POPULATION_LIMIT')
})

test('category directory guard matches unfiltered 2500-row client directory and uses one lookahead', async () => {
  const frontend = fs.readFileSync(require.resolve('../src/services/firebaseService.ts'), 'utf8')
  const subscription = frontend.slice(frontend.indexOf('export function subscribeToAdminUsers('), frontend.indexOf('export async function updateUserRole('))
  assert.match(subscription, /query\(collection\(db, 'users'\), limit\(2_500\)\)/)
  const exact = harness(population(2500)); assert.equal((await exact.send({ targetType: 'category' })).sentCount, 1)
  assert.deepEqual(exact.state.reads[0].fields, []); assert.equal(exact.state.reads[0].limit, 2501)
  const over = harness(population(2501)); await rejectedBeforeDelivery(over, { targetType: 'category' }, 'DIRECTORY_LIMIT')
  assert.equal(over.state.reads.length, 1)
  const individual = harness(population(2501)); assert.equal((await individual.send({ targetType: 'individual' })).sentCount, 1)
  assert.equal(individual.state.reads[0].name, 'getAll')
})

test('device budget counts every scanned document and finishes all chunks before first side effect', async () => {
  const exact = harness(); exact.state.devices = Array.from({ length: 2000 }, (_, i) => ({ userId: 'student-0000', token: `token-${i}` }))
  assert.equal((await exact.send()).webPushSentCount, 2000)
  assert.equal(exact.state.effects.filter(e => e.kind === 'fcm').length, 10)
  const over = harness(); over.state.devices = [...exact.state.devices, { userId: 'student-0000', enabled: false, token: 'disabled' }]
  await rejectedBeforeDelivery(over, {}, 'DEVICE_LIMIT')
  assert.equal(over.state.reads.find(r => r.group).limit, 2001)
  const chunks = harness(population(32)); const ids = [...chunks.state.profiles.keys()].filter(id => id !== 'admin')
  chunks.state.devices = [...Array.from({ length: 2000 }, (_, i) => ({ userId: ids[0], token: `token-${i}` })), { userId: ids[30], token: 'late-token' }]
  await rejectedBeforeDelivery(chunks, { targetUserIds: ids }, 'DEVICE_LIMIT')
  assert.deepEqual(chunks.state.reads.filter(r => r.group).map(r => r.limit), [2001, 1])
})

test('later device lookup errors and admission deadline reject before inbox/log/FCM/cleanup', async () => {
  const h = harness(population(32)); h.state.deviceFailureAt = 2
  await rejectedBeforeDelivery(h, { targetUserIds: [...h.state.profiles.keys()].filter(id => id !== 'admin') }, 'DEVICE_LOOKUP_FAILED')
  const slow = harness(); slow.state.advance = 45000
  await rejectedBeforeDelivery(slow, {}, 'ADMISSION_TIMEOUT')
})

test('literal legacy-member/staff/disabled/category policy and missing selected profiles remain unchanged', async () => {
  const users = [['admin', admin], ['legacy-missing', {}], ['legacy-null', { role: null }], ['legacy-empty', { role: '' }], ['member', { role: 'student' }], ['staff', { role: 'coach' }],
    ['disabled', { role: 'student', disabled: true }], ['status-disabled', { role: 'student', status: 'disabled' }], ['opt-out', { role: 'student', notificationSettings: { enabled: false } }], ['category-out', { role: 'student', notificationSettings: { mealReminders: false } }]]
  const all = harness(users); const result = await all.send({ targetType: 'all', category: 'nutrition', respectCategoryPreferences: false, targetUserIds: ['staff'] })
  assert.equal(result.sentCount, 4); assert.equal(result.filteredOutCount, 4)
  assert.deepEqual(all.state.effects.filter(e => e.kind === 'inbox').map(e => e.value.userId), ['legacy-empty', 'legacy-missing', 'legacy-null', 'member'])
  const selected = harness(users); const explicit = await selected.send({ targetUserIds: ['staff', 'member', 'missing', 'opt-out'], category: 'nutrition', respectCategoryPreferences: false })
  assert.equal(explicit.sentCount, 2); assert.equal(explicit.filteredOutCount, 2)
})

test('self-device preference bypass remains own-account only and never bypasses disabled', async () => {
  const h = harness([['admin', { role: 'admin', notificationSettings: { enabled: false, mealReminders: false } }]])
  assert.equal((await h.send({ targetUserIds: [' admin ', 'admin'], respectCategoryPreferences: false, category: 'nutrition' })).sentCount, 1)
  const normal = harness([['admin', { role: 'admin', notificationSettings: { enabled: false } }]])
  assert.equal((await normal.send({ targetUserIds: ['admin'] })).sentCount, 0)
  const disabled = harness([['admin', { role: 'admin', disabled: true }]])
  await rejectedBeforeDelivery(disabled, { targetUserIds: ['admin'], respectCategoryPreferences: false })
})

test('permissions and malformed input cannot start admission delivery or leak raw lookup errors', async () => {
  for (const auth of [null, { uid: 'admin', token: { role: 'student' } }, { uid: 'missing', token: { role: 'admin' } }]) await rejectedBeforeDelivery(harness(), {}, null, auth)
  for (const targetUserIds of [null, [], ['student-0000', 1], ['student-0000', ''], ['user/path'], ['x'.repeat(501)]]) await rejectedBeforeDelivery(harness(), { targetUserIds })
  for (const data of [{ targetType: 'unknown' }, { title: '' }, { message: '' }, { actionUrl: '//evil.invalid' }]) await rejectedBeforeDelivery(harness(), data)
  const h = harness(); h.state.deviceFailureAt = 1
  await assert.rejects(h.send(), e => e.code === 'unavailable' && !e.message.includes('Private database'))
  assert.equal(h.state.effects.length, 0)
})

test('a completed request replay reauthorizes the caller before reading or continuing its receipt', async () => {
  const h = harness()
  const data = { requestId: 'intent-authorization' }
  await h.send(data)
  const effects = h.state.effects.length
  const reads = h.state.reads.length
  for (const profile of [{ role: 'student' }, { role: 'admin', disabled: true }, null]) {
    if (profile) h.state.profiles.set('admin', profile)
    else h.state.profiles.delete('admin')
    await assert.rejects(h.send(data), error => error.code === 'permission-denied')
    assert.equal(h.state.effects.length, effects)
    assert.equal(h.state.reads.length, reads)
  }
})
