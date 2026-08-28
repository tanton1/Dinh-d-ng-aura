const { FieldPath, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { sessionCountsTowardContract, summarizeSessionUsage, summarizeContractUsage } = require('./contract-usage')

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
  if (Number.isFinite(Number(entry.expenseImpact))) return Math.abs(Number(entry.expenseImpact))
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

function encodeCursor(document) {
  return Buffer.from(JSON.stringify({ date: String(document.data().date || '').slice(0, 10), id: document.id }), 'utf8').toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    return { date: dateKey(parsed.date, 'Con trỏ lịch sử'), id: documentId(parsed.id, 'Con trỏ lịch sử') }
  } catch {
    throw new HttpsError('invalid-argument', 'Con trỏ lịch sử không hợp lệ.')
  }
}

function normaliseHistoryInput(data = {}) {
  const startDate = dateKey(data.startDate || '2020-01-01', 'Ngày bắt đầu')
  const endDate = dateKey(data.endDate || vietnamDateKey(new Date()), 'Ngày kết thúc')
  if (startDate > endDate) throw new HttpsError('invalid-argument', 'Khoảng ngày lịch sử không hợp lệ.')
  const rangeDays = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1
  if (rangeDays > MAX_RANGE_DAYS) throw new HttpsError('invalid-argument', `Khoảng ngày tối đa ${MAX_RANGE_DAYS} ngày.`)
  const status = typeof data.status === 'string' && data.status.trim() ? data.status.trim() : 'all'
  if (status !== 'all' && !validHistoryStatuses.has(status)) throw new HttpsError('invalid-argument', 'Trạng thái buổi tập không hợp lệ.')
  const pageSize = Math.min(MAX_HISTORY_PAGE, Math.max(1, Number.isInteger(data.pageSize) ? data.pageSize : DEFAULT_HISTORY_PAGE))
  return { startDate, endDate, status, pageSize, cursor: decodeCursor(data.cursor) }
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
    if (!contracts.docs.some((item) => matchesAssignment(item.data(), actor))) {
      throw new HttpsError('permission-denied', 'Học viên không thuộc phạm vi được giao.')
    }
    return { actor, scope: 'trainer_assigned_student' }
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
  let sessions = sessionSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
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
  const sessionsByContract = new Map()
  sessions.forEach((session) => {
    if (!selectedContractIds.has(session.contractId)) return
    const list = sessionsByContract.get(session.contractId) || []
    list.push(session)
    sessionsByContract.set(session.contractId, list)
  })
  const summaries = selectedContracts
    .map((contract) => ({
      contractId: contract.id,
      packageName: contract.packageName || 'Gói tập Aura',
      status: contract.status || 'active',
      startDate: typeof contract.startDate === 'string' ? contract.startDate.slice(0, 10) : '',
      endDate: typeof contract.endDate === 'string' ? contract.endDate.slice(0, 10) : '',
      ...summarizeContractUsage(contract, sessionsByContract.get(contract.id) || []),
    }))
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
  const listBusinessPerformance = onCall(async (request) => {
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
    const [ledgerSnapshot, cashSnapshot, payrollSnapshot, attendanceSnapshot, cashAccountSnapshot] = await Promise.all([
      db.collection('ledgerEntries').where('effectiveAt', '>=', start).where('effectiveAt', '<', end).limit(MAX_LEDGER_DOCUMENTS + 1).get(),
      db.collection('cashTransactions').where('effectiveAt', '>=', start).where('effectiveAt', '<', end).limit(MAX_LEDGER_DOCUMENTS + 1).get(),
      db.collection('payrollRuns').where('paidAt', '>=', start).where('paidAt', '<', end).limit(500).get(),
      db.collection('attendanceEvents').where('occurredAt', '>=', start).where('occurredAt', '<', end).limit(MAX_ATTENDANCE_DOCUMENTS + 1).get(),
      db.collection('cashAccounts').limit(201).get(),
    ])
    const ledgerEntries = ledgerSnapshot.docs.slice(0, MAX_LEDGER_DOCUMENTS).map((item) => item.data())
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
    const qualityMessages = []
    if (unrecognisedAttendanceEvents) qualityMessages.push(`${unrecognisedAttendanceEvents.toLocaleString('vi-VN')} buổi đã chấm công chưa có bút toán doanh thu thực hiện`)
    if (cashAccountSnapshot.empty) qualityMessages.push('sổ quỹ chưa có tài khoản tiền mặt/ngân hàng/ví')
    if (unlinkedCashTransactions) qualityMessages.push('còn giao dịch sổ quỹ chưa liên kết ledger')
    if (payrollPaidOutsideLedger) qualityMessages.push('còn bảng lương đã trả ngoài ledger')
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
        legacyUnclassifiedEntries: summary.legacyUnclassifiedEntries,
        unlinkedCashTransactions,
        payrollPaidOutsideLedger,
        attendanceEvents: attendanceSessionIds.size,
        recognisedAttendanceEvents,
        unrecognisedAttendanceEvents,
        attendanceTruncated: attendanceSnapshot.size > MAX_ATTENDANCE_DOCUMENTS,
        cashAccounts: cashAccountSnapshot.size,
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
    let query = db.collection('sessions')
      .where(ownerField, '==', subjectId)
      .where('date', '>=', input.startDate)
      .where('date', '<', followingDateKey(input.endDate))
    if (input.status !== 'all') query = query.where('status', '==', input.status)
    query = query.orderBy('date', 'desc').orderBy(FieldPath.documentId(), 'desc')
    if (input.cursor) query = query.startAfter(input.cursor.date, input.cursor.id)
    const snapshot = await query.limit(input.pageSize + 1).get()
    const scannedPageDocuments = snapshot.docs.slice(0, input.pageSize)
    const pageDocuments = scannedPageDocuments
      .filter((item) => access.scope !== 'branch_manager' || access.actor.branchIds.includes(item.data().branchId))
    const sessionIds = pageDocuments.map((item) => item.id)
    const records = pageDocuments.map((item) => ({ id: item.id, ...item.data() }))
    const [{ attendanceBySession, eventsBySession }, names] = await Promise.all([
      relatedEvents(db, sessionIds),
      namesForHistory(db, records, subjectType),
    ])
    const summaryQuery = db.collection('sessions')
      .where(ownerField, '==', subjectId)
      .where('date', '>=', input.startDate)
      .where('date', '<', followingDateKey(input.endDate))
      .limit(5001)
    const summarySnapshot = await summaryQuery.get()
    const summaryRecords = summarySnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => (access.scope !== 'branch_manager' || access.actor.branchIds.includes(item.branchId)))
      .filter((item) => input.status === 'all' || item.status === input.status)
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
      summary: {
        ...sessionStatusSummary(summaryRecords),
        usage: summarizeSessionUsage(summaryRecords),
        teaching: subjectType === 'trainer' ? teachingShiftSummary(summaryRecords) : null,
        truncated: summarySnapshot.size > 5000,
      },
      hasMore: snapshot.size > input.pageSize,
      nextCursor: snapshot.size > input.pageSize && scannedPageDocuments.length ? encodeCursor(scannedPageDocuments[scannedPageDocuments.length - 1]) : null,
      filters: { startDate: input.startDate, endDate: input.endDate, status: input.status },
    }
  }

  const listStudentTrainingHistory = onCall((request) => listHistory(request, 'student'))
  const listTrainerTeachingHistory = onCall((request) => listHistory(request, 'trainer'))
  const getStudentContractUsage = onCall(async (request) => {
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
  summaryFromLedger,
  teachingShiftSummary,
  studentContractUsage,
}
