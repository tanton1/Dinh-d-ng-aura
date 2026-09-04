const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const {
  DEFAULT_POLICY,
  DEFAULT_REWARDS,
  LOYALTY_POLICY_VERSION,
  LOYALTY_SCHEMA_VERSION,
  ambassadorRateForQualifiedCount,
  applyAvailableEarning,
  calculateAmbassadorCommission,
  calculateSpendPoints,
  consumeAvailablePoints,
  defaultAccount,
  normalizeAccount,
  normalizeMemberReferralCode,
  referralCollectionSummary,
  redeemReservedPoints,
  releaseReservedPoints,
  renewalBonusRate,
  reverseAvailableEarning,
  sourceDocumentId,
  tierForCredit,
  tierProgress,
} = require('./loyalty-core')

const REGION = 'asia-southeast1'
const TIME_ZONE = 'Asia/Ho_Chi_Minh'
const MAX_PAGE_SIZE = 100
const MAX_RECONCILE_DOCUMENTS = 500
const DEFAULT_CALL_OPTIONS = { cpu: 'gcf_gen1', maxInstances: 3, concurrency: 8, timeoutSeconds: 60 }
const ADMIN_CALL_OPTIONS = { cpu: 'gcf_gen1', maxInstances: 2, concurrency: 4, timeoutSeconds: 90 }

function boundedString(value, label, maximum = 200, required = true) {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > maximum) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function documentId(value, label) {
  const result = boundedString(value, label, 200)
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function idempotencyKey(value) {
  const result = boundedString(value, 'Mã chống gửi trùng', 160)
  if (!/^[A-Za-z0-9:_-]+$/.test(result)) throw new HttpsError('invalid-argument', 'Mã chống gửi trùng không hợp lệ.')
  return result
}

function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const millis = value instanceof Date ? value.getTime() : new Date(value || '').getTime()
  return Number.isFinite(millis) ? millis : 0
}

function timestampIso(value) {
  const millis = timestampMillis(value)
  return millis ? new Date(millis).toISOString() : ''
}

function dateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const part = (type) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function effectiveDateKey(value) {
  const millis = timestampMillis(value)
  return dateKey(millis ? new Date(millis) : new Date())
}

function storedDateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const millis = timestampMillis(value)
  return millis ? new Date(millis).toISOString().slice(0, 10) : ''
}

function occurrenceDateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  return timestampMillis(value) ? effectiveDateKey(value) : ''
}

function occursOnOrAfterLaunch(occurrence, launchDate) {
  const occurrenceDate = occurrenceDateKey(occurrence)
  const safeLaunchDate = storedDateKey(launchDate)
  return Boolean(occurrenceDate && safeLaunchDate && occurrenceDate >= safeLaunchDate)
}

function contractActiveOn(contract = {}, referenceDate = dateKey()) {
  const status = String(contract.status || 'active').trim().toLowerCase()
  if (['draft', 'cancelled', 'canceled', 'inactive', 'archived'].includes(status)) return false
  const start = storedDateKey(contract.startDate)
  const end = storedDateKey(contract.endDate)
  return Boolean(start && end && start <= referenceDate && end >= referenceDate)
}

function normalizedContact(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9@._+]/g, '')
}

function quarterId(value = new Date()) {
  const key = dateKey(value)
  const quarter = Math.floor((Number(key.slice(5, 7)) - 1) / 3) + 1
  return `${key.slice(0, 4)}-Q${quarter}`
}

function mondayDateKey(referenceDate = dateKey()) {
  const instant = Date.parse(`${referenceDate}T12:00:00+07:00`)
  if (!Number.isFinite(instant)) return referenceDate
  const weekday = new Date(instant).getUTCDay()
  return new Date(instant - ((weekday + 6) % 7) * 86_400_000).toISOString().slice(0, 10)
}

function addDateDays(referenceDate, days) {
  const instant = Date.parse(`${referenceDate}T12:00:00Z`)
  return Number.isFinite(instant) ? new Date(instant + days * 86_400_000).toISOString().slice(0, 10) : referenceDate
}

function consecutiveCompletedWeeks(weeks = []) {
  let streak = 0
  for (const item of weeks) {
    const completed = Math.max(0, Number(item?.completed || 0))
    const target = Math.max(1, Number(item?.target || 1))
    if (completed < target) break
    streak += 1
  }
  return streak
}

function publicAccount(value, policy = DEFAULT_POLICY) {
  const account = normalizeAccount(value)
  return {
    studentId: account.studentId,
    status: account.status,
    availablePoints: account.availablePoints,
    pendingPoints: account.pendingPoints,
    reservedPoints: account.reservedPoints,
    debtPoints: account.debtPoints,
    lifetimeEarnedPoints: account.lifetimeEarnedPoints,
    lifetimeRedeemedPoints: account.lifetimeRedeemedPoints,
    tierQualifyingValue: account.tierQualifyingValue,
    tier: account.tier,
    tierProgress: tierProgress(account.tierQualifyingValue, policy.tierThresholds),
    revision: account.revision,
    updatedAt: timestampIso(value?.updatedAt),
  }
}

function publicLedgerEntry(snapshot) {
  const value = snapshot.data()
  return {
    id: snapshot.id,
    kind: value.kind || 'earn',
    sourceType: value.sourceType || 'unknown',
    description: value.description || 'Giao dịch Điểm Aura',
    pendingDelta: Number(value.pendingDelta || 0),
    availableDelta: Number(value.availableDelta || 0),
    reservedDelta: Number(value.reservedDelta || 0),
    debtDelta: Number(value.debtDelta || 0),
    sourceBranchId: value.sourceBranchId || '',
    createdAt: timestampIso(value.createdAt || value.effectiveAt),
    availableAt: timestampIso(value.availableAt),
  }
}

function normalizedPolicy(value = {}) {
  const tierThresholds = { ...DEFAULT_POLICY.tierThresholds, ...(value.tierThresholds || {}) }
  const tierMultipliers = { ...DEFAULT_POLICY.tierMultipliers, ...(value.tierMultipliers || {}) }
  return {
    ...DEFAULT_POLICY,
    ...value,
    tierThresholds,
    tierMultipliers,
    attendance: { ...DEFAULT_POLICY.attendance, ...(value.attendance || {}) },
    nutrition: { ...DEFAULT_POLICY.nutrition, ...(value.nutrition || {}) },
  }
}

async function currentPolicy(db) {
  const settings = await db.doc('loyaltySettings/current').get()
  const version = settings.exists && typeof settings.data().activePolicyVersion === 'string'
    ? settings.data().activePolicyVersion
    : LOYALTY_POLICY_VERSION
  const policy = await db.doc(`loyaltyPolicyVersions/${version}`).get()
  return normalizedPolicy(policy.exists ? { ...policy.data(), version: policy.id } : DEFAULT_POLICY)
}

async function findStudentForUid(db, uid) {
  const direct = await db.doc(`students/${uid}`).get()
  if (direct.exists && (!direct.data().accountUid || direct.data().accountUid === uid)) {
    return { id: direct.id, ...direct.data(), accountUid: direct.data().accountUid || uid }
  }
  const snapshot = await db.collection('students').where('accountUid', '==', uid).limit(2).get()
  if (snapshot.size !== 1) {
    throw new HttpsError('failed-precondition', snapshot.empty
      ? 'Hồ sơ học viên chưa được liên kết với tài khoản Aura.'
      : 'Tài khoản đang liên kết với nhiều hồ sơ học viên. Cần Admin đối soát trước khi dùng Aura Club.')
  }
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data(), accountUid: uid }
}

async function studentActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  if (actor.accessRole !== 'student') throw new HttpsError('permission-denied', 'Aura Club học viên chỉ dành cho tài khoản học viên.')
  const student = await findStudentForUid(db, actor.uid)
  return { actor, student }
}

async function capabilityActor(request, db, capability) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, capability)
  return actor
}

function canAccessBranch(actor, branchId) {
  return actor.accessRole === 'admin'
    || actor.accessRole === 'super_admin'
    || (branchId && actor.branchIds.includes(branchId))
}

async function scopedStudent(db, actor, studentId) {
  const snapshot = await db.doc(`students/${documentId(studentId, 'Mã học viên')}`).get()
  if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy học viên.')
  const value = snapshot.data()
  if (!canAccessBranch(actor, value.branchId || '')) throw new HttpsError('permission-denied', 'Học viên không thuộc phạm vi chi nhánh của bạn.')
  return { id: snapshot.id, ...value }
}

function accountProjection(account) {
  const normalized = normalizeAccount(account)
  return {
    schemaVersion: LOYALTY_SCHEMA_VERSION,
    studentId: normalized.studentId,
    accountUid: normalized.accountUid || null,
    status: normalized.status,
    availablePoints: normalized.availablePoints,
    pendingPoints: normalized.pendingPoints,
    reservedPoints: normalized.reservedPoints,
    debtPoints: normalized.debtPoints,
    lifetimeEarnedPoints: normalized.lifetimeEarnedPoints,
    lifetimeRedeemedPoints: normalized.lifetimeRedeemedPoints,
    tierQualifyingValue: normalized.tierQualifyingValue,
    tier: normalized.tier,
    revision: normalized.revision,
    updatedAt: FieldValue.serverTimestamp(),
  }
}

function setAccountProjection(transaction, db, accountReference, account) {
  const projection = accountProjection(account)
  transaction.set(accountReference, projection, { merge: true })
  if (account.accountUid) {
    transaction.set(db.doc(`users/${account.accountUid}/loyaltySummary/current`), {
      ...projection,
      accountId: accountReference.id,
    }, { merge: true })
  }
}

async function applySourceTarget({
  db,
  studentId,
  accountUid = '',
  sourceKey,
  sourceType,
  sourceId,
  sourceBranchId = '',
  description,
  targetPoints,
  targetTierCreditVnd = 0,
  desiredState = 'available',
  availableAt = null,
  policyVersion = LOYALTY_POLICY_VERSION,
  metadata = {},
  createdBy = 'system:loyalty',
}) {
  const safeStudentId = documentId(studentId, 'Mã học viên')
  const safeTarget = Math.max(0, integer(targetPoints, 'Điểm mục tiêu', 0, 100_000_000))
  const safeTierTarget = Math.max(0, integer(targetTierCreditVnd, 'Tier Credit mục tiêu', 0, 100_000_000_000))
  const sourceReference = db.doc(`loyaltySourceBalances/${sourceDocumentId(sourceKey)}`)
  const accountReference = db.doc(`loyaltyAccounts/${safeStudentId}`)
  return db.runTransaction(async (transaction) => {
    const [sourceSnapshot, accountSnapshot] = await Promise.all([
      transaction.get(sourceReference),
      transaction.get(accountReference),
    ])
    const previousSource = sourceSnapshot.exists ? sourceSnapshot.data() : {}
    const previousAccount = normalizeAccount(accountSnapshot.exists ? accountSnapshot.data() : defaultAccount({ studentId: safeStudentId, accountUid }), { studentId: safeStudentId, accountUid })
    let account = { ...previousAccount, accountUid: previousAccount.accountUid || accountUid }
    const previousPoints = Math.max(0, Number(previousSource.targetPoints || 0))
    const previousState = previousSource.state || 'reversed'
    // Tier Credit is intentionally independent from redeemable points. During
    // launch backfill we keep targetPoints at zero, but still need an available
    // source so lifetime spend can place the learner in the correct tier.
    const targetState = safeTarget <= 0 && safeTierTarget <= 0
      ? 'reversed'
      : safeTarget > 0 && desiredState === 'pending'
        ? 'pending'
        : 'available'
    let pendingDelta = 0
    let availableDelta = 0
    let reservedDelta = 0
    let debtDelta = 0

    if (previousState === targetState) {
      const delta = safeTarget - previousPoints
      if (targetState === 'pending') {
        pendingDelta = delta
        account.pendingPoints = Math.max(0, account.pendingPoints + delta)
      } else if (targetState === 'available' && delta > 0) {
        const result = applyAvailableEarning(account, delta)
        account = result.account
        availableDelta += result.availableDelta
        debtDelta += result.debtDelta
      } else if (targetState === 'available' && delta < 0) {
        const result = reverseAvailableEarning(account, Math.abs(delta))
        account = result.account
        availableDelta += result.availableDelta
        debtDelta += result.debtDelta
      }
    } else {
      if (previousState === 'pending' && previousPoints > 0) {
        pendingDelta -= previousPoints
        account.pendingPoints = Math.max(0, account.pendingPoints - previousPoints)
      } else if (previousState === 'available' && previousPoints > 0) {
        const result = reverseAvailableEarning(account, previousPoints)
        account = result.account
        availableDelta += result.availableDelta
        debtDelta += result.debtDelta
      }
      if (targetState === 'pending' && safeTarget > 0) {
        pendingDelta += safeTarget
        account.pendingPoints += safeTarget
      } else if (targetState === 'available' && safeTarget > 0) {
        const result = applyAvailableEarning(account, safeTarget)
        account = result.account
        availableDelta += result.availableDelta
        debtDelta += result.debtDelta
      }
    }

    const previousTierCredit = previousState === 'available' ? Math.max(0, Number(previousSource.targetTierCreditVnd || 0)) : 0
    const nextTierCredit = targetState === 'available' ? safeTierTarget : 0
    const tierCreditDelta = nextTierCredit - previousTierCredit
    account.tierQualifyingValue = Math.max(0, Number(account.tierQualifyingValue || 0) + tierCreditDelta)
    account.tier = tierForCredit(account.tierQualifyingValue)
    const changed = pendingDelta !== 0 || availableDelta !== 0 || debtDelta !== 0 || tierCreditDelta !== 0 || previousState !== targetState
    if (!changed) return { changed: false, account: publicAccount(account), sourceId: sourceReference.id }

    const revision = Number(previousSource.revision || 0) + 1
    account.revision = Number(previousAccount.revision || 0) + 1
    setAccountProjection(transaction, db, accountReference, account)
    transaction.set(sourceReference, {
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      studentId: safeStudentId,
      accountUid: account.accountUid || null,
      sourceKey,
      sourceType,
      sourceId,
      sourceBranchId: sourceBranchId || null,
      targetPoints: safeTarget,
      targetTierCreditVnd: safeTierTarget,
      state: targetState,
      availableAt: availableAt || null,
      policyVersion,
      revision,
      ...metadata,
      createdAt: previousSource.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    const ledgerReference = db.doc(`loyaltyLedgerEntries/${sourceReference.id}_${revision}`)
    transaction.create(ledgerReference, {
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      studentId: safeStudentId,
      accountUid: account.accountUid || null,
      sourceBranchId: sourceBranchId || null,
      kind: targetState === 'reversed' || pendingDelta < 0 || availableDelta < 0 || debtDelta > 0 ? 'reverse' : targetState === 'pending' ? 'earn' : previousState === 'pending' ? 'vest' : 'earn',
      sourceType,
      sourceId,
      sourceKey,
      pendingDelta,
      availableDelta,
      reservedDelta,
      debtDelta,
      tierCreditDelta,
      policyVersion,
      description,
      availableAt: availableAt || null,
      effectiveAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      createdBy,
    })
    return { changed: true, account: publicAccount(account), sourceId: sourceReference.id, ledgerEntryId: ledgerReference.id }
  })
}

async function reconcileContractSpend({ db, contractId, logger = console, now = new Date(), awardPoints = null }) {
  if (!contractId) return { changed: 0, skipped: 'missing_contract' }
  const [contractSnapshot, ledgerSnapshot] = await Promise.all([
    db.doc(`contracts/${contractId}`).get(),
    db.collection('ledgerEntries').where('contractId', '==', contractId).limit(MAX_RECONCILE_DOCUMENTS).get(),
  ])
  if (!contractSnapshot.exists) return { changed: 0, skipped: 'missing_contract' }
  const contract = contractSnapshot.data()
  const studentId = contract.studentId || ''
  if (!studentId) return { changed: 0, skipped: 'missing_student' }
  const [studentSnapshot, policy, accountSnapshot, settingsSnapshot] = await Promise.all([
    db.doc(`students/${studentId}`).get(),
    currentPolicy(db),
    db.doc(`loyaltyAccounts/${studentId}`).get(),
    db.doc('loyaltySettings/current').get(),
  ])
  const accountUid = studentSnapshot.exists ? studentSnapshot.data().accountUid || '' : ''
  const account = normalizeAccount(accountSnapshot.exists ? accountSnapshot.data() : defaultAccount({ studentId, accountUid }), { studentId, accountUid })
  const launchDate = settingsSnapshot.exists ? storedDateKey(settingsSnapshot.data().launchDate) : ''
  const payments = ledgerSnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.type === 'payment' && item.status === 'posted' && Number(item.cashImpact ?? item.amount) > 0)
    .sort((a, b) => timestampMillis(a.effectiveAt || a.createdAt) - timestampMillis(b.effectiveAt || b.createdAt) || a.id.localeCompare(b.id))
    .map((item) => ({ ...item, originalCashVnd: Number(item.cashImpact ?? item.amount), remainingCashVnd: Number(item.cashImpact ?? item.amount) }))
  const reversedIds = new Set(ledgerSnapshot.docs
    .map((item) => item.data())
    .filter((item) => item.type === 'reversal' && item.status === 'posted' && item.reversedEntryId)
    .map((item) => item.reversedEntryId))
  payments.forEach((item) => {
    if (reversedIds.has(item.id)) item.remainingCashVnd = 0
  })
  let unallocatedRefundVnd = ledgerSnapshot.docs
    .map((item) => item.data())
    .filter((item) => item.type === 'refund' && item.status === 'posted')
    .reduce((total, item) => total + Math.abs(Math.min(0, Number(item.cashImpact ?? item.amount) || 0)), 0)
  for (let index = payments.length - 1; index >= 0 && unallocatedRefundVnd > 0; index -= 1) {
    const allocated = Math.min(payments[index].remainingCashVnd, unallocatedRefundVnd)
    payments[index].remainingCashVnd -= allocated
    unallocatedRefundVnd -= allocated
  }
  if (unallocatedRefundVnd > 0) {
    await db.doc(`loyaltyReconciliationIssues/refund_${contractId}`).set({
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      type: 'unallocated_refund',
      contractId,
      remainingAmountVnd: unallocatedRefundVnd,
      status: 'open',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }
  const pointsEnabled = awardPoints === null ? policy.earnEnabled === true : awardPoints === true
  const paymentSources = await Promise.all(payments.map(async (payment) => {
    const sourceKey = `contract_payment:${payment.id}`
    const reference = db.doc(`loyaltySourceBalances/${sourceDocumentId(sourceKey)}`)
    const snapshot = await reference.get()
    return { sourceKey, reference, value: snapshot.exists ? snapshot.data() : {} }
  }))
  // Remove this contract's already-projected credit before replaying its
  // payments. Otherwise every retry would temporarily count the same contract
  // twice and could snapshot an inflated tier for a newly added installment.
  const existingContractTierCredit = paymentSources.reduce((total, item) => total + Math.max(0, Number(item.value.targetTierCreditVnd || 0)), 0)
  let changed = 0
  let projectedTierCredit = Math.max(0, Number(account.tierQualifyingValue || 0) - existingContractTierCredit)
  let tierAtSource = tierForCredit(projectedTierCredit, policy.tierThresholds)
  let sourceContract = null
  const sourceContractId = contract.sourceContractId || contract.previousContractId || ''
  if (sourceContractId) {
    const snapshot = await db.doc(`contracts/${sourceContractId}`).get()
    if (snapshot.exists) sourceContract = snapshot.data()
  }
  for (let paymentIndex = 0; paymentIndex < payments.length; paymentIndex += 1) {
    const payment = payments[paymentIndex]
    const { sourceKey, value: sourceValue } = paymentSources[paymentIndex]
    const snapshotTier = sourceValue.tierAtSource || tierAtSource
    const paidAt = occurrenceDateKey(payment.effectiveAt || payment.createdAt)
    const renewalBonus = Number.isFinite(Number(sourceValue.renewalBonus))
      ? Number(sourceValue.renewalBonus)
      : renewalBonusRate({
        paymentDate: paidAt,
        sourceContractEndDate: sourceContract?.endDate,
        isRenewal: Boolean(sourceContractId || contract.renewalCaseId || contract.renewalType),
      })
    const targetPoints = calculateSpendPoints({ eligibleCashVnd: payment.remainingCashVnd, tier: snapshotTier, renewalBonus, policy })
    const effectiveMillis = timestampMillis(payment.effectiveAt || payment.createdAt) || now.getTime()
    const availableMillis = effectiveMillis + Number(policy.paymentHoldDays || 14) * 86_400_000
    const desiredState = pointsEnabled && availableMillis <= now.getTime() ? 'available' : 'pending'
    const result = await applySourceTarget({
      db,
      studentId,
      accountUid,
      sourceKey,
      sourceType: 'contract_payment',
      sourceId: payment.id,
      sourceBranchId: payment.branchId || contract.branchId || '',
      description: sourceContractId ? 'Điểm thanh toán gia hạn' : 'Điểm thanh toán hợp đồng',
      targetPoints: pointsEnabled && occursOnOrAfterLaunch(paidAt, launchDate) ? targetPoints : 0,
      targetTierCreditVnd: payment.remainingCashVnd,
      desiredState,
      availableAt: Timestamp.fromMillis(availableMillis),
      policyVersion: policy.version,
      metadata: {
        contractId,
        originalCashVnd: payment.originalCashVnd,
        eligibleCashVnd: payment.remainingCashVnd,
        tierAtSource: snapshotTier,
        renewalBonus,
        launchDate: launchDate || null,
      },
    })
    if (result.changed) changed += 1
    projectedTierCredit += payment.remainingCashVnd
    tierAtSource = tierForCredit(projectedTierCredit, policy.tierThresholds)
  }
  logger.info?.('Aura Club contract spend reconciled', { contractId, studentId, paymentCount: payments.length, changed })
  return { contractId, studentId, paymentCount: payments.length, changed }
}

function attendanceEarnsPoints(value = {}) {
  return ['present', 'late'].includes(value.attendanceStatus)
    && value.billingStatus === 'charged'
    && value.recognitionReviewRequired !== true
    && value.confirmationSource !== 'auto_after_48h'
}

async function reconcileAttendance({ db, attendanceId, value, logger = console }) {
  const sessionId = value?.sessionId || attendanceId
  const sessionSnapshot = await db.doc(`sessions/${sessionId}`).get()
  const session = sessionSnapshot.exists ? sessionSnapshot.data() : {}
  const studentId = value?.studentId || session.studentId || ''
  if (!studentId) return { changed: false, skipped: 'missing_student' }
  const [studentSnapshot, policy, settingsSnapshot] = await Promise.all([
    db.doc(`students/${studentId}`).get(),
    currentPolicy(db),
    db.doc('loyaltySettings/current').get(),
  ])
  const attendanceOccurrence = value?.scheduledAt || value?.occurredAt || session.date || value?.confirmedAt
  const attendanceDate = occurrenceDateKey(attendanceOccurrence)
  const launchDate = settingsSnapshot.exists ? storedDateKey(settingsSnapshot.data().launchDate) : ''
  const eligible = policy.earnEnabled === true
    && occursOnOrAfterLaunch(attendanceOccurrence, launchDate)
    && attendanceEarnsPoints(value)
  const result = await applySourceTarget({
    db,
    studentId,
    accountUid: studentSnapshot.exists ? studentSnapshot.data().accountUid || '' : '',
    sourceKey: `attendance:${attendanceId}`,
    sourceType: 'attendance',
    sourceId: attendanceId,
    sourceBranchId: value?.branchId || session.branchId || '',
    description: eligible ? 'Hoàn thành buổi tập' : 'Điều chỉnh điểm buổi tập',
    targetPoints: eligible ? Number(policy.attendance.completedPoints || 2) : 0,
    desiredState: 'available',
    policyVersion: policy.version,
    metadata: { sessionId, attendanceStatus: value?.attendanceStatus || 'pending', occurrenceDate: attendanceDate || null, monthId: attendanceDate.slice(0, 7) || null, launchDate: launchDate || null },
  })
  logger.info?.('Aura Club attendance reconciled', { attendanceId, studentId, eligible, changed: result.changed })
  return result
}

async function reconcileAttendanceMissions({ db, attendanceId, value, logger = console }) {
  const sessionId = value?.sessionId || attendanceId
  const sessionSnapshot = await db.doc(`sessions/${sessionId}`).get()
  const session = sessionSnapshot.exists ? sessionSnapshot.data() : {}
  const studentId = value?.studentId || session.studentId || ''
  if (!studentId) return { changed: false, skipped: 'missing_student' }
  const occurrence = value?.scheduledAt || value?.occurredAt || session.date || value?.confirmedAt
  const occurrenceDate = occurrenceDateKey(occurrence)
  if (!occurrenceDate) return { changed: false, skipped: 'missing_occurrence_date' }
  const weekId = mondayDateKey(occurrenceDate)
  const weekEnd = addDateDays(weekId, 6)
  const monthId = occurrenceDate.slice(0, 7)
  const streakWeekIds = Array.from({ length: 12 }, (_, index) => addDateDays(weekId, index * -7))
  const [studentSnapshot, attendanceSnapshot, availabilitySnapshots, policy, settingsSnapshot] = await Promise.all([
    db.doc(`students/${studentId}`).get(),
    db.collection('attendanceEvents').where('studentId', '==', studentId).limit(1000).get(),
    db.getAll(...streakWeekIds.map((streakWeekId) => db.doc(`ptAvailability/${studentId}_${streakWeekId}`))),
    currentPolicy(db),
    db.doc('loyaltySettings/current').get(),
  ])
  const launchDate = settingsSnapshot.exists ? storedDateKey(settingsSnapshot.data().launchDate) : ''
  if (!occursOnOrAfterLaunch(occurrenceDate, launchDate)) {
    return { changed: false, skipped: launchDate ? 'before_launch' : 'missing_launch_date' }
  }
  const student = studentSnapshot.exists ? studentSnapshot.data() : {}
  const rowDate = (item) => {
    const raw = item.scheduledAt || item.occurredAt || item.confirmedAt || item.createdAt
    return occurrenceDateKey(raw)
  }
  const rows = attendanceSnapshot.docs
    .map((item) => item.data())
    .filter((item) => attendanceEarnsPoints(item) && occursOnOrAfterLaunch(rowDate(item), launchDate))
  const weeklyCompleted = rows.filter((item) => {
    const key = rowDate(item)
    return key >= weekId && key <= weekEnd
  }).length
  const monthlyCompleted = rows.filter((item) => rowDate(item).slice(0, 7) === monthId).length
  const availabilityByWeek = new Map(availabilitySnapshots.map((item) => [item.id.slice(`${studentId}_`.length), item.exists ? item.data() : {}]))
  const targetForWeek = (targetWeekId) => Math.max(1, Math.min(7, Number(availabilityByWeek.get(targetWeekId)?.requiredSessions || student.sessionsPerWeek || 1)))
  const weeklyTarget = targetForWeek(weekId)
  const streakWeeks = consecutiveCompletedWeeks(streakWeekIds.map((streakWeekId) => ({
    completed: rows.filter((item) => {
      const key = rowDate(item)
      return key >= streakWeekId && key <= addDateDays(streakWeekId, 6)
    }).length,
    target: targetForWeek(streakWeekId),
  })))
  const streakRewardPoints = streakWeeks === 12
    ? Number(policy.attendance.twelveWeekStreakPoints || 200)
    : streakWeeks === 8
      ? Number(policy.attendance.eightWeekStreakPoints || 100)
      : streakWeeks === 4
        ? Number(policy.attendance.fourWeekStreakPoints || 30)
        : 0
  const nextStreakTarget = streakWeeks < 4 ? 4 : streakWeeks < 8 ? 8 : 12
  const accountUid = student.accountUid || ''
  const branchId = session.branchId || student.branchId || ''
  const earnEnabled = policy.earnEnabled === true
  const [weeklyResult, monthlyResult, streakResult] = await Promise.all([
    applySourceTarget({
      db,
      studentId,
      accountUid,
      sourceKey: `attendance_week:${studentId}:${weekId}`,
      sourceType: 'attendance_mission',
      sourceId: weekId,
      sourceBranchId: branchId,
      description: weeklyCompleted >= weeklyTarget ? 'Hoàn thành mục tiêu tập tuần' : 'Đối soát mục tiêu tập tuần',
      targetPoints: earnEnabled && weeklyCompleted >= weeklyTarget ? Number(policy.attendance.weeklyTargetPoints || 5) : 0,
      desiredState: 'available',
      policyVersion: policy.version,
      metadata: { weekId, monthId, progress: weeklyCompleted, target: weeklyTarget, launchDate },
    }),
    applySourceTarget({
      db,
      studentId,
      accountUid,
      sourceKey: `attendance_month:${studentId}:${monthId}`,
      sourceType: 'attendance_mission',
      sourceId: monthId,
      sourceBranchId: branchId,
      description: monthlyCompleted >= 12 ? 'Hoàn thành 12 buổi trong tháng' : 'Đối soát mục tiêu tập tháng',
      targetPoints: earnEnabled && monthlyCompleted >= 12 ? Number(policy.attendance.twelveSessionsMonthlyPoints || 30) : 0,
      desiredState: 'available',
      policyVersion: policy.version,
      metadata: { monthId, progress: monthlyCompleted, target: 12, launchDate },
    }),
    applySourceTarget({
      db,
      studentId,
      accountUid,
      sourceKey: `attendance_streak:${studentId}:${weekId}`,
      sourceType: 'attendance_streak',
      sourceId: weekId,
      sourceBranchId: branchId,
      description: streakRewardPoints ? `Duy trì đủ lịch ${streakWeeks} tuần liên tiếp` : 'Đối soát chuỗi tập luyện',
      targetPoints: earnEnabled ? streakRewardPoints : 0,
      desiredState: 'available',
      policyVersion: policy.version,
      metadata: { weekId, monthId, streakWeeks, milestone: streakRewardPoints ? streakWeeks : null, launchDate },
    }),
  ])
  await Promise.all([
    db.doc(`loyaltyMissionProgress/${studentId}_attendance_week_${weekId}`).set({
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      studentId,
      accountUid: accountUid || null,
      type: 'attendance_week',
      title: 'Tập đủ lịch tuần',
      description: `Hoàn thành ${weeklyTarget} buổi theo mục tiêu tuần`,
      weekId,
      progress: weeklyCompleted,
      target: weeklyTarget,
      rewardPoints: Number(policy.attendance.weeklyTargetPoints || 5),
      status: weeklyCompleted >= weeklyTarget ? 'completed' : 'active',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    db.doc(`loyaltyMissionProgress/${studentId}_attendance_month_${monthId}`).set({
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      studentId,
      accountUid: accountUid || null,
      type: 'attendance_month',
      title: 'Duy trì 12 buổi trong tháng',
      description: 'Tập đều và được PT xác nhận',
      monthId,
      progress: monthlyCompleted,
      target: 12,
      rewardPoints: Number(policy.attendance.twelveSessionsMonthlyPoints || 30),
      status: monthlyCompleted >= 12 ? 'completed' : 'active',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    db.doc(`loyaltyMissionProgress/${studentId}_attendance_streak_${weekId}`).set({
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      studentId,
      accountUid: accountUid || null,
      type: 'attendance_streak',
      title: 'Chuỗi tập luyện Aura',
      description: streakWeeks >= 12 ? 'Bạn đã hoàn thành chuỗi 12 tuần' : `Mốc tiếp theo: ${nextStreakTarget} tuần liên tiếp`,
      weekId,
      progress: streakWeeks,
      target: nextStreakTarget,
      rewardPoints: streakWeeks < 4
        ? Number(policy.attendance.fourWeekStreakPoints || 30)
        : streakWeeks < 8
          ? Number(policy.attendance.eightWeekStreakPoints || 100)
          : Number(policy.attendance.twelveWeekStreakPoints || 200),
      status: streakWeeks >= 12 ? 'completed' : 'active',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ])
  if (accountUid) await reconcileNutritionReview({ db, reviewId: `attendance-cap-${attendanceId}`, afterValue: { userId: accountUid, createdAt: occurrenceDate }, logger })
  logger.info?.('Aura Club attendance missions reconciled', { studentId, weekId, weeklyCompleted, weeklyTarget, monthId, monthlyCompleted, streakWeeks })
  return { changed: weeklyResult.changed || monthlyResult.changed || streakResult.changed, weeklyCompleted, weeklyTarget, monthlyCompleted, streakWeeks }
}

function nutritionReviewOccurrence(value = {}) {
  const meal = value.meal && typeof value.meal === 'object' ? value.meal : {}
  const explicitMealDate = [meal.mealDate, meal.date].find((item) => (
    item && (typeof item !== 'string' || /^\d{4}-\d{2}-\d{2}/.test(item))
  ))
  return occurrenceDateKey(explicitMealDate || value.createdAt || value.reviewedAt)
}

function nutritionDailySummaries(reviews = []) {
  const days = new Map()
  const positive = (...values) => {
    for (const value of values) {
      const number = Number(value)
      if (Number.isFinite(number) && number > 0) return number
    }
    return 0
  }
  for (const review of reviews) {
    const date = nutritionReviewOccurrence(review)
    if (!date) continue
    const meal = review.meal && typeof review.meal === 'object' ? review.meal : {}
    const totals = meal.totals && typeof meal.totals === 'object' ? meal.totals : {}
    const current = days.get(date) || { date, meals: 0, calories: 0, protein: 0, calorieTarget: 0, proteinTarget: 0 }
    current.meals += 1
    current.calories += positive(meal.calories, meal.totalKcal, totals.calories, review.totalKcal)
    current.protein += positive(meal.protein, meal.totalProtein, totals.protein, review.totalProtein)
    current.calorieTarget = current.calorieTarget || positive(review.targetKcal, meal.targetKcal)
    current.proteinTarget = current.proteinTarget || positive(review.targetProtein, meal.targetProtein)
    days.set(date, current)
  }
  return [...days.values()].sort((left, right) => left.date.localeCompare(right.date)).map((day) => ({
    ...day,
    completeDay: day.meals >= 3,
    calorieMet: day.calorieTarget > 0 && day.calories >= day.calorieTarget * 0.9 && day.calories <= day.calorieTarget * 1.1,
    proteinMet: day.proteinTarget > 0 && day.protein >= day.proteinTarget,
    planMet: day.meals >= 3
      && day.calorieTarget > 0
      && day.calories >= day.calorieTarget * 0.9
      && day.calories <= day.calorieTarget * 1.1
      && day.proteinTarget > 0
      && day.protein >= day.proteinTarget,
  }))
}

async function reconcileNutritionReview({ db, reviewId, beforeValue = {}, afterValue = {}, logger = console }) {
  const value = Object.keys(afterValue || {}).length ? afterValue : beforeValue
  const accountUid = String(value.userId || '').trim()
  if (!accountUid) return { changed: false, skipped: 'missing_account_uid' }
  let student
  try {
    student = await findStudentForUid(db, accountUid)
  } catch (error) {
    await db.doc(`loyaltyReconciliationIssues/nutrition_${sourceDocumentId(accountUid)}`).set({
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      type: 'nutrition_missing_student_link',
      accountUid,
      reviewId,
      status: 'open',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { changed: false, skipped: 'missing_student_link' }
  }
  const reviewDate = nutritionReviewOccurrence(value)
  if (!reviewDate) return { changed: false, skipped: 'missing_review_date' }
  const monthId = reviewDate.slice(0, 7)
  const [reviewsSnapshot, behaviorSourcesSnapshot, policy, settingsSnapshot] = await Promise.all([
    db.collection('mealReviews').where('userId', '==', accountUid).limit(1000).get(),
    db.collection('loyaltySourceBalances').where('studentId', '==', student.id).limit(1000).get(),
    currentPolicy(db),
    db.doc('loyaltySettings/current').get(),
  ])
  const launchDate = settingsSnapshot.exists ? storedDateKey(settingsSnapshot.data().launchDate) : ''
  const approvedAll = reviewsSnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.status === 'approved' && occursOnOrAfterLaunch(nutritionReviewOccurrence(item), launchDate))
    .sort((left, right) => nutritionReviewOccurrence(left).localeCompare(nutritionReviewOccurrence(right)) || left.id.localeCompare(right.id))
  const approved = approvedAll.filter((item) => nutritionReviewOccurrence(item).slice(0, 7) === monthId)
  const daily = nutritionDailySummaries(approvedAll)
  const dailyThisMonth = daily.filter((item) => item.date.slice(0, 7) === monthId)
  const candidates = []
  const addCandidate = ({ sourceKey, sourceId, description, points, occurrenceDate, metadata = {} }) => {
    const candidateMonth = occurrenceDate.slice(0, 7)
    if (candidateMonth !== monthId || points <= 0) return
    candidates.push({ sourceKey, sourceId, description, points, occurrenceDate, monthId: candidateMonth, metadata })
  }

  const perMeal = Math.max(0, Number(policy.nutrition.verifiedMealPoints || 1))
  approved.forEach((review) => addCandidate({
    sourceKey: `nutrition_review:${review.id}`,
    sourceId: review.id,
    description: 'Bữa ăn đã được Coach xác nhận',
    points: perMeal,
    occurrenceDate: nutritionReviewOccurrence(review),
    metadata: { rewardKind: 'verified_meal' },
  }))
  dailyThisMonth.forEach((day) => {
    if (day.completeDay) addCandidate({ sourceKey: `nutrition_complete_day:${student.id}:${day.date}`, sourceId: day.date, description: 'Hoàn thành đủ ba bữa được xác nhận', points: Number(policy.nutrition.completeDayPoints || 2), occurrenceDate: day.date, metadata: { rewardKind: 'complete_day' } })
    if (day.proteinMet) addCandidate({ sourceKey: `nutrition_protein:${student.id}:${day.date}`, sourceId: day.date, description: 'Đạt mục tiêu protein trong ngày', points: Number(policy.nutrition.proteinTargetPoints || 3), occurrenceDate: day.date, metadata: { rewardKind: 'protein_target' } })
    if (day.calorieMet) addCandidate({ sourceKey: `nutrition_calorie:${student.id}:${day.date}`, sourceId: day.date, description: 'Năng lượng trong vùng mục tiêu ±10%', points: Number(policy.nutrition.calorieTargetPoints || 3), occurrenceDate: day.date, metadata: { rewardKind: 'calorie_target' } })
  })

  const complianceByWeek = new Map()
  daily.filter((day) => day.planMet).forEach((day) => {
    const weekId = mondayDateKey(day.date)
    const dates = complianceByWeek.get(weekId) || []
    dates.push(day.date)
    complianceByWeek.set(weekId, dates)
  })
  const qualifiedWeeks = [...complianceByWeek.entries()]
    .filter(([, dates]) => dates.length >= 5)
    .map(([weekId, dates]) => ({ weekId, awardDate: [...dates].sort()[4] }))
    .sort((left, right) => left.weekId.localeCompare(right.weekId))
  qualifiedWeeks.forEach((item) => addCandidate({
    sourceKey: `nutrition_compliance_week:${student.id}:${item.weekId}`,
    sourceId: item.weekId,
    description: 'Theo đúng kế hoạch dinh dưỡng ít nhất năm ngày',
    points: Number(policy.nutrition.fiveDayCompliancePoints || 15),
    occurrenceDate: item.awardDate,
    metadata: { rewardKind: 'five_day_compliance', weekId: item.weekId },
  }))
  let nutritionStreakWeeks = 0
  let previousWeek = ''
  qualifiedWeeks.forEach((item) => {
    nutritionStreakWeeks = previousWeek && addDateDays(previousWeek, 7) === item.weekId ? nutritionStreakWeeks + 1 : 1
    if (nutritionStreakWeeks === 4) addCandidate({
      sourceKey: `nutrition_streak:${student.id}:${item.weekId}`,
      sourceId: item.weekId,
      description: 'Duy trì dinh dưỡng đúng kế hoạch bốn tuần',
      points: Number(policy.nutrition.fourWeekStreakPoints || 50),
      occurrenceDate: item.awardDate,
      metadata: { rewardKind: 'four_week_streak', weekId: item.weekId },
    })
    previousWeek = item.weekId
  })
  const currentWeekId = mondayDateKey(reviewDate)
  const currentQualifiedWeekIndex = qualifiedWeeks.findIndex((item) => item.weekId === currentWeekId)
  let currentNutritionStreak = 0
  if (currentQualifiedWeekIndex >= 0) {
    currentNutritionStreak = 1
    for (let index = currentQualifiedWeekIndex - 1; index >= 0; index -= 1) {
      if (addDateDays(qualifiedWeeks[index].weekId, 7) !== qualifiedWeeks[index + 1].weekId) break
      currentNutritionStreak += 1
    }
  }

  const sourceValues = behaviorSourcesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
  const nonNutritionBehaviorPoints = sourceValues
    .filter((item) => ['attendance', 'attendance_mission', 'attendance_streak'].includes(item.sourceType) && item.state === 'available' && (item.monthId === monthId || String(item.occurrenceDate || item.sourceId || '').slice(0, 7) === monthId))
    .reduce((total, item) => total + Math.max(0, Number(item.targetPoints || 0)), 0)
  const behaviorAllowance = Math.max(0, Number(policy.recurringBehaviorMonthlyCap || 250) - nonNutritionBehaviorPoints)
  let remainingCap = Math.min(Math.max(0, Number(policy.nutritionMonthlyCap || 150)), behaviorAllowance)
  const enabled = policy.earnEnabled === true && policy.nutritionEnabled === true && Boolean(launchDate)
  const desired = new Map()
  candidates.sort((left, right) => left.occurrenceDate.localeCompare(right.occurrenceDate) || left.sourceKey.localeCompare(right.sourceKey)).forEach((candidate) => {
    const targetPoints = enabled ? Math.min(Math.max(0, Math.floor(candidate.points)), remainingCap) : 0
    remainingCap = Math.max(0, remainingCap - targetPoints)
    desired.set(candidate.sourceKey, { ...candidate, targetPoints })
  })
  const existingMonthSources = sourceValues.filter((item) => item.sourceType === 'nutrition' && item.monthId === monthId && typeof item.sourceKey === 'string')
  const keys = new Set([...desired.keys(), ...existingMonthSources.map((item) => item.sourceKey)])
  let changed = false
  for (const sourceKey of keys) {
    const target = desired.get(sourceKey)
    const previous = existingMonthSources.find((item) => item.sourceKey === sourceKey) || {}
    const result = await applySourceTarget({
      db,
      studentId: student.id,
      accountUid,
      sourceKey,
      sourceType: 'nutrition',
      sourceId: target?.sourceId || previous.sourceId || reviewId,
      sourceBranchId: student.branchId || '',
      description: target?.description || 'Đối soát điểm dinh dưỡng',
      targetPoints: target?.targetPoints || 0,
      desiredState: 'available',
      policyVersion: policy.version,
      metadata: {
        monthId,
        occurrenceDate: target?.occurrenceDate || previous.occurrenceDate || null,
        launchDate: launchDate || null,
        ...(target?.metadata || {}),
      },
    })
    changed = changed || result.changed
  }
  const earnedThisMonth = [...desired.values()].reduce((total, item) => total + Number(item.targetPoints || 0), 0)
  const compliantDays = dailyThisMonth.filter((item) => item.planMet).length
  await Promise.all([
    db.doc(`loyaltyMissionProgress/${student.id}_nutrition_month_${monthId}`).set({
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      studentId: student.id,
      accountUid,
      type: 'nutrition_month',
      title: 'Tuân thủ dinh dưỡng',
      description: `${approved.length} bữa được Coach duyệt · ${compliantDays} ngày đúng kế hoạch`,
      monthId,
      progress: compliantDays,
      target: 20,
      rewardPoints: earnedThisMonth,
      status: compliantDays >= 20 ? 'completed' : 'active',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    db.doc(`loyaltyMissionProgress/${student.id}_nutrition_streak_${currentWeekId}`).set({
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      studentId: student.id,
      accountUid,
      type: 'nutrition_streak',
      title: 'Chuỗi dinh dưỡng Aura',
      description: 'Đạt kế hoạch ít nhất năm ngày mỗi tuần',
      weekId: currentWeekId,
      monthId,
      progress: currentNutritionStreak,
      target: 4,
      rewardPoints: Number(policy.nutrition.fourWeekStreakPoints || 50),
      status: currentNutritionStreak >= 4 ? 'completed' : 'active',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ])
  logger.info?.('Aura Club nutrition reconciled', { studentId: student.id, monthId, approved: approved.length, compliantDays, earnedThisMonth, changed })
  return { changed, approved: approved.length, compliantDays, earnedThisMonth, monthId }
}

async function vestPendingSources({ db, logger = console, now = new Date(), limit = 200 }) {
  const policy = await currentPolicy(db)
  if (policy.earnEnabled !== true) return { scanned: 0, due: 0, vested: 0, failed: 0, paused: true }
  const snapshot = await db.collection('loyaltySourceBalances').where('state', '==', 'pending').limit(Math.min(500, Math.max(1, limit))).get()
  const sourceEnabled = (source) => {
    if (source.sourceType === 'member_referral' || source.sourceType === 'member_referral_welcome') return policy.referralEnabled === true
    if (source.sourceType === 'nutrition') return policy.nutritionEnabled === true
    return true
  }
  const due = snapshot.docs.filter((item) => sourceEnabled(item.data()) && timestampMillis(item.data().availableAt) <= now.getTime())
  let vested = 0
  let failed = 0
  for (const item of due) {
    const source = item.data()
    try {
      const result = await applySourceTarget({
        db,
        studentId: source.studentId,
        accountUid: source.accountUid || '',
        sourceKey: source.sourceKey,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceBranchId: source.sourceBranchId || '',
        description: `Xác nhận ${source.description || 'Điểm Aura'}`,
        targetPoints: Number(source.targetPoints || 0),
        targetTierCreditVnd: Number(source.targetTierCreditVnd || 0),
        desiredState: 'available',
        availableAt: source.availableAt || null,
        policyVersion: source.policyVersion || LOYALTY_POLICY_VERSION,
        metadata: {
          contractId: source.contractId || null,
          originalCashVnd: source.originalCashVnd || null,
          eligibleCashVnd: source.eligibleCashVnd || null,
          tierAtSource: source.tierAtSource || 'member',
          renewalBonus: Number(source.renewalBonus || 0),
        },
      })
      if (result.changed) vested += 1
    } catch (error) {
      failed += 1
      logger.warn?.('Aura Club vest failed', { sourceId: item.id, code: error?.code || 'unknown' })
    }
  }
  return { scanned: snapshot.size, due: due.length, vested, failed }
}

function contractValueVnd(contract = {}) {
  const direct = Number(contract.finalPrice ?? contract.contractValue ?? 0)
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct)
  return Math.max(0, Math.round(Number(contract.totalPrice || 0) - Number(contract.discount || 0)))
}

function referralLedgerRows(snapshot) {
  return snapshot.docs.map((item) => {
    const value = item.data()
    return {
      id: item.id,
      ...value,
      effectiveAtMillis: timestampMillis(value.effectiveAt || value.createdAt),
    }
  })
}

async function applyAmbassadorCommissionTarget({
  db,
  referrerStudentId,
  referralId,
  referralQuarterId,
  netCollectedVnd,
  eligible,
  desiredState = 'available',
  branchId = '',
  createdBy = 'system:loyalty',
}) {
  const sourceReference = db.doc(`ambassadorCommissionSources/${referralId}`)
  const profileReference = db.doc(`ambassadorProfiles/${referrerStudentId}`)
  const counterReference = db.doc(`ambassadorQuarterCounters/${referrerStudentId}_${referralQuarterId}`)
  return db.runTransaction(async (transaction) => {
    const [sourceSnapshot, profileSnapshot, counterSnapshot] = await Promise.all([
      transaction.get(sourceReference),
      transaction.get(profileReference),
      transaction.get(counterReference),
    ])
    const previous = sourceSnapshot.exists ? sourceSnapshot.data() : {}
    const profile = profileSnapshot.exists ? profileSnapshot.data() : {}
    const mayCreate = profile.status === 'approved'
    let qualifiedSequence = Math.max(0, Number(previous.qualifiedSequence || 0))
    if (!qualifiedSequence && eligible && mayCreate) {
      qualifiedSequence = Math.max(0, Number(counterSnapshot.exists ? counterSnapshot.data().count || 0 : 0)) + 1
      transaction.set(counterReference, {
        schemaVersion: LOYALTY_SCHEMA_VERSION,
        studentId: referrerStudentId,
        quarterId: referralQuarterId,
        count: qualifiedSequence,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    const commission = calculateAmbassadorCommission(netCollectedVnd, qualifiedSequence)
    const targetAmountVnd = eligible && (qualifiedSequence > 0) && (mayCreate || sourceSnapshot.exists) ? commission.amountVnd : 0
    const targetState = targetAmountVnd > 0 ? (desiredState === 'pending' ? 'pending' : 'available') : 'reversed'
    const previousTargetVnd = Math.max(0, Number(previous.targetAmountVnd || 0))
    const previousState = previous.state || 'reversed'
    if (previousTargetVnd === targetAmountVnd && previousState === targetState && Number(previous.ratePercent || 0) === commission.ratePercent) {
      return { changed: false, amountVnd: targetAmountVnd, ratePercent: commission.ratePercent, qualifiedSequence }
    }

    let pendingCommissionVnd = Math.max(0, Number(profile.pendingCommissionVnd || 0))
    let availableCommissionVnd = Math.max(0, Number(profile.availableCommissionVnd || 0))
    let debtCommissionVnd = Math.max(0, Number(profile.debtCommissionVnd || 0))
    let pendingDeltaVnd = 0
    let availableDeltaVnd = 0
    let debtDeltaVnd = 0
    if (previousState === targetState) {
      const delta = targetAmountVnd - previousTargetVnd
      if (targetState === 'pending') {
        pendingCommissionVnd = Math.max(0, pendingCommissionVnd + delta)
        pendingDeltaVnd = delta
      } else if (targetState === 'available' && delta > 0) {
        const debtPaid = Math.min(debtCommissionVnd, delta)
        debtCommissionVnd -= debtPaid
        availableCommissionVnd += delta - debtPaid
        availableDeltaVnd = delta - debtPaid
        debtDeltaVnd = -debtPaid
      } else if (targetState === 'available' && delta < 0) {
        const reversed = Math.abs(delta)
        const availableTaken = Math.min(availableCommissionVnd, reversed)
        availableCommissionVnd -= availableTaken
        debtCommissionVnd += reversed - availableTaken
        availableDeltaVnd = -availableTaken
        debtDeltaVnd = reversed - availableTaken
      }
    } else {
      if (previousState === 'pending') {
        pendingCommissionVnd = Math.max(0, pendingCommissionVnd - previousTargetVnd)
        pendingDeltaVnd -= previousTargetVnd
      } else if (previousState === 'available') {
        const availableTaken = Math.min(availableCommissionVnd, previousTargetVnd)
        availableCommissionVnd -= availableTaken
        debtCommissionVnd += previousTargetVnd - availableTaken
        availableDeltaVnd -= availableTaken
        debtDeltaVnd += previousTargetVnd - availableTaken
      }
      if (targetState === 'pending') {
        pendingCommissionVnd += targetAmountVnd
        pendingDeltaVnd += targetAmountVnd
      } else if (targetState === 'available') {
        const debtPaid = Math.min(debtCommissionVnd, targetAmountVnd)
        debtCommissionVnd -= debtPaid
        availableCommissionVnd += targetAmountVnd - debtPaid
        availableDeltaVnd += targetAmountVnd - debtPaid
        debtDeltaVnd -= debtPaid
      }
    }
    const revision = Number(previous.revision || 0) + 1
    transaction.set(profileReference, {
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      studentId: referrerStudentId,
      pendingCommissionVnd,
      availableCommissionVnd,
      debtCommissionVnd,
      lifetimeEarnedCommissionVnd: FieldValue.increment(Math.max(0, pendingDeltaVnd + availableDeltaVnd - Math.min(0, debtDeltaVnd))),
      qualifiedReferrals: FieldValue.increment(!previous.qualifiedSequence && qualifiedSequence ? 1 : 0),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    transaction.set(sourceReference, {
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      studentId: referrerStudentId,
      referralId,
      branchId: branchId || null,
      quarterId: referralQuarterId,
      qualifiedSequence,
      ratePercent: commission.ratePercent,
      netCollectedVnd: Math.max(0, Math.round(Number(netCollectedVnd || 0))),
      targetAmountVnd,
      state: targetState,
      revision,
      createdAt: previous.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    transaction.create(db.doc(`ambassadorCommissionLedger/${sourceDocumentId(referralId)}_${revision}`), {
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      studentId: referrerStudentId,
      referralId,
      branchId: branchId || null,
      quarterId: referralQuarterId,
      qualifiedSequence,
      ratePercent: commission.ratePercent,
      targetAmountVnd,
      pendingDeltaVnd,
      availableDeltaVnd,
      debtDeltaVnd,
      kind: pendingDeltaVnd < 0 || availableDeltaVnd < 0 || debtDeltaVnd > 0 ? 'reverse' : previousState === 'pending' && targetState === 'available' ? 'vest' : 'earn',
      createdBy,
      createdAt: FieldValue.serverTimestamp(),
    })
    return { changed: true, amountVnd: targetAmountVnd, ratePercent: commission.ratePercent, qualifiedSequence }
  })
}

async function reconcileMemberReferral({ db, contractId, logger = console, now = new Date() }) {
  if (!contractId) return { changed: false, skipped: 'missing_contract' }
  const contractSnapshot = await db.doc(`contracts/${contractId}`).get()
  if (!contractSnapshot.exists) return { changed: false, skipped: 'missing_contract' }
  const contract = contractSnapshot.data()
  const referredStudentId = String(contract.studentId || '').trim()
  let referralSnapshot = contract.memberReferralId ? await db.doc(`memberReferrals/${contract.memberReferralId}`).get() : null
  let referralValue = referralSnapshot?.exists ? referralSnapshot.data() : {}
  const code = normalizeMemberReferralCode(contract.memberReferralCode || referralValue.memberReferralCode)
  const codeSnapshot = code ? await db.doc(`memberReferralCodes/${code}`).get() : null
  const referrerStudentId = String(codeSnapshot?.exists ? codeSnapshot.data().studentId : contract.memberReferrerStudentId || referralValue.referrerStudentId || '').trim()
  if (!referredStudentId || !referrerStudentId) return { changed: false, skipped: 'missing_referral_link' }

  const referralId = referralSnapshot?.exists ? referralSnapshot.id : contractId
  const referralReference = db.doc(`memberReferrals/${referralId}`)
  const [referredSnapshot, referrerSnapshot, ledgerSnapshot, relatedContracts, policy, ambassadorSnapshot] = await Promise.all([
    db.doc(`students/${referredStudentId}`).get(),
    db.doc(`students/${referrerStudentId}`).get(),
    db.collection('ledgerEntries').where('contractId', '==', contractId).limit(MAX_RECONCILE_DOCUMENTS).get(),
    db.collection('contracts').where('studentId', '==', referredStudentId).limit(100).get(),
    currentPolicy(db),
    db.doc(`ambassadorProfiles/${referrerStudentId}`).get(),
  ])
  if (!referredSnapshot.exists || !referrerSnapshot.exists) return { changed: false, skipped: 'missing_student' }
  const referred = referredSnapshot.data()
  const referrer = referrerSnapshot.data()
  const currentStart = storedDateKey(contract.startDate) || '9999-12-31'
  const isNewCustomer = !relatedContracts.docs.some((item) => {
    if (item.id === contractId) return false
    const value = item.data()
    const status = String(value.status || 'active').toLowerCase()
    const start = storedDateKey(value.startDate) || '0000-00-00'
    return !['draft', 'cancelled', 'canceled', 'archived'].includes(status) && start <= currentStart
  })
  const samePhone = normalizedContact(referred.phone || referred.phoneNumber) && normalizedContact(referred.phone || referred.phoneNumber) === normalizedContact(referrer.phone || referrer.phoneNumber)
  const sameEmail = normalizedContact(referred.email) && normalizedContact(referred.email) === normalizedContact(referrer.email)
  const fraudStatus = referredStudentId === referrerStudentId || samePhone || sameEmail ? 'blocked_self_referral' : 'clear'
  const collection = referralCollectionSummary(referralLedgerRows(ledgerSnapshot), contractValueVnd(contract))
  const holdUntilMillis = collection.thresholdReachedAtMillis
    ? collection.thresholdReachedAtMillis + Number(policy.referralHoldDays || 14) * 86_400_000
    : 0
  const holdElapsed = Boolean(holdUntilMillis && holdUntilMillis <= now.getTime())
  const qualifies = collection.thresholdReached && isNewCustomer && fraudStatus === 'clear'
  const existing = referralSnapshot?.exists ? referralValue : (await referralReference.get()).data() || {}
  const programCanStart = policy.earnEnabled === true && policy.referralEnabled === true
  const rewardActivated = existing.rewardActivated === true || (programCanStart && qualifies && !holdElapsed)
  const rewardMode = existing.rewardMode || (programCanStart && ambassadorSnapshot.exists && ambassadorSnapshot.data().status === 'approved' && policy.ambassadorEnabled === true ? 'ambassador' : 'points')
  const status = fraudStatus !== 'clear'
    ? 'blocked'
    : !isNewCustomer
      ? 'ineligible_existing_customer'
      : !collection.thresholdReached
        ? (existing.rewardActivated ? 'reversed' : 'pending_payment')
        : holdElapsed
          ? 'vested'
          : 'cooling_off'
  const referralQuarter = quarterId(new Date(collection.thresholdReachedAtMillis || timestampMillis(contract.createdAt) || now.getTime()))

  await referralReference.set({
    schemaVersion: LOYALTY_SCHEMA_VERSION,
    contractId,
    memberReferralCode: code || null,
    referrerStudentId,
    referrerAccountUid: referrer.accountUid || codeSnapshot?.data()?.accountUid || null,
    referredStudentId,
    referredAccountUid: referred.accountUid || null,
    referredName: referred.name || referred.displayName || contract.studentName || 'Khách được giới thiệu',
    branchId: contract.branchId || null,
    contractValueVnd: collection.contractValueVnd,
    thresholdVnd: collection.thresholdVnd,
    netCollectedVnd: collection.netCollectedVnd,
    thresholdReachedAt: collection.thresholdReachedAtMillis ? Timestamp.fromMillis(collection.thresholdReachedAtMillis) : null,
    holdUntil: holdUntilMillis ? Timestamp.fromMillis(holdUntilMillis) : null,
    isNewCustomer,
    fraudStatus,
    status,
    rewardMode,
    rewardActivated,
    quarterId: referralQuarter,
    qualifiedAt: holdElapsed && qualifies ? (existing.qualifiedAt || FieldValue.serverTimestamp()) : (existing.qualifiedAt || null),
    createdAt: existing.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  if (contract.memberReferralId !== referralId) {
    await contractSnapshot.ref.set({ memberReferralId: referralId, memberReferralCode: code || null, memberReferrerStudentId: referrerStudentId, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  }

  const targetEligible = rewardActivated && qualifies
  if (rewardMode === 'ambassador') {
    const commission = await applyAmbassadorCommissionTarget({
      db,
      referrerStudentId,
      referralId,
      referralQuarterId: referralQuarter,
      netCollectedVnd: collection.netCollectedVnd,
      eligible: targetEligible,
      desiredState: holdElapsed ? 'available' : 'pending',
      branchId: contract.branchId || '',
    })
    logger.info?.('Aura Club member referral reconciled', { contractId, referralId, rewardMode, status, commissionVnd: commission.amountVnd })
    return { changed: commission.changed, referralId, rewardMode, status }
  }

  const availableAt = holdUntilMillis ? Timestamp.fromMillis(holdUntilMillis) : null
  const desiredState = holdElapsed ? 'available' : 'pending'
  const targetReferrerPoints = targetEligible ? Number(policy.referralRewardPoints || 1_000) : 0
  const targetWelcomePoints = targetEligible ? Number(policy.referredWelcomePoints || 200) : 0
  const [referrerResult, referredResult] = await Promise.all([
    applySourceTarget({
      db,
      studentId: referrerStudentId,
      accountUid: referrer.accountUid || '',
      sourceKey: `member_referral:${referralId}:referrer`,
      sourceType: 'member_referral',
      sourceId: referralId,
      sourceBranchId: contract.branchId || '',
      description: targetEligible ? 'Thưởng giới thiệu học viên mới' : 'Đối soát thưởng giới thiệu',
      targetPoints: targetReferrerPoints,
      desiredState,
      availableAt,
      policyVersion: policy.version,
      metadata: { contractId, referralId },
    }),
    applySourceTarget({
      db,
      studentId: referredStudentId,
      accountUid: referred.accountUid || '',
      sourceKey: `member_referral:${referralId}:welcome`,
      sourceType: 'member_referral_welcome',
      sourceId: referralId,
      sourceBranchId: contract.branchId || '',
      description: targetEligible ? 'Điểm chào mừng từ người giới thiệu' : 'Đối soát điểm chào mừng',
      targetPoints: targetWelcomePoints,
      desiredState,
      availableAt,
      policyVersion: policy.version,
      metadata: { contractId, referralId },
    }),
  ])
  logger.info?.('Aura Club member referral reconciled', { contractId, referralId, rewardMode, status })
  return { changed: referrerResult.changed || referredResult.changed, referralId, rewardMode, status }
}

async function reconcilePendingMemberReferrals({ db, logger = console, now = new Date(), limit = 100 }) {
  const snapshots = await Promise.all(['cooling_off', 'pending_payment', 'qualified'].map((status) => db.collection('memberReferrals').where('status', '==', status).limit(limit).get()))
  const referrals = new Map()
  snapshots.forEach((snapshot) => snapshot.docs.forEach((item) => referrals.set(item.id, item.data())))
  let reconciled = 0
  let failed = 0
  for (const referral of referrals.values()) {
    try {
      await reconcileMemberReferral({ db, contractId: referral.contractId, logger, now })
      reconciled += 1
    } catch (error) {
      failed += 1
      logger.warn?.('Aura Club referral reconciliation failed', { contractId: referral.contractId, code: error?.code || 'unknown' })
    }
  }
  return { scanned: referrals.size, reconciled, failed }
}

async function runLoyaltyBackfillBatch({ db, actorUid, mode = 'dry_run', cursor = '', batchSize = 25, launchDate = dateKey(), logger = console }) {
  const apply = mode === 'apply'
  const safeBatchSize = Math.min(50, Math.max(1, Number(batchSize) || 25))
  let query = db.collection('contracts').orderBy(FieldPath.documentId()).limit(safeBatchSize)
  if (cursor) query = query.startAfter(cursor)
  const snapshot = await query.get()
  const studentIds = [...new Set(snapshot.docs.map((item) => String(item.data().studentId || '')).filter(Boolean))]
  const studentSnapshots = studentIds.length ? await db.getAll(...studentIds.map((id) => db.doc(`students/${id}`))) : []
  const students = new Map(studentSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]))
  const summary = {
    scannedContracts: snapshot.size,
    eligibleTierCreditVnd: 0,
    activeLaunchStudents: 0,
    missingStudentId: 0,
    missingStudentProfile: 0,
    missingAccountUid: 0,
    missingBranchId: 0,
    reconciledContracts: 0,
    launchBonusesStaged: 0,
    failures: 0,
  }
  const activeStudents = new Set()
  const issueRows = []
  for (const item of snapshot.docs) {
    const contract = item.data()
    const studentId = String(contract.studentId || '').trim()
    if (!studentId) {
      summary.missingStudentId += 1
      issueRows.push({ type: 'backfill_missing_student_id', contractId: item.id })
      continue
    }
    const student = students.get(studentId)
    if (!student) {
      summary.missingStudentProfile += 1
      issueRows.push({ type: 'backfill_missing_student_profile', contractId: item.id, studentId })
      continue
    }
    if (!student.accountUid) {
      summary.missingAccountUid += 1
      issueRows.push({ type: 'backfill_missing_account_uid', contractId: item.id, studentId })
    }
    if (!contract.branchId) {
      summary.missingBranchId += 1
      issueRows.push({ type: 'backfill_missing_branch', contractId: item.id, studentId })
    }
    const ledger = await db.collection('ledgerEntries').where('contractId', '==', item.id).limit(MAX_RECONCILE_DOCUMENTS).get()
    const collection = referralCollectionSummary(referralLedgerRows(ledger), contractValueVnd(contract))
    summary.eligibleTierCreditVnd += collection.netCollectedVnd
    if (contractActiveOn(contract, launchDate)) activeStudents.add(studentId)
    if (apply) {
      try {
        await reconcileContractSpend({ db, contractId: item.id, logger, awardPoints: false })
        summary.reconciledContracts += 1
      } catch (error) {
        summary.failures += 1
        issueRows.push({ type: 'backfill_contract_failed', contractId: item.id, studentId, errorCode: String(error?.code || 'unknown').slice(0, 100) })
      }
    }
  }
  summary.activeLaunchStudents = activeStudents.size
  if (apply) {
    const settingsReference = db.doc('loyaltySettings/current')
    await db.runTransaction(async (transaction) => {
      const settings = await transaction.get(settingsReference)
      const lockedDate = settings.exists ? storedDateKey(settings.data().launchDate) : ''
      if (lockedDate && lockedDate !== launchDate) throw new HttpsError('failed-precondition', `Ngày ra mắt đã khóa là ${lockedDate}.`)
      transaction.set(settingsReference, { launchDate, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    })
    for (const studentId of activeStudents) {
      const student = students.get(studentId) || {}
      const result = await applySourceTarget({
        db,
        studentId,
        accountUid: student.accountUid || '',
        sourceKey: `launch_bonus:${launchDate}:${studentId}`,
        sourceType: 'launch_bonus',
        sourceId: launchDate,
        sourceBranchId: student.branchId || '',
        description: 'Điểm chào mừng Aura Club',
        targetPoints: Number(DEFAULT_POLICY.launchWelcomePoints || 200),
        desiredState: 'pending',
        availableAt: Timestamp.fromDate(new Date(`${launchDate}T00:00:00+07:00`)),
        metadata: { launchDate },
      })
      if (result.changed) summary.launchBonusesStaged += 1
    }
    const batch = db.batch()
    issueRows.forEach((issue) => {
      const issueId = sourceDocumentId(`${issue.type}:${issue.contractId || issue.studentId || ''}`)
      batch.set(db.doc(`loyaltyReconciliationIssues/${issueId}`), { ...issue, schemaVersion: LOYALTY_SCHEMA_VERSION, status: 'open', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    })
    const runReference = db.collection('loyaltyReconciliationRuns').doc()
    batch.create(runReference, {
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      type: 'launch_backfill_batch',
      mode,
      actorUid,
      cursor: cursor || null,
      nextCursor: snapshot.size === safeBatchSize ? snapshot.docs[snapshot.docs.length - 1].id : null,
      launchDate,
      summary,
      createdAt: FieldValue.serverTimestamp(),
    })
    await batch.commit()
  }
  return {
    mode,
    launchDate,
    cursor: cursor || null,
    nextCursor: snapshot.size === safeBatchSize ? snapshot.docs[snapshot.docs.length - 1].id : null,
    hasMore: snapshot.size === safeBatchSize,
    activeLaunchStudentIds: [...activeStudents],
    summary,
  }
}

function commandReceiptId(uid, key) {
  return sourceDocumentId(`${uid}|${key}`)
}

function rewardView(value, id) {
  return {
    id,
    name: value.name || 'Quyền lợi Aura',
    description: value.description || '',
    pointsCost: Number(value.pointsCost || 0),
    category: value.category || 'other',
    fulfillmentType: value.fulfillmentType === 'automatic' ? 'automatic' : 'staff',
    entitlementType: value.entitlementType || null,
    branchIds: Array.isArray(value.branchIds) ? value.branchIds : [],
    stock: value.stock === null || value.stock === undefined ? null : Number(value.stock),
    validityDays: Number(value.validityDays || 60),
    active: value.active !== false,
    featured: value.featured === true,
  }
}

async function rewardForId(db, rewardId) {
  const snapshot = await db.doc(`loyaltyRewards/${rewardId}`).get()
  if (snapshot.exists) return rewardView(snapshot.data(), snapshot.id)
  const fallback = DEFAULT_REWARDS.find((item) => item.id === rewardId)
  return fallback ? rewardView({ ...fallback, active: true }, fallback.id) : null
}

function createLoyaltyFunctions({ db, onCall, logger = console }) {
  const loyaltyCall = (handler) => onCall({ region: REGION, ...DEFAULT_CALL_OPTIONS }, handler)
  const loyaltyAdminCall = (handler) => onCall({ region: REGION, ...ADMIN_CALL_OPTIONS }, handler)

  const getMyLoyaltyDashboard = loyaltyCall(async (request) => {
    const { student } = await studentActor(request, db)
    const [accountSnapshot, policy, missionSnapshot, ambassadorSnapshot, kudosSnapshot] = await Promise.all([
      db.doc(`loyaltyAccounts/${student.id}`).get(),
      currentPolicy(db),
      db.collection('loyaltyMissionProgress').where('studentId', '==', student.id).limit(30).get(),
      db.doc(`ambassadorProfiles/${student.id}`).get(),
      db.collection('sessionKudos').where('studentId', '==', student.id).limit(100).get(),
    ])
    const account = accountSnapshot.exists ? accountSnapshot.data() : defaultAccount({ studentId: student.id, accountUid: student.accountUid || request.auth.uid })
    const currentWeekId = mondayDateKey()
    const currentMonthId = dateKey().slice(0, 7)
    const missions = missionSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data(), updatedAt: timestampIso(item.data().updatedAt) }))
      .filter((item) => item.type === 'attendance_week' ? item.weekId === currentWeekId
        : item.type === 'attendance_streak' ? item.weekId === currentWeekId
          : item.monthId === currentMonthId)
    const recognitionItems = kudosSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data(), createdAt: timestampIso(item.data().createdAt) }))
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    const recognition = {
      totalKudos: recognitionItems.length,
      totalXp: recognitionItems.reduce((total, item) => total + Math.max(0, Number(item.xp || 0)), 0),
      badges: [...new Set(recognitionItems.map((item) => String(item.badge || '').trim()).filter(Boolean))],
      recent: recognitionItems.slice(0, 8).map((item) => ({
        id: item.id,
        sessionId: item.sessionId || '',
        trainerId: item.trainerId || '',
        message: item.message || '',
        xp: Math.max(0, Number(item.xp || 0)),
        badge: item.badge || '',
        createdAt: item.createdAt || '',
      })),
    }
    return {
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      account: publicAccount(account, policy),
      missions,
      recognition,
      ambassador: ambassadorSnapshot.exists ? {
        status: ambassadorSnapshot.data().status || 'pending',
        quarterId: ambassadorSnapshot.data().quarterId || quarterId(),
        qualifiedReferrals: Number(ambassadorSnapshot.data().qualifiedReferrals || 0),
        pendingCommissionVnd: Number(ambassadorSnapshot.data().pendingCommissionVnd || 0),
        availableCommissionVnd: Number(ambassadorSnapshot.data().availableCommissionVnd || 0),
        paidCommissionVnd: Number(ambassadorSnapshot.data().paidCommissionVnd || 0),
      } : null,
      features: {
        earn: policy.earnEnabled === true,
        redeem: policy.redeemEnabled === true,
        referral: policy.referralEnabled === true,
        ambassador: policy.ambassadorEnabled === true,
        nutrition: policy.nutritionEnabled === true,
      },
    }
  })

  const listMyLoyaltyHistory = loyaltyCall(async (request) => {
    const { student } = await studentActor(request, db)
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(10, Number(request.data?.pageSize || 30)))
    const snapshot = await db.collection('loyaltyLedgerEntries').where('studentId', '==', student.id).limit(300).get()
    const entries = snapshot.docs.map(publicLedgerEntry).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const offset = Math.max(0, Number(request.data?.offset || 0))
    return { entries: entries.slice(offset, offset + pageSize), nextOffset: offset + pageSize < entries.length ? offset + pageSize : null }
  })

  const listMyAvailableRewards = loyaltyCall(async (request) => {
    await studentActor(request, db)
    const policy = await currentPolicy(db)
    const snapshot = await db.collection('loyaltyRewards').limit(200).get()
    const rewards = snapshot.empty
      ? DEFAULT_REWARDS.map((item) => rewardView({ ...item, active: true }, item.id))
      : snapshot.docs.map((item) => rewardView(item.data(), item.id)).filter((item) => item.active)
    return { rewards, redeemEnabled: policy.redeemEnabled === true }
  })

  const redeemMyReward = loyaltyCall(async (request) => {
    const { actor, student } = await studentActor(request, db)
    const key = idempotencyKey(request.data?.idempotencyKey)
    const rewardId = documentId(request.data?.rewardId, 'Mã quyền lợi')
    const branchId = boundedString(request.data?.branchId, 'Chi nhánh nhận quyền lợi', 200, false)
    const [policy, reward] = await Promise.all([currentPolicy(db), rewardForId(db, rewardId)])
    if (!policy.redeemEnabled) throw new HttpsError('failed-precondition', 'Đổi Điểm Aura đang tạm dừng.')
    if (!reward?.active) throw new HttpsError('not-found', 'Quyền lợi không còn hoạt động.')
    if (reward.branchIds.length && !reward.branchIds.includes(branchId)) throw new HttpsError('failed-precondition', 'Quyền lợi không áp dụng tại chi nhánh đã chọn.')
    const receiptReference = db.doc(`loyaltyCommandReceipts/${commandReceiptId(actor.uid, key)}`)
    const accountReference = db.doc(`loyaltyAccounts/${student.id}`)
    const redemptionReference = db.collection('loyaltyRedemptions').doc()
    const automatic = reward.fulfillmentType === 'automatic'
    return db.runTransaction(async (transaction) => {
      const [receiptSnapshot, accountSnapshot, rewardSnapshot] = await Promise.all([
        transaction.get(receiptReference),
        transaction.get(accountReference),
        transaction.get(db.doc(`loyaltyRewards/${rewardId}`)),
      ])
      if (receiptSnapshot.exists) return receiptSnapshot.data().result
      const liveReward = rewardSnapshot.exists ? rewardView(rewardSnapshot.data(), rewardSnapshot.id) : reward
      if (!liveReward.active || (liveReward.stock !== null && liveReward.stock <= 0)) throw new HttpsError('failed-precondition', 'Quyền lợi đã hết hoặc tạm ngừng.')
      let account
      try {
        account = consumeAvailablePoints(accountSnapshot.exists ? accountSnapshot.data() : defaultAccount({ studentId: student.id, accountUid: actor.uid }), liveReward.pointsCost)
      } catch (error) {
        if (error.message === 'LOYALTY_ACCOUNT_SUSPENDED') throw new HttpsError('failed-precondition', 'Tài khoản Aura Club đang tạm khóa.')
        if (error.message === 'LOYALTY_DEBT_BLOCKS_REDEMPTION') throw new HttpsError('failed-precondition', 'Bạn cần bù Điểm Aura bị đảo trước khi đổi thêm quyền lợi.')
        throw new HttpsError('failed-precondition', 'Bạn chưa đủ Điểm Aura để đổi quyền lợi này.')
      }
      if (automatic) account = redeemReservedPoints(account, liveReward.pointsCost)
      setAccountProjection(transaction, db, accountReference, account)
      if (rewardSnapshot.exists && liveReward.stock !== null) transaction.update(rewardSnapshot.ref, { stock: liveReward.stock - 1, updatedAt: FieldValue.serverTimestamp() })
      const status = automatic ? 'fulfilled' : 'pending'
      transaction.create(redemptionReference, {
        schemaVersion: LOYALTY_SCHEMA_VERSION,
        studentId: student.id,
        accountUid: actor.uid,
        branchId: branchId || null,
        rewardId,
        rewardSnapshot: liveReward,
        pointsCost: liveReward.pointsCost,
        status,
        revision: 1,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
        fulfilledAt: automatic ? FieldValue.serverTimestamp() : null,
      })
      transaction.create(db.doc(`loyaltyLedgerEntries/${redemptionReference.id}_reserve`), {
        schemaVersion: LOYALTY_SCHEMA_VERSION,
        studentId: student.id,
        accountUid: actor.uid,
        sourceBranchId: branchId || null,
        kind: automatic ? 'redeem' : 'reserve',
        sourceType: 'reward',
        sourceId: redemptionReference.id,
        sourceKey: `reward:${redemptionReference.id}`,
        availableDelta: -liveReward.pointsCost,
        pendingDelta: 0,
        reservedDelta: automatic ? 0 : liveReward.pointsCost,
        debtDelta: 0,
        policyVersion: policy.version,
        description: `Đổi ${liveReward.name}`,
        effectiveAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      if (automatic && liveReward.entitlementType) {
        transaction.create(db.doc(`loyaltyEntitlements/${redemptionReference.id}`), {
          schemaVersion: LOYALTY_SCHEMA_VERSION,
          studentId: student.id,
          accountUid: actor.uid,
          type: liveReward.entitlementType,
          status: 'available',
          redemptionId: redemptionReference.id,
          branchId: branchId || null,
          expiresAt: Timestamp.fromMillis(Date.now() + liveReward.validityDays * 86_400_000),
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      const result = { redemptionId: redemptionReference.id, status, account: publicAccount(account, policy) }
      transaction.create(receiptReference, { uid: actor.uid, key, action: 'redeem', result, createdAt: FieldValue.serverTimestamp() })
      return result
    })
  })

  const cancelMyPendingRedemption = loyaltyCall(async (request) => {
    const { actor, student } = await studentActor(request, db)
    const redemptionId = documentId(request.data?.redemptionId, 'Mã yêu cầu đổi quà')
    const key = idempotencyKey(request.data?.idempotencyKey)
    const receiptReference = db.doc(`loyaltyCommandReceipts/${commandReceiptId(actor.uid, key)}`)
    const redemptionReference = db.doc(`loyaltyRedemptions/${redemptionId}`)
    const accountReference = db.doc(`loyaltyAccounts/${student.id}`)
    return db.runTransaction(async (transaction) => {
      const [receiptSnapshot, redemptionSnapshot, accountSnapshot] = await Promise.all([
        transaction.get(receiptReference),
        transaction.get(redemptionReference),
        transaction.get(accountReference),
      ])
      if (receiptSnapshot.exists) return receiptSnapshot.data().result
      if (!redemptionSnapshot.exists || redemptionSnapshot.data().studentId !== student.id) throw new HttpsError('not-found', 'Không tìm thấy yêu cầu đổi quà.')
      if (redemptionSnapshot.data().status !== 'pending') throw new HttpsError('failed-precondition', 'Yêu cầu này không còn có thể hủy.')
      const points = Number(redemptionSnapshot.data().pointsCost || 0)
      let account
      try { account = releaseReservedPoints(accountSnapshot.data(), points) } catch { throw new HttpsError('failed-precondition', 'Số điểm đang giữ không còn khớp. Cần đối soát ví.') }
      setAccountProjection(transaction, db, accountReference, account)
      transaction.update(redemptionReference, { status: 'cancelled', revision: Number(redemptionSnapshot.data().revision || 0) + 1, cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(db.doc(`loyaltyLedgerEntries/${redemptionId}_release`), {
        schemaVersion: LOYALTY_SCHEMA_VERSION,
        studentId: student.id,
        accountUid: actor.uid,
        kind: 'release',
        sourceType: 'reward',
        sourceId: redemptionId,
        sourceKey: `reward:${redemptionId}`,
        availableDelta: points,
        pendingDelta: 0,
        reservedDelta: -points,
        debtDelta: 0,
        policyVersion: LOYALTY_POLICY_VERSION,
        description: 'Hoàn điểm yêu cầu đổi quà đã hủy',
        effectiveAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      const result = { redemptionId, status: 'cancelled', account: publicAccount(account) }
      transaction.create(receiptReference, { uid: actor.uid, key, action: 'cancel_redemption', result, createdAt: FieldValue.serverTimestamp() })
      return result
    })
  })

  const createMyReferralCode = loyaltyCall(async (request) => {
    const { actor, student } = await studentActor(request, db)
    const policy = await currentPolicy(db)
    if (!policy.referralEnabled) throw new HttpsError('failed-precondition', 'Giới thiệu bạn đang tạm dừng.')
    const code = `AURA${sourceDocumentId(student.id).slice(0, 7).toUpperCase()}`
    const reference = db.doc(`memberReferralCodes/${code}`)
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (snapshot.exists && snapshot.data().studentId !== student.id) throw new HttpsError('already-exists', 'Mã giới thiệu đã tồn tại.')
      transaction.set(reference, {
        schemaVersion: LOYALTY_SCHEMA_VERSION,
        code,
        studentId: student.id,
        accountUid: actor.uid,
        status: 'active',
        createdAt: snapshot.exists ? snapshot.data().createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
    return { code, shareUrl: `${boundedString(process.env.PUBLIC_APP_URL || 'https://dinh-duong-aura.vercel.app', 'Địa chỉ Aura', 500)}?ref=${code}` }
  })

  const getMyReferralWorkspace = loyaltyCall(async (request) => {
    const { student } = await studentActor(request, db)
    const [codeSnapshot, referralSnapshot, ambassadorSnapshot] = await Promise.all([
      db.collection('memberReferralCodes').where('studentId', '==', student.id).limit(1).get(),
      db.collection('memberReferrals').where('referrerStudentId', '==', student.id).limit(100).get(),
      db.doc(`ambassadorProfiles/${student.id}`).get(),
    ])
    return {
      code: codeSnapshot.empty ? null : codeSnapshot.docs[0].id,
      referrals: referralSnapshot.docs.map((item) => {
        const value = item.data()
        return { id: item.id, status: value.status || 'lead', referredName: value.referredName || 'Khách được giới thiệu', netCollectedVnd: Number(value.netCollectedVnd || 0), createdAt: timestampIso(value.createdAt), qualifiedAt: timestampIso(value.qualifiedAt), holdUntil: timestampIso(value.holdUntil), rewardMode: value.rewardMode || 'points' }
      }),
      ambassador: ambassadorSnapshot.exists ? { id: ambassadorSnapshot.id, ...ambassadorSnapshot.data(), createdAt: timestampIso(ambassadorSnapshot.data().createdAt) } : null,
    }
  })

  const applyForAmbassador = loyaltyCall(async (request) => {
    const { actor, student } = await studentActor(request, db)
    const policy = await currentPolicy(db)
    if (!policy.ambassadorEnabled) throw new HttpsError('failed-precondition', 'Aura Ambassador đang tạm dừng nhận đăng ký.')
    const note = boundedString(request.data?.note, 'Lý do đăng ký', 1000, false)
    const reference = db.doc(`ambassadorProfiles/${student.id}`)
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (snapshot.exists && ['approved', 'pending'].includes(snapshot.data().status)) return
      transaction.set(reference, {
        schemaVersion: LOYALTY_SCHEMA_VERSION,
        studentId: student.id,
        accountUid: actor.uid,
        status: 'pending',
        note,
        quarterId: quarterId(),
        qualifiedReferrals: 0,
        pendingCommissionVnd: 0,
        availableCommissionVnd: 0,
        paidCommissionVnd: Number(snapshot.exists ? snapshot.data().paidCommissionVnd || 0 : 0),
        revision: Number(snapshot.exists ? snapshot.data().revision || 0 : 0) + 1,
        createdAt: snapshot.exists ? snapshot.data().createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
    return { status: 'pending' }
  })

  const captureMemberContractReferral = loyaltyCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.referral.capture')
    const contractId = documentId(request.data?.contractId, 'Mã hợp đồng')
    const code = normalizeMemberReferralCode(request.data?.memberReferralCode)
    if (!code) throw new HttpsError('invalid-argument', 'Mã giới thiệu Aura không hợp lệ.')
    const [contractSnapshot, codeSnapshot] = await Promise.all([
      db.doc(`contracts/${contractId}`).get(),
      db.doc(`memberReferralCodes/${code}`).get(),
    ])
    if (!contractSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng cần liên kết.')
    if (!codeSnapshot.exists || codeSnapshot.data().status !== 'active') throw new HttpsError('not-found', 'Mã giới thiệu Aura không tồn tại hoặc đã ngừng hoạt động.')
    const contract = contractSnapshot.data()
    if (!canAccessBranch(actor, contract.branchId || '')) throw new HttpsError('permission-denied', 'Hợp đồng không thuộc phạm vi chi nhánh của bạn.')
    if (contract.studentId === codeSnapshot.data().studentId) throw new HttpsError('failed-precondition', 'Học viên không thể tự giới thiệu chính mình.')
    if (contract.memberReferralCode && normalizeMemberReferralCode(contract.memberReferralCode) !== code) throw new HttpsError('failed-precondition', 'Hợp đồng đã gắn với một mã giới thiệu Aura khác.')
    await contractSnapshot.ref.set({
      memberReferralCode: code,
      memberReferrerStudentId: codeSnapshot.data().studentId,
      memberReferralCapturedBy: actor.uid,
      memberReferralCapturedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    const result = await reconcileMemberReferral({ db, contractId, logger })
    return { contractId, memberReferralCode: code, referralId: result.referralId || null, status: result.status || 'captured' }
  })

  const getLoyaltyAdminDashboard = loyaltyAdminCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.dashboard.read')
    const scopedStudentIds = new Set()
    if (actor.accessRole === 'staff') {
      const branchStudentSnapshots = await Promise.all(actor.branchIds.slice(0, 10).map((branchId) => db.collection('students').where('branchId', '==', branchId).limit(1000).get()))
      branchStudentSnapshots.forEach((snapshot) => snapshot.docs.forEach((item) => scopedStudentIds.add(item.id)))
    }
    const [accountsSnapshot, redemptionsSnapshot, referralsSnapshot, ambassadorsSnapshot, policy, settingsSnapshot] = await Promise.all([
      db.collection('loyaltyAccounts').limit(1000).get(),
      db.collection('loyaltyRedemptions').limit(1000).get(),
      db.collection('memberReferrals').limit(1000).get(),
      db.collection('ambassadorProfiles').limit(500).get(),
      currentPolicy(db),
      db.doc('loyaltySettings/current').get(),
    ])
    const inScope = (studentId) => actor.accessRole !== 'staff' || scopedStudentIds.has(studentId)
    const accounts = accountsSnapshot.docs.filter((item) => inScope(item.id)).map((item) => normalizeAccount(item.data()))
    const redemptions = redemptionsSnapshot.docs.map((item) => item.data()).filter((item) => inScope(item.studentId) && canAccessBranch(actor, item.branchId || ''))
    const referrals = referralsSnapshot.docs.map((item) => item.data()).filter((item) => inScope(item.referrerStudentId))
    const ambassadors = ambassadorsSnapshot.docs.map((item) => item.data()).filter((item) => inScope(item.studentId))
    return {
      schemaVersion: LOYALTY_SCHEMA_VERSION,
      policyRevision: Number(settingsSnapshot.exists ? settingsSnapshot.data().revision || 0 : 0),
      launchDate: settingsSnapshot.exists ? storedDateKey(settingsSnapshot.data().launchDate) : '',
      generatedAt: new Date().toISOString(),
      scope: actor.accessRole === 'admin' || actor.accessRole === 'super_admin' ? 'all' : actor.branchIds,
      metrics: {
        memberCount: accounts.length,
        availablePoints: accounts.reduce((total, item) => total + item.availablePoints, 0),
        pendingPoints: accounts.reduce((total, item) => total + item.pendingPoints, 0),
        reservedPoints: accounts.reduce((total, item) => total + item.reservedPoints, 0),
        debtPoints: accounts.reduce((total, item) => total + item.debtPoints, 0),
        lifetimeRedeemedPoints: accounts.reduce((total, item) => total + item.lifetimeRedeemedPoints, 0),
        pendingRedemptions: redemptions.filter((item) => item.status === 'pending').length,
        fulfilledRedemptions: redemptions.filter((item) => item.status === 'fulfilled').length,
        qualifiedReferrals: referrals.filter((item) => item.status === 'qualified' || item.status === 'vested').length,
        approvedAmbassadors: ambassadors.filter((item) => item.status === 'approved').length,
        outstandingNominalValueVnd: accounts.reduce((total, item) => total + item.availablePoints + item.pendingPoints + item.reservedPoints, 0) * Number(policy.pointValueVnd || 100),
      },
      tiers: ['member', 'silver', 'gold', 'diamond'].map((tier) => ({ tier, count: accounts.filter((item) => item.tier === tier).length })),
      features: { earn: policy.earnEnabled, redeem: policy.redeemEnabled, referral: policy.referralEnabled, ambassador: policy.ambassadorEnabled, nutrition: policy.nutritionEnabled },
    }
  })

  const listLoyaltyAccounts = loyaltyAdminCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.dashboard.read')
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(10, Number(request.data?.pageSize || 50)))
    const snapshot = await db.collection('loyaltyAccounts').limit(limit).get()
    const policy = await currentPolicy(db)
    const studentSnapshots = snapshot.empty ? [] : await db.getAll(...snapshot.docs.map((item) => db.doc(`students/${item.id}`)))
    const students = new Map(studentSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]))
    const rows = snapshot.docs.flatMap((item) => {
      const student = students.get(item.id) || {}
      if (!canAccessBranch(actor, student.branchId || '')) return []
      return [{
        ...publicAccount(item.data(), policy),
        studentName: student.name || student.displayName || 'Học viên Aura',
        branchId: student.branchId || '',
      }]
    })
    return { accounts: rows }
  })

  const listLoyaltyRewardsAdmin = loyaltyAdminCall(async (request) => {
    await capabilityActor(request, db, 'loyalty.reward.manage')
    const snapshot = await db.collection('loyaltyRewards').limit(200).get()
    const rewards = snapshot.empty
      ? DEFAULT_REWARDS.map((item) => ({ ...rewardView({ ...item, active: true }, item.id), revision: 0, persisted: false }))
      : snapshot.docs.map((item) => ({
        ...rewardView(item.data(), item.id),
        revision: Math.max(0, Number(item.data().revision || 0)),
        persisted: true,
      }))
    return { rewards: rewards.sort((left, right) => left.pointsCost - right.pointsCost || left.name.localeCompare(right.name, 'vi')) }
  })

  const listLoyaltyAmbassadors = loyaltyAdminCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.ambassador.manage')
    const snapshot = await db.collection('ambassadorProfiles').limit(300).get()
    const studentIds = [...new Set(snapshot.docs.map((item) => String(item.data().studentId || item.id)).filter(Boolean))]
    const studentSnapshots = studentIds.length ? await db.getAll(...studentIds.map((studentId) => db.doc(`students/${studentId}`))) : []
    const students = new Map(studentSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]))
    const ambassadors = snapshot.docs.flatMap((item) => {
      const value = item.data()
      const studentId = String(value.studentId || item.id)
      const student = students.get(studentId) || {}
      if (!canAccessBranch(actor, student.branchId || '')) return []
      return [{
        id: item.id,
        studentId,
        studentName: student.name || student.displayName || 'Học viên Aura',
        branchId: student.branchId || '',
        status: value.status || 'pending',
        note: String(value.note || '').slice(0, 1000),
        quarterId: value.quarterId || quarterId(),
        qualifiedReferrals: Math.max(0, Number(value.qualifiedReferrals || 0)),
        pendingCommissionVnd: Math.max(0, Number(value.pendingCommissionVnd || 0)),
        availableCommissionVnd: Math.max(0, Number(value.availableCommissionVnd || 0)),
        paidCommissionVnd: Math.max(0, Number(value.paidCommissionVnd || 0)),
        debtCommissionVnd: Math.max(0, Number(value.debtCommissionVnd || 0)),
        revision: Math.max(0, Number(value.revision || 0)),
        createdAt: timestampIso(value.createdAt),
        updatedAt: timestampIso(value.updatedAt),
      }]
    })
    const statusOrder = { pending: 0, approved: 1, suspended: 2, rejected: 3 }
    ambassadors.sort((left, right) => (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9) || right.updatedAt.localeCompare(left.updatedAt))
    return { ambassadors }
  })

  const listLoyaltyReconciliationIssues = loyaltyAdminCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.audit.read')
    const requestedStatus = boundedString(request.data?.status, 'Trạng thái', 30, false)
    const snapshot = await db.collection('loyaltyReconciliationIssues').limit(300).get()
    const values = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => !requestedStatus || item.status === requestedStatus)
    const studentIds = [...new Set(values.map((item) => String(item.studentId || '')).filter(Boolean))]
    const studentSnapshots = studentIds.length ? await db.getAll(...studentIds.map((studentId) => db.doc(`students/${studentId}`))) : []
    const students = new Map(studentSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]))
    const issues = values.flatMap((item) => {
      const student = item.studentId ? students.get(item.studentId) || {} : {}
      const branchId = String(item.branchId || student.branchId || '')
      if (!canAccessBranch(actor, branchId)) return []
      return [{
        id: item.id,
        type: String(item.type || 'unknown').slice(0, 120),
        status: String(item.status || 'open').slice(0, 30),
        studentId: String(item.studentId || ''),
        studentName: student.name || student.displayName || '',
        contractId: String(item.contractId || ''),
        branchId,
        errorCode: String(item.errorCode || '').slice(0, 120),
        updatedAt: timestampIso(item.updatedAt || item.createdAt),
      }]
    })
    issues.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    return { issues }
  })

  const listLoyaltyRedemptions = loyaltyAdminCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.redemption.review')
    const snapshot = await db.collection('loyaltyRedemptions').limit(300).get()
    const status = boundedString(request.data?.status, 'Trạng thái', 40, false)
    const entries = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => !status || item.status === status)
      .filter((item) => canAccessBranch(actor, item.branchId || ''))
      .map((item) => ({ ...item, createdAt: timestampIso(item.createdAt), updatedAt: timestampIso(item.updatedAt) }))
    return { redemptions: entries }
  })

  async function transitionRedemption(request, forcedStatus = '') {
    const actor = await capabilityActor(request, db, forcedStatus === 'fulfilled' ? 'loyalty.redemption.fulfill' : 'loyalty.redemption.review')
    const redemptionId = documentId(request.data?.redemptionId, 'Mã yêu cầu')
    const nextStatus = forcedStatus || boundedString(request.data?.status, 'Trạng thái', 30)
    if (!['approved', 'fulfilled', 'rejected', 'cancelled'].includes(nextStatus)) throw new HttpsError('invalid-argument', 'Trạng thái đổi thưởng không hợp lệ.')
    const reference = db.doc(`loyaltyRedemptions/${redemptionId}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy yêu cầu đổi thưởng.')
      const value = snapshot.data()
      if (!canAccessBranch(actor, value.branchId || '')) throw new HttpsError('permission-denied', 'Yêu cầu không thuộc phạm vi chi nhánh của bạn.')
      const allowed = {
        pending: new Set(['approved', 'rejected', 'cancelled']),
        approved: new Set(['fulfilled', 'cancelled']),
      }
      if (!allowed[value.status]?.has(nextStatus)) throw new HttpsError('failed-precondition', 'Yêu cầu đã đổi trạng thái. Hãy tải lại.')
      const accountReference = db.doc(`loyaltyAccounts/${value.studentId}`)
      const accountSnapshot = await transaction.get(accountReference)
      let account = normalizeAccount(accountSnapshot.data())
      let availableDelta = 0
      let reservedDelta = 0
      if (nextStatus === 'fulfilled') {
        try { account = redeemReservedPoints(account, Number(value.pointsCost || 0)) } catch { throw new HttpsError('failed-precondition', 'Số điểm giữ chỗ không khớp. Cần đối soát trước khi hoàn tất.') }
        reservedDelta = -Number(value.pointsCost || 0)
      } else if (['rejected', 'cancelled'].includes(nextStatus)) {
        try { account = releaseReservedPoints(account, Number(value.pointsCost || 0)) } catch { throw new HttpsError('failed-precondition', 'Số điểm giữ chỗ không khớp. Cần đối soát trước khi hoàn.') }
        availableDelta = Number(value.pointsCost || 0)
        reservedDelta = -Number(value.pointsCost || 0)
      }
      if (availableDelta || reservedDelta) {
        setAccountProjection(transaction, db, accountReference, account)
        transaction.create(db.doc(`loyaltyLedgerEntries/${redemptionId}_${nextStatus}`), {
          schemaVersion: LOYALTY_SCHEMA_VERSION,
          studentId: value.studentId,
          accountUid: value.accountUid || null,
          sourceBranchId: value.branchId || null,
          kind: nextStatus === 'fulfilled' ? 'redeem' : 'release',
          sourceType: 'reward',
          sourceId: redemptionId,
          sourceKey: `reward:${redemptionId}`,
          availableDelta,
          pendingDelta: 0,
          reservedDelta,
          debtDelta: 0,
          policyVersion: LOYALTY_POLICY_VERSION,
          description: nextStatus === 'fulfilled' ? `Hoàn tất ${value.rewardSnapshot?.name || 'quyền lợi'}` : 'Hoàn điểm đổi thưởng',
          effectiveAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        })
      }
      transaction.update(reference, {
        status: nextStatus,
        revision: Number(value.revision || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        [`${nextStatus}At`]: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('loyaltyAuditLogs').doc(), { action: `redemption.${nextStatus}`, actorUid: actor.uid, redemptionId, studentId: value.studentId, branchId: value.branchId || null, createdAt: FieldValue.serverTimestamp() })
      return { redemptionId, status: nextStatus }
    })
  }

  const transitionLoyaltyRedemption = loyaltyAdminCall((request) => transitionRedemption(request))
  const fulfillLoyaltyRedemption = loyaltyAdminCall((request) => transitionRedemption(request, 'fulfilled'))

  const saveLoyaltyPolicy = loyaltyAdminCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.policy.manage')
    const expectedRevision = integer(request.data?.expectedRevision ?? 0, 'Phiên bản kỳ vọng', 0, 1_000_000)
    const settingsReference = db.doc('loyaltySettings/current')
    const versionReference = db.collection('loyaltyPolicyVersions').doc()
    return db.runTransaction(async (transaction) => {
      const settingsSnapshot = await transaction.get(settingsReference)
      const revision = Number(settingsSnapshot.exists ? settingsSnapshot.data().revision || 0 : 0)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Chính sách đã được người khác cập nhật. Hãy tải lại.')
      const toggles = request.data?.features || {}
      if (toggles.earn === true && !storedDateKey(settingsSnapshot.exists ? settingsSnapshot.data().launchDate : '')) {
        throw new HttpsError('failed-precondition', 'Cần chạy đối soát Aura Club và khóa ngày ra mắt trước khi bật tích điểm.')
      }
      const policy = normalizedPolicy({
        ...DEFAULT_POLICY,
        version: versionReference.id,
        earnEnabled: toggles.earn === true,
        redeemEnabled: toggles.redeem === true,
        referralEnabled: toggles.referral === true,
        ambassadorEnabled: toggles.ambassador === true,
        nutritionEnabled: toggles.nutrition === true,
        effectiveAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      transaction.create(versionReference, policy)
      transaction.set(settingsReference, { activePolicyVersion: versionReference.id, revision: revision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
      transaction.create(db.collection('loyaltyAuditLogs').doc(), { action: 'policy.published', actorUid: actor.uid, policyVersion: versionReference.id, beforeRevision: revision, afterRevision: revision + 1, createdAt: FieldValue.serverTimestamp() })
      return { policyVersion: versionReference.id, revision: revision + 1 }
    })
  })

  const saveLoyaltyReward = loyaltyAdminCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.reward.manage')
    const rewardId = request.data?.id ? documentId(request.data.id, 'Mã quyền lợi') : db.collection('loyaltyRewards').doc().id
    const reference = db.doc(`loyaltyRewards/${rewardId}`)
    const expectedRevision = integer(request.data?.expectedRevision ?? 0, 'Phiên bản kỳ vọng', 0, 1_000_000)
    const reward = rewardView({
      name: boundedString(request.data?.name, 'Tên quyền lợi', 160),
      description: boundedString(request.data?.description, 'Mô tả', 1000, false),
      pointsCost: integer(request.data?.pointsCost, 'Điểm đổi', 1, 1_000_000),
      category: boundedString(request.data?.category || 'other', 'Loại quyền lợi', 60),
      fulfillmentType: request.data?.fulfillmentType,
      entitlementType: boundedString(request.data?.entitlementType, 'Loại entitlement', 80, false),
      branchIds: Array.isArray(request.data?.branchIds) ? [...new Set(request.data.branchIds.map((item) => documentId(item, 'Mã chi nhánh')))].slice(0, 30) : [],
      stock: request.data?.stock === null || request.data?.stock === undefined ? null : integer(request.data.stock, 'Tồn kho', 0, 1_000_000),
      validityDays: integer(request.data?.validityDays ?? 60, 'Thời hạn', 1, 3650),
      active: request.data?.active !== false,
      featured: request.data?.featured === true,
    }, rewardId)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      const revision = Number(snapshot.exists ? snapshot.data().revision || 0 : 0)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Quyền lợi đã được người khác cập nhật. Hãy tải lại.')
      transaction.set(reference, { ...reward, schemaVersion: LOYALTY_SCHEMA_VERSION, revision: revision + 1, createdAt: snapshot.exists ? snapshot.data().createdAt : FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
      transaction.create(db.collection('loyaltyAuditLogs').doc(), { action: snapshot.exists ? 'reward.updated' : 'reward.created', actorUid: actor.uid, rewardId, beforeRevision: revision, afterRevision: revision + 1, createdAt: FieldValue.serverTimestamp() })
      return { rewardId, revision: revision + 1 }
    })
  })

  async function applyManualAdjustment({ actor, student, points, reason, adjustmentId }) {
    const accountReference = db.doc(`loyaltyAccounts/${student.id}`)
    const auditReference = db.doc(`loyaltyAuditLogs/${adjustmentId}`)
    return db.runTransaction(async (transaction) => {
      const [accountSnapshot, auditSnapshot] = await Promise.all([transaction.get(accountReference), transaction.get(auditReference)])
      if (auditSnapshot.exists && auditSnapshot.data().status === 'applied') return { adjustmentId, account: publicAccount(accountSnapshot.data()) }
      let account = normalizeAccount(accountSnapshot.exists ? accountSnapshot.data() : defaultAccount({ studentId: student.id, accountUid: student.accountUid || '' }), { studentId: student.id, accountUid: student.accountUid || '' })
      let availableDelta = 0
      let debtDelta = 0
      if (points > 0) {
        const result = applyAvailableEarning(account, points)
        account = result.account
        availableDelta = result.availableDelta
        debtDelta = result.debtDelta
      } else {
        const result = reverseAvailableEarning(account, Math.abs(points))
        account = result.account
        availableDelta = result.availableDelta
        debtDelta = result.debtDelta
      }
      setAccountProjection(transaction, db, accountReference, account)
      transaction.create(db.doc(`loyaltyLedgerEntries/${adjustmentId}`), {
        schemaVersion: LOYALTY_SCHEMA_VERSION,
        studentId: student.id,
        accountUid: student.accountUid || null,
        sourceBranchId: student.branchId || null,
        kind: 'adjust',
        sourceType: 'admin',
        sourceId: adjustmentId,
        sourceKey: `admin:${adjustmentId}`,
        availableDelta,
        pendingDelta: 0,
        reservedDelta: 0,
        debtDelta,
        policyVersion: LOYALTY_POLICY_VERSION,
        description: reason,
        effectiveAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      transaction.set(auditReference, { action: 'points.adjusted', status: 'applied', actorUid: actor.uid, studentId: student.id, points, reason, createdAt: FieldValue.serverTimestamp() }, { merge: true })
      return { adjustmentId, account: publicAccount(account) }
    })
  }

  const adjustLoyaltyBalance = loyaltyAdminCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.adjust.request')
    const student = await scopedStudent(db, actor, request.data?.studentId)
    const points = integer(request.data?.points, 'Số điểm điều chỉnh', -1_000_000, 1_000_000)
    if (points === 0) throw new HttpsError('invalid-argument', 'Số điểm điều chỉnh phải khác 0.')
    const reason = boundedString(request.data?.reason, 'Lý do điều chỉnh', 500)
    const key = idempotencyKey(request.data?.idempotencyKey)
    const adjustmentId = `adjust_${commandReceiptId(actor.uid, key)}`
    const policy = await currentPolicy(db)
    if (Math.abs(points) >= Number(policy.largeAdjustmentThreshold || 500)) {
      await db.doc(`loyaltyAdjustments/${adjustmentId}`).create({ schemaVersion: LOYALTY_SCHEMA_VERSION, studentId: student.id, accountUid: student.accountUid || null, branchId: student.branchId || null, points, reason, status: 'pending_approval', requestedBy: actor.uid, createdAt: FieldValue.serverTimestamp(), revision: 1 })
      return { adjustmentId, status: 'pending_approval' }
    }
    return { ...(await applyManualAdjustment({ actor, student, points, reason, adjustmentId })), status: 'applied' }
  })

  const reviewLoyaltyAdjustment = loyaltyAdminCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.adjust.approve')
    const adjustmentId = documentId(request.data?.adjustmentId, 'Mã điều chỉnh')
    const decision = request.data?.decision === 'approve' ? 'approve' : request.data?.decision === 'reject' ? 'reject' : ''
    if (!decision) throw new HttpsError('invalid-argument', 'Quyết định không hợp lệ.')
    const reference = db.doc(`loyaltyAdjustments/${adjustmentId}`)
    const snapshot = await reference.get()
    if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy yêu cầu điều chỉnh.')
    const value = snapshot.data()
    if (value.status !== 'pending_approval') throw new HttpsError('failed-precondition', 'Yêu cầu đã được xử lý.')
    if (value.requestedBy === actor.uid) throw new HttpsError('permission-denied', 'Người tạo yêu cầu không được tự phê duyệt.')
    const student = await scopedStudent(db, actor, value.studentId)
    if (decision === 'reject') {
      await reference.update({ status: 'rejected', reviewedBy: actor.uid, reviewedAt: FieldValue.serverTimestamp(), revision: Number(value.revision || 0) + 1 })
      return { adjustmentId, status: 'rejected' }
    }
    const result = await applyManualAdjustment({ actor, student, points: Number(value.points || 0), reason: value.reason, adjustmentId })
    await reference.update({ status: 'applied', reviewedBy: actor.uid, reviewedAt: FieldValue.serverTimestamp(), revision: Number(value.revision || 0) + 1 })
    return { adjustmentId, status: 'applied', account: result.account }
  })

  const manageAmbassadorProfile = loyaltyAdminCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.ambassador.manage')
    const student = await scopedStudent(db, actor, request.data?.studentId)
    const status = boundedString(request.data?.status, 'Trạng thái', 30)
    if (!['approved', 'rejected', 'suspended'].includes(status)) throw new HttpsError('invalid-argument', 'Trạng thái Ambassador không hợp lệ.')
    const reference = db.doc(`ambassadorProfiles/${student.id}`)
    await reference.set({ schemaVersion: LOYALTY_SCHEMA_VERSION, studentId: student.id, accountUid: student.accountUid || null, status, quarterId: quarterId(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
    await db.collection('loyaltyAuditLogs').add({ action: `ambassador.${status}`, actorUid: actor.uid, studentId: student.id, createdAt: FieldValue.serverTimestamp() })
    return { studentId: student.id, status }
  })

  const approveAmbassadorPayout = loyaltyAdminCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.ambassador.manage')
    const student = await scopedStudent(db, actor, request.data?.studentId)
    const profileReference = db.doc(`ambassadorProfiles/${student.id}`)
    const payoutReference = db.collection('ambassadorPayouts').doc()
    const policy = await currentPolicy(db)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(profileReference)
      if (!snapshot.exists || snapshot.data().status !== 'approved') throw new HttpsError('failed-precondition', 'Ambassador chưa được duyệt.')
      const amount = Number(snapshot.data().availableCommissionVnd || 0)
      if (amount < Number(policy.ambassadorPayoutMinimumVnd || 100_000)) throw new HttpsError('failed-precondition', 'Hoa hồng chưa đạt mức chi trả tối thiểu.')
      transaction.create(payoutReference, { schemaVersion: LOYALTY_SCHEMA_VERSION, studentId: student.id, accountUid: student.accountUid || null, amountVnd: amount, status: 'approved', approvedBy: actor.uid, approvedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() })
      transaction.update(profileReference, { availableCommissionVnd: 0, paidCommissionVnd: FieldValue.increment(amount), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(db.collection('loyaltyAuditLogs').doc(), { action: 'ambassador.payout_approved', actorUid: actor.uid, studentId: student.id, payoutId: payoutReference.id, amountVnd: amount, createdAt: FieldValue.serverTimestamp() })
      return { payoutId: payoutReference.id, amountVnd: amount, status: 'approved' }
    })
  })

  const reconcileLoyaltyAccount = loyaltyAdminCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.audit.read')
    const student = await scopedStudent(db, actor, request.data?.studentId)
    const snapshot = await db.collection('loyaltyLedgerEntries').where('studentId', '==', student.id).limit(5000).get()
    const totals = snapshot.docs.reduce((result, item) => {
      const value = item.data()
      result.availablePoints += Number(value.availableDelta || 0)
      result.pendingPoints += Number(value.pendingDelta || 0)
      result.reservedPoints += Number(value.reservedDelta || 0)
      result.debtPoints += Number(value.debtDelta || 0)
      result.tierQualifyingValue += Number(value.tierCreditDelta || 0)
      if (value.kind === 'earn' || value.kind === 'adjust') result.lifetimeEarnedPoints += Math.max(0, Number(value.pendingDelta || 0) + Number(value.availableDelta || 0) - Math.min(0, Number(value.debtDelta || 0)))
      if (value.kind === 'redeem') result.lifetimeRedeemedPoints += Math.max(Math.abs(Math.min(0, Number(value.availableDelta || 0))), Math.abs(Math.min(0, Number(value.reservedDelta || 0))))
      return result
    }, { availablePoints: 0, pendingPoints: 0, reservedPoints: 0, debtPoints: 0, tierQualifyingValue: 0, lifetimeEarnedPoints: 0, lifetimeRedeemedPoints: 0 })
    const accountReference = db.doc(`loyaltyAccounts/${student.id}`)
    const accountSnapshot = await accountReference.get()
    const current = normalizeAccount(accountSnapshot.exists ? accountSnapshot.data() : defaultAccount({ studentId: student.id, accountUid: student.accountUid || '' }))
    const expected = normalizeAccount({ ...current, ...totals, studentId: student.id, accountUid: student.accountUid || current.accountUid, revision: current.revision + 1 })
    const mismatch = ['availablePoints', 'pendingPoints', 'reservedPoints', 'debtPoints', 'tierQualifyingValue', 'lifetimeEarnedPoints', 'lifetimeRedeemedPoints'].some((key) => Number(current[key] || 0) !== Number(expected[key] || 0))
    if (mismatch) {
      const batch = db.batch()
      batch.set(accountReference, accountProjection(expected), { merge: true })
      batch.create(db.collection('loyaltyReconciliationIssues').doc(), { type: 'account_projection_mismatch', studentId: student.id, before: publicAccount(current), after: publicAccount(expected), status: 'repaired', actorUid: actor.uid, createdAt: FieldValue.serverTimestamp() })
      if (expected.accountUid) batch.set(db.doc(`users/${expected.accountUid}/loyaltySummary/current`), { ...accountProjection(expected), accountId: student.id }, { merge: true })
      await batch.commit()
    }
    return { studentId: student.id, mismatch, account: publicAccount(expected) }
  })

  const runLoyaltyBackfill = loyaltyAdminCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.audit.read')
    if (!['admin', 'super_admin'].includes(actor.accessRole)) throw new HttpsError('permission-denied', 'Chỉ Admin hệ thống được chạy đối soát ra mắt Aura Club.')
    const mode = request.data?.mode === 'apply' ? 'apply' : 'dry_run'
    const cursor = boundedString(request.data?.cursor, 'Con trỏ đối soát', 200, false)
    const launchDate = boundedString(request.data?.launchDate || dateKey(), 'Ngày ra mắt', 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(launchDate)) throw new HttpsError('invalid-argument', 'Ngày ra mắt không hợp lệ.')
    return runLoyaltyBackfillBatch({
      db,
      actorUid: actor.uid,
      mode,
      cursor,
      batchSize: integer(request.data?.batchSize ?? 25, 'Số hợp đồng mỗi lượt', 1, 50),
      launchDate,
      logger,
    })
  })

  const getStudentLoyaltySummary = loyaltyCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.student.read')
    const student = await scopedStudent(db, actor, request.data?.studentId)
    const snapshot = await db.doc(`loyaltyAccounts/${student.id}`).get()
    return { studentId: student.id, studentName: student.name || student.displayName || 'Học viên Aura', account: publicAccount(snapshot.exists ? snapshot.data() : defaultAccount({ studentId: student.id, accountUid: student.accountUid || '' })) }
  })

  const giveSessionKudos = loyaltyCall(async (request) => {
    const actor = await capabilityActor(request, db, 'loyalty.kudos.create')
    const sessionId = documentId(request.data?.sessionId, 'Mã buổi tập')
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const message = boundedString(request.data?.message, 'Lời khen', 280)
    const sessionReference = db.doc(`sessions/${sessionId}`)
    const kudosReference = db.doc(`sessionKudos/${sessionId}_${studentId}`)
    const usageReference = db.doc(`trainerKudosUsage/${actor.uid}_${dateKey()}`)
    await db.runTransaction(async (transaction) => {
      const [sessionSnapshot, kudosSnapshot, usageSnapshot] = await Promise.all([transaction.get(sessionReference), transaction.get(kudosReference), transaction.get(usageReference)])
      if (!sessionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
      const session = sessionSnapshot.data()
      if (![actor.uid, actor.legacyStaffId].includes(session.trainerId) || session.studentId !== studentId) throw new HttpsError('permission-denied', 'Bạn chỉ có thể gửi lời khen cho học viên trong ca mình dạy.')
      if (!['present', 'late'].includes(session.attendanceStatus) || session.billingStatus !== 'charged') throw new HttpsError('failed-precondition', 'Chỉ gửi Kudos sau buổi tập đã xác nhận.')
      if (kudosSnapshot.exists) return
      const used = Number(usageSnapshot.exists ? usageSnapshot.data().count || 0 : 0)
      if (used >= 5) throw new HttpsError('resource-exhausted', 'Bạn đã dùng hết năm lượt Kudos hôm nay.')
      transaction.create(kudosReference, { schemaVersion: LOYALTY_SCHEMA_VERSION, sessionId, studentId, trainerId: actor.legacyStaffId || actor.uid, accountUid: session.accountUid || null, message, xp: 5, badge: 'great_session', createdAt: FieldValue.serverTimestamp() })
      transaction.set(usageReference, { trainerId: actor.uid, date: dateKey(), count: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      if (session.accountUid) transaction.set(db.doc(`users/${session.accountUid}/notifications/kudos_${sessionId}`), { schemaVersion: 1, userId: session.accountUid, type: 'loyalty_kudos', category: 'loyalty', title: 'PT vừa gửi bạn một lời khen', body: message, route: 'aura-club', read: false, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    })
    return { sessionId, studentId, xp: 5, badge: 'great_session' }
  })

  return {
    getMyLoyaltyDashboard,
    listMyLoyaltyHistory,
    listMyAvailableRewards,
    redeemMyReward,
    cancelMyPendingRedemption,
    getMyReferralWorkspace,
    createMyReferralCode,
    captureMemberContractReferral,
    applyForAmbassador,
    getLoyaltyAdminDashboard,
    listLoyaltyAccounts,
    listLoyaltyRewardsAdmin,
    listLoyaltyAmbassadors,
    listLoyaltyReconciliationIssues,
    listLoyaltyRedemptions,
    transitionLoyaltyRedemption,
    fulfillLoyaltyRedemption,
    saveLoyaltyPolicy,
    saveLoyaltyReward,
    adjustLoyaltyBalance,
    reviewLoyaltyAdjustment,
    manageAmbassadorProfile,
    approveAmbassadorPayout,
    reconcileLoyaltyAccount,
    runLoyaltyBackfill,
    getStudentLoyaltySummary,
    giveSessionKudos,
  }
}

module.exports = {
  DEFAULT_CALL_OPTIONS,
  ADMIN_CALL_OPTIONS,
  ambassadorRateForQualifiedCount,
  applySourceTarget,
  attendanceEarnsPoints,
  consecutiveCompletedWeeks,
  createLoyaltyFunctions,
  currentPolicy,
  dateKey,
  findStudentForUid,
  occursOnOrAfterLaunch,
  nutritionDailySummaries,
  publicAccount,
  reconcileAttendance,
  reconcileAttendanceMissions,
  reconcileContractSpend,
  reconcileMemberReferral,
  reconcileNutritionReview,
  reconcilePendingMemberReferrals,
  runLoyaltyBackfillBatch,
  vestPendingSources,
}
