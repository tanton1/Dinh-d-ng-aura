const { createHash } = require('node:crypto')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

const TIME_ZONE = 'Asia/Ho_Chi_Minh'
const FEEDBACK_WINDOW_HOURS = 72
const FEEDBACK_EDIT_WINDOW_MINUTES = 15
const MAX_ADMIN_ROWS = 500
const ALLOWED_TAGS = new Set([
  'trainer_on_time',
  'clear_guidance',
  'good_technique_correction',
  'motivating',
  'appropriate_intensity',
  'caring',
  'workout_not_suitable',
  'trainer_late',
  'limited_guidance',
  'poor_attitude',
])
const ISSUE_CATEGORIES = new Set(['none', 'service', 'lateness', 'training_quality', 'safety', 'conduct'])
const ADMIN_STATUSES = new Set(['submitted', 'needs_review', 'reviewing', 'resolved'])

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

function dateKey(value, label) {
  const result = boundedString(value, label, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00+07:00`))) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function vietnamDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const part = (type) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function addDateDays(value, amount) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function storedHour(value, sessionId) {
  const fallback = Number(String(sessionId).split('-')[1])
  const result = Number.isInteger(value) ? value : fallback
  if (!Number.isInteger(result) || result < 0 || result > 23) {
    throw new HttpsError('failed-precondition', 'Giờ của buổi tập chưa hợp lệ.')
  }
  return result
}

function sessionEndInstant(session, sessionId) {
  const date = typeof session?.date === 'string' ? session.date.slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError('failed-precondition', 'Ngày của buổi tập chưa hợp lệ.')
  const hour = storedHour(session.hour, sessionId)
  const startsAt = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+07:00`)
  if (Number.isNaN(startsAt.getTime())) throw new HttpsError('failed-precondition', 'Thời gian buổi tập chưa hợp lệ.')
  return new Date(startsAt.getTime() + 60 * 60 * 1000)
}

function instant(value) {
  if (value && typeof value.toDate === 'function') return value.toDate()
  const result = value instanceof Date ? value : new Date(value || '')
  return Number.isNaN(result.getTime()) ? null : result
}

function feedbackId(sessionId, studentId) {
  return createHash('sha256').update(`${sessionId}|${studentId}`).digest('hex').slice(0, 40)
}

function normalizedFeedbackInput(value = {}) {
  const overallScore = Number(value.overallScore)
  if (!Number.isInteger(overallScore) || overallScore < 1 || overallScore > 5) {
    throw new HttpsError('invalid-argument', 'Mức đánh giá phải từ 1 đến 5.')
  }
  const rawTags = Array.isArray(value.tags) ? value.tags : []
  const tags = [...new Set(rawTags.filter((item) => typeof item === 'string' && ALLOWED_TAGS.has(item)))].slice(0, 6)
  if (rawTags.some((item) => !ALLOWED_TAGS.has(item))) throw new HttpsError('invalid-argument', 'Nhãn đánh giá không hợp lệ.')
  const comment = boundedString(value.comment, 'Nhận xét', 500, false)
  const issueCategory = ISSUE_CATEGORIES.has(value.issueCategory) ? value.issueCategory : 'none'
  return {
    overallScore,
    tags,
    comment,
    anonymousToTrainer: value.anonymousToTrainer === true,
    issueCategory,
  }
}

function feedbackReviewStatus(input) {
  return input.overallScore <= 2 || ['safety', 'conduct'].includes(input.issueCategory)
    ? 'needs_review'
    : 'submitted'
}

function feedbackEligibility({ session, attendance = {}, studentId, sessionId, now = new Date() }) {
  if (!session || session.studentId !== studentId) throw new HttpsError('permission-denied', 'Bạn chỉ có thể đánh giá buổi tập của chính mình.')
  const attendanceStatus = attendance.attendanceStatus || session.attendanceStatus || ''
  const eligibleAttendance = ['present', 'late'].includes(attendanceStatus)
    || (session.status === 'completed' && attendanceStatus !== 'no_show')
  if (!eligibleAttendance) throw new HttpsError('failed-precondition', 'Chỉ buổi đã tập mới có thể đánh giá PT.')
  const trainerId = typeof attendance.trainerId === 'string' && attendance.trainerId.trim()
    ? attendance.trainerId.trim()
    : typeof session.trainerId === 'string' ? session.trainerId.trim() : ''
  if (!trainerId) throw new HttpsError('failed-precondition', 'Buổi tập chưa xác định PT thực tế.')
  const endsAt = sessionEndInstant(session, sessionId)
  if (now.getTime() < endsAt.getTime()) throw new HttpsError('failed-precondition', 'Đánh giá sẽ mở sau khi buổi tập kết thúc.')
  const expiresAt = new Date(endsAt.getTime() + FEEDBACK_WINDOW_HOURS * 60 * 60 * 1000)
  if (now.getTime() > expiresAt.getTime()) throw new HttpsError('failed-precondition', 'Thời hạn đánh giá buổi tập đã kết thúc.')
  return { trainerId, endsAt, expiresAt, attendanceStatus: attendanceStatus || 'present' }
}

function feedbackSummary(rows, eligibleAttendanceCount = 0) {
  const total = rows.length
  const scoreTotal = rows.reduce((sum, item) => sum + Number(item.overallScore || 0), 0)
  const lowCount = rows.filter((item) => Number(item.overallScore || 0) <= 2).length
  const needsReview = rows.filter((item) => ['needs_review', 'reviewing'].includes(item.status)).length
  const byTrainer = new Map()
  rows.forEach((item) => {
    const key = item.trainerId || 'unknown'
    const current = byTrainer.get(key) || { trainerId: key, total: 0, scoreTotal: 0, lowCount: 0, needsReview: 0 }
    current.total += 1
    current.scoreTotal += Number(item.overallScore || 0)
    if (Number(item.overallScore || 0) <= 2) current.lowCount += 1
    if (['needs_review', 'reviewing'].includes(item.status)) current.needsReview += 1
    byTrainer.set(key, current)
  })
  return {
    total,
    averageScore: total ? Math.round(scoreTotal / total * 10) / 10 : 0,
    lowCount,
    needsReview,
    responseRate: eligibleAttendanceCount > 0 ? Math.min(100, Math.round(total / eligibleAttendanceCount * 1000) / 10) : 0,
    eligibleAttendanceCount,
    byTrainer: [...byTrainer.values()].map((item) => ({
      ...item,
      averageScore: item.total ? Math.round(item.scoreTotal / item.total * 10) / 10 : 0,
    })).sort((left, right) => right.total - left.total || left.trainerId.localeCompare(right.trainerId)),
  }
}

function serializedInstant(value) {
  const parsed = instant(value)
  return parsed ? parsed.toISOString() : null
}

async function documentsById(db, collectionName, values) {
  const ids = [...new Set(values.filter((value) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)))]
  if (!ids.length) return new Map()
  const result = new Map()
  for (let offset = 0; offset < ids.length; offset += 100) {
    const references = ids.slice(offset, offset + 100).map((id) => db.doc(`${collectionName}/${id}`))
    const snapshots = await db.getAll(...references)
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) result.set(snapshot.id, snapshot.data())
    })
  }
  return result
}

function createSessionFeedbackFunctions({ db, onCall }) {
  const call = (handler) => onCall({ cpu: 1, concurrency: 24, maxInstances: 6, invoker: 'public' }, handler)

  const learner = async (request) => {
    const actor = await trustedAccessContext(request, db)
    if (actor.accessRole !== 'student') throw new HttpsError('permission-denied', 'Chỉ học viên được đánh giá buổi tập của chính mình.')
    return { ...actor, studentId: actor.legacyStaffId || actor.uid }
  }

  const administrator = async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'pt.operations.manage')
    return actor
  }

  const getMyPendingSessionFeedback = call(async (request) => {
    const actor = await learner(request)
    const now = new Date()
    const today = vietnamDateKey(now)
    const from = addDateDays(today, -4)
    const sessionsSnapshot = await db.collection('sessions')
      .where('studentId', '==', actor.studentId)
      .where('date', '>=', from)
      .where('date', '<=', today)
      .orderBy('date', 'asc')
      .limit(100)
      .get()
    const attendanceSnapshots = sessionsSnapshot.empty
      ? []
      : await db.getAll(...sessionsSnapshot.docs.map((item) => db.doc(`attendanceEvents/${item.id}`)))
    const attendanceBySession = new Map(attendanceSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]))
    const candidates = []
    sessionsSnapshot.docs.forEach((snapshot) => {
      try {
        const session = snapshot.data()
        const eligibility = feedbackEligibility({ session, attendance: attendanceBySession.get(snapshot.id), studentId: actor.studentId, sessionId: snapshot.id, now })
        candidates.push({ snapshot, session, eligibility })
      } catch (error) {
        if (!(error instanceof HttpsError)) throw error
      }
    })
    const feedbackSnapshots = candidates.length
      ? await db.getAll(...candidates.map((item) => db.doc(`sessionFeedback/${feedbackId(item.snapshot.id, actor.studentId)}`)))
      : []
    const submitted = new Set(feedbackSnapshots.filter((item) => item.exists).map((item) => item.id))
    const pending = candidates.filter((item) => !submitted.has(feedbackId(item.snapshot.id, actor.studentId)))
    const trainers = await documentsById(db, 'trainers', pending.map((item) => item.eligibility.trainerId))
    return {
      schemaVersion: 1,
      windowHours: FEEDBACK_WINDOW_HOURS,
      sessions: pending
        .sort((left, right) => right.eligibility.endsAt.getTime() - left.eligibility.endsAt.getTime())
        .slice(0, 5)
        .map((item) => ({
          sessionId: item.snapshot.id,
          date: item.session.date,
          hour: storedHour(item.session.hour, item.snapshot.id),
          trainerId: item.eligibility.trainerId,
          trainerName: trainers.get(item.eligibility.trainerId)?.name || 'PT Aura',
          branchId: item.session.branchId || '',
          attendanceStatus: item.eligibility.attendanceStatus,
          endsAt: item.eligibility.endsAt.toISOString(),
          expiresAt: item.eligibility.expiresAt.toISOString(),
        })),
    }
  })

  const submitSessionFeedback = call(async (request) => {
    const actor = await learner(request)
    const sessionId = documentId(request.data?.sessionId, 'Mã buổi tập')
    const input = normalizedFeedbackInput(request.data)
    const now = new Date()
    const sessionReference = db.doc(`sessions/${sessionId}`)
    const attendanceReference = db.doc(`attendanceEvents/${sessionId}`)
    const id = feedbackId(sessionId, actor.studentId)
    const reference = db.doc(`sessionFeedback/${id}`)
    return db.runTransaction(async (transaction) => {
      const [sessionSnapshot, attendanceSnapshot, existingSnapshot] = await Promise.all([
        transaction.get(sessionReference),
        transaction.get(attendanceReference),
        transaction.get(reference),
      ])
      if (!sessionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập cần đánh giá.')
      const eligibility = feedbackEligibility({
        session: sessionSnapshot.data(),
        attendance: attendanceSnapshot.exists ? attendanceSnapshot.data() : {},
        studentId: actor.studentId,
        sessionId,
        now,
      })
      const nextStatus = feedbackReviewStatus(input)
      const common = {
        schemaVersion: 1,
        sessionId,
        studentId: actor.studentId,
        trainerId: eligibility.trainerId,
        actualTrainerId: eligibility.trainerId,
        branchId: sessionSnapshot.data().branchId || '',
        contractId: sessionSnapshot.data().contractId || '',
        sessionDate: sessionSnapshot.data().date,
        sessionHour: storedHour(sessionSnapshot.data().hour, sessionId),
        attendanceStatus: eligibility.attendanceStatus,
        overallScore: input.overallScore,
        tags: input.tags,
        comment: input.comment || null,
        anonymousToTrainer: input.anonymousToTrainer,
        issueCategory: input.issueCategory,
        status: nextStatus,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      }
      const auditReference = db.collection('sessionFeedbackAuditLogs').doc()
      if (existingSnapshot.exists) {
        const existing = existingSnapshot.data()
        if (['reviewing', 'resolved'].includes(existing.status)) throw new HttpsError('failed-precondition', 'Phản hồi đang được Aura xử lý nên không thể chỉnh sửa.')
        const submittedAt = instant(existing.submittedAt || existing.createdAt)
        if (!submittedAt || now.getTime() - submittedAt.getTime() > FEEDBACK_EDIT_WINDOW_MINUTES * 60 * 1000) {
          throw new HttpsError('failed-precondition', 'Đã hết thời gian chỉnh sửa phản hồi.')
        }
        transaction.update(reference, { ...common, editCount: FieldValue.increment(1) })
        transaction.create(auditReference, {
          schemaVersion: 1,
          feedbackId: id,
          sessionId,
          actorUid: actor.uid,
          action: 'student.updated',
          beforeScore: existing.overallScore || null,
          afterScore: input.overallScore,
          createdAt: FieldValue.serverTimestamp(),
        })
      } else {
        transaction.create(reference, {
          ...common,
          submittedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          editCount: 0,
          reviewedAt: null,
          reviewedBy: '',
          resolutionNote: '',
        })
        transaction.create(auditReference, {
          schemaVersion: 1,
          feedbackId: id,
          sessionId,
          actorUid: actor.uid,
          action: 'student.submitted',
          beforeScore: null,
          afterScore: input.overallScore,
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      return { schemaVersion: 1, feedbackId: id, status: nextStatus, overallScore: input.overallScore }
    })
  })

  const listTrainerFeedbackAdmin = call(async (request) => {
    await administrator(request)
    const to = dateKey(request.data?.to, 'Ngày kết thúc')
    const from = dateKey(request.data?.from, 'Ngày bắt đầu')
    if (from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86400000) {
      throw new HttpsError('invalid-argument', 'Khoảng đánh giá tối đa 366 ngày.')
    }
    const start = Timestamp.fromDate(new Date(`${from}T00:00:00+07:00`))
    const end = Timestamp.fromDate(new Date(`${addDateDays(to, 1)}T00:00:00+07:00`))
    const [feedbackSnapshot, attendanceSnapshot] = await Promise.all([
      db.collection('sessionFeedback')
        .where('submittedAt', '>=', start)
        .where('submittedAt', '<', end)
        .orderBy('submittedAt', 'desc')
        .limit(MAX_ADMIN_ROWS + 1)
        .get(),
      db.collection('attendanceEvents')
        .where('scheduledAt', '>=', start)
        .where('scheduledAt', '<', end)
        .limit(5001)
        .get(),
    ])
    const trainerId = typeof request.data?.trainerId === 'string' ? request.data.trainerId.trim() : ''
    const branchId = typeof request.data?.branchId === 'string' ? request.data.branchId.trim() : ''
    const status = ADMIN_STATUSES.has(request.data?.status) ? request.data.status : ''
    const score = Number.isInteger(request.data?.score) && request.data.score >= 1 && request.data.score <= 5 ? request.data.score : 0
    const rows = feedbackSnapshot.docs.slice(0, MAX_ADMIN_ROWS).map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => !trainerId || item.trainerId === trainerId)
      .filter((item) => !branchId || item.branchId === branchId)
      .filter((item) => !status || item.status === status)
      .filter((item) => !score || Number(item.overallScore) === score)
    const trainerIds = rows.map((item) => item.trainerId)
    const studentIds = rows.map((item) => item.studentId)
    const branchIds = rows.map((item) => item.branchId)
    const [trainers, students, branches] = await Promise.all([
      documentsById(db, 'trainers', trainerIds),
      documentsById(db, 'students', studentIds),
      documentsById(db, 'branches', branchIds),
    ])
    const eligibleAttendanceCount = attendanceSnapshot.docs.filter((item) => ['present', 'late'].includes(item.data().attendanceStatus)).length
    const summary = feedbackSummary(rows, eligibleAttendanceCount)
    summary.byTrainer = summary.byTrainer.map((item) => ({
      ...item,
      trainerName: trainers.get(item.trainerId)?.name || 'PT đã ngừng hoạt động',
    }))
    return {
      schemaVersion: 1,
      truncated: feedbackSnapshot.size > MAX_ADMIN_ROWS,
      attendanceTruncated: attendanceSnapshot.size > 5000,
      summary,
      trainers: [...new Set(trainerIds)].filter(Boolean).map((id) => ({ id, name: trainers.get(id)?.name || 'PT đã ngừng hoạt động' })).sort((left, right) => left.name.localeCompare(right.name, 'vi')),
      branches: [...new Set(branchIds)].filter(Boolean).map((id) => ({ id, name: branches.get(id)?.name || 'Chi nhánh chưa xác định' })).sort((left, right) => left.name.localeCompare(right.name, 'vi')),
      rows: rows.map((item) => ({
        id: item.id,
        sessionId: item.sessionId,
        studentId: item.studentId,
        studentName: students.get(item.studentId)?.name || 'Học viên đã lưu trữ',
        trainerId: item.trainerId,
        trainerName: trainers.get(item.trainerId)?.name || 'PT đã ngừng hoạt động',
        branchId: item.branchId || '',
        branchName: branches.get(item.branchId)?.name || 'Chi nhánh chưa xác định',
        sessionDate: item.sessionDate || '',
        sessionHour: Number.isInteger(item.sessionHour) ? item.sessionHour : null,
        overallScore: Number(item.overallScore || 0),
        tags: Array.isArray(item.tags) ? item.tags : [],
        comment: item.comment || '',
        anonymousToTrainer: item.anonymousToTrainer === true,
        issueCategory: item.issueCategory || 'none',
        status: ADMIN_STATUSES.has(item.status) ? item.status : 'submitted',
        submittedAt: serializedInstant(item.submittedAt || item.createdAt),
        reviewedAt: serializedInstant(item.reviewedAt),
        reviewedBy: item.reviewedBy || '',
        resolutionNote: item.resolutionNote || '',
      })),
    }
  })

  const reviewTrainerFeedback = call(async (request) => {
    const actor = await administrator(request)
    const id = documentId(request.data?.feedbackId, 'Mã phản hồi')
    const action = ['mark_reviewing', 'resolve', 'reopen'].includes(request.data?.action) ? request.data.action : ''
    if (!action) throw new HttpsError('invalid-argument', 'Thao tác xử lý không hợp lệ.')
    const note = boundedString(request.data?.note, 'Ghi chú xử lý', 500, action === 'resolve')
    const reference = db.doc(`sessionFeedback/${id}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy phản hồi.')
      const before = snapshot.data()
      const nextStatus = action === 'resolve' ? 'resolved' : action === 'reopen' ? 'needs_review' : 'reviewing'
      transaction.update(reference, {
        status: nextStatus,
        resolutionNote: note,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      })
      transaction.create(db.collection('sessionFeedbackAuditLogs').doc(), {
        schemaVersion: 1,
        feedbackId: id,
        sessionId: before.sessionId || '',
        actorUid: actor.uid,
        action: `admin.${action}`,
        beforeStatus: before.status || 'submitted',
        afterStatus: nextStatus,
        note,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { schemaVersion: 1, feedbackId: id, status: nextStatus }
    })
  })

  return {
    getMyPendingSessionFeedback,
    submitSessionFeedback,
    listTrainerFeedbackAdmin,
    reviewTrainerFeedback,
  }
}

module.exports = {
  createSessionFeedbackFunctions,
  feedbackEligibility,
  feedbackId,
  feedbackReviewStatus,
  feedbackSummary,
  normalizedFeedbackInput,
}
