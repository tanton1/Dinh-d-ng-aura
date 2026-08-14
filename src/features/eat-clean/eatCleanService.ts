import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../lib/firebase'
import { DEMO_EAT_CLEAN_STOREFRONT, EAT_CLEAN_CATEGORIES, createDemoQuote } from './demoCatalog'
import type {
  EatCleanCreateOrderRequest,
  EatCleanMeal,
  EatCleanMealCategory,
  EatCleanOrder,
  EatCleanOrderQuote,
  EatCleanOrderStatus,
  EatCleanQuoteLine,
  EatCleanQuoteRequest,
  EatCleanRecommendationProfile,
  EatCleanStorefront,
} from './types'

export const isEatCleanDemoMode = import.meta.env.VITE_FORCE_DEMO === 'true'

function functionsClient() {
  if (!firebaseFunctions) throw new Error('Dịch vụ Eat Clean chưa được cấu hình.')
  return firebaseFunctions
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function unwrap(value: unknown, key: string): unknown {
  const record = recordOf(value)
  return record && key in record ? record[key] : value
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function isoValue(value: unknown, fallback?: string) {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  const record = recordOf(value)
  const seconds = numberValue(record?.seconds ?? record?._seconds, Number.NaN)
  if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString()
  return fallback
}

function normalizeCategory(value: unknown): EatCleanMealCategory {
  const category = textValue(value).toLowerCase()
  if (category === 'high-protein' || category === 'protein') return 'high-protein'
  if (category === 'low-carb' || category === 'low_carb') return 'low-carb'
  if (category === 'vegetarian' || category === 'vegan') return 'vegetarian'
  if (category === 'breakfast') return 'breakfast'
  if (category === 'lunch') return 'lunch'
  if (category === 'dinner') return 'dinner'
  if (category === 'snack') return 'snack'
  if (category === 'combo') return 'combo'
  return 'balanced'
}

function normalizeMeal(value: unknown): EatCleanMeal | null {
  const raw = recordOf(value)
  if (!raw) return null
  const id = textValue(raw.id || raw.mealId)
  const name = textValue(raw.name || raw.title)
  if (!id || !name) return null
  const nutrition = recordOf(raw.nutrition)
  const availableQuantity = raw.availableQuantity == null ? undefined : numberValue(raw.availableQuantity)
  const active = raw.active !== false
  return {
    id,
    slug: textValue(raw.slug) || undefined,
    name,
    shortDescription: textValue(raw.shortDescription || raw.subtitle || raw.description, 'Bữa Eat Clean được định lượng rõ ràng.'),
    description: textValue(raw.description || raw.shortDescription, 'Bữa Eat Clean được chuẩn bị mới theo ca giao hàng.'),
    imageUrl: textValue(raw.imageUrl || raw.image) || undefined,
    gallery: stringArray(raw.gallery),
    category: normalizeCategory(raw.category || raw.categoryId),
    tags: stringArray(raw.tags),
    price: numberValue(raw.basePrice ?? raw.price),
    compareAtPrice: raw.compareAtPrice == null ? undefined : numberValue(raw.compareAtPrice),
    currency: 'VND',
    nutrition: {
      calories: numberValue(raw.calories ?? nutrition?.calories),
      protein: numberValue(raw.protein ?? nutrition?.protein),
      carbs: numberValue(raw.carbs ?? nutrition?.carbs),
      fat: numberValue(raw.fat ?? nutrition?.fat),
      fiber: raw.fiber == null && nutrition?.fiber == null ? undefined : numberValue(raw.fiber ?? nutrition?.fiber),
    },
    portionLabel: textValue(raw.portionLabel || raw.servingLabel, '1 phần'),
    ingredients: stringArray(raw.ingredients),
    allergens: stringArray(raw.allergens),
    prepMinutes: raw.prepMinutes == null ? undefined : numberValue(raw.prepMinutes),
    rating: raw.rating == null ? undefined : numberValue(raw.rating),
    reviewCount: raw.reviewCount == null ? undefined : numberValue(raw.reviewCount),
    badge: textValue(raw.badge) || undefined,
    available: active && raw.available !== false && (availableQuantity == null || availableQuantity > 0),
  }
}

function normalizeStorefront(value: unknown): EatCleanStorefront {
  const raw = recordOf(unwrap(value, 'storefront'))
  if (!raw || !Array.isArray(raw.meals)) throw new Error('Thực đơn Eat Clean trả về không đúng định dạng.')
  const config = recordOf(raw.config)
  const meals = raw.meals.flatMap((meal) => {
    const normalized = normalizeMeal(meal)
    return normalized ? [normalized] : []
  })
  const categoryIds = new Set(meals.map((meal) => meal.category))
  const categories = EAT_CLEAN_CATEGORIES.filter((category) => category.id === 'all' || categoryIds.has(category.id))
  const featuredFromConfig = stringArray(config?.featuredMealIds || raw.featuredMealIds)
  const deliverySlots = (Array.isArray(config?.deliverySlots) ? config.deliverySlots : []).flatMap((value) => {
    const slot = recordOf(value)
    const id = textValue(slot?.id)
    const name = textValue(slot?.label || slot?.timeLabel)
    const start = textValue(slot?.start)
    const end = textValue(slot?.end)
    const label = [name, start && end ? `${start}–${end}` : ''].filter(Boolean).join(' · ')
    return id && label ? [{ id, label, active: slot?.enabled !== false }] : []
  })
  const districts = (Array.isArray(config?.deliveryZones) ? config.deliveryZones : []).flatMap((value) => {
    const district = recordOf(value)
    const id = textValue(district?.id)
    const name = textValue(district?.label || district?.name)
    return id && name ? [{ id, name, active: district?.enabled !== false }] : []
  })
  return {
    source: 'live',
    meals,
    categories,
    featuredMealIds: featuredFromConfig.length > 0 ? featuredFromConfig : meals.slice(0, 3).map((meal) => meal.id),
    orderingEnabled: config?.enabled === true && config?.acceptingOrders === true,
    nextDeliveryLabel: textValue(config?.nextDeliveryLabel || raw.nextDeliveryLabel) || undefined,
    freeDeliveryThreshold: config?.freeDeliveryThreshold == null
      ? raw.freeDeliveryThreshold == null ? undefined : numberValue(raw.freeDeliveryThreshold)
      : numberValue(config.freeDeliveryThreshold),
    notice: textValue(config?.notice || raw.notice) || undefined,
    deliverySlots,
    districts,
  }
}

function normalizeQuoteLine(value: unknown): EatCleanQuoteLine | null {
  const raw = recordOf(value)
  if (!raw) return null
  const meal = recordOf(raw.meal)
  const mealId = textValue(raw.mealId || raw.id || meal?.id)
  if (!mealId) return null
  const quantity = Math.max(1, Math.floor(numberValue(raw.quantity, 1)))
  const unitPrice = numberValue(raw.unitPrice ?? raw.price ?? meal?.basePrice)
  return {
    mealId,
    quantity,
    name: textValue(raw.name || raw.mealName || meal?.name, 'Món Eat Clean'),
    unitPrice,
    lineTotal: numberValue(raw.lineTotal ?? raw.subtotal, unitPrice * quantity),
  }
}

function normalizeQuote(value: unknown): EatCleanOrderQuote {
  const raw = recordOf(unwrap(value, 'quote'))
  if (!raw) throw new Error('Chưa thể xác nhận giá đơn Eat Clean.')
  const rawItems = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.lines) ? raw.lines : []
  const lines = rawItems.flatMap((item) => {
    const line = normalizeQuoteLine(item)
    return line ? [line] : []
  })
  const nutrition = recordOf(raw.nutrition)
  const quoteId = textValue(raw.quoteId)
  if (!quoteId || lines.length === 0) throw new Error('Báo giá Eat Clean trả về không đúng định dạng.')
  return {
    quoteId,
    lines,
    subtotal: numberValue(raw.subtotal),
    deliveryFee: numberValue(raw.deliveryFee),
    discount: numberValue(raw.discount),
    total: numberValue(raw.total),
    currency: 'VND',
    expiresAt: textValue(raw.expiresAt) || undefined,
    unavailableMealIds: stringArray(raw.unavailableMealIds),
    nutrition: nutrition ? {
      calories: numberValue(nutrition.calories),
      protein: numberValue(nutrition.protein),
      carbs: numberValue(nutrition.carbs),
      fat: numberValue(nutrition.fat),
      fiber: nutrition.fiber == null ? undefined : numberValue(nutrition.fiber),
    } : undefined,
  }
}

function normalizeStatus(value: unknown): EatCleanOrderStatus {
  const status = textValue(value).toLowerCase()
  if (status === 'pending_confirmation') return 'pending'
  if (status === 'out_for_delivery') return 'delivering'
  if (status === 'confirmed' || status === 'preparing' || status === 'ready' || status === 'delivering' || status === 'delivered' || status === 'cancelled') return status
  return 'pending'
}

function normalizeOrder(value: unknown): EatCleanOrder {
  const raw = recordOf(unwrap(value, 'order'))
  if (!raw) throw new Error('Đơn hàng trả về không đúng định dạng.')
  const id = textValue(raw.id || raw.orderId)
  if (!id) throw new Error('Đơn hàng chưa có mã định danh.')
  const customer = recordOf(raw.customer || raw.contact)
  const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((item) => {
    const line = normalizeQuoteLine(item)
    return line ? [line] : []
  })
  const status = normalizeStatus(raw.status)
  return {
    id,
    code: textValue(raw.code || raw.orderCode, id.slice(-8).toUpperCase()),
    status,
    items,
    contact: {
      fullName: textValue(customer?.name || customer?.fullName),
      phone: textValue(customer?.phone),
    },
    deliveryAddress: {
      addressLine: textValue(customer?.addressLine || raw.addressLine),
      ward: textValue(customer?.ward || raw.ward) || undefined,
      districtId: textValue(customer?.districtId || raw.districtId) || undefined,
      city: textValue(raw.city, 'Đà Nẵng'),
      deliveryDate: textValue(raw.serviceDate || raw.deliveryDate) || undefined,
      deliveryWindow: textValue(raw.deliverySlotLabel || raw.deliverySlotId || raw.deliveryWindow) || undefined,
    },
    paymentMethod: 'cod',
    subtotal: numberValue(raw.subtotal),
    deliveryFee: numberValue(raw.deliveryFee),
    discount: numberValue(raw.discount),
    total: numberValue(raw.total),
    currency: 'VND',
    note: textValue(raw.note) || undefined,
    createdAt: isoValue(raw.createdAt, new Date().toISOString())!,
    updatedAt: isoValue(raw.updatedAt),
    canCancel: typeof raw.canCancel === 'boolean' ? raw.canCancel : status === 'pending' || status === 'confirmed',
    consumptionConfirmedAt: isoValue(raw.consumptionConfirmedAt),
  }
}

function backendOrderPayload(input: Omit<EatCleanQuoteRequest, never>) {
  return {
    items: input.items,
    serviceDate: input.deliveryAddress.deliveryDate,
    deliverySlotId: input.deliveryAddress.deliveryWindow,
    customer: {
      name: input.contact.fullName,
      phone: input.contact.phone,
      addressLine: input.deliveryAddress.addressLine,
      ward: input.deliveryAddress.ward || '',
      districtId: input.deliveryAddress.districtId || '',
    },
    paymentMethod: 'COD' as const,
    note: input.note,
  }
}

export async function getEatCleanStorefront(): Promise<EatCleanStorefront> {
  if (isEatCleanDemoMode) {
    return {
      ...DEMO_EAT_CLEAN_STOREFRONT,
      meals: [...DEMO_EAT_CLEAN_STOREFRONT.meals],
      categories: [...DEMO_EAT_CLEAN_STOREFRONT.categories],
      featuredMealIds: [...DEMO_EAT_CLEAN_STOREFRONT.featuredMealIds],
      orders: undefined,
    }
  }
  const callable = httpsCallable<Record<string, never>, unknown>(functionsClient(), 'getEatCleanStorefront')
  return normalizeStorefront((await callable({})).data)
}

export async function recommendEatCleanMeals(profile: EatCleanRecommendationProfile, limit = 4): Promise<{ mealIds: string[]; reason?: string }> {
  if (isEatCleanDemoMode) {
    const ranked = [...DEMO_EAT_CLEAN_STOREFRONT.meals]
      .filter((meal) => meal.available)
      .sort((left, right) => profile.goal === 'gain-muscle'
        ? right.nutrition.protein - left.nutrition.protein
        : profile.goal === 'lose-fat'
          ? left.nutrition.calories - right.nutrition.calories
          : (right.rating ?? 0) - (left.rating ?? 0))
      .slice(0, limit)
    return { mealIds: ranked.map((meal) => meal.id), reason: 'Gợi ý theo năng lượng, protein còn lại và mục tiêu của bạn.' }
  }
  const callable = httpsCallable<EatCleanRecommendationProfile & { limit: number }, unknown>(functionsClient(), 'recommendEatCleanMeals')
  const data = recordOf((await callable({ ...profile, limit })).data)
  const recommendations = Array.isArray(data?.recommendations) ? data.recommendations : []
  const mealIds = recommendations.flatMap((recommendation) => {
    const raw = recordOf(recommendation)
    const meal = recordOf(raw?.meal)
    const id = textValue(meal?.id || raw?.mealId)
    return id ? [id] : []
  })
  const firstReasons = recordOf(recommendations[0])?.reasons
  return {
    mealIds,
    reason: stringArray(firstReasons).slice(0, 2).join(' · ') || undefined,
  }
}

export async function quoteEatCleanOrder(input: EatCleanQuoteRequest): Promise<EatCleanOrderQuote> {
  if (isEatCleanDemoMode) return createDemoQuote(input.items)
  const payload = backendOrderPayload(input)
  const callable = httpsCallable<typeof payload, unknown>(functionsClient(), 'quoteEatCleanOrder')
  return normalizeQuote((await callable(payload)).data)
}

export async function createEatCleanOrder(input: EatCleanCreateOrderRequest): Promise<EatCleanOrder> {
  const payload = { ...backendOrderPayload(input), quoteId: input.quoteId, idempotencyKey: input.idempotencyKey }
  const callable = httpsCallable<typeof payload, unknown>(functionsClient(), 'createEatCleanOrder')
  return normalizeOrder((await callable(payload)).data)
}

export async function listMyEatCleanOrders(): Promise<EatCleanOrder[]> {
  if (isEatCleanDemoMode) return []
  const callable = httpsCallable<Record<string, never>, unknown>(functionsClient(), 'listMyEatCleanOrders')
  const data = recordOf((await callable({})).data)
  const rawOrders = Array.isArray(data?.orders) ? data.orders : []
  return rawOrders.flatMap((value) => {
    try { return [normalizeOrder(value)] } catch { return [] }
  })
}

export async function cancelEatCleanOrder(orderId: string, reason?: string): Promise<EatCleanOrder> {
  const callable = httpsCallable<{ orderId: string; reason?: string }, unknown>(functionsClient(), 'cancelEatCleanOrder')
  return normalizeOrder((await callable({ orderId, reason })).data)
}

export async function confirmEatCleanConsumption(orderId: string, itemIds: string[], consumedRatio: 25 | 50 | 75 | 100): Promise<EatCleanOrder> {
  const payload = { orderId, itemIds, consumedRatio }
  const callable = httpsCallable<typeof payload, unknown>(functionsClient(), 'confirmEatCleanConsumption')
  return normalizeOrder((await callable(payload)).data)
}
