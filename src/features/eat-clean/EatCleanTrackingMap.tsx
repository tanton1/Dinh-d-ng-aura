import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LoaderCircle, Navigation } from 'lucide-react'
import { googleMapsConfigured, loadGoogleMaps, type AuraGoogleMapsApi } from './googleMapsLoader'
import type { EatCleanCoordinate, EatCleanOrderTracking } from './types'

type Position = { lat: number; lng: number }
type Marker = InstanceType<AuraGoogleMapsApi['Marker']>
type MapRuntime = {
  api: AuraGoogleMapsApi
  map: InstanceType<AuraGoogleMapsApi['Map']>
  markers: Map<string, { marker: Marker; key: string }>
  center: string
  orderId: string
}

function position(coordinate?: EatCleanCoordinate): Position | undefined {
  if (!coordinate || !Number.isFinite(coordinate.latitude) || !Number.isFinite(coordinate.longitude)
    || Math.abs(coordinate.latitude) > 90 || Math.abs(coordinate.longitude) > 180) return undefined
  return { lat: coordinate.latitude, lng: coordinate.longitude }
}
const positionKey = (value: Position) => `${value.lat},${value.lng}`
const centerOf = (tracking: EatCleanOrderTracking) => position(tracking.shipperLocation) || position(tracking.destination) || position(tracking.kitchenLocation)

function syncMap(runtime: MapRuntime, tracking: EatCleanOrderTracking) {
  const points = [
    { id: 'kitchen', title: 'Bếp Aura', coordinate: tracking.kitchenLocation },
    { id: 'destination', title: 'Điểm nhận hàng', coordinate: tracking.destination },
    { id: 'shipper', title: 'Shipper', coordinate: tracking.shipperLocation },
  ]
  for (const point of points) {
    const next = position(point.coordinate), previous = runtime.markers.get(point.id)
    if (!next) {
      previous?.marker.setMap(null)
      runtime.markers.delete(point.id)
    } else if (!previous) {
      runtime.markers.set(point.id, { marker: new runtime.api.Marker({ map: runtime.map, position: next, title: point.title }), key: positionKey(next) })
    } else if (previous.key !== positionKey(next)) {
      previous.marker.setPosition(next)
      previous.key = positionKey(next)
    }
  }
  const center = centerOf(tracking)
  if (center && (runtime.center !== positionKey(center) || runtime.orderId !== tracking.orderId)) {
    runtime.map.panTo(center)
    runtime.center = positionKey(center)
  }
  if (runtime.orderId !== tracking.orderId) runtime.map.setZoom(14)
  runtime.orderId = tracking.orderId
}

export function EatCleanTrackingMap({ tracking }: { tracking: EatCleanOrderTracking }) {
  const element = useRef<HTMLDivElement>(null)
  const runtime = useRef<MapRuntime | null>(null)
  const latest = useRef(tracking)
  latest.current = tracking
  const [available, setAvailable] = useState<boolean | null>(null)
  const [retry, setRetry] = useState(0)
  const configured = googleMapsConfigured(), center = centerOf(tracking)
  const enabled = configured && Boolean(center)

  useEffect(() => {
    if (!enabled || runtime.current) return
    let active = true
    setAvailable(null)
    void loadGoogleMaps().then(api => {
      if (!active) return
      const current = latest.current, currentCenter = centerOf(current)
      if (!api || !element.current || !currentCenter) { setAvailable(false); return }
      element.current.replaceChildren()
      const map = new api.Map(element.current, { center: currentCenter, zoom: 14, mapTypeControl: false, streetViewControl: false, fullscreenControl: false })
      runtime.current = { api, map, markers: new Map(), center: positionKey(currentCenter), orderId: current.orderId }
      syncMap(runtime.current, current)
      setAvailable(true)
    }).catch(() => {
      if (!active) return
      runtime.current?.markers.forEach(({ marker }) => marker.setMap(null))
      runtime.current = null
      element.current?.replaceChildren()
      setAvailable(false)
    })
    return () => { active = false }
  }, [enabled, retry])

  // Update or remove old-order markers before a changed order can paint.
  useLayoutEffect(() => { if (runtime.current) syncMap(runtime.current, tracking) }, [tracking])
  useEffect(() => {
    const canvas = element.current
    return () => {
      runtime.current?.markers.forEach(({ marker }) => marker.setMap(null))
      runtime.current = null
      canvas?.replaceChildren()
    }
  }, [])

  const fallback = !enabled || available === false
  return <div className={`eat-clean-tracking-map${fallback ? ' is-fallback' : ''}`}>
    <div ref={element} className="eat-clean-tracking-map__canvas" hidden={fallback} aria-label="Bản đồ giao hàng" />
    {fallback && <div className="eat-clean-tracking-map__fallback">
      <Navigation size={29} /><strong>{center ? 'Theo dõi vị trí đang hoạt động' : 'Chưa có vị trí shipper'}</strong>
      <span>{!center ? 'Bản đồ sẽ tự cập nhật sau khi shipper nhận đơn.' : configured ? 'Chưa thể tải bản đồ. Trạng thái giao hàng vẫn được giữ nguyên.' : 'Bản đồ trực quan sẽ hiện khi Google Maps được cấu hình.'}</span>
      {enabled && available === false && <button type="button" className="eat-clean-button eat-clean-button--secondary" onClick={() => setRetry(value => value + 1)}>Thử lại bản đồ</button>}
    </div>}
    {!fallback && available === null && <LoaderCircle className="eat-clean-spin" size={25} />}
  </div>
}
