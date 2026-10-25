import { useCallback, useEffect, useRef, useState } from 'react'
import { publishEatCleanDriverLocation } from './deliveryService'
import { createLocationPublisher } from './locationPublisher'

export type DriverLocationState = 'idle' | 'requesting' | 'sharing' | 'unavailable' | 'error'

export function useDriverLocationPublisher(deliveryId: string | null, driverId: string, trackingReady: boolean) {
  const watchIdRef = useRef<number | null>(null)
  const publisherRef = useRef<ReturnType<typeof createLocationPublisher> | null>(null)
  const generationRef = useRef(0)
  const [state, setState] = useState<DriverLocationState>('idle')
  const [message, setMessage] = useState('')

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    watchIdRef.current = null
    publisherRef.current?.stop()
    publisherRef.current = null
    generationRef.current += 1
    setState('idle')
  }, [])

  const start = useCallback(() => {
    stop()
    if (!deliveryId || !driverId) return
    const generation = generationRef.current
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
    const publisher = createLocationPublisher({
      publish: (position) => publishEatCleanDriverLocation(deliveryId, driverId, position),
      now: Date.now,
      online: () => navigator.onLine !== false,
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer as number),
      onResult: (position, result) => {
        if (generationRef.current !== generation) return
        setState('sharing')
        setMessage(result.accepted
          ? `Đã gửi vị trí · độ chính xác khoảng ${Math.round(position.coords.accuracy)} m`
          : 'Đang chờ vị trí mới đủ chính xác để cập nhật.')
      },
      onRejected: () => {
        if (generationRef.current === generation) setMessage('Đang chờ tín hiệu GPS mới, có độ chính xác tốt hơn.')
      },
      onError: (error) => {
        if (generationRef.current !== generation) return
        const code = String((error as { code?: unknown })?.code || '')
        if (/permission-denied|unauthenticated|failed-precondition/.test(code)) stop()
        setState('error')
        setMessage(error instanceof Error ? error.message : 'Không thể cập nhật vị trí realtime.')
      },
    })
    publisherRef.current = publisher
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (generationRef.current !== generation) return
        publisher.offer(position)
      },
      (error) => {
        if (generationRef.current !== generation) return
        if (error.code === error.PERMISSION_DENIED && watchIdRef.current !== null) {
          stop()
        }
        setState(error.code === error.PERMISSION_DENIED ? 'unavailable' : 'error')
        setMessage(error.code === error.PERMISSION_DENIED
          ? 'Quyền vị trí đang bị tắt. Hãy cho phép định vị trong cài đặt trình duyệt.'
          : 'GPS đang không ổn định. Aura sẽ tự thử lại khi có tín hiệu.')
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    )
  }, [deliveryId, driverId, trackingReady, stop])

  useEffect(() => stop, [stop])
  useEffect(() => {
    stop()
  }, [deliveryId, driverId, trackingReady, stop])
  useEffect(() => {
    const resume = () => publisherRef.current?.resume()
    window.addEventListener('online', resume)
    return () => window.removeEventListener('online', resume)
  }, [])

  return { state, message, start, stop, configured: trackingReady }
}
