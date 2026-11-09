import { useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, MessageSquareQuote, ShieldAlert } from 'lucide-react'
import type { SopKnowledgeResource, SopStepPayload } from './types'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown) {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
}

function texts(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

function TextList({ items, empty = 'Chưa có nội dung.' }: { items: string[]; empty?: string }) {
  if (!items.length) return <p className="sop-center-empty-copy">{empty}</p>
  return <ul className="sop-center-check-list">{items.map((item, index) => <li key={`${index}-${item}`}><CheckCircle2 size={17} aria-hidden="true" /><span>{item}</span></li>)}</ul>
}

export type SopStepView = 'guide' | 'say' | 'cases' | 'quiz'
const stepViews: SopStepView[] = ['guide', 'say', 'cases', 'quiz']
export const isSopStepView = (value: unknown): value is SopStepView => stepViews.includes(value as SopStepView)

// A step reads as four short pages instead of one long one: the guide
// (what to do, what to avoid, the example), the phrases followed by the
// step's full scripts, the situations grouped by their kind, and the quick
// check.
function SopStepContent({ step, index, skill, scripts, view, onViewChange }: { step: SopStepPayload; index: number; skill?: ReactNode; scripts?: ReactNode; view: SopStepView; onViewChange: (view: SopStepView) => void }) {
  const cases = Array.isArray(step.cases) ? step.cases : []
  const quizzes = Array.isArray(step.quiz) ? step.quiz : []
  const say = step.say ?? []
  const example = record(step.example)
  const tools = texts(step.tools)
  const [caseGroup, setCaseGroup] = useState<string>('all')
  const groups = [...new Set(cases.map((item) => text(item.group)).filter(Boolean))]
  const shownCases = caseGroup === 'all' || !groups.includes(caseGroup) ? cases : cases.filter((item) => text(item.group) === caseGroup)
  const tabs: Array<{ id: SopStepView; label: string; count?: number }> = [
    { id: 'guide', label: 'Hướng dẫn' },
    { id: 'say', label: 'Mẫu câu', count: say.length },
    { id: 'cases', label: 'Tình huống', count: cases.length },
    ...(quizzes.length ? [{ id: 'quiz' as const, label: 'Kiểm tra', count: quizzes.length }] : []),
  ]
  const active = tabs.some((tab) => tab.id === view) ? view : 'guide'
  return (
    <div className="sop-center-document">
      <div className="sop-center-document-heading">
        <span>Bước {String(index + 1).padStart(2, '0')}</span>
        <h2>{step.title || 'Bước chưa đặt tên'}</h2>
        <p>{step.goal || 'Chưa mô tả mục tiêu của bước.'}</p>
      </div>

      <div className="sop-center-step-tabs" role="tablist" aria-label="Nội dung của bước">
        {tabs.map((tab) => <button type="button" role="tab" key={tab.id} id={`sop-step-tab-${tab.id}`} aria-selected={active === tab.id} aria-controls={`sop-step-panel-${tab.id}`} className={active === tab.id ? 'is-active' : ''} onClick={() => onViewChange(tab.id)}>{tab.label}{typeof tab.count === 'number' && <small>{tab.count}</small>}</button>)}
      </div>

      {active === 'guide' && <div role="tabpanel" id="sop-step-panel-guide" aria-labelledby="sop-step-tab-guide" className="sop-center-step-panel">
        {(step.when || step.owner || step.done) && <dl className="sop-center-step-meta">
          {step.when && <div><dt>Thời điểm / SLA</dt><dd>{step.when}</dd></div>}
          {step.owner && <div><dt>Người thực hiện</dt><dd>{step.owner}</dd></div>}
          {step.done && <div><dt>Hoàn thành khi</dt><dd>{step.done}</dd></div>}
        </dl>}

        {skill}

        <section className="sop-center-content-section">
          <div className="sop-center-section-title"><CheckCircle2 size={18} /><h3>Việc cần làm</h3></div>
          <TextList items={step.actions ?? []} />
        </section>

        {(step.avoid?.length ?? 0) > 0 && <section className="sop-center-content-section sop-center-content-section--warning">
          <div className="sop-center-section-title"><ShieldAlert size={18} /><h3>Không được làm / nói</h3></div>
          <TextList items={step.avoid ?? []} />
        </section>}

        {(text(example.good) || text(example.bad)) && <section className="sop-center-content-section">
          <div className="sop-center-section-title"><MessageSquareQuote size={18} /><h3>Làm đúng · làm sai</h3></div>
          <div className="sop-center-example">
            {text(example.good) && <blockquote className="is-good"><span>Nên</span>{text(example.good)}</blockquote>}
            {text(example.bad) && <blockquote className="is-bad"><span>Không nên</span>{text(example.bad)}</blockquote>}
            {text(example.why) && <p>{text(example.why)}</p>}
          </div>
        </section>}

        {(step.crm || step.escalate || tools.length > 0) && <section className="sop-center-note-grid">
          {step.crm && <div><span>Ghi nhận hệ thống</span><p>{step.crm}</p></div>}
          {step.escalate && <div><span>Chuyển cấp khi</span><p>{step.escalate}</p></div>}
          {tools.length > 0 && <div><span>Công cụ & biểu mẫu</span><p>{tools.join(' · ')}</p></div>}
        </section>}
      </div>}

      {active === 'say' && <div role="tabpanel" id="sop-step-panel-say" aria-labelledby="sop-step-tab-say" className="sop-center-step-panel">
        {say.length
          ? <div className="sop-center-quote-stack">{say.map((item, itemIndex) => <blockquote key={`${itemIndex}-${item}`}>{item}</blockquote>)}</div>
          : <p className="sop-center-empty-copy">Bước này chưa có mẫu câu.</p>}
        {scripts}
      </div>}

      {active === 'cases' && <div role="tabpanel" id="sop-step-panel-cases" aria-labelledby="sop-step-tab-cases" className="sop-center-step-panel">
        {groups.length > 1 && <div className="sop-center-chips sop-center-case-groups" role="group" aria-label="Nhóm tình huống">
          <button type="button" aria-pressed={caseGroup === 'all'} className={caseGroup === 'all' ? 'is-active' : ''} onClick={() => setCaseGroup('all')}>Tất cả <small>{cases.length}</small></button>
          {groups.map((group) => <button type="button" key={group} aria-pressed={caseGroup === group} className={caseGroup === group ? 'is-active' : ''} onClick={() => setCaseGroup(group)}>{group} <small>{cases.filter((item) => text(item.group) === group).length}</small></button>)}
        </div>}
        {shownCases.length
          ? <div className="sop-center-case-list">
            {shownCases.map((item, itemIndex) => <article key={`${itemIndex}-${item.when}`}>
              {item.group && <span>{item.group}</span>}
              <h4>{item.when}</h4>
              <p>{item.then}</p>
              {item.say?.map((line, lineIndex) => <blockquote key={`${lineIndex}-${line}`}>{line}</blockquote>)}
              {text(item.crm) && <small>Ghi nhận: {text(item.crm)}</small>}
            </article>)}
          </div>
          : <p className="sop-center-empty-copy">Bước này chưa có tình huống.</p>}
      </div>}

      {active === 'quiz' && <div role="tabpanel" id="sop-step-panel-quiz" aria-labelledby="sop-step-tab-quiz" className="sop-center-step-panel">
        <div className="sop-center-quiz-list">
          {quizzes.map((quiz, quizIndex) => <article key={`${quizIndex}-${quiz.question}`}>
            <strong>{quizIndex + 1}. {quiz.question}</strong>
            {quiz.options?.map((option, optionIndex) => <p className={optionIndex === quiz.answer ? 'is-answer' : ''} key={`${optionIndex}-${option}`}>{String.fromCharCode(65 + optionIndex)}. {option}</p>)}
            {quiz.why && <small>{quiz.why}</small>}
          </article>)}
        </div>
      </div>}
    </div>
  )
}

function SkillContent({ resource }: { resource: SopKnowledgeResource }) {
  const payload = resource.payload
  const contract = record(payload.contract)
  const groups = [
    ['Kích hoạt khi', texts(contract.trigger)],
    ['Dữ liệu đầu vào', texts(contract.inputs)],
    ['Quy tắc quyết định', texts(contract.decisionRules)],
    ['Hành động', texts(contract.actions)],
    ['Đầu ra bắt buộc', texts(contract.output)],
    ['Owner & SLA', texts(contract.ownerSla)],
    ['KPI', texts(contract.kpi)],
    ['Chuyển cấp', texts(contract.escalation)],
  ] as const
  return <div className="sop-center-document">
    {text(payload.requiredOutput) && <div className="sop-center-callout"><span>Đầu ra bắt buộc</span><strong>{text(payload.requiredOutput)}</strong></div>}
    <div className="sop-center-contract-grid">
      {groups.filter(([, items]) => items.length > 0).map(([label, items]) => <section key={label}><h3>{label}</h3><TextList items={items} /></section>)}
    </div>
  </div>
}

function ScriptContent({ resource }: { resource: SopKnowledgeResource }) {
  const payload = resource.payload
  const variants = records(payload.variants)
  const branches = records(payload.branches)
  const situation = text(payload.trigger || payload.situation)
  return <div className="sop-center-document">
    {situation && situation !== resource.summary && <div className="sop-center-callout"><span>Tình huống</span><strong>{situation}</strong></div>}
    {text(payload.goal) && <div className="sop-center-callout"><span>Mục tiêu</span><strong>{text(payload.goal)}</strong></div>}
    {text(payload.body) && <section className="sop-center-script-body"><span>Nội dung</span><p>{text(payload.body)}</p></section>}
    {variants.length > 0 && <section className="sop-center-content-section"><div className="sop-center-section-title"><MessageSquareQuote size={18} /><h3>Biến thể theo kênh / nhóm khách</h3><span className="sop-center-count-pill">{variants.length}</span></div><div className="sop-center-case-list">{variants.map((variant, index) => <article key={`${index}-${text(variant.channel || variant.audience)}`}><span>{text(variant.channel || variant.audience) || `Biến thể ${index + 1}`}</span><p>{text(variant.body)}</p>{text(variant.note) && <small>{text(variant.note)}</small>}</article>)}</div></section>}
    {records(payload.turns).length > 0 && <section className="sop-center-dialogue">
      {records(payload.turns).map((turn, index) => {
        const who = text(turn.who)
        return <div className={`sop-center-dialogue-turn sop-center-dialogue-turn--${who || 'note'}`} key={`${index}-${text(turn.text)}`}>
          <span>{who === 'customer' ? 'Khách' : who === 'staff' ? 'Aura' : 'Ghi chú'}</span>
          <p>{text(turn.text)}</p>
          {text(turn.tip) && <small>{text(turn.tip)}</small>}
        </div>
      })}
    </section>}
    {branches.length > 0 && <section className="sop-center-content-section"><div className="sop-center-section-title"><h3>Nếu khách phản hồi khác</h3><span className="sop-center-count-pill">{branches.length}</span></div><div className="sop-center-case-list">{branches.map((branch, index) => <article key={`${index}-${text(branch.if)}`}><span>{text(branch.if)}</span><p>{text(branch.say)}</p></article>)}</div></section>}
    {text(payload.guidance) && <section className="sop-center-content-section"><div className="sop-center-section-title"><h3>Hướng dẫn sử dụng</h3></div><p>{text(payload.guidance)}</p></section>}
    {text(payload.crm) && <section className="sop-center-note-grid"><div><span>Ghi nhận hệ thống</span><p>{text(payload.crm)}</p></div></section>}
    <TextList items={texts(payload.avoid)} empty="" />
  </div>
}

function ObjectionContent({ resource }: { resource: SopKnowledgeResource }) {
  const payload = resource.payload
  const responses = records(payload.responses)
  return <div className="sop-center-document">
    {text(payload.say) && !resource.title.includes(text(payload.say)) && <div className="sop-center-callout"><span>Khách nói</span><strong>“{text(payload.say)}”</strong></div>}
    {texts(payload.variants).length > 0 && <section className="sop-center-content-section"><div className="sop-center-section-title"><h3>Khách có thể nói</h3></div><div className="sop-center-chip-row">{texts(payload.variants).map((item) => <span key={item}>{item}</span>)}</div></section>}
    {texts(payload.clarify).length > 0 && <section className="sop-center-content-section"><div className="sop-center-section-title"><h3>Cần làm rõ</h3></div><div className="sop-center-quote-stack">{texts(payload.clarify).map((item) => <blockquote key={item}>{item}</blockquote>)}</div></section>}
    {responses.length > 0 && <section className="sop-center-content-section"><div className="sop-center-section-title"><h3>Phản hồi theo nguyên nhân</h3></div><div className="sop-center-case-list">{responses.map((item, index) => <article key={`${index}-${text(item.when)}`}><span>{text(item.when)}</span><p>{text(item.text)}</p></article>)}</div></section>}
    {texts(payload.avoid).length > 0 && <section className="sop-center-content-section sop-center-content-section--warning"><div className="sop-center-section-title"><ShieldAlert size={18} /><h3>Tránh</h3></div><TextList items={texts(payload.avoid)} /></section>}
  </div>
}

const policyLabels: Record<string, string> = {
  group: 'Nhóm', appliesTo: 'Áp dụng cho', rule: 'Quy định', source: 'Nguồn', key: 'Khóa', value: 'Giá trị', note: 'Ghi chú',
  name: 'Tên KPI', formula: 'Công thức', target: 'Mục tiêu', owner: 'Owner', freq: 'Tần suất', situation: 'Tình huống',
  trigger: 'Điều kiện kích hoạt', handler: 'Người xử lý', approver: 'Người duyệt', deadline: 'Thời hạn',
  service: 'Dịch vụ', label: 'Tên gói', months: 'Số tháng', monthly: 'Giá / tháng', bonus: 'Quyền lợi thêm',
  condition: 'Điều kiện', start: 'Bắt đầu', end: 'Kết thúc', review: 'Nội dung cần rà soát',
}

function VoiceContent({ resource }: { resource: SopKnowledgeResource }) {
  const type = text(resource.payload.type)
  const items = records(resource.payload.items)
  const rules = records(resource.payload.rules)
  const stringItems = texts(resource.payload.items)
  return <div className="sop-center-document">
    {rules.length > 0 && <div className="sop-center-voice-list">{rules.map((rule, index) => <article key={`${index}-${text(rule.label)}`}><span>{text(rule.group)}</span><strong>{text(rule.label)}</strong><p>{text(rule.why)}</p><small>Mẫu nhận diện: {text(rule.pattern)}</small></article>)}</div>}
    {items.length > 0 && <div className="sop-center-voice-list">{items.map((item, index) => <article key={`${index}-${text(item.from || item.who || item.label || item.id)}`}><span>{text(item.id || item.channel || item.audience || type)}</span><strong>{text(item.label || item.who || item.from)}</strong>{text(item.to) && <p className="is-good">Nên dùng: {text(item.to)}</p>}{text(item.call) && <p>Gọi “{text(item.call)}” · xưng “{text(item.self)}”</p>}{text(item.when) && <p>{text(item.when)}</p>}{texts(item.rules).length > 0 && <TextList items={texts(item.rules)} />}{texts(item.approach).length > 0 && <TextList items={texts(item.approach)} />}{text(item.note) && <small>{text(item.note)}</small>}</article>)}</div>}
    {stringItems.length > 0 && <section className="sop-center-content-section"><TextList items={stringItems} /></section>}
  </div>
}

function PolicyContent({ resource }: { resource: SopKnowledgeResource }) {
  const entries = Object.entries(resource.payload).filter(([key, value]) => key !== 'id' && value !== '' && value !== null && value !== undefined)
  return <div className="sop-center-document">
    {resource.sourceReviewRequired && <div className="sop-center-reference-warning"><AlertTriangle size={20} /><p>Nội dung nhập từ hệ SOP cũ, cần đối chiếu với chính sách hiện hành trước khi xuất bản.</p></div>}
    <dl className="sop-center-policy-list">
      {entries.map(([key, value]) => <div key={key}><dt>{policyLabels[key] ?? key}</dt><dd>{Array.isArray(value) ? value.map(text).join(' · ') : typeof value === 'object' ? JSON.stringify(value) : text(value)}</dd></div>)}
    </dl>
  </div>
}

export default function ResourceContent({ resource, activeStep, stepSkill, stepScripts, stepView = 'guide', onStepViewChange }: { resource: SopKnowledgeResource; activeStep: number; stepSkill?: ReactNode; stepScripts?: ReactNode; stepView?: SopStepView; onStepViewChange?: (view: SopStepView) => void }) {
  if (resource.kind === 'sop') {
    const playbook = Array.isArray(resource.payload.playbook) ? resource.payload.playbook as SopStepPayload[] : []
    return <SopStepContent step={playbook[activeStep] ?? { title: resource.title, goal: resource.summary }} index={activeStep} skill={playbook[activeStep] ? stepSkill : undefined} scripts={playbook[activeStep] ? stepScripts : undefined} view={stepView} onViewChange={(view) => onStepViewChange?.(view)} />
  }
  if (resource.kind === 'skill') return <SkillContent resource={resource} />
  if (resource.kind === 'script' || resource.kind === 'dialogue') return <ScriptContent resource={resource} />
  if (resource.kind === 'objection') return <ObjectionContent resource={resource} />
  if (resource.kind === 'voice') return <VoiceContent resource={resource} />
  return <PolicyContent resource={resource} />
}
