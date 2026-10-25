import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckCircle2, Circle, FolderKanban, LoaderCircle, Save, ShieldAlert, Sparkles } from 'lucide-react'
import {
  loadAcademyWorkbook,
  loadAcademyWorkbookFromCloud,
  type AcademyWorkbookState,
} from '../../services/academyLearningService'
import type { CourseLessonDraft } from '../../types'
import { useAcademyWorkbook } from '../../features/academy/useAcademyWorkbook'
import {
  getAcademyPortfolioStage,
  academyPortfolioWorkbookId,
  isAcademyPortfolioDraftReady,
  type AcademyPortfolioStage,
} from '../../features/academy/portfolio'
import { academyPortfolioSources, academyPortfolioReadPlan, academyPortfolioArtifactStatus, academyArtifactStatusLabel } from '../../features/academy/portfolioEvidence'
import { submitAcademyPortfolio } from '../../services/academySubmissionService'
import AcademySubmissionPanel from './AcademySubmissionPanel'
import { useAcademySessionEpoch } from '../../features/academy/useAcademySessionEpoch'

type Props = {
  chapter: 5 | 10 | 15 | 20
  ownerId: string
  courseId: string
  lessons: CourseLessonDraft[]
  currentLessonId: string
  currentWorkbook: AcademyWorkbookState
  canStudy: boolean
  practiceSubmissionRevisions?: Record<string, number>
  practiceSubmissionDefinitionVersions?: Record<string, number>
  practiceSubmissionDefinitionHashes?: Record<string, string>
  completedLessonIds?: string[]
  onPreparePortfolio?: (chapter: 5 | 10 | 15 | 20) => Promise<CourseLessonDraft[]>
  definitionScopeKey?: string
}

const rubricCopy = {
  data: ['Đủ dữ liệu', 'Các kết luận đều có dữ kiện và bối cảnh đi kèm.'],
  mechanism: ['Đúng cơ chế', 'Liên kết đúng kiến thức trong chặng, không tự chẩn đoán.'],
  feasibility: ['Có thể làm', 'Kế hoạch đủ nhỏ, rõ và dùng được trong ngày bận.'],
  safety: ['An toàn', 'Có giới hạn, điều kiện dừng và đúng người cần hỏi.'],
} as const

function requiredPracticeFields(lesson?: CourseLessonDraft) {
  return lesson?.learningDesign?.practice.fields
    .filter((field) => field.required && field.id !== 'reviewAt')
    .map((field) => field.id)
}

function AcademyPortfolioStudioContent({
  stage,
  ownerId,
  courseId,
  lessons,
  currentLessonId,
  currentWorkbook,
  canStudy,
  practiceSubmissionRevisions,
  practiceSubmissionDefinitionVersions,
  practiceSubmissionDefinitionHashes,
  completedLessonIds,
  onPreparePortfolio,
}: Omit<Props, 'chapter'> & { stage: AcademyPortfolioStage }) {
  const portfolioId = academyPortfolioWorkbookId(stage)
  const scopedLessons = useMemo(() => academyPortfolioSources(stage, lessons), [lessons, stage])
  const [expanded, setExpanded] = useState(false)
  const [activated, setActivated] = useState(false)
  const [definitions, setDefinitions] = useState<{ loading: boolean; ready: boolean; error: string }>({ loading: false, ready: !onPreparePortfolio, error: '' })
  const [sourceRefresh, setSourceRefresh] = useState(0)
  const loadedSourceIds = useRef(new Set<string>())
  const allDefinitionsLoaded = scopedLessons.every((item) => Boolean(item.lesson?.learningDesign?.practice))
  const definitionsReady = allDefinitionsLoaded && definitions.ready && !definitions.loading
  const sourceIdsKey = JSON.stringify(scopedLessons.filter((item) => item.lesson?.learningDesign?.practice).map((item) => item.lessonId))
  const sourceIds = useMemo(() => JSON.parse(sourceIdsKey) as string[], [sourceIdsKey])
  const portfolioController = useAcademyWorkbook(ownerId, courseId, portfolioId, canStudy, { loadEnabled: activated })
  const { workbook: portfolio, ready, issue: syncIssue, change: changePortfolio } = portfolioController
  const [sourceWorkbooks, setSourceWorkbooks] = useState<Record<string, AcademyWorkbookState>>(() => Object.fromEntries(
    scopedLessons.map(({ lessonId }) => [lessonId, loadAcademyWorkbook(ownerId, courseId, lessonId)]),
  ))
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourcesPartial, setSourcesPartial] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<{ submissionId: string; workbookRevision: number } | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const prepareDefinitions = async () => {
    if (!onPreparePortfolio || !canStudy || definitions.loading) return
    setDefinitions({ loading: true, ready: false, error: '' })
    try {
      const loaded = await onPreparePortfolio(stage.milestoneChapter)
      if (!academyPortfolioSources(stage, loaded).every((item) => item.lesson?.learningDesign?.practice)) throw new Error('Chưa có đủ tiêu chí của năm chương. Hãy tải lại phần đối chiếu.')
      if (mounted.current) setDefinitions({ loading: false, ready: true, error: '' })
    } catch (error) {
      if (mounted.current) setDefinitions({ loading: false, ready: false, error: error instanceof Error ? error.message : 'Chưa tải được tiêu chí. Hãy thử lại.' })
    }
  }
  useEffect(() => {
    const plan = academyPortfolioReadPlan(activated && definitionsReady && canStudy, currentLessonId, sourceIds, loadedSourceIds.current)
    if (!plan.length) return
    let active = true
    setSourcesLoading(true)
    setSourcesPartial(false)
    void Promise.allSettled(plan.map(async (lessonId) => ({
      lessonId,
      workbook: await loadAcademyWorkbookFromCloud(ownerId, courseId, lessonId),
    }))).then((results) => {
      if (!active) return
      setSourcesPartial(results.some((result) => result.status === 'rejected'))
      setSourceWorkbooks((current) => {
        const next = { ...current }
        results.forEach((result) => {
          if (result.status === 'fulfilled') {
            loadedSourceIds.current.add(result.value.lessonId)
            next[result.value.lessonId] = result.value.workbook
          }
        })
        return next
      })
      setSourcesLoading(false)
    })
    return () => { active = false }
  }, [activated, definitionsReady, canStudy, courseId, currentLessonId, ownerId, sourceIds, sourceRefresh])

  useEffect(() => {
    setSourceWorkbooks((current) => ({ ...current, [currentLessonId]: currentWorkbook }))
  }, [currentLessonId, currentWorkbook])

  const artifacts = scopedLessons.map(({ lesson, lessonId, practiceLessonId, chapter }) => {
    const workbook = lessonId === currentLessonId ? currentWorkbook : sourceWorkbooks[lessonId]
    const status = academyPortfolioArtifactStatus({
      workbook, requiredFieldIds: requiredPracticeFields(lesson),
      definitionLoaded: Boolean(lesson?.learningDesign?.practice),
      completed: completedLessonIds?.includes(practiceLessonId),
      submittedRevision: practiceSubmissionRevisions?.[practiceLessonId],
      definitionVersion: lesson?.learningDesign?.practice.version,
      submittedDefinitionVersion: practiceSubmissionDefinitionVersions?.[practiceLessonId],
      definitionHash: lesson?.learningDesign?.practice.identityHash,
      submittedDefinitionHash: practiceSubmissionDefinitionHashes?.[practiceLessonId],
      checked: lessonId === currentLessonId || loadedSourceIds.current.has(lessonId),
    })
    return {
      lessonId,
      chapter,
      title: lesson?.title ?? `Chương ${chapter}`,
      status,
      submitted: status === 'submitted' || status === 'updated-after-submission',
    }
  })
  const submittedArtifacts = artifacts.filter((artifact) => artifact.submitted).length
  const rubricScore = Object.values(portfolio.rubric).reduce<number>((total, score) => total + score, 0)
  const draftReady = isAcademyPortfolioDraftReady(stage, portfolio)
  const submittedCurrent = submitted?.workbookRevision === portfolio.cloudRevision && !portfolio.pendingSync
  const submit = async () => {
    if (!canStudy || !definitionsReady || !draftReady || submitting || submittedArtifacts < 5) return
    setSubmitting(true); setSubmitError(null)
    try {
      const synchronized = await portfolioController.flush()
      const result = await submitAcademyPortfolio({ courseId, stageId: stage.id, workbookRevision: synchronized.cloudRevision })
      if (mounted.current) setSubmitted(result)
    } catch (cause) {
      if (mounted.current) setSubmitError(cause instanceof Error ? cause.message : 'Chưa nộp được portfolio. Bản nháp vẫn được giữ.')
    } finally {
      if (mounted.current) setSubmitting(false)
    }
  }

  const updateAnswer = (fieldId: string, value: string) => changePortfolio((current) => ({
    ...current,
    definitionVersion: 1,
    answers: { ...current.answers, [fieldId]: value.slice(0, 2000) },
  }))
  return (
    <section className="academy-portfolio" aria-labelledby={`academy-portfolio-${stage.id}`}>
      <header>
        <div className="academy-portfolio__mark"><FolderKanban size={23} /></div>
        <div>
          <span>{stage.eyebrow}</span>
          <h3 id={`academy-portfolio-${stage.id}`}>{stage.title}</h3>
          <p>{stage.description}</p>
        </div>
        <div className="academy-portfolio__status">
          <span>{draftReady ? <Check size={14} /> : <Sparkles size={14} />}{draftReady ? 'Nháp đã đủ mục' : 'Portfolio chặng'}</span>
          <strong>{!allDefinitionsLoaded ? 'Chưa đối chiếu đủ tiêu chí năm chương' : completedLessonIds || practiceSubmissionRevisions ? `${submittedArtifacts}/${artifacts.length} bài thực hành đã nộp theo yêu cầu hiện tại` : 'Chưa có xác nhận bài nộp'}</strong>
        </div>
      </header>

      <div className="academy-portfolio__artifacts" aria-label="Bài thực hành trong chặng">
        {artifacts.map((artifact) => (
          <span key={artifact.lessonId} className={artifact.submitted ? 'is-complete' : ''} title={artifact.title}>
            {artifact.submitted ? <CheckCircle2 size={15} /> : <Circle size={15} />}
            Chương {artifact.chapter}: {academyArtifactStatusLabel[artifact.status]}
          </span>
        ))}
        {sourcesLoading ? <small><LoaderCircle className="spin" size={14} />Đang đối chiếu Cloud…</small> : null}
        {sourcesPartial ? <small className="has-warning">Một số bản nháp chưa tải được. <button type="button" onClick={() => setSourceRefresh((value) => value + 1)}>Thử lại phần chưa tải</button></small> : null}
      </div>

      <p className="academy-portfolio__outcome"><strong>Đầu ra:</strong> {stage.outcome}</p>
      <p className="academy-review-hint">Điền đủ hoặc tự chấm không đồng nghĩa đã nộp hay được coach đánh giá. Chỉ khi bấm nộp, bản tổng hợp mới được lưu thành minh chứng cùng năm bài thực hành đã nộp.</p>
      <button type="button" className="academy-portfolio__toggle" disabled={!canStudy} aria-expanded={expanded} onClick={() => {
        setActivated(true); setExpanded((value) => !value)
        if (!expanded && !definitionsReady) void prepareDefinitions()
      }}>
        <span>{expanded ? 'Thu gọn portfolio' : 'Mở portfolio để tổng hợp'}</span>
        <strong>{stage.fields.filter((field) => portfolio.answers[field.id]?.trim()).length}/{stage.fields.length} phần</strong>
      </button>

      {expanded ? (
        <div className="academy-portfolio__body">
          {definitions.loading ? <p role="status">Đang tải tiêu chí của năm chương trong chặng. Bài đã nộp được đối chiếu đúng phiên bản.</p> : null}
          {!definitions.loading && !definitionsReady ? <div role={definitions.error ? 'alert' : 'status'}>
            <p>{definitions.error || 'Chưa tải đủ tiêu chí hiện tại. Có bài đã nộp trước đây không có nghĩa đã đáp ứng phiên bản này.'}</p>
            {onPreparePortfolio ? <button type="button" className="outline-button" disabled={!canStudy} onClick={() => void prepareDefinitions()}>Tải lại tiêu chí chặng</button> : null}
          </div> : null}
          {!portfolioController.deviceSaved ? <p role="alert">Thiết bị chưa lưu được portfolio. Giữ trang mở cho tới khi đồng bộ hoặc sao chép nội dung ra ngoài.</p> : null}
          {syncIssue ? (
            <div className={`academy-practice-sync academy-practice-sync--${syncIssue}`} role="alert">
              <ShieldAlert size={18} />
              <div>
                <strong>{syncIssue === 'conflict' ? 'Portfolio có bản mới từ thiết bị khác' : syncIssue === 'size' ? 'Portfolio quá dài để đồng bộ' : 'Chưa đồng bộ lên Cloud'}</strong>
                <p>{syncIssue === 'conflict' ? 'Bản nháp được giữ trong bản sao khôi phục khi tải bản Cloud.' : syncIssue === 'size' ? 'Rút gọn câu trả lời; hệ thống không cắt mất nội dung để đồng bộ.' : 'Kiểm tra kết nối và phiên đăng nhập rồi thử lại.'}</p>
              </div>
              <button type="button" onClick={() => syncIssue === 'conflict' || !portfolio.pendingSync ? void portfolioController.reload() : portfolioController.retry()}>{syncIssue === 'conflict' ? 'Tải bản mới nhất' : 'Thử lại'}</button>
            </div>
          ) : null}

          {!ready ? <p role="status">Đang tải portfolio đã lưu…</p> : null}
          <div className="academy-portfolio__save-state" aria-live="polite">
            <Save size={14} />{portfolioController.status}
          </div>
          <fieldset className="academy-portfolio__edit" disabled={!canStudy || !ready || submitting} aria-label="Soạn bản tổng hợp portfolio">
          <div className="academy-portfolio__fields">
            {stage.fields.map((field) => (
              <label key={field.id}>
                <span>{field.label}<b aria-label="Bắt buộc">*</b></span>
                <small>{field.prompt}</small>
                {field.kind === 'long'
                  ? <textarea rows={4} value={portfolio.answers[field.id] ?? ''} disabled={!canStudy} placeholder={field.placeholder} onChange={(event) => updateAnswer(field.id, event.target.value)} />
                  : <input value={portfolio.answers[field.id] ?? ''} disabled={!canStudy} placeholder={field.placeholder} onChange={(event) => updateAnswer(field.id, event.target.value)} />}
              </label>
            ))}
          </div>

          <section className="academy-portfolio__rubric">
            <header><div><span>RUBRIC CAPSTONE</span><h4>Tự soi chất lượng bản tổng hợp</h4><p>Mốc tự rà: tối thiểu 6/8, mục an toàn không được bằng 0. Đây chưa phải điểm của coach.</p></div><strong>{rubricScore}/8</strong></header>
            <div>{Object.entries(rubricCopy).map(([key, copy]) => {
              const rubricKey = key as keyof AcademyWorkbookState['rubric']
              return <article key={key}><div><strong>{copy[0]}</strong><small>{copy[1]}</small></div><span>{[0, 1, 2].map((score) => <button key={score} type="button" className={portfolio.rubric[rubricKey] === score ? 'is-selected' : ''} disabled={!canStudy} onClick={() => changePortfolio((current) => ({ ...current, rubric: { ...current.rubric, [rubricKey]: score as 0 | 1 | 2 } }))}>{score}</button>)}</span></article>
            })}</div>
          </section>

          <label className="academy-portfolio__review">
            <span>Ngày rà lại portfolio<b aria-label="Bắt buộc">*</b></span>
            <small>Chọn ngày để kiểm tra bản tổng hợp còn phù hợp với dữ liệu và cuộc sống thật.</small>
            <input type="date" value={portfolio.reviewAt} disabled={!canStudy} onChange={(event) => changePortfolio((current) => ({ ...current, reviewAt: event.target.value }))} />
          </label>
          <label className="academy-practice-safety">
            <input type="checkbox" checked={portfolio.safetyAcknowledged} disabled={!canStudy} onChange={(event) => changePortfolio((current) => ({ ...current, safetyAcknowledged: event.target.checked }))} />
            <span><strong>Tôi giữ đúng ranh giới giáo dục và an toàn</strong><small>Portfolio giúp tổ chức dữ liệu và quyết định. Nó không thay thế chẩn đoán, điều trị hoặc hướng dẫn của chuyên môn phù hợp.</small></span>
          </label>
          <label className="academy-practice-share">
            <input type="checkbox" checked={portfolio.sharedWithCoach} disabled={!canStudy} onChange={(event) => changePortfolio((current) => ({ ...current, sharedWithCoach: event.target.checked }))} />
            <span><strong>Chia sẻ portfolio với coach phụ trách</strong><small>Mặc định chỉ bạn xem. Khi bật, chỉ coach đang được phân công mới có quyền đọc; bạn có thể tắt bất cứ lúc nào.</small></span>
          </label>
          </fieldset>
          <div className="academy-practice-submission">
            <div><strong>{submitted ? 'Đã ghi nhận portfolio' : 'Nộp bản tổng hợp chặng'}</strong>
              <p>Cần đủ năm bài thực hành đã nộp, các mục bắt buộc và tự rà an toàn. Bản tổng hợp được giữ riêng để đối chiếu; sửa nháp không đổi bản đã nộp. Nộp portfolio không tự tăng tiến độ bài học hoặc thay cho nhận xét của coach.</p>
              {submitted && !submittedCurrent ? <small>Nháp hiện tại đã thay đổi; nhận xét cũ vẫn gắn với bản đã nộp.</small> : null}
            </div>
            <button type="button" className="outline-button" disabled={!canStudy || !definitionsReady || !ready || !draftReady || submittedArtifacts < 5 || submitting || submittedCurrent} onClick={() => void submit()}>
              {submitting ? 'Đang nộp portfolio…' : submittedCurrent ? 'Đã nộp portfolio này' : submitted ? 'Nộp lại portfolio' : 'Nộp portfolio'}
            </button>
            {submitError ? <p role="alert">{submitError}</p> : null}
          </div>
          <AcademySubmissionPanel userId={ownerId} courseId={courseId} artifactId={portfolioId}
            currentWorkbookRevision={portfolio.cloudRevision} pendingDraft={portfolio.pendingSync} refreshKey={submitted?.submissionId ?? ''} />
        </div>
      ) : null}
    </section>
  )
}

export default function AcademyPortfolioStudio(props: Props) {
  const sessionEpoch = useAcademySessionEpoch()
  const stage = getAcademyPortfolioStage(props.chapter)
  if (!stage) return null
  return <AcademyPortfolioStudioContent key={`${props.ownerId}:${props.courseId}:${stage.id}:${sessionEpoch}:${props.definitionScopeKey ?? ''}`} {...props} stage={stage} />
}
