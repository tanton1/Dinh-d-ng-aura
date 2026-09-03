import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bike,
  CheckCircle2,
  Clock3,
  LocateFixed,
  MapPin,
  RefreshCw,
  Route,
  Save,
  Settings2,
  Store,
  UserCheck,
} from 'lucide-react'
import {
  assignEatCleanShipper,
  getDeliveryServiceError,
  listEatCleanDispatchSnapshot,
  saveEatCleanDeliveryOperationsConfig,
} from '../../../delivery/deliveryService'
import {
  DEFAULT_DELIVERY_OPERATIONS_CONFIG,
  type EatCleanDeliveryJob,
  type EatCleanDeliveryOperationsConfig,
  type EatCleanDispatchSnapshot,
} from '../../../delivery/types'
import {
  getGoogleMapsClientHealth,
  googleMapsClientMessage,
  googleMapsConfigured,
  loadGooglePlaces,
} from '../../googleMapsLoader'

type DispatchSection = 'live' | 'settings'
type ClientMapsProbe = { status: 'checking' | 'ready' | 'missing' | 'error'; message: string }

function time(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(date)
}

function km(value: number) {
  return `${(value / 1000).toFixed(1)} km`
}

function mapPosition(
  coordinate: { latitude: number; longitude: number } | undefined,
  allCoordinates: Array<{ latitude: number; longitude: number }>,
) {
  if (!coordinate || allCoordinates.length < 2) return { left: '50%', top: '50%' }
  const latitudes = allCoordinates.map((item) => item.latitude)
  const longitudes = allCoordinates.map((item) => item.longitude)
  const minLat = Math.min(...latitudes)
  const maxLat = Math.max(...latitudes)
  const minLng = Math.min(...longitudes)
  const maxLng = Math.max(...longitudes)
  const latitudeRange = Math.max(.001, maxLat - minLat)
  const longitudeRange = Math.max(.001, maxLng - minLng)
  return {
    left: `${10 + ((coordinate.longitude - minLng) / longitudeRange) * 80}%`,
    top: `${90 - ((coordinate.latitude - minLat) / latitudeRange) * 80}%`,
  }
}

function validateConfig(config: EatCleanDeliveryOperationsConfig) {
  if (!config.kitchenName.trim() || !config.kitchenAddress.trim()) return 'Cần nhập tên và địa chỉ bếp.'
  const coordinate = config.kitchenCoordinate
  const coordinateIsValid = Boolean(coordinate)
    && Number.isFinite(coordinate?.latitude)
    && Number.isFinite(coordinate?.longitude)
    && Math.abs(coordinate!.latitude) <= 90
    && Math.abs(coordinate!.longitude) <= 180
    && !(coordinate!.latitude === 0 && coordinate!.longitude === 0)
  if (coordinate && !coordinateIsValid) return 'Tọa độ bếp chưa hợp lệ.'
  if (config.distancePricingEnabled && !coordinateIsValid) return 'Cần chọn tọa độ bếp hợp lệ trước khi bật tính phí theo km.'
  if (config.maxDeliveryKm < .5 || config.maxDeliveryKm > 100) return 'Bán kính giao hàng phải từ 0,5 đến 100 km.'
  if (config.pricingTiers.length === 0) return 'Cần ít nhất một bậc phí giao hàng.'
  const sorted = [...config.pricingTiers].sort((left, right) => left.fromKm - right.fromKm)
  if (sorted.some((tier) => tier.fromKm < 0 || tier.toKm <= tier.fromKm || tier.pricePerKm < 0 || (tier.baseFee ?? 0) < 0)) return 'Các bậc phí đang có khoảng cách hoặc đơn giá không hợp lệ.'
  if (sorted[0].fromKm !== 0) return 'Bậc phí đầu tiên phải bắt đầu từ 0 km.'
  if (sorted.some((tier) => !Number.isInteger(tier.pricePerKm) || !Number.isInteger(tier.baseFee ?? 0))) return 'Phí nền và đơn giá theo km phải là số nguyên VND.'
  if (sorted.some((tier, index) => index > 0 && Math.abs(tier.fromKm - sorted[index - 1].toKm) > .001)) return 'Các bậc phí phải liên tục, không để khoảng trống hoặc chồng lấn.'
  if (sorted[sorted.length - 1].toKm !== config.maxDeliveryKm) return 'Bậc phí cuối phải kết thúc đúng tại bán kính giao tối đa.'
  if ([config.sla.confirmationMinutes, config.sla.preparationMinutes, config.sla.assignmentMinutes, config.sla.pickupWaitMinutes].some((value) => value < 1 || value > 240)) return 'SLA xác nhận, chuẩn bị, gán và lấy món phải từ 1–240 phút.'
  if ([config.sla.trafficBufferMinutes, config.sla.lateGraceMinutes].some((value) => value < 0 || value > 120)) return 'Buffer giao và ngưỡng báo trễ phải từ 0–120 phút.'
  return ''
}

export function EatCleanDispatchTab({ isDemo = false }: { isDemo?: boolean }) {
  const [section, setSection] = useState<DispatchSection>('live')
  const [snapshot, setSnapshot] = useState<EatCleanDispatchSnapshot | null>(null)
  const [configDraft, setConfigDraft] = useState<EatCleanDeliveryOperationsConfig>(DEFAULT_DELIVERY_OPERATIONS_CONFIG)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [assigningJob, setAssigningJob] = useState<EatCleanDeliveryJob | null>(null)
  const [shipperId, setShipperId] = useState('')
  const [saving, setSaving] = useState(false)
  const [clientMapsProbe, setClientMapsProbe] = useState<ClientMapsProbe>(() => googleMapsConfigured()
    ? { status: 'checking', message: 'Đang kiểm tra Maps và Places trên trình duyệt…' }
    : { status: 'missing', message: 'Thiếu VITE_GOOGLE_MAPS_API_KEY trong bản build frontend' })

  const load = useCallback(async (background = false) => {
    background ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const next: EatCleanDispatchSnapshot = isDemo
        ? {
            jobs: [],
            drivers: [],
            config: { ...DEFAULT_DELIVERY_OPERATIONS_CONFIG },
            readiness: {
              secretBindingEnabled: false,
              mapsKeyAvailable: false,
              storeCoordinateReady: false,
              distancePricingReady: false,
              realtimeDatabaseReady: false,
              otpKeyAvailable: false,
              dispatchReady: false,
            },
            signals: { mapsErrorsToday: 0, otpRejected: 0, otpLocked: 0, gpsStale: 0, lateOrders: 0 },
          }
        : await listEatCleanDispatchSnapshot()
      setSnapshot(next)
      setConfigDraft(next.config)
    } catch (loadError) {
      setError(getDeliveryServiceError(loadError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
    if (isDemo) return undefined
    const timer = window.setInterval(() => void load(true), 30_000)
    return () => window.clearInterval(timer)
  }, [isDemo, load])

  useEffect(() => {
    if (!googleMapsConfigured()) return
    let active = true
    void loadGooglePlaces().then((places) => {
      if (!active) return
      const health = getGoogleMapsClientHealth()
      setClientMapsProbe(places?.PlaceAutocompleteElement
        ? { status: 'ready', message: 'Maps JavaScript và Places Search sẵn sàng' }
        : { status: 'error', message: googleMapsClientMessage(health) })
    })
    return () => { active = false }
  }, [isDemo])

  const activeJobs = useMemo(() => snapshot?.jobs.filter((job) => !['completed', 'cancelled'].includes(job.status)) ?? [], [snapshot?.jobs])
  const unassignedJobs = activeJobs.filter((job) => job.canAssign)
  const lateJobs = activeJobs.filter((job) => job.isLate)
  const availableDrivers = snapshot?.drivers.filter((driver) => driver.available) ?? []
  const mapsReady = snapshot?.readiness.mapsKeyAvailable === true
  const distancePricingReady = snapshot?.readiness.distancePricingReady === true
  const otpReady = snapshot?.readiness.otpKeyAvailable === true
  const realtimeReady = snapshot?.readiness.realtimeDatabaseReady === true
  const operationalSignals = snapshot?.signals ?? {
    mapsErrorsToday: 0,
    otpRejected: 0,
    otpLocked: 0,
    gpsStale: 0,
    lateOrders: 0,
  }
  const allCoordinates = [
    ...(snapshot?.config.kitchenCoordinate ? [snapshot.config.kitchenCoordinate] : []),
    ...(snapshot?.drivers.flatMap((driver) => driver.coordinate ? [driver.coordinate] : []) ?? []),
    ...activeJobs.flatMap((job) => job.dropoff.coordinate ? [job.dropoff.coordinate] : []),
  ]

  const assign = async () => {
    if (!assigningJob || !shipperId) return
    if (!otpReady) {
      setError('Chưa thể gán shipper: khóa OTP giao hàng phía máy chủ chưa sẵn sàng.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await assignEatCleanShipper(assigningJob.id, shipperId)
      await load(true)
      setAssigningJob(null)
      setShipperId('')
      setSuccess(`Đã gán ${saved.orderCode} cho shipper.`)
    } catch (assignError) {
      setError(getDeliveryServiceError(assignError))
    } finally {
      setSaving(false)
    }
  }

  const saveConfig = async () => {
    if (configDraft.distancePricingEnabled && !mapsReady) {
      setError('Chưa thể bật phí theo km: GOOGLE_MAPS_API_KEY phía máy chủ chưa sẵn sàng.')
      return
    }
    const validationError = validateConfig(configDraft)
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const saved = await saveEatCleanDeliveryOperationsConfig(configDraft)
      setConfigDraft(saved)
      setSnapshot((current) => current ? { ...current, config: saved } : current)
      await load(true)
      setSuccess('Đã lưu bảng phí giao và SLA mới.')
    } catch (saveError) {
      setError(getDeliveryServiceError(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="eat-clean-panel eat-clean-dispatch" aria-labelledby="eat-clean-dispatch-title">
      <div className="eat-clean-panel__heading eat-clean-panel__heading--action">
        <div><span className="eat-clean-kicker">DISPATCH CENTER</span><h2 id="eat-clean-dispatch-title">Điều phối giao hàng theo SLA</h2><p>Theo dõi đơn, shipper và cấu hình phí quãng đường trong cùng một luồng.</p></div>
        <button type="button" className="eat-clean-secondary-button" onClick={() => void load(true)} disabled={refreshing}><RefreshCw size={17} className={refreshing ? 'is-spinning' : ''} /> Làm mới</button>
      </div>

      <div className="eat-clean-dispatch-switch" role="tablist" aria-label="Dispatch Center">
        <button type="button" role="tab" aria-selected={section === 'live'} className={section === 'live' ? 'active' : ''} onClick={() => setSection('live')}><LocateFixed size={17} /> Điều phối trực tiếp</button>
        <button type="button" role="tab" aria-selected={section === 'settings'} className={section === 'settings' ? 'active' : ''} onClick={() => setSection('settings')}><Settings2 size={17} /> Phí giao & SLA</button>
      </div>

      {!loading && snapshot && (
        <>
          <div className="eat-clean-readiness-grid" aria-label="Tình trạng hạ tầng giao hàng">
            <article className={clientMapsProbe.status === 'ready' ? 'is-ready' : clientMapsProbe.status === 'checking' ? 'is-warning' : 'needs-setup'}><span>{clientMapsProbe.status === 'ready' ? <CheckCircle2 size={18} /> : clientMapsProbe.status === 'checking' ? <RefreshCw size={18} className="is-spinning" /> : <AlertTriangle size={18} />}</span><div><strong>Maps & Search</strong><small>{clientMapsProbe.message}</small></div></article>
            <article className={distancePricingReady ? 'is-ready' : mapsReady ? 'is-warning' : 'needs-setup'}><span>{distancePricingReady ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}</span><div><strong>Routes backend</strong><small>{distancePricingReady ? 'Key server và tọa độ bếp sẵn sàng' : mapsReady ? 'Key server có sẵn · chưa có tọa độ bếp' : 'Thiếu GOOGLE_MAPS_API_KEY phía máy chủ'}</small></div></article>
            <article className={otpReady ? 'is-ready' : 'needs-setup'}><span>{otpReady ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}</span><div><strong>OTP giao hàng</strong><small>{otpReady ? 'Có thể gán và hoàn tất đơn' : 'Thiếu DELIVERY_OTP_SECRET · khóa gán shipper'}</small></div></article>
            <article className={realtimeReady && !operationalSignals.gpsReadWarning ? 'is-ready' : 'is-warning'}><span>{realtimeReady && !operationalSignals.gpsReadWarning ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}</span><div><strong>GPS realtime</strong><small>{operationalSignals.gpsReadWarning ? 'Đang gián đoạn đọc GPS · kiểm tra RTDB' : realtimeReady ? 'Theo dõi vị trí đã sẵn sàng' : 'Chưa có Realtime Database · vẫn gán đơn được'}</small></div></article>
          </div>
          <div className="eat-clean-operations-signals" aria-label="Cảnh báo vận hành hôm nay">
            <article className={operationalSignals.mapsErrorsToday > 0 ? 'has-alert' : ''}><span>MAPS</span><strong>{operationalSignals.mapsErrorsToday}</strong><small>Lỗi địa chỉ/tuyến hôm nay</small></article>
            <article className={operationalSignals.otpRejected > 0 ? 'has-alert' : ''}><span>OTP</span><strong>{operationalSignals.otpRejected}</strong><small>Đơn có OTP sai · khóa {operationalSignals.otpLocked}</small></article>
            <article className={operationalSignals.gpsStale > 0 ? 'has-alert' : ''}><span>GPS</span><strong>{operationalSignals.gpsStale}</strong><small>Chuyến mất tín hiệu &gt; 2 phút</small></article>
            <article className={operationalSignals.lateOrders > 0 ? 'has-alert' : ''}><span>SLA</span><strong>{operationalSignals.lateOrders}</strong><small>Đơn đã qua giờ cam kết</small></article>
          </div>
        </>
      )}

      {error && <div className="eat-clean-inline-error" role="alert">{error}</div>}
      {success && <div className="eat-clean-inline-success" role="status">{success}</div>}

      {loading ? <div className="eat-clean-loading"><span className="eat-clean-loader" /><strong>Đang tải Dispatch Center…</strong></div> : section === 'live' ? (
        <div className="eat-clean-dispatch-live">
          <div className="eat-clean-dispatch-metrics">
            <article><span><Route size={19} /></span><div><strong>{activeJobs.length}</strong><small>Chuyến đang mở</small></div></article>
            <article><span><UserCheck size={19} /></span><div><strong>{availableDrivers.length}</strong><small>Shipper sẵn sàng</small></div></article>
            <article className={unassignedJobs.length ? 'needs-attention' : ''}><span><Bike size={19} /></span><div><strong>{unassignedJobs.length}</strong><small>Chờ gán shipper</small></div></article>
            <article className={lateJobs.length ? 'is-danger' : ''}><span><AlertTriangle size={19} /></span><div><strong>{lateJobs.length}</strong><small>Nguy cơ trễ SLA</small></div></article>
          </div>

          <div className="eat-clean-dispatch-grid">
            <section className="eat-clean-dispatch-map" aria-label="Bản đồ giao hàng trực tiếp">
              <header><div><span>LIVE MAP</span><h3>Đà Nẵng · {activeJobs.length} chuyến</h3></div><small>Tự làm mới mỗi 30 giây</small></header>
              <div className="eat-clean-dispatch-map__canvas">
                <i className="eat-clean-dispatch-map__roads" />
                {snapshot?.config.kitchenCoordinate && <span className="eat-clean-dispatch-pin kitchen" style={mapPosition(snapshot.config.kitchenCoordinate, allCoordinates)} title={snapshot.config.kitchenName}><Store size={16} /></span>}
                {snapshot?.drivers.filter((driver) => driver.coordinate).map((driver) => <span key={driver.id} className={`eat-clean-dispatch-pin driver ${driver.available ? 'online' : ''}`} style={mapPosition(driver.coordinate, allCoordinates)} title={driver.name}><Bike size={16} /></span>)}
                {activeJobs.filter((job) => job.dropoff.coordinate).map((job) => <span key={job.id} className={`eat-clean-dispatch-pin order ${job.isLate ? 'late' : ''}`} style={mapPosition(job.dropoff.coordinate, allCoordinates)} title={job.orderCode}><MapPin size={15} /></span>)}
                {allCoordinates.length < 2 && <div className="eat-clean-map-empty"><MapPin size={27} /><strong>Đang chờ dữ liệu GPS</strong><small>Vị trí sẽ xuất hiện khi bếp và shipper đã được định vị.</small></div>}
              </div>
              <footer><span><i className="kitchen" /> Bếp</span><span><i className="driver" /> Shipper</span><span><i className="order" /> Điểm giao</span><span><i className="late" /> Sắp trễ</span></footer>
            </section>

            <section className="eat-clean-dispatch-queue">
              <header><div><span>HÀNG ĐỢI</span><h3>Cần điều phối</h3></div><b>{unassignedJobs.length}</b></header>
              <div>{unassignedJobs.map((job) => <article key={job.id} className={job.isLate ? 'is-late' : ''}><div><strong>{job.orderCode}</strong><span>{job.dropoff.name}</span><small><MapPin size={13} /> {job.dropoff.addressLine || 'Chưa có địa chỉ'} </small><small><Clock3 size={13} /> SLA {time(job.promisedAt)} · {km(job.distanceMeters)}</small></div><button type="button" disabled={!otpReady} title={otpReady ? 'Gán shipper' : 'Cần cấu hình OTP trước khi gán shipper'} onClick={() => { setAssigningJob(job); setShipperId(availableDrivers[0]?.id ?? '') }}><UserCheck size={15} /> Gán shipper</button></article>)}{unassignedJobs.length === 0 && <div className="eat-clean-dispatch-empty"><CheckCircle2 size={28} /><strong>Không có đơn chờ gán</strong><small>Luồng điều phối đang thông suốt.</small></div>}</div>
            </section>
          </div>

          <section className="eat-clean-driver-strip"><header><div><span>ĐỘI SHIPPER</span><h3>Trạng thái hiện tại</h3></div></header><div>{snapshot?.drivers.map((driver) => <article key={driver.id}><span className={driver.available ? 'online' : ''}>{driver.avatarUrl ? <img src={driver.avatarUrl} alt="" /> : <Bike size={18} />}</span><div><strong>{driver.name}</strong><small>{driver.vehicleLabel ?? 'Shipper Aura'}{driver.licensePlate ? ` · ${driver.licensePlate}` : ''}</small></div><b>{driver.activeJobCount} chuyến</b><em className={driver.available ? 'online' : ''}>{driver.available ? 'Sẵn sàng' : 'Ngoại tuyến'}</em></article>)}{!snapshot?.drivers.length && <div className="eat-clean-dispatch-empty"><Bike size={27} /><strong>Chưa có shipper</strong><small>Gán role shipper trong trang Vai trò & quyền.</small></div>}</div></section>
        </div>
      ) : (
        <div className="eat-clean-delivery-settings">
          <section className="eat-clean-subcard">
            <div className="eat-clean-subcard__heading"><span className="eat-clean-subcard__icon"><Store size={19} /></span><div><h3>Điểm xuất phát và vùng phục vụ</h3><p>Backend dùng tọa độ này để tính tuyến đường thực tế.</p></div></div>
            <div className="eat-clean-form-grid eat-clean-form-grid--2"><label className="eat-clean-field"><span>Tên bếp</span><input value={configDraft.kitchenName} onChange={(event) => setConfigDraft({ ...configDraft, kitchenName: event.target.value })} /></label><label className="eat-clean-field"><span>Thành phố phục vụ</span><input value={configDraft.serviceCity} onChange={(event) => setConfigDraft({ ...configDraft, serviceCity: event.target.value })} /></label></div>
            <label className="eat-clean-field"><span>Địa chỉ bếp</span><input value={configDraft.kitchenAddress} onChange={(event) => setConfigDraft({ ...configDraft, kitchenAddress: event.target.value })} /></label>
            <div className="eat-clean-form-grid eat-clean-form-grid--3"><label className="eat-clean-field"><span>Vĩ độ</span><input type="number" step="0.000001" value={configDraft.kitchenCoordinate?.latitude ?? ''} onChange={(event) => setConfigDraft({ ...configDraft, kitchenCoordinate: { latitude: Number(event.target.value), longitude: configDraft.kitchenCoordinate?.longitude ?? 0 } })} /></label><label className="eat-clean-field"><span>Kinh độ</span><input type="number" step="0.000001" value={configDraft.kitchenCoordinate?.longitude ?? ''} onChange={(event) => setConfigDraft({ ...configDraft, kitchenCoordinate: { latitude: configDraft.kitchenCoordinate?.latitude ?? 0, longitude: Number(event.target.value) } })} /></label><label className="eat-clean-field"><span>Giao tối đa (km)</span><input type="number" min={.1} max={100} step={.1} value={configDraft.maxDeliveryKm} onChange={(event) => setConfigDraft({ ...configDraft, maxDeliveryKm: Number(event.target.value) })} /></label></div>
          </section>

          <section className="eat-clean-subcard">
            <div className="eat-clean-subcard__heading"><span className="eat-clean-subcard__icon"><Route size={19} /></span><div><h3>Bảng phí theo quãng đường</h3><p>Khoảng cách tính theo Google Routes; phí làm tròn ở backend.</p></div></div>
            <label className={`eat-clean-switch-field ${configDraft.distancePricingEnabled ? 'eat-clean-switch-field--strong' : ''}`}><span><strong>Bật tính phí theo quãng đường</strong><small>{mapsReady ? 'Có thể bật sau khi tọa độ bếp hợp lệ. Các bậc phí vẫn chỉnh sửa được khi đang tắt.' : 'Cần cấu hình GOOGLE_MAPS_API_KEY phía máy chủ trước khi bật.'}</small></span><input type="checkbox" checked={configDraft.distancePricingEnabled} disabled={!mapsReady && !configDraft.distancePricingEnabled} onChange={(event) => setConfigDraft({ ...configDraft, distancePricingEnabled: event.target.checked })} /></label>
            <div className="eat-clean-pricing-table"><header><span>Từ km</span><span>Đến km</span><span>Phí nền</span><span>Đơn giá/km</span></header>{configDraft.pricingTiers.map((tier, index) => <div key={tier.id}><input aria-label={`Từ km bậc ${index + 1}`} type="number" min={0} step={.1} value={tier.fromKm} onChange={(event) => setConfigDraft({ ...configDraft, pricingTiers: configDraft.pricingTiers.map((item, itemIndex) => itemIndex === index ? { ...item, fromKm: Number(event.target.value) } : item) })} /><input aria-label={`Đến km bậc ${index + 1}`} type="number" min={0} step={.1} value={tier.toKm} onChange={(event) => setConfigDraft({ ...configDraft, pricingTiers: configDraft.pricingTiers.map((item, itemIndex) => itemIndex === index ? { ...item, toKm: Number(event.target.value) } : item) })} /><input aria-label={`Phí nền bậc ${index + 1}`} type="number" min={0} step={1000} value={tier.baseFee ?? 0} onChange={(event) => setConfigDraft({ ...configDraft, pricingTiers: configDraft.pricingTiers.map((item, itemIndex) => itemIndex === index ? { ...item, baseFee: Number(event.target.value) || undefined } : item) })} /><input aria-label={`Đơn giá bậc ${index + 1}`} type="number" min={0} step={1000} value={tier.pricePerKm} onChange={(event) => setConfigDraft({ ...configDraft, pricingTiers: configDraft.pricingTiers.map((item, itemIndex) => itemIndex === index ? { ...item, pricePerKm: Number(event.target.value) } : item) })} /></div>)}</div>
            <label className="eat-clean-field"><span>Miễn phí giao từ (đ)</span><input type="number" min={0} step={1000} value={configDraft.freeDeliveryThreshold} onChange={(event) => setConfigDraft({ ...configDraft, freeDeliveryThreshold: Number(event.target.value) })} /></label>
          </section>

          <section className="eat-clean-subcard">
            <div className="eat-clean-subcard__heading"><span className="eat-clean-subcard__icon"><Clock3 size={19} /></span><div><h3>Cam kết SLA</h3><p>Đơn sắp vượt cam kết sẽ được đánh dấu đỏ trong bản điều phối.</p></div></div>
            <div className="eat-clean-form-grid eat-clean-form-grid--3">{([
              ['confirmationMinutes', 'Xác nhận đơn'],
              ['preparationMinutes', 'Chuẩn bị món'],
              ['assignmentMinutes', 'Gán shipper'],
              ['pickupWaitMinutes', 'Chờ lấy món'],
              ['trafficBufferMinutes', 'Buffer giao'],
              ['lateGraceMinutes', 'Ngưỡng báo trễ'],
            ] as const).map(([key, label]) => <label className="eat-clean-field" key={key}><span>{label} (phút)</span><input type="number" min={0} max={240} value={configDraft.sla[key]} onChange={(event) => setConfigDraft({ ...configDraft, sla: { ...configDraft.sla, [key]: Number(event.target.value) } })} /></label>)}</div>
          </section>

          <div className="eat-clean-save-row"><button type="button" className="eat-clean-primary-button" onClick={() => void saveConfig()} disabled={saving}><Save size={18} /> {saving ? 'Đang lưu…' : 'Lưu phí giao & SLA'}</button></div>
        </div>
      )}

      {assigningJob && <div className="eat-clean-dispatch-dialog-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="assign-shipper-title"><header><div><span>GÁN SHIPPER</span><h3 id="assign-shipper-title">{assigningJob.orderCode}</h3></div><button type="button" onClick={() => setAssigningJob(null)}>Đóng</button></header><p>{assigningJob.dropoff.addressLine}</p><label className="eat-clean-field"><span>Shipper đang sẵn sàng</span><select value={shipperId} onChange={(event) => setShipperId(event.target.value)}><option value="">Chọn shipper</option>{availableDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name} · {driver.activeJobCount} chuyến</option>)}</select></label>{!otpReady && <div className="eat-clean-inline-error">Khóa OTP giao hàng chưa sẵn sàng. Không thể gán shipper.</div>}{availableDrivers.length === 0 && <div className="eat-clean-inline-error">Hiện không có shipper sẵn sàng.</div>}<footer><button type="button" className="eat-clean-secondary-button" onClick={() => setAssigningJob(null)}>Hủy</button><button type="button" className="eat-clean-primary-button" onClick={() => void assign()} disabled={!otpReady || !shipperId || saving}><UserCheck size={17} /> {saving ? 'Đang gán…' : 'Xác nhận gán'}</button></footer></section></div>}
    </section>
  )
}
