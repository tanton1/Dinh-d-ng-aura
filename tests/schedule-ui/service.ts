export type PtScheduleDraftCommand = string
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
function offConfirmationResult(input: any) {
  if (!input.payload?.confirmStudentOff) return {}
  const offset = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].indexOf(input.payload.slotId.split('-')[0])
  const date = new Date(Date.parse(input.weekId + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10)
  return { adminOverride: true, adminOverrideBy: 'test-admin', adminOverrideWarnings: ['CONTRACT_PAUSED'], studentOffConfirmedDate: date }
}
const baseStudent = { status: 'active', branchId: 'b', sessionsPerWeek: 2, defaultSessionsPerWeek: 2, weeklySessionTargetOverride: null, weeklySessionTargetOverridden: false, maxWeeklySessions: 7, schedulableSessionsThisWeek: 6, availableSlots: ['T2-6', 'T3-6', 'T4-6'], availabilityStatus: 'submitted', availabilityRevision: 1, eligibleForWeek: true, eligibilityReasons: [], eligibleContractIds: [], validScheduleDates: [], pausedScheduleDates: [], remainingSchedulableSessions: 20 }
const trainer = { id: 't', name: 'Mai', status: 'active', branchId: 'b', slotCapacity: 2, availabilityMode: 'configured', availabilityRevision: 1, availableSlots: ['T2-6', 'T3-6', 'T4-6'], employmentType: 'full_time', dailySessionTarget: 8 }
const secondaryTrainer = { ...trainer, id: 't-secondary', name: 'Vy' }
const remainingTrainer = { ...trainer, id: 't-part-time', name: 'An', employmentType: 'part_time', availableSlots: ['T5-6'] }
const oldExpiredStudent = { ...baseStudent, id: 'old-contract', name: 'Hợp đồng cũ', eligibleForWeek: false, eligibilityReasons: ['CONTRACT_EXPIRED_BEFORE_WEEK'], availableSlots: [], availabilityStatus: 'missing', contractStatus: 'expired', contractEndDate: '2020-01-01', previousWeekScheduledSessions: 0, hadSchedulePreviousWeek: false }
const recentlyExpiredStudent = { ...oldExpiredStudent, id: 'recent-contract', name: 'Hợp đồng vừa hết', contractEndDate: '2099-01-01', previousWeekScheduledSessions: 1, hadSchedulePreviousWeek: true }
let workspace: any = { schemaVersion: 4, branch: { id: 'b', name: 'CS1', status: 'active' }, weekId: '', draftRevision: 1, draftStatus: 'draft', publishedVersion: 0, schedule: { 'T2-6': [{ studentId: 'a', trainerId: 't', contractId: 'c-a', type: 'training', branchId: 'b', source: 'manual_v2' }], 'T2-7': [{ studentId: 'c', trainerId: 't', contractId: 'c-c', type: 'training', branchId: 'b', source: 'manual_v2', isLocked: true }] }, students: [{ ...baseStudent, id: 'a', name: 'Lan' }, { ...baseStudent, id: 'b', name: 'Ngọc', availableSlots: ['T2-6', 'T2-7'] }, { ...baseStudent, id: 'c', name: 'Bình' }, oldExpiredStudent, recentlyExpiredStudent], trainers: [trainer, secondaryTrainer, remainingTrainer], contracts: [...['a', 'b', 'c'].map((id) => ({ id: 'c-' + id, studentId: id, status: 'active', trainerId: 't', trainerIds: id === 'a' ? ['t-secondary'] : [], branchId: 'b', packageName: 'Gói 24', startDate: '2020-01-01', endDate: '2099-12-31', totalSessions: 24, usedSessions: 0 })), { id: 'c-old', studentId: oldExpiredStudent.id, status: 'expired', trainerId: 't', trainerIds: [], branchId: 'b', packageName: 'Gói cũ', startDate: '2019-01-01', endDate: '2020-01-01', totalSessions: 24, usedSessions: 24 }, { id: 'c-recent', studentId: recentlyExpiredStudent.id, status: 'expired', trainerId: 't', trainerIds: [], branchId: 'b', packageName: 'Gói vừa hết', startDate: '2098-01-01', endDate: '2099-01-01', totalSessions: 24, usedSessions: 24 }], sessions: [], warnings: [], unassignedEntries: [{ studentId: oldExpiredStudent.id, studentName: oldExpiredStudent.name, missingSessions: 2, primaryReasonCode: 'CONTRACT_SESSION_QUOTA_EXCEEDED', blockerCategory: 'contract', reasonCodes: ['CONTRACT_SESSION_QUOTA_EXCEEDED'], diagnostics: { contractStatus: 'quota_exhausted', latestContractEndDate: '2020-01-01' } }], scheduleConfig: { workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'], workingHours: [6, 7], holidays: [] }, summary: { eligibleStudents: 3, trainers: 3, unconfiguredTrainers: 0 } }
Object.assign(workspace, (window as any).__workspaceOverride || {})
const track = (operation: string, input: any) => { (window as any).__scheduleCalls ??= []; (window as any).__scheduleCalls.push({ operation, input }) }
export const listPtScheduleBranches = async () => ({ branches: [{ id: 'b', name: 'CS1' }, { id: 'c', name: 'CS2' }] })
export const getPtScheduleWorkspace = async (input: any) => {
  track('load', input)
  if ((window as any).__failFullWorkspace) throw Error('Đối soát tạm gián đoạn')
  if ((window as any).__holdFullWorkspace) await new Promise<void>(resolve => { (window as any).__releaseFullWorkspace = resolve })
  if ((window as any).__workspaceDelayMs) await sleep((window as any).__workspaceDelayMs)
  return structuredClone({ ...workspace, weekId: input.weekId, branch: { ...workspace.branch, id: input.branchId }, readMode: 'reconciled', partial: false })
}
// The production workspace now paints from the one-document weekly view. The
// fixture returns the same bounded workspace shape so UI tests exercise the
// rollout path without requiring Firebase.
export const weeklyViewFixture = (input: any) => {
  const coverage = { verified: true, verification: 'exact', totalTargetSessions: 6, scheduledEntries: 2, missingSessions: 4, studentsWithAtLeastOne: 2, fullyScheduledStudents: 0,
    byStudent: { a: { studentId: 'a', targetSessions: 2, scheduledSessions: 1, draftSessions: 1, otherBranchSessions: 0, missingSessions: 1 }, b: { studentId: 'b', targetSessions: 2, scheduledSessions: 0, draftSessions: 0, otherBranchSessions: 0, missingSessions: 2 }, c: { studentId: 'c', targetSessions: 2, scheduledSessions: 1, draftSessions: 1, otherBranchSessions: 0, missingSessions: 1 } }, ...(window as any).__weeklyCoverageOverride }
  const full = { ...workspace, weekId: input.weekId, branch: { ...workspace.branch, id: input.branchId }, dirty: false, dirtyGeneration: 1, freshness: 'verified', verification: 'exact', coverage, weeklySessionCoverage: {}, readMode: 'reconciled', partial: false, viewRevision: 1, sourceRevision: 1 }
  const compact = {
    schemaVersion: 4, branchId: input.branchId, weekId: input.weekId,
    sourceRevision: 'semantic-hash-v2', viewRevision: 1, dirtyGeneration: 1, dirty: false, freshness: 'verified', verification: 'exact',
    draft: { revision: workspace.draftRevision, status: workspace.draftStatus, publishedVersion: workspace.publishedVersion, publishedRevision: -1 },
    schedule: workspace.schedule, students: workspace.students, trainers: workspace.trainers, contracts: workspace.contracts,
    scheduleConfig: workspace.scheduleConfig, warnings: workspace.warnings, unassignedEntries: workspace.unassignedEntries,
    summary: { eligibleStudents: 3, trainers: 3, scheduledEntries: 2, missingSessions: 2, warningCount: 1 },
    coverage, weeklySessionCoverage: {}, optimizationSummary: { slotUtilization: {}, studentCoverage: {}, optimizationPasses: 0 },
  }
  const view: any = { ...((window as any).__weeklyViewCompact ? compact : full), ...(window as any).__weeklyViewOverride }
  Object.assign(view, (window as any).__weeklyViewByBranch?.[input.branchId] || {})
  const mode = (window as any).__validationMode
  if (mode) {
    const metadata = { schemaVersion: 1, branchId: input.branchId, weekId: input.weekId, sourceRevision: 'independent-validation-hash', draftRevision: workspace.draftRevision, dirtyGeneration: 1, validatedAt: '2026-10-19T01:00:00Z' }
    const warnings = [{ code: 'STUDENT_MISSING_SESSIONS', studentId: 'b', studentName: 'Ngọc', studentPhone: '0900000002', missingSessions: 2, packageName: 'Gói 24', contractStatus: 'active', contractEndDate: '2099-12-31' }]
    const proof = { ...metadata, storage: 'embedded', coverage, summary: compact.summary, warnings, unassignedEntries: [], weeklySessionCoverage: {}, contracts: workspace.contracts }
    Object.assign(view, { validationState: mode === 'exact' ? 'current' : mode === 'stale' ? 'stale' : 'unknown', validationDirty: mode !== 'exact', validationSnapshot: mode === 'exact' ? { ...metadata, storage: 'top_level' } : mode === 'stale' ? proof : null,
      dirtyGeneration: 1, dirty: false, freshness: mode === 'exact' ? 'verified' : 'display', verification: mode === 'exact' ? 'exact' : 'draft_only' })
    if (mode === 'exact') Object.assign(view, { branchId: input.branchId, coverage, warnings, unassignedEntries: [] })
    if ((window as any).__legacyValidation) {
      delete view.validationState
      delete view.validationDirty
      delete view.validationSnapshot
    }
  }
  return structuredClone(view)
}
export const getPtScheduleWeeklyView = async (input: any) => {
  track('weekly-view', input)
  if ((window as any).__weeklyViewDelayMs) await sleep((window as any).__weeklyViewDelayMs)
  if ((window as any).__holdWeeklyView) await new Promise<void>((resolve) => { (window as any).__releaseWeeklyView = resolve })
  if ((window as any).__weeklyViewError) throw Object.assign(new Error('Không thể tải lịch thử nghiệm'), { issueCode: (window as any).__weeklyViewError })
  ;(window as any).__weeklyViewResponses = Number((window as any).__weeklyViewResponses || 0) + 1
  const view = weeklyViewFixture(input)
  if ((window as any).__omitWeeklyResponseGeneration) delete view.dirtyGeneration
  return view
}
export const ptScheduleConflictLabel = (code: string) => code === 'STUDENT_AVAILABILITY_DAYS_INSUFFICIENT'
  ? 'Học viên đăng ký chưa đủ số ngày rảnh để hoàn thành mục tiêu tuần.'
  : code === 'STUDENT_MISSING_SESSIONS' ? 'Học viên chưa được xếp đủ số buổi trong tuần.'
  : code === 'STUDENT_UNSCHEDULED' ? 'Chưa tìm được đủ ca hợp lệ cho học viên.'
  : code === 'PROFILE_DATA_INCOMPLETE' ? 'Hồ sơ còn thiếu thông tin phục vụ xếp lịch.'
  : code
export const asPtSchedulePublishError = (error: any) => ({ ...error, message: error.message || 'Lỗi thử nghiệm', conflicts: [], errorDetails: error.errorDetails || [] })
export const getPtScheduleSlotCandidates = async (input: any) => { track('candidates', input); return { candidates: input.directoryOnly || input.crossBranchOnly ? ((window as any).__searchCandidates || []) : workspace.students.map((s: any) => ({ studentId: s.id, name: s.name, phone: '', eligible: !(workspace.schedule[input.slotId] || []).some((e: any) => e.studentId === s.id), manualSelectable: !(workspace.schedule[input.slotId] || []).some((e: any) => e.studentId === s.id), matchesStudentAvailability: true, reasons: [], contractId: `c-${s.id}` })) } }
export const applyPtScheduleDraftCommand = async (input: any) => {
  track('command', input); await sleep(200)
  if ((window as any).__failScheduleCommand) throw Error('Ca đích không hợp lệ; ca cũ được giữ')
  if (input.command === 'move_student') {
    workspace.schedule[input.payload.fromSlotId] = workspace.schedule[input.payload.fromSlotId].filter((e: any) => e.studentId !== input.payload.studentId)
    workspace.schedule[input.payload.slotId] ??= []
    workspace.schedule[input.payload.slotId].push({ studentId: input.payload.studentId, trainerId: input.payload.trainerId, type: 'training', source: 'manual_v2', branchId: 'b', ...offConfirmationResult(input) })
  }
  if (input.command === 'add_student') { workspace.schedule[input.payload.slotId] ??= []; workspace.schedule[input.payload.slotId].push({ ...input.payload, type: 'training', source: 'manual_v2', branchId: 'b', ...offConfirmationResult(input) }) }
  if (input.command === 'reset_draft') {
    workspace.schedule = Object.fromEntries(Object.entries(workspace.schedule)
      .map(([slotId, entries]: [string, any]) => [slotId, entries.filter((entry: any) => entry.type === 'off' || entry.source === 'published_existing')])
      .filter(([, entries]: any) => entries.length))
  }
  workspace.draftRevision++
  return structuredClone({ draftRevision: workspace.draftRevision, schedule: workspace.schedule })
}
export const applyAdminPtScheduleEdit = async (input: any) => {
  track('admin-command', input)
  await sleep(80)
  if ((window as any).__failScheduleCommand) throw Error('Điều chỉnh thất bại; ca cũ được giữ')
  if (input.command === 'move_student') {
    workspace.schedule[input.payload.fromSlotId] = workspace.schedule[input.payload.fromSlotId].filter((e: any) => e.studentId !== input.payload.studentId)
    workspace.schedule[input.payload.slotId] ??= []
    workspace.schedule[input.payload.slotId].push({ studentId: input.payload.studentId, trainerId: input.payload.trainerId, type: 'training', source: 'manual_v2', branchId: 'b', isLocked: true, ...offConfirmationResult(input) })
  }
  if (input.command === 'add_student') { workspace.schedule[input.payload.slotId] ??= []; workspace.schedule[input.payload.slotId].push({ ...input.payload, type: 'training', source: 'manual_v2', branchId: 'b', ...offConfirmationResult(input) }) }
  if (input.command === 'remove_student') {
    workspace.schedule[input.payload.slotId] = (workspace.schedule[input.payload.slotId] || []).filter((e: any) => e.studentId !== input.payload.studentId)
  }
  workspace.draftRevision++
  return structuredClone({ draftRevision: workspace.draftRevision, schedule: workspace.schedule, sessionChanged: true })
}
export const generatePtScheduleDraft = async (input: any) => {
  track('generate', input); await sleep(500); workspace.draftRevision++
  if ((window as any).__generatedSchedule) workspace.schedule = (window as any).__generatedSchedule
  return structuredClone({ schedule: workspace.schedule, draftRevision: workspace.draftRevision, warnings: [], unassignedEntries: (window as any).__generatedUnassigned || [], optimizationSummary: { optimizationPasses: 2 } })
}
export const validatePtScheduleDraft = async (input: any) => { track('validate', input); if ((window as any).__failScheduleValidation) throw Object.assign(Error('Lịch còn xung đột'), { errorDetails: [{ code: 'OUTSIDE_STUDENT_AVAILABILITY', slotId: 'T2-6', studentId: 'a', studentName: 'Lan', trainerId: 't', trainerName: 'Mai' }] }); return { draftRevision: workspace.draftRevision, version: 1, diff: { create: 2, update: 0, cancel: 0, unchanged: 0 }, warnings: (window as any).__validationWarnings || [] } }
export const publishPtSchedule = async (input: any) => { track('publish', input); workspace.publishedVersion++; workspace.draftStatus = 'published'; return { version: workspace.publishedVersion, unchanged: false } }
export const listPtScheduleVersions = async () => ({ currentDraftRevision: workspace.draftRevision, currentVersion: 1, versions: (window as any).__scheduleVersions || [] })
export const restorePtScheduleVersionToDraft = async (input: any) => { track('restore', input); return { version: input.version, draftRevision: workspace.draftRevision } }
export const savePtStudentAvailability = async (input: any) => {
  track('save-availability', input)
  if ((window as any).__holdAvailabilitySave) await new Promise<void>((resolve) => { (window as any).__releaseAvailabilitySave = resolve })
  if ((window as any).__failAvailabilitySave) throw Error('Không lưu được lịch rảnh; hãy thử lại')
  return { availableSlots: [], availabilityRevision: 2, availabilityStatus: 'submitted' }
}
export const reopenPtStudentAvailability = async (input: any) => {
  track('reopen-availability', input)
  if ((window as any).__holdAvailabilityReopen) await new Promise<void>((resolve) => { (window as any).__releaseAvailabilityReopen = resolve })
  await sleep(50)
  const student = workspace.students.find((item: any) => item.id === input.studentId)
  const availabilityRevision = Number(student?.availabilityRevision || 1) + 1
  return {
    schemaVersion: 4,
    changed: true,
    availabilityRevision,
    availabilityStatus: 'reopened',
    availabilityLocked: false,
    reopenedUntil: '2099-12-31T23:59:59.000Z',
  }
}
export const setPtStudentWeeklyTarget = async (input: any) => {
  track('weekly-target', input)
  await sleep(50)
  const student = workspace.students.find((item: any) => item.id === input.studentId)
  const targetSessions = input.resetToDefault
    ? Number(student?.defaultSessionsPerWeek || student?.sessionsPerWeek || 0)
    : Number(input.targetSessions || 0)
  return {
    schemaVersion: 4,
    changed: true,
    revision: Number(student?.availabilityRevision || 1) + 1,
    targetSessions,
    weeklySessionTargetOverride: input.resetToDefault ? null : targetSessions,
    weeklySessionTargetOverridden: !input.resetToDefault,
    draftRevision: workspace.draftRevision,
  }
}
// The production component imports this callable unconditionally. Keep the
// fixture adapter's export surface in sync even though no historical session
// is persisted by the UI test.
export const createHistoricalPtSession = async (input: any) => {
  track('historical', input)
  await sleep(50)
  return { sessionId: `historical-${input.studentId}-${input.slotId}`, draftRevision: workspace.draftRevision }
}
