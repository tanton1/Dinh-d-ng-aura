import type { EatCleanAddressKind, EatCleanSavedAddress } from './types'

const STORAGE_PREFIX = 'aura_eat_clean_addresses_v1'

function storageKey(ownerId?: string) {
  return `${STORAGE_PREFIX}:${ownerId?.trim() || 'guest'}`
}

function isKind(value: unknown): value is EatCleanAddressKind {
  return value === 'home' || value === 'work' || value === 'other'
}

function normalizeAddress(value: unknown): EatCleanSavedAddress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<EatCleanSavedAddress>
  if (!raw.id || !raw.label || !raw.addressLine || !raw.city || !raw.contact?.fullName || !raw.contact.phone) return null
  if (!Number.isFinite(raw.latitude) || !Number.isFinite(raw.longitude)) return null
  return {
    ...raw,
    id: String(raw.id),
    kind: isKind(raw.kind) ? raw.kind : 'other',
    label: String(raw.label).slice(0, 40),
    addressLine: String(raw.addressLine).slice(0, 220),
    city: String(raw.city).slice(0, 80),
    latitude: Number(raw.latitude),
    longitude: Number(raw.longitude),
    isDefault: raw.isDefault === true,
    contact: {
      fullName: String(raw.contact.fullName).slice(0, 100),
      phone: String(raw.contact.phone).slice(0, 24),
    },
  }
}

export function readCachedEatCleanAddresses(ownerId?: string): EatCleanSavedAddress[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(ownerId)) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      const address = normalizeAddress(item)
      return address ? [address] : []
    }).slice(0, 20)
  } catch {
    return []
  }
}

export function writeCachedEatCleanAddresses(ownerId: string | undefined, addresses: EatCleanSavedAddress[]) {
  const normalized = addresses.flatMap((item) => {
    const address = normalizeAddress(item)
    return address ? [address] : []
  }).slice(0, 20)
  try {
    window.localStorage.setItem(storageKey(ownerId), JSON.stringify(normalized))
  } catch {
    // Checkout vẫn hoạt động nếu trình duyệt chặn localStorage.
  }
  return normalized
}
