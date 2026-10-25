import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AcademyWorkbookConflictError, AcademyWorkbookSizeError, loadAcademyWorkbook,
  beginAcademyWorkbookDefinition, emptyAcademyWorkbookState,
  loadAcademyWorkbookFromCloud, persistAcademyWorkbookDraft, saveAcademyWorkbook,
  type AcademyWorkbookState,
} from '../../services/academyLearningService'
import { acknowledgeAcademyWorkbook } from './workbookPersistence'
import { useAcademySessionEpoch } from './useAcademySessionEpoch'

export type AcademyWorkbookSyncIssue = 'conflict' | 'offline' | 'size' | null

export function useAcademyWorkbook(ownerId: string, courseId: string, lessonId: string, canStudy: boolean, options: { loadEnabled?: boolean; definitionVersion?: number; definitionHash?: string } = {}) {
  const loadEnabled = options.loadEnabled !== false
  const definitionVersion = options.definitionVersion ?? 1
  const definitionHash = options.definitionHash
  const sessionEpoch = useAcademySessionEpoch()
  const scope = JSON.stringify([ownerId, courseId, lessonId, definitionVersion, definitionHash, sessionEpoch])
  const [workbook, setWorkbook] = useState(() => loadAcademyWorkbook(ownerId, courseId, lessonId, definitionVersion, definitionHash))
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [issue, setIssue] = useState<AcademyWorkbookSyncIssue>(null)
  const [deviceSaved, setDeviceSaved] = useState(true)
  const [retryNonce, setRetryNonce] = useState(0)
  const workbookRef = useRef(workbook)
  const scopeRef = useRef(scope)
  const activeRef = useRef(false)
  const generationRef = useRef(0)
  const inFlightRef = useRef<Promise<AcademyWorkbookState> | null>(null)

  const replace = useCallback((state: AcademyWorkbookState) => {
    workbookRef.current = state
    setWorkbook(state)
  }, [])

  useEffect(() => {
    generationRef.current += 1
    activeRef.current = true
    scopeRef.current = scope
    inFlightRef.current = null
    const local = loadAcademyWorkbook(ownerId, courseId, lessonId, definitionVersion, definitionHash)
    replace(local)
    setReady(false)
    setSaving(false)
    setIssue(null)
    setDeviceSaved(true)
    let active = true
    if (!loadEnabled) return () => { active = false; activeRef.current = false }
    void loadAcademyWorkbookFromCloud(ownerId, courseId, lessonId, { definitionVersion, definitionHash, isCurrent: () => active })
      .then((state) => { if (active) replace(state) })
      .catch((error: unknown) => {
        if (active) setIssue(error instanceof AcademyWorkbookConflictError ? 'conflict' : 'offline')
      })
      .finally(() => { if (active) setReady(true) })
    return () => { active = false; activeRef.current = false }
  }, [ownerId, courseId, lessonId, scope, replace, loadEnabled, definitionVersion, definitionHash])

  const change = useCallback((update: (current: AcademyWorkbookState) => AcademyWorkbookState) => {
    if (!canStudy || !ready || scopeRef.current !== scope || !activeRef.current) return
    const result = persistAcademyWorkbookDraft(ownerId, courseId, lessonId, update(workbookRef.current))
    replace(result.state)
    setDeviceSaved(result.stored)
    // Size failures can be resolved by editing; conflicts require an explicit choice.
    setIssue((current) => current === 'size' ? null : current)
  }, [canStudy, ready, ownerId, courseId, lessonId, scope, replace])

  const sync = useCallback(() => {
    if (inFlightRef.current) return inFlightRef.current
    const sent = workbookRef.current
    if (!canStudy || !ready || !sent.pendingSync || !activeRef.current || scopeRef.current !== scope) return Promise.resolve(sent)
    setSaving(true)
    const generation = generationRef.current
    const stillHere = () => activeRef.current && scopeRef.current === scope && generationRef.current === generation
    const promise = saveAcademyWorkbook(ownerId, courseId, lessonId, sent)
      .then((acknowledged) => {
        if (stillHere()) {
          const merged = acknowledgeAcademyWorkbook(workbookRef.current, sent, acknowledged)
          replace(merged)
          setIssue(null)
          return merged
        }
        return acknowledged
      })
      .catch((error: unknown) => {
        if (stillHere()) setIssue(error instanceof AcademyWorkbookConflictError ? 'conflict' : error instanceof AcademyWorkbookSizeError ? 'size' : 'offline')
        throw error
      })
      .finally(() => {
        if (stillHere()) { inFlightRef.current = null; setSaving(false) }
      })
    inFlightRef.current = promise
    return promise
  }, [canStudy, ready, ownerId, courseId, lessonId, scope, replace])

  useEffect(() => {
    if (!ready || !canStudy || !workbook.pendingSync || saving || issue) return
    const timer = window.setTimeout(() => { void sync().catch(() => undefined) }, 600)
    return () => window.clearTimeout(timer)
  }, [ready, canStudy, workbook, saving, issue, retryNonce, sync])

  useEffect(() => {
    const online = () => setIssue((current) => current === 'offline' ? null : current)
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [])

  const reload = async () => {
    const generation = generationRef.current
    const stillHere = () => activeRef.current && scopeRef.current === scope && generationRef.current === generation
    setReady(false)
    try {
      // The service preserves a recovery copy before replacing a pending device draft.
      const remote = await loadAcademyWorkbookFromCloud(ownerId, courseId, lessonId, { preferRemote: true, definitionVersion, definitionHash, isCurrent: stillHere })
      if (stillHere()) { replace(remote); setIssue(null) }
    } catch (error) {
      if (stillHere()) setIssue(error instanceof AcademyWorkbookConflictError ? 'conflict' : 'offline')
    } finally {
      if (stillHere()) setReady(true)
    }
  }

  const flush = async () => {
    const generation = generationRef.current
    const assertCurrent = () => {
      if (!activeRef.current || scopeRef.current !== scope || generationRef.current !== generation) throw new Error('Bài học hoặc phiên đăng nhập đã thay đổi. Hãy mở lại bài đang làm.')
    }
    assertCurrent()
    if (issue === 'conflict') throw new Error('Cần xử lý bản xung đột trước khi nộp bài.')
    await sync()
    assertCurrent()
    if (workbookRef.current.pendingSync) { await sync(); assertCurrent() }
    if (workbookRef.current.pendingSync) throw new Error('Bài đang được chỉnh sửa. Hãy chờ đồng bộ xong trước khi nộp.')
    return workbookRef.current
  }

  const beginDefinition = async (version: number, localOnly = false) => {
    if (!canStudy || !ready || issue === 'conflict' || saving) throw new Error('Hãy xử lý đồng bộ trước khi đổi bài thực hành.')
    const generation = generationRef.current
    const previous = localOnly ? workbookRef.current : await flush()
    if (!activeRef.current || scopeRef.current !== scope || generationRef.current !== generation) throw new Error('Bài học đã thay đổi.')
    const next = beginAcademyWorkbookDefinition(ownerId, courseId, lessonId, previous, version, definitionHash)
    replace(next)
    setDeviceSaved(true)
    setIssue(null)
  }

  const status = !deviceSaved && workbook.pendingSync ? 'Chưa lưu trên thiết bị'
    : saving ? 'Đang đồng bộ…'
      : workbook.pendingSync ? 'Đã lưu trên thiết bị'
        : workbook.cloudRevision > 0 ? 'Đã đồng bộ'
          : 'Chưa có thay đổi'
  return {
    workbook: scopeRef.current === scope ? workbook : { ...emptyAcademyWorkbookState(), definitionVersion, definitionHash },
    ready: ready && scopeRef.current === scope, saving, issue, deviceSaved, status, change, reload, flush, beginDefinition,
    synced: workbook.cloudRevision > 0 && !workbook.pendingSync,
    retry: () => { setIssue(null); setRetryNonce((value) => value + 1) },
  }
}
