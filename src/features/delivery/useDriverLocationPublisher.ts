import { useCallback, useEffect, useRef, useState } from 'react'
import { publishEatCleanDriverLocation } from './deliveryService'

export type DriverLocationState = 'idle' | 'requesting' | 'sharing' | 'unavailable' | 'error'

function distanceInMeters(left: GeolocationCoordinates, right: GeolocationCoordinates) {
  const earthRadius = 6_371_000
  const toRadians = (value: number) => value * Math.PI / 180
  const latitudeDelta = toRadians(right.latitude - left.latitude)
  const longitudeDelta = toRadians(right.longitude - left.longitude)
  const leftLatitude = toRadians(left.latitude)
  const rightLatitude = toRadians(right.latitude)
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

export function useDriverLocationPublisher(deliveryId: string | null, driverId: string, trackingReady: boolean) {
  const watchIdRef = useRef<number | null>(null)
  const lastPositionRef = useRef<GeolocationPosition | null>(null)
  const lastPublishedAtRef = useRef(0)
  const publishInFlightRef = useRef(false)
  const generationRef = useRef(0)
  const [state, setState] = useState<DriverLocationState>('idle')
  const [message, setMessage] = useState('')

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    watchIdRef.current = null
    lastPositionRef.current = null
    lastPublishedAtRef.current = 0
    publishInFlightRef.current = false
    generationRef.current += 1
    setState('idle')
  }, [])

  const start = useCallback(() => {
    if (!deliveryId) return
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    const generation = generationRef.current + 1
    generationRef.current = generation
    publishInFlightRef.current = false
    if (!trackingReady) {
      setState('unavailable')
      setMessage('Hạ tầng GPS realtime phía máy chủ chưa sẵn sàng. Bạn vẫn có thể cập nhật các mốc giao hàng.')
      return
    }
    if (!('geolocation' in navigator)) {
      setState('unavailable')
      setMessage('Thiết bị này không hỗ trợ định vị GPS.')
      return
    }

    setState('requesting')
    setMessage('Đang xin quyền truy cập vị trí…')
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (generationRef.current !== generation) return
        const now = Date.now()
        if (publishInFlightRef.current) return
        const movedMeters = lastPositionRef.current
          ? distanceInMeters(lastPositionRef.current.coords, position.coords)
          : Number.POSITIVE_INFINITY
        if (movedMeters < 30 && now - lastPublishedAtRef.current < 15_000) {
          setState('sharing')
          return
        }
        // Record the attempt before awaiting the network so rapid GPS callbacks
        // cannot create concurrent callable requests while connectivity is weak.
        lastPositionRef.current = position
        lastPublishedAtRef.current = now
        publishInFlightRef.current = true
        void publishEatCleanDriverLocation(deliveryId, driverId, position)
          .then(() => {
            if (generationRef.current !== generation) return
            setState('sharing')
            setMessage(`Đã gửi vị trí · độ chính xác khoảng ${Math.round(position.coords.accuracy)} m`)
          })
          .catch((error) => {
            if (generationRef.current !== generation) return
            setState('error')
            setMessage(error instanceof Error ? error.message : 'Không thể cập nhật vị trí realtime.')
          })
          .finally(() => {
            if (generationRef.current === generation) publishInFlightRef.current = false
          })
      },
      (error) => {
        if (generationRef.current !== generation) return
        if (error.code === error.PERMISSION_DENIED && watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current)
          watchIdRef.current = null
        }
        setState(error.code === error.PERMISSION_DENIED ? 'unavailable' : 'error')
        setMessage(error.code === error.PERMISSION_DENIED
          ? 'Quyền vị trí đang bị tắt. Hãy cho phép định vị trong cài đặt trình duyệt.'
          : 'GPS đang không ổn định. Aura sẽ tự thử lại khi có tín hiệu.')
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    )
  }, [deliveryId, driverId, trackingReady])

  useEffect(() => stop, [stop])
  useEffect(() => {
    stop()
  }, [deliveryId, stop])

  return { state, message, start, stop, configured: trackingReady }
}
