export interface NutritionAiRetryOptions {
  expectedOwnerUid: string
  currentOwnerUid: () => string | undefined
  wait?: (milliseconds: number) => Promise<void>
}

/** Reuses the exact invocation payload. Only an explicit server-side running
 * receipt may be polled; ambiguous provider outcomes never cause a new job. */
export async function runNutritionAiRequest<T>(invoke: () => Promise<T>, options: NutritionAiRetryOptions): Promise<T> {
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)))
  let allowedPolls = 12
  for (let attempt = 0; ; attempt++) {
    if (!options.expectedOwnerUid || options.currentOwnerUid() !== options.expectedOwnerUid) {
      throw Object.assign(new Error('Phiên đăng nhập đã thay đổi. Hãy mở lại tác vụ dinh dưỡng.'), { code: 'cancelled' })
    }
    try {
      const result = await invoke()
      if (options.currentOwnerUid() !== options.expectedOwnerUid) {
        throw Object.assign(new Error('Phiên đăng nhập đã thay đổi. Hãy mở lại tác vụ dinh dưỡng.'), { code: 'cancelled' })
      }
      return result
    }
    catch (error) {
      const details = (error as { details?: { kind?: string; retryAfterMs?: number; maxPollAttempts?: number } })?.details
      if (details?.kind !== 'nutrition_ai_processing') throw error
      if (Number.isFinite(details.maxPollAttempts)) allowedPolls = Math.min(allowedPolls, Math.max(0, Math.floor(details.maxPollAttempts!)))
      if (attempt >= allowedPolls) throw error
      const duration = Math.min(5_000, Math.max(1_000, Number(details.retryAfterMs) || 1_500))
      await wait(duration)
    }
  }
}
