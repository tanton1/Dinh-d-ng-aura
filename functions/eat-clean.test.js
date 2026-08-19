const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { HttpsError } = require('firebase-functions/v2/https')

const {
  DEFAULT_EAT_CLEAN_MEALS,
  __test: {
    DEFAULT_CONFIG,
    ALLERGEN_IDS,
    ACTIVE_DELIVERY_STATUSES,
    normalizeEatCleanConfig,
    normalizeDistancePricing,
    normalizeSavedAddress,
    normalizeMealInput,
    normalizeLineItems,
    inventoryDocumentId,
    availableInventory,
    calculateQuote,
    calculateDistanceDeliveryFee,
    roundedDistance,
    pointInPolygon,
    estimateDeliverySla,
    createGoogleAddressAdapter,
    createGoogleRoutesAdapter,
    verifiedCustomerFromDestination,
    normalizeDeliveryCursor,
    buildActiveDeliveriesQuery,
    nextDeliveryCursor,
    bestEffortRealtimeWrite,
    canonicalOrderRequestHash,
    quoteSnapshotHash,
    validateQuoteRecord,
    rawOrderRequestHash,
    canonicalAllergenIds,
    hasAllergenConflict,
    recommendationScore,
    canTransitionOrder,
    canTransitionDelivery,
    deliveryOtpFor,
    otpHash,
    orderInventoryEffect,
    normalizedConsumedRatio,
    scaledNutrition,
    publicDeliveryValue,
  },
} = require('./eat-clean')

function tomorrow() {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

test('missing Eat Clean config stays safely disabled and COD-only in Da Nang', () => {
  const config = normalizeEatCleanConfig({})
  assert.equal(config.enabled, false)
  assert.equal(config.acceptingOrders, false)
  assert.equal(config.cityCode, 'da-nang')
  assert.equal(config.cityName, 'Đà Nẵng')
  assert.deepEqual(config.paymentMethods, ['COD'])
  assert.ok(config.deliveryZones.length >= 6)
  assert.ok(config.deliverySlots.length >= 2)
  assert.equal(config.distancePricing.enabled, false)
  assert.equal(config.distancePricing.maxDistanceMeters, 10000)
  assert.equal(config.sla.preparationMinutes, 25)
})

test('distance delivery pricing follows Da Nang tiers and rounds safely', () => {
  const pricing = normalizeDistancePricing({ enabled: true })
  assert.equal(roundedDistance(2001, 100), 2100)
  assert.deepEqual(calculateDistanceDeliveryFee(1, pricing), {
    roundedDistanceMeters: 100,
    baseDeliveryFee: 15000,
    feeRuleVersion: 'danang-v1',
  })
  assert.equal(calculateDistanceDeliveryFee(2000, pricing).baseDeliveryFee, 15000)
  assert.equal(calculateDistanceDeliveryFee(2001, pricing).baseDeliveryFee, 16000)
  assert.equal(calculateDistanceDeliveryFee(5000, pricing).baseDeliveryFee, 30000)
  assert.equal(calculateDistanceDeliveryFee(5001, pricing).baseDeliveryFee, 31000)
  assert.equal(calculateDistanceDeliveryFee(10000, pricing).baseDeliveryFee, 60000)
  assert.throws(
    () => calculateDistanceDeliveryFee(10001, pricing),
    (error) => error instanceof HttpsError && error.code === 'out-of-range',
  )
})

test('service polygon and saved address validation bind map coordinates', () => {
  const polygon = [
    { latitude: 15.9, longitude: 108.0 },
    { latitude: 16.2, longitude: 108.0 },
    { latitude: 16.2, longitude: 108.4 },
    { latitude: 15.9, longitude: 108.4 },
  ]
  assert.equal(pointInPolygon({ latitude: 16.05, longitude: 108.2 }, polygon), true)
  assert.equal(pointInPolygon({ latitude: 17, longitude: 108.2 }, polygon), false)
  const address = normalizeSavedAddress({
    label: 'Nhà', fullName: 'An', phone: '0900000000', addressLine: '1 Hải Phòng',
    ward: 'Thạch Thang', district: 'Hải Châu', placeId: 'place-a', latitude: 16.07, longitude: 108.22,
  }, 'home')
  assert.equal(address.id, 'home')
  assert.equal(address.districtId, 'hai-chau')
  assert.equal(address.latitude, 16.07)
  assert.throws(() => normalizeSavedAddress({
    label: 'Nhà', fullName: 'An', phone: '0900000000', addressLine: '1 Hải Phòng', district: 'Hải Châu',
  }, 'home'), (error) => error instanceof HttpsError && error.code === 'invalid-argument')
})

test('map coordinates retain six-decimal delivery precision', () => {
  const customer = require('./eat-clean').__test.normalizeCustomer({
    name: 'An', phone: '0900000000', addressLine: '1 Hải Phòng', district: 'Hải Châu',
    latitude: 16.0470794, longitude: 108.2062304,
  })
  assert.equal(customer.latitude, 16.047079)
  assert.equal(customer.longitude, 108.20623)
})

test('Google Routes adapter is fail-closed without a backend key', async () => {
  const adapter = createGoogleRoutesAdapter({ apiKey: '', fetchImpl: async () => { throw new Error('must not call') } })
  await assert.rejects(
    () => adapter.computeRoute({ origin: { latitude: 16, longitude: 108 }, destination: { latitude: 16.1, longitude: 108.1 } }),
    (error) => error instanceof HttpsError && error.code === 'failed-precondition',
  )
})

test('Google Places canonicalizes a delivery address and rejects a tampered pin', async () => {
  const adapter = createGoogleAddressAdapter({
    apiKey: 'server-key',
    fetchImpl: async (url) => {
      assert.match(String(url), /places\.googleapis\.com\/v1\/places\/place-da-nang/)
      return {
        ok: true,
        async json() {
          return {
            id: 'place-da-nang',
            formattedAddress: '276 Thái Thị Bôi, Thanh Khê, Đà Nẵng, Việt Nam',
            location: { latitude: 16.06001, longitude: 108.19001 },
            addressComponents: [
              { longText: 'Thanh Khê', types: ['administrative_area_level_2'] },
              { longText: 'Đà Nẵng', types: ['administrative_area_level_1'] },
            ],
          }
        },
      }
    },
  })
  const destination = await adapter.resolveDestination({
    placeId: 'place-da-nang',
    addressLine: '276 Thái Thị Bôi',
    district: 'Thanh Khê',
    latitude: 16.06,
    longitude: 108.19,
  })
  const verified = verifiedCustomerFromDestination({
    name: 'An',
    phone: '0900000000',
    addressLine: '276 Thái Thị Bôi',
    district: 'Thanh Khê',
    districtId: 'thanh-khe',
    placeId: 'place-da-nang',
    latitude: 16.06,
    longitude: 108.19,
  }, destination, new Date('2026-08-20T04:00:00.000Z'))
  assert.equal(verified.addressLine, '276 Thái Thị Bôi, Thanh Khê, Đà Nẵng, Việt Nam')
  assert.equal(verified.latitude, 16.06001)
  assert.equal(verified.addressProvider, 'google-places')
  assert.equal(verified.addressVerifiedAt, '2026-08-20T04:00:00.000Z')

  assert.throws(
    () => verifiedCustomerFromDestination({
      ...verified,
      addressLine: 'Địa chỉ xa nhưng ghim giả gần bếp',
      latitude: 16.047,
      longitude: 108.206,
    }, destination),
    (error) => error instanceof HttpsError && error.code === 'failed-precondition',
  )
})

test('Google Geocoding fallback accepts only a canonical Da Nang result near the submitted pin', async () => {
  const adapter = createGoogleAddressAdapter({
    apiKey: 'server-key',
    fetchImpl: async (url) => {
      assert.match(String(url), /maps\.googleapis\.com\/maps\/api\/geocode\/json/)
      return {
        ok: true,
        async json() {
          return {
            status: 'OK',
            results: [{
              place_id: 'geocode-da-nang',
              formatted_address: '1 Hải Phòng, Hải Châu, Đà Nẵng, Việt Nam',
              geometry: { location: { lat: 16.071, lng: 108.218 } },
              address_components: [
                { long_name: 'Hải Châu', types: ['administrative_area_level_2'] },
                { long_name: 'Đà Nẵng', types: ['administrative_area_level_1'] },
              ],
            }],
          }
        },
      }
    },
  })
  const destination = await adapter.resolveDestination({
    addressLine: '1 Hải Phòng',
    ward: 'Thạch Thang',
    district: 'Hải Châu',
    latitude: 16.0711,
    longitude: 108.2181,
  })
  assert.equal(destination.placeId, 'geocode-da-nang')
  assert.equal(destination.provider, 'google-geocoding')
})

test('SLA combines preparation, assignment, pickup, route and grace', () => {
  const config = normalizeEatCleanConfig({})
  const eta = estimateDeliverySla({
    config,
    items: [{ preparationMinutes: 30 }],
    route: { durationSeconds: 600 },
    now: new Date('2026-08-20T04:00:00.000Z'),
  })
  assert.equal(eta.totalMinutes, 63)
  assert.equal(eta.estimatedDeliveryAt, '2026-08-20T05:03:00.000Z')
  assert.equal(eta.promisedAt, '2026-08-20T05:08:00.000Z')
})

test('ASAP orders bypass scheduled cutoff but preserve server-owned slot', () => {
  const config = normalizeEatCleanConfig({ enabled: true, acceptingOrders: true, asapEnabled: true })
  const request = require('./eat-clean').__test.normalizeOrderRequest({
    items: [{ mealId: 'meal-a', quantity: 1 }],
    deliveryMode: 'asap',
    deliverySlotId: 'asap',
    customer: { name: 'An', phone: '0900000000', addressLine: '1 Hải Phòng', district: 'Hải Châu' },
  }, config)
  assert.equal(request.deliveryMode, 'asap')
  assert.equal(request.deliverySlot.id, 'asap')
  assert.equal(request.deliverySlot.start, '')
})

test('delivery state machine and OTP are deterministic without storing plaintext', () => {
  assert.equal(canTransitionDelivery('assigned', 'accepted'), true)
  assert.equal(canTransitionDelivery('accepted', 'picked_up'), false)
  assert.equal(canTransitionDelivery('arrived', 'delivered'), true)
  const secret = '01234567890123456789012345678901'
  const otp = deliveryOtpFor('order-a', 'user-a', secret)
  assert.match(otp, /^\d{4}$/)
  assert.equal(deliveryOtpFor('order-a', 'user-a', secret), otp)
  assert.equal(otpHash('order-a', otp, secret).length, 64)
  assert.notEqual(otpHash('order-a', otp, secret), otpHash('order-a', otp, `${secret}x`))
  const publicDelivery = publicDeliveryValue({
    status: 'assigned', userId: 'private-customer-id', customerId: 'private-customer-id', assignedBy: 'private-admin-id',
    deliveryOtpHash: 'private', deliveryOtpHashVersion: 'hmac-v1', otpFailedAttempts: 2,
  }, 'order-a')
  assert.deepEqual(publicDelivery, { id: 'order-a', status: 'assigned' })
})

test('active delivery queries filter terminal history before ordering, cursoring and limiting', () => {
  const calls = []
  const query = {
    where(...args) { calls.push(['where', ...args]); return this },
    orderBy(...args) { calls.push(['orderBy', ...args]); return this },
    startAfter(...args) { calls.push(['startAfter', ...args]); return this },
    limit(...args) { calls.push(['limit', ...args]); return this },
  }
  const cursor = normalizeDeliveryCursor({ id: 'delivery-9', updatedAt: '2026-08-20T04:00:00.000Z' })
  assert.equal(cursor.updatedAt.toDate().toISOString(), '2026-08-20T04:00:00.000Z')
  assert.equal(buildActiveDeliveriesQuery(query, { shipperId: 'shipper-a', cursor, limit: 25 }), query)
  assert.deepEqual(calls[0], ['where', 'shipperId', '==', 'shipper-a'])
  assert.deepEqual(calls[1], ['where', 'status', 'in', ACTIVE_DELIVERY_STATUSES])
  assert.equal(ACTIVE_DELIVERY_STATUSES.includes('delivered'), false)
  assert.equal(ACTIVE_DELIVERY_STATUSES.includes('cancelled'), false)
  assert.equal(calls[2][0], 'orderBy')
  assert.deepEqual(calls[2].slice(1), ['updatedAt', 'desc'])
  assert.equal(calls[3][0], 'orderBy')
  assert.equal(calls[4][0], 'startAfter')
  assert.deepEqual(calls[4].slice(2), ['delivery-9'])
  assert.deepEqual(calls[5], ['limit', 25])

  const snapshot = {
    empty: false,
    size: 1,
    docs: [{
      id: 'delivery-9',
      data: () => ({ updatedAt: { toDate: () => new Date('2026-08-20T04:00:00.000Z') } }),
    }],
  }
  assert.deepEqual(nextDeliveryCursor(snapshot, 1), {
    id: 'delivery-9',
    updatedAt: '2026-08-20T04:00:00.000Z',
  })
})

test('post-commit Realtime Database mirrors are best-effort and report readiness', async () => {
  const warningCalls = []
  const logger = { warn: (...args) => warningCalls.push(args) }
  const failingRealtimeDb = {
    ref: (path) => ({ path }),
  }
  const failed = await bestEffortRealtimeWrite({
    realtimeDb: failingRealtimeDb,
    path: 'eatCleanLiveLocations/order-a',
    write: async () => {
      const error = new Error('Realtime Database unavailable')
      error.code = 'database/unavailable'
      throw error
    },
    logger,
    context: { operation: 'assign', orderId: 'order-a' },
  })
  assert.deepEqual(failed, {
    configured: true,
    synced: false,
    warning: 'realtime_temporarily_unavailable',
  })
  assert.equal(warningCalls.length, 1)
  assert.equal(warningCalls[0][1].operation, 'assign')
  assert.equal(warningCalls[0][1].code, 'database/unavailable')

  const succeeded = await bestEffortRealtimeWrite({
    realtimeDb: failingRealtimeDb,
    path: 'eatCleanLiveLocations/order-a',
    write: async (reference) => assert.equal(reference.path, 'eatCleanLiveLocations/order-a'),
    logger,
  })
  assert.deepEqual(succeeded, { configured: true, synced: true, warning: null })
  assert.deepEqual(await bestEffortRealtimeWrite({
    realtimeDb: null,
    path: 'eatCleanLiveLocations/order-a',
    write: async () => assert.fail('write must not run without Realtime Database'),
    logger,
  }), {
    configured: false,
    synced: false,
    warning: 'realtime_not_configured',
  })
})

test('default catalog uses deployable project images and normalized nutrition', () => {
  assert.equal(DEFAULT_EAT_CLEAN_MEALS.length, 6)
  DEFAULT_EAT_CLEAN_MEALS.forEach((value) => {
    const meal = normalizeMealInput(value)
    assert.match(meal.imageUrl, /^\/images\/eat-clean\/.+\.webp$/)
    assert.equal(meal.inventoryTracked, true)
    assert.ok(meal.basePrice > 0)
    assert.ok(meal.calories > 0)
    assert.ok(meal.protein > 0)
  })
})

test('cart lines are consolidated and bounded without trusting client prices', () => {
  const config = normalizeEatCleanConfig({ maxItemQuantity: 5, maxOrderQuantity: 8 })
  const items = normalizeLineItems([
    { mealId: 'meal-a', quantity: 2, unitPrice: 1 },
    { mealId: 'meal-a', quantity: 1, unitPrice: 9999999 },
    { mealId: 'meal-b', quantity: 2 },
  ], config)
  assert.deepEqual(items, [
    { mealId: 'meal-a', quantity: 3 },
    { mealId: 'meal-b', quantity: 2 },
  ])
})

test('quote uses server meal price, inventory and Da Nang delivery fee', () => {
  const config = normalizeEatCleanConfig({ enabled: true, acceptingOrders: true })
  const serviceDate = tomorrow()
  const request = {
    items: [{ mealId: 'meal-a', quantity: 2 }],
    serviceDate,
    deliverySlotId: 'lunch',
    deliverySlot: config.deliverySlots.find((slot) => slot.id === 'lunch'),
    deliveryZone: config.deliveryZones.find((zone) => zone.id === 'hai-chau'),
    customer: {},
    paymentMethod: 'COD',
    note: '',
  }
  const mealRecords = new Map([['meal-a', {
    id: 'meal-a',
    name: 'Meal A',
    active: true,
    basePrice: 69000,
    calories: 430,
    protein: 40,
    carbs: 38,
    fat: 12,
    fiber: 6,
    inventoryTracked: true,
    allowedDeliverySlots: ['lunch'],
  }]])
  const inventoryId = inventoryDocumentId(serviceDate, 'meal-a')
  const inventoryRecords = new Map([[inventoryId, { capacity: 10, reserved: 2, sold: 1, active: true }]])
  const quote = calculateQuote({ config, request, mealRecords, inventoryRecords })
  assert.equal(quote.items[0].unitPrice, 69000)
  assert.equal(quote.subtotal, 138000)
  assert.equal(quote.deliveryFee, 20000)
  assert.equal(quote.total, 158000)
  assert.equal(quote.nutrition.calories, 860)
})

test('server quote binds account, normalized input, totals, expiry and one-time use', () => {
  const normalizedRequest = {
    items: [{ mealId: 'meal-a', quantity: 2 }],
    serviceDate: '2026-08-20',
    deliverySlotId: 'lunch',
    customer: {
      name: 'An',
      phone: '0900000000',
      addressLine: '1 Hai Phong',
      ward: 'Thach Thang',
      districtId: 'hai-chau',
      cityCode: 'da-nang',
      cityName: 'Da Nang',
    },
    paymentMethod: 'COD',
    note: '',
  }
  const quote = {
    schemaVersion: 1,
    currency: 'VND',
    paymentMethod: 'COD',
    cityCode: 'da-nang',
    serviceDate: '2026-08-20',
    deliverySlot: { id: 'lunch', start: '10:30', end: '12:30' },
    deliveryZone: { id: 'hai-chau', fee: 20000 },
    items: [{
      mealId: 'meal-a', quantity: 2, unitPrice: 69000, lineTotal: 138000,
      calories: 860, protein: 80, carbs: 76, fat: 24, fiber: 12,
    }],
    subtotal: 138000,
    deliveryFee: 20000,
    total: 158000,
    nutrition: { calories: 860, protein: 80, carbs: 76, fat: 24, fiber: 12 },
  }
  const requestHash = canonicalOrderRequestHash(normalizedRequest)
  const quoteHash = quoteSnapshotHash(quote)
  const activeRecord = {
    userId: 'user-a',
    status: 'active',
    requestHash,
    quoteHash,
    expiresAt: new Date('2026-08-20T04:10:00.000Z'),
  }
  const now = new Date('2026-08-20T04:00:00.000Z')
  assert.equal(validateQuoteRecord({ quoteRecord: activeRecord, userId: 'user-a', requestHash, quoteHash, now }), true)
  assert.notEqual(canonicalOrderRequestHash({ ...normalizedRequest, note: 'Không hành' }), requestHash)
  assert.notEqual(quoteSnapshotHash({ ...quote, total: 158001 }), quoteHash)

  const failsWith = (overrides, code = 'failed-precondition') => assert.throws(
    () => validateQuoteRecord({ quoteRecord: activeRecord, userId: 'user-a', requestHash, quoteHash, now, ...overrides }),
    (error) => error instanceof HttpsError && error.code === code,
  )
  failsWith({ userId: 'user-b' }, 'permission-denied')
  failsWith({ requestHash: canonicalOrderRequestHash({ ...normalizedRequest, note: 'Không hành' }) })
  failsWith({ quoteHash: quoteSnapshotHash({ ...quote, total: 158001 }) })
  failsWith({ quoteRecord: { ...activeRecord, expiresAt: new Date(now.getTime()) } })
  failsWith({ quoteRecord: { ...activeRecord, status: 'consumed', orderId: 'order-a' } })
})

test('allergy aliases normalize Vietnamese and English onboarding values safely', () => {
  assert.deepEqual(canonicalAllergenIds(['Hải sản']), [ALLERGEN_IDS.FISH, ALLERGEN_IDS.SHELLFISH])
  assert.deepEqual(canonicalAllergenIds(['Seafood']), [ALLERGEN_IDS.FISH, ALLERGEN_IDS.SHELLFISH])
  assert.deepEqual(canonicalAllergenIds(['Sữa', 'milk', 'Lúa mì', 'gluten']), [ALLERGEN_IDS.DAIRY, ALLERGEN_IDS.GLUTEN])
  assert.deepEqual(canonicalAllergenIds(['Tôm, cua', 'Đậu phộng', 'Đậu nành', 'Mè']), [
    ALLERGEN_IDS.SHELLFISH,
    ALLERGEN_IDS.PEANUT,
    ALLERGEN_IDS.SOY,
    ALLERGEN_IDS.SESAME,
  ])
  assert.deepEqual(canonicalAllergenIds(['Không dị ứng', 'none']), [])
  assert.equal(hasAllergenConflict(['fish'], ['Hải sản']), true)
  assert.equal(hasAllergenConflict(['shellfish'], ['Hải sản']), true)
  assert.equal(hasAllergenConflict(['Giáp xác'], ['Hải sản']), true)
  assert.equal(hasAllergenConflict(['dairy'], ['Sữa']), true)
  assert.equal(hasAllergenConflict(['gluten'], ['Lúa mì']), true)
  assert.equal(hasAllergenConflict(['egg'], ['Sữa']), false)
})

test('inventory refuses overselling and derives remaining stock', () => {
  assert.equal(availableInventory({ inventoryTracked: true }, { capacity: 10, reserved: 3, sold: 2 }), 5)
  assert.equal(availableInventory({ inventoryTracked: true }, null), 0)
  assert.equal(availableInventory({ inventoryTracked: true }, { capacity: 10, reserved: 3, sold: 2, active: false }), 0)
  assert.equal(availableInventory({ inventoryTracked: false }, null), Number.MAX_SAFE_INTEGER)
})

test('order idempotency hash is stable across object key order and changes with payload', () => {
  const first = {
    items: [{ mealId: 'meal-a', quantity: 1 }],
    customer: { name: 'An', phone: '0900000000' },
    serviceDate: '2026-08-20',
    deliverySlotId: 'lunch',
  }
  const reordered = {
    deliverySlotId: 'lunch',
    serviceDate: '2026-08-20',
    customer: { phone: '0900000000', name: 'An' },
    items: [{ quantity: 1, mealId: 'meal-a' }],
  }
  assert.equal(rawOrderRequestHash(first), rawOrderRequestHash(reordered))
  assert.notEqual(rawOrderRequestHash(first), rawOrderRequestHash({ ...first, items: [{ mealId: 'meal-a', quantity: 2 }] }))
})

test('order status machine includes ready and applies inventory once', () => {
  assert.equal(canTransitionOrder('pending_confirmation', 'confirmed'), true)
  assert.equal(canTransitionOrder('confirmed', 'preparing'), true)
  assert.equal(canTransitionOrder('preparing', 'ready'), true)
  assert.equal(canTransitionOrder('ready', 'out_for_delivery'), true)
  assert.equal(canTransitionOrder('out_for_delivery', 'delivered'), true)
  assert.equal(canTransitionOrder('delivered', 'cancelled'), false)
  assert.equal(orderInventoryEffect('out_for_delivery', 'delivered'), 'sell')
  assert.equal(orderInventoryEffect('ready', 'cancelled'), 'release')
  assert.equal(orderInventoryEffect('delivered', 'delivered'), 'none')
})

test('consumption accepts ratios and percentages while scaling verified nutrition', () => {
  assert.equal(normalizedConsumedRatio(0.25), 0.25)
  assert.equal(normalizedConsumedRatio(25), 0.25)
  assert.equal(normalizedConsumedRatio(100), 1)
  assert.equal(scaledNutrition(486, 0.75), 364.5)
  assert.throws(
    () => normalizedConsumedRatio(10),
    (error) => error instanceof HttpsError && error.code === 'invalid-argument',
  )
})

test('recommendations account for calories and protein remaining', () => {
  const closeFit = recommendationScore({
    calories: 450,
    protein: 38,
    fiber: 6,
    dietaryTags: ['high-protein'],
    goalTags: ['lose-fat'],
  }, { goal: 'lose-fat', dietaryTags: [], remainingCalories: 500, remainingProtein: 45 })
  const weakFit = recommendationScore({
    calories: 900,
    protein: 12,
    fiber: 1,
    dietaryTags: [],
    goalTags: [],
  }, { goal: 'lose-fat', dietaryTags: [], remainingCalories: 500, remainingProtein: 45 })
  assert.ok(closeFit.score > weakFit.score)
  assert.match(closeFit.reasons.join(' '), /năng lượng|đạm/)
})

test('module exposes the complete callable contract and keeps all writes in backend transactions', () => {
  const source = fs.readFileSync(path.join(__dirname, 'eat-clean.js'), 'utf8')
  const callableNames = [
    'listEatCleanAddresses',
    'saveEatCleanAddress',
    'deleteEatCleanAddress',
    'setDefaultEatCleanAddress',
    'getEatCleanStorefront',
    'recommendEatCleanMeals',
    'quoteEatCleanOrder',
    'createEatCleanOrder',
    'listMyEatCleanOrders',
    'cancelEatCleanOrder',
    'confirmEatCleanConsumption',
    'saveEatCleanMeal',
    'saveEatCleanInventory',
    'saveEatCleanConfig',
    'initializeEatCleanCatalog',
    'updateEatCleanOrder',
    'listEatCleanAdminData',
    'setEatCleanShipperAvailability',
    'saveEatCleanDeliveryConfig',
    'listEatCleanDispatchData',
    'assignEatCleanShipper',
    'acceptEatCleanDelivery',
    'updateEatCleanDeliveryMilestone',
    'updateEatCleanShipperLocation',
    'completeEatCleanDelivery',
    'listMyShipperJobs',
    'getEatCleanOrderTracking',
  ]
  callableNames.forEach((name) => assert.match(source, new RegExp(`const ${name} = onCall\\(`)))
  assert.match(source, /invoker: 'public'/)
  assert.match(source, /const createEatCleanOrder[\s\S]*?db\.runTransaction/)
  assert.match(source, /eatCleanQuotes/)
  assert.match(source, /eatCleanQuoteRateLimits/)
  assert.match(source, /enforceEatCleanQuoteRateLimit\(db, userId, quotedAt\)/)
  assert.match(source, /originalRequestHash/)
  assert.match(source, /verifiedCustomer/)
  assert.match(source, /createGoogleAddressAdapter/)
  assert.match(source, /buildActiveDeliveriesQuery/)
  assert.match(source, /countActiveDeliveryJobs/)
  assert.match(source, /bestEffortRealtimeWrite/)
  assert.match(source, /realtimeMirror/)
  assert.match(source, /realtimeTracking/)
  assert.doesNotMatch(source, /where\('shipperId', '==', actorId\)\.limit\(20\)/)
  assert.match(source, /validateQuoteRecord/)
  assert.match(source, /transaction\.update\(quoteReference/)
  assert.match(source, /const cancelEatCleanOrder[\s\S]*?db\.runTransaction/)
  assert.match(source, /const confirmEatCleanConsumption[\s\S]*?db\.runTransaction/)
  assert.match(source, /const initializeEatCleanCatalog[\s\S]*?createdInventory/)
  assert.match(source, /type: 'eat_clean_order'/)
  assert.match(source, /dedupeKey: `eat-clean:/)
  assert.doesNotMatch(source, /screen=tracking/)
  assert.match(source, /#\/eat-clean\?screen=order&orderId=/)
  assert.match(source, /requireTrustedAdmin/)
  assert.match(source, /GOOGLE_MAPS_API_KEY/)
  assert.match(source, /defineSecret\('GOOGLE_MAPS_API_KEY'\)/)
  assert.match(source, /defineSecret\('DELIVERY_OTP_SECRET'\)/)
  assert.match(source, /BIND_EAT_CLEAN_SECRETS/)
  assert.match(source, /assertDeliveryConfigCanActivate\(input, realtimeDb\)/)
  assert.match(source, /assertDeliveryConfigCanActivate\(merged, realtimeDb\)/)
  assert.match(source, /readiness: deliveryRuntimeReadiness\(config, realtimeDb\)/)
  assert.match(source, /const listMyShipperJobs = onCall\(deliveryOperationsCallableOptions/)
  assert.match(source, /deliveryOtpHash/)
  assert.match(source, /deliveryOtpHashVersion: 'hmac-v1'/)
  assert.match(source, /otpFailedAttempts/)
  assert.match(source, /DELIVERY_OTP_MAX_ATTEMPTS/)
  assert.doesNotMatch(source, /deliveryOtp:\s*otp/)
})

test('validation failures use callable-safe HttpsError codes', () => {
  assert.throws(
    () => normalizeEatCleanConfig({ deliveryZones: [] }),
    (error) => error instanceof HttpsError && error.code === 'invalid-argument',
  )
  assert.throws(
    () => normalizeLineItems([], DEFAULT_CONFIG),
    (error) => error instanceof HttpsError && error.code === 'invalid-argument',
  )
})
