import { useEffect, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { CourseDraftInput } from '../../types'
import { firebaseAuth } from '../../lib/firebase'
import { useAcademySessionEpoch } from '../../features/academy/useAcademySessionEpoch'
import { academyReviewAreas, type AcademyAdoptionCandidate, type AcademyAdoptionRead, type AcademyAdoptionResult, type AcademyScientificChecks, type AcademyScientificDecision } from '../../features/academy/adoption'
import { prepareAcademyAdoption, readAcademyAdoption, reviewAcademyAdoption } from '../../services/academyAdoptionService'
import AcademyLearningUnitReader from './AcademyLearningUnitReader'
import './academy-adoption.css'

export interface AcademyAdoptionEditorContext {
  course: CourseDraftInput
  dirty: boolean
  busy: boolean
  onAdopt: (candidate: AcademyAdoptionCandidate) => Promise<AcademyAdoptionResult>
  onReload: (revision: number) => Promise<void>
}
type Props = { editor: AcademyAdoptionEditorContext; chapter: number; sourcePreview: ReactNode }
const labels = { content: 'Nội dung, ví dụ và phạm vi áp dụng', assessment: 'Câu hỏi, đáp án và tiêu chí bài thực hành', references: 'Nguồn tham khảo và giới hạn bằng chứng', safety: 'Dấu hiệu cảnh báo và giới hạn chuyên môn' }
const emptyChecks = (): AcademyScientificChecks => ({ content: false, assessment: false, references: false, safety: false })
const decisions = { approved: 'Đồng ý nội dung chuyên môn', 'changes-requested': 'Cần chỉnh sửa', withdrawn: 'Rút kết quả duyệt trước' }

export default function AcademyDraftAdoptionPanel(props: Props) {
  const epoch = useAcademySessionEpoch()
  return <AdoptionPanel key={`${props.editor.course.id}:${props.chapter}:${epoch}`} {...props} />
}

function AdoptionPanel({ editor, chapter, sourcePreview }: Props) {
  const { course } = editor
  const [view, setView] = useState<AcademyAdoptionRead | null>(null)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [refreshRequired, setRefreshRequired] = useState(false)
  const [notes, setNotes] = useState('')
  const [decision, setDecision] = useState<AcademyScientificDecision | ''>('')
  const [checks, setChecks] = useState(emptyChecks)
  const [confirmAdopt, setConfirmAdopt] = useState(false)
  const [lookupId, setLookupId] = useState('')
  const generation = useRef(0)
  const pending = useRef(false)
  const owner = useRef(firebaseAuth?.currentUser)
  useEffect(() => () => { generation.current++ }, [])
  const candidate = view?.candidateId ? view : null
  const moduleId = `nutrition-chapter-${String(chapter).padStart(2, '0')}`
  const eligible = course.contentStorage === 'chapters-v1' && (course.revision ?? 0) > 0 && course.modules.some((module) => module.id === moduleId)
  const busy = Boolean(phase) || editor.busy
  const currentRevision = view?.courseRevision === course.revision
  const current = (token: number) => generation.current === token && owner.current === firebaseAuth?.currentUser
  const setLoaded = (value: AcademyAdoptionRead) => {
    setView(value); setRefreshRequired(false); setChecks(emptyChecks()); setDecision(''); setNotes(''); setConfirmAdopt(false)
  }
  const run = async (label: string, operation: (token: number) => Promise<void>) => {
    if (pending.current || editor.busy) return
    const token = ++generation.current
    pending.current = true; setPhase(label); setError(''); setMessage('')
    try { await operation(token) } catch (cause) {
      if (current(token)) {
        const code = String((cause as { code?: unknown })?.code ?? '')
        if (/permission-denied|unauthenticated/.test(code)) setView(null)
        setRefreshRequired(true)
        setError(`${cause instanceof Error ? cause.message : 'Chưa xác nhận được thao tác.'} Mở lại đề xuất để kiểm tra trạng thái trước khi tiếp tục.`)
      }
    } finally {
      if (current(token)) { pending.current = false; setPhase('') }
    }
  }
  const open = (id?: string) => run('Đang mở đề xuất…', async (token) => {
    setView(null)
    const loaded = await readAcademyAdoption(course.id, chapter, id)
    if (current(token)) setLoaded(loaded)
  })
  const prepare = () => {
    if (!eligible || editor.dirty || busy) return
    return run('Đang tạo đề xuất từ bản đã lưu…', async (token) => {
      const prepared = await prepareAcademyAdoption(course.id, chapter, course.revision!)
      if (!current(token)) return
      const loaded = await readAcademyAdoption(course.id, chapter, prepared.candidateId)
      if (current(token)) { setLoaded(loaded); setMessage('Đã tạo đề xuất để rà soát. Chưa thay đổi khóa học đang mở hoặc bản học viên đang học.') }
    })
  }
  const saveReview = () => {
    if (!candidate || !candidate.canReview || !decision || refreshRequired || notes.trim().length < 40 || notes.trim().length > 6000) return
    if (decision === 'approved' && academyReviewAreas.some((area) => !checks[area])) return
    return run('Đang ghi nhận kết quả duyệt…', async (token) => {
      await reviewAcademyAdoption({ courseId: course.id, candidateId: candidate.candidateId, expectedReviewRevision: candidate.review?.revision ?? 0, decision, checks, notes })
      if (!current(token)) return
      const loaded = await readAcademyAdoption(course.id, chapter, candidate.candidateId)
      if (current(token)) { setLoaded(loaded); setMessage('Đã ghi nhận kết quả duyệt cho đúng đề xuất này. Chưa nhập vào khóa học hoặc xuất bản.') }
    })
  }
  const adopt = () => {
    if (!candidate || !candidate.approvalValid || candidate.alreadyAdopted || !currentRevision || !confirmAdopt || editor.dirty || refreshRequired || !eligible) return
    return run('Đang nhập chương vào bản nháp…', async (token) => {
      const result = await editor.onAdopt(candidate)
      if (current(token)) {
        setView({ ...candidate, alreadyAdopted: true, courseRevision: result.revision }); setConfirmAdopt(false)
        setMessage('Đã nhập chương vào bản nháp. Học viên vẫn học bản đã xuất bản trước đó; cần gửi duyệt và xuất bản riêng.')
      }
    })
  }
  const reviewDisabled = busy || refreshRequired || !decision || notes.trim().length < 40 || (decision === 'approved' && academyReviewAreas.some((area) => !checks[area]))
  return <section className="academy-adoption" aria-label={`Đề xuất nhập chương ${chapter}`}>
    <header><h3>Đưa chương {chapter} vào khóa học</h3><p>Đề xuất là một bản cố định gồm nội dung, nguồn và checkpoint. Duyệt chuyên môn, nhập nháp và xuất bản là các thao tác riêng.</p></header>
    {!eligible && <p role="note">Cần khóa học đã lưu theo từng chương và có đúng chương Aura tương ứng. Không tự di chuyển khóa đang phát hành.</p>}
    {editor.dirty && <p role="status">Có thay đổi chưa lưu. Hãy lưu trước khi tạo đề xuất, nhập chương hoặc tải lại bản biên tập. Xem và duyệt đề xuất không xóa thay đổi của bạn.</p>}
    <div className="academy-adoption__actions">
      <button type="button" disabled={busy || !eligible || editor.dirty} onClick={() => void prepare()}>Tạo đề xuất từ bản đã lưu</button>
      <button type="button" disabled={busy || (course.revision ?? 0) < 1} onClick={() => void open()}>Mở đề xuất mới nhất</button>
    </div>
    <details><summary>Mở một đề xuất cụ thể</summary>
      <label>Mã đề xuất<input value={lookupId} onChange={(event) => setLookupId(event.target.value.trim())} maxLength={64} autoComplete="off" spellCheck={false} /></label>
      <button type="button" disabled={busy || !/^[a-f0-9]{64}$/.test(lookupId)} onClick={() => void open(lookupId)}>Mở theo mã</button>
    </details>
    {phase && <p role="status">{phase}</p>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {view?.candidateId === null && <p>Chưa có đề xuất cho chương này. Tạo từ bản đã lưu khi bạn sẵn sàng rà soát.</p>}
    {view && !currentRevision && <div className="academy-adoption__notice" role="status">
      <p>Server đang ở revision {view.courseRevision}; bản biên tập đang mở ở revision {course.revision ?? 0}. Chưa thể nhập chương trên bản cũ.</p>
      <button type="button" disabled={busy || editor.dirty} onClick={() => void run('Đang tải bản biên tập mới nhất…', async (token) => {
        await editor.onReload(view.courseRevision)
        if (current(token)) setMessage('Đã tải bản biên tập theo revision đã kiểm tra. Hãy mở lại đề xuất để xác nhận trạng thái.')
      })}>Tải bản biên tập revision {view.courseRevision}</button>
    </div>}
    {candidate ? <>
      <section className="academy-adoption__status" aria-label="Trạng thái đề xuất">
        <h4>Đề xuất chương {chapter} · Nội dung {candidate.artifact.sourceRevision}</h4>
        <p>Tạo từ bản biên tập revision {candidate.preparedAtRevision}. Chỉ kết quả duyệt gắn với đúng đề xuất này mới có hiệu lực.</p>
        <p>{candidate.approvalValid ? 'Đã duyệt chuyên môn và quyền duyệt còn hiệu lực.' : candidate.review?.decision === 'approved'
          ? 'Kết quả đồng ý trước đó không còn đủ hiệu lực. Cần người có quyền chuyên môn duyệt lại.'
          : candidate.review ? `Kết quả: ${decisions[candidate.review.decision]}.` : 'Chưa có kết quả duyệt chuyên môn.'}</p>
        {candidate.review && <><p>Nhận xét: {candidate.review.notes}</p><p>Lần duyệt {candidate.review.revision}{candidate.review.reviewedAt ? ` · ${new Date(candidate.review.reviewedAt).toLocaleString('vi-VN')}` : ''}</p></>}
        {candidate.alreadyAdopted && <p>Đề xuất này đã có trong bản biên tập trên server. Điều này không đồng nghĩa đã xuất bản.</p>}
        <details><summary>Mã để đối chiếu đề xuất</summary><p className="academy-adoption__identifier">{candidate.candidateId}</p></details>
      </section>
      <details><summary>Nội dung chính xác sẽ nhập vào chương</summary>
        {candidate.artifact.module.lessons.filter((lesson) => lesson.type !== 'Quiz').map((lesson) => <article key={lesson.id} className="academy-adoption__compiled">
          <h4>{lesson.title}</h4><ReactMarkdown>{lesson.primaryContent?.body ?? ''}</ReactMarkdown>
          {lesson.resources?.length ? <><h5>Tài liệu giữ lại</h5><ul>{lesson.resources.map((resource) => <li key={resource.id}>{resource.title} (tài liệu bổ sung)</li>)}</ul></> : null}
        </article>)}
      </details>
      <details><summary>Nguồn biên soạn, ví dụ và tiêu chí từng mức</summary><AcademyLearningUnitReader packet={candidate.artifact.source} snapshot /></details>
      <details><summary>Checkpoint riêng: {candidate.artifact.checkpointQuestions.length} câu, đáp án và giải thích</summary>
        <p>Chỉ người có quyền biên tập được xem đáp án ở đây. Học viên làm bài qua chấm điểm trên server.</p>
        {candidate.artifact.checkpointQuestions.map((question, index) => <article className="academy-adoption__question" key={question.id}>
          <h4>Câu {index + 1}. {question.question}</h4>
          <p>Mục tiêu: {candidate.artifact.source.unit.objectives.find((item) => item.id === question.competencyId)?.outcome}</p>
          {question.mustPass && <p><strong>Câu bắt buộc đúng để đạt checkpoint.</strong></p>}
          <ol type="A">{question.options.map((option, optionIndex) => <li key={optionIndex}>{option}{optionIndex === question.correctIndex && <strong> — Đáp án</strong>}</li>)}</ol>
          <p>Giải thích: {question.explanation}</p>
        </article>)}
      </details>
      <section aria-label="Ghi nhận duyệt chuyên môn"><h4>Ghi nhận duyệt chuyên môn</h4>
        {!candidate.canReview ? <p>Tài khoản chưa có quyền duyệt chuyên môn còn hiệu lực cho chương này. Quyền quản trị ứng dụng không tự động cấp quyền duyệt chuyên môn.</p>
          : <fieldset disabled={busy || refreshRequired} className="academy-adoption__review">
            <legend>Chọn các phần thực tế đã kiểm tra</legend>
            {academyReviewAreas.map((area) => <label className="academy-adoption__check" key={area}><input type="checkbox" checked={checks[area]} onChange={(event) => setChecks((value) => ({ ...value, [area]: event.target.checked }))} />{labels[area]}</label>)}
            <label>Kết luận<select aria-label="Kết luận" value={decision} onChange={(event) => setDecision(event.target.value as AcademyScientificDecision | '')}><option value="">Chọn kết luận</option>{Object.entries(decisions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Nhận xét chuyên môn<textarea rows={5} value={notes} maxLength={6000} onChange={(event) => setNotes(event.target.value)} /></label>
            <p>Ghi rõ phạm vi đã kiểm tra, giới hạn hoặc nội dung cần sửa (ít nhất 40 ký tự). Các ô không được tự đánh dấu từ lần duyệt trước.</p>
            {decision === 'withdrawn' && <p>Rút kết quả duyệt chặn các lần nhập hoặc xuất bản tiếp theo, không tự gỡ bản đang phát hành. Nếu cần ngừng truy cập, quản trị viên dùng thao tác lưu trữ khóa học.</p>}
            <button type="button" disabled={reviewDisabled} onClick={() => void saveReview()}>Ghi nhận kết quả duyệt</button>
          </fieldset>}
      </section>
      <section aria-label="Nhập chương đã duyệt"><h4>Nhập vào bản nháp</h4>
        <p>Chỉ thay chương {chapter}; giữ các chương khác, bản đã xuất bản và bài làm cũ. Không tự đánh dấu bài thực hành cũ là đạt yêu cầu mới.</p>
        <label className="academy-adoption__check"><input type="checkbox" checked={confirmAdopt} disabled={busy || !candidate.approvalValid || candidate.alreadyAdopted || refreshRequired || editor.dirty || !currentRevision} onChange={(event) => setConfirmAdopt(event.target.checked)} />Tôi hiểu thao tác này thay chương trong bản nháp, chưa xuất bản cho học viên.</label>
        <button type="button" disabled={busy || !eligible || !candidate.approvalValid || candidate.alreadyAdopted || refreshRequired || !confirmAdopt || editor.dirty || !currentRevision} onClick={() => void adopt()}>Nhập chương {chapter} vào bản nháp</button>
      </section>
    </> : sourcePreview}
  </section>
}
