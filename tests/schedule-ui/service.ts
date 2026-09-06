export type PtScheduleDraftCommand = string
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const baseStudent = { status: 'active', branchId: 'b', sessionsPerWeek: 2, defaultSessionsPerWeek: 2, weeklySessionTargetOverride: null, weeklySessionTargetOverridden: false, maxWeeklySessions: 7, schedulableSessionsThisWeek: 6, availableSlots: ['T2-6', 'T3-6', 'T4-6'], availabilityStatus: 'submitted', availabilityRevision: 1, eligibleForWeek: true, eligibilityReasons: [], eligibleContractIds: [], validScheduleDates: [], pausedScheduleDates: [], remainingSchedulableSessions: 20 }
const trainer = { id: 't', name: 'Mai', status: 'active', branchId: 'b', slotCapacity: 2, availabilityMode: 'configured', availabilityRevision: 1, availableSlots: ['T2-6', 'T3-6', 'T4-6'], employmentType: 'full_time', dailySessionTarget: 8 }
let workspace: any = { schemaVersion: 2, branch: { id: 'b', name: 'CS1', status: 'active' }, weekId: '', draftRevision: 1, draftStatus: 'draft', publishedVersion: 0, schedule: { 'T2-6': [{ studentId: 'a', trainerId: 't', contractId: 'c-a', type: 'training', branchId: 'b', source: 'manual_v2' }] }, students: [{ ...baseStudent, id: 'a', name: 'Lan' }, { ...baseStudent, id: 'b', name: 'Ngọc' }], trainers: [trainer], contracts: ['a', 'b'].map((id) => ({ id: 'c-' + id, studentId: id, status: 'active', trainerId: 't', trainerIds: [], branchId: 'b', packageName: 'Gói 24', startDate: '2020-01-01', endDate: '2099-12-31', totalSessions: 24, usedSessions: 0 })), sessions: [], warnings: [], unassignedEntries: [], scheduleConfig: { workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'], workingHours: [6, 7], holidays: [] }, summary: { eligibleStudents: 2, trainers: 1, unconfiguredTrainers: 0 } }
const track = (operation: string, input: any) => { (window as any).__scheduleCalls ??= []; (window as any).__scheduleCalls.push({ operation, input }) }
export const listPtScheduleBranches = async () => ({ branches: [{ id: 'b', name: 'CS1' }, { id: 'c', name: 'CS2' }] })
export const getPtScheduleWorkspace = async (input: any) => { track('load', input); return structuredClone({ ...workspace, weekId: input.weekId, branch: { ...workspace.branch, id: input.branchId } }) }
export const ptScheduleConflictLabel = (code: string) => code
export const asPtSchedulePublishError = (error: any) => ({ ...error, message: error.message || 'Lỗi thử nghiệm', conflicts: [], errorDetails: error.errorDetails || [] })
export const getPtScheduleSlotCandidates = async (input: any) => { track('candidates', input); return { candidates: workspace.students.map((s: any) => ({ studentId: s.id, name: s.name, phone: '', eligible: !(workspace.schedule[input.slotId] || []).some((e: any) => e.studentId === s.id), manualSelectable: !(workspace.schedule[input.slotId] || []).some((e: any) => e.studentId === s.id), matchesStudentAvailability: true, reasons: [], contractId: `c-${s.id}` })) } }
export const applyPtScheduleDraftCommand = async (input: any) => {
  track('command', input); await sleep(200)
  if ((window as any).__failScheduleCommand) throw Error('Ca đích không hợp lệ; ca cũ được giữ')
  if (input.command === 'move_student') {
    workspace.schedule[input.payload.fromSlotId] = workspace.schedule[input.payload.fromSlotId].filter((e: any) => e.studentId !== input.payload.studentId)
    workspace.schedule[input.payload.slotId] ??= []
    workspace.schedule[input.payload.slotId].push({ studentId: input.payload.studentId, trainerId: input.payload.trainerId, type: 'training', source: 'manual_v2', branchId: 'b' })
  }
  if (input.command === 'add_student') { workspace.schedule[input.payload.slotId] ??= []; workspace.schedule[input.payload.slotId].push({ ...input.payload, type: 'training', source: 'manual_v2', branchId: 'b' }) }
  workspace.draftRevision++
  return structuredClone({ draftRevision: workspace.draftRevision, schedule: workspace.schedule })
}
export const generatePtScheduleDraft = async (input: any) => { track('generate', input); await sleep(500); workspace.draftRevision++; return structuredClone({ schedule: workspace.schedule, draftRevision: workspace.draftRevision, warnings: [], unassignedEntries: [], optimizationSummary: { optimizationPasses: 2 } }) }
export const validatePtScheduleDraft = async (input: any) => { track('validate', input); if ((window as any).__failScheduleValidation) throw Object.assign(Error('Lịch còn xung đột'), { errorDetails: [{ code: 'OUTSIDE_STUDENT_AVAILABILITY', slotId: 'T2-6', studentId: 'a', studentName: 'Lan', trainerId: 't', trainerName: 'Mai' }] }); return { draftRevision: workspace.draftRevision, version: 1, diff: { create: 2, update: 0, cancel: 0, unchanged: 0 }, warnings: [] } }
export const publishPtSchedule = async (input: any) => { track('publish', input); workspace.publishedVersion++; workspace.draftStatus = 'published'; return { version: workspace.publishedVersion, unchanged: false } }
export const listPtScheduleVersions = async () => ({ currentDraftRevision: workspace.draftRevision, currentVersion: 1, versions: [] })
export const restorePtScheduleVersionToDraft = async () => ({ version: 1, draftRevision: workspace.draftRevision })
export const savePtStudentAvailability = async () => ({ availableSlots: [], availabilityRevision: 2, availabilityStatus: 'submitted' })
