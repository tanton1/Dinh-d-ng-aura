'use strict'

const { createHash } = require('node:crypto')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { branchScheduleSnapshot, branchSlotCapacity, dateForSlot, nextWeek, normalizedCapacity, normalizedScheduleConfig, reintroducedSessionId, storedDate, trainerProfileForWeek, trainerIsAvailable } = require('./pt-schedule-publish')
const { effectiveStudentAvailability } = require('./student-availability')
const { sessionCountsTowardContract, summarizeContractUsage } = require('./contract-usage')
const { contractSchedulableOn, contractPausedOn } = require('./contract-status')
const { findScheduleContract, requireScheduleContract, requireCrossBranchConfirmation } = require('./schedule-entitlement-policy')
const { teachingRecognitionPlan, assertCancellationEvidenceChange } = require('./session-operations')

async function moveRevenuePlan({ transaction, db, sessionId, session, attendance, attendanceEventId, target, actorUid, reason }) {
  if (!sessionCountsTowardContract(session)) return { writes: [], patch: {} }
  if (storedDate(session.date) !== target.date) {
    const sameDay = await transaction.get(db.collection('sessions').where('studentId', '==', session.studentId).where('date', '==', target.date).limit(201))
    if (sameDay.size > 200) fail('SESSION_DUPLICATE_DAILY_CHARGE', 'Cần đối soát lịch trùng trước khi chuyển buổi đã tính.')
    if (sameDay.docs.some(row => row.id !== sessionId && sessionCountsTowardContract(row.data()) && row.data().attendanceStatus !== 'policy_charge')) {
      fail('SESSION_DUPLICATE_DAILY_CHARGE', 'Học viên đã có buổi được tính trong ngày đích; không thể gộp hai buổi đã tính vào cùng ngày.')
    }
  }
  const plan = await teachingRecognitionPlan({ transaction, db, session: { id: sessionId, data: session, item: {} },
    attendance, attendanceEventId, target: { ...session, ...target, attendanceStatus: attendance.attendanceStatus || session.attendanceStatus || 'pending' }, actorUid, reason })
  assertCancellationEvidenceChange({ contract: plan.contract, sourceDate: storedDate(session.date), targetDate: target.date, changed: true })
  return { writes: plan.writes, patch: { ...plan.recognitionPatch,
    revenueRecognitionEntryId: plan.entryId, revenueRecognitionJournalId: plan.journalId,
    recognitionReviewRequired: plan.reviewRequired, recognitionReviewIssueCode: plan.issueCode || null,
    revenueRecognitionState: plan.reviewRequired ? 'review_required' : plan.entryId ? 'posted' : 'not_applicable' } }
}

const occupies = (session) => ['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'].includes(session.status) || sessionCountsTowardContract(session)
const sessionHour = (session, id) => Number.isInteger(session.hour) ? session.hour : Number(/^(?:T[2-7]|CN)-(\d{1,2})-/.exec(id)?.[1] ?? -1)
const sameEntry = (entry, studentId, trainerId) => entry.type !== 'off' && entry.studentId === studentId && entry.trainerId === trainerId
const fail = (code, message) => { throw new HttpsError('failed-precondition', message, { issueCode: code, errors: [code] }) }
const deterministicAdminSessionId = (week, branchId, slotId, studentId) => {
  const digest = createHash('sha256').update(`schedule_${week}|${branchId}|${slotId}|${studentId}`).digest('hex').slice(0, 40)
  return `pt_${digest}`
}

// `set(..., { merge: true })` merges nested maps in Firestore. When a draft
// mutation removes the last entry from a slot, leaving that slot out of the
// JavaScript object therefore does not remove `schedule.<slotId>` from the
// document. Replace the top-level schedule field in the same transaction so a
// deleted matrix cell cannot be resurrected by the next workspace read.
function writeScheduleDraft(transaction, reference, snapshot, value) {
  if (snapshot?.exists) transaction.update(reference, value)
  else transaction.set(reference, value)
}

// Removing a pending session does not need the full placement validation
// fan-out below. The workspace already sends the session id and revision, so
// read that document directly and only check the evidence that could make a
// cancellation unsafe. This keeps the common "gỡ buổi" action out of the
// student/branch/availability collection scans.
async function applyFastAdminRemoval({ db, actor, branchId, week, payload, reason, expectedRevision, receipt, safeSchedule, scopedDraftData, draftExpiresAt }) {
  const { studentId, trainerId, slotId, sessionId } = payload
  const sourceDate = dateForSlot(week, slotId.split('-')[0])
  const sourceHour = Number(slotId.split('-')[1])
  const draftRef = db.doc(`ptScheduleDrafts/${branchId}_${week}`)
  const legacyRef = db.doc(`schedules/schedule_${week}`)
  const sessionRef = db.doc(`sessions/${sessionId}`)
  const instant = new Date()

  return db.runTransaction(async (transaction) => {
    const [prior, draftSnapshot, legacy, sessionSnapshot] = await Promise.all([
      transaction.get(receipt),
      transaction.get(draftRef),
      transaction.get(legacyRef),
      transaction.get(sessionRef),
    ])
    if (prior.exists) return prior.data().result

    const draft = scopedDraftData(draftSnapshot, branchId, week)
    const revision = Number(draft?.revision ?? legacy.data()?.draftRevision ?? 0)
    if (revision !== expectedRevision) throw new HttpsError('aborted', 'Lịch đã thay đổi. Hãy tải lại trước khi xác nhận.', { issueCode: 'REVISION_CONFLICT' })
    if (!sessionSnapshot.exists) fail('SOURCE_SESSION_NOT_FOUND', 'Buổi nguồn không còn tồn tại. Hãy tải lại lịch.')

    const session = sessionSnapshot.data() || {}
    if (session.branchId && !['all', branchId].includes(session.branchId)) throw new HttpsError('permission-denied', 'Buổi tập không thuộc cơ sở đang điều chỉnh.')
    if (session.studentId !== studentId || session.trainerId !== trainerId
      || storedDate(session.date) !== sourceDate
      || sessionHour(session, sessionId) !== sourceHour) {
      fail('SOURCE_SESSION_NOT_FOUND', 'Buổi nguồn đã thay đổi. Hãy tải lại lịch.')
    }
    if (payload.expectedSessionRevision !== undefined
      && payload.expectedSessionRevision !== Number(session.revision || 0)) {
      throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại lịch và xác nhận phiên bản mới.', { issueCode: 'REVISION_CONFLICT' })
    }

    const attendanceRef = db.doc(`attendanceEvents/${session.attendanceEventId || sessionId}`)
    const period = (storedDate(session.date) || sourceDate).slice(0, 7)
    const [attendance, payroll, finance] = await Promise.all([
      transaction.get(attendanceRef),
      transaction.get(db.doc(`payrollRuns/${period}`)),
      transaction.get(db.doc(`financePeriods/${period}`)),
    ])
    if (attendance.exists) throw new HttpsError('failed-precondition', 'Buổi đã điểm danh hoặc đã tính buổi; không xóa trực tiếp. Hãy dùng điều chỉnh ca hoặc bù trừ để giữ nguyên billing.', {
      issueCode: 'TEACHING_SHIFT_STATUS_NOT_EDITABLE',
      sessionId,
    })
    if (sessionCountsTowardContract(session)
      || ['completed', 'attended', 'no_show'].includes(String(session.status || '').toLowerCase())) {
      throw new HttpsError('failed-precondition', 'Buổi đã điểm danh hoặc đã tính buổi; không xóa trực tiếp. Hãy dùng điều chỉnh ca hoặc bù trừ để giữ nguyên billing.', {
        issueCode: 'TEACHING_SHIFT_STATUS_NOT_EDITABLE',
        sessionId,
      })
    }
    if (payroll.exists && payroll.data().status !== 'draft') throw new HttpsError('failed-precondition', 'Kỳ lương đã chốt; cần bù trừ, không sửa chứng từ ca gốc.', { issueCode: 'PAYROLL_RUN_IMMUTABLE' })
    if (finance.exists && finance.data().status === 'locked') throw new HttpsError('failed-precondition', 'Kỳ tài chính đã khóa; cần điều chỉnh tại kỳ mở.', { issueCode: 'FINANCE_PERIOD_LOCKED' })

    const schedule = safeSchedule(draft ? draft.schedule : (legacy.data()?.schedule || {}))
    const nextSchedule = { ...schedule }
    nextSchedule[slotId] = (nextSchedule[slotId] || []).filter((entry) => !sameEntry(entry, studentId, trainerId))
    if (!nextSchedule[slotId].length) delete nextSchedule[slotId]
    const nextRevision = revision + 1
    const warnings = []
    const before = {
      date: storedDate(session.date) || sourceDate,
      hour: sessionHour(session, sessionId),
      trainerId: session.trainerId,
      branchId,
      status: session.status || '',
      billingStatus: session.billingStatus || '',
      attendanceStatus: session.attendanceStatus || '',
    }
    const result = {
      draftRevision: nextRevision,
      schedule: nextSchedule,
      weeklySessionTargets: draft?.weeklySessionTargets || {},
      adminEdit: true,
      sessionChanged: true,
      sessionId,
      sessionRevision: Number(session.revision || 0) + 1,
      warnings,
    }
    transaction.update(sessionRef, {
      status: 'cancelled',
      scheduleStatus: 'cancelled',
      billingStatus: 'exempt',
      attendanceStatus: null,
      cancellationReason: reason,
      cancelledAt: FieldValue.serverTimestamp(),
      previousSchedule: FieldValue.arrayUnion({ ...before, changedAt: instant.toISOString(), reason }),
      revision: Number(session.revision || 0) + 1,
      correctedBy: actor.uid,
      correctedAt: FieldValue.serverTimestamp(),
      correctionReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    })
    if (payroll.exists) transaction.update(db.doc(`payrollRuns/${period}`), {
      requiresRebuild: true,
      sourceDataStale: true,
      sourceDataChangedBy: actor.uid,
      sourceDataChangedAt: FieldValue.serverTimestamp(),
      sourceDataChangeReason: reason,
    })
    transaction.create(db.collection('sessionEvents').doc(), {
      schemaVersion: 2,
      sessionId,
      type: 'admin_schedule_cancelled',
      from: before,
      to: { status: 'cancelled', billingStatus: 'exempt' },
      reason,
      warnings,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actor.uid,
    })
    writeScheduleDraft(transaction, draftRef, draftSnapshot, {
      schemaVersion: 2,
      branchId,
      weekId: week,
      schedule: nextSchedule,
      revision: nextRevision,
      status: 'published',
      publishedRevision: nextRevision,
      weeklySessionTargets: draft?.weeklySessionTargets || {},
      unassignedEntries: draft?.unassignedEntries || [],
      optimizationSummary: FieldValue.delete(),
      expiresAt: draftExpiresAt(week),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    })
    if (legacy.exists) {
      const legacySchedule = { ...(legacy.data()?.schedule || {}) }
      legacySchedule[slotId] = (legacySchedule[slotId] || []).filter((entry) => !sameEntry(entry, studentId, trainerId))
      if (!legacySchedule[slotId].length) delete legacySchedule[slotId]
      transaction.update(legacyRef, {
        schedule: legacySchedule,
        draftRevision: Number(legacy.data()?.draftRevision || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      })
    }
    transaction.create(receipt, { actorUid: actor.uid, branchId, weekId: week, command: 'remove_student', result, createdAt: FieldValue.serverTimestamp() })
    transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
      schemaVersion: 2,
      action: 'pt_schedule.admin_remove_student',
      actorUid: actor.uid,
      branchId,
      weekId: week,
      studentId,
      sessionId,
      previousDraftRevision: revision,
      nextDraftRevision: nextRevision,
      from: before,
      to: { status: 'cancelled', billingStatus: 'exempt' },
      reason,
      warnings,
      createdAt: FieldValue.serverTimestamp(),
    })
    return result
  })
}

// Adding a learner to a published matrix is the other hot path. Availability,
// leave, capacity and quota checks are useful diagnostics during optimization,
// but an Admin has already chosen the exact cell and is allowed to record those
// conflicts as an audit warning. Read only the documents needed to make the
// live write safe: auth is checked by the caller, the branch/PT/learner must be
// active, the draft revision must still match, and the exact target session
// must not already be live. The full evidence path remains available to staff
// and to historical corrections.
async function applyFastAdminAdd({ db, actor, branchId, week, payload, reason, expectedRevision, receipt, safeSchedule, scopedDraftData, draftExpiresAt }) {
  const { studentId, trainerId, slotId } = payload
  const targetDate = dateForSlot(week, slotId.split('-')[0])
  const targetHour = Number(slotId.split('-')[1])
  const draftRef = db.doc(`ptScheduleDrafts/${branchId}_${week}`)
  const legacyRef = db.doc(`schedules/schedule_${week}`)
  const baseTargetSessionId = deterministicAdminSessionId(week, branchId, slotId, studentId)
  let targetSessionId = baseTargetSessionId
  let targetSessionReference = db.doc(`sessions/${targetSessionId}`)
  const instant = new Date()

  return db.runTransaction(async (transaction) => {
    const contractReference = typeof payload.contractId === 'string' && payload.contractId.trim()
      ? db.doc(`contracts/${payload.contractId.trim()}`)
      : null
    const [prior, draftSnapshot, legacy, branchSnapshot, studentSnapshot, trainerSnapshot, targetSessionSnapshot, contractSnapshot, contractQuerySnapshot] = await Promise.all([
      transaction.get(receipt),
      transaction.get(draftRef),
      transaction.get(legacyRef),
      transaction.get(db.doc(`branches/${branchId}`)),
      transaction.get(db.doc(`students/${studentId}`)),
      transaction.get(db.doc(`trainers/${trainerId}`)),
      transaction.get(targetSessionReference),
      contractReference ? transaction.get(contractReference) : Promise.resolve(null),
      contractReference ? Promise.resolve(null) : transaction.get(db.collection('contracts').where('studentId', '==', studentId).limit(101)),
    ])
    if (prior.exists) return prior.data().result
    if (!branchSnapshot.exists || branchSnapshot.data()?.status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
    const student = studentSnapshot.data() || {}
    const trainer = trainerSnapshot.data() || {}
    if (!studentSnapshot.exists || ['inactive', 'archived', 'deleted'].includes(String(student.status || '').toLowerCase())) fail('STUDENT_NOT_ACTIVE', 'Hồ sơ học viên không còn hợp lệ.')
    if (!trainerSnapshot.exists || trainer.branchId !== branchId || ['inactive', 'archived', 'deleted'].includes(String(trainer.status || '').toLowerCase())) fail('TRAINER_NOT_ACTIVE', 'PT đích không còn hoạt động tại cơ sở này.')

    const draft = scopedDraftData(draftSnapshot, branchId, week)
    const revision = Number(draft?.revision ?? legacy.data()?.draftRevision ?? 0)
    if (revision !== expectedRevision) throw new HttpsError('aborted', 'Lịch đã thay đổi. Hãy tải lại trước khi xác nhận.', { issueCode: 'REVISION_CONFLICT' })
    const schedule = safeSchedule(draft ? draft.schedule : (legacy.data()?.schedule || {}))
    const targetEntries = (schedule[slotId] || []).filter((entry) => entry.type !== 'off')
    if (targetEntries.some((entry) => entry.studentId === studentId)) fail('DUPLICATE_SCHEDULE_ENTRY', 'Học viên đã có trong ô lịch này.')
    if (targetSessionSnapshot.exists && occupies(targetSessionSnapshot.data() || {})) fail('DUPLICATE_DEPLOYED_SESSION', 'Ô lịch này đã có session thật. Hãy tải lại lịch.')

    let reintroducedFromSessionId = ''
    let reintroducedAtRevision = 0
    if (targetSessionSnapshot.exists) {
      reintroducedFromSessionId = targetSessionSnapshot.id
      reintroducedAtRevision = revision + 1
      let ordinal = 1
      while (ordinal <= 20) {
        const candidateId = reintroducedSessionId(baseTargetSessionId, reintroducedAtRevision, ordinal)
        const candidateReference = db.doc(`sessions/${candidateId}`)
        const candidateSnapshot = await transaction.get(candidateReference)
        if (!candidateSnapshot.exists) {
          targetSessionId = candidateId
          targetSessionReference = candidateReference
          break
        }
        if (occupies(candidateSnapshot.data() || {})) fail('DUPLICATE_DEPLOYED_SESSION', 'Ô lịch này đã có session thật. Hãy tải lại lịch.')
        ordinal += 1
      }
      if (targetSessionId === baseTargetSessionId) throw new HttpsError('resource-exhausted', 'Không tạo được mã buổi mới cho ô lịch đã hủy.')
    }

    let contractRows = contractSnapshot?.exists
      ? [{ id: contractSnapshot.id, ...contractSnapshot.data() }]
      : (contractQuerySnapshot?.docs || []).map((item) => ({ id: item.id, ...item.data() }))
    if (contractRows.length > 100) throw new HttpsError('resource-exhausted', 'Quá nhiều hợp đồng để kiểm tra an toàn.')
    // A stale picker may still carry the previous contract after a renewal.
    if (contractReference && !contractRows.some(contract => contract.studentId === studentId && contractSchedulableOn(contract, targetDate))) {
      const currentContracts = await transaction.get(db.collection('contracts').where('studentId', '==', studentId).limit(101))
      if (currentContracts.size > 100) throw new HttpsError('resource-exhausted', 'Quá nhiều hợp đồng để kiểm tra an toàn.')
      contractRows = currentContracts.docs.map(item => ({ id: item.id, ...item.data() }))
    }
    // A manual add/reintroduction must never inherit a terminal contract.
    // The old rule picked the latest end date, which let a cancelled renewal
    // win over the active contract when the cancelled row ended one day later.
    // Resolve by the target date first, then prefer the newest overlapping
    // contract start so renewal chains remain deterministic.
    requireCrossBranchConfirmation(student, branchId, payload)
    const selectedContract = requireScheduleContract(contractRows, studentId, targetDate, payload.contractId, payload.confirmStudentOff === true)
    const warnings = contractPausedOn(selectedContract, targetDate) ? ['CONTRACT_PAUSED'] : []
    if (reintroducedFromSessionId) warnings.push('CANCELLED_SESSION_REINTRODUCED')
    if (student.branchId && student.branchId !== branchId) warnings.push('STUDENT_BRANCH_MISMATCH')
    const nextEntry = {
      studentId,
      trainerId,
      branchId,
      contractId: selectedContract?.id || '',
      type: 'training',
      source: 'manual_v2',
      adminOverride: true,
      adminOverrideBy: actor.uid,
      adminOverrideAt: instant.toISOString(),
      adminOverrideWarnings: warnings,
      ...(contractPausedOn(selectedContract, targetDate) ? { studentOffConfirmedDate: targetDate } : {}),
      ...(student.branchId && student.branchId !== branchId ? { studentBranchWarning: true, studentHomeBranchId: student.branchId } : {}),
      ...(reintroducedFromSessionId ? { reintroducedFromSessionId, reintroducedAtRevision } : {}),
    }
    const nextSchedule = { ...schedule, [slotId]: [...(schedule[slotId] || []), nextEntry] }
    const nextRevision = revision + 1
    const result = {
      draftRevision: nextRevision,
      schedule: nextSchedule,
      weeklySessionTargets: draft?.weeklySessionTargets || {},
      adminEdit: true,
      sessionChanged: true,
      sessionId: targetSessionId,
      sessionRevision: 0,
      warnings,
    }
    const after = { date: targetDate, hour: targetHour, trainerId, branchId }

    transaction.create(targetSessionReference, {
      schemaVersion: 2,
      scheduleEntryId: `schedule_${week}-${slotId}-${studentId}`,
      scheduleWeekId: week,
      slotId,
      studentId,
      accountUid: student.accountUid || student.uid || null,
      trainerId,
      contractId: selectedContract?.id || '',
      branchId,
      date: targetDate,
      hour: targetHour,
      status: 'scheduled',
      scheduleStatus: 'scheduled',
      billingStatus: 'pending',
      attendanceStatus: 'pending',
      source: 'admin_manual',
      adminOverride: true,
      adminOverrideBy: actor.uid,
      adminOverrideAt: instant.toISOString(),
      adminOverrideWarnings: warnings,
      ...(contractPausedOn(selectedContract, targetDate) ? { studentOffConfirmedDate: targetDate } : {}),
      ...(nextEntry.studentBranchWarning ? { studentBranchWarning: true, studentHomeBranchId: nextEntry.studentHomeBranchId } : {}),
      ...(reintroducedFromSessionId ? { reintroducedFromSessionId, reintroducedAtRevision } : {}),
      revision: 0,
      verifiedByStudent: false,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    })
    transaction.create(db.collection('sessionEvents').doc(), {
      schemaVersion: 2,
      sessionId: targetSessionId,
      type: 'admin_schedule_added',
      from: null,
      to: after,
      reason: reason || 'Admin xếp buổi trực tiếp trên ma trận',
      warnings,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actor.uid,
    })
    writeScheduleDraft(transaction, draftRef, draftSnapshot, {
      schemaVersion: 2,
      branchId,
      weekId: week,
      schedule: nextSchedule,
      revision: nextRevision,
      status: 'published',
      publishedRevision: nextRevision,
      weeklySessionTargets: draft?.weeklySessionTargets || {},
      unassignedEntries: draft?.unassignedEntries || [],
      optimizationSummary: FieldValue.delete(),
      expiresAt: draftExpiresAt(week),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    })
    if (legacy.exists) {
      const legacySchedule = { ...(legacy.data()?.schedule || {}) }
      legacySchedule[slotId] = [...(legacySchedule[slotId] || []), nextEntry]
      transaction.update(legacyRef, {
        schedule: legacySchedule,
        draftRevision: Number(legacy.data()?.draftRevision || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      })
    }
    transaction.create(receipt, { actorUid: actor.uid, branchId, weekId: week, command: 'add_student', result, createdAt: FieldValue.serverTimestamp() })
    transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
      schemaVersion: 2,
      action: 'pt_schedule.admin_add_student',
      actorUid: actor.uid,
      branchId,
      weekId: week,
      studentId,
      sessionId: targetSessionId,
      ...(reintroducedFromSessionId ? { reintroducedFromSessionId, reintroducedAtRevision } : {}),
      previousDraftRevision: revision,
      nextDraftRevision: nextRevision,
      from: null,
      to: after,
      reason,
      warnings,
      createdAt: FieldValue.serverTimestamp(),
    })
    return result
  })
}

// Published moves carry the source session reference from the workspace. Use
// that reference instead of scanning every session for the learner and branch;
// only attendance/payroll/finance evidence that can make the move unsafe is
// rechecked inside the transaction.
async function applyFastAdminMove({ db, actor, branchId, week, payload, reason, expectedRevision, receipt, safeSchedule, scopedDraftData, draftExpiresAt }) {
  const { studentId, trainerId, slotId, fromTrainerId, fromSlotId, sessionId } = payload
  const sourceDate = dateForSlot(week, fromSlotId.split('-')[0])
  const sourceHour = Number(fromSlotId.split('-')[1])
  const targetDate = dateForSlot(week, slotId.split('-')[0])
  const targetHour = Number(slotId.split('-')[1])
  const draftRef = db.doc(`ptScheduleDrafts/${branchId}_${week}`)
  const legacyRef = db.doc(`schedules/schedule_${week}`)
  const sourceRef = db.doc(`sessions/${sessionId}`)
  const targetRef = db.doc(`sessions/${deterministicAdminSessionId(week, branchId, slotId, studentId)}`)
  const targetInstant = new Date(`${targetDate}T${String(targetHour).padStart(2, '0')}:00:00+07:00`)
  const instant = new Date()

  return db.runTransaction(async (transaction) => {
    const [prior, draftSnapshot, legacy, branchSnapshot, studentSnapshot, trainerSnapshot, sourceSnapshot, targetSnapshot, contracts] = await Promise.all([
      transaction.get(receipt),
      transaction.get(draftRef),
      transaction.get(legacyRef),
      transaction.get(db.doc(`branches/${branchId}`)),
      transaction.get(db.doc(`students/${studentId}`)),
      transaction.get(db.doc(`trainers/${trainerId}`)),
      transaction.get(sourceRef),
      transaction.get(targetRef),
      transaction.get(db.collection('contracts').where('studentId', '==', studentId).limit(101)),
    ])
    if (prior.exists) return prior.data().result
    if (!branchSnapshot.exists || branchSnapshot.data()?.status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
    const student = studentSnapshot.data() || {}
    const trainer = trainerSnapshot.data() || {}
    if (!studentSnapshot.exists || ['inactive', 'archived', 'deleted'].includes(String(student.status || '').toLowerCase())) fail('STUDENT_NOT_ACTIVE', 'Hồ sơ học viên không còn hợp lệ.')
    if (!trainerSnapshot.exists || trainer.branchId !== branchId || ['inactive', 'archived', 'deleted'].includes(String(trainer.status || '').toLowerCase())) fail('TRAINER_NOT_ACTIVE', 'PT đích không còn hoạt động tại cơ sở này.')
    if (!sourceSnapshot.exists) fail('SOURCE_SESSION_NOT_FOUND', 'Buổi nguồn không còn tồn tại. Hãy tải lại lịch.')
    const session = sourceSnapshot.data() || {}
    if (contracts.size > 100) throw new HttpsError('resource-exhausted', 'Quá nhiều hợp đồng để kiểm tra an toàn.')
    requireCrossBranchConfirmation(student, branchId, payload)
    const selectedContract = requireScheduleContract(contracts.docs.map(item => ({ id: item.id, ...item.data() })), studentId, targetDate, session.contractId, payload.confirmStudentOff === true)
    if (sessionCountsTowardContract(session) && selectedContract.id !== session.contractId) fail('CHARGED_CONTRACT_IMMUTABLE', 'Buổi đã tính không thể chuyển sang hợp đồng khác.')
    if (session.studentId !== studentId || session.trainerId !== fromTrainerId
      || storedDate(session.date) !== sourceDate || sessionHour(session, sessionId) !== sourceHour) {
      fail('SOURCE_SESSION_NOT_FOUND', 'Buổi nguồn đã thay đổi. Hãy tải lại lịch.')
    }
    if (session.branchId && !['all', branchId].includes(session.branchId)) throw new HttpsError('permission-denied', 'Buổi tập không thuộc cơ sở đang điều chỉnh.')
    if (payload.expectedSessionRevision !== undefined && payload.expectedSessionRevision !== Number(session.revision || 0)) {
      throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại lịch và xác nhận phiên bản mới.', { issueCode: 'REVISION_CONFLICT' })
    }
    const draft = scopedDraftData(draftSnapshot, branchId, week)
    const revision = Number(draft?.revision ?? legacy.data()?.draftRevision ?? 0)
    if (revision !== expectedRevision) throw new HttpsError('aborted', 'Lịch đã thay đổi. Hãy tải lại trước khi xác nhận.', { issueCode: 'REVISION_CONFLICT' })
    if (fromSlotId === slotId && fromTrainerId === trainerId) throw new HttpsError('invalid-argument', 'Ca đích trùng ca nguồn.')
    if (targetSnapshot.exists && occupies(targetSnapshot.data() || {})) fail('DUPLICATE_DEPLOYED_SESSION', 'Ca đích đã có session thật. Hãy tải lại lịch.')

    const attendanceRef = db.doc(`attendanceEvents/${session.attendanceEventId || sessionId}`)
    const sourcePeriod = sourceDate.slice(0, 7)
    const targetPeriod = targetDate.slice(0, 7)
    const periodIds = [...new Set([sourcePeriod, targetPeriod])]
    const [attendance, payroll, finance] = await Promise.all([
      transaction.get(attendanceRef),
      Promise.all(periodIds.map((period) => transaction.get(db.doc(`payrollRuns/${period}`)))),
      Promise.all(periodIds.map((period) => transaction.get(db.doc(`financePeriods/${period}`)))),
    ])
    if (finance.some((item) => item.exists && item.data().status === 'locked')) fail('FINANCE_PERIOD_LOCKED', 'Kỳ tài chính đã khóa; cần điều chỉnh tại kỳ mở.')
    if (payroll.some((item) => item.exists && item.data().status !== 'draft')) fail('PAYROLL_RUN_IMMUTABLE', 'Kỳ lương đã chốt; cần bù trừ, không sửa chứng từ ca gốc.')
    if (attendance.exists && targetInstant > instant) fail('TEACHING_SHIFT_FUTURE_ATTENDANCE', 'Buổi đã điểm danh không thể chuyển sang tương lai.')
    if (sessionCountsTowardContract(session) && targetInstant > instant) fail('TEACHING_SHIFT_FUTURE_ATTENDANCE', 'Buổi đã tính buổi không thể chuyển sang tương lai.')
    if (sessionCountsTowardContract(session) && sourcePeriod !== targetPeriod) fail('TEACHING_SHIFT_CROSS_PERIOD_CORRECTION', 'Buổi đã tính không thể chuyển sang tháng khác; cần dùng bù trừ.')

    const schedule = safeSchedule(draft ? draft.schedule : (legacy.data()?.schedule || {}))
    const targetEntries = (schedule[slotId] || []).filter((entry) => entry.type !== 'off')
    if (targetEntries.some((entry) => entry.studentId === studentId)) fail('DUPLICATE_SCHEDULE_ENTRY', 'Học viên đã có trong ca đích.')
    const warnings = contractPausedOn(selectedContract, targetDate) ? ['CONTRACT_PAUSED'] : []
    if (student.branchId && student.branchId !== branchId) warnings.push('STUDENT_BRANCH_MISMATCH')
    const nextEntry = {
      studentId,
      trainerId,
      branchId,
      contractId: selectedContract.id,
      type: 'training',
      source: 'manual_v2',
      adminOverride: true,
      adminOverrideBy: actor.uid,
      adminOverrideAt: instant.toISOString(),
      adminOverrideWarnings: warnings,
      ...(contractPausedOn(selectedContract, targetDate) ? { studentOffConfirmedDate: targetDate } : {}),
      ...(student.branchId && student.branchId !== branchId ? { studentBranchWarning: true, studentHomeBranchId: student.branchId } : {}),
    }
    const nextSchedule = { ...schedule }
    nextSchedule[fromSlotId] = (nextSchedule[fromSlotId] || []).filter((entry) => !sameEntry(entry, studentId, fromTrainerId))
    if (!nextSchedule[fromSlotId].length) delete nextSchedule[fromSlotId]
    nextSchedule[slotId] = [...(nextSchedule[slotId] || []), nextEntry]
    const nextRevision = revision + 1
    const result = {
      draftRevision: nextRevision,
      schedule: nextSchedule,
      weeklySessionTargets: draft?.weeklySessionTargets || {},
      adminEdit: true,
      sessionChanged: true,
      sessionId,
      sessionRevision: Number(session.revision || 0) + 1,
      warnings,
    }
    const before = { date: sourceDate, hour: sourceHour, trainerId: fromTrainerId, branchId, status: session.status || '', billingStatus: session.billingStatus || '', attendanceStatus: session.attendanceStatus || '' }
    const after = { date: targetDate, hour: targetHour, trainerId, branchId }
    const revenue = await moveRevenuePlan({ transaction, db, sessionId, session, attendance: attendance.data() || {},
      attendanceEventId: attendanceRef.id, target: after, actorUid: actor.uid, reason })
    for (const write of revenue.writes) transaction[write.type](write.reference, write.data)
    transaction.update(sourceRef, {
      ...revenue.patch,
      ...nextEntry,
      studentOffConfirmedDate: nextEntry.studentOffConfirmedDate || FieldValue.delete(),
      date: targetDate,
      hour: targetHour,
      slotId,
      scheduleWeekId: week,
      scheduleEntryId: `schedule_${week}-${slotId}-${studentId}`,
      scheduleStatus: 'rescheduled',
      previousSchedule: FieldValue.arrayUnion({ ...before, changedAt: instant.toISOString(), reason }),
      revision: Number(session.revision || 0) + 1,
      correctedBy: actor.uid,
      correctedAt: FieldValue.serverTimestamp(),
      correctionReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    })
    if (attendance.exists) transaction.update(attendanceRef, {
      ...revenue.patch,
      trainerId,
      branchId,
      scheduledAt: Timestamp.fromDate(targetInstant),
      occurredAt: Timestamp.fromDate(targetInstant),
      scheduleStatus: 'rescheduled',
      correctionReason: reason,
      correctedBy: actor.uid,
      correctedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    for (const item of payroll) if (item.exists) transaction.update(db.doc(`payrollRuns/${item.id}`), {
      requiresRebuild: true,
      sourceDataStale: true,
      sourceDataChangedBy: actor.uid,
      sourceDataChangedAt: FieldValue.serverTimestamp(),
      sourceDataChangeReason: reason,
    })
    transaction.create(db.collection('sessionEvents').doc(), { schemaVersion: 2, sessionId, type: 'teaching_shift_corrected', from: before, to: after, reason, warnings, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
    writeScheduleDraft(transaction, draftRef, draftSnapshot, {
      schemaVersion: 2,
      branchId,
      weekId: week,
      schedule: nextSchedule,
      revision: nextRevision,
      status: 'published',
      publishedRevision: nextRevision,
      weeklySessionTargets: draft?.weeklySessionTargets || {},
      unassignedEntries: draft?.unassignedEntries || [],
      optimizationSummary: FieldValue.delete(),
      expiresAt: draftExpiresAt(week),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    })
    if (legacy.exists) {
      const legacySchedule = { ...(legacy.data()?.schedule || {}) }
      legacySchedule[fromSlotId] = (legacySchedule[fromSlotId] || []).filter((entry) => !sameEntry(entry, studentId, fromTrainerId))
      if (!legacySchedule[fromSlotId].length) delete legacySchedule[fromSlotId]
      legacySchedule[slotId] = [...(legacySchedule[slotId] || []), nextEntry]
      transaction.update(legacyRef, { schedule: legacySchedule, draftRevision: Number(legacy.data()?.draftRevision || 0) + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
    }
    transaction.create(receipt, { actorUid: actor.uid, branchId, weekId: week, command: 'move_student', result, createdAt: FieldValue.serverTimestamp() })
    transaction.create(db.collection('ptOperationsAuditLogs').doc(), { schemaVersion: 2, action: 'pt_schedule.admin_move_student', actorUid: actor.uid, branchId, weekId: week, studentId, sessionId, previousDraftRevision: revision, nextDraftRevision: nextRevision, from: before, to: after, reason, warnings, createdAt: FieldValue.serverTimestamp() })
    return result
  })
}

// Explicit Admin edits reconcile the operational schedule and real session in
// ONE transaction. They are not an optimizer override and never hard-delete
// attendance/accounting evidence. Ordinary staff draft commands stay separate.
async function applyAdminScheduleEdit({ db, actor, branchId, week, command, payload, reason, expectedRevision, receipt, safeSchedule, scopedDraftData, draftExpiresAt }) {
  if (!['admin', 'super_admin'].includes(actor.accessRole)) throw new HttpsError('permission-denied', 'Chỉ Admin được xác nhận điều chỉnh ca đã khóa hoặc đã ghi nhận.')
  if (!['add_student', 'move_student', 'remove_student'].includes(command)) throw new HttpsError('invalid-argument', 'Lệnh điều chỉnh Admin không hợp lệ.')
  const adminManualOverride = true
  reason = typeof reason === 'string' ? reason.trim().slice(0, 300) : ''
  // Matrix corrections are intentionally quick. Keep an audit reason, but
  // use a safe default when Admin moves or removes a row without typing one.
  if (!reason) reason = command === 'remove_student' ? 'Admin gỡ buổi trực tiếp trên ma trận' : 'Admin điều chỉnh buổi trực tiếp trên ma trận'
  const { studentId, trainerId, slotId } = payload
  if (command === 'remove_student' && typeof payload.sessionId === 'string' && payload.sessionId) {
    return applyFastAdminRemoval({
      db,
      actor,
      branchId,
      week,
      payload,
      reason,
      expectedRevision,
      receipt,
      safeSchedule,
      scopedDraftData,
      draftExpiresAt,
    })
  }
  if (command === 'add_student' && payload.adminOverride === true) {
    return applyFastAdminAdd({
      db,
      actor,
      branchId,
      week,
      payload,
      reason,
      expectedRevision,
      receipt,
      safeSchedule,
      scopedDraftData,
      draftExpiresAt,
    })
  }
  if (command === 'move_student' && payload.adminOverride === true && typeof payload.sessionId === 'string' && payload.sessionId) {
    return applyFastAdminMove({
      db,
      actor,
      branchId,
      week,
      payload,
      reason,
      expectedRevision,
      receipt,
      safeSchedule,
      scopedDraftData,
      draftExpiresAt,
    })
  }
  const sourceTrainerId = command === 'move_student' ? payload.fromTrainerId : trainerId
  const sourceSlot = command === 'move_student' ? payload.fromSlotId : slotId
  const sourceDate = dateForSlot(week, sourceSlot.split('-')[0])
  const sourceHour = Number(sourceSlot.split('-')[1])
  const targetDate = dateForSlot(week, slotId.split('-')[0])
  const targetHour = Number(slotId.split('-')[1])
  if (command === 'move_student' && sourceSlot === slotId && sourceTrainerId === trainerId) throw new HttpsError('invalid-argument', 'Ca đích trùng ca nguồn.')
  const baseTargetSessionId = deterministicAdminSessionId(week, branchId, slotId, studentId)
  let targetSessionId = baseTargetSessionId
  let targetSessionReference = ['add_student', 'move_student'].includes(command) ? db.doc(`sessions/${targetSessionId}`) : null
  const draftRef = db.doc(`ptScheduleDrafts/${branchId}_${week}`)
  const legacyRef = db.doc(`schedules/schedule_${week}`)
  const instant = new Date()
  const targetInstant = new Date(`${targetDate}T${String(targetHour).padStart(2, '0')}:00:00+07:00`)

  return db.runTransaction(async (transaction) => {
    const [prior, draftSnapshot, legacy, studentSnapshot, trainers, trainerWeek, learnerWeek, configSnapshot, studentSessions, branchSessions, contracts, leaves, targetSessionSnapshot] = await Promise.all([
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
      targetSessionReference ? transaction.get(targetSessionReference) : Promise.resolve(null),
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
    const source = sourceMatches[0]
    const session = source?.data()
    const createsTargetSession = command === 'add_student' || (command === 'move_student' && !session)
    let reintroducedFromSessionId = ''
    let reintroducedAtRevision = 0
    if (command === 'add_student') {
      if (entries.length) fail('DUPLICATE_SCHEDULE_ENTRY', 'Học viên đã có trong ca này.')
      if (sourceMatches.length) fail('DUPLICATE_DEPLOYED_SESSION', 'Ca này đã có session thật. Hãy tải lại trước khi xếp thêm.')
    }
    if (entries.length > 1 || sourceMatches.length > 1) fail('DUPLICATE_DEPLOYED_SESSION', 'Ca nguồn bị trùng. Cần đối soát trước khi điều chỉnh.')
    if (command !== 'add_student' && !entries.length && !sourceMatches.length) fail('SOURCE_SESSION_NOT_FOUND', 'Ca nguồn không còn tồn tại. Hãy tải lại lịch.')
    if (createsTargetSession && targetSessionSnapshot?.exists) {
      const existing = targetSessionSnapshot.data() || {}
      if (occupies(existing)) fail('DUPLICATE_DEPLOYED_SESSION', 'Ca đích đã có session thật. Hãy tải lại trước khi xếp thêm.')
      // Keep the cancelled document immutable. Admin re-add or move creates a
      // new deterministic session id so the old cancellation remains auditable.
      reintroducedFromSessionId = targetSessionSnapshot.id
      reintroducedAtRevision = revision + 1
      let ordinal = 1
      while (ordinal <= 20) {
        const candidateId = reintroducedSessionId(baseTargetSessionId, reintroducedAtRevision, ordinal)
        const candidateReference = db.doc(`sessions/${candidateId}`)
        const candidateSnapshot = await transaction.get(candidateReference)
        if (!candidateSnapshot.exists) {
          targetSessionId = candidateId
          targetSessionReference = candidateReference
          break
        }
        if (occupies(candidateSnapshot.data() || {})) fail('DUPLICATE_DEPLOYED_SESSION', 'Ca đích đã có session thật. Hãy tải lại trước khi xếp thêm.')
        ordinal += 1
      }
      if (targetSessionId === baseTargetSessionId) throw new HttpsError('resource-exhausted', 'Không tạo được mã buổi mới cho ca đã hủy.')
    }
    if (session && session.branchId && !['all', branchId].includes(session.branchId)) throw new HttpsError('permission-denied', 'Buổi tập không thuộc cơ sở đang điều chỉnh.')
    if (session && ((payload.sessionId && payload.sessionId !== source.id)
      || (payload.expectedSessionRevision !== undefined
        && payload.expectedSessionRevision !== Number(session.revision || 0)))) {
      throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại lịch và xác nhận phiên bản mới.', { issueCode: 'REVISION_CONFLICT' })
    }
    if (!session && payload.sessionId) fail('SOURCE_SESSION_NOT_FOUND', 'Không tìm thấy buổi đã ghi nhận tương ứng; chưa thay đổi lịch.')
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

    let contractId = session?.contractId || entries[0]?.contractId || ''
    const contractSnapshot = contracts.docs.find((item) => item.id === contractId)
    let contract = contractSnapshot?.data()
    if (command === 'remove_student' && session
      && (attendance?.exists || sessionCountsTowardContract(session)
        || ['completed', 'attended', 'no_show'].includes(String(session.status || '').toLowerCase()))) {
      throw new HttpsError('failed-precondition', 'Buổi đã điểm danh hoặc đã tính buổi; không xóa trực tiếp. Hãy dùng điều chỉnh ca hoặc bù trừ để giữ nguyên billing.', {
        issueCode: 'TEACHING_SHIFT_STATUS_NOT_EDITABLE',
        sessionId: source.id,
      })
    }
    const warnings = []
    if (reintroducedFromSessionId) warnings.push('CANCELLED_SESSION_REINTRODUCED')
    let nextEntry = null
    if (command === 'add_student' || command === 'move_student') {
      requireCrossBranchConfirmation(student, branchId, payload)
      contract = requireScheduleContract(contracts.docs.map(item => ({ id: item.id, ...item.data() })), studentId, targetDate, contractId, payload.confirmStudentOff === true)
      if (contractPausedOn(contract, targetDate)) warnings.push('CONTRACT_PAUSED')
      if (session && sessionCountsTowardContract(session) && contract.id !== session.contractId) fail('CHARGED_CONTRACT_IMMUTABLE', 'Buổi đã tính không thể chuyển sang hợp đồng khác.')
      contractId = contract.id
    }
    if (command === 'move_student') {
      const trainer = trainerProfileForWeek(trainerMap.get(trainerId) || {}, trainerWeek.exists ? trainerWeek.data() : null, week)
      if (!trainerMap.has(trainerId) || ['inactive', 'archived', 'deleted'].includes(trainer.status)) fail('TRAINER_NOT_ACTIVE', 'PT đích không còn hoạt động tại cơ sở này.')
      if (!studentSnapshot.exists || ['archived', 'deleted'].includes(student.status)) fail('STUDENT_NOT_ACTIVE', 'Hồ sơ học viên không còn hợp lệ.')
      if (student.branchId !== branchId) warnings.push('STUDENT_BRANCH_MISMATCH')
      if (!contract || contract.studentId !== studentId || !storedDate(contract.startDate) || !storedDate(contract.endDate)
        || ['cancelled', 'canceled', 'void', 'refunded', 'deleted'].includes(contract.status)
        || storedDate(contract.startDate) > targetDate || storedDate(contract.endDate) < targetDate) warnings.push('ACTIVE_CONTRACT_NOT_FOUND')
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
        ...(contractPausedOn(contract, targetDate) ? { studentOffConfirmedDate: targetDate } : {}),
        ...(entries[0]?.isLocked || session ? { isLocked: true } : {}),
        ...(student.branchId !== branchId ? { studentBranchWarning: true, studentHomeBranchId: student.branchId } : {}),
        ...(warnings.includes('TRAINER_ASSIGNMENT_MISMATCH') ? { trainerAssignmentWarning: true } : {}),
        ...(availabilityReason ? { availabilityOverride: true, availabilityOverrideReason: availabilityReason, availabilityOverrideBy: actor.uid, availabilityOverrideAt: instant.toISOString() } : {}),
        ...(reintroducedFromSessionId ? { reintroducedFromSessionId, reintroducedAtRevision } : {}),
      }
    }
    if (command === 'add_student') {
      const trainer = trainerProfileForWeek(trainerMap.get(trainerId) || {}, trainerWeek.exists ? trainerWeek.data() : null, week)
      if (!trainerMap.has(trainerId) || ['inactive', 'archived', 'deleted'].includes(String(trainer.status || '').toLowerCase())) fail('TRAINER_NOT_ACTIVE', 'PT đích không còn hoạt động tại cơ sở này.')
      if (!studentSnapshot.exists || ['inactive', 'archived', 'deleted'].includes(String(student.status || '').toLowerCase())) fail('STUDENT_NOT_ACTIVE', 'Hồ sơ học viên không còn hợp lệ.')
      const crossBranch = Boolean(student.branchId) && student.branchId !== branchId
      if (crossBranch) {
        requireCrossBranchConfirmation(student, branchId, payload)
        warnings.push('STUDENT_BRANCH_MISMATCH')
      }
      const targetCalendar = normalizedScheduleConfig(configSnapshot.data())
      const [targetDay] = slotId.split('-')
      if (!targetCalendar.workingDays.includes(targetDay) || !targetCalendar.workingHours.includes(targetHour) || targetCalendar.holidays.includes(targetDate)) warnings.push('OUTSIDE_WORKING_CALENDAR')
      if (!trainerIsAvailable(trainer, slotId)) warnings.push('OUTSIDE_TRAINER_AVAILABILITY')
      if (leaves.docs.some((item) => item.data().status === 'approved'
        && storedDate(item.data().startDate) <= targetDate
        && storedDate(item.data().endDate || item.data().startDate) >= targetDate)) warnings.push('TRAINER_ON_LEAVE')

      const studentAvailability = effectiveStudentAvailability({
        targetWeek: week,
        exact: learnerWeek.exists ? learnerWeek.data() : null,
        profile: student,
      })
      const availabilityReason = !studentAvailability.confirmed
        ? 'AVAILABILITY_NOT_SUBMITTED'
        : !studentAvailability.slots.includes(slotId)
          ? 'OUTSIDE_STUDENT_AVAILABILITY'
          : ''
      if (availabilityReason) warnings.push(availabilityReason)

      const expectedContractBranch = crossBranch ? student.branchId : branchId
      const contractRows = contracts.docs.map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => item.studentId === studentId)
        .sort((left, right) => String(right.startDate || '').localeCompare(String(left.startDate || ''))
          || String(right.endDate || '').localeCompare(String(left.endDate || ''))
          || String(left.id || '').localeCompare(String(right.id || '')))
      const schedulableContract = contractRows.find((item) => {
        if (!contractSchedulableOn(item, targetDate) || (item.branchId && item.branchId !== expectedContractBranch)) return false
        const usage = summarizeContractUsage(item, studentSessions.docs.filter((row) => row.data().contractId === item.id).map((row) => ({ id: row.id, ...row.data() })))
        const held = studentSessions.docs.filter((row) => row.data().contractId === item.id
          && ['scheduled', 'rescheduled'].includes(String(row.data().status || '').toLowerCase())
          && row.data().billingStatus !== 'charged').length
        return usage.remainingSessions - held > 0
      })
      // Keep branch and date entitlement even when Admin confirms an OFF
      // exception. Confirmation never revives a terminal or future contract.
      const fallbackContract = findScheduleContract(contractRows.filter((item) =>
        !item.branchId || item.branchId === expectedContractBranch), studentId, targetDate, contractId, payload.confirmStudentOff === true)
      const selectedContract = schedulableContract || fallbackContract
      if (!selectedContract) throw new HttpsError('failed-precondition', 'Không có hợp đồng hợp lệ tại cơ sở của học viên trong ngày tập.', { errors: ['ACTIVE_CONTRACT_NOT_FOUND'] })
      contract = selectedContract || null
      contractId = selectedContract?.id || ''
      if (selectedContract) {
        const usage = summarizeContractUsage(selectedContract, studentSessions.docs.filter((row) => row.data().contractId === selectedContract.id).map((row) => ({ id: row.id, ...row.data() })))
        const held = studentSessions.docs.filter((row) => row.data().contractId === selectedContract.id
          && ['scheduled', 'rescheduled'].includes(String(row.data().status || '').toLowerCase())
          && row.data().billingStatus !== 'charged').length
        if (usage.remainingSessions - held <= 0) warnings.push('CONTRACT_SESSION_QUOTA_EXCEEDED')
      }

      const targetDaySessions = studentSessions.docs.filter((item) => occupies(item.data()) && storedDate(item.data().date) === targetDate)
      if (targetDaySessions.length) warnings.push('STUDENT_MULTIPLE_SESSIONS_PER_DAY')
      const trainerSlotCount = branchSessions.docs.filter((item) => occupies(item.data())
        && item.data().trainerId === trainerId
        && storedDate(item.data().date) === targetDate
        && sessionHour(item.data(), item.id) === targetHour).length
      if (trainerSlotCount >= normalizedCapacity(trainer.slotCapacity)) warnings.push('TRAINER_CAPACITY_EXCEEDED')
      const branchSlotCount = branchSessions.docs.filter((item) => occupies(item.data())
        && storedDate(item.data().date) === targetDate
        && sessionHour(item.data(), item.id) === targetHour
        && (!item.data().branchId || item.data().branchId === branchId)).length
      const branchCapacity = branchSlotCapacity(targetCalendar, branchId, slotId)
      if (branchCapacity !== null && branchSlotCount >= branchCapacity) warnings.push('BRANCH_CAPACITY_REACHED')

      const assignedTrainerIds = [...new Set([contract?.trainerId, ...(Array.isArray(contract?.trainerIds) ? contract.trainerIds : [])].filter(Boolean))]
      if (assignedTrainerIds.length && !assignedTrainerIds.includes(trainerId)) warnings.push('TRAINER_ASSIGNMENT_MISMATCH')
      nextEntry = {
        studentId,
        trainerId,
        branchId,
        contractId,
        type: 'training',
        source: 'manual_v2',
        adminOverride: true,
        adminOverrideBy: actor.uid,
        adminOverrideAt: instant.toISOString(),
        adminOverrideWarnings: [...new Set(warnings)],
        ...(contractPausedOn(contract, targetDate) ? { studentOffConfirmedDate: targetDate } : {}),
        ...(crossBranch ? { studentBranchWarning: true, studentHomeBranchId: student.branchId } : {}),
        ...(assignedTrainerIds.length && !assignedTrainerIds.includes(trainerId) ? { trainerAssignmentWarning: true } : {}),
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
    const legacyData = legacy.data() || {}
    const publishedWorkspace = draft?.status === 'published'
      || Number(draft?.publishedVersion || 0) > 0
      || legacyData.publishStatusByBranch?.[branchId] === 'published'
      || Number(legacyData.publishedVersions?.[branchId] || 0) > 0
    // An Admin edit on a published workspace is the live reconciliation
    // action. A draft-only move creates the missing live session; a draft-only
    // removal simply clears the matrix row and keeps the published state.
    const sessionChanged = Boolean(session)
      || command === 'add_student'
      || (command === 'move_student' && !session)
      || (command === 'remove_student' && publishedWorkspace && !session && entries.length > 0)
    const result = {
      draftRevision: revision + 1,
      schedule: nextSchedule,
      weeklySessionTargets: draft?.weeklySessionTargets || {},
      adminEdit: true,
      sessionChanged,
      ...(sessionChanged ? { sessionId: source?.id || targetSessionId, sessionRevision: session ? Number(session.revision || 0) + 1 : 0 } : {}),
      warnings: [...new Set(warnings)],
    }
    const before = { date: sourceDate, hour: sourceHour, trainerId: sourceTrainerId, branchId, ...(session ? { status: session.status || '', billingStatus: session.billingStatus || '', attendanceStatus: session.attendanceStatus || '' } : {}) }
    const after = nextEntry ? { date: targetDate, hour: targetHour, trainerId, branchId } : { status: 'cancelled', billingStatus: 'exempt' }
    const revenue = session && command === 'move_student'
      ? await moveRevenuePlan({ transaction, db, sessionId: source.id, session, attendance: attendance?.data() || {},
        attendanceEventId: attendanceRef.id, target: after, actorUid: actor.uid, reason })
      : { writes: [], patch: {} }
    for (const write of revenue.writes) transaction[write.type](write.reference, write.data)
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
        studentOffConfirmedDate: nextEntry.studentOffConfirmedDate || FieldValue.delete(),
        studentBranchWarning: nextEntry.studentBranchWarning || FieldValue.delete(),
        studentHomeBranchId: nextEntry.studentHomeBranchId || FieldValue.delete(),
        trainerAssignmentWarning: nextEntry.trainerAssignmentWarning || FieldValue.delete(),
      } : { status: 'cancelled', scheduleStatus: 'cancelled', billingStatus: 'exempt', attendanceStatus: null, cancellationReason: reason, cancelledAt: FieldValue.serverTimestamp() }
      transaction.update(ref, { ...patch, ...revenue.patch, previousSchedule: FieldValue.arrayUnion({ ...before, changedAt: instant.toISOString(), reason }), revision: Number(session.revision || 0) + 1, correctedBy: actor.uid, correctedAt: FieldValue.serverTimestamp(), correctionReason: reason, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      if (attendance?.exists) transaction.update(attendanceRef, {
        ...revenue.patch,
        ...(command === 'move_student' ? { trainerId, branchId, scheduledAt: Timestamp.fromDate(targetInstant), occurredAt: Timestamp.fromDate(targetInstant), scheduleStatus: 'rescheduled' }
          : { type: 'cancelled', scheduleStatus: 'cancelled', billingStatus: 'exempt', attendanceStatus: 'cancelled', countsTowardContract: false }),
        correctionReason: reason, correctedBy: actor.uid, correctedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      })
      if (command === 'remove_student' && sessionCountsTowardContract(session)) {
        const rows = studentSessions.docs.filter((item) => item.data().contractId === contractId).map((item) => ({ id: item.id, ...item.data() }))
        const beforeUsage = summarizeContractUsage(contract, rows)
        const afterRows = rows.map((row) => row.id === source.id
          ? { ...row, status: 'cancelled', scheduleStatus: 'cancelled', billingStatus: 'exempt', attendanceStatus: 'cancelled' }
          : row)
        const afterUsage = summarizeContractUsage(contract, afterRows)
        const removedCanonicalCharge = beforeUsage.canonicalChargedSessionIds.includes(source.id)
        const usedSessions = contract.usageReconciledFrom === 'pt-contract-daily-usage-v1'
          ? afterUsage.chargedSessions
          : Math.max(0, beforeUsage.usedSessions - (removedCanonicalCharge ? 1 : 0))
        const canonicalChargedSessionIds = afterUsage.canonicalChargedSessionIds
        const canonicalSessionIds = new Set(afterUsage.canonicalSessionIds)
        const attendedClasses = (contract.attendedClasses || []).filter((id) => canonicalSessionIds.has(id))
        transaction.update(db.doc(`contracts/${contractId}`), {
          usedSessions,
          chargedSessionIds: canonicalChargedSessionIds,
          attendedClasses,
          usageProjectionUpdatedAt: FieldValue.serverTimestamp(),
          ...(contract.usageReconciliationVersion >= 4 ? { historyEvidenceSessions: afterUsage.chargedSessions, usageReconciliationStatus: usedSessions > Number(contract.totalSessions || 0) ? 'over_entitlement' : 'matched' } : {}),
          ...(contract.usageReconciledFrom === 'pt-contract-daily-usage-v1' ? { usageDeduplicationVersion: 1, usageDedupedSessions: afterUsage.duplicateHistorySessions, usageReconciliationVersion: 5, usageReconciledFrom: 'pt-contract-daily-usage-v1' } : {}),
        })
        transaction.create(db.collection('contractUsageAuditLogs').doc(), { action: 'contract_usage.admin_schedule_removed', sessionId: source.id, contractId, beforeUsed: beforeUsage.usedSessions, afterUsed: usedSessions, duplicateHistorySessions: afterUsage.duplicateHistorySessions, reason, actorUid: actor.uid, createdAt: FieldValue.serverTimestamp() })
      }
      for (const item of payroll) if (item.exists) transaction.update(db.doc(`payrollRuns/${item.id}`), { requiresRebuild: true, sourceDataStale: true, sourceDataChangedBy: actor.uid, sourceDataChangedAt: FieldValue.serverTimestamp(), sourceDataChangeReason: reason })
      transaction.create(db.collection('sessionEvents').doc(), { schemaVersion: 2, sessionId: source.id, type: command === 'move_student' ? 'teaching_shift_corrected' : 'admin_schedule_cancelled', from: before, to: after, reason, warnings, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
    }
    if (command === 'add_student' || (command === 'move_student' && !session)) {
      transaction.create(targetSessionReference, {
        schemaVersion: 2,
        scheduleEntryId: `schedule_${week}-${slotId}-${studentId}`,
        scheduleWeekId: week,
        slotId,
        studentId,
        accountUid: student.accountUid || student.uid || null,
        trainerId,
        contractId,
        branchId,
        date: targetDate,
        hour: targetHour,
        status: 'scheduled',
        scheduleStatus: 'scheduled',
        billingStatus: 'pending',
        attendanceStatus: 'pending',
        source: 'admin_manual',
        adminOverride: true,
        adminOverrideBy: actor.uid,
        adminOverrideAt: instant.toISOString(),
        adminOverrideWarnings: [...new Set(warnings)],
        ...(contractPausedOn(contract, targetDate) ? { studentOffConfirmedDate: targetDate } : {}),
        ...(nextEntry.studentBranchWarning ? { studentBranchWarning: true, studentHomeBranchId: nextEntry.studentHomeBranchId } : {}),
        ...(nextEntry.trainerAssignmentWarning ? { trainerAssignmentWarning: true } : {}),
        ...(nextEntry.availabilityOverride ? { availabilityOverride: true, availabilityOverrideReason: nextEntry.availabilityOverrideReason, availabilityOverrideBy: actor.uid, availabilityOverrideAt: instant.toISOString() } : {}),
        ...(reintroducedFromSessionId ? { reintroducedFromSessionId, reintroducedAtRevision } : {}),
        revision: 0,
        verifiedByStudent: false,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      })
      transaction.create(db.collection('sessionEvents').doc(), {
        schemaVersion: 2,
        sessionId: targetSessionId,
        type: command === 'move_student' ? 'admin_schedule_moved' : 'admin_schedule_added',
        from: null,
        to: after,
        reason: reason || 'Admin xếp buổi trực tiếp trên ma trận',
        warnings,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
    }
    writeScheduleDraft(transaction, draftRef, draftSnapshot, {
      schemaVersion: 2,
      branchId,
      weekId: week,
      schedule: nextSchedule,
      revision: revision + 1,
      status: sessionChanged ? 'published' : 'draft',
      ...(sessionChanged ? { publishedRevision: revision + 1 } : {}),
      weeklySessionTargets: draft?.weeklySessionTargets || {},
      unassignedEntries: draft?.unassignedEntries || [],
      optimizationSummary: FieldValue.delete(),
      expiresAt: draftExpiresAt(week),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    })
    if (legacy.exists) transaction.update(legacyRef, { schedule: reconcile(legacy.data().schedule || {}), draftRevision: Number(legacy.data().draftRevision || 0) + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
    transaction.create(receipt, { actorUid: actor.uid, branchId, weekId: week, command, result, createdAt: FieldValue.serverTimestamp() })
    transaction.create(db.collection('ptOperationsAuditLogs').doc(), { schemaVersion: 2, action: `pt_schedule.admin_${command}`, actorUid: actor.uid, branchId, weekId: week, studentId, sessionId: source?.id || (['add_student', 'move_student'].includes(command) && !session ? targetSessionId : null), ...(reintroducedFromSessionId ? { reintroducedFromSessionId, reintroducedAtRevision } : {}), previousDraftRevision: revision, nextDraftRevision: revision + 1, from: before, to: after, reason, warnings, createdAt: FieldValue.serverTimestamp() })
    return result
  })
}

module.exports = { applyAdminScheduleEdit }
