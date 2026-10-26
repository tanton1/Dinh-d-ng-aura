import type { CookingRecipe } from './types'

export function foldCookingText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
}

export function filterCookingRecipes(recipes: CookingRecipe[], query: string, chapterId: string, savedOnly: boolean, saved: ReadonlySet<string>) {
  const words = foldCookingText(query).trim().split(/\s+/).filter(Boolean)
  return recipes.filter((recipe) => {
    if (chapterId && recipe.chapterId !== chapterId) return false
    if (savedOnly && !saved.has(recipe.id)) return false
    const text = foldCookingText(`${recipe.name} ${recipe.ingredients.map((item) => item.name).join(' ')}`)
    return words.every((word) => text.includes(word))
  })
}

export function cookingRoute(hash: string) {
  const params = new URLSearchParams(hash.split('?')[1] || '')
  return { recipeId: params.get('recipe') || '', cooking: params.get('mode') === 'cook' }
}

export function cookingHash(recipeId = '', cooking = false) {
  const params = new URLSearchParams()
  if (recipeId) params.set('recipe', recipeId)
  if (recipeId && cooking) params.set('mode', 'cook')
  return `#/cooking${params.size ? `?${params}` : ''}`
}

export function cookingStorageKey(ownerId: string) {
  return `aura:cooking:saved:v1:${encodeURIComponent(ownerId)}`
}

export function readSavedRecipes(storage: Pick<Storage, 'getItem'>, ownerId: string): Set<string> {
  try {
    const value: unknown = JSON.parse(storage.getItem(cookingStorageKey(ownerId)) || '[]')
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && /^[BMVRSC]\d{2}$/.test(id)) : [])
  } catch {
    return new Set()
  }
}

export function writeSavedRecipes(storage: Pick<Storage, 'setItem'>, ownerId: string, saved: ReadonlySet<string>) {
  try {
    storage.setItem(cookingStorageKey(ownerId), JSON.stringify([...saved]))
    return true
  } catch {
    return false
  }
}
