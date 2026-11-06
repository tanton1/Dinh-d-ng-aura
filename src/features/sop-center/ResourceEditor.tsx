import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { kindLabels } from './model'
import type { SopKnowledgeKind, SopKnowledgeResource, SopStepPayload } from './types'

export interface SopDraftSubmission {
  note: string
  resource: Pick<SopKnowledgeResource, 'kind' | 'code' | 'title' | 'summary' | 'ownerRole' | 'audiences' | 'branchScope' | 'tags' | 'payload'>
}

const creatableKinds: SopKnowledgeKind[] = ['sop', 'skill', 'script', 'dialogue', 'objection', 'policy', 'variable', 'kpi', 'escalation']

function lines(value: string) {
  return value.split('\n').map((item) => item.trim()).filter(Boolean)
}

function blocks(value: string) {
  return value.split(/\n\s*---\s*\n/).map((item) => item.trim()).filter(Boolean)
}

function blankPayload(kind: SopKnowledgeKind): Record<string, unknown> {
  if (kind === 'sop') return { stage: '', goal: '', playbook: [] }
  if (kind === 'skill') return { requiredOutput: '', contract: { trigger: [], inputs: [], decisionRules: [], actions: [], output: [], ownerSla: [], kpi: [], escalation: [] } }
  if (kind === 'script') return { trigger: '', body: '', guidance: '' }
  if (kind === 'dialogue') return { situation: '', goal: '', turns: [] }
  if (kind === 'objection') return { say: '', variants: [], meaning: [], clarify: [], responses: [], avoid: [] }
  if (kind === 'policy') return { group: '', appliesTo: '', rule: '', source: '' }
  return {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export default function ResourceEditor({
  resource,
  activeStep,
  busy,
  onCancel,
  onSave,
}: {
  resource: SopKnowledgeResource | null
  activeStep: number
  busy: boolean
  onCancel: () => void
  onSave: (submission: SopDraftSubmission) => void | Promise<void>
}) {
  const [kind, setKind] = useState<SopKnowledgeKind>(resource?.kind ?? 'sop')
  const [title, setTitle] = useState(resource?.title ?? '')
  const [code, setCode] = useState(resource?.code ?? '')
  const [summary, setSummary] = useState(resource?.summary ?? '')
  const [ownerRole, setOwnerRole] = useState(resource?.ownerRole ?? 'admin')
  const [audiences, setAudiences] = useState(resource?.audiences.join(', ') ?? '')
  const [tags, setTags] = useState(resource?.tags.join(', ') ?? '')
  const [note, setNote] = useState(resource ? 'Cập nhật nội dung' : 'Tạo tài liệu mới')
  const [payloadJson, setPayloadJson] = useState(JSON.stringify(resource?.payload ?? blankPayload('sop'), null, 2))
  const [error, setError] = useState('')

  const initialStep = useMemo(() => {
    const playbook = resource?.kind === 'sop' && Array.isArray(resource.payload.playbook)
      ? resource.payload.playbook as SopStepPayload[]
      : []
    return playbook[activeStep] ?? {}
  }, [activeStep, resource])

  const [stepTitle, setStepTitle] = useState(initialStep.title ?? '')
  const [stepWhen, setStepWhen] = useState(initialStep.when ?? '')
  const [stepOwner, setStepOwner] = useState(initialStep.owner ?? '')
  const [stepGoal, setStepGoal] = useState(initialStep.goal ?? '')
  const [stepActions, setStepActions] = useState((initialStep.actions ?? []).join('\n'))
  const [stepSay, setStepSay] = useState((initialStep.say ?? []).join('\n---\n'))
  const [stepAvoid, setStepAvoid] = useState((initialStep.avoid ?? []).join('\n'))
  const [stepCrm, setStepCrm] = useState(initialStep.crm ?? '')
  const [stepDone, setStepDone] = useState(initialStep.done ?? '')

  useEffect(() => {
    setKind(resource?.kind ?? 'sop')
    setTitle(resource?.title ?? '')
    setCode(resource?.code ?? '')
    setSummary(resource?.summary ?? '')
    setOwnerRole(resource?.ownerRole ?? 'admin')
    setAudiences(resource?.audiences.join(', ') ?? '')
    setTags(resource?.tags.join(', ') ?? '')
    setPayloadJson(JSON.stringify(resource?.payload ?? blankPayload(resource?.kind ?? 'sop'), null, 2))
    setNote(resource ? 'Cập nhật nội dung' : 'Tạo tài liệu mới')
    setStepTitle(initialStep.title ?? '')
    setStepWhen(initialStep.when ?? '')
    setStepOwner(initialStep.owner ?? '')
    setStepGoal(initialStep.goal ?? '')
    setStepActions((initialStep.actions ?? []).join('\n'))
    setStepSay((initialStep.say ?? []).join('\n---\n'))
    setStepAvoid((initialStep.avoid ?? []).join('\n'))
    setStepCrm(initialStep.crm ?? '')
    setStepDone(initialStep.done ?? '')
    setError('')
  }, [initialStep, resource])

  function changeKind(nextKind: SopKnowledgeKind) {
    setKind(nextKind)
    setPayloadJson(JSON.stringify(blankPayload(nextKind), null, 2))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!title.trim()) {
      setError('Tên tài liệu không được để trống.')
      return
    }
    let payload: Record<string, unknown>
    try {
      const parsed = JSON.parse(payloadJson) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
      payload = parsed as Record<string, unknown>
    } catch {
      setError('Dữ liệu cấu trúc không phải JSON hợp lệ.')
      return
    }

    if (kind === 'sop' && resource) {
      const playbook = Array.isArray(payload.playbook) ? [...payload.playbook] : []
      const current = playbook[activeStep] && typeof playbook[activeStep] === 'object' ? playbook[activeStep] as Record<string, unknown> : {}
      playbook[activeStep] = {
        ...current,
        title: stepTitle,
        when: stepWhen,
        owner: stepOwner,
        goal: stepGoal,
        actions: lines(stepActions),
        say: blocks(stepSay),
        avoid: lines(stepAvoid),
        crm: stepCrm,
        done: stepDone,
      }
      payload = { ...payload, title, goal: summary, playbook }
    }

    if (kind === 'script') {
      const source = payload
      payload = {
        ...source,
        trigger: stringValue(source.trigger),
        body: stringValue(source.body),
        guidance: stringValue(source.guidance),
      }
    }

    await onSave({
      note: note.trim() || 'Cập nhật nội dung',
      resource: {
        kind,
        code: code.trim() || title.trim(),
        title: title.trim(),
        summary: summary.trim(),
        ownerRole: ownerRole.trim() || 'admin',
        audiences: audiences.split(',').map((item) => item.trim()).filter(Boolean),
        branchScope: resource?.branchScope?.length ? resource.branchScope : ['all'],
        tags: tags.split(',').map((item) => item.trim()).filter(Boolean),
        payload,
      },
    })
  }

  return <div className="sop-center-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
    <section className="sop-center-editor" role="dialog" aria-modal="true" aria-labelledby="sop-editor-title">
      <header>
        <div><span>{resource ? `Chỉnh sửa ${kindLabels[kind]}` : 'Tạo tài liệu'}</span><h2 id="sop-editor-title">{resource?.title || 'Bản nháp mới'}</h2></div>
        <button type="button" aria-label="Đóng" disabled={busy} onClick={onCancel}><X size={20} /></button>
      </header>
      <form onSubmit={submit}>
        {error && <div className="sop-center-form-error" role="alert">{error}</div>}
        <div className="sop-center-form-grid">
          <label><span>Loại tài liệu</span><select value={kind} disabled={Boolean(resource) || busy} onChange={(event) => changeKind(event.target.value as SopKnowledgeKind)}>{creatableKinds.map((item) => <option key={item} value={item}>{kindLabels[item]}</option>)}</select></label>
          <label><span>Mã tài liệu</span><input value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} placeholder="Ví dụ SOP 10" /></label>
          <label className="is-wide"><span>Tên tài liệu</span><input value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="is-wide"><span>Tóm tắt / mục tiêu</span><textarea rows={3} value={summary} disabled={busy} onChange={(event) => setSummary(event.target.value)} /></label>
          <label><span>Owner nghiệp vụ</span><input value={ownerRole} disabled={busy} onChange={(event) => setOwnerRole(event.target.value)} /></label>
          <label><span>Đối tượng (phân cách dấu phẩy)</span><input value={audiences} disabled={busy} onChange={(event) => setAudiences(event.target.value)} /></label>
          <label className="is-wide"><span>Nhãn (phân cách dấu phẩy)</span><input value={tags} disabled={busy} onChange={(event) => setTags(event.target.value)} /></label>
        </div>

        {kind === 'sop' && resource && <fieldset className="sop-center-step-editor">
          <legend>Chỉnh bước {activeStep + 1}</legend>
          <div className="sop-center-form-grid">
            <label className="is-wide"><span>Tên bước</span><input value={stepTitle} disabled={busy} onChange={(event) => setStepTitle(event.target.value)} /></label>
            <label><span>Thời điểm / SLA</span><input value={stepWhen} disabled={busy} onChange={(event) => setStepWhen(event.target.value)} /></label>
            <label><span>Người thực hiện</span><input value={stepOwner} disabled={busy} onChange={(event) => setStepOwner(event.target.value)} /></label>
            <label className="is-wide"><span>Mục tiêu bước</span><textarea rows={2} value={stepGoal} disabled={busy} onChange={(event) => setStepGoal(event.target.value)} /></label>
            <label className="is-wide"><span>Việc cần làm · mỗi dòng một ý</span><textarea rows={5} value={stepActions} disabled={busy} onChange={(event) => setStepActions(event.target.value)} /></label>
            <label className="is-wide"><span>Mẫu câu · ngăn cách các mẫu bằng một dòng ---</span><textarea rows={7} value={stepSay} disabled={busy} onChange={(event) => setStepSay(event.target.value)} /></label>
            <label className="is-wide"><span>Điều cần tránh · mỗi dòng một ý</span><textarea rows={4} value={stepAvoid} disabled={busy} onChange={(event) => setStepAvoid(event.target.value)} /></label>
            <label><span>Ghi nhận hệ thống</span><textarea rows={3} value={stepCrm} disabled={busy} onChange={(event) => setStepCrm(event.target.value)} /></label>
            <label><span>Tiêu chí hoàn thành</span><textarea rows={3} value={stepDone} disabled={busy} onChange={(event) => setStepDone(event.target.value)} /></label>
          </div>
        </fieldset>}

        <details className="sop-center-json-editor">
          <summary>Dữ liệu cấu trúc nâng cao</summary>
          <p>Dành cho quản trị viên hiểu schema. Các trường của bước đang chọn ở trên sẽ được ưu tiên khi lưu.</p>
          <textarea aria-label="Dữ liệu JSON" rows={18} value={payloadJson} disabled={busy} spellCheck={false} onChange={(event) => setPayloadJson(event.target.value)} />
        </details>

        <label className="sop-center-change-note"><span>Ghi chú thay đổi</span><input value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} /></label>
        <footer><button type="button" className="sop-center-button sop-center-button--secondary" disabled={busy} onClick={onCancel}>Hủy</button><button type="submit" className="sop-center-button sop-center-button--primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu thành bản nháp'}</button></footer>
      </form>
    </section>
  </div>
}
