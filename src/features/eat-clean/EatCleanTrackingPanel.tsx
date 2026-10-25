import { useMemo, useState } from 'react'
import { Bike, Clock3, LoaderCircle, MapPin, Phone, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { getEatCleanOrderTracking } from './eatCleanService'
import { EatCleanTrackingMap as TrackingMap } from './EatCleanTrackingMap'
import { EAT_CLEAN_STATUS_LABELS, formatEatCleanDate } from './EatCleanUi'
import type { EatCleanOrder, EatCleanOrderTracking } from './types'
import { useForegroundRefresh } from '../../hooks/useForegroundRefresh'
import { useLocalTimeBoundaries } from '../../hooks/useLocalTimeBoundaries'

// Match the existing tracking response's two-minute GPS freshness window.
const GPS_STALE_AFTER_MS = 2 * 60_000

function etaLabel(value?: string) {
  if (!value) return 'Đang tính ETA'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const minutes = Math.max(0, Math.round((date.getTime() - Date.now()) / 60_000))
  const time = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(date)
  return minutes > 0 ? `${minutes} phút · khoảng ${time}` : `Dự kiến lúc ${time}`
}

export function EatCleanTrackingPanel({ order }: { order: EatCleanOrder }) {
  const [tracking, setTracking] = useState<EatCleanOrderTracking | null>(order.tracking ?? null)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<{ orderId: string; denied: boolean } | null>(null)
  const currentFailure = failure?.orderId === order.id ? failure : null
  const accessDenied = currentFailure?.denied === true
  const live: EatCleanOrderTracking = (tracking?.orderId === order.id ? tracking : order.tracking) ?? {
    orderId: order.id,
    status: order.status,
    shipper: order.shipper,
    destination: Number.isFinite(order.deliveryAddress.latitude) && Number.isFinite(order.deliveryAddress.longitude)
      ? { latitude: Number(order.deliveryAddress.latitude), longitude: Number(order.deliveryAddress.longitude) }
      : undefined,
    estimatedArrivalAt: order.estimatedArrivalAt,
    promisedAt: order.promisedAt,
  }
  const terminal = ['delivered', 'cancelled'].includes(live.status) || ['delivered', 'cancelled'].includes(order.status)
  const locationMillis = Date.parse(live.lastLocationAt || '')
  const boundaryNow = useLocalTimeBoundaries(!accessDenied && !terminal && live.shipperLocation
    ? [locationMillis + GPS_STALE_AFTER_MS + 1] : [])
  const gpsStale = Boolean(live.stale || (!terminal && live.shipperLocation
    && (!Number.isFinite(locationMillis) || boundaryNow - locationMillis > GPS_STALE_AFTER_MS)))

  const read = async (quiet: boolean, isCurrent: () => boolean) => {
    // A queued interval/focus callback can run before passive-effect cleanup.
    // Guard the read itself so a render that paused recovery cannot call again.
    if (quiet && (currentFailure || terminal)) return
    if (!quiet) setLoading(true)
    try {
      const next = await getEatCleanOrderTracking(order.id)
      if (isCurrent() && next) {
        setTracking(next)
        setFailure(null)
      }
    } catch (error) {
      if (isCurrent()) {
        const code = String((error as { code?: unknown })?.code || '').replace(/^functions\//, '')
        const denied = ['permission-denied', 'unauthenticated', 'not-found'].includes(code)
        if (denied) setTracking(null)
        // A later transient retry failure cannot restore data hidden after
        // access denial. Only an authorized successful response clears it.
        setFailure(current => ({ orderId: order.id, denied: denied || (current?.orderId === order.id && current.denied) }))
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  const { refresh } = useForegroundRefresh({ scopeKey: `tracking:${order.id}`, read, intervalMs: terminal || currentFailure ? null : 15_000, enabled: !order.id.startsWith('demo-order-') })

  const eta = live.estimatedArrivalAt || order.estimatedArrivalAt
  const shipper = live.shipper || order.shipper
  const locationFreshness = useMemo(() => live.lastLocationAt ? formatEatCleanDate(live.lastLocationAt) : 'Chưa có tín hiệu GPS', [live.lastLocationAt])
  const showDeliveryOtp = Boolean(live.deliveryOtp && shipper && ['assigned', 'picked-up', 'delivering', 'arrived'].includes(live.status))

  return (
    <section className="eat-clean-card eat-clean-live-tracking">
      <header>
        <div><small>THEO DÕI GIAO HÀNG</small><h2>{accessDenied ? 'Hành trình đơn hàng' : `Hành trình: ${EAT_CLEAN_STATUS_LABELS[live.status]}`}</h2>{!accessDenied && <p><Clock3 size={15} /> {terminal ? EAT_CLEAN_STATUS_LABELS[live.status] : etaLabel(eta)}</p>}</div>
        <button type="button" onClick={() => void refresh(false)} disabled={loading} aria-label="Làm mới vị trí">{loading ? <LoaderCircle className="eat-clean-spin" size={19} /> : <RefreshCw size={19} />}</button>
      </header>
      {!accessDenied && <><TrackingMap tracking={live} />
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
        <div className={`eat-clean-gps-state ${gpsStale ? 'is-stale' : ''}`}>
          {gpsStale ? <TriangleAlert size={16} /> : <ShieldCheck size={16} />}
          <span>{gpsStale ? 'Tín hiệu GPS đang chậm' : 'Vị trí được bảo vệ'}<small>Cập nhật: {locationFreshness}</small></span>
        </div>
        {showDeliveryOtp && <div className="eat-clean-delivery-otp"><ShieldCheck size={20} /><span><small>MÃ XÁC NHẬN GIAO HÀNG</small><strong aria-label={`Mã giao hàng ${live.deliveryOtp}`}>{live.deliveryOtp?.split('').map((digit, index) => <i key={`${digit}-${index}`}>{digit}</i>)}</strong><em>Chỉ đọc mã này khi bạn đã nhận đủ món.</em></span></div>}
        {live.promisedAt && <p className="eat-clean-sla"><MapPin size={15} /> Cam kết hoàn thành trước {formatEatCleanDate(live.promisedAt)}</p>}
      </div></>}
      {currentFailure && <p className="eat-clean-inline-message" role="status">{accessDenied
        ? 'Không thể truy cập hành trình đơn này. Vui lòng kiểm tra tài khoản hoặc bấm làm mới để thử lại.'
        : 'Chưa thể cập nhật vị trí. Dữ liệu lần trước được giữ lại; bấm làm mới để thử lại.'}</p>}
    </section>
  )
}
