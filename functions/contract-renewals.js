const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { cashAccountForMovement, createCashMovement, assertFinancePeriodOpen } = require('./finance-ledger')

const renewalStages = new Set(['uncontacted', 'contacted', 'interested', 'quote_sent', 'follow_up', 'won', 'lost'])
const closedStages = new Set(['won', 'lost'])
const renewalSegments = new Set(['expiring_30d', 'exhausted_active', 'expired_last_30d', 'in_care'])
const careStages = new Set(['contacted', 'interested', 'quote_sent', 'follow_up'])
const activeContractStatuses = new Set(['active', 'future', 'frozen', 'expired'])
const activityTypes = new Set(['call', 'zalo', 'meeting', 'note', 'stage_change'])
const activityOutcomes = new Set(['connected', 'no_answer', 'interested', 'not_interested', 'callback', 'quote_requested', 'other'])
const probabilityByStage = { uncontacted: 0.1, contacted: 0.25, interested: 0.5, quote_sent: 0.7, follow_up: 0.8, won: 1, lost: 0 }
const maximumContracts = 5000
const maximumCases = 5000
const approvalDiscountRate = 0.1
const approvalCarryOverSessions = 3
const renewalMessageTemplates = Object.freeze([
  {
    id: 'expiring_intro', name: 'Sắp hết hạn · Mở đầu', channel: 'zalo', category: 'first_contact',
    recommendedSegments: ['expiring_30d'], recommendedStages: ['uncontacted'],
    body: 'Aura Fitness xin chào {{studentName}}. Gói {{packageName}} của bạn còn {{daysLeft}} ngày và {{sessionsLeft}} buổi. Aura muốn cùng bạn chuẩn bị lộ trình tiếp theo để việc tập luyện không bị gián đoạn. Bạn thuận tiện để {{staffName}} tư vấn vào thời gian nào?',
  },
  {
    id: 'exhausted_sessions', name: 'Hết buổi · Nối tiếp lộ trình', channel: 'zalo', category: 'first_contact',
    recommendedSegments: ['exhausted_active'], recommendedStages: ['uncontacted', 'contacted'],
    body: 'Chào {{studentName}}, gói {{packageName}} của bạn đã hoàn thành đủ số buổi nhưng vẫn còn thời hạn đến {{endDate}}. Aura đề xuất mình trao đổi sớm về gói nối tiếp để giữ nhịp tập và mục tiêu hiện tại. Khi nào bạn tiện để {{staffName}} liên hệ?',
  },
  {
    id: 'recently_expired', name: 'Vừa hết hạn · Kết nối lại', channel: 'zalo', category: 'win_back',
    recommendedSegments: ['expired_last_30d'], recommendedStages: ['uncontacted', 'contacted'],
    body: 'Aura Fitness chào {{studentName}}. Gói {{packageName}} của bạn vừa kết thúc ngày {{endDate}}. Aura rất mong được tiếp tục đồng hành và đã chuẩn bị một số phương án phù hợp với lịch tập hiện tại của bạn. Bạn muốn Aura gửi thông tin tham khảo ngay tại đây không?',
  },
  {
    id: 'no_answer_follow_up', name: 'Không nghe máy · Xin lịch hẹn', channel: 'zalo', category: 'follow_up',
    recommendedSegments: ['in_care'], recommendedStages: ['contacted', 'follow_up'],
    body: 'Chào {{studentName}}, {{staffName}} từ Aura Fitness vừa liên hệ nhưng chưa gặp được bạn. Mình muốn trao đổi ngắn về lộ trình tiếp theo của gói {{packageName}}. Bạn cho Aura xin khung giờ thuận tiện để gọi lại nhé.',
  },
  {
    id: 'quote_sent_follow_up', name: 'Đã gửi báo giá · Nhắc nhẹ', channel: 'zalo', category: 'quote',
    recommendedSegments: ['in_care'], recommendedStages: ['quote_sent', 'follow_up'],
    body: 'Chào {{studentName}}, Aura đã gửi phương án tái ký cho gói {{packageName}}. Bạn đã xem qua chưa ạ? Nếu cần điều chỉnh lịch, số buổi hoặc phương án thanh toán, {{staffName}} sẽ hỗ trợ ngay.',
  },
  {
    id: 'appointment_confirm', name: 'Xác nhận lịch tư vấn', channel: 'zalo', category: 'appointment',
    recommendedSegments: ['in_care'], recommendedStages: ['interested', 'follow_up'],
    body: 'Aura xác nhận lịch trao đổi cùng {{studentName}} về lộ trình {{packageName}} vào {{nextActionDate}}. Nếu cần đổi thời gian, bạn nhắn lại để {{staffName}} hỗ trợ nhé.',
  },
  {
    id: 'renewal_thank_you', name: 'Tái ký thành công · Cảm ơn', channel: 'zalo', category: 'success',
    recommendedSegments: [], recommendedStages: ['won'],
    body: 'Cảm ơn {{studentName}} đã tiếp tục đồng hành cùng Aura Fitness. Đội ngũ Aura sẽ phối hợp để lộ trình mới được bắt đầu thuận lợi và sát mục tiêu của bạn. Chúc bạn luôn giữ nhịp tập thật tốt!',
  },
  {
    id: 'lost_feedback', name: 'Chưa tái ký · Xin phản hồi', channel: 'zalo', category: 'feedback',
    recommendedSegments: [], recommendedStages: ['lost'],
    body: 'Aura cảm ơn {{studentName}} đã đồng hành trong thời gian qua. Nếu thuận tiện, bạn có thể chia sẻ ngắn lý do chưa tiếp tục gói tập để Aura cải thiện dịch vụ tốt hơn. Mọi phản hồi của bạn đều được trân trọng.',
  },
])

function requiresRenewalApproval(discount, originalPrice, carryOverSessions) {
  return Number(originalPrice || 0) > 0 && Number(discount || 0) / Number(originalPrice) > approvalDiscountRate
    || Number(carryOverSessions || 0) > approvalCarryOverSessions
}

function boundedString(value, label, maximum, required = true) {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > maximum) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function documentId(value, label) {
  const result = boundedString(value, label, 200)
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function dateKey(value, label = 'Ngày') {
  const result = boundedString(value, label, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function optionalDateKey(value, label = 'Ngày') {
  return value === null || value === undefined || value === '' ? null : dateKey(value, label)
}

function safeMoney(value, label, allowZero = true) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1) || number > 10_000_000_000) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return number
}

function safeInteger(value, label, minimum, maximum) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return number
}

function vietnamDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function dateOrdinal(value) {
  const [year, month, day] = String(value).split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

function addDaysDateKey(value, days) {
  const [year, month, day] = dateKey(value).split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

function addMonthsDateKey(value, months) {
  const source = dateKey(value, 'Ngày bắt đầu')
  const duration = safeInteger(months, 'Thời hạn gói', 1, 60)
  const [year, month, day] = source.split('-').map(Number)
  const targetMonthIndex = month - 1 + duration
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const result = new Date(value || 0).getTime()
  return Number.isFinite(result) ? result : 0
}

function serializeTimestamp(value) {
  const millis = timestampMillis(value)
  return millis ? new Date(millis).toISOString() : null
}

function normalizeInstallments(value, remainingAmount, startDate, endDate) {
  if (!remainingAmount) return []
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new HttpsError('invalid-argument', 'Cần lịch thanh toán cho phần công nợ còn lại.')
  const installments = value.map((item, index) => {
    const date = dateKey(item?.date, `Ngày thanh toán kỳ ${index + 1}`)
    if (date < startDate || date > endDate) throw new HttpsError('invalid-argument', 'Ngày trả góp phải nằm trong thời hạn hợp đồng mới.')
    return { id: boundedString(item?.id || `installment-${index + 1}`, `Mã kỳ ${index + 1}`, 100), date, amount: safeMoney(item?.amount, `Số tiền kỳ ${index + 1}`, false), status: 'pending' }
  })
  if (installments.reduce((sum, item) => sum + item.amount, 0) !== remainingAmount) throw new HttpsError('invalid-argument', 'Tổng lịch trả góp không khớp công nợ còn lại.')
  return installments.sort((left, right) => left.date.localeCompare(right.date))
}

function renewalRisk(contract, today = vietnamDateKey()) {
  const totalSessions = Math.max(0, Number(contract.totalSessions || 0))
  const usedSessions = Math.max(0, Number(contract.usedSessions || 0))
  const sessionsLeft = Math.max(0, totalSessions - usedSessions)
  const daysLeft = dateOrdinal(contract.endDate) - dateOrdinal(today)
  if (sessionsLeft <= 0 && daysLeft >= 0) return { category: 'exhausted', daysLeft, sessionsLeft }
  if (daysLeft < 0 || contract.status === 'expired') return { category: 'expired', daysLeft, sessionsLeft }
  if (daysLeft <= 7 || sessionsLeft <= 1) return { category: 'critical', daysLeft, sessionsLeft }
  if (daysLeft <= 30 || sessionsLeft <= 3) return { category: 'upcoming', daysLeft, sessionsLeft }
  if (daysLeft <= 60 || sessionsLeft <= 5) return { category: 'early', daysLeft, sessionsLeft }
  return { category: 'healthy', daysLeft, sessionsLeft }
}

function latestContractsByStudent(contracts) {
  const result = new Map()
  for (const contract of contracts) {
    if (!contract.studentId || contract.status === 'cancelled') continue
    const current = result.get(contract.studentId)
    if (!current || String(contract.endDate || '').localeCompare(String(current.endDate || '')) > 0
      || (contract.endDate === current.endDate && String(contract.startDate || '').localeCompare(String(current.startDate || '')) > 0)) result.set(contract.studentId, contract)
  }
  return result
}

function riskSlaDays(category) {
  if (category === 'expired' || category === 'exhausted') return 0
  if (category === 'critical') return 1
  if (category === 'upcoming') return 3
  return 7
}

function priorityScore(risk, slaDueAt, today = vietnamDateKey()) {
  const base = { expired: 1000, exhausted: 950, critical: 800, upcoming: 500, early: 250 }[risk.category] || 0
  const slaBoost = slaDueAt < today ? 220 : slaDueAt === today ? 120 : 0
  return base + slaBoost + Math.max(0, Math.min(90, 60 - risk.daysLeft))
}

function slaStatus(value, today = vietnamDateKey()) {
  if (closedStages.has(value.stage)) return 'done'
  const due = value.nextActionAt || value.slaDueAt
  if (!due) return 'upcoming'
  if (due < today) return 'overdue'
  if (due === today) return 'due_today'
  return 'upcoming'
}

function hasCapability(actor, capability) {
  return Array.isArray(actor.capabilities) && actor.capabilities.includes(capability)
}

async function renewalActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'renewals.workspace.view')
  if (hasCapability(actor, 'renewals.system.manage')) return { ...actor, renewalScope: 'system' }
  if (hasCapability(actor, 'renewals.branch.manage')) return { ...actor, renewalScope: 'branch' }
  if (hasCapability(actor, 'renewals.case.self.manage')) return { ...actor, renewalScope: 'self' }
  throw new HttpsError('permission-denied', 'Bạn chưa được cấp phạm vi vận hành tái ký.')
}

function canViewCase(actor, value) {
  if (actor.renewalScope === 'system') return true
  if (actor.renewalScope === 'branch') return actor.branchIds.includes(value.branchId)
  return value.assignedSalesId === actor.uid
}

function assertCaseScope(actor, value) {
  if (!canViewCase(actor, value)) throw new HttpsError('permission-denied', 'Hồ sơ tái ký nằm ngoài phạm vi được giao.')
}

function canApproveCase(actor, value) {
  return hasCapability(actor, 'renewals.approval.manage') && (actor.renewalScope === 'system' || actor.branchIds.includes(value.branchId))
}

function caseSort(left, right) {
  return Number(right.priorityScore || 0) - Number(left.priorityScore || 0)
    || String(left.nextActionAt || left.slaDueAt || '9999').localeCompare(String(right.nextActionAt || right.slaDueAt || '9999'))
    || String(left.id).localeCompare(String(right.id))
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify({ id: value.id })).toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (!parsed.id) throw new Error('invalid')
    return parsed
  } catch {
    throw new HttpsError('invalid-argument', 'Con trỏ phân trang không hợp lệ.')
  }
}

function publicCase(value) {
  const stage = renewalStages.has(value.stage) ? value.stage : 'uncontacted'
  const student = value.studentSnapshot || { id: value.studentId || '', name: 'Chưa cập nhật tên', phone: '', email: '' }
  const contract = value.contractSnapshot || {}
  return {
    id: value.id, caseId: value.id, schemaVersion: 2, sourceContractId: value.sourceContractId || value.id,
    student, contract, branchId: value.branchId || '', branchName: value.branchName || 'Chưa phân chi nhánh',
    assignedSalesId: value.assignedSalesId || '', assignedSalesName: value.assignedSalesName || 'Chưa phân công',
    stage, probability: Number(value.probability ?? probabilityByStage[stage]),
    risk: { category: value.riskCategory || 'early', daysLeft: Number(value.daysLeft || 0), sessionsLeft: Number(value.sessionsLeft || 0) },
    expectedValue: Number(value.expectedValue || 0), priorityScore: Number(value.priorityScore || 0),
    slaDueAt: value.slaDueAt || null, slaStatus: slaStatus(value), nextActionAt: value.nextActionAt || null,
    nextFollowUpAt: value.nextActionAt || null, lastContactAt: serializeTimestamp(value.lastContactAt),
    note: typeof value.note === 'string' ? value.note.slice(0, 500) : '', quoteId: value.quoteId || null,
    approvalId: value.approvalId || null, renewedContractId: value.renewedContractId || null,
    approvalStatus: value.approvalStatus || null,
    lostReason: value.lostReason || null, revision: Number(value.revision || 0), caseRevision: Number(value.revision || 0),
    active: value.active !== false,
  }
}

async function scopedCaseDocuments(db, actor, includeClosed = false) {
  const snapshots = []
  if (actor.renewalScope === 'system') snapshots.push(await db.collection('contractRenewalCases').limit(maximumCases + 1).get())
  else if (actor.renewalScope === 'self') snapshots.push(await db.collection('contractRenewalCases').where('assignedSalesId', '==', actor.uid).limit(maximumCases + 1).get())
  else for (const branchId of actor.branchIds.slice(0, 20)) snapshots.push(await db.collection('contractRenewalCases').where('branchId', '==', branchId).limit(maximumCases + 1).get())
  const documents = new Map()
  snapshots.forEach((snapshot) => snapshot.docs.forEach((item) => {
    const value = { id: item.id, ...item.data() }
    if (canViewCase(actor, value) && (includeClosed || value.active !== false)) documents.set(item.id, value)
  }))
  return { documents: [...documents.values()], truncated: snapshots.some((item) => item.size > maximumCases) }
}

function listInput(value = {}) {
  const allowedRisks = new Set(['expired', 'exhausted', 'critical', 'upcoming', 'early'])
  const allowedSla = new Set(['overdue', 'due_today', 'upcoming', 'done'])
  const allowedApproval = new Set(['pending', 'approved', 'rejected', 'consumed', 'none'])
  const stage = value.stage && value.stage !== 'all' ? boundedString(value.stage, 'Giai đoạn', 30) : ''
  const risk = value.risk && value.risk !== 'all' ? boundedString(value.risk, 'Mức cảnh báo', 30) : ''
  const sla = value.sla && value.sla !== 'all' ? boundedString(value.sla, 'SLA', 30) : ''
  const approval = value.approval && value.approval !== 'all' ? boundedString(value.approval, 'Trạng thái phê duyệt', 30) : ''
  const segment = value.segment && value.segment !== 'all' ? boundedString(value.segment, 'Nhóm tái ký', 30) : ''
  if (stage && !renewalStages.has(stage)) throw new HttpsError('invalid-argument', 'Giai đoạn không hợp lệ.')
  if (risk && !allowedRisks.has(risk)) throw new HttpsError('invalid-argument', 'Mức cảnh báo không hợp lệ.')
  if (sla && !allowedSla.has(sla)) throw new HttpsError('invalid-argument', 'SLA không hợp lệ.')
  if (approval && !allowedApproval.has(approval)) throw new HttpsError('invalid-argument', 'Trạng thái phê duyệt không hợp lệ.')
  if (segment && !renewalSegments.has(segment)) throw new HttpsError('invalid-argument', 'Nhóm tái ký không hợp lệ.')
  return {
    pageSize: safeInteger(value.pageSize ?? 30, 'Kích thước trang', 1, 50), cursor: decodeCursor(value.cursor),
    search: boundedString(value.search, 'Từ khóa', 120, false).toLocaleLowerCase('vi'),
    branchId: value.branchId && value.branchId !== 'all' ? documentId(value.branchId, 'Chi nhánh') : '',
    assignedSalesId: value.assignedSalesId && value.assignedSalesId !== 'all' ? documentId(value.assignedSalesId, 'Nhân viên phụ trách') : '',
    stage, risk, sla, approval, segment, sort: ['priority', 'value', 'follow_up'].includes(value.sort) ? value.sort : 'priority',
  }
}

function matchesRenewalSegment(value, segment) {
  if (!segment) return true
  if (value.active === false || closedStages.has(value.stage)) return false
  const daysLeft = Number(value.daysLeft ?? value.risk?.daysLeft ?? 0)
  const sessionsLeft = Number(value.sessionsLeft ?? value.risk?.sessionsLeft ?? 0)
  if (segment === 'expiring_30d') return daysLeft >= 0 && daysLeft <= 30 && sessionsLeft > 0
  if (segment === 'exhausted_active') return sessionsLeft <= 0 && daysLeft > 0
  if (segment === 'expired_last_30d') return daysLeft < 0 && daysLeft >= -30
  if (segment === 'in_care') return careStages.has(value.stage)
  return false
}

function matchesListInput(value, input) {
  if (!matchesRenewalSegment(value, input.segment)) return false
  if (input.branchId && value.branchId !== input.branchId) return false
  if (input.assignedSalesId && value.assignedSalesId !== input.assignedSalesId) return false
  if (input.stage && value.stage !== input.stage) return false
  if (input.risk && value.riskCategory !== input.risk) return false
  if (input.sla && slaStatus(value) !== input.sla) return false
  if (input.approval && (input.approval === 'none' ? Boolean(value.approvalStatus) : value.approvalStatus !== input.approval)) return false
  if (!input.search) return true
  return [value.studentSnapshot?.name, value.studentSnapshot?.phone, value.studentSnapshot?.email, value.contractSnapshot?.packageName, value.branchName, value.assignedSalesName]
    .join(' ').toLocaleLowerCase('vi').includes(input.search)
}

function renewalStats(values) {
  const stageCounts = Object.fromEntries([...renewalStages].map((stage) => [stage, 0]))
  const riskCounts = { expired: 0, exhausted: 0, critical: 0, upcoming: 0, early: 0 }
  const slaCounts = { overdue: 0, due_today: 0, upcoming: 0, done: 0 }
  const segmentCounts = Object.fromEntries([...renewalSegments].map((segment) => [segment, 0]))
  let pipelineValue = 0
  let weightedPipelineValue = 0
  let pendingApprovals = 0
  for (const value of values) {
    for (const segment of renewalSegments) if (matchesRenewalSegment(value, segment)) segmentCounts[segment] += 1
    stageCounts[value.stage] = (stageCounts[value.stage] || 0) + 1
    if (value.active !== false && riskCounts[value.riskCategory] !== undefined) riskCounts[value.riskCategory] += 1
    slaCounts[slaStatus(value)] += 1
    if (value.approvalStatus === 'pending') pendingApprovals += 1
    if (value.active !== false && !closedStages.has(value.stage)) {
      pipelineValue += Number(value.expectedValue || 0)
      weightedPipelineValue += Math.round(Number(value.expectedValue || 0) * Number(value.probability ?? probabilityByStage[value.stage] ?? 0.1))
    }
  }
  return { total: values.filter((item) => item.active !== false).length, pipelineValue, weightedPipelineValue, pendingApprovals, stageCounts, riskCounts, slaCounts, segmentCounts }
}

const renewalQueueFingerprintFields = [
  'schemaVersion', 'sourceContractId', 'studentId', 'branchId', 'branchName',
  'assignedSalesId', 'assignedSalesName', 'stage', 'probability', 'active',
  'riskCategory', 'daysLeft', 'sessionsLeft', 'slaDueAt', 'priorityScore',
  'expectedValue', 'studentSnapshot', 'contractSnapshot', 'nextActionAt',
  'lastContactAt', 'note', 'quoteId', 'approvalId', 'approvalStatus', 'lostReason',
]

function canonicalComparable(value) {
  if (value === undefined) return null
  if (value === null || typeof value !== 'object') return value
  if (typeof value.toMillis === 'function') return { __timestampMillis: value.toMillis() }
  if (Array.isArray(value)) return value.map(canonicalComparable)
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalComparable(value[key])]))
}

function renewalQueueFingerprint(value) {
  return JSON.stringify(canonicalComparable(Object.fromEntries(
    renewalQueueFingerprintFields.map((field) => [field, value?.[field] ?? null]),
  )))
}

async function renewalOptions(db, actor) {
  const [packagesSnapshot, branchesSnapshot, accountsSnapshot, assignmentsSnapshot] = await Promise.all([
    db.collection('packages').limit(500).get(), db.collection('branches').limit(100).get(),
    db.collection('cashAccounts').where('status', '==', 'active').limit(200).get(), db.collection('roleAssignments').limit(500).get(),
  ])
  const allowedBranch = (branchId) => actor.renewalScope === 'system' || actor.branchIds.includes(branchId)
  const salesAssignments = assignmentsSnapshot.docs.filter((item) => item.data().status === 'active'
    && (item.data().positions || []).includes('sales')
    && (actor.renewalScope === 'system' || (item.data().branchIds || []).some((branchId) => actor.branchIds.includes(branchId))))
  const users = salesAssignments.length ? await db.getAll(...salesAssignments.map((item) => db.doc(`users/${item.id}`))) : []
  const names = new Map(users.filter((item) => item.exists).map((item) => [item.id, item.data().displayName || item.data().name || 'Nhân viên Aura']))
  return {
    packages: packagesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => !['archived', 'inactive'].includes(item.status) && (!item.branchId || allowedBranch(item.branchId))).map((item) => ({ id: item.id, name: item.name || 'Gói tập Aura', price: Number(item.price || 0), totalSessions: Number(item.totalSessions || 0), durationMonths: Number(item.durationMonths || 0), branchId: item.branchId || '' })),
    branches: branchesSnapshot.docs.map((item) => ({ id: item.id, name: item.data().name || item.id })).filter((item) => allowedBranch(item.id)),
    cashAccounts: accountsSnapshot.docs.map((item) => ({ id: item.id, name: item.data().name || item.id, type: item.data().type || 'cash', branchId: item.data().branchId || '' })).filter((item) => allowedBranch(item.branchId)),
    assignees: salesAssignments.map((item) => ({ id: item.id, name: names.get(item.id) || 'Nhân viên Aura', branchIds: item.data().branchIds || [] })),
  }
}

async function refreshRenewalQueueCore({ db, dryRun = true, actorUid = 'scheduler' }) {
  const today = vietnamDateKey()
  const [contractsSnapshot, studentsSnapshot, packagesSnapshot, branchesSnapshot, casesSnapshot, assignmentsSnapshot] = await Promise.all([
    db.collection('contracts').limit(maximumContracts + 1).get(), db.collection('students').limit(5000).get(),
    db.collection('packages').limit(500).get(), db.collection('branches').limit(100).get(),
    db.collection('contractRenewalCases').limit(maximumCases + 1).get(), db.collection('roleAssignments').limit(500).get(),
  ])
  const contracts = contractsSnapshot.docs.slice(0, maximumContracts).map((item) => ({ id: item.id, ...item.data() }))
  const students = new Map(studentsSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]))
  const packages = new Map(packagesSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]))
  const branches = new Map(branchesSnapshot.docs.map((item) => [item.id, item.data().name || item.id]))
  const existing = new Map(casesSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]))
  const activeSales = new Set(assignmentsSnapshot.docs.filter((item) => item.data().status === 'active' && (item.data().positions || []).includes('sales')).map((item) => item.id))
  const desired = new Map()
  for (const contract of latestContractsByStudent(contracts).values()) {
    if (!contract.endDate || !activeContractStatuses.has(contract.status || 'active')) continue
    const risk = renewalRisk(contract, today)
    if (risk.category === 'healthy') continue
    const student = students.get(contract.studentId)
    if (!student || ['inactive', 'archived'].includes(student.status)) continue
    const current = existing.get(contract.id) || {}
    if (closedStages.has(current.stage)) continue
    const trainingPackage = packages.get(contract.packageId) || {}
    const branchId = contract.branchId || student.branchId || trainingPackage.branchId || ''
    const candidate = current.assignedSalesId || contract.assignedSalesId || student.assignedSalesId || ''
    const assignedSalesId = activeSales.has(candidate) ? candidate : ''
    const stage = renewalStages.has(current.stage) ? current.stage : 'uncontacted'
    const proposedSla = addDaysDateKey(today, riskSlaDays(risk.category))
    const slaDueAt = current.slaDueAt && current.slaDueAt < proposedSla ? current.slaDueAt : proposedSla
    desired.set(contract.id, {
      schemaVersion: 2, sourceContractId: contract.id, studentId: contract.studentId, branchId,
      branchName: branches.get(branchId) || 'Chưa phân chi nhánh', assignedSalesId, assignedSalesName: current.assignedSalesName || '',
      stage, probability: probabilityByStage[stage], active: true, riskCategory: risk.category,
      daysLeft: risk.daysLeft, sessionsLeft: risk.sessionsLeft, slaDueAt,
      priorityScore: priorityScore(risk, slaDueAt, today), expectedValue: Math.max(0, Number(trainingPackage.price || contract.totalPrice || 0)),
      studentSnapshot: { id: student.id, name: student.name || student.displayName || 'Chưa cập nhật tên', phone: student.phone || student.phoneNumber || '', email: student.email || '' },
      contractSnapshot: {
        id: contract.id, packageId: contract.packageId || '', packageName: contract.packageName || trainingPackage.name || 'Gói tập Aura',
        startDate: contract.startDate || '', endDate: contract.endDate, status: contract.status || 'active', totalSessions: Number(contract.totalSessions || 0),
        usedSessions: Number(contract.usedSessions || 0), totalPrice: Number(contract.totalPrice || trainingPackage.price || 0), paidAmount: Number(contract.paidAmount || 0),
        discount: Number(contract.discount || 0), branchId, trainerId: contract.trainerId || '', trainerIds: Array.isArray(contract.trainerIds) ? contract.trainerIds : [],
        nutritionPTIds: Array.isArray(contract.nutritionPTIds) ? contract.nutritionPTIds : [], revision: Number(contract.revision || 0),
      },
      nextActionAt: current.nextActionAt || null, lastContactAt: current.lastContactAt || null, note: current.note || '',
      quoteId: current.quoteId || null, approvalId: current.approvalId || null, approvalStatus: current.approvalStatus || null,
      lostReason: null, revision: Number(current.revision || 0),
    })
  }
  const writes = []
  for (const [id, value] of desired) {
    const current = existing.get(id)
    if (!current) {
      writes.push({ id, value: { ...value, revision: 1 }, create: true })
      continue
    }
    if (renewalQueueFingerprint(current) !== renewalQueueFingerprint(value)) {
      writes.push({ id, value: { ...value, revision: Number(current.revision || 0) + 1 }, create: false })
    }
  }
  for (const [id, current] of existing) if (current.active !== false && !closedStages.has(current.stage) && !desired.has(id)) writes.push({ id, value: { active: false, revision: Number(current.revision || 0) + 1 }, create: false })
  if (!dryRun) {
    for (let offset = 0; offset < writes.length; offset += 400) {
      const batch = db.batch()
      writes.slice(offset, offset + 400).forEach((item) => batch.set(db.doc(`contractRenewalCases/${item.id}`), {
        ...item.value, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid,
        ...(item.create ? { createdAt: FieldValue.serverTimestamp(), createdBy: actorUid } : {}),
      }, { merge: true }))
      await batch.commit()
    }
  }
  return { dryRun, eligibleCases: desired.size, plannedWrites: writes.length, creates: writes.filter((item) => item.create).length, updates: writes.filter((item) => !item.create).length, contractsScanned: contracts.length, truncated: contractsSnapshot.size > maximumContracts || casesSnapshot.size > maximumCases }
}

async function createRenewalInternalReminders(db, today = vietnamDateKey()) {
  const casesSnapshot = await db.collection('contractRenewalCases').where('active', '==', true).limit(1001).get()
  const dueCases = casesSnapshot.docs.slice(0, 1000).map((item) => ({ id: item.id, ...item.data() })).filter((item) => {
    const dueAt = item.nextActionAt || item.slaDueAt
    return item.assignedSalesId && dueAt && dueAt <= today && !closedStages.has(item.stage)
  }).sort(caseSort).slice(0, 500)
  let created = 0
  for (let offset = 0; offset < dueCases.length; offset += 300) {
    const chunk = dueCases.slice(offset, offset + 300)
    const references = chunk.map((item) => db.doc(`users/${item.assignedSalesId}/notifications/renewal_${today}_${item.id}`))
    const existing = await db.getAll(...references)
    const batch = db.batch()
    existing.forEach((snapshot, index) => {
      if (snapshot.exists) return
      const item = chunk[index]
      const reference = references[index]
      batch.create(reference, {
        id: reference.id, userId: item.assignedSalesId, title: 'Hồ sơ tái ký cần xử lý',
        message: `${item.studentSnapshot?.name || 'Học viên Aura'} · ${item.contractSnapshot?.packageName || 'Gói tập'} · ${slaStatus(item) === 'overdue' ? 'đã quá SLA' : 'đến hạn hôm nay'}`,
        type: 'renewal_reminder', category: 'operations', actionUrl: '#/admin-renewals',
        dedupeKey: reference.id, dateString: today, read: false, createdAt: FieldValue.serverTimestamp(),
      })
      created += 1
    })
    if (existing.some((snapshot) => !snapshot.exists)) await batch.commit()
  }
  return { evaluated: dueCases.length, created, truncated: casesSnapshot.size > 1000 }
}

function createContractRenewalFunctions({ db, onCall, onSchedule, logger }) {
  const listHandler = async (request) => {
    const actor = await renewalActor(request, db)
    const input = listInput(request.data || {})
    const [{ documents, truncated }, options] = await Promise.all([scopedCaseDocuments(db, actor), renewalOptions(db, actor)])
    let values = documents.filter((item) => matchesListInput(item, input))
    if (input.sort === 'value') values.sort((a, b) => Number(b.expectedValue || 0) - Number(a.expectedValue || 0) || caseSort(a, b))
    else if (input.sort === 'follow_up') values.sort((a, b) => String(a.nextActionAt || '9999').localeCompare(String(b.nextActionAt || '9999')) || caseSort(a, b))
    else values.sort(caseSort)
    if (input.cursor) {
      const cursorIndex = values.findIndex((item) => item.id === input.cursor.id)
      if (cursorIndex < 0) throw new HttpsError('aborted', 'Hàng đợi đã thay đổi. Hãy tải lại từ đầu.')
      values = values.slice(cursorIndex + 1)
    }
    const selected = values.slice(0, input.pageSize)
    const stats = renewalStats(documents)
    return { schemaVersion: 2, generatedAt: new Date().toISOString(), today: vietnamDateKey(), rows: selected.map(publicCase), hasMore: values.length > input.pageSize, nextCursor: values.length > input.pageSize && selected.length ? encodeCursor(selected[selected.length - 1]) : null, stats, options, packages: options.packages, scope: actor.renewalScope, actorUid: actor.uid, truncated }
  }
  const listContractRenewalCases = onCall(listHandler)
  const listContractRenewalPipeline = onCall(listHandler)

  const listRenewalMessageTemplates = onCall(async (request) => {
    await renewalActor(request, db)
    return { schemaVersion: 1, templates: renewalMessageTemplates }
  })

  const detailHandler = async (request) => {
    const actor = await renewalActor(request, db)
    const caseId = documentId(request.data?.caseId, 'Hồ sơ tái ký')
    const caseSnapshot = await db.doc(`contractRenewalCases/${caseId}`).get()
    if (!caseSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy hồ sơ tái ký.')
    const value = { id: caseSnapshot.id, ...caseSnapshot.data() }
    assertCaseScope(actor, value)
    const studentId = documentId(value.studentId, 'Học viên')
    const [contracts, activities, sessions, quote, approval] = await Promise.all([
      db.collection('contracts').where('studentId', '==', studentId).limit(50).get(),
      db.collection('contractRenewalActivities').where('caseId', '==', caseId).orderBy('createdAt', 'desc').limit(100).get(),
      db.collection('sessions').where('studentId', '==', studentId).where('date', '>=', vietnamDateKey()).orderBy('date').limit(10).get(),
      value.quoteId ? db.doc(`quotes/${value.quoteId}`).get() : null,
      value.approvalId ? db.doc(`contractRenewalApprovals/${value.approvalId}`).get() : null,
    ])
    return {
      case: publicCase(value),
      contractHistory: contracts.docs.map((item) => ({ id: item.id, ...item.data(), createdAt: serializeTimestamp(item.data().createdAt), updatedAt: serializeTimestamp(item.data().updatedAt) })),
      activities: activities.docs.map((item) => ({ id: item.id, ...item.data(), createdAt: serializeTimestamp(item.data().createdAt) })),
      upcomingSessions: sessions.docs.map((item) => ({ id: item.id, date: item.data().date || '', hour: Number(item.data().hour || 0), trainerId: item.data().trainerId || '', status: item.data().status || '' })),
      quote: quote?.exists ? { id: quote.id, ...quote.data(), createdAt: serializeTimestamp(quote.data().createdAt) } : null,
      approval: approval?.exists ? { id: approval.id, ...approval.data(), createdAt: serializeTimestamp(approval.data().createdAt), decidedAt: serializeTimestamp(approval.data().decidedAt) } : null,
    }
  }
  const getContractRenewalCaseDetail = onCall(detailHandler)

  const activityHandler = async (request) => {
    const actor = await renewalActor(request, db)
    const caseId = documentId(request.data?.caseId, 'Hồ sơ tái ký')
    const expectedRevision = safeInteger(request.data?.expectedRevision ?? 0, 'Phiên bản hồ sơ', 0, 1_000_000)
    const type = boundedString(request.data?.type, 'Loại tương tác', 30)
    const outcome = boundedString(request.data?.outcome || 'other', 'Kết quả tương tác', 30)
    if (!activityTypes.has(type) || !activityOutcomes.has(outcome)) throw new HttpsError('invalid-argument', 'Loại hoặc kết quả tương tác không hợp lệ.')
    const nextActionAt = optionalDateKey(request.data?.nextActionAt, 'Ngày hành động tiếp theo')
    const note = boundedString(request.data?.note, 'Ghi chú', 500, false)
    const requestedStage = request.data?.stage ? boundedString(request.data.stage, 'Giai đoạn', 30) : ''
    if (requestedStage && (!renewalStages.has(requestedStage) || requestedStage === 'won')) throw new HttpsError('invalid-argument', 'Giai đoạn không hợp lệ.')
    const lostReason = requestedStage === 'lost' ? boundedString(request.data?.lostReason || note, 'Lý do không tái ký', 200) : null
    const caseReference = db.doc(`contractRenewalCases/${caseId}`)
    const activityReference = db.collection('contractRenewalActivities').doc()
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(caseReference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy hồ sơ tái ký.')
      const value = snapshot.data()
      assertCaseScope(actor, value)
      if (Number(value.revision || 0) !== expectedRevision) throw new HttpsError('aborted', 'Hồ sơ đã được cập nhật. Hãy tải lại.')
      if (closedStages.has(value.stage)) throw new HttpsError('failed-precondition', 'Hồ sơ đã kết thúc không thể cập nhật tương tác.')
      const stage = requestedStage || value.stage || 'uncontacted'
      transaction.update(caseReference, {
        stage, probability: probabilityByStage[stage], nextActionAt, lostReason,
        active: stage !== 'lost', note: note || value.note || '',
        lastContactAt: ['call', 'zalo', 'meeting'].includes(type) ? FieldValue.serverTimestamp() : value.lastContactAt || null,
        revision: expectedRevision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid,
      })
      transaction.create(activityReference, { schemaVersion: 1, caseId, sourceContractId: value.sourceContractId || caseId, studentId: value.studentId || '', branchId: value.branchId || '', assignedSalesId: value.assignedSalesId || '', type, outcome, beforeStage: value.stage || 'uncontacted', afterStage: stage, note, nextActionAt, lostReason, actorUid: actor.uid, createdAt: FieldValue.serverTimestamp() })
    })
    return { caseId, activityId: activityReference.id, revision: expectedRevision + 1 }
  }
  const recordContractRenewalActivity = onCall(activityHandler)
  const updateContractRenewalCase = onCall((request) => activityHandler({ ...request, data: { caseId: request.data?.sourceContractId, expectedRevision: request.data?.expectedRevision, type: 'stage_change', outcome: request.data?.stage === 'lost' ? 'not_interested' : 'other', stage: request.data?.stage, nextActionAt: request.data?.nextFollowUpAt || null, note: request.data?.note || '', lostReason: request.data?.stage === 'lost' ? request.data?.note || '' : null } }))

  const assignContractRenewalCase = onCall(async (request) => {
    const actor = await renewalActor(request, db)
    if (!['system', 'branch'].includes(actor.renewalScope)) throw new HttpsError('permission-denied', 'Bạn không có quyền phân công hồ sơ.')
    const caseId = documentId(request.data?.caseId, 'Hồ sơ tái ký')
    const rawAssignedSalesId = boundedString(request.data?.assignedSalesId, 'Nhân viên phụ trách', 200, false)
    const assignedSalesId = rawAssignedSalesId ? documentId(rawAssignedSalesId, 'Nhân viên phụ trách') : ''
    const expectedRevision = safeInteger(request.data?.expectedRevision ?? 0, 'Phiên bản hồ sơ', 0, 1_000_000)
    const caseReference = db.doc(`contractRenewalCases/${caseId}`)
    await db.runTransaction(async (transaction) => {
      const [caseSnapshot, assignment, user] = await Promise.all([
        transaction.get(caseReference),
        assignedSalesId ? transaction.get(db.doc(`roleAssignments/${assignedSalesId}`)) : Promise.resolve(null),
        assignedSalesId ? transaction.get(db.doc(`users/${assignedSalesId}`)) : Promise.resolve(null),
      ])
      if (!caseSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy hồ sơ tái ký.')
      const value = caseSnapshot.data()
      assertCaseScope(actor, value)
      if (Number(value.revision || 0) !== expectedRevision) throw new HttpsError('aborted', 'Hồ sơ đã được cập nhật. Hãy tải lại.')
      if (assignedSalesId && (!assignment?.exists || assignment.data().status !== 'active' || !(assignment.data().positions || []).includes('sales') || !(assignment.data().branchIds || []).includes(value.branchId))) throw new HttpsError('failed-precondition', 'Nhân viên không phụ trách chi nhánh của hồ sơ.')
      const name = assignedSalesId && user?.exists ? user.data().displayName || user.data().name || 'Nhân viên Aura' : ''
      transaction.update(caseReference, { assignedSalesId, assignedSalesName: name, revision: expectedRevision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.create(db.collection('contractRenewalActivities').doc(), { schemaVersion: 1, caseId, sourceContractId: value.sourceContractId || caseId, studentId: value.studentId || '', branchId: value.branchId || '', type: 'assignment', outcome: 'other', beforeAssignedSalesId: value.assignedSalesId || '', assignedSalesId, actorUid: actor.uid, createdAt: FieldValue.serverTimestamp() })
    })
    return { caseId, assignedSalesId, revision: expectedRevision + 1 }
  })

  const transferRenewalCases = onCall(async (request) => {
    const actor = await renewalActor(request, db)
    if (!['system', 'branch'].includes(actor.renewalScope)) throw new HttpsError('permission-denied', 'Bạn không có quyền bàn giao hồ sơ.')
    const assignedSalesId = documentId(request.data?.assignedSalesId, 'Nhân viên nhận bàn giao')
    const reason = boundedString(request.data?.reason, 'Lý do bàn giao', 300)
    const nextActionAt = optionalDateKey(request.data?.nextActionAt, 'Ngày xử lý tiếp theo')
    if (!Array.isArray(request.data?.cases) || request.data.cases.length < 1 || request.data.cases.length > 20) throw new HttpsError('invalid-argument', 'Chọn từ 1 đến 20 hồ sơ để bàn giao.')
    const cases = request.data.cases.map((item) => ({
      caseId: documentId(item?.caseId, 'Hồ sơ tái ký'),
      expectedRevision: safeInteger(item?.expectedRevision ?? 0, 'Phiên bản hồ sơ', 0, 1_000_000),
    }))
    if (new Set(cases.map((item) => item.caseId)).size !== cases.length) throw new HttpsError('invalid-argument', 'Danh sách bàn giao có hồ sơ trùng lặp.')
    const targetAssignmentReference = db.doc(`roleAssignments/${assignedSalesId}`)
    const targetUserReference = db.doc(`users/${assignedSalesId}`)
    const caseReferences = cases.map((item) => db.doc(`contractRenewalCases/${item.caseId}`))
    await db.runTransaction(async (transaction) => {
      const [assignment, user, ...caseSnapshots] = await Promise.all([
        transaction.get(targetAssignmentReference), transaction.get(targetUserReference),
        ...caseReferences.map((reference) => transaction.get(reference)),
      ])
      if (!assignment.exists || assignment.data().status !== 'active' || !(assignment.data().positions || []).includes('sales')) throw new HttpsError('failed-precondition', 'Tài khoản nhận bàn giao chưa có chức danh Sales đang hoạt động.')
      const targetBranches = assignment.data().branchIds || []
      const assignedSalesName = user.exists ? user.data().displayName || user.data().name || 'Nhân viên Aura' : 'Nhân viên Aura'
      caseSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) throw new HttpsError('not-found', 'Có hồ sơ tái ký không còn tồn tại.')
        const value = snapshot.data()
        assertCaseScope(actor, value)
        if (value.active === false || closedStages.has(value.stage)) throw new HttpsError('failed-precondition', 'Không thể bàn giao hồ sơ đã kết thúc.')
        if (Number(value.revision || 0) !== cases[index].expectedRevision) throw new HttpsError('aborted', 'Một hồ sơ đã được cập nhật. Hãy tải lại danh sách.')
        if (!targetBranches.includes(value.branchId)) throw new HttpsError('failed-precondition', 'Nhân viên nhận bàn giao không phụ trách đủ các chi nhánh đã chọn.')
      })
      caseSnapshots.forEach((snapshot, index) => {
        const value = snapshot.data()
        const caseId = cases[index].caseId
        transaction.update(caseReferences[index], {
          assignedSalesId, assignedSalesName,
          ...(nextActionAt ? { nextActionAt } : {}),
          revision: cases[index].expectedRevision + 1,
          updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid,
        })
        transaction.create(db.collection('contractRenewalActivities').doc(), {
          schemaVersion: 1, caseId, sourceContractId: value.sourceContractId || caseId,
          studentId: value.studentId || '', branchId: value.branchId || '', type: 'assignment', outcome: 'other',
          beforeAssignedSalesId: value.assignedSalesId || '', assignedSalesId, assignedSalesName,
          reason, nextActionAt, actorUid: actor.uid, createdAt: FieldValue.serverTimestamp(),
        })
      })
    })
    return { assignedSalesId, transferred: cases.length }
  })

  const createRenewalQuote = onCall({ cpu: 'gcf_gen1', maxInstances: 3 }, async (request) => {
    const actor = await renewalActor(request, db)
    const caseId = documentId(request.data?.caseId, 'Hồ sơ tái ký')
    const packageId = documentId(request.data?.packageId, 'Gói tập')
    const expectedRevision = safeInteger(request.data?.expectedRevision ?? 0, 'Phiên bản hồ sơ', 0, 1_000_000)
    const discount = safeMoney(request.data?.discount || 0, 'Giảm giá')
    const carryOverSessions = safeInteger(request.data?.carryOverSessions || 0, 'Số buổi chuyển tiếp', 0, 1000)
    const quoteReference = db.collection('quotes').doc()
    const caseReference = db.doc(`contractRenewalCases/${caseId}`)
    const packageReference = db.doc(`packages/${packageId}`)
    await db.runTransaction(async (transaction) => {
      const [caseSnapshot, packageSnapshot] = await Promise.all([transaction.get(caseReference), transaction.get(packageReference)])
      if (!caseSnapshot.exists || !packageSnapshot.exists || ['inactive', 'archived'].includes(packageSnapshot.data().status)) throw new HttpsError('not-found', 'Hồ sơ hoặc gói tập không còn hiệu lực.')
      const value = caseSnapshot.data()
      assertCaseScope(actor, value)
      if (Number(value.revision || 0) !== expectedRevision) throw new HttpsError('aborted', 'Hồ sơ đã được cập nhật. Hãy tải lại.')
      const originalPrice = safeMoney(packageSnapshot.data().price, 'Giá gói', false)
      if (discount > originalPrice || carryOverSessions > Number(value.sessionsLeft || 0)) throw new HttpsError('invalid-argument', 'Ưu đãi vượt giới hạn hợp đồng hoặc giá gói.')
      const discountRate = originalPrice ? discount / originalPrice : 0
      const requiresApproval = requiresRenewalApproval(discount, originalPrice, carryOverSessions)
      const code = `AQ-RN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${quoteReference.id.slice(0, 6).toUpperCase()}`
      transaction.create(quoteReference, { schemaVersion: 2, type: 'renewal', code, caseId, sourceContractId: value.sourceContractId || caseId, studentId: value.studentId || '', customerName: value.studentSnapshot?.name || '', customerPhone: value.studentSnapshot?.phone || '', branchId: value.branchId || '', packageId, packageName: packageSnapshot.data().name || '', originalPrice, discount, discountRate, carryOverSessions, finalPrice: originalPrice - discount, assignedSalesId: value.assignedSalesId || actor.uid, status: requiresApproval ? 'requires_approval' : 'approved', requiresApproval, caseRevision: expectedRevision, packageRevision: Number(packageSnapshot.data().revision || 0), createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      transaction.update(caseReference, { quoteId: quoteReference.id, stage: 'quote_sent', probability: probabilityByStage.quote_sent, approvalId: null, approvalStatus: null, revision: expectedRevision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.create(db.collection('contractRenewalActivities').doc(), { schemaVersion: 1, caseId, sourceContractId: value.sourceContractId || caseId, studentId: value.studentId || '', branchId: value.branchId || '', type: 'quote', outcome: 'quote_requested', quoteId: quoteReference.id, actorUid: actor.uid, createdAt: FieldValue.serverTimestamp() })
    })
    return { quoteId: quoteReference.id, revision: expectedRevision + 1 }
  })

  const submitRenewalApproval = onCall(async (request) => {
    const actor = await renewalActor(request, db)
    const caseId = documentId(request.data?.caseId, 'Hồ sơ tái ký')
    const quoteId = documentId(request.data?.quoteId, 'Báo giá')
    const expectedRevision = safeInteger(request.data?.expectedRevision ?? 0, 'Phiên bản hồ sơ', 0, 1_000_000)
    const reason = boundedString(request.data?.reason, 'Lý do xin duyệt', 500)
    const caseReference = db.doc(`contractRenewalCases/${caseId}`)
    const quoteReference = db.doc(`quotes/${quoteId}`)
    const approvalReference = db.collection('contractRenewalApprovals').doc()
    await db.runTransaction(async (transaction) => {
      const [caseSnapshot, quoteSnapshot] = await Promise.all([transaction.get(caseReference), transaction.get(quoteReference)])
      if (!caseSnapshot.exists || !quoteSnapshot.exists || quoteSnapshot.data().caseId !== caseId) throw new HttpsError('not-found', 'Hồ sơ hoặc báo giá không hợp lệ.')
      const value = caseSnapshot.data()
      assertCaseScope(actor, value)
      if (Number(value.revision || 0) !== expectedRevision) throw new HttpsError('aborted', 'Hồ sơ đã được cập nhật. Hãy tải lại.')
      if (!quoteSnapshot.data().requiresApproval) throw new HttpsError('failed-precondition', 'Báo giá này không cần phê duyệt ngoại lệ.')
      transaction.create(approvalReference, { schemaVersion: 1, caseId, quoteId, branchId: value.branchId || '', submittedBy: actor.uid, status: 'pending', reason, discount: Number(quoteSnapshot.data().discount || 0), discountRate: Number(quoteSnapshot.data().discountRate || 0), carryOverSessions: Number(quoteSnapshot.data().carryOverSessions || 0), expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 86_400_000)), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      transaction.update(quoteReference, { status: 'pending_approval', approvalId: approvalReference.id, updatedAt: FieldValue.serverTimestamp() })
      transaction.update(caseReference, { approvalId: approvalReference.id, approvalStatus: 'pending', revision: expectedRevision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.create(db.collection('contractRenewalActivities').doc(), { schemaVersion: 1, caseId, sourceContractId: value.sourceContractId || caseId, studentId: value.studentId || '', branchId: value.branchId || '', type: 'approval_submitted', outcome: 'other', approvalId: approvalReference.id, actorUid: actor.uid, createdAt: FieldValue.serverTimestamp() })
    })
    return { approvalId: approvalReference.id, status: 'pending', revision: expectedRevision + 1 }
  })

  const decideRenewalApproval = onCall(async (request) => {
    const actor = await renewalActor(request, db)
    requireCapability(actor, 'renewals.approval.manage')
    const approvalId = documentId(request.data?.approvalId, 'Yêu cầu phê duyệt')
    const decision = boundedString(request.data?.decision, 'Quyết định', 20)
    if (!['approved', 'rejected'].includes(decision)) throw new HttpsError('invalid-argument', 'Quyết định không hợp lệ.')
    const note = boundedString(request.data?.note, 'Ghi chú phê duyệt', 500, false)
    const approvalReference = db.doc(`contractRenewalApprovals/${approvalId}`)
    await db.runTransaction(async (transaction) => {
      const approval = await transaction.get(approvalReference)
      if (!approval.exists || approval.data().status !== 'pending') throw new HttpsError('failed-precondition', 'Yêu cầu không còn chờ phê duyệt.')
      const caseReference = db.doc(`contractRenewalCases/${approval.data().caseId}`)
      const quoteReference = db.doc(`quotes/${approval.data().quoteId}`)
      const [caseSnapshot, quoteSnapshot] = await Promise.all([transaction.get(caseReference), transaction.get(quoteReference)])
      if (!caseSnapshot.exists || !quoteSnapshot.exists) throw new HttpsError('not-found', 'Hồ sơ hoặc báo giá không còn tồn tại.')
      const value = caseSnapshot.data()
      if (!canApproveCase(actor, value)) throw new HttpsError('permission-denied', 'Bạn không được duyệt hồ sơ ngoài chi nhánh.')
      if (approval.data().submittedBy === actor.uid) throw new HttpsError('permission-denied', 'Người gửi không được tự duyệt yêu cầu của mình.')
      if (timestampMillis(approval.data().expiresAt) <= Date.now()) throw new HttpsError('failed-precondition', 'Yêu cầu phê duyệt đã hết hạn.')
      transaction.update(approvalReference, { status: decision, note, decidedAt: FieldValue.serverTimestamp(), decidedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() })
      transaction.update(quoteReference, { status: decision, updatedAt: FieldValue.serverTimestamp() })
      transaction.update(caseReference, { approvalStatus: decision, revision: Number(value.revision || 0) + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.create(db.collection('contractRenewalActivities').doc(), { schemaVersion: 1, caseId: approval.data().caseId, sourceContractId: value.sourceContractId || approval.data().caseId, studentId: value.studentId || '', branchId: value.branchId || '', type: 'approval_decided', outcome: decision === 'approved' ? 'interested' : 'not_interested', approvalId, note, actorUid: actor.uid, createdAt: FieldValue.serverTimestamp() })
    })
    return { approvalId, status: decision }
  })

  const renewPtContract = onCall(async (request) => {
    const actor = await renewalActor(request, db)
    const caseId = documentId(request.data?.caseId || request.data?.sourceContractId, 'Hồ sơ tái ký')
    const sourceContractId = documentId(request.data?.sourceContractId, 'Hợp đồng nguồn')
    const packageId = documentId(request.data?.packageId, 'Gói tập')
    const quoteId = request.data?.quoteId ? documentId(request.data.quoteId, 'Báo giá') : ''
    const approvalId = request.data?.approvalId ? documentId(request.data.approvalId, 'Phê duyệt') : ''
    const startDate = dateKey(request.data?.startDate, 'Ngày bắt đầu')
    const expectedSourceRevision = safeInteger(request.data?.expectedSourceRevision ?? 0, 'Phiên bản hợp đồng', 0, 1_000_000)
    const expectedCaseRevision = safeInteger(request.data?.expectedCaseRevision ?? request.data?.expectedRevision ?? 0, 'Phiên bản hồ sơ', 0, 1_000_000)
    const idempotencyKey = boundedString(request.data?.idempotencyKey, 'Khóa chống trùng', 100)
    const carryOver = request.data?.carryOver === true
    const discount = safeMoney(request.data?.discount || 0, 'Giảm giá')
    const initialPayment = safeMoney(request.data?.initialPayment || 0, 'Thanh toán đầu kỳ')
    const paymentMethod = initialPayment ? boundedString(request.data?.paymentMethod, 'Phương thức thanh toán', 50) : ''
    const cashAccountId = initialPayment ? documentId(request.data?.cashAccountId, 'Tài khoản quỹ') : ''
    const note = boundedString(request.data?.note, 'Ghi chú', 500, false)
    const trainerIds = Array.isArray(request.data?.trainerIds) ? [...new Set(request.data.trainerIds.map((item) => documentId(item, 'Huấn luyện viên')))].slice(0, 10) : []
    const nutritionPTIds = Array.isArray(request.data?.nutritionPTIds) ? [...new Set(request.data.nutritionPTIds.map((item) => documentId(item, 'PT dinh dưỡng')))].slice(0, 10) : []
    const sourceReference = db.doc(`contracts/${sourceContractId}`)
    const packageReference = db.doc(`packages/${packageId}`)
    const caseReference = db.doc(`contractRenewalCases/${caseId}`)
    const quoteReference = quoteId ? db.doc(`quotes/${quoteId}`) : null
    const approvalReference = approvalId ? db.doc(`contractRenewalApprovals/${approvalId}`) : null
    const newContractReference = db.collection('contracts').doc()
    const paymentReference = db.collection('ledgerEntries').doc()
    return db.runTransaction(async (transaction) => {
      const baseReads = [transaction.get(sourceReference), transaction.get(packageReference), transaction.get(caseReference)]
      if (quoteReference) baseReads.push(transaction.get(quoteReference))
      if (approvalReference) baseReads.push(transaction.get(approvalReference))
      const results = await Promise.all(baseReads)
      const [sourceSnapshot, packageSnapshot, caseSnapshot] = results
      const quoteSnapshot = quoteReference ? results[3] : null
      const approvalSnapshot = approvalReference ? results[quoteReference ? 4 : 3] : null
      if (!sourceSnapshot.exists || !caseSnapshot.exists || caseSnapshot.data().sourceContractId !== sourceContractId) throw new HttpsError('not-found', 'Hợp đồng nguồn hoặc hồ sơ tái ký không hợp lệ.')
      if (!packageSnapshot.exists || ['inactive', 'archived'].includes(packageSnapshot.data().status)) throw new HttpsError('not-found', 'Gói tập không còn hiệu lực.')
      const source = sourceSnapshot.data()
      const renewalCase = caseSnapshot.data()
      assertCaseScope(actor, renewalCase)
      if (source.status === 'cancelled') throw new HttpsError('failed-precondition', 'Hợp đồng đã hủy không thể tái ký.')
      if (source.renewalIdempotencyKey === idempotencyKey && source.renewedByContractId) return { contractId: source.renewedByContractId, paymentEntryId: source.renewalPaymentEntryId || null, unchanged: true }
      if (Number(source.revision || 0) !== expectedSourceRevision || Number(renewalCase.revision || 0) !== expectedCaseRevision) throw new HttpsError('aborted', 'Hợp đồng hoặc hồ sơ vừa được cập nhật. Hãy tải lại.')
      if (source.renewedByContractId) throw new HttpsError('already-exists', 'Hợp đồng này đã được tái ký.')
      const trainingPackage = packageSnapshot.data()
      if (trainingPackage.branchId && renewalCase.branchId && trainingPackage.branchId !== renewalCase.branchId) throw new HttpsError('failed-precondition', 'Gói tập không thuộc chi nhánh của hồ sơ.')
      const durationMonths = safeInteger(trainingPackage.durationMonths, 'Thời hạn gói', 1, 60)
      const packageSessions = safeInteger(trainingPackage.totalSessions, 'Số buổi gói', 1, 1000)
      const packagePrice = safeMoney(trainingPackage.price, 'Giá gói', false)
      if (discount > packagePrice) throw new HttpsError('invalid-argument', 'Giảm giá vượt giá gói.')
      const remainingSessions = Math.max(0, Number(source.totalSessions || 0) - Number(source.usedSessions || 0))
      const carriedOverSessions = carryOver ? remainingSessions : 0
      const needsApproval = requiresRenewalApproval(discount, packagePrice, carriedOverSessions)
      if (quoteSnapshot) {
        const quote = quoteSnapshot.data()
        if (quote.caseId !== caseId || quote.packageId !== packageId || Number(quote.discount || 0) !== discount || Number(quote.carryOverSessions || 0) !== carriedOverSessions || Number(quote.packageRevision || 0) !== Number(trainingPackage.revision || 0)) throw new HttpsError('failed-precondition', 'Báo giá không còn khớp dữ liệu hiện tại.')
      } else throw new HttpsError('failed-precondition', 'Cần tạo báo giá trước khi tái ký.')
      if (needsApproval) {
        if (!approvalSnapshot?.exists || approvalSnapshot.data().caseId !== caseId || approvalSnapshot.data().quoteId !== quoteId || approvalSnapshot.data().status !== 'approved' || timestampMillis(approvalSnapshot.data().expiresAt) <= Date.now()) throw new HttpsError('failed-precondition', 'Ưu đãi cần phê duyệt hợp lệ trước khi tái ký.')
      }
      const activeContracts = await transaction.get(db.collection('contracts').where('studentId', '==', source.studentId).where('status', 'in', ['active', 'future', 'frozen']).limit(20))
      if (activeContracts.docs.some((item) => item.id !== sourceContractId && !item.data().renewalSupersededBy)) throw new HttpsError('already-exists', 'Học viên đã có hợp đồng đang hoạt động hoặc chờ hiệu lực khác.')
      const totalDue = packagePrice - discount
      if (initialPayment > totalDue) throw new HttpsError('invalid-argument', 'Thanh toán đầu kỳ vượt giá trị hợp đồng.')
      const paymentAt = Timestamp.now()
      if (initialPayment) await assertFinancePeriodOpen(transaction, db, paymentAt)
      const cashAccount = initialPayment ? await cashAccountForMovement(transaction, db, cashAccountId, initialPayment) : null
      if (cashAccount && cashAccount.data.branchId && renewalCase.branchId && cashAccount.data.branchId !== renewalCase.branchId) throw new HttpsError('failed-precondition', 'Tài khoản quỹ không thuộc chi nhánh của hợp đồng.')
      const endDate = addMonthsDateKey(startDate, durationMonths)
      const installments = normalizeInstallments(request.data?.installments, totalDue - initialPayment, startDate, endDate)
      const today = vietnamDateKey()
      const newContract = {
        schemaVersion: 2, studentId: source.studentId, trainerId: trainerIds[0] || source.trainerId || null,
        trainerIds: trainerIds.length ? trainerIds : (Array.isArray(source.trainerIds) ? source.trainerIds : source.trainerId ? [source.trainerId] : []),
        nutritionPTIds: nutritionPTIds.length ? nutritionPTIds : (Array.isArray(source.nutritionPTIds) ? source.nutritionPTIds : []),
        branchId: renewalCase.branchId || source.branchId || trainingPackage.branchId || null, packageId, packageName: trainingPackage.name || 'Gói tập Aura',
        startDate, endDate, originalEndDate: endDate, totalSessions: packageSessions + carriedOverSessions, packageSessions, carriedOverSessions,
        usedSessions: 0, totalPrice: packagePrice, discount, paidAmount: initialPayment, status: startDate > today ? 'future' : 'active',
        installments, nextPaymentDate: installments[0]?.date || null, sourceContractId, renewalCaseId: caseId,
        renewalQuoteId: quoteId || null, renewalApprovalId: approvalId || null, renewalType: 'renewal', revision: 0, note,
        createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
      }
      transaction.create(newContractReference, newContract)
      let paymentEntryId = null
      if (initialPayment > 0) {
        paymentEntryId = paymentReference.id
        transaction.create(paymentReference, { schemaVersion: 2, type: 'payment', eventClass: 'cash_collection', source: 'pt_gym', renewalCaseId: caseId, contractId: newContractReference.id, studentId: source.studentId || '', branchId: newContract.branchId || '', installmentId: null, cashAccountId, amount: initialPayment, cashImpact: initialPayment, revenueImpact: 0, expenseImpact: 0, receivableImpact: 0, deferredRevenueImpact: initialPayment, effectiveAt: paymentAt, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid, paymentMethod, referenceCode: `THU-${paymentReference.id.slice(0, 8).toUpperCase()}`, idempotencyKey: `renewal-payment:${idempotencyKey}`, status: 'posted', note: `Thu đầu kỳ hợp đồng tái ký ${newContractReference.id}` })
        createCashMovement(transaction, db, paymentReference, cashAccount, initialPayment, paymentAt, actor.uid, 'contract_renewal_payment')
      }
      transaction.update(sourceReference, { ...(source.endDate < today || Number(source.usedSessions || 0) >= Number(source.totalSessions || 0) ? { status: 'expired' } : {}), renewalIdempotencyKey: idempotencyKey, renewedByContractId: newContractReference.id, renewalPaymentEntryId: paymentEntryId, renewedAt: FieldValue.serverTimestamp(), renewedBy: actor.uid, revision: expectedSourceRevision + 1, updatedAt: FieldValue.serverTimestamp() })
      transaction.update(caseReference, { stage: 'won', probability: 1, active: false, approvalStatus: approvalSnapshot?.exists ? 'consumed' : renewalCase.approvalStatus || null, renewedContractId: newContractReference.id, wonValue: totalDue, collectedValue: initialPayment, wonAt: FieldValue.serverTimestamp(), revision: expectedCaseRevision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      if (quoteSnapshot?.exists) transaction.update(quoteReference, { status: 'accepted', contractId: newContractReference.id, acceptedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      if (approvalSnapshot?.exists) transaction.update(approvalReference, { status: 'consumed', contractId: newContractReference.id, consumedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(db.collection('contractRenewalActivities').doc(), { schemaVersion: 1, caseId, sourceContractId, studentId: source.studentId || '', branchId: renewalCase.branchId || '', type: 'renewal_completed', outcome: 'connected', quoteId: quoteId || null, approvalId: approvalId || null, newContractId: newContractReference.id, actorUid: actor.uid, createdAt: FieldValue.serverTimestamp() })
      return { contractId: newContractReference.id, paymentEntryId, unchanged: false }
    })
  })

  const listRenewalCalendar = onCall(async (request) => {
    const actor = await renewalActor(request, db)
    const from = dateKey(request.data?.from || vietnamDateKey(), 'Từ ngày')
    const to = dateKey(request.data?.to || addDaysDateKey(from, 30), 'Đến ngày')
    if (dateOrdinal(to) - dateOrdinal(from) > 92) throw new HttpsError('invalid-argument', 'Khoảng lịch tối đa 92 ngày.')
    const { documents, truncated } = await scopedCaseDocuments(db, actor)
    return { from, to, items: documents.filter((item) => item.nextActionAt >= from && item.nextActionAt <= to).sort((a, b) => String(a.nextActionAt).localeCompare(String(b.nextActionAt))).slice(0, 500).map(publicCase), truncated }
  })

  const getRenewalAnalytics = onCall(async (request) => {
    const actor = await renewalActor(request, db)
    const from = dateKey(request.data?.from || addDaysDateKey(vietnamDateKey(), -30), 'Từ ngày')
    const to = dateKey(request.data?.to || vietnamDateKey(), 'Đến ngày')
    if (dateOrdinal(to) - dateOrdinal(from) > 366) throw new HttpsError('invalid-argument', 'Khoảng báo cáo tối đa 366 ngày.')
    const { documents, truncated } = await scopedCaseDocuments(db, actor, true)
    const relevant = documents.filter((item) => {
      const eventDate = serializeTimestamp(item.wonAt || item.updatedAt || item.createdAt)?.slice(0, 10) || ''
      return eventDate >= from && eventDate <= to
    })
    const won = relevant.filter((item) => item.stage === 'won')
    const lost = relevant.filter((item) => item.stage === 'lost')
    const assignee = new Map()
    relevant.forEach((item) => {
      const key = item.assignedSalesId || 'unassigned'
      const current = assignee.get(key) || { id: key, name: item.assignedSalesName || 'Chưa phân công', total: 0, won: 0, value: 0 }
      current.total += 1
      if (item.stage === 'won') { current.won += 1; current.value += Number(item.wonValue || 0) }
      assignee.set(key, current)
    })
    const lostReasons = {}
    lost.forEach((item) => { const key = item.lostReason || 'Chưa ghi nhận'; lostReasons[key] = (lostReasons[key] || 0) + 1 })
    const stats = renewalStats(documents)
    return { from, to, conversionRate: won.length + lost.length ? won.length / (won.length + lost.length) : 0, wonCases: won.length, lostCases: lost.length, wonValue: won.reduce((sum, item) => sum + Number(item.wonValue || 0), 0), collectedValue: won.reduce((sum, item) => sum + Number(item.collectedValue || 0), 0), weightedPipelineValue: stats.weightedPipelineValue, overdueCases: stats.slaCounts.overdue, stageCounts: stats.stageCounts, lostReasons, assignees: [...assignee.values()].sort((a, b) => b.value - a.value), truncated }
  })

  const refreshContractRenewalQueue = onCall(async (request) => {
    const actor = await renewalActor(request, db)
    if (actor.renewalScope !== 'system') throw new HttpsError('permission-denied', 'Chỉ quản trị hệ thống được đồng bộ hàng đợi.')
    return refreshRenewalQueueCore({ db, dryRun: request.data?.apply !== true, actorUid: actor.uid })
  })

  const scheduled = onSchedule ? onSchedule({ schedule: '0 6 * * *', region: 'asia-southeast1', timeZone: 'Asia/Ho_Chi_Minh', retryCount: 1, cpu: 'gcf_gen1', maxInstances: 1 }, async () => {
    const result = await refreshRenewalQueueCore({ db, dryRun: false, actorUid: 'scheduler:contract-renewals' })
    const reminders = await createRenewalInternalReminders(db)
    logger?.info?.('contract_renewal_queue_refreshed', { ...result, reminders })
  }) : null

  return {
    listContractRenewalCases, listContractRenewalPipeline, listRenewalMessageTemplates, getContractRenewalCaseDetail,
    recordContractRenewalActivity, updateContractRenewalCase, assignContractRenewalCase, transferRenewalCases,
    createRenewalQuote, submitRenewalApproval, decideRenewalApproval, renewPtContract,
    listRenewalCalendar, getRenewalAnalytics, refreshContractRenewalQueue,
    ...(scheduled ? { refreshContractRenewalQueueScheduled: scheduled } : {}),
  }
}

module.exports = { createContractRenewalFunctions, refreshRenewalQueueCore, createRenewalInternalReminders, addMonthsDateKey, normalizeInstallments, renewalRisk, latestContractsByStudent, priorityScore, slaStatus, requiresRenewalApproval, renewalQueueFingerprint, matchesRenewalSegment, renewalStats, renewalMessageTemplates }
