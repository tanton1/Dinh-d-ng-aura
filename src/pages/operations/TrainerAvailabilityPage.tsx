import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import AvailabilityMatrix from '../../components/schedule/AvailabilityMatrix'
import { getMyTrainerAvailability, saveMyTrainerAvailability, type TrainerAvailabilityWorkspace } from '../../services/ptOperationsV2Service'
import './TrainerAvailabilityPage.css'

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })

function dateKey(date = new Date()) { return dateFormatter.format(date) }
function addDays(value: string, amount: number) { return dateKey(new Date(Date.parse(`${value}T12:00:00+07:00`) + amount * 86400000)) }
function mondayOf(value: string) {
  const weekday = new Date(`${value}T12:00:00+07:00`).getUTCDay()
  return addDays(value, -((weekday + 6) % 7))
}
function nextEditableWeek() {
  const currentMonday = mondayOf(dateKey())
  const cutoff = Date.parse(`${currentMonday}T00:00:00+07:00`) - 14 * 60 * 60 * 1000
  return Date.now() < cutoff ? currentMonday : addDays(currentMonday, 7)
}
function weekLabel(weekId: string) {
  const end = addDays(weekId, 5)
  return `${weekId.slice(8, 10)}/${weekId.slice(5, 7)} – ${end.slice(8, 10)}/${end.slice(5, 7)}`
}
function updatedLabel(value: string | null) {
  if (!value) return 'Chưa lưu lần nào'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Đã lưu' : `Đã lưu ${date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`
}

export default function TrainerAvailabilityPage({ embedded = false, isDemo = false }: { embedded?: boolean; isDemo?: boolean }) {
  const [mode, setMode] = useState<'weekly' | 'recurring'>('weekly')
  const [weekId, setWeekId] = useState(nextEditableWeek)
  const [data, setData] = useState<TrainerAvailabilityWorkspace | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [offDates, setOffDates] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const loadedRef = useRef(false)

  const load = useCallback(async () => {
    if (loadedRef.current) setRefreshing(true)
    else setLoading(true)
    setError('')
    if (isDemo) {
      const weekly = mode === 'weekly'
      const result: TrainerAvailabilityWorkspace = {
        schemaVersion: 2,
        trainerId: 'demo-staff', trainerName: 'Huấn luyện viên Aura', branchId: 'branch-demo',
        availableSlots: ['T2-6', 'T2-7', 'T3-18', 'T4-18', 'T5-7', 'T6-18', 'T7-8'],
        baseAvailableSlots: ['T2-6', 'T2-7', 'T3-18', 'T4-18', 'T5-7', 'T6-18', 'T7-8'],
        weekId: weekly ? weekId : null, weeklyOverride: weekly, offDates: [], locked: false,
        cutoffAt: weekly ? new Date(Date.parse(`${weekId}T00:00:00+07:00`) - 14 * 60 * 60 * 1000).toISOString() : null,
        source: weekly ? 'weekly' : 'recurring', updatedAt: new Date().toISOString(),
        availabilityMode: 'configured', availabilityRevision: 3,
        scheduleConfig: { workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'], workingHours: [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20] },
      }
      setData(result); setSelected(new Set(result.availableSlots)); setOffDates(new Set()); setLoading(false); setRefreshing(false); loadedRef.current = true; return
    }
    try {
      const result = await getMyTrainerAvailability(mode === 'weekly' ? weekId : undefined)
      setData(result); setSelected(new Set(result.availableSlots)); setOffDates(new Set(result.offDates || []))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải lịch rảnh của PT.')
    } finally {
      loadedRef.current = true; setLoading(false); setRefreshing(false)
    }
  }, [isDemo, mode, weekId])

  useEffect(() => { void load() }, [load])

  const original = useMemo(() => `${[...(data?.availableSlots || [])].sort().join('|')}::${[...(data?.offDates || [])].sort().join('|')}`, [data])
  const current = useMemo(() => `${[...selected].sort().join('|')}::${[...offDates].sort().join('|')}`, [offDates, selected])
  const dirty = original !== current
  const weekDays = useMemo(() => (data?.scheduleConfig.workingDays || []).map((day, index) => ({ day, date: addDays(weekId, index) })), [data?.scheduleConfig.workingDays, weekId])

  const toggleOff = (day: string, date: string) => {
    if (data?.locked || saving || mode !== 'weekly') return
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
    if (!data || !dirty || saving || data.locked) return
    setSaving(true); setError(''); setNotice('')
    if (isDemo) {
      const availableSlots = [...selected]
      setData({ ...data, availableSlots, baseAvailableSlots: mode === 'recurring' ? availableSlots : data.baseAvailableSlots, offDates: [...offDates], weeklyOverride: mode === 'weekly', source: mode, availabilityMode: availableSlots.length ? 'configured' : 'unconfigured', availabilityRevision: data.availabilityRevision + 1, updatedAt: new Date().toISOString() })
      setNotice('Đã cập nhật lịch rảnh trong bản xem trước.')
      setSaving(false); return
    }
    try {
      const result = await saveMyTrainerAvailability({ weekId: mode === 'weekly' ? weekId : undefined, availableSlots: [...selected], offDates: mode === 'weekly' ? [...offDates] : [], expectedRevision: data.availabilityRevision })
      setData({ ...data, ...result }); setSelected(new Set(result.availableSlots)); setOffDates(new Set(result.offDates || []))
      setNotice(mode === 'weekly' ? 'Đã lưu riêng tuần này. Bộ xếp tự động và publish sẽ dùng đúng lịch vừa gửi.' : 'Đã cập nhật lịch lặp lại cho các tuần chưa có điều chỉnh riêng.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa thể lưu lịch rảnh.')
    } finally { setSaving(false) }
  }

  return <main className={`trainer-availability-page${embedded ? ' is-embedded' : ''}`}>
    {!embedded && <section className="trainer-availability-hero"><div><small>AURA STAFF · THỜI GIAN LÀM VIỆC</small><h1>Lịch rảnh của tôi</h1><p>Lịch lặp lại là nền mặc định; điều chỉnh tuần và OFF chỉ áp dụng cho đúng tuần được chọn.</p></div><span><CalendarClock /></span><button type="button" className={`is-${data?.availabilityMode || 'unconfigured'}`} onClick={() => document.querySelector('.availability-matrix')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{data?.availabilityMode === 'configured' ? 'Đã thiết lập' : 'Chưa thiết lập'}</button></section>}
    <section className="trainer-availability-controls" aria-label="Phạm vi lịch rảnh"><div><button type="button" className={mode === 'weekly' ? 'active' : ''} onClick={() => setMode('weekly')}>Điều chỉnh tuần</button><button type="button" className={mode === 'recurring' ? 'active' : ''} onClick={() => setMode('recurring')}>Lịch lặp lại</button></div>{mode === 'weekly' && <nav><button type="button" aria-label="Tuần trước" onClick={() => setWeekId(addDays(weekId, -7))}><ChevronLeft /></button><strong>{weekLabel(weekId)}</strong><button type="button" aria-label="Tuần sau" onClick={() => setWeekId(addDays(weekId, 7))}><ChevronRight /></button></nav>}</section>
    {loading && <div className="trainer-availability-state"><LoaderCircle className="spin" /><strong>Đang tải lịch rảnh</strong></div>}
    {!loading && error && !data && <div className="trainer-availability-state is-error"><strong>{error}</strong><button type="button" onClick={() => void load()}><RefreshCw /> Thử lại</button></div>}
    {!loading && data && <section className="trainer-availability-card">
      <header><div><small>{mode === 'weekly' ? `TUẦN ${weekLabel(weekId)}` : 'LỊCH LẶP LẠI'}</small><h2>{data.trainerName}</h2><p>{selected.size} khung giờ có thể nhận lịch · {offDates.size} ngày OFF</p></div><div className="trainer-availability-status"><CheckCircle2 /><span>{data.locked ? 'Đã khóa' : dirty ? 'Có thay đổi' : 'Đã đồng bộ'}</span><small>{updatedLabel(data.updatedAt)}</small></div></header>
      {mode === 'weekly' && <section className="trainer-availability-week-tools"><div><strong>OFF theo ngày</strong><small>Không ảnh hưởng lịch lặp lại và các tuần khác.</small></div><div>{weekDays.map(({ day, date }) => <button type="button" key={date} className={offDates.has(date) ? 'active' : ''} disabled={data.locked || saving} onClick={() => toggleOff(day, date)}><b>{day}</b><span>{date.slice(8, 10)}/{date.slice(5, 7)}</span></button>)}</div><button type="button" disabled={data.locked || saving} onClick={() => { setSelected(new Set(data.baseAvailableSlots)); setOffDates(new Set()) }}>Dùng lịch lặp lại</button></section>}
      {data.locked && <p className="trainer-availability-lock"><ShieldCheck /> Tuần đã khóa sau 10:00 Chủ nhật. Nếu có phát sinh, hãy gửi quản lý xử lý lịch trực tiếp.</p>}
      <div className="trainer-availability-legend"><span><i /> Có thể dạy</span><span><ShieldCheck /> Buổi đã publish luôn được giữ nguyên</span></div>
      <AvailabilityMatrix days={data.scheduleConfig.workingDays} hours={data.scheduleConfig.workingHours} selected={selected} onChange={setSelected} disabled={saving || data.locked} />
      {error && <p className="trainer-availability-notice is-error">{error}</p>}
      {notice && <p className="trainer-availability-notice">{notice}</p>}
      <footer><span>{mode === 'weekly' ? 'Lưu riêng tuần này; lịch lặp lại không thay đổi.' : 'Áp dụng cho tuần tương lai chưa có điều chỉnh riêng.'}</span><button type="button" disabled={!dirty || saving || data.locked || (selected.size === 0 && offDates.size === 0)} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" /> : <Save />}{saving ? 'Đang lưu' : data.locked ? 'Tuần đã khóa' : 'Lưu lịch rảnh'}</button></footer>
    </section>}
    {refreshing && <span className="trainer-availability-refreshing"><RefreshCw className="spin" /> Đang đồng bộ nền</span>}
  </main>
}
