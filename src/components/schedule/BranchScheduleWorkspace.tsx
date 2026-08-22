import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, RefreshCw, RotateCcw, Save, Sparkles, UsersRound } from 'lucide-react'
import type { Schedule, ScheduleEntry } from '../../types'
import type { AccessContext } from '../../identity/access'
import { getDatesForWeek } from '../../utils/dateUtils'
import { generateSchedule } from '../../utils/scheduler'
import PTSchedule from './PTSchedule'
import {
  asPtSchedulePublishError,
  getMyBranchScheduleWorkspace,
  listPtScheduleVersions,
  ptScheduleConflictLabel,
  publishPtSchedule,
  restorePtScheduleVersionToDraft,
  saveMyBranchScheduleDraft,
  validatePtScheduleDraft,
  type BranchScheduleWorkspaceResult,
  type PtSchedulePublishResult,
  type PtScheduleVersionListResult,
  type PtScheduleVersionSummary,
} from '../../services/ptSchedulePublishService'
import '../../styles-branch-schedule.css'

interface Props {
  accessContext: AccessContext
}

function formatPublishedAt(value: string | null) {
  if (!value) return 'Chưa có thời gian'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? 'Chưa có thời gian'
    : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

export default function BranchScheduleWorkspace({ accessContext }: Props) {
  const [branchId, setBranchId] = useState(accessContext.branchIds[0] || '')
  const [weekOffset, setWeekOffset] = useState(0)
  const [workspace, setWorkspace] = useState<BranchScheduleWorkspaceResult | null>(null)
  const [schedule, setSchedule] = useState<Schedule>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [publishPreview, setPublishPreview] = useState<PtSchedulePublishResult | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [history, setHistory] = useState<PtScheduleVersionListResult | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [restoreCandidate, setRestoreCandidate] = useState<PtScheduleVersionSummary | null>(null)

  const weekDates = useMemo(() => getDatesForWeek(weekOffset), [weekOffset])
  const weekId = weekDates.T2.full

  const loadWorkspace = async () => {
    if (!branchId) return
    setLoading(true)
    setError(null)
    try {
      const result = await getMyBranchScheduleWorkspace({ weekId, branchId })
      setWorkspace(result)
      setSchedule(result.schedule || {})
      setDirty(false)
    } catch (loadError) {
      setWorkspace(null)
      setSchedule({})
      setError(asPtSchedulePublishError(loadError).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    if (!branchId) return undefined
    setLoading(true)
    setError(null)
    getMyBranchScheduleWorkspace({ weekId, branchId })
      .then((result) => {
        if (!active) return
        setWorkspace(result)
        setSchedule(result.schedule || {})
        setDirty(false)
      })
      .catch((loadError) => {
        if (!active) return
        setWorkspace(null)
        setSchedule({})
        setError(asPtSchedulePublishError(loadError).message)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [branchId, weekId])

  useEffect(() => {
    setNotice(null)
    setPublishPreview(null)
    setHistory(null)
    setRestoreCandidate(null)
  }, [branchId, weekId])

  if (!accessContext.branchIds.length) {
    return <section className="branch-schedule branch-schedule__blocked"><CalendarDays size={30} /><h1>Chưa có phạm vi chi nhánh</h1><p>Quản trị viên cần cấp ít nhất một chi nhánh cho chức danh Quản lý chi nhánh trước khi mở lịch.</p></section>
  }

  const updateSlot = (slotId: string, updater: (currentEntries: ScheduleEntry[]) => ScheduleEntry[]) => {
    setSchedule((current) => ({ ...current, [slotId]: updater(current[slotId] || []) }))
    setDirty(true)
    setNotice(null)
  }

  const autoArrange = () => {
    if (!workspace) return
    const targetDate = new Date(`${weekId}T00:00:00+07:00`)
    const result = generateSchedule(
      workspace.students,
      workspace.trainers,
      workspace.contracts,
      workspace.sessions,
      workspace.scheduleConfig,
      schedule,
      undefined,
      targetDate,
    )
    setSchedule(result.schedule)
    setDirty(true)
    setNotice(result.warnings.length
      ? `Đã tạo lịch nháp, còn ${result.warnings.length} học viên cần kiểm tra.`
      : 'Đã tạo lịch nháp và chưa phát hiện học viên thiếu buổi.')
  }

  const saveDraft = async () => {
    if (!workspace || !dirty) return
    setSaving(true)
    setError(null)
    try {
      const result = await saveMyBranchScheduleDraft({
        weekId,
        branchId,
        expectedDraftRevision: workspace.draftRevision,
        schedule,
      })
      setWorkspace((current) => current ? { ...current, draftRevision: result.draftRevision } : current)
      setDirty(false)
      setNotice(`Đã lưu draft r${result.draftRevision}.`)
    } catch (saveError) {
      const normalized = asPtSchedulePublishError(saveError)
      setError(normalized.message)
      if (normalized.issueCode === 'REVISION_CONFLICT') void loadWorkspace()
    } finally {
      setSaving(false)
    }
  }

  const validatePublish = async () => {
    if (!workspace) return
    if (dirty) {
      setError('Hãy lưu draft trước khi kiểm tra publish.')
      return
    }
    setPublishing(true)
    setError(null)
    try {
      setPublishPreview(await validatePtScheduleDraft({ weekId, branchId, expectedDraftRevision: workspace.draftRevision }))
    } catch (validateError) {
      const normalized = asPtSchedulePublishError(validateError)
      const details = normalized.conflicts.map(ptScheduleConflictLabel)
      setError([normalized.message, ...details].join(' · '))
    } finally {
      setPublishing(false)
    }
  }

  const confirmPublish = async () => {
    if (!workspace || !publishPreview) return
    setPublishing(true)
    setError(null)
    try {
      const result = await publishPtSchedule({ weekId, branchId, expectedDraftRevision: publishPreview.draftRevision })
      setPublishPreview(null)
      setNotice(result.unchanged ? `Lịch đã ở phiên bản v${result.version}.` : `Đã publish an toàn phiên bản v${result.version}.`)
      await loadWorkspace()
    } catch (publishError) {
      const normalized = asPtSchedulePublishError(publishError)
      setError(normalized.message)
      if (normalized.issueCode === 'REVISION_CONFLICT') setPublishPreview(null)
    } finally {
      setPublishing(false)
    }
  }

  const openHistory = async () => {
    setHistoryBusy(true)
    setError(null)
    try {
      setHistory(await listPtScheduleVersions({ weekId, branchId }))
    } catch (historyError) {
      setError(asPtSchedulePublishError(historyError).message)
    } finally {
      setHistoryBusy(false)
    }
  }

  const restoreVersion = async () => {
    if (!restoreCandidate || !history) return
    setPublishing(true)
    setError(null)
    try {
      const result = await restorePtScheduleVersionToDraft({
        weekId,
        branchId,
        version: restoreCandidate.version,
        expectedDraftRevision: history.currentDraftRevision,
      })
      setRestoreCandidate(null)
      setHistory(null)
      setNotice(`Đã tạo draft r${result.draftRevision} từ lịch v${result.version}.`)
      await loadWorkspace()
    } catch (restoreError) {
      setError(asPtSchedulePublishError(restoreError).message)
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="branch-schedule">
      <header className="branch-schedule__hero">
        <div><span><CalendarDays size={16} /> AURA PT · LỊCH CHI NHÁNH</span><h1>Xếp lịch & ca tập</h1><p>Draft riêng theo tuần, kiểm tra xung đột phía server và publish có phiên bản.</p></div>
        <div className="branch-schedule__hero-controls">
          <label><span>Chi nhánh</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}>{accessContext.branchIds.map((id) => <option key={id} value={id}>{workspace?.branch.id === id ? workspace.branch.name : id}</option>)}</select></label>
          <div className="branch-schedule__week"><button type="button" aria-label="Tuần trước" onClick={() => setWeekOffset((value) => Math.max(0, value - 1))}><ChevronLeft /></button><div><span>Tuần làm việc</span><strong>{weekDates.T2.display} – {weekDates.CN.display}</strong></div><button type="button" aria-label="Tuần sau" onClick={() => setWeekOffset((value) => value + 1)}><ChevronRight /></button></div>
        </div>
      </header>

      <section className="branch-schedule__metrics" aria-label="Tổng quan lịch">
        <article><UsersRound /><div><strong>{workspace?.students.length || 0}</strong><span>Học viên</span></div></article>
        <article><Sparkles /><div><strong>{workspace?.trainers.length || 0}</strong><span>PT hoạt động</span></div></article>
        <article><Save /><div><strong>r{workspace?.draftRevision || 0}</strong><span>{dirty ? 'Chưa lưu' : 'Draft đã lưu'}</span></div></article>
        <article><CheckCircle2 /><div><strong>v{workspace?.publishedVersion || 0}</strong><span>Đã publish</span></div></article>
      </section>

      <section className="branch-schedule__toolbar">
        <button type="button" onClick={autoArrange} disabled={!workspace || loading}><Sparkles size={17} /> Xếp tự động</button>
        <button type="button" className="is-save" onClick={() => void saveDraft()} disabled={!dirty || saving}><Save size={17} /> {saving ? 'Đang lưu…' : 'Lưu draft'}</button>
        <button type="button" className="is-publish" onClick={() => void validatePublish()} disabled={!workspace || loading || publishing || dirty}><CheckCircle2 size={17} /> Kiểm tra & Publish</button>
        <button type="button" onClick={() => void openHistory()} disabled={!workspace || historyBusy}><Clock3 size={17} /> {historyBusy ? 'Đang tải…' : 'Lịch sử'}</button>
        <button type="button" aria-label="Tải lại" onClick={() => void loadWorkspace()} disabled={loading}><RefreshCw size={17} className={loading ? 'is-spinning' : ''} /></button>
      </section>

      {notice && <div className="branch-schedule__notice" role="status">{notice}</div>}
      {error && <div className="branch-schedule__error" role="alert">{error}</div>}
      {loading && !workspace ? <div className="branch-schedule__loading"><RefreshCw className="is-spinning" /> Đang tải lịch đúng phạm vi…</div> : null}

      {workspace && <section className="branch-schedule__matrix"><PTSchedule schedule={schedule} students={workspace.students} trainers={workspace.trainers} contracts={workspace.contracts} weekOffset={weekOffset} onUpdateSlot={updateSlot} selectedBranchId={branchId} scheduleConfig={workspace.scheduleConfig} /></section>}

      {publishPreview && <div className="schedule-publish-backdrop"><section className="schedule-publish-dialog" role="dialog" aria-modal="true" aria-labelledby="branch-publish-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">AURA PT · XÁC NHẬN</p><h2 id="branch-publish-title">Publish v{publishPreview.version}?</h2><p>Session hoàn thành được khóa bất biến. Mọi thay đổi còn lại sẽ được tạo, điều chỉnh hoặc hủy trong một transaction.</p><div className="schedule-publish-diff"><div><strong>{publishPreview.diff.create}</strong><span>Tạo mới</span></div><div><strong>{publishPreview.diff.update}</strong><span>Điều chỉnh</span></div><div><strong>{publishPreview.diff.cancel}</strong><span>Hủy</span></div><div><strong>{publishPreview.diff.unchanged}</strong><span>Giữ nguyên</span></div></div><div className="schedule-publish-dialog__actions"><button type="button" onClick={() => setPublishPreview(null)}>Quay lại</button><button type="button" onClick={() => void confirmPublish()} disabled={publishing}>{publishing ? 'Đang publish…' : `Publish v${publishPreview.version}`}</button></div></section></div>}

      {history && <div className="schedule-publish-backdrop"><section className="schedule-publish-dialog schedule-version-dialog" role="dialog" aria-modal="true" aria-labelledby="branch-history-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">LỊCH SỬ BẤT BIẾN</p><h2 id="branch-history-title">Phiên bản đã publish</h2><p>Khôi phục chỉ sao chép thành draft mới, không sửa lịch sử hoặc session hiện hành.</p>{history.versions.length ? <div className="schedule-version-list">{history.versions.map((version) => <article key={version.version} className={version.version === history.currentVersion ? 'is-current' : ''}><div><strong>Phiên bản v{version.version}</strong><span>{version.entryCount} buổi · draft r{version.sourceDraftRevision}</span><small>{formatPublishedAt(version.publishedAt)}</small></div><button type="button" onClick={() => setRestoreCandidate(version)}><RotateCcw size={16} /> Khôi phục draft</button></article>)}</div> : <div className="schedule-version-empty">Chưa có phiên bản publish.</div>}<div className="schedule-publish-dialog__actions schedule-version-dialog__actions"><button type="button" onClick={() => setHistory(null)}>Đóng</button></div></section></div>}

      {restoreCandidate && history && <div className="schedule-publish-backdrop schedule-restore-confirm"><section className="schedule-publish-dialog" role="alertdialog" aria-modal="true" aria-labelledby="branch-restore-title"><div className="schedule-publish-dialog__accent" /><p className="schedule-publish-dialog__eyebrow">KHÔI PHỤC AN TOÀN</p><h2 id="branch-restore-title">Tạo draft từ v{restoreCandidate.version}?</h2><p>Draft hiện tại của chi nhánh sẽ được thay thế. Bạn phải kiểm tra và publish lại trước khi lịch tập thay đổi.</p><div className="schedule-publish-dialog__actions"><button type="button" onClick={() => setRestoreCandidate(null)}>Quay lại</button><button type="button" onClick={() => void restoreVersion()} disabled={publishing}>{publishing ? 'Đang khôi phục…' : 'Tạo draft mới'}</button></div></section></div>}
    </div>
  )
}
