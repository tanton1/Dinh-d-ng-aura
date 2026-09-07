const INTELLIGENCE_SCHEMA_VERSION = 1

const KNOWN_METRIC_SOURCES = new Set([
  'teaching_slots',
  'feedback_score',
  'renewals_won',
  'renewals_assisted',
  'attributed_revenue',
  'attributed_commission',
  'workdays',
])

const DEFAULT_ATTRIBUTION_RULES = Object.freeze([
  { sourceType: 'revenue', priority: ['referralStaffId', 'assignedSalesId'], splitMode: 'single' },
  { sourceType: 'renewal', priority: ['trainerId', 'trainerIds', 'nutritionPTIds'], splitMode: 'single' },
  { sourceType: 'feedback', priority: ['actualTrainerId', 'trainerId'], splitMode: 'single' },
  { sourceType: 'teaching', priority: ['trainerId'], splitMode: 'single' },
  { sourceType: 'workdays', priority: ['trainerId'], splitMode: 'single' },
])

function dataOf(value) {
  return typeof value?.data === 'function' ? value.data() || {} : value || {}
}

function idOf(value) {
  return typeof value?.id === 'string' ? value.id : String(dataOf(value).id || '')
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bounded(value, minimum, maximum, fallback) {
  const parsed = number(value, fallback)
  return Math.max(minimum, Math.min(maximum, parsed))
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 200) : fallback
}

function dateKey(value) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const timestampDate = value?.toDate?.()
  const date = timestampDate || (value instanceof Date ? value : new Date(value))
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(date)
}

function normalizeMetric(value, key) {
  const raw = value && typeof value === 'object' ? value : {}
  const source = KNOWN_METRIC_SOURCES.has(raw.source) ? raw.source : key
  return {
    id: text(raw.id, key) || key,
    label: text(raw.label, key),
    source: KNOWN_METRIC_SOURCES.has(source) ? source : '',
    enabled: raw.enabled === true,
    weight: bounded(raw.weight, 0, 100, 0),
    target: Math.max(0, number(raw.target, 0)),
    direction: raw.direction === 'lower_is_better' ? 'lower_is_better' : 'higher_is_better',
    cap: bounded(raw.cap, 100, 1000, 100),
  }
}

function normalizeAttributionRules(value) {
  const source = Array.isArray(value) ? value : DEFAULT_ATTRIBUTION_RULES
  const rules = source.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const sourceType = text(raw.sourceType)
    const priority = Array.isArray(raw.priority)
      ? [...new Set(raw.priority.filter((item) => typeof item === 'string').map((item) => item.slice(0, 100)))].slice(0, 12)
      : []
    if (!sourceType || !priority.length) return []
    return [{
      sourceType,
      priority,
      splitMode: raw.splitMode === 'equal' ? 'equal' : 'single',
    }]
  })
  return rules.length ? rules : DEFAULT_ATTRIBUTION_RULES.map((rule) => ({ ...rule, priority: [...rule.priority] }))
}

function normalizeRankBands(value) {
  const source = Array.isArray(value) ? value : []
  return source.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const label = text(raw.label)
    if (!label) return []
    return [{
      code: text(raw.code, label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'rank'),
      label,
      minScore: bounded(raw.minScore, 0, 100, 0),
      maxScore: bounded(raw.maxScore, 0, 100, 100),
    }]
  }).sort((left, right) => right.minScore - left.minScore)
}

function normalizePayrollIntelligencePolicy(value = {}, id = '') {
  const raw = dataOf(value)
  const metricsRaw = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : {}
  const metrics = Object.fromEntries(Object.entries(metricsRaw).slice(0, 30).map(([key, item]) => [
    text(key, '').slice(0, 50), normalizeMetric(item, text(key, '').slice(0, 50)),
  ]).filter(([key, metric]) => key && metric.source))
  const enabledMetrics = Object.values(metrics).filter((metric) => metric.enabled && metric.weight > 0 && metric.target > 0)
  const rankBands = normalizeRankBands(raw.rankBands)
  return {
    id: text(id || raw.id),
    name: text(raw.name, 'Phân tích hiệu suất Aura'),
    version: Math.max(1, Math.trunc(number(raw.version, 1))),
    effectiveFrom: dateKey(raw.effectiveFrom) || '1900-01-01',
    status: raw.status === 'inactive' ? 'inactive' : 'active',
    enabled: raw.enabled !== false && enabledMetrics.length > 0,
    metrics,
    attributionRules: normalizeAttributionRules(raw.attributionRules),
    rankBands,
    renew: {
      wonStages: Array.isArray(raw.renew?.wonStages) ? raw.renew.wonStages.filter((stage) => typeof stage === 'string').slice(0, 20) : ['won'],
      creditAssisted: raw.renew?.creditAssisted === true,
    },
    // This layer is analytics-only. It must never mutate the existing salary,
    // teaching-pay or commission amounts in a payroll run.
    amountImpact: 'none',
  }
}

function payrollIntelligencePolicySnapshot(policy) {
  if (!policy) return null
  return {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    id: policy.id,
    name: policy.name,
    version: policy.version,
    effectiveFrom: policy.effectiveFrom,
    status: policy.status,
    enabled: policy.enabled,
    metrics: policy.metrics,
    attributionRules: policy.attributionRules,
    rankBands: policy.rankBands,
    renew: policy.renew,
    amountImpact: 'none',
  }
}

function valueFromPath(value, path) {
  const parts = String(path || '').split('.').filter(Boolean)
  let current = value
  for (const part of parts) {
    if (Array.isArray(current)) {
      current = current.flatMap((item) => valueFromPath(item, part)).filter(Boolean)
    } else {
      current = current && typeof current === 'object' ? current[part] : undefined
    }
  }
  return current
}

function idsFromPath(value, path) {
  const found = valueFromPath(value, path)
  const values = Array.isArray(found) ? found : [found]
  return [...new Set(values.flatMap((item) => typeof item === 'string' ? [item.trim()] : []))].filter(Boolean)
}

function ruleFor(policy, sourceType) {
  return policy?.attributionRules?.find((rule) => rule.sourceType === sourceType)
    || DEFAULT_ATTRIBUTION_RULES.find((rule) => rule.sourceType === sourceType)
}

function resolveAttribution(event, policy) {
  const rule = ruleFor(policy, event.sourceType)
  const candidates = (rule?.priority || []).flatMap((path) => idsFromPath(event, path))
  const unique = [...new Set(candidates)]
  if (!unique.length) return { staffIds: [], role: 'unresolved', splitMode: rule?.splitMode || 'single', conflict: true }
  if (rule?.splitMode === 'equal') return { staffIds: unique, role: rule.sourceType, splitMode: 'equal', conflict: unique.length > 1 }
  return { staffIds: [unique[0]], role: rule.sourceType, splitMode: 'single', conflict: unique.length > 1 }
}

function ledgerEntry({ event, staffId, attribution, value = 0, quantity = 1, status = 'verified', reason = '' }) {
  return {
    id: text(event.id, `${event.sourceType}:${event.sourceId || 'unknown'}`),
    sourceType: text(event.sourceType, 'unknown'),
    sourceId: text(event.sourceId),
    date: dateKey(event.date || event.createdAt),
    staffId,
    role: text(attribution.role, 'unresolved'),
    quantity: Math.max(0, number(quantity)),
    value: number(value),
    status: status === 'review' ? 'review' : 'verified',
    attributionConflict: attribution.conflict === true,
    reason: text(reason),
  }
}

function buildEvidenceLedger({ staffId, teachingSlots = [], referralEvidence = {}, feedback = [], renewals = [], workdays = {}, policy }) {
  const ledger = []
  for (const slot of teachingSlots) {
    const event = { id: slot.key, sourceType: 'teaching', sourceId: slot.key, date: slot.date, trainerId: staffId }
    const attribution = resolveAttribution(event, policy)
    if (attribution.staffIds.includes(staffId)) ledger.push(ledgerEntry({ event, staffId, attribution, quantity: 1, value: 1, reason: 'Một PT + ngày + giờ = một ca bằng chứng.' }))
  }
  for (const evidence of Array.isArray(referralEvidence.evidence) ? referralEvidence.evidence : []) {
    const event = { ...evidence, id: evidence.ledgerEntryId, sourceType: 'revenue', sourceId: evidence.ledgerEntryId, date: evidence.date, referralStaffId: staffId }
    const attribution = resolveAttribution(event, policy)
    if (attribution.staffIds.includes(staffId)) ledger.push(ledgerEntry({ event, staffId, attribution, value: number(evidence.cashImpact), quantity: 1, reason: 'Dòng tiền đã đối soát từ sổ cái.' }))
  }
  for (const raw of feedback) {
    const value = dataOf(raw)
    const event = { ...value, id: idOf(raw), sourceType: 'feedback', sourceId: idOf(raw), date: value.sessionDate || value.submittedAt }
    const attribution = resolveAttribution({ ...event, actualTrainerId: value.actualTrainerId || value.trainerId }, policy)
    if (attribution.staffIds.includes(staffId)) ledger.push(ledgerEntry({ event, staffId, attribution, value: number(value.overallScore), quantity: 1, status: ['needs_review', 'reviewing'].includes(value.status) ? 'review' : 'verified', reason: 'Đánh giá sau buổi tập.' }))
  }
  for (const raw of renewals) {
    const value = dataOf(raw)
    const contract = value.contractSnapshot && typeof value.contractSnapshot === 'object' ? value.contractSnapshot : {}
    const event = {
      ...value,
      ...contract,
      id: idOf(raw),
      sourceType: 'renewal',
      sourceId: idOf(raw),
      date: value.wonAt || value.updatedAt || value.createdAt,
      assignedSalesId: value.assignedSalesId || contract.assignedSalesId,
      trainerId: contract.trainerId || value.trainerId,
      trainerIds: contract.trainerIds || value.trainerIds,
      nutritionPTIds: contract.nutritionPTIds || value.nutritionPTIds,
    }
    const wonStages = policy?.renew?.wonStages?.length ? policy.renew.wonStages : ['won']
    const isWon = wonStages.includes(String(value.stage || '').toLowerCase()) || value.renewedContractId
    if (!isWon) continue
    const approvedSplit = Array.isArray(value.approvedAttribution?.splits)
      && value.approvedAttribution?.approvedBy
      && value.approvedAttribution.splits.reduce((sum, item) => sum + number(item?.percent), 0) === 100
      ? value.approvedAttribution.splits
      : null
    if (approvedSplit) {
      const share = approvedSplit.find((item) => item?.staffId === staffId)
      if (share) ledger.push(ledgerEntry({
        event,
        staffId,
        attribution: { staffIds: approvedSplit.map((item) => item.staffId), role: text(share.role, 'renewal'), splitMode: 'approved', conflict: false },
        value: number(value.wonValue || value.expectedValue) * number(share.percent) / 100,
        quantity: number(share.percent) / 100,
        reason: `Gia hạn chia ${number(share.percent)}% theo quyết định đã duyệt.`,
      }))
    } else {
      const attribution = resolveAttribution(event, policy)
      if (attribution.staffIds.includes(staffId)) ledger.push(ledgerEntry({ event, staffId, attribution, value: number(value.wonValue || value.expectedValue), quantity: 1, reason: 'Không có quyết định chia; PT chính nhận 100% quy thuộc.' }))
    }
  }
  const workdayCount = number(workdays.paidDays || workdays.estimatedPaidDays || 0)
  if (workdayCount > 0) {
    const event = { id: `workdays:${staffId}`, sourceType: 'workdays', sourceId: `workdays:${staffId}`, date: '', trainerId: staffId }
    const attribution = resolveAttribution(event, policy)
    if (attribution.staffIds.includes(staffId)) ledger.push(ledgerEntry({ event, staffId, attribution, quantity: workdayCount, value: workdayCount, reason: 'Ngày công đã snapshot trong kỳ.' }))
  }
  return ledger.slice(0, 500)
}

function observationsFromLedger(ledger) {
  const bySource = new Map()
  for (const item of ledger) {
    const current = bySource.get(item.sourceType) || { quantity: 0, value: 0, count: 0, reviewCount: 0 }
    current.quantity += number(item.quantity)
    current.value += number(item.value)
    current.count += 1
    if (item.status === 'review') current.reviewCount += 1
    bySource.set(item.sourceType, current)
  }
  const feedback = ledger.filter((item) => item.sourceType === 'feedback')
  const feedbackScore = feedback.length ? feedback.reduce((sum, item) => sum + item.value, 0) / feedback.length : 0
  return {
    teaching_slots: bySource.get('teaching')?.quantity || 0,
    feedback_score: feedbackScore,
    renewals_won: bySource.get('renewal')?.quantity || 0,
    renewals_assisted: bySource.get('renewal')?.quantity || 0,
    attributed_revenue: bySource.get('revenue')?.value || 0,
    attributed_commission: 0,
    workdays: bySource.get('workdays')?.quantity || 0,
  }
}

function calculateKpiSummary(policy, ledger) {
  if (!policy?.enabled) return { enabled: false, score: null, weightTotal: 0, metrics: [], reason: 'Chưa bật chính sách KPI.' }
  const observed = observationsFromLedger(ledger)
  const metrics = Object.values(policy.metrics || {}).flatMap((metric) => {
    if (!metric.enabled || metric.weight <= 0 || metric.target <= 0 || !metric.source) return []
    const actual = number(observed[metric.source])
    const ratio = metric.direction === 'lower_is_better'
      ? metric.target / Math.max(metric.target, actual)
      : actual / metric.target
    const score = Math.min(metric.cap, Math.max(0, ratio * 100))
    return [{ id: metric.id, label: metric.label, source: metric.source, target: metric.target, actual, weight: metric.weight, score: Math.round(score * 10) / 10, weightedScore: Math.round(score * metric.weight * 10) / 10 }]
  })
  const weightTotal = metrics.reduce((sum, metric) => sum + metric.weight, 0)
  const score = weightTotal ? Math.round(metrics.reduce((sum, metric) => sum + metric.weightedScore, 0) / weightTotal * 10) / 10 : null
  return { enabled: metrics.length > 0, score, weightTotal, metrics, reason: metrics.length ? '' : 'Chưa có metric KPI hợp lệ.' }
}

function calculateRankSummary(policy, score) {
  const safeScore = score === null || score === undefined ? null : bounded(score, 0, 100, 0)
  if (safeScore === null || !policy?.rankBands?.length) return { code: 'unconfigured', label: 'Chưa xếp hạng', score: safeScore, configured: false }
  const band = policy.rankBands.find((item) => safeScore >= item.minScore && safeScore <= item.maxScore) || policy.rankBands[policy.rankBands.length - 1]
  return { code: band.code, label: band.label, score: safeScore, configured: true }
}

function buildPayrollIntelligence({ staffId, teachingSlots = [], referralEvidence = {}, feedback = [], renewals = [], workdays = {}, policy = null }) {
  const normalizedPolicy = policy ? normalizePayrollIntelligencePolicy(policy, policy.id) : null
  const evidenceLedger = buildEvidenceLedger({ staffId, teachingSlots, referralEvidence, feedback, renewals, workdays, policy: normalizedPolicy })
  const kpi = calculateKpiSummary(normalizedPolicy, evidenceLedger)
  const rank = calculateRankSummary(normalizedPolicy, kpi.score)
  const bySource = {}
  const byRole = {}
  let conflictCount = 0
  evidenceLedger.forEach((item) => {
    bySource[item.sourceType] = (bySource[item.sourceType] || 0) + 1
    byRole[item.role] = (byRole[item.role] || 0) + 1
    if (item.attributionConflict === true) conflictCount += 1
  })
  const renewalsWon = evidenceLedger.filter((item) => item.sourceType === 'renewal')
  const revenue = evidenceLedger.filter((item) => item.sourceType === 'revenue')
  const reviewCount = evidenceLedger.filter((item) => item.status === 'review').length
  return {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    enabled: Boolean(normalizedPolicy?.enabled),
    policyId: normalizedPolicy?.id || '',
    policyVersion: normalizedPolicy?.version || 0,
    policyName: normalizedPolicy?.name || '',
    policySnapshot: payrollIntelligencePolicySnapshot(normalizedPolicy),
    evidenceLedger,
    evidenceLedgerSummary: {
      count: evidenceLedger.length,
      reviewCount,
      truncated: evidenceLedger.length >= 500,
      bySource,
      byRole,
    },
    attribution: {
      conflictCount,
      sourceCount: Object.keys(bySource).length,
      attributedRevenue: revenue.reduce((sum, item) => sum + number(item.value), 0),
      attributedCommission: number(referralEvidence.commissionAmount),
      bySource,
      byRole,
    },
    renew: {
      wonCount: renewalsWon.length,
      assistedCount: renewalsWon.length,
      attributedRevenue: renewalsWon.reduce((sum, item) => sum + number(item.value), 0),
      reviewCount: renewalsWon.filter((item) => item.status === 'review').length,
    },
    kpi,
    rank,
    // Explicit invariant for reviewers and future migrations.
    amountImpact: 'none',
  }
}

function chooseEffectivePayrollIntelligencePolicy(values, periodEnd) {
  return values
    .map((value) => normalizePayrollIntelligencePolicy(value, idOf(value)))
    .filter((policy) => policy.status === 'active' && policy.effectiveFrom <= periodEnd)
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom) || right.version - left.version)[0] || null
}

module.exports = {
  INTELLIGENCE_SCHEMA_VERSION,
  normalizePayrollIntelligencePolicy,
  payrollIntelligencePolicySnapshot,
  chooseEffectivePayrollIntelligencePolicy,
  resolveAttribution,
  buildEvidenceLedger,
  calculateKpiSummary,
  calculateRankSummary,
  buildPayrollIntelligence,
}
