import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'
import type { Schedule, ScheduleConfig, Session, Student, StudentContract, Trainer } from '../types'

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
  DUPLICATE_SCHEDULE_ENTRY: 'Một học viên bị lặp trong cùng ô lịch.',
  TRAINER_OFF_CONFLICT: 'Có học viên nằm trong ca PT đã đánh dấu nghỉ.',
  TRAINER_CAPACITY_EXCEEDED: 'Có ca vượt sức chứa được cấu hình cho PT.',
  CONTRACT_SESSION_QUOTA_EXCEEDED: 'Số buổi đã học và đang xếp vượt quá gói tập.',
  COMPLETED_SESSION_IMMUTABLE: 'Lịch nháp đang thay đổi một buổi đã hoàn thành.',
  CANCELLED_SESSION_REINTRODUCED: 'Một buổi đã hủy đang được thêm lại trực tiếp.',
  DUPLICATE_DEPLOYED_SESSION: 'Dữ liệu hiện có chứa buổi tập triển khai bị trùng.',
  SCHEDULE_TOO_LARGE: 'Lịch vượt giới hạn publish an toàn trong một lần.',
  LEGACY_AVAILABILITY_FALLBACK: 'Một số học viên đang dùng lịch rảnh legacy; nên xác nhận lại lịch tuần.',
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

export function asPtSchedulePublishError(error: unknown) {
  if (error instanceof PtSchedulePublishError) return error
  const source = asRecord(error)
  const details = asRecord(source.details)
  const code = typeof source.code === 'string' ? source.code.replace(/^functions\//, '') : ''
  const issueCode = typeof details.issueCode === 'string' ? details.issueCode : code === 'aborted' ? 'REVISION_CONFLICT' : 'UNKNOWN'
  const conflicts = Array.isArray(details.errors)
    ? details.errors.filter((item): item is string => typeof item === 'string')
    : []
  const message = typeof source.message === 'string' && source.message.trim()
    ? source.message.trim()
    : 'Chưa thể kiểm tra lịch PT.'
  return new PtSchedulePublishError(
    message,
    issueCode,
    conflicts,
    ['aborted', 'unavailable', 'deadline-exceeded', 'resource-exhausted'].includes(code),
  )
}

async function invoke<TInput extends Record<string, unknown>, TOutput>(name: string, input: TInput) {
  try {
    const callable = httpsCallable<TInput, TOutput>(functionsInstance(), name, { timeout: 60_000 })
    return (await callable(input)).data
  } catch (error) {
    throw asPtSchedulePublishError(error)
  }
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
