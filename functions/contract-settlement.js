'use strict'

const { createHash } = require('node:crypto')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { ledgerReceiptImpact } = require('./finance-receipt-impact')
const { CHART_OF_ACCOUNTS, assertBalancedJournal } = require('./accounting-core')

const MAX_EVIDENCE = 5000
const POLICY = 'aura_cancellation_settlement_v1'
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
}
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const posted = row => ['posted', 'reversed'].includes(row.status)
const isSettlement = row => row.eventClass?.startsWith('contract_settlement_')
const fail = (code, message, issueCode) => { throw new HttpsError(code, message, issueCode ? { issueCode } : undefined) }
const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : ''
function identifier(value) {
  const result = text(value, 128)
  if (!result || !/^[A-Za-z0-9_-]+$/.test(result)) fail('invalid-argument', 'Mã hồ sơ hoặc thao tác không hợp lệ.')
  return result
}
function money(value, label = 'Số tiền') {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') fail('invalid-argument', `${label} phải là số tiền nguyên không âm.`)
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0 || result > 100_000_000_000) fail('invalid-argument', `${label} phải là số tiền nguyên không âm.`)
  return result
}
function signed(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) fail('failed-precondition', 'Chứng từ có số tiền không hợp lệ.', 'SETTLEMENT_MALFORMED_LEDGER')
  return result
}
function plus(a, b) { return signed(a + b) }
function dateKey(value) {
  const raw = text(value, 10)
  const parsed = new Date(`${raw}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : ''
}
function localDay(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
}
function normalizedInstant(value) {
  if (value === undefined || value === null || value === '') return ''
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}
function cancellationDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return dateKey(value)
  const instant = normalizedInstant(value)
  return instant ? localDay(new Date(instant)) : ''
}
function confirmedCancellationCutoff(contract) {
  const persisted = contract.cancellationSettlement?.cutoffDate
  // Match the session evidence guard: a present summary date takes precedence
  // even when malformed. Never hide that required repair with a fallback date.
  if (persisted) return typeof persisted === 'string' && persisted === dateKey(persisted) ? persisted : null
  return cancellationDate(contract.cancelledAt) || null
}
const chargedSession = session => session.billingStatus === 'charged' || (!session.billingStatus && ['completed', 'attended', 'no_show'].includes(session.status))
const cancelledSession = session => ['cancelled', 'student_cancelled', 'trainer_cancelled', 'canceled_by_student'].includes(session.status) || session.scheduleStatus === 'cancelled'
function revenue(row) {
  return posted(row) ? signed(row.revenueImpact ?? (row.type === 'revenue_recognition' ? row.amount : 0)) : 0
}
const selectFields = {
  ledgerEntries: ['type', 'status', 'eventClass', 'source', 'amount', 'cashImpact', 'revenueImpact', 'expenseImpact', 'sessionId', 'sourceSessionId', 'attendanceEventId', 'sessionRequestId', 'recognitionPolicy', 'confirmationSource', 'evidenceStatus', 'serviceOrdinal', 'serviceTotal', 'reversedEntryId', 'effectiveAt', 'settlementId', 'receivableImpact', 'deferredRevenueImpact'],
  sessions: ['studentId', 'date', 'hour', 'status', 'scheduleStatus', 'billingStatus', 'attendanceStatus', 'serviceOrdinal', 'revenueRecognitionEntryId', 'recognitionReviewRequired'],
  revenueRecognitionReviews: ['status', 'issueCode', 'sessionId'],
  sessionBillingIssues: ['status', 'issueCode', 'sessionId'],
}
async function boundedRows(transaction, db, collection, contractId) {
  const result = await transaction.get(db.collection(collection).where('contractId', '==', contractId).select(...selectFields[collection]).limit(MAX_EVIDENCE + 1))
  if (result.size > MAX_EVIDENCE) fail('resource-exhausted', 'Dữ liệu vượt giới hạn đối soát an toàn. Chưa thể quyết toán.', 'SETTLEMENT_EVIDENCE_TRUNCATED')
  return result.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.id.localeCompare(b.id))
}

// Shared by approval, cash guards and closure. No writes; cash-only ledger
// entries do not change serviceEvidenceHash, while every approval uses the
// stronger snapshotHash which includes money and current contract revision.
async function readSettlementEvidence(transaction, db, contractId, contract, proposedCutoff) {
  const [ledger, sessions, reviews, billingIssues] = await Promise.all(Object.keys(selectFields).map(name => boundedRows(transaction, db, name, contractId)))
  const blockers = [], warnings = []
  const block = (code, message) => { if (!blockers.some(item => item.code === code)) blockers.push({ code, message }) }
  const originalNetValue = Math.max(0, money(contract.totalPrice ?? 0) - money(contract.discount ?? 0))
  const paidProjection = money(contract.paidAmount ?? 0)
  const cutoffDate = proposedCutoff || contract.cancellationSettlement?.cutoffDate
    ? dateKey(proposedCutoff || contract.cancellationSettlement.cutoffDate) : cancellationDate(contract.cancelledAt)
  if (!cutoffDate) block('SETTLEMENT_CUTOFF_REQUIRED', 'Cần xác minh và nhập ngày kết thúc hiệu lực.')
  else if (cutoffDate > localDay()) block('SETTLEMENT_CUTOFF_INVALID', 'Ngày kết thúc không được ở tương lai.')
  if (contract.status !== 'cancelled') block('SETTLEMENT_CONTRACT_NOT_CANCELLED', 'Cần kết thúc hiệu lực hợp đồng trước khi quyết toán.')
  if (contract.sourceContractId || contract.renewedByContractId || contract.renewalSupersededBy || Number(contract.carriedOverSessions || 0) || Number(contract.carryOverTransferredSessions || 0)) {
    block('SETTLEMENT_RENEWAL_REQUIRES_REVIEW', 'Hợp đồng liên quan tái ký/chuyển buổi cần phương án đối soát riêng.')
  }
  let canonicalCash = 0, recognizedRevenue = 0, serviceRecognizedRevenue = 0
  const identity = new Map(), byId = new Map(ledger.map(row => [row.id, row]))
  const sessionRevenue = new Map(), ordinalRevenue = new Map()
  for (const row of ledger) {
    if (!posted(row)) continue
    if (row.cashImpact !== null && row.cashImpact !== undefined) signed(row.cashImpact)
    canonicalCash = plus(canonicalCash, signed(ledgerReceiptImpact(row)))
    const impact = revenue(row)
    recognizedRevenue = plus(recognizedRevenue, impact)
    if (isSettlement(row)) continue
    serviceRecognizedRevenue = plus(serviceRecognizedRevenue, impact)
    if (!impact) continue
    const original = impact < 0 ? byId.get(row.reversedEntryId) : null
    const sessionId = row.sessionId || original?.sessionId
    const ordinal = Number(row.serviceOrdinal ?? original?.serviceOrdinal)
    if (!sessionId || !Number.isSafeInteger(ordinal) || ordinal < 1) block('SETTLEMENT_RECOGNITION_IDENTITY_MISSING', 'Có doanh thu thiếu mã buổi hoặc thứ tự dịch vụ để đối soát.')
    if (sessionId) sessionRevenue.set(sessionId, plus(sessionRevenue.get(sessionId) || 0, impact))
    if (sessionId && Number.isSafeInteger(ordinal) && ordinal > 0) {
      const values = ordinalRevenue.get(ordinal) || new Map()
      values.set(sessionId, plus(values.get(sessionId) || 0, impact)); ordinalRevenue.set(ordinal, values)
    }
    const rootId = impact < 0 ? row.reversedEntryId : row.id
    if (rootId) identity.set(rootId, plus(identity.get(rootId) || 0, impact))
  }
  if (canonicalCash < 0 || canonicalCash !== paidProjection) block('SETTLEMENT_CASH_PROJECTION_MISMATCH', 'Số đã thanh toán chưa khớp tiền thu ròng trong sổ chính; cần đối chiếu chứng từ.')
  if (ledger.some(row => posted(row) && isSettlement(row)) && !['approved', 'settled'].includes(contract.cancellationSettlement?.status)) block('SETTLEMENT_ORPHANED_ADJUSTMENT', 'Có điều chỉnh quyết toán chưa khớp hồ sơ phê duyệt.')
  if (serviceRecognizedRevenue < 0 || serviceRecognizedRevenue > originalNetValue) block('SETTLEMENT_REVENUE_OUT_OF_BOUNDS', 'Doanh thu dịch vụ nằm ngoài giá trị hợp đồng, cần đối soát trước.')
  const positiveIdentities = new Map()
  const sessionsById = new Map(sessions.map(session => [session.id, session]))
  const sourceSessionRevenue = new Map()
  const isPolicyCharge = row => row?.recognitionPolicy === 'approved_policy_charge_v2'
    && row.confirmationSource === 'approved_policy' && row.evidenceStatus === 'policy_charge' && row.sourceSessionId
  const policyIds = [...new Set([...identity].filter(([entryId, amount]) => amount > 0 && isPolicyCharge(byId.get(entryId)))
    .map(([entryId]) => byId.get(entryId).attendanceEventId).filter(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)))].sort()
  // These point reads only validate policy services already present in the
  // bounded ledger; the synthetic service has no sessions/{policy_id} row.
  const policyEvidence = await Promise.all(policyIds.map(async id => {
    const snapshot = await transaction.get(db.doc(`attendanceEvents/${id}`))
    const value = snapshot.exists ? snapshot.data() : {}
    return { id, exists: snapshot.exists, ...Object.fromEntries(['type', 'attendanceStatus', 'sessionId', 'sessionRequestId', 'chargeId', 'studentId', 'contractId', 'scheduledFor'].filter(key => value[key] !== undefined).map(key => [key, value[key]])) }
  }))
  const policyById = new Map(policyEvidence.map(row => [row.id, row]))
  for (const [entryId, amount] of identity) if (amount > 0) {
    const row = byId.get(entryId)
    const sessionId = row?.sessionId
    if (sessionId) positiveIdentities.set(sessionId, (positiveIdentities.get(sessionId) || 0) + 1)
    // Approved policy charges have a synthetic service id and retain their
    // actual cancelled/rescheduled session as sourceSessionId.
    const policyCharge = isPolicyCharge(row)
    const sourceId = policyCharge ? row.sourceSessionId : sessionId
    const source = sessionsById.get(sourceId)
    if (!source) block('SETTLEMENT_RECOGNITION_SOURCE_MISSING', 'Có doanh thu chưa tìm thấy buổi nguồn để xác minh dịch vụ; cần đối soát trước.')
    else {
      const proof = policyCharge ? policyById.get(row.attendanceEventId) : null
      const policyValid = proof?.exists && ['charged_cancellation', 'charged_reschedule'].includes(proof.type)
        && proof.attendanceStatus === 'policy_charge' && proof.contractId === contractId && proof.studentId === contract.studentId
        && proof.sessionId === sourceId && proof.sessionRequestId === row.sessionRequestId && Boolean(row.sessionRequestId)
        && proof.chargeId === row.sessionId && row.attendanceEventId === row.sessionId && row.sessionId === `policy_${row.sessionRequestId}`
      const cancellationEvidence = !cancelledSession(source) || (source.billingStatus === 'charged'
        && ['present', 'late', 'no_show'].includes(source.attendanceStatus))
      if ((policyCharge ? !policyValid : !chargedSession(source) || source.billingStatus === 'exempt' || !cancellationEvidence) || source.studentId !== contract.studentId) {
        block('SETTLEMENT_RECOGNITION_SOURCE_INVALID', 'Doanh thu không khớp buổi có tính phí và đúng học viên; cần đối soát trước.')
      }
      if (policyCharge && (!dateKey(proof?.scheduledFor) || (cutoffDate && dateKey(proof.scheduledFor) > cutoffDate))) block('SETTLEMENT_SERVICE_AFTER_CUTOFF', 'Có buổi chưa được xử lý hoặc tính phí sau ngày kết thúc hiệu lực.')
      if (!policyCharge || (source.billingStatus === 'charged' && source.attendanceStatus === 'policy_charge')) sourceSessionRevenue.set(sourceId, plus(sourceSessionRevenue.get(sourceId) || 0, amount))
    }
  }
  if ([...positiveIdentities.values()].some(count => count > 1) || [...ordinalRevenue.values()].some(values => [...values.values()].filter(amount => amount > 0).length > 1)) {
    block('SETTLEMENT_DUPLICATE_RECOGNITION', 'Có nhiều bút toán dương cho cùng buổi hoặc thứ tự dịch vụ.')
  }
  for (const session of sessions) {
    const sessionDate = dateKey(session.date)
    const charged = chargedSession(session)
    const live = !['cancelled', 'student_cancelled', 'trainer_cancelled', 'canceled_by_student'].includes(session.status) && session.scheduleStatus !== 'cancelled' && session.billingStatus !== 'exempt'
    if (session.studentId && session.studentId !== contract.studentId) block('SETTLEMENT_SESSION_STUDENT_MISMATCH', 'Có buổi liên kết sai học viên.')
    if ((charged || live) && (!sessionDate || (cutoffDate && sessionDate > cutoffDate))) block('SETTLEMENT_SERVICE_AFTER_CUTOFF', 'Có buổi chưa được xử lý hoặc tính phí sau ngày kết thúc hiệu lực.')
    if (charged && originalNetValue > 0 && !(sessionRevenue.get(session.id) > 0) && !(sourceSessionRevenue.get(session.id) > 0)) block('SETTLEMENT_MISSING_RECOGNITION', 'Có buổi đã tính phí chưa có doanh thu được đối soát; không tự ghi bù khi quyết toán.')
    if (session.recognitionReviewRequired || session.billingStatus === 'review_required') block('SETTLEMENT_SERVICE_REVIEW_OPEN', 'Có buổi đang chờ đối soát tài chính.')
  }
  const openReviews = [...reviews, ...billingIssues].filter(row => !['resolved', 'closed', 'dismissed'].includes(row.status))
  if (openReviews.length) block('SETTLEMENT_FINANCE_REVIEW_OPEN', 'Còn hồ sơ đối soát buổi/doanh thu chưa xử lý.')
  const sales = contract.salesCancellationSnapshot
  const salesBaselineVerified = sales?.schemaVersion === 1 && sales.netAmount === (contract.salesOriginalSnapshot?.netAmount ?? originalNetValue) && Boolean(normalizedInstant(sales.effectiveAt))
  if (!salesBaselineVerified) warnings.push({ code: 'SETTLEMENT_SALES_BASELINE_UNVERIFIED', message: 'Chưa xác minh doanh số ký gốc; quyết toán không tự khôi phục hoặc ghi giảm doanh số lịch sử.' })
  const stableLedger = ledger.filter(row => revenue(row) && !isSettlement(row)).map(row => ({ ...row, effectiveAt: normalizedInstant(row.effectiveAt) }))
  const coreTerms = { studentId: contract.studentId || '', branchId: contract.branchId || '', status: contract.status, totalPrice: contract.totalPrice ?? 0, discount: contract.discount ?? 0, totalSessions: contract.totalSessions ?? 0, startDate: contract.startDate || '', endDate: contract.endDate || '', sourceContractId: contract.sourceContractId || '', renewedByContractId: contract.renewedByContractId || '', renewalSupersededBy: contract.renewalSupersededBy || '', carriedOverSessions: contract.carriedOverSessions || 0, carryOverTransferredSessions: contract.carryOverTransferredSessions || 0, salesCancellationSnapshot: sales || null }
  const serviceEvidenceHash = hash({ cutoffDate, coreTerms, ledger: stableLedger, sessions, reviews, billingIssues, policyEvidence })
  const snapshotHash = hash({ serviceEvidenceHash, canonicalCash, paidProjection, recognizedRevenue, contractRevision: contract.revision || 0, ledger: ledger.map(row => ({ ...row, effectiveAt: normalizedInstant(row.effectiveAt) })) })
  return { originalNetValue, canonicalCash, paidProjection, recognizedRevenue, serviceRecognizedRevenue, unservedValue: Math.max(0, originalNetValue - serviceRecognizedRevenue), cutoffDate, blockers, warnings, salesBaselineVerified, snapshotHash, serviceEvidenceHash, evidenceCounts: { ledger: ledger.length, sessions: sessions.length, openReviews: openReviews.length } }
}

function proposalInput(value, preview) {
  if (!value || typeof value !== 'object') fail('invalid-argument', 'Cần nhập phương án quyết toán.')
  const proposal = { cutoffDate: dateKey(value.cutoffDate), reason: text(value.reason), waivedFutureAmount: money(value.waivedFutureAmount, 'Phần dịch vụ tương lai được miễn'), feeAmount: money(value.feeAmount ?? 0), feeReason: text(value.feeReason), serviceReductionAmount: money(value.serviceReductionAmount ?? 0), serviceReductionReason: text(value.serviceReductionReason), writeOffAmount: money(value.writeOffAmount ?? 0), writeOffReason: text(value.writeOffReason), effectiveAt: normalizedInstant(value.effectiveAt) }
  if (!proposal.cutoffDate || proposal.reason.length < 2 || !proposal.effectiveAt) fail('invalid-argument', 'Cần ngày kết thúc, lý do và ngày ghi nhận điều chỉnh hợp lệ.')
  if (proposal.waivedFutureAmount !== preview.unservedValue) fail('failed-precondition', 'Cần xác nhận toàn bộ phần dịch vụ chưa thực hiện theo số liệu đối soát.', 'SETTLEMENT_WAIVER_MISMATCH')
  if (proposal.serviceReductionAmount > preview.serviceRecognizedRevenue) fail('invalid-argument', 'Giảm giá dịch vụ không được vượt doanh thu đã đối soát.')
  for (const name of ['fee', 'serviceReduction', 'writeOff']) if (proposal[`${name}Amount`] > 0 && proposal[`${name}Reason`].length < 2) fail('invalid-argument', 'Khoản phí, giảm giá hoặc xóa nợ phải có lý do riêng.')
  if (proposal.writeOffAmount > Math.max(0, preview.serviceRecognizedRevenue - proposal.serviceReductionAmount - preview.canonicalCash)) fail('invalid-argument', 'Chỉ được xóa khoản nợ dịch vụ đã thực hiện còn lại; không xóa phí mới hoặc tiền đã thu.')
  const instant = new Date(proposal.effectiveAt)
  if (instant > new Date() || localDay(instant) < proposal.cutoffDate) fail('invalid-argument', 'Ngày ghi điều chỉnh phải từ ngày kết thúc đến hiện tại.')
  return proposal
}
function journalLine(side, code, amount, description) {
  return { side, accountCode: code, accountName: CHART_OF_ACCOUNTS[code].name, debit: side === 'debit' ? amount : 0, credit: side === 'credit' ? amount : 0, description }
}
function settlementAdjustments({ contractId, contract, preview, proposal, revision, actorUid }) {
  const entries = []
  const advance = ['131', '3387'].includes(contract.accountingAdvanceAccountCode) ? contract.accountingAdvanceAccountCode : '131'
  const common = { schemaVersion: 4, type: 'adjustment', source: 'pt_gym', contractId, studentId: contract.studentId || '', branchId: contract.branchId || '', settlementId: contractId, settlementRevision: revision, accountingPolicy: POLICY, cashImpact: 0, revenueImpact: 0, expenseImpact: 0, receivableImpact: 0, deferredRevenueImpact: 0, contractSalesImpact: 0, status: 'posted', effectiveAt: Timestamp.fromDate(new Date(proposal.effectiveAt)), createdAt: FieldValue.serverTimestamp(), createdBy: actorUid }
  const add = (kind, value, lines) => {
    const id = `contract_settlement_${contractId}_${revision}_${kind}`
    const ledger = { ...common, ...value, eventClass: `contract_settlement_${kind}`, idempotencyKey: id, ...(lines ? { journalEntryId: id } : {}) }
    const journal = lines ? { schemaVersion: 1, documentType: ledger.eventClass, documentId: id, contractId, studentId: ledger.studentId, branchId: ledger.branchId, settlementId: contractId, accountingPolicy: POLICY, effectiveAt: common.effectiveAt, status: 'posted', lines, ...assertBalancedJournal(lines), createdAt: FieldValue.serverTimestamp(), createdBy: actorUid } : null
    entries.push({ id, ledger, journal })
  }
  const reduction = proposal.serviceReductionAmount
  const afterService = preview.serviceRecognizedRevenue - reduction
  if (reduction) {
    const receivableReduction = Math.min(reduction, Math.max(0, preview.serviceRecognizedRevenue - preview.canonicalCash))
    const lines = [journalLine('debit', '5113', reduction, proposal.serviceReductionReason)]
    if (receivableReduction) lines.push(journalLine('credit', '131', receivableReduction, 'Giảm khoản phải thu dịch vụ'))
    if (reduction > receivableReduction) lines.push(journalLine('credit', advance, reduction - receivableReduction, 'Giá trị trả trước được hoàn lại'))
    add('service_reduction', { amount: -reduction, revenueImpact: -reduction, receivableImpact: -receivableReduction, deferredRevenueImpact: reduction - receivableReduction, reason: proposal.serviceReductionReason }, lines)
  }
  if (proposal.writeOffAmount) add('write_off', { amount: proposal.writeOffAmount, expenseImpact: proposal.writeOffAmount, receivableImpact: -proposal.writeOffAmount, accountingCategory: 'approved_earned_receivable_write_off', reason: proposal.writeOffReason }, [journalLine('debit', '6428', proposal.writeOffAmount, proposal.writeOffReason), journalLine('credit', '131', proposal.writeOffAmount, 'Xóa khoản phải thu được duyệt')])
  if (proposal.feeAmount) {
    const released = Math.min(proposal.feeAmount, Math.max(0, preview.canonicalCash - afterService))
    const lines = []
    if (released) lines.push(journalLine('debit', advance, released, 'Đối trừ tiền khách đã trả'))
    if (proposal.feeAmount > released) lines.push(journalLine('debit', '131', proposal.feeAmount - released, 'Phí kết thúc còn phải thu'))
    lines.push(journalLine('credit', '711', proposal.feeAmount, proposal.feeReason))
    add('fee', { amount: proposal.feeAmount, revenueImpact: proposal.feeAmount, receivableImpact: proposal.feeAmount - released, deferredRevenueImpact: -released, accountingCategory: 'approved_termination_fee', reason: proposal.feeReason }, lines)
  }
  const commercialAdjustmentAmount = proposal.feeAmount - reduction - proposal.waivedFutureAmount
  add('commercial_cancellation', { amount: 0, commercialAdjustmentAmount, waivedFutureAmount: proposal.waivedFutureAmount, contractSalesImpact: preview.salesBaselineVerified ? commercialAdjustmentAmount : 0, salesBaselineUnverified: !preview.salesBaselineVerified, postingClass: 'memorandum', reason: proposal.reason }, null)
  return entries
}

function permissions(actor) {
  const finance = actor.capabilities?.includes('finance.operations.manage') === true
  return { canSubmit: finance, canApprove: finance, canClose: finance }
}
function assertScope(actor, contract) {
  const admin = ['admin', 'super_admin'].includes(actor.accessRole)
  if (!admin && (!contract.branchId || !actor.branchIds?.includes(contract.branchId))) fail('permission-denied', 'Hợp đồng nằm ngoài chi nhánh được phân quyền.')
}
function publicResponse(contractId, contract, settlement, preview, actor) {
  const revision = Number(settlement?.revision ?? contract.cancellationSettlement?.revision ?? 0)
  const status = settlement?.status || contract.cancellationSettlement?.status || 'review_required'
  const amount = settlement?.settlementAmount ?? contract.cancellationSettlement?.settlementAmount
  if (['approved', 'settled'].includes(status) && (!settlement || settlement.serviceEvidenceHash !== preview.serviceEvidenceHash || settlement.recognizedRevenueAfterAdjustments !== preview.recognizedRevenue)) {
    preview = { ...preview, blockers: [...preview.blockers, { code: 'SETTLEMENT_APPROVAL_STALE', message: 'Bằng chứng dịch vụ đã thay đổi sau phê duyệt; cần đối soát lại trước khi thu, hoàn hoặc đóng hồ sơ.' }] }
  }
  const confirmedCutoffDate = confirmedCancellationCutoff(contract)
  return { contractId, revision, status, settlement: settlement || null, preview: { ...preview, confirmedCutoffDate, ...(['approved', 'settled'].includes(status) && Number.isSafeInteger(amount) ? { dueAmount: Math.max(0, amount - preview.canonicalCash), refundAmount: Math.max(0, preview.canonicalCash - amount) } : {}) }, permissions: permissions(actor) }
}
function assertReady(preview) { if (preview.blockers.length) fail('failed-precondition', preview.blockers[0].message, preview.blockers[0].code) }
function assertApprovedEvidence(settlement, preview) {
  assertReady(preview)
  if (settlement.serviceEvidenceHash !== preview.serviceEvidenceHash || settlement.recognizedRevenueAfterAdjustments !== preview.recognizedRevenue) fail('failed-precondition', 'Bằng chứng dịch vụ đã thay đổi sau phê duyệt. Cần đối soát lại.', 'SETTLEMENT_APPROVAL_STALE')
}

function createContractSettlementFunctions({ db, onCall, logger = console, authorize = trustedAccessContext }) {
  async function actorFor(request, write) {
    const actor = await authorize(request, db, { freshAssignment: true })
    if (write) requireCapability(actor, 'finance.operations.manage')
    else if (!['admin', 'super_admin'].includes(actor.accessRole) && !actor.capabilities?.some(value => ['finance.operations.manage', 'branch.finance.view'].includes(value))) fail('permission-denied', 'Bạn không có quyền xem quyết toán tài chính.')
    return actor
  }
  async function read(contractId, actor, cutoffDate) {
    return db.runTransaction(async transaction => {
      const [contractDoc, caseDoc] = await Promise.all([transaction.get(db.doc(`contracts/${contractId}`)), transaction.get(db.doc(`contractSettlements/${contractId}`))])
      if (!contractDoc.exists) fail('not-found', 'Không tìm thấy hợp đồng.')
      const contract = contractDoc.data(); assertScope(actor, contract)
      const settlement = caseDoc.exists ? caseDoc.data() : null
      const preview = await readSettlementEvidence(transaction, db, contractId, contract, cutoffDate || settlement?.proposal?.cutoffDate)
      return publicResponse(contractId, contract, settlement, preview, actor)
    })
  }
  const getContractSettlement = onCall(async request => read(identifier(request.data?.contractId), await actorFor(request, false), request.data?.cutoffDate))
  const manageContractSettlement = onCall(async request => {
    const actor = await actorFor(request, true)
    const input = request.data || {}, contractId = identifier(input.contractId), operationId = identifier(input.operationId)
    if (!['verify_cutoff', 'submit', 'approve', 'close', 'withdraw'].includes(input.action)) fail('invalid-argument', 'Thao tác quyết toán không hợp lệ.')
    const expectedRevision = money(input.expectedRevision, 'Phiên bản hồ sơ')
    const expectedSnapshotHash = text(input.expectedSnapshotHash, 64)
    if (!/^[a-f0-9]{64}$/.test(expectedSnapshotHash)) fail('invalid-argument', 'Cần tải lại số liệu đối soát trước khi gửi.')
    const operationReference = db.doc(`contractSettlementOperations/${hash([contractId, operationId])}`)
    // Existing command fingerprints stay unchanged for already-issued receipts.
    // Date verification additionally binds both fields, including exact retries.
    const requestHash = hash({ contractId, action: input.action, expectedRevision, expectedSnapshotHash, proposal: input.proposal || null,
      ...(input.action === 'verify_cutoff' ? { cutoffDate: input.cutoffDate ?? null, reason: input.reason ?? null } : {}) })
    await db.runTransaction(async transaction => {
      const reference = db.doc(`contracts/${contractId}`), caseReference = db.doc(`contractSettlements/${contractId}`)
      const [contractDoc, caseDoc, operationDoc] = await Promise.all([transaction.get(reference), transaction.get(caseReference), transaction.get(operationReference)])
      if (!contractDoc.exists) fail('not-found', 'Không tìm thấy hợp đồng.')
      const contract = contractDoc.data(); assertScope(actor, contract)
      if (operationDoc.exists) {
        if (operationDoc.data().requestHash !== requestHash || operationDoc.data().actorUid !== actor.uid) fail('already-exists', 'Mã thao tác đã dùng với nội dung hoặc người thực hiện khác.')
        return
      }
      const current = caseDoc.exists ? caseDoc.data() : null
      const revision = Number(current?.revision ?? contract.cancellationSettlement?.revision ?? 0)
      if ((current && contract.cancellationSettlement && (current.status !== contract.cancellationSettlement.status || current.revision !== contract.cancellationSettlement.revision)) || (!current && ['pending_approval', 'approved', 'settled'].includes(contract.cancellationSettlement?.status))) fail('failed-precondition', 'Hồ sơ và trạng thái quyết toán chưa đồng bộ.', 'SETTLEMENT_CASE_MISMATCH')
      if (revision !== expectedRevision) fail('aborted', 'Hồ sơ quyết toán vừa thay đổi. Hãy tải lại.')
      if (contract.status !== 'cancelled') fail('failed-precondition', 'Chỉ quyết toán hợp đồng đã kết thúc hiệu lực.')
      const verifyingCutoff = input.action === 'verify_cutoff'
      const verificationDate = verifyingCutoff && typeof input.cutoffDate === 'string' && input.cutoffDate.length === 10 ? dateKey(input.cutoffDate) : ''
      const verificationReason = verifyingCutoff ? text(input.reason) : ''
      if (verifyingCutoff) {
        if ((current?.status || contract.cancellationSettlement?.status || 'review_required') !== 'review_required') fail('failed-precondition', 'Chỉ xác nhận ngày nghỉ khi hồ sơ đang cần kiểm tra.', 'SETTLEMENT_CUTOFF_STATE_LOCKED')
        if (!verificationDate || verificationDate > localDay() || verificationReason.length < 2) fail('invalid-argument', 'Cần ngày nghỉ hợp lệ không ở tương lai và lý do xác nhận.')
      }
      const cutoff = verifyingCutoff ? verificationDate : input.action === 'submit' ? input.proposal?.cutoffDate : current?.proposal?.cutoffDate
      const preview = await readSettlementEvidence(transaction, db, contractId, contract, cutoff)
      if (preview.snapshotHash !== expectedSnapshotHash) fail('aborted', 'Tiền hoặc bằng chứng dịch vụ vừa thay đổi. Hãy tải lại và xem phương án mới.', 'SETTLEMENT_SNAPSHOT_CHANGED')
      const nextRevision = revision + 1
      let next = { ...current, schemaVersion: 1, contractId, studentId: contract.studentId || '', branchId: contract.branchId || '', revision: nextRevision, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }
      const entries = []
      if (verifyingCutoff) {
        const invalidDateEvidence = preview.blockers.find(item => ['SETTLEMENT_CUTOFF_REQUIRED', 'SETTLEMENT_CUTOFF_INVALID', 'SETTLEMENT_SERVICE_AFTER_CUTOFF'].includes(item.code))
        if (invalidDateEvidence) fail('failed-precondition', invalidDateEvidence.message, invalidDateEvidence.code)
        // Save only the audited date. Financial evidence remains blocked until
        // separately reconciled; a withdrawn monetary proposal is now stale.
        delete next.proposal
        delete next.snapshot
        next = { ...next, status: 'review_required', cutoffDate: verificationDate, cutoffVerifiedDate: verificationDate,
          cutoffVerifiedAt: FieldValue.serverTimestamp(), cutoffVerifiedBy: actor.uid, cutoffVerificationReason: verificationReason }
      } else if (input.action === 'submit') {
        if (['approved', 'settled'].includes(current?.status)) fail('failed-precondition', 'Phương án đã duyệt không thể thay trực tiếp.')
        assertReady(preview)
        const proposal = proposalInput(input.proposal, preview)
        next = { ...next, status: 'pending_approval', cutoffDate: proposal.cutoffDate, proposal, snapshot: preview, submittedAt: FieldValue.serverTimestamp(), submittedBy: actor.uid }
      } else if (input.action === 'approve') {
        if (current?.status !== 'pending_approval') fail('failed-precondition', 'Chỉ duyệt phương án đang chờ phê duyệt.')
        assertReady(preview)
        if (current.snapshot.snapshotHash !== preview.snapshotHash) fail('aborted', 'Số liệu đã thay đổi từ lúc lập phương án. Cần lập lại trước khi duyệt.', 'SETTLEMENT_PROPOSAL_STALE')
        const proposal = proposalInput(current.proposal, preview)
        const period = await transaction.get(db.doc(`financePeriods/${localDay(new Date(proposal.effectiveAt)).slice(0, 7)}`))
        if (period.exists && period.data().status === 'locked') fail('failed-precondition', 'Kỳ ghi nhận điều chỉnh đã khóa.', 'FINANCE_PERIOD_LOCKED')
        const recognizedRevenueAfterAdjustments = preview.serviceRecognizedRevenue - proposal.serviceReductionAmount + proposal.feeAmount
        const settlementAmount = recognizedRevenueAfterAdjustments - proposal.writeOffAmount
        next = { ...next, status: 'approved', settlementAmount, recognizedRevenueBaseline: preview.serviceRecognizedRevenue, recognizedRevenueAfterAdjustments, feeAmount: proposal.feeAmount, serviceReductionAmount: proposal.serviceReductionAmount, writeOffAmount: proposal.writeOffAmount, waivedFutureAmount: proposal.waivedFutureAmount, cutoffDate: proposal.cutoffDate, serviceEvidenceHash: preview.serviceEvidenceHash, approvedSnapshotHash: preview.snapshotHash, canonicalCash: preview.canonicalCash, paidProjection: preview.paidProjection, remainingReceivable: Math.max(0, settlementAmount - preview.canonicalCash), refundDue: Math.max(0, preview.canonicalCash - settlementAmount), approvedAt: FieldValue.serverTimestamp(), approvedBy: actor.uid, accountingPolicy: POLICY }
        entries.push(...settlementAdjustments({ contractId, contract, preview, proposal, revision: nextRevision, actorUid: actor.uid }))
        const collision = await Promise.all(entries.flatMap(entry => [transaction.get(db.doc(`ledgerEntries/${entry.id}`)), ...(entry.journal ? [transaction.get(db.doc(`journalEntries/${entry.id}`))] : [])]))
        if (collision.some(row => row.exists)) fail('already-exists', 'Chứng từ quyết toán đã tồn tại; cần tải lại hồ sơ.')
      } else if (input.action === 'close') {
        if (current?.status !== 'approved') fail('failed-precondition', 'Chỉ đóng phương án đã duyệt.')
        assertApprovedEvidence(current, preview)
        if (preview.canonicalCash !== current.settlementAmount) fail('failed-precondition', 'Còn khoản phải thu hoặc phải hoàn, chưa thể đóng quyết toán.', 'SETTLEMENT_BALANCE_NOT_ZERO')
        next = { ...next, status: 'settled', canonicalCash: preview.canonicalCash, paidProjection: preview.paidProjection, remainingReceivable: 0, refundDue: 0, settledAt: FieldValue.serverTimestamp(), settledBy: actor.uid }
      } else {
        if (current?.status !== 'pending_approval') fail('failed-precondition', 'Chỉ rút phương án chưa duyệt.')
        next = { ...next, status: 'review_required', withdrawnAt: FieldValue.serverTimestamp(), withdrawnBy: actor.uid }
      }
      const summary = { schemaVersion: 1, settlementId: contractId, revision: nextRevision, status: next.status, cutoffDate: next.proposal?.cutoffDate || preview.cutoffDate, ...(next.status === 'approved' || next.status === 'settled' ? Object.fromEntries(['settlementAmount', 'recognizedRevenueBaseline', 'recognizedRevenueAfterAdjustments', 'feeAmount', 'serviceReductionAmount', 'writeOffAmount', 'waivedFutureAmount', 'serviceEvidenceHash', 'approvedSnapshotHash', 'canonicalCash', 'paidProjection', 'remainingReceivable', 'refundDue', 'approvedAt', 'approvedBy', 'accountingPolicy'].map(key => [key, next[key]])) : {}), ...(next.status === 'settled' ? { settledAt: next.settledAt, settledBy: actor.uid } : {}) }
      if (next.cutoffVerifiedDate === summary.cutoffDate) Object.assign(summary,
        Object.fromEntries(['cutoffVerifiedDate', 'cutoffVerifiedAt', 'cutoffVerifiedBy', 'cutoffVerificationReason'].map(key => [key, next[key]])))
      for (const entry of entries) {
        transaction.create(db.doc(`ledgerEntries/${entry.id}`), entry.ledger)
        if (entry.journal) transaction.create(db.doc(`journalEntries/${entry.id}`), entry.journal)
      }
      transaction.set(caseReference, next)
      transaction.update(reference, { cancellationSettlement: summary, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.create(operationReference, { schemaVersion: 1, contractId, action: input.action, actorUid: actor.uid, requestHash, revision: nextRevision, beforeStatus: current?.status || 'review_required', afterStatus: next.status, proposal: next.proposal || null, snapshotHash: preview.snapshotHash,
        ...(verifyingCutoff ? { cutoffDate: verificationDate, reason: verificationReason, previousCutoffDate: confirmedCancellationCutoff(contract) } : {}),
        createdAt: FieldValue.serverTimestamp() })
    })
    logger.info('contract_settlement_operation', { action: input.action })
    return read(contractId, actor)
  })
  return { getContractSettlement, manageContractSettlement }
}

module.exports = { MAX_EVIDENCE, POLICY, readSettlementEvidence, settlementAdjustments, proposalInput, assertApprovedEvidence, createContractSettlementFunctions }
