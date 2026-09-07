const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { createHash } = require('node:crypto')
const { trustedAccessContext, requireCapability } = require('./identity-access')

const PERFORMANCE_SCHEMA_VERSION = 1
const PERFORMANCE_POLICY_VERSION = 'aura-performance-v1'
const EVIDENCE_STATUSES = new Set(['submitted', 'needs_revision', 'approved', 'rejected', 'withdrawn'])
const REVIEW_STATUSES = new Set(['approved', 'needs_revision', 'rejected'])
const EVIDENCE_TYPES = new Set(['personal_content', 'aura_assignment'])
const PLATFORMS = new Set(['facebook', 'instagram', 'tiktok', 'youtube', 'group', 'other'])
const PROFILE_CHECKLIST_KEYS = Object.freeze([
  'photo',
  'bio',
  'certifications',
  'expertise',
  'case_studies',
  'reviews',
  'intro_video',
  'social_links',
  'schedule',
  'contact',
])
const PERFORMANCE_CATEGORIES = Object.freeze([
  { id: 'reliability', label: 'Độ tin cậy & thực hiện ca', weight: 22 },
  { id: 'coaching_quality', label: 'Chất lượng huấn luyện', weight: 23 },
  { id: 'student_experience', label: 'Trải nghiệm học viên', weight: 17 },
  { id: 'student_progress', label: 'Tiến bộ & gắn kết học viên', weight: 13 },
  { id: 'operations', label: 'Vận hành & phối hợp', weight: 10 },
  { id: 'renewal', label: 'Gia hạn có quy thuộc', weight: 5 },
  { id: 'brand', label: 'Thương hiệu cá nhân / Aura Brand', weight: 10 },
])

function boundedText(value, label, maximum, required = false) {
  const result = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum + 1) : ''
  if ((required && !result) || result.length > maximum) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function documentId(value, label) {
  const result = boundedText(value, label, 200, true)
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function periodId(value) {
  const result = boundedText(value, 'Kỳ đánh giá', 7, true)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(result)) throw new HttpsError('invalid-argument', 'Kỳ đánh giá phải có dạng YYYY-MM.')
  return result
}

function dateKey(value, label = 'Ngày đăng') {
  const result = boundedText(value, label, 10, true)
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  const [year, month, day] = result.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function iso(value) {
  if (!value) return ''
  const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value))
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : ''
}

function normalizeUrl(value) {
  const raw = boundedText(value, 'Liên kết bằng chứng', 1_000)
  if (!raw) return ''
  let parsed
  try { parsed = new URL(raw) } catch { throw new HttpsError('invalid-argument', 'Liên kết bằng chứng phải là URL http hoặc https hợp lệ.') }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new HttpsError('invalid-argument', 'Liên kết bằng chứng phải là URL http hoặc https hợp lệ.')
  parsed.hash = ''
  ;[...parsed.searchParams.keys()].forEach((key) => {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) parsed.searchParams.delete(key)
  })
  parsed.hostname = parsed.hostname.toLowerCase()
  return parsed.toString().replace(/\/$/, '')
}

function normalizeContentHash(value) {
  const result = boundedText(value, 'Mã nội dung', 64).toLowerCase()
  if (result && !/^[a-f0-9]{64}$/.test(result)) throw new HttpsError('invalid-argument', 'Mã nội dung bằng chứng không hợp lệ.')
  return result
}

function proofKey({ type, url, contentHash, briefId, screenshotPath }) {
  const identity = type === 'aura_assignment' && briefId
    ? `brief:${briefId.toLowerCase()}|${contentHash ? `content:${contentHash}` : url ? `url:${url.toLowerCase()}` : 'task'}`
    : contentHash ? `content:${contentHash}` : url ? `url:${url.toLowerCase()}` : `file:${screenshotPath}`
  return createHash('sha256').update(`${type}|${identity}`).digest('hex')
}

function personalBrandScore(count) {
  if (count >= 4) return 5
  if (count === 3) return 4
  if (count === 2) return 2.5
  if (count === 1) return 1
  return 0
}

function calculateBrandPerformance(evidence = []) {
  const approved = evidence.filter((item) => item?.status === 'approved')
  const personalKeys = new Set()
  const auraKeys = new Set()
  let profileCompleted = 0
  let latestProfile = null
  approved.forEach((item) => {
    if (item.type === 'personal_content') personalKeys.add(item.duplicateKey || item.id)
    if (item.type === 'aura_assignment') auraKeys.add(item.duplicateKey || (item.briefId ? `brief:${item.briefId}` : item.id))
    if (item.type === 'profile_checklist') {
      const reviewedAt = iso(item.reviewedAt || item.updatedAt)
      if (!latestProfile || reviewedAt >= latestProfile.reviewedAt) {
        latestProfile = { reviewedAt, checklist: item.checklist && typeof item.checklist === 'object' ? item.checklist : {} }
      }
    }
  })
  if (latestProfile) profileCompleted = PROFILE_CHECKLIST_KEYS.filter((key) => latestProfile.checklist[key] === true).length
  const personalCount = personalKeys.size
  const auraCount = Math.min(3, auraKeys.size)
  const personalScore = personalBrandScore(personalCount)
  const auraScore = auraCount
  const profileScore = Math.min(2, Math.round(profileCompleted * 0.2 * 10) / 10)
  const total = Math.min(10, Math.round((personalScore + auraScore + profileScore) * 10) / 10)
  return {
    total,
    maximum: 10,
    personal: { approvedCount: personalCount, target: 4, score: personalScore, maximum: 5 },
    aura: { approvedCount: auraCount, target: 3, score: auraScore, maximum: 3 },
    profile: { completedCount: profileCompleted, target: 10, score: profileScore, maximum: 2, checklist: latestProfile?.checklist || {} },
  }
}

function serializeEvidence(snapshot, signedUrl = '') {
  const data = typeof snapshot?.data === 'function' ? snapshot.data() || {} : snapshot || {}
  return {
    id: snapshot?.id || data.id || '',
    staffId: data.staffId || '',
    ownerUid: data.ownerUid || '',
    staffName: data.staffName || 'Nhân sự Aura',
    branchIds: Array.isArray(data.branchIds) ? data.branchIds : [],
    periodId: data.periodId || '',
    type: data.type || '',
    platform: data.platform || '',
    url: data.url || '',
    screenshotPath: data.screenshotPath || '',
    signedUrl,
    postedAt: data.postedAt || '',
    groupName: data.groupName || '',
    briefId: data.briefId || '',
    title: data.title || '',
    note: data.note || '',
    status: EVIDENCE_STATUSES.has(data.status) ? data.status : 'submitted',
    reviewerId: data.reviewerId || '',
    reviewedAt: iso(data.reviewedAt),
    reviewReason: data.reviewReason || '',
    violationCodes: Array.isArray(data.violationCodes) ? data.violationCodes : [],
    checklist: data.checklist && typeof data.checklist === 'object' ? data.checklist : {},
    submittedAt: iso(data.submittedAt || data.createdAt),
    updatedAt: iso(data.updatedAt),
  }
}

function performanceSummary(evidence, locked = false) {
  const brand = calculateBrandPerformance(evidence)
  const pendingCount = evidence.filter((item) => ['submitted', 'needs_revision'].includes(item.status)).length
  return {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    formulaVersion: PERFORMANCE_POLICY_VERSION,
    amountImpact: 'none',
    locked,
    coverage: { availableWeight: 10, totalWeight: 100, confidence: 'low' },
    score: { value: null, maximum: 100, reason: 'Các cấu phần ngoài Brand chưa đủ dữ liệu đã xác minh; Aura không mặc định quy đổi thành 0 điểm.' },
    categories: PERFORMANCE_CATEGORIES.map((category) => category.id === 'brand'
      ? { ...category, score: brand.total, status: 'available' }
      : { ...category, score: null, status: 'not_available' }),
    brand,
    evidence: {
      total: evidence.filter((item) => item.type !== 'profile_checklist' && item.status !== 'withdrawn').length,
      pending: pendingCount,
      approved: evidence.filter((item) => item.status === 'approved' && item.type !== 'profile_checklist').length,
    },
  }
}

function canReview(actor) {
  return ['admin', 'super_admin'].includes(actor.accessRole) || actor.positions.includes('branch_manager') || actor.capabilities.includes('performance.evidence.review')
}

function assertReviewer(actor) {
  if (!canReview(actor)) throw new HttpsError('permission-denied', 'Bạn không có quyền duyệt bằng chứng hiệu suất.')
}

function assertBranchScope(actor, branchIds) {
  if (['admin', 'super_admin'].includes(actor.accessRole)) return
  const target = Array.isArray(branchIds) ? branchIds.filter(Boolean) : []
  if (!target.length || !target.some((branchId) => actor.branchIds.includes(branchId))) {
    throw new HttpsError('permission-denied', 'Bạn chỉ được duyệt bằng chứng của nhân sự cùng chi nhánh.')
  }
}

async function signedEvidenceUrl(storage, path) {
  if (!storage || !path) return ''
  try {
    const [url] = await storage.bucket().file(path).getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1_000 })
    return url
  } catch { return '' }
}

async function assertScreenshot(storage, { path, ownerUid, period, evidenceId }) {
  if (!path) return
  const prefix = `performance-evidence/${ownerUid}/${period}/${evidenceId}/`
  if (!path.startsWith(prefix) || path.length > 600) throw new HttpsError('invalid-argument', 'Đường dẫn ảnh bằng chứng không thuộc đúng nhân sự, kỳ và hồ sơ.')
  if (!storage) throw new HttpsError('failed-precondition', 'Kho ảnh bằng chứng chưa sẵn sàng.')
  try {
    const [metadata] = await storage.bucket().file(path).getMetadata()
    const custom = metadata.metadata || {}
    if (custom.ownerUid !== ownerUid || custom.periodId !== period || custom.evidenceId !== evidenceId || custom.resourceKind !== 'performance-evidence') {
      throw new Error('metadata-mismatch')
    }
    if (!/^image\/(jpeg|png|webp)$/.test(metadata.contentType || '') || Number(metadata.size || 0) > 10 * 1024 * 1024) {
      throw new Error('unsupported-file')
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('failed-precondition', 'Ảnh bằng chứng chưa tải xong hoặc metadata không hợp lệ.')
  }
}

async function evidenceForStaff(db, staffId, period) {
  const snapshot = await db.collection('performanceEvidence').where('staffId', '==', staffId).limit(300).get()
  if (snapshot.size === 300) throw new HttpsError('resource-exhausted', 'Kỳ đánh giá có quá nhiều bằng chứng để tổng hợp an toàn.')
  return snapshot.docs.filter((item) => item.data().periodId === period).map((item) => ({ id: item.id, ...item.data() }))
}

async function isSnapshotLocked(db, staffId, period) {
  const snapshot = await db.doc(`performanceSnapshots/${period}_${staffId}`).get()
  return snapshot.exists && snapshot.data().locked === true
}

async function rebuildBrandSnapshot(db, staffId, period, actorUid = 'system:performance-score') {
  const reference = db.doc(`performanceSnapshots/${period}_${staffId}`)
  const existing = await reference.get()
  if (existing.exists && existing.data().locked === true) return existing.data()
  const evidence = await evidenceForStaff(db, staffId, period)
  const summary = performanceSummary(evidence, false)
  const value = {
    ...summary,
    staffId,
    periodId: period,
    brand: summary.brand,
    generatedAt: FieldValue.serverTimestamp(),
    generatedBy: actorUid,
  }
  await reference.set(value, { merge: true })
  return value
}

async function targetStaff(db, staffId) {
  const direct = await db.doc(`roleAssignments/${staffId}`).get()
  let assignmentSnapshot = direct.exists ? direct : null
  if (!assignmentSnapshot) {
    const lookup = await db.collection('roleAssignments').where('crmProfileId', '==', staffId).limit(2).get()
    if (lookup.size > 1) throw new HttpsError('failed-precondition', 'Hồ sơ nhân sự đang liên kết nhiều tài khoản, cần đối soát danh tính.')
    assignmentSnapshot = lookup.docs[0] || null
  }
  if (!assignmentSnapshot || assignmentSnapshot.data().accessRole !== 'staff' || assignmentSnapshot.data().status !== 'active') {
    throw new HttpsError('not-found', 'Không tìm thấy nhân sự đang hoạt động.')
  }
  const assignment = assignmentSnapshot.data()
  const operationalId = assignment.crmProfileId || assignmentSnapshot.id
  const [user, trainer] = await Promise.all([
    db.doc(`users/${assignmentSnapshot.id}`).get(),
    db.doc(`trainers/${operationalId}`).get(),
  ])
  return {
    staffId: operationalId,
    ownerUid: assignmentSnapshot.id,
    name: user.data()?.displayName || user.data()?.name || trainer.data()?.name || 'Nhân sự Aura',
    branchIds: Array.isArray(assignment.branchIds) && assignment.branchIds.length
      ? assignment.branchIds
      : [trainer.data()?.branchId || user.data()?.branchId].filter(Boolean),
    positions: Array.isArray(assignment.positions) ? assignment.positions : [],
  }
}

async function staffDirectory(db, actor) {
  const snapshot = await db.collection('roleAssignments').where('accessRole', '==', 'staff').limit(300).get()
  const candidates = snapshot.docs.filter((item) => {
    const data = item.data()
    if (data.status !== 'active' || !Array.isArray(data.positions) || !data.positions.includes('trainer_pt')) return false
    if (['admin', 'super_admin'].includes(actor.accessRole)) return true
    return Array.isArray(data.branchIds) && data.branchIds.some((branchId) => actor.branchIds.includes(branchId))
  })
  const userSnapshots = candidates.length ? await db.getAll(...candidates.map((item) => db.doc(`users/${item.id}`))) : []
  const userById = new Map(userSnapshots.map((item) => [item.id, item.data() || {}]))
  return candidates.map((item) => {
    const assignment = item.data()
    const user = userById.get(item.id) || {}
    return {
      staffId: assignment.crmProfileId || item.id,
      ownerUid: item.id,
      name: user.displayName || user.name || 'Nhân sự Aura',
      branchIds: Array.isArray(assignment.branchIds) ? assignment.branchIds : [],
    }
  }).sort((left, right) => left.name.localeCompare(right.name, 'vi'))
}

function createPerformanceScoreFunctions({ db, onCall, storage, logger = console }) {
  const performanceCall = (handler) => onCall({
    cpu: 'gcf_gen1', memory: '256MiB', maxInstances: 1, concurrency: 1, timeoutSeconds: 120,
  }, handler)

  const getMyPerformanceScore = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    if (actor.accessRole !== 'staff') throw new HttpsError('permission-denied', 'Aura Performance Score hiện dành cho tài khoản nhân sự.')
    requireCapability(actor, 'performance.self.view')
    const period = periodId(request.data?.periodId)
    const staffId = documentId(actor.legacyStaffId || actor.uid, 'Mã nhân sự')
    const evidence = await evidenceForStaff(db, staffId, period)
    return { staffId, periodId: period, ...performanceSummary(evidence, await isSnapshotLocked(db, staffId, period)) }
  })

  const listMyPerformanceEvidence = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    if (actor.accessRole !== 'staff') throw new HttpsError('permission-denied', 'Aura Performance Score hiện dành cho tài khoản nhân sự.')
    requireCapability(actor, 'performance.self.view')
    const period = periodId(request.data?.periodId)
    const staffId = documentId(actor.legacyStaffId || actor.uid, 'Mã nhân sự')
    const evidence = await evidenceForStaff(db, staffId, period)
    const rows = await Promise.all(evidence.sort((left, right) => iso(right.submittedAt).localeCompare(iso(left.submittedAt))).map(async (item) => (
      serializeEvidence(item, await signedEvidenceUrl(storage, item.screenshotPath))
    )))
    return { periodId: period, rows }
  })

  const submitPerformanceBrandEvidence = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    if (actor.accessRole !== 'staff') throw new HttpsError('permission-denied', 'Chỉ nhân sự Aura được gửi bằng chứng của chính mình.')
    requireCapability(actor, 'performance.evidence.submit')
    const period = periodId(request.data?.periodId)
    const evidenceId = documentId(request.data?.evidenceId, 'Mã bằng chứng')
    const type = boundedText(request.data?.type, 'Loại bằng chứng', 40, true)
    if (!EVIDENCE_TYPES.has(type)) throw new HttpsError('invalid-argument', 'Loại bằng chứng Brand không hợp lệ.')
    const platform = boundedText(request.data?.platform, 'Nền tảng', 30)
    if (platform && !PLATFORMS.has(platform)) throw new HttpsError('invalid-argument', 'Nền tảng đăng bài không hợp lệ.')
    const url = normalizeUrl(request.data?.url)
    const screenshotPath = boundedText(request.data?.screenshotPath, 'Ảnh bằng chứng', 600)
    const contentHash = normalizeContentHash(request.data?.contentHash)
    if (!url && !screenshotPath) throw new HttpsError('invalid-argument', 'Cần gửi link bài đăng hoặc ảnh chụp màn hình làm bằng chứng.')
    if (screenshotPath && !contentHash) throw new HttpsError('invalid-argument', 'Ảnh bằng chứng cần mã kiểm tra nội dung để chống ghi nhận trùng.')
    const postedAt = dateKey(request.data?.postedAt)
    if (!postedAt.startsWith(`${period}-`)) throw new HttpsError('invalid-argument', 'Ngày đăng hoặc ngày hoàn thành nhiệm vụ phải thuộc kỳ đang đánh giá.')
    const groupName = boundedText(request.data?.groupName, 'Trang cá nhân hoặc hội nhóm', 160)
    const briefId = boundedText(request.data?.briefId, 'Mã brief', 120)
    if (type === 'aura_assignment' && !briefId) throw new HttpsError('invalid-argument', 'Nhiệm vụ Aura Brand cần mã brief, campaign, event hoặc workshop.')
    const title = boundedText(request.data?.title, 'Nội dung bằng chứng', 200, true)
    const note = boundedText(request.data?.note, 'Ghi chú', 500)
    const staffId = documentId(actor.legacyStaffId || actor.uid, 'Mã nhân sự')
    if (await isSnapshotLocked(db, staffId, period)) throw new HttpsError('failed-precondition', 'Kỳ đánh giá đã khóa, không thể bổ sung bằng chứng hồi tố.')
    await assertScreenshot(storage, { path: screenshotPath, ownerUid: actor.uid, period, evidenceId })
    const duplicateKey = proofKey({ type, url, contentHash, briefId, screenshotPath })
    const evidenceReference = db.doc(`performanceEvidence/${evidenceId}`)
    const dedupeReference = db.doc(`performanceEvidenceDedupe/${staffId}_${period.replace('-', '')}_${duplicateKey.slice(0, 32)}`)
    try {
      await db.runTransaction(async (transaction) => {
        const [existing, duplicate] = await Promise.all([transaction.get(evidenceReference), transaction.get(dedupeReference)])
        if (existing.exists) {
          const data = existing.data()
          if (data.ownerUid === actor.uid && data.duplicateKey === duplicateKey) return
          throw new HttpsError('already-exists', 'Mã bằng chứng đã được sử dụng.')
        }
        if (duplicate.exists) throw new HttpsError('already-exists', 'Nội dung này đã được gửi trong kỳ. Một nội dung đăng lại nhiều nơi chỉ được tính một asset.')
        const data = {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION,
        formulaVersion: PERFORMANCE_POLICY_VERSION,
        staffId,
        ownerUid: actor.uid,
        staffName: actor.actorName,
        branchIds: actor.branchIds,
        periodId: period,
        type,
        platform,
        url,
        screenshotPath,
        contentHash,
        duplicateKey,
        postedAt,
        groupName,
        briefId,
        title,
        note,
        status: 'submitted',
        amountImpact: 'none',
        submittedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        }
        transaction.create(evidenceReference, data)
        transaction.create(dedupeReference, { staffId, periodId: period, evidenceId, duplicateKey, createdAt: FieldValue.serverTimestamp() })
        transaction.create(db.collection('performanceAuditLogs').doc(), {
          schemaVersion: PERFORMANCE_SCHEMA_VERSION,
          action: 'performance.evidence.submitted', actorUid: actor.uid, staffId, periodId: period, evidenceId,
          createdAt: FieldValue.serverTimestamp(),
        })
      })
    } catch (error) {
      // The screenshot is uploaded before the callable so Storage Rules can
      // verify ownership. Remove only the just-uploaded orphan when the
      // Firestore evidence transaction is rejected.
      if (screenshotPath && storage) await storage.bucket().file(screenshotPath).delete({ ignoreNotFound: true }).catch(() => undefined)
      throw error
    }
    await rebuildBrandSnapshot(db, staffId, period, actor.uid)
    logger.info?.('performance_evidence_submitted', { evidenceId, staffId, periodId: period, type })
    return { evidenceId, status: 'submitted' }
  })

  const withdrawPerformanceBrandEvidence = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'performance.evidence.submit')
    const evidenceId = documentId(request.data?.evidenceId, 'Mã bằng chứng')
    const reference = db.doc(`performanceEvidence/${evidenceId}`)
    let changed = false
    let staffId = ''
    let period = ''
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy bằng chứng.')
      const data = snapshot.data()
      staffId = data.staffId
      period = data.periodId
      if (data.ownerUid !== actor.uid) throw new HttpsError('permission-denied', 'Bạn chỉ được rút bằng chứng của chính mình.')
      if (data.status === 'withdrawn') return
      if (!['submitted', 'needs_revision'].includes(data.status)) throw new HttpsError('failed-precondition', 'Bằng chứng đã duyệt hoặc từ chối không thể rút.')
      const lock = await transaction.get(db.doc(`performanceSnapshots/${period}_${staffId}`))
      if (lock.exists && lock.data().locked === true) throw new HttpsError('failed-precondition', 'Kỳ đánh giá đã khóa.')
      transaction.update(reference, { status: 'withdrawn', withdrawnAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(db.collection('performanceAuditLogs').doc(), {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION, action: 'performance.evidence.withdrawn', actorUid: actor.uid,
        staffId, periodId: period, evidenceId, createdAt: FieldValue.serverTimestamp(),
      })
      changed = true
    })
    if (changed) await rebuildBrandSnapshot(db, staffId, period, actor.uid)
    return { evidenceId, status: 'withdrawn', unchanged: !changed }
  })

  const listPerformanceReviewQueue = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    assertReviewer(actor)
    const period = periodId(request.data?.periodId)
    const requestedBranch = boundedText(request.data?.branchId, 'Chi nhánh', 200)
    if (requestedBranch && !['admin', 'super_admin'].includes(actor.accessRole) && !actor.branchIds.includes(requestedBranch)) {
      throw new HttpsError('permission-denied', 'Bạn không có quyền xem chi nhánh này.')
    }
    const status = boundedText(request.data?.status, 'Trạng thái', 30)
    if (status && !EVIDENCE_STATUSES.has(status)) throw new HttpsError('invalid-argument', 'Trạng thái bằng chứng không hợp lệ.')
    const type = boundedText(request.data?.type, 'Loại bằng chứng', 40)
    if (type && !new Set([...EVIDENCE_TYPES, 'profile_checklist']).has(type)) throw new HttpsError('invalid-argument', 'Loại bằng chứng không hợp lệ.')
    const snapshot = await db.collection('performanceEvidence').where('periodId', '==', period).limit(201).get()
    if (snapshot.size > 200) throw new HttpsError('resource-exhausted', 'Hàng chờ kỳ này vượt 200 hồ sơ; hãy lọc theo chi nhánh hoặc trạng thái.')
    const filtered = snapshot.docs.filter((item) => {
      const data = item.data()
      const branches = Array.isArray(data.branchIds) ? data.branchIds : []
      if (!['admin', 'super_admin'].includes(actor.accessRole) && !branches.some((branchId) => actor.branchIds.includes(branchId))) return false
      if (requestedBranch && !branches.includes(requestedBranch)) return false
      if (status && data.status !== status) return false
      if (type && data.type !== type) return false
      return data.status !== 'withdrawn'
    })
    const profileDocuments = snapshot.docs.filter((item) => {
      const data = item.data()
      const branches = Array.isArray(data.branchIds) ? data.branchIds : []
      if (data.type !== 'profile_checklist' || data.status !== 'approved') return false
      if (!['admin', 'super_admin'].includes(actor.accessRole) && !branches.some((branchId) => actor.branchIds.includes(branchId))) return false
      if (requestedBranch && !branches.includes(requestedBranch)) return false
      return true
    })
    const rows = await Promise.all(filtered.sort((left, right) => iso(right.data().submittedAt).localeCompare(iso(left.data().submittedAt))).map(async (item) => (
      serializeEvidence(item, await signedEvidenceUrl(storage, item.data().screenshotPath))
    )))
    const directory = await staffDirectory(db, actor)
    return {
      periodId: period,
      rows,
      profiles: profileDocuments.map((item) => serializeEvidence(item)),
      staff: directory,
      truncated: false,
    }
  })

  const reviewPerformanceBrandEvidence = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    assertReviewer(actor)
    const evidenceId = documentId(request.data?.evidenceId, 'Mã bằng chứng')
    const decision = boundedText(request.data?.decision, 'Quyết định', 30, true)
    if (!REVIEW_STATUSES.has(decision)) throw new HttpsError('invalid-argument', 'Quyết định duyệt không hợp lệ.')
    const reason = boundedText(request.data?.reason, 'Lý do duyệt', 500, decision !== 'approved')
    if (decision !== 'approved' && reason.length < 3) throw new HttpsError('invalid-argument', 'Cần ghi rõ lý do yêu cầu bổ sung hoặc từ chối.')
    const violationCodes = Array.isArray(request.data?.violationCodes)
      ? [...new Set(request.data.violationCodes.map((item) => boundedText(item, 'Mã vi phạm', 60)).filter(Boolean))].slice(0, 10)
      : []
    const reference = db.doc(`performanceEvidence/${evidenceId}`)
    let staffId = ''
    let period = ''
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy bằng chứng.')
      const data = snapshot.data()
      staffId = data.staffId
      period = data.periodId
      assertBranchScope(actor, data.branchIds)
      if (data.type === 'profile_checklist') throw new HttpsError('failed-precondition', 'Checklist hồ sơ được cập nhật bằng biểu mẫu Profile Quality.')
      if (!['submitted', 'needs_revision', 'approved', 'rejected'].includes(data.status)) throw new HttpsError('failed-precondition', 'Bằng chứng không còn ở trạng thái có thể duyệt.')
      const lock = await transaction.get(db.doc(`performanceSnapshots/${period}_${staffId}`))
      if (lock.exists && lock.data().locked === true) throw new HttpsError('failed-precondition', 'Kỳ đánh giá đã khóa.')
      transaction.update(reference, {
        status: decision, reviewReason: reason, violationCodes, reviewerId: actor.uid,
        reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('performanceAuditLogs').doc(), {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION, action: `performance.evidence.${decision}`,
        actorUid: actor.uid, staffId, periodId: period, evidenceId, beforeStatus: data.status,
        reason, violationCodes, createdAt: FieldValue.serverTimestamp(),
      })
    })
    await rebuildBrandSnapshot(db, staffId, period, actor.uid)
    return { evidenceId, status: decision }
  })

  const savePerformanceProfileChecklist = performanceCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    assertReviewer(actor)
    const period = periodId(request.data?.periodId)
    const staffId = documentId(request.data?.staffId, 'Mã nhân sự')
    const target = await targetStaff(db, staffId)
    assertBranchScope(actor, target.branchIds)
    if (await isSnapshotLocked(db, target.staffId, period)) throw new HttpsError('failed-precondition', 'Kỳ đánh giá đã khóa.')
    const source = request.data?.checklist && typeof request.data.checklist === 'object' ? request.data.checklist : {}
    const checklist = Object.fromEntries(PROFILE_CHECKLIST_KEYS.map((key) => [key, source[key] === true]))
    const reason = boundedText(request.data?.reason, 'Ghi chú Profile Quality', 500)
    const evidenceId = `profile_${period.replace('-', '')}_${target.staffId}`
    const reference = db.doc(`performanceEvidence/${evidenceId}`)
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(reference)
      const revision = Math.max(0, Number(current.data()?.revision || 0)) + 1
      transaction.set(reference, {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION, formulaVersion: PERFORMANCE_POLICY_VERSION,
        staffId: target.staffId, ownerUid: target.ownerUid, staffName: target.name, branchIds: target.branchIds,
        periodId: period, type: 'profile_checklist', status: 'approved', checklist,
        reviewerId: actor.uid, reviewedAt: FieldValue.serverTimestamp(), reviewReason: reason,
        amountImpact: 'none', revision, submittedAt: current.data()?.submittedAt || FieldValue.serverTimestamp(),
        createdAt: current.data()?.createdAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.create(db.collection('performanceAuditLogs').doc(), {
        schemaVersion: PERFORMANCE_SCHEMA_VERSION, action: 'performance.profile_checklist.saved', actorUid: actor.uid,
        staffId: target.staffId, periodId: period, evidenceId, revision, checklist, reason,
        createdAt: FieldValue.serverTimestamp(),
      })
    })
    await rebuildBrandSnapshot(db, target.staffId, period, actor.uid)
    return { evidenceId, completedCount: PROFILE_CHECKLIST_KEYS.filter((key) => checklist[key]).length, status: 'approved' }
  })

  return {
    getMyPerformanceScore,
    listMyPerformanceEvidence,
    submitPerformanceBrandEvidence,
    withdrawPerformanceBrandEvidence,
    listPerformanceReviewQueue,
    reviewPerformanceBrandEvidence,
    savePerformanceProfileChecklist,
  }
}

module.exports = {
  PERFORMANCE_CATEGORIES,
  PROFILE_CHECKLIST_KEYS,
  calculateBrandPerformance,
  normalizeUrl,
  proofKey,
  assertBranchScope,
  createPerformanceScoreFunctions,
}
