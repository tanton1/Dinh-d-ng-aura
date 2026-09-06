import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckCircle2, Circle, FolderKanban, LoaderCircle, Save, ShieldAlert, Sparkles } from 'lucide-react'
import {
  AcademyWorkbookConflictError,
  loadAcademyWorkbook,
  loadAcademyWorkbookFromCloud,
  saveAcademyWorkbook,
  type AcademyWorkbookState,
} from '../../services/academyLearningService'
import type { CourseLessonDraft } from '../../types'
import {
  getAcademyPortfolioStage,
  academyPortfolioWorkbookId,
  isAcademyPortfolioComplete,
  isAcademyPracticeArtifactComplete,
  type AcademyPortfolioStage,
} from '../../features/academy/portfolio'

type Props = {
  chapter: 5 | 10 | 15 | 20
  ownerId: string
  courseId: string
  lessons: CourseLessonDraft[]
  currentLessonId: string
  currentWorkbook: AcademyWorkbookState
  canStudy: boolean
}

const rubricCopy = {
  data: ['Đủ dữ liệu', 'Các kết luận đều có dữ kiện và bối cảnh đi kèm.'],
  mechanism: ['Đúng cơ chế', 'Liên kết đúng kiến thức trong chặng, không tự chẩn đoán.'],
  feasibility: ['Có thể làm', 'Kế hoạch đủ nhỏ, rõ và dùng được trong ngày bận.'],
  safety: ['An toàn', 'Có giới hạn, điều kiện dừng và đúng người cần hỏi.'],
} as const

function workbookSignature(workbook: AcademyWorkbookState) {
  const { cloudRevision: _cloudRevision, updatedAt: _updatedAt, ...content } = workbook
  return JSON.stringify(content)
}

function lessonChapter(lesson: CourseLessonDraft) {
  const tag = lesson.tags?.find((candidate) => /^Chương\s+\d+$/i.test(candidate))
  return Number(tag?.match(/\d+/)?.[0])
}

function requiredPracticeFields(lesson: CourseLessonDraft) {
  return lesson.learningDesign?.practice.fields
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
}: Omit<Props, 'chapter'> & { stage: AcademyPortfolioStage }) {
  const portfolioId = academyPortfolioWorkbookId(stage)
  const scopedLessons = useMemo(() => lessons
    .map((lesson) => ({ lesson, chapter: lessonChapter(lesson) }))
    .filter((entry) => Number.isInteger(entry.chapter)
      && entry.chapter >= stage.chapterRange[0]
      && entry.chapter <= stage.chapterRange[1])
    .sort((left, right) => left.chapter - right.chapter), [lessons, stage.chapterRange])
  const [portfolio, setPortfolio] = useState<AcademyWorkbookState>(() => loadAcademyWorkbook(ownerId, courseId, portfolioId))
  const [sourceWorkbooks, setSourceWorkbooks] = useState<Record<string, AcademyWorkbookState>>(() => Object.fromEntries(
    scopedLessons.map(({ lesson }) => [lesson.id, loadAcademyWorkbook(ownerId, courseId, lesson.id)]),
  ))
  const [ready, setReady] = useState(false)
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourcesPartial, setSourcesPartial] = useState(false)
  const [saved, setSaved] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncIssue, setSyncIssue] = useState<'conflict' | 'offline' | null>(null)
  const [saveNonce, setSaveNonce] = useState(0)
  const [expanded, setExpanded] = useState(() => {
    const local = loadAcademyWorkbook(ownerId, courseId, portfolioId)
    return Object.values(local.answers).some((answer) => answer.trim())
  })
  const portfolioRef = useRef(portfolio)
  const mountedRef = useRef(true)
  const scope = `${ownerId}:${courseId}:${portfolioId}`
  const scopeRef = useRef(scope)

  useEffect(() => { portfolioRef.current = portfolio }, [portfolio])
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let active = true
    scopeRef.current = scope
    const localPortfolio = loadAcademyWorkbook(ownerId, courseId, portfolioId)
    setPortfolio(localPortfolio)
    setSourceWorkbooks(Object.fromEntries(scopedLessons.map(({ lesson }) => [
      lesson.id,
      lesson.id === currentLessonId ? currentWorkbook : loadAcademyWorkbook(ownerId, courseId, lesson.id),
    ])))
    setReady(false)
    setSourcesLoading(true)
    setSourcesPartial(false)
    setDirty(false)
    setSaving(false)
    setSyncIssue(null)

    void loadAcademyWorkbookFromCloud(ownerId, courseId, portfolioId)
      .then((remote) => {
        if (!active) return
        setPortfolio(remote)
        setExpanded(Object.values(remote.answers).some((answer) => answer.trim()))
        setSaved(true)
      })
      .catch((error) => {
        if (!active) return
        setDirty(localPortfolio.updatedAt > 0)
        setSaved(false)
        setSyncIssue(error instanceof AcademyWorkbookConflictError ? 'conflict' : 'offline')
      })
      .finally(() => { if (active) setReady(true) })

    void Promise.allSettled(scopedLessons.map(async ({ lesson }) => ({
      lessonId: lesson.id,
      workbook: lesson.id === currentLessonId
        ? currentWorkbook
        : await loadAcademyWorkbookFromCloud(ownerId, courseId, lesson.id),
    }))).then((results) => {
      if (!active) return
      setSourcesPartial(results.some((result) => result.status === 'rejected'))
      setSourceWorkbooks((current) => {
        const next = { ...current }
        results.forEach((result) => {
          if (result.status === 'fulfilled') next[result.value.lessonId] = result.value.workbook
        })
        return next
      })
      setSourcesLoading(false)
    })
    return () => { active = false }
  }, [courseId, currentLessonId, ownerId, portfolioId, scope, scopedLessons])

  useEffect(() => {
    setSourceWorkbooks((current) => ({ ...current, [currentLessonId]: currentWorkbook }))
  }, [currentLessonId, currentWorkbook])

  useEffect(() => {
    if (!ready || !canStudy || !dirty || saving || syncIssue === 'conflict') return
    const signature = workbookSignature(portfolio)
    const saveScope = scope
    const timer = window.setTimeout(() => {
      setSaving(true)
      void saveAcademyWorkbook(ownerId, courseId, portfolioId, portfolio)
        .then((synchronized) => {
          if (!mountedRef.current || scopeRef.current !== saveScope) return
          const hasNewerChanges = workbookSignature(portfolioRef.current) !== signature
          setPortfolio((current) => ({ ...current, cloudRevision: synchronized.cloudRevision, updatedAt: synchronized.updatedAt }))
          setDirty(hasNewerChanges)
          setSaved(!hasNewerChanges)
          setSyncIssue(null)
        })
        .catch((error) => {
          if (!mountedRef.current || scopeRef.current !== saveScope) return
          setSaved(false)
          setSyncIssue(error instanceof AcademyWorkbookConflictError ? 'conflict' : 'offline')
        })
        .finally(() => { if (mountedRef.current && scopeRef.current === saveScope) setSaving(false) })
    }, 650)
    return () => window.clearTimeout(timer)
  }, [canStudy, courseId, dirty, ownerId, portfolio, portfolioId, ready, saveNonce, saving, scope, syncIssue])

  const artifacts = scopedLessons.map(({ lesson, chapter }) => {
    const workbook = lesson.id === currentLessonId ? currentWorkbook : sourceWorkbooks[lesson.id]
    return {
      lessonId: lesson.id,
      chapter,
      title: lesson.title,
      complete: Boolean(workbook && isAcademyPracticeArtifactComplete(workbook, requiredPracticeFields(lesson))),
    }
  })
  const completedArtifacts = artifacts.filter((artifact) => artifact.complete).length
  const rubricScore = Object.values(portfolio.rubric).reduce<number>((total, score) => total + score, 0)
  const complete = isAcademyPortfolioComplete(stage, portfolio)

  const changePortfolio = (update: (current: AcademyWorkbookState) => AcademyWorkbookState) => {
    if (!canStudy) return
    setPortfolio(update)
    setDirty(true)
    setSaved(false)
  }
  const updateAnswer = (fieldId: string, value: string) => changePortfolio((current) => ({
    ...current,
    definitionVersion: 1,
    answers: { ...current.answers, [fieldId]: value.slice(0, 2000) },
  }))
  const reloadPortfolio = async () => {
    setReady(false)
    try {
      const remote = await loadAcademyWorkbookFromCloud(ownerId, courseId, portfolioId, { preferRemote: true })
      setPortfolio(remote)
      setDirty(false)
      setSaved(true)
      setSyncIssue(null)
    } catch {
      setSyncIssue('offline')
    } finally {
      setReady(true)
    }
  }

  return (
    <section className={`academy-portfolio${complete ? ' is-complete' : ''}`} aria-labelledby={`academy-portfolio-${stage.id}`}>
      <header>
        <div className="academy-portfolio__mark"><FolderKanban size={23} /></div>
        <div>
          <span>{stage.eyebrow}</span>
          <h3 id={`academy-portfolio-${stage.id}`}>{stage.title}</h3>
          <p>{stage.description}</p>
        </div>
        <div className="academy-portfolio__status">
          <span className={complete ? 'is-complete' : ''}>{complete ? <Check size={14} /> : <Sparkles size={14} />}{complete ? 'Đã hoàn thiện' : 'Portfolio chặng'}</span>
          <strong>{completedArtifacts}/{artifacts.length} bài thực hành</strong>
        </div>
      </header>

      <div className="academy-portfolio__artifacts" aria-label="Bài thực hành trong chặng">
        {artifacts.map((artifact) => (
          <span key={artifact.lessonId} className={artifact.complete ? 'is-complete' : ''} title={artifact.title}>
            {artifact.complete ? <CheckCircle2 size={15} /> : <Circle size={15} />}
            Chương {artifact.chapter}
          </span>
        ))}
        {sourcesLoading ? <small><LoaderCircle className="spin" size={14} />Đang đối chiếu Cloud…</small> : null}
        {sourcesPartial ? <small className="has-warning">Một số trạng thái đang dùng bản trên thiết bị.</small> : null}
      </div>

      <p className="academy-portfolio__outcome"><strong>Đầu ra:</strong> {stage.outcome}</p>
      <button type="button" className="academy-portfolio__toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span>{expanded ? 'Thu gọn portfolio' : 'Mở portfolio để tổng hợp'}</span>
        <strong>{stage.fields.filter((field) => portfolio.answers[field.id]?.trim()).length}/{stage.fields.length} phần</strong>
      </button>

      {expanded ? (
        <div className="academy-portfolio__body">
          {syncIssue ? (
            <div className={`academy-practice-sync academy-practice-sync--${syncIssue}`} role="alert">
              <ShieldAlert size={18} />
              <div>
                <strong>{syncIssue === 'conflict' ? 'Portfolio có bản mới từ thiết bị khác' : 'Cloud đang tạm gián đoạn'}</strong>
                <p>{syncIssue === 'conflict' ? 'Nội dung đang nhập vẫn còn trên màn hình. Hãy tải bản Cloud mới nhất trước khi tiếp tục.' : 'Nội dung được giữ trên thiết bị và sẽ đồng bộ lại khi kết nối ổn định.'}</p>
              </div>
              <button type="button" onClick={() => syncIssue === 'conflict' || !dirty ? void reloadPortfolio() : (setSyncIssue(null), setSaveNonce((value) => value + 1))}>{syncIssue === 'conflict' ? 'Tải bản mới nhất' : 'Thử lại'}</button>
            </div>
          ) : null}

          <div className="academy-portfolio__save-state" aria-live="polite">
            <Save size={14} />{saved ? 'Đã lưu' : saving ? 'Đang lưu…' : 'Có thay đổi chưa đồng bộ'}
          </div>
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
            <header><div><span>RUBRIC CAPSTONE</span><h4>Tự soi chất lượng bản tổng hợp</h4><p>Cần tối thiểu 6/8 và qua giới hạn an toàn để hoàn thiện.</p></div><strong>{rubricScore}/8</strong></header>
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
        </div>
      ) : null}
    </section>
  )
}

export default function AcademyPortfolioStudio(props: Props) {
  const stage = getAcademyPortfolioStage(props.chapter)
  if (!stage) return null
  return <AcademyPortfolioStudioContent {...props} stage={stage} />
}
