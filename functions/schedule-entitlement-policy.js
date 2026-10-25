'use strict'
const { HttpsError } = require('firebase-functions/v2/https')
const { contractDateKey, contractPausedOn, contractSchedulableOn, normalizedContractStatus, TERMINAL_CONTRACT_STATUSES } = require('./contract-status')

function monthAfter(value) {
  const key = contractDateKey(value)
  if (!key) return ''
  const date = new Date(`${key}T00:00:00Z`)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + 1)
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, end))
  return date.toISOString().slice(0, 10)
}

function hiddenExpiredStudent(contracts, studentId, referenceDate) {
  const rows = contracts.filter(c => c.studentId === studentId && !TERMINAL_CONTRACT_STATUSES.has(normalizedContractStatus(c.status)))
  const latestEnd = rows.map(c => contractDateKey(c.endDate)).filter(Boolean).sort().at(-1)
  // A renewal/future entitlement keeps the profile discoverable; eligibility
  // on the chosen training date is a separate, non-overridable write check.
  return Boolean(latestEnd && monthAfter(latestEnd) < referenceDate)
}

function approvedContractOff(contracts, studentId, date) {
  const rows = contracts.filter(c => c.studentId === studentId && !TERMINAL_CONTRACT_STATUSES.has(normalizedContractStatus(c.status)))
  return !rows.some(c => contractSchedulableOn(c, date)) && rows.some(c =>
    contractDateKey(c.startDate) <= date && contractDateKey(c.endDate) >= date && contractPausedOn(c, date))
}

function requireScheduleContract(contracts, studentId, date, preferredId = '') {
  const rows = contracts.filter(c => c.studentId === studentId && contractSchedulableOn(c, date))
  const selected = rows.find(c => c.id === preferredId) || rows.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))[0]
  if (selected) return selected
  const code = approvedContractOff(contracts, studentId, date) ? 'CONTRACT_PAUSED' : 'ACTIVE_CONTRACT_NOT_FOUND'
  throw new HttpsError('failed-precondition', code === 'CONTRACT_PAUSED'
    ? 'Học viên đã được duyệt OFF / bảo lưu trong ngày này. Không thể xếp ca.'
    : 'Học viên không có hợp đồng còn hiệu lực trong ngày tập. Hãy kiểm tra đúng hồ sơ hoặc gia hạn hợp đồng.',
  { issueCode: code, errors: [code] })
}

const indexes = new WeakMap()
function entryOnApprovedOff(data, slotId, entry) {
  if (!data?.weekId || entry.type === 'off') return false
  let index = indexes.get(data)
  if (!index || index.contracts !== data.contracts || index.students !== data.students || index.week !== data.weekId) {
    const byStudent = new Map()
    for (const contract of data.contracts || []) {
      if (!byStudent.has(contract.studentId)) byStudent.set(contract.studentId, [])
      byStudent.get(contract.studentId).push(contract)
    }
    index = { contracts: data.contracts, students: data.students, week: data.weekId, byStudent,
      profiles: new Map([...(data.students || []), ...(data.crossBranchStudents || [])].map(s => [s.id, s])), dates: new Map() }
    indexes.set(data, index)
  }
  const offset = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].indexOf(slotId.split('-')[0])
  if (offset < 0) return false
  if (!index.dates.has(offset)) {
    const date = new Date(`${data.weekId}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    index.dates.set(offset, date.toISOString().slice(0, 10))
  }
  const key = index.dates.get(offset)
  const contracts = index.byStudent.get(entry.studentId)
  if (contracts?.length) return approvedContractOff(contracts, entry.studentId, key)
  const student = index.profiles.get(entry.studentId)
  return Boolean(student?.pausedScheduleDates?.includes(key) && !student.validScheduleDates?.includes(key))
}

function requireCrossBranchConfirmation(student, branchId, payload) {
  if (student.branchId && student.branchId !== branchId && payload.confirmCrossBranchStudent !== true) {
    throw new HttpsError('failed-precondition', 'Học viên thuộc cơ sở khác. Hãy xác nhận trước khi xếp tay.', { issueCode: 'STUDENT_BRANCH_CONFIRMATION_REQUIRED' })
  }
}

module.exports = { monthAfter, hiddenExpiredStudent, approvedContractOff, requireScheduleContract, entryOnApprovedOff, requireCrossBranchConfirmation }
