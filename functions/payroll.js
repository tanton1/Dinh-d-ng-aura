const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { createHash } = require('node:crypto')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { calculateWorkdayPayroll, mergeWorkCalendar, payrollAmounts } = require('./staff-payroll')
const { calculateReferralCommissions, referralCashImpact } = require('./referral-commission')
const { assertFinancePeriodOpen } = require('./finance-ledger')
const { payrollAccrualJournal, payrollPaymentJournal } = require('./accounting-core')
const {
  INTELLIGENCE_SCHEMA_VERSION,
  chooseEffectivePayrollIntelligencePolicy,
  normalizePayrollIntelligencePolicy,
  payrollIntelligencePolicySnapshot,
  buildPayrollIntelligence,
} = require('./payroll-intelligence')

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

function previousPayrollPeriod(periodId) {
  const [year, month] = period(periodId).split('-').map(Number)
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
}

function payrollTargetMetrics(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  return Object.fromEntries(Object.entries(source).slice(0, 30).flatMap(([key, raw]) => {
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(key)) return []
    const target = Number(raw)
    return Number.isFinite(target) && target > 0 ? [[key, Math.round(target * 100) / 100]] : []
  }))
}

function resolvedPayrollTarget(periodId, current = null, previous = null, policy = null) {
  const currentValue = current?.exists ? current.data() || {} : null
  const previousValue = previous?.exists ? previous.data() || {} : null
  const policyTargets = Object.fromEntries(Object.entries(policy?.metrics || {}).flatMap(([key, metric]) => Number(metric?.target) > 0 ? [[key, Number(metric.target)]] : []))
  const source = currentValue || previousValue || {}
  const metricTargets = Object.keys(payrollTargetMetrics(source.metricTargets)).length
    ? payrollTargetMetrics(source.metricTargets)
    : policyTargets
  return {
    periodId,
    status: currentValue?.status === 'approved' ? 'approved' : 'provisional',
    source: currentValue ? (currentValue.source || 'current_period') : previousValue ? 'previous_period' : 'policy_default',
    sourcePeriodId: currentValue?.sourcePeriodId || (previousValue ? previousPayrollPeriod(periodId) : ''),
    metricTargets,
    reason: currentValue?.reason || '',
    approvedBy: currentValue?.approvedBy || '',
    approvedAt: currentValue?.approvedAt || null,
  }
}

function applyPayrollTarget(policy, target) {
  if (!policy || !target?.metricTargets) return policy
  return {
    ...policy,
    metrics: Object.fromEntries(Object.entries(policy.metrics || {}).map(([key, metric]) => [
      key,
      Number(target.metricTargets[key]) > 0 ? { ...metric, target: Number(target.metricTargets[key]) } : metric,
    ])),
  }
}

function renewCohortByStaff(documents, allowedStaffIds = new Set()) {
  const result = new Map()
  for (const document of documents || []) {
    const value = typeof document?.data === 'function' ? document.data() || {} : document || {}
    if (value.active === false || !value.renewEligibility?.eligible && !value.renewEligibility?.managerOverride) continue
    const contract = value.contractSnapshot && typeof value.contractSnapshot === 'object' ? value.contractSnapshot : {}
    const primaryTrainerId = String(contract.trainerId || value.trainerId || '')
    const staffIds = [...new Set([primaryTrainerId, ...(Array.isArray(contract.trainerIds) ? contract.trainerIds : []), ...(Array.isArray(contract.nutritionPTIds) ? contract.nutritionPTIds : [])].filter(Boolean))]
      .filter((staffId) => !allowedStaffIds.size || allowedStaffIds.has(staffId))
    for (const staffId of staffIds) {
      const current = result.get(staffId) || []
      current.push({
        caseId: document.id || value.id || '',
        sourceContractId: value.sourceContractId || contract.id || '',
        studentId: value.studentId || '',
        studentName: value.studentSnapshot?.name || '',
        totalSessions: Number(contract.totalSessions || 0),
        usedSessions: Number(contract.usedSessions || 0),
        consumedPercent: Number(value.renewEligibility?.consumedPercent || 0),
        daysRemaining: Number(value.daysLeft ?? value.renewEligibility?.daysRemaining ?? 0),
        sessionsRemaining: Number(value.sessionsLeft ?? value.renewEligibility?.sessionsRemaining ?? 0),
        reasonCodes: Array.isArray(value.renewEligibility?.reasonCodes) ? value.renewEligibility.reasonCodes.slice(0, 10) : [],
        managerOverride: value.renewEligibility?.managerOverride === true,
        primaryTrainerId,
        role: staffId === primaryTrainerId ? 'primary' : 'support',
      })
      result.set(staffId, current.slice(0, 500))
    }
  }
  return result
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

const PAYROLL_RANK_CODES = ['p0', 'p1', 'p2', 'p3', 'p4']
const PAYROLL_EVIDENCE_FIELDS = ['goal', 'mainExercises', 'loadOrRpe', 'painResponse', 'nextSessionPlan']

function payrollRankCode(value, fallback = 'p0') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return PAYROLL_RANK_CODES.includes(normalized) ? normalized : fallback
}

function policyPercent(value, label, fallback) {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000) {
    throw new HttpsError('invalid-argument', `${label} phải từ 0% đến 1.000%.`)
  }
  return Math.round(parsed * 100) / 100
}

function policyCapabilities(value = {}, audience = 'employee') {
  const collaborator = audience === 'collaborator'
  const source = value && typeof value === 'object' ? value : {}
  return {
    baseSalaryEnabled: collaborator ? false : source.baseSalaryEnabled !== false,
    teachingCommissionEnabled: source.teachingCommissionEnabled !== false,
    kpiBonusEnabled: collaborator ? false : source.kpiBonusEnabled !== false,
    renewCommissionEnabled: collaborator ? false : source.renewCommissionEnabled !== false,
    selfGeneratedCommissionEnabled: collaborator ? false : source.selfGeneratedCommissionEnabled !== false,
    additionalBonusEnabled: collaborator ? false : source.additionalBonusEnabled !== false,
  }
}

function renewEligibilityConfiguration(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    maxDaysRemaining: boundedInteger(source.maxDaysRemaining, 'Số ngày còn lại để vào mẫu Renew', 0, 365, 30),
    maxSessionsRemaining: boundedInteger(source.maxSessionsRemaining, 'Số buổi còn lại để vào mẫu Renew', 0, 500, 6),
    minConsumedPercent: policyPercent(source.minConsumedPercent, 'Tỷ lệ chương trình đã dùng', 70),
    requireMostlyUsedProgram: source.requireMostlyUsedProgram !== false,
  }
}

function sessionEvidenceConfiguration(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const requiredFields = Array.isArray(source.requiredFields)
    ? [...new Set(source.requiredFields.filter((field) => PAYROLL_EVIDENCE_FIELDS.includes(field)))]
    : [...PAYROLL_EVIDENCE_FIELDS]
  return {
    enabled: source.enabled === true,
    noteSlaHours: boundedInteger(source.noteSlaHours, 'SLA bổ sung session note', 1, 168, 12),
    requiredFields: requiredFields.length ? requiredFields : [...PAYROLL_EVIDENCE_FIELDS],
    allowManagerOverride: source.allowManagerOverride !== false,
  }
}

function disputeConfiguration(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    resolutionSlaHours: boundedInteger(source.resolutionSlaHours, 'SLA xử lý tranh chấp', 1, 720, 72),
    allowPartialPayment: source.allowPartialPayment !== false,
  }
}

function payrollPolicyConfiguration(value = {}) {
  const audience = policyAudience(value.audience)
  const teachingRateMode = value.teachingRateMode === 'percent_of_rank_rate' ? 'percent_of_rank_rate' : 'absolute'
  const defaultRankCode = payrollRankCode(value.defaultRankCode)
  const rankRateSource = value.rankRateCards && typeof value.rankRateCards === 'object' ? value.rankRateCards : {}
  const fallbackRate = value.ratePerSession ?? rankRateSource[defaultRankCode]
  const ratePerSession = policyRate(fallbackRate)
  const rankRateCards = Object.fromEntries(PAYROLL_RANK_CODES.map((rankCode) => [
    rankCode,
    policyRate(rankRateSource[rankCode] ?? ratePerSession),
  ]))
  const dailySessionThreshold = boundedInteger(value.dailySessionThreshold, 'Số ca tiêu chuẩn mỗi ngày', 1, 24, 8)
  const rateAfterDailyThreshold = policyRate(value.rateAfterDailyThreshold ?? ratePerSession)
  const eveningStartHour = boundedInteger(value.eveningStartHour, 'Giờ bắt đầu ca tối', 0, 23, 20)
  const rateAfterDailyThresholdEvening = policyRate(value.rateAfterDailyThresholdEvening ?? rateAfterDailyThreshold)
  const tierSource = value.rateTierPercents && typeof value.rateTierPercents === 'object' ? value.rateTierPercents : {}
  const rateTierPercents = {
    standard: policyPercent(tierSource.standard, 'Tỷ lệ ca chuẩn', 100),
    afterThreshold: policyPercent(tierSource.afterThreshold, 'Tỷ lệ ca ngoài giờ', Math.round(rateAfterDailyThreshold / ratePerSession * 10_000) / 100),
    evening: policyPercent(tierSource.evening, 'Tỷ lệ ca tối', 100),
    afterThresholdEvening: policyPercent(tierSource.afterThresholdEvening, 'Tỷ lệ ca ngoài giờ tối', Math.round(rateAfterDailyThresholdEvening / ratePerSession * 10_000) / 100),
  }
  return {
    teachingRateMode,
    defaultRankCode,
    rankRateCards,
    rateTierPercents,
    eveningRequiresOvertime: true,
    ratePerSession,
    dailySessionThreshold,
    rateAfterDailyThreshold,
    eveningStartHour,
    rateAfterDailyThresholdEvening,
    capabilities: policyCapabilities(value.capabilities, audience),
    renewEligibility: renewEligibilityConfiguration(value.renewEligibility),
    sessionEvidence: sessionEvidenceConfiguration(value.sessionEvidence),
    dispute: disputeConfiguration(value.dispute),
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

const PAYROLL_EARNING_TYPES = new Set(['renew_commission', 'self_generated_commission', 'kpi_bonus', 'bonus', 'deduction', 'renew_commission_reversal', 'other'])
const PAYROLL_EARNING_STATUSES = new Set(['pending_review', 'approved', 'disputed', 'rejected', 'reversed', 'paid'])

function payrollEarningType(value) {
  if (PAYROLL_EARNING_TYPES.has(value)) return value
  throw new HttpsError('invalid-argument', 'Loại khoản thu nhập không hợp lệ.')
}

function payrollEarningStatus(value) {
  return PAYROLL_EARNING_STATUSES.has(value) ? value : 'pending_review'
}

function payrollEarningSignedAmount(value = {}) {
  const gross = payrollAdjustmentAmount(value.grossAmount)
  return value.type === 'deduction' || value.type === 'renew_commission_reversal' ? -gross : gross
}

function payrollEarningBuckets(events = []) {
  return events.reduce((result, event) => {
    const signedAmount = Number(event.signedAmount || 0)
    const magnitude = Math.abs(signedAmount)
    if (event.status === 'approved' || event.status === 'paid') {
      result.approvedAmount += magnitude
      result.payableAmount += signedAmount
    } else if (event.status === 'disputed') result.disputedAmount += magnitude
    else if (event.status === 'pending_review') result.pendingAmount += magnitude
    else result.rejectedAmount += magnitude
    return result
  }, { approvedAmount: 0, pendingAmount: 0, disputedAmount: 0, rejectedAmount: 0, payableAmount: 0 })
}

function payrollEarningAllowedByPolicy(event, capabilities = {}) {
  if (event.type === 'deduction' || event.type === 'renew_commission_reversal') return true
  if (event.type === 'renew_commission') return capabilities.renewCommissionEnabled === true
  if (event.type === 'self_generated_commission') return capabilities.selfGeneratedCommissionEnabled === true
  if (event.type === 'kpi_bonus') return capabilities.kpiBonusEnabled === true
  return capabilities.additionalBonusEnabled === true
}

function priceTeachingSlots(slots, resolvePolicy, staff = {}) {
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
          {
            trainerId: slot.trainerId,
            date: slot.date,
            hour: slot.hour,
            branchId: slot.branchId,
            branchIds: slot.branchIds instanceof Set ? [...slot.branchIds] : slot.branchIds,
            studentIds: slot.studentIds instanceof Set ? [...slot.studentIds] : slot.studentIds,
            sessionIds: slot.sessionIds instanceof Set ? [...slot.sessionIds] : slot.sessionIds,
          },
        )
      }
      const policy = payrollPolicyConfiguration(selected.configuration)
      const afterThreshold = position > policy.dailySessionThreshold
      // The evening premium applies only to overtime slots. All rates and the
      // threshold come from the selected, versioned payroll policy.
      const evening = afterThreshold && slot.hour >= policy.eveningStartHour
      const tier = evening ? 'after_threshold_evening' : afterThreshold ? 'after_threshold' : 'standard'
      const rankCode = payrollRankCode(staff.compensationRank || staff.payrollRank || staff.rankCode, policy.defaultRankCode)
      const rankBaseRate = policy.rankRateCards[rankCode] || policy.rankRateCards[policy.defaultRankCode] || policy.ratePerSession
      const tierPercent = tier === 'after_threshold_evening'
        ? policy.rateTierPercents.afterThresholdEvening
        : tier === 'after_threshold' ? policy.rateTierPercents.afterThreshold : policy.rateTierPercents.standard
      const absoluteRate = evening
        ? policy.rateAfterDailyThresholdEvening
        : afterThreshold ? policy.rateAfterDailyThreshold : policy.ratePerSession
      const rate = policy.teachingRateMode === 'percent_of_rank_rate'
        ? Math.round(rankBaseRate * tierPercent / 100)
        : absoluteRate
      return {
        key: slot.key,
        date: slot.date,
        hour: slot.hour,
        branchId: slot.branchId,
        // A learner may attend a different branch from their profile. Keep
        // every physical branch observed on the source sessions for audit and
        // display, but never turn this into a payroll blocker. The pay unit is
        // still one PT + date + hour teaching slot.
        branchIds: slot.branchIds instanceof Set
          ? [...slot.branchIds]
          : Array.isArray(slot.branchIds) ? slot.branchIds : (slot.branchId ? [slot.branchId] : []),
        crossBranchWarning: slot.crossBranchWarning === true,
        dailyPosition: position,
        tier,
        rate,
        teachingRateMode: policy.teachingRateMode,
        rankCode,
        rankBaseRate,
        tierPercent,
        policyId: selected.id || '',
        policyName: selected.name || 'Chính sách lương PT',
        studentCount: slot.studentIds?.size ?? slot.studentCount ?? 0,
        studentIds: slot.studentIds instanceof Set
          ? [...slot.studentIds]
          : Array.isArray(slot.studentIds) ? slot.studentIds : [],
        sessionIds: slot.sessionIds instanceof Set ? [...slot.sessionIds] : [...(slot.sessionIds || [])],
        attendanceEventIds: slot.attendanceEventIds instanceof Set ? [...slot.attendanceEventIds] : [...(slot.attendanceEventIds || [])],
      }
    })
}

function sessionEvidenceDeadline(session, noteSlaHours) {
  const date = vietnamDateKey(session.date, { sessionId: session.id || '' })
  const hour = teachingHour(session.hour, session.id || '')
  return new Date(`${date}T00:00:00+07:00`).getTime() + (hour + 1 + noteSlaHours) * 3_600_000
}

function evaluateSessionNoteEvidence(session, log, configuration, now = new Date()) {
  const policy = payrollPolicyConfiguration(configuration)
  if (!policy.sessionEvidence.enabled) return { status: 'not_required', missingFields: [], deadline: '' }
  const reviewStatus = session?.payrollEvidenceReview?.status
  if (reviewStatus === 'approved') return { status: 'complete', missingFields: [], deadline: '', managerOverride: true }
  if (reviewStatus === 'rejected') return { status: 'rejected', missingFields: policy.sessionEvidence.requiredFields, deadline: '', managerOverride: true }
  const value = log && typeof log === 'object' ? log : {}
  const completedSets = Array.isArray(value.sets) ? value.sets.filter((set) => set?.completed !== false) : []
  const evidence = {
    goal: Boolean(String(value.goal || value.trainingDayTitle || value.planSnapshot?.title || '').trim() || value.planSnapshot?.focusMuscles?.length),
    mainExercises: completedSets.some((set) => String(set?.exerciseName || set?.catalogExerciseId || '').trim()),
    loadOrRpe: completedSets.some((set) => Number(set?.weightKg || 0) > 0 || Number(set?.rpe || 0) > 0 || Number(set?.reps || 0) > 0 || Number(set?.durationSeconds || 0) > 0 || Number(set?.distanceMeters || 0) > 0),
    painResponse: Boolean(String(value.painNotes || '').trim()) || completedSets.some((set) => Object.prototype.hasOwnProperty.call(set || {}, 'painLevel')),
    nextSessionPlan: Boolean(String(value.nextSessionPlan || '').trim()),
  }
  const missingFields = policy.sessionEvidence.requiredFields.filter((field) => !evidence[field])
  if (value.status === 'completed' && !missingFields.length) return { status: 'complete', missingFields, deadline: '' }
  const deadlineMs = sessionEvidenceDeadline(session, policy.sessionEvidence.noteSlaHours)
  const deadline = new Date(deadlineMs).toISOString()
  const nowDate = now?.toDate?.() || (now instanceof Date ? now : new Date(now))
  return nowDate.getTime() <= deadlineMs
    ? { status: 'pending_evidence', missingFields, deadline }
    : { status: 'invalid_after_sla', missingFields, deadline }
}

function applySessionEvidencePolicy(teaching, sessionsById, logsBySessionId, policiesById, now = new Date()) {
  const trainers = new Map()
  const evidence = []
  let payableTeachingSlotCount = 0
  for (const [trainerId, slots] of teaching.trainers) {
    const payableSlots = []
    for (const slot of slots) {
      const policy = policiesById.get(slot.policyId)
      const configuration = policy?.configuration || {}
      const results = slot.sessionIds.map((sessionId) => {
        const session = sessionsById.get(sessionId) || { id: sessionId, date: slot.date, hour: slot.hour }
        return { sessionId, ...evaluateSessionNoteEvidence(session, logsBySessionId.get(sessionId), configuration, now) }
      })
      const blocking = results.filter((result) => !['not_required', 'complete'].includes(result.status))
      if (blocking.length) {
        evidence.push(...blocking.map((result, index) => ({ ...result, trainerId, date: slot.date, hour: slot.hour, policyId: slot.policyId, amount: index === 0 ? Number(slot.rate || 0) : 0, studentIds: slot.studentIds || [] })))
      } else {
        payableSlots.push({ ...slot, sessionEvidenceStatus: results.some((result) => result.status === 'complete') ? 'complete' : 'not_required' })
        payableTeachingSlotCount += 1
      }
    }
    trainers.set(trainerId, payableSlots)
  }
  return {
    ...teaching,
    trainers,
    payableTeachingSlotCount,
    sessionEvidence: evidence.slice(0, 500),
    sessionEvidenceReviewRequiredCount: evidence.length,
    sessionEvidenceReviewRequiredSessionIds: [...new Set(evidence.map((item) => item.sessionId))].slice(0, 500),
  }
}

function teachingSlotsFromAttendance(attendanceDocuments, sessionsById, policyValue) {
  const policy = payrollPolicyConfiguration(policyValue)
  const slotMap = new Map()
  let attendanceEventCount = 0
  const reviewRequiredSessionIds = new Set()

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
    if (attendance.recognitionReviewRequired === true || attendance.confirmationSource === 'auto_after_48h'
      || session.recognitionReviewRequired === true || session.confirmationSource === 'auto_after_48h') {
      if (sessionId) reviewRequiredSessionIds.add(sessionId)
      continue
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
        branchIds: new Set(),
        crossBranchWarning: false,
        sessionIds: new Set(),
        studentIds: new Set(),
        attendanceEventIds: new Set(),
      }
      slotMap.set(key, slot)
    }
    if (normalisePayrollBranchId(session.branchId)) slot.branchIds.add(normalisePayrollBranchId(session.branchId))
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
  return {
    trainers,
    attendanceEventCount,
    teachingSlotCount: slotMap.size,
    teachingEvidenceReviewRequiredCount: reviewRequiredSessionIds.size,
    teachingEvidenceReviewRequiredSessionIds: [...reviewRequiredSessionIds].slice(0, 500),
    policy,
  }
}

function duplicateLearnerDayViolations(sessionDocuments) {
  const learnerDays = new Map()
  for (const item of sessionDocuments || []) {
    const session = typeof item?.data === 'function' ? item.data() : item || {}
    if (!['completed', 'attended'].includes(session.status)) continue
    const studentId = typeof session.studentId === 'string' ? session.studentId.trim() : ''
    const date = typeof session.date === 'string' ? session.date.slice(0, 10) : ''
    if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const sessionId = typeof item?.id === 'string' && item.id
      ? item.id
      : typeof session.id === 'string' ? session.id : ''
    const row = {
      sessionId,
      trainerId: typeof session.trainerId === 'string' ? session.trainerId.trim() : '',
      branchId: normalisePayrollBranchId(session.branchId),
      hour: Number.isInteger(Number(session.hour)) ? Number(session.hour) : null,
    }
    const key = `${studentId}|${date}`
    learnerDays.set(key, [...(learnerDays.get(key) || []), row])
  }
  return [...learnerDays.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => {
      const separator = key.lastIndexOf('|')
      const studentId = key.slice(0, separator)
      const date = key.slice(separator + 1)
      const trainerIds = [...new Set(rows.map((row) => row.trainerId).filter(Boolean))]
      const branchIds = [...new Set(rows.map((row) => row.branchId).filter(Boolean))]
      const sessionIds = rows.map((row) => row.sessionId).filter(Boolean)
      const hours = [...new Set(rows.map((row) => row.hour).filter((hour) => hour !== null))].sort((left, right) => left - right)
      return {
        code: 'STUDENT_MULTIPLE_COMPLETED_SESSIONS_PER_DAY',
        severity: 'error',
        title: 'Học viên bị ghi nhiều buổi trong cùng ngày',
        detail: `Ngày ${date} đang có ${rows.length} buổi đã hoàn thành cho cùng một học viên${hours.length ? ` tại ${hours.map((hour) => `${String(hour).padStart(2, '0')}:00`).join(', ')}` : ''}. Hãy mở từng mã ca và đối soát ngày, giờ hoặc bản ghi bị trùng trước khi lập lương.`,
        remediation: 'teaching_history',
        studentId,
        date,
        hour: hours[0],
        hours,
        trainerId: trainerIds[0] || '',
        trainerIds,
        branchId: branchIds[0] || '',
        branchIds,
        sessionId: sessionIds[0] || '',
        sessionIds,
        // Keep the mapping between a human-readable slot and its source
        // session. The old payload only returned parallel arrays, so the UI
        // could not reliably open the exact duplicate when hours were mixed.
        relatedSessions: rows.map((row) => ({
          sessionId: row.sessionId,
          trainerId: row.trainerId,
          branchId: row.branchId,
          date,
          hour: row.hour,
        })).filter((row) => row.sessionId),
      }
    })
}

/**
 * Payroll validation is intentionally built from lean session projections.
 * Resolve the IDs only at the boundary so operators see names while the
 * source data remains immutable and the pure validation helpers stay fast.
 */
async function enrichPayrollViolations(db, violations, transaction = null) {
  const source = Array.isArray(violations) ? violations : []
  const studentIds = [...new Set(source.flatMap((item) => [
    item?.studentId,
    ...(Array.isArray(item?.studentIds) ? item.studentIds : []),
  ]).filter((value) => typeof value === 'string' && value))]
  const trainerIds = [...new Set(source.flatMap((item) => [
    item?.trainerId,
    ...(Array.isArray(item?.trainerIds) ? item.trainerIds : []),
    ...(Array.isArray(item?.relatedSessions) ? item.relatedSessions.map((row) => row?.trainerId) : []),
  ]).filter((value) => typeof value === 'string' && value))]
  const branchIds = [...new Set(source.flatMap((item) => [
    item?.branchId,
    ...(Array.isArray(item?.branchIds) ? item.branchIds : []),
    ...(Array.isArray(item?.relatedSessions) ? item.relatedSessions.map((row) => row?.branchId) : []),
  ]).filter((value) => typeof value === 'string' && value))]
  // Keep name resolution bounded even when a migrated period contains a large
  // number of duplicate rows. Unresolved entries remain actionable through
  // the exact session list without making the payroll transaction time out.
  const references = [
    ...studentIds.slice(0, 100).map((value) => ({ kind: 'student', id: value, reference: db.doc(`students/${value}`) })),
    ...trainerIds.slice(0, 100).flatMap((value) => [
      { kind: 'trainer', id: value, reference: db.doc(`trainers/${value}`) },
      { kind: 'staff', id: value, reference: db.doc(`staff/${value}`) },
      { kind: 'user', id: value, reference: db.doc(`users/${value}`) },
    ]),
    ...branchIds.slice(0, 50).map((value) => ({ kind: 'branch', id: value, reference: db.doc(`branches/${value}`) })),
  ]
  const snapshots = references.length === 0
    ? []
    : transaction
      ? await Promise.all(references.map((item) => transaction.get(item.reference)))
      : await db.getAll(...references.map((item) => item.reference))
  const values = new Map()
  references.forEach((item, index) => {
    const snapshot = snapshots[index]
    if (!snapshot?.exists) return
    const value = snapshot.data() || {}
    const name = value.name || value.displayName || value.fullName || value.preferredName || ''
    if (!name) return
    const key = `${item.kind}:${item.id}`
    // Prefer the canonical operational collection over staff/user fallbacks.
    if (!values.has(key) || item.kind === 'student' || item.kind === 'trainer' || item.kind === 'branch') values.set(key, name)
  })
  const nameFor = (kind, id, fallback) => {
    if (!id) return fallback || ''
    return values.get(`${kind}:${id}`)
      || (kind === 'trainer' ? values.get(`staff:${id}`) || values.get(`user:${id}`) : '')
      || fallback
      || ''
  }
  return source.map((item) => {
    const studentName = nameFor('student', item?.studentId, item?.studentName)
    const studentNames = Array.isArray(item?.studentIds)
      ? item.studentIds.map((id) => nameFor('student', id, '')).filter(Boolean)
      : []
    const trainerName = nameFor('trainer', item?.trainerId, item?.trainerName)
    const trainerNames = Array.isArray(item?.trainerIds)
      ? item.trainerIds.map((id) => nameFor('trainer', id, '')).filter(Boolean)
      : []
    const branchName = nameFor('branch', item?.branchId, item?.branchName)
    const branchNames = Array.isArray(item?.branchIds)
      ? item.branchIds.map((id) => nameFor('branch', id, '')).filter(Boolean)
      : []
    const relatedSessions = Array.isArray(item?.relatedSessions)
      ? item.relatedSessions.map((row) => ({
        ...row,
        trainerName: nameFor('trainer', row?.trainerId, row?.trainerName),
        branchName: nameFor('branch', row?.branchId, row?.branchName),
      }))
      : undefined
    const result = {
      ...item,
      ...(studentName ? { studentName } : {}),
      ...(studentNames.length ? { studentNames } : {}),
      ...(trainerName ? { trainerName } : {}),
      ...(trainerNames.length ? { trainerNames } : {}),
      ...(branchName ? { branchName } : {}),
      ...(branchNames.length ? { branchNames } : {}),
      ...(relatedSessions ? { relatedSessions } : {}),
    }
    if (item?.code === 'STUDENT_MULTIPLE_COMPLETED_SESSIONS_PER_DAY') {
      const displayStudent = studentName || 'chưa xác định tên học viên'
      result.detail = `Học viên ${displayStudent} ngày ${item.date} đang có ${item.sessionIds?.length || 0} buổi đã hoàn thành${item.hours?.length ? ` tại ${item.hours.map((hour) => `${String(hour).padStart(2, '0')}:00`).join(', ')}` : ''}. Hãy chọn đúng buổi bên dưới để đối soát trước khi lập lương.`
    }
    return result
  })
}

function teachingSlotsFromSessions(sessionDocuments, policyValue) {
  const policy = payrollPolicyConfiguration(policyValue)
  const slotMap = new Map()
  let attendanceEventCount = 0
  const reviewRequiredSessionIds = new Set()

  // Schedule publish prevents new duplicate learner days, but migrated or
  // manually reconciled history can predate that invariant. Payroll must
  // inspect its own source period so those records cannot silently charge a
  // learner twice or create misleading PT evidence.
  const duplicateLearnerDays = duplicateLearnerDayViolations(sessionDocuments)
  if (duplicateLearnerDays.length) throw payrollViolationsError(duplicateLearnerDays)

  for (const item of sessionDocuments) {
    const session = typeof item?.data === 'function' ? item.data() : item || {}
    if (!['completed', 'attended'].includes(session.status)) continue
    const sessionId = typeof item?.id === 'string' && item.id
      ? item.id
      : typeof session.id === 'string' ? session.id : ''
    if (session.recognitionReviewRequired === true || session.confirmationSource === 'auto_after_48h') {
      if (sessionId) reviewRequiredSessionIds.add(sessionId)
      continue
    }
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
      {
        sessionId,
        studentId: typeof session.studentId === 'string' ? session.studentId : '',
        branchId: normalisePayrollBranchId(session.branchId),
        date: typeof session.date === 'string' ? session.date : '',
      },
    )
    const date = vietnamDateKey(session.date, { sessionId, trainerId, studentId: session.studentId || '' })
    const hour = teachingHour(session.hour, sessionId, { trainerId, date, studentId: session.studentId || '' })
    const key = `${trainerId}|${date}|${hour}`
    let slot = slotMap.get(key)
    if (!slot) {
      slot = {
        key,
        trainerId,
        date,
        hour,
        branchId: normalisePayrollBranchId(session.branchId),
        branchIds: new Set(),
        crossBranchWarning: false,
        sessionIds: new Set(),
        studentIds: new Set(),
        attendanceEventIds: new Set(),
      }
      slotMap.set(key, slot)
    } else if (slot.branchId && normalisePayrollBranchId(session.branchId) && slot.branchId !== normalisePayrollBranchId(session.branchId)) {
      // Branch is an operational warning only. A learner can train at a
      // different site and a PT may have legacy sessions carrying the
      // learner's home branch. Payroll is grouped by PT/date/hour, so this
      // must not prevent creating a period.
      slot.crossBranchWarning = true
    }
    if (!slot.branchId && normalisePayrollBranchId(session.branchId)) slot.branchId = normalisePayrollBranchId(session.branchId)
    if (normalisePayrollBranchId(session.branchId)) slot.branchIds.add(normalisePayrollBranchId(session.branchId))
    slot.sessionIds.add(sessionId)
    slot.studentIds.add(session.studentId || `unknown_${sessionId}`)
    slot.attendanceEventIds.add(session.attendanceEventId || sessionId)
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
  return {
    trainers,
    attendanceEventCount,
    teachingSlotCount: slotMap.size,
    teachingEvidenceReviewRequiredCount: reviewRequiredSessionIds.size,
    teachingEvidenceReviewRequiredSessionIds: [...reviewRequiredSessionIds].slice(0, 500),
    crossBranchWarningCount: [...slotMap.values()].filter((slot) => slot.crossBranchWarning).length,
    policy,
  }
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
    configuration: payrollPolicyConfiguration({ ...data, audience: policyAudience(data.audience) }),
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

function payrollIntelligencePolicyInput(value = {}) {
  const effective = policyEffectiveDate(value.effectiveFrom)
  const normalized = normalizePayrollIntelligencePolicy({
    ...value,
    effectiveFrom: effective.value,
  })
  const name = policyName(value.name || normalized.name)
  const metrics = Object.fromEntries(Object.entries(normalized.metrics || {}).slice(0, 30))
  if (!Object.keys(metrics).length) {
    throw new HttpsError('invalid-argument', 'Cần cấu hình ít nhất một chỉ số KPI hợp lệ.')
  }
  return {
    ...normalized,
    name,
    metrics,
    effectiveTimestamp: effective.timestamp,
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
    const staff = plan.staffRecords?.get(trainerId) || {}
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
            {
              trainerId,
              staffId: trainerId,
              payrollProfile: profile,
              date: slot.date,
              hour: slot.hour,
              branchId: slot.branchId,
              branchIds: slot.branchIds instanceof Set ? [...slot.branchIds] : slot.branchIds,
              studentIds: slot.studentIds instanceof Set ? [...slot.studentIds] : slot.studentIds,
              sessionIds: slot.sessionIds instanceof Set ? [...slot.sessionIds] : slot.sessionIds,
            },
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
            { trainerId, date: slot.date, hour: slot.hour, branchId: slot.branchId, branchIds: slot.branchIds instanceof Set ? [...slot.branchIds] : slot.branchIds, studentIds: slot.studentIds instanceof Set ? [...slot.studentIds] : slot.studentIds, sessionIds: slot.sessionIds instanceof Set ? [...slot.sessionIds] : slot.sessionIds },
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
          { trainerId, policyId: assignedPolicy.id, date: slot.date, hour: slot.hour, branchId: slot.branchId, branchIds: slot.branchIds instanceof Set ? [...slot.branchIds] : slot.branchIds, studentIds: slot.studentIds instanceof Set ? [...slot.studentIds] : slot.studentIds, sessionIds: slot.sessionIds instanceof Set ? [...slot.sessionIds] : slot.sessionIds },
        )
      }
      return assignedPolicy
    }, staff))
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
        const configuration = payrollPolicyConfiguration({ ...data, audience: policyAudience(data.audience) })
        const usageCount = Number(usage.get(item.id) || 0)
        return {
          id: item.id,
          name: data.name || 'Chính sách lương PT',
          version: Number(data.version || 1),
          effectiveFrom: iso(data.effectiveFrom),
          ...configuration,
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

  const listPayrollIntelligencePolicies = payrollCall(async (request) => {
    await payrollActor(request, db)
    const snapshot = await db.collection('payrollIncentivePolicies').limit(100).get()
    return {
      policies: snapshot.docs
        .map((item) => normalizePayrollIntelligencePolicy({ id: item.id, ...item.data() }, item.id))
        .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom) || right.version - left.version)
        .map((policy) => ({ ...policy, effectiveFrom: policy.effectiveFrom })),
    }
  })

  const savePayrollIntelligencePolicy = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const policy = payrollIntelligencePolicyInput(request.data || {})
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({
        name: policy.name,
        effectiveFrom: policy.effectiveFrom,
        metrics: policy.metrics,
        attributionRules: policy.attributionRules,
        rankBands: policy.rankBands,
        renew: policy.renew,
        enabled: policy.enabled,
      }))
      .digest('hex')
      .slice(0, 16)
    const policyId = `incentive_${policy.effectiveFrom.replaceAll('-', '')}_${fingerprint}`
    const reference = db.doc(`payrollIncentivePolicies/${policyId}`)
    return db.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference)
      if (existing.exists) {
        const current = normalizePayrollIntelligencePolicy({ id: policyId, ...existing.data() }, policyId)
        if (JSON.stringify(payrollIntelligencePolicySnapshot(current)) === JSON.stringify(payrollIntelligencePolicySnapshot({ ...policy, id: policyId }))) {
          return { policyId, unchanged: true }
        }
        throw new HttpsError('already-exists', 'Mã chính sách KPI đã tồn tại nhưng khác dữ liệu. Hãy đổi tên hoặc ngày hiệu lực.')
      }
      transaction.create(reference, {
        schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
        name: policy.name,
        version: Math.max(1, policy.version),
        effectiveFrom: policy.effectiveTimestamp,
        status: 'active',
        enabled: policy.enabled,
        metrics: policy.metrics,
        attributionRules: policy.attributionRules,
        rankBands: policy.rankBands,
        renew: policy.renew,
        amountImpact: 'none',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
        action: 'payroll.incentive_policy.created',
        policyId,
        actorUid: actor.uid,
        snapshot: payrollIntelligencePolicySnapshot({ ...policy, id: policyId }),
        createdAt: FieldValue.serverTimestamp(),
      })
      return { policyId, unchanged: false }
    })
  })

  const managePayrollIntelligencePolicy = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const policyId = payrollDocumentId(request.data?.policyId, 'Mã chính sách KPI')
    const action = request.data?.action
    if (!['hide', 'restore', 'delete'].includes(action)) throw new HttpsError('invalid-argument', 'Thao tác chính sách KPI không hợp lệ.')
    const reference = db.doc(`payrollIncentivePolicies/${policyId}`)
    return db.runTransaction(async (transaction) => {
      const [snapshot, usage] = await Promise.all([
        transaction.get(reference),
        transaction.get(db.collection('payrollRuns').where('intelligencePolicyId', '==', policyId).limit(1)),
      ])
      if (!snapshot.exists) return { policyId, action, unchanged: true }
      const used = !usage.empty
      if (action === 'delete') {
        if (used) throw new HttpsError('failed-precondition', 'Chính sách KPI đã nằm trong kỳ lương nên chỉ có thể ẩn.')
        transaction.delete(reference)
      } else {
        const nextStatus = action === 'hide' ? 'inactive' : 'active'
        if ((snapshot.data().status === 'inactive' ? 'inactive' : 'active') === nextStatus) return { policyId, action, unchanged: true }
        transaction.update(reference, { status: nextStatus, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      }
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
        action: `payroll.incentive_policy.${action}`,
        policyId,
        actorUid: actor.uid,
        usageProtected: used,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { policyId, action, unchanged: false }
    })
  })

  const getPayrollTarget = payrollCall(async (request) => {
    await payrollActor(request, db)
    const periodId = period(request.data?.periodId)
    const reference = db.doc(`payrollTargets/${periodId}`)
    const previousPeriodId = previousPayrollPeriod(periodId)
    const previousReference = db.doc(`payrollTargets/${previousPeriodId}`)
    const target = await db.runTransaction(async (transaction) => {
      const [current, previous] = await Promise.all([transaction.get(reference), transaction.get(previousReference)])
      const resolved = resolvedPayrollTarget(periodId, current, previous)
      if (!current.exists && Object.keys(resolved.metricTargets).length) {
        transaction.create(reference, {
          schemaVersion: 1,
          periodId,
          status: 'provisional',
          source: resolved.source,
          sourcePeriodId: resolved.sourcePeriodId || null,
          metricTargets: resolved.metricTargets,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'system:payroll-target-fallback',
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      return resolved
    })
    return { target: { ...target, approvedAt: iso(target.approvedAt) } }
  })

  const savePayrollTarget = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const periodId = period(request.data?.periodId)
    const metricTargets = payrollTargetMetrics(request.data?.metricTargets)
    if (!Object.keys(metricTargets).length) throw new HttpsError('invalid-argument', 'Cần nhập ít nhất một mục tiêu KPI lớn hơn 0.')
    const reason = payrollAdjustmentText(request.data?.reason, 'Lý do điều chỉnh target', 3, 500)
    const reference = db.doc(`payrollTargets/${periodId}`)
    const runReference = db.doc(`payrollRuns/${periodId}`)
    return db.runTransaction(async (transaction) => {
      const [current, run] = await Promise.all([transaction.get(reference), transaction.get(runReference)])
      if (run.exists) {
        const status = run.data().status || 'draft'
        throw payrollViolationError(
          ['locked', 'paid'].includes(status) ? 'PAYROLL_TARGET_IMMUTABLE' : 'PAYROLL_TARGET_REBUILD_REQUIRED',
          ['locked', 'paid'].includes(status) ? 'Kỳ đã khóa target' : 'Kỳ nháp cần lập lại sau khi đổi target',
          ['locked', 'paid'].includes(status)
            ? 'Target đã được snapshot vào kỳ khóa và không thể thay đổi hồi tố.'
            : 'Xóa kỳ nháp hiện tại, cập nhật target rồi lập lại để KPI dùng đúng dữ liệu.',
          ['locked', 'paid'].includes(status) ? 'retry' : 'delete_rebuild',
          { periodId, runStatus: status },
        )
      }
      const revision = Number(current.data()?.revision || 0) + 1
      transaction.set(reference, {
        schemaVersion: 1,
        periodId,
        status: 'provisional',
        source: 'manager_input',
        sourcePeriodId: null,
        metricTargets,
        reason,
        revision,
        approvedBy: FieldValue.delete(),
        approvedAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        ...(current.exists ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid }),
      }, { merge: true })
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 7, action: 'payroll.target.saved', periodId, actorUid: actor.uid, metricTargets, reason, revision, createdAt: FieldValue.serverTimestamp() })
      return { periodId, status: 'provisional', revision }
    })
  })

  const approvePayrollTarget = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const periodId = period(request.data?.periodId)
    const reason = payrollAdjustmentText(request.data?.reason, 'Lý do duyệt target', 3, 500)
    const reference = db.doc(`payrollTargets/${periodId}`)
    const runReference = db.doc(`payrollRuns/${periodId}`)
    return db.runTransaction(async (transaction) => {
      const [current, run] = await Promise.all([transaction.get(reference), transaction.get(runReference)])
      if (!current.exists) throw new HttpsError('failed-precondition', 'Chưa có target tạm dùng hoặc target do Manager nhập để duyệt.')
      if (run.exists && ['locked', 'paid'].includes(run.data().status)) throw new HttpsError('failed-precondition', 'Kỳ đã khóa; không thể duyệt lại target hồi tố.')
      const metricTargets = payrollTargetMetrics(current.data().metricTargets)
      if (!Object.keys(metricTargets).length) throw new HttpsError('failed-precondition', 'Target chưa có chỉ số hợp lệ.')
      if (run.exists && JSON.stringify(payrollTargetMetrics(run.data().targetSnapshot?.metricTargets)) !== JSON.stringify(metricTargets)) {
        throw payrollViolationError('PAYROLL_TARGET_REBUILD_REQUIRED', 'Target khác snapshot kỳ nháp', 'Xóa và lập lại kỳ nháp trước khi duyệt target mới.', 'delete_rebuild', { periodId })
      }
      transaction.update(reference, { status: 'approved', reason, approvedAt: FieldValue.serverTimestamp(), approvedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      if (run.exists) transaction.update(runReference, { targetStatus: 'approved', 'targetSnapshot.status': 'approved', 'targetSnapshot.reason': reason, 'targetSnapshot.approvedBy': actor.uid, 'targetSnapshot.approvedAt': FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 7, action: 'payroll.target.approved', periodId, actorUid: actor.uid, metricTargets, reason, createdAt: FieldValue.serverTimestamp() })
      return { periodId, status: 'approved' }
    })
  })

  const savePayrollPolicy = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const effective = policyEffectiveDate(request.data?.effectiveFrom)
    const name = policyName(request.data?.name)
    const requestedAudience = policyAudience(request.data?.audience)
    const eligibleProfiles = payrollPolicyProfiles(request.data?.eligibleProfiles, requestedAudience)
    const audience = policyAudienceFromProfiles(eligibleProfiles)
    const rates = payrollPolicyConfiguration({ ...(request.data || {}), audience })
    if (eligibleProfiles.includes('collaborator') && eligibleProfiles.length !== 1) {
      throw new HttpsError('invalid-argument', 'CTV phải dùng một phiên bản chính sách riêng, không gộp chung với nhân viên P0–P4.')
    }
    if (eligibleProfiles.includes('collaborator')) {
      if (rates.teachingRateMode !== 'absolute') {
        throw new HttpsError('invalid-argument', 'CTV dùng đơn giá ca riêng và không tham gia thang P0–P4.')
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
        schemaVersion: 6,
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
        schemaVersion: 6,
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

  const reviewPayrollSessionEvidence = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const sessionId = payrollDocumentId(request.data?.sessionId, 'Mã ca tập')
    const decision = request.data?.decision
    if (!['approved', 'rejected', 'reset'].includes(decision)) throw new HttpsError('invalid-argument', 'Quyết định bằng chứng ca tập không hợp lệ.')
    const reason = decision === 'reset' ? '' : payrollAdjustmentText(request.data?.reason, 'Lý do quyết định', 3, 500)
    const reference = db.doc(`sessions/${sessionId}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy ca tập cần duyệt bằng chứng.')
      const session = snapshot.data() || {}
      if (!['completed', 'attended'].includes(session.status)) throw new HttpsError('failed-precondition', 'Chỉ duyệt bằng chứng cho ca đã hoàn thành.')
      const currentStatus = session.payrollEvidenceReview?.status || ''
      if (decision === 'reset') {
        transaction.update(reference, { payrollEvidenceReview: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
      } else {
        transaction.update(reference, {
          payrollEvidenceReview: { status: decision, reason, reviewedBy: actor.uid, reviewedAt: FieldValue.serverTimestamp() },
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 6,
        action: `payroll.session_evidence.${decision}`,
        sessionId,
        actorUid: actor.uid,
        previousStatus: currentStatus,
        decision,
        reason,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { sessionId, decision, unchanged: currentStatus === decision }
    })
  })

  const listPayrollEarningEvents = payrollCall(async (request) => {
    await payrollActor(request, db)
    const periodId = period(request.data?.periodId)
    const staffId = typeof request.data?.staffId === 'string' && request.data.staffId.trim()
      ? payrollDocumentId(request.data.staffId, 'Mã nhân viên')
      : ''
    const snapshot = await db.collection('payrollEarningEvents').where('periodId', '==', periodId).limit(1001).get()
    if (snapshot.size > 1000) throw new HttpsError('resource-exhausted', 'Kỳ có hơn 1.000 khoản thu nhập; hãy dùng bộ lọc nhân viên để đối soát.')
    const events = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => !staffId || item.staffId === staffId)
      .sort((left, right) => String(right.createdAt?.toMillis?.() || '').localeCompare(String(left.createdAt?.toMillis?.() || '')))
      .map((item) => ({
        ...item,
        grossAmount: Number(item.grossAmount || 0),
        signedAmount: Number(item.signedAmount || 0),
        createdAt: iso(item.createdAt),
        reviewedAt: iso(item.reviewedAt),
        deadline: iso(item.deadline),
      }))
    return { events, summary: payrollEarningBuckets(events) }
  })

  const savePayrollEarningEvent = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const periodId = period(request.data?.periodId)
    const staffId = payrollDocumentId(request.data?.staffId, 'Mã nhân viên')
    const type = payrollEarningType(request.data?.type)
    const grossAmount = payrollAdjustmentAmount(request.data?.grossAmount)
    const sourceType = payrollAdjustmentText(request.data?.sourceType, 'Nguồn khoản thu nhập', 2, 80)
    const sourceId = payrollAdjustmentText(request.data?.sourceId, 'Mã nguồn khoản thu nhập', 2, 200)
    const evidenceReference = payrollAdjustmentText(request.data?.evidenceReference, 'Bằng chứng', 2, 500)
    const description = payrollAdjustmentText(request.data?.description, 'Nội dung khoản thu nhập', 3, 500)
    const deadlineHours = boundedInteger(request.data?.deadlineHours, 'SLA duyệt khoản thu nhập', 1, 720, 72)
    const originalRate = Number(request.data?.originalRate || 0)
    const attributionPercent = request.data?.attributionPercent === undefined ? 100 : Number(request.data.attributionPercent)
    const commissionBaseAmount = Number(request.data?.commissionBaseAmount || 0)
    if (type === 'renew_commission' && (!Number.isFinite(originalRate) || originalRate <= 0 || originalRate > 100)) throw new HttpsError('invalid-argument', 'Hoa hồng Renew cần tỷ lệ gốc từ 0 đến 100%.')
    if (!Number.isFinite(attributionPercent) || attributionPercent <= 0 || attributionPercent > 100) throw new HttpsError('invalid-argument', 'Tỷ lệ quy thuộc khoản thu nhập phải từ 0 đến 100%.')
    const eventId = `earning_${createHash('sha256').update(`${periodId}|${staffId}|${type}|${sourceType}|${sourceId}`).digest('hex').slice(0, 32)}`
    const reference = db.doc(`payrollEarningEvents/${eventId}`)
    const runReference = db.doc(`payrollRuns/${periodId}`)
    return db.runTransaction(async (transaction) => {
      const [existing, run] = await Promise.all([transaction.get(reference), transaction.get(runReference)])
      if (existing.exists) return { eventId, unchanged: true, status: existing.data().status || 'pending_review' }
      if (run.exists && ['locked', 'paid'].includes(run.data().status)) throw new HttpsError('failed-precondition', 'Kỳ lương đã khóa; khoản phát sinh phải được ghi vào kỳ sau.')
      const signedAmount = payrollEarningSignedAmount({ type, grossAmount })
      transaction.create(reference, {
        schemaVersion: 1,
        periodId,
        staffId,
        type,
        sourceType,
        sourceId,
        grossAmount,
        signedAmount,
        evidenceReference,
        description,
        originalRate: type === 'renew_commission' ? Math.round(originalRate * 100) / 100 : 0,
        attributionPercent: Math.round(attributionPercent * 100) / 100,
        commissionBaseAmount: Math.max(0, Math.round(commissionBaseAmount)),
        status: 'pending_review',
        deadline: Timestamp.fromMillis(Date.now() + deadlineHours * 3_600_000),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 6, action: 'payroll.earning_event.created', eventId, periodId, staffId, actorUid: actor.uid, type, grossAmount, createdAt: FieldValue.serverTimestamp() })
      return { eventId, unchanged: false, status: 'pending_review' }
    })
  })

  const reviewPayrollEarningEvent = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const eventId = payrollDocumentId(request.data?.eventId, 'Mã khoản thu nhập')
    const decision = request.data?.decision
    if (!['approved', 'disputed', 'rejected', 'pending_review'].includes(decision)) throw new HttpsError('invalid-argument', 'Quyết định khoản thu nhập không hợp lệ.')
    const reason = payrollAdjustmentText(request.data?.reason, 'Lý do quyết định', 3, 500)
    const reference = db.doc(`payrollEarningEvents/${eventId}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy khoản thu nhập cần duyệt.')
      const event = snapshot.data() || {}
      const run = await transaction.get(db.doc(`payrollRuns/${event.periodId}`))
      if (run.exists && ['locked', 'paid'].includes(run.data().status)) throw new HttpsError('failed-precondition', 'Kỳ đã khóa; không được thay đổi trạng thái khoản thu nhập hồi tố.')
      if (['reversed', 'paid'].includes(event.status)) throw new HttpsError('failed-precondition', 'Khoản thu nhập đã thanh toán hoặc đảo nên không thể sửa.')
      transaction.update(reference, { status: decision, reviewReason: reason, reviewedBy: actor.uid, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 6, action: `payroll.earning_event.${decision}`, eventId, periodId: event.periodId, staffId: event.staffId, actorUid: actor.uid, previousStatus: payrollEarningStatus(event.status), reason, createdAt: FieldValue.serverTimestamp() })
      return { eventId, status: decision, unchanged: event.status === decision }
    })
  })

  const approveRenewAttribution = payrollCall(async (request) => {
    const actor = await payrollActor(request, db)
    const caseId = payrollDocumentId(request.data?.caseId, 'Mã hồ sơ gia hạn')
    const reason = payrollAdjustmentText(request.data?.reason, 'Lý do chia quy thuộc', 3, 500)
    const rawSplits = Array.isArray(request.data?.splits) ? request.data.splits : []
    if (rawSplits.length < 1 || rawSplits.length > 5) throw new HttpsError('invalid-argument', 'Cần từ một đến năm nhân sự trong quyết định quy thuộc.')
    const splits = rawSplits.map((item) => ({
      staffId: payrollDocumentId(item?.staffId, 'Mã nhân sự quy thuộc'),
      role: typeof item?.role === 'string' && item.role.trim() ? item.role.trim().slice(0, 40) : 'support',
      percent: policyPercent(item?.percent, 'Tỷ lệ quy thuộc', 0),
    }))
    if (splits.some((item) => item.percent <= 0)) throw new HttpsError('invalid-argument', 'Mỗi tỷ lệ quy thuộc phải lớn hơn 0%.')
    if (new Set(splits.map((item) => item.staffId)).size !== splits.length) throw new HttpsError('invalid-argument', 'Một nhân sự không thể xuất hiện hai lần trong quyết định chia.')
    if (Math.abs(splits.reduce((sum, item) => sum + item.percent, 0) - 100) > 0.001) throw new HttpsError('invalid-argument', 'Tổng tỷ lệ quy thuộc phải bằng 100%.')
    const reference = db.doc(`contractRenewalCases/${caseId}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy hồ sơ gia hạn.')
      const value = snapshot.data() || {}
      const periodId = typeof value.wonAt?.toDate === 'function'
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(value.wonAt.toDate()).slice(0, 7)
        : String(value.updatedAt?.toDate?.()?.toISOString?.() || '').slice(0, 7)
      if (periodId) {
        const run = await transaction.get(db.doc(`payrollRuns/${periodId}`))
        if (run.exists && ['locked', 'paid'].includes(run.data().status)) throw new HttpsError('failed-precondition', 'Kỳ lương liên quan đã khóa; không được thay đổi attribution hồi tố.')
      }
      transaction.update(reference, {
        approvedAttribution: { splits, reason, approvedBy: actor.uid, approvedAt: FieldValue.serverTimestamp() },
        revision: Number(value.revision || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      })
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 6, action: 'payroll.renew_attribution.approved', caseId, actorUid: actor.uid, splits, reason, createdAt: FieldValue.serverTimestamp() })
      return { caseId, splits }
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
          teachingEvidenceReviewRequiredCount: Number(data.teachingEvidenceReviewRequiredCount || 0),
          teachingEvidenceReviewRequiredSessionIds: Array.isArray(data.teachingEvidenceReviewRequiredSessionIds) ? data.teachingEvidenceReviewRequiredSessionIds.slice(0, 500) : [],
          targetStatus: data.targetStatus || data.targetSnapshot?.status || '',
          targetSource: data.targetSource || data.targetSnapshot?.source || '',
          targetSourcePeriodId: data.targetSnapshot?.sourcePeriodId || '',
          validationViolationCount: Number(data.validationViolationCount || 0),
          validationViolations: Array.isArray(data.validationViolations) ? data.validationViolations : [],
          attendanceReviewRequired: data.attendanceReviewRequired === true,
          baseSalaryAmount: Number(data.baseSalaryAmount || 0),
          teachingPayAmount: Number(data.teachingPayAmount || 0),
          commissionAmount: Number(data.commissionAmount || 0),
          bonusAmount: Number(data.bonusAmount || 0),
          deductionAmount: Number(data.deductionAmount || 0),
          earningEventApprovedAmount: Number(data.earningEventApprovedAmount || 0),
          earningEventPendingAmount: Number(data.earningEventPendingAmount || 0),
          earningEventDisputedAmount: Number(data.earningEventDisputedAmount || 0),
          sessionEvidencePendingAmount: Number(data.sessionEvidencePendingAmount || 0),
          grossAmount: Number(data.grossAmount || 0),
          adjustmentAmount: Number(data.adjustmentAmount || 0),
          finalAmount: Number(data.finalAmount || data.grossAmount || 0),
          intelligenceSchemaVersion: Number(data.intelligenceSchemaVersion || 0),
          intelligencePolicyId: data.intelligencePolicyId || '',
          intelligenceSummary: data.intelligenceSummary && typeof data.intelligenceSummary === 'object' ? data.intelligenceSummary : undefined,
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
    const runPeriodId = period(runData.periodId || runId)
    const runDateBounds = periodDateBounds(runPeriodId)
    const sourceSessionSnapshot = await db.collection('sessions')
      .where('date', '>=', runDateBounds.start)
      .where('date', '<', runDateBounds.end)
      .select('status', 'trainerId', 'studentId', 'date', 'hour', 'branchId')
      .limit(3001)
      .get()
    const validationViolations = sourceSessionSnapshot.size > 3000
      ? [{
        code: 'PAYROLL_DATA_LIMIT_EXCEEDED',
        severity: 'error',
        title: 'Không thể đối soát toàn bộ buổi của kỳ',
        detail: 'Kỳ có quá nhiều buổi để kiểm tra trùng ngày trong một lần tải. Hãy dùng báo cáo đối soát dữ liệu nguồn.',
        remediation: 'retry',
        periodId: runPeriodId,
      }]
      : await enrichPayrollViolations(db, duplicateLearnerDayViolations(sourceSessionSnapshot.docs))
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
        validationViolations,
        validationViolationCount: validationViolations.length,
        attendanceReviewRequired: runData.attendanceReviewRequired === true || validationViolations.length > 0,
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
    const previousTargetPeriodId = previousPayrollPeriod(periodId)
    const requestedPlan = payrollRunPolicyPlan(request.data || {})
    // One deterministic document per business period prevents two admins from
    // creating duplicate payroll runs concurrently.
    const runReference = db.doc(`payrollRuns/${periodId}`)
    try {
      return await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(runReference)
      if (existing.exists) return { runId: existing.id, unchanged: true, status: existing.data().status }

      const [sessionSnapshot, workoutLogSnapshot, staffSnapshot, trainerRecordsSnapshot, assignmentSnapshot, workdayAttendanceSnapshot, calendarSnapshot, schedulePolicySnapshot, referralLedgerSnapshot, adjustmentSnapshot, earningEventSnapshot, intelligencePolicySnapshot, targetSnapshot, previousTargetSnapshot, renewalSnapshot, renewalCohortSourceSnapshot, feedbackSnapshot] = await Promise.all([
        transaction.get(db.collection('sessions')
          .where('date', '>=', dateBounds.start)
          .where('date', '<', dateBounds.end)
          .select('status', 'trainerId', 'studentId', 'date', 'hour', 'branchId', 'attendanceEventId', 'attendanceStatus', 'confirmationSource', 'recognitionReviewRequired', 'payrollEvidenceReview')
          .limit(3001)),
        transaction.get(db.collection('ptWorkoutLogs')
          .where('date', '>=', dateBounds.start)
          .where('date', '<', dateBounds.end)
          .select('sessionId', 'status', 'trainingDayTitle', 'planSnapshot', 'sets', 'painNotes', 'nextSessionPlan')
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
        transaction.get(db.collection('payrollEarningEvents').where('periodId', '==', periodId).limit(1001)),
        // Supplemental performance data is read as evidence only. It never
        // participates in the existing salary/teaching-pay/commission math.
        transaction.get(db.collection('payrollIncentivePolicies').limit(100)),
        transaction.get(db.doc(`payrollTargets/${periodId}`)),
        transaction.get(db.doc(`payrollTargets/${previousTargetPeriodId}`)),
        transaction.get(db.collection('contractRenewalCases')
          .where('updatedAt', '>=', start)
          .where('updatedAt', '<', end)
          .limit(3001)),
        transaction.get(db.collection('contractRenewalCases').where('active', '==', true).limit(1001)),
        transaction.get(db.collection('sessionFeedback')
          .where('submittedAt', '>=', start)
          .where('submittedAt', '<', end)
          .limit(3001)),
      ])
      if (sessionSnapshot.size > 3000 || workoutLogSnapshot.size > 3000 || staffSnapshot.size > 450 || trainerRecordsSnapshot.size > 450 || assignmentSnapshot.size > 450 || workdayAttendanceSnapshot.size > 5000 || calendarSnapshot.size > 100 || referralLedgerSnapshot.size > 5000 || adjustmentSnapshot.size > 1000 || earningEventSnapshot.size > 1000 || renewalCohortSourceSnapshot.size > 1000) {
        throw payrollViolationError(
          'PAYROLL_DATA_LIMIT_EXCEEDED',
          'Dữ liệu kỳ lương vượt giới hạn an toàn',
          'Kỳ lương có quá nhiều ca, nhân sự, ngày công hoặc khoản điều chỉnh để lập trong một giao dịch. Hãy liên hệ quản trị để chia nhỏ và đối soát dữ liệu nguồn.',
          'retry',
          {
            periodId,
            sessionCount: sessionSnapshot.size,
            workoutLogCount: workoutLogSnapshot.size,
            staffCount: staffSnapshot.size,
            attendanceDayCount: workdayAttendanceSnapshot.size,
            adjustmentCount: adjustmentSnapshot.size,
            earningEventCount: earningEventSnapshot.size,
            renewCohortCount: renewalCohortSourceSnapshot.size,
          },
          'resource-exhausted',
        )
      }
      const trainerRecordById = new Map(trainerRecordsSnapshot.docs.map((item) => [item.id, item.data() || {}]))
      const sessionsById = new Map(sessionSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]))
      const logsBySessionId = new Map(workoutLogSnapshot.docs.map((item) => [item.data()?.sessionId || '', item.data() || {}]))
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
      const baseIntelligencePolicy = chooseEffectivePayrollIntelligencePolicy(
        intelligencePolicySnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
        dateBounds.start,
      )
      const target = resolvedPayrollTarget(periodId, targetSnapshot, previousTargetSnapshot, baseIntelligencePolicy)
      const intelligencePolicy = applyPayrollTarget(baseIntelligencePolicy, target)
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
        staffRecords: new Map(staffRecordById),
        staffPolicyAssignments: new Map([...staffRecordById]
          .filter(([, staff]) => typeof staff.payrollPolicyId === 'string' && staff.payrollPolicyId)
          .map(([staffId, staff]) => [staffId, staff.payrollPolicyId])),
      }
      const duplicateLearnerDays = duplicateLearnerDayViolations(sessionSnapshot.docs)
      if (duplicateLearnerDays.length) {
        throw payrollViolationsError(await enrichPayrollViolations(db, duplicateLearnerDays, transaction))
      }
      const groupedTeaching = teachingSlotsFromSessions(sessionSnapshot.docs, selectedPolicies[0].configuration)
      const teaching = applyPayrollPolicyPlan(groupedTeaching, policyPlan, selectedPolicies)
      const evidencePoliciesById = new Map(selectedPolicies.map((policy) => [policy.id, policy]))
      const teachingWithEvidence = applySessionEvidencePolicy(teaching, sessionsById, logsBySessionId, evidencePoliciesById, new Date())
      const activeAdjustments = adjustmentSnapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => item.status !== 'voided' && (item.type === 'bonus' || item.type === 'deduction') && Number(item.amount || 0) > 0)
      const earningEvents = earningEventSnapshot.docs.map((item) => ({ id: item.id, ...item.data(), status: payrollEarningStatus(item.data()?.status), signedAmount: Number(item.data()?.signedAmount || 0) }))
      const activeStaff = [...staffRecordById.values()]
      const staffIds = [...new Set([...activeStaff.map((item) => item.id), ...teachingWithEvidence.trainers.keys(), ...activeAdjustments.map((item) => item.staffId).filter(Boolean), ...earningEvents.map((item) => item.staffId).filter(Boolean)])]
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
      const earningEventsByStaff = new Map()
      earningEvents.forEach((event) => {
        const current = earningEventsByStaff.get(event.staffId) || []
        current.push(event)
        earningEventsByStaff.set(event.staffId, current)
      })
      const itemRecords = staffIds.map((staffId) => {
        const staff = { ...(trainerRecordById.get(staffId) || {}), ...(staffRecordById.get(staffId) || {}) }
        const identity = identityById.get(staffId) || {}
        const calendar = mergeWorkCalendar(periodId, globalCalendar, calendars.get(identity.branchId) || {}, schedulePolicy)
        const teachingSlots = teachingWithEvidence.trainers.get(staffId) || []
        const workdays = calculateWorkdayPayroll({
          periodId,
          calendar,
          attendance: workdayAttendanceByStaff.get(staffId) || [],
          teachingSlots,
          staff,
          today: vietnamDateKey(new Date()),
        })
        const itemPolicyIds = [...new Set(teachingSlots.map((slot) => slot.policyId).filter(Boolean))]
        const staffPayrollProfile = payrollProfile(staff)
        const compensationPolicy = selectedPolicyById.get(itemPolicyIds[0])
          || selectedPolicyById.get(typeof staff.payrollPolicyId === 'string' ? staff.payrollPolicyId : '')
          || [...selectedPolicies].reverse().find((policy) => policySupportsProfile(policy, staffPayrollProfile))
          || defaultPolicy
        const capabilities = compensationPolicy.configuration.capabilities
        const staffEarningEvents = (earningEventsByStaff.get(staffId) || []).map((event) => ({ ...event, policyEligible: payrollEarningAllowedByPolicy(event, capabilities) }))
        const earningBuckets = payrollEarningBuckets(staffEarningEvents.filter((event) => event.policyEligible))
        const earningEventPayableAmount = staffEarningEvents
          .filter((event) => event.policyEligible && ['approved', 'paid'].includes(event.status))
          .reduce((total, event) => total + Number(event.signedAmount || 0), 0)
        const earningEventBonusAmount = Math.max(0, earningEventPayableAmount)
        const earningEventDeductionAmount = Math.max(0, -earningEventPayableAmount)
        const payableWorkdays = {
          ...workdays,
          baseSalaryEarned: capabilities.baseSalaryEnabled ? workdays.baseSalaryEarned : 0,
          fixedBonus: capabilities.additionalBonusEnabled ? workdays.fixedBonus : 0,
        }
        const teachingPayAmount = capabilities.teachingCommissionEnabled
          ? teachingSlots.reduce((total, slot) => total + slot.rate, 0)
          : 0
        const referralSource = referralEvidence.byStaff.get(staffId) || {
          cashCollectedAmount: 0, cashReversedAmount: 0, netCashAmount: 0,
          commissionAmount: 0, reversalAmount: 0, contractCount: 0, evidence: [], rate: 0,
        }
        const referral = capabilities.selfGeneratedCommissionEnabled
          ? referralSource
          : { ...referralSource, commissionAmount: 0, reversalAmount: 0, disabledByPolicy: true }
        const baseAmounts = payrollAmounts(payableWorkdays, {
          grossAmount: teachingPayAmount,
          commissionAmount: referral.commissionAmount,
          deductionAmount: referral.reversalAmount,
        })
        const payrollAdjustments = adjustmentsByStaff.get(staffId) || []
        const manualBonusAmount = capabilities.additionalBonusEnabled ? payrollAdjustments
          .filter((item) => item.type === 'bonus')
          .reduce((total, item) => total + Number(item.amount || 0), 0) : 0
        const manualDeductionAmount = payrollAdjustments
          .filter((item) => item.type === 'deduction')
          .reduce((total, item) => total + Number(item.amount || 0), 0)
        const amounts = {
          ...baseAmounts,
          bonusAmount: baseAmounts.bonusAmount + manualBonusAmount + earningEventBonusAmount,
          deductionAmount: baseAmounts.deductionAmount + manualDeductionAmount + earningEventDeductionAmount,
          grossAmount: baseAmounts.grossAmount + manualBonusAmount + earningEventBonusAmount,
          finalAmount: Math.max(0, baseAmounts.finalAmount + manualBonusAmount + earningEventBonusAmount - manualDeductionAmount - earningEventDeductionAmount),
        }
        const intelligence = buildPayrollIntelligence({
          staffId,
          teachingSlots,
          referralEvidence: referral,
          feedback: feedbackSnapshot.docs,
          renewals: renewalSnapshot.docs,
          workdays,
          policy: intelligencePolicy,
        })
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
        return { staffId, staff, identity, calendar, workdays, teachingSlots, amounts, baseAmounts, referral, intelligence, itemPolicyIds, staffPayrollProfile, payrollAdjustments, manualBonusAmount, manualDeductionAmount, compensationPolicy, capabilities, staffEarningEvents, earningBuckets, earningEventBonusAmount, earningEventDeductionAmount }
      })
      const renewCohorts = renewCohortByStaff(renewalCohortSourceSnapshot.docs, new Set(staffIds))
      if (renewCohorts.size > 100 || staffIds.length + renewCohorts.size > 480) throw payrollViolationError(
        'PAYROLL_SNAPSHOT_WRITE_LIMIT_EXCEEDED',
        'Quá nhiều snapshot trong một kỳ',
        'Số nhân sự và mẫu Renew vượt giới hạn giao dịch an toàn. Hãy liên hệ quản trị để tách luồng snapshot.',
        'retry',
        { periodId, staffCount: staffIds.length, renewCohortStaffCount: renewCohorts.size },
        'resource-exhausted',
      )
      const grossAmount = itemRecords.reduce((total, item) => total + item.amounts.grossAmount, 0)
      const finalAmount = itemRecords.reduce((total, item) => total + item.amounts.finalAmount, 0)
      const workdayStaffCount = itemRecords.filter((item) => item.workdays.workdayEnabled).length
      const attendanceReviewRequiredCount = itemRecords.filter((item) => item.workdays.attendanceReviewRequired).length
      const calendarReviewRequiredCount = itemRecords.filter((item) => item.workdays.calendarReviewRequired).length
      const hardTeachingEvidenceReviewRequiredCount = Number(teaching.teachingEvidenceReviewRequiredCount || 0)
      const teachingEvidenceReviewRequiredCount = hardTeachingEvidenceReviewRequiredCount + Number(teachingWithEvidence.sessionEvidenceReviewRequiredCount || 0)
      const intelligenceItems = itemRecords.map((item) => item.intelligence).filter(Boolean)
      const intelligenceRankCounts = intelligenceItems.reduce((result, item) => {
        const key = item.rank?.code || 'unconfigured'
        result[key] = Number(result[key] || 0) + 1
        return result
      }, {})
      const intelligenceSummary = {
        schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
        enabled: intelligenceItems.some((item) => item.enabled),
        policyId: intelligencePolicy?.id || '',
        policyVersion: intelligencePolicy?.version || 0,
        policyName: intelligencePolicy?.name || '',
        staffCount: intelligenceItems.length,
        evidenceCount: intelligenceItems.reduce((sum, item) => sum + Number(item.evidenceLedgerSummary?.count || 0), 0),
        reviewCount: intelligenceItems.reduce((sum, item) => sum + Number(item.evidenceLedgerSummary?.reviewCount || 0), 0),
        renewalWonCount: intelligenceItems.reduce((sum, item) => sum + Number(item.renew?.wonCount || 0), 0),
        attributedRevenue: intelligenceItems.reduce((sum, item) => sum + Number(item.attribution?.attributedRevenue || 0), 0),
        rankCounts: intelligenceRankCounts,
        amountImpact: 'none',
        sourceTruncated: renewalSnapshot.size > 3000 || feedbackSnapshot.size > 3000,
      }
      if (intelligencePolicy?.enabled && !targetSnapshot.exists) {
        transaction.create(db.doc(`payrollTargets/${periodId}`), {
          schemaVersion: 1,
          periodId,
          status: 'provisional',
          source: target.source,
          sourcePeriodId: target.sourcePeriodId || null,
          metricTargets: target.metricTargets,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'system:payroll-run',
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      for (const [staffId, cases] of renewCohorts) {
        transaction.create(db.doc(`renewCohortSnapshots/${periodId}_${staffId}`), {
          schemaVersion: 1,
          periodId,
          staffId,
          status: 'draft',
          cases,
          includedCount: cases.length,
          excluded: [],
          policySnapshot: selectedPolicies.find((policy) => policy.configuration.capabilities.renewCommissionEnabled)?.configuration.renewEligibility || defaultPolicy.configuration.renewEligibility,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.create(runReference, {
        schemaVersion: 8,
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
        teachingSlotCount: teachingWithEvidence.payableTeachingSlotCount,
        attendanceEventCount: teaching.attendanceEventCount,
        trainerCount: teaching.trainers.size,
        staffCount: itemRecords.length,
        workdayStaffCount,
        attendanceReviewRequired: attendanceReviewRequiredCount > 0 || calendarReviewRequiredCount > 0 || hardTeachingEvidenceReviewRequiredCount > 0,
        attendanceReviewRequiredCount,
        calendarReviewRequiredCount,
        teachingEvidenceReviewRequiredCount,
        teachingEvidenceReviewRequiredSessionIds: [...new Set([...(teaching.teachingEvidenceReviewRequiredSessionIds || []), ...(teachingWithEvidence.sessionEvidenceReviewRequiredSessionIds || [])])].slice(0, 500),
        crossBranchWarningCount: Number(teaching.crossBranchWarningCount || 0),
        sessionEvidenceReviewRequired: teachingWithEvidence.sessionEvidence || [],
        sessionEvidencePendingAmount: (teachingWithEvidence.sessionEvidence || []).reduce((total, item) => total + Number(item.amount || 0), 0),
        intelligenceSchemaVersion: INTELLIGENCE_SCHEMA_VERSION,
        intelligencePolicyId: intelligencePolicy?.id || '',
        intelligencePolicySnapshot: payrollIntelligencePolicySnapshot(intelligencePolicy),
        intelligenceSummary,
        targetStatus: intelligencePolicy?.enabled ? target.status : 'not_required',
        targetSource: target.source,
        targetSnapshot: {
          periodId,
          status: intelligencePolicy?.enabled ? target.status : 'not_required',
          source: target.source,
          sourcePeriodId: target.sourcePeriodId || null,
          metricTargets: target.metricTargets,
          reason: target.reason || '',
          approvedBy: target.approvedBy || null,
          approvedAt: target.approvedAt || null,
        },
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
        earningEventCount: earningEvents.length,
        earningEventApprovedAmount: itemRecords.reduce((total, item) => total + item.earningBuckets.approvedAmount, 0),
        earningEventPendingAmount: itemRecords.reduce((total, item) => total + item.earningBuckets.pendingAmount, 0),
        earningEventDisputedAmount: itemRecords.reduce((total, item) => total + item.earningBuckets.disputedAmount, 0),
        earningEventRejectedAmount: itemRecords.reduce((total, item) => total + item.earningBuckets.rejectedAmount, 0),
        renewCohortStaffCount: renewCohorts.size,
        renewCohortCaseCount: [...renewCohorts.values()].reduce((total, cases) => total + cases.length, 0),
        grossAmount,
        adjustmentAmount: 0,
        finalAmount,
        timeZone: 'Asia/Ho_Chi_Minh',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      for (const item of itemRecords) {
        const { staffId, identity, calendar, workdays, teachingSlots, amounts, baseAmounts, referral, intelligence, itemPolicyIds, staffPayrollProfile, payrollAdjustments, manualBonusAmount, manualDeductionAmount, compensationPolicy, capabilities, staffEarningEvents, earningBuckets, earningEventBonusAmount, earningEventDeductionAmount } = item
        const itemReference = db.doc(`payrollRunItems/${periodId}_${staffId}`)
        const tierSummary = teachingSlots.reduce((result, slot) => {
          if (slot.tier === 'standard') { result.standardCount += 1; result.standardAmount += slot.rate }
          else if (slot.tier === 'after_threshold') { result.afterThresholdCount += 1; result.afterThresholdAmount += slot.rate }
          else { result.afterThresholdEveningCount += 1; result.afterThresholdEveningAmount += slot.rate }
          return result
        }, { standardCount: 0, standardAmount: 0, afterThresholdCount: 0, afterThresholdAmount: 0, afterThresholdEveningCount: 0, afterThresholdEveningAmount: 0 })
        transaction.create(itemReference, {
          schemaVersion: 8,
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
          compensationPolicyId: compensationPolicy.id,
          compensationCapabilities: capabilities,
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
          intelligenceSchemaVersion: INTELLIGENCE_SCHEMA_VERSION,
          incentivePolicyId: intelligence.policyId || '',
          incentivePolicySnapshot: intelligence.policySnapshot || null,
          evidenceLedger: intelligence.evidenceLedger || [],
          evidenceLedgerSummary: intelligence.evidenceLedgerSummary || { count: 0, reviewCount: 0, truncated: false, bySource: {}, byRole: {} },
          attributionSummary: intelligence.attribution || { conflictCount: 0, sourceCount: 0, attributedRevenue: 0, attributedCommission: 0, bySource: {}, byRole: {} },
          renewSummary: intelligence.renew || { wonCount: 0, assistedCount: 0, attributedRevenue: 0, reviewCount: 0 },
          kpiSummary: intelligence.kpi || { enabled: false, score: null, weightTotal: 0, metrics: [], reason: 'Chưa bật chính sách KPI.' },
          rankSummary: intelligence.rank || { code: 'unconfigured', label: 'Chưa xếp hạng', score: null, configured: false },
          incentiveAmount: 0,
          incentiveAmountImpact: 'none',
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
          earningEvents: staffEarningEvents.map((event) => ({ id: event.id, type: event.type, sourceType: event.sourceType || '', sourceId: event.sourceId || '', grossAmount: Number(event.grossAmount || 0), signedAmount: Number(event.signedAmount || 0), status: event.status, policyEligible: event.policyEligible, evidenceReference: event.evidenceReference || '', reviewReason: event.reviewReason || '' })),
          earningEventSummary: { ...earningBuckets, bonusAmount: earningEventBonusAmount, deductionAmount: earningEventDeductionAmount },
          earningEventApprovedAmount: earningBuckets.approvedAmount,
          earningEventPendingAmount: earningBuckets.pendingAmount,
          earningEventDisputedAmount: earningBuckets.disputedAmount,
          sessionEvidencePendingAmount: (teachingWithEvidence.sessionEvidence || []).filter((evidence) => evidence.trainerId === staffId).reduce((total, evidence) => total + Number(evidence.amount || 0), 0),
          grossAmount: amounts.grossAmount,
          adjustmentAmount: 0,
          finalAmount: amounts.finalAmount,
          status: 'draft',
          evidenceSource: workdays.workdayEnabled ? 'staffAttendanceDays+sessions+ledgerEntries+contracts' : 'sessions+ledgerEntries+contracts',
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 6, runId: runReference.id, action: 'payroll.created', actorUid: actor.uid, toStatus: 'draft', policyIds, policyApplicationMode: selectedPolicies.length === 1 ? 'single' : policyPlan.applicationMode, staffCount: itemRecords.length, workdayStaffCount, attendanceReviewRequiredCount, calendarReviewRequiredCount, teachingEvidenceReviewRequiredCount, sessionEvidenceReviewRequiredCount: teachingWithEvidence.sessionEvidenceReviewRequiredCount || 0, createdAt: FieldValue.serverTimestamp() })
      return { runId: runReference.id, unchanged: false, status: 'draft' }
      })
    } catch (cause) {
      if (cause instanceof HttpsError) {
        const details = cause.details && typeof cause.details === 'object' ? cause.details : {}
        if (Array.isArray(details.violations) && details.violations.length) {
          const violations = await enrichPayrollViolations(db, details.violations)
          throw new HttpsError(cause.code, cause.message, { ...details, violations })
        }
        throw cause
      }
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
      const [run, items, cohorts] = await Promise.all([
        transaction.get(runReference),
        transaction.get(db.collection('payrollRunItems').where('runId', '==', runId).limit(451)),
        transaction.get(db.collection('renewCohortSnapshots').where('periodId', '==', runId).limit(101)),
      ])
      if (!run.exists) return { runId, unchanged: true }
      if (run.data().status !== 'draft') {
        throw new HttpsError('failed-precondition', 'Chỉ kỳ lương chưa duyệt mới được xóa để lập lại.')
      }
      if (items.size > 450) throw new HttpsError('resource-exhausted', 'Kỳ lương có quá nhiều dòng để xóa an toàn.')
      if (cohorts.size > 100) throw new HttpsError('resource-exhausted', 'Kỳ lương có quá nhiều mẫu Renew để xóa an toàn.')
      items.docs.forEach((item) => transaction.delete(item.ref))
      cohorts.docs.forEach((item) => transaction.delete(item.ref))
      transaction.delete(runReference)
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 4,
        runId,
        action: 'payroll.draft.deleted',
        actorUid: actor.uid,
        deletedItemCount: items.size,
        deletedCohortCount: cohorts.size,
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
        throw new HttpsError('failed-precondition', 'Ngày công, lịch làm việc hoặc bằng chứng ca dạy của kỳ chưa được đối soát đầy đủ.')
      }
      let renewCohorts = []
      if (to === 'reviewed') {
        const runPeriodId = period(snapshot.data().periodId || runId)
        const dateBounds = periodDateBounds(runPeriodId)
        const sessions = await transaction.get(db.collection('sessions')
          .where('date', '>=', dateBounds.start)
          .where('date', '<', dateBounds.end)
          .select('status', 'trainerId', 'studentId', 'date', 'hour', 'branchId')
          .limit(3001))
        if (sessions.size > 3000) {
          throw payrollViolationError(
            'PAYROLL_DATA_LIMIT_EXCEEDED',
            'Không thể đối soát toàn bộ buổi của kỳ',
            'Kỳ có quá nhiều buổi để kiểm tra an toàn trước khi gửi duyệt.',
            'retry',
            { periodId: runPeriodId },
            'resource-exhausted',
          )
        }
        const duplicateLearnerDays = await enrichPayrollViolations(db, duplicateLearnerDayViolations(sessions.docs), transaction)
        if (duplicateLearnerDays.length) throw payrollViolationsError(duplicateLearnerDays)
        const cohortSnapshot = await transaction.get(db.collection('renewCohortSnapshots').where('periodId', '==', runPeriodId).limit(101))
        if (cohortSnapshot.size > 100) throw new HttpsError('resource-exhausted', 'Kỳ có quá nhiều mẫu Renew để khóa an toàn.')
        renewCohorts = cohortSnapshot.docs
      }
      transaction.update(reference, { status: to, ...fields, [`${to}At`]: FieldValue.serverTimestamp(), [`${to}By`]: actor.uid, updatedAt: FieldValue.serverTimestamp() })
      renewCohorts.forEach((cohort) => transaction.update(cohort.ref, { status: 'locked', lockedAt: FieldValue.serverTimestamp(), lockedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() }))
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
      if (run.data().intelligenceSummary?.enabled === true && run.data().targetStatus !== 'approved') {
        throw payrollViolationError(
          'PAYROLL_TARGET_APPROVAL_REQUIRED',
          'Target KPI chưa được duyệt',
          'Hãy duyệt target của kỳ. Nếu đang tạm dùng target tháng trước, Manager cần xác nhận rõ trước khi khóa lương.',
          'policy',
          { periodId: run.data().periodId || runId, targetStatus: run.data().targetStatus || 'provisional' },
        )
      }
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
    listPayrollIntelligencePolicies,
    getPayrollTarget,
    savePayrollTarget,
    approvePayrollTarget,
    savePayrollIntelligencePolicy,
    managePayrollIntelligencePolicy,
    savePayrollPolicy,
    managePayrollPolicy,
    reviewPayrollSessionEvidence,
    listPayrollEarningEvents,
    savePayrollEarningEvent,
    reviewPayrollEarningEvent,
    approveRenewAttribution,
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
  duplicateLearnerDayViolations,
  teachingSlotsFromAttendance,
  teachingSlotsFromSessions,
  payrollRunPolicyPlan,
  applyPayrollPolicyPlan,
  priceTeachingSlots,
  evaluateSessionNoteEvidence,
  applySessionEvidencePolicy,
  payrollIntelligencePolicyInput,
}
