const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

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

function sessionChangeDeadline(dateValue, hour) {
  return new Date(sessionStartTime(dateValue, hour).getTime() - 12 * HOUR_MS)
}

function assertSessionChangeDeadline(dateValue, hour, now = new Date()) {
  const deadline = sessionChangeDeadline(dateValue, hour)
  if (now.getTime() > deadline.getTime()) {
    const error = new Error('Yêu cầu đổi hoặc hủy lịch phải được gửi trước giờ tập ít nhất 12 giờ.')
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

function weeklyOffDeadline(startValue) {
  const monday = mondayOfWeek(startValue)
  const sunday = addDateDays(monday, -1)
  return new Date(`${sunday}T10:00:00+07:00`)
}

function assertWeeklyOffDeadline(startValue, now = new Date()) {
  const deadline = weeklyOffDeadline(startValue)
  if (now.getTime() >= deadline.getTime()) {
    const error = new Error('Đăng ký OFF phải hoàn tất trước 10:00 Chủ nhật của tuần tập.')
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

function offRegistrationLimit(durationMonths) {
  if (!Number.isFinite(durationMonths) || durationMonths <= 0) return 0
  if (durationMonths <= 3) return 1
  if (durationMonths <= 6) return 3
  return 6
}

function policyUsageDecision(approvedCount) {
  const count = Number.isInteger(approvedCount) && approvedCount >= 0 ? approvedCount : 0
  return {
    sequence: count + 1,
    complimentary: count < 1,
    countsTowardContract: count >= 1,
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
  addDateDays,
  assertSessionChangeDeadline,
  assertWeeklyOffDeadline,
  contractDurationMonths,
  dateKey,
  inclusiveDateDays,
  offRegistrationLimit,
  policyUsageDecision,
  sessionChangeDeadline,
  sessionStartTime,
  storedDateShape,
  vietnamDateKey,
  vietnamMonthKey,
  weeklyOffDeadline,
}
