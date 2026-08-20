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

export async function createAccountInvite(input: AccountInviteInput): Promise<AccountInviteResult> {
  const callable = httpsCallable<AccountInviteInput, AccountInviteResult>(requireFunctions(), 'createAccountInvite')
  return (await callable(input)).data
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
