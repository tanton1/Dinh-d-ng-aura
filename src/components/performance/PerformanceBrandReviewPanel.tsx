import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle2, ClipboardCheck, ExternalLink, FileCheck2, Image, LoaderCircle, Megaphone, RefreshCw, ShieldCheck, UserRoundCheck, XCircle } from 'lucide-react'
import {
  listPerformanceReviewQueue,
  PERFORMANCE_PROFILE_KEYS,
  reviewPerformanceBrandEvidence,
  savePerformanceProfileChecklist,
  type BrandPerformanceEvidence,
  type PerformanceEvidenceStatus,
  type PerformanceProfileKey,
  type PerformanceStaffDirectoryItem,
} from '../../services/performanceScoreService'
import PerformanceScorecardReviewPanel from './PerformanceScorecardReviewPanel'
import './PerformanceBrandReviewPanel.css'

const PROFILE_LABELS: Record<PerformanceProfileKey, string> = {
  photo: 'Ảnh đại diện', bio: 'Bio rõ định vị', certifications: 'Chứng chỉ', expertise: 'Chuyên môn', case_studies: 'Case học viên',
  reviews: 'Review học viên', intro_video: 'Video giới thiệu', social_links: 'Liên kết mạng xã hội', schedule: 'Lịch làm việc', contact: 'Thông tin liên hệ',
}
const STATUS_LABELS: Record<PerformanceEvidenceStatus, string> = {
  submitted: 'Chờ duyệt', needs_revision: 'Cần bổ sung', approved: 'Đã duyệt', rejected: 'Từ chối', withdrawn: 'Đã rút',
}
const VIOLATIONS = [
  { id: 'copyright', label: 'Bản quyền' },
  { id: 'missing_consent', label: 'Thiếu consent hình ảnh khách' },
  { id: 'medical_claim', label: 'Tuyên bố y khoa / quảng cáo sai lệch' },
  { id: 'off_brand', label: 'Sai định vị Aura' },
] as const

function currentPeriod() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function dateLabel(value: string) {
  if (!value) return '—'
  const date = new Date(value.length === 10 ? `${value}T00:00:00+07:00` : value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: value.length > 10 ? 'short' : undefined })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Chưa thể xử lý hàng chờ Performance Score.'
}

function emptyChecklist(): Record<PerformanceProfileKey, boolean> {
  return Object.fromEntries(PERFORMANCE_PROFILE_KEYS.map((key) => [key, false])) as Record<PerformanceProfileKey, boolean>
}

export default function PerformanceBrandReviewPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [workspace, setWorkspace] = useState<'scorecard' | 'evidence' | 'profile'>('scorecard')
  const [periodId, setPeriodId] = useState(currentPeriod)
  const [status, setStatus] = useState<PerformanceEvidenceStatus | ''>('submitted')
  const [type, setType] = useState<'personal_content' | 'aura_assignment' | ''>('')
  const [rows, setRows] = useState<BrandPerformanceEvidence[]>([])
  const [staff, setStaff] = useState<PerformanceStaffDirectoryItem[]>([])
  const [profiles, setProfiles] = useState<BrandPerformanceEvidence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<BrandPerformanceEvidence | null>(null)
  const [reason, setReason] = useState('')
  const [violations, setViolations] = useState<string[]>([])
  const [working, setWorking] = useState('')
  const [profileStaffId, setProfileStaffId] = useState('')
  const [checklist, setChecklist] = useState<Record<PerformanceProfileKey, boolean>>(emptyChecklist)
  const [profileReason, setProfileReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      if (isDemo) {
        setRows([]); setProfiles([]); setStaff([])
      } else {
        const result = await listPerformanceReviewQueue({ periodId, status, type })
        setRows(result.rows); setProfiles(result.profiles); setStaff(result.staff)
        setSelected((current) => current ? result.rows.find((item) => item.id === current.id) || null : null)
      }
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setLoading(false) }
  }, [isDemo, periodId, status, type])

  useEffect(() => { void load() }, [load])
  const summary = useMemo(() => ({
    submitted: rows.filter((item) => item.status === 'submitted').length,
    approved: rows.filter((item) => item.status === 'approved').length,
    personal: rows.filter((item) => item.type === 'personal_content').length,
    aura: rows.filter((item) => item.type === 'aura_assignment').length,
  }), [rows])

  const open = (item: BrandPerformanceEvidence) => {
    setSelected(item); setReason(item.reviewReason || ''); setViolations(item.violationCodes || []); setNotice('')
  }

  const review = async (decision: 'approved' | 'needs_revision' | 'rejected') => {
    if (!selected) return
    if (decision !== 'approved' && reason.trim().length < 3) { setNotice('Cần ghi rõ lý do yêu cầu bổ sung hoặc từ chối.'); return }
    setWorking(decision); setNotice('')
    try {
      await reviewPerformanceBrandEvidence({ evidenceId: selected.id, decision, reason: reason.trim(), violationCodes: violations })
      setNotice(decision === 'approved' ? 'Đã duyệt và cộng điểm Brand.' : decision === 'needs_revision' ? 'Đã gửi yêu cầu bổ sung cho nhân sự.' : 'Đã từ chối bằng chứng.'); setSelected(null); await load()
    } catch (cause) { setNotice(errorMessage(cause)) }
    finally { setWorking('') }
  }

  const chooseProfileStaff = (staffId: string) => {
    setProfileStaffId(staffId)
    const existing = profiles.find((item) => item.staffId === staffId)
    setChecklist(existing ? { ...emptyChecklist(), ...existing.checklist } : emptyChecklist())
    setProfileReason(existing?.reviewReason || '')
  }

  const saveProfile = async () => {
    if (!profileStaffId) { setNotice('Chọn PT cần đánh giá Profile Quality.'); return }
    setWorking('profile'); setNotice('')
    try {
      await savePerformanceProfileChecklist({ periodId, staffId: profileStaffId, checklist, reason: profileReason.trim() })
      setNotice('Đã lưu Profile Quality. Mỗi mục đạt cộng 0,2 điểm, tối đa 2 điểm.'); await load()
    } catch (cause) { setNotice(errorMessage(cause)) }
    finally { setWorking('') }
  }

  const profileCompleted = PERFORMANCE_PROFILE_KEYS.filter((key) => checklist[key]).length

  return <section className="performance-review" aria-label="Duyệt Thương hiệu cá nhân và Aura Brand">
    <div className="performance-review__commandbar">
      <nav className="performance-review__workspaces" role="tablist" aria-label="Khu vực Performance PT">
        <button type="button" role="tab" aria-selected={workspace === 'scorecard'} className={workspace === 'scorecard' ? 'is-active' : ''} onClick={() => setWorkspace('scorecard')}><ClipboardCheck /><span>Phiếu 100 điểm</span></button>
        <button type="button" role="tab" aria-selected={workspace === 'evidence'} className={workspace === 'evidence' ? 'is-active' : ''} onClick={() => setWorkspace('evidence')}><FileCheck2 /><span>Duyệt bằng chứng</span>{summary.submitted > 0 && <b>{summary.submitted}</b>}</button>
        <button type="button" role="tab" aria-selected={workspace === 'profile'} className={workspace === 'profile' ? 'is-active' : ''} onClick={() => setWorkspace('profile')}><UserRoundCheck /><span>Hồ sơ PT</span></button>
      </nav>
      <div className="performance-review__period">
        <label><span>Kỳ đánh giá</span><input type="month" value={periodId} onChange={(event) => setPeriodId(event.target.value)} /></label>
        <button type="button" onClick={() => void load()} aria-label="Tải lại dữ liệu"><RefreshCw /></button>
      </div>
    </div>

    {error && <div className="performance-review__state is-error"><AlertTriangle /> {error}</div>}
    {notice && <div className="performance-review__state"><CheckCircle2 /> {notice}</div>}
    {loading && <div className="performance-review__state"><LoaderCircle className="spin" /> Đang tải dữ liệu kỳ đánh giá…</div>}

    {!loading && workspace === 'scorecard' && <PerformanceScorecardReviewPanel periodId={periodId} staff={staff} isDemo={isDemo} />}

    {!loading && workspace === 'evidence' && <div className="performance-review__evidence-workspace" role="tabpanel">
      <header className="performance-review__section-heading">
        <div><h2>Duyệt bằng chứng Brand</h2><p>Kiểm tra nội dung đã đăng trước khi cộng tối đa 10 điểm thương hiệu.</p></div>
        <span>Brand · 10/100 điểm</span>
      </header>
      <div className="performance-review__toolbar">
        <label><span>Loại nội dung</span><select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="">Tất cả Brand</option><option value="personal_content">Thương hiệu cá nhân</option><option value="aura_assignment">Aura Brand</option></select></label>
        <label><span>Trạng thái</span><select value={status} onChange={(event) => setStatus(event.target.value as PerformanceEvidenceStatus | '')}><option value="">Mọi trạng thái</option><option value="submitted">Chờ duyệt</option><option value="needs_revision">Cần bổ sung</option><option value="approved">Đã duyệt</option><option value="rejected">Từ chối</option></select></label>
      </div>
      <dl className="performance-review__metrics" aria-label="Tổng hợp hàng chờ bằng chứng">
        <div><dt>Trong bộ lọc</dt><dd>{rows.length}<span>hồ sơ</span></dd></div>
        <div><dt>Thương hiệu cá nhân</dt><dd>{summary.personal}<span>/ 5 điểm</span></dd></div>
        <div><dt>Aura Brand</dt><dd>{summary.aura}<span>/ 3 điểm</span></dd></div>
        <div><dt>Đã duyệt</dt><dd>{summary.approved}<span>hồ sơ</span></dd></div>
      </dl>
      <div className="performance-review__layout">
        <div className="performance-review__queue">
          <header><div><strong>Hàng chờ bằng chứng</strong><small>Ưu tiên hồ sơ đang chờ duyệt</small></div><span>{rows.length} hồ sơ</span></header>
          {rows.filter((item) => item.type !== 'profile_checklist').map((item) => <button type="button" className={selected?.id === item.id ? 'is-selected' : ''} key={item.id} onClick={() => open(item)}>
            <span className={`performance-review__kind is-${item.type}`}>{item.type === 'aura_assignment' ? <Megaphone /> : <Image />}</span>
            <span><small>{item.staffName} · {dateLabel(item.postedAt)}</small><strong>{item.title}</strong><em>{item.groupName || item.platform || 'Bài đăng / nhiệm vụ Brand'}</em></span>
            <b className={`is-${item.status}`}>{STATUS_LABELS[item.status]}</b>
          </button>)}
          {!rows.some((item) => item.type !== 'profile_checklist') && <div className="performance-review__empty"><CheckCircle2 /><strong>Hàng chờ đang trống</strong><span>{status || type ? 'Không có hồ sơ phù hợp. Mở mọi trạng thái để kiểm tra lại.' : 'Bằng chứng mới sẽ xuất hiện tại đây ngay sau khi PT gửi.'}</span>{(status || type) && <button type="button" onClick={() => { setStatus(''); setType('') }}>Xem mọi trạng thái</button>}</div>}
        </div>
        <aside className={`performance-review__detail${selected ? '' : ' is-empty'}`}>
          {selected ? <>
            <header><small>{selected.type === 'aura_assignment' ? 'Aura Brand' : 'Thương hiệu cá nhân'}</small><h3>{selected.title}</h3><p>{selected.staffName} · {dateLabel(selected.postedAt)}</p></header>
            <dl><div><dt>Nền tảng</dt><dd>{selected.platform || '—'}</dd></div><div><dt>Trang / hội nhóm</dt><dd>{selected.groupName || '—'}</dd></div>{selected.briefId && <div><dt>Brief</dt><dd>{selected.briefId}</dd></div>}<div><dt>Gửi lúc</dt><dd>{dateLabel(selected.submittedAt)}</dd></div></dl>
            {selected.note && <p className="performance-review__note">{selected.note}</p>}
            <div className="performance-review__proof">{selected.url && <a href={selected.url} target="_blank" rel="noreferrer"><ExternalLink /> Mở bài đăng</a>}{selected.signedUrl && <a href={selected.signedUrl} target="_blank" rel="noreferrer"><Camera /> Xem ảnh chụp</a>}</div>
            <div className="performance-review__criteria"><strong>Kiểm tra vi phạm</strong>{VIOLATIONS.map((item) => <label key={item.id}><input type="checkbox" checked={violations.includes(item.id)} onChange={(event) => setViolations((current) => event.target.checked ? [...current, item.id] : current.filter((value) => value !== item.id))} /><span>{item.label}</span></label>)}</div>
            <label className="performance-review__reason"><span>Ghi chú duyệt</span><textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Nêu rõ phần cần bổ sung hoặc lý do từ chối…" /></label>
            <footer><button type="button" disabled={Boolean(working)} onClick={() => void review('rejected')}><XCircle /> Từ chối</button><button type="button" disabled={Boolean(working)} onClick={() => void review('needs_revision')}><AlertTriangle /> Yêu cầu bổ sung</button><button type="button" className="is-approve" disabled={Boolean(working) || violations.length > 0} onClick={() => void review('approved')}><CheckCircle2 /> Duyệt</button></footer>
          </> : <div className="performance-review__placeholder"><ShieldCheck /><strong>Chọn hồ sơ trong hàng chờ</strong><p>Thông tin bài đăng, ảnh chụp và tiêu chí duyệt sẽ mở tại đây.</p></div>}
        </aside>
      </div>
    </div>}

    {!loading && workspace === 'profile' && <section className="performance-review__profile" role="tabpanel">
      <header><div><h2>Chất lượng hồ sơ PT</h2><p>Chọn PT và xác nhận 10 tiêu chí có thể kiểm chứng. Mỗi tiêu chí đạt cộng 0,2 điểm.</p></div><span><strong>{profileCompleted}</strong>/10 mục</span></header>
      <label className="performance-review__profile-staff"><span>Chọn PT</span><select value={profileStaffId} onChange={(event) => chooseProfileStaff(event.target.value)}><option value="">Chọn nhân sự</option>{staff.map((item) => <option value={item.staffId} key={item.staffId}>{item.name}</option>)}</select></label>
      <div className="performance-review__checklist">{PERFORMANCE_PROFILE_KEYS.map((key) => <label key={key}><input type="checkbox" disabled={!profileStaffId} checked={checklist[key]} onChange={(event) => setChecklist((current) => ({ ...current, [key]: event.target.checked }))} /><span>{PROFILE_LABELS[key]}</span><b>{checklist[key] ? '+0,2' : '0'}</b></label>)}</div>
      <label className="performance-review__profile-note"><span>Ghi chú</span><input value={profileReason} maxLength={500} onChange={(event) => setProfileReason(event.target.value)} placeholder="Điểm cần hoàn thiện trên hồ sơ cá nhân…" /></label>
      <footer><strong>{(profileCompleted * 0.2).toFixed(1).replace('.', ',')}/2 điểm</strong><button type="button" disabled={!profileStaffId || Boolean(working)} onClick={() => void saveProfile()}>{working === 'profile' ? <LoaderCircle className="spin" /> : <CheckCircle2 />} Lưu đánh giá hồ sơ</button></footer>
    </section>}
  </section>
}
