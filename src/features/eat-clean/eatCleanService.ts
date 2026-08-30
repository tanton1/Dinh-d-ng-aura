import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../lib/firebaseFunctions'
import { DEMO_EAT_CLEAN_STOREFRONT, EAT_CLEAN_CATEGORIES, createDemoQuote } from './demoCatalog'
import type {
  EatCleanCreateOrderRequest,
  EatCleanMeal,
  EatCleanMealCategory,
  EatCleanOrder,
  EatCleanOrderQuote,
  EatCleanOrderTracking,
  EatCleanOrderStatus,
  EatCleanQuoteLine,
  EatCleanQuoteRequest,
  EatCleanRecommendationProfile,
  EatCleanSavedAddress,
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
    deliveryMode: raw.deliveryMode === 'asap' ? 'asap' : 'scheduled',
    serviceDate: textValue(raw.serviceDate) || undefined,
    asapEnabled: config?.asapEnabled === true,
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
  const route = recordOf(raw.route || raw.deliveryRoute)
  const pricing = recordOf(raw.pricing)
  const eta = recordOf(raw.eta || raw.deliveryEstimate)
  const verifiedCustomer = recordOf(raw.verifiedCustomer)
  const addressProvider = textValue(verifiedCustomer?.addressProvider)
  const quoteId = textValue(raw.quoteId)
  if (!quoteId || lines.length === 0) throw new Error('Báo giá Eat Clean trả về không đúng định dạng.')
  return {
    quoteId,
    lines,
    subtotal: numberValue(raw.subtotal ?? pricing?.subtotal),
    deliveryFee: numberValue(raw.deliveryFee ?? pricing?.deliveryFee),
    discount: numberValue(raw.discount ?? pricing?.discountAmount),
    total: numberValue(raw.total ?? pricing?.total),
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
    distanceMeters: raw.distanceMeters == null && route?.distanceMeters == null ? undefined : numberValue(raw.distanceMeters ?? route?.distanceMeters),
    routeDurationSeconds: raw.routeDurationSeconds == null && route?.durationSeconds == null ? undefined : numberValue(raw.routeDurationSeconds ?? route?.durationSeconds),
    estimatedArrivalAt: isoValue(raw.estimatedArrivalAt ?? eta?.estimatedArrivalAt ?? eta?.estimatedDeliveryAt),
    promisedAt: isoValue(raw.promisedAt ?? eta?.promisedAt),
    deliveryFeeBeforeDiscount: raw.deliveryFeeBeforeDiscount == null && raw.baseDeliveryFee == null && pricing?.deliveryFeeBeforeDiscount == null ? undefined : numberValue(raw.deliveryFeeBeforeDiscount ?? raw.baseDeliveryFee ?? pricing?.deliveryFeeBeforeDiscount),
    deliveryFeeDiscount: raw.deliveryFeeDiscount == null && raw.deliveryDiscount == null && pricing?.deliveryFeeDiscount == null ? undefined : numberValue(raw.deliveryFeeDiscount ?? raw.deliveryDiscount ?? pricing?.deliveryFeeDiscount),
    feeRuleVersion: textValue(raw.feeRuleVersion || pricing?.feeRuleVersion) || undefined,
    serviceAreaLabel: textValue(raw.serviceAreaLabel || route?.serviceAreaLabel) || undefined,
    verifiedDeliveryAddress: verifiedCustomer
      && addressProvider.startsWith('google-')
      && textValue(verifiedCustomer.addressLine)
      && Number.isFinite(numberValue(verifiedCustomer.latitude, Number.NaN))
      && Number.isFinite(numberValue(verifiedCustomer.longitude, Number.NaN))
      ? {
        addressLine: textValue(verifiedCustomer.addressLine),
        ward: textValue(verifiedCustomer.ward) || undefined,
        districtId: textValue(verifiedCustomer.districtId) || undefined,
        district: textValue(verifiedCustomer.district) || undefined,
        city: textValue(verifiedCustomer.city || verifiedCustomer.cityName, 'Đà Nẵng'),
        placeId: textValue(verifiedCustomer.placeId) || undefined,
        latitude: numberValue(verifiedCustomer.latitude),
        longitude: numberValue(verifiedCustomer.longitude),
        provider: addressProvider,
        verifiedAt: isoValue(verifiedCustomer.addressVerifiedAt),
      }
      : undefined,
  }
}

function normalizeStatus(value: unknown): EatCleanOrderStatus {
  const status = textValue(value).toLowerCase()
  if (status === 'pending_confirmation') return 'pending'
  if (status === 'out_for_delivery') return 'delivering'
  if (status === 'awaiting_kitchen') return 'confirmed'
  if (status === 'awaiting_assignment') return 'ready'
  if (status === 'accepted' || status === 'at_store') return 'assigned'
  if (status === 'shipper_assigned' || status === 'assigned_to_shipper') return 'assigned'
  if (status === 'picked_up' || status === 'pickedup') return 'picked-up'
  if (status === 'at_destination' || status === 'arrived_at_customer') return 'arrived'
  if (status === 'confirmed' || status === 'preparing' || status === 'ready' || status === 'assigned' || status === 'picked-up' || status === 'delivering' || status === 'arrived' || status === 'delivered' || status === 'cancelled') return status
  return 'pending'
}

function normalizeOrder(value: unknown): EatCleanOrder {
  const raw = recordOf(unwrap(value, 'order'))
  if (!raw) throw new Error('Đơn hàng trả về không đúng định dạng.')
  const id = textValue(raw.id || raw.orderId)
  if (!id) throw new Error('Đơn hàng chưa có mã định danh.')
  const customer = recordOf(raw.customer || raw.contact)
  const delivery = recordOf(raw.delivery)
  const address = recordOf(delivery?.address || raw.deliveryAddress)
  const route = recordOf(delivery?.route || raw.route || raw.deliveryRoute)
  const eta = recordOf(delivery?.eta || raw.eta)
  const shipper = recordOf(delivery?.shipper || raw.shipper)
  const trackingSummary = recordOf(raw.trackingSummary)
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
      addressLine: textValue(address?.addressLine || customer?.addressLine || raw.addressLine),
      formattedAddress: textValue(address?.formattedAddress || customer?.formattedAddress) || undefined,
      ward: textValue(address?.ward || customer?.ward || raw.ward) || undefined,
      districtId: textValue(address?.districtId || customer?.districtId || raw.districtId) || undefined,
      district: textValue(address?.district || customer?.district) || undefined,
      city: textValue(address?.city || customer?.cityName || raw.city, 'Đà Nẵng'),
      placeId: textValue(address?.placeId || customer?.placeId) || undefined,
      latitude: address?.latitude == null && customer?.latitude == null ? undefined : numberValue(address?.latitude ?? customer?.latitude),
      longitude: address?.longitude == null && customer?.longitude == null ? undefined : numberValue(address?.longitude ?? customer?.longitude),
      entranceNote: textValue(address?.entranceNote || customer?.deliveryNote) || undefined,
      deliveryMode: delivery?.mode === 'asap' || raw.deliveryMode === 'asap' ? 'asap' : 'scheduled',
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
    estimatedArrivalAt: isoValue(raw.estimatedArrivalAt ?? eta?.estimatedArrivalAt ?? eta?.estimatedDeliveryAt ?? trackingSummary?.estimatedDeliveryAt),
    promisedAt: isoValue(raw.promisedAt ?? eta?.promisedAt ?? trackingSummary?.promisedAt),
    distanceMeters: raw.distanceMeters == null && route?.distanceMeters == null ? undefined : numberValue(raw.distanceMeters ?? route?.distanceMeters),
    shipper: shipper ? {
      id: textValue(shipper.id || shipper.uid) || undefined,
      displayName: textValue(shipper.displayName || shipper.name, 'Đối tác giao hàng Aura'),
      phone: textValue(shipper.phone) || undefined,
      avatarUrl: textValue(shipper.avatarUrl) || undefined,
      vehicleLabel: textValue(shipper.vehicleLabel || shipper.vehicle) || undefined,
      plateNumber: textValue(shipper.plateNumber) || undefined,
    } : undefined,
  }
}

function normalizeSavedAddress(value: unknown): EatCleanSavedAddress | null {
  const raw = recordOf(value)
  if (!raw) return null
  const contact = recordOf(raw.contact || raw.recipient)
  const location = recordOf(raw.location || raw.coordinate)
  const id = textValue(raw.id || raw.addressId)
  const latitude = numberValue(raw.latitude ?? location?.latitude ?? location?.lat, Number.NaN)
  const longitude = numberValue(raw.longitude ?? location?.longitude ?? location?.lng, Number.NaN)
  if (!id || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const normalizedLabel = textValue(raw.label)
  const kind = raw.kind === 'home' || raw.kind === 'work'
    ? raw.kind
    : /^nhà$/i.test(normalizedLabel) ? 'home' : /^(công ty|văn phòng)$/i.test(normalizedLabel) ? 'work' : 'other'
  return {
    id,
    kind,
    label: normalizedLabel || (kind === 'home' ? 'Nhà' : kind === 'work' ? 'Công ty' : 'Địa chỉ'),
    contact: {
      fullName: textValue(contact?.fullName || contact?.name || raw.fullName),
      phone: textValue(contact?.phone || raw.phone),
    },
    addressLine: textValue(raw.addressLine),
    formattedAddress: textValue(raw.formattedAddress) || undefined,
    ward: textValue(raw.ward) || undefined,
    districtId: textValue(raw.districtId) || undefined,
    district: textValue(raw.district) || undefined,
    city: textValue(raw.city || raw.cityName, 'Đà Nẵng'),
    placeId: textValue(raw.placeId) || undefined,
    latitude,
    longitude,
    entranceNote: textValue(raw.entranceNote || raw.deliveryNote) || undefined,
    isDefault: raw.isDefault === true,
    createdAt: isoValue(raw.createdAt),
    updatedAt: isoValue(raw.updatedAt),
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
      addressId: input.deliveryAddress.savedAddressId,
      addressLabel: input.deliveryAddress.label,
      placeId: input.deliveryAddress.placeId,
      latitude: input.deliveryAddress.latitude,
      longitude: input.deliveryAddress.longitude,
      deliveryNote: input.deliveryAddress.entranceNote,
    },
    deliveryMode: input.deliveryAddress.deliveryMode ?? 'scheduled',
    deliveryAddress: {
      addressLine: input.deliveryAddress.addressLine,
      formattedAddress: input.deliveryAddress.formattedAddress,
      ward: input.deliveryAddress.ward || '',
      districtId: input.deliveryAddress.districtId || '',
      district: input.deliveryAddress.district || '',
      city: input.deliveryAddress.city,
      placeId: input.deliveryAddress.placeId,
      latitude: input.deliveryAddress.latitude,
      longitude: input.deliveryAddress.longitude,
      entranceNote: input.deliveryAddress.entranceNote,
      savedAddressId: input.deliveryAddress.savedAddressId,
      label: input.deliveryAddress.label,
    },
    paymentMethod: 'COD' as const,
    note: input.note,
  }
}

export async function getEatCleanStorefront(input: { deliveryMode?: 'asap' | 'scheduled'; serviceDate?: string } = {}): Promise<EatCleanStorefront> {
  if (isEatCleanDemoMode) {
    return {
      ...DEMO_EAT_CLEAN_STOREFRONT,
      deliveryMode: input.deliveryMode === 'asap' ? 'asap' : 'scheduled',
      serviceDate: input.deliveryMode === 'asap' ? new Date().toISOString().slice(0, 10) : input.serviceDate || DEMO_EAT_CLEAN_STOREFRONT.serviceDate,
      meals: [...DEMO_EAT_CLEAN_STOREFRONT.meals],
      categories: [...DEMO_EAT_CLEAN_STOREFRONT.categories],
      featuredMealIds: [...DEMO_EAT_CLEAN_STOREFRONT.featuredMealIds],
      orders: undefined,
    }
  }
  const callable = httpsCallable<typeof input, unknown>(functionsClient(), 'getEatCleanStorefront')
  return normalizeStorefront((await callable(input)).data)
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

export async function listEatCleanAddresses(): Promise<EatCleanSavedAddress[]> {
  if (isEatCleanDemoMode) return []
  const callable = httpsCallable<Record<string, never>, unknown>(functionsClient(), 'listEatCleanAddresses')
  const data = recordOf((await callable({})).data)
  const addresses = Array.isArray(data?.addresses) ? data.addresses : []
  return addresses.flatMap((value) => {
    const address = normalizeSavedAddress(value)
    return address ? [address] : []
  })
}

export async function saveEatCleanAddress(address: Omit<EatCleanSavedAddress, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<EatCleanSavedAddress> {
  const payload = {
    address: {
      id: address.id,
      kind: address.kind,
      label: address.label,
      fullName: address.contact.fullName,
      phone: address.contact.phone,
      addressLine: address.addressLine,
      formattedAddress: address.formattedAddress,
      ward: address.ward,
      district: address.district,
      districtId: address.districtId,
      city: address.city,
      placeId: address.placeId,
      latitude: address.latitude,
      longitude: address.longitude,
      entranceNote: address.entranceNote,
      deliveryNote: address.entranceNote,
      isDefault: address.isDefault,
    },
  }
  const callable = httpsCallable<typeof payload, unknown>(functionsClient(), 'saveEatCleanAddress')
  const data = recordOf((await callable(payload)).data)
  const normalized = normalizeSavedAddress(data?.address || data)
  if (!normalized) throw new Error('Địa chỉ đã lưu trả về không hợp lệ.')
  return normalized
}

export async function deleteEatCleanAddress(addressId: string): Promise<void> {
  const callable = httpsCallable<{ addressId: string }, unknown>(functionsClient(), 'deleteEatCleanAddress')
  await callable({ addressId })
}

export async function setDefaultEatCleanAddress(addressId: string): Promise<void> {
  const callable = httpsCallable<{ addressId: string }, unknown>(functionsClient(), 'setDefaultEatCleanAddress')
  await callable({ addressId })
}

export async function getEatCleanOrderTracking(orderId: string): Promise<EatCleanOrderTracking | null> {
  if (isEatCleanDemoMode) return null
  const callable = httpsCallable<{ orderId: string }, unknown>(functionsClient(), 'getEatCleanOrderTracking')
  const data = recordOf((await callable({ orderId })).data)
  const raw = recordOf(data?.tracking || data?.delivery || data)
  if (!raw) return null
  const liveLocation = recordOf(data?.liveLocation)
  const order = recordOf(data?.order)
  const location = recordOf(liveLocation || raw.shipperLocation || raw.location)
  const destination = recordOf(raw.destination || raw.dropoff)
  const kitchen = recordOf(raw.kitchenLocation || raw.kitchen || raw.pickup)
  const shipper = recordOf(raw.shipper)
  const shipperId = textValue(raw.shipperId)
  const eta = recordOf(raw.eta)
  const route = recordOf(raw.route)
  const rawDeliveryStatus = textValue(raw.status)
  const coordinate = (value: Record<string, unknown> | null) => {
    if (!value) return undefined
    const latitude = numberValue(value.latitude ?? value.lat, Number.NaN)
    const longitude = numberValue(value.longitude ?? value.lng, Number.NaN)
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : undefined
  }
  const shipperCoordinate = coordinate(location)
  const gpsExpected = ['accepted', 'at_store', 'picked_up', 'arrived'].includes(rawDeliveryStatus)
  return {
    orderId,
    status: normalizeStatus(raw.status || order?.status),
    shipper: shipper || shipperId ? {
      id: textValue(shipper?.id || shipper?.uid || shipperId) || undefined,
      displayName: textValue(shipper?.displayName || shipper?.name || raw.shipperName, 'Đối tác giao hàng Aura'),
      phone: textValue(shipper?.phone) || undefined,
      avatarUrl: textValue(shipper?.avatarUrl) || undefined,
      vehicleLabel: textValue(shipper?.vehicleLabel || shipper?.vehicle) || undefined,
      plateNumber: textValue(shipper?.plateNumber) || undefined,
    } : undefined,
    shipperLocation: shipperCoordinate,
    destination: coordinate(destination),
    kitchenLocation: coordinate(kitchen),
    routePolyline: textValue(raw.routePolyline || raw.encodedPolyline || route?.routePolyline || route?.encodedPolyline) || undefined,
    estimatedArrivalAt: isoValue(raw.estimatedArrivalAt || raw.estimatedDeliveryAt || eta?.estimatedArrivalAt || eta?.estimatedDeliveryAt),
    promisedAt: isoValue(raw.promisedAt || eta?.promisedAt),
    lastLocationAt: isoValue(liveLocation?.recordedAt || liveLocation?.updatedAt || raw.lastLocationAt || raw.updatedAt),
    stale: raw.stale === true || liveLocation?.stale === true || (gpsExpected && !shipperCoordinate),
    deliveryOtp: textValue(data?.deliveryOtp) || undefined,
  }
}
