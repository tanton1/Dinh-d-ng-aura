import type { ViewId } from '../../types'
import { NutritionReviewWorkspace } from '../../features/nutrition-review/NutritionReviewWorkspace'

export default function AdminNutritionReviewsPage({
  onNavigate: _onNavigate,
  focus = null,
}: {
  onNavigate: (view: ViewId) => void
  focus?: string | null
}) {
  return <NutritionReviewWorkspace title="Duyệt ăn" initialFocus={focus} />
}
