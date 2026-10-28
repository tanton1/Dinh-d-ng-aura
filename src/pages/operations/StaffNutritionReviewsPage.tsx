import { NutritionReviewWorkspace } from '../../features/nutrition-review/NutritionReviewWorkspace'

export default function StaffNutritionReviewsPage({ initialStudentName = '', focus = null }: { initialStudentName?: string; focus?: string | null }) {
  return <NutritionReviewWorkspace title="Duyệt ăn" initialQuery={initialStudentName} initialFocus={focus} />
}
