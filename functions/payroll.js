const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { createHash } = require('node:crypto')
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

function payrollDocumentId(value, label) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(result)) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function priceTeachingSlots(slots, resolvePolicy) {
  const dailyPosition = new Map()
  return [...slots]
    .sort((left, right) => left.date.localeCompare(right.date) || left.hour - right.hour || left.key.localeCompare(right.key))
    .map((slot) => {
      const position = Number(dailyPosition.get(slot.date) || 0) + 1
      dailyPosition.set(slot.date, position)
      const selected = resolvePolicy(slot)
      if (!selected?.configuration) {
        throw new HttpsError('failed-precondition', 'Chưa xác định được chính sách cho một ca dạy.')
      }
      const policy = payrollPolicyConfiguration(selected.configuration)
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
        policyId: selected.id || '',
        policyName: selected.name || 'Chính sách lương PT',
        studentCount: slot.studentIds?.size ?? slot.studentCount ?? 0,
        sessionIds: slot.sessionIds instanceof Set ? [...slot.sessionIds] : [...(slot.sessionIds || [])],
        attendanceEventIds: slot.attendanceEventIds instanceof Set ? [...slot.attendanceEventIds] : [...(slot.attendanceEventIds || [])],
      }
    })
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
    trainers.set(trainerId, priceTeachingSlots(slots, () => ({ configuration: policy })))
  }
  return { trainers, attendanceEventCount, teachingSlotCount: slotMap.size, policy }
}

function payrollRunPolicyPlan(value = {}) {
  const selectedPolicyIds = Array.isArray(value.policyIds)
    ? [...new Set(value.policyIds.map((item) => payrollDocumentId(item, 'Mã chính sách')))].slice(0, 10)
    : []
  const applicationMode = value.policyApplicationMode === 'effective_date'
    ? 'effective_date'
    : 'trainer_assignment'
  const defaultPolicyId = value.defaultPolicyId
    ? payrollDocumentId(value.defaultPolicyId, 'Chính sách mặc định')
    : selectedPolicyIds[0] || ''
  const trainerAssignments = new Map()
  if (Array.isArray(value.trainerPolicyAssignments)) {
    if (value.trainerPolicyAssignments.length > 500) {
      throw new HttpsError('invalid-argument', 'Danh sách phân chính sách theo HLV quá lớn.')
    }
    value.trainerPolicyAssignments.forEach((assignment) => {
      const trainerId = payrollDocumentId(assignment?.trainerId, 'Mã HLV')
      const policyId = payrollDocumentId(assignment?.policyId, 'Mã chính sách HLV')
      trainerAssignments.set(trainerId, policyId)
    })
  }
  return { selectedPolicyIds, applicationMode, defaultPolicyId, trainerAssignments }
}

function payrollPolicyRecord(snapshot) {
  if (!snapshot?.exists) throw new HttpsError('not-found', 'Không tìm thấy một chính sách lương đã chọn.')
  const data = snapshot.data()
  return {
    id: snapshot.id,
    name: data.name || 'Chính sách lương PT',
    version: Number(data.version || 1),
    effectiveDate: vietnamDateKey(data.effectiveFrom),
    status: data.status === 'inactive' ? 'inactive' : 'active',
    configuration: payrollPolicyConfiguration(data),
  }
}

function payrollPolicySnapshot(policy) {
  return {
    id: policy.id,
    name: policy.name,
    version: policy.version,
    effectiveDate: policy.effectiveDate,
    ...policy.configuration,
  }
}

function applyPayrollPolicyPlan(teaching, plan, policies) {
  const policiesById = new Map(policies.map((policy) => [policy.id, policy]))
  const defaultPolicy = policiesById.get(plan.defaultPolicyId) || policies[0]
  if (!defaultPolicy) throw new HttpsError('failed-precondition', 'Chưa chọn chính sách mặc định cho kỳ lương.')
  const effectivePolicies = [...policies].sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate))
  const trainers = new Map()
  for (const [trainerId, slots] of teaching.trainers) {
    const assignedPolicy = policiesById.get(plan.trainerAssignments.get(trainerId)) || defaultPolicy
    trainers.set(trainerId, priceTeachingSlots(slots, (slot) => {
      if (plan.applicationMode === 'effective_date' && policies.length > 1) {
        const matching = effectivePolicies.filter((policy) => policy.effectiveDate <= slot.date).at(-1)
        if (!matching) {
          throw new HttpsError('failed-precondition', `Chưa có chính sách hiệu lực cho ca ngày ${slot.date}.`)
        }
        return matching
      }
      if (assignedPolicy.effectiveDate > slot.date) {
        throw new HttpsError('failed-precondition', `Chính sách ${assignedPolicy.name} chưa hiệu lực tại ngày ${slot.date}.`)
      }
      return assignedPolicy
    }))
  }
  return { ...teaching, trainers }
}

function createPayrollFunctions({ db, onCall }) {
  const listPayrollPolicies = onCall(async (request) => {
    await payrollActor(request, db)
    const [snapshot, runSnapshot] = await Promise.all([
      db.collection('payrollPolicies').orderBy('effectiveFrom', 'desc').limit(100).get(),
      db.collection('payrollRuns').select('policyId', 'policyIds').limit(500).get(),
    ])
    const usage = new Map()
    runSnapshot.docs.forEach((item) => {
      const data = item.data()
      const policyIds = Array.isArray(data.policyIds) && data.policyIds.length
        ? data.policyIds
        : data.policyId ? [data.policyId] : []
      new Set(policyIds).forEach((policyId) => usage.set(policyId, Number(usage.get(policyId) || 0) + 1))
    })
    const usageInventoryTruncated = runSnapshot.size === 500
    return {
      policies: snapshot.docs.map((item) => {
        const data = item.data()
        const usageCount = Number(usage.get(item.id) || 0)
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
          usageCount,
          canDelete: usageCount === 0 && !usageInventoryTruncated,
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
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ name, effectiveFrom: effective.value, ...rates }))
      .digest('hex')
      .slice(0, 16)
    const policyId = `policy_${effective.value.replaceAll('-', '')}_${fingerprint}`
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
        throw new HttpsError('already-exists', 'Chính sách trùng mã nhưng khác dữ liệu. Hãy đổi tên hoặc ngày hiệu lực.')
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

  const managePayrollPolicy = onCall(async (request) => {
    const actor = await payrollActor(request, db)
    const policyId = payrollDocumentId(request.data?.policyId, 'Mã chính sách')
    const action = request.data?.action
    if (!['hide', 'restore', 'delete'].includes(action)) {
      throw new HttpsError('invalid-argument', 'Thao tác chính sách không hợp lệ.')
    }
    const reference = db.doc(`payrollPolicies/${policyId}`)
    return db.runTransaction(async (transaction) => {
      const [snapshot, legacyUsage, multiUsage] = await Promise.all([
        transaction.get(reference),
        transaction.get(db.collection('payrollRuns').where('policyId', '==', policyId).limit(1)),
        transaction.get(db.collection('payrollRuns').where('policyIds', 'array-contains', policyId).limit(1)),
      ])
      if (!snapshot.exists) return { policyId, action, unchanged: true }
      const used = !legacyUsage.empty || !multiUsage.empty
      if (action === 'delete') {
        if (used) {
          throw new HttpsError('failed-precondition', 'Chính sách đã được dùng trong kỳ lương nên chỉ có thể ẩn.')
        }
        transaction.delete(reference)
      } else {
        const nextStatus = action === 'hide' ? 'inactive' : 'active'
        if ((snapshot.data().status === 'inactive' ? 'inactive' : 'active') === nextStatus) {
          return { policyId, action, unchanged: true }
        }
        transaction.update(reference, {
          status: nextStatus,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
      }
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 3,
        policyId,
        action: `payroll.policy.${action}`,
        actorUid: actor.uid,
        usageProtected: used,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { policyId, action, unchanged: false }
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
          policyName: data.policyName || data.policySnapshot?.name || '',
          policyIds: Array.isArray(data.policyIds) ? data.policyIds : data.policyId ? [data.policyId] : [],
          policyApplicationMode: data.policyApplicationMode || 'single',
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
    const requestedPlan = payrollRunPolicyPlan(request.data || {})
    // One deterministic document per business period prevents two admins from
    // creating duplicate payroll runs concurrently.
    const runReference = db.doc(`payrollRuns/${periodId}`)
    return db.runTransaction(async (transaction) => {
      const existing = await transaction.get(runReference)
      if (existing.exists) return { runId: existing.id, unchanged: true, status: existing.data().status }

      const attendance = await transaction.get(db.collection('attendanceEvents').where('occurredAt', '>=', start).where('occurredAt', '<', end))
      let policyDocuments
      if (requestedPlan.selectedPolicyIds.length) {
        policyDocuments = await Promise.all(requestedPlan.selectedPolicyIds.map((policyId) => transaction.get(db.doc(`payrollPolicies/${policyId}`))))
      } else {
        const fallback = await transaction.get(db.collection('payrollPolicies').where('effectiveFrom', '<=', start).orderBy('effectiveFrom', 'desc').limit(20))
        policyDocuments = fallback.docs.filter((item) => item.data().status !== 'inactive').slice(0, 1)
      }
      const selectedPolicies = policyDocuments.map(payrollPolicyRecord)
      if (!selectedPolicies.length) throw new HttpsError('failed-precondition', 'Chưa có chính sách lương hiệu lực cho kỳ này.')
      if (selectedPolicies.some((policy) => policy.status !== 'active')) {
        throw new HttpsError('failed-precondition', 'Một chính sách đã chọn đang bị ẩn. Hãy chọn lại chính sách hoạt động.')
      }
      const policyIds = selectedPolicies.map((policy) => policy.id)
      const defaultPolicyId = requestedPlan.defaultPolicyId || policyIds[0]
      if (!policyIds.includes(defaultPolicyId)) {
        throw new HttpsError('invalid-argument', 'Chính sách mặc định phải nằm trong danh sách đã chọn.')
      }
      for (const policyId of requestedPlan.trainerAssignments.values()) {
        if (!policyIds.includes(policyId)) throw new HttpsError('invalid-argument', 'Phân chính sách HLV nằm ngoài danh sách đã chọn.')
      }
      if (requestedPlan.applicationMode === 'effective_date' && new Set(selectedPolicies.map((policy) => policy.effectiveDate)).size !== selectedPolicies.length) {
        throw new HttpsError('invalid-argument', 'Các chính sách áp theo ngày phải có ngày hiệu lực khác nhau.')
      }
      const policyPlan = { ...requestedPlan, defaultPolicyId }
      const eligibleAttendance = attendance.docs.filter((item) => !item.data().type || item.data().type === 'attended')
      const sessionIds = [...new Set(eligibleAttendance.map((item) => item.data().sessionId || item.id).filter(Boolean))]
      if (sessionIds.length > 3000) throw new HttpsError('resource-exhausted', 'Kỳ lương có quá nhiều ca dạy. Hãy liên hệ quản trị để chia kỳ đối soát.')
      const sessionSnapshots = await Promise.all(sessionIds.map((sessionId) => transaction.get(db.doc(`sessions/${sessionId}`))))
      const sessionById = new Map(sessionSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()]))
      const groupedTeaching = teachingSlotsFromAttendance(eligibleAttendance, sessionById, selectedPolicies[0].configuration)
      const teaching = applyPayrollPolicyPlan(groupedTeaching, policyPlan, selectedPolicies)
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
      const defaultPolicy = selectedPolicies.find((policy) => policy.id === defaultPolicyId) || selectedPolicies[0]
      const policySnapshots = selectedPolicies.map(payrollPolicySnapshot)
      const policyName = selectedPolicies.length === 1 ? selectedPolicies[0].name : `${selectedPolicies.length} chính sách linh hoạt`
      transaction.create(runReference, {
        schemaVersion: 4,
        revision: 1,
        periodId,
        policyId: defaultPolicy.id,
        policyIds,
        policyVersion: defaultPolicy.version,
        policyName,
        policySnapshot: payrollPolicySnapshot(defaultPolicy),
        policySnapshots,
        policyApplicationMode: selectedPolicies.length === 1 ? 'single' : policyPlan.applicationMode,
        trainerPolicyAssignments: Object.fromEntries(policyPlan.trainerAssignments),
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
        const itemPolicyIds = [...new Set(teachingSlots.map((slot) => slot.policyId).filter(Boolean))]
        const tierSummary = teachingSlots.reduce((result, slot) => {
          if (slot.tier === 'standard') { result.standardCount += 1; result.standardAmount += slot.rate }
          else if (slot.tier === 'after_threshold') { result.afterThresholdCount += 1; result.afterThresholdAmount += slot.rate }
          else { result.afterThresholdEveningCount += 1; result.afterThresholdEveningAmount += slot.rate }
          return result
        }, { standardCount: 0, standardAmount: 0, afterThresholdCount: 0, afterThresholdAmount: 0, afterThresholdEveningCount: 0, afterThresholdEveningAmount: 0 })
        transaction.create(itemReference, {
          schemaVersion: 4,
          runId: runReference.id,
          periodId,
          trainerId,
          trainerSnapshot: { name: trainer.name || 'Chưa cập nhật tên HLV', branchId: trainer.branchId || '' },
          policyIds: itemPolicyIds,
          policySnapshots: policySnapshots.filter((policy) => itemPolicyIds.includes(policy.id)),
          sessionCount: teachingSlots.length,
          attendanceEventCount: teachingSlots.reduce((total, slot) => total + slot.attendanceEventIds.length, 0),
          teachingDayCount: new Set(teachingSlots.map((slot) => slot.date)).size,
          teachingSlots,
          tierSummary,
          ratePerSession: defaultPolicy.configuration.ratePerSession,
          grossAmount: itemGrossAmount,
          adjustmentAmount: 0,
          finalAmount: itemGrossAmount,
          status: 'draft',
          evidenceSource: 'attendanceEvents+sessions',
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 4, runId: runReference.id, action: 'payroll.created', actorUid: actor.uid, toStatus: 'draft', policyIds, policyApplicationMode: selectedPolicies.length === 1 ? 'single' : policyPlan.applicationMode, createdAt: FieldValue.serverTimestamp() })
      return { runId: runReference.id, unchanged: false, status: 'draft' }
    })
  })

  const deleteDraftPayrollRun = onCall(async (request) => {
    const actor = await payrollActor(request, db)
    const runId = period(request.data?.runId)
    const runReference = db.doc(`payrollRuns/${runId}`)
    return db.runTransaction(async (transaction) => {
      const [run, items] = await Promise.all([
        transaction.get(runReference),
        transaction.get(db.collection('payrollRunItems').where('runId', '==', runId).limit(451)),
      ])
      if (!run.exists) return { runId, unchanged: true }
      if (run.data().status !== 'draft') {
        throw new HttpsError('failed-precondition', 'Chỉ kỳ lương chưa duyệt mới được xóa để lập lại.')
      }
      if (items.size > 450) throw new HttpsError('resource-exhausted', 'Kỳ lương có quá nhiều dòng để xóa an toàn.')
      items.docs.forEach((item) => transaction.delete(item.ref))
      transaction.delete(runReference)
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 4,
        runId,
        action: 'payroll.draft.deleted',
        actorUid: actor.uid,
        deletedItemCount: items.size,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { runId, unchanged: false }
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

  return {
    listPayrollPolicies,
    savePayrollPolicy,
    managePayrollPolicy,
    listPayrollRuns,
    getPayrollRun,
    createPayrollRun,
    deleteDraftPayrollRun,
    reviewPayrollRun,
    lockPayrollRun,
    markPayrollRunPaid,
  }
}

module.exports = {
  createPayrollFunctions,
  periodBounds,
  policyEffectiveDate,
  policyRate,
  payrollPolicyConfiguration,
  teachingSlotsFromAttendance,
  payrollRunPolicyPlan,
  applyPayrollPolicyPlan,
  priceTeachingSlots,
}
