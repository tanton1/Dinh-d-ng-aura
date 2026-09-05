const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { createHash } = require('node:crypto')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { calculateWorkdayPayroll, mergeWorkCalendar, payrollAmounts } = require('./staff-payroll')
const { calculateReferralCommissions, referralCashImpact } = require('./referral-commission')
const { assertFinancePeriodOpen } = require('./finance-ledger')
const { payrollAccrualJournal, payrollPaymentJournal } = require('./accounting-core')

const PAYROLL_VIOLATION_KIND = 'payroll_validation'
const PAYROLL_REMEDIATIONS = new Set([
  'workdays',
  'teaching_history',
  'staff_profile',
  'policy',
  'delete_rebuild',
  'retry',
])

function payrollViolationError(code, title, detail, remediation, context = {}, httpsCode = 'failed-precondition') {
  const violation = {
    code: String(code || 'PAYROLL_VALIDATION_FAILED'),
    severity: 'error',
    title: String(title || 'Dữ liệu kỳ lương chưa hợp lệ'),
    detail: String(detail || title || 'Hãy đối soát dữ liệu trước khi lập kỳ lương.'),
    remediation: PAYROLL_REMEDIATIONS.has(remediation) ? remediation : 'retry',
    ...Object.fromEntries(Object.entries(context || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')),
  }
  return new HttpsError(httpsCode, violation.detail, {
    kind: PAYROLL_VIOLATION_KIND,
    violations: [violation],
  })
}

function payrollViolationsError(violations, httpsCode = 'failed-precondition') {
  const safeViolations = Array.isArray(violations) ? violations.filter(Boolean) : []
  const first = safeViolations[0] || {
    code: 'PAYROLL_VALIDATION_FAILED',
    title: 'Dữ liệu kỳ lương chưa hợp lệ',
    detail: 'Hãy đối soát dữ liệu trước khi lập kỳ lương.',
    remediation: 'retry',
  }
  return new HttpsError(httpsCode, first.detail, {
    kind: PAYROLL_VIOLATION_KIND,
    violations: safeViolations.length ? safeViolations : [first],
  })
}

function isKnownHttpsError(value) {
  return value instanceof HttpsError || Boolean(value && typeof value === 'object' && typeof value.code === 'string' && value.code !== 'internal')
}

async function payrollActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'payroll.operations.manage')
  return actor
}

function period(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(result)) throw new HttpsError('invalid-argument', 'Kỳ lương phải có dạng YYYY-MM.')
  return result
}

function periodBounds(periodId) {
  const [year, month] = periodId.split('-').map(Number)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    // Payroll is a Vietnam business period, not a UTC calendar month.
    start: Timestamp.fromDate(new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+07:00`)),
    end: Timestamp.fromDate(new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+07:00`)),
  }
}

function periodDateBounds(periodId) {
  const [year, month] = period(periodId).split('-').map(Number)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  }
}

function payrollPeriodClosed(periodId, now = new Date()) {
  const date = now?.toDate ? now.toDate() : now instanceof Date ? now : new Date(now)
  return Number.isFinite(date.getTime()) && date.getTime() >= periodBounds(period(periodId)).end.toMillis()
}

function assertPayrollPeriodClosed(periodId) {
  if (!payrollPeriodClosed(periodId)) {
    throw new HttpsError('failed-precondition', 'Chỉ có thể gửi duyệt hoặc khóa lương sau khi kỳ đã kết thúc.')
  }
}

function iso(value) {
  return value?.toDate?.().toISOString?.() || ''
}

function payrollEffectiveAt(periodId) {
  const { end } = periodBounds(periodId)
  // The payroll expense belongs to the last instant of its Vietnam business
  // period, rather than the later button-click time.
  return Timestamp.fromMillis(end.toMillis() - 1)
}

function payrollPaymentReference(value) {
  const result = typeof value === 'string' ? value.trim().slice(0, 200) : ''
  if (!result) throw new HttpsError('invalid-argument', 'Cần nhập mã chứng từ hoặc tham chiếu chi lương.')
  return result
}

function payrollCashAccountId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(result)) {
    throw new HttpsError('invalid-argument', 'Tài khoản quỹ chi lương không hợp lệ.')
  }
  return result
}

function policyEffectiveDate(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(result)) {
    throw new HttpsError('invalid-argument', 'Ngày hiệu lực chính sách không hợp lệ.')
  }
  const [year, month, day] = result.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) throw new HttpsError('invalid-argument', 'Ngày hiệu lực chính sách không hợp lệ.')
  const timestamp = Timestamp.fromDate(new Date(`${result}T00:00:00+07:00`))
  if (Number.isNaN(timestamp.toDate().getTime())) throw new HttpsError('invalid-argument', 'Ngày hiệu lực chính sách không hợp lệ.')
  return { value: result, timestamp }
}

function policyRate(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1_000 || result > 10_000_000) {
    throw new HttpsError('invalid-argument', 'Đơn giá buổi tập phải từ 1.000đ đến 10.000.000đ.')
  }
  return result
}

function policyName(value) {
  const result = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 100) : ''
  if (result.length < 2) throw new HttpsError('invalid-argument', 'Tên chính sách lương chưa hợp lệ.')
  return result
}

function policyAudience(value) {
  return value === 'collaborator' || value === 'all' ? value : 'employee'
}

const PAYROLL_PROFILES = new Set(['probation', 'official', 'senior', 'part_time', 'collaborator'])

function payrollProfile(value = {}) {
  if (value.employmentType === 'collaborator') return 'collaborator'
  if (value.employmentType === 'part_time') return 'part_time'
  return value.employmentLevel === 'probation' || value.employmentLevel === 'senior'
    ? value.employmentLevel
    : 'official'
}

function payrollPolicyProfiles(value, audience = 'employee') {
  if (Array.isArray(value)) {
    const profiles = [...new Set(value.filter((item) => PAYROLL_PROFILES.has(item)))]
    if (profiles.length) return profiles
  }
  if (audience === 'collaborator') return ['collaborator']
  if (audience === 'all') return [...PAYROLL_PROFILES]
  return ['probation', 'official', 'senior', 'part_time']
}

function policyAudienceFromProfiles(profiles) {
  const includesCollaborator = profiles.includes('collaborator')
  const includesEmployee = profiles.some((profile) => profile !== 'collaborator')
  return includesCollaborator && includesEmployee ? 'all' : includesCollaborator ? 'collaborator' : 'employee'
}

function policySupportsProfile(policy, profile) {
  return payrollPolicyProfiles(policy.eligibleProfiles, policy.audience).includes(profile)
}

function boundedInteger(value, label, minimum, maximum, fallback) {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpsError('invalid-argument', `${label} phải từ ${minimum} đến ${maximum}.`)
  }
  return parsed
}

function payrollPolicyConfiguration(value = {}) {
  const ratePerSession = policyRate(value.ratePerSession)
  const dailySessionThreshold = boundedInteger(value.dailySessionThreshold, 'Số ca tiêu chuẩn mỗi ngày', 1, 24, 8)
  const rateAfterDailyThreshold = policyRate(value.rateAfterDailyThreshold ?? ratePerSession)
  const eveningStartHour = boundedInteger(value.eveningStartHour, 'Giờ bắt đầu ca tối', 0, 23, 20)
  const rateAfterDailyThresholdEvening = policyRate(value.rateAfterDailyThresholdEvening ?? rateAfterDailyThreshold)
  return {
    ratePerSession,
    dailySessionThreshold,
    rateAfterDailyThreshold,
    eveningStartHour,
    rateAfterDailyThresholdEvening,
  }
}

function vietnamDateKey(value, context = {}) {
  if (typeof value === 'string') {
    const candidate = value.trim().slice(0, 10)
    if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(candidate)) return candidate
  }
  const date = value?.toDate?.() || (value instanceof Date ? value : null)
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
  }
  throw payrollViolationError(
    'SESSION_DATE_INVALID',
    'Ca dạy thiếu ngày hợp lệ',
    'Một ca đã hoàn thành nhưng không có ngày tập hợp lệ nên chưa thể tính vào kỳ lương.',
    'teaching_history',
    context,
  )
}

function teachingHour(value, sessionId, context = {}) {
  const direct = Number(value)
  if (Number.isInteger(direct) && direct >= 0 && direct <= 23) return direct
  const legacy = Number(String(sessionId || '').split('-')[1])
  if (Number.isInteger(legacy) && legacy >= 0 && legacy <= 23) return legacy
  throw payrollViolationError(
    'SESSION_HOUR_INVALID',
    'Ca dạy thiếu giờ hợp lệ',
    'Một ca đã hoàn thành nhưng không có khung giờ hợp lệ nên chưa thể nhóm và tính tiền ca.',
    'teaching_history',
    { sessionId, ...context },
  )
}

// Legacy schedule documents used the sentinel `all` when an admin was
// working across branches. It is not a real branch and must not make a
// teaching slot look like a cross-branch collision during payroll grouping.
// Keep the value in the source document for audit; use an empty canonical
// value only for validation/grouping.
function normalisePayrollBranchId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  return result.toLowerCase() === 'all' ? '' : result
}

function payrollDocumentId(value, label) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(result)) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function payrollAdjustmentType(value) {
  if (value === 'bonus' || value === 'deduction') return value
  throw new HttpsError('invalid-argument', 'Loại thưởng hoặc phạt không hợp lệ.')
}

function payrollAdjustmentAmount(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1_000 || result > 100_000_000) {
    throw new HttpsError('invalid-argument', 'Số tiền thưởng hoặc phạt phải từ 1.000đ đến 100.000.000đ.')
  }
  return result
}

function payrollAdjustmentText(value, label, minimum, maximum) {
  const result = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum) : ''
  if (result.length < minimum) throw new HttpsError('invalid-argument', `${label} cần tối thiểu ${minimum} ký tự.`)
  return result
}

function priceTeachingSlots(slots, resolvePolicy) {
  const dailyPosition = new Map()
  return [...slots]
    .sort((left, right) => left.date.localeCompare(right.date) || left.hour - right.hour || left.key.localeCompare(right.key))
    .map((slot) => {
      const position = Number(dailyPosition.get(slot.date) || 0) + 1
      dailyPosition.set(slot.date, position)
      const selected = resolvePolicy(slot)
      if (!selected?.configuration) {
        throw payrollViolationError(
          'TEACHING_SLOT_POLICY_MISSING',
          'Ca dạy chưa có chính sách lương',
          `Chưa xác định được chính sách cho ca ngày ${slot.date} lúc ${String(slot.hour).padStart(2, '0')}:00.`,
          'policy',
          { trainerId: slot.trainerId, date: slot.date, hour: slot.hour, sessionIds: slot.sessionIds instanceof Set ? [...slot.sessionIds] : slot.sessionIds },
        )
      }
      const policy = payrollPolicyConfiguration(selected.configuration)
      const afterThreshold = position > policy.dailySessionThreshold
      const evening = afterThreshold && slot.hour >= policy.eveningStartHour
      const rate = evening
        ? policy.rateAfterDailyThresholdEvening
        : afterThreshold ? policy.rateAfterDailyThreshold : policy.ratePerSession
      return {
        key: slot.key,
        date: slot.date,
        hour: slot.hour,
        branchId: slot.branchId,
        dailyPosition: position,
        tier: evening ? 'after_threshold_evening' : afterThreshold ? 'after_threshold' : 'standard',
        rate,
        policyId: selected.id || '',
        policyName: selected.name || 'Chính sách lương PT',
        studentCount: slot.studentIds?.size ?? slot.studentCount ?? 0,
        sessionIds: slot.sessionIds instanceof Set ? [...slot.sessionIds] : [...(slot.sessionIds || [])],
        attendanceEventIds: slot.attendanceEventIds instanceof Set ? [...slot.attendanceEventIds] : [...(slot.attendanceEventIds || [])],
      }
    })
}

function teachingSlotsFromAttendance(attendanceDocuments, sessionsById, policyValue) {
  const policy = payrollPolicyConfiguration(policyValue)
  const slotMap = new Map()
  let attendanceEventCount = 0

  for (const item of attendanceDocuments) {
    const attendance = typeof item?.data === 'function' ? item.data() : item || {}
    // A charged cancellation consumes the learner contract but is not a class
    // taught by the trainer, therefore it never creates payroll.
    if (attendance.type && attendance.type !== 'attended') continue
    const sessionId = typeof attendance.sessionId === 'string' && attendance.sessionId.trim()
      ? attendance.sessionId.trim()
      : typeof item?.id === 'string' ? item.id : ''
    const session = sessionsById.get(sessionId)
    if (!sessionId || !session) {
      throw payrollViolationError(
        'ATTENDANCE_SESSION_MISSING',
        'Điểm danh không có ca dạy gốc',
        'Có lượt điểm danh không liên kết được với session. Hãy sửa hoặc khôi phục ca gốc trước khi lập lương.',
        'teaching_history',
        { sessionId, attendanceEventId: item?.id || '' },
      )
    }
    const trainerId = typeof session.trainerId === 'string' && session.trainerId.trim()
      ? session.trainerId.trim()
      : typeof attendance.trainerId === 'string' ? attendance.trainerId.trim() : ''
    if (!trainerId) throw payrollViolationError(
      'SESSION_TRAINER_MISSING',
      'Ca dạy chưa có PT phụ trách',
      'Một ca đã ghi nhận điểm danh nhưng chưa liên kết PT. Hãy gán lại PT cho ca trước khi lập lương.',
      'teaching_history',
      { sessionId, attendanceEventId: item?.id || '' },
    )
    const date = vietnamDateKey(session.date || attendance.scheduledFor || attendance.occurredAt, { sessionId, trainerId })
    const hour = teachingHour(session.hour, sessionId, { trainerId, date })
    const key = `${trainerId}|${date}|${hour}`
    let slot = slotMap.get(key)
    if (!slot) {
      slot = {
        key,
        trainerId,
        date,
        hour,
        branchId: normalisePayrollBranchId(session.branchId),
        sessionIds: new Set(),
        studentIds: new Set(),
        attendanceEventIds: new Set(),
      }
      slotMap.set(key, slot)
    }
    slot.sessionIds.add(sessionId)
    slot.studentIds.add(attendance.studentId || session.studentId || `unknown_${item?.id || sessionId}`)
    slot.attendanceEventIds.add(item?.id || sessionId)
    attendanceEventCount += 1
  }

  const trainers = new Map()
  for (const slot of slotMap.values()) {
    const current = trainers.get(slot.trainerId) || []
    current.push(slot)
    trainers.set(slot.trainerId, current)
  }
  for (const [trainerId, slots] of trainers) {
    trainers.set(trainerId, priceTeachingSlots(slots, () => ({ configuration: policy })))
  }
  return { trainers, attendanceEventCount, teachingSlotCount: slotMap.size, policy }
}

function teachingSlotsFromSessions(sessionDocuments, policyValue) {
  const policy = payrollPolicyConfiguration(policyValue)
  const slotMap = new Map()
  const branchConflictKeys = new Set()
  const branchConflicts = []
  let attendanceEventCount = 0

  for (const item of sessionDocuments) {
    const session = typeof item?.data === 'function' ? item.data() : item || {}
    if (!['completed', 'attended'].includes(session.status)) continue
    const sessionId = typeof item?.id === 'string' && item.id
      ? item.id
      : typeof session.id === 'string' ? session.id : ''
    const trainerId = typeof session.trainerId === 'string' ? session.trainerId.trim() : ''
    if (!sessionId) throw payrollViolationError(
      'SESSION_ID_MISSING',
      'Ca hoàn thành thiếu mã ca',
      'Có dữ liệu ca hoàn thành không có sessionId nên chưa thể lưu bằng chứng tính lương.',
      'teaching_history',
      { trainerId },
    )
    if (!trainerId) throw payrollViolationError(
      'SESSION_TRAINER_MISSING',
      'Ca dạy chưa có PT phụ trách',
      'Một ca đã hoàn thành nhưng chưa liên kết PT. Hãy gán lại PT cho ca trước khi lập lương.',
      'teaching_history',
      { sessionId, date: typeof session.date === 'string' ? session.date : '' },
    )
    const date = vietnamDateKey(session.date, { sessionId, trainerId })
    const hour = teachingHour(session.hour, sessionId, { trainerId, date })
    const key = `${trainerId}|${date}|${hour}`
    let slot = slotMap.get(key)
    if (!slot) {
      slot = {
        key,
        trainerId,
        date,
        hour,
        branchId: normalisePayrollBranchId(session.branchId),
        sessionIds: new Set(),
        studentIds: new Set(),
        attendanceEventIds: new Set(),
      }
      slotMap.set(key, slot)
    } else if (slot.branchId && normalisePayrollBranchId(session.branchId) && slot.branchId !== normalisePayrollBranchId(session.branchId)) {
      if (!branchConflictKeys.has(key)) {
        branchConflictKeys.add(key)
        branchConflicts.push({
          code: 'TRAINER_CROSS_BRANCH_SLOT_CONFLICT',
          severity: 'error',
          title: 'PT có ca trùng giờ ở nhiều chi nhánh',
          detail: `PT có ca hoàn thành trùng giờ ở nhiều chi nhánh ngày ${date}. Hãy xác định lại chi nhánh hoặc PT thực dạy.`,
          remediation: 'teaching_history',
          trainerId,
          date,
          hour,
          sessionId,
          conflictingSessionIds: [...slot.sessionIds],
        })
      }
    }
    if (!slot.branchId && normalisePayrollBranchId(session.branchId)) slot.branchId = normalisePayrollBranchId(session.branchId)
    slot.sessionIds.add(sessionId)
    slot.studentIds.add(session.studentId || `unknown_${sessionId}`)
    slot.attendanceEventIds.add(session.attendanceEventId || sessionId)
    attendanceEventCount += 1
  }

  if (branchConflicts.length) throw payrollViolationsError(branchConflicts)

  const trainers = new Map()
  for (const slot of slotMap.values()) {
    const current = trainers.get(slot.trainerId) || []
    current.push(slot)
    trainers.set(slot.trainerId, current)
  }
  for (const [trainerId, slots] of trainers) {
    trainers.set(trainerId, priceTeachingSlots(slots, () => ({ configuration: policy })))
  }
  return { trainers, attendanceEventCount, teachingSlotCount: slotMap.size, policy }
}

function payrollRunPolicyPlan(value = {}) {
  const selectedPolicyIds = Array.isArray(value.policyIds)
    ? [...new Set(value.policyIds.map((item) => payrollDocumentId(item, 'Mã chính sách')))].slice(0, 10)
    : []
  const applicationMode = value.policyApplicationMode === 'effective_date'
    ? 'effective_date'
    : value.policyApplicationMode === 'staff_profile' ? 'staff_profile' : 'trainer_assignment'
  const defaultPolicyId = value.defaultPolicyId
    ? payrollDocumentId(value.defaultPolicyId, 'Chính sách mặc định')
    : selectedPolicyIds[0] || ''
  const trainerAssignments = new Map()
  if (Array.isArray(value.trainerPolicyAssignments)) {
    if (value.trainerPolicyAssignments.length > 500) {
      throw new HttpsError('invalid-argument', 'Danh sách phân chính sách theo HLV quá lớn.')
    }
    value.trainerPolicyAssignments.forEach((assignment) => {
      const trainerId = payrollDocumentId(assignment?.trainerId, 'Mã HLV')
      const policyId = payrollDocumentId(assignment?.policyId, 'Mã chính sách HLV')
      trainerAssignments.set(trainerId, policyId)
    })
  }
  return { selectedPolicyIds, applicationMode, defaultPolicyId, trainerAssignments }
}

function payrollPolicyRecord(snapshot) {
  if (!snapshot?.exists) throw payrollViolationError(
    'PAYROLL_POLICY_NOT_FOUND',
    'Không tìm thấy chính sách đã chọn',
    'Chính sách có thể đã bị xóa hoặc không còn khả dụng. Hãy tải lại và chọn chính sách khác.',
    'policy',
    { policyId: snapshot?.id || '' },
    'not-found',
  )
  const data = snapshot.data()
  return {
    id: snapshot.id,
    name: data.name || 'Chính sách lương PT',
    version: Number(data.version || 1),
    effectiveDate: vietnamDateKey(data.effectiveFrom),
    status: data.status === 'inactive' ? 'inactive' : 'active',
    audience: policyAudience(data.audience),
    eligibleProfiles: payrollPolicyProfiles(data.eligibleProfiles, policyAudience(data.audience)),
    configuration: payrollPolicyConfiguration(data),
  }
}

function payrollPolicySnapshot(policy) {
  return {
    id: policy.id,
    name: policy.name,
    version: policy.version,
    effectiveDate: policy.effectiveDate,
    audience: policy.audience,
    eligibleProfiles: policy.eligibleProfiles,
    ...policy.configuration,
  }
}

function applyPayrollPolicyPlan(teaching, plan, policies) {
  const policiesById = new Map(policies.map((policy) => [policy.id, policy]))
  const defaultPolicy = policiesById.get(plan.defaultPolicyId) || policies[0]
  if (!defaultPolicy) throw payrollViolationError(
    'PAYROLL_DEFAULT_POLICY_MISSING',
    'Chưa chọn chính sách mặc định',
    'Chọn một chính sách mặc định để tính cho các PT chưa được gán riêng.',
    'policy',
  )
  const effectivePolicies = [...policies].sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate))
  const trainers = new Map()
  for (const [trainerId, slots] of teaching.trainers) {
    const profile = plan.staffProfiles?.get(trainerId) || 'official'
    const profilePolicyId = plan.staffPolicyAssignments?.get(trainerId) || ''
    const profilePolicy = policiesById.get(profilePolicyId)
    const assignedPolicy = plan.applicationMode === 'staff_profile'
      ? profilePolicy
      : policiesById.get(plan.trainerAssignments.get(trainerId)) || defaultPolicy
    trainers.set(trainerId, priceTeachingSlots(slots, (slot) => {
      if (plan.applicationMode === 'staff_profile') {
        if (assignedPolicy && policySupportsProfile(assignedPolicy, profile) && assignedPolicy.effectiveDate <= slot.date) {
          return assignedPolicy
        }
        const matching = effectivePolicies
          .filter((policy) => policySupportsProfile(policy, profile) && policy.effectiveDate <= slot.date)
          .at(-1)
        if (!matching) {
          throw payrollViolationError(
            'STAFF_POLICY_INCOMPATIBLE',
            'Không có chính sách phù hợp nhóm lương',
            `Chưa có chính sách phù hợp nhóm ${profile} cho ca ngày ${slot.date}.`,
            'staff_profile',
            { trainerId, staffId: trainerId, payrollProfile: profile, date: slot.date, hour: slot.hour, sessionIds: slot.sessionIds },
          )
        }
        return matching
      }
      if (plan.applicationMode === 'effective_date' && policies.length > 1) {
        const matching = effectivePolicies.filter((policy) => policy.effectiveDate <= slot.date).at(-1)
        if (!matching) {
          throw payrollViolationError(
            'PAYROLL_POLICY_NOT_EFFECTIVE',
            'Chưa có chính sách hiệu lực tại ngày dạy',
            `Không có chính sách nào bắt đầu trước hoặc đúng ngày ${slot.date}.`,
            'policy',
            { trainerId, date: slot.date, hour: slot.hour, sessionIds: slot.sessionIds },
          )
        }
        return matching
      }
      if (assignedPolicy.effectiveDate > slot.date) {
        throw payrollViolationError(
          'PAYROLL_POLICY_NOT_EFFECTIVE',
          'Chính sách chưa hiệu lực tại ngày dạy',
          `Chính sách ${assignedPolicy.name} chưa hiệu lực tại ngày ${slot.date}.`,
          'policy',
          { trainerId, policyId: assignedPolicy.id, date: slot.date, hour: slot.hour, sessionIds: slot.sessionIds },
        )
      }
      return assignedPolicy
    }))
  }
  return { ...teaching, trainers }
}

function payrollIdentityName(value = {}) {
  return value.name || value.fullName || value.displayName || ''
}

function payrollIdentitySnapshot(trainer = {}, staff = {}, user = {}) {
  return {
    name: payrollIdentityName(trainer) || payrollIdentityName(staff) || payrollIdentityName(user) || 'Chưa cập nhật tên HLV',
    employeeCode: trainer.employeeCode || staff.employeeCode || '',
    branchId: trainer.branchId || staff.branchId || user.branchId || '',
  }
}

async function getAllDocumentsInBatches(db, references, batchSize = 400) {
  const snapshots = []
  for (let offset = 0; offset < references.length; offset += batchSize) {
    snapshots.push(...await db.getAll(...references.slice(offset, offset + batchSize)))
  }
  return snapshots
}

function legacyPayrollPolicyConfiguration(runData = {}, itemValues = []) {
  const snapshot = runData.policySnapshot && typeof runData.policySnapshot === 'object' ? runData.policySnapshot : {}
  const fallbackRate = Number(snapshot.ratePerSession || itemValues.find((item) => Number(item.ratePerSession || 0) > 0)?.ratePerSession || 0)
  return payrollPolicyConfiguration({
    ratePerSession: fallbackRate,
    dailySessionThreshold: Number(snapshot.dailySessionThreshold || 8),
    rateAfterDailyThreshold: Number(snapshot.rateAfterDailyThreshold || fallbackRate),
    eveningStartHour: Number(snapshot.eveningStartHour ?? 20),
    rateAfterDailyThresholdEvening: Number(snapshot.rateAfterDailyThresholdEvening || snapshot.rateAfterDailyThreshold || fallbackRate),
  })
}

function payrollTierSummary(teachingSlots) {
  return teachingSlots.reduce((result, slot) => {
    if (slot.tier === 'standard') { result.standardCount += 1; result.standardAmount += slot.rate }
    else if (slot.tier === 'after_threshold') { result.afterThresholdCount += 1; result.afterThresholdAmount += slot.rate }
    else { result.afterThresholdEveningCount += 1; result.afterThresholdEveningAmount += slot.rate }
    return result
  }, { standardCount: 0, standardAmount: 0, afterThresholdCount: 0, afterThresholdAmount: 0, afterThresholdEveningCount: 0, afterThresholdEveningAmount: 0 })
}

async function payrollIdentityByTrainerId(db, trainerIds) {
  const snapshots = await getAllDocumentsInBatches(db, trainerIds.flatMap((trainerId) => [
    db.doc(`trainers/${trainerId}`),
    db.doc(`staff/${trainerId}`),
    db.doc(`users/${trainerId}`),
  ]))
  const result = new Map()
  trainerIds.forEach((trainerId, index) => {
    const trainer = snapshots[index * 3]?.exists ? snapshots[index * 3].data() : {}
    const staff = snapshots[index * 3 + 1]?.exists ? snapshots[index * 3 + 1].data() : {}
    const user = snapshots[index * 3 + 2]?.exists ? snapshots[index * 3 + 2].data() : {}
    result.set(trainerId, payrollIdentitySnapshot(trainer, staff, user))
  })
  return result
}

async function legacyPayrollPreview(db, runData, itemValues) {
  const { start, end } = periodBounds(runData.periodId)
  const attendance = await db.collection('attendanceEvents').where('occurredAt', '>=', start).where('occurredAt', '<', end).get()
  const eligibleAttendance = attendance.docs.filter((item) => !item.data().type || item.data().type === 'attended')
  const sessionIds = [...new Set(eligibleAttendance.map((item) => item.data().sessionId || item.id).filter(Boolean))]
  if (sessionIds.length > 3000) throw new HttpsError('resource-exhausted', 'Kỳ lương cũ có quá nhiều ca để dựng lại chi tiết an toàn.')
  const sessionSnapshots = await getAllDocumentsInBatches(db, sessionIds.map((sessionId) => db.doc(`sessions/${sessionId}`)))
  const sessionById = new Map(sessionSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()]))
  const teaching = teachingSlotsFromAttendance(eligibleAttendance, sessionById, legacyPayrollPolicyConfiguration(runData, itemValues))
  const trainerIds = [...new Set([...itemValues.map((item) => item.trainerId).filter(Boolean), ...teaching.trainers.keys()])]
  const identities = await payrollIdentityByTrainerId(db, trainerIds)
  const itemByTrainerId = new Map(itemValues.map((item) => [item.trainerId, item]))
  const items = trainerIds.map((trainerId) => {
    const stored = itemByTrainerId.get(trainerId) || {}
    const teachingSlots = teaching.trainers.get(trainerId) || []
    const grossAmount = teachingSlots.reduce((total, slot) => total + slot.rate, 0)
    const adjustmentAmount = Number(stored.adjustmentAmount || 0)
    return {
      ...stored,
      trainerId,
      trainerSnapshot: identities.get(trainerId),
      sessionCount: teachingSlots.length,
      attendanceEventCount: teachingSlots.reduce((total, slot) => total + slot.attendanceEventIds.length, 0),
      teachingDayCount: new Set(teachingSlots.map((slot) => slot.date)).size,
      teachingSlots,
      tierSummary: payrollTierSummary(teachingSlots),
      grossAmount,
      adjustmentAmount,
      finalAmount: grossAmount + adjustmentAmount,
      requiresRebuild: true,
      storedSessionCount: Number(stored.sessionCount || 0),
      evidenceSource: 'attendanceEvents+sessions:legacy-preview',
    }
  })
  const grossAmount = items.reduce((total, item) => total + item.grossAmount, 0)
  const adjustmentAmount = items.reduce((total, item) => total + item.adjustmentAmount, 0)
  return {
    items,
    summary: {
      trainerCount: items.length,
      attendanceEventCount: items.reduce((total, item) => total + item.attendanceEventCount, 0),
      teachingSlotCount: items.reduce((total, item) => total + item.sessionCount, 0),
      grossAmount,
      adjustmentAmount,
      finalAmount: grossAmount + adjustmentAmount,
    },
  }
}

function createPayrollFunctions({ db, onCall, logger = console }) {
  // Payroll is a low-volume administrative workflow. Fractional Gen-1 CPU
  // keeps new revisions deployable even when the regional Cloud Run CPU quota
  // is tight; concurrency must remain one for fractional CPU functions.
  const payrollCall = (handler) => onCall({
    cpu: 'gcf_gen1',
    memory: '256MiB',
    maxInstances: 1,
    concurrency: 1,
    timeoutSeconds: 300,
  }, handler)
  // Creating a run initializes Firestore transactions and snapshots a complete
  // business period. Keep the regular read endpoints lean, but give this one
  // deterministic write enough headroom to avoid container termination.
  const payrollHeavyCall = (handler) => onCall({
    cpu: 'gcf_gen1',
    memory: '512MiB',
    maxInstances: 1,
    concurrency: 1,
    timeoutSeconds: 300,
  }, handler)

  const listPayrollPolicies = payrollCall(async (request) => {
    await payrollActor(request, db)
    const [snapshot, runSnapshot] = await Promise.all([
      db.collection('payrollPolicies').orderBy('effectiveFrom', 'desc').limit(100).get(),
      db.collection('payrollRuns').select('policyId', 'policyIds').limit(500).get(),
    ])
    const usage = new Map()
    runSnapshot.docs.forEach((item) => {
      const data = item.data()
      const policyIds = Array.isArray(data.policyIds) && data.policyIds.length
        ? data.policyIds
        : data.policyId ? [data.policyId] : []
      new Set(policyIds).forEach((policyId) => usage.set(policyId, Number(usage.get(policyId) || 0) + 1))
    })
    const usageInventoryTruncated = runSnapshot.size === 500
    return {
      policies: snapshot.docs.map((item) => {
        const data = item.data()
        const usageCount = Number(usage.get(item.id) || 0)
        return {
          id: item.id,
          name: data.name || 'Chính sách lương PT',
          version: Number(data.version || 1),
          effectiveFrom: iso(data.effectiveFrom),
          ratePerSession: Number(data.ratePerSession || 0),
          dailySessionThreshold: Number(data.dailySessionThreshold || 8),
          rateAfterDailyThreshold: Number(data.rateAfterDailyThreshold || data.ratePerSession || 0),
          eveningStartHour: Number(data.eveningStartHour ?? 20),
          rateAfterDailyThresholdEvening: Number(data.rateAfterDailyThresholdEvening || data.rateAfterDailyThreshold || data.ratePerSession || 0),
          audience: policyAudience(data.audience),
          eligibleProfiles: payrollPolicyProfiles(data.eligibleProfiles, policyAudience(data.audience)),
          status: data.status === 'inactive' ? 'inactive' : 'active',
          usageCount,
          canDelete: usageCount === 0 && !usageInventoryTruncated,
          createdAt: iso(data.createdAt),
        }
      }),
    }
  })

  const savePayrollPolicy = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const effective = policyEffectiveDate(request.data?.effectiveFrom)
    const rates = payrollPolicyConfiguration(request.data || {})
    const name = policyName(request.data?.name)
    const requestedAudience = policyAudience(request.data?.audience)
    const eligibleProfiles = payrollPolicyProfiles(request.data?.eligibleProfiles, requestedAudience)
    const audience = policyAudienceFromProfiles(eligibleProfiles)
    if (eligibleProfiles.includes('collaborator')) {
      const collaboratorRates = [rates.ratePerSession, rates.rateAfterDailyThreshold, rates.rateAfterDailyThresholdEvening]
      if (collaboratorRates.some((rate) => rate < 50_000 || rate > 100_000)) {
        throw new HttpsError('invalid-argument', 'Chính sách CTV phải có đơn giá từ 50.000đ đến 100.000đ mỗi ca.')
      }
    }
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ name, audience, eligibleProfiles, effectiveFrom: effective.value, ...rates }))
      .digest('hex')
      .slice(0, 16)
    const policyId = `policy_${effective.value.replaceAll('-', '')}_${fingerprint}`
    const reference = db.doc(`payrollPolicies/${policyId}`)
    return db.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference)
      if (existing.exists) {
        const data = existing.data()
        if (data.name === name
          && policyAudience(data.audience) === audience
          && JSON.stringify(payrollPolicyProfiles(data.eligibleProfiles, policyAudience(data.audience))) === JSON.stringify(eligibleProfiles)
          && Number(data.ratePerSession || 0) === rates.ratePerSession
          && Number(data.dailySessionThreshold || 8) === rates.dailySessionThreshold
          && Number(data.rateAfterDailyThreshold || data.ratePerSession || 0) === rates.rateAfterDailyThreshold
          && Number(data.eveningStartHour ?? 20) === rates.eveningStartHour
          && Number(data.rateAfterDailyThresholdEvening || data.rateAfterDailyThreshold || data.ratePerSession || 0) === rates.rateAfterDailyThresholdEvening
          && data.status !== 'inactive') {
          return { policyId, unchanged: true }
        }
        throw new HttpsError('already-exists', 'Chính sách trùng mã nhưng khác dữ liệu. Hãy đổi tên hoặc ngày hiệu lực.')
      }
      const version = Number(effective.value.replaceAll('-', ''))
      transaction.create(reference, {
        schemaVersion: 5,
        scope: 'global',
        audience,
        eligibleProfiles,
        name,
        version,
        effectiveFrom: effective.timestamp,
        ...rates,
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 5,
        policyId,
        action: 'payroll.policy.created',
        actorUid: actor.uid,
        snapshot: { name, audience, eligibleProfiles, version, effectiveFrom: effective.value, ...rates },
        createdAt: FieldValue.serverTimestamp(),
      })
      return { policyId, unchanged: false }
    })
  })

  const managePayrollPolicy = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const policyId = payrollDocumentId(request.data?.policyId, 'Mã chính sách')
    const action = request.data?.action
    if (!['hide', 'restore', 'delete'].includes(action)) {
      throw new HttpsError('invalid-argument', 'Thao tác chính sách không hợp lệ.')
    }
    const reference = db.doc(`payrollPolicies/${policyId}`)
    return db.runTransaction(async (transaction) => {
      const [snapshot, legacyUsage, multiUsage] = await Promise.all([
        transaction.get(reference),
        transaction.get(db.collection('payrollRuns').where('policyId', '==', policyId).limit(1)),
        transaction.get(db.collection('payrollRuns').where('policyIds', 'array-contains', policyId).limit(1)),
      ])
      if (!snapshot.exists) return { policyId, action, unchanged: true }
      const used = !legacyUsage.empty || !multiUsage.empty
      if (action === 'delete') {
        if (used) {
          throw new HttpsError('failed-precondition', 'Chính sách đã được dùng trong kỳ lương nên chỉ có thể ẩn.')
        }
        transaction.delete(reference)
      } else {
        const nextStatus = action === 'hide' ? 'inactive' : 'active'
        if ((snapshot.data().status === 'inactive' ? 'inactive' : 'active') === nextStatus) {
          return { policyId, action, unchanged: true }
        }
        transaction.update(reference, {
          status: nextStatus,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
      }
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 3,
        policyId,
        action: `payroll.policy.${action}`,
        actorUid: actor.uid,
        usageProtected: used,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { policyId, action, unchanged: false }
    })
  })

  const listPayrollAdjustments = payrollCall(async (request) => {
    await payrollActor(request, db)
    const periodId = period(request.data?.periodId)
    const snapshot = await db.collection('payrollAdjustments').where('periodId', '==', periodId).limit(1001).get()
    if (snapshot.size > 1000) {
      throw payrollViolationError(
        'PAYROLL_ADJUSTMENT_LIMIT_EXCEEDED',
        'Quá nhiều khoản thưởng/phạt trong kỳ',
        'Kỳ lương có hơn 1.000 khoản thưởng hoặc phạt. Hãy gộp các khoản cùng nhân viên trước khi lập kỳ.',
        'policy',
        { periodId },
        'resource-exhausted',
      )
    }
    return {
      adjustments: snapshot.docs
        .map((item) => ({ id: item.id, ...item.data(), createdAt: iso(item.data().createdAt), voidedAt: iso(item.data().voidedAt) }))
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))),
    }
  })

  const savePayrollAdjustment = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const periodId = period(request.data?.periodId)
    const staffId = payrollDocumentId(request.data?.staffId, 'Mã nhân viên')
    const type = payrollAdjustmentType(request.data?.type)
    const amount = payrollAdjustmentAmount(request.data?.amount)
    const reason = payrollAdjustmentText(request.data?.reason, 'Lý do thưởng/phạt', 5, 500)
    const evidenceReference = typeof request.data?.evidenceReference === 'string'
      ? request.data.evidenceReference.trim().replace(/\s+/g, ' ').slice(0, 200)
      : ''
    const requestId = payrollDocumentId(request.data?.requestId, 'Mã yêu cầu')
    const adjustmentId = `adjustment_${createHash('sha256').update(`${actor.uid}|${requestId}`).digest('hex').slice(0, 24)}`
    const reference = db.doc(`payrollAdjustments/${adjustmentId}`)
    const runReference = db.doc(`payrollRuns/${periodId}`)
    const staffReference = db.doc(`staff/${staffId}`)
    const trainerReference = db.doc(`trainers/${staffId}`)
    return db.runTransaction(async (transaction) => {
      const [existing, run, staffSnapshot, trainerSnapshot] = await Promise.all([
        transaction.get(reference),
        transaction.get(runReference),
        transaction.get(staffReference),
        transaction.get(trainerReference),
      ])
      if (existing.exists) return { adjustmentId, unchanged: true }
      if (run.exists) {
        const status = run.data().status || 'draft'
        throw payrollViolationError(
          status === 'draft' ? 'PAYROLL_DRAFT_REBUILD_REQUIRED' : 'PAYROLL_RUN_IMMUTABLE',
          status === 'draft' ? 'Kỳ nháp cần được lập lại' : 'Kỳ lương đã khóa bằng chứng',
          status === 'draft'
            ? 'Hãy xóa kỳ nháp, lưu thưởng/phạt rồi tạo lại để snapshot và tổng tiền khớp nhau.'
            : 'Không thể sửa kỳ đã duyệt, khóa hoặc chi. Hãy ghi khoản bù trừ có lý do vào kỳ lương tiếp theo.',
          'delete_rebuild',
          { periodId, staffId, runStatus: status },
        )
      }
      const staff = staffSnapshot.exists ? staffSnapshot.data() : trainerSnapshot.exists ? trainerSnapshot.data() : null
      if (!staff || staff.status === 'inactive') {
        throw payrollViolationError(
          'PAYROLL_STAFF_NOT_FOUND',
          'Không tìm thấy nhân viên đang hoạt động',
          'Hãy kiểm tra hồ sơ đội ngũ và trạng thái làm việc trước khi ghi thưởng/phạt.',
          'staff_profile',
          { periodId, staffId },
          'not-found',
        )
      }
      const staffName = payrollIdentityName(staff) || staffId
      transaction.create(reference, {
        schemaVersion: 1,
        periodId,
        staffId,
        staffSnapshot: { name: staffName, employeeCode: staff.employeeCode || '', branchId: staff.branchId || '' },
        type,
        amount,
        reason,
        evidenceReference,
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 6,
        action: 'payroll.adjustment.created',
        adjustmentId,
        periodId,
        staffId,
        type,
        amount,
        reason,
        evidenceReference,
        actorUid: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { adjustmentId, unchanged: false }
    })
  })

  const voidPayrollAdjustment = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const adjustmentId = payrollDocumentId(request.data?.adjustmentId, 'Mã thưởng/phạt')
    const reference = db.doc(`payrollAdjustments/${adjustmentId}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists || snapshot.data().status === 'voided') return { adjustmentId, unchanged: true }
      const value = snapshot.data()
      const run = await transaction.get(db.doc(`payrollRuns/${period(value.periodId)}`))
      if (run.exists) {
        const status = run.data().status || 'draft'
        throw payrollViolationError(
          status === 'draft' ? 'PAYROLL_DRAFT_REBUILD_REQUIRED' : 'PAYROLL_RUN_IMMUTABLE',
          status === 'draft' ? 'Kỳ nháp cần được lập lại' : 'Kỳ lương đã khóa bằng chứng',
          status === 'draft'
            ? 'Hãy xóa kỳ nháp trước, sau đó mới hủy khoản thưởng/phạt và tạo lại kỳ.'
            : 'Khoản này đã nằm trong kỳ đã duyệt, khóa hoặc chi. Hãy tạo một khoản bù trừ ở kỳ tiếp theo thay vì sửa chứng từ cũ.',
          'delete_rebuild',
          { periodId: value.periodId, staffId: value.staffId, runStatus: status, adjustmentId },
        )
      }
      transaction.update(reference, {
        status: 'voided',
        voidedAt: FieldValue.serverTimestamp(),
        voidedBy: actor.uid,
      })
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 6,
        action: 'payroll.adjustment.voided',
        adjustmentId,
        periodId: value.periodId,
        staffId: value.staffId,
        type: value.type,
        amount: Number(value.amount || 0),
        actorUid: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { adjustmentId, unchanged: false }
    })
  })

  const listPayrollRuns = payrollCall(async (request) => {
    await payrollActor(request, db)
    const limit = Math.min(36, Math.max(1, Number.isInteger(request.data?.limit) ? request.data.limit : 18))
    const snapshot = await db.collection('payrollRuns').orderBy('createdAt', 'desc').limit(limit).get()
    return {
      runs: snapshot.docs.map((item) => {
        const data = item.data()
        const storedTeachingSlotCount = Number(data.teachingSlotCount ?? data.attendanceCount ?? 0)
        return {
          id: item.id,
          periodId: data.periodId || '',
          policyVersion: Number(data.policyVersion || 1),
          policyName: data.policyName || data.policySnapshot?.name || '',
          policyIds: Array.isArray(data.policyIds) ? data.policyIds : data.policyId ? [data.policyId] : [],
          policyApplicationMode: data.policyApplicationMode || 'single',
          status: data.status || 'draft',
          requiresRebuild: data.requiresRebuild === true || data.sourceDataStale === true || Number(data.schemaVersion || 0) < 7 || Number(data.commissionFormulaVersion || 0) < 2,
          storedTeachingSlotCount,
          attendanceCount: storedTeachingSlotCount,
          teachingSlotCount: storedTeachingSlotCount,
          attendanceEventCount: Number(data.attendanceEventCount ?? data.attendanceCount ?? 0),
          trainerCount: Number(data.trainerCount || 0),
          staffCount: Number(data.staffCount || data.trainerCount || 0),
          workdayStaffCount: Number(data.workdayStaffCount || 0),
          attendanceReviewRequiredCount: Number(data.attendanceReviewRequiredCount || 0),
          calendarReviewRequiredCount: Number(data.calendarReviewRequiredCount || 0),
          attendanceReviewRequired: data.attendanceReviewRequired === true,
          baseSalaryAmount: Number(data.baseSalaryAmount || 0),
          teachingPayAmount: Number(data.teachingPayAmount || 0),
          commissionAmount: Number(data.commissionAmount || 0),
          bonusAmount: Number(data.bonusAmount || 0),
          deductionAmount: Number(data.deductionAmount || 0),
          grossAmount: Number(data.grossAmount || 0),
          adjustmentAmount: Number(data.adjustmentAmount || 0),
          finalAmount: Number(data.finalAmount || data.grossAmount || 0),
          createdAt: iso(data.createdAt),
          updatedAt: iso(data.updatedAt),
        }
      }),
    }
  })

  const getPayrollRun = payrollCall(async (request) => {
    await payrollActor(request, db)
    const runId = typeof request.data?.runId === 'string' ? request.data.runId.trim() : ''
    if (!runId) throw new HttpsError('invalid-argument', 'Mã kỳ lương không hợp lệ.')
    const [run, items] = await Promise.all([
      db.doc(`payrollRuns/${runId}`).get(),
      db.collection('payrollRunItems').where('runId', '==', runId).limit(500).get(),
    ])
    if (!run.exists) throw new HttpsError('not-found', 'Không tìm thấy kỳ lương.')
    const runData = run.data()
    const itemValues = items.docs.map((item) => ({ id: item.id, ...item.data() }))
    const teachingRequiresRebuild = Number(runData.schemaVersion || 0) < 5 || itemValues.some((item) => !Array.isArray(item.teachingSlots))
    const requiresRebuild = runData.requiresRebuild === true || runData.sourceDataStale === true || teachingRequiresRebuild || Number(runData.schemaVersion || 0) < 7 || Number(runData.commissionFormulaVersion || 0) < 2
    let responseItems = itemValues
    let previewSummary = null
    if (teachingRequiresRebuild && runData.status === 'draft') {
      const preview = await legacyPayrollPreview(db, runData, itemValues)
      responseItems = preview.items
      previewSummary = preview.summary
    } else {
      const trainerIds = [...new Set(itemValues.map((item) => item.trainerId).filter(Boolean))]
      const identities = await payrollIdentityByTrainerId(db, trainerIds)
      responseItems = itemValues.map((item) => ({
        ...item,
        trainerSnapshot: payrollIdentityName(item.trainerSnapshot) ? item.trainerSnapshot : identities.get(item.trainerId),
      }))
    }
    return {
      run: {
        id: run.id,
        ...runData,
        ...(previewSummary || {}),
        attendanceCount: previewSummary?.teachingSlotCount ?? Number(runData.teachingSlotCount ?? runData.attendanceCount ?? 0),
        requiresRebuild,
        storedTeachingSlotCount: Number(runData.teachingSlotCount ?? runData.attendanceCount ?? 0),
        createdAt: iso(runData.createdAt),
        updatedAt: iso(runData.updatedAt),
      },
      items: responseItems.map((data) => {
        return {
          id: data.id,
          ...data,
          sessionCount: Number(data.sessionCount || 0),
          attendanceEventCount: Number(data.attendanceEventCount || data.sessionCount || 0),
          teachingSlots: Array.isArray(data.teachingSlots) ? data.teachingSlots : [],
          tierSummary: data.tierSummary && typeof data.tierSummary === 'object' ? data.tierSummary : {},
          ratePerSession: Number(data.ratePerSession || 0),
          baseSalaryAmount: Number(data.baseSalaryAmount || 0),
          teachingPayAmount: Number(data.teachingPayAmount ?? data.grossAmount ?? 0),
          commissionAmount: Number(data.commissionAmount || 0),
          bonusAmount: Number(data.bonusAmount || 0),
          deductionAmount: Number(data.deductionAmount || 0),
          workdaySummary: data.workdaySummary && typeof data.workdaySummary === 'object' ? data.workdaySummary : {},
          workdayDays: Array.isArray(data.workdayDays) ? data.workdayDays : [],
          attendanceReviewRequired: data.attendanceReviewRequired === true,
          calendarReviewRequired: data.calendarReviewRequired === true,
          grossAmount: Number(data.grossAmount || 0),
          adjustmentAmount: Number(data.adjustmentAmount || 0),
          finalAmount: Number(data.finalAmount || data.grossAmount || 0),
          createdAt: iso(data.createdAt),
        }
      }),
    }
  })

  const createPayrollRun = payrollHeavyCall(async (request) => {
    const actor = await payrollActor(request, db)
    const periodId = period(request.data?.periodId)
    const { start, end } = periodBounds(periodId)
    const dateBounds = periodDateBounds(periodId)
    const requestedPlan = payrollRunPolicyPlan(request.data || {})
    // One deterministic document per business period prevents two admins from
    // creating duplicate payroll runs concurrently.
    const runReference = db.doc(`payrollRuns/${periodId}`)
    try {
      return await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(runReference)
      if (existing.exists) return { runId: existing.id, unchanged: true, status: existing.data().status }

      const [sessionSnapshot, staffSnapshot, trainerRecordsSnapshot, assignmentSnapshot, workdayAttendanceSnapshot, calendarSnapshot, schedulePolicySnapshot, referralLedgerSnapshot, adjustmentSnapshot] = await Promise.all([
        transaction.get(db.collection('sessions')
          .where('date', '>=', dateBounds.start)
          .where('date', '<', dateBounds.end)
          .select('status', 'trainerId', 'studentId', 'date', 'hour', 'branchId', 'attendanceEventId')
          .limit(3001)),
        transaction.get(db.collection('staff').limit(451)),
        transaction.get(db.collection('trainers').limit(451)),
        transaction.get(db.collection('roleAssignments').where('accessRole', '==', 'staff').limit(451)),
        transaction.get(db.collection('staffAttendanceDays').where('periodId', '==', periodId).limit(5001)),
        transaction.get(db.collection('workCalendars').where('periodId', '==', periodId).limit(101)),
        transaction.get(db.doc('settings/scheduleConfig')),
        transaction.get(db.collection('ledgerEntries')
          .where('effectiveAt', '>=', start)
          .where('effectiveAt', '<', end)
          .select('type', 'status', 'cashImpact', 'amount', 'contractId', 'referralCode', 'referralStaffId', 'referralCommissionRate')
          .limit(5001)),
        transaction.get(db.collection('payrollAdjustments').where('periodId', '==', periodId).limit(1001)),
      ])
      if (sessionSnapshot.size > 3000 || staffSnapshot.size > 450 || trainerRecordsSnapshot.size > 450 || assignmentSnapshot.size > 450 || workdayAttendanceSnapshot.size > 5000 || calendarSnapshot.size > 100 || referralLedgerSnapshot.size > 5000 || adjustmentSnapshot.size > 1000) {
        throw payrollViolationError(
          'PAYROLL_DATA_LIMIT_EXCEEDED',
          'Dữ liệu kỳ lương vượt giới hạn an toàn',
          'Kỳ lương có quá nhiều ca, nhân sự, ngày công hoặc khoản điều chỉnh để lập trong một giao dịch. Hãy liên hệ quản trị để chia nhỏ và đối soát dữ liệu nguồn.',
          'retry',
          {
            periodId,
            sessionCount: sessionSnapshot.size,
            staffCount: staffSnapshot.size,
            attendanceDayCount: workdayAttendanceSnapshot.size,
            adjustmentCount: adjustmentSnapshot.size,
          },
          'resource-exhausted',
        )
      }
      const trainerRecordById = new Map(trainerRecordsSnapshot.docs.map((item) => [item.id, item.data() || {}]))
      const staffRecordById = new Map(staffSnapshot.docs
        .map((item) => ({ id: item.id, userId: item.id, ...(trainerRecordById.get(item.id) || {}), ...item.data() }))
        .filter((item) => item.status !== 'inactive')
        .map((item) => [item.id, item]))
      assignmentSnapshot.docs.forEach((item) => {
        const assignment = item.data()
        if (assignment.status === 'suspended' || assignment.status === 'invited') return
        const operationalId = typeof assignment.crmProfileId === 'string' && assignment.crmProfileId ? assignment.crmProfileId : item.id
        const existing = staffRecordById.get(operationalId) || {}
        staffRecordById.set(operationalId, {
          ...(trainerRecordById.get(operationalId) || {}),
          ...existing,
          id: operationalId,
          userId: item.id,
          branchId: existing.branchId || assignment.branchIds?.[0] || '',
          status: existing.status || 'active',
        })
      })
      const referralLedgerDocuments = referralLedgerSnapshot.docs.filter((item) => referralCashImpact(item) !== 0)
      const referralContractIds = [...new Set(referralLedgerDocuments.map((item) => String(item.data()?.contractId || '')).filter(Boolean))]
      if (referralContractIds.length > 450) throw payrollViolationError(
        'REFERRAL_CONTRACT_LIMIT_EXCEEDED',
        'Quá nhiều hợp đồng giới thiệu cần đối soát',
        'Kỳ lương có hơn 450 hợp đồng giới thiệu có dòng tiền. Hãy đối soát dữ liệu hoa hồng trước khi lập kỳ.',
        'retry',
        { periodId, referralContractCount: referralContractIds.length },
        'resource-exhausted',
      )
      const referralContractSnapshots = await Promise.all(referralContractIds.map((contractId) => transaction.get(db.doc(`contracts/${contractId}`))))
      const referralEvidence = calculateReferralCommissions({
        ledgerEntries: referralLedgerDocuments,
        contracts: referralContractSnapshots,
        staffRecords: [...staffRecordById.values()],
      })
      let policyDocuments
      if (requestedPlan.selectedPolicyIds.length) {
        policyDocuments = await Promise.all(requestedPlan.selectedPolicyIds.map((policyId) => transaction.get(db.doc(`payrollPolicies/${policyId}`))))
      } else if (requestedPlan.applicationMode === 'staff_profile') {
        const compatible = await transaction.get(db.collection('payrollPolicies').where('effectiveFrom', '<', end).orderBy('effectiveFrom', 'desc').limit(100))
        policyDocuments = compatible.docs.filter((item) => item.data().status !== 'inactive')
      } else {
        const fallback = await transaction.get(db.collection('payrollPolicies').where('effectiveFrom', '<=', start).orderBy('effectiveFrom', 'desc').limit(20))
        policyDocuments = fallback.docs.filter((item) => item.data().status !== 'inactive').slice(0, 1)
      }
      const selectedPolicies = policyDocuments.map(payrollPolicyRecord)
      if (!selectedPolicies.length) throw payrollViolationError(
        'PAYROLL_POLICY_MISSING',
        'Chưa có chính sách lương hiệu lực',
        'Hãy tạo hoặc chọn ít nhất một chính sách có ngày hiệu lực không sau kỳ lương.',
        'policy',
        { periodId },
      )
      if (selectedPolicies.some((policy) => policy.status !== 'active')) {
        throw payrollViolationError(
          'PAYROLL_POLICY_INACTIVE',
          'Chính sách đã chọn đang bị ẩn',
          'Mở lại chính sách hoặc chọn một chính sách đang hoạt động rồi tạo lại kỳ.',
          'policy',
          { periodId, policyIds: selectedPolicies.filter((policy) => policy.status !== 'active').map((policy) => policy.id) },
        )
      }
      const staffWithoutCompatiblePolicy = [...staffRecordById.entries()].find(([, staff]) => {
        const profile = payrollProfile(staff)
        return !selectedPolicies.some((policy) => policySupportsProfile(policy, profile))
      })
      if (staffWithoutCompatiblePolicy) {
        const [staffId, staff] = staffWithoutCompatiblePolicy
        const profile = payrollProfile(staff)
        if (profile === 'collaborator') {
          throw payrollViolationError(
            'STAFF_POLICY_INCOMPATIBLE',
            'CTV chưa có chính sách phù hợp',
            `CTV ${staff.name || staff.displayName || staffId} cần được gán chính sách CTV trước khi lập kỳ lương.`,
            'staff_profile',
            { periodId, staffId, staffName: staff.name || staff.displayName || staffId, payrollProfile: profile },
          )
        }
        throw payrollViolationError(
          'STAFF_POLICY_INCOMPATIBLE',
          'Nhân viên chưa có chính sách phù hợp',
          `Nhân viên ${staff.name || staff.displayName || staffId} chưa có chính sách phù hợp với hồ sơ ${profile}.`,
          'staff_profile',
          { periodId, staffId, staffName: staff.name || staff.displayName || staffId, payrollProfile: profile },
        )
      }
      const policyIds = selectedPolicies.map((policy) => policy.id)
      const defaultPolicyId = requestedPlan.defaultPolicyId || policyIds[0]
      if (!policyIds.includes(defaultPolicyId)) {
        throw payrollViolationError(
          'PAYROLL_DEFAULT_POLICY_NOT_SELECTED',
          'Chính sách mặc định chưa được chọn',
          'Chính sách mặc định phải nằm trong danh sách chính sách được áp dụng cho kỳ.',
          'policy',
          { periodId, policyId: defaultPolicyId },
          'invalid-argument',
        )
      }
      for (const policyId of requestedPlan.trainerAssignments.values()) {
        if (!policyIds.includes(policyId)) throw payrollViolationError(
          'TRAINER_POLICY_NOT_SELECTED',
          'Phân chính sách PT không hợp lệ',
          'Một PT đang được gán chính sách nằm ngoài danh sách đã chọn. Hãy chọn lại chính sách cho PT.',
          'policy',
          { periodId, policyId },
          'invalid-argument',
        )
      }
      if (requestedPlan.applicationMode === 'effective_date' && new Set(selectedPolicies.map((policy) => policy.effectiveDate)).size !== selectedPolicies.length) {
        throw payrollViolationError(
          'PAYROLL_POLICY_EFFECTIVE_DATE_DUPLICATED',
          'Chính sách bị trùng ngày hiệu lực',
          'Khi áp theo ngày, mỗi chính sách phải có một ngày hiệu lực khác nhau.',
          'policy',
          { periodId, policyIds },
          'invalid-argument',
        )
      }
      const policyPlan = {
        ...requestedPlan,
        defaultPolicyId,
        staffProfiles: new Map([...staffRecordById].map(([staffId, staff]) => [staffId, payrollProfile(staff)])),
        staffPolicyAssignments: new Map([...staffRecordById]
          .filter(([, staff]) => typeof staff.payrollPolicyId === 'string' && staff.payrollPolicyId)
          .map(([staffId, staff]) => [staffId, staff.payrollPolicyId])),
      }
      const groupedTeaching = teachingSlotsFromSessions(sessionSnapshot.docs, selectedPolicies[0].configuration)
      const teaching = applyPayrollPolicyPlan(groupedTeaching, policyPlan, selectedPolicies)
      const activeAdjustments = adjustmentSnapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => item.status !== 'voided' && (item.type === 'bonus' || item.type === 'deduction') && Number(item.amount || 0) > 0)
      const activeStaff = [...staffRecordById.values()]
      const staffIds = [...new Set([...activeStaff.map((item) => item.id), ...teaching.trainers.keys(), ...activeAdjustments.map((item) => item.staffId).filter(Boolean)])]
      if (staffIds.length > 450) throw payrollViolationError(
        'PAYROLL_STAFF_LIMIT_EXCEEDED',
        'Quá nhiều nhân sự trong kỳ',
        'Kỳ lương có hơn 450 nhân sự nên chưa thể tạo snapshot an toàn trong một giao dịch.',
        'retry',
        { periodId, staffCount: staffIds.length },
        'resource-exhausted',
      )
      const identitySnapshots = await Promise.all(staffIds.flatMap((staffId) => [
        transaction.get(db.doc(`trainers/${staffId}`)),
        transaction.get(db.doc(`users/${staffRecordById.get(staffId)?.userId || staffId}`)),
      ]))
      const identityById = new Map()
      staffIds.forEach((staffId, index) => {
        const trainer = identitySnapshots[index * 2]?.exists ? identitySnapshots[index * 2].data() : {}
        const staff = staffRecordById.get(staffId) || {}
        const user = identitySnapshots[index * 2 + 1]?.exists ? identitySnapshots[index * 2 + 1].data() : {}
        identityById.set(staffId, {
          name: staff.name || staff.fullName || staff.displayName || trainer.name || trainer.fullName || trainer.displayName || user.name || user.fullName || user.displayName || '',
          employeeCode: staff.employeeCode || trainer.employeeCode || '',
          branchId: staff.branchId || trainer.branchId || user.branchId || '',
        })
      })
      const workdayAttendanceByStaff = new Map()
      workdayAttendanceSnapshot.docs.forEach((item) => {
        const value = item.data()
        const current = workdayAttendanceByStaff.get(value.staffId) || []
        current.push({ id: item.id, ...value })
        workdayAttendanceByStaff.set(value.staffId, current)
      })
      const calendars = new Map(calendarSnapshot.docs.map((item) => [item.data().branchId || 'global', item.data()]))
      const globalCalendar = calendars.get('global') || {}
      const schedulePolicy = schedulePolicySnapshot.exists ? schedulePolicySnapshot.data() : {}
      const defaultPolicy = selectedPolicies.find((policy) => policy.id === defaultPolicyId) || selectedPolicies[0]
      const selectedPolicyById = new Map(selectedPolicies.map((policy) => [policy.id, policy]))
      const policySnapshots = selectedPolicies.map(payrollPolicySnapshot)
      const policyName = selectedPolicies.length === 1 ? selectedPolicies[0].name : `${selectedPolicies.length} chính sách linh hoạt`
      const adjustmentsByStaff = new Map()
      activeAdjustments.forEach((item) => {
        const current = adjustmentsByStaff.get(item.staffId) || []
        current.push(item)
        adjustmentsByStaff.set(item.staffId, current)
      })
      const itemRecords = staffIds.map((staffId) => {
        const staff = { ...(trainerRecordById.get(staffId) || {}), ...(staffRecordById.get(staffId) || {}) }
        const identity = identityById.get(staffId) || {}
        const calendar = mergeWorkCalendar(periodId, globalCalendar, calendars.get(identity.branchId) || {}, schedulePolicy)
        const teachingSlots = teaching.trainers.get(staffId) || []
        const workdays = calculateWorkdayPayroll({
          periodId,
          calendar,
          attendance: workdayAttendanceByStaff.get(staffId) || [],
          teachingSlots,
          staff,
          today: vietnamDateKey(new Date()),
        })
        const teachingPayAmount = teachingSlots.reduce((total, slot) => total + slot.rate, 0)
        const referral = referralEvidence.byStaff.get(staffId) || {
          cashCollectedAmount: 0, cashReversedAmount: 0, netCashAmount: 0,
          commissionAmount: 0, reversalAmount: 0, contractCount: 0, evidence: [], rate: 0,
        }
        const baseAmounts = payrollAmounts(workdays, {
          grossAmount: teachingPayAmount,
          commissionAmount: referral.commissionAmount,
          deductionAmount: referral.reversalAmount,
        })
        const payrollAdjustments = adjustmentsByStaff.get(staffId) || []
        const manualBonusAmount = payrollAdjustments
          .filter((item) => item.type === 'bonus')
          .reduce((total, item) => total + Number(item.amount || 0), 0)
        const manualDeductionAmount = payrollAdjustments
          .filter((item) => item.type === 'deduction')
          .reduce((total, item) => total + Number(item.amount || 0), 0)
        const amounts = {
          ...baseAmounts,
          bonusAmount: baseAmounts.bonusAmount + manualBonusAmount,
          deductionAmount: baseAmounts.deductionAmount + manualDeductionAmount,
          grossAmount: baseAmounts.grossAmount + manualBonusAmount,
          finalAmount: Math.max(0, baseAmounts.finalAmount + manualBonusAmount - manualDeductionAmount),
        }
        const itemPolicyIds = [...new Set(teachingSlots.map((slot) => slot.policyId).filter(Boolean))]
        const staffPayrollProfile = payrollProfile(staff)
        const unsupportedPolicy = itemPolicyIds
          .map((policyId) => selectedPolicyById.get(policyId))
          .find((policy) => policy && !policySupportsProfile(policy, staffPayrollProfile))
        if (unsupportedPolicy) {
          throw payrollViolationError(
            'STAFF_POLICY_INCOMPATIBLE',
            'Chính sách không phù hợp hồ sơ nhân viên',
            `Chính sách ${unsupportedPolicy.name} không áp dụng cho nhóm lương của ${identity.name || staffId}.`,
            'staff_profile',
            { periodId, staffId, staffName: identity.name || staffId, payrollProfile: staffPayrollProfile, policyId: unsupportedPolicy.id },
          )
        }
        return { staffId, staff, identity, calendar, workdays, teachingSlots, amounts, baseAmounts, referral, itemPolicyIds, staffPayrollProfile, payrollAdjustments, manualBonusAmount, manualDeductionAmount }
      })
      const grossAmount = itemRecords.reduce((total, item) => total + item.amounts.grossAmount, 0)
      const finalAmount = itemRecords.reduce((total, item) => total + item.amounts.finalAmount, 0)
      const workdayStaffCount = itemRecords.filter((item) => item.workdays.workdayEnabled).length
      const attendanceReviewRequiredCount = itemRecords.filter((item) => item.workdays.attendanceReviewRequired).length
      const calendarReviewRequiredCount = itemRecords.filter((item) => item.workdays.calendarReviewRequired).length
      transaction.create(runReference, {
        schemaVersion: 7,
        commissionFormulaVersion: 2,
        revision: 1,
        periodId,
        policyId: defaultPolicy.id,
        policyIds,
        policyVersion: defaultPolicy.version,
        policyName,
        policySnapshot: payrollPolicySnapshot(defaultPolicy),
        policySnapshots,
        policyApplicationMode: selectedPolicies.length === 1 ? 'single' : policyPlan.applicationMode,
        trainerPolicyAssignments: Object.fromEntries(policyPlan.trainerAssignments),
        status: 'draft',
        attendanceCount: teaching.teachingSlotCount,
        teachingSlotCount: teaching.teachingSlotCount,
        attendanceEventCount: teaching.attendanceEventCount,
        trainerCount: teaching.trainers.size,
        staffCount: itemRecords.length,
        workdayStaffCount,
        attendanceReviewRequired: attendanceReviewRequiredCount > 0 || calendarReviewRequiredCount > 0,
        attendanceReviewRequiredCount,
        calendarReviewRequiredCount,
        baseSalaryAmount: itemRecords.reduce((total, item) => total + item.amounts.baseSalaryAmount, 0),
        teachingPayAmount: itemRecords.reduce((total, item) => total + item.amounts.teachingPayAmount, 0),
        commissionAmount: itemRecords.reduce((total, item) => total + item.amounts.commissionAmount, 0),
        bonusAmount: itemRecords.reduce((total, item) => total + item.amounts.bonusAmount, 0),
        deductionAmount: itemRecords.reduce((total, item) => total + item.amounts.deductionAmount, 0),
        referralDiagnostics: {
          unresolvedEntryCount: referralEvidence.unresolvedEntryCount,
          ambiguousCodeEntryCount: referralEvidence.ambiguousCodeEntryCount,
          invalidRateEntryCount: referralEvidence.invalidRateEntryCount,
        },
        adjustmentCount: activeAdjustments.length,
        grossAmount,
        adjustmentAmount: 0,
        finalAmount,
        timeZone: 'Asia/Ho_Chi_Minh',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      for (const item of itemRecords) {
        const { staffId, identity, calendar, workdays, teachingSlots, amounts, baseAmounts, referral, itemPolicyIds, staffPayrollProfile, payrollAdjustments, manualBonusAmount, manualDeductionAmount } = item
        const itemReference = db.doc(`payrollRunItems/${periodId}_${staffId}`)
        const tierSummary = teachingSlots.reduce((result, slot) => {
          if (slot.tier === 'standard') { result.standardCount += 1; result.standardAmount += slot.rate }
          else if (slot.tier === 'after_threshold') { result.afterThresholdCount += 1; result.afterThresholdAmount += slot.rate }
          else { result.afterThresholdEveningCount += 1; result.afterThresholdEveningAmount += slot.rate }
          return result
        }, { standardCount: 0, standardAmount: 0, afterThresholdCount: 0, afterThresholdAmount: 0, afterThresholdEveningCount: 0, afterThresholdEveningAmount: 0 })
        transaction.create(itemReference, {
          schemaVersion: 7,
          commissionFormulaVersion: 2,
          runId: runReference.id,
          periodId,
          staffId,
          trainerId: staffId,
          staffSnapshot: { name: identity.name || 'Chưa cập nhật tên', employeeCode: identity.employeeCode || '', branchId: identity.branchId || '' },
          trainerSnapshot: { name: identity.name || 'Chưa cập nhật tên', branchId: identity.branchId || '' },
          employmentType: workdays.employmentType,
          employmentLevel: staffPayrollProfile === 'probation' || staffPayrollProfile === 'senior' ? staffPayrollProfile : 'official',
          payrollProfile: staffPayrollProfile,
          assignedPayrollPolicyId: typeof item.staff.payrollPolicyId === 'string' ? item.staff.payrollPolicyId : '',
          policyIds: itemPolicyIds,
          policySnapshots: policySnapshots.filter((policy) => itemPolicyIds.includes(policy.id)),
          sessionCount: teachingSlots.length,
          attendanceEventCount: teachingSlots.reduce((total, slot) => total + slot.attendanceEventIds.length, 0),
          teachingDayCount: new Set(teachingSlots.map((slot) => slot.date)).size,
          teachingSlots,
          tierSummary,
          ratePerSession: teachingSlots[0]?.rate || defaultPolicy.configuration.ratePerSession,
          baseSalarySnapshot: { monthlyAmount: workdays.baseSalary, dailyRate: workdays.dailyRate },
          workCalendarSnapshot: { periodId, branchId: identity.branchId || '', weeklyRestDays: calendar.weeklyRestDays, holidays: calendar.holidays, revision: calendar.revision, approved: calendar.approved },
          workdaySummary: {
            employmentType: workdays.employmentType,
            standardWorkdays: workdays.standardWorkdays,
            eligibleWorkdays: workdays.eligibleWorkdays,
            paidDays: workdays.paidDays,
            autoPaidDays: workdays.autoPaidDays,
            unpaidDays: workdays.unpaidDays,
            pendingDays: workdays.pendingDays,
            benefitReviewDays: workdays.benefitReviewDays,
            estimatedPaidDays: workdays.estimatedPaidDays,
          },
          workdayDays: workdays.days.filter((day) => day.eligible || day.status === 'paid_holiday'),
          attendanceReviewRequired: workdays.attendanceReviewRequired,
          calendarReviewRequired: workdays.calendarReviewRequired,
          baseSalaryAmount: amounts.baseSalaryAmount,
          teachingPayAmount: amounts.teachingPayAmount,
          commissionAmount: amounts.commissionAmount,
          referralCommission: {
            rate: referral.rate || 0,
            contractCount: referral.contractCount || 0,
            cashCollectedAmount: referral.cashCollectedAmount || 0,
            cashReversedAmount: referral.cashReversedAmount || 0,
            netCashAmount: referral.netCashAmount || 0,
            commissionAmount: referral.commissionAmount || 0,
            reversalAmount: referral.reversalAmount || 0,
            evidence: referral.evidence || [],
          },
          bonusAmount: amounts.bonusAmount,
          deductionAmount: amounts.deductionAmount,
          recurringBonusAmount: baseAmounts.bonusAmount,
          manualBonusAmount,
          manualDeductionAmount,
          payrollAdjustments: payrollAdjustments.map((adjustment) => ({
            id: adjustment.id,
            type: adjustment.type,
            amount: Number(adjustment.amount || 0),
            reason: adjustment.reason || '',
            evidenceReference: adjustment.evidenceReference || '',
          })),
          grossAmount: amounts.grossAmount,
          adjustmentAmount: 0,
          finalAmount: amounts.finalAmount,
          status: 'draft',
          evidenceSource: workdays.workdayEnabled ? 'staffAttendanceDays+sessions+ledgerEntries+contracts' : 'sessions+ledgerEntries+contracts',
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 5, runId: runReference.id, action: 'payroll.created', actorUid: actor.uid, toStatus: 'draft', policyIds, policyApplicationMode: selectedPolicies.length === 1 ? 'single' : policyPlan.applicationMode, staffCount: itemRecords.length, workdayStaffCount, attendanceReviewRequiredCount, calendarReviewRequiredCount, createdAt: FieldValue.serverTimestamp() })
      return { runId: runReference.id, unchanged: false, status: 'draft' }
      })
    } catch (cause) {
      if (isKnownHttpsError(cause)) throw cause
      const supportId = createHash('sha256')
        .update(`${periodId}|${Date.now()}|${cause?.message || cause?.code || 'unknown'}`)
        .digest('hex')
        .slice(0, 12)
        .toUpperCase()
      logger?.error?.('payroll_create_failed', {
        supportId,
        periodId,
        actorUid: actor.uid,
        code: cause?.code || '',
        message: cause?.message || String(cause || ''),
        stack: cause?.stack || '',
      })
      throw payrollViolationError(
        'PAYROLL_SERVICE_FAILURE',
        'Không thể hoàn tất đối soát kỳ lương',
        `Máy chủ không thể hoàn tất giao dịch. Hãy thử lại; nếu lỗi lặp lại, gửi mã đối soát ${supportId} cho quản trị kỹ thuật.`,
        'retry',
        { periodId, supportId },
        'internal',
      )
    }
  })

  const deleteDraftPayrollRun = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const runId = period(request.data?.runId)
    const runReference = db.doc(`payrollRuns/${runId}`)
    return db.runTransaction(async (transaction) => {
      const [run, items] = await Promise.all([
        transaction.get(runReference),
        transaction.get(db.collection('payrollRunItems').where('runId', '==', runId).limit(451)),
      ])
      if (!run.exists) return { runId, unchanged: true }
      if (run.data().status !== 'draft') {
        throw new HttpsError('failed-precondition', 'Chỉ kỳ lương chưa duyệt mới được xóa để lập lại.')
      }
      if (items.size > 450) throw new HttpsError('resource-exhausted', 'Kỳ lương có quá nhiều dòng để xóa an toàn.')
      items.docs.forEach((item) => transaction.delete(item.ref))
      transaction.delete(runReference)
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 4,
        runId,
        action: 'payroll.draft.deleted',
        actorUid: actor.uid,
        deletedItemCount: items.size,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { runId, unchanged: false }
    })
  })

  async function transition(request, from, to, fields = {}) {
    const actor = await payrollActor(request, db)
    const runId = typeof request.data?.runId === 'string' ? request.data.runId.trim() : ''
    if (!runId) throw new HttpsError('invalid-argument', 'Mã kỳ lương không hợp lệ.')
    const reference = db.doc(`payrollRuns/${runId}`)
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy kỳ lương.')
      if (snapshot.data().status === to) return
      if (snapshot.data().status !== from) throw new HttpsError('failed-precondition', `Kỳ lương phải ở trạng thái ${from}.`)
      if (to === 'reviewed') assertPayrollPeriodClosed(period(snapshot.data().periodId || runId))
      if (to === 'reviewed' && (Number(snapshot.data().schemaVersion || 0) < 7 || Number(snapshot.data().commissionFormulaVersion || 0) < 2)) {
        throw new HttpsError('failed-precondition', 'Kỳ lương nháp cũ cần được xóa và lập lại để chốt đúng ngày công, tiền ca và hoa hồng giới thiệu theo dòng tiền.')
      }
      if (to === 'reviewed' && snapshot.data().attendanceReviewRequired === true) {
        throw new HttpsError('failed-precondition', 'Ngày công hoặc lịch làm việc của kỳ chưa được đối soát đầy đủ.')
      }
      transaction.update(reference, { status: to, ...fields, [`${to}At`]: FieldValue.serverTimestamp(), [`${to}By`]: actor.uid, updatedAt: FieldValue.serverTimestamp() })
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 1, runId, action: `payroll.${to}`, actorUid: actor.uid, fromStatus: from, toStatus: to, createdAt: FieldValue.serverTimestamp() })
    })
    return { runId, status: to }
  }

  const reviewPayrollRun = payrollCall((request) => transition(request, 'draft', 'reviewed'))
  const lockPayrollRun = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const runId = typeof request.data?.runId === 'string' ? request.data.runId.trim() : ''
    if (!runId) throw new HttpsError('invalid-argument', 'Mã kỳ lương không hợp lệ.')
    const runReference = db.doc(`payrollRuns/${runId}`)
    const ledgerReference = db.doc(`ledgerEntries/payroll_${runId}`)
    const journalReference = db.doc(`journalEntries/payroll_${runId}`)
    await db.runTransaction(async (transaction) => {
      const [run, existingLedger, existingJournal] = await Promise.all([transaction.get(runReference), transaction.get(ledgerReference), transaction.get(journalReference)])
      if (!run.exists) throw new HttpsError('not-found', 'Không tìm thấy kỳ lương.')
      if (run.data().status === 'locked') return
      if (run.data().status !== 'reviewed') throw new HttpsError('failed-precondition', 'Kỳ lương phải ở trạng thái reviewed.')
      assertPayrollPeriodClosed(period(run.data().periodId || runId))
      const periodId = period(run.data().periodId)
      const finalAmount = Math.max(0, Number(run.data().finalAmount || run.data().grossAmount || 0))
      if (!Number.isSafeInteger(finalAmount) || finalAmount <= 0) throw new HttpsError('failed-precondition', 'Kỳ lương không có số tiền hợp lệ để khóa.')
      const effectiveAt = payrollEffectiveAt(periodId)
      await assertFinancePeriodOpen(transaction, db, effectiveAt)
      const journal = payrollAccrualJournal({ amount: finalAmount })
      transaction.update(runReference, { status: 'locked', lockedAt: FieldValue.serverTimestamp(), lockedBy: actor.uid, ledgerEntryId: ledgerReference.id, journalEntryId: journalReference.id, updatedAt: FieldValue.serverTimestamp() })
      if (!existingLedger.exists) {
        transaction.create(ledgerReference, {
          schemaVersion: 3,
          type: 'payroll',
          eventClass: 'payroll_accrual',
          source: 'payroll',
          payrollRunId: runId,
          journalEntryId: journalReference.id,
          periodId,
          branchId: run.data().branchId || '',
          amount: -finalAmount,
          cashImpact: 0,
          revenueImpact: 0,
          expenseImpact: finalAmount,
          receivableImpact: 0,
          deferredRevenueImpact: 0,
          effectiveAt,
          idempotencyKey: `payroll-accrual:${runId}`,
          status: 'posted',
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        })
      }
      if (!existingJournal.exists) transaction.create(journalReference, {
        schemaVersion: 1, documentType: 'payroll_accrual', documentId: ledgerReference.id, referenceCode: `TL-${runId.slice(-12).toUpperCase()}`,
        branchId: run.data().branchId || '', effectiveAt, lines: journal.lines, totalDebit: journal.totalDebit, totalCredit: journal.totalCredit,
        status: 'posted', createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid,
      })
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 2, runId, action: 'payroll.locked', actorUid: actor.uid, fromStatus: 'reviewed', toStatus: 'locked', ledgerEntryId: ledgerReference.id, createdAt: FieldValue.serverTimestamp() })
    })
    return { runId, status: 'locked' }
  })
  const markPayrollRunPaid = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const runId = typeof request.data?.runId === 'string' ? request.data.runId.trim() : ''
    if (!runId) throw new HttpsError('invalid-argument', 'Mã kỳ lương không hợp lệ.')
    const paymentReference = payrollPaymentReference(request.data?.paymentReference)
    const cashAccountId = payrollCashAccountId(request.data?.cashAccountId)
    const runReference = db.doc(`payrollRuns/${runId}`)
    const accrualReference = db.doc(`ledgerEntries/payroll_${runId}`)
    const paymentLedgerReference = db.doc(`ledgerEntries/payroll_payment_${runId}`)
    const paymentJournalReference = db.doc(`journalEntries/payroll_payment_${runId}`)
    const cashTransactionReference = db.doc(`cashTransactions/payroll_${runId}`)
    const accountReference = db.doc(`cashAccounts/${cashAccountId}`)

    return db.runTransaction(async (transaction) => {
      const [run, accrual, existingPayment, existingPaymentJournal, account] = await Promise.all([
        transaction.get(runReference),
        transaction.get(accrualReference),
        transaction.get(paymentLedgerReference),
        transaction.get(paymentJournalReference),
        transaction.get(accountReference),
      ])
      if (!run.exists) throw new HttpsError('not-found', 'Không tìm thấy kỳ lương.')
      if (run.data().status === 'paid') {
        return { runId, status: 'paid', unchanged: true, paymentLedgerEntryId: run.data().paymentLedgerEntryId || paymentLedgerReference.id }
      }
      if (run.data().status !== 'locked') throw new HttpsError('failed-precondition', 'Kỳ lương phải được khóa trước khi ghi nhận chi trả.')
      if (!accrual.exists || accrual.data().status !== 'posted') {
        throw new HttpsError('failed-precondition', 'Không tìm thấy bút toán chi phí của kỳ lương đã khóa.')
      }
      if (!account.exists || account.data().status !== 'active') {
        throw new HttpsError('failed-precondition', 'Tài khoản quỹ chi lương không hoạt động.')
      }
      const finalAmount = Math.max(0, Number(run.data().finalAmount || run.data().grossAmount || 0))
      if (!Number.isSafeInteger(finalAmount) || finalAmount <= 0) {
        throw new HttpsError('failed-precondition', 'Kỳ lương không có số tiền hợp lệ để chi trả.')
      }
      if (Number(account.data().balance || 0) < finalAmount) {
        throw new HttpsError('failed-precondition', 'Số dư quỹ không đủ để chi trả kỳ lương này.')
      }
      const paidAt = Timestamp.now()
      await assertFinancePeriodOpen(transaction, db, paidAt)
      const journal = payrollPaymentJournal({ amount: finalAmount, cashAccountType: account.data().type })
      if (!existingPayment.exists) {
        transaction.create(paymentLedgerReference, {
          schemaVersion: 3,
          type: 'payroll',
          eventClass: 'payroll_payment',
          source: 'payroll',
          payrollRunId: runId,
          journalEntryId: paymentJournalReference.id,
          periodId: run.data().periodId || '',
          branchId: run.data().branchId || account.data().branchId || '',
          cashAccountId,
          amount: -finalAmount,
          cashImpact: -finalAmount,
          revenueImpact: 0,
          expenseImpact: 0,
          receivableImpact: 0,
          deferredRevenueImpact: 0,
          effectiveAt: paidAt,
          paymentReference,
          idempotencyKey: `payroll-payment:${runId}`,
          status: 'posted',
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        })
        transaction.create(cashTransactionReference, {
          schemaVersion: 2,
          accountId: cashAccountId,
          branchId: account.data().branchId || run.data().branchId || '',
          type: 'expense',
          category: 'payroll_payment',
          amount: -finalAmount,
          effectiveAt: paidAt,
          status: 'posted',
          referenceCode: `PAY-${runId.slice(-8).toUpperCase()}`,
          paymentReference,
          ledgerEntryId: paymentLedgerReference.id,
          idempotencyKey: `payroll-cash:${runId}`,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        })
        transaction.update(accountReference, {
          balance: FieldValue.increment(-finalAmount),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      if (!existingPaymentJournal.exists) transaction.create(paymentJournalReference, {
        schemaVersion: 1, documentType: 'payroll_payment', documentId: paymentLedgerReference.id, referenceCode: `CTL-${runId.slice(-12).toUpperCase()}`,
        branchId: run.data().branchId || account.data().branchId || '', effectiveAt: paidAt, lines: journal.lines,
        totalDebit: journal.totalDebit, totalCredit: journal.totalCredit, status: 'posted', createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid,
      })
      transaction.update(runReference, {
        status: 'paid',
        paidAt: FieldValue.serverTimestamp(),
        paidBy: actor.uid,
        paymentReference,
        cashAccountId,
        paymentLedgerEntryId: paymentLedgerReference.id,
        paymentJournalEntryId: paymentJournalReference.id,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 2,
        runId,
        action: 'payroll.paid',
        actorUid: actor.uid,
        fromStatus: 'locked',
        toStatus: 'paid',
        cashAccountId,
        paymentLedgerEntryId: paymentLedgerReference.id,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { runId, status: 'paid', unchanged: false, paymentLedgerEntryId: paymentLedgerReference.id }
    })
  })

  return {
    listPayrollPolicies,
    savePayrollPolicy,
    managePayrollPolicy,
    listPayrollAdjustments,
    savePayrollAdjustment,
    voidPayrollAdjustment,
    listPayrollRuns,
    getPayrollRun,
    createPayrollRun,
    deleteDraftPayrollRun,
    reviewPayrollRun,
    lockPayrollRun,
    markPayrollRunPaid,
  }
}

module.exports = {
  createPayrollFunctions,
  periodBounds,
  periodDateBounds,
  payrollPeriodClosed,
  policyEffectiveDate,
  policyRate,
  payrollPolicyConfiguration,
  payrollPolicyProfiles,
  payrollProfile,
  policySupportsProfile,
  teachingSlotsFromAttendance,
  teachingSlotsFromSessions,
  payrollRunPolicyPlan,
  applyPayrollPolicyPlan,
  priceTeachingSlots,
}
