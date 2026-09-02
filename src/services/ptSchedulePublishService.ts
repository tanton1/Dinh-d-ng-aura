import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions, firebaseScheduleOptimizerFunctions } from '../lib/firebaseFunctions'
import type { Schedule, ScheduleConfig, Session, Student, StudentContract, Trainer } from '../types'
import { reportClientIssue } from './clientTelemetryService'

export interface PtSchedulePublishDiff {
  create: number
  update: number
  cancel: number
  unchanged: number
}

export interface PtSchedulePublishResult {
  unchanged: boolean
  validateOnly?: boolean
  draftRevision: number
  version: number
  diff: PtSchedulePublishDiff
  warnings: string[]
}

export interface PtScheduleVersionSummary {
  version: number
  sourceDraftRevision: number
  entryCount: number
  diff: PtSchedulePublishDiff
  warnings: string[]
  publishedAt: string | null
  publishedBy: string | null
}

export interface PtScheduleVersionListResult {
  currentDraftRevision: number
  currentVersion: number
  versions: PtScheduleVersionSummary[]
}

export interface PtScheduleRestoreResult {
  version: number
  draftRevision: number
}

export interface BranchScheduleWorkspaceResult {
  schemaVersion: number
  branch: { id: string; name: string; status: 'active' | 'archived' }
  weekId: string
  draftRevision: number
  publishedVersion: number
  publishedRevision: number
  schedule: Schedule
  students: Student[]
  trainers: Trainer[]
  contracts: StudentContract[]
  sessions: Session[]
  scheduleConfig: ScheduleConfig
}

export interface PtScheduleBranchOption {
  id: string
  name: string
  status: string
}

export interface PtScheduleV2Student extends Student {
  availabilityStatus: string
  availabilityRevision: number
  availabilitySourceRevision?: number
  availabilitySourceWeekId?: string | null
  availabilitySource?: 'weekly' | 'inherited_weekly' | 'legacy_default' | 'none'
  eligibleForWeek: boolean
  eligibilityReasons: string[]
  eligibleContractIds: string[]
  validScheduleDates: string[]
  pausedScheduleDates: string[]
  remainingEntitlementSessions?: number
  activeScheduledSessions?: number
  activeScheduledThisWeek?: number
  remainingSchedulableSessions?: number
  /** Hồ sơ mặc định; không bị thay đổi khi điều phối riêng một tuần. */
  defaultSessionsPerWeek: number
  /** Override chỉ thuộc draft tuần/chi nhánh hiện tại; null nghĩa là dùng mặc định. */
  weeklySessionTargetOverride: number | null
  weeklySessionTargetOverridden: boolean
  /** Giới hạn mục tiêu theo quota hợp đồng còn lại, không co theo ngày còn lại của tuần. */
  maxWeeklySessions: number
  /** Số ngày hợp đồng còn cho phép tạo thêm buổi trong phần còn lại của tuần. */
  schedulableSessionsThisWeek: number
}

export interface PtScheduleV2Trainer extends Trainer {
  availabilityMode: 'configured' | 'unrestricted' | 'unconfigured'
  availabilityRevision: number
  slotCapacity: number
  /** Thứ tự ưu tiên dùng khi học viên chưa có PT chính/phụ. Số nhỏ ưu tiên cao. */
  schedulingPriority?: number
  /** Mục tiêu số ca duy nhất trong một ngày. Ca đôi vẫn chỉ tính một ca. */
  dailySessionTarget?: number
  /** @deprecated Chỉ giữ để đọc dữ liệu cũ; thuật toán không chặn theo trần. */
  dailySessionLimit?: number
  employmentType?: 'full_time' | 'part_time' | 'collaborator'
  employmentLevel?: 'probation' | 'official' | 'senior'
}

export interface PtScheduleStudentCoverage {
  eligibleStudents?: number
  eligible?: number
  studentsWithAtLeastOne?: number
  receivedAtLeastOne?: number
  withAtLeastOne?: number
  fullyScheduledStudents?: number
  fullyScheduled?: number
  totalTargetSessions?: number
  requestedSessions?: number
  scheduledEntries?: number
  scheduledSessions?: number
  missingSessions?: number
}

export interface PtScheduleTrainerDayLoad {
  day: string
  date: string
  teachingSlots: number
  target: number
  limit?: number
  remainingToTarget?: number
  status?: 'under_target' | 'target' | 'over_target'
}

export interface PtScheduleTrainerDailyLoad {
  trainerId: string
  trainerName?: string
  name?: string
  schedulingPriority?: number
  employmentType?: 'full_time' | 'part_time' | 'collaborator'
  employmentLevel?: 'probation' | 'official' | 'senior'
  day?: string
  date?: string
  sessionCount?: number
  teachingSlots?: number
  sessions?: number
  target?: number
  limit?: number
  dailySessionTarget?: number
  dailySessionLimit?: number
  studentSessions?: number
  days?: PtScheduleTrainerDayLoad[]
  status?: 'under_target' | 'target' | 'over_target'
}

export interface PtScheduleUnassignedEntry {
  studentId: string
  studentName?: string
  missingSessions: number
  blockerType?: 'optimizer_gap' | 'input_or_capacity'
  reasonCodes?: string[]
  reasons?: string[]
  suggestedSlots?: string[]
}

export interface PtScheduleSlotUtilization {
  teachingSlots: number
  studentSessions: number
  pairedSlots: number
  singleSlots: number
  fullSlots: number
  pairRatePercent: number
  seatUtilizationPercent: number
}

export interface PtScheduleStudentFeasibility {
  studentId: string
  studentName?: string
  requestedSessions: number
  maximumFeasibleSessions: number
  scheduledSessions: number
  missingSessions: number
  impossibleSessions: number
}

export interface PtScheduleSwapMove {
  studentId: string
  studentName?: string
  fromSlotId: string | null
  fromTrainerId: string | null
  toSlotId: string
  toTrainerId: string
}

export interface PtScheduleOptimizationSummary {
  studentCoverage?: PtScheduleStudentCoverage
  /** Fast preflight showing whether a missing buổi is realistically schedulable this week. */
  studentFeasibility?: PtScheduleStudentFeasibility[]
  trainerLoads?: PtScheduleTrainerDailyLoad[]
  slotUtilization?: PtScheduleSlotUtilization
  pairingMoves?: number
  refillAssignments?: number
  repairAssignments?: number
  repairRelocations?: number
  repairSearchNodes?: number
  repairSearchLimitReached?: boolean
  /** Các bước xếp mới/đổi chỗ đã thực hiện trong chuỗi sửa sâu. */
  swapTrace?: PtScheduleSwapMove[]
  optimizationPasses?: number
  totalTargetSessions?: number
  scheduledEntries?: number
  missingSessions?: number
  generatorVersion?: string
}

export interface PtScheduleWorkspaceV2Result extends Omit<BranchScheduleWorkspaceResult, 'students' | 'trainers'> {
  draftStatus: 'draft' | 'published'
  updatedAt: string | null
  updatedBy: string | null
  students: PtScheduleV2Student[]
  trainers: PtScheduleV2Trainer[]
  summary: {
    eligibleStudents: number
    trainers: number
    unconfiguredTrainers: number
    scheduledEntries: number
    missingSessions: number
    unassignedEntries: number
  }
  warnings: Array<{ code: string; studentId?: string; trainerId?: string; slotId?: string; missingSessions?: number; entryCount?: number; maxEntries?: number }>
  /** Optional trong lúc rollout Functions v3; UI luôn có bộ tính fallback từ draft. */
  optimizationSummary?: PtScheduleOptimizationSummary
  unassignedEntries?: PtScheduleUnassignedEntry[]
  /** Alias tạm thời để tương thích response thử nghiệm trước v3. */
  trainerLoads?: PtScheduleTrainerDailyLoad[]
  studentCoverage?: PtScheduleStudentCoverage
  unassigned?: PtScheduleUnassignedEntry[]
}

export interface PtScheduleSlotCandidate {
  studentId: string
  name: string
  phone: string
  eligible: boolean
  reasons: string[]
  contractId: string | null
  date: string
  /** True khi học viên đã đăng ký đúng khung giờ đang mở. */
  matchesStudentAvailability?: boolean
  /** Có thể xếp tay; false khi còn lỗi hợp đồng, chi nhánh, trùng lịch hoặc tải PT. */
  manualSelectable?: boolean
  availabilityReason?: 'AVAILABILITY_NOT_SUBMITTED' | 'OUTSIDE_STUDENT_AVAILABILITY' | null
  /** True khi PT của ô lịch không nằm trong danh sách PT chính/phụ của hợp đồng. */
  trainerAssignmentWarning?: boolean
  /** Danh sách PT chính/phụ để UI giải thích cảnh báo mà không chặn xếp lịch. */
  assignedTrainerIds?: string[]
}

export type PtScheduleDraftCommand =
  | 'add_student'
  | 'remove_student'
  | 'move_student'
  | 'set_trainer_off'
  | 'clear_trainer_off'
  | 'lock_entry'
  | 'unlock_entry'
  | 'set_student_weekly_target'
  | 'reset_draft'

export class PtSchedulePublishError extends Error {
  readonly issueCode: string
  readonly conflicts: string[]
  readonly retryable: boolean

  constructor(message: string, issueCode = 'UNKNOWN', conflicts: string[] = [], retryable = false) {
    super(message)
    this.name = 'PtSchedulePublishError'
    this.issueCode = issueCode
    this.conflicts = conflicts
    this.retryable = retryable
  }
}

const conflictLabels: Record<string, string> = {
  INVALID_SLOT: 'Có khung giờ không đúng định dạng.',
  OUTSIDE_WORKING_CALENDAR: 'Có ca nằm ngoài ngày hoặc giờ hoạt động.',
  TRAINER_REQUIRED: 'Có ca chưa chọn PT.',
  TRAINER_NOT_ACTIVE: 'Có PT không còn hoạt động.',
  TRAINER_AVAILABILITY_UNCONFIGURED: 'PT chưa thiết lập lịch rảnh hoặc chưa được đánh dấu không giới hạn.',
  OUTSIDE_TRAINER_AVAILABILITY: 'Ca nằm ngoài lịch rảnh đã xác nhận của PT.',
  TRAINER_ON_LEAVE: 'PT đang có lịch nghỉ được duyệt trong ngày này.',
  STUDENT_REQUIRED: 'Có ca chưa chọn học viên.',
  STUDENT_NOT_ACTIVE: 'Có học viên không còn hoạt động.',
  ENTRY_BRANCH_REQUIRED: 'Có ca chưa xác định được chi nhánh.',
  TRAINER_BRANCH_MISMATCH: 'PT không thuộc chi nhánh đang publish.',
  STUDENT_BRANCH_MISMATCH: 'Học viên không thuộc chi nhánh đang publish.',
  STUDENT_MULTIPLE_SESSIONS_PER_DAY: 'Một học viên đang có hơn một buổi trong cùng ngày.',
  OUTSIDE_STUDENT_AVAILABILITY: 'Có buổi nằm ngoài lịch rảnh học viên đã gửi.',
  AVAILABILITY_NOT_SUBMITTED: 'Có học viên chưa gửi lịch rảnh của tuần.',
  ACTIVE_CONTRACT_NOT_FOUND: 'Có học viên không có hợp đồng hiệu lực trong ngày tập.',
  AMBIGUOUS_ACTIVE_CONTRACT: 'Có học viên có nhiều hợp đồng cùng hiệu lực.',
  CONTRACT_BRANCH_REQUIRED: 'Hợp đồng chưa xác định chi nhánh canonical.',
  CONTRACT_PAUSED: 'Hợp đồng đang OFF hoặc bảo lưu trong ngày tập.',
  TRAINER_ASSIGNMENT_MISMATCH: 'PT hỗ trợ ngoài danh sách PT chính/phụ; ca vẫn hợp lệ trong cùng chi nhánh.',
  DUPLICATE_SCHEDULE_ENTRY: 'Một học viên bị lặp trong cùng ô lịch.',
  TRAINER_OFF_CONFLICT: 'Có học viên nằm trong ca PT đã đánh dấu nghỉ.',
  TRAINER_CAPACITY_EXCEEDED: 'Có ca vượt sức chứa được cấu hình cho PT.',
  CONTRACT_SESSION_QUOTA_EXCEEDED: 'Số buổi đã học và đang xếp vượt quá gói tập.',
  COMPLETED_SESSION_IMMUTABLE: 'Lịch nháp đang thay đổi một buổi đã hoàn thành.',
  CANCELLED_SESSION_REINTRODUCED: 'Một buổi đã hủy đang được thêm lại trực tiếp.',
  DUPLICATE_DEPLOYED_SESSION: 'Dữ liệu hiện có chứa buổi tập triển khai bị trùng.',
  SCHEDULE_TOO_LARGE: 'Lịch vượt giới hạn publish an toàn trong một lần.',
  DRAFT_CAPACITY_REACHED: 'Draft đã đạt giới hạn một lần publish; các hồ sơ còn lại được đưa vào cảnh báo.',
  LEGACY_AVAILABILITY_FALLBACK: 'Một số học viên đang dùng lịch rảnh legacy; nên xác nhận lại lịch tuần.',
  WEEKLY_TARGET_EXCEEDS_QUOTA: 'Mục tiêu tuần vượt quota hợp đồng còn lại.',
  WEEKLY_TARGET_BELOW_SCHEDULED: 'Mục tiêu tuần thấp hơn số buổi đã có trong draft.',
  STUDENT_UNSCHEDULED: 'Chưa tìm được đủ ca hợp lệ cho học viên.',
  DRAFT_RESET: 'Lịch nháp vừa được đặt lại; học viên đang chờ xếp lại.',
  NO_AVAILABLE_SLOT: 'Không còn khung giờ rảnh chung giữa học viên và PT.',
  STUDENT_AVAILABILITY_MISSING: 'Học viên chưa có lịch rảnh để xếp tự động.',
  MANUAL_STUDENT_AVAILABILITY_OVERRIDE: 'Có học viên được quản lý xếp tay ngoài lịch rảnh đã đăng ký.',
  TRAINER_DAILY_TARGET_REACHED: 'Các PT phù hợp đã đạt mục tiêu ca trong ngày.',
  TRAINER_DAILY_LIMIT_REACHED: 'Các PT phù hợp đã chạm giới hạn ca trong ngày.',
  TRAINER_DAILY_SESSION_LIMIT_EXCEEDED: 'PT đã vượt giới hạn ca được cấu hình trong ngày.',
  TRAINER_NOT_ASSIGNED: 'Chưa có PT phù hợp trong phạm vi chi nhánh.',
  BRANCH_CAPACITY_REACHED: 'Chi nhánh đã đủ công suất trong các khung giờ phù hợp.',
  STUDENT_WEEKLY_TARGET_REACHED: 'Học viên đã đủ mục tiêu số buổi của tuần.',
}

export function ptScheduleConflictLabel(code: string) {
  return conflictLabels[code] || code
}

function functionsInstance() {
  if (!firebaseFunctions) throw new PtSchedulePublishError('Firebase Functions chưa sẵn sàng.', 'SYNC_UNAVAILABLE', [], true)
  return firebaseFunctions
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

const retryableCallableCodes = new Set(['internal', 'resource-exhausted', 'unavailable', 'deadline-exceeded'])
const autoRetryCallableCodes = new Set(['internal', 'unavailable', 'deadline-exceeded'])
const retryableReadCallables = new Set([
  'getMyBranchScheduleWorkspace',
  'getPtScheduleSlotCandidates',
  'getPtScheduleWorkspace',
  'listPtScheduleBranches',
  'listPtScheduleVersions',
  'validatePtScheduleDraft',
])

function callableErrorCode(error: unknown) {
  const source = asRecord(error)
  return typeof source.code === 'string' ? source.code.replace(/^functions\//, '') : ''
}

function genericCallableMessage(value: string) {
  return !value || /^(?:firebase:\s*)?(?:functions\/)?(?:internal|unknown|error)(?:\s*\(functions\/(?:internal|unknown)\))?\.?$/i.test(value.trim())
}

function friendlyCallableMessage(code: string, rawMessage: string) {
  if (!genericCallableMessage(rawMessage)) return rawMessage.trim()
  if (code === 'internal') return 'Dịch vụ lịch gặp lỗi máy chủ. Aura đã ghi nhận để đối soát; hãy thử tải lại.'
  if (code === 'resource-exhausted') return 'Dịch vụ lịch đang có nhiều lượt xử lý. Aura đã thử lại nhưng chưa có phiên trống.'
  if (code === 'deadline-exceeded') return 'Dữ liệu lịch phản hồi quá thời gian. Hãy thử tải lại trang.'
  if (code === 'unavailable') return 'Kết nối tới dịch vụ lịch tạm gián đoạn. Hãy kiểm tra mạng và thử lại.'
  if (code === 'unauthenticated') return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để tải lịch.'
  if (code === 'permission-denied') return 'Tài khoản chưa được đồng bộ quyền hoặc phạm vi chi nhánh.'
  return 'Chưa thể kiểm tra lịch PT.'
}

function retryDelay(milliseconds: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
}

export function asPtSchedulePublishError(error: unknown) {
  if (error instanceof PtSchedulePublishError) return error
  const source = asRecord(error)
  const details = asRecord(source.details)
  const code = callableErrorCode(error)
  const issueCode = typeof details.issueCode === 'string'
    ? details.issueCode
    : code === 'aborted'
      ? 'REVISION_CONFLICT'
      : code
        ? `CALLABLE_${code.replace(/-/g, '_').toUpperCase()}`
        : 'UNKNOWN'
  const conflicts = Array.isArray(details.errors)
    ? details.errors.filter((item): item is string => typeof item === 'string')
    : []
  const rawMessage = typeof source.message === 'string' ? source.message : ''
  return new PtSchedulePublishError(
    friendlyCallableMessage(code, rawMessage),
    issueCode,
    conflicts,
    code === 'aborted' || retryableCallableCodes.has(code),
  )
}

async function invoke<TInput extends Record<string, unknown>, TOutput>(name: string, input: TInput) {
  const timeout = name === 'validatePtScheduleDraft' ? 30_000 : retryableReadCallables.has(name) ? 20_000 : 60_000
  const callable = httpsCallable<TInput, TOutput>(functionsInstance(), name, { timeout })
  const maximumAttempts = retryableReadCallables.has(name) ? 2 : 1
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      return (await callable(input)).data
    } catch (error) {
      const code = callableErrorCode(error)
      const retryable = retryableCallableCodes.has(code)
      const shouldRetry = autoRetryCallableCodes.has(code) && attempt < maximumAttempts - 1
      if (!shouldRetry) {
        reportClientIssue('firestore', error, {
          phase: `admin_schedule_callable_${name}`,
          route: typeof window === 'undefined' ? '' : window.location.hash,
          retryable,
        })
        throw asPtSchedulePublishError(error)
      }
      await retryDelay(400)
    }
  }
  throw new PtSchedulePublishError('Chưa thể kết nối dịch vụ lịch PT.', 'SYNC_UNAVAILABLE', [], true)
}

export function validatePtScheduleDraft(input: { weekId: string; branchId: string; expectedDraftRevision: number }) {
  return invoke<typeof input, PtSchedulePublishResult>('validatePtScheduleDraft', input)
}

export function publishPtSchedule(input: { weekId: string; branchId: string; expectedDraftRevision: number }) {
  return invoke<typeof input, PtSchedulePublishResult>('publishPtSchedule', input)
}

export function listPtScheduleVersions(input: { weekId: string; branchId: string }) {
  return invoke<typeof input, PtScheduleVersionListResult>('listPtScheduleVersions', input)
}

export function restorePtScheduleVersionToDraft(input: {
  weekId: string
  branchId: string
  version: number
  expectedDraftRevision: number
}) {
  return invoke<typeof input, PtScheduleRestoreResult>('restorePtScheduleVersionToDraft', input)
}

export function getMyBranchScheduleWorkspace(input: { weekId: string; branchId: string }) {
  return invoke<typeof input, BranchScheduleWorkspaceResult>('getMyBranchScheduleWorkspace', input)
}

export function saveMyBranchScheduleDraft(input: {
  weekId: string
  branchId: string
  expectedDraftRevision: number
  schedule: Schedule
}) {
  return invoke<typeof input, { draftRevision: number }>('saveMyBranchScheduleDraft', input)
}

export function listPtScheduleBranches() {
  return invoke<Record<string, never>, { schemaVersion: number; branches: PtScheduleBranchOption[] }>('listPtScheduleBranches', {})
}

export function getPtScheduleWorkspace(input: { weekId: string; branchId: string }) {
  return invoke<typeof input, PtScheduleWorkspaceV2Result>('getPtScheduleWorkspace', input)
}

export function generatePtScheduleDraft(input: { weekId: string; branchId: string; expectedDraftRevision: number }) {
  type Result = {
    draftRevision: number
    schedule: Schedule
    warnings: Array<{ code: string; studentId?: string; missingSessions?: number }>
    generatorVersion: string
    optimizationSummary?: PtScheduleOptimizationSummary
    unassignedEntries?: PtScheduleUnassignedEntry[]
    trainerLoads?: PtScheduleTrainerDailyLoad[]
    studentCoverage?: PtScheduleStudentCoverage
    unassigned?: PtScheduleUnassignedEntry[]
  }
  if (!firebaseScheduleOptimizerFunctions) {
    return Promise.reject(new PtSchedulePublishError('Bộ tối ưu lịch chưa sẵn sàng.', 'SYNC_UNAVAILABLE', [], true))
  }
  const callable = httpsCallable<typeof input, Result>(firebaseScheduleOptimizerFunctions, 'generatePtScheduleDraftV4', { timeout: 120_000 })
  return callable(input).then((response) => response.data).catch((error) => { throw asPtSchedulePublishError(error) })
}

export function getPtScheduleSlotCandidates(input: {
  weekId: string
  branchId: string
  trainerId: string
  slotId: string
  search?: string
}) {
  return invoke<typeof input, { schemaVersion: number; candidates: PtScheduleSlotCandidate[] }>('getPtScheduleSlotCandidates', input)
}

export function savePtStudentAvailability(input: {
  weekId: string
  branchId: string
  studentId: string
  availableSlots: string[]
  expectedRevision: number
}) {
  return invoke<typeof input, { schemaVersion: number; availableSlots: string[]; availabilityRevision: number; availabilityStatus: string }>('savePtStudentAvailability', input)
}

export function applyPtScheduleDraftCommand(input: {
  weekId: string
  branchId: string
  expectedDraftRevision: number
  command: PtScheduleDraftCommand
  idempotencyKey: string
  reason?: string
  payload: Record<string, unknown>
}) {
  return invoke<typeof input, { draftRevision: number; schedule: Schedule; weeklySessionTargets?: Record<string, number> }>('applyPtScheduleDraftCommand', input)
}
