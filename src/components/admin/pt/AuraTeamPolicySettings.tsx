import { useEffect, useRef, useState } from 'react'
import { CalendarClock, CalendarOff, CalendarRange, CheckCircle2, Plus, Save, ShieldCheck, Trash2 } from 'lucide-react'
import { useDatabase } from '../../../contexts/DatabaseContext'
import type { ScheduleConfig, ScheduleHoliday } from '../../../types'
import { ptOperationsPolicyFromConfig, type PtOperationsPolicyDraft } from '../../../config/ptOperationsPolicy'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const WEEKDAY_OPTIONS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

function normalizedHolidayDetails(config: ScheduleConfig): ScheduleHoliday[] {
  const detailsByDate = new Map<string, ScheduleHoliday>()
  if (Array.isArray(config.holidayDetails)) {
    config.holidayDetails.forEach((holiday) => {
      const date = typeof holiday?.date === 'string' ? holiday.date.slice(0, 10) : ''
      const name = typeof holiday?.name === 'string' ? holiday.name.trim().replace(/\s+/g, ' ') : ''
      if (DATE_PATTERN.test(date) && name.length >= 2) detailsByDate.set(date, { date, name, paid: true })
    })
  }
  if (Array.isArray(config.holidays)) {
    config.holidays.forEach((value) => {
      const date = typeof value === 'string' ? value.slice(0, 10) : ''
      if (DATE_PATTERN.test(date) && !detailsByDate.has(date)) {
        detailsByDate.set(date, { date, name: 'Ngày nghỉ lễ', paid: true })
      }
    })
  }
  return [...detailsByDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

export default function AuraTeamPolicySettings({ canEdit = false }: { canEdit?: boolean }) {
  const { scheduleConfig, updateScheduleConfig } = useDatabase()
  const [draft, setDraft] = useState<PtOperationsPolicyDraft>(() => ptOperationsPolicyFromConfig(scheduleConfig))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [holidayDetails, setHolidayDetails] = useState<ScheduleHoliday[]>(() => normalizedHolidayDetails(scheduleConfig))
  const [holidayDate, setHolidayDate] = useState('')
  const [holidayName, setHolidayName] = useState('')
  const pendingRef = useRef(false)

  useEffect(() => {
    setDraft(ptOperationsPolicyFromConfig(scheduleConfig))
    setHolidayDetails(normalizedHolidayDetails(scheduleConfig))
  }, [scheduleConfig])

  const addHoliday = () => {
    setError(''); setMessage('')
    const date = holidayDate.trim()
    const name = holidayName.trim().replace(/\s+/g, ' ')
    if (!DATE_PATTERN.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) {
      setError('Vui lòng chọn ngày lễ hợp lệ.'); return
    }
    if (name.length < 2) {
      setError('Tên ngày lễ cần có ít nhất 2 ký tự.'); return
    }
    if (holidayDetails.some((holiday) => holiday.date === date)) {
      setError('Ngày này đã có trong chính sách nghỉ lễ.'); return
    }
    if (holidayDetails.length >= 100) {
      setError('Chính sách chỉ lưu tối đa 100 ngày lễ.'); return
    }
    setHolidayDetails((current) => [...current, { date, name: name.slice(0, 100), paid: true as const }].sort((left, right) => left.date.localeCompare(right.date)))
    setHolidayDate(''); setHolidayName('')
  }

  const removeHoliday = (date: string) => {
    setError(''); setMessage('')
    setHolidayDetails((current) => current.filter((holiday) => holiday.date !== date))
  }

  const save = async () => {
    if (!canEdit || pendingRef.current) return
    pendingRef.current = true
    setSaving(true); setError(''); setMessage('')
    try {
      await updateScheduleConfig({
        ...scheduleConfig,
        ...draft,
        holidays: holidayDetails.map((holiday) => holiday.date),
        holidayDetails,
      })
      setMessage('Đã áp dụng chính sách, khóa xếp lịch ngày lễ và đồng bộ sang bảng công.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể lưu chính sách Aura.')
    } finally {
      pendingRef.current = false
      setSaving(false)
    }
  }

  return <section className="aura-team-policy">
    <header><span><ShieldCheck size={22} /></span><div><small>AURA · QUY ĐỊNH VẬN HÀNH</small><h2>Chính sách lịch & OFF</h2><p>Mỗi yêu cầu lưu bản chụp chính sách đang hiệu lực. Các giá trị có thể điều chỉnh mà không cần sửa hoặc triển khai lại code.</p>{scheduleConfig.operationsPolicy && <p className="aura-team-policy__version">Đang áp dụng {scheduleConfig.operationsPolicy.version} · hiệu lực {scheduleConfig.operationsPolicy.effectiveFrom.split('-').reverse().join('/')} · mã {scheduleConfig.operationsPolicy.hash.slice(0, 10)}</p>}</div></header>
    <div className="aura-team-policy__grid">
      <article><div><CalendarClock /><span><strong>Đổi / hủy ca</strong><small>Hạn mức miễn tính buổi dùng chung cho cả đổi và hủy.</small></span></div><label><span>Số lượt miễn / tháng</span><input type="number" min={0} max={12} value={draft.complimentaryChangeCancelPerMonth} onChange={(event) => setDraft((current) => ({ ...current, complimentaryChangeCancelPerMonth: Math.max(0, Math.min(12, Math.trunc(Number(event.target.value) || 0))) }))} /></label><label><span>Gửi trước buổi tập (giờ)</span><input type="number" min={1} max={168} value={draft.sessionChangeDeadlineHours} onChange={(event) => setDraft((current) => ({ ...current, sessionChangeDeadlineHours: Math.max(1, Math.min(168, Math.trunc(Number(event.target.value) || 1))) }))} /></label></article>
      <article><div><CalendarOff /><span><strong>OFF hợp đồng</strong><small>OFF ngắn hơn ngưỡng được cộng ngày; dài hơn chuyển bảo lưu.</small></span></div><label><span>Tối đa mỗi lần (ngày)</span><input type="number" min={1} max={90} value={draft.offMaxDaysPerRequest} onChange={(event) => setDraft((current) => ({ ...current, offMaxDaysPerRequest: Math.max(1, Math.min(90, Math.trunc(Number(event.target.value) || 1))) }))} /></label><label><span>Giờ chốt Chủ nhật</span><input type="number" min={0} max={23} value={draft.offRegistrationCutoffHour} onChange={(event) => setDraft((current) => ({ ...current, offRegistrationCutoffHour: Math.max(0, Math.min(23, Math.trunc(Number(event.target.value) || 0))) }))} /></label></article>
      <article><div><CalendarRange /><span><strong>Khóa lịch rảnh tuần</strong><small>Áp dụng cho cả học viên và PT trước tuần cần xếp.</small></span></div><label><span>Ngày khóa</span><select value={draft.availabilityRegistrationCutoffDayOfWeek} onChange={(event) => setDraft((current) => ({ ...current, availabilityRegistrationCutoffDayOfWeek: Number(event.target.value) }))}>{WEEKDAY_OPTIONS.map((label, day) => <option key={label} value={day}>{label}</option>)}</select></label><label><span>Giờ khóa</span><input type="number" min={0} max={23} value={draft.availabilityRegistrationCutoffHour} onChange={(event) => setDraft((current) => ({ ...current, availabilityRegistrationCutoffHour: Math.max(0, Math.min(23, Math.trunc(Number(event.target.value) || 0))) }))} /></label></article>
    </div>
    <div className="aura-team-policy__allowances"><strong>Số lượt OFF theo thời hạn hợp đồng</strong>{([['threeMonths','Gói 3 tháng'],['sixMonths','Gói 6 tháng'],['twelveMonths','Gói 12 tháng']] as const).map(([key,label]) => <label key={key}><span>{label}</span><input type="number" min={0} max={48} value={draft.offLimitsByDuration[key]} onChange={(event) => setDraft((current) => ({ ...current, offLimitsByDuration: { ...current.offLimitsByDuration, [key]: Math.max(0, Math.min(48, Number(event.target.value) || 0)) } }))} /><small>lượt</small></label>)}</div>
    <article className="aura-team-policy__holidays">
      <div className="aura-team-policy__holidays-heading"><span><CalendarRange /></span><div><strong>Ngày lễ nghỉ có lương</strong><small>Nhân viên không bị trừ lương, học viên được OFF và hệ thống không xếp ca tập vào các ngày này.</small></div></div>
      <div className="aura-team-policy__holiday-form">
        <label><span>Ngày nghỉ</span><input type="date" value={holidayDate} disabled={!canEdit} onChange={(event) => setHolidayDate(event.target.value)} /></label>
        <label><span>Tên ngày lễ</span><input type="text" value={holidayName} disabled={!canEdit} maxLength={100} placeholder="Ví dụ: Quốc khánh" onChange={(event) => setHolidayName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addHoliday() } }} /></label>
        <button type="button" onClick={addHoliday} disabled={!canEdit || !holidayDate || holidayName.trim().length < 2}><Plus size={17} />Thêm ngày lễ</button>
      </div>
      {holidayDetails.length ? <div className="aura-team-policy__holiday-list">{holidayDetails.map((holiday) => <div key={holiday.date}><span><strong>{holiday.name}</strong><small>{holiday.date.split('-').reverse().join('/')} · Nghỉ có lương</small></span><button type="button" disabled={!canEdit} aria-label={`Xóa ${holiday.name}`} onClick={() => removeHoliday(holiday.date)}><Trash2 size={16} /></button></div>)}</div> : <div className="aura-team-policy__holiday-empty"><CalendarOff size={18} />Chưa có ngày lễ nào được cấu hình.</div>}
    </article>
    {message && <div className="identity-message identity-message--success"><CheckCircle2 size={17} />{message}</div>}
    {error && <div className="identity-message identity-message--error">{error}</div>}
    <footer><button type="button" className="pink-orange-button" onClick={() => void save()} disabled={saving || !canEdit}><Save size={17} />{canEdit ? saving ? 'Đang lưu…' : 'Lưu chính sách' : 'Chỉ quản trị viên được sửa'}</button></footer>
  </section>
}
