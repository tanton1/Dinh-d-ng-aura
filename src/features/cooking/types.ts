export interface CookingChapter {
  id: string
  label: string
  title: string
  count: number
  pdf: string
  methodPage: number
  safetyPage: number
  sourceSha256: string
}

export interface CookingRecipe {
  id: string
  chapterId: string
  name: string
  description: string
  kcalPerServing: number
  batchKcal: number | null
  servings: number
  timeLabels: string[]
  timeNote: string
  portionNote: string
  ingredients: Array<{ name: string; amount: string }>
  steps: Array<{ title: string; text: string }>
  tip: string
  substitution: string
  portionDetail: string
  allergenNote: string
  requiresCooking: boolean
  image: string
  thumbnail: string
  sourcePage: number
}

export interface Cookbook {
  version: number
  chapters: CookingChapter[]
  recipes: CookingRecipe[]
}
