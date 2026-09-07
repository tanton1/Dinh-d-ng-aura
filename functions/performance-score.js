const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { createHash } = require('node:crypto')
const { trustedAccessContext, requireCapability } = require('./identity-access')

const PERFORMANCE_SCHEMA_VERSION = 2
const PERFORMANCE_POLICY_VERSION = 'aura-pt-performance-v1.0-2026-09-07'
const EVIDENCE_STATUSES = new Set(['submitted', 'needs_revision', 'approved', 'rejected', 'withdrawn'])
const REVIEW_STATUSES = new Set(['approved', 'needs_revision', 'rejected'])
const EVIDENCE_TYPES = new Set(['personal_content', 'aura_assignment'])
const PLATFORMS = new Set(['facebook', 'instagram', 'tiktok', 'youtube', 'group', 'other'])
const PERFORMANCE_GATE_IDS = Object.freeze(['quality', 'attendance', 'client_safety', 'integrity'])
const PERFORMANCE_REVIEW_SOURCES = new Set(['manager_review', 'system_auto', 'system_fallback', 'rolling_average', 'neutral_score'])
const PROFILE_CHECKLIST_KEYS = Object.freeze([
  'photo',
  'bio',
  'certifications',
  'expertise',
  'case_studies',
  'reviews',
  'intro_video',
  'social_links',
  'schedule',
  'contact',
])
// This is the locked KPI policy from the Aura PT Growth System. Keep the
// weights here as the single source of truth; the payroll policy is a
// separate concern and must not silently change the Performance Score.
const PERFORMANCE_CATEGORIES = Object.freeze([
  {
    id: 'coaching_quality', label: 'Chất lượng huấn luyện', weight: 25,
    submetrics: [
      { id: 'customer_rating', label: 'Customer Rating', weight: 10 },
      { id: 'coaching_audit', label: 'Coaching Audit', weight: 8 },
      { id: 'client_progress', label: 'Client Progress', weight: 7 },
    ],
  },
  {
    id: 'client_care', label: 'Chăm sóc học viên', weight: 15,
    submetrics: [
      { id: 'weekly_checkin', label: 'Weekly Check-in', weight: 6 },
      { id: 'at_risk_followup', label: 'At-risk Follow-up', weight: 4 },
      { id: 'progress_review', label: 'Progress Review', weight: 3 },
      { id: 'communication', label: 'Communication', weight: 2 },
    ],
  },
  {
    id: 'nutrition_care', label: 'Chăm sóc dinh dưỡng', weight: 10,
    submetrics: [
      { id: 'nutrition_review_completion', label: 'Nutrition Review Completion', weight: 4 },
      { id: 'feedback_sla', label: 'Feedback SLA', weight: 3 },
      { id: 'compliance_management', label: 'Compliance Management', weight: 3 },
    ],
  },
  {
    id: 'retention_renew', label: 'Duy trì & tái ký', weight: 20,
    submetrics: [
      { id: 'renew_rate', label: 'Renew Rate', weight: 15 },
      { id: 'renewal_process', label: 'Renewal Process', weight: 3 },
      { id: 'churn_documentation', label: 'Churn Documentation', weight: 2 },
    ],
  },
  {
    id: 'business_contribution', label: 'Đóng góp kinh doanh', weight: 10,
    submetrics: [
      { id: 'self_generated_revenue', label: 'Doanh thu tự tạo so target', weight: 4 },
      { id: 'renew_cash_vs_forecast', label: 'Renew thực thu so forecast', weight: 2 },
      { id: 'qualified_lead_conversion', label: 'Qualified Lead Conversion', weight: 2 },
      { id: 'quality_new_referral', label: 'Khách mới / referral chất lượng', weight: 2 },
    ],
  },
  {
    id: 'brand', label: 'Thương hiệu cá nhân / Aura Brand', weight: 10,
    submetrics: [
      { id: 'personal_brand', label: 'Personal Brand', weight: 5 },
      { id: 'aura_brand', label: 'Aura Brand', weight: 3 },
      { id: 'profile_quality', label: 'Profile Quality', weight: 2 },
    ],
  },
  {
    id: 'operations_discipline', label: 'Vận hành & kỷ luật', weight: 10,
    submetrics: [
      { id: 'attendance', label: 'Attendance', weight: 3 },
      { id: 'schedule_management', label: 'Schedule Management', weight: 2 },
      { id: 'training_notes', label: 'Training / Data Notes', weight: 2 },
      { id: 'sop', label: 'SOP', weight: 2 },
      { id: 'teamwork', label: 'Teamwork', weight: 1 },
    ],
  },
])

const PERFORMANCE_METRIC_INDEX = new Map(PERFORMANCE_CATEGORIES.flatMap((category) => (
  category.submetrics.map((metric) => [metric.id, { ...metric, categoryId: category.id }])
)))
const RATIO_METRICS = new Set([
  'weekly_checkin', 'at_risk_followup', 'progress_review', 'nutrition_review_completion',
  'feedback_sla', 'renewal_process', 'churn_documentation', 'quality_new_referral',
])
const DIRECT_REVIEW_METRICS = new Set([
  'client_progress', 'communication', 'compliance_management', 'schedule_management',
  'training_notes', 'sop', 'teamwork',
])
const BRAND_METRIC_IDS = new Set(['personal_brand', 'aura_brand', 'profile_quality'])
const FALLBACK_SOURCES = new Set(['system_fallback', 'rolling_average', 'neutral_score'])
const BONUS_BANDS = Object.freeze([
  { minimum: 95, classification: 'Outstanding', bonusAmount: 3_000_000 },
  { minimum: 90, classification: 'Excellent', bonusAmount: 2_000_000 },
  { minimum: 85, classification: 'Very Good', bonusAmount: 1_500_000 },
  { minimum: 80, classification: 'Good', bonusAmount: 1_000_000 },
  { minimum: 70, classification: 'Pass', bonusAmount: 500_000 },
  { minimum: 0, classification: 'Improvement Required', bonusAmount: 0 },
])

function finiteNumber(value) {
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function rounded(value, digits = 1) {
  const factor = 10 ** digits
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor
}

function boundedNumber(value, minimum, maximum) {
  const result = finiteNumber(value)
  return result !== null && result >= minimum && result <= maximum ? result : null
}

function metricUnavailable(metric, input = {}, reason = 'Chưa có dữ liệu đã xác minh cho kỳ đánh giá.') {
  return {
    ...metric,
    score: null,
    status: 'not_available',
    source: typeof input.source === 'string' ? input.source : '',
    actual: finiteNumber(input.actual),
    target: finiteNumber(input.target),
    numerator: finiteNumber(input.numerator),
    denominator: finiteNumber(input.denominator),
    sampleSize: Math.max(0, Math.trunc(finiteNumber(input.sampleSize) || 0)),
    note: typeof input.note === 'string' ? input.note : '',
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.slice(0, 20) : [],
    reason,
  }
}

function metricAvailable(metric, input, score, extra = {}) {
  return {
    ...metric,
    score: rounded(Math.max(0, Math.min(metric.weight, score))),
    status: 'available',
    source: typeof input.source === 'string' ? input.source : 'manager_review',
    actual: finiteNumber(input.actual),
    target: finiteNumber(input.target),
    numerator: finiteNumber(input.numerator),
    denominator: finiteNumber(input.denominator),
    sampleSize: Math.max(0, Math.trunc(finiteNumber(input.sampleSize) || 0)),
    note: typeof input.note === 'string' ? input.note : '',
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.slice(0, 20) : [],
    reason: '',
    ...extra,
  }
}

function thresholdScore(value, bands) {
  return bands.find((band) => value >= band.minimum)?.score ?? null
}

function calculateMetricScore(metricId, rawInput = {}) {
  const metric = PERFORMANCE_METRIC_INDEX.get(metricId)
  if (!metric) throw new Error(`Unknown performance metric: ${metricId}`)
  const input = rawInput && typeof rawInput === 'object' ? rawInput : {}
  if (BRAND_METRIC_IDS.has(metricId)) return metricUnavailable(metric, input, 'Brand được tính từ bằng chứng đã duyệt, không chấm tay.')
  const source = PERFORMANCE_REVIEW_SOURCES.has(input.source) ? input.source : 'manager_review'
  const normalized = { ...input, source }
  const manualScore = boundedNumber(input.manualScore ?? input.score, 0, metric.weight)
  if (FALLBACK_SOURCES.has(source) && manualScore !== null) {
    return metricAvailable(metric, normalized, manualScore, { calculation: 'approved_fallback' })
  }
  if (DIRECT_REVIEW_METRICS.has(metricId)) {
    return manualScore === null
      ? metricUnavailable(metric, normalized, 'Chỉ số rubric cần điểm được Manager/Head Coach duyệt.')
      : metricAvailable(metric, normalized, manualScore, { calculation: 'approved_rubric' })
  }

  const actual = finiteNumber(input.actual)
  const target = finiteNumber(input.target)
  const numerator = finiteNumber(input.numerator)
  const denominator = finiteNumber(input.denominator)
  if (metricId === 'customer_rating') {
    if (actual === null || actual < 1 || actual > 5) return metricUnavailable(metric, normalized, 'Cần điểm rating trung bình hợp lệ từ 1 đến 5.')
    const exactScore = thresholdScore(actual, [
      { minimum: 4.8, score: 10 }, { minimum: 4.7, score: 9 }, { minimum: 4.6, score: 8 },
      { minimum: 4.5, score: 7 }, { minimum: 4.3, score: 5 },
    ])
    if (exactScore === null && manualScore === null) {
      return { ...metricUnavailable(metric, normalized, 'Rating dưới 4,30 cần Manager chấm rubric complaint từ 0 đến 4 điểm.'), status: 'needs_review' }
    }
    return metricAvailable(metric, normalized, exactScore ?? manualScore, { calculation: exactScore === null ? 'complaint_rubric' : 'rating_band' })
  }
  if (metricId === 'coaching_audit') {
    if (actual === null || actual < 0 || actual > 100) return metricUnavailable(metric, normalized, 'Cần kết quả Coaching Audit từ 0 đến 100.')
    return metricAvailable(metric, normalized, actual / 100 * metric.weight, { calculation: 'audit_percentage' })
  }
  if (RATIO_METRICS.has(metricId)) {
    if (numerator === null || denominator === null || numerator < 0 || denominator <= 0 || numerator > denominator) {
      return metricUnavailable(metric, normalized, 'Cần số hoàn tất và tổng số đến hạn hợp lệ.')
    }
    return metricAvailable(metric, normalized, numerator / denominator * metric.weight, { calculation: 'completion_ratio' })
  }
  if (metricId === 'renew_rate') {
    const rate = actual !== null ? actual : (numerator !== null && denominator && denominator > 0 ? numerator / denominator * 100 : null)
    if (rate === null || rate < 0 || rate > 100) return metricUnavailable(metric, normalized, 'Cần Renew Rate hợp lệ từ 0 đến 100%.')
    const exactScore = thresholdScore(rate, [
      { minimum: 80, score: 15 }, { minimum: 70, score: 14 }, { minimum: 60, score: 12 },
      { minimum: 50, score: 10 }, { minimum: 40, score: 7 },
    ])
    if (exactScore === null && manualScore === null) {
      return { ...metricUnavailable(metric, { ...normalized, actual: rate }, 'Renew Rate dưới 40% cần Manager chấm rubric từ 0 đến 5 điểm.'), status: 'needs_review' }
    }
    return metricAvailable(metric, { ...normalized, actual: rate }, exactScore ?? manualScore, { calculation: exactScore === null ? 'renew_rubric' : 'renew_band' })
  }
  if (metricId === 'self_generated_revenue') {
    if (actual === null || target === null || actual < 0 || target <= 0) return metricUnavailable(metric, normalized, 'Cần doanh thu tự tạo thực thu và target đã duyệt.')
    const rate = actual / target * 100
    const score = rate >= 100 ? 4 : rate >= 80 ? 3 : rate >= 50 ? 2 : 0
    return metricAvailable(metric, normalized, score, { calculation: 'business_band', achievementRate: rounded(rate) })
  }
  if (metricId === 'renew_cash_vs_forecast') {
    if (actual === null || target === null || actual < 0 || target <= 0) return metricUnavailable(metric, normalized, 'Cần Renew thực thu và forecast đã duyệt.')
    const rate = actual / target * 100
    const score = rate >= 90 ? 2 : rate >= 70 ? 1 : 0
    return metricAvailable(metric, normalized, score, { calculation: 'business_band', achievementRate: rounded(rate) })
  }
  if (metricId === 'qualified_lead_conversion') {
    if (actual === null || target === null || actual < 0 || target <= 0) return metricUnavailable(metric, normalized, 'Cần tỷ lệ chuyển đổi thực tế và target đã duyệt.')
    const rate = actual / target * 100
    const score = rate >= 100 ? 2 : rate >= 70 ? 1 : 0
    return metricAvailable(metric, normalized, score, { calculation: 'business_band', achievementRate: rounded(rate) })
  }
  if (metricId === 'attendance') {
    if (actual === null || actual < 0 || actual > 100) return metricUnavailable(metric, normalized, 'Cần tỷ lệ tuân thủ lịch hợp lệ từ 0 đến 100%.')
    const score = actual >= 98 ? 3 : actual >= 96 ? 2 : actual >= 94 ? 1 : 0
    return metricAvailable(metric, normalized, score, { calculation: 'attendance_band' })
  }
  return metricUnavailable(metric, normalized)
}

function bonusForScore(score) {
  if (!Number.isFinite(score)) return { classification: 'Chưa đủ dữ liệu', bonusAmount: null }
  const band = BONUS_BANDS.find((item) => score >= item.minimum) || BONUS_BANDS.at(-1)
  return { classification: band.classification, bonusAmount: band.bonusAmount }
}

function boundedText(value, label, maximum, required = false) {
  const result = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum + 1) : ''
  if ((required && !result) || result.length > maximum) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function documentId(value, label) {
  const result = boundedText(value, label, 200, true)
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function periodId(value) {
  const result = boundedText(value, 'Kỳ đánh giá', 7, true)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(result)) throw new HttpsError('invalid-argument', 'Kỳ đánh giá phải có dạng YYYY-MM.')
  return result
}

function dateKey(value, label = 'Ngày đăng') {
  const result = boundedText(value, label, 10, true)
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  const [year, month, day] = result.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function iso(value) {
  if (!value) return ''
  const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value))
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : ''
}

function normalizeUrl(value) {
  const raw = boundedText(value, 'Liên kết bằng chứng', 1_000)
  if (!raw) return ''
  let parsed
  try { parsed = new URL(raw) } catch { throw new HttpsError('invalid-argument', 'Liên kết bằng chứng phải là URL http hoặc https hợp lệ.') }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new HttpsError('invalid-argument', 'Liên kết bằng chứng phải là URL http hoặc https hợp lệ.')
  parsed.hash = ''
  ;[...parsed.searchParams.keys()].forEach((key) => {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) parsed.searchParams.delete(key)
  })
  parsed.hostname = parsed.hostname.toLowerCase()
  return parsed.toString().replace(/\/$/, '')
}

function normalizeContentHash(value) {
  const result = boundedText(value, 'Mã nội dung', 64).toLowerCase()
  if (result && !/^[a-f0-9]{64}$/.test(result)) throw new HttpsError('invalid-argument', 'Mã nội dung bằng chứng không hợp lệ.')
  return result
}

function proofKey({ type, url, contentHash, briefId, screenshotPath }) {
  const identity = type === 'aura_assignment' && briefId
    ? `brief:${briefId.toLowerCase()}|${contentHash ? `content:${contentHash}` : url ? `url:${url.toLowerCase()}` : 'task'}`
    : contentHash ? `content:${contentHash}` : url ? `url:${url.toLowerCase()}` : `file:${screenshotPath}`
  return createHash('sha256').update(`${type}|${identity}`).digest('hex')
}

function personalBrandScore(count) {
  if (count >= 4) return 5
  if (count === 3) return 4
  if (count === 2) return 2.5
  if (count === 1) return 1
  return 0
}

function calculateBrandPerformance(evidence = []) {
  const approved = evidence.filter((item) => item?.status === 'approved')
  const personalKeys = new Set()
  const auraKeys = new Set()
  let profileCompleted = 0
  let latestProfile = null
  approved.forEach((item) => {
    if (item.type === 'personal_content') personalKeys.add(item.duplicateKey || item.id)
    if (item.type === 'aura_assignment') auraKeys.add(item.duplicateKey || (item.briefId ? `brief:${item.briefId}` : item.id))
    if (item.type === 'profile_checklist') {
      const reviewedAt = iso(item.reviewedAt || item.updatedAt)
      if (!latestProfile || reviewedAt >= latestProfile.reviewedAt) {
        latestProfile = { reviewedAt, checklist: item.checklist && typeof item.checklist === 'object' ? item.checklist : {} }
      }
    }
  })
  if (latestProfile) profileCompleted = PROFILE_CHECKLIST_KEYS.filter((key) => latestProfile.checklist[key] === true).length
  const personalCount = personalKeys.size
  const auraCount = Math.min(3, auraKeys.size)
  const personalScore = personalBrandScore(personalCount)
  const auraScore = auraCount
  const profileScore = Math.min(2, Math.round(profileCompleted * 0.2 * 10) / 10)
  const total = Math.min(10, Math.round((personalScore + auraScore + profileScore) * 10) / 10)
  return {
    total,
    maximum: 10,
    personal: { approvedCount: personalCount, target: 4, score: personalScore, maximum: 5 },
    aura: { approvedCount: auraCount, target: 3, score: auraScore, maximum: 3 },
    profile: { completedCount: profileCompleted, target: 10, score: profileScore, maximum: 2, checklist: latestProfile?.checklist || {} },
  }
}

function serializeEvidence(snapshot, signedUrl = '') {
  const data = typeof snapshot?.data === 'function' ? snapshot.data() || {} : snapshot || {}
  return {
    id: snapshot?.id || data.id || '',
    staffId: data.staffId || '',
    ownerUid: data.ownerUid || '',
    staffName: data.staffName || 'Nhân sự Aura',
    branchIds: Array.isArray(data.branchIds) ? data.branchIds : [],
    periodId: data.periodId || '',
    type: data.type || '',
    platform: data.platform || '',
    url: data.url || '',
    screenshotPath: data.screenshotPath || '',
    signedUrl,
    postedAt: data.postedAt || '',
    groupName: data.groupName || '',
    briefId: data.briefId || '',
    title: data.title || '',
    note: data.note || '',
    status: EVIDENCE_STATUSES.has(data.status) ? data.status : 'submitted',
    reviewerId: data.reviewerId || '',
    reviewedAt: iso(data.reviewedAt),
    reviewReason: data.reviewReason || '',
    violationCodes: Array.isArray(data.violationCodes) ? data.violationCodes : [],
    checklist: data.checklist && typeof data.checklist === 'object' ? data.checklist : {},
    submittedAt: iso(data.submittedAt || data.createdAt),
    updatedAt: iso(data.updatedAt),
  }
}

function gateResult(id, status, source, reason, evidenceRefs = []) {
  return {
    id,
    label: {
      quality: 'Quality Gate', attendance: 'Attendance Gate',
      client_safety: 'Client Safety Gate', integrity: 'Integrity Gate',
    }[id],
    status: ['pass', 'fail'].includes(status) ? status : 'unknown',
    source: source || '',
    reason: reason || '',
    evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs.slice(0, 20) : [],
  }
}

function calculatePerformanceSummary({ evidence = [], metricInputs = {}, gateInputs = {}, locked = false } = {}) {
  const brand = calculateBrandPerformance(evidence)
  const pendingCount = evidence.filter((item) => ['submitted', 'needs_revision'].includes(item.status)).length
  const brandMetrics = {
    personal_brand: metricAvailable(PERFORMANCE_METRIC_INDEX.get('personal_brand'), {
      source: 'approved_evidence', sampleSize: brand.personal.approvedCount,
      note: 'Chỉ tính nội dung đã được duyệt trong kỳ.',
    }, brand.personal.score, { calculation: 'brand_evidence' }),
    aura_brand: metricAvailable(PERFORMANCE_METRIC_INDEX.get('aura_brand'), {
      source: 'approved_evidence', sampleSize: brand.aura.approvedCount,
      note: 'Chỉ tính nhiệm vụ đúng brief đã được duyệt trong kỳ.',
    }, brand.aura.score, { calculation: 'aura_brief_evidence' }),
    profile_quality: metricAvailable(PERFORMANCE_METRIC_INDEX.get('profile_quality'), {
      source: 'approved_checklist', sampleSize: brand.profile.completedCount,
      note: 'Checklist 10 mục, mỗi mục đạt 0,2 điểm.',
    }, brand.profile.score, { calculation: 'profile_checklist' }),
  }
  const categories = PERFORMANCE_CATEGORIES.map((category) => {
    const submetrics = category.submetrics.map((definition) => (
      brandMetrics[definition.id] || calculateMetricScore(definition.id, metricInputs[definition.id] || {})
    ))
    const available = submetrics.filter((metric) => metric.status === 'available')
    const availableWeight = available.reduce((sum, metric) => sum + metric.weight, 0)
    const score = rounded(available.reduce((sum, metric) => sum + metric.score, 0))
    return {
      id: category.id,
      label: category.label,
      weight: category.weight,
      score: available.length ? score : null,
      availableWeight,
      status: availableWeight === category.weight ? 'available' : availableWeight > 0 ? 'partial' : 'not_available',
      submetrics,
    }
  })
  const availableWeight = categories.reduce((sum, category) => sum + category.availableWeight, 0)
  const rawScore = rounded(categories.reduce((sum, category) => sum + (category.score || 0), 0))
  const scoreValue = availableWeight === 100 ? rawScore : null
  const qualityCategory = categories.find((category) => category.id === 'coaching_quality')
  const attendanceMetric = categories.flatMap((category) => category.submetrics).find((metric) => metric.id === 'attendance')
  const qualityGate = qualityCategory?.availableWeight === 25
    ? gateResult('quality', qualityCategory.score >= 20 ? 'pass' : 'fail', 'score_engine', `Coaching Quality ${qualityCategory.score}/25; yêu cầu tối thiểu 20/25.`)
    : gateResult('quality', 'unknown', 'score_engine', 'Chưa đủ toàn bộ dữ liệu Coaching Quality để đánh giá Gate.')
  const manualGate = (id) => {
    const input = gateInputs[id] && typeof gateInputs[id] === 'object' ? gateInputs[id] : {}
    return gateResult(id, input.status, input.source || 'manager_review', input.reason || 'Chưa có kết luận Gate.', input.evidenceRefs)
  }
  const reviewedAttendanceGate = manualGate('attendance')
  const attendanceGate = reviewedAttendanceGate.status !== 'unknown'
    ? reviewedAttendanceGate
    : attendanceMetric?.status === 'available' && Number.isFinite(attendanceMetric.actual)
      ? gateResult('attendance', attendanceMetric.actual >= 98 ? 'pass' : 'fail', attendanceMetric.source, `Tuân thủ lịch ${rounded(attendanceMetric.actual)}%; yêu cầu tối thiểu 98%.`, attendanceMetric.evidenceRefs)
      : gateResult('attendance', 'unknown', 'score_engine', 'Chưa có tỷ lệ tuân thủ lịch đã xác minh.')
  const gates = [qualityGate, attendanceGate, manualGate('client_safety'), manualGate('integrity')]
  const allGatesPass = gates.every((gate) => gate.status === 'pass')
  const anyGateFail = gates.some((gate) => gate.status === 'fail')
  const band = bonusForScore(scoreValue)
  const bonus = {
    eligibility: anyGateFail ? 'ineligible' : allGatesPass && scoreValue !== null ? 'eligible' : 'pending',
    recommendedAmount: anyGateFail ? 0 : allGatesPass ? band.bonusAmount : null,
    classification: band.classification,
    reason: anyGateFail
      ? `Không đủ điều kiện thưởng vì Gate không đạt: ${gates.filter((gate) => gate.status === 'fail').map((gate) => gate.label).join(', ')}.`
      : allGatesPass && scoreValue !== null ? 'Đã đủ điểm và vượt cả bốn Gate.' : 'Chưa đủ dữ liệu hoặc chưa kết luận đủ bốn Gate.',
  }
  return {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    formulaVersion: PERFORMANCE_POLICY_VERSION,
    amountImpact: 'none',
    locked,
    coverage: {
      availableWeight,
      totalWeight: 100,
      confidence: availableWeight === 100 ? 'high' : availableWeight >= 70 ? 'medium' : 'low',
      missingMetricIds: categories.flatMap((category) => category.submetrics).filter((metric) => metric.status !== 'available').map((metric) => metric.id),
    },
    score: {
      value: scoreValue,
      provisionalValue: rawScore,
      maximum: 100,
      reason: scoreValue === null
        ? `Đã xác minh ${availableWeight}/100 trọng số. Dữ liệu thiếu được ghi N/A, không tự quy đổi thành 0.`
        : 'Điểm tổng được tính từ đủ 100/100 trọng số đã xác minh.',
    },
    categories,
    gates,
    bonus,
    brand,
    evidence: {
      total: evidence.filter((item) => item.type !== 'profile_checklist' && item.status !== 'withdrawn').length,
      pending: pendingCount,
      approved: evidence.filter((item) => item.status === 'approved' && item.type !== 'profile_checklist').length,
    },
  }
}

function performanceSummary(evidence, locked = false) {
  return calculatePerformanceSummary({ evidence, locked })
}

function canReview(actor) {
  return ['admin', 'super_admin'].includes(actor.accessRole) || actor.positions.includes('branch_manager') || actor.capabilities.includes('performance.evidence.review')
}

function assertTrainerTarget(target) {
  if (!target.positions.includes('trainer_pt')) throw new HttpsError('failed-precondition', 'Aura PT Performance Score chỉ áp dụng cho nhân sự có chức danh PT.')
}

function assertReviewer(actor) {
  if (!canReview(actor)) throw new HttpsError('permission-denied', 'Bạn không có quyền duyệt bằng chứng hiệu suất.')
}

function assertBranchScope(actor, branchIds) {
  if (['admin', 'super_admin'].includes(actor.accessRole)) return
  const target = Array.isArray(branchIds) ? branchIds.filter(Boolean) : []
  if (!target.length || !target.some((branchId) => actor.branchIds.includes(branchId))) {
    throw new HttpsError('permission-denied', 'Bạn chỉ được duyệt bằng chứng của nhân sự cùng chi nhánh.')
  }
}

async function signedEvidenceUrl(storage, path) {
  if (!storage || !path) return ''
  try {
    const [url] = await storage.bucket().file(path).getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1_000 })
    return url
  } catch { return '' }
}

async function assertScreenshot(storage, { path, ownerUid, period, evidenceId }) {
  if (!path) return
  const prefix = `performance-evidence/${ownerUid}/${period}/${evidenceId}/`
  if (!path.startsWith(prefix) || path.length > 600) throw new HttpsError('invalid-argument', 'Đường dẫn ảnh bằng chứng không thuộc đúng nhân sự, kỳ và hồ sơ.')
  if (!storage) throw new HttpsError('failed-precondition', 'Kho ảnh bằng chứng chưa sẵn sàng.')
  try {
    const [metadata] = await storage.bucket().file(path).getMetadata()
    const custom = metadata.metadata || {}
    if (custom.ownerUid !== ownerUid || custom.periodId !== period || custom.evidenceId !== evidenceId || custom.resourceKind !== 'performance-evidence') {
      throw new Error('metadata-mismatch')
    }
    if (!/^image\/(jpeg|png|webp)$/.test(metadata.contentType || '') || Number(metadata.size || 0) > 10 * 1024 * 1024) {
      throw new Error('unsupported-file')
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('failed-precondition', 'Ảnh bằng chứng chưa tải xong hoặc metadata không hợp lệ.')
  }
}

async function evidenceForStaff(db, staffId, period) {
  const snapshot = await db.collection('performanceEvidence')
    .where('staffId', '==', staffId)
    .where('periodId', '==', period)
    .limit(301)
    .get()
  if (snapshot.size > 300) throw new HttpsError('resource-exhausted', 'Kỳ đánh giá có quá nhiều bằng chứng để tổng hợp an toàn.')
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

async function isSnapshotLocked(db, staffId, period) {
  const snapshot = await db.doc(`performanceSnapshots/${period}_${staffId}`).get()
  return snapshot.exists && snapshot.data().locked === true
}

async function rebuildBrandSnapshot(db, staffId, period, actorUid = 'system:performance-score') {
  const target = await targetStaff(db, staffId)
  assertTrainerTarget(target)
  return rebuildPerformanceSnapshot(db, target, period, actorUid)
}

async function targetStaff(db, staffId) {
  const direct = await db.doc(`roleAssignments/${staffId}`).get()
  let assignmentSnapshot = direct.exists ? direct : null
  if (!assignmentSnapshot) {
    const lookup = await db.collection('roleAssignments').where('crmProfileId', '==', staffId).limit(2).get()
    if (lookup.size > 1) throw new HttpsError('failed-precondition', 'Hồ sơ nhân sự đang liên kết nhiều tài khoản, cần đối soát danh tính.')
    assignmentSnapshot = lookup.docs[0] || null
  }
  if (!assignmentSnapshot || assignmentSnapshot.data().accessRole !== 'staff' || assignmentSnapshot.data().status !== 'active') {
    throw new HttpsError('not-found', 'Không tìm thấy nhân sự đang hoạt động.')
  }
  const assignment = assignmentSnapshot.data()
  const operationalId = assignment.crmProfileId || assignmentSnapshot.id
  const [user, trainer] = await Promise.all([
    db.doc(`users/${assignmentSnapshot.id}`).get(),
    db.doc(`trainers/${operationalId}`).get(),
  ])
  return {
    staffId: operationalId,
    ownerUid: assignmentSnapshot.id,
    name: user.data()?.displayName || user.data()?.name || trainer.data()?.name || 'Nhân sự Aura',
    branchIds: Array.isArray(assignment.branchIds) && assignment.branchIds.length
      ? assignment.branchIds
      : [trainer.data()?.branchId || user.data()?.branchId].filter(Boolean),
    positions: Array.isArray(assignment.positions) ? assignment.positions : [],
  }
}

async function staffDirectory(db, actor) {
  const snapshot = await db.collection('roleAssignments').where('accessRole', '==', 'staff').limit(300).get()
  const candidates = snapshot.docs.filter((item) => {
    const data = item.data()
    if (data.status !== 'active' || !Array.isArray(data.positions) || !data.positions.includes('trainer_pt')) return false
    if (['admin', 'super_admin'].includes(actor.accessRole)) return true
    return Array.isArray(data.branchIds) && data.branchIds.some((branchId) => actor.branchIds.includes(branchId))
  })
  const userSnapshots = candidates.length ? await db.getAll(...candidates.map((item) => db.doc(`users/${item.id}`))) : []
  const userById = new Map(userSnapshots.map((item) => [item.id, item.data() || {}]))
  return candidates.map((item) => {
    const assignment = item.data()
    const user = userById.get(item.id) || {}
    return {
      staffId: assignment.crmProfileId || item.id,
      ownerUid: item.id,
      name: user.displayName || user.name || 'Nhân sự Aura',
      branchIds: Array.isArray(assignment.branchIds) ? assignment.branchIds : [],
    }
  }).sort((left, right) => left.name.localeCompare(right.name, 'vi'))
}

function shiftPeriod(period, offset) {
  const [year, month] = period.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

async function loadPerformanceAssessment(db, staffId, period) {
  const snapshot = await db.doc(`performanceAssessments/${period}_${staffId}`).get()
  const data = snapshot.exists ? snapshot.data() || {} : {}
  return {
    revision: Math.max(0, Math.trunc(Number(data.revision || 0))),
    metrics: data.metrics && typeof data.metrics === 'object' ? data.metrics : {},
    gates: data.gates && typeof data.gates === 'object' ? data.gates : {},
    updatedAt: iso(data.updatedAt),
    updatedBy: data.updatedBy || '',
  }
}

async function automaticPerformanceMetrics(db, target, period) {
  const trainerIds = [...new Set([target.staffId, target.ownerUid].filter(Boolean))]
  const from = `${shiftPeriod(period, -2)}-01`
  const to = `${period}-31`
  const snapshots = await Promise.all(trainerIds.map((trainerId) => db.collection('sessionFeedback')
    .where('trainerId', '==', trainerId)
    .where('sessionDate', '>=', from)
    .where('sessionDate', '<=', to)
    .limit(501)
    .get()))
  if (snapshots.some((snapshot) => snapshot.size > 500)) {
    throw new HttpsError('resource-exhausted', 'Dữ liệu rating ba tháng vượt giới hạn tổng hợp an toàn.')
  }
  const rows = new Map()
  snapshots.forEach((snapshot) => snapshot.docs.forEach((item) => {
    const value = item.data() || {}
    const rating = Number(value.overallScore)
    const date = typeof value.sessionDate === 'string' ? value.sessionDate.slice(0, 10) : ''
    if (rating >= 1 && rating <= 5 && date >= from && date <= to && value.invalidated !== true) {
      rows.set(item.id, { id: item.id, rating, date })
    }
  }))
  const current = [...rows.values()].filter((item) => item.date.startsWith(`${period}-`))
  const selected = current.length >= 5 ? current : [...rows.values()]
  const metrics = {}
  if (selected.length) {
    metrics.customer_rating = {
      source: current.length >= 5 ? 'system_auto' : 'rolling_average',
      actual: rounded(selected.reduce((sum, item) => sum + item.rating, 0) / selected.length, 2),
      sampleSize: selected.length,
      evidenceRefs: selected.slice(0, 20).map((item) => `sessionFeedback/${item.id}`),
      note: current.length >= 5
        ? `${current.length} phản hồi hợp lệ trong tháng.`
        : `Tháng có ${current.length}/5 phản hồi; dùng rolling 3 tháng (${selected.length} phản hồi).`,
    }
  }
  return metrics
}

async function performanceComputation(db, target, period, locked = false) {
  const [evidence, assessment, automatic] = await Promise.all([
    evidenceForStaff(db, target.staffId, period),
    loadPerformanceAssessment(db, target.staffId, period),
    automaticPerformanceMetrics(db, target, period),
  ])
  const summary = calculatePerformanceSummary({
    evidence,
    metricInputs: { ...automatic, ...assessment.metrics },
    gateInputs: assessment.gates,
    locked,
  })
  return { summary, assessment, automatic }
}

async function rebuildPerformanceSnapshot(db, target, period, actorUid = 'system:performance-score') {
  const reference = db.doc(`performanceSnapshots/${period}_${target.staffId}`)
  const existing = await reference.get()
  if (existing.exists && existing.data().locked === true) return existing.data()
  const result = await performanceComputation(db, target, period, false)
  const value = {
    ...result.summary,
    staffId: target.staffId,
    ownerUid: target.ownerUid,
    staffName: target.name,
    branchIds: target.branchIds,
    periodId: period,
    assessmentRevision: result.assessment.revision,
    generatedAt: FieldValue.serverTimestamp(),
    generatedBy: actorUid,
  }
  await reference.set(value, { merge: true })
  return value
}

function sanitizeMetricAssessment(input, metricId) {
  const metric = PERFORMANCE_METRIC_INDEX.get(metricId)
  if (!metric || BRAND_METRIC_IDS.has(metricId)) throw new HttpsError('invalid-argument', 'Chỉ số Performance không thể chấm tay.')
  const source = boundedText(input?.source, 'Nguồn đánh giá', 40, true)
  if (!PERFORMANCE_REVIEW_SOURCES.has(source) || source === 'system_auto') throw new HttpsError('invalid-argument', 'Nguồn đánh giá không hợp lệ.')
  const optionalNumber = (value, label, minimum, maximum) => {
    if (value === '' || value === null || value === undefined) return null
    const result = Number(value)
    if (!Number.isFinite(result) || result < minimum || result > maximum) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
    return result
  }
  const value = {
    source,
    actual: optionalNumber(input.actual, 'Giá trị thực tế', 0, 10_000_000_000),
    target: optionalNumber(input.target, 'Mục tiêu', 0, 10_000_000_000),
    numerator: optionalNumber(input.numerator, 'Số hoàn tất', 0, 1_000_000),
    denominator: optionalNumber(input.denominator, 'Tổng số đến hạn', 0, 1_000_000),
    manualScore: optionalNumber(input.manualScore ?? input.score, 'Điểm duyệt', 0, metric.weight),
    sampleSize: optionalNumber(input.sampleSize, 'Cỡ mẫu', 0, 1_000_000) || 0,
    note: boundedText(input.note, 'Lý do và ghi chú', 500, true),
    evidenceRefs: Array.isArray(input.evidenceRefs)
      ? [...new Set(input.evidenceRefs.map((item) => boundedText(item, 'Bằng chứng', 300)).filter(Boolean))].slice(0, 20)
      : [],
  }
  if (value.note.length < 3) throw new HttpsError('invalid-argument', 'Cần ghi rõ nguồn, lý do hoặc ghi chú chấm điểm.')
  const calculated = calculateMetricScore(metricId, value)
  if (calculated.status !== 'available') throw new HttpsError('invalid-argument', calculated.reason || 'Dữ liệu chỉ số chưa đủ để tính điểm.')
  return { ...value, computedScore: calculated.score, calculation: calculated.calculation || '' }
}

function sanitizeGateAssessment(input, gateId) {
  if (!['attendance', 'client_safety', 'integrity'].includes(gateId)) throw new HttpsError('invalid-argument', 'Gate này được tính tự động từ Score.')
  const status = boundedText(input?.status, 'Kết luận Gate', 20, true)
  if (!['pass', 'fail', 'unknown'].includes(status)) throw new HttpsError('invalid-argument', 'Kết luận Gate không hợp lệ.')
  const reason = boundedText(input?.reason, 'Lý do kết luận Gate', 500, true)
  if (reason.length < 3) throw new HttpsError('invalid-argument', 'Cần ghi rõ lý do kết luận Gate.')
  return {
    status,
    source: 'manager_review',
    reason,
    evidenceRefs: Array.isArray(input?.evidenceRefs)
      ? [...new Set(input.evidenceRefs.map((item) => boundedText(item, 'Bằng chứng Gate', 300)).filter(Boolean))].slice(0, 20)
      : [],
  }
}

function createPerformanceScoreFunctions({ db, onCall, storage, logger = console }) {
  const performanceCall = (handler) => onCall({
    cpu: 'gcf_gen1', memory: '256MiB', maxInstances: 1, concurrency: 1, timeoutSeconds: 120,
  }, handler)

  const getMyPerformanceScore = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    if (actor.accessRole !== 'staff') throw new HttpsError('permission-denied', 'Aura Performance Score hiện dành cho tài khoản nhân sự.')
    requireCapability(actor, 'performance.self.view')
    const period = periodId(request.data?.periodId)
    const staffId = documentId(actor.legacyStaffId || actor.uid, 'Mã nhân sự')
    const target = await targetStaff(db, staffId)
    assertTrainerTarget(target)
    const snapshot = await db.doc(`performanceSnapshots/${period}_${staffId}`).get()
    if (snapshot.exists && snapshot.data().locked === true) {
      const value = snapshot.data()
      return { ...value, staffId, periodId: period, generatedAt: iso(value.generatedAt), locked: true }
    }
    const result = await performanceComputation(db, target, period, false)
    return {
      staffId,
      periodId: period,
      staffName: target.name,
      assessmentRevision: result.assessment.revision,
      generatedAt: new Date().toISOString(),
      ...result.summary,
    }
  })

  const listMyPerformanceEvidence = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    if (actor.accessRole !== 'staff') throw new HttpsError('permission-denied', 'Aura Performance Score hiện dành cho tài khoản nhân sự.')
    requireCapability(actor, 'performance.self.view')
    const period = periodId(request.data?.periodId)
    const staffId = documentId(actor.legacyStaffId || actor.uid, 'Mã nhân sự')
    assertTrainerTarget(await targetStaff(db, staffId))
    const evidence = await evidenceForStaff(db, staffId, period)
    const rows = await Promise.all(evidence.sort((left, right) => iso(right.submittedAt).localeCompare(iso(left.submittedAt))).map(async (item) => (
      serializeEvidence(item, await signedEvidenceUrl(storage, item.screenshotPath))
    )))
    return { periodId: period, rows }
  })

  const submitPerformanceBrandEvidence = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    if (actor.accessRole !== 'staff') throw new HttpsError('permission-denied', 'Chỉ nhân sự Aura được gửi bằng chứng của chính mình.')
    requireCapability(actor, 'performance.evidence.submit')
    const period = periodId(request.data?.periodId)
    const evidenceId = documentId(request.data?.evidenceId, 'Mã bằng chứng')
    const type = boundedText(request.data?.type, 'Loại bằng chứng', 40, true)
    if (!EVIDENCE_TYPES.has(type)) throw new HttpsError('invalid-argument', 'Loại bằng chứng Brand không hợp lệ.')
    const platform = boundedText(request.data?.platform, 'Nền tảng', 30)
    if (platform && !PLATFORMS.has(platform)) throw new HttpsError('invalid-argument', 'Nền tảng đăng bài không hợp lệ.')
    const url = normalizeUrl(request.data?.url)
    const screenshotPath = boundedText(request.data?.screenshotPath, 'Ảnh bằng chứng', 600)
    const contentHash = normalizeContentHash(request.data?.contentHash)
    if (!url && !screenshotPath) throw new HttpsError('invalid-argument', 'Cần gửi link bài đăng hoặc ảnh chụp màn hình làm bằng chứng.')
    if (screenshotPath && !contentHash) throw new HttpsError('invalid-argument', 'Ảnh bằng chứng cần mã kiểm tra nội dung để chống ghi nhận trùng.')
    const postedAt = dateKey(request.data?.postedAt)
    if (!postedAt.startsWith(`${period}-`)) throw new HttpsError('invalid-argument', 'Ngày đăng hoặc ngày hoàn thành nhiệm vụ phải thuộc kỳ đang đánh giá.')
    const groupName = boundedText(request.data?.groupName, 'Trang cá nhân hoặc hội nhóm', 160)
    const briefId = boundedText(request.data?.briefId, 'Mã brief', 120)
    if (type === 'aura_assignment' && !briefId) throw new HttpsError('invalid-argument', 'Nhiệm vụ Aura Brand cần mã brief, campaign, event hoặc workshop.')
    const title = boundedText(request.data?.title, 'Nội dung bằng chứng', 200, true)
    const note = boundedText(request.data?.note, 'Ghi chú', 500)
    const staffId = documentId(actor.legacyStaffId || actor.uid, 'Mã nhân sự')
    assertTrainerTarget(await targetStaff(db, staffId))
    if (await isSnapshotLocked(db, staffId, period)) throw new HttpsError('failed-precondition', 'Kỳ đánh giá đã khóa, không thể bổ sung bằng chứng hồi tố.')
    await assertScreenshot(storage, { path: screenshotPath, ownerUid: actor.uid, period, evidenceId })
    const duplicateKey = proofKey({ type, url, contentHash, briefId, screenshotPath })
    const evidenceReference = db.doc(`performanceEvidence/${evidenceId}`)
    const dedupeReference = db.doc(`performanceEvidenceDedupe/${staffId}_${period.replace('-', '')}_${duplicateKey.slice(0, 32)}`)
    try {
      await db.runTransaction(async (transaction) => {
        const [existing, duplicate] = await Promise.all([transaction.get(evidenceReference), transaction.get(dedupeReference)])
        if (existing.exists) {
          const data = existing.data()
          if (data.ownerUid === actor.uid && data.duplicateKey === duplicateKey) return
          throw new HttpsError('already-exists', 'Mã bằng chứng đã được sử dụng.')
        }
        if (duplicate.exists) throw new HttpsError('already-exists', 'Nội dung này đã được gửi trong kỳ. Một nội dung đăng lại nhiều nơi chỉ được tính một asset.')
        const data = {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION,
        formulaVersion: PERFORMANCE_POLICY_VERSION,
        staffId,
        ownerUid: actor.uid,
        staffName: actor.actorName,
        branchIds: actor.branchIds,
        periodId: period,
        type,
        platform,
        url,
        screenshotPath,
        contentHash,
        duplicateKey,
        postedAt,
        groupName,
        briefId,
        title,
        note,
        status: 'submitted',
        amountImpact: 'none',
        submittedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        }
        transaction.create(evidenceReference, data)
        transaction.create(dedupeReference, { staffId, periodId: period, evidenceId, duplicateKey, createdAt: FieldValue.serverTimestamp() })
        transaction.create(db.collection('performanceAuditLogs').doc(), {
          schemaVersion: PERFORMANCE_SCHEMA_VERSION,
          action: 'performance.evidence.submitted', actorUid: actor.uid, staffId, periodId: period, evidenceId,
          createdAt: FieldValue.serverTimestamp(),
        })
      })
    } catch (error) {
      // The screenshot is uploaded before the callable so Storage Rules can
      // verify ownership. Remove only the just-uploaded orphan when the
      // Firestore evidence transaction is rejected.
      if (screenshotPath && storage) await storage.bucket().file(screenshotPath).delete({ ignoreNotFound: true }).catch(() => undefined)
      throw error
    }
    await rebuildBrandSnapshot(db, staffId, period, actor.uid)
    logger.info?.('performance_evidence_submitted', { evidenceId, staffId, periodId: period, type })
    return { evidenceId, status: 'submitted' }
  })

  const withdrawPerformanceBrandEvidence = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    if (actor.accessRole !== 'staff') throw new HttpsError('permission-denied', 'Chỉ nhân sự Aura được rút bằng chứng của chính mình.')
    requireCapability(actor, 'performance.evidence.submit')
    const evidenceId = documentId(request.data?.evidenceId, 'Mã bằng chứng')
    const reference = db.doc(`performanceEvidence/${evidenceId}`)
    let changed = false
    let staffId = ''
    let period = ''
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy bằng chứng.')
      const data = snapshot.data()
      staffId = data.staffId
      period = data.periodId
      if (data.ownerUid !== actor.uid) throw new HttpsError('permission-denied', 'Bạn chỉ được rút bằng chứng của chính mình.')
      if (data.status === 'withdrawn') return
      if (!['submitted', 'needs_revision'].includes(data.status)) throw new HttpsError('failed-precondition', 'Bằng chứng đã duyệt hoặc từ chối không thể rút.')
      const lock = await transaction.get(db.doc(`performanceSnapshots/${period}_${staffId}`))
      if (lock.exists && lock.data().locked === true) throw new HttpsError('failed-precondition', 'Kỳ đánh giá đã khóa.')
      transaction.update(reference, { status: 'withdrawn', withdrawnAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(db.collection('performanceAuditLogs').doc(), {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION, action: 'performance.evidence.withdrawn', actorUid: actor.uid,
        staffId, periodId: period, evidenceId, createdAt: FieldValue.serverTimestamp(),
      })
      changed = true
    })
    if (changed) await rebuildBrandSnapshot(db, staffId, period, actor.uid)
    return { evidenceId, status: 'withdrawn', unchanged: !changed }
  })

  const listPerformanceReviewQueue = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    assertReviewer(actor)
    const period = periodId(request.data?.periodId)
    const requestedBranch = boundedText(request.data?.branchId, 'Chi nhánh', 200)
    if (requestedBranch && !['admin', 'super_admin'].includes(actor.accessRole) && !actor.branchIds.includes(requestedBranch)) {
      throw new HttpsError('permission-denied', 'Bạn không có quyền xem chi nhánh này.')
    }
    const status = boundedText(request.data?.status, 'Trạng thái', 30)
    if (status && !EVIDENCE_STATUSES.has(status)) throw new HttpsError('invalid-argument', 'Trạng thái bằng chứng không hợp lệ.')
    const type = boundedText(request.data?.type, 'Loại bằng chứng', 40)
    if (type && !new Set([...EVIDENCE_TYPES, 'profile_checklist']).has(type)) throw new HttpsError('invalid-argument', 'Loại bằng chứng không hợp lệ.')
    const snapshot = await db.collection('performanceEvidence').where('periodId', '==', period).limit(201).get()
    if (snapshot.size > 200) throw new HttpsError('resource-exhausted', 'Hàng chờ kỳ này vượt 200 hồ sơ; hãy lọc theo chi nhánh hoặc trạng thái.')
    const filtered = snapshot.docs.filter((item) => {
      const data = item.data()
      const branches = Array.isArray(data.branchIds) ? data.branchIds : []
      if (!['admin', 'super_admin'].includes(actor.accessRole) && !branches.some((branchId) => actor.branchIds.includes(branchId))) return false
      if (requestedBranch && !branches.includes(requestedBranch)) return false
      if (status && data.status !== status) return false
      if (type && data.type !== type) return false
      return data.status !== 'withdrawn'
    })
    const profileDocuments = snapshot.docs.filter((item) => {
      const data = item.data()
      const branches = Array.isArray(data.branchIds) ? data.branchIds : []
      if (data.type !== 'profile_checklist' || data.status !== 'approved') return false
      if (!['admin', 'super_admin'].includes(actor.accessRole) && !branches.some((branchId) => actor.branchIds.includes(branchId))) return false
      if (requestedBranch && !branches.includes(requestedBranch)) return false
      return true
    })
    const rows = await Promise.all(filtered.sort((left, right) => iso(right.data().submittedAt).localeCompare(iso(left.data().submittedAt))).map(async (item) => (
      serializeEvidence(item, await signedEvidenceUrl(storage, item.data().screenshotPath))
    )))
    const directory = await staffDirectory(db, actor)
    return {
      periodId: period,
      rows,
      profiles: profileDocuments.map((item) => serializeEvidence(item)),
      staff: directory,
      truncated: false,
    }
  })

  const reviewPerformanceBrandEvidence = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    assertReviewer(actor)
    const evidenceId = documentId(request.data?.evidenceId, 'Mã bằng chứng')
    const decision = boundedText(request.data?.decision, 'Quyết định', 30, true)
    if (!REVIEW_STATUSES.has(decision)) throw new HttpsError('invalid-argument', 'Quyết định duyệt không hợp lệ.')
    const reason = boundedText(request.data?.reason, 'Lý do duyệt', 500, decision !== 'approved')
    if (decision !== 'approved' && reason.length < 3) throw new HttpsError('invalid-argument', 'Cần ghi rõ lý do yêu cầu bổ sung hoặc từ chối.')
    const violationCodes = Array.isArray(request.data?.violationCodes)
      ? [...new Set(request.data.violationCodes.map((item) => boundedText(item, 'Mã vi phạm', 60)).filter(Boolean))].slice(0, 10)
      : []
    const reference = db.doc(`performanceEvidence/${evidenceId}`)
    let staffId = ''
    let period = ''
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy bằng chứng.')
      const data = snapshot.data()
      staffId = data.staffId
      period = data.periodId
      assertBranchScope(actor, data.branchIds)
      if (data.type === 'profile_checklist') throw new HttpsError('failed-precondition', 'Checklist hồ sơ được cập nhật bằng biểu mẫu Profile Quality.')
      if (!['submitted', 'needs_revision', 'approved', 'rejected'].includes(data.status)) throw new HttpsError('failed-precondition', 'Bằng chứng không còn ở trạng thái có thể duyệt.')
      const lock = await transaction.get(db.doc(`performanceSnapshots/${period}_${staffId}`))
      if (lock.exists && lock.data().locked === true) throw new HttpsError('failed-precondition', 'Kỳ đánh giá đã khóa.')
      transaction.update(reference, {
        status: decision, reviewReason: reason, violationCodes, reviewerId: actor.uid,
        reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('performanceAuditLogs').doc(), {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION, action: `performance.evidence.${decision}`,
        actorUid: actor.uid, staffId, periodId: period, evidenceId, beforeStatus: data.status,
        reason, violationCodes, createdAt: FieldValue.serverTimestamp(),
      })
    })
    await rebuildBrandSnapshot(db, staffId, period, actor.uid)
    return { evidenceId, status: decision }
  })

  const savePerformanceProfileChecklist = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    assertReviewer(actor)
    const period = periodId(request.data?.periodId)
    const staffId = documentId(request.data?.staffId, 'Mã nhân sự')
    const target = await targetStaff(db, staffId)
    assertTrainerTarget(target)
    assertBranchScope(actor, target.branchIds)
    if (await isSnapshotLocked(db, target.staffId, period)) throw new HttpsError('failed-precondition', 'Kỳ đánh giá đã khóa.')
    const source = request.data?.checklist && typeof request.data.checklist === 'object' ? request.data.checklist : {}
    const checklist = Object.fromEntries(PROFILE_CHECKLIST_KEYS.map((key) => [key, source[key] === true]))
    const reason = boundedText(request.data?.reason, 'Ghi chú Profile Quality', 500)
    const evidenceId = `profile_${period.replace('-', '')}_${target.staffId}`
    const reference = db.doc(`performanceEvidence/${evidenceId}`)
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(reference)
      const revision = Math.max(0, Number(current.data()?.revision || 0)) + 1
      transaction.set(reference, {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION, formulaVersion: PERFORMANCE_POLICY_VERSION,
        staffId: target.staffId, ownerUid: target.ownerUid, staffName: target.name, branchIds: target.branchIds,
        periodId: period, type: 'profile_checklist', status: 'approved', checklist,
        reviewerId: actor.uid, reviewedAt: FieldValue.serverTimestamp(), reviewReason: reason,
        amountImpact: 'none', revision, submittedAt: current.data()?.submittedAt || FieldValue.serverTimestamp(),
        createdAt: current.data()?.createdAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.create(db.collection('performanceAuditLogs').doc(), {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION, action: 'performance.profile_checklist.saved', actorUid: actor.uid,
        staffId: target.staffId, periodId: period, evidenceId, revision, checklist, reason,
        createdAt: FieldValue.serverTimestamp(),
      })
    })
    await rebuildBrandSnapshot(db, target.staffId, period, actor.uid)
    return { evidenceId, completedCount: PROFILE_CHECKLIST_KEYS.filter((key) => checklist[key]).length, status: 'approved' }
  })

  const getPerformanceStaffScore = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'performance.assessment.manage')
    const period = periodId(request.data?.periodId)
    const staffId = documentId(request.data?.staffId, 'Mã nhân sự')
    const target = await targetStaff(db, staffId)
    assertTrainerTarget(target)
    assertBranchScope(actor, target.branchIds)
    const snapshot = await db.doc(`performanceSnapshots/${period}_${target.staffId}`).get()
    if (snapshot.exists && snapshot.data().locked === true) {
      const value = snapshot.data()
      return { ...value, generatedAt: iso(value.generatedAt), locked: true }
    }
    const result = await performanceComputation(db, target, period, false)
    return {
      staffId: target.staffId,
      ownerUid: target.ownerUid,
      staffName: target.name,
      branchIds: target.branchIds,
      periodId: period,
      assessmentRevision: result.assessment.revision,
      assessmentUpdatedAt: result.assessment.updatedAt,
      generatedAt: new Date().toISOString(),
      ...result.summary,
    }
  })

  const savePerformanceMetricAssessment = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'performance.assessment.manage')
    const period = periodId(request.data?.periodId)
    const staffId = documentId(request.data?.staffId, 'Mã nhân sự')
    const metricId = documentId(request.data?.metricId, 'Mã chỉ số')
    const expectedRevision = Number(request.data?.expectedRevision)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản phiếu chấm không hợp lệ.')
    const target = await targetStaff(db, staffId)
    assertTrainerTarget(target)
    assertBranchScope(actor, target.branchIds)
    const assessment = sanitizeMetricAssessment(request.data || {}, metricId)
    const reference = db.doc(`performanceAssessments/${period}_${target.staffId}`)
    const snapshotReference = db.doc(`performanceSnapshots/${period}_${target.staffId}`)
    let revision = 0
    await db.runTransaction(async (transaction) => {
      const [current, scoreSnapshot] = await Promise.all([transaction.get(reference), transaction.get(snapshotReference)])
      if (scoreSnapshot.exists && scoreSnapshot.data().locked === true) throw new HttpsError('failed-precondition', 'Kỳ đánh giá đã khóa.')
      const currentRevision = Math.max(0, Math.trunc(Number(current.data()?.revision || 0)))
      if (currentRevision !== expectedRevision) throw new HttpsError('aborted', 'Phiếu chấm đã được cập nhật. Hãy tải lại trước khi lưu.')
      const before = current.data()?.metrics?.[metricId] || null
      revision = currentRevision + 1
      transaction.set(reference, {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION,
        formulaVersion: PERFORMANCE_POLICY_VERSION,
        staffId: target.staffId,
        ownerUid: target.ownerUid,
        branchIds: target.branchIds,
        periodId: period,
        metrics: { ...(current.data()?.metrics || {}), [metricId]: { ...assessment, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid } },
        revision,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        ...(!current.exists ? { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid } : {}),
      }, { merge: true })
      transaction.create(db.collection('performanceAuditLogs').doc(), {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION,
        formulaVersion: PERFORMANCE_POLICY_VERSION,
        action: 'performance.metric.assessed',
        actorUid: actor.uid,
        staffId: target.staffId,
        periodId: period,
        metricId,
        before,
        after: assessment,
        reason: assessment.note,
        revision,
        createdAt: FieldValue.serverTimestamp(),
      })
    })
    await rebuildPerformanceSnapshot(db, target, period, actor.uid)
    return { staffId: target.staffId, periodId: period, metricId, revision, computedScore: assessment.computedScore }
  })

  const savePerformanceGateAssessment = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'performance.assessment.manage')
    const period = periodId(request.data?.periodId)
    const staffId = documentId(request.data?.staffId, 'Mã nhân sự')
    const gateId = documentId(request.data?.gateId, 'Mã Gate')
    const expectedRevision = Number(request.data?.expectedRevision)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản phiếu chấm không hợp lệ.')
    const target = await targetStaff(db, staffId)
    assertTrainerTarget(target)
    assertBranchScope(actor, target.branchIds)
    const gate = sanitizeGateAssessment(request.data || {}, gateId)
    const reference = db.doc(`performanceAssessments/${period}_${target.staffId}`)
    const snapshotReference = db.doc(`performanceSnapshots/${period}_${target.staffId}`)
    let revision = 0
    await db.runTransaction(async (transaction) => {
      const [current, scoreSnapshot] = await Promise.all([transaction.get(reference), transaction.get(snapshotReference)])
      if (scoreSnapshot.exists && scoreSnapshot.data().locked === true) throw new HttpsError('failed-precondition', 'Kỳ đánh giá đã khóa.')
      const currentRevision = Math.max(0, Math.trunc(Number(current.data()?.revision || 0)))
      if (currentRevision !== expectedRevision) throw new HttpsError('aborted', 'Phiếu chấm đã được cập nhật. Hãy tải lại trước khi lưu.')
      const before = current.data()?.gates?.[gateId] || null
      revision = currentRevision + 1
      transaction.set(reference, {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION,
        formulaVersion: PERFORMANCE_POLICY_VERSION,
        staffId: target.staffId,
        ownerUid: target.ownerUid,
        branchIds: target.branchIds,
        periodId: period,
        gates: { ...(current.data()?.gates || {}), [gateId]: { ...gate, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid } },
        revision,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        ...(!current.exists ? { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid } : {}),
      }, { merge: true })
      transaction.create(db.collection('performanceAuditLogs').doc(), {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION,
        formulaVersion: PERFORMANCE_POLICY_VERSION,
        action: 'performance.gate.assessed',
        actorUid: actor.uid,
        staffId: target.staffId,
        periodId: period,
        gateId,
        before,
        after: gate,
        reason: gate.reason,
        revision,
        createdAt: FieldValue.serverTimestamp(),
      })
    })
    await rebuildPerformanceSnapshot(db, target, period, actor.uid)
    return { staffId: target.staffId, periodId: period, gateId, revision }
  })

  const refreshPerformanceSnapshot = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'performance.assessment.manage')
    const period = periodId(request.data?.periodId)
    const staffId = documentId(request.data?.staffId, 'Mã nhân sự')
    const target = await targetStaff(db, staffId)
    assertTrainerTarget(target)
    assertBranchScope(actor, target.branchIds)
    await rebuildPerformanceSnapshot(db, target, period, actor.uid)
    const snapshot = await db.doc(`performanceSnapshots/${period}_${target.staffId}`).get()
    const value = snapshot.data() || {}
    return { ...value, staffId: target.staffId, periodId: period, generatedAt: iso(value.generatedAt) }
  })

  const setPerformanceSnapshotLock = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'performance.snapshot.lock')
    const period = periodId(request.data?.periodId)
    const staffId = documentId(request.data?.staffId, 'Mã nhân sự')
    const locked = request.data?.locked === true
    const reason = boundedText(request.data?.reason, 'Lý do khóa hoặc mở kỳ', 500, true)
    if (reason.length < 3) throw new HttpsError('invalid-argument', 'Cần ghi rõ lý do khóa hoặc mở kỳ.')
    const target = await targetStaff(db, staffId)
    assertTrainerTarget(target)
    assertBranchScope(actor, target.branchIds)
    const snapshotReference = db.doc(`performanceSnapshots/${period}_${target.staffId}`)
    if (!locked) {
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(snapshotReference)
        if (!current.exists || current.data().locked !== true) throw new HttpsError('failed-precondition', 'Kỳ đánh giá chưa bị khóa.')
        transaction.update(snapshotReference, {
          locked: false, unlockedAt: FieldValue.serverTimestamp(), unlockedBy: actor.uid,
          unlockReason: reason, updatedAt: FieldValue.serverTimestamp(),
        })
        transaction.create(db.collection('performanceAuditLogs').doc(), {
          schemaVersion: PERFORMANCE_SCHEMA_VERSION, formulaVersion: PERFORMANCE_POLICY_VERSION,
          action: 'performance.snapshot.unlocked', actorUid: actor.uid, staffId: target.staffId,
          periodId: period, reason, createdAt: FieldValue.serverTimestamp(),
        })
      })
      await rebuildPerformanceSnapshot(db, target, period, actor.uid)
      const refreshed = await snapshotReference.get()
      const value = refreshed.data() || {}
      return { ...value, generatedAt: iso(value.generatedAt), locked: false }
    }
    const computation = await performanceComputation(db, target, period, false)
    if (computation.summary.coverage.availableWeight !== 100) throw new HttpsError('failed-precondition', 'Chưa thể khóa kỳ khi Score chưa đủ 100/100 trọng số đã xác minh.')
    if (computation.summary.gates.some((gate) => gate.status === 'unknown')) throw new HttpsError('failed-precondition', 'Chưa thể khóa kỳ khi còn Gate chưa có kết luận.')
    await db.runTransaction(async (transaction) => {
      const [assessmentSnapshot, current] = await Promise.all([
        transaction.get(db.doc(`performanceAssessments/${period}_${target.staffId}`)),
        transaction.get(snapshotReference),
      ])
      const revision = Math.max(0, Math.trunc(Number(assessmentSnapshot.data()?.revision || 0)))
      if (revision !== computation.assessment.revision) throw new HttpsError('aborted', 'Phiếu chấm vừa thay đổi. Hãy tải lại trước khi khóa kỳ.')
      if (current.exists && current.data().locked === true) return
      transaction.set(snapshotReference, {
        ...computation.summary,
        staffId: target.staffId,
        ownerUid: target.ownerUid,
        staffName: target.name,
        branchIds: target.branchIds,
        periodId: period,
        assessmentRevision: revision,
        locked: true,
        lockedAt: FieldValue.serverTimestamp(),
        lockedBy: actor.uid,
        lockReason: reason,
        generatedAt: FieldValue.serverTimestamp(),
        generatedBy: actor.uid,
      }, { merge: true })
      transaction.create(db.collection('performanceAuditLogs').doc(), {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION, formulaVersion: PERFORMANCE_POLICY_VERSION,
        action: 'performance.snapshot.locked', actorUid: actor.uid, staffId: target.staffId,
        periodId: period, reason, score: computation.summary.score.value,
        gates: computation.summary.gates.map((gate) => ({ id: gate.id, status: gate.status })),
        createdAt: FieldValue.serverTimestamp(),
      })
    })
    const lockedSnapshot = await snapshotReference.get()
    const value = lockedSnapshot.data() || {}
    return { ...value, generatedAt: iso(value.generatedAt), locked: true }
  })

  return {
    getMyPerformanceScore,
    listMyPerformanceEvidence,
    submitPerformanceBrandEvidence,
    withdrawPerformanceBrandEvidence,
    listPerformanceReviewQueue,
    reviewPerformanceBrandEvidence,
    savePerformanceProfileChecklist,
    getPerformanceStaffScore,
    savePerformanceMetricAssessment,
    savePerformanceGateAssessment,
    refreshPerformanceSnapshot,
    setPerformanceSnapshotLock,
  }
}

module.exports = {
  PERFORMANCE_CATEGORIES,
  PROFILE_CHECKLIST_KEYS,
  calculateBrandPerformance,
  calculateMetricScore,
  calculatePerformanceSummary,
  bonusForScore,
  normalizeUrl,
  proofKey,
  assertBranchScope,
  createPerformanceScoreFunctions,
}
