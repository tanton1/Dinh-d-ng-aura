export type EatCleanScreen =
  | 'storefront'
  | 'meal-detail'
  | 'cart'
  | 'checkout'
  | 'orders'
  | 'order-detail'

export type EatCleanRoute =
  | { screen: 'storefront' }
  | { screen: 'meal-detail'; mealId: string }
  | { screen: 'cart' }
  | { screen: 'checkout' }
  | { screen: 'orders' }
  | { screen: 'order-detail'; orderId: string }

export type EatCleanMealCategory =
  | 'balanced'
  | 'high-protein'
  | 'low-carb'
  | 'vegetarian'
  | 'breakfast'
  | 'lunch'
  | 'dinner'
  | 'snack'
  | 'combo'

export type EatCleanCurrency = 'VND'

export interface EatCleanNutrition {
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber?: number
}

export interface EatCleanMeal {
  id: string
  slug?: string
  name: string
  shortDescription: string
  description: string
  imageUrl?: string
  gallery?: string[]
  category: EatCleanMealCategory
  tags: string[]
  price: number
  compareAtPrice?: number
  currency: EatCleanCurrency
  nutrition: EatCleanNutrition
  portionLabel: string
  ingredients: string[]
  allergens?: string[]
  prepMinutes?: number
  rating?: number
  reviewCount?: number
  badge?: string
  available: boolean
}

export interface EatCleanCategory {
  id: EatCleanMealCategory | 'all'
  label: string
  description?: string
}

export interface EatCleanDeliverySlot {
  id: string
  label: string
  active: boolean
}

export interface EatCleanDistrict {
  id: string
  name: string
  active: boolean
}

/** Cart persistence intentionally contains no price, title or user data. */
export interface EatCleanCartItem {
  mealId: string
  quantity: number
}

export interface EatCleanCartLine extends EatCleanCartItem {
  meal: EatCleanMeal
  unitPrice: number
  lineTotal: number
}

export interface EatCleanStorefront {
  source: 'live' | 'demo'
  deliveryMode: EatCleanDeliveryMode
  serviceDate?: string
  asapEnabled: boolean
  meals: EatCleanMeal[]
  categories: EatCleanCategory[]
  featuredMealIds: string[]
  orders?: EatCleanOrder[]
  notice?: string
  orderingEnabled: boolean
  nextDeliveryLabel?: string
  freeDeliveryThreshold?: number
  deliverySlots?: EatCleanDeliverySlot[]
  districts?: EatCleanDistrict[]
}

export interface EatCleanCheckoutContact {
  fullName: string
  phone: string
}

export interface EatCleanCoordinate {
  latitude: number
  longitude: number
}

export type EatCleanAddressKind = 'home' | 'work' | 'other'

export interface EatCleanSavedAddress extends EatCleanCoordinate {
  id: string
  kind: EatCleanAddressKind
  label: string
  contact: EatCleanCheckoutContact
  addressLine: string
  formattedAddress?: string
  ward?: string
  districtId?: string
  district?: string
  city: string
  placeId?: string
  entranceNote?: string
  isDefault: boolean
  createdAt?: string
  updatedAt?: string
}

export type EatCleanDeliveryMode = 'asap' | 'scheduled'

export interface EatCleanDeliveryAddress {
  addressLine: string
  formattedAddress?: string
  ward?: string
  districtId?: string
  district?: string
  city: string
  placeId?: string
  latitude?: number
  longitude?: number
  entranceNote?: string
  savedAddressId?: string
  label?: string
  deliveryMode?: EatCleanDeliveryMode
  deliveryDate?: string
  deliveryWindow?: string
}

export interface EatCleanVerifiedDeliveryAddress extends EatCleanCoordinate {
  addressLine: string
  ward?: string
  districtId?: string
  district?: string
  city: string
  placeId?: string
  provider?: string
  verifiedAt?: string
}

export type EatCleanPaymentMethod = 'cod'

export interface EatCleanQuoteRequest {
  items: EatCleanCartItem[]
  contact: EatCleanCheckoutContact
  deliveryAddress: EatCleanDeliveryAddress
  paymentMethod: EatCleanPaymentMethod
  note?: string
}

export interface EatCleanQuoteLine extends EatCleanCartItem {
  name: string
  unitPrice: number
  lineTotal: number
}

export interface EatCleanOrderQuote {
  quoteId: string
  lines: EatCleanQuoteLine[]
  subtotal: number
  deliveryFee: number
  discount: number
  total: number
  currency: EatCleanCurrency
  expiresAt?: string
  unavailableMealIds?: string[]
  nutrition?: EatCleanNutrition
  distanceMeters?: number
  routeDurationSeconds?: number
  estimatedArrivalAt?: string
  promisedAt?: string
  deliveryFeeBeforeDiscount?: number
  deliveryFeeDiscount?: number
  feeRuleVersion?: string
  serviceAreaLabel?: string
  verifiedDeliveryAddress?: EatCleanVerifiedDeliveryAddress
}

export interface EatCleanCreateOrderRequest {
  quoteId: string
  idempotencyKey: string
  items: EatCleanCartItem[]
  contact: EatCleanCheckoutContact
  deliveryAddress: EatCleanDeliveryAddress
  paymentMethod: EatCleanPaymentMethod
  note?: string
}

export type EatCleanOrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'assigned'
  | 'picked-up'
  | 'delivering'
  | 'arrived'
  | 'delivered'
  | 'cancelled'

export interface EatCleanOrderTimelineItem {
  status: EatCleanOrderStatus
  label: string
  at?: string
  completed: boolean
}

export interface EatCleanOrder {
  id: string
  code: string
  status: EatCleanOrderStatus
  items: EatCleanQuoteLine[]
  contact: EatCleanCheckoutContact
  deliveryAddress: EatCleanDeliveryAddress
  paymentMethod: EatCleanPaymentMethod
  subtotal: number
  deliveryFee: number
  discount: number
  total: number
  currency: EatCleanCurrency
  note?: string
  createdAt: string
  updatedAt?: string
  canCancel?: boolean
  consumptionConfirmedAt?: string
  timeline?: EatCleanOrderTimelineItem[]
  estimatedArrivalAt?: string
  promisedAt?: string
  distanceMeters?: number
  shipper?: EatCleanShipperSummary
  tracking?: EatCleanOrderTracking
}

export interface EatCleanShipperSummary {
  id?: string
  displayName: string
  phone?: string
  avatarUrl?: string
  vehicleLabel?: string
  plateNumber?: string
}

export interface EatCleanOrderTracking {
  orderId: string
  status: EatCleanOrderStatus
  shipper?: EatCleanShipperSummary
  shipperLocation?: EatCleanCoordinate
  destination?: EatCleanCoordinate
  kitchenLocation?: EatCleanCoordinate
  routePolyline?: string
  estimatedArrivalAt?: string
  promisedAt?: string
  lastLocationAt?: string
  stale?: boolean
  deliveryOtp?: string
}

export interface EatCleanRecommendationProfile {
  goal?: 'lose-fat' | 'gain-muscle' | 'maintain' | 'health'
  calorieTarget?: number
  allergies?: string[]
  eatingStyle?: string
  remainingCalories?: number
  remainingProtein?: number
}

export interface EatCleanPageProps {
  route: EatCleanRoute
  onNavigate: (route: EatCleanRoute) => void
  ownerId?: string
  displayName?: string
  isDemo?: boolean
  recommendationProfile?: EatCleanRecommendationProfile
  onBack?: () => void
  onOrderCreated?: (order: EatCleanOrder) => void
  onConsumptionConfirmed?: (order: EatCleanOrder) => void
}
