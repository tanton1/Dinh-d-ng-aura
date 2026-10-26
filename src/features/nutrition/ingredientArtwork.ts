import manifest from './data/ingredientArtwork.json'

export interface IngredientArtworkSource { src: string; tile?: number; grid: number }

/** Source codes, not fuzzy names, keep unrelated products from sharing a picture. */
export function getIngredientArtwork(code?: string | null): IngredientArtworkSource | null {
  if (!code) return null
  const index = (manifest.byCode as Record<string, number>)[code]
  if (!Number.isInteger(index)) return null
  if (index < 0) return { src: manifest.photos[-index - 1], grid: 1 }
  const cells = manifest.grid ** 2
  return {
    src: `/images/ingredients/atlas-${String(Math.floor(index / cells)).padStart(2, '0')}.webp`,
    tile: index % cells,
    grid: manifest.grid,
  }
}
