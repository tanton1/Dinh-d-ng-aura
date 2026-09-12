const assert = require('node:assert/strict')
const test = require('node:test')
const {
  addCalendarMonths,
  activeContract,
  buildHealthScore,
  contractInstallments,
  contractAssigneeIssues,
  contractMutationTitle,
  contractWorkspaceTrainerDirectory,
  contractUsage,
  permissionsFor,
  normalizeTimelineEvents,
  nutritionActivityDetailRecord,
  redactProjection,
  safeTimelineEvent,
  sessionDateTimeMillis,
  sourceTimelineEvents,
  studentAccountLink,
  studentIdFromAccountUid,
  studentAccountProfile,
  uniqueProgressDocuments,
  uniqueProgressPhotos,
  timelineCursor,
  normalizeProgressCheckInInput,
  decodeProgressPhotoDataUrl,
} = require('./student-360')

test('Student 360 selects contracts by effective dates instead of stale stored status', () => {
  const contracts = [
    { id: 'stale-active', status: 'active', startDate: '2026-01-01', endDate: '2026-09-08' },
    { id: 'current-future-stored-active', status: 'future', startDate: '2026-09-09', endDate: '2026-10-09' },
    { id: 'later-future', status: 'active', startDate: '2026-11-01', endDate: '2026-12-01' },
  ]
  assert.equal(activeContract(contracts, '2026-09-09').id, 'current-future-stored-active')
})

test('Student 360 chooses the nearest future contract when no contract is active', () => {
  const contracts = [
    { id: 'later', status: 'active', startDate: '2026-12-01', endDate: '2027-01-01' },
    { id: 'nearest', status: 'future', startDate: '2026-10-01', endDate: '2026-11-01' },
  ]
  assert.equal(activeContract(contracts, '2026-09-09').id, 'nearest')
})

test('CRM timeline treats an omitted first-page cursor as the newest boundary', () => {
  assert.equal(timelineCursor(null), Number.MAX_SAFE_INTEGER)
  assert.equal(timelineCursor(undefined), Number.MAX_SAFE_INTEGER)
  assert.equal(timelineCursor(''), Number.MAX_SAFE_INTEGER)
  assert.equal(timelineCursor(1_725_000_000_123_456), 1_725_000_000_123_456)
  assert.equal(timelineCursor('1725000000123456'), 1_725_000_000_123_456)
})

test('CRM timeline converts scheduled hours from Vietnam local time without crossing dates', () => {
  assert.equal(new Date(sessionDateTimeMillis('2026-09-05', 15)).toISOString(), '2026-09-05T08:00:00.000Z')
  assert.equal(new Date(sessionDateTimeMillis('2026-09-05', '17:30')).toISOString(), '2026-09-05T10:30:00.000Z')
  assert.equal(new Date(sessionDateTimeMillis('2026-09-05', null)).toISOString(), '2026-09-05T05:00:00.000Z')
})

test('contract month duration clamps month-end dates instead of drifting into a later month', () => {
  assert.equal(addCalendarMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addCalendarMonths('2028-01-31', 1), '2028-02-29')
})

test('progress migration mirrors are collapsed before Student 360 calculations', () => {
  const metrics = uniqueProgressDocuments([
    { id: 'legacy-1', date: '2026-09-01', weightKg: 60, waistCm: 70 },
    { id: 'canonical-1', date: '2026-09-01', weightKg: 60, waistCm: 70 },
    { id: 'canonical-2', date: '2026-09-03', weightKg: 59.5, waistCm: 69 },
  ])
  assert.equal(metrics.length, 2, 'mirrored measurements with different legacy IDs collapse')

  const sameMeasurement = uniqueProgressDocuments([
    { date: '2026-09-01', weightKg: 60, waistCm: 70 },
    { date: '2026-09-01', weightKg: 60, waistCm: 70 },
  ])
  assert.equal(sameMeasurement.length, 1)

  const photos = uniqueProgressPhotos([
    { id: 'photo-1', date: '2026-09-01' },
    { id: 'photo-1', date: '2026-09-01' },
    { id: 'photo-2', date: '2026-09-02' },
  ])
  assert.deepEqual(photos.map((item) => item.id), ['photo-1', 'photo-2'])
})

test('one canonical progress check-in is counted and rendered once across projections', () => {
  const metrics = uniqueProgressDocuments([
    { id: 'checkin-1', checkInId: 'checkin-1', date: '2026-09-01', weightKg: 60, waistCm: 70 },
    { id: 'checkin-1', checkInId: 'checkin-1', date: '2026-09-01', weightKg: 60 },
    { id: 'checkin-1', checkInId: 'checkin-1', date: '2026-09-01', bodyFatPercentage: 25 },
  ])
  assert.equal(metrics.length, 1)
  assert.equal(metrics[0].bodyFatPercentage, 25)

  const photos = uniqueProgressPhotos([
    { id: 'checkin-1-front', checkInId: 'checkin-1', date: '2026-09-01', imageUrl: 'https://example.com/front.jpg', angle: 'front' },
    { id: 'checkin-1-back', checkInId: 'checkin-1', date: '2026-09-01', imageUrl: 'https://example.com/back.jpg', angle: 'back' },
    { id: 'checkin-1', checkInId: 'checkin-1', date: '2026-09-01', photos: [
      { imageUrl: 'https://example.com/front.jpg', angle: 'front' },
      { imageUrl: 'https://example.com/back.jpg', angle: 'back' },
    ] },
  ])
  assert.equal(photos.length, 1)
  assert.equal(photos[0].images.length, 2)

  const timeline = sourceTimelineEvents('student-1', {
    profile: {}, contracts: [], sessions: [], workoutLogs: [], leaveRequests: [], sessionRequests: [], mealLogs: [], mealReviews: [], dailyCheckins: [], payments: [], renewals: [],
    bodyMetrics: metrics,
    progressPhotos: photos,
  })
  const progressEvents = timeline.filter((event) => event.type === 'progress')
  assert.equal(progressEvents.length, 1)
  assert.equal(progressEvents[0].title, 'Ghi nhận tiến độ')
  assert.equal(progressEvents[0].metadata.photoCount, 2)
})

test('contract workspace exposes named, immutable CRM actions', () => {
  assert.equal(contractMutationTitle('edit'), 'Đã cập nhật hợp đồng')
  assert.equal(contractMutationTitle('add_sessions'), 'Đã mua thêm buổi')
  assert.equal(contractMutationTitle('freeze'), 'Đã bảo lưu hợp đồng')
  assert.equal(contractMutationTitle('reopen'), 'Đã mở lại hợp đồng')
  assert.equal(contractMutationTitle('cancel'), 'Đã hủy hợp đồng')
})

test('contract assignee validation identifies hidden legacy links by name and reason', () => {
  const snapshot = (value) => ({ exists: true, data: () => value })
  assert.deepEqual(contractAssigneeIssues(
    ['same', 'moved', 'inactive', 'missing'],
    [
      snapshot({ name: 'PT cùng cơ sở', branchId: 'branch-a', status: 'active' }),
      snapshot({ name: 'PT đã chuyển cơ sở', branchId: 'branch-b', status: 'active' }),
      snapshot({ name: 'PT đã nghỉ', branchId: 'branch-a', status: 'inactive' }),
      { exists: false },
    ],
    'branch-a',
  ), [
    { id: 'moved', name: 'PT đã chuyển cơ sở', issue: 'branch_mismatch', branchId: 'branch-b' },
    { id: 'inactive', name: 'PT đã nghỉ', issue: 'inactive', branchId: 'branch-a' },
    { id: 'missing', name: 'PT/coach không còn tồn tại', issue: 'not_found', branchId: null },
  ])
})

test('contract workspace returns active candidates and keeps invalid current assignees explainable', () => {
  const document = (id, value) => ({ id, data: () => value })
  const trainers = contractWorkspaceTrainerDirectory({
    trainerDocuments: [
      document('active-local', { name: 'PT An', branchId: 'branch-a', status: 'active' }),
      document('inactive-assigned', { name: 'PT Bình', branchId: 'branch-a', status: 'inactive' }),
      document('moved-assigned', { name: 'PT Chi', branchId: 'branch-b', status: 'active' }),
      document('out-of-scope', { name: 'PT Dũng', branchId: 'branch-b', status: 'active' }),
    ],
    branchDocuments: [
      document('branch-a', { name: 'Aura Hải Châu' }),
      document('branch-b', { name: 'Aura Sơn Trà' }),
    ],
    contracts: [{ trainerIds: ['inactive-assigned', 'moved-assigned'] }],
    allowedBranchIds: ['branch-a'],
    studentBranchId: 'branch-a',
  })

  assert.deepEqual(trainers.map((item) => item.id), ['active-local', 'inactive-assigned', 'moved-assigned'])
  assert.deepEqual(trainers.find((item) => item.id === 'inactive-assigned'), {
    id: 'inactive-assigned',
    name: 'PT Bình',
    branchId: 'branch-a',
    branchName: 'Aura Hải Châu',
    status: 'inactive',
  })
  assert.equal(trainers.find((item) => item.id === 'moved-assigned').branchName, 'Aura Sơn Trà')
})

test('contract installment edits preserve posted history and reconcile outstanding debt', () => {
  const previous = [
    { id: 'paid-1', amount: 2_000_000, date: '2026-09-01', status: 'paid' },
    { id: 'pending-1', amount: 3_000_000, date: '2026-10-01', status: 'pending' },
  ]
  const result = contractInstallments(previous, previous, 3_000_000)
  assert.equal(result.length, 2)
  assert.throws(() => contractInstallments([
    { id: 'paid-1', amount: 1_000_000, date: '2026-09-01', status: 'paid' },
    previous[1],
  ], previous, 3_000_000), /không thể chỉnh sửa/i)
  assert.throws(() => contractInstallments([
    previous[0],
    { ...previous[1], amount: 2_000_000 },
  ], previous, 3_000_000), /công nợ còn lại/i)
})

test('student profile lookup requires the canonical accountUid and never assumes studentId is an Auth uid', async () => {
  const reads = []
  const db = {
    doc(path) {
      reads.push(path)
      return { get: async () => ({ exists: true, id: path.split('/').at(-1), data: () => ({ displayName: 'Aura learner' }) }) }
    },
  }

  const missing = await studentAccountProfile(db, { id: 'student-document-id' })
  assert.deepEqual(missing, { accountUid: '', profile: null, source: 'unavailable' })
  assert.deepEqual(reads, [])

  const linked = await studentAccountProfile(db, { id: 'student-document-id', accountUid: 'firebase-auth-uid' })
  assert.equal(linked.accountUid, 'firebase-auth-uid')
  assert.equal(linked.profile.id, 'firebase-auth-uid')
  assert.deepEqual(reads, ['users/firebase-auth-uid'])
})

test('student profile lookup repairs an unambiguous legacy role assignment link', async () => {
  const reads = []
  const db = {
    collection(name) {
      assert.equal(name, 'roleAssignments')
      return {
        where(field, operator, value) {
          assert.deepEqual([field, operator, value], ['crmProfileId', '==', 'student-legacy'])
          return { limit: () => ({ get: async () => ({ docs: [{ id: 'firebase-legacy-uid', data: () => ({ accessRole: 'student', crmProfileId: 'student-legacy' }) }] }) }) }
        },
      }
    },
    doc(path) {
      reads.push(path)
      return { get: async () => ({ exists: true, id: path.split('/').at(-1), data: () => ({ displayName: 'Học viên cũ' }) }) }
    },
  }
  const result = await require('./student-360').studentAccountProfile(db, { id: 'student-legacy' })
  assert.equal(result.accountUid, 'firebase-legacy-uid')
  assert.equal(result.source, 'roleAssignments.crmProfileId')
  assert.equal(result.profile.displayName, 'Học viên cũ')
  assert.deepEqual(reads, ['users/firebase-legacy-uid'])
})

test('legacy account link resolution rejects ambiguous assignments', async () => {
  const db = {
    collection() {
      return { where: () => ({ limit: () => ({ get: async () => ({ docs: [
        { id: 'uid-a', data: () => ({ accessRole: 'student' }) },
        { id: 'uid-b', data: () => ({ accessRole: 'student' }) },
      ] }) }) }) }
    },
    doc() { throw new Error('ambiguous links must not read a user profile') },
  }
  const result = await studentAccountLink(db, { id: 'student-ambiguous' })
  assert.deepEqual(result, { accountUid: '', source: 'ambiguous' })
})

test('profile triggers resolve students only through an unambiguous accountUid link', async () => {
  const db = {
    collection() {
      return {
        where() {
          return {
            limit() {
              return { get: async () => ({ size: 1, docs: [{ id: 'student-linked' }] }) }
            },
          }
        },
      }
    },
    doc() { throw new Error('must not probe students/{accountUid}') },
  }
  assert.equal(await studentIdFromAccountUid(db, 'firebase-auth-uid'), 'student-linked')
})

test('progress photos create metadata-only timeline events without exposing image payloads', () => {
  const rows = sourceTimelineEvents('student-1', {
    sessions: [], workoutLogs: [], leaveRequests: [], sessionRequests: [], mealLogs: [], payments: [], renewals: [],
    profile: null, bodyMetrics: [],
    progressPhotos: [{ id: 'photo-1', date: '2026-09-04', images: [{ url: 'data:image/jpeg;base64,secret' }] }],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'Đã cập nhật ảnh tiến độ')
  assert.deepEqual(rows[0].metadata, { progressPhotoId: 'photo-1' })
  assert.equal(JSON.stringify(rows[0]).includes('base64'), false)
})

test('unified timeline includes contract, meal review and daily check-in without sensitive payloads', () => {
  const rows = sourceTimelineEvents('student-1', {
    contracts: [{ id: 'contract-1', packageName: 'PT 24 buổi', status: 'active', startDate: '2026-08-01' }],
    sessions: [], workoutLogs: [], leaveRequests: [], sessionRequests: [], mealLogs: [], payments: [], renewals: [],
    mealReviews: [{ id: 'review-1', status: 'approved', mealName: 'Bữa trưa', createdAt: '2026-09-03T05:00:00.000Z', analysis: { private: true } }],
    dailyCheckins: [{ id: 'checkin-1', date: '2026-09-04', compliance: 86, note: 'private note' }],
    profile: null, bodyMetrics: [], progressPhotos: [],
  })
  assert.deepEqual(new Set(rows.map((item) => item.type)), new Set(['contract', 'nutrition', 'checkin']))
  assert.equal(JSON.stringify(rows).includes('private note'), false)
  assert.equal(JSON.stringify(rows).includes('private'), false)
  assert.deepEqual(rows.find((item) => item.type === 'checkin').metadata, { checkinId: 'checkin-1', compliance: 86 })
})

test('nutrition timeline merges a meal and its review while exposing only safe summary metadata', () => {
  const rows = sourceTimelineEvents('student-1', {
    contracts: [], sessions: [], attendance: [], workoutLogs: [], leaveRequests: [], sessionRequests: [], payments: [], renewals: [],
    mealLogs: [{ id: 'meal-1', date: '2026-09-05', type: 'lunch', dishName: 'Cơm gà', calories: 520, protein: 36, imageStoragePath: 'users/private/meal-photos/meal-1/original.webp' }],
    mealReviews: [{ id: 'meal-1', status: 'approved', reviewedAt: '2026-09-05T06:00:00.000Z', coachFeedback: 'private feedback', meal: { id: 'meal-1' } }],
    dailyCheckins: [], profile: null, bodyMetrics: [], progressPhotos: [],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'Bữa ăn đã được duyệt')
  assert.equal(rows[0].sourceCollection, 'mealLogs')
  assert.deepEqual(rows[0].metadata, {
    mealId: 'meal-1', reviewId: 'meal-1', status: 'approved', mealType: 'Bữa trưa',
    calories: 520, protein: 36, hasImage: true, confidence: null,
  })
  assert.equal(JSON.stringify(rows[0]).includes('imageStoragePath'), false)
  assert.equal(JSON.stringify(rows[0]).includes('private feedback'), false)
})

test('timeline normalization collapses historical review-only and current meal nutrition events', () => {
  const rows = normalizeTimelineEvents([
    { id: 'old-review', type: 'nutrition', sourceId: 'meal-review:meal-1', sourceCollection: 'mealReviews', occurredAtMillis: 200, sortKey: 200, metadata: { reviewId: 'meal-1', status: 'approved' } },
    { id: 'current-meal', type: 'nutrition', sourceId: 'meal-1', sourceCollection: 'mealLogs', occurredAtMillis: 190, sortKey: 190, metadata: { mealId: 'meal-1', status: 'approved', hasImage: true } },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'current-meal')
  assert.equal(rows[0].dedupeKey, 'nutrition:meal-1')
})

test('nutrition detail creates a bounded response without returning storage paths', () => {
  const detail = nutritionActivityDetailRecord('meal-1', {
    id: 'meal-1', date: '2026-09-05', time: '12:00', type: 'lunch', dishName: 'Cơm cá', calories: 480, protein: 31, carbs: 52, fat: 14,
    imageStoragePath: 'users/private/meal-photos/meal-1/original.webp', items: [{ name: 'Cá', grams: 120, calories: 170, protein: 26 }],
    aiAnalysis: { macroBalanceAssessment: 'Cân bằng tốt.' },
  }, { id: 'meal-1', status: 'approved', coachFeedback: 'Tiếp tục duy trì.' }, 'https://signed.example/image')
  assert.equal(detail.imageUrl, 'https://signed.example/image')
  assert.equal(detail.mealType, 'Bữa trưa')
  assert.equal(detail.items[0].protein, 26)
  assert.equal(detail.review.status, 'approved')
  assert.equal(JSON.stringify(detail).includes('imageStoragePath'), false)
})

test('training timeline uses canonical attendance evidence and keeps safe audit metadata', () => {
  const rows = sourceTimelineEvents('student-1', {
    contracts: [],
    sessions: [{ id: 'session-1', date: '2026-09-05', hour: 15, attendanceStatus: 'pending' }],
    attendance: [{ id: 'attendance-1', sessionId: 'session-1', attendanceStatus: 'late', lateMinutes: 8, confirmationSource: 'manual', confirmedBy: 'admin-1', confirmedAt: '2026-09-05T08:12:00.000Z', note: 'private note' }],
    workoutLogs: [], leaveRequests: [], sessionRequests: [], mealLogs: [], payments: [], renewals: [],
    mealReviews: [], dailyCheckins: [], profile: null, bodyMetrics: [], progressPhotos: [],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'Đi tập trễ')
  assert.equal(rows[0].occurredAt, '2026-09-05T08:00:00.000Z')
  assert.deepEqual(rows[0].metadata, {
    sessionId: 'session-1', status: 'late', attendanceEventId: 'attendance-1', confirmationSource: 'manual',
    confirmedAt: '2026-09-05T08:12:00.000Z', confirmedBy: 'admin-1', lateMinutes: 8,
  })
  assert.equal(JSON.stringify(rows[0]).includes('private note'), false)
})

test('CRM timeline includes canonical finance ledger cash events and ignores revenue recognition internals', () => {
  const rows = sourceTimelineEvents('student-1', {
    contracts: [], sessions: [], workoutLogs: [], leaveRequests: [], sessionRequests: [], mealLogs: [], renewals: [],
    mealReviews: [], dailyCheckins: [], profile: null, bodyMetrics: [], progressPhotos: [],
    payments: [
      { id: 'ledger-payment', timelineSource: 'finance_ledger', type: 'payment', amount: 2_000_000, contractId: 'contract-1', effectiveAt: '2026-09-04T02:00:00.000Z' },
      { id: 'ledger-recognition', timelineSource: 'finance_ledger', type: 'revenue_recognition', amount: 200_000, contractId: 'contract-1', effectiveAt: '2026-09-04T03:00:00.000Z' },
    ],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'Đã ghi nhận thanh toán')
  assert.equal(rows[0].metadata.amount, 2_000_000)
})

test('CRM timeline avoids duplicate generic contract events after an audited 360 mutation', () => {
  const rows = sourceTimelineEvents('student-1', {
    contracts: [{ id: 'contract-1', packageName: 'PT 24 buổi', status: 'active', startDate: '2026-08-01', student360LastActivityId: 'audit-1' }],
    sessions: [], workoutLogs: [], leaveRequests: [], sessionRequests: [], mealLogs: [], payments: [], renewals: [],
    mealReviews: [], dailyCheckins: [], profile: null, bodyMetrics: [], progressPhotos: [],
  })
  assert.equal(rows.length, 0)
})

test('timeline normalization keeps audited contract changes and removes the generic snapshot', () => {
  const rows = normalizeTimelineEvents([
    { id: 'generic', type: 'contract', sourceId: 'contract-1', sourceCollection: 'contracts', occurredAtMillis: 100, sortKey: 100, metadata: { contractId: 'contract-1' } },
    { id: 'audit', type: 'contract', sourceId: 'audit-1', sourceCollection: 'contractAuditLogs', occurredAtMillis: 200, sortKey: 200, metadata: { contractId: 'contract-1', action: 'edit' } },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].sourceCollection, 'contractAuditLogs')
  assert.equal(rows[0].groupLabel, 'Hợp đồng')
})

test('timeline normalization collapses a legacy payment duplicated in the canonical ledger', () => {
  const base = { type: 'finance', occurredAtMillis: 100, sortKey: 100, metadata: { contractId: 'contract-1', referenceCode: 'RC-01', amount: 500000 } }
  const rows = normalizeTimelineEvents([
    { ...base, id: 'legacy', sourceId: 'legacy_payment:old', sourceCollection: 'payments' },
    { ...base, id: 'ledger', sourceId: 'finance_ledger:new', sourceCollection: 'ledgerEntries', occurredAtMillis: 110, sortKey: 110 },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].sourceCollection, 'ledgerEntries')
  assert.equal(rows[0].sourceLabel, 'Sổ cái tài chính')
})

test('timeline normalization collapses migrated ledger evidence even when legacy timestamps differ', () => {
  const rows = normalizeTimelineEvents([
    {
      id: 'legacy', type: 'finance', sourceId: 'legacy_payment:old', sourceCollection: 'studentTimelineEvents',
      occurredAtMillis: Date.parse('2026-08-21T05:00:00.000Z'), sortKey: Date.parse('2026-08-21T05:00:00.000Z') * 1000,
      description: 'Thanh toán hợp đồng', metadata: { contractId: 'contract-1', amount: 9_600_000 },
    },
    {
      id: 'ledger', type: 'finance', sourceId: 'finance_ledger:new', sourceCollection: 'ledgerEntries',
      occurredAtMillis: Date.parse('2026-08-21T08:38:00.000Z'), sortKey: Date.parse('2026-08-21T08:38:00.000Z') * 1000,
      description: 'Migrated from an evidenced legacy payment record.', metadata: { contractId: 'contract-1', amount: 9_600_000, referenceCode: 'MIG-ABC123' },
    },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].sourceCollection, 'ledgerEntries')
})

test('migrated finance notes are translated into a user-facing timeline description', () => {
  const rows = sourceTimelineEvents('student-1', {
    contracts: [], sessions: [], workoutLogs: [], leaveRequests: [], sessionRequests: [], mealLogs: [], renewals: [],
    mealReviews: [], dailyCheckins: [], profile: null, bodyMetrics: [], progressPhotos: [],
    payments: [{ id: 'ledger-1', timelineSource: 'finance_ledger', type: 'payment', amount: 9_600_000, contractId: 'contract-1', effectiveAt: '2026-09-04T02:00:00.000Z', note: 'Migrated from an evidenced legacy payment record.' }],
  })
  assert.equal(rows[0].description, 'Thanh toán đã đối soát từ dữ liệu cũ.')
})

test('CRM timeline removes amounts from both metadata and descriptions for PT and coach', () => {
  const result = safeTimelineEvent({
    id: 'event-1', type: 'finance', audience: 'finance', title: 'Đã mua thêm buổi',
    description: 'Bổ sung 12 buổi · phát sinh 6.000.000đ', metadata: { amount: 6_000_000, contractId: 'contract-1' },
  }, { canViewFinancialStatus: true, canViewFinancialAmounts: false })
  assert.equal(result.description.includes('6.000.000'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(result.metadata, 'amount'), false)
  assert.equal(result.metadata.contractId, 'contract-1')
})

test('health score reweights only available components and exposes confidence', () => {
  const score = buildHealthScore({
    attendanceScore: 80,
    attendanceReason: 'attendance',
    trainingScore: 100,
    trainingReason: 'training',
    nutritionScore: null,
    nutritionReason: 'not applicable',
    progressScore: null,
    progressReason: 'missing',
    engagementScore: 50,
    engagementReason: 'engagement',
    paymentScore: 100,
    paymentReason: 'payment',
    renewalScore: 80,
    renewalReason: 'renewal',
  })
  assert.equal(score.observedWeight, 70)
  assert.equal(score.score, 83)
  assert.equal(score.status, 'stable')
  assert.equal(score.confidence, 'medium')
  assert.equal(score.components.find((item) => item.id === 'nutrition').available, false)
})

test('contract usage keeps legacy projection explicit without double-counting', () => {
  const result = contractUsage({ id: 'contract-1', totalSessions: 20, usedSessions: 8 }, [
    { contractId: 'contract-1', billingStatus: 'charged' },
    { contractId: 'contract-1', billingStatus: 'charged' },
    { contractId: 'contract-1', billingStatus: 'pending' },
  ])
  assert.equal(result.chargedSessions, 2)
  assert.equal(result.exemptSessions, 0)
  assert.equal(result.pendingReconciliationSessions, 0)
  assert.equal(result.legacyProjectionAdjustment, 6)
  assert.equal(result.usedSessions, 8)
  assert.equal(result.remainingSessions, 12)
  assert.equal(result.reconciliationStatus, 'legacy_projection')
})

function projection() {
  return {
    studentId: 'student-1',
    assignments: {
      branchId: 'branch-1',
      trainerIds: ['trainer-crm'],
      nutritionCoachIds: ['coach-uid'],
    },
    renewal: { assignedSalesId: 'sales-uid' },
    training: { recentLogs: [{ id: 'log-1' }] },
    nutrition: { loggedDays: 5 },
    progress: { latestWeightKg: 55 },
    contract: { payment: { status: 'overdue', total: 10_000_000, paid: 5_000_000, outstanding: 5_000_000, nextPaymentDate: '2026-09-01' } },
    alerts: [{ id: 'finance', audience: 'finance', action: 'finance', message: 'Nợ 5.000.000đ' }],
    nextActions: [{ id: 'finance', audience: 'finance', action: 'finance', description: 'Thu 5.000.000đ' }],
  }
}

test('assigned trainer receives coaching data and payment status without amounts', () => {
  const actor = {
    uid: 'trainer-uid',
    legacyStaffId: 'trainer-crm',
    accessRole: 'staff',
    branchIds: ['branch-1'],
    capabilities: ['pt.students.assigned.view'],
  }
  const permissions = permissionsFor(actor, projection())
  assert.equal(permissions.canViewTraining, true)
  assert.equal(permissions.canViewNutrition, true)
  assert.equal(permissions.canViewOperations, true)
  assert.equal(permissions.canViewProgressPhotos, true)
  assert.equal(permissions.canViewFinancialAmounts, false)
  const redacted = redactProjection(projection(), permissions)
  assert.deepEqual(redacted.contract.payment, { status: 'overdue', nextPaymentDate: '2026-09-01' })
  assert.equal(redacted.alerts[0].message.includes('5.000.000'), false)
})

test('progress updates are scoped to coaching staff and validate the staff payload', () => {
  const permissions = permissionsFor({
    uid: 'manager-1', legacyStaffId: 'manager-1', accessRole: 'staff', branchIds: ['branch-1'],
    capabilities: ['branch.operations.view'],
  }, projection())
  assert.equal(permissions.canManageProgress, true)
  const input = normalizeProgressCheckInInput({
    id: 'checkin-staff-1', date: '2026-09-09', weightKg: '59,8', measurementNote: 'Đo buổi sáng', photos: [],
  })
  assert.equal(input.measurements.weightKg, 59.8)
  assert.equal(input.photosProvided, true)
  assert.throws(() => normalizeProgressCheckInInput({ id: 'checkin-staff-2', date: '2026-09-09', photos: [{ id: 'photo-123', angle: 'front', imageUrl: 'https://example.com/a.jpg' }] }), /nhân sự cập nhật/)
  assert.equal(decodeProgressPhotoDataUrl('data:image/jpeg;base64,aGVsbG8=').contentType, 'image/jpeg')
})

test('Student 360 exposes a callable-only progress mutation for Admin and Staff', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'student-360.js'), 'utf8')
  assert.match(source, /const saveStudent360ProgressCheckIn = writeCall\(/)
  assert.match(source, /canManageProgress/)
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8'), /saveStudent360ProgressCheckInRegional/)
})

test('sales receives care, renewal and payment status without operational or coaching detail', () => {
  const base = {
    ...projection(),
    schedule: { weekId: '2026-09-01', weekEnd: '2026-09-07', requiredSessions: 3, bookedSessions: 2, nextSession: { id: 'session-1' }, sessions: [{ id: 'session-1' }], availability: { slots: ['T2-08'], confirmed: true, source: 'weekly', sourceWeekId: '2026-09-01', minimumSlots: 5 } },
    attendance: { rate28Days: 80, attended: 8, late: 0, noShow: 2, total: 10, weeklyTrend: [], lastAttendanceAt: null },
    health: { score: 70, components: [{ id: 'attendance' }, { id: 'payment' }, { id: 'renewal' }, { id: 'nutrition' }] },
    alerts: [
      { id: 'schedule', audience: 'operations', action: 'schedule', message: 'Thiếu lịch' },
      { id: 'finance', audience: 'finance', action: 'finance', message: 'Nợ 5.000.000đ' },
      { id: 'renewal', audience: 'sales', action: 'renewal', message: 'Cần gia hạn' },
    ],
    nextActions: [],
  }
  const permissions = permissionsFor({ uid: 'sales-uid', legacyStaffId: 'sales-uid', accessRole: 'staff', branchIds: [], capabilities: [] }, base)
  const redacted = redactProjection(base, permissions)
  assert.equal(permissions.scope, 'sales')
  assert.equal(permissions.canViewOperations, false)
  assert.equal(redacted.schedule.sessions.length, 0)
  assert.equal(redacted.attendance.total, 0)
  assert.deepEqual(redacted.health.components.map((item) => item.id), ['payment', 'renewal'])
  assert.deepEqual(redacted.alerts.map((item) => item.id), ['finance', 'renewal'])
})

test('branch manager sees branch finance but cannot see progress photos', () => {
  const permissions = permissionsFor({
    uid: 'manager-1',
    legacyStaffId: 'manager-1',
    accessRole: 'staff',
    branchIds: ['branch-1'],
    capabilities: ['branch.operations.view', 'branch.finance.view'],
  }, projection())
  assert.equal(permissions.scope, 'branch')
  assert.equal(permissions.canViewFinancialAmounts, true)
  assert.equal(permissions.canViewOperations, true)
  assert.equal(permissions.canViewTraining, false)
  assert.equal(permissions.canViewNutrition, false)
  assert.equal(permissions.canViewProgress, false)
  assert.equal(permissions.canViewProgressPhotos, false)
})

test('unassigned staff is denied even when authenticated', () => {
  assert.throws(() => permissionsFor({
    uid: 'other',
    legacyStaffId: 'other',
    accessRole: 'staff',
    branchIds: ['branch-2'],
    capabilities: ['pt.students.assigned.view'],
  }, projection()), /không thuộc phạm vi/i)
})

test('sales assigned directly on the student can open care and renewal without coaching data', () => {
  const base = {
    ...projection(),
    assignments: { ...projection().assignments, salesIds: ['sales-direct'] },
    renewal: null,
  }
  const permissions = permissionsFor({ uid: 'sales-direct', accessRole: 'staff', branchIds: [], capabilities: [] }, base)
  assert.equal(permissions.scope, 'sales')
  assert.equal(permissions.canManageCare, true)
  assert.equal(permissions.canViewRenewal, true)
  assert.equal(permissions.canViewTraining, false)
})

test('care activity audit name is server-owned instead of trusting the client payload', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'student-360.js'), 'utf8')
  assert.match(source, /actorName: actor\.actorName/)
  assert.doesNotMatch(source, /actorName: bounded\(request\.data\?\.actorName/)
})

test('contract workspace mutations are revisioned, audited and no longer rely on legacy student detail writes', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'student-360.js'), 'utf8')
  assert.match(source, /getStudent360ContractWorkspace/)
  assert.match(source, /mutateStudent360Contract/)
  assert.match(source, /expectedRevision/)
  assert.match(source, /contractAuditLogs/)
  assert.match(source, /studentTimelineEvents/)
  assert.match(source, /canManageFinancials/)
  assert.doesNotMatch(source, /paidAmount:\s*finite\(request\.data/)
})

test('Student 360 contract workspace prefers canonical usage views with bounded legacy fallback', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'student-360.js'), 'utf8')
  assert.match(source, /contractUsageViews\//)
  assert.match(source, /usageSummaryFromView\(usageView, value\)/)
  assert.match(source, /where\('crmProfileId', '==', studentId\)/)
  assert.match(source, /where\('studentId', '==', studentId\)\.limit\(1000\)/)
})

test('Student 360 overview prefers durable operational actions when available', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'student-360.js'), 'utf8')
  assert.match(source, /operationalActions/)
  assert.match(source, /request\.data\?\.includeOperationalActions === true/)
  assert.match(source, /studentOperationalActions\(db, actor, studentId\)/)
  assert.match(source, /operationalActions\.length \? \{ nextActions: operationalActions \}/)
})

test('Student 360 overview reads canonical contract usage with a bounded legacy fallback', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'student-360.js'), 'utf8')
  assert.match(source, /contractUsageViews\/\$\{contract\.id\}/)
  assert.match(source, /usageView\?\.exists[\s\S]*?usageSummaryFromView\(usageView\.data\(\), contract\)[\s\S]*?: contractUsage/)
  assert.match(source, /where\('crmProfileId', '==', studentId\)/)
})

test('new contracts snapshot the effective operations policy without rewriting legacy rights', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'student-360.js'), 'utf8')
  assert.match(source, /transaction\.get\(db\.doc\('settings\/scheduleConfig'\)\)/)
  assert.match(source, /ptOperationsPolicySnapshot\(policyConfigSnapshot\.exists/)
  assert.match(source, /next\.policyHash = operationsPolicy\.policyHash/)
  assert.match(source, /next\.policySnapshot = operationsPolicy/)
})

test('Student 360 callables use quota-safe fractional CPU with bounded concurrency', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'student-360.js'), 'utf8')
  assert.match(source, /const readCall = \(handler\) => onCall\(\{ cpu: 'gcf_gen1', concurrency: 1, maxInstances: 8/)
  assert.match(source, /const writeCall = \(handler\) => onCall\(\{ cpu: 'gcf_gen1', concurrency: 1, maxInstances: 4/)
})

test('training timeline scans beyond unrelated recent events and repairs legacy source evidence', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'student-360.js'), 'utf8')
  assert.match(source, /const maximumScans = requestedTypes\.length \? 4 : 1/)
  assert.match(source, /requestedTypes\.some\(\(type\) => \['training', 'workout'\]\.includes\(type\)\)/)
  assert.match(source, /db\.collection\('sessions'\)\.where\('studentId', '==', studentId\)\.limit\(1\)/)
  assert.match(source, /await buildStudent360Projection\(\{ db, studentId, weekId, persist: true \}\)/)
})

test('Student 360 projection slices history newest-first before applying overview limits', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'student-360.js'), 'utf8')
  assert.match(source, /async function latestDocuments\(query, field, limit\)/)
  assert.doesNotMatch(source, /async function latestDocuments[\s\S]*?queryDocuments\(query\.limit\(limit\)\)/)
  assert.match(source, /latestDocuments\(db\.collection\('sessions'\)\.where\('studentId', '==', studentId\), 'date', 1000\)/)
  assert.match(source, /latestSnapshot\(db\.collection\(`users\/\$\{accountUid\}\/progressPhotos`\), 'date', 30\)/)
})

test('Student 360 directory advances a source cursor instead of repeating the first 500 projections', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'student-360.js'), 'utf8')
  const directory = source.match(/const listStudent360Directory[\s\S]*?\n  const listStudent360Timeline/)?.[0] || ''
  assert.match(directory, /orderBy\(FieldPath\.documentId\(\), 'asc'\)/)
  assert.match(directory, /query = query\.startAfter\(sourceCursor\)/)
  assert.match(directory, /nextCursor: hasMore \? sourceCursor \|\| null : null/)
  assert.doesNotMatch(directory, /collection\('studentOperationalViews'\)\.limit\(500\)/)
})
