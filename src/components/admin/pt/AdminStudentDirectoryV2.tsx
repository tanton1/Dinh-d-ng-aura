import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowRight, Check, Edit2, LoaderCircle, Plus, RefreshCw, Search, Trash2, UserRoundX, Users, X } from 'lucide-react'
import { listStudent360Directory } from '../../../features/student-360/student360Service'
import type { Student360DirectoryItem } from '../../../features/student-360/types'
import { trackProductEvent } from '../../../services/analyticsService'
import { provisionStudentAccount } from '../../../services/identityAccessService'
import { createStudentCommandKey, hardDeleteStudent, isHardDeleteConfirmation, updateStudentProfile } from '../../../services/studentManagementService'
import { listPtScheduleBranches } from '../../../services/ptSchedulePublishService'
import './AdminStudentDirectoryV2.css'

interface Props {
  initialSearchQuery?: string
  initialStudentId?: string | null
  onOpenStudent360: (studentId: string, studentName: string) => void
  canManage?: boolean
  canInvite?: boolean
  defaultBranchId?: string
  canHardDelete?: boolean
}

type AttentionFilter = 'all' | 'stable' | 'attention' | 'action_required'
type FormMode = 'create' | 'edit'
type ProfileForm = {
  studentId: string
  revision: number
  name: string
  phone: string
  email: string
  dob: string
  sessionsPerWeek: number
  branchId: string
  status: 'active' | 'inactive'
}

function emptyProfileForm(branchId = ''): ProfileForm {
  return { studentId: '', revision: 0, name: '', phone: '', email: '', dob: '', sessionsPerWeek: 3, branchId, status: 'active' }
}

function statusLabel(status: Student360DirectoryItem['status']) {
  if (status === 'frozen') return 'Bảo lưu'
  if (status === 'expired') return 'Hết hạn'
  if (status === 'inactive') return 'Ngừng hoạt động'
  return 'Đang tập'
}

function dateLabel(value?: string | null) {
  if (!value) return 'Chưa có lịch'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

/** Cursor-first directory with scoped profile commands and no legacy listeners. */
export default function AdminStudentDirectoryV2({
  initialSearchQuery = '',
  initialStudentId = null,
  onOpenStudent360,
  canManage = false,
  canInvite = false,
  defaultBranchId = '',
  canHardDelete = false,
}: Props) {
  const [query, setQuery] = useState(initialSearchQuery.trim())
  const [attention, setAttention] = useState<AttentionFilter>('all')
  const [rows, setRows] = useState<Student360DirectoryItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [scanned, setScanned] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [branches, setBranches] = useState<Array<{ id: string; name: string; status?: string }>>([])
  const [formMode, setFormMode] = useState<FormMode | null>(null)
  const [form, setForm] = useState<ProfileForm>(() => emptyProfileForm(defaultBranchId))
  const [formError, setFormError] = useState('')
  const [savingForm, setSavingForm] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<Student360DirectoryItem | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Student360DirectoryItem | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const requestIdRef = useRef(0)
  const startedAtRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now())
  const readyReportedRef = useRef(false)
  const initialStudentHandledRef = useRef<string | null>(null)
  const branchesLoadedRef = useRef(false)

  useEffect(() => {
    if (!initialStudentId || initialStudentHandledRef.current === initialStudentId) return
    initialStudentHandledRef.current = initialStudentId
    onOpenStudent360(initialStudentId, '')
  }, [initialStudentId, onOpenStudent360])

  const attentionParam = attention === 'all' ? undefined : attention
  const load = async (append = false) => {
    const requestId = ++requestIdRef.current
    if (append) setLoadingMore(true)
    else {
      setLoading(true)
      setScanned(0)
      setTruncated(false)
    }
    setError('')
    try {
      const result = await listStudent360Directory({ query: query.trim() || undefined, attention: attentionParam, cursor: append ? cursor : null, pageSize: 30 })
      if (requestId !== requestIdRef.current) return
      setRows((current) => append ? [...current, ...result.rows] : result.rows)
      setCursor(result.nextCursor)
      setHasMore(result.hasMore)
      setScanned((current) => append ? current + result.scanned : result.scanned)
      setTruncated((current) => append ? current || result.truncated : result.truncated)
      if (!append && !readyReportedRef.current) {
        readyReportedRef.current = true
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
        void trackProductEvent('data_ready', { surface: 'admin_pt_students_directory_v2', durationMs: Math.max(0, Math.round(now - startedAtRef.current)), scanned: result.scanned, truncated: result.truncated, uiVersion: 5 })
      }
    } catch (cause) {
      if (requestId === requestIdRef.current) setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách học viên.')
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }

  const reload = () => {
    setCursor(null)
    setHasMore(false)
    void load(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCursor(null)
      setHasMore(false)
      void load(false)
    }, query.trim() ? 240 : 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attention, query])

  const counts = useMemo(() => ({ total: rows.length, attention: rows.filter((row) => row.health.status !== 'stable').length, alerts: rows.reduce((total, row) => total + row.alertCount, 0) }), [rows])
  const closeDelete = (force = false) => {
    if (deleting && !force) return
    setDeleteTarget(null)
    setDeleteConfirmation('')
    setDeleteError('')
  }
  const loadBranches = () => {
    if ((!canManage && !canInvite) || branchesLoadedRef.current) return
    branchesLoadedRef.current = true
    void listPtScheduleBranches().then((result) => {
      const nextBranches = result.branches.filter((item) => item.status !== 'archived')
      setBranches(nextBranches)
      setForm((current) => current.branchId || !nextBranches[0] ? current : { ...current, branchId: nextBranches[0].id })
    }).catch(() => {
      branchesLoadedRef.current = false
    })
  }
  const openCreate = () => {
    loadBranches()
    setFormMode('create')
    setForm(emptyProfileForm(defaultBranchId || branches[0]?.id || ''))
    setFormError('')
  }
  const openEdit = (row: Student360DirectoryItem) => {
    loadBranches()
    setFormMode('edit')
    setForm({ studentId: row.studentId, revision: Number(row.revision || 0), name: row.name || '', phone: row.phone || '', email: row.email || '', dob: row.dob || '', sessionsPerWeek: Math.max(1, Math.min(14, Number(row.sessionsPerWeek || 3))), branchId: row.branchId || '', status: row.status === 'inactive' ? 'inactive' : 'active' })
    setFormError('')
  }
  const closeForm = (force = false) => {
    if (savingForm && !force) return
    setFormMode(null)
    setFormError('')
  }
  const saveForm = async () => {
    if (!formMode) return
    if (!form.name.trim()) return setFormError('Cần nhập họ tên học viên.')
    if (formMode === 'create' && !form.phone.trim()) return setFormError('Cần số điện thoại để tạo tài khoản học viên.')
    setSavingForm(true)
    setFormError('')
    try {
      if (formMode === 'create') {
        const studentId = `student_${globalThis.crypto.randomUUID()}`
        const result = await provisionStudentAccount({
          displayName: form.name.trim(), phoneNumber: form.phone.trim(), email: form.email.trim() || undefined, crmProfileId: studentId,
          legacyStudent: { dob: form.dob || undefined, sessionsPerWeek: form.sessionsPerWeek, availableSlots: [], status: 'active', joinDate: new Date().toISOString().slice(0, 10), branchId: form.branchId || undefined },
        })
        setNotice(result.reusedDeletedProfile ? `Đã khôi phục liên kết cho ${form.name.trim()}.` : `Đã tạo hồ sơ Aura cho ${form.name.trim()}.`)
      } else {
        await updateStudentProfile({ studentId: form.studentId, expectedRevision: form.revision, idempotencyKey: createStudentCommandKey(), updates: { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(), dob: form.dob || '', sessionsPerWeek: form.sessionsPerWeek, status: form.status, branchId: form.branchId } })
        setNotice(`Đã cập nhật hồ sơ ${form.name.trim()}.`)
      }
      closeForm(true)
      reload()
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Chưa thể lưu hồ sơ học viên.')
    } finally {
      setSavingForm(false)
    }
  }
  const confirmArchive = async () => {
    if (!archiveTarget) return
    setArchiving(true)
    setError('')
    try {
      await updateStudentProfile({ studentId: archiveTarget.studentId, expectedRevision: Number(archiveTarget.revision || 0), idempotencyKey: createStudentCommandKey(), updates: { status: 'inactive' } })
      setRows((current) => current.filter((row) => row.studentId !== archiveTarget.studentId))
      setNotice(`Đã lưu trữ hồ sơ ${archiveTarget.name}. Dữ liệu hợp đồng, lịch sử và tài chính được giữ nguyên.`)
      setArchiveTarget(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể lưu trữ hồ sơ học viên.')
    } finally {
      setArchiving(false)
    }
  }
  const confirmHardDelete = async () => {
    if (!deleteTarget || !isHardDeleteConfirmation(deleteConfirmation)) return
    setDeleting(true)
    setDeleteError('')
    try {
      const result = await hardDeleteStudent(deleteTarget.studentId, deleteConfirmation.trim())
      setRows((current) => current.filter((row) => row.studentId !== deleteTarget.studentId))
      setNotice(result.preservedSessionCount ? `Đã xóa hồ sơ ${deleteTarget.name}. Giữ lại ${result.preservedSessionCount} buổi tập và bằng chứng tính lương.` : `Đã xóa cứng hồ sơ ${deleteTarget.name}. Dữ liệu lương/audit được giữ theo chính sách.`)
      closeDelete(true)
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Không thể xóa hồ sơ học viên.')
    } finally {
      setDeleting(false)
    }
  }

  return <section className="admin-student-directory-v2 aura-ui-v4-surface aura-ui-v4-operations" aria-busy={loading}>
    <header className="admin-student-directory-v2__header"><div><span className="admin-student-directory-v2__eyebrow">AURA OPERATIONS · DIRECTORY V2</span><h1>Học viên PT</h1><p>Danh sách cursor-first; hồ sơ cũ được tìm khi nhập từ khóa.</p></div><div className="admin-student-directory-v2__header-actions">{canInvite && <button type="button" className="admin-student-directory-v2__create" onClick={openCreate}><Plus size={16} /> Thêm học viên</button>}<button type="button" className="admin-student-directory-v2__refresh" onClick={reload} disabled={loading}><RefreshCw size={16} className={loading ? 'is-spinning' : ''} /> Làm mới</button></div></header>
    {notice && <div className="admin-student-directory-v2__notice" role="status"><span>{notice}</span><button type="button" aria-label="Đóng thông báo" onClick={() => setNotice('')}><X size={16} /></button></div>}
    <div className="admin-student-directory-v2__toolbar"><label className="admin-student-directory-v2__search"><Search size={17} /><span className="sr-only">Tìm học viên</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên hoặc số điện thoại" /></label><label className="admin-student-directory-v2__filter"><span>Tình trạng</span><select value={attention} onChange={(event) => setAttention(event.target.value as AttentionFilter)}><option value="all">Tất cả</option><option value="stable">Ổn định</option><option value="attention">Cần chú ý</option><option value="action_required">Cần xử lý</option></select></label><div className="admin-student-directory-v2__summary"><span><strong>{counts.total}</strong> đang hiển thị</span><span><strong>{counts.attention}</strong> cần chú ý</span><span><strong>{counts.alerts}</strong> cảnh báo</span></div></div>
    {truncated && <div className="admin-student-directory-v2__warning" role="status"><AlertCircle size={17} /><span>Nguồn dữ liệu đã chạm giới hạn quét an toàn ({scanned.toLocaleString('vi-VN')} hồ sơ đã quét). Hãy dùng từ khóa hoặc bộ lọc để thu hẹp phạm vi.</span></div>}
    {error && <div className="admin-student-directory-v2__error" role="alert"><AlertCircle size={17} />{error}<button type="button" onClick={reload}>Thử lại</button></div>}
    {loading && !rows.length ? <div className="admin-student-directory-v2__state"><LoaderCircle className="is-spinning" /><span>Đang tải danh sách phân trang…</span></div> : rows.length ? <div className="admin-student-directory-v2__table-wrap"><table><thead><tr><th>Học viên</th><th>Chi nhánh</th><th>Hợp đồng</th><th>Lịch sắp tới</th><th>Cảnh báo</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.studentId}><td><button type="button" className="admin-student-directory-v2__identity" onClick={() => onOpenStudent360(row.studentId, row.name)}><span className="admin-student-directory-v2__avatar">{row.name.trim().charAt(0).toUpperCase() || '?'}</span><span><strong>{row.name}</strong><small>{row.phone || 'Chưa có SĐT'}</small></span></button></td><td><strong>{row.branchName || 'Chưa xác định'}</strong><small>{statusLabel(row.status)}</small></td><td><strong>{row.remainingSessions === null ? '—' : `${row.remainingSessions} buổi`}</strong><small>{row.daysRemaining === null ? 'Chưa có hạn' : `Còn ${Math.max(0, row.daysRemaining)} ngày`}</small></td><td><strong>{dateLabel(row.nextSession?.date)}</strong><small>{row.nextSession ? `${String(row.nextSession.hour ?? '').padStart(2, '0')}:00 · ${row.nextSession.trainerName}` : 'Chưa xếp'}</small></td><td><span className={`admin-student-directory-v2__health is-${row.health.status}`}>{row.health.status === 'stable' ? 'Ổn định' : row.health.status === 'attention' ? 'Cần chú ý' : 'Cần xử lý'}</span><small>{row.alertCount ? `${row.alertCount} mục cần xem` : 'Không có cảnh báo'}</small></td><td className="admin-student-directory-v2__actions"><button type="button" className="admin-student-directory-v2__open" onClick={() => onOpenStudent360(row.studentId, row.name)}>Mở 360 <ArrowRight size={15} /></button>{canManage && row.status !== 'inactive' && <><button type="button" className="admin-student-directory-v2__edit" onClick={() => openEdit(row)}><Edit2 size={14} /> Sửa</button><button type="button" className="admin-student-directory-v2__archive" onClick={() => setArchiveTarget(row)}><UserRoundX size={14} /> Lưu trữ</button></>}{canHardDelete && <button type="button" className="admin-student-directory-v2__delete" disabled={row.status !== 'inactive'} title={row.status === 'inactive' ? 'Xóa cứng hồ sơ' : 'Chỉ xóa cứng hồ sơ đã ngừng hoạt động'} onClick={() => { setDeleteTarget(row); setDeleteConfirmation(''); setDeleteError('') }}><Trash2 size={14} /> Xóa cứng</button>}</td></tr>)}</tbody></table></div> : <div className="admin-student-directory-v2__state"><Users /><strong>Chưa có học viên phù hợp</strong><span>Thử đổi từ khóa hoặc bộ lọc.</span></div>}
    {hasMore && <div className="admin-student-directory-v2__more"><button type="button" onClick={() => void load(true)} disabled={loadingMore}>{loadingMore ? <><LoaderCircle className="is-spinning" /> Đang tải…</> : 'Tải thêm học viên'}</button></div>}
    {formMode && <div className="admin-student-directory-v2__modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm() }}><div className="admin-student-directory-v2__modal" role="dialog" aria-modal="true" aria-labelledby="student-profile-form-title"><header><div><span className="admin-student-directory-v2__eyebrow">{formMode === 'create' ? 'HỒ SƠ HỌC VIÊN' : 'CẬP NHẬT HỒ SƠ'}</span><h2 id="student-profile-form-title">{formMode === 'create' ? 'Thêm học viên' : `Sửa ${form.name}`}</h2></div><button type="button" className="admin-student-directory-v2__modal-close" onClick={() => closeForm()} aria-label="Đóng"><X size={18} /></button></header><div className="admin-student-directory-v2__form-grid"><label>Họ tên<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} autoFocus maxLength={160} /></label><label>Số điện thoại<input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} inputMode="tel" maxLength={30} /></label><label>Email<input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} type="email" maxLength={160} /></label><label>Ngày sinh<input value={form.dob} onChange={(event) => setForm((current) => ({ ...current, dob: event.target.value }))} type="date" /></label><label>Số buổi/tuần<input value={form.sessionsPerWeek} onChange={(event) => setForm((current) => ({ ...current, sessionsPerWeek: Math.max(1, Math.min(14, Number(event.target.value) || 1)) }))} type="number" min={1} max={14} /></label><label>Chi nhánh<select value={form.branchId} onChange={(event) => setForm((current) => ({ ...current, branchId: event.target.value }))}><option value="">Chưa xác định</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>{formMode === 'edit' && <label>Trạng thái<select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as ProfileForm['status'] }))}><option value="active">Đang hoạt động</option><option value="inactive">Ngừng hoạt động</option></select></label>}</div>{formError && <div className="admin-student-directory-v2__modal-error" role="alert"><AlertCircle size={16} />{formError}</div>}<footer><button type="button" className="admin-student-directory-v2__modal-cancel" onClick={() => closeForm()} disabled={savingForm}>Hủy</button><button type="button" className="admin-student-directory-v2__modal-submit" onClick={() => void saveForm()} disabled={savingForm || !form.name.trim() || (formMode === 'create' && !form.phone.trim())}>{savingForm ? <><LoaderCircle className="is-spinning" size={16} /> Đang lưu…</> : <><Check size={16} /> Lưu hồ sơ</>}</button></footer></div></div>}
    {archiveTarget && <div className="admin-student-directory-v2__modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !archiving) setArchiveTarget(null) }}><div className="admin-student-directory-v2__modal" role="alertdialog" aria-modal="true" aria-labelledby="archive-student-title"><header><div><span className="admin-student-directory-v2__eyebrow">LƯU TRỮ HỒ SƠ</span><h2 id="archive-student-title">Lưu trữ {archiveTarget.name}?</h2></div><button type="button" className="admin-student-directory-v2__modal-close" onClick={() => setArchiveTarget(null)} disabled={archiving} aria-label="Đóng"><X size={18} /></button></header><p>Hồ sơ sẽ ngừng xuất hiện trong danh sách đang vận hành. Hợp đồng, lịch sử buổi tập, điểm danh và dữ liệu tài chính vẫn được giữ nguyên.</p>{error && <div className="admin-student-directory-v2__modal-error" role="alert"><AlertCircle size={16} />{error}</div>}<footer><button type="button" className="admin-student-directory-v2__modal-cancel" onClick={() => setArchiveTarget(null)} disabled={archiving}>Hủy</button><button type="button" className="admin-student-directory-v2__modal-submit" onClick={() => void confirmArchive()} disabled={archiving}>{archiving ? <><LoaderCircle className="is-spinning" size={16} /> Đang lưu trữ…</> : <><UserRoundX size={16} /> Lưu trữ</>}</button></footer></div></div>}
    {deleteTarget && <div className="admin-student-directory-v2__modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDelete() }}><div className="admin-student-directory-v2__modal" role="alertdialog" aria-modal="true" aria-labelledby="hard-delete-student-title"><header><div><span className="admin-student-directory-v2__eyebrow">XÓA DỮ LIỆU VĨNH VIỄN</span><h2 id="hard-delete-student-title">Xóa {deleteTarget.name}?</h2></div><button type="button" className="admin-student-directory-v2__modal-close" onClick={() => closeDelete()} aria-label="Đóng"><X size={18} /></button></header><p>Hồ sơ học viên, quyền truy cập và dữ liệu vận hành phụ sẽ bị xóa. Các buổi tập, điểm danh và bằng chứng tính lương vẫn được giữ lại để đối soát.</p><label>Nhập <strong>XÓA VĨNH VIỄN</strong> hoặc <strong>XOÁ VĨNH VIỄN</strong> để xác nhận<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoFocus autoComplete="off" aria-label="Nhập xác nhận xóa vĩnh viễn" placeholder="XÓA VĨNH VIỄN" /></label>{deleteError && <div className="admin-student-directory-v2__modal-error" role="alert"><AlertCircle size={16} />{deleteError}</div>}<footer><button type="button" className="admin-student-directory-v2__modal-cancel" onClick={() => closeDelete()} disabled={deleting}>Hủy</button><button type="button" className="admin-student-directory-v2__modal-submit" onClick={() => void confirmHardDelete()} disabled={deleting || !isHardDeleteConfirmation(deleteConfirmation)}>{deleting ? <><LoaderCircle className="is-spinning" size={16} /> Đang xóa…</> : <><Trash2 size={16} /> Xóa cứng</>}</button></footer></div></div>}
  </section>
}
