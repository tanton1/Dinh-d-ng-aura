import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Award, Camera, CheckCircle2, ExternalLink, Image, LoaderCircle, Megaphone, Plus, RotateCcw, Send, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import {
  getMyPerformanceScore,
  listMyPerformanceEvidence,
  submitPerformanceBrandEvidence,
  withdrawPerformanceBrandEvidence,
  type BrandPerformanceEvidence,
  type MyPerformanceScore,
  type PerformanceEvidencePlatform,
} from '../../services/performanceScoreService'
import './StaffPerformanceBrandPanel.css'

const STATUS_COPY = {
  submitted: { label: 'Chờ duyệt', tone: 'pending' },
  needs_revision: { label: 'Cần bổ sung', tone: 'revision' },
  approved: { label: 'Đã duyệt', tone: 'approved' },
  rejected: { label: 'Từ chối', tone: 'rejected' },
  withdrawn: { label: 'Đã rút', tone: 'muted' },
} as const

function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function dateLabel(value: string) {
  if (!value) return 'Chưa cập nhật'
  const date = new Date(value.length === 10 ? `${value}T00:00:00+07:00` : value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN')
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Chưa thể xử lý bằng chứng hiệu suất.'
}

function BrandEvidenceRow({ item, onWithdraw }: { item: BrandPerformanceEvidence; onWithdraw: (id: string) => Promise<void> }) {
  const [working, setWorking] = useState(false)
  const status = STATUS_COPY[item.status]
  const withdraw = async () => {
    setWorking(true)
    try { await onWithdraw(item.id) } finally { setWorking(false) }
  }
  return <article className="performance-brand__evidence-row">
    <span className={`performance-brand__evidence-icon is-${item.type}`}>
      {item.type === 'aura_assignment' ? <Megaphone size={18} /> : <Image size={18} />}
    </span>
    <div>
      <small>{item.type === 'aura_assignment' ? 'AURA BRAND' : 'PERSONAL BRAND'} · {dateLabel(item.postedAt)}</small>
      <strong>{item.title}</strong>
      <p>{item.groupName || item.platform || 'Bài đăng cá nhân / hội nhóm'}{item.briefId ? ` · Brief ${item.briefId}` : ''}</p>
      {item.reviewReason && <em>{item.reviewReason}</em>}
    </div>
    <span className={`performance-brand__status is-${status.tone}`}>{status.label}</span>
    <div className="performance-brand__evidence-actions">
      {item.url && <a href={item.url} target="_blank" rel="noreferrer" aria-label="Mở link bài đăng"><ExternalLink size={16} /></a>}
      {item.signedUrl && <a href={item.signedUrl} target="_blank" rel="noreferrer" aria-label="Mở ảnh bằng chứng"><Camera size={16} /></a>}
      {['submitted', 'needs_revision'].includes(item.status) && <button type="button" disabled={working} onClick={() => void withdraw()} aria-label="Rút bằng chứng"><Trash2 size={16} /></button>}
    </div>
  </article>
}

export default function StaffPerformanceBrandPanel({ periodId, isDemo = false }: { periodId: string; isDemo?: boolean }) {
  const [score, setScore] = useState<MyPerformanceScore | null>(null)
  const [evidence, setEvidence] = useState<BrandPerformanceEvidence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState<'personal_content' | 'aura_assignment'>('personal_content')
  const [platform, setPlatform] = useState<PerformanceEvidencePlatform>('facebook')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [postedAt, setPostedAt] = useState(todayKey)
  const [groupName, setGroupName] = useState('')
  const [briefId, setBriefId] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(0)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      if (isDemo) {
        setScore({ schemaVersion: 1, formulaVersion: 'aura-performance-v1', staffId: 'demo-trainer', periodId, amountImpact: 'none', locked: false, coverage: { availableWeight: 10, totalWeight: 100, confidence: 'low' }, score: { value: null, maximum: 100, reason: 'Bản demo chỉ minh họa cấu phần Brand.' }, categories: [], brand: { total: 0, maximum: 10, personal: { approvedCount: 0, target: 4, score: 0, maximum: 5 }, aura: { approvedCount: 0, target: 3, score: 0, maximum: 3 }, profile: { completedCount: 0, target: 10, score: 0, maximum: 2, checklist: {} } }, evidence: { total: 0, pending: 0, approved: 0 } })
        setEvidence([])
      } else {
        const [nextScore, nextEvidence] = await Promise.all([getMyPerformanceScore(periodId), listMyPerformanceEvidence(periodId)])
        setScore(nextScore); setEvidence(nextEvidence.filter((item) => item.type !== 'profile_checklist' && item.status !== 'withdrawn'))
      }
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setLoading(false) }
  }, [isDemo, periodId])

  useEffect(() => { void load() }, [load])
  const brand = score?.brand
  const monthRange = useMemo(() => ({ min: `${periodId}-01`, max: `${periodId}-${String(new Date(Number(periodId.slice(0, 4)), Number(periodId.slice(5, 7)), 0).getDate()).padStart(2, '0')}` }), [periodId])

  const resetForm = () => {
    setUrl(''); setFile(null); setTitle(''); setGroupName(''); setBriefId(''); setNote(''); setProgress(0); setPostedAt(todayKey())
  }

  const submit = async () => {
    if (!title.trim() || (!url.trim() && !file)) { setNotice('Nhập nội dung và gửi ít nhất một link hoặc ảnh chụp bài đăng.'); return }
    if (type === 'aura_assignment' && !briefId.trim()) { setNotice('Aura Brand cần mã brief, campaign, event hoặc workshop.'); return }
    setSending(true); setNotice(''); setProgress(0)
    try {
      await submitPerformanceBrandEvidence({ periodId, type, platform, url: url.trim(), screenshot: file, postedAt, groupName: groupName.trim(), briefId: briefId.trim(), title: title.trim(), note: note.trim() }, setProgress)
      setNotice('Đã gửi bằng chứng. Điểm chỉ được cộng sau khi quản lý hoặc Admin duyệt.'); setShowForm(false); resetForm(); await load()
    } catch (cause) { setNotice(errorMessage(cause)) }
    finally { setSending(false) }
  }

  const withdraw = async (evidenceId: string) => {
    setNotice('')
    try { await withdrawPerformanceBrandEvidence(evidenceId); setNotice('Đã rút bằng chứng khỏi hàng chờ.'); await load() }
    catch (cause) { setNotice(errorMessage(cause)) }
  }

  return <section className="performance-brand" aria-label="Aura Performance Score và bằng chứng thương hiệu">
    <header className="performance-brand__head">
      <div className="performance-brand__mark"><Award size={25} /></div>
      <div><small>AURA PERFORMANCE SCORE · 10/100 ĐIỂM</small><h2>Thương hiệu cá nhân / Aura Brand</h2><p>Gửi link bài cụ thể hoặc ảnh chụp bài đăng trên trang cá nhân và hội nhóm.</p></div>
      <div className="performance-brand__score"><strong>{brand?.total ?? '—'}</strong><span>/ 10 điểm</span></div>
    </header>

    {loading && <div className="performance-brand__state"><LoaderCircle className="spin" /> Đang đồng bộ điểm Brand…</div>}
    {error && <div className="performance-brand__state is-error"><AlertCircle /> <span>{error}</span><button type="button" onClick={() => void load()}><RotateCcw /> Thử lại</button></div>}
    {!loading && score && <>
      <div className="performance-brand__metrics">
        <article><span><UserRound /></span><div><small>PERSONAL BRAND · 5 ĐIỂM</small><strong>{brand?.personal.approvedCount || 0}/4 nội dung</strong><p>Điểm hiện tại {brand?.personal.score || 0}/5</p></div></article>
        <article><span><Megaphone /></span><div><small>AURA BRAND · 3 ĐIỂM</small><strong>{brand?.aura.approvedCount || 0}/3 nhiệm vụ</strong><p>Đúng brief và được duyệt</p></div></article>
        <article><span><ShieldCheck /></span><div><small>PROFILE QUALITY · 2 ĐIỂM</small><strong>{brand?.profile.completedCount || 0}/10 mục</strong><p>Quản lý đánh giá checklist hồ sơ</p></div></article>
      </div>
      <div className="performance-brand__rules"><CheckCircle2 /><p>Một nội dung đăng lại nhiều nơi chỉ tính một asset. Không chấm theo follower hoặc lượt thích; nội dung vi phạm bản quyền, consent hình ảnh khách hàng hoặc tuyên bố y khoa sai lệch sẽ không được duyệt.</p></div>
      <details className="performance-brand__framework"><summary>Khung Aura Performance Score 100 điểm</summary><div>{score.categories.map((category) => <span key={category.id}><b>{category.label}</b><em>{category.status === 'available' ? `${category.score ?? 0}/${category.weight}` : `N/A · trọng số ${category.weight}`}</em></span>)}</div><p>Dữ liệu chưa đủ được ghi N/A, không tự quy đổi thành 0. V1 chỉ phân tích và không tự thay đổi lương hoặc cấp bậc.</p></details>
      <div className="performance-brand__actions"><div><strong>{score.evidence.pending} chờ duyệt</strong><span>{score.evidence.approved} bằng chứng đã duyệt trong kỳ</span></div><button type="button" disabled={isDemo || score.locked} onClick={() => setShowForm((current) => !current)}><Plus /> Gửi bằng chứng</button></div>
    </>}

    {notice && <div className="performance-brand__notice" role="status">{notice}</div>}
    {showForm && <div className="performance-brand__form">
      <div className="performance-brand__type" role="group" aria-label="Loại bằng chứng"><button type="button" className={type === 'personal_content' ? 'is-active' : ''} onClick={() => setType('personal_content')}>Personal Brand</button><button type="button" className={type === 'aura_assignment' ? 'is-active' : ''} onClick={() => setType('aura_assignment')}>Aura Brand</button></div>
      <label><span>Nội dung / tiêu đề</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="VD: Bài chia sẻ kỹ thuật Squat cho người mới" /></label>
      <label><span>Nền tảng</span><select value={platform} onChange={(event) => setPlatform(event.target.value as PerformanceEvidencePlatform)}><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="group">Hội nhóm</option><option value="other">Khác</option></select></label>
      <label><span>Ngày đăng / hoàn thành</span><input type="date" min={monthRange.min} max={monthRange.max} value={postedAt} onChange={(event) => setPostedAt(event.target.value)} /></label>
      <label><span>Trang cá nhân / hội nhóm</span><input value={groupName} maxLength={160} onChange={(event) => setGroupName(event.target.value)} placeholder="Tên trang hoặc hội nhóm" /></label>
      {type === 'aura_assignment' && <label><span>Mã brief / campaign / event</span><input value={briefId} maxLength={120} onChange={(event) => setBriefId(event.target.value)} placeholder="VD: AURA-SEP-WORKSHOP-01" /></label>}
      <label className="is-wide"><span>Link bài đăng cụ thể</span><input type="url" value={url} maxLength={1000} onChange={(event) => setUrl(event.target.value)} placeholder="https://facebook.com/.../posts/..." /></label>
      <label className="is-wide performance-brand__file"><span>Ảnh chụp màn hình (JPG, PNG, WebP · tối đa 10MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} />{file && <em>{file.name}</em>}</label>
      <label className="is-wide"><span>Ghi chú cho người duyệt</span><textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Mô tả ngắn về đối tượng, thông điệp hoặc phần việc đã hoàn thành…" /></label>
      {sending && file && <div className="performance-brand__upload is-wide"><i><em style={{ width: `${progress}%` }} /></i><span>Đang tải ảnh {progress}%</span></div>}
      <footer className="is-wide"><button type="button" onClick={() => { setShowForm(false); resetForm() }}>Hủy</button><button type="button" className="is-submit" disabled={sending || !title.trim() || (!url.trim() && !file)} onClick={() => void submit()}>{sending ? <LoaderCircle className="spin" /> : <Send />} {sending ? 'Đang gửi…' : 'Gửi để duyệt'}</button></footer>
    </div>}

    {evidence.length > 0 && <div className="performance-brand__evidence"><header><strong>Bằng chứng kỳ này</strong><span>{evidence.length} hồ sơ</span></header>{evidence.map((item) => <BrandEvidenceRow key={item.id} item={item} onWithdraw={withdraw} />)}</div>}
  </section>
}
