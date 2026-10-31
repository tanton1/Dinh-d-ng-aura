const { createHash } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { addDateDays, dateKey, inclusiveDateDays, contractDurationMonths, offRegistrationLimit, ptOperationsPolicySnapshot, storedDateShape, vietnamDateKey, weeklyOffDeadline } = require('./pt-policy')
const { assertRenewalLink, renewalDateSyncPatch } = require('./contract-renewal-handover')
const { contractSalesIndexPatch } = require('./contract-sales-index')

const canManageStudentOff = actor => ['admin', 'super_admin'].includes(actor.accessRole)
const identifier = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new HttpsError('invalid-argument', 'Mã thao tác OFF không hợp lệ.')
  return value
}
const day = value => {
  try { return dateKey(value) } catch { throw new HttpsError('invalid-argument', 'Ngày OFF không hợp lệ.') }
}
const text = value => typeof value === 'string' ? value.trim().slice(0, 1000) : ''
const revision = value => {
  if (!Number.isInteger(value) || value < 0) throw new HttpsError('invalid-argument', 'Thiếu phiên bản dữ liệu. Hãy mở lại form OFF.')
  return value
}
const overlaps = (start, end, item) => start <= String(item.endDate).slice(0, 10) && end >= String(item.startDate).slice(0, 10)
const isOff = (item, policy) => item.type === 'off' || (!item.type && inclusiveDateDays(day(item.startDate), day(item.endDate)) <= policy.offMaxDaysPerRequest)
const protectedSession = session => session.billingStatus === 'charged' || session.chargedAt || session.attendanceEventId || ['completed', 'attended', 'no_show'].includes(session.status) || ['present', 'late', 'no_show'].includes(session.attendanceStatus)
const activeSession = session => ['scheduled', 'rescheduled'].includes(session.status)

function createAdminStudentOffFunction({ db, onCall, authorizeAdmin, now, readCancellationSchedulePlan, applyCancellationSchedulePlan }) {
  return onCall(async request => {
    const actor = await authorizeAdmin(request, db)
    if (!canManageStudentOff(actor)) throw new HttpsError('permission-denied', 'Chỉ admin được tạo hoặc sửa OFF cho học viên.')
    const input = request.data || {}
    if (!['context', 'create', 'edit'].includes(input.action)) throw new HttpsError('invalid-argument', 'Thao tác OFF không hợp lệ.')
    const contractId = identifier(input.contractId)
    const editing = Boolean(input.requestId)
    if (input.action === 'edit' && !editing || input.action === 'create' && editing) throw new HttpsError('invalid-argument', 'Yêu cầu OFF không hợp lệ.')
    const currentTime = now()
    const write = input.action !== 'context'
    const command = write ? {
      action: input.action, contractId, requestId: editing ? identifier(input.requestId) : '',
      startDate: day(input.startDate), endDate: day(input.endDate), reason: text(input.reason), exceptionReason: text(input.exceptionReason),
      expectedContractRevision: revision(input.expectedContractRevision), expectedRevision: editing ? revision(input.expectedRevision) : null,
    } : null
    const key = write ? identifier(input.idempotencyKey) : ''
    const operationId = write ? `admin-off-${createHash('sha256').update(`${actor.uid}/${key}`).digest('hex')}` : ''
    const requestId = editing ? identifier(input.requestId) : operationId
    const fingerprint = write ? createHash('sha256').update(JSON.stringify(command)).digest('hex') : ''
    const contractRef = db.doc(`contracts/${contractId}`)
    const requestRef = requestId ? db.doc(`leaveRequests/${requestId}`) : null
    const eventRef = write ? db.doc(`contractPauseEvents/${operationId}`) : null

    return db.runTransaction(async transaction => {
      if (eventRef) {
        const previous = await transaction.get(eventRef)
        if (previous.exists) {
          if (previous.data().fingerprint !== fingerprint) throw new HttpsError('already-exists', 'Mã thao tác đã được dùng với thông tin khác. Hãy mở lại form OFF.')
          return { ...previous.data().result, unchanged: true }
        }
      }
      const [contractSnapshot, requestSnapshot, settings] = await Promise.all([
        transaction.get(contractRef),
        requestRef ? transaction.get(requestRef) : null,
        transaction.get(db.doc('settings/scheduleConfig')),
      ])
      if (!contractSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
      const contract = contractSnapshot.data()
      const studentId = identifier(contract.studentId)
      if (!['active', 'frozen'].includes(contract.status) || contract.renewalSupersededBy) throw new HttpsError('failed-precondition', 'Chỉ tạo hoặc sửa OFF trên hợp đồng đang hoạt động hoặc bảo lưu, chưa bàn giao.')
      const previous = editing && requestSnapshot?.exists ? requestSnapshot.data() : null
      if (editing && (!previous || previous.contractId !== contractId || previous.studentId !== studentId)) throw new HttpsError('not-found', 'OFF không thuộc hợp đồng đã chọn.')
      if (!editing && requestSnapshot?.exists) throw new HttpsError('already-exists', 'Thao tác đã tồn tại. Hãy tải lại hồ sơ.')
      const policy = ptOperationsPolicySnapshot(previous?.policySnapshot || (settings.exists ? settings.data() : {}))
      if (previous && (!['pending', 'approved'].includes(previous.status) || !isOff(previous, policy))) throw new HttpsError('failed-precondition', 'Chỉ sửa ngày của OFF đang chờ duyệt hoặc đã duyệt.')
      const [packageSnapshot, requestsSnapshot, studentSnapshot] = await Promise.all([
        contract.packageId ? transaction.get(db.doc(`packages/${identifier(contract.packageId)}`)) : null,
        transaction.get(db.collection('leaveRequests').where('studentId', '==', studentId).limit(201)),
        transaction.get(db.doc(`students/${studentId}`)),
      ])
      if (requestsSnapshot.size > 200) throw new HttpsError('resource-exhausted', 'Có quá nhiều yêu cầu nghỉ để đối soát an toàn.')
      const otherRequests = requestsSnapshot.docs.map(item => ({ ...item.data(), requestId: item.id }))
        .filter(item => item.contractId === contractId && item.requestId !== requestId && ['pending', 'approved'].includes(item.status))
      const periods = Array.isArray(contract.pausePeriods) ? contract.pausePeriods : []
      // Older approved periods may have no leaveRequests document. They still
      // reserve dates and an OFF allowance; do not count projected copies twice.
      const otherPeriods = periods.filter(item => item.requestId !== requestId && !otherRequests.some(other => other.requestId === item.requestId))
      const reserved = [...otherRequests, ...otherPeriods]
      const durationMonths = contractDurationMonths(contract, packageSnapshot?.exists ? packageSnapshot.data() : {})
      const offLimit = offRegistrationLimit(durationMonths, policy)
      const offUsed = reserved.filter(item => isOff(item, policy)).length
      const originalEnd = day(String(contract.endDate).slice(0, 10))
      const contractStart = day(String(contract.startDate).slice(0, 10))
      const oldDuration = previous?.status === 'approved' ? inclusiveDateDays(day(previous.startDate), day(previous.endDate)) : 0
      const baseEnd = addDateDays(originalEnd, -oldDuration)
      if (!write) return {
        contractId, contractRevision: Number(contract.revision || 0), studentName: text(studentSnapshot.data()?.name), packageName: text(contract.packageName),
        startDate: contractStart, endDate: originalEnd, maxOffEndDate: baseEnd, now: currentTime.toISOString(), today: vietnamDateKey(currentTime),
        policy: { maxDays: policy.offMaxDaysPerRequest, cutoffHour: policy.offRegistrationCutoffHour, offLimit, offUsed },
        request: previous ? { id: requestId, revision: Number(previous.revision || 0), status: previous.status, startDate: previous.startDate, endDate: previous.endDate, reason: text(previous.reason) } : null,
      }
      if (command.expectedContractRevision !== Number(contract.revision || 0) || previous && command.expectedRevision !== Number(previous.revision || 0)) throw new HttpsError('aborted', 'Dữ liệu đã thay đổi. Hãy mở lại form OFF để cập nhật.')
      if (command.reason.length < 3) throw new HttpsError('invalid-argument', 'Nhập lý do tạo hoặc sửa OFF từ 3 ký tự.')
      let durationDays
      try { durationDays = inclusiveDateDays(command.startDate, command.endDate) } catch { throw new HttpsError('invalid-argument', 'Ngày kết thúc phải từ ngày bắt đầu OFF.') }
      if (durationDays > policy.offMaxDaysPerRequest) throw new HttpsError('failed-precondition', `OFF tối đa ${policy.offMaxDaysPerRequest} ngày mỗi lượt. Nghỉ dài hơn cần làm bảo lưu.`)
      if (command.startDate < contractStart || command.endDate > baseEnd) throw new HttpsError('failed-precondition', 'Khoảng OFF phải nằm trong thời hạn hợp đồng, không tính phần gia hạn của chính OFF đang sửa.')
      if (reserved.some(item => overlaps(command.startDate, command.endDate, item))) throw new HttpsError('already-exists', 'Ngày OFF trùng với OFF hoặc bảo lưu đang chờ duyệt/đã duyệt.')
      if (offUsed >= offLimit) throw new HttpsError('failed-precondition', `Hợp đồng đã dùng hoặc đăng ký đủ ${offLimit} lượt OFF.`)
      const cutoff = weeklyOffDeadline(command.startDate, policy.offRegistrationCutoffHour)
      const late = currentTime.getTime() >= cutoff.getTime()
      if (late && command.exceptionReason.length < 3) throw new HttpsError('failed-precondition', 'Đã qua giờ chốt OFF. Admin cần ghi lý do ngoại lệ từ 3 ký tự.', { issueCode: 'OFF_REGISTRATION_DEADLINE_PASSED', deadlineAt: cutoff.toISOString() })
      const approved = !previous || previous.status === 'approved'
      const deltaDays = approved ? durationDays - oldDuration : 0
      const nextEnd = addDateDays(originalEnd, deltaDays)
      const nextEndValue = storedDateShape(contract.endDate, nextEnd)
      const extensions = Array.isArray(contract.extensions) ? [...contract.extensions] : []
      const extensionId = `pause-request-${requestId}`
      if (oldDuration && (periods.filter(item => item.requestId === requestId).length !== 1 || extensions.filter(item => item.id === extensionId).length !== 1)) throw new HttpsError('failed-precondition', 'Lịch sử gia hạn của OFF chưa khớp. Cần đối soát hợp đồng trước khi sửa.')
      if (oldDuration) {
        const period = periods.find(item => item.requestId === requestId)
        const extension = extensions.find(item => item.id === extensionId)
        if (day(period.startDate) !== day(previous.startDate) || day(period.endDate) !== day(previous.endDate)
          || inclusiveDateDays(day(extension.oldEndDate), day(extension.newEndDate)) - 1 !== oldDuration) throw new HttpsError('failed-precondition', 'Số ngày gia hạn của OFF chưa khớp. Cần đối soát hợp đồng trước khi sửa.')
      }
      if (reserved.some(item => day(String(item.endDate).slice(0, 10)) > nextEnd)) throw new HttpsError('failed-precondition', 'Ngày hết hạn mới nằm trước một kỳ nghỉ khác. Hãy điều chỉnh kỳ nghỉ đó trước.')

      let active = [], released = [], pendingRequests = [], schedulePlan = null, linkedRenewal = null
      if (approved) {
        const queryStart = previous ? [previous.startDate, command.startDate].sort()[0] : command.startDate
        const queryEnd = previous ? [previous.endDate, command.endDate].sort().at(-1) : command.endDate
        const [sessions, sessionRequests, tail] = await Promise.all([
          transaction.get(db.collection('sessions').where('studentId', '==', studentId).where('date', '>=', queryStart).where('date', '<', addDateDays(queryEnd, 1)).limit(201)),
          transaction.get(db.collection('sessionRequests').where('studentId', '==', studentId).limit(201)),
          deltaDays < 0 ? transaction.get(db.collection('sessions').where('studentId', '==', studentId).where('date', '>=', addDateDays(nextEnd, 1)).where('date', '<', addDateDays(originalEnd, 1)).limit(201)) : null,
        ])
        if (sessions.size > 200 || sessionRequests.size > 200 || (tail?.size || 0) > 200) throw new HttpsError('resource-exhausted', 'Có quá nhiều buổi tập hoặc yêu cầu để cập nhật an toàn.')
        const belongs = item => item.data().contractId === contractId
        const inNewPeriod = item => overlaps(command.startDate, command.endDate, { startDate: item.data().date, endDate: item.data().date })
        if (sessions.docs.some(item => belongs(item) && inNewPeriod(item) && protectedSession(item.data()))) throw new HttpsError('failed-precondition', 'Khoảng OFF có buổi đã điểm danh hoặc tính phí. Hãy đối soát buổi đó trước.')
        if (tail?.docs.some(item => (belongs(item) || !item.data().contractId) && (activeSession(item.data()) || protectedSession(item.data())))) throw new HttpsError('failed-precondition', 'Rút ngắn OFF làm ngày hết hạn nằm trước buổi đã xếp hoặc đã tập. Hãy điều chỉnh buổi đó trước.')
        // Missing contract identity cannot safely be assigned to this contract.
        if (sessions.docs.some(item => !item.data().contractId && inNewPeriod(item) && (activeSession(item.data()) || protectedSession(item.data())))) throw new HttpsError('failed-precondition', 'Có buổi tập thiếu mã hợp đồng trong khoảng OFF. Hãy đối soát trước.')
        active = sessions.docs.filter(item => belongs(item) && inNewPeriod(item) && activeSession(item.data()))
        released = sessions.docs.filter(item => belongs(item) && !inNewPeriod(item) && item.data().pauseRequestId === requestId && item.data().status === 'student_cancelled' && String(item.data().date).slice(0, 10) >= vietnamDateKey(currentTime))
        const activeIds = new Set(active.map(item => item.id))
        pendingRequests = sessionRequests.docs.filter(item => item.data().status === 'pending' && (activeIds.has(item.data().sessionId) || item.data().contractId === contractId && item.data().newDate && overlaps(command.startDate, command.endDate, { startDate: item.data().newDate, endDate: item.data().newDate })))
        schedulePlan = await readCancellationSchedulePlan({ transaction, db, sessions: active, fallbackBranchId: contract.branchId || '' })
        if (contract.renewedByContractId) {
          const linkedRef = db.doc(`contracts/${identifier(contract.renewedByContractId)}`)
          const linkedSnapshot = await transaction.get(linkedRef)
          if (!linkedSnapshot.exists) throw new HttpsError('failed-precondition', 'Không tìm thấy hợp đồng nối tiếp để đồng bộ ngày.')
          const linked = linkedSnapshot.data()
          assertRenewalLink(contractId, contract, linkedSnapshot.id, linked)
          if (linked.status !== 'future') throw new HttpsError('failed-precondition', 'Hợp đồng nối tiếp đã kích hoạt. Cần đối soát trước khi sửa OFF.')
          const patch = renewalDateSyncPatch({ ...contract, endDate: nextEnd }, linked)
          if (Object.keys(patch).length) linkedRenewal = { ref: linkedRef, patch: { ...patch, ...contractSalesIndexPatch({ ...linked, ...patch }), revision: Number(linked.revision || 0) + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid } }
        }
      }

      // All transaction reads finish before changing schedules or entitlement.
      const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }
      const removedScheduleEntryCount = schedulePlan ? applyCancellationSchedulePlan({ transaction, plan: schedulePlan, actorUid: actor.uid }) : 0
      for (const item of active) transaction.update(item.ref, {
        ...stamp, status: 'student_cancelled', scheduleStatus: 'cancelled', billingStatus: 'exempt', attendanceStatus: null,
        cancellationReason: 'OFF do admin cập nhật', pauseRequestId: requestId, countsTowardContract: false, cancelledAt: FieldValue.serverTimestamp(), revision: Number(item.data().revision || 0) + 1,
      })
      for (const item of pendingRequests) transaction.update(item.ref, {
        ...stamp, status: 'rejected', adminNote: 'Tự đóng vì admin cập nhật OFF.', rejectedAt: FieldValue.serverTimestamp(), rejectedBy: actor.uid,
        rejectionSource: 'contract_pause_approval', rejectionSourceRequestId: requestId, revision: Number(item.data().revision || 0) + 1,
      })
      if (approved) {
        const period = { requestId, type: 'off', startDate: command.startDate, endDate: command.endDate, durationDays }
        const extensionIndex = extensions.findIndex(item => item.id === extensionId)
        const extension = extensionIndex >= 0 ? extensions[extensionIndex] : { id: extensionId, oldEndDate: contract.endDate, createdAt: currentTime.toISOString(), createdBy: actor.uid }
        const correctedExtension = { ...extension, type: 'off', days: durationDays, newEndDate: storedDateShape(contract.endDate, addDateDays(day(String(extension.oldEndDate).slice(0, 10)), durationDays)), reason: `Cộng ${durationDays} ngày OFF`, lastCorrectionEventId: operationId }
        if (extensionIndex >= 0) extensions[extensionIndex] = correctedExtension
        else extensions.push(correctedExtension)
        transaction.update(contractRef, { ...stamp, endDate: nextEndValue, extensions, pausePeriods: [...periods.filter(item => item.requestId !== requestId), period], revision: Number(contract.revision || 0) + 1 })
        if (linkedRenewal) transaction.update(linkedRenewal.ref, linkedRenewal.patch)
      } else transaction.update(contractRef, { ...stamp, revision: Number(contract.revision || 0) + 1 })
      const requestRevision = Number(previous?.revision || 0) + 1
      const status = approved ? 'approved' : 'pending'
      const patch = {
        ...stamp, schemaVersion: 3, policyVersion: 'pt-contract-pause-v2', policySnapshot: policy,
        studentId, contractId, accountUid: previous?.accountUid || studentSnapshot.data()?.accountUid || '', type: 'off', status,
        startDate: command.startDate, endDate: command.endDate, durationDays, reason: previous?.reason || command.reason,
        adminNote: command.reason, revision: requestRevision, contractDurationMonths: durationMonths, offLimit,
        requiresExceptionApproval: late, exceptionType: late ? 'late_off' : null, cutoffAt: cutoff.toISOString(), lateByMinutes: late ? Math.ceil((currentTime - cutoff) / 60000) : 0,
        exceptionApproved: late && approved, exceptionApprovalStatus: late ? approved ? 'approved' : 'pending' : 'not_required', exceptionReason: late ? command.exceptionReason : '',
        lastAdminOperationId: operationId, ...(late && approved ? { exceptionApprovedAt: FieldValue.serverTimestamp(), exceptionApprovedBy: actor.uid } : {}),
        ...(approved ? { offSequence: previous?.offSequence || offUsed + 1, oldContractEndDate: previous?.oldContractEndDate || contract.endDate, newContractEndDate: nextEndValue, cancelledSessionCount: Number(previous?.cancelledSessionCount || 0) + active.length, removedScheduleEntryCount: Number(previous?.removedScheduleEntryCount || 0) + removedScheduleEntryCount } : {}),
      }
      if (previous) transaction.update(requestRef, patch)
      else transaction.create(requestRef, { ...patch, source: 'admin', createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), submittedAtIso: currentTime.toISOString(), approvedAt: FieldValue.serverTimestamp(), approvedBy: actor.uid })
      const result = { requestId, status, revision: requestRevision, durationDays, deltaDays, newEndDate: nextEnd, cancelledSessionCount: active.length, rescheduleNeededCount: released.length, unchanged: false }
      transaction.create(eventRef, {
        schemaVersion: 2, type: previous ? 'admin_off_date_correction' : 'admin_off_created', requestId, contractId, studentId, fingerprint,
        previous: previous ? { startDate: previous.startDate, endDate: previous.endDate, status: previous.status, revision: Number(previous.revision || 0) } : null,
        startDate: command.startDate, endDate: command.endDate, durationDays, deltaDays, oldEndDate: contract.endDate, newEndDate: nextEndValue,
        reason: command.reason, exceptionReason: late ? command.exceptionReason : '', cancelledSessionIds: active.map(item => item.id), rescheduleSessionIds: released.map(item => item.id), rejectedRequestIds: pendingRequests.map(item => item.id),
        result, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid,
      })
      return result
    })
  })
}

module.exports = { canManageStudentOff, createAdminStudentOffFunction, hasProtectedOffSession: protectedSession }
