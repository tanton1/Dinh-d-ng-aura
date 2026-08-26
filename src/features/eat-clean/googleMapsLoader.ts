import { importLibrary as importGoogleLibrary, setOptions } from '@googlemaps/js-api-loader'
import type { EatCleanCoordinate, EatCleanDeliveryAddress } from './types'

type MapsListener = { remove: () => void }

export interface AuraGooglePlace {
  formatted_address?: string
  formattedAddress?: string
  place_id?: string
  id?: string
  address_components?: AuraGoogleAddressComponent[]
  addressComponents?: AuraGoogleAddressComponent[]
  geometry?: { location?: { lat: () => number; lng: () => number } }
  location?: { lat: () => number; lng: () => number }
  fetchFields?: (options: { fields: string[] }) => Promise<void>
}

interface AuraGoogleAddressComponent {
  long_name?: string
  short_name?: string
  longText?: string
  shortText?: string
  types: string[]
}

export interface AuraPlaceAutocompleteElement extends HTMLElement {
  includedRegionCodes: string[]
  locationBias?: { radius: number; center: { lat: number; lng: number } }
  placeholder: string
}

interface AuraPlacePredictionSelectEvent extends Event {
  placePrediction?: { toPlace: () => AuraGooglePlace }
}

export interface AuraGoogleMapsApi {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => {
    addListener: (event: string, callback: (event: { latLng?: { lat: () => number; lng: () => number } }) => void) => MapsListener
    panTo: (position: { lat: number; lng: number }) => void
    setZoom: (zoom: number) => void
  }
  Marker: new (options: Record<string, unknown>) => {
    addListener: (event: string, callback: () => void) => MapsListener
    getPosition: () => { lat: () => number; lng: () => number } | null
    setPosition: (position: { lat: number; lng: number }) => void
    setMap: (map: unknown) => void
  }
  Geocoder: new () => {
    geocode: (
      request: { location: { lat: number; lng: number } },
      callback: (results: AuraGooglePlace[] | null, status: string) => void,
    ) => void
  }
}

export type GoogleMapsClientStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'config-missing'
  | 'auth-failed'
  | 'network-error'
  | 'api-error'
  | 'places-unavailable'

export interface GoogleMapsClientHealth {
  status: GoogleMapsClientStatus
  configured: boolean
  errorCode?: string
  detail?: string
}

declare global {
  interface Window {
    google?: { maps?: AuraGoogleMapsApi }
    gm_authFailure?: () => void
  }
}

let mapsPromise: Promise<AuraGoogleMapsApi | null> | null = null
let placesPromise: Promise<{ PlaceAutocompleteElement: new (options?: Record<string, unknown>) => AuraPlaceAutocompleteElement } | null> | null = null
let loaderConfigured = false
let authFailureHookInstalled = false
let clientHealth: GoogleMapsClientHealth = {
  status: googleMapsConfigured() ? 'idle' : 'config-missing',
  configured: googleMapsConfigured(),
}

export function googleMapsConfigured() {
  return Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim())
}

export function getGoogleMapsClientHealth(): GoogleMapsClientHealth {
  return { ...clientHealth }
}

export function googleMapsClientMessage(health = clientHealth) {
  switch (health.status) {
    case 'config-missing': return 'Thiếu VITE_GOOGLE_MAPS_API_KEY trong bản build frontend.'
    case 'auth-failed': return 'Google Maps từ chối API key. Hãy kiểm tra billing và HTTP referrer.'
    case 'places-unavailable': return 'Bản đồ đã tải nhưng Places API (New) chưa sẵn sàng.'
    case 'network-error': return 'Không kết nối được tới Google Maps. Hãy kiểm tra mạng rồi thử lại.'
    case 'api-error': return 'Google Maps chưa khởi tạo được. Hãy kiểm tra API đã bật và restriction của key.'
    case 'loading': return 'Đang tải Google Maps…'
    case 'ready': return 'Google Maps và tìm kiếm địa chỉ đã sẵn sàng.'
    default: return 'Google Maps chưa được khởi tạo.'
  }
}

function setClientHealth(status: GoogleMapsClientStatus, detail?: string, errorCode?: string) {
  clientHealth = { status, configured: googleMapsConfigured(), detail, errorCode }
}

function configureGoogleMapsLoader() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
  if (!apiKey) {
    setClientHealth('config-missing', 'VITE_GOOGLE_MAPS_API_KEY is empty', 'CONFIG_MISSING')
    return false
  }
  if (!authFailureHookInstalled) {
    authFailureHookInstalled = true
    const previousAuthFailure = window.gm_authFailure
    window.gm_authFailure = () => {
      setClientHealth('auth-failed', 'gm_authFailure', 'AUTH_FAILED')
      previousAuthFailure?.()
    }
  }
  if (!loaderConfigured) {
    setOptions({ key: apiKey, v: 'weekly', language: 'vi', region: 'VN', authReferrerPolicy: 'origin' })
    loaderConfigured = true
  }
  return true
}

function timeout<T>(promise: Promise<T>, durationMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error('GOOGLE_MAPS_TIMEOUT')), durationMs)),
  ])
}

function classifyLoadError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error)
  if (clientHealth.status === 'auth-failed') return
  if (/timeout|could not load|network|fetch/i.test(detail)) setClientHealth('network-error', detail, 'NETWORK_ERROR')
  else setClientHealth('api-error', detail, 'API_ERROR')
}

export function loadGoogleMaps(options: { retry?: boolean } = {}): Promise<AuraGoogleMapsApi | null> {
  if (!configureGoogleMapsLoader()) return Promise.resolve(null)
  if (clientHealth.status === 'auth-failed') return Promise.resolve(null)
  if (window.google?.maps?.Map && window.google.maps.Geocoder) {
    setClientHealth('ready')
    return Promise.resolve(window.google.maps)
  }
  if (options.retry) mapsPromise = null
  if (mapsPromise) return mapsPromise

  setClientHealth('loading')
  mapsPromise = timeout(Promise.all([
    importGoogleLibrary('maps'),
    importGoogleLibrary('marker'),
    importGoogleLibrary('geocoding'),
  ]), 12_000)
    .then(() => {
      if (clientHealth.status === 'auth-failed') return null
      const maps = window.google?.maps ?? null
      if (!maps?.Map || !maps.Geocoder) throw new Error('GOOGLE_MAPS_NAMESPACE_INCOMPLETE')
      setClientHealth('ready')
      return maps
    })
    .catch((error) => {
      classifyLoadError(error)
      mapsPromise = null
      return null
    })
  return mapsPromise
}

export function loadGooglePlaces(options: { retry?: boolean } = {}) {
  if (!configureGoogleMapsLoader()) return Promise.resolve(null)
  if (options.retry) placesPromise = null
  if (placesPromise) return placesPromise
  placesPromise = loadGoogleMaps(options)
    .then(async (maps) => {
      if (!maps) return null
      setClientHealth('loading')
      const places = await timeout(importGoogleLibrary('places'), 12_000)
      const typedPlaces = places as unknown as { PlaceAutocompleteElement: new (options?: Record<string, unknown>) => AuraPlaceAutocompleteElement }
      if (!typedPlaces.PlaceAutocompleteElement) throw new Error('PLACE_AUTOCOMPLETE_UNAVAILABLE')
      setClientHealth('ready')
      return typedPlaces
    })
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error)
      if (clientHealth.status !== 'auth-failed') setClientHealth('places-unavailable', detail, 'PLACES_UNAVAILABLE')
      placesPromise = null
      return null
    })
  return placesPromise
}

function component(place: AuraGooglePlace, ...types: string[]) {
  const item = (place.addressComponents || place.address_components)
    ?.find((candidate) => types.some((type) => candidate.types.includes(type)))
  return item?.longText || item?.long_name || item?.shortText || item?.short_name
}

export function deliveryAddressFromPlace(place: AuraGooglePlace): Partial<EatCleanDeliveryAddress> | null {
  const location = place.location || place.geometry?.location
  if (!location) return null
  const streetNumber = component(place, 'street_number')
  const route = component(place, 'route')
  const formattedAddress = place.formattedAddress || place.formatted_address
  const addressLine = [streetNumber, route].filter(Boolean).join(' ') || formattedAddress || ''
  return {
    addressLine,
    formattedAddress,
    placeId: place.id || place.place_id,
    latitude: location.lat(),
    longitude: location.lng(),
    ward: component(place, 'sublocality_level_1', 'sublocality', 'administrative_area_level_3'),
    district: component(place, 'administrative_area_level_2', 'sublocality_level_2'),
    city: component(place, 'administrative_area_level_1') || 'Đà Nẵng',
  }
}

export function placeFromAutocompleteEvent(event: Event) {
  return (event as AuraPlacePredictionSelectEvent).placePrediction?.toPlace() ?? null
}

export async function reverseGeocodeCoordinate(coordinate: EatCleanCoordinate): Promise<Partial<EatCleanDeliveryAddress> | null> {
  const maps = await loadGoogleMaps()
  if (!maps) return null
  return new Promise((resolve) => {
    const geocoder = new maps.Geocoder()
    geocoder.geocode(
      { location: { lat: coordinate.latitude, lng: coordinate.longitude } },
      (results, status) => resolve(status === 'OK' && results?.[0] ? deliveryAddressFromPlace(results[0]) : null),
    )
  })
}
