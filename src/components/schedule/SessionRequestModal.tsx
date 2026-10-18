import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, Check, CircleAlert, MapPin, RefreshCw, UsersRound, X } from 'lucide-react'
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
  const suggestionLoadKey = useRef('')
  const sessionLabel = useMemo(() => `${formatDate(session.date)} · ${session.hour === null ? '--:--' : `${String(session.hour).padStart(2, '0')}:00`}`, [session.date, session.hour])
  const selectedSuggestion = suggestionPage?.suggestions.find((candidate) => candidate.candidateId === selectedCandidateId) ?? null
  const suggestions = suggestionPage?.suggestions ?? []
  const sourceWeekLabel = suggestionPage?.sourceWeekId && suggestionPage.sourceWeekEnd
    ? `${formatDate(suggestionPage.sourceWeekId)} – ${formatDate(suggestionPage.sourceWeekEnd)}`
    : 'tuần của buổi hiện tại'

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

  useEffect(() => {
    const key = `${session.id}:${session.revision}`
    if (type !== 'reschedule' || suggestionLoadKey.current === key) return
    suggestionLoadKey.current = key
    void loadSuggestions()
  }, [session.id, session.revision, type])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return
    setError('')
    if (reason.trim().length < 3) return setError('Vui lòng nhập lý do từ 3 ký tự.')
    if (type === 'reschedule' && !selectedSuggestion) return setError('Vui lòng chọn một ca do hệ thống đề xuất.')

    setIsSubmitting(true)
    try {
      await createMySessionRequest({
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
      onCreated?.(type === 'reschedule' ? 'Đã gửi yêu cầu đổi lịch.' : 'Đã gửi yêu cầu hủy buổi.')
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
          <h2 id="session-policy-title">Đổi hoặc hủy buổi</h2>
          <button type="button" aria-label="Đóng" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="student-policy-current"><small>Buổi hiện tại</small><strong>{sessionLabel}</strong></div>
        <form onSubmit={handleSubmit}>
          <div className="student-policy-segment" aria-label="Loại yêu cầu"><button type="button" className={type === 'cancel' ? 'active' : ''} onClick={() => setType('cancel')}>Hủy buổi</button><button type="button" className={type === 'reschedule' ? 'active' : ''} onClick={() => setType('reschedule')}>Đổi lịch</button></div>
          {type === 'reschedule' && <section className="student-change-suggestions" aria-busy={isLoadingSuggestions}>
            <header><div><strong>Chọn ca mới từ kho lịch rảnh</strong><span>{suggestions.length ? `${suggestions.length} slot còn chỗ · chỉ trong ${sourceWeekLabel}` : `Chỉ hiển thị slot còn chỗ trong ${sourceWeekLabel}`}</span></div><button type="button" onClick={() => void loadSuggestions()} disabled={isLoadingSuggestions} aria-label="Tải lại ca gợi ý"><RefreshCw className={isLoadingSuggestions ? 'is-spinning' : ''} size={17} /></button></header>
            {isLoadingSuggestions && !suggestionPage && <div className="student-change-suggestions__empty"><RefreshCw className="is-spinning" /> Đang tìm ca phù hợp…</div>}
            {!isLoadingSuggestions && suggestionPage && !suggestionPage.suggestions.length && <div className="student-change-suggestions__empty"><CircleAlert /> Chưa có ca phù hợp.</div>}
            <div className="student-change-suggestions__list">
              {suggestions.map((candidate) => {
                const availableSeats = Math.max(0, candidate.capacity - candidate.occupancy)
                const roleLabel = candidate.pairsExistingSession
                  ? `Ưu tiên ghép ca · ${candidate.occupancy}/${candidate.capacity}`
                  : candidate.isPrimaryTrainer
                    ? `Kho ca trống · ${candidate.occupancy}/${candidate.capacity} · PT chính`
                    : candidate.isCurrentTrainer
                      ? `Kho ca trống · ${candidate.occupancy}/${candidate.capacity} · PT hiện tại`
                      : candidate.isAssignedTrainer
                        ? `Kho ca trống · ${candidate.occupancy}/${candidate.capacity} · PT phụ trách`
                        : `Kho ca trống · ${candidate.occupancy}/${candidate.capacity}`
                return <button type="button" key={candidate.candidateId} className={selectedCandidateId === candidate.candidateId ? 'is-selected' : ''} aria-pressed={selectedCandidateId === candidate.candidateId} onClick={() => setSelectedCandidateId(candidate.candidateId)}>
                  <span className="student-change-suggestion__check">{selectedCandidateId === candidate.candidateId ? <Check size={14} /> : null}</span>
                  <span className="student-change-suggestion__meta"><strong>{formatDate(candidate.date)}</strong><time>{String(candidate.hour).padStart(2, '0')}:00</time></span>
                  <span className="student-change-suggestion__trainer">{candidate.trainerName}</span>
                  <span className={`student-change-suggestion__branch${candidate.isCrossBranch ? ' is-cross-branch' : ''}`}><MapPin size={13} /> {candidate.branchName}{candidate.isCrossBranch && <em>Khác cơ sở</em>}</span>
                  <span className="student-change-suggestion__capacity"><UsersRound size={13} /> Còn {availableSeats} chỗ</span>
                  <span className="student-change-suggestion__role">{roleLabel}</span>
                </button>
              })}
            </div>
          </section>}
          <label className="student-policy-reason"><span>{type === 'reschedule' ? 'Lý do đổi lịch' : 'Lý do hủy buổi'}</span><textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Nhập lý do" /></label>
          {error && <p className="student-policy-error" role="alert">{error}</p>}
          <footer><button type="button" className="secondary" onClick={onClose}>Để sau</button><button type="submit" disabled={isSubmitting || (type === 'reschedule' && (!selectedSuggestion || isLoadingSuggestions))}>{isSubmitting ? 'Đang gửi…' : 'Gửi yêu cầu'}</button></footer>
        </form>
      </section>
    </div>
  )
}
