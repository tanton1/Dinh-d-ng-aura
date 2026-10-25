import { useState, type MouseEvent } from 'react'
import type { AcademyDraftReviewPacket } from '../../../content/academy/learning-unit'
import './academy-learning-unit.css'

/** Receives one authorized chapter. No static authoring imports or progress writes. */
export default function AcademyLearningUnitReader({ packet, snapshot = false }: { packet: AcademyDraftReviewPacket; snapshot?: boolean }) {
  const { unit, sources, formativeChecks } = packet
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const sourceNumberById = new Map(sources.map((source, index) => [source.id, index + 1]))
  const base = `academy-unit-${unit.chapter}`
  // Aura routes with location.hash. In-page references must not replace the app route.
  const jumpTo = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault()
    const target = document.getElementById(id)
    if (!target) return
    target.scrollIntoView({ block: 'start', behavior: 'auto' })
    target.focus({ preventScroll: true })
  }
  const sourceLinks = (ids: string[]) => <div className="academy-unit-reader__sources">Nguồn: {ids.map((id, index) => {
    const source = sourceById.get(id)
    return source ? <span key={id}>{index ? '; ' : ''}<a href={`#${base}-${id}`} aria-label={`${source.organization}: ${source.title}`} onClick={(event) => jumpTo(event, `${base}-${id}`)}>{source.organization} [{sourceNumberById.get(id)}]</a></span> : null
  })}</div>
  return <article className="academy-unit-reader" aria-labelledby={`${base}-title`}>
    <header>
      <p className="academy-unit-reader__draft">{snapshot ? 'Bản nguồn chương' : 'Bản nháp chương'} {unit.chapter} · Phiên bản {unit.revision}</p>
      <h2 id={`${base}-title`}>{unit.title}</h2>
      <p role="note">{snapshot ? 'Đây là bản nguồn được giữ nguyên trong đề xuất. Xem trạng thái duyệt của đúng đề xuất ở phía trên; nguồn này không tự thay thế khóa học đang phát hành.' : 'Chưa được chuyên gia chuyên môn duyệt. Chỉ dùng để biên tập; chưa thay thế nội dung khóa học đang phát hành.'}</p>
      <p><strong>Dành cho:</strong> {unit.audience}</p>
      <p><strong>Phạm vi:</strong> {unit.scope}</p>
      <p><strong>Nên học trước:</strong> {unit.prerequisites.length ? `Chương ${unit.prerequisites.join(', ')}.` : 'Không yêu cầu chương trước.'}</p>
    </header>
    <nav aria-label="Mục lục chương bản nháp">
      {[
        ['objectives', 'Mục tiêu'], ['lesson', 'Nội dung'], ['examples', 'Ví dụ có lời giải'],
        ['cases', 'Tình huống'], ['checks', 'Tự kiểm'], ['practice', 'Bài thực hành'], ['references', 'Nguồn'],
      ].map(([id, label]) => <a key={id} href={`#${base}-${id}`} onClick={(event) => jumpTo(event, `${base}-${id}`)}>{label}</a>)}
    </nav>

    <section id={`${base}-objectives`} tabIndex={-1}>
      <h3>Sau chương này, người học làm được gì?</h3>
      <ol>{unit.objectives.map((objective) => <li key={objective.id}><strong>{objective.outcome}</strong><p>Minh chứng: {objective.evidence}</p></li>)}</ol>
    </section>

    <section id={`${base}-lesson`} tabIndex={-1}>
      <h3>Nội dung nền tảng</h3>
      {unit.sections.map((section) => <section key={section.id} id={`${base}-${section.id}`} tabIndex={-1} className="academy-unit-reader__lesson">
        <h4>{section.title}</h4>
        {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        <aside aria-label={`Điểm cần nhớ: ${section.title}`}><ul>{section.takeaways.map((takeaway) => <li key={takeaway}>{takeaway}</li>)}</ul></aside>
        {sourceLinks(section.sourceIds)}
      </section>)}
    </section>

    <section id={`${base}-examples`} tabIndex={-1}>
      <h3>Ví dụ có lời giải</h3>
      <p>Thử giải trước khi mở lời giải. Số liệu giả định chỉ phục vụ học tập.</p>
      {unit.workedExamples.map((example) => <section key={example.id} className="academy-unit-reader__example">
        <h4>{example.title}</h4><p>{example.prompt}</p>
        <ul>{example.given.map((given) => <li key={given}>{given}</li>)}</ul>
        <details><summary>Xem lời giải: {example.title}</summary><ol>{example.steps.map((step) => <li key={step}>{step}</li>)}</ol><p><strong>Kết luận:</strong> {example.answer}</p><p><strong>Giới hạn:</strong> {example.limitation}</p></details>
      </section>)}
    </section>

    <section id={`${base}-cases`} tabIndex={-1}>
      <h3>Tình huống để luyện lập luận</h3>
      {unit.cases.map((item) => <section key={item.id} className="academy-unit-reader__case">
        <h4>{item.title}</h4><p>{item.context}</p><p><strong>{item.question}</strong></p>
        <details><summary>Xem cách phân tích: {item.title}</summary><ol>{item.reasoning.map((reason) => <li key={reason}>{reason}</li>)}</ol><p><strong>Bước tiếp:</strong> {item.safeNextStep}</p><p><strong>Lỗi dễ gặp:</strong> {item.commonError}</p></details>
      </section>)}
    </section>

    <section id={`${base}-checks`} tabIndex={-1}>
      <h3>Tự kiểm để sửa cách hiểu</h3><p>Các câu này không cộng tiến độ và không thay bài kiểm tra cuối chương.</p>
      {formativeChecks.map((check, index) => <fieldset key={check.id} className="academy-unit-reader__check">
        <legend>{index + 1}. {check.prompt}</legend>
        {check.options.map((option, optionIndex) => <label key={optionIndex}><input type="radio" name={`${base}-${check.id}`} checked={answers[check.id] === optionIndex} onChange={() => setAnswers((current) => ({ ...current, [check.id]: optionIndex }))} /><span>{option}</span></label>)}
        {Number.isInteger(answers[check.id]) ? <div className="academy-unit-reader__feedback" role="status"><strong>{answers[check.id] === check.correctIndex ? 'Đúng cách hiểu.' : 'Cần xem lại.'}</strong> {check.feedback} <a href={`#${base}-${check.sectionId}`} onClick={(event) => jumpTo(event, `${base}-${check.sectionId}`)}>Đọc lại phần liên quan</a></div> : null}
      </fieldset>)}
    </section>

    <section id={`${base}-practice`} tabIndex={-1}>
      <h3>{unit.practice.title}</h3><p><strong>Đầu ra:</strong> {unit.practice.artifact}</p>
      <ol>{unit.practice.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <dl>{unit.practice.fields.map((field) => <div key={field.id}><dt>{field.label}{field.required ? ' (bắt buộc)' : ''}</dt><dd>{field.prompt}</dd></div>)}</dl>
      <details><summary>Xem một bài làm minh họa</summary><ul>{unit.practice.modelResponse.map((line) => <li key={line}>{line}</li>)}</ul></details>
      <h4>Tiêu chí đánh giá</h4><p>0: cần sửa · 1: đã có một phần · 2: đáp ứng tiêu chí. Tự chấm không đồng nghĩa coach đã duyệt.</p>
      <div className="academy-unit-reader__rubrics">{unit.practice.rubric.map((rubric) => <section key={rubric.id}><h5>{rubric.label}</h5><ol start={0}>{rubric.levels.map((level) => <li key={level}>{level}</li>)}</ol></section>)}</div>
    </section>

    <section><h3>Giới hạn an toàn</h3><ul>{unit.safety.map((item) => <li key={item}>{item}</li>)}</ul></section>
    <details className="academy-unit-reader__coach"><summary>Gợi ý cho PT và người hướng dẫn</summary><ul>{unit.coachExtension.map((item) => <li key={item}>{item}</li>)}</ul></details>
    <section id={`${base}-references`} tabIndex={-1}>
      <h3>Nguồn và phạm vi sử dụng</h3>
      <p>Đã đối chiếu đường dẫn không đồng nghĩa toàn bộ chương đã được chuyên gia duyệt. Các ví dụ, tình huống và bài tập giả định do Aura biên soạn.</p>
      <ol className="academy-unit-reader__references">{sources.map((source) => <li key={source.id} id={`${base}-${source.id}`} tabIndex={-1}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><p>{source.organization}. Đối chiếu ngày {source.checkedAt}.</p><p><strong>Dùng cho:</strong> {source.supports}</p><p><strong>Giới hạn:</strong> {source.limitations}</p></li>)}</ol>
    </section>
  </article>
}
