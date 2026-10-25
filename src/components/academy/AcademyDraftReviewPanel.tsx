import { useEffect, useRef, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { firebaseAuth } from '../../lib/firebase'
import { loadAcademyLearningDraft } from '../../services/academyDraftReviewService'
import { academyDraftChapterNumbers, academyDraftCurriculumSize } from '../../features/academy/draftCatalog'
import type { AcademyDraftReviewPacket } from '../../../content/academy/learning-unit'
import AcademyLearningUnitReader from './AcademyLearningUnitReader'
import AcademyDraftAdoptionPanel, { type AcademyAdoptionEditorContext } from './AcademyDraftAdoptionPanel'

export default function AcademyDraftReviewPanel({ editor }: { editor?: AcademyAdoptionEditorContext }) {
  const [packet, setPacket] = useState<AcademyDraftReviewPacket | null>(null)
  const [chapter, setChapter] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const sessionOwner = useRef(firebaseAuth?.currentUser ?? null)
  useEffect(() => {
    const clear = () => { generation.current++; setPacket(null); setChapter(null); setLoading(false); setError(null) }
    const unsubscribe = firebaseAuth ? onAuthStateChanged(firebaseAuth, (owner) => {
      if (sessionOwner.current !== owner) clear()
      sessionOwner.current = owner
    }) : () => undefined
    return () => { generation.current++; unsubscribe() }
  }, [])
  const select = async (next: number) => {
    if (packet?.unit.chapter === next && !loading) return
    const request = ++generation.current
    setChapter(next); setPacket(null); setLoading(true); setError(null)
    try {
      const draft = await loadAcademyLearningDraft(next)
      if (request === generation.current) setPacket(draft)
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Chưa tải được bản nháp. Hãy thử lại.')
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }
  return <section className="academy-draft-panel" aria-label="Rà soát giáo trình chuyên sâu">
    <h2>Rà soát nội dung từng chương</h2>
    <p>Đã biên soạn {academyDraftChapterNumbers.length}/{academyDraftCurriculumSize} bản nháp chuyên sâu. Nội dung cần được duyệt trước khi xuất bản cho học viên.</p>
    <p>Chọn chương để tải riêng bản nháp. Xem nội dung không nhập, lưu hoặc xuất bản khóa học đang mở.</p>
    <div className="academy-draft-panel__choices">{academyDraftChapterNumbers.map((item) => <button key={item} type="button" aria-pressed={chapter === item} onClick={() => void select(item)}>Chương {item}</button>)}</div>
    {loading ? <p role="status">Đang tải bản nháp chương {chapter}…</p> : null}
    {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => chapter !== null && void select(chapter)}>Thử lại bản nháp</button></div> : null}
    {editor && chapter !== null ? <AcademyDraftAdoptionPanel editor={editor} chapter={chapter} sourcePreview={packet ? <AcademyLearningUnitReader key={`${packet.unit.chapter}:${packet.unit.revision}`} packet={packet} /> : null} />
      : packet ? <AcademyLearningUnitReader key={`${packet.unit.chapter}:${packet.unit.revision}`} packet={packet} /> : null}
  </section>
}
