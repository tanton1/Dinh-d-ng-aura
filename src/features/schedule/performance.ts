type ScheduleTiming = 'workspace' | 'opportunities' | 'optimizer' | 'publish'

/** Local User Timing only: no identifiers, network, Firestore reads or unbounded entries. */
export function beginScheduleTiming(operation: ScheduleTiming) {
  const clock = globalThis.performance
  const start = clock?.now()
  let finished = false
  return () => {
    if (finished || start === undefined) return
    finished = true
    try {
      const name = `aura:schedule:${operation}`
      clock.clearMeasures(name)
      clock.measure(name, { start, end: clock.now() })
    } catch { /* Unsupported User Timing must never affect the scheduling task. */ }
  }
}

export async function measureScheduleTask<T>(operation: ScheduleTiming, task: () => Promise<T>): Promise<T> {
  const finish = beginScheduleTiming(operation)
  try { return await task() } finally { finish() }
}
