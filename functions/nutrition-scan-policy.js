const REGULAR_DAILY_FOOD_SCAN_LIMIT = 10
const STAFF_DAILY_FOOD_SCAN_LIMIT = 50

const knownRoles = new Set(['student', 'coach', 'editor', 'admin', 'super_admin'])
const elevatedScanRoles = new Set(['coach', 'admin', 'super_admin'])

function normalizeRole(value) {
  return typeof value === 'string' && knownRoles.has(value) ? value : null
}

/**
 * Scan privileges are granted only when the signed Auth claim and the
 * server-owned Firestore profile agree. A stale or spoofed role safely falls
 * back to the regular allowance instead of increasing AI spend.
 */
function trustedFoodScanRole({ tokenRole, profileRole } = {}) {
  const normalizedTokenRole = normalizeRole(tokenRole)
  const normalizedProfileRole = normalizeRole(profileRole)
  if (!normalizedTokenRole || normalizedTokenRole !== normalizedProfileRole) return 'student'
  return normalizedTokenRole
}

function dailyFoodScanLimitForRoles(roles = {}) {
  const role = trustedFoodScanRole(roles)
  return elevatedScanRoles.has(role)
    ? STAFF_DAILY_FOOD_SCAN_LIMIT
    : REGULAR_DAILY_FOOD_SCAN_LIMIT
}

module.exports = {
  REGULAR_DAILY_FOOD_SCAN_LIMIT,
  STAFF_DAILY_FOOD_SCAN_LIMIT,
  dailyFoodScanLimitForRoles,
  trustedFoodScanRole,
}

