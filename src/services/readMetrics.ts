export interface ReadMeasurement { operation: string; durationMs: number; attempts: number; failed: boolean }
interface ReadBatch { operation: string; count: number; failed: number; attempts: number; totalDurationMs: number; maxDurationMs: number }

/** Bounded, anonymous diagnostics. Payloads, account IDs and route parameters
 * are deliberately not accepted. Batch completion never starts a timer. */
export function createReadMetricBuffer(limit = 32, batchSize = 20) {
  const batches = new Map<string, ReadBatch>()
  return {
    record(value: ReadMeasurement): ReadBatch | null {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(value.operation) || !Number.isFinite(value.durationMs) || value.durationMs < 0 || !Number.isInteger(value.attempts) || value.attempts < 0 || value.attempts > 4) return null
      let batch = batches.get(value.operation)
      if (!batch) {
        if (batches.size >= limit) batches.delete(batches.keys().next().value!)
        batch = { operation: value.operation, count: 0, failed: 0, attempts: 0, totalDurationMs: 0, maxDurationMs: 0 }
        batches.set(value.operation, batch)
      }
      const duration = Math.min(Math.round(value.durationMs), 600_000)
      batch.count++
      batch.failed += Number(value.failed)
      batch.attempts += value.attempts
      batch.totalDurationMs += duration
      batch.maxDurationMs = Math.max(batch.maxDurationMs, duration)
      if (batch.count < batchSize) return null
      batches.delete(value.operation)
      return { ...batch }
    },
    snapshot: () => [...batches.values()].map(value => ({ ...value })),
  }
}
