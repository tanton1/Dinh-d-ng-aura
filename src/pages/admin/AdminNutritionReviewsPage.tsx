import type { ViewId } from '../../types'
import { NutritionReviewWorkspace } from '../../features/nutrition-review/NutritionReviewWorkspace'

export default function AdminNutritionReviewsPage({
  onNavigate: _onNavigate,
}: {
  onNavigate: (view: ViewId) => void
}) {
  return <NutritionReviewWorkspace title="Trung tâm duyệt bữa ăn" />
}
