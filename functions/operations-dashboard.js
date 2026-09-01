const { Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { createSharedDashboardCache, stableDashboardCacheKey } = require('./operations-dashboard-cache')
const { loadDailyAggregates } = require('./operations-dashboard-aggregates')

const MAX_RANGE_DAYS = 366
const MAX_SCANNED_DOCUMENTS = 10000
const MAX_ACTION_DOCUMENTS = 2000
const DASHBOARD_CACHE_TTL_MS = 60_000
const DASHBOARD_CACHE_MAX_ENTRIES = 24
const MAX_CONTRACT_DOCUMENTS = 2000
const MAX_STUDENT_DOCUMENTS = 2000
const MAX_TRAINER_DOCUMENTS = 500
const MAX_STAFF_DOCUMENTS = 500
const MAX_BRANCH_DOCUMENTS = 100
const dashboardCache = new Map()

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

function hasCapability(actor, capability) {
  return Array.isArray(actor.capabilities) && actor.capabilities.includes(capability)
}

function isOperationsAdmin(actor) {
  return actor.accessRole === 'admin' || actor.accessRole === 'super_admin'
}

function dashboardPermissions(actor) {
  const administrator = isOperationsAdmin(actor)
  return {
    finance: administrator || hasCapability(actor, 'finance.operations.manage') || hasCapability(actor, 'branch.finance.view'),
    clients: administrator || hasCapability(actor, 'pt.operations.manage') || hasCapability(actor, 'branch.operations.view'),
    operations: administrator || hasCapability(actor, 'pt.operations.manage') || hasCapability(actor, 'branch.operations.view') || hasCapability(actor, 'pt.schedule.self.view'),
    schedule: administrator || hasCapability(actor, 'pt.schedule.branch.publish') || hasCapability(actor, 'pt.schedule.self.view') || hasCapability(actor, 'pt.session.self.manage'),
    renewals: administrator || hasCapability(actor, 'renewals.workspace.view'),
    nutritionReviews: administrator || (actor.accessRole === 'staff' && actor.positions.some((position) => ['coach_online', 'trainer_pt'].includes(position))),
    academy: administrator || hasCapability(actor, 'academy.course.view') || hasCapability(actor, 'academy.operations.manage'),
    payroll: administrator || hasCapability(actor, 'payroll.operations.manage') || hasCapability(actor, 'payroll.self.view'),
    quality: administrator || hasCapability(actor, 'finance.operations.manage'),
  }
}

function dashboardBranchScope(actor, requestedBranch) {
  const requested = typeof requestedBranch === 'string' && requestedBranch.trim() ? requestedBranch.trim() : 'all'
  if (!/^(all|none|[A-Za-z0-9_-]{1,200})$/.test(requested)) {
    throw new HttpsError('invalid-argument', 'Chi nhánh báo cáo không hợp lệ.')
  }
  if (isOperationsAdmin(actor)) {
    return requested === 'all'
      ? { branchId: 'all', branchIds: [], unrestricted: true }
      : { branchId: requested, branchIds: requested === 'none' ? [] : [requested], unrestricted: false }
  }
  const allowedBranchIds = [...new Set(Array.isArray(actor.branchIds) ? actor.branchIds : [])]
  if (requested !== 'all' && requested !== 'none' && !allowedBranchIds.includes(requested)) {
    throw new HttpsError('permission-denied', 'Chi nhánh nằm ngoài phạm vi được cấp.')
  }
  if (requested === 'none') return { branchId: 'none', branchIds: [], unrestricted: false }
  const branchIds = requested === 'all' ? allowedBranchIds : [requested]
  return { branchId: requested === 'all' ? 'all' : requested, branchIds, unrestricted: false }
}

function scopeMatches(value, scope) {
  if (scope.unrestricted) return true
  if (scope.branchId === 'none') return !value.branchId
  return scope.branchIds.length > 0 && scope.branchIds.includes(value.branchId)
}

function actorTrainerIds(actor) {
  return new Set([actor.uid, actor.legacyStaffId].filter(Boolean))
}

function operationMatches(value, actor, scope) {
  if (isOperationsAdmin(actor) || hasCapability(actor, 'pt.operations.manage') || hasCapability(actor, 'branch.operations.view')) return scopeMatches(value, scope)
  return actorTrainerIds(actor).has(value.trainerId)
}

function emptyAction(available = false) {
  return { available, totalCount: 0, actionCount: 0, overdueCount: 0, dueTodayCount: 0, warningCount: 0, amount: 0, truncated: false }
}

function contractAmount(value) {
  return Math.max(0, Number(value.totalPrice || 0) - Number(value.discount || 0))
}

function contractDebt(value) {
  return Math.max(0, contractAmount(value) - Math.max(0, Number(value.paidAmount || 0)))
}

function collectibleContractDebt(value) {
  if (['draft', 'cancelled', 'inactive', 'archived'].includes(value.status)) return 0
  return contractDebt(value)
}

function ledgerReceiptImpact(value) {
  if (!['payment', 'refund', 'reversal', 'adjustment'].includes(value.type)) return 0
  if (value.cashImpact !== undefined && value.cashImpact !== null && Number.isFinite(Number(value.cashImpact))) {
    return Number(value.cashImpact)
  }
  const amount = Number(value.amount || 0)
  return Number.isFinite(amount) ? amount : 0
}

function ledgerRevenueImpact(value) {
  if (value.revenueImpact !== undefined && value.revenueImpact !== null && Number.isFinite(Number(value.revenueImpact))) {
    return Number(value.revenueImpact)
  }
  return value.type === 'revenue_recognition' && Number.isFinite(Number(value.amount)) ? Number(value.amount) : 0
}

function storedDateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const time = milliseconds(value)
  return time ? dateKey(new Date(time)) : ''
}

function hasCurrentContractWindow(value, referenceDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return false
  if (['cancelled', 'expired', 'inactive', 'archived'].includes(value.status)) return false
  const startDate = storedDateKey(value.startDate)
  const endDate = storedDateKey(value.endDate)
  return Boolean(startDate && endDate && startDate <= referenceDate && endDate >= referenceDate)
}

function hasUsableContractWindow(value, referenceDate) {
  if (!hasCurrentContractWindow(value, referenceDate)) return false
  const totalSessions = Math.max(0, Number(value.totalSessions || 0))
  const usedSessions = Math.max(0, Number(value.usedSessions || 0))
  return totalSessions > usedSessions
}

function isPreservedContract(value, referenceDate) {
  if (!hasUsableContractWindow(value, referenceDate)) return false
  if (value.status === 'frozen') return true
  return Array.isArray(value.pausePeriods) && value.pausePeriods.some((period) => period?.type === 'preservation'
    && storedDateKey(period.startDate) <= referenceDate && storedDateKey(period.endDate) >= referenceDate)
}

function isEffectiveContract(value, referenceDate) {
  return hasUsableContractWindow(value, referenceDate) && !isPreservedContract(value, referenceDate)
}

function isExhaustedContract(value, referenceDate) {
  if (!hasCurrentContractWindow(value, referenceDate)) return false
  const totalSessions = Math.max(0, Number(value.totalSessions || 0))
  const usedSessions = Math.max(0, Number(value.usedSessions || 0))
  return totalSessions > 0 && usedSessions >= totalSessions
}

function isExpiringContract(value, referenceDate, withinDays = 30) {
  if (!isEffectiveContract(value, referenceDate) && !isPreservedContract(value, referenceDate)) return false
  const endDate = storedDateKey(value.endDate)
  const referenceTime = Date.parse(`${referenceDate}T00:00:00Z`)
  const endTime = Date.parse(`${endDate}T00:00:00Z`)
  return Number.isFinite(endTime) && endTime >= referenceTime && endTime <= referenceTime + withinDays * 86400000
}

function reportGranularity(start, end) {
  const dayCount = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1)
  if (dayCount <= 45) return 'day'
  if (dayCount <= 180) return 'week'
  return 'month'
}

function reportBucket(value, granularity) {
  const time = milliseconds(value)
  if (!time) return null
  const key = dateKey(new Date(time))
  if (granularity === 'month') return { key: key.slice(0, 7), label: `T${Number(key.slice(5, 7))}/${key.slice(2, 4)}` }
  if (granularity === 'week') {
    const monday = weekMonday(key)
    return { key: monday, label: `${monday.slice(8, 10)}/${monday.slice(5, 7)}` }
  }
  return { key, label: `${key.slice(8, 10)}/${key.slice(5, 7)}` }
}

function dashboardAnalytics({ ledgerValues, contractValues, offValues, start, end, referenceDate }) {
  const granularity = reportGranularity(start, end)
  const points = new Map()
  const point = (bucket) => {
    const current = points.get(bucket.key) || { key: bucket.key, label: bucket.label, contractSales: 0, recognizedRevenue: 0, grossCash: 0, netCash: 0 }
    points.set(bucket.key, current)
    return current
  }
  // Build a continuous time axis. Previously only days containing a ledger
  // item were returned, which made the chart appear missing or broken when a
  // selected period had sparse activity.
  const cursor = new Date(start)
  cursor.setHours(12, 0, 0, 0)
  const endCursor = new Date(end)
  endCursor.setHours(12, 0, 0, 0)
  while (cursor <= endCursor) {
    const bucket = reportBucket(cursor, granularity)
    if (bucket) point(bucket)
    if (granularity === 'month') cursor.setMonth(cursor.getMonth() + 1, 1)
    else cursor.setDate(cursor.getDate() + (granularity === 'week' ? 7 : 1))
  }
  for (const value of contractValues) {
    const effectiveAt = contractEffectiveDate(value)
    if (!effectiveAt || !inRange(effectiveAt, start, end)) continue
    const bucket = reportBucket(effectiveAt, granularity)
    if (bucket) point(bucket).contractSales += contractAmount(value)
  }
  for (const value of ledgerValues) {
    const bucket = reportBucket(value.effectiveAt, granularity)
    if (!bucket) continue
    const amount = ledgerReceiptImpact(value)
    const current = point(bucket)
    if (value.type === 'payment' && amount > 0) current.grossCash += amount
    current.netCash += amount
    current.recognizedRevenue += ledgerRevenueImpact(value)
  }

  const effectiveContracts = contractValues.filter((value) => isEffectiveContract(value, referenceDate))
  const preservedContracts = contractValues.filter((value) => isPreservedContract(value, referenceDate))
  const packages = new Map()
  for (const contract of effectiveContracts) {
    const id = contract.packageId || contract.packageName || 'unknown'
    const current = packages.get(id) || { id, name: contract.packageName || 'Chưa xác định gói', count: 0, percent: 0 }
    current.count += 1
    packages.set(id, current)
  }
  const packageItems = [...packages.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'vi'))
  const visiblePackages = packageItems.slice(0, 5)
  if (packageItems.length > 5) {
    visiblePackages.push({ id: 'other', name: 'Gói khác', count: packageItems.slice(5).reduce((total, item) => total + item.count, 0), percent: 0 })
  }
  for (const item of visiblePackages) item.percent = effectiveContracts.length ? Math.round(item.count / effectiveContracts.length * 1000) / 10 : 0

  const effectiveContractIds = new Set(effectiveContracts.map((value) => value.id).filter(Boolean))
  const usableContractIds = new Set([...effectiveContracts, ...preservedContracts].map((value) => value.id).filter(Boolean))
  const offRequests = offValues.filter((value) => {
    const inferredType = value.type || (Number(value.durationDays || 0) > 0 && Number(value.durationDays || 0) <= 14 ? 'off' : '')
    return inferredType === 'off' && effectiveContractIds.has(value.contractId)
  })
  const approvedContractIds = new Set(offRequests.filter((value) => value.status === 'approved').map((value) => value.contractId))
  const pendingRequests = offRequests.filter((value) => value.status === 'pending').length
  const preservationRequests = offValues.filter((value) => value.type === 'preservation' && ['pending', 'approved'].includes(value.status) && usableContractIds.has(value.contractId)).length

  return {
    revenue: { granularity, points: [...points.values()].sort((left, right) => left.key.localeCompare(right.key)).slice(-60) },
    packages: { totalActive: effectiveContracts.length, preservedContracts: preservedContracts.length, items: visiblePackages },
    off: {
      activeContracts: effectiveContracts.length,
      approvedContracts: approvedContractIds.size,
      activeWithoutOff: Math.max(0, effectiveContracts.length - approvedContractIds.size),
      approvedRequests: offRequests.filter((value) => value.status === 'approved').length,
      pendingRequests,
      preservationRequests,
      preservedContracts: preservedContracts.length,
      rate: effectiveContracts.length ? Math.round(approvedContractIds.size / effectiveContracts.length * 1000) / 10 : 0,
    },
  }
}

function aggregateRevenueAnalytics(days, start, end) {
  const granularity = reportGranularity(start, end)
  const points = new Map()
  const point = (bucket) => {
    const current = points.get(bucket.key) || { key: bucket.key, label: bucket.label, contractSales: 0, recognizedRevenue: 0, grossCash: 0, netCash: 0 }
    points.set(bucket.key, current)
    return current
  }
  const cursor = new Date(start)
  cursor.setHours(12, 0, 0, 0)
  const endCursor = new Date(end)
  endCursor.setHours(12, 0, 0, 0)
  while (cursor <= endCursor) {
    const bucket = reportBucket(cursor, granularity)
    if (bucket) point(bucket)
    if (granularity === 'month') cursor.setMonth(cursor.getMonth() + 1, 1)
    else cursor.setDate(cursor.getDate() + (granularity === 'week' ? 7 : 1))
  }
  for (const day of days) {
    const bucket = reportBucket(`${day.date}T12:00:00+07:00`, granularity)
    if (!bucket) continue
    const current = point(bucket)
    current.contractSales += Number(day.metrics.contractSales || 0)
    current.recognizedRevenue += Number(day.metrics.recognizedRevenue || 0)
    current.grossCash += Number(day.metrics.grossCash || 0)
    current.netCash += Number(day.metrics.netCash || 0)
  }
  return { granularity, points: [...points.values()].sort((left, right) => left.key.localeCompare(right.key)).slice(-60) }
}

function summarizeAttendance(confirmedSessions, noShowSessions) {
  const confirmed = Math.max(0, Number(confirmedSessions || 0))
  const noShow = Math.min(confirmed, Math.max(0, Number(noShowSessions || 0)))
  const attended = Math.max(0, confirmed - noShow)
  return {
    confirmedSessions: confirmed,
    attendedSessions: attended,
    noShowSessions: noShow,
    attendanceRate: confirmed ? Math.round(attended / confirmed * 1000) / 10 : 0,
    absenceRate: confirmed ? Math.round(noShow / confirmed * 1000) / 10 : 0,
  }
}

function pendingInstallments(value) {
  return Array.isArray(value.installments)
    ? value.installments.filter((item) => item?.status === 'pending' && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '').slice(0, 10)))
    : []
}

function summarizeReceivables(contracts, today) {
  const summary = emptyAction(true)
  for (const contract of contracts) {
    const debt = collectibleContractDebt(contract)
    if (!debt) continue
    summary.totalCount += 1
    if (contract.status === 'frozen') {
      summary.warningCount += 1
      continue
    }
    const installments = pendingInstallments(contract)
    let overdueAmount = 0
    let dueTodayAmount = 0
    if (installments.length) {
      for (const installment of installments) {
        const dueDate = String(installment.date).slice(0, 10)
        const amount = Math.max(0, Number(installment.amount || 0))
        if (dueDate < today) overdueAmount += amount
        else if (dueDate === today) dueTodayAmount += amount
      }
    } else {
      const nextPaymentDate = String(contract.nextPaymentDate || '').slice(0, 10)
      if (nextPaymentDate && nextPaymentDate < today) overdueAmount = debt
      else if (nextPaymentDate === today) dueTodayAmount = debt
    }
    const actionableAmount = Math.min(debt, overdueAmount + dueTodayAmount)
    if (overdueAmount > 0) summary.overdueCount += 1
    if (dueTodayAmount > 0) summary.dueTodayCount += 1
    if (actionableAmount > 0) {
      summary.actionCount += 1
      summary.amount += actionableAmount
    } else summary.warningCount += 1
  }
  return summary
}

function addCalendarDays(dateKeyValue, days) {
  const [year, month, day] = dateKeyValue.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day))
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function receivableSchedule(contracts, studentValues, today, limit = 60) {
  const studentById = new Map(studentValues.map((value) => [value.id, value]))
  const monday = weekMonday(today)
  const weekEnd = addCalendarDays(monday, 6)
  const monthEnd = new Date(`${today.slice(0, 7)}-01T00:00:00Z`)
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)
  monthEnd.setUTCDate(0)
  const monthEndKey = monthEnd.toISOString().slice(0, 10)
  const rows = []
  const summary = {
    overdue: { count: 0, amount: 0 },
    dueThisWeek: { count: 0, amount: 0 },
    dueThisMonth: { count: 0, amount: 0 },
  }

  for (const contract of contracts) {
    const debt = collectibleContractDebt(contract)
    if (!debt || contract.status === 'frozen') continue
    let remainingDebt = debt
    const installments = pendingInstallments(contract)
      .map((item, index) => ({
        id: String(item.id || `installment-${index + 1}`),
        date: String(item.date).slice(0, 10),
        amount: Math.max(0, Number(item.amount || 0)),
      }))
      .sort((left, right) => left.date.localeCompare(right.date))
    const datedItems = installments.length
      ? installments
      : /^\d{4}-\d{2}-\d{2}/.test(String(contract.nextPaymentDate || ''))
        ? [{ id: 'next-payment', date: String(contract.nextPaymentDate).slice(0, 10), amount: debt }]
        : []

    for (const installment of datedItems) {
      if (remainingDebt <= 0) break
      const amount = Math.min(remainingDebt, installment.amount || remainingDebt)
      remainingDebt -= amount
      const isOverdue = installment.date < today
      const isDueThisWeek = installment.date >= today && installment.date <= weekEnd
      const isDueThisMonth = installment.date >= today && installment.date <= monthEndKey
      if (!isOverdue && !isDueThisMonth && !isDueThisWeek) continue
      const student = studentById.get(contract.studentId) || {}
      rows.push({
        id: `${contract.id}:${installment.id}`,
        contractId: contract.id,
        studentId: contract.studentId || '',
        studentName: student.name || student.fullName || contract.studentName || 'Học viên chưa cập nhật tên',
        phone: student.phone || contract.studentPhone || '',
        packageName: contract.packageName || 'Gói tập chưa cập nhật',
        dueDate: installment.date,
        amount,
        status: isOverdue ? 'overdue' : isDueThisWeek ? 'due_this_week' : 'due_this_month',
      })
      if (isOverdue) {
        summary.overdue.count += 1
        summary.overdue.amount += amount
      }
      if (isDueThisWeek) {
        summary.dueThisWeek.count += 1
        summary.dueThisWeek.amount += amount
      }
      if (isDueThisMonth) {
        summary.dueThisMonth.count += 1
        summary.dueThisMonth.amount += amount
      }
    }
  }

  const statusOrder = { overdue: 0, due_this_week: 1, due_this_month: 2 }
  rows.sort((left, right) => statusOrder[left.status] - statusOrder[right.status]
    || left.dueDate.localeCompare(right.dueDate)
    || left.studentName.localeCompare(right.studentName, 'vi'))
  return { summary, rows: rows.slice(0, limit), truncated: rows.length > limit }
}

function legacySessionHour(value) {
  const direct = Number(value.hour)
  if (Number.isFinite(direct)) return direct
  const match = String(value.id || '').match(/-(\d{1,2})(?:-|$)/)
  return match ? Number(match[1]) : null
}

function todayAttendanceRows(sessions, studentValues, trainerValues, limit = 80) {
  const studentById = new Map(studentValues.map((value) => [value.id, value]))
  const trainerById = new Map(trainerValues.map((value) => [value.id, value]))
  const rows = sessions
    .filter((value) => !['cancelled', 'student_cancelled', 'trainer_cancelled'].includes(value.status))
    .map((value) => {
      const student = studentById.get(value.studentId) || {}
      const trainer = trainerById.get(value.trainerId) || {}
      const attendanceStatus = value.attendanceStatus
        || (['completed', 'attended'].includes(value.status) ? 'present' : value.status === 'no_show' ? 'no_show' : 'pending')
      return {
        id: value.id || `${value.studentId || 'student'}:${value.trainerId || 'trainer'}:${value.date || ''}:${value.hour || ''}`,
        hour: legacySessionHour(value),
        studentId: value.studentId || '',
        studentName: student.name || student.fullName || 'Học viên chưa cập nhật tên',
        trainerId: value.trainerId || '',
        trainerName: trainer.name || trainer.fullName || 'PT chưa cập nhật tên',
        attendanceStatus: ['present', 'late', 'no_show'].includes(attendanceStatus) ? attendanceStatus : 'pending',
        billingStatus: value.billingStatus === 'charged' || ['completed', 'attended', 'no_show'].includes(value.status) ? 'charged' : 'pending',
      }
    })
    .sort((left, right) => (left.hour ?? 99) - (right.hour ?? 99) || left.trainerName.localeCompare(right.trainerName, 'vi') || left.studentName.localeCompare(right.studentName, 'vi'))
  return { rows: rows.slice(0, limit), truncated: rows.length > limit }
}

function renewalCaseMatches(value, actor, scope) {
  if (value.active === false) return false
  if (isOperationsAdmin(actor) || hasCapability(actor, 'renewals.system.manage') || hasCapability(actor, 'renewals.branch.manage')) return scopeMatches(value, scope)
  if (hasCapability(actor, 'renewals.case.self.manage') && value.assignedSalesId === actor.uid) return true
  if (!hasCapability(actor, 'renewals.case.assigned_student.support')) return false
  const contract = value.contractSnapshot || {}
  const trainerIds = new Set([contract.trainerId, ...(Array.isArray(contract.trainerIds) ? contract.trainerIds : []), ...(Array.isArray(contract.nutritionPTIds) ? contract.nutritionPTIds : [])].filter(Boolean))
  return [...actorTrainerIds(actor)].some((id) => trainerIds.has(id))
}

async function loadRenewalAction(db, actor, scope, today, available) {
  if (!available) return emptyAction(false)
  const snapshot = await db.collection('contractRenewalCases').where('active', '==', true).limit(MAX_ACTION_DOCUMENTS + 1).get()
  const values = snapshot.docs.slice(0, MAX_ACTION_DOCUMENTS).map((item) => item.data()).filter((value) => renewalCaseMatches(value, actor, scope))
  const summary = emptyAction(true)
  summary.totalCount = values.length
  summary.truncated = snapshot.size > MAX_ACTION_DOCUMENTS
  for (const value of values) {
    const due = String(value.nextActionAt || value.slaDueAt || '').slice(0, 10)
    if (due && due < today) summary.overdueCount += 1
    else if (due === today) summary.dueTodayCount += 1
    else summary.warningCount += 1
  }
  summary.actionCount = summary.overdueCount + summary.dueTodayCount
  summary.amount = values
    .filter((value) => {
      const due = String(value.nextActionAt || value.slaDueAt || '').slice(0, 10)
      return due && due <= today
    })
    .reduce((total, value) => total + Math.max(0, Number(value.expectedValue || 0)), 0)
  return summary
}

function weekMonday(today) {
  const [year, month, day] = today.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const dayIndex = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - dayIndex + 1)
  return date.toISOString().slice(0, 10)
}

function scheduleRequestMatches(value, actor, scope) {
  if (isOperationsAdmin(actor) || hasCapability(actor, 'pt.operations.manage') || hasCapability(actor, 'pt.schedule.branch.publish')) return scopeMatches(value, scope)
  return actorTrainerIds(actor).has(value.trainerId)
}

async function loadScheduleAction(db, actor, scope, today, available) {
  if (!available) return emptyAction(false)
  const [sessionRequests, leaveRequests, schedule] = await Promise.all([
    db.collection('sessionRequests').where('status', '==', 'pending').limit(MAX_ACTION_DOCUMENTS + 1).get(),
    db.collection('leaveRequests').where('status', '==', 'pending').limit(MAX_ACTION_DOCUMENTS + 1).get(),
    db.doc(`schedules/schedule_${weekMonday(today)}`).get(),
  ])
  const requests = [...sessionRequests.docs, ...leaveRequests.docs]
    .slice(0, MAX_ACTION_DOCUMENTS)
    .map((item) => item.data())
    .filter((value) => scheduleRequestMatches(value, actor, scope))
  const summary = emptyAction(true)
  summary.totalCount = requests.length
  for (const request of requests) {
    const deadline = String(request.deadlineAt || request.cutoffAt || '').slice(0, 10)
    if (deadline && deadline < today) summary.overdueCount += 1
    else if (deadline === today) summary.dueTodayCount += 1
  }
  const statuses = schedule.exists && schedule.data()?.publishStatusByBranch && typeof schedule.data().publishStatusByBranch === 'object'
    ? schedule.data().publishStatusByBranch
    : {}
  const branchKeys = scope.unrestricted ? Object.keys(statuses) : scope.branchIds
  summary.warningCount = branchKeys.filter((branchId) => statuses[branchId] === 'draft').length
  summary.actionCount = summary.totalCount + summary.warningCount
  summary.truncated = sessionRequests.size > MAX_ACTION_DOCUMENTS || leaveRequests.size > MAX_ACTION_DOCUMENTS
  return summary
}

function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const result = new Date(value || 0).getTime()
  return Number.isFinite(result) ? result : 0
}

async function nutritionClientIds(db, actor) {
  const ids = [...actorTrainerIds(actor)]
  const snapshots = await Promise.all(ids.map((id) => db.collection('contracts').where('nutritionPTIds', 'array-contains', id).limit(200).get()))
  return [...new Set(snapshots.flatMap((snapshot) => snapshot.docs.map((item) => item.data()?.studentId).filter(Boolean)))]
}

async function loadNutritionAction(db, actor, today, available) {
  if (!available) return emptyAction(false)
  const settingsPromise = db.doc('system/nutrition_review_settings').get()
  let documents = []
  let truncated = false
  if (isOperationsAdmin(actor) || hasCapability(actor, 'nutrition.meals.all.review')) {
    const snapshot = await db.collection('mealReviews').where('status', '==', 'pending').limit(MAX_ACTION_DOCUMENTS + 1).get()
    documents = snapshot.docs.slice(0, MAX_ACTION_DOCUMENTS)
    truncated = snapshot.size > MAX_ACTION_DOCUMENTS
  } else {
    const clientIds = await nutritionClientIds(db, actor)
    const chunks = []
    for (let index = 0; index < clientIds.length; index += 30) chunks.push(clientIds.slice(index, index + 30))
    const snapshots = await Promise.all(chunks.map((ids) => db.collection('mealReviews').where('userId', 'in', ids).limit(MAX_ACTION_DOCUMENTS + 1).get()))
    const unique = new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((item) => [item.id, item]))
    documents = [...unique.values()].slice(0, MAX_ACTION_DOCUMENTS)
    truncated = unique.size > MAX_ACTION_DOCUMENTS
  }
  const settings = await settingsPromise
  const configuredSla = Number(settings.exists ? settings.data()?.slaMinutes : 120)
  const slaMinutes = Number.isFinite(configuredSla) ? Math.min(1440, Math.max(30, configuredSla)) : 120
  const now = Date.now()
  const summary = emptyAction(true)
  const pending = documents.filter((item) => !['approved', 'rejected'].includes(item.data()?.status))
  summary.totalCount = pending.length
  summary.actionCount = pending.length
  summary.truncated = truncated
  for (const item of pending) {
    const value = item.data() || {}
    const createdAt = timestampMillis(value.createdAt) || timestampMillis(value.meal?.createdAt)
    if (!createdAt) { summary.warningCount += 1; continue }
    const dueAt = createdAt + slaMinutes * 60_000
    if (dueAt < now) summary.overdueCount += 1
    else if (dateKey(new Date(dueAt)) === today) summary.dueTodayCount += 1
  }
  return summary
}

function getCachedDashboard(cacheKey, forceRefresh) {
  if (forceRefresh) return null
  const cached = dashboardCache.get(cacheKey)
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) dashboardCache.delete(cacheKey)
    return null
  }
  return { ...cached.value, cache: { hit: true, ttlSeconds: Math.max(0, Math.ceil((cached.expiresAt - Date.now()) / 1000)) } }
}

function setCachedDashboard(cacheKey, value) {
  if (dashboardCache.size >= DASHBOARD_CACHE_MAX_ENTRIES) dashboardCache.delete(dashboardCache.keys().next().value)
  dashboardCache.set(cacheKey, { value, expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS })
}

function contractEffectiveDate(value) {
  // Migrated PT contracts do not carry signedAt/createdAt. startDate is the
  // preserved business date and is used only as the reporting fallback.
  return value.signedAt || value.createdAt || value.contractDate || value.startDate || null
}

function createOperationsDashboardFunctions({ db, onCall, logger = console }) {
  const sharedCache = createSharedDashboardCache({ db, logger })
  const getOperationsDashboard = onCall({
    memory: '512MiB',
    cpu: 1,
    maxInstances: 3,
    concurrency: 8,
  }, async (request) => {
    const startedAt = Date.now()
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'dashboard.view')
    const now = new Date()
    const startFallback = new Date(now.getFullYear(), now.getMonth(), 1)
    const start = dateInput(request.data?.startAt, startFallback)
    const end = dateInput(request.data?.endAt, now)
    if (start > end || end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86400000) {
      throw new HttpsError('invalid-argument', `Khoảng báo cáo tối đa ${MAX_RANGE_DAYS} ngày.`)
    }
    const permissions = dashboardPermissions(actor)
    const scope = dashboardBranchScope(actor, request.data?.branchId)
    const branchId = scope.branchId
    const startTimestamp = Timestamp.fromDate(start)
    const endTimestamp = Timestamp.fromDate(end)
    const startDate = dateKey(start)
    const endDate = dateKey(end)
    const today = dateKey(now)
    const cacheKey = stableDashboardCacheKey({ actor, permissions, scope, startDate, endDate })
    const cached = getCachedDashboard(cacheKey, request.data?.forceRefresh === true)
    if (cached) {
      logger.info('operations_dashboard_request', {
        durationMs: Date.now() - startedAt,
        cacheTier: 'memory',
        branchId,
        rangeDays: Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1,
      })
      return { ...cached, cache: { ...cached.cache, tier: 'memory' } }
    }
    const sharedCached = await sharedCache.get(cacheKey, request.data?.forceRefresh === true)
    if (sharedCached) {
      setCachedDashboard(cacheKey, sharedCached)
      logger.info('operations_dashboard_request', {
        durationMs: Date.now() - startedAt,
        cacheTier: 'shared',
        branchId,
        rangeDays: Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1,
      })
      return sharedCached
    }

    // Daily aggregates are built once and maintained by Firestore triggers.
    // They replace the largest ledger/session scans for administrator views;
    // actor-scoped staff views continue to use the stricter raw queries.
    const dailyAggregate = isOperationsAdmin(actor)
      ? await loadDailyAggregates({ db, startDate, endDate, scope })
      : null
    const contractNeeded = permissions.finance || permissions.clients
    const sessionRangeQuery = db.collection('sessions').where('date', '>=', startDate).where('date', '<=', endDate)
    const confirmedSessionRangeQuery = db.collection('sessions').where('status', 'in', ['completed', 'attended', 'no_show']).where('date', '>=', startDate).where('date', '<=', endDate)
    const noShowSessionRangeQuery = db.collection('sessions').where('status', '==', 'no_show').where('date', '>=', startDate).where('date', '<=', endDate)
    const attendanceRangeQuery = db.collection('attendanceEvents').where('occurredAt', '>=', startTimestamp).where('occurredAt', '<=', endTimestamp)
    const canAggregateOperations = permissions.operations && scope.unrestricted
    const [ledger, sessionRange, confirmedSessionRange, noShowSessionRange, attendanceRange, todaySessions, contracts, students, trainers, staff, branches, offRequests, renewalAction, scheduleAction, nutritionAction] = await Promise.all([
      permissions.finance && !dailyAggregate ? db.collection('ledgerEntries').where('effectiveAt', '>=', startTimestamp).where('effectiveAt', '<=', endTimestamp).limit(MAX_SCANNED_DOCUMENTS).get() : null,
      permissions.operations && !dailyAggregate ? (canAggregateOperations ? sessionRangeQuery.count().get() : sessionRangeQuery.limit(MAX_SCANNED_DOCUMENTS).get()) : null,
      permissions.operations && !dailyAggregate ? (canAggregateOperations ? confirmedSessionRangeQuery.count().get() : confirmedSessionRangeQuery.limit(MAX_SCANNED_DOCUMENTS).get()) : null,
      permissions.operations && !dailyAggregate ? (canAggregateOperations ? noShowSessionRangeQuery.count().get() : noShowSessionRangeQuery.limit(MAX_SCANNED_DOCUMENTS).get()) : null,
      permissions.operations && !dailyAggregate ? (canAggregateOperations ? attendanceRangeQuery.count().get() : attendanceRangeQuery.limit(MAX_SCANNED_DOCUMENTS).get()) : null,
      permissions.operations ? db.collection('sessions').where('date', '==', today).limit(500).get() : null,
      contractNeeded ? db.collection('contracts').limit(MAX_CONTRACT_DOCUMENTS + 1).get() : null,
      permissions.clients ? db.collection('students').limit(MAX_STUDENT_DOCUMENTS + 1).get() : null,
      permissions.operations ? db.collection('trainers').limit(MAX_TRAINER_DOCUMENTS + 1).get() : null,
      permissions.operations ? db.collection('staff').limit(MAX_STAFF_DOCUMENTS + 1).get() : null,
      permissions.operations ? db.collection('branches').limit(MAX_BRANCH_DOCUMENTS + 1).get() : null,
      (permissions.operations || permissions.clients) ? db.collection('leaveRequests').where('startDate', '>=', startDate).where('startDate', '<=', endDate).limit(MAX_ACTION_DOCUMENTS + 1).get() : null,
      loadRenewalAction(db, actor, scope, today, permissions.renewals),
      loadScheduleAction(db, actor, scope, today, permissions.schedule),
      loadNutritionAction(db, actor, today, permissions.nutritionReviews),
    ])

    const ledgerValues = ledger ? ledger.docs.map((item) => item.data()).filter((value) => scopeMatches(value, scope) && ['posted', 'reversed'].includes(value.status)) : []
    const contractValues = contracts ? contracts.docs.slice(0, MAX_CONTRACT_DOCUMENTS).map((item) => ({ id: item.id, ...item.data() })).filter((value) => scopeMatches(value, scope)) : []
    const studentValues = students ? students.docs.slice(0, MAX_STUDENT_DOCUMENTS).map((item) => ({ id: item.id, ...item.data() })).filter((value) => scopeMatches(value, scope)) : []
    const trainerValues = trainers ? trainers.docs.slice(0, MAX_TRAINER_DOCUMENTS).map((item) => ({ id: item.id, ...item.data() })).filter((value) => scopeMatches(value, scope)) : []
    const staffValues = staff ? staff.docs.slice(0, MAX_STAFF_DOCUMENTS).map((item) => item.data()).filter((value) => scopeMatches(value, scope)) : []
    const availableBranchValues = branches ? branches.docs.slice(0, MAX_BRANCH_DOCUMENTS).map((item) => ({ id: item.id, ...item.data() })) : []
    const branchValues = availableBranchValues.filter((value) => scope.unrestricted || scope.branchIds.includes(value.id))
    const sessionValues = sessionRange?.docs ? sessionRange.docs.map((item) => item.data()).filter((value) => operationMatches(value, actor, scope)) : []
    const attendanceValues = attendanceRange?.docs ? attendanceRange.docs.map((item) => item.data()).filter((value) => operationMatches(value, actor, scope)) : []
    const confirmedSessionValues = confirmedSessionRange?.docs ? confirmedSessionRange.docs.map((item) => item.data()).filter((value) => operationMatches(value, actor, scope)) : []
    const noShowSessionValues = noShowSessionRange?.docs ? noShowSessionRange.docs.map((item) => item.data()).filter((value) => operationMatches(value, actor, scope)) : []
    const aggregateTotals = dailyAggregate?.totals || {}
    const sessionCount = dailyAggregate ? Number(aggregateTotals.sessions || 0) : canAggregateOperations ? Number(sessionRange?.data().count || 0) : sessionValues.length
    const confirmedSessionCount = dailyAggregate ? Number(aggregateTotals.confirmedSessions || 0) : canAggregateOperations ? Number(confirmedSessionRange?.data().count || 0) : confirmedSessionValues.length
    const noShowSessionCount = dailyAggregate ? Number(aggregateTotals.noShowSessions || 0) : canAggregateOperations ? Number(noShowSessionRange?.data().count || 0) : noShowSessionValues.length
    const attendanceCount = dailyAggregate ? Number(aggregateTotals.attendanceEvents || 0) : canAggregateOperations ? Number(attendanceRange?.data().count || 0) : attendanceValues.length
    const todayValues = todaySessions ? todaySessions.docs.map((item) => ({ id: item.id, ...item.data() })).filter((value) => operationMatches(value, actor, scope)) : []
    const contractIds = new Set(contractValues.map((value) => value.id))
    const offValues = offRequests ? offRequests.docs.slice(0, MAX_ACTION_DOCUMENTS).map((item) => ({ id: item.id, ...item.data() })).filter((value) => contractIds.has(value.contractId)) : []

    const finance = ledgerValues.reduce((result, value) => {
      const amount = ledgerReceiptImpact(value)
      if (value.type === 'payment' && amount > 0) result.cashCollected += amount
      if (value.type === 'refund' && amount < 0) result.refunds += Math.abs(amount)
      if (value.type === 'reversal' && amount < 0) result.reversals += Math.abs(amount)
      if (value.type === 'adjustment') result.adjustments += amount
      result.netCash += amount
      result.recognizedRevenue += ledgerRevenueImpact(value)
      return result
    }, dailyAggregate ? {
      cashCollected: Number(aggregateTotals.cashCollected || 0),
      refunds: Number(aggregateTotals.refunds || 0),
      reversals: Number(aggregateTotals.reversals || 0),
      adjustments: Number(aggregateTotals.adjustments || 0),
      netCash: Number(aggregateTotals.netCash || 0),
      recognizedRevenue: Number(aggregateTotals.recognizedRevenue || 0),
    } : { cashCollected: 0, refunds: 0, reversals: 0, adjustments: 0, netCash: 0, recognizedRevenue: 0 })

    let missingContractEffectiveDate = 0
    const rawContractSales = contractValues.reduce((total, value) => {
      if (['draft', 'cancelled', 'inactive', 'archived'].includes(value.status)) return total
      const effectiveDate = contractEffectiveDate(value)
      if (!effectiveDate) { missingContractEffectiveDate += 1; return total }
      if (!inRange(effectiveDate, start, end)) return total
      return total + Math.max(0, Number(value.totalPrice || 0) - Number(value.discount || 0))
    }, 0)
    const contractSales = dailyAggregate ? Number(aggregateTotals.contractSales || 0) : rawContractSales
    const receivables = contractValues.reduce((total, value) => total + collectibleContractDebt(value), 0)
    const frozenReceivables = contractValues
      .filter((value) => value.status === 'frozen')
      .reduce((total, value) => total + collectibleContractDebt(value), 0)
    const sessionStatus = todayValues.reduce((result, value) => {
      const status = typeof value.status === 'string' ? value.status : 'unknown'
      result[status] = Number(result[status] || 0) + 1
      return result
    }, {})
    const attendanceToday = todayValues.reduce((result, value) => {
      const attendanceStatus = value.attendanceStatus
        || (['completed', 'attended'].includes(value.status) ? 'present' : value.status === 'no_show' ? 'no_show' : 'pending')
      const billingStatus = value.billingStatus
        || (['completed', 'attended', 'no_show'].includes(value.status) ? 'charged' : 'pending')
      if (billingStatus === 'charged') result.charged += 1
      if (attendanceStatus === 'present') result.present += 1
      else if (attendanceStatus === 'late') result.late += 1
      else if (attendanceStatus === 'no_show') result.noShow += 1
      else if (billingStatus === 'charged' || billingStatus === 'review_required') result.pendingConfirmation += 1
      return result
    }, { charged: 0, present: 0, late: 0, noShow: 0, pendingConfirmation: 0 })
    const confirmedToday = attendanceToday.present + attendanceToday.late + attendanceToday.noShow

    const receivableAction = permissions.finance ? summarizeReceivables(contractValues, today) : emptyAction(false)
    const receivableDetails = permissions.finance
      ? receivableSchedule(contractValues, studentValues, today)
      : { summary: { overdue: { count: 0, amount: 0 }, dueThisWeek: { count: 0, amount: 0 }, dueThisMonth: { count: 0, amount: 0 } }, rows: [], truncated: false }
    const attendanceDetails = permissions.operations
      ? todayAttendanceRows(todayValues, studentValues, trainerValues)
      : { rows: [], truncated: false }
    const missingContractAction = permissions.quality
      ? { ...emptyAction(true), totalCount: missingContractEffectiveDate, actionCount: missingContractEffectiveDate, warningCount: missingContractEffectiveDate }
      : emptyAction(false)
    const incomplete = Boolean(
      (ledger && ledger.size >= MAX_SCANNED_DOCUMENTS)
      || (!canAggregateOperations && sessionRange?.size >= MAX_SCANNED_DOCUMENTS)
      || (!canAggregateOperations && confirmedSessionRange?.size >= MAX_SCANNED_DOCUMENTS)
      || (!canAggregateOperations && noShowSessionRange?.size >= MAX_SCANNED_DOCUMENTS)
      || (!canAggregateOperations && attendanceRange?.size >= MAX_SCANNED_DOCUMENTS)
      || (offRequests && offRequests.size > MAX_ACTION_DOCUMENTS)
      || (contracts && contracts.size > MAX_CONTRACT_DOCUMENTS)
      || (students && students.size > MAX_STUDENT_DOCUMENTS)
      || (trainers && trainers.size > MAX_TRAINER_DOCUMENTS)
      || (staff && staff.size > MAX_STAFF_DOCUMENTS)
      || (branches && branches.size > MAX_BRANCH_DOCUMENTS)
      || renewalAction.truncated || scheduleAction.truncated || nutritionAction.truncated,
    )
    const referenceDate = dateKey(new Date(Math.min(end.getTime(), now.getTime())))
    const analytics = {
      ...dashboardAnalytics({ ledgerValues, contractValues, offValues, start, end, referenceDate }),
      attendance: summarizeAttendance(confirmedSessionCount, noShowSessionCount),
    }
    if (dailyAggregate) analytics.revenue = aggregateRevenueAnalytics(dailyAggregate.days, start, end)
    const result = {
      schemaVersion: 7,
      range: { startAt: start.toISOString(), endAt: end.toISOString(), timeZone: 'Asia/Ho_Chi_Minh' },
      branchId,
      scope: { branchId, branchIds: scope.branchIds, unrestricted: scope.unrestricted },
      permissions,
      actionSummary: {
        overdueReceivables: receivableAction,
        dueRenewals: renewalAction,
        pendingScheduleRequests: scheduleAction,
        overdueMealReviews: nutritionAction,
        missingContractEffectiveDate: missingContractAction,
      },
      today: {
        scheduledSessions: todayValues.filter((value) => !['cancelled', 'student_cancelled', 'trainer_cancelled'].includes(value.status)).length,
        completedSessions: todayValues.filter((value) => ['completed', 'attended'].includes(value.status)).length,
        pendingRequests: scheduleAction.totalCount,
        attendance: {
          ...attendanceToday,
          confirmed: confirmedToday,
          attendanceRate: confirmedToday ? Math.round((attendanceToday.present + attendanceToday.late) / confirmedToday * 1000) / 10 : 0,
          confirmationRate: attendanceToday.charged ? Math.round(confirmedToday / attendanceToday.charged * 1000) / 10 : 0,
        },
        rows: attendanceDetails.rows,
        truncated: attendanceDetails.truncated,
      },
      finance: { ...finance, contractSales, receivables, frozenReceivables, ledgerEntries: dailyAggregate ? Number(aggregateTotals.ledgerEntries || 0) : ledgerValues.length },
      receivables: receivableDetails,
      clients: {
        total: studentValues.length,
        active: studentValues.filter((value) => !['inactive', 'cancelled', 'archived'].includes(value.status)).length,
        newInRange: dailyAggregate ? Number(aggregateTotals.newStudents || 0) : studentValues.filter((value) => inRange(value.joinDate || value.createdAt, start, end)).length,
        activeContracts: analytics.packages.totalActive,
        preservedContracts: analytics.packages.preservedContracts,
        exhaustedContracts: contractValues.filter((value) => isExhaustedContract(value, referenceDate)).length,
        expiringSoonContracts: contractValues.filter((value) => isExpiringContract(value, referenceDate)).length,
      },
      analytics,
      operations: {
        sessions: sessionCount,
        attendanceEvents: attendanceCount,
        sessionStatus: dailyAggregate ? dailyAggregate.sessionStatus : sessionStatus,
        completionRate: sessionCount ? Math.min(100, Math.round(confirmedSessionCount / sessionCount * 100)) : 0,
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
        sourceCounts: {
          ledgerEntries: dailyAggregate ? Number(aggregateTotals.ledgerEntries || 0) : ledgerValues.length,
          contracts: contractValues.length,
          students: studentValues.length,
          sessions: sessionCount,
          attendanceEvents: attendanceCount,
        },
      },
      generatedAt: new Date().toISOString(),
      cache: { hit: false, tier: 'miss', ttlSeconds: Math.round(DASHBOARD_CACHE_TTL_MS / 1000) },
      filters: {
        branches: availableBranchValues
          .filter((value) => isOperationsAdmin(actor) || (Array.isArray(actor.branchIds) && actor.branchIds.includes(value.id)))
          .filter((value) => value.status !== 'inactive')
          .map((value) => ({ id: value.id, name: value.name || value.branchName || value.id }))
          .sort((left, right) => left.name.localeCompare(right.name, 'vi')),
      },
    }
    logger.info('operations_dashboard_summary', {
      schemaVersion: result.schemaVersion,
      accessRole: actor.accessRole,
      branchId: result.branchId,
      permissions: result.permissions,
      finance: {
        ledgerEntries: result.finance.ledgerEntries,
        recognizedRevenue: result.finance.recognizedRevenue,
        netCash: result.finance.netCash,
      },
      clients: { newInRange: result.clients.newInRange, activeContracts: result.clients.activeContracts },
      analytics: { revenuePoints: result.analytics.revenue.points.length, packageItems: result.analytics.packages.items.length },
      todayRows: result.today.rows.length,
      receivableRows: result.receivables.rows.length,
    })
    setCachedDashboard(cacheKey, result)
    await sharedCache.set(cacheKey, result)
    logger.info('operations_dashboard_request', {
      durationMs: Date.now() - startedAt,
      cacheTier: 'miss',
      branchId,
      rangeDays: Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1,
      sourceCounts: result.quality.sourceCounts,
      truncated: result.quality.truncated,
      aggregateUsed: Boolean(dailyAggregate),
    })
    return result
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

module.exports = {
  createOperationsDashboardFunctions,
  dashboardBranchScope,
  dashboardPermissions,
  renewalCaseMatches,
  summarizeReceivables,
  receivableSchedule,
  todayAttendanceRows,
  isEffectiveContract,
  isPreservedContract,
  isExhaustedContract,
  isExpiringContract,
  ledgerReceiptImpact,
  ledgerRevenueImpact,
  dashboardAnalytics,
  summarizeAttendance,
}
