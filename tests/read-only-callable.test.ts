import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  friendlyReadOnlyCallableMessage,
  isRetryableReadOnlyCallableError,
  runReadOnlyWithRetry,
} from '../src/services/readOnlyCallableCore'
import { normalizeTrainerStudentDetail } from '../src/services/ptOperationsV2Normalization'
import { runAcademyReadWithFallback } from '../src/services/academyReadPolicy'
import { runKeyedSingleFlight } from '../src/utils/singleFlight'

test('Academy reads fail over regional CPU exhaustion and do not duplicate successful reads', async () => {
  let primaryCalls = 0
  let fallbackCalls = 0
  const fallback = async () => { fallbackCalls += 1; return 'legacy' }
  assert.equal(await runAcademyReadWithFallback(async () => { primaryCalls += 1; return 'regional' }, fallback), 'regional')
  assert.equal(fallbackCalls, 0)
  const result = await runAcademyReadWithFallback(async () => {
    primaryCalls += 1
    throw new Error('Dịch vụ tạm gián đoạn', { cause: { code: 'functions/unavailable', message: 'CPU allocation quota exceeded' } })
  }, fallback)
  assert.equal(result, 'legacy')
  assert.equal(primaryCalls, 2)
  assert.equal(fallbackCalls, 1)
})

test('Academy never fails over authorization, validation, missing content or canceled reads', async () => {
  for (const code of ['unauthenticated', 'permission-denied', 'not-found', 'failed-precondition', 'invalid-argument']) {
    const error = new Error('Rejected', { cause: { code: `functions/${code}`, message: 'internal' } })
    await assert.rejects(runAcademyReadWithFallback(async () => { throw error }, async () => {
      assert.fail(`Must not retry ${code} in another region`)
    }), (actual) => actual === error)
  }
  const aborted = new DOMException('Aborted', 'AbortError')
  await assert.rejects(runAcademyReadWithFallback(async () => { throw aborted }, async () => {
    assert.fail('Canceled request must not fail over')
  }), (actual) => actual === aborted)
})

test('Academy shows the final failure if neither region is available', async () => {
  let fallbackCalls = 0
  const unavailable = { code: 'functions/internal', message: 'internal' }
  const finalFailure = new Error('Cả hai vùng tạm gián đoạn')
  await assert.rejects(runAcademyReadWithFallback(async () => { throw unavailable }, async () => {
    fallbackCalls += 1
    throw finalFailure
  }), (actual) => actual === finalFailure)
  assert.equal(fallbackCalls, 1)
})

test('business reporting reads prefer the overflow aliases and retain a transient fallback', () => {
  const functionsClient = readFileSync(new URL('../src/lib/firebaseFunctions.ts', import.meta.url), 'utf8')
  const service = readFileSync(new URL('../src/services/businessReportingService.ts', import.meta.url), 'utf8')
  assert.match(functionsClient, /firebaseBusinessReportingFunctions = firebaseScheduleOptimizerFunctions/)
  assert.match(service, /callBusinessReportingRead/)
  assert.match(service, /`\$\{name\}Regional`/)
  assert.match(service, /runReadOnlyWithFallback/)
  assert.match(service, /maximumAttempts: 1/)
  assert.match(service, /timeoutMs: 18_000/)
})

test('duplicate Academy readers share a pending failover and release it after completion', async () => {
  const pending = new Map<string, Promise<string>>()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let calls = 0
  const load = () => runKeyedSingleFlight(pending, 'session:course:enrollment', () => runAcademyReadWithFallback(async () => {
    calls += 1
    throw { code: 'functions/resource-exhausted' }
  }, async () => { calls += 1; await gate; return 'course' }))
  const first = load()
  const second = load()
  assert.equal(first, second)
  release()
  assert.deepEqual(await Promise.all([first, second]), ['course', 'course'])
  assert.equal(calls, 2)
  assert.equal(pending.size, 0)
})

test('Academy transport isolates sessions and enrollment revisions without persisting content', () => {
  const source = readFileSync(new URL('../src/services/academyReadService.ts', import.meta.url), 'utf8')
  assert.match(source, /WeakMap<User, Map<string, Promise<unknown>>>/)
  assert.match(source, /firebaseAuth\?\.currentUser !== owner/)
  assert.match(source, /JSON\.stringify\(\[name, input, accessRevision\]\)/)
  assert.match(source, /assertSession\(\)\s+return result as Output/)
  assert.match(source, /type AcademyReadName = 'listAcademyCourses' \| 'getCourseMediaUrl'/)
  assert.doesNotMatch(source, /localStorage|sessionStorage|enrollInCourse|completeCourseLesson/)
  const hook = readFileSync(new URL('../src/hooks/useCourses.ts', import.meta.url), 'utf8')
  assert.match(hook, /readPending\.current \|\| document\.visibilityState !== 'visible'/)
  assert.match(hook, /< 5 \* 60_000/)
})

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
  assert.match(friendlyReadOnlyCallableMessage({ code: 'functions/unavailable', message: 'The request was aborted because there was no available instance.' }), /quá tải tạm thời/)
})

test('Operations dashboard uses the bounded read-only retry and auth recovery path', () => {
  const source = readFileSync(new URL('../src/services/operationsDashboardService.ts', import.meta.url), 'utf8')
  const dashboardLoader = source.slice(
    source.indexOf('export async function getOperationsDashboard'),
    source.indexOf('export async function listStaffAttendance'),
  )

  assert.match(source, /import \{ callReadOnlyFunction \} from '\.\/readOnlyCallableService'/)
  assert.match(dashboardLoader, /callReadOnlyFunction<[^>]+, unknown>\('getOperationsDashboard', input, \{/)
  assert.match(dashboardLoader, /timeoutMs: 30_000/)
  assert.match(dashboardLoader, /maximumAttempts: 2/)
  assert.doesNotMatch(dashboardLoader, /httpsCallable/)
})

test('Staff student detail makes legacy and malformed callable rows safe to render', () => {
  const detail = normalizeTrainerStudentDetail({
    student: { name: 123, phone: null },
    contracts: [{ id: 'contract-a', packageName: { legacy: true }, totalSessions: '36', usedSessions: '12' }],
    sessions: [{ id: 'session-a', date: null, hour: '18', status: null }, null],
    availability: { slots: ['T2-8', null, { day: 'T4', hour: 18 }, 'not-a-slot'] },
    trainingProgram: {
      id: 'student-a',
      title: 'Mông đùi nữ',
      status: 'active',
      trainingDayCount: '3',
      exerciseCount: 18,
      trainingDays: [{
        id: 'day-a',
        title: 'Mông đùi sau',
        focusMuscles: ['Mông', null],
        exercises: [{
          id: 'hip-thrust',
          nameVi: 'Hip Thrust',
          targetMuscles: ['Mông lớn'],
          sets: '4',
          repMinimum: '8',
          repMaximum: 12,
          targetWeightKg: '40',
          targetRpe: 8,
          restSeconds: '90',
        }],
      }],
    },
    workoutLogs: [{ id: 'log-a', programName: { legacy: true }, completedAt: null }, null],
  }, { studentId: 'student-a', weekId: '2026-08-31' })

  assert.equal(detail.student.id, 'student-a')
  assert.equal(detail.contracts[0].packageName, 'Gói tập Aura')
  assert.equal(detail.contracts[0].remainingSessions, 24)
  assert.equal(detail.sessions[0].hour, 18)
  assert.deepEqual(detail.availability.slots, ['T2-8', 'T4-18'])
  assert.equal(detail.availability.weekId, '2026-08-31')
  assert.equal(detail.trainingProgram?.title, 'Mông đùi nữ')
  assert.equal(detail.trainingProgram?.trainingDayCount, 3)
  assert.equal(detail.trainingProgram?.trainingDays[0].title, 'Mông đùi sau')
  assert.deepEqual(detail.trainingProgram?.trainingDays[0].focusMuscles, ['Mông'])
  assert.equal(detail.trainingProgram?.trainingDays[0].exercises[0].sets, 4)
  assert.equal(detail.trainingProgram?.trainingDays[0].exercises[0].targetWeightKg, 40)
  assert.equal(detail.workoutLogs[0].programName, '')
  assert.equal(detail.workoutLogs[1].id, 'workout-2')
})

test('Staff student detail supplies empty collections when an older response omits them', () => {
  const detail = normalizeTrainerStudentDetail(undefined, { studentId: 'student-b', weekId: '2026-09-07' })

  assert.deepEqual(detail.contracts, [])
  assert.deepEqual(detail.sessions, [])
  assert.deepEqual(detail.workoutLogs, [])
  assert.deepEqual(detail.availability.slots, [])
  assert.equal(detail.trainingProgram, null)
  assert.equal(detail.student.id, 'student-b')
  assert.equal(detail.availability.weekId, '2026-09-07')
})
