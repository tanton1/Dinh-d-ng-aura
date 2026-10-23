import type { PtScheduleValidationSnapshot, PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'

type Raw = Record<string, unknown>
const object = (value: unknown): value is Raw => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function readValidationSnapshot(value: unknown, branchId: string, weekId: string, source?: Raw): PtScheduleValidationSnapshot | null {
  if (object(value) && value.storage === 'top_level') {
    const draft = object(source?.draft) ? source.draft : {}
    const branch = object(source?.branch) ? source.branch : {}
    // A pointer is a size optimization, not permission to reinterpret cheap
    // matrix fields as exact. A dirty marker may retain the older exact body.
    if (!source || source.verification !== 'exact' || source.readMode === 'display' || source.partial === true || (source.branchId || branch.id) !== branchId
      || source.weekId !== weekId || Number(value.dirtyGeneration) > Number(source.dirtyGeneration || 0)
      || Number(draft.revision ?? source.draftRevision) !== value.draftRevision) return null
    value = { ...value, storage: 'embedded', coverage: source.coverage, summary: source.summary,
      warnings: source.warnings, unassignedEntries: source.unassignedEntries, weeklySessionCoverage: source.weeklySessionCoverage, contracts: source.contracts }
  }
  if (!object(value) || value.schemaVersion !== 1 || value.branchId !== branchId || value.weekId !== weekId
    || !object(value.coverage) || !object(value.coverage.byStudent) || !object(value.summary)
    || value.coverage.verification !== 'exact' || value.coverage.verified !== true
    || !['draftRevision', 'dirtyGeneration'].every((key) => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && Number(value[key]) >= 0)
    || !Array.isArray(value.warnings) || !Array.isArray(value.unassignedEntries)
    || !value.warnings.every(row => object(row) && typeof row.code === 'string')
    || !value.unassignedEntries.every(row => object(row) && typeof row.studentId === 'string')
    || !Object.values(value.coverage.byStudent).every(row => object(row) && typeof row.studentId === 'string'
      && ['targetSessions', 'scheduledSessions', 'draftSessions', 'otherBranchSessions', 'missingSessions']
        .every(key => typeof row[key] === 'number' && Number.isFinite(row[key]) && Number(row[key]) >= 0))
    || !['totalTargetSessions', 'scheduledEntries', 'missingSessions', 'studentsWithAtLeastOne', 'fullyScheduledStudents']
      .every((key) => typeof (value.coverage as Raw)[key] === 'number' && Number.isFinite((value.coverage as Raw)[key]) && Number((value.coverage as Raw)[key]) >= 0)) return null
  return value as unknown as PtScheduleValidationSnapshot
}

/** Two independent facts: current matrix transport and last exact validation. */
export function applyWeeklyValidation(next: PtScheduleWorkspaceV2Result, source: Raw, current?: PtScheduleWorkspaceV2Result | null): PtScheduleWorkspaceV2Result {
  const sameScope = current?.branch.id === next.branch.id && current.weekId === next.weekId
  const declaresValidation = 'validationState' in source || 'validationSnapshot' in source
  const draft = object(source.draft) ? source.draft : {}
  // Rollout: an older exact document has no explicit artifact yet. Retain its
  // verified evidence before a later dirty marker or light matrix replaces it.
  const legacy = !declaresValidation && source.verification === 'exact' && source.readMode !== 'display' && source.partial !== true
    ? { schemaVersion: 1, storage: 'embedded', branchId: next.branch.id, weekId: next.weekId,
      sourceRevision: source.sourceRevision ?? next.weeklyViewSourceRevision ?? '', draftRevision: draft.revision ?? source.draftRevision ?? next.draftRevision,
      dirtyGeneration: source.dirtyGeneration ?? next.weeklyViewDirtyGeneration ?? 0,
      validatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : null,
      coverage: source.coverage, summary: source.summary, warnings: source.warnings, unassignedEntries: source.unassignedEntries,
      weeklySessionCoverage: source.weeklySessionCoverage, contracts: source.contracts }
    : null
  const provided = readValidationSnapshot(source.validationSnapshot ?? legacy, next.branch.id, next.weekId, source)
  const retained = sameScope ? readValidationSnapshot(current?.validationSnapshot, next.branch.id, next.weekId) : null
  const snapshot = provided && (!retained || provided.dirtyGeneration >= retained.dirtyGeneration && provided.draftRevision >= retained.draftRevision) ? provided : retained
  const pending = source.dirty === true || source.rebuilding === true || source.freshness === 'stale' || source.validationDirty === true
  const exact = !pending && source.partial !== true && (source.verification === 'exact'
    || source.verification === undefined && (source.readMode === 'reconciled' || source.freshness === 'verified'))
  const requiresProof = declaresValidation || source.verification === 'exact'
  const state = exact && (!requiresProof || Boolean(provided)) && (source.validationState === undefined || source.validationState === 'current')
    ? 'current' : snapshot ? 'stale' : 'unknown'
  return {
    ...next,
    validationState: state,
    validationDirty: source.validationDirty === true,
    validationSnapshot: snapshot,
    // Keep old detailed evidence informational. A clean display projection is
    // synchronized transport, not an assertion of current contract validity.
    readMode: state === 'current' ? 'reconciled' : 'display',
    partial: state !== 'current',
    reconciliationState: state === 'current' ? 'current' : snapshot || next.reconciliationState === 'stale' ? 'stale' : 'not_loaded',
  }
}
