import { useEffect, useState } from 'react'
import { CalendarClock, CalendarOff, CheckCircle2, Save, ShieldCheck } from 'lucide-react'
import { useDatabase } from '../../../contexts/DatabaseContext'
import type { ScheduleConfig } from '../../../types'

type PolicyDraft = Required<Pick<ScheduleConfig,
  | 'complimentaryChangeCancelPerMonth'
  | 'sessionChangeDeadlineHours'
  | 'offMaxDaysPerRequest'
  | 'offRegistrationCutoffHour'
  | 'offLimitsByDuration'
>>

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

  useEffect(() => setDraft(fromConfig(scheduleConfig)), [scheduleConfig])

  const save = async () => {
    if (!canEdit) return
    setSaving(true); setError(''); setMessage('')
    try {
      await updateScheduleConfig({ ...scheduleConfig, ...draft })
      setMessage('Đã áp dụng chính sách cho các yêu cầu tạo mới.')
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
    {message && <div className="identity-message identity-message--success"><CheckCircle2 size={17} />{message}</div>}
    {error && <div className="identity-message identity-message--error">{error}</div>}
    <footer><button type="button" className="pink-orange-button" onClick={() => void save()} disabled={saving || !canEdit}><Save size={17} />{canEdit ? saving ? 'Đang lưu…' : 'Lưu chính sách' : 'Chỉ quản trị viên được sửa'}</button></footer>
  </section>
}
