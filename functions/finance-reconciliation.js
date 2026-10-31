'use strict'

const { createHash } = require('node:crypto')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext } = require('./identity-access')
const { attendanceReconciliation } = require('./attendance-reconciliation')
const { chargedRevenuePlan, applyRevenuePlan } = require('./pt-charged-revenue')
const { zeroValueEvidenceKey } = require('./pt-zero-value-evidence')
const { nextServiceOrdinal } = require('./service-ordinal-allocation')
const { readContractRecognitionState } = require('./finance-recognition-balance')
const { revenueSegments } = require('./pt-revenue-allocation')
const { contractSchedulableOn } = require('./contract-status')
const { assertCancellationEvidenceChange } = require('./session-operations')

const id = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new HttpsError('invalid-argument', 'Mã hồ sơ không hợp lệ.')
  return value
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const iso = value => value?.toDate?.().toISOString() || (typeof value === 'string' ? value : '')
const fail = message => { throw new HttpsError('failed-precondition', message) }
const issueMessage = code => ({
  RECOGNITION_CARRY_VALUE_REQUIRES_REVIEW: 'Cần xác minh giá trị chuyển tiếp từ hợp đồng gốc.',
  RECOGNITION_CONTRACT_VALUE_INVALID: 'Giá hoặc giảm giá của hợp đồng chưa hợp lệ.',
  RECOGNITION_SERVICE_ORDINAL_COLLISION: 'Thứ tự buổi trùng với một bút toán khác.',
  RECOGNITION_CONTRACT_VALUE_EXCEEDED: 'Giá trị ghi nhận sẽ vượt giá trị hợp đồng.',
  RECOGNITION_SESSION_ALREADY_RECOGNIZED: 'Buổi đã có doanh thu ở bút toán khác; cần kiểm tra liên kết.',
  RECOGNITION_ZERO_VALUE_REQUIRES_REVIEW: 'Giá trị hợp đồng là 0đ và chưa được xác minh.',
  FINANCE_PERIOD_LOCKED: 'Kỳ tài chính đã khóa.',
}[code] || 'Chứng từ tính buổi chưa khớp; cần đối chiếu hợp đồng và lịch sử trước khi ghi nhận.')
const manage = actor => actor.capabilities.includes('finance.operations.manage') && ['admin', 'super_admin'].includes(actor.accessRole)
function assertRead(actor, branchId) {
  if (actor.capabilities.includes('finance.operations.manage')) return
  if (!actor.capabilities.includes('branch.finance.view') || !branchId || !actor.branchIds.includes(branchId)) {
    throw new HttpsError('permission-denied', 'Bạn không có quyền xem đối soát của chi nhánh này.')
  }
}

function categoryFor(attendance, ledger) {
  const quality = attendanceReconciliation([attendance], ledger)
  return ['conflicts', 'exempt', 'billingReview', 'posted', 'zeroValueConfirmed', 'recognitionReview', 'pendingConfirmation', 'automaticReview', 'unresolved']
    .find(key => quality[key] > 0) || 'unresolved'
}
function exemptionKind(a, s = {}, b = {}) {
  return a.duplicateOfSessionId || s.duplicateOfSessionId || b.billingStatus === 'void_duplicate' ? 'duplicate'
    : a.returnedAt || s.returnedAt || b.billingStatus === 'returned' ? 'returned'
      : a.makeupSession || s.makeupSession || a.exemptionReason ? 'complimentary' : 'other'
}
function contractView(contractId, c) {
  return c ? { id: contractId, packageName: c.packageName || 'Hợp đồng PT', status: c.status || '',
    totalSessions: Number(c.totalSessions || 0), usedSessions: Number(c.usedSessions || 0),
    totalPrice: c.totalPrice ?? null, discount: c.discount ?? 0, paidAmount: c.paidAmount ?? null,
    startDate: c.startDate || '', endDate: c.endDate || '' } : null
}
function eligibleContract(c, studentId, date) {
  return c.studentId === studentId && contractSchedulableOn(c, date)
    && !c.renewalSupersededBy && !Number(c.carryOverTransferredSessions || 0)
    && (!c.cancellationSettlement || c.cancellationSettlement.status === 'review_required')
    && typeof c.startDate === 'string' && typeof c.endDate === 'string' && c.startDate <= date && c.endDate >= date
    && Number.isSafeInteger(c.totalSessions) && Number.isSafeInteger(c.usedSessions || 0)
    && c.totalSessions > Number(c.usedSessions || 0)
}

// All source reads participate in a transaction on confirmation. The preview
// token includes their versions, so a stale screen cannot approve new evidence.
async function readCase({ db, transaction, attendanceId, actor, targetContractId = '' }) {
  const versions = new Map()
  const get = async ref => {
    const snapshot = await transaction.get(ref)
    const docs = snapshot.docs || [snapshot]
    for (const doc of docs) versions.set(doc.ref.path, doc.exists ? [doc.updateTime?.seconds, doc.updateTime?.nanoseconds] : null)
    return snapshot
  }
  const doc = async (collection, value) => value ? (await get(db.doc(`${collection}/${id(value)}`))).data() || null : null
  const attendance = await doc('attendanceEvents', attendanceId)
  if (!attendance) throw new HttpsError('not-found', 'Bằng chứng này không còn tồn tại. Hãy làm mới báo cáo.')
  assertRead(actor, attendance.branchId)
  const sessionId = id(attendance.chargeId || attendance.sessionId || attendanceId)
  const [session, billing, review, returned] = await Promise.all([
    doc('sessions', sessionId), doc('sessionBillingEvents', sessionId), doc('revenueRecognitionReviews', sessionId), doc('sessionReturns', sessionId),
  ])
  if (session) assertRead(actor, session.branchId || attendance.branchId)
  const contractId = session?.contractId || attendance.contractId || ''
  const periodId = String(session?.date || iso(attendance.occurredAt)).slice(0, 7)
  const [contract, period, payroll, billingIssue, duplicates, bySession, byAttendance] = await Promise.all([
    doc('contracts', contractId), doc('financePeriods', periodId), doc('payrollRuns', periodId), doc('sessionBillingIssues', sessionId),
    get(db.collection('attendanceEvents').where('sessionId', '==', attendance.sessionId || sessionId).limit(21)),
    get(db.collection('ledgerEntries').where('sessionId', '==', sessionId).limit(21)),
    get(db.collection('ledgerEntries').where('attendanceEventId', '==', attendanceId).limit(21)),
  ])
  if ([duplicates, bySession, byAttendance].some(s => s.size > 20)) fail('Hồ sơ có quá nhiều liên kết; cần kiểm tra riêng trước khi xác nhận.')
  const ledgerMap = new Map([...bySession.docs, ...byAttendance.docs].map(d => [d.id, { ...d.data(), id: d.id }]))
  const directId = attendance.revenueRecognitionEntryId || session?.revenueRecognitionEntryId
  if (directId && !ledgerMap.has(directId)) { const entry = await doc('ledgerEntries', directId); if (entry) ledgerMap.set(directId, { ...entry, id: directId }) }
  const ledger = [...ledgerMap.values()]
  const category = categoryFor({ ...attendance, id: attendanceId }, ledger)
  let candidates = [], target = null
  if (category === 'billingReview' && session && manage(actor)) {
    const snapshot = await get(db.collection('contracts').where('studentId', '==', session.studentId).limit(101))
    if (snapshot.size > 100) fail('Có quá nhiều hợp đồng; cần kiểm tra riêng hồ sơ học viên.')
    candidates = snapshot.docs.map(d => ({ ...d.data(), id: d.id })).filter(c => eligibleContract(c, session.studentId, session.date))
    if (targetContractId) target = candidates.find(c => c.id === targetContractId) || null
  }
  const evidence = { attendanceId, attendance, sessionId, session, billing, review, returned, contractId, contract, period, payroll, billingIssue,
    category, ledger, candidates, target, linkedEvidence: duplicates.docs.map(d => ({ ...d.data(), id: d.id })) }
  const actions = [{ id: 'acknowledge', label: 'Lưu xác nhận đã kiểm tra', sessionsDelta: 0, revenueDelta: 0, cashDelta: 0 }]
  const blockers = [], plans = {}
  const canonical = session && attendance.sessionId === sessionId && (!attendance.chargeId || attendance.chargeId === sessionId)
    && attendance.contractId === session.contractId && attendance.studentId === session.studentId && contract?.studentId === session.studentId
    && evidence.linkedEvidence.filter(a => !a.chargeId || a.chargeId === sessionId).length === 1
  const unlocked = period?.status !== 'locked'
  if (!unlocked) blockers.push('Kỳ tài chính đã khóa. Có thể ghi chú kiểm tra; điều chỉnh tài chính cần thực hiện tại kỳ mở.')
  if (!canonical) blockers.push('Liên kết buổi tập chưa đầy đủ hoặc có nhiều bằng chứng. Cần kiểm tra lịch sử trước khi thay đổi.')
  const payrollOpen = !payroll || payroll.status === 'draft'
  if (!payrollOpen) blockers.push('Kỳ lương đã chốt. Có thể ghi chú kiểm tra; thay đổi ảnh hưởng tính lương cần điều chỉnh tại kỳ mở.')
  let contractOpen = true
  if (canonical) {
    try { assertCancellationEvidenceChange({ contract, sourceDate: session.date, changed: true }) }
    catch (error) { if (!(error instanceof HttpsError)) throw error; blockers.push(error.message); contractOpen = false }
  }
  if (canonical && unlocked && payrollOpen && contractOpen && manage(actor)) {
    if (session.billingStatus === 'charged' && billing?.billingStatus === 'charged' && billing.contractId === contractId && billing.sessionId === sessionId) {
      try {
        const serviceOrdinal = Number(billing.serviceOrdinal || session.serviceOrdinal || attendance.serviceOrdinal)
        const input = { transaction: { get }, db, sessionId, session, attendance: { ...attendance, id: attendanceId }, billing,
          contractId, contract, serviceOrdinal, actorUid: actor.uid }
        const plan = await chargedRevenuePlan(input)
        if (plan.allocation) assertCancellationEvidenceChange({ contract: plan.allocation.contract, sourceDate: session.date, changed: true })
        plans.recognize = plan
        if (plan.issue === 'RECOGNITION_ZERO_VALUE_REQUIRES_REVIEW') {
          const approval = { evidenceKey: zeroValueEvidenceKey({ sessionId, contractId, serviceOrdinal, allocation: plan.allocation }),
            approvedBy: actor.uid, approvedAt: Timestamp.now() }
          const zeroPlan = await chargedRevenuePlan({ ...input, session: { ...session, zeroValueApproval: approval } })
          if (zeroPlan.zeroValueConfirmed) { plans.confirm_zero = zeroPlan; actions.push({ id: 'confirm_zero', label: 'Xác nhận giá trị 0đ hợp lệ', sessionsDelta: 0, revenueDelta: 0, cashDelta: 0 }) }
        } else if (!plan.issue && (plan.recognition || plan.journal || plan.writes.length)) {
          actions.push({ id: 'recognize', label: 'Đối soát và ghi nhận doanh thu', sessionsDelta: 0, revenueDelta: plan.createdRevenue, cashDelta: 0 })
        }
        if (plan.issue && plan.issue !== 'RECOGNITION_ZERO_VALUE_REQUIRES_REVIEW') blockers.push(issueMessage(plan.issue))
      } catch (error) { if (!(error instanceof HttpsError)) throw error; blockers.push(error.message) }
    }
    const uncharged = category === 'billingReview' && !billing && session.billingStatus === 'review_required'
      && !session.serviceOrdinal && !attendance.serviceOrdinal && !ledger.length
      && ![...(contract.chargedSessionIds || []), ...(contract.attendedClasses || [])].includes(sessionId)
    if (uncharged && (!payroll || payroll.status === 'draft')) {
      actions.push({ id: 'exempt', label: 'Duyệt không trừ buổi', sessionsDelta: 0, revenueDelta: 0, cashDelta: 0 })
      if (target) {
        const [sameDay, billings] = await Promise.all([
          get(db.collection('sessions').where('studentId', '==', session.studentId).where('date', '==', session.date).limit(201)),
          get(db.collection('sessionBillingEvents').where('contractId', '==', target.id).limit(5001)),
        ])
        const duplicate = sameDay.size > 200 || sameDay.docs.some(d => d.id !== sessionId && d.data().billingStatus === 'charged' && d.data().attendanceStatus !== 'policy_charge')
        if (!duplicate && billings.size <= 5000) {
          const state = await readContractRecognitionState({ get }, db, target.id)
          const ordinal = nextServiceOrdinal({ usedSessions: target.usedSessions, totalSessions: target.totalSessions,
            billings: billings.docs.map(d => d.data()), revenueOrdinals: target.revenueAllocation ? [] : [...state.revenueByOrdinal].filter(([, rows]) => [...rows.values()].some(n => n > 0)).map(([n]) => n) })
          if (ordinal) {
            const nextSession = { ...session, contractId: target.id, serviceOrdinal: ordinal, billingStatus: 'charged' }
            const nextBilling = { sessionId, studentId: session.studentId, contractId: target.id, serviceOrdinal: ordinal, billingStatus: 'charged' }
            const plan = await chargedRevenuePlan({ transaction: { get }, db, sessionId, session: nextSession,
              attendance: { ...attendance, id: attendanceId, contractId: target.id, serviceOrdinal: ordinal }, billing: nextBilling,
              contractId: target.id, contract: target, serviceOrdinal: ordinal, actorUid: actor.uid, knownState: state })
            if (!plan.issue) { plans.assign_contract = { ...plan, ordinal, nextBilling }; actions.push({ id: 'assign_contract', label: 'Tính buổi vào hợp đồng đã chọn', sessionsDelta: 1, revenueDelta: plan.createdRevenue, cashDelta: 0 }) }
            else blockers.push(issueMessage(plan.issue))
          }
        } else blockers.push('Có buổi đã tính trong ngày hoặc lịch sử vượt giới hạn; cần đối soát trước.')
      }
    }
  }
  const token = hash([...versions].sort(([a], [b]) => a.localeCompare(b)))
  return { ...evidence, actions: manage(actor) ? actions : [], blockers, plans, token }
}

function rowView(attendanceId, a, session, names, ledger = []) {
  return { attendanceId, sessionId: a.chargeId || a.sessionId || attendanceId, studentId: a.studentId || '', trainerId: a.trainerId || '',
    studentName: names.get(a.studentId) || 'Học viên', trainerName: names.get(a.trainerId) || 'Chưa có PT',
    date: session?.date || iso(a.occurredAt).slice(0, 10), hour: session?.hour ?? null, branchId: a.branchId || '',
    billingStatus: a.billingStatus || session?.billingStatus || '', attendanceStatus: a.attendanceStatus || 'pending',
    category: categoryFor({ ...a, id: attendanceId }, ledger), exemptionKind: exemptionKind(a, session),
    issueCode: a.billingStatus === 'review_required' ? a.billingIssueCode || session?.billingIssueCode || 'BILLING_REVIEW_REQUIRED'
      : a.recognitionReviewIssueCode || session?.recognitionReviewIssueCode || '',
    contractId: a.contractId || session?.contractId || '', reason: a.exemptionReason || a.returnReason || a.note || '' }
}
async function namesFor(db, rows) {
  const studentIds = [...new Set(rows.map(a => a.studentId).filter(Boolean))], trainerIds = [...new Set(rows.map(a => a.trainerId).filter(Boolean))]
  const refs = [...studentIds.map(v => db.doc(`students/${id(v)}`)), ...trainerIds.map(v => db.doc(`users/${id(v)}`))]
  const docs = refs.length ? await db.getAll(...refs) : []
  return new Map(docs.filter(d => d.exists).map(d => [d.id, d.data().name || d.data().displayName || 'Chưa có tên']))
}

async function resolveCase({ db, actor, input }) {
  if (!manage(actor)) throw new HttpsError('permission-denied', 'Chỉ quản trị viên tài chính được xác nhận đối soát.')
  const attendanceId = id(input.attendanceId), requestId = id(input.requestId), action = String(input.action)
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (reason.length < 5 || reason.length > 1000 || !/^[a-f0-9]{64}$/.test(input.token || '')) throw new HttpsError('invalid-argument', 'Cần tải bằng chứng mới và nhập lý do từ 5 đến 1.000 ký tự.')
  const targetContractId = input.targetContractId ? id(input.targetContractId) : ''
  const signature = hash([actor.uid, attendanceId, action, reason, targetContractId, input.token])
  const caseRef = db.doc(`financeReconciliationCases/${attendanceId}`), receiptRef = caseRef.collection('actions').doc(requestId)
  return db.runTransaction(async transaction => {
    const receipt = await transaction.get(receiptRef)
    if (receipt.exists) {
      if (receipt.data().signature !== signature) throw new HttpsError('already-exists', 'Mã xác nhận đã được dùng cho nội dung khác.')
      return { ...receipt.data().result, unchanged: true }
    }
    const state = await readCase({ db, transaction, attendanceId, actor, targetContractId })
    if (state.token !== input.token) throw new HttpsError('aborted', 'Dữ liệu đã thay đổi. Hãy mở lại bằng chứng và kiểm tra trước khi xác nhận.')
    const effect = state.actions.find(a => a.id === action)
    if (!effect) fail('Thao tác không còn phù hợp với bằng chứng hiện tại.')
    const { sessionId, session, attendance, billing, target } = state
    const audit = { updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() }
    const patch = { ...audit, reconciliationReason: reason, reconciliationActionId: requestId }
    if (['recognize', 'confirm_zero', 'assign_contract'].includes(action)) {
      const plan = state.plans[action]
      applyRevenuePlan(transaction, plan)
      Object.assign(patch, plan.patch)
      if (action === 'assign_contract') {
        Object.assign(patch, { contractId: target.id, serviceOrdinal: plan.ordinal, billingStatus: 'charged', billingIssueCode: null, countsTowardContract: true,
          billingEventId: sessionId, attendanceEventId: attendanceId, chargedAt: FieldValue.serverTimestamp(), renewalHandoverPending: false })
        transaction.create(db.doc(`sessionBillingEvents/${sessionId}`), { schemaVersion: 3, type: 'session_charge', ...plan.nextBilling, ...plan.patch,
          trainerId: session.trainerId || '', branchId: attendance.branchId || '', scheduledAt: attendance.occurredAt,
          createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), chargedAt: FieldValue.serverTimestamp(), reconciliationActionId: requestId })
        transaction.update(db.doc(`contracts/${target.id}`), { usedSessions: Number(target.usedSessions || 0) + 1,
          ...(!target.revenueAllocation ? { revenueAllocation: { version: 1, segments: revenueSegments(target.id, target) } } : {}),
          chargedSessionIds: FieldValue.arrayUnion(sessionId), attendedClasses: FieldValue.arrayUnion(sessionId), revision: FieldValue.increment(1), ...audit })
      } else if (billing) transaction.update(db.doc(`sessionBillingEvents/${sessionId}`), { ...plan.patch, ...audit })
    }
    if (action === 'exempt') Object.assign(patch, { billingStatus: 'exempt', billingIssueCode: null, countsTowardContract: false,
      exemptionReason: reason, exemptedBy: actor.uid, exemptedAt: FieldValue.serverTimestamp(),
      recognitionReviewRequired: false, recognitionReviewIssueCode: null, revenueRecognitionState: 'not_applicable' })
    if (action !== 'acknowledge') {
      transaction.update(db.doc(`attendanceEvents/${attendanceId}`), patch)
      transaction.update(db.doc(`sessions/${sessionId}`), { ...patch, revision: Number(session.revision || 0) + 1 })
      if (['exempt', 'assign_contract'].includes(action) && state.billingIssue) transaction.update(db.doc(`sessionBillingIssues/${sessionId}`), { status: 'resolved', resolution: action, resolvedBy: actor.uid, resolvedAt: FieldValue.serverTimestamp() })
      if (action === 'exempt' && state.review) transaction.update(db.doc(`revenueRecognitionReviews/${sessionId}`), { status: 'resolved', resolution: action, resolvedBy: actor.uid, resolvedAt: FieldValue.serverTimestamp() })
      if (state.payroll) transaction.update(db.doc(`payrollRuns/${session.date.slice(0, 7)}`), { requiresRebuild: true, sourceDataStale: true, sourceDataChangeReason: reason, sourceDataChangedAt: FieldValue.serverTimestamp(), sourceDataChangedBy: actor.uid })
      transaction.create(db.collection('sessionEvents').doc(), { type: 'finance_reconciliation', action, sessionId, reason,
        previousContractId: state.contractId, contractId: target?.id || state.contractId, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() })
    }
    const result = { action, unchanged: false, ...effect }
    transaction.set(caseRef, { attendanceId, sessionId, evidenceToken: state.token, action, reason, actorName: actor.actorName || 'Quản trị viên', ...audit })
    transaction.create(receiptRef, { signature, result, action, reason, actorUid: actor.uid, actorName: actor.actorName || 'Quản trị viên',
      evidenceToken: state.token, before: { contractId: state.contractId, billingStatus: attendance.billingStatus || '', category: state.category },
      after: { contractId: target?.id || state.contractId, billingStatus: patch.billingStatus || attendance.billingStatus || '' }, createdAt: FieldValue.serverTimestamp() })
    return result
  })
}

function createFinanceReconciliationFunctions({ db, onCall }) {
  const call = handler => onCall({ cpu: 'gcf_gen1', concurrency: 1, maxInstances: 2, timeoutSeconds: 120, invoker: 'public' }, handler)
  const listFinanceReconciliationCases = call(async request => {
    const actor = await trustedAccessContext(request, db)
    const ids = request.data?.attendanceIds
    if (!Array.isArray(ids) || !ids.length || ids.length > 25 || new Set(ids).size !== ids.length) throw new HttpsError('invalid-argument', 'Mỗi trang xem tối đa 25 buổi.')
    const docs = await db.getAll(...ids.map(v => db.doc(`attendanceEvents/${id(v)}`)))
    const attendance = docs.filter(d => d.exists).map(d => ({ ...d.data(), id: d.id }))
    attendance.forEach(a => assertRead(actor, a.branchId))
    const sessionIds = [...new Set(attendance.map(a => a.chargeId || a.sessionId || a.id))]
    const [sessions, names] = await Promise.all([sessionIds.length ? db.getAll(...sessionIds.map(v => db.doc(`sessions/${id(v)}`))) : [], namesFor(db, attendance)])
    const byId = new Map(sessions.filter(d => d.exists).map(d => [d.id, d.data()]))
    return { rows: attendance.map(a => rowView(a.id, a, byId.get(a.chargeId || a.sessionId || a.id), names)), missing: ids.filter(v => !attendance.some(a => a.id === v)) }
  })
  const getFinanceReconciliationCase = call(async request => {
    const actor = await trustedAccessContext(request, db)
    const attendanceId = id(request.data?.attendanceId)
    const state = await db.runTransaction(transaction => readCase({ db, transaction, attendanceId, actor, targetContractId: request.data?.targetContractId ? id(request.data.targetContractId) : '' }), { readOnly: true })
    const [names, history] = await Promise.all([namesFor(db, [state.attendance]), db.doc(`financeReconciliationCases/${attendanceId}`).collection('actions').orderBy('createdAt', 'desc').limit(20).get()])
    const allocation = state.plans.recognize?.allocation
    return { ...rowView(attendanceId, state.attendance, state.session, names, state.ledger), token: state.token,
      contract: contractView(state.contractId, state.contract), revenueContract: allocation ? contractView(allocation.contractId, allocation.contract) : null,
      actions: state.actions, blockers: state.blockers, candidates: state.candidates.map(c => contractView(c.id, c)),
      duplicateOfSessionId: state.attendance.duplicateOfSessionId || state.billing?.duplicateOfSessionId || '',
      billing: state.billing ? { status: state.billing.billingStatus, ordinal: state.billing.serviceOrdinal || null } : null,
      returned: state.returned ? { reason: state.returned.returnReason || '', returnedSessions: state.returned.returnedSessions, revenueReversed: state.returned.revenueReversed } : null,
      ledger: state.ledger.map(e => ({ id: e.id, status: e.status, type: e.type, revenue: Number(e.revenueImpact || 0), cash: Number(e.cashImpact || 0), date: iso(e.effectiveAt), contractId: e.contractId || '' })),
      history: history.docs.map(d => ({ id: d.id, action: d.data().action, reason: d.data().reason, actorName: d.data().actorName,
        createdAt: iso(d.data().createdAt), effect: d.data().result, currentEvidence: d.data().evidenceToken === state.token })) }
  })
  const resolveFinanceReconciliationCase = call(async request => resolveCase({ db, actor: await trustedAccessContext(request, db, { freshAssignment: true }), input: request.data || {} }))
  return { listFinanceReconciliationCases, getFinanceReconciliationCase, resolveFinanceReconciliationCase }
}
module.exports = { createFinanceReconciliationFunctions, readCase, resolveCase, categoryFor, eligibleContract, exemptionKind }
