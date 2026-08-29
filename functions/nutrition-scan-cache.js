const { createHash } = require('node:crypto')

const FOOD_SCAN_CACHE_VERSION = 'food-vision-provider-fallback-v4'

function canonicalString(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalString).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalString(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function normalizeCacheContextText(value, maximum) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, maximum)
    : ''
}

/**
 * Builds an opaque, owner-scoped identity for an exact image analysis. The
 * scanId is deliberately excluded so a retry can reuse facts while the API
 * reconstructs a response with the retry's new scanId.
 */
function buildFoodScanCacheKey({
  uid,
  imageBuffer,
  contentType,
  mealType = 'other',
  notes = '',
  studentGoal = '',
  studentCondition = '',
  analysisVersion = FOOD_SCAN_CACHE_VERSION,
}) {
  if (typeof uid !== 'string' || !uid.trim()) throw new TypeError('uid is required')
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) throw new TypeError('imageBuffer is required')

  const imageDigest = createHash('sha256').update(imageBuffer).digest('hex')
  const cacheContext = {
    analysisVersion: normalizeCacheContextText(analysisVersion, 100),
    contentType: normalizeCacheContextText(contentType, 80).toLowerCase(),
    imageDigest,
    mealType: normalizeCacheContextText(mealType, 30).toLowerCase() || 'other',
    notes: normalizeCacheContextText(notes, 300),
    studentCondition: normalizeCacheContextText(studentCondition, 500),
    studentGoal: normalizeCacheContextText(studentGoal, 500),
    uid: uid.trim(),
  }

  return createHash('sha256').update(canonicalString(cacheContext)).digest('hex')
}

module.exports = {
  FOOD_SCAN_CACHE_VERSION,
  buildFoodScanCacheKey,
}
