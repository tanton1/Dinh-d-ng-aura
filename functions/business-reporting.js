const { attendanceReconciliation } = require('./attendance-reconciliation')
const { FieldPath, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { canonicalUsageSessions, sessionCountsTowardContract, summarizeSessionUsage, summarizeContractUsage } = require('./contract-usage')
const { canonicalUsageSummary, loadContractUsageViews, USAGE_VIEW_SOURCE_VERSION } = require('./contract-usage-view')
const { canonicalSessionRows } = require('./session-schedule-normalization')
const { decodeHistoryCursor, historyCursorScope, readCanonicalHistoryPage } = require('./training-history-pagination')

const MAX_RANGE_DAYS = 366
const MAX_LEDGER_DOCUMENTS = 10000
const MAX_ATTENDANCE_DOCUMENTS = 10000
const MAX_HISTORY_PAGE = 100
const DEFAULT_HISTORY_PAGE = 50
const MAX_USAGE_SESSIONS = 10000
const validHistoryStatuses = new Set([
  'scheduled',
  'rescheduled',
  'completed',
  'attended',
  'no_show',
  'student_cancelled',
  'trainer_cancelled',
  'corrected',
])
const validSources = new Set([
  'all',
  'pt_gym',
  'online_coaching',
  'nutrition_coaching',
  'academy',
  'eat_clean',
  'delivery_fee',
  'payroll',
  'other',
  'legacy_unclassified',
])

function string(value, label, maximum = 200, required = true) {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > maximum) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function documentId(value, label) {
  const result = string(value, label)
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function dateKey(value, label = 'Ngày') {
  const result = string(value, label, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00+07:00`))) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function vietnamDateKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const get = (type) => values.find((item) => item.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const result = new Date(value || 0).getTime()
  return Number.isFinite(result) ? result : 0
}

function timestampIso(value) {
  const millis = timestampMillis(value)
  return millis ? new Date(millis).toISOString() : ''
}

function number(value, fallback = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : fallback
}

function utcDateAtVietnamStart(key) {
  return Timestamp.fromDate(new Date(`${key}T00:00:00+07:00`))
}

function followingDateKey(key) {
  const date = new Date(`${key}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function normaliseBusinessRange(data = {}) {
  const today = vietnamDateKey(new Date())
  const defaultStart = new Date()
  defaultStart.setDate(defaultStart.getDate() - 29)
  const startDate = dateKey(data.startDate || vietnamDateKey(defaultStart), 'Ngày bắt đầu')
  const endDate = dateKey(data.endDate || today, 'Ngày kết thúc')
  if (startDate > endDate) throw new HttpsError('invalid-argument', 'Khoảng ngày báo cáo không hợp lệ.')
  const rangeDays = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1
  if (rangeDays > MAX_RANGE_DAYS) throw new HttpsError('invalid-argument', `Khoảng ngày tối đa ${MAX_RANGE_DAYS} ngày.`)
  const branchId = typeof data.branchId === 'string' && data.branchId.trim() ? documentId(data.branchId, 'Chi nhánh') : 'all'
  const source = typeof data.source === 'string' && data.source.trim() ? data.source.trim() : 'all'
  if (!validSources.has(source)) throw new HttpsError('invalid-argument', 'Nguồn doanh thu không hợp lệ.')
  return { startDate, endDate, nextEndDate: followingDateKey(endDate), branchId, source, rangeDays }
}

function sourceForLedger(entry = {}) {
  const source = typeof entry.source === 'string' ? entry.source : ''
  if (validSources.has(source) && source !== 'all') return source
  if (entry.contractId) return 'pt_gym'
  return 'legacy_unclassified'
}

function cashImpact(entry) {
  if (Number.isFinite(Number(entry.cashImpact))) return Number(entry.cashImpact)
  if (entry.type === 'payment' || entry.type === 'refund' || entry.type === 'reversal' || entry.type === 'adjustment') return number(entry.amount)
  return 0
}

function revenueImpact(entry) {
  if (Number.isFinite(Number(entry.revenueImpact))) return Number(entry.revenueImpact)
  return entry.type === 'revenue_recognition' ? number(entry.amount) : 0
}

function expenseImpact(entry) {
  if (Number.isFinite(Number(entry.expenseImpact))) return Number(entry.expenseImpact)
  return entry.type === 'expense' || entry.type === 'payroll' ? Math.abs(number(entry.amount)) : 0
}

function emptySourceRow(source) {
  return {
    source,
    cashIn: 0,
    cashOut: 0,
    cashNet: 0,
    recognisedRevenue: 0,
    operatingExpense: 0,
    operatingResult: 0,
    entryCount: 0,
  }
}

function summaryFromLedger(entries, input) {
  const sourceRows = new Map()
  const daily = new Map()
  const result = {
    cashIn: 0,
    cashOut: 0,
    cashNet: 0,
    recognisedRevenue: 0,
    operatingExpense: 0,
    operatingResult: 0,
    receivableMovement: 0,
    deferredRevenueMovement: 0,
    transactionCount: 0,
    legacyUnclassifiedEntries: 0,
    sourceRows: [],
    dailySeries: [],
  }
  entries.forEach((entry) => {
    if (!['posted', 'reversed'].includes(entry.status)) return
    if (input.branchId !== 'all' && entry.branchId !== input.branchId) return
    const source = sourceForLedger(entry)
    if (input.source !== 'all' && source !== input.source) return
    const cash = cashImpact(entry)
    const revenue = revenueImpact(entry)
    const expense = expenseImpact(entry)
    const row = sourceRows.get(source) || emptySourceRow(source)
    row.cashIn += Math.max(0, cash)
    row.cashOut += Math.abs(Math.min(0, cash))
    row.cashNet += cash
    row.recognisedRevenue += revenue
    row.operatingExpense += expense
    row.operatingResult = row.recognisedRevenue - row.operatingExpense
    row.entryCount += 1
    sourceRows.set(source, row)

    result.cashIn += Math.max(0, cash)
    result.cashOut += Math.abs(Math.min(0, cash))
    result.cashNet += cash
    result.recognisedRevenue += revenue
    result.operatingExpense += expense
    result.receivableMovement += number(entry.receivableImpact)
    result.deferredRevenueMovement += number(entry.deferredRevenueImpact)
    result.transactionCount += 1
    if (source === 'legacy_unclassified') result.legacyUnclassifiedEntries += 1
    const date = vietnamDateKey(entry.effectiveAt)
    if (date) {
      const item = daily.get(date) || { date, cashNet: 0, recognisedRevenue: 0, operatingExpense: 0, operatingResult: 0 }
      item.cashNet += cash
      item.recognisedRevenue += revenue
      item.operatingExpense += expense
      item.operatingResult = item.recognisedRevenue - item.operatingExpense
      daily.set(date, item)
    }
  })
  result.operatingResult = result.recognisedRevenue - result.operatingExpense
  result.sourceRows = [...sourceRows.values()].sort((left, right) => right.recognisedRevenue - left.recognisedRevenue || right.cashNet - left.cashNet)
  result.dailySeries = [...daily.values()].sort((left, right) => left.date.localeCompare(right.date))
  return result
}

function canonicalHistoryRows(rows = []) {
  return canonicalSessionRows(rows).sort((left, right) => {
    const dateOrder = String(right.date || '').slice(0, 10).localeCompare(String(left.date || '').slice(0, 10))
    return dateOrder || String(right.id || '').localeCompare(String(left.id || ''))
  })
}

function canonicalStudentHistoryRows(rows = []) {
  // Keep learner history on the same daily uniqueness rule as contract usage;
  // trainer history still retains every learner in a paired teaching shift.
  return canonicalUsageSessions(rows).sort((left, right) => {
    const dateOrder = String(right.date || '').slice(0, 10).localeCompare(String(left.date || '').slice(0, 10))
    return dateOrder || String(right.id || '').localeCompare(String(left.id || ''))
  })
}

function normaliseHistoryInput(data = {}) {
  const allTime = data.allTime === true
  const startDate = dateKey(data.startDate || '2020-01-01', 'Ngày bắt đầu')
  const endDate = dateKey(data.endDate || vietnamDateKey(new Date()), 'Ngày kết thúc')
  if (!allTime && startDate > endDate) throw new HttpsError('invalid-argument', 'Khoảng ngày lịch sử không hợp lệ.')
  const rangeDays = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1
  if (!allTime && rangeDays > MAX_RANGE_DAYS) throw new HttpsError('invalid-argument', `Khoảng ngày tối đa ${MAX_RANGE_DAYS} ngày.`)
  const status = typeof data.status === 'string' && data.status.trim() ? data.status.trim() : 'all'
  if (status !== 'all' && !validHistoryStatuses.has(status)) throw new HttpsError('invalid-argument', 'Trạng thái buổi tập không hợp lệ.')
  const pageSize = Math.min(MAX_HISTORY_PAGE, Math.max(1, Number.isInteger(data.pageSize) ? data.pageSize : DEFAULT_HISTORY_PAGE))
  const cursor = decodeHistoryCursor(data.cursor)
  // The first page always establishes fresh totals. New clients can retain
  // those totals while appending records; legacy clients keep the old result.
  return { startDate, endDate, status, pageSize, cursor, allTime, includeSummary: !cursor || data.includeSummary !== false }
}

function matchesAssignment(contract, actor) {
  const actorIds = new Set([actor.uid, actor.legacyStaffId].filter(Boolean))
  return actorIds.has(contract.trainerId) || actorIds.has(contract.assignedTrainerId) || actorIds.has(contract.coachId)
}

async function assertHistoryAccess(request, db, subjectType, subjectId) {
  const actor = await trustedAccessContext(request, db)
  const isOperationsAdmin = actor.capabilities.includes('pt.operations.manage')
  if (isOperationsAdmin) return { actor, scope: 'admin' }

  if (actor.capabilities.includes('branch.operations.view')) {
    const collection = subjectType === 'student' ? 'students' : 'trainers'
    const profile = await db.doc(`${collection}/${subjectId}`).get()
    if (profile.exists && actor.branchIds.includes(profile.data().branchId)) {
      return { actor, scope: 'branch_manager' }
    }
  }

  if (subjectType === 'trainer' && actor.capabilities.includes('pt.schedule.self.view')) {
    if (![actor.uid, actor.legacyStaffId].filter(Boolean).includes(subjectId)) {
      throw new HttpsError('permission-denied', 'Bạn chỉ có thể xem lịch dạy của chính mình.')
    }
    return { actor, scope: 'trainer' }
  }

  if (subjectType === 'student' && actor.accessRole === 'student') {
    const ownCrmProfileId = actor.legacyStaffId || actor.uid
    if (subjectId !== ownCrmProfileId && subjectId !== actor.uid) {
      throw new HttpsError('permission-denied', 'Bạn chỉ có thể xem lịch sử của chính mình.')
    }
    return { actor, scope: 'student' }
  }

  if (subjectType === 'student' && actor.capabilities.includes('pt.students.assigned.view')) {
    const contracts = await db.collection('contracts').where('studentId', '==', subjectId).limit(40).get()
    if (contracts.docs.some((item) => matchesAssignment(item.data(), actor))) {
      return { actor, scope: 'trainer_assigned_student' }
    }

    // Staff workspace may include a learner whose active contract belongs to
    // another PT but who has an actual session assigned to this PT. Keep the
    // canonical history endpoint aligned with that server-verified workspace
    // scope. A caller still needs a real session relationship and cannot use
    // this fallback to enumerate unrelated learner histories.
    const actorIds = [...new Set([actor.uid, actor.legacyStaffId].filter(Boolean))]
    const sessionSnapshots = await Promise.all(actorIds.map((actorId) => db.collection('sessions')
      .where('studentId', '==', subjectId)
      .where('trainerId', '==', actorId)
      .limit(1)
      .get()))
    if (sessionSnapshots.some((snapshot) => !snapshot.empty)) {
      return { actor, scope: 'trainer_scheduled_student' }
    }
    throw new HttpsError('permission-denied', 'Học viên không thuộc phạm vi được giao.')
  }

  throw new HttpsError('permission-denied', 'Bạn không có quyền xem lịch sử này.')
}

async function relatedEvents(db, sessionIds) {
  const attendanceBySession = new Map()
  const eventsBySession = new Map()
  for (let index = 0; index < sessionIds.length; index += 30) {
    const ids = sessionIds.slice(index, index + 30)
    if (!ids.length) continue
    const [attendance, events, attendanceAudits] = await Promise.all([
      db.collection('attendanceEvents').where('sessionId', 'in', ids).limit(500).get(),
      db.collection('sessionEvents').where('sessionId', 'in', ids).limit(500).get(),
      db.collection('attendanceAuditLogs').where('sessionId', 'in', ids).limit(500).get(),
    ])
    attendance.docs.forEach((item) => attendanceBySession.set(item.data().sessionId, { id: item.id, ...item.data() }))
    events.docs.forEach((item) => {
      const list = eventsBySession.get(item.data().sessionId) || []
      list.push({ id: item.id, ...item.data() })
      eventsBySession.set(item.data().sessionId, list)
    })
    attendanceAudits.docs.forEach((item) => {
      const value = item.data()
      const list = eventsBySession.get(value.sessionId) || []
      list.push({
        id: item.id,
        type: `attendance_${value.beforeStatus || 'pending'}_to_${value.afterStatus || 'unknown'}`,
        reason: value.note || value.noShowReason || '',
        createdAt: value.changedAt || value.createdAt,
      })
      eventsBySession.set(value.sessionId, list)
    })
  }
  return { attendanceBySession, eventsBySession }
}

async function namesForHistory(db, records, subjectType) {
  const counterpartIds = [...new Set(records.map((item) => subjectType === 'student' ? item.trainerId : item.studentId).filter(Boolean))]
  const collection = subjectType === 'student' ? 'trainers' : 'students'
  const snapshots = counterpartIds.length ? await db.getAll(...counterpartIds.slice(0, 100).map((id) => db.doc(`${collection}/${id}`))) : []
  return new Map(snapshots.filter((item) => item.exists).map((item) => {
    const value = item.data() || {}
    return [item.id, value.name || value.displayName || value.fullName || 'Đã xóa / Không xác định']
  }))
}

function sessionStatusSummary(records) {
  return records.reduce((summary, item) => {
    const status = typeof item.status === 'string' ? item.status : 'unknown'
    summary.total += 1
    summary.byStatus[status] = Number(summary.byStatus[status] || 0) + 1
    if (status === 'completed' || status === 'attended') summary.completed += 1
    if (status === 'no_show') summary.noShow += 1
    if (status.includes('cancelled')) summary.cancelled += 1
    return summary
  }, { total: 0, completed: 0, noShow: 0, cancelled: 0, byStatus: {} })
}

function historySessionHour(item = {}) {
  if (Number.isInteger(item.hour)) return item.hour
  const parsed = Number(String(item.id || '').split('-')[1])
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null
}

function teachingShiftSummary(records = []) {
  const shifts = new Map()
  records.forEach((item) => {
    const day = typeof item.date === 'string' ? item.date.slice(0, 10) : ''
    const hour = historySessionHour(item)
    const trainerId = typeof item.trainerId === 'string' ? item.trainerId : ''
    const key = day && hour !== null
      ? `${trainerId}|${day}|${hour}`
      : `unknown|${item.id || shifts.size}`
    const studentIds = shifts.get(key) || new Set()
    studentIds.add(item.studentId || item.id || `unknown-${studentIds.size}`)
    shifts.set(key, studentIds)
  })
  const groupSizes = [...shifts.values()].map((students) => students.size)
  return {
    totalShifts: shifts.size,
    pairedShifts: groupSizes.filter((size) => size >= 2).length,
    learnerBookings: records.length,
    maxLearnersPerShift: groupSizes.length ? Math.max(...groupSizes) : 0,
  }
}

async function studentContractUsage(db, access, studentId, requestedContractId = '') {
  const [contractSnapshot, sessionSnapshot] = await Promise.all([
    db.collection('contracts').where('studentId', '==', studentId).limit(101).get(),
    db.collection('sessions').where('studentId', '==', studentId).limit(MAX_USAGE_SESSIONS + 1).get(),
  ])
  if (contractSnapshot.size > 100) throw new HttpsError('resource-exhausted', 'Hồ sơ có quá nhiều hợp đồng để tổng hợp an toàn.')
  if (sessionSnapshot.size > MAX_USAGE_SESSIONS) {
    throw new HttpsError('resource-exhausted', 'Lịch sử vượt giới hạn tổng hợp. Hãy liên hệ Aura để chạy đối soát theo lô.')
  }
  let contracts = contractSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
  let sessions = canonicalHistoryRows(sessionSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
  if (access.scope === 'branch_manager') {
    contracts = contracts.filter((item) => access.actor.branchIds.includes(item.branchId))
    sessions = sessions.filter((item) => access.actor.branchIds.includes(item.branchId))
  }
  const scopedContractIds = new Set(contracts.map((item) => item.id))
  const selectedContracts = requestedContractId
    ? contracts.filter((item) => item.id === requestedContractId)
    : contracts
  if (requestedContractId && !selectedContracts.length) {
    throw new HttpsError('not-found', 'Không tìm thấy hợp đồng trong phạm vi được cấp.')
  }
  const selectedContractIds = new Set(selectedContracts.map((item) => item.id))
  const usageViews = await loadContractUsageViews(db, selectedContracts.map((item) => item.id))
  const sessionsByContract = new Map()
  sessions.forEach((session) => {
    if (!selectedContractIds.has(session.contractId)) return
    const list = sessionsByContract.get(session.contractId) || []
    list.push(session)
    sessionsByContract.set(session.contractId, list)
  })
  const summaries = selectedContracts
    .map((contract) => {
      const usage = canonicalUsageSummary(usageViews.get(contract.id), contract)
        || summarizeContractUsage(contract, sessionsByContract.get(contract.id) || [])
      return {
        contractId: contract.id,
        packageName: contract.packageName || 'Gói tập Aura',
        status: contract.status || 'active',
        startDate: typeof contract.startDate === 'string' ? contract.startDate.slice(0, 10) : '',
        endDate: typeof contract.endDate === 'string' ? contract.endDate.slice(0, 10) : '',
        ...usage,
        sourceVersion: usage.sourceVersion || USAGE_VIEW_SOURCE_VERSION,
      }
    })
    .sort((left, right) => right.startDate.localeCompare(left.startDate) || left.contractId.localeCompare(right.contractId))
  const unlinkedChargedSessions = sessions.filter((session) => sessionCountsTowardContract(session) && !scopedContractIds.has(session.contractId)).length
  return {
    schemaVersion: 1,
    studentId,
    formulaVersion: 'contract-usage-v2',
    summaries,
    dataQuality: {
      scannedContracts: contractSnapshot.size,
      scannedSessions: sessionSnapshot.size,
      unlinkedChargedSessions,
      requiresReview: summaries.filter((item) => item.reconciliationStatus !== 'matched').length,
    },
  }
}

function createBusinessReportingFunctions({ db, onCall }) {
  const readCall = (handler) => onCall({ cpu: 'gcf_gen1', concurrency: 1, maxInstances: 2, invoker: 'public' }, handler)
  const listBusinessPerformance = readCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    const canManageAll = actor.capabilities.includes('finance.operations.manage')
    const canManageBranch = actor.capabilities.includes('branch.finance.view')
    if (!canManageAll && !canManageBranch) throw new HttpsError('permission-denied', 'Bạn không có quyền xem báo cáo tài chính.')
    const input = normaliseBusinessRange(request.data || {})
    if (!canManageAll) {
      if (input.branchId === 'all' || !actor.branchIds.includes(input.branchId)) {
        throw new HttpsError('permission-denied', 'Hãy chọn chi nhánh nằm trong phạm vi được cấp.')
      }
    }
    const start = utcDateAtVietnamStart(input.startDate)
    const end = utcDateAtVietnamStart(input.nextEndDate)
    const scopedRange = (collection, field, maximum, direction = 'asc') => {
      let query = db.collection(collection).where(field, '>=', start).where(field, '<', end)
      // Apply scope before the limit: another branch's history must never
      // consume this branch's report budget. Missing branch IDs remain visible
      // only in the system report, matching the existing ledger/cash totals.
      if (input.branchId !== 'all') query = query.where('branchId', '==', input.branchId).orderBy(field, direction)
      return query.limit(maximum).get()
    }
    const [ledgerSnapshot, cashSnapshot, payrollSnapshot, attendanceSnapshot, cashAccountSnapshot] = await Promise.all([
      scopedRange('ledgerEntries', 'effectiveAt', MAX_LEDGER_DOCUMENTS + 1, 'desc'),
      scopedRange('cashTransactions', 'effectiveAt', MAX_LEDGER_DOCUMENTS + 1, 'desc'),
      // Legacy payroll with no branch is deliberately included by the existing
      // reconciliation policy. Do not silently drop it with an equality query.
      db.collection('payrollRuns').where('paidAt', '>=', start).where('paidAt', '<', end).limit(500).get(),
      scopedRange('attendanceEvents', 'occurredAt', MAX_ATTENDANCE_DOCUMENTS + 1),
      db.collection('cashAccounts').limit(201).get(),
    ])
    const ledgerEntries = ledgerSnapshot.docs.slice(0, MAX_LEDGER_DOCUMENTS).map((item) => ({ ...item.data(), id: item.id }))
    const summary = summaryFromLedger(ledgerEntries, input)
    const unlinkedCashTransactions = cashSnapshot.docs
      .map((item) => item.data())
      .filter((item) => !item.ledgerEntryId)
      .filter((item) => input.branchId === 'all' || item.branchId === input.branchId)
      .reduce((result, item) => result + number(item.amount), 0)
    const payrollPaidOutsideLedger = payrollSnapshot.docs
      .map((item) => item.data())
      .filter((item) => input.branchId === 'all' || !item.branchId || item.branchId === input.branchId)
      .filter((item) => !item.ledgerEntryId)
      .reduce((result, item) => result + Math.max(0, number(item.finalAmount)), 0)
    const recognisedSessionIds = new Set(ledgerEntries
      .filter((item) => item.type === 'revenue_recognition' && item.source === 'pt_gym' && item.status === 'posted')
      .map((item) => item.sessionId)
      .filter(Boolean))
    const attendanceSessionIds = new Set(attendanceSnapshot.docs
      .slice(0, MAX_ATTENDANCE_DOCUMENTS)
      .map((item) => item.data()?.sessionId)
      .filter(Boolean))
    const recognisedAttendanceEvents = [...attendanceSessionIds].filter((sessionId) => recognisedSessionIds.has(sessionId)).length
    const unrecognisedAttendanceEvents = Math.max(0, attendanceSessionIds.size - recognisedAttendanceEvents)
    const reconciliation = attendanceReconciliation(attendanceSnapshot.docs.slice(0, MAX_ATTENDANCE_DOCUMENTS)
      .map(item => ({ ...item.data(), id: item.id })), ledgerEntries)
    const qualityMessages = []
    if (reconciliation.unresolved || reconciliation.conflicts) qualityMessages.push(`${reconciliation.unresolved + reconciliation.conflicts} bằng chứng PT cần xác minh liên kết hoặc kỳ ghi nhận; chưa kết luận thiếu doanh thu`)
    if (reconciliation.automaticReview + reconciliation.billingReview + reconciliation.recognitionReview) qualityMessages.push('còn bằng chứng PT chờ xác nhận hoặc rà soát điều kiện ghi nhận')
    if (reconciliation.missingBranch) qualityMessages.push(`${reconciliation.missingBranch} bằng chứng chưa gắn chi nhánh`)
    if (cashAccountSnapshot.empty) qualityMessages.push('sổ quỹ chưa có tài khoản tiền mặt/ngân hàng/ví')
    if (unlinkedCashTransactions) qualityMessages.push('còn giao dịch sổ quỹ chưa liên kết ledger')
    if (payrollPaidOutsideLedger) qualityMessages.push('còn bảng lương đã trả ngoài ledger')
    if (ledgerSnapshot.size > MAX_LEDGER_DOCUMENTS || cashSnapshot.size > MAX_LEDGER_DOCUMENTS
      || attendanceSnapshot.size > MAX_ATTENDANCE_DOCUMENTS || payrollSnapshot.size >= 500) {
      qualityMessages.push('dữ liệu chạm giới hạn tải; số liệu có thể chưa đầy đủ, hãy thu hẹp khoảng ngày')
    }
    return {
      schemaVersion: 3,
      range: { startDate: input.startDate, endDate: input.endDate, timeZone: 'Asia/Ho_Chi_Minh' },
      branchId: input.branchId,
      source: input.source,
      managementPnl: {
        recognisedRevenue: summary.recognisedRevenue,
        operatingExpense: summary.operatingExpense,
        operatingResult: summary.operatingResult,
      },
      cashFlow: { cashIn: summary.cashIn, cashOut: summary.cashOut, cashNet: summary.cashNet },
      balanceMovement: {
        receivableMovement: summary.receivableMovement,
        deferredRevenueMovement: summary.deferredRevenueMovement,
      },
      sourceRows: summary.sourceRows,
      dailySeries: summary.dailySeries,
      dataQuality: {
        scannedLedgerEntries: ledgerSnapshot.size,
        ledgerTruncated: ledgerSnapshot.size > MAX_LEDGER_DOCUMENTS,
        cashTransactionsTruncated: cashSnapshot.size > MAX_LEDGER_DOCUMENTS,
        payrollLimitReached: payrollSnapshot.size >= 500,
        reconciliationBranchId: input.branchId,
        legacyUnclassifiedEntries: summary.legacyUnclassifiedEntries,
        unlinkedCashTransactions,
        payrollPaidOutsideLedger,
        reconciliation,
        attendanceEvents: attendanceSessionIds.size,
        recognisedAttendanceEvents,
        unrecognisedAttendanceEvents,
        attendanceTruncated: attendanceSnapshot.size > MAX_ATTENDANCE_DOCUMENTS,
        cashAccounts: cashAccountSnapshot.size,
        cashAccountsTruncated: cashAccountSnapshot.size > 200,
        cashAccountsReady: !cashAccountSnapshot.empty,
        missingSourceIntegrations: ['online_coaching', 'nutrition_coaching', 'academy'],
        message: qualityMessages.length
          ? `Cần đối soát: ${qualityMessages.join('; ')}. Aura không tự suy diễn số còn thiếu.`
          : 'Dữ liệu trong phạm vi đã đối chiếu giữa ledger, sổ quỹ, payroll và chấm công.',
      },
    }
  })

  async function listHistory(request, subjectType) {
    const subjectId = documentId(request.data?.[subjectType === 'student' ? 'studentId' : 'trainerId'], subjectType === 'student' ? 'Mã học viên' : 'Mã PT')
    const access = await assertHistoryAccess(request, db, subjectType, subjectId)
    const input = normaliseHistoryInput(request.data || {})
    const ownerField = subjectType === 'student' ? 'studentId' : 'trainerId'
    let query = db.collection('sessions').where(ownerField, '==', subjectId)
    if (!input.allTime) {
      query = query
        .where('date', '>=', input.startDate)
        .where('date', '<', followingDateKey(input.endDate))
    }
    // Status is evaluated after canonicalisation, as it is for totals. A
    // cancelled mirror must not reappear just because its attended source is
    // excluded by an early status predicate.
    query = query.orderBy('date', 'desc').orderBy(FieldPath.documentId(), 'desc')
    const historyCutoff = subjectType === 'student' && input.allTime ? vietnamDateKey(new Date()) : ''
    const historyPage = await readCanonicalHistoryPage({
      query, input, scope: historyCursorScope({ subjectType, subjectId, input, access }),
      canonicalize: subjectType === 'student' ? canonicalStudentHistoryRows : canonicalHistoryRows,
      accepts: item => (!historyCutoff || item.status !== 'scheduled' || String(item.date || '').slice(0, 10) < historyCutoff)
        && (access.scope !== 'branch_manager' || access.actor.branchIds.includes(item.branchId))
        && (input.status === 'all' || item.status === input.status),
    })
    const { snapshot, records: pageDocuments } = historyPage
    const sessionIds = pageDocuments.map((item) => item.id)
    const records = pageDocuments
    const [{ attendanceBySession, eventsBySession }, names] = await Promise.all([
      relatedEvents(db, sessionIds),
      namesForHistory(db, records, subjectType),
    ])
    let summary = null
    if (input.includeSummary) {
      let summaryQuery = db.collection('sessions').where(ownerField, '==', subjectId)
      if (!input.allTime) {
        summaryQuery = summaryQuery
          .where('date', '>=', input.startDate)
          .where('date', '<', followingDateKey(input.endDate))
      }
      const summaryLimit = input.allTime ? MAX_USAGE_SESSIONS + 1 : 5001
      summaryQuery = summaryQuery.limit(summaryLimit)
      // Only a complete date-bounded first page proves that the page and
      // summary queries are equivalent. All-time legacy rows can lack dates.
      const completeRangeInPage = !input.allTime && !input.cursor && historyPage.exhausted
      const summarySnapshot = completeRangeInPage ? snapshot : await summaryQuery.get()
      const summaryRows = summarySnapshot.docs.map((item) => ({ ...item.data(), id: item.id }))
      const summaryRecords = (subjectType === 'student'
        ? canonicalStudentHistoryRows(summaryRows)
        : canonicalHistoryRows(summaryRows))
        .filter((item) => !historyCutoff || item.status !== 'scheduled' || String(item.date || '').slice(0, 10) < historyCutoff)
        .filter((item) => (access.scope !== 'branch_manager' || access.actor.branchIds.includes(item.branchId)))
        .filter((item) => input.status === 'all' || item.status === input.status)
      summary = {
        ...sessionStatusSummary(summaryRecords),
        usage: summarizeSessionUsage(summaryRecords),
        teaching: subjectType === 'trainer' ? teachingShiftSummary(summaryRecords) : null,
        truncated: summarySnapshot.size >= summaryLimit,
      }
    }
    return {
      schemaVersion: 3,
      subjectType,
      subjectId,
      records: records.map((item) => {
        const counterpartId = subjectType === 'student' ? item.trainerId : item.studentId
        const attendance = attendanceBySession.get(item.id)
        const events = (eventsBySession.get(item.id) || []).sort((left, right) => timestampMillis(right.createdAt) - timestampMillis(left.createdAt))
        return {
          id: item.id,
          date: typeof item.date === 'string' ? item.date.slice(0, 10) : '',
          hour: Number.isInteger(item.hour) ? item.hour : Number(String(item.id).split('-')[1]) || null,
          status: item.status || 'unknown',
          studentId: item.studentId || '',
          trainerId: item.trainerId || '',
          branchId: item.branchId || '',
          contractId: item.contractId || '',
          counterpartId: counterpartId || '',
          counterpartName: names.get(counterpartId) || 'Đã xóa / Không xác định',
          billingStatus: typeof item.billingStatus === 'string'
            ? item.billingStatus
            : (attendance?.billingStatus || ''),
          countsTowardContract: sessionCountsTowardContract({
            ...item,
            billingStatus: typeof item.billingStatus === 'string'
              ? item.billingStatus
              : (attendance?.billingStatus || ''),
          }),
          isExempt: String(item.billingStatus || attendance?.billingStatus || '').trim().toLowerCase() === 'exempt',
          attendance: attendance ? {
            id: attendance.id,
            type: attendance.type || '',
            billingStatus: attendance.billingStatus || '',
            attendanceStatus: attendance.attendanceStatus || (attendance.type === 'attended' ? 'present' : ''),
            lateMinutes: Number(attendance.lateMinutes || 0) || null,
            noShowReason: attendance.noShowReason || '',
            occurredAt: timestampIso(attendance.occurredAt),
            createdAt: timestampIso(attendance.createdAt),
          } : null,
          events: events.slice(0, 8).map((event) => ({ id: event.id, type: event.type || '', reason: typeof event.reason === 'string' ? event.reason.slice(0, 300) : '', createdAt: timestampIso(event.createdAt) })),
          revision: Number(item.revision || 0),
        }
      }),
      summary,
      hasMore: historyPage.hasMore,
      nextCursor: historyPage.nextCursor,
      filters: { startDate: input.allTime ? '' : input.startDate, endDate: input.allTime ? '' : input.endDate, status: input.status, allTime: input.allTime },
    }
  }

  const listStudentTrainingHistory = readCall((request) => listHistory(request, 'student'))
  const listTrainerTeachingHistory = readCall((request) => listHistory(request, 'trainer'))
  const getStudentContractUsage = readCall(async (request) => {
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const contractId = typeof request.data?.contractId === 'string' && request.data.contractId.trim()
      ? documentId(request.data.contractId, 'Mã hợp đồng')
      : ''
    const access = await assertHistoryAccess(request, db, 'student', studentId)
    return studentContractUsage(db, access, studentId, contractId)
  })

  return { listBusinessPerformance, listStudentTrainingHistory, listTrainerTeachingHistory, getStudentContractUsage }
}

module.exports = {
  createBusinessReportingFunctions,
  normaliseBusinessRange,
  normaliseHistoryInput,
  canonicalHistoryRows,
  canonicalStudentHistoryRows,
  summaryFromLedger,
  teachingShiftSummary,
  studentContractUsage,
}
