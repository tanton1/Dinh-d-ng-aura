import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPlus, Check, CircleAlert, MapPin, RefreshCw, UsersRound, X } from 'lucide-react'
import {
  createMyAdditionalSessionRequest,
  getMyAdditionalSessionSuggestions,
  type AdditionalSessionSuggestion,
  type AdditionalSessionSuggestionPage,
} from '../../services/sessionOperationsService'

interface Props {
  onClose: () => void
  onCreated?: (message: string) => void
}

function newKey() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(`${value}T00:00:00+07:00`))
}

function tierOf(candidate: AdditionalSessionSuggestion) {
  return candidate.priorityTier ?? (candidate.pairsExistingSession ? 1 : candidate.isPrimaryTrainer ? 2 : 3)
}

export default function AdditionalSessionModal({ onClose, onCreated }: Props) {
  const [page, setPage] = useState<AdditionalSessionSuggestionPage | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const idempotencyKey = useRef(newKey())
  const selected = page?.suggestions.find((item) => item.candidateId === selectedId) ?? null
  const groups = useMemo(() => ([1, 2, 3] as const).map((tier) => ({
    tier,
    title: tier === 1 ? 'Ưu tiên ghép ca 1/2' : tier === 2 ? 'PT chính dưới mốc cân tải' : 'PT Aura còn lịch',
    hint: tier === 1 ? 'Tận dụng ghế đang trống trong ca đã mở.' : tier === 2 ? 'Mở thêm ca cho PT chính khi vẫn dưới mốc tham chiếu.' : 'Phương án dự phòng để vẫn xếp đủ buổi.',
    items: (page?.suggestions ?? []).filter((item) => tierOf(item) === tier),
  })).filter((group) => group.items.length > 0), [page?.suggestions])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const next = await getMyAdditionalSessionSuggestions()
      setPage(next)
      setSelectedId((current) => next.suggestions.some((item) => item.candidateId === current) ? current : next.suggestions[0]?.candidateId ?? '')
    } catch (caught) {
      setPage(null)
      setSelectedId('')
      setError((caught instanceof Error ? caught.message : 'Chưa thể tải ca trống.').replace(/^Firebase:\s*/i, ''))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    if (!selected) return setError('Vui lòng chọn một ca phù hợp.')
    if (reason.trim().length < 3) return setError('Vui lòng nhập lý do từ 3 ký tự.')
    setSubmitting(true)
    setError('')
    try {
      const result = await createMyAdditionalSessionRequest({ candidateId: selected.candidateId, reason: reason.trim(), idempotencyKey: idempotencyKey.current })
      onCreated?.(result.requiresManagerApproval ? 'Đã gửi yêu cầu thêm buổi. Ca vượt mục tiêu tuần sẽ chờ quản lý duyệt.' : 'Đã gửi yêu cầu thêm buổi. Aura sẽ thông báo sau khi quản lý duyệt.')
      onClose()
    } catch (caught) {
      setError((caught instanceof Error ? caught.message : 'Chưa thể gửi yêu cầu.').replace(/^Firebase:\s*/i, ''))
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="student-policy-modal" role="dialog" aria-modal="true" aria-labelledby="additional-session-title">
    <button className="student-policy-modal__backdrop" type="button" aria-label="Đóng" onClick={onClose} />
    <section className="student-policy-sheet student-additional-session-sheet">
      <header><span><CalendarPlus size={21} /></span><div><small>AURA · KHO CA KHẢ DỤNG</small><h2 id="additional-session-title">Đăng ký thêm buổi</h2></div><button type="button" aria-label="Đóng" onClick={onClose}><X size={20} /></button></header>
      <div className="student-policy-note"><CircleAlert size={18} /><p><strong>Thứ tự ưu tiên:</strong> ghép ca 1/2, PT chính dưới mốc cân tải, rồi đến PT Aura còn slot. Mốc 8 ca/ngày chỉ là tham chiếu cân bằng, không phải giới hạn cứng.</p></div>
      <form onSubmit={submit}>
        <section className="student-additional-suggestions" aria-busy={loading}>
          <header><div><strong>{page?.suggestions.length ?? 0} ca phù hợp</strong><span>Chọn một khung trong thời hạn gói tập để gửi vận hành xác nhận.</span></div><button type="button" onClick={() => void load()} disabled={loading} aria-label="Tải lại ca trống"><RefreshCw className={loading ? 'is-spinning' : ''} size={17} /></button></header>
          {loading && !page && <div className="student-change-suggestions__empty"><RefreshCw className="is-spinning" /> Đang tìm ca khả dụng…</div>}
          {!loading && page && !page.suggestions.length && <div className="student-change-suggestions__empty"><CircleAlert /> {page.issueCodes.includes('ADDITIONAL_REQUEST_PENDING') ? 'Bạn đã có yêu cầu thêm buổi đang chờ xử lý.' : 'Chưa có ca phù hợp trong 21 ngày tới.'}</div>}
          <div className="student-additional-suggestions__groups">{groups.map((group) => <section className={`student-additional-suggestions__group is-tier-${group.tier}`} key={group.tier}><header><strong>{group.title}</strong><span>{group.items.length} ca · {group.hint}</span></header><div>{group.items.map((candidate) => <button type="button" key={candidate.candidateId} className={selectedId === candidate.candidateId ? 'is-selected' : ''} onClick={() => setSelectedId(candidate.candidateId)}><span className="student-change-suggestion__check">{selectedId === candidate.candidateId ? <Check size={14} /> : candidate.rank}</span><strong>{formatDate(candidate.date)} · {String(candidate.hour).padStart(2, '0')}:00</strong><span>{candidate.trainerName}</span><small className={`student-suggestion-branch${candidate.isCrossBranch ? ' is-cross-branch' : ''}`}><MapPin size={13} /> Tập tại {candidate.branchName}{candidate.isCrossBranch ? ` · khác ${candidate.homeBranchName || page?.homeBranchName || 'cơ sở hồ sơ'}` : ''}</small><small><UsersRound size={13} /> {candidate.occupancy}/{candidate.capacity} học viên · dự kiến {candidate.dailyLoadAfter ?? candidate.dailyLoad} ca · mốc {candidate.dailyTarget}</small><em>{candidate.pairsExistingSession ? 'Còn 1 ghế trong ca' : candidate.isPrimaryTrainer ? 'PT chính' : 'PT chính thức'}</em>{candidate.requiresManagerApproval && <i>Vượt mục tiêu tuần · cần duyệt</i>}</button>)}</div></section>)}</div>
        </section>
        {selected?.isCrossBranch && <div className="student-cross-branch-note"><MapPin size={17} /><p><strong>Ca bổ sung thuộc {selected.branchName}.</strong> Quản lý sẽ duyệt việc tập khác {selected.homeBranchName || page?.homeBranchName || 'cơ sở hồ sơ'} trước khi lịch được thêm.</p></div>}
        <label className="student-policy-reason"><span>Lý do đăng ký</span><textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: muốn tăng thêm một buổi trong tuần này…" /></label>
        {error && <p className="student-policy-error" role="alert">{error}</p>}
        <footer><button type="button" className="secondary" onClick={onClose}>Để sau</button><button type="submit" disabled={submitting || loading || !selected}>{submitting ? 'Đang gửi…' : 'Gửi yêu cầu thêm buổi'}</button></footer>
      </form>
    </section>
  </div>
}
