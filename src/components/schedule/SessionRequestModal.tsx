import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, Check, CircleAlert, RefreshCw, UsersRound, X } from 'lucide-react'
import { createMySessionRequest, getMySessionChangeSuggestions, type SessionChangeSuggestionPage } from '../../services/sessionOperationsService'

interface RequestableSession {
  id: string
  date: string
  hour: number | null
  revision: number
}

interface Props {
  onClose: () => void
  onCreated?: (message: string) => void
  session: RequestableSession
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

export default function SessionRequestModal({ onClose, onCreated, session }: Props) {
  const [type, setType] = useState<'cancel' | 'reschedule'>('cancel')
  const [suggestionPage, setSuggestionPage] = useState<SessionChangeSuggestionPage | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState('')
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const idempotencyKey = useRef(newKey())
  const sessionLabel = useMemo(() => `${formatDate(session.date)} · ${session.hour === null ? '--:--' : `${String(session.hour).padStart(2, '0')}:00`}`, [session.date, session.hour])
  const selectedSuggestion = suggestionPage?.suggestions.find((candidate) => candidate.candidateId === selectedCandidateId) ?? null
  const policy = suggestionPage?.policy

  const loadSuggestions = async () => {
    setIsLoadingSuggestions(true)
    setError('')
    try {
      const page = await getMySessionChangeSuggestions(session.id, session.revision)
      setSuggestionPage(page)
      setSelectedCandidateId((current) => page.suggestions.some((item) => item.candidateId === current) ? current : page.suggestions[0]?.candidateId || '')
    } catch (caught) {
      setSuggestionPage(null)
      setSelectedCandidateId('')
      setError((caught instanceof Error ? caught.message : 'Chưa thể tải ca gợi ý.').replace(/^Firebase:\s*/i, ''))
    } finally {
      setIsLoadingSuggestions(false)
    }
  }

  useEffect(() => { void loadSuggestions() }, [session.id, session.revision])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return
    setError('')
    if (reason.trim().length < 3) return setError('Vui lòng nhập lý do từ 3 ký tự.')
    if (type === 'reschedule' && !selectedSuggestion) return setError('Vui lòng chọn một ca do hệ thống đề xuất.')

    setIsSubmitting(true)
    try {
      const result = await createMySessionRequest({
        sessionId: session.id,
        expectedRevision: session.revision,
        type,
        newDate: type === 'reschedule' ? selectedSuggestion?.date : undefined,
        newHour: type === 'reschedule' ? selectedSuggestion?.hour : undefined,
        newTrainerId: type === 'reschedule' ? selectedSuggestion?.trainerId : undefined,
        candidateId: type === 'reschedule' ? selectedSuggestion?.candidateId : undefined,
        reason: reason.trim(),
        idempotencyKey: idempotencyKey.current,
      })
      const policyMessage = result.expectedCountsTowardContract
        ? `Đây là lượt ${result.expectedSequence} trong tháng; khi được duyệt, buổi đã xếp sẽ được tính vào gói tập.`
        : `Đây là lượt ${result.expectedSequence}/${result.complimentaryLimit} được miễn tính buổi trong tháng.`
      onCreated?.(`Đã gửi yêu cầu. ${policyMessage}`)
      onClose()
    } catch (caught) {
      setError((caught instanceof Error ? caught.message : 'Chưa thể gửi yêu cầu.').replace(/^Firebase:\s*/i, ''))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="student-policy-modal" role="dialog" aria-modal="true" aria-labelledby="session-policy-title">
      <button className="student-policy-modal__backdrop" type="button" aria-label="Đóng" onClick={onClose} />
      <section className="student-policy-sheet">
        <header>
          <span><CalendarClock size={21} /></span>
          <div><small>AURA · QUY ĐỊNH LỊCH</small><h2 id="session-policy-title">Đổi hoặc hủy buổi tập</h2></div>
          <button type="button" aria-label="Đóng" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="student-policy-note"><CircleAlert size={18} /><p><strong>Gửi trước giờ tập ít nhất {policy?.sessionChangeDeadlineHours ?? 12} giờ.</strong> Aura đang áp dụng {policy?.complimentaryChangeCancelPerMonth ?? 1} lượt đổi/hủy không tính buổi mỗi tháng; bạn còn {policy?.complimentaryRemaining ?? '…'} lượt.</p></div>
        <div className="student-policy-current"><small>BUỔI ĐANG CHỌN</small><strong>{sessionLabel}</strong></div>
        <form onSubmit={handleSubmit}>
          <div className="student-policy-segment" aria-label="Loại yêu cầu"><button type="button" className={type === 'cancel' ? 'active' : ''} onClick={() => setType('cancel')}>Hủy buổi</button><button type="button" className={type === 'reschedule' ? 'active' : ''} onClick={() => setType('reschedule')}>Đổi lịch</button></div>
          {type === 'reschedule' && <section className="student-change-suggestions" aria-busy={isLoadingSuggestions}>
            <header><div><strong>Ca Aura đề xuất</strong><span>Ưu tiên xếp đủ buổi, ghép ca phù hợp và cân tải giữa các PT hợp lệ.</span></div><button type="button" onClick={() => void loadSuggestions()} disabled={isLoadingSuggestions} aria-label="Tải lại ca gợi ý"><RefreshCw className={isLoadingSuggestions ? 'is-spinning' : ''} size={17} /></button></header>
            {isLoadingSuggestions && !suggestionPage && <div className="student-change-suggestions__empty"><RefreshCw className="is-spinning" /> Đang tìm ca phù hợp…</div>}
            {!isLoadingSuggestions && suggestionPage && !suggestionPage.suggestions.length && <div className="student-change-suggestions__empty"><CircleAlert /> Chưa có ca trống khớp lịch rảnh trong 21 ngày tới. Aura sẽ hỗ trợ xếp thủ công.</div>}
            <div className="student-change-suggestions__rail">
              {suggestionPage?.suggestions.map((candidate) => <button type="button" key={candidate.candidateId} className={selectedCandidateId === candidate.candidateId ? 'is-selected' : ''} onClick={() => setSelectedCandidateId(candidate.candidateId)}>
                <span className="student-change-suggestion__check">{selectedCandidateId === candidate.candidateId ? <Check size={14} /> : candidate.rank}</span>
                <strong>{formatDate(candidate.date)} · {String(candidate.hour).padStart(2, '0')}:00</strong>
                <span>{candidate.trainerName}</span>
                <small><UsersRound size={13} /> {candidate.occupancy}/{candidate.capacity} học viên · dự kiến {candidate.dailyLoadAfter ?? (candidate.dailyLoad + Number(!candidate.pairsExistingSession))} ca · mốc cân tải {candidate.dailyTarget}</small>
                <em>{candidate.pairsExistingSession ? 'Ưu tiên ghép ca' : candidate.isCurrentTrainer ? 'PT hiện tại' : candidate.isAssignedTrainer ? 'PT phụ trách' : 'PT chính thức'}</em>
                {candidate.createsThreeConsecutiveDays && <i>3 ngày liên tiếp</i>}
                {(candidate.overTargetAfter ?? ((candidate.dailyLoadAfter ?? candidate.dailyLoad) > candidate.dailyTarget)) && <i>Tải cao hơn mốc tham chiếu</i>}
              </button>)}
            </div>
          </section>}
          <label className="student-policy-reason"><span>Lý do</span><textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Cho Aura biết lý do để vận hành hỗ trợ tốt hơn…" /></label>
          {error && <p className="student-policy-error" role="alert">{error}</p>}
          <footer><button type="button" className="secondary" onClick={onClose}>Để sau</button><button type="submit" disabled={isSubmitting || (type === 'reschedule' && (!selectedSuggestion || isLoadingSuggestions))}>{isSubmitting ? 'Đang gửi…' : 'Gửi yêu cầu'}</button></footer>
        </form>
      </section>
    </div>
  )
}
