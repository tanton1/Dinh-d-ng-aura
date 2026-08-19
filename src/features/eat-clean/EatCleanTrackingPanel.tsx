import { useEffect, useMemo, useRef, useState } from 'react'
import { Bike, Clock3, LoaderCircle, MapPin, Navigation, Phone, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { getEatCleanOrderTracking } from './eatCleanService'
import { googleMapsConfigured, loadGoogleMaps } from './googleMapsLoader'
import { EAT_CLEAN_STATUS_LABELS, formatEatCleanDate } from './EatCleanUi'
import type { EatCleanCoordinate, EatCleanOrder, EatCleanOrderTracking } from './types'

function etaLabel(value?: string) {
  if (!value) return 'Đang tính ETA'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const minutes = Math.max(0, Math.round((date.getTime() - Date.now()) / 60_000))
  const time = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(date)
  return minutes > 0 ? `${minutes} phút · khoảng ${time}` : `Dự kiến lúc ${time}`
}

function toMapPosition(coordinate?: EatCleanCoordinate) {
  return coordinate ? { lat: coordinate.latitude, lng: coordinate.longitude } : undefined
}

function TrackingMap({ tracking }: { tracking: EatCleanOrderTracking }) {
  const elementRef = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const center = tracking.shipperLocation || tracking.destination || tracking.kitchenLocation

  useEffect(() => {
    let active = true
    const markers: Array<{ setMap: (map: unknown) => void }> = []
    void loadGoogleMaps().then((maps) => {
      if (!active) return
      setAvailable(Boolean(maps))
      if (!maps || !elementRef.current || !center) return
      const map = new maps.Map(elementRef.current, {
        center: toMapPosition(center),
        zoom: 14,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      })
      const points = [
        { coordinate: tracking.kitchenLocation, title: 'Bếp Aura' },
        { coordinate: tracking.destination, title: 'Điểm nhận hàng' },
        { coordinate: tracking.shipperLocation, title: 'Shipper' },
      ]
      points.forEach(({ coordinate, title }) => {
        if (!coordinate) return
        markers.push(new maps.Marker({ map, position: toMapPosition(coordinate), title }))
      })
    })
    return () => { active = false; markers.forEach((marker) => marker.setMap(null)) }
  }, [center?.latitude, center?.longitude, tracking.destination?.latitude, tracking.destination?.longitude, tracking.kitchenLocation?.latitude, tracking.kitchenLocation?.longitude, tracking.shipperLocation?.latitude, tracking.shipperLocation?.longitude])

  if (!googleMapsConfigured() || available === false || !center) {
    return (
      <div className="eat-clean-tracking-map is-fallback">
        <div><Navigation size={29} /><strong>{center ? 'Theo dõi vị trí đang hoạt động' : 'Chưa có vị trí shipper'}</strong><span>{center ? 'Bản đồ trực quan sẽ hiện khi Google Maps được cấu hình.' : 'Bản đồ sẽ tự cập nhật sau khi shipper nhận đơn.'}</span></div>
      </div>
    )
  }
  return <div ref={elementRef} className="eat-clean-tracking-map">{available === null && <LoaderCircle className="eat-clean-spin" size={25} />}</div>
}

export function EatCleanTrackingPanel({ order }: { order: EatCleanOrder }) {
  const [tracking, setTracking] = useState<EatCleanOrderTracking | null>(order.tracking ?? null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const refreshInFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const live: EatCleanOrderTracking = tracking ?? {
    orderId: order.id,
    status: order.status,
    shipper: order.shipper,
    destination: Number.isFinite(order.deliveryAddress.latitude) && Number.isFinite(order.deliveryAddress.longitude)
      ? { latitude: Number(order.deliveryAddress.latitude), longitude: Number(order.deliveryAddress.longitude) }
      : undefined,
    estimatedArrivalAt: order.estimatedArrivalAt,
    promisedAt: order.promisedAt,
  }
  const terminal = live.status === 'delivered' || live.status === 'cancelled'

  const refresh = async (quiet = false) => {
    if (refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    if (!quiet) setLoading(true)
    try {
      const next = await getEatCleanOrderTracking(order.id)
      if (mountedRef.current && next) {
        setTracking(next)
        setMessage('')
      }
    } catch {
      if (mountedRef.current && !quiet) setMessage('Chưa thể cập nhật vị trí. Timeline đơn hàng vẫn được giữ nguyên.')
    } finally {
      refreshInFlightRef.current = false
      if (mountedRef.current && !quiet) setLoading(false)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (order.id.startsWith('demo-order-')) return
    void refresh(true)
    if (terminal) return
    const interval = window.setInterval(() => void refresh(true), 15_000)
    return () => window.clearInterval(interval)
    // Poll theo orderId; tránh tạo lại timer khi ETA thay đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, terminal])

  const eta = live.estimatedArrivalAt || order.estimatedArrivalAt
  const shipper = live.shipper || order.shipper
  const locationFreshness = useMemo(() => live.lastLocationAt ? formatEatCleanDate(live.lastLocationAt) : 'Chưa có tín hiệu GPS', [live.lastLocationAt])
  const showDeliveryOtp = Boolean(live.deliveryOtp && shipper && ['assigned', 'picked-up', 'delivering', 'arrived'].includes(live.status))

  return (
    <section className="eat-clean-card eat-clean-live-tracking">
      <header>
        <div><small>THEO DÕI GIAO HÀNG</small><h2>Hành trình: {EAT_CLEAN_STATUS_LABELS[live.status]}</h2><p><Clock3 size={15} /> {terminal ? EAT_CLEAN_STATUS_LABELS[live.status] : etaLabel(eta)}</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Làm mới vị trí">{loading ? <LoaderCircle className="eat-clean-spin" size={19} /> : <RefreshCw size={19} />}</button>
      </header>
      <TrackingMap tracking={live} />
      <div className="eat-clean-tracking-meta">
        {shipper ? (
          <div className="eat-clean-shipper-card">
            <span>{shipper.avatarUrl ? <img src={shipper.avatarUrl} alt="" /> : <Bike size={21} />}</span>
            <div><small>Đối tác giao hàng</small><strong>{shipper.displayName}</strong><em>{[shipper.vehicleLabel, shipper.plateNumber].filter(Boolean).join(' · ') || 'Aura Delivery'}</em></div>
            {shipper.phone && <a href={`tel:${shipper.phone}`} aria-label={`Gọi ${shipper.displayName}`}><Phone size={18} /></a>}
          </div>
        ) : (
          <div className="eat-clean-tracking-wait"><Bike size={20} /><span><strong>Đang chờ shipper nhận đơn</strong><small>Aura sẽ báo ngay khi có người giao.</small></span></div>
        )}
        <div className={`eat-clean-gps-state ${live.stale ? 'is-stale' : ''}`}>
          {live.stale ? <TriangleAlert size={16} /> : <ShieldCheck size={16} />}
          <span>{live.stale ? 'Tín hiệu GPS đang chậm' : 'Vị trí được bảo vệ'}<small>Cập nhật: {locationFreshness}</small></span>
        </div>
        {showDeliveryOtp && <div className="eat-clean-delivery-otp"><ShieldCheck size={20} /><span><small>MÃ XÁC NHẬN GIAO HÀNG</small><strong aria-label={`Mã giao hàng ${live.deliveryOtp}`}>{live.deliveryOtp?.split('').map((digit, index) => <i key={`${digit}-${index}`}>{digit}</i>)}</strong><em>Chỉ đọc mã này khi bạn đã nhận đủ món.</em></span></div>}
        {live.promisedAt && <p className="eat-clean-sla"><MapPin size={15} /> Cam kết hoàn thành trước {formatEatCleanDate(live.promisedAt)}</p>}
      </div>
      {message && <p className="eat-clean-inline-message" role="status">{message}</p>}
    </section>
  )
}
