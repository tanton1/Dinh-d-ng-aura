import type { EatCleanCartItem, EatCleanCheckoutContact, EatCleanDeliveryAddress, EatCleanPaymentMethod } from './types'

const ATTEMPT_PREFIX = 'aura:eat-clean:checkout-attempt:v1:'

export interface EatCleanCheckoutAttempt {
  fingerprint: string
  idempotencyKey: string
}

export interface EatCleanCheckoutAttemptPayload {
  items: EatCleanCartItem[]
  contact: EatCleanCheckoutContact
  deliveryAddress: EatCleanDeliveryAddress
  paymentMethod: EatCleanPaymentMethod
  note?: string
}

function storageKey(ownerId?: string) {
  return `${ATTEMPT_PREFIX}${ownerId?.trim() || 'guest'}`
}

function canonicalPayload(payload: EatCleanCheckoutAttemptPayload) {
  return JSON.stringify({
    items: [...payload.items]
      .map((item) => ({ mealId: item.mealId.trim(), quantity: item.quantity }))
      .sort((left, right) => left.mealId.localeCompare(right.mealId)),
    contact: { fullName: payload.contact.fullName.trim(), phone: payload.contact.phone.trim() },
    deliveryAddress: {
      addressLine: payload.deliveryAddress.addressLine.trim(),
      ward: payload.deliveryAddress.ward?.trim() || '',
      districtId: payload.deliveryAddress.districtId?.trim() || '',
      city: payload.deliveryAddress.city.trim(),
      deliveryDate: payload.deliveryAddress.deliveryDate?.trim() || '',
      deliveryWindow: payload.deliveryAddress.deliveryWindow?.trim() || '',
    },
    paymentMethod: payload.paymentMethod,
    note: payload.note?.trim() || '',
  })
}

/** Deterministic fingerprint; checkout PII itself is never persisted. */
export function eatCleanCheckoutFingerprint(payload: EatCleanCheckoutAttemptPayload) {
  const value = canonicalPayload(payload)
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `ec-v1-${hash.toString(16).padStart(16, '0')}`
}

function createIdempotencyKey() {
  const randomId = globalThis.crypto?.randomUUID?.()
  return randomId ? `ec-${randomId}` : `ec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function readEatCleanCheckoutAttempt(ownerId?: string): EatCleanCheckoutAttempt | null {
  if (typeof window === 'undefined') return null
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(ownerId)) ?? 'null') as Partial<EatCleanCheckoutAttempt> | null
    if (!value || typeof value.fingerprint !== 'string' || typeof value.idempotencyKey !== 'string' || value.idempotencyKey.length < 8) return null
    return { fingerprint: value.fingerprint, idempotencyKey: value.idempotencyKey }
  } catch {
    return null
  }
}

export function getOrCreateEatCleanCheckoutAttempt(
  ownerId: string | undefined,
  payload: EatCleanCheckoutAttemptPayload,
  currentAttempt?: EatCleanCheckoutAttempt | null,
) {
  const fingerprint = eatCleanCheckoutFingerprint(payload)
  const persistedAttempt = readEatCleanCheckoutAttempt(ownerId)
  const reusableAttempt = [currentAttempt, persistedAttempt].find((attempt) => attempt?.fingerprint === fingerprint)
  const attempt = reusableAttempt ?? { fingerprint, idempotencyKey: createIdempotencyKey() }
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(storageKey(ownerId), JSON.stringify(attempt)) } catch { /* Keep in-memory retry stable. */ }
  }
  return attempt
}

export function clearEatCleanCheckoutAttempt(ownerId?: string) {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(storageKey(ownerId)) } catch { /* Storage can be blocked. */ }
}
