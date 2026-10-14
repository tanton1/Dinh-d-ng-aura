import { NutritionReviewWorkspace } from '../../features/nutrition-review/NutritionReviewWorkspace'

export default function StaffNutritionReviewsPage({ initialStudentName = '', focus = null }: { initialStudentName?: string; focus?: string | null }) {
  return <NutritionReviewWorkspace title="Bữa ăn học viên tôi phụ trách" initialQuery={initialStudentName} initialFocus={focus} />
}
