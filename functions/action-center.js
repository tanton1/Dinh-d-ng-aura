'use strict'

const { createHash } = require('node:crypto')
const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext } = require('./identity-access')
const { withFunctionTelemetry } = require('./observability')

const MAX_PAGE_SIZE = 100
const MAX_SCAN = 500
const ACTION_STATUSES = new Set(['open', 'in_progress', 'resolved', 'snoozed'])
const ACTIVE_STATUSES = new Set(['open', 'in_progress'])

function clean(value, maximum = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function timestampMillis(value) {
  if (value?.toMillis) return value.toMillis()
  if (value?.toDate) return value.toDate().getTime()
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function vietnamDateKey(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const millis = timestampMillis(value)
  if (!millis) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(millis))
}

function dateKeyDistance(left, right) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(left) || !/^\d{4}-\d{2}-\d{2}$/.test(right)) return null
  return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86_400_000)
}

function terminalAttendanceStatus(session = {}) {
  const attendance = String(session.attendanceStatus || '').trim().toLowerCase()
  const status = String(session.status || '').trim().toLowerCase()
  if (['no_show', 'absent'].includes(attendance) || ['no_show', 'absent'].includes(status)) return 'no_show'
  if (['present', 'late'].includes(attendance) || ['completed', 'attended'].includes(status)) return 'attended'
  return ''
}

function hasThreeConsecutiveNoShows(sessions = []) {
  const terminal = sessions
    .map((session) => ({ ...session, terminalAttendance: terminalAttendanceStatus(session) }))
    .filter((session) => session.terminalAttendance)
    .sort((left, right) => {
      const leftKey = `${vietnamDateKey(left.date || left.startAt || left.scheduledAt)}:${String(Number(left.hour || 0)).padStart(2, '0')}:${clean(left.id, 200)}`
      const rightKey = `${vietnamDateKey(right.date || right.startAt || right.scheduledAt)}:${String(Number(right.hour || 0)).padStart(2, '0')}:${clean(right.id, 200)}`
      return rightKey.localeCompare(leftKey)
    })
    .slice(0, 3)
  return terminal.length === 3 && terminal.every((session) => session.terminalAttendance === 'no_show')
}

function actionId(sourceType, sourceId, actionType) {
  return `${clean(sourceType, 60)}:${clean(sourceId, 160)}:${clean(actionType, 80)}`.replaceAll('/', '_')
}

function roleKeys(actor) {
  const roles = new Set([actor.accessRole, ...(Array.isArray(actor.positions) ? actor.positions : [])])
  if (actor.accessRole === 'staff') roles.add('staff')
  return roles
}

function branchVisible(action, actor) {
  if (['admin', 'super_admin'].includes(actor.accessRole)) return true
  if (!action.branchId) return true
  return Array.isArray(actor.branchIds) && actor.branchIds.includes(action.branchId)
}

function isVisibleToActor(action, actor) {
  if (!branchVisible(action, actor)) return false
  if (action.assignedUid && action.assignedUid === actor.uid) return true
  const allowed = Array.isArray(action.allowedRoles) ? action.allowedRoles : []
  return allowed.some((role) => roleKeys(actor).has(role))
}

function hasStudentAssignment(action, actor) {
  if (['admin', 'super_admin'].includes(actor.accessRole)) return true
  if (action.assignedUid && action.assignedUid === actor.uid) return true
  const actorIds = new Set([actor.uid, actor.legacyStaffId].filter(Boolean))
  const assigned = Array.isArray(action.assignedStaffIds) ? action.assignedStaffIds : []
  return assigned.some((uid) => actorIds.has(uid))
}

function canViewAction(action, actor) {
  if (!isVisibleToActor(action, actor)) return false
  // Staff-wide and branch-manager tasks are intentionally shared queues.
  // PT/coach/sales learner actions must additionally match an explicit
  // assignment captured by the server projection.
  if (['admin', 'super_admin'].includes(actor.accessRole)) return true
  if (roleKeys(actor).has('branch_manager')) return Boolean(action.branchId && Array.isArray(actor.branchIds) && actor.branchIds.includes(action.branchId))
  return hasStudentAssignment(action, actor)
}

function redactedAction(action, actor) {
  const allowed = canViewAction(action, actor)
  if (!allowed) return null
  return {
    actionId: action.actionId,
    sourceType: action.sourceType,
    sourceId: action.sourceId,
    actionType: action.actionType,
    branchId: action.branchId || null,
    studentId: action.studentId || null,
    severity: action.severity,
    status: action.status,
    title: clean(action.title, 160),
    redactedSummary: clean(action.redactedSummary, 400),
    dueAt: action.dueAt?.toDate?.()?.toISOString?.() || action.dueAt || null,
    assignedUid: action.assignedUid || null,
    availableActions: Array.isArray(action.availableActions) ? action.availableActions.slice(0, 12) : [],
    createdAt: action.createdAt?.toDate?.()?.toISOString?.() || action.createdAt || null,
    updatedAt: action.updatedAt?.toDate?.()?.toISOString?.() || action.updatedAt || null,
    claimedAt: action.claimedAt?.toDate?.()?.toISOString?.() || action.claimedAt || null,
    resolvedAt: action.resolvedAt?.toDate?.()?.toISOString?.() || action.resolvedAt || null,
  }
}

function actionDocument(input) {
  const sourceType = clean(input.sourceType, 60)
  const sourceId = clean(input.sourceId, 160)
  const actionType = clean(input.actionType, 80)
  if (!sourceType || !sourceId || !actionType) throw new Error('action_source_required')
  const status = ACTION_STATUSES.has(input.status) ? input.status : 'open'
  return {
    schemaVersion: 1,
    actionId: actionId(sourceType, sourceId, actionType),
    sourceType,
    sourceId,
    actionType,
    branchId: clean(input.branchId, 200) || null,
    studentId: clean(input.studentId, 200) || null,
    severity: ['critical', 'warning', 'info'].includes(input.severity) ? input.severity : 'warning',
    status,
    title: clean(input.title, 160),
    redactedSummary: clean(input.redactedSummary, 400),
    dueAt: input.dueAt || null,
    assignedUid: clean(input.assignedUid, 200) || null,
    allowedRoles: [...new Set((Array.isArray(input.allowedRoles) ? input.allowedRoles : []).map((item) => clean(item, 60)).filter(Boolean))].slice(0, 12),
    assignedStaffIds: [...new Set((Array.isArray(input.assignedStaffIds) ? input.assignedStaffIds : []).map((item) => clean(item, 200)).filter(Boolean))].slice(0, 20),
    availableActions: [...new Set((Array.isArray(input.availableActions) ? input.availableActions : []).map((item) => clean(item, 60)).filter(Boolean))].slice(0, 12),
    sourceRefs: [...new Set((Array.isArray(input.sourceRefs) ? input.sourceRefs : []).map((item) => clean(item, 240)).filter(Boolean))].slice(0, 12),
    createdAt: input.createdAt || null,
    updatedAt: input.updatedAt || null,
    claimedAt: input.claimedAt || null,
    resolvedAt: input.resolvedAt || null,
    resolvedBy: clean(input.resolvedBy, 200) || null,
    snoozedUntil: input.snoozedUntil || null,
  }
}

async function upsertOperationalAction({ db, input, logger = console }) {
  const next = actionDocument(input)
  const reference = db.doc(`operationalActions/${next.actionId}`)
  const existing = await reference.get()
  const existingValue = existing.exists ? existing.data() : null
  const snoozedUntilMillis = existingValue?.snoozedUntil?.toMillis?.() || 0
  const sourceClosed = Boolean(existingValue?.sourceClosedAt)
  const manuallyResolved = existingValue?.status === 'resolved'
    && existingValue?.resolution !== 'source_no_longer_actionable'
    && !sourceClosed
  const activeSnooze = existingValue?.status === 'snoozed' && snoozedUntilMillis > Date.now()
  const reopening = existingValue?.status === 'resolved'
    && (existingValue?.resolution === 'source_no_longer_actionable' || sourceClosed)
  const preservedStatus = next.status === 'open' && existingValue
    ? ACTIVE_STATUSES.has(existingValue.status)
      ? existingValue.status
      : activeSnooze
        ? 'snoozed'
        : manuallyResolved
          ? 'resolved'
          : 'open'
    : next.status
  const payload = {
    ...next,
    status: preservedStatus,
    createdAt: existingValue?.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...(reopening ? { claimedAt: null, assignedUid: null, resolvedAt: null, resolvedBy: null, resolution: null, sourceClosedAt: null } : {}),
    ...(!reopening && existingValue?.claimedAt ? { claimedAt: existingValue.claimedAt } : {}),
    ...(!reopening && existingValue?.assignedUid ? { assignedUid: existingValue.assignedUid } : {}),
    ...(activeSnooze ? { snoozedUntil: existingValue.snoozedUntil } : {}),
    ...(manuallyResolved ? {
      resolvedAt: existingValue.resolvedAt || null,
      resolvedBy: existingValue.resolvedBy || null,
      resolution: existingValue.resolution || null,
    } : {}),
  }
  await reference.set(payload, { merge: true })
  logger.info?.('operational_action_upserted', {
    actionId: next.actionId,
    status: preservedStatus,
    sourceType: next.sourceType,
    actionType: next.actionType,
  })
  return { ...next, ...payload, status: preservedStatus }
}

async function transitionAction({ db, actor, actionId: rawActionId, transition, until = null, resolution = '' }) {
  const normalizedId = clean(rawActionId, 400)
  if (!normalizedId || normalizedId.includes('/')) throw new HttpsError('invalid-argument', 'Mã tác vụ không hợp lệ.')
  const reference = db.doc(`operationalActions/${normalizedId}`)
  const auditReference = db.collection('auditLogs').doc()
  const occurredAtMillis = Date.now()
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy tác vụ.')
    const current = snapshot.data()
    if (!canViewAction(current, actor)) throw new HttpsError('permission-denied', 'Tác vụ nằm ngoài phạm vi được cấp.')
    if (transition === 'claim') {
      if (current.status !== 'open') throw new HttpsError('failed-precondition', 'Tác vụ không còn ở trạng thái có thể nhận.')
      transaction.update(reference, { status: 'in_progress', assignedUid: actor.uid, claimedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(auditReference, { schemaVersion: 1, action: 'operational_action.claim', actionId: normalizedId, actorUid: actor.uid, createdAt: FieldValue.serverTimestamp() })
      return { ...current, status: 'in_progress', assignedUid: actor.uid }
    }
    if (transition === 'resolve') {
      if (!ACTIVE_STATUSES.has(current.status)) throw new HttpsError('failed-precondition', 'Tác vụ đã được xử lý hoặc tạm hoãn.')
      if (current.assignedUid && current.assignedUid !== actor.uid && !['admin', 'super_admin'].includes(actor.accessRole) && !roleKeys(actor).has('branch_manager')) {
        throw new HttpsError('failed-precondition', 'Tác vụ đang được nhân sự khác xử lý.')
      }
      transaction.update(reference, { status: 'resolved', resolvedAt: FieldValue.serverTimestamp(), resolvedBy: actor.uid, resolution: clean(resolution, 500) || null, updatedAt: FieldValue.serverTimestamp() })
      transaction.create(auditReference, { schemaVersion: 1, action: 'operational_action.resolve', actionId: normalizedId, actorUid: actor.uid, createdAt: FieldValue.serverTimestamp() })
      if (current.studentId) {
        const sourceId = `operational-action:${normalizedId}`
        const digest = createHash('sha256').update(`${current.studentId}:care:${sourceId}`).digest('hex').slice(0, 24)
        const eventId = `${current.studentId}_${digest}`
        const activityId = `operational_${createHash('sha256').update(normalizedId).digest('hex').slice(0, 32)}`
        const note = clean(resolution, 500) || `Đã hoàn tất: ${clean(current.title, 160)}`
        transaction.set(db.doc(`studentCareActivities/${activityId}`), {
          schemaVersion: 1,
          studentId: current.studentId,
          type: 'action_completed',
          note,
          actionId: normalizedId,
          visibility: 'care',
          actorUid: actor.uid,
          actorName: actor.actorName || 'Nhân sự Aura',
          createdAt: FieldValue.serverTimestamp(),
          createdAtMillis: occurredAtMillis,
        }, { merge: true })
        transaction.set(db.doc(`studentTimelineEvents/${eventId}`), {
          id: eventId,
          schemaVersion: 1,
          studentId: current.studentId,
          type: 'care',
          sourceId,
          occurredAt: new Date(occurredAtMillis).toISOString(),
          occurredAtMillis,
          sortKey: occurredAtMillis * 1000,
          title: 'Đã hoàn tất tác vụ vận hành',
          description: note,
          audience: 'care',
          metadata: { activityId, actionId: normalizedId, actorName: actor.actorName || 'Nhân sự Aura' },
          group: 'care',
          groupLabel: 'Chăm sóc',
          sourceCollection: 'studentCareActivities',
          sourceLabel: 'Nhật ký chăm sóc',
          dedupeKey: `care:${activityId}`,
        }, { merge: true })
      }
      return { ...current, status: 'resolved', resolvedBy: actor.uid }
    }
    if (transition === 'snooze') {
      if (!ACTIVE_STATUSES.has(current.status)) throw new HttpsError('failed-precondition', 'Tác vụ không còn ở trạng thái có thể tạm hoãn.')
      if (current.assignedUid && current.assignedUid !== actor.uid && !['admin', 'super_admin'].includes(actor.accessRole) && !roleKeys(actor).has('branch_manager')) {
        throw new HttpsError('failed-precondition', 'Tác vụ đang được nhân sự khác xử lý.')
      }
      const parsed = new Date(until || 0)
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) throw new HttpsError('invalid-argument', 'Thời điểm tạm hoãn không hợp lệ.')
      transaction.update(reference, { status: 'snoozed', snoozedUntil: Timestamp.fromDate(parsed), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(auditReference, { schemaVersion: 1, action: 'operational_action.snooze', actionId: normalizedId, actorUid: actor.uid, snoozedUntil: Timestamp.fromDate(parsed), createdAt: FieldValue.serverTimestamp() })
      return { ...current, status: 'snoozed', snoozedUntil: parsed.toISOString() }
    }
    throw new HttpsError('invalid-argument', 'Trạng thái tác vụ không hợp lệ.')
  })
  return redactedAction(result, actor) || { actionId: normalizedId, status: result.status }
}

function normalizePageSize(value) {
  const number = Number(value)
  return Number.isInteger(number) ? Math.min(MAX_PAGE_SIZE, Math.max(1, number)) : 40
}

function createActionCenterFunctions({ db, onCall, logger = console }) {
  const listOperationalActions = onCall(withFunctionTelemetry('listOperationalActions', async (request) => {
    const actor = await trustedAccessContext(request, db)
    const pageSize = normalizePageSize(request.data?.pageSize)
    const cursor = clean(request.data?.cursor, 400)
    const statuses = Array.isArray(request.data?.statuses)
      ? request.data.statuses.filter((status) => ACTIVE_STATUSES.has(status))
      : ['open', 'in_progress']
    let query = db.collection('operationalActions').orderBy(FieldPath.documentId()).limit(MAX_SCAN)
    if (cursor) query = query.startAfter(cursor)
    const snapshot = await query.get()
    const rows = []
    let lastProcessedId = ''
    let processed = 0
    for (const document of snapshot.docs) {
      processed += 1
      lastProcessedId = document.id
      const item = { id: document.id, ...document.data() }
      if (!statuses.includes(item.status)) continue
      if (item.snoozedUntil && item.snoozedUntil.toMillis?.() > Date.now()) continue
      const row = redactedAction(item, actor)
      if (row) rows.push(row)
      if (rows.length >= pageSize) break
    }
    const hasMore = Boolean(lastProcessedId) && (processed < snapshot.size || snapshot.size === MAX_SCAN)
    const nextCursor = hasMore ? lastProcessedId : null
    logger.info?.('operational_action_listed', { actorUid: actor.uid, rowCount: rows.length, pageSize })
    return { schemaVersion: 1, rows, hasMore, nextCursor }
  }))

  const getOperationalActionSummary = onCall(withFunctionTelemetry('getOperationalActionSummary', async (request) => {
    const actor = await trustedAccessContext(request, db)
    const snapshot = await db.collection('operationalActions').where('status', 'in', ['open', 'in_progress']).limit(MAX_SCAN).get()
    const visible = snapshot.docs.map((item) => item.data()).filter((item) => canViewAction(item, actor))
    return {
      schemaVersion: 1,
      total: visible.length,
      critical: visible.filter((item) => item.severity === 'critical').length,
      warning: visible.filter((item) => item.severity === 'warning').length,
      info: visible.filter((item) => item.severity === 'info').length,
    }
  }))

  const claimOperationalAction = onCall(withFunctionTelemetry('claimOperationalAction', async (request) => {
    const actor = await trustedAccessContext(request, db)
    return transitionAction({ db, actor, actionId: request.data?.actionId, transition: 'claim' })
  }))
  const resolveOperationalAction = onCall(withFunctionTelemetry('resolveOperationalAction', async (request) => {
    const actor = await trustedAccessContext(request, db)
    return transitionAction({ db, actor, actionId: request.data?.actionId, transition: 'resolve', resolution: request.data?.resolution })
  }))
  const snoozeOperationalAction = onCall(withFunctionTelemetry('snoozeOperationalAction', async (request) => {
    const actor = await trustedAccessContext(request, db)
    return transitionAction({ db, actor, actionId: request.data?.actionId, transition: 'snooze', until: request.data?.until })
  }))

  return { listOperationalActions, getOperationalActionSummary, claimOperationalAction, resolveOperationalAction, snoozeOperationalAction }
}

function contractActionInputs(contractId, value, now = new Date()) {
  const today = vietnamDateKey(now)
  const endKey = vietnamDateKey(value.endDate)
  const end = endKey ? new Date(`${endKey}T00:00:00+07:00`) : null
  const daysRemaining = dateKeyDistance(today, endKey)
  const total = Math.max(0, Number(value.totalSessions || 0))
  const used = Math.max(0, Number(value.usedSessions || 0))
  const debt = Math.max(0, Number(value.totalPrice || 0) - Number(value.discount || 0) - Number(value.paidAmount || 0))
  const status = String(value.status || '').toLowerCase()
  const actionableContract = !['cancelled', 'archived'].includes(status)
  const branchId = value.branchId || value.branch || null
  const studentId = value.studentId || value.crmProfileId || null
  const assignedStaffIds = [...new Set([
    value.trainerId,
    ...(Array.isArray(value.trainerIds) ? value.trainerIds : []),
    ...(Array.isArray(value.nutritionPTIds) ? value.nutritionPTIds : []),
    value.assignedSalesId,
  ].map((item) => clean(item, 200)).filter(Boolean))]
  const rows = []
  if (total > 0 && used >= total && actionableContract) rows.push({ sourceType: 'contract', sourceId: contractId, actionType: 'sessions_exhausted', severity: 'critical', title: 'Hợp đồng đã hết buổi', redactedSummary: 'Cần kiểm tra gia hạn hoặc gói tập tiếp theo.', availableActions: ['open_contract', 'start_renewal'] })
  const paymentDueKey = vietnamDateKey(value.nextPaymentDate || value.paymentDueDate)
  const paymentStatus = String(value.paymentStatus || value.payment?.status || '').trim().toLowerCase()
  const overdueDebt = debt > 0 && (['overdue', 'past_due'].includes(paymentStatus) || (paymentDueKey ? paymentDueKey < today : Boolean(endKey && endKey < today)))
  if (overdueDebt && actionableContract) rows.push({ sourceType: 'contract', sourceId: contractId, actionType: 'payment_overdue', severity: 'warning', title: 'Công nợ đã quá hạn', redactedSummary: 'Cần kiểm tra trạng thái thanh toán và liên hệ học viên.', availableActions: ['open_contract', 'contact_student'] })
  if (value.contractUsageReconciliationStatus && value.contractUsageReconciliationStatus !== 'matched' && actionableContract) rows.push({ sourceType: 'contract', sourceId: contractId, actionType: 'usage_mismatch', severity: value.contractUsageReconciliationStatus === 'over_entitlement' ? 'critical' : 'warning', title: 'Quyền lợi buổi cần đối soát', redactedSummary: 'Số buổi hợp đồng và bằng chứng điểm danh đang có sai lệch; cần đối soát trước khi điều chỉnh.', availableActions: ['open_contract', 'reconcile_usage'] })
  if (daysRemaining !== null && daysRemaining < 0 && actionableContract) rows.push({ sourceType: 'contract', sourceId: contractId, actionType: 'expired', severity: 'critical', title: 'Hợp đồng đã hết hiệu lực', redactedSummary: 'Không nên xếp thêm lịch trước khi kiểm tra gia hạn hoặc hợp đồng mới.', availableActions: ['open_contract', 'start_renewal'] })
  if (daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 30 && actionableContract) rows.push({ sourceType: 'contract', sourceId: contractId, actionType: 'renewal_due', severity: 'warning', title: 'Hợp đồng sắp hết hạn', redactedSummary: 'Hợp đồng sẽ hết hạn trong 30 ngày tới.', dueAt: end, availableActions: ['open_contract', 'start_renewal'] })
  return rows.map((row) => ({ ...row, branchId, studentId, assignedStaffIds, allowedRoles: ['admin', 'super_admin', 'staff', 'trainer_pt', 'coach_online', 'sales', 'branch_manager'] }))
}

function contractStaffIds(value = {}) {
  return [
    value.trainerId,
    ...(Array.isArray(value.trainerIds) ? value.trainerIds : []),
    ...(Array.isArray(value.nutritionPTIds) ? value.nutritionPTIds : []),
    value.assignedSalesId,
  ].map((item) => clean(item, 200)).filter(Boolean)
}

function scheduleDraftBlockerCategory(entry = {}) {
  const stored = clean(entry.blockerCategory, 60)
  if (['contract', 'learner_availability', 'trainer_capacity', 'branch_capacity', 'optimizer'].includes(stored)) return stored
  const reason = clean(entry.primaryReasonCode, 100)
  if (/CONTRACT|QUOTA/.test(reason)) return 'contract'
  if (/AVAILABILITY/.test(reason) && !/TRAINER/.test(reason)) return 'learner_availability'
  if (/BRANCH_CAPACITY/.test(reason)) return 'branch_capacity'
  if (/TRAINER|CAPACITY/.test(reason)) return 'trainer_capacity'
  return 'optimizer'
}

function scheduleDraftActionInputs(sourceId, value = {}, studentValues = new Map()) {
  const rawEntries = Array.isArray(value.unassignedEntries) ? value.unassignedEntries.slice(0, 200) : []
  const entriesByStudent = new Map()
  for (const entry of rawEntries) {
    const studentId = clean(entry?.studentId, 200)
    if (!studentId || studentId.includes('/')) continue
    const previous = entriesByStudent.get(studentId)
    const blockerRank = (item) => ({ contract: 0, learner_availability: 1, branch_capacity: 2, trainer_capacity: 2, optimizer: 3 })[scheduleDraftBlockerCategory(item)] ?? 4
    if (!previous
      || blockerRank(entry) < blockerRank(previous)
      || (blockerRank(entry) === blockerRank(previous) && Number(entry?.missingSessions || 0) > Number(previous?.missingSessions || 0))) {
      entriesByStudent.set(studentId, entry)
    }
  }
  return [...entriesByStudent].map(([studentId, entry]) => {
    const category = scheduleDraftBlockerCategory(entry)
    const reason = clean(entry.primaryReasonCode, 100) || clean(entry.blockerType, 100) || 'STUDENT_UNSCHEDULED'
    const missingSessions = Math.max(1, Math.min(20, Number(entry.missingSessions || 1)))
    const student = studentValues.get(studentId) || {}
    const assignedStaffIds = [...new Set([
      student.trainerId,
      ...(Array.isArray(student.trainerIds) ? student.trainerIds : []),
      ...(Array.isArray(student.secondaryTrainerIds) ? student.secondaryTrainerIds : []),
    ].map((item) => clean(item, 200)).filter(Boolean))]
    const presentation = category === 'contract'
      ? {
          title: 'Lịch thiếu do điều kiện hợp đồng',
          summary: reason === 'CONTRACT_SESSION_QUOTA_EXCEEDED'
            ? `Còn thiếu ${missingSessions} buổi nhưng quyền lợi hợp đồng đã hết.`
            : `Còn thiếu ${missingSessions} buổi; cần kiểm tra hiệu lực hợp đồng trước khi xếp tiếp.`,
          severity: ['CONTRACT_SESSION_QUOTA_EXCEEDED', 'CONTRACT_EXPIRED_BEFORE_WEEK', 'ACTIVE_CONTRACT_NOT_FOUND'].includes(reason) ? 'critical' : 'warning',
          actions: ['open_student', 'open_contract'],
        }
      : category === 'learner_availability'
        ? {
            title: 'Học viên chưa đủ lịch đăng ký',
            summary: `Còn thiếu ${missingSessions} buổi do chưa có đủ ngày hoặc khung giờ phù hợp.`,
            severity: 'warning',
            actions: ['open_student', 'open_schedule', 'contact_student'],
          }
        : ['trainer_capacity', 'branch_capacity'].includes(category)
          ? {
              title: 'Thiếu ca phù hợp để xếp lịch',
              summary: `Còn thiếu ${missingSessions} buổi do năng lực phục vụ trong các khung học viên đã đăng ký.`,
              severity: 'warning',
              actions: ['open_schedule'],
            }
          : {
              title: 'Lịch còn thiếu sau tối ưu',
              summary: `Còn thiếu ${missingSessions} buổi dù vẫn có phương án cần được quản lý kiểm tra.`,
              severity: 'info',
              actions: ['open_schedule'],
            }
    return {
      sourceType: 'schedule_draft',
      sourceId,
      actionType: `missing_student_${createHash('sha256').update(studentId).digest('hex').slice(0, 24)}`,
      branchId: value.branchId || student.branchId,
      studentId,
      assignedStaffIds,
      severity: presentation.severity,
      title: presentation.title,
      redactedSummary: presentation.summary,
      allowedRoles: ['admin', 'super_admin', 'staff', 'trainer_pt', 'branch_manager'],
      availableActions: presentation.actions,
      sourceRefs: [`ptScheduleDrafts/${sourceId}`, `students/${studentId}`],
    }
  })
}

async function operationalStudentContext(db, { studentId: suppliedStudentId = '', accountUid = '' }) {
  let studentId = clean(suppliedStudentId, 200)
  const uid = clean(accountUid, 200)
  if (!studentId && uid) {
    const reverse = await db.doc(`accountIdentityLinks/${uid}`).get()
    if (reverse.exists && reverse.data()?.status === 'active') studentId = clean(reverse.data()?.studentId, 200)
    if (!studentId) {
      const linked = await db.collection('students').where('accountUid', '==', uid).limit(2).get()
      if (linked.size === 1) studentId = linked.docs[0].id
    }
  }
  if (!studentId) return { studentId: null, branchId: null, assignedStaffIds: [] }
  const [student, canonicalContracts, legacyContracts] = await Promise.all([
    db.doc(`students/${studentId}`).get(),
    db.collection('contracts').where('studentId', '==', studentId).limit(20).get(),
    db.collection('contracts').where('crmProfileId', '==', studentId).limit(20).get(),
  ])
  const contracts = [...new Map(
    [...canonicalContracts.docs, ...legacyContracts.docs].map((item) => [item.id, item.data() || {}]),
  ).values()].filter((value) => !['cancelled', 'archived'].includes(String(value.status || '').toLowerCase()))
  const studentValue = student.exists ? student.data() || {} : {}
  return {
    studentId,
    branchId: clean(studentValue.branchId, 200) || clean(contracts.find((item) => item.branchId)?.branchId, 200) || null,
    assignedStaffIds: [...new Set([
      studentValue.trainerId,
      ...(Array.isArray(studentValue.trainerIds) ? studentValue.trainerIds : []),
      ...(Array.isArray(studentValue.nutritionPTIds) ? studentValue.nutritionPTIds : []),
      studentValue.assignedSalesId,
      ...contracts.flatMap(contractStaffIds),
    ].map((item) => clean(item, 200)).filter(Boolean))],
  }
}

async function syncOperationalActionSource({ db, event, logger = console }) {
  const eventCollection = event.data?.after?.ref?.parent?.id || event.data?.before?.ref?.parent?.id || ''
  const collection = ['contracts', 'contractUsageViews', 'sessionRequests', 'mealReviews', 'sessions', 'students', 'studentOperationalViews', 'ptScheduleDrafts', 'contractRenewalCases'].includes(eventCollection)
    ? eventCollection
    : event.params?.requestId ? 'sessionRequests' : event.params?.reviewId ? 'mealReviews' : event.params?.sessionId ? 'sessions' : event.params?.studentId ? 'students' : event.params?.documentId ? 'contractRenewalCases' : event.params?.contractId ? 'contracts' : ''
  const sourceId = Object.values(event.params || {})[0]
  const value = event.data?.after?.exists ? event.data.after.data() : null
  const previousValue = event.data?.before?.exists ? event.data.before.data() : null
  const sourceValue = value || previousValue || {}
  if (!collection || !sourceId) return { collection: null, sourceId: null, actions: 0 }
  let inputs = []
  if (collection === 'contracts' && value) {
    const usage = await db.doc(`contractUsageViews/${sourceId}`).get()
    inputs = contractActionInputs(sourceId, usage.exists ? {
      ...value,
      totalSessions: usage.data()?.entitlementSessions ?? value.totalSessions,
      usedSessions: usage.data()?.usedSessions ?? value.usedSessions,
      contractUsageReconciliationStatus: usage.data()?.reconciliationStatus,
    } : value)
  }
  if (collection === 'contractUsageViews' && value) {
    const contract = await db.doc(`contracts/${sourceId}`).get()
    if (contract.exists) inputs = contractActionInputs(sourceId, {
      ...contract.data(),
      totalSessions: value.entitlementSessions ?? contract.data()?.totalSessions,
      usedSessions: value.usedSessions ?? contract.data()?.usedSessions,
      contractUsageReconciliationStatus: value.reconciliationStatus,
    })
  }
  if (collection === 'sessionRequests' && value && ['pending', 'requested', 'open'].includes(String(value.status || '').toLowerCase())) {
    inputs = [{ sourceType: 'session_request', sourceId, actionType: 'review', branchId: value.branchId, studentId: value.studentId, assignedStaffIds: [value.trainerId, value.assignedTrainerId, value.createdBy].filter(Boolean), severity: 'warning', title: 'Yêu cầu lịch cần duyệt', redactedSummary: 'Có yêu cầu đổi hoặc bổ sung lịch cần xử lý.', allowedRoles: ['admin', 'super_admin', 'staff', 'trainer_pt', 'branch_manager'], availableActions: ['review_request'] }]
  }
  if (collection === 'mealReviews' && value && ['pending', 'submitted', 'waiting'].includes(String(value.status || '').toLowerCase())) {
    const createdAt = timestampMillis(value.createdAt || value.submittedAt)
    const overdue = createdAt > 0 && Date.now() - createdAt > 24 * 60 * 60 * 1000
    inputs = [{ sourceType: 'meal_review', sourceId, actionType: 'review', branchId: value.branchId, studentId: value.studentId, assignedStaffIds: [value.coachId, value.reviewerId, value.assignedCoachId].filter(Boolean), severity: overdue ? 'warning' : 'info', title: overdue ? 'Bữa ăn quá SLA' : 'Bữa ăn chờ duyệt', redactedSummary: overdue ? 'Có nhật ký dinh dưỡng chờ duyệt quá 24 giờ.' : 'Có nhật ký dinh dưỡng đang chờ coach xem.', allowedRoles: ['admin', 'super_admin', 'staff', 'coach_online'], availableActions: ['review_meal'] }]
  }
  if (collection === 'sessions' && sourceValue.studentId) {
    const studentId = sourceValue.studentId
    const recent = await db.collection('sessions')
      .where('studentId', '==', studentId)
      .orderBy('date', 'desc')
      .limit(20)
      .get()
    const recentSessions = recent.docs.map((item) => ({ id: item.id, ...item.data() }))
    const consecutive = hasThreeConsecutiveNoShows(recentSessions)
    if (consecutive) inputs = [{ sourceType: 'student', sourceId: studentId, actionType: 'three_no_shows', branchId: sourceValue.branchId, studentId, assignedStaffIds: recent.docs.map((item) => item.data()?.trainerId).filter(Boolean), severity: 'critical', title: 'Ba lần vắng liên tiếp', redactedSummary: 'Học viên có ba buổi vắng liên tiếp; cần liên hệ và kiểm tra lại lịch.', allowedRoles: ['admin', 'super_admin', 'staff', 'trainer_pt', 'branch_manager'], availableActions: ['open_student', 'contact_student'] }]
  }
  if (collection === 'students' && value) {
    const target = Number(value.sessionsPerWeek || value.weeklyTarget || 0)
    const scheduled = Number(value.scheduledSessionsCurrentWeek || value.currentWeekScheduledSessions || 0)
    if (target > 0 && Number.isFinite(scheduled) && scheduled < target) inputs = [{ sourceType: 'student', sourceId, actionType: 'missing_schedule', branchId: value.branchId, studentId: sourceId, assignedStaffIds: [value.trainerId, ...(Array.isArray(value.trainerIds) ? value.trainerIds : [])].filter(Boolean), severity: 'warning', title: 'Học viên chưa đủ lịch tuần', redactedSummary: `Đã xếp ${Math.max(0, scheduled)}/${target} buổi mục tiêu trong tuần.`, allowedRoles: ['admin', 'super_admin', 'staff', 'trainer_pt', 'branch_manager'], availableActions: ['open_student', 'open_schedule'] }]
  }
  if (collection === 'studentOperationalViews' && value) {
    const redAlerts = Array.isArray(value.alerts) ? value.alerts.filter((item) => item?.severity === 'red') : []
    if (value.health?.status === 'action_required' || redAlerts.length) {
      inputs = [{
        sourceType: 'student', sourceId, actionType: 'health_alert',
        branchId: value.assignments?.branchId, studentId: value.studentId || sourceId,
        assignedStaffIds: [
          ...(Array.isArray(value.assignments?.trainerIds) ? value.assignments.trainerIds : []),
          ...(Array.isArray(value.assignments?.nutritionCoachIds) ? value.assignments.nutritionCoachIds : []),
          ...(Array.isArray(value.assignments?.salesIds) ? value.assignments.salesIds : []),
        ],
        severity: 'critical', title: 'Học viên có cảnh báo đỏ',
        redactedSummary: redAlerts[0]?.title || 'Sức khỏe hành trình đang ở mức cần xử lý.',
        allowedRoles: ['admin', 'super_admin', 'staff', 'trainer_pt', 'coach_online', 'sales', 'branch_manager'],
        availableActions: ['open_student', 'contact_student'],
      }]
    }
  }
  if (collection === 'ptScheduleDrafts' && value) {
    const schedule = value.schedule && typeof value.schedule === 'object' ? value.schedule : {}
    const trainerIds = [...new Set(Object.values(schedule).flatMap((rawEntries) => (
      Array.isArray(rawEntries) ? rawEntries.map((item) => clean(item?.trainerId, 200)) : []
    )).filter(Boolean))].slice(0, 100)
    const trainerSnapshots = trainerIds.length ? await db.getAll(...trainerIds.map((trainerId) => db.doc(`trainers/${trainerId}`))) : []
    const trainerCapacity = new Map(trainerSnapshots.map((item) => [item.id, Math.max(1, Number(item.data()?.slotCapacity || 1))]))
    for (const [slotId, rawEntries] of Object.entries(schedule)) {
      const entries = Array.isArray(rawEntries) ? rawEntries.filter((item) => item?.type !== 'off' && item?.studentId !== 'OFF') : []
      const byTrainer = new Map()
      entries.forEach((item) => {
        const trainerId = clean(item?.trainerId, 200)
        if (!trainerId) return
        const group = byTrainer.get(trainerId) || []
        group.push(item)
        byTrainer.set(trainerId, group)
      })
      for (const [trainerId, group] of byTrainer) {
        if (group.length !== 1 || (trainerCapacity.get(trainerId) || 1) < 2) continue
        inputs.push({
          sourceType: 'schedule_draft', sourceId, actionType: `pair_slot_${clean(slotId, 40)}_${trainerId}`,
          branchId: value.branchId, studentId: group[0].studentId, assignedStaffIds: [trainerId],
          severity: 'info', title: 'Ca 1/2 đang chờ ghép',
          redactedSummary: `Khung ${clean(slotId, 40)} còn một chỗ phù hợp để ưu tiên ghép ca.`,
          allowedRoles: ['admin', 'super_admin', 'staff', 'trainer_pt', 'branch_manager'],
          availableActions: ['open_schedule'],
        })
      }
    }
    const unassignedStudentIds = [...new Set((Array.isArray(value.unassignedEntries) ? value.unassignedEntries : [])
      .map((item) => clean(item?.studentId, 200))
      .filter((studentId) => studentId && !studentId.includes('/')))].slice(0, 200)
    const studentSnapshots = unassignedStudentIds.length
      ? await db.getAll(...unassignedStudentIds.map((studentId) => db.doc(`students/${studentId}`)))
      : []
    const studentValues = new Map(studentSnapshots.map((item) => [item.id, item.exists ? item.data() || {} : {}]))
    inputs.push(...scheduleDraftActionInputs(sourceId, value, studentValues))
  }
  if (collection === 'contractRenewalCases' && value && !['resolved', 'cancelled', 'closed'].includes(String(value.status || '').toLowerCase())) {
    inputs = [{ sourceType: 'renewal_case', sourceId, actionType: 'follow_up', branchId: value.branchId, studentId: value.studentId, assignedStaffIds: [value.assignedSalesId, value.salesId, value.ownerUid].filter(Boolean), severity: 'warning', title: 'Hồ sơ gia hạn cần theo dõi', redactedSummary: 'Hồ sơ gia hạn đang mở và cần cập nhật bước tiếp theo.', allowedRoles: ['admin', 'super_admin', 'staff', 'sales', 'branch_manager'], availableActions: ['open_renewal'] }]
  }
  const studentContext = await operationalStudentContext(db, {
    studentId: collection === 'students' ? sourceId : sourceValue.studentId,
    accountUid: sourceValue.userId || sourceValue.accountUid,
  })
  if (studentContext.studentId) {
    inputs = inputs.map((input) => ({
      ...input,
      studentId: input.studentId || studentContext.studentId,
      branchId: input.branchId || studentContext.branchId,
      assignedStaffIds: [...new Set([...(input.assignedStaffIds || []), ...studentContext.assignedStaffIds])],
    }))
  }
  const expected = new Set(inputs.map((input) => actionId(input.sourceType, input.sourceId, input.actionType)))
  const cleanup = ['contracts', 'contractUsageViews'].includes(collection)
    ? { sourceType: 'contract', sourceId, actionTypes: new Set(['sessions_exhausted', 'payment_overdue', 'usage_mismatch', 'expired', 'renewal_due']) }
    : collection === 'sessionRequests'
      ? { sourceType: 'session_request', sourceId, actionTypes: new Set(['review']) }
      : collection === 'mealReviews'
        ? { sourceType: 'meal_review', sourceId, actionTypes: new Set(['review']) }
        : collection === 'sessions' && sourceValue.studentId
          ? { sourceType: 'student', sourceId: sourceValue.studentId, actionTypes: new Set(['three_no_shows']) }
          : collection === 'students'
            ? { sourceType: 'student', sourceId, actionTypes: new Set(['missing_schedule']) }
            : collection === 'studentOperationalViews'
              ? { sourceType: 'student', sourceId, actionTypes: new Set(['health_alert']) }
              : collection === 'ptScheduleDrafts'
                ? { sourceType: 'schedule_draft', sourceId, actionTypes: new Set(inputs.map((item) => item.actionType)), actionPrefixes: ['pair_slot_', 'missing_student_'] }
            : { sourceType: 'renewal_case', sourceId, actionTypes: new Set(['follow_up']) }
  const existing = await db.collection('operationalActions').where('sourceId', '==', cleanup.sourceId).limit(200).get()
  for (const item of existing.docs) {
    const current = item.data()
    const removedFromSource = current.sourceType === cleanup.sourceType
      && (cleanup.actionTypes.has(current.actionType) || (Array.isArray(cleanup.actionPrefixes) && cleanup.actionPrefixes.some((prefix) => current.actionType?.startsWith(prefix))))
      && !expected.has(item.id)
    if (removedFromSource && ACTIVE_STATUSES.has(current.status)) {
      await item.ref.set({ status: 'resolved', resolvedAt: FieldValue.serverTimestamp(), resolution: 'source_no_longer_actionable', sourceClosedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    } else if (removedFromSource && current.status === 'resolved' && current.resolution !== 'source_no_longer_actionable' && !current.sourceClosedAt) {
      await item.ref.set({ sourceClosedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    }
  }
  for (const input of inputs) await upsertOperationalAction({ db, input, logger })
  return { collection, sourceId, actions: inputs.length }
}

module.exports = {
  ACTION_STATUSES,
  actionId,
  actionDocument,
  isVisibleToActor,
  canViewAction,
  redactedAction,
  contractActionInputs,
  scheduleDraftActionInputs,
  hasThreeConsecutiveNoShows,
  operationalStudentContext,
  upsertOperationalAction,
  createActionCenterFunctions,
  syncOperationalActionSource,
}
