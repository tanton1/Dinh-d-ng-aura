import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../lib/firebase'
import {
  DEFAULT_DELIVERY_OPERATIONS_CONFIG,
  type DeliveryCoordinate,
  type EatCleanDeliveryContact,
  type EatCleanDeliveryJob,
  type EatCleanDeliveryJobStatus,
  type EatCleanDeliveryMilestone,
  type EatCleanDeliveryOperationsConfig,
  type EatCleanDeliveryRuntimeReadiness,
  type EatCleanDispatchSnapshot,
  type EatCleanDriverProfile,
  type EatCleanDriverWorkspace,
} from './types'

function functionsClient() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình cho môi trường này.')
  return firebaseFunctions
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function coordinateOf(value: unknown): DeliveryCoordinate | undefined {
  const source = recordOf(value)
  const latitude = finiteNumber(source.latitude, Number.NaN)
  const longitude = finiteNumber(source.longitude, Number.NaN)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined
  return { latitude, longitude }
}

function contactOf(value: unknown, fallbackName: string): EatCleanDeliveryContact {
  const source = recordOf(value)
  return {
    name: text(source.name, text(source.fullName, text(source.label, fallbackName))),
    phone: text(source.phone),
    addressLine: text(source.addressLine),
    note: text(source.note) || undefined,
    coordinate: coordinateOf(source.coordinate ?? source.location ?? source),
  }
}

const JOB_STATUSES = new Set<EatCleanDeliveryJobStatus>([
  'assigned',
  'accepted',
  'arrived_pickup',
  'picked_up',
  'arrived_dropoff',
  'completed',
  'cancelled',
])

function normalizeJob(value: unknown, index: number): EatCleanDeliveryJob {
  const source = recordOf(value)
  const order = recordOf(source.order)
  const route = recordOf(source.route)
  const eta = recordOf(source.eta)
  const statusAliases: Record<string, EatCleanDeliveryJobStatus> = {
    at_store: 'arrived_pickup',
    arrived: 'arrived_dropoff',
    delivered: 'completed',
  }
  const rawStatus = statusAliases[text(source.status)] ?? source.status
  const status = JOB_STATUSES.has(rawStatus as EatCleanDeliveryJobStatus)
    ? rawStatus as EatCleanDeliveryJobStatus
    : 'assigned'
  const promisedAt = text(source.promisedAt, text(eta.promisedAt)) || undefined
  const orderStatus = text(source.orderStatus, text(order.status)) || undefined
  const shipperId = text(source.shipperId) || undefined
  const dropoff = contactOf(source.dropoff ?? source.destination ?? source.customer ?? order.customer, 'Khách hàng')
  if (!dropoff.note) dropoff.note = text(order.note) || undefined
  return {
    id: text(source.id, text(source.orderId, `delivery-${index + 1}`)),
    orderId: text(source.orderId, text(order.id)),
    orderCode: text(source.orderCode, text(order.code, `EC-${index + 1}`)),
    orderStatus,
    shipperId,
    canAssign: source.canAssign === true || (!shipperId && Boolean(orderStatus && ['preparing', 'ready'].includes(orderStatus))),
    status,
    pickup: contactOf(source.pickup, 'Aura Fit Kitchen'),
    dropoff,
    itemCount: Math.max(0, Math.round(finiteNumber(source.itemCount, finiteNumber(order.itemCount)))),
    cashToCollect: Math.max(0, Math.round(finiteNumber(source.cashToCollect, finiteNumber(order.total)))),
    distanceMeters: Math.max(0, Math.round(finiteNumber(source.distanceMeters, finiteNumber(route.distanceMeters)))),
    routeDurationSeconds: Math.max(0, Math.round(finiteNumber(source.routeDurationSeconds, finiteNumber(route.durationSeconds)))),
    promisedAt,
    estimatedArrivalAt: text(source.estimatedArrivalAt, text(eta.estimatedArrivalAt)) || undefined,
    assignedAt: text(source.assignedAt) || undefined,
    acceptedAt: text(source.acceptedAt) || undefined,
    pickedUpAt: text(source.pickedUpAt) || undefined,
    completedAt: text(source.completedAt) || undefined,
    lastLocationAt: text(source.lastLocationAt) || undefined,
    gpsStale: source.gpsStale === true,
    otpFailureCount: Math.max(0, Math.round(finiteNumber(source.otpFailureCount))),
    otpLocked: source.otpLocked === true,
    customerDeliveryOtpRequired: source.customerDeliveryOtpRequired !== false,
    isLate: source.isLate === true || Boolean(promisedAt && Number.isFinite(Date.parse(promisedAt)) && Date.parse(promisedAt) < Date.now() && !['completed', 'cancelled'].includes(status)),
  }
}

function normalizeDriver(value: unknown, index: number): EatCleanDriverProfile {
  const source = recordOf(value)
  return {
    name: text(source.name, text(source.displayName, `Shipper ${index + 1}`)),
    phone: text(source.phone, text(source.phoneNumber)),
    avatarUrl: text(source.avatarUrl, text(source.photoURL)) || undefined,
    vehicleLabel: text(source.vehicleLabel) || undefined,
    licensePlate: text(source.licensePlate) || undefined,
    id: text(source.id, text(source.uid, text(source.userId, `driver-${index + 1}`))),
    available: source.available === true,
    activeJobCount: Math.max(0, Math.round(finiteNumber(source.activeJobCount))),
    lastLocationAt: text(source.lastLocationAt, text(source.lastSeenAt)) || undefined,
    coordinate: coordinateOf(source.coordinate ?? source.location),
  }
}

function normalizeReadiness(value: unknown): EatCleanDeliveryRuntimeReadiness {
  const source = recordOf(value)
  return {
    secretBindingEnabled: source.secretBindingEnabled === true,
    mapsKeyAvailable: source.mapsKeyAvailable === true,
    storeCoordinateReady: source.storeCoordinateReady === true,
    distancePricingReady: source.distancePricingReady === true,
    realtimeDatabaseReady: source.realtimeDatabaseReady === true,
    otpKeyAvailable: source.otpKeyAvailable === true,
    dispatchReady: source.dispatchReady === true,
  }
}

function normalizeSignals(value: unknown): EatCleanDispatchSnapshot['signals'] {
  const source = recordOf(value)
  return {
    mapsErrorsToday: Math.max(0, Math.round(finiteNumber(source.mapsErrorsToday))),
    otpRejected: Math.max(0, Math.round(finiteNumber(source.otpRejected))),
    otpLocked: Math.max(0, Math.round(finiteNumber(source.otpLocked))),
    gpsStale: Math.max(0, Math.round(finiteNumber(source.gpsStale))),
    lateOrders: Math.max(0, Math.round(finiteNumber(source.lateOrders))),
    gpsReadWarning: text(source.gpsReadWarning) || undefined,
  }
}

function normalizeConfig(value: unknown): EatCleanDeliveryOperationsConfig {
  const source = recordOf(value)
  const storeSource = recordOf(source.store)
  const distancePricing = recordOf(source.distancePricing)
  const surge = recordOf(source.surge)
  const kitchenCoordinate = coordinateOf(source.kitchenCoordinate ?? storeSource)
  const slaSource = recordOf(source.sla)
  const rawPricingTiers = Array.isArray(source.pricingTiers)
    ? source.pricingTiers
    : Array.isArray(distancePricing.tiers) ? distancePricing.tiers : []
  let previousLimitKm = 0
  const pricingTiers = rawPricingTiers.length
    ? rawPricingTiers.flatMap((item, index) => {
      const tier = recordOf(item)
      const fromKm = finiteNumber(tier.fromKm, previousLimitKm)
      const toKm = finiteNumber(tier.toKm, finiteNumber(tier.upToMeters, Number.NaN) / 1000)
      if (!Number.isFinite(fromKm) || !Number.isFinite(toKm)) return []
      previousLimitKm = toKm
      return [{
        id: text(tier.id, `tier-${index + 1}`),
        fromKm,
        toKm,
        pricePerKm: Math.max(0, Math.round(finiteNumber(tier.pricePerKm, finiteNumber(tier.perKm)))),
        baseFee: tier.baseFee == null ? undefined : Math.max(0, Math.round(finiteNumber(tier.baseFee))),
      }]
    })
    : DEFAULT_DELIVERY_OPERATIONS_CONFIG.pricingTiers
  return {
    ...DEFAULT_DELIVERY_OPERATIONS_CONFIG,
    kitchenName: text(source.kitchenName, text(storeSource.label, DEFAULT_DELIVERY_OPERATIONS_CONFIG.kitchenName)),
    kitchenAddress: text(source.kitchenAddress, text(storeSource.addressLine, DEFAULT_DELIVERY_OPERATIONS_CONFIG.kitchenAddress)),
    kitchenCoordinate,
    serviceCity: text(source.serviceCity, DEFAULT_DELIVERY_OPERATIONS_CONFIG.serviceCity),
    distancePricingEnabled: typeof source.distancePricingEnabled === 'boolean'
      ? source.distancePricingEnabled
      : distancePricing.enabled === true,
    maxDeliveryKm: finiteNumber(source.maxDeliveryKm, finiteNumber(distancePricing.maxDistanceMeters, DEFAULT_DELIVERY_OPERATIONS_CONFIG.maxDeliveryKm * 1000) / 1000),
    freeDeliveryThreshold: Math.max(0, Math.round(finiteNumber(source.freeDeliveryThreshold, DEFAULT_DELIVERY_OPERATIONS_CONFIG.freeDeliveryThreshold))),
    surgeEnabled: source.surgeEnabled === true || surge.enabled === true,
    surgeFee: Math.max(0, Math.round(finiteNumber(source.surgeFee, finiteNumber(surge.fee)))),
    surgeReason: text(source.surgeReason, text(surge.reason)),
    surgeEndsAt: text(source.surgeEndsAt, text(surge.endsAt)) || undefined,
    pricingTiers: pricingTiers.length ? pricingTiers : DEFAULT_DELIVERY_OPERATIONS_CONFIG.pricingTiers,
    sla: {
      confirmationMinutes: finiteNumber(slaSource.confirmationMinutes, DEFAULT_DELIVERY_OPERATIONS_CONFIG.sla.confirmationMinutes),
      preparationMinutes: finiteNumber(slaSource.preparationMinutes, DEFAULT_DELIVERY_OPERATIONS_CONFIG.sla.preparationMinutes),
      assignmentMinutes: finiteNumber(slaSource.assignmentMinutes, DEFAULT_DELIVERY_OPERATIONS_CONFIG.sla.assignmentMinutes),
      pickupWaitMinutes: finiteNumber(slaSource.pickupWaitMinutes, finiteNumber(slaSource.pickupMinutes, DEFAULT_DELIVERY_OPERATIONS_CONFIG.sla.pickupWaitMinutes)),
      trafficBufferMinutes: finiteNumber(slaSource.trafficBufferMinutes, finiteNumber(slaSource.travelBufferMinutes, DEFAULT_DELIVERY_OPERATIONS_CONFIG.sla.trafficBufferMinutes)),
      lateGraceMinutes: finiteNumber(slaSource.lateGraceMinutes, DEFAULT_DELIVERY_OPERATIONS_CONFIG.sla.lateGraceMinutes),
    },
    revision: Math.max(0, Math.round(finiteNumber(source.revision))),
  }
}

export async function listMyEatCleanDeliveryJobs(): Promise<EatCleanDriverWorkspace> {
  const callable = httpsCallable<Record<string, never>, unknown>(functionsClient(), 'listMyShipperJobs')
  const source = recordOf((await callable({})).data)
  return {
    driver: normalizeDriver(source.driver ?? source.shipper, 0),
    jobs: (Array.isArray(source.jobs) ? source.jobs : Array.isArray(source.deliveries) ? source.deliveries : []).map(normalizeJob),
    readiness: source.readiness && typeof source.readiness === 'object'
      ? normalizeReadiness(source.readiness)
      : undefined,
    serverTime: text(source.serverTime) || undefined,
  }
}

export async function setEatCleanDriverAvailability(available: boolean): Promise<EatCleanDriverProfile> {
  const callable = httpsCallable<{ available: boolean }, unknown>(functionsClient(), 'setEatCleanShipperAvailability')
  const source = recordOf((await callable({ available })).data)
  return normalizeDriver(source.driver ?? source.shipper ?? source, 0)
}

export async function acceptEatCleanDelivery(deliveryId: string): Promise<EatCleanDeliveryJob> {
  const callable = httpsCallable<{ orderId: string }, unknown>(functionsClient(), 'acceptEatCleanDelivery')
  const source = recordOf((await callable({ orderId: deliveryId })).data)
  return normalizeJob(source.delivery ?? source, 0)
}

export async function updateEatCleanDeliveryMilestone(
  deliveryId: string,
  milestone: Exclude<EatCleanDeliveryMilestone, 'accepted' | 'completed'>,
): Promise<EatCleanDeliveryJob> {
  const backendMilestone = {
    arrived_pickup: 'arrived_at_store',
    picked_up: 'picked_up',
    arrived_dropoff: 'arrived_at_customer',
  }[milestone]
  const callable = httpsCallable<{ orderId: string; milestone: string }, unknown>(functionsClient(), 'updateEatCleanDeliveryMilestone')
  const source = recordOf((await callable({ orderId: deliveryId, milestone: backendMilestone })).data)
  return normalizeJob(source.delivery ?? source, 0)
}

export async function completeEatCleanDelivery(deliveryId: string, otpCode: string): Promise<EatCleanDeliveryJob> {
  const callable = httpsCallable<{ orderId: string; otp: string }, unknown>(functionsClient(), 'completeEatCleanDelivery')
  const source = recordOf((await callable({ orderId: deliveryId, otp: otpCode })).data)
  return normalizeJob(source.delivery ?? source, 0)
}

export async function listEatCleanDispatchSnapshot(): Promise<EatCleanDispatchSnapshot> {
  try {
    const dispatchCallable = httpsCallable<Record<string, never>, unknown>(functionsClient(), 'listEatCleanDispatchData')
    const dispatchResult = await dispatchCallable({})
    const source = recordOf(dispatchResult.data)
    const rawDeliveries = Array.isArray(source.jobs)
      ? source.jobs
      : Array.isArray(source.deliveries) ? source.deliveries : []

    // Older deployments did not include the order/config snapshot in the dispatch
    // callable. Only use the heavier admin endpoint as a compatibility fallback.
    let adminSource: Record<string, unknown> = {}
    if (!source.config || typeof source.config !== 'object') {
      const adminCallable = httpsCallable<Record<string, never>, unknown>(functionsClient(), 'listEatCleanAdminData')
      adminSource = recordOf((await adminCallable({})).data)
    }
    const orders = Array.isArray(adminSource.orders) ? adminSource.orders.map(recordOf) : []
    const orderById = new Map(orders.map((order) => [text(order.id), order]))
    const deliveries = rawDeliveries
      .map((value) => {
        const delivery = recordOf(value)
        const order = orderById.get(text(delivery.orderId, text(delivery.id)))
        if (!order) return delivery
        const items = Array.isArray(order.items) ? order.items.map(recordOf) : []
        return {
          ...delivery,
          order,
          orderStatus: order.status,
          itemCount: items.reduce((total, item) => total + Math.max(0, finiteNumber(item.quantity)), 0),
          cashToCollect: order.paymentStatus === 'paid' ? 0 : finiteNumber(order.total),
        }
      })
    return {
      jobs: deliveries.map(normalizeJob),
      drivers: (Array.isArray(source.drivers) ? source.drivers : Array.isArray(source.shippers) ? source.shippers : []).map(normalizeDriver),
      config: normalizeConfig(source.config ?? adminSource.config),
      readiness: normalizeReadiness(source.readiness),
      signals: normalizeSignals(source.signals ?? source.summary),
      serverTime: text(source.serverTime) || undefined,
    }
  } catch (error) {
    const code = text(recordOf(error).code)
    if (!code.includes('not-found') && !code.includes('unimplemented')) throw error
    const callable = httpsCallable<Record<string, never>, unknown>(functionsClient(), 'listMyShipperJobs')
    const source = recordOf((await callable({})).data)
    const jobs = Array.isArray(source.deliveries) ? source.deliveries : []
    return {
      jobs: jobs.map(normalizeJob),
      drivers: [],
      config: DEFAULT_DELIVERY_OPERATIONS_CONFIG,
      readiness: normalizeReadiness(source.readiness),
      signals: normalizeSignals(source.signals ?? source.summary),
    }
  }
}

export async function assignEatCleanShipper(deliveryId: string, shipperId: string): Promise<EatCleanDeliveryJob> {
  const callable = httpsCallable<{ orderId: string; shipperId: string }, unknown>(functionsClient(), 'assignEatCleanShipper')
  const source = recordOf((await callable({ orderId: deliveryId, shipperId })).data)
  return normalizeJob(source.delivery ?? source, 0)
}

export async function saveEatCleanDeliveryOperationsConfig(
  config: EatCleanDeliveryOperationsConfig,
): Promise<EatCleanDeliveryOperationsConfig> {
  const payload = {
    config: {
      store: {
        label: config.kitchenName,
        addressLine: config.kitchenAddress,
        latitude: config.kitchenCoordinate?.latitude ?? null,
        longitude: config.kitchenCoordinate?.longitude ?? null,
      },
      distancePricing: {
        enabled: config.distancePricingEnabled,
        provider: 'google-routes',
        maxDistanceMeters: Math.round(config.maxDeliveryKm * 1000),
        distanceRoundingMeters: 100,
        feeRoundingVnd: 1000,
        feeRuleVersion: `danang-${Date.now()}`,
        tiers: config.pricingTiers.map((tier) => ({
          upToMeters: Math.round(tier.toKm * 1000),
          baseFee: tier.baseFee ?? 0,
          perKm: tier.pricePerKm,
        })),
      },
      sla: {
        confirmationMinutes: config.sla.confirmationMinutes,
        preparationMinutes: config.sla.preparationMinutes,
        assignmentMinutes: config.sla.assignmentMinutes,
        pickupMinutes: config.sla.pickupWaitMinutes,
        travelBufferMinutes: config.sla.trafficBufferMinutes,
        lateGraceMinutes: config.sla.lateGraceMinutes,
      },
      freeDeliveryThreshold: config.freeDeliveryThreshold,
    },
    expectedRevision: config.revision ?? 0,
  }
  const callable = httpsCallable<typeof payload, unknown>(functionsClient(), 'saveEatCleanDeliveryConfig')
  const source = recordOf((await callable(payload)).data)
  return normalizeConfig(source.config ?? source)
}

export async function publishEatCleanDriverLocation(
  deliveryId: string,
  driverId: string,
  position: GeolocationPosition,
): Promise<void> {
  const { latitude, longitude, accuracy, heading, speed } = position.coords
  const payload = {
    orderId: deliveryId,
    latitude,
    longitude,
    accuracyMeters: Number.isFinite(accuracy) ? accuracy : null,
    heading: heading != null && Number.isFinite(heading) ? heading : null,
    speedMetersPerSecond: speed != null && Number.isFinite(speed) ? speed : null,
    capturedAt: position.timestamp,
  }
  const callable = httpsCallable<typeof payload, unknown>(functionsClient(), 'updateEatCleanShipperLocation')
  await callable(payload)
}

export function getDeliveryServiceError(error: unknown): string {
  const source = recordOf(error)
  const code = text(source.code)
  const message = text(source.message)
  if (code.includes('permission-denied') && /otp|mã giao|mã xác nhận/i.test(message)) return message
  if (code.includes('permission-denied')) return 'Tài khoản chưa có quyền vận hành giao hàng.'
  if (code.includes('unauthenticated')) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
  if (code.includes('not-found')) return 'Chức năng giao hàng chưa được deploy hoặc đơn không còn tồn tại.'
  if (code.includes('failed-precondition')) return text(source.message, 'Trạng thái đơn đã thay đổi. Hãy tải lại dữ liệu.')
  if (code.includes('invalid-argument')) return text(source.message, 'Dữ liệu giao hàng chưa hợp lệ.')
  if (code.includes('unavailable') || code.includes('deadline-exceeded')) return 'Dịch vụ giao hàng đang tạm gián đoạn. Hãy thử lại.'
  return message || 'Không thể xử lý yêu cầu giao hàng. Hãy thử lại.'
}
