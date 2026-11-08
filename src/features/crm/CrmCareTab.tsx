import { Check, RefreshCw, Search, SkipForward } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { CrmPermissions } from './CrmWorkspacePage'
import { dueLabel, formatDateTime } from './crmFormat'
import { crmErrorMessage, type CrmService } from './crmService'
import type { CrmCareAssignmentRow, CrmStep } from './crmTypes'
import { Empty, ErrorBanner, Loading, Notice, Spinner } from './crmUi'

const KIND_LABELS: Record<CrmStep['kind'], string> = {
  inbox_reply: 'Phản hồi inbox',
  student_reply: 'Học viên nhắn',
  handover: 'Bàn giao',
  manual: 'Việc cần làm',
}

export function CrmCareTab({ service, branchId, branchIds, permissions, refreshKey, onOpenCustomer, onChanged }: {
  service: CrmService
  branchId?: string
  branchIds: string[]
  permissions: CrmPermissions
  refreshKey: number
  onOpenCustomer: (customerId: string) => void
  onChanged: () => void
}) {
  const [scope, setScope] = useState<'mine' | 'branch'>('mine')
  const [status, setStatus] = useState<'open' | 'done'>('open')
  const [rows, setRows] = useState<CrmStep[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [closing, setClosing] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const page = await service.steps({ scope, status, branchId })
      setRows(page.rows)
    } catch (cause) {
      setError(crmErrorMessage(cause, 'Chưa tải được bước chăm sóc.'))
    } finally {
      setLoading(false)
    }
  }, [branchId, scope, service, status])

  useEffect(() => { void load() }, [load, refreshKey])

  const complete = async (step: CrmStep, nextStatus: 'done' | 'skipped') => {
    setBusy(step.id)
    setError('')
    try {
      await service.completeStep({ stepId: step.id, status: nextStatus, note: note.trim() || undefined })
      setRows((current) => current.filter((row) => row.id !== step.id))
      setClosing(null)
      setNote('')
      onChanged()
    } catch (cause) {
      setError(crmErrorMessage(cause, 'Chưa cập nhật được bước này.'))
    } finally {
      setBusy('')
    }
  }

  const overdue = rows.filter((row) => row.overdue).length
  const assignBranch = branchId || (branchIds.length === 1 ? branchIds[0] : '')

  return <div className="crm-care">
    <div className="crm-toolbar">
      <div className="crm-filters" role="group" aria-label="Phạm vi">
        <button type="button" aria-pressed={scope === 'mine'} className={scope === 'mine' ? 'is-active' : ''} onClick={() => setScope('mine')}>Của tôi</button>
        {permissions.branchSteps && <button type="button" aria-pressed={scope === 'branch'} className={scope === 'branch' ? 'is-active' : ''} onClick={() => setScope('branch')}>Cả chi nhánh</button>}
      </div>
      <div className="crm-filters" role="group" aria-label="Trạng thái">
        <button type="button" aria-pressed={status === 'open'} className={status === 'open' ? 'is-active' : ''} onClick={() => setStatus('open')}>Đang mở</button>
        <button type="button" aria-pressed={status === 'done'} className={status === 'done' ? 'is-active' : ''} onClick={() => setStatus('done')}>Đã xong</button>
      </div>
      {status === 'open' && overdue > 0 && <span className="crm-toolbar__summary is-late">{overdue} bước quá hạn</span>}
      <button type="button" className="crm-icon-button" onClick={() => void load()} aria-label="Làm mới bước chăm sóc" disabled={loading}>{loading ? <Spinner /> : <RefreshCw size={16} />}</button>
    </div>
    <ErrorBanner message={error} onRetry={() => void load()} />
    {loading && !rows.length ? <Loading label="Đang tải bước chăm sóc…" />
      : !rows.length ? <Empty title={status === 'open' ? 'Không còn việc đang mở' : 'Chưa có bước hoàn tất'} />
        : <ul className="crm-list">
          {rows.map((step) => <li key={step.id} className={`crm-step ${step.overdue ? 'is-overdue' : ''}`}>
            <div className="crm-step__main">
              <span className="crm-step__kind">{KIND_LABELS[step.kind]}{step.sopCode ? ` · ${step.sopCode}` : ''}</span>
              <strong>{step.title}</strong>
              <button type="button" className="crm-link" onClick={() => onOpenCustomer(step.customerId)}>{step.customerName || 'Mở hồ sơ khách'}</button>
              {step.note && <p>{step.note}</p>}
              <span className="crm-step__meta">
                {status === 'open'
                  ? <span className={step.overdue ? 'is-late' : ''}>{dueLabel(step.dueAt)}</span>
                  : <span>{step.autoClosed ? 'Tự đóng khi page trả lời' : `Xong bởi ${step.completedByName || '—'}`} · {formatDateTime(step.completedAt)}</span>}
                <span>{step.ownerName || 'Chưa giao'}</span>
                {step.escalatedAt && status === 'open' && <span className="is-late">Đã báo quản lý</span>}
              </span>
            </div>
            {status === 'open' && <div className="crm-step__actions">
              {closing === step.id ? <form className="crm-inline-form" onSubmit={(event) => { event.preventDefault(); void complete(step, 'done') }}>
                <label className="crm-sr-only" htmlFor={`step-note-${step.id}`}>Kết quả</label>
                <input id={`step-note-${step.id}`} value={note} maxLength={500} placeholder="Kết quả (không bắt buộc)" onChange={(event) => setNote(event.target.value)} autoFocus />
                <button type="submit" className="crm-button crm-button--primary" disabled={busy === step.id}>{busy === step.id ? <Spinner /> : <Check size={15} />} Xong</button>
                <button type="button" className="crm-button" onClick={() => void complete(step, 'skipped')} disabled={busy === step.id}><SkipForward size={15} /> Bỏ qua</button>
                <button type="button" className="crm-button crm-button--ghost" onClick={() => { setClosing(null); setNote('') }}>Hủy</button>
              </form> : <button type="button" className="crm-button" onClick={() => { setClosing(step.id); setNote('') }}><Check size={15} /> Hoàn tất</button>}
            </div>}
          </li>)}
        </ul>}
    {permissions.assignCare && <CareAssignment service={service} branchId={assignBranch} onChanged={onChanged} />}
  </div>
}

function CareAssignment({ service, branchId, onChanged }: { service: CrmService; branchId: string; onChanged: () => void }) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<CrmCareAssignmentRow[]>([])
  const [careStaff, setCareStaff] = useState<Array<{ uid: string; name: string }>>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [owner, setOwner] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [truncated, setTruncated] = useState(false)

  const load = useCallback(async (text = '') => {
    if (!branchId) return
    setLoading(true)
    setError('')
    try {
      const result = await service.careAssignments({ branchId, query: text || undefined })
      setRows(result.rows)
      setCareStaff(result.careStaff)
      setTruncated(result.truncated)
    } catch (cause) {
      setError(crmErrorMessage(cause, 'Chưa tải được danh sách học viên.'))
    } finally {
      setLoading(false)
    }
  }, [branchId, service])

  useEffect(() => { void load() }, [load])

  const toggle = (studentId: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(studentId)) next.delete(studentId)
    else if (next.size < 50) next.add(studentId)
    return next
  })

  const assign = async () => {
    if (!selected.size) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await service.assignCareOwner({ studentIds: [...selected], careOwnerUid: owner })
      const failed = result.results.filter((row) => !row.ok)
      setNotice(`${result.assigned} học viên đã ${owner ? `giao cho ${careStaff.find((item) => item.uid === owner)?.name || 'CSKH'}` : 'trả về PT chính chăm sóc'}.${failed.length ? ` ${failed.length} học viên chưa đổi: ${failed[0].reason}` : ''}`)
      setSelected(new Set())
      await load(query)
      onChanged()
    } catch (cause) {
      setError(crmErrorMessage(cause, 'Chưa giao được học viên.'))
    } finally {
      setSaving(false)
    }
  }

  return <section className="crm-section crm-assign" aria-labelledby="crm-assign-title">
    <header className="crm-section__head">
      <h2 id="crm-assign-title">Giao học viên cho CSKH</h2>
    </header>
    {!branchId ? <Notice>Chọn chi nhánh để giao học viên.</Notice> : <>
      <form className="crm-search" role="search" onSubmit={(event) => { event.preventDefault(); void load(query) }}>
        <Search size={16} aria-hidden="true" />
        <label className="crm-sr-only" htmlFor="crm-assign-search">Tìm học viên</label>
        <input id="crm-assign-search" value={query} placeholder="Tìm theo tên hoặc số điện thoại" onChange={(event) => setQuery(event.target.value)} />
        <button type="submit" className="crm-button">Tìm</button>
      </form>
      <ErrorBanner message={error} />
      {notice && <Notice tone="success">{notice}</Notice>}
      {loading ? <Loading label="Đang tải học viên…" /> : !rows.length ? <Empty title="Không có học viên phù hợp" /> : <ul className="crm-assign__list">
        {rows.map((row) => <li key={row.studentId}>
          <label>
            <input type="checkbox" checked={selected.has(row.studentId)} onChange={() => toggle(row.studentId)} />
            <span><strong>{row.name}</strong><small>{row.phone || 'Chưa có số'}</small></span>
            <em>{row.careOwnerName || 'PT chính'}</em>
          </label>
        </li>)}
      </ul>}
      {truncated && <p className="crm-hint">Chỉ hiện 400 học viên đầu, dùng ô tìm để lọc.</p>}
      <div className="crm-assign__bar">
        <span>{selected.size ? `Đã chọn ${selected.size}` : 'Chọn học viên'}</span>
        <label className="crm-sr-only" htmlFor="crm-assign-owner">CSKH nhận</label>
        <select id="crm-assign-owner" value={owner} onChange={(event) => setOwner(event.target.value)}>
          <option value="">PT chính (bỏ CSKH)</option>
          {careStaff.map((item) => <option key={item.uid} value={item.uid}>{item.name}</option>)}
        </select>
        <button type="button" className="crm-button crm-button--primary" disabled={!selected.size || saving} onClick={() => void assign()}>{saving ? <Spinner /> : null} Giao</button>
      </div>
      {!careStaff.length && <p className="crm-hint">Chi nhánh chưa có CSKH. Thêm vị trí CSKH ở Đội ngũ Aura.</p>}
    </>}
  </section>
}
