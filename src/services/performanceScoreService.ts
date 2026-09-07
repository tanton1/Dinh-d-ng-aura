import { httpsCallable } from 'firebase/functions'
import { deleteObject, ref, uploadBytesResumable } from 'firebase/storage'
import { firebaseAuth } from '../lib/firebase'
import { firebaseScheduleOptimizerFunctions } from '../lib/firebaseFunctions'
import { firebaseStorage } from '../lib/firebaseStorage'

export type PerformanceEvidenceType = 'personal_content' | 'aura_assignment' | 'profile_checklist'
export type PerformanceEvidenceStatus = 'submitted' | 'needs_revision' | 'approved' | 'rejected' | 'withdrawn'
export type PerformanceEvidencePlatform = 'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'group' | 'other'

export const PERFORMANCE_PROFILE_KEYS = [
  'photo', 'bio', 'certifications', 'expertise', 'case_studies', 'reviews', 'intro_video', 'social_links', 'schedule', 'contact',
] as const
export type PerformanceProfileKey = typeof PERFORMANCE_PROFILE_KEYS[number]

export interface BrandPerformanceEvidence {
  id: string
  staffId: string
  ownerUid: string
  staffName: string
  branchIds: string[]
  periodId: string
  type: PerformanceEvidenceType
  platform: PerformanceEvidencePlatform | ''
  url: string
  screenshotPath: string
  signedUrl: string
  postedAt: string
  groupName: string
  briefId: string
  title: string
  note: string
  status: PerformanceEvidenceStatus
  reviewerId: string
  reviewedAt: string
  reviewReason: string
  violationCodes: string[]
  checklist: Partial<Record<PerformanceProfileKey, boolean>>
  submittedAt: string
  updatedAt: string
}

export interface PerformanceCategoryScore {
  id: string
  label: string
  weight: number
  score: number | null
  availableWeight: number
  status: 'available' | 'partial' | 'not_available'
  submetrics: PerformanceSubmetricScore[]
}

export interface PerformanceSubmetricScore {
  id: string
  label: string
  weight: number
  score: number | null
  status: 'available' | 'needs_review' | 'not_available'
  source: string
  actual: number | null
  target: number | null
  numerator: number | null
  denominator: number | null
  sampleSize: number
  note: string
  evidenceRefs: string[]
  reason: string
  calculation: string
  achievementRate: number | null
}

export interface PerformanceGateResult {
  id: 'quality' | 'attendance' | 'client_safety' | 'integrity'
  label: string
  status: 'pass' | 'fail' | 'unknown'
  source: string
  reason: string
  evidenceRefs: string[]
}

export interface MyPerformanceScore {
  schemaVersion: number
  formulaVersion: string
  staffId: string
  periodId: string
  staffName: string
  assessmentRevision: number
  generatedAt: string
  amountImpact: 'none'
  locked: boolean
  coverage: { availableWeight: number; totalWeight: number; confidence: 'low' | 'medium' | 'high'; missingMetricIds: string[] }
  score: { value: number | null; provisionalValue: number; maximum: number; reason: string }
  categories: PerformanceCategoryScore[]
  gates: PerformanceGateResult[]
  bonus: { eligibility: 'eligible' | 'ineligible' | 'pending'; recommendedAmount: number | null; classification: string; reason: string }
  brand: {
    total: number
    maximum: 10
    personal: { approvedCount: number; target: 4; score: number; maximum: 5 }
    aura: { approvedCount: number; target: 3; score: number; maximum: 3 }
    profile: { completedCount: number; target: 10; score: number; maximum: 2; checklist: Partial<Record<PerformanceProfileKey, boolean>> }
  }
  evidence: { total: number; pending: number; approved: number }
}

export type PerformanceAssessmentSource = 'manager_review' | 'system_fallback' | 'rolling_average' | 'neutral_score'

export interface PerformanceMetricAssessmentInput {
  periodId: string
  staffId: string
  metricId: string
  expectedRevision: number
  source: PerformanceAssessmentSource
  actual?: number | null
  target?: number | null
  numerator?: number | null
  denominator?: number | null
  manualScore?: number | null
  sampleSize?: number | null
  note: string
  evidenceRefs?: string[]
}

export interface PerformanceStaffDirectoryItem {
  staffId: string
  ownerUid: string
  name: string
  branchIds: string[]
}

type UnknownRecord = Record<string, unknown>

function object(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function functionsError(error: unknown) {
  const raw = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {}
  const code = text(raw.code).replace(/^functions\//, '')
  const message = text(raw.message)
  if (message && !/^(internal|unavailable)$/i.test(message)) return new Error(message)
  if (code === 'permission-denied') return new Error('Bạn không có quyền thực hiện thao tác này.')
  if (code === 'already-exists') return new Error('Nội dung này đã được gửi trong kỳ. Một bài đăng lại nhiều nơi chỉ tính một nội dung.')
  if (code === 'failed-precondition') return new Error('Bằng chứng chưa hợp lệ hoặc kỳ đánh giá đã khóa.')
  return new Error('Dịch vụ Aura Performance tạm thời chưa phản hồi. Vui lòng thử lại.')
}

async function call<Input, Output>(name: string, input: Input): Promise<Output> {
  if (!firebaseScheduleOptimizerFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  try {
    const result = await httpsCallable<Input, Output>(firebaseScheduleOptimizerFunctions, `${name}V2`, { timeout: 30_000 })(input)
    return result.data
  } catch (error) {
    throw functionsError(error)
  }
}

function normalizeEvidence(value: unknown): BrandPerformanceEvidence {
  const raw = object(value)
  const type = ['personal_content', 'aura_assignment', 'profile_checklist'].includes(text(raw.type))
    ? text(raw.type) as PerformanceEvidenceType : 'personal_content'
  const status = ['submitted', 'needs_revision', 'approved', 'rejected', 'withdrawn'].includes(text(raw.status))
    ? text(raw.status) as PerformanceEvidenceStatus : 'submitted'
  const platform = ['facebook', 'instagram', 'tiktok', 'youtube', 'group', 'other'].includes(text(raw.platform))
    ? text(raw.platform) as PerformanceEvidencePlatform : ''
  const checklistRaw = object(raw.checklist)
  const checklist = Object.fromEntries(PERFORMANCE_PROFILE_KEYS.map((key) => [key, checklistRaw[key] === true])) as Record<PerformanceProfileKey, boolean>
  return {
    id: text(raw.id), staffId: text(raw.staffId), ownerUid: text(raw.ownerUid), staffName: text(raw.staffName) || 'Nhân sự Aura',
    branchIds: stringArray(raw.branchIds), periodId: text(raw.periodId), type, platform, url: text(raw.url),
    screenshotPath: text(raw.screenshotPath), signedUrl: text(raw.signedUrl), postedAt: text(raw.postedAt), groupName: text(raw.groupName),
    briefId: text(raw.briefId), title: text(raw.title), note: text(raw.note), status, reviewerId: text(raw.reviewerId),
    reviewedAt: text(raw.reviewedAt), reviewReason: text(raw.reviewReason), violationCodes: stringArray(raw.violationCodes), checklist,
    submittedAt: text(raw.submittedAt), updatedAt: text(raw.updatedAt),
  }
}

function normalizeScore(value: unknown, periodId: string): MyPerformanceScore {
  const raw = object(value)
  const brand = object(raw.brand)
  const personal = object(brand.personal)
  const aura = object(brand.aura)
  const profile = object(brand.profile)
  const coverage = object(raw.coverage)
  const score = object(raw.score)
  const evidence = object(raw.evidence)
  const bonus = object(raw.bonus)
  return {
    schemaVersion: number(raw.schemaVersion) || 1,
    formulaVersion: text(raw.formulaVersion) || 'aura-pt-performance-v1.0-2026-09-07',
    staffId: text(raw.staffId), staffName: text(raw.staffName), periodId: text(raw.periodId) || periodId,
    assessmentRevision: number(raw.assessmentRevision), generatedAt: text(raw.generatedAt), amountImpact: 'none', locked: raw.locked === true,
    coverage: { availableWeight: number(coverage.availableWeight), totalWeight: number(coverage.totalWeight) || 100, confidence: ['medium', 'high'].includes(text(coverage.confidence)) ? text(coverage.confidence) as 'medium' | 'high' : 'low', missingMetricIds: stringArray(coverage.missingMetricIds) },
    score: { value: nullableNumber(score.value), provisionalValue: number(score.provisionalValue), maximum: number(score.maximum) || 100, reason: text(score.reason) },
    categories: Array.isArray(raw.categories) ? raw.categories.map((item) => {
      const category = object(item)
      const submetrics: PerformanceSubmetricScore[] = Array.isArray(category.submetrics) ? category.submetrics.flatMap((rawMetric) => {
        const metric = object(rawMetric)
        const id = text(metric.id)
        return id ? [{
          id,
          label: text(metric.label),
          weight: number(metric.weight),
          score: nullableNumber(metric.score),
          status: metric.status === 'available' ? 'available' as const : metric.status === 'needs_review' ? 'needs_review' as const : 'not_available' as const,
          source: text(metric.source), actual: nullableNumber(metric.actual), target: nullableNumber(metric.target),
          numerator: nullableNumber(metric.numerator), denominator: nullableNumber(metric.denominator), sampleSize: number(metric.sampleSize),
          note: text(metric.note), evidenceRefs: stringArray(metric.evidenceRefs), reason: text(metric.reason), calculation: text(metric.calculation),
          achievementRate: nullableNumber(metric.achievementRate),
        }] : []
      }) : []
      return { id: text(category.id), label: text(category.label), weight: number(category.weight), score: nullableNumber(category.score), availableWeight: number(category.availableWeight), status: category.status === 'available' ? 'available' as const : category.status === 'partial' ? 'partial' as const : 'not_available' as const, submetrics }
    }) : [],
    gates: Array.isArray(raw.gates) ? raw.gates.flatMap((value) => {
      const gate = object(value)
      const id = text(gate.id)
      if (!['quality', 'attendance', 'client_safety', 'integrity'].includes(id)) return []
      return [{
        id: id as PerformanceGateResult['id'], label: text(gate.label),
        status: gate.status === 'pass' ? 'pass' as const : gate.status === 'fail' ? 'fail' as const : 'unknown' as const,
        source: text(gate.source), reason: text(gate.reason), evidenceRefs: stringArray(gate.evidenceRefs),
      }]
    }) : [],
    bonus: {
      eligibility: bonus.eligibility === 'eligible' ? 'eligible' : bonus.eligibility === 'ineligible' ? 'ineligible' : 'pending',
      recommendedAmount: nullableNumber(bonus.recommendedAmount), classification: text(bonus.classification), reason: text(bonus.reason),
    },
    brand: {
      total: number(brand.total), maximum: 10,
      personal: { approvedCount: number(personal.approvedCount), target: 4, score: number(personal.score), maximum: 5 },
      aura: { approvedCount: number(aura.approvedCount), target: 3, score: number(aura.score), maximum: 3 },
      profile: { completedCount: number(profile.completedCount), target: 10, score: number(profile.score), maximum: 2, checklist: normalizeEvidence({ type: 'profile_checklist', checklist: profile.checklist }).checklist },
    },
    evidence: { total: number(evidence.total), pending: number(evidence.pending), approved: number(evidence.approved) },
  }
}

export async function getMyPerformanceScore(periodId: string) {
  return normalizeScore(await call<{ periodId: string }, UnknownRecord>('getMyPerformanceScore', { periodId }), periodId)
}

export async function listMyPerformanceEvidence(periodId: string) {
  const result = await call<{ periodId: string }, { rows?: unknown[] }>('listMyPerformanceEvidence', { periodId })
  return Array.isArray(result.rows) ? result.rows.map(normalizeEvidence) : []
}

export async function listPerformanceReviewQueue(input: { periodId: string; branchId?: string; status?: PerformanceEvidenceStatus | ''; type?: PerformanceEvidenceType | '' }) {
  const result = await call<typeof input, { rows?: unknown[]; profiles?: unknown[]; staff?: unknown[]; truncated?: boolean }>('listPerformanceReviewQueue', input)
  const rows = Array.isArray(result.rows) ? result.rows.map(normalizeEvidence) : []
  const staff: PerformanceStaffDirectoryItem[] = Array.isArray(result.staff) ? result.staff.flatMap((value) => {
    const raw = object(value)
    const staffId = text(raw.staffId)
    return staffId ? [{ staffId, ownerUid: text(raw.ownerUid), name: text(raw.name) || 'Nhân sự Aura', branchIds: stringArray(raw.branchIds) }] : []
  }) : []
  const profiles = Array.isArray(result.profiles) ? result.profiles.map(normalizeEvidence) : []
  return { rows, profiles, staff, truncated: result.truncated === true }
}

async function fileHash(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function evidenceFileName(file: File) {
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  return `proof-${Date.now()}.${extension}`
}

export async function submitPerformanceBrandEvidence(input: {
  periodId: string
  type: Exclude<PerformanceEvidenceType, 'profile_checklist'>
  platform?: PerformanceEvidencePlatform | ''
  url?: string
  screenshot?: File | null
  postedAt: string
  groupName?: string
  briefId?: string
  title: string
  note?: string
}, onProgress?: (percent: number) => void) {
  const user = firebaseAuth?.currentUser
  if (!user) throw new Error('Bạn cần đăng nhập để gửi bằng chứng.')
  const evidenceId = crypto.randomUUID().replaceAll('-', '_')
  let screenshotPath = ''
  let contentHash = ''
  if (input.screenshot) {
    if (!firebaseStorage) throw new Error('Firebase Storage chưa sẵn sàng.')
    if (!/^image\/(jpeg|png|webp)$/.test(input.screenshot.type) || input.screenshot.size < 1 || input.screenshot.size > 10 * 1024 * 1024) {
      throw new Error('Ảnh phải là JPG, PNG hoặc WebP và không vượt quá 10MB.')
    }
    contentHash = await fileHash(input.screenshot)
    screenshotPath = `performance-evidence/${user.uid}/${input.periodId}/${evidenceId}/${evidenceFileName(input.screenshot)}`
    const uploadReference = ref(firebaseStorage, screenshotPath)
    const task = uploadBytesResumable(uploadReference, input.screenshot, {
      contentType: input.screenshot.type,
      cacheControl: 'private,max-age=300',
      customMetadata: { ownerUid: user.uid, periodId: input.periodId, evidenceId, resourceKind: 'performance-evidence' },
    })
    await new Promise<void>((resolve, reject) => task.on('state_changed', (snapshot) => {
      if (snapshot.totalBytes) onProgress?.(Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100))
    }, reject, resolve))
  }
  try {
    return await call<typeof input & { evidenceId: string; screenshotPath: string; contentHash: string }, { evidenceId: string; status: 'submitted' }>('submitPerformanceBrandEvidence', {
      ...input, screenshot: null, evidenceId, screenshotPath, contentHash,
    })
  } catch (error) {
    if (screenshotPath && firebaseStorage) void deleteObject(ref(firebaseStorage, screenshotPath)).catch(() => undefined)
    throw error
  }
}

export async function withdrawPerformanceBrandEvidence(evidenceId: string) {
  return call<{ evidenceId: string }, { evidenceId: string; status: 'withdrawn'; unchanged: boolean }>('withdrawPerformanceBrandEvidence', { evidenceId })
}

export async function reviewPerformanceBrandEvidence(input: { evidenceId: string; decision: 'approved' | 'needs_revision' | 'rejected'; reason?: string; violationCodes?: string[] }) {
  return call<typeof input, { evidenceId: string; status: PerformanceEvidenceStatus }>('reviewPerformanceBrandEvidence', input)
}

export async function savePerformanceProfileChecklist(input: { periodId: string; staffId: string; checklist: Record<PerformanceProfileKey, boolean>; reason?: string }) {
  return call<typeof input, { evidenceId: string; completedCount: number; status: 'approved' }>('savePerformanceProfileChecklist', input)
}

export async function getPerformanceStaffScore(periodId: string, staffId: string) {
  return normalizeScore(await call<{ periodId: string; staffId: string }, UnknownRecord>('getPerformanceStaffScore', { periodId, staffId }), periodId)
}

export async function savePerformanceMetricAssessment(input: PerformanceMetricAssessmentInput) {
  const result = await call<PerformanceMetricAssessmentInput, { revision: number; computedScore: number; snapshot?: unknown }>('savePerformanceMetricAssessment', input)
  return { revision: number(result.revision), computedScore: number(result.computedScore) }
}

export async function savePerformanceGateAssessment(input: {
  periodId: string
  staffId: string
  gateId: 'attendance' | 'client_safety' | 'integrity'
  expectedRevision: number
  status: 'pass' | 'fail' | 'unknown'
  reason: string
  evidenceRefs?: string[]
}) {
  const result = await call<typeof input, { revision: number }>('savePerformanceGateAssessment', input)
  return { revision: number(result.revision) }
}

export async function refreshPerformanceSnapshot(periodId: string, staffId: string) {
  return normalizeScore(await call<{ periodId: string; staffId: string }, UnknownRecord>('refreshPerformanceSnapshot', { periodId, staffId }), periodId)
}

export async function setPerformanceSnapshotLock(input: { periodId: string; staffId: string; locked: boolean; reason: string }) {
  return normalizeScore(await call<typeof input, UnknownRecord>('setPerformanceSnapshotLock', input), input.periodId)
}
