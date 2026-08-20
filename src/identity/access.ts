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
  'dish-collection': 'nutrition.catalog.internal.view',
  'trainer-portal': 'pt.students.assigned.view',
  'schedule-pt': 'pt.schedule.self.view',
  'sales-portal': 'sales.quotes.self.manage',
} as const
