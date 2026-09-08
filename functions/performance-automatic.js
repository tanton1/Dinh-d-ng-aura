const AUTO_SOURCE = 'system_auto'
const MAX_SOURCE_ROWS = 2000

function finite(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function timestampMillis(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  if (typeof value === 'number') return value
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function periodRange(period, today = new Date()) {
  const [year, month] = period.split('-').map(Number)
  const start = `${period}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const end = `${period}-${String(lastDay).padStart(2, '0')}`
  const vietnamToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(today)
  const effectiveEnd = vietnamToday.startsWith(`${period}-`) ? vietnamToday : vietnamToday < start ? '' : end
  return {
    start,
    end,
    effectiveEnd,
    isCurrentPeriod: vietnamToday.startsWith(`${period}-`),
    startInstant: new Date(`${start}T00:00:00+07:00`),
    endExclusiveInstant: new Date(new Date(`${end}T00:00:00+07:00`).getTime() + 86_400_000),
  }
}

function documentRows(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

function uniqueRows(snapshots) {
  const values = new Map()
  snapshots.forEach((snapshot) => documentRows(snapshot).forEach((item) => values.set(item.id, item)))
  return [...values.values()]
}

async function safeQueries(queries, label, warnings) {
  const settled = await Promise.allSettled(queries.map((query) => query.get()))
  const successful = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value)
  const failed = settled.filter((item) => item.status === 'rejected')
  if (failed.length) warnings.push(`${label}: ${failed.length} truy vấn không hoàn tất`)
  if (successful.some((snapshot) => snapshot.size >= MAX_SOURCE_ROWS)) warnings.push(`${label}: chạm giới hạn ${MAX_SOURCE_ROWS} bản ghi`)
  return uniqueRows(successful)
}

function chunks(values, size = 30) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

async function getAllChunks(db, references, size = 100) {
  const values = []
  for (const group of chunks(references, size)) values.push(...await db.getAll(...group))
  return values
}

function aliases(target) {
  return [...new Set([target.staffId, target.ownerUid].filter(Boolean))]
}

function dateKey(value) {
  if (typeof value === 'string') return value.slice(0, 10)
  const millis = timestampMillis(value)
  return millis ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(millis)) : ''
}

function inRange(value, range) {
  const key = dateKey(value)
  return Boolean(key && key >= range.start && key <= range.end)
}

function inEffectiveRange(value, range) {
  const key = dateKey(value)
  return Boolean(range.effectiveEnd && key && key >= range.start && key <= range.effectiveEnd)
}

function contractOverlaps(contract, range) {
  const start = dateKey(contract.startDate) || '0000-00-00'
  const end = dateKey(contract.endDate) || '9999-99-99'
  return start <= range.end && end >= range.start && contract.status !== 'cancelled'
}

function trainerContract(contract, ids) {
  return ids.includes(contract.trainerId) || (Array.isArray(contract.trainerIds) && contract.trainerIds.some((id) => ids.includes(id)))
}

function nutritionContract(contract, ids) {
  return Array.isArray(contract.nutritionPTIds) && contract.nutritionPTIds.some((id) => ids.includes(id))
}

function ratioInput(numerator, denominator, note, collections, range, refs = []) {
  return automaticInput({ numerator, denominator, sampleSize: denominator, note, collections, range, refs })
}

function directScoreInput(score, sampleSize, note, collections, range, refs = []) {
  return automaticInput({
    manualScore: Number.isFinite(score) && sampleSize > 0 ? Math.round(score * 100) / 100 : null,
    sampleSize,
    note,
    collections,
    range,
    refs,
  })
}

function automaticInput({ actual = null, target = null, numerator = null, denominator = null, manualScore = null, sampleSize = 0, note, collections, range, refs = [], warnings = [] }) {
  return {
    source: AUTO_SOURCE,
    actual,
    target,
    numerator,
    denominator,
    manualScore,
    sampleSize,
    note,
    evidenceRefs: refs.slice(0, 20),
    provenance: {
      mode: 'automatic',
      collections,
      periodStart: range.start,
      periodEnd: range.effectiveEnd || range.end,
      generatedAt: new Date().toISOString(),
      completeness: warnings.length ? 'partial' : 'complete',
      warnings: warnings.slice(0, 10),
    },
  }
}

function mondayKey(value) {
  const date = new Date(`${value}T12:00:00+07:00`)
  const day = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - day)
  return date.toISOString().slice(0, 10)
}

function assignedStudentIds(contracts, range, ids, mode = 'training') {
  return [...new Set(contracts
    .filter((item) => contractOverlaps(item, range))
    .filter((item) => mode === 'nutrition' ? nutritionContract(item, ids) : trainerContract(item, ids))
    .map((item) => item.studentId)
    .filter(Boolean))]
}

async function loadOperationalSources(db, target, period) {
  const ids = aliases(target)
  const range = periodRange(period)
  const warnings = []
  const sessionQueries = ids.map((id) => db.collection('sessions')
    .where('trainerId', '==', id).where('date', '>=', range.start).where('date', '<=', range.end).limit(MAX_SOURCE_ROWS))
  const attendanceQueries = ids.map((id) => db.collection('attendanceEvents')
    .where('trainerId', '==', id).where('occurredAt', '>=', range.startInstant).where('occurredAt', '<', range.endExclusiveInstant).limit(MAX_SOURCE_ROWS))
  const contractQueries = ids.flatMap((id) => [
    db.collection('contracts').where('trainerId', '==', id).limit(MAX_SOURCE_ROWS),
    db.collection('contracts').where('trainerIds', 'array-contains', id).limit(MAX_SOURCE_ROWS),
    db.collection('contracts').where('nutritionPTIds', 'array-contains', id).limit(MAX_SOURCE_ROWS),
  ])
  const renewalQueries = ids.flatMap((id) => [
    db.collection('contractRenewalCases').where('contractSnapshot.trainerId', '==', id).limit(MAX_SOURCE_ROWS),
    db.collection('contractRenewalCases').where('contractSnapshot.trainerIds', 'array-contains', id).limit(MAX_SOURCE_ROWS),
    db.collection('contractRenewalCases').where('contractSnapshot.nutritionPTIds', 'array-contains', id).limit(MAX_SOURCE_ROWS),
  ])
  const [scheduledSessions, actualAttendanceEvents, contracts, renewalCases, careActivities, renewalActivities, ledgerEntries, salesLeads, contractApprovals, targetSnapshot, reviewSettings] = await Promise.all([
    safeQueries(sessionQueries, 'sessions', warnings),
    safeQueries(attendanceQueries, 'attendanceEvents', warnings),
    safeQueries(contractQueries, 'contracts', warnings),
    safeQueries(renewalQueries, 'contractRenewalCases', warnings),
    safeQueries(ids.map((id) => db.collection('studentCareActivities').where('actorUid', '==', id).where('createdAt', '>=', range.startInstant).where('createdAt', '<', range.endExclusiveInstant).limit(MAX_SOURCE_ROWS)), 'studentCareActivities', warnings),
    safeQueries(ids.map((id) => db.collection('contractRenewalActivities').where('actorUid', '==', id).where('createdAt', '>=', range.startInstant).where('createdAt', '<', range.endExclusiveInstant).limit(MAX_SOURCE_ROWS)), 'contractRenewalActivities', warnings),
    safeQueries(ids.map((id) => db.collection('ledgerEntries').where('referralStaffId', '==', id).where('effectiveAt', '>=', range.startInstant).where('effectiveAt', '<', range.endExclusiveInstant).limit(MAX_SOURCE_ROWS)), 'ledgerEntries', warnings),
    safeQueries(ids.map((id) => db.collection('salesLeads').where('assignedSalesId', '==', id).where('createdAt', '>=', range.startInstant).where('createdAt', '<', range.endExclusiveInstant).limit(MAX_SOURCE_ROWS)), 'salesLeads', warnings),
    safeQueries(ids.map((id) => db.collection('contractApprovals').where('createdBy', '==', id).where('createdAt', '>=', range.startInstant).where('createdAt', '<', range.endExclusiveInstant).limit(MAX_SOURCE_ROWS)), 'contractApprovals', warnings),
    db.doc(`payrollTargets/${period}`).get().catch(() => null),
    db.doc('system/nutrition_review_settings').get().catch(() => null),
  ])
  const actualSessionIds = [...new Set(actualAttendanceEvents.map((item) => item.sessionId || item.id).filter(Boolean))]
  const scheduledSessionIds = new Set(scheduledSessions.map((item) => item.id))
  const actualSessionSnapshots = actualSessionIds.length
    ? await getAllChunks(db, actualSessionIds.filter((sessionId) => !scheduledSessionIds.has(sessionId)).map((sessionId) => db.doc(`sessions/${sessionId}`)))
    : []
  const sessionsById = new Map(scheduledSessions.map((item) => [item.id, item]))
  actualSessionSnapshots.filter((item) => item.exists).forEach((item) => sessionsById.set(item.id, { id: item.id, ...item.data() }))
  const sessions = [...sessionsById.values()]
  const attendanceSnapshots = sessions.length
    ? await getAllChunks(db, sessions.map((item) => db.doc(`attendanceEvents/${item.id}`)))
    : []
  const attendanceBySession = new Map(attendanceSnapshots.filter((item) => item.exists).map((item) => {
    const value = item.data()
    return [value.sessionId || item.id, { id: item.id, ...value }]
  }))
  actualAttendanceEvents.forEach((item) => attendanceBySession.set(item.sessionId || item.id, item))
  const trainerStudents = assignedStudentIds(contracts, range, ids, 'training')
  const nutritionStudents = assignedStudentIds(contracts, range, ids, 'nutrition')
  const allStudents = [...new Set([...trainerStudents, ...nutritionStudents])]
  const [studentSnapshots, identityAssignments] = await Promise.all([
    allStudents.length ? getAllChunks(db, allStudents.map((id) => db.doc(`students/${id}`))) : [],
    allStudents.length ? safeQueries(chunks(allStudents).map((studentIds) => db.collection('roleAssignments').where('crmProfileId', 'in', studentIds)), 'roleAssignments', warnings) : [],
  ])
  const students = studentSnapshots.filter((item) => item.exists).map((item) => ({ id: item.id, ...item.data() }))
  const accountByStudent = new Map(students.map((item) => [item.id, item.accountUid || '']))
  identityAssignments.forEach((item) => {
    if (item.crmProfileId && allStudents.includes(item.crmProfileId) && !accountByStudent.get(item.crmProfileId)) accountByStudent.set(item.crmProfileId, item.id)
  })
  const studentBySubject = new Map(allStudents.map((studentId) => [studentId, studentId]))
  accountByStudent.forEach((accountUid, studentId) => { if (accountUid) studentBySubject.set(accountUid, studentId) })
  const allStudentSubjects = [...new Set([...allStudents, ...[...accountByStudent.values()].filter(Boolean)])]
  const nutritionSubjects = [...new Set(nutritionStudents.flatMap((studentId) => [studentId, accountByStudent.get(studentId)]).filter(Boolean))]
  const checkinQueries = chunks(allStudentSubjects).map((studentIds) => db.collection('dailyCheckins')
    .where('studentId', 'in', studentIds).where('date', '>=', range.start).where('date', '<=', range.end).limit(MAX_SOURCE_ROWS))
  const reviewQueries = chunks(nutritionSubjects).map((subjectIds) => db.collection('mealReviews')
    .where('userId', 'in', subjectIds).where('createdAt', '>=', range.startInstant).where('createdAt', '<', range.endExclusiveInstant).limit(MAX_SOURCE_ROWS))
  const [dailyCheckins, mealReviews, projections, workoutLogs] = await Promise.all([
    checkinQueries.length ? safeQueries(checkinQueries, 'dailyCheckins', warnings) : [],
    reviewQueries.length ? safeQueries(reviewQueries, 'mealReviews', warnings) : [],
    range.isCurrentPeriod && trainerStudents.length ? getAllChunks(db, trainerStudents.map((id) => db.doc(`studentOperationalViews/${id}`))) : [],
    sessions.length ? getAllChunks(db, sessions.map((item) => db.doc(`ptWorkoutLogs/${item.id}_${item.studentId}`))) : [],
  ])
  return {
    ids, range, warnings, sessions, contracts, renewalCases,
    careActivities: careActivities.filter((item) => inEffectiveRange(item.createdAtMillis || item.createdAt, range)),
    renewalActivities: renewalActivities.filter((item) => inRange(item.createdAt, range)),
    ledgerEntries, salesLeads: salesLeads.filter((item) => inRange(item.createdAt, range)),
    contractApprovals: contractApprovals.filter((item) => inRange(item.createdAt, range)),
    targets: targetSnapshot?.exists ? targetSnapshot.data()?.metricTargets || {} : {},
    reviewSlaMinutes: Math.max(15, finite(reviewSettings?.exists ? reviewSettings.data()?.slaMinutes : 0, 240)),
    attendanceBySession,
    trainerStudents,
    nutritionStudents,
    accountByStudent,
    dailyCheckins: dailyCheckins.map((item) => ({ ...item, canonicalStudentId: studentBySubject.get(item.studentId) || item.studentId })),
    mealReviews,
    projections: projections.filter((item) => item.exists).map((item) => ({ id: item.id, ...item.data() })),
    workoutLogs: workoutLogs.filter((item) => item.exists).map((item) => ({ id: item.id, ...item.data() })),
    projectionMetricsEnabled: range.isCurrentPeriod === true,
  }
}

function sessionMetrics(source) {
  const { ids, range, sessions, attendanceBySession, workoutLogs } = source
  const allDue = sessions.filter((item) => inEffectiveRange(item.date, range))
    .filter((item) => !['cancelled', 'canceled_by_student', 'student_cancelled'].includes(item.status))
  const logBySession = new Map(workoutLogs.map((item) => [item.sessionId || item.id.split('_')[0], item]))
  const scheduledDue = allDue.filter((session) => ids.includes(session.trainerId))
  const delivered = allDue.filter((session) => {
    const attendance = attendanceBySession.get(session.id)
    const actualTrainer = attendance?.trainerId || session.trainerId
    const terminal = ['present', 'late', 'no_show'].includes(attendance?.attendanceStatus)
      || ['completed', 'no_show'].includes(session.status)
    return terminal && ids.includes(actualTrainer)
  })
  const accountableDue = [...new Map([...scheduledDue, ...delivered].map((session) => [session.id, session])).values()]
  const scheduleKept = scheduledDue.filter((session) => !['trainer_cancelled'].includes(session.status)).filter((session) => {
    const attendance = attendanceBySession.get(session.id)
    return attendance || ['completed', 'no_show', 'rescheduled'].includes(session.status)
  })
  const notes = delivered.filter((session) => logBySession.get(session.id)?.status === 'completed')
  const refs = accountableDue.slice(0, 20).map((item) => `sessions/${item.id}`)
  return {
    attendance: automaticInput({
      actual: accountableDue.length ? Math.round(delivered.length / accountableDue.length * 10_000) / 100 : null,
      sampleSize: accountableDue.length,
      note: `${delivered.length}/${accountableDue.length} ca đến hạn thuộc trách nhiệm hoặc do PT thực tế dạy; loại ca học viên hủy.`,
      collections: ['sessions', 'attendanceEvents'], range, refs,
    }),
    schedule_management: directScoreInput(scheduleKept.length / Math.max(1, scheduledDue.length) * 2, scheduledDue.length,
      `${scheduleKept.length}/${scheduledDue.length} ca được xếp cho PT đã hoàn tất hoặc điều phối hợp lệ.`, ['sessions', 'attendanceEvents'], range, refs),
    training_notes: directScoreInput(notes.length / Math.max(1, delivered.length) * 2, delivered.length,
      `${notes.length}/${delivered.length} ca đã dạy có nhật ký tập hoàn tất và khóa.`, ['sessions', 'attendanceEvents', 'ptWorkoutLogs'], range,
      notes.slice(0, 20).map((item) => `ptWorkoutLogs/${logBySession.get(item.id)?.id}`)),
  }
}

function clientCareMetrics(source) {
  const { ids, range, contracts = [], trainerStudents, dailyCheckins, careActivities, projections, projectionMetricsEnabled = true } = source
  const weeks = new Set()
  if (range.effectiveEnd) {
    for (let cursor = new Date(`${range.start}T12:00:00+07:00`); cursor <= new Date(`${range.effectiveEnd}T12:00:00+07:00`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      weeks.add(mondayKey(cursor.toISOString().slice(0, 10)))
    }
  }
  const expectedCheckinKeys = new Set()
  trainerStudents.forEach((studentId) => {
    const assignments = contracts.filter((item) => item.studentId === studentId && trainerContract(item, ids) && contractOverlaps(item, range))
    weeks.forEach((week) => {
      const weekEnd = new Date(new Date(`${week}T12:00:00+07:00`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10)
      if (assignments.some((item) => (dateKey(item.startDate) || '0000-00-00') <= weekEnd && (dateKey(item.endDate) || '9999-99-99') >= week)) {
        expectedCheckinKeys.add(`${studentId}:${week}`)
      }
    })
  })
  const expectedCheckins = expectedCheckinKeys.size
  const completedCheckins = new Set(dailyCheckins
    .filter((item) => trainerStudents.includes(item.canonicalStudentId || item.studentId) && inEffectiveRange(item.date, range))
    .map((item) => `${item.canonicalStudentId || item.studentId}:${mondayKey(dateKey(item.date))}`)).size
  const careStudents = new Set(careActivities.map((item) => item.studentId).filter((id) => trainerStudents.includes(id)))
  const atRisk = projections.filter((item) => (item.alerts || []).some((alert) => alert.severity === 'red') || finite(item.health?.score, 100) < 60)
  const followedRisk = atRisk.filter((item) => careStudents.has(item.id)).length
  const reviewedProgress = projections.filter((item) => {
    const latest = dateKey(item.progress?.latestDate)
    return latest && latest >= range.start && latest <= range.end
  }).length
  const progressSamples = projections.filter((item) => item.attendance?.rate28Days !== null || item.training?.adherence28Days !== null)
  const progressIndex = progressSamples.length ? progressSamples.reduce((sum, item) => {
    const attendance = finite(item.attendance?.rate28Days, 0)
    const adherence = finite(item.training?.adherence28Days, 0)
    const measured = dateKey(item.progress?.latestDate) >= range.start ? 100 : 0
    return sum + attendance * .4 + adherence * .4 + measured * .2
  }, 0) / progressSamples.length : null
  const historicalProjectionWarning = 'Projection Học viên 360 chỉ phản ánh hiện tại; kỳ quá khứ phải dùng snapshot đã khóa.'
  const unavailableHistoricalProjection = (collections) => automaticInput({
    note: historicalProjectionWarning,
    collections,
    range,
    warnings: [historicalProjectionWarning],
  })
  return {
    client_progress: !projectionMetricsEnabled ? unavailableHistoricalProjection(['studentOperationalViews']) : directScoreInput(progressIndex === null ? null : progressIndex / 100 * 7, progressSamples.length,
      progressIndex === null ? 'Chưa có projection hành trình đủ dữ liệu trong kỳ.' : `Chỉ số hành trình trung bình ${Math.round(progressIndex)}%: attendance 40%, bám giáo án 40%, cân đo trong kỳ 20%.`,
      ['studentOperationalViews'], range, progressSamples.slice(0, 20).map((item) => `studentOperationalViews/${item.id}`)),
    weekly_checkin: ratioInput(completedCheckins, expectedCheckins,
      `${completedCheckins}/${expectedCheckins} lượt check-in tuần của học viên đang được giao.`, ['contracts', 'students', 'roleAssignments', 'dailyCheckins'], range),
    at_risk_followup: !projectionMetricsEnabled ? unavailableHistoricalProjection(['studentOperationalViews', 'studentCareActivities']) : ratioInput(followedRisk, atRisk.length,
      `${followedRisk}/${atRisk.length} học viên cảnh báo đỏ đã có hoạt động chăm sóc trong kỳ.`, ['studentOperationalViews', 'studentCareActivities'], range),
    progress_review: !projectionMetricsEnabled ? unavailableHistoricalProjection(['contracts', 'studentOperationalViews']) : ratioInput(reviewedProgress, trainerStudents.length,
      `${reviewedProgress}/${trainerStudents.length} học viên được giao có cân đo/tiến độ cập nhật trong kỳ.`, ['contracts', 'studentOperationalViews'], range),
    communication: directScoreInput(careStudents.size / Math.max(1, trainerStudents.length) * 2, trainerStudents.length,
      `${careStudents.size}/${trainerStudents.length} học viên được ghi nhận liên hệ/chăm sóc trong kỳ.`, ['contracts', 'studentCareActivities'], range),
  }
}

function nutritionMetrics(source) {
  const { ids, range, nutritionStudents, accountByStudent, dailyCheckins, mealReviews, reviewSlaMinutes } = source
  const subjects = new Set(nutritionStudents.flatMap((id) => [id, accountByStudent.get(id)]).filter(Boolean))
  const relevant = mealReviews.filter((item) => subjects.has(item.userId))
  const reviewed = relevant.filter((item) => (['approved', 'rejected'].includes(item.status) || item.reviewedBy) && ids.includes(item.reviewedBy))
  const withinSla = reviewed.filter((item) => {
    const created = timestampMillis(item.createdAt || item.meal?.createdAt)
    const completed = timestampMillis(item.reviewedAt || item.approvedAt || item.updatedAt) || finite(item.approvedAtTimestamp)
    return created && completed && completed >= created && completed - created <= reviewSlaMinutes * 60_000
  })
  const nutritionCheckins = dailyCheckins.filter((item) => nutritionStudents.includes(item.canonicalStudentId || item.studentId) && inEffectiveRange(item.date, range))
  const complianceValues = nutritionCheckins.map((item) => finite(item.compliance, NaN)).filter(Number.isFinite)
  const averageCompliance = complianceValues.length ? complianceValues.reduce((sum, value) => sum + value, 0) / complianceValues.length : null
  return {
    nutrition_review_completion: ratioInput(reviewed.length, relevant.length,
      `${reviewed.length}/${relevant.length} bữa gửi duyệt đã được coach xử lý.`, ['contracts', 'students', 'roleAssignments', 'mealReviews'], range,
      relevant.slice(0, 20).map((item) => `mealReviews/${item.id}`)),
    feedback_sla: ratioInput(withinSla.length, reviewed.length,
      `${withinSla.length}/${reviewed.length} phản hồi hoàn tất trong SLA ${reviewSlaMinutes} phút.`, ['students', 'roleAssignments', 'mealReviews', 'system/nutrition_review_settings'], range),
    compliance_management: directScoreInput(averageCompliance === null ? null : Math.max(0, Math.min(100, averageCompliance)) / 100 * 3, complianceValues.length,
      `Tuân thủ dinh dưỡng trung bình ${averageCompliance === null ? 'N/A' : Math.round(averageCompliance)}% trên ${complianceValues.length} check-in đã ghi.`, ['contracts', 'students', 'roleAssignments', 'dailyCheckins'], range),
  }
}

function renewalMetrics(source) {
  const { ids, range, renewalCases, renewalActivities } = source
  const assigned = renewalCases.filter((item) => {
    const contract = item.contractSnapshot || {}
    return ids.includes(contract.trainerId) || (contract.trainerIds || []).some((id) => ids.includes(id))
  })
  const closed = assigned.filter((item) => ['won', 'lost'].includes(item.stage) && inRange(item.wonAt || item.updatedAt, range))
  const won = closed.filter((item) => item.stage === 'won')
  const lost = closed.filter((item) => item.stage === 'lost')
  const due = assigned.filter((item) => {
    const endDate = dateKey(item.contractSnapshot?.endDate)
    return (endDate && endDate >= range.start && endDate <= range.end) || closed.includes(item)
  })
  const touchedCases = new Set(renewalActivities.filter((item) => inRange(item.createdAt, range)).map((item) => item.caseId))
  const processed = due.filter((item) => touchedCases.has(item.id) || inRange(item.lastContactAt, range) || ['won', 'lost'].includes(item.stage))
  const documented = lost.filter((item) => typeof item.lostReason === 'string' && item.lostReason.trim().length >= 3)
  const renewRate = closed.length ? won.length / closed.length * 100 : null
  const expectedValue = due.reduce((sum, item) => sum + Math.max(0, finite(item.expectedValue)), 0)
  const collectedValue = won.reduce((sum, item) => sum + Math.max(0, finite(item.collectedValue)), 0)
  return {
    renew_rate: automaticInput({ actual: renewRate === null ? null : Math.round(renewRate * 100) / 100, sampleSize: closed.length,
      note: `${won.length}/${closed.length} hồ sơ đến kết luận trong kỳ đã tái ký thành công.`, collections: ['contractRenewalCases'], range,
      refs: closed.slice(0, 20).map((item) => `contractRenewalCases/${item.id}`) }),
    renewal_process: ratioInput(processed.length, due.length,
      `${processed.length}/${due.length} hồ sơ đến hạn có tương tác hoặc kết luận trong kỳ.`, ['contractRenewalCases', 'contractRenewalActivities'], range),
    churn_documentation: ratioInput(documented.length, lost.length,
      `${documented.length}/${lost.length} hồ sơ mất tái ký có lý do churn hợp lệ.`, ['contractRenewalCases'], range),
    renew_cash_vs_forecast: automaticInput({ actual: expectedValue > 0 ? collectedValue : null, target: expectedValue || null, sampleSize: due.length,
      note: `${collectedValue.toLocaleString('vi-VN')}đ thực thu trên ${expectedValue.toLocaleString('vi-VN')}đ forecast hồ sơ đến hạn.`,
      collections: ['contractRenewalCases'], range, refs: due.slice(0, 20).map((item) => `contractRenewalCases/${item.id}`) }),
  }
}

async function businessMetrics(db, source) {
  const { ids, range, ledgerEntries, salesLeads, contractApprovals, targets } = source
  const attributed = ledgerEntries.filter((item) => ids.includes(item.referralStaffId) && item.status === 'posted')
  const netCash = Math.max(0, attributed.reduce((sum, item) => sum + finite(item.cashImpact ?? item.amount), 0))
  const revenueTarget = finite(targets.attributed_revenue)
  const approvalsByLead = new Map(contractApprovals.filter((item) => item.leadId).map((item) => [item.leadId, item]))
  const qualifiedLeads = salesLeads.filter((item) => ['qualified', 'submitted', 'converted'].includes(item.status) || approvalsByLead.has(item.id))
  const convertedLeads = qualifiedLeads.filter((item) => ['approved', 'converted'].includes(approvalsByLead.get(item.id)?.status || item.status))
  const conversionTarget = finite(targets.qualified_lead_conversion)
  const contractIds = [...new Set(attributed.map((item) => item.contractId).filter(Boolean))]
  const contractSnapshots = contractIds.length ? await getAllChunks(db, contractIds.map((id) => db.doc(`contracts/${id}`))) : []
  const contractById = new Map(contractSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]))
  const cashByContract = new Map()
  attributed.forEach((item) => cashByContract.set(item.contractId, finite(cashByContract.get(item.contractId)) + finite(item.cashImpact ?? item.amount)))
  const qualityReferrals = contractIds.filter((id) => {
    const total = Math.max(0, finite(contractById.get(id)?.totalPrice) - finite(contractById.get(id)?.discount))
    return total > 0 && finite(cashByContract.get(id)) >= total * .3
  })
  return {
    self_generated_revenue: automaticInput({ actual: revenueTarget > 0 ? netCash : null, target: revenueTarget || null, sampleSize: attributed.length,
      note: `${netCash.toLocaleString('vi-VN')}đ dòng tiền ròng có referralStaffId khớp PT trên target ${revenueTarget.toLocaleString('vi-VN')}đ đã duyệt.`,
      collections: ['ledgerEntries', 'payrollTargets'], range, refs: attributed.slice(0, 20).map((item) => `ledgerEntries/${item.id}`) }),
    qualified_lead_conversion: automaticInput({
      actual: conversionTarget > 0 && qualifiedLeads.length ? convertedLeads.length / qualifiedLeads.length * 100 : null,
      target: conversionTarget || null, sampleSize: qualifiedLeads.length,
      note: `${convertedLeads.length}/${qualifiedLeads.length} lead đủ chuẩn đã chuyển đổi; target ${conversionTarget}%.`,
      collections: ['salesLeads', 'contractApprovals', 'payrollTargets'], range,
    }),
    quality_new_referral: ratioInput(qualityReferrals.length, contractIds.length,
      `${qualityReferrals.length}/${contractIds.length} hợp đồng giới thiệu đạt tối thiểu 30% thực thu ròng.`, ['ledgerEntries', 'contracts'], range,
      qualityReferrals.slice(0, 20).map((id) => `contracts/${id}`)),
  }
}

async function automaticOperationalMetrics(db, target, period) {
  const source = await loadOperationalSources(db, target, period)
  const [business, sessions, clientCare, nutrition, renewal] = await Promise.all([
    businessMetrics(db, source),
    Promise.resolve(sessionMetrics(source)),
    Promise.resolve(clientCareMetrics(source)),
    Promise.resolve(nutritionMetrics(source)),
    Promise.resolve(renewalMetrics(source)),
  ])
  const values = { ...sessions, ...clientCare, ...nutrition, ...renewal, ...business }
  const metrics = Object.fromEntries(Object.entries(values).filter(([, value]) => value).map(([metricId, value]) => {
    const collections = value.provenance?.collections || []
    const relatedWarnings = source.warnings.filter((warning) => collections.some((collection) => warning.startsWith(`${collection}:`)))
    return [metricId, {
    ...value,
    provenance: {
      ...(value.provenance || {}),
      completeness: relatedWarnings.length || value.provenance?.completeness === 'partial' ? 'partial' : 'complete',
      warnings: [...new Set([...(value.provenance?.warnings || []), ...relatedWarnings])].slice(0, 10),
    },
  }]}))
  return {
    metrics,
    diagnostics: {
      sourceWarnings: source.warnings,
      trainerStudentCount: source.trainerStudents.length,
      nutritionStudentCount: source.nutritionStudents.length,
      sessionCount: source.sessions.length,
      projectionMetricsSkipped: source.projectionMetricsEnabled !== true,
      generatedAt: new Date().toISOString(),
    },
  }
}

module.exports = {
  AUTO_SOURCE,
  automaticOperationalMetrics,
  periodRange,
  sessionMetrics,
  clientCareMetrics,
  nutritionMetrics,
  renewalMetrics,
  businessMetrics,
}
