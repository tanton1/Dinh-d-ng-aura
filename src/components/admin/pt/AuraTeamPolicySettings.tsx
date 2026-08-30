import { useEffect, useState } from 'react'
import { CalendarClock, CalendarOff, CalendarRange, CheckCircle2, Plus, Save, ShieldCheck, Trash2 } from 'lucide-react'
import { useDatabase } from '../../../contexts/DatabaseContext'
import type { ScheduleConfig, ScheduleHoliday } from '../../../types'

type PolicyDraft = Required<Pick<ScheduleConfig,
  | 'complimentaryChangeCancelPerMonth'
  | 'sessionChangeDeadlineHours'
  | 'offMaxDaysPerRequest'
  | 'offRegistrationCutoffHour'
  | 'offLimitsByDuration'
>>

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

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

function fromConfig(config: ScheduleConfig): PolicyDraft {
  return {
    complimentaryChangeCancelPerMonth: config.complimentaryChangeCancelPerMonth === 2 ? 2 : 1,
    sessionChangeDeadlineHours: Number(config.sessionChangeDeadlineHours || 12),
    offMaxDaysPerRequest: Number(config.offMaxDaysPerRequest || 14),
    offRegistrationCutoffHour: Number(config.offRegistrationCutoffHour ?? 10),
    offLimitsByDuration: {
      threeMonths: Number(config.offLimitsByDuration?.threeMonths ?? 1),
      sixMonths: Number(config.offLimitsByDuration?.sixMonths ?? 3),
      twelveMonths: Number(config.offLimitsByDuration?.twelveMonths ?? 6),
    },
  }
}

export default function AuraTeamPolicySettings({ canEdit = false }: { canEdit?: boolean }) {
  const { scheduleConfig, updateScheduleConfig } = useDatabase()
  const [draft, setDraft] = useState<PolicyDraft>(() => fromConfig(scheduleConfig))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [holidayDetails, setHolidayDetails] = useState<ScheduleHoliday[]>(() => normalizedHolidayDetails(scheduleConfig))
  const [holidayDate, setHolidayDate] = useState('')
  const [holidayName, setHolidayName] = useState('')

  useEffect(() => {
    setDraft(fromConfig(scheduleConfig))
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
    if (!canEdit) return
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
      setSaving(false)
    }
  }

  return <section className="aura-team-policy">
    <header><span><ShieldCheck size={22} /></span><div><small>AURA · QUY ĐỊNH VẬN HÀNH</small><h2>Chính sách lịch & OFF</h2><p>Mỗi yêu cầu sẽ lưu một bản chụp chính sách để quản lý duyệt đúng quy định tại thời điểm khách gửi.</p></div></header>
    <div className="aura-team-policy__grid">
      <article><div><CalendarClock /><span><strong>Đổi / hủy ca</strong><small>Hạn mức miễn tính buổi dùng chung cho cả đổi và hủy.</small></span></div><label><span>Số lượt miễn / tháng</span><select value={draft.complimentaryChangeCancelPerMonth} onChange={(event) => setDraft((current) => ({ ...current, complimentaryChangeCancelPerMonth: Number(event.target.value) === 2 ? 2 : 1 }))}><option value={1}>1 lượt / tháng</option><option value={2}>2 lượt / tháng</option></select></label><label><span>Gửi trước buổi tập</span><select value={draft.sessionChangeDeadlineHours} onChange={(event) => setDraft((current) => ({ ...current, sessionChangeDeadlineHours: Number(event.target.value) }))}><option value={12}>12 giờ</option><option value={24}>24 giờ</option><option value={48}>48 giờ</option></select></label></article>
      <article><div><CalendarOff /><span><strong>OFF hợp đồng</strong><small>OFF ngắn hơn ngưỡng được cộng ngày; dài hơn chuyển bảo lưu.</small></span></div><label><span>Tối đa mỗi lần</span><select value={draft.offMaxDaysPerRequest} onChange={(event) => setDraft((current) => ({ ...current, offMaxDaysPerRequest: Number(event.target.value) }))}><option value={7}>7 ngày</option><option value={14}>14 ngày</option><option value={21}>21 ngày</option></select></label><label><span>Hạn đăng ký Chủ nhật</span><select value={draft.offRegistrationCutoffHour} onChange={(event) => setDraft((current) => ({ ...current, offRegistrationCutoffHour: Number(event.target.value) }))}>{[8,9,10,11,12].map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label></article>
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
