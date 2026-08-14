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
    normalizeEatCleanConfig,
    normalizeMealInput,
    normalizeLineItems,
    inventoryDocumentId,
    availableInventory,
    calculateQuote,
    canonicalOrderRequestHash,
    quoteSnapshotHash,
    validateQuoteRecord,
    rawOrderRequestHash,
    canonicalAllergenIds,
    hasAllergenConflict,
    recommendationScore,
    canTransitionOrder,
    orderInventoryEffect,
    normalizedConsumedRatio,
    scaledNutrition,
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
  ]
  callableNames.forEach((name) => assert.match(source, new RegExp(`const ${name} = onCall\\(`)))
  assert.match(source, /invoker: 'public'/)
  assert.match(source, /const createEatCleanOrder[\s\S]*?db\.runTransaction/)
  assert.match(source, /eatCleanQuotes/)
  assert.match(source, /validateQuoteRecord/)
  assert.match(source, /transaction\.update\(quoteReference/)
  assert.match(source, /const cancelEatCleanOrder[\s\S]*?db\.runTransaction/)
  assert.match(source, /const confirmEatCleanConsumption[\s\S]*?db\.runTransaction/)
  assert.match(source, /const initializeEatCleanCatalog[\s\S]*?createdInventory/)
  assert.match(source, /type: 'eat_clean_order'/)
  assert.match(source, /dedupeKey: `eat-clean:/)
  assert.match(source, /requireTrustedAdmin/)
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
