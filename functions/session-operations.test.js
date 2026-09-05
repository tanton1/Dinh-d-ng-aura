const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { autoConfirmOverduePtAttendance, chargeDuePtSessions, createSessionOperationFunctions } = require('./session-operations')

const root = join(__dirname, '..')
const source = readFileSync(join(__dirname, 'session-operations.js'), 'utf8')
const service = readFileSync(join(root, 'src', 'services', 'sessionOperationsService.ts'), 'utf8')
const requestApprovals = readFileSync(join(root, 'src', 'components', 'admin', 'pt', 'SessionRequestApprovals.tsx'), 'utf8')
const leaveApprovals = readFileSync(join(root, 'src', 'components', 'admin', 'pt', 'LeaveApprovals.tsx'), 'utf8')
const orphanChecker = readFileSync(join(root, 'src', 'components', 'admin', 'pt', 'OrphanedSessionChecker.tsx'), 'utf8')
const scheduler = readFileSync(join(root, 'src', 'components', 'schedule', 'SchedulerWrapper.tsx'), 'utf8')
const studentDetail = readFileSync(join(root, 'src', 'components', 'admin', 'pt', 'StudentDetail.tsx'), 'utf8')
const trainerOperations = readFileSync(join(__dirname, 'pt-operations-v2.js'), 'utf8')
const requestCenter = readFileSync(join(root, 'src', 'components', 'admin', 'pt', 'OperationsRequestCenter.tsx'), 'utf8')
const historyWorkspace = readFileSync(join(root, 'src', 'components', 'admin', 'pt', 'TrainingHistoryWorkspace.tsx'), 'utf8')
const historyPanel = readFileSync(join(root, 'src', 'components', 'admin', 'pt', 'TrainingHistoryPanel.tsx'), 'utf8')
const branchScheduleWorkspace = readFileSync(join(root, 'src', 'components', 'schedule', 'BranchScheduleWorkspace.tsx'), 'utf8')

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
  const matches = (data, filter) => {
    if (filter.operator === '==') return data[filter.field] === filter.value
    if (filter.operator === '>=') return data[filter.field] >= filter.value
    if (filter.operator === '<') return data[filter.field] < filter.value
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
      .filter(([, data]) => target.filters.every((filter) => matches(data, filter)))
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
    onCall: (handler) => handler,
    authorizeAdmin,
    authorizeStudent: options.authorizeStudent || (async () => ({ uid: 'student-account', legacyStaffId: 'student-1', accessRole: 'student' })),
    now: options.now || (() => new Date('2026-08-20T03:00:00.000Z')),
  })
  return { ...state, ...operations }
}

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
  assert.match(approval, /usedSessions: FieldValue\.increment\(1\)/)
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

test('collision checks cover trainer capacity, student double booking, legacy ISO dates, and bounded query overflow', () => {
  assert.match(source, /const DAILY_SESSION_QUERY_LIMIT = 200/)
  assert.match(source, /function dailySessionsQuery/)
  assert.match(source, /\.where\('date', '>=', targetDate\)/)
  assert.match(source, /\.where\('date', '<', nextDateKey\(targetDate\)\)/)
  assert.match(source, /dailySessionsQuery\(db, 'trainerId'/)
  assert.match(source, /dailySessionsQuery\(db, 'studentId'/)
  assert.match(source, /snapshot\.size >= DAILY_SESSION_QUERY_LIMIT/)
  assert.match(source, /activeHourDocuments\(trainerDay, newHour, \[sessionId\]\)\.length >= 2/)
  assert.match(source, /activeHourDocuments\(studentDay, newHour, \[sessionId\]\)\.length > 0/)
  assert.match(source, /firstTargetStudentDay/)
  assert.match(source, /secondTargetStudentDay/)
})

test('trainer-created requests carry immutable origin and session revision provenance', () => {
  const creation = trainerOperations.match(/const requestSessionChange[\s\S]*?\n  const listMyQuotes/)?.[0] ?? ''
  assert.match(creation, /requestedBy: 'trainer'/)
  assert.match(creation, /originalSessionRevision: Number\(session\.data\(\)\.revision \|\| 0\)/)
  assert.match(creation, /originalHour/)
  assert.match(creation, /assertSessionChangeDeadline/)
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

test('automatic charge backfills every elapsed session in the current Vietnam week', async () => {
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
  assert.equal(summary.charged, 2)
  assert.equal(state.read('sessions/monday-due').attendanceStatus, 'pending')
  assert.equal(state.read('sessions/today-due').billingStatus, 'charged')
  assert.equal(state.read('sessions/today-future').billingStatus, undefined)
  assert.equal(state.read('sessions/previous-week').billingStatus, undefined)
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
      newDate: '2026-08-25', newHour: 10, newTrainerId: 'trainer-1', submittedAtIso: '2026-08-20T00:00:00.000Z', policyMonth: '2026-08',
    },
    'sessions/session-entitlement': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-22', hour: 7, revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 1, totalPrice: 1_200_000 },
    'students/student-1': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T3-10'] },
    'trainers/trainer-1': { status: 'active', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T3-10'], slotCapacity: 2 },
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
      newDate: '2026-08-25', newHour: 10, newTrainerId: 'trainer-1', submittedAtIso: '2026-08-20T00:00:00.000Z', policyMonth: '2026-08',
    },
    'sessions/session-expired-entitlement': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', branchId: 'branch-1', date: '2026-08-22', hour: 7, revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 1, totalPrice: 1_200_000 },
    'students/student-1': { status: 'active', branchId: 'branch-1', isScheduleConfirmed: true, availableSlots: ['T3-10'] },
    'trainers/trainer-1': { status: 'active', branchId: 'branch-1', employmentType: 'full_time', availableSlots: ['T3-10'], slotCapacity: 2 },
    'loyaltyEntitlements/entitlement-expired': { studentId: 'student-1', type: 'extra_reschedule', status: 'available', expiresAt: '2026-08-19T16:59:59.000Z' },
  }, async () => ({ uid: 'admin-1' }), { now: () => new Date('2026-08-20T03:00:00.000Z') })

  const result = await state.approveSessionRequest({ data: { requestId: 'request-expired-entitlement', expectedSessionRevision: 0 } })
  assert.equal(result.countsTowardContract, true)
  assert.equal(result.loyaltyEntitlementUsed, false)
  assert.equal(state.read('loyaltyEntitlements/entitlement-expired').status, 'available')
  assert.equal(state.read('contracts/contract-1').usedSessions.operand, 1)
  assert.equal(state.read('attendanceEvents/policy_request-expired-entitlement').type, 'charged_reschedule')
})

test('approved OFF cancels overlapping scheduled sessions without charging and extends the contract atomically', async () => {
  const state = operationsFor({
    'leaveRequests/off-request-1': { status: 'pending', type: 'off', studentId: 'student-1', contractId: 'contract-1', startDate: '2026-08-24', endDate: '2026-08-30', durationDays: 7, reason: 'Đi công tác', submittedAtIso: '2026-08-19T00:00:00.000Z', revision: 0 },
    'contracts/contract-1': { status: 'active', studentId: 'student-1', packageId: 'package-3m', startDate: '2026-08-01', endDate: '2026-10-31', totalSessions: 36, usedSessions: 3, revision: 0 },
    'packages/package-3m': { durationMonths: 3 },
    'sessions/off-session-1': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-08-25', hour: 18, revision: 1 },
    'sessions/outside-off': { status: 'scheduled', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-09-01', hour: 18, revision: 0 },
  })
  const result = await state.approveContractPauseRequest({ data: { requestId: 'off-request-1' } })
  assert.equal(result.durationDays, 7)
  assert.equal(result.newEndDate, '2026-11-07')
  assert.equal(result.cancelledSessionCount, 1)
  assert.equal(state.read('sessions/off-session-1').status, 'student_cancelled')
  assert.equal(state.read('sessions/off-session-1').countsTowardContract, false)
  assert.equal(state.read('sessions/outside-off').status, 'scheduled')
  assert.equal(state.read('contracts/contract-1').endDate, '2026-11-07')
  assert.equal(state.read('contractPauseEvents/off-request-1').durationDays, 7)
})

test('legacy approved leave without a type still consumes the three-month OFF allowance', async () => {
  const state = operationsFor({
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

test('admin approval rechecks the Sunday 10:00 OFF submission cutoff', async () => {
  const state = operationsFor({
    'leaveRequests/late-off': { status: 'pending', type: 'off', studentId: 'student-1', contractId: 'contract-1', startDate: '2026-08-24', endDate: '2026-08-25', reason: 'Gửi trễ', submittedAtIso: '2026-08-23T03:00:00.000Z', revision: 0 },
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

test('reschedule collision rejects atomically for a legacy ISO-date student booking', async () => {
  const state = operationsFor({
    'sessionRequests/request-3': { status: 'pending', type: 'reschedule', sessionId: 'session-3', studentId: 'student-3', contractId: 'contract-3', originalDate: '2026-08-22', originalHour: 7, originalSessionRevision: 4, newDate: '2026-08-25', newHour: 10, submittedAtIso: '2026-08-20T00:00:00.000Z', policyMonth: '2026-08' },
    'sessions/session-3': { status: 'scheduled', studentId: 'student-3', trainerId: 'trainer-3', contractId: 'contract-3', date: '2026-08-22', hour: 7, revision: 4 },
    'contracts/contract-3': { status: 'active', studentId: 'student-3', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 0 },
    'trainers/trainer-3': { status: 'active', availableSlots: ['T3-10'] },
    'students/student-3': { status: 'active', isScheduleConfirmed: true, availableSlots: ['T3-10'] },
    'sessions/conflict': { status: 'scheduled', studentId: 'student-3', trainerId: 'trainer-4', date: '2026-08-25T00:00:00.000Z', hour: 10, revision: 0 },
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
  assert.match(requestApprovals, /await approveSessionRequest\(/)
  assert.match(requestApprovals, /await rejectSessionRequest\(/)
  assert.doesNotMatch(requestApprovals, /updateSessionRequest\s*\(/)
  assert.doesNotMatch(requestApprovals, /\b(?:updateSession|deleteSession|cancelSession|rescheduleSession)\s*\(/)
  assert.doesNotMatch(requestApprovals, /await updateContract\(/)
})

test('leave approval and session requests use server transactions while remaining unsafe lifecycle actions stay disabled', () => {
  assert.match(leaveApprovals, /approveContractPauseRequest/)
  assert.match(leaveApprovals, /rejectContractPauseRequest/)
  assert.doesNotMatch(leaveApprovals, /\b(?:updateSession|deleteSession|cancelSession|rescheduleSession)\s*\(/)
  assert.match(orphanChecker, /Không thể xóa trực tiếp buổi tập/)
  assert.doesNotMatch(orphanChecker, /deleteSession\s*\(/)
  assert.match(scheduler, /studentSessionActionUnavailable/)
  assert.doesNotMatch(scheduler, /\b(?:updateSession|deleteSession)\s*\(/)
  assert.match(scheduler, /validatePtScheduleDraft/)
  assert.match(scheduler, /publishPtSchedule/)
  assert.doesNotMatch(scheduler, /\baddSession\s*\(/)
  assert.match(studentDetail, /manualAttendanceUnavailable/)
  assert.doesNotMatch(studentDetail, /\baddSession\s*\(/)
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

test('new branch schedule keeps learners in a dedicated operational tab without restoring request tabs', () => {
  assert.match(branchScheduleWorkspace, /WorkspaceTab = 'matrix' \| 'students' \| 'warnings' \| 'history'/)
  assert.match(branchScheduleWorkspace, /Tiến độ xếp lịch/)
  assert.match(branchScheduleWorkspace, /Thiếu lịch rảnh/)
  assert.match(branchScheduleWorkspace, /Lịch sử & khôi phục/)
  assert.doesNotMatch(branchScheduleWorkspace, /SessionRequestApprovals|LeaveApprovals/)
})
