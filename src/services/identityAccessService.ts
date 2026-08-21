import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'
import { parseAccessContext, type AccessContext, type AccessRole, type StaffPosition } from '../identity/access'

function requireFunctions() {
  if (!firebaseFunctions) throw new Error('Firebase Identity chưa sẵn sàng.')
  return firebaseFunctions
}

export interface AccountInviteInput {
  displayName: string
  phoneNumber?: string
  email?: string
  accessRole?: AccessRole
  positions?: StaffPosition[]
  branchIds?: string[]
  crmProfileId?: string
}

export interface AccountInviteResult {
  inviteId: string
  displayName: string
  phoneNumber: string
  email: string
  accessRole: AccessRole
  positions: StaffPosition[]
  expiresAt: string
  status: 'pending'
}

export interface ProvisionStudentAccountInput {
  displayName: string
  phoneNumber: string
  email: string
  goal?: string
  crmProfileId?: string
  legacyStudent?: {
    dob?: string
    sessionsPerWeek?: number
    availableSlots?: string[]
    status?: string
    joinDate?: string
    branchId?: string
    nutritionNote?: string
  }
}

export interface ProvisionStudentAccountResult {
  uid: string
  displayName: string
  phoneNumber: string
  email: string
  passwordChangeRequired: boolean
  crmProfileId: string
}

function presentInviteError(error: unknown): Error {
  const source = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {}
  const code = typeof source.code === 'string' ? source.code.replace(/^functions\//, '') : ''
  const message = typeof source.message === 'string' ? source.message.trim() : ''

  if (code === 'already-exists') return new Error('Số điện thoại hoặc email này đã có lời mời hoặc tài khoản Aura. Hãy tìm và dùng tài khoản hiện có.')
  if (code === 'permission-denied') return new Error(message || 'Quyền tài khoản chưa đồng bộ. Hãy đăng nhập lại rồi thử lại.')
  if (code === 'unauthenticated') return new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử lại.')
  if (code === 'invalid-argument' || code === 'failed-precondition') return new Error(message || 'Thông tin tài khoản chưa hợp lệ.')
  if (code === 'internal' || code === 'unavailable' || code === 'deadline-exceeded') {
    return new Error('Dịch vụ tạo tài khoản đang chưa phản hồi. Chưa có tài khoản hoặc mật khẩu nào được tạo. Hãy thử lại sau ít phút.')
  }
  return error instanceof Error ? error : new Error('Chưa thể tạo tài khoản Aura. Vui lòng thử lại.')
}

export async function createAccountInvite(input: AccountInviteInput): Promise<AccountInviteResult> {
  const callable = httpsCallable<AccountInviteInput, AccountInviteResult>(requireFunctions(), 'createAccountInvite')
  try {
    return (await callable(input)).data
  } catch (error) {
    throw presentInviteError(error)
  }
}

export async function provisionStudentAccount(input: ProvisionStudentAccountInput): Promise<ProvisionStudentAccountResult> {
  const callable = httpsCallable<ProvisionStudentAccountInput, ProvisionStudentAccountResult>(requireFunctions(), 'provisionStudentAccount')
  try {
    return (await callable(input)).data
  } catch (error) {
    throw presentInviteError(error)
  }
}

export async function acceptAccountInvite(inviteId: string): Promise<AccessContext> {
  const callable = httpsCallable<{ inviteId: string }, { accessContext: unknown }>(requireFunctions(), 'acceptAccountInvite')
  const response = await callable({ inviteId })
  const uid = typeof response.data.accessContext === 'object' && response.data.accessContext
    ? String((response.data.accessContext as Record<string, unknown>).uid ?? '')
    : ''
  return parseAccessContext(response.data.accessContext, uid)
}

export async function getMyAccessContext(uid: string): Promise<AccessContext> {
  const callable = httpsCallable<Record<string, never>, { accessContext: unknown }>(requireFunctions(), 'getMyAccessContext')
  const response = await callable({})
  return parseAccessContext(response.data.accessContext, uid)
}

export async function resendAccountInvite(inviteId: string) {
  const callable = httpsCallable<{ inviteId: string }, { inviteId: string; expiresAt: string }>(requireFunctions(), 'resendAccountInvite')
  return (await callable({ inviteId })).data
}

export async function revokeAccountInvite(inviteId: string) {
  const callable = httpsCallable<{ inviteId: string }, { inviteId: string; revoked: boolean }>(requireFunctions(), 'revokeAccountInvite')
  return (await callable({ inviteId })).data
}

export interface AssignStaffPositionsInput {
  uid: string
  accessRole: 'student' | 'staff'
  positions: StaffPosition[]
  branchIds: string[]
}

export interface AssignStaffPositionsResult {
  accessContext: unknown
  tokenRefreshRequired: boolean
}

/**
 * Change an existing account's scoped staff assignment. The callable writes
 * both the audited Firestore assignment and Firebase custom claims; browsers
 * must never write either identity surface themselves.
 */
export async function assignStaffPositions(input: AssignStaffPositionsInput): Promise<AccessContext> {
  const callable = httpsCallable<AssignStaffPositionsInput, AssignStaffPositionsResult>(requireFunctions(), 'assignStaffPositions')
  const response = await callable(input)
  return parseAccessContext(response.data.accessContext, input.uid)
}

export interface StaffOperationsProfileInput {
  uid: string
  availabilitySlots: string[]
  compensation: { baseSalary: number; bonusMonthly: number; commissionRate: number; commissionPerSession: number }
}
export async function saveStaffOperationsProfile(input: StaffOperationsProfileInput) {
  const callable = httpsCallable<StaffOperationsProfileInput, { uid: string; availabilitySlots: string[]; compensation: StaffOperationsProfileInput['compensation'] }>(requireFunctions(), 'saveStaffOperationsProfile')
  try { return (await callable(input)).data } catch (error) { throw presentInviteError(error) }
}
