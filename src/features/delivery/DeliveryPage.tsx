import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Bike,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  LocateFixed,
  LogOut,
  MapPin,
  Navigation,
  PackageCheck,
  Phone,
  RefreshCw,
  Route,
  ShieldCheck,
  Store,
  WifiOff,
} from 'lucide-react'
import {
  acceptEatCleanDelivery,
  completeEatCleanDelivery,
  getDeliveryServiceError,
  listMyEatCleanDeliveryJobs,
  setEatCleanDriverAvailability,
  updateEatCleanDeliveryMilestone,
} from './deliveryService'
import type { EatCleanDeliveryJob, EatCleanDeliveryJobStatus, EatCleanDriverWorkspace } from './types'
import { useDriverLocationPublisher } from './useDriverLocationPublisher'
import './DeliveryPage.css'

interface DeliveryPageProps {
  driverId: string
  displayName: string
  onSignOut: () => void
}

const STATUS_LABELS: Record<EatCleanDeliveryJobStatus, string> = {
  assigned: 'Chờ nhận chuyến',
  accepted: 'Đã nhận chuyến',
  arrived_pickup: 'Đã đến bếp',
  picked_up: 'Đang giao',
  arrived_dropoff: 'Đã đến nơi',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
}

function money(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)}đ`
}

function duration(seconds: number) {
  return `${Math.max(1, Math.round(seconds / 60))} phút`
}

function time(value?: string) {
  if (!value) return 'Đang cập nhật'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Đang cập nhật' : new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(date)
}

function mapsUrl(job: EatCleanDeliveryJob) {
  const target = job.status === 'accepted' || job.status === 'arrived_pickup' ? job.pickup : job.dropoff
  const destination = target.coordinate
    ? `${target.coordinate.latitude},${target.coordinate.longitude}`
    : target.addressLine
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}

export default function DeliveryPage({ driverId, displayName, onSignOut }: DeliveryPageProps) {
  const [workspace, setWorkspace] = useState<EatCleanDriverWorkspace | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    return params.get('orderId') ?? params.get('jobId')
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [action, setAction] = useState('')
  const [otp, setOtp] = useState('')

  const selectedJob = useMemo(
    () => workspace?.jobs.find((job) => job.id === selectedJobId) ?? null,
    [selectedJobId, workspace?.jobs],
  )
  // An older deployed callable may not expose readiness yet. In that case,
  // allow the first GPS publish and let the server return the canonical error.
  const trackingReady = workspace?.readiness?.realtimeDatabaseReady !== false
  const location = useDriverLocationPublisher(
    selectedJob && !['assigned', 'completed', 'cancelled'].includes(selectedJob.status) ? selectedJob.id : null,
    driverId,
    trackingReady,
  )

  const load = useCallback(async (background = false) => {
    background ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const next = await listMyEatCleanDeliveryJobs()
      setWorkspace(next)
      if (selectedJobId && !next.jobs.some((job) => job.id === selectedJobId)) setSelectedJobId(null)
    } catch (loadError) {
      setError(getDeliveryServiceError(loadError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [selectedJobId])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const openJob = (jobId: string) => {
    setSelectedJobId(jobId)
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    params.set('screen', 'job')
    params.set('orderId', jobId)
    window.history.replaceState(null, '', `#/delivery?${params}`)
  }

  const closeJob = () => {
    location.stop()
    setSelectedJobId(null)
    window.history.replaceState(null, '', '#/delivery')
  }

  const runAction = async (key: string, operation: () => Promise<EatCleanDeliveryJob>) => {
    setAction(key)
    setError('')
    try {
      const nextJob = await operation()
      await load(true)
      if (nextJob.status === 'completed') location.stop()
    } catch (actionError) {
      setError(getDeliveryServiceError(actionError))
    } finally {
      setAction('')
    }
  }

  if (loading) return <main className="driver-page driver-page--center"><RefreshCw className="driver-spin" size={28} /><h1>Đang tải chuyến giao…</h1></main>
  if (!workspace) return <main className="driver-page driver-page--center"><WifiOff size={34} /><h1>Chưa thể mở Aura Delivery</h1><p>{error}</p><button onClick={() => void load()}><RefreshCw size={18} /> Thử lại</button></main>

  if (selectedJob) {
    const canShareLocation = !['assigned', 'completed', 'cancelled'].includes(selectedJob.status)
    return (
      <main className="driver-page driver-job-page">
        <header className="driver-topbar">
          <button type="button" aria-label="Quay lại" onClick={closeJob}><ArrowLeft size={22} /></button>
          <div><small>CHUYẾN GIAO</small><strong>{selectedJob.orderCode}</strong></div>
          <span className={`driver-status driver-status--${selectedJob.status}`}>{STATUS_LABELS[selectedJob.status]}</span>
        </header>

        <section className="driver-route-map" aria-label="Tuyến đường giao hàng">
          <div className="driver-route-map__grid" />
          <span className="driver-map-pin driver-map-pin--pickup"><Store size={18} /></span>
          <i className="driver-route-line" />
          <span className="driver-map-pin driver-map-pin--driver"><Bike size={19} /></span>
          <span className="driver-map-pin driver-map-pin--dropoff"><MapPin size={18} /></span>
          <div className="driver-map-eta"><small>Dự kiến đến</small><strong>{time(selectedJob.estimatedArrivalAt)}</strong><span>{duration(selectedJob.routeDurationSeconds)} · {(selectedJob.distanceMeters / 1000).toFixed(1)} km</span></div>
          <a href={mapsUrl(selectedJob)} target="_blank" rel="noreferrer"><Navigation size={17} /> Mở chỉ đường</a>
        </section>

        <section className={`driver-location-card driver-location-card--${location.state}`}>
          <LocateFixed size={20} />
          <div><strong>{location.state === 'sharing' ? 'Đang chia sẻ vị trí' : 'Theo dõi realtime'}</strong><small>{location.message || 'Bật GPS sau khi nhận chuyến để khách theo dõi ETA.'}</small></div>
          {canShareLocation && location.state !== 'sharing' && <button type="button" onClick={location.start}>Bật GPS</button>}
          {location.state === 'sharing' && <button type="button" onClick={location.stop}>Tạm dừng</button>}
        </section>

        {error && <div className="driver-alert" role="alert">{error}</div>}

        <div className="driver-job-content">
          <section className="driver-stop-list">
            <article><span><Store size={20} /></span><div><small>NHẬN MÓN TẠI</small><strong>{selectedJob.pickup.name}</strong><p>{selectedJob.pickup.addressLine}</p></div></article>
            <i />
            <article><span><MapPin size={20} /></span><div><small>GIAO ĐẾN</small><strong>{selectedJob.dropoff.name}</strong><p>{selectedJob.dropoff.addressLine}</p>{selectedJob.dropoff.note && <em>{selectedJob.dropoff.note}</em>}</div><a href={`tel:${selectedJob.dropoff.phone}`} aria-label="Gọi khách"><Phone size={19} /></a></article>
          </section>

          <section className="driver-facts">
            <div><PackageCheck size={18} /><span><small>Số món</small><strong>{selectedJob.itemCount} món</strong></span></div>
            <div><CircleDollarSign size={18} /><span><small>Thu khách</small><strong>{money(selectedJob.cashToCollect)}</strong></span></div>
            <div><Clock3 size={18} /><span><small>SLA giao</small><strong>{time(selectedJob.promisedAt)}</strong></span></div>
          </section>
        </div>

        <footer className="driver-action-bar">
          {selectedJob.status === 'assigned' && <button className="driver-primary-action" disabled={Boolean(action)} onClick={() => void runAction('accept', () => acceptEatCleanDelivery(selectedJob.id))}><Check size={20} /> {action ? 'Đang nhận…' : 'Nhận chuyến giao'}</button>}
          {selectedJob.status === 'accepted' && <button className="driver-primary-action" disabled={Boolean(action)} onClick={() => void runAction('arrived_pickup', () => updateEatCleanDeliveryMilestone(selectedJob.id, 'arrived_pickup'))}><Store size={20} /> Tôi đã đến bếp</button>}
          {selectedJob.status === 'arrived_pickup' && <button className="driver-primary-action" disabled={Boolean(action)} onClick={() => void runAction('picked_up', () => updateEatCleanDeliveryMilestone(selectedJob.id, 'picked_up'))}><Bike size={20} /> Đã nhận đủ món</button>}
          {selectedJob.status === 'picked_up' && <button className="driver-primary-action" disabled={Boolean(action)} onClick={() => void runAction('arrived_dropoff', () => updateEatCleanDeliveryMilestone(selectedJob.id, 'arrived_dropoff'))}><MapPin size={20} /> Tôi đã đến nơi</button>}
          {selectedJob.status === 'arrived_dropoff' && (
            <div className="driver-otp-action"><label><span>OTP giao hàng</span><input value={otp} inputMode="numeric" autoComplete="one-time-code" maxLength={4} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" /></label><button className="driver-primary-action" disabled={otp.length !== 4 || Boolean(action)} onClick={() => void runAction('completed', () => completeEatCleanDelivery(selectedJob.id, otp))}><ShieldCheck size={20} /> Xác nhận đã giao</button></div>
          )}
          {selectedJob.status === 'completed' && <div className="driver-complete-state"><Check size={20} /> Chuyến giao đã hoàn thành an toàn.</div>}
        </footer>
      </main>
    )
  }

  const activeJobs = workspace.jobs.filter((job) => !['completed', 'cancelled'].includes(job.status))
  const completedJobs = workspace.jobs.filter((job) => job.status === 'completed')
  return (
    <main className="driver-page">
      <header className="driver-home-header">
        <div><small>AURA DELIVERY</small><h1>Chào {displayName}</h1><p>{activeJobs.length ? `Bạn có ${activeJobs.length} chuyến cần xử lý.` : 'Chưa có chuyến giao đang chờ.'}</p></div>
        <button type="button" aria-label="Đăng xuất" onClick={onSignOut}><LogOut size={20} /></button>
      </header>

      <section className="driver-availability">
        <span className={workspace.driver.available ? 'is-online' : ''}><i /><strong>{workspace.driver.available ? 'Đang sẵn sàng' : 'Đang tạm nghỉ'}</strong><small>{workspace.driver.available ? 'Hệ thống có thể gán chuyến mới' : 'Bạn sẽ không nhận chuyến mới'}</small></span>
        <button type="button" disabled={Boolean(action)} onClick={() => {
          setAction('availability')
          void setEatCleanDriverAvailability(!workspace.driver.available)
            .then((driver) => setWorkspace({ ...workspace, driver }))
            .catch((availabilityError) => setError(getDeliveryServiceError(availabilityError)))
            .finally(() => setAction(''))
        }}>{workspace.driver.available ? 'Tạm nghỉ' : 'Bắt đầu nhận đơn'}</button>
      </section>

      {workspace.readiness?.dispatchReady === false && <div className="driver-config-warning"><WifiOff size={19} /><span><strong>Hạ tầng giao hàng phía máy chủ chưa sẵn sàng</strong><small>{workspace.readiness.realtimeDatabaseReady ? 'Khóa OTP giao hàng chưa được cấu hình.' : 'Dịch vụ GPS realtime chưa được cấu hình.'} Các mốc không phụ thuộc hạ tầng này vẫn hoạt động.</small></span></div>}
      {error && <div className="driver-alert" role="alert">{error}</div>}

      <section className="driver-list-heading"><div><small>HÔM NAY</small><h2>Chuyến cần xử lý</h2></div><button type="button" disabled={refreshing} onClick={() => void load(true)}><RefreshCw className={refreshing ? 'driver-spin' : ''} size={17} /> Làm mới</button></section>
      <div className="driver-job-list">
        {activeJobs.map((job) => <button type="button" key={job.id} className={job.isLate ? 'is-late' : ''} onClick={() => openJob(job.id)}><header><span>{job.orderCode}</span><b className={`driver-status driver-status--${job.status}`}>{STATUS_LABELS[job.status]}</b></header><div className="driver-job-route"><MapPin size={20} /><span><strong>{job.dropoff.name}</strong><small>{job.dropoff.addressLine}</small></span><ChevronRight size={20} /></div><footer><span><Route size={16} /> {(job.distanceMeters / 1000).toFixed(1)} km</span><span><Clock3 size={16} /> ETA {time(job.estimatedArrivalAt)}</span>{job.isLate && <em>Sắp trễ SLA</em>}</footer></button>)}
        {activeJobs.length === 0 && <div className="driver-empty"><Bike size={34} /><h3>Chưa có chuyến mới</h3><p>Giữ trạng thái sẵn sàng; đơn được gán sẽ xuất hiện tại đây.</p></div>}
      </div>

      {completedJobs.length > 0 && <section className="driver-completed"><h2>Đã hoàn thành</h2>{completedJobs.slice(0, 5).map((job) => <button key={job.id} onClick={() => openJob(job.id)}><span><strong>{job.orderCode}</strong><small>{job.dropoff.addressLine}</small></span><b>{time(job.completedAt)}</b></button>)}</section>}
    </main>
  )
}
