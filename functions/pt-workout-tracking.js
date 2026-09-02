const { createHash } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

const ACTIVE_SESSION_STATUSES = new Set(['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'])
const ACTIVE_ASSIGNMENT_CONTRACT_STATUSES = new Set(['active'])
const TRACKING_MODES = new Set(['weight_reps', 'bodyweight_reps', 'time', 'distance', 'assisted_weight'])
const SET_TYPES = new Set(['warmup', 'working', 'drop', 'failure'])

function text(value, maximum = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function number(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback
}

function integer(value, fallback, minimum, maximum) {
  return Math.round(number(value, fallback, minimum, maximum))
}

function dateKey(value, label = 'Ngày') {
  const result = text(value, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T12:00:00+07:00`))) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function storedDateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  if (value && typeof value.toDate === 'function') return currentDateKey(value.toDate())
  if (value instanceof Date && Number.isFinite(value.getTime())) return currentDateKey(value)
  return ''
}

function currentDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const part = (type) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function pauseCoversDate(contract, referenceDate) {
  return Array.isArray(contract?.pausePeriods) && contract.pausePeriods.some((period) => {
    if (text(period?.type, 40).toLowerCase() !== 'preservation') return false
    const startDate = storedDateKey(period?.startDate)
    const endDate = storedDateKey(period?.endDate)
    return Boolean(startDate && endDate && startDate <= referenceDate && endDate >= referenceDate)
  })
}

function isEffectiveWorkoutContract(contract, referenceDate = currentDateKey()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return false
  if (!ACTIVE_ASSIGNMENT_CONTRACT_STATUSES.has(text(contract?.status || 'active', 40).toLowerCase())) return false
  const startDate = storedDateKey(contract?.startDate)
  const endDate = storedDateKey(contract?.endDate)
  const totalSessions = Math.max(0, Number(contract?.totalSessions || 0))
  const usedSessions = Math.max(0, Number(contract?.usedSessions || 0))
  return Boolean(startDate && endDate && startDate <= referenceDate && endDate >= referenceDate
    && totalSessions > usedSessions && !pauseCoversDate(contract, referenceDate))
}

function workoutSessionWriteIssue(session, requestedStatus, now = new Date()) {
  const status = text(session?.status || 'scheduled', 40).toLowerCase()
  if (status === 'cancelled') return 'Ca tập đã hủy, không thể ghi nhật ký.'
  if (status === 'no_show') return 'Học viên vắng mặt, không thể ghi nhật ký tập luyện.'
  if (!ACTIVE_SESSION_STATUSES.has(status)) return 'Trạng thái ca tập chưa cho phép ghi nhật ký.'
  const sessionDate = storedDateKey(session?.date)
  const today = currentDateKey(now)
  if (!sessionDate || sessionDate > today) return 'Chưa thể ghi nhật ký cho ca tập trong tương lai.'
  if (requestedStatus === 'completed') {
    const hour = integer(session?.hour, 0, 0, 23)
    const sessionTime = Date.parse(`${sessionDate}T${String(hour).padStart(2, '0')}:00:00+07:00`)
    if (Number.isFinite(sessionTime) && sessionTime > now.getTime()) return 'Chưa đến giờ tập nên chưa thể hoàn thành nhật ký.'
  }
  return ''
}

function serialize(value) {
  if (value === null || value === undefined) return value ?? null
  if (Array.isArray(value)) return value.map(serialize)
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]))
  return value
}

function boundedStrings(value, maximum = 12, itemMaximum = 100) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim().slice(0, itemMaximum)))].slice(0, maximum)
    : []
}

function safeDocumentId(value, label = 'Mã dữ liệu') {
  const result = text(value, 180)
  if (!result || result.includes('/')) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function logDocumentId(sessionId, studentId) {
  return `ptlog_${createHash('sha256').update(`${sessionId}\u0000${studentId}`).digest('hex').slice(0, 40)}`
}

function actorIds(actor) {
  return new Set([actor.uid, actor.legacyStaffId].filter((item) => typeof item === 'string' && item))
}

function isOperationsAdmin(actor) {
  return actor.accessRole === 'admin' || actor.accessRole === 'super_admin'
}

function sessionManagedByActor(session, actor) {
  if (isOperationsAdmin(actor)) return true
  if (actor.positions.includes('branch_manager') && actor.branchIds.includes(session.branchId)) return true
  return actorIds(actor).has(session.trainerId)
}

function contractAssignedToActor(contract, actor) {
  if (isOperationsAdmin(actor)) return true
  if (actor.positions.includes('branch_manager') && actor.branchIds.includes(contract.branchId)) return true
  const ids = actorIds(actor)
  return ids.has(contract.trainerId)
    || (Array.isArray(contract.trainerIds) && contract.trainerIds.some((id) => ids.has(id)))
}

function activeAssignmentContract(contract, referenceDate = currentDateKey()) {
  return isEffectiveWorkoutContract(contract, referenceDate)
}

function workspaceStudentIds(sessions, contracts, referenceDate = currentDateKey()) {
  return [...new Set([
    ...sessions.map((session) => session?.studentId),
    ...contracts.filter((contract) => activeAssignmentContract(contract, referenceDate)).map((contract) => contract?.studentId),
  ].filter((studentId) => typeof studentId === 'string' && studentId.trim()).map((studentId) => studentId.trim()))]
}

async function workspaceContractsForActor(db, actor, referenceDate = currentDateKey()) {
  const requests = []
  if (isOperationsAdmin(actor)) {
    for (const status of ACTIVE_ASSIGNMENT_CONTRACT_STATUSES) {
      requests.push(db.collection('contracts').where('status', '==', status).limit(600).get())
    }
    // Imported legacy contracts may not have a status field. Keep one bounded
    // scan so those still-active assignments do not disappear from the workspace.
    requests.push(db.collection('contracts').limit(600).get())
  } else if (actor.positions.includes('branch_manager')) {
    for (const branchId of actor.branchIds.slice(0, 12)) {
      requests.push(db.collection('contracts').where('branchId', '==', branchId).limit(800).get())
    }
  } else {
    for (const id of actorIds(actor)) {
      requests.push(db.collection('contracts').where('trainerId', '==', id).limit(300).get())
      requests.push(db.collection('contracts').where('trainerIds', 'array-contains', id).limit(300).get())
    }
  }
  const snapshots = await Promise.all(requests)
  const contracts = new Map()
  snapshots.forEach((snapshot) => snapshot.docs.forEach((document) => {
    const value = document.data() || {}
    if (!activeAssignmentContract(value, referenceDate) || !contractAssignedToActor(value, actor)) return
    contracts.set(document.id, { id: document.id, ...value })
  }))
  return [...contracts.values()].slice(0, 600)
}

async function assertStudentScope(db, actor, studentId) {
  if (isOperationsAdmin(actor)) return
  const contractSnapshot = await db.collection('contracts').where('studentId', '==', studentId).limit(30).get()
  const referenceDate = currentDateKey()
  const assignedByEffectiveContract = contractSnapshot.docs.some((document) => {
    const contract = document.data()
    return activeAssignmentContract(contract, referenceDate) && contractAssignedToActor(contract, actor)
  })
  if (!assignedByEffectiveContract) {
    throw new HttpsError('permission-denied', 'Học viên không có hợp đồng hiệu lực trong phạm vi phụ trách của bạn.')
  }
}

function publicExerciseSnapshot(document) {
  const value = document.data() || {}
  if (value.status !== 'published') throw new HttpsError('failed-precondition', 'Giáo án có bài tập chưa được xuất bản.')
  return {
    catalogExerciseId: document.id,
    catalogRevision: integer(value.revision, 1, 1, 1_000_000),
    nameVi: text(value.nameVi || value.nameEn, 160) || 'Bài tập Aura',
    targetMuscles: boundedStrings(value.targetMuscles, 8, 80),
    secondaryMuscles: boundedStrings(value.secondaryMuscles, 8, 80),
    equipment: boundedStrings(value.equipment, 8, 80),
    instructionsVi: boundedStrings(value.instructionsVi, 12, 500),
    cuesVi: boundedStrings(value.cuesVi, 8, 240),
    media: {
      posterUrl: text(value.media?.posterUrl || value.media?.startImageUrl, 2_000),
      animationUrl: text(value.media?.animationUrl, 2_000),
    },
  }
}

function normalizeProgramDraft(raw) {
  const days = Array.isArray(raw?.trainingDays) ? raw.trainingDays : []
  if (!days.length || days.length > 7) throw new HttpsError('invalid-argument', 'Giáo án cần từ 1 đến 7 buổi mẫu.')
  let exerciseCount = 0
  const trainingDays = days.map((day, dayIndex) => {
    const exercises = Array.isArray(day?.exercises) ? day.exercises : []
    if (!exercises.length || exercises.length > 20) throw new HttpsError('invalid-argument', 'Mỗi buổi cần từ 1 đến 20 bài tập.')
    const normalizedExercises = exercises.map((exercise, exerciseIndex) => {
      exerciseCount += 1
      const catalogExerciseId = safeDocumentId(exercise?.catalogExerciseId, 'Mã bài tập')
      const trackingMode = TRACKING_MODES.has(exercise?.trackingMode) ? exercise.trackingMode : 'weight_reps'
      const repMinimum = integer(exercise?.repMinimum, 8, 1, 100)
      const repMaximum = integer(exercise?.repMaximum, Math.max(12, repMinimum), repMinimum, 200)
      return {
        id: text(exercise?.id, 100) || `exercise-${dayIndex + 1}-${exerciseIndex + 1}`,
        catalogExerciseId,
        trackingMode,
        sets: integer(exercise?.sets, 3, 1, 12),
        repMinimum,
        repMaximum,
        durationSeconds: integer(exercise?.durationSeconds, 0, 0, 3_600),
        distanceMeters: integer(exercise?.distanceMeters, 0, 0, 100_000),
        targetWeightKg: number(exercise?.targetWeightKg, 0, 0, 1_000),
        targetRpe: number(exercise?.targetRpe, 7, 1, 10),
        targetRir: number(exercise?.targetRir, 3, 0, 10),
        tempo: text(exercise?.tempo, 30),
        restSeconds: integer(exercise?.restSeconds, 60, 0, 900),
        unilateral: exercise?.unilateral === true,
        notes: text(exercise?.notes, 500),
      }
    })
    return {
      id: text(day?.id, 100) || `day-${dayIndex + 1}`,
      title: text(day?.title, 120) || `Buổi ${dayIndex + 1}`,
      focusMuscles: boundedStrings(day?.focusMuscles, 8, 80),
      notes: text(day?.notes, 600),
      order: dayIndex,
      exercises: normalizedExercises,
    }
  })
  if (exerciseCount > 100) throw new HttpsError('invalid-argument', 'Giáo án vượt giới hạn 100 bài tập.')
  return {
    schemaVersion: 1,
    title: text(raw?.title, 160) || 'Giáo án PT Aura',
    goal: text(raw?.goal, 300),
    coachNotes: text(raw?.coachNotes, 1_200),
    status: raw?.status === 'draft' ? 'draft' : 'active',
    trainingDays,
  }
}

async function hydrateProgramExercises(db, draft) {
  const ids = [...new Set(draft.trainingDays.flatMap((day) => day.exercises.map((exercise) => exercise.catalogExerciseId)))]
  const snapshots = await db.getAll(...ids.map((id) => db.doc(`exercises/${id}`)))
  const catalog = new Map(snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, publicExerciseSnapshot(snapshot)]))
  if (catalog.size !== ids.length) throw new HttpsError('failed-precondition', 'Một số bài tập không còn trong thư viện Aura.')
  return {
    ...draft,
    trainingDays: draft.trainingDays.map((day) => ({
      ...day,
      exercises: day.exercises.map((exercise) => ({ ...exercise, ...catalog.get(exercise.catalogExerciseId) })),
    })),
  }
}

function normalizeWorkoutSets(rawSets, exerciseIndex) {
  if (!Array.isArray(rawSets) || rawSets.length > 140) throw new HttpsError('invalid-argument', 'Nhật ký vượt giới hạn số hiệp.')
  return rawSets.map((set, index) => {
    const exerciseId = safeDocumentId(set?.exerciseId, 'Bài tập trong nhật ký')
    const exercise = exerciseIndex.get(exerciseId)
    if (!exercise) throw new HttpsError('failed-precondition', 'Bài tập không thuộc giáo án đang chọn.')
    return {
      exerciseId,
      catalogExerciseId: exercise.catalogExerciseId,
      exerciseName: exercise.nameVi,
      setNumber: integer(set?.setNumber, index + 1, 1, 30),
      setType: SET_TYPES.has(set?.setType) ? set.setType : 'working',
      weightKg: number(set?.weightKg, 0, 0, 1_000),
      reps: integer(set?.reps, 0, 0, 1_000),
      durationSeconds: integer(set?.durationSeconds, 0, 0, 7_200),
      distanceMeters: number(set?.distanceMeters, 0, 0, 100_000),
      rpe: number(set?.rpe, 0, 0, 10),
      rir: number(set?.rir, 0, 0, 10),
      painLevel: integer(set?.painLevel, 0, 0, 10),
      completed: set?.completed !== false,
      notes: text(set?.notes, 300),
    }
  })
}

function workoutMetrics(sets) {
  const completed = sets.filter((set) => set.completed)
  return {
    completedSets: completed.length,
    totalVolumeKg: Math.round(completed.reduce((sum, set) => sum + set.weightKg * set.reps, 0) * 10) / 10,
    maximumWeightKg: completed.reduce((maximum, set) => Math.max(maximum, set.weightKg), 0),
    maximumRpe: completed.reduce((maximum, set) => Math.max(maximum, set.rpe), 0),
    painAlert: sets.some((set) => set.painLevel >= 4),
  }
}

function historyAnalytics(logs) {
  const completed = logs.filter((log) => log.status === 'completed')
  const exerciseBest = new Map()
  completed.forEach((log) => (log.sets || []).filter((set) => set.completed && set.setType !== 'warmup').forEach((set) => {
    const current = exerciseBest.get(set.catalogExerciseId) || { catalogExerciseId: set.catalogExerciseId, exerciseName: set.exerciseName, maximumWeightKg: 0, maximumSetVolumeKg: 0 }
    current.maximumWeightKg = Math.max(current.maximumWeightKg, Number(set.weightKg || 0))
    current.maximumSetVolumeKg = Math.max(current.maximumSetVolumeKg, Number(set.weightKg || 0) * Number(set.reps || 0))
    exerciseBest.set(set.catalogExerciseId, current)
  }))
  return {
    completedWorkouts: completed.length,
    totalVolumeKg: Math.round(completed.reduce((sum, log) => sum + Number(log.metrics?.totalVolumeKg || 0), 0) * 10) / 10,
    painAlerts: completed.filter((log) => log.metrics?.painAlert === true).length,
    personalRecords: [...exerciseBest.values()].sort((left, right) => right.maximumWeightKg - left.maximumWeightKg).slice(0, 12),
  }
}

function createPtWorkoutTrackingFunctions({ db, onCall }) {
  // These endpoints are IO-bound. Fractional CPU avoids burning six full
  // regional vCPUs during a cold rollout while preserving transaction safety.
  const staffCall = (handler) => onCall({ cpu: 'gcf_gen1', concurrency: 1, maxInstances: 2, invoker: 'public' }, handler)
  const readCall = (handler) => onCall({ cpu: 'gcf_gen1', concurrency: 1, maxInstances: 2, invoker: 'public' }, handler)

  const getPtWorkoutWorkspace = staffCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'pt.workout.manage')
    const from = dateKey(request.data?.from)
    const to = dateKey(request.data?.to || from)
    if (Date.parse(`${to}T12:00:00+07:00`) - Date.parse(`${from}T12:00:00+07:00`) > 31 * 86_400_000) {
      throw new HttpsError('invalid-argument', 'Mỗi lần chỉ tải tối đa 31 ngày.')
    }
    const ids = [...actorIds(actor)]
    const sessionSnapshotsPromise = isOperationsAdmin(actor) || actor.positions.includes('branch_manager')
      ? db.collection('sessions').where('date', '>=', from).where('date', '<=', to).limit(300).get().then((snapshot) => [snapshot])
      : Promise.all(ids.map((id) => db.collection('sessions').where('trainerId', '==', id).where('date', '>=', from).where('date', '<=', to).limit(300).get()))
    const [snapshots, contracts] = await Promise.all([
      sessionSnapshotsPromise,
      workspaceContractsForActor(db, actor, currentDateKey()),
    ])
    const sessions = new Map()
    snapshots.forEach((snapshot) => snapshot.docs.forEach((document) => {
      const value = document.data()
      if (!ACTIVE_SESSION_STATUSES.has(value.status || 'scheduled')) return
      if (!sessionManagedByActor(value, actor)) return
      sessions.set(document.id, { id: document.id, ...value })
    }))
    const rawSessionItems = [...sessions.values()].sort((left, right) => `${left.date}-${left.hour || 0}`.localeCompare(`${right.date}-${right.hour || 0}`))
    const studentIds = workspaceStudentIds(rawSessionItems, contracts)
    const trainerIds = [...new Set(rawSessionItems.map((session) => text(session.trainerId, 180)).filter(Boolean))]
    const branchIds = [...new Set(rawSessionItems.map((session) => text(session.branchId, 180)).filter(Boolean))]
    const contractByStudent = new Map()
    contracts.forEach((contract) => {
      const current = contractByStudent.get(contract.studentId)
      const currentEnd = storedDateKey(current?.endDate)
      const candidateEnd = storedDateKey(contract?.endDate)
      if (!current || candidateEnd > currentEnd) {
        contractByStudent.set(contract.studentId, contract)
      }
    })
    const [studentSnapshots, programSnapshots, logSnapshots, trainerSnapshots, staffSnapshots, branchSnapshots] = await Promise.all([
      studentIds.length ? db.getAll(...studentIds.map((id) => db.doc(`students/${id}`))) : [],
      studentIds.length ? db.getAll(...studentIds.map((id) => db.doc(`ptTrainingPrograms/${id}`))) : [],
      rawSessionItems.length ? db.getAll(...rawSessionItems.map((session) => db.doc(`ptWorkoutLogs/${logDocumentId(session.id, session.studentId)}`))) : [],
      trainerIds.length ? db.getAll(...trainerIds.map((id) => db.doc(`trainers/${id}`))) : [],
      trainerIds.length ? db.getAll(...trainerIds.map((id) => db.doc(`staff/${id}`))) : [],
      branchIds.length ? db.getAll(...branchIds.map((id) => db.doc(`branches/${id}`))) : [],
    ])
    const trainerNames = new Map()
    ;[...trainerSnapshots, ...staffSnapshots].filter((snapshot) => snapshot.exists).forEach((snapshot) => {
      const name = text(snapshot.data()?.name || snapshot.data()?.fullName, 160)
      if (name && !trainerNames.has(snapshot.id)) trainerNames.set(snapshot.id, name)
    })
    const branchNames = new Map(branchSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [
      snapshot.id, text(snapshot.data()?.name || snapshot.data()?.branchName, 160) || 'Chi nhánh Aura',
    ]))
    const sessionItems = rawSessionItems.map((session) => ({
      ...session,
      trainerName: trainerNames.get(session.trainerId) || 'PT Aura',
      branchName: branchNames.get(session.branchId) || 'Chi nhánh Aura',
    }))
    const students = studentSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => {
      const contract = contractByStudent.get(snapshot.id)
      return {
        id: snapshot.id,
        name: text(snapshot.data().name, 160) || 'Học viên Aura',
        phone: text(snapshot.data().phone, 30),
        branchId: text(contract?.branchId || snapshot.data().branchId, 100),
        contractId: text(contract?.id, 180),
        contractStatus: text(contract?.status, 40),
        assignmentSource: contract ? 'contract' : 'teaching_session',
        eligibleForNewProgram: Boolean(contract),
      }
    }).sort((left, right) => left.name.localeCompare(right.name, 'vi'))
    return serialize({
      schemaVersion: 1,
      sessions: sessionItems,
      students,
      programs: programSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
      logs: logSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
    })
  })

  const getPtStudentTrainingPlan = readCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    const requestedStudentId = safeDocumentId(request.data?.studentId || actor.legacyStaffId || actor.uid, 'Học viên')
    const learnerIds = actorIds(actor)
    if (actor.accessRole === 'student') {
      if (!learnerIds.has(requestedStudentId)) throw new HttpsError('permission-denied', 'Bạn chỉ được xem giáo án của mình.')
    } else {
      requireCapability(actor, 'pt.workout.manage')
      await assertStudentScope(db, actor, requestedStudentId)
    }
    const snapshot = await db.doc(`ptTrainingPrograms/${requestedStudentId}`).get()
    return serialize({ schemaVersion: 1, studentId: requestedStudentId, program: snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null })
  })

  const savePtStudentTrainingPlan = staffCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'pt.workout.manage')
    const studentId = safeDocumentId(request.data?.studentId, 'Học viên')
    await assertStudentScope(db, actor, studentId)
    const expectedRevision = integer(request.data?.expectedRevision, 0, 0, 1_000_000)
    const hydrated = await hydrateProgramExercises(db, normalizeProgramDraft(request.data?.program || {}))
    const reference = db.doc(`ptTrainingPrograms/${studentId}`)
    const result = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(reference)
      const revision = current.exists ? integer(current.data().revision, 0, 0, 1_000_000) : 0
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Giáo án đã được cập nhật ở thiết bị khác. Hãy tải lại.', { issueCode: 'REVISION_CONFLICT', currentRevision: revision })
      const nextRevision = revision + 1
      const payload = {
        ...hydrated,
        studentId,
        revision: nextRevision,
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(current.exists ? {} : { createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() }),
      }
      transaction.set(reference, payload, { merge: false })
      transaction.create(reference.collection('revisions').doc(String(nextRevision)), {
        ...hydrated, studentId, revision: nextRevision, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('ptWorkoutAuditLogs').doc(), {
        schemaVersion: 1, action: 'training_program.saved', actorUid: actor.uid, studentId,
        previousRevision: revision, nextRevision, createdAt: FieldValue.serverTimestamp(),
      })
      return { studentId, revision: nextRevision }
    })
    return { schemaVersion: 1, ...result }
  })

  const savePtSessionWorkoutLog = staffCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'pt.workout.manage')
    const sessionId = safeDocumentId(request.data?.sessionId, 'Ca tập')
    const studentId = safeDocumentId(request.data?.studentId, 'Học viên')
    const expectedRevision = integer(request.data?.expectedRevision, 0, 0, 1_000_000)
    const dayId = safeDocumentId(request.data?.trainingDayId, 'Buổi giáo án')
    const status = request.data?.status === 'completed' ? 'completed' : 'draft'
    const sessionReference = db.doc(`sessions/${sessionId}`)
    const programReference = db.doc(`ptTrainingPrograms/${studentId}`)
    const logId = logDocumentId(sessionId, studentId)
    const logReference = db.doc(`ptWorkoutLogs/${logId}`)
    const result = await db.runTransaction(async (transaction) => {
      const [sessionSnapshot, programSnapshot, logSnapshot] = await Promise.all([
        transaction.get(sessionReference), transaction.get(programReference), transaction.get(logReference),
      ])
      if (!sessionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy ca tập.')
      const session = sessionSnapshot.data()
      if (session.studentId !== studentId) throw new HttpsError('failed-precondition', 'Học viên không thuộc ca tập này.')
      if (!sessionManagedByActor(session, actor)) throw new HttpsError('permission-denied', 'Bạn không phụ trách ca tập này.')
      const sessionIssue = workoutSessionWriteIssue(session, status)
      if (sessionIssue) throw new HttpsError('failed-precondition', sessionIssue, { issueCode: 'WORKOUT_SESSION_NOT_WRITABLE' })
      if (!programSnapshot.exists) throw new HttpsError('failed-precondition', 'Học viên chưa có giáo án đang áp dụng.')
      const program = programSnapshot.data()
      const trainingDay = (program.trainingDays || []).find((day) => day.id === dayId)
      if (!trainingDay) throw new HttpsError('failed-precondition', 'Buổi giáo án không còn tồn tại.')
      const exerciseIndex = new Map((trainingDay.exercises || []).map((exercise) => [exercise.id, exercise]))
      const sets = normalizeWorkoutSets(request.data?.sets || [], exerciseIndex)
      if (status === 'completed' && !sets.some((set) => set.completed)) throw new HttpsError('failed-precondition', 'Hãy hoàn thành ít nhất một hiệp trước khi kết thúc buổi.')
      const revision = logSnapshot.exists ? integer(logSnapshot.data().revision, 0, 0, 1_000_000) : 0
      if (logSnapshot.exists && logSnapshot.data().status === 'completed') {
        throw new HttpsError('failed-precondition', 'Nhật ký đã hoàn thành và được khóa. Admin cần tạo điều chỉnh có lý do nếu phát hiện sai.', { issueCode: 'WORKOUT_LOG_LOCKED' })
      }
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Nhật ký đã được cập nhật ở thiết bị khác. Hãy tải lại.', { issueCode: 'REVISION_CONFLICT', currentRevision: revision })
      const nextRevision = revision + 1
      const payload = {
        schemaVersion: 1, sessionId, studentId, contractId: text(session.contractId, 180), trainerId: text(session.trainerId, 180),
        branchId: text(session.branchId, 180), date: dateKey(session.date), hour: integer(session.hour, 0, 0, 23),
        programRevision: integer(program.revision, 1, 1, 1_000_000), trainingDayId: dayId, trainingDayTitle: text(trainingDay.title, 160),
        planSnapshot: trainingDay, sets, metrics: workoutMetrics(sets), status, revision: nextRevision,
        sessionReadiness: integer(request.data?.sessionReadiness, 0, 0, 10), painNotes: text(request.data?.painNotes, 500),
        coachNotes: text(request.data?.coachNotes, 1_200), updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
        ...(logSnapshot.exists ? {} : { createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() }),
        ...(status === 'completed' ? { completedBy: actor.uid, completedAt: FieldValue.serverTimestamp() } : {}),
      }
      transaction.set(logReference, payload, { merge: false })
      transaction.create(logReference.collection('revisions').doc(String(nextRevision)), {
        ...payload, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid,
      })
      transaction.create(db.collection('ptWorkoutAuditLogs').doc(), {
        schemaVersion: 1, action: status === 'completed' ? 'workout_log.completed' : 'workout_log.saved', actorUid: actor.uid,
        sessionId, studentId, previousRevision: revision, nextRevision, createdAt: FieldValue.serverTimestamp(),
      })
      return { logId, revision: nextRevision, status, metrics: payload.metrics }
    })
    return { schemaVersion: 1, ...result }
  })

  const listPtWorkoutHistory = readCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    const studentId = safeDocumentId(request.data?.studentId || actor.legacyStaffId || actor.uid, 'Học viên')
    if (actor.accessRole === 'student') {
      if (!actorIds(actor).has(studentId)) throw new HttpsError('permission-denied', 'Bạn chỉ được xem lịch sử của mình.')
    } else {
      requireCapability(actor, 'pt.workout.manage')
      await assertStudentScope(db, actor, studentId)
    }
    const limit = integer(request.data?.limit, 60, 1, 100)
    const snapshot = await db.collection('ptWorkoutLogs')
      .where('studentId', '==', studentId)
      .orderBy('date', 'desc')
      .orderBy('hour', 'desc')
      .limit(limit)
      .get()
    const logs = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }))
    return serialize({ schemaVersion: 1, studentId, logs, analytics: historyAnalytics(logs) })
  })

  return { getPtWorkoutWorkspace, getPtStudentTrainingPlan, savePtStudentTrainingPlan, savePtSessionWorkoutLog, listPtWorkoutHistory }
}

module.exports = {
  createPtWorkoutTrackingFunctions,
  historyAnalytics,
  isEffectiveWorkoutContract,
  logDocumentId,
  normalizeProgramDraft,
  normalizeWorkoutSets,
  pauseCoversDate,
  workspaceStudentIds,
  workoutSessionWriteIssue,
  workoutMetrics,
}
