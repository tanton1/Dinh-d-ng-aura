import { useEffect, useRef, useState } from 'react'
import { loadAcademyWorkbookArchive, type AcademyWorkbookState } from '../../services/academyLearningService'
import { useAcademySessionEpoch } from '../../features/academy/useAcademySessionEpoch'

/** Old drafts are reference material, never silently copied into new criteria. */
export default function AcademyWorkbookHistory({ ownerId, courseId, lessonId, archiveId, draft }: {
  ownerId: string; courseId: string; lessonId: string; archiveId?: string; draft?: AcademyWorkbookState
}) {
  const sessionEpoch = useAcademySessionEpoch()
  const scope = JSON.stringify([ownerId, courseId, lessonId, archiveId, sessionEpoch])
  const [result, setResult] = useState<{ scope: string; draft: AcademyWorkbookState } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => { generation.current += 1; setResult(null); setLoading(false); setError(''); return () => { generation.current += 1 } }, [scope])
  const read = async () => {
    if (!archiveId) return
    const request = ++generation.current
    setLoading(true); setError('')
    try {
      const previous = await loadAcademyWorkbookArchive(ownerId, courseId, lessonId, archiveId)
      if (request === generation.current) setResult({ scope, draft: previous })
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Chưa tải được bản cũ. Hãy thử lại.')
    } finally { if (request === generation.current) setLoading(false) }
  }
  const previous = draft ?? (result?.scope === scope ? result.draft : undefined)
  if (!draft && !archiveId) return null
  return <div className="academy-workbook-history">
    {!previous ? <button type="button" className="outline-button" disabled={loading} onClick={() => void read()}>{loading ? 'Đang tải bản nháp cũ…' : 'Xem bản nháp trước'}</button> : <details>
      <summary>Bản nháp phiên bản {previous.definitionVersion} — chỉ để đối chiếu</summary>
      <p>Các mục dưới đây giữ nguyên mã và câu trả lời của bản cũ; chưa được chuyển sang yêu cầu hiện tại.</p>
      <dl>{Object.entries(previous.answers).map(([id, answer]) => <div key={id}><dt>Mục {id}</dt><dd>{answer || 'Chưa điền'}</dd></div>)}</dl>
      {previous.reviewAt ? <p>Ngày rà đã ghi: {previous.reviewAt}</p> : null}
      <p>Xác nhận an toàn ở bản cũ: {previous.safetyAcknowledged ? 'Đã xác nhận' : 'Chưa xác nhận'}.</p>
    </details>}
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
