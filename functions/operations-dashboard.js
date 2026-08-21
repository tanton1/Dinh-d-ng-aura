const { Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

const MAX_RANGE_DAYS = 366
const MAX_SCANNED_DOCUMENTS = 10000

function dateInput(value, fallback) {
  const date = value ? new Date(value) : fallback
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new HttpsError('invalid-argument', 'Khoảng ngày báo cáo không hợp lệ.')
  return date
}

function dateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function milliseconds(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const number = new Date(value || 0).getTime()
  return Number.isFinite(number) ? number : 0
}

function inRange(value, start, end) {
  const time = milliseconds(value)
  return time >= start.getTime() && time <= end.getTime()
}

function branchMatches(value, branchId) {
  if (branchId === 'all') return true
  if (branchId === 'none') return !value.branchId
  return value.branchId === branchId
}

function contractEffectiveDate(value) {
  return value.signedAt || value.createdAt || value.contractDate || null
}

function createOperationsDashboardFunctions({ db, onCall }) {
  const getOperationsDashboard = onCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'dashboard.view')
    const now = new Date()
    const startFallback = new Date(now.getFullYear(), now.getMonth(), 1)
    const start = dateInput(request.data?.startAt, startFallback)
    const end = dateInput(request.data?.endAt, now)
    if (start > end || end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86400000) {
      throw new HttpsError('invalid-argument', `Khoảng báo cáo tối đa ${MAX_RANGE_DAYS} ngày.`)
    }
    const requestedBranch = typeof request.data?.branchId === 'string' ? request.data.branchId.trim() : 'all'
    const branchId = requestedBranch || 'all'
    const startTimestamp = Timestamp.fromDate(start)
    const endTimestamp = Timestamp.fromDate(end)
    const startDate = dateKey(start)
    const endDate = dateKey(end)

    const [ledger, sessions, attendance, contracts, students, trainers, staff, branches] = await Promise.all([
      db.collection('ledgerEntries').where('effectiveAt', '>=', startTimestamp).where('effectiveAt', '<=', endTimestamp).limit(MAX_SCANNED_DOCUMENTS).get(),
      db.collection('sessions').where('date', '>=', startDate).where('date', '<=', endDate).limit(MAX_SCANNED_DOCUMENTS).get(),
      db.collection('attendanceEvents').where('occurredAt', '>=', startTimestamp).where('occurredAt', '<=', endTimestamp).limit(MAX_SCANNED_DOCUMENTS).get(),
      db.collection('contracts').limit(2000).get(),
      db.collection('students').limit(2000).get(),
      db.collection('trainers').limit(500).get(),
      db.collection('staff').limit(500).get(),
      db.collection('branches').limit(100).get(),
    ])

    const ledgerValues = ledger.docs.map((item) => item.data()).filter((value) => branchMatches(value, branchId) && ['posted', 'reversed'].includes(value.status))
    const sessionValues = sessions.docs.map((item) => item.data()).filter((value) => branchMatches(value, branchId))
    const attendanceValues = attendance.docs.map((item) => item.data()).filter((value) => branchMatches(value, branchId))
    const contractValues = contracts.docs.map((item) => item.data()).filter((value) => branchMatches(value, branchId))
    const studentValues = students.docs.map((item) => item.data()).filter((value) => branchMatches(value, branchId))
    const trainerValues = trainers.docs.map((item) => item.data()).filter((value) => branchMatches(value, branchId))
    const staffValues = staff.docs.map((item) => item.data()).filter((value) => branchMatches(value, branchId))
    const branchValues = branches.docs.map((item) => item.data())

    const finance = ledgerValues.reduce((result, value) => {
      const amount = Number(value.amount || 0)
      if (value.type === 'payment' && amount > 0) result.cashCollected += amount
      if (value.type === 'refund' && amount < 0) result.refunds += Math.abs(amount)
      if (value.type === 'reversal' && amount < 0) result.reversals += Math.abs(amount)
      if (value.type === 'adjustment') result.adjustments += amount
      result.netCash += amount
      return result
    }, { cashCollected: 0, refunds: 0, reversals: 0, adjustments: 0, netCash: 0 })

    let missingContractEffectiveDate = 0
    const contractSales = contractValues.reduce((total, value) => {
      const effectiveDate = contractEffectiveDate(value)
      if (!effectiveDate) { missingContractEffectiveDate += 1; return total }
      if (!inRange(effectiveDate, start, end)) return total
      return total + Math.max(0, Number(value.totalPrice || 0) - Number(value.discount || 0))
    }, 0)
    const receivables = contractValues.reduce((total, value) => total + Math.max(0, Number(value.totalPrice || 0) - Number(value.discount || 0) - Number(value.paidAmount || 0)), 0)
    const sessionStatus = sessionValues.reduce((result, value) => {
      const status = typeof value.status === 'string' ? value.status : 'unknown'
      result[status] = Number(result[status] || 0) + 1
      return result
    }, {})

    const incomplete = [ledger, sessions, attendance].some((snapshot) => snapshot.size >= MAX_SCANNED_DOCUMENTS)
    return {
      schemaVersion: 1,
      range: { startAt: start.toISOString(), endAt: end.toISOString(), timeZone: 'Asia/Ho_Chi_Minh' },
      branchId,
      finance: { ...finance, contractSales, receivables },
      clients: {
        total: studentValues.length,
        active: studentValues.filter((value) => !['inactive', 'cancelled', 'archived'].includes(value.status)).length,
        newInRange: studentValues.filter((value) => inRange(value.joinDate || value.createdAt, start, end)).length,
        activeContracts: contractValues.filter((value) => value.status === 'active').length,
      },
      operations: {
        sessions: sessionValues.length,
        attendanceEvents: attendanceValues.length,
        sessionStatus,
        activeTrainers: trainerValues.filter((value) => value.status !== 'inactive').length,
        activeStaff: staffValues.filter((value) => value.status !== 'inactive').length,
        branches: branchValues.filter((value) => value.status !== 'inactive').length,
      },
      quality: {
        completeness: incomplete ? 'partial' : missingContractEffectiveDate ? 'partial' : 'complete',
        missingContractEffectiveDate,
        truncated: incomplete,
        canonicalFinanceSource: 'ledgerEntries',
        canonicalAttendanceSource: 'attendanceEvents',
      },
      generatedAt: new Date().toISOString(),
    }
  })
  const listStaffAttendance = onCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'payroll.operations.manage')
    const periodId = typeof request.data?.periodId === 'string' ? request.data.periodId.trim() : ''
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) throw new HttpsError('invalid-argument', 'Kỳ chấm công phải có dạng YYYY-MM.')
    const [year, month] = periodId.split('-').map(Number)
    const nextYear = month === 12 ? year + 1 : year
    const nextMonth = month === 12 ? 1 : month + 1
    const start = Timestamp.fromDate(new Date(`${periodId}-01T00:00:00+07:00`))
    const end = Timestamp.fromDate(new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+07:00`))
    const snapshot = await db.collection('attendanceEvents').where('occurredAt', '>=', start).where('occurredAt', '<', end).orderBy('occurredAt', 'desc').limit(5000).get()
    const counts = new Map()
    for (const item of snapshot.docs) {
      const value = item.data()
      if (!value.trainerId) continue
      const current = counts.get(value.trainerId) || { trainerId: value.trainerId, sessionCount: 0, lastOccurredAt: '' }
      current.sessionCount += 1
      if (!current.lastOccurredAt) current.lastOccurredAt = value.occurredAt?.toDate?.().toISOString?.() || ''
      counts.set(value.trainerId, current)
    }
    return { periodId, rows: [...counts.values()], eventCount: snapshot.size, truncated: snapshot.size >= 5000, source: 'attendanceEvents' }
  })
  return { getOperationsDashboard, listStaffAttendance }
}

module.exports = { createOperationsDashboardFunctions }
