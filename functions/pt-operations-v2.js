const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { contractEffectiveOnDate, effectiveContractStatus } = require('./contract-status')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const {
  chargeSessionTransaction,
  completeSessionAttendanceTransaction,
  recordSessionAttendanceTransaction,
} = require('./session-operations')
const { assertSessionChangeDeadline, ptOperationsPolicySnapshot } = require('./pt-policy')
const {
  effectiveStudentAvailability,
  loadLatestSubmittedFallbacks,
  normalizeRequestedSessions,
  studentAvailabilityProfilePatch,
} = require('./student-availability')
const { summarizeContractUsage } = require('./contract-usage')
const { normalizeMemberReferralCode } = require('./loyalty-core')
const { normalizedScheduleConfig } = require('./pt-schedule-publish')

const TIME_ZONE = 'Asia/Ho_Chi_Minh'
const DEFAULT_WORKING_DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const DEFAULT_WORKING_HOURS = [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20]

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00+07:00`))) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function integer(value, fallback, minimum, maximum) {
  const result = Number.isInteger(value) ? value : fallback
  return Math.min(maximum, Math.max(minimum, result))
}

function serialize(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]))
  return value
}

function safeMoney(value) {
  const result = Number(value || 0)
  return Number.isFinite(result) ? Math.max(0, Math.round(result)) : 0
}

function storedDateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  if (value instanceof Timestamp) return value.toDate().toISOString().slice(0, 10)
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10)
  return ''
}

function currentDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function normalizedContact(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9@._+]/g, '')
}

function mondayDateKey(referenceDate = currentDateKey()) {
  const parsed = Date.parse(`${referenceDate}T12:00:00+07:00`)
  if (!Number.isFinite(parsed)) return referenceDate
  const weekday = new Date(parsed).getUTCDay()
  return new Date(parsed - ((weekday + 6) % 7) * 86400000).toISOString().slice(0, 10)
}

function isEffectiveStaffContract(contract = {}, referenceDate = currentDateKey()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return false
  if (!contractEffectiveOnDate(contract, referenceDate)) return false
  const startDate = storedDateKey(contract.startDate)
  const endDate = storedDateKey(contract.endDate)
  const totalSessions = Math.max(0, Number(contract.totalSessions || 0))
  const usedSessions = Math.max(0, Number(contract.usedSessions || 0))
  if (!startDate || !endDate || startDate > referenceDate || endDate < referenceDate || totalSessions <= usedSessions) return false
  return !(Array.isArray(contract.pausePeriods) && contract.pausePeriods.some((period) => {
    if (String(period?.type || '').toLowerCase() !== 'preservation') return false
    const pauseStart = storedDateKey(period.startDate)
    const pauseEnd = storedDateKey(period.endDate)
    return Boolean(pauseStart && pauseEnd && pauseStart <= referenceDate && pauseEnd >= referenceDate)
  }))
}

function contractCoversDate(contract = {}, referenceDate = currentDateKey()) {
  if (!contractEffectiveOnDate(contract, referenceDate)) return false
  return !(Array.isArray(contract.pausePeriods) && contract.pausePeriods.some((period) => {
    if (String(period?.type || '').toLowerCase() !== 'preservation') return false
    const pauseStart = storedDateKey(period.startDate)
    const pauseEnd = storedDateKey(period.endDate)
    return Boolean(pauseStart && pauseEnd && pauseStart <= referenceDate && pauseEnd >= referenceDate)
  }))
}

// Contract eligibility is date-sensitive. Staff can see a future schedule or
// historical sessions after a contract has expired today, so callers that are
// evaluating a concrete session must pass that session's date rather than the
// current date.
function isContractSchedulableOn(contract = {}, referenceDate = currentDateKey(), remainingSessionsOverride) {
  const remainingSessions = remainingSessionsOverride === undefined
    ? Math.max(0, Number(contract.remainingSessions ?? Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0)))
    : Math.max(0, Number(remainingSessionsOverride))
  if (!contractEffectiveOnDate(contract, referenceDate)) return false
  const startDate = storedDateKey(contract.startDate)
  const endDate = storedDateKey(contract.endDate)
  if (!startDate || !endDate || startDate > referenceDate || endDate < referenceDate || remainingSessions <= 0) return false
  return !(Array.isArray(contract.pausePeriods) && contract.pausePeriods.some((period) => {
    if (String(period?.type || '').toLowerCase() !== 'preservation') return false
    const pauseStart = storedDateKey(period.startDate)
    const pauseEnd = storedDateKey(period.endDate)
    return Boolean(pauseStart && pauseEnd && pauseStart <= referenceDate && pauseEnd >= referenceDate)
  }))
}

function isContractSchedulableInWeek(contract = {}, weekId, remainingSessionsOverride) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekId || ''))) return false
  const start = storedDateKey(contract.startDate)
  const end = storedDateKey(contract.endDate)
  if (!start || !end) return false
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(`${weekId}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + index)
    if (isContractSchedulableOn(contract, date.toISOString().slice(0, 10), remainingSessionsOverride)) return true
  }
  return false
}

function boundedWeeklySessionTarget(value) {
  const result = Number(value)
  return Number.isInteger(result) && result >= 1 && result <= 7 ? result : null
}

// The student profile remains the compatibility source for existing records,
// while newer contract documents may carry an explicit weekly target. If a
// legacy record has neither, derive a sensible target from the contract term.
function contractDefaultSessionsPerWeek(contracts = [], profile = {}, weekId = '') {
  const list = Array.isArray(contracts) ? contracts : []
  const schedulable = list
    .filter((contract) => !weekId || isContractSchedulableInWeek(contract, weekId))
    .sort((left, right) => storedDateKey(left.startDate).localeCompare(storedDateKey(right.startDate)) || String(left.id || '').localeCompare(String(right.id || '')))
  const explicitFields = ['sessionsPerWeek', 'weeklySessions', 'weeklySessionTarget', 'trainingSessionsPerWeek']
  for (const contract of schedulable) {
    for (const field of explicitFields) {
      const target = boundedWeeklySessionTarget(contract?.[field])
      if (target !== null) return target
    }
  }
  const profileTarget = boundedWeeklySessionTarget(profile?.sessionsPerWeek)
  if (profileTarget !== null) return profileTarget
  for (const contract of schedulable) {
    const totalSessions = Math.max(0, Number(contract?.totalSessions || contract?.packageSessions || 0))
    const startDate = storedDateKey(contract?.startDate)
    const endDate = storedDateKey(contract?.endDate)
    const elapsedDays = startDate && endDate ? dateDistance(startDate, endDate) : null
    const durationDays = elapsedDays === null ? 0 : elapsedDays + 1
    if (totalSessions > 0 && durationDays > 0) {
      return Math.max(1, Math.min(7, Math.round(totalSessions / (durationDays / 7))))
    }
  }
  return 3
}

function dateDistance(from, to) {
  const fromTime = Date.parse(`${from}T00:00:00Z`)
  const toTime = Date.parse(`${to}T00:00:00Z`)
  return Number.isFinite(fromTime) && Number.isFinite(toTime) ? Math.round((toTime - fromTime) / 86400000) : null
}

function studentContractProjection(id, contract = {}, today = currentDateKey(), usageSessions = [], usageEvidenceComplete = true) {
  const totalAmount = Math.max(0, safeMoney(contract.totalPrice) - safeMoney(contract.discount))
  const paidAmount = safeMoney(contract.paidAmount)
  const outstandingAmount = Math.max(0, totalAmount - paidAmount)
  // Session evidence is canonical only when the caller loaded the contract's
  // whole effective period. A calendar window must never make an older
  // contract look as if it used fewer sessions than it actually did.
  const usage = usageEvidenceComplete && Array.isArray(usageSessions)
    ? summarizeContractUsage(contract, usageSessions)
    : null
  const totalSessions = usage?.totalSessions ?? Math.max(0, Number(contract.totalSessions || 0))
  const usedSessions = usage?.usedSessions ?? Math.max(0, Number(contract.usedSessions || 0))
  const installments = (Array.isArray(contract.installments) ? contract.installments : [])
    .slice(0, 24)
    .map((item, index) => ({
      id: String(item?.id || `installment-${index + 1}`).slice(0, 100),
      date: storedDateKey(item?.date),
      amount: safeMoney(item?.amount),
      status: ['paid', 'cancelled'].includes(item?.status) ? item.status : 'pending',
    }))
    .filter((item) => item.date && item.amount > 0)
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
  const nextPending = installments.find((item) => item.status === 'pending')
  const configuredNextPaymentDate = storedDateKey(contract.nextPaymentDate)
  const nextPaymentDate = nextPending?.date || configuredNextPaymentDate || null
  const startDate = storedDateKey(contract.startDate)
  const endDate = storedDateKey(contract.endDate)
  const remainingSessions = Math.max(0, totalSessions - usedSessions)
  const daysUntilEnd = endDate ? dateDistance(today, endDate) : null
  const pausePeriods = Array.isArray(contract.pausePeriods)
    ? contract.pausePeriods.slice(0, 20).map((period) => ({
        type: typeof period?.type === 'string' ? period.type : undefined,
        startDate: storedDateKey(period?.startDate),
        endDate: storedDateKey(period?.endDate),
      })).filter((period) => period.startDate && period.endDate)
    : []
  const pausedToday = pausePeriods.some((period) => {
    const pauseType = String(period.type || 'preservation').toLowerCase()
    return pauseType === 'preservation' && period.startDate <= today && period.endDate >= today
  })
  const schedulableToday = isContractSchedulableOn(contract, today, remainingSessions)
  const nextPaymentDistance = nextPaymentDate ? dateDistance(today, nextPaymentDate) : null
  const paymentStatus = outstandingAmount <= 0
    ? 'paid'
    : nextPaymentDistance !== null && nextPaymentDistance < 0
      ? 'overdue'
      : nextPaymentDistance === 0
        ? 'due_today'
        : nextPaymentDistance !== null && nextPaymentDistance <= 7
          ? 'due_soon'
          : 'pending'
  return {
    id,
    packageName: contract.packageName || 'Gói tập Aura',
    status: effectiveContractStatus(contract, today),
    storedStatus: contract.status || 'active',
    startDate,
    endDate,
    totalSessions,
    usedSessions,
    remainingSessions: Math.max(0, totalSessions - usedSessions),
    formulaVersion: 'contract-usage-v2',
    storedUsedSessions: usage?.storedUsedSessions ?? Math.max(0, Number(contract.usedSessions || 0)),
    chargedSessions: usage?.chargedSessions ?? null,
    historySessions: usage?.historySessions ?? null,
    reconciliationStatus: usage?.reconciliationStatus ?? 'legacy_projection',
    totalAmount,
    paidAmount,
    outstandingAmount,
    paymentStatus,
    nextPaymentDate,
    daysUntilEnd,
    schedulableToday,
    pausedToday,
    pausePeriods,
    installments,
  }
}

function studentContractAlerts(contracts, today = currentDateKey()) {
  const alerts = []
  const activeContracts = contracts.filter((contract) => effectiveContractStatus(contract, today) === 'active')
  const futureContract = contracts
    .filter((contract) => effectiveContractStatus(contract, today) === 'future')
    .sort((left, right) => left.startDate.localeCompare(right.startDate))[0]

  for (const contract of contracts) {
    if (!['draft', 'cancelled', 'inactive', 'archived'].includes(contract.status) && contract.outstandingAmount > 0) {
      const pendingInstallments = contract.installments.filter((item) => item.status === 'pending')
      const dueItems = pendingInstallments.length
        ? pendingInstallments
        : contract.nextPaymentDate
          ? [{ id: 'next-payment', date: contract.nextPaymentDate, amount: contract.outstandingAmount, status: 'pending' }]
          : []
      for (const installment of dueItems.slice(0, 12)) {
        const daysUntilDue = dateDistance(today, installment.date)
        if (daysUntilDue === null || daysUntilDue > 7) continue
        const overdue = daysUntilDue < 0
        const dueToday = daysUntilDue === 0
        alerts.push({
          code: overdue ? 'PAYMENT_OVERDUE' : dueToday ? 'PAYMENT_DUE_TODAY' : 'PAYMENT_DUE_SOON',
          severity: overdue || dueToday ? 'critical' : 'warning',
          contractId: contract.id,
          title: overdue ? 'Kỳ thanh toán đã quá hạn' : dueToday ? 'Kỳ thanh toán đến hạn hôm nay' : `Kỳ thanh toán còn ${daysUntilDue} ngày`,
          message: `${contract.packageName} · ${installment.amount.toLocaleString('vi-VN')}đ`,
          dueDate: installment.date,
          amount: installment.amount,
        })
      }
    }

    const current = activeContracts.some((item) => item.id === contract.id)
    if (!current) continue
    if (contract.daysUntilEnd !== null && contract.daysUntilEnd >= 0 && contract.daysUntilEnd <= 30) {
      alerts.push({
        code: futureContract ? 'RENEWAL_READY' : 'CONTRACT_EXPIRING',
        severity: contract.daysUntilEnd <= 7 && !futureContract ? 'critical' : futureContract ? 'info' : 'warning',
        contractId: contract.id,
        title: futureContract ? 'Gói tiếp theo đã sẵn sàng' : contract.daysUntilEnd === 0 ? 'Hợp đồng hết hạn hôm nay' : `Hợp đồng còn ${contract.daysUntilEnd} ngày`,
        message: futureContract
          ? `${futureContract.packageName} bắt đầu ${futureContract.startDate}`
          : `${contract.packageName}${contract.remainingSessions > 0 ? ` còn ${contract.remainingSessions} buổi` : ' đã hết buổi'}. Hãy trao đổi sớm với Aura để không gián đoạn lịch tập.`,
        dueDate: contract.endDate,
        amount: null,
      })
    }
    if (contract.remainingSessions <= 5) {
      alerts.push({
        code: 'CONTRACT_SESSIONS_LOW',
        severity: contract.remainingSessions <= 2 ? 'critical' : 'warning',
        contractId: contract.id,
        title: contract.remainingSessions === 0 ? 'Gói tập đã hết buổi' : `Gói tập còn ${contract.remainingSessions} buổi`,
        message: futureContract
          ? `Gói ${futureContract.packageName} đã được nối tiếp.`
          : 'Hãy trao đổi với Aura để chuẩn bị gói tiếp theo và giữ lịch tập ổn định.',
        dueDate: contract.endDate || null,
        amount: null,
      })
    }
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 }
  return alerts
    .sort((left, right) => (severityOrder[left.severity] ?? 9) - (severityOrder[right.severity] ?? 9)
      || String(left.dueDate || '').localeCompare(String(right.dueDate || ''))
      || left.contractId.localeCompare(right.contractId))
    .slice(0, 20)
}

function availabilityWeekId(value) {
  const result = dateKey(value, 'Tuần lịch rảnh')
  const parsed = new Date(`${result}T00:00:00.000Z`)
  if (parsed.getUTCDay() !== 1) throw new HttpsError('invalid-argument', 'Tuần lịch rảnh phải bắt đầu vào thứ Hai.')
  return result
}

function availabilityCutoff(weekId, policyValue = {}) {
  const policy = ptOperationsPolicySnapshot(policyValue)
  const monday = Date.parse(`${weekId}T00:00:00+07:00`)
  const daysBefore = (1 - policy.availabilityRegistrationCutoffDayOfWeek + 7) % 7 || 7
  return new Date(monday - daysBefore * 24 * 60 * 60 * 1000 + policy.availabilityRegistrationCutoffHour * 60 * 60 * 1000)
}

function availabilityState(weekId, value, now = new Date(), policyValue = {}) {
  const cutoff = availabilityCutoff(weekId, policyValue)
  const locked = now.getTime() >= cutoff.getTime()
  const slots = Array.isArray(value?.slots) ? value.slots : []
  const source = value?.source || 'weekly'
  const confirmed = slots.length > 0 && (value?.confirmed === true
    || value?.status === 'submitted'
    || value?.status === 'locked'
    || source === 'inherited_weekly')
  const status = !confirmed
    ? 'draft'
    : locked
      ? 'locked'
      : source === 'inherited_weekly'
        ? 'inherited'
        : source === 'legacy_default'
          ? 'legacy_default'
          : 'submitted'
  return {
    weekId,
    slots,
    minimumSlots: Math.max(5, Number(value?.minimumSlots || 5)),
    requiredSessions: Math.max(1, Number(value?.requiredSessions || 1)),
    requestedSessions: normalizeRequestedSessions(value?.requestedSessions),
    revision: Math.max(0, Number(value?.revision || 0)),
    sourceRevision: Math.max(0, Number(value?.sourceRevision || value?.revision || 0)),
    status,
    confirmed,
    locked,
    cutoffAt: cutoff.toISOString(),
    submittedAt: value?.submittedAt || null,
    updatedAt: value?.updatedAt || value?.submittedAt || null,
    source,
    sourceWeekId: value?.sourceWeekId || null,
  }
}

function staffStudentContractDetail(contract = {}) {
  return {
    id: contract.id,
    packageName: contract.packageName,
    status: contract.status,
    startDate: contract.startDate,
    endDate: contract.endDate,
    totalSessions: contract.totalSessions,
    usedSessions: contract.usedSessions,
    remainingSessions: contract.remainingSessions,
    chargedSessions: contract.chargedSessions,
    historySessions: contract.historySessions,
    reconciliationStatus: contract.reconciliationStatus,
    schedulableToday: contract.schedulableToday,
    schedulableOnWeek: contract.schedulableOnWeek,
    pausedToday: contract.pausedToday,
  }
}

function staffStudentSessionDetail(session = {}) {
  const parsedHour = Number(session.hour)
  const status = String(session.status || 'scheduled').toLowerCase()
  const billingStatus = session.billingStatus || (['completed', 'attended', 'no_show'].includes(status) ? 'charged' : 'pending')
  const attendanceStatus = session.attendanceStatus || (['completed', 'attended'].includes(status)
    ? 'present'
    : status === 'no_show' ? 'no_show' : 'pending')
  return {
    id: session.id,
    studentId: session.studentId,
    trainerId: session.trainerId,
    branchId: session.branchId,
    contractId: session.contractId,
    date: storedDateKey(session.date),
    hour: Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : null,
    status,
    scheduleStatus: session.scheduleStatus,
    billingStatus,
    attendanceStatus,
    sessionKind: session.sessionKind === 'makeup' || session.makeupSession === true ? 'makeup' : 'regular',
    makeupSourceSessionId: session.makeupSourceSessionId || null,
    makeupMode: ['standalone_shift', 'paired_existing_shift'].includes(session.makeupMode) ? session.makeupMode : null,
    commissionEligible: session.commissionEligible !== false,
    advanceAbsenceNotice: session.advanceAbsenceNotice && typeof session.advanceAbsenceNotice === 'object'
      ? {
          status: session.advanceAbsenceNotice.status === 'reported' ? 'reported' : 'none',
          reason: typeof session.advanceAbsenceNotice.reason === 'string' ? session.advanceAbsenceNotice.reason.slice(0, 500) : '',
          note: typeof session.advanceAbsenceNotice.note === 'string' ? session.advanceAbsenceNotice.note.slice(0, 500) : '',
          reportedAt: session.advanceAbsenceNotice.reportedAt || null,
          reportedBy: typeof session.advanceAbsenceNotice.reportedBy === 'string' ? session.advanceAbsenceNotice.reportedBy : '',
          replacementLocked: session.advanceAbsenceNotice.replacementLocked === true,
          replacementRequestId: typeof session.advanceAbsenceNotice.replacementRequestId === 'string' ? session.advanceAbsenceNotice.replacementRequestId : null,
          replacementSessionId: typeof session.advanceAbsenceNotice.replacementSessionId === 'string' ? session.advanceAbsenceNotice.replacementSessionId : null,
        }
      : null,
    lateMinutes: session.lateMinutes,
    noShowReason: session.noShowReason,
    chargedAt: session.chargedAt,
    confirmedAt: session.confirmedAt,
    revision: session.revision,
    timeZone: TIME_ZONE,
  }
}

function staffStudentWorkoutLogDetail(id, log = {}, source = 'pt_tracking') {
  const metrics = log.metrics && typeof log.metrics === 'object' ? log.metrics : {}
  return {
    id,
    source,
    sessionId: log.sessionId || '',
    date: storedDateKey(log.date || log.completedAt || log.updatedAt || log.createdAt),
    hour: Number.isInteger(log.hour) ? log.hour : null,
    status: log.status || '',
    trainingDayTitle: log.trainingDayTitle || '',
    programName: log.programName || log.workoutName || log.title || '',
    note: log.coachNotes || log.note || '',
    painNotes: log.painNotes || '',
    completedAt: log.completedAt || null,
    updatedAt: log.updatedAt || null,
    metrics: {
      completedSets: Math.max(0, Number(metrics.completedSets || 0)),
      totalVolumeKg: Math.max(0, Number(metrics.totalVolumeKg || 0)),
      maximumWeightKg: Math.max(0, Number(metrics.maximumWeightKg || 0)),
      maximumRpe: Math.max(0, Number(metrics.maximumRpe || 0)),
      painAlert: metrics.painAlert === true,
    },
  }
}

function staffStudentTrainingProgramDetail(snapshot) {
  if (!snapshot?.exists) return null
  const program = snapshot.data() || {}
  const trainingDays = Array.isArray(program.trainingDays) ? program.trainingDays : []
  return {
    id: snapshot.id,
    title: typeof program.title === 'string' && program.title.trim() ? program.title.trim() : 'Giáo án Aura',
    goal: typeof program.goal === 'string' ? program.goal.trim() : '',
    status: program.status === 'draft' ? 'draft' : 'active',
    revision: Math.max(0, Number(program.revision || 0)),
    trainingDayCount: trainingDays.length,
    exerciseCount: trainingDays.reduce((total, day) => total + (Array.isArray(day?.exercises) ? day.exercises.length : 0), 0),
    trainingDays: trainingDays.slice(0, 7).map((day, dayIndex) => ({
      id: String(day?.id || `day-${dayIndex + 1}`).slice(0, 100),
      title: String(day?.title || `Buổi ${dayIndex + 1}`).slice(0, 120),
      focusMuscles: (Array.isArray(day?.focusMuscles) ? day.focusMuscles : []).filter((item) => typeof item === 'string').slice(0, 8),
      notes: typeof day?.notes === 'string' ? day.notes.slice(0, 600) : '',
      exercises: (Array.isArray(day?.exercises) ? day.exercises : []).slice(0, 20).map((exercise, exerciseIndex) => ({
        id: String(exercise?.id || `exercise-${exerciseIndex + 1}`).slice(0, 100),
        nameVi: String(exercise?.nameVi || exercise?.name || 'Bài tập Aura').slice(0, 160),
        targetMuscles: (Array.isArray(exercise?.targetMuscles) ? exercise.targetMuscles : []).filter((item) => typeof item === 'string').slice(0, 8),
        secondaryMuscles: (Array.isArray(exercise?.secondaryMuscles) ? exercise.secondaryMuscles : []).filter((item) => typeof item === 'string').slice(0, 8),
        sets: Math.max(1, Number(exercise?.sets || 1)),
        repMinimum: Math.max(0, Number(exercise?.repMinimum || 0)),
        repMaximum: Math.max(0, Number(exercise?.repMaximum || 0)),
        targetWeightKg: Math.max(0, Number(exercise?.targetWeightKg || 0)),
        targetRpe: Math.max(0, Number(exercise?.targetRpe || 0)),
        restSeconds: Math.max(0, Number(exercise?.restSeconds || 0)),
        notes: typeof exercise?.notes === 'string' ? exercise.notes.slice(0, 500) : '',
      })),
    })),
    updatedAt: program.updatedAt || null,
  }
}

function scheduleConfig(value = {}) {
  const workingDays = Array.isArray(value.workingDays)
    ? value.workingDays.filter((day) => DEFAULT_WORKING_DAYS.includes(day))
    : []
  const workingHours = Array.isArray(value.workingHours)
    ? value.workingHours.filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
    : []
  return {
    workingDays: workingDays.length ? [...new Set(workingDays)] : DEFAULT_WORKING_DAYS,
    workingHours: workingHours.length ? [...new Set(workingHours)].sort((left, right) => left - right) : DEFAULT_WORKING_HOURS,
    ...ptOperationsPolicySnapshot(value),
  }
}

function sessionHour(sessionId, value) {
  if (Number.isInteger(value) && value >= 0 && value <= 23) return value
  const parsed = Number(String(sessionId || '').split('-')[1])
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null
}

function nextDateKey(value) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) return ''
  return new Date(parsed + 86400000).toISOString().slice(0, 10)
}

function addDateDays(value, amount) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) return ''
  return new Date(parsed + amount * 86400000).toISOString().slice(0, 10)
}

function dayCodeForDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  const weekday = parsed.getUTCDay()
  return weekday === 0 ? 'CN' : `T${weekday + 1}`
}

function activeSessionStatus(value) {
  return ['scheduled', 'rescheduled'].includes(String(value || '').toLowerCase())
}

function sessionStartMillis(session, sessionId = '') {
  const date = storedDateKey(session?.date)
  const parsedHour = sessionHour(sessionId, session?.hour)
  if (!date || parsedHour === null) return Number.NaN
  return Date.parse(`${date}T${String(parsedHour).padStart(2, '0')}:00:00+07:00`)
}

function pauseCoversDate(contract, targetDate) {
  return Array.isArray(contract?.pausePeriods) && contract.pausePeriods.some((period) => {
    const start = storedDateKey(period?.startDate)
    const end = storedDateKey(period?.endDate) || start
    return Boolean(start && end && targetDate >= start && targetDate <= end)
  })
}

function normalizedAvailabilitySlots(value, config, strict = true) {
  if (!Array.isArray(value) || value.length > 100) {
    if (strict) throw new HttpsError('invalid-argument', 'Ma trận thời gian rảnh không hợp lệ.')
    return []
  }
  const allowed = new Set(config.workingDays.flatMap((day) => config.workingHours.map((hour) => `${day}-${hour}`)))
  const candidates = value.map((slot) => typeof slot === 'string' ? slot.trim() : '')
  if (strict && candidates.some((slot) => !slot || slot.length > 12 || !allowed.has(slot))) {
    throw new HttpsError('invalid-argument', 'Khung giờ rảnh nằm ngoài lịch hoạt động.')
  }
  const slots = [...new Set(candidates.filter((slot) => slot && slot.length <= 12 && allowed.has(slot)))]
  const dayOrder = new Map(config.workingDays.map((day, index) => [day, index]))
  return slots.sort((left, right) => {
    const [leftDay, leftHour] = left.split('-')
    const [rightDay, rightHour] = right.split('-')
    return ((dayOrder.get(leftDay) ?? 99) - (dayOrder.get(rightDay) ?? 99)) || Number(leftHour) - Number(rightHour)
  })
}

async function studentActor(request, db) {
  let actor
  try {
    actor = await trustedAccessContext(request, db)
  } catch (error) {
    if (error?.code === 'permission-denied') {
      const accessSyncRequired = String(error?.message || '').includes('chưa đồng bộ')
      throw new HttpsError('permission-denied', error.message, {
        issueCode: accessSyncRequired ? 'ACCESS_SYNC_REQUIRED' : 'ACCESS_DENIED',
        action: accessSyncRequired ? 'refresh_session_or_contact_admin' : 'contact_admin',
      })
    }
    throw error
  }
  if (!['student', 'staff'].includes(actor.accessRole)) {
    throw new HttpsError('permission-denied', 'Lịch cá nhân chỉ dành cho học viên hoặc Staff có hồ sơ học viên được liên kết.', {
      issueCode: 'STUDENT_ROLE_REQUIRED',
      action: 'contact_admin',
    })
  }
  return actor
}

async function studentProfileForActor(db, actor) {
  const crmProfileId = typeof actor.legacyStaffId === 'string' && actor.legacyStaffId !== actor.uid
    ? actor.legacyStaffId
    : ''
  const candidates = [
    ...(crmProfileId ? [{ id: crmProfileId, source: 'crm_profile_id' }] : []),
    { id: actor.uid, source: 'auth_uid' },
  ]
  const uniqueCandidates = candidates.filter((candidate, index) => candidates.findIndex((item) => item.id === candidate.id) === index)
  const snapshots = uniqueCandidates.length
    ? await db.getAll(...uniqueCandidates.map((candidate) => db.doc(`students/${candidate.id}`)))
    : []
  const snapshotIndex = snapshots.findIndex((item) => item.exists)
  if (snapshotIndex < 0) return { profile: null, crmProfileIdConfigured: Boolean(crmProfileId) }
  const snapshot = snapshots[snapshotIndex]
  return {
    profile: { id: snapshot.id, reference: snapshot.ref, value: snapshot.data() },
    linkSource: uniqueCandidates[snapshotIndex].source,
    crmProfileIdConfigured: Boolean(crmProfileId),
  }
}

async function assertPortalRollout(db, actor, portal) {
  if (['admin', 'super_admin'].includes(actor.accessRole)) return
  const snapshot = await db.doc('system/feature_flags').get()
  // Capability + branch scope remain the authorization boundary. The optional
  // flag is an emergency kill switch, not a hidden prerequisite: a missing
  // config document must never make a valid Staff page fail with HTTP 400.
  if (!snapshot.exists) return
  const flags = snapshot.data() || {}
  const enabled = portal === 'trainer' ? flags.trainerPortalEnabled !== false : flags.salesPortalEnabled !== false
  const canary = Array.isArray(flags.trainerSalesCanaryUids) && flags.trainerSalesCanaryUids.includes(actor.uid)
  if (!enabled && !canary) throw new HttpsError('failed-precondition', 'Portal đang được mở theo nhóm canary. Tài khoản của bạn chưa được kích hoạt.')
}

async function trainerActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  if (!['staff', 'admin', 'super_admin'].includes(actor.accessRole)) {
    throw new HttpsError('permission-denied', 'Trang làm việc HLV chỉ dành cho tài khoản nhân viên đang hoạt động.')
  }
  return actor
}

async function trainerProfileForActor(db, actor) {
  const candidates = [...new Set([actor.legacyStaffId, actor.uid].filter((value) => typeof value === 'string' && value))]
  const snapshots = candidates.length ? await db.getAll(...candidates.map((id) => db.doc(`trainers/${id}`))) : []
  const profile = snapshots.find((snapshot) => snapshot.exists)
  if (!profile || ['inactive', 'archived', 'deleted'].includes(String(profile.data()?.status || '').toLowerCase())) {
    throw new HttpsError('not-found', 'Tài khoản chưa được liên kết với hồ sơ PT đang hoạt động.')
  }
  return { id: profile.id, reference: profile.ref, value: profile.data() }
}

async function salesActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  await assertPortalRollout(db, actor, 'sales')
  return actor
}

function trainingContractAssignedTo(contract, actor) {
  const ids = new Set([actor.uid, actor.legacyStaffId].filter(Boolean))
  return ids.has(contract.trainerId)
    || (Array.isArray(contract.trainerIds) && contract.trainerIds.some((id) => ids.has(id)))
}

function nutritionContractAssignedTo(contract, actor) {
  const ids = new Set([actor.uid, actor.legacyStaffId].filter(Boolean))
  return Array.isArray(contract.nutritionPTIds) && contract.nutritionPTIds.some((id) => ids.has(id))
}

async function assignedContracts(db, actor, relation = 'training', limit = 200) {
  const actorIds = [...new Set([actor.uid, actor.legacyStaffId].filter(Boolean))]
  const snapshots = []
  for (const actorId of actorIds) {
    if (relation === 'nutrition') {
      snapshots.push(await db.collection('contracts').where('nutritionPTIds', 'array-contains', actorId).limit(limit).get())
    } else {
      snapshots.push(await db.collection('contracts').where('trainerId', '==', actorId).limit(limit).get())
      snapshots.push(await db.collection('contracts').where('trainerIds', 'array-contains', actorId).limit(limit).get())
    }
  }
  const result = new Map()
  snapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => result.set(doc.id, { id: doc.id, ...doc.data() })))
  const owns = relation === 'nutrition' ? nutritionContractAssignedTo : trainingContractAssignedTo
  return [...result.values()].filter((contract) => owns(contract, actor)).slice(0, limit)
}

function datesInAvailabilityWeek(weekId) {
  const start = Date.parse(`${weekId}T00:00:00.000Z`)
  return DEFAULT_WORKING_DAYS.map((day, index) => ({ day, date: new Date(start + index * 86400000).toISOString().slice(0, 10) }))
}

function normalizedTrainerOffDates(value, weekId) {
  const allowed = new Set(datesInAvailabilityWeek(weekId).map((item) => item.date))
  return [...new Set((Array.isArray(value) ? value : []).map(storedDateKey).filter((date) => allowed.has(date)))].sort()
}

function trainerSlotsWithoutOffDates(slots, offDates, weekId) {
  const offDays = new Set(datesInAvailabilityWeek(weekId).filter((item) => offDates.includes(item.date)).map((item) => item.day))
  return slots.filter((slot) => !offDays.has(String(slot).split('-')[0]))
}

async function sessionsForContracts(db, contractIds = []) {
  const ids = [...new Set(contractIds.filter(Boolean))]
  const snapshots = []
  for (let index = 0; index < ids.length; index += 30) {
    snapshots.push(db.collection('sessions').where('contractId', 'in', ids.slice(index, index + 30)).get())
  }
  const results = await Promise.all(snapshots)
  const byContract = new Map(ids.map((id) => [id, []]))
  results.forEach((snapshot) => snapshot.docs.forEach((document) => {
    const value = { id: document.id, ...document.data() }
    if (!byContract.has(value.contractId)) return
    byContract.get(value.contractId).push(value)
  }))
  return byContract
}

async function salesQuotesForActor(db, actor, limit) {
  const quoteQueries = [
    db.collection('quotes').where('assignedSalesId', '==', actor.uid).limit(limit).get(),
    ...actor.branchIds.map((branchId) => db.collection('quotes').where('branchId', '==', branchId).limit(limit).get()),
  ]
  const snapshots = await Promise.all(quoteQueries)
  const quotes = new Map()
  snapshots.forEach((snapshot) => snapshot.docs.forEach((document) => {
    const quote = document.data()
    if (quote.assignedSalesId === actor.uid || actor.branchIds.includes(quote.branchId)) {
      quotes.set(document.id, serialize({ id: document.id, ...quote }))
    }
  }))
  return [...quotes.values()].slice(0, limit)
}

async function salesCatalogForActor(db, actor) {
  const [branchSnapshots, packageSnapshot] = await Promise.all([
    actor.branchIds.length ? db.getAll(...actor.branchIds.map((id) => db.doc(`branches/${id}`))) : [],
    db.collection('packages').limit(100).get(),
  ])
  const branches = branchSnapshots
    .filter((item) => item.exists)
    .map((item) => ({ id: item.id, name: item.data().name || item.id }))
  const packages = packageSnapshot.docs
    .filter((item) => item.data().status !== 'inactive')
    .map((item) => ({ id: item.id, name: item.data().name || item.id, price: Number(item.data().price || 0), branchId: item.data().branchId || '' }))
    .filter((item) => !item.branchId || actor.branchIds.includes(item.branchId))
  return { branches, packages }
}

async function coachWorkspaceScopeForActor(db, actor) {
  const actorIds = [...new Set([actor.uid, actor.legacyStaffId].filter(Boolean))]
  const [trainingContracts, nutritionContracts, sessionSnapshots, requestSnapshots] = await Promise.all([
    assignedContracts(db, actor, 'training', 300),
    assignedContracts(db, actor, 'nutrition', 300),
    Promise.all(actorIds.map((actorId) => db.collection('sessions').where('trainerId', '==', actorId).limit(200).get())),
    Promise.all(actorIds.map((actorId) => db.collection('sessionRequests').where('trainerId', '==', actorId).limit(100).get())),
  ])
  const today = currentDateKey()
  const activeTraining = trainingContracts.filter((contract) => isEffectiveStaffContract(contract, today))
  const activeNutrition = nutritionContracts.filter((contract) => isEffectiveStaffContract(contract, today))
  const teachingSessions = new Map()
  sessionSnapshots.forEach((snapshot) => snapshot.docs.forEach((document) => teachingSessions.set(document.id, document.data())))
  const pendingRequests = new Map()
  requestSnapshots.forEach((snapshot) => snapshot.docs.forEach((document) => {
    const value = document.data() || {}
    if (value.requestedBy === 'trainer' && value.status === 'pending') pendingRequests.set(document.id, value)
  }))
  const trainingStudentIds = new Set(activeTraining.map((contract) => contract.studentId).filter(Boolean))
  const nutritionStudentIds = new Set(activeNutrition.map((contract) => contract.studentId).filter(Boolean))
  const branchRosterEnabled = actor.accessRole === 'staff'
    && Array.isArray(actor.positions)
    && actor.positions.includes('trainer_pt')
    && Array.isArray(actor.branchIds)
    && actor.branchIds.length > 0
  const actorAssignmentIds = [actor.uid, actor.legacyStaffId].filter(Boolean)
  const primaryStudentIds = new Set(activeTraining.filter((contract) => {
    const trainerIds = Array.isArray(contract.trainerIds) ? contract.trainerIds : []
    return actorAssignmentIds.some((id) => contract.trainerId === id || trainerIds[0] === id)
  }).map((contract) => contract.studentId).filter(Boolean))
  const secondaryStudentIds = new Set(activeTraining.filter((contract) => {
    const trainerIds = Array.isArray(contract.trainerIds) ? contract.trainerIds.slice(1) : []
    return actorAssignmentIds.some((id) => trainerIds.includes(id))
  }).map((contract) => contract.studentId).filter((studentId) => studentId && !primaryStudentIds.has(studentId)))
  const hasTeachingWork = trainingStudentIds.size > 0 || teachingSessions.size > 0
  return {
    schemaVersion: 1,
    source: 'pt_contract_assignments',
    staffId: actor.legacyStaffId || actor.uid,
    tabs: {
      students: trainingStudentIds.size > 0 || branchRosterEnabled,
      schedule: hasTeachingWork,
      requests: hasTeachingWork,
      nutrition: nutritionStudentIds.size > 0,
    },
    counts: {
      primaryStudents: primaryStudentIds.size,
      secondaryStudents: secondaryStudentIds.size,
      nutritionStudents: nutritionStudentIds.size,
      teachingSessions: teachingSessions.size,
      pendingRequests: pendingRequests.size,
    },
    branchIds: Array.isArray(actor.branchIds) ? actor.branchIds.slice(0, 20) : [],
  }
}

async function assignedStudentsForActor(db, actor, limit) {
  const candidateLimit = Math.min(1000, Math.max(300, limit * 3))
  const assigned = await assignedContracts(db, actor, 'training', candidateLimit)
  // A PT sees eligible learners from every branch in their access scope,
  // including learners who are not assigned to that PT. Scheduled sessions
  // remain a separate access path and are merged by the workspace loader, so
  // a cross-branch learner can still appear when this PT teaches the session.
  const branchRosterEnabled = actor.accessRole === 'staff'
    && Array.isArray(actor.positions)
    && actor.positions.includes('trainer_pt')
    && Array.isArray(actor.branchIds)
    && actor.branchIds.length > 0
  const branchIds = branchRosterEnabled ? [...new Set(actor.branchIds)].slice(0, 20) : []
  const branchStudentSnapshots = branchIds.length
    ? (await Promise.all(branchIds.map((branchId) => db.collection('students')
      .where('branchId', '==', branchId)
      .limit(candidateLimit)
      .get()))).flatMap((snapshot) => snapshot.docs)
    : []
  const branchStudentMap = new Map(branchStudentSnapshots.map((snapshot) => [snapshot.id, snapshot]))
  const branchStudentIds = [...branchStudentMap.keys()]
  const contractChunks = []
  for (let offset = 0; offset < branchStudentIds.length; offset += 30) {
    contractChunks.push(branchStudentIds.slice(offset, offset + 30))
  }
  const branchContractSnapshots = contractChunks.length
    ? (await Promise.all(contractChunks.flatMap((chunk) => [
      db.collection('contracts').where('studentId', 'in', chunk).limit(1000).get(),
      db.collection('contracts').where('crmProfileId', 'in', chunk).limit(1000).get(),
    ]))).flatMap((snapshot) => snapshot.docs)
    : []
  const rosterContracts = [...new Map(branchContractSnapshots.map((document) => [document.id, { id: document.id, ...document.data() }])).values()]
  const allCandidateContracts = [...new Map([...assigned, ...rosterContracts]
    .map((contract) => [contract.id, { ...contract, studentId: contract.studentId || contract.crmProfileId || '' }])).values()]
  const today = currentDateKey()
  const datedContracts = allCandidateContracts.filter((contract) => {
    const projection = studentContractProjection(contract.id, contract, today, [], false)
    return effectiveContractStatus(contract, today) === 'active'
      && projection.startDate && projection.endDate
      && !projection.pausedToday
  })
  const sessionsByContract = await sessionsForContracts(db, datedContracts.map((contract) => contract.id))
  const projectedContracts = datedContracts.map((contract) => ({
    ...contract,
    usage: studentContractProjection(contract.id, contract, today, sessionsByContract.get(contract.id) || [], true),
  }))
  const contracts = projectedContracts.filter((contract) => contract.usage.schedulableToday)
  // The branch roster is contract-scoped: an active student profile alone is
  // not enough to appear here. Only contracts that are effective today,
  // unpaused and have remaining sessions can be used to create a new session.
  // Assigned contracts from another branch stay in the same set so a PT keeps
  // seeing their own learners even when the learner trains elsewhere.
  const eligibleStudentIds = contracts.map((item) => item.studentId).filter(Boolean)
  const allStudentIds = [...new Set(eligibleStudentIds)]
  const studentIds = allStudentIds.slice(0, limit)
  const visibleStudentIds = new Set(studentIds)
  const visibleContracts = projectedContracts.filter((contract) => visibleStudentIds.has(contract.studentId)
    && contract.usage.schedulableToday)
  const visibleBranchIds = [...new Set([...actor.branchIds, ...contracts.map((item) => item.branchId).filter(Boolean)])]
  const [studentSnapshots, branchSnapshots] = await Promise.all([
    studentIds.length ? db.getAll(...studentIds.map((id) => db.doc(`students/${id}`))) : [],
    visibleBranchIds.length ? db.getAll(...visibleBranchIds.map((id) => db.doc(`branches/${id}`))) : [],
  ])
  const students = studentSnapshots
    .filter((snapshot) => snapshot.exists
      && !['inactive', 'deleted', 'archived'].includes(String(snapshot.data()?.status || '').toLowerCase()))
    .map((snapshot) => {
    const student = snapshot.data()
    const studentContracts = visibleContracts
      .filter((item) => item.studentId === snapshot.id)
      .sort((left, right) => {
        const actorIds = [actor.uid, actor.legacyStaffId].filter(Boolean)
        const leftTrainerIds = Array.isArray(left.trainerIds) ? left.trainerIds : []
        const rightTrainerIds = Array.isArray(right.trainerIds) ? right.trainerIds : []
        const leftPrimary = actorIds.some((id) => left.trainerId === id || leftTrainerIds[0] === id)
        const rightPrimary = actorIds.some((id) => right.trainerId === id || rightTrainerIds[0] === id)
        return Number(rightPrimary) - Number(leftPrimary)
          || storedDateKey(left.endDate).localeCompare(storedDateKey(right.endDate))
          || left.id.localeCompare(right.id)
    })
    const contract = studentContracts[0]
    if (!contract) return null
    const actorIds = [actor.uid, actor.legacyStaffId].filter(Boolean)
    const contractTrainerIds = Array.isArray(contract?.trainerIds) ? contract.trainerIds : []
    const assigned = Boolean(contract && actorIds.some((id) => contract.trainerId === id || contractTrainerIds.includes(id)))
    return serialize({
      id: snapshot.id, name: student.name || 'Học viên Aura', phone: student.phone || '', email: student.email || '',
      branchId: student.branchId || contract?.branchId || '', status: student.status || 'active', sessionsPerWeek: student.sessionsPerWeek || 0,
      assignmentRole: assigned
        ? actorIds.some((id) => contract?.trainerId === id || contractTrainerIds[0] === id) ? 'primary' : 'secondary'
        : 'branch',
      contract: contract ? {
        id: contract.id,
        status: contract.status,
        startDate: storedDateKey(contract.startDate),
        endDate: storedDateKey(contract.endDate),
        totalSessions: contract.usage.totalSessions,
        usedSessions: contract.usage.usedSessions,
        remainingSessions: contract.usage.remainingSessions,
        chargedSessions: contract.usage.chargedSessions,
        historySessions: contract.usage.historySessions,
        storedUsedSessions: contract.usage.storedUsedSessions,
        formulaVersion: contract.usage.formulaVersion,
        reconciliationStatus: contract.usage.reconciliationStatus,
      } : null,
    })
  }).filter(Boolean)
  const branches = branchSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({ id: snapshot.id, name: snapshot.data().name || snapshot.id }))
  return { schemaVersion: 3, students, branches, hasMore: allStudentIds.length > limit }
}

async function trainerScheduleForActor(db, actor, from, to, limit) {
  const actorIds = [...new Set([actor.uid, actor.legacyStaffId].filter(Boolean))]
  const [snapshots, requestSnapshots] = await Promise.all([
    Promise.all(actorIds.map((actorId) => db.collection('sessions').where('trainerId', '==', actorId).where('date', '>=', from).where('date', '<=', to).limit(limit).get())),
    Promise.all(actorIds.map((actorId) => db.collection('sessionRequests').where('trainerId', '==', actorId).limit(100).get())),
  ])
  const sessions = new Map()
  snapshots.forEach((snapshot) => snapshot.docs.forEach((document) => sessions.set(document.id, serialize({ id: document.id, ...document.data(), timeZone: TIME_ZONE }))))
  const studentIds = [...new Set([...sessions.values()].map((session) => session.studentId).filter(Boolean))]
  const contractIds = [...new Set([...sessions.values()].map((session) => session.contractId).filter(Boolean))]
  const [studentSnapshots, contractSnapshots] = await Promise.all([
    studentIds.length ? db.getAll(...studentIds.map((id) => db.doc(`students/${id}`))) : [],
    contractIds.length ? db.getAll(...contractIds.map((id) => db.doc(`contracts/${id}`))) : [],
  ])
  const contracts = new Map(contractSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, { id: snapshot.id, ...snapshot.data() }]))
  const today = currentDateKey()
  const studentProfiles = new Map(studentSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => {
    const value = snapshot.data()
    return [snapshot.id, {
      name: value.name || 'Học viên Aura', phone: value.phone || '', email: value.email || '', branchId: value.branchId || '',
    }]
  }))
  const requests = new Map()
  requestSnapshots.forEach((snapshot) => snapshot.docs.forEach((document) => {
    const value = document.data()
    if (value.requestedBy === 'trainer') requests.set(document.id, serialize({
      id: document.id,
      sessionId: value.sessionId,
      studentId: value.studentId,
      type: value.type,
      status: value.status,
      originalDate: value.originalDate,
      originalHour: value.originalHour,
      newDate: value.newDate || null,
      newHour: value.newHour ?? null,
      makeupSession: value.makeupSession === true,
      makeupSourceSessionId: value.makeupSourceSessionId || value.sessionId || null,
      makeupMode: ['standalone_shift', 'paired_existing_shift'].includes(value.makeupMode) ? value.makeupMode : null,
      commissionEligible: value.commissionEligible !== false,
      preAbsenceSourceSessionId: value.preAbsenceSourceSessionId || null,
      releasedSourceSessionId: value.releasedSourceSessionId || null,
      pairsExistingSession: value.pairsExistingSession === true,
      reason: value.reason || '',
      submittedAtIso: value.submittedAtIso || null,
      decidedAtIso: value.decidedAtIso || null,
    }))
  }))
  return {
    schemaVersion: 2,
    sessions: [...sessions.values()].map((session) => {
      const student = studentProfiles.get(session.studentId)
      const contract = contracts.get(session.contractId)
      // A session is valid against the contract on the date it is scheduled,
      // not against today's date. This keeps future renewals and historical
      // sessions visible to Staff even when the contract changes later.
      const contractEffective = Boolean(contract && contractCoversDate(contract, session.date || today))
      const contractSchedulable = Boolean(contract && isContractSchedulableOn(contract, session.date || today))
      return {
        ...session,
        studentName: student?.name || 'Học viên Aura',
        studentPhone: student?.phone || '',
        studentEmail: student?.email || '',
        studentBranchId: student?.branchId || session.branchId || '',
        advanceAbsenceNotice: session.advanceAbsenceNotice && typeof session.advanceAbsenceNotice === 'object'
          ? {
              status: session.advanceAbsenceNotice.status === 'reported' ? 'reported' : 'none',
              reason: typeof session.advanceAbsenceNotice.reason === 'string' ? session.advanceAbsenceNotice.reason.slice(0, 500) : '',
              note: typeof session.advanceAbsenceNotice.note === 'string' ? session.advanceAbsenceNotice.note.slice(0, 500) : '',
              reportedAt: session.advanceAbsenceNotice.reportedAt || null,
              replacementLocked: session.advanceAbsenceNotice.replacementLocked === true,
              replacementRequestId: session.advanceAbsenceNotice.replacementRequestId || null,
              replacementSessionId: session.advanceAbsenceNotice.replacementSessionId || null,
            }
          : null,
        contractEffective,
        contractSchedulable,
        contract: contractEffective ? {
          id: contract.id,
          status: contract.status || 'active',
          startDate: storedDateKey(contract.startDate),
          endDate: storedDateKey(contract.endDate),
          totalSessions: Math.max(0, Number(contract.totalSessions || 0)),
          usedSessions: Math.max(0, Number(contract.usedSessions || 0)),
        } : null,
      }
    }).sort((a, b) => `${a.date}-${a.hour || 0}`.localeCompare(`${b.date}-${b.hour || 0}`)),
    requests: [...requests.values()].sort((a, b) => String(b.submittedAtIso || b.createdAt || '').localeCompare(String(a.submittedAtIso || a.createdAt || ''))),
  }
}

function createPtOperationsV2Functions({ db, onCall }) {
  // Staff pages issue several Firestore-bound reads during the first render.
  // A concurrency of one made harmless navigation bursts exhaust all six
  // instances and the browser surfaced a generic "service busy" message.
  // Keep the fleet bounded, but let each warm instance serve concurrent I/O.
  const staffCall = (handler) => onCall({ cpu: 1, concurrency: 24, maxInstances: 6, invoker: 'public' }, handler)

  const getMyCoachWorkspaceScope = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    return coachWorkspaceScopeForActor(db, actor)
  })

  const getMyTrainerAvailability = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    requireCapability(actor, 'pt.availability.self.manage')
    const profile = await trainerProfileForActor(db, actor)
    const requestedWeekId = request.data?.weekId ? availabilityWeekId(request.data.weekId) : null
    const weeklyReference = requestedWeekId ? db.doc(`trainerAvailability/${profile.id}_${requestedWeekId}`) : null
    const [configSnapshot, weeklySnapshot] = await Promise.all([
      db.doc('settings/scheduleConfig').get(),
      weeklyReference ? weeklyReference.get() : Promise.resolve(null),
    ])
    const config = scheduleConfig(configSnapshot.data())
    const baseSlots = normalizedAvailabilitySlots(profile.value.availableSlots || [], config, false)
    const weeklyValue = weeklySnapshot?.exists ? weeklySnapshot.data() : null
    const offDates = requestedWeekId ? normalizedTrainerOffDates(weeklyValue?.offDates, requestedWeekId) : []
    const weeklySlots = requestedWeekId && weeklyValue
      ? trainerSlotsWithoutOffDates(normalizedAvailabilitySlots(weeklyValue.slots || [], config, false), offDates, requestedWeekId)
      : null
    const slots = weeklySlots || baseSlots
    const cutoff = requestedWeekId ? availabilityCutoff(requestedWeekId, config) : null
    const reopenedUntil = weeklyValue?.reopenedUntil?.toDate?.() || (weeklyValue?.reopenedUntil ? new Date(weeklyValue.reopenedUntil) : null)
    const locked = Boolean(cutoff && Date.now() >= cutoff.getTime() && (!reopenedUntil || reopenedUntil.getTime() <= Date.now()))
    return serialize({
      schemaVersion: 2,
      trainerId: profile.id,
      trainerName: profile.value.name || 'HLV Aura',
      branchId: profile.value.branchId || actor.branchIds[0] || '',
      availableSlots: slots,
      baseAvailableSlots: baseSlots,
      weekId: requestedWeekId,
      weeklyOverride: Boolean(weeklyValue),
      offDates,
      locked,
      cutoffAt: cutoff?.toISOString() || null,
      source: weeklyValue ? 'weekly' : 'recurring',
      availabilityMode: profile.value.availabilityMode === 'unrestricted'
        ? 'unrestricted'
        : slots.length ? 'configured' : 'unconfigured',
      // A new weekly document starts at revision zero even when the recurring
      // profile has already been edited many times. The two revision streams
      // are intentionally independent.
      availabilityRevision: requestedWeekId
        ? Number(weeklyValue?.revision || 0)
        : Number(profile.value.availabilityRevision || 0),
      updatedAt: weeklyValue?.updatedAt || profile.value.availabilityUpdatedAt || null,
      scheduleConfig: config,
    })
  })

  const saveMyTrainerAvailability = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    requireCapability(actor, 'pt.availability.self.manage')
    const profile = await trainerProfileForActor(db, actor)
    const configSnapshot = await db.doc('settings/scheduleConfig').get()
    const config = scheduleConfig(configSnapshot.data())
    const requestedWeekId = request.data?.weekId ? availabilityWeekId(request.data.weekId) : null
    const offDates = requestedWeekId ? normalizedTrainerOffDates(request.data?.offDates, requestedWeekId) : []
    const normalizedSlots = normalizedAvailabilitySlots(request.data?.availableSlots, config, requestedWeekId ? false : true)
    const slots = requestedWeekId ? trainerSlotsWithoutOffDates(normalizedSlots, offDates, requestedWeekId) : normalizedSlots
    if (!slots.length && !offDates.length) throw new HttpsError('failed-precondition', 'Hãy chọn ít nhất một khung giờ rảnh hoặc đánh dấu ngày OFF.')
    const expectedRevision = integer(request.data?.expectedRevision, 0, 0, 1000000)
    if (requestedWeekId) {
      const reference = db.doc(`trainerAvailability/${profile.id}_${requestedWeekId}`)
      const cutoffAt = availabilityCutoff(requestedWeekId, config)
      const submittedAtIso = new Date().toISOString()
      const result = await db.runTransaction(async (transaction) => {
        const [current, currentProfile] = await Promise.all([transaction.get(reference), transaction.get(profile.reference)])
        if (!currentProfile.exists) throw new HttpsError('not-found', 'Không tìm thấy hồ sơ PT.')
        const currentValue = current.data() || {}
        const reopenedUntil = currentValue.reopenedUntil?.toDate?.() || (currentValue.reopenedUntil ? new Date(currentValue.reopenedUntil) : null)
        if (Date.now() >= cutoffAt.getTime() && (!reopenedUntil || reopenedUntil.getTime() <= Date.now())) {
          throw new HttpsError('failed-precondition', 'Lịch rảnh của tuần này đã khóa. Hãy gửi quản lý mở lại nếu cần điều chỉnh.', { issueCode: 'TRAINER_AVAILABILITY_LOCKED', cutoffAt: cutoffAt.toISOString() })
        }
        const revision = Number(currentValue.revision || 0)
        if (revision !== expectedRevision) throw new HttpsError('aborted', 'Lịch rảnh tuần đã thay đổi ở thiết bị khác. Hãy tải lại.', { issueCode: 'REVISION_CONFLICT', currentRevision: revision })
        const next = {
          schemaVersion: 1,
          trainerId: profile.id,
          accountUid: actor.uid,
          branchId: currentProfile.data().branchId || actor.branchIds[0] || '',
          weekId: requestedWeekId,
          slots,
          offDates,
          status: 'submitted',
          revision: revision + 1,
          submittedAt: currentValue.submittedAt || FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
        }
        if (current.exists) transaction.update(reference, next)
        else transaction.create(reference, { ...next, createdAt: FieldValue.serverTimestamp() })
        transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
          schemaVersion: 2,
          action: 'trainer_weekly_availability.updated',
          actorUid: actor.uid,
          trainerId: profile.id,
          weekId: requestedWeekId,
          beforeSlotCount: Array.isArray(currentValue.slots) ? currentValue.slots.length : 0,
          afterSlotCount: slots.length,
          offDates,
          previousRevision: revision,
          nextRevision: revision + 1,
          createdAt: FieldValue.serverTimestamp(),
        })
        return revision + 1
      })
      return {
        schemaVersion: 2,
        weekId: requestedWeekId,
        availableSlots: slots,
        baseAvailableSlots: normalizedAvailabilitySlots(profile.value.availableSlots || [], config, false),
        offDates,
        source: 'weekly',
        weeklyOverride: true,
        locked: false,
        cutoffAt: cutoffAt.toISOString(),
        availabilityMode: slots.length ? 'configured' : 'unconfigured',
        availabilityRevision: result,
        updatedAt: submittedAtIso,
      }
    }
    const nextRevision = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(profile.reference)
      if (!current.exists) throw new HttpsError('not-found', 'Không tìm thấy hồ sơ PT.')
      const revision = Number(current.data()?.availabilityRevision || 0)
      if (revision !== expectedRevision) {
        throw new HttpsError('aborted', 'Lịch rảnh đã được cập nhật ở thiết bị khác. Hãy tải lại.', {
          issueCode: 'REVISION_CONFLICT', currentRevision: revision,
        })
      }
      transaction.update(profile.reference, {
        availableSlots: slots,
        availabilityMode: 'configured',
        availabilityRevision: revision + 1,
        availabilityUpdatedBy: actor.uid,
        availabilityUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        schemaVersion: 2,
        action: 'trainer_availability.updated',
        actorUid: actor.uid,
        trainerId: profile.id,
        beforeSlotCount: Array.isArray(current.data()?.availableSlots) ? current.data().availableSlots.length : 0,
        afterSlotCount: slots.length,
        previousRevision: revision,
        nextRevision: revision + 1,
        createdAt: FieldValue.serverTimestamp(),
      })
      return revision + 1
    })
    return { schemaVersion: 2, weekId: null, availableSlots: slots, baseAvailableSlots: slots, offDates: [], source: 'recurring', weeklyOverride: false, locked: false, cutoffAt: null, availabilityMode: 'configured', availabilityRevision: nextRevision, updatedAt: new Date().toISOString() }
  })

  const listMyStudentPtSchedule = staffCall(async (request) => {
    const actor = await studentActor(request, db)
    const from = dateKey(request.data?.from, 'Ngày bắt đầu')
    const to = dateKey(request.data?.to, 'Ngày kết thúc')
    const requestedAvailabilityWeekId = availabilityWeekId(request.data?.availabilityWeekId)
    if (from > to || Date.parse(`${to}T00:00:00+07:00`) - Date.parse(`${from}T00:00:00+07:00`) > 366 * 86400000) {
      throw new HttpsError('invalid-argument', 'Khoảng lịch học viên tối đa là 366 ngày.')
    }
    const profileResolution = await studentProfileForActor(db, actor)
    const profile = profileResolution.profile
    const configSnapshot = await db.doc('settings/scheduleConfig').get()
    const config = scheduleConfig(configSnapshot.data())
    if (!profile) {
      return {
        schemaVersion: 4,
        linked: false,
        identityLink: {
          status: 'profile_not_linked',
          source: null,
          studentId: null,
          crmProfileIdConfigured: profileResolution.crmProfileIdConfigured,
        },
        student: null,
        scheduleConfig: config,
        sessions: [],
        sessionsTruncated: false,
        contracts: [],
        contractAlerts: [],
        sessionRequests: [],
        pauseRequests: [],
      }
    }

    const availabilityReference = db.doc(`ptAvailability/${profile.id}_${requestedAvailabilityWeekId}`)
    const [sessionsSnapshot, contractsSnapshot, availabilitySnapshot, sessionRequestsSnapshot, pauseRequestsSnapshot] = await Promise.all([
      db.collection('sessions')
        .where('studentId', '==', profile.id)
        .where('date', '>=', from)
        .where('date', '<=', to)
        .orderBy('date', 'asc')
        .limit(1001)
        .get(),
      db.collection('contracts').where('studentId', '==', profile.id).limit(50).get(),
      availabilityReference.get(),
      db.collection('sessionRequests').where('studentId', '==', profile.id).limit(100).get(),
      db.collection('leaveRequests').where('studentId', '==', profile.id).limit(100).get(),
    ])
    const sessionRecords = sessionsSnapshot.docs.slice(0, 1000)
      .map((item) => {
        const session = item.data()
        const hour = sessionHour(item.id, session.hour)
        return { id: item.id, ...session, hour }
      })
      .sort((left, right) => `${left.date}-${String(left.hour ?? 99).padStart(2, '0')}-${left.id}`.localeCompare(`${right.date}-${String(right.hour ?? 99).padStart(2, '0')}-${right.id}`))
    const trainerIds = [...new Set(sessionRecords.map((item) => item.trainerId).filter(Boolean))]
    const trainerSnapshots = trainerIds.length ? await db.getAll(...trainerIds.map((id) => db.doc(`trainers/${id}`))) : []
    const trainerNames = new Map(trainerSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data().name || 'PT Aura']))
    const sessions = sessionRecords.map((session) => serialize({
      id: session.id,
      date: session.date,
      hour: session.hour,
      status: session.status || 'scheduled',
      trainerId: session.trainerId || '',
      trainerName: trainerNames.get(session.trainerId) || 'PT đã ngừng hoạt động',
      branchId: session.branchId || '',
      verifiedByStudent: session.verifiedByStudent === true,
      scheduleEntryId: session.scheduleEntryId || '',
      revision: Number(session.revision || 0),
      timeZone: TIME_ZONE,
    }))
    const today = currentDateKey()
    const rangeSessionsComplete = sessionsSnapshot.size <= 1000
    const contracts = contractsSnapshot.docs
      .map((item) => {
        const contract = item.data()
        const contractStart = storedDateKey(contract.startDate)
        const contractEnd = storedDateKey(contract.endDate)
        const usageEvidenceComplete = rangeSessionsComplete
          && Boolean(contractStart && contractEnd && from <= contractStart && to >= contractEnd)
        return studentContractProjection(
          item.id,
          contract,
          today,
          sessionRecords.filter((session) => session.contractId === item.id),
          usageEvidenceComplete,
        )
      })
      .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.id.localeCompare(right.id))
    const contractAlerts = studentContractAlerts(contracts, today)
    const sessionRequests = sessionRequestsSnapshot.docs
      .map((item) => {
        const value = item.data()
        return serialize({
          id: item.id,
          type: value.type,
          status: value.status,
          originalDate: value.originalDate,
          originalHour: value.originalHour,
          newDate: value.newDate || null,
          newHour: value.newHour ?? null,
          makeupSession: value.makeupSession === true,
          makeupSourceSessionId: value.makeupSourceSessionId || value.sessionId || null,
          makeupMode: ['standalone_shift', 'paired_existing_shift'].includes(value.makeupMode) ? value.makeupMode : null,
          commissionEligible: value.commissionEligible !== false,
          newTrainerId: value.newTrainerId || value.trainerId || null,
          priorityTier: value.priorityTier || null,
          pairsExistingSession: value.pairsExistingSession === true,
          isPrimaryTrainer: value.isPrimaryTrainer === true,
          requiresManagerApproval: value.requiresManagerApproval === true,
          weeklyScheduled: Number(value.weeklyScheduled || 0),
          weeklyTarget: Number(value.weeklyTarget || 0),
          reason: value.reason || '',
          countsTowardContract: value.countsTowardContract === true,
          expectedCountsTowardContract: value.expectedCountsTowardContract === true,
          submittedAtIso: value.submittedAtIso || null,
          decidedAtIso: value.decidedAtIso || null,
        })
      })
      .sort((left, right) => String(right.submittedAtIso || right.createdAt || '').localeCompare(String(left.submittedAtIso || left.createdAt || '')))
    const pauseRequests = pauseRequestsSnapshot.docs
      .map((item) => {
        const value = item.data()
        return serialize({
          id: item.id,
          type: value.type || 'off',
          status: value.status,
          startDate: value.startDate,
          endDate: value.endDate,
          durationDays: value.durationDays || null,
          reason: value.reason || '',
          newContractEndDate: value.newContractEndDate || null,
          submittedAtIso: value.submittedAtIso || null,
          decidedAtIso: value.decidedAtIso || null,
        })
      })
      .sort((left, right) => String(right.submittedAtIso || right.createdAt || '').localeCompare(String(left.submittedAtIso || left.createdAt || '')))
    const exactAvailability = new Map(availabilitySnapshot.exists
      ? [[profile.id, availabilitySnapshot.data()]]
      : [])
    const inheritedAvailability = await loadLatestSubmittedFallbacks(
      db,
      new Map([[profile.id, profile.value]]),
      exactAvailability,
      requestedAvailabilityWeekId,
    )
    const effectiveAvailability = effectiveStudentAvailability({
      targetWeek: requestedAvailabilityWeekId,
      exact: exactAvailability.get(profile.id),
      inherited: inheritedAvailability.get(profile.id),
      profile: profile.value,
    })
    const defaultSessionsPerWeek = contractDefaultSessionsPerWeek(
      contractsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
      profile.value,
      requestedAvailabilityWeekId,
    )
    const requestedSessions = normalizeRequestedSessions(effectiveAvailability.requestedSessions)
    const requiredSessions = requestedSessions ?? defaultSessionsPerWeek
    const storedAvailability = {
      slots: normalizedAvailabilitySlots(effectiveAvailability.slots, config, false),
      minimumSlots: Math.max(5, requiredSessions),
      requiredSessions,
      requestedSessions,
      revision: effectiveAvailability.targetRevision,
      sourceRevision: effectiveAvailability.sourceRevision,
      status: effectiveAvailability.status,
      confirmed: effectiveAvailability.confirmed,
      submittedAt: effectiveAvailability.submittedAt,
      source: effectiveAvailability.source,
      sourceWeekId: effectiveAvailability.sourceWeekId,
    }
    const availability = availabilityState(requestedAvailabilityWeekId, {
      ...storedAvailability,
      slots: normalizedAvailabilitySlots(storedAvailability.slots || [], config, false),
    }, new Date(), config)
    return {
      schemaVersion: 4,
      linked: true,
      identityLink: {
        status: 'linked',
        source: profileResolution.linkSource,
        studentId: profile.id,
        crmProfileIdConfigured: profileResolution.crmProfileIdConfigured,
      },
      student: serialize({
        id: profile.id,
        name: profile.value.name || 'Học viên Aura',
        branchId: profile.value.branchId || '',
        sessionsPerWeek: defaultSessionsPerWeek,
        defaultSessionsPerWeek,
        availableSlots: availability.slots,
        isScheduleConfirmed: availability.confirmed === true,
        availabilityRevision: availability.revision,
        availability: serialize(availability),
      }),
      scheduleConfig: config,
      sessions,
      sessionsTruncated: sessionsSnapshot.size > 1000,
      contracts: serialize(contracts),
      contractAlerts: serialize(contractAlerts),
      sessionRequests,
      pauseRequests,
    }
  })

  const saveMyStudentAvailability = staffCall(async (request) => {
    const actor = await studentActor(request, db)
    const profileResolution = await studentProfileForActor(db, actor)
    const profile = profileResolution.profile
    if (!profile) {
      throw new HttpsError('not-found', 'Tài khoản chưa được liên kết với hồ sơ học viên PT.', {
        issueCode: 'PROFILE_NOT_LINKED',
        action: 'contact_admin',
        crmProfileIdConfigured: profileResolution.crmProfileIdConfigured,
      })
    }
    const [configSnapshot, contractsSnapshot] = await Promise.all([
      db.doc('settings/scheduleConfig').get(),
      db.collection('contracts').where('studentId', '==', profile.id).limit(50).get(),
    ])
    const config = scheduleConfig(configSnapshot.data())
    const weekId = availabilityWeekId(request.data?.weekId)
    const slots = normalizedAvailabilitySlots(request.data?.availableSlots, config)
    const expectedRevision = integer(request.data?.expectedRevision, 0, 0, 1000000)
    const defaultSessionsPerWeek = contractDefaultSessionsPerWeek(
      contractsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
      profile.value,
      weekId,
    )
    const rawRequestedSessions = request.data?.requestedSessions
    const requestedSessions = normalizeRequestedSessions(rawRequestedSessions)
    if (rawRequestedSessions !== null && rawRequestedSessions !== undefined && rawRequestedSessions !== '' && requestedSessions === null) {
      throw new HttpsError('invalid-argument', 'Số buổi đăng ký mỗi tuần phải từ 1 đến 7.')
    }
    const requiredSessions = requestedSessions ?? defaultSessionsPerWeek
    const minimumSlots = Math.max(5, requiredSessions)
    const confirmBelowMinimum = request.data?.confirmBelowMinimum === true
    const submittedAtIso = new Date().toISOString()
    const cutoffAt = availabilityCutoff(weekId, config)
    if (Date.now() >= cutoffAt.getTime()) {
      throw new HttpsError('failed-precondition', 'Lịch rảnh của tuần này đã khóa theo thời hạn đăng ký đang áp dụng.', {
        issueCode: 'AVAILABILITY_LOCKED',
        action: 'contact_admin',
        cutoffAt: cutoffAt.toISOString(),
      })
    }
    if (!slots.length) {
      throw new HttpsError('failed-precondition', 'Không thể gửi lịch rảnh với 0 khung. Nếu cần nghỉ, hãy giữ lịch gần nhất và đăng ký OFF hoặc bảo lưu.', {
        issueCode: 'AVAILABILITY_EMPTY',
        action: 'create_pause_request',
      })
    }
    if (slots.length < minimumSlots && !confirmBelowMinimum) {
      throw new HttpsError('failed-precondition', `Bạn mới chọn ${slots.length}/${minimumSlots} khung. Hãy thêm ${minimumSlots - slots.length} khung để Aura có nhiều phương án xếp đủ buổi và giữ đúng PT.`, {
        issueCode: 'MINIMUM_AVAILABILITY_REQUIRED',
        action: 'confirm_below_minimum',
        selectedSlots: slots.length,
        minimumSlots,
        missingSlots: minimumSlots - slots.length,
      })
    }
    const availabilityReference = db.doc(`ptAvailability/${profile.id}_${weekId}`)
    const nextRevision = await db.runTransaction(async (transaction) => {
      const [currentProfile, currentAvailability] = await Promise.all([
        transaction.get(profile.reference),
        transaction.get(availabilityReference),
      ])
      if (!currentProfile.exists) throw new HttpsError('not-found', 'Không tìm thấy hồ sơ học viên PT.')
      const currentRevision = Number(currentAvailability.data()?.revision || 0)
      if (currentRevision !== expectedRevision) {
        throw new HttpsError('aborted', 'Lịch rảnh đã thay đổi. Hãy tải lại trước khi lưu.', {
          issueCode: 'REVISION_CONFLICT',
          action: 'reload',
          currentRevision,
        })
      }
      const next = {
        schemaVersion: 1,
        studentId: profile.id,
        accountUid: actor.uid,
        weekId,
        slots,
        requiredSessions,
        requestedSessions,
        minimumSlots,
        belowMinimumConfirmed: slots.length < minimumSlots,
        status: 'submitted',
        revision: currentRevision + 1,
        submittedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (currentAvailability.exists) transaction.update(availabilityReference, next)
      else transaction.create(availabilityReference, { ...next, createdAt: FieldValue.serverTimestamp() })
      const profilePatch = studentAvailabilityProfilePatch(currentProfile.data(), {
        weekId,
        slots,
        requiredSessions,
        requestedSessions,
        minimumSlots,
        status: 'submitted',
        revision: currentRevision + 1,
        submittedAt: submittedAtIso,
      })
      if (Object.keys(profilePatch).length) transaction.update(profile.reference, {
        ...profilePatch,
        latestAvailabilityUpdatedBy: actor.uid,
        latestAvailabilityUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        action: 'student_availability.updated',
        actorUid: actor.uid,
        studentId: profile.id,
        weekId,
        beforeSlotCount: Array.isArray(currentAvailability.data()?.slots) ? currentAvailability.data().slots.length : 0,
        afterSlotCount: slots.length,
        requestedSessions,
        belowMinimumConfirmed: slots.length < minimumSlots,
        latestFallbackAdvanced: Boolean(profilePatch.latestSubmittedAvailability),
        createdAt: FieldValue.serverTimestamp(),
      })
      return currentRevision + 1
    })
    return {
      schemaVersion: 3,
      availableSlots: slots,
      defaultSessionsPerWeek,
      availabilityRevision: nextRevision,
      isScheduleConfirmed: true,
      availability: serialize(availabilityState(weekId, {
        slots,
        minimumSlots,
        requiredSessions,
        requestedSessions,
        revision: nextRevision,
        status: 'submitted',
        submittedAt: submittedAtIso,
        confirmed: true,
        source: 'weekly',
        sourceWeekId: weekId,
      }, new Date(), config)),
    }
  })

  const listMyAssignedStudents = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    const limit = integer(request.data?.limit, 100, 1, 200)
    return assignedStudentsForActor(db, actor, limit)
  })

  const listMyTrainerSchedule = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    const from = dateKey(request.data?.from, 'Ngày bắt đầu')
    const to = dateKey(request.data?.to, 'Ngày kết thúc')
    if (from > to || Date.parse(`${to}T00:00:00+07:00`) - Date.parse(`${from}T00:00:00+07:00`) > 62 * 86400000) throw new HttpsError('invalid-argument', 'Khoảng lịch tối đa là 62 ngày.')
    const limit = integer(request.data?.limit, 300, 1, 500)
    return trainerScheduleForActor(db, actor, from, to, limit)
  })

  // Every Staff tab remains a separate page in the UI, while its initial
  // scope and page payload share one verified backend invocation/cold start.
  const getMyTrainerWorkspace = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    const section = ['students', 'schedule', 'requests'].includes(request.data?.section) ? request.data.section : 'students'
    const scopePromise = coachWorkspaceScopeForActor(db, actor)
    if (section === 'students') {
      const from = dateKey(request.data?.from, 'Ngày bắt đầu')
      const to = dateKey(request.data?.to, 'Ngày kết thúc')
      if (from > to || Date.parse(`${to}T00:00:00+07:00`) - Date.parse(`${from}T00:00:00+07:00`) > 62 * 86400000) throw new HttpsError('invalid-argument', 'Khoảng lịch tối đa là 62 ngày.')
      const requestedLimit = integer(request.data?.limit, 300, 1, 500)
      const studentLimit = Math.min(500, requestedLimit)
      const scheduleLimit = Math.max(300, requestedLimit)
      const [scope, data, schedule] = await Promise.all([
        scopePromise,
        assignedStudentsForActor(db, actor, studentLimit),
        trainerScheduleForActor(db, actor, from, to, scheduleLimit),
      ])
      const scheduleBranchIds = [...new Set(schedule.sessions
        .flatMap((session) => [session.studentBranchId, session.branchId])
        .filter(Boolean))].slice(0, 50)
      const scheduleBranchSnapshots = scheduleBranchIds.length
        ? await db.getAll(...scheduleBranchIds.map((id) => db.doc(`branches/${id}`)))
        : []
      const scheduleBranches = scheduleBranchSnapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => ({ id: snapshot.id, name: snapshot.data().name || snapshot.id }))
      const branches = [...new Map([...data.branches, ...scheduleBranches].map((branch) => [branch.id, branch])).values()]
      return {
        schemaVersion: 3,
        scope,
        students: data.students,
        branches,
        sessions: schedule.sessions,
        requests: [],
        hasMore: data.hasMore,
      }
    }
    const from = dateKey(request.data?.from, 'Ngày bắt đầu')
    const to = dateKey(request.data?.to, 'Ngày kết thúc')
    if (from > to || Date.parse(`${to}T00:00:00+07:00`) - Date.parse(`${from}T00:00:00+07:00`) > 62 * 86400000) throw new HttpsError('invalid-argument', 'Khoảng lịch tối đa là 62 ngày.')
    const limit = integer(request.data?.limit, 300, 1, 500)
    const [scope, data, roster] = await Promise.all([
      scopePromise,
      trainerScheduleForActor(db, actor, from, to, limit),
      section === 'schedule' ? assignedStudentsForActor(db, actor, 500) : Promise.resolve({ students: [], branches: [], hasMore: false }),
    ])
    return { schemaVersion: 2, scope, students: roster.students || [], branches: roster.branches || [], sessions: data.sessions, requests: data.requests, hasMore: Boolean(data.hasMore || roster.hasMore) }
  })

  const getMyTrainerStudentDetail = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const weekId = availabilityWeekId(request.data?.weekId || mondayDateKey())
    const [contracts, sessionsSnapshot, studentSnapshot] = await Promise.all([
      assignedContracts(db, actor, 'training', 300),
      db.collection('sessions').where('studentId', '==', studentId).limit(1001).get(),
      db.doc(`students/${studentId}`).get(),
    ])
    if (sessionsSnapshot.size > 1000) throw new HttpsError('resource-exhausted', 'Lịch sử học viên vượt giới hạn xem nhanh. Hãy mở báo cáo đối soát.')
    if (!studentSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy học viên.')
    const sessionRows = sessionsSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }))
    const actorIds = new Set([actor.uid, actor.legacyStaffId].filter(Boolean))
    let studentContracts = contracts.filter((item) => item.studentId === studentId)
    const studentValue = studentSnapshot.data() || {}
    const branchRosterStudent = actor.accessRole === 'staff'
      && Array.isArray(actor.positions)
      && actor.positions.includes('trainer_pt')
      && Array.isArray(actor.branchIds)
      && actor.branchIds.includes(studentValue.branchId)
      && !['inactive', 'deleted', 'archived'].includes(String(studentValue.status || '').toLowerCase())
    if (branchRosterStudent && !studentContracts.length) {
      const [canonicalContracts, legacyContracts] = await Promise.all([
        db.collection('contracts').where('studentId', '==', studentId).limit(50).get(),
        db.collection('contracts').where('crmProfileId', '==', studentId).limit(50).get(),
      ])
      studentContracts = [...new Map([...canonicalContracts.docs, ...legacyContracts.docs]
        .map((document) => [document.id, { id: document.id, ...document.data(), studentId: document.data()?.studentId || document.data()?.crmProfileId || studentId }])).values()]
    }

    // The Staff student list also includes learners currently scheduled with
    // this PT even when another PT owns the contract. Always merge those
    // session-linked contracts instead of only doing so when the assigned list
    // is empty; otherwise an expired contract owned by this PT could hide a
    // newer active contract attached to a live session.
    const scheduledContractIds = [...new Set(sessionRows
      .filter((session) => actorIds.has(session.trainerId))
      .map((session) => session.contractId)
      .filter(Boolean))]
    if (scheduledContractIds.length) {
      const scheduledContractSnapshots = await db.getAll(...scheduledContractIds.map((contractId) => db.doc(`contracts/${contractId}`)))
      const scheduledContracts = scheduledContractSnapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => ({ id: snapshot.id, ...snapshot.data(), studentId: snapshot.data()?.studentId || snapshot.data()?.crmProfileId || studentId }))
        .filter((contract) => contract.studentId === studentId)
      studentContracts = [...new Map([...studentContracts, ...scheduledContracts].map((contract) => [contract.id, contract])).values()]
    }
    const scheduledForActor = sessionRows.some((session) => actorIds.has(session.trainerId))
    if (!studentContracts.length && !branchRosterStudent && !scheduledForActor) throw new HttpsError('permission-denied', 'Học viên không thuộc phạm vi được giao.')
    const availabilityReference = db.doc(`ptAvailability/${studentId}_${weekId}`)
    const [legacyLogsSnapshot, workoutLogsSnapshot, trainingProgramSnapshot, availabilitySnapshot, configSnapshot] = await Promise.all([
      db.collection('workoutLogs').where('studentId', '==', studentId).limit(100).get(),
      db.collection('ptWorkoutLogs').where('studentId', '==', studentId).limit(100).get(),
      db.doc(`ptTrainingPrograms/${studentId}`).get(),
      availabilityReference.get(),
      db.doc('settings/scheduleConfig').get(),
    ])
    const projectedContracts = studentContracts.map((contract) => {
      const projection = studentContractProjection(
        contract.id,
        contract,
        currentDateKey(),
        sessionRows.filter((session) => session.contractId === contract.id),
        true,
      )
      return {
        ...projection,
        // The detail modal may be opened while reviewing a future or past
        // week. Expose a week-aware status in addition to today's status.
        schedulableOnWeek: isContractSchedulableInWeek(contract, weekId, projection.remainingSessions),
      }
    }).sort((left, right) => right.startDate.localeCompare(left.startDate) || left.id.localeCompare(right.id))
    const config = scheduleConfig(configSnapshot.data())
    const exactAvailability = new Map(availabilitySnapshot.exists ? [[studentId, availabilitySnapshot.data()]] : [])
    const inheritedAvailability = await loadLatestSubmittedFallbacks(
      db,
      new Map([[studentId, studentSnapshot.data()]]),
      exactAvailability,
      weekId,
    )
    const effectiveAvailability = effectiveStudentAvailability({
      targetWeek: weekId,
      exact: exactAvailability.get(studentId),
      inherited: inheritedAvailability.get(studentId),
      profile: studentSnapshot.data(),
    })
    const availability = availabilityState(weekId, {
      slots: normalizedAvailabilitySlots(effectiveAvailability.slots, config, false),
      minimumSlots: effectiveAvailability.minimumSlots,
      requiredSessions: Math.max(1, Number(studentSnapshot.data().sessionsPerWeek || 1)),
      revision: effectiveAvailability.targetRevision,
      sourceRevision: effectiveAvailability.sourceRevision,
      status: effectiveAvailability.status,
      confirmed: effectiveAvailability.confirmed,
      submittedAt: effectiveAvailability.submittedAt,
      source: effectiveAvailability.source,
      sourceWeekId: effectiveAvailability.sourceWeekId,
      updatedAt: effectiveAvailability.updatedAt,
    }, new Date(), config)
    const student = studentValue
    const effectiveBranchId = projectedContracts.find((contract) => contract.schedulableToday)?.branchId
      || studentContracts.find((contract) => isEffectiveStaffContract(contract))?.branchId
      || student.branchId
      || ''
    const currentWorkoutLogs = workoutLogsSnapshot.docs.map((doc) => staffStudentWorkoutLogDetail(doc.id, doc.data()))
    const currentSessionIds = new Set(currentWorkoutLogs.map((log) => log.sessionId).filter(Boolean))
    const workoutLogs = [
      ...currentWorkoutLogs,
      ...legacyLogsSnapshot.docs
        .map((doc) => staffStudentWorkoutLogDetail(doc.id, doc.data(), 'legacy'))
        .filter((log) => !log.sessionId || !currentSessionIds.has(log.sessionId)),
    ].sort((left, right) => `${right.date || ''}-${String(right.hour ?? 0).padStart(2, '0')}`
      .localeCompare(`${left.date || ''}-${String(left.hour ?? 0).padStart(2, '0')}`))
    return {
      schemaVersion: 3,
      formulaVersion: 'contract-usage-v2',
      student: serialize({
        id: studentId,
        name: student.name || 'Học viên Aura',
        phone: student.phone || '',
        email: student.email || '',
        dob: storedDateKey(student.dob || student.dateOfBirth),
        branchId: effectiveBranchId,
        sessionsPerWeek: Math.max(0, Number(student.sessionsPerWeek || 0)),
        status: student.status || 'active',
      }),
      contracts: serialize(projectedContracts.map(staffStudentContractDetail)),
      sessions: sessionRows.map((session) => serialize({
        ...staffStudentSessionDetail(session),
        contractEffective: Boolean(studentContracts.find((contract) => contract.id === session.contractId)
          && contractCoversDate(studentContracts.find((contract) => contract.id === session.contractId), session.date || currentDateKey())),
      }))
        .sort((left, right) => `${right.date || ''}-${String(right.hour ?? 0).padStart(2, '0')}`.localeCompare(`${left.date || ''}-${String(left.hour ?? 0).padStart(2, '0')}`)),
      availability: serialize(availability),
      trainingProgram: serialize(staffStudentTrainingProgramDetail(trainingProgramSnapshot)),
      workoutLogs: serialize(workoutLogs.slice(0, 100)),
    }
  })



  const confirmMySession = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    const sessionId = documentId(request.data?.sessionId, 'Mã buổi tập')
    const expectedRevision = integer(request.data?.expectedRevision, 0, 0, 1000000)
    return completeSessionAttendanceTransaction({
      db,
      sessionId,
      expectedRevision,
      actorUid: actor.uid,
      timeZone: TIME_ZONE,
      now: new Date(),
      assertSessionScope: (session) => {
        if (![actor.uid, actor.legacyStaffId].includes(session.trainerId)) {
          throw new HttpsError('permission-denied', 'Buổi tập không thuộc lịch của bạn.')
        }
      },
    })
  })

  const recordMySessionAttendance = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    const sessionId = documentId(request.data?.sessionId, 'Mã buổi tập')
    const expectedRevision = integer(request.data?.expectedRevision, 0, 0, 1000000)
    const attendanceStatus = request.data?.attendanceStatus
    const assertSessionScope = (session) => {
      if (![actor.uid, actor.legacyStaffId].includes(session.trainerId)) {
        throw new HttpsError('permission-denied', 'Buổi tập không thuộc lịch của bạn.')
      }
    }
    const actionAt = new Date()
    const charge = await chargeSessionTransaction({
      db,
      sessionId,
      expectedRevision,
      actorUid: actor.uid,
      assertSessionScope,
      now: actionAt,
      timeZone: TIME_ZONE,
    })
    return recordSessionAttendanceTransaction({
      db,
      sessionId,
      expectedRevision: charge.revision,
      actorUid: actor.uid,
      attendanceStatus,
      lateMinutes: request.data?.lateMinutes,
      noShowReason: request.data?.noShowReason,
      note: request.data?.note,
      assertSessionScope,
      now: actionAt,
      timeZone: TIME_ZONE,
    })
  })

  const bulkConfirmMySessions = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    const items = Array.isArray(request.data?.items) ? request.data.items : []
    if (!items.length || items.length > 30) throw new HttpsError('invalid-argument', 'Mỗi lần chỉ xác nhận từ 1 đến 30 buổi.')
    const results = []
    for (const item of items) {
      const sessionId = documentId(item?.sessionId, 'Mã buổi tập')
      const assertSessionScope = (session) => {
        if (![actor.uid, actor.legacyStaffId].includes(session.trainerId)) {
          throw new HttpsError('permission-denied', 'Buổi tập không thuộc lịch của bạn.')
        }
      }
      try {
        const actionAt = new Date()
        const charge = await chargeSessionTransaction({
          db,
          sessionId,
          expectedRevision: integer(item?.expectedRevision, 0, 0, 1000000),
          actorUid: actor.uid,
          assertSessionScope,
          now: actionAt,
          timeZone: TIME_ZONE,
        })
        const result = await recordSessionAttendanceTransaction({
          db,
          sessionId,
          expectedRevision: charge.revision,
          actorUid: actor.uid,
          attendanceStatus: 'present',
          assertSessionScope,
          now: actionAt,
          timeZone: TIME_ZONE,
        })
        results.push({ sessionId, ok: true, revision: result.revision, unchanged: result.unchanged })
      } catch (error) {
        results.push({ sessionId, ok: false, code: error?.code || 'internal' })
      }
    }
    return {
      total: results.length,
      confirmed: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
    }
  })

  const submitWorkoutNote = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const contracts = await assignedContracts(db, actor, 'training', 300)
    if (!contracts.some((item) => item.studentId === studentId)) throw new HttpsError('permission-denied', 'Học viên không thuộc phạm vi được giao.')
    const reference = db.collection('workoutLogs').doc()
    await reference.create({ schemaVersion: 1, studentId, trainerId: actor.legacyStaffId || actor.uid, sessionId: request.data?.sessionId ? documentId(request.data.sessionId, 'Mã buổi tập') : '', exerciseName: boundedString(request.data?.exerciseName, 'Bài tập', 160), note: boundedString(request.data?.note, 'Ghi chú', 2000, false), date: dateKey(request.data?.date), sets: Array.isArray(request.data?.sets) ? request.data.sets.slice(0, 30) : [], createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() })
    return { logId: reference.id }
  })

  const requestSessionChange = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    const sessionId = documentId(request.data?.sessionId, 'Mã buổi tập')
    const type = request.data?.type === 'cancel'
      ? 'cancel'
      : request.data?.type === 'makeup'
        ? 'makeup'
        : 'reschedule'
    const requestedHour = Number(request.data?.newHour)
    if (['reschedule', 'makeup'].includes(type) && (!Number.isInteger(requestedHour) || requestedHour < 0 || requestedHour > 23)) {
      throw new HttpsError('invalid-argument', 'Giờ mới không hợp lệ.')
    }
    const reason = boundedString(request.data?.reason, 'Lý do', 500)
    const submittedAt = new Date()
    const rawIdempotencyKey = typeof request.data?.idempotencyKey === 'string' ? request.data.idempotencyKey.trim() : ''
    const requestReference = rawIdempotencyKey && /^[A-Za-z0-9_-]+$/.test(rawIdempotencyKey)
      ? db.doc(`sessionRequests/trainer-${actor.uid}-${rawIdempotencyKey}`)
      : db.collection('sessionRequests').doc()
    const sessionReference = db.doc(`sessions/${sessionId}`)
    return db.runTransaction(async (transaction) => {
      const [existingRequest, session, pendingRequests, configSnapshot] = await Promise.all([
        transaction.get(requestReference),
        transaction.get(sessionReference),
        transaction.get(db.collection('sessionRequests').where('sessionId', '==', sessionId).limit(20)),
        transaction.get(db.doc('settings/scheduleConfig')),
      ])
      if (existingRequest.exists) return { unchanged: true, requestId: existingRequest.id, status: existingRequest.data().status || 'pending' }
      if (!session.exists || ![actor.uid, actor.legacyStaffId].includes(session.data().trainerId)) throw new HttpsError('permission-denied', 'Buổi tập không thuộc lịch của bạn.')
      const sessionData = session.data()
      const isMakeupRequest = type === 'makeup'
      const sourceAttendanceStatus = String(sessionData.attendanceStatus || '').toLowerCase()
      const sourceAttendancePending = !sourceAttendanceStatus || sourceAttendanceStatus === 'pending'
      const sourceIsNoShow = String(sessionData.status || '').toLowerCase() === 'no_show' || sourceAttendanceStatus === 'no_show'
      if (isMakeupRequest) {
        if (!sourceIsNoShow) throw new HttpsError('failed-precondition', 'Chỉ có thể xếp bù sau khi buổi gốc đã được xác nhận Không đến.')
      } else if (!sourceAttendancePending || !['scheduled', 'rescheduled'].includes(String(sessionData.status || '').toLowerCase())) {
        throw new HttpsError('failed-precondition', 'Chỉ buổi đang lên lịch và chưa xác nhận đi tập được gửi yêu cầu.')
      }
      if (pendingRequests.size >= 20) throw new HttpsError('resource-exhausted', 'Buổi tập có quá nhiều yêu cầu để kiểm tra an toàn.')
      if (pendingRequests.docs.some((item) => item.id !== requestReference.id && item.data().status === 'pending')) {
        throw new HttpsError('already-exists', 'Buổi tập này đã có một yêu cầu đang chờ xử lý.')
      }
      if (isMakeupRequest && pendingRequests.docs.some((item) => item.data().type === 'makeup' && item.data().status === 'approved')) {
        throw new HttpsError('already-exists', 'Buổi tập này đã có buổi bù được duyệt.')
      }
      const contractId = documentId(sessionData.contractId || request.data?.contractId, 'Mã hợp đồng')
      if (request.data?.contractId && request.data.contractId !== contractId) throw new HttpsError('failed-precondition', 'Hợp đồng trên giao diện không còn khớp với buổi tập.')
      const originalDate = dateKey(sessionData.date, 'Ngày buổi tập')
      const originalHour = sessionHour(sessionId, sessionData.hour)
      if (originalHour === null) throw new HttpsError('failed-precondition', 'Buổi tập chưa có giờ hợp lệ.')
      const policy = ptOperationsPolicySnapshot(configSnapshot.exists ? configSnapshot.data() : {})
      const newDate = ['reschedule', 'makeup'].includes(type) ? dateKey(request.data?.newDate, 'Ngày mới') : null
      let deadlineAt
      // PT adjustments are governed by the attendance confirmation state, not
      // the student-facing change deadline. Keep the target deadline only for
      // a make-up request, which is created after a confirmed no-show.
      if (isMakeupRequest && newDate) {
        try {
          deadlineAt = assertSessionChangeDeadline(newDate, requestedHour, submittedAt, policy.sessionChangeDeadlineHours)
        } catch (error) {
          throw new HttpsError('failed-precondition', error.message, { issueCode: error.issueCode || 'SESSION_CHANGE_DEADLINE_PASSED', deadlineAt: error.deadlineAt || null })
        }
      }
      transaction.create(requestReference, {
        schemaVersion: 3,
        policyVersion: 'pt-change-cancel-v2',
        policySnapshot: policy,
        sessionId,
        trainerId: sessionData.trainerId,
        accountUid: actor.uid,
        studentId: sessionData.studentId,
        contractId,
        type,
        requestedBy: 'trainer',
        originalDate,
        originalHour,
        originalSessionRevision: Number(sessionData.revision || 0),
        newDate,
        newHour: ['reschedule', 'makeup'].includes(type) ? requestedHour : null,
        makeupSession: isMakeupRequest,
        makeupSourceSessionId: isMakeupRequest ? sessionId : null,
        countsTowardContract: false,
        commissionEligible: isMakeupRequest ? false : null,
        reason,
        status: 'pending',
        deadlineHours: policy.sessionChangeDeadlineHours,
        ...(deadlineAt ? { deadlineAt: deadlineAt.toISOString() } : {}),
        idempotencyKey: rawIdempotencyKey || null,
        submittedAtIso: submittedAt.toISOString(),
        createdBy: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { unchanged: false, requestId: requestReference.id, status: 'pending', deadlineHours: policy.sessionChangeDeadlineHours, type }
    })
  })

  const reportMySessionAdvanceAbsence = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    const sessionId = documentId(request.data?.sessionId, 'Mã buổi tập')
    const expectedRevision = integer(request.data?.expectedRevision, 0, 0, 1000000)
    const reason = boundedString(request.data?.reason, 'Lý do nghỉ trước giờ', 500, false)
    const note = boundedString(request.data?.note, 'Ghi chú', 500, false)
    const sessionReference = db.doc(`sessions/${sessionId}`)
    const now = new Date()
    return db.runTransaction(async (transaction) => {
      const [sessionSnapshot, requestsSnapshot] = await Promise.all([
        transaction.get(sessionReference),
        transaction.get(db.collection('sessionRequests').where('sessionId', '==', sessionId).limit(20)),
      ])
      if (!sessionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
      const session = sessionSnapshot.data()
      if (![actor.uid, actor.legacyStaffId].includes(session.trainerId)) throw new HttpsError('permission-denied', 'Buổi tập không thuộc lịch của bạn.')
      const revision = Number(session.revision || 0)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại lịch mới nhất.')
      if (!activeSessionStatus(session.status) || String(session.attendanceStatus || 'pending').toLowerCase() !== 'pending') {
        throw new HttpsError('failed-precondition', 'Chỉ buổi đang lên lịch và chưa xác nhận hiện diện mới được báo nghỉ trước giờ.', { issueCode: 'ADVANCE_ABSENCE_NOT_ELIGIBLE' })
      }
      const startsAt = sessionStartMillis(session, sessionId)
      if (!Number.isFinite(startsAt) || now.getTime() >= startsAt) {
        throw new HttpsError('failed-precondition', 'Đã qua giờ bắt đầu; hãy xác nhận Không đến trong mục xác nhận lịch tập.', { issueCode: 'ADVANCE_ABSENCE_WINDOW_CLOSED' })
      }
      const currentNotice = session.advanceAbsenceNotice && typeof session.advanceAbsenceNotice === 'object' ? session.advanceAbsenceNotice : null
      if (currentNotice?.replacementLocked === true) {
        throw new HttpsError('failed-precondition', 'Buổi đã được dùng để mở ca thay thế; hãy xác nhận Không đến sau giờ tập.', { issueCode: 'ADVANCE_ABSENCE_REPLACEMENT_LOCKED' })
      }
      if (currentNotice?.status === 'reported') {
        return {
          unchanged: true,
          revision,
          sessionId,
          notice: serialize({ ...currentNotice, status: 'reported' }),
        }
      }
      if (requestsSnapshot.docs.some((item) => item.data()?.status === 'pending')) {
        throw new HttpsError('already-exists', 'Buổi tập đã có yêu cầu đang chờ xử lý. Hãy xử lý yêu cầu đó trước.', { issueCode: 'SESSION_REQUEST_PENDING' })
      }
      const notice = {
        status: 'reported',
        reason,
        note,
        reportedBy: actor.uid,
        reportedAt: FieldValue.serverTimestamp(),
        replacementLocked: false,
        replacementRequestId: null,
        replacementSessionId: null,
      }
      transaction.update(sessionReference, {
        advanceAbsenceNotice: notice,
        revision: revision + 1,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      })
      transaction.create(db.collection('sessionEvents').doc(), {
        schemaVersion: 1,
        type: 'advance_absence_reported',
        sessionId,
        studentId: session.studentId || '',
        trainerId: session.trainerId || '',
        date: session.date || null,
        hour: sessionHour(sessionId, session.hour),
        reason,
        note,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        schemaVersion: 1,
        action: 'trainer.advance_absence_reported',
        sessionId,
        studentId: session.studentId || '',
        trainerId: session.trainerId || '',
        reason,
        note,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      return { unchanged: false, revision: revision + 1, sessionId, notice: serialize({ ...notice, reportedAt: now.toISOString() }) }
    })
  })

  const requestStudentSessionAddition = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    const sourceSessionId = documentId(request.data?.sourceSessionId, 'Mã buổi được giải phóng')
    const studentId = documentId(request.data?.studentId, 'Mã học viên thêm')
    const contractId = documentId(request.data?.contractId, 'Mã hợp đồng')
    const reason = boundedString(request.data?.reason, 'Lý do xếp thêm', 500)
    const rawIdempotencyKey = typeof request.data?.idempotencyKey === 'string' ? request.data.idempotencyKey.trim() : ''
    const requestReference = rawIdempotencyKey && /^[A-Za-z0-9_-]+$/.test(rawIdempotencyKey)
      ? db.doc(`sessionRequests/trainer-${actor.uid}-${rawIdempotencyKey}`)
      : db.collection('sessionRequests').doc()
    const sourceReference = db.doc(`sessions/${sourceSessionId}`)
    const now = new Date()
    return db.runTransaction(async (transaction) => {
      const [existingRequest, sourceSnapshot, studentSnapshot, contractSnapshot, sourceRequestsSnapshot] = await Promise.all([
        transaction.get(requestReference),
        transaction.get(sourceReference),
        transaction.get(db.doc(`students/${studentId}`)),
        transaction.get(db.doc(`contracts/${contractId}`)),
        transaction.get(db.collection('sessionRequests').where('preAbsenceSourceSessionId', '==', sourceSessionId).limit(20)),
      ])
      if (existingRequest.exists) {
        const existing = existingRequest.data()
        return { unchanged: true, requestId: existingRequest.id, status: existing.status || 'pending', type: 'additional' }
      }
      if (!sourceSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi được giải phóng.')
      const source = sourceSnapshot.data()
      if (![actor.uid, actor.legacyStaffId].includes(source.trainerId)) throw new HttpsError('permission-denied', 'Buổi được giải phóng không thuộc lịch của bạn.')
      const sourceRevision = Number(source.revision || 0)
      const notice = source.advanceAbsenceNotice && typeof source.advanceAbsenceNotice === 'object' ? source.advanceAbsenceNotice : null
      if (!activeSessionStatus(source.status) || String(source.attendanceStatus || 'pending').toLowerCase() !== 'pending') throw new HttpsError('failed-precondition', 'Buổi nguồn phải đang chờ xác nhận hiện diện.')
      if (!notice || notice.status !== 'reported') throw new HttpsError('failed-precondition', 'Hãy báo nghỉ trước giờ cho buổi nguồn trước khi xếp học viên khác.', { issueCode: 'ADVANCE_ABSENCE_NOTICE_REQUIRED' })
      if (notice.replacementLocked === true) throw new HttpsError('already-exists', 'Buổi nguồn đã có ca thay thế được duyệt.', { issueCode: 'ADVANCE_ABSENCE_REPLACEMENT_LOCKED' })
      const startsAt = sessionStartMillis(source, sourceSessionId)
      if (!Number.isFinite(startsAt) || now.getTime() >= startsAt) throw new HttpsError('failed-precondition', 'Đã qua giờ bắt đầu; không thể mở ca mới từ buổi này.', { issueCode: 'ADVANCE_ABSENCE_WINDOW_CLOSED' })
      if (studentId === source.studentId) throw new HttpsError('invalid-argument', 'Học viên thêm phải khác học viên của buổi nguồn.')
      if (!studentSnapshot.exists || ['inactive', 'deleted', 'archived'].includes(String(studentSnapshot.data()?.status || '').toLowerCase())) throw new HttpsError('failed-precondition', 'Học viên được chọn không còn hoạt động.')
      if (!contractSnapshot.exists) throw new HttpsError('failed-precondition', 'Không tìm thấy hợp đồng của học viên được chọn.')
      const student = studentSnapshot.data() || {}
      const contract = contractSnapshot.data() || {}
      if (contract.studentId !== studentId || !['active', 'expired'].includes(String(contract.status || '').toLowerCase())) throw new HttpsError('failed-precondition', 'Hợp đồng của học viên được chọn không còn hoạt động.')
      const targetDate = storedDateKey(source.date)
      const targetHour = sessionHour(sourceSessionId, source.hour)
      if (!targetDate || targetHour === null) throw new HttpsError('failed-precondition', 'Buổi nguồn thiếu ngày hoặc giờ hợp lệ.')
      const contractStart = storedDateKey(contract.startDate)
      const contractEnd = storedDateKey(contract.endDate)
      if (!contractStart || !contractEnd || targetDate < contractStart || targetDate > contractEnd || pauseCoversDate(contract, targetDate)) throw new HttpsError('failed-precondition', 'Ngày ca thêm nằm ngoài thời hạn hợp đồng hoặc trong thời gian OFF/bảo lưu.')
      if (sourceRequestsSnapshot.docs.some((item) => item.data()?.status === 'pending')) throw new HttpsError('already-exists', 'Buổi nguồn đã có yêu cầu thêm học viên đang chờ duyệt.')
      const targetWeek = mondayDateKey(targetDate)
      const [studentDay, targetStudentSessions, configSnapshot, availabilitySnapshot] = await Promise.all([
        transaction.get(db.collection('sessions').where('studentId', '==', studentId).where('date', '>=', targetDate).where('date', '<', nextDateKey(targetDate)).limit(50)),
        transaction.get(db.collection('sessions').where('studentId', '==', studentId).limit(200)),
        transaction.get(db.doc('settings/scheduleConfig')),
        transaction.get(db.doc(`ptAvailability/${studentId}_${targetWeek}`)),
      ])
      const activeDay = studentDay.docs.filter((item) => activeSessionStatus(item.data()?.status))
      if (activeDay.length) throw new HttpsError('already-exists', 'Học viên đã có buổi khác trong ngày này.')
      const weeklyCount = targetStudentSessions.docs.filter((item) => activeSessionStatus(item.data()?.status) && storedDateKey(item.data()?.date) >= targetWeek && storedDateKey(item.data()?.date) <= addDateDays(targetWeek, 6)).length
      const weeklyMaximum = Math.max(1, Number(student.maxWeeklySessions || 7))
      if (weeklyCount >= weeklyMaximum) throw new HttpsError('failed-precondition', 'Học viên đã đạt số buổi tối đa trong tuần.')
      const config = normalizedScheduleConfig(configSnapshot.exists ? configSnapshot.data() : {})
      const slotId = `${dayCodeForDate(targetDate)}-${targetHour}`
      if (!config.workingDays.includes(dayCodeForDate(targetDate)) || !config.workingHours.includes(targetHour) || config.holidays.includes(targetDate)) throw new HttpsError('failed-precondition', 'Khung giờ nguồn không nằm trong lịch hoạt động.')
      if (availabilitySnapshot.exists && Array.isArray(availabilitySnapshot.data()?.slots) && availabilitySnapshot.data().confirmed === true && !availabilitySnapshot.data().slots.includes(slotId)) throw new HttpsError('failed-precondition', 'Khung giờ này không nằm trong lịch rảnh đã xác nhận của học viên.')
      const requestData = {
        schemaVersion: 1,
        policyVersion: 'pt-advance-absence-v1',
        type: 'additional',
        requestedBy: 'trainer',
        sessionId: null,
        preAbsenceSourceSessionId: sourceSessionId,
        preAbsenceSourceSessionRevision: sourceRevision,
        studentId,
        contractId,
        trainerId: source.trainerId,
        newTrainerId: source.trainerId,
        newBranchId: source.branchId || student.branchId || contract.branchId || '',
        newDate: targetDate,
        newHour: targetHour,
        originalDate: targetDate,
        originalHour: targetHour,
        pairsExistingSession: false,
        countsTowardContract: true,
        commissionEligible: true,
        reason,
        status: 'pending',
        revision: 0,
        idempotencyKey: rawIdempotencyKey || null,
        submittedAtIso: now.toISOString(),
        createdBy: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      }
      transaction.create(requestReference, requestData)
      transaction.create(db.collection('sessionRequestEvents').doc(), {
        schemaVersion: 1,
        requestId: requestReference.id,
        type: 'created',
        sessionId: sourceSessionId,
        preAbsenceSourceSessionId: sourceSessionId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      return { unchanged: false, requestId: requestReference.id, status: 'pending', type: 'additional', sourceSessionId, date: targetDate, hour: targetHour }
    })
  })

  const listMyQuotes = staffCall(async (request) => {
    const actor = await salesActor(request, db)
    requireCapability(actor, 'sales.quotes.self.manage')
    const limit = integer(request.data?.limit, 100, 1, 200)
    return { schemaVersion: 1, quotes: await salesQuotesForActor(db, actor, limit) }
  })

  const getMySalesCatalog = staffCall(async (request) => {
    const actor = await salesActor(request, db)
    requireCapability(actor, 'sales.quotes.self.manage')
    return { schemaVersion: 1, ...await salesCatalogForActor(db, actor) }
  })

  // One bootstrap callable avoids two independent Cloud Run cold starts when a
  // Sales user opens the page. Scope is still derived from the verified actor;
  // the browser never supplies an employee or branch identity.
  const getMySalesWorkspace = staffCall(async (request) => {
    const actor = await salesActor(request, db)
    requireCapability(actor, 'sales.quotes.self.manage')
    const limit = integer(request.data?.limit, 100, 1, 200)
    const [quotes, catalog] = await Promise.all([
      salesQuotesForActor(db, actor, limit),
      salesCatalogForActor(db, actor),
    ])
    return { schemaVersion: 2, quotes, catalog }
  })

  const createQuote = staffCall(async (request) => {
    const actor = await salesActor(request, db)
    requireCapability(actor, 'sales.quotes.self.manage')
    const packageId = documentId(request.data?.packageId, 'Mã gói tập')
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    if (!actor.branchIds.includes(branchId)) throw new HttpsError('permission-denied', 'Bạn không phụ trách chi nhánh này.')
    const packageSnapshot = await db.doc(`packages/${packageId}`).get()
    if (!packageSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy gói tập.')
    const originalPrice = Number(packageSnapshot.data().price || 0)
    const discount = integer(request.data?.discount, 0, 0, Math.round(originalPrice * 0.2))
    const rawMemberReferralCode = typeof request.data?.memberReferralCode === 'string' ? request.data.memberReferralCode.trim() : ''
    const memberReferralCode = normalizeMemberReferralCode(rawMemberReferralCode)
    if (rawMemberReferralCode && !memberReferralCode) throw new HttpsError('invalid-argument', 'Mã giới thiệu Aura không hợp lệ.')
    let memberReferrerStudentId = ''
    if (memberReferralCode) {
      const codeSnapshot = await db.doc(`memberReferralCodes/${memberReferralCode}`).get()
      if (!codeSnapshot.exists || codeSnapshot.data().status !== 'active') throw new HttpsError('not-found', 'Mã giới thiệu Aura không tồn tại hoặc đã ngừng hoạt động.')
      memberReferrerStudentId = String(codeSnapshot.data().studentId || '')
      const referrerSnapshot = memberReferrerStudentId ? await db.doc(`students/${memberReferrerStudentId}`).get() : null
      const customerPhone = normalizedContact(request.data?.customerPhone)
      const referrerPhone = referrerSnapshot?.exists ? normalizedContact(referrerSnapshot.data().phone || referrerSnapshot.data().phoneNumber) : ''
      if (customerPhone && referrerPhone && customerPhone === referrerPhone) throw new HttpsError('failed-precondition', 'Không thể dùng mã giới thiệu cho chính chủ mã.')
    }
    const reference = db.collection('quotes').doc()
    const code = `AQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${reference.id.slice(0, 6).toUpperCase()}`
    await reference.create({ schemaVersion: 2, code, customerName: boundedString(request.data?.customerName, 'Tên khách hàng', 160), customerPhone: boundedString(request.data?.customerPhone, 'Số điện thoại', 30), branchId, packageId, packageName: packageSnapshot.data().name || '', originalPrice, discount, finalPrice: originalPrice - discount, memberReferralCode: memberReferralCode || null, memberReferrerStudentId: memberReferrerStudentId || null, assignedSalesId: actor.uid, status: 'pending', createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return { quoteId: reference.id, code, finalPrice: originalPrice - discount }
  })

  const createStudentDraft = staffCall(async (request) => {
    const actor = await salesActor(request, db)
    requireCapability(actor, 'sales.student_draft.create')
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    if (!actor.branchIds.includes(branchId)) throw new HttpsError('permission-denied', 'Bạn không phụ trách chi nhánh này.')
    const reference = db.collection('salesLeads').doc()
    await reference.create({ schemaVersion: 1, displayName: boundedString(request.data?.displayName, 'Tên khách hàng', 160), phoneNumber: boundedString(request.data?.phoneNumber, 'Số điện thoại', 30), email: boundedString(request.data?.email, 'Email', 320, false), branchId, assignedSalesId: actor.uid, status: 'draft', createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return { leadId: reference.id }
  })

  const submitContractForApproval = staffCall(async (request) => {
    const actor = await salesActor(request, db)
    requireCapability(actor, 'sales.contract.submit')
    const leadId = documentId(request.data?.leadId, 'Mã khách hàng nháp')
    const quoteId = documentId(request.data?.quoteId, 'Mã báo giá')
    const [lead, quote] = await Promise.all([db.doc(`salesLeads/${leadId}`).get(), db.doc(`quotes/${quoteId}`).get()])
    if (!lead.exists || !quote.exists || lead.data().assignedSalesId !== actor.uid || quote.data().assignedSalesId !== actor.uid) throw new HttpsError('permission-denied', 'Hồ sơ hoặc báo giá không thuộc phạm vi của bạn.')
    const reference = db.collection('contractApprovals').doc()
    await reference.create({ schemaVersion: 2, leadId, quoteId, branchId: quote.data().branchId, assignedSalesId: actor.uid, memberReferralCode: quote.data().memberReferralCode || null, memberReferrerStudentId: quote.data().memberReferrerStudentId || null, status: 'pending', submittedBy: actor.uid, submittedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return { approvalId: reference.id, status: 'pending' }
  })

  return { getMyCoachWorkspaceScope, getMyTrainerAvailability, saveMyTrainerAvailability, getMyTrainerWorkspace, listMyStudentPtSchedule, saveMyStudentAvailability, listMyAssignedStudents, listMyTrainerSchedule, getMyTrainerStudentDetail, confirmMySession, recordMySessionAttendance, bulkConfirmMySessions, submitWorkoutNote, requestSessionChange, reportMySessionAdvanceAbsence, requestStudentSessionAddition, listMyQuotes, getMySalesCatalog, getMySalesWorkspace, createQuote, createStudentDraft, submitContractForApproval }
}

module.exports = {
  availabilityCutoff,
  availabilityWeekId,
  contractDefaultSessionsPerWeek,
  contractCoversDate,
  createPtOperationsV2Functions,
  isContractSchedulableInWeek,
  isContractSchedulableOn,
  mondayDateKey,
  normalizedTrainerOffDates,
  isEffectiveStaffContract,
  normalizedAvailabilitySlots,
  scheduleConfig,
  sessionHour,
  studentContractProjection,
  studentContractAlerts,
  trainerSlotsWithoutOffDates,
}
