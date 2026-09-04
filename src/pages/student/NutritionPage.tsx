import NutritionPageController from './NutritionPageController'
import type { NutritionPageProps } from '../../features/nutrition/types'

export type { NutritionGoal, NutritionProfileDraft } from '../../features/nutrition/types'

/**
 * Stable route entry for Nutrition. Heavy task flows live behind lazy boundaries
 * in the controller so this page remains a small orchestration surface.
 */
export default function NutritionPage(props: NutritionPageProps) {
  return <NutritionPageController {...props} />
}
