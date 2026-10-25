import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { readAcademySubmission, saveAcademyCoachReview } from '../../services/academySubmissionService'
import { useAcademySessionEpoch } from '../../features/academy/useAcademySessionEpoch'
import { academyReviewStatusLabels, type AcademyCoachReview, type AcademyReviewScores, type AcademyReviewVerdict, type AcademySubmissionView } from '../../features/academy/submissionTypes'
import './academy-submission.css'

type Props = {
  userId: string
  courseId: string
  artifactId: string
  currentWorkbookRevision?: number
  pendingDraft?: boolean
  refreshKey?: string | number
  coach?: boolean
  autoOpen?: boolean
  onReviewed?: (review: AcademyCoachReview) => void
}
const dateLabel = (value: number | null) => value ? new Date(value).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Vừa ghi nhận'

export default function AcademySubmissionPanel({ userId, courseId, artifactId, currentWorkbookRevision, pendingDraft, refreshKey, coach = false, autoOpen = false, onReviewed }: Props) {
  const formId = useId()
  const [expanded, setExpanded] = useState(false)
  const [view, setView] = useState<AcademySubmissionView | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [scores, setScores] = useState<Partial<AcademyReviewScores>>({})
  const [verdict, setVerdict] = useState<AcademyReviewVerdict>('needs-revision')
  const [feedback, setFeedback] = useState('')
  const generation = useRef(0)
  const epoch = useAcademySessionEpoch()
  const load = useCallback(async () => {
    const attempt = ++generation.current
    setExpanded(true); setLoading(true); setError(null); setView(null); setSaved(false)
    setFeedback(''); setScores({}); setVerdict('needs-revision')
    try {
      const result = await readAcademySubmission({ userId, courseId, artifactId })
      if (generation.current !== attempt) return
      setView(result)
      if (result.review) { setFeedback(result.review.feedback); setScores(result.review.scores); setVerdict(result.review.verdict) }
    } catch (cause) {
      if (generation.current === attempt) setError(cause instanceof Error ? cause.message : 'Chưa tải được bài nộp. Hãy thử lại.')
    } finally {
      if (generation.current === attempt) setLoading(false)
    }
  }, [userId, courseId, artifactId])
  useEffect(() => {
    generation.current++
    setExpanded(false); setView(null); setLoading(false); setSaving(false); setError(null); setSaved(false)
    setFeedback(''); setScores({})
    // A changed session always requires a fresh explicit open, even in the coach drawer.
    if (autoOpen && epoch === 0) void load()
    return () => { generation.current++ }
  }, [load, autoOpen, refreshKey, epoch])

  const submitReview = async () => {
    if (!view?.submission || saving) return
    const attempt = generation.current
    setSaving(true); setSaved(false); setError(null)
    try {
      const result = await saveAcademyCoachReview({ userId, courseId, artifactId, submissionId: view.submission.submissionId,
        expectedReviewRevision: view.review?.revision ?? 0, scores: scores as AcademyReviewScores, verdict, feedback })
      if (generation.current !== attempt) return
      setView({ ...view, review: result.review }); setSaved(true); onReviewed?.(result.review)
    } catch (cause) {
      if (generation.current !== attempt) return
      const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
      if (code.includes('permission-denied') || code.includes('unauthenticated')) { setView(null); setFeedback(''); setScores({}) }
      setError(cause instanceof Error ? cause.message : 'Chưa lưu được nhận xét. Nội dung đang soạn vẫn được giữ trên màn hình.')
    } finally {
      if (generation.current === attempt) setSaving(false)
    }
  }
  const submission = view?.submission
  const hasAllScores = submission?.rubric.criteria.every(({ id }) => scores[id] !== undefined) ?? false
  const latest = submission?.submissionId === view?.latestSubmissionId
  const edited = pendingDraft || (submission && currentWorkbookRevision !== undefined && currentWorkbookRevision > submission.workbookRevision)
  return <section className="academy-submission" aria-label={coach ? 'Xem và nhận xét bài đã nộp' : 'Bản đã nộp và phản hồi'}>
    <button type="button" className="academy-submission__toggle" aria-expanded={expanded} disabled={saving} onClick={() => {
      if (expanded) setExpanded(false)
      else if (view) setExpanded(true)
      else void load()
    }}>{expanded ? 'Thu gọn bài đã nộp' : 'Xem bài đã nộp và phản hồi'}</button>
    {expanded ? <div className="academy-submission__body">
      {loading ? <p role="status">Đang tải bản nộp đã lưu…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!loading ? <button type="button" className="academy-submission__refresh" disabled={saving} onClick={() => void load()}>{coach ? 'Tải lại bản mới nhất (bỏ nhận xét chưa lưu)' : 'Tải lại phản hồi mới nhất'}</button> : null}
      {view && !submission ? <p>Chưa có bản minh chứng đã lưu. Nếu bài đã hoàn thành từ phiên bản cũ, hãy mở bài thực hành và nộp lại; hệ thống không tự chuyển nháp thành bài nộp.</p> : null}
      {submission ? <>
        <header className="academy-submission__heading">
          <h4>{submission.title}</h4>
          <p>Bản nộp từ nháp v{submission.workbookRevision}, ngày {dateLabel(submission.submittedAt)}. Cấu trúc bài v{submission.definitionVersion}.</p>
        </header>
        {edited ? <p className="academy-submission__notice">Bạn có nháp mới hơn. Nội dung và nhận xét dưới đây vẫn thuộc bản đã nộp, không phải nháp đang sửa.</p> : null}
        {!latest ? <p role="status">Đây là bản nộp cũ; tải lại bản mới nhất trước khi phản hồi.</p> : null}
        <details className="academy-submission__evidence">
          <summary>Đọc nội dung đã nộp</summary>
          <dl>{submission.definitionSnapshot.fields.filter((field) => submission.evidence.answers[field.id] !== undefined).map((field) => <div key={field.id}>
            <dt>{field.label}</dt><dd>{submission.evidence.answers[field.id]}</dd>
          </div>)}</dl>
          {submission.sourceEvidence.length ? <div><h5>Minh chứng nguồn cố định</h5><ul>{submission.sourceEvidence.map((source) => <li key={source.artifactId}>
            Chương {Number(source.artifactId.match(/chapter-(\d+)/)?.[1])}, bản nộp từ nháp v{source.workbookRevision}
          </li>)}</ul><p>Đây là tham chiếu tới các bản đã nộp; nội dung bài nguồn chỉ được xem khi học viên chia sẻ riêng từng bài.</p></div> : null}
        </details>
        <div className="academy-submission__feedback">
          <h4>{view?.review ? academyReviewStatusLabels[view.review.verdict] : 'Chưa có nhận xét của coach'}</h4>
          {view?.review ? <>
            <p className="academy-submission__meta">Phản hồi v{view.review.revision}, {dateLabel(view.review.reviewedAt)}. Người phản hồi: {view.review.reviewerName}.</p>
            <p className="academy-submission__text">{view.review.feedback}</p>
            <dl className="academy-submission__score-summary">{submission.rubric.criteria.map((criterion) => <div key={criterion.id}><dt>{criterion.label}</dt><dd>{view.review!.scores[criterion.id]}/2</dd></div>)}</dl>
          </> : <p>{coach ? 'Học viên đã nộp bài và chưa có phản hồi. Hãy đọc minh chứng trước khi dùng tiêu chí bên dưới để nhận xét.' : 'Nộp bài ghi nhận minh chứng học tập, không tự động chấm chất lượng. Coach đang phụ trách chỉ xem được bài khi bạn bật chia sẻ.'}</p>}
          <p className="academy-submission__scope">Đánh giá này chỉ áp dụng cho yêu cầu bài học, không xác nhận năng lực chẩn đoán, điều trị hay tư vấn lâm sàng.</p>
        </div>
        {coach ? <form className="academy-submission__review-form" onSubmit={(event) => { event.preventDefault(); void submitReview() }}>
          <fieldset disabled={saving || loading || !latest}>
            <legend>Nhận xét đúng bản nộp này</legend>
            <p>Đọc minh chứng trước khi chọn điểm. Mức 0: cần sửa; mức 1: cần bổ sung; mức 2: đáp ứng tiêu chí.</p>
            {submission.rubric.criteria.map((criterion) => <label key={criterion.id}>
              <span id={`${formId}-${criterion.id}`}>{criterion.label}</span>
              <select required aria-labelledby={`${formId}-${criterion.id}`} aria-describedby={scores[criterion.id] !== undefined ? `${formId}-${criterion.id}-help` : undefined} value={scores[criterion.id] ?? ''} onChange={(event) => { setSaved(false); setScores((current) => ({ ...current, [criterion.id]: event.target.value === '' ? undefined : Number(event.target.value) as 0 | 1 | 2 })) }}>
                <option value="">Chọn mức dựa trên bài nộp</option>
                {criterion.levels.map((_level, index) => <option key={index} value={index}>{index}/2</option>)}
              </select>
              {scores[criterion.id] !== undefined ? <small id={`${formId}-${criterion.id}-help`}>{criterion.levels[scores[criterion.id]!]}</small> : null}
            </label>)}
            <label><span id={`${formId}-verdict`}>Kết quả bài học</span><select aria-labelledby={`${formId}-verdict`} aria-describedby={`${formId}-verdict-help`} value={verdict} onChange={(event) => { setSaved(false); setVerdict(event.target.value as AcademyReviewVerdict) }}>
              <option value="needs-revision">Cần bổ sung bài</option><option value="accepted">Đạt yêu cầu bài học</option>
            </select><small id={`${formId}-verdict-help`}>Đạt bài cần tối thiểu 6/8 và mục an toàn không bằng 0.</small></label>
            <label><span>Điểm tốt và bước tiếp theo</span><textarea required minLength={20} maxLength={4000} rows={5} value={feedback} onChange={(event) => { setSaved(false); setFeedback(event.target.value) }} placeholder="Nêu minh chứng cụ thể, phần cần làm rõ và bước tiếp theo phù hợp…" /></label>
            <button type="submit" disabled={!hasAllScores || feedback.trim().length < 20}>{saving ? 'Đang lưu nhận xét…' : 'Lưu nhận xét cho bản này'}</button>
          </fieldset>
          {saved ? <p role="status">Đã lưu nhận xét cho bản nộp v{submission.workbookRevision}. Bản nháp của học viên không bị thay đổi.</p> : null}
        </form> : null}
      </> : null}
    </div> : null}
  </section>
}
