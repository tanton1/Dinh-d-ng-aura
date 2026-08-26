import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  BriefcaseBusiness,
  Check,
  Crosshair,
  Home,
  LoaderCircle,
  LocateFixed,
  Map,
  MapPin,
  Navigation,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { readCachedEatCleanAddresses, writeCachedEatCleanAddresses } from './addressStorage'
import {
  deleteEatCleanAddress,
  isEatCleanDemoMode,
  listEatCleanAddresses,
  saveEatCleanAddress,
  setDefaultEatCleanAddress,
} from './eatCleanService'
import {
  deliveryAddressFromPlace,
  getGoogleMapsClientHealth,
  googleMapsConfigured,
  googleMapsClientMessage,
  loadGoogleMaps,
  loadGooglePlaces,
  placeFromAutocompleteEvent,
  reverseGeocodeCoordinate,
} from './googleMapsLoader'
import type {
  EatCleanAddressKind,
  EatCleanCheckoutContact,
  EatCleanCoordinate,
  EatCleanDeliveryAddress,
  EatCleanDistrict,
  EatCleanSavedAddress,
} from './types'

const DEFAULT_DA_NANG: EatCleanCoordinate = { latitude: 16.0544, longitude: 108.2022 }

function addressIcon(kind: EatCleanAddressKind) {
  if (kind === 'home') return <Home size={17} />
  if (kind === 'work') return <BriefcaseBusiness size={17} />
  return <MapPin size={17} />
}

function addressToDelivery(address: EatCleanSavedAddress): EatCleanDeliveryAddress {
  return {
    addressLine: address.addressLine,
    formattedAddress: address.formattedAddress,
    ward: address.ward,
    districtId: address.districtId,
    district: address.district,
    city: address.city,
    placeId: address.placeId,
    latitude: address.latitude,
    longitude: address.longitude,
    entranceNote: address.entranceNote,
    savedAddressId: address.id,
    label: address.label,
  }
}

function coordinatesOf(address: EatCleanDeliveryAddress): EatCleanCoordinate | null {
  if (!Number.isFinite(address.latitude) || !Number.isFinite(address.longitude)) return null
  return { latitude: Number(address.latitude), longitude: Number(address.longitude) }
}

function normalizeDistrictName(value?: string) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(quan|huyen|thi xa|thanh pho)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function districtIdFromGoogle(districtName: string | undefined, districts: EatCleanDistrict[], fallback?: string) {
  const target = normalizeDistrictName(districtName)
  if (!target) return fallback
  return districts.find((district) => {
    const candidate = normalizeDistrictName(district.name)
    return candidate === target || candidate.includes(target) || target.includes(candidate)
  })?.id ?? fallback
}

function localAddressId() {
  return typeof crypto.randomUUID === 'function'
    ? `local-${crypto.randomUUID()}`
    : `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function EatCleanDeliveryPanel({
  ownerId,
  contact,
  address,
  districts,
  onContactChange,
  onAddressChange,
}: {
  ownerId?: string
  contact: EatCleanCheckoutContact
  address: EatCleanDeliveryAddress
  districts: EatCleanDistrict[]
  onContactChange: (value: EatCleanCheckoutContact) => void
  onAddressChange: (value: EatCleanDeliveryAddress) => void
}) {
  const [addresses, setAddresses] = useState<EatCleanSavedAddress[]>(() => readCachedEatCleanAddresses(ownerId))
  const [loadingAddresses, setLoadingAddresses] = useState(false)
  const [mapMode, setMapMode] = useState<'manual' | 'current' | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveKind, setSaveKind] = useState<EatCleanAddressKind>('home')
  const [saveLabel, setSaveLabel] = useState('Nhà')
  const [saveDefault, setSaveDefault] = useState(false)
  const [message, setMessage] = useState('')
  const defaultAppliedRef = useRef(false)
  const latestAddressRef = useRef(address)
  const onContactChangeRef = useRef(onContactChange)
  const onAddressChangeRef = useRef(onAddressChange)
  const districtsRef = useRef(districts)
  latestAddressRef.current = address
  onContactChangeRef.current = onContactChange
  onAddressChangeRef.current = onAddressChange
  districtsRef.current = districts
  const activeDistricts = districts.filter((district) => district.active)
  const coordinate = coordinatesOf(address)

  useEffect(() => {
    defaultAppliedRef.current = false
    const cached = readCachedEatCleanAddresses(ownerId)
    setAddresses(cached)
    const applyDefault = (items: EatCleanSavedAddress[]) => {
      const saved = items.find((item) => item.isDefault)
      if (!saved || defaultAppliedRef.current || latestAddressRef.current.addressLine.trim()) return
      defaultAppliedRef.current = true
      onContactChangeRef.current(saved.contact)
      onAddressChangeRef.current({
        ...latestAddressRef.current,
        ...addressToDelivery(saved),
        deliveryDate: latestAddressRef.current.deliveryDate,
        deliveryWindow: latestAddressRef.current.deliveryWindow,
        deliveryMode: latestAddressRef.current.deliveryMode,
      })
    }
    applyDefault(cached)
    if (isEatCleanDemoMode) return
    let active = true
    setLoadingAddresses(true)
    void listEatCleanAddresses()
      .then((items) => {
        if (!active) return
        const next = writeCachedEatCleanAddresses(ownerId, items)
        setAddresses(next)
        applyDefault(next)
      })
      .catch(() => { /* Cache cục bộ vẫn dùng được khi offline. */ })
      .finally(() => { if (active) setLoadingAddresses(false) })
    return () => { active = false }
  }, [ownerId])

  const selectAddress = (saved: EatCleanSavedAddress) => {
    onContactChange(saved.contact)
    onAddressChange({
      ...address,
      ...addressToDelivery(saved),
      deliveryDate: address.deliveryDate,
      deliveryWindow: address.deliveryWindow,
      deliveryMode: address.deliveryMode,
    })
    setMessage(`Đã chọn ${saved.label}.`)
  }

  const openSave = () => {
    if (!coordinate || !address.addressLine.trim() || !contact.fullName.trim() || !contact.phone.trim()) {
      setMessage('Hãy nhập người nhận, địa chỉ và ghim vị trí trước khi lưu.')
      return
    }
    const currentSaved = addresses.find((item) => item.id === address.savedAddressId)
    const nextKind = currentSaved?.kind ?? (/^nhà$/i.test(address.label ?? '') ? 'home' : /^(công ty|văn phòng)$/i.test(address.label ?? '') ? 'work' : 'other')
    setSaveKind(nextKind)
    setSaveLabel(currentSaved?.label || address.label || (nextKind === 'home' ? 'Nhà' : nextKind === 'work' ? 'Công ty' : ''))
    setSaveDefault(currentSaved?.isDefault ?? false)
    setSaveOpen(true)
  }

  const commitSave = async () => {
    if (!coordinate) return
    setSaving(true)
    setMessage('')
    const localId = address.savedAddressId || localAddressId()
    const draft: EatCleanSavedAddress = {
      id: localId,
      kind: saveKind,
      label: saveLabel.trim() || (saveKind === 'home' ? 'Nhà' : saveKind === 'work' ? 'Công ty' : 'Địa chỉ'),
      contact,
      addressLine: address.addressLine.trim(),
      formattedAddress: address.formattedAddress,
      ward: address.ward,
      districtId: address.districtId,
      district: address.district,
      city: address.city,
      placeId: address.placeId,
      ...coordinate,
      entranceNote: address.entranceNote,
      isDefault: saveDefault,
    }
    const optimistic = [draft, ...addresses.filter((item) => item.id !== localId)].map((item) => ({
      ...item,
      isDefault: saveDefault ? item.id === localId : item.isDefault,
    }))
    setAddresses(writeCachedEatCleanAddresses(ownerId, optimistic))
    try {
      const saved = isEatCleanDemoMode ? draft : await saveEatCleanAddress({ ...draft, id: address.savedAddressId })
      let next = [saved, ...optimistic.filter((item) => item.id !== localId && item.id !== saved.id)]
      if (saveDefault && !isEatCleanDemoMode) {
        await setDefaultEatCleanAddress(saved.id)
        next = next.map((item) => ({ ...item, isDefault: item.id === saved.id }))
      }
      setAddresses(writeCachedEatCleanAddresses(ownerId, next))
      onAddressChange({ ...address, savedAddressId: saved.id, label: saved.label })
      setMessage(`Đã lưu địa chỉ “${saved.label}”.`)
    } catch {
      setMessage('Chưa đồng bộ được lên tài khoản; địa chỉ đã được lưu tạm trên thiết bị này.')
    } finally {
      setSaving(false)
      setSaveOpen(false)
    }
  }

  const removeSaved = async (saved: EatCleanSavedAddress) => {
    const next = addresses.filter((item) => item.id !== saved.id)
    setAddresses(writeCachedEatCleanAddresses(ownerId, next))
    if (!saved.id.startsWith('local-') && !isEatCleanDemoMode) {
      try { await deleteEatCleanAddress(saved.id) } catch { setMessage('Địa chỉ đã ẩn trên thiết bị; chưa đồng bộ được thao tác xóa.') }
    }
  }

  return (
    <section className="eat-clean-card eat-clean-delivery-card">
      <div className="eat-clean-section-heading">
        <div><small>BƯỚC 1</small><h2>Giao đến đâu?</h2></div>
        <MapPin size={21} />
      </div>

      {(addresses.length > 0 || loadingAddresses) && (
        <div className="eat-clean-saved-addresses" aria-label="Địa chỉ đã lưu">
          {addresses.map((saved) => (
            <div key={saved.id} className={`eat-clean-saved-address ${address.savedAddressId === saved.id ? 'is-active' : ''}`}>
              <button type="button" onClick={() => selectAddress(saved)}>
                <i>{addressIcon(saved.kind)}</i>
                <span><strong>{saved.label}{saved.isDefault ? <em><Star size={11} fill="currentColor" /> Mặc định</em> : null}</strong><small>{saved.addressLine}</small></span>
                {address.savedAddressId === saved.id ? <Check size={17} /> : <Navigation size={16} />}
              </button>
              <button type="button" aria-label={`Xóa ${saved.label}`} onClick={() => void removeSaved(saved)}><Trash2 size={14} /></button>
            </div>
          ))}
          {loadingAddresses && <span className="eat-clean-address-loading"><LoaderCircle className="eat-clean-spin" size={16} /> Đang đồng bộ…</span>}
        </div>
      )}

      <div className="eat-clean-location-actions">
        <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMapMode('current') }}><LocateFixed size={18} /><span><strong>Vị trí hiện tại</strong><small>Mở bản đồ và định vị bằng GPS</small></span></button>
        <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMapMode('manual') }}><Map size={18} /><span><strong>Chọn trên bản đồ</strong><small>{googleMapsConfigured() ? 'Kéo ghim đến cửa nhận hàng' : 'Nhập tay khi Maps chưa cấu hình'}</small></span></button>
      </div>

      {!googleMapsConfigured() && <div className="eat-clean-maps-fallback-note"><AlertTriangle size={18} /><span><strong>Tìm kiếm bản đồ chưa được cấu hình</strong><small>Bạn vẫn có thể nhập địa chỉ bên dưới hoặc dùng GPS để ghim tọa độ.</small></span><button type="button" onClick={() => setMapMode('manual')}>Kiểm tra</button></div>}

      <div className="eat-clean-form-grid">
        <label><span>Họ và tên</span><input value={contact.fullName} onChange={(event) => onContactChange({ ...contact, fullName: event.target.value })} autoComplete="name" /></label>
        <label><span>Số điện thoại</span><input inputMode="tel" value={contact.phone} onChange={(event) => onContactChange({ ...contact, phone: event.target.value })} autoComplete="tel" /></label>
        <label className="eat-clean-field--full"><span>Số nhà, tên đường</span><input value={address.addressLine} onChange={(event) => onAddressChange({ ...address, addressLine: event.target.value, formattedAddress: undefined, placeId: undefined, latitude: undefined, longitude: undefined, savedAddressId: undefined, label: undefined })} placeholder="Ví dụ: 28 Nguyễn Chí Thanh" autoComplete="street-address" /></label>
        <label><span>Phường/xã</span><input value={address.ward ?? ''} onChange={(event) => onAddressChange({ ...address, ward: event.target.value, formattedAddress: undefined, placeId: undefined, latitude: undefined, longitude: undefined, savedAddressId: undefined, label: undefined })} placeholder="Phường/xã" /></label>
        <label><span>Quận/huyện</span><select value={address.districtId ?? ''} onChange={(event) => { const districtId = event.target.value; onAddressChange({ ...address, districtId, district: activeDistricts.find((item) => item.id === districtId)?.name, formattedAddress: undefined, placeId: undefined, latitude: undefined, longitude: undefined, savedAddressId: undefined, label: undefined }) }}>{activeDistricts.length === 0 && <option value="hai-chau">Hải Châu</option>}{activeDistricts.map((district) => <option key={district.id} value={district.id}>{district.name}</option>)}</select></label>
        <label className="eat-clean-field--full"><span>Chỉ dẫn cho shipper</span><input value={address.entranceNote ?? ''} onChange={(event) => onAddressChange({ ...address, entranceNote: event.target.value })} placeholder="Ví dụ: cổng bên phải, gọi trước khi đến" /></label>
      </div>
      <div className={`eat-clean-coordinate-state ${coordinate ? 'is-ready' : ''}`}>
        <Crosshair size={17} />
        <span>{coordinate ? `Đã ghim ${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}` : 'Chưa ghim vị trí — phí ship theo km chỉ được tính sau khi có tọa độ.'}</span>
        <button type="button" onClick={openSave}><Plus size={15} /> Lưu địa chỉ</button>
      </div>
      {message && <p className="eat-clean-inline-message" role="status">{message}</p>}

      {mapMode && <AddressMapPicker address={address} districts={districts} locateOnOpen={mapMode === 'current'} onChange={onAddressChange} onClose={() => setMapMode(null)} />}
      {saveOpen && (
        <div className="eat-clean-sheet-backdrop" role="presentation">
          <section className="eat-clean-sheet" role="dialog" aria-modal="true" aria-label="Lưu địa chỉ">
            <header><div><small>CHỌN TÊN GỢI NHỚ</small><h2>Lưu cho lần đặt sau</h2></div><button type="button" onClick={() => setSaveOpen(false)} aria-label="Đóng"><X size={20} /></button></header>
            <div className="eat-clean-address-kind">
              {(['home', 'work', 'other'] as const).map((kind) => <button type="button" key={kind} className={saveKind === kind ? 'is-active' : ''} onClick={() => { setSaveKind(kind); setSaveLabel(kind === 'home' ? 'Nhà' : kind === 'work' ? 'Công ty' : '') }}>{addressIcon(kind)} {kind === 'home' ? 'Nhà' : kind === 'work' ? 'Công ty' : 'Khác'}</button>)}
            </div>
            <label className="eat-clean-sheet-field"><span>Tên gợi nhớ</span><input value={saveLabel} onChange={(event) => setSaveLabel(event.target.value)} maxLength={40} placeholder="Ví dụ: Nhà mẹ, Phòng tập" /></label>
            <label className="eat-clean-default-check"><input type="checkbox" checked={saveDefault} onChange={(event) => setSaveDefault(event.target.checked)} /><span><strong>Đặt làm địa chỉ mặc định</strong><small>Tự động ưu tiên ở lần đặt tiếp theo</small></span></label>
            <button type="button" className="eat-clean-button eat-clean-button--primary" onClick={() => void commitSave()} disabled={saving}>{saving ? <LoaderCircle className="eat-clean-spin" size={18} /> : <Check size={18} />} Lưu địa chỉ</button>
          </section>
        </div>
      )}
    </section>
  )
}

function AddressMapPicker({ address, districts, locateOnOpen, onChange, onClose }: { address: EatCleanDeliveryAddress; districts: EatCleanDistrict[]; locateOnOpen: boolean; onChange: (value: EatCleanDeliveryAddress) => void; onClose: () => void }) {
  const sheetRef = useRef<HTMLElement>(null)
  const mapElement = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLSpanElement>(null)
  const mapRef = useRef<{ panTo: (position: { lat: number; lng: number }) => void; setZoom: (zoom: number) => void } | null>(null)
  const markerRef = useRef<{ setPosition: (position: { lat: number; lng: number }) => void; setMap: (map: unknown) => void } | null>(null)
  const autoLocateRequestedRef = useRef(false)
  const initialCoordinate = coordinatesOf(address)
  const [coordinate, setCoordinate] = useState<EatCleanCoordinate>(() => initialCoordinate ?? DEFAULT_DA_NANG)
  const coordinateRef = useRef(coordinate)
  const [pointConfirmed, setPointConfirmed] = useState(Boolean(initialCoordinate) && !locateOnOpen)
  const [selectedDetails, setSelectedDetails] = useState<Partial<EatCleanDeliveryAddress> | null>(() => address.addressLine ? {
    addressLine: address.addressLine,
    formattedAddress: address.formattedAddress,
    ward: address.ward,
    district: address.district,
    city: address.city,
    placeId: address.placeId,
  } : null)
  const [mapsReady, setMapsReady] = useState<boolean | null>(null)
  const [searchReady, setSearchReady] = useState(false)
  const [searchIssue, setSearchIssue] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [resolving, setResolving] = useState(false)
  const [locating, setLocating] = useState(false)
  const [mapMessage, setMapMessage] = useState(locateOnOpen ? 'Đang xin quyền truy cập vị trí…' : '')
  const [clientHealth, setClientHealth] = useState(getGoogleMapsClientHealth)
  const canUseMaps = googleMapsConfigured()
  coordinateRef.current = coordinate

  const selectCoordinate = (next: EatCleanCoordinate, details: Partial<EatCleanDeliveryAddress> | null = null) => {
    coordinateRef.current = next
    setCoordinate(next)
    setSelectedDetails(details)
    setPointConfirmed(true)
    const position = { lat: next.latitude, lng: next.longitude }
    markerRef.current?.setPosition(position)
    mapRef.current?.panTo(position)
    mapRef.current?.setZoom(16)
  }

  const locateCurrent = () => {
    if (!navigator.geolocation) {
      setMapMessage('Trình duyệt không hỗ trợ định vị. Hãy nhập địa chỉ thủ công để tiếp tục.')
      return
    }
    setLocating(true)
    setMapMessage('Đang xác định vị trí hiện tại…')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        selectCoordinate({ latitude: position.coords.latitude, longitude: position.coords.longitude })
        setLocating(false)
        setMapMessage('Đã ghim vị trí hiện tại. Bạn có thể kéo ghim để chỉnh chính xác hơn.')
      },
      () => {
        setLocating(false)
        setMapMessage('Không lấy được vị trí. Hãy bật quyền định vị hoặc nhập địa chỉ thủ công.')
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    )
  }

  const retryLoad = () => {
    setMapsReady(null)
    setSearchReady(false)
    setSearchIssue('')
    setMapMessage('Đang thử tải lại Google Maps…')
    setLoadAttempt((current) => current + 1)
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const visualViewport = window.visualViewport
    const syncViewportHeight = () => {
      const viewportHeight = Math.round(visualViewport?.height ?? window.innerHeight)
      sheetRef.current?.style.setProperty('--eat-clean-map-viewport-height', `${viewportHeight}px`)
    }
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    syncViewportHeight()
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', syncViewportHeight)
    visualViewport?.addEventListener('resize', syncViewportHeight)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', syncViewportHeight)
      visualViewport?.removeEventListener('resize', syncViewportHeight)
    }
  }, [onClose])

  useEffect(() => {
    if (locateOnOpen && !autoLocateRequestedRef.current) {
      autoLocateRequestedRef.current = true
      locateCurrent()
    }
    // Chỉ tự định vị một lần khi sheet vừa mở.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let active = true
    let marker: { setMap: (map: unknown) => void } | undefined
    let markerListener: { remove: () => void } | undefined
    let mapListener: { remove: () => void } | undefined
    setMapsReady(null)
    void loadGoogleMaps({ retry: loadAttempt > 0 }).then((maps) => {
      if (!active) return
      setClientHealth(getGoogleMapsClientHealth())
      setMapsReady(Boolean(maps))
      if (!maps || !mapElement.current) return
      mapElement.current.replaceChildren()
      const currentCoordinate = coordinateRef.current
      const center = { lat: currentCoordinate.latitude, lng: currentCoordinate.longitude }
      const map = new maps.Map(mapElement.current, { center, zoom: 16, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy' })
      const nextMarker = new maps.Marker({ map, position: center, draggable: true, title: 'Điểm nhận hàng' })
      marker = nextMarker
      mapRef.current = map
      markerRef.current = nextMarker
      markerListener = nextMarker.addListener('dragend', () => {
        const position = nextMarker.getPosition()
        if (position) {
          selectCoordinate({ latitude: position.lat(), longitude: position.lng() })
          setMapMessage('Đã cập nhật điểm ghim. Bấm xác nhận để lấy địa chỉ mới.')
        }
      })
      mapListener = map.addListener('click', (event) => {
        if (!event.latLng) return
        selectCoordinate({ latitude: event.latLng.lat(), longitude: event.latLng.lng() })
        setMapMessage('Đã chọn điểm trên bản đồ. Bấm xác nhận để lấy địa chỉ.')
      })
    })
    return () => {
      active = false
      markerListener?.remove()
      mapListener?.remove()
      marker?.setMap(null)
      mapRef.current = null
      markerRef.current = null
    }
    // Khởi tạo lại khi người dùng chủ động thử tải lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt])

  useEffect(() => {
    const host = searchRef.current
    if (!host || !canUseMaps) {
      setSearchIssue(googleMapsClientMessage(getGoogleMapsClientHealth()))
      return
    }
    host.replaceChildren()
    let autocomplete: HTMLElement | undefined
    let selectListener: ((event: Event) => void) | undefined
    let errorListener: (() => void) | undefined
    let active = true
    setSearchReady(false)
    void loadGooglePlaces()
      .then((places) => {
        if (!active || !searchRef.current) return
        setClientHealth(getGoogleMapsClientHealth())
        if (!places?.PlaceAutocompleteElement) {
          setSearchIssue(googleMapsClientMessage(getGoogleMapsClientHealth()))
          return
        }
        const element = new places.PlaceAutocompleteElement({
          includedRegionCodes: ['vn'],
          locationBias: { radius: 30_000, center: { lat: DEFAULT_DA_NANG.latitude, lng: DEFAULT_DA_NANG.longitude } },
        })
        element.includedRegionCodes = ['vn']
        element.locationBias = { radius: 30_000, center: { lat: DEFAULT_DA_NANG.latitude, lng: DEFAULT_DA_NANG.longitude } }
        element.placeholder = 'Tìm số nhà, tên đường hoặc địa điểm…'
        selectListener = (event: Event) => {
          const place = placeFromAutocompleteEvent(event)
          if (!place?.fetchFields) {
            setSearchIssue('Không đọc được địa điểm đã chọn. Hãy thử một gợi ý khác.')
            return
          }
          void place.fetchFields({ fields: ['id', 'formattedAddress', 'addressComponents', 'location'] })
            .then(() => {
              if (!active) return
              const result = deliveryAddressFromPlace(place)
              const latitude = Number(result?.latitude)
              const longitude = Number(result?.longitude)
              if (!result || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                setSearchIssue('Địa điểm này chưa có tọa độ rõ ràng. Hãy chọn một gợi ý khác.')
                return
              }
              selectCoordinate({ latitude, longitude }, result)
              setMapMessage('Đã tìm thấy địa chỉ. Kiểm tra ghim rồi bấm xác nhận.')
              setSearchIssue('')
              element.blur()
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
            })
            .catch(() => { if (active) setSearchIssue('Chưa lấy được chi tiết địa chỉ. Hãy chọn lại một gợi ý Google Maps.') })
        }
        errorListener = () => { if (active) setSearchIssue('Google Places đang gián đoạn. Bạn có thể dùng GPS hoặc nhập tay.') }
        element.addEventListener('gmp-select', selectListener)
        element.addEventListener('gmp-error', errorListener)
        autocomplete = element
        searchRef.current.replaceChildren(element)
        setSearchReady(true)
        setSearchIssue('')
      })
      .catch(() => {
        if (!active) return
        setClientHealth(getGoogleMapsClientHealth())
        setSearchIssue(googleMapsClientMessage(getGoogleMapsClientHealth()))
      })
    return () => {
      active = false
      if (autocomplete && selectListener) autocomplete.removeEventListener('gmp-select', selectListener)
      if (autocomplete && errorListener) autocomplete.removeEventListener('gmp-error', errorListener)
      autocomplete?.remove()
    }
    // Places dùng chung lần retry với bản đồ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseMaps, loadAttempt])

  const confirm = async () => {
    if (!pointConfirmed) return
    setResolving(true)
    try {
      const geocodedDetails = await reverseGeocodeCoordinate(coordinate)
      const details = geocodedDetails ?? selectedDetails
      onChange({
        ...address,
        ...details,
        ...coordinate,
        districtId: districtIdFromGoogle(details?.district, districts, address.districtId),
        savedAddressId: undefined,
        label: undefined,
      })
      setResolving(false)
      onClose()
    } catch {
      setResolving(false)
      setMapMessage('Không đọc được địa chỉ từ điểm ghim. Tọa độ vẫn được giữ để bạn nhập địa chỉ thủ công.')
    }
  }

  const previewTitle = selectedDetails?.addressLine || address.addressLine || (pointConfirmed ? 'Đã chọn tọa độ nhận hàng' : 'Chưa chọn điểm nhận hàng')
  const previewSubtitle = selectedDetails?.formattedAddress || [selectedDetails?.ward, selectedDetails?.district, selectedDetails?.city].filter(Boolean).join(', ') || `${coordinate.latitude.toFixed(6)}, ${coordinate.longitude.toFixed(6)}`
  const mapUnavailable = !canUseMaps || mapsReady === false

  return (
    <div className="eat-clean-sheet-backdrop" role="presentation">
      <section ref={sheetRef} className="eat-clean-sheet eat-clean-map-sheet" role="dialog" aria-modal="true" aria-label="Chọn vị trí nhận hàng">
        <header><div><small>ĐỊA CHỈ NHẬN HÀNG</small><h2>Tìm và kiểm tra điểm giao</h2></div><button type="button" onClick={onClose} aria-label="Đóng"><X size={20} /></button></header>
        <div className="eat-clean-map-sheet__body">
          <div className={`eat-clean-map-sheet-search ${searchReady ? 'is-ready' : 'is-pending'}`}>
            <Search size={19} />
            {canUseMaps ? <span ref={searchRef} className="eat-clean-map-search__host" /> : <input value="" placeholder="Tìm kiếm Google Maps chưa được cấu hình" disabled readOnly />}
            {canUseMaps && !searchReady && <span className="eat-clean-map-search-status">{searchIssue || 'Đang mở tìm kiếm địa chỉ…'}</span>}
          </div>
          {searchIssue && searchReady && <p className="eat-clean-map-search-error" role="status"><AlertTriangle size={15} /><span>{searchIssue}</span><button type="button" onClick={retryLoad}><RefreshCw size={14} /> Thử lại</button></p>}

          <div className="eat-clean-map-picker-actions">
            <span><strong>Chạm hoặc kéo ghim</strong><small>Chọn đúng cửa nhận hàng để shipper dễ tìm.</small></span>
            <button type="button" onClick={locateCurrent} disabled={locating}>{locating ? <LoaderCircle className="eat-clean-spin" size={17} /> : <LocateFixed size={17} />} Vị trí hiện tại</button>
          </div>

          <div className={`eat-clean-map-canvas ${mapUnavailable ? 'is-fallback' : ''}`}>
            <div ref={mapElement} className="eat-clean-map-surface" />
            {mapsReady === null && canUseMaps && <div className="eat-clean-map-placeholder"><LoaderCircle className="eat-clean-spin" size={25} /><strong>Đang tải Google Maps</strong><span>Quá trình này có thể mất vài giây trên mạng di động.</span></div>}
            {mapUnavailable && <div className="eat-clean-map-placeholder"><AlertTriangle size={29} /><strong>Bản đồ chưa sẵn sàng</strong><span>{googleMapsClientMessage(clientHealth)} Bạn vẫn có thể dùng GPS hoặc nhập địa chỉ thủ công.</span><div className="eat-clean-map-placeholder__actions">{canUseMaps && <button type="button" onClick={retryLoad}><RefreshCw size={15} /> Thử tải lại</button>}<button type="button" onClick={onClose}>Nhập địa chỉ thủ công</button></div></div>}
          </div>

          <div className={`eat-clean-map-selection ${pointConfirmed ? 'is-ready' : ''}`}>
            <MapPin size={20} />
            <span><small>ĐỊA CHỈ ĐANG CHỌN</small><strong>{previewTitle}</strong><em>{previewSubtitle}</em></span>
          </div>
          {mapMessage && <p className="eat-clean-inline-message" role="status">{mapMessage}</p>}
          {!pointConfirmed && !mapMessage && <p className="eat-clean-inline-message">Tìm địa chỉ, chạm vào bản đồ hoặc dùng “Vị trí hiện tại” trước khi xác nhận.</p>}
        </div>
        <footer className="eat-clean-map-sheet__footer"><button type="button" className="eat-clean-button eat-clean-button--secondary" onClick={onClose}>Nhập tay</button><button type="button" className="eat-clean-button eat-clean-button--primary" onClick={() => void confirm()} disabled={resolving || !pointConfirmed}>{resolving ? <LoaderCircle className="eat-clean-spin" size={18} /> : <Check size={18} />} Xác nhận địa chỉ này</button></footer>
      </section>
    </div>
  )
}
