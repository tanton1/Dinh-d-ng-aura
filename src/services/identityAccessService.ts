import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { parseAccessContext, type AccessContext, type AccessRole, type StaffPosition } from '../identity/access'
import type { AdminUserRecord } from '../types'
import { callReadOnlyFunction } from './readOnlyCallableService'
import { presentIdentityAccessError } from './identityAccessErrors'

function requireFunctions() {
  if (!firebaseFunctions) throw new Error('Firebase Identity chưa sẵn sàng.')
  return firebaseFunctions
}

export interface IdentityDirectoryAssignment {
  accessRole: AccessRole
  positions: StaffPosition[]
  branchIds: string[]
  status: 'active' | 'suspended' | 'invited'
}

export interface IdentityDirectoryStaffRecord {
  availableSlots: string[]
  slotCapacity: number
  schedulingPriority: number
  dailySessionTarget: number
  name: string
  email: string
  phone: string
  role: string
  status: string
  employmentType: 'full_time' | 'part_time' | 'collaborator'
  employmentLevel: 'probation' | 'official' | 'senior'
  payrollPolicyId: string
  baseSalary: number
  bonusMonthly: number
  commissionRate: number
  commissionPerSession: number
}

export interface IdentityDirectoryEntry {
  user: AdminUserRecord
  assignment: IdentityDirectoryAssignment
  staffOperations: IdentityDirectoryStaffRecord | null
  managedClientCounts: { main: number; secondary: number; nutrition: number; stale?: boolean; truncated?: boolean } | null
}

export interface IdentityDirectoryPage {
  entries: IdentityDirectoryEntry[]
  hasMore: boolean
  nextCursor: string | null
  pageSize: number
  summary: { accounts: number; staff: number; admins: number }
}

export async function listIdentityDirectory(
  input: { section: 'accounts' | 'staff'; pageSize?: number; cursor?: string },
  options: { signal?: AbortSignal } = {},
): Promise<IdentityDirectoryPage> {
  return callReadOnlyFunction<typeof input, IdentityDirectoryPage>('listIdentityDirectory', input, {
    signal: options.signal,
    timeoutMs: 30_000,
    maximumAttempts: 2,
    baseDelayMs: 1_200,
  })
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
  email?: string
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

export interface ProvisionStaffAccountInput {
  displayName: string
  phoneNumber: string
  email?: string
  positions: StaffPosition[]
  branchIds: string[]
  employmentType?: 'full_time' | 'part_time' | 'collaborator'
  employmentLevel?: 'probation' | 'official' | 'senior'
  payrollPolicyId?: string
}

export interface ProvisionStaffAccountResult {
  uid: string
  displayName: string
  phoneNumber: string
  email: string
  positions: StaffPosition[]
  branchIds: string[]
  employmentType: 'full_time' | 'part_time' | 'collaborator'
  employmentLevel: 'probation' | 'official' | 'senior'
  payrollProfile: 'probation' | 'official' | 'senior' | 'part_time' | 'collaborator'
  payrollPolicyId: string
  passwordChangeRequired: boolean
}

function presentInviteError(error: unknown): Error {
  return presentIdentityAccessError(error, 'invite')
}

function presentStaffProfileError(error: unknown): Error {
  return presentIdentityAccessError(error, 'profile')
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
  const callable = httpsCallable<ProvisionStudentAccountInput, ProvisionStudentAccountResult>(requireFunctions(), 'provisionStudentAccount', { timeout: 30_000 })
  try {
    return (await callable(input)).data
  } catch (error) {
    throw presentInviteError(error)
  }
}

export async function provisionStaffAccount(input: ProvisionStaffAccountInput): Promise<ProvisionStaffAccountResult> {
  const callable = httpsCallable<ProvisionStaffAccountInput, ProvisionStaffAccountResult>(requireFunctions(), 'provisionStaffAccount', { timeout: 30_000 })
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
  const callable = httpsCallable<Record<string, never>, { accessContext: unknown }>(
    requireFunctions(),
    'getMyAccessContext',
    { timeout: 10_000 },
  )
  const transientCodes = new Set([
    'internal',
    'unavailable',
    'resource-exhausted',
    'deadline-exceeded',
  ])
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await callable({})
      return parseAccessContext(response.data.accessContext, uid)
    } catch (error) {
      lastError = error
      const source = error && typeof error === 'object' ? error as { code?: unknown } : {}
      const code = typeof source.code === 'string' ? source.code.replace(/^functions\//, '') : ''
      if (!transientCodes.has(code) || attempt === 1) throw error
      await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  throw lastError
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
  const callable = httpsCallable<AssignStaffPositionsInput, AssignStaffPositionsResult>(
    requireFunctions(),
    'assignStaffPositions',
    { timeout: 30_000 },
  )
  try {
    const response = await callable(input)
    return parseAccessContext(response.data.accessContext, input.uid)
  } catch (error) {
    throw presentIdentityAccessError(error, 'assign')
  }
}

export interface StaffOperationsProfileInput {
  uid: string
  displayName?: string
  email?: string
  phoneNumber?: string
  contactChanges?: {
    email?: boolean
    phoneNumber?: boolean
  }
  availabilitySlots: string[]
  slotCapacity: number
  schedulingPriority: number
  dailySessionTarget: number
  employmentType: 'full_time' | 'part_time' | 'collaborator'
  employmentLevel: 'probation' | 'official' | 'senior'
  payrollPolicyId: string
  compensation: { baseSalary: number; bonusMonthly: number; commissionRate: number; commissionPerSession: number }
}
export interface StaffOperationsProfileResult extends StaffOperationsProfileInput {
  displayName: string
  email: string
  phoneNumber: string
  payrollProfile: 'probation' | 'official' | 'senior' | 'part_time' | 'collaborator'
}
export async function saveStaffOperationsProfile(input: StaffOperationsProfileInput) {
  const callable = httpsCallable<StaffOperationsProfileInput, StaffOperationsProfileResult>(requireFunctions(), 'saveStaffOperationsProfile')
  try { return (await callable(input)).data } catch (error) { throw presentStaffProfileError(error) }
}

export async function applyDefaultTrainerSchedulingPolicy() {
  const callable = httpsCallable<
    { dailySessionTarget: number },
    { updated: number; dailySessionTarget: number }
  >(requireFunctions(), 'applyDefaultTrainerSchedulingPolicy', { timeout: 30_000 })
  try {
    return (await callable({ dailySessionTarget: 8 })).data
  } catch (error) {
    throw presentIdentityAccessError(error)
  }
}

export async function suspendAccountAccess(uid: string) {
  const callable = httpsCallable<{ uid: string }, { uid: string; suspended: boolean }>(requireFunctions(), 'suspendAccountAccess')
  try { return (await callable({ uid })).data } catch (error) { throw presentIdentityAccessError(error, 'suspend') }
}

export async function restoreAccountAccess(uid: string) {
  const callable = httpsCallable<{ uid: string }, { uid: string; restored: boolean; tokenRefreshRequired: boolean }>(requireFunctions(), 'restoreAccountAccess', { timeout: 30_000 })
  try { return (await callable({ uid })).data } catch (error) { throw presentIdentityAccessError(error, 'restore') }
}

export async function deleteUnusedStaffAccount(uid: string) {
  const callable = httpsCallable<{ uid: string }, { uid: string; deleted: boolean }>(requireFunctions(), 'deleteUnusedStaffAccount')
  try { return (await callable({ uid })).data } catch (error) { throw presentIdentityAccessError(error, 'delete') }
}

export interface DeleteMemberAccountResult {
  uid: string
  deleted: boolean
  preservedOperationalHistory: boolean
  detachedCrmProfiles: number
}

/**
 * Permanently removes a learner's sign-in identity while preserving contracts,
 * sessions and finance records for audit. The server validates the target is a
 * non-privileged member and detaches any linked PT CRM profile.
 */
export async function deleteMemberAccount(uid: string): Promise<DeleteMemberAccountResult> {
  const callable = httpsCallable<
    { uid: string; confirmUid: string },
    DeleteMemberAccountResult
  >(requireFunctions(), 'deleteMemberAccount', { timeout: 30_000 })
  try {
    return (await callable({ uid, confirmUid: uid })).data
  } catch (error) {
    throw presentIdentityAccessError(error, 'delete')
  }
}
