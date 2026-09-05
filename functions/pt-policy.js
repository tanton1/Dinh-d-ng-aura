const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
// Versioned metadata is attached only to contracts created after the policy
// rollout. Existing contracts retain their original rights and are never
// silently reinterpreted by a later default change.
const PT_OPERATIONS_POLICY_VERSION = 'pt-operations-v3'
const PT_OPERATIONS_POLICY_EFFECTIVE_FROM = '2026-09-05'

function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function dateKey(value, label = 'Ngày') {
  const normalized = typeof value === 'string' ? value.trim().slice(0, 10) : ''
  if (!validDateKey(normalized)) throw new Error(`${label} không hợp lệ.`)
  return normalized
}

function vietnamDateKey(value = new Date()) {
  const instant = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(instant.getTime())) throw new Error('Thời gian không hợp lệ.')
  return new Date(instant.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10)
}

function vietnamMonthKey(value = new Date()) {
  return vietnamDateKey(value).slice(0, 7)
}

function sessionStartTime(dateValue, hour) {
  const sessionDate = dateKey(dateValue, 'Ngày tập')
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Giờ tập không hợp lệ.')
  return new Date(`${sessionDate}T${String(hour).padStart(2, '0')}:00:00+07:00`)
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

function normalizedPtOperationsPolicy(value = {}) {
  const offLimits = value && typeof value.offLimitsByDuration === 'object' && !Array.isArray(value.offLimitsByDuration)
    ? value.offLimitsByDuration
    : {}
  return {
    complimentaryChangeCancelPerMonth: boundedInteger(value.complimentaryChangeCancelPerMonth, 1, 1, 2),
    sessionChangeDeadlineHours: boundedInteger(value.sessionChangeDeadlineHours, 12, 1, 72),
    offMaxDaysPerRequest: boundedInteger(value.offMaxDaysPerRequest, 14, 1, 31),
    offRegistrationCutoffHour: boundedInteger(value.offRegistrationCutoffHour, 10, 0, 23),
    offLimitsByDuration: {
      threeMonths: boundedInteger(offLimits.threeMonths, 1, 0, 12),
      sixMonths: boundedInteger(offLimits.sixMonths, 3, 0, 24),
      twelveMonths: boundedInteger(offLimits.twelveMonths, 6, 0, 48),
    },
  }
}

function sessionChangeDeadline(dateValue, hour, deadlineHours = 12) {
  const normalizedHours = boundedInteger(deadlineHours, 12, 1, 72)
  return new Date(sessionStartTime(dateValue, hour).getTime() - normalizedHours * HOUR_MS)
}

function assertSessionChangeDeadline(dateValue, hour, now = new Date(), deadlineHours = 12) {
  const normalizedHours = boundedInteger(deadlineHours, 12, 1, 72)
  const deadline = sessionChangeDeadline(dateValue, hour, normalizedHours)
  if (now.getTime() > deadline.getTime()) {
    const error = new Error(`Yêu cầu đổi hoặc hủy lịch phải được gửi trước giờ tập ít nhất ${normalizedHours} giờ.`)
    error.issueCode = 'SESSION_CHANGE_DEADLINE_PASSED'
    error.deadlineAt = deadline.toISOString()
    throw error
  }
  return deadline
}

function addDateDays(dateValue, days) {
  const value = dateKey(dateValue)
  if (!Number.isInteger(days)) throw new Error('Số ngày không hợp lệ.')
  const parsed = new Date(`${value}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function inclusiveDateDays(startValue, endValue) {
  const start = dateKey(startValue, 'Ngày bắt đầu')
  const end = dateKey(endValue, 'Ngày kết thúc')
  const duration = Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / DAY_MS) + 1
  if (!Number.isInteger(duration) || duration < 1) throw new Error('Ngày kết thúc phải từ ngày bắt đầu trở đi.')
  return duration
}

function mondayOfWeek(dateValue) {
  const parsed = new Date(`${dateKey(dateValue)}T00:00:00.000Z`)
  const weekday = parsed.getUTCDay()
  parsed.setUTCDate(parsed.getUTCDate() + (weekday === 0 ? -6 : 1 - weekday))
  return parsed.toISOString().slice(0, 10)
}

function weeklyOffDeadline(startValue, cutoffHour = 10) {
  const normalizedHour = boundedInteger(cutoffHour, 10, 0, 23)
  const monday = mondayOfWeek(startValue)
  const sunday = addDateDays(monday, -1)
  return new Date(`${sunday}T${String(normalizedHour).padStart(2, '0')}:00:00+07:00`)
}

function assertWeeklyOffDeadline(startValue, now = new Date(), cutoffHour = 10) {
  const normalizedHour = boundedInteger(cutoffHour, 10, 0, 23)
  const deadline = weeklyOffDeadline(startValue, normalizedHour)
  if (now.getTime() >= deadline.getTime()) {
    const error = new Error(`Đăng ký OFF phải hoàn tất trước ${String(normalizedHour).padStart(2, '0')}:00 Chủ nhật của tuần tập.`)
    error.issueCode = 'OFF_REGISTRATION_DEADLINE_PASSED'
    error.deadlineAt = deadline.toISOString()
    throw error
  }
  return deadline
}

function contractDurationMonths(contract = {}, trainingPackage = {}) {
  const explicit = Number(trainingPackage.durationMonths ?? contract.durationMonths)
  if (Number.isInteger(explicit) && explicit > 0 && explicit <= 120) return explicit

  const start = dateKey(contract.startDate, 'Ngày bắt đầu hợp đồng')
  const end = dateKey(contract.originalEndDate || contract.endDate, 'Ngày kết thúc hợp đồng')
  const extensionDays = Array.isArray(contract.extensions)
    ? contract.extensions.reduce((total, item) => {
        const previous = typeof item?.oldEndDate === 'string' ? item.oldEndDate.slice(0, 10) : ''
        const next = typeof item?.newEndDate === 'string' ? item.newEndDate.slice(0, 10) : ''
        try { return total + Math.max(0, inclusiveDateDays(previous, next) - 1) } catch { return total }
      }, 0)
    : 0
  const rawDays = Math.max(1, inclusiveDateDays(start, end) - extensionDays)
  if (rawDays <= 100) return 3
  if (rawDays <= 200) return 6
  return 12
}

function offRegistrationLimit(durationMonths, policyValue = {}) {
  const policy = normalizedPtOperationsPolicy(policyValue)
  if (!Number.isFinite(durationMonths) || durationMonths <= 0) return 0
  if (durationMonths <= 3) return policy.offLimitsByDuration.threeMonths
  if (durationMonths <= 6) return policy.offLimitsByDuration.sixMonths
  return policy.offLimitsByDuration.twelveMonths
}

function policyUsageDecision(approvedCount, complimentaryLimit = 1) {
  const count = Number.isInteger(approvedCount) && approvedCount >= 0 ? approvedCount : 0
  const limit = boundedInteger(complimentaryLimit, 1, 1, 2)
  return {
    sequence: count + 1,
    complimentary: count < limit,
    countsTowardContract: count >= limit,
    complimentaryLimit: limit,
  }
}

function storedDateShape(original, dateValue) {
  const normalized = dateKey(dateValue)
  return typeof original === 'string' && original.includes('T')
    ? `${normalized}T00:00:00.000Z`
    : normalized
}

module.exports = {
  DAY_MS,
  PT_OPERATIONS_POLICY_EFFECTIVE_FROM,
  PT_OPERATIONS_POLICY_VERSION,
  addDateDays,
  assertSessionChangeDeadline,
  assertWeeklyOffDeadline,
  contractDurationMonths,
  dateKey,
  inclusiveDateDays,
  normalizedPtOperationsPolicy,
  offRegistrationLimit,
  policyUsageDecision,
  sessionChangeDeadline,
  sessionStartTime,
  storedDateShape,
  vietnamDateKey,
  vietnamMonthKey,
  weeklyOffDeadline,
}
