'use strict'

const { createHash } = require('node:crypto')
const { FieldPath } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { createSharedDashboardCache } = require('./operations-dashboard-cache')
const { recordOperationMetrics } = require('./operation-metrics')
const { withFunctionTelemetry } = require('./observability')

const SUMMARY_LIMIT = 25_000
const SUMMARY_PAGE_SIZE = 500
const PAGE_SCAN_LIMIT = 200
const CONTRACT_FIELDS = ['studentId', 'branchId', 'packageName', 'totalPrice', 'discount', 'paidAmount', 'status', 'installments', 'nextPaymentDate', 'pausePeriods', 'frozenAt']
const DEBT_FILTERS = ['all', 'owing', 'settled', 'overdue', 'this-week', 'this-month', 'overpaid']
const RECEIVABLE_CATEGORIES = ['all', 'installments', 'frozen', 'debt']

function text(value, max = 200) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > max) throw new HttpsError('invalid-argument', 'Bộ lọc không hợp lệ.')
  return value.trim()
}
function id(value) {
  const result = text(value)
  if (result.includes('/')) throw new HttpsError('invalid-argument', 'Mã không hợp lệ.')
  return result
}
function searchKey(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim() }
function iso(value) { return value?.toDate?.().toISOString() || (typeof value === 'string' ? value : null) }
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function pageSize(value) {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 50)) throw new HttpsError('invalid-argument', 'Kích thước trang không hợp lệ.')
  return value || 20
}
function cursorAfter(value, scope) {
  if (!value) return ''
  try {
    const cursor = JSON.parse(Buffer.from(text(value, 2000), 'base64url').toString('utf8'))
    if (cursor.scope !== fingerprint(scope) || !cursor.after || !Number.isFinite(cursor.at) || Date.now() - cursor.at > 30 * 60_000 || cursor.at > Date.now() + 5000) throw new Error()
    return id(cursor.after)
  } catch { throw new HttpsError('invalid-argument', 'Trang đã hết hạn hoặc bộ lọc đã đổi. Hãy tải lại từ đầu.') }
}
function nextCursor(after, scope) { return Buffer.from(JSON.stringify({ after, scope: fingerprint(scope), at: Date.now() })).toString('base64url') }
function branchScope(actor, requested) {
  const branch = id(requested) || 'all'
  if (!['admin', 'super_admin'].includes(actor.accessRole) && (branch === 'all' || branch === 'none' || !actor.branchIds?.includes(branch))) {
    throw new HttpsError('permission-denied', 'Chi nhánh nằm ngoài phạm vi truy cập.')
  }
  return branch
}
function contractsQuery(db, branch) {
  // Legacy records can omit branchId. The unassigned filter is therefore
  // applied after reading; equality against null would silently exclude them.
  return branch === 'all' || branch === 'none' ? db.collection('contracts') : db.collection('contracts').where('branchId', '==', branch)
}
function inBranch(value, branch) { return branch !== 'none' || !value.branchId }
function dateKey(value) {
  const key = String(value || '').slice(0, 10)
  const millis = Date.parse(`${key}T12:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === key ? key : ''
}
function debtState(contract, today) {
  const rawAmounts = [contract.totalPrice, contract.discount ?? 0, contract.paidAmount]
  if (rawAmounts.some(value => !['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim()))) return null
  const amounts = rawAmounts.map(Number)
  if (amounts.some(value => !Number.isFinite(value) || value < 0)) return null
  const balance = amounts[0] - amounts[1] - amounts[2], debt = Math.max(0, balance)
  if (contract.installments != null && !Array.isArray(contract.installments)) return null
  const pending = (Array.isArray(contract.installments) ? contract.installments : [])
    .filter(item => item?.status === 'pending').sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)))
  if (pending.some(item => !dateKey(item.date)) || (contract.nextPaymentDate && !dateKey(contract.nextPaymentDate))) return null
  if (pending.some(item => !['number', 'string'].includes(typeof item.amount) || (typeof item.amount === 'string' && !item.amount.trim()) || !Number.isFinite(Number(item.amount)) || Number(item.amount) < 0)) return null
  if (contract.pausePeriods != null && !Array.isArray(contract.pausePeriods)) return null
  const preservation = (contract.pausePeriods || []).filter(item => item?.type === 'preservation')
  if (preservation.some(item => !dateKey(item.startDate) || !dateKey(item.endDate) || dateKey(item.startDate) > dateKey(item.endDate))) return null
  const preserved = contract.status === 'frozen' || preservation.some(item => dateKey(item.startDate) <= today && dateKey(item.endDate) >= today)
  const now = new Date(`${today}T12:00:00Z`), weekStart = new Date(now)
  weekStart.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7))
  const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekStart.getUTCDate() + 6)
  const monthStart = `${today.slice(0, 7)}-01`, monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
  const due = dateKey(pending[0]?.date || contract.nextPaymentDate)
  const amountIn = (start, end) => {
    if (!debt || preserved) return 0
    if (pending.length) return Math.min(debt, pending.filter(item => dateKey(item.date) >= start && dateKey(item.date) <= end).reduce((sum, item) => sum + Math.max(0, Number(item.amount)), 0))
    return due && due >= start && due <= end ? debt : 0
  }
  const overdueEnd = new Date(now); overdueEnd.setUTCDate(now.getUTCDate() - 1)
  const overdue = amountIn('0000-00-00', overdueEnd.toISOString().slice(0, 10)), thisMonth = amountIn(monthStart, monthEnd)
  const thisWeek = amountIn(weekStart.toISOString().slice(0, 10), weekEnd.toISOString().slice(0, 10))
  // Receivables remain the contract balance after cash payments/refunds. Posted
  // service recognition and its attribution corrections never alter this debt.
  const category = preserved ? 'frozen' : balance < 0 || !pending.length ? 'debt' : balance > 0 ? 'installments' : null
  return { balance, debt, overdue, thisMonth, preserved, category, groups: {
    all: debt > 0, owing: debt > 0, settled: balance === 0, overpaid: balance < 0, overdue: overdue > 0, 'this-month': thisMonth > 0,
    'this-week': thisWeek > 0,
  } }
}
function matchesReceivableGroup(state, category, filter) {
  // Invalid rows remain visible in the legacy all view. Category totals stay
  // explicitly unknown if any source row cannot be safely classified.
  if (!state) return category === 'all' && filter === 'all'
  if (category !== 'all' && state.category !== category) return false
  return category === 'frozen' && filter === 'all' ? true : state.groups[filter]
}
function summarizeReceivables(documents, today, branch, limit = SUMMARY_LIMIT, category = 'all') {
  if (documents.length > limit) return { complete: false, reason: 'limit', totals: null, counts: null }
  const totals = { debt: 0, overdue: 0, thisMonth: 0 }, counts = Object.fromEntries(DEBT_FILTERS.map(key => [key, 0]))
  for (const document of documents) {
    const contract = document.data()
    if (!inBranch(contract, branch)) continue
    const state = debtState(contract, today)
    if (!state) return { complete: false, reason: 'invalid-amount', totals: null, counts: null }
    if (category !== 'all' && state.category !== category) continue
    totals.debt += state.debt; totals.overdue += state.overdue; totals.thisMonth += state.thisMonth
    if (Object.values(totals).some(value => !Number.isFinite(value))) return { complete: false, reason: 'invalid-amount', totals: null, counts: null }
    for (const key of DEBT_FILTERS) if (matchesReceivableGroup(state, category, key)) counts[key]++
  }
  return { complete: true, totals, counts }
}

function summarizeAcademy(enrollments, progresses, limit = SUMMARY_LIMIT) {
  if (enrollments.length > limit || progresses.length > limit) return { complete: false, reason: 'limit', courses: [] }
  const rows = new Map(), members = new Set(), completion = new Map()
  for (const document of enrollments) {
    const value = document.data()
    if (!['active', 'completed'].includes(value.status) || !value.courseId || !value.userId) continue
    const row = rows.get(value.courseId) || { courseId: value.courseId, learners: 0, activeLearners: 0, completedLearners: 0, averageCompletion: 0, rating: null }
    row.learners++; row[value.status === 'active' ? 'activeLearners' : 'completedLearners']++
    rows.set(value.courseId, row); members.add(`${value.userId}\0${value.courseId}`)
  }
  for (const document of progresses) {
    const path = document.ref.path.split('/'), value = document.data(), courseId = value.courseId || document.id
    if (path.length !== 4 || path[0] !== 'users' || path[2] !== 'progress' || !members.has(`${path[1]}\0${courseId}`)) continue
    const percent = Number(value.percent ?? 0)
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return { complete: false, reason: 'invalid-progress', courses: [] }
    const values = completion.get(courseId) || []; values.push(percent); completion.set(courseId, values)
  }
  for (const row of rows.values()) {
    const values = completion.get(row.courseId) || []
    row.averageCompletion = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0
  }
  return { complete: true, courses: [...rows.values()] }
}

async function publicLabels(db, collection, ids, fields) {
  const unique = [...new Set(ids.filter(value => typeof value === 'string' && value && !value.includes('/') && value.length <= 200))]
  if (!unique.length) return []
  const records = await db.getAll(...unique.map(value => db.doc(`${collection}/${value}`)), { fieldMask: fields })
  recordOperationMetrics({ logicalQueries: 1, documentsReturned: records.filter(item => item.exists).length })
  return records.filter(item => item.exists).map(item => ({ id: item.id, ...item.data() }))
}

// Only summaries scan all rows. Pages remain bounded independently of report
// size, and a shared lease prevents concurrent clients repeating this scan.
async function scanSummarySource(query, limit = SUMMARY_LIMIT, read = query => query.get()) {
  const documents = []
  let after = null
  while (documents.length <= limit) {
    let page = query.orderBy(FieldPath.documentId())
    if (after) page = page.startAfter(after)
    const requested = Math.min(SUMMARY_PAGE_SIZE, limit + 1 - documents.length)
    const snapshot = await read(page.limit(requested))
    recordOperationMetrics({ logicalQueries: 1, documentsReturned: snapshot.size })
    documents.push(...snapshot.docs)
    if (snapshot.size < requested || documents.length > limit) break
    after = snapshot.docs.at(-1)
  }
  return documents
}

async function readSummarySnapshot(db, build) {
  let sourceReadTime = null
  const value = await db.runTransaction(transaction => build(async query => {
    const snapshot = await transaction.get(query)
    sourceReadTime ||= snapshot.readTime
    return snapshot
  }), { readOnly: true })
  if (!sourceReadTime?.toDate) throw new HttpsError('unavailable', 'Không thể xác minh phiên bản dữ liệu báo cáo. Vui lòng thử lại.')
  return { value, sourceReadTime }
}

function createScopedReportingReadFunctions({ db, onCall, logger = console, authorize = trustedAccessContext, sharedCache }) {
  const cache = sharedCache || createSharedDashboardCache({ db, logger, ttlMs: 3 * 60_000, buildLeaseMs: 120_000, coalesceRefresh: true })
  async function summary(key, refresh, build) {
    const acquired = await cache.acquire(key, refresh)
    if (acquired.cached) {
      recordOperationMetrics({ cacheHit: true, projectionAgeMs: Math.max(0, Date.now() - Date.parse(acquired.cached.asOf)) })
      return acquired.cached
    }
    try {
      const built = await build()
      const value = { ...built.value, asOf: built.sourceReadTime.toDate().toISOString() }
      const published = await cache.publish(key, value, acquired.lease, { sourceReadTime: built.sourceReadTime })
      if (published === false) throw new HttpsError('unavailable', 'Báo cáo đã thay đổi trong lúc cập nhật. Hãy tải lại để lấy kết quả mới nhất.')
      recordOperationMetrics({ cacheHit: false, projectionAgeMs: Math.max(0, Date.now() - Date.parse(value.asOf)) })
      return value
    } finally { await cache.release(key, acquired.lease) }
  }
  async function academyActor(request) {
    const actor = await authorize(request, db)
    // Match the existing all-enrollments/progress Firestore rule. A manager's
    // UI permission must not become permission to read all learner identities.
    if (!['admin', 'super_admin'].includes(actor.accessRole)) throw new HttpsError('permission-denied', 'Bạn chưa có quyền xem toàn bộ Academy.')
    return actor
  }
  async function financeActor(request) {
    const actor = await authorize(request, db)
    requireCapability(actor, 'finance.operations.manage')
    // Keep the existing finance UI/Firestore boundary. A newly granted staff
    // capability alone must not allow arbitrary student identifiers to be read.
    if (!['admin', 'super_admin'].includes(actor.accessRole)) throw new HttpsError('permission-denied', 'Bạn chưa có quyền xem báo cáo tài chính.')
    return actor
  }
  const getAcademyAnalyticsSummary = onCall(withFunctionTelemetry('getAcademyAnalyticsSummary', async request => {
    await academyActor(request)
    return summary('academy-summary-v1', request.data?.refresh === true, () => readSummarySnapshot(db, async read => {
      // A single read-only transaction gives every page and source the same
      // snapshot, even when a learner completes a chapter during the scan.
      const [enrollments, progresses] = await Promise.all([
        scanSummarySource(db.collection('enrollments').select('userId', 'courseId', 'status'), SUMMARY_LIMIT, read),
        scanSummarySource(db.collectionGroup('progress').select('courseId', 'percent'), SUMMARY_LIMIT, read),
      ])
      return { ...summarizeAcademy(enrollments, progresses), source: 'enrollments+progress', sourceDocuments: enrollments.length + progresses.length }
    }))
  }))
  const listAcademyEnrollmentsPage = onCall(withFunctionTelemetry('listAcademyEnrollmentsPage', async request => {
    const actor = await academyActor(request), input = request.data || {}, size = pageSize(input.pageSize)
    const scope = ['academy-enrollment-v1', actor.uid, actor.authzVersion], after = cursorAfter(input.cursor, scope)
    let query = db.collection('enrollments').orderBy(FieldPath.documentId()).select('userId', 'courseId', 'status', 'enrolledAt', 'updatedAt')
    if (after) query = query.startAfter(after)
    const snapshot = await query.limit(size + 1).get(), documents = snapshot.docs.slice(0, size)
    recordOperationMetrics({ logicalQueries: 1, documentsReturned: snapshot.size })
    const enrollments = documents.map(item => ({ id: item.id, ...item.data(), enrolledAt: iso(item.data().enrolledAt), updatedAt: iso(item.data().updatedAt) }))
    const labels = await publicLabels(db, 'users', enrollments.map(item => item.userId), ['displayName', 'email', 'role', 'membership', 'disabled'])
    return { enrollments, users: labels.map(({ id: uid, disabled, ...value }) => ({ ...value, uid, status: disabled ? 'disabled' : 'active' })),
      hasMore: snapshot.size > size, nextCursor: snapshot.size > size ? nextCursor(documents.at(-1).id, scope) : null, asOf: new Date().toISOString() }
  }))
  const listFinanceReceivables = onCall(withFunctionTelemetry('listFinanceReceivables', async request => {
    const actor = await financeActor(request)
    const input = request.data || {}, branch = branchScope(actor, input.branchId), size = pageSize(input.pageSize), filter = text(input.filter) || 'all', category = text(input.category) || 'all'
    if (!DEBT_FILTERS.includes(filter)) throw new HttpsError('invalid-argument', 'Nhóm công nợ không hợp lệ.')
    if (!RECEIVABLE_CATEGORIES.includes(category)) throw new HttpsError('invalid-argument', 'Loại hợp đồng không hợp lệ.')
    const today = text(input.today, 10) || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(Date.parse(`${today}T12:00:00Z`)) || new Date(`${today}T12:00:00Z`).toISOString().slice(0, 10) !== today) throw new HttpsError('invalid-argument', 'Ngày báo cáo không hợp lệ.')
    const search = searchKey(text(input.search, 120)), scope = ['finance-receivables-v2', actor.uid, actor.authzVersion, branch, today, category, filter, search]
    const after = cursorAfter(input.cursor, scope), rows = [], labels = new Map()
    let lastId = after, scanned = 0, hasMore = true
    while (rows.length < size && scanned < PAGE_SCAN_LIMIT && hasMore) {
      let query = contractsQuery(db, branch).orderBy(FieldPath.documentId()).select(...CONTRACT_FIELDS)
      if (lastId) query = query.startAfter(lastId)
      const batchSize = Math.min(search ? 50 : size - rows.length, PAGE_SCAN_LIMIT - scanned)
      const snapshot = await query.limit(batchSize).get()
      recordOperationMetrics({ logicalQueries: 1, documentsReturned: snapshot.size })
      if (snapshot.empty) { hasMore = false; break }
      const states = new Map(snapshot.docs.map(item => [item.id, debtState(item.data(), today)]))
      const candidates = snapshot.docs.filter(item => inBranch(item.data(), branch) && matchesReceivableGroup(states.get(item.id), category, filter))
      const students = await publicLabels(db, 'students', candidates.map(item => item.data().studentId), ['name', 'phone', 'email'])
      students.forEach(item => labels.set(item.id, item))
      for (const document of snapshot.docs) {
        scanned++; lastId = document.id
        const contract = { id: document.id, ...document.data() }, state = states.get(document.id)
        if (!inBranch(contract, branch) || !matchesReceivableGroup(state, category, filter)) continue
        const student = labels.get(contract.studentId)
        if (search && !searchKey([student?.name, student?.phone, student?.email, contract.packageName, contract.id].join(' ')).includes(search)) continue
        rows.push({ ...contract, dataIssue: state ? null : 'invalid-amount' })
        if (rows.length >= size) break
      }
      hasMore = lastId !== snapshot.docs.at(-1).id || snapshot.size === batchSize
    }
    let report = null
    if (input.includeSummary !== false) {
      report = await summary(`receivables-v2-${fingerprint([branch, today, category])}`, input.refresh === true, () => readSummarySnapshot(db, async read => {
        const documents = await scanSummarySource(contractsQuery(db, branch).select(...CONTRACT_FIELDS), SUMMARY_LIMIT, read)
        return { ...summarizeReceivables(documents, today, branch, SUMMARY_LIMIT, category), source: 'contracts', sourceDocuments: documents.length }
      }))
    }
    const visibleIds = new Set(rows.map(item => item.studentId))
    return { contracts: rows, students: [...labels.values()].filter(item => visibleIds.has(item.id)), summary: report,
      hasMore, nextCursor: hasMore && lastId ? nextCursor(lastId, scope) : null, asOf: new Date().toISOString(), scanned }
  }))
  const listFinanceStudentLabels = onCall(withFunctionTelemetry('listFinanceStudentLabels', async request => {
    await financeActor(request)
    const ids = request.data?.studentIds
    if (!Array.isArray(ids) || ids.length > 50 || ids.some(value => typeof value !== 'string' || !id(value))) throw new HttpsError('invalid-argument', 'Chỉ tải tối đa 50 học viên mỗi lượt.')
    const students = await publicLabels(db, 'students', ids.map(value => id(value)), ['name', 'phone', 'email'])
    return { students }
  }))
  return { getAcademyAnalyticsSummary, listAcademyEnrollmentsPage, listFinanceReceivables, listFinanceStudentLabels }
}

module.exports = { createScopedReportingReadFunctions, summarizeAcademy, summarizeReceivables, debtState, branchScope, cursorAfter, nextCursor, scanSummarySource, SUMMARY_LIMIT, SUMMARY_PAGE_SIZE, PAGE_SCAN_LIMIT }
