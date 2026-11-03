const VIETNAMESE_FAMILY_NAMES = new Set([
  'nguyễn', 'trần', 'lê', 'phạm', 'hoàng', 'huỳnh', 'phan', 'vũ', 'võ', 'đặng',
  'bùi', 'đỗ', 'hồ', 'ngô', 'dương', 'lý', 'đinh', 'đào', 'mai', 'trịnh',
])

/**
 * The name Aura greets a member with. Vietnamese names end with the given name
 * ("Nguyễn Minh An" -> "An"), but Google accounts often store the two-word
 * Western order ("An Nguyễn"), where the last word is the family name.
 */
export function greetingName(displayName: string, fallback = 'bạn') {
  const parts = displayName.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return fallback
  if (parts.length === 2) {
    const [first, last] = parts.map((part) => part.toLocaleLowerCase('vi'))
    if (VIETNAMESE_FAMILY_NAMES.has(last) && !VIETNAMESE_FAMILY_NAMES.has(first)) return parts[0]
  }
  return parts[parts.length - 1]
}
