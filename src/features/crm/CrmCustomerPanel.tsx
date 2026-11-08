import { CalendarClock, Check, ExternalLink, GitMerge, Link2, MessageCircle, Phone, Plus, ShieldAlert, Trash2, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ACTIVITY_LABELS,
  APPOINTMENT_KIND_LABELS,
  APPOINTMENT_STATUS_LABELS,
  CRM_STAGES,
  LOST_REASONS,
  OUTCOME_LABELS,
  STAGE_LABELS,
  dueLabel,
  durationLabel,
  formatDate,
  formatDateTime,
  formatTime,
  formatVnd,
  fromLocalInputValue,
  localInputValue,
  telHref,
  vietnamDayKey,
  zaloHref,
} from './crmFormat'
import { crmErrorMessage, isRevisionConflict, type CrmService } from './crmService'
import type {
  CrmActivityOutcome,
  CrmActivityType,
  CrmAppointmentKind,
  CrmAppointmentStatus,
  CrmCustomerDetail,
  CrmDuplicate,
  CrmLinkTarget,
  CrmLostReason,
  CrmMessage,
  CrmQuoteCandidate,
  CrmStaffMember,
  CrmStage,
} from './crmTypes'
import { Avatar, Empty, ErrorBanner, Loading, Notice, PlatformBadge, Spinner, StageChip } from './crmUi'

interface PanelProps {
  service: CrmService
  customerId: string
  isAdmin: boolean
  onClose: () => void
  onChanged: () => void
  onOpenCustomer: (customerId: string) => void
  onOpenStudent360?: (studentId: string, name: string) => void
  onOpenQuotes?: () => void
}

export function CrmCustomerPanel({ service, customerId, onClose, onChanged, onOpenCustomer, onOpenStudent360, onOpenQuotes }: PanelProps) {
  const [detail, setDetail] = useState<CrmCustomerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const closeButton = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const result = await service.customer(customerId)
      if (result.mergedInto) {
        onOpenCustomer(result.mergedInto)
        return
      }
      setDetail(result)
    } catch (cause) {
      setError(crmErrorMessage(cause, 'Chưa mở được hồ sơ khách.'))
    } finally {
      setLoading(false)
    }
  }, [customerId, onOpenCustomer, service])

  useEffect(() => { void load() }, [load])
  useEffect(() => { closeButton.current?.focus() }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Every change reloads the record so revisions and mirrors stay exact.
  const run = useCallback(async (action: () => Promise<unknown>, success: string) => {
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(success)
      await load()
      onChanged()
      return true
    } catch (cause) {
      setError(isRevisionConflict(cause) ? 'Hồ sơ vừa được người khác cập nhật. Đã tải lại, hãy thử lần nữa.' : crmErrorMessage(cause))
      if (isRevisionConflict(cause)) await load()
      return false
    }
  }, [load, onChanged])

  const customer = detail?.customer
  const access = detail?.access
  const firstPhone = customer?.phones[0]?.display || ''
  const pancakeUrl = detail?.conversations[0]?.pancakeUrl || ''

  return <div className="crm-drawer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="crm-drawer__panel" role="dialog" aria-modal="true" aria-labelledby="crm-customer-title">
      <header className="crm-drawer__head">
        <button ref={closeButton} type="button" className="crm-icon-button" onClick={onClose} aria-label="Đóng hồ sơ khách"><X size={18} /></button>
        {customer ? <div className="crm-drawer__identity">
          <Avatar name={customer.displayName} />
          <div>
            <h2 id="crm-customer-title">{customer.displayName}</h2>
            <p><PlatformBadge platform={customer.platform} /> {customer.pageName && <span>{customer.pageName}</span>} {customer.firstContactAt && <span>· nhắn lần đầu {formatDate(customer.firstContactAt)}</span>}</p>
          </div>
        </div> : <h2 id="crm-customer-title">Hồ sơ khách</h2>}
      </header>
      <div className="crm-drawer__body">
        <ErrorBanner message={error} onRetry={!detail ? () => void load() : undefined} />
        {notice && <Notice tone="success">{notice}</Notice>}
        {loading && !detail ? <Loading label="Đang mở hồ sơ…" /> : customer && access && detail && <>
          <div className="crm-summary">
            <div className="crm-summary__row"><StageChip stage={customer.stage} />{customer.lostReasonLabel && <span className="crm-muted">{customer.lostReasonLabel}{customer.lostNote ? ` · ${customer.lostNote}` : ''}</span>}</div>
            <dl>
              <div><dt>Sales phụ trách</dt><dd>{customer.ownerName || 'Chưa giao'}</dd></div>
              <div><dt>Chăm sóc sau bán</dt><dd>{customer.careOwnerName ? `${customer.careOwnerName}${customer.careOwnerKind === 'trainer' ? ' (PT chính)' : ' (CSKH)'}` : customer.studentId ? 'Chưa xác định' : '—'}</dd></div>
              <div><dt>Phản hồi đầu</dt><dd>{customer.firstResponseSeconds === null ? '—' : durationLabel(customer.firstResponseSeconds * 1000)}</dd></div>
              <div><dt>Ký hợp đồng</dt><dd>{customer.wonAt ? formatDate(customer.wonAt) : '—'}</dd></div>
            </dl>
            <div className="crm-actions">
              {firstPhone && <a className="crm-button" href={telHref(firstPhone)}><Phone size={15} /> Gọi {firstPhone}</a>}
              {firstPhone && <a className="crm-button" href={zaloHref(firstPhone)} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} /> Zalo</a>}
              {pancakeUrl && <a className="crm-button" href={pancakeUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Trả lời trên Pancake</a>}
              {customer.studentId && onOpenStudent360 && <button type="button" className="crm-button" onClick={() => onOpenStudent360(customer.studentId, customer.displayName)}><UserRound size={15} /> Học viên 360</button>}
            </div>
            {customer.suggestedPhones.length > 0 && access.manage && <SuggestedPhones detail={detail} service={service} run={run} />}
          </div>

          {access.manage && <StageEditor detail={detail} service={service} run={run} />}
          <StepsSection detail={detail} service={service} run={run} canAdd={access.manage || access.care} />
          <MessagesSection detail={detail} service={service} />
          {access.manage && <ProfileSection detail={detail} service={service} run={run} onOpenCustomer={onOpenCustomer} />}
          {access.manage && <OwnerSection detail={detail} service={service} run={run} />}
          {access.presale && <AppointmentsSection detail={detail} service={service} run={run} canEdit={access.manage} />}
          {(access.manage || access.care) && <ActivityForm detail={detail} service={service} run={run} />}
          {access.presale && access.manage && <QuotesSection detail={detail} service={service} run={run} onOpenQuotes={onOpenQuotes} />}
          {access.manage && !customer.studentId && <StudentLinkSection detail={detail} service={service} run={run} onOpenCustomer={onOpenCustomer} />}
          <TimelineSection detail={detail} />
          {access.erase && <EraseSection detail={detail} service={service} onErased={() => { onChanged(); onClose() }} />}
        </>}
      </div>
    </aside>
  </div>
}

type Run = (action: () => Promise<unknown>, success: string) => Promise<boolean>
interface SectionProps { detail: CrmCustomerDetail; service: CrmService; run: Run }

function SuggestedPhones({ detail, service, run }: SectionProps) {
  const { customer } = detail
  return <div className="crm-suggest">
    <span>Số khách nhắn trong chat:</span>
    {customer.suggestedPhones.map((phone) => <button key={phone.value} type="button" className="crm-chip-button" onClick={() => void run(
      () => service.updateProfile({ customerId: customer.id, expectedRevision: customer.revision, phones: [...customer.phones.map((item) => item.value), phone.value] }),
      `Đã lưu số ${phone.display} vào hồ sơ.`,
    )}><Plus size={13} /> Lưu {phone.display}</button>)}
  </div>
}

function StageEditor({ detail, service, run }: SectionProps) {
  const { customer } = detail
  const [stage, setStage] = useState<CrmStage>(customer.stage)
  const [lostReason, setLostReason] = useState<CrmLostReason | ''>(customer.lostReason || '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const locked = customer.stage === 'won' && Boolean(customer.studentId)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    const ok = await run(() => service.updateStage({ customerId: customer.id, expectedRevision: customer.revision, stage, lostReason: stage === 'lost' ? lostReason : '', note: note.trim() || undefined }), `Đã chuyển sang ${STAGE_LABELS[stage]}.`)
    if (ok) setNote('')
    setSaving(false)
  }
  if (locked) return <p className="crm-hint">Khách đã là học viên. Giai đoạn sau bán đi theo hợp đồng và trang Tái ký.</p>
  return <form className="crm-section crm-stage" onSubmit={(event) => void submit(event)}>
    <h3>Giai đoạn</h3>
    <div className="crm-stage__steps" role="radiogroup" aria-label="Chọn giai đoạn">
      {CRM_STAGES.filter((item) => item !== 'won').map((item) => <button key={item} type="button" role="radio" aria-checked={stage === item} className={stage === item ? 'is-active' : ''} onClick={() => setStage(item)}>{STAGE_LABELS[item]}</button>)}
    </div>
    {stage === 'lost' && <label className="crm-field"><span>Lý do mất khách</span>
      <select value={lostReason} onChange={(event) => setLostReason(event.target.value as CrmLostReason)} required>
        <option value="">Chọn lý do</option>
        {(Object.keys(LOST_REASONS) as CrmLostReason[]).map((reason) => <option key={reason} value={reason}>{LOST_REASONS[reason]}</option>)}
      </select>
    </label>}
    <label className="crm-field"><span>Ghi chú (không bắt buộc)</span><input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label>
    <p className="crm-hint">Thắng tự ghi khi hợp đồng của học viên được tạo. Thẻ trên Pancake đổi theo giai đoạn nếu admin đã gắn thẻ.</p>
    <button type="submit" className="crm-button crm-button--primary" disabled={saving || stage === customer.stage && stage !== 'lost'}>{saving ? <Spinner /> : <Check size={15} />} Lưu giai đoạn</button>
  </form>
}

function StepsSection({ detail, service, run, canAdd }: SectionProps & { canAdd: boolean }) {
  const { customer, openSteps, doneSteps } = detail
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [dueAt, setDueAt] = useState(() => localInputValue(new Date(Date.now() + 24 * 3_600_000)))
  const [busy, setBusy] = useState('')
  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    setBusy('add')
    const ok = await run(() => service.createStep({ customerId: customer.id, title: title.trim(), dueAt: fromLocalInputValue(dueAt) }), 'Đã thêm việc cần làm.')
    if (ok) { setTitle(''); setAdding(false) }
    setBusy('')
  }
  return <section className="crm-section" aria-labelledby="crm-steps-title">
    <header className="crm-section__head">
      <h3 id="crm-steps-title">Bước tiếp theo</h3>
      {canAdd && !adding && <button type="button" className="crm-button crm-button--ghost" onClick={() => setAdding(true)}><Plus size={15} /> Thêm việc</button>}
    </header>
    {adding && <form className="crm-inline-form crm-inline-form--stack" onSubmit={(event) => void add(event)}>
      <label className="crm-field"><span>Việc cần làm</span><input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} placeholder="Ví dụ: Gọi xác nhận lịch tập thử" autoFocus required /></label>
      <label className="crm-field"><span>Hạn</span><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} required /></label>
      <div className="crm-inline-form__actions">
        <button type="submit" className="crm-button crm-button--primary" disabled={busy === 'add'}>{busy === 'add' ? <Spinner /> : null} Thêm</button>
        <button type="button" className="crm-button crm-button--ghost" onClick={() => setAdding(false)}>Hủy</button>
      </div>
    </form>}
    {!openSteps.length ? <p className="crm-muted">Không có bước nào đang mở.</p> : <ul className="crm-mini-list">
      {openSteps.map((step) => <li key={step.id} className={step.overdue ? 'is-overdue' : ''}>
        <span><strong>{step.title}</strong><small className={step.overdue ? 'is-late' : ''}>{dueLabel(step.dueAt)} · {step.ownerName || 'Chưa có người nhận'}{step.sopCode ? ` · ${step.sopCode}` : ''}</small></span>
        <button type="button" className="crm-button" disabled={busy === step.id} onClick={async () => { setBusy(step.id); await run(() => service.completeStep({ stepId: step.id, status: 'done' }), 'Đã hoàn tất bước.'); setBusy('') }}>{busy === step.id ? <Spinner /> : <Check size={15} />} Xong</button>
      </li>)}
    </ul>}
    {doneSteps.length > 0 && <details className="crm-details"><summary>{doneSteps.length} bước đã xong</summary>
      <ul className="crm-mini-list">{doneSteps.map((step) => <li key={step.id}><span><strong>{step.title}</strong><small>{step.autoClosed ? 'Tự đóng khi page trả lời' : step.completedByName || '—'} · {formatDateTime(step.completedAt)}</small></span></li>)}</ul>
    </details>}
  </section>
}

function MessagesSection({ detail, service }: Omit<SectionProps, 'run'>) {
  const { customer, conversations, access } = detail
  const [key, setKey] = useState(conversations[0]?.key || '')
  const [messages, setMessages] = useState<CrmMessage[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hiddenBefore, setHiddenBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const list = useRef<HTMLOListElement>(null)

  const load = useCallback(async (more = false) => {
    if (!key) return
    setLoading(true)
    setError('')
    try {
      const page = await service.messages({ customerId: customer.id, conversationKey: key, cursor: more ? cursor : undefined })
      setMessages((current) => (more ? [...current, ...page.rows] : page.rows))
      setCursor(page.nextCursor)
      setHiddenBefore(page.hiddenBefore)
    } catch (cause) {
      setError(crmErrorMessage(cause, 'Chưa tải được tin nhắn.'))
    } finally {
      setLoading(false)
    }
  }, [cursor, customer.id, key, service])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setMessages([]); setCursor(null); void load(false) }, [key])
  useEffect(() => { if (list.current && !cursor) list.current.scrollTop = list.current.scrollHeight }, [messages, cursor])

  const ordered = useMemo(() => [...messages].reverse(), [messages])
  const wonAt = customer.wonAt ? new Date(customer.wonAt).getTime() : 0
  if (!conversations.length) return <section className="crm-section"><h3>Hội thoại</h3><p className="crm-muted">Khách chưa có hội thoại Pancake.</p></section>

  return <section className="crm-section" aria-labelledby="crm-messages-title">
    <header className="crm-section__head">
      <h3 id="crm-messages-title">Hội thoại</h3>
      {conversations.length > 1 && <label className="crm-select"><span className="crm-sr-only">Chọn hội thoại</span>
        <select value={key} onChange={(event) => setKey(event.target.value)}>
          {conversations.map((conversation) => <option key={conversation.key} value={conversation.key}>{conversation.pageName || conversation.platform} · {formatDate(conversation.lastMessageAt)}</option>)}
        </select>
      </label>}
    </header>
    {!access.presale && hiddenBefore && <p className="crm-hint">Bạn xem hội thoại từ ngày ký hợp đồng {formatDate(hiddenBefore)}. Phần tư vấn trước đó chỉ Sales và quản lý xem.</p>}
    <ErrorBanner message={error} onRetry={() => void load(false)} />
    {cursor && <button type="button" className="crm-more crm-more--top" onClick={() => void load(true)} disabled={loading}>{loading ? <Spinner /> : null} Tin cũ hơn</button>}
    {loading && !messages.length ? <Loading label="Đang tải tin nhắn…" /> : !messages.length ? <Empty title="Chưa có tin nhắn đồng bộ" /> : <ol ref={list} className="crm-messages" aria-label="Tin nhắn, cũ nhất ở trên">
      {ordered.map((message, index) => {
        const previous = ordered[index - 1]
        const at = message.sentAt ? new Date(message.sentAt).getTime() : 0
        const crossesWon = wonAt && at >= wonAt && (!previous?.sentAt || new Date(previous.sentAt).getTime() < wonAt)
        const newDay = !previous || vietnamDayKey(previous.sentAt) !== vietnamDayKey(message.sentAt)
        return <li key={message.id} className="crm-message-row">
          {crossesWon && <div className="crm-divider crm-divider--won">Ký hợp đồng · {formatDate(customer.wonAt)}</div>}
          {newDay && !crossesWon && <div className="crm-divider">{formatDate(message.sentAt)}</div>}
          <div className={`crm-message crm-message--${message.direction}`}>
            {message.text && <p>{message.text}</p>}
            {message.attachments.map((item, position) => item.url
              ? <a key={position} href={item.url} target="_blank" rel="noopener noreferrer" className="crm-attachment">{item.type === 'image' ? 'Ảnh' : item.name || item.type}</a>
              : <span key={position} className="crm-attachment">[{item.type}]</span>)}
            <time dateTime={message.sentAt || undefined}>{message.direction === 'out' && message.senderName ? `${message.senderName} · ` : ''}{formatTime(message.sentAt)}</time>
          </div>
        </li>
      })}
    </ol>}
  </section>
}

function ProfileSection({ detail, service, run, onOpenCustomer }: SectionProps & { onOpenCustomer: (id: string) => void }) {
  const { customer } = detail
  const [displayName, setDisplayName] = useState(customer.displayName)
  const [phones, setPhones] = useState(customer.phones.map((phone) => phone.display).join(', '))
  const [goal, setGoal] = useState(customer.goal)
  const [preferredSlots, setPreferredSlots] = useState(customer.preferredSlots)
  const [note, setNote] = useState(customer.note)
  const [saving, setSaving] = useState(false)
  const [duplicates, setDuplicates] = useState<CrmDuplicate[]>([])
  const [merging, setMerging] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    let found: CrmDuplicate[] = []
    await run(async () => {
      const result = await service.updateProfile({
        customerId: customer.id, expectedRevision: customer.revision, displayName: displayName.trim(),
        phones: phones.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean), goal, preferredSlots, note,
      })
      found = result.duplicates
    }, 'Đã lưu hồ sơ.')
    setDuplicates(found)
    setSaving(false)
  }
  return <details className="crm-section crm-details-section">
    <summary><h3>Hồ sơ khách</h3></summary>
    <form className="crm-form" onSubmit={(event) => void submit(event)}>
      <label className="crm-field"><span>Tên gọi</span><input value={displayName} maxLength={160} required onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label className="crm-field"><span>Số điện thoại (cách nhau bằng dấu phẩy)</span><input value={phones} inputMode="tel" onChange={(event) => setPhones(event.target.value)} placeholder="0901 234 567" /></label>
      <label className="crm-field"><span>Mục tiêu</span><input value={goal} maxLength={300} onChange={(event) => setGoal(event.target.value)} placeholder="Giảm mỡ, tăng cơ, phục hồi…" /></label>
      <label className="crm-field"><span>Khung giờ thuận tiện</span><input value={preferredSlots} maxLength={200} onChange={(event) => setPreferredSlots(event.target.value)} placeholder="Tối thứ 2-4-6" /></label>
      <label className="crm-field"><span>Ghi chú</span><textarea value={note} maxLength={1000} rows={3} onChange={(event) => setNote(event.target.value)} /></label>
      <button type="submit" className="crm-button crm-button--primary" disabled={saving}>{saving ? <Spinner /> : <Check size={15} />} Lưu hồ sơ</button>
    </form>
    {duplicates.length > 0 && <div className="crm-duplicates" role="status">
      <strong><GitMerge size={15} /> Số này đã có ở hồ sơ khác</strong>
      <ul>{duplicates.map((item) => <li key={item.id}>
        <button type="button" className="crm-link" onClick={() => onOpenCustomer(item.id)}>{item.displayName} · {STAGE_LABELS[item.stage]} · {item.phone}</button>
        <button type="button" className="crm-button" disabled={merging === item.id} onClick={async () => {
          setMerging(item.id)
          const ok = await run(() => service.merge({ sourceCustomerId: item.id, targetCustomerId: customer.id }), `Đã gộp hồ sơ ${item.displayName} vào hồ sơ này.`)
          if (ok) setDuplicates((current) => current.filter((row) => row.id !== item.id))
          setMerging('')
        }}>{merging === item.id ? <Spinner /> : <GitMerge size={15} />} Gộp vào đây</button>
      </li>)}</ul>
    </div>}
  </details>
}

function OwnerSection({ detail, service, run }: SectionProps) {
  const { customer } = detail
  const [staff, setStaff] = useState<CrmStaffMember[]>([])
  const [owner, setOwner] = useState(customer.ownerUid)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!customer.branchId) return
    let active = true
    service.staff(customer.branchId).then((result) => { if (active) setStaff(result.staff.filter((item) => item.positions.some((position) => position === 'sales' || position === 'branch_manager'))) }).catch(() => {})
    return () => { active = false }
  }, [customer.branchId, service])
  if (!customer.branchId) return null
  return <form className="crm-section crm-owner" onSubmit={async (event) => {
    event.preventDefault()
    setSaving(true)
    await run(() => service.assignOwner({ customerId: customer.id, expectedRevision: customer.revision, ownerUid: owner }), owner ? 'Đã giao khách. Pancake được phân công theo.' : 'Đã bỏ người phụ trách.')
    setSaving(false)
  }}>
    <label className="crm-field"><span>Sales phụ trách</span>
      <select value={owner} onChange={(event) => setOwner(event.target.value)}>
        <option value="">Chưa giao</option>
        {staff.map((item) => <option key={item.uid} value={item.uid}>{item.name}</option>)}
        {customer.ownerUid && !staff.some((item) => item.uid === customer.ownerUid) && <option value={customer.ownerUid}>{customer.ownerName || 'Người phụ trách hiện tại'}</option>}
      </select>
    </label>
    <button type="submit" className="crm-button" disabled={saving || owner === customer.ownerUid}>{saving ? <Spinner /> : null} Giao</button>
  </form>
}

function AppointmentsSection({ detail, service, run, canEdit }: SectionProps & { canEdit: boolean }) {
  const { customer, appointments } = detail
  const [kind, setKind] = useState<CrmAppointmentKind>('trial')
  const [startAt, setStartAt] = useState(() => localInputValue(new Date(Date.now() + 24 * 3_600_000)))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const update = async (appointmentId: string, status: CrmAppointmentStatus) => {
    setBusy(appointmentId)
    await run(() => service.updateAppointment({ appointmentId, status }), `Đã ghi: ${APPOINTMENT_STATUS_LABELS[status]}.`)
    setBusy('')
  }
  return <details className="crm-section crm-details-section" open={appointments.some((item) => item.status === 'booked')}>
    <summary><h3><CalendarClock size={16} aria-hidden="true" /> Lịch hẹn {appointments.length ? `(${appointments.length})` : ''}</h3></summary>
    {appointments.length > 0 && <ul className="crm-mini-list">
      {appointments.map((item) => <li key={item.id}>
        <span><strong>{APPOINTMENT_KIND_LABELS[item.kind]} · {formatDateTime(item.startAt)}</strong><small>{APPOINTMENT_STATUS_LABELS[item.status]}{item.note ? ` · ${item.note}` : ''}</small></span>
        {canEdit && item.status === 'booked' && <span className="crm-mini-list__actions">
          <button type="button" className="crm-button" disabled={busy === item.id} onClick={() => void update(item.id, 'attended')}>Đã đến</button>
          <button type="button" className="crm-button" disabled={busy === item.id} onClick={() => void update(item.id, 'no_show')}>Không đến</button>
          <button type="button" className="crm-button crm-button--ghost" disabled={busy === item.id} onClick={() => void update(item.id, 'cancelled')}>Hủy</button>
        </span>}
      </li>)}
    </ul>}
    {canEdit && <form className="crm-form crm-form--grid" onSubmit={async (event) => {
      event.preventDefault()
      setBusy('new')
      const ok = await run(() => service.createAppointment({ customerId: customer.id, kind, startAt: fromLocalInputValue(startAt), note: note.trim() || undefined }), 'Đã đặt lịch hẹn và nhắc trước 1 ngày.')
      if (ok) setNote('')
      setBusy('')
    }}>
      <label className="crm-field"><span>Loại hẹn</span><select value={kind} onChange={(event) => setKind(event.target.value as CrmAppointmentKind)}>
        {(Object.keys(APPOINTMENT_KIND_LABELS) as CrmAppointmentKind[]).map((item) => <option key={item} value={item}>{APPOINTMENT_KIND_LABELS[item]}</option>)}
      </select></label>
      <label className="crm-field"><span>Thời gian</span><input type="datetime-local" value={startAt} required onChange={(event) => setStartAt(event.target.value)} /></label>
      <label className="crm-field crm-field--wide"><span>Ghi chú</span><input value={note} maxLength={500} placeholder="PT đón, mang giày…" onChange={(event) => setNote(event.target.value)} /></label>
      <button type="submit" className="crm-button crm-button--primary" disabled={busy === 'new'}>{busy === 'new' ? <Spinner /> : <Plus size={15} />} Đặt lịch</button>
    </form>}
  </details>
}

function ActivityForm({ detail, service, run }: SectionProps) {
  const [type, setType] = useState<CrmActivityType>('call')
  const [outcome, setOutcome] = useState<CrmActivityOutcome | ''>('connected')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  return <form className="crm-section crm-form crm-form--grid" onSubmit={async (event) => {
    event.preventDefault()
    setSaving(true)
    const ok = await run(() => service.recordActivity({ customerId: detail.customer.id, type, outcome: type === 'note' ? '' : outcome, note: note.trim() }), 'Đã ghi nhận.')
    if (ok) setNote('')
    setSaving(false)
  }}>
    <h3 className="crm-field--wide">Ghi nhận liên hệ</h3>
    <label className="crm-field"><span>Loại</span><select value={type} onChange={(event) => setType(event.target.value as CrmActivityType)}>
      {(['call', 'zalo', 'meeting', 'note'] as CrmActivityType[]).map((item) => <option key={item} value={item}>{ACTIVITY_LABELS[item]}</option>)}
    </select></label>
    {type !== 'note' && <label className="crm-field"><span>Kết quả</span><select value={outcome} onChange={(event) => setOutcome(event.target.value as CrmActivityOutcome)}>
      {(Object.keys(OUTCOME_LABELS) as CrmActivityOutcome[]).map((item) => <option key={item} value={item}>{OUTCOME_LABELS[item]}</option>)}
    </select></label>}
    <label className="crm-field crm-field--wide"><span>Ghi chú</span><input value={note} maxLength={1000} required={type === 'note'} minLength={type === 'note' ? 2 : undefined} onChange={(event) => setNote(event.target.value)} /></label>
    <button type="submit" className="crm-button" disabled={saving}>{saving ? <Spinner /> : <Check size={15} />} Ghi nhận</button>
  </form>
}

function QuotesSection({ detail, service, run, onOpenQuotes }: SectionProps & { onOpenQuotes?: () => void }) {
  const { customer, quotes } = detail
  const [candidates, setCandidates] = useState<CrmQuoteCandidate[] | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')
  const find = async () => {
    setBusy('find')
    try {
      const result = await service.quoteCandidates(customer.id)
      setCandidates(result.rows)
      setReason(result.reason || '')
    } catch (cause) {
      setReason(crmErrorMessage(cause, 'Chưa tìm được báo giá.'))
    } finally {
      setBusy('')
    }
  }
  return <details className="crm-section crm-details-section">
    <summary><h3>Báo giá {quotes.length ? `(${quotes.length})` : ''}</h3></summary>
    {quotes.length > 0 && <ul className="crm-mini-list">{quotes.map((quote) => <li key={quote.id}><span><strong>{quote.code} · {quote.packageName}</strong><small>{formatVnd(quote.finalPrice)} · {quote.status}</small></span></li>)}</ul>}
    <div className="crm-actions">
      {onOpenQuotes && <button type="button" className="crm-button" onClick={onOpenQuotes}><ExternalLink size={15} /> Tạo báo giá</button>}
      <button type="button" className="crm-button" onClick={() => void find()} disabled={busy === 'find'}>{busy === 'find' ? <Spinner /> : <Link2 size={15} />} Gắn báo giá đã tạo</button>
    </div>
    {reason && <p className="crm-hint">{reason}</p>}
    {candidates && !candidates.length && !reason && <p className="crm-hint">Chưa có báo giá nào theo số điện thoại của khách.</p>}
    {candidates && candidates.length > 0 && <ul className="crm-mini-list">{candidates.map((quote) => <li key={quote.id}>
      <span><strong>{quote.code} · {quote.packageName}</strong><small>{quote.customerName} · {formatVnd(quote.finalPrice)}</small></span>
      {quote.linked ? <span className="crm-muted">Đã gắn</span> : <button type="button" className="crm-button" disabled={busy === quote.id} onClick={async () => { setBusy(quote.id); await run(() => service.linkQuote({ customerId: customer.id, quoteId: quote.id }), `Đã gắn báo giá ${quote.code}.`); setBusy('') }}>Gắn</button>}
    </li>)}</ul>}
  </details>
}

function StudentLinkSection({ detail, service, run, onOpenCustomer }: SectionProps & { onOpenCustomer: (id: string) => void }) {
  const { customer } = detail
  const [query, setQuery] = useState(customer.phones[0]?.display || '')
  const [rows, setRows] = useState<CrmLinkTarget[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  return <details className="crm-section crm-details-section">
    <summary><h3>Nối hồ sơ học viên</h3></summary>
    <p className="crm-hint">Dùng khi khách đã ký trước khi có CRM. Hợp đồng mới tự nối nếu số điện thoại trùng.</p>
    <form className="crm-search" onSubmit={async (event) => {
      event.preventDefault()
      setBusy('find')
      setError('')
      try { setRows((await service.linkTargets(query)).rows) } catch (cause) { setError(crmErrorMessage(cause, 'Chưa tìm được học viên.')) } finally { setBusy('') }
    }}>
      <label className="crm-sr-only" htmlFor="crm-link-search">Tìm học viên</label>
      <input id="crm-link-search" value={query} required onChange={(event) => setQuery(event.target.value)} placeholder="Số điện thoại, tên hoặc mã học viên" />
      <button type="submit" className="crm-button" disabled={busy === 'find'}>{busy === 'find' ? <Spinner /> : null} Tìm</button>
    </form>
    <ErrorBanner message={error} />
    {rows && !rows.length && <p className="crm-hint">Không thấy học viên phù hợp trong chi nhánh của bạn.</p>}
    {rows && rows.length > 0 && <ul className="crm-mini-list">{rows.map((row) => <li key={row.studentId}>
      <span><strong>{row.name}</strong><small>{row.phone || 'Chưa có số'}</small></span>
      {row.linkedCustomerId
        ? <button type="button" className="crm-link" onClick={() => onOpenCustomer(row.linkedCustomerId)}>Đã nối hồ sơ khác · mở</button>
        : <button type="button" className="crm-button" disabled={busy === row.studentId} onClick={async () => { setBusy(row.studentId); await run(() => service.linkStudent({ customerId: customer.id, expectedRevision: customer.revision, studentId: row.studentId }), `Đã nối với học viên ${row.name}.`); setBusy('') }}>Nối</button>}
    </li>)}</ul>}
  </details>
}

function TimelineSection({ detail }: { detail: CrmCustomerDetail }) {
  if (!detail.activities.length) return null
  return <details className="crm-section crm-details-section">
    <summary><h3>Dòng thời gian ({detail.activities.length})</h3></summary>
    <ol className="crm-timeline">{detail.activities.map((item) => {
      const toStage = typeof item.data.toStage === 'string' ? item.data.toStage as CrmStage : null
      const label = ACTIVITY_LABELS[item.type as keyof typeof ACTIVITY_LABELS] || 'Hoạt động'
      return <li key={item.id}>
        <time>{formatDateTime(item.createdAt)}</time>
        <strong>{label}{toStage && STAGE_LABELS[toStage] ? ` → ${STAGE_LABELS[toStage]}` : ''}{item.outcome && OUTCOME_LABELS[item.outcome as CrmActivityOutcome] ? ` · ${OUTCOME_LABELS[item.outcome as CrmActivityOutcome]}` : ''}</strong>
        {item.note && <p>{item.note}</p>}
        <small>{item.actorName}</small>
      </li>
    })}</ol>
  </details>
}

function EraseSection({ detail, service, onErased }: { detail: CrmCustomerDetail; service: CrmService; onErased: () => void }) {
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <details className="crm-section crm-details-section crm-danger">
    <summary><h3><ShieldAlert size={16} aria-hidden="true" /> Xóa dữ liệu theo yêu cầu khách</h3></summary>
    <p>Xóa vĩnh viễn hồ sơ, toàn bộ tin nhắn đã đồng bộ, bước chăm sóc và lịch hẹn của khách này trong Aura. Không thể hoàn tác. Dữ liệu trên Pancake không bị xóa.</p>
    <form className="crm-inline-form" onSubmit={async (event) => {
      event.preventDefault()
      setBusy(true)
      setError('')
      try {
        await service.erase({ customerId: detail.customer.id, confirmation })
        onErased()
      } catch (cause) {
        setError(crmErrorMessage(cause, 'Chưa xóa được dữ liệu.'))
      } finally {
        setBusy(false)
      }
    }}>
      <label className="crm-sr-only" htmlFor="crm-erase-confirm">Nhập XOA để xác nhận</label>
      <input id="crm-erase-confirm" value={confirmation} placeholder="Nhập XOA để xác nhận" onChange={(event) => setConfirmation(event.target.value)} />
      <button type="submit" className="crm-button crm-button--danger" disabled={confirmation !== 'XOA' || busy}>{busy ? <Spinner /> : <Trash2 size={15} />} Xóa vĩnh viễn</button>
    </form>
    <ErrorBanner message={error} />
  </details>
}
