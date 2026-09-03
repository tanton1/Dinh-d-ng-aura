const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const {
  chargeSessionTransaction,
  completeSessionAttendanceTransaction,
  recordSessionAttendanceTransaction,
} = require('./session-operations')
const { assertSessionChangeDeadline, normalizedPtOperationsPolicy } = require('./pt-policy')
const {
  effectiveStudentAvailability,
  loadLatestSubmittedFallbacks,
  studentAvailabilityProfilePatch,
} = require('./student-availability')
const { summarizeContractUsage } = require('./contract-usage')

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

function mondayDateKey(referenceDate = currentDateKey()) {
  const parsed = Date.parse(`${referenceDate}T12:00:00+07:00`)
  if (!Number.isFinite(parsed)) return referenceDate
  const weekday = new Date(parsed).getUTCDay()
  return new Date(parsed - ((weekday + 6) % 7) * 86400000).toISOString().slice(0, 10)
}

function isEffectiveStaffContract(contract = {}, referenceDate = currentDateKey()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return false
  if (String(contract.status || 'active').toLowerCase() !== 'active') return false
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
  const schedulableToday = String(contract.status || '').toLowerCase() === 'active'
    && Boolean(startDate && endDate && startDate <= today && endDate >= today)
    && remainingSessions > 0
    && !pausedToday
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
    status: contract.status || 'active',
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
  const activeContracts = contracts.filter((contract) => String(contract.status || '').toLowerCase() === 'active'
    && contract.startDate && contract.startDate <= today
    && (!contract.endDate || contract.endDate >= today))
  const futureContract = contracts
    .filter((contract) => ['active', 'future'].includes(String(contract.status || '').toLowerCase()) && contract.startDate > today)
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

function availabilityCutoff(weekId) {
  const monday = Date.parse(`${weekId}T00:00:00+07:00`)
  // 10:00 Sunday in Asia/Ho_Chi_Minh, fourteen hours before Monday 00:00.
  return new Date(monday - 14 * 60 * 60 * 1000)
}

function availabilityState(weekId, value, now = new Date()) {
  const cutoff = availabilityCutoff(weekId)
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
    revision: Math.max(0, Number(value?.revision || 0)),
    sourceRevision: Math.max(0, Number(value?.sourceRevision || value?.revision || 0)),
    status,
    confirmed,
    locked,
    cutoffAt: cutoff.toISOString(),
    submittedAt: value?.submittedAt || null,
    source,
    sourceWeekId: value?.sourceWeekId || null,
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
    ...normalizedPtOperationsPolicy(value),
  }
}

function sessionHour(sessionId, value) {
  if (Number.isInteger(value) && value >= 0 && value <= 23) return value
  const parsed = Number(String(sessionId || '').split('-')[1])
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null
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
      students: trainingStudentIds.size > 0,
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
  }
}

async function assignedStudentsForActor(db, actor, limit) {
  const candidateLimit = Math.min(1000, Math.max(300, limit * 3))
  const assigned = await assignedContracts(db, actor, 'training', candidateLimit)
  const today = currentDateKey()
  const datedContracts = assigned.filter((contract) => {
    const projection = studentContractProjection(contract.id, contract, today, [], false)
    return String(contract.status || 'active').toLowerCase() === 'active'
      && projection.startDate && projection.startDate <= today
      && projection.endDate && projection.endDate >= today
      && !projection.pausedToday
  })
  const sessionsByContract = await sessionsForContracts(db, datedContracts.map((contract) => contract.id))
  const projectedContracts = datedContracts.map((contract) => ({
    ...contract,
    usage: studentContractProjection(contract.id, contract, today, sessionsByContract.get(contract.id) || [], true),
  }))
  const contracts = projectedContracts.filter((contract) => contract.usage.schedulableToday)
  const allStudentIds = [...new Set(contracts.map((item) => item.studentId).filter(Boolean))]
  const studentIds = allStudentIds.slice(0, limit)
  const visibleStudentIds = new Set(studentIds)
  const visibleContracts = contracts.filter((contract) => visibleStudentIds.has(contract.studentId))
  const branchIds = [...new Set([...actor.branchIds, ...contracts.map((item) => item.branchId).filter(Boolean)])]
  const [studentSnapshots, branchSnapshots] = await Promise.all([
    studentIds.length ? db.getAll(...studentIds.map((id) => db.doc(`students/${id}`))) : [],
    branchIds.length ? db.getAll(...branchIds.map((id) => db.doc(`branches/${id}`))) : [],
  ])
  const students = studentSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => {
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
    return serialize({
      id: snapshot.id, name: student.name || 'Học viên Aura', phone: student.phone || '', email: student.email || '',
      branchId: contract?.branchId || student.branchId || '', status: student.status || 'active', sessionsPerWeek: student.sessionsPerWeek || 0,
      assignmentRole: contract ? (() => {
        const actorIds = [actor.uid, actor.legacyStaffId].filter(Boolean)
        const trainerIds = Array.isArray(contract.trainerIds) ? contract.trainerIds : []
        return actorIds.some((id) => contract.trainerId === id || trainerIds[0] === id) ? 'primary' : 'secondary'
      })() : 'secondary',
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
  })
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
      const contractEffective = Boolean(contract && isEffectiveStaffContract(contract, today))
      return {
        ...session,
        studentName: student?.name || 'Học viên Aura',
        studentPhone: student?.phone || '',
        studentEmail: student?.email || '',
        studentBranchId: student?.branchId || session.branchId || '',
        contractEffective,
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
    const cutoff = requestedWeekId ? availabilityCutoff(requestedWeekId) : null
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
      const cutoffAt = availabilityCutoff(requestedWeekId)
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
    const requiredSessions = integer(profile.value.sessionsPerWeek, 3, 1, 6)
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
    const storedAvailability = {
      slots: normalizedAvailabilitySlots(effectiveAvailability.slots, config, false),
      minimumSlots: Math.max(5, Number(effectiveAvailability.minimumSlots || requiredSessions)),
      requiredSessions,
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
    })
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
        sessionsPerWeek: requiredSessions,
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
    const configSnapshot = await db.doc('settings/scheduleConfig').get()
    const config = scheduleConfig(configSnapshot.data())
    const weekId = availabilityWeekId(request.data?.weekId)
    const slots = normalizedAvailabilitySlots(request.data?.availableSlots, config)
    const expectedRevision = integer(request.data?.expectedRevision, 0, 0, 1000000)
    const requiredSessions = integer(profile.value.sessionsPerWeek, 3, 1, 6)
    const minimumSlots = Math.max(5, requiredSessions)
    const confirmBelowMinimum = request.data?.confirmBelowMinimum === true
    const submittedAtIso = new Date().toISOString()
    const cutoffAt = availabilityCutoff(weekId)
    if (Date.now() >= cutoffAt.getTime()) {
      throw new HttpsError('failed-precondition', 'Lịch rảnh của tuần này đã khóa lúc 10:00 Chủ nhật.', {
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
        belowMinimumConfirmed: slots.length < minimumSlots,
        latestFallbackAdvanced: Boolean(profilePatch.latestSubmittedAvailability),
        createdAt: FieldValue.serverTimestamp(),
      })
      return currentRevision + 1
    })
    return {
      schemaVersion: 3,
      availableSlots: slots,
      availabilityRevision: nextRevision,
      isScheduleConfirmed: true,
      availability: serialize(availabilityState(weekId, {
        slots,
        minimumSlots,
        requiredSessions,
        revision: nextRevision,
        status: 'submitted',
        submittedAt: submittedAtIso,
        confirmed: true,
        source: 'weekly',
        sourceWeekId: weekId,
      })),
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
      const studentLimit = Math.min(200, requestedLimit)
      const scheduleLimit = Math.max(300, requestedLimit)
      const [scope, data, schedule] = await Promise.all([
        scopePromise,
        assignedStudentsForActor(db, actor, studentLimit),
        trainerScheduleForActor(db, actor, from, to, scheduleLimit),
      ])
      return {
        schemaVersion: 3,
        scope,
        students: data.students,
        branches: data.branches,
        sessions: schedule.sessions,
        requests: [],
        hasMore: data.hasMore,
      }
    }
    const from = dateKey(request.data?.from, 'Ngày bắt đầu')
    const to = dateKey(request.data?.to, 'Ngày kết thúc')
    if (from > to || Date.parse(`${to}T00:00:00+07:00`) - Date.parse(`${from}T00:00:00+07:00`) > 62 * 86400000) throw new HttpsError('invalid-argument', 'Khoảng lịch tối đa là 62 ngày.')
    const limit = integer(request.data?.limit, 300, 1, 500)
    const [scope, data] = await Promise.all([scopePromise, trainerScheduleForActor(db, actor, from, to, limit)])
    return { schemaVersion: 2, scope, students: [], branches: [], sessions: data.sessions, requests: data.requests, hasMore: false }
  })

  const getMyTrainerStudentDetail = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const weekId = availabilityWeekId(request.data?.weekId || mondayDateKey())
    const [contracts, sessionsSnapshot] = await Promise.all([
      assignedContracts(db, actor, 'training', 300),
      db.collection('sessions').where('studentId', '==', studentId).limit(1001).get(),
    ])
    if (sessionsSnapshot.size > 1000) throw new HttpsError('resource-exhausted', 'Lịch sử học viên vượt giới hạn xem nhanh. Hãy mở báo cáo đối soát.')
    const sessionRows = sessionsSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }))
    let studentContracts = contracts.filter((item) => item.studentId === studentId)

    // The Staff student list also includes active students currently scheduled
    // with this PT, even when another PT owns the contract. Keep detail access
    // aligned with that list while requiring both an owned session and an
    // effective contract; an unrelated Staff account still cannot enumerate it.
    if (!studentContracts.length) {
      const actorIds = new Set([actor.uid, actor.legacyStaffId].filter(Boolean))
      const scheduledContractIds = [...new Set(sessionRows
        .filter((session) => actorIds.has(session.trainerId))
        .map((session) => session.contractId)
        .filter(Boolean))]
      const scheduledContractSnapshots = scheduledContractIds.length
        ? await db.getAll(...scheduledContractIds.map((contractId) => db.doc(`contracts/${contractId}`)))
        : []
      studentContracts = scheduledContractSnapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
        .filter((contract) => contract.studentId === studentId && isEffectiveStaffContract(contract))
    }
    if (!studentContracts.length) throw new HttpsError('permission-denied', 'Học viên không thuộc phạm vi được giao.')
    const availabilityReference = db.doc(`ptAvailability/${studentId}_${weekId}`)
    const [studentSnapshot, logsSnapshot, availabilitySnapshot, configSnapshot] = await Promise.all([
      db.doc(`students/${studentId}`).get(),
      db.collection('workoutLogs').where('studentId', '==', studentId).limit(100).get(),
      availabilityReference.get(),
      db.doc('settings/scheduleConfig').get(),
    ])
    if (!studentSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy học viên.')
    const projectedContracts = studentContracts.map((contract) => studentContractProjection(
      contract.id,
      contract,
      currentDateKey(),
      sessionRows.filter((session) => session.contractId === contract.id),
      true,
    )).sort((left, right) => right.startDate.localeCompare(left.startDate) || left.id.localeCompare(right.id))
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
    })
    return {
      schemaVersion: 2,
      formulaVersion: 'contract-usage-v2',
      student: serialize({ id: studentId, ...studentSnapshot.data() }),
      contracts: serialize(projectedContracts),
      sessions: sessionRows.map((session) => serialize({ id: session.id, ...session, timeZone: TIME_ZONE }))
        .sort((left, right) => `${right.date || ''}-${String(right.hour ?? 0).padStart(2, '0')}`.localeCompare(`${left.date || ''}-${String(left.hour ?? 0).padStart(2, '0')}`)),
      availability: serialize(availability),
      workoutLogs: logsSnapshot.docs.map((doc) => serialize({ id: doc.id, ...doc.data() }))
        .sort((left, right) => String(right.completedAt || right.updatedAt || right.date || '').localeCompare(String(left.completedAt || left.updatedAt || left.date || ''))),
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
    const session = await db.doc(`sessions/${sessionId}`).get()
    if (!session.exists || ![actor.uid, actor.legacyStaffId].includes(session.data().trainerId)) throw new HttpsError('permission-denied', 'Buổi tập không thuộc lịch của bạn.')
    const type = request.data?.type === 'cancel' ? 'cancel' : 'reschedule'
    const requestedHour = Number(request.data?.newHour)
    if (type === 'reschedule' && (!Number.isInteger(requestedHour) || requestedHour < 0 || requestedHour > 23)) {
      throw new HttpsError('invalid-argument', 'Giờ mới không hợp lệ.')
    }
    const originalHour = sessionHour(sessionId, session.data().hour)
    if (originalHour === null) throw new HttpsError('failed-precondition', 'Buổi tập chưa có giờ hợp lệ.')
    try {
      assertSessionChangeDeadline(dateKey(session.data().date, 'Ngày buổi tập'), originalHour, new Date())
    } catch (error) {
      throw new HttpsError('failed-precondition', error.message, { issueCode: error.issueCode || 'SESSION_CHANGE_DEADLINE_PASSED', deadlineAt: error.deadlineAt || null })
    }
    const reference = db.collection('sessionRequests').doc()
    await reference.create({ schemaVersion: 2, policyVersion: 'pt-change-cancel-v1', sessionId, trainerId: session.data().trainerId, studentId: session.data().studentId, contractId: boundedString(request.data?.contractId, 'Mã hợp đồng', 200), type, requestedBy: 'trainer', originalDate: session.data().date, originalHour, originalSessionRevision: Number(session.data().revision || 0), newDate: type === 'reschedule' ? dateKey(request.data?.newDate, 'Ngày mới') : null, newHour: type === 'reschedule' ? requestedHour : null, reason: boundedString(request.data?.reason, 'Lý do', 500), status: 'pending', deadlineHours: 12, submittedAtIso: new Date().toISOString(), createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() })
    return { requestId: reference.id }
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
    const reference = db.collection('quotes').doc()
    const code = `AQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${reference.id.slice(0, 6).toUpperCase()}`
    await reference.create({ schemaVersion: 1, code, customerName: boundedString(request.data?.customerName, 'Tên khách hàng', 160), customerPhone: boundedString(request.data?.customerPhone, 'Số điện thoại', 30), branchId, packageId, packageName: packageSnapshot.data().name || '', originalPrice, discount, finalPrice: originalPrice - discount, assignedSalesId: actor.uid, status: 'pending', createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
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
    await reference.create({ schemaVersion: 1, leadId, quoteId, branchId: quote.data().branchId, assignedSalesId: actor.uid, status: 'pending', submittedBy: actor.uid, submittedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return { approvalId: reference.id, status: 'pending' }
  })

  return { getMyCoachWorkspaceScope, getMyTrainerAvailability, saveMyTrainerAvailability, getMyTrainerWorkspace, listMyStudentPtSchedule, saveMyStudentAvailability, listMyAssignedStudents, listMyTrainerSchedule, getMyTrainerStudentDetail, confirmMySession, recordMySessionAttendance, bulkConfirmMySessions, submitWorkoutNote, requestSessionChange, listMyQuotes, getMySalesCatalog, getMySalesWorkspace, createQuote, createStudentDraft, submitContractForApproval }
}

module.exports = {
  availabilityCutoff,
  availabilityWeekId,
  createPtOperationsV2Functions,
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
