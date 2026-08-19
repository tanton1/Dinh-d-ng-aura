export type EatCleanDeliveryMilestone =
  | 'accepted'
  | 'arrived_pickup'
  | 'picked_up'
  | 'arrived_dropoff'
  | 'completed'

export type EatCleanDeliveryJobStatus =
  | 'assigned'
  | EatCleanDeliveryMilestone
  | 'cancelled'

export interface DeliveryCoordinate {
  latitude: number
  longitude: number
}

export interface EatCleanDeliveryContact {
  name: string
  phone: string
  addressLine: string
  note?: string
  coordinate?: DeliveryCoordinate
}

export interface EatCleanDeliveryJob {
  id: string
  orderId: string
  orderCode: string
  orderStatus?: string
  shipperId?: string
  canAssign: boolean
  status: EatCleanDeliveryJobStatus
  pickup: EatCleanDeliveryContact
  dropoff: EatCleanDeliveryContact
  itemCount: number
  cashToCollect: number
  distanceMeters: number
  routeDurationSeconds: number
  promisedAt?: string
  estimatedArrivalAt?: string
  assignedAt?: string
  acceptedAt?: string
  pickedUpAt?: string
  completedAt?: string
  customerDeliveryOtpRequired: boolean
  isLate: boolean
}

export interface EatCleanDriverProfile {
  id: string
  name: string
  phone: string
  avatarUrl?: string
  vehicleLabel?: string
  licensePlate?: string
  available: boolean
  activeJobCount: number
  lastLocationAt?: string
  coordinate?: DeliveryCoordinate
}

export interface EatCleanDriverWorkspace {
  driver: EatCleanDriverProfile
  jobs: EatCleanDeliveryJob[]
  readiness?: EatCleanDeliveryRuntimeReadiness
  serverTime?: string
}

export interface EatCleanDeliveryRuntimeReadiness {
  secretBindingEnabled: boolean
  mapsKeyAvailable: boolean
  storeCoordinateReady: boolean
  distancePricingReady: boolean
  realtimeDatabaseReady: boolean
  otpKeyAvailable: boolean
  dispatchReady: boolean
}

export interface EatCleanDeliveryPricingTier {
  id: string
  fromKm: number
  toKm: number
  pricePerKm: number
  baseFee?: number
}

export interface EatCleanDeliverySlaConfig {
  confirmationMinutes: number
  preparationMinutes: number
  assignmentMinutes: number
  pickupWaitMinutes: number
  trafficBufferMinutes: number
  lateGraceMinutes: number
}

export interface EatCleanDeliveryOperationsConfig {
  kitchenName: string
  kitchenAddress: string
  kitchenCoordinate?: DeliveryCoordinate
  serviceCity: string
  distancePricingEnabled: boolean
  maxDeliveryKm: number
  freeDeliveryThreshold: number
  surgeEnabled: boolean
  surgeFee: number
  surgeReason: string
  surgeEndsAt?: string
  pricingTiers: EatCleanDeliveryPricingTier[]
  sla: EatCleanDeliverySlaConfig
  revision?: number
}

export interface EatCleanDispatchSnapshot {
  jobs: EatCleanDeliveryJob[]
  drivers: EatCleanDriverProfile[]
  config: EatCleanDeliveryOperationsConfig
  readiness: EatCleanDeliveryRuntimeReadiness
  serverTime?: string
}

export const DEFAULT_DELIVERY_OPERATIONS_CONFIG: EatCleanDeliveryOperationsConfig = {
  kitchenName: 'Aura Fit Kitchen',
  kitchenAddress: 'Đà Nẵng',
  serviceCity: 'Đà Nẵng',
  distancePricingEnabled: false,
  maxDeliveryKm: 10,
  freeDeliveryThreshold: 350_000,
  surgeEnabled: false,
  surgeFee: 0,
  surgeReason: '',
  pricingTiers: [
    { id: 'tier-0-2', fromKm: 0, toKm: 2, baseFee: 15_000, pricePerKm: 0 },
    { id: 'tier-2-5', fromKm: 2, toKm: 5, baseFee: 15_000, pricePerKm: 5_000 },
    { id: 'tier-5-10', fromKm: 5, toKm: 10, baseFee: 30_000, pricePerKm: 6_000 },
  ],
  sla: {
    confirmationMinutes: 3,
    preparationMinutes: 25,
    assignmentMinutes: 5,
    pickupWaitMinutes: 10,
    trafficBufferMinutes: 5,
    lateGraceMinutes: 5,
  },
}
