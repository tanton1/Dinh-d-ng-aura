const { Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

const MAX_RANGE_DAYS = 366
const MAX_SCANNED_DOCUMENTS = 10000
const MAX_ACTION_DOCUMENTS = 2000
const DASHBOARD_CACHE_TTL_MS = 60_000
const DASHBOARD_CACHE_MAX_ENTRIES = 120
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
    renewals: hasCapability(actor, 'renewals.workspace.view'),
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

function pendingInstallments(value) {
  return Array.isArray(value.installments)
    ? value.installments.filter((item) => item?.status === 'pending' && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '').slice(0, 10)))
    : []
}

function summarizeReceivables(contracts, today) {
  const summary = emptyAction(true)
  for (const contract of contracts) {
    const debt = contractDebt(contract)
    if (!debt || contract.status === 'frozen') continue
    summary.totalCount += 1
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
    const permissions = dashboardPermissions(actor)
    const scope = dashboardBranchScope(actor, request.data?.branchId)
    const branchId = scope.branchId
    const startTimestamp = Timestamp.fromDate(start)
    const endTimestamp = Timestamp.fromDate(end)
    const startDate = dateKey(start)
    const endDate = dateKey(end)
    const today = dateKey(now)
    const cacheKey = [actor.uid, actor.authzVersion, startDate, endDate, branchId, scope.branchIds.join(',')].join('|')
    const cached = getCachedDashboard(cacheKey, request.data?.forceRefresh === true)
    if (cached) return cached

    const contractNeeded = permissions.finance || permissions.clients
    const sessionRangeQuery = db.collection('sessions').where('date', '>=', startDate).where('date', '<=', endDate)
    const attendanceRangeQuery = db.collection('attendanceEvents').where('occurredAt', '>=', startTimestamp).where('occurredAt', '<=', endTimestamp)
    const canAggregateOperations = permissions.operations && scope.unrestricted
    const [ledger, sessionRange, attendanceRange, todaySessions, contracts, students, trainers, staff, branches, renewalAction, scheduleAction, nutritionAction] = await Promise.all([
      permissions.finance ? db.collection('ledgerEntries').where('effectiveAt', '>=', startTimestamp).where('effectiveAt', '<=', endTimestamp).limit(MAX_SCANNED_DOCUMENTS).get() : null,
      permissions.operations ? (canAggregateOperations ? sessionRangeQuery.count().get() : sessionRangeQuery.limit(MAX_SCANNED_DOCUMENTS).get()) : null,
      permissions.operations ? (canAggregateOperations ? attendanceRangeQuery.count().get() : attendanceRangeQuery.limit(MAX_SCANNED_DOCUMENTS).get()) : null,
      permissions.operations ? db.collection('sessions').where('date', '==', today).limit(500).get() : null,
      contractNeeded ? db.collection('contracts').limit(2000).get() : null,
      permissions.clients ? db.collection('students').limit(2000).get() : null,
      permissions.operations ? db.collection('trainers').limit(500).get() : null,
      permissions.operations ? db.collection('staff').limit(500).get() : null,
      permissions.operations ? db.collection('branches').limit(100).get() : null,
      loadRenewalAction(db, actor, scope, today, permissions.renewals),
      loadScheduleAction(db, actor, scope, today, permissions.schedule),
      loadNutritionAction(db, actor, today, permissions.nutritionReviews),
    ])

    const ledgerValues = ledger ? ledger.docs.map((item) => item.data()).filter((value) => scopeMatches(value, scope) && ['posted', 'reversed'].includes(value.status)) : []
    const contractValues = contracts ? contracts.docs.map((item) => item.data()).filter((value) => scopeMatches(value, scope)) : []
    const studentValues = students ? students.docs.map((item) => item.data()).filter((value) => scopeMatches(value, scope)) : []
    const trainerValues = trainers ? trainers.docs.map((item) => item.data()).filter((value) => scopeMatches(value, scope)) : []
    const staffValues = staff ? staff.docs.map((item) => item.data()).filter((value) => scopeMatches(value, scope)) : []
    const branchValues = branches ? branches.docs.map((item) => ({ id: item.id, ...item.data() })).filter((value) => scope.unrestricted || scope.branchIds.includes(value.id)) : []
    const sessionValues = sessionRange?.docs ? sessionRange.docs.map((item) => item.data()).filter((value) => operationMatches(value, actor, scope)) : []
    const attendanceValues = attendanceRange?.docs ? attendanceRange.docs.map((item) => item.data()).filter((value) => operationMatches(value, actor, scope)) : []
    const sessionCount = canAggregateOperations ? Number(sessionRange?.data().count || 0) : sessionValues.length
    const attendanceCount = canAggregateOperations ? Number(attendanceRange?.data().count || 0) : attendanceValues.length
    const todayValues = todaySessions ? todaySessions.docs.map((item) => item.data()).filter((value) => operationMatches(value, actor, scope)) : []

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
    const receivables = contractValues.reduce((total, value) => total + contractDebt(value), 0)
    const sessionStatus = todayValues.reduce((result, value) => {
      const status = typeof value.status === 'string' ? value.status : 'unknown'
      result[status] = Number(result[status] || 0) + 1
      return result
    }, {})

    const receivableAction = permissions.finance ? summarizeReceivables(contractValues, today) : emptyAction(false)
    const missingContractAction = permissions.quality
      ? { ...emptyAction(true), totalCount: missingContractEffectiveDate, actionCount: missingContractEffectiveDate, warningCount: missingContractEffectiveDate }
      : emptyAction(false)
    const incomplete = Boolean(
      (ledger && ledger.size >= MAX_SCANNED_DOCUMENTS)
      || (!canAggregateOperations && sessionRange?.size >= MAX_SCANNED_DOCUMENTS)
      || (!canAggregateOperations && attendanceRange?.size >= MAX_SCANNED_DOCUMENTS)
      || renewalAction.truncated || scheduleAction.truncated || nutritionAction.truncated,
    )
    const result = {
      schemaVersion: 2,
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
      },
      finance: { ...finance, contractSales, receivables },
      clients: {
        total: studentValues.length,
        active: studentValues.filter((value) => !['inactive', 'cancelled', 'archived'].includes(value.status)).length,
        newInRange: studentValues.filter((value) => inRange(value.joinDate || value.createdAt, start, end)).length,
        activeContracts: contractValues.filter((value) => value.status === 'active').length,
      },
      operations: {
        sessions: sessionCount,
        attendanceEvents: attendanceCount,
        sessionStatus,
        completionRate: sessionCount ? Math.min(100, Math.round(attendanceCount / sessionCount * 100)) : 0,
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
      cache: { hit: false, ttlSeconds: Math.round(DASHBOARD_CACHE_TTL_MS / 1000) },
    }
    setCachedDashboard(cacheKey, result)
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
}
