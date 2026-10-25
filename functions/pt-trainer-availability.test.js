'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createPtOperationsV2Functions } = require('./pt-operations-v2')
const { trainerProfileForWeek, trainerWeekIsEditable } = require('./trainer-availability')
const { buildPtScheduleWeeklyView } = require('./pt-schedule-weekly-view')

const WEEK = '2026-10-19'
const NEXT = '2026-10-26'
const BASE = ['T2-6', 'T3-6', 'T4-7']
const pt = { uid: 'pt', legacyStaffId: 'trainer', accessRole: 'staff', branchIds: ['b'], capabilities: ['pt.availability.self.manage'] }
const admin = { uid: 'admin', accessRole: 'admin', branchIds: [], capabilities: ['identity.staff_position.manage'] }

function harness(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-21T04:00:00Z') })
  const values = new Map(Object.entries({
    'trainers/trainer': { name: 'Mai', status: 'active', branchId: 'b', availableSlots: BASE, availabilityMode: 'configured', availabilityRevision: 8 },
    'roleAssignments/pt': { crmProfileId: 'trainer' },
    'settings/scheduleConfig': { workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'], workingHours: [6, 7, 8, 18] },
    'sessions/published': { trainerId: 'trainer', date: WEEK, hour: 6, status: 'scheduled' },
  }))
  let id = 0
  const snapshot = (ref) => ({ ref, id: ref.id, exists: values.has(ref.path), data: () => values.get(ref.path) })
  const db = {
    doc(path) { return { path, id: path.split('/').at(-1), get: async () => snapshot(db.doc(path)) } },
    getAll(...refs) { return Promise.all(refs.map((ref) => ref.get())) },
    collection(path) { return { doc: () => db.doc(`${path}/audit-${++id}`) } },
    async runTransaction(handler) {
      const writes = []
      const result = await handler({
        get: async (ref) => snapshot(ref),
        update: (ref, value) => writes.push(() => values.set(ref.path, { ...values.get(ref.path), ...value })),
        set: (ref, value, options) => writes.push(() => values.set(ref.path, { ...(options?.merge ? values.get(ref.path) : {}), ...value })),
        create: (ref, value) => { assert.equal(values.has(ref.path), false); writes.push(() => values.set(ref.path, value)) },
      })
      writes.forEach((write) => write())
      return result
    },
  }
  const api = createPtOperationsV2Functions({ db, onCall: (...args) => args.at(-1), availabilityAccessResolver: async (request) => request.actor })
  const read = (actor, weekId) => (actor === pt ? api.getMyTrainerAvailability : api.getPtTrainerAvailability)({ actor, data: { trainerUid: 'pt', weekId } })
  const save = (actor, weekId, availableSlots, expectedRevision, offDates = []) => (actor === pt ? api.saveMyTrainerAvailability : api.savePtTrainerAvailability)({ actor, data: { trainerUid: 'pt', weekId, availableSlots, expectedRevision, offDates } })
  return { values, api, read, save }
}

test('PT and admin edit the same exact weekly record after cutoff; next week and recurring stay independent', async (t) => {
  const h = harness(t)
  assert.equal((await h.read(pt, WEEK)).locked, false)
  assert.equal((await h.read(admin, WEEK)).source, 'recurring')
  await h.save(pt, WEEK, ['T2-6', 'T5-18'], 0)
  const managed = await h.read(admin, WEEK)
  assert.deepEqual(managed.availableSlots, ['T2-6', 'T5-18'])
  assert.equal(managed.availabilityRevision, 1)
  await h.save(admin, WEEK, ['T3-7'], managed.availabilityRevision)
  assert.deepEqual((await h.read(pt, WEEK)).availableSlots, ['T3-7'])
  assert.deepEqual((await h.read(pt, NEXT)).availableSlots, BASE)
  await h.save(pt, NEXT, ['T6-18'], 0)
  assert.deepEqual((await h.read(admin, NEXT)).availableSlots, ['T6-18'])
  assert.deepEqual((await h.read(pt, WEEK)).availableSlots, ['T3-7'])
  assert.deepEqual(h.values.get('trainers/trainer').availableSlots, BASE)
  assert.equal(h.values.get(`trainerAvailability/trainer_${WEEK}`).accountUid, 'pt')
  assert.equal(h.values.get('sessions/published').status, 'scheduled')
})

test('stale revisions cannot overwrite PT or admin changes', async (t) => {
  const h = harness(t)
  await h.save(pt, WEEK, ['T2-6'], 0)
  await assert.rejects(h.save(admin, WEEK, ['T3-6'], 0), (error) => error.code === 'aborted')
  await assert.rejects(h.save(pt, WEEK, ['T4-7'], 0), (error) => error.code === 'aborted')
  assert.deepEqual((await h.read(admin, WEEK)).availableSlots, ['T2-6'])
})

test('OFF dates are shared with scheduling; an empty weekly override never falls back to recurring', async (t) => {
  const h = harness(t)
  await h.save(admin, WEEK, ['T2-6'], 0, [WEEK])
  const read = await h.read(pt, WEEK)
  assert.deepEqual(read.availableSlots, [])
  assert.deepEqual(read.offDates, [WEEK])
  const effective = trainerProfileForWeek(h.values.get('trainers/trainer'), h.values.get(`trainerAvailability/trainer_${WEEK}`), WEEK)
  assert.deepEqual(effective.availableSlots, read.availableSlots)
  assert.deepEqual(effective.offDates, read.offDates)
  assert.equal(effective.availabilityMode, 'unconfigured')
})

test('recurring edits do not change submitted weekly overrides and use their own revision', async (t) => {
  const h = harness(t)
  await h.save(pt, WEEK, ['T2-6'], 0)
  await h.save(admin, undefined, ['T7-8'], 8)
  assert.deepEqual((await h.read(pt, undefined)).availableSlots, ['T7-8'])
  assert.deepEqual((await h.read(pt, NEXT)).availableSlots, ['T7-8'])
  assert.deepEqual((await h.read(pt, WEEK)).availableSlots, ['T2-6'])
  assert.deepEqual(h.values.get('staff/trainer').availableSlots, ['T7-8'])
})

test('admin endpoint enforces capability and branch; PT cannot target another trainer', async (t) => {
  const h = harness(t)
  await assert.rejects(h.api.savePtTrainerAvailability({ actor: pt, data: { trainerUid: 'pt', weekId: WEEK, availableSlots: ['T2-6'], expectedRevision: 0 } }), (error) => error.code === 'permission-denied')
  await assert.rejects(h.api.getPtTrainerAvailability({ actor: { ...admin, accessRole: 'staff', branchIds: ['other'] }, data: { trainerUid: 'pt', weekId: WEEK } }), (error) => error.code === 'permission-denied')
  const result = await h.api.getMyTrainerAvailability({ actor: pt, data: { trainerUid: 'someone-else', weekId: WEEK } })
  assert.equal(result.trainerId, 'trainer')
  await assert.rejects(h.save(pt, '2026-10-12', ['T2-6'], 0), (error) => error.details?.issueCode === 'TRAINER_AVAILABILITY_LOCKED')
})

test('admin can clear recurring availability without erasing a separately submitted week', async (t) => {
  const h = harness(t)
  await h.save(pt, WEEK, ['T2-6'], 0)
  const result = await h.save(admin, undefined, [], 8)
  assert.equal(result.availabilityMode, 'unconfigured')
  assert.equal((await h.read(pt, NEXT)).availabilityMode, 'unconfigured')
  assert.deepEqual((await h.read(pt, WEEK)).availableSlots, ['T2-6'])
})

test('weekly availability is validated and unrestricted recurring mode cannot override a submitted week', async (t) => {
  const h = harness(t)
  await assert.rejects(h.save(pt, WEEK, ['T2-23'], 0), (error) => error.code === 'invalid-argument')
  h.values.get('trainers/trainer').availabilityMode = 'unrestricted'
  await h.save(pt, WEEK, ['T2-6'], 0)
  assert.equal((await h.read(pt, WEEK)).availabilityMode, 'configured')
})

test('Vietnam week boundaries permit current and next week including Sunday after cutoff', () => {
  assert.equal(trainerWeekIsEditable(WEEK, new Date('2026-10-25T16:59:59Z')), true)
  assert.equal(trainerWeekIsEditable(NEXT, new Date('2026-10-25T16:59:59Z')), true)
  assert.equal(trainerWeekIsEditable(WEEK, new Date('2026-10-25T17:00:00Z')), false)
  assert.equal(trainerWeekIsEditable('2026-11-02', new Date('2026-10-25T17:00:00Z')), true)
})

test('weekly matrix projection retains all 78 trainer slots, source and OFF dates', () => {
  const slots = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'].flatMap((day) => [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20].map((hour) => `${day}-${hour}`))
  const view = buildPtScheduleWeeklyView({ branchId: 'b', weekId: WEEK, data: {
    readMode: 'display', partial: true, branch: { id: 'b' }, draft: {}, schedule: {}, students: [],
    trainers: [{ id: 'trainer', availableSlots: slots, availabilityMode: 'configured', availabilitySource: 'weekly', availabilityWeekId: WEEK, offDates: [] }],
  } })
  assert.equal(view.schemaVersion, 3)
  assert.deepEqual(view.trainers[0].availableSlots, slots)
  assert.equal(view.trainers[0].availabilitySource, 'weekly')
  assert.equal(view.trainers[0].availabilityWeekId, WEEK)
})
