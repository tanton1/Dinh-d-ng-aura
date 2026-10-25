import type { AcademyWorkbookState } from '../../services/academyLearningService'

// These markers describe the device draft, never the learning evidence itself.
export function academyWorkbookSignature(workbook: AcademyWorkbookState) {
  const { cloudRevision: _revision, updatedAt: _updated, pendingSync: _pending, localEditId: _edit, ...content } = workbook
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]))
    return value
  }
  return JSON.stringify(stable(content))
}

export function prepareAcademyWorkbookDraft(state: AcademyWorkbookState, now: number, editId: string): AcademyWorkbookState {
  return { ...state, updatedAt: Math.max(now, state.updatedAt + 1), pendingSync: true, localEditId: editId }
}

/** An older network response may advance the base revision, but never replace newer answers. */
export function acknowledgeAcademyWorkbook(
  current: AcademyWorkbookState,
  sent: AcademyWorkbookState,
  acknowledged: AcademyWorkbookState,
): AcademyWorkbookState {
  if (current.cloudRevision > acknowledged.cloudRevision) return current
  if (current.cloudRevision !== sent.cloudRevision && current.cloudRevision !== acknowledged.cloudRevision) return current
  if (academyWorkbookSignature(current) === academyWorkbookSignature(sent)) {
    return { ...acknowledged, localEditId: current.localEditId, pendingSync: false }
  }
  return { ...current, cloudRevision: acknowledged.cloudRevision, pendingSync: true }
}

export class AcademyWorkbookConflictError extends Error {
  readonly remoteRevision: number
  constructor(remoteRevision: number) {
    super('Workbook đã có thay đổi mới hơn từ một thiết bị khác.')
    this.name = 'AcademyWorkbookConflictError'
    this.remoteRevision = remoteRevision
  }
}

export function reconcileAcademyWorkbook(
  local: AcademyWorkbookState,
  remote: AcademyWorkbookState,
  preferRemote = false,
): AcademyWorkbookState {
  if (preferRemote) return { ...remote, pendingSync: false }
  if (local.cloudRevision > remote.cloudRevision) return local
  // Also recovers an acknowledged write whose response was lost in transit.
  if (academyWorkbookSignature(local) === academyWorkbookSignature(remote)) return { ...remote, pendingSync: false }
  const hasLocalChanges = local.pendingSync === true || (local.pendingSync === undefined && local.updatedAt > remote.updatedAt)
  if (hasLocalChanges) {
    if (local.cloudRevision !== remote.cloudRevision) throw new AcademyWorkbookConflictError(remote.cloudRevision)
    return { ...local, pendingSync: true }
  }
  return { ...remote, pendingSync: false }
}

export function serializeAcademyWorkbookForCloud(state: AcademyWorkbookState) {
  const { pendingSync: _pending, localEditId: _edit, ...content } = state
  const body = JSON.stringify(content)
  // Firestore rules cap body.size() at 20,000. Never truncate JSON mid-field.
  if (new TextEncoder().encode(body).byteLength > 20_000) throw new AcademyWorkbookSizeError()
  return body
}

export class AcademyWorkbookSizeError extends Error {
  constructor() {
    super('Bài thực hành quá dài để đồng bộ. Bản đầy đủ vẫn còn trên thiết bị; hãy rút gọn câu trả lời.')
    this.name = 'AcademyWorkbookSizeError'
  }
}
