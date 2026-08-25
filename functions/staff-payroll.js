const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { randomUUID } = require('node:crypto')
const { trustedAccessContext, requireCapability } = require('./identity-access')

const PAID_ATTENDANCE_STATUSES = new Set([
  'present',
  'remote',
  'business_trip',
  'training',
  'paid_leave',
])
const UNPAID_ATTENDANCE_STATUSES = new Set(['unpaid_leave', 'unexcused_absence'])
const REVIEW_ATTENDANCE_STATUSES = new Set(['pending', 'sick_leave', 'maternity_leave'])
const AUTO_FULL_DAY_TEACHING_SLOT_THRESHOLD = 5
const ATTENDANCE_STATUSES = new Set([
  ...PAID_ATTENDANCE_STATUSES,
  ...UNPAID_ATTENDANCE_STATUSES,
  ...REVIEW_ATTENDANCE_STATUSES,
])

function payrollPeriod(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(result)) {
    throw new HttpsError('invalid-argument', 'Kỳ lương phải có dạng YYYY-MM.')
  }
  return result
}

function dateKey(value, label = 'Ngày') {
  let result = ''
  if (typeof value === 'string') result = value.trim().slice(0, 10)
  else if (value?.toDate || value instanceof Date) {
    const date = value?.toDate ? value.toDate() : value
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const get = (type) => parts.find((part) => part.type === type)?.value || ''
    result = `${get('year')}-${get('month')}-${get('day')}`
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(result)) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  const [year, month, day] = result.split('-').map(Number)
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function optionalDateKey(value) {
  if (!value) return ''
  try { return dateKey(value) } catch { return '' }
}

function monthDateKeys(periodId) {
  const [year, month] = payrollPeriod(periodId).split('-').map(Number)
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: count }, (_, index) => `${periodId}-${String(index + 1).padStart(2, '0')}`)
}

function weekday(date) {
  const [year, month, day] = dateKey(date).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function safeMoney(value, maximum = 5_000_000_000) {
  const result = Number(value || 0)
  return Number.isSafeInteger(result) && result >= 0 && result <= maximum ? result : 0
}

function normalizedEmploymentType(value) {
  if (value === 'part_time' || value === 'collaborator') return value
  return 'full_time'
}

function normalizedEmploymentLevel(value) {
  return value === 'probation' || value === 'senior' ? value : 'official'
}

function attendanceStatus(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!ATTENDANCE_STATUSES.has(result)) {
    throw new HttpsError('invalid-argument', 'Trạng thái ngày công không hợp lệ.')
  }
  return result
}

function normalizedWeeklyRestDays(value) {
  if (!Array.isArray(value) || !value.length) return [0]
  const result = [...new Set(value.map(Number))]
  if (result.some((day) => !Number.isInteger(day) || day < 0 || day > 6) || result.length > 6) {
    throw new HttpsError('invalid-argument', 'Ngày nghỉ hằng tuần không hợp lệ.')
  }
  return result.sort((left, right) => left - right)
}

function normalizedHolidays(value, periodId) {
  if (!Array.isArray(value)) return []
  if (value.length > 20) throw new HttpsError('invalid-argument', 'Lịch nghỉ lễ trong tháng quá lớn.')
  const seen = new Set()
  return value.map((holiday) => {
    const date = dateKey(holiday?.date, 'Ngày nghỉ lễ')
    if (!date.startsWith(`${periodId}-`)) throw new HttpsError('invalid-argument', 'Ngày nghỉ lễ phải thuộc kỳ đang cấu hình.')
    if (seen.has(date)) throw new HttpsError('invalid-argument', 'Lịch nghỉ lễ bị trùng ngày.')
    seen.add(date)
    const name = typeof holiday?.name === 'string' ? holiday.name.trim().replace(/\s+/g, ' ').slice(0, 100) : ''
    if (name.length < 2) throw new HttpsError('invalid-argument', 'Tên ngày nghỉ lễ không hợp lệ.')
    return { date, name, paid: holiday?.paid !== false }
  }).sort((left, right) => left.date.localeCompare(right.date))
}

function mergeWorkCalendar(periodId, globalValue = {}, branchValue = {}) {
  const branchConfigured = branchValue && Object.keys(branchValue).length > 0
  const selected = branchConfigured ? branchValue : globalValue
  const weeklyRestDays = normalizedWeeklyRestDays(selected.weeklyRestDays)
  const globalHolidays = normalizedHolidays(globalValue.holidays, periodId)
  const branchHolidays = branchConfigured ? normalizedHolidays(branchValue.holidays, periodId) : []
  const holidayMap = new Map(globalHolidays.map((holiday) => [holiday.date, holiday]))
  branchHolidays.forEach((holiday) => holidayMap.set(holiday.date, holiday))
  const configured = Object.keys(selected).length > 0
  return {
    periodId,
    branchId: typeof selected.branchId === 'string' ? selected.branchId : '',
    weeklyRestDays,
    holidays: [...holidayMap.values()].sort((left, right) => left.date.localeCompare(right.date)),
    status: selected.status === 'approved' ? 'approved' : 'provisional',
    revision: Number.isSafeInteger(selected.revision) ? selected.revision : 0,
    source: configured ? (branchConfigured ? 'branch_calendar' : 'global_calendar') : 'default_sunday_calendar',
    approved: configured && selected.status === 'approved',
  }
}

function employmentWindow(staff = {}) {
  return {
    start: optionalDateKey(staff.employmentStartDate || staff.startDate || staff.joinDate || staff.createdAt),
    end: optionalDateKey(staff.employmentEndDate || staff.terminationDate || staff.endDate),
  }
}

function calculateWorkdayPayroll({ periodId, calendar, attendance = [], teachingSlots = [], staff = {}, today }) {
  const normalizedPeriod = payrollPeriod(periodId)
  const effectiveToday = today ? dateKey(today, 'Ngày đối soát') : dateKey(new Date(), 'Ngày đối soát')
  const holidayMap = new Map((calendar.holidays || []).map((holiday) => [holiday.date, holiday]))
  const weeklyRestDays = normalizedWeeklyRestDays(calendar.weeklyRestDays)
  const attendanceByDate = new Map()
  attendance.forEach((record) => {
    const date = dateKey(record.date)
    if (!date.startsWith(`${normalizedPeriod}-`)) return
    const currentRevision = Number(attendanceByDate.get(date)?.revision || 0)
    const nextRevision = Number(record.revision || 0)
    if (!attendanceByDate.has(date) || nextRevision >= currentRevision) attendanceByDate.set(date, { ...record, date })
  })
  const teachingSlotsByDate = new Map()
  teachingSlots.forEach((slot) => {
    const date = optionalDateKey(slot?.date)
    if (!date || !date.startsWith(`${normalizedPeriod}-`)) return
    const key = typeof slot?.key === 'string' && slot.key
      ? slot.key
      : `${date}-${Number(slot?.hour ?? -1)}`
    const current = teachingSlotsByDate.get(date) || new Set()
    current.add(key)
    teachingSlotsByDate.set(date, current)
  })
  const employment = employmentWindow(staff)
  const employmentType = normalizedEmploymentType(staff.employmentType)
  const employmentLevel = normalizedEmploymentLevel(staff.employmentLevel)
  const baseSalary = employmentType === 'collaborator' ? 0 : safeMoney(staff.baseSalary)
  const fixedBonus = safeMoney(staff.bonusMonthly)
  const standardDates = monthDateKeys(normalizedPeriod).filter((date) => !weeklyRestDays.includes(weekday(date)) && !holidayMap.has(date))
  const eligibleDates = standardDates.filter((date) => (!employment.start || date >= employment.start) && (!employment.end || date <= employment.end))
  const eligibleSet = new Set(eligibleDates)
  let paidDays = 0
  let unpaidDays = 0
  let pendingDays = 0
  let benefitReviewDays = 0
  let autoPaidDays = 0
  const days = monthDateKeys(normalizedPeriod).map((date) => {
    const restDay = weeklyRestDays.includes(weekday(date))
    const holiday = holidayMap.get(date)
    const eligible = eligibleSet.has(date)
    const record = attendanceByDate.get(date)
    const teachingSlotCount = teachingSlotsByDate.get(date)?.size || 0
    let status = restDay ? 'weekly_rest' : holiday ? 'paid_holiday' : eligible ? (record?.status || (date > effectiveToday ? 'upcoming' : 'pending')) : 'outside_employment'
    if (!record && eligible && date <= effectiveToday && teachingSlotCount >= AUTO_FULL_DAY_TEACHING_SLOT_THRESHOLD) {
      status = 'auto_present_teaching'
      autoPaidDays += 1
    }
    if (record && eligible) status = ATTENDANCE_STATUSES.has(record.status) ? record.status : 'pending'
    if (eligible) {
      if (PAID_ATTENDANCE_STATUSES.has(status) || status === 'auto_present_teaching') paidDays += 1
      else if (UNPAID_ATTENDANCE_STATUSES.has(status)) unpaidDays += 1
      else if (status === 'pending') pendingDays += 1
      else if (status === 'sick_leave' || status === 'maternity_leave') benefitReviewDays += 1
    }
    return {
      date,
      weekday: weekday(date),
      status,
      eligible,
      holidayName: holiday?.name || '',
      note: typeof record?.note === 'string' ? record.note : '',
      revision: Number(record?.revision || 0),
      teachingSlotCount,
      source: record ? 'admin_override' : status === 'auto_present_teaching' ? 'teaching_slots' : 'calendar',
    }
  })
  const standardWorkdays = standardDates.length
  const eligibleWorkdays = eligibleDates.length
  const estimatedPaidDays = Math.max(0, eligibleWorkdays - unpaidDays - benefitReviewDays)
  const dailyRate = standardWorkdays ? baseSalary / standardWorkdays : 0
  const baseSalaryEarned = Math.round(dailyRate * estimatedPaidDays)
  const workdayEnabled = baseSalary > 0
  const calendarReviewRequired = workdayEnabled && calendar.approved !== true
  const attendanceReviewRequired = workdayEnabled && (pendingDays > 0 || benefitReviewDays > 0)
  return {
    standardWorkdays,
    eligibleWorkdays,
    paidDays,
    unpaidDays,
    pendingDays,
    benefitReviewDays,
    estimatedPaidDays,
    dailyRate: Math.round(dailyRate),
    baseSalary,
    baseSalaryEarned,
    fixedBonus,
    employmentType,
    employmentLevel,
    workdayEnabled,
    autoPaidDays,
    autoFullDayTeachingSlotThreshold: AUTO_FULL_DAY_TEACHING_SLOT_THRESHOLD,
    calendarReviewRequired,
    attendanceReviewRequired,
    reviewRequired: calendarReviewRequired || attendanceReviewRequired,
    employment,
    days,
  }
}

function iso(value) {
  return value?.toDate?.().toISOString?.() || ''
}

function publicIdentity(staff = {}, trainer = {}, user = {}) {
  return {
    name: staff.name || staff.fullName || staff.displayName || trainer.name || trainer.fullName || user.name || user.fullName || user.displayName || 'Chưa cập nhật tên',
    employeeCode: staff.employeeCode || trainer.employeeCode || '',
    branchId: staff.branchId || trainer.branchId || user.branchId || '',
    photoURL: staff.photoURL || trainer.photoURL || user.photoURL || '',
    employmentType: normalizedEmploymentType(staff.employmentType || trainer.employmentType),
    employmentLevel: normalizedEmploymentLevel(staff.employmentLevel || trainer.employmentLevel),
    payrollPolicyId: typeof (staff.payrollPolicyId || trainer.payrollPolicyId) === 'string' ? (staff.payrollPolicyId || trainer.payrollPolicyId) : '',
  }
}

function requireSelfPayroll(actor) {
  if (!actor.capabilities.includes('payroll.self.view') && !actor.capabilities.includes('payroll.operations.manage')) {
    throw new HttpsError('permission-denied', 'Bạn chưa có quyền xem bảng lương cá nhân.')
  }
}

function staffDocumentId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(result)) throw new HttpsError('invalid-argument', 'Mã nhân viên không hợp lệ.')
  return result
}

async function loadIdentity(db, staffId, uid = staffId) {
  const [staffSnapshot, trainerSnapshot, userSnapshot] = await Promise.all([
    db.doc(`staff/${staffId}`).get(),
    db.doc(`trainers/${staffId}`).get(),
    db.doc(`users/${uid}`).get(),
  ])
  const staff = staffSnapshot.exists ? staffSnapshot.data() : {}
  const trainer = trainerSnapshot.exists ? trainerSnapshot.data() : {}
  const user = userSnapshot.exists ? userSnapshot.data() : {}
  return { staff: { ...trainer, ...staff }, identity: publicIdentity(staff, trainer, user) }
}

async function loadCalendar(db, periodId, branchId) {
  const [globalSnapshot, branchSnapshot] = await Promise.all([
    db.doc(`workCalendars/global_${periodId}`).get(),
    branchId ? db.doc(`workCalendars/${branchId}_${periodId}`).get() : Promise.resolve(null),
  ])
  return mergeWorkCalendar(
    periodId,
    globalSnapshot?.exists ? globalSnapshot.data() : {},
    branchSnapshot?.exists ? branchSnapshot.data() : {},
  )
}

async function loadAttendance(db, staffId, periodId) {
  const snapshot = await db.collection('staffAttendanceDays')
    .where('staffId', '==', staffId)
    .where('periodId', '==', periodId)
    .limit(40)
    .get()
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data(), updatedAt: iso(item.data().updatedAt) }))
}

function sessionTeachingHour(value, sessionId) {
  const direct = Number(value)
  if (Number.isInteger(direct) && direct >= 0 && direct <= 23) return direct
  const legacy = Number(String(sessionId || '').split('-')[1])
  return Number.isInteger(legacy) && legacy >= 0 && legacy <= 23 ? legacy : -1
}

async function loadTeachingEvidence(db, periodId, staffId = '') {
  const lastDate = monthDateKeys(periodId).at(-1)
  let query = db.collection('sessions')
    .where('date', '>=', `${periodId}-01`)
    .where('date', '<=', lastDate)
  if (staffId) query = query.where('trainerId', '==', staffId)
  const snapshot = await query.limit(5001).get()
  const byStaff = new Map()
  snapshot.docs.slice(0, 5000).forEach((item) => {
    const session = item.data() || {}
    if (!['completed', 'attended'].includes(session.status)) return
    const trainerId = typeof session.trainerId === 'string' ? session.trainerId : ''
    const date = optionalDateKey(session.date)
    const hour = sessionTeachingHour(session.hour, item.id)
    if (!trainerId || !date || hour < 0) return
    const key = `${trainerId}-${date}-${hour}`
    const current = byStaff.get(trainerId) || new Map()
    const slot = current.get(key) || {
      key, date, hour, branchId: session.branchId || '',
      studentIds: new Set(), sessionIds: new Set(),
    }
    if (session.studentId) slot.studentIds.add(session.studentId)
    slot.sessionIds.add(item.id)
    current.set(key, slot)
    byStaff.set(trainerId, current)
  })
  const publicSlots = (slots) => {
    const dailyPositions = new Map()
    return [...slots.values()]
      .sort((left, right) => left.date.localeCompare(right.date) || left.hour - right.hour)
      .map((slot) => {
        const dailyPosition = Number(dailyPositions.get(slot.date) || 0) + 1
        dailyPositions.set(slot.date, dailyPosition)
        return {
          key: slot.key, date: slot.date, hour: slot.hour, branchId: slot.branchId,
          dailyPosition, tier: 'standard', rate: 0, policyId: '',
          policyName: 'Chờ lập kỳ lương', studentCount: slot.studentIds.size,
          sessionIds: [...slot.sessionIds],
        }
      })
  }
  return {
    byStaff: new Map([...byStaff.entries()].map(([id, slots]) => [id, publicSlots(slots)])),
    truncated: snapshot.size > 5000,
  }
}

function payrollAmounts(workdays, payrollItem = {}) {
  const teachingPay = safeMoney(payrollItem.teachingPayAmount ?? payrollItem.grossAmount)
  const commissions = safeMoney(payrollItem.commissionAmount)
  const fixedBonus = workdays.fixedBonus
  const adjustment = Number.isSafeInteger(Number(payrollItem.adjustmentAmount)) ? Number(payrollItem.adjustmentAmount) : 0
  const deductions = safeMoney(payrollItem.deductionAmount)
  const grossAmount = workdays.baseSalaryEarned + teachingPay + commissions + fixedBonus
  return {
    baseSalaryAmount: workdays.baseSalaryEarned,
    teachingPayAmount: teachingPay,
    commissionAmount: commissions,
    bonusAmount: fixedBonus,
    adjustmentAmount: adjustment,
    deductionAmount: deductions,
    grossAmount,
    finalAmount: Math.max(0, grossAmount + adjustment - deductions),
  }
}

function createStaffPayrollFunctions({ db, onCall, logger, priceTeachingSlots, payrollPolicyProfiles, payrollProfile, policySupportsProfile }) {
  const knownCallableCodes = new Set([
    'aborted',
    'already-exists',
    'deadline-exceeded',
    'failed-precondition',
    'invalid-argument',
    'not-found',
    'permission-denied',
    'resource-exhausted',
    'unauthenticated',
    'unavailable',
  ])
  const observedCall = (operation, handler) => onCall(async (request) => {
    try {
      return await handler(request)
    } catch (error) {
      const code = String(error?.code || '').replace(/^functions\//, '')
      if (knownCallableCodes.has(code)) throw error
      const incidentId = `PAY-${randomUUID().slice(0, 8).toUpperCase()}`
      logger?.error?.('staff_payroll_internal_error', {
        operation,
        incidentId,
        errorName: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'unknown',
        schemaVersion: 1,
      })
      throw new HttpsError(
        'internal',
        `Dịch vụ lương chưa hoàn tất yêu cầu. Mã đối soát ${incidentId}.`,
        { incidentId },
      )
    }
  })

  const getMyStaffPayroll = observedCall('getMyStaffPayroll', async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireSelfPayroll(actor)
    const periodId = payrollPeriod(request.data?.periodId)
    const staffId = staffDocumentId(actor.legacyStaffId || actor.uid)
    const { staff, identity } = await loadIdentity(db, staffId, actor.uid)
    const branchId = identity.branchId || actor.branchIds[0] || ''
    const [calendar, attendance, runSnapshot, itemSnapshot, teachingEvidence, policySnapshot] = await Promise.all([
      loadCalendar(db, periodId, branchId),
      loadAttendance(db, staffId, periodId),
      db.doc(`payrollRuns/${periodId}`).get(),
      db.doc(`payrollRunItems/${periodId}_${staffId}`).get(),
      loadTeachingEvidence(db, periodId, staffId),
      db.collection('payrollPolicies').orderBy('effectiveFrom', 'desc').limit(100).get(),
    ])
    const payrollItem = itemSnapshot.exists ? itemSnapshot.data() : {}
    const storedTeachingSlots = Array.isArray(payrollItem.teachingSlots) && payrollItem.teachingSlots.length
      ? payrollItem.teachingSlots
      : (teachingEvidence.byStaff.get(staffId) || [])
    const profile = payrollProfile(staff)
    const policies = policySnapshot.docs
      .map((snapshot) => {
        const data = snapshot.data() || {}
        return {
          id: snapshot.id,
          name: data.name || 'Chính sách lương PT',
          audience: data.audience === 'collaborator' || data.audience === 'all' ? data.audience : 'employee',
          eligibleProfiles: payrollPolicyProfiles(data.eligibleProfiles, data.audience),
          effectiveDate: optionalDateKey(data.effectiveFrom),
          status: data.status === 'inactive' ? 'inactive' : 'active',
          configuration: data,
        }
      })
      .filter((policy) => policy.status === 'active' && policy.effectiveDate && policy.effectiveDate <= `${periodId}-31` && policySupportsProfile(policy, profile))
    const assignedPolicy = policies.find((policy) => policy.id === staff.payrollPolicyId)
    const previewPolicy = assignedPolicy || policies[0]
    const teachingSlots = itemSnapshot.exists || !previewPolicy || typeof priceTeachingSlots !== 'function'
      ? storedTeachingSlots
      : priceTeachingSlots(storedTeachingSlots, () => previewPolicy)
    const workdays = calculateWorkdayPayroll({ periodId, calendar, attendance, teachingSlots, staff })
    const previewCommissionPerSession = workdays.employmentType === 'collaborator' ? 0 : safeMoney(staff.commissionPerSession, 10_000_000)
    const amountSource = itemSnapshot.exists ? payrollItem : {
      teachingPayAmount: teachingSlots.reduce((total, slot) => total + safeMoney(slot.rate, 10_000_000), 0),
      commissionAmount: Math.min(5_000_000_000, teachingSlots.length * previewCommissionPerSession),
    }
    const amounts = payrollAmounts(workdays, amountSource)
    const run = runSnapshot.exists ? runSnapshot.data() : {}
    const official = ['locked', 'paid'].includes(run.status) && Number(run.schemaVersion || 0) >= 5
    return {
      schemaVersion: 1,
      periodId,
      identity,
      calendar,
      workdays,
      amounts: official ? {
        ...amounts,
        baseSalaryAmount: safeMoney(payrollItem.baseSalaryAmount ?? amounts.baseSalaryAmount),
        teachingPayAmount: safeMoney(payrollItem.teachingPayAmount ?? amounts.teachingPayAmount),
        commissionAmount: safeMoney(payrollItem.commissionAmount ?? amounts.commissionAmount),
        bonusAmount: safeMoney(payrollItem.bonusAmount ?? amounts.bonusAmount),
        deductionAmount: safeMoney(payrollItem.deductionAmount ?? amounts.deductionAmount),
        grossAmount: safeMoney(payrollItem.grossAmount ?? amounts.grossAmount),
        finalAmount: safeMoney(payrollItem.finalAmount ?? amounts.finalAmount),
      } : amounts,
      teachingSlots,
      teachingEvidence: {
        slotCount: teachingSlots.length,
        truncated: teachingEvidence.truncated,
        source: Array.isArray(payrollItem.teachingSlots) && payrollItem.teachingSlots.length ? 'payroll_run' : previewPolicy ? 'attendance_sessions+assigned_policy' : 'attendance_sessions',
      },
      compensationPolicy: previewPolicy ? {
        id: previewPolicy.id,
        name: previewPolicy.name,
        eligibleProfiles: previewPolicy.eligibleProfiles,
        payrollProfile: profile,
        assigned: previewPolicy.id === staff.payrollPolicyId,
        estimated: !itemSnapshot.exists,
      } : {
        id: '', name: 'Chưa gán chính sách', eligibleProfiles: [], payrollProfile: profile, assigned: false, estimated: true,
      },
      tierSummary: payrollItem.tierSummary && typeof payrollItem.tierSummary === 'object' ? payrollItem.tierSummary : {},
      run: {
        exists: runSnapshot.exists,
        status: run.status || 'estimating',
        official,
        updatedAt: iso(run.updatedAt),
        paidAt: iso(run.paidAt),
      },
      generatedAt: new Date().toISOString(),
    }
  })

  const listStaffPayrollAttendance = observedCall('listStaffPayrollAttendance', async (request) => {
    await payrollActorForAdmin(request, db)
    const periodId = payrollPeriod(request.data?.periodId)
    const branchFilter = typeof request.data?.branchId === 'string' ? request.data.branchId.trim() : ''
    const [staffSnapshot, assignmentSnapshot, attendanceSnapshot, calendarSnapshot, teachingEvidence, policySnapshot] = await Promise.all([
      db.collection('staff').limit(450).get(),
      db.collection('roleAssignments').where('accessRole', '==', 'staff').limit(450).get(),
      db.collection('staffAttendanceDays').where('periodId', '==', periodId).limit(5000).get(),
      db.collection('workCalendars').where('periodId', '==', periodId).limit(100).get(),
      loadTeachingEvidence(db, periodId),
      db.collection('payrollPolicies').orderBy('effectiveFrom', 'desc').limit(100).get(),
    ])
    const attendanceByStaff = new Map()
    attendanceSnapshot.docs.forEach((item) => {
      const value = item.data()
      const current = attendanceByStaff.get(value.staffId) || []
      current.push(value)
      attendanceByStaff.set(value.staffId, current)
    })
    const calendars = new Map(calendarSnapshot.docs.map((item) => [item.data().branchId || 'global', item.data()]))
    const globalCalendar = calendars.get('global') || {}
    const policies = policySnapshot.docs.map((snapshot) => {
      const data = snapshot.data() || {}
      return {
        id: snapshot.id,
        name: data.name || 'Chính sách lương PT',
        status: data.status === 'inactive' ? 'inactive' : 'active',
        effectiveDate: optionalDateKey(data.effectiveFrom),
        eligibleProfiles: payrollPolicyProfiles(data.eligibleProfiles, data.audience),
        configuration: data,
      }
    }).filter((policy) => policy.status === 'active' && policy.effectiveDate && policy.effectiveDate <= `${periodId}-31`)
    const staffById = new Map(staffSnapshot.docs
      .map((item) => ({ id: item.id, userId: item.id, ...item.data() }))
      .map((staff) => [staff.id, staff]))
    assignmentSnapshot.docs.forEach((item) => {
      const assignment = item.data()
      if (assignment.status === 'suspended' || assignment.status === 'invited') return
      const operationalId = typeof assignment.crmProfileId === 'string' && assignment.crmProfileId ? assignment.crmProfileId : item.id
      const existing = staffById.get(operationalId) || {}
      staffById.set(operationalId, {
        ...existing,
        id: operationalId,
        userId: item.id,
        branchId: existing.branchId || assignment.branchIds?.[0] || '',
        status: existing.status || 'active',
      })
    })
    const staffValues = [...staffById.values()]
    const userSnapshots = staffValues.length
      ? await db.getAll(...staffValues.map((staff) => db.doc(`users/${staff.userId || staff.id}`)))
      : []
    const userByStaffId = new Map(staffValues.map((staff, index) => [staff.id, userSnapshots[index]?.exists ? userSnapshots[index].data() : {}]))
    const rows = staffValues
      .filter((staff) => staff.status !== 'inactive' && (!branchFilter || staff.branchId === branchFilter))
      .map((staff) => {
        const user = userByStaffId.get(staff.id) || {}
        const calendar = mergeWorkCalendar(periodId, globalCalendar, calendars.get(staff.branchId) || {})
        const teachingSlots = teachingEvidence.byStaff.get(staff.id) || []
        const profile = payrollProfile(staff)
        const eligiblePolicies = policies.filter((policy) => policySupportsProfile(policy, profile))
        const assignedPolicy = eligiblePolicies.find((policy) => policy.id === staff.payrollPolicyId)
        let policyConfigured = teachingSlots.length === 0 || eligiblePolicies.length > 0
        let pricedTeachingSlots = []
        if (teachingSlots.length && eligiblePolicies.length && typeof priceTeachingSlots === 'function') {
          try {
            pricedTeachingSlots = priceTeachingSlots(teachingSlots, (slot) => {
              if (assignedPolicy?.effectiveDate <= slot.date) return assignedPolicy
              return eligiblePolicies.find((policy) => policy.effectiveDate <= slot.date)
            })
          } catch {
            policyConfigured = false
            pricedTeachingSlots = []
          }
        }
        const workdays = calculateWorkdayPayroll({ periodId, calendar, attendance: attendanceByStaff.get(staff.id) || [], teachingSlots: pricedTeachingSlots, staff })
        const commissionPerSession = workdays.employmentType === 'collaborator' ? 0 : safeMoney(staff.commissionPerSession, 10_000_000)
        const amounts = payrollAmounts(workdays, {
          teachingPayAmount: pricedTeachingSlots.reduce((total, slot) => total + safeMoney(slot.rate, 10_000_000), 0),
          commissionAmount: Math.min(5_000_000_000, pricedTeachingSlots.length * commissionPerSession),
        })
        return {
          staffId: staff.id,
          name: staff.name || staff.fullName || staff.displayName || user.name || user.fullName || user.displayName || 'Chưa cập nhật tên',
          branchId: staff.branchId || '',
          employmentType: workdays.employmentType,
          baseSalary: workdays.baseSalary,
          standardWorkdays: workdays.standardWorkdays,
          eligibleWorkdays: workdays.eligibleWorkdays,
          paidDays: workdays.paidDays,
          autoPaidDays: workdays.autoPaidDays,
          teachingSlotCount: teachingSlots.length,
          estimatedPaidDays: workdays.estimatedPaidDays,
          unpaidDays: workdays.unpaidDays,
          pendingDays: workdays.pendingDays + workdays.benefitReviewDays,
          baseSalaryEarned: workdays.baseSalaryEarned,
          teachingPayAmount: amounts.teachingPayAmount,
          commissionAmount: amounts.commissionAmount,
          bonusAmount: amounts.bonusAmount,
          grossAmount: amounts.grossAmount,
          finalAmount: amounts.finalAmount,
          policyName: assignedPolicy?.name || eligiblePolicies[0]?.name || '',
          policyConfigured,
          reviewRequired: workdays.reviewRequired,
          calendarApproved: calendar.approved,
        }
      })
    const summary = rows.reduce((result, row) => {
      result.activeStaffCount += 1
      result.teachingSlotCount += row.teachingSlotCount
      result.baseSalaryAmount += row.baseSalaryEarned
      result.teachingPayAmount += row.teachingPayAmount
      result.commissionAmount += row.commissionAmount
      result.bonusAmount += row.bonusAmount
      result.estimatedTotal += row.finalAmount
      if (row.reviewRequired) result.reviewRequiredCount += 1
      if (!row.policyConfigured) result.unconfiguredPolicyCount += 1
      return result
    }, {
      activeStaffCount: 0,
      teachingSlotCount: 0,
      baseSalaryAmount: 0,
      teachingPayAmount: 0,
      commissionAmount: 0,
      bonusAmount: 0,
      estimatedTotal: 0,
      reviewRequiredCount: 0,
      unconfiguredPolicyCount: 0,
    })
    return {
      periodId,
      asOfDate: dateKey(new Date()),
      rows,
      summary,
      truncated: staffSnapshot.size >= 450 || assignmentSnapshot.size >= 450 || attendanceSnapshot.size >= 5000 || teachingEvidence.truncated || policySnapshot.size >= 100,
    }
  })

  const getStaffPayrollAttendanceDetail = observedCall('getStaffPayrollAttendanceDetail', async (request) => {
    await payrollActorForAdmin(request, db)
    const periodId = payrollPeriod(request.data?.periodId)
    const staffId = staffDocumentId(request.data?.staffId)
    const assignmentSnapshot = await db.collection('roleAssignments').where('crmProfileId', '==', staffId).limit(2).get()
    const userId = assignmentSnapshot.size === 1 ? assignmentSnapshot.docs[0].id : staffId
    const { staff, identity } = await loadIdentity(db, staffId, userId)
    const calendar = await loadCalendar(db, periodId, identity.branchId)
    const [attendance, teachingEvidence] = await Promise.all([
      loadAttendance(db, staffId, periodId),
      loadTeachingEvidence(db, periodId, staffId),
    ])
    const teachingSlots = teachingEvidence.byStaff.get(staffId) || []
    return {
      periodId,
      staffId,
      identity,
      calendar,
      workdays: calculateWorkdayPayroll({ periodId, calendar, attendance, teachingSlots, staff }),
      teachingEvidence: { slotCount: teachingSlots.length, truncated: teachingEvidence.truncated },
    }
  })

  const saveStaffAttendanceDay = observedCall('saveStaffAttendanceDay', async (request) => {
    const actor = await payrollActorForAdmin(request, db)
    const staffId = staffDocumentId(request.data?.staffId)
    const date = dateKey(request.data?.date)
    const periodId = payrollPeriod(date.slice(0, 7))
    const status = attendanceStatus(request.data?.status)
    const note = typeof request.data?.note === 'string' ? request.data.note.trim().slice(0, 300) : ''
    const reference = db.doc(`staffAttendanceDays/${staffId}_${date.replaceAll('-', '')}`)
    return db.runTransaction(async (transaction) => {
      const [staffSnapshot, current] = await Promise.all([
        transaction.get(db.doc(`staff/${staffId}`)),
        transaction.get(reference),
      ])
      if (!staffSnapshot.exists || staffSnapshot.data().status === 'inactive') {
        throw new HttpsError('not-found', 'Không tìm thấy nhân viên đang hoạt động.')
      }
      const revision = Number(current.data()?.revision || 0) + 1
      transaction.set(reference, {
        schemaVersion: 1,
        staffId,
        periodId,
        date,
        status,
        note,
        revision,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        ...(!current.exists ? { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid } : {}),
      }, { merge: true })
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 1,
        action: 'staff_attendance.updated',
        staffId,
        date,
        before: current.exists ? { status: current.data().status || '', revision: Number(current.data().revision || 0) } : null,
        after: { status, revision },
        actorUid: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { staffId, date, status, revision }
    })
  })

  const fillMissingStaffAttendanceDays = observedCall('fillMissingStaffAttendanceDays', async (request) => {
    const actor = await payrollActorForAdmin(request, db)
    const staffId = staffDocumentId(request.data?.staffId)
    const periodId = payrollPeriod(request.data?.periodId)
    const { staff, identity } = await loadIdentity(db, staffId)
    if (!Object.keys(staff).length || staff.status === 'inactive') throw new HttpsError('not-found', 'Không tìm thấy nhân viên đang hoạt động.')
    const [calendar, attendance, teachingEvidence] = await Promise.all([
      loadCalendar(db, periodId, identity.branchId),
      loadAttendance(db, staffId, periodId),
      loadTeachingEvidence(db, periodId, staffId),
    ])
    const teachingSlots = teachingEvidence.byStaff.get(staffId) || []
    const workdays = calculateWorkdayPayroll({ periodId, calendar, attendance, teachingSlots, staff })
    if (!workdays.workdayEnabled) {
      return { staffId, periodId, createdCount: 0, unchanged: true, reason: 'workday_salary_disabled' }
    }
    const targetDates = workdays.days
      .filter((day) => day.eligible && day.status === 'pending')
      .map((day) => day.date)
    if (!targetDates.length) return { staffId, periodId, createdCount: 0, unchanged: true }
    return db.runTransaction(async (transaction) => {
      const references = targetDates.map((date) => db.doc(`staffAttendanceDays/${staffId}_${date.replaceAll('-', '')}`))
      const current = await Promise.all(references.map((reference) => transaction.get(reference)))
      let createdCount = 0
      references.forEach((reference, index) => {
        if (current[index].exists) return
        const date = targetDates[index]
        transaction.create(reference, {
          schemaVersion: 1,
          staffId,
          periodId,
          date,
          status: 'present',
          note: 'Chốt ngày công còn thiếu bởi quản trị',
          revision: 1,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
        createdCount += 1
      })
      if (createdCount) transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 1,
        action: 'staff_attendance.missing_days_filled',
        staffId,
        periodId,
        createdCount,
        actorUid: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { staffId, periodId, createdCount, unchanged: createdCount === 0 }
    })
  })

  const saveWorkCalendar = observedCall('saveWorkCalendar', async (request) => {
    const actor = await payrollActorForAdmin(request, db)
    const periodId = payrollPeriod(request.data?.periodId)
    const branchId = request.data?.branchId ? staffDocumentId(request.data.branchId) : 'global'
    const weeklyRestDays = normalizedWeeklyRestDays(request.data?.weeklyRestDays)
    const holidays = normalizedHolidays(request.data?.holidays, periodId)
    const expectedRevision = Number(request.data?.expectedRevision || 0)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản lịch làm việc không hợp lệ.')
    const reference = db.doc(`workCalendars/${branchId}_${periodId}`)
    return db.runTransaction(async (transaction) => {
      const current = await transaction.get(reference)
      const currentRevision = Number(current.data()?.revision || 0)
      if (currentRevision !== expectedRevision) throw new HttpsError('aborted', 'Lịch làm việc đã thay đổi. Hãy tải lại trước khi lưu.')
      const revision = currentRevision + 1
      transaction.set(reference, {
        schemaVersion: 1,
        periodId,
        branchId,
        weeklyRestDays,
        holidays,
        status: 'approved',
        revision,
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(!current.exists ? { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid } : {}),
      }, { merge: true })
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 1,
        action: 'work_calendar.approved',
        periodId,
        branchId,
        revision,
        holidayCount: holidays.length,
        actorUid: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { periodId, branchId, revision, status: 'approved' }
    })
  })

  const submitMyPayrollInquiry = observedCall('submitMyPayrollInquiry', async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireSelfPayroll(actor)
    const periodId = payrollPeriod(request.data?.periodId)
    const category = ['attendance', 'teaching', 'commission', 'deduction', 'other'].includes(request.data?.category) ? request.data.category : 'other'
    const message = typeof request.data?.message === 'string' ? request.data.message.trim().replace(/\s+/g, ' ').slice(0, 1000) : ''
    if (message.length < 10) throw new HttpsError('invalid-argument', 'Nội dung phản hồi cần tối thiểu 10 ký tự.')
    const reference = db.collection('staffPayrollInquiries').doc()
    await reference.set({
      schemaVersion: 1,
      staffId: actor.legacyStaffId || actor.uid,
      userId: actor.uid,
      periodId,
      category,
      message,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { inquiryId: reference.id, status: 'open' }
  })

  return {
    getMyStaffPayroll,
    listStaffPayrollAttendance,
    getStaffPayrollAttendanceDetail,
    saveStaffAttendanceDay,
    fillMissingStaffAttendanceDays,
    saveWorkCalendar,
    submitMyPayrollInquiry,
  }
}

async function payrollActorForAdmin(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'payroll.operations.manage')
  return actor
}

module.exports = {
  createStaffPayrollFunctions,
  payrollPeriod,
  monthDateKeys,
  mergeWorkCalendar,
  calculateWorkdayPayroll,
  payrollAmounts,
}
