import type { AccessContext, AccessRole, AccessStatus } from './access'

// The access context the server last confirmed for the signed-in account.
// Member services read it to avoid sending a callable whose permission-denied
// answer is already known: staff and admin accounts opening the member home
// were paying for about 750 rejected calls a week (Cloud Monitoring,
// 04–11/11/2026). It is not an authorization decision. The server still checks
// every request, and an unknown context never blocks a call.
export interface SessionAccess {
  uid: string
  accessRole: AccessRole
  status: AccessStatus
}

let confirmed: SessionAccess | null = null

/** Pass only a context returned by the access callable; null when signed out
 * or when the context could not be verified. */
export function rememberSessionAccess(context: Pick<AccessContext, 'uid' | 'accessRole' | 'status'> | null) {
  confirmed = context ? { uid: context.uid, accessRole: context.accessRole, status: context.status } : null
}

export function sessionAccessFor(uid: string | null | undefined): SessionAccess | null {
  return confirmed && uid && confirmed.uid === uid ? confirmed : null
}

function activeRole(access: SessionAccess | null) {
  return access?.status === 'active' ? access.accessRole : null
}

/** `studentActor` in functions/loyalty.js accepts only accessRole "student". */
export function memberLoyaltyReadAllowed(access: SessionAccess | null) {
  const role = activeRole(access)
  return role === null || role === 'student'
}

/** `studentActor` in functions/pt-operations-v2.js accepts "student", and
 * "staff" so a staff member with a linked learner profile sees their own
 * schedule. */
export function memberScheduleReadAllowed(access: SessionAccess | null) {
  const role = activeRole(access)
  return role === null || role === 'student' || role === 'staff'
}
