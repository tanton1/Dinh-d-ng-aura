const { createHash } = require('node:crypto')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')

const CITY_CODE = 'da-nang'
const CITY_NAME = 'Đà Nẵng'
const CURRENCY = 'VND'
const PAYMENT_METHOD = 'COD'
const SCHEMA_VERSION = 1
const QUOTE_TTL_MS = 10 * 60 * 1000

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
  out_for_delivery: new Set(['delivered', 'cancelled']),
  delivered: new Set(),
  cancelled: new Set(),
})

const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  enabled: false,
  acceptingOrders: false,
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
  return {
    name: boundedString(value.name, 'Tên người nhận', 100),
    phone,
    addressLine: boundedString(value.addressLine, 'Địa chỉ giao hàng', 240),
    ward: boundedString(value.ward, 'Phường/xã', 100, { required: false }),
    districtId: normalizedKey(boundedString(value.districtId || value.district, 'Khu vực giao hàng', 100)),
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
  const serviceDate = dateKey(value.serviceDate)
  validateServiceDate(serviceDate, config)
  const deliverySlotId = normalizedKey(boundedString(value.deliverySlotId, 'Khung giờ giao', 60))
  const deliverySlot = config.deliverySlots.find((item) => item.id === deliverySlotId && item.enabled)
  if (!deliverySlot) throw new HttpsError('failed-precondition', 'Khung giờ giao không còn phục vụ.')
  const customer = normalizeCustomer(value.customer)
  const deliveryZone = config.deliveryZones.find((item) => item.id === customer.districtId && item.enabled)
  if (!deliveryZone) throw new HttpsError('failed-precondition', 'Địa chỉ nằm ngoài khu vực giao hàng tại Đà Nẵng.')
  return {
    items: normalizeLineItems(value.items, config),
    serviceDate,
    deliverySlotId,
    deliverySlot,
    deliveryZone,
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

function calculateQuote({ config, request, mealRecords, inventoryRecords }) {
  const items = request.items.map(({ mealId, quantity }) => {
    const meal = mealRecords.get(mealId)
    if (!meal || meal.active === false) throw new HttpsError('failed-precondition', `Món ${mealId} hiện không phục vụ.`)
    if (meal.allowedDeliverySlots?.length && !meal.allowedDeliverySlots.includes(request.deliverySlotId)) {
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
      inventoryTracked: meal.inventoryTracked !== false,
    }
  })
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0)
  if (subtotal < config.minOrderAmount) {
    throw new HttpsError('failed-precondition', `Đơn hàng tối thiểu ${config.minOrderAmount.toLocaleString('vi-VN')}đ.`)
  }
  const deliveryFee = config.freeDeliveryThreshold > 0 && subtotal >= config.freeDeliveryThreshold
    ? 0
    : request.deliveryZone.fee ?? config.defaultDeliveryFee
  const nutrition = items.reduce((total, item) => ({
    calories: Math.round((total.calories + item.calories) * 10) / 10,
    protein: Math.round((total.protein + item.protein) * 10) / 10,
    carbs: Math.round((total.carbs + item.carbs) * 10) / 10,
    fat: Math.round((total.fat + item.fat) * 10) / 10,
    fiber: Math.round((total.fiber + item.fiber) * 10) / 10,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 })
  return {
    schemaVersion: SCHEMA_VERSION,
    currency: CURRENCY,
    paymentMethod: PAYMENT_METHOD,
    cityCode: CITY_CODE,
    cityName: CITY_NAME,
    serviceDate: request.serviceDate,
    deliverySlot: request.deliverySlot,
    deliveryZone: request.deliveryZone,
    items,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    nutrition,
  }
}

function canonicalOrderPayload(request) {
  return JSON.stringify({
    items: [...request.items].sort((left, right) => left.mealId.localeCompare(right.mealId)),
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
    deliveryFee: quote.deliveryFee,
    total: quote.total,
    nutrition: quote.nutrition,
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

function publicConfig(config) {
  const deliveryZones = config.deliveryZones.filter((item) => item.enabled)
  const deliverySlots = config.deliverySlots.filter((item) => item.enabled)
  return {
    schemaVersion: config.schemaVersion,
    enabled: config.enabled,
    acceptingOrders: config.acceptingOrders,
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

function createEatCleanFunctions(dependencies) {
  const db = requireFactoryDependency(dependencies?.db, 'db')
  const onCall = requireFactoryDependency(dependencies?.onCall, 'onCall')
  const requireTrustedAdmin = requireFactoryDependency(dependencies?.requireTrustedAdmin, 'requireTrustedAdmin')
  const logger = dependencies?.logger || console

  async function trustedAdminId(request) {
    const result = await requireTrustedAdmin(request)
    return typeof result === 'string' && result ? result : requireUser(request)
  }

  const callableOptions = { cpu: 'gcf_gen1', maxInstances: 3, invoker: 'public' }
  const writeOptions = { cpu: 'gcf_gen1', maxInstances: 2, invoker: 'public' }

  const getEatCleanStorefront = onCall(callableOptions, async (request) => {
    const config = await readConfig(db)
    const requestedDate = request.data?.serviceDate
      ? dateKey(request.data.serviceDate)
      : addUtcDays(todayInVietnam(), Math.max(1, config.minimumLeadDays))
    validateServiceDate(requestedDate, config)
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

  const quoteEatCleanOrder = onCall(callableOptions, async (request) => {
    const userId = requireUser(request)
    const config = await readConfig(db)
    if (!config.enabled || !config.acceptingOrders) {
      throw new HttpsError('failed-precondition', 'Eat Clean hiện chưa nhận đơn mới.')
    }
    const normalized = normalizeOrderRequest(request.data, config)
    const records = await loadQuoteRecords(db, normalized)
    const quote = calculateQuote({ config, request: normalized, ...records })
    const quotedAt = new Date()
    const expiresAt = new Date(quotedAt.getTime() + QUOTE_TTL_MS)
    const quoteReference = db.collection('eatCleanQuotes').doc()
    await quoteReference.create({
      schemaVersion: SCHEMA_VERSION,
      userId,
      status: 'active',
      requestHash: canonicalOrderRequestHash(normalized),
      quoteHash: quoteSnapshotHash(quote),
      serviceDate: normalized.serviceDate,
      itemCount: normalized.items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: quote.subtotal,
      deliveryFee: quote.deliveryFee,
      total: quote.total,
      currency: CURRENCY,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
    })
    return {
      ...quote,
      quoteId: quoteReference.id,
      quotedAt: quotedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }
  })

  const createEatCleanOrder = onCall(writeOptions, async (request) => {
    const userId = requireUser(request)
    const quoteId = documentId(request.data?.quoteId, 'Mã báo giá')
    const idempotencyKey = boundedString(request.data?.idempotencyKey, 'Khóa chống gửi trùng', 128)
    if (idempotencyKey.length < 8) throw new HttpsError('invalid-argument', 'Khóa chống gửi trùng quá ngắn.')
    const requestHash = rawOrderRequestHash(request.data)
    const orderReference = db.collection('eatCleanOrders').doc()
    const markerReference = db.doc(`eatCleanIdempotency/${digest(`${userId}:${idempotencyKey}`)}`)
    const quoteReference = db.doc(`eatCleanQuotes/${quoteId}`)
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
      const configReference = db.doc('system/eat_clean_config')
      const configSnapshot = await transaction.get(configReference)
      const config = normalizeStoredConfig(configSnapshot.exists ? configSnapshot.data() : {})
      if (!config.enabled || !config.acceptingOrders) {
        throw new HttpsError('failed-precondition', 'Eat Clean hiện chưa nhận đơn mới.')
      }
      const normalized = normalizeOrderRequest(request.data, config)
      const mealReferences = normalized.items.map((item) => db.doc(`eatCleanMeals/${item.mealId}`))
      const inventoryReferences = normalized.items.map((item) => db.doc(`eatCleanInventory/${inventoryDocumentId(normalized.serviceDate, item.mealId)}`))
      const mealSnapshots = []
      const inventorySnapshots = []
      for (const reference of mealReferences) mealSnapshots.push(await transaction.get(reference))
      for (const reference of inventoryReferences) inventorySnapshots.push(await transaction.get(reference))
      const mealRecords = new Map(mealSnapshots.filter((item) => item.exists).map((item) => [item.id, { id: item.id, ...item.data() }]))
      const inventoryRecords = new Map(inventorySnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]))
      const quote = calculateQuote({ config, request: normalized, mealRecords, inventoryRecords })
      const normalizedRequestHash = canonicalOrderRequestHash(normalized)
      const currentQuoteHash = quoteSnapshotHash(quote)
      validateQuoteRecord({
        quoteRecord: quoteRecordSnapshot.exists ? quoteRecordSnapshot.data() : null,
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
        deliverySlotId: normalized.deliverySlot.id,
        deliverySlotLabel: normalized.deliverySlot.label,
        deliverySlot: normalized.deliverySlot,
        deliveryZone: normalized.deliveryZone,
        note: normalized.note,
        items: quote.items,
        subtotal: quote.subtotal,
        deliveryFee: quote.deliveryFee,
        discount: 0,
        total: quote.total,
        currency: CURRENCY,
        nutrition: quote.nutrition,
        quoteId,
        quoteHash: currentQuoteHash,
        consumedItemIds: [],
        consumptions: [],
        idempotencyHash: markerReference.id,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }
      transaction.create(orderReference, storedOrder)
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
    const snapshot = await db.collection('eatCleanOrders')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()
    const orders = snapshot.docs.map((item) => {
      const order = { id: item.id, ...serializeValue(item.data()) }
      return {
        ...order,
        canCancel: ['pending_confirmation', 'confirmed'].includes(order.status),
      }
    })
    return { schemaVersion: SCHEMA_VERSION, orders }
  })

  const cancelEatCleanOrder = onCall(writeOptions, async (request) => {
    const userId = requireUser(request)
    const orderId = documentId(request.data?.orderId, 'Mã đơn hàng')
    const reason = boundedString(request.data?.reason, 'Lý do hủy', 300, { required: false })
    const orderReference = db.doc(`eatCleanOrders/${orderId}`)
    const result = await db.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderReference)
      if (!orderSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy đơn Eat Clean.')
      const order = orderSnapshot.data()
      if (order.userId !== userId) throw new HttpsError('permission-denied', 'Bạn không có quyền hủy đơn này.')
      if (order.status === 'cancelled') {
        return { order: { id: orderId, ...serializeValue(order), canCancel: false }, idempotent: true }
      }
      if (!['pending_confirmation', 'confirmed'].includes(order.status)) {
        throw new HttpsError('failed-precondition', 'Đơn hàng không còn trong trạng thái có thể tự hủy.')
      }
      const configSnapshot = await transaction.get(db.doc('system/eat_clean_config'))
      const config = normalizeStoredConfig(configSnapshot.exists ? configSnapshot.data() : {})
      ensureCustomerCancellationWindow(order, config)
      const inventorySnapshots = []
      const trackedItems = (order.items || []).filter((item) => item.inventoryTracked !== false)
      for (const item of trackedItems) {
        inventorySnapshots.push(await transaction.get(db.doc(`eatCleanInventory/${item.inventoryId}`)))
      }
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
        cancelledBy: userId,
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      const nowIso = new Date().toISOString()
      return {
        order: {
          id: orderId,
          ...serializeValue(order),
          status: 'cancelled',
          cancellationReason: reason,
          cancelledBy: userId,
          cancelledAt: nowIso,
          updatedAt: nowIso,
          canCancel: false,
        },
        idempotent: false,
      }
    })
    logger.info('Eat Clean order cancelled by customer', { orderId, userId, idempotent: result.idempotent })
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

  const saveEatCleanConfig = onCall(writeOptions, async (request) => {
    const actorId = await trustedAdminId(request)
    const input = normalizeEatCleanConfig(request.data?.config || request.data)
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
    return { config: result }
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
      if (!canTransitionOrder(order.status, nextStatus)) {
        throw new HttpsError('failed-precondition', `Không thể chuyển đơn từ ${order.status} sang ${nextStatus}.`)
      }
      const effect = orderInventoryEffect(order.status, nextStatus)
      const trackedItems = effect === 'none' ? [] : (order.items || []).filter((item) => item.inventoryTracked !== false)
      const inventorySnapshots = []
      for (const item of trackedItems) {
        inventorySnapshots.push(await transaction.get(db.doc(`eatCleanInventory/${item.inventoryId}`)))
      }
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
      if (nextStatus === 'confirmed' && order.status !== nextStatus) patch.confirmedAt = FieldValue.serverTimestamp()
      if (nextStatus === 'delivered' && order.status !== nextStatus) {
        patch.deliveredAt = FieldValue.serverTimestamp()
        patch.paymentStatus = request.data?.paymentStatus === 'unpaid' ? 'unpaid' : 'paid'
      }
      if (nextStatus === 'cancelled' && order.status !== nextStatus) {
        patch.cancelledAt = FieldValue.serverTimestamp()
        patch.cancelledBy = actorId
        patch.cancellationReason = boundedString(request.data?.cancellationReason, 'Lý do hủy', 300, { required: false })
      }
      transaction.update(reference, patch)
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
      return { id: orderId, status: nextStatus, previousStatus: order.status, updatedAt: new Date().toISOString() }
    })
    logger.info('Eat Clean order updated', { orderId, actorId, from: result.previousStatus, to: result.status })
    return { order: result }
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
    const orders = ordersSnapshot.docs
      .map((snapshot) => ({ id: snapshot.id, ...serializeValue(snapshot.data()) }))
      .filter((order) => !status || order.status === status)
      .filter((order) => !serviceDate || order.serviceDate === serviceDate)
    const summary = orders.reduce((value, order) => {
      value.totalOrders += 1
      value.byStatus[order.status] = (value.byStatus[order.status] || 0) + 1
      if (order.status === 'delivered') value.deliveredRevenue += order.total || 0
      return value
    }, { totalOrders: 0, deliveredRevenue: 0, byStatus: {} })
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
    getEatCleanStorefront,
    recommendEatCleanMeals,
    quoteEatCleanOrder,
    createEatCleanOrder,
    listMyEatCleanOrders,
    cancelEatCleanOrder,
    confirmEatCleanConsumption,
    saveEatCleanMeal,
    saveEatCleanInventory,
    saveEatCleanConfig,
    initializeEatCleanCatalog,
    updateEatCleanOrder,
    listEatCleanAdminData,
  }
}

module.exports = {
  createEatCleanFunctions,
  DEFAULT_EAT_CLEAN_MEALS,
  __test: {
    DEFAULT_CONFIG,
    ALLERGEN_IDS,
    normalizeEatCleanConfig,
    normalizeMealInput,
    normalizeLineItems,
    normalizeCustomer,
    normalizeOrderRequest,
    inventoryDocumentId,
    availableInventory,
    calculateQuote,
    canonicalOrderPayload,
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
    serializeValue,
  },
}
