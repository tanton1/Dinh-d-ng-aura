import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, CircleDollarSign,
  Clock3, Filter, MessageCircle, Phone, RefreshCw, Search, Sparkles, UserRoundCheck,
} from 'lucide-react'
import {
  listContractRenewalPipeline,
  updateContractRenewalCase,
  type RenewalPipelineResponse,
  type RenewalPipelineRow,
  type RenewalRiskCategory,
  type RenewalStage,
} from '../../../services/contractRenewalService'
import RenewContractModal from './RenewContractModal'
import './ContractRenewals.css'

interface Props { onNavigate?: (screen: string) => void }

const riskLabels: Record<RenewalRiskCategory, string> = {
  expired: 'Đã hết hạn', exhausted: 'Đã hết buổi', critical: 'Cần xử lý ngay', upcoming: 'Sắp hết', early: 'Theo dõi sớm',
}
const stageLabels: Record<RenewalStage, string> = {
  uncontacted: 'Chưa liên hệ', contacted: 'Đã liên hệ', interested: 'Quan tâm', quote_sent: 'Đã gửi báo giá',
  follow_up: 'Hẹn chăm sóc', won: 'Đã tái ký', lost: 'Không tái ký',
}
const stageOptions = Object.entries(stageLabels) as Array<[RenewalStage, string]>
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.max(0, value))}đ`

function dateLabel(value: string | null) {
  if (!value) return 'Chưa hẹn'
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? 'Chưa hẹn' : parsed.toLocaleDateString('vi-VN')
}

function riskCopy(row: RenewalPipelineRow) {
  if (row.risk.category === 'expired') return `Quá hạn ${Math.abs(row.risk.daysLeft)} ngày`
  if (row.risk.category === 'exhausted') return `Hết buổi · còn ${row.risk.daysLeft} ngày`
  return `Còn ${row.risk.daysLeft} ngày · ${row.risk.sessionsLeft} buổi`
}

function zaloLink(row: RenewalPipelineRow) {
  const digits = row.student.phone.replace(/\D/g, '')
  if (!digits) return ''
  const message = encodeURIComponent(`Aura Fitness xin chào ${row.student.name}. Gói ${row.contract.packageName} của bạn ${row.risk.category === 'expired' ? 'đã hết hạn' : 'sắp kết thúc'}. Aura liên hệ để hỗ trợ chọn lộ trình tiếp theo phù hợp.`)
  return `https://zalo.me/${digits}?text=${message}`
}

export default function ContractRenewals({ onNavigate }: Props) {
  const [data, setData] = useState<RenewalPipelineResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [risk, setRisk] = useState<'all' | RenewalRiskCategory>('all')
  const [stage, setStage] = useState<'all' | RenewalStage>('all')
  const [branch, setBranch] = useState('all')
  const [sort, setSort] = useState<'priority' | 'value' | 'follow_up'>('priority')
  const [editingCase, setEditingCase] = useState<RenewalPipelineRow | null>(null)
  const [renewing, setRenewing] = useState<RenewalPipelineRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [caseStage, setCaseStage] = useState<RenewalStage>('uncontacted')
  const [followUpAt, setFollowUpAt] = useState('')
  const [caseNote, setCaseNote] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try { setData(await listContractRenewalPipeline()) }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Không thể tải danh sách tái ký.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const branches = useMemo(() => [...new Set((data?.rows || []).map((row) => row.branchName))].sort((a, b) => a.localeCompare(b, 'vi')), [data])
  const rows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('vi')
    const result = (data?.rows || []).filter((row) => {
      if (risk !== 'all' && row.risk.category !== risk) return false
      if (stage !== 'all' && row.stage !== stage) return false
      if (branch !== 'all' && row.branchName !== branch) return false
      if (!keyword) return true
      return [row.student.name, row.student.phone, row.student.email, row.contract.packageName, row.branchName]
        .some((value) => value.toLocaleLowerCase('vi').includes(keyword))
    })
    if (sort === 'value') return result.sort((left, right) => right.expectedValue - left.expectedValue)
    if (sort === 'follow_up') return result.sort((left, right) => String(left.nextFollowUpAt || '9999').localeCompare(String(right.nextFollowUpAt || '9999')))
    return result
  }, [data, search, risk, stage, branch, sort])

  const openCase = (row: RenewalPipelineRow) => {
    setEditingCase(row); setCaseStage(row.stage); setFollowUpAt(row.nextFollowUpAt || ''); setCaseNote(row.note || '')
  }
  const saveCase = async () => {
    if (!editingCase) return
    setSaving(true); setError('')
    try {
      await updateContractRenewalCase({ sourceContractId: editingCase.contract.id, stage: caseStage, expectedRevision: editingCase.caseRevision, nextFollowUpAt: followUpAt || null, note: caseNote })
      setEditingCase(null); await load()
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Không thể cập nhật chăm sóc.') }
    finally { setSaving(false) }
  }

  return <div className="renewal-page">
    <header className="renewal-hero">
      <div className="renewal-hero__copy"><span><Sparkles size={15} /> AURA SALES · RETENTION</span><h1>Tái ký & chăm sóc hợp đồng</h1><p>Một hàng đợi ưu tiên để liên hệ đúng người, đúng thời điểm và ghi nhận hợp đồng mới an toàn.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="renewal-refresh"><RefreshCw size={17} className={loading ? 'is-spinning' : ''} /> Làm mới</button>
      <div className="renewal-kpis" aria-label="Tổng quan tái ký">
        <article><AlertTriangle /><span>Cần xử lý</span><strong>{data?.stats.total ?? 0}</strong><small>hợp đồng trong 60 ngày</small></article>
        <article><Clock3 /><span>Khẩn cấp</span><strong>{(data?.stats.riskCounts.expired ?? 0) + (data?.stats.riskCounts.exhausted ?? 0) + (data?.stats.riskCounts.critical ?? 0)}</strong><small>hết hạn, hết buổi hoặc ≤ 7 ngày</small></article>
        <article><UserRoundCheck /><span>Đang chăm sóc</span><strong>{(data?.stats.stageCounts.contacted ?? 0) + (data?.stats.stageCounts.interested ?? 0) + (data?.stats.stageCounts.quote_sent ?? 0) + (data?.stats.stageCounts.follow_up ?? 0)}</strong><small>đã có tương tác</small></article>
        <article><CircleDollarSign /><span>Giá trị tiềm năng</span><strong>{money(data?.stats.pipelineValue ?? 0)}</strong><small>không phải doanh thu đã ghi nhận</small></article>
      </div>
    </header>

    <section className="renewal-toolbar" aria-label="Bộ lọc tái ký">
      <label className="renewal-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên, SĐT, email, gói tập…" /></label>
      <label><Filter size={15} /><select value={risk} onChange={(event) => setRisk(event.target.value as typeof risk)}><option value="all">Tất cả cảnh báo</option>{Object.entries(riskLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><select value={stage} onChange={(event) => setStage(event.target.value as typeof stage)}><option value="all">Tất cả giai đoạn</option>{stageOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="all">Tất cả chi nhánh</option>{branches.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="priority">Ưu tiên SLA</option><option value="value">Giá trị cao nhất</option><option value="follow_up">Lịch hẹn gần nhất</option></select></label>
    </section>

    <nav className="renewal-risk-tabs" aria-label="Nhóm hợp đồng">
      <button className={risk === 'all' ? 'is-active' : ''} onClick={() => setRisk('all')}>Tất cả <b>{data?.stats.total ?? 0}</b></button>
      {(Object.keys(riskLabels) as RenewalRiskCategory[]).map((item) => <button key={item} className={risk === item ? 'is-active' : ''} onClick={() => setRisk(item)}>{riskLabels[item]} <b>{data?.stats.riskCounts[item] ?? 0}</b></button>)}
    </nav>

    {error && <div className="renewal-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button onClick={() => setError('')}>Đóng</button></div>}
    {data?.truncated && <div className="renewal-warning">Danh sách hợp đồng đã chạm giới hạn an toàn. Hãy thu hẹp chi nhánh hoặc thời gian trước khi xử lý.</div>}

    <section className="renewal-list" aria-busy={loading}>
      <div className="renewal-list__heading"><div><h2>Danh sách ưu tiên</h2><p>{rows.length} hồ sơ phù hợp bộ lọc</p></div><span>Dữ liệu canonical · {data ? new Date(data.generatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>
      {loading ? <div className="renewal-state"><RefreshCw className="is-spinning" /><strong>Đang đối chiếu hợp đồng…</strong><span>Hệ thống đang chọn đúng hợp đồng mới nhất của mỗi học viên.</span></div>
        : rows.length === 0 ? <div className="renewal-state"><CheckCircle2 /><strong>Không có hợp đồng phù hợp</strong><span>Hãy đổi bộ lọc hoặc làm mới dữ liệu.</span></div>
          : <div className="renewal-grid">{rows.map((row) => {
            const contactUrl = zaloLink(row)
            const progress = row.contract.totalSessions > 0 ? Math.min(100, row.contract.usedSessions / row.contract.totalSessions * 100) : 0
            return <article key={row.caseId} className={`renewal-card renewal-card--${row.risk.category}`}>
              <div className="renewal-card__top"><div className="renewal-avatar">{row.student.name.trim().charAt(0).toUpperCase() || 'A'}</div><div className="renewal-identity"><strong>{row.student.name}</strong><span>{row.student.phone || 'Chưa có SĐT'} · {row.branchName}</span></div><span className="renewal-risk">{riskLabels[row.risk.category]}</span></div>
              <div className="renewal-card__contract"><div><span>{row.contract.packageName}</span><strong>{riskCopy(row)}</strong></div><div className="renewal-progress"><i style={{ width: `${progress}%` }} /></div><div className="renewal-contract-meta"><span>{row.contract.usedSessions}/{row.contract.totalSessions} buổi</span><span>Hết hạn {dateLabel(row.contract.endDate)}</span><span>{money(row.expectedValue)}</span></div></div>
              <div className="renewal-card__pipeline"><span className={`renewal-stage renewal-stage--${row.stage}`}>{stageLabels[row.stage]}</span><span><CalendarClock size={14} /> {dateLabel(row.nextFollowUpAt)}</span></div>
              {row.note && <p className="renewal-note">{row.note}</p>}
              <div className="renewal-card__actions"><button type="button" disabled={!contactUrl} onClick={() => contactUrl && window.open(contactUrl, '_blank', 'noopener,noreferrer')}><MessageCircle size={16} /> Liên hệ</button><button type="button" onClick={() => openCase(row)}><CalendarClock size={16} /> Chăm sóc</button><button type="button" className="is-primary" onClick={() => setRenewing(row)}>Tái ký <ChevronRight size={16} /></button></div>
            </article>
          })}</div>}
    </section>

    <button type="button" className="renewal-student-shortcut" onClick={() => onNavigate?.('admin-pt-students')}><Phone size={17} /> Mở hồ sơ học viên</button>

    {editingCase && <div className="renewal-sheet-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditingCase(null)}><section className="renewal-sheet" role="dialog" aria-modal="true" aria-labelledby="renewal-case-title"><div className="renewal-sheet__handle" /><header><div><span>CHĂM SÓC TÁI KÝ</span><h2 id="renewal-case-title">{editingCase.student.name}</h2><p>{editingCase.contract.packageName}</p></div><button onClick={() => setEditingCase(null)} aria-label="Đóng">×</button></header><label>Giai đoạn<select value={caseStage} onChange={(event) => setCaseStage(event.target.value as RenewalStage)}>{stageOptions.filter(([value]) => value !== 'won').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Ngày hẹn tiếp theo<input type="date" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} /></label><label>Ghi chú<textarea value={caseNote} onChange={(event) => setCaseNote(event.target.value)} maxLength={500} placeholder="Nhu cầu, mức quan tâm, lý do cần theo dõi…" /></label><footer><button onClick={() => setEditingCase(null)}>Hủy</button><button className="is-primary" disabled={saving} onClick={() => void saveCase()}>{saving ? 'Đang lưu…' : 'Lưu chăm sóc'}</button></footer></section></div>}
    {renewing && data && <RenewContractModal row={renewing} packages={data.packages} onClose={() => setRenewing(null)} onSuccess={async () => { setRenewing(null); await load() }} />}
  </div>
}
