export function isLoyaltyAccessError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  const code = String(error.code || '').replace(/^functions\//, '')
  return code === 'permission-denied' || code === 'unauthenticated'
}
