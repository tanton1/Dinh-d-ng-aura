const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const {
  autoConfirmOverduePtAttendance,
  chargeDuePtSessions,
  chargeSessionTransaction,
  commitAutomationSessionPage,
  createSessionOperationFunctions,
  readAutomationSessionPage,
  recordSessionAttendanceTransaction,
} = require('./session-operations')

const root = join(__dirname, '..')
const source = readFileSync(join(__dirname, 'session-operations.js'), 'utf8')
const functionsIndex = readFileSync(join(__dirname, 'index.js'), 'utf8')
const service = readFileSync(join(root, 'src', 'services', 'sessionOperationsService.ts'), 'utf8')
const scheduler = readFileSync(join(root, 'src', 'components', 'schedule', 'SchedulerWrapper.tsx'), 'utf8')
const contractWorkspace = readFileSync(join(root, 'src', 'features', 'student-360', 'Student360ContractWorkspace.tsx'), 'utf8')
const trainerOperations = readFileSync(join(__dirname, 'pt-operations-v2.js'), 'utf8')
const trainerPortal = readFileSync(join(root, 'src', 'pages', 'operations', 'TrainerPortalV2.tsx'), 'utf8')
const requestCenter = readFileSync(join(root, 'src', 'components', 'admin', 'pt', 'OperationsRequestCenter.tsx'), 'utf8')
const historyWorkspace = readFileSync(join(root, 'src', 'components', 'admin', 'pt', 'TrainingHistoryWorkspace.tsx'), 'utf8')
const historyPanel = readFileSync(join(root, 'src', 'components', 'admin', 'pt', 'TrainingHistoryPanel.tsx'), 'utf8')
const branchScheduleWorkspace = readFileSync(join(root, 'src', 'components', 'schedule', 'BranchScheduleWorkspace.tsx'), 'utf8')
const branchScheduleModel = readFileSync(join(root, 'src', 'features', 'schedule', 'workspaceModel.ts'), 'utf8')

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function fakeDatabase(seed) {
  const documents = new Map(Object.entries(seed).map(([path, data]) => [path, clone(data)]))
  let nextId = 0

  const reference = (path) => ({ kind: 'document', path, id: path.split('/').at(-1) })
  const query = (path, filters = [], maximum = Number.POSITIVE_INFINITY) => ({
    kind: 'query',
    path,
    filters,
    maximum,
    where(field, operator, value) {
      return query(path, [...filters, { field, operator, value }], maximum)
    },
    limit(value) {
      return query(path, filters, value)
    },
    orderBy() {
      return query(path, filters, maximum)
    },
    select() {
      return query(path, filters, maximum)
    },
    async get() {
      return snapshotFor({ kind: 'query', path, filters, maximum })
    },
  })
  const collection = (path) => ({
    ...query(path),
    doc(documentId = `auto-${++nextId}`) {
      return reference(`${path}/${documentId}`)
    },
  })
  const matches = (data, filter, path = '') => {
    const candidate = typeof filter.field === 'string' ? data[filter.field] : path.split('/').at(-1)
    if (filter.operator === '==') return candidate === filter.value
    if (filter.operator === '>=') return candidate >= filter.value
    if (filter.operator === '<') return candidate < filter.value
    throw new Error(`Unsupported fake query operator: ${filter.operator}`)
  }
  const snapshotFor = (target) => {
    if (target.kind === 'document') {
      const data = documents.get(target.path)
      return { exists: data !== undefined, id: target.id, ref: target, data: () => clone(data) }
    }
    const prefix = `${target.path}/`
    const docs = [...documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .filter(([path, data]) => target.filters.every((filter) => matches(data, filter, path)))
      .slice(0, target.maximum)
      .map(([path, data]) => {
        const ref = reference(path)
        return { id: ref.id, ref, data: () => clone(data) }
      })
    return { docs, size: docs.length }
  }
  const db = {
    doc: reference,
    collection,
    async getAll(...references) {
      return references.map((item) => snapshotFor(item))
    },
    async runTransaction(handler) {
      const writes = []
      const transaction = {
        async get(target) {
          assert.equal(writes.length, 0, 'All transaction reads precede writes')
          return snapshotFor(target)
        },
        update(ref, patch) {
          writes.push({ type: 'update', ref, data: patch })
        },
        create(ref, data) {
          writes.push({ type: 'create', ref, data })
        },
      }
      const result = await handler(transaction)
      for (const write of writes) {
        if (write.type === 'create' && documents.has(write.ref.path)) throw new Error(`Document already exists: ${write.ref.path}`)
        const previous = documents.get(write.ref.path) || {}
        documents.set(write.ref.path, { ...previous, ...write.data })
      }
      return result
    },
  }
  return { db, read: (path) => documents.get(path), paths: () => [...documents.keys()] }
}

function operationsFor(seed, authorizeAdmin = async () => ({ uid: 'admin-1' }), options = {}) {
  const state = fakeDatabase(seed)
  const operations = createSessionOperationFunctions({
    db: state.db,
    onCall: (...args) => args.at(-1),
    authorizeAdmin,
    authorizeStudent: options.authorizeStudent || (async () => ({ uid: 'student-account', legacyStaffId: 'student-1', accessRole: 'student' })),
    now: options.now || (() => new Date('2026-08-20T03:00:00.000Z')),
  })
  return { ...state, ...operations }
}

test('frequent PT automation scans only the recent window and daily catch-up owns historical sessions', async () => {
  const state = fakeDatabase({
    'sessions/recent-session': { status: 'scheduled', billingStatus: 'pending', attendanceStatus: 'pending', studentId: 'student-recent', trainerId: 'trainer-1', contractId: 'contract-recent', date: '2026-08-28', hour: 8, revision: 0 },
    'sessions/historical-session': { status: 'scheduled', billingStatus: 'pending', attendanceStatus: 'pending', studentId: 'student-old', trainerId: 'trainer-1', contractId: 'contract-old', date: '2026-07-01', hour: 8, revision: 0 },
    'contracts/contract-recent': { status: 'active', studentId: 'student-recent', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 12, usedSessions: 0 },
    'contracts/contract-old': { status: 'active', studentId: 'student-old', startDate: '2026-06-01', endDate: '2026-09-30', totalSessions: 12, usedSessions: 0 },
  })
  const now = new Date('2026-08-28T10:00:00.000Z')

  const frequent = await chargeDuePtSessions({ db: state.db, now, logger: { info() {}, warn() {} }, limit: 500, includeCatchUp: false, pendingOnly: true })
  assert.equal(frequent.scanned, 1)
  assert.equal(state.read('sessions/recent-session').billingStatus, 'charged')
  assert.equal(state.read('sessions/historical-session').billingStatus, 'pending')

  const catchUp = await chargeDuePtSessions({
    db: state.db,
    now,
    logger: { info() {}, warn() {} },
    limit: 2000,
    includeRecent: false,
    includeCatchUp: true,
  })
  assert.ok(catchUp.scanned >= 1)
  assert.equal(state.read('sessions/historical-session').billingStatus, 'charged')
})

test('production PT automation uses low-frequency bounded workers plus one daily catch-up', async context => {
  const { createScheduledBackgroundFunction } = require('./scheduled-background-functions')
  const business = require('./session-operations')
  const db = {}, logger = {}, calls = []
  for (const handlerName of ['chargeDuePtSessions', 'autoConfirmOverduePtAttendance']) {
    context.mock.method(business, handlerName, async args => { calls.push({ handlerName, args }); return { handlerName } })
    const target = `${handlerName}Scheduled`
    assert.match(functionsIndex, new RegExp(`exports\\.${target} = createScheduledBackgroundFunction\\('${target}'`))
    const registered = createScheduledBackgroundFunction(target, { db, logger, onSchedule: (options, handler) => ({ options, handler }) })
    assert.deepEqual(registered.options, {
      schedule: 'every 30 minutes', region: 'asia-southeast1', timeZone: 'Asia/Ho_Chi_Minh',
      retryCount: 1, cpu: 'gcf_gen1', concurrency: 1, maxInstances: 1, timeoutSeconds: 540,
    })
    const startedAt = Date.now()
    assert.deepEqual(await registered.handler(), { handlerName })
    const call = calls.at(-1)
    assert.equal(call.handlerName, handlerName)
    assert.equal(call.args.db, db)
    assert.equal(call.args.logger, logger)
    assert.ok(call.args.now instanceof Date && call.args.now.getTime() >= startedAt && call.args.now.getTime() <= Date.now())
    const { now, ...args } = call.args
    assert.deepEqual(args, { db, logger, limit: 500, includeRecent: true, includeCatchUp: false, pendingOnly: true })
  }
  assert.equal(calls.length, 2)
  assert.match(functionsIndex, /reconcilePtSessionAutomationScheduled = onSchedule\(\{[\s\S]*?schedule: '17 2 \* \* \*'[\s\S]*?includeRecent: false, includeCatchUp: true/)
  assert.match(source, /filters: pendingOnly \? \[\{ field: 'billingStatus', value: 'pending' \}\] : \[\]/)
  assert.match(source, /filters: pendingOnly \? \[\{ field: 'attendanceStatus', value: 'pending' \}\] : \[\]/)
})

test('session request approval updates policy usage, session, contract charge and audit in one transaction', () => {
  const approval = source.match(/const approveSessionRequest[\s\S]*?\n  const createMyContractPauseRequest/)?.[0] ?? ''
  assert.match(approval, /runTransaction/)
  assert.match(approval, /sessionRequests\/\$\{requestId\}/)
  assert.match(approval, /status: 'approved'/)
  assert.match(approval, /processedSessionRevision/)
  assert.match(approval, /collection\('sessionEvents'\)/)
  assert.match(source, /ptPolicyUsage/)
  assert.match(approval, /charged_cancellation/)
  assert.match(approval, /charged_reschedule/)
  assert.match(approval, /financePeriods\/\$\{policyPeriodId\}/)
  assert.match(approval, /chargedSessionIds: FieldValue\.arrayUnion\(sessionId\)/)
  assert.match(approval, /requestType === 'cancel'/)
  assert.match(approval, /currentDate !== originalDate \|\| currentHour !== originalHour/)
  assert.match(approval, /originalSessionRevision/)
  assert.match(approval, /assertSessionChangeDeadline/)
  assert.match(approval, /requestedBy === 'trainer'/)
  assert.match(approval, /status: cancellationType/)
})

test('admin corrects a paired teaching shift atomically and invalidates the related draft payroll', async () => {
  const state = operationsFor({
    'trainers/trainer-old': { status: 'active', branchId: 'branch-1', slotCapacity: 2 },
    'trainers/trainer-new': { status: 'active', branchId: 'branch-1', slotCapacity: 2 },
    'sessions/session-a': { status: 'completed', attendanceStatus: 'present', studentId: 'student-1', trainerId: 'trainer-old', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-18', hour: 7, revision: 2 },
    'sessions/session-b': { status: 'completed', attendanceStatus: 'present', studentId: 'student-2', trainerId: 'trainer-old', contractId: 'contract-2', branchId: 'branch-1', date: '2026-08-18', hour: 7, revision: 4 },
    'attendanceEvents/session-a': { sessionId: 'session-a', attendanceStatus: 'present', type: 'attended', trainerId: 'trainer-old' },
    'attendanceEvents/session-b': { sessionId: 'session-b', attendanceStatus: 'present', type: 'attended', trainerId: 'trainer-old' },
    'sessionBillingEvents/session-a': { sessionId: 'session-a', trainerId: 'trainer-old' },
    'sessionBillingEvents/session-b': { sessionId: 'session-b', trainerId: 'trainer-old' },
    'payrollRuns/2026-08': { status: 'draft', requiresRebuild: false },
    'financePeriods/2026-08': { status: 'open' },
  }, async () => ({ uid: 'admin-1', accessRole: 'admin' }))

  const result = await state.correctTeachingShift({ data: {
    items: [
      { sessionId: 'session-a', expectedRevision: 2, attendanceEventId: 'session-a', attendanceStatus: 'late', lateMinutes: 10 },
      { sessionId: 'session-b', expectedRevision: 4, attendanceEventId: 'session-b', attendanceStatus: 'no_show', noShowReason: 'busy' },
    ],
    date: '2026-08-18', hour: 8, trainerId: 'trainer-new', reason: 'Đối soát PT thực dạy theo camera',
  } })

  assert.equal(result.unchanged, false)
  assert.deepEqual(result.invalidatedPayrollPeriods, ['2026-08'])
  assert.equal(state.read('sessions/session-a').trainerId, 'trainer-new')
  assert.equal(state.read('sessions/session-a').hour, 8)
  assert.equal(state.read('sessions/session-a').revision, 3)
  assert.equal(state.read('attendanceEvents/session-a').attendanceStatus, 'late')
  assert.equal(state.read('attendanceEvents/session-b').attendanceStatus, 'no_show')
  assert.equal(state.read('payrollRuns/2026-08').requiresRebuild, true)
  assert.equal(state.paths().filter((path) => path.startsWith('sessionEvents/')).length, 2)
  assert.equal(state.paths().filter((path) => path.startsWith('attendanceAuditLogs/')).length, 2)
})

function revenueCorrectionState(overrides = {}) {
  return operationsFor({
    'trainers/trainer-1': { status: 'active', branchId: 'branch-1', slotCapacity: 2 },
    'trainers/trainer-2': { status: 'active', branchId: 'branch-1', slotCapacity: 2 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', totalPrice: 200_000, totalSessions: 2, usedSessions: 2,
      paidAmount: 100_000, startDate: '2026-08-01', endDate: '2026-09-30', accountingAdvanceAccountCode: '3387' },
    'sessions/revenue-session': { status: 'scheduled', billingStatus: 'charged', attendanceStatus: 'pending', attendanceEventId: 'revenue-session',
      studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-18', hour: 8, revision: 0, serviceOrdinal: 2 },
    'attendanceEvents/revenue-session': { sessionId: 'revenue-session', studentId: 'student-1', contractId: 'contract-1', trainerId: 'trainer-1',
      attendanceStatus: 'pending', billingStatus: 'charged', serviceOrdinal: 2, type: 'pending_confirmation' },
    'sessionBillingEvents/revenue-session': { sessionId: 'revenue-session', contractId: 'contract-1', serviceOrdinal: 2, billingStatus: 'charged' },
    'financePeriods/2026-08': { status: 'open' },
    ...overrides,
  }, async () => ({ uid: 'admin-1', accessRole: 'admin' }))
}

const revenueCorrection = (expectedRevision = 0, overrides = {}) => ({ data: {
  items: [{ sessionId: 'revenue-session', expectedRevision, attendanceEventId: 'revenue-session', attendanceStatus: 'present' }],
  date: '2026-08-18', hour: 8, trainerId: 'trainer-1', reason: 'Đối soát bằng chứng ca thực dạy', ...overrides,
} })

test('admin confirmation creates missing revenue and journal once using posted revenue for cash allocation', async () => {
  const state = revenueCorrectionState()
  await state.correctTeachingShift(revenueCorrection())
  const revenue = state.read('ledgerEntries/pt_session_revenue-session')
  assert.equal(revenue.revenueImpact, 100_000)
  assert.equal(revenue.serviceOrdinal, 2)
  assert.equal(revenue.deferredRevenueImpact, -100_000)
  assert.equal(revenue.receivableImpact, 0)
  assert.equal(state.read('journalEntries/pt_session_revenue-session').totalDebit, 100_000)
  assert.equal(state.read('contracts/contract-1').usedSessions, 2)
  assert.equal(state.read('sessions/revenue-session').confirmationSource, 'admin_correction')
  const retry = await state.correctTeachingShift(revenueCorrection(1))
  assert.equal(retry.unchanged, true)
  assert.equal(state.paths().filter((path) => path.startsWith('ledgerEntries/')).length, 1)
})

test('manual correction resolves automatic-attendance revenue review on both evidence records', async () => {
  const state = revenueCorrectionState({
    'sessions/revenue-session': { status: 'completed', billingStatus: 'charged', attendanceStatus: 'present', attendanceEventId: 'revenue-session',
      confirmationSource: 'auto_after_48h', recognitionReviewRequired: true, studentId: 'student-1', trainerId: 'trainer-1',
      contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-18', hour: 8, revision: 0, serviceOrdinal: 2 },
    'attendanceEvents/revenue-session': { sessionId: 'revenue-session', attendanceStatus: 'present', billingStatus: 'charged', serviceOrdinal: 2,
      confirmationSource: 'auto_after_48h', recognitionReviewRequired: true },
    'revenueRecognitionReviews/revenue-session': { status: 'open', issueCode: 'AUTO_CONFIRMATION_REQUIRES_REVIEW' },
  })
  await state.correctTeachingShift(revenueCorrection())
  assert.equal(state.read('ledgerEntries/pt_session_revenue-session').revenueImpact, 100_000)
  for (const prefix of ['sessions', 'attendanceEvents']) {
    assert.equal(state.read(`${prefix}/revenue-session`).recognitionReviewRequired, false)
    assert.equal(state.read(`${prefix}/revenue-session`).confirmationSource, 'admin_correction')
  }
  assert.equal(state.read('revenueRecognitionReviews/revenue-session').status, 'resolved')
})

test('one correction transaction never releases the same contract advance twice', async () => {
  const state = revenueCorrectionState({
    'sessions/revenue-second': { status: 'scheduled', billingStatus: 'charged', attendanceStatus: 'pending', attendanceEventId: 'revenue-second',
      studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-18', hour: 8, revision: 0, serviceOrdinal: 1 },
    'attendanceEvents/revenue-second': { sessionId: 'revenue-second', studentId: 'student-1', contractId: 'contract-1', trainerId: 'trainer-1',
      attendanceStatus: 'pending', billingStatus: 'charged', serviceOrdinal: 1, type: 'pending_confirmation' },
  })
  await state.correctTeachingShift(revenueCorrection(0, { items: [
    { sessionId: 'revenue-session', expectedRevision: 0, attendanceStatus: 'present' },
    { sessionId: 'revenue-second', expectedRevision: 0, attendanceStatus: 'present' },
  ] }))
  const revenues = state.paths().filter((path) => path.startsWith('ledgerEntries/')).map(state.read)
  assert.equal(revenues.reduce((sum, value) => sum + value.revenueImpact, 0), 200_000)
  assert.equal(revenues.reduce((sum, value) => sum + value.deferredRevenueImpact, 0), -100_000)
  assert.equal(revenues.reduce((sum, value) => sum + value.receivableImpact, 0), 100_000)
})

test('same-month date and trainer corrections append balanced reversal/replacement and later attendance follows the replacement', async () => {
  const state = revenueCorrectionState()
  await state.correctTeachingShift(revenueCorrection())
  const original = state.read('ledgerEntries/pt_session_revenue-session')
  await state.correctTeachingShift(revenueCorrection(1, { date: '2026-08-19', trainerId: 'trainer-2' }))
  const currentId = state.read('sessions/revenue-session').revenueRecognitionEntryId
  assert.equal(currentId, 'pt_session_revenue-session_correction_2')
  const current = state.read(`ledgerEntries/${currentId}`)
  const reversal = state.read(`ledgerEntries/${currentId}_reversal`)
  assert.equal(state.read('ledgerEntries/pt_session_revenue-session').status, 'reversed')
  assert.equal(state.read('ledgerEntries/pt_session_revenue-session').trainerId, 'trainer-1')
  assert.equal(current.trainerId, 'trainer-2')
  assert.equal(current.effectiveAt.toDate().toISOString(), '2026-08-19T05:00:00.000Z')
  assert.equal(original.revenueImpact + reversal.revenueImpact + current.revenueImpact, 100_000)
  assert.equal(original.deferredRevenueImpact + reversal.deferredRevenueImpact + current.deferredRevenueImpact, -100_000)
  for (const suffix of ['', '_reversal']) {
    const journal = state.read(`journalEntries/${currentId}${suffix}`)
    assert.equal(journal.lines.reduce((sum, line) => sum + line.debit, 0), journal.lines.reduce((sum, line) => sum + line.credit, 0))
  }
  const attendance = await state.recordSessionAttendance({ data: { sessionId: 'revenue-session', expectedRevision: 2, attendanceStatus: 'late', lateMinutes: 5 } })
  assert.equal(attendance.recognitionEntryId, currentId)
  assert.equal(state.read('attendanceEvents/revenue-session').revenueRecognitionEntryId, currentId)
  assert.equal(state.paths().filter((path) => path.startsWith('ledgerEntries/')).length, 3)
  await state.correctTeachingShift(revenueCorrection(3, { date: '2026-08-19', trainerId: 'trainer-1' }))
  const values = state.paths().filter((path) => path.startsWith('ledgerEntries/')).map(state.read)
  assert.equal(values.length, 5)
  assert.equal(values.reduce((sum, value) => sum + value.revenueImpact, 0), 100_000)
})

test('correction does not recognise exempt make-up service or merely move automatically confirmed evidence', async () => {
  for (const billingStatus of ['exempt', 'charged']) {
    const state = revenueCorrectionState({
      'sessions/revenue-session': { status: 'completed', billingStatus, attendanceStatus: 'present', attendanceEventId: 'revenue-session',
        makeupSession: billingStatus === 'exempt', confirmationSource: 'auto_after_48h', recognitionReviewRequired: billingStatus === 'charged',
        studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-18', hour: 8, revision: 0 },
      'attendanceEvents/revenue-session': { sessionId: 'revenue-session', attendanceStatus: 'present', billingStatus,
        confirmationSource: 'auto_after_48h', confirmedBy: 'system', recognitionReviewRequired: billingStatus === 'charged' },
    })
    await state.correctTeachingShift(revenueCorrection(0, { items: [{ sessionId: 'revenue-session', expectedRevision: 0 }], trainerId: 'trainer-2' }))
    assert.equal(state.paths().filter((path) => path.startsWith('ledgerEntries/')).length, 0)
    assert.equal(state.read('sessions/revenue-session').recognitionReviewRequired, billingStatus === 'charged')
  }
})

test('revenue correction fails atomically in locked periods and flags missing contract evidence without inventing revenue', async () => {
  const locked = revenueCorrectionState({ 'financePeriods/2026-08': { status: 'locked' } })
  await assert.rejects(locked.correctTeachingShift(revenueCorrection()), (error) => error.details?.issueCode === 'FINANCE_PERIOD_LOCKED')
  assert.equal(locked.read('sessions/revenue-session').attendanceStatus, 'pending')
  assert.equal(locked.paths().filter((path) => path.startsWith('ledgerEntries/')).length, 0)
  const missing = revenueCorrectionState({ 'contracts/contract-1': undefined })
  await missing.correctTeachingShift(revenueCorrection())
  assert.equal(missing.read('sessions/revenue-session').attendanceStatus, 'present')
  assert.equal(missing.read('sessions/revenue-session').recognitionReviewRequired, true)
  assert.equal(missing.read('revenueRecognitionReviews/revenue-session').issueCode, 'RECOGNITION_CONTRACT_MISSING_OR_MISMATCHED')
  assert.equal(missing.paths().filter((path) => path.startsWith('ledgerEntries/')).length, 0)
})

test('a correction cannot move financial evidence from another period even when the session month is open', async () => {
  const state = revenueCorrectionState({
    'ledgerEntries/pt_session_revenue-session': { type: 'revenue_recognition', status: 'posted', sessionId: 'revenue-session', contractId: 'contract-1',
      trainerId: 'trainer-1', branchId: 'branch-1', effectiveAt: '2026-07-18T05:00:00.000Z', amount: 100_000, revenueImpact: 100_000,
      cashImpact: 0, receivableImpact: 0, deferredRevenueImpact: -100_000 },
  })
  await assert.rejects(state.correctTeachingShift(revenueCorrection()), (error) => error.details?.issueCode === 'TEACHING_SHIFT_CROSS_PERIOD_CORRECTION')
  assert.equal(state.read('sessions/revenue-session').attendanceStatus, 'pending')
  assert.equal(state.paths().filter((path) => path.startsWith('ledgerEntries/')).length, 1)
  assert.equal(state.paths().filter((path) => path.startsWith('journalEntries/')).length, 0)
})

for (const status of ['active', 'frozen']) test('an audited OFF booking is charged once without removing the pause, status=' + status, async () => {
  const pausePeriods = [{ type: 'off', startDate: '2026-08-20', endDate: '2026-08-21' }]
  const state = fakeDatabase({
    'sessions/off-session': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1',
      contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-20', hour: 8, revision: 0,
      adminOverride: true, adminOverrideBy: 'admin-1', adminOverrideWarnings: ['CONTRACT_PAUSED'],
      studentOffConfirmedDate: '2026-08-20' },
    'contracts/contract-1': { status, studentId: 'student-1', startDate: '2026-08-01', endDate: '2026-09-30',
      totalSessions: 12, usedSessions: 4, pausePeriods },
    'financePeriods/2026-08': { status: 'open' },
  })
  const input = { db: state.db, sessionId: 'off-session', expectedRevision: 0, actorUid: 'trainer-1', now: new Date('2026-08-20T02:00:00Z') }
  await chargeSessionTransaction(input)
  assert.equal(state.read('contracts/contract-1').usedSessions, 5)
  assert.deepEqual(state.read('contracts/contract-1').pausePeriods, pausePeriods)
  assert.equal(state.read('contracts/contract-1').status, status)
  assert.equal((await chargeSessionTransaction(input)).unchanged, true)
  assert.equal(state.read('contracts/contract-1').usedSessions, 5)
})

for (const proof of ['missing', 'wrong-date', 'missing-actor', 'expired', 'cancelled']) test('OFF charge rejects invalid proof or entitlement atomically: ' + proof, async () => {
  const state = fakeDatabase({
    'sessions/off-session': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1',
      contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-20', hour: 8, revision: 0,
      adminOverride: true, adminOverrideBy: proof === 'missing-actor' ? '' : 'admin-1', adminOverrideWarnings: ['CONTRACT_PAUSED'],
      ...(proof !== 'missing' ? { studentOffConfirmedDate: proof === 'wrong-date' ? '2026-08-19' : '2026-08-20' } : {}) },
    'contracts/contract-1': { status: proof === 'cancelled' ? 'cancelled' : 'active', studentId: 'student-1',
      startDate: '2026-08-01', endDate: proof === 'expired' ? '2026-08-19' : '2026-09-30', totalSessions: 12, usedSessions: 4,
      pausePeriods: [{ type: 'off', startDate: '2026-08-20', endDate: '2026-08-21' }] },
    'financePeriods/2026-08': { status: 'open' },
  })
  await assert.rejects(chargeSessionTransaction({ db: state.db, sessionId: 'off-session', expectedRevision: 0,
    actorUid: 'trainer-1', now: new Date('2026-08-20T02:00:00Z') }))
  assert.equal(state.read('contracts/contract-1').usedSessions, 4)
  assert.equal(state.read('sessions/off-session').revision, 0)
  assert.equal(state.read('sessionBillingEvents/off-session'), undefined)
})

test('PT make-up attendance is recorded without a second contract charge', async () => {
  const state = fakeDatabase({
    'sessions/makeup-request-1': {
      status: 'scheduled', scheduleStatus: 'scheduled', billingStatus: 'exempt', attendanceStatus: 'pending',
      makeupSession: true, sessionKind: 'makeup', makeupSourceSessionId: 'source-session-1',
      studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1',
      date: '2026-08-20', hour: 8, revision: 0,
    },
    'contracts/contract-1': {
      status: 'active', studentId: 'student-1', startDate: '2026-08-01', endDate: '2026-09-30',
      totalSessions: 12, usedSessions: 4, chargedSessionIds: ['s1', 's2', 's3', 's4'],
    },
    'financePeriods/2026-08': { status: 'open' },
  })
  const now = new Date('2026-08-20T02:00:00.000Z')

  const charge = await chargeSessionTransaction({ db: state.db, sessionId: 'makeup-request-1', expectedRevision: 0, actorUid: 'trainer-1', now })
  assert.equal(charge.billingStatus, 'exempt')
  assert.equal(charge.revision, 1)
  assert.equal(state.read('contracts/contract-1').usedSessions, 4)
  assert.equal(state.read('sessionBillingEvents/makeup-request-1'), undefined)
  assert.equal(state.read('attendanceEvents/makeup-request-1').billingStatus, 'exempt')

  const confirmation = await recordSessionAttendanceTransaction({
    db: state.db,
    sessionId: 'makeup-request-1',
    expectedRevision: 1,
    actorUid: 'trainer-1',
    attendanceStatus: 'present',
    now,
  })
  assert.equal(confirmation.attendanceStatus, 'present')
  assert.equal(state.read('sessions/makeup-request-1').billingStatus, 'exempt')
  assert.equal(state.read('sessions/makeup-request-1').attendanceStatus, 'present')
  assert.equal(state.read('contracts/contract-1').usedSessions, 4)
  assert.equal(state.paths().some((path) => path === 'ledgerEntries/pt_session_makeup-request-1'), false)
})

test('admin can resolve a duplicate learner day by correcting attendance without re-triggering the duplicate collision', async () => {
  const state = operationsFor({
    'trainers/trainer-1': { status: 'active', branchId: 'branch-1', slotCapacity: 2 },
    // These legacy rows intentionally represent the duplicate that payroll
    // surfaced. The correction marks one row as no-show; it is retained for
    // audit but is no longer treated as a completed learner session.
    'sessions/duplicate-a': { status: 'completed', attendanceStatus: 'present', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-18', hour: 8, revision: 1 },
    'sessions/duplicate-b': { status: 'completed', attendanceStatus: 'present', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-18', hour: 10, revision: 2 },
    'attendanceEvents/duplicate-a': { sessionId: 'duplicate-a', attendanceStatus: 'present', type: 'attended', trainerId: 'trainer-1' },
    'attendanceEvents/duplicate-b': { sessionId: 'duplicate-b', attendanceStatus: 'present', type: 'attended', trainerId: 'trainer-1' },
    'financePeriods/2026-08': { status: 'open' },
  }, async () => ({ uid: 'admin-1', accessRole: 'admin' }))

  const result = await state.correctTeachingShift({ data: {
    items: [{ sessionId: 'duplicate-a', expectedRevision: 1, attendanceEventId: 'duplicate-a', attendanceStatus: 'no_show', noShowReason: 'other' }],
    date: '2026-08-18', hour: 8, trainerId: 'trainer-1', reason: 'Xử lý lỗi trùng buổi theo đối soát lịch sử',
  } })

  assert.equal(result.unchanged, false)
  assert.equal(state.read('sessions/duplicate-a').status, 'no_show')
  assert.equal(state.read('sessions/duplicate-a').attendanceStatus, 'no_show')
  assert.equal(state.read('sessions/duplicate-a').revision, 2)
  assert.equal(state.read('attendanceEvents/duplicate-a').attendanceStatus, 'no_show')
  assert.equal(state.read('attendanceEvents/duplicate-a').noShowReason, 'other')
  assert.equal(state.read('sessions/duplicate-b').status, 'completed')
  assert.equal(state.paths().filter((path) => path.startsWith('attendanceAuditLogs/')).length, 1)
})

test('admin correction backfills missing legacy attendance evidence while resolving a duplicate', async () => {
  const state = operationsFor({
    'trainers/trainer-1': { status: 'active', branchId: 'branch-1', slotCapacity: 2 },
    // This is a legacy completed row with no attendanceEvents document and an
    // all-branch marker. It must remain auditable but become editable.
    'sessions/legacy-duplicate': {
      status: 'completed', studentId: 'student-1', trainerId: 'trainer-1',
      contractId: 'contract-1', branchId: 'all', date: '2026-08-18', hour: 8,
    },
    'financePeriods/2026-08': { status: 'open' },
  }, async () => ({ uid: 'admin-1', accessRole: 'admin' }))

  const result = await state.correctTeachingShift({ data: {
    items: [{ sessionId: 'legacy-duplicate', expectedRevision: 0, attendanceStatus: 'no_show', noShowReason: 'other' }],
    date: '2026-08-18', hour: 8, trainerId: 'trainer-1', reason: 'Đối soát buổi trùng dữ liệu cũ',
  } })

  assert.equal(result.unchanged, false)
  assert.equal(state.read('sessions/legacy-duplicate').status, 'no_show')
  assert.equal(state.read('sessions/legacy-duplicate').attendanceEventId, 'legacy-duplicate')
  assert.equal(state.read('sessions/legacy-duplicate').billingStatus, 'charged')
  assert.equal(state.read('attendanceEvents/legacy-duplicate').sessionId, 'legacy-duplicate')
  assert.equal(state.read('attendanceEvents/legacy-duplicate').attendanceStatus, 'no_show')
  assert.equal(state.read('attendanceEvents/legacy-duplicate').noShowReason, 'other')
})

test('teaching shift correction is admin-only and fails closed after payroll is reviewed', async () => {
  const unauthorized = operationsFor({}, async () => ({ uid: 'staff-1', accessRole: 'staff' }))
  await assert.rejects(
    unauthorized.correctTeachingShift({ data: { items: [{ sessionId: 'session-a', expectedRevision: 0 }], date: '2026-08-18', hour: 8, trainerId: 'trainer-1', reason: 'Sửa ca' } }),
    /Chỉ Admin hoặc Super Admin/,
  )

  const locked = operationsFor({
    'trainers/trainer-1': { status: 'active', branchId: 'branch-1', slotCapacity: 2 },
    'sessions/session-a': { status: 'completed', attendanceStatus: 'present', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-18', hour: 7, revision: 0 },
    'attendanceEvents/session-a': { sessionId: 'session-a', attendanceStatus: 'present', type: 'attended', trainerId: 'trainer-1' },
    'payrollRuns/2026-08': { status: 'reviewed' },
    'financePeriods/2026-08': { status: 'open' },
  }, async () => ({ uid: 'admin-1', accessRole: 'admin' }))
  await assert.rejects(
    locked.correctTeachingShift({ data: { items: [{ sessionId: 'session-a', expectedRevision: 0, attendanceEventId: 'session-a', attendanceStatus: 'late', lateMinutes: 5 }], date: '2026-08-18', hour: 7, trainerId: 'trainer-1', reason: 'Đối soát lại' } }),
    /tạo khoản bù trừ ở kỳ tiếp theo/,
  )
  assert.equal(locked.read('sessions/session-a').revision, 0)
})

test('legacy all-branch session can be normalized while correcting its audited shift', async () => {
  const state = operationsFor({
    'trainers/trainer-a': { status: 'active', branchId: 'branch-a', slotCapacity: 2 },
    'sessions/session-a': { status: 'completed', studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: 'all', date: '2026-08-08', hour: 9, revision: 0 },
    'financePeriods/2026-08': { status: 'open' },
  }, async () => ({ uid: 'admin-1', accessRole: 'admin' }))

  const result = await state.correctTeachingShift({ data: {
    items: [{ sessionId: 'session-a', expectedRevision: 0 }],
    date: '2026-08-08', hour: 9, trainerId: 'trainer-a', reason: 'Chuẩn hóa ca legacy theo chi nhánh PT',
  } })

  assert.equal(result.unchanged, false)
  assert.equal(state.read('sessions/session-a').branchId, 'branch-a')
  assert.equal(state.read('sessions/session-a').revision, 1)
})

test('admin correction accepts learner sessions carrying different branch context', async () => {
  const state = operationsFor({
    'trainers/trainer-a': { status: 'active', branchId: 'branch-a', slotCapacity: 2 },
    'sessions/session-a': { status: 'completed', studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: 'branch-a', date: '2026-08-21', hour: 11, revision: 0 },
    'sessions/session-b': { status: 'completed', studentId: 'student-b', trainerId: 'trainer-a', contractId: 'contract-b', branchId: 'branch-b', date: '2026-08-21', hour: 11, revision: 0 },
    'financePeriods/2026-08': { status: 'open' },
  }, async () => ({ uid: 'admin-1', accessRole: 'admin' }))

  const result = await state.correctTeachingShift({ data: {
    items: [
      { sessionId: 'session-a', expectedRevision: 0 },
      { sessionId: 'session-b', expectedRevision: 0 },
    ],
    date: '2026-08-21', hour: 11, trainerId: 'trainer-a', reason: 'Xác nhận ca học viên tập khác cơ sở',
  } })

  assert.equal(result.unchanged, false)
  assert.deepEqual(result.invalidatedPayrollPeriods, [])
  assert.equal(state.read('sessions/session-b').branchId, 'branch-a')
})

test('admin history exposes one audited correction sheet for the complete paired shift', () => {
  assert.match(historyPanel, /canCorrectTeachingShift/)
  assert.match(historyPanel, /Điều chỉnh ca dạy/)
  assert.match(historyPanel, /correction\.records\.map/)
  assert.match(historyPanel, /correctTeachingShift/)
  assert.match(historyPanel, /expectedRevision: record\.revision/)
  assert.match(historyPanel, /Lý do bắt buộc/)
  assert.match(historyWorkspace, /focusSessionId/)
  assert.match(historyWorkspace, /params\.get\('date'\)/)
  assert.match(historyWorkspace, /params\.get\('studentId'\)/)
  assert.match(service, /export function correctTeachingShift/)
  assert.match(source, /type: 'teaching_shift_corrected'/)
  assert.match(source, /sourceDataStale: true/)
  assert.match(historyPanel, /record\.branchId/)
  assert.match(source, /normaliseSessionBranchId/)
})

test('learner receives pairing-first change suggestions and a two-request Aura policy snapshot', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { complimentaryChangeCancelPerMonth: 2, sessionChangeDeadlineHours: 12 },
    'sessions/source-session': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-22', hour: 7, revision: 3 },
    'sessions/open-pair': { status: 'scheduled', studentId: 'student-2', trainerId: 'trainer-1', contractId: 'contract-2', branchId: 'branch-1', date: '2026-08-21', hour: 10, revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', trainerIds: ['trainer-1'], branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 24, usedSessions: 2 },
    'students/student-1': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T6-10'] },
    'trainers/trainer-1': { status: 'active', name: 'PT Chính', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-10'], slotCapacity: 2, dailySessionTarget: 8, schedulingPriority: 1 },
    'ptPolicyUsage/student-1_2026-08': { approvedChangeCancelCount: 1 },
  })
  const page = await state.getMySessionChangeSuggestions({ data: { sessionId: 'source-session', expectedRevision: 3 } })
  assert.equal(page.policy.complimentaryChangeCancelPerMonth, 2)
  assert.equal(page.policy.complimentaryRemaining, 1)
  assert.equal(page.suggestions[0].pairsExistingSession, true)
  assert.equal(page.suggestions[0].occupancy, 1)

  const result = await state.createMySessionRequest({ data: {
    sessionId: 'source-session', expectedRevision: 3, type: 'reschedule', reason: 'Đổi lịch cá nhân', idempotencyKey: 'suggestion-request', candidateId: page.suggestions[0].candidateId,
  } })
  assert.equal(result.expectedSequence, 2)
  assert.equal(result.expectedCountsTowardContract, false)
  assert.equal(result.complimentaryLimit, 2)
  const saved = state.read('sessionRequests/student-student-account-suggestion-request')
  assert.equal(saved.newTrainerId, 'trainer-1')
  assert.equal(saved.pairsExistingSession, true)
  assert.equal(saved.policyVersion, 'pt-change-cancel-v2')
})

test('learner can select and approve a clearly labelled cross-branch paired slot', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { complimentaryChangeCancelPerMonth: 2, sessionChangeDeadlineHours: 12 },
    'branches/branch-1': { name: 'Aura Cơ sở 1', status: 'active' },
    'branches/branch-2': { name: 'Aura Cơ sở 2', status: 'active' },
    'sessions/source-cross-branch': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-22', hour: 7, revision: 2 },
    'sessions/open-cross-branch-pair': { status: 'scheduled', studentId: 'student-2', trainerId: 'trainer-2', contractId: 'contract-2', branchId: 'branch-2', date: '2026-08-21', hour: 10, revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 24, usedSessions: 2 },
    'students/student-1': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T6-10'] },
    'trainers/trainer-1': { status: 'active', name: 'PT Cơ sở 1', branchId: 'branch-1', employmentType: 'full_time', availableSlots: [], slotCapacity: 2 },
    'trainers/trainer-2': { status: 'active', name: 'PT Cơ sở 2', branchId: 'branch-2', employmentType: 'full_time', availableSlots: ['T6-10'], slotCapacity: 2 },
  })

  const page = await state.getMySessionChangeSuggestions({ data: { sessionId: 'source-cross-branch', expectedRevision: 2 } })
  const candidate = page.suggestions.find((item) => item.branchId === 'branch-2' && item.date === '2026-08-21' && item.hour === 10)
  assert.ok(candidate)
  assert.equal(page.homeBranchName, 'Aura Cơ sở 1')
  assert.equal(candidate.branchName, 'Aura Cơ sở 2')
  assert.equal(candidate.homeBranchName, 'Aura Cơ sở 1')
  assert.equal(candidate.isCrossBranch, true)
  assert.equal(candidate.pairsExistingSession, true)

  const created = await state.createMySessionRequest({ data: {
    sessionId: 'source-cross-branch', expectedRevision: 2, type: 'reschedule', reason: 'Đổi sang cơ sở thuận tiện', idempotencyKey: 'cross-branch-request', candidateId: candidate.candidateId,
  } })
  const request = state.read(`sessionRequests/${created.requestId}`)
  assert.equal(request.newBranchId, 'branch-2')
  assert.equal(request.crossBranchWarning, true)

  await state.approveSessionRequest({ data: { requestId: created.requestId, expectedSessionRevision: 2 } })
  const moved = state.read('sessions/source-cross-branch')
  assert.equal(moved.branchId, 'branch-2')
  assert.equal(moved.studentBranchWarning, true)
  assert.equal(moved.studentHomeBranchId, 'branch-1')
})

test('change suggestions honor the PT weekly override instead of the recurring profile', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { sessionChangeDeadlineHours: 12 },
    'sessions/source-weekly': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-22', hour: 7, revision: 1 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 1 },
    'students/student-1': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T6-10', 'T6-11'] },
    'trainers/trainer-1': { status: 'active', name: 'PT Tuần', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-10'], slotCapacity: 2 },
    'trainerAvailability/trainer-1_2026-08-17': { trainerId: 'trainer-1', weekId: '2026-08-17', status: 'submitted', slots: ['T6-11'], revision: 2 },
  })

  const page = await state.getMySessionChangeSuggestions({ data: { sessionId: 'source-weekly', expectedRevision: 1 } })
  assert.ok(page.suggestions.some((item) => item.date === '2026-08-21' && item.hour === 11))
  assert.equal(page.suggestions.some((item) => item.date === '2026-08-21' && item.hour === 10), false)
})

test('learner change suggestions use the weekly schedule pool for occupancy and OFF locks', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { sessionChangeDeadlineHours: 12 },
    'sessions/source-pool': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-22', hour: 7, revision: 1 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 1 },
    'students/student-1': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T6-10', 'T6-11'] },
    'trainers/trainer-1': { status: 'active', name: 'PT Kho ca', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-10', 'T6-11'], slotCapacity: 2 },
    'ptScheduleDrafts/branch-1_2026-08-17': {
      branchId: 'branch-1', weekId: '2026-08-17', status: 'published', revision: 3, publishedRevision: 3,
      schedule: {
        'T6-10': [{ studentId: 'student-2', trainerId: 'trainer-1', branchId: 'branch-1', type: 'training' }],
        'T6-11': [{ studentId: 'OFF', trainerId: 'trainer-1', branchId: 'branch-1', type: 'off' }],
      },
    },
  })

  const page = await state.getMySessionChangeSuggestions({ data: { sessionId: 'source-pool', expectedRevision: 1 } })
  const paired = page.suggestions.find((item) => item.date === '2026-08-21' && item.hour === 10)
  assert.ok(paired)
  assert.equal(paired.occupancy, 1)
  assert.equal(paired.pairsExistingSession, true)
  assert.equal(page.suggestions.some((item) => item.date === '2026-08-21' && item.hour === 11), false)
})

test('learner change suggestions expose the complete weekly pool and allow an audited outside-availability choice', async () => {
  const trainers = Object.fromEntries(Array.from({ length: 20 }, (_, index) => {
    const trainerId = `pool-trainer-${index}`
    return [`trainers/${trainerId}`, {
      status: 'active', name: `PT kho ${index}`, branchId: 'branch-1', employmentType: 'full_time',
      availableSlots: ['T6-10', 'T6-11'], slotCapacity: 2,
    }]
  }))
  const state = operationsFor({
    'settings/scheduleConfig': { sessionChangeDeadlineHours: 12 },
    'sessions/source-pool-complete': { status: 'scheduled', studentId: 'student-1', trainerId: 'pool-trainer-0', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-22', hour: 7, revision: 1 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'pool-trainer-0', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 1 },
    'students/student-1': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T6-10'] },
    'ptScheduleDrafts/branch-1_2026-08-17': {
      branchId: 'branch-1', weekId: '2026-08-17', status: 'published', revision: 3, publishedRevision: 3,
      schedule: { 'T6-10': [{ studentId: 'student-2', trainerId: 'pool-trainer-0', branchId: 'branch-1', type: 'training' }] },
    },
    ...trainers,
  })

  const page = await state.getMySessionChangeSuggestions({ data: { sessionId: 'source-pool-complete', expectedRevision: 1 } })
  assert.equal(page.suggestions.length, 40)
  const registeredCandidate = page.suggestions.find((item) => item.date === '2026-08-21' && item.hour === 10 && item.trainerId === 'pool-trainer-0')
  const outsideCandidate = page.suggestions.find((item) => item.date === '2026-08-21' && item.hour === 11 && item.trainerId === 'pool-trainer-0')
  assert.equal(registeredCandidate.matchesStudentAvailability, true)
  assert.equal(outsideCandidate.matchesStudentAvailability, false)
  assert.equal(outsideCandidate.availabilityOverrideReason, 'OUTSIDE_STUDENT_AVAILABILITY')

  const created = await state.createMySessionRequest({ data: {
    sessionId: 'source-pool-complete', expectedRevision: 1, type: 'reschedule', reason: 'Đổi sang ca trống trong kho lịch',
    idempotencyKey: 'outside-availability-change', candidateId: outsideCandidate.candidateId,
  } })
  const request = state.read(`sessionRequests/${created.requestId}`)
  assert.equal(request.studentAvailabilityOverride, true)
  assert.equal(request.studentAvailabilityOverrideReason, 'OUTSIDE_STUDENT_AVAILABILITY')

  await state.approveSessionRequest({ data: { requestId: created.requestId, expectedSessionRevision: 1 } })
  const moved = state.read('sessions/source-pool-complete')
  assert.equal(moved.date, '2026-08-21')
  assert.equal(moved.hour, 11)
  assert.equal(moved.availabilityOverride, true)
  assert.equal(moved.availabilityOverrideReason, 'OUTSIDE_STUDENT_AVAILABILITY')
})

test('additional-session opportunities strictly rank open 1/2 seat, primary PT under target, then another PT', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { sessionChangeDeadlineHours: 12 },
    'students/student-1': { status: 'active', branchId: 'branch-1', sessionsPerWeek: 2, maxWeeklySessions: 7, isScheduleConfirmed: true, availableSlots: ['T6-10', 'T6-11', 'T6-14'] },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-primary', branchId: 'branch-1', packageName: 'PT Aura', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 24, usedSessions: 2 },
    'trainers/trainer-primary': { status: 'active', name: 'PT Chính', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-11'], slotCapacity: 2, dailySessionTarget: 8, schedulingPriority: 1 },
    'trainers/trainer-pair': { status: 'active', name: 'PT Ghép', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-10'], slotCapacity: 2, dailySessionTarget: 8, schedulingPriority: 2 },
    'trainers/trainer-other': { status: 'active', name: 'PT Hỗ trợ', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-14'], slotCapacity: 2, dailySessionTarget: 8, schedulingPriority: 3 },
    'sessions/open-pair': { status: 'scheduled', studentId: 'student-2', trainerId: 'trainer-pair', contractId: 'contract-2', branchId: 'branch-1', date: '2026-08-21', hour: 10, revision: 0 },
  })

  const page = await state.getMyAdditionalSessionSuggestions({ data: {} })
  assert.equal(page.contractId, 'contract-1')
  const tiers = page.suggestions.map((item) => item.priorityTier)
  assert.equal(tiers[0], 1)
  assert.ok(tiers.indexOf(1) < tiers.indexOf(2))
  assert.ok(tiers.indexOf(2) < tiers.indexOf(3))
  assert.equal(page.suggestions[0].pairsExistingSession, true)
  assert.equal(page.suggestions.find((item) => item.priorityTier === 2).isPrimaryTrainer, true)
  assert.equal(page.suggestions.find((item) => item.priorityTier === 3).trainerId, 'trainer-other')
})

test('additional-session request is idempotent and approval atomically rechecks before creating one session', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { sessionChangeDeadlineHours: 12 },
    'students/student-1': { status: 'active', branchId: 'branch-1', sessionsPerWeek: 1, maxWeeklySessions: 7, isScheduleConfirmed: true, availableSlots: ['T6-10'] },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', packageName: 'PT Aura', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 24, usedSessions: 2 },
    'trainers/trainer-1': { status: 'active', name: 'PT Chính', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-10'], slotCapacity: 2, dailySessionTarget: 8 },
  })
  const page = await state.getMyAdditionalSessionSuggestions({ data: {} })
  const candidate = page.suggestions[0]
  assert.ok(candidate)
  const created = await state.createMyAdditionalSessionRequest({ data: { candidateId: candidate.candidateId, reason: 'Muốn tăng thêm một buổi', idempotencyKey: 'add-one' } })
  assert.equal(created.status, 'pending')
  const request = state.read('sessionRequests/student-student-account-add-one')
  assert.equal(request.type, 'additional')
  const retryCreate = await state.createMyAdditionalSessionRequest({ data: { candidateId: candidate.candidateId, reason: 'Muốn tăng thêm một buổi', idempotencyKey: 'add-one' } })
  assert.equal(retryCreate.unchanged, true)

  const approved = await state.approveSessionRequest({ data: { requestId: created.requestId, expectedSessionRevision: 0 } })
  assert.equal(approved.type, 'additional')
  assert.equal(state.read(`sessions/additional-${created.requestId}`).status, 'scheduled')
  assert.equal(state.read(`sessions/additional-${created.requestId}`).contractId, 'contract-1')
  assert.equal(state.read(`sessionRequests/${created.requestId}`).status, 'approved')
  const retryApprove = await state.approveSessionRequest({ data: { requestId: created.requestId, expectedSessionRevision: 0 } })
  assert.equal(retryApprove.unchanged, true)
  assert.equal(state.paths().filter((path) => path === `sessions/additional-${created.requestId}`).length, 1)
})

test('PT pre-absence additional approval releases the source seat while creating a regular commissioned session', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { sessionChangeDeadlineHours: 12 },
    'sessionRequests/trainer-additional-1': {
      status: 'pending', type: 'additional', requestedBy: 'trainer', revision: 0,
      studentId: 'student-new', contractId: 'contract-new', trainerId: 'trainer-1', newTrainerId: 'trainer-1',
      newBranchId: 'branch-1', newDate: '2026-08-21', newHour: 18,
      preAbsenceSourceSessionId: 'source-absence', preAbsenceSourceSessionRevision: 1,
      reason: 'Học viên mới có thể tập vào chỗ đã báo nghỉ', pairsExistingSession: false,
    },
    'sessions/source-absence': {
      status: 'scheduled', scheduleStatus: 'scheduled', billingStatus: 'pending', attendanceStatus: 'pending',
      studentId: 'student-absence', trainerId: 'trainer-1', contractId: 'contract-absence', branchId: 'branch-1',
      date: '2026-08-21', hour: 18, revision: 1,
      advanceAbsenceNotice: { status: 'reported', reason: 'Học viên báo bận', replacementLocked: false },
    },
    'students/student-new': { status: 'active', branchId: 'branch-1', maxWeeklySessions: 7, isScheduleConfirmed: true, availableSlots: ['T6-18'] },
    'contracts/contract-new': { status: 'active', studentId: 'student-new', trainerId: 'trainer-1', branchId: 'branch-1', packageName: 'PT Aura', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 24, usedSessions: 0 },
    'trainers/trainer-1': { status: 'active', name: 'PT Chính', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-18'], slotCapacity: 1 },
    'ptAvailability/student-new_2026-08-17': { status: 'submitted', confirmed: true, slots: ['T6-18'], revision: 1 },
    'trainerAvailability/trainer-1_2026-08-17': { status: 'submitted', confirmed: true, slots: ['T6-18'], revision: 1 },
  }, async () => ({ uid: 'admin-1', accessRole: 'admin' }))

  const approved = await state.approveSessionRequest({ data: { requestId: 'trainer-additional-1', expectedSessionRevision: 0 } })
  assert.equal(approved.type, 'additional')
  assert.equal(approved.preAbsenceSourceSessionId, 'source-absence')
  assert.equal(state.read('sessions/additional-trainer-additional-1').source, 'trainer_additional_request')
  assert.equal(state.read('sessions/additional-trainer-additional-1').billingStatus, 'pending')
  assert.equal(state.read('sessions/additional-trainer-additional-1').countsTowardContract, true)
  assert.equal(state.read('sessions/additional-trainer-additional-1').commissionEligible, true)
  assert.equal(state.read('sessions/source-absence').advanceAbsenceNotice.replacementLocked, true)
  assert.equal(state.read('sessions/source-absence').advanceAbsenceNotice.replacementSessionId, 'additional-trainer-additional-1')
  assert.equal(state.read('sessionRequests/trainer-additional-1').releasedSourceSessionId, 'source-absence')
})

test('additional-session request blocks a second pending request for the learner', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { sessionChangeDeadlineHours: 12 },
    'students/student-1': { status: 'active', branchId: 'branch-1', sessionsPerWeek: 2, isScheduleConfirmed: true, availableSlots: ['T6-10'] },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 24, usedSessions: 2 },
    'trainers/trainer-1': { status: 'active', name: 'PT Chính', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-10'], slotCapacity: 2 },
    'sessionRequests/existing-additional': { type: 'additional', status: 'pending', studentId: 'student-1', contractId: 'contract-1', newDate: '2026-08-22', newHour: 10 },
  })
  const page = await state.getMyAdditionalSessionSuggestions({ data: {} })
  assert.deepEqual(page.issueCodes, ['ADDITIONAL_REQUEST_PENDING'])
  assert.equal(page.suggestions.length, 0)
})

test('approved PT make-up creates an exempt session and keeps the source no-show intact', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { sessionChangeDeadlineHours: 12 },
    'sessionRequests/makeup-request-1': {
      status: 'pending', type: 'makeup', makeupSession: true, makeupSourceSessionId: 'source-no-show',
      sessionId: 'source-no-show', studentId: 'student-1', trainerId: 'trainer-1', accountUid: 'trainer-account',
      contractId: 'contract-1', requestedBy: 'trainer', originalSessionRevision: 1,
      originalDate: '2026-08-20', originalHour: 8, newDate: '2026-08-25', newHour: 10,
      reason: 'Chủ động bù buổi cho học viên', revision: 0,
    },
    'sessions/source-no-show': {
      status: 'no_show', scheduleStatus: 'scheduled', billingStatus: 'charged', attendanceStatus: 'no_show',
      studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1',
      date: '2026-08-20', hour: 8, revision: 1, attendanceEventId: 'source-no-show',
    },
    'attendanceEvents/source-no-show': {
      type: 'no_show', sessionId: 'source-no-show', studentId: 'student-1', trainerId: 'trainer-1',
      contractId: 'contract-1', billingStatus: 'charged', attendanceStatus: 'no_show',
    },
    'students/student-1': { status: 'active', branchId: 'branch-1', sessionsPerWeek: 3 },
    'trainers/trainer-1': { status: 'active', name: 'PT Chính', branchId: 'branch-1', availableSlots: ['T3-10'], slotCapacity: 2 },
    'contracts/contract-1': {
      status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1',
      startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 12, usedSessions: 4,
    },
  }, async () => ({ uid: 'admin-1', accessRole: 'admin' }))

  const approved = await state.approveSessionRequest({ data: { requestId: 'makeup-request-1', expectedSessionRevision: 1 } })
  const makeup = state.read('sessions/makeup-makeup-request-1')
  assert.equal(approved.type, 'makeup')
  assert.equal(approved.makeupMode, 'standalone_shift')
  assert.equal(makeup.sessionKind, 'makeup')
  assert.equal(makeup.billingStatus, 'exempt')
  assert.equal(makeup.countsTowardContract, false)
  assert.equal(makeup.commissionEligible, false)
  assert.equal(state.read('sessions/source-no-show').status, 'no_show')
  assert.equal(state.read('contracts/contract-1').usedSessions, 4)
  assert.equal(state.read('sessionRequests/makeup-request-1').status, 'approved')
})

test('change suggestions keep a valid ninth PT slot and label it as soft-target overload', async () => {
  const occupied = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`sessions/load-${index}`, {
    status: 'scheduled', studentId: `other-${index}`, trainerId: 'trainer-1', contractId: `other-contract-${index}`,
    branchId: 'branch-1', date: '2026-08-21', hour: index, revision: 0,
  }]))
  const state = operationsFor({
    'settings/scheduleConfig': { complimentaryChangeCancelPerMonth: 2, sessionChangeDeadlineHours: 12 },
    'sessions/source-session-nine': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-22', hour: 7, revision: 1 },
    ...occupied,
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 24, usedSessions: 2 },
    'students/student-1': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T6-10'] },
    'trainers/trainer-1': { status: 'active', name: 'PT Chính', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-10'], slotCapacity: 2, dailySessionTarget: 8, schedulingPriority: 1 },
  })

  const page = await state.getMySessionChangeSuggestions({ data: { sessionId: 'source-session-nine', expectedRevision: 1 } })
  const candidate = page.suggestions.find((item) => item.date === '2026-08-21' && item.hour === 10)
  assert.ok(candidate)
  assert.equal(candidate.dailyLoadBefore, 8)
  assert.equal(candidate.dailyLoadAfter, 9)
  assert.equal(candidate.dailyTarget, 8)
  assert.equal(candidate.overTargetAfter, true)
  assert.equal(candidate.loadPolicyVersion, 'soft-daily-target-v1')
})

test('approval allows a ninth PT teaching slot while preserving hard collision checks', async () => {
  const occupied = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`sessions/approval-load-${index}`, {
    status: 'scheduled', studentId: `other-${index}`, trainerId: 'trainer-1', contractId: `other-contract-${index}`,
    branchId: 'branch-1', date: '2026-08-21', hour: index + 6, revision: 0,
  }]))
  const state = operationsFor({
    'settings/scheduleConfig': { complimentaryChangeCancelPerMonth: 2, sessionChangeDeadlineHours: 12 },
    'sessionRequests/request-nine': {
      status: 'pending', type: 'reschedule', sessionId: 'session-nine', studentId: 'student-1', contractId: 'contract-1', requestedBy: 'student',
      originalDate: '2026-08-22', originalHour: 7, originalSessionRevision: 0, newDate: '2026-08-21', newHour: 14,
      newTrainerId: 'trainer-1', submittedAtIso: '2026-08-20T00:00:00.000Z', policyMonth: '2026-08',
    },
    'sessions/session-nine': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-22', hour: 7, revision: 0 },
    ...occupied,
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 20, usedSessions: 1 },
    'students/student-1': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T6-14'] },
    'trainers/trainer-1': { status: 'active', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-14'], slotCapacity: 2, dailySessionTarget: 8 },
  }, async () => ({ uid: 'admin-1' }), { now: () => new Date('2026-08-20T03:00:00.000Z') })

  const result = await state.approveSessionRequest({ data: { requestId: 'request-nine', expectedSessionRevision: 0 } })
  assert.equal(result.unchanged, false)
  assert.equal(state.read('sessions/session-nine').date, '2026-08-21')
  assert.equal(state.read('sessions/session-nine').hour, 14)
  assert.equal(state.read('sessionRequests/request-nine').status, 'approved')
})

test('approval rejects a stale reschedule after the PT weekly availability changes', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { sessionChangeDeadlineHours: 12 },
    'sessionRequests/request-weekly-stale': {
      status: 'pending', type: 'reschedule', sessionId: 'session-weekly-stale', studentId: 'student-1', contractId: 'contract-1', requestedBy: 'student',
      originalDate: '2026-08-22', originalHour: 7, originalSessionRevision: 0, newDate: '2026-08-21', newHour: 14,
      newTrainerId: 'trainer-1', submittedAtIso: '2026-08-20T00:00:00.000Z', policyMonth: '2026-08',
    },
    'sessions/session-weekly-stale': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-22', hour: 7, revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 20, usedSessions: 1 },
    'students/student-1': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T6-14'] },
    'trainers/trainer-1': { status: 'active', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-14'], slotCapacity: 2 },
    'trainerAvailability/trainer-1_2026-08-17': { trainerId: 'trainer-1', weekId: '2026-08-17', status: 'submitted', slots: ['T6-15'], revision: 3 },
  })

  await assert.rejects(
    state.approveSessionRequest({ data: { requestId: 'request-weekly-stale', expectedSessionRevision: 0 } }),
    (error) => error.code === 'failed-precondition' && error.message.includes('lịch rảnh PT tuần này'),
  )
  assert.equal(state.read('sessions/session-weekly-stale').date, '2026-08-22')
  assert.equal(state.read('sessionRequests/request-weekly-stale').status, 'pending')
})

test('approval rejects a learner reschedule that jumps to another calendar week', async () => {
  const state = operationsFor({
    'sessionRequests/request-cross-week': {
      status: 'pending', type: 'reschedule', sessionId: 'session-cross-week', studentId: 'student-1', contractId: 'contract-1', requestedBy: 'student',
      originalDate: '2026-08-22', originalHour: 7, originalSessionRevision: 0, newDate: '2026-08-24', newHour: 10,
      newTrainerId: 'trainer-1', submittedAtIso: '2026-08-20T00:00:00.000Z', policyMonth: '2026-08',
    },
    'sessions/session-cross-week': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-22', hour: 7, revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 1 },
  })

  await assert.rejects(
    state.approveSessionRequest({ data: { requestId: 'request-cross-week', expectedSessionRevision: 0 } }),
    (error) => error.code === 'failed-precondition' && error.details?.issueCode === 'SESSION_CHANGE_WEEK_MISMATCH',
  )
  assert.equal(state.read('sessions/session-cross-week').date, '2026-08-22')
  assert.equal(state.read('sessionRequests/request-cross-week').status, 'pending')
})

test('collision checks cover trainer capacity, student double booking, legacy ISO dates, and bounded query overflow', () => {
  assert.match(source, /const DAILY_SESSION_QUERY_LIMIT = 200/)
  assert.match(source, /function dailySessionsQuery/)
  assert.match(source, /\.where\('date', '>=', targetDate\)/)
  assert.match(source, /\.where\('date', '<', nextDateKey\(targetDate\)\)/)
  assert.match(source, /dailySessionsQuery\(db, 'trainerId'/)
  assert.match(source, /dailySessionsQuery\(db, 'studentId'/)
  assert.match(source, /snapshot\.size >= DAILY_SESSION_QUERY_LIMIT/)
  assert.match(source, /activeDayDocuments\(studentDay, \[sessionId\]\)\.length > 0/)
  assert.match(source, /activeDayDocuments\(studentDay\)\.length > 0/)
  assert.match(source, /LEGACY_SESSION_MUTATION_DISABLED/)
})

test('trainer-created requests carry immutable origin and session revision provenance', () => {
  const creation = trainerOperations.match(/const requestSessionChange[\s\S]*?\n  const listMyQuotes/)?.[0] ?? ''
  assert.match(creation, /requestedBy: 'trainer'/)
  assert.match(creation, /originalSessionRevision: Number\(sessionData\.revision \|\| 0\)/)
  assert.match(creation, /originalHour/)
  assert.match(creation, /sourceAttendancePending/)
  assert.match(creation, /isMakeupRequest && newDate/)
  assert.doesNotMatch(creation, /assertSessionChangeDeadline\(originalDate/)
  assert.match(creation, /idempotencyKey/)
  assert.match(creation, /đã có một yêu cầu đang chờ xử lý/)
})

test('PT can request an adjustment while attendance is still pending, regardless of start time', () => {
  assert.match(trainerPortal, /const requestable = attendanceState\(session\) === 'pending'/)
  assert.match(trainerPortal, /\{requestable \? <button className="opv2-request-link"/)
  assert.doesNotMatch(trainerPortal, /startsAt - now >= 12 \* 60 \* 60 \* 1000/)
})

test('PT pre-absence flow is exposed through separate planning and additional-session callables', () => {
  assert.match(trainerOperations, /const reportMySessionAdvanceAbsence = staff(?:Mutation)?Call/)
  assert.match(trainerOperations, /const requestStudentSessionAddition = staff(?:Mutation)?Call/)
  assert.match(trainerOperations, /reportMySessionAdvanceAbsence, requestStudentSessionAddition/)
  assert.match(trainerPortal, /Báo nghỉ trước giờ/)
  assert.match(trainerPortal, /Thêm học viên vào ca/)
  assert.match(source, /ADVANCE_ABSENCE_REPLACEMENT_LOCKED/)
})

test('PT schedule does not expose the optional Kudos action', () => {
  assert.doesNotMatch(trainerPortal, /giveSessionKudos|kudosBusy|kudosSent|Gửi Kudos/)
})

test('attendance uses the session contract link and a deterministic event id', async () => {
  const state = operationsFor({
    'sessions/session-attendance-1': {
      status: 'scheduled',
      studentId: 'student-1',
      trainerId: 'trainer-1',
      contractId: 'contract-1',
      date: '2026-08-20',
      hour: 8,
      revision: 0,
    },
    'contracts/contract-1': {
      status: 'active',
      studentId: 'student-1',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      totalSessions: 12,
      usedSessions: 0,
      totalPrice: 1200000,
    },
  })

  const first = await state.confirmSessionAttendance({
    data: { sessionId: 'session-attendance-1', expectedRevision: 0 },
  })
  assert.equal(first.unchanged, false)
  assert.equal(first.attendanceEventId, 'session-attendance-1')
  assert.equal(state.read('sessions/session-attendance-1').status, 'completed')
  assert.equal(state.read('sessions/session-attendance-1').billingStatus, 'charged')
  assert.equal(state.read('sessions/session-attendance-1').attendanceStatus, 'present')
  assert.equal(state.read('sessions/session-attendance-1').attendanceEventId, 'session-attendance-1')
  assert.equal(state.read('attendanceEvents/session-attendance-1').contractId, 'contract-1')
  assert.equal(state.read('attendanceEvents/session-attendance-1').attendanceStatus, 'present')
  assert.equal(state.read('sessionBillingEvents/session-attendance-1').billingStatus, 'charged')
  assert.equal(state.read('ledgerEntries/pt_session_session-attendance-1').recognitionPolicy, 'confirmed_attendance_v3')
  assert.equal(state.read('ledgerEntries/pt_session_session-attendance-1').serviceOrdinal, 1)
  assert.equal(state.read('journalEntries/pt_session_session-attendance-1').totalDebit, 100000)
  assert.equal(state.read('journalEntries/pt_session_session-attendance-1').totalCredit, 100000)

  const retry = await state.confirmSessionAttendance({
    data: { sessionId: 'session-attendance-1', expectedRevision: 0 },
  })
  assert.equal(retry.unchanged, true)
  assert.equal(retry.attendanceEventId, 'session-attendance-1')
  assert.equal(state.paths().filter((path) => path === 'attendanceEvents/session-attendance-1').length, 1)
  assert.equal(state.paths().filter((path) => path === 'sessionBillingEvents/session-attendance-1').length, 1)
})

test('automatic charge backfills elapsed sessions across week boundaries', async () => {
  const state = fakeDatabase({
    'sessions/monday-due': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-08-24', hour: 8, revision: 0 },
    'sessions/today-due': { status: 'scheduled', studentId: 'student-2', trainerId: 'trainer-1', contractId: 'contract-2', date: '2026-08-28', hour: 17, revision: 0 },
    'sessions/today-future': { status: 'scheduled', studentId: 'student-3', trainerId: 'trainer-1', contractId: 'contract-3', date: '2026-08-28', hour: 18, revision: 0 },
    'sessions/previous-week': { status: 'scheduled', studentId: 'student-4', trainerId: 'trainer-1', contractId: 'contract-4', date: '2026-08-23', hour: 8, revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 12, usedSessions: 0 },
    'contracts/contract-2': { status: 'active', studentId: 'student-2', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 12, usedSessions: 0 },
    'contracts/contract-3': { status: 'active', studentId: 'student-3', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 12, usedSessions: 0 },
    'contracts/contract-4': { status: 'active', studentId: 'student-4', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 12, usedSessions: 0 },
  })
  const summary = await chargeDuePtSessions({
    db: state.db,
    now: new Date('2026-08-28T10:30:00.000Z'),
    logger: { info() {}, warn() {} },
  })
  assert.equal(summary.weekStart, '2026-08-24')
  assert.equal(summary.charged, 3)
  assert.equal(state.read('sessions/monday-due').attendanceStatus, 'pending')
  assert.equal(state.read('sessions/today-due').billingStatus, 'charged')
  assert.equal(state.read('sessions/today-future').billingStatus, undefined)
  assert.equal(state.read('sessions/previous-week').billingStatus, 'charged')
})

test('automatic session reconciliation uses bounded ordered pages and durable cursors', () => {
  assert.match(source, /readAutomationSessionPage\(\{ db, jobId: 'ptSessionChargeCatchUp'/)
  assert.match(source, /orderBy\('date', 'asc'\)\.orderBy\(FieldPath\.documentId\(\), 'asc'\)/)
  assert.match(source, /systemJobs\/\$\{jobId\}/)
  assert.match(source, /nextCursor = docs\.length >= pageSize/)
  assert.match(source, /recordAutomaticChargeFailureIssue/)
  assert.match(source, /await Promise\.all\(pages\.map\(commitAutomationSessionPage\)\)/)
  const reader = source.match(/async function readAutomationSessionPage[\s\S]*?\n}\n\nasync function commitAutomationSessionPage/)?.[0] || ''
  assert.doesNotMatch(reader, /stateReference\.set/)
})

test('one invalid legacy session is queued for review without blocking valid automatic charges', async () => {
  const state = fakeDatabase({
    'sessions/missing-link': { status: 'scheduled', studentId: 'student-missing', trainerId: 'trainer-1', date: '2026-08-28', hour: 8, revision: 0 },
    'sessions/valid-link': { status: 'scheduled', studentId: 'student-valid', trainerId: 'trainer-1', contractId: 'contract-valid', date: '2026-08-28', hour: 9, revision: 0 },
    'contracts/contract-valid': { status: 'active', studentId: 'student-valid', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 12, usedSessions: 0 },
  })
  const summary = await chargeDuePtSessions({
    db: state.db,
    now: new Date('2026-08-28T10:00:00.000Z'),
    logger: { info() {}, warn() {} },
  })
  assert.equal(summary.charged, 1)
  assert.equal(summary.failed, 1)
  assert.equal(summary.issuesQueued, 1)
  assert.equal(summary.issueQueueFailed, 0)
  assert.equal(state.read('sessions/valid-link').billingStatus, 'charged')
  assert.equal(state.read('sessionBillingIssues/missing-link').status, 'open')
  assert.equal(state.read('sessionBillingIssues/missing-link').issueCode, 'SESSION_CONTRACT_LINK_REQUIRED')
})

test('a successful retry resolves its automatic charge issue', async () => {
  const state = fakeDatabase({
    'sessions/reconciled': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-08-28', hour: 8, revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 12, usedSessions: 0 },
    'sessionBillingIssues/reconciled': { status: 'open', issueSource: 'automatic_charge', issueCode: 'SESSION_CONTRACT_LINK_REQUIRED', attempts: 3 },
  })
  const summary = await chargeDuePtSessions({
    db: state.db,
    now: new Date('2026-08-28T10:00:00.000Z'),
    logger: { info() {}, warn() {} },
  })
  assert.equal(summary.charged, 1)
  assert.equal(state.read('sessionBillingIssues/reconciled').status, 'resolved')
  assert.equal(state.read('sessionBillingIssues/reconciled').resolution, 'session_charged_after_contract_reconciliation')
})

test('automation cursor covers more than 2,000 sessions and only advances after an explicit successful commit', async () => {
  const sessions = Array.from({ length: 2_105 }, (_, index) => ({
    id: `session-${String(index).padStart(4, '0')}`,
    date: index < 2_000 ? '2026-08-01' : '2026-08-02',
  }))
  const checkpoints = new Map()
  const documentReference = (path) => ({
    path,
    async get() {
      const value = checkpoints.get(path)
      return { exists: Boolean(value), data: () => clone(value) }
    },
    async set(value) {
      checkpoints.set(path, { ...(checkpoints.get(path) || {}), ...clone(value) })
    },
  })
  const query = (filters = [], maximum = sessions.length, cursor = null) => ({
    where(field, operator, value) { return query([...filters, { field, operator, value }], maximum, cursor) },
    orderBy() { return this },
    limit(value) { return query(filters, value, cursor) },
    startAfter(date, id) { return query(filters, maximum, { date, id }) },
    async get() {
      const matches = sessions
        .filter((item) => filters.every((filter) => filter.operator === '<' ? item[filter.field] < filter.value : item[filter.field] >= filter.value))
        .filter((item) => !cursor || item.date > cursor.date || (item.date === cursor.date && item.id > cursor.id))
        .slice(0, maximum)
        .map((item) => ({ id: item.id, data: () => ({ date: item.date }) }))
      return { docs: matches, size: matches.length, empty: matches.length === 0 }
    },
  })
  const db = {
    doc: documentReference,
    collection(name) {
      assert.equal(name, 'sessions')
      return query()
    },
  }

  const first = await readAutomationSessionPage({ db, jobId: 'large-retry', upperDate: '2026-08-03', limit: 2_000 })
  assert.equal(first.docs.length, 2_000)
  assert.deepEqual(first.nextCursor, { date: '2026-08-01', id: 'session-1999' })
  assert.equal(checkpoints.has('systemJobs/large-retry'), false, 'read alone must not advance the durable cursor')

  const retry = await readAutomationSessionPage({ db, jobId: 'large-retry', upperDate: '2026-08-03', limit: 2_000 })
  assert.equal(retry.docs[0].id, first.docs[0].id, 'a failed page is retried from the same source record')

  await commitAutomationSessionPage(first)
  const second = await readAutomationSessionPage({ db, jobId: 'large-retry', upperDate: '2026-08-03', limit: 2_000 })
  assert.equal(second.docs.length, 105)
  assert.equal(second.docs[0].id, 'session-2000')
  assert.equal(second.nextCursor, null)
})

test('unconfirmed charged attendance becomes present after 48 hours with an explicit audit source', async () => {
  const state = fakeDatabase({
    'sessions/overdue-pending': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-08-26', hour: 17, revision: 1, billingStatus: 'charged', attendanceStatus: 'pending', attendanceEventId: 'overdue-pending' },
    'attendanceEvents/overdue-pending': { type: 'pending_confirmation', sessionId: 'overdue-pending', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', billingStatus: 'charged', attendanceStatus: 'pending', lateMinutes: null, noShowReason: '', note: '' },
    'sessions/within-window': { status: 'scheduled', studentId: 'student-2', trainerId: 'trainer-1', contractId: 'contract-2', date: '2026-08-27', hour: 17, revision: 1, billingStatus: 'charged', attendanceStatus: 'pending', attendanceEventId: 'within-window' },
    'attendanceEvents/within-window': { type: 'pending_confirmation', sessionId: 'within-window', studentId: 'student-2', trainerId: 'trainer-1', contractId: 'contract-2', billingStatus: 'charged', attendanceStatus: 'pending', lateMinutes: null, noShowReason: '', note: '' },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 12, usedSessions: 1, totalPrice: 1200000, chargedSessionIds: ['overdue-pending'] },
    'contracts/contract-2': { status: 'active', studentId: 'student-2', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 12, usedSessions: 1, totalPrice: 1200000, chargedSessionIds: ['within-window'] },
  })
  const summary = await autoConfirmOverduePtAttendance({
    db: state.db,
    now: new Date('2026-08-28T10:00:00.000Z'),
    logger: { info() {}, warn() {} },
  })
  assert.equal(summary.confirmationAfterHours, 48)
  assert.equal(summary.confirmedPresent, 1)
  assert.equal(state.read('sessions/overdue-pending').status, 'completed')
  assert.equal(state.read('sessions/overdue-pending').attendanceStatus, 'present')
  assert.equal(state.read('sessions/overdue-pending').confirmationSource, 'auto_after_48h')
  assert.equal(state.read('attendanceEvents/overdue-pending').attendanceStatus, 'present')
  assert.equal(state.read('attendanceEvents/overdue-pending').confirmationSource, 'auto_after_48h')
  assert.equal(state.read('attendanceEvents/overdue-pending').recognitionReviewRequired, true)
  assert.equal(state.read('revenueRecognitionReviews/overdue-pending').issueCode, 'AUTO_CONFIRMATION_REQUIRES_REVIEW')
  assert.equal(state.read('ledgerEntries/pt_session_overdue-pending'), undefined)
  assert.equal(state.read('sessions/within-window').attendanceStatus, 'pending')
  assert.equal(state.paths().filter((path) => path.startsWith('attendanceAuditLogs/')).length, 1)
})

test('an elapsed session with exhausted quota still enters attendance review without consuming another entitlement', async () => {
  const state = fakeDatabase({
    'sessions/quota-review': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-08-26', hour: 17, revision: 0 },
    'contracts/contract-1': { status: 'expired', studentId: 'student-1', startDate: '2026-08-01', endDate: '2026-08-27', totalSessions: 12, usedSessions: 12 },
  })
  const now = new Date('2026-08-28T10:00:00.000Z')
  const charge = await chargeDuePtSessions({ db: state.db, now, logger: { info() {}, warn() {} } })
  assert.equal(charge.reviewRequired, 1)
  assert.equal(state.read('sessions/quota-review').billingStatus, 'review_required')
  assert.equal(state.read('sessions/quota-review').attendanceStatus, 'pending')
  assert.equal(state.read('attendanceEvents/quota-review').billingIssueCode, 'CONTRACT_QUOTA_EXHAUSTED')
  assert.equal(state.read('sessionBillingEvents/quota-review'), undefined)
  assert.equal(state.read('contracts/contract-1').usedSessions, 12)

  const confirmation = await autoConfirmOverduePtAttendance({ db: state.db, now, logger: { info() {}, warn() {} } })
  assert.equal(confirmation.confirmedPresent, 1)
  assert.equal(state.read('sessions/quota-review').status, 'completed')
  assert.equal(state.read('sessions/quota-review').attendanceStatus, 'present')
  assert.equal(state.read('sessions/quota-review').billingStatus, 'review_required')
  assert.equal(state.read('contracts/contract-1').usedSessions, 12)
})

test('automatic billing stays independent from present, late, no-show and audited corrections', async () => {
  const state = operationsFor({
    'sessions/session-late': {
      status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-08-20', hour: 8, revision: 0,
    },
    'contracts/contract-1': {
      status: 'active', studentId: 'student-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 0, totalPrice: 1200000,
    },
  })
  const late = await state.recordSessionAttendance({
    data: { sessionId: 'session-late', expectedRevision: 0, attendanceStatus: 'late', lateMinutes: 10 },
  })
  assert.equal(late.attendanceStatus, 'late')
  assert.equal(state.read('sessions/session-late').billingStatus, 'charged')
  assert.equal(state.read('sessions/session-late').attendanceStatus, 'late')
  assert.equal(state.read('attendanceEvents/session-late').lateMinutes, 10)
  assert.equal(state.paths().filter((path) => path === 'sessionBillingEvents/session-late').length, 1)

  const corrected = await state.recordSessionAttendance({
    data: { sessionId: 'session-late', expectedRevision: late.revision, attendanceStatus: 'no_show', noShowReason: 'forgot' },
  })
  assert.equal(corrected.attendanceStatus, 'no_show')
  assert.equal(state.read('sessions/session-late').status, 'no_show')
  assert.equal(state.paths().filter((path) => path.startsWith('attendanceAuditLogs/')).length, 2)
  assert.equal(state.paths().filter((path) => path === 'sessionBillingEvents/session-late').length, 1)
})

test('no-show is blocked during the first fifteen minutes without rolling back the automatic charge', async () => {
  const state = operationsFor({
    'sessions/session-grace': {
      status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-08-20', hour: 8, revision: 0,
    },
    'contracts/contract-1': {
      status: 'active', studentId: 'student-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 0, totalPrice: 1200000,
    },
  }, async () => ({ uid: 'admin-1' }), { now: () => new Date('2026-08-20T01:05:00.000Z') })
  await assert.rejects(
    state.recordSessionAttendance({ data: { sessionId: 'session-grace', expectedRevision: 0, attendanceStatus: 'no_show' } }),
    (error) => error.code === 'failed-precondition' && error.details?.issueCode === 'NO_SHOW_GRACE_ACTIVE',
  )
  assert.equal(state.read('sessions/session-grace').billingStatus, 'charged')
  assert.equal(state.read('sessions/session-grace').attendanceStatus, 'pending')
  assert.equal(state.read('attendanceEvents/session-grace').attendanceStatus, 'pending')
})

test('attendance fails closed when contractId is missing, mismatched, or outside its term', async () => {
  const missing = operationsFor({
    'sessions/session-missing-contract': {
      status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', date: '2026-08-20', revision: 0,
    },
    'contracts/unrelated-active-contract': {
      status: 'active', studentId: 'student-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 0,
    },
  })
  await assert.rejects(
    missing.confirmSessionAttendance({ data: { sessionId: 'session-missing-contract', expectedRevision: 0 } }),
    (error) => error.code === 'failed-precondition' && error.details?.issueCode === 'SESSION_CONTRACT_LINK_REQUIRED',
  )
  assert.equal(missing.read('sessions/session-missing-contract').status, 'scheduled')

  const mismatched = operationsFor({
    'sessions/session-mismatch': {
      status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-other', date: '2026-08-20', revision: 0,
    },
    'contracts/contract-other': {
      status: 'active', studentId: 'student-2', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 0,
    },
  })
  await assert.rejects(
    mismatched.confirmSessionAttendance({ data: { sessionId: 'session-mismatch', expectedRevision: 0 } }),
    (error) => error.code === 'failed-precondition',
  )
  assert.equal(mismatched.paths().some((path) => path.startsWith('attendanceEvents/')), false)

  const outsideTerm = operationsFor({
    'sessions/session-outside-term': {
      status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-09-01', revision: 0,
    },
    'contracts/contract-1': {
      status: 'active', studentId: 'student-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 0,
    },
  })
  await assert.rejects(
    outsideTerm.confirmSessionAttendance({ data: { sessionId: 'session-outside-term', expectedRevision: 0 } }),
    (error) => error.code === 'failed-precondition',
  )
  assert.equal(outsideTerm.read('sessions/session-outside-term').status, 'scheduled')
})

test('trainer attendance delegates to the same contract-linked transaction', () => {
  const trainerConfirmation = trainerOperations.match(/const confirmMySession[\s\S]*?\n  const submitWorkoutNote/)?.[0] ?? ''
  assert.match(trainerConfirmation, /completeSessionAttendanceTransaction/)
  assert.match(trainerConfirmation, /assertSessionScope/)
  assert.doesNotMatch(trainerConfirmation, /collection\('contracts'\)/)
  assert.doesNotMatch(trainerConfirmation, /collection\('attendanceEvents'\)\.doc\(\)/)
})

test('first approved student cancellation is complimentary and retries idempotently', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { sessionChangeDeadlineHours: 12, complimentaryChangeCancelPerMonth: 2 },
    'sessionRequests/request-1': { status: 'pending', type: 'cancel', sessionId: 'session-1', studentId: 'student-1', contractId: 'contract-1', requestedBy: 'student', originalDate: '2026-08-20', originalHour: 8, originalSessionRevision: 2, reason: 'Bận', submittedAtIso: '2026-08-19T00:00:00.000Z', policyMonth: '2026-08' },
    'sessions/session-1': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-08-20', hour: 8, revision: 2 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 0 },
  })
  const first = await state.approveSessionRequest({ data: { requestId: 'request-1', expectedSessionRevision: 2 } })
  assert.equal(first.unchanged, false)
  assert.equal(first.complimentary, true)
  assert.equal(first.countsTowardContract, false)
  assert.equal(state.read('sessions/session-1').status, 'student_cancelled')
  assert.equal(state.read('sessions/session-1').revision, 3)
  assert.equal(state.read('sessionRequests/request-1').status, 'approved')
  assert.equal(state.read('contracts/contract-1').endDate, '2026-08-31')
  assert.ok(state.paths().some((path) => path.startsWith('sessionEvents/')))

  const retry = await state.approveSessionRequest({ data: { requestId: 'request-1', expectedSessionRevision: 2 } })
  assert.equal(retry.unchanged, true)
  assert.equal(state.read('sessions/session-1').revision, 3)
})

test('late learner cancellation is accepted and charged instead of being duplicated or silently dropped', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { sessionChangeDeadlineHours: 12, complimentaryChangeCancelPerMonth: 2 },
    'sessions/session-late-cancel': {
      status: 'scheduled', scheduleStatus: 'scheduled', billingStatus: 'pending', attendanceStatus: 'pending',
      studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1',
      date: '2026-08-20', hour: 18, revision: 0,
    },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 0, totalPrice: 1_200_000 },
  })

  const created = await state.createMySessionRequest({ data: {
    sessionId: 'session-late-cancel', expectedRevision: 0, type: 'cancel', reason: 'Phát sinh việc gấp', idempotencyKey: 'late-cancel',
  } })
  assert.equal(created.lateCancellation, true)
  assert.equal(created.expectedCountsTowardContract, true)

  const approved = await state.approveSessionRequest({ data: { requestId: created.requestId, expectedSessionRevision: 0 } })
  assert.equal(approved.countsTowardContract, true)
  assert.equal(approved.lateCancellation, true)
  assert.equal(state.read('sessions/session-late-cancel').status, 'student_cancelled')
  assert.equal(state.read('sessions/session-late-cancel').billingStatus, 'charged')
  assert.equal(state.read('sessions/session-late-cancel').policyViolation, 'late_cancellation')
  assert.equal(state.read('contracts/contract-1').usedSessions, 1)
  assert.equal(state.read(`sessionRequests/${created.requestId}`).policyViolation, 'late_cancellation')
  assert.equal(state.paths().filter((path) => path === 'attendanceEvents/policy_' + created.requestId).length, 1)
})

test('approved cancellation removes the published matrix cell before the next publish', async () => {
  const entry = { studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', type: 'training' }
  const scheduleEntryId = 'schedule_2026-08-17-T5-8-student-1'
  const state = operationsFor({
    'sessionRequests/request-schedule-cancel': {
      status: 'pending', type: 'cancel', sessionId: 'session-schedule-cancel', studentId: 'student-1', contractId: 'contract-1',
      requestedBy: 'student', originalDate: '2026-08-20', originalHour: 8, originalSessionRevision: 2,
      reason: 'Bận việc gia đình', submittedAtIso: '2026-08-19T00:00:00.000Z', policyMonth: '2026-08',
    },
    'sessions/session-schedule-cancel': {
      status: 'scheduled', scheduleStatus: 'scheduled', billingStatus: 'pending', attendanceStatus: 'pending',
      studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1',
      date: '2026-08-20', hour: 8, scheduleWeekId: '2026-08-17', slotId: 'T5-8', scheduleEntryId, revision: 2,
    },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 0 },
    'ptScheduleDrafts/branch-1_2026-08-17': {
      branchId: 'branch-1', weekId: '2026-08-17', status: 'published', revision: 4, publishedRevision: 4,
      schedule: { 'T5-8': [entry] },
    },
    'schedules/schedule_2026-08-17': { draftRevision: 4, schedule: { 'T5-8': [entry] } },
  })

  const result = await state.approveSessionRequest({ data: { requestId: 'request-schedule-cancel', expectedSessionRevision: 2 } })
  assert.equal(result.removedScheduleEntryCount, 2)
  assert.deepEqual(state.read('ptScheduleDrafts/branch-1_2026-08-17').schedule, {})
  assert.equal(state.read('ptScheduleDrafts/branch-1_2026-08-17').revision, 5)
  assert.equal(state.read('ptScheduleDrafts/branch-1_2026-08-17').publishedRevision, 5)
  assert.deepEqual(state.read('schedules/schedule_2026-08-17').schedule, {})
  assert.equal(state.read('schedules/schedule_2026-08-17').draftRevision, 5)

  const retry = await state.approveSessionRequest({ data: { requestId: 'request-schedule-cancel', expectedSessionRevision: 2 } })
  assert.equal(retry.unchanged, true)
  assert.deepEqual(state.read('ptScheduleDrafts/branch-1_2026-08-17').schedule, {})
})

test('approved learner reschedule moves the matrix entry and session identity atomically', async () => {
  const oldEntry = {
    studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', type: 'training',
    scheduleEntryId: 'schedule_2026-08-17-T7-7-student-1',
  }
  const state = operationsFor({
    'settings/scheduleConfig': { complimentaryChangeCancelPerMonth: 2, sessionChangeDeadlineHours: 12 },
    'sessionRequests/request-schedule-move': {
      status: 'pending', type: 'reschedule', sessionId: 'session-schedule-move', studentId: 'student-1', contractId: 'contract-1',
      requestedBy: 'student', originalDate: '2026-08-22', originalHour: 7, originalSessionRevision: 2,
      newDate: '2026-08-21', newHour: 10, newTrainerId: 'trainer-1', submittedAtIso: '2026-08-20T00:00:00.000Z', policyMonth: '2026-08',
    },
    'sessions/session-schedule-move': {
      status: 'scheduled', scheduleStatus: 'scheduled', billingStatus: 'pending', attendanceStatus: 'pending',
      studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1',
      date: '2026-08-22', hour: 7, scheduleWeekId: '2026-08-17', slotId: 'T7-7', scheduleEntryId: oldEntry.scheduleEntryId, revision: 2,
    },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 0 },
    'students/student-1': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T6-10'] },
    'trainers/trainer-1': { status: 'active', name: 'PT Chính', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-10'], slotCapacity: 2 },
    'ptScheduleDrafts/branch-1_2026-08-17': { branchId: 'branch-1', weekId: '2026-08-17', status: 'published', revision: 4, publishedRevision: 4, schedule: { 'T7-7': [oldEntry] } },
    'schedules/schedule_2026-08-17': { draftRevision: 4, schedule: { 'T7-7': [oldEntry] } },
  }, async () => ({ uid: 'admin-1' }), { now: () => new Date('2026-08-20T03:00:00.000Z') })

  const result = await state.approveSessionRequest({ data: { requestId: 'request-schedule-move', expectedSessionRevision: 2 } })
  assert.equal(result.removedScheduleEntryCount, 2)
  assert.equal(result.movedScheduleEntryCount, 2)
  assert.equal(state.read('ptScheduleDrafts/branch-1_2026-08-17').schedule['T7-7'], undefined)
  assert.equal(state.read('schedules/schedule_2026-08-17').schedule['T7-7'], undefined)
  assert.equal(state.read('ptScheduleDrafts/branch-1_2026-08-17').schedule['T6-10'][0].studentId, 'student-1')
  assert.equal(state.read('schedules/schedule_2026-08-17').schedule['T6-10'][0].trainerId, 'trainer-1')
  const moved = state.read('sessions/session-schedule-move')
  assert.equal(moved.date, '2026-08-21')
  assert.equal(moved.hour, 10)
  assert.equal(moved.scheduleWeekId, '2026-08-17')
  assert.equal(moved.slotId, 'T6-10')
  assert.equal(moved.scheduleEntryId, 'schedule_2026-08-17-T6-10-student-1')

  const retry = await state.approveSessionRequest({ data: { requestId: 'request-schedule-move', expectedSessionRevision: 2 } })
  assert.equal(retry.unchanged, true)
  assert.equal(state.read('ptScheduleDrafts/branch-1_2026-08-17').schedule['T6-10'].length, 1)
})

test('second approved change in a calendar month creates one immutable policy charge', async () => {
  const state = operationsFor({
    'ptPolicyUsage/student-1_2026-08': { studentId: 'student-1', monthKey: '2026-08', approvedChangeCancelCount: 1 },
    'sessionRequests/request-charge': { status: 'pending', type: 'cancel', sessionId: 'session-charge', studentId: 'student-1', contractId: 'contract-1', requestedBy: 'student', originalDate: '2026-08-20', originalHour: 18, originalSessionRevision: 0, reason: 'Bận công tác', submittedAtIso: '2026-08-19T00:00:00.000Z', policyMonth: '2026-08' },
    'sessions/session-charge': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-08-20', hour: 18, revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 1, totalPrice: 1200000 },
  })
  const result = await state.approveSessionRequest({ data: { requestId: 'request-charge', expectedSessionRevision: 0 } })
  assert.equal(result.policySequence, 2)
  assert.equal(result.complimentary, false)
  assert.equal(result.countsTowardContract, true)
  assert.equal(state.read('attendanceEvents/policy_request-charge').type, 'charged_cancellation')
  assert.equal(state.read('sessionRequests/request-charge').countsTowardContract, true)
  assert.equal(state.read('ledgerEntries/pt_policy_request-charge').recognitionPolicy, 'approved_policy_charge_v2')
  assert.equal(state.read('journalEntries/pt_policy_request-charge').totalDebit, 100000)
  assert.equal(state.paths().filter((path) => path === 'attendanceEvents/policy_request-charge').length, 1)
})

test('an available Aura Club reschedule entitlement replaces the policy charge exactly once', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { complimentaryChangeCancelPerMonth: 1, sessionChangeDeadlineHours: 12 },
    'ptPolicyUsage/student-1_2026-08': { studentId: 'student-1', monthKey: '2026-08', approvedChangeCancelCount: 1 },
    'sessionRequests/request-entitlement': {
      status: 'pending', type: 'reschedule', sessionId: 'session-entitlement', studentId: 'student-1', accountUid: 'student-account',
      contractId: 'contract-1', requestedBy: 'student', originalDate: '2026-08-22', originalHour: 7, originalSessionRevision: 0,
      newDate: '2026-08-21', newHour: 10, newTrainerId: 'trainer-1', submittedAtIso: '2026-08-20T00:00:00.000Z', policyMonth: '2026-08',
    },
    'sessions/session-entitlement': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-22', hour: 7, revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 1, totalPrice: 1_200_000 },
    'students/student-1': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T6-10'] },
    'trainers/trainer-1': { status: 'active', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-10'], slotCapacity: 2 },
    'loyaltyEntitlements/entitlement-1': { studentId: 'student-1', type: 'extra_reschedule', status: 'available', expiresAt: '2026-09-30T16:59:59.000Z' },
  }, async () => ({ uid: 'admin-1' }), { now: () => new Date('2026-08-20T03:00:00.000Z') })

  const result = await state.approveSessionRequest({ data: { requestId: 'request-entitlement', expectedSessionRevision: 0 } })
  assert.equal(result.countsTowardContract, false)
  assert.equal(result.loyaltyEntitlementUsed, true)
  assert.equal(result.loyaltyEntitlementId, 'entitlement-1')
  assert.equal(state.read('contracts/contract-1').usedSessions, 1)
  assert.equal(state.read('loyaltyEntitlements/entitlement-1').status, 'consumed')
  assert.equal(state.read('loyaltyEntitlements/entitlement-1').consumedRequestId, 'request-entitlement')
  assert.equal(state.read('sessions/session-entitlement').loyaltyEntitlementId, 'entitlement-1')
  assert.equal(state.read('attendanceEvents/policy_request-entitlement'), undefined)

  const retry = await state.approveSessionRequest({ data: { requestId: 'request-entitlement', expectedSessionRevision: 0 } })
  assert.equal(retry.unchanged, true)
  assert.equal(retry.loyaltyEntitlementId, 'entitlement-1')
  assert.equal(state.read('loyaltyEntitlements/entitlement-1').status, 'consumed')
})

test('an expired Aura Club entitlement cannot replace the normal change policy charge', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { complimentaryChangeCancelPerMonth: 1, sessionChangeDeadlineHours: 12 },
    'ptPolicyUsage/student-1_2026-08': { studentId: 'student-1', monthKey: '2026-08', approvedChangeCancelCount: 1 },
    'sessionRequests/request-expired-entitlement': {
      status: 'pending', type: 'reschedule', sessionId: 'session-expired-entitlement', studentId: 'student-1',
      contractId: 'contract-1', requestedBy: 'student', originalDate: '2026-08-22', originalHour: 7, originalSessionRevision: 0,
      newDate: '2026-08-21', newHour: 10, newTrainerId: 'trainer-1', submittedAtIso: '2026-08-20T00:00:00.000Z', policyMonth: '2026-08',
    },
    'sessions/session-expired-entitlement': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-22', hour: 7, revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 1, totalPrice: 1_200_000 },
    'students/student-1': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T6-10'] },
    'trainers/trainer-1': { status: 'active', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-10'], slotCapacity: 2 },
    'loyaltyEntitlements/entitlement-expired': { studentId: 'student-1', type: 'extra_reschedule', status: 'available', expiresAt: '2026-08-19T16:59:59.000Z' },
  }, async () => ({ uid: 'admin-1' }), { now: () => new Date('2026-08-20T03:00:00.000Z') })

  const result = await state.approveSessionRequest({ data: { requestId: 'request-expired-entitlement', expectedSessionRevision: 0 } })
  assert.equal(result.countsTowardContract, true)
  assert.equal(result.loyaltyEntitlementUsed, false)
  assert.equal(state.read('loyaltyEntitlements/entitlement-expired').status, 'available')
  assert.equal(state.read('contracts/contract-1').usedSessions, 2)
  assert.equal(state.read('attendanceEvents/policy_request-expired-entitlement').type, 'charged_reschedule')
})

test('approved OFF cancels overlapping scheduled sessions without charging and extends the contract atomically', async () => {
  const offEntry = { studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', type: 'training' }
  const state = operationsFor({
    'leaveRequests/off-request-1': { status: 'pending', type: 'off', studentId: 'student-1', contractId: 'contract-1', startDate: '2026-08-24', endDate: '2026-08-30', durationDays: 7, reason: 'Đi công tác', submittedAtIso: '2026-08-19T00:00:00.000Z', revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', packageId: 'package-3m', startDate: '2026-08-01', endDate: '2026-10-31', totalSessions: 36, usedSessions: 3, revision: 0 },
    'packages/package-3m': { durationMonths: 3 },
    'sessionRequests/pending-during-off': { status: 'pending', type: 'reschedule', sessionId: 'off-session-1', studentId: 'student-1', contractId: 'contract-1', revision: 1 },
    'sessions/off-session-1': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-25', hour: 18, scheduleWeekId: '2026-08-24', slotId: 'T3-18', scheduleEntryId: 'schedule_2026-08-24-T3-18-student-1', revision: 1 },
    'sessions/outside-off': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-09-01', hour: 18, revision: 0 },
    'ptScheduleDrafts/branch-1_2026-08-24': { branchId: 'branch-1', weekId: '2026-08-24', status: 'published', revision: 2, publishedRevision: 2, schedule: { 'T3-18': [offEntry] } },
    'schedules/schedule_2026-08-24': { draftRevision: 2, schedule: { 'T3-18': [offEntry] } },
  })
  const result = await state.approveContractPauseRequest({ data: { requestId: 'off-request-1' } })
  assert.equal(result.durationDays, 7)
  assert.equal(result.newEndDate, '2026-11-07')
  assert.equal(result.cancelledSessionCount, 1)
  assert.equal(result.autoRejectedSessionRequestCount, 1)
  assert.equal(state.read('sessions/off-session-1').status, 'student_cancelled')
  assert.equal(state.read('sessionRequests/pending-during-off').status, 'rejected')
  assert.match(state.read('sessionRequests/pending-during-off').adminNote, /OFF đã được duyệt/)
  assert.equal(state.read('sessionRequests/pending-during-off').rejectionSource, 'contract_pause_approval')
  assert.equal(state.read('sessionRequestEvents/pause-off-request-1').type, 'session_requests_rejected_by_pause')
  assert.equal(state.read('sessions/off-session-1').countsTowardContract, false)
  assert.equal(state.read('sessions/outside-off').status, 'scheduled')
  assert.equal(state.read('contracts/contract-1').endDate, '2026-11-07')
  assert.deepEqual(state.read('ptScheduleDrafts/branch-1_2026-08-24').schedule, {})
  assert.deepEqual(state.read('schedules/schedule_2026-08-24').schedule, {})
  assert.equal(state.read('contractPauseEvents/off-request-1').durationDays, 7)
})

test('legacy approved leave without a type still consumes the three-month OFF allowance', async () => {
  const state = operationsFor({
    'settings/scheduleConfig': { offLimitsByDuration: { threeMonths: 1, sixMonths: 3, twelveMonths: 5 } },
    'leaveRequests/legacy-off': { status: 'approved', studentId: 'student-1', contractId: 'contract-1', startDate: '2026-08-01', endDate: '2026-08-05', reason: 'Nghỉ theo lịch cũ' },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', packageId: 'package-3m', startDate: '2026-08-01', endDate: '2026-10-31', totalSessions: 36, usedSessions: 3 },
    'packages/package-3m': { durationMonths: 3 },
  })

  await assert.rejects(
    state.createMyContractPauseRequest({ data: { contractId: 'contract-1', type: 'off', startDate: '2026-08-24', endDate: '2026-08-25', reason: 'Đi công tác', idempotencyKey: 'legacy-allowance-check' } }),
    (error) => error.code === 'failed-precondition' && error.details?.issueCode === 'OFF_ALLOWANCE_EXHAUSTED',
  )
  assert.equal(state.read('leaveRequests/student-student-account-legacy-allowance-check'), undefined)
})

test('admin approval rechecks the configured Sunday 09:00 OFF submission cutoff', async () => {
  const state = operationsFor({
    'leaveRequests/late-off': { status: 'pending', type: 'off', studentId: 'student-1', contractId: 'contract-1', startDate: '2026-08-24', endDate: '2026-08-25', reason: 'Gửi trễ', submittedAtIso: '2026-08-23T02:00:00.000Z', revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', packageId: 'package-3m', startDate: '2026-08-01', endDate: '2026-10-31', totalSessions: 36, usedSessions: 3 },
    'packages/package-3m': { durationMonths: 3 },
  })

  await assert.rejects(
    state.approveContractPauseRequest({ data: { requestId: 'late-off' } }),
    (error) => error.code === 'failed-precondition' && error.details?.issueCode === 'OFF_REGISTRATION_DEADLINE_PASSED',
  )
  assert.equal(state.read('leaveRequests/late-off').status, 'pending')
  assert.equal(state.read('contracts/contract-1').endDate, '2026-10-31')
})

test('late OFF can be submitted only as an explicit exception request', async () => {
  const state = operationsFor({
    'contracts/contract-late-request': { status: 'active', studentId: 'student-1', packageId: 'package-3m', startDate: '2026-08-01', endDate: '2026-10-31', totalSessions: 36, usedSessions: 3 },
    'packages/package-3m': { durationMonths: 3 },
  }, undefined, { now: () => new Date('2026-08-23T03:30:00.000Z') })

  await assert.rejects(
    state.createMyContractPauseRequest({ data: { contractId: 'contract-late-request', type: 'off', startDate: '2026-08-24', endDate: '2026-08-25', reason: 'Báo nghỉ đột xuất', idempotencyKey: 'late-normal' } }),
    (error) => error.code === 'failed-precondition' && error.details?.issueCode === 'OFF_REGISTRATION_DEADLINE_PASSED',
  )
  assert.equal(state.read('leaveRequests/student-student-account-late-normal'), undefined)

  const result = await state.createMyContractPauseRequest({ data: { contractId: 'contract-late-request', type: 'off', startDate: '2026-08-24', endDate: '2026-08-25', reason: 'Báo nghỉ đột xuất', idempotencyKey: 'late-exception', exception: true } })
  assert.equal(result.requiresExceptionApproval, true)
  assert.equal(result.exceptionType, 'late_off')
  assert.equal(result.lateByMinutes, 90)
  assert.equal(state.read('leaveRequests/student-student-account-late-exception').requiresExceptionApproval, true)
  assert.equal(state.read('leaveRequests/student-student-account-late-exception').status, 'pending')
})

test('OFF and preservation requests cannot extend beyond the current contract term', async () => {
  const state = operationsFor({
    'contracts/contract-end-boundary': { status: 'active', studentId: 'student-1', packageId: 'package-3m', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 36, usedSessions: 3 },
    'packages/package-3m': { durationMonths: 3 },
  })
  await assert.rejects(
    state.createMyContractPauseRequest({ data: { contractId: 'contract-end-boundary', type: 'off', startDate: '2026-08-30', endDate: '2026-09-02', reason: 'Đi công tác', idempotencyKey: 'end-boundary' } }),
    (error) => error.code === 'failed-precondition' && /nằm trong thời hạn hợp đồng/.test(error.message),
  )
  assert.equal(state.read('leaveRequests/student-student-account-end-boundary'), undefined)
})

test('admin approval of a late OFF exception requires an auditable reason and extends the contract', async () => {
  const state = operationsFor({
    'leaveRequests/late-exception-approval': {
      status: 'pending', type: 'off', studentId: 'student-1', accountUid: 'student-account', contractId: 'contract-late-approval',
      startDate: '2026-08-24', endDate: '2026-08-25', durationDays: 2, reason: 'Báo nghỉ đột xuất',
      submittedAtIso: '2026-08-23T03:30:00.000Z', cutoffAt: '2026-08-23T02:00:00.000Z', requiresExceptionApproval: true,
      exceptionType: 'late_off', lateByMinutes: 90, revision: 0,
    },
    'contracts/contract-late-approval': { status: 'active', studentId: 'student-1', packageId: 'package-3m', startDate: '2026-08-01', endDate: '2026-10-31', totalSessions: 36, usedSessions: 3 },
    'packages/package-3m': { durationMonths: 3 },
  })

  await assert.rejects(
    state.approveContractPauseRequest({ data: { requestId: 'late-exception-approval' } }),
    (error) => error.code === 'invalid-argument',
  )
  const result = await state.approveContractPauseRequest({ data: { requestId: 'late-exception-approval', exceptionReason: 'Khách báo nghỉ đột xuất sau khi đã chốt lịch.' } })
  assert.equal(result.exceptionApproved, true)
  assert.equal(state.read('leaveRequests/late-exception-approval').exceptionApprovalStatus, 'approved')
  assert.equal(state.read('leaveRequests/late-exception-approval').exceptionPolicyCode, 'LATE_OFF_AFTER_CUTOFF')
  assert.equal(state.read('leaveRequests/late-exception-approval').exceptionReason, 'Khách báo nghỉ đột xuất sau khi đã chốt lịch.')
  assert.equal(state.read('contracts/contract-late-approval').endDate, '2026-11-02')
  assert.equal(state.read('contractPauseEvents/late-exception-approval').exceptionApproved, true)
})

test('trainer cancellation keeps its provenance and never consumes the learner monthly allowance', async () => {
  const seed = {
    'sessionRequests/request-2': { status: 'pending', type: 'cancel', sessionId: 'session-2', studentId: 'student-2', contractId: 'contract-2', trainerId: 'trainer-2', requestedBy: 'trainer', originalDate: '2026-08-21', originalHour: 9, originalSessionRevision: 0, reason: 'HLV nghỉ' },
    'sessions/session-2': { status: 'scheduled', studentId: 'student-2', trainerId: 'trainer-2', contractId: 'contract-2', date: '2026-08-21', hour: 9, revision: 0 },
    'contracts/contract-2': { status: 'active', studentId: 'student-2', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 0 },
  }
  const approved = operationsFor(seed)
  const result = await approved.approveSessionRequest({ data: { requestId: 'request-2', expectedSessionRevision: 0 } })
  assert.equal(approved.read('sessions/session-2').status, 'trainer_cancelled')
  assert.equal(approved.read('sessionRequests/request-2').requestedBy, 'trainer')
  assert.equal(result.countsTowardContract, false)
  assert.equal(approved.paths().some((path) => path.startsWith('ptPolicyUsage/')), false)
})

test('PT can move a charged but unconfirmed session without charging the replacement again', async () => {
  const state = operationsFor({
    'sessionRequests/request-charged-trainer': {
      status: 'pending', type: 'reschedule', sessionId: 'session-charged-trainer', studentId: 'student-charged',
      contractId: 'contract-charged', trainerId: 'trainer-charged', requestedBy: 'trainer',
      originalDate: '2026-08-22', originalHour: 8, originalSessionRevision: 2,
      newDate: '2026-08-21', newHour: 10, reason: 'Điều chỉnh lịch cho học viên',
    },
    'sessions/session-charged-trainer': {
      status: 'scheduled', scheduleStatus: 'scheduled', billingStatus: 'charged', attendanceStatus: 'pending',
      billingEventId: 'session-charged-trainer', attendanceEventId: 'session-charged-trainer',
      studentId: 'student-charged', trainerId: 'trainer-charged', contractId: 'contract-charged', branchId: 'branch-1',
      date: '2026-08-22', hour: 8, revision: 2,
    },
    'sessionBillingEvents/session-charged-trainer': { billingStatus: 'charged', sessionId: 'session-charged-trainer' },
    'attendanceEvents/session-charged-trainer': { billingStatus: 'charged', attendanceStatus: 'pending', sessionId: 'session-charged-trainer' },
    'contracts/contract-charged': {
      status: 'active', studentId: 'student-charged', trainerId: 'trainer-charged', branchId: 'branch-1',
      startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 1,
    },
    'students/student-charged': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T6-10'] },
    'trainers/trainer-charged': { status: 'active', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T6-10'], slotCapacity: 2 },
  }, async () => ({ uid: 'admin-1' }), { now: () => new Date('2026-08-25T03:00:00.000Z') })

  const result = await state.approveSessionRequest({ data: { requestId: 'request-charged-trainer', expectedSessionRevision: 2 } })
  const session = state.read('sessions/session-charged-trainer')
  assert.equal(result.type, 'reschedule')
  assert.equal(session.date, '2026-08-21')
  assert.equal(session.hour, 10)
  assert.equal(session.billingStatus, 'charged')
  assert.equal(session.attendanceStatus, 'pending')
  assert.equal(state.read('contracts/contract-charged').usedSessions, 1)
  assert.equal(state.read('sessionRequests/request-charged-trainer').status, 'approved')
})

test('reschedule collision rejects atomically when the learner already has another hour on the same day', async () => {
  const state = operationsFor({
    'sessionRequests/request-3': { status: 'pending', type: 'reschedule', sessionId: 'session-3', studentId: 'student-3', contractId: 'contract-3', originalDate: '2026-08-22', originalHour: 7, originalSessionRevision: 4, newDate: '2026-08-21', newHour: 10, submittedAtIso: '2026-08-20T00:00:00.000Z', policyMonth: '2026-08' },
    'sessions/session-3': { status: 'scheduled', studentId: 'student-3', trainerId: 'trainer-3', contractId: 'contract-3', date: '2026-08-22', hour: 7, revision: 4 },
    'contracts/contract-3': { status: 'active', studentId: 'student-3', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 0 },
    'trainers/trainer-3': { status: 'active', availableSlots: ['T6-10'] },
    'students/student-3': { status: 'active', isScheduleConfirmed: true, availableSlots: ['T6-10'] },
    'sessions/conflict': { status: 'scheduled', studentId: 'student-3', trainerId: 'trainer-4', date: '2026-08-21T00:00:00.000Z', hour: 9, revision: 0 },
  })
  await assert.rejects(
    state.approveSessionRequest({ data: { requestId: 'request-3', expectedSessionRevision: 4 } }),
    (error) => error.code === 'already-exists',
  )
  assert.equal(state.read('sessionRequests/request-3').status, 'pending')
  assert.equal(state.read('sessions/session-3').date, '2026-08-22')
  assert.equal(state.paths().filter((path) => path.startsWith('sessionEvents/')).length, 0)
})

test('stale request revision and inactive compensation contract fail without partial writes', async () => {
  const stale = operationsFor({
    'sessionRequests/request-4': { status: 'pending', type: 'cancel', sessionId: 'session-4', studentId: 'student-4', contractId: 'contract-4', originalDate: '2026-08-23', originalHour: 11, originalSessionRevision: 1 },
    'sessions/session-4': { status: 'scheduled', studentId: 'student-4', trainerId: 'trainer-4', date: '2026-08-23', hour: 11, revision: 2 },
    'contracts/contract-4': { status: 'active', studentId: 'student-4', startDate: '2026-08-01', endDate: '2026-08-31' },
  })
  await assert.rejects(
    stale.approveSessionRequest({ data: { requestId: 'request-4', expectedSessionRevision: 2 } }),
    (error) => error.code === 'aborted',
  )
  assert.equal(stale.read('sessionRequests/request-4').status, 'pending')
  assert.equal(stale.read('sessions/session-4').status, 'scheduled')

  const inactive = operationsFor({
    'sessionRequests/request-5': { status: 'pending', type: 'cancel', sessionId: 'session-5', studentId: 'student-5', contractId: 'contract-5', originalDate: '2026-08-24', originalHour: 12, originalSessionRevision: 0 },
    'sessions/session-5': { status: 'scheduled', studentId: 'student-5', trainerId: 'trainer-5', date: '2026-08-24', hour: 12, revision: 0 },
    'contracts/contract-5': { status: 'expired', studentId: 'student-5', startDate: '2026-08-01', endDate: '2026-08-31' },
  })
  await assert.rejects(
    inactive.approveSessionRequest({ data: { requestId: 'request-5', expectedSessionRevision: 0, extensionDays: 2 } }),
    (error) => error.code === 'failed-precondition',
  )
  assert.equal(inactive.read('sessionRequests/request-5').status, 'pending')
  assert.equal(inactive.read('sessions/session-5').status, 'scheduled')

  const overlapping = operationsFor({
    'sessionRequests/request-5b': { status: 'pending', type: 'cancel', sessionId: 'session-5b', studentId: 'student-5b', contractId: 'contract-5b-a', originalDate: '2026-08-24', originalHour: 12, originalSessionRevision: 0 },
    'sessions/session-5b': { status: 'scheduled', studentId: 'student-5b', trainerId: 'trainer-5', date: '2026-08-24', hour: 12, revision: 0 },
    'contracts/contract-5b-a': { status: 'active', studentId: 'student-5b', startDate: '2026-08-01', endDate: '2026-08-31' },
    'contracts/contract-5b-b': { status: 'active', studentId: 'student-5b', startDate: '2026-08-15', endDate: '2026-09-15' },
  })
  await assert.rejects(
    overlapping.approveSessionRequest({ data: { requestId: 'request-5b', expectedSessionRevision: 0, extensionDays: 2 } }),
    (error) => error.code === 'failed-precondition',
  )
  assert.equal(overlapping.read('sessionRequests/request-5b').status, 'pending')
  assert.equal(overlapping.read('sessions/session-5b').status, 'scheduled')
})

test('rejection is transactional and admin authorization is enforced before lifecycle writes', async () => {
  const state = operationsFor({
    'sessionRequests/request-6': { status: 'pending', type: 'cancel', sessionId: 'session-6', studentId: 'student-6' },
    'sessions/session-6': { status: 'scheduled', studentId: 'student-6', trainerId: 'trainer-6', date: '2026-08-25', hour: 13, revision: 0 },
  })
  const first = await state.rejectSessionRequest({ data: { requestId: 'request-6', reason: 'Không đủ điều kiện' } })
  assert.equal(first.unchanged, false)
  assert.equal(state.read('sessionRequests/request-6').status, 'rejected')
  assert.ok(state.paths().some((path) => path.startsWith('sessionRequestEvents/')))
  const retry = await state.rejectSessionRequest({ data: { requestId: 'request-6', reason: 'Không đủ điều kiện' } })
  assert.equal(retry.unchanged, true)

  const unauthorized = operationsFor({
    'sessions/session-7': { status: 'scheduled', studentId: 'student-7', trainerId: 'trainer-7', date: '2026-08-25', hour: 14, revision: 0 },
  }, async () => {
    const error = new Error('permission denied')
    error.code = 'permission-denied'
    throw error
  })
  await assert.rejects(
    unauthorized.cancelSession({ data: { sessionId: 'session-7', expectedRevision: 0, type: 'student_cancelled', reason: 'test' } }),
    (error) => error.code === 'permission-denied',
  )
  assert.equal(unauthorized.read('sessions/session-7').status, 'scheduled')
})

test('rescheduling preserves an active operational status and an audited history', () => {
  assert.match(source, /function isActiveSessionStatus/)
  assert.match(source, /type: 'rescheduled'/)
  assert.match(source, /previousSchedule: FieldValue\.arrayUnion/)
  assert.doesNotMatch(source, /status:\s*'rescheduled'/)
})

test('admin request approval uses only the atomic callable for lifecycle changes', () => {
  assert.match(service, /export function approveSessionRequest/)
  assert.match(service, /export function rejectSessionRequest/)
  assert.match(requestCenter, /await approveSessionRequest\(/)
  assert.match(requestCenter, /await rejectSessionRequest\(/)
  assert.doesNotMatch(requestCenter, /updateSessionRequest\s*\(/)
  assert.doesNotMatch(requestCenter, /\b(?:updateSession|deleteSession|cancelSession|rescheduleSession)\s*\(/)
  assert.doesNotMatch(requestCenter, /await updateContract\(/)
})

test('leave approval and session requests use server transactions while remaining unsafe lifecycle actions stay disabled', () => {
  assert.match(requestCenter, /await approveContractPauseRequest\(/)
  assert.match(requestCenter, /await rejectContractPauseRequest\(/)
  assert.match(functionsIndex, /exports\.createMyContractPauseRequestRegional/)
  assert.match(functionsIndex, /exports\.approveContractPauseRequestRegional/)
  assert.match(service, /firebaseScheduleOptimizerFunctions/)
  assert.doesNotMatch(requestCenter, /\b(?:updateSession|deleteSession|cancelSession|rescheduleSession)\s*\(/)
  assert.match(scheduler, /studentSessionActionUnavailable/)
  assert.doesNotMatch(scheduler, /\b(?:updateSession|deleteSession)\s*\(/)
  assert.match(scheduler, /validatePtScheduleDraft/)
  assert.match(scheduler, /publishPtSchedule/)
  assert.doesNotMatch(scheduler, /\baddSession\s*\(/)
  assert.match(contractWorkspace, /await mutateStudent360Contract\(/)
  assert.doesNotMatch(contractWorkspace, /\b(?:addSession|updateSession|deleteSession|setDoc|updateDoc|deleteDoc)\s*\(/)
})

test('request history is bounded, admin-scoped and moved into the unified training history workspace', () => {
  const listing = source.match(/const listPtOperationsRequests[\s\S]*?\n  const createMySessionRequest/)?.[0] ?? ''
  assert.match(source, /const OPERATIONS_REQUEST_HISTORY_LIMIT = 500/)
  assert.match(listing, /await authorizeAdmin\(request, db\)/)
  assert.match(listing, /sessionRevision/)
  assert.match(listing, /studentName/)
  assert.match(listing, /packageName/)
  assert.match(listing, /adminNote/)
  assert.match(requestCenter, /listPtOperationsRequests/)
  assert.match(requestCenter, /approveSessionRequest/)
  assert.match(requestCenter, /approveContractPauseRequest/)
  assert.match(historyWorkspace, /Lịch sử học viên/)
  assert.match(historyWorkspace, /Lịch dạy PT/)
  assert.match(historyWorkspace, /Đổi \/ Hủy/)
  assert.match(historyWorkspace, /OFF \/ Bảo lưu/)
})

test('request history resolves operational identities and current session revision without exposing mutable documents', async () => {
  const state = operationsFor({
    'students/student-history': { name: 'Lan Aura', phone: '0900000000' },
    'trainers/trainer-history': { name: 'PT Mai' },
    'contracts/contract-history': { packageName: 'Gói 3 Tháng' },
    'sessions/session-history': { trainerId: 'trainer-history', revision: 7, hour: 10 },
    'sessionRequests/request-history': {
      studentId: 'student-history',
      trainerId: 'trainer-history',
      contractId: 'contract-history',
      sessionId: 'session-history',
      type: 'reschedule',
      status: 'pending',
      originalDate: '2026-08-27',
      originalHour: 10,
      newDate: '2026-08-28',
      newHour: 11,
      requestedBy: 'student',
      reason: 'Đổi lịch công việc',
      createdAt: '2026-08-26T03:00:00.000Z',
    },
  })
  const result = await state.listPtOperationsRequests({ data: { kind: 'session' } })
  assert.equal(result.summary.pending, 1)
  assert.equal(result.records[0].studentName, 'Lan Aura')
  assert.equal(result.records[0].trainerName, 'PT Mai')
  assert.equal(result.records[0].packageName, 'Gói 3 Tháng')
  assert.equal(result.records[0].sessionRevision, 7)
  assert.equal(result.records[0].newHour, 11)
})

test('unified request history merges session and pause queues in newest-first order', async () => {
  const state = operationsFor({
    'students/student-history': { name: 'Lan Aura', phone: '0900000000' },
    'students/student-history-2': { name: 'Mai Aura', phone: '0911111111' },
    'contracts/contract-history': { packageName: 'Gói 3 Tháng' },
    'contracts/contract-history-2': { packageName: 'Gói 6 Tháng' },
    'sessions/session-history': { trainerId: 'trainer-history', revision: 7, hour: 10 },
    'sessionRequests/request-history': {
      studentId: 'student-history', contractId: 'contract-history', sessionId: 'session-history', type: 'cancel', status: 'pending', createdAt: '2026-08-26T03:00:00.000Z',
    },
    'leaveRequests/pause-history': {
      studentId: 'student-history-2', contractId: 'contract-history-2', type: 'preservation', status: 'approved', startDate: '2026-08-28', endDate: '2026-09-20', submittedAtIso: '2026-08-27T03:00:00.000Z',
    },
  })
  const result = await state.listPtOperationsRequests({ data: { kind: 'all' } })
  assert.equal(result.kind, 'all')
  assert.equal(result.summary.total, 2)
  assert.deepEqual(result.records.map((item) => item.kind), ['pause', 'session'])
  assert.equal(result.records[0].type, 'preservation')
  assert.equal(result.records[1].type, 'cancel')
})

test('new branch schedule keeps learners in a dedicated operational tab without restoring request tabs', () => {
  assert.match(`${branchScheduleModel}\n${branchScheduleWorkspace}`, /WorkspaceTab = 'matrix' \| 'opportunities' \| 'students' \| 'warnings' \| 'history'/)
  assert.match(branchScheduleWorkspace, /Kho ca/)
  assert.match(branchScheduleWorkspace, /Tiến độ xếp lịch/)
  assert.match(branchScheduleWorkspace, /Thiếu lịch rảnh/)
  assert.match(branchScheduleWorkspace, /Lịch sử & khôi phục/)
  assert.doesNotMatch(branchScheduleWorkspace, /SessionRequestApprovals|LeaveApprovals/)
})
