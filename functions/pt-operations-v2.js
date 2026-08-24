const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { completeSessionAttendanceTransaction } = require('./session-operations')
const { assertSessionChangeDeadline } = require('./pt-policy')

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
  return {
    weekId,
    slots: Array.isArray(value?.slots) ? value.slots : [],
    minimumSlots: Math.max(5, Number(value?.minimumSlots || 5)),
    requiredSessions: Math.max(1, Number(value?.requiredSessions || 1)),
    revision: Math.max(0, Number(value?.revision || 0)),
    status: locked ? 'locked' : (value?.status === 'submitted' ? 'submitted' : 'draft'),
    locked,
    cutoffAt: cutoff.toISOString(),
    submittedAt: value?.submittedAt || null,
    source: value?.source || 'weekly',
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

function activeAssignmentContract(contract) {
  return ['active', 'future', 'frozen'].includes(contract.status || 'active')
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
  const activeTraining = trainingContracts.filter(activeAssignmentContract)
  const activeNutrition = nutritionContracts.filter(activeAssignmentContract)
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
  const contracts = await assignedContracts(db, actor, 'training', limit)
  const studentIds = [...new Set(contracts.map((item) => item.studentId).filter(Boolean))]
  const studentSnapshots = studentIds.length ? await db.getAll(...studentIds.map((id) => db.doc(`students/${id}`))) : []
  const activeContractByStudent = new Map(contracts.filter((item) => item.status === 'active').map((item) => [item.studentId, item]))
  const students = studentSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => {
    const student = snapshot.data()
    const contract = activeContractByStudent.get(snapshot.id) || contracts.find((item) => item.studentId === snapshot.id)
    return serialize({
      id: snapshot.id, name: student.name || 'Học viên Aura', phone: student.phone || '', email: student.email || '',
      branchId: student.branchId || contract?.branchId || '', status: student.status || 'active', sessionsPerWeek: student.sessionsPerWeek || 0,
      assignmentRole: contract ? (() => {
        const actorIds = [actor.uid, actor.legacyStaffId].filter(Boolean)
        const trainerIds = Array.isArray(contract.trainerIds) ? contract.trainerIds : []
        return actorIds.some((id) => contract.trainerId === id || trainerIds[0] === id) ? 'primary' : 'secondary'
      })() : 'secondary',
      contract: contract ? { id: contract.id, status: contract.status, startDate: contract.startDate, endDate: contract.endDate, totalSessions: contract.totalSessions || 0, usedSessions: contract.usedSessions || 0 } : null,
    })
  })
  return { schemaVersion: 1, students, hasMore: contracts.length >= limit }
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
  const studentSnapshots = studentIds.length ? await db.getAll(...studentIds.map((id) => db.doc(`students/${id}`))) : []
  const studentNames = new Map(studentSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data().name || 'Học viên Aura']))
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
    sessions: [...sessions.values()].map((session) => ({ ...session, studentName: studentNames.get(session.studentId) || 'Học viên Aura' })).sort((a, b) => `${a.date}-${a.hour || 0}`.localeCompare(`${b.date}-${b.hour || 0}`)),
    requests: [...requests.values()].sort((a, b) => String(b.submittedAtIso || b.createdAt || '').localeCompare(String(a.submittedAtIso || a.createdAt || ''))),
  }
}

function createPtOperationsV2Functions({ db, onCall }) {
  // PT/Sales endpoints are lightweight, Firestore-bound requests. Using the
  // Gen 1 CPU profile prevents a burst of separate callable services from
  // exhausting the regional Cloud Run CPU quota and surfacing as HTTP 429.
  const staffCall = (handler) => onCall({ cpu: 'gcf_gen1', maxInstances: 6, invoker: 'public' }, handler)

  const getMyCoachWorkspaceScope = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    return coachWorkspaceScopeForActor(db, actor)
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
        schemaVersion: 2,
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
    const contracts = contractsSnapshot.docs.map((item) => {
      const contract = item.data()
      return serialize({
        id: item.id,
        packageName: contract.packageName || 'Gói tập Aura',
        status: contract.status || 'active',
        startDate: contract.startDate || '',
        endDate: contract.endDate || '',
        totalSessions: Number(contract.totalSessions || 0),
        usedSessions: Number(contract.usedSessions || 0),
      })
    })
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
    const legacySlots = normalizedAvailabilitySlots(profile.value.availableSlots || [], config, false)
    const storedAvailability = availabilitySnapshot.exists
      ? availabilitySnapshot.data()
      : {
          slots: legacySlots,
          minimumSlots: Math.max(5, requiredSessions),
          requiredSessions,
          revision: 0,
          status: 'draft',
          source: legacySlots.length ? 'legacy_default' : 'weekly',
        }
    const availability = availabilityState(requestedAvailabilityWeekId, {
      ...storedAvailability,
      slots: normalizedAvailabilitySlots(storedAvailability.slots || [], config, false),
    })
    return {
      schemaVersion: 3,
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
        isScheduleConfirmed: availability.status === 'submitted' || availability.status === 'locked',
        availabilityRevision: availability.revision,
        availability: serialize(availability),
      }),
      scheduleConfig: config,
      sessions,
      sessionsTruncated: sessionsSnapshot.size > 1000,
      contracts,
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
    const cutoffAt = availabilityCutoff(weekId)
    if (Date.now() >= cutoffAt.getTime()) {
      throw new HttpsError('failed-precondition', 'Lịch rảnh của tuần này đã khóa lúc 10:00 Chủ nhật.', {
        issueCode: 'AVAILABILITY_LOCKED',
        action: 'contact_admin',
        cutoffAt: cutoffAt.toISOString(),
      })
    }
    if (slots.length < minimumSlots) {
      throw new HttpsError('failed-precondition', `Hãy chọn ít nhất ${minimumSlots} khung giờ rảnh để Aura có thể xếp lịch.`)
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
        status: 'submitted',
        revision: currentRevision + 1,
        submittedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (currentAvailability.exists) transaction.update(availabilityReference, next)
      else transaction.create(availabilityReference, { ...next, createdAt: FieldValue.serverTimestamp() })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        action: 'student_availability.updated',
        actorUid: actor.uid,
        studentId: profile.id,
        weekId,
        beforeSlotCount: Array.isArray(currentAvailability.data()?.slots) ? currentAvailability.data().slots.length : 0,
        afterSlotCount: slots.length,
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
        submittedAt: new Date().toISOString(),
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
      const limit = integer(request.data?.limit, 100, 1, 200)
      const [scope, data] = await Promise.all([scopePromise, assignedStudentsForActor(db, actor, limit)])
      return { schemaVersion: 1, scope, students: data.students, sessions: [], requests: [], hasMore: data.hasMore }
    }
    const from = dateKey(request.data?.from, 'Ngày bắt đầu')
    const to = dateKey(request.data?.to, 'Ngày kết thúc')
    if (from > to || Date.parse(`${to}T00:00:00+07:00`) - Date.parse(`${from}T00:00:00+07:00`) > 62 * 86400000) throw new HttpsError('invalid-argument', 'Khoảng lịch tối đa là 62 ngày.')
    const limit = integer(request.data?.limit, 300, 1, 500)
    const [scope, data] = await Promise.all([scopePromise, trainerScheduleForActor(db, actor, from, to, limit)])
    return { schemaVersion: 1, scope, students: [], sessions: data.sessions, requests: data.requests, hasMore: false }
  })

  const getMyTrainerStudentDetail = staffCall(async (request) => {
    const actor = await trainerActor(request, db)
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const contracts = await assignedContracts(db, actor, 'training', 300)
    const studentContracts = contracts.filter((item) => item.studentId === studentId)
    if (!studentContracts.length) throw new HttpsError('permission-denied', 'Học viên không thuộc phạm vi được giao.')
    const [studentSnapshot, logsSnapshot] = await Promise.all([
      db.doc(`students/${studentId}`).get(), db.collection('workoutLogs').where('studentId', '==', studentId).limit(100).get(),
    ])
    if (!studentSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy học viên.')
    return { schemaVersion: 1, student: serialize({ id: studentId, ...studentSnapshot.data() }), contracts: serialize(studentContracts), workoutLogs: logsSnapshot.docs.map((doc) => serialize({ id: doc.id, ...doc.data() })) }
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
      assertSessionScope: (session) => {
        if (![actor.uid, actor.legacyStaffId].includes(session.trainerId)) {
          throw new HttpsError('permission-denied', 'Buổi tập không thuộc lịch của bạn.')
        }
      },
    })
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

  return { getMyCoachWorkspaceScope, getMyTrainerWorkspace, listMyStudentPtSchedule, saveMyStudentAvailability, listMyAssignedStudents, listMyTrainerSchedule, getMyTrainerStudentDetail, confirmMySession, submitWorkoutNote, requestSessionChange, listMyQuotes, getMySalesCatalog, getMySalesWorkspace, createQuote, createStudentDraft, submitContractForApproval }
}

module.exports = { createPtOperationsV2Functions, normalizedAvailabilitySlots, scheduleConfig, sessionHour }
