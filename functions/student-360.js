const { createHash } = require('node:crypto')
const { FieldPath, FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext } = require('./identity-access')
const { PT_OPERATIONS_POLICY_EFFECTIVE_FROM, PT_OPERATIONS_POLICY_VERSION } = require('./pt-policy')
const { effectiveContractStatus } = require('./contract-status')

const TIME_ZONE = 'Asia/Ho_Chi_Minh'
// Bump the projection schema when account-link resolution changes. Existing
// cached views are rebuilt lazily on the next read, so old data is never
// overwritten by a client-side migration.
const OVERVIEW_SCHEMA_VERSION = 2
const HEALTH_FORMULA_VERSION = 'student-health-v1'
// Canonical write triggers keep active students fresh. A long fallback TTL
// prevents an unchanged profile from re-reading every history collection each
// time Staff opens it, while the scheduled reconciler repairs missed triggers.
const PROJECTION_MAX_AGE_MS = 24 * 60 * 60 * 1000
const ACTIVE_CONTRACT_STATUSES = new Set(['active', 'future', 'frozen'])
const ACTIVE_SESSION_STATUSES = new Set(['scheduled', 'rescheduled', 'attended', 'completed'])
const TERMINAL_ATTENDANCE = new Set(['present', 'late', 'no_show', 'policy_charge'])

function finite(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function timelineCursor(value) {
  if (value === null || value === undefined || value === '') return Number.MAX_SAFE_INTEGER
  return finite(value, Number.MAX_SAFE_INTEGER)
}

function bounded(value, maximum = 300, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : fallback
}

function normalizedArray(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))] : []
}

function timestampMillis(value) {
  if (!value) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  if (value instanceof Date) return value.getTime()
  return 0
}

function iso(value) {
  const millis = timestampMillis(value)
  return millis ? new Date(millis).toISOString() : null
}

function vietnamDateKey(reference = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(reference)
  const part = (type) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function dateKeyMillis(value) {
  const normalized = bounded(value, 10)
  const parsed = Date.parse(`${normalized}T12:00:00+07:00`)
  return Number.isFinite(parsed) ? parsed : 0
}

function sessionDateTimeMillis(dateValue, hourValue) {
  const date = bounded(dateValue, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0
  if (hourValue === null || hourValue === undefined || hourValue === '') return dateKeyMillis(date)

  const match = String(hourValue).trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/)
  if (!match) return dateKeyMillis(date)
  const hour = Math.max(0, Math.min(23, Number(match[1])))
  const minute = Math.max(0, Math.min(59, Number(match[2] || 0)))
  const parsed = Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`)
  return Number.isFinite(parsed) ? parsed : dateKeyMillis(date)
}

function addDays(value, amount) {
  const millis = dateKeyMillis(value)
  return vietnamDateKey(new Date(millis + amount * 86_400_000))
}

function mondayDateKey(reference = new Date()) {
  const current = vietnamDateKey(reference)
  const date = new Date(`${current}T12:00:00+07:00`)
  const day = date.getUTCDay()
  return addDays(current, -(day === 0 ? 6 : day - 1))
}

function daysBetween(from, to) {
  const left = dateKeyMillis(from)
  const right = dateKeyMillis(to)
  return left && right ? Math.ceil((right - left) / 86_400_000) : 0
}

function documentId(value, label = 'Mã học viên') {
  const normalized = bounded(value, 200)
  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return normalized
}

const PROGRESS_MEASUREMENT_LIMITS = {
  weightKg: [25, 300],
  bodyFatPercentage: [2, 70],
  muscleMassKg: [5, 150],
  waistCm: [30, 200],
  hipsCm: [40, 220],
  thighCm: [20, 120],
  armCm: [10, 80],
  chestCm: [40, 220],
}

function normalizeProgressCheckInInput(value = {}) {
  const input = value && typeof value === 'object' ? value : {}
  const id = bounded(input.id || input.checkInId, 120)
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(id)) throw new HttpsError('invalid-argument', 'Mã lần ghi nhận không hợp lệ.')
  const date = bounded(input.date, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > vietnamDateKey()) {
    throw new HttpsError('invalid-argument', 'Ngày ghi nhận không hợp lệ hoặc đang ở tương lai.')
  }
  const measurements = {}
  for (const [key, [minimum, maximum]] of Object.entries(PROGRESS_MEASUREMENT_LIMITS)) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue
    const number = Number(String(input[key]).replace(',', '.'))
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
      throw new HttpsError('invalid-argument', `${key} cần nằm trong khoảng ${minimum}–${maximum}.`)
    }
    measurements[key] = Number(number.toFixed(1))
  }
  const photosProvided = Array.isArray(input.photos)
  if (photosProvided && input.photos.length > 4) throw new HttpsError('invalid-argument', 'Mỗi lần ghi nhận hỗ trợ tối đa 4 góc ảnh.')
  const photos = photosProvided ? input.photos.slice(0, 4).map((photo, index) => {
    const item = photo && typeof photo === 'object' ? photo : {}
    const photoId = bounded(item.id, 120)
    const angle = bounded(item.angle, 20)
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(photoId)) throw new HttpsError('invalid-argument', `Mã ảnh thứ ${index + 1} không hợp lệ.`)
    if (!['front', 'back', 'left', 'right'].includes(angle)) throw new HttpsError('invalid-argument', 'Góc ảnh tiến độ không hợp lệ.')
    const imageUrl = typeof (item.imageUrl || item.url) === 'string' ? String(item.imageUrl || item.url).trim() : ''
    // The browser resizes photos before encoding them. Keep a generous per
    // image ceiling while rejecting silently truncated callable payloads.
    if (imageUrl.length > 1_500_000) throw new HttpsError('invalid-argument', 'Ảnh tiến độ sau khi tối ưu vẫn quá lớn. Hãy chọn ảnh khác.')
    if (!imageUrl.startsWith('data:image/')) throw new HttpsError('invalid-argument', 'Ảnh nhân sự cập nhật phải được chọn từ thiết bị.')
    return { id: photoId, angle, imageUrl }
  }) : null
  if (photos && new Set(photos.map((photo) => photo.angle)).size !== photos.length) {
    throw new HttpsError('invalid-argument', 'Mỗi góc ảnh chỉ được ghi nhận một lần.')
  }
  if (!Object.keys(measurements).length && !photos?.length) {
    throw new HttpsError('invalid-argument', 'Hãy thêm ít nhất một ảnh hoặc một chỉ số trước khi lưu.')
  }
  const measurementNote = bounded(input.measurementNote || input.note, 240)
  return { id, date, measurements, measurementNote, photos, photosProvided }
}

function decodeProgressPhotoDataUrl(value) {
  const match = String(value || '').match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i)
  if (!match) throw new HttpsError('invalid-argument', 'Ảnh tiến độ không đúng định dạng JPG, PNG hoặc WebP.')
  const contentType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new HttpsError('invalid-argument', 'Ảnh tiến độ phải nhỏ hơn 10MB sau khi tối ưu.')
  return { buffer, contentType }
}

async function persistProgressPhotoForStaff(storage, accountUid, photo, checkInId, actor) {
  if (!storage) throw new HttpsError('failed-precondition', 'Kho ảnh tiến độ chưa sẵn sàng.')
  const { buffer, contentType } = decodeProgressPhotoDataUrl(photo.imageUrl)
  const checksum = createHash('sha256').update(buffer).digest('hex')
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
  const storagePath = `users/${accountUid}/progress-photos/${photo.id}-${checksum.slice(0, 16)}.${extension}`
  const file = storage.bucket().file(storagePath)
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      metadata: {
        ownerUid: accountUid,
        resourceKind: 'progress-photo',
        uploadedBy: actor.uid,
        checkInId,
        angle: photo.angle,
        checksum,
      },
    },
  })
  return { id: photo.id, angle: photo.angle, imageUrl: '', storagePath, checksum }
}

function sessionDate(session = {}) {
  return bounded(session.date || session.sessionDate || session.occurredDate, 10)
}

function sessionAttendance(session = {}) {
  const attendance = bounded(session.attendanceStatus || session.attendance || session.status, 40).toLowerCase()
  if (attendance === 'attended' || attendance === 'completed') return 'present'
  return attendance
}

function sessionCharged(session = {}) {
  const billing = bounded(session.billingStatus, 40).toLowerCase()
  if (billing) return billing === 'charged'
  return ['attended', 'completed', 'no_show', 'policy_charge'].includes(bounded(session.status, 40).toLowerCase())
}

function contractUsage(contract = {}, sessions = []) {
  const linked = sessions.filter((session) => session.contractId === contract.id)
  const chargedSessions = linked.filter(sessionCharged).length
  const exemptSessions = linked.filter((session) => bounded(session.billingStatus, 40).toLowerCase() === 'exempt').length
  const pendingReconciliationSessions = linked.filter((session) => bounded(session.billingStatus, 40).toLowerCase() === 'review_required').length
  const storedUsedSessions = Math.max(0, Math.floor(finite(contract.usedSessions)))
  const legacyProjectionAdjustment = Math.max(0, storedUsedSessions - chargedSessions)
  const usedSessions = chargedSessions + legacyProjectionAdjustment
  const totalSessions = Math.max(0, Math.floor(finite(contract.totalSessions)))
  const projectionDelta = storedUsedSessions - chargedSessions
  const reconciliationStatus = usedSessions > totalSessions
    ? 'over_entitlement'
    : projectionDelta > 0
      ? 'legacy_projection'
      : projectionDelta < 0
        ? 'projection_behind'
        : 'matched'
  return {
    totalSessions,
    storedUsedSessions,
    chargedSessions,
    exemptSessions,
    pendingReconciliationSessions,
    usedSessions,
    remainingSessions: Math.max(0, totalSessions - usedSessions),
    legacyProjectionAdjustment,
    projectionDelta,
    reconciliationStatus,
  }
}

function activeContract(contracts, today) {
  const ranked = [...contracts].sort((left, right) => bounded(right.startDate, 10).localeCompare(bounded(left.startDate, 10)))
  return ranked.find((item) => effectiveContractStatus(item, today) === 'active')
    || ranked.find((item) => effectiveContractStatus(item, today) === 'frozen')
    || ranked.filter((item) => effectiveContractStatus(item, today) === 'future')
      .sort((left, right) => bounded(left.startDate, 10).localeCompare(bounded(right.startDate, 10)))[0]
    || ranked[0]
    || null
}

function paymentProjection(contract, today) {
  if (!contract) return null
  const total = Math.max(0, finite(contract.totalPrice) - finite(contract.discount))
  const paid = Math.max(0, finite(contract.paidAmount))
  const outstanding = Math.max(0, total - paid)
  const nextPaymentDate = bounded(contract.nextPaymentDate, 10) || null
  const status = outstanding <= 0 ? 'paid' : nextPaymentDate && nextPaymentDate < today ? 'overdue' : 'due'
  return { status, total, paid, outstanding, nextPaymentDate }
}

// During the progress migration the same measurement can be present in both
// the legacy and canonical collections (or once in profile.history and once
// in a collection). Normalize and collapse those mirrors before calculating
// summaries and timeline events so a single check-in is counted once.
function uniqueProgressDocuments(documents = []) {
  const unique = new Map()
  documents.forEach((item, index) => {
    const raw = typeof item?.data === 'function' ? item.data() : item || {}
    const value = { id: bounded(item?.id || raw.id, 120), ...raw }
    const date = bounded(value.date || value.recordedAt || value.createdAt, 32)
      || (iso(value.createdAt) || '').slice(0, 10)
    const weight = value.weightKg ?? value.weight ?? ''
    const waist = value.waistCm ?? value.waist ?? ''
    const bodyFat = value.bodyFatPercentage ?? value.bodyFatPercent ?? value.body_fat ?? value.bodyFat ?? ''
    const explicitId = bounded(value.id, 120)
    const checkInId = bounded(value.checkInId || (/^checkin-/.test(explicitId) ? explicitId : ''), 120)
    const hasMeasurement = [weight, waist, bodyFat].some((entry) => entry !== '' && entry !== null && entry !== undefined)
    const key = checkInId ? `checkin:${checkInId}` : hasMeasurement ? `${date}|${weight}|${waist}|${bodyFat}` : explicitId
    // Later sources are preferred: canonical collections are appended after
    // legacy collections by projectionSources().
    const current = unique.get(key || `progress-${index}`) || {}
    unique.set(key || `progress-${index}`, {
      ...current,
      ...value,
      id: checkInId || explicitId || current.id || `progress-${index}`,
      checkInId: checkInId || current.checkInId || null,
      date: date || current.date || '',
      ...(bodyFat !== '' && bodyFat !== null && bodyFat !== undefined ? { bodyFatPercentage: bodyFat } : {}),
    })
  })
  return [...unique.values()]
}

function uniqueProgressPhotos(documents = []) {
  const unique = new Map()
  documents.forEach((item, index) => {
    const raw = typeof item?.data === 'function' ? item.data() : item || {}
    const value = { id: bounded(item?.id || raw.id, 120), ...raw }
    const date = bounded(value.date || value.createdAt || value.updatedAt, 32)
      || (iso(value.createdAt || value.updatedAt) || '').slice(0, 10)
    const explicitId = bounded(value.id, 120)
    const checkInId = bounded(value.checkInId || (/^checkin-/.test(explicitId) ? explicitId.replace(/-(front|back|left|right)$/, '') : ''), 120)
    const key = checkInId ? `checkin:${checkInId}` : explicitId || `${date}|${value.checksum || value.storagePath || ''}|${index}`
    const candidates = Array.isArray(value.photos) ? value.photos
      : Array.isArray(value.images) ? value.images
        : value.storagePath ? [{ storagePath: value.storagePath, angle: value.angle }]
          : value.imageUrl ? [{ url: value.imageUrl, angle: value.angle }] : []
    const current = unique.get(key) || { images: [] }
    const mergedImages = [...(Array.isArray(current.images) ? current.images : []), ...candidates]
    const seen = new Set()
    const images = mergedImages.filter((candidate) => {
      const image = typeof candidate === 'string' ? { url: candidate } : candidate || {}
      const imageKey = bounded(image.storagePath || image.url || image.imageUrl || image.id || image.angle, 2_000)
      if (!imageKey || seen.has(imageKey)) return false
      seen.add(imageKey)
      return true
    })
    unique.set(key, {
      ...current,
      ...value,
      id: checkInId || explicitId || current.id || `progress-photo-${index}`,
      checkInId: checkInId || current.checkInId || null,
      date: date || current.date || '',
      images,
    })
  })
  return [...unique.values()]
}

function scoreComponent(id, label, weight, score, reason, available = true) {
  if (!available || !Number.isFinite(score)) return { id, label, weight, score: null, reason, available: false }
  return { id, label, weight, score: Math.max(0, Math.min(100, Math.round(score))), reason, available: true }
}

function buildHealthScore(input) {
  const components = [
    scoreComponent('attendance', 'Tập đều', 25, input.attendanceScore, input.attendanceReason, input.attendanceScore !== null),
    scoreComponent('training', 'Hoàn thành lịch tập', 20, input.trainingScore, input.trainingReason, input.trainingScore !== null),
    scoreComponent('nutrition', 'Dinh dưỡng', 15, input.nutritionScore, input.nutritionReason, input.nutritionScore !== null),
    scoreComponent('progress', 'Tiến độ cơ thể', 15, input.progressScore, input.progressReason, input.progressScore !== null),
    scoreComponent('engagement', 'Tương tác', 10, input.engagementScore, input.engagementReason, input.engagementScore !== null),
    scoreComponent('payment', 'Thanh toán', 5, input.paymentScore, input.paymentReason, input.paymentScore !== null),
    scoreComponent('renewal', 'Sẵn sàng gia hạn', 10, input.renewalScore, input.renewalReason, input.renewalScore !== null),
  ]
  const available = components.filter((item) => item.available)
  const observedWeight = available.reduce((sum, item) => sum + item.weight, 0)
  const score = observedWeight
    ? Math.round(available.reduce((sum, item) => sum + item.score * item.weight, 0) / observedWeight)
    : 0
  return {
    score,
    status: score >= 80 ? 'stable' : score >= 60 ? 'attention' : 'action_required',
    confidence: observedWeight >= 80 ? 'high' : observedWeight >= 55 ? 'medium' : 'low',
    observedWeight,
    components,
  }
}

function alert(id, severity, title, message, action, audience = 'operations') {
  return { id, severity, title, message, action, audience }
}

function sortAlerts(values) {
  const rank = { red: 0, amber: 1, green: 2 }
  return values.sort((left, right) => rank[left.severity] - rank[right.severity] || left.title.localeCompare(right.title, 'vi'))
}

function eventId(studentId, type, sourceId) {
  const digest = createHash('sha256').update(`${studentId}:${type}:${sourceId}`).digest('hex').slice(0, 24)
  return `${studentId}_${digest}`
}

const TIMELINE_GROUPS = {
  contract: { group: 'contract', label: 'Hợp đồng' },
  off: { group: 'contract', label: 'Hợp đồng' },
  freeze: { group: 'contract', label: 'Hợp đồng' },
  schedule_change: { group: 'contract', label: 'Đổi / hủy lịch' },
  finance: { group: 'payment', label: 'Thanh toán' },
  training: { group: 'training', label: 'Buổi tập' },
  workout: { group: 'training', label: 'Nhật ký tập' },
  nutrition: { group: 'nutrition', label: 'Dinh dưỡng' },
  care: { group: 'care', label: 'Chăm sóc' },
  checkin: { group: 'checkin', label: 'Check-in' },
  renewal: { group: 'renewal', label: 'Gia hạn' },
  progress: { group: 'progress', label: 'Tiến độ' },
}

const TIMELINE_SOURCE_LABELS = {
  contracts: 'Hợp đồng',
  contractAuditLogs: 'Audit hợp đồng',
  sessions: 'Lịch buổi tập',
  workoutLogs: 'Nhật ký tập',
  leaveRequests: 'Yêu cầu OFF / bảo lưu',
  sessionRequests: 'Yêu cầu đổi / hủy lịch',
  mealLogs: 'Nhật ký bữa ăn',
  mealReviews: 'Duyệt dinh dưỡng',
  dailyCheckins: 'Check-in hằng ngày',
  payments: 'Phiếu thu cũ',
  ledgerEntries: 'Sổ cái tài chính',
  contractRenewalCases: 'Hồ sơ gia hạn',
  bodyMetrics: 'Số đo cơ thể',
  progressPhotos: 'Ảnh tiến độ',
  progressCheckIns: 'Ghi nhận tiến độ',
  studentCareActivities: 'Nhật ký chăm sóc',
  studentTimelineEvents: 'CRM Timeline',
}

function timelineSource(type, sourceId, explicitSource) {
  if (explicitSource) return explicitSource
  const value = String(sourceId || '')
  if (value.startsWith('finance_ledger:')) return 'ledgerEntries'
  if (value.startsWith('legacy_payment:')) return 'payments'
  if (value.startsWith('meal-review:')) return 'mealReviews'
  if (value.startsWith('progress-photo:')) return 'progressPhotos'
  if (type === 'contract') return 'contracts'
  if (type === 'training') return 'sessions'
  if (type === 'workout') return 'workoutLogs'
  if (type === 'off' || type === 'freeze') return 'leaveRequests'
  if (type === 'schedule_change') return 'sessionRequests'
  if (type === 'nutrition') return 'mealLogs'
  if (type === 'checkin') return 'dailyCheckins'
  if (type === 'renewal') return 'contractRenewalCases'
  if (type === 'progress') return 'bodyMetrics'
  if (type === 'care') return 'studentCareActivities'
  return 'studentTimelineEvents'
}

function timelineDedupeKey(type, sourceId, metadata = {}, occurredAtMillis = 0) {
  const contractId = bounded(metadata.contractId, 200)
  const amount = finite(metadata.amount, 0)
  const date = occurredAtMillis ? new Date(occurredAtMillis).toISOString().slice(0, 16) : ''
  if (type === 'nutrition') {
    // A submitted review uses the same stable id as its meal log. Historical
    // projections created a second `meal-review:*` event; normalizing both to
    // the meal id keeps one activity card while preserving review state.
    const mealId = bounded(metadata.mealId || metadata.reviewId || String(sourceId || '').replace(/^meal-review:/, ''), 200)
    if (mealId) return `nutrition:${mealId}`
  }
  if (type === 'progress') {
    const candidate = bounded(metadata.checkInId || metadata.metricId || metadata.progressPhotoId, 200)
    const checkInId = /^checkin-/.test(candidate) ? candidate.replace(/-(front|back|left|right)$/, '') : ''
    if (checkInId) return `progress:${checkInId}`
  }
  if (type === 'contract' && contractId) {
    // Generic contract snapshots are intentionally a separate key. They can be
    // removed at read time whenever an audited mutation exists for the same HĐ.
    return metadata.action ? `contract:${contractId}:audit:${bounded(metadata.action, 40)}:${date}` : `contract:${contractId}:generic`
  }
  if (type === 'finance' && contractId) {
    const reference = bounded(metadata.referenceCode, 100)
    return reference ? `finance:${contractId}:ref:${reference}` : `finance:${contractId}:${bounded(metadata.status, 30)}:${amount}:${date}`
  }
  const source = bounded(sourceId, 200)
  return `${type}:${source}`
}

function timelinePriority(event) {
  const source = event.sourceCollection || ''
  if (source === 'contractAuditLogs') return 40
  if (source === 'ledgerEntries') return 30
  if (source === 'sessions' || source === 'studentCareActivities') return 25
  if (source === 'mealLogs') return 22
  if (source === 'mealReviews') return 21
  if (source === 'payments') return 20
  if (source === 'contracts') return 10
  return 15
}

function migratedFinanceMatchKey(event) {
  if (event.type !== 'finance') return ''
  const contractId = bounded(event.metadata?.contractId, 200)
  const amount = finite(event.metadata?.amount)
  const occurredAtMillis = finite(event.occurredAtMillis)
  if (!contractId || !amount || !occurredAtMillis) return ''
  return `${contractId}:${amount}:${vietnamDateKey(new Date(occurredAtMillis))}`
}

function normalizeTimelineEvents(events = []) {
  const prepared = events.filter(Boolean).map((event) => {
    const group = TIMELINE_GROUPS[event.type] || { group: event.type, label: event.type }
    const sourceCollection = event.sourceCollection || timelineSource(event.type, event.sourceId, '')
    const dedupeKey = event.dedupeKey || timelineDedupeKey(event.type, event.sourceId, event.metadata, event.occurredAtMillis)
    return { ...event, group: event.group || group.group, groupLabel: event.groupLabel || group.label, sourceCollection, sourceLabel: event.sourceLabel || TIMELINE_SOURCE_LABELS[sourceCollection] || sourceCollection, dedupeKey }
  })

  // Finance ledger migration deliberately mirrors evidenced legacy receipts.
  // Prefer the canonical ledger event, but preserve genuinely distinct same-day
  // receipts by consuming one legacy row for each migrated ledger row.
  const migratedLedgerCounts = new Map()
  prepared.forEach((event) => {
    const migrated = event.type === 'finance'
      && event.sourceCollection === 'ledgerEntries'
      && (/^MIG-/i.test(bounded(event.metadata?.referenceCode, 100)) || /migrated from an evidenced legacy payment record/i.test(event.description || ''))
    const key = migrated ? migratedFinanceMatchKey(event) : ''
    if (key) migratedLedgerCounts.set(key, (migratedLedgerCounts.get(key) || 0) + 1)
  })
  const withoutMigratedLegacyPayments = prepared.filter((event) => {
    // Old materialized rows predate source provenance and therefore identify
    // themselves as studentTimelineEvents instead of payments.
    if (event.type !== 'finance' || event.sourceCollection === 'ledgerEntries') return true
    const key = migratedFinanceMatchKey(event)
    const remaining = key ? migratedLedgerCounts.get(key) || 0 : 0
    if (!remaining) return true
    migratedLedgerCounts.set(key, remaining - 1)
    return false
  })

  // If an audited mutation exists for a contract, the old generic contract
  // snapshot is only a duplicate summary and should never be rendered beside it.
  const auditedContracts = new Set(withoutMigratedLegacyPayments
    .filter((event) => event.type === 'contract' && event.sourceCollection === 'contractAuditLogs')
    .map((event) => bounded(event.metadata?.contractId, 200))
    .filter(Boolean))
  const withoutGenericContracts = withoutMigratedLegacyPayments.filter((event) => {
    if (event.type !== 'contract' || event.sourceCollection !== 'contracts') return true
    const contractId = bounded(event.metadata?.contractId, 200)
    return !auditedContracts.has(contractId)
  })

  const byKey = new Map()
  for (const event of withoutGenericContracts) {
    const current = byKey.get(event.dedupeKey)
    if (!current || timelinePriority(event) > timelinePriority(current) || (timelinePriority(event) === timelinePriority(current) && event.sortKey > current.sortKey)) {
      byKey.set(event.dedupeKey, event)
    }
  }
  return [...byKey.values()].sort((left, right) => right.sortKey - left.sortKey)
}

function timelineEvent(studentId, type, sourceId, occurredAtMillis, title, description, audience = 'operations', metadata = {}, explicitSource = '') {
  const stableMillis = Math.max(1, occurredAtMillis || Date.now())
  const suffix = Number.parseInt(createHash('sha1').update(`${type}:${sourceId}`).digest('hex').slice(0, 3), 16) % 1000
  const group = TIMELINE_GROUPS[type] || { group: type, label: type }
  const sourceCollection = timelineSource(type, sourceId, explicitSource)
  return {
    id: eventId(studentId, type, sourceId),
    schemaVersion: 1,
    studentId,
    type,
    sourceId: bounded(sourceId, 200),
    occurredAt: new Date(stableMillis).toISOString(),
    occurredAtMillis: stableMillis,
    sortKey: stableMillis * 1000 + suffix,
    title: bounded(title, 180),
    description: bounded(description, 500),
    audience,
    metadata,
    group: group.group,
    groupLabel: group.label,
    sourceCollection,
    sourceLabel: TIMELINE_SOURCE_LABELS[sourceCollection] || sourceCollection,
    dedupeKey: timelineDedupeKey(type, sourceId, metadata, stableMillis),
  }
}

function mealTypeLabel(value) {
  const normalized = bounded(value, 80).toLowerCase()
  const labels = { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ' }
  return labels[normalized] || bounded(value, 80) || 'Bữa ăn'
}

function mealReviewId(review = {}) {
  const meal = review.meal && typeof review.meal === 'object' ? review.meal : {}
  return bounded(meal.id || review.mealId || review.id, 200)
}

function mealTimelineMetadata(meal = {}, review = null) {
  const reviewedMeal = review?.meal && typeof review.meal === 'object' ? review.meal : {}
  const totals = meal.totals && typeof meal.totals === 'object'
    ? meal.totals
    : reviewedMeal.totals && typeof reviewedMeal.totals === 'object' ? reviewedMeal.totals : {}
  const source = Object.keys(meal).length ? meal : reviewedMeal
  const mealId = bounded(meal.id || mealReviewId(review || {}), 200)
  const reviewId = bounded(review?.id || meal.reviewId, 200)
  const status = bounded(review?.status || meal.reviewStatus || (meal.status === 'logged' ? 'logged' : ''), 40) || 'logged'
  const calories = Math.max(0, Math.round(finite(source.calories ?? source.totalKcal ?? totals.calories ?? totals.kcal)))
  const protein = Math.max(0, Math.round(finite(source.protein ?? source.totalProtein ?? totals.protein)))
  const storagePath = bounded(source.imageStoragePath || meal.imageStoragePath, 500)
  const legacyImage = bounded(source.image || source.imageUrl || source.img, 2_000)
  return {
    mealId,
    ...(reviewId ? { reviewId } : {}),
    status,
    mealType: mealTypeLabel(source.type || source.mealType || meal.mealType || review?.mealType),
    calories,
    protein,
    hasImage: Boolean(storagePath || legacyImage),
    confidence: bounded(source.confidence || review?.confidence, 30) || null,
  }
}

function mealTimelineCopy(meal = {}, review = null, metadata = mealTimelineMetadata(meal, review)) {
  const reviewedMeal = review?.meal && typeof review.meal === 'object' ? review.meal : {}
  const source = Object.keys(meal).length ? meal : reviewedMeal
  const name = bounded(source.dishName || source.title || source.name || source.mealName || source.description, 180) || metadata.mealType
  const nutrition = [metadata.calories ? `${metadata.calories} kcal` : '', metadata.protein ? `${metadata.protein}g protein` : ''].filter(Boolean)
  return [name, ...nutrition].join(' · ')
}

function mealTimelineTitle(status) {
  if (status === 'approved') return 'Bữa ăn đã được duyệt'
  if (status === 'rejected') return 'Bữa ăn cần điều chỉnh'
  if (status === 'pending') return 'Bữa ăn chờ duyệt'
  return 'Đã ghi nhận bữa ăn'
}

function safeStudentMealImagePath(value, accountUid, mealId) {
  const path = bounded(value, 500)
  if (!path || !accountUid || !mealId || accountUid.includes('/') || mealId.includes('/')) return ''
  const prefix = `users/${accountUid}/meal-photos/${mealId}/`
  return path.startsWith(prefix) && /\/original\.(?:jpe?g|png|webp)$/i.test(path) ? path : ''
}

function legacyMealImageUrl(value) {
  const url = bounded(value, 2_000)
  return /^https:\/\//i.test(url) ? url : ''
}

async function mealImageUrl(storage, storagePath, legacyUrl, logger, context = {}) {
  if (storagePath && storage) {
    try {
      const [url] = await storage.bucket().file(storagePath).getSignedUrl({ action: 'read', expires: Date.now() + 5 * 60 * 1000 })
      return url
    } catch (error) {
      logger.warn('student_360_meal_image_url_failed', { ...context, code: error?.code || 'unknown' })
    }
  }
  return legacyMealImageUrl(legacyUrl)
}

async function hydrateNutritionTimelineMedia({ db, storage, projection, rows, logger = console }) {
  const accountUid = bounded(projection?.accountUid, 200)
  if (!accountUid || accountUid.includes('/')) return rows
  const nutritionRows = rows.filter((item) => item.type === 'nutrition' && item.metadata?.hasImage !== false)
  const mealIds = [...new Set(nutritionRows.map((item) => bounded(item.metadata?.mealId || item.metadata?.reviewId, 200)).filter((id) => /^[A-Za-z0-9_-]+$/.test(id)))]
  if (!mealIds.length) return rows
  const snapshots = await db.getAll(...mealIds.map((mealId) => db.doc(`users/${accountUid}/mealLogs/${mealId}`)))
  const meals = new Map(snapshots.filter((item) => item.exists).map((item) => [item.id, item.data() || {}]))
  const media = new Map()
  await Promise.all(mealIds.map(async (mealId) => {
    const meal = meals.get(mealId)
    if (!meal) return
    const storagePath = safeStudentMealImagePath(meal.imageStoragePath, accountUid, mealId)
    const url = await mealImageUrl(storage, storagePath, meal.image || meal.imageUrl || meal.img, logger, { studentId: projection.studentId, mealId })
    if (url) media.set(mealId, { thumbnailUrl: url, expiresInSeconds: storagePath ? 300 : null })
  }))
  return rows.map((item) => {
    if (item.type !== 'nutrition') return item
    const mealId = bounded(item.metadata?.mealId || item.metadata?.reviewId, 200)
    return media.has(mealId) ? { ...item, media: media.get(mealId) } : item
  })
}

function nutritionActivityDetailRecord(mealId, meal = {}, review = {}, imageUrl = '') {
  const reviewedMeal = review.meal && typeof review.meal === 'object' ? review.meal : {}
  const source = Object.keys(meal).length ? meal : reviewedMeal
  const totals = source.totals && typeof source.totals === 'object' ? source.totals : {}
  const analysis = source.aiAnalysis && typeof source.aiAnalysis === 'object'
    ? source.aiAnalysis
    : review.analysisSnapshot && typeof review.analysisSnapshot === 'object' ? review.analysisSnapshot : {}
  const items = Array.isArray(source.items) ? source.items : Array.isArray(analysis.items) ? analysis.items : []
  const text = (value, maximum = 800) => bounded(value, maximum) || null
  const number = (value) => Math.max(0, Math.round(finite(value) * 10) / 10)
  const imageStoragePath = bounded(source.imageStoragePath, 500)
  return {
    schemaVersion: 1,
    mealId,
    title: bounded(source.dishName || source.title || source.name || source.description, 200) || mealTypeLabel(source.type || source.mealType),
    description: text(source.description || source.portionNote, 1_000),
    date: bounded(source.date || source.mealDate, 10) || null,
    time: bounded(source.time || source.mealTime, 20) || null,
    mealType: mealTypeLabel(source.type || source.mealType || review.mealType),
    calories: number(source.calories ?? source.totalKcal ?? totals.calories ?? totals.kcal),
    protein: number(source.protein ?? source.totalProtein ?? totals.protein),
    carbs: number(source.carbs ?? source.carb ?? source.totalCarb ?? totals.carbs ?? totals.carb),
    fat: number(source.fat ?? source.totalFat ?? totals.fat),
    fiber: number(source.fiber ?? totals.fiber),
    confidence: bounded(source.confidence || review.confidence, 30) || null,
    source: bounded(source.source, 40) || null,
    hasImage: Boolean(imageStoragePath || source.image || source.imageUrl || source.img),
    imageUrl: imageUrl || null,
    imageExpiresInSeconds: imageUrl && imageStoragePath ? 300 : null,
    items: items.slice(0, 30).map((item) => ({
      name: bounded(item?.name || item?.nameVi, 160) || 'Thành phần',
      weight: number(item?.grams ?? item?.estimatedGrams ?? item?.weight),
      calories: number(item?.calories ?? item?.nutrition?.calories ?? item?.kcal),
      protein: number(item?.protein ?? item?.nutrition?.proteinG),
    })),
    analysis: {
      portion: text(analysis.quantityAndCookingAnalysis || analysis.portionAndCalorieRationale),
      goal: text(analysis.goalAlignmentAssessment),
      suggestion: text(analysis.calorieOptimizationTip || analysis.aiSuggestion || analysis.aiFeedback),
      balance: text(analysis.macroBalanceAssessment),
    },
    review: review.id ? {
      id: bounded(review.id, 200),
      status: bounded(review.status, 40) || 'pending',
      coachFeedback: text(review.coachFeedback, 2_000),
      reviewedAt: iso(review.reviewedAt || review.updatedAt),
    } : null,
  }
}

function contractDateKey(value, label) {
  const normalized = bounded(value, 30).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || !dateKeyMillis(normalized)) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return normalized
}

function nonNegativeInteger(value, label, maximum = 1_000_000_000) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0 || result > maximum) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function addCalendarMonths(value, amount) {
  const [year, month, day] = contractDateKey(value, 'Ngày bắt đầu').split('-').map(Number)
  const delta = Math.max(1, Math.min(120, Math.floor(finite(amount, 1))))
  const targetMonth = month - 1 + delta
  const targetYear = year + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

function contractMutationTitle(action) {
  return {
    create: 'Đã tạo hợp đồng',
    edit: 'Đã cập nhật hợp đồng',
    add_sessions: 'Đã mua thêm buổi',
    extend: 'Đã gia hạn ngày hợp đồng',
    freeze: 'Đã bảo lưu hợp đồng',
    reopen: 'Đã mở lại hợp đồng',
    cancel: 'Đã hủy hợp đồng',
  }[action] || 'Đã cập nhật hợp đồng'
}

function contractMutationDescription(action, value = {}) {
  if (action === 'add_sessions') {
    const sessions = Math.max(0, Math.floor(finite(value.extraSessions)))
    const price = Math.max(0, Math.floor(finite(value.extraPrice)))
    return `Bổ sung ${sessions} buổi${price ? ` · phát sinh ${price.toLocaleString('vi-VN')}đ` : ''}${value.endDate ? ` · hạn mới ${bounded(value.endDate, 10)}` : ''}`
  }
  if (action === 'extend') return `Gia hạn đến ${bounded(value.endDate, 10)}`
  if (action === 'freeze') return 'Tạm dừng nhận lịch mới; quyền lợi và lịch sử vẫn được giữ.'
  if (action === 'reopen') return `Mở lại hiệu lực đến ${bounded(value.endDate, 10)}`
  if (action === 'cancel') return bounded(value.reason, 300) || 'Hợp đồng đã ngừng hiệu lực.'
  return `${bounded(value.packageName, 160) || 'Gói tập Aura'} · ${bounded(value.startDate, 10)} → ${bounded(value.endDate, 10)}`
}

function contractInstallments(value, previous = [], outstanding = null) {
  if (!Array.isArray(value)) throw new HttpsError('invalid-argument', 'Lịch thanh toán không hợp lệ.')
  if (value.length > 24) throw new HttpsError('invalid-argument', 'Mỗi hợp đồng chỉ hỗ trợ tối đa 24 kỳ thanh toán.')
  const previousById = new Map((Array.isArray(previous) ? previous : []).map((item) => [bounded(item?.id, 100), item]))
  const ids = new Set()
  const result = value.map((item, index) => {
    const id = bounded(item?.id, 100) || `installment-${index + 1}`
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) throw new HttpsError('invalid-argument', 'Mã kỳ thanh toán không hợp lệ hoặc bị trùng.')
    ids.add(id)
    const prior = previousById.get(id)
    const status = bounded(item?.status, 20) || 'pending'
    if (!['pending', 'paid', 'cancelled'].includes(status)) throw new HttpsError('invalid-argument', 'Trạng thái kỳ thanh toán không hợp lệ.')
    const normalized = {
      id,
      amount: nonNegativeInteger(item?.amount, 'Số tiền kỳ thanh toán'),
      date: contractDateKey(item?.date, 'Ngày thanh toán'),
      status,
    }
    if (prior && ['paid', 'cancelled'].includes(prior.status)) {
      if (normalized.status !== prior.status || normalized.amount !== Number(prior.amount || 0) || normalized.date !== bounded(prior.date, 10)) {
        throw new HttpsError('failed-precondition', 'Kỳ đã thu hoặc đã hủy là chứng từ lịch sử và không thể chỉnh sửa.')
      }
    } else if (!prior && status !== 'pending') {
      throw new HttpsError('invalid-argument', 'Kỳ thanh toán mới phải ở trạng thái chờ thu.')
    }
    return normalized
  })
  const missingLocked = [...previousById.values()].some((item) => ['paid', 'cancelled'].includes(item.status) && !ids.has(bounded(item.id, 100)))
  if (missingLocked) throw new HttpsError('failed-precondition', 'Không thể xóa kỳ thanh toán đã thu hoặc đã hủy.')
  if (Number.isFinite(outstanding) && result.some((item) => item.status === 'pending')) {
    const pendingTotal = result.filter((item) => item.status === 'pending').reduce((sum, item) => sum + item.amount, 0)
    if (pendingTotal !== outstanding) throw new HttpsError('failed-precondition', 'Tổng các kỳ chờ thu phải bằng công nợ còn lại của hợp đồng.')
  }
  return result
}

function contractWorkspaceRecord(snapshot, canViewFinancialAmounts, canManageContract = false, usage = null) {
  const value = snapshot.data ? snapshot.data() : snapshot
  const id = snapshot.id || value.id
  const record = {
    id,
    studentId: bounded(value.studentId, 200),
    branchId: bounded(value.branchId, 200) || null,
    packageId: bounded(value.packageId, 200),
    packageName: bounded(value.packageName || value.name, 160) || 'Gói tập Aura',
    trainerId: bounded(value.trainerId, 200) || null,
    trainerIds: normalizedArray(value.trainerIds?.length ? value.trainerIds : [value.trainerId]),
    nutritionPTIds: normalizedArray(value.nutritionPTIds),
    startDate: bounded(value.startDate, 30).slice(0, 10),
    endDate: bounded(value.endDate, 30).slice(0, 10),
    frozenAt: iso(value.frozenAt) || bounded(value.frozenAt, 40) || null,
    totalSessions: Math.max(0, Math.floor(finite(value.totalSessions))),
    usedSessions: Math.max(0, Math.floor(finite(value.usedSessions))),
    status: effectiveContractStatus(value, vietnamDateKey()),
    storedStatus: bounded(value.status, 30) || 'active',
    nextPaymentDate: bounded(value.nextPaymentDate, 30).slice(0, 10) || null,
    installments: canViewFinancialAmounts && Array.isArray(value.installments) ? value.installments.slice(0, 24).map((item) => ({
      id: bounded(item?.id, 100),
      date: bounded(item?.date, 30).slice(0, 10),
      status: ['pending', 'paid', 'cancelled'].includes(item?.status) ? item.status : 'pending',
      ...(canViewFinancialAmounts ? { amount: Math.max(0, Math.floor(finite(item?.amount))) } : {}),
    })) : [],
    extensions: Array.isArray(value.extensions) ? value.extensions.slice(-30).map((item) => ({
      id: bounded(item?.id, 100),
      oldEndDate: bounded(item?.oldEndDate, 30).slice(0, 10),
      newEndDate: bounded(item?.newEndDate, 30).slice(0, 10),
      reason: bounded(item?.reason, 300),
      createdAt: iso(item?.createdAt) || bounded(item?.createdAt, 40) || null,
    })) : [],
    pausePeriods: Array.isArray(value.pausePeriods) ? value.pausePeriods.slice(-30).map((item) => ({
      requestId: bounded(item?.requestId, 100),
      type: bounded(item?.type, 30),
      startDate: bounded(item?.startDate, 30).slice(0, 10),
      endDate: bounded(item?.endDate, 30).slice(0, 10),
      durationDays: Math.max(0, Math.floor(finite(item?.durationDays))),
    })) : [],
    note: canManageContract ? bounded(value.note, 1_000) : '',
    revision: Math.max(0, Math.floor(finite(value.revision))),
    updatedAt: iso(value.updatedAt),
    updatedByName: bounded(value.updatedByName, 160),
    ...(usage ? { usage } : {}),
  }
  if (canViewFinancialAmounts) {
    record.totalPrice = Math.max(0, Math.floor(finite(value.totalPrice)))
    record.paidAmount = Math.max(0, Math.floor(finite(value.paidAmount)))
    record.discount = Math.max(0, Math.floor(finite(value.discount)))
  }
  return record
}

function contractAssigneeIssues(assigneeIds, assigneeSnapshots, requestedBranchId) {
  const issues = []
  assigneeSnapshots.forEach((item, index) => {
    const assigneeId = assigneeIds[index]
    if (!item?.exists) {
      issues.push({ id: assigneeId, name: 'PT/coach không còn tồn tại', issue: 'not_found', branchId: null })
      return
    }
    const value = item.data() || {}
    const name = bounded(value.name, 160) || 'PT/coach chưa có tên'
    const assigneeBranch = bounded(value.branchId, 200) || null
    if (value.status === 'inactive') {
      issues.push({ id: assigneeId, name, issue: 'inactive', branchId: assigneeBranch })
    } else if (assigneeBranch && assigneeBranch !== requestedBranchId) {
      issues.push({ id: assigneeId, name, issue: 'branch_mismatch', branchId: assigneeBranch })
    }
  })
  return issues
}

function profileProgress(profile = {}, metricDocs = []) {
  const history = Array.isArray(profile.history) ? profile.history : []
  const values = uniqueProgressDocuments([...history, ...metricDocs])
    .map((item, index) => ({
      id: bounded(item.id, 100) || `metric-${index}`,
      checkInId: bounded(item.checkInId, 120) || null,
      date: bounded(item.date || item.recordedAt || item.createdAt, 10) || (iso(item.createdAt) || '').slice(0, 10),
      weight: finite(item.weightKg ?? item.weight, NaN),
      waist: finite(item.waistCm ?? item.waist, NaN),
      hips: finite(item.hipsCm ?? item.hips, NaN),
      thigh: finite(item.thighCm ?? item.thigh, NaN),
      arm: finite(item.armCm ?? item.arm, NaN),
      chest: finite(item.chestCm ?? item.chest, NaN),
      muscleMass: finite(item.muscleMassKg ?? item.muscleMass, NaN),
      bodyFat: finite(item.bodyFatPercentage ?? item.bodyFatPercent ?? item.body_fat ?? item.bodyFat, NaN),
    }))
    .filter((item) => item.date)
    .sort((left, right) => left.date.localeCompare(right.date))
  if (!values.length) return { summary: null, values: [] }
  const first = values[0]
  const latest = values[values.length - 1]
  const delta = (key) => Number.isFinite(latest[key]) && Number.isFinite(first[key]) ? Math.round((latest[key] - first[key]) * 10) / 10 : null
  return {
    summary: {
      latestDate: latest.date,
      latestWeightKg: Number.isFinite(latest.weight) ? latest.weight : null,
      latestWaistCm: Number.isFinite(latest.waist) ? latest.waist : null,
      latestBodyFatPercent: Number.isFinite(latest.bodyFat) ? latest.bodyFat : null,
      latestHipsCm: Number.isFinite(latest.hips) ? latest.hips : null,
      latestThighCm: Number.isFinite(latest.thigh) ? latest.thigh : null,
      latestArmCm: Number.isFinite(latest.arm) ? latest.arm : null,
      latestChestCm: Number.isFinite(latest.chest) ? latest.chest : null,
      latestMuscleMassKg: Number.isFinite(latest.muscleMass) ? latest.muscleMass : null,
      weightChangeKg: delta('weight'),
      waistChangeCm: delta('waist'),
      bodyFatChangePercent: delta('bodyFat'),
      measurementCount: values.length,
    },
    values,
  }
}

function mealProjection(meals, profile, today) {
  if (!meals.length && !profile?.nutritionProfile) return null
  const cutoff = dateKeyMillis(addDays(today, -6))
  const recent = meals.map((item) => {
    const value = item.data || item
    const date = bounded(value.date || value.mealDate, 10) || (iso(value.createdAt || value.timestamp) || '').slice(0, 10)
    const nutrition = value.macros || value.nutrition || value.totals || {}
    return {
      id: item.id || value.id || '',
      date,
      kcal: finite(value.totalKcal ?? value.kcal ?? value.calories ?? nutrition.calories ?? nutrition.kcal),
      protein: finite(value.totalProtein ?? value.protein ?? nutrition.protein),
      createdAt: timestampMillis(value.createdAt || value.timestamp) || dateKeyMillis(date),
    }
  }).filter((item) => item.date && dateKeyMillis(item.date) >= cutoff)
  const loggedDays = new Set(recent.map((item) => item.date)).size
  const totalKcal = recent.reduce((sum, item) => sum + item.kcal, 0)
  const totalProtein = recent.reduce((sum, item) => sum + item.protein, 0)
  const targetKcal = finite(profile?.nutritionProfile?.targetCalories ?? profile?.calories)
  const targetProtein = finite(profile?.nutritionProfile?.protein ?? profile?.protein)
  return {
    loggedMeals: recent.length,
    loggedDays,
    averageCalories: loggedDays ? Math.round(totalKcal / loggedDays) : 0,
    averageProtein: loggedDays ? Math.round(totalProtein / loggedDays) : 0,
    targetCalories: targetKcal || null,
    targetProtein: targetProtein || null,
    lastMealAt: recent.length ? new Date(Math.max(...recent.map((item) => item.createdAt))).toISOString() : null,
  }
}

async function queryDocuments(query) {
  const snapshot = await query.get()
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

// History collections are intentionally bounded for overview latency, so the
// bounded slice must be the newest records rather than whichever documents
// Firestore happens to return first. Do not fall back to an unordered limit:
// that silently makes a healthy-looking overview from stale history. Missing
// indexes must fail clearly and be provisioned by firestore.indexes.json.
async function latestDocuments(query, field, limit) {
  return queryDocuments(query.orderBy(field, 'desc').orderBy(FieldPath.documentId(), 'desc').limit(limit))
}

async function latestSnapshot(query, field, limit) {
  return query.orderBy(field, 'desc').orderBy(FieldPath.documentId(), 'desc').limit(limit).get()
}

function safeAccountUid(value) {
  const accountUid = bounded(value, 200)
  return accountUid && !accountUid.includes('/') ? accountUid : ''
}

/**
 * Resolve the canonical Aura account without guessing that a CRM student id
 * is an Auth uid. New records store students.accountUid directly. Older
 * account provisioning records only have roleAssignments/{uid}.crmProfileId;
 * that reverse link is unambiguous and is safe to use as a read-only fallback.
 */
async function studentAccountLink(db, student) {
  const directUid = safeAccountUid(student?.accountUid)
  if (directUid) return { accountUid: directUid, source: 'students.accountUid' }

  const studentId = bounded(student?.id, 200)
  if (!studentId || studentId.includes('/')) return { accountUid: '', source: 'missing' }
  try {
    const assignments = await db.collection('roleAssignments')
      .where('crmProfileId', '==', studentId)
      .limit(2)
      .get()
    const candidates = assignments.docs.filter((item) => {
      const value = item.data() || {}
      const role = bounded(value.accessRole || value.role, 40)
      return !role || role === 'student'
    })
    if (candidates.length !== 1) {
      return { accountUid: '', source: candidates.length > 1 ? 'ambiguous' : 'missing' }
    }
    return { accountUid: safeAccountUid(candidates[0].id), source: 'roleAssignments.crmProfileId' }
  } catch {
    // A missing/temporarily unavailable legacy index must not make the whole
    // Student 360 page fail. The scheduled reconciliation can retry later.
    return { accountUid: '', source: 'unavailable' }
  }
}

async function studentAccountProfile(db, student) {
  const link = await studentAccountLink(db, student)
  const accountUid = link.accountUid
  if (!accountUid) return { accountUid: '', profile: null, source: link.source }
  const chosen = await db.doc(`users/${accountUid}`).get()
  if (!chosen.exists) return { accountUid, profile: null, source: link.source }
  return {
    accountUid,
    profile: { id: accountUid, ...chosen.data() },
    source: link.source,
  }
}

async function projectionSources(db, studentId, weekId) {
  const studentSnapshot = await db.doc(`students/${studentId}`).get()
  if (!studentSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy học viên.')
  const student = { id: studentSnapshot.id, ...studentSnapshot.data() }
  const [contracts, sessions, attendance, leaveRequests, sessionRequests, legacyWorkoutLogs, ptWorkoutLogs, renewals, dailyCheckins, payments, ledgerEntries, availabilitySnapshot, profileResult] = await Promise.all([
    latestDocuments(db.collection('contracts').where('studentId', '==', studentId), 'startDate', 50),
    latestDocuments(db.collection('sessions').where('studentId', '==', studentId), 'date', 1000),
    latestDocuments(db.collection('attendanceEvents').where('studentId', '==', studentId), 'date', 1000),
    latestDocuments(db.collection('leaveRequests').where('studentId', '==', studentId), 'startDate', 150),
    latestDocuments(db.collection('sessionRequests').where('studentId', '==', studentId), 'createdAt', 250),
    latestDocuments(db.collection('workoutLogs').where('studentId', '==', studentId), 'date', 200),
    latestDocuments(db.collection('ptWorkoutLogs').where('studentId', '==', studentId), 'date', 200),
    latestDocuments(db.collection('contractRenewalCases').where('studentId', '==', studentId), 'updatedAt', 20),
    latestDocuments(db.collection('dailyCheckins').where('studentId', '==', studentId), 'date', 180),
    latestDocuments(db.collection('payments').where('studentId', '==', studentId), 'effectiveAt', 250),
    latestDocuments(db.collection('ledgerEntries').where('studentId', '==', studentId), 'effectiveAt', 250),
    db.doc(`ptAvailability/${studentId}_${weekId}`).get(),
    studentAccountProfile(db, student),
  ])
  const profile = profileResult.profile
  const accountUid = profileResult.accountUid
  const [mealLogs, mealReviews, bodyMetrics, bodyMeasurements, weightLogs, progressCheckIns, trainingProgramSnapshot, legacyProgressPhotos, progressPhotos] = accountUid ? await Promise.all([
    latestDocuments(db.collection(`users/${accountUid}/mealLogs`), 'date', 120),
    latestDocuments(db.collection('mealReviews').where('userId', '==', accountUid), 'createdAt', 120),
    latestDocuments(db.collection(`users/${accountUid}/bodyMetrics`), 'date', 100),
    latestDocuments(db.collection(`users/${accountUid}/bodyMeasurements`), 'date', 100),
    latestDocuments(db.collection(`users/${accountUid}/weightLogs`), 'date', 100),
    latestDocuments(db.collection(`users/${accountUid}/progressCheckIns`), 'date', 100),
    db.doc(`ptTrainingPrograms/${studentId}`).get(),
    latestDocuments(db.collection(`users/${accountUid}/progress_photos`).select('date', 'createdAt', 'updatedAt'), 'date', 60),
    latestDocuments(db.collection(`users/${accountUid}/progressPhotos`).select('date', 'createdAt', 'updatedAt'), 'date', 60),
  ]) : [[], [], [], [], [], [], await db.doc(`ptTrainingPrograms/${studentId}`).get(), [], []]
  return {
    student,
    contracts,
    sessions,
    attendance,
    leaveRequests,
    sessionRequests,
    workoutLogs: [...ptWorkoutLogs.map((item) => ({ ...item, source: 'pt_tracking' })), ...legacyWorkoutLogs.map((item) => ({ ...item, source: 'legacy' }))],
    renewals,
    dailyCheckins,
    payments: [
      ...payments.map((item) => ({ ...item, timelineSource: 'legacy_payment' })),
      ...ledgerEntries.map((item) => ({ ...item, timelineSource: 'finance_ledger' })),
    ],
    availability: availabilitySnapshot.exists ? { id: availabilitySnapshot.id, ...availabilitySnapshot.data() } : null,
    profile,
    accountUid,
    accountLinkSource: profileResult.source || (accountUid ? 'students.accountUid' : 'missing'),
    mealLogs,
    mealReviews,
    bodyMetrics: uniqueProgressDocuments([...bodyMetrics, ...bodyMeasurements, ...weightLogs, ...progressCheckIns]),
    progressPhotos: uniqueProgressPhotos([...legacyProgressPhotos, ...progressPhotos, ...progressCheckIns]),
    trainingProgram: trainingProgramSnapshot.exists ? { id: trainingProgramSnapshot.id, ...trainingProgramSnapshot.data() } : null,
  }
}

async function assignmentNames(db, sources, contract) {
  const trainerIds = normalizedArray([contract?.trainerId, ...(contract?.trainerIds || [])])
  const nutritionCoachIds = normalizedArray(contract?.nutritionPTIds)
  const salesIds = normalizedArray([sources.student.assignedSalesId, contract?.assignedSalesId])
  // A scheduled session can legitimately use a supporting PT outside the
  // contract assignment. Resolve those identities as well so Student 360
  // never labels the actual session with the first assigned PT by mistake.
  const sessionTrainerIds = normalizedArray((sources.sessions || []).map((item) => item.trainerId)).slice(0, 120)
  const ids = normalizedArray([...trainerIds, ...nutritionCoachIds, ...salesIds, ...sessionTrainerIds])
  const snapshots = ids.length ? await db.getAll(...ids.map((id) => db.doc(`trainers/${id}`))) : []
  const fallbackSnapshots = ids.length ? await db.getAll(...ids.map((id) => db.doc(`users/${id}`))) : []
  const names = new Map()
  snapshots.forEach((item) => { if (item.exists) names.set(item.id, item.data().name || item.data().displayName || 'HLV Aura') })
  fallbackSnapshots.forEach((item) => { if (item.exists && !names.has(item.id)) names.set(item.id, item.data().displayName || item.data().name || 'HLV Aura') })
  const branchId = contract?.branchId || sources.student.branchId || ''
  const sessionBranchIds = normalizedArray((sources.sessions || []).map((item) => item.branchId)).slice(0, 60)
  const branchIds = normalizedArray([branchId, ...sessionBranchIds])
  const branchSnapshots = branchIds.length ? await db.getAll(...branchIds.map((id) => db.doc(`branches/${id}`))) : []
  const branchNames = new Map(branchSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data().name || item.data().branchName || item.id]))
  return {
    branchId,
    branchName: branchNames.get(branchId) || branchId,
    trainerIds,
    trainerNames: trainerIds.map((id) => names.get(id) || 'HLV Aura'),
    nutritionCoachIds,
    nutritionCoachNames: nutritionCoachIds.map((id) => names.get(id) || 'Coach Aura'),
    salesIds,
    salesNames: salesIds.map((id) => names.get(id) || 'Sales Aura'),
    trainerNameById: Object.fromEntries(ids.map((id) => [id, names.get(id) || 'PT Aura'])),
    branchNameById: Object.fromEntries(branchIds.map((id) => [id, branchNames.get(id) || id])),
  }
}

function sourceTimelineEvents(studentId, sources) {
  const values = []
  const attendanceBySessionId = new Map((sources.attendance || []).map((item) => [bounded(item.sessionId || item.id, 200), item]))
  for (const contract of sources.contracts || []) {
    // Student 360 mutations already create a dedicated immutable audit event.
    // Do not add a second generic event for the same contract revision.
    if (contract.student360LastActivityId) continue
    const occurred = timestampMillis(contract.updatedAt || contract.createdAt) || dateKeyMillis(contract.startDate)
    const status = bounded(contract.status, 40) || 'active'
    const title = status === 'frozen' ? 'Hợp đồng đang bảo lưu' : status === 'expired' ? 'Hợp đồng đã hết hạn' : status === 'cancelled' ? 'Hợp đồng đã hủy' : 'Cập nhật hợp đồng'
    values.push(timelineEvent(studentId, 'contract', contract.id, occurred, title, contract.packageName || contract.name || 'Gói tập Aura', 'finance', { contractId: contract.id, status }))
  }
  for (const session of sources.sessions) {
    const attendanceEvent = attendanceBySessionId.get(session.id)
    const attendance = sessionAttendance(attendanceEvent || session)
    const date = sessionDate(session)
    const occurred = sessionDateTimeMillis(date, session.hour)
    const label = attendance === 'present' ? 'Đã tập' : attendance === 'late' ? 'Đi tập trễ' : attendance === 'no_show' ? 'Không đến buổi tập' : 'Lịch tập'
    values.push(timelineEvent(studentId, 'training', session.id, occurred, label, `${date}${session.hour !== undefined ? ` · ${String(session.hour).padStart(2, '0')}:00` : ''}`, 'operations', {
      sessionId: session.id,
      status: attendance,
      ...(attendanceEvent ? {
        attendanceEventId: attendanceEvent.id,
        confirmationSource: bounded(attendanceEvent.confirmationSource, 60),
        confirmedAt: iso(attendanceEvent.confirmedAt),
        confirmedBy: bounded(attendanceEvent.confirmedBy, 200),
        lateMinutes: attendance === 'late' ? Math.max(0, Math.floor(finite(attendanceEvent.lateMinutes))) : null,
      } : {}),
    }))
  }
  for (const log of sources.workoutLogs) {
    const occurred = timestampMillis(log.completedAt || log.updatedAt || log.createdAt) || dateKeyMillis(log.date)
    values.push(timelineEvent(studentId, 'workout', log.id, occurred, 'Đã cập nhật nhật ký tập', log.trainingDayTitle || log.programName || log.exerciseName || log.title || 'Kết quả buổi tập', 'coaching', { workoutLogId: log.id }))
  }
  for (const request of sources.leaveRequests) {
    values.push(timelineEvent(studentId, request.type === 'preservation' ? 'freeze' : 'off', request.id, timestampMillis(request.createdAt) || dateKeyMillis(request.startDate), request.type === 'preservation' ? 'Yêu cầu bảo lưu' : 'Yêu cầu OFF', `${request.startDate || ''}${request.endDate ? ` → ${request.endDate}` : ''}`, 'operations', { status: request.status || '' }))
  }
  for (const request of sources.sessionRequests) {
    values.push(timelineEvent(studentId, 'schedule_change', request.id, timestampMillis(request.createdAt) || dateKeyMillis(request.originalDate), request.type === 'cancel' ? 'Yêu cầu hủy lịch' : 'Yêu cầu đổi lịch', request.reason || request.originalDate || '', 'operations', { status: request.status || '' }))
  }
  const reviewsByMealId = new Map((sources.mealReviews || []).map((review) => [mealReviewId(review), review]).filter(([mealId]) => mealId))
  const consumedReviewIds = new Set()
  for (const meal of sources.mealLogs || []) {
    const review = reviewsByMealId.get(bounded(meal.id, 200)) || null
    if (review?.id) consumedReviewIds.add(review.id)
    const metadata = mealTimelineMetadata(meal, review)
    const occurred = Math.max(
      timestampMillis(meal.updatedAt || meal.createdAt || meal.timestamp) || dateKeyMillis(meal.date || meal.mealDate),
      review ? timestampMillis(review.reviewedAt || review.updatedAt || review.createdAt) : 0,
    )
    values.push(timelineEvent(studentId, 'nutrition', metadata.mealId || meal.id, occurred, mealTimelineTitle(metadata.status), mealTimelineCopy(meal, review, metadata), 'coaching', metadata, 'mealLogs'))
  }
  // Preserve legacy review-only evidence when its original meal log no longer
  // exists. It remains detail-viewable from the immutable review snapshot.
  for (const review of sources.mealReviews || []) {
    if (consumedReviewIds.has(review.id)) continue
    const reviewedMeal = review.meal && typeof review.meal === 'object' ? review.meal : {}
    const metadata = mealTimelineMetadata(reviewedMeal, review)
    const occurred = timestampMillis(review.reviewedAt || review.updatedAt || review.createdAt) || dateKeyMillis(reviewedMeal.date || review.date || review.mealDate)
    values.push(timelineEvent(studentId, 'nutrition', metadata.mealId || `meal-review:${review.id}`, occurred, mealTimelineTitle(metadata.status), mealTimelineCopy(reviewedMeal, review, metadata), 'coaching', metadata, 'mealReviews'))
  }
  for (const checkin of sources.dailyCheckins || []) {
    const occurred = timestampMillis(checkin.createdAt || checkin.updatedAt) || dateKeyMillis(checkin.date)
    const compliance = Number.isFinite(Number(checkin.compliance)) ? Math.max(0, Math.min(100, Math.round(Number(checkin.compliance)))) : null
    const description = [bounded(checkin.date, 10), compliance === null ? '' : `tuân thủ ${compliance}%`].filter(Boolean).join(' · ') || 'Đã ghi nhận trạng thái trong ngày'
    values.push(timelineEvent(studentId, 'checkin', checkin.id, occurred, 'Check-in cuối ngày', description, 'coaching', { checkinId: checkin.id, compliance }))
  }
  for (const payment of sources.payments) {
    if (payment.timelineSource === 'finance_ledger' && !['payment', 'refund', 'reversal', 'adjustment'].includes(bounded(payment.type, 40))) continue
    const occurred = timestampMillis(payment.effectiveAt || payment.createdAt) || dateKeyMillis(payment.date)
    const type = bounded(payment.type, 40)
    const title = type === 'refund' ? 'Đã hoàn tiền hợp đồng'
      : type === 'reversal' ? 'Đã hoàn tác khoản thu'
        : type === 'payment' || payment.timelineSource === 'legacy_payment' ? 'Đã ghi nhận thanh toán'
          : 'Cập nhật tài chính hợp đồng'
    const rawAmount = finite(payment.amount)
    const rawDescription = payment.note || payment.reason || payment.referenceCode || 'Thanh toán hợp đồng'
    const description = /migrated from an evidenced legacy payment record/i.test(String(rawDescription))
      ? 'Thanh toán đã đối soát từ dữ liệu cũ.'
      : rawDescription
    values.push(timelineEvent(studentId, 'finance', `${payment.timelineSource || 'payment'}:${payment.id}`, occurred, title, description, 'finance', { amount: rawAmount, contractId: payment.contractId || '', referenceCode: bounded(payment.referenceCode, 100), status: bounded(payment.status, 30) }))
  }
  for (const renewal of sources.renewals) {
    const occurred = timestampMillis(renewal.updatedAt || renewal.createdAt) || Date.now()
    values.push(timelineEvent(studentId, 'renewal', renewal.id, occurred, 'Cập nhật chăm sóc gia hạn', renewal.stage || 'Chưa liên hệ', 'sales', { stage: renewal.stage || '', caseId: renewal.id }))
  }
  const progressEvents = new Map()
  const progress = profileProgress(sources.profile || {}, sources.bodyMetrics).values
  for (const item of progress) {
    const checkInId = bounded(item.checkInId, 120)
    const key = checkInId ? `checkin:${checkInId}` : `metric:${item.id}`
    progressEvents.set(key, { ...(progressEvents.get(key) || {}), checkInId, metric: item })
  }
  for (const item of sources.progressPhotos) {
    const checkInId = bounded(item.checkInId, 120)
    const key = checkInId ? `checkin:${checkInId}` : `photo:${item.id}`
    progressEvents.set(key, { ...(progressEvents.get(key) || {}), checkInId, photo: item })
  }
  for (const [key, entry] of progressEvents) {
    const metric = entry.metric || null
    const photo = entry.photo || null
    const date = bounded(metric?.date || photo?.date, 10) || (iso(photo?.createdAt || photo?.updatedAt) || '').slice(0, 10)
    const occurred = timestampMillis(photo?.createdAt || photo?.updatedAt) || dateKeyMillis(date)
    const images = Array.isArray(photo?.images) ? photo.images : []
    const measurementCopy = [
      Number.isFinite(metric?.weight) ? `${metric.weight}kg` : '',
      Number.isFinite(metric?.waist) ? `eo ${metric.waist}cm` : '',
      Number.isFinite(metric?.bodyFat) ? `mỡ ${metric.bodyFat}%` : '',
    ].filter(Boolean)
    const description = [...measurementCopy, images.length ? `${images.length} ảnh` : ''].filter(Boolean).join(' · ')
      || (date ? `Ghi nhận ngày ${date}` : 'Đã cập nhật tiến độ')
    const canonical = Boolean(entry.checkInId)
    values.push(timelineEvent(
      studentId,
      'progress',
      canonical ? entry.checkInId : key,
      occurred,
      canonical ? 'Ghi nhận tiến độ' : metric ? 'Cập nhật chỉ số cơ thể' : 'Đã cập nhật ảnh tiến độ',
      description,
      'coaching',
      {
        ...(entry.checkInId ? { checkInId: entry.checkInId, photoCount: images.length } : {}),
        ...(metric?.id ? { metricId: metric.id } : {}),
        ...(photo?.id ? { progressPhotoId: photo.id } : {}),
        ...(photo?.recordedByName ? { recordedByName: bounded(photo.recordedByName, 160), recordedBy: bounded(photo.recordedBy, 200), verificationStatus: bounded(photo.verificationStatus, 40) } : {}),
      },
      canonical ? 'progressCheckIns' : metric ? 'bodyMetrics' : 'progressPhotos',
    ))
  }
  return normalizeTimelineEvents(values.filter((item) => item.occurredAtMillis > 0)).slice(0, 400)
}

async function upsertTimeline(db, events) {
  for (let offset = 0; offset < events.length; offset += 400) {
    const batch = db.batch()
    events.slice(offset, offset + 400).forEach((event) => batch.set(db.doc(`studentTimelineEvents/${event.id}`), event, { merge: true }))
    await batch.commit()
  }
}

/**
 * Return the minimum evidence needed to repair a missing nutrition timeline.
 * This deliberately reads only one meal and one review, keeping the fallback
 * cheap for a first visit while the full projection performs the bounded
 * 120-item read once a link is confirmed.
 */
async function nutritionTimelineEvidence(db, studentId, projection) {
  let accountUid = safeAccountUid(projection?.accountUid)
  let accountLinkSource = accountUid ? 'projection' : ''
  if (!accountUid) {
    const studentSnapshot = await db.doc(`students/${studentId}`).get()
    if (studentSnapshot.exists) {
      const link = await studentAccountLink(db, { id: studentSnapshot.id, ...studentSnapshot.data() })
      accountUid = link.accountUid
      accountLinkSource = link.source
    }
  }
  if (!accountUid) return { accountUid: '', accountLinkSource, hasEvidence: false }
  const [mealSnapshot, reviewSnapshot] = await Promise.all([
    db.collection(`users/${accountUid}/mealLogs`).limit(1).get(),
    db.collection('mealReviews').where('userId', '==', accountUid).limit(1).get(),
  ])
  return {
    accountUid,
    accountLinkSource,
    hasEvidence: !mealSnapshot.empty || !reviewSnapshot.empty,
  }
}

async function buildStudent360Projection({ db, studentId, weekId = mondayDateKey(), persist = true }) {
  const today = vietnamDateKey()
  const sources = await projectionSources(db, studentId, weekId)
  const contract = activeContract(sources.contracts, today)
  const contractEffectiveStatus = contract ? effectiveContractStatus(contract, today) : null
  const usage = contractUsage(contract || {}, sources.sessions)
  const payment = paymentProjection(contract, today)
  const assignmentDirectory = await assignmentNames(db, sources, contract)
  const { trainerNameById, branchNameById, ...assignments } = assignmentDirectory
  const currentWeekEnd = addDays(weekId, 6)
  const weekSessions = sources.sessions.filter((item) => {
    const date = sessionDate(item)
    return date >= weekId && date <= currentWeekEnd && ACTIVE_SESSION_STATUSES.has(bounded(item.status, 40).toLowerCase())
  })
  const upcoming = sources.sessions.filter((item) => {
    const date = sessionDate(item)
    return date >= today && ACTIVE_SESSION_STATUSES.has(bounded(item.status, 40).toLowerCase())
  }).sort((left, right) => sessionDate(left).localeCompare(sessionDate(right)) || finite(left.hour) - finite(right.hour))
  const attendanceCutoff = addDays(today, -27)
  const attendanceRows = (sources.attendance.length ? sources.attendance : sources.sessions)
    .filter((item) => sessionDate(item) >= attendanceCutoff && sessionDate(item) <= today)
    .map((item) => ({ ...item, normalizedAttendance: sessionAttendance(item) }))
    .filter((item) => TERMINAL_ATTENDANCE.has(item.normalizedAttendance))
  const attended = attendanceRows.filter((item) => ['present', 'late'].includes(item.normalizedAttendance)).length
  const late = attendanceRows.filter((item) => item.normalizedAttendance === 'late').length
  const noShow = attendanceRows.filter((item) => item.normalizedAttendance === 'no_show').length
  const attendanceRate = attendanceRows.length ? Math.round(attended / attendanceRows.length * 100) : null
  const weeklyTrend = Array.from({ length: 4 }).map((_, index) => {
    const start = addDays(attendanceCutoff, index * 7)
    const end = addDays(start, 6)
    const rows = attendanceRows.filter((item) => sessionDate(item) >= start && sessionDate(item) <= end)
    const present = rows.filter((item) => ['present', 'late'].includes(item.normalizedAttendance)).length
    return { weekStart: start, rate: rows.length ? Math.round(present / rows.length * 100) : null, total: rows.length }
  })
  const requiredPerWeek = Math.max(0, Math.floor(finite(sources.student.sessionsPerWeek)))
  const completed28 = attendanceRows.filter((item) => ['present', 'late'].includes(item.normalizedAttendance)).length
  const trainingTarget28 = requiredPerWeek * 4
  const trainingAdherence = trainingTarget28 ? Math.min(100, Math.round(completed28 / trainingTarget28 * 100)) : null
  const nutrition = mealProjection(sources.mealLogs, sources.profile, today)
  const progress = profileProgress(sources.profile || {}, sources.bodyMetrics).summary
  const progressAgeDays = progress?.latestDate ? Math.max(0, daysBetween(progress.latestDate, today)) : null
  const availability = sources.availability || sources.student.latestSubmittedAvailability || sources.student.legacyDefaultAvailability || null
  const slots = normalizedArray(availability?.slots || sources.student.availableSlots)
  const confirmedAvailability = Boolean(availability?.confirmed || ['submitted', 'locked', 'inherited'].includes(availability?.status) || sources.student.isScheduleConfirmed)
  const latestAttendanceMillis = Math.max(0, ...attendanceRows.map((item) => timestampMillis(item.updatedAt || item.createdAt) || dateKeyMillis(sessionDate(item))))
  const latestActivityMillis = Math.max(0, ...[
    latestAttendanceMillis,
    ...sources.mealLogs.map((item) => timestampMillis(item.createdAt || item.timestamp) || dateKeyMillis(item.date)),
    ...sources.workoutLogs.map((item) => timestampMillis(item.completedAt || item.updatedAt || item.createdAt) || dateKeyMillis(item.date)),
    ...sources.dailyCheckins.map((item) => timestampMillis(item.createdAt || item.updatedAt) || dateKeyMillis(item.date)),
  ])
  const lastAttendanceAt = latestAttendanceMillis ? new Date(latestAttendanceMillis).toISOString() : null
  const activityAgeDays = latestActivityMillis ? Math.floor((Date.now() - latestActivityMillis) / 86_400_000) : null
  const attendanceAgeDays = latestAttendanceMillis ? Math.floor((Date.now() - latestAttendanceMillis) / 86_400_000) : null
  const contractAgeDays = contract?.startDate ? Math.max(0, daysBetween(contract.startDate, today)) : null
  const renewal = [...sources.renewals].sort((left, right) => timestampMillis(right.updatedAt || right.createdAt) - timestampMillis(left.updatedAt || left.createdAt))[0] || null
  const daysRemaining = contract?.endDate ? daysBetween(today, contract.endDate) : null
  const consecutiveNoShows = [...attendanceRows]
    .sort((left, right) => sessionDate(right).localeCompare(sessionDate(left)))
    .findIndex((item) => item.normalizedAttendance !== 'no_show')
  const noShowStreak = consecutiveNoShows === -1 ? attendanceRows.length : consecutiveNoShows
  const futureInvalidSessions = sources.sessions.filter((item) => {
    const date = sessionDate(item)
    return date >= today
      && ACTIVE_SESSION_STATUSES.has(bounded(item.status, 40).toLowerCase())
      && (!contract || effectiveContractStatus(contract, date) !== 'active')
  }).length
  const alerts = []
  if (futureInvalidSessions) alerts.push(alert('invalid-future-sessions', 'red', 'Lịch tương lai không còn hợp đồng hợp lệ', `${futureInvalidSessions} buổi cần được quản lý đối chiếu.`, 'schedule'))
  if (payment?.status === 'overdue') alerts.push(alert('payment-overdue', 'red', 'Thanh toán quá hạn', 'Khoản thanh toán của hợp đồng cần được xử lý.', 'finance', 'finance'))
  if (contractEffectiveStatus === 'active' && ((attendanceAgeDays !== null && attendanceAgeDays >= 14) || (attendanceAgeDays === null && contractAgeDays !== null && contractAgeDays >= 14))) alerts.push(alert('inactive-14-days', 'red', '14 ngày chưa tập', 'Hãy liên hệ hỏi thăm và sắp lại lịch phù hợp.', 'contact'))
  if (noShowStreak >= 3) alerts.push(alert('three-no-shows', 'red', 'Ba lần không đến liên tiếp', 'Cần liên hệ trực tiếp trước khi xếp thêm lịch.', 'contact'))
  if (usage.reconciliationStatus !== 'matched') alerts.push(alert('contract-reconciliation', usage.reconciliationStatus === 'over_entitlement' ? 'red' : 'amber', 'Số buổi cần đối soát', 'Lịch sử tính buổi và projection hợp đồng chưa khớp hoàn toàn.', 'contract'))
  if (attendanceRate !== null && attendanceRate < 75) alerts.push(alert('low-attendance', 'amber', 'Tỷ lệ đi tập đang thấp', `${attendanceRate}% trong 28 ngày gần nhất.`, 'training'))
  if (weekSessions.length < requiredPerWeek) alerts.push(alert('weekly-schedule-short', 'amber', 'Tuần này chưa đủ lịch', `Đã xếp ${weekSessions.length}/${requiredPerWeek} buổi mục tiêu.`, 'schedule'))
  if (progressAgeDays === null || progressAgeDays >= 14) alerts.push(alert('progress-stale', 'amber', 'Chưa cập nhật cân đo', progressAgeDays === null ? 'Chưa có dữ liệu tiến độ cơ thể.' : `${progressAgeDays} ngày chưa cập nhật.`, 'progress', 'coaching'))
  if (nutrition && nutrition.loggedDays === 0 && assignments.nutritionCoachIds.length) alerts.push(alert('nutrition-stale', 'amber', 'Bảy ngày chưa ghi bữa ăn', 'Coach cần hỏi thăm và hỗ trợ cách ghi nhận bữa ăn.', 'nutrition', 'coaching'))
  if (contract && ((daysRemaining !== null && daysRemaining <= 30) || usage.remainingSessions <= 6)) alerts.push(alert('renewal-due', 'amber', 'Sắp đến thời điểm gia hạn', `Còn ${usage.remainingSessions} buổi${daysRemaining !== null ? ` và ${Math.max(0, daysRemaining)} ngày` : ''}.`, 'renewal', 'sales'))
  const nutritionScore = nutrition
    ? Math.round(Math.min(100, nutrition.loggedDays / 7 * 100) * .55 + (nutrition.targetProtein && nutrition.averageProtein ? Math.min(100, nutrition.averageProtein / nutrition.targetProtein * 100) : 75) * .45)
    : null
  const progressScore = progressAgeDays === null ? null : progressAgeDays <= 7 ? 100 : progressAgeDays >= 28 ? 20 : Math.round(100 - (progressAgeDays - 7) * 80 / 21)
  const engagementScore = Math.round((confirmedAvailability ? 55 : 15) + (activityAgeDays === null ? 0 : activityAgeDays <= 3 ? 45 : activityAgeDays <= 7 ? 30 : activityAgeDays <= 14 ? 15 : 0))
  const renewalScore = contract ? Math.max(0, Math.min(100, Math.round(((daysRemaining ?? 0) >= 60 ? 100 : Math.max(20, (daysRemaining ?? 0) / 60 * 100)) * .55 + (usage.remainingSessions >= 12 ? 100 : Math.max(20, usage.remainingSessions / 12 * 100)) * .45))) : null
  const health = buildHealthScore({
    attendanceScore: attendanceRate,
    attendanceReason: attendanceRate === null ? 'Chưa đủ buổi đã xác nhận.' : `${attendanceRate}% buổi có mặt trong 28 ngày.`,
    trainingScore: trainingAdherence,
    trainingReason: trainingAdherence === null ? 'Chưa có mục tiêu số buổi/tuần.' : `${completed28}/${trainingTarget28} buổi mục tiêu trong bốn tuần.`,
    nutritionScore,
    nutritionReason: nutrition ? `${nutrition.loggedDays}/7 ngày có nhật ký ăn.` : 'Chưa áp dụng theo dõi dinh dưỡng.',
    progressScore,
    progressReason: progressAgeDays === null ? 'Chưa có dữ liệu cân đo.' : `Cập nhật gần nhất ${progressAgeDays} ngày trước.`,
    engagementScore,
    engagementReason: `${confirmedAvailability ? 'Đã' : 'Chưa'} xác nhận lịch rảnh${activityAgeDays === null ? ', chưa có hoạt động gần đây' : `, hoạt động ${activityAgeDays} ngày trước`}.`,
    paymentScore: payment ? payment.status === 'paid' ? 100 : payment.status === 'due' ? 65 : 15 : null,
    paymentReason: payment ? payment.status === 'paid' ? 'Đã thanh toán đủ.' : payment.status === 'due' ? 'Còn khoản cần thanh toán.' : 'Khoản thanh toán đã quá hạn.' : 'Chưa có hợp đồng để đánh giá.',
    renewalScore,
    renewalReason: contract ? `Còn ${usage.remainingSessions} buổi${daysRemaining !== null ? `, ${Math.max(0, daysRemaining)} ngày` : ''}.` : 'Chưa có hợp đồng để đánh giá.',
  })
  const sortedAlerts = sortAlerts(alerts)
  const actions = sortedAlerts.slice(0, 3).map((item, index) => ({
    id: `action-${item.id}`,
    priority: index + 1,
    title: item.title,
    description: item.message,
    action: item.action,
    severity: item.severity,
    audience: item.audience,
  }))
  const timeline = sourceTimelineEvents(studentId, sources)
  const projection = {
    schemaVersion: OVERVIEW_SCHEMA_VERSION,
    formulaVersion: HEALTH_FORMULA_VERSION,
    studentId,
    accountUid: sources.accountUid || null,
    generatedAt: new Date().toISOString(),
    generatedAtMillis: Date.now(),
    identity: {
      id: studentId,
      accountUid: sources.accountUid || null,
      name: sources.student.name || sources.profile?.displayName || sources.profile?.name || 'Học viên Aura',
      phone: sources.student.phone || sources.profile?.phoneNumber || '',
      email: sources.student.email || sources.profile?.email || '',
      dob: sources.student.dob || null,
      avatarUrl: sources.profile?.photoURL || null,
      status: contractEffectiveStatus === 'frozen' ? 'frozen' : sources.student.status === 'inactive' ? 'inactive' : contractEffectiveStatus === 'expired' ? 'expired' : contractEffectiveStatus === 'future' ? 'future' : contractEffectiveStatus === 'invalid' ? 'invalid' : 'active',
      joinDate: sources.student.joinDate || null,
      goals: normalizedArray(sources.profile?.goals),
      sessionsPerWeek: requiredPerWeek,
    },
    assignments,
    contract: contract ? {
      id: contract.id,
      packageName: contract.packageName || 'Gói tập Aura',
      status: contractEffectiveStatus || 'invalid',
      storedStatus: contract.status || 'active',
      startDate: contract.startDate || null,
      endDate: contract.endDate || null,
      daysRemaining,
      ...usage,
      payment,
      pausePeriods: Array.isArray(contract.pausePeriods) ? contract.pausePeriods.slice(-20) : [],
      extensions: Array.isArray(contract.extensions) ? contract.extensions.slice(-20) : [],
    } : null,
    schedule: {
      weekId,
      weekEnd: currentWeekEnd,
      requiredSessions: requiredPerWeek,
      bookedSessions: weekSessions.length,
      nextSession: upcoming[0] ? {
        id: upcoming[0].id,
        date: sessionDate(upcoming[0]),
        hour: finite(upcoming[0].hour, null),
        trainerId: upcoming[0].trainerId || '',
        trainerName: bounded(upcoming[0].trainerName, 160) || trainerNameById[upcoming[0].trainerId] || 'PT Aura',
        branchId: upcoming[0].branchId || assignments.branchId || '',
        branchName: bounded(upcoming[0].branchName, 160) || branchNameById[upcoming[0].branchId] || (upcoming[0].branchId === assignments.branchId ? assignments.branchName : '') || 'Chi nhánh Aura',
        status: upcoming[0].status || 'scheduled',
      } : null,
      sessions: weekSessions.slice(0, 8).map((item) => ({
        id: item.id,
        date: sessionDate(item),
        hour: finite(item.hour, null),
        trainerId: item.trainerId || '',
        trainerName: bounded(item.trainerName, 160) || trainerNameById[item.trainerId] || 'PT Aura',
        branchId: item.branchId || assignments.branchId || '',
        branchName: bounded(item.branchName, 160) || branchNameById[item.branchId] || (item.branchId === assignments.branchId ? assignments.branchName : '') || 'Chi nhánh Aura',
        status: item.status || '',
        attendanceStatus: sessionAttendance(item),
      })),
      availability: {
        slots,
        confirmed: confirmedAvailability,
        source: availability?.source || (sources.student.latestSubmittedAvailability ? 'inherited_weekly' : sources.student.availableSlots?.length ? 'legacy_default' : 'none'),
        sourceWeekId: availability?.sourceWeekId || availability?.weekId || null,
        minimumSlots: Math.max(5, finite(availability?.minimumSlots, 5)),
      },
    },
    attendance: { rate28Days: attendanceRate, attended, late, noShow, total: attendanceRows.length, weeklyTrend, lastAttendanceAt },
    training: {
      adherence28Days: trainingAdherence,
      completed28Days: completed28,
      target28Days: trainingTarget28,
      workoutLogCount: sources.workoutLogs.length,
      latestWorkoutAt: sources.workoutLogs.length ? iso(Math.max(...sources.workoutLogs.map((item) => timestampMillis(item.completedAt || item.updatedAt || item.createdAt) || dateKeyMillis(item.date)))) : null,
      program: sources.trainingProgram ? {
        id: sources.trainingProgram.id,
        title: sources.trainingProgram.title || 'Giáo án Aura',
        goal: sources.trainingProgram.goal || '',
        status: sources.trainingProgram.status || 'draft',
        revision: Math.max(0, finite(sources.trainingProgram.revision)),
        trainingDays: Array.isArray(sources.trainingProgram.trainingDays) ? sources.trainingProgram.trainingDays.slice(0, 12) : [],
      } : null,
      recentLogs: sources.workoutLogs.sort((left, right) => timestampMillis(right.completedAt || right.updatedAt || right.createdAt) - timestampMillis(left.completedAt || left.updatedAt || left.createdAt)).slice(0, 12).map((item) => ({
        id: item.id,
        date: item.date || (iso(item.completedAt || item.updatedAt || item.createdAt) || '').slice(0, 10),
        title: item.trainingDayTitle || item.programName || item.exerciseName || item.title || 'Buổi tập',
        painNotes: bounded(item.painNotes || item.painNote, 300) || null,
        completedSets: finite(item.metrics?.completedSets ?? item.completedSets),
        totalVolumeKg: finite(item.metrics?.totalVolumeKg ?? item.totalLoadKg),
        maximumWeightKg: finite(item.metrics?.maximumWeightKg),
      })),
    },
    nutrition,
    progress,
    renewal: renewal ? {
      caseId: renewal.id,
      stage: renewal.stage || 'uncontacted',
      probability: Math.max(0, Math.min(100, finite(renewal.probability))),
      riskCategory: renewal.riskCategory || renewal.risk?.category || null,
      lastContactAt: iso(renewal.lastContactAt),
      nextActionAt: iso(renewal.nextActionAt || renewal.nextFollowUpAt),
      assignedSalesId: renewal.assignedSalesId || '',
    } : null,
    health,
    alerts: sortedAlerts,
    nextActions: actions,
    dataQuality: [
      !sources.accountUid ? { code: 'MISSING_ACCOUNT_LINK', severity: 'warning', message: 'Học viên chưa liên kết tài khoản Aura; tiến độ và dinh dưỡng có thể thiếu.' } : null,
      sources.accountUid && sources.accountLinkSource === 'roleAssignments.crmProfileId' ? { code: 'LEGACY_ACCOUNT_LINK', severity: 'warning', message: 'Đang dùng liên kết tài khoản từ dữ liệu cũ; dữ liệu dinh dưỡng vẫn được đồng bộ an toàn.' } : null,
      usage.reconciliationStatus !== 'matched' ? { code: 'CONTRACT_USAGE_MISMATCH', severity: 'warning', message: 'Số buổi hợp đồng cần đối soát với lịch sử.' } : null,
      sources.sessions.length >= 1000 ? { code: 'SESSION_LIMIT_REACHED', severity: 'warning', message: 'Lịch sử vượt giới hạn xem nhanh.' } : null,
    ].filter(Boolean),
  }
  if (persist) {
    await Promise.all([
      db.doc(`studentOperationalViews/${studentId}`).set(projection, { merge: false }),
      upsertTimeline(db, timeline),
    ])
  }
  return projection
}

function actorIds(actor) {
  return new Set(normalizedArray([actor.uid, actor.legacyStaffId]))
}

function includesActor(values, ids) {
  return normalizedArray(values).some((id) => ids.has(id))
}

function permissionsFor(actor, projection) {
  if (!actor || actor.accessRole === 'student') throw new HttpsError('permission-denied', 'Học viên 360 chỉ dành cho nhân sự Aura.')
  const ids = actorIds(actor)
  const admin = ['admin', 'super_admin'].includes(actor.accessRole) || actor.capabilities.includes('pt.operations.manage')
  const sameBranch = projection.assignments.branchId && normalizedArray(actor.branchIds).includes(projection.assignments.branchId)
  const manager = sameBranch && actor.capabilities.includes('branch.operations.view')
  const assignedTrainer = includesActor(projection.assignments.trainerIds, ids)
  const assignedCoach = includesActor(projection.assignments.nutritionCoachIds, ids)
  const assignedSales = includesActor(projection.assignments.salesIds, ids)
    || (projection.renewal?.assignedSalesId && ids.has(projection.renewal.assignedSalesId))
  if (!admin && !manager && !assignedTrainer && !assignedCoach && !assignedSales) {
    throw new HttpsError('permission-denied', 'Học viên không thuộc phạm vi được giao.')
  }
  const canViewFinancialAmounts = admin || (sameBranch && actor.capabilities.includes('branch.finance.view'))
  return {
    scope: admin ? 'system' : manager ? 'branch' : assignedSales && !assignedTrainer && !assignedCoach ? 'sales' : 'assigned',
    canViewOperations: admin || manager || assignedTrainer,
    canViewTraining: admin || assignedTrainer,
    canViewNutrition: admin || assignedTrainer || assignedCoach,
    canViewProgress: admin || assignedTrainer || assignedCoach,
    canViewProgressPhotos: admin || assignedTrainer || assignedCoach,
    // Progress check-ins may be recorded by the branch manager or the
    // assigned coaching team. The write still goes through the callable so
    // Staff never needs broad Firestore/Storage write rules.
    canManageProgress: admin || manager || assignedTrainer || assignedCoach,
    canViewFinancialStatus: true,
    canViewFinancialAmounts,
    canViewRenewal: admin || manager || assignedSales || actor.capabilities.includes('renewals.case.assigned_student.support'),
    canManageCare: true,
    canManageContract: admin || manager,
    canRefreshProjection: admin,
  }
}

function audienceAllowed(audience, permissions) {
  if (audience === 'finance') return permissions.canViewFinancialStatus
  if (audience === 'coaching') return permissions.canViewTraining || permissions.canViewNutrition || permissions.canViewProgress
  if (audience === 'sales') return permissions.canViewRenewal
  if (audience === 'admin') return permissions.scope === 'system'
  if (audience === 'operations') return permissions.canViewOperations
  if (audience === 'care') return permissions.canManageCare
  return false
}

function actionAllowed(action, permissions) {
  if (action === 'nutrition') return permissions.canViewNutrition
  if (action === 'training') return permissions.canViewTraining
  if (action === 'progress') return permissions.canViewProgress
  if (action === 'renewal') return permissions.canViewRenewal
  if (action === 'finance') return permissions.canViewFinancialStatus
  if (action === 'schedule') return permissions.canViewOperations
  if (action === 'contract') return permissions.canViewOperations || permissions.canViewRenewal
  if (action === 'contact') return permissions.canManageCare
  return false
}

function redactProjection(projection, permissions) {
  const result = structuredClone(projection)
  result.permissions = permissions
  if (!permissions.canViewTraining) result.training = { restricted: true }
  if (!permissions.canViewNutrition) result.nutrition = null
  if (!permissions.canViewProgress) result.progress = null
  if (!permissions.canViewRenewal) result.renewal = null
  if (!permissions.canViewOperations) {
    result.schedule = {
      weekId: result.schedule?.weekId || mondayDateKey(),
      weekEnd: result.schedule?.weekEnd || addDays(mondayDateKey(), 6),
      requiredSessions: 0,
      bookedSessions: 0,
      nextSession: null,
      sessions: [],
      availability: { slots: [], confirmed: false, source: 'restricted', sourceWeekId: null, minimumSlots: 5 },
    }
    result.attendance = { rate28Days: null, attended: 0, late: 0, noShow: 0, total: 0, weeklyTrend: [], lastAttendanceAt: null }
  }
  if (result.contract?.payment && !permissions.canViewFinancialAmounts) {
    result.contract.payment = { status: result.contract.payment.status, nextPaymentDate: result.contract.payment.nextPaymentDate }
  }
  result.alerts = result.alerts.filter((item) => audienceAllowed(item.audience, permissions) && actionAllowed(item.action, permissions)).map((item) => item.audience === 'finance' && !permissions.canViewFinancialAmounts ? { ...item, message: 'Trạng thái thanh toán cần được bộ phận phụ trách xử lý.' } : item)
  result.nextActions = result.nextActions.filter((item) => audienceAllowed(item.audience, permissions) && actionAllowed(item.action, permissions)).slice(0, 3)
  if (result.health?.components) {
    result.health.components = result.health.components.filter((item) => {
      if (['attendance', 'engagement'].includes(item.id)) return permissions.canViewOperations
      if (item.id === 'training') return permissions.canViewTraining
      if (item.id === 'nutrition') return permissions.canViewNutrition
      if (item.id === 'progress') return permissions.canViewProgress
      if (item.id === 'payment') return permissions.canViewFinancialStatus
      if (item.id === 'renewal') return permissions.canViewRenewal
      return false
    })
  }
  return result
}

async function loadAuthorizedProjection(db, actor, studentId, weekId, forceRefresh = false) {
  const reference = db.doc(`studentOperationalViews/${studentId}`)
  const snapshot = await reference.get()
  const stored = snapshot.exists ? snapshot.data() : null
  const stale = !stored || stored.schemaVersion !== OVERVIEW_SCHEMA_VERSION || Date.now() - finite(stored.generatedAtMillis) > PROJECTION_MAX_AGE_MS || stored.schedule?.weekId !== weekId
  const projection = forceRefresh || stale ? await buildStudent360Projection({ db, studentId, weekId, persist: true }) : stored
  return { projection, permissions: permissionsFor(actor, projection), cache: { hit: !forceRefresh && !stale, stale: false, maxAgeSeconds: PROJECTION_MAX_AGE_MS / 1000 } }
}

function safeTimelineEvent(event, permissions) {
  if (!audienceAllowed(event.audience, permissions)) return null
  if (event.type === 'nutrition' && !permissions.canViewNutrition) return null
  if (event.type === 'progress' && !permissions.canViewProgress) return null
  if (event.type === 'workout' && !permissions.canViewTraining) return null
  if (['training', 'off', 'freeze', 'schedule_change'].includes(event.type) && !permissions.canViewOperations) return null
  const result = { ...event, metadata: { ...(event.metadata || {}) } }
  if (event.audience === 'finance' && !permissions.canViewFinancialAmounts) {
    delete result.metadata.amount
    result.description = 'Trạng thái tài chính hợp đồng đã được cập nhật.'
  }
  return result
}

async function studentIdFromAccountUid(db, accountUid) {
  const uid = safeAccountUid(accountUid)
  if (!uid) return null
  const snapshot = await db.collection('students').where('accountUid', '==', uid).limit(2).get()
  if (snapshot.size === 1) return snapshot.docs[0].id

  // Legacy provisioning stored the CRM id on the role assignment but did not
  // backfill students.accountUid. Resolve only an explicit student assignment
  // and verify that the CRM profile still exists; never infer from a name or
  // phone number.
  const assignment = await db.doc(`roleAssignments/${uid}`).get()
  if (!assignment.exists) return null
  const value = assignment.data() || {}
  const role = bounded(value.accessRole || value.role, 40)
  const crmProfileId = safeAccountUid(value.crmProfileId)
  if ((role && role !== 'student') || !crmProfileId) return null
  const student = await db.doc(`students/${crmProfileId}`).get()
  return student.exists ? crmProfileId : null
}

async function resolveEventStudentId(db, event) {
  const after = event.data?.after?.exists ? event.data.after.data() : null
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const value = after || before || {}
  if (value.studentId) return bounded(value.studentId, 200)
  if (value.userId) return studentIdFromAccountUid(db, bounded(value.userId, 200))
  if (event.params?.studentId) return bounded(event.params.studentId, 200)
  if (event.params?.accountUid) return studentIdFromAccountUid(db, event.params.accountUid)
  if (event.params?.userId) return studentIdFromAccountUid(db, event.params.userId)
  if (event.params?.availabilityId) return bounded(event.params.availabilityId, 200).replace(/_\d{4}-\d{2}-\d{2}$/, '')
  return null
}

async function syncStudent360ProjectionFromEvent({ db, event, logger = console }) {
  const studentId = await resolveEventStudentId(db, event)
  if (!studentId) return { skipped: true, reason: 'student_not_resolved' }
  try {
    await buildStudent360Projection({ db, studentId, weekId: mondayDateKey(), persist: true })
    return { skipped: false, studentId }
  } catch (error) {
    if (error?.code === 'functions/not-found' || error?.code === 'not-found') return { skipped: true, reason: 'student_deleted', studentId }
    logger.error('student_360_projection_sync_failed', { studentId, code: error?.code || 'unknown' })
    throw error
  }
}

async function reconcileStudent360ProjectionBatch({ db, logger = console, batchSize = 25, staleAfterDays = 7 }) {
  const stateReference = db.doc('systemJobs/student360ProjectionReconciliation')
  const stateSnapshot = await stateReference.get()
  const cursor = bounded(stateSnapshot.exists ? stateSnapshot.data()?.cursor : '', 200)
  let query = db.collection('students').orderBy(FieldPath.documentId()).limit(Math.max(1, Math.min(50, batchSize)))
  if (cursor) query = query.startAfter(cursor)
  let students = await query.get()
  if (students.empty && cursor) students = await db.collection('students').orderBy(FieldPath.documentId()).limit(Math.max(1, Math.min(50, batchSize))).get()
  if (students.empty) {
    await stateReference.set({ cursor: '', checkedAt: FieldValue.serverTimestamp(), checkedCount: 0, rebuiltCount: 0 }, { merge: true })
    return { checkedCount: 0, rebuiltCount: 0, cursor: '' }
  }
  const projectionSnapshots = await db.getAll(...students.docs.map((item) => db.doc(`studentOperationalViews/${item.id}`)))
  const staleBefore = Date.now() - Math.max(1, staleAfterDays) * 86_400_000
  const rebuildIds = projectionSnapshots.filter((item) => !item.exists
    || item.data()?.schemaVersion !== OVERVIEW_SCHEMA_VERSION
    || finite(item.data()?.generatedAtMillis) < staleBefore).map((item) => item.id)
  let rebuiltCount = 0
  for (let offset = 0; offset < rebuildIds.length; offset += 3) {
    const chunk = rebuildIds.slice(offset, offset + 3)
    const results = await Promise.allSettled(chunk.map((studentId) => buildStudent360Projection({ db, studentId, weekId: mondayDateKey(), persist: true })))
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') rebuiltCount += 1
      else logger.error('student_360_projection_reconcile_failed', { studentId: chunk[index], code: result.reason?.code || 'unknown' })
    })
  }
  const nextCursor = students.size < Math.max(1, Math.min(50, batchSize)) ? '' : students.docs[students.docs.length - 1].id
  await stateReference.set({
    cursor: nextCursor,
    checkedAt: FieldValue.serverTimestamp(),
    checkedCount: students.size,
    rebuiltCount,
    schemaVersion: OVERVIEW_SCHEMA_VERSION,
  }, { merge: true })
  return { checkedCount: students.size, rebuiltCount, cursor: nextCursor }
}

function createStudent360Functions({ db, onCall, storage, logger = console }) {
  // These callables are Firestore-I/O bound. Fractional Gen 1 CPU keeps new
  // revisions deployable inside the regional quota while bounded instances
  // absorb normal Staff/Admin bursts without reserving full vCPUs per service.
  const readCall = (handler) => onCall({ cpu: 'gcf_gen1', concurrency: 1, maxInstances: 8, invoker: 'public' }, handler)
  const writeCall = (handler) => onCall({ cpu: 'gcf_gen1', concurrency: 1, maxInstances: 4, invoker: 'public' }, handler)

  const contractWorkspace = async (actor, studentId, projection, permissions) => {
    const [contractSnapshot, sessionSnapshot] = await Promise.all([
      db.collection('contracts').where('studentId', '==', studentId).limit(50).get(),
      db.collection('sessions').where('studentId', '==', studentId).limit(1000).get(),
    ])
    const sessions = sessionSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    const usageByContract = new Map(contractSnapshot.docs.map((item) => [item.id, contractUsage({ id: item.id, ...item.data() }, sessions)]))
    const ids = actorIds(actor)
    const contracts = contractSnapshot.docs
      .filter((item) => {
        if (permissions.scope === 'system') return true
        const value = item.data() || {}
        if (item.id === projection.contract?.id) return true
        if (permissions.scope === 'branch') return normalizedArray(actor.branchIds).includes(bounded(value.branchId, 200))
        if (permissions.scope === 'sales') return includesActor([value.assignedSalesId], ids)
        return includesActor([value.trainerId, ...normalizedArray(value.trainerIds), ...normalizedArray(value.nutritionPTIds)], ids)
      })
      .map((item) => contractWorkspaceRecord(item, permissions.canViewFinancialAmounts, permissions.canManageContract, usageByContract.get(item.id)))
      .sort((left, right) => right.startDate.localeCompare(left.startDate) || right.id.localeCompare(left.id))
    const canManageFinancials = actor.capabilities.includes('finance.operations.manage')
    if (!permissions.canManageContract) {
      return {
        schemaVersion: 1,
        student: {
          id: projection.identity.id,
          name: projection.identity.name,
          phone: projection.identity.phone,
          email: projection.identity.email,
        },
        activeContractId: projection.contract?.id || contracts[0]?.id || null,
        permissions: {
          canManageContract: false,
          canCreateContract: false,
          canEditFinancialTerms: false,
          canCollectPayments: false,
          canViewFinancialAmounts: permissions.canViewFinancialAmounts,
        },
        contracts,
        packages: [],
        trainers: [],
        branches: [],
      }
    }

    const [packageSnapshot, trainerSnapshot, branchSnapshot] = await Promise.all([
      db.collection('packages').limit(300).get(),
      db.collection('trainers').limit(300).get(),
      db.collection('branches').limit(200).get(),
    ])
    const systemScope = permissions.scope === 'system'
    const allowedBranches = new Set(systemScope ? branchSnapshot.docs.map((item) => item.id) : normalizedArray(actor.branchIds))
    const branchId = projection.assignments.branchId
    const branches = branchSnapshot.docs
      .filter((item) => item.data()?.status !== 'archived' && (systemScope || allowedBranches.has(item.id)))
      .map((item) => ({ id: item.id, name: bounded(item.data()?.name, 160) || item.id }))
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'))
    const packages = packageSnapshot.docs
      .filter((item) => {
        const itemBranch = bounded(item.data()?.branchId, 200)
        return !itemBranch || systemScope || allowedBranches.has(itemBranch) || itemBranch === branchId
      })
      .map((item) => ({
        id: item.id,
        name: bounded(item.data()?.name, 160) || item.id,
        totalSessions: Math.max(0, Math.floor(finite(item.data()?.totalSessions))),
        price: Math.max(0, Math.floor(finite(item.data()?.price))),
        durationMonths: Math.max(1, Math.floor(finite(item.data()?.durationMonths, 1))),
        branchId: bounded(item.data()?.branchId, 200) || null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'))
    const referencedAssigneeIds = new Set(contracts.flatMap((contract) => [
      ...normalizedArray(contract.trainerIds?.length ? contract.trainerIds : [contract.trainerId]),
      ...normalizedArray(contract.nutritionPTIds),
    ]))
    const branchNames = new Map(branchSnapshot.docs.map((item) => [item.id, bounded(item.data()?.name, 160) || item.id]))
    const trainers = trainerSnapshot.docs
      .filter((item) => {
        const itemBranch = bounded(item.data()?.branchId, 200)
        const selectable = item.data()?.status !== 'inactive'
          && (systemScope || !itemBranch || allowedBranches.has(itemBranch) || itemBranch === branchId)
        // Keep legacy assignees visible on the exact authorized contract so
        // an Admin can explicitly remove a stale cross-branch/inactive link.
        return selectable || referencedAssigneeIds.has(item.id)
      })
      .map((item) => {
        const itemBranch = bounded(item.data()?.branchId, 200) || null
        return {
          id: item.id,
          name: bounded(item.data()?.name, 160) || item.id,
          branchId: itemBranch,
          branchName: itemBranch ? branchNames.get(itemBranch) || null : null,
          status: item.data()?.status === 'inactive' ? 'inactive' : 'active',
          referencedByContract: referencedAssigneeIds.has(item.id),
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'))
    return {
      schemaVersion: 1,
      student: {
        id: projection.identity.id,
        name: projection.identity.name,
        phone: projection.identity.phone,
        email: projection.identity.email,
      },
      activeContractId: projection.contract?.id || contracts[0]?.id || null,
      permissions: {
        canManageContract: true,
        canCreateContract: true,
        canEditFinancialTerms: canManageFinancials,
        canCollectPayments: canManageFinancials,
        canViewFinancialAmounts: permissions.canViewFinancialAmounts,
      },
      contracts,
      packages,
      trainers,
      branches,
    }
  }

  const getStudent360ContractWorkspace = readCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    const studentId = documentId(request.data?.studentId)
    const { projection, permissions } = await loadAuthorizedProjection(db, actor, studentId, mondayDateKey(), false)
    return contractWorkspace(actor, studentId, projection, permissions)
  })

  const saveStudent360ProgressCheckIn = writeCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    const studentId = documentId(request.data?.studentId)
    const rawCheckIn = request.data?.checkIn && typeof request.data.checkIn === 'object'
      ? request.data.checkIn
      : request.data
    const input = normalizeProgressCheckInInput(rawCheckIn)
    const { projection, permissions } = await loadAuthorizedProjection(db, actor, studentId, mondayDateKey(), false)
    if (!permissions.canManageProgress) {
      throw new HttpsError('permission-denied', 'Bạn chưa được cấp quyền cập nhật tiến độ của học viên này.')
    }
    const accountUid = bounded(projection.accountUid, 200)
    if (!accountUid || accountUid.includes('/')) {
      throw new HttpsError('failed-precondition', 'Học viên chưa liên kết tài khoản Aura để lưu tiến độ.')
    }

    const checkInReference = db.doc(`users/${accountUid}/progressCheckIns/${input.id}`)
    const existingCheckIn = await checkInReference.get()
    const uploadedPaths = []
    const source = ['admin', 'super_admin'].includes(actor.accessRole) ? 'admin' : 'trainer'
    try {
      let canonicalPhotos = null
      if (input.photosProvided) {
        canonicalPhotos = await Promise.all(input.photos.map(async (photo) => {
          const persisted = await persistProgressPhotoForStaff(storage, accountUid, photo, input.id, actor)
          uploadedPaths.push(persisted.storagePath)
          return persisted
        }))
      }

      const measuredValues = {
        checkInId: input.id,
        date: input.date,
        ...input.measurements,
        ...(input.measurementNote ? { measurementNote: input.measurementNote } : {}),
        ...(input.measurements.bodyFatPercentage !== undefined ? { bodyFatStatus: 'Đã cập nhật' } : {}),
        ...(input.measurements.muscleMassKg !== undefined ? { muscleStatus: 'Đã cập nhật' } : {}),
        ...(input.measurements.waistCm !== undefined ? { waistStatus: 'Đã cập nhật' } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        syncedAt: FieldValue.serverTimestamp(),
        schemaVersion: 2,
      }
      const auditFields = {
        source,
        verificationStatus: 'verified',
        recordedBy: actor.uid,
        recordedByName: actor.actorName,
        updatedBy: actor.uid,
        updatedByName: actor.actorName,
      }
      const checkInData = {
        ...measuredValues,
        ...auditFields,
        id: input.id,
        checkInId: input.id,
        date: input.date,
        ...(canonicalPhotos ? { photos: canonicalPhotos.map(({ id, angle, storagePath, checksum }) => ({ id, angle, storagePath, checksum, imageUrl: '' })) } : {}),
        ...(existingCheckIn.exists && existingCheckIn.data()?.createdAt ? { createdAt: existingCheckIn.data().createdAt } : { createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
        schemaVersion: 2,
      }
      const batch = db.batch()
      batch.set(checkInReference, checkInData, { merge: true })
      const hasMeasurements = Object.keys(input.measurements).length > 0
      if (hasMeasurements) {
        batch.set(db.doc(`users/${accountUid}/bodyMeasurements/current`), measuredValues, { merge: true })
        batch.set(db.doc(`users/${accountUid}/bodyMeasurements/${input.id}`), {
          ...measuredValues,
          ...auditFields,
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      if (input.measurements.weightKg !== undefined) {
        batch.set(db.doc(`users/${accountUid}/weightLogs/${input.id}`), {
          id: input.id,
          checkInId: input.id,
          date: input.date,
          label: input.date.slice(5).split('-').reverse().join('/'),
          weightKg: input.measurements.weightKg,
          trendKg: input.measurements.weightKg,
          ...(input.measurementNote ? { note: input.measurementNote } : {}),
          ...auditFields,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          schemaVersion: 2,
        }, { merge: true })
      }
      if (canonicalPhotos) {
        canonicalPhotos.forEach((photo) => {
          batch.set(db.doc(`users/${accountUid}/progressPhotos/${photo.id}`), {
            id: photo.id,
            checkInId: input.id,
            date: input.date,
            recordedAt: input.date,
            angle: photo.angle,
            imageUrl: '',
            storagePath: photo.storagePath,
            checksum: photo.checksum,
            images: [{ storagePath: photo.storagePath, checksum: photo.checksum, angle: photo.angle }],
            ...input.measurements,
            ...(input.measurements.bodyFatPercentage !== undefined ? { bodyFat: input.measurements.bodyFatPercentage } : {}),
            ...(input.measurementNote ? { notes: input.measurementNote, note: input.measurementNote } : {}),
            privacy: 'private',
            isPrivate: true,
            ...auditFields,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            schemaVersion: 3,
          }, { merge: true })
        })
      }
      await batch.commit()
      return { studentId, accountUid, checkInId: input.id, source, verificationStatus: 'verified' }
    } catch (error) {
      if (uploadedPaths.length && storage) {
        await Promise.allSettled(uploadedPaths.map((path) => storage.bucket().file(path).delete({ ignoreNotFound: true })))
      }
      throw error
    }
  })

  const mutateStudent360Contract = writeCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    const studentId = documentId(request.data?.studentId)
    const action = bounded(request.data?.action, 30)
    if (!['create', 'edit', 'add_sessions', 'extend', 'freeze', 'reopen', 'cancel'].includes(action)) {
      throw new HttpsError('invalid-argument', 'Nghiệp vụ hợp đồng không hợp lệ.')
    }
    const { projection, permissions } = await loadAuthorizedProjection(db, actor, studentId, mondayDateKey(), false)
    if (!permissions.canManageContract) throw new HttpsError('permission-denied', 'Bạn không có quyền thay đổi hợp đồng này.')
    const canManageFinancials = actor.capabilities.includes('finance.operations.manage')
    const input = request.data?.contract && typeof request.data.contract === 'object' ? request.data.contract : {}
    const requestedBranchId = bounded(input.branchId, 200) || projection.assignments.branchId
    if (!requestedBranchId) throw new HttpsError('failed-precondition', 'Học viên chưa được gắn chi nhánh để quản lý hợp đồng.')
    if (permissions.scope !== 'system' && !normalizedArray(actor.branchIds).includes(requestedBranchId)) {
      throw new HttpsError('permission-denied', 'Không thể chuyển hợp đồng ra ngoài chi nhánh được phân quyền.')
    }

    const contractId = action === 'create' ? db.collection('contracts').doc().id : documentId(request.data?.contractId, 'Mã hợp đồng')
    const reference = db.doc(`contracts/${contractId}`)
    const auditReference = db.collection('contractAuditLogs').doc()
    const now = Date.now()
    const expectedRevision = action === 'create' ? null : nonNegativeInteger(request.data?.expectedRevision, 'Phiên bản hợp đồng', 10_000_000)
    const result = await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(reference)
      if (action === 'create' && currentSnapshot.exists) throw new HttpsError('already-exists', 'Mã hợp đồng đã tồn tại.')
      if (action !== 'create' && !currentSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
      const current = currentSnapshot.exists ? currentSnapshot.data() : null
      if (current && bounded(current.studentId, 200) !== studentId) throw new HttpsError('permission-denied', 'Hợp đồng không thuộc học viên đang mở.')
      if (current && permissions.scope !== 'system' && !normalizedArray(actor.branchIds).includes(bounded(current.branchId, 200))) {
        throw new HttpsError('permission-denied', 'Hợp đồng lịch sử thuộc chi nhánh ngoài phạm vi được giao.')
      }
      const revision = current ? Math.max(0, Math.floor(finite(current.revision))) : 0
      if (current && revision !== expectedRevision) throw new HttpsError('aborted', 'Hợp đồng vừa được người khác cập nhật. Hãy tải lại trước khi lưu.')

      let next = current ? { ...current } : {}
      let reason = bounded(request.data?.reason, 500)
      let eventDetails = null
      if (action === 'create' || action === 'edit') {
        const packageId = documentId(input.packageId, 'Gói tập')
        const packageSnapshot = await transaction.get(db.doc(`packages/${packageId}`))
        if (!packageSnapshot.exists) throw new HttpsError('failed-precondition', 'Gói tập đã chọn không còn tồn tại.')
        const packageValue = packageSnapshot.data()
        const packageBranchId = bounded(packageValue.branchId, 200)
        if (packageBranchId && packageBranchId !== requestedBranchId) throw new HttpsError('failed-precondition', 'Gói tập không thuộc chi nhánh đã chọn.')
        const trainerIds = normalizedArray(input.trainerIds?.length ? input.trainerIds : [input.trainerId]).slice(0, 6)
        const nutritionPTIds = normalizedArray(input.nutritionPTIds).slice(0, 6)
        const assigneeIds = [...new Set([...trainerIds, ...nutritionPTIds])]
        if (assigneeIds.length) {
          const assignees = await Promise.all(assigneeIds.map((id) => transaction.get(db.doc(`trainers/${documentId(id, 'Nhân sự')}`))))
          const invalidAssignees = contractAssigneeIssues(assigneeIds, assignees, requestedBranchId)
          if (invalidAssignees.length) {
            const names = invalidAssignees.map((item) => item.name).join(', ')
            throw new HttpsError(
              'failed-precondition',
              `Không thể lưu vì PT/coach cần xử lý: ${names}. Hãy gỡ hoặc chọn lại người cùng chi nhánh.`,
              { issueCode: 'CONTRACT_ASSIGNEE_INVALID', assignees: invalidAssignees },
            )
          }
        }
        const startDate = contractDateKey(input.startDate || current?.startDate, 'Ngày bắt đầu')
        const endDate = contractDateKey(input.endDate || current?.endDate || addCalendarMonths(startDate, packageValue.durationMonths), 'Ngày kết thúc')
        if (endDate < startDate) throw new HttpsError('invalid-argument', 'Ngày kết thúc phải từ ngày bắt đầu trở đi.')
        if (action === 'create') {
          const existingContracts = await transaction.get(db.collection('contracts').where('studentId', '==', studentId).limit(50))
          const overlap = existingContracts.docs.some((item) => {
            const value = item.data()
            if (!['active', 'future', 'frozen'].includes(value.status)) return false
            const existingStart = bounded(value.startDate, 30).slice(0, 10)
            const existingEnd = bounded(value.endDate, 30).slice(0, 10)
            return existingStart && existingEnd && startDate <= existingEnd && endDate >= existingStart
          })
          if (overlap) throw new HttpsError('failed-precondition', 'Khoảng hiệu lực bị trùng một hợp đồng đang hoạt động, sắp hiệu lực hoặc bảo lưu. Hãy dùng quy trình tái ký hoặc chọn ngày bắt đầu sau hợp đồng hiện tại.')
        }
        const usedSessions = Math.max(0, Math.floor(finite(current?.usedSessions)))
        const totalSessions = input.totalSessions === undefined
          ? Math.max(0, Math.floor(finite(packageValue.totalSessions)))
          : nonNegativeInteger(input.totalSessions, 'Tổng số buổi', 100_000)
        if (totalSessions < usedSessions) throw new HttpsError('failed-precondition', 'Tổng số buổi không thể thấp hơn số buổi đã sử dụng.')
        const currentTotalPrice = Math.max(0, Math.floor(finite(current?.totalPrice, packageValue.price)))
        const currentDiscount = Math.max(0, Math.floor(finite(current?.discount)))
        const financialFieldsRequested = ['totalPrice', 'discount', 'installments'].some((key) => Object.prototype.hasOwnProperty.call(input, key))
        if (financialFieldsRequested && !canManageFinancials) throw new HttpsError('permission-denied', 'Chỉ bộ phận tài chính được sửa giá và lịch thanh toán.')
        const totalPrice = canManageFinancials && input.totalPrice !== undefined ? nonNegativeInteger(input.totalPrice, 'Giá trị hợp đồng') : currentTotalPrice
        const discount = canManageFinancials && input.discount !== undefined ? nonNegativeInteger(input.discount, 'Giảm giá') : currentDiscount
        if (discount > totalPrice) throw new HttpsError('invalid-argument', 'Giảm giá không thể lớn hơn giá trị hợp đồng.')
        const paidAmount = Math.max(0, Math.floor(finite(current?.paidAmount)))
        const outstanding = totalPrice - discount - paidAmount
        if (outstanding < 0) throw new HttpsError('failed-precondition', 'Giá trị mới thấp hơn số tiền đã thu; hãy xử lý hoàn tiền trước.')
        let installments = Array.isArray(current?.installments) ? current.installments : []
        if (canManageFinancials && Object.prototype.hasOwnProperty.call(input, 'installments')) {
          installments = contractInstallments(input.installments, current?.installments || [], outstanding)
        }
        if (action === 'create' && outstanding > 0 && !installments.some((item) => item.status === 'pending')) {
          installments = [{ id: `${contractId}-installment-1`, amount: outstanding, date: startDate, status: 'pending' }]
        }
        const nextPending = installments.filter((item) => item.status === 'pending').sort((left, right) => bounded(left.date, 10).localeCompare(bounded(right.date, 10)))[0]
        next = {
          ...next,
          studentId,
          branchId: requestedBranchId,
          packageId,
          packageName: bounded(packageValue.name, 160) || packageId,
          trainerId: trainerIds[0] || null,
          trainerIds,
          nutritionPTIds,
          startDate,
          endDate,
          totalSessions,
          usedSessions,
          totalPrice,
          discount,
          paidAmount,
          installments,
          nextPaymentDate: nextPending?.date || null,
          status: action === 'create' ? (startDate > vietnamDateKey() ? 'future' : 'active') : current.status,
          note: bounded(input.note, 1_000) || bounded(current?.note, 1_000),
        }
        if (action === 'create') {
          next.policyVersion = PT_OPERATIONS_POLICY_VERSION
          next.policyEffectiveFrom = PT_OPERATIONS_POLICY_EFFECTIVE_FROM
        }
      } else if (action === 'add_sessions') {
        if (!canManageFinancials) throw new HttpsError('permission-denied', 'Chỉ bộ phận tài chính được ghi nhận mua thêm buổi.')
        if (!['active', 'future', 'frozen'].includes(bounded(current.status, 30))) {
          throw new HttpsError('failed-precondition', 'Chỉ hợp đồng đang hiệu lực, sắp hiệu lực hoặc bảo lưu mới được mua thêm buổi.')
        }
        if (reason.length < 2) throw new HttpsError('invalid-argument', 'Vui lòng nhập nội dung thỏa thuận mua thêm buổi.')
        const extraSessions = nonNegativeInteger(request.data?.extraSessions, 'Số buổi mua thêm', 100_000)
        if (!extraSessions) throw new HttpsError('invalid-argument', 'Số buổi mua thêm phải lớn hơn 0.')
        const extraDurationMonths = nonNegativeInteger(request.data?.extraDurationMonths, 'Số tháng gia hạn', 120)
        const extraPrice = nonNegativeInteger(request.data?.extraPrice, 'Giá trị mua thêm')
        const previousEndDate = contractDateKey(current.endDate, 'Ngày hết hạn hiện tại')
        const newEndDate = extraDurationMonths ? addCalendarMonths(previousEndDate, extraDurationMonths) : previousEndDate
        const installments = Array.isArray(current.installments) ? [...current.installments] : []
        if (extraPrice) {
          if (installments.length >= 24) throw new HttpsError('failed-precondition', 'Hợp đồng đã đạt tối đa 24 kỳ thanh toán.')
          const paymentDueDate = contractDateKey(request.data?.paymentDueDate, 'Ngày hẹn thanh toán')
          if (paymentDueDate < vietnamDateKey()) throw new HttpsError('invalid-argument', 'Ngày hẹn thanh toán không thể ở quá khứ.')
          installments.push({ id: `${contractId}-addon-${auditReference.id}`, amount: extraPrice, date: paymentDueDate, status: 'pending' })
        }
        const nextPending = installments.filter((item) => item.status === 'pending' && item.date).sort((left, right) => bounded(left.date, 10).localeCompare(bounded(right.date, 10)))[0]
        next.totalSessions = Math.max(0, Math.floor(finite(current.totalSessions))) + extraSessions
        next.totalPrice = Math.max(0, Math.floor(finite(current.totalPrice))) + extraPrice
        next.endDate = newEndDate
        next.installments = installments
        next.nextPaymentDate = nextPending?.date || null
        next.note = bounded(`${bounded(current.note, 700)}${current.note ? '\n' : ''}Mua thêm ${extraSessions} buổi: ${reason}`, 1_000)
        if (newEndDate !== previousEndDate) {
          next.extensions = [...(Array.isArray(current.extensions) ? current.extensions : []), {
            id: auditReference.id,
            oldEndDate: previousEndDate,
            newEndDate,
            reason: `Mua thêm ${extraSessions} buổi · ${reason}`,
            createdAt: new Date(now).toISOString(),
            createdBy: actor.uid,
          }].slice(-100)
        }
        eventDetails = { extraSessions, extraPrice, extraDurationMonths, endDate: newEndDate }
      } else if (action === 'extend') {
        const newEndDate = contractDateKey(request.data?.newEndDate, 'Ngày hết hạn mới')
        const previousEndDate = contractDateKey(current.endDate, 'Ngày hết hạn hiện tại')
        if (newEndDate <= previousEndDate) throw new HttpsError('failed-precondition', 'Ngày hết hạn mới phải sau ngày hiện tại của hợp đồng.')
        if (reason.length < 2) throw new HttpsError('invalid-argument', 'Vui lòng nhập lý do gia hạn.')
        next.endDate = newEndDate
        next.extensions = [...(Array.isArray(current.extensions) ? current.extensions : []), {
          id: auditReference.id,
          oldEndDate: previousEndDate,
          newEndDate,
          reason,
          createdAt: new Date(now).toISOString(),
          createdBy: actor.uid,
        }].slice(-100)
      } else if (action === 'freeze') {
        if (current.status !== 'active') throw new HttpsError('failed-precondition', 'Chỉ hợp đồng đang hoạt động mới có thể bảo lưu.')
        next.status = 'frozen'
        next.frozenAt = new Date(now).toISOString()
        reason ||= 'Bảo lưu từ Học viên 360'
      } else if (action === 'reopen') {
        if (current.status !== 'frozen') throw new HttpsError('failed-precondition', 'Hợp đồng chưa ở trạng thái bảo lưu.')
        const frozenAt = timestampMillis(current.frozenAt)
        const frozenDays = frozenAt ? Math.max(0, daysBetween(vietnamDateKey(new Date(frozenAt)), vietnamDateKey(new Date(now)))) : 0
        const previousEndDate = contractDateKey(current.endDate, 'Ngày hết hạn hiện tại')
        const newEndDate = addDays(previousEndDate, frozenDays)
        next.status = 'active'
        next.frozenAt = null
        next.endDate = newEndDate
        next.extensions = frozenDays ? [...(Array.isArray(current.extensions) ? current.extensions : []), {
          id: auditReference.id,
          oldEndDate: previousEndDate,
          newEndDate,
          reason: `Cộng ${frozenDays} ngày bảo lưu`,
          createdAt: new Date(now).toISOString(),
          createdBy: actor.uid,
        }].slice(-100) : current.extensions || []
        reason ||= `Mở lại sau ${frozenDays} ngày bảo lưu`
      } else if (action === 'cancel') {
        if (current.status === 'cancelled') throw new HttpsError('failed-precondition', 'Hợp đồng đã được hủy trước đó.')
        if (reason.length < 2) throw new HttpsError('invalid-argument', 'Vui lòng nhập lý do hủy hợp đồng.')
        const cancelDebt = request.data?.cancelDebt === true
        if (cancelDebt && !canManageFinancials) throw new HttpsError('permission-denied', 'Chỉ bộ phận tài chính được hủy công nợ còn lại.')
        next.status = 'cancelled'
        next.cancelledAt = new Date(now).toISOString()
        next.cancelledReason = reason
        next.note = bounded(`${bounded(current.note, 700)}${current.note ? '\n' : ''}Lý do hủy: ${reason}`, 1_000)
        if (cancelDebt) {
          next.installments = (Array.isArray(current.installments) ? current.installments : []).map((item) => item.status === 'pending' ? { ...item, status: 'cancelled' } : item)
          next.nextPaymentDate = null
        }
      }

      if (['create', 'edit', 'add_sessions', 'extend', 'reopen'].includes(action)
        && !['cancelled', 'frozen'].includes(bounded(next.status, 30))) {
        const status = effectiveContractStatus(next, vietnamDateKey(new Date(now)))
        if (['active', 'future', 'expired'].includes(status)) next.status = status
      }

      const changedFields = current
        ? [...new Set([...Object.keys(current), ...Object.keys(next)])].filter((key) => JSON.stringify(current[key]) !== JSON.stringify(next[key])).slice(0, 80)
        : Object.keys(next).slice(0, 80)
      const nextRevision = revision + 1
      const persisted = {
        ...next,
        revision: nextRevision,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        updatedByName: actor.actorName,
        student360LastActivityId: auditReference.id,
        student360LastAction: action,
      }
      if (action === 'create') {
        persisted.createdAt = FieldValue.serverTimestamp()
        persisted.createdBy = actor.uid
        transaction.create(reference, persisted)
      } else {
        transaction.set(reference, persisted, { merge: false })
      }
      transaction.create(auditReference, {
        schemaVersion: 1,
        action: `student360.contract.${action}`,
        studentId,
        contractId,
        branchId: requestedBranchId,
        actorUid: actor.uid,
        actorName: actor.actorName,
        previousRevision: revision,
        revision: nextRevision,
        changedFields,
        reason: reason || null,
        beforeStatus: current?.status || null,
        afterStatus: next.status || null,
        createdAt: FieldValue.serverTimestamp(),
      })
      const event = timelineEvent(
        studentId,
        'contract',
        auditReference.id,
        now,
        contractMutationTitle(action),
        contractMutationDescription(action, { ...next, ...eventDetails, reason }),
        'finance',
        { contractId, action, status: next.status || '', actorName: actor.actorName, changedFields, ...(eventDetails || {}) },
        'contractAuditLogs',
      )
      transaction.set(db.doc(`studentTimelineEvents/${event.id}`), event)
      return { contractId, revision: nextRevision, action }
    })

    try {
      await buildStudent360Projection({ db, studentId, weekId: mondayDateKey(), persist: true })
    } catch (error) {
      logger.warn('student_360_contract_projection_refresh_deferred', { studentId, contractId, action, code: error?.code || 'unknown' })
    }
    return result
  })

  const getStudent360Overview = readCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    const studentId = documentId(request.data?.studentId)
    const weekId = bounded(request.data?.weekId, 10) || mondayDateKey()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) throw new HttpsError('invalid-argument', 'Tuần xem không hợp lệ.')
    const { projection, permissions, cache } = await loadAuthorizedProjection(db, actor, studentId, weekId, false)
    return { ...redactProjection(projection, permissions), cache }
  })

  const listStudent360Directory = readCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    if (actor.accessRole === 'student') throw new HttpsError('permission-denied', 'Học viên 360 chỉ dành cho nhân sự Aura.')
    const queryText = bounded(request.data?.query, 100).toLocaleLowerCase('vi')
    const branchId = bounded(request.data?.branchId, 200)
    const attention = bounded(request.data?.attention, 40)
    const pageSize = Math.max(1, Math.min(50, Math.floor(finite(request.data?.pageSize, 24))))
    const cursor = bounded(request.data?.cursor, 200)
    const sourcePageSize = 100
    const maximumScanned = 500
    const rows = []
    let scanned = 0
    let sourceCursor = cursor
    let sourceExhausted = false
    let stoppedOnFullPage = false

    directoryScan: while (rows.length < pageSize && scanned < maximumScanned) {
      const readLimit = Math.min(sourcePageSize, maximumScanned - scanned)
      let query = db.collection('studentOperationalViews').orderBy(FieldPath.documentId(), 'asc').limit(readLimit)
      if (sourceCursor) query = query.startAfter(sourceCursor)
      const snapshot = await query.get()
      if (snapshot.empty || snapshot.size === 0) {
        sourceExhausted = true
        break
      }
      for (let index = 0; index < snapshot.docs.length; index += 1) {
        const item = snapshot.docs[index]
        sourceCursor = item.id
        scanned += 1
        const projection = item.data()
        let permissions
        try { permissions = permissionsFor(actor, projection) } catch { continue }
        if (branchId && projection.assignments?.branchId !== branchId) continue
        if (attention && projection.health?.status !== attention) continue
        const haystack = `${projection.identity?.name || ''} ${projection.identity?.phone || ''} ${projection.identity?.email || ''}`.toLocaleLowerCase('vi')
        if (queryText && !haystack.includes(queryText)) continue
        rows.push({
          studentId: item.id,
          name: projection.identity?.name || 'Học viên Aura',
          phone: projection.identity?.phone || '',
          branchId: projection.assignments?.branchId || '',
          branchName: projection.assignments?.branchName || '',
          status: projection.identity?.status || 'active',
          health: projection.health,
          remainingSessions: projection.contract?.remainingSessions ?? null,
          daysRemaining: projection.contract?.daysRemaining ?? null,
          nextSession: projection.schedule?.nextSession || null,
          alertCount: projection.alerts?.filter((value) => audienceAllowed(value.audience, permissions)).length || 0,
        })
        if (rows.length >= pageSize) {
          stoppedOnFullPage = index < snapshot.docs.length - 1 || snapshot.size >= readLimit
          break directoryScan
        }
      }
      if (snapshot.size < readLimit) {
        sourceExhausted = true
        break
      }
    }
    rows.sort((left, right) => left.name.localeCompare(right.name, 'vi') || left.studentId.localeCompare(right.studentId))
    const scanBudgetReached = scanned >= maximumScanned && !sourceExhausted
    const hasMore = stoppedOnFullPage || scanBudgetReached
    return {
      schemaVersion: 1,
      rows,
      hasMore,
      nextCursor: hasMore ? sourceCursor || null : null,
      totalMatched: sourceExhausted && !cursor ? rows.length : null,
      scanned,
      truncated: scanBudgetReached,
    }
  })

  const listStudent360Timeline = readCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    const studentId = documentId(request.data?.studentId)
    const weekId = mondayDateKey()
    const { projection, permissions } = await loadAuthorizedProjection(db, actor, studentId, weekId, false)
    const pageSize = Math.max(1, Math.min(50, Math.floor(finite(request.data?.pageSize, 30))))
    const requestedTypes = normalizedArray(request.data?.types).slice(0, 20)
    const cursor = timelineCursor(request.data?.cursor)
    const fromMillis = Math.max(0, Math.floor(finite(request.data?.fromMillis)))
    const readPage = async () => {
      const scanLimit = 150
      const maximumScans = requestedTypes.length ? 4 : 1
      let scanCursor = cursor
      let scanned = 0
      let sourceExhausted = false
      const candidates = []
      for (let round = 0; round < maximumScans && candidates.length <= pageSize; round += 1) {
        let query = db.collection('studentTimelineEvents')
          .where('studentId', '==', studentId)
          .where('sortKey', '<', scanCursor)
        if (fromMillis) query = query.where('sortKey', '>=', fromMillis * 1000)
        const snapshot = await query.orderBy('sortKey', 'desc').limit(scanLimit).get()
        scanned += snapshot.size
        const safeRows = snapshot.docs
          .map((item) => safeTimelineEvent({ id: item.id, ...item.data() }, permissions))
          .filter(Boolean)
          .filter((item) => !requestedTypes.length || requestedTypes.includes(item.type))
        candidates.push(...safeRows)
        sourceExhausted = snapshot.size < scanLimit
        const lastSortKey = snapshot.docs[snapshot.docs.length - 1]?.data()?.sortKey
        if (sourceExhausted || !Number.isFinite(Number(lastSortKey))) break
        scanCursor = Number(lastSortKey)
      }
      return { rows: normalizeTimelineEvents(candidates).slice(0, pageSize + 1), scanned, sourceExhausted, scanCursor }
    }

    let result = await readPage()
    let timelineProjection = projection
    // Historical projects may already have a cached overview while their old
    // sessions have never been materialized into studentTimelineEvents. Repair
    // only when the requested training tab is empty and source evidence exists.
    if (!result.rows.length && requestedTypes.some((type) => ['training', 'workout'].includes(type))) {
      const [sessionEvidence, workoutEvidence, ptWorkoutEvidence] = await Promise.all([
        db.collection('sessions').where('studentId', '==', studentId).limit(1).get(),
        db.collection('workoutLogs').where('studentId', '==', studentId).limit(1).get(),
        db.collection('ptWorkoutLogs').where('studentId', '==', studentId).limit(1).get(),
      ])
      if (!sessionEvidence.empty || !workoutEvidence.empty || !ptWorkoutEvidence.empty) {
        timelineProjection = await buildStudent360Projection({ db, studentId, weekId, persist: true })
        result = await readPage()
      }
    }
    // Meal logs/reviews created before the Student 360 triggers were deployed
    // have no materialized timeline event. Repair on demand when the nutrition
    // tab is empty (and on an entirely empty "Tất cả" timeline), without
    // touching the source meal data or persisting private media.
    const nutritionFilterRequested = !requestedTypes.length || requestedTypes.includes('nutrition')
    if (!result.rows.length && nutritionFilterRequested) {
      const evidence = await nutritionTimelineEvidence(db, studentId, timelineProjection)
      const needsLinkRefresh = Boolean(evidence.accountUid && !timelineProjection.accountUid)
      if (evidence.hasEvidence || needsLinkRefresh) {
        timelineProjection = await buildStudent360Projection({ db, studentId, weekId, persist: true })
        result = await readPage()
      }
    }
    const rows = result.rows
    const hasMore = rows.length > pageSize || (!result.sourceExhausted && result.scanned > 0)
    const page = await hydrateNutritionTimelineMedia({
      db,
      storage,
      projection: timelineProjection,
      rows: rows.slice(0, pageSize),
      logger,
    })
    return {
      schemaVersion: 1,
      studentId: timelineProjection.studentId,
      rows: page,
      hasMore,
      nextCursor: hasMore
        ? page[page.length - 1]?.sortKey || result.scanCursor || null
        : null,
    }
  })

  const getStudent360NutritionActivityDetail = readCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    const studentId = documentId(request.data?.studentId)
    const requestedMealId = documentId(request.data?.mealId || request.data?.reviewId, 'Mã bữa ăn')
    const requestedReviewId = request.data?.reviewId ? documentId(request.data.reviewId, 'Mã bản duyệt') : requestedMealId
    const { projection, permissions } = await loadAuthorizedProjection(db, actor, studentId, mondayDateKey(), false)
    if (!permissions.canViewNutrition) throw new HttpsError('permission-denied', 'Bạn không có quyền xem hoạt động dinh dưỡng của học viên này.')
    const accountUid = bounded(projection.accountUid, 200)
    if (!accountUid || accountUid.includes('/')) throw new HttpsError('failed-precondition', 'Học viên chưa liên kết tài khoản Aura để đọc nhật ký dinh dưỡng.')

    const reviewSnapshot = await db.doc(`mealReviews/${requestedReviewId}`).get()
    const review = reviewSnapshot.exists ? { id: reviewSnapshot.id, ...reviewSnapshot.data() } : {}
    if (reviewSnapshot.exists && bounded(review.userId, 200) !== accountUid) {
      throw new HttpsError('not-found', 'Không tìm thấy bản duyệt thuộc học viên này.')
    }
    const reviewedMealId = mealReviewId(review)
    if (reviewedMealId && reviewedMealId !== requestedMealId) {
      throw new HttpsError('failed-precondition', 'Bản duyệt không khớp bữa ăn đang mở.')
    }
    const mealId = requestedMealId
    const mealSnapshot = await db.doc(`users/${accountUid}/mealLogs/${documentId(mealId, 'Mã bữa ăn')}`).get()
    const meal = mealSnapshot.exists ? { id: mealSnapshot.id, ...mealSnapshot.data() } : {}
    if (!mealSnapshot.exists && !reviewSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy bữa ăn trong nhật ký của học viên.')

    const source = Object.keys(meal).length ? meal : review.meal && typeof review.meal === 'object' ? review.meal : {}
    const storagePath = safeStudentMealImagePath(source.imageStoragePath, accountUid, mealId)
    const imageUrl = await mealImageUrl(storage, storagePath, source.image || source.imageUrl || source.img, logger, { studentId, mealId })
    return {
      ...nutritionActivityDetailRecord(mealId, meal, review, imageUrl),
      studentId,
    }
  })

  const createStudentCareActivity = writeCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    const studentId = documentId(request.data?.studentId)
    const type = ['call', 'zalo', 'note', 'action_completed'].includes(request.data?.type) ? request.data.type : ''
    if (!type) throw new HttpsError('invalid-argument', 'Loại hoạt động chăm sóc không hợp lệ.')
    const note = bounded(request.data?.note, 1000)
    if (type === 'note' && note.length < 2) throw new HttpsError('invalid-argument', 'Ghi chú cần ít nhất 2 ký tự.')
    const { projection, permissions } = await loadAuthorizedProjection(db, actor, studentId, mondayDateKey(), false)
    if (!permissions.canManageCare) throw new HttpsError('permission-denied', 'Bạn không có quyền ghi nhận chăm sóc.')
    const actionId = bounded(request.data?.actionId, 200) || null
    const activityReference = db.collection('studentCareActivities').doc()
    const now = Date.now()
    const visibility = 'care'
    const activity = {
      schemaVersion: 1,
      studentId,
      type,
      note,
      actionId,
      visibility,
      actorUid: actor.uid,
      actorName: actor.actorName,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMillis: now,
    }
    const event = timelineEvent(studentId, 'care', activityReference.id, now, type === 'call' ? 'Đã ghi nhận cuộc gọi' : type === 'zalo' ? 'Đã ghi nhận liên hệ Zalo' : type === 'action_completed' ? 'Đã hoàn tất việc chăm sóc' : 'Thêm ghi chú chăm sóc', note || 'Không có ghi chú', visibility, { activityId: activityReference.id, actionId, actorName: actor.actorName }, 'studentCareActivities')
    const batch = db.batch()
    batch.create(activityReference, activity)
    batch.set(db.doc(`studentTimelineEvents/${event.id}`), event)
    await batch.commit()
    return { activityId: activityReference.id, createdAt: new Date(now).toISOString() }
  })

  const getStudent360ProgressPhotos = readCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    const studentId = documentId(request.data?.studentId)
    const { projection, permissions } = await loadAuthorizedProjection(db, actor, studentId, mondayDateKey(), false)
    if (!permissions.canViewProgressPhotos) throw new HttpsError('permission-denied', 'Bạn không có quyền xem ảnh tiến độ của học viên này.')
    const accountUid = bounded(projection.accountUid, 200)
    if (!accountUid || accountUid.includes('/')) throw new HttpsError('failed-precondition', 'Học viên chưa liên kết tài khoản Aura để đọc ảnh tiến độ.')
    const offset = Math.max(0, Math.min(100, Math.floor(finite(request.data?.cursor, 0))))
    const pageSize = Math.max(1, Math.min(20, Math.floor(finite(request.data?.pageSize, 12))))
    const [legacy, current, checkIns] = await Promise.all([
      latestSnapshot(db.collection(`users/${accountUid}/progress_photos`), 'date', 30),
      latestSnapshot(db.collection(`users/${accountUid}/progressPhotos`), 'date', 30),
      latestSnapshot(db.collection(`users/${accountUid}/progressCheckIns`), 'date', 30),
    ])
    const documents = uniqueProgressPhotos([...legacy.docs, ...current.docs, ...checkIns.docs])
    const rows = []
    for (const document of documents) {
      const value = typeof document?.data === 'function' ? document.data() || {} : document || {}
      const progressPhotoId = bounded(document.id || value.id || value.checkInId, 120)
      const candidates = Array.isArray(value.images) ? value.images : Array.isArray(value.photos) ? value.photos : value.storagePath ? [{ storagePath: value.storagePath }] : value.imageUrl ? [{ url: value.imageUrl }] : []
      const images = []
      for (const candidate of candidates.slice(0, 4)) {
        const storagePath = typeof candidate === 'string' ? '' : bounded(candidate.storagePath, 500)
        const legacyUrl = typeof candidate === 'string' ? candidate : bounded(candidate.url || candidate.imageUrl, 2_000)
        if (storagePath && storage) {
          try {
            const [url] = await storage.bucket().file(storagePath).getSignedUrl({ action: 'read', expires: Date.now() + 5 * 60 * 1000 })
            images.push({ url, storagePath, angle: bounded(candidate.angle, 20) || null, legacy: false })
          } catch (error) {
            logger.warn('student_360_progress_photo_url_failed', { studentId, photoId: progressPhotoId, code: error?.code || 'unknown' })
          }
        } else if (legacyUrl && (legacyUrl.startsWith('data:image/') || legacyUrl.startsWith('https://'))) {
          images.push({ url: legacyUrl, storagePath: null, angle: typeof candidate === 'string' ? null : bounded(candidate.angle, 20) || null, legacy: legacyUrl.startsWith('data:image/') })
        }
      }
      if (images.length) rows.push({ id: progressPhotoId, checkInId: bounded(value.checkInId, 120) || progressPhotoId, date: bounded(value.date, 10) || progressPhotoId.slice(0, 10), images })
    }
    rows.sort((left, right) => right.date.localeCompare(left.date))
    const page = rows.slice(offset, offset + pageSize)
    const hasMore = offset + pageSize < rows.length
    return { schemaVersion: 2, studentId, rows: page, hasMore, nextCursor: hasMore ? String(offset + pageSize) : null, truncated: legacy.size >= 30 || current.size >= 30 || checkIns.size >= 30, hasLegacyImages: rows.some((row) => row.images.some((image) => image.legacy)), expiresInSeconds: 300 }
  })

  const refreshStudent360Projection = writeCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    const studentId = documentId(request.data?.studentId)
    const existing = await db.doc(`studentOperationalViews/${studentId}`).get()
    if (existing.exists) permissionsFor(actor, existing.data())
    const admin = ['admin', 'super_admin'].includes(actor.accessRole) || actor.capabilities.includes('pt.operations.manage')
    if (!admin) throw new HttpsError('permission-denied', 'Chỉ Admin được đối soát lại Student 360.')
    const projection = await buildStudent360Projection({ db, studentId, weekId: mondayDateKey(), persist: true })
    return { studentId, generatedAt: projection.generatedAt, dataQuality: projection.dataQuality }
  })

  return { getStudent360Overview, listStudent360Directory, listStudent360Timeline, getStudent360NutritionActivityDetail, createStudentCareActivity, getStudent360ProgressPhotos, saveStudent360ProgressCheckIn, refreshStudent360Projection, getStudent360ContractWorkspace, mutateStudent360Contract }
}

module.exports = {
  ACTIVE_SESSION_STATUSES,
  HEALTH_FORMULA_VERSION,
  OVERVIEW_SCHEMA_VERSION,
  addCalendarMonths,
  activeContract,
  buildHealthScore,
  buildStudent360Projection,
  contractUsage,
  contractInstallments,
  contractAssigneeIssues,
  contractMutationTitle,
  createStudent360Functions,
  permissionsFor,
  redactProjection,
  reconcileStudent360ProjectionBatch,
  normalizeTimelineEvents,
  nutritionActivityDetailRecord,
  uniqueProgressDocuments,
  uniqueProgressPhotos,
  sourceTimelineEvents,
  sessionDateTimeMillis,
  safeTimelineEvent,
  safeAccountUid,
  studentAccountLink,
  studentIdFromAccountUid,
  studentAccountProfile,
  nutritionTimelineEvidence,
  syncStudent360ProjectionFromEvent,
  timelineCursor,
  vietnamDateKey,
  normalizeProgressCheckInInput,
  decodeProgressPhotoDataUrl,
}
