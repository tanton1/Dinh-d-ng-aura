import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../../lib/firebaseFunctions'
import {
  DEFAULT_EAT_CLEAN_CONFIG,
  EMPTY_EAT_CLEAN_SUMMARY,
  type SaveEatCleanInventoryInput,
  type EatCleanAdminData,
  type EatCleanConfig,
  type EatCleanDeliverySlot,
  type EatCleanDeliveryZone,
  type EatCleanInventoryItem,
  type EatCleanMeal,
  type EatCleanMealCategory,
  type EatCleanOrder,
  type EatCleanOrderLine,
  type EatCleanOrderPatch,
  type EatCleanOrderStatus,
  type EatCleanPaymentStatus,
  type EatCleanRefundJob,
  type EatCleanRefundStatus,
  type SaveEatCleanConfigInput,
  type SaveEatCleanMealInput,
  type UpdateEatCleanOrderInput,
} from './types'

function functionsClient() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình cho môi trường này.')
  return firebaseFunctions
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function number(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function integer(value: unknown, fallback = 0) {
  return Math.round(number(value, fallback))
}

function stringArray(value: unknown) {
  return asArray(value).filter((item): item is string => typeof item === 'string')
}

const MEAL_CATEGORIES = new Set<EatCleanMealCategory>(['breakfast', 'lunch', 'dinner', 'snack'])
const ORDER_STATUSES = new Set<EatCleanOrderStatus>(['pending_confirmation', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'])
const PAYMENT_STATUSES = new Set<EatCleanPaymentStatus>(['unpaid', 'paid', 'refunded'])
const REFUND_STATUSES = new Set<EatCleanRefundStatus>([
  'blocked_provider_not_configured',
  'manual_review_required',
  'refunded',
  'rejected',
])

function normalizeSlot(value: unknown, index: number): EatCleanDeliverySlot {
  const source = asRecord(value)
  return {
    id: text(source.id, `slot-${index + 1}`),
    label: text(source.label, `Khung ${index + 1}`),
    start: text(source.start, '00:00'),
    end: text(source.end, '00:00'),
    enabled: source.enabled !== false,
  }
}

function normalizeZone(value: unknown, index: number): EatCleanDeliveryZone {
  const source = asRecord(value)
  return {
    id: text(source.id, `zone-${index + 1}`),
    label: text(source.label, `Khu vực ${index + 1}`),
    fee: integer(source.fee),
    enabled: source.enabled !== false,
  }
}

function normalizeConfig(value: unknown): EatCleanConfig {
  const source = asRecord(value)
  return {
    ...DEFAULT_EAT_CLEAN_CONFIG,
    schemaVersion: integer(source.schemaVersion, 1),
    enabled: source.enabled !== false,
    acceptingOrders: source.acceptingOrders === true,
    cityCode: text(source.cityCode, DEFAULT_EAT_CLEAN_CONFIG.cityCode),
    cityName: text(source.cityName, DEFAULT_EAT_CLEAN_CONFIG.cityName),
    currency: text(source.currency, 'VND'),
    paymentMethods: stringArray(source.paymentMethods).length ? stringArray(source.paymentMethods) : ['COD'],
    minOrderAmount: integer(source.minOrderAmount, DEFAULT_EAT_CLEAN_CONFIG.minOrderAmount),
    defaultDeliveryFee: integer(source.defaultDeliveryFee, DEFAULT_EAT_CLEAN_CONFIG.defaultDeliveryFee),
    freeDeliveryThreshold: integer(source.freeDeliveryThreshold, DEFAULT_EAT_CLEAN_CONFIG.freeDeliveryThreshold),
    sameDayCutoff: text(source.sameDayCutoff, DEFAULT_EAT_CLEAN_CONFIG.sameDayCutoff),
    minimumLeadDays: integer(source.minimumLeadDays, DEFAULT_EAT_CLEAN_CONFIG.minimumLeadDays),
    maxAdvanceDays: integer(source.maxAdvanceDays, DEFAULT_EAT_CLEAN_CONFIG.maxAdvanceDays),
    cancellationCutoffHours: integer(source.cancellationCutoffHours, DEFAULT_EAT_CLEAN_CONFIG.cancellationCutoffHours),
    maxItemQuantity: integer(source.maxItemQuantity, DEFAULT_EAT_CLEAN_CONFIG.maxItemQuantity),
    maxOrderQuantity: integer(source.maxOrderQuantity, DEFAULT_EAT_CLEAN_CONFIG.maxOrderQuantity),
    supportPhone: text(source.supportPhone),
    deliveryZones: asArray(source.deliveryZones).map(normalizeZone),
    deliverySlots: asArray(source.deliverySlots).map(normalizeSlot),
    revision: integer(source.revision),
    updatedAt: source.updatedAt,
  }
}

function normalizeMeal(value: unknown, index: number): EatCleanMeal {
  const source = asRecord(value)
  const category = MEAL_CATEGORIES.has(source.category as EatCleanMealCategory) ? source.category as EatCleanMealCategory : 'lunch'
  return {
    id: text(source.id, `meal-${index + 1}`),
    slug: text(source.slug),
    name: text(source.name, `Món Eat Clean ${index + 1}`),
    shortDescription: text(source.shortDescription),
    description: text(source.description),
    category,
    basePrice: integer(source.basePrice),
    compareAtPrice: source.compareAtPrice === null || source.compareAtPrice === undefined ? null : integer(source.compareAtPrice),
    imageUrl: text(source.imageUrl) || undefined,
    calories: number(source.calories),
    protein: number(source.protein),
    carbs: number(source.carbs),
    fat: number(source.fat),
    fiber: number(source.fiber),
    servingGrams: number(source.servingGrams),
    ingredients: stringArray(source.ingredients),
    dietaryTags: stringArray(source.dietaryTags),
    goalTags: stringArray(source.goalTags),
    allergens: stringArray(source.allergens),
    allowedDeliverySlots: stringArray(source.allowedDeliverySlots),
    inventoryTracked: source.inventoryTracked !== false,
    active: source.active !== false,
    featured: source.featured === true,
    sortOrder: integer(source.sortOrder),
    revision: integer(source.revision),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }
}

function normalizeInventory(value: unknown, index: number): EatCleanInventoryItem {
  const source = asRecord(value)
  const capacity = integer(source.capacity)
  const reserved = integer(source.reserved)
  const sold = integer(source.sold)
  return {
    id: text(source.id, `inventory-${index + 1}`),
    mealId: text(source.mealId),
    serviceDate: text(source.serviceDate),
    capacity,
    reserved,
    sold,
    available: Math.max(0, integer(source.available, capacity - reserved - sold)),
    active: source.active !== false,
    revision: integer(source.revision),
    updatedAt: source.updatedAt,
    updatedBy: text(source.updatedBy) || undefined,
  }
}

function normalizeOrderLine(value: unknown, index: number): EatCleanOrderLine {
  const source = asRecord(value)
  const category = MEAL_CATEGORIES.has(source.category as EatCleanMealCategory) ? source.category as EatCleanMealCategory : 'lunch'
  const quantity = integer(source.quantity, 1)
  const unitPrice = integer(source.unitPrice)
  return {
    id: text(source.id, text(source.mealId, `line-${index + 1}`)),
    mealId: text(source.mealId),
    inventoryId: text(source.inventoryId) || undefined,
    name: text(source.name, `Món ${index + 1}`),
    imageUrl: text(source.imageUrl) || undefined,
    category,
    quantity,
    unitPrice,
    lineTotal: integer(source.lineTotal, quantity * unitPrice),
    calories: number(source.calories),
    protein: number(source.protein),
    carbs: number(source.carbs),
    fat: number(source.fat),
    fiber: number(source.fiber),
    inventoryTracked: source.inventoryTracked !== false,
  }
}

function normalizeRefund(value: unknown): EatCleanRefundJob | null {
  const source = asRecord(value)
  const orderId = text(source.orderId)
  const rawStatus = text(source.status) as EatCleanRefundStatus
  if (!orderId || !REFUND_STATUSES.has(rawStatus)) return null
  return {
    id: text(source.id, orderId),
    orderId,
    amount: integer(source.amount),
    currency: text(source.currency, 'VND'),
    paymentMethod: text(source.paymentMethod, 'COD'),
    paymentProvider: source.paymentProvider == null ? null : text(source.paymentProvider),
    status: rawStatus,
    reason: text(source.reason) || undefined,
    refundMode: source.refundMode === 'full' || source.refundMode === 'manual_review' ? source.refundMode : undefined,
    adjustmentId: text(source.adjustmentId) || undefined,
    reversalAdjustmentId: text(source.reversalAdjustmentId) || undefined,
    externalReference: text(source.externalReference) || undefined,
    requestedAt: source.requestedAt,
    resolvedAt: source.resolvedAt,
  }
}

function normalizeOrder(value: unknown, index: number): EatCleanOrder {
  const source = asRecord(value)
  const customer = asRecord(source.customer)
  const status = ORDER_STATUSES.has(source.status as EatCleanOrderStatus) ? source.status as EatCleanOrderStatus : 'pending_confirmation'
  const paymentStatus = PAYMENT_STATUSES.has(source.paymentStatus as EatCleanPaymentStatus) ? source.paymentStatus as EatCleanPaymentStatus : 'unpaid'
  return {
    id: text(source.id, `order-${index + 1}`),
    code: text(source.code, text(source.id, `EC-${index + 1}`)),
    userId: text(source.userId) || undefined,
    customer: {
      name: text(customer.name, 'Khách hàng'),
      phone: text(customer.phone),
      addressLine: text(customer.addressLine),
      ward: text(customer.ward) || undefined,
      districtId: text(customer.districtId),
      cityCode: text(customer.cityCode, 'da-nang'),
      cityName: text(customer.cityName, 'Đà Nẵng'),
    },
    serviceDate: text(source.serviceDate),
    deliverySlot: normalizeSlot(source.deliverySlot, 0),
    deliveryZone: normalizeZone(source.deliveryZone, 0),
    items: asArray(source.items).map(normalizeOrderLine),
    subtotal: integer(source.subtotal),
    deliveryFee: integer(source.deliveryFee),
    total: integer(source.total),
    status,
    paymentStatus,
    paymentMethod: text(source.paymentMethod) || undefined,
    note: text(source.note) || undefined,
    adminNote: text(source.adminNote) || undefined,
    refund: normalizeRefund(source.refund),
    deliveryRecordMissing: source.deliveryRecordMissing === true,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }
}

function normalizeAdminData(value: unknown): EatCleanAdminData {
  const source = asRecord(value)
  const meals = asArray(source.meals).map(normalizeMeal)
  const inventory = asArray(source.inventory).map(normalizeInventory)
  const orders = asArray(source.orders).map(normalizeOrder)
  const config = normalizeConfig(source.config)
  const rawSummary = asRecord(source.summary)
  const byStatusSource = asRecord(rawSummary.byStatus)
  const byStatus = Object.fromEntries(
    [...ORDER_STATUSES].map((status) => [status, integer(byStatusSource[status])]),
  ) as Partial<Record<EatCleanOrderStatus, number>>
  const summary = {
    ...EMPTY_EAT_CLEAN_SUMMARY,
    totalOrders: integer(rawSummary.totalOrders, orders.length),
    deliveredRevenue: integer(rawSummary.deliveredRevenue),
    pendingRefunds: integer(rawSummary.pendingRefunds),
    missingDeliveryRecords: integer(rawSummary.missingDeliveryRecords),
    byStatus,
  }
  const seeded = typeof source.seeded === 'boolean'
    ? source.seeded
    : meals.length > 0 || inventory.length > 0 || orders.length > 0 || (config.revision ?? 0) > 0

  return { schemaVersion: integer(source.schemaVersion, 1), orders, meals, inventory, config, summary, seeded }
}

export async function listEatCleanAdminData(): Promise<EatCleanAdminData> {
  const callable = httpsCallable<Record<string, never>, unknown>(functionsClient(), 'listEatCleanAdminData')
  return normalizeAdminData((await callable({})).data)
}

export async function initializeEatCleanCatalog(): Promise<void> {
  const callable = httpsCallable<Record<string, never>, unknown>(functionsClient(), 'initializeEatCleanCatalog')
  await callable({})
}

export async function saveEatCleanMeal(input: SaveEatCleanMealInput): Promise<EatCleanMeal> {
  const payload = { ...input, expectedRevision: input.expectedRevision ?? input.meal.revision ?? 0 }
  const callable = httpsCallable<typeof payload, { meal: unknown }>(functionsClient(), 'saveEatCleanMeal')
  return normalizeMeal((await callable(payload)).data.meal, 0)
}

export async function saveEatCleanInventory(input: SaveEatCleanInventoryInput): Promise<EatCleanInventoryItem> {
  const callable = httpsCallable<SaveEatCleanInventoryInput, { inventory?: unknown; inventoryItem?: unknown }>(
    functionsClient(),
    'saveEatCleanInventory',
  )
  const response = (await callable(input)).data
  const item = response.inventory ?? response.inventoryItem
  if (!item) throw new Error('Backend không trả về tồn kho vừa cập nhật.')
  return normalizeInventory(item, 0)
}

export async function saveEatCleanConfig(input: SaveEatCleanConfigInput): Promise<EatCleanConfig> {
  const payload = { ...input, expectedRevision: input.expectedRevision ?? input.config.revision ?? 0 }
  const callable = httpsCallable<typeof payload, { config: unknown }>(functionsClient(), 'saveEatCleanConfig')
  return normalizeConfig((await callable(payload)).data.config)
}

export async function updateEatCleanOrder(input: UpdateEatCleanOrderInput): Promise<EatCleanOrderPatch> {
  const callable = httpsCallable<UpdateEatCleanOrderInput, { order: EatCleanOrderPatch }>(functionsClient(), 'updateEatCleanOrder')
  return (await callable(input)).data.order
}

export async function recordEatCleanRefundOutcome(input: {
  orderId: string
  outcome: 'refunded' | 'rejected'
  idempotencyKey: string
  externalReference?: string
  note?: string
  confirmedExternally?: boolean
}): Promise<{ orderId: string; outcome: 'refunded' | 'rejected'; adjustmentId: string; idempotent: boolean }> {
  const callable = httpsCallable<typeof input, {
    orderId: string
    outcome: 'refunded' | 'rejected'
    adjustmentId: string
    idempotent: boolean
  }>(functionsClient(), 'recordEatCleanRefundOutcome')
  return (await callable(input)).data
}

export async function reverseEatCleanRefundOutcome(input: {
  orderId: string
  adjustmentId: string
  idempotencyKey: string
  externalReference: string
  reason: string
  confirmedExternally: true
}): Promise<{ orderId: string; adjustmentId: string; idempotent: boolean }> {
  const callable = httpsCallable<typeof input, {
    orderId: string
    adjustmentId: string
    idempotent: boolean
  }>(functionsClient(), 'reverseEatCleanRefundOutcome')
  return (await callable(input)).data
}

export function getEatCleanAdminErrorMessage(error: unknown): string {
  const source = asRecord(error)
  const code = String(source.code ?? '')
  const message = typeof source.message === 'string' ? source.message.replace(/^Firebase:\s*/i, '') : ''
  if (code.includes('permission-denied')) return 'Tài khoản hiện tại không có quyền quản trị Eat Clean. Chỉ admin và super admin được phép thao tác.'
  if (code.includes('not-found')) return 'Callable Eat Clean chưa được deploy hoặc dữ liệu liên quan chưa tồn tại. Hãy deploy Functions rồi tải lại trang.'
  if (code.includes('unauthenticated')) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để tiếp tục.'
  if (code.includes('aborted')) return 'Dữ liệu vừa được cập nhật ở nơi khác. Hãy tải lại trước khi lưu.'
  if (code.includes('unavailable') || code.includes('deadline-exceeded')) return 'Dịch vụ Eat Clean đang tạm thời không phản hồi. Vui lòng thử lại sau ít phút.'
  return message || 'Không thể xử lý dữ liệu Eat Clean. Vui lòng thử lại.'
}
