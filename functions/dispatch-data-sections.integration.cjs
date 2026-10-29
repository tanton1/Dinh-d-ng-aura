'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { createEatCleanFunctions } = require('./eat-clean')
const signals = require('./delivery-workspace-signals')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `dispatch-sections-${randomUUID()}`)
const databases = []
const fixture = () => { const db = getFirestore(app, `sections-${randomUUID()}`); databases.push(db); return db }
after(async () => { await Promise.all(databases.map(db => db.terminate())); await deleteApp(app) })
const version = n => `001792890000.${String(n).padStart(9, '0')}`
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
async function seed(db) {
  const batch = db.batch(), now = Timestamp.now()
  for (const [path, data] of [
    ['users/admin', { role: 'admin' }], ['users/a', { role: 'shipper', displayName: 'A' }],
    ['users/b', { role: 'shipper', displayName: 'B' }], ['eatCleanShippers/a', { available: true }],
    ...['one', 'two'].map(id => [`eatCleanDeliveries/${id}`, { status: 'accepted', shipperId: 'a', updatedAt: now, assignedAt: now, acceptedAt: now, otpLockedUntil: now, deliveryOtpHash: 'secret-otp' }]),
    ['eatCleanOrders/one', { code: 'ONE', total: 100, items: [{ quantity: 2 }] }],
    ['system/eat_clean_config', { revision: 4, supportPhone: '0900' }],
    [`eatCleanOperationalSignals/${day()}`, { counts: { maps_error: 2, address_error: 3, route_error: 4 } }],
    ...['jobs', 'roster', 'config'].map((name, i) => [`eatCleanWorkspaceChanges/${name}`, { version: version(i + 1) }]),
  ]) batch.set(db.doc(path), data)
  await batch.commit()
}

function observe(db, { afterMarkers, failCollection } = {}) {
  const reads = []
  function query(source, name, operations = [], aggregate = false) {
    return new Proxy(source, { get(target, property) {
      if (property === 'get') return async () => {
        reads.push({ kind: aggregate ? 'count' : 'query', name, operations })
        if (failCollection === name) throw Object.assign(Error('Unavailable'), { code: 'unavailable' })
        return target.get()
      }
      if (['where', 'limit', 'select', 'orderBy', 'startAfter', 'count'].includes(property)) {
        return (...args) => query(target[property](...args), name, [...operations, { method: property, args }], aggregate || property === 'count')
      }
      return typeof target[property] === 'function' ? target[property].bind(target) : target[property]
    } })
  }
  const wrapped = {
    doc(name) { const ref = db.doc(name); return new Proxy(ref, { get(target, property) {
      if (property === 'get') return async () => { reads.push({ kind: 'doc', name }); return target.get() }
      return typeof target[property] === 'function' ? target[property].bind(target) : target[property]
    } }) },
    collection: name => query(db.collection(name), name),
    async getAll(...refs) {
      reads.push(...refs.map(ref => ({ kind: 'doc', name: ref.path })))
      const result = await db.getAll(...refs.map(ref => db.doc(ref.path)))
      if (refs.some(ref => ref.path.startsWith('eatCleanWorkspaceChanges/'))) await afterMarkers?.()
      return result
    },
  }
  const api = createEatCleanFunctions({ db: wrapped, onCall: (_options, handler) => handler,
    requireTrustedAdmin: async request => {
      const profile = request.auth && (await wrapped.doc(`users/${request.auth.uid}`).get()).data()
      if (!profile || profile.disabled === true || !['admin', 'super_admin'].includes(profile.role) || profile.role !== request.auth?.token?.role) throw Object.assign(Error('Denied'), { code: 'permission-denied' })
      return request.auth.uid
    },
    realtimeDb: { ref() { throw Error('Section reads must not access legacy GPS') } }, logger: { warn() {}, info() {} },
  })
  return { reads, read: data => api.listEatCleanDispatchData({ auth: { uid: 'admin', token: { role: 'admin' } }, data }) }
}

test('jobs-only reads one selected page, its orders, one total and its marker; no roster, config, signals or GPS', async () => {
  const db = fixture(); await seed(db)
  const observer = observe(db), result = await observer.read({ sections: ['jobs'], limit: 1 })
  assert.deepEqual(result.sections, ['jobs'])
  assert.deepEqual(result.workspaceSync, { schemaVersion: 1, accountId: 'admin', versions: { jobs: version(1) } })
  assert.equal(result.deliveries.length, 1); assert.equal(result.summary.totalActive, 2)
  assert.equal(result.page.hasMore, true); assert.ok(result.page.nextCursor)
  assert.equal(result.deliveries[0].locationStream.enabled, true)
  assert.match(result.deliveries[0].locationStream.binding, /^[a-f0-9]{64}$/)
  assert.ok(result.deliveries[0].otpLockedUntil)
  assert.equal(result.deliveries[0].liveLocation, null)
  assert.ok(!JSON.stringify(result).includes('secret-otp'))
  for (const key of ['shippers', 'config', 'readiness', 'rosterPage']) assert.ok(!Object.hasOwn(result, key))
  assert.ok(!Object.hasOwn(result.signals, 'mapsErrorsToday'))
  assert.equal(observer.reads.length, 5)
  assert.deepEqual(observer.reads.map(row => row.name).sort(), ['users/admin', 'eatCleanWorkspaceChanges/jobs', 'eatCleanDeliveries', 'eatCleanDeliveries', `eatCleanOrders/${result.deliveries[0].id}`].sort())
  assert.equal(observer.reads.filter(row => row.kind === 'count').length, 1)
  const next = await observer.read({ sections: ['jobs'], limit: 1, cursor: result.page.nextCursor })
  assert.notEqual(next.deliveries[0].id, result.deliveries[0].id)
  assert.equal(next.summary.totalActive, 2)
})

test('roster-only reads bounded profiles, availability and per-driver counts without job or order hydration', async () => {
  const db = fixture(); await seed(db)
  const observer = observe(db), result = await observer.read({ sections: ['roster'] })
  assert.deepEqual(result.workspaceSync.versions, { roster: version(2) })
  assert.equal(result.shippers.find(row => row.id === 'a').activeJobCount, 2)
  assert.equal(result.shippers.find(row => row.id === 'a').available, true)
  assert.deepEqual(result.rosterPage, { limit: 100, limitReached: false })
  assert.equal(observer.reads.length, 6)
  assert.equal(observer.reads.filter(row => row.kind === 'count').length, 2)
  assert.deepEqual(observer.reads.filter(row => row.kind === 'query').map(row => row.name), ['users', 'eatCleanShippers'])
  for (const key of ['deliveries', 'page', 'summary', 'signals', 'config']) assert.ok(!Object.hasOwn(result, key))
})

test('config-only uses auth, config marker and config; signals-only uses auth and current Vietnam day', async () => {
  const db = fixture(); await seed(db)
  for (const [section, expected] of [['config', ['users/admin', 'eatCleanWorkspaceChanges/config', 'system/eat_clean_config']], ['signals', ['users/admin', `eatCleanOperationalSignals/${day()}`]]]) {
    const observer = observe(db), result = await observer.read({ sections: [section] })
    assert.deepEqual(observer.reads.map(row => row.name), expected)
    assert.deepEqual(result.workspaceSync.versions, section === 'config' ? { config: version(3) } : {})
    if (section === 'config') assert.equal(result.config.revision, 4)
    else assert.deepEqual(result.signals, { mapsErrorsToday: 9, day: day() })
    for (const key of ['deliveries', 'shippers', 'summary', 'page']) assert.ok(!Object.hasOwn(result, key))
  }
})

test('a batched partial request hydrates once and never acknowledges unrequested or racing sections', async () => {
  const db = fixture(); await seed(db)
  const observer = observe(db, { afterMarkers: async () => {
    await db.doc('eatCleanWorkspaceChanges/jobs').set({ version: version(8) })
    await db.doc('eatCleanWorkspaceChanges/roster').set({ version: version(9) })
  } })
  const result = await observer.read({ sections: ['config', 'jobs'] })
  assert.deepEqual(result.sections, ['jobs', 'config'])
  assert.deepEqual(result.workspaceSync.versions, { jobs: version(1), config: version(3) })
  assert.equal((await db.doc('eatCleanWorkspaceChanges/jobs').get()).data().version, version(8))
  assert.equal(observer.reads.filter(row => row.kind === 'query' && row.name === 'eatCleanDeliveries').length, 1)
  assert.ok(!observer.reads.some(row => row.name === 'users' || row.name.endsWith('/roster')))
})

test('explicit all-sections keeps bounded business reads and skips all server GPS; legacy response remains compatible', async () => {
  const db = fixture(); await seed(db)
  const observer = observe(db)
  const result = await observer.read({ sections: ['jobs', 'roster', 'config', 'signals'] })
  assert.equal(result.deliveries.length, 2); assert.equal(result.shippers.length, 2)
  assert.equal(result.signals.mapsErrorsToday, 9); assert.equal(result.config.revision, 4)
  assert.ok(!observer.reads.some(row => row.name.startsWith('eatCleanLiveLocationViews/')))
  await db.doc('eatCleanDeliveries/one').update({ status: 'assigned' })
  await db.doc('eatCleanDeliveries/two').update({ status: 'assigned' })
  const legacy = await observer.read({})
  assert.equal(legacy.deliveries.length, 2); assert.equal(legacy.shippers.length, 2)
  assert.equal(legacy.summary.mapsErrorsToday, 9); assert.equal(legacy.config.revision, 4)
  assert.ok(!Object.hasOwn(legacy, 'workspaceSync')); assert.ok(!Object.hasOwn(legacy, 'sections'))
})

test('invalid sections and revoked access stop before business hydration; requested failures never become empty success', async () => {
  const db = fixture(); await seed(db)
  for (const sections of [null, [], 'jobs', ['jobs', 'jobs'], ['unknown'], [null], ['jobs', 'roster', 'config', 'signals', 'jobs']]) {
    const observer = observe(db)
    await assert.rejects(observer.read({ sections }), error => error.code === 'invalid-argument')
    assert.deepEqual(observer.reads, [{ kind: 'doc', name: 'users/admin' }])
  }
  await assert.rejects(observe(db, { failCollection: 'users' }).read({ sections: ['roster'] }), error => error.code === 'unavailable')
  for (const profile of [{ role: 'admin', disabled: true }, { role: 'student' }, null]) {
    if (profile) await db.doc('users/admin').set(profile); else await db.doc('users/admin').delete()
    const observer = observe(db)
    await assert.rejects(observer.read({ sections: ['jobs'] }), error => error.code === 'permission-denied')
    assert.deepEqual(observer.reads, [{ kind: 'doc', name: 'users/admin' }])
  }
})

function event(db, path, before, after, n = 1) {
  const time = `2026-10-25T01:00:${String(n).padStart(2, '0')}.123456789Z`
  const snapshot = value => ({ exists: value !== null, data: () => value, updateTime: time, ref: db.doc(path) })
  return { time, data: { before: snapshot(before), after: snapshot(after) } }
}
const publish = (db, path, before, after, n) => signals.syncDeliveryWorkspaceChange({ db, source: path.split('/')[0], event: event(db, path, before, after, n) })

test('business changes invalidate only affected jobs/roster; active-to-active and order edits do not reread driver counts', async () => {
  const db = fixture()
  await publish(db, 'eatCleanDeliveries/one', null, { shipperId: 'a', status: 'assigned' }, 1)
  const roster = await db.doc('eatCleanWorkspaceChanges/roster').get()
  await publish(db, 'eatCleanDeliveries/one', { shipperId: 'a', status: 'assigned' }, { shipperId: 'a', status: 'accepted' }, 2)
  await publish(db, 'eatCleanOrders/one', { total: 100 }, { total: 200 }, 3)
  assert.ok(roster.updateTime.isEqual((await roster.ref.get()).updateTime))
  const jobs = await db.doc('eatCleanWorkspaceChanges/jobs').get()
  await publish(db, 'eatCleanShippers/a', { available: false }, { available: true }, 4)
  assert.ok(jobs.updateTime.isEqual((await jobs.ref.get()).updateTime))
  assert.ok(!(await roster.ref.get()).updateTime.isEqual(roster.updateTime))
  const available = await roster.ref.get()
  await publish(db, 'eatCleanDeliveries/one', { shipperId: 'a', status: 'accepted' }, { shipperId: 'b', status: 'accepted' }, 5)
  assert.ok(!(await roster.ref.get()).updateTime.isEqual(available.updateTime))
  const assigned = await roster.ref.get()
  await publish(db, 'eatCleanDeliveries/one', { shipperId: 'b', status: 'accepted' }, { shipperId: 'b', status: 'delivered' }, 6)
  assert.ok(!(await roster.ref.get()).updateTime.isEqual(assigned.updateTime))
})

test('profile edits publish roster only; unrelated users and internal availability metadata do zero delivery IO', async () => {
  const db = fixture(), unused = { doc() { throw Error('Unexpected IO') } }
  for (const [path, before, after] of [
    ['users/student', { role: 'student', displayName: 'Before' }, { role: 'student', displayName: 'After' }],
    ['users/a', { role: 'shipper', weightKg: 60 }, { role: 'shipper', weightKg: 61 }],
    ['users/a', { role: 'shipper', disabled: true, displayName: 'Before' }, { role: 'shipper', disabled: true, displayName: 'After' }],
    ['eatCleanShippers/a', { available: true, activeJobCount: 1, updatedAt: 1 }, { available: true, activeJobCount: 2, updatedAt: 2 }],
  ]) assert.equal((await signals.syncDeliveryWorkspaceChange({ db: unused, source: path.split('/')[0], event: event(db, path, before, after) })).changed, 0)
  for (const [i, before, after] of [
    [1, null, { role: 'shipper', displayName: 'A' }],
    [2, { role: 'shipper', displayName: 'A' }, { role: 'shipper', displayName: 'B' }],
    [3, { role: 'shipper' }, { role: 'shipper', disabled: true }],
    [4, { role: 'shipper' }, { role: 'student' }],
    [5, { role: 'shipper' }, null],
  ]) {
    const result = await publish(db, 'users/a', before, after, i)
    assert.equal(result.targets, 1); assert.equal(result.changed, 1)
  }
  assert.deepEqual((await db.collection('eatCleanWorkspaceChanges').get()).docs.map(row => row.id), ['roster'])
})

test('the actual shared profile trigger awaits roster publication without adding another users trigger', async (t) => {
  const db = fixture()
  const { createStudent360SourceTrigger } = require('./student-360-background-functions')
  const registrations = [], projections = [], changes = []
  t.mock.method(require('./student-360'), 'enqueueStudent360ProjectionFromEvent', async args => {
    projections.push(args); return 'queued'
  })
  t.mock.method(require('./workspace-change-signals'), 'syncWorkspaceChangesFromEvent', async args => {
    changes.push(args); return {}
  })
  const publishRoster = signals.syncDeliveryWorkspaceChange
  let rosterStarted, releaseRoster, rosterCalls = 0
  const started = new Promise(resolve => { rosterStarted = resolve })
  const released = new Promise(resolve => { releaseRoster = resolve })
  t.mock.method(signals, 'syncDeliveryWorkspaceChange', async args => {
    rosterCalls++; rosterStarted(); await released
    return publishRoster(args)
  })
  const register = document => createStudent360SourceTrigger(document, {
    db, databaseId: 'named', logger: { warn() {} },
    onDocumentWritten: (options, handler) => { registrations.push(options); return handler },
  })
  let completed = false
  const pending = register('users/{accountUid}')(event(db, 'users/a', null, { role: 'shipper' }))
    .then(value => { completed = true; return value })
  try {
    await started
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(completed, false, 'the source event must not acknowledge before roster publication')
    assert.equal((await db.doc('eatCleanWorkspaceChanges/roster').get()).exists, false)
  } finally { releaseRoster() }
  assert.equal(await pending, 'queued')
  const roster = await db.doc('eatCleanWorkspaceChanges/roster').get()
  assert.ok(roster.exists); assert.equal(changes[0].source, 'users'); assert.equal(projections.length, 1)
  await register('students/{studentId}')(event(db, 'students/a', null, { role: 'shipper' }, 2))
  assert.ok(roster.updateTime.isEqual((await roster.ref.get()).updateTime))
  assert.equal(rosterCalls, 1)
  assert.deepEqual(registrations.map(row => row.document), ['users/{accountUid}', 'students/{studentId}'])
  assert.ok(registrations.every(row => row.database === 'named' && row.region === 'asia-southeast1' && row.retry))
})
