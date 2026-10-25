import { useEffect, useRef, useState } from 'react'
import { listSharedAcademySubmissions } from '../../services/academySubmissionService'
import { academyReviewStatusLabels, type AcademySubmissionHead } from '../../features/academy/submissionTypes'
import { useAcademySessionEpoch } from '../../features/academy/useAcademySessionEpoch'
import AcademySubmissionPanel from './AcademySubmissionPanel'

export default function AcademyCoachReviewPanel({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [items, setItems] = useState<AcademySubmissionHead[]>([])
  const [selected, setSelected] = useState<AcademySubmissionHead | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const epoch = useAcademySessionEpoch()
  useEffect(() => {
    generation.current++; setItems([]); setSelected(null); setCursor(null); setLoaded(false); setLoading(false); setError(null)
    return () => { generation.current++ }
  }, [clientId, epoch])
  const load = async (nextPage = false) => {
    const attempt = ++generation.current
    setLoading(true); setError(null)
    if (!nextPage) { setItems([]); setSelected(null); setLoaded(false) }
    try {
      const result = await listSharedAcademySubmissions(clientId, nextPage ? cursor ?? undefined : undefined)
      if (generation.current !== attempt) return
      setItems((current) => nextPage ? [...current, ...result.items.filter((item) => !current.some((existing) => existing.submissionId === item.submissionId))] : result.items)
      setCursor(result.nextCursor); setLoaded(true)
    } catch (cause) {
      if (generation.current === attempt) { setItems([]); setSelected(null); setCursor(null); setError(cause instanceof Error ? cause.message : 'Chưa tải được bài chia sẻ. Hãy thử lại.') }
    } finally {
      if (generation.current === attempt) setLoading(false)
    }
  }
  return <section className="academy-coach-review" aria-label="Nhận xét bài Học cùng Aura">
    <h3>Bài học của {clientName}</h3>
    <p>Chỉ coach đang phụ trách và có trạng thái coaching hoạt động được xem các bài học viên chủ động chia sẻ. Hồ sơ PT không tự cấp quyền xem bài riêng tư.</p>
    <button type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Đang tải danh sách…' : loaded ? 'Tải lại danh sách bài chia sẻ' : 'Tải các bài đã chia sẻ'}</button>
    {error ? <p role="alert">{error}</p> : null}
    {loaded && !items.length ? <p>Chưa thấy bài được chia sẻ trong phần danh sách này. Học viên cần nộp bài và bật chia sẻ; không có bài hiển thị không có nghĩa là học viên chưa học.</p> : null}
    <ul className="academy-coach-review__list">{items.map((item) => <li key={item.submissionId}>
      <button type="button" aria-pressed={selected?.submissionId === item.submissionId} onClick={() => setSelected(item)}>
        <strong>{item.title}</strong><span>Nháp v{item.workbookRevision} đã nộp. {academyReviewStatusLabels[item.reviewStatus]}.</span>
      </button>
    </li>)}</ul>
    {cursor ? <button type="button" disabled={loading} onClick={() => void load(true)}>Xem phần danh sách tiếp theo</button> : null}
    {selected ? <AcademySubmissionPanel key={`${clientId}:${selected.submissionId}`} userId={clientId} courseId={selected.courseId}
      artifactId={selected.artifactId} coach autoOpen onReviewed={(review) => setItems((current) => current.map((item) =>
        item.submissionId === review.submissionId ? { ...item, reviewStatus: review.verdict } : item))} /> : null}
  </section>
}
