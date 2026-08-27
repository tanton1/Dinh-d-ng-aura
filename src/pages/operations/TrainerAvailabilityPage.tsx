import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, LoaderCircle, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import AvailabilityMatrix from '../../components/schedule/AvailabilityMatrix'
import { getMyTrainerAvailability, saveMyTrainerAvailability, type TrainerAvailabilityWorkspace } from '../../services/ptOperationsV2Service'
import './TrainerAvailabilityPage.css'

export default function TrainerAvailabilityPage() {
  const [data, setData] = useState<TrainerAvailabilityWorkspace | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await getMyTrainerAvailability()
      setData(result); setSelected(new Set(result.availableSlots))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải lịch rảnh của PT.')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const original = useMemo(() => [...(data?.availableSlots || [])].sort().join('|'), [data])
  const current = useMemo(() => [...selected].sort().join('|'), [selected])
  const dirty = original !== current
  const save = async () => {
    if (!data || !dirty || saving) return
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await saveMyTrainerAvailability({ availableSlots: [...selected], expectedRevision: data.availabilityRevision })
      setData({ ...data, availableSlots: result.availableSlots, availabilityMode: result.availabilityMode, availabilityRevision: result.availabilityRevision })
      setSelected(new Set(result.availableSlots))
      setNotice('Đã cập nhật lịch rảnh. Bộ xếp tự động sẽ dùng lịch này cho các draft tiếp theo.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa thể lưu lịch rảnh.')
    } finally { setSaving(false) }
  }

  return <main className="trainer-availability-page">
    <section className="trainer-availability-hero">
      <div><small>AURA STAFF · THỜI GIAN LÀM VIỆC</small><h1>Lịch rảnh của tôi</h1><p>Chọn những ca bạn có thể nhận học viên. Lịch đã công bố không bị tự động thay đổi.</p></div>
      <span><CalendarClock /></span>
      <button type="button" className={`is-${data?.availabilityMode || 'unconfigured'}`} onClick={() => document.querySelector('.availability-matrix')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{data?.availabilityMode === 'configured' ? 'Đã thiết lập' : 'Chưa thiết lập'}</button>
    </section>
    {loading && <div className="trainer-availability-state"><LoaderCircle className="spin" /><strong>Đang tải lịch rảnh</strong></div>}
    {!loading && error && <div className="trainer-availability-state is-error"><strong>{error}</strong><button type="button" onClick={() => void load()}><RefreshCw /> Thử lại</button></div>}
    {!loading && data && <section className="trainer-availability-card">
      <header><div><small>MA TRẬN CA LÀM</small><h2>{data.trainerName}</h2><p>{selected.size} khung giờ đang sẵn sàng nhận lịch</p></div><div className="trainer-availability-status"><CheckCircle2 /><span>{dirty ? 'Có thay đổi' : 'Đã đồng bộ'}</span><small>Phiên bản #{data.availabilityRevision}</small></div></header>
      <div className="trainer-availability-legend"><span><i /> Có thể dạy</span><span><ShieldCheck /> Buổi đã publish được giữ nguyên</span></div>
      <AvailabilityMatrix days={data.scheduleConfig.workingDays} hours={data.scheduleConfig.workingHours} selected={selected} onChange={setSelected} disabled={saving} />
      {notice && <p className="trainer-availability-notice">{notice}</p>}
      <footer><span>Chạm từng ô để bật hoặc tắt ca rảnh.</span><button type="button" disabled={!dirty || saving || selected.size === 0} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" /> : <Save />}{saving ? 'Đang lưu' : 'Lưu lịch rảnh'}</button></footer>
    </section>}
  </main>
}
