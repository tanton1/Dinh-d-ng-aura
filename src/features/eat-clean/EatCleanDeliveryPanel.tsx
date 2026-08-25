import { useEffect, useRef, useState } from 'react'
import {
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
  googleMapsConfigured,
  loadGoogleMaps,
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
  const [locating, setLocating] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveKind, setSaveKind] = useState<EatCleanAddressKind>('home')
  const [saveLabel, setSaveLabel] = useState('Nhà')
  const [saveDefault, setSaveDefault] = useState(false)
  const [message, setMessage] = useState('')
  const searchRef = useRef<HTMLSpanElement>(null)
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

  useEffect(() => {
    const host = searchRef.current
    if (!host || !googleMapsConfigured()) return
    let autocomplete: HTMLElement | undefined
    let selectListener: ((event: Event) => void) | undefined
    let errorListener: (() => void) | undefined
    let active = true
    void loadGoogleMaps()
      .then(async (maps) => {
        if (!active || !searchRef.current) return
        if (!maps) throw new Error('Google Maps JavaScript API unavailable')
        const { PlaceAutocompleteElement } = await maps.importLibrary('places')
        if (!active || !searchRef.current) return
        if (!PlaceAutocompleteElement) throw new Error('Google Places autocomplete unavailable')
        const element = new PlaceAutocompleteElement({
          includedRegionCodes: ['vn'],
          locationBias: { radius: 30_000, center: { lat: DEFAULT_DA_NANG.latitude, lng: DEFAULT_DA_NANG.longitude } },
        })
        element.includedRegionCodes = ['vn']
        element.locationBias = { radius: 30_000, center: { lat: DEFAULT_DA_NANG.latitude, lng: DEFAULT_DA_NANG.longitude } }
        element.placeholder = 'Tìm tên đường, tòa nhà, địa điểm…'
        selectListener = (event: Event) => {
          const place = placeFromAutocompleteEvent(event)
          if (!place?.fetchFields) {
            setMessage('Chưa nhận được địa điểm đã chọn. Hãy thử lại hoặc nhập địa chỉ bên dưới.')
            return
          }
          void place.fetchFields({ fields: ['id', 'formattedAddress', 'addressComponents', 'location'] })
            .then(() => {
              if (!active) return
              const result = deliveryAddressFromPlace(place)
              if (!result) {
                setMessage('Địa điểm này chưa có tọa độ rõ ràng. Hãy chọn một gợi ý khác.')
                return
              }
              const current = latestAddressRef.current
              onAddressChangeRef.current({
                ...current,
                ...result,
                districtId: districtIdFromGoogle(result.district, districtsRef.current, current.districtId),
                savedAddressId: undefined,
                label: undefined,
              })
              setMessage('Đã chọn địa chỉ Google và ghim đúng vị trí.')
            })
            .catch(() => { if (active) setMessage('Chưa lấy được chi tiết địa chỉ. Hãy chọn lại một gợi ý Google Maps.') })
        }
        errorListener = () => {
          if (active) setMessage('Tìm kiếm Google Maps đang quá tải. Hãy thử lại sau hoặc dùng Vị trí hiện tại / Chọn trên bản đồ.')
        }
        element.addEventListener('gmp-select', selectListener)
        element.addEventListener('gmp-error', errorListener)
        autocomplete = element
        searchRef.current.replaceChildren(element)
      })
      .catch(() => { if (active) setMessage('Tìm kiếm Google Maps chưa sẵn sàng. Bạn có thể nhập địa chỉ thủ công.') })
    return () => {
      active = false
      if (autocomplete && selectListener) autocomplete.removeEventListener('gmp-select', selectListener)
      if (autocomplete && errorListener) autocomplete.removeEventListener('gmp-error', errorListener)
      autocomplete?.remove()
    }
  }, [])

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

  const locate = () => {
    if (!navigator.geolocation) {
      setMessage('Trình duyệt không hỗ trợ định vị. Bạn vẫn có thể nhập địa chỉ hoặc tìm trên bản đồ.')
      return
    }
    setLocating(true)
    setMessage('')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextCoordinate = { latitude: position.coords.latitude, longitude: position.coords.longitude }
        void reverseGeocodeCoordinate(nextCoordinate)
          .then((details) => {
            const current = latestAddressRef.current
            onAddressChangeRef.current({
              ...current,
              ...details,
              ...nextCoordinate,
              districtId: districtIdFromGoogle(details?.district, districtsRef.current, current.districtId),
              savedAddressId: undefined,
              label: undefined,
            })
            setMessage(details ? 'Đã tìm thấy vị trí hiện tại. Hãy kiểm tra lại số nhà.' : 'Đã ghim tọa độ. Hãy nhập địa chỉ chi tiết để shipper dễ tìm.')
          })
          .finally(() => setLocating(false))
      },
      () => {
        setLocating(false)
        setMessage('Không lấy được vị trí. Hãy bật quyền định vị hoặc nhập địa chỉ thủ công.')
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    )
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
        <button type="button" onClick={locate} disabled={locating}>{locating ? <LoaderCircle className="eat-clean-spin" size={18} /> : <LocateFixed size={18} />}<span><strong>Vị trí hiện tại</strong><small>Định vị nhanh bằng GPS</small></span></button>
        <button type="button" onClick={() => setMapOpen(true)}><Map size={18} /><span><strong>Chọn trên bản đồ</strong><small>{googleMapsConfigured() ? 'Kéo ghim đến cửa nhận hàng' : 'Nhập tay khi Maps chưa cấu hình'}</small></span></button>
      </div>

      <div className="eat-clean-map-search"><Search size={18} />{googleMapsConfigured() ? <span ref={searchRef} className="eat-clean-map-search__host" /> : <input value="" placeholder="Google Maps chưa cấu hình — nhập địa chỉ bên dưới" disabled readOnly />}</div>

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

      {mapOpen && <AddressMapPicker address={address} districts={districts} onChange={onAddressChange} onClose={() => setMapOpen(false)} />}
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

function AddressMapPicker({ address, districts, onChange, onClose }: { address: EatCleanDeliveryAddress; districts: EatCleanDistrict[]; onChange: (value: EatCleanDeliveryAddress) => void; onClose: () => void }) {
  const mapElement = useRef<HTMLDivElement>(null)
  const initialCoordinate = coordinatesOf(address)
  const [coordinate, setCoordinate] = useState<EatCleanCoordinate>(() => initialCoordinate ?? DEFAULT_DA_NANG)
  const [pointConfirmed, setPointConfirmed] = useState(Boolean(initialCoordinate))
  const [mapsReady, setMapsReady] = useState<boolean | null>(null)
  const [resolving, setResolving] = useState(false)
  const canUseMaps = googleMapsConfigured()

  useEffect(() => {
    let active = true
    let markerListener: { remove: () => void } | undefined
    let mapListener: { remove: () => void } | undefined
    void loadGoogleMaps().then((maps) => {
      if (!active) return
      setMapsReady(Boolean(maps))
      if (!maps || !mapElement.current) return
      const center = { lat: coordinate.latitude, lng: coordinate.longitude }
      const map = new maps.Map(mapElement.current, { center, zoom: 17, mapTypeControl: false, streetViewControl: false, fullscreenControl: false })
      const marker = new maps.Marker({ map, position: center, draggable: true, title: 'Điểm nhận hàng' })
      markerListener = marker.addListener('dragend', () => {
        const position = marker.getPosition()
        if (position) {
          setCoordinate({ latitude: position.lat(), longitude: position.lng() })
          setPointConfirmed(true)
        }
      })
      mapListener = map.addListener('click', (event) => {
        if (!event.latLng) return
        const next = { latitude: event.latLng.lat(), longitude: event.latLng.lng() }
        marker.setPosition({ lat: next.latitude, lng: next.longitude })
        setCoordinate(next)
        setPointConfirmed(true)
      })
    })
    return () => { active = false; markerListener?.remove(); mapListener?.remove() }
    // Bản đồ chỉ cần khởi tạo một lần cho mỗi lần mở sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const confirm = async () => {
    if (!pointConfirmed) return
    setResolving(true)
    const details = await reverseGeocodeCoordinate(coordinate)
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
  }

  return (
    <div className="eat-clean-sheet-backdrop" role="presentation">
      <section className="eat-clean-sheet eat-clean-map-sheet" role="dialog" aria-modal="true" aria-label="Chọn vị trí nhận hàng">
        <header><div><small>ĐIỂM NHẬN HÀNG</small><h2>Ghim đúng cửa giao món</h2></div><button type="button" onClick={onClose} aria-label="Đóng"><X size={20} /></button></header>
        <div ref={mapElement} className={`eat-clean-map-canvas ${!canUseMaps || mapsReady === false ? 'is-fallback' : ''}`}>
          {(!canUseMaps || mapsReady === false) && <div><MapPin size={29} /><strong>Google Maps chưa sẵn sàng</strong><span>Bạn vẫn có thể nhập địa chỉ thủ công. Tọa độ hiện tại sẽ được giữ nếu đã định vị bằng GPS.</span></div>}
          {mapsReady === null && canUseMaps && <div><LoaderCircle className="eat-clean-spin" size={25} /><span>Đang tải bản đồ…</span></div>}
        </div>
        <p className="eat-clean-map-coordinate"><Crosshair size={16} /> {coordinate.latitude.toFixed(6)}, {coordinate.longitude.toFixed(6)}</p>
        {!pointConfirmed && <p className="eat-clean-inline-message">Hãy chạm vào bản đồ, kéo ghim hoặc dùng “Vị trí hiện tại” trước khi xác nhận.</p>}
        <button type="button" className="eat-clean-button eat-clean-button--primary" onClick={() => void confirm()} disabled={resolving || !pointConfirmed}>{resolving ? <LoaderCircle className="eat-clean-spin" size={18} /> : <MapPin size={18} />} Xác nhận điểm này</button>
      </section>
    </div>
  )
}
