import type { EatCleanCartItem } from './types'

const CART_PREFIX = 'aura:eat-clean:cart:v1:'
const MAX_QUANTITY_PER_MEAL = 20

export function eatCleanCartStorageKey(ownerId?: string) {
  return `${CART_PREFIX}${ownerId?.trim() || 'guest'}`
}

export function sanitizeEatCleanCart(value: unknown): EatCleanCartItem[] {
  if (!Array.isArray(value)) return []
  const quantities = new Map<string, number>()

  value.forEach((candidate) => {
    if (!candidate || typeof candidate !== 'object') return
    const record = candidate as Record<string, unknown>
    const mealId = typeof record.mealId === 'string' ? record.mealId.trim() : ''
    const rawQuantity = typeof record.quantity === 'number' ? record.quantity : Number(record.quantity)
    if (!mealId || !Number.isFinite(rawQuantity)) return
    const quantity = Math.max(1, Math.min(MAX_QUANTITY_PER_MEAL, Math.floor(rawQuantity)))
    quantities.set(mealId, Math.min(MAX_QUANTITY_PER_MEAL, (quantities.get(mealId) ?? 0) + quantity))
  })

  return Array.from(quantities, ([mealId, quantity]) => ({ mealId, quantity }))
}

export function readEatCleanCart(ownerId?: string): EatCleanCartItem[] {
  if (typeof window === 'undefined') return []
  try {
    return sanitizeEatCleanCart(JSON.parse(window.localStorage.getItem(eatCleanCartStorageKey(ownerId)) ?? '[]'))
  } catch {
    return []
  }
}

export function writeEatCleanCart(ownerId: string | undefined, items: EatCleanCartItem[]) {
  const sanitized = sanitizeEatCleanCart(items)
  if (typeof window === 'undefined') return sanitized
  try {
    if (sanitized.length === 0) window.localStorage.removeItem(eatCleanCartStorageKey(ownerId))
    else window.localStorage.setItem(eatCleanCartStorageKey(ownerId), JSON.stringify(sanitized))
  } catch {
    // Keep the in-memory cart usable when storage is blocked or full.
  }
  return sanitized
}

export function setEatCleanCartQuantity(
  items: EatCleanCartItem[],
  mealId: string,
  quantity: number,
): EatCleanCartItem[] {
  const normalizedMealId = mealId.trim()
  if (!normalizedMealId) return sanitizeEatCleanCart(items)
  if (quantity <= 0) return items.filter((item) => item.mealId !== normalizedMealId)

  const next = items.filter((item) => item.mealId !== normalizedMealId)
  next.push({ mealId: normalizedMealId, quantity: Math.min(MAX_QUANTITY_PER_MEAL, Math.floor(quantity)) })
  return sanitizeEatCleanCart(next)
}

export function addEatCleanCartItem(items: EatCleanCartItem[], mealId: string, quantity = 1) {
  const current = items.find((item) => item.mealId === mealId)?.quantity ?? 0
  return setEatCleanCartQuantity(items, mealId, current + quantity)
}
