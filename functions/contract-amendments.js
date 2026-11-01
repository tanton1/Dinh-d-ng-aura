'use strict'

const { createHash } = require('node:crypto')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { revenueSegments, allocationAmount } = require('./pt-revenue-allocation')
const { ledgerReceiptImpact } = require('./finance-receipt-impact')
const { sessionCountsTowardContract } = require('./contract-usage-core')
const { contractSalesContribution } = require('./contract-financial-status')
const { vietnamDateKey } = require('./pt-policy')

const LIMIT = 5000
const fail = message => { throw new HttpsError('failed-precondition', message) }
const integer = (value, label, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return value
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) throw new HttpsError('invalid-argument', 'Ngày hết hạn không hợp lệ.')
  return value
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value?.toDate) return value.toDate().toISOString()
  return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
}
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const posted = row => ['posted', 'reversed'].includes(row.status)
const revenue = row => posted(row) ? Number(row.revenueImpact ?? (row.type === 'revenue_recognition' ? row.amount : 0)) : 0
const activeBooking = row => ['scheduled', 'rescheduled'].includes(row.status)
  && !['cancelled', 'student_cancelled', 'trainer_cancelled'].includes(row.scheduleStatus) && row.billingStatus !== 'exempt'

function shares(contractId, contract) {
  return revenueSegments(contractId, contract).flatMap(segment => Array.from({ length: segment.count }, (_, index) => ({
    ...segment, count: 1, startOrdinal: segment.startOrdinal + index,
    unitAmount: allocationAmount({ ...segment, serviceOrdinal: segment.startOrdinal + index }),
  })))
}

// Only pending installments are replaced. Paid/cancelled documents remain
// byte-for-byte unchanged, including a downgrade which creates a refund due.
function revisedInstallments(previous, outstanding, dueDate, amendmentId) {
  const locked = previous.filter(row => row.status !== 'pending')
  if (!outstanding) return locked
  const pending = previous.filter(row => row.status === 'pending' && row.amount > 0)
  if (!pending.length) return [...locked, { id: `${amendmentId}-payment`, amount: outstanding, date: dueDate, status: 'pending' }]
  const sum = pending.reduce((total, row) => total + row.amount, 0)
  if (!Number.isSafeInteger(sum) || sum <= 0) fail('Lịch thanh toán cũ cần được kiểm tra trước khi điều chỉnh.')
  // BigInt prevents money precision loss during proportional scaling.
  const amounts = pending.map(row => Number(BigInt(outstanding) * BigInt(row.amount) / BigInt(sum)))
  let remainder = outstanding - amounts.reduce((total, amount) => total + amount, 0)
  return [...locked, ...pending.map((row, index) => ({ ...row, amount: amounts[index] + (remainder-- > 0 ? 1 : 0) })).filter(row => row.amount > 0)]
}

function amendmentProjection({ contractId, contract, target, sessions, billings, ledger, reviews = [], today = vietnamDateKey() }) {
  const blockers = []
  const block = message => { if (!blockers.includes(message)) blockers.push(message) }
  const oldNet = Number(contract.totalPrice || 0) - Number(contract.discount || 0)
  const newNet = target.totalPrice - target.discount
  if (!['active', 'future', 'frozen', 'expired'].includes(contract.status)) block('Hợp đồng đã kết thúc hoặc chưa hợp lệ; cần xử lý riêng trước khi đổi gói.')
  if (contract.handoverStatus === 'pending' || contract.renewedByContractId || contract.renewalSupersededBy || Number(contract.carryOverTransferredSessions || 0) > 0) {
    block('Hợp đồng đang chờ nối tiếp hoặc đã chuyển quyền lợi đi. Cần kiểm tra chuỗi hợp đồng trước khi điều chỉnh gói này.')
  }
  if (target.endDate < today || target.endDate < String(contract.startDate).slice(0, 10)) block('Ngày hết hạn mới phải từ hôm nay và ngày bắt đầu hợp đồng trở đi. Nếu muốn kết thúc trong quá khứ, hãy dùng quyết toán.')
  if (reviews.some(row => !['resolved', 'closed', 'dismissed'].includes(row.status)) || sessions.some(row => row.recognitionReviewRequired || row.billingStatus === 'review_required')) block('Còn buổi hoặc doanh thu cần đối soát. Hãy xử lý các mục đối soát trước khi điều chỉnh.')
  if ([...sessions, ...billings].some(row => row.studentId && row.studentId !== contract.studentId)) block('Có buổi liên kết sai học viên; cần đối soát trước.')
  if (sessions.some(row => (activeBooking(row) || sessionCountsTowardContract(row)) && !/^\d{4}-\d{2}-\d{2}/.test(row.date || ''))) block('Có lịch tập thiếu ngày hợp lệ; cần kiểm tra trước khi điều chỉnh.')
  if (sessions.some(row => activeBooking(row) && !sessionCountsTowardContract(row) && (row.chargedAt || row.revenueRecognitionEntryId))) block('Có lịch chứa bằng chứng tính phí nhưng trạng thái chưa khớp; cần đối soát trước.')
  const cash = ledger.filter(posted).reduce((sum, row) => sum + Number(ledgerReceiptImpact(row)), 0)
  if (!Number.isSafeInteger(cash) || cash !== Number(contract.paidAmount || 0) || cash < 0) block('Tiền đã thu chưa khớp chứng từ. Hãy đối soát thu/hoàn tiền trước khi điều chỉnh.')
  const recognized = ledger.reduce((sum, row) => sum + revenue(row), 0)
  if (!Number.isSafeInteger(recognized) || recognized < 0 || recognized > oldNet) block('Doanh thu đã ghi nhận chưa khớp giá trị hợp đồng; cần đối soát trước.')
  const oldShares = shares(contractId, contract)
  const carry = Number(contract.carriedOverSessions || 0)
  if (oldShares.filter(row => row.contractId !== contractId).length !== carry) block('Quyền lợi chuyển tiếp chưa khớp nguồn; cần đối soát trước.')
  const chargeById = new Map()
  for (const row of sessions.filter(sessionCountsTowardContract)) chargeById.set(row.id, row)
  for (const row of billings.filter(row => row.billingStatus === 'charged')) {
    const id = row.sessionId || row.id
    if (chargeById.has(id) && Number(chargeById.get(id).serviceOrdinal) !== Number(row.serviceOrdinal)) block('Thứ tự trừ buổi chưa khớp chấm công; cần đối soát trước.')
    chargeById.set(id, { ...row, ...chargeById.get(id) })
  }
  const used = chargeById.size
  if (used !== Number(contract.usedSessions || 0)) block('Số buổi đã dùng chưa khớp bằng chứng trừ buổi. Hãy đối soát hợp đồng trước.')
  if (target.totalSessions < used + Number(contract.carryOverTransferredSessions || 0)) block(`Tổng buổi mới không thể thấp hơn ${used} buổi đã trừ.`)
  const historical = new Set(), positiveBySession = new Map(), positiveByOrdinal = new Map()
  const byId = new Map(ledger.map(row => [row.id, row]))
  for (const row of ledger) {
    const amount = revenue(row)
    if (!Number.isSafeInteger(amount)) { block('Có bút toán doanh thu không hợp lệ.'); continue }
    if (!amount) continue
    const source = amount < 0 ? byId.get(row.reversedEntryId) : row
    const id = row.sessionId || source?.sessionId
    const ordinal = Number(row.serviceOrdinal ?? source?.serviceOrdinal)
    if (!id || !Number.isSafeInteger(ordinal) || ordinal < 1) { block('Có doanh thu chưa xác minh được buổi nguồn.'); continue }
    positiveBySession.set(id, (positiveBySession.get(id) || 0) + amount)
    positiveByOrdinal.set(ordinal, (positiveByOrdinal.get(ordinal) || 0) + amount)
    const localIndex = oldShares.findIndex(share => share.contractId === contractId && share.startOrdinal === ordinal)
    if (localIndex < 0) block('Có doanh thu ngoài phạm vi quyền lợi hiện tại.')
    else {
      historical.add(localIndex + 1)
      if (amount > 0 && amount !== oldShares[localIndex].unitAmount) block('Đơn giá buổi cũ chưa khớp bút toán; cần đối soát trước khi đổi gói.')
    }
  }
  for (const row of billings) if (Number.isSafeInteger(row.serviceOrdinal) && row.serviceOrdinal > 0 && ['charged', 'returned', 'reversed'].includes(row.billingStatus)) historical.add(row.serviceOrdinal)
  const consumed = new Set()
  for (const [id, row] of chargeById) {
    const ordinal = Number(row.serviceOrdinal), share = oldShares[ordinal - 1]
    if (!Number.isSafeInteger(ordinal) || !share || consumed.has(ordinal)) { block('Có buổi thiếu hoặc trùng thứ tự tính phí; cần đối soát trước.'); continue }
    consumed.add(ordinal); historical.add(ordinal)
    if (share.unitAmount === 0 && !row.zeroValueApproval?.evidenceKey) block('Có buổi giá trị 0 chưa được xác nhận; hãy đối soát trước.')
    if (share.contractId === contractId && (positiveBySession.get(id) || 0) !== share.unitAmount) block('Có buổi đã trừ chưa khớp doanh thu; hãy đối soát trước khi điều chỉnh.')
  }
  for (const [id, amount] of positiveBySession) if (amount < 0 || (amount > 0 && !chargeById.has(id))) block('Có doanh thu không khớp buổi đang tính phí; cần đối soát trước.')
  for (const [ordinal, amount] of positiveByOrdinal) {
    const share = oldShares.find(row => row.contractId === contractId && row.startOrdinal === ordinal)
    if (amount < 0 || (amount > 0 && amount !== share?.unitAmount)) block('Có doanh thu trùng hoặc chưa được hoàn đúng theo buổi.')
  }
  // Foreign credits and every posted identity (even a subsequently returned
  // service) keep their amount. Unused/unposted shares alone may be repriced.
  oldShares.forEach((share, index) => { if (share.contractId !== contractId) historical.add(index + 1) })
  if ([...historical].some(ordinal => ordinal > target.totalSessions)) block('Số buổi mới làm mất thứ tự buổi đã ghi nhận/chuyển tiếp. Cần đối soát riêng để giữ lịch sử.')
  const frozenValue = oldShares.reduce((sum, row, index) => sum + (row.contractId === contractId && historical.has(index + 1) ? row.unitAmount : 0), 0)
  const remainingValue = newNet - frozenValue
  const freeCount = target.totalSessions - [...historical].filter(n => n <= target.totalSessions).length
  if (remainingValue < 0 || newNet < recognized) block('Giá trị mới thấp hơn phần doanh thu/quyền lợi đã ghi nhận. Cần xử lý điều chỉnh tài chính riêng.')
  if (freeCount === 0 && remainingValue !== 0) block('Không còn buổi để phân bổ giá trị mới. Hãy kiểm tra lại giá hoặc số buổi.')
  if (freeCount > 0 && newNet > 0 && remainingValue < freeCount) block('Giá trị còn lại không đủ phân bổ cho các buổi mới. Hãy kiểm tra lại thỏa thuận.')
  const affected = sessions.filter(row => activeBooking(row) && !sessionCountsTowardContract(row) && String(row.date).slice(0, 10) > target.endDate)
  if (sessions.some(row => sessionCountsTowardContract(row) && String(row.date).slice(0, 10) > target.endDate)) block('Có buổi đã tính phí sau ngày hết hạn mới. Hãy đối soát buổi này trước.')
  const bookedCount = sessions.filter(row => activeBooking(row) && !sessionCountsTowardContract(row) && String(row.date).slice(0, 10) <= target.endDate).length
  if (bookedCount > target.totalSessions - used) block(`Còn ${bookedCount} lịch đã đặt nhưng chỉ còn ${Math.max(0, target.totalSessions - used)} buổi. Hãy điều chỉnh lịch trước.`)
  let allocation = null
  if (!blockers.length) {
    let remainder = freeCount ? remainingValue % freeCount : 0
    const ownCount = target.totalSessions - carry
    allocation = { version: 2, segments: Array.from({ length: target.totalSessions }, (_, index) => historical.has(index + 1) ? oldShares[index] : {
      contractId, startOrdinal: index + 1 - carry, count: 1, totalSessions: ownCount,
      totalPrice: target.totalPrice, discount: target.discount, unitAmount: Math.floor(remainingValue / freeCount) + (remainder-- > 0 ? 1 : 0),
    }) }
    revenueSegments(contractId, { ...contract, totalSessions: target.totalSessions, revenueAllocation: allocation })
  }
  return { blockers, allocation, used, recognized, cash, frozenValue, remainingValue,
    affectedBookings: affected.map(row => ({ id: row.id, date: String(row.date).slice(0, 10), hour: row.hour ?? null })),
    before: { packageId: contract.packageId, packageName: contract.packageName || '', totalSessions: Number(contract.totalSessions), netValue: oldNet, endDate: String(contract.endDate).slice(0, 10), remainingSessions: Math.max(0, Number(contract.totalSessions) - used) },
    after: { ...target, netValue: newNet, remainingSessions: Math.max(0, target.totalSessions - used), receivable: Math.max(0, newNet - cash), refundDue: Math.max(0, cash - newNet) },
  }
}

async function readAmendmentPlan({ transaction, db, contractId, contract, input, now = Date.now() }) {
  // Enable only after every revenue consumer serves allocation v2. This also
  // provides a rollback switch without rewriting already amended contracts.
  const gate = await transaction.get(db.doc('settings/contractAmendments'))
  if (!gate.exists || gate.data().enabled !== true || gate.data().allocationVersion !== 2) fail('Điều chỉnh gói tập đang được cập nhật. Vui lòng thử lại sau khi hệ thống hoàn tất triển khai.')
  const packageId = input.packageId
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(packageId || '')) throw new HttpsError('invalid-argument', 'Gói tập không hợp lệ.')
  const target = { packageId, totalSessions: integer(input.totalSessions, 'Tổng số buổi', LIMIT), totalPrice: integer(input.totalPrice, 'Giá trị hợp đồng'), discount: integer(input.discount ?? 0, 'Giảm giá'), endDate: date(input.endDate) }
  if (!target.totalSessions || target.discount > target.totalPrice) throw new HttpsError('invalid-argument', 'Số buổi phải lớn hơn 0 và giảm giá không được vượt giá trị hợp đồng.')
  const today = vietnamDateKey(new Date(now))
  const names = ['sessions', 'sessionBillingEvents', 'ledgerEntries', 'revenueRecognitionReviews', 'sessionBillingIssues']
  const [packageDoc, period, otherContracts, ...snapshots] = await Promise.all([
    transaction.get(db.doc(`packages/${packageId}`)), transaction.get(db.doc(`financePeriods/${today.slice(0, 7)}`)),
    transaction.get(db.collection('contracts').where('studentId', '==', contract.studentId).limit(51)),
    ...names.map(name => transaction.get(db.collection(name).where('contractId', '==', contractId).limit(LIMIT + 1))),
  ])
  if (!packageDoc.exists || (packageDoc.data().branchId && packageDoc.data().branchId !== contract.branchId)) fail('Gói tập không còn tồn tại hoặc không thuộc chi nhánh hợp đồng.')
  if (snapshots.some(snapshot => snapshot.size > LIMIT)) fail('Lịch sử hợp đồng vượt giới hạn kiểm tra trong một lần; cần đối soát riêng.')
  if (otherContracts.size > 50) fail('Quá nhiều hợp đồng để xác minh khoảng hiệu lực; cần kiểm tra riêng.')
  const rows = Object.fromEntries(names.map((name, index) => [name, snapshots[index].docs.map(doc => ({ ...doc.data(), id: doc.id }))]))
  const projection = amendmentProjection({ contractId, contract, target: { ...target, packageName: packageDoc.data().name || packageId },
    sessions: rows.sessions, billings: rows.sessionBillingEvents, ledger: rows.ledgerEntries,
    reviews: [...rows.revenueRecognitionReviews, ...rows.sessionBillingIssues], today })
  if (period.exists && period.data().status === 'locked') projection.blockers.push('Kỳ tài chính hiện tại đã khóa; chưa thể ghi nhận điều chỉnh.')
  if (otherContracts.docs.some(doc => doc.id !== contractId && ['active', 'future', 'frozen'].includes(doc.data().status)
    && String(doc.data().startDate).slice(0, 10) <= target.endDate && String(doc.data().endDate).slice(0, 10) >= String(contract.startDate).slice(0, 10))) {
    projection.blockers.push('Thời hạn mới trùng một hợp đồng khác. Hãy kiểm tra ngày hiệu lực hoặc chuỗi nối tiếp trước.')
  }
  const sale = contractSalesContribution(contract)
  if (!sale?.effectiveAt) projection.blockers.push('Hợp đồng thiếu ngày doanh số gốc; cần bổ sung trước khi điều chỉnh.')
  if (projection.before.packageId === target.packageId && projection.before.totalSessions === target.totalSessions
    && contract.totalPrice === target.totalPrice && Number(contract.discount || 0) === target.discount && projection.before.endDate === target.endDate) projection.blockers.push('Chưa có thay đổi về gói, giá, số buổi hoặc ngày hết hạn.')
  const snapshotHash = hash({ contract, target, today, gate: gate.data(), package: packageDoc.data(), period: period.exists ? period.data() : null,
    versions: [...snapshots, otherContracts].map(snapshot => snapshot.docs.map(doc => [doc.id, doc.updateTime ? [doc.updateTime.seconds, doc.updateTime.nanoseconds] : doc.data()]).sort((a, b) => a[0].localeCompare(b[0]))) })
  const amendmentId = `${contractId}-amend-${Number(contract.revision || 0) + 1}`
  const installments = revisedInstallments(contract.installments || [], projection.after.receivable, [today, contract.startDate].sort().at(-1), amendmentId)
  let schedulePlan = null, requests = []
  if (projection.affectedBookings.length && !projection.blockers.length) {
    const ids = new Set(projection.affectedBookings.map(row => row.id))
    const requestSnapshot = await transaction.get(db.collection('sessionRequests').where('studentId', '==', contract.studentId).limit(501))
    if (requestSnapshot.size > 500) fail('Có quá nhiều yêu cầu lịch cần kiểm tra trước khi rút ngắn thời hạn.')
    requests = requestSnapshot.docs.filter(doc => doc.data().status === 'pending' && ids.has(doc.data().sessionId))
    const affectedDocs = snapshots[0].docs.filter(doc => ids.has(doc.id))
    const { readCancellationSchedulePlan } = require('./session-operations')
    schedulePlan = await readCancellationSchedulePlan({ transaction, db, sessions: affectedDocs, fallbackBranchId: contract.branchId || '' })
    if (affectedDocs.length + requests.length + schedulePlan.draftTargets.size + schedulePlan.legacyTargets.size > 350) fail('Quá nhiều lịch bị ảnh hưởng; hãy điều chỉnh lịch trước khi đổi gói.')
  }
  const { allocation, ...publicProjection } = projection
  const preview = { ...publicProjection, snapshotHash, installments, revision: Number(contract.revision || 0) }
  return { preview, allocation, amendmentId, schedulePlan, requests,
    salesOriginalSnapshot: contract.salesOriginalSnapshot || (sale ? { schemaVersion: 1, netAmount: sale.amount, effectiveAt: sale.effectiveAt } : null),
    patch: { ...target, packageName: projection.after.packageName, totalSessions: target.totalSessions,
      packageSessions: target.totalSessions - Number(contract.carriedOverSessions || 0), installments,
      nextPaymentDate: installments.filter(row => row.status === 'pending').map(row => row.date).sort()[0] || null },
  }
}

function applyAmendmentPlan({ transaction, db, plan, contractId, contract, actorUid, reason, now }) {
  const { preview, amendmentId } = plan
  const at = Timestamp.fromMillis(now)
  const summary = { id: amendmentId, date: vietnamDateKey(new Date(now)), reason, before: preview.before, after: preview.after,
    usedSessions: preview.used, recognizedRevenue: preview.recognized, paidAmount: preview.cash, actorUid }
  transaction.create(db.doc(`contractAmendments/${amendmentId}`), { ...summary, schemaVersion: 1, contractId, studentId: contract.studentId,
    branchId: contract.branchId, previousRevision: Number(contract.revision || 0), snapshotHash: preview.snapshotHash, createdAt: at })
  const delta = preview.after.netValue - preview.before.netValue
  if (delta) transaction.create(db.doc(`ledgerEntries/${amendmentId}`), { schemaVersion: 4, type: 'adjustment', eventClass: 'contract_amendment',
    source: 'pt_gym', postingClass: 'memorandum', contractId, studentId: contract.studentId, branchId: contract.branchId,
    amount: Math.abs(delta), cashImpact: 0, revenueImpact: 0, expenseImpact: 0, receivableImpact: 0, deferredRevenueImpact: 0,
    contractSalesImpact: delta, status: 'posted', reason, effectiveAt: at, createdAt: at, createdBy: actorUid, idempotencyKey: amendmentId })
  if (plan.schedulePlan) {
    require('./session-operations').applyCancellationSchedulePlan({ transaction, plan: plan.schedulePlan, actorUid })
    for (const row of preview.affectedBookings) transaction.update(db.doc(`sessions/${row.id}`), { status: 'student_cancelled', scheduleStatus: 'cancelled',
      billingStatus: 'exempt', countsTowardContract: false, cancellationSource: 'contract_amendment', cancellationReason: reason,
      revision: FieldValue.increment(1), updatedAt: at, updatedBy: actorUid })
    for (const doc of plan.requests) transaction.update(doc.ref, { status: 'rejected', adminNote: 'Lịch đã hủy do điều chỉnh thời hạn hợp đồng.', revision: FieldValue.increment(1), updatedAt: at, updatedBy: actorUid })
  }
  return { ...plan.patch, revenueAllocation: plan.allocation, salesOriginalSnapshot: plan.salesOriginalSnapshot,
    amendmentHistory: [...(contract.amendmentHistory || []), summary].slice(-10) }
}

module.exports = { amendmentProjection, revisedInstallments, readAmendmentPlan, applyAmendmentPlan }
