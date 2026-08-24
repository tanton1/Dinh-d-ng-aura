const { createHash, createHmac, timingSafeEqual } = require('node:crypto')
const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { eatCleanRevenueRecognitionWrites } = require('./finance-recognition')

const CITY_CODE = 'da-nang'
const CITY_NAME = 'Đà Nẵng'
const CURRENCY = 'VND'
const PAYMENT_METHOD = 'COD'
const SCHEMA_VERSION = 1
const QUOTE_TTL_MS = 10 * 60 * 1000
const MAX_SAVED_ADDRESSES = 20
const LIVE_LOCATION_STALE_MS = 2 * 60 * 1000
const LIVE_LOCATION_RETENTION_MS = 24 * 60 * 60 * 1000
const DELIVERY_PIN_TOLERANCE_METERS = 250
const QUOTE_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000
const QUOTE_RATE_LIMIT_MAX = 20
const DELIVERY_OTP_MAX_ATTEMPTS = 5
const DELIVERY_OTP_LOCK_MS = 15 * 60 * 1000
// Secret bindings must be declared unconditionally so every deployed revision
// receives the Secret Manager values it needs. Runtime environment flags are
// evaluated too late for Firebase's function manifest discovery.
const googleMapsApiKeySecret = defineSecret('GOOGLE_MAPS_API_KEY')
const deliveryOtpSecret = defineSecret('DELIVERY_OTP_SECRET')
const DELIVERY_STATUSES = new Set([
  'awaiting_kitchen',
  'awaiting_assignment',
  'assigned',
  'accepted',
  'at_store',
  'picked_up',
  'arrived',
  'delivered',
  'cancelled',
])
const DELIVERY_TRANSITIONS = Object.freeze({
  awaiting_kitchen: new Set(['awaiting_assignment', 'cancelled']),
  awaiting_assignment: new Set(['assigned', 'cancelled']),
  assigned: new Set(['accepted', 'awaiting_assignment', 'cancelled']),
  accepted: new Set(['at_store', 'cancelled']),
  at_store: new Set(['picked_up', 'cancelled']),
  // Once food has left the kitchen, cancellation must be handled as a
  // delivery/payment incident instead of silently releasing inventory.
  picked_up: new Set(['arrived']),
  arrived: new Set(['delivered']),
  delivered: new Set(),
  cancelled: new Set(),
})
const ACTIVE_DELIVERY_STATUSES = Object.freeze([
  'awaiting_kitchen',
  'awaiting_assignment',
  'assigned',
  'accepted',
  'at_store',
  'picked_up',
  'arrived',
])

const ALLERGEN_IDS = Object.freeze({
  FISH: 'fish',
  SHELLFISH: 'shellfish',
  DAIRY: 'dairy',
  GLUTEN: 'gluten',
  EGG: 'egg',
  PEANUT: 'peanut',
  TREE_NUT: 'tree-nut',
  SOY: 'soy',
  SESAME: 'sesame',
})
const CANONICAL_ALLERGEN_IDS = new Set(Object.values(ALLERGEN_IDS))
const ALLERGEN_ALIASES = Object.freeze({
  fish: [ALLERGEN_IDS.FISH],
  ca: [ALLERGEN_IDS.FISH],
  'ca-bien': [ALLERGEN_IDS.FISH],
  seafood: [ALLERGEN_IDS.FISH, ALLERGEN_IDS.SHELLFISH],
  'hai-san': [ALLERGEN_IDS.FISH, ALLERGEN_IDS.SHELLFISH],
  shellfish: [ALLERGEN_IDS.SHELLFISH],
  crustacean: [ALLERGEN_IDS.SHELLFISH],
  crustaceans: [ALLERGEN_IDS.SHELLFISH],
  mollusc: [ALLERGEN_IDS.SHELLFISH],
  molluscs: [ALLERGEN_IDS.SHELLFISH],
  tom: [ALLERGEN_IDS.SHELLFISH],
  cua: [ALLERGEN_IDS.SHELLFISH],
  ghe: [ALLERGEN_IDS.SHELLFISH],
  so: [ALLERGEN_IDS.SHELLFISH],
  oc: [ALLERGEN_IDS.SHELLFISH],
  hau: [ALLERGEN_IDS.SHELLFISH],
  'giap-xac': [ALLERGEN_IDS.SHELLFISH],
  dairy: [ALLERGEN_IDS.DAIRY],
  milk: [ALLERGEN_IDS.DAIRY],
  lactose: [ALLERGEN_IDS.DAIRY],
  sua: [ALLERGEN_IDS.DAIRY],
  'sua-bo': [ALLERGEN_IDS.DAIRY],
  gluten: [ALLERGEN_IDS.GLUTEN],
  wheat: [ALLERGEN_IDS.GLUTEN],
  'lua-mi': [ALLERGEN_IDS.GLUTEN],
  egg: [ALLERGEN_IDS.EGG],
  eggs: [ALLERGEN_IDS.EGG],
  trung: [ALLERGEN_IDS.EGG],
  peanut: [ALLERGEN_IDS.PEANUT],
  peanuts: [ALLERGEN_IDS.PEANUT],
  'dau-phong': [ALLERGEN_IDS.PEANUT],
  lac: [ALLERGEN_IDS.PEANUT],
  'tree-nut': [ALLERGEN_IDS.TREE_NUT],
  'tree-nuts': [ALLERGEN_IDS.TREE_NUT],
  nuts: [ALLERGEN_IDS.TREE_NUT],
  'hat-cay': [ALLERGEN_IDS.TREE_NUT],
  soy: [ALLERGEN_IDS.SOY],
  soybean: [ALLERGEN_IDS.SOY],
  'dau-nanh': [ALLERGEN_IDS.SOY],
  sesame: [ALLERGEN_IDS.SESAME],
  me: [ALLERGEN_IDS.SESAME],
  vung: [ALLERGEN_IDS.SESAME],
})
const NO_ALLERGEN_ALIASES = new Set(['', 'none', 'no-allergy', 'no-allergies', 'khong', 'khong-co', 'khong-di-ung'])

const MEAL_CATEGORIES = new Set(['breakfast', 'lunch', 'dinner', 'snack'])
const ORDER_STATUSES = new Set([
  'pending_confirmation',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'cancelled',
])
const ORDER_TRANSITIONS = Object.freeze({
  pending_confirmation: new Set(['confirmed', 'cancelled']),
  confirmed: new Set(['preparing', 'cancelled']),
  preparing: new Set(['ready', 'cancelled']),
  ready: new Set(['out_for_delivery', 'cancelled']),
  out_for_delivery: new Set(['delivered']),
  delivered: new Set(),
  cancelled: new Set(),
})

const ORDER_CANCELLATION_POLICY = Object.freeze({
  pending_confirmation: Object.freeze({ customer: true, admin: true, refundMode: 'full', kitchenWasteReview: false }),
  confirmed: Object.freeze({ customer: true, admin: true, refundMode: 'full', kitchenWasteReview: false }),
  preparing: Object.freeze({ customer: false, admin: true, refundMode: 'manual_review', kitchenWasteReview: true }),
  ready: Object.freeze({ customer: false, admin: true, refundMode: 'manual_review', kitchenWasteReview: true }),
  out_for_delivery: Object.freeze({ customer: false, admin: false, refundMode: 'manual_review', kitchenWasteReview: true }),
  delivered: Object.freeze({ customer: false, admin: false, refundMode: 'none', kitchenWasteReview: false }),
  cancelled: Object.freeze({ customer: false, admin: false, refundMode: 'none', kitchenWasteReview: false }),
})

const REFUND_JOB_STATUSES = Object.freeze({
  BLOCKED_PROVIDER: 'blocked_provider_not_configured',
  MANUAL_REVIEW: 'manual_review_required',
})

const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  enabled: false,
  acceptingOrders: false,
  asapEnabled: false,
  cityCode: CITY_CODE,
  cityName: CITY_NAME,
  currency: CURRENCY,
  paymentMethods: [PAYMENT_METHOD],
  minOrderAmount: 80000,
  defaultDeliveryFee: 25000,
  freeDeliveryThreshold: 350000,
  sameDayCutoff: '09:00',
  minimumLeadDays: 0,
  maxAdvanceDays: 14,
  cancellationCutoffHours: 4,
  maxItemQuantity: 20,
  maxOrderQuantity: 40,
  supportPhone: '',
  store: {
    label: 'Aura Eat Clean',
    addressLine: '',
    placeId: '',
    latitude: null,
    longitude: null,
  },
  distancePricing: {
    enabled: false,
    provider: 'google-routes',
    maxDistanceMeters: 10000,
    distanceRoundingMeters: 100,
    feeRoundingVnd: 1000,
    feeRuleVersion: 'danang-v1',
    serviceAreaPolygon: [],
    tiers: [
      { upToMeters: 2000, baseFee: 15000, perKm: 0 },
      { upToMeters: 5000, baseFee: 15000, perKm: 5000 },
      { upToMeters: 10000, baseFee: 30000, perKm: 6000 },
    ],
  },
  sla: {
    confirmationMinutes: 3,
    preparationMinutes: 25,
    assignmentMinutes: 5,
    pickupMinutes: 10,
    travelBufferMinutes: 5,
    lateGraceMinutes: 5,
  },
  deliveryZones: [
    { id: 'hai-chau', label: 'Hải Châu', fee: 20000, enabled: true },
    { id: 'thanh-khe', label: 'Thanh Khê', fee: 20000, enabled: true },
    { id: 'son-tra', label: 'Sơn Trà', fee: 25000, enabled: true },
    { id: 'ngu-hanh-son', label: 'Ngũ Hành Sơn', fee: 25000, enabled: true },
    { id: 'cam-le', label: 'Cẩm Lệ', fee: 25000, enabled: true },
    { id: 'lien-chieu', label: 'Liên Chiểu', fee: 30000, enabled: true },
  ],
  deliverySlots: [
    { id: 'morning', label: 'Giao sáng', start: '07:00', end: '09:00', enabled: true },
    { id: 'lunch', label: 'Giao trưa', start: '10:30', end: '12:30', enabled: true },
    { id: 'evening', label: 'Giao tối', start: '16:30', end: '18:30', enabled: true },
  ],
})

const DEFAULT_EAT_CLEAN_MEALS = Object.freeze([
  {
    id: 'uc-ga-ap-chao-tieu-chanh',
    name: 'Ức gà áp chảo tiêu chanh',
    shortDescription: 'Ức gà mềm, gạo lứt và rau củ theo mùa.',
    description: 'Một phần Eat Clean giàu đạm với ức gà áp chảo, gạo lứt và rau củ hấp.',
    imageUrl: '/images/eat-clean/chicken-pepper.webp',
    category: 'lunch',
    basePrice: 69000,
    calories: 430,
    protein: 42,
    carbs: 38,
    fat: 12,
    fiber: 6,
    servingGrams: 420,
    ingredients: ['Ức gà', 'Gạo lứt', 'Rau củ theo mùa', 'Chanh', 'Tiêu'],
    dietaryTags: ['high-protein', 'balanced'],
    goalTags: ['lose-fat', 'gain-muscle'],
    allergens: [],
    allowedDeliverySlots: ['lunch', 'evening'],
    inventoryTracked: true,
    active: true,
    featured: true,
    sortOrder: 10,
  },
  {
    id: 'ca-basa-nuong-sa-nghe',
    name: 'Cá basa nướng sả nghệ',
    shortDescription: 'Cá basa nướng thơm, khoai lang và rau xanh.',
    description: 'Cá basa ướp sả nghệ nướng, dùng cùng khoai lang và rau xanh theo mùa.',
    imageUrl: '/images/eat-clean/salmon-vegetables.webp',
    category: 'lunch',
    basePrice: 72000,
    calories: 445,
    protein: 35,
    carbs: 42,
    fat: 15,
    fiber: 7,
    servingGrams: 430,
    ingredients: ['Cá basa', 'Khoai lang', 'Rau xanh', 'Sả', 'Nghệ'],
    dietaryTags: ['balanced'],
    goalTags: ['lose-fat', 'health'],
    allergens: ['fish'],
    allowedDeliverySlots: ['lunch', 'evening'],
    inventoryTracked: true,
    active: true,
    featured: true,
    sortOrder: 20,
  },
  {
    id: 'bo-ap-chao-gao-lut',
    name: 'Bò áp chảo gạo lứt',
    shortDescription: 'Thăn bò áp chảo, gạo lứt và bông cải.',
    description: 'Thăn bò áp chảo vừa chín tới, kết hợp gạo lứt và bông cải giàu chất xơ.',
    imageUrl: '/images/eat-clean/beef-egg-salad.webp',
    category: 'dinner',
    basePrice: 79000,
    calories: 510,
    protein: 39,
    carbs: 48,
    fat: 18,
    fiber: 7,
    servingGrams: 440,
    ingredients: ['Thăn bò', 'Gạo lứt', 'Bông cải', 'Ớt chuông'],
    dietaryTags: ['high-protein', 'balanced'],
    goalTags: ['gain-muscle', 'maintain'],
    allergens: [],
    allowedDeliverySlots: ['lunch', 'evening'],
    inventoryTracked: true,
    active: true,
    featured: false,
    sortOrder: 30,
  },
  {
    id: 'tom-xao-rau-cu-gao-lut',
    name: 'Tôm xào rau củ gạo lứt',
    shortDescription: 'Tôm, rau củ giòn và gạo lứt vừa đủ năng lượng.',
    description: 'Tôm xào nhanh cùng rau củ ít dầu, phục vụ với gạo lứt.',
    imageUrl: '/images/eat-clean/hero-bowl.webp',
    category: 'dinner',
    basePrice: 76000,
    calories: 420,
    protein: 32,
    carbs: 45,
    fat: 12,
    fiber: 6,
    servingGrams: 410,
    ingredients: ['Tôm', 'Gạo lứt', 'Ớt chuông', 'Bông cải', 'Cà rốt'],
    dietaryTags: ['balanced'],
    goalTags: ['lose-fat', 'maintain'],
    allergens: ['shellfish'],
    allowedDeliverySlots: ['lunch', 'evening'],
    inventoryTracked: true,
    active: true,
    featured: false,
    sortOrder: 40,
  },
  {
    id: 'overnight-oats-xoai-hat-chia',
    name: 'Overnight oats xoài hạt chia',
    shortDescription: 'Yến mạch lạnh, xoài và hạt chia cho bữa sáng nhanh.',
    description: 'Yến mạch ngâm qua đêm cùng sữa chua, xoài chín và hạt chia.',
    imageUrl: '/images/eat-clean/hero-bowl.webp',
    category: 'breakfast',
    basePrice: 49000,
    calories: 360,
    protein: 16,
    carbs: 52,
    fat: 10,
    fiber: 9,
    servingGrams: 330,
    ingredients: ['Yến mạch', 'Sữa chua', 'Xoài', 'Hạt chia'],
    dietaryTags: ['vegetarian', 'high-fiber'],
    goalTags: ['lose-fat', 'health'],
    allergens: ['dairy', 'gluten'],
    allowedDeliverySlots: ['morning', 'lunch'],
    inventoryTracked: true,
    active: true,
    featured: true,
    sortOrder: 50,
  },
  {
    id: 'salad-ga-bo',
    name: 'Salad gà bơ',
    shortDescription: 'Ức gà, bơ, xà lách và sốt chanh nhẹ.',
    description: 'Salad rau xanh với ức gà, bơ và sốt chanh ít đường.',
    imageUrl: '/images/eat-clean/beef-egg-salad.webp',
    category: 'lunch',
    basePrice: 69000,
    calories: 390,
    protein: 36,
    carbs: 20,
    fat: 19,
    fiber: 9,
    servingGrams: 380,
    ingredients: ['Ức gà', 'Bơ', 'Xà lách', 'Cà chua', 'Chanh'],
    dietaryTags: ['low-carb', 'high-protein'],
    goalTags: ['lose-fat'],
    allergens: [],
    allowedDeliverySlots: ['lunch', 'evening'],
    inventoryTracked: true,
    active: true,
    featured: false,
    sortOrder: 60,
  },
])

function requireUser(request) {
  const userId = request.auth?.uid
  if (!userId) throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập để sử dụng Eat Clean.')
  return userId
}

function requireFactoryDependency(value, label) {
  if (!value) throw new TypeError(`createEatCleanFunctions requires ${label}`)
  return value
}

function boundedString(value, label, maximum, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return ''
    throw new HttpsError('invalid-argument', `${label} không được để trống.`)
  }
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  const result = value.trim()
  if ((required && !result) || result.length > maximum) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function optionalUrl(value, label = 'Liên kết') {
  const raw = boundedString(value, label, 1200, { required: false })
  if (!raw) return ''
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new HttpsError('invalid-argument', `${label} phải dùng HTTP hoặc HTTPS.`)
  }
  return url.toString()
}

function optionalImageUrl(value) {
  const raw = boundedString(value, 'Ảnh món ăn', 1200, { required: false })
  if (!raw) return ''
  if (/^\/images\/[a-zA-Z0-9/_-]+\.(?:webp|png|jpe?g|avif)$/.test(raw)) return raw
  return optionalUrl(raw, 'Ảnh món ăn')
}

function finiteInteger(value, label, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return value
}

function finiteNumber(value, label, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return Math.round(value * 10) / 10
}

function optionalNumber(value, label, minimum, maximum, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback
  return finiteNumber(value, label, minimum, maximum)
}

function cleanStringList(value, label, maximumItems = 20, maximumLength = 80) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return [...new Set(value.map((item) => boundedString(item, label, maximumLength)))].slice(0, maximumItems)
}

function normalizedKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function canonicalAllergenIds(values) {
  const source = Array.isArray(values) ? values : [values]
  const result = new Set()
  source.forEach((value) => {
    const key = normalizedKey(value)
    const sizeBefore = result.size
    if (NO_ALLERGEN_ALIASES.has(key)) return
    if (CANONICAL_ALLERGEN_IDS.has(key)) {
      result.add(key)
      return
    }
    const exact = Object.prototype.hasOwnProperty.call(ALLERGEN_ALIASES, key)
      ? ALLERGEN_ALIASES[key]
      : null
    if (exact) {
      exact.forEach((item) => result.add(item))
      return
    }

    const tokens = new Set(key.split('-').filter(Boolean))
    const add = (id) => result.add(id)
    if ((tokens.has('hai') && tokens.has('san')) || tokens.has('seafood')) {
      add(ALLERGEN_IDS.FISH)
      add(ALLERGEN_IDS.SHELLFISH)
    }
    if (tokens.has('fish') || tokens.has('ca')) add(ALLERGEN_IDS.FISH)
    if (['shellfish', 'crustacean', 'crustaceans', 'mollusc', 'molluscs', 'tom', 'cua', 'ghe', 'so', 'oc', 'hau']
      .some((item) => tokens.has(item)) || (tokens.has('giap') && tokens.has('xac'))) add(ALLERGEN_IDS.SHELLFISH)
    if (['dairy', 'milk', 'lactose', 'sua'].some((item) => tokens.has(item))) add(ALLERGEN_IDS.DAIRY)
    if (tokens.has('gluten') || tokens.has('wheat') || (tokens.has('lua') && tokens.has('mi'))) add(ALLERGEN_IDS.GLUTEN)
    if (tokens.has('egg') || tokens.has('eggs') || tokens.has('trung')) add(ALLERGEN_IDS.EGG)
    if (tokens.has('peanut') || tokens.has('peanuts') || tokens.has('lac')
      || (tokens.has('dau') && tokens.has('phong'))) add(ALLERGEN_IDS.PEANUT)
    if (tokens.has('nuts') || (tokens.has('tree') && tokens.has('nut'))
      || (tokens.has('hat') && tokens.has('cay'))) add(ALLERGEN_IDS.TREE_NUT)
    if (tokens.has('soy') || tokens.has('soybean') || (tokens.has('dau') && tokens.has('nanh'))) add(ALLERGEN_IDS.SOY)
    if (tokens.has('sesame') || tokens.has('me') || tokens.has('vung')) add(ALLERGEN_IDS.SESAME)

    // Preserve an unknown normalized allergen instead of silently weakening
    // safety; exact unknown keys can still be matched across profile/catalog.
    if (result.size === sizeBefore && key) result.add(key)
  })
  return [...result]
}

function hasAllergenConflict(mealAllergens, userAllergies) {
  const blocked = new Set(canonicalAllergenIds(userAllergies))
  return canonicalAllergenIds(mealAllergens).some((item) => blocked.has(item))
}

function documentId(value, label) {
  const result = boundedString(value, label, 160)
  if (result.includes('/') || result === '.' || result === '..') {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function dateKey(value, label = 'Ngày giao') {
  const result = boundedString(value, label, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) {
    throw new HttpsError('invalid-argument', `${label} phải theo định dạng YYYY-MM-DD.`)
  }
  const [year, month, day] = result.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function clock(value, label) {
  const result = boundedString(value, label, 5)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function todayInVietnam(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function vietnamClock(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
}

function addUtcDays(date, amount) {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + amount))
  return next.toISOString().slice(0, 10)
}

function validateServiceDate(serviceDate, config, now = new Date()) {
  const today = todayInVietnam(now)
  const earliest = addUtcDays(today, config.minimumLeadDays)
  const latest = addUtcDays(today, config.maxAdvanceDays)
  if (serviceDate < earliest || serviceDate > latest) {
    throw new HttpsError('failed-precondition', `Ngày giao phải từ ${earliest} đến ${latest}.`)
  }
  if (serviceDate === today && vietnamClock(now) >= config.sameDayCutoff) {
    throw new HttpsError('failed-precondition', `Đã qua giờ chốt đơn ${config.sameDayCutoff} cho hôm nay.`)
  }
}

function normalizeZone(value, index) {
  if (!value || typeof value !== 'object') throw new HttpsError('invalid-argument', 'Khu vực giao hàng không hợp lệ.')
  const label = boundedString(value.label, `Tên khu vực ${index + 1}`, 80)
  const id = normalizedKey(value.id || label)
  if (!id) throw new HttpsError('invalid-argument', 'Mã khu vực giao hàng không hợp lệ.')
  return {
    id,
    label,
    fee: finiteInteger(value.fee, `Phí giao ${label}`, 0, 1000000),
    enabled: value.enabled !== false,
  }
}

function normalizeSlot(value, index) {
  if (!value || typeof value !== 'object') throw new HttpsError('invalid-argument', 'Khung giờ giao hàng không hợp lệ.')
  const label = boundedString(value.label, `Tên khung giờ ${index + 1}`, 80)
  const id = normalizedKey(value.id || label)
  if (!id) throw new HttpsError('invalid-argument', 'Mã khung giờ không hợp lệ.')
  const start = clock(value.start, `Giờ bắt đầu ${label}`)
  const end = clock(value.end, `Giờ kết thúc ${label}`)
  if (end <= start) throw new HttpsError('invalid-argument', `Khung giờ ${label} không hợp lệ.`)
  return { id, label, start, end, enabled: value.enabled !== false }
}

function nullableCoordinate(value, label, minimum, maximum) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return Math.round(value * 1000000) / 1000000
}

function normalizeLatLng(value, label = 'Tọa độ', { required = true } = {}) {
  const latitude = nullableCoordinate(value?.latitude ?? value?.lat, `${label} vĩ độ`, -90, 90)
  const longitude = nullableCoordinate(value?.longitude ?? value?.lng, `${label} kinh độ`, -180, 180)
  if ((latitude === null) !== (longitude === null) || (required && latitude === null)) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return { latitude, longitude }
}

function normalizeFeeTier(value, index, previousLimit = 0) {
  if (!value || typeof value !== 'object') {
    throw new HttpsError('invalid-argument', `Bậc phí giao hàng ${index + 1} không hợp lệ.`)
  }
  const upToMeters = finiteInteger(value.upToMeters, `Giới hạn bậc phí ${index + 1}`, previousLimit + 1, 100000)
  return {
    upToMeters,
    baseFee: finiteInteger(value.baseFee, `Phí nền bậc ${index + 1}`, 0, 1000000),
    perKm: finiteInteger(value.perKm, `Phí mỗi km bậc ${index + 1}`, 0, 1000000),
  }
}

function normalizeDistancePricing(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const tierSource = source.tiers ?? DEFAULT_CONFIG.distancePricing.tiers
  if (!Array.isArray(tierSource) || tierSource.length < 1 || tierSource.length > 10) {
    throw new HttpsError('invalid-argument', 'Bảng phí theo khoảng cách không hợp lệ.')
  }
  const tiers = []
  tierSource.forEach((tier, index) => tiers.push(normalizeFeeTier(tier, index, tiers[index - 1]?.upToMeters || 0)))
  const maxDistanceMeters = finiteInteger(
    source.maxDistanceMeters ?? DEFAULT_CONFIG.distancePricing.maxDistanceMeters,
    'Khoảng cách giao tối đa',
    500,
    100000,
  )
  if (tiers[tiers.length - 1].upToMeters !== maxDistanceMeters) {
    throw new HttpsError('invalid-argument', 'Bậc phí cuối phải kết thúc đúng tại khoảng cách giao tối đa.')
  }
  const polygonSource = source.serviceAreaPolygon ?? []
  if (!Array.isArray(polygonSource) || polygonSource.length > 100) {
    throw new HttpsError('invalid-argument', 'Vùng giao hàng không hợp lệ.')
  }
  const serviceAreaPolygon = polygonSource.map((point, index) => normalizeLatLng(point, `Điểm vùng giao ${index + 1}`))
  if (serviceAreaPolygon.length > 0 && serviceAreaPolygon.length < 3) {
    throw new HttpsError('invalid-argument', 'Vùng giao hàng cần ít nhất 3 điểm.')
  }
  return {
    enabled: source.enabled === true,
    provider: 'google-routes',
    maxDistanceMeters,
    distanceRoundingMeters: finiteInteger(source.distanceRoundingMeters ?? DEFAULT_CONFIG.distancePricing.distanceRoundingMeters, 'Bước làm tròn khoảng cách', 10, 1000),
    feeRoundingVnd: finiteInteger(source.feeRoundingVnd ?? DEFAULT_CONFIG.distancePricing.feeRoundingVnd, 'Bước làm tròn phí', 100, 10000),
    feeRuleVersion: boundedString(source.feeRuleVersion ?? DEFAULT_CONFIG.distancePricing.feeRuleVersion, 'Phiên bản bảng phí', 60),
    serviceAreaPolygon,
    tiers,
  }
}

function normalizeStoreConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const coordinates = normalizeLatLng(source, 'Tọa độ bếp', { required: false })
  return {
    label: boundedString(source.label ?? DEFAULT_CONFIG.store.label, 'Tên bếp', 100),
    addressLine: boundedString(source.addressLine ?? '', 'Địa chỉ bếp', 240, { required: false }),
    placeId: boundedString(source.placeId ?? '', 'Google Place ID của bếp', 240, { required: false }),
    ...coordinates,
  }
}

function normalizeSlaConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const fallback = DEFAULT_CONFIG.sla
  return {
    confirmationMinutes: finiteInteger(source.confirmationMinutes ?? fallback.confirmationMinutes, 'SLA xác nhận', 1, 120),
    preparationMinutes: finiteInteger(source.preparationMinutes ?? fallback.preparationMinutes, 'SLA chuẩn bị', 1, 240),
    assignmentMinutes: finiteInteger(source.assignmentMinutes ?? fallback.assignmentMinutes, 'SLA gán shipper', 1, 120),
    pickupMinutes: finiteInteger(source.pickupMinutes ?? fallback.pickupMinutes, 'SLA lấy món', 1, 120),
    travelBufferMinutes: finiteInteger(source.travelBufferMinutes ?? fallback.travelBufferMinutes, 'Đệm giao hàng', 0, 120),
    lateGraceMinutes: finiteInteger(source.lateGraceMinutes ?? fallback.lateGraceMinutes, 'Ngưỡng báo trễ', 0, 120),
  }
}

function normalizeEatCleanConfig(value = {}) {
  const zonesSource = value.deliveryZones ?? DEFAULT_CONFIG.deliveryZones
  const slotsSource = value.deliverySlots ?? DEFAULT_CONFIG.deliverySlots
  if (!Array.isArray(zonesSource) || !zonesSource.length || zonesSource.length > 30) {
    throw new HttpsError('invalid-argument', 'Cần cấu hình ít nhất một khu vực giao hàng.')
  }
  if (!Array.isArray(slotsSource) || !slotsSource.length || slotsSource.length > 12) {
    throw new HttpsError('invalid-argument', 'Cần cấu hình ít nhất một khung giờ giao hàng.')
  }
  const deliveryZones = zonesSource.map(normalizeZone)
  const deliverySlots = slotsSource.map(normalizeSlot)
  if (new Set(deliveryZones.map((item) => item.id)).size !== deliveryZones.length) {
    throw new HttpsError('invalid-argument', 'Mã khu vực giao hàng bị trùng.')
  }
  if (new Set(deliverySlots.map((item) => item.id)).size !== deliverySlots.length) {
    throw new HttpsError('invalid-argument', 'Mã khung giờ giao hàng bị trùng.')
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_CONFIG.enabled,
    acceptingOrders: typeof value.acceptingOrders === 'boolean' ? value.acceptingOrders : DEFAULT_CONFIG.acceptingOrders,
    asapEnabled: typeof value.asapEnabled === 'boolean' ? value.asapEnabled : DEFAULT_CONFIG.asapEnabled,
    cityCode: CITY_CODE,
    cityName: CITY_NAME,
    currency: CURRENCY,
    paymentMethods: [PAYMENT_METHOD],
    minOrderAmount: finiteInteger(value.minOrderAmount ?? DEFAULT_CONFIG.minOrderAmount, 'Đơn hàng tối thiểu', 0, 10000000),
    defaultDeliveryFee: finiteInteger(value.defaultDeliveryFee ?? DEFAULT_CONFIG.defaultDeliveryFee, 'Phí giao mặc định', 0, 1000000),
    freeDeliveryThreshold: finiteInteger(value.freeDeliveryThreshold ?? DEFAULT_CONFIG.freeDeliveryThreshold, 'Mốc miễn phí giao', 0, 50000000),
    sameDayCutoff: clock(value.sameDayCutoff ?? DEFAULT_CONFIG.sameDayCutoff, 'Giờ chốt đơn'),
    minimumLeadDays: finiteInteger(value.minimumLeadDays ?? DEFAULT_CONFIG.minimumLeadDays, 'Số ngày chuẩn bị tối thiểu', 0, 7),
    maxAdvanceDays: finiteInteger(value.maxAdvanceDays ?? DEFAULT_CONFIG.maxAdvanceDays, 'Số ngày đặt trước tối đa', 1, 60),
    cancellationCutoffHours: finiteInteger(value.cancellationCutoffHours ?? DEFAULT_CONFIG.cancellationCutoffHours, 'Số giờ hủy trước giao', 0, 72),
    maxItemQuantity: finiteInteger(value.maxItemQuantity ?? DEFAULT_CONFIG.maxItemQuantity, 'Số lượng tối đa mỗi món', 1, 100),
    maxOrderQuantity: finiteInteger(value.maxOrderQuantity ?? DEFAULT_CONFIG.maxOrderQuantity, 'Tổng số món tối đa', 1, 200),
    supportPhone: boundedString(value.supportPhone ?? DEFAULT_CONFIG.supportPhone, 'Số hỗ trợ', 30, { required: false }),
    store: normalizeStoreConfig(value.store ?? DEFAULT_CONFIG.store),
    distancePricing: normalizeDistancePricing(value.distancePricing ?? DEFAULT_CONFIG.distancePricing),
    sla: normalizeSlaConfig(value.sla ?? DEFAULT_CONFIG.sla),
    deliveryZones,
    deliverySlots,
  }
}

function normalizeStoredConfig(value) {
  try {
    return normalizeEatCleanConfig(value || {})
  } catch {
    return normalizeEatCleanConfig({})
  }
}

function normalizeMealInput(value, fallbackId = '') {
  if (!value || typeof value !== 'object') throw new HttpsError('invalid-argument', 'Thông tin món ăn không hợp lệ.')
  const name = boundedString(value.name, 'Tên món', 120)
  const id = value.id || fallbackId
    ? documentId(value.id || fallbackId, 'Mã món')
    : normalizedKey(name)
  const category = MEAL_CATEGORIES.has(value.category) ? value.category : 'lunch'
  const basePrice = finiteInteger(value.basePrice, 'Giá bán', 0, 10000000)
  const compareAtPrice = value.compareAtPrice === undefined || value.compareAtPrice === null || value.compareAtPrice === ''
    ? null
    : finiteInteger(value.compareAtPrice, 'Giá so sánh', basePrice, 10000000)
  const allowedDeliverySlots = cleanStringList(value.allowedDeliverySlots, 'Khung giờ áp dụng', 12, 60)
    .map(normalizedKey)
    .filter(Boolean)

  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    slug: normalizedKey(value.slug || name),
    name,
    shortDescription: boundedString(value.shortDescription, 'Mô tả ngắn', 240, { required: false }),
    description: boundedString(value.description, 'Mô tả', 2000, { required: false }),
    imageUrl: optionalImageUrl(value.imageUrl),
    category,
    basePrice,
    compareAtPrice,
    calories: finiteNumber(value.calories, 'Năng lượng', 0, 5000),
    protein: finiteNumber(value.protein, 'Chất đạm', 0, 500),
    carbs: finiteNumber(value.carbs, 'Tinh bột', 0, 1000),
    fat: finiteNumber(value.fat, 'Chất béo', 0, 500),
    fiber: optionalNumber(value.fiber, 'Chất xơ', 0, 200),
    servingGrams: optionalNumber(value.servingGrams, 'Khối lượng khẩu phần', 0, 5000),
    preparationMinutes: optionalNumber(value.preparationMinutes, 'Thời gian chuẩn bị', 0, 240, DEFAULT_CONFIG.sla.preparationMinutes),
    ingredients: cleanStringList(value.ingredients, 'Nguyên liệu', 60, 120),
    dietaryTags: cleanStringList(value.dietaryTags, 'Nhãn chế độ ăn', 20, 60).map(normalizedKey).filter(Boolean),
    goalTags: cleanStringList(value.goalTags, 'Nhãn mục tiêu', 12, 60).map(normalizedKey).filter(Boolean),
    allergens: canonicalAllergenIds(cleanStringList(value.allergens, 'Chất gây dị ứng', 20, 80)),
    allowedDeliverySlots,
    inventoryTracked: value.inventoryTracked !== false,
    active: value.active !== false,
    featured: value.featured === true,
    sortOrder: finiteInteger(value.sortOrder ?? 0, 'Thứ tự hiển thị', -10000, 10000),
  }
}

function normalizeLineItems(value, config) {
  if (!Array.isArray(value) || !value.length || value.length > 20) {
    throw new HttpsError('invalid-argument', 'Giỏ hàng phải có từ 1 đến 20 món.')
  }
  const quantities = new Map()
  value.forEach((item) => {
    if (!item || typeof item !== 'object') throw new HttpsError('invalid-argument', 'Món trong giỏ không hợp lệ.')
    const mealId = documentId(item.mealId, 'Mã món')
    const quantity = finiteInteger(item.quantity, 'Số lượng món', 1, config.maxItemQuantity)
    quantities.set(mealId, (quantities.get(mealId) || 0) + quantity)
  })
  const items = [...quantities].map(([mealId, quantity]) => {
    if (quantity > config.maxItemQuantity) {
      throw new HttpsError('invalid-argument', `Số lượng món ${mealId} vượt giới hạn.`)
    }
    return { mealId, quantity }
  })
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)
  if (totalQuantity > config.maxOrderQuantity) {
    throw new HttpsError('invalid-argument', 'Tổng số món vượt giới hạn của một đơn hàng.')
  }
  return items
}

function normalizeCustomer(value) {
  if (!value || typeof value !== 'object') throw new HttpsError('invalid-argument', 'Thông tin người nhận không hợp lệ.')
  const phone = boundedString(value.phone, 'Số điện thoại', 20).replace(/[\s.-]/g, '')
  if (!/^(\+?84|0)\d{9,10}$/.test(phone)) {
    throw new HttpsError('invalid-argument', 'Số điện thoại Việt Nam không hợp lệ.')
  }
  const coordinates = normalizeLatLng(value, 'Tọa độ giao hàng', { required: false })
  return {
    name: boundedString(value.name ?? value.fullName, 'Tên người nhận', 100),
    phone,
    addressId: value.addressId ? documentId(value.addressId, 'Mã địa chỉ') : '',
    addressLabel: boundedString(value.addressLabel ?? value.label, 'Tên gợi nhớ địa chỉ', 40, { required: false }),
    addressLine: boundedString(value.addressLine, 'Địa chỉ giao hàng', 240),
    ward: boundedString(value.ward, 'Phường/xã', 100, { required: false }),
    districtId: normalizedKey(boundedString(value.districtId || value.district, 'Khu vực giao hàng', 100)),
    district: boundedString(value.district ?? value.districtId, 'Quận/huyện', 100, { required: false }),
    placeId: boundedString(value.placeId, 'Google Place ID', 240, { required: false }),
    deliveryNote: boundedString(value.deliveryNote ?? value.entranceNote, 'Chỉ dẫn giao hàng', 300, { required: false }),
    ...coordinates,
    cityCode: CITY_CODE,
    cityName: CITY_NAME,
  }
}

function normalizeOrderRequest(value, config) {
  if (!value || typeof value !== 'object') throw new HttpsError('invalid-argument', 'Đơn hàng không hợp lệ.')
  const paymentMethod = String(value.paymentMethod || PAYMENT_METHOD).toUpperCase()
  if (paymentMethod !== PAYMENT_METHOD) {
    throw new HttpsError('failed-precondition', 'Eat Clean hiện chỉ hỗ trợ thanh toán COD.')
  }
  const deliveryMode = value.deliveryMode === 'asap' || value.deliverySlotId === 'asap' ? 'asap' : 'scheduled'
  if (deliveryMode === 'asap' && !config.asapEnabled) {
    throw new HttpsError('failed-precondition', 'Bếp hiện chưa nhận đơn giao sớm nhất.')
  }
  const serviceDate = deliveryMode === 'asap' ? todayInVietnam() : dateKey(value.serviceDate)
  if (deliveryMode === 'scheduled') validateServiceDate(serviceDate, config)
  const deliverySlotId = deliveryMode === 'asap'
    ? 'asap'
    : normalizedKey(boundedString(value.deliverySlotId, 'Khung giờ giao', 60))
  const deliverySlot = deliveryMode === 'asap'
    ? { id: 'asap', label: 'Giao sớm nhất', start: '', end: '', enabled: true }
    : config.deliverySlots.find((item) => item.id === deliverySlotId && item.enabled)
  if (!deliverySlot) throw new HttpsError('failed-precondition', 'Khung giờ giao không còn phục vụ.')
  const customer = normalizeCustomer({ ...(value.deliveryAddress || {}), ...(value.customer || {}) })
  const deliveryZone = config.deliveryZones.find((item) => item.id === customer.districtId && item.enabled)
  if (!config.distancePricing.enabled && !deliveryZone) {
    throw new HttpsError('failed-precondition', 'Địa chỉ nằm ngoài khu vực giao hàng tại Đà Nẵng.')
  }
  if (config.distancePricing.enabled && (customer.latitude === null || customer.longitude === null)) {
    throw new HttpsError('failed-precondition', 'Vui lòng xác nhận vị trí giao hàng trên bản đồ trước khi báo giá.')
  }
  return {
    items: normalizeLineItems(value.items, config),
    deliveryMode,
    serviceDate,
    deliverySlotId,
    deliverySlot,
    deliveryZone: deliveryZone || null,
    customer,
    paymentMethod,
    note: boundedString(value.note, 'Ghi chú', 500, { required: false }),
  }
}

function inventoryDocumentId(serviceDate, mealId) {
  return `${dateKey(serviceDate)}__${documentId(mealId, 'Mã món')}`
}

function availableInventory(meal, inventory) {
  if (meal.inventoryTracked === false) return Number.MAX_SAFE_INTEGER
  if (!inventory || inventory.active === false) return 0
  const capacity = Number.isInteger(inventory.capacity) ? inventory.capacity : 0
  const reserved = Number.isInteger(inventory.reserved) ? inventory.reserved : 0
  const sold = Number.isInteger(inventory.sold) ? inventory.sold : 0
  return Math.max(0, capacity - reserved - sold)
}

function normalizeSavedAddress(value, fallbackId = '') {
  if (!value || typeof value !== 'object') throw new HttpsError('invalid-argument', 'Địa chỉ không hợp lệ.')
  const customer = normalizeCustomer({
    ...value,
    name: value.fullName ?? value.name,
    districtId: value.districtId ?? value.district,
  })
  const coordinates = normalizeLatLng(value, 'Tọa độ địa chỉ')
  const kind = ['home', 'work', 'other'].includes(value.kind) ? value.kind : 'other'
  return {
    schemaVersion: SCHEMA_VERSION,
    id: fallbackId ? documentId(fallbackId, 'Mã địa chỉ') : '',
    kind,
    label: boundedString(value.label, 'Tên gợi nhớ địa chỉ', 40),
    fullName: customer.name,
    phone: customer.phone,
    addressLine: customer.addressLine,
    ward: customer.ward,
    district: customer.district,
    districtId: customer.districtId,
    cityCode: CITY_CODE,
    cityName: CITY_NAME,
    placeId: boundedString(value.placeId, 'Google Place ID', 240, { required: false }),
    deliveryNote: boundedString(value.deliveryNote, 'Ghi chú giao hàng', 300, { required: false }),
    ...coordinates,
    isDefault: value.isDefault === true,
  }
}

function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return true
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    const crosses = ((currentPoint.latitude > point.latitude) !== (previousPoint.latitude > point.latitude))
      && (point.longitude < ((previousPoint.longitude - currentPoint.longitude)
        * (point.latitude - currentPoint.latitude)) / (previousPoint.latitude - currentPoint.latitude)
        + currentPoint.longitude)
    if (crosses) inside = !inside
  }
  return inside
}

function distanceBetweenCoordinates(left, right) {
  const radians = (degrees) => degrees * Math.PI / 180
  const earthRadiusMeters = 6371000
  const latitudeDelta = radians(right.latitude - left.latitude)
  const longitudeDelta = radians(right.longitude - left.longitude)
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(longitudeDelta / 2) ** 2
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function roundedDistance(distanceMeters, roundingMeters = 100) {
  return Math.ceil(distanceMeters / roundingMeters) * roundingMeters
}

function calculateDistanceDeliveryFee(distanceMeters, pricing) {
  const roundedDistanceMeters = roundedDistance(distanceMeters, pricing.distanceRoundingMeters)
  if (roundedDistanceMeters > pricing.maxDistanceMeters) {
    throw new HttpsError('out-of-range', `Địa chỉ cách bếp quá ${Math.round(pricing.maxDistanceMeters / 1000)} km.`)
  }
  const tier = pricing.tiers.find((item) => roundedDistanceMeters <= item.upToMeters)
  if (!tier) throw new HttpsError('failed-precondition', 'Không tìm thấy bậc phí phù hợp cho địa chỉ này.')
  const tierIndex = pricing.tiers.indexOf(tier)
  const previousLimit = tierIndex > 0 ? pricing.tiers[tierIndex - 1].upToMeters : 0
  const rawFee = tier.baseFee + Math.max(0, roundedDistanceMeters - previousLimit) / 1000 * tier.perKm
  const deliveryFee = Math.ceil(rawFee / pricing.feeRoundingVnd) * pricing.feeRoundingVnd
  return { roundedDistanceMeters, baseDeliveryFee: deliveryFee, feeRuleVersion: pricing.feeRuleVersion }
}

function durationSeconds(value) {
  const match = String(value || '').match(/^([0-9]+(?:\.[0-9]+)?)s$/)
  return match ? Math.ceil(Number(match[1])) : 0
}

function secretValue(secretParameter, environmentNames) {
  try {
    const value = secretParameter.value()
    if (value) return value
  } catch {
    // Local tests may use the environment fallback below. Production features
    // remain fail-closed when the bound secret is unavailable.
  }
  for (const name of environmentNames) {
    if (process.env[name]) return process.env[name]
  }
  return ''
}

function mapsApiKey() {
  return secretValue(googleMapsApiKeySecret, ['GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_SERVER_API_KEY'])
}

function otpSecretValue() {
  return secretValue(deliveryOtpSecret, ['DELIVERY_OTP_SECRET'])
}

function deliveryRuntimeReadiness(config, realtimeDb) {
  const mapsKeyAvailable = mapsApiKey().length > 0
  const storeCoordinateReady = Number.isFinite(config?.store?.latitude) && Number.isFinite(config?.store?.longitude)
  const otpKeyAvailable = otpSecretValue().length >= 32
  return {
    secretBindingEnabled: true,
    mapsKeyAvailable,
    storeCoordinateReady,
    distancePricingReady: mapsKeyAvailable && storeCoordinateReady,
    otpKeyAvailable,
    realtimeDatabaseReady: Boolean(realtimeDb),
    dispatchReady: otpKeyAvailable && Boolean(realtimeDb),
  }
}

function assertDeliveryConfigCanActivate(config, realtimeDb) {
  const readiness = deliveryRuntimeReadiness(config, realtimeDb)
  if (config.distancePricing.enabled && !readiness.distancePricingReady) {
    throw new HttpsError('failed-precondition', 'Chưa thể bật phí theo km: cần tọa độ bếp và GOOGLE_MAPS_API_KEY hợp lệ.')
  }
  return readiness
}

function googleAddressText(value, maximum = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function googleAddressComponent(components, acceptedTypes) {
  if (!Array.isArray(components)) return ''
  const accepted = new Set(acceptedTypes)
  const match = components.find((component) => Array.isArray(component?.types)
    && component.types.some((type) => accepted.has(type)))
  return googleAddressText(match?.longText ?? match?.long_name ?? match?.shortText ?? match?.short_name, 100)
}

function isDaNangGoogleAddress(components) {
  if (!Array.isArray(components)) return false
  const cityTypes = new Set(['administrative_area_level_1', 'locality'])
  return components.some((component) => {
    if (!Array.isArray(component?.types) || !component.types.some((type) => cityTypes.has(type))) return false
    const value = normalizedKey(component.longText ?? component.long_name ?? component.shortText ?? component.short_name)
    return value === 'da-nang' || value === 'thanh-pho-da-nang'
  })
}

function canonicalGoogleDestination(value, provider) {
  const location = value?.location || value?.geometry?.location || {}
  const coordinates = normalizeLatLng({
    latitude: location.latitude ?? location.lat,
    longitude: location.longitude ?? location.lng,
  }, 'Tọa độ địa chỉ Google')
  const components = value?.addressComponents || value?.address_components || []
  const formattedAddress = googleAddressText(value?.formattedAddress ?? value?.formatted_address)
  if (!formattedAddress || !isDaNangGoogleAddress(components)) {
    throw new HttpsError('out-of-range', 'Địa chỉ Google không thuộc khu vực Đà Nẵng.')
  }
  return {
    provider,
    placeId: googleAddressText(value?.id ?? value?.place_id, 240),
    formattedAddress,
    ward: googleAddressComponent(components, [
      'administrative_area_level_3',
      'sublocality_level_1',
      'sublocality',
    ]),
    district: googleAddressComponent(components, [
      'administrative_area_level_2',
      'sublocality_level_1',
    ]),
    ...coordinates,
  }
}

function assertSubmittedPinMatches(submitted, canonical, toleranceMeters = DELIVERY_PIN_TOLERANCE_METERS) {
  const submittedCoordinates = normalizeLatLng(submitted, 'Tọa độ khách đã chọn')
  const canonicalCoordinates = normalizeLatLng(canonical, 'Tọa độ Google')
  const differenceMeters = distanceBetweenCoordinates(submittedCoordinates, canonicalCoordinates)
  if (!Number.isFinite(differenceMeters) || differenceMeters > toleranceMeters) {
    throw new HttpsError(
      'failed-precondition',
      'Vị trí ghim không khớp với địa chỉ Google. Vui lòng chọn lại địa chỉ trên bản đồ.',
    )
  }
  return Math.round(differenceMeters)
}

function verifiedCustomerFromDestination(customer, destination, now = new Date()) {
  assertSubmittedPinMatches(customer, destination)
  const canonicalDistrict = destination.district || customer.district
  return {
    ...customer,
    addressLine: destination.formattedAddress,
    ward: destination.ward || customer.ward,
    district: canonicalDistrict,
    districtId: normalizedKey(canonicalDistrict || customer.districtId),
    placeId: destination.placeId || customer.placeId,
    latitude: destination.latitude,
    longitude: destination.longitude,
    addressVerifiedAt: now.toISOString(),
    addressProvider: destination.provider,
  }
}

function createGoogleAddressAdapter({ apiKey, apiKeyProvider = mapsApiKey, fetchImpl = globalThis.fetch } = {}) {
  async function requestJson(url, options, fallbackMessage) {
    const resolvedApiKey = apiKey === undefined ? apiKeyProvider() : apiKey
    if (!resolvedApiKey) {
      throw new HttpsError('failed-precondition', 'Google Address chưa được cấu hình. Admin cần bổ sung GOOGLE_MAPS_API_KEY.')
    }
    if (typeof fetchImpl !== 'function') throw new HttpsError('unavailable', 'Dịch vụ xác minh địa chỉ chưa sẵn sàng.')
    let response
    try {
      const resolvedOptions = typeof options === 'function' ? options(resolvedApiKey) : options
      response = await fetchImpl(url(resolvedApiKey), {
        ...resolvedOptions,
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(8000)
          : undefined,
      })
    } catch {
      throw new HttpsError('unavailable', fallbackMessage)
    }
    if (!response?.ok) throw new HttpsError('unavailable', fallbackMessage)
    return response.json()
  }

  return {
    async resolveDestination(customer) {
      if (customer.placeId) {
        const payload = await requestJson(
          (resolvedApiKey) => `https://places.googleapis.com/v1/places/${encodeURIComponent(customer.placeId)}`,
          (resolvedApiKey) => ({
            method: 'GET',
            headers: {
              'X-Goog-Api-Key': resolvedApiKey,
              'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents',
            },
          }),
          'Không thể xác minh Google Place đã chọn. Vui lòng chọn lại địa chỉ.',
        )
        return canonicalGoogleDestination(payload, 'google-places')
      }

      const addressQuery = [customer.addressLine, customer.ward, customer.district, 'Đà Nẵng', 'Việt Nam']
        .filter(Boolean)
        .join(', ')
      const payload = await requestJson(
        (resolvedApiKey) => `https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({
          address: addressQuery,
          language: 'vi',
          region: 'vn',
          key: resolvedApiKey,
        }).toString()}`,
        { method: 'GET' },
        'Không thể xác minh địa chỉ giao hàng. Vui lòng thử lại.',
      )
      if (payload?.status !== 'OK' || !Array.isArray(payload.results) || !payload.results.length) {
        throw new HttpsError('failed-precondition', 'Không tìm thấy địa chỉ giao hàng rõ ràng trên Google Maps.')
      }
      const candidates = payload.results
        .map((result) => {
          try {
            const destination = canonicalGoogleDestination(result, 'google-geocoding')
            return {
              destination,
              differenceMeters: distanceBetweenCoordinates(customer, destination),
            }
          } catch {
            return null
          }
        })
        .filter(Boolean)
        .sort((left, right) => left.differenceMeters - right.differenceMeters)
      if (!candidates.length) throw new HttpsError('out-of-range', 'Địa chỉ giao hàng không thuộc Đà Nẵng.')
      const nearbyCandidates = candidates.filter((item) => item.differenceMeters <= DELIVERY_PIN_TOLERANCE_METERS)
      if (nearbyCandidates.length > 1
        && distanceBetweenCoordinates(nearbyCandidates[0].destination, nearbyCandidates[1].destination) > 100) {
        throw new HttpsError('failed-precondition', 'Địa chỉ có nhiều kết quả gần nhau. Vui lòng chọn một gợi ý Google Maps cụ thể.')
      }
      return candidates[0].destination
    },
  }
}

function createGoogleRoutesAdapter({ apiKey, apiKeyProvider = mapsApiKey, fetchImpl = globalThis.fetch } = {}) {
  return {
    async computeRoute({ origin, destination }) {
      const resolvedApiKey = apiKey === undefined ? apiKeyProvider() : apiKey
      if (!resolvedApiKey) {
        throw new HttpsError('failed-precondition', 'Google Routes chưa được cấu hình. Admin cần bổ sung GOOGLE_MAPS_API_KEY.')
      }
      if (typeof fetchImpl !== 'function') throw new HttpsError('unavailable', 'Dịch vụ bản đồ chưa sẵn sàng.')
      let response
      try {
        response = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': resolvedApiKey,
            'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.staticDuration',
          },
          body: JSON.stringify({
            origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
            destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE',
            computeAlternativeRoutes: false,
            languageCode: 'vi',
            units: 'METRIC',
          }),
        })
      } catch {
        throw new HttpsError('unavailable', 'Không thể kết nối Google Routes. Vui lòng thử lại.')
      }
      if (!response.ok) throw new HttpsError('unavailable', 'Google Routes tạm thời không thể tính tuyến đường.')
      const payload = await response.json()
      const route = payload?.routes?.[0]
      const distanceMeters = Number(route?.distanceMeters)
      const routeDurationSeconds = durationSeconds(route?.duration || route?.staticDuration)
      if (!Number.isFinite(distanceMeters) || distanceMeters <= 0 || routeDurationSeconds <= 0) {
        throw new HttpsError('failed-precondition', 'Không tìm thấy tuyến giao hàng hợp lệ tới địa chỉ này.')
      }
      return {
        provider: 'google-routes',
        distanceMeters: Math.round(distanceMeters),
        durationSeconds: routeDurationSeconds,
      }
    },
  }
}

async function verifyDeliveryCustomer(config, customer, addressAdapter, now = new Date()) {
  if (!config.distancePricing.enabled) return customer
  const canonicalDestination = await addressAdapter.resolveDestination(customer)
  const verifiedCustomer = verifiedCustomerFromDestination(customer, canonicalDestination, now)
  if (!pointInPolygon(verifiedCustomer, config.distancePricing.serviceAreaPolygon)) {
    throw new HttpsError('out-of-range', 'Địa chỉ nằm ngoài vùng giao hàng đang phục vụ.')
  }
  return verifiedCustomer
}

async function resolveDeliveryRoute(config, customer, routesAdapter) {
  if (!config.distancePricing.enabled) return null
  const origin = normalizeLatLng(config.store, 'Tọa độ bếp')
  const destination = normalizeLatLng(customer, 'Tọa độ giao hàng')
  if (!pointInPolygon(destination, config.distancePricing.serviceAreaPolygon)) {
    throw new HttpsError('out-of-range', 'Địa chỉ nằm ngoài vùng giao hàng đang phục vụ.')
  }
  const route = await routesAdapter.computeRoute({ origin, destination })
  const fee = calculateDistanceDeliveryFee(route.distanceMeters, config.distancePricing)
  return {
    ...route,
    ...fee,
    calculatedAt: new Date().toISOString(),
    destinationHash: digest(stableJson({
      placeId: customer.placeId || '',
      addressLine: customer.addressLine,
      latitude: destination.latitude,
      longitude: destination.longitude,
      addressProvider: customer.addressProvider || '',
    })),
  }
}

function estimateDeliverySla({ config, items, route, request = null, now = new Date() }) {
  const preparationMinutes = Math.max(
    config.sla.preparationMinutes,
    ...items.map((item) => Number(item.preparationMinutes) || 0),
  )
  const routeMinutes = Math.ceil((route?.durationSeconds || 0) / 60)
  const etaMinutes = config.sla.confirmationMinutes + preparationMinutes + config.sla.assignmentMinutes
    + config.sla.pickupMinutes + routeMinutes + config.sla.travelBufferMinutes
  let estimatedDeliveryAt = new Date(now.getTime() + etaMinutes * 60000)
  let promisedAt = new Date(estimatedDeliveryAt.getTime() + config.sla.lateGraceMinutes * 60000)
  if (request?.deliveryMode === 'scheduled' && request.serviceDate && request.deliverySlot?.start && request.deliverySlot?.end) {
    const slotStart = new Date(`${request.serviceDate}T${request.deliverySlot.start}:00+07:00`)
    const slotEnd = new Date(`${request.serviceDate}T${request.deliverySlot.end}:00+07:00`)
    if (Number.isFinite(slotStart.getTime()) && Number.isFinite(slotEnd.getTime())) {
      estimatedDeliveryAt = new Date(Math.min(slotEnd.getTime(), slotStart.getTime() + (routeMinutes + config.sla.travelBufferMinutes) * 60000))
      promisedAt = new Date(slotEnd.getTime() + config.sla.lateGraceMinutes * 60000)
    }
  }
  return {
    estimatedDeliveryAt: estimatedDeliveryAt.toISOString(),
    estimatedArrivalAt: estimatedDeliveryAt.toISOString(),
    promisedAt: promisedAt.toISOString(),
    totalMinutes: etaMinutes,
    preparationMinutes,
    routeMinutes,
    policy: { ...config.sla },
  }
}

function calculateQuote({ config, request, mealRecords, inventoryRecords, route = null, now = new Date() }) {
  const items = request.items.map(({ mealId, quantity }) => {
    const meal = mealRecords.get(mealId)
    if (!meal || meal.active === false) throw new HttpsError('failed-precondition', `Món ${mealId} hiện không phục vụ.`)
    if (request.deliveryMode !== 'asap' && meal.allowedDeliverySlots?.length && !meal.allowedDeliverySlots.includes(request.deliverySlotId)) {
      throw new HttpsError('failed-precondition', `${meal.name} không phục vụ trong khung giờ đã chọn.`)
    }
    const inventoryId = inventoryDocumentId(request.serviceDate, mealId)
    const remaining = availableInventory(meal, inventoryRecords.get(inventoryId))
    if (remaining < quantity) {
      throw new HttpsError('resource-exhausted', `${meal.name} chỉ còn ${remaining} suất cho ngày đã chọn.`)
    }
    const unitPrice = finiteInteger(meal.basePrice, `Giá món ${meal.name || mealId}`, 0, 10000000)
    return {
      id: mealId,
      mealId,
      inventoryId,
      name: meal.name,
      imageUrl: meal.imageUrl || '',
      category: MEAL_CATEGORIES.has(meal.category) ? meal.category : 'lunch',
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity,
      calories: optionalNumber(meal.calories, 'Năng lượng', 0, 5000) * quantity,
      protein: optionalNumber(meal.protein, 'Chất đạm', 0, 500) * quantity,
      carbs: optionalNumber(meal.carbs, 'Tinh bột', 0, 1000) * quantity,
      fat: optionalNumber(meal.fat, 'Chất béo', 0, 500) * quantity,
      fiber: optionalNumber(meal.fiber, 'Chất xơ', 0, 200) * quantity,
      preparationMinutes: optionalNumber(meal.preparationMinutes, 'Thời gian chuẩn bị', 0, 240, config.sla.preparationMinutes),
      inventoryTracked: meal.inventoryTracked !== false,
    }
  })
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0)
  if (subtotal < config.minOrderAmount) {
    throw new HttpsError('failed-precondition', `Đơn hàng tối thiểu ${config.minOrderAmount.toLocaleString('vi-VN')}đ.`)
  }
  if (config.distancePricing.enabled && !route) {
    throw new HttpsError('failed-precondition', 'Không thể báo giá khi chưa xác minh tuyến giao hàng.')
  }
  const baseDeliveryFee = config.distancePricing.enabled
    ? route.baseDeliveryFee
    : request.deliveryZone?.fee ?? config.defaultDeliveryFee
  const deliveryDiscount = config.freeDeliveryThreshold > 0 && subtotal >= config.freeDeliveryThreshold
    ? baseDeliveryFee
    : 0
  const deliveryFee = Math.max(0, baseDeliveryFee - deliveryDiscount)
  const nutrition = items.reduce((total, item) => ({
    calories: Math.round((total.calories + item.calories) * 10) / 10,
    protein: Math.round((total.protein + item.protein) * 10) / 10,
    carbs: Math.round((total.carbs + item.carbs) * 10) / 10,
    fat: Math.round((total.fat + item.fat) * 10) / 10,
    fiber: Math.round((total.fiber + item.fiber) * 10) / 10,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 })
  const eta = estimateDeliverySla({ config, items, route, request, now })
  return {
    schemaVersion: SCHEMA_VERSION,
    currency: CURRENCY,
    paymentMethod: PAYMENT_METHOD,
    cityCode: CITY_CODE,
    cityName: CITY_NAME,
    serviceDate: request.serviceDate,
    deliverySlot: request.deliverySlot,
    deliveryZone: request.deliveryZone,
    deliveryRoute: route,
    verifiedCustomer: request.customer,
    items,
    subtotal,
    baseDeliveryFee,
    deliveryDiscount,
    deliveryFee,
    feeRuleVersion: config.distancePricing.enabled ? route.feeRuleVersion : 'legacy-district-v1',
    total: subtotal + deliveryFee,
    nutrition,
    eta,
  }
}

function canonicalOrderPayload(request) {
  return JSON.stringify({
    items: [...request.items].sort((left, right) => left.mealId.localeCompare(right.mealId)),
    deliveryMode: request.deliveryMode,
    serviceDate: request.serviceDate,
    deliverySlotId: request.deliverySlotId,
    customer: request.customer,
    paymentMethod: request.paymentMethod,
    note: request.note,
  })
}

function canonicalOrderRequestHash(request) {
  return digest(canonicalOrderPayload(request))
}

function quoteSnapshot(quote) {
  return {
    schemaVersion: quote.schemaVersion,
    currency: quote.currency,
    paymentMethod: quote.paymentMethod,
    cityCode: quote.cityCode,
    serviceDate: quote.serviceDate,
    deliverySlot: {
      id: quote.deliverySlot?.id || '',
      start: quote.deliverySlot?.start || '',
      end: quote.deliverySlot?.end || '',
    },
    deliveryZone: {
      id: quote.deliveryZone?.id || '',
      fee: Number(quote.deliveryZone?.fee) || 0,
    },
    deliveryRoute: quote.deliveryRoute ? {
      provider: quote.deliveryRoute.provider,
      distanceMeters: quote.deliveryRoute.distanceMeters,
      roundedDistanceMeters: quote.deliveryRoute.roundedDistanceMeters,
      durationSeconds: quote.deliveryRoute.durationSeconds,
      feeRuleVersion: quote.deliveryRoute.feeRuleVersion,
      destinationHash: quote.deliveryRoute.destinationHash,
    } : null,
    verifiedCustomer: quote.verifiedCustomer || null,
    items: [...(quote.items || [])]
      .map((item) => ({
        mealId: item.mealId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        fiber: item.fiber,
      }))
      .sort((left, right) => left.mealId.localeCompare(right.mealId)),
    subtotal: quote.subtotal,
    baseDeliveryFee: quote.baseDeliveryFee,
    deliveryDiscount: quote.deliveryDiscount,
    deliveryFee: quote.deliveryFee,
    feeRuleVersion: quote.feeRuleVersion,
    total: quote.total,
    nutrition: quote.nutrition,
    eta: quote.eta,
  }
}

function quoteSnapshotHash(quote) {
  return digest(stableJson(quoteSnapshot(quote)))
}

function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value)
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((Number(value.nanoseconds) || 0) / 1000000)
  }
  return Number.NaN
}

function validateQuoteRecord({ quoteRecord, userId, requestHash, quoteHash, now = new Date() }) {
  if (!quoteRecord || typeof quoteRecord !== 'object') {
    throw new HttpsError('failed-precondition', 'Báo giá không tồn tại. Vui lòng cập nhật báo giá trước khi đặt món.')
  }
  if (quoteRecord.userId !== userId) {
    throw new HttpsError('permission-denied', 'Báo giá không thuộc tài khoản hiện tại.')
  }
  if (quoteRecord.usedAt || quoteRecord.orderId || quoteRecord.status === 'consumed') {
    throw new HttpsError('failed-precondition', 'Báo giá đã được sử dụng. Vui lòng cập nhật báo giá mới.')
  }
  if (quoteRecord.status !== 'active') {
    throw new HttpsError('failed-precondition', 'Báo giá không còn hiệu lực. Vui lòng cập nhật báo giá mới.')
  }
  const expiresAt = timestampMillis(quoteRecord.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    throw new HttpsError('failed-precondition', 'Báo giá đã hết hạn. Vui lòng cập nhật lại báo giá.')
  }
  if (!requestHash || quoteRecord.requestHash !== requestHash) {
    throw new HttpsError('failed-precondition', 'Thông tin đơn hàng đã thay đổi sau khi báo giá.')
  }
  if (!quoteHash || quoteRecord.quoteHash !== quoteHash) {
    throw new HttpsError('failed-precondition', 'Giá hoặc tình trạng món đã thay đổi. Vui lòng cập nhật lại báo giá.')
  }
  return true
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function rawOrderRequestHash(value) {
  const source = value && typeof value === 'object' ? value : {}
  return digest(stableJson({
    items: source.items,
    deliveryMode: source.deliveryMode || (source.deliverySlotId === 'asap' ? 'asap' : 'scheduled'),
    serviceDate: source.serviceDate,
    deliverySlotId: source.deliverySlotId,
    customer: source.customer,
    paymentMethod: source.paymentMethod || PAYMENT_METHOD,
    note: source.note || '',
  }))
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function serializeValue(value) {
  if (value === null || value === undefined) return value ?? null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(serializeValue)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeValue(item)]))
  }
  return value
}

function publicDeliveryValue(value, id = '') {
  const serialized = { ...(id ? { id } : {}), ...serializeValue(value || {}) }
  ;[
    'userId',
    'customerId',
    'assignedBy',
    'deliveryOtpHash',
    'deliveryOtpHashVersion',
    'otpFailedAttempts',
    'otpLockedUntil',
    'lastOtpFailureAt',
  ]
    .forEach((key) => delete serialized[key])
  return serialized
}

function publicConfig(config) {
  const deliveryZones = config.deliveryZones.filter((item) => item.enabled)
  const deliverySlots = config.deliverySlots.filter((item) => item.enabled)
  return {
    schemaVersion: config.schemaVersion,
    enabled: config.enabled,
    acceptingOrders: config.acceptingOrders,
    asapEnabled: config.asapEnabled,
    orderingEnabled: config.enabled && config.acceptingOrders,
    cityCode: CITY_CODE,
    cityName: CITY_NAME,
    currency: CURRENCY,
    paymentMethods: [PAYMENT_METHOD],
    minOrderAmount: config.minOrderAmount,
    defaultDeliveryFee: config.defaultDeliveryFee,
    freeDeliveryThreshold: config.freeDeliveryThreshold,
    sameDayCutoff: config.sameDayCutoff,
    minimumLeadDays: config.minimumLeadDays,
    maxAdvanceDays: config.maxAdvanceDays,
    supportPhone: config.supportPhone,
    store: config.store,
    distancePricing: {
      enabled: config.distancePricing.enabled,
      provider: config.distancePricing.provider,
      maxDistanceMeters: config.distancePricing.maxDistanceMeters,
      feeRuleVersion: config.distancePricing.feeRuleVersion,
      tiers: config.distancePricing.tiers,
    },
    sla: config.sla,
    deliveryZones,
    districts: deliveryZones.map((item) => ({ id: item.id, name: item.label, active: true })),
    deliverySlots: deliverySlots.map((item) => ({ ...item, active: true })),
  }
}

function publicMealCategory(meal) {
  const tags = new Set([...(meal.dietaryTags || []), ...(meal.goalTags || [])].map(normalizedKey))
  if (meal.category === 'breakfast') return 'breakfast'
  if (tags.has('vegetarian') || tags.has('vegan')) return 'vegetarian'
  if (tags.has('low-carb')) return 'low-carb'
  if (tags.has('high-protein')) return 'high-protein'
  return 'balanced'
}

function publicMeal(meal) {
  const tags = [...new Set([...(meal.dietaryTags || []), ...(meal.goalTags || [])])]
  return {
    id: meal.id,
    slug: meal.slug,
    name: meal.name,
    shortDescription: meal.shortDescription || '',
    description: meal.description || '',
    imageUrl: meal.imageUrl || '',
    category: publicMealCategory(meal),
    mealCategory: meal.category,
    tags,
    basePrice: meal.basePrice,
    compareAtPrice: meal.compareAtPrice ?? null,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
    fiber: meal.fiber || 0,
    servingGrams: meal.servingGrams || 0,
    preparationMinutes: meal.preparationMinutes || DEFAULT_CONFIG.sla.preparationMinutes,
    ingredients: meal.ingredients || [],
    dietaryTags: meal.dietaryTags || [],
    goalTags: meal.goalTags || [],
    allergens: meal.allergens || [],
    allowedDeliverySlots: meal.allowedDeliverySlots || [],
    inventoryTracked: meal.inventoryTracked !== false,
    featured: meal.featured === true,
    sortOrder: meal.sortOrder || 0,
  }
}

async function readConfig(db, reader = null) {
  const reference = db.doc('system/eat_clean_config')
  const snapshot = reader ? await reader.get(reference) : await reference.get()
  return normalizeStoredConfig(snapshot.exists ? snapshot.data() : {})
}

async function readMeals(db, { activeOnly = false } = {}) {
  let query = db.collection('eatCleanMeals').limit(200)
  if (activeOnly) query = db.collection('eatCleanMeals').where('active', '==', true).limit(200)
  const snapshot = await query.get()
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

async function readInventoryForMeals(db, serviceDate, meals) {
  const records = new Map()
  for (let offset = 0; offset < meals.length; offset += 100) {
    const references = meals.slice(offset, offset + 100).map((meal) => db.doc(`eatCleanInventory/${inventoryDocumentId(serviceDate, meal.id)}`))
    if (!references.length) continue
    const snapshots = await db.getAll(...references)
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) records.set(snapshot.id, snapshot.data())
    })
  }
  return records
}

function recommendationScore(meal, profile) {
  let score = meal.featured ? 8 : 0
  const reasons = []
  const goal = normalizedKey(profile.goal)
  const desiredTags = new Set((profile.dietaryTags || []).map(normalizedKey))
  const mealTags = new Set([...(meal.dietaryTags || []), ...(meal.goalTags || [])].map(normalizedKey))
  const protein = Number(meal.protein) || 0
  const calories = Math.max(1, Number(meal.calories) || 0)
  const fiber = Number(meal.fiber) || 0

  if (goal.includes('lose') || goal.includes('fat') || goal.includes('giam-mo')) {
    score += Math.min(30, (protein / calories) * 450)
    score += Math.min(12, fiber * 1.5)
    if (calories >= 300 && calories <= 600) score += 10
    reasons.push('Ưu tiên đạm và chất xơ để kiểm soát năng lượng')
  } else if (goal.includes('gain') || goal.includes('muscle') || goal.includes('tang-co')) {
    score += Math.min(35, protein * 1.2)
    if (calories >= 450) score += 10
    reasons.push('Nguồn đạm phù hợp mục tiêu phát triển cơ')
  } else {
    score += Math.min(24, protein)
    score += Math.min(12, fiber * 1.5)
    reasons.push('Macro cân bằng cho bữa ăn hằng ngày')
  }
  desiredTags.forEach((tag) => {
    if (mealTags.has(tag)) score += 12
  })
  if (profile.category && meal.category === profile.category) score += 10
  if (Number.isFinite(profile.remainingCalories) && profile.remainingCalories > 0) {
    const calorieFitTarget = Math.min(700, Math.max(280, profile.remainingCalories))
    score += Math.max(0, 20 - (Math.abs(calories - calorieFitTarget) / calorieFitTarget) * 20)
    reasons.push(`Phù hợp phần năng lượng còn lại khoảng ${Math.round(profile.remainingCalories)} kcal`)
  }
  if (Number.isFinite(profile.remainingProtein) && profile.remainingProtein > 0) {
    score += Math.min(18, (protein / profile.remainingProtein) * 18)
    reasons.push(`Bổ sung ${Math.round(protein)}g đạm cho mục tiêu còn thiếu`)
  }
  return { score: Math.round(score * 10) / 10, reasons: reasons.slice(-2) }
}

function firstFiniteNumber(values, fallback) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return fallback
}

function canTransitionOrder(from, to) {
  return from === to || Boolean(ORDER_TRANSITIONS[from]?.has(to))
}

function cancellationPolicyFor(status, actorType = 'customer') {
  const policy = ORDER_CANCELLATION_POLICY[status]
  if (!policy || policy[actorType] !== true) {
    throw new HttpsError(
      'failed-precondition',
      actorType === 'customer'
        ? 'Đơn hàng không còn trong trạng thái có thể tự hủy. Vui lòng liên hệ Aura để được hỗ trợ.'
        : 'Không thể hủy đơn sau khi shipper đã lấy món hoặc đơn đã hoàn tất.',
    )
  }
  return policy
}

function paidOrder(order) {
  return order?.paymentStatus === 'paid' || order?.payment?.status === 'paid'
}

function refundJobForOrder(order, { orderId, reason, requestedBy, policy, now = new Date() }) {
  const method = String(order?.paymentMethod || order?.payment?.method || PAYMENT_METHOD).toUpperCase()
  const provider = String(order?.paymentProvider || order?.payment?.provider || '').trim()
  // A provider name stored on an order is not proof that a refund adapter is
  // installed. Until a real provider callback exists, full refunds remain
  // blocked and kitchen-stage cancellations require explicit manual review.
  return {
    schemaVersion: SCHEMA_VERSION,
    orderId,
    userId: typeof order?.userId === 'string' ? order.userId : '',
    amount: Math.max(0, Number(order?.total || order?.pricing?.totalAmount || 0)),
    currency: order?.currency || CURRENCY,
    paymentMethod: method,
    paymentProvider: provider || null,
    status: policy?.refundMode === 'manual_review'
      ? REFUND_JOB_STATUSES.MANUAL_REVIEW
      : REFUND_JOB_STATUSES.BLOCKED_PROVIDER,
    reason: reason || 'order_cancelled',
    refundMode: policy?.refundMode || 'manual_review',
    manualReviewRequired: true,
    requestedBy,
    requestedAt: Timestamp.fromDate(now),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

function orderStatusTimestampField(status) {
  return ({
    confirmed: 'confirmedAt',
    preparing: 'preparingAt',
    ready: 'readyAt',
    out_for_delivery: 'outForDeliveryAt',
    delivered: 'deliveredAt',
    cancelled: 'cancelledAt',
  })[status] || ''
}

function operationalSignalDocumentId(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

async function recordOperationalSignal(db, signal, logger = console, context = {}) {
  const allowed = new Set(['maps_error', 'address_error', 'route_error'])
  if (!allowed.has(signal)) return
  try {
    await db.doc(`eatCleanOperationalSignals/${operationalSignalDocumentId()}`).set({
      schemaVersion: SCHEMA_VERSION,
      counts: { [signal]: FieldValue.increment(1) },
      lastSignal: signal,
      lastOccurredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  } catch (error) {
    logger.warn('Unable to persist Eat Clean operational signal', {
      operation: 'operational_signal',
      signal,
      code: typeof error?.code === 'string' ? error.code : 'unknown',
      ...context,
    })
  }
}

function orderInventoryEffect(from, to) {
  if (from === to) return 'none'
  if (to === 'cancelled' && !['delivered', 'cancelled'].includes(from)) return 'release'
  if (to === 'delivered' && from === 'out_for_delivery') return 'sell'
  return 'none'
}

function orderStatusNotificationCopy(status, code) {
  const messages = {
    confirmed: ['Đơn Eat Clean đã được xác nhận', `${code} đã được Aura xác nhận và chuẩn bị.`],
    preparing: ['Bếp đang chuẩn bị đơn', `${code} đang được chế biến theo khẩu phần đã đặt.`],
    ready: ['Đơn Eat Clean đã sẵn sàng', `${code} đã sẵn sàng để bàn giao cho đơn vị giao hàng.`],
    out_for_delivery: ['Đơn Eat Clean đang được giao', `${code} đang trên đường đến địa chỉ của bạn.`],
    delivered: ['Đơn Eat Clean đã giao', `${code} đã giao thành công. Bạn có thể ghi khẩu phần vào nhật ký dinh dưỡng.`],
    cancelled: ['Đơn Eat Clean đã hủy', `${code} đã được hủy. Xem chi tiết đơn để biết thêm thông tin.`],
  }
  return messages[status] || ['Đơn Eat Clean đã cập nhật', `${code} vừa có trạng thái mới.`]
}

function normalizedConsumedRatio(value, label = 'Tỷ lệ khẩu phần') {
  const numeric = value ?? 1
  const ratio = typeof numeric === 'number' && numeric > 1 ? numeric / 100 : numeric
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0.25 || ratio > 1) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return Math.round(ratio * 100) / 100
}

function scaledNutrition(value, ratio) {
  return Math.round(((Number(value) || 0) * ratio) * 10) / 10
}

function deliveryStartAt(order) {
  const start = order.deliverySlot?.start
  if (!order.serviceDate || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start || '')) return null
  return new Date(`${order.serviceDate}T${start}:00+07:00`)
}

function ensureCustomerCancellationWindow(order, config, now = new Date()) {
  const startsAt = deliveryStartAt(order)
  if (!startsAt) return
  const cutoff = startsAt.getTime() - config.cancellationCutoffHours * 60 * 60 * 1000
  if (now.getTime() >= cutoff) {
    throw new HttpsError('failed-precondition', 'Đơn đã qua hạn tự hủy. Vui lòng liên hệ Aura để được hỗ trợ.')
  }
}

function canCustomerCancelOrder(order, config, now = new Date()) {
  if (ORDER_CANCELLATION_POLICY[order?.status]?.customer !== true) return false
  const startsAt = deliveryStartAt(order)
  if (!startsAt) return true
  const cutoff = startsAt.getTime() - config.cancellationCutoffHours * 60 * 60 * 1000
  return now.getTime() < cutoff
}

async function loadQuoteRecords(db, normalized) {
  const mealReferences = normalized.items.map((item) => db.doc(`eatCleanMeals/${item.mealId}`))
  const inventoryReferences = normalized.items.map((item) => db.doc(`eatCleanInventory/${inventoryDocumentId(normalized.serviceDate, item.mealId)}`))
  const snapshots = await db.getAll(...mealReferences, ...inventoryReferences)
  const mealRecords = new Map()
  const inventoryRecords = new Map()
  snapshots.slice(0, mealReferences.length).forEach((snapshot) => {
    if (snapshot.exists) mealRecords.set(snapshot.id, { id: snapshot.id, ...snapshot.data() })
  })
  snapshots.slice(mealReferences.length).forEach((snapshot) => {
    if (snapshot.exists) inventoryRecords.set(snapshot.id, snapshot.data())
  })
  return { mealRecords, inventoryRecords }
}

async function enforceEatCleanQuoteRateLimit(db, userId, now = new Date()) {
  const reference = db.doc(`eatCleanQuoteRateLimits/${digest(userId)}`)
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    const current = snapshot.data() || {}
    const previousStartedAt = timestampMillis(current.windowStartedAt)
    const sameWindow = Number.isFinite(previousStartedAt)
      && now.getTime() - previousStartedAt < QUOTE_RATE_LIMIT_WINDOW_MS
    const requestCount = sameWindow ? (Number(current.requestCount) || 0) + 1 : 1
    if (requestCount > QUOTE_RATE_LIMIT_MAX) {
      const retryAfterSeconds = Math.max(1, Math.ceil(
        (previousStartedAt + QUOTE_RATE_LIMIT_WINDOW_MS - now.getTime()) / 1000,
      ))
      throw new HttpsError(
        'resource-exhausted',
        `Bạn đang yêu cầu báo giá quá nhanh. Vui lòng thử lại sau ${retryAfterSeconds} giây.`,
      )
    }
    transaction.set(reference, {
      schemaVersion: SCHEMA_VERSION,
      userId,
      requestCount,
      windowStartedAt: Timestamp.fromMillis(sameWindow ? previousStartedAt : now.getTime()),
      expiresAt: Timestamp.fromMillis(now.getTime() + 24 * 60 * 60 * 1000),
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
}

function normalizeDeliveryCursor(value) {
  if (value === undefined || value === null || value === '') return null
  if (!value || typeof value !== 'object') throw new HttpsError('invalid-argument', 'Con trỏ danh sách giao hàng không hợp lệ.')
  const id = documentId(value.id, 'Mã con trỏ giao hàng')
  const updatedAt = new Date(boundedString(value.updatedAt, 'Thời gian con trỏ giao hàng', 40))
  if (!Number.isFinite(updatedAt.getTime())) throw new HttpsError('invalid-argument', 'Thời gian con trỏ giao hàng không hợp lệ.')
  return { id, updatedAt: Timestamp.fromDate(updatedAt) }
}

function buildActiveDeliveriesQuery(collection, { shipperId = '', cursor = null, limit = 100 } = {}) {
  let query = collection
  if (shipperId) query = query.where('shipperId', '==', documentId(shipperId, 'Mã shipper'))
  query = query
    .where('status', 'in', ACTIVE_DELIVERY_STATUSES)
    .orderBy('updatedAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc')
  if (cursor) query = query.startAfter(cursor.updatedAt, cursor.id)
  return query.limit(limit)
}

function nextDeliveryCursor(snapshot, limit) {
  if (!snapshot || snapshot.empty || snapshot.size < limit) return null
  const last = snapshot.docs[snapshot.docs.length - 1]
  const updatedAt = serializeValue(last.data()?.updatedAt)
  return typeof updatedAt === 'string' && updatedAt
    ? { id: last.id, updatedAt }
    : null
}

function liveLocationHealth(value, nowMillis = Date.now()) {
  if (!value || typeof value !== 'object') return { stale: false, expired: false, ageMs: null }
  const updatedAt = Number(value.updatedAt || 0)
  const expiresAt = Number(value.expiresAt || (updatedAt > 0 ? updatedAt + LIVE_LOCATION_RETENTION_MS : 0))
  const ageMs = updatedAt > 0 ? Math.max(0, nowMillis - updatedAt) : null
  return {
    stale: ageMs === null || ageMs > LIVE_LOCATION_STALE_MS,
    expired: expiresAt > 0 && expiresAt <= nowMillis,
    ageMs,
  }
}

async function countActiveDeliveryJobs(collection, shipperId = '') {
  let query = collection
  if (shipperId) query = query.where('shipperId', '==', documentId(shipperId, 'Mã shipper'))
  const snapshot = await query.where('status', 'in', ACTIVE_DELIVERY_STATUSES).count().get()
  const count = Number(snapshot.data()?.count)
  return Number.isInteger(count) && count >= 0 ? count : 0
}

async function bestEffortRealtimeWrite({ realtimeDb, path, write, logger = console, context = {} }) {
  if (!realtimeDb) return { configured: false, synced: false, warning: 'realtime_not_configured' }
  try {
    await write(realtimeDb.ref(path))
    return { configured: true, synced: true, warning: null }
  } catch (error) {
    logger.warn('Eat Clean Realtime Database mirror failed', {
      ...context,
      code: typeof error?.code === 'string' ? error.code : 'unknown',
    })
    return { configured: true, synced: false, warning: 'realtime_temporarily_unavailable' }
  }
}

function trustedRole(request, profile, allowedRoles) {
  const claimRole = String(request.auth?.token?.role || '')
  return allowedRoles.has(claimRole)
    && profile?.role === claimRole
    && profile?.disabled !== true
}

function deliveryOtpFor(orderId, userId, secret = otpSecretValue()) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new HttpsError('failed-precondition', 'DELIVERY_OTP_SECRET chưa được cấu hình an toàn.')
  }
  const hexadecimal = createHmac('sha256', secret).update(`${orderId}:${userId}`).digest('hex')
  return String(Number.parseInt(hexadecimal.slice(0, 8), 16) % 10000).padStart(4, '0')
}

function otpHash(orderId, otp, secret = otpSecretValue()) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new HttpsError('failed-precondition', 'DELIVERY_OTP_SECRET chưa được cấu hình an toàn.')
  }
  return createHmac('sha256', secret).update(`eat-clean-delivery-hash:${orderId}:${otp}`).digest('hex')
}

function legacyOtpHash(orderId, otp) {
  return digest(`eat-clean-delivery:${orderId}:${otp}`)
}

function safeHashEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function canTransitionDelivery(from, to) {
  return from === to || Boolean(DELIVERY_TRANSITIONS[from]?.has(to))
}

function createEatCleanFunctions(dependencies) {
  const db = requireFactoryDependency(dependencies?.db, 'db')
  const onCall = requireFactoryDependency(dependencies?.onCall, 'onCall')
  const requireTrustedAdmin = requireFactoryDependency(dependencies?.requireTrustedAdmin, 'requireTrustedAdmin')
  const logger = dependencies?.logger || console
  const realtimeDb = dependencies?.realtimeDb || null
  const routesAdapter = dependencies?.routesAdapter || createGoogleRoutesAdapter()
  const addressAdapter = dependencies?.addressAdapter || createGoogleAddressAdapter()

  async function trustedAdminId(request) {
    const result = await requireTrustedAdmin(request)
    return typeof result === 'string' && result ? result : requireUser(request)
  }

  async function trustedShipper(request, { allowAdmin = true } = {}) {
    const actorId = requireUser(request)
    const snapshot = await db.doc(`users/${actorId}`).get()
    const roles = allowAdmin
      ? new Set(['shipper', 'admin', 'super_admin'])
      : new Set(['shipper'])
    if (!snapshot.exists || !trustedRole(request, snapshot.data(), roles)) {
      throw new HttpsError('permission-denied', 'Tài khoản không có quyền vận hành giao hàng.')
    }
    return { actorId, role: snapshot.data().role, profile: snapshot.data() }
  }

  const callableOptions = { cpu: 'gcf_gen1', maxInstances: 3, invoker: 'public' }
  const writeOptions = { cpu: 'gcf_gen1', maxInstances: 2, invoker: 'public' }
  const mapsCallableOptions = { ...callableOptions, secrets: [googleMapsApiKeySecret] }
  const otpCallableOptions = { ...callableOptions, secrets: [deliveryOtpSecret] }
  const otpWriteOptions = { ...writeOptions, secrets: [deliveryOtpSecret] }
  const mapsWriteOptions = { ...writeOptions, secrets: [googleMapsApiKeySecret] }
  const deliveryOperationsCallableOptions = {
    ...callableOptions,
    secrets: [googleMapsApiKeySecret, deliveryOtpSecret],
  }
  const deliveryOperationsWriteOptions = {
    ...writeOptions,
    secrets: [googleMapsApiKeySecret, deliveryOtpSecret],
  }

  const listEatCleanAddresses = onCall(callableOptions, async (request) => {
    const userId = requireUser(request)
    const snapshot = await db.collection(`users/${userId}/eatCleanAddresses`).limit(MAX_SAVED_ADDRESSES).get()
    const addresses = snapshot.docs
      .map((item) => ({ id: item.id, ...serializeValue(item.data()) }))
      .sort((left, right) => Number(right.isDefault) - Number(left.isDefault)
        || String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
    return { schemaVersion: SCHEMA_VERSION, addresses, maximum: MAX_SAVED_ADDRESSES }
  })

  const saveEatCleanAddress = onCall(writeOptions, async (request) => {
    const userId = requireUser(request)
    const requestedId = request.data?.address?.id || request.data?.id
    const reference = requestedId
      ? db.doc(`users/${userId}/eatCleanAddresses/${documentId(requestedId, 'Mã địa chỉ')}`)
      : db.collection(`users/${userId}/eatCleanAddresses`).doc()
    const input = normalizeSavedAddress(request.data?.address || request.data, reference.id)
    const collection = db.collection(`users/${userId}/eatCleanAddresses`)
    const saved = await db.runTransaction(async (transaction) => {
      const [addressesSnapshot, currentSnapshot] = await Promise.all([
        transaction.get(collection.limit(MAX_SAVED_ADDRESSES + 1)),
        transaction.get(reference),
      ])
      if (!currentSnapshot.exists && addressesSnapshot.size >= MAX_SAVED_ADDRESSES) {
        throw new HttpsError('resource-exhausted', `Bạn chỉ có thể lưu tối đa ${MAX_SAVED_ADDRESSES} địa chỉ.`)
      }
      if (input.isDefault || addressesSnapshot.empty) {
        addressesSnapshot.docs.forEach((snapshot) => {
          if (snapshot.id !== reference.id && snapshot.data().isDefault === true) {
            transaction.set(snapshot.ref, { isDefault: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
          }
        })
      }
      const next = {
        ...input,
        isDefault: input.isDefault || addressesSnapshot.empty,
        createdAt: currentSnapshot.exists ? currentSnapshot.data().createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }
      transaction.set(reference, next)
      return { ...serializeValue(next), id: reference.id, updatedAt: new Date().toISOString() }
    })
    return { address: saved }
  })

  const deleteEatCleanAddress = onCall(writeOptions, async (request) => {
    const userId = requireUser(request)
    const addressId = documentId(request.data?.addressId, 'Mã địa chỉ')
    const collection = db.collection(`users/${userId}/eatCleanAddresses`)
    const reference = collection.doc(addressId)
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) return
      const addressesSnapshot = snapshot.data().isDefault
        ? await transaction.get(collection.limit(MAX_SAVED_ADDRESSES))
        : null
      transaction.delete(reference)
      const replacement = addressesSnapshot?.docs.find((item) => item.id !== addressId)
      if (replacement) transaction.set(replacement.ref, { isDefault: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    })
    return { deleted: true, addressId }
  })

  const setDefaultEatCleanAddress = onCall(writeOptions, async (request) => {
    const userId = requireUser(request)
    const addressId = documentId(request.data?.addressId, 'Mã địa chỉ')
    const collection = db.collection(`users/${userId}/eatCleanAddresses`)
    await db.runTransaction(async (transaction) => {
      const addressesSnapshot = await transaction.get(collection.limit(MAX_SAVED_ADDRESSES + 1))
      const target = addressesSnapshot.docs.find((item) => item.id === addressId)
      if (!target) throw new HttpsError('not-found', 'Không tìm thấy địa chỉ đã lưu.')
      addressesSnapshot.docs.forEach((snapshot) => transaction.set(snapshot.ref, {
        isDefault: snapshot.id === addressId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }))
    })
    return { addressId, isDefault: true }
  })

  const getEatCleanStorefront = onCall(callableOptions, async (request) => {
    const config = await readConfig(db)
    const deliveryMode = request.data?.deliveryMode === 'asap' ? 'asap' : 'scheduled'
    if (deliveryMode === 'asap' && !config.asapEnabled) {
      throw new HttpsError('failed-precondition', 'Bếp hiện chưa nhận đơn giao sớm nhất.')
    }
    const requestedDate = deliveryMode === 'asap'
      ? todayInVietnam()
      : request.data?.serviceDate
        ? dateKey(request.data.serviceDate)
        : addUtcDays(todayInVietnam(), Math.max(1, config.minimumLeadDays))
    if (deliveryMode === 'scheduled') validateServiceDate(requestedDate, config)
    const meals = await readMeals(db, { activeOnly: true })
    const inventory = await readInventoryForMeals(db, requestedDate, meals)
    const items = meals
      .map((meal) => ({
        ...publicMeal(meal),
        availableQuantity: meal.inventoryTracked === false
          ? null
          : availableInventory(meal, inventory.get(inventoryDocumentId(requestedDate, meal.id))),
      }))
      .sort((left, right) => Number(right.featured) - Number(left.featured)
        || left.sortOrder - right.sortOrder
        || left.name.localeCompare(right.name, 'vi'))
    return {
      schemaVersion: SCHEMA_VERSION,
      serverTime: new Date().toISOString(),
      serviceDate: requestedDate,
      deliveryMode,
      config: {
        ...publicConfig(config),
        featuredMealIds: items.filter((item) => item.featured).map((item) => item.id),
      },
      orderingEnabled: config.enabled && config.acceptingOrders,
      meals: items,
    }
  })

  const recommendEatCleanMeals = onCall(callableOptions, async (request) => {
    const userId = requireUser(request)
    const config = await readConfig(db)
    const serviceDate = request.data?.serviceDate
      ? dateKey(request.data.serviceDate)
      : addUtcDays(todayInVietnam(), Math.max(1, config.minimumLeadDays))
    validateServiceDate(serviceDate, config)
    const today = todayInVietnam()
    const [profileSnapshot, meals, mealLogsSnapshot] = await Promise.all([
      db.doc(`users/${userId}`).get(),
      readMeals(db, { activeOnly: true }),
      db.collection(`users/${userId}/mealLogs`).where('date', '==', today).limit(100).get(),
    ])
    const userProfile = profileSnapshot.data() || {}
    const nutritionProfile = userProfile.nutritionProfile || {}
    const allergies = canonicalAllergenIds([
      ...(Array.isArray(userProfile.allergies) ? userProfile.allergies : []),
      ...(Array.isArray(nutritionProfile.allergies) ? nutritionProfile.allergies : []),
      ...cleanStringList(request.data?.allergies, 'Dị ứng', 20, 80),
    ])
    const consumedFromLogs = mealLogsSnapshot.docs.reduce((total, snapshot) => {
      const log = snapshot.data() || {}
      total.calories += Number(log.calories) || 0
      total.protein += Number(log.protein) || 0
      return total
    }, { calories: 0, protein: 0 })
    const calorieTarget = firstFiniteNumber([
      request.data?.calorieTarget,
      nutritionProfile.calorieTarget,
      nutritionProfile.calorieGoal,
      userProfile.calorieTarget,
      userProfile.calorieGoal,
    ], 2000)
    const proteinTarget = firstFiniteNumber([
      request.data?.proteinTarget,
      nutritionProfile.proteinTarget,
      nutritionProfile.proteinGoal,
      userProfile.proteinTarget,
      userProfile.proteinGoal,
    ], 100)
    const consumedCalories = firstFiniteNumber([request.data?.consumedCalories], consumedFromLogs.calories)
    const consumedProtein = firstFiniteNumber([request.data?.consumedProtein], consumedFromLogs.protein)
    const remainingCalories = firstFiniteNumber(
      [request.data?.remainingCalories],
      Math.max(0, calorieTarget - consumedCalories),
    )
    const remainingProtein = firstFiniteNumber(
      [request.data?.remainingProtein],
      Math.max(0, proteinTarget - consumedProtein),
    )
    const profile = {
      goal: request.data?.goal || nutritionProfile.goal || userProfile.goal || userProfile.goals?.[0] || 'maintain',
      category: MEAL_CATEGORIES.has(request.data?.category) ? request.data.category : '',
      dietaryTags: [
        ...(Array.isArray(nutritionProfile.dietaryTags) ? nutritionProfile.dietaryTags : []),
        ...cleanStringList(request.data?.dietaryTags, 'Chế độ ăn', 20, 80),
      ],
      remainingCalories,
      remainingProtein,
    }
    const inventory = await readInventoryForMeals(db, serviceDate, meals)
    const limit = finiteInteger(request.data?.limit ?? 6, 'Số gợi ý', 1, 20)
    const recommendations = meals
      .filter((meal) => !hasAllergenConflict(meal.allergens, allergies))
      .filter((meal) => availableInventory(meal, inventory.get(inventoryDocumentId(serviceDate, meal.id))) > 0)
      .map((meal) => ({
        meal: publicMeal(meal),
        ...recommendationScore(meal, profile),
        availableQuantity: meal.inventoryTracked === false
          ? null
          : availableInventory(meal, inventory.get(inventoryDocumentId(serviceDate, meal.id))),
      }))
      .sort((left, right) => right.score - left.score || left.meal.name.localeCompare(right.meal.name, 'vi'))
      .slice(0, limit)
    return {
      schemaVersion: SCHEMA_VERSION,
      serviceDate,
      goal: profile.goal,
      recommendationContext: {
        date: today,
        calorieTarget,
        proteinTarget,
        consumedCalories: Math.round(consumedCalories * 10) / 10,
        consumedProtein: Math.round(consumedProtein * 10) / 10,
        remainingCalories: Math.round(remainingCalories * 10) / 10,
        remainingProtein: Math.round(remainingProtein * 10) / 10,
      },
      recommendations,
    }
  })

  const quoteEatCleanOrder = onCall(mapsCallableOptions, async (request) => {
    const userId = requireUser(request)
    const config = await readConfig(db)
    if (!config.enabled || !config.acceptingOrders) {
      throw new HttpsError('failed-precondition', 'Eat Clean hiện chưa nhận đơn mới.')
    }
    const normalized = normalizeOrderRequest(request.data, config)
    const originalRequestHash = canonicalOrderRequestHash(normalized)
    const quotedAt = new Date()
    if (config.distancePricing.enabled) await enforceEatCleanQuoteRateLimit(db, userId, quotedAt)
    let verifiedCustomer
    try {
      verifiedCustomer = await verifyDeliveryCustomer(config, normalized.customer, addressAdapter, quotedAt)
    } catch (error) {
      if (config.distancePricing.enabled) {
        await recordOperationalSignal(db, 'address_error', logger, { code: typeof error?.code === 'string' ? error.code : 'unknown' })
      }
      throw error
    }
    const verifiedRequest = { ...normalized, customer: verifiedCustomer }
    const records = await loadQuoteRecords(db, verifiedRequest)
    let route
    try {
      route = await resolveDeliveryRoute(config, verifiedCustomer, routesAdapter)
    } catch (error) {
      if (config.distancePricing.enabled) {
        await recordOperationalSignal(db, 'route_error', logger, { code: typeof error?.code === 'string' ? error.code : 'unknown' })
      }
      throw error
    }
    const quote = calculateQuote({ config, request: verifiedRequest, route, now: quotedAt, ...records })
    const expiresAt = new Date(quotedAt.getTime() + QUOTE_TTL_MS)
    const quoteReference = db.collection('eatCleanQuotes').doc()
    await quoteReference.create({
      schemaVersion: SCHEMA_VERSION,
      userId,
      status: 'active',
      requestHash: canonicalOrderRequestHash(verifiedRequest),
      originalRequestHash,
      verifiedCustomer,
      quoteHash: quoteSnapshotHash(quote),
      serviceDate: verifiedRequest.serviceDate,
      itemCount: verifiedRequest.items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: quote.subtotal,
      deliveryFee: quote.deliveryFee,
      deliveryRoute: quote.deliveryRoute,
      eta: quote.eta,
      quoteSnapshot: quote,
      total: quote.total,
      currency: CURRENCY,
      createdAt: FieldValue.serverTimestamp(),
      quotedAt: Timestamp.fromDate(quotedAt),
      expiresAt: Timestamp.fromDate(expiresAt),
    })
    return {
      ...quote,
      quoteId: quoteReference.id,
      quotedAt: quotedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }
  })

  const createEatCleanOrder = onCall(mapsWriteOptions, async (request) => {
    const userId = requireUser(request)
    const quoteId = documentId(request.data?.quoteId, 'Mã báo giá')
    const idempotencyKey = boundedString(request.data?.idempotencyKey, 'Khóa chống gửi trùng', 128)
    if (idempotencyKey.length < 8) throw new HttpsError('invalid-argument', 'Khóa chống gửi trùng quá ngắn.')
    const requestHash = rawOrderRequestHash(request.data)
    const orderReference = db.collection('eatCleanOrders').doc()
    const markerReference = db.doc(`eatCleanIdempotency/${digest(`${userId}:${idempotencyKey}`)}`)
    const quoteReference = db.doc(`eatCleanQuotes/${quoteId}`)
    const deliveryReference = db.doc(`eatCleanDeliveries/${orderReference.id}`)
    const now = new Date()

    const result = await db.runTransaction(async (transaction) => {
      const markerSnapshot = await transaction.get(markerReference)
      if (markerSnapshot.exists) {
        const marker = markerSnapshot.data()
        if (marker.requestHash !== requestHash) {
          throw new HttpsError('already-exists', 'Khóa chống gửi trùng đã được dùng cho một đơn hàng khác.')
        }
        const existingReference = db.doc(`eatCleanOrders/${marker.orderId}`)
        const existingSnapshot = await transaction.get(existingReference)
        if (!existingSnapshot.exists || marker.userId !== userId) {
          throw new HttpsError('failed-precondition', 'Khóa chống gửi trùng không còn hợp lệ.')
        }
        return { order: { id: existingSnapshot.id, ...serializeValue(existingSnapshot.data()) }, idempotent: true }
      }

      const quoteRecordSnapshot = await transaction.get(quoteReference)
      const quoteRecord = quoteRecordSnapshot.exists ? quoteRecordSnapshot.data() : null
      const configReference = db.doc('system/eat_clean_config')
      const configSnapshot = await transaction.get(configReference)
      const config = normalizeStoredConfig(configSnapshot.exists ? configSnapshot.data() : {})
      if (!config.enabled || !config.acceptingOrders) {
        throw new HttpsError('failed-precondition', 'Eat Clean hiện chưa nhận đơn mới.')
      }
      const submittedRequest = normalizeOrderRequest(request.data, config)
      let normalized = submittedRequest
      if (config.distancePricing.enabled) {
        const submittedRequestHash = canonicalOrderRequestHash(submittedRequest)
        if (!quoteRecord?.originalRequestHash || quoteRecord.originalRequestHash !== submittedRequestHash) {
          throw new HttpsError('failed-precondition', 'Địa chỉ hoặc thông tin đơn hàng đã thay đổi sau khi Google xác minh.')
        }
        if (!quoteRecord.verifiedCustomer || typeof quoteRecord.verifiedCustomer !== 'object') {
          throw new HttpsError('failed-precondition', 'Báo giá chưa có địa chỉ Google đã xác minh.')
        }
        const verifiedCustomer = {
          ...normalizeCustomer(quoteRecord.verifiedCustomer),
          addressVerifiedAt: boundedString(quoteRecord.verifiedCustomer.addressVerifiedAt, 'Thời gian xác minh địa chỉ', 40),
          addressProvider: boundedString(quoteRecord.verifiedCustomer.addressProvider, 'Nguồn xác minh địa chỉ', 40),
        }
        normalized = { ...submittedRequest, customer: verifiedCustomer }
      }
      const mealReferences = normalized.items.map((item) => db.doc(`eatCleanMeals/${item.mealId}`))
      const inventoryReferences = normalized.items.map((item) => db.doc(`eatCleanInventory/${inventoryDocumentId(normalized.serviceDate, item.mealId)}`))
      const mealSnapshots = []
      const inventorySnapshots = []
      for (const reference of mealReferences) mealSnapshots.push(await transaction.get(reference))
      for (const reference of inventoryReferences) inventorySnapshots.push(await transaction.get(reference))
      const mealRecords = new Map(mealSnapshots.filter((item) => item.exists).map((item) => [item.id, { id: item.id, ...item.data() }]))
      const inventoryRecords = new Map(inventorySnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]))
      const storedRoute = quoteRecord?.deliveryRoute || null
      if (config.distancePricing.enabled && !storedRoute) {
        throw new HttpsError('failed-precondition', 'Báo giá chưa có tuyến giao hàng hợp lệ.')
      }
      const quotedAtMillis = timestampMillis(quoteRecord?.quotedAt || quoteRecord?.createdAt)
      const quote = calculateQuote({
        config,
        request: normalized,
        mealRecords,
        inventoryRecords,
        route: storedRoute,
        now: Number.isFinite(quotedAtMillis) ? new Date(quotedAtMillis) : now,
      })
      const normalizedRequestHash = canonicalOrderRequestHash(normalized)
      const currentQuoteHash = quoteSnapshotHash(quote)
      validateQuoteRecord({
        quoteRecord,
        userId,
        requestHash: normalizedRequestHash,
        quoteHash: currentQuoteHash,
        now,
      })

      quote.items.forEach((item) => {
        if (!item.inventoryTracked) return
        const inventoryReference = db.doc(`eatCleanInventory/${item.inventoryId}`)
        const current = inventoryRecords.get(item.inventoryId) || {}
        transaction.set(inventoryReference, {
          mealId: item.mealId,
          serviceDate: normalized.serviceDate,
          capacity: current.capacity || 0,
          reserved: (current.reserved || 0) + item.quantity,
          sold: current.sold || 0,
          active: current.active !== false,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      })

      const orderCode = `EC-${now.toISOString().slice(2, 10).replace(/-/g, '')}-${orderReference.id.slice(-6).toUpperCase()}`
      const storedOrder = {
        schemaVersion: SCHEMA_VERSION,
        id: orderReference.id,
        code: orderCode,
        userId,
        status: 'pending_confirmation',
        paymentMethod: PAYMENT_METHOD,
        paymentStatus: 'unpaid',
        customer: normalized.customer,
        city: CITY_NAME,
        serviceDate: normalized.serviceDate,
        deliveryMode: normalized.deliveryMode,
        deliverySlotId: normalized.deliverySlot.id,
        deliverySlotLabel: normalized.deliverySlot.label,
        deliverySlot: normalized.deliverySlot,
        deliveryZone: normalized.deliveryZone,
        deliveryRoute: quote.deliveryRoute,
        feeRuleVersion: quote.feeRuleVersion,
        eta: quote.eta,
        note: normalized.note,
        items: quote.items,
        subtotal: quote.subtotal,
        baseDeliveryFee: quote.baseDeliveryFee,
        deliveryDiscount: quote.deliveryDiscount,
        deliveryFee: quote.deliveryFee,
        discount: 0,
        total: quote.total,
        currency: CURRENCY,
        nutrition: quote.nutrition,
        commercialSnapshot: {
          schemaVersion: SCHEMA_VERSION,
          items: quote.items.map((item) => ({
            mealId: item.mealId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            calories: item.calories,
            protein: item.protein,
            carbs: item.carbs,
            fat: item.fat,
            fiber: item.fiber,
          })),
          pricing: {
            subtotal: quote.subtotal,
            baseDeliveryFee: quote.baseDeliveryFee,
            deliveryDiscount: quote.deliveryDiscount,
            deliveryFee: quote.deliveryFee,
            total: quote.total,
            currency: CURRENCY,
          },
          nutrition: quote.nutrition,
          quoteHash: currentQuoteHash,
          capturedAt: Timestamp.fromDate(now),
        },
        quoteId,
        quoteHash: currentQuoteHash,
        consumedItemIds: [],
        consumptions: [],
        idempotencyHash: markerReference.id,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }
      transaction.create(orderReference, storedOrder)
      transaction.create(deliveryReference, {
        schemaVersion: SCHEMA_VERSION,
        id: deliveryReference.id,
        orderId: orderReference.id,
        orderCode,
        userId,
        status: 'awaiting_kitchen',
        shipperId: null,
        pickup: config.store,
        destination: normalized.customer,
        route: quote.deliveryRoute,
        eta: quote.eta,
        promisedAt: quote.eta?.promisedAt ? Timestamp.fromDate(new Date(quote.eta.promisedAt)) : null,
        assignedAt: null,
        acceptedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.update(quoteReference, {
        status: 'consumed',
        orderId: orderReference.id,
        idempotencyHash: markerReference.id,
        usedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(markerReference, {
        schemaVersion: SCHEMA_VERSION,
        userId,
        orderId: orderReference.id,
        requestHash,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      })
      return {
        order: { ...serializeValue(storedOrder), createdAt: now.toISOString(), updatedAt: now.toISOString() },
        idempotent: false,
      }
    })
    logger.info('Eat Clean order created', { orderId: result.order.id, userId, idempotent: result.idempotent })
    return result
  })

  const listMyEatCleanOrders = onCall(callableOptions, async (request) => {
    const userId = requireUser(request)
    const limit = finiteInteger(request.data?.limit ?? 30, 'Số đơn cần tải', 1, 50)
    const [snapshot, config] = await Promise.all([
      db.collection('eatCleanOrders')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get(),
      readConfig(db),
    ])
    const deliverySnapshots = snapshot.empty
      ? []
      : await db.getAll(...snapshot.docs.map((item) => db.doc(`eatCleanDeliveries/${item.id}`)))
    const deliveries = new Map(deliverySnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]))
    const orders = snapshot.docs.map((item) => {
      const order = { id: item.id, ...serializeValue(item.data()) }
      const delivery = deliveries.get(item.id)
      return {
        ...order,
        canCancel: canCustomerCancelOrder(order, config),
        cancellationPolicy: ORDER_CANCELLATION_POLICY[order.status] || null,
        trackingSummary: delivery ? {
          status: delivery.status,
          shipperId: delivery.shipperId || null,
          estimatedDeliveryAt: serializeValue(delivery.eta?.estimatedDeliveryAt || null),
          promisedAt: serializeValue(delivery.promisedAt || delivery.eta?.promisedAt || null),
        } : null,
      }
    })
    return { schemaVersion: SCHEMA_VERSION, orders }
  })

  const cancelEatCleanOrder = onCall(writeOptions, async (request) => {
    const userId = requireUser(request)
    const orderId = documentId(request.data?.orderId, 'Mã đơn hàng')
    const reason = boundedString(request.data?.reason, 'Lý do hủy', 300, { required: false })
    const orderReference = db.doc(`eatCleanOrders/${orderId}`)
    const deliveryReference = db.doc(`eatCleanDeliveries/${orderId}`)
    const result = await db.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderReference)
      if (!orderSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy đơn Eat Clean.')
      const order = orderSnapshot.data()
      if (order.userId !== userId) throw new HttpsError('permission-denied', 'Bạn không có quyền hủy đơn này.')
      if (order.status === 'cancelled') {
        return { order: { id: orderId, ...serializeValue(order), canCancel: false }, idempotent: true }
      }
      const cancellationPolicy = cancellationPolicyFor(order.status, 'customer')
      const configSnapshot = await transaction.get(db.doc('system/eat_clean_config'))
      const deliverySnapshot = await transaction.get(deliveryReference)
      const config = normalizeStoredConfig(configSnapshot.exists ? configSnapshot.data() : {})
      ensureCustomerCancellationWindow(order, config)
      const inventorySnapshots = []
      const trackedItems = (order.items || []).filter((item) => item.inventoryTracked !== false)
      for (const item of trackedItems) {
        inventorySnapshots.push(await transaction.get(db.doc(`eatCleanInventory/${item.inventoryId}`)))
      }
      const refundReference = paidOrder(order) ? db.doc(`eatCleanRefundJobs/${orderId}`) : null
      const refundSnapshot = refundReference ? await transaction.get(refundReference) : null
      trackedItems.forEach((item, index) => {
        const snapshot = inventorySnapshots[index]
        if (!snapshot.exists) return
        const inventory = snapshot.data()
        transaction.set(snapshot.ref, {
          reserved: Math.max(0, (inventory.reserved || 0) - item.quantity),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      })
      transaction.update(orderReference, {
        status: 'cancelled',
        cancellationReason: reason,
        cancellationPolicy: {
          actorType: 'customer',
          refundMode: cancellationPolicy.refundMode,
          kitchenWasteReview: cancellationPolicy.kitchenWasteReview,
        },
        cancelledBy: userId,
        cancelledAt: FieldValue.serverTimestamp(),
        refundStatus: refundReference ? 'review_required' : 'not_applicable',
        updatedAt: FieldValue.serverTimestamp(),
      })
      if (refundReference && !refundSnapshot?.exists) {
        transaction.create(refundReference, refundJobForOrder(order, {
          orderId,
          reason: reason || 'customer_cancelled',
          requestedBy: userId,
          policy: cancellationPolicy,
        }))
      }
      if (deliverySnapshot.exists && deliverySnapshot.data().status !== 'delivered') {
        transaction.set(deliveryReference, {
          status: 'cancelled',
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      const nowIso = new Date().toISOString()
      return {
        order: {
          id: orderId,
          ...serializeValue(order),
          status: 'cancelled',
          cancellationReason: reason,
          cancellationPolicy: {
            actorType: 'customer',
            refundMode: cancellationPolicy.refundMode,
            kitchenWasteReview: cancellationPolicy.kitchenWasteReview,
          },
          cancelledBy: userId,
          cancelledAt: nowIso,
          refundStatus: refundReference ? 'review_required' : 'not_applicable',
          updatedAt: nowIso,
          canCancel: false,
        },
        idempotent: false,
      }
    })
    const realtimeMirror = await bestEffortRealtimeWrite({
      realtimeDb,
      path: `eatCleanLiveLocations/${orderId}`,
      write: (reference) => reference.update({ active: false, updatedAt: Date.now() }),
      logger,
      context: { operation: 'customer_cancel', orderId, userId },
    })
    logger.info('Eat Clean order cancelled by customer', { orderId, userId, idempotent: result.idempotent })
    return { ...result, realtimeMirror }
  })

  // This callable never talks to a payment provider. It only records an
  // externally verified/manual resolution with an immutable idempotent event.
  // Online payment remains fail-closed until a real provider adapter exists.
  const recordEatCleanRefundOutcome = onCall(writeOptions, async (request) => {
    const actorId = await trustedAdminId(request)
    const orderId = documentId(request.data?.orderId, 'Mã đơn hàng')
    const outcome = request.data?.outcome === 'refunded' ? 'refunded'
      : request.data?.outcome === 'rejected' ? 'rejected'
        : ''
    if (!outcome) throw new HttpsError('invalid-argument', 'Kết quả hoàn tiền không hợp lệ.')
    const idempotencyKey = boundedString(request.data?.idempotencyKey, 'Khóa chống ghi trùng', 128)
    if (idempotencyKey.length < 8) throw new HttpsError('invalid-argument', 'Khóa chống ghi trùng quá ngắn.')
    const externalReference = boundedString(request.data?.externalReference, 'Mã đối soát ngoài hệ thống', 160, { required: false })
    const note = boundedString(request.data?.note, 'Ghi chú hoàn tiền', 500, { required: false })
    if (outcome === 'refunded' && (request.data?.confirmedExternally !== true || externalReference.length < 4)) {
      throw new HttpsError('failed-precondition', 'Chỉ ghi nhận đã hoàn tiền sau khi có mã đối soát và xác nhận giao dịch ngoài hệ thống.')
    }
    if (outcome === 'rejected' && note.length < 4) {
      throw new HttpsError('invalid-argument', 'Cần ghi rõ lý do từ chối hoàn tiền.')
    }
    const orderReference = db.doc(`eatCleanOrders/${orderId}`)
    const refundReference = db.doc(`eatCleanRefundJobs/${orderId}`)
    const adjustmentReference = db.doc(`eatCleanPaymentAdjustments/${digest(`${orderId}:${idempotencyKey}`)}`)
    const result = await db.runTransaction(async (transaction) => {
      const [orderSnapshot, refundSnapshot, adjustmentSnapshot] = await Promise.all([
        transaction.get(orderReference),
        transaction.get(refundReference),
        transaction.get(adjustmentReference),
      ])
      if (!orderSnapshot.exists || !refundSnapshot.exists) {
        throw new HttpsError('not-found', 'Không tìm thấy yêu cầu hoàn tiền của đơn này.')
      }
      const order = orderSnapshot.data()
      const refund = refundSnapshot.data()
      if (order.status !== 'cancelled') throw new HttpsError('failed-precondition', 'Chỉ xử lý hoàn tiền cho đơn đã hủy.')
      if (adjustmentSnapshot.exists) {
        const existing = adjustmentSnapshot.data()
        if (existing.orderId !== orderId || existing.outcome !== outcome || (existing.externalReference || '') !== externalReference) {
          throw new HttpsError('already-exists', 'Khóa chống ghi trùng đã được dùng cho kết quả khác.')
        }
        return { idempotent: true, orderId, outcome, adjustmentId: adjustmentReference.id }
      }
      if (refund.status === 'refunded' || refund.status === 'rejected') {
        throw new HttpsError('failed-precondition', 'Yêu cầu hoàn tiền đã được chốt trước đó.')
      }
      const amount = Math.max(0, Number(refund.amount || order.total || 0))
      transaction.create(adjustmentReference, {
        schemaVersion: SCHEMA_VERSION,
        type: outcome === 'refunded' ? 'refund_recorded' : 'refund_rejected',
        outcome,
        orderId,
        userId: order.userId || '',
        amount,
        currency: order.currency || CURRENCY,
        paymentMethod: refund.paymentMethod || order.paymentMethod || PAYMENT_METHOD,
        paymentProvider: refund.paymentProvider || null,
        externalReference: externalReference || null,
        note,
        idempotencyHash: adjustmentReference.id,
        recordedBy: actorId,
        recordedAt: FieldValue.serverTimestamp(),
      })
      transaction.update(refundReference, {
        status: outcome,
        adjustmentId: adjustmentReference.id,
        externalReference: externalReference || null,
        resolutionNote: note,
        resolvedBy: actorId,
        resolvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.update(orderReference, {
        refundStatus: outcome === 'refunded' ? 'completed' : 'rejected',
        ...(outcome === 'refunded' ? { paymentStatus: 'refunded' } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      })
      transaction.create(orderReference.collection('events').doc(), {
        type: 'refund_resolved',
        actorId,
        outcome,
        amount,
        adjustmentId: adjustmentReference.id,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { idempotent: false, orderId, outcome, adjustmentId: adjustmentReference.id }
    })
    logger.info('Eat Clean refund outcome recorded', { orderId, actorId, outcome, idempotent: result.idempotent })
    return result
  })

  const reverseEatCleanRefundOutcome = onCall(writeOptions, async (request) => {
    const actorId = await trustedAdminId(request)
    const orderId = documentId(request.data?.orderId, 'Mã đơn hàng')
    const originalAdjustmentId = documentId(request.data?.adjustmentId, 'Mã bút toán hoàn tiền')
    const idempotencyKey = boundedString(request.data?.idempotencyKey, 'Khóa chống ghi trùng', 128)
    const externalReference = boundedString(request.data?.externalReference, 'Mã đối soát đảo giao dịch', 160)
    const reason = boundedString(request.data?.reason, 'Lý do đảo hoàn tiền', 500)
    if (idempotencyKey.length < 8) throw new HttpsError('invalid-argument', 'Khóa chống ghi trùng quá ngắn.')
    if (externalReference.length < 4 || request.data?.confirmedExternally !== true) {
      throw new HttpsError('failed-precondition', 'Chỉ ghi nhận đảo hoàn tiền sau khi có mã đối soát và xác nhận ngoài hệ thống.')
    }
    const orderReference = db.doc(`eatCleanOrders/${orderId}`)
    const refundReference = db.doc(`eatCleanRefundJobs/${orderId}`)
    const originalReference = db.doc(`eatCleanPaymentAdjustments/${originalAdjustmentId}`)
    const reversalReference = db.doc(`eatCleanPaymentAdjustments/${digest(`${orderId}:reversal:${idempotencyKey}`)}`)
    const result = await db.runTransaction(async (transaction) => {
      const [orderSnapshot, refundSnapshot, originalSnapshot, reversalSnapshot] = await Promise.all([
        transaction.get(orderReference),
        transaction.get(refundReference),
        transaction.get(originalReference),
        transaction.get(reversalReference),
      ])
      if (!orderSnapshot.exists || !refundSnapshot.exists || !originalSnapshot.exists) {
        throw new HttpsError('not-found', 'Không tìm thấy giao dịch hoàn tiền cần đảo.')
      }
      const original = originalSnapshot.data()
      if (original.orderId !== orderId || original.type !== 'refund_recorded') {
        throw new HttpsError('failed-precondition', 'Bút toán được chọn không phải hoàn tiền của đơn này.')
      }
      if (reversalSnapshot.exists) {
        const existing = reversalSnapshot.data()
        if (existing.reversedAdjustmentId !== originalAdjustmentId || existing.externalReference !== externalReference) {
          throw new HttpsError('already-exists', 'Khóa chống ghi trùng đã được dùng cho giao dịch đảo khác.')
        }
        return { idempotent: true, orderId, adjustmentId: reversalReference.id }
      }
      const priorReversalSnapshot = await transaction.get(
        db.collection('eatCleanPaymentAdjustments')
          .where('reversedAdjustmentId', '==', originalAdjustmentId)
          .limit(1),
      )
      if (!priorReversalSnapshot.empty) throw new HttpsError('failed-precondition', 'Bút toán hoàn tiền đã được đảo trước đó.')
      transaction.create(reversalReference, {
        schemaVersion: SCHEMA_VERSION,
        type: 'refund_reversal',
        outcome: 'reversed',
        orderId,
        userId: original.userId || orderSnapshot.data().userId || '',
        amount: Math.max(0, Number(original.amount) || 0),
        currency: original.currency || CURRENCY,
        paymentMethod: original.paymentMethod || null,
        paymentProvider: original.paymentProvider || null,
        externalReference,
        reason,
        reversedAdjustmentId: originalAdjustmentId,
        idempotencyHash: reversalReference.id,
        recordedBy: actorId,
        recordedAt: FieldValue.serverTimestamp(),
      })
      transaction.update(refundReference, {
        status: REFUND_JOB_STATUSES.MANUAL_REVIEW,
        reversalAdjustmentId: reversalReference.id,
        reversalReason: reason,
        reversedAt: FieldValue.serverTimestamp(),
        reversedBy: actorId,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.update(orderReference, {
        paymentStatus: 'paid',
        refundStatus: 'reversal_recorded',
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      })
      transaction.create(orderReference.collection('events').doc(), {
        type: 'refund_reversed',
        actorId,
        adjustmentId: reversalReference.id,
        reversedAdjustmentId: originalAdjustmentId,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { idempotent: false, orderId, adjustmentId: reversalReference.id }
    })
    logger.info('Eat Clean refund reversal recorded', { orderId, actorId, idempotent: result.idempotent })
    return result
  })

  const confirmEatCleanConsumption = onCall(writeOptions, async (request) => {
    const userId = requireUser(request)
    const orderId = documentId(request.data?.orderId, 'Mã đơn hàng')
    const selectedIds = cleanStringList(request.data?.itemIds, 'Món đã dùng', 20, 160)
    const globalRatio = normalizedConsumedRatio(request.data?.consumedRatio)
    const perItemInput = request.data?.itemConsumptions
    if (perItemInput !== undefined && (!Array.isArray(perItemInput) || !perItemInput.length || perItemInput.length > 20)) {
      throw new HttpsError('invalid-argument', 'Danh sách khẩu phần đã dùng không hợp lệ.')
    }
    const requestedMealType = MEAL_CATEGORIES.has(request.data?.mealType) ? request.data.mealType : ''
    const consumedAt = request.data?.consumedAt ? new Date(request.data.consumedAt) : new Date()
    if (!Number.isFinite(consumedAt.getTime()) || consumedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new HttpsError('invalid-argument', 'Thời gian dùng bữa không hợp lệ.')
    }
    const orderReference = db.doc(`eatCleanOrders/${orderId}`)
    const result = await db.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderReference)
      if (!orderSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy đơn Eat Clean.')
      const order = orderSnapshot.data()
      if (order.userId !== userId) throw new HttpsError('permission-denied', 'Bạn không có quyền xác nhận đơn này.')
      if (order.status !== 'delivered') {
        throw new HttpsError('failed-precondition', 'Chỉ có thể ghi dinh dưỡng sau khi đơn đã giao.')
      }
      const orderItems = order.items || []
      const orderItemMap = new Map(orderItems.map((item) => [item.id || item.mealId, item]))
      const requestedConsumptions = perItemInput
        ? perItemInput.map((entry, index) => {
          if (!entry || typeof entry !== 'object') throw new HttpsError('invalid-argument', `Khẩu phần ${index + 1} không hợp lệ.`)
          return {
            itemId: documentId(entry.itemId || entry.mealId, `Mã món ${index + 1}`),
            ratio: normalizedConsumedRatio(entry.consumedRatio, `Tỷ lệ khẩu phần ${index + 1}`),
          }
        })
        : (selectedIds.length ? selectedIds : orderItems.map((item) => item.id || item.mealId))
          .map((itemId) => ({ itemId, ratio: globalRatio }))
      if (new Set(requestedConsumptions.map((item) => item.itemId)).size !== requestedConsumptions.length) {
        throw new HttpsError('invalid-argument', 'Một món không thể xuất hiện hai lần trong cùng lần xác nhận.')
      }
      requestedConsumptions.forEach(({ itemId }) => {
        if (!orderItemMap.has(itemId)) throw new HttpsError('invalid-argument', `Món ${itemId} không thuộc đơn hàng.`)
      })
      const existingConsumptions = new Map(
        (Array.isArray(order.consumptions) ? order.consumptions : [])
          .filter((item) => item && typeof item.itemId === 'string')
          .map((item) => [item.itemId, { itemId: item.itemId, ratio: Number(item.ratio) || 1, logId: item.logId || '' }]),
      )
      ;(Array.isArray(order.consumedItemIds) ? order.consumedItemIds : []).forEach((itemId) => {
        if (!existingConsumptions.has(itemId)) existingConsumptions.set(itemId, { itemId, ratio: 1, logId: `eat-clean-${orderId}-${itemId}` })
      })
      requestedConsumptions.forEach(({ itemId, ratio }) => {
        const existing = existingConsumptions.get(itemId)
        if (existing && existing.ratio !== ratio) {
          throw new HttpsError('failed-precondition', `Khẩu phần của ${orderItemMap.get(itemId).name} đã được chốt ở mức ${Math.round(existing.ratio * 100)}%.`)
        }
      })
      const pendingItems = requestedConsumptions
        .filter(({ itemId }) => !existingConsumptions.has(itemId))
        .map(({ itemId, ratio }) => ({ item: orderItemMap.get(itemId), itemId, ratio }))
      const logSnapshots = []
      for (const { itemId } of pendingItems) {
        logSnapshots.push(await transaction.get(db.doc(`users/${userId}/mealLogs/eat-clean-${orderId}-${itemId}`)))
      }
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(consumedAt)
      const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(consumedAt)
      let createdLogs = 0
      pendingItems.forEach(({ item, itemId, ratio }, index) => {
        if (logSnapshots[index].exists) {
          const existingRatio = Number(logSnapshots[index].data()?.consumedRatio) || 1
          if (existingRatio !== ratio) {
            throw new HttpsError('failed-precondition', `Nhật ký ${item.name} đã tồn tại với khẩu phần khác.`)
          }
          existingConsumptions.set(itemId, { itemId, ratio, logId: logSnapshots[index].id })
          return
        }
        const type = requestedMealType || (MEAL_CATEGORIES.has(item.category) ? item.category : 'lunch')
        transaction.create(logSnapshots[index].ref, {
          id: logSnapshots[index].id,
          orderId,
          orderCode: order.code,
          eatCleanMealId: item.mealId,
          consumedRatio: ratio,
          date,
          time,
          type,
          label: type === 'breakfast' ? 'Bữa sáng' : type === 'dinner' ? 'Bữa tối' : type === 'snack' ? 'Bữa phụ' : 'Bữa trưa',
          title: item.name,
          description: `${Math.round(ratio * 100)}% của ${item.quantity} suất Eat Clean · đơn ${order.code}`,
          calories: scaledNutrition(item.calories, ratio),
          protein: scaledNutrition(item.protein, ratio),
          carbs: scaledNutrition(item.carbs, ratio),
          fat: scaledNutrition(item.fat, ratio),
          fiber: scaledNutrition(item.fiber, ratio),
          status: 'logged',
          tone: 'green',
          image: item.imageUrl || '',
          source: 'eat-clean',
          confidence: 'verified',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        createdLogs += 1
        existingConsumptions.set(itemId, { itemId, ratio, logId: logSnapshots[index].id })
      })
      const allItemIds = new Set(orderItems.map((item) => item.id || item.mealId))
      const fullyConfirmed = [...allItemIds].every((itemId) => existingConsumptions.has(itemId))
      const consumptions = [...existingConsumptions.values()]
      transaction.update(orderReference, {
        consumedItemIds: consumptions.map((item) => item.itemId),
        consumptions,
        consumptionStatus: fullyConfirmed ? 'confirmed' : 'partial',
        consumptionConfirmedAt: fullyConfirmed ? FieldValue.serverTimestamp() : order.consumptionConfirmedAt || null,
        updatedAt: FieldValue.serverTimestamp(),
      })
      const nowIso = new Date().toISOString()
      return {
        order: {
          id: orderId,
          ...serializeValue(order),
          consumedItemIds: consumptions.map((item) => item.itemId),
          consumptions,
          consumptionStatus: fullyConfirmed ? 'confirmed' : 'partial',
          consumptionConfirmedAt: fullyConfirmed
            ? nowIso
            : serializeValue(order.consumptionConfirmedAt),
          updatedAt: nowIso,
        },
        createdLogs,
        consumptions,
        fullyConfirmed,
      }
    })
    logger.info('Eat Clean consumption confirmed', { orderId, userId, createdLogs: result.createdLogs })
    return result
  })

  const saveEatCleanMeal = onCall(writeOptions, async (request) => {
    const actorId = await trustedAdminId(request)
    const input = normalizeMealInput(request.data?.meal || request.data)
    const expectedRevision = finiteInteger(request.data?.expectedRevision ?? request.data?.meal?.revision ?? 0, 'Phiên bản món', 0, 1000000)
    const reference = db.doc(`eatCleanMeals/${input.id}`)
    const saved = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      const current = snapshot.data() || {}
      const currentRevision = Number.isInteger(current.revision) ? current.revision : 0
      if ((snapshot.exists && currentRevision !== expectedRevision) || (!snapshot.exists && expectedRevision !== 0)) {
        throw new HttpsError('aborted', 'Món ăn đã được cập nhật ở nơi khác. Hãy tải lại trước khi lưu.')
      }
      const next = {
        ...input,
        revision: currentRevision + 1,
        createdAt: snapshot.exists ? current.createdAt : FieldValue.serverTimestamp(),
        createdBy: snapshot.exists ? current.createdBy || actorId : actorId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      }
      transaction.set(reference, next)
      const nutritionAfter = {
        calories: input.calories,
        protein: input.protein,
        carbs: input.carbs,
        fat: input.fat,
        fiber: input.fiber,
        servingGrams: input.servingGrams,
      }
      const nutritionBefore = {
        calories: current.calories ?? null,
        protein: current.protein ?? null,
        carbs: current.carbs ?? null,
        fat: current.fat ?? null,
        fiber: current.fiber ?? null,
        servingGrams: current.servingGrams ?? null,
      }
      const commercialSnapshot = JSON.stringify({ basePrice: input.basePrice, nutrition: nutritionAfter })
      const previousCommercialSnapshot = JSON.stringify({ basePrice: current.basePrice ?? null, nutrition: nutritionBefore })
      if (!snapshot.exists || commercialSnapshot !== previousCommercialSnapshot) {
        transaction.create(db.collection('eatCleanMealRevisions').doc(), {
          schemaVersion: SCHEMA_VERSION,
          mealId: input.id,
          revision: currentRevision + 1,
          before: snapshot.exists ? { basePrice: current.basePrice ?? null, nutrition: nutritionBefore } : null,
          after: { basePrice: input.basePrice, nutrition: nutritionAfter },
          changedBy: actorId,
          changedAt: FieldValue.serverTimestamp(),
        })
      }
      return { ...serializeValue(next), createdAt: serializeValue(current.createdAt) || new Date().toISOString(), updatedAt: new Date().toISOString() }
    })
    return { meal: saved }
  })

  const saveEatCleanInventory = onCall(writeOptions, async (request) => {
    const actorId = await trustedAdminId(request)
    const mealId = documentId(request.data?.mealId, 'Mã món')
    const serviceDate = dateKey(request.data?.serviceDate)
    const capacity = finiteInteger(request.data?.capacity, 'Sức chứa', 0, 100000)
    const expectedRevision = finiteInteger(request.data?.expectedRevision ?? 0, 'Phiên bản tồn kho', 0, 1000000)
    const reference = db.doc(`eatCleanInventory/${inventoryDocumentId(serviceDate, mealId)}`)
    const result = await db.runTransaction(async (transaction) => {
      const mealSnapshot = await transaction.get(db.doc(`eatCleanMeals/${mealId}`))
      if (!mealSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy món Eat Clean.')
      const snapshot = await transaction.get(reference)
      const current = snapshot.data() || {}
      const currentRevision = Number.isInteger(current.revision) ? current.revision : 0
      if ((snapshot.exists && currentRevision !== expectedRevision) || (!snapshot.exists && expectedRevision !== 0)) {
        throw new HttpsError('aborted', 'Tồn kho đã được cập nhật ở nơi khác. Hãy tải lại.')
      }
      const committed = (current.reserved || 0) + (current.sold || 0)
      if (capacity < committed) {
        throw new HttpsError('failed-precondition', `Sức chứa không thể thấp hơn ${committed} suất đã giữ/đã bán.`)
      }
      const next = {
        schemaVersion: SCHEMA_VERSION,
        id: reference.id,
        mealId,
        serviceDate,
        capacity,
        reserved: current.reserved || 0,
        sold: current.sold || 0,
        active: request.data?.active !== false,
        revision: currentRevision + 1,
        createdAt: snapshot.exists ? current.createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      }
      transaction.set(reference, next)
      return { ...serializeValue(next), available: capacity - next.reserved - next.sold, updatedAt: new Date().toISOString() }
    })
    return { inventory: result }
  })

  const saveEatCleanConfig = onCall(deliveryOperationsWriteOptions, async (request) => {
    const actorId = await trustedAdminId(request)
    const input = normalizeEatCleanConfig(request.data?.config || request.data)
    const readiness = assertDeliveryConfigCanActivate(input, realtimeDb)
    const expectedRevision = finiteInteger(request.data?.expectedRevision ?? request.data?.config?.revision ?? 0, 'Phiên bản cấu hình', 0, 1000000)
    const reference = db.doc('system/eat_clean_config')
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      const current = snapshot.data() || {}
      const currentRevision = Number.isInteger(current.revision) ? current.revision : 0
      if ((snapshot.exists && currentRevision !== expectedRevision) || (!snapshot.exists && expectedRevision !== 0)) {
        throw new HttpsError('aborted', 'Cấu hình đã được cập nhật ở nơi khác. Hãy tải lại.')
      }
      const next = {
        ...input,
        revision: currentRevision + 1,
        createdAt: snapshot.exists ? current.createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      }
      transaction.set(reference, next)
      return { ...serializeValue(next), updatedAt: new Date().toISOString() }
    })
    return { config: result, readiness }
  })

  const initializeEatCleanCatalog = onCall(writeOptions, async (request) => {
    const actorId = await trustedAdminId(request)
    const defaultDailyCapacity = finiteInteger(request.data?.defaultDailyCapacity ?? 20, 'Sức chứa mẫu mỗi ngày', 1, 1000)
    const configReference = db.doc('system/eat_clean_config')
    const mealReferences = DEFAULT_EAT_CLEAN_MEALS.map((meal) => db.doc(`eatCleanMeals/${meal.id}`))
    const serviceDates = Array.from({ length: 14 }, (_, index) => addUtcDays(todayInVietnam(), index + 1))
    const inventoryReferences = serviceDates.flatMap((serviceDate) => DEFAULT_EAT_CLEAN_MEALS.map((meal) => (
      db.doc(`eatCleanInventory/${inventoryDocumentId(serviceDate, meal.id)}`)
    )))
    const result = await db.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(configReference, ...mealReferences, ...inventoryReferences)
      const configSnapshot = snapshots[0]
      const mealSnapshots = snapshots.slice(1, 1 + mealReferences.length)
      const inventorySnapshots = snapshots.slice(1 + mealReferences.length)
      let configCreated = false
      if (!configSnapshot.exists) {
        transaction.create(configReference, {
          ...normalizeEatCleanConfig({}),
          revision: 1,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorId,
        })
        configCreated = true
      }
      let createdMeals = 0
      mealSnapshots.forEach((snapshot, index) => {
        if (snapshot.exists) return
        const meal = normalizeMealInput(DEFAULT_EAT_CLEAN_MEALS[index])
        transaction.create(snapshot.ref, {
          ...meal,
          revision: 1,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actorId,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorId,
        })
        createdMeals += 1
      })
      let createdInventory = 0
      inventorySnapshots.forEach((snapshot, index) => {
        if (snapshot.exists) return
        const serviceDateIndex = Math.floor(index / DEFAULT_EAT_CLEAN_MEALS.length)
        const mealIndex = index % DEFAULT_EAT_CLEAN_MEALS.length
        transaction.create(snapshot.ref, {
          schemaVersion: SCHEMA_VERSION,
          id: snapshot.id,
          mealId: DEFAULT_EAT_CLEAN_MEALS[mealIndex].id,
          serviceDate: serviceDates[serviceDateIndex],
          capacity: defaultDailyCapacity,
          reserved: 0,
          sold: 0,
          active: true,
          revision: 1,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorId,
        })
        createdInventory += 1
      })
      return {
        configCreated,
        createdMeals,
        skippedMeals: mealSnapshots.length - createdMeals,
        createdInventory,
        skippedInventory: inventorySnapshots.length - createdInventory,
        inventoryFrom: serviceDates[0],
        inventoryTo: serviceDates[serviceDates.length - 1],
        acceptingOrders: false,
      }
    })
    logger.info('Eat Clean catalog initialized', { actorId, ...result })
    return result
  })

  const setEatCleanShipperAvailability = onCall(writeOptions, async (request) => {
    const { actorId, profile } = await trustedShipper(request, { allowAdmin: false })
    const available = request.data?.available === true
    const reference = db.doc(`eatCleanShippers/${actorId}`)
    const activeJobCount = await countActiveDeliveryJobs(db.collection('eatCleanDeliveries'), actorId)
    const next = {
      schemaVersion: SCHEMA_VERSION,
      userId: actorId,
      displayName: boundedString(profile.displayName ?? 'Shipper Aura', 'Tên shipper', 100),
      available,
      activeJobCount,
      lastSeenAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    await reference.set(next, { merge: true })
    return { shipper: { ...serializeValue(next), updatedAt: new Date().toISOString() } }
  })

  const saveEatCleanDeliveryConfig = onCall(deliveryOperationsWriteOptions, async (request) => {
    const actorId = await trustedAdminId(request)
    const reference = db.doc('system/eat_clean_config')
    const expectedRevision = finiteInteger(request.data?.expectedRevision ?? 0, 'Phiên bản cấu hình', 0, 1000000)
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      const current = snapshot.exists ? snapshot.data() : {}
      const currentRevision = Number(current.revision) || 0
      if (currentRevision !== expectedRevision) {
        throw new HttpsError('aborted', 'Cấu hình giao hàng đã thay đổi. Hãy tải lại trước khi lưu.')
      }
      const patch = request.data?.config || request.data || {}
      const merged = normalizeEatCleanConfig({
        ...current,
        asapEnabled: patch.asapEnabled ?? current.asapEnabled,
        store: patch.store ?? current.store,
        distancePricing: patch.distancePricing ?? current.distancePricing,
        sla: patch.sla ?? current.sla,
        freeDeliveryThreshold: patch.freeDeliveryThreshold ?? current.freeDeliveryThreshold,
        supportPhone: patch.supportPhone ?? current.supportPhone,
      })
      assertDeliveryConfigCanActivate(merged, realtimeDb)
      const next = {
        ...merged,
        revision: currentRevision + 1,
        createdAt: current.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      }
      transaction.set(reference, next)
      return { ...serializeValue(next), updatedAt: new Date().toISOString() }
    })
    return { config: result, readiness: deliveryRuntimeReadiness(result, realtimeDb) }
  })

  const listEatCleanDispatchData = onCall(deliveryOperationsCallableOptions, async (request) => {
    await trustedAdminId(request)
    const limit = finiteInteger(request.data?.limit ?? 100, 'Giới hạn dữ liệu', 1, 200)
    const cursor = normalizeDeliveryCursor(request.data?.cursor)
    const deliveryCollection = db.collection('eatCleanDeliveries')
    const deliveriesQuery = buildActiveDeliveriesQuery(deliveryCollection, { cursor, limit })
    const [deliveriesSnapshot, shipperProfilesSnapshot, availabilitySnapshot, configSnapshot, operationalSignalSnapshot, totalActive] = await Promise.all([
      deliveriesQuery.get(),
      db.collection('users').where('role', '==', 'shipper').limit(100).get(),
      db.collection('eatCleanShippers').limit(100).get(),
      db.doc('system/eat_clean_config').get(),
      db.doc(`eatCleanOperationalSignals/${operationalSignalDocumentId()}`).get(),
      countActiveDeliveryJobs(deliveryCollection),
    ])
    const orderSnapshots = deliveriesSnapshot.empty
      ? []
      : await db.getAll(...deliveriesSnapshot.docs.map((item) => db.doc(`eatCleanOrders/${item.id}`)))
    const orderMap = new Map(orderSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]))
    let liveLocations = new Map()
    let gpsReadWarning = null
    if (realtimeDb && !deliveriesSnapshot.empty) {
      try {
        // Never download the full GPS tree for the dispatch dashboard. It can
        // contain locations from other pages/cursors until the retention job
        // removes them. Read only the bounded set of active deliveries shown
        // in this response.
        const locationEntries = await Promise.all(deliveriesSnapshot.docs.map(async (item) => {
          const snapshot = await realtimeDb.ref(`eatCleanLiveLocations/${item.id}`).get()
          return [item.id, snapshot.exists() ? snapshot.val() : null]
        }))
        liveLocations = new Map(locationEntries.filter(([, value]) => value && typeof value === 'object'))
      } catch (error) {
        gpsReadWarning = 'realtime_temporarily_unavailable'
        logger.warn('Unable to load Eat Clean GPS signals for dispatch', {
          operation: 'dispatch_gps_read',
          code: typeof error?.code === 'string' ? error.code : 'unknown',
        })
      }
    }
    const nowMillis = Date.now()
    const gpsExpectedStatuses = new Set(['accepted', 'at_store', 'picked_up', 'arrived'])
    const deliveries = deliveriesSnapshot.docs
      .map((item) => {
        const order = orderMap.get(item.id) || {}
        const itemCount = (order.items || []).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0)
        const rawDelivery = item.data()
        const rawLocation = liveLocations.get(item.id)
        const locationHealth = liveLocationHealth(rawLocation, nowMillis)
        const hasLiveCoordinate = Number.isFinite(Number(rawLocation?.latitude))
          && Number.isFinite(Number(rawLocation?.longitude))
        const gpsExpected = gpsExpectedStatuses.has(rawDelivery.status)
        const gpsStale = gpsExpected && (!hasLiveCoordinate || locationHealth.stale || locationHealth.expired)
        const otpLockedUntil = timestampMillis(rawDelivery.otpLockedUntil)
        return {
          id: item.id,
          ...publicDeliveryValue(rawDelivery),
          orderStatus: order.status || '',
          itemCount,
          cashToCollect: order.paymentStatus === 'paid' || order.payment?.status === 'paid' ? 0 : Number(order.total) || 0,
          gpsStale,
          lastLocationAt: rawLocation && !locationHealth.expired && Number(rawLocation.updatedAt) > 0
            ? new Date(Number(rawLocation.updatedAt)).toISOString()
            : null,
          liveLocation: hasLiveCoordinate && !locationHealth.expired ? {
            latitude: Number(rawLocation.latitude),
            longitude: Number(rawLocation.longitude),
            updatedAt: Number(rawLocation.updatedAt) || 0,
          } : null,
          otpFailureCount: Math.max(0, Number(rawDelivery.otpFailedAttempts) || 0),
          otpLocked: Number.isFinite(otpLockedUntil) && otpLockedUntil > nowMillis,
          order: {
            id: item.id,
            code: order.code || item.data().orderCode || item.id,
            status: order.status || '',
            itemCount,
            total: Number(order.total) || 0,
            customer: order.customer || item.data().destination || null,
          },
        }
      })
      .map((item) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)))
    const availabilityMap = new Map(availabilitySnapshot.docs.map((item) => [item.id, item.data()]))
    const activeShipperProfiles = shipperProfilesSnapshot.docs.filter((item) => item.data().disabled !== true)
    const activeJobCountEntries = await Promise.all(activeShipperProfiles.map(async (item) => (
      [item.id, await countActiveDeliveryJobs(deliveryCollection, item.id)]
    )))
    const activeJobCounts = new Map(activeJobCountEntries)
    const latestLocationByShipper = new Map()
    deliveries.forEach((delivery) => {
      if (!delivery.shipperId || !delivery.liveLocation) return
      const current = latestLocationByShipper.get(delivery.shipperId)
      if (!current || delivery.liveLocation.updatedAt > current.updatedAt) {
        latestLocationByShipper.set(delivery.shipperId, delivery.liveLocation)
      }
    })
    const shippers = activeShipperProfiles
      .map((item) => ({
        id: item.id,
        userId: item.id,
        displayName: item.data().displayName || 'Shipper Aura',
        phone: item.data().phoneNumber || '',
        photoURL: item.data().photoURL || '',
        available: availabilityMap.get(item.id)?.available === true,
        activeJobCount: activeJobCounts.get(item.id) || 0,
        lastSeenAt: serializeValue(availabilityMap.get(item.id)?.lastSeenAt),
        location: latestLocationByShipper.get(item.id) || null,
      }))
    const summary = deliveries.reduce((result, item) => {
      result.byStatus[item.status] = (result.byStatus[item.status] || 0) + 1
      const promisedAt = Date.parse(item.promisedAt || item.eta?.promisedAt || '')
      if (!['delivered', 'cancelled'].includes(item.status) && Number.isFinite(promisedAt) && promisedAt < Date.now()) result.late += 1
      if (item.gpsStale) result.gpsStale += 1
      if (item.otpFailureCount > 0) result.otpRejected += 1
      if (item.otpLocked) result.otpLocked += 1
      return result
    }, { byStatus: {}, late: 0, gpsStale: 0, otpRejected: 0, otpLocked: 0, totalActive })
    const operationalCounts = operationalSignalSnapshot.data()?.counts || {}
    summary.mapsErrorsToday = Math.max(0,
      (Number(operationalCounts.address_error) || 0)
      + (Number(operationalCounts.route_error) || 0)
      + (Number(operationalCounts.maps_error) || 0),
    )
    const config = {
      ...normalizeStoredConfig(configSnapshot.exists ? configSnapshot.data() : {}),
      revision: Number(configSnapshot.data()?.revision) || 0,
      updatedAt: serializeValue(configSnapshot.data()?.updatedAt),
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      serverTime: new Date().toISOString(),
      deliveries,
      shippers,
      config,
      summary,
      signals: {
        mapsErrorsToday: summary.mapsErrorsToday,
        otpRejected: summary.otpRejected,
        otpLocked: summary.otpLocked,
        gpsStale: summary.gpsStale,
        lateOrders: summary.late,
        gpsReadWarning,
      },
      page: {
        limit,
        nextCursor: nextDeliveryCursor(deliveriesSnapshot, limit),
        hasMore: deliveriesSnapshot.size === limit,
      },
      readiness: deliveryRuntimeReadiness(config, realtimeDb),
    }
  })

  const assignEatCleanShipper = onCall(otpWriteOptions, async (request) => {
    const actorId = await trustedAdminId(request)
    const orderId = documentId(request.data?.orderId, 'Mã đơn hàng')
    const shipperId = documentId(request.data?.shipperId, 'Mã shipper')
    const orderReference = db.doc(`eatCleanOrders/${orderId}`)
    const deliveryReference = db.doc(`eatCleanDeliveries/${orderId}`)
    const eventReference = orderReference.collection('events').doc()
    const result = await db.runTransaction(async (transaction) => {
      const [orderSnapshot, deliverySnapshot, shipperSnapshot] = await Promise.all([
        transaction.get(orderReference),
        transaction.get(deliveryReference),
        transaction.get(db.doc(`users/${shipperId}`)),
      ])
      if (!orderSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy đơn Eat Clean.')
      if (!shipperSnapshot.exists || shipperSnapshot.data().role !== 'shipper' || shipperSnapshot.data().disabled === true) {
        throw new HttpsError('failed-precondition', 'Tài khoản được chọn không phải shipper đang hoạt động.')
      }
      const order = orderSnapshot.data()
      if (!['preparing', 'ready'].includes(order.status)) {
        throw new HttpsError('failed-precondition', 'Chỉ có thể gán shipper khi đơn đang chuẩn bị hoặc đã sẵn sàng.')
      }
      const current = deliverySnapshot.data() || {}
      if (['picked_up', 'arrived', 'delivered'].includes(current.status)) {
        throw new HttpsError('failed-precondition', 'Không thể đổi shipper sau khi đã lấy món.')
      }
      const otp = deliveryOtpFor(orderId, order.userId)
      const next = {
        schemaVersion: SCHEMA_VERSION,
        id: orderId,
        orderId,
        orderCode: order.code || orderId,
        userId: order.userId,
        pickup: current.pickup || {},
        destination: current.destination || order.customer,
        route: current.route || order.deliveryRoute || null,
        eta: current.eta || order.eta || null,
        promisedAt: current.promisedAt || (order.eta?.promisedAt ? Timestamp.fromDate(new Date(order.eta.promisedAt)) : null),
        status: 'assigned',
        shipperId,
        shipperName: boundedString(shipperSnapshot.data().displayName ?? 'Shipper Aura', 'Tên shipper', 100),
        deliveryOtpHash: otpHash(orderId, otp),
        deliveryOtpHashVersion: 'hmac-v1',
        otpFailedAttempts: 0,
        otpLockedUntil: null,
        assignedAt: FieldValue.serverTimestamp(),
        assignedBy: actorId,
        acceptedAt: null,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: deliverySnapshot.exists ? current.createdAt : FieldValue.serverTimestamp(),
      }
      transaction.set(deliveryReference, next, { merge: true })
      transaction.update(orderReference, {
        deliveryId: orderId,
        assignedShipperId: shipperId,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(eventReference, {
        type: 'shipper_assigned',
        actorId,
        shipperId,
        previousShipperId: current.shipperId || null,
        createdAt: FieldValue.serverTimestamp(),
      })
      const notificationReference = db.doc(`users/${shipperId}/notifications/eat-clean-job-${orderId}`)
      transaction.set(notificationReference, {
        id: notificationReference.id,
        userId: shipperId,
        title: 'Đơn giao Eat Clean mới',
        message: `${order.code || orderId} đã được gán cho bạn.`,
        type: 'eat_clean_delivery',
        category: 'system',
        actionUrl: `#/delivery?screen=job&orderId=${encodeURIComponent(orderId)}`,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return { orderId, shipperId, customerId: order.userId, status: 'assigned' }
    })
    const { customerId, ...publicResult } = result
    const realtimeMirror = await bestEffortRealtimeWrite({
      realtimeDb,
      path: `eatCleanLiveLocations/${orderId}`,
      write: (reference) => reference.set({
        orderId,
        customerId,
        shipperId,
        active: false,
        updatedAt: Date.now(),
        expiresAt: Date.now() + LIVE_LOCATION_RETENTION_MS,
      }),
      logger,
      context: { operation: 'assign', orderId, shipperId },
    })
    return { delivery: publicResult, realtimeMirror }
  })

  const acceptEatCleanDelivery = onCall(writeOptions, async (request) => {
    const { actorId, role } = await trustedShipper(request)
    const orderId = documentId(request.data?.orderId, 'Mã đơn hàng')
    const reference = db.doc(`eatCleanDeliveries/${orderId}`)
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy nhiệm vụ giao hàng.')
      const delivery = snapshot.data()
      if (role === 'shipper' && delivery.shipperId !== actorId) throw new HttpsError('permission-denied', 'Đơn này chưa được gán cho bạn.')
      if (!canTransitionDelivery(delivery.status, 'accepted')) {
        throw new HttpsError('failed-precondition', `Không thể nhận đơn ở trạng thái ${delivery.status}.`)
      }
      transaction.update(reference, {
        status: 'accepted',
        acceptedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { orderId, status: 'accepted', acceptedAt: new Date().toISOString() }
    })
    const realtimeMirror = await bestEffortRealtimeWrite({
      realtimeDb,
      path: `eatCleanLiveLocations/${orderId}/active`,
      write: (reference) => reference.set(true),
      logger,
      context: { operation: 'accept', orderId, actorId },
    })
    return { delivery: result, realtimeMirror }
  })

  const updateEatCleanDeliveryMilestone = onCall(writeOptions, async (request) => {
    const { actorId, role } = await trustedShipper(request)
    const orderId = documentId(request.data?.orderId, 'Mã đơn hàng')
    const milestone = boundedString(request.data?.milestone, 'Mốc giao hàng', 40)
    const transitions = {
      arrived_at_store: { from: 'accepted', to: 'at_store', field: 'arrivedAtStoreAt' },
      picked_up: { from: 'at_store', to: 'picked_up', field: 'pickedUpAt' },
      arrived_at_customer: { from: 'picked_up', to: 'arrived', field: 'arrivedAtCustomerAt' },
    }
    const transition = transitions[milestone]
    if (!transition) throw new HttpsError('invalid-argument', 'Mốc giao hàng không hợp lệ.')
    const deliveryReference = db.doc(`eatCleanDeliveries/${orderId}`)
    const orderReference = db.doc(`eatCleanOrders/${orderId}`)
    const eventReference = orderReference.collection('events').doc()
    const result = await db.runTransaction(async (transaction) => {
      const [deliverySnapshot, orderSnapshot] = await Promise.all([
        transaction.get(deliveryReference),
        transaction.get(orderReference),
      ])
      if (!deliverySnapshot.exists || !orderSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy đơn giao hàng.')
      const delivery = deliverySnapshot.data()
      const order = orderSnapshot.data()
      if (role === 'shipper' && delivery.shipperId !== actorId) throw new HttpsError('permission-denied', 'Đơn này chưa được gán cho bạn.')
      if (delivery.status !== transition.from) {
        throw new HttpsError('failed-precondition', `Mốc ${milestone} không hợp lệ sau trạng thái ${delivery.status}.`)
      }
      if (milestone === 'picked_up' && order.status !== 'ready') {
        throw new HttpsError('failed-precondition', 'Bếp chưa xác nhận đơn sẵn sàng để lấy.')
      }
      const deliveryPatch = {
        status: transition.to,
        [transition.field]: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (milestone === 'picked_up') {
        const slaPolicy = delivery.eta?.policy || DEFAULT_CONFIG.sla
        const routeMinutes = Math.ceil((delivery.route?.durationSeconds || 0) / 60)
        const estimatedDeliveryAt = new Date(Date.now() + (routeMinutes + slaPolicy.travelBufferMinutes) * 60000)
        const promisedAt = new Date(estimatedDeliveryAt.getTime() + slaPolicy.lateGraceMinutes * 60000)
        deliveryPatch.eta = {
          ...(delivery.eta || {}),
          estimatedDeliveryAt: estimatedDeliveryAt.toISOString(),
          estimatedArrivalAt: estimatedDeliveryAt.toISOString(),
          promisedAt: promisedAt.toISOString(),
          routeMinutes,
          recalculatedAt: new Date().toISOString(),
          reason: 'picked_up',
        }
        deliveryPatch.promisedAt = Timestamp.fromDate(promisedAt)
      }
      transaction.update(deliveryReference, deliveryPatch)
      if (milestone === 'picked_up') transaction.update(orderReference, {
        status: 'out_for_delivery',
        pickedUpAt: FieldValue.serverTimestamp(),
        eta: deliveryPatch.eta,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(eventReference, {
        type: 'delivery_milestone',
        actorId,
        milestone,
        from: transition.from,
        to: transition.to,
        createdAt: FieldValue.serverTimestamp(),
      })
      if (milestone === 'picked_up' || milestone === 'arrived_at_customer') {
        const notificationStatus = milestone === 'picked_up' ? 'out-for-delivery' : 'arrived'
        const notificationReference = db.doc(`users/${order.userId}/notifications/eat-clean-${orderId}-${notificationStatus}`)
        transaction.set(notificationReference, {
          id: notificationReference.id,
          userId: order.userId,
          title: milestone === 'picked_up' ? 'Shipper đã lấy món' : 'Shipper đã đến nơi',
          message: milestone === 'picked_up'
            ? `${order.code || orderId} đang trên đường giao đến bạn.`
            : `Shipper của ${order.code || orderId} đã đến. Vui lòng chuẩn bị mã OTP.`,
          type: 'eat_clean_delivery',
          category: 'system',
          actionUrl: `#/eat-clean?screen=order&orderId=${encodeURIComponent(orderId)}`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      return { orderId, status: transition.to, milestone, updatedAt: new Date().toISOString() }
    })
    return { delivery: result }
  })

  const updateEatCleanShipperLocation = onCall(writeOptions, async (request) => {
    const { actorId, role } = await trustedShipper(request)
    if (!realtimeDb) throw new HttpsError('failed-precondition', 'Realtime Database chưa được cấu hình.')
    const orderId = documentId(request.data?.orderId, 'Mã đơn hàng')
    const position = normalizeLatLng(request.data, 'Vị trí shipper')
    const deliverySnapshot = await db.doc(`eatCleanDeliveries/${orderId}`).get()
    if (!deliverySnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy nhiệm vụ giao hàng.')
    const delivery = deliverySnapshot.data()
    if (role === 'shipper' && delivery.shipperId !== actorId) throw new HttpsError('permission-denied', 'Đơn này chưa được gán cho bạn.')
    if (!['accepted', 'at_store', 'picked_up', 'arrived'].includes(delivery.status)) {
      throw new HttpsError('failed-precondition', 'Đơn chưa ở trạng thái cho phép cập nhật vị trí.')
    }
    let currentReference
    let currentSnapshot
    try {
      currentReference = realtimeDb.ref(`eatCleanLiveLocations/${orderId}`)
      currentSnapshot = await currentReference.get()
    } catch (error) {
      logger.warn('Unable to read Eat Clean live location before update', {
        operation: 'location_read_before_update',
        orderId,
        actorId,
        code: typeof error?.code === 'string' ? error.code : 'unknown',
      })
      throw new HttpsError('unavailable', 'Theo dõi vị trí tạm thời gián đoạn. Vui lòng thử lại.')
    }
    const currentLocation = currentSnapshot.exists() ? currentSnapshot.val() : null
    const nowMillis = Date.now()
    if (currentLocation?.latitude != null && currentLocation?.longitude != null) {
      const elapsedMs = nowMillis - Number(currentLocation.updatedAt || 0)
      const movedMeters = distanceBetweenCoordinates(currentLocation, position)
      if (elapsedMs < 10000 && movedMeters < 30) {
        return { location: currentLocation, throttled: true }
      }
    }
    const payload = {
      orderId,
      customerId: delivery.userId,
      shipperId: delivery.shipperId,
      latitude: position.latitude,
      longitude: position.longitude,
      accuracyMeters: optionalNumber(request.data?.accuracyMeters, 'Độ chính xác GPS', 0, 10000, 0),
      heading: optionalNumber(request.data?.heading, 'Hướng di chuyển', 0, 360, 0),
      speedMetersPerSecond: optionalNumber(request.data?.speedMetersPerSecond, 'Tốc độ', 0, 100, 0),
      active: true,
      updatedAt: nowMillis,
      expiresAt: nowMillis + LIVE_LOCATION_RETENTION_MS,
    }
    try {
      await currentReference.set(payload)
    } catch (error) {
      logger.warn('Unable to update Eat Clean live location', {
        operation: 'location_update',
        orderId,
        actorId,
        code: typeof error?.code === 'string' ? error.code : 'unknown',
      })
      throw new HttpsError('unavailable', 'Theo dõi vị trí tạm thời gián đoạn. Vui lòng thử lại.')
    }
    return { location: payload }
  })

  const completeEatCleanDelivery = onCall(otpWriteOptions, async (request) => {
    const { actorId, role } = await trustedShipper(request)
    const orderId = documentId(request.data?.orderId, 'Mã đơn hàng')
    const suppliedOtp = boundedString(request.data?.otp, 'Mã OTP giao hàng', 4)
    if (!/^\d{4}$/.test(suppliedOtp)) throw new HttpsError('invalid-argument', 'Mã OTP giao hàng phải gồm 4 chữ số.')
    const deliveryReference = db.doc(`eatCleanDeliveries/${orderId}`)
    const orderReference = db.doc(`eatCleanOrders/${orderId}`)
    const result = await db.runTransaction(async (transaction) => {
      const [deliverySnapshot, orderSnapshot] = await Promise.all([
        transaction.get(deliveryReference),
        transaction.get(orderReference),
      ])
      if (!deliverySnapshot.exists || !orderSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy đơn giao hàng.')
      const delivery = deliverySnapshot.data()
      const order = orderSnapshot.data()
      if (role === 'shipper' && delivery.shipperId !== actorId) throw new HttpsError('permission-denied', 'Đơn này chưa được gán cho bạn.')
      if (delivery.status !== 'arrived' || order.status !== 'out_for_delivery') {
        throw new HttpsError('failed-precondition', 'Shipper cần xác nhận đã đến nơi trước khi hoàn tất.')
      }
      const now = new Date()
      const lockedUntilMillis = timestampMillis(delivery.otpLockedUntil)
      if (Number.isFinite(lockedUntilMillis) && lockedUntilMillis > now.getTime()) {
        return { orderId, otpLocked: true, retryAt: new Date(lockedUntilMillis).toISOString() }
      }
      const candidateHash = delivery.deliveryOtpHashVersion === 'hmac-v1'
        ? otpHash(orderId, suppliedOtp)
        : legacyOtpHash(orderId, suppliedOtp)
      if (!safeHashEquals(delivery.deliveryOtpHash, candidateHash)) {
        const otpFailedAttempts = (Number(delivery.otpFailedAttempts) || 0) + 1
        const otpLockedUntil = otpFailedAttempts >= DELIVERY_OTP_MAX_ATTEMPTS
          ? Timestamp.fromMillis(now.getTime() + DELIVERY_OTP_LOCK_MS)
          : null
        transaction.update(deliveryReference, {
          otpFailedAttempts,
          otpLockedUntil,
          lastOtpFailureAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        return {
          orderId,
          otpRejected: true,
          remainingAttempts: Math.max(0, DELIVERY_OTP_MAX_ATTEMPTS - otpFailedAttempts),
          retryAt: otpLockedUntil ? new Date(otpLockedUntil.toMillis()).toISOString() : null,
        }
      }
      const trackedItems = (order.items || []).filter((item) => item.inventoryTracked !== false)
      const inventorySnapshots = []
      for (const item of trackedItems) inventorySnapshots.push(await transaction.get(db.doc(`eatCleanInventory/${item.inventoryId}`)))
      const revenueWrites = eatCleanRevenueRecognitionWrites({ orderId, order, actorUid: actorId })
      const revenueSnapshots = []
      for (const item of revenueWrites) revenueSnapshots.push(await transaction.get(db.doc(`ledgerEntries/${item.id}`)))
      trackedItems.forEach((item, index) => {
        const snapshot = inventorySnapshots[index]
        if (!snapshot.exists) throw new HttpsError('failed-precondition', `Thiếu tồn kho cho món ${item.name}.`)
        const inventory = snapshot.data()
        transaction.set(snapshot.ref, {
          reserved: Math.max(0, (inventory.reserved || 0) - item.quantity),
          sold: (inventory.sold || 0) + item.quantity,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      })
      transaction.update(deliveryReference, {
        status: 'delivered',
        deliveredAt: FieldValue.serverTimestamp(),
        deliveryOtpHash: FieldValue.delete(),
        deliveryOtpHashVersion: FieldValue.delete(),
        otpFailedAttempts: 0,
        otpLockedUntil: null,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.update(orderReference, {
        status: 'delivered',
        paymentStatus: 'paid',
        deliveredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      revenueWrites.forEach((item, index) => {
        if (!revenueSnapshots[index].exists) transaction.create(db.doc(`ledgerEntries/${item.id}`), item.value)
      })
      const notificationReference = db.doc(`users/${order.userId}/notifications/eat-clean-${orderId}-delivered`)
      transaction.set(notificationReference, {
        id: notificationReference.id,
        userId: order.userId,
        title: 'Đơn Eat Clean đã giao',
        message: `${order.code || orderId} đã giao thành công.`,
        type: 'eat_clean_order',
        category: 'system',
        actionUrl: `#/eat-clean?screen=order&orderId=${encodeURIComponent(orderId)}`,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return { orderId, status: 'delivered', deliveredAt: new Date().toISOString() }
    })
    if (result.otpLocked) {
      throw new HttpsError('resource-exhausted', `Đã tạm khóa nhập OTP. Thử lại sau ${result.retryAt}.`)
    }
    if (result.otpRejected) {
      throw new HttpsError('permission-denied', `Mã OTP không đúng. Còn ${result.remainingAttempts} lần thử.`)
    }
    const realtimeMirror = await bestEffortRealtimeWrite({
      realtimeDb,
      path: `eatCleanLiveLocations/${orderId}`,
      write: (reference) => reference.update({ active: false, updatedAt: Date.now() }),
      logger,
      context: { operation: 'complete', orderId, actorId },
    })
    return { delivery: result, realtimeMirror }
  })

  const listMyShipperJobs = onCall(deliveryOperationsCallableOptions, async (request) => {
    const { actorId, role } = await trustedShipper(request)
    const limit = finiteInteger(request.data?.limit ?? 50, 'Số nhiệm vụ', 1, 100)
    const cursor = normalizeDeliveryCursor(request.data?.cursor)
    const deliveryCollection = db.collection('eatCleanDeliveries')
    const shipperId = role === 'shipper' ? actorId : ''
    const query = buildActiveDeliveriesQuery(deliveryCollection, { shipperId, cursor, limit })
    const [snapshot, activeJobCount] = await Promise.all([
      query.get(),
      countActiveDeliveryJobs(deliveryCollection, shipperId),
    ])
    const orderSnapshots = snapshot.empty
      ? []
      : await db.getAll(...snapshot.docs.map((item) => db.doc(`eatCleanOrders/${item.id}`)))
    const orderMap = new Map(orderSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]))
    const [availabilitySnapshot, configSnapshot] = await Promise.all([
      db.doc(`eatCleanShippers/${actorId}`).get(),
      db.doc('system/eat_clean_config').get(),
    ])
    const config = normalizeStoredConfig(configSnapshot.exists ? configSnapshot.data() : {})
    const deliveries = snapshot.docs
      .map((item) => {
        const order = orderMap.get(item.id) || {}
        return {
          id: item.id,
          ...publicDeliveryValue(item.data()),
          order: {
            code: order.code || item.data().orderCode || item.id,
            status: order.status || '',
            itemCount: (order.items || []).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
            items: (order.items || []).map((line) => ({ name: line.name, quantity: line.quantity })),
            total: Number(order.total) || 0,
            customer: order.customer || item.data().destination || null,
            note: order.note || '',
          },
        }
      })
    return {
      schemaVersion: SCHEMA_VERSION,
      deliveries,
      shipper: availabilitySnapshot.exists
        ? { id: actorId, ...serializeValue(availabilitySnapshot.data()), activeJobCount }
        : { id: actorId, available: false, activeJobCount },
      driver: availabilitySnapshot.exists
        ? { id: actorId, ...serializeValue(availabilitySnapshot.data()), activeJobCount }
        : { id: actorId, available: false, activeJobCount },
      page: {
        limit,
        nextCursor: nextDeliveryCursor(snapshot, limit),
        hasMore: snapshot.size === limit,
      },
      readiness: deliveryRuntimeReadiness(config, realtimeDb),
    }
  })

  const getEatCleanOrderTracking = onCall(otpCallableOptions, async (request) => {
    const actorId = requireUser(request)
    const orderId = documentId(request.data?.orderId, 'Mã đơn hàng')
    const [actorSnapshot, orderSnapshot, deliverySnapshot] = await Promise.all([
      db.doc(`users/${actorId}`).get(),
      db.doc(`eatCleanOrders/${orderId}`).get(),
      db.doc(`eatCleanDeliveries/${orderId}`).get(),
    ])
    if (!orderSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy đơn Eat Clean.')
    const order = orderSnapshot.data()
    const delivery = deliverySnapshot.data() || null
    const role = actorSnapshot.data()?.role
    const isAdmin = trustedRole(request, actorSnapshot.data(), new Set(['admin', 'super_admin']))
    const isAssignedShipper = role === 'shipper' && trustedRole(request, actorSnapshot.data(), new Set(['shipper']))
      && delivery?.shipperId === actorId
    const isOwner = order.userId === actorId
    if (!isOwner && !isAdmin && !isAssignedShipper) throw new HttpsError('permission-denied', 'Bạn không có quyền xem hành trình đơn này.')
    let liveLocation = null
    let realtimeTracking = realtimeDb
      ? { configured: true, synced: true, warning: null }
      : { configured: false, synced: false, warning: 'realtime_not_configured' }
    if (realtimeDb && delivery && !['delivered', 'cancelled'].includes(delivery.status)) {
      try {
        const locationSnapshot = await realtimeDb.ref(`eatCleanLiveLocations/${orderId}`).get()
        if (locationSnapshot.exists()) {
          liveLocation = locationSnapshot.val()
          const health = liveLocationHealth(liveLocation)
          if (health.expired) {
            liveLocation = null
            realtimeTracking = { configured: true, synced: true, warning: 'location_expired' }
          } else {
            liveLocation.stale = health.stale
            liveLocation.expiresAt = Number(liveLocation.expiresAt || (Number(liveLocation.updatedAt || 0) + LIVE_LOCATION_RETENTION_MS))
          }
        }
      } catch (error) {
        logger.warn('Unable to read Eat Clean live location for tracking', {
          operation: 'tracking_read',
          orderId,
          actorId,
          code: typeof error?.code === 'string' ? error.code : 'unknown',
        })
        realtimeTracking = { configured: true, synced: false, warning: 'realtime_temporarily_unavailable' }
      }
    }
    const deliveryOtp = isOwner && delivery?.shipperId && !['delivered', 'cancelled'].includes(delivery.status)
      ? deliveryOtpFor(orderId, order.userId)
      : null
    const publicDelivery = delivery ? publicDeliveryValue(delivery, deliverySnapshot.id) : null
    return {
      schemaVersion: SCHEMA_VERSION,
      order: { id: orderSnapshot.id, ...serializeValue(order) },
      delivery: publicDelivery,
      liveLocation,
      realtimeTracking,
      deliveryOtp,
    }
  })

  const updateEatCleanOrder = onCall(writeOptions, async (request) => {
    const actorId = await trustedAdminId(request)
    const orderId = documentId(request.data?.orderId, 'Mã đơn hàng')
    const nextStatus = boundedString(request.data?.status, 'Trạng thái đơn', 40)
    if (!ORDER_STATUSES.has(nextStatus)) throw new HttpsError('invalid-argument', 'Trạng thái đơn không hợp lệ.')
    const adminNote = boundedString(request.data?.adminNote, 'Ghi chú vận hành', 500, { required: false })
    const reference = db.doc(`eatCleanOrders/${orderId}`)
    const eventReference = reference.collection('events').doc()
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy đơn Eat Clean.')
      const order = snapshot.data()
      const deliveryReference = db.doc(`eatCleanDeliveries/${orderId}`)
      const deliverySnapshot = await transaction.get(deliveryReference)
      if (!canTransitionOrder(order.status, nextStatus)) {
        throw new HttpsError('failed-precondition', `Không thể chuyển đơn từ ${order.status} sang ${nextStatus}.`)
      }
      const isNewCancellation = nextStatus === 'cancelled' && order.status !== 'cancelled'
      const cancellationPolicy = isNewCancellation ? cancellationPolicyFor(order.status, 'admin') : null
      if (nextStatus === 'delivered' && deliverySnapshot.exists) {
        throw new HttpsError('failed-precondition', 'Đơn có shipper phải hoàn tất bằng OTP giao hàng.')
      }
      if (nextStatus === 'out_for_delivery' && deliverySnapshot.exists) {
        throw new HttpsError('failed-precondition', 'Đơn có shipper phải chuyển sang đang giao bằng mốc Đã lấy món.')
      }
      const effect = orderInventoryEffect(order.status, nextStatus)
      const trackedItems = effect === 'none' ? [] : (order.items || []).filter((item) => item.inventoryTracked !== false)
      const inventorySnapshots = []
      for (const item of trackedItems) {
        inventorySnapshots.push(await transaction.get(db.doc(`eatCleanInventory/${item.inventoryId}`)))
      }
      const refundReference = isNewCancellation && paidOrder(order)
        ? db.doc(`eatCleanRefundJobs/${orderId}`)
        : null
      const refundSnapshot = refundReference ? await transaction.get(refundReference) : null
      const revenueWrites = nextStatus === 'delivered' && order.status !== 'delivered'
        ? eatCleanRevenueRecognitionWrites({ orderId, order, actorUid: actorId })
        : []
      const revenueSnapshots = []
      for (const item of revenueWrites) revenueSnapshots.push(await transaction.get(db.doc(`ledgerEntries/${item.id}`)))
      trackedItems.forEach((item, index) => {
        const inventorySnapshot = inventorySnapshots[index]
        if (!inventorySnapshot.exists) {
          throw new HttpsError('failed-precondition', `Thiếu tồn kho cho món ${item.name}.`)
        }
        const inventory = inventorySnapshot.data()
        const reserved = Math.max(0, (inventory.reserved || 0) - item.quantity)
        transaction.set(inventorySnapshot.ref, {
          reserved,
          sold: effect === 'sell' ? (inventory.sold || 0) + item.quantity : inventory.sold || 0,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      })
      const patch = {
        status: nextStatus,
        adminNote,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      }
      const statusTimestampField = order.status !== nextStatus ? orderStatusTimestampField(nextStatus) : ''
      if (statusTimestampField) patch[statusTimestampField] = FieldValue.serverTimestamp()
      if (nextStatus === 'delivered' && order.status !== nextStatus) {
        patch.paymentStatus = request.data?.paymentStatus === 'unpaid' ? 'unpaid' : 'paid'
      }
      if (isNewCancellation) {
        patch.cancelledBy = actorId
        patch.cancellationReason = boundedString(request.data?.cancellationReason, 'Lý do hủy', 300, { required: false })
        patch.cancellationPolicy = {
          actorType: 'admin',
          refundMode: cancellationPolicy.refundMode,
          kitchenWasteReview: cancellationPolicy.kitchenWasteReview,
        }
        patch.kitchenWasteReviewRequired = cancellationPolicy.kitchenWasteReview
        patch.refundStatus = refundReference ? 'review_required' : 'not_applicable'
      }
      transaction.update(reference, patch)
      revenueWrites.forEach((item, index) => {
        if (!revenueSnapshots[index].exists) transaction.create(db.doc(`ledgerEntries/${item.id}`), item.value)
      })
      if (deliverySnapshot.exists && nextStatus === 'ready' && deliverySnapshot.data().status === 'awaiting_kitchen') {
        transaction.set(deliveryReference, {
          status: 'awaiting_assignment',
          readyAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      if (deliverySnapshot.exists && nextStatus === 'cancelled' && deliverySnapshot.data().status !== 'delivered') {
        transaction.set(deliveryReference, {
          status: 'cancelled',
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      if (order.status !== nextStatus) {
        transaction.create(eventReference, {
          type: 'status_changed',
          actorId,
          from: order.status,
          to: nextStatus,
          note: adminNote,
          createdAt: FieldValue.serverTimestamp(),
        })
        if (typeof order.userId === 'string' && order.userId) {
          const [title, message] = orderStatusNotificationCopy(nextStatus, order.code || orderId)
          const notificationReference = db.doc(`users/${order.userId}/notifications/eat-clean-${orderId}-${nextStatus}`)
          transaction.set(notificationReference, {
            id: notificationReference.id,
            userId: order.userId,
            title,
            message,
            type: 'eat_clean_order',
            category: 'system',
            actionUrl: `#/eat-clean?screen=order&orderId=${encodeURIComponent(orderId)}`,
            dedupeKey: `eat-clean:${orderId}:${nextStatus}`,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          }, { merge: true })
        }
      }
      if (refundReference && !refundSnapshot?.exists) {
        transaction.create(refundReference, refundJobForOrder(order, {
          orderId,
          reason: patch.cancellationReason || 'admin_cancelled',
          requestedBy: actorId,
          policy: cancellationPolicy,
        }))
      }
      return { id: orderId, status: nextStatus, previousStatus: order.status, updatedAt: new Date().toISOString() }
    })
    const realtimeMirror = nextStatus === 'cancelled'
      ? await bestEffortRealtimeWrite({
        realtimeDb,
        path: `eatCleanLiveLocations/${orderId}`,
        write: (reference) => reference.update({ active: false, updatedAt: Date.now() }),
        logger,
        context: { operation: 'admin_cancel', orderId, actorId },
      })
      : null
    logger.info('Eat Clean order updated', { orderId, actorId, from: result.previousStatus, to: result.status })
    return { order: result, ...(realtimeMirror ? { realtimeMirror } : {}) }
  })

  const listEatCleanAdminData = onCall(callableOptions, async (request) => {
    await trustedAdminId(request)
    const serviceDate = request.data?.serviceDate ? dateKey(request.data.serviceDate) : ''
    const status = request.data?.status ? boundedString(request.data.status, 'Trạng thái', 40) : ''
    if (status && !ORDER_STATUSES.has(status)) throw new HttpsError('invalid-argument', 'Trạng thái lọc không hợp lệ.')
    const limit = finiteInteger(request.data?.limit ?? 100, 'Giới hạn dữ liệu', 1, 200)
    const [configSnapshot, mealsSnapshot, inventorySnapshot, ordersSnapshot] = await Promise.all([
      db.doc('system/eat_clean_config').get(),
      db.collection('eatCleanMeals').limit(200).get(),
      serviceDate
        ? db.collection('eatCleanInventory').where('serviceDate', '==', serviceDate).limit(500).get()
        : db.collection('eatCleanInventory').limit(500).get(),
      db.collection('eatCleanOrders').orderBy('createdAt', 'desc').limit(limit).get(),
    ])
    const config = {
      ...normalizeStoredConfig(configSnapshot.exists ? configSnapshot.data() : {}),
      revision: configSnapshot.data()?.revision || 0,
      updatedAt: serializeValue(configSnapshot.data()?.updatedAt),
    }
    const meals = mealsSnapshot.docs
      .map((snapshot) => ({ id: snapshot.id, ...serializeValue(snapshot.data()) }))
      .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0) || left.name.localeCompare(right.name, 'vi'))
    const inventory = inventorySnapshot.docs.map((snapshot) => {
      const item = { id: snapshot.id, ...serializeValue(snapshot.data()) }
      return { ...item, available: Math.max(0, (item.capacity || 0) - (item.reserved || 0) - (item.sold || 0)) }
    })
    const [refundJobSnapshots, deliverySnapshots] = ordersSnapshot.empty
      ? [[], []]
      : await Promise.all([
          db.getAll(...ordersSnapshot.docs.map((snapshot) => db.doc(`eatCleanRefundJobs/${snapshot.id}`))),
          db.getAll(...ordersSnapshot.docs.map((snapshot) => db.doc(`eatCleanDeliveries/${snapshot.id}`))),
        ])
    const refundsByOrderId = new Map(refundJobSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [
        snapshot.data().orderId || snapshot.id,
        { id: snapshot.id, ...serializeValue(snapshot.data()) },
      ]))
    const deliveryIds = new Set(deliverySnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id))
    const orders = ordersSnapshot.docs
      .map((snapshot) => ({
        id: snapshot.id,
        ...serializeValue(snapshot.data()),
        refund: refundsByOrderId.get(snapshot.id) || null,
        deliveryRecordMissing: !deliveryIds.has(snapshot.id),
      }))
      .filter((order) => !status || order.status === status)
      .filter((order) => !serviceDate || order.serviceDate === serviceDate)
    const summary = orders.reduce((value, order) => {
      value.totalOrders += 1
      value.byStatus[order.status] = (value.byStatus[order.status] || 0) + 1
      if (order.status === 'delivered') value.deliveredRevenue += order.total || 0
      if (order.refund && !['refunded', 'rejected'].includes(order.refund.status)) value.pendingRefunds += 1
      if (order.deliveryRecordMissing) value.missingDeliveryRecords += 1
      return value
    }, { totalOrders: 0, deliveredRevenue: 0, pendingRefunds: 0, missingDeliveryRecords: 0, byStatus: {} })
    return {
      schemaVersion: SCHEMA_VERSION,
      seeded: configSnapshot.exists || meals.length > 0 || inventory.length > 0,
      config,
      meals,
      inventory,
      orders,
      summary,
    }
  })

  return {
    listEatCleanAddresses,
    saveEatCleanAddress,
    deleteEatCleanAddress,
    setDefaultEatCleanAddress,
    getEatCleanStorefront,
    recommendEatCleanMeals,
    quoteEatCleanOrder,
    createEatCleanOrder,
    listMyEatCleanOrders,
    cancelEatCleanOrder,
    recordEatCleanRefundOutcome,
    reverseEatCleanRefundOutcome,
    confirmEatCleanConsumption,
    saveEatCleanMeal,
    saveEatCleanInventory,
    saveEatCleanConfig,
    initializeEatCleanCatalog,
    updateEatCleanOrder,
    listEatCleanAdminData,
    setEatCleanShipperAvailability,
    saveEatCleanDeliveryConfig,
    listEatCleanDispatchData,
    assignEatCleanShipper,
    acceptEatCleanDelivery,
    updateEatCleanDeliveryMilestone,
    updateEatCleanShipperLocation,
    completeEatCleanDelivery,
    listMyShipperJobs,
    getEatCleanOrderTracking,
  }
}

module.exports = {
  createEatCleanFunctions,
  DEFAULT_EAT_CLEAN_MEALS,
  __test: {
    DEFAULT_CONFIG,
    ALLERGEN_IDS,
    ACTIVE_DELIVERY_STATUSES,
    ORDER_CANCELLATION_POLICY,
    LIVE_LOCATION_RETENTION_MS,
    normalizeEatCleanConfig,
    normalizeDistancePricing,
    normalizeSavedAddress,
    normalizeMealInput,
    normalizeLineItems,
    normalizeCustomer,
    normalizeOrderRequest,
    inventoryDocumentId,
    availableInventory,
    calculateQuote,
    calculateDistanceDeliveryFee,
    roundedDistance,
    pointInPolygon,
    distanceBetweenCoordinates,
    estimateDeliverySla,
    createGoogleAddressAdapter,
    createGoogleRoutesAdapter,
    assertSubmittedPinMatches,
    verifiedCustomerFromDestination,
    verifyDeliveryCustomer,
    normalizeDeliveryCursor,
    buildActiveDeliveriesQuery,
    nextDeliveryCursor,
    liveLocationHealth,
    bestEffortRealtimeWrite,
    canonicalOrderPayload,
    canonicalOrderRequestHash,
    quoteSnapshotHash,
    validateQuoteRecord,
    rawOrderRequestHash,
    canonicalAllergenIds,
    hasAllergenConflict,
    recommendationScore,
    canTransitionOrder,
    cancellationPolicyFor,
    canCustomerCancelOrder,
    refundJobForOrder,
    orderStatusTimestampField,
    canTransitionDelivery,
    deliveryOtpFor,
    otpHash,
    orderInventoryEffect,
    normalizedConsumedRatio,
    scaledNutrition,
    serializeValue,
    publicDeliveryValue,
  },
}
