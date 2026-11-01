import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import AvailabilityMatrix from '../../components/schedule/AvailabilityMatrix'
import { getMyTrainerAvailability, saveMyTrainerAvailability, getPtTrainerAvailability, savePtTrainerAvailability, type TrainerAvailabilityWorkspace } from '../../services/ptOperationsV2Service'
import './TrainerAvailabilityPage.css'

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })

function dateKey(date = new Date()) { return dateFormatter.format(date) }
function addDays(value: string, amount: number) { return dateKey(new Date(Date.parse(`${value}T12:00:00+07:00`) + amount * 86400000)) }
function mondayOf(value: string) {
  const weekday = new Date(`${value}T12:00:00+07:00`).getUTCDay()
  return addDays(value, -((weekday + 6) % 7))
}
function currentWeek() { return mondayOf(dateKey()) }
function weekLabel(weekId: string) {
  const end = addDays(weekId, 6)
  return `${weekId.slice(8, 10)}/${weekId.slice(5, 7)} – ${end.slice(8, 10)}/${end.slice(5, 7)}`
}
function updatedLabel(value: string | null) {
  if (!value) return 'Chưa lưu lần nào'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Đã lưu' : `Đã lưu ${date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`
}

function cutoffLabel(value: string | null) {
  if (!value) return 'thời hạn đăng ký của tuần'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'thời hạn đăng ký của tuần'
    : new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }).format(date)
}

interface Props {
  embedded?: boolean
  isDemo?: boolean
  trainerUid?: string
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
  onDirtyChange?: (dirty: boolean) => void
}

export default function TrainerAvailabilityPage({ embedded = false, isDemo = false, trainerUid, disabled = false, onBusyChange, onDirtyChange }: Props) {
  const [mode, setMode] = useState<'weekly' | 'recurring'>('weekly')
  const [weekId, setWeekId] = useState(() => addDays(currentWeek(), 7))
  const loadScope = `${trainerUid || 'self'}:${isDemo}:${mode}:${weekId}`
  const [loadedData, setLoadedData] = useState<{ scope: string; value: TrainerAvailabilityWorkspace } | null>(null)
  const data = loadedData?.scope === loadScope ? loadedData.value : null
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [offDates, setOffDates] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const loadedRef = useRef('')
  const requestRef = useRef(0)
  const currentLoadScopeRef = useRef(loadScope)
  currentLoadScopeRef.current = loadScope

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    const isCurrent = () => requestId === requestRef.current && currentLoadScopeRef.current === loadScope
    if (loadedRef.current === loadScope) setRefreshing(true)
    else setLoading(true)
    setError(''); setNotice('')
    if (isDemo) {
      const weekly = mode === 'weekly'
      const result: TrainerAvailabilityWorkspace = {
        schemaVersion: 2,
        trainerId: 'demo-staff', trainerName: 'Huấn luyện viên Aura', branchId: 'branch-demo',
        availableSlots: ['T2-6', 'T2-7', 'T3-18', 'T4-18', 'T5-7', 'T6-18', 'T7-8'],
        baseAvailableSlots: ['T2-6', 'T2-7', 'T3-18', 'T4-18', 'T5-7', 'T6-18', 'T7-8'],
        weekId: weekly ? weekId : null, weeklyOverride: weekly, offDates: [], locked: false, canManage: Boolean(trainerUid),
        // Keep the preview on the same noon Sunday boundary as the runtime
        // policy. The old 14-hour offset represented the historical 10:00
        // fallback and made demo/preview behavior disagree with production.
        cutoffAt: weekly ? new Date(Date.parse(`${weekId}T00:00:00+07:00`) - 12 * 60 * 60 * 1000).toISOString() : null,
        source: weekly ? 'weekly' : 'recurring', sourceWeekId: weekly ? weekId : null, updatedAt: new Date().toISOString(),
        availabilityMode: 'configured', availabilityRevision: 3,
        scheduleConfig: { workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'], workingHours: [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20] },
      }
      setLoadedData({ scope: loadScope, value: result }); setSelected(new Set(result.availableSlots)); setOffDates(new Set()); setLoading(false); setRefreshing(false); loadedRef.current = loadScope; return
    }
    try {
      const result = trainerUid
        ? await getPtTrainerAvailability(trainerUid, mode === 'weekly' ? weekId : undefined)
        : await getMyTrainerAvailability(mode === 'weekly' ? weekId : undefined)
      if (!isCurrent()) return
      setLoadedData({ scope: loadScope, value: result }); setSelected(new Set(result.availableSlots)); setOffDates(new Set(result.offDates || []))
    } catch (cause) {
      if (!isCurrent()) return
      setError(cause instanceof Error ? cause.message : 'Không thể tải lịch rảnh của PT.')
    } finally {
      if (isCurrent()) { loadedRef.current = loadScope; setLoading(false); setRefreshing(false) }
    }
  }, [isDemo, loadScope, mode, trainerUid, weekId])

  useEffect(() => { void load(); return () => { requestRef.current += 1 } }, [load])

  const original = useMemo(() => `${[...(data?.availableSlots || [])].sort().join('|')}::${[...(data?.offDates || [])].sort().join('|')}`, [data])
  const current = useMemo(() => `${[...selected].sort().join('|')}::${[...offDates].sort().join('|')}`, [offDates, selected])
  const dirty = Boolean(data) && original !== current
  const canSave = dirty || (mode === 'weekly' && data?.weeklyOverride === false)
  const emptySelectionBlocked = selected.size === 0 && offDates.size === 0 && !(trainerUid && mode === 'recurring')
  const blocked = disabled || saving || loading || refreshing || Boolean(data?.locked && !data.canManage)
  const weekDays = useMemo(() => (data?.scheduleConfig.workingDays || []).map((day) => ({ day, date: addDays(weekId, day === 'CN' ? 6 : Number(day.slice(1)) - 2) })), [data?.scheduleConfig.workingDays, weekId])
  const offDays = useMemo(() => new Set(weekDays.filter(({ date }) => offDates.has(date)).map(({ day }) => day)), [offDates, weekDays])
  useEffect(() => { onBusyChange?.(saving); return () => onBusyChange?.(false) }, [onBusyChange, saving])
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false) }, [dirty, onDirtyChange])
  // Returning from another workspace must see edits by PT/admin. Never replace
  // an unsaved local selection in the background.
  useEffect(() => {
    const refresh = () => { if (!dirty && !saving && !disabled && document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [dirty, disabled, load, saving])

  const toggleOff = (day: string, date: string) => {
    if (blocked || mode !== 'weekly') return
    const baseAvailableSlots = data?.baseAvailableSlots || []
    setOffDates((currentDates) => {
      const next = new Set(currentDates)
      if (next.has(date)) {
        next.delete(date)
        setSelected((currentSlots) => new Set([...currentSlots, ...baseAvailableSlots.filter((slot) => slot.startsWith(`${day}-`))]))
      } else {
        next.add(date)
        setSelected((currentSlots) => new Set([...currentSlots].filter((slot) => !slot.startsWith(`${day}-`))))
      }
      return next
    })
  }

  const save = async () => {
    if (!data || !canSave || blocked) return
    const requestId = requestRef.current
    const isCurrent = () => requestId === requestRef.current && currentLoadScopeRef.current === loadScope
    setSaving(true); setError(''); setNotice('')
    if (isDemo) {
      const availableSlots = [...selected]
      setLoadedData({ scope: loadScope, value: { ...data, availableSlots, baseAvailableSlots: mode === 'recurring' ? availableSlots : data.baseAvailableSlots, offDates: [...offDates], weeklyOverride: mode === 'weekly', source: mode, sourceWeekId: mode === 'weekly' ? weekId : null, availabilityMode: availableSlots.length ? 'configured' : 'unconfigured', availabilityRevision: data.availabilityRevision + 1, updatedAt: new Date().toISOString() } })
      setNotice('Đã cập nhật lịch rảnh trong bản xem trước.')
      setSaving(false); return
    }
    try {
      const input = { weekId: mode === 'weekly' ? weekId : undefined, availableSlots: [...selected], offDates: mode === 'weekly' ? [...offDates] : [], expectedRevision: data.availabilityRevision }
      const result = trainerUid ? await savePtTrainerAvailability({ ...input, trainerUid }) : await saveMyTrainerAvailability(input)
      if (!isCurrent()) return
      setLoadedData({ scope: loadScope, value: { ...data, ...result } }); setSelected(new Set(result.availableSlots)); setOffDates(new Set(result.offDates || []))
      setNotice(mode === 'weekly' ? `Đã lưu lịch tuần ${weekLabel(weekId)}.` : 'Đã lưu lịch lặp lại.')
    } catch (cause) {
      if (!isCurrent()) return
      setError(cause instanceof Error ? cause.message : 'Chưa thể lưu lịch rảnh.')
    } finally { if (isCurrent()) setSaving(false) }
  }

  return <main className={`trainer-availability-page${embedded ? ' is-embedded' : ''}`}>
    {!embedded && <section className="trainer-availability-hero"><div><small>AURA STAFF · THỜI GIAN LÀM VIỆC</small><h1>Lịch rảnh của tôi</h1><p>Chọn tuần, kiểm tra giờ rảnh và lưu đăng ký.</p></div><span><CalendarClock /></span><button type="button" className={`is-${data?.availabilityMode || 'unconfigured'}`} onClick={() => document.querySelector('.availability-matrix')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{loading ? 'Đang tải lịch' : mode === 'weekly' ? data?.weeklyOverride ? 'Đã đăng ký tuần này' : 'Chưa đăng ký tuần này' : data?.availabilityMode === 'configured' ? 'Đã thiết lập' : 'Chưa thiết lập'}</button></section>}
    <section className="trainer-availability-controls" aria-label="Phạm vi lịch rảnh"><div><button type="button" disabled={saving || disabled || dirty} className={mode === 'weekly' ? 'active' : ''} onClick={() => setMode('weekly')}>Theo tuần</button><button type="button" disabled={saving || disabled || dirty} className={mode === 'recurring' ? 'active' : ''} onClick={() => setMode('recurring')}>Lịch lặp lại</button></div>{mode === 'weekly' && <nav><button type="button" disabled={saving || disabled || dirty} aria-label="Tuần trước" onClick={() => setWeekId(addDays(weekId, -7))}><ChevronLeft /></button><strong>{weekLabel(weekId)}</strong><button type="button" disabled={saving || disabled || dirty} aria-label="Tuần kế tiếp" onClick={() => setWeekId(addDays(weekId, 7))}><ChevronRight /></button></nav>}</section>
    {mode === 'weekly' && <div className="trainer-availability-shortcuts">{[{ label: 'Tuần hiện tại', value: currentWeek() }, { label: 'Tuần sau', value: addDays(currentWeek(), 7) }].map(({ label, value }) => <button type="button" key={label} disabled={saving || disabled || dirty} aria-pressed={weekId === value} onClick={() => setWeekId(value)}>{label}</button>)}</div>}
    {dirty && <p className="trainer-availability-guidance">Lưu lịch rảnh hoặc tải lại để bỏ thay đổi trước khi chuyển tuần.</p>}
    {loading && <div className="trainer-availability-state"><LoaderCircle className="spin" /><strong>Đang tải lịch rảnh</strong></div>}
    {!loading && error && !data && <div className="trainer-availability-state is-error"><strong>{error}</strong><button type="button" onClick={() => void load()}><RefreshCw /> Thử lại</button></div>}
    {!loading && data && <section className="trainer-availability-card">
      <header><div><small>{mode === 'weekly' ? `TUẦN ${weekLabel(weekId)}` : 'LỊCH LẶP LẠI'}</small><h2>{data.trainerName}</h2><p>{selected.size} khung giờ có thể nhận lịch · {offDates.size} ngày OFF</p><p>{mode === 'weekly' ? data.weeklyOverride ? 'Đã đăng ký lịch riêng cho tuần này.' : data.source === 'inherited_weekly' && data.sourceWeekId ? `Đang dùng lịch tuần ${weekLabel(data.sourceWeekId)}.` : 'Đang dùng lịch lặp lại.' : 'Dùng khi chưa có lịch tuần đã đăng ký.'}</p></div><div className={`trainer-availability-status${mode === 'weekly' && !data.weeklyOverride ? ' is-pending' : ''}`} role="status">{mode === 'weekly' && !data.weeklyOverride ? <CalendarClock /> : <CheckCircle2 />}<span>{dirty ? 'Chưa lưu thay đổi' : mode === 'weekly' ? data.weeklyOverride ? 'Đã đăng ký' : 'Chưa đăng ký' : 'Lịch lặp lại'}</span>{data.updatedAt && <small>{mode === 'weekly' && !data.weeklyOverride ? updatedLabel(data.updatedAt).replace('Đã lưu', 'Nguồn cập nhật') : updatedLabel(data.updatedAt)}</small>}<button type="button" disabled={saving || refreshing || disabled} onClick={() => void load()}><RefreshCw size={14} /> Tải lại</button></div></header>
      {mode === 'weekly' && <section className="trainer-availability-week-tools"><div><strong>OFF theo ngày</strong><small>Chỉ áp dụng cho tuần đang chọn.</small></div><div>{weekDays.map(({ day, date }) => <button type="button" key={date} aria-label={`OFF ${day} ${date}`} aria-pressed={offDates.has(date)} className={offDates.has(date) ? 'active' : ''} disabled={blocked} onClick={() => toggleOff(day, date)}><b>{day}</b><span>{date.slice(8, 10)}/{date.slice(5, 7)}</span></button>)}</div><button type="button" disabled={blocked} onClick={() => { setSelected(new Set(data.baseAvailableSlots)); setOffDates(new Set()) }}>Sao chép lịch lặp lại</button></section>}
      {data.locked && <div className="trainer-availability-lock"><ShieldCheck /><span>Tuần đã khóa từ {cutoffLabel(data.cutoffAt)}. {data.canManage ? 'Admin vẫn có thể điều chỉnh lịch tuần.' : 'Liên hệ quản lý để điều chỉnh lịch tuần đã qua.'}</span></div>}
      <div className="trainer-availability-legend"><span><i /> Có thể dạy</span><span><ShieldCheck /> Các buổi đã xếp được giữ nguyên</span></div>
      <div className="trainer-availability-shortcuts"><button type="button" disabled={blocked} onClick={() => setSelected(new Set(data.scheduleConfig.workingDays.filter((day) => !offDays.has(day)).flatMap((day) => data.scheduleConfig.workingHours.map((hour) => `${day}-${hour}`))))}>Chọn tất cả</button><button type="button" disabled={blocked} onClick={() => setSelected(new Set())}>Xóa chọn</button></div>
      <AvailabilityMatrix days={data.scheduleConfig.workingDays} hours={data.scheduleConfig.workingHours} selected={selected} onChange={setSelected} disabled={blocked} disabledDays={mode === 'weekly' ? offDays : undefined} />
      {error && <p role="alert" className="trainer-availability-notice is-error">{error}</p>}
      {notice && <p className="trainer-availability-notice">{notice}</p>}
      <footer><span>{mode === 'weekly' ? 'Lưu để xác nhận lịch cho tuần đang chọn.' : 'Dùng khi chưa có lịch tuần đã đăng ký.'}</span><button type="button" disabled={!canSave || blocked || emptySelectionBlocked} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" /> : <Save />}{saving ? 'Đang lưu' : data.locked && !data.canManage ? 'Tuần đã khóa' : mode === 'weekly' ? `Lưu tuần ${weekLabel(weekId)}` : 'Lưu lịch lặp lại'}</button></footer>
    </section>}
    {refreshing && <span className="trainer-availability-refreshing"><RefreshCw className="spin" /> Đang đồng bộ nền</span>}
  </main>
}
