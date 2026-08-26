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
  importLibrary: (library: 'places') => Promise<{
    PlaceAutocompleteElement: new (options?: Record<string, unknown>) => AuraPlaceAutocompleteElement
  }>
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

declare global {
  interface Window {
    google?: { maps?: AuraGoogleMapsApi }
    __auraGoogleMapsReady?: () => void
  }
}

let mapsPromise: Promise<AuraGoogleMapsApi | null> | null = null

export function googleMapsConfigured() {
  return Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim())
}

export function loadGoogleMaps(): Promise<AuraGoogleMapsApi | null> {
  if (window.google?.maps) return Promise.resolve(window.google.maps)
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
  if (!apiKey) return Promise.resolve(null)
  if (mapsPromise) return mapsPromise

  mapsPromise = new Promise((resolve) => {
    const callbackName = '__auraGoogleMapsReady'
    const existing = document.querySelector<HTMLScriptElement>('script[data-aura-google-maps]')
    const finish = () => resolve(window.google?.maps ?? null)
    window[callbackName] = finish

    if (existing) {
      existing.addEventListener('load', finish, { once: true })
      existing.addEventListener('error', () => resolve(null), { once: true })
      window.setTimeout(finish, 8_000)
      return
    }

    const script = document.createElement('script')
    script.dataset.auraGoogleMaps = 'true'
    script.async = true
    script.defer = true
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&language=vi&region=VN&callback=${callbackName}`
    script.addEventListener('error', () => resolve(null), { once: true })
    document.head.appendChild(script)
    window.setTimeout(finish, 10_000)
  })
  return mapsPromise
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
