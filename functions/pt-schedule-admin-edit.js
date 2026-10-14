'use strict'

const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { branchScheduleSnapshot, branchSlotCapacity, dateForSlot, nextWeek, normalizedCapacity, normalizedScheduleConfig, storedDate, trainerProfileForWeek, trainerIsAvailable } = require('./pt-schedule-publish')
const { effectiveStudentAvailability } = require('./student-availability')
const { sessionCountsTowardContract, summarizeContractUsage } = require('./contract-usage')

const occupies = (session) => ['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'].includes(session.status) || sessionCountsTowardContract(session)
const sessionHour = (session, id) => Number.isInteger(session.hour) ? session.hour : Number(/^(?:T[2-7]|CN)-(\d{1,2})-/.exec(id)?.[1] ?? -1)
const sameEntry = (entry, studentId, trainerId) => entry.type !== 'off' && entry.studentId === studentId && entry.trainerId === trainerId
const fail = (code, message) => { throw new HttpsError('failed-precondition', message, { issueCode: code, errors: [code] }) }

// Explicit Admin edits reconcile the operational schedule and real session in
// ONE transaction. They are not an optimizer override and never hard-delete
// attendance/accounting evidence. Ordinary staff draft commands stay separate.
async function applyAdminScheduleEdit({ db, actor, branchId, week, command, payload, reason, expectedRevision, receipt, safeSchedule, scopedDraftData, draftExpiresAt }) {
  if (!['admin', 'super_admin'].includes(actor.accessRole)) throw new HttpsError('permission-denied', 'Chỉ Admin được xác nhận điều chỉnh ca đã khóa hoặc đã ghi nhận.')
  if (!['move_student', 'remove_student'].includes(command)) throw new HttpsError('invalid-argument', 'Lệnh điều chỉnh Admin không hợp lệ.')
  const adminManualOverride = true
  reason = typeof reason === 'string' ? reason.trim().slice(0, 300) : ''
  // Matrix corrections are intentionally quick. Keep an audit reason, but
  // use a safe default when Admin moves or removes a row without typing one.
  if (!reason) reason = command === 'remove_student' ? 'Admin gỡ buổi trực tiếp trên ma trận' : 'Admin điều chỉnh buổi trực tiếp trên ma trận'
  const { studentId, trainerId, slotId } = payload
  const sourceTrainerId = command === 'move_student' ? payload.fromTrainerId : trainerId
  const sourceSlot = command === 'move_student' ? payload.fromSlotId : slotId
  const sourceDate = dateForSlot(week, sourceSlot.split('-')[0])
  const sourceHour = Number(sourceSlot.split('-')[1])
  const targetDate = dateForSlot(week, slotId.split('-')[0])
  const targetHour = Number(slotId.split('-')[1])
  if (command === 'move_student' && sourceSlot === slotId && sourceTrainerId === trainerId) throw new HttpsError('invalid-argument', 'Ca đích trùng ca nguồn.')
  const draftRef = db.doc(`ptScheduleDrafts/${branchId}_${week}`)
  const legacyRef = db.doc(`schedules/schedule_${week}`)
  const instant = new Date()
  const targetInstant = new Date(`${targetDate}T${String(targetHour).padStart(2, '0')}:00:00+07:00`)

  return db.runTransaction(async (transaction) => {
    const [prior, draftSnapshot, legacy, studentSnapshot, trainers, trainerWeek, learnerWeek, configSnapshot, studentSessions, branchSessions, contracts, leaves] = await Promise.all([
      transaction.get(receipt), transaction.get(draftRef), transaction.get(legacyRef),
      transaction.get(db.doc(`students/${studentId}`)),
      transaction.get(db.collection('trainers').where('branchId', '==', branchId).limit(101)),
      transaction.get(db.doc(`trainerAvailability/${trainerId}_${week}`)),
      transaction.get(db.doc(`ptAvailability/${studentId}_${week}`)),
      transaction.get(db.doc('settings/scheduleConfig')),
      transaction.get(db.collection('sessions').where('studentId', '==', studentId).limit(1001)),
      transaction.get(db.collection('sessions').where('branchId', '==', branchId).where('date', '>=', week).where('date', '<', nextWeek(week)).limit(1001)),
      transaction.get(db.collection('contracts').where('studentId', '==', studentId).limit(101)),
      transaction.get(db.collection('leaveRequests').where('trainerId', '==', trainerId).limit(1001)),
    ])
    if (prior.exists) return prior.data().result
    if (trainers.size > 100 || contracts.size > 100 || studentSessions.size > 1000 || branchSessions.size > 1000 || leaves.size > 1000) throw new HttpsError('resource-exhausted', 'Dữ liệu vượt giới hạn đối chiếu ca an toàn.')
    const draft = scopedDraftData(draftSnapshot, branchId, week)
    const revision = Number(draft?.revision ?? legacy.data()?.draftRevision ?? 0)
    if (revision !== expectedRevision) throw new HttpsError('aborted', 'Lịch đã thay đổi. Hãy tải lại trước khi xác nhận.', { issueCode: 'REVISION_CONFLICT' })
    const student = studentSnapshot.data() || {}
    const trainerMap = new Map(trainers.docs.map((item) => [item.id, item.data()]))
    const schedule = safeSchedule(draft ? draft.schedule : branchScheduleSnapshot(legacy.data()?.schedule || {}, branchId, new Map([[studentId, student]]), trainerMap))
    const entries = (schedule[sourceSlot] || []).filter((entry) => sameEntry(entry, studentId, sourceTrainerId))
    const sourceMatches = studentSessions.docs.filter((item) => occupies(item.data()) && item.data().trainerId === sourceTrainerId
      && storedDate(item.data().date) === sourceDate && sessionHour(item.data(), item.id) === sourceHour)
    if (entries.length > 1 || sourceMatches.length > 1) fail('DUPLICATE_DEPLOYED_SESSION', 'Ca nguồn bị trùng. Cần đối soát trước khi điều chỉnh.')
    if (!entries.length && !sourceMatches.length) fail('SOURCE_SESSION_NOT_FOUND', 'Ca nguồn không còn tồn tại. Hãy tải lại lịch.')
    const source = sourceMatches[0]
    const session = source?.data()
    if (session && session.branchId && !['all', branchId].includes(session.branchId)) throw new HttpsError('permission-denied', 'Buổi tập không thuộc cơ sở đang điều chỉnh.')
    if (session && ((payload.sessionId && payload.sessionId !== source.id)
      || (payload.expectedSessionRevision !== undefined
        && payload.expectedSessionRevision !== Number(session.revision || 0)))) {
      throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại lịch và xác nhận phiên bản mới.', { issueCode: 'REVISION_CONFLICT' })
    }
    if (!session && (payload.sessionId || entries[0]?.source === 'published_existing')) fail('SOURCE_SESSION_NOT_FOUND', 'Không tìm thấy buổi đã ghi nhận tương ứng; chưa thay đổi lịch.')
    if (!trainerMap.has(sourceTrainerId)) fail('TRAINER_BRANCH_MISMATCH', 'PT nguồn không thuộc cơ sở đang điều chỉnh.')

    const attendanceRef = session ? db.doc(`attendanceEvents/${session.attendanceEventId || source.id}`) : null
    const periods = [...new Set([sourceDate.slice(0, 7), targetDate.slice(0, 7)])]
    const [attendance, payroll, finance] = await Promise.all([
      attendanceRef ? transaction.get(attendanceRef) : null,
      session ? Promise.all(periods.map((period) => transaction.get(db.doc(`payrollRuns/${period}`)))) : [],
      session ? Promise.all(periods.map((period) => transaction.get(db.doc(`financePeriods/${period}`)))) : [],
    ])
    if (attendance?.exists && attendance.data().sessionId !== source.id) fail('ATTENDANCE_SESSION_MISMATCH', 'Bản ghi điểm danh không khớp buổi tập.')
    if (payroll.some((item) => item.exists && item.data().status !== 'draft')) fail('PAYROLL_RUN_IMMUTABLE', 'Kỳ lương đã chốt; cần bù trừ, không sửa chứng từ ca gốc.')
    if (finance.some((item) => item.exists && item.data().status === 'locked')) fail('FINANCE_PERIOD_LOCKED', 'Kỳ tài chính đã khóa; cần điều chỉnh tại kỳ mở.')

    const contractId = session?.contractId || entries[0]?.contractId || ''
    const contractSnapshot = contracts.docs.find((item) => item.id === contractId)
    const contract = contractSnapshot?.data()
    if (command === 'remove_student' && session
      && (attendance?.exists || sessionCountsTowardContract(session)
        || ['completed', 'attended', 'no_show'].includes(String(session.status || '').toLowerCase()))) {
      throw new HttpsError('failed-precondition', 'Buổi đã điểm danh hoặc đã tính buổi; không xóa trực tiếp. Hãy dùng điều chỉnh ca hoặc bù trừ để giữ nguyên billing.', {
        issueCode: 'TEACHING_SHIFT_STATUS_NOT_EDITABLE',
        sessionId: source.id,
      })
    }
    const warnings = []
    let nextEntry = null
    if (command === 'move_student') {
      const trainer = trainerProfileForWeek(trainerMap.get(trainerId) || {}, trainerWeek.exists ? trainerWeek.data() : null, week)
      if (!trainerMap.has(trainerId) || ['inactive', 'archived', 'deleted'].includes(trainer.status)) fail('TRAINER_NOT_ACTIVE', 'PT đích không còn hoạt động tại cơ sở này.')
      if (!studentSnapshot.exists || ['archived', 'deleted'].includes(student.status)) fail('STUDENT_NOT_ACTIVE', 'Hồ sơ học viên không còn hợp lệ.')
      if (student.branchId !== branchId) warnings.push('STUDENT_BRANCH_MISMATCH')
      if (!contract || contract.studentId !== studentId || !storedDate(contract.startDate) || !storedDate(contract.endDate)
        || ['cancelled', 'canceled', 'void', 'refunded', 'deleted'].includes(contract.status)
        || storedDate(contract.startDate) > targetDate || storedDate(contract.endDate) < targetDate) warnings.push('ACTIVE_CONTRACT_NOT_FOUND')
      if ((contract?.pausePeriods || []).some((p) => storedDate(p.startDate) <= targetDate && storedDate(p.endDate) >= targetDate)) warnings.push('CONTRACT_PAUSED')
      if (session && (attendance?.exists || sessionCountsTowardContract(session)) && targetInstant > instant) fail('TEACHING_SHIFT_FUTURE_ATTENDANCE', 'Buổi đã tính hoặc điểm danh không thể chuyển sang tương lai.')
      if (session && sessionCountsTowardContract(session) && sourceDate.slice(0, 7) !== targetDate.slice(0, 7)) fail('TEACHING_SHIFT_CROSS_PERIOD_CORRECTION', 'Buổi đã tính không thể chuyển sang tháng khác; cần dùng bù trừ.')
      const calendar = normalizedScheduleConfig(configSnapshot.data())
      const [day] = slotId.split('-')
      if (!calendar.workingDays.includes(day) || !calendar.workingHours.includes(targetHour) || calendar.holidays.includes(targetDate)) warnings.push('OUTSIDE_WORKING_CALENDAR')
      if (targetInstant > instant) {
        if (!trainerIsAvailable(trainer, slotId)) warnings.push('OUTSIDE_TRAINER_AVAILABILITY')
        if (leaves.docs.some((item) => item.data().status === 'approved' && storedDate(item.data().startDate) <= targetDate && storedDate(item.data().endDate || item.data().startDate) >= targetDate)) warnings.push('TRAINER_ON_LEAVE')
      }
      // Combine the draft and real sessions, deduplicating by learner/PT/time.
      // This catches collisions even when another session is absent from a draft.
      const occupied = new Map()
      for (const [slot, rows] of Object.entries(schedule)) for (const row of rows) {
        if (row.type === 'off' || slot === sourceSlot && sameEntry(row, studentId, sourceTrainerId)) continue
        occupied.set(`${row.studentId}|${row.trainerId}|${slot}`, { ...row, slot })
      }
      for (const item of [...branchSessions.docs, ...studentSessions.docs]) {
        const row = item.data(), date = storedDate(row.date)
        if (item.id === source?.id || !occupies(row) || date < week || date >= nextWeek(week)) continue
        const offset = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${week}T00:00:00Z`)) / 86400000)
        const slot = `${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][offset]}-${sessionHour(row, item.id)}`
        occupied.set(`${row.studentId}|${row.trainerId}|${slot}`, { ...row, slot })
      }
      const rows = [...occupied.values()]
      if (rows.some((row) => row.studentId === studentId && row.slot.split('-')[0] === day)) warnings.push('STUDENT_MULTIPLE_SESSIONS_PER_DAY')
      if ((schedule[slotId] || []).some((entry) => entry.type === 'off' && entry.trainerId === trainerId)) warnings.push('TRAINER_OFF_CONFLICT')
      if (rows.filter((row) => row.trainerId === trainerId && row.slot === slotId).length >= normalizedCapacity(trainer.slotCapacity)) warnings.push('TRAINER_CAPACITY_EXCEEDED')
      const capacity = branchSlotCapacity(calendar, branchId, slotId)
      if (capacity !== null && rows.filter((row) => row.slot === slotId && (!row.branchId || row.branchId === 'all' || row.branchId === branchId)).length >= capacity) warnings.push('BRANCH_CAPACITY_REACHED')
      if (!session) {
        const contractSessions = studentSessions.docs.map((item) => ({ id: item.id, ...item.data() })).filter((row) => row.contractId === contractId)
        const usage = summarizeContractUsage(contract, contractSessions)
        const reserved = new Set(contractSessions.filter((row) => ['scheduled', 'rescheduled'].includes(row.status) && !sessionCountsTowardContract(row)).map((row) => `${row.studentId}|${storedDate(row.date)}|${sessionHour(row, row.id)}`))
        for (const row of rows.filter((row) => row.contractId === contractId)) reserved.add(`${row.studentId}|${dateForSlot(week, row.slot.split('-')[0])}|${row.slot.split('-')[1]}`)
        if (!contract || usage.remainingSessions <= reserved.size) warnings.push('CONTRACT_SESSION_QUOTA_EXCEEDED')
      }
      const availability = effectiveStudentAvailability({ targetWeek: week, exact: learnerWeek.exists ? learnerWeek.data() : null, profile: student })
      const availabilityReason = !availability.confirmed ? 'AVAILABILITY_NOT_SUBMITTED' : !availability.slots.includes(slotId) ? 'OUTSIDE_STUDENT_AVAILABILITY' : null
      if (availabilityReason) warnings.push(availabilityReason)
      const assigned = [contract?.trainerId, ...(contract?.trainerIds || [])].filter(Boolean)
      if (assigned.length && !assigned.includes(trainerId)) warnings.push('TRAINER_ASSIGNMENT_MISMATCH')
      nextEntry = {
        studentId, trainerId, branchId, contractId, type: 'training', source: 'manual_v2',
        adminOverride: adminManualOverride,
        adminOverrideBy: actor.uid,
        adminOverrideAt: instant.toISOString(),
        adminOverrideWarnings: [...new Set(warnings)],
        ...(entries[0]?.isLocked || session ? { isLocked: true } : {}),
        ...(student.branchId !== branchId ? { studentBranchWarning: true, studentHomeBranchId: student.branchId } : {}),
        ...(warnings.includes('TRAINER_ASSIGNMENT_MISMATCH') ? { trainerAssignmentWarning: true } : {}),
        ...(availabilityReason ? { availabilityOverride: true, availabilityOverrideReason: availabilityReason, availabilityOverrideBy: actor.uid, availabilityOverrideAt: instant.toISOString() } : {}),
      }
    }
    if (session && command === 'remove_student' && sessionCountsTowardContract(session) && !contract) fail('ACTIVE_CONTRACT_NOT_FOUND', 'Cần xác định hợp đồng gốc để hoàn đúng số buổi khi gỡ lịch.')
    const reconcile = (original) => {
      const result = { ...original }
      result[sourceSlot] = (result[sourceSlot] || []).filter((row) => !sameEntry(row, studentId, sourceTrainerId))
      if (!result[sourceSlot].length) delete result[sourceSlot]
      if (nextEntry) result[slotId] = [...(result[slotId] || []), nextEntry]
      return result
    }
    const nextSchedule = reconcile(schedule)
    const result = { draftRevision: revision + 1, schedule: nextSchedule, weeklySessionTargets: draft?.weeklySessionTargets || {}, adminEdit: true, sessionChanged: Boolean(session), warnings: [...new Set(warnings)] }
    const before = { date: sourceDate, hour: sourceHour, trainerId: sourceTrainerId, branchId, ...(session ? { status: session.status || '', billingStatus: session.billingStatus || '', attendanceStatus: session.attendanceStatus || '' } : {}) }
    const after = nextEntry ? { date: targetDate, hour: targetHour, trainerId, branchId } : { status: 'cancelled', billingStatus: 'exempt' }
    if (session) {
      const ref = db.doc(`sessions/${source.id}`)
      const patch = command === 'move_student' ? {
        ...nextEntry, date: targetDate, hour: targetHour, slotId, scheduleWeekId: week,
        scheduleEntryId: `schedule_${week}-${slotId}-${studentId}`,
        scheduleStatus: 'rescheduled',
        availabilityOverride: nextEntry.availabilityOverride || FieldValue.delete(),
        availabilityOverrideReason: nextEntry.availabilityOverrideReason || FieldValue.delete(),
        availabilityOverrideBy: nextEntry.availabilityOverrideBy || FieldValue.delete(),
        availabilityOverrideAt: nextEntry.availabilityOverrideAt || FieldValue.delete(),
        adminOverride: nextEntry.adminOverride === true ? true : FieldValue.delete(),
        adminOverrideBy: nextEntry.adminOverride === true ? nextEntry.adminOverrideBy || '' : FieldValue.delete(),
        adminOverrideAt: nextEntry.adminOverride === true ? nextEntry.adminOverrideAt || '' : FieldValue.delete(),
        adminOverrideWarnings: nextEntry.adminOverride === true ? nextEntry.adminOverrideWarnings || [] : FieldValue.delete(),
        studentBranchWarning: nextEntry.studentBranchWarning || FieldValue.delete(),
        studentHomeBranchId: nextEntry.studentHomeBranchId || FieldValue.delete(),
        trainerAssignmentWarning: nextEntry.trainerAssignmentWarning || FieldValue.delete(),
      } : { status: 'cancelled', scheduleStatus: 'cancelled', billingStatus: 'exempt', attendanceStatus: null, cancellationReason: reason, cancelledAt: FieldValue.serverTimestamp() }
      transaction.update(ref, { ...patch, previousSchedule: FieldValue.arrayUnion({ ...before, changedAt: instant.toISOString(), reason }), revision: Number(session.revision || 0) + 1, correctedBy: actor.uid, correctedAt: FieldValue.serverTimestamp(), correctionReason: reason, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      if (attendance?.exists) transaction.update(attendanceRef, {
        ...(command === 'move_student' ? { trainerId, branchId, scheduledAt: Timestamp.fromDate(targetInstant), occurredAt: Timestamp.fromDate(targetInstant), scheduleStatus: 'rescheduled' }
          : { type: 'cancelled', scheduleStatus: 'cancelled', billingStatus: 'exempt', attendanceStatus: 'cancelled', countsTowardContract: false }),
        correctionReason: reason, correctedBy: actor.uid, correctedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      })
      if (command === 'remove_student' && sessionCountsTowardContract(session)) {
        const rows = studentSessions.docs.filter((item) => item.data().contractId === contractId).map((item) => ({ id: item.id, ...item.data() }))
        const usedSessions = Math.max(0, summarizeContractUsage(contract, rows).usedSessions - 1)
        transaction.update(db.doc(`contracts/${contractId}`), {
          usedSessions,
          chargedSessionIds: (contract.chargedSessionIds || []).filter((id) => id !== source.id),
          attendedClasses: (contract.attendedClasses || []).filter((id) => id !== source.id),
          usageProjectionUpdatedAt: FieldValue.serverTimestamp(),
          ...(contract.usageReconciliationVersion >= 4 ? { historyEvidenceSessions: usedSessions, usageReconciliationStatus: usedSessions > Number(contract.totalSessions || 0) ? 'over_entitlement' : 'matched' } : {}),
        })
        transaction.create(db.collection('contractUsageAuditLogs').doc(), { action: 'contract_usage.admin_schedule_removed', sessionId: source.id, contractId, beforeUsed: summarizeContractUsage(contract, rows).usedSessions, afterUsed: usedSessions, reason, actorUid: actor.uid, createdAt: FieldValue.serverTimestamp() })
      }
      for (const item of payroll) if (item.exists) transaction.update(db.doc(`payrollRuns/${item.id}`), { requiresRebuild: true, sourceDataStale: true, sourceDataChangedBy: actor.uid, sourceDataChangedAt: FieldValue.serverTimestamp(), sourceDataChangeReason: reason })
      transaction.create(db.collection('sessionEvents').doc(), { schemaVersion: 2, sessionId: source.id, type: command === 'move_student' ? 'teaching_shift_corrected' : 'admin_schedule_cancelled', from: before, to: after, reason, warnings, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
    }
    transaction.set(draftRef, { schemaVersion: 2, branchId, weekId: week, schedule: nextSchedule, revision: revision + 1, status: 'draft', weeklySessionTargets: draft?.weeklySessionTargets || {}, unassignedEntries: [], optimizationSummary: FieldValue.delete(), expiresAt: draftExpiresAt(week), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
    if (legacy.exists) transaction.update(legacyRef, { schedule: reconcile(legacy.data().schedule || {}), draftRevision: Number(legacy.data().draftRevision || 0) + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
    transaction.create(receipt, { actorUid: actor.uid, branchId, weekId: week, command, result, createdAt: FieldValue.serverTimestamp() })
    transaction.create(db.collection('ptOperationsAuditLogs').doc(), { schemaVersion: 2, action: `pt_schedule.admin_${command}`, actorUid: actor.uid, branchId, weekId: week, studentId, sessionId: source?.id || null, previousDraftRevision: revision, nextDraftRevision: revision + 1, from: before, to: after, reason, warnings, createdAt: FieldValue.serverTimestamp() })
    return result
  })
}

module.exports = { applyAdminScheduleEdit }
