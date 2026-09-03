import assert from 'node:assert/strict'
import test from 'node:test'
import {
  friendlyReadOnlyCallableMessage,
  isRetryableReadOnlyCallableError,
  runReadOnlyWithRetry,
} from '../src/services/readOnlyCallableCore'
import { normalizeTrainerStudentDetail } from '../src/services/ptOperationsV2Normalization'

test('read-only callable retries bounded transient failures and returns the successful value', async () => {
  let invocations = 0
  const delays: number[] = []
  const result = await runReadOnlyWithRetry(async () => {
    invocations += 1
    if (invocations < 3) throw { code: 'functions/internal', message: 'internal' }
    return { ok: true }
  }, {
    random: () => 0.5,
    sleep: async (delay) => { delays.push(delay) },
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(invocations, 3)
  assert.deepEqual(delays, [300, 600])
})

test('read-only callable never retries a business validation failure', async () => {
  let invocations = 0
  await assert.rejects(() => runReadOnlyWithRetry(async () => {
    invocations += 1
    throw { code: 'functions/failed-precondition', message: 'Hợp đồng chưa đủ điều kiện.' }
  }, { sleep: async () => undefined }), /Hợp đồng chưa đủ điều kiện/)
  assert.equal(invocations, 1)
})

test('read-only callable refreshes authentication once before retrying', async () => {
  let invocations = 0
  let refreshes = 0
  const result = await runReadOnlyWithRetry(async () => {
    invocations += 1
    if (invocations === 1) throw { code: 'functions/unauthenticated', message: 'unauthenticated' }
    return 'ready'
  }, { refreshAuth: async () => { refreshes += 1 }, sleep: async () => undefined })
  assert.equal(result, 'ready')
  assert.equal(refreshes, 1)
  assert.equal(invocations, 2)
})

test('raw internal and rate limit failures become actionable Vietnamese messages', () => {
  assert.equal(isRetryableReadOnlyCallableError({ message: 'Rate exceeded.' }), true)
  assert.doesNotMatch(friendlyReadOnlyCallableMessage({ code: 'functions/internal', message: 'internal' }), /^internal$/i)
  assert.match(friendlyReadOnlyCallableMessage({ code: 'functions/resource-exhausted', message: 'Rate exceeded.' }), /nhiều lượt truy cập/)
})

test('Staff student detail makes legacy and malformed callable rows safe to render', () => {
  const detail = normalizeTrainerStudentDetail({
    student: { name: 123, phone: null },
    contracts: [{ id: 'contract-a', packageName: { legacy: true }, totalSessions: '36', usedSessions: '12' }],
    sessions: [{ id: 'session-a', date: null, hour: '18', status: null }, null],
    availability: { slots: ['T2-8', null, { day: 'T4', hour: 18 }, 'not-a-slot'] },
    workoutLogs: [{ id: 'log-a', programName: { legacy: true }, completedAt: null }, null],
  }, { studentId: 'student-a', weekId: '2026-08-31' })

  assert.equal(detail.student.id, 'student-a')
  assert.equal(detail.contracts[0].packageName, 'Gói tập Aura')
  assert.equal(detail.contracts[0].remainingSessions, 24)
  assert.equal(detail.sessions[0].hour, 18)
  assert.deepEqual(detail.availability.slots, ['T2-8', 'T4-18'])
  assert.equal(detail.availability.weekId, '2026-08-31')
  assert.equal(detail.workoutLogs[0].programName, '')
  assert.equal(detail.workoutLogs[1].id, 'workout-2')
})

test('Staff student detail supplies empty collections when an older response omits them', () => {
  const detail = normalizeTrainerStudentDetail(undefined, { studentId: 'student-b', weekId: '2026-09-07' })

  assert.deepEqual(detail.contracts, [])
  assert.deepEqual(detail.sessions, [])
  assert.deepEqual(detail.workoutLogs, [])
  assert.deepEqual(detail.availability.slots, [])
  assert.equal(detail.student.id, 'student-b')
  assert.equal(detail.availability.weekId, '2026-09-07')
})
