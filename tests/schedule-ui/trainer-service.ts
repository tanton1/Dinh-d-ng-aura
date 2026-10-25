const DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const HOURS = [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20]
let recurring = ['T2-6', 'T3-6']
let recurringRevision = 4
const weeks = new Map<string, { slots: string[]; offDates: string[]; revision: number }>()
const track = (operation: string, input: unknown) => {
  ;(window as any).__trainerCalls ??= []
  ;(window as any).__trainerCalls.push({ operation, input })
}
function read(weekId?: string) {
  const weekly = weekId ? weeks.get(weekId) : undefined
  return {
    schemaVersion: 2, trainerId: 't', trainerName: 'Mai', branchId: 'b',
    availableSlots: [...(weekly?.slots ?? recurring)], baseAvailableSlots: [...recurring],
    weekId: weekId || null, weeklyOverride: Boolean(weekly), offDates: [...(weekly?.offDates || [])], locked: false,
    source: weekly ? 'weekly' : 'recurring', availabilityMode: 'configured',
    availabilityRevision: weekId ? weekly?.revision || 0 : recurringRevision,
    updatedAt: null, cutoffAt: null,
    scheduleConfig: { workingDays: (window as any).__trainerDays || DAYS, workingHours: HOURS },
  }
}
export async function getMyTrainerAvailability(weekId?: string) {
  track('read-pt', { weekId })
  if ((window as any).__holdTrainerRead) await new Promise<void>((resolve) => { (window as any).__releaseTrainerRead = resolve })
  return structuredClone(read(weekId))
}
export async function getPtTrainerAvailability(trainerUid: string, weekId?: string) {
  track('read-admin', { trainerUid, weekId })
  return { ...structuredClone(read(weekId)), canManage: true }
}
async function save(input: any, admin = false) {
  track(admin ? 'save-admin' : 'save-pt', input)
  if ((window as any).__holdTrainerSave) await new Promise<void>((resolve) => { (window as any).__releaseTrainerSave = resolve })
  if ((window as any).__failTrainerSave) throw Error('Lịch rảnh tuần đã thay đổi ở thiết bị khác. Hãy tải lại.')
  if (input.expectedRevision !== read(input.weekId).availabilityRevision) throw Error('Lịch rảnh tuần đã thay đổi ở thiết bị khác. Hãy tải lại.')
  if (input.weekId) weeks.set(input.weekId, { slots: input.availableSlots, offDates: input.offDates, revision: input.expectedRevision + 1 })
  else { recurring = input.availableSlots; recurringRevision += 1 }
  return { ...structuredClone(read(input.weekId)), canManage: admin }
}
export const saveMyTrainerAvailability = (input: any) => save(input)
export const savePtTrainerAvailability = (input: any) => save(input, true)

export const useDatabase = () => ({ branches: [{ id: 'b', name: 'Aura' }], scheduleConfig: { workingDays: DAYS, workingHours: HOURS }, addBranch() {}, updateBranch() {}, deleteBranch() {} })
export const listPayrollPolicies = async () => []
export const listIdentityDirectory = async () => ({
  entries: [{ user: { uid: 't', displayName: 'Mai', email: 'mai@example.test', role: 'trainer', status: 'active' },
    assignment: { accessRole: 'staff', positions: ['trainer_pt'], branchIds: ['b'], status: 'active' },
    staffOperations: { name: 'Mai', availableSlots: recurring, availabilityRevision: recurringRevision, role: 'trainer', status: 'active', employmentType: 'full_time', employmentLevel: 'official', slotCapacity: 2, dailySessionTarget: 8, schedulingPriority: 100 },
    managedClientCounts: { main: 0, secondary: 0, nutrition: 0 },
  }], hasMore: false, nextCursor: null, summary: { accounts: 1, staff: 1, admins: 0 },
})
export const saveStaffOperationsProfile = async (input: any) => { track('save-profile', input); return {} }
export const applyDefaultTrainerSchedulingPolicy = async () => ({})
export const assignStaffPositions = async () => ({})
export const deleteMemberAccount = async () => ({})
export const deleteUnusedStaffAccount = async () => ({})
export const provisionStaffAccount = async () => ({})
export const provisionStudentAccount = async () => ({})
export const restoreAccountAccess = async () => ({})
export const suspendAccountAccess = async () => ({})
