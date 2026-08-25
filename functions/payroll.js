const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

async function payrollActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'payroll.operations.manage')
  return actor
}

function period(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(result)) throw new HttpsError('invalid-argument', 'Kỳ lương phải có dạng YYYY-MM.')
  return result
}

function periodBounds(periodId) {
  const [year, month] = periodId.split('-').map(Number)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    // Payroll is a Vietnam business period, not a UTC calendar month.
    start: Timestamp.fromDate(new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+07:00`)),
    end: Timestamp.fromDate(new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+07:00`)),
  }
}

function iso(value) {
  return value?.toDate?.().toISOString?.() || ''
}

function payrollEffectiveAt(periodId) {
  const { end } = periodBounds(periodId)
  // The payroll expense belongs to the last instant of its Vietnam business
  // period, rather than the later button-click time.
  return Timestamp.fromMillis(end.toMillis() - 1)
}

function payrollPaymentReference(value) {
  const result = typeof value === 'string' ? value.trim().slice(0, 200) : ''
  if (!result) throw new HttpsError('invalid-argument', 'Cần nhập mã chứng từ hoặc tham chiếu chi lương.')
  return result
}

function payrollCashAccountId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(result)) {
    throw new HttpsError('invalid-argument', 'Tài khoản quỹ chi lương không hợp lệ.')
  }
  return result
}

function policyEffectiveDate(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(result)) {
    throw new HttpsError('invalid-argument', 'Ngày hiệu lực chính sách không hợp lệ.')
  }
  const [year, month, day] = result.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) throw new HttpsError('invalid-argument', 'Ngày hiệu lực chính sách không hợp lệ.')
  const timestamp = Timestamp.fromDate(new Date(`${result}T00:00:00+07:00`))
  if (Number.isNaN(timestamp.toDate().getTime())) throw new HttpsError('invalid-argument', 'Ngày hiệu lực chính sách không hợp lệ.')
  return { value: result, timestamp }
}

function policyRate(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1_000 || result > 10_000_000) {
    throw new HttpsError('invalid-argument', 'Đơn giá buổi tập phải từ 1.000đ đến 10.000.000đ.')
  }
  return result
}

function policyName(value) {
  const result = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 100) : ''
  if (result.length < 2) throw new HttpsError('invalid-argument', 'Tên chính sách lương chưa hợp lệ.')
  return result
}

function boundedInteger(value, label, minimum, maximum, fallback) {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpsError('invalid-argument', `${label} phải từ ${minimum} đến ${maximum}.`)
  }
  return parsed
}

function payrollPolicyConfiguration(value = {}) {
  const ratePerSession = policyRate(value.ratePerSession)
  const dailySessionThreshold = boundedInteger(value.dailySessionThreshold, 'Số ca tiêu chuẩn mỗi ngày', 1, 24, 8)
  const rateAfterDailyThreshold = policyRate(value.rateAfterDailyThreshold ?? ratePerSession)
  const eveningStartHour = boundedInteger(value.eveningStartHour, 'Giờ bắt đầu ca tối', 0, 23, 20)
  const rateAfterDailyThresholdEvening = policyRate(value.rateAfterDailyThresholdEvening ?? rateAfterDailyThreshold)
  return {
    ratePerSession,
    dailySessionThreshold,
    rateAfterDailyThreshold,
    eveningStartHour,
    rateAfterDailyThresholdEvening,
  }
}

function vietnamDateKey(value) {
  if (typeof value === 'string') {
    const candidate = value.trim().slice(0, 10)
    if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(candidate)) return candidate
  }
  const date = value?.toDate?.() || (value instanceof Date ? value : null)
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
  }
  throw new HttpsError('failed-precondition', 'Buổi dạy thiếu ngày hợp lệ để tính lương.')
}

function teachingHour(value, sessionId) {
  const direct = Number(value)
  if (Number.isInteger(direct) && direct >= 0 && direct <= 23) return direct
  const legacy = Number(String(sessionId || '').split('-')[1])
  if (Number.isInteger(legacy) && legacy >= 0 && legacy <= 23) return legacy
  throw new HttpsError('failed-precondition', 'Buổi dạy thiếu giờ hợp lệ để tính lương.')
}

function teachingSlotsFromAttendance(attendanceDocuments, sessionsById, policyValue) {
  const policy = payrollPolicyConfiguration(policyValue)
  const slotMap = new Map()
  let attendanceEventCount = 0

  for (const item of attendanceDocuments) {
    const attendance = typeof item?.data === 'function' ? item.data() : item || {}
    // A charged cancellation consumes the learner contract but is not a class
    // taught by the trainer, therefore it never creates payroll.
    if (attendance.type && attendance.type !== 'attended') continue
    const sessionId = typeof attendance.sessionId === 'string' && attendance.sessionId.trim()
      ? attendance.sessionId.trim()
      : typeof item?.id === 'string' ? item.id : ''
    const session = sessionsById.get(sessionId)
    if (!sessionId || !session) {
      throw new HttpsError('failed-precondition', 'Có điểm danh không liên kết được với ca dạy. Hãy đối soát trước khi lập lương.')
    }
    const trainerId = typeof session.trainerId === 'string' && session.trainerId.trim()
      ? session.trainerId.trim()
      : typeof attendance.trainerId === 'string' ? attendance.trainerId.trim() : ''
    if (!trainerId) throw new HttpsError('failed-precondition', 'Ca dạy chưa có HLV phụ trách.')
    const date = vietnamDateKey(session.date || attendance.scheduledFor || attendance.occurredAt)
    const hour = teachingHour(session.hour, sessionId)
    const key = `${trainerId}|${date}|${hour}`
    let slot = slotMap.get(key)
    if (!slot) {
      slot = {
        key,
        trainerId,
        date,
        hour,
        branchId: session.branchId || '',
        sessionIds: new Set(),
        studentIds: new Set(),
        attendanceEventIds: new Set(),
      }
      slotMap.set(key, slot)
    }
    slot.sessionIds.add(sessionId)
    slot.studentIds.add(attendance.studentId || session.studentId || `unknown_${item?.id || sessionId}`)
    slot.attendanceEventIds.add(item?.id || sessionId)
    attendanceEventCount += 1
  }

  const trainers = new Map()
  for (const slot of slotMap.values()) {
    const current = trainers.get(slot.trainerId) || []
    current.push(slot)
    trainers.set(slot.trainerId, current)
  }
  for (const [trainerId, slots] of trainers) {
    const dailyPosition = new Map()
    slots.sort((left, right) => left.date.localeCompare(right.date) || left.hour - right.hour || left.key.localeCompare(right.key))
    trainers.set(trainerId, slots.map((slot) => {
      const position = Number(dailyPosition.get(slot.date) || 0) + 1
      dailyPosition.set(slot.date, position)
      const afterThreshold = position > policy.dailySessionThreshold
      const evening = afterThreshold && slot.hour >= policy.eveningStartHour
      const rate = evening
        ? policy.rateAfterDailyThresholdEvening
        : afterThreshold ? policy.rateAfterDailyThreshold : policy.ratePerSession
      return {
        key: slot.key,
        date: slot.date,
        hour: slot.hour,
        branchId: slot.branchId,
        dailyPosition: position,
        tier: evening ? 'after_threshold_evening' : afterThreshold ? 'after_threshold' : 'standard',
        rate,
        studentCount: slot.studentIds.size,
        sessionIds: [...slot.sessionIds],
        attendanceEventIds: [...slot.attendanceEventIds],
      }
    }))
  }
  return { trainers, attendanceEventCount, teachingSlotCount: slotMap.size, policy }
}

function createPayrollFunctions({ db, onCall }) {
  const listPayrollPolicies = onCall(async (request) => {
    await payrollActor(request, db)
    const snapshot = await db.collection('payrollPolicies').orderBy('effectiveFrom', 'desc').limit(36).get()
    return {
      policies: snapshot.docs.map((item) => {
        const data = item.data()
        return {
          id: item.id,
          name: data.name || 'Chính sách lương PT',
          version: Number(data.version || 1),
          effectiveFrom: iso(data.effectiveFrom),
          ratePerSession: Number(data.ratePerSession || 0),
          dailySessionThreshold: Number(data.dailySessionThreshold || 8),
          rateAfterDailyThreshold: Number(data.rateAfterDailyThreshold || data.ratePerSession || 0),
          eveningStartHour: Number(data.eveningStartHour ?? 20),
          rateAfterDailyThresholdEvening: Number(data.rateAfterDailyThresholdEvening || data.rateAfterDailyThreshold || data.ratePerSession || 0),
          status: data.status === 'inactive' ? 'inactive' : 'active',
          createdAt: iso(data.createdAt),
        }
      }),
    }
  })

  const savePayrollPolicy = onCall(async (request) => {
    const actor = await payrollActor(request, db)
    const effective = policyEffectiveDate(request.data?.effectiveFrom)
    const rates = payrollPolicyConfiguration(request.data || {})
    const name = policyName(request.data?.name)
    const policyId = `global_${effective.value.replaceAll('-', '')}`
    const reference = db.doc(`payrollPolicies/${policyId}`)
    return db.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference)
      if (existing.exists) {
        const data = existing.data()
        if (data.name === name
          && Number(data.ratePerSession || 0) === rates.ratePerSession
          && Number(data.dailySessionThreshold || 8) === rates.dailySessionThreshold
          && Number(data.rateAfterDailyThreshold || data.ratePerSession || 0) === rates.rateAfterDailyThreshold
          && Number(data.eveningStartHour ?? 20) === rates.eveningStartHour
          && Number(data.rateAfterDailyThresholdEvening || data.rateAfterDailyThreshold || data.ratePerSession || 0) === rates.rateAfterDailyThresholdEvening
          && data.status !== 'inactive') {
          return { policyId, unchanged: true }
        }
        throw new HttpsError('already-exists', 'Ngày hiệu lực này đã có chính sách. Hãy chọn ngày mới để giữ lịch sử phiên bản.')
      }
      const version = Number(effective.value.replaceAll('-', ''))
      transaction.create(reference, {
        schemaVersion: 3,
        scope: 'global',
        name,
        version,
        effectiveFrom: effective.timestamp,
        ...rates,
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 3,
        policyId,
        action: 'payroll.policy.created',
        actorUid: actor.uid,
        snapshot: { name, version, effectiveFrom: effective.value, ...rates },
        createdAt: FieldValue.serverTimestamp(),
      })
      return { policyId, unchanged: false }
    })
  })

  const listPayrollRuns = onCall(async (request) => {
    await payrollActor(request, db)
    const limit = Math.min(36, Math.max(1, Number.isInteger(request.data?.limit) ? request.data.limit : 18))
    const snapshot = await db.collection('payrollRuns').orderBy('createdAt', 'desc').limit(limit).get()
    return {
      runs: snapshot.docs.map((item) => {
        const data = item.data()
        return {
          id: item.id,
          periodId: data.periodId || '',
          policyVersion: Number(data.policyVersion || 1),
          policyName: data.policySnapshot?.name || '',
          status: data.status || 'draft',
          attendanceCount: Number(data.teachingSlotCount ?? data.attendanceCount ?? 0),
          teachingSlotCount: Number(data.teachingSlotCount ?? data.attendanceCount ?? 0),
          attendanceEventCount: Number(data.attendanceEventCount ?? data.attendanceCount ?? 0),
          trainerCount: Number(data.trainerCount || 0),
          grossAmount: Number(data.grossAmount || 0),
          adjustmentAmount: Number(data.adjustmentAmount || 0),
          finalAmount: Number(data.finalAmount || data.grossAmount || 0),
          createdAt: iso(data.createdAt),
          updatedAt: iso(data.updatedAt),
        }
      }),
    }
  })

  const getPayrollRun = onCall(async (request) => {
    await payrollActor(request, db)
    const runId = typeof request.data?.runId === 'string' ? request.data.runId.trim() : ''
    if (!runId) throw new HttpsError('invalid-argument', 'Mã kỳ lương không hợp lệ.')
    const [run, items] = await Promise.all([
      db.doc(`payrollRuns/${runId}`).get(),
      db.collection('payrollRunItems').where('runId', '==', runId).limit(500).get(),
    ])
    if (!run.exists) throw new HttpsError('not-found', 'Không tìm thấy kỳ lương.')
    return {
      run: { id: run.id, ...run.data(), createdAt: iso(run.data().createdAt), updatedAt: iso(run.data().updatedAt) },
      items: items.docs.map((item) => {
        const data = item.data()
        return {
          id: item.id,
          ...data,
          sessionCount: Number(data.sessionCount || 0),
          attendanceEventCount: Number(data.attendanceEventCount || data.sessionCount || 0),
          teachingSlots: Array.isArray(data.teachingSlots) ? data.teachingSlots : [],
          tierSummary: data.tierSummary && typeof data.tierSummary === 'object' ? data.tierSummary : {},
          ratePerSession: Number(data.ratePerSession || 0),
          grossAmount: Number(data.grossAmount || 0),
          adjustmentAmount: Number(data.adjustmentAmount || 0),
          finalAmount: Number(data.finalAmount || data.grossAmount || 0),
          createdAt: iso(data.createdAt),
        }
      }),
    }
  })

  const createPayrollRun = onCall(async (request) => {
    const actor = await payrollActor(request, db)
    const periodId = period(request.data?.periodId)
    const { start, end } = periodBounds(periodId)
    // One deterministic document per business period prevents two admins from
    // creating duplicate payroll runs concurrently.
    const runReference = db.doc(`payrollRuns/${periodId}`)
    return db.runTransaction(async (transaction) => {
      const existing = await transaction.get(runReference)
      if (existing.exists) return { runId: existing.id, unchanged: true, status: existing.data().status }

      const [attendance, policies] = await Promise.all([
        transaction.get(db.collection('attendanceEvents').where('occurredAt', '>=', start).where('occurredAt', '<', end)),
        transaction.get(db.collection('payrollPolicies').where('effectiveFrom', '<=', start).orderBy('effectiveFrom', 'desc').limit(1)),
      ])
      const policySnapshot = policies.docs[0]
      if (!policySnapshot) throw new HttpsError('failed-precondition', 'Chưa có chính sách lương hiệu lực cho kỳ này.')
      const policy = policySnapshot.data()
      const policyConfiguration = payrollPolicyConfiguration(policy)
      const eligibleAttendance = attendance.docs.filter((item) => !item.data().type || item.data().type === 'attended')
      const sessionIds = [...new Set(eligibleAttendance.map((item) => item.data().sessionId || item.id).filter(Boolean))]
      if (sessionIds.length > 3000) throw new HttpsError('resource-exhausted', 'Kỳ lương có quá nhiều ca dạy. Hãy liên hệ quản trị để chia kỳ đối soát.')
      const sessionSnapshots = await Promise.all(sessionIds.map((sessionId) => transaction.get(db.doc(`sessions/${sessionId}`))))
      const sessionById = new Map(sessionSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()]))
      const teaching = teachingSlotsFromAttendance(eligibleAttendance, sessionById, policyConfiguration)
      if (teaching.trainers.size > 450) throw new HttpsError('resource-exhausted', 'Kỳ lương có quá nhiều nhân sự để khóa trong một giao dịch.')
      const trainerIds = [...teaching.trainers.keys()]
      const identitySnapshots = await Promise.all(trainerIds.flatMap((trainerId) => [
        transaction.get(db.doc(`trainers/${trainerId}`)),
        transaction.get(db.doc(`staff/${trainerId}`)),
        transaction.get(db.doc(`users/${trainerId}`)),
      ]))
      const trainerById = new Map()
      trainerIds.forEach((trainerId, index) => {
        const trainer = identitySnapshots[index * 3]?.exists ? identitySnapshots[index * 3].data() : {}
        const staff = identitySnapshots[index * 3 + 1]?.exists ? identitySnapshots[index * 3 + 1].data() : {}
        const user = identitySnapshots[index * 3 + 2]?.exists ? identitySnapshots[index * 3 + 2].data() : {}
        trainerById.set(trainerId, {
          name: trainer.name || trainer.fullName || trainer.displayName || staff.name || staff.fullName || user.name || user.fullName || user.displayName || '',
          branchId: trainer.branchId || staff.branchId || user.branchId || '',
        })
      })
      const grossAmount = [...teaching.trainers.values()].flat().reduce((total, slot) => total + slot.rate, 0)
      transaction.create(runReference, {
        schemaVersion: 3,
        revision: 1,
        periodId,
        policyId: policySnapshot.id,
        policyVersion: Number(policy.version || 1),
        policySnapshot: { name: policy.name || 'Chính sách lương PT', ...policyConfiguration },
        status: 'draft',
        attendanceCount: teaching.teachingSlotCount,
        teachingSlotCount: teaching.teachingSlotCount,
        attendanceEventCount: teaching.attendanceEventCount,
        trainerCount: teaching.trainers.size,
        grossAmount,
        adjustmentAmount: 0,
        finalAmount: grossAmount,
        timeZone: 'Asia/Ho_Chi_Minh',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      for (const [trainerId, teachingSlots] of teaching.trainers) {
        const itemReference = db.doc(`payrollRunItems/${periodId}_${trainerId}`)
        const trainer = trainerById.get(trainerId) || {}
        const itemGrossAmount = teachingSlots.reduce((total, slot) => total + slot.rate, 0)
        const tierSummary = teachingSlots.reduce((result, slot) => {
          if (slot.tier === 'standard') { result.standardCount += 1; result.standardAmount += slot.rate }
          else if (slot.tier === 'after_threshold') { result.afterThresholdCount += 1; result.afterThresholdAmount += slot.rate }
          else { result.afterThresholdEveningCount += 1; result.afterThresholdEveningAmount += slot.rate }
          return result
        }, { standardCount: 0, standardAmount: 0, afterThresholdCount: 0, afterThresholdAmount: 0, afterThresholdEveningCount: 0, afterThresholdEveningAmount: 0 })
        transaction.create(itemReference, {
          schemaVersion: 3,
          runId: runReference.id,
          periodId,
          trainerId,
          trainerSnapshot: { name: trainer.name || 'Chưa cập nhật tên HLV', branchId: trainer.branchId || '' },
          sessionCount: teachingSlots.length,
          attendanceEventCount: teachingSlots.reduce((total, slot) => total + slot.attendanceEventIds.length, 0),
          teachingDayCount: new Set(teachingSlots.map((slot) => slot.date)).size,
          teachingSlots,
          tierSummary,
          ratePerSession: policyConfiguration.ratePerSession,
          grossAmount: itemGrossAmount,
          adjustmentAmount: 0,
          finalAmount: itemGrossAmount,
          status: 'draft',
          evidenceSource: 'attendanceEvents+sessions',
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 1, runId: runReference.id, action: 'payroll.created', actorUid: actor.uid, toStatus: 'draft', createdAt: FieldValue.serverTimestamp() })
      return { runId: runReference.id, unchanged: false, status: 'draft' }
    })
  })

  async function transition(request, from, to, fields = {}) {
    const actor = await payrollActor(request, db)
    const runId = typeof request.data?.runId === 'string' ? request.data.runId.trim() : ''
    if (!runId) throw new HttpsError('invalid-argument', 'Mã kỳ lương không hợp lệ.')
    const reference = db.doc(`payrollRuns/${runId}`)
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy kỳ lương.')
      if (snapshot.data().status === to) return
      if (snapshot.data().status !== from) throw new HttpsError('failed-precondition', `Kỳ lương phải ở trạng thái ${from}.`)
      transaction.update(reference, { status: to, ...fields, [`${to}At`]: FieldValue.serverTimestamp(), [`${to}By`]: actor.uid, updatedAt: FieldValue.serverTimestamp() })
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 1, runId, action: `payroll.${to}`, actorUid: actor.uid, fromStatus: from, toStatus: to, createdAt: FieldValue.serverTimestamp() })
    })
    return { runId, status: to }
  }

  const reviewPayrollRun = onCall((request) => transition(request, 'draft', 'reviewed'))
  const lockPayrollRun = onCall(async (request) => {
    const actor = await payrollActor(request, db)
    const runId = typeof request.data?.runId === 'string' ? request.data.runId.trim() : ''
    if (!runId) throw new HttpsError('invalid-argument', 'Mã kỳ lương không hợp lệ.')
    const runReference = db.doc(`payrollRuns/${runId}`)
    const ledgerReference = db.doc(`ledgerEntries/payroll_${runId}`)
    await db.runTransaction(async (transaction) => {
      const [run, existingLedger] = await Promise.all([transaction.get(runReference), transaction.get(ledgerReference)])
      if (!run.exists) throw new HttpsError('not-found', 'Không tìm thấy kỳ lương.')
      if (run.data().status === 'locked') return
      if (run.data().status !== 'reviewed') throw new HttpsError('failed-precondition', 'Kỳ lương phải ở trạng thái reviewed.')
      const periodId = period(run.data().periodId)
      const finalAmount = Math.max(0, Number(run.data().finalAmount || run.data().grossAmount || 0))
      transaction.update(runReference, { status: 'locked', lockedAt: FieldValue.serverTimestamp(), lockedBy: actor.uid, ledgerEntryId: ledgerReference.id, updatedAt: FieldValue.serverTimestamp() })
      if (!existingLedger.exists) {
        transaction.create(ledgerReference, {
          schemaVersion: 2,
          type: 'payroll',
          eventClass: 'payroll_accrual',
          source: 'payroll',
          payrollRunId: runId,
          periodId,
          branchId: run.data().branchId || '',
          amount: -finalAmount,
          cashImpact: 0,
          revenueImpact: 0,
          expenseImpact: finalAmount,
          receivableImpact: 0,
          deferredRevenueImpact: 0,
          effectiveAt: payrollEffectiveAt(periodId),
          idempotencyKey: `payroll-accrual:${runId}`,
          status: 'posted',
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        })
      }
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 2, runId, action: 'payroll.locked', actorUid: actor.uid, fromStatus: 'reviewed', toStatus: 'locked', ledgerEntryId: ledgerReference.id, createdAt: FieldValue.serverTimestamp() })
    })
    return { runId, status: 'locked' }
  })
  const markPayrollRunPaid = onCall(async (request) => {
    const actor = await payrollActor(request, db)
    const runId = typeof request.data?.runId === 'string' ? request.data.runId.trim() : ''
    if (!runId) throw new HttpsError('invalid-argument', 'Mã kỳ lương không hợp lệ.')
    const paymentReference = payrollPaymentReference(request.data?.paymentReference)
    const cashAccountId = payrollCashAccountId(request.data?.cashAccountId)
    const runReference = db.doc(`payrollRuns/${runId}`)
    const accrualReference = db.doc(`ledgerEntries/payroll_${runId}`)
    const paymentLedgerReference = db.doc(`ledgerEntries/payroll_payment_${runId}`)
    const cashTransactionReference = db.doc(`cashTransactions/payroll_${runId}`)
    const accountReference = db.doc(`cashAccounts/${cashAccountId}`)

    return db.runTransaction(async (transaction) => {
      const [run, accrual, existingPayment, account] = await Promise.all([
        transaction.get(runReference),
        transaction.get(accrualReference),
        transaction.get(paymentLedgerReference),
        transaction.get(accountReference),
      ])
      if (!run.exists) throw new HttpsError('not-found', 'Không tìm thấy kỳ lương.')
      if (run.data().status === 'paid') {
        return { runId, status: 'paid', unchanged: true, paymentLedgerEntryId: run.data().paymentLedgerEntryId || paymentLedgerReference.id }
      }
      if (run.data().status !== 'locked') throw new HttpsError('failed-precondition', 'Kỳ lương phải được khóa trước khi ghi nhận chi trả.')
      if (!accrual.exists || accrual.data().status !== 'posted') {
        throw new HttpsError('failed-precondition', 'Không tìm thấy bút toán chi phí của kỳ lương đã khóa.')
      }
      if (!account.exists || account.data().status !== 'active') {
        throw new HttpsError('failed-precondition', 'Tài khoản quỹ chi lương không hoạt động.')
      }
      const finalAmount = Math.max(0, Number(run.data().finalAmount || run.data().grossAmount || 0))
      if (!Number.isSafeInteger(finalAmount) || finalAmount <= 0) {
        throw new HttpsError('failed-precondition', 'Kỳ lương không có số tiền hợp lệ để chi trả.')
      }
      if (Number(account.data().balance || 0) < finalAmount) {
        throw new HttpsError('failed-precondition', 'Số dư quỹ không đủ để chi trả kỳ lương này.')
      }
      const paidAt = Timestamp.now()
      if (!existingPayment.exists) {
        transaction.create(paymentLedgerReference, {
          schemaVersion: 2,
          type: 'payroll',
          eventClass: 'payroll_payment',
          source: 'payroll',
          payrollRunId: runId,
          periodId: run.data().periodId || '',
          branchId: run.data().branchId || account.data().branchId || '',
          cashAccountId,
          amount: -finalAmount,
          cashImpact: -finalAmount,
          revenueImpact: 0,
          expenseImpact: 0,
          receivableImpact: 0,
          deferredRevenueImpact: 0,
          effectiveAt: paidAt,
          paymentReference,
          idempotencyKey: `payroll-payment:${runId}`,
          status: 'posted',
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        })
        transaction.create(cashTransactionReference, {
          schemaVersion: 2,
          accountId: cashAccountId,
          branchId: account.data().branchId || run.data().branchId || '',
          type: 'expense',
          category: 'payroll_payment',
          amount: -finalAmount,
          effectiveAt: paidAt,
          status: 'posted',
          referenceCode: `PAY-${runId.slice(-8).toUpperCase()}`,
          paymentReference,
          ledgerEntryId: paymentLedgerReference.id,
          idempotencyKey: `payroll-cash:${runId}`,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        })
        transaction.update(accountReference, {
          balance: FieldValue.increment(-finalAmount),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.update(runReference, {
        status: 'paid',
        paidAt: FieldValue.serverTimestamp(),
        paidBy: actor.uid,
        paymentReference,
        cashAccountId,
        paymentLedgerEntryId: paymentLedgerReference.id,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 2,
        runId,
        action: 'payroll.paid',
        actorUid: actor.uid,
        fromStatus: 'locked',
        toStatus: 'paid',
        cashAccountId,
        paymentLedgerEntryId: paymentLedgerReference.id,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { runId, status: 'paid', unchanged: false, paymentLedgerEntryId: paymentLedgerReference.id }
    })
  })

  return { listPayrollPolicies, savePayrollPolicy, listPayrollRuns, getPayrollRun, createPayrollRun, reviewPayrollRun, lockPayrollRun, markPayrollRunPaid }
}

module.exports = {
  createPayrollFunctions,
  periodBounds,
  policyEffectiveDate,
  policyRate,
  payrollPolicyConfiguration,
  teachingSlotsFromAttendance,
}
