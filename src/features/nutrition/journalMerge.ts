/** A live day is authoritative, including an empty day after deletions. */
export function mergeJournalHistory<T extends { id: string; date: string }>(
  history: T[],
  liveDays: ReadonlyMap<string, T[]>,
): T[] {
  const rows = new Map(history.filter((row) => !liveDays.has(row.date)).map((row) => [row.id, row]))
  for (const day of liveDays.values()) for (const row of day) rows.set(row.id, row)
  return [...rows.values()]
}
