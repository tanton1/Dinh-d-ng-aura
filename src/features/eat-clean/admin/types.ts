import type { UserRole } from '../../../types'

export type EatCleanAdminRole = Extract<UserRole, 'admin' | 'super_admin'>

export type EatCleanOrderStatus =
  | 'pending_confirmation'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'

export type EatCleanPaymentStatus = 'unpaid' | 'paid' | 'refunded'

export type EatCleanRefundStatus =
  | 'blocked_provider_not_configured'
  | 'manual_review_required'
  | 'refunded'
  | 'rejected'

export interface EatCleanRefundJob {
  id: string
  orderId: string
  amount: number
  currency: string
  paymentMethod: string
  paymentProvider?: string | null
  status: EatCleanRefundStatus
  reason?: string
  refundMode?: 'full' | 'manual_review'
  adjustmentId?: string
  reversalAdjustmentId?: string
  externalReference?: string
  requestedAt?: unknown
  resolvedAt?: unknown
}

export type EatCleanMealCategory = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export type EatCleanInventoryStatus = 'in_stock' | 'low_stock' | 'out_of_stock'

export interface EatCleanOrderLine {
  id: string
  mealId: string
  inventoryId?: string
  name: string
  imageUrl?: string
  category: EatCleanMealCategory
  quantity: number
  unitPrice: number
  lineTotal: number
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber?: number
  inventoryTracked?: boolean
}

export interface EatCleanCustomer {
  name: string
  phone: string
  addressLine: string
  ward?: string
  districtId: string
  cityCode: string
  cityName: string
}

export interface EatCleanDeliverySlot {
  id: string
  label: string
  start: string
  end: string
  enabled: boolean
}

export interface EatCleanDeliveryZone {
  id: string
  label: string
  fee: number
  enabled: boolean
}

export interface EatCleanOrder {
  id: string
  code: string
  userId?: string
  customer: EatCleanCustomer
  serviceDate: string
  deliverySlot: EatCleanDeliverySlot
  deliveryZone: EatCleanDeliveryZone
  items: EatCleanOrderLine[]
  subtotal: number
  deliveryFee: number
  total: number
  status: EatCleanOrderStatus
  paymentStatus: EatCleanPaymentStatus
  paymentMethod?: string
  note?: string
  adminNote?: string
  refund?: EatCleanRefundJob | null
  createdAt?: unknown
  updatedAt?: unknown
}

export interface EatCleanMeal {
  id: string
  slug: string
  name: string
  shortDescription: string
  description: string
  category: EatCleanMealCategory
  basePrice: number
  compareAtPrice: number | null
  imageUrl?: string
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  servingGrams: number
  ingredients: string[]
  dietaryTags: string[]
  goalTags: string[]
  allergens: string[]
  allowedDeliverySlots: string[]
  inventoryTracked: boolean
  active: boolean
  featured: boolean
  sortOrder: number
  revision?: number
  createdAt?: unknown
  updatedAt?: unknown
}

export interface EatCleanInventoryItem {
  id: string
  mealId: string
  serviceDate: string
  capacity: number
  reserved: number
  sold: number
  available: number
  active: boolean
  revision?: number
  updatedAt?: unknown
  updatedBy?: string
}

export interface EatCleanConfig {
  schemaVersion?: number
  enabled: boolean
  acceptingOrders: boolean
  cityCode: string
  cityName: string
  currency: string
  paymentMethods: string[]
  minOrderAmount: number
  defaultDeliveryFee: number
  freeDeliveryThreshold: number
  sameDayCutoff: string
  minimumLeadDays: number
  maxAdvanceDays: number
  cancellationCutoffHours: number
  maxItemQuantity: number
  maxOrderQuantity: number
  supportPhone: string
  deliveryZones: EatCleanDeliveryZone[]
  deliverySlots: EatCleanDeliverySlot[]
  revision?: number
  updatedAt?: unknown
}

export interface EatCleanAdminSummary {
  totalOrders: number
  deliveredRevenue: number
  pendingRefunds: number
  byStatus: Partial<Record<EatCleanOrderStatus, number>>
}

export interface EatCleanAdminData {
  schemaVersion?: number
  orders: EatCleanOrder[]
  meals: EatCleanMeal[]
  inventory: EatCleanInventoryItem[]
  config: EatCleanConfig
  summary: EatCleanAdminSummary
  seeded: boolean
}

export interface SaveEatCleanMealInput {
  meal: EatCleanMeal
  expectedRevision?: number
}

export interface SaveEatCleanInventoryInput {
  mealId: string
  serviceDate: string
  capacity: number
  active: boolean
  expectedRevision?: number
}

export interface SaveEatCleanConfigInput {
  config: EatCleanConfig
  expectedRevision?: number
}

export interface UpdateEatCleanOrderInput {
  orderId: string
  status: EatCleanOrderStatus
  adminNote?: string
  paymentStatus?: 'paid' | 'unpaid'
  cancellationReason?: string
}

export type EatCleanOrderPatch = Pick<EatCleanOrder, 'id' | 'status'> & Partial<EatCleanOrder>

export const DEFAULT_EAT_CLEAN_CONFIG: EatCleanConfig = {
  enabled: false,
  acceptingOrders: false,
  cityCode: 'da-nang',
  cityName: 'Đà Nẵng',
  currency: 'VND',
  paymentMethods: ['COD'],
  minOrderAmount: 80_000,
  defaultDeliveryFee: 25_000,
  freeDeliveryThreshold: 350_000,
  sameDayCutoff: '09:00',
  minimumLeadDays: 0,
  maxAdvanceDays: 14,
  cancellationCutoffHours: 4,
  maxItemQuantity: 20,
  maxOrderQuantity: 40,
  supportPhone: '',
  deliveryZones: [],
  deliverySlots: [],
}

export const EMPTY_EAT_CLEAN_SUMMARY: EatCleanAdminSummary = {
  totalOrders: 0,
  deliveredRevenue: 0,
  pendingRefunds: 0,
  byStatus: {},
}
