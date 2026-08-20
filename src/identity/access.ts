import contract from '../../shared/identity/identity-contract.json'

export type AccessRole = 'student' | 'staff' | 'admin' | 'super_admin'
export type StaffPosition =
  | 'coach_online'
  | 'trainer_pt'
  | 'sales'
  | 'branch_manager'
  | 'academy_editor'
  | 'shipper'

export type AccessStatus = 'active' | 'suspended' | 'invited'

export interface AccessContext {
  uid: string
  accessRole: AccessRole
  positions: StaffPosition[]
  branchIds: string[]
  capabilities: string[]
  authzVersion: number
  status: AccessStatus
}

export const accessRoles = new Set<AccessRole>(contract.accessRoles as AccessRole[])
export const staffPositions = new Set<StaffPosition>(contract.staffPositions as StaffPosition[])

export function isAccessRole(value: unknown): value is AccessRole {
  return typeof value === 'string' && accessRoles.has(value as AccessRole)
}

export function isStaffPosition(value: unknown): value is StaffPosition {
  return typeof value === 'string' && staffPositions.has(value as StaffPosition)
}

export function emptyStudentAccessContext(uid: string): AccessContext {
  return {
    uid,
    accessRole: 'student',
    positions: [],
    branchIds: [],
    capabilities: [],
    authzVersion: 1,
    status: 'active',
  }
}

export function parseAccessContext(value: unknown, expectedUid: string): AccessContext {
  if (!value || typeof value !== 'object') throw new Error('ACCESS_CONTEXT_INVALID')
  const data = value as Record<string, unknown>
  if (data.uid !== expectedUid || !isAccessRole(data.accessRole)) throw new Error('ACCESS_CONTEXT_INVALID')
  const positions = Array.isArray(data.positions) ? data.positions.filter(isStaffPosition) : []
  const branchIds = Array.isArray(data.branchIds)
    ? [...new Set(data.branchIds.filter((item): item is string => typeof item === 'string' && item.length > 0))]
    : []
  const capabilities = Array.isArray(data.capabilities)
    ? [...new Set(data.capabilities.filter((item): item is string => typeof item === 'string' && item.length > 0))]
    : []
  const status = data.status === 'suspended' || data.status === 'invited' ? data.status : 'active'
  const authzVersion = Number.isInteger(data.authzVersion) && Number(data.authzVersion) > 0
    ? Number(data.authzVersion)
    : 1
  return { uid: expectedUid, accessRole: data.accessRole, positions, branchIds, capabilities, authzVersion, status }
}

export const routeCapabilities = {
  'trainer-portal': 'pt.students.assigned.view',
  'sales-portal': 'sales.quotes.self.manage',
  // Legacy operations pages still read admin-only collections while their
  // actor-scoped replacements are being rolled out. Bind every such route to
  // the Identity v2 access context so a legacy UI role alone cannot open it.
  'admin-dashboard': 'pt.operations.manage',
  'admin-pt-students': 'pt.operations.manage',
  'admin-pt-schedule': 'pt.operations.manage',
  'admin-report': 'pt.operations.manage',
  'admin-finance': 'finance.operations.manage',
  'admin-hr': 'identity.staff_position.manage',
  'admin-payroll': 'payroll.operations.manage',
  'admin-packages': 'pt.operations.manage',
  'admin-quotes': 'sales.operations.manage',
  'admin-schedule-settings': 'pt.operations.manage',
  'admin-roles': 'identity.staff_position.manage',
  'admin-nutrition-reviews': 'pt.operations.manage',
  'admin-eat-clean': 'eat_clean.operations.manage',
  'admin-notifications': 'identity.staff_position.manage',
} as const
