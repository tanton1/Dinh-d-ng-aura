/** Stable IDs make recovering a stored generation safe to apply again. An
 * explicit new draft has a different generation ID and can add new items. */
export function appendGeneratedItems<T extends { id: string }>(existing: readonly T[], generated: readonly Omit<T, 'id'>[], generationId: string, kind: string): T[] {
  const known = new Set(existing.map(item => item.id))
  return [...existing, ...generated.flatMap((item, index) => {
    const id = `ai-${kind}-${generationId}-${index}`
    return known.has(id) ? [] : [{ ...item, id } as T]
  })]
}

export function appendGeneratedText(existing: readonly string[], generated: readonly string[]): string[] {
  const result = [...existing], known = new Set(existing)
  for (const text of generated) if (!known.has(text)) { result.push(text); known.add(text) }
  return result
}
