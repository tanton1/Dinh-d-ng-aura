import type { NutritionFoodCatalogItem } from './types'

/** Keep real serving information; omit the source's placeholder sentence. */
export function catalogServingLabel(label?: string | null, grams?: number | null) {
  const text = label?.trim() ?? ''
  const unspecified = /không (?:nêu|ghi|xác định)|chưa (?:rõ|xác định)|theo (?:dữ liệu )?nguồn|not.specified/i.test(text)
  if (text && !unspecified) return text
  return typeof grams === 'number' && grams > 0 ? `${new Intl.NumberFormat('vi-VN').format(grams)} g` : ''
}

function normalizeName(value: string) {
  // Preserve Vietnamese accents so distinct foods such as ca/cà are not merged.
  return value.normalize('NFC').toLocaleLowerCase('vi-VN').replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/g, ' ').trim()
}

export function catalogIdentity(food: NutritionFoodCatalogItem) {
  return JSON.stringify([food.kind ?? 'dish', normalizeName(food.name), food.servingGrams ?? null, catalogServingLabel(food.servingLabel, food.servingGrams).toLocaleLowerCase('vi-VN')])
}

/** Display one complete source record, never average nutrition or delete source data. */
export function uniqueCatalogItems(items: NutritionFoodCatalogItem[]) {
  const seen = new Set<string>()
  return items.filter(food => {
    const identity = catalogIdentity(food)
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}
