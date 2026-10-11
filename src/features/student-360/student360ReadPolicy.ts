import { callableCode } from '../../services/readOnlyCallableCore'

export const STUDENT360_READ_TIMEOUT_MS = 12_000
const overflowCodes = new Set(['internal', 'unavailable', 'resource-exhausted', 'deadline-exceeded'])

export function canFailOverStudent360(error: unknown): boolean {
  const original = error && typeof error === 'object' && 'cause' in error && error.cause ? error.cause : error
  return overflowCodes.has(callableCode(original))
}

/** One attempt per region, never four nested attempts or a mutation retry. */
export async function readStudent360WithFailover<T>(
  primary: () => Promise<T>,
  overflow?: () => Promise<T>,
  delay: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 250)),
): Promise<T> {
  try {
    return await primary()
  } catch (error) {
    if (!overflow || !canFailOverStudent360(error)) throw error
    await delay()
    return overflow()
  }
}
